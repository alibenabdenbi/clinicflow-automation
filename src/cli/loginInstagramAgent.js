// src/cli/loginInstagramAgent.js
// First-run login for the Instagram DM agent.
// Opens a visible Chrome window at instagram.com/accounts/login.
// Log in to the dedicated outreach Instagram account, then press Enter here.
//
// Usage: node src/cli/loginInstagramAgent.js
import { chromium } from "playwright";
import fs from "fs";
import readline from "readline";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";

dotenv.config();

const __dirname   = path.dirname(fileURLToPath(import.meta.url));
const ROOT        = path.resolve(__dirname, "../..");
const PROFILE_DIR = path.join(ROOT, "data", "browser-profiles", "instagram-agent");

fs.mkdirSync(PROFILE_DIR, { recursive: true });

console.log("\n═══════════════════════════════════════════════════════════");
console.log("  Instagram Agent — Login");
console.log("═══════════════════════════════════════════════════════════");
console.log("  1. Chrome will open at instagram.com/accounts/login");
console.log("  2. Log in with your dedicated outreach Instagram account");
console.log("     (use a dedicated account, not your personal one)");
console.log("  3. Once logged in, come back here and press Enter");
console.log("═══════════════════════════════════════════════════════════\n");

const browser = await chromium.launchPersistentContext(PROFILE_DIR, {
  headless: false,
  args: [
    "--disable-blink-features=AutomationControlled",
    "--no-sandbox",
    "--disable-infobars",
  ],
  userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  viewport: { width: 1280, height: 800 },
});

const page = await browser.newPage();
await page.goto("https://www.instagram.com/accounts/login/", { waitUntil: "domcontentloaded" });
await new Promise(r => setTimeout(r, 3_000));

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
await new Promise(resolve => rl.question("\nPress Enter after you've logged in to Instagram... ", resolve));
rl.close();

// Verify
await page.goto("https://www.instagram.com/", { waitUntil: "domcontentloaded", timeout: 15_000 });
await new Promise(r => setTimeout(r, 2_000));
const url      = page.url();
const loggedIn = !url.includes("/accounts/login") && !url.includes("/challenge");

if (loggedIn) {
  console.log("\n✓ Instagram login saved successfully.");
  console.log("  Profile: " + PROFILE_DIR);
  console.log("  The Instagram agent will now run headless using this session.");
  console.log("\n  Next step — send today's Instagram DMs:");
  console.log("  node src/cli/runInstagramAgent.js --dry-run   (preview)");
  console.log("  node src/cli/runInstagramAgent.js              (live send)\n");
} else {
  console.log("\n✗ Login not detected — URL was: " + url);
  console.log("  Try running this script again and complete the login fully.\n");
}

await browser.close();
