// src/cli/twilioCallQueue.js
// Automated Twilio voice calls with AMD (Answering Machine Detection).
// Targets clinics with phone but no personal cell, OR where ringless drop unavailable.
//
// Live answer: 30-second script via Polly Neural TTS
// Voicemail detected: 20-second shorter script
//
// Daily cap: 10 calls, Mon-Fri only, 10am-3pm only
// Never call same clinic twice.
//
// Usage:
//   node src/cli/twilioCallQueue.js
//   node src/cli/twilioCallQueue.js --dry-run

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import twilio from "twilio";

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const DATA_DIR = path.join(ROOT, "data");
const OUTREACH_PATH = path.join(DATA_DIR, "outreach.localDentists.json");
const CALL_LOG      = path.join(DATA_DIR, "calls", "call-log.json");

const TWILIO_SID   = (process.env.TWILIO_ACCOUNT_SID  || "").trim();
const TWILIO_TOKEN = (process.env.TWILIO_AUTH_TOKEN    || "").trim();
const TWILIO_FROM  = (process.env.TWILIO_FROM_NUMBER || process.env.TWILIO_PHONE_NUMBER || "").trim();

const DAILY_CAP = 10;
const CALLBACK_NUMBER = "438-544-0442";
const CALLBACK_EMAIL  = "contact at clinicflow automation dot com";

const args = process.argv.slice(2);
const DRY_RUN = args.includes("--dry-run");

function readJsonSafe(p, fb) {
  try { if (!fs.existsSync(p)) return fb; return JSON.parse(fs.readFileSync(p, "utf-8")); }
  catch { return fb; }
}

function writeJsonSafe(p, data) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(data, null, 2), "utf-8");
}

function isWeekday() {
  const d = new Date().getDay();
  return d >= 1 && d <= 5;
}

function isCallWindow() {
  const h = new Date().getHours();
  return h >= 10 && h < 15;
}

// Unified TwiML — works for both live answer and voicemail.
// If a pre-generated ElevenLabs Eric MP3 exists for this clinic, plays it via <Play>.
// Falls back to Polly.Matthew-Neural <Say> when no MP3 is available.
function clinicSlug(name) {
  return (name || "clinic").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
}

