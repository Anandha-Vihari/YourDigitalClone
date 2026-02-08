/**
 * NotebookLM Response Finder
 * Finds the exact selector for NotebookLM responses
 */

import puppeteer from "puppeteer-core";
import fs from "fs";
import readline from "readline";

    NOTEBOOK_URL: "https://notebooklm.google.com/notebook/d93d2033-80bc-4237-a6ae-669c80c071b7",
    CHROME_PROFILE: "./chrome_bot_profile",
};
const CONFIG = {
    NOTEBOOK_URL: process.env.NOTEBOOK_URL || "https://notebooklm.google.com",
    CHROME_PROFILE: process.env.CHROME_PROFILE || "./chrome_bot_profile",
};

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

async function findResponseSelector() {
    console.log("\n╔════════════════════════════════════════════════════════╗");
    console.log("║  NotebookLM Response Finder                            ║");
    console.log("╚════════════════════════════════════════════════════════╝\n");

    const chromePath = findChrome();
    const browser = await puppeteer.launch({
        executablePath: chromePath,
        headless: false,
        userDataDir: CONFIG.CHROME_PROFILE,
        args: ["--start-maximized", "--disable-blink-features=AutomationControlled"],
        ignoreDefaultArgs: ["--enable-automation"],
        defaultViewport: null,
    });

    const page = await browser.newPage();
    await page.goto(CONFIG.NOTEBOOK_URL, { waitUntil: "networkidle2", timeout: 60000 });

    await waitForEnter("👆 Make sure NotebookLM has a response visible, then press Enter...\n");

    console.log("🔍 Searching for the response text...\n");

    // Search for the known response text
    const searchText = "missing u too";
    
    const found = await page.evaluate((searchText) => {
        const results = [];
        
        // Walk through ALL elements
        const walker = document.createTreeWalker(
            document.body,
            NodeFilter.SHOW_ELEMENT,
            null,
            false
        );

        let node;
        while (node = walker.nextNode()) {
            const text = node.innerText || node.textContent || "";
            
            if (text.toLowerCase().includes(searchText.toLowerCase())) {
                const rect = node.getBoundingClientRect();
                
                // Get the most specific selector
                let selector = node.tagName.toLowerCase();
                if (node.id) selector += `#${node.id}`;
                if (node.className && typeof node.className === 'string') {
                    selector += '.' + node.className.split(' ').slice(0, 3).join('.');
                }
                
                results.push({
                    tag: node.tagName,
                    id: node.id || "",
                    className: node.className?.toString?.()?.substring(0, 150) || "",
                    selector: selector.substring(0, 100),
                    textLength: text.length,
                    textPreview: text.substring(0, 200),
                    rect: { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width), h: Math.round(rect.height) },
                    childCount: node.children.length,
                });
            }
        }
        
        return results;
    }, searchText);

    console.log(`Found ${found.length} elements containing "${searchText}":\n`);
    console.log("═".repeat(70));

    // Sort by specificity (fewer children = more specific)
    found.sort((a, b) => a.childCount - b.childCount);

    found.forEach((el, i) => {
        console.log(`\n[${i + 1}] <${el.tag}> (${el.childCount} children)`);
        console.log(`    ID: ${el.id || "(none)"}`);
        console.log(`    Class: ${el.className || "(none)"}`);
        console.log(`    Position: x:${el.rect.x}, y:${el.rect.y}, ${el.rect.w}x${el.rect.h}`);
        console.log(`    Text (${el.textLength} chars): "${el.textPreview}..."`);
    });

    console.log("\n" + "═".repeat(70));

    // Find the BEST selector (most specific element containing the response)
    if (found.length > 0) {
        const best = found[0]; // Fewest children = most specific
        console.log("\n🎯 BEST SELECTOR FOUND:");
        console.log(`   Tag: ${best.tag}`);
        console.log(`   Class: ${best.className}`);
        
        // Save to file
        fs.writeFileSync("found_selectors.json", JSON.stringify(found, null, 2));
        console.log("\n💾 All selectors saved to: found_selectors.json");
    }

    // Also get the HTML structure around the response
    const html = await page.evaluate((searchText) => {
        const els = document.querySelectorAll('*');
        for (const el of els) {
            if (el.innerText?.includes(searchText) && el.children.length < 3) {
                return el.outerHTML.substring(0, 1000);
            }
        }
        return null;
    }, searchText);

    if (html) {
        console.log("\n📋 HTML Structure of response element:");
        console.log("═".repeat(70));
        console.log(html);
        console.log("═".repeat(70));
        
        fs.writeFileSync("response_element.html", html);
        console.log("\n💾 HTML saved to: response_element.html");
    }

    await waitForEnter("\nPress Enter to close...\n");
    await browser.close();
}

findResponseSelector().catch(console.error);
