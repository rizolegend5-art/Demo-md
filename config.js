const fs = require('fs');
const path = require('path');

// Built-in .env file parser (No 'dotenv' package required)
try {
  const envPath = path.resolve(process.cwd(), '.env');
  if (fs.existsSync(envPath)) {
    const envConfig = fs.readFileSync(envPath, 'utf8');
    envConfig.split('\n').forEach(line => {
      const trimmedLine = line.trim();
      if (trimmedLine && !trimmedLine.startsWith('#')) {
        const [key, ...valueParts] = trimmedLine.split('=');
        if (key && valueParts.length > 0) {
          const val = valueParts.join('=').trim().replace(/^["']|["']$/g, '');
          process.env[key.trim()] = val;
        }
      }
    });
  }
} catch (err) {
  console.error('Error loading .env file:', err);
}

// Global Variables Configuration
global.owner = process.env.OWNER_NUMBER ? process.env.OWNER_NUMBER.split(',') : ['923000000000'];
global.prefix = process.env.PREFIX || '.';
global.botName = process.env.BOT_NAME || 'Bot';
global.sessionName = process.env.SESSION_ID || 'session';

module.exports = {
  OWNER_NUMBER: global.owner,
  PREFIX: global.prefix,
  BOT_NAME: global.botName,
  SESSION_ID: global.sessionName
};
