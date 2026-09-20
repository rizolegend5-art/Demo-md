# AMAN-MD Bot v4.0.1

This version fixes the invalid `PAIR-DONE` pairing response, prevents duplicate
pairing sockets, scopes phone-number input to an active pairing request, sends a
configurable image with the Telegram start menu, and removes the Telegram token
value from source code.

## Important security step

The old archive contained a Telegram bot token. Treat that token as compromised:

1. Open BotFather and revoke/regenerate the token.
2. Copy `.env.example` to `.env`.
3. Put the new token in `TELEGRAM_BOT_TOKEN`.
4. Never upload `.env`, `sessions/`, or `node_modules/`.

## Install and run

```bash
npm install
npm run check
npm start
```

The Telegram bot must be an administrator in both configured Telegram channels,
otherwise membership verification will always fail.

## Pairing steps

1. Send `/start` to the Telegram bot.
2. Join both Telegram channels and press **Verify Membership**.
3. Press **Pair WhatsApp**.
4. Send the full number with country code, without `+`, for example
   `923001234567`.
5. In WhatsApp open **Settings → Linked Devices → Link with phone number
   instead**, then enter the exact eight-character code before it expires.

If the number is already linked in this bot's `sessions/` directory, the bot
loads that account instead of returning the fake `PAIR-DONE` placeholder. If
WhatsApp rejects the saved credentials with a logged-out response, the bot
clears only that stale local session and the next request generates a fresh
pairing code automatically.

The pairing request waits for the underlying Baileys WebSocket (`ws.isOpen`)
before sending the code. This avoids the common `Connection Failure`/428 error
caused by requesting a code while the socket is only in `connecting` state.

## API

The local health endpoint is:

```text
GET http://127.0.0.1:8080/status
```

`POST /api/pair` accepts:

```json
{ "phoneNumber": "923001234567" }
```

Set `PAIRING_API_KEY` before exposing the API outside localhost.

## Configuration

`config.js` reads all values from environment variables. Put your own token in
`.env` as `TELEGRAM_BOT_TOKEN=...`; do not place the real token directly in
`config.js` or share it in a ZIP. `TELEGRAM_MENU_IMAGE_URL` controls the image
sent above the Telegram start menu. If the image fails, the bot automatically
falls back to the text menu.

## WhatsApp commands

The following commands are wired and handled:

- `.menu` / `.help`
- `.ping`
- `.jid`
- `.antideletedm on|off`
- `.vv` (send with a view-once image/video/audio/document caption)
- `.autoreact on|off [emoji]`
- `.fakereact [emoji]` (reply to a message)
- `.shorturl <url>`
- `.ssweb <url>`
- `.remini` (send with an image caption; local resize/sharpen enhancement)
- `.ytmp4 <url>`
- `.ytmp3 <url>`
- `.tiktok <url>`
- `.instagram <url>`
- `.facebook <url>`
- `.pinterest <url>`
- `.apk <direct-url>`
- `.mediafire <url>`

The media commands use `MEDIA_API_URL` (default: Cobalt-compatible API). Some
providers may require their own endpoint or API key, and private/blocked links
cannot be downloaded. The bot returns a clear error instead of pretending that
the download succeeded.

Anti-delete recovery depends on the message being cached while the bot is
online; media deletion recovery reports the message as media rather than
claiming it can restore content that was never cached.