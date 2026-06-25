// src/agents/instagramAgent.js
// Playwright agent that sends Instagram DMs using a persistent browser profile.
// First run: headful for login. Subsequent runs: headless.
//
// Usage via CLI: node src/cli/runInstagramAgent.js [--login-only] [--dry-run]
import { chromium } from "playwright";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import readline from "readline";
import dotenv from "dotenv";

dotenv.config();

const __dirname     = path.dirname(fileURLToPath(import.meta.url));
const ROOT          = path.resolve(__dirname, "../..");
const PROFILE_DIR   = path.join(ROOT, "data", "browser-profiles", "instagram-agent");
const LOG_PATH      = path.join(ROOT, "data", "instagram-agent-log.json");
const OUTREACH_PATH = path.join(ROOT, "data", "outreach.localDentists.json");

const DELAY_MIN = 3_000;
const DELAY_MAX = 8_000;
const GAP_MIN   = 20_000;
const GAP_MAX   = 60_000;
const MAX_DAILY = 10;

function readJsonSafe(p, fb) {
  try { return JSON.parse(fs.readFileSync(p, "utf-8")); } catch { return fb; }
}
function writeJson(p, data) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(data, null, 2), "utf-8");
}
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function randMs(min, max) { return Math.floor(Math.random() * (max - min) + min); }

async function humanDelay(min = DELAY_MIN, max = DELAY_MAX) {
  await sleep(randMs(min, max));
}

// Types directly into a Playwright element handle with human-like delay
async function humanTypeInto(el, text) {
  await el.click();
  await sleep(randMs(300, 600));
  for (const char of text) {
    await el.type(char, { delay: randMs(50, 180) });
  }
}

function profileExists() {
  try {
    return fs.existsSync(PROFILE_DIR) && fs.readdirSync(PROFILE_DIR).length > 0;
  } catch { return false; }
}

async function isLoggedIn(page) {
  try {
    await page.goto("https://www.instagram.com/", { timeout: 20_000, waitUntil: "domcontentloaded" });
    await sleep(3_000);
    const url = page.url();
    return !url.includes("/accounts/login") && !url.includes("/accounts/emailsignup");
  } catch { return false; }
}

// Dismiss common Instagram interstitial popups
async function dismissPopups(page) {
  const dismissTexts = ["Not Now", "Not now", "Decline optional cookies", "Allow essential and optional cookies"];
  for (const text of dismissTexts) {
    try {
      const btn = page.getByRole("button", { name: text });
      if (await btn.count() > 0) {
        await btn.first().click();
        await sleep(800);
      }
    } catch {}
  }
  // Close any modal by aria
  try {
    const close = await page.$('[aria-label="Close"]');
    if (close) { await close.click(); await sleep(500); }
  } catch {}
}

