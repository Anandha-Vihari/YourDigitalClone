/**
 * WhatsApp + NotebookLM Bot (Automated)
 *
 * Selectors used (confirmed):
 * - Input: textarea[aria-label="Query box"]
 * - Response: chat-message > .message-text-content (fallback: mat-card-content)
 */

import makeWASocket, { DisconnectReason, useMultiFileAuthState, fetchLatestBaileysVersion } from "@whiskeysockets/baileys";
import writeFileAtomic from "write-file-atomic";
import qrcode from "qrcode-terminal";
import QRPNG from "qrcode";
import puppeteer from "puppeteer-core";
import pino from "pino";
import fs from "fs";
import path from "path";
import readline from "readline";
import dotenv from "dotenv";

// Load `.env` into process.env (override via real env vars if present)
dotenv.config();

// ──────────────────────────────────────────────────────────────
// Runtime Config (env-driven)
// ──────────────────────────────────────────────────────────────
const PERSONA_ENABLED = (() => {
    const v = (process.env.PERSONA || process.env.PERSONA_ENABLED || "1").toString().toLowerCase();
    return !(v === "0" || v === "false" || v === "no");
})();
const DEBUG = (() => {
    const v = (process.env.DEBUG || "").toString().toLowerCase();
    return v === "1" || v === "true" || v === "yes";
})();
const PERSONA_NAME = process.env.PERSONA_NAME || "Anandha";
const PERSONA_MARKER = `[persona:${PERSONA_NAME.toLowerCase()}]`;
const LLM_LOG_ENABLED = (() => {
    const v = (process.env.LLM_LOG || "1").toString().toLowerCase();
    return !(v === "0" || v === "false" || v === "no");
})();

// ──────────────────────────────────────────────────────────────
// Prompt Builder (time‑aware, notebook‑grounded, style‑constrained)
// ──────────────────────────────────────────────────────────────
function timeMeta() {
    const now = new Date();
    const weekday = now.toLocaleString(undefined, { weekday: "long" });
    const date = now.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "2-digit" });
    const time = now.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
    const hour = now.getHours();
    const partOfDay = hour < 5 ? "late night" : hour < 12 ? "morning" : hour < 17 ? "afternoon" : hour < 21 ? "evening" : "night";
    try {
        const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "local";
        return { weekday, date, time, tz, partOfDay };
    } catch {
        return { weekday, date, time, tz: "local", partOfDay };
    }
}

function buildPrompt(userMessage) {
    // Load from environment or use default placeholder
    const promptTemplate = process.env.PROMPT_TEMPLATE || `D says: "${userMessage}"\n\nAssistant:`;
    return promptTemplate.replace("{message}", userMessage);
}

// Load persona pin from environment or use a minimal default
function buildPersonaPin() {
    const personaPin = process.env.PERSONA_PIN;
    if (personaPin) {
        return [PERSONA_MARKER, personaPin].join("\n");
    }
    // Default minimal persona
    return [
        `${PERSONA_MARKER}`,
        `SYSTEM PROMPT — Assistant`,
        ``,
        `You are a helpful assistant on WhatsApp.`,
        `Keep responses natural and conversational.`,
        ``,
        `OUTPUT`,
        `Write ONE reply.`,
        `No analysis.`,
        `Just the reply text.`
    ].join("\n");
}

// ═══════════════════════════════════════════════════════════════
// ENV-SOURCED CONFIG (no CONFIG object; read directly from process.env)
// ═══════════════════════════════════════════════════════════════
const GF_PHONE_NUMBER = process.env.GF_PHONE_NUMBER || process.env.TARGET_PHONE || null;
const TARGET_JID = process.env.TARGET_JID || null;
const TARGET_LID = process.env.TARGET_LID || null;
const REPLY_ALL = (() => { const v = (process.env.REPLY_ALL || "").toString().toLowerCase(); return v === "1" || v === "true" || v === "yes"; })();
const MANUAL_SEND = (() => { const v = (process.env.MANUAL_SEND || "").toString().toLowerCase(); return v === "1" || v === "true" || v === "yes"; })();
const NOTEBOOK_URL = process.env.NOTEBOOK_URL || "https://notebooklm.google.com";
const RESPONSE_MAX_WAIT = (() => { const v = parseInt(process.env.RESPONSE_MAX_WAIT || "60000", 10); return isNaN(v) ? 60000 : v; })();
const RESPONSE_STABLE_MS = (() => { const v = parseInt(process.env.RESPONSE_STABLE_MS || "4000", 10); return isNaN(v) ? 4000 : v; })();
const QUICK_SEND = (() => { const v = (process.env.QUICK_SEND || "0").toString().toLowerCase(); return v === "1" || v === "true" || v === "yes"; })();
const QUICK_SEND_MAX_MS = (() => { const v = parseInt(process.env.QUICK_SEND_MAX_MS || "5000", 10); return isNaN(v) ? 5000 : v; })();
const WHATSAPP_AUTH = process.env.WHATSAPP_AUTH || "./whatsapp_auth";
const CHROME_PROFILE = process.env.CHROME_PROFILE || "./chrome_bot_profile";

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

