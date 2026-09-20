const config = require('../config');
const { createPairingSession } = require('./baileysManager');

const waitingForPhone = new Set();

class TelegramApi {
  constructor(token) {
    this.baseUrl = `https://api.telegram.org/bot${token}`;
    this.offset = 0;
    this.running = false;
  }

  async request(method, body = {}) {
    const response = await fetch(`${this.baseUrl}/${method}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body)
    });
    const result = await response.json();
    if (!response.ok || !result.ok) {
      throw new Error(result.description || `Telegram API ${method} failed`);
    }
    return result.result;
  }

  sendMessage(chatId, text, options = {}) {
    return this.request('sendMessage', { chat_id: chatId, text, ...options });
  }

  sendPhoto(chatId, photo, options = {}) {
    return this.request('sendPhoto', { chat_id: chatId, photo, ...options });
  }

  answerCallbackQuery(id, options = {}) {
    return this.request('answerCallbackQuery', { callback_query_id: id, ...options });
  }

  deleteMessage(chatId, messageId) {
    return this.request('deleteMessage', { chat_id: chatId, message_id: messageId });
  }

  getChatMember(chatId, userId) {
    return this.request('getChatMember', { chat_id: chatId, user_id: userId });
  }

  async startPolling(handleUpdate) {
    this.running = true;
    while (this.running) {
      try {
        const updates = await this.request('getUpdates', {
          offset: this.offset,
          timeout: 25,
          allowed_updates: ['message', 'callback_query']
        });
        for (const update of updates) {
          this.offset = update.update_id + 1;
          try {
            await handleUpdate(update);
          } catch (error) {
            console.error('[Telegram] Update handler error:', error);
          }
        }
      } catch (error) {
        console.error('[Telegram] Polling error:', error.message);
        await new Promise((resolve) => setTimeout(resolve, 3000));
      }
    }
  }

  stop() {
    this.running = false;
  }
}

function isOwner(userId) {
  return String(userId) === String(config.OWNER_TELEGRAM_ID);
}

async function checkTelegramChannels(bot, userId) {
  try {
    const members = await Promise.all([
      bot.getChatMember(config.CHANNEL_1.ID, userId),
      bot.getChatMember(config.CHANNEL_2.ID, userId)
    ]);
    return members.every(({ status }) =>
      ['creator', 'administrator', 'member'].includes(status)
    );
  } catch (error) {
    console.error('[Telegram] Membership check failed:', error.message);
    return false;
  }
}

function pairKeyboard() {
  return {
    inline_keyboard: [
      [{ text: '📱 Pair WhatsApp', callback_data: 'pair_whatsapp' }],
      [
        { text: '👨‍💻 Developer', callback_data: 'dev_contact' },
        { text: '📢 Channel Updates', url: config.CHANNEL_UPDATE_URL }
      ]
    ]
  };
}

function ownerKeyboard() {
  return {
    inline_keyboard: [
      [{ text: '📱 Pair WhatsApp', callback_data: 'pair_whatsapp' }],
      [
        { text: '👨‍💻 Developer', callback_data: 'dev_contact' },
        { text: '📢 View Channel', url: config.WHATSAPP_CHANNEL.URL }
      ]
    ]
  };
}

function sendJoinChannelsGate(bot, chatId, name) {
  return bot.sendMessage(
    chatId,
    `Assalam-o-Alaikum ${name}!\n\nBot use karne se pehle in dono Telegram channels ko join karein. WhatsApp channel optional update channel hai; Telegram bot uski membership verify nahi kar sakta.\n\nPhir “Verify Membership” press karein.`,
    {
      reply_markup: {
        inline_keyboard: [
          [
            { text: 'Join Telegram 1', url: config.CHANNEL_1.LINK },
            { text: 'Join Telegram 2', url: config.CHANNEL_2.LINK }
          ],
          [{ text: 'Join WhatsApp Channel', url: config.WHATSAPP_CHANNEL.URL }],
          [{ text: '✅ Verify Membership', callback_data: 'verify_membership' }]
        ]
      }
    }
  );
}

function sendPairMenu(bot, chatId, name, owner = false) {
  const text = owner
    ? `👑 Welcome ${name}!\n\nOwner bypass active. AMAN-MD pairing panel ready.`
    : `✅ Verification done!\n\nWelcome ${name} to ${config.BOT_NAME} v${config.VERSION}.`;
  const replyMarkup = owner ? ownerKeyboard() : pairKeyboard();

  if (config.TELEGRAM_MENU_IMAGE_URL) {
    return bot
      .sendPhoto(chatId, config.TELEGRAM_MENU_IMAGE_URL, {
        caption: text,
        reply_markup: replyMarkup
      })
      .catch(async (error) => {
        console.warn('[Telegram] Start image failed, using text fallback:', error.message);
        return bot.sendMessage(chatId, text, { reply_markup: replyMarkup });
      });
  }
  return bot.sendMessage(chatId, text, { reply_markup: replyMarkup });
}

async function handlePhoneNumber(bot, msg) {
  const chatId = msg.chat.id;
  if (!waitingForPhone.has(chatId) || !msg.text || msg.text.startsWith('/')) return false;

  waitingForPhone.delete(chatId);
  const phoneNumber = msg.text.replace(/\D/g, '');
  await bot.sendMessage(chatId, '⏳ Pairing code generate ho raha hai. 10–30 seconds wait karein...');

  try {
    const session = await createPairingSession(phoneNumber);
    if (session.status === 'already_linked' || session.status === 'connected') {
      await bot.sendMessage(
        chatId,
        '⚠️ Is number ki session pehle se linked hai. Naya code banane ke liye WhatsApp Linked Devices se purani session unlink karein aur bot ko dobara try karein.'
      );
      return true;
    }
    if (session.status === 'connecting_existing') {
      await bot.sendMessage(
        chatId,
        '✅ Purani valid session mil gayi. Bot us WhatsApp account se connect ho raha hai—naya pairing code enter karne ki zaroorat nahi.'
      );
      return true;
    }

    await bot.sendMessage(
      chatId,
      `📱 Number: ${session.phoneNumber}\n🔑 Pairing Code: ${session.code}\n⏳ Validity: ${session.expiresIn} seconds\n\nWhatsApp → Settings → Linked Devices → Link with phone number instead → ye exact code enter karein.\n\nCode expire ho jaye to naya code request karein.`,
      { disable_web_page_preview: true }
    );
  } catch (error) {
    console.error('[Telegram] Pairing error:', error);
    await bot.sendMessage(chatId, `❌ Pairing failed:\n${error.message}`);
  }
  return true;
}

async function handleUpdate(bot, update) {
  if (update.message) {
    const msg = update.message;
    const chatId = msg.chat.id;
    const userId = msg.from?.id;
    const text = msg.text || '';
    const firstName = msg.from?.first_name || 'User';

    if (await handlePhoneNumber(bot, msg)) return;

    if (/^\/start(?:@\w+)?$/.test(text)) {
      if (isOwner(userId)) return sendPairMenu(bot, chatId, firstName, true);
      const joined = await checkTelegramChannels(bot, userId);
      return joined
        ? sendPairMenu(bot, chatId, firstName)
        : sendJoinChannelsGate(bot, chatId, firstName);
    }

    if (/^\/(menu|help)(?:@\w+)?$/.test(text)) {
      if (isOwner(userId) || (await checkTelegramChannels(bot, userId))) {
        return sendPairMenu(bot, chatId, firstName, isOwner(userId));
      }
      return sendJoinChannelsGate(bot, chatId, firstName);
    }

    if (/^\/cancel(?:@\w+)?$/.test(text)) {
      waitingForPhone.delete(chatId);
      return bot.sendMessage(chatId, 'Pairing request cancel kar di gayi.');
    }
    return;
  }

  const query = update.callback_query;
  if (!query?.message?.chat?.id) return;

  const chatId = query.message.chat.id;
  const userId = query.from.id;
  await bot.answerCallbackQuery(query.id);

  if (query.data === 'verify_membership') {
    const joined = isOwner(userId) || (await checkTelegramChannels(bot, userId));
    if (!joined) {
      return bot.sendMessage(chatId, '❌ Pehle dono Telegram channels join karein, phir Verify dabayein.');
    }
    await bot.deleteMessage(chatId, query.message.message_id).catch(() => {});
    return sendPairMenu(bot, chatId, query.from.first_name || 'User', isOwner(userId));
  }

  if (!isOwner(userId) && !(await checkTelegramChannels(bot, userId))) {
    return sendJoinChannelsGate(bot, chatId, query.from.first_name || 'User');
  }

  if (query.data === 'pair_whatsapp') {
    waitingForPhone.add(chatId);
    return bot.sendMessage(
      chatId,
      '📱 WhatsApp number bhejein, country code ke sath aur + ke baghair.\nExample: 923001234567\n\nCancel ke liye /cancel bhejein.'
    );
  }

  if (query.data === 'dev_contact') {
    return bot.sendMessage(chatId, `Developer: ${config.DEVELOPER_CONTACT_URL}`, {
      disable_web_page_preview: true
    });
  }
}

function startTelegramBot() {
  if (!config.TELEGRAM_BOT_TOKEN) return null;

  const bot = new TelegramApi(config.TELEGRAM_BOT_TOKEN);
  console.log('[Telegram] Bot connected. Membership checks require channel admin access.');
  bot.startPolling((update) => handleUpdate(bot, update));
  return bot;
}

module.exports = { startTelegramBot, checkTelegramChannels };