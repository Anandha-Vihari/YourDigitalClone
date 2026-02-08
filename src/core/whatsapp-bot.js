// Minimal WhatsApp bot (single-file)
// - Shows QR in terminal (and saves wa-qr.png)
// - Connects to WhatsApp
// - Echos incoming messages
// Run:
//   npm install @whiskeysockets/baileys qrcode-terminal qrcode pino
//   node whatsapp-bot.js

import makeWASocket, { fetchLatestBaileysVersion, useMultiFileAuthState } from '@whiskeysockets/baileys';
import qrcodeTerminal from 'qrcode-terminal';
import QRPNG from 'qrcode';
import pino from 'pino';

async function startBot() {
  const { state, saveCreds } = await useMultiFileAuthState('./whatsapp_auth');
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    auth: state,
    browser: ['Chrome', 'Windows', '10.0'],
    logger: pino({ level: 'silent' }),
  });

  sock.ev.on('connection.update', async ({ qr, connection, lastDisconnect }) => {
    if (qr) {
      console.log('\n================================ QR =================================\n');
      try { qrcodeTerminal.generate(qr, { small: true }); } catch { console.log(qr); }
      try { await QRPNG.toFile('wa-qr.png', qr, { width: 320 }); console.log('[QR] Saved wa-qr.png'); } catch {}
      console.log('========================================================================\n');
    }
    if (connection === 'open') {
      console.log('✅ Connected to WhatsApp!');
    }
    if (connection === 'close') {
      const code = lastDisconnect?.error?.output?.statusCode || lastDisconnect?.error?.statusCode || lastDisconnect?.error?.code;
      console.log('❌ Connection closed:', code);
      if (code === 401 || code === 515) {
        console.log('ℹ️ Logged out or invalid session. Run: npm run wa:reset && npm run wa:min');
      } else {
        console.log('🔄 Reconnecting in 2 seconds...');
        setTimeout(() => startBot(), 2000);
      }
    }
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;
    const msg = messages[0];
    if (!msg?.message || msg.key.fromMe) return;

    const remoteJid = msg.key.remoteJid;
    const text = msg.message.conversation || msg.message.extendedTextMessage?.text || '';
    console.log(`New message from ${remoteJid}: ${text}`);

    const reply = `You said: ${text}`;
    await sock.sendMessage(remoteJid, { text: reply });
    console.log('Replied:', reply);
  });
}

startBot().catch(err => {
  console.error('Fatal error:', err?.message || String(err));
  process.exit(1);
});
