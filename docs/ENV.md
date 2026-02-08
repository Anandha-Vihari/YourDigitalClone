# .env Configuration for WhatsApp + NotebookLM Bot

This file documents the environment variables you can set in `.env` (or your shell) to control `bot.js` behavior. Copy `.env.example` to `.env` and edit values.

Notes
- Shell environment variables override values in `.env`.
- Do NOT commit your `.env` containing secrets or session directories.

Sections
- NotebookLM
- Puppeteer / Browser
- WhatsApp targeting
- Behavior
- Debugging

---

## NotebookLM
- `NOTEBOOK_URL` (string)
  - Default: `https://notebooklm.google.com`
  - The NotebookLM notebook URL the bot opens to send prompts and read responses. Set your specific notebook in your .env if needed.

## Puppeteer / Browser
- `HEADLESS` (0/1)
  - Default: `1`
  - When `0`, Puppeteer runs with a visible browser window (use this to sign into Google). When `1`, runs headless.
- `CHROME_PROFILE` (path)
  - Default: `./chrome_bot_profile`
  - Path to Chromium/Chrome user data dir used by Puppeteer to persist login/session state.

## WhatsApp targeting
- `TARGET_LID` (string)
  - Default: `240492533043434@lid`
  - The explicit LID to reply to. If set, the bot will only reply to messages from this LID (unless `REPLY_ALL=1`).
- `TARGET_JID` (string)
  - Default: (empty)
  - Alternative explicit JID to target (e.g., `919xxxx@s.whatsapp.net` or `group@g.us`). Takes precedence over phone if set.
- `GF_PHONE_NUMBER` (string)
  - Default: (empty)
  - Phone number (country code + number) of the target contact. Used when `TARGET_LID`/`TARGET_JID` aren't set.
- `REPLY_ALL` (0/1)
  - Default: `0`
  - If `1`, the bot will reply to all incoming messages (use with caution).
- `WA_ONLY` (0/1)
  - Default: `0`
  - If `1`, the bot only runs WhatsApp login/QR flow and skips NotebookLM interactions.

## Behavior
- `MANUAL_SEND` (0/1)
  - Default: `0`
  - If `1`, after the bot generates a response it prompts on the terminal to `Send`, `Edit`, or `Discard`.
- `QUICK_SEND` (0/1)
  - Default: `1`
  - If `1`, the bot will send the first non-loading chunk from NotebookLM as soon as it appears (lower latency). If `0`, it waits for a stable final response.
- `QUICK_SEND_MAX_MS` (integer ms)
  - Default: `5000`
  - Maximum time to wait for the first non-loading chunk when `QUICK_SEND=1`. If no chunk appears, the bot falls back to empty/normal wait.
- `RESPONSE_MAX_WAIT` (integer ms)
  - Default: `120000`
  - Maximum time to wait for a NotebookLM response before giving up.
- `RESPONSE_STABLE_MS` (integer ms)
  - Default: `2500`
  - When not using quick-send, content must remain unchanged for this many milliseconds to be considered "stable" and final.

## Debugging / Logging
- `DEBUG` (0/1)
  - Default: `0`
  - Enables extra debug logs printed to console.
- `LLM_LOG` (0/1)
  - Default: `1`
  - Enables additional logging specifically for LLM/NotebookLM events.

## Examples
Sign in headful (open browser so you can log into Google):

```powershell
$env:HEADLESS=0; node bot.js
```

Run headless after signing in:

```powershell
$env:HEADLESS=1; node bot.js
```

Use `.env` to set defaults (create `.env` from `.env.example`):

```powershell
copy .env.example .env
notepad .env
```

Edit values then run `node bot.js` normally.

## Security & Notes
- Keep `CHROME_PROFILE` private; it contains your browser session and cookies. Back it up only if you trust the storage medium.
- If you change `NOTEBOOK_URL`, ensure the profile is logged into the corresponding Google account or run with `HEADLESS=0` to sign in interactively.
- If replies still appear slow, try reducing `QUICK_SEND_MAX_MS` or disabling `RESPONSE_STABLE_MS` for more aggressive quick-sends, but this may increase partial/incomplete replies.

---

If you want, I can also add a startup check that prints the effective configuration (values read from `.env` and env) and warns if required fields are missing. Would you like that?