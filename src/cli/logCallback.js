// src/cli/logCallback.js
// Manually log when a clinic calls back after a voice outreach.
//
// Usage:
//   node src/cli/logCallback.js --clinic "Summerville Dentistry"
//   node src/cli/logCallback.js --clinic "Summerville Dentistry" --phone "+19058485522" --notes "Asked about pricing"

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const DATA_DIR = path.join(ROOT, "data");
const CALL_LOG  = path.join(DATA_DIR, "calls", "call-log.json");
const OUTREACH_PATH = path.join(DATA_DIR, "outreach.localDentists.json");

const args = process.argv.slice(2);

function getArg(flag) {
  const i = args.indexOf(flag);
  return i !== -1 ? args[i + 1] : null;
}

const clinicArg = getArg("--clinic");
const phoneArg  = getArg("--phone");
const notesArg  = getArg("--notes");

function readJsonSafe(p, fb) {
  try { if (!fs.existsSync(p)) return fb; return JSON.parse(fs.readFileSync(p, "utf-8")); }
  catch { return fb; }
}

function writeJsonSafe(p, data) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(data, null, 2), "utf-8");
}

if (!clinicArg) {
  console.log(`\nUsage: node src/cli/logCallback.js --clinic "Clinic Name" [--phone "+1..."] [--notes "..."]`);
  console.log(`\nLogs a callback from a clinic into data/calls/call-log.json`);
  process.exit(0);
}

const callLog = readJsonSafe(CALL_LOG, []);
const leads   = readJsonSafe(OUTREACH_PATH, []);

// Find clinic record
const match = leads.find(l =>
  (l.clinicName || "").toLowerCase().includes(clinicArg.toLowerCase())
);

const entry = {
  clinicName:  match?.clinicName || clinicArg,
  city:        match?.city || "",
  email:       match?.email || "",
  phone:       phoneArg || match?.phone || match?.personalPhone || "",
  callSid:     null,
  outcome:     "callback_received",
  scriptType:  "callback",
  notes:       notesArg || "",
  timestamp:   new Date().toISOString(),
};

callLog.push(entry);
writeJsonSafe(CALL_LOG, callLog);

// Update outreach record
if (match) {
  const idx = leads.indexOf(match);
  leads[idx].callbackReceivedAt = new Date().toISOString();
  if (notesArg) leads[idx].callbackNotes = notesArg;
  writeJsonSafe(OUTREACH_PATH, leads);
}

console.log(`\nCallback logged:`);
console.log(`  Clinic: ${entry.clinicName}`);
console.log(`  City:   ${entry.city}`);
console.log(`  Phone:  ${entry.phone || "(not recorded)"}`);
console.log(`  Notes:  ${entry.notes || "(none)"}`);
console.log(`  Time:   ${entry.timestamp}`);
console.log(`\n  Saved → ${CALL_LOG}`);
if (match) console.log(`  Record updated → ${OUTREACH_PATH}`);
else console.log(`  ⚠ No outreach record found for "${clinicArg}"`);
