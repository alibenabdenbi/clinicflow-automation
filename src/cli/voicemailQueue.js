// src/cli/voicemailQueue.js
// Generates a daily call list of 10 dental clinics with phone numbers.
// Best call window: 10am–12pm local time.
//
// Usage:
//   node src/cli/voicemailQueue.js [--mark-called <id>] [--limit N]
//
// --mark-called <id>   Mark a clinic as called (by id or clinicName)
// --limit N            Show N clinics (default: 10)
// --show-all           Show all pending (no limit)

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import { buildScript, selectScript, estimateDuration } from "../voicemail/voicemailScripts.js";

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");

const OUTREACH_PATH = process.env.OUTREACH_JSON_PATH ||
  path.join(ROOT, "data", "outreach.localDentists.json");
const VOICEMAIL_LOG_PATH = path.join(ROOT, "data", "voicemail-called.json");

const LIMIT = (() => {
  if (process.argv.includes("--show-all")) return Infinity;
  const i = process.argv.indexOf("--limit");
  return i !== -1 ? Number(process.argv[i + 1]) : 10;
})();

const MARK_CALLED_ARG = (() => {
  const i = process.argv.indexOf("--mark-called");
  return i !== -1 ? process.argv[i + 1] : null;
})();

function readJsonSafe(p, fb) {
  try { return JSON.parse(fs.readFileSync(p, "utf-8")); } catch { return fb; }
}

function writeJsonSafe(p, data) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(data, null, 2), "utf-8");
}

function todayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function formatPhone(phone) {
  const digits = String(phone || "").replace(/\D/g, "");
  if (digits.length === 10) return `(${digits.slice(0,3)}) ${digits.slice(3,6)}-${digits.slice(6)}`;
  if (digits.length === 11 && digits[0] === "1") return `+1 (${digits.slice(1,4)}) ${digits.slice(4,7)}-${digits.slice(7)}`;
  return phone;
}

async function main() {
  const records = readJsonSafe(OUTREACH_PATH, []);
  const calledLog = readJsonSafe(VOICEMAIL_LOG_PATH, {});

  // ── Mark a clinic as called ────────────────────────────────────────────────
  if (MARK_CALLED_ARG) {
    const target = records.find(r =>
      r.id === MARK_CALLED_ARG ||
      (r.clinicName || "").toLowerCase().includes(MARK_CALLED_ARG.toLowerCase())
    );
    if (!target) {
      console.log(`Clinic not found: "${MARK_CALLED_ARG}"`);
      process.exit(1);
    }
    const key = target.id || target.clinicName;
    calledLog[key] = { calledAt: new Date().toISOString(), clinicName: target.clinicName };
    writeJsonSafe(VOICEMAIL_LOG_PATH, calledLog);
    console.log(`✓ Marked as called: ${target.clinicName}`);
    process.exit(0);
  }

  // ── Build call list ────────────────────────────────────────────────────────
  const calledKeys = new Set(Object.keys(calledLog));
  const today = todayKey();

  // Find clinics with phone numbers that haven't been called
  const withPhone = records.filter(r => {
    if (!r.phone) return false;
    const key = r.id || r.clinicName;
    if (calledKeys.has(key)) return false;
    const mkt = r.market || null;
    if (mkt && mkt !== "dental") return false;
    return true;
  });

  // Priority: same as sendBatch — prefer sent clinics (warm), then todo
  withPhone.sort((a, b) => {
    const aWarm = ["sent", "followup_1_sent", "followup_2_sent"].includes(a.status) ? 1 : 0;
    const bWarm = ["sent", "followup_1_sent", "followup_2_sent"].includes(b.status) ? 1 : 0;
    if (bWarm !== aWarm) return bWarm - aWarm;
    return (b.opportunityScore || 0) - (a.opportunityScore || 0);
  });

  const list = isFinite(LIMIT) ? withPhone.slice(0, LIMIT) : withPhone;

  // ── Display ────────────────────────────────────────────────────────────────
  console.log(`\nVoicemail Call List — ${today}`);
  console.log(`Best time to call: 10:00am – 12:00pm local`);
  console.log(`Your number to give: 438-544-0442`);
  console.log(`${"─".repeat(60)}`);

  if (withPhone.length === 0) {
    console.log(`\n⚠  No clinics with phone numbers found in outreach queue.`);
    console.log(`\nTo add phone numbers, run the enrichment with phone discovery:`);
    console.log(`  node src/cli/enrichEmails.js --force`);
    console.log(`\nOr manually add a "phone" field to records in:`);
    console.log(`  ${OUTREACH_PATH}`);
    console.log(`\nAlternatively, the OSM discover script may include phones for new clinics:`);
    console.log(`  npm run discover -- Toronto ON`);
    process.exit(0);
  }

  for (let i = 0; i < list.length; i++) {
    const r = list[i];
    const scriptNum = selectScript(r);
    const script = buildScript(scriptNum, { clinicName: r.clinicName, city: r.city });
    const duration = estimateDuration(script);
    const status = r.status || "todo";
    const warm = ["sent", "followup_1_sent", "followup_2_sent"].includes(status) ? " [emailed]" : "";
    const key = r.id || r.clinicName;

    console.log(`\n${i + 1}. ${r.clinicName || "(unnamed)"}${warm}`);
    console.log(`   Phone:   ${formatPhone(r.phone)}`);
    console.log(`   City:    ${r.city || "unknown"}`);
    console.log(`   Script:  ${scriptNum} (${duration}s estimated)`);
    console.log(`   Mark called: node src/cli/voicemailQueue.js --mark-called "${key}"`);
    console.log(`\n   ─── Script ${scriptNum} ──────────────────────────────────`);
    console.log(`   ${script}`);
    console.log(`   ${"─".repeat(54)}`);
  }

  console.log(`\n${"─".repeat(60)}`);
  console.log(`  Showing: ${list.length} of ${withPhone.length} clinics with phones`);
  console.log(`  Already called: ${calledKeys.size}`);
  console.log(`  Total in queue with phone: ${withPhone.length}`);
  console.log(`\nTip: Call between 10am–12pm. Dental front desks are least busy then.`);
}

main().catch(e => { console.error(e.message); process.exit(1); });
