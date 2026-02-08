# Your Digital Clone

Your Digital Clone is a WhatsApp bot that automatically replies to messages using Google NotebookLM RAG (Retrieval-Augmented Generation). Upload your chat history or documents to NotebookLM and the bot will reply with responses matching your unique communication style and behavior.

## What It Does

- Listens for incoming WhatsApp messages
- Forwards messages to Google NotebookLM RAG for intelligent response generation
- Generates replies based on uploaded chat history or documents (clones your text style)
- Automatically sends replies back to WhatsApp
- Maintains session state and handles authentication
- Runs 24/7 with PM2 process management

## Tech Stack

- **WhatsApp**: Baileys library (direct connection, no browser needed)
- **Automation**: Puppeteer-core for NotebookLM browser control
- **Runtime**: Node.js (ES Modules)
- **Process Management**: PM2 for daemon operation

## Quick Start

### Prerequisites

- Node.js 16+ 
- Chrome/Chromium browser
- Google Account (for NotebookLM)

### Installation

1. Clone and install dependencies:
```bash
git clone <repo>
cd Clone\ with\ NotebookLLM
npm install
```

2. Configure environment:
```bash
cp config/.env.example .env
```

Edit `.env` and set:
```
GF_PHONE_NUMBER=your_phone_number
NOTEBOOKLM_URL=https://notebooklm.google.com
```

See `docs/ENV.md` for all configuration options.

3. Start the bot:
```bash
npm start
```

On first run, scan the QR code with WhatsApp to authenticate.

## Project Structure

```
src/core/          Main bot logic and automation
tests/             Test and debug scripts
scripts/           Utility scripts (send, reset, CLI)
config/            Configuration and PM2 setup
docs/              Detailed documentation
html/              Debug files and selectors
```

## Usage

### Run Bot
```bash
npm start
```

### Send Test Message
```bash
node scripts/wa-send.js "Your message here"
```

### Reset WhatsApp Session
```bash
node scripts/wa-reset.js
```

### Run with PM2 (Production)
```bash
pm2 start config/pm2.config.js
pm2 save
pm2 startup
```

## Configuration

All configuration via `.env` file:

- `GF_PHONE_NUMBER` - Target WhatsApp number
- `NOTEBOOKLM_URL` - NotebookLM instance URL
- `RESPONSE_MAX_WAIT` - Max wait time for responses (ms)
- `QUICK_SEND` - Enable quick send mode
- `PROMPT_TEMPLATE` - Custom prompt format
- `PERSONA_PIN` - System prompt/persona

See `docs/ENV.md` for complete reference.

## Features

- Atomic session writes for data safety
- Graceful shutdown and error recovery
- Configurable response filtering
- Custom prompt templates and personas
- Multiple targeting modes (phone, JID, LID)
- Session persistence

## Troubleshooting

### Session Errors
Reset the WhatsApp session:
```bash
node scripts/wa-reset.js
```

### NotebookLM Login Issues
Keep the browser visible during first run:
```bash
$env:HEADLESS = '0'; npm start
```

### Partial Replies
The bot filters out placeholder responses. Adjust `RESPONSE_STABLE_MS` in `.env` if needed.

## Documentation

- [Environment Setup](docs/ENV.md) - Detailed configuration guide
- [Full README](docs/README.md) - Comprehensive documentation

## License

See LICENSE file.

## Support

For issues or questions, check the documentation or review test files for usage examples.
