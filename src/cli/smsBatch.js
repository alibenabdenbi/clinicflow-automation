// src/cli/smsBatch.js
// Batch SMS sender for no-website dental clinics.
// Sends a brief outreach pitch via Twilio to clinics with phones but no website.
//
// Usage:
//   node src/cli/smsBatch.js --preview          # Show 3 sample messages, no sends
//   node src/cli/smsBatch.js --market nowebsite # Send to nowebsite queue
//   node src/cli/smsBatch.js --limit 10         # Cap sends (default: 20/day)
//   node src/cli/smsBatch.js --dry-run          # Log what would send, don't send

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import { sendSMS, lookupLineType } from "../services/smsService.js";
import { smsTemplate1, smsTemplate2, smsTemplate3 } from "../templates/smsTemplates.js";

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const DATA_DIR = path.join(ROOT, "data");

const NOWEBSITE_PATH = path.join(DATA_DIR, "outreach.noWebsiteClinics.json");
const SMS_LOG_PATH   = path.join(DATA_DIR, "sms.sendlog.json");

const MAX_SMS_PER_DAY = Number(process.env.MAX_SMS_PER_DAY || 20);

// ─── Args ─────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const PREVIEW  = args.includes("--preview");
const DRY_RUN  = args.includes("--dry-run");
const limitIdx = args.indexOf("--limit");
const LIMIT    = limitIdx !== -1 ? Number(args[limitIdx + 1]) : MAX_SMS_PER_DAY;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function readJsonSafe(p, fallback) {
  try {
    if (!fs.existsSync(p)) return fallback;
    return JSON.parse(fs.readFileSync(p, "utf-8")) ?? fallback;
  } catch { return fallback; }
}

function writeJsonSafe(p, data) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(data, null, 2), "utf-8");
}

function todayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}

// ─── SMS body builder ─────────────────────────────────────────────────────────

/**
 * Build the initial outreach SMS body for a no-website clinic.
 * Uses template1 from smsTemplates.js — no URL, no price, STOP only here.
 */
function buildSmsBody(clinic) {
  const city = (clinic.city || "your area").trim();
  return smsTemplate1(city);
}

// ─── Send log helpers ─────────────────────────────────────────────────────────

function loadSmsLog() {
  return readJsonSafe(SMS_LOG_PATH, { byDate: {}, byPhone: {} });
}

function phoneSentToday(log, phone) {
  const today = todayKey();
  return !!(log.byPhone?.[phone]?.some?.((e) => e.date === today));
}

function countSentToday(log) {
  const today = todayKey();
  return Number(log.byDate?.[today] || 0);
}

function recordSend(log, phone, clinicName, sid) {
  const today = todayKey();
  log.byDate[today] = (log.byDate[today] || 0) + 1;
  if (!log.byPhone[phone]) log.byPhone[phone] = [];
  log.byPhone[phone].push({ date: today, sid, clinicName });
  return log;
}

// ─── Preview mode ─────────────────────────────────────────────────────────────

function runPreview(clinics) {
  const candidates = clinics.filter(
    (c) => c.phone && c.phoneValid && (c.quality === "ready" || !c.quality)
  );

  console.log(`\n${"─".repeat(56)}`);
  console.log("SMS BATCH — PREVIEW MODE (no messages sent)");
  console.log(`${"─".repeat(56)}`);
  console.log(`Queue size (phone + ready): ${candidates.length}`);
  console.log(`Daily send limit:           ${LIMIT}`);
  console.log(`From number:                ${process.env.TWILIO_FROM_NUMBER || "NOT SET"}`);
  console.log(`${"─".repeat(56)}\n`);

  const samples = candidates.slice(0, 3);
  samples.forEach((clinic, i) => {
    const body = buildSmsBody(clinic);
    console.log(`── Sample ${i + 1} ──────────────────────────────────────────`);
    console.log(`To:    ${clinic.phoneFormatted || clinic.phone}`);
    console.log(`Name:  ${clinic.clinicName}`);
    console.log(`City:  ${clinic.city}, ${clinic.province}`);
    console.log(`Chars: ${body.length} (${body.length > 160 ? "multi-part" : "single segment"})`);
    console.log(`\nBody:\n${body}\n`);
  });

  console.log(`${"─".repeat(56)}`);
  console.log(`Run without --preview to send (up to ${LIMIT} today).`);
  console.log(`${"─".repeat(56)}\n`);
}