function log(emoji, msg) {
    console.log(`[${new Date().toLocaleTimeString()}] ${emoji} ${msg}`);
}

function llmLog(phase, msg) {
    if (!LLM_LOG_ENABLED) return;
    console.log(`[${new Date().toLocaleTimeString()}] 🧠 LLM ${phase}: ${msg}`);
}

// ═══════════════════════════════════════════════════════════════
// NOTEBOOKLM MODULE
// ═══════════════════════════════════════════════════════════════

let browser = null;
let page = null;

// Always get the latest page object
function getPage() {
    if (!page) throw new Error("No active NotebookLM page");
    return page;
}
const HEADLESS = (() => {
    const v = (process.env.HEADLESS || "").toString().toLowerCase();
    // Default to headless ON; allow disabling via 0/false/no
    if (v === "0" || v === "false" || v === "no") return false;
    return true;
})();
const WA_ONLY = (() => {
    const v = (process.env.WA_ONLY || "").toString().toLowerCase();
    return v === "1" || v === "true" || v === "yes";
})();

// Shared selector list (used across helpers)
const inputSelectorCombo = [
    'textarea[aria-label="Query box"]',
    'textarea.query-box-input',
    'textarea.cdk-textarea-autosize.query-box-input',
    'textarea.mat-mdc-autocomplete-trigger.query-box-input'
].join(',');

