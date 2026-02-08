/**
 * NotebookLM Automation Module
 * Handles: Send prompt → Wait → Capture response → Return text
 */

import puppeteer from "puppeteer-core";
import fs from "fs";
import readline from "readline";

// ═══════════════════════════════════════════════════════════════
// CONFIGURATION
// ═══════════════════════════════════════════════════════════════
    NOTEBOOK_URL: "https://notebooklm.google.com/notebook/d93d2033-80bc-4237-a6ae-669c80c071b7",
    CHROME_PROFILE: "./chrome_bot_profile",
    RESPONSE_WAIT_TIME: 25000,
};
const CONFIG = {
    NOTEBOOK_URL: process.env.NOTEBOOK_URL || "https://notebooklm.google.com",
    CHROME_PROFILE: process.env.CHROME_PROFILE || "./chrome_bot_profile",
    RESPONSE_WAIT_TIME: parseInt(process.env.RESPONSE_WAIT_TIME || "25000", 10),
};

// Store the last response
let lastResponse = null;

// ═══════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════

function findChrome() {
    const paths = [
        "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
        "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
        process.env.LOCALAPPDATA + "\\Google\\Chrome\\Application\\chrome.exe",
    ];
    for (const p of paths) {
        if (fs.existsSync(p)) return p;
    }
    return null;
}

function waitForEnter(prompt) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    return new Promise(resolve => rl.question(prompt, () => { rl.close(); resolve(); }));
}

// ═══════════════════════════════════════════════════════════════
// MAIN CLASS
// ═══════════════════════════════════════════════════════════════

class NotebookLMBot {
    constructor() {
        this.browser = null;
        this.page = null;
        this.isReady = false;
    }

    async init() {
        console.log("\n🚀 Starting NotebookLM automation...\n");

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
        
        // Anti-detection
        await this.page.evaluateOnNewDocument(() => {
            Object.defineProperty(navigator, "webdriver", { get: () => undefined });
        });

        console.log("📓 Opening NotebookLM...");
        await this.page.goto(CONFIG.NOTEBOOK_URL, { waitUntil: "networkidle2", timeout: 60000 });

        console.log("✅ NotebookLM opened!\n");
        await waitForEnter("👆 Log in if needed, then press Enter to continue...\n");

        this.isReady = true;
        console.log("✅ NotebookLM is ready!\n");
    }

