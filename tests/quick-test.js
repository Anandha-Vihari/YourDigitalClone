/**
 * Quick Test: Send "hi wyd" to NotebookLM and capture response
 */

import puppeteer from "puppeteer-core";
import fs from "fs";
import readline from "readline";

const CONFIG = {
    NOTEBOOK_URL: process.env.NOTEBOOK_URL || "https://notebooklm.google.com",
    CHROME_PROFILE: "./chrome_bot_profile",
    TEST_MESSAGE: "hi wyd",
    WAIT_TIME: 60000, // 60 seconds - much longer wait
};

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
    return new Promise(r => rl.question(prompt, () => { rl.close(); r(); }));
}

async function test() {
    console.log("\n╔════════════════════════════════════════════════════════╗");
    console.log("║  NotebookLM Test: \"hi wyd\"                             ║");
    console.log("╚════════════════════════════════════════════════════════╝\n");

    const browser = await puppeteer.launch({
        executablePath: findChrome(),
        headless: false,
        userDataDir: CONFIG.CHROME_PROFILE,
        args: ["--start-maximized", "--disable-blink-features=AutomationControlled"],
        ignoreDefaultArgs: ["--enable-automation"],
        defaultViewport: null,
    });

    const page = await browser.newPage();
    await page.goto(CONFIG.NOTEBOOK_URL, { waitUntil: "networkidle2", timeout: 60000 });

    console.log("✅ NotebookLM opened!\n");
    await waitForEnter("👆 Log in if needed, then press Enter...\n");

    // Find chat input
    const inputSelectorCombo = 'textarea[aria-label="Query box"]';
    const chatInput = await page.$(inputSelectorCombo);
    if (!chatInput) {
        console.log("❌ Chat input not found!");
        await browser.close();
        return;
    }

    // Count messages before
    const countBefore = await page.evaluate(() => {
        return document.querySelectorAll('chat-message').length;
    });
    console.log(`📊 Messages before: ${countBefore}`);

    // Type and send
    console.log(`\n📤 Sending: "Reply as Anandha: ${CONFIG.TEST_MESSAGE}"\n`);
    await chatInput.click({ clickCount: 3 });
    await page.keyboard.press("Backspace");
    await page.keyboard.type(`Reply as Anandha, in his texting style: ${CONFIG.TEST_MESSAGE}`, { delay: 10 });
    await page.keyboard.press("Enter");

    // Wait and poll for response
    console.log(`⏳ Waiting up to ${CONFIG.WAIT_TIME/1000} seconds for response...\n`);
    
    let response = null;
    const startTime = Date.now();

    while (Date.now() - startTime < CONFIG.WAIT_TIME) {
        await new Promise(r => setTimeout(r, 2000));
        
        const countNow = await page.evaluate(() => {
            return document.querySelectorAll('chat-message').length;
        });
        
        console.log(`   Checking... (${countNow} messages)`);

        if (countNow > countBefore) {
            // New message appeared! Get it
            response = await page.evaluate(() => {
                const messages = document.querySelectorAll('chat-message');
                const lastMessage = messages[messages.length - 1];
                
                // Try .message-text-content first
                const textEl = lastMessage.querySelector('.message-text-content');
                if (textEl) return textEl.innerText?.trim();
                
                // Fallback to mat-card-content
                const cardEl = lastMessage.querySelector('mat-card-content');
                if (cardEl) return cardEl.innerText?.trim();
                
                return lastMessage.innerText?.trim();
            });
            
            if (response) break;
        }
    }

    // Display result
    console.log("\n" + "═".repeat(60));
    
    if (response) {
        console.log("✅ RESPONSE CAPTURED:");
        console.log("═".repeat(60));
        console.log(`\n${response}\n`);
        console.log("═".repeat(60));
        
        // Save to file
        // Direct print only; do not save to file
        
        console.log("\n📱 This would be sent to WhatsApp!");
    } else {
        console.log("⚠️ Auto-capture failed. Let me try manual capture...");
        console.log("═".repeat(60));
        
        // Wait for user to confirm response is visible
        await waitForEnter("\n👆 Wait for NotebookLM to respond, then press Enter...\n");
        
        // Try to capture now
        response = await page.evaluate(() => {
            const messages = document.querySelectorAll('chat-message');
            if (messages.length === 0) return null;
            
            const lastMessage = messages[messages.length - 1];
            const textEl = lastMessage.querySelector('.message-text-content');
            if (textEl) return textEl.innerText?.trim();
            
            const cardEl = lastMessage.querySelector('mat-card-content');
            if (cardEl) return cardEl.innerText?.trim();
            
            return lastMessage.innerText?.trim();
        });
        
        if (response) {
            console.log("\n✅ RESPONSE CAPTURED (manual):");
            console.log("═".repeat(60));
            console.log(`\n${response}\n`);
            console.log("═".repeat(60));
            // Direct print only; do not save to file
        } else {
            console.log("❌ Still no response found");
            await page.screenshot({ path: "debug.png" });
            console.log("📸 Screenshot saved: debug.png");
        }
    }

    await waitForEnter("\nPress Enter to close...\n");
    await browser.close();
}

test().catch(console.error);
