// src/cli/loginGMBAgent.js
// First-run login for the GMB browser agent.
// Opens a visible Chrome window at accounts.google.com.
// Log in to the dedicated outreach Google account, then press Enter here.
//
// Usage: node src/cli/loginGMBAgent.js
import { chromium } from "playwright";
import fs from "fs";
import readline from "readline";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";

dotenv.config();

const __dirname    = path.dirname(fileURLToPath(import.meta.url));
const ROOT         = path.resolve(__dirname, "../..");
const PROFILE_DIR  = path.join(ROOT, "data", "browser-profiles", "gmb-agent");

fs.mkdirSync(PROFILE_DIR, { recursive: true });

console.log("\n═══════════════════════════════════════════════════════════");
console.log("  GMB Agent — Google Login");
console.log("═══════════════════════════════════════════════════════════");
console.log("  1. Chrome will open and navigate to accounts.google.com");
console.log("  2. Log in with the Google account you'll use for outreach");
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
await page.goto("https://accounts.google.com", { waitUntil: "domcontentloaded" });

// Prompt — only works when stdin is a real TTY (run directly, not via heredoc)
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
await new Promise(resolve => rl.question("\nPress Enter after you've logged in to Google... ", resolve));
rl.close();

// Verify
await page.goto("https://myaccount.google.com", { waitUntil: "domcontentloaded", timeout: 15_000 });
await new Promise(r => setTimeout(r, 2_000));
const url      = page.url();
const loggedIn = url.includes("myaccount.google.com") && !url.includes("signin");

if (loggedIn) {
  console.log("\n✓ Google login saved successfully.");
  console.log("  Profile: " + PROFILE_DIR);
  console.log("  The GMB agent will now run headless using this session.");
  console.log("\n  Next step — send today's GMB messages:");
  console.log("  node src/cli/runGMBAgent.js --dry-run   (preview)");
  console.log("  node src/cli/runGMBAgent.js              (live send)\n");
} else {
  console.log("\n✗ Login not detected — URL was: " + url);
  console.log("  Try running this script again and complete the login fully.\n");
}

await browser.close();
