const config = require('./config');
const { startTelegramBot } = require('./lib/telegram');
const { startPairingServer } = require('./lib/pairingServer');

console.log(`
┏𓋰━𓋰━𓋰━𓋰━𓋰━𓋰━╮
┃ 𓆩♡ ${config.BOT_NAME} v${config.VERSION}
┗𓋰━𓋰━𓋰━𓋰━𓋰━𓋰━╯
🚀 Initializing AMAN-MD Multi-Device Engine...
👑 Owner: ${config.OWNER_NAME}
📢 Channel JID: ${config.WHATSAPP_CHANNEL.JID}
`);

const telegramBot = startTelegramBot();
const pairingServer = startPairingServer(config.PORT, config.HOST);

if (!telegramBot) {
  console.warn('⚠️ Telegram bot is disabled until TELEGRAM_BOT_TOKEN is configured.');
}

process.on('unhandledRejection', (error) => {
  console.error('[Process] Unhandled rejection:', error);
});

process.on('uncaughtException', (error) => {
  console.error('[Process] Uncaught exception:', error);
});

module.exports = { telegramBot, pairingServer };