async function initNotebookLM() {
    log("🌐", `Starting Chrome for NotebookLM${HEADLESS ? " (headless)" : ""}...`);
    
    browser = await puppeteer.launch({
        executablePath: findChrome(),
        headless: HEADLESS,
        userDataDir: CHROME_PROFILE,
        args: [
            "--disable-blink-features=AutomationControlled",
            "--no-first-run",
            "--no-default-browser-check",
            "--disable-gpu",
            "--window-size=1366,768"
        ],
        ignoreDefaultArgs: ["--enable-automation"],
        defaultViewport: HEADLESS ? { width: 1366, height: 768 } : null,
    });

    page = await browser.newPage();
    await page.evaluateOnNewDocument(() => {
        Object.defineProperty(navigator, "webdriver", { get: () => undefined });
    });

    log("📓", "Opening NotebookLM...");
    await page.goto(NOTEBOOK_URL, { waitUntil: "domcontentloaded", timeout: 180000 });

    // Detect if NotebookLM redirected to the root/home page (e.g., not authorized for this notebook)
    const cur = page.url();
    const nlmRoot = 'https://notebooklm.google.com/';
    if ((cur === nlmRoot || (cur.startsWith(nlmRoot) && !cur.includes('/notebook/')))) {
        if (HEADLESS) {
            log("❌", "NotebookLM redirected to the homepage — login required. Run with HEADLESS=0 to sign into the correct Google account, then restart.");
            throw new Error('NotebookLM redirected to home; login required');
        } else {
            log("🔐", "NotebookLM opened the homepage. Please sign in to the Google account that has access to the notebook. Waiting for sign-in/redirect...");
            // Wait for the user to sign in / redirect back to a notebook URL
            const signInTimeout = 3 * 60 * 1000; // 3 minutes
            const start = Date.now();
            while (Date.now() - start < signInTimeout) {
                await new Promise(r => setTimeout(r, 2000));
                try {
                    const now = page.url();
                    if (now.includes('/notebook/')) {
                        log("✅", "Detected notebook URL after sign-in.");
                        break;
                    }
                } catch (e) {}
            }
            // Try navigating to the specific notebook URL again in case sign-in completed
            try {
                await page.goto(NOTEBOOK_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
            } catch (e) {
                // ignore — later waitForSelector will catch failures
            }
        }
    }

    // Wait for the chat input to be present. If not logged in, this will timeout.
    // Robust input detection: aria label and class fallbacks
    try {
        await page.waitForSelector(inputSelectorCombo, { timeout: 60000 });
        log("✅", "NotebookLM ready (input detected)!");
    } catch (e) {
        if (HEADLESS) {
            log("❌", "Chat input not found in headless mode. Log into Google once using headful mode (HEADLESS=0), then rerun headless.");
        } else {
            log("❌", "Chat input not found. Ensure you are logged in to Google in the Chrome window (session persists). Restart after logging in.");
        }
        throw e;
    }

    // Wait for initial messages to render before counting
    await new Promise(r => setTimeout(r, 2000));

    // Optionally pin persona once per session
    if (PERSONA_ENABLED) {
        try {
            await ensurePersonaPinned();
        } catch (e) {
            llmLog("persona", `pin failed: ${e?.message || e}`);
        }
    }
}

// Utility run inside the page to determine if text looks like a loading placeholder
function buildLoadingCheck() {
    return (text) => {
        if (!text) return true;
        const t = text.trim().toLowerCase();
        const minAcceptLen = 50; // require at least this many chars to consider as a non-loading reply
        const short = t.length < minAcceptLen;
        const hasEllipses = /\.{3}|…$/.test(t);
        const loadingWords = [
            "analyzing", "parsing", "retrieving", "searching", "thinking", "preparing", "loading", "gathering",
            "scanning", "finalizing", "prioritizing", "determining", "processing", "reading", "sources", "facts",
            "examining", "specifics", "interpreting", "implications", "Inquiry"
        ];
        const mentions = loadingWords.some(w => t.includes(w));
        return short || hasEllipses || mentions;
    };
}

// Wait for a new chat-message and resolve when its content is stable (not changing) and not a loading placeholder
async function waitForStableResponse(prevCount, maxMsOverride) {
    const maxMs = typeof maxMsOverride === 'number' ? maxMsOverride : RESPONSE_MAX_WAIT;
    return page.evaluate((prevCount, stableMs, maxMs) => {
        const isLoading = (text) => {
            if (!text) return true;
            const t = text.trim().toLowerCase();
            const minAcceptLen = 50;
            const short = t.length < minAcceptLen;
            const hasEllipses = /\.{3}|…$/.test(t);
            const loadingWords = [
                "analyzing", "parsing", "retrieving", "searching", "thinking", "preparing", "loading", "gathering",
                "scanning", "finalizing", "prioritizing", "determining", "processing", "reading", "sources", "facts",
                "examining", "specifics", "interpreting", "implications", "Inquiry"
            ];
            const mentions = loadingWords.some(w => t.includes(w));
            return short || hasEllipses || mentions;
        };

        const getLastMessageEl = () => {
            const pairs = document.querySelectorAll('div.chat-message-pair');
            if (pairs.length) {
                const lastPair = pairs[pairs.length - 1];
                const individuals = lastPair.querySelectorAll('chat-message.individual-message');
                if (individuals.length) return individuals[individuals.length - 1];
            }
            const msgs = document.querySelectorAll('chat-message');
            if (!msgs.length) return null;
            return msgs[msgs.length - 1];
        };

        const getTextFromMessage = (el) => {
            if (!el) return "";
            const main = el.querySelector('.message-text-content');
            if (main && main.innerText) return main.innerText.trim();
            const fallback = el.querySelector('mat-card-content');
            if (fallback && fallback.innerText) return fallback.innerText.trim();
            return el.innerText?.trim() || "";
        };

        return new Promise((resolve) => {
            const start = Date.now();

            const tryResolve = () => {
                const last = getLastMessageEl();
                if (!last) return false;
                const txt = getTextFromMessage(last);
                if (!txt || isLoading(txt)) return false;
                resolve(txt);
                return true;
            };

            // If a new message already exists beyond prevCount, attach observer to its content
            const initialMsgs = (document.querySelectorAll('div.chat-message-pair').length
                ? document.querySelectorAll('div.chat-message-pair chat-message.individual-message')
                : document.querySelectorAll('chat-message'));
            let target = null;
            if (initialMsgs.length > prevCount) {
                target = initialMsgs[initialMsgs.length - 1];
            }

            let lastText = "";
            let lastChange = Date.now();

            const checkStable = () => {
                if (!target) return;
                const nowText = getTextFromMessage(target);
                if (nowText !== lastText) {
                    lastText = nowText;
                    lastChange = Date.now();
                }
                const stableFor = Date.now() - lastChange;
                if (stableFor >= stableMs && nowText && !isLoading(nowText)) {
                    resolve(nowText);
                }
            };

            const bodyObserver = new MutationObserver(() => {
                const list = (document.querySelectorAll('div.chat-message-pair').length
                    ? document.querySelectorAll('div.chat-message-pair chat-message.individual-message')
                    : document.querySelectorAll('chat-message'));
                if (list.length > prevCount) {
                    target = list[list.length - 1];
                    lastText = getTextFromMessage(target) || "";
                    lastChange = Date.now();
                }
            });

            bodyObserver.observe(document.body, { childList: true, subtree: true });

            const contentObserver = new MutationObserver(() => {
                lastChange = Date.now();
            });

            const attachContentObserver = () => {
                if (!target) return;
                const content = target.querySelector('.message-text-content') || target;
                contentObserver.disconnect();
                contentObserver.observe(content, { childList: true, subtree: true, characterData: true });
            };

            // Poll for stabilization and attach observers when target appears
            const interval = setInterval(() => {
                if (!target) {
                    const list = (document.querySelectorAll('div.chat-message-pair').length
                        ? document.querySelectorAll('div.chat-message-pair chat-message.individual-message')
                        : document.querySelectorAll('chat-message'));
                    if (list.length > prevCount) {
                        target = list[list.length - 1];
                        lastText = getTextFromMessage(target) || "";
                        lastChange = Date.now();
                        attachContentObserver();
                    }
                } else {
                    attachContentObserver();
                    checkStable();
                }

                if (Date.now() - start > maxMs) {
                    clearInterval(interval);
                    bodyObserver.disconnect();
                    contentObserver.disconnect();
                    // Return whatever we have, even if loading, to avoid hanging forever
                    const fallback = target ? getTextFromMessage(target) : "";
                    resolve(fallback);
                }
            }, 300);
        });
    }, prevCount, RESPONSE_STABLE_MS, maxMs);
}

// Wait for the first non-loading chunk of text (returns as soon as a non-loading message appears)
async function waitForFirstNonLoading(prevCount, maxMs) {
    return page.evaluate((prevCount, maxMs) => {
        const isLoading = (text) => {
            if (!text) return true;
            const t = text.trim().toLowerCase();
            const minAcceptLen = 50;
            const short = t.length < minAcceptLen;
            const hasEllipses = /\.{3}|…$/.test(t);
            const loadingWords = [
                "analyzing", "parsing", "retrieving", "searching", "thinking", "preparing", "loading", "gathering",
                "scanning", "finalizing", "prioritizing", "determining", "processing", "reading", "sources", "facts",
                "examining", "specifics", "interpreting", "implications", "Inquiry"
            ];
            const mentions = loadingWords.some(w => t.includes(w));
            return short || hasEllipses || mentions;
        };

        const getLastMessageText = () => {
            const pairs = document.querySelectorAll('div.chat-message-pair');
            if (pairs.length) {
                const lastPair = pairs[pairs.length - 1];
                const individuals = lastPair.querySelectorAll('chat-message.individual-message');
                if (individuals.length) return (individuals[individuals.length - 1].querySelector('.message-text-content') || individuals[individuals.length - 1]).innerText || '';
            }
            const msgs = document.querySelectorAll('chat-message');
            if (!msgs.length) return '';
            const last = msgs[msgs.length - 1];
            const main = last.querySelector('.message-text-content');
            return (main && main.innerText) ? main.innerText : (last.innerText || '');
        };

        return new Promise((resolve) => {
            const start = Date.now();
            const bodyObserver = new MutationObserver(() => {
                const list = (document.querySelectorAll('div.chat-message-pair').length
                    ? document.querySelectorAll('div.chat-message-pair chat-message.individual-message')
                    : document.querySelectorAll('chat-message'));
                if (list.length > prevCount) {
                    const txt = getLastMessageText();
                    if (txt && !isLoading(txt)) resolve(txt);
                }
            });

            bodyObserver.observe(document.body, { childList: true, subtree: true });

            // Also poll in case message already present or observer misses
            const interval = setInterval(() => {
                const txt = getLastMessageText();
                if (txt && !isLoading(txt)) {
                    clearInterval(interval);
                    bodyObserver.disconnect();
                    resolve(txt);
                }
                if (Date.now() - start > maxMs) {
                    clearInterval(interval);
                    bodyObserver.disconnect();
                    resolve(txt || '');
                }
            }, 200);
        });
    }, prevCount, maxMs);
}

async function typeAndSend(text) {
    // Always use the latest page object
    let attempts = 0;
    const maxAttempts = 6;
    const retryDelay = 1400;
    let didRefresh = false;
    while (true) {
        const pg = getPage();
        while (attempts < maxAttempts) {
            try {
                await pg.waitForSelector(inputSelectorCombo, { visible: true, timeout: 8000 });
                const chatInput = await pg.$(inputSelectorCombo);
                if (!chatInput) {
                    log("⚠️", `Chat input not found (attempt ${attempts + 1}) for selector: ${inputSelectorCombo}`);
                    attempts++;
                    await new Promise(r => setTimeout(r, retryDelay));
                    continue;
                }
                const overlayPresent = await pg.evaluate(() => {
                    const selectors = [
                        '.cdk-overlay-backdrop', '.mat-mdc-dialog-container', '.modal-backdrop', '.mat-dialog-container', '.backdrop', '.overlay', '.block-ui', '.loading', '[role="dialog"]', '[aria-modal="true"]'
                    ];
                    return selectors.some(sel => {
                        const el = document.querySelector(sel);
                        if (!el) return false;
                        const style = window.getComputedStyle(el);
                        return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
                    });
                });
                if (overlayPresent) {
                    log("⚠️", `Overlay/modal detected, waiting... (attempt ${attempts + 1})`);
                    attempts++;
                    await new Promise(r => setTimeout(r, retryDelay));
                    continue;
                }
                const interactable = await chatInput.evaluate(el => {
                    if (!el) return false;
                    const style = window.getComputedStyle(el);
                    if (el.disabled) return false;
                    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
                    const rect = el.getBoundingClientRect();
                    return rect.width > 0 && rect.height > 0;
                });
                if (!interactable) {
                    log("⚠️", `Input not interactable (attempt ${attempts + 1})`);
                    attempts++;
                    await new Promise(r => setTimeout(r, retryDelay));
                    continue;
                }
                await chatInput.evaluate(el => el.scrollIntoView({ block: 'end' }));
                await chatInput.click({ clickCount: 3 });
                await pg.keyboard.press("Backspace");
                await pg.evaluate((combo, value) => {
                    const sel = combo.split(',').map(s => s.trim());
                    const ta = sel.map(s => document.querySelector(s)).find(Boolean);
                    if (!ta) return;
                    ta.value = value;
                    const ev = new Event('input', { bubbles: true });
                    ta.dispatchEvent(ev);
                }, inputSelectorCombo, text);
                await pg.type(inputSelectorCombo, " ");
                await pg.keyboard.press("Backspace");
                await pg.focus(inputSelectorCombo);
                await pg.keyboard.press("Enter");
                await new Promise(r => setTimeout(r, 1500));
                return;
            } catch (err) {
                log("⚠️", `Input interaction failed (attempt ${attempts + 1}): ${err.message}`);
                attempts++;
                await new Promise(r => setTimeout(r, retryDelay));
            }
        }
        // If not already refreshed, try refreshing the page and retrying
        if (!didRefresh) {
            log("🔄", "Refreshing NotebookLM page and retrying input...");
            const pg2 = getPage();
            await pg2.reload({ waitUntil: "domcontentloaded", timeout: 120000 });
            attempts = 0;
            didRefresh = true;
            await new Promise(r => setTimeout(r, 2500));
            continue;
        }
        // If already refreshed and still failed, log DOM for debugging and give up
        const dom = await getPage().evaluate(() => document.body.innerHTML.slice(0, 2000));
        log("❌", `Input not interactable after all attempts. DOM snapshot: ${dom}`);
        throw new Error("Chat input not found or not interactable after multiple attempts and refresh");
    }
}

async function countMessages() {
    return page.evaluate(() => ({
        pairCount: document.querySelectorAll('div.chat-message-pair').length,
        msgCount: document.querySelectorAll('div.chat-message-pair chat-message.individual-message').length || document.querySelectorAll('chat-message').length
    }));
}

async function ensurePersonaPinned() {
    llmLog("persona", `checking pin for ${PERSONA_NAME}`);
    // Check last few user messages for the marker
    const alreadyPinned = await page.evaluate((marker) => {
        const pairs = Array.from(document.querySelectorAll('div.chat-message-pair'));
        const last = pairs.slice(-6);
        for (const p of last) {
            const first = p.querySelector('chat-message.individual-message');
            const text = (first?.innerText || '').toLowerCase();
            if (text.includes(marker.toLowerCase())) return true;
        }
        return false;
    }, PERSONA_MARKER);
    if (alreadyPinned) {
        llmLog("persona", "already pinned");
        return;
    }
    llmLog("persona", "pinning now");
    const baseline = await countMessages();
    await typeAndSend(buildPersonaPin());
    const after = await countMessages();
    llmLog("send", `persona message queued (msgs ${baseline.msgCount} -> ${after.msgCount})`);
    const resp = await waitForStableResponse(baseline.msgCount);
    llmLog("recv", `persona ack: ${String(resp || '').slice(0, 80)}...`);
}

async function getResponseFromNotebookLM(message, _retrying) {
    if (!page) return null;

    try {
        log("📤", `Sending to NotebookLM: "${message}"`);
        const baseline = await countMessages();
        await typeAndSend(message);
        llmLog("send", `user message queued (msgs ${baseline.msgCount} -> ?)`);
        log("⏳", "Waiting for response (with stability check)...");

        // Ensure the latest user bubble contains the raw message
        const userEchoOk = await getPage().evaluate((needle) => {
            const pairs = document.querySelectorAll('div.chat-message-pair');
            if (!pairs.length) return false;
            const lastPair = pairs[pairs.length - 1];
            const first = lastPair.querySelector('chat-message.individual-message');
            if (!first) return false;
            const t = (first.innerText || '').toLowerCase();
            return t.includes(String(needle || '').toLowerCase());
        }, message);

        if (!userEchoOk) {
            log("⚠️", "User text not echoed in latest bubble; reply may be unreliable.");
            llmLog("warn", "echo check failed");
        }

        // Helper: wait for the final stable assistant response (no new assistant messages for RESPONSE_STABLE_MS)
        const waitForFinalStable = async (startPrevCount, deadlineTs) => {
            let prev = startPrevCount;
            let lastResp = '';
            while (Date.now() < deadlineTs) {
                const remaining = Math.max(1000, deadlineTs - Date.now());
                const resp = await waitForStableResponse(prev, remaining);
                if (!resp || !resp.trim()) {
                    // nothing useful; stop
                    break;
                }
                lastResp = resp;
                const counts = await countMessages();
                const newCount = counts.msgCount;
                if (newCount > prev) {
                    // New assistant message(s) arrived; wait again for stability on the new message(s)
                    prev = newCount;
                    continue;
                }
                // No new messages after the stable response — consider this final
                return lastResp;
            }
            return lastResp || null;
        };

        let response = null;
        if (QUICK_SEND) {
            // Quick-send path: return first non-loading chunk within QUICK_SEND_MAX_MS.
            log("⏱️", `Quick-send: waiting up to ${QUICK_SEND_MAX_MS}ms for first non-loading chunk...`);
            response = await waitForFirstNonLoading(baseline.msgCount, QUICK_SEND_MAX_MS);
            llmLog("recv", `assistant first-chunk (${(response || '').length} chars)`);
            // If quick path produced nothing useful, fall back to stable wait
            if (!response || !response.trim()) {
                log("ℹ️", "Quick-send returned empty; waiting for stable response...");
                const deadline = Date.now() + RESPONSE_MAX_WAIT;
                response = await waitForFinalStable(baseline.msgCount, deadline);
            } else {
                // Even if quick chunk returned, give a short window to see if it is followed by another assistant message
                const deadline = Date.now() + Math.min(RESPONSE_MAX_WAIT, QUICK_SEND_MAX_MS + RESPONSE_STABLE_MS);
                const final = await waitForFinalStable(baseline.msgCount, deadline);
                if (final && final.trim()) response = final;
            }
        } else {
            // Stable-send path: wait until content is stable (no partial replies)
            log("⏱️", `Stable-send: waiting up to ${RESPONSE_MAX_WAIT}ms for stable response...`);
            const deadline = Date.now() + RESPONSE_MAX_WAIT;
            response = await waitForFinalStable(baseline.msgCount, deadline);
            llmLog("recv", `assistant stable (${(response || '').length} chars)`);
        }

        if (response && response.trim()) {
            // Clean up response (remove citation numbers like "[1]", "1.", or trailing "1 2 3")
            const cleanResponse = response
                .replace(/\[(\d+)\]/g, '')           // [1], [2], etc.
                .replace(/([\s\.,;:!?-])\d+\s*$/g, '$1') // trailing numbers after punctuation (e.g., .12, ,12, 12)
                .replace(/\s+\d+(\s+\d+)*\s*$/g, '') // trailing numbers like " 1" or " 1 2 3"
                .replace(/(\d+\.)+\s*/g, '')         // numbered lists like "1. 2."
                .replace(/\s+/g, ' ')
                .trim();

            log("📥", `Response: "${cleanResponse.substring(0, 50)}..."`);
            llmLog("final", cleanResponse);
            return cleanResponse;
        }

        log("⚠️", "No response captured!");
        llmLog("error", "no response captured");
        return null;

    } catch (err) {
        log("❌", `Error: ${err.message}`);
        llmLog("error", err.message || String(err));
        // If browser/page crashed, try to recover and retry ONCE
        if (!_retrying && (err.message.includes('Target closed') || err.message.includes('Session closed') || err.message.includes('not found') || err.message.includes('browser has disconnected') || err.message.includes('detached Frame'))) {
            log("🔁", "Attempting to recover NotebookLM browser/page and retry...");
            try {
                if (browser) { await browser.close().catch(()=>{}); browser = null; }
            } catch {}
            try {
                // Re-init and update global page
                page = await initNotebookLM();
                return await getResponseFromNotebookLM(message, true);
            } catch (e2) {
                log("❌", `Recovery failed: ${e2.message}`);
                llmLog("error", `Recovery failed: ${e2.message}`);
                return null;
            }
        }
        return null;
    }
}

// ═══════════════════════════════════════════════════════════════
// WHATSAPP MODULE
// ═══════════════════════════════════════════════════════════════

async function initWhatsApp() {
    log("📱", "Connecting to WhatsApp...");

    const { state, saveCreds } = await useMultiFileAuthState(WHATSAPP_AUTH);

    // Wrap saveCreds to use atomic writes for all JSON files
    const atomicSaveCreds = async () => {
        const base = WHATSAPP_AUTH;
        const files = ["creds.json", "keys"].map(f => path.join(base, f));
        try {
            // Save creds.json atomically
            const credsPath = path.join(base, "creds.json");
            if (fs.existsSync(credsPath)) {
                const data = fs.readFileSync(credsPath);
                await writeFileAtomic(credsPath, data);
            }
        } catch (e) {
            log("⚠️", `Atomic saveCreds failed: ${e.message}`);
        }
        // Save keys/* atomically (if any)
        const keysDir = path.join(base, "keys");
        if (fs.existsSync(keysDir)) {
            for (const file of fs.readdirSync(keysDir)) {
                const filePath = path.join(keysDir, file);
                try {
                    const data = fs.readFileSync(filePath);
                    await writeFileAtomic(filePath, data);
                } catch (e) {
                    log("⚠️", `Atomic saveKey failed: ${file}: ${e.message}`);
                }
            }
        }
    };

    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
        auth: state,
        version,
        browser: ["Chrome", "Windows", "10.0"],
        logger: pino({ level: "silent" }),
    });

    sock.ev.on("connection.update", async (update) => {
        const { connection, lastDisconnect, qr } = update;
        if (DEBUG) {
            try { console.log("[DEBUG] update:", JSON.stringify({ connection, hasQR: !!qr, keys: Object.keys(update||{}) }, null, 2)); } catch {}
        }

        if (qr) {
            console.log("\n" + "═".repeat(50));
            console.log("📱 SCAN THIS QR CODE WITH WHATSAPP:");
            console.log("═".repeat(50) + "\n");
            try { qrcode.generate(qr, { small: true }); } catch (e) { console.log("[QR]", qr); }
            try {
                await QRPNG.toFile("wa-qr.png", qr, { width: 320 });
                console.log("[QR] Saved image: wa-qr.png (open this if the ASCII QR is hard to scan)");
            } catch {}
        }

        if (connection === "close") {
            const code = lastDisconnect?.error?.output?.statusCode || lastDisconnect?.error?.statusCode || lastDisconnect?.error?.code;
            const reason = Object.keys(DisconnectReason).find(k => DisconnectReason[k] === code) || code;
            log("❌", `WhatsApp connection closed (reason: ${reason}).`);
            if (code === DisconnectReason.loggedOut) {
                log("ℹ️", "You appear logged out. Run 'npm run wa:reset' to clear creds, then run 'npm run wa:login' to rescan QR.");
            } else if (code === DisconnectReason.connectionReplaced) {
                log("ℹ️", "Connection replaced by another session. Not reconnecting — stop other instances first.");
            } else {
                log("🔄", "Reconnecting in 2 seconds...");
                setTimeout(() => initWhatsApp(), 2000);
            }
        } else if (connection === "open") {
            log("✅", "WhatsApp connected!");
        }
    });

    sock.ev.on("creds.update", async () => {
        await saveCreds();
        await atomicSaveCreds();
    });
