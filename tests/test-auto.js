/**
 * NotebookLM Automated Pipeline
 * Fully automated - no manual intervention after initial login
 * Saves response to response.txt
 */

import puppeteer from "puppeteer-core";
import fs from "fs";
import readline from "readline";

// ═══════════════════════════════════════════════════════════════
// CONFIGURATION
// ═══════════════════════════════════════════════════════════════
const CONFIG = {
    NOTEBOOK_URL: process.env.NOTEBOOK_URL || "https://notebooklm.google.com",
    CHROME_PROFILE: "./chrome_bot_profile",
    TEST_MESSAGE: "Hey, how was your day?",
    RESPONSE_WAIT_TIME: 20000, // 20 seconds for response
    RESPONSE_FILE: "./response.txt", // Where to save the response
};

// ═══════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════

function findChrome() {
    const paths = [
        "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
        "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
        process.env.LOCALAPPDATA + "\\Google\\Chrome\\Application\\chrome.exe",
    ];
    for (const p of paths) if (fs.existsSync(p)) return p;
    return null;
}

function waitForEnter(prompt) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    return new Promise(resolve => rl.question(prompt, () => { rl.close(); resolve(); }));
}

function log(emoji, message) {
    const time = new Date().toLocaleTimeString();
    console.log(`[${time}] ${emoji} ${message}`);
}

// ═══════════════════════════════════════════════════════════════
// NOTEBOOKLM CLASS
// ═══════════════════════════════════════════════════════════════

class NotebookLM {
    constructor() {
        this.browser = null;
        this.page = null;
        this.lastResponse = null; // Store the last response here
    }

    async init() {
        log("🚀", "Launching Chrome...");
        
        const chromePath = findChrome();
        if (!chromePath) throw new Error("Chrome not found!");
        
        this.browser = await puppeteer.launch({
            executablePath: chromePath,
            headless: false,
            userDataDir: CONFIG.CHROME_PROFILE,
            args: ["--start-maximized", "--disable-blink-features=AutomationControlled"],
            ignoreDefaultArgs: ["--enable-automation"],
            defaultViewport: null,
        });
        
        this.page = await this.browser.newPage();
        await this.page.evaluateOnNewDocument(() => {
            Object.defineProperty(navigator, "webdriver", { get: () => undefined });
        });
        
        log("📓", "Opening NotebookLM...");
        await this.page.goto(CONFIG.NOTEBOOK_URL, { waitUntil: "networkidle2", timeout: 60000 });
        
        log("✅", `Loaded: ${await this.page.title()}`);
        
        // One-time login prompt
        await waitForEnter("\n📓 Log in to NotebookLM if needed, then press Enter to continue...\n");
        
        log("✅", "NotebookLM ready!");
    }

    async sendMessage(message) {
        log("📤", `Sending: "${message}"`);
        
        try {
            await this.page.bringToFront();
            
            // Find chat input using canonical selector
            const inputSelectorCombo = 'textarea[aria-label="Query box"]';
            const chatInput = await this.page.waitForSelector(inputSelectorCombo, { timeout: 10000 });
            if (!chatInput) throw new Error("Chat input not found!");
            
            // Clear and type
            await chatInput.click({ clickCount: 3 });
            await this.page.keyboard.press("Backspace");
            
            const prompt = `Reply as Anandha, matching his style: "${message}"`;
            await this.page.keyboard.type(prompt, { delay: 10 });
            
            // Submit
            await this.page.keyboard.press("Enter");
            log("⏳", "Waiting for response...");
            
            // Wait for response to appear
            await this.waitForResponse();
            
            return this.lastResponse;
            
        } catch (error) {
            log("❌", `Error: ${error.message}`);
            return null;
        }
    }

    async waitForResponse() {
        // Wait initial time for response to start generating
        await new Promise(r => setTimeout(r, 5000));
        
        // Poll for response (check every 2 seconds)
        let attempts = 0;
        const maxAttempts = 10;
        
        while (attempts < maxAttempts) {
            attempts++;
            
            const response = await this.captureResponse();
            
            if (response && response.length > 20) {
                this.lastResponse = response;
                log("✅", `Got response (${response.length} chars)`);
                return;
            }
            
            log("⏳", `Waiting... (attempt ${attempts}/${maxAttempts})`);
            await new Promise(r => setTimeout(r, 2000));
        }
        
        log("⚠️", "No response after max attempts");
    }