// ─── Main send loop ───────────────────────────────────────────────────────────

async function runBatch(clinics) {
  const log = loadSmsLog();
  const alreadySentToday = countSentToday(log);

  if (alreadySentToday >= LIMIT) {
    console.log(`Daily SMS limit reached (${alreadySentToday}/${LIMIT}). No sends today.`);
    return;
  }

  const remaining = LIMIT - alreadySentToday;

  const candidates = clinics.filter((c) => {
    if (!c.phone || !c.phoneValid) return false;
    if (c.smsSent || c.smsStatus === "sent") return false;
    if (phoneSentToday(log, c.phone)) return false;
    if (c.quality === "skip") return false;
    return true;
  });

  console.log(`\n${"─".repeat(56)}`);
  console.log(`SMS BATCH — ${DRY_RUN ? "DRY RUN" : "LIVE"}`);
  console.log(`${"─".repeat(56)}`);
  console.log(`Candidates: ${candidates.length}  |  Cap today: ${remaining}  |  Sending: ${Math.min(candidates.length, remaining)}`);
  console.log("");

  const toSend = candidates.slice(0, remaining);
  let sent = 0;
  let failed = 0;
  let landlineSkipped = 0;

  for (const clinic of toSend) {
    const body = buildSmsBody(clinic);
    const phone = clinic.phone;

    if (DRY_RUN) {
      console.log(`[DRY RUN] Would send to ${clinic.phoneFormatted || phone} (${clinic.clinicName})`);
      console.log(`  Body (${body.length} chars): ${body}\n`);
      sent++;
      continue;
    }

    // ── Landline check ($0.005/lookup — skip landlines, they can't receive SMS) ─
    process.stdout.write(`Checking line type for ${clinic.phoneFormatted || phone}… `);
    const lineType = await lookupLineType(phone);
    if (lineType === "landline") {
      console.log(`skipped (landline)`);
      clinic.smsStatus = "landline_skipped";
      clinic.smsLineType = lineType;
      landlineSkipped++;
      continue;
    }
    console.log(`${lineType} — sending`);

    process.stdout.write(`  → ${clinic.clinicName}… `);
    try {
      const result = await sendSMS(phone, body);
      console.log(`✅ ${result.sid}`);

      // Update log
      recordSend(log, phone, clinic.clinicName, result.sid);

      // Mark clinic record
      clinic.smsSent    = true;
      clinic.smsStatus  = "sent";
      clinic.smsSid     = result.sid;
      clinic.smsSentAt  = new Date().toISOString();
      clinic.smsBody    = body;
      clinic.smsLineType = lineType;

      sent++;
    } catch (err) {
      console.log(`❌ ${err.message}`);
      if (err.code) console.log(`  Twilio code: ${err.code}`);
      clinic.smsStatus = "failed";
      clinic.smsError  = err.message;
      failed++;
    }

    // Respect Twilio rate limits — 1 msg/sec safe default
    await new Promise((r) => setTimeout(r, 1100));
  }

  if (!DRY_RUN) {
    writeJsonSafe(SMS_LOG_PATH, log);
    writeJsonSafe(NOWEBSITE_PATH, clinics);
  }

  console.log(`\n${"─".repeat(56)}`);
  console.log(`Sent:             ${sent}`);
  console.log(`Failed:           ${failed}`);
  console.log(`Landline skipped: ${landlineSkipped}`);
  console.log(`Cap skipped:      ${candidates.length - toSend.length} (daily cap)`);
  console.log(`Log:              ${SMS_LOG_PATH}`);
  console.log(`${"─".repeat(56)}\n`);
}

// ─── Entry ────────────────────────────────────────────────────────────────────

const clinics = readJsonSafe(NOWEBSITE_PATH, []);

if (!Array.isArray(clinics) || clinics.length === 0) {
  console.error("❌ No clinics found in", NOWEBSITE_PATH);
  process.exit(1);
}

if (PREVIEW) {
  runPreview(clinics);
} else {
  runBatch(clinics).catch((err) => {
    console.error("❌ smsBatch failed:", err.message);
    process.exit(1);
  });
}