// Graceful shutdown: save creds and close browser cleanly
process.on("SIGINT", async () => {
    log("👋", "Shutting down (SIGINT)...");
    try { await atomicSaveCreds(); } catch {}
    if (browser) await browser.close();
    process.exit(0);
});
process.on("SIGTERM", async () => {
    log("👋", "Shutting down (SIGTERM)...");
    try { await atomicSaveCreds(); } catch {}
    if (browser) await browser.close();
    process.exit(0);
});

    // Handle incoming messages
    // Deduplication state
    let lastMsgId = null;
    let lastMsgText = null;
    let lastReply = null;

    sock.ev.on("messages.upsert", async (m) => {
        const msg = m.messages[0];
        if (!msg.message || msg.key.fromMe) return;
        const remoteJid = msg.key.remoteJid || "";
        const senderPhone = remoteJid.endsWith("@s.whatsapp.net") ? remoteJid.replace("@s.whatsapp.net", "") : "";


        // Targeting rules (JID, LID, phone)
        let allowed = false;
        if (REPLY_ALL) {
            allowed = true;
        } else if (TARGET_JID && TARGET_JID === remoteJid) {
            allowed = true;
        } else if (TARGET_LID && remoteJid === TARGET_LID) {
            allowed = true;
        } else if (GF_PHONE_NUMBER && senderPhone === GF_PHONE_NUMBER) {
            allowed = true;
        }
        if (!allowed) {
            log("📨", `Message from ${remoteJid} (ignored)`);
            return;
        }

        const text = msg.message.conversation || msg.message.extendedTextMessage?.text || "";
        if (!text) return;

        // Deduplication: Only reply if message is new or text is different
        if (msg.key.id === lastMsgId && text === lastMsgText) {
            log("⏩", "Duplicate message detected, skipping reply.");
            return;
        }

        log("💬", `From ${remoteJid}: "${text}"`);

        if (WA_ONLY) {
            log("ℹ️", "WA_ONLY mode: skipping LLM reply; QR/auth only.");
            return;
        }

        // Get response from NotebookLM
        const response = await getResponseFromNotebookLM(text);

        // Only send if response is not a duplicate of last reply
        if (response && response !== lastReply) {
            // Simulate typing before sending
            await sock.sendPresenceUpdate('composing', msg.key.remoteJid);
            // Manual send mode: allow review/edit/discard
            if (MANUAL_SEND) {
                log("✍️", `Manual review: ${response}`);
                const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
                const ask = (q) => new Promise(res => rl.question(q, res));
                let action = await ask(`Send, edit, or discard? (s/e/d): `);
                if (action.trim().toLowerCase() === 'e') {
                    let edited = await ask('Edit message: ');
                    response = edited;
                } else if (action.trim().toLowerCase() === 'd') {
                    log("🚫", "Message discarded.");
                    rl.close();
                    return;
                }
                rl.close();
            }
            // Send message
            await sock.sendMessage(msg.key.remoteJid, { text: response });
            log("✅", `Replied: "${response.substring(0, 50)}..."`);
            lastMsgId = msg.key.id;
            lastMsgText = text;
            lastReply = response;
        } else if (response === lastReply) {
            log("⏩", "Duplicate reply detected, skipping send.");
        }
    });

    return sock;
}

