// src/agents/gmbAgent.js
// Playwright agent that sends GMB messages automatically using a persistent browser profile.
// First run: headful (visible) so you can log in to Google.
// Subsequent runs: headless using saved session.
//
// Usage via CLI: node src/cli/runGMBAgent.js [--login-only] [--dry-run]
import { chromium } from "playwright";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import readline from "readline";
import dotenv from "dotenv";

dotenv.config();

const __dirname     = path.dirname(fileURLToPath(import.meta.url));
const ROOT          = path.resolve(__dirname, "../..");
const PROFILE_DIR   = path.join(ROOT, "data", "browser-profiles", "gmb-agent");
const LOG_PATH      = path.join(ROOT, "data", "gmb-agent-log.json");
const OUTREACH_PATH = path.join(ROOT, "data", "outreach.localDentists.json");

const DELAY_MIN = 8_000;
const DELAY_MAX = 18_000;
const GAP_MIN   = 15_000;
const GAP_MAX   = 45_000;

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

// Types directly into a Playwright element handle with human-like per-char delay.
async function humanTypeInto(elementHandle, text) {
  await elementHandle.click();
  await sleep(randMs(300, 600));
  for (const char of text) {
    await elementHandle.type(char, { delay: randMs(40, 160) });
  }
}

// Profile exists = directory is non-empty (Playwright creates files immediately)
function profileExists() {
  try {
    return fs.existsSync(PROFILE_DIR) && fs.readdirSync(PROFILE_DIR).length > 0;
  } catch { return false; }
}

async function isLoggedIn(page) {
  try {
    await page.goto("https://myaccount.google.com/", { timeout: 15_000, waitUntil: "domcontentloaded" });
    await sleep(2_500);
    const url = page.url();
    return !url.includes("accounts.google.com/signin") &&
           !url.includes("accounts.google.com/v3/signin") &&
           !url.includes("/ServiceLogin");
  } catch { return false; }
}

async function findMessageButton(page) {
  const candidates = [
    'button[data-value="Message"]',
    'button[aria-label*="Message"]',
    'button[jsaction*="message"]',
    'a[aria-label*="Message"]',
    'div[role="button"][aria-label*="Message"]',
  ];
  for (const sel of candidates) {
    try {
      const el = await page.waitForSelector(sel, { timeout: 1_500 });
      if (el) return el;
    } catch {}
  }
  try {
    const loc = page.getByRole("button", { name: /^Message$/i });
    if (await loc.count() > 0) return loc.first().elementHandle();
  } catch {}
  return null;
}

async function findMessageInput(page) {
  const candidates = [
    'textarea[placeholder]',
    'textarea',
    '[contenteditable="true"][aria-multiline="true"]',
    '[contenteditable="true"]',
  ];
  for (const sel of candidates) {
    try {
      const el = await page.waitForSelector(sel, { timeout: 2_000 });
      if (el) return el;
    } catch {}
  }
  return null;
}

async function findSendButton(page) {
  const candidates = [
    'button[type="submit"]',
    'button[aria-label*="Send" i]',
    'button[jsaction*="send"]',
  ];
  for (const sel of candidates) {
    try {
      const el = await page.waitForSelector(sel, { timeout: 3_000 });
      if (el) return el;
    } catch {}
  }
  try {
    const loc = page.getByRole("button", { name: /^Send$/i });
    if (await loc.count() > 0) return loc.first().elementHandle();
  } catch {}
  return null;
}

// ─── Public API ───────────────────────────────────────────────────────────────

export async function sendGMBMessages(targets, { maxMessages = 10, dryRun = false, loginOnly = false } = {}) {
  const hasProfile = profileExists();
  const headless   = hasProfile && !loginOnly;

  console.log(`GMB Agent — profile: ${hasProfile ? "exists" : "new"} | headless: ${headless} | dryRun: ${dryRun}`);
  fs.mkdirSync(PROFILE_DIR, { recursive: true });

  const browser = await chromium.launchPersistentContext(PROFILE_DIR, {
    headless,
    args: [
      "--disable-blink-features=AutomationControlled",
      "--no-sandbox",
      "--disable-infobars",
    ],
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    viewport: { width: 1280, height: 800 },
  });

  const page = await browser.newPage();
  const log  = readJsonSafe(LOG_PATH, []);

  // ── Login check ───────────────────────────────────────────────────────────────
  const loggedIn = await isLoggedIn(page);

  if (!loggedIn) {
    if (headless) {
      console.log("✗ GMB session expired — re-run: node src/cli/loginGMBAgent.js");
      await browser.close();
      return [];
    }
    console.log("\n  Go to the browser window and log in to Google.");
    console.log("  When done, come back here and press Enter.\n");
    const _rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    await new Promise(resolve => _rl.question("Press Enter after logging in... ", resolve));
    _rl.close();
  }

  if (loginOnly) {
    console.log("✓ Login saved. Ready for headless runs.");
    await browser.close();
    return [];
  }

  // ── Load outreach file once for batch write ───────────────────────────────────
  const dental  = readJsonSafe(OUTREACH_PATH, []);
  const results = [];
  const toSend  = targets.slice(0, maxMessages);

  for (let i = 0; i < toSend.length; i++) {
    const target = toSend[i];
    const city   = (target.city || "").split(",")[0];
    console.log(`\n[${i + 1}/${toSend.length}] ${target.clinicName} — ${city}`);

    if (dryRun) {
      console.log(`  DRY RUN — "${target.message.slice(0, 80)}..."`);
      results.push({ clinic: target.clinicName, status: "dry_run" });
      continue;
    }

    try {
      await page.goto(target.mapsUrl, { timeout: 20_000, waitUntil: "domcontentloaded" });
      await humanDelay(4_000, 8_000);  // let Maps sidebar render

      const msgBtn = await findMessageButton(page);
      if (!msgBtn) {
        console.log(`  ✗ No Message button`);
        results.push({ clinic: target.clinicName, status: "no_messaging" });
        log.push({ clinic: target.clinicName, status: "no_messaging", checkedAt: new Date().toISOString() });
        continue;
      }

      await msgBtn.click();
      await humanDelay(3_000, 6_000);

      const inputEl = await findMessageInput(page);
      if (!inputEl) {
        console.log(`  ✗ No message input found after clicking Message`);
        results.push({ clinic: target.clinicName, status: "no_textarea" });
        continue;
      }

      await humanTypeInto(inputEl, target.message);
      await humanDelay(1_500, 3_000);

      const sendBtn = await findSendButton(page);
      if (!sendBtn) {
        console.log(`  ✗ Send button not found`);
        results.push({ clinic: target.clinicName, status: "no_send_btn" });
        continue;
      }

      await sendBtn.click();
      await humanDelay(3_000, 5_000);
      console.log(`  ✓ Sent`);

      const now   = new Date().toISOString();
      const entry = { clinic: target.clinicName, status: "sent", sentAt: now };
      results.push(entry);
      log.push({ ...entry, message: target.message });

      // Update in-memory dental record (batch write at end)
      const idx = dental.findIndex(c => c.clinicName === target.clinicName);
      if (idx !== -1) {
        dental[idx].gmbContactedAt = now;
        dental[idx].gmbMessage     = target.message;
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

  console.log(`\nGMB Agent done: sent=${sent} noMsg=${results.filter(r => r.status === "no_messaging").length} errors=${results.filter(r => r.status === "error").length}`);
  return results;
}
