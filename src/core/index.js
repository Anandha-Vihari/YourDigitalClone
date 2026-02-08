/**
 * WhatsApp to Google NotebookLM Automation Bot
 * Uses @whiskeysockets/baileys for WhatsApp and Puppeteer for NotebookLM browser automation
 */

import makeWASocket, {
    DisconnectReason,
    useMultiFileAuthState,
} from "@whiskeysockets/baileys";
import qrcode from "qrcode-terminal";
import puppeteer from "puppeteer";
import pino from "pino";

// ========================
// CONFIGURATION
// ========================
const CONFIG = {
    // Load from environment variables
    GF_PHONE_NUMBER: process.env.GF_PHONE_NUMBER || null,
    NOTEBOOKLM_URL: process.env.NOTEBOOKLM_URL || "https://notebooklm.google.com",
    RESPONSE_WAIT_TIME: parseInt(process.env.RESPONSE_WAIT_TIME || "30000"),
    AUTH_FOLDER: process.env.AUTH_FOLDER || "./auth_info",
    CHROME_USER_DATA: process.env.CHROME_USER_DATA || "./chrome_user_data",
};

// Logger setup
const logger = pino({ level: "info" });

// Global state
let browser = null;
let notebookPage = null;

/**
 * Initialize Puppeteer browser for NotebookLM
 */
async function initNotebookLM() {
    console.log("🚀 Launching browser for NotebookLM...");
    
    browser = await puppeteer.launch({
        headless: false, // Keep visible for login
        userDataDir: CONFIG.CHROME_USER_DATA,
        args: ["--start-maximized", "--disable-notifications"],
    });

    notebookPage = await browser.newPage();
    await notebookPage.setViewport({ width: 1280, height: 800 });
    await notebookPage.goto(CONFIG.NOTEBOOKLM_URL, { waitUntil: "networkidle2" });

    console.log("📓 NotebookLM opened. Please log in and open your notebook if needed.");
    console.log("   Press Enter in the terminal when ready...");
    
    await waitForEnter();
    console.log("✅ NotebookLM is ready!");
}

/**
 * Wait for user to press Enter
 */
function waitForEnter() {
    return new Promise((resolve) => {
        process.stdin.once("data", () => resolve());
    });
}

/**
 * Send a prompt to NotebookLM and get the response
 */
async function getNotebookLMResponse(message) {
    if (!notebookPage) {
        console.error("❌ NotebookLM page not initialized");
        return null;
    }

    try {
        // Bring NotebookLM tab to focus
        await notebookPage.bringToFront();

        // Use the correct selector: "Query box" textarea (the chat input at bottom)
        const chatInputSelector = 'textarea[aria-label="Query box"]';

        let inputField = null;
        try {
            inputField = await notebookPage.waitForSelector(chatInputSelector, { timeout: 10000 });
        } catch {
            console.error("❌ Could not find NotebookLM chat input (Query box)");
            return null;
        }

        if (!inputField) {
            console.error("❌ Could not find NotebookLM input field");
            return null;
        }

        // Click and type the styled prompt
        await inputField.click();
        await inputField.focus();
        const styledPrompt = `Reply to this message as Anandha, matching his style and tone from the chat history: "${message}"`;
        await notebookPage.keyboard.type(styledPrompt, { delay: 10 });
        
        // Submit (Enter key)
        await notebookPage.keyboard.press("Enter");
        console.log("📤 Prompt sent to NotebookLM");

        // Wait for response to generate
        await new Promise((resolve) => setTimeout(resolve, CONFIG.RESPONSE_WAIT_TIME));

        // Get the latest response from the chat
        // NotebookLM responses appear in message bubbles - look for the last one
        const responseSelectors = [
            '.message-content',
            '.response-content', 
            '.chat-message-content',
            '[data-testid="response"]',
            '.markdown-content',
            '.output-text',
        ];

        let responseText = null;
        
        // Try to get response from the page
        try {
            responseText = await notebookPage.evaluate(() => {
                // Look for message bubbles/responses in the chat area
                const messages = document.querySelectorAll('[class*="message"], [class*="response"], [class*="answer"]');
                if (messages.length > 0) {
                    const lastMessage = messages[messages.length - 1];
                    return lastMessage.textContent?.trim();
                }
                return null;
            });
        } catch (e) {
            console.error("Error getting response:", e.message);
        }

        if (!responseText) {
            // Fallback: try specific selectors
            for (const selector of responseSelectors) {
                try {
                    const elements = await notebookPage.$$(selector);
                    if (elements.length > 0) {
                        responseText = await elements[elements.length - 1].evaluate(el => el.textContent);
                        if (responseText && responseText.trim()) break;
                    }
                } catch {
                    continue;
                }
            }
        }

        if (responseText) {
            console.log(`📥 NotebookLM response: ${responseText.substring(0, 50)}...`);
            return responseText.trim();
        }

        console.warn("⚠️ No response found from NotebookLM");
        return null;

    } catch (error) {
        console.error("❌ Error getting NotebookLM response:", error.message);
        return null;
    }
}

