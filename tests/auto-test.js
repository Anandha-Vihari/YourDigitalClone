/**
 * NotebookLM Auto Test - Simplified v5
 * Uses synchronous-style operations with explicit waits
 */

import puppeteer from "puppeteer-core";
import fs from "fs";

const NOTEBOOK_URL = process.env.NOTEBOOK_URL || "https://notebooklm.google.com";
const TEST_MESSAGE = "hi wyd";
const HEADLESS = (() => {
    const v = (process.env.HEADLESS || "").toString().toLowerCase();
    // Default to headless ON; allow disabling via 0/false/no
    if (v === "0" || v === "false" || v === "no") return false;
    return true;
})();

function timeMeta() {
    const now = new Date();
    const weekday = now.toLocaleString(undefined, { weekday: "long" });
    const date = now.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "2-digit" });
    const time = now.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
    const hour = now.getHours();
    const partOfDay = hour < 5 ? "late night" : hour < 12 ? "morning" : hour < 17 ? "afternoon" : hour < 21 ? "evening" : "night";
    let tz = "local";
    try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || tz; } catch {}
    return { weekday, date, time, tz, partOfDay };
}

function buildPrompt(msg) {
    const t = timeMeta();
    return [
        `You are Anandha replying to his girlfriend via chat. Use only facts, nicknames, and inside jokes from the uploaded WhatsApp chat export in this notebook. If it’s not in the chats, keep it generic.`,
        `Context: { now: ${t.date} ${t.time} (${t.tz}), weekday: ${t.weekday}, part_of_day: ${t.partOfDay} }`,
        `Style: one short affectionate line, lowercase, casual. No names, quotes, prefaces, citations, or markdown. No ellipses ('...'). 10–20 words.`,
        `Reply only with the final message text.`,
        `Message: ${msg}`
    ].join("\n");
}

function findChrome() {
    const paths = [
        "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
        "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
        process.env.LOCALAPPDATA + "\\Google\\Chrome\\Application\\chrome.exe",
    ];
    for (const p of paths) {
        if (fs.existsSync(p)) return p;
    }
    throw new Error("Chrome not found!");
}

function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
}

function log(msg) {
    console.log(`[${new Date().toLocaleTimeString()}] ${msg}`);
}

async function main() {
    console.log("=== NotebookLM Auto Test v5 ===\n");
    
    const chromePath = findChrome();
    log(`Chrome: ${chromePath}`);
    
    log(`Launching browser${HEADLESS ? " (headless)" : ""}...`);
    const browser = await puppeteer.launch({
        executablePath: chromePath,
        headless: HEADLESS,
        userDataDir: "./chrome_bot_profile",
        args: [
            "--no-first-run",
            "--no-default-browser-check",
            "--disable-blink-features=AutomationControlled",
            "--disable-gpu",
            "--window-size=1366,768"
        ],
        ignoreDefaultArgs: ["--enable-automation"],
        defaultViewport: HEADLESS ? { width: 1366, height: 768 } : null,
    });

    try {
        const page = (await browser.pages())[0];
        
        log("Opening NotebookLM...");
        await page.goto(NOTEBOOK_URL, { waitUntil: "domcontentloaded", timeout: 180000 });
        
        // Ensure the app UI is present (handles cases where network never idles)
        try {
            await page.waitForSelector('textarea[aria-label="Query box"]', { timeout: 60000 });
        } catch (e) {
            log("ERROR: NotebookLM input not detected. Are you logged in?");
            await page.screenshot({ path: "error_no_query_box.png", fullPage: true });
            throw e;
        }
        
        log("Page loaded. Waiting 5s for final render...");
        await sleep(5000);
        
        log("Looking for input field...");
        const inputSelector = 'textarea[aria-label="Query box"]';
        
        try {
            await page.waitForSelector(inputSelector, { timeout: 20000 });
        } catch (e) {
            log("ERROR: Input field not found!");
            await page.screenshot({ path: "error_no_input.png" });
            throw e;
        }
        
        log("Input field found!");
        
        // Count messages before
        const beforeCount = await page.$$eval('chat-message', els => els.length);
        log(`Messages before: ${beforeCount}`);
        
        // Type and send
        const prompt = buildPrompt(TEST_MESSAGE);
        log(`Typing: "${prompt}"`);
        
        await page.click(inputSelector);
        await sleep(500);
        await page.keyboard.type(prompt, { delay: 15 });
        await sleep(500);
        await page.keyboard.press('Enter');
        
        log("Message sent! Waiting for response...");
        await page.screenshot({ path: "after_send.png" });
        
        // Poll for response
        let response = null;
        for (let i = 0; i < 60; i++) { // 60 attempts * 2s = 2 minutes max
            await sleep(2000);
            
            const result = await page.evaluate((prevCount) => {
                const msgs = document.querySelectorAll('chat-message');
                if (msgs.length <= prevCount) {
                    return { newCount: msgs.length, text: null };
                }
                
                // Get last message text
                const last = msgs[msgs.length - 1];
                const textEl = last.querySelector('.message-text-content');
                const text = textEl ? textEl.innerText.trim() : '';
                
                return { newCount: msgs.length, text };
            }, beforeCount);
            
            if (result.text) {
                const isLoading = result.text.length < 40 || 
                                  result.text.includes('...') ||
                                  result.text.toLowerCase().includes('parsing') ||
                                  result.text.toLowerCase().includes('retrieving') ||
                                  result.text.toLowerCase().includes('analyzing');
                
                log(`[${i+1}] ${isLoading ? 'Loading:' : 'Response:'} ${result.text.substring(0, 60)}...`);
                
                if (!isLoading) {
                    response = result.text;
                    break;
                }
            } else {
                log(`[${i+1}] Waiting... (${result.newCount} messages)`);
            }
        }
        
        console.log("\n" + "=".repeat(50));
        if (response) {
            log("SUCCESS! Response captured:");
            console.log("=".repeat(50));
            console.log(response);
            console.log("=".repeat(50));
            // Direct print only; do not save to file
        } else {
            log("FAILED - No response captured");
            await page.screenshot({ path: "failed_final.png" });
        }
        
        log("Keeping browser open for 5s...");
        await sleep(5000);
        
    } finally {
        log("Closing browser...");
        await browser.close();
        log("Done!");
    }
}

main().catch(err => {
    console.error("FATAL ERROR:", err);
    process.exit(1);
});
