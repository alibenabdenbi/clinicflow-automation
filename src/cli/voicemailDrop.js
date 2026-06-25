// src/cli/voicemailDrop.js
// Schedules ringless voicemail drops via Slybroadcast API.
// Only runs Mon-Fri. Schedules for next Tue/Wed/Thu at 11:30am in the clinic's
// local timezone (highest B2B callback rate window).
// Skips confirmed landlines — ringless voicemail only works on mobile/VoIP.
//
// Usage:
//   node src/cli/voicemailDrop.js
//   node src/cli/voicemailDrop.js --dry-run

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import fetch from "node-fetch";
import { sendSMS, lookupLineType } from "../services/smsService.js";

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const DATA_DIR = path.join(ROOT, "data");
const OUTREACH_PATH = path.join(DATA_DIR, "outreach.localDentists.json");
const DROPS_LOG     = path.join(DATA_DIR, "calls", "voicemail-drops.json");

const SLY_EMAIL    = (process.env.SLYBROADCAST_EMAIL    || "").trim();
const SLY_PASS     = (process.env.SLYBROADCAST_PASSWORD || "").trim();
const NOTIFY_PHONE = process.env.NOTIFY_PHONE || "+15149617077";
const AUDIO_BASE_URL = "https://clinicflow-client-portal.netlify.app/audio";

// Caller ID shown in recipient's voicemail — must be 10-digit NA number
const CALLER_ID = (process.env.CALLER_ID || NOTIFY_PHONE).replace(/\D/g, "").replace(/^1/, "");

const DAILY_CAP = 10;

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

// Map city → hours to ADD to ET to reach local time (standard time offsets)
// Slybroadcast's c_date is interpreted as Eastern Time (their server default).
function cityToEtOffset(city) {
  const c = (city || "").toLowerCase();
  if (/vancouver|burnaby|victoria|surrey|richmond|kelowna|kamloops/.test(c)) return -3; // PST = ET-3
  if (/calgary|edmonton|lethbridge|red deer|banff/.test(c))                   return -2; // MST = ET-2
  if (/winnipeg|saskatoon|regina/.test(c))                                    return -1; // CST = ET-1
  return 0; // Toronto, Ottawa, Montreal, Halifax, London ON = ET
}

// Returns next Tuesday, Wednesday, or Thursday (never today)
function nextTueWedThu() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  while (![2, 3, 4].includes(d.getDay())) d.setDate(d.getDate() + 1);
  return d;
}