/**
 * Initialize WhatsApp connection using Baileys
 */
async function initWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState(CONFIG.AUTH_FOLDER);

    const sock = makeWASocket({
        auth: state,
        printQRInTerminal: false,
        logger: pino({ level: "silent" }),
    });

    // Handle connection updates
    sock.ev.on("connection.update", async (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
            console.log("\n📱 Scan this QR code with WhatsApp:\n");
            qrcode.generate(qr, { small: true });
        }

        if (connection === "close") {
            const shouldReconnect =
                lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
            
            console.log("Connection closed. Reconnecting:", shouldReconnect);
            
            if (shouldReconnect) {
                initWhatsApp();
            }
        } else if (connection === "open") {
            console.log("✅ WhatsApp connected successfully!");
        }
    });

    // Save credentials on update
    sock.ev.on("creds.update", saveCreds);

    // Handle incoming messages
    sock.ev.on("messages.upsert", async (m) => {
        const message = m.messages[0];
        
        // Ignore if not a new message or if it's from self
        if (!message.message || message.key.fromMe) return;
        
        // Get sender's number (remove @s.whatsapp.net)
        const senderNumber = message.key.remoteJid?.replace("@s.whatsapp.net", "");
        
        // Only respond to girlfriend's messages
        if (senderNumber !== CONFIG.GF_PHONE_NUMBER) {
            console.log(`📨 Message from ${senderNumber} (not girlfriend, ignoring)`);
            return;
        }

        // Extract message text
        const messageText =
            message.message.conversation ||
            message.message.extendedTextMessage?.text ||
            "";

        if (!messageText) {
            console.log("📨 Non-text message received, ignoring");
            return;
        }

        console.log(`\n💬 New message from girlfriend: "${messageText}"`);

        // Get response from NotebookLM
        const response = await getNotebookLMResponse(messageText);

        if (response) {
            // Send response back to WhatsApp
            await sock.sendMessage(message.key.remoteJid, { text: response });
            console.log(`✅ Reply sent: "${response.substring(0, 50)}..."`);
        } else {
            console.log("⚠️ Could not get response from NotebookLM");
        }
    });

    return sock;
}

/**
 * Main entry point
 */
async function main() {
    console.log("╔════════════════════════════════════════════════════╗");
    console.log("║  WhatsApp + NotebookLM Automation Bot              ║");
    console.log("║  Mimicking Anandha's style                         ║");
    console.log("╚════════════════════════════════════════════════════╝\n");

    // Initialize NotebookLM browser first
    await initNotebookLM();

    // Initialize WhatsApp
    console.log("\n📱 Initializing WhatsApp...");
    await initWhatsApp();

    console.log("\n🤖 Bot is now running!");
    console.log(`   Monitoring messages from: ${CONFIG.GF_PHONE_NUMBER}`);
    console.log("   Press Ctrl+C to stop.\n");
}

// Handle graceful shutdown
process.on("SIGINT", async () => {
    console.log("\n👋 Shutting down...");
    if (browser) await browser.close();
    process.exit(0);
});

// Start the bot
main().catch(console.error);
