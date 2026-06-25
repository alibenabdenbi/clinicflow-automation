// src/cli/sendSMSOutreach.js
// B2B SMS outreach to dental clinic phone numbers via Twilio.
// CASL-compliant: B2B SMS to business numbers is legal in Canada.
// Every message includes opt-out instruction.
//
// Usage:
//   node src/cli/sendSMSOutreach.js             — send up to 20 SMS today
//   node src/cli/sendSMSOutreach.js --dry-run   — preview messages without sending
//   node src/cli/sendSMSOutreach.js --limit 5   — send only 5
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import { sendSMS } from "../services/smsService.js";

dotenv.config();
if (process.platform === "win32") process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

const __dirname     = path.dirname(fileURLToPath(import.meta.url));
const ROOT          = path.resolve(__dirname, "../..");
const DATA_DIR      = path.join(ROOT, "data");
const OUTREACH_PATH = path.join(DATA_DIR, "outreach.localDentists.json");
const SENDLOG_PATH  = path.join(DATA_DIR, "sms.outreach.log.json");

const args   = process.argv.slice(2);
const DRY    = args.includes("--dry-run");
const LIMIT  = (() => { const i = args.indexOf("--limit"); return i !== -1 ? Number(args[i + 1]) : 20; })();
const DELAY  = 30_000; // 30 seconds between sends

function readJsonSafe(p, fb) {
  try { if (!fs.existsSync(p)) return fb; return JSON.parse(fs.readFileSync(p, "utf-8")); }
  catch { return fb; }
}
function writeJson(p, data) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(data, null, 2), "utf-8");
}
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

function normalizePhone(raw) {
  if (!raw) return null;
  // Strip everything except digits and leading +
  const digits = raw.replace(/[^\d+]/g, "");
  // Already E.164 with country code
  if (digits.startsWith("+")) return digits;
  // 10-digit North American number
  if (digits.length === 10) return `+1${digits}`;
  // 11-digit with leading 1
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return null; // can't normalize
}

// ─── Message builder ──────────────────────────────────────────────────────────

function buildMessage(clinic) {
  const city = (clinic.city || "").split(",")[0].trim();
  const pain = clinic.painSignals?.[0] || null;
  const name = (clinic.clinicName || "").slice(0, 25);

  if (pain) {
    // Pain-signal version — more specific, higher open rate
    const body = `Hi ${name} — noticed some patients had trouble reaching you. I fix that with automatic text-back in 60 sec. clinicflowautomation.com`;
    const full = body + " — Reply STOP to opt out";
    if (full.length <= 160) return full;
  }

  // Standard version
  const body = `Hi, I help dental clinics in ${city} auto-text missed callers in 60 sec. One-time setup, no monthly fees. clinicflowautomation.com`;
  return body + " — Reply STOP to opt out";
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function run() {
  const today   = todayKey();
  const all     = readJsonSafe(OUTREACH_PATH, []);
  const sendlog = readJsonSafe(SENDLOG_PATH, []);

  // Build set of already-contacted numbers
  const alreadySent = new Set(sendlog.map(e => e.phone));

  // Count how many sent today (respect daily limit)
  const sentToday = sendlog.filter(e => e.sentAt?.startsWith(today)).length;
  const remaining = LIMIT - sentToday;

  if (remaining <= 0 && !DRY) {
    console.log(`Daily limit reached: already sent ${sentToday} today (max ${LIMIT})`);
    return;
  }

  // Candidates: todo clinics with phone, not yet SMS-contacted
  const candidates = all
    .filter(c => {
      const rawPhone = c.phone || c.googlePhone;
      if (!rawPhone) return false;
      const phone = normalizePhone(rawPhone);
      if (!phone) return false; // skip un-normalizable numbers
      if (c.status !== "todo") return false;
      if (c.smsContactedAt) return false;
      if (alreadySent.has(phone)) return false;
      return true;
    })
    .sort((a, b) => {
      // Pain signals first
      if ((b.painScore || 0) !== (a.painScore || 0)) return (b.painScore || 0) - (a.painScore || 0);
      // Then GMB-enriched (have more data)
      if (!!b.placeId !== !!a.placeId) return b.placeId ? 1 : -1;
      // Then by review count
      return (b.reviewCount || 0) - (a.reviewCount || 0);
    })
    .slice(0, DRY ? LIMIT : remaining);

  console.log(`\nSMS Outreach — ${DRY ? "DRY RUN" : "LIVE"} | candidates: ${candidates.length} | limit: ${LIMIT} | sent today: ${sentToday}`);

  if (candidates.length === 0) {
    console.log("No eligible candidates — all todo clinics with phones already contacted.");
    return;
  }

  let sent = 0, errors = 0;

  for (let i = 0; i < candidates.length; i++) {
    const clinic = candidates[i];
    const phone  = normalizePhone(clinic.phone || clinic.googlePhone);
    const msg    = buildMessage(clinic);
    const city   = (clinic.city || "").split(",")[0];

    console.log(`\n[${i + 1}/${candidates.length}] ${clinic.clinicName} — ${city}`);
    console.log(`  To:  ${phone}`);
    console.log(`  Msg: "${msg}" (${msg.length} chars)`);

    if (DRY) { sent++; continue; }

    try {
      await sendSMS(phone, msg);
      sent++;
      console.log(`  ✓ Sent`);

      const logEntry = {
        clinicName: clinic.clinicName,
        phone,
        city: clinic.city || "",
        message: msg,
        sentAt: new Date().toISOString(),
        painSignal: clinic.painSignals?.[0] || null,
      };
      sendlog.push(logEntry);

      // Update clinic record
      const idx = all.findIndex(c => c.clinicName === clinic.clinicName);
      if (idx !== -1) {
        all[idx].smsContactedAt = logEntry.sentAt;
        all[idx].smsMessage     = msg;
      }

    } catch (e) {
      console.log(`  ✗ Error: ${e.message.slice(0, 80)}`);
      errors++;
    }

    if (i < candidates.length - 1) {
      console.log(`  Waiting ${DELAY / 1000}s...`);
      await sleep(DELAY);
    }
  }

  if (!DRY) {
    writeJson(SENDLOG_PATH, sendlog);
    writeJson(OUTREACH_PATH, all);
  }

  console.log(`\n${"─".repeat(50)}`);
  console.log(`SMS Outreach done: sent=${sent} errors=${errors} ${DRY ? "(dry run)" : ""}`);
  console.log(`Log: ${SENDLOG_PATH}`);
}

run().catch(e => { console.error(e.message); process.exit(1); });