async function sendDM(page, target) {
  const raw    = target.instagramHandle || target.instagramUrl || "";
  const handle = raw.replace(/.*instagram\.com\//, "").replace(/^@/, "").split("?")[0].split("/")[0].trim();
  if (!handle) throw new Error("No Instagram handle");

  console.log(`  → instagram.com/${handle}`);

  // Navigate to the profile (desktop web)
  await page.goto(`https://www.instagram.com/${handle}/`, { timeout: 20_000, waitUntil: "domcontentloaded" });
  await humanDelay(3_000, 5_000);
  await dismissPopups(page);

  // Find Message button on profile — try Playwright locators (more reliable than CSS)
  let msgBtn = null;
  try {
    const loc = page.getByRole("button", { name: "Message" });
    if (await loc.count() > 0) msgBtn = await loc.first().elementHandle();
  } catch {}

  if (!msgBtn) {
    try {
      const loc = page.getByRole("link", { name: "Message" });
      if (await loc.count() > 0) msgBtn = await loc.first().elementHandle();
    } catch {}
  }

  if (!msgBtn) {
    // Fallback: navigate directly to new DM thread
    console.log("    Message button not found on profile — trying direct DM navigation");
    await page.goto("https://www.instagram.com/direct/new/", { timeout: 15_000, waitUntil: "domcontentloaded" });
    await humanDelay(2_000, 3_000);
    await dismissPopups(page);

    try {
      const searchInput = await page.waitForSelector(
        'input[placeholder="Search..."], input[name="queryBox"], input[aria-label*="search" i]',
        { timeout: 5_000 }
      );
      await humanTypeInto(searchInput, handle);
      await sleep(2_000);

      // Click first search result
      const results = page.getByText(handle, { exact: false });
      if (await results.count() > 0) {
        await results.first().click();
        await sleep(1_000);
      }

      // Click Next to open thread
      try {
        const nextBtn = page.getByRole("button", { name: "Next" });
        if (await nextBtn.count() > 0) { await nextBtn.first().click(); await sleep(1_500); }
      } catch {}
    } catch (e) {
      throw new Error(`Could not open DM thread for @${handle}: ${e.message}`);
    }
  } else {
    await msgBtn.click();
    await humanDelay(3_000, 5_000);
    await dismissPopups(page);
  }

  // Find message input — wait for it to appear
  let msgInput = null;
  const inputSelectors = [
    '[placeholder="Message..."]',
    '[aria-label="Message"]',
    '[aria-label="message" i]',
    '[contenteditable="true"][role="textbox"]',
    '[contenteditable="true"]',
    'textarea',
  ];
  for (const sel of inputSelectors) {
    try {
      msgInput = await page.waitForSelector(sel, { timeout: 3_000 });
      if (msgInput) break;
    } catch {}
  }

  if (!msgInput) throw new Error(`Message input not found for @${handle}`);

  await humanTypeInto(msgInput, target.message);
  await humanDelay(1_000, 2_500);

  // Find and click Send button — DO NOT use Enter (adds newline in contenteditable)
  let sentViaButton = false;
  const sendSelectors = [
    'button[type="submit"]',
    '[aria-label="Send" i]',
    '[aria-label="Send message" i]',
  ];
  for (const sel of sendSelectors) {
    try {
      const btn = await page.$(sel);
      if (btn) {
        await btn.click();
        sentViaButton = true;
        break;
      }
    } catch {}
  }

  if (!sentViaButton) {
    // Last resort: try Playwright locator
    try {
      const sendBtn = page.getByRole("button", { name: /^Send$/i });
      if (await sendBtn.count() > 0) {
        await sendBtn.first().click();
        sentViaButton = true;
      }
    } catch {}
  }

  if (!sentViaButton) {
    // Keyboard fallback — Control+Enter is the send shortcut on IG desktop web
    await page.keyboard.press("Control+Enter");
  }

  await humanDelay(2_000, 4_000);
}

// ─── Public API ───────────────────────────────────────────────────────────────

export async function sendInstagramDMs(targets, { maxMessages = MAX_DAILY, dryRun = false, loginOnly = false } = {}) {
  const hasProfile = profileExists();
  const headless   = hasProfile && !loginOnly;

  console.log(`Instagram Agent — profile: ${hasProfile ? "exists" : "new"} | headless: ${headless} | dryRun: ${dryRun}`);
  fs.mkdirSync(PROFILE_DIR, { recursive: true });

  const browser = await chromium.launchPersistentContext(PROFILE_DIR, {
    headless,
    args: ["--disable-blink-features=AutomationControlled", "--no-sandbox", "--disable-infobars"],
    // Desktop viewport — desktop Instagram has more stable selectors than mobile web
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    viewport: { width: 1280, height: 800 },
  });

  const page = await browser.newPage();
  const log  = readJsonSafe(LOG_PATH, []);

  // ── Login check ───────────────────────────────────────────────────────────────
  const loggedIn = await isLoggedIn(page);

  if (!loggedIn) {
    if (headless) {
      console.log("✗ Instagram session expired — re-run: node src/cli/loginInstagramAgent.js");
      await browser.close();
      return [];
    }
    console.log("\n  Go to the browser window and log in to Instagram.");
    console.log("  When done, come back here and press Enter.\n");
    const _rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    await new Promise(resolve => _rl.question("Press Enter after logging in to Instagram... ", resolve));
    _rl.close();
  }

  if (loginOnly) {
    console.log("✓ Instagram login saved. Ready for headless runs.");
    await browser.close();
    return [];
  }

  // ── Load outreach file once for batch write ───────────────────────────────────
  const dental  = readJsonSafe(OUTREACH_PATH, []);
  const results = [];
  const toSend  = targets.slice(0, maxMessages);

  for (let i = 0; i < toSend.length; i++) {
    const target = toSend[i];
    console.log(`\n[${i + 1}/${toSend.length}] ${target.clinicName}`);

    if (dryRun) {
      console.log(`  DRY RUN — "${target.message.slice(0, 80)}..."`);
      results.push({ clinic: target.clinicName, status: "dry_run" });
      continue;
    }

    try {
      await sendDM(page, target);
      console.log(`  ✓ DM sent`);

      const now   = new Date().toISOString();
      const entry = { clinic: target.clinicName, handle: target.instagramHandle, status: "sent", sentAt: now };
      results.push(entry);
      log.push({ ...entry, message: target.message });

      const idx = dental.findIndex(c => c.clinicName === target.clinicName);
      if (idx !== -1) {
        dental[idx].instagramDMSentAt  = now;
        dental[idx].instagramDMMessage = target.message;
      }

    } catch (e) {
      console.log(`  ✗ Error: ${e.message.slice(0, 80)}`);
      results.push({ clinic: target.clinicName, status: "error", error: e.message.slice(0, 120) });
      log.push({ clinic: target.clinicName, status: "error", error: e.message.slice(0, 120), checkedAt: new Date().toISOString() });
    }

    if (i < toSend.length - 1) await humanDelay(GAP_MIN, GAP_MAX);
  }

  // ── Single write at end ───────────────────────────────────────────────────────
  const sent = results.filter(r => r.status === "sent").length;
  if (sent > 0) writeJson(OUTREACH_PATH, dental);
  writeJson(LOG_PATH, log);
  await browser.close();

  console.log(`\nInstagram Agent done: sent=${sent} errors=${results.filter(r => r.status === "error").length}`);
  return results;
}
