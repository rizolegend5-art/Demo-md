const express = require('express');
const config = require('../config');
const {
  createPairingSession,
  activeSessions,
  getSessionSummary
} = require('./baileysManager');

function isAuthorized(req) {
  if (!config.PAIRING_API_KEY) return true;
  return req.get('x-api-key') === config.PAIRING_API_KEY;
}

function startPairingServer(port = config.PORT, host = config.HOST) {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '16kb' }));

  app.get('/status', (req, res) => {
    res.json({
      status: 'online',
      bot: config.BOT_NAME,
      owner: config.OWNER_NAME,
      activeSessionsCount: activeSessions.size,
      sessions: getSessionSummary()
    });
  });

  app.post('/api/pair', async (req, res) => {
    if (!isAuthorized(req)) {
      return res.status(401).json({ success: false, error: 'Unauthorized' });
    }

    const { phoneNumber } = req.body || {};
    if (!phoneNumber) {
      return res.status(400).json({
        success: false,
        error: 'phoneNumber is required with country code, without +'
      });
    }

    try {
      const session = await createPairingSession(phoneNumber);
      if (session.status === 'already_linked' || session.status === 'connected') {
        return res.status(409).json({
          success: false,
          status: session.status,
          phoneNumber: session.phoneNumber,
          message: 'This number is already linked to an existing session.'
        });
      }
      if (session.status === 'starting' || session.status === 'connecting_existing') {
        return res.json({
          success: true,
          status: session.status,
          phoneNumber: session.phoneNumber,
          pairingCode: null,
          expiresIn: 0,
          message: 'Existing WhatsApp session load ho rahi hai; naya pairing code enter karne ki zaroorat nahi.'
        });
      }

      return res.json({
        success: true,
        status: session.status,
        phoneNumber: session.phoneNumber,
        pairingCode: session.code,
        expiresIn: session.expiresIn,
        message: 'WhatsApp > Linked devices > Link with phone number instead mein ye exact code enter karein.'
      });
    } catch (error) {
      console.error('[Pairing API] Error:', error);
      return res.status(422).json({ success: false, error: error.message });
    }
  });

  const server = app.listen(port, host, () => {
    console.log(`AMAN-MD Pairing API listening on http://${host}:${port}`);
    if (!config.PAIRING_API_KEY) {
      console.warn('⚠️ PAIRING_API_KEY is not set; protect this API before exposing it publicly.');
    }
  });

  return { app, server };
}

module.exports = { startPairingServer };