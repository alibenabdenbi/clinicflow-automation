// src/cli/runGMBAgent.js
// Runs the GMB message agent against today's targets.
// Usage:
//   node src/cli/runGMBAgent.js              — send today's 10 GMB messages (headless)
//   node src/cli/runGMBAgent.js --login-only — open browser visibly to log in
//   node src/cli/runGMBAgent.js --dry-run    — show messages without sending
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";

dotenv.config();
if (process.platform === "win32") process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

const __dirname     = path.dirname(fileURLToPath(import.meta.url));
const ROOT          = path.resolve(__dirname, "../..");
const TARGETS_PATH  = path.join(ROOT, "data", "daily-targets.json");

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

const today    = new Date().toISOString().slice(0, 10);
const gmbList  = targets.gmb || [];

if (!loginOnly && gmbList.length === 0) {
  console.error("No GMB targets in daily-targets.json. Run generateDailyTargets.js first.");
  process.exit(1);
}

const { sendGMBMessages } = await import("../agents/gmbAgent.js");

console.log(`\nGMB Agent — ${loginOnly ? "LOGIN ONLY" : `sending to ${gmbList.length} clinics`}`);
console.log(`Targets date: ${targets.date} | Today: ${today}`);
if (targets.date !== today && !loginOnly) {
  console.log("⚠ Targets were generated yesterday — run generateDailyTargets.js to refresh");
}

const results = await sendGMBMessages(gmbList, { loginOnly, dryRun });

if (!loginOnly && !dryRun) {
  const sent = results.filter(r => r.status === "sent").length;
  console.log(`\n✓ Done — ${sent}/${gmbList.length} messages sent`);
  console.log(`Log: data/gmb-agent-log.json`);
}
