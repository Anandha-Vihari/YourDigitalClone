# WhatsApp + NotebookLM Automation Bot

Automatically replies to WhatsApp messages using Google NotebookLM as the AI backend. The bot mimics "Anandha's" style based on chat history uploaded to NotebookLM.

## How It Works

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   WhatsApp      │     │    Your Bot     │     │  NotebookLM     │
│   (Baileys)     │────▶│   (Node.js)     │────▶│  (Chrome)       │
│                 │◀────│                 │◀────│                 │
└─────────────────┘     └─────────────────┘     └─────────────────┘
     Messages              Automation            AI Responses
```

1. **WhatsApp** - Connects directly via Baileys (no browser needed)
2. **Bot** - Receives messages, forwards to NotebookLM
3. **NotebookLM** - Generates responses using your uploaded chat history
4. **Bot** - Sends response back to WhatsApp

## Setup

### 1. Install Dependencies
```bash
npm install
```

### 2. Configure the Bot
Create a `.env` file in the root directory and set your configuration:
```env
GF_PHONE_NUMBER=your_phone_number
NOTEBOOKLM_URL=https://notebooklm.google.com
RESPONSE_WAIT_TIME=30000
```

See `config/.env.example` for all available options.

### 3. Run the Bot
```bash
npm start
```

Headless is the default (no Chrome window). To force headful (show Chrome):
- PowerShell:
```powershell
$env:HEADLESS = '0'; npm start
```
- Command Prompt:
```bat
set HEADLESS=0&& npm start
```

## Project Structure

```
.
├── src/
│   └── core/
│       ├── bot.js              # Main bot logic
│       ├── index.js            # Alternative entry point
│       ├── notebooklm.js       # NotebookLM automation
│       └── whatsapp-bot.js     # WhatsApp bot minimal version
├── tests/                       # Test files
│   ├── test-notebooklm.js
│   ├── test-auto.js
│   ├── test-pipeline.js
│   ├── auto-test.js
│   └── quick-test.js
├── scripts/                     # Utility scripts
│   ├── wa-send.js              # Send WhatsApp message
│   ├── wa-reset.js             # Reset WhatsApp session
│   ├── cli-notebooklm.js       # NotebookLM CLI
│   └── find-selector.js        # DOM selector finder
├── config/                      # Configuration files
│   ├── .env.example            # Environment variables template
│   ├── pm2.config.js           # PM2 configuration
│   └── pm2.config.cjs          # PM2 config (CommonJS)
├── docs/                        # Documentation
│   ├── README.md               # This file
│   └── ENV.md                  # Environment setup guide
├── html/                        # Debug/helper HTML files
├── package.json
├── package-lock.json
└── .github/                     # GitHub configuration
```

### 4. First-Time Setup
1. **WhatsApp QR** - Scan the QR code shown in terminal with your phone (auth persists in `whatsapp_auth/`).
2. **NotebookLM Login** - If running for the first time, sign in to Google once in headful mode (`HEADLESS=0`). The session persists in `chrome_bot_profile/`. After that, headless runs will work.

## Files

| File | Description |
|------|-------------|
| `bot.js` | Main bot script |
| `test-notebooklm.js` | Test script for NotebookLM automation |
| `whatsapp_auth/` | WhatsApp session (created on first run) |
| `chrome_bot_profile/` | Chrome profile with NotebookLM login |

## Commands

```bash
npm start    # Run the full bot
npm test     # Test NotebookLM automation only
```

## Troubleshooting

| Issue | Solution |
|-------|----------|
| QR code not working | Delete `whatsapp_auth/` folder and restart |
| NotebookLM not responding | Check CSS selectors in `bot.js` |
| Chrome profile conflict | Close all Chrome windows before starting |
| Not logged in to Google | Bot will log: "Chat input not found". Log in once in the opened Chrome window, then restart the bot. |
| Headless can’t find input | Log in once with `HEADLESS=0`, then run headless afterwards. |

## Notes

- Keep the Chrome window open (it handles NotebookLM)
- Your WhatsApp session persists in `whatsapp_auth/`
- Your Google login persists in `chrome_bot_profile/`

## Selectors Used (NotebookLM)

- Input: `textarea[aria-label="Query box"]`
- Output: Last `chat-message` element’s `.message-text-content` (fallback: `mat-card-content`)

The bot waits for a new `chat-message`, then monitors its text until it stops changing for ~2.5s and does not look like a loading placeholder (e.g., "Analyzing...", "Retrieving...").
