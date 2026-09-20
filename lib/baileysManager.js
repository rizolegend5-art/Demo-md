const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  delay
} = require('@whiskeysockets/baileys');
const pino = require('pino');
const path = require('path');
const fs = require('fs');
const config = require('../config');
const {
  handleIncomingMessage,
  handleMessageUpdates
} = require('./messageHandler');

const sessionsRoot = path.join(__dirname, '../sessions');
const activeSessions = new Map();
const pendingSessions = new Map();

function normalizePhoneNumber(value) {
  const phoneNumber = String(value || '').replace(/\D/g, '');
  if (!/^\d{10,15}$/.test(phoneNumber)) {
    throw new Error('Number 10 se 15 digits ka ho aur country code ke sath bhejein, misal: 923001234567');
  }
  return phoneNumber;
}

function sessionIdFor(phoneNumber) {
  return `session_${phoneNumber}`;
}

function closeSocket(socket) {
  if (!socket) return;
  try {
    socket.ws?.close();
  } catch (error) {
    console.warn('[WhatsApp] Socket cleanup warning:', error.message);
  }
}

function pairingErrorMessage(error) {
  const message = error?.message || String(error);
  const statusCode = error?.output?.statusCode || error?.statusCode;
  if (statusCode === DisconnectReason.loggedOut || statusCode === 401) {
    return 'WhatsApp ne purani ya invalid session reject ki. Stale session clean kar di gayi hai; dobara number bhej kar fresh code request karein.';
  }
  if (statusCode === DisconnectReason.timedOut || statusCode === 408) {
    return 'WhatsApp connection timeout ho gayi. Network stable karke 30 seconds baad dobara fresh code request karein.';
  }
  if (/connection closed|timed out|timeout/i.test(message)) {
    return 'WhatsApp connection ready nahi hui. Thori dair baad dobara code generate karein.';
  }
  if (/bad mac|decrypt/i.test(message)) {
    return 'Purani session files corrupt hain. Is number ki session directory delete karke dobara pair karein.';
  }
  return message;
}

function waitForSocketReady(sock, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let timer;
    let readinessPoll;

    const cleanup = () => {
      clearTimeout(timer);
      clearInterval(readinessPoll);
      sock.ev.off('connection.update', onUpdate);
    };

    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      cleanup();
      callback(value);
    };

    const isSocketOpen = () =>
      sock.ws?.isOpen === true || sock.ws?.readyState === 1;

    const onUpdate = ({ connection, lastDisconnect }) => {
      if (connection === 'close') {
        finish(
          reject,
          lastDisconnect?.error || new Error('WhatsApp connection closed before pairing')
        );
        return;
      }

      // `connecting` is not enough: requestPairingCode sends a node and needs
      // the underlying WebSocket itself to be open.
      if (isSocketOpen()) {
        setTimeout(() => finish(resolve), 750);
      }
    };

    sock.ev.on('connection.update', onUpdate);
    if (isSocketOpen()) {
      setTimeout(() => finish(resolve), 750);
    }
    readinessPoll = setInterval(() => {
      if (isSocketOpen()) setTimeout(() => finish(resolve), 250);
    }, 100);
    timer = setTimeout(
      () => finish(reject, new Error('WhatsApp connection ready hone mein timeout ho gaya')),
      timeoutMs
    );
  });
}

async function requestPairingCodeWithRetry(sock, phoneNumber) {
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const code = await sock.requestPairingCode(phoneNumber);
      if (!code || typeof code !== 'string' || code.length < 6) {
        throw new Error('WhatsApp ne valid pairing code return nahi kiya');
      }
      return code;
    } catch (error) {
      lastError = error;
      if (attempt < 3) await delay(1500 * attempt);
    }
  }
  throw lastError;
}

