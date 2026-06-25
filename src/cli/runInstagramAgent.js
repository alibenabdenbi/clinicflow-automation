// src/cli/runInstagramAgent.js
// Runs the Instagram DM agent against today's targets.
// Usage:
//   node src/cli/runInstagramAgent.js              — send today's DMs (headless)
//   node src/cli/runInstagramAgent.js --login-only — open browser visibly to log in
//   node src/cli/runInstagramAgent.js --dry-run    — show messages without sending
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";

dotenv.config();
if (process.platform === "win32") process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

const __dirname    = path.dirname(fileURLToPath(import.meta.url));
const ROOT         = path.resolve(__dirname, "../..");
const TARGETS_PATH = path.join(ROOT, "data", "daily-targets.json");

const args      = process.argv.slice(2);
const loginOnly = args.includes("--login-only");
const dryRun    = args.includes("--dry-run");

const targets = (() => {
  try { return JSON.parse(fs.readFileSync(TARGETS_PATH, "utf-8")); }
  catch { return null; }
})();

if (!targets) {
  console.error("No daily-targets.json found. Run: node src/cli/generateDailyTargets.js first");
  process.exit(1);
}

const igList = targets.instagram || [];

if (!loginOnly && igList.length === 0) {
  console.error("No Instagram targets in daily-targets.json. Run generateDailyTargets.js first.");
  process.exit(1);
}

const { sendInstagramDMs } = await import("../agents/instagramAgent.js");

const today = new Date().toISOString().slice(0, 10);
console.log(`\nInstagram Agent — ${loginOnly ? "LOGIN ONLY" : `sending to ${igList.length} accounts`}`);
console.log(`Targets date: ${targets.date} | Today: ${today}`);
if (targets.date !== today && !loginOnly) {
  console.log("⚠ Targets were generated yesterday — run generateDailyTargets.js to refresh");
}

const results = await sendInstagramDMs(igList, { loginOnly, dryRun });

if (!loginOnly && !dryRun) {
  const sent = results.filter(r => r.status === "sent").length;
  console.log(`\n✓ Done — ${sent}/${igList.length} DMs sent`);
  console.log(`Log: data/instagram-agent-log.json`);
}
