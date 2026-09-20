const {
  downloadMediaMessage,
  normalizeMessageContent
} = require('@whiskeysockets/baileys');
const sharp = require('sharp');
const config = require('../config');
const {
  getUrlFromArgs,
  shortUrl,
  screenshotUrl,
  mediaDownload
} = require('./externalTools');

const socketStates = new WeakMap();
const MEDIA_COMMANDS = new Set([
  'ytmp4',
  'ytmp3',
  'tiktok',
  'instagram',
  'facebook',
  'pinterest',
  'apk',
  'mediafire'
]);

const COMMANDS = [
  ['menu', 'Full command menu'],
  ['help', 'Full command menu'],
  ['ping', 'Check bot response'],
  ['jid', 'Show the current chat JID'],
  ['antideletedm', 'Enable or disable anti-delete recovery'],
  ['vv', 'Recover a view-once image, video, audio, or document'],
  ['autoreact', 'Enable or disable automatic reactions'],
  ['fakereact', 'React to a replied message'],
  ['shorturl', 'Create a short URL'],
  ['ssweb', 'Create a website screenshot'],
  ['ytmp4', 'Download a public video URL'],
  ['ytmp3', 'Download audio from a public video URL'],
  ['tiktok', 'Download a public TikTok URL'],
  ['instagram', 'Download a public Instagram URL'],
  ['facebook', 'Download a public Facebook URL'],
  ['pinterest', 'Download a public Pinterest URL'],
  ['apk', 'Download a direct APK URL'],
  ['mediafire', 'Download a public MediaFire URL'],
  ['remini', 'Image enhancement provider command']
];

function getState(sock) {
  let state = socketStates.get(sock);
  if (!state) {
    state = {
      antiDelete: new Set(),
      autoReact: new Map(),
      messageCache: new Map()
    };
    socketStates.set(sock, state);
  }
  return state;
}

function getMessageText(message) {
  return (
    message?.conversation ||
    message?.extendedTextMessage?.text ||
    message?.imageMessage?.caption ||
    message?.videoMessage?.caption ||
    ''
  );
}

function cacheKey(key) {
  return key?.remoteJid && key?.id ? `${key.remoteJid}:${key.id}` : null;
}

function cacheMessage(sock, message) {
  const state = getState(sock);
  const key = cacheKey(message.key);
  if (!key) return;
  state.messageCache.set(key, { message, savedAt: Date.now() });

  const cutoff = Date.now() - 15 * 60 * 1000;
  for (const [storedKey, value] of state.messageCache) {
    if (value.savedAt < cutoff) state.messageCache.delete(storedKey);
  }
}

function commandMenuText() {
  const commandLines = COMMANDS.map(
    ([command, description]) => `┃✇ .${command} — ${description}`
  ).join('\n');

  return `┏𓋰━𓋰━𓋰━𓋰━𓋰━𓋰━╮
┃ 𓆩♡ ${config.BOT_NAME}
┗𓋰━𓋰━𓋰━𓋰━𓋰━𓋰━╯

╭╮
┃┃𝐀𝐋𝐋 𝐂𝐎𝐌𝐌𝐀𝐍𝐃𝐒
┃╰────────────╯
┣╍╍╍╍╍╍╍╍╍╍╍╍╍╍╍╍╍╍╍╍╍┈╮
┃✾╭────────────────────
┃✾┋🌸 𝗕𝗢𝗧 : ${config.BOT_NAME}
┃✾┋👑 𝗢𝗪𝗡𝗘𝗥 : ${config.OWNER_NAME}
┃✾┋📦 𝗩𝗘𝗥𝗦𝗜𝗢𝗡 : ${config.VERSION}
┃✾┋📡 𝗣𝗟𝗔𝗧𝗙𝗢𝗥𝗠 : ${config.PLATFORM}
┃
${commandLines}
╰━━━━━━━━━━━━━━━━━━━━┈⊷

${config.COMMAND_FOOTER}`;
}