async function createPairingSession(inputPhoneNumber) {
  const phoneNumber = normalizePhoneNumber(inputPhoneNumber);
  const sessionId = sessionIdFor(phoneNumber);

  const current = activeSessions.get(sessionId) || pendingSessions.get(sessionId);
  if (
    current &&
    ['starting', 'connecting_existing'].includes(current.status)
  ) {
    return { ...current, code: null, expiresIn: 0 };
  }
  if (
    current?.status === 'awaiting_pairing' &&
    current.code &&
    current.expiresAt > Date.now()
  ) {
    return { ...current, expiresIn: Math.ceil((current.expiresAt - Date.now()) / 1000) };
  }
  if (current?.status === 'awaiting_pairing' && current.expiresAt <= Date.now()) {
    pendingSessions.delete(sessionId);
    closeSocket(current.sock);
  }
  if (current?.status === 'connected') {
    return { ...current, code: null, expiresIn: 0 };
  }

  fs.mkdirSync(sessionsRoot, { recursive: true });
  const sessionPath = path.join(sessionsRoot, sessionId);
  const { state, saveCreds } = await useMultiFileAuthState(sessionPath);

  // An existing auth state should be loaded and connected, not reported as a
  // dead-end. A new pairing code is only needed when the account is unlinked.
  const existingSession = Boolean(state.creds.registered);

  const { version } = await fetchLatestBaileysVersion();
  const sock = makeWASocket({
    version,
    logger: pino({ level: process.env.LOG_LEVEL || 'warn' }),
    printQRInTerminal: false,
    auth: state,
    browser: ['Ubuntu', 'Chrome', '120.0.0'],
    connectTimeoutMs: 60000,
    defaultQueryTimeoutMs: 60000,
    keepAliveIntervalMs: 10000,
    retryRequestDelayMs: 250,
    markOnlineOnConnect: false,
    syncFullHistory: false
  });

  const session = {
    sessionId,
    phoneNumber,
    sock,
    status: 'starting',
    code: null,
    createdAt: Date.now()
  };
  pendingSessions.set(sessionId, session);
  if (existingSession) {
    session.status = 'connecting_existing';
    pendingSessions.delete(sessionId);
    activeSessions.set(sessionId, session);
  }
  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', async ({ connection, lastDisconnect }) => {
    if (connection === 'open') {
      session.status = 'connected';
      pendingSessions.delete(sessionId);
      activeSessions.set(sessionId, session);
      console.log(`[WhatsApp] Connected for +${phoneNumber}`);

      if (config.AUTO_FOLLOW_NEWSLETTER && typeof sock.newsletterFollow === 'function') {
        try {
          await sock.newsletterFollow(config.WHATSAPP_CHANNEL.JID);
        } catch (error) {
          console.warn('[WhatsApp] Newsletter follow skipped:', error.message);
        }
      }
    }

    if (connection === 'close') {
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      pendingSessions.delete(sessionId);
      activeSessions.delete(sessionId);
      session.status = statusCode === DisconnectReason.loggedOut ? 'logged_out' : 'closed';
      if (statusCode === DisconnectReason.loggedOut) {
        try {
          fs.rmSync(sessionPath, { recursive: true, force: true });
          console.warn(`[WhatsApp] Removed logged-out session ${phoneNumber}; next request will generate a fresh code.`);
        } catch (error) {
          console.error('[WhatsApp] Could not clear logged-out session:', error.message);
        }
      }
      console.warn(`[WhatsApp] Session ${phoneNumber} closed (${statusCode || 'unknown'})`);
    }
  });

  sock.ev.on('messages.upsert', async ({ messages }) => {
    for (const message of messages || []) {
      if (!message?.message) continue;
      try {
        await handleIncomingMessage(sock, message);
      } catch (error) {
        console.error('[WhatsApp] Message handler error:', error);
      }
    }
  });

  sock.ev.on('messages.update', async (updates) => {
    try {
      await handleMessageUpdates(sock, updates);
    } catch (error) {
      console.error('[WhatsApp] Message update handler error:', error);
    }
  });

  try {
    if (existingSession) {
      return { ...session, code: null, expiresIn: 0 };
    }
    await waitForSocketReady(sock);
    const code = await requestPairingCodeWithRetry(sock, phoneNumber);
    session.status = 'awaiting_pairing';
    session.code = code;
    session.expiresAt = Date.now() + 60_000;
    return { ...session, expiresIn: 60 };
  } catch (error) {
    pendingSessions.delete(sessionId);
    closeSocket(sock);
    throw new Error(pairingErrorMessage(error));
  }
}

function getSessionSummary() {
  return [...new Map([...activeSessions, ...pendingSessions]).values()].map((session) => ({
    sessionId: session.sessionId,
    phoneNumber: session.phoneNumber,
    status: session.status,
    expiresAt: session.expiresAt || null
  }));
}

module.exports = {
  createPairingSession,
  activeSessions,
  pendingSessions,
  getSessionSummary,
  normalizePhoneNumber
};