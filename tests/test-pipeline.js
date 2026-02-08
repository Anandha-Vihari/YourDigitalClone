/**
 * NotebookLM Pipeline Test
 * Tests the complete flow: Open → Login → Send Message → Get Response
 */

import puppeteer from "puppeteer-core";
import fs from "fs";
import path from "path";
import readline from "readline";

// ═══════════════════════════════════════════════════════════════
// CONFIGURATION
// ═══════════════════════════════════════════════════════════════
const CONFIG = {
    NOTEBOOK_URL: process.env.NOTEBOOK_URL || "https://notebooklm.google.com",
    CHROME_PROFILE: "./chrome_bot_profile",
    TEST_MESSAGE: "Hey, how was your day?",
    RESPONSE_WAIT_TIME: 25000, // 25 seconds
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
    for (const p of paths) {
        if (fs.existsSync(p)) return p;
    }
    return null;
}

function waitForEnter(prompt) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    return new Promise(resolve => rl.question(prompt, () => { rl.close(); resolve(); }));
}

function log(step, emoji, message) {
    console.log(`[Step ${step}] ${emoji} ${message}`);
}

// ═══════════════════════════════════════════════════════════════
// MAIN TEST
// ═══════════════════════════════════════════════════════════════

async function testNotebookLMPipeline() {
    console.log("\n");
    console.log("╔════════════════════════════════════════════════════════╗");
    console.log("║  NotebookLM Pipeline Test                              ║");
    console.log("╚════════════════════════════════════════════════════════╝\n");

    let browser, page;

    try {
        // ═══════════════════════════════════════════════════════════
        // STEP 1: Launch Chrome
        // ═══════════════════════════════════════════════════════════
        log(1, "🚀", "Launching Chrome...");
        
        const chromePath = findChrome();
        if (!chromePath) throw new Error("Chrome not found!");
        
        browser = await puppeteer.launch({
            executablePath: chromePath,
            headless: false,
            userDataDir: CONFIG.CHROME_PROFILE,
            args: ["--start-maximized", "--disable-blink-features=AutomationControlled"],
            ignoreDefaultArgs: ["--enable-automation"],
            defaultViewport: null,
        });
        
        page = await browser.newPage();
        await page.evaluateOnNewDocument(() => {
            Object.defineProperty(navigator, "webdriver", { get: () => undefined });
        });
        
        log(1, "✅", "Chrome launched!");

        // ═══════════════════════════════════════════════════════════
        // STEP 2: Open NotebookLM
        // ═══════════════════════════════════════════════════════════
        log(2, "📓", "Opening NotebookLM...");
        await page.goto(CONFIG.NOTEBOOK_URL, { waitUntil: "networkidle2", timeout: 60000 });
        
        const title = await page.title();
        log(2, "✅", `Page loaded: "${title}"`);
        
        await waitForEnter("\n👆 Log in to Google if needed, then press Enter...\n");

        // ═══════════════════════════════════════════════════════════
        // STEP 3: Find Chat Input
        // ═══════════════════════════════════════════════════════════
        log(3, "🔍", "Looking for chat input...");
        
        // Wait for the Query box textarea using canonical selector
        const inputSelectorCombo = 'textarea[aria-label="Query box"]';
        const chatInput = await page.waitForSelector(inputSelectorCombo, { timeout: 10000 });
        
        if (!chatInput) {
            throw new Error("Could not find chat input!");
        }
        
        log(3, "✅", "Found chat input (Query box)!");

        // ═══════════════════════════════════════════════════════════
        // STEP 4: Type Message
        // ═══════════════════════════════════════════════════════════
        log(4, "⌨️", "Typing test message...");
        
        await chatInput.click();
        await chatInput.focus();
        
        const prompt = `Reply as Anandha: ${CONFIG.TEST_MESSAGE}`;
        await page.keyboard.type(prompt, { delay: 20 });
        
        log(4, "✅", `Typed: "${prompt}"`);

        // ═══════════════════════════════════════════════════════════
        // STEP 5: Submit Message
        // ═══════════════════════════════════════════════════════════
        await waitForEnter("\n👆 Press Enter to SUBMIT the message...\n");
        
        log(5, "📤", "Submitting message...");
        await page.keyboard.press("Enter");
        
        log(5, "✅", "Message submitted!");

        // ═══════════════════════════════════════════════════════════
        // STEP 6: Wait for Response
        // ═══════════════════════════════════════════════════════════
        log(6, "⏳", `Waiting ${CONFIG.RESPONSE_WAIT_TIME/1000} seconds for response...`);
        
        await new Promise(r => setTimeout(r, CONFIG.RESPONSE_WAIT_TIME));
        
        log(6, "✅", "Wait complete!");

        // ═══════════════════════════════════════════════════════════
        // STEP 7: Capture Response
        // ═══════════════════════════════════════════════════════════
        log(7, "📥", "Capturing response...");
        
        // Take screenshot
        await page.screenshot({ path: "response_screenshot.png", fullPage: true });
        log(7, "📸", "Screenshot saved: response_screenshot.png");
        
        // Try to find response text
        const responseData = await page.evaluate(() => {
            const results = [];
            
            // Look for all text containers
            const allElements = document.querySelectorAll('*');
            
            allElements.forEach(el => {
                const text = el.innerText?.trim();
                const rect = el.getBoundingClientRect();
                const classes = el.className || "";
                
                // Filter: visible, has text, reasonable size
                if (text && 
                    text.length > 30 && 
                    text.length < 2000 &&
                    rect.width > 100 && 
                    rect.height > 20 &&
                    rect.y > 300 && // Below the input area
                    !classes.includes("query") // Not the input
                ) {
                    results.push({
                        tag: el.tagName,
                        classes: classes.substring(0, 80),
                        text: text.substring(0, 300),
                        y: Math.round(rect.y),
                    });
                }
            });
            
            // Sort by position and deduplicate
            const seen = new Set();
            return results
                .sort((a, b) => a.y - b.y)
                .filter(r => {
                    const key = r.text.substring(0, 50);
                    if (seen.has(key)) return false;
                    seen.add(key);
                    return true;
                })
                .slice(0, 10); // Top 10
        });

        // Display results
        console.log("\n" + "═".repeat(60));
        console.log("📥 CAPTURED CONTENT:");
        console.log("═".repeat(60));
        
        if (responseData.length === 0) {
            console.log("\n❌ No response content found!");
            console.log("   Check the screenshot to see what's on the page.");
        } else {
            responseData.forEach((item, i) => {
                console.log(`\n[${i + 1}] <${item.tag}> at Y:${item.y}`);
                console.log(`    Classes: ${item.classes || "(none)"}`);
                console.log(`    Text: "${item.text}..."`);
            });
        }
        
        console.log("\n" + "═".repeat(60));

        // ═══════════════════════════════════════════════════════════
        // STEP 8: Identify Best Response Selector
        // ═══════════════════════════════════════════════════════════
        log(8, "🎯", "Analyzing best response selector...");
        
        // Look for the actual response (usually the newest/last message)
        const bestResponse = await page.evaluate(() => {
            // Strategy 1: Look for markdown content (NotebookLM uses markdown)
            const markdownEls = document.querySelectorAll('[class*="markdown"], [class*="response"], [class*="answer"], [class*="output"]');
            for (const el of markdownEls) {
                const text = el.innerText?.trim();
                if (text && text.length > 20) {
                    return { 
                        found: true, 
                        selector: el.className, 
                        text: text.substring(0, 500) 
                    };
                }
            }
            
            // Strategy 2: Find the last paragraph in the chat area
            const paragraphs = document.querySelectorAll('p');
            for (let i = paragraphs.length - 1; i >= 0; i--) {
                const p = paragraphs[i];
                const rect = p.getBoundingClientRect();
                const text = p.innerText?.trim();
                if (text && text.length > 30 && rect.y > 400) {
                    return { 
                        found: true, 
                        selector: "p (paragraph)", 
                        text: text.substring(0, 500) 
                    };
                }
            }
            
            return { found: false };
        });
        
        if (bestResponse.found) {
            console.log("\n🎯 BEST RESPONSE FOUND:");
            console.log("═".repeat(60));
            console.log(`Selector: ${bestResponse.selector}`);
            console.log(`\nResponse Text:\n"${bestResponse.text}"`);
            console.log("═".repeat(60));
        } else {
            console.log("\n⚠️ Could not auto-detect response.");
            console.log("   Look at the screenshot and captured content above.");
        }

        // Keep browser open
        await waitForEnter("\n👆 Press Enter to close browser and exit...\n");

    } catch (error) {
        console.error("\n❌ ERROR:", error.message);
    } finally {
        if (browser) await browser.close();
        console.log("\n👋 Done!");
    }
}

// Run
testNotebookLMPipeline();
