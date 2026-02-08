/**
 * One-off WhatsApp sender
 * Usage examples:
 *   node wa-send.js --to 9198XXXXXXXX@s.whatsapp.net --text "hello"
 *   node wa-send.js --phone 9198XXXXXXXX --text "hello"
 * Requires prior login (scan QR once): run bot in WA_ONLY mode or `npm run wa:login`.
 */

import makeWASocket, { useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } from "@whiskeysockets/baileys";
import pino from "pino";
import qrcode from "qrcode-terminal";
import QRPNG from "qrcode";

function parseArgs() {
  const args = process.argv.slice(2);
  const out = { to: null, phone: null, text: null };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--to") out.to = args[++i];
    else if (a === "--phone") out.phone = args[++i];
    else if (a === "--text") out.text = args[++i];
  }
  out.to = out.to || process.env.TARGET_JID || null;
  out.phone = out.phone || process.env.TARGET_PHONE || process.env.GF_PHONE_NUMBER || null;
  out.text = out.text || process.env.TEXT || null;
  return out;
}

function ensureJid({ to, phone }) {
  if (to) return to;
  if (phone) return `${phone}@s.whatsapp.net`;
  throw new Error("Provide --to JID or --phone");
}

async function main() {
  const { state, saveCreds } = await useMultiFileAuthState("./whatsapp_auth");
  const { version } = await fetchLatestBaileysVersion();
  const sock = makeWASocket({ auth: state, version, browser: ["Chrome", "Windows", "10.0"], logger: pino({ level: "silent" }) });

  const params = parseArgs();
  const jid = ensureJid(params);
  const text = params.text || "hello";

  return new Promise((resolve, reject) => {
    let opened = false;
    sock.ev.on("connection.update", async ({ connection, lastDisconnect, qr }) => {
      if (qr) {
        console.log("\n====== WhatsApp QR (scan with your phone) ======\n");
        try { qrcode.generate(qr, { small: true }); } catch { console.log(qr); }
        try { await QRPNG.toFile("wa-qr.png", qr, { width: 320 }); console.log("[QR] Saved image: wa-qr.png"); } catch {}
      }
      if (connection === "open") {
        opened = true;
        try {
          await sock.sendMessage(jid, { text });
          console.log(`[WA] Sent to ${jid}: ${text}`);
          resolve();
        } catch (e) {
          reject(e);
        } finally {
          setTimeout(() => process.exit(0), 200);
        }
      } else if (connection === "close") {
        const code = lastDisconnect?.error?.output?.statusCode || lastDisconnect?.error?.statusCode || lastDisconnect?.error?.code;
        const shouldReconnect = code !== DisconnectReason.loggedOut;
        if (!opened && shouldReconnect) {
          // allow Baileys to reconnect automatically
        } else if (!opened) {
          reject(new Error("Connection closed before open"));
        }
      }
    });
    sock.ev.on("creds.update", saveCreds);
  });
}

main().catch(err => {
  console.error("wa-send error:", err?.message || String(err));
  process.exit(1);
});