// Schedule string for Slybroadcast: next Tue/Wed/Thu at 11:30am local, in ET
function scheduleTimeForCity(city) {
  const etOffset = cityToEtOffset(city);
  // local 11:30am → ET = 11:30 - etOffset (e.g. Vancouver ET offset=-3 → 11:30-(-3)=14:30 ET)
  const etHour = 11 - etOffset;
  const d = nextTueWedThu();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mm}-${dd} ${String(etHour).padStart(2, "0")}:30:00`;
}

function clinicSlug(name) {
  return (name || "clinic").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
}

// Schedule a ringless voicemail drop via Slybroadcast public URL
async function scheduleDrop({ phone, audioUrl, scheduleTime }) {
  if (!SLY_EMAIL || !SLY_PASS || SLY_EMAIL === "placeholder") {
    return { ok: false, reason: "slybroadcast_not_configured" };
  }
  if (!audioUrl) {
    return { ok: false, reason: "audio_url_missing" };
  }

  // Slybroadcast expects 11-digit North American number (1XXXXXXXXXX)
  const digits = phone.replace(/\D/g, "");
  const normalized = digits.length === 10 ? `1${digits}` : digits;

  const params = new URLSearchParams({
    c_uid:      SLY_EMAIL,
    c_password: SLY_PASS,
    c_method:   "new_campaign",
    c_phone:    normalized,
    c_url:      audioUrl,
    c_audio:    "mp3",
    c_callerID: CALLER_ID,
    c_date:     scheduleTime,
  });

  try {
    const res = await fetch("https://www.slybroadcast.com/gateway/vmb.json.php", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString(),
    });

    if (!res.ok) return { ok: false, reason: `slybroadcast_http_${res.status}` };
    const json = await res.json();

    console.log(`    API response: ${JSON.stringify(json)}`);
    if (json.new_campaign === "OK" || json.status === "success") {
      return { ok: true, campaignId: json.session_id || json.campaign_id || "unknown" };
    }
    return { ok: false, reason: `slybroadcast: ${JSON.stringify(json).slice(0, 200)}` };
  } catch (err) {
    return { ok: false, reason: err.message };
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

if (!isWeekday()) {
  console.log("Weekend — skipping voicemail drops (Mon-Fri only).");
  process.exit(0);
}

const leads    = readJsonSafe(OUTREACH_PATH, []);
const dropsLog = readJsonSafe(DROPS_LOG, []);

const droppedPhones = new Set(dropsLog.map(d => d.phone).filter(Boolean));

// Eligible: has audio + phone, not already dropped, status todo
// Accepts personalPhone (preferred) or main phone as fallback
const eligible = leads
  .map((l, idx) => ({ l, idx }))
  .filter(({ l }) => {
    const phone = l.personalPhone || l.phone;
    return phone &&
      (l.status || "todo") === "todo" &&
      l.voicemailAudioPath &&
      !droppedPhones.has(phone);
  })
  .slice(0, DAILY_CAP);

console.log(`\nSlybroadcast Voicemail Drop`);
console.log(`Mode: ${DRY_RUN ? "dry-run" : "live"}`);
console.log(`Slybroadcast: ${SLY_EMAIL && SLY_EMAIL !== "placeholder" ? "configured" : "not configured"}`);
console.log(`Eligible clinics: ${eligible.length} (cap: ${DAILY_CAP})\n`);

const scheduled = [];

for (const { l, idx } of eligible) {
  const phone        = l.personalPhone || l.phone;
  const filename     = path.basename(l.voicemailAudioPath || "");
  const audioUrl     = `${AUDIO_BASE_URL}/${filename}`;
  const scheduleTime = scheduleTimeForCity(l.city || "");
  const label        = (l.clinicName || "").slice(0, 38).padEnd(38);

  process.stdout.write(`  ${label} ${phone}  `);

  if (!DRY_RUN) {
    // Skip confirmed landlines — ringless voicemail won't deliver
    const lineType = await lookupLineType(phone);
    if (lineType === "landline" || lineType === "fixedVoip") {
      console.log(`✗ skipped (${lineType})`);
      continue;
    }
    if (lineType !== "unknown") process.stdout.write(`[${lineType}] `);
  }

  if (DRY_RUN) {
    console.log(`[DRY-RUN] would schedule ${scheduleTime} → ${audioUrl}`);
    scheduled.push({ clinicName: l.clinicName, phone, audioUrl, scheduled: scheduleTime, result: "dry_run" });
    continue;
  }

  const result = await scheduleDrop({ phone, audioUrl, scheduleTime });
  if (result.ok) {
    console.log(`✓ scheduled ${scheduleTime} (campaign: ${result.campaignId})`);
    dropsLog.push({
      clinicName:   l.clinicName,
      city:         l.city || "",
      email:        l.email || "",
      phone,
      audioUrl,
      scheduleTime,
      campaignId:   result.campaignId,
      droppedAt:    new Date().toISOString(),
      followupSent: false,
    });
    leads[idx].voicemailDropAt = new Date().toISOString();
    scheduled.push({ clinicName: l.clinicName, phone, scheduled: scheduleTime, campaignId: result.campaignId });
  } else {
    console.log(`✗ ${result.reason}`);
  }
}

if (!DRY_RUN && scheduled.length > 0) {
  writeJsonSafe(DROPS_LOG, dropsLog);
  writeJsonSafe(OUTREACH_PATH, leads);

  try {
    const dateStr = nextTueWedThu().toISOString().slice(0, 10);
    await sendSMS(NOTIFY_PHONE, `ClinicFlow: ${scheduled.length} voicemail drop(s) scheduled for ${dateStr} at 11:30am local`);
    console.log(`\n  SMS alert sent to ${NOTIFY_PHONE}`);
  } catch (e) {
    console.warn(`  SMS alert failed: ${e.message}`);
  }
}

console.log(`\n${"─".repeat(56)}`);
console.log(`  Voicemail Drop — ${scheduled.length} drops scheduled`);
console.log(`  Log → ${DROPS_LOG}`);
console.log(DRY_RUN ? "\n  (dry-run — nothing sent)" : "");