function buildCallTwiML(clinicName) {
  const clinic = (clinicName || "your clinic").split(/[|\-–]/)[0].trim().slice(0, 40);
  const slug   = clinicSlug(clinicName);
  const mp3Path = path.join(ROOT, "public", "netlify-deploy", "audio", `${slug}-voicemail.mp3`);
  const audioBase = "https://clinicflow-client-portal.netlify.app/audio";

  if (fs.existsSync(mp3Path)) {
    // ElevenLabs Eric MP3 is available — play it directly
    const audioUrl = `${audioBase}/${slug}-voicemail.mp3`;
    return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Pause length="1"/>
  <Play>${audioUrl}</Play>
</Response>`;
  }

  // Fallback: Polly Neural TTS
  const script = `Hey, this is Mohamed from ClinicFlow in Montreal. Quick message for ${clinic} — I look at communication setups for dental clinics and found something specific worth sharing. Takes 10 minutes, no charge. Call me back at ${CALLBACK_NUMBER}. Thanks.`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Pause length="1"/>
  <Say voice="Polly.Matthew-Neural">${script.replace(/&/g, "&amp;")}</Say>
</Response>`;
}

// Sync AMD — Twilio detects machine vs live before playing, then plays the
// unified script. No webhook required. DetectMessageEnd waits for the beep.
async function placeCall(client, { phone, clinicName }) {
  const twiml = buildCallTwiML(clinicName);

  const call = await client.calls.create({
    to: phone,
    from: TWILIO_FROM,
    twiml,
    machineDetection: "DetectMessageEnd",
    asyncAmd: false,
  });

  return call.sid;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

if (!isWeekday()) {
  console.log("Weekend — skipping calls (Mon-Fri only).");
  process.exit(0);
}

if (!isCallWindow() && !DRY_RUN) {
  console.log("Outside call window (10am-3pm). Skipping.");
  console.log(`Current hour: ${new Date().getHours()}:00`);
  process.exit(0);
}

const leads = readJsonSafe(OUTREACH_PATH, []);
const callLog = readJsonSafe(CALL_LOG, []);

// Clinics already called (by phone or email)
const calledPhones = new Set(callLog.map(c => c.phone).filter(Boolean));
const calledEmails = new Set(callLog.map(c => c.email).filter(Boolean));

// Statuses that should never receive a call
const SKIP_STATUSES = new Set(["bounced", "no_mx", "skip_duplicate", "already_equipped", "cooling_off"]);

// Priority order: most-touched-by-email first (voice = 4th touch converts best)
const STATUS_PRIORITY = { followup_2_sent: 4, followup_1_sent: 3, sent: 2, todo: 1 };

const eligible = leads
  .map((l, idx) => ({ l, idx }))
  .filter(({ l }) => {
    const phone = l.phone || l.rcdsoPhone || l.personalPhone;
    if (!phone) return false;
    const status = l.status || "todo";
    if (SKIP_STATUSES.has(status)) return false;
    // Never call a clinic twice
    const phones = [l.phone, l.rcdsoPhone, l.personalPhone].filter(Boolean);
    if (phones.some(p => calledPhones.has(p))) return false;
    if (l.email && calledEmails.has(l.email)) return false;
    return true;
  })
  .sort((a, b) => {
    const pa = STATUS_PRIORITY[a.l.status || "todo"] || 0;
    const pb = STATUS_PRIORITY[b.l.status || "todo"] || 0;
    return pb - pa;
  })
  .slice(0, DAILY_CAP);

const configured = !!(TWILIO_SID && TWILIO_TOKEN && TWILIO_FROM);
const client = configured ? twilio(TWILIO_SID, TWILIO_TOKEN) : null;

const eligibleByStatus = eligible.reduce((acc, { l }) => {
  const s = l.status || "todo";
  acc[s] = (acc[s] || 0) + 1;
  return acc;
}, {});

console.log(`\nTwilio Call Queue`);
console.log(`Mode: ${DRY_RUN ? "dry-run" : "live"}`);
console.log(`Twilio: ${configured ? "configured" : "not configured"}`);
console.log(`Call window: 10am-3pm | Daily cap: ${DAILY_CAP}`);
console.log(`Eligible: ${eligible.length} clinics`);
if (eligible.length > 0) {
  const breakdown = Object.entries(eligibleByStatus).map(([s, n]) => `${s}×${n}`).join(", ");
  console.log(`  Priority breakdown: ${breakdown}`);
}
console.log("");

let callsMade = 0;
const results = [];

for (const { l, idx } of eligible) {
  const phone = l.phone || l.rcdsoPhone || l.personalPhone;
  const city  = l.city || "";
  const name  = l.clinicName || "";

  process.stdout.write(`  ${name.slice(0, 38).padEnd(38)} ${phone}  `);

  if (DRY_RUN) {
    const liveScript = buildCallTwiML(name).match(/<Say[^>]*>([^<]+)<\/Say>/)?.[1] || "";
    console.log(`[DRY-RUN]`);
    console.log(`    Live:      "${liveScript.slice(0, 80)}…"`);
    results.push({ clinicName: name, phone, city, outcome: "dry_run" });
    continue;
  }

  if (!configured) {
    console.log(`[SKIP] Twilio not configured`);
    continue;
  }

  try {
    const callSid = await placeCall(client, { phone, clinicName: name });
    console.log(`✓ called (SID: ${callSid})`);
    callsMade++;

    const entry = {
      clinicName:        name,
      city,
      email:             l.email || "",
      phone,
      callSid,
      outcome:           "dialed",
      scriptType:        "auto-amd",
      timestamp:         new Date().toISOString(),
      followUpEmailDue:  new Date(Date.now() + 86_400_000).toISOString().slice(0, 10),
      followUpEmailSent: false,
    };
    callLog.push(entry);
    results.push(entry);

    // Mark in outreach record
    leads[idx].calledAt    = new Date().toISOString();
    leads[idx].callSid     = callSid;

  } catch (err) {
    console.log(`✗ ${err.message}`);
    callLog.push({
      clinicName: name, city, email: l.email || "", phone,
      callSid: null, outcome: "error", error: err.message,
      scriptType: "auto-amd", timestamp: new Date().toISOString(),
    });
  }
}

if (!DRY_RUN && callsMade > 0) {
  writeJsonSafe(CALL_LOG, callLog);
  writeJsonSafe(OUTREACH_PATH, leads);
}

console.log(`\n${"─".repeat(56)}`);
console.log(`  Twilio Calls — ${callsMade} calls placed`);
console.log(`  Log → ${CALL_LOG}`);
console.log(DRY_RUN ? "\n  (dry-run — no calls placed)" : "");