    async sendAndGetResponse(message) {
        if (!this.isReady) {
            console.log("❌ NotebookLM not initialized!");
            return null;
        }

        console.log(`\n📤 Sending: "${message}"`);

        try {
            // Step 1: Find and click the chat input using canonical selector
            const inputSelectorCombo = 'textarea[aria-label="Query box"]';
            const chatInput = await this.page.$(inputSelectorCombo);
            if (!chatInput) {
                console.log("❌ Could not find chat input!");
                return null;
            }

            // Step 2: Clear and type
            await chatInput.click({ clickCount: 3 });
            await this.page.keyboard.press("Backspace");
            
            const prompt = `Reply as Anandha, in his texting style: ${message}`;
            await this.page.keyboard.type(prompt, { delay: 10 });

            // Step 3: Count existing messages BEFORE submitting
            const messageCountBefore = await this.page.evaluate(() => {
                return document.querySelectorAll('[class*="message"], [class*="response"], [class*="answer"], [class*="turn"]').length;
            });

            // Step 4: Submit
            await this.page.keyboard.press("Enter");
            console.log("⏳ Waiting for response...");

            // Step 5: Wait and poll for new response
            let response = null;
            const startTime = Date.now();
            
            while (Date.now() - startTime < CONFIG.RESPONSE_WAIT_TIME) {
                await new Promise(r => setTimeout(r, 2000)); // Check every 2 seconds

                response = await this.page.evaluate((prevCount) => {
                    // Strategy 1: Look for new messages
                    const messages = document.querySelectorAll('[class*="message"], [class*="response"], [class*="answer"], [class*="turn"]');
                    if (messages.length > prevCount) {
                        const lastMsg = messages[messages.length - 1];
                        const text = lastMsg.innerText?.trim();
                        if (text && text.length > 10) {
                            return text;
                        }
                    }

                    // Strategy 2: Look for streaming/typing indicator disappearing
                    const loadingIndicators = document.querySelectorAll('[class*="loading"], [class*="typing"], [class*="pending"]');
                    if (loadingIndicators.length === 0) {
                        // No loading, try to get last response
                        const allText = document.querySelectorAll('p, [class*="content"], [class*="text"]');
                        for (let i = allText.length - 1; i >= 0; i--) {
                            const el = allText[i];
                            const rect = el.getBoundingClientRect();
                            const text = el.innerText?.trim();
                            // Must be below input area and have content
                            if (text && text.length > 20 && rect.y > 400 && !text.includes("Reply as")) {
                                return text;
                            }
                        }
                    }

                    return null;
                }, messageCountBefore);

                if (response) {
                    break;
                }
            }

            // Step 6: Store and return response
            if (response) {
                // Clean up the response
                lastResponse = response
                    .replace(/^.*Reply as Anandha.*?:/i, '') // Remove prompt if echoed
                    .trim();

                console.log(`\n${"═".repeat(50)}`);
                console.log("📥 RESPONSE CAPTURED:");
                console.log("═".repeat(50));
                console.log(lastResponse);
                console.log("═".repeat(50));

                return lastResponse;
            } else {
                console.log("⚠️ No response detected. Taking screenshot...");
                await this.page.screenshot({ path: "debug_screenshot.png", fullPage: true });
                console.log("📸 Screenshot saved: debug_screenshot.png");
                
                // Try one more method - get ALL visible text
                const fallbackResponse = await this.page.evaluate(() => {
                    const body = document.body.innerText;
                    const lines = body.split('\n').filter(l => l.trim().length > 30);
                    return lines.slice(-5).join('\n'); // Last 5 substantial lines
                });
                
                console.log("\n📋 Fallback - Last visible text on page:");
                console.log(fallbackResponse);
                
                return null;
            }

        } catch (error) {
            console.log(`❌ Error: ${error.message}`);
            return null;
        }
    }

    async close() {
        if (this.browser) {
            await this.browser.close();
        }
    }

    getLastResponse() {
        return lastResponse;
    }
}

// ═══════════════════════════════════════════════════════════════
// TEST RUN
// ═══════════════════════════════════════════════════════════════

async function runTest() {
    console.log("╔════════════════════════════════════════════════════════╗");
    console.log("║  NotebookLM Automation Test                            ║");
    console.log("╚════════════════════════════════════════════════════════╝\n");

    const bot = new NotebookLMBot();

    try {
        // Initialize
        await bot.init();

        // Test 1: Send a message
        console.log("\n🧪 TEST 1: Sending test message...\n");
        const response1 = await bot.sendAndGetResponse("Hey, how was your day?");

        if (response1) {
            console.log("✅ TEST 1 PASSED - Response captured!\n");
            console.log("📱 This response would be sent to WhatsApp:\n");
            console.log(`"${response1}"\n`);
        } else {
            console.log("❌ TEST 1 FAILED - No response captured\n");
        }

        // Wait before next test
        await waitForEnter("Press Enter to run another test, or Ctrl+C to exit...\n");

        // Test 2: Another message
        console.log("\n🧪 TEST 2: Sending another message...\n");
        const response2 = await bot.sendAndGetResponse("I miss you");

        if (response2) {
            console.log("✅ TEST 2 PASSED - Response captured!\n");
        } else {
            console.log("❌ TEST 2 FAILED - No response captured\n");
        }

        await waitForEnter("\nPress Enter to close...\n");

    } catch (error) {
        console.error("❌ Error:", error.message);
    } finally {
        await bot.close();
        console.log("👋 Done!");
    }
}

// Export for use in main bot
export { NotebookLMBot, CONFIG };

// Run if called directly
runTest();
