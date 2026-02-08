/**
 * NotebookLM Test Script
 * Uses puppeteer-core with a fresh profile - you'll log in manually
 */

import puppeteer from "puppeteer-core";
import fs from "fs";
import path from "path";
import readline from "readline";

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

// NotebookLM notebook URL (set via env or fallback)
const NOTEBOOK_URL = process.env.NOTEBOOK_URL || "https://notebooklm.google.com";

// Test message
const TEST_MESSAGE = "Hey, how was your day?";

// Find Chrome installation
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

async function testNotebookLM() {
    console.log("╔════════════════════════════════════════════════════╗");
    console.log("║  NotebookLM Automation Test                        ║");
    console.log("╚════════════════════════════════════════════════════╝\n");

    const chromePath = findChrome();
    if (!chromePath) {
        console.error("❌ Chrome not found!");
        return;
    }
    console.log(`✅ Found Chrome: ${chromePath}`);

    // Use a separate profile directory for the bot (doesn't conflict with your main Chrome)
    const botProfileDir = path.join(process.cwd(), "chrome_bot_profile");
    console.log(`📁 Using bot profile: ${botProfileDir}`);
    console.log("   (Your login will be saved here for future runs)\n");

    console.log("🚀 Launching Chrome...\n");

    const browser = await puppeteer.launch({
        executablePath: chromePath,
        headless: false,
        userDataDir: botProfileDir,
        args: [
            "--start-maximized",
            "--disable-blink-features=AutomationControlled",
            "--no-first-run",
            "--no-default-browser-check",
        ],
        ignoreDefaultArgs: ["--enable-automation"],
        defaultViewport: null,
    });

    const page = await browser.newPage();

    // Anti-detection measures
    await page.evaluateOnNewDocument(() => {
        Object.defineProperty(navigator, "webdriver", { get: () => undefined });
        window.chrome = { runtime: {} };
    });

    console.log(`📓 Opening: ${NOTEBOOK_URL}\n`);
    await page.goto(NOTEBOOK_URL, { waitUntil: "networkidle2", timeout: 120000 });

    console.log("═".repeat(60));
    console.log("👆 INSTRUCTIONS:");
    console.log("   1. Log in with your Google account");
    console.log("   2. Wait for your notebook to fully load");
    console.log("   3. Make sure you see the chat input at the bottom");
    console.log("═".repeat(60));
    await waitForEnter("\nPress Enter when notebook is fully loaded...\n");

    // Take screenshot
    await page.screenshot({ path: "notebooklm_screenshot.png", fullPage: true });
    console.log("📸 Screenshot saved to notebooklm_screenshot.png\n");

    // Analyze page structure
    console.log("🔍 Analyzing page structure...\n");

    const pageAnalysis = await page.evaluate(() => {
        const result = {
            title: document.title,
            url: window.location.href,
            inputs: [],
            buttons: [],
        };

        // Find all input-like elements
        const inputSelectors = [
            "textarea",
            "input[type='text']",
            "[contenteditable='true']",
            "[role='textbox']",
        ];

        inputSelectors.forEach(sel => {
            document.querySelectorAll(sel).forEach((el, i) => {
                const rect = el.getBoundingClientRect();
                result.inputs.push({
                    selector: sel,
                    index: i,
                    tag: el.tagName,
                    className: el.className?.substring?.(0, 100) || "",
                    id: el.id || "",
                    placeholder: el.placeholder || el.getAttribute("data-placeholder") || "",
                    ariaLabel: el.getAttribute("aria-label") || "",
                    visible: rect.width > 0 && rect.height > 0,
                    position: `x:${Math.round(rect.x)}, y:${Math.round(rect.y)}, w:${Math.round(rect.width)}, h:${Math.round(rect.height)}`,
                });
            });
        });

        // Find submit buttons
        document.querySelectorAll("button").forEach((el, i) => {
            const rect = el.getBoundingClientRect();
            const text = el.textContent?.trim()?.substring(0, 50) || "";
            const ariaLabel = el.getAttribute("aria-label") || "";
            if (text.toLowerCase().includes("send") || 
                ariaLabel.toLowerCase().includes("send") ||
                el.querySelector("svg") ||
                rect.y > 500) {  // Buttons near bottom
                result.buttons.push({
                    index: i,
                    text: text,
                    ariaLabel: ariaLabel,
                    className: el.className?.substring?.(0, 80) || "",
                    visible: rect.width > 0 && rect.height > 0,
                    position: `x:${Math.round(rect.x)}, y:${Math.round(rect.y)}`,
                });
            }
        });

        return result;
    });

    console.log("Page Title:", pageAnalysis.title);
    console.log("Current URL:", pageAnalysis.url);
    console.log("\n📝 INPUT ELEMENTS FOUND:");
    pageAnalysis.inputs.forEach((inp, i) => {
        console.log(`  [${i}] ${inp.tag} - visible: ${inp.visible}`);
        console.log(`      selector: ${inp.selector}`);
        console.log(`      class: ${inp.className}`);
        console.log(`      placeholder: ${inp.placeholder}`);
        console.log(`      aria-label: ${inp.ariaLabel}`);
        console.log(`      position: ${inp.position}`);
        console.log("");
    });

    console.log("🔘 RELEVANT BUTTONS FOUND:");
    pageAnalysis.buttons.forEach((btn, i) => {
        console.log(`  [${i}] "${btn.text}" - aria: "${btn.ariaLabel}" - pos: ${btn.position}`);
    });

    // Save HTML for detailed analysis
    const html = await page.content();
    fs.writeFileSync("notebooklm_page.html", html);
    console.log("\n💾 Full HTML saved to notebooklm_page.html");

    // Try to find and interact with chat input
    const chatInputFound = await page.evaluate(() => {
        // Look for textarea at bottom of page (likely chat input)
        const textareas = Array.from(document.querySelectorAll("textarea"));
        const bottomTextarea = textareas.find(t => {
            const rect = t.getBoundingClientRect();
            return rect.y > 400 && rect.width > 200;  // Near bottom, reasonably wide
        });

        if (bottomTextarea) {
            return {
                found: true,
                tag: bottomTextarea.tagName,
                className: bottomTextarea.className,
                placeholder: bottomTextarea.placeholder,
            };
        }

        // Try contenteditable
        const editables = Array.from(document.querySelectorAll("[contenteditable='true']"));
        const bottomEditable = editables.find(e => {
            const rect = e.getBoundingClientRect();
            return rect.y > 400 && rect.width > 200;
        });

        if (bottomEditable) {
            return {
                found: true,
                tag: bottomEditable.tagName,
                className: bottomEditable.className,
            };
        }

        return { found: false };
    });

    if (chatInputFound.found) {
        console.log("\n✅ Chat input found!");
        console.log(`   Tag: ${chatInputFound.tag}`);
        console.log(`   Class: ${chatInputFound.className}`);

        await waitForEnter("\nPress Enter to try typing a test message...\n");

        try {
            // Use only the canonical selector for NotebookLM input
            const inputSelectorCombo = 'textarea[aria-label="Query box"]';
            const chatInput = await page.$(inputSelectorCombo);
            if (chatInput) {
                await chatInput.click();
                await chatInput.focus();
                await page.keyboard.type(buildPrompt(TEST_MESSAGE), { delay: 30 });
                console.log("✅ Typed test message into chat input!");
                
                // Press Enter to submit
                await waitForEnter("\nPress Enter to SUBMIT the message to NotebookLM...\n");
                await page.keyboard.press("Enter");
                console.log("📤 Message submitted! Waiting for response (20 seconds)...\n");
                
                // Wait for response to generate
                await new Promise(r => setTimeout(r, 20000));
                
                // Capture the response
                console.log("🔍 Capturing response from NotebookLM...\n");
                
                const response = await page.evaluate(() => {
                    // Try multiple selectors to find the response
                    const selectors = [
                        // Look for message containers
                        '[class*="message"]',
                        '[class*="response"]',
                        '[class*="answer"]',
                        '[class*="output"]',
                        '[class*="chat"]',
                        // Markdown content
                        '.markdown',
                        '[class*="markdown"]',
                        // Generic content containers
                        'p',
                    ];
                    
                    const results = [];
                    
                    for (const sel of selectors) {
                        const elements = document.querySelectorAll(sel);
                        elements.forEach((el, i) => {
                            const text = el.textContent?.trim();
                            const rect = el.getBoundingClientRect();
                            // Only include visible elements with content
                            if (text && text.length > 20 && rect.width > 0 && rect.height > 0) {
                                results.push({
                                    selector: sel,
                                    index: i,
                                    text: text.substring(0, 500),
                                    className: el.className?.substring?.(0, 100) || "",
                                    y: Math.round(rect.y),
                                });
                            }
                        });
                    }
                    
                    return results;
                });
                
                console.log("═".repeat(60));
                console.log("📥 CAPTURED RESPONSES FROM NOTEBOOKLM:");
                console.log("═".repeat(60));
                
                if (response.length === 0) {
                    console.log("❌ No response elements found!");
                } else {
                    // Sort by Y position (top to bottom) and show unique texts
                    const seen = new Set();
                    response
                        .sort((a, b) => a.y - b.y)
                        .forEach((r, i) => {
                            if (!seen.has(r.text.substring(0, 100))) {
                                seen.add(r.text.substring(0, 100));
                                console.log(`\n[${i}] Selector: ${r.selector} | Y: ${r.y}`);
                                console.log(`    Class: ${r.className}`);
                                console.log(`    Text: "${r.text}"`);
                            }
                        });
                }
                console.log("\n" + "═".repeat(60));
                
                // Take a screenshot of the response
                await page.screenshot({ path: "notebooklm_response.png", fullPage: true });
                console.log("\n📸 Response screenshot saved to notebooklm_response.png");
                
            } else {
                console.log("❌ Could not find chat input with aria-label='Query box'");
            }
        } catch (err) {
            console.log("❌ Error:", err.message);
        }
    } else {
        console.log("\n⚠️ Could not auto-detect chat input.");
        console.log("   Check the screenshot and HTML file to find the right selector.");
    }

    console.log("\n🔍 Browser stays open for you to inspect.");
    await waitForEnter("Press Enter to close browser and exit...\n");

    await browser.close();
    console.log("👋 Done!");
}

testNotebookLM().catch(console.error);