// ═══════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════

async function main() {
    console.log("\n");
    console.log("╔════════════════════════════════════════════════════════╗");
    console.log("║  WhatsApp + NotebookLM Bot                             ║");
    console.log("║  Auto-replies as Anandha                               ║");
    console.log("╚════════════════════════════════════════════════════════╝\n");

    if (!WA_ONLY) {
        // Step 1: NotebookLM
        await initNotebookLM();
    } else {
        log("🔌", "WA_ONLY mode enabled: skipping NotebookLM initialization.");
    }

    // WhatsApp
    await initWhatsApp();

    console.log("\n" + "═".repeat(50));
    log("🤖", "BOT IS RUNNING!");
    if (WA_ONLY) {
        log("📱", "Scan the QR code in this terminal to link WhatsApp.");
        log("ℹ️", "After linking, restart without WA_ONLY to enable auto-replies.");
    } else {
        if (REPLY_ALL) {
            log("📱", "Watching for messages from: ANYONE (REPLY_ALL=1)");
        } else if (TARGET_JID) {
            log("📱", `Watching for messages from JID: ${TARGET_JID}`);
        } else if (GF_PHONE_NUMBER) {
            log("📱", `Watching for messages from phone: ${GF_PHONE_NUMBER}`);
        }
    }
    log("🛑", "Press Ctrl+C to stop");
    console.log("═".repeat(50) + "\n");
}

process.on("SIGINT", async () => {
    log("👋", "Shutting down...");
    if (browser) await browser.close();
    process.exit(0);
});

main().catch(console.error);