async function sendMenu(sock, jid) {
  const text = commandMenuText();
  if (config.MENU_IMAGE_URL) {
    try {
      await sock.sendMessage(jid, {
        image: { url: config.MENU_IMAGE_URL },
        caption: text
      });
      return;
    } catch (error) {
      console.warn('[WhatsApp] Menu image failed, sending text fallback:', error.message);
    }
  }
  await sock.sendMessage(jid, { text });
}

function parseToggle(args, current) {
  const value = String(args || '').trim().toLowerCase();
  if (['on', 'enable', 'enabled', 'yes', '1'].includes(value)) return true;
  if (['off', 'disable', 'disabled', 'no', '0'].includes(value)) return false;
  return !current;
}

async function sendMediaResult(sock, jid, result, caption) {
  if (result.audio) {
    return sock.sendMessage(jid, {
      audio: { url: result.url },
      mimetype: result.mime,
      fileName: `${result.filename}.mp3`,
      ptt: false
    });
  }
  return sock.sendMessage(jid, {
    video: { url: result.url },
    mimetype: result.mime,
    fileName: result.filename,
    caption
  });
}

async function handleMediaCommand(sock, jid, command, args) {
  const url = getUrlFromArgs(args);
  if (!url) {
    throw new Error(`Usage: .${command} https://example.com/public-link`);
  }
  const result = await mediaDownload(url, { audio: command === 'ytmp3' });
  return sendMediaResult(sock, jid, result, `✅ ${command} complete\n${config.FOOTER_BRAND}`);
}

async function handleViewOnce(sock, jid, message) {
  const normalized = normalizeMessageContent(message.message);
  const media =
    normalized?.imageMessage ||
    normalized?.videoMessage ||
    normalized?.audioMessage ||
    normalized?.documentMessage;
  if (!media) {
    throw new Error('Is message mein supported view-once media nahi mila');
  }

  const copy = { ...message, message: normalized };
  const buffer = await downloadMediaMessage(
    copy,
    'buffer',
    {},
    { reuploadRequest: sock.updateMediaMessage }
  );

  if (normalized.imageMessage) {
    return sock.sendMessage(jid, {
      image: buffer,
      caption: normalized.imageMessage.caption || 'View-once recovered ✅'
    });
  }
  if (normalized.videoMessage) {
    return sock.sendMessage(jid, {
      video: buffer,
      caption: normalized.videoMessage.caption || 'View-once recovered ✅'
    });
  }
  if (normalized.audioMessage) {
    return sock.sendMessage(jid, { audio: buffer, mimetype: normalized.audioMessage.mimetype });
  }
  return sock.sendMessage(jid, {
    document: buffer,
    fileName: normalized.documentMessage.fileName || 'recovered-file'
  });
}

async function enhanceImage(sock, jid, message) {
  const normalized = normalizeMessageContent(message.message);
  if (!normalized?.imageMessage) {
    throw new Error('Image ke sath .remini command bhejein');
  }

  const buffer = await downloadMediaMessage(
    { ...message, message: normalized },
    'buffer',
    {},
    { reuploadRequest: sock.updateMediaMessage }
  );
  const enhanced = await sharp(buffer)
    .resize({ width: config.IMAGE_ENHANCE_WIDTH, withoutEnlargement: false })
    .sharpen({ sigma: 1.1 })
    .jpeg({ quality: 92, mozjpeg: true })
    .toBuffer();

  return sock.sendMessage(jid, {
    image: enhanced,
    caption: `Image enhanced ✅\n${config.FOOTER_BRAND}`
  });
}

function quotedReactionKey(message, jid) {
  const context = message.message?.extendedTextMessage?.contextInfo;
  if (!context?.stanzaId) return null;
  return {
    remoteJid: jid,
    id: context.stanzaId,
    participant: context.participant
  };
}

async function handleIncomingMessage(sock, message) {
  const sender = message?.key?.remoteJid;
  if (!sender || message.key.fromMe) return;
  cacheMessage(sock, message);

  const state = getState(sock);
  const autoReaction = state.autoReact.get(sender);
  if (autoReaction && !message.key.fromMe) {
    await sock.sendMessage(sender, {
      react: { text: autoReaction, key: message.key }
    }).catch(() => {});
  }

  const rawText = getMessageText(message.message).trim();
  if (!rawText.startsWith('.') && !rawText.startsWith('/')) return;

  const parts = rawText.slice(1).trim().split(/\s+/);
  const command = (parts.shift() || '').toLowerCase();
  const args = parts.join(' ').trim();

  try {
    switch (command) {
      case 'menu':
      case 'help':
        return sendMenu(sock, sender);
      case 'ping':
        return sock.sendMessage(sender, { text: `Pong ✅\n${config.FOOTER_BRAND}` });
      case 'jid':
        return sock.sendMessage(sender, { text: `Current chat JID:\n${sender}` });
      case 'antideletedm': {
        const enabled = parseToggle(args, state.antiDelete.has(sender));
        enabled ? state.antiDelete.add(sender) : state.antiDelete.delete(sender);
        return sock.sendMessage(sender, {
          text: `Anti-delete ${enabled ? 'enabled ✅' : 'disabled ❌'} for this chat.`
        });
      }
      case 'autoreact': {
        const requested = args.split(/\s+/).filter(Boolean);
        const enabled = parseToggle(requested[0], state.autoReact.has(sender));
        if (!enabled) state.autoReact.delete(sender);
        else state.autoReact.set(sender, requested[1] || '❤️');
        return sock.sendMessage(sender, {
          text: enabled
            ? `Auto-react enabled ✅ (${state.autoReact.get(sender)})`
            : 'Auto-react disabled ❌'
        });
      }
      case 'fakereact': {
        const key = quotedReactionKey(message, sender);
        if (!key) throw new Error('Jis message par react karna hai usay reply karke command bhejein');
        const emoji = args.split(/\s+/)[0] || '❤️';
        return sock.sendMessage(sender, { react: { text: emoji, key } });
      }
      case 'vv':
        return handleViewOnce(sock, sender, message);
      case 'shorturl': {
        const url = getUrlFromArgs(args);
        if (!url) throw new Error('Usage: .shorturl https://example.com');
        const result = await shortUrl(url);
        return sock.sendMessage(sender, { text: `Short URL:\n${result}` });
      }
      case 'ssweb': {
        const url = getUrlFromArgs(args);
        if (!url) throw new Error('Usage: .ssweb https://example.com');
        return sock.sendMessage(sender, {
          image: { url: await screenshotUrl(url) },
          caption: `Website screenshot ✅\n${config.FOOTER_BRAND}`
        });
      }
      case 'remini':
        return enhanceImage(sock, sender, message);
      default:
        if (MEDIA_COMMANDS.has(command)) {
          return handleMediaCommand(sock, sender, command, args);
        }
        return sock.sendMessage(sender, {
          text: `Unknown command. Type .menu to see all commands.\n\n${config.FOOTER_BRAND}`
        });
    }
  } catch (error) {
    console.error(`[WhatsApp] .${command} error:`, error);
    return sock.sendMessage(sender, { text: `❌ ${error.message}` });
  }
}

async function handleMessageUpdates(sock, updates) {
  const state = getState(sock);
  for (const item of updates || []) {
    const update = item?.update || {};
    const key = item?.key || update?.key;
    const deleted =
      update.message === null ||
      update.messageStubType === 68 ||
      update.message?.protocolMessage?.type === 0;
    if (!deleted || !key?.remoteJid || !state.antiDelete.has(key.remoteJid)) continue;

    const cached = state.messageCache.get(cacheKey(key));
    if (!cached) {
      await sock.sendMessage(key.remoteJid, {
        text: '🗑️ A message was deleted, but its content was not cached.'
      });
      continue;
    }

    const text = getMessageText(cached.message.message);
    await sock.sendMessage(key.remoteJid, {
      text: `🗑️ Deleted message recovered:\n${text || '[media message]'}`
    });
  }
}

module.exports = {
  handleIncomingMessage,
  handleMessageUpdates,
  commandMenuText,
  COMMANDS
};