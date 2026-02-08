// Clear WhatsApp auth (multi-file state) to force fresh QR
import fs from 'fs';
import path from 'path';

const AUTH_DIR = path.resolve('./whatsapp_auth');

try {
  fs.rmSync(AUTH_DIR, { recursive: true, force: true });
  console.log(`[wa-reset] Removed ${AUTH_DIR}`);
  process.exit(0);
} catch (e) {
  console.error('[wa-reset] Failed:', e?.message || String(e));
  process.exit(1);
}