    async captureResponse() {
        return await this.page.evaluate(() => {
            // Strategy 1: Look for response in the chat area
            // NotebookLM shows responses in a specific format
            
            // Find all text content containers that appeared after our message
            const selectors = [
                // Response bubbles/cards
                '.response-content',
                '.message-content', 
                '.answer-content',
                '.chat-response',
                // Markdown rendered content
                '[class*="markdown"]',
                '[class*="rendered"]',
                // Generic content areas
                '.source-card-content',
                '.output-content',
            ];
            
            // Try each selector
            for (const sel of selectors) {
                const elements = document.querySelectorAll(sel);
                for (const el of elements) {
                    const text = el.innerText?.trim();
                    if (text && text.length > 30 && !text.includes("Start typing")) {
                        return text;
                    }
                }
            }
            
            // Strategy 2: Find the newest visible text block in the main area
            const mainContent = document.querySelector('main, [role="main"], .main-content');
            if (mainContent) {
                const paragraphs = mainContent.querySelectorAll('p, span, div');
                let longestText = "";
                
                for (const p of paragraphs) {
                    const text = p.innerText?.trim();
                    const rect = p.getBoundingClientRect();
                    
                    // Must be visible and substantial
                    if (text && 
                        text.length > longestText.length && 
                        text.length > 50 &&
                        rect.width > 100 &&
                        !text.includes("Start typing") &&
                        !text.includes("NotebookLM can be inaccurate")) {
                        longestText = text;
                    }
                }
                
                if (longestText) return longestText;
            }
            
            // Strategy 3: Look for any new content that wasn't there before
            const allText = document.body.innerText;
            const lines = allText.split('\n').filter(l => l.trim().length > 50);
            
            // Return the longest line that looks like a response
            const responseLine = lines.find(l => 
                !l.includes("Start typing") && 
                !l.includes("NotebookLM") &&
                !l.includes("Search the web") &&
                l.length > 50
            );
            
            return responseLine || null;
        });
    }

    async close() {
        if (this.browser) await this.browser.close();
    }

    // Save response to file
    saveResponse(response, filename = CONFIG.RESPONSE_FILE) {
        const data = {
            timestamp: new Date().toISOString(),
            message: CONFIG.TEST_MESSAGE,
            response: response,
        };
        
        fs.writeFileSync(filename, JSON.stringify(data, null, 2));
        log("💾", `Response saved to ${filename}`);
    }
}

// ═══════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════

async function main() {
    console.log("\n");
    console.log("╔════════════════════════════════════════════════════════╗");
    console.log("║  NotebookLM Automated Pipeline                         ║");
    console.log("║  Fully automated after initial login                   ║");
    console.log("╚════════════════════════════════════════════════════════╝\n");

    const notebook = new NotebookLM();

    try {
        // Initialize (one-time login)
        await notebook.init();

        // Send test message (fully automated)
        log("🤖", "Starting automated test...");
        const response = await notebook.sendMessage(CONFIG.TEST_MESSAGE);

        // Display and save response
        console.log("\n" + "═".repeat(60));
        console.log("📥 NOTEBOOKLM RESPONSE:");
        console.log("═".repeat(60));
        
        if (response) {
            console.log(`\n${response}\n`);
            
            // Save to file
            notebook.saveResponse(response);
            
            console.log("═".repeat(60));
            console.log("✅ SUCCESS! Response captured and saved to response.txt");
        } else {
            console.log("\n❌ No response captured.");
            console.log("   Check the browser window to see if NotebookLM responded.");
            
            // Take screenshot for debugging
            await notebook.page.screenshot({ path: "debug_screenshot.png", fullPage: true });
            log("📸", "Debug screenshot saved to debug_screenshot.png");
        }
        
        console.log("═".repeat(60) + "\n");

        // Keep browser open for inspection
        await waitForEnter("Press Enter to close browser and exit...\n");

    } catch (error) {
        console.error("\n❌ Error:", error.message);
    } finally {
        await notebook.close();
        log("👋", "Done!");
    }
}

// Run
main();
