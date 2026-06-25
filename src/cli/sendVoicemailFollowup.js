// src/cli/sendVoicemailFollowup.js
// Post-drop email follow-up: 24h after a confirmed voicemail drop, send an email
// to the same clinic referencing the voicemail.
//
// Creates a two-touch sequence: voicemail day 1 + email day 2.
// Safe to run daily — only sends once per drop, tracks in voicemail-drops.json.
//
// Usage:
//   node src/cli/sendVoicemailFollowup.js
//   node src/cli/sendVoicemailFollowup.js --dry-run

import fs from "fs";
import path from "path";
import dotenv from "dotenv";
import nodemailer from "nodemailer";

dotenv.config();

const DATA_DIR     = path.join(process.cwd(), "data");
const DROPS_LOG    = path.join(DATA_DIR, "calls", "voicemail-drops.json");
const OUTREACH_PATH = path.join(DATA_DIR, "outreach.localDentists.json");
const EMAIL_LOG    = path.join(DATA_DIR, "calls", "voicemail-followup-emails.json");

const SMTP_HOST   = (process.env.SMTP_HOST   || "").trim();
const SMTP_PORT   = Number(process.env.SMTP_PORT   || "587");
const SMTP_USER   = (process.env.SMTP_USER   || "").trim();
const SMTP_PASS   = (process.env.SMTP_PASS   || "").trim();
const SMTP_FROM   = (process.env.SMTP_FROM   || SMTP_USER).trim();
const SMTP_SECURE = SMTP_PORT === 465;
const SENDER_NAME = (process.env.SENDER_NAME || "Mohamed").trim();

const args    = process.argv.slice(2);
const DRY_RUN = args.includes("--dry-run");

const FOLLOW_UP_DELAY_HOURS = 24;

function readJsonSafe(p, fb = []) {
  try { if (!fs.existsSync(p)) return fb; return JSON.parse(fs.readFileSync(p, "utf-8")); }
  catch { return fb; }
}

function writeJsonSafe(p, data) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(data, null, 2), "utf-8");
}

function createTransporter() {
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) return null;
  return nodemailer.createTransport({
    host: SMTP_HOST,
    port: SMTP_PORT,
    secure: SMTP_SECURE,
    auth: { user: SMTP_USER, pass: SMTP_PASS },
    tls: { rejectUnauthorized: false },
  });
}

function buildEmail(drop, clinic) {
  const clinicName = drop.clinicName || "your clinic";
  const subject = `Following up on my voicemail — ${clinicName}`;
  const body = [
    `Hi,`,
    ``,
    `I left you a voicemail yesterday about a free missed call audit for ${clinicName}.`,
    ``,
    `Wanted to follow up by email in case voicemail isn't the best way to reach you.`,
    ``,
    `Most dental clinics I work with are losing between 4 and 8 patients per week from unanswered calls with no follow-up system. I do a free 10-minute audit that shows you the exact number — no obligation, just useful information.`,
    ``,
    `If you'd like to connect, just reply to this email or call me back at 438-544-0442.`,
    ``,
    `${SENDER_NAME}`,
    `ClinicFlow Automation`,
  ].join("\n");

  return { subject, body };
}

// ─── Main ─────────────────────────────────────────────────────────────────────

const drops   = readJsonSafe(DROPS_LOG, []);
const clinics = readJsonSafe(OUTREACH_PATH, []);
const sentLog = readJsonSafe(EMAIL_LOG, []);

const sentDropIds = new Set(sentLog.map(e => e.dropKey).filter(Boolean));

const nowMs   = Date.now();
const dueCutoff = FOLLOW_UP_DELAY_HOURS * 60 * 60 * 1000;

// Find drops that:
//   - have a droppedAt timestamp
//   - are 24h+ ago
//   - have not already had a follow-up sent
//   - have a clinic email on record
const due = drops
  .map((d, i) => ({ d, i }))
  .filter(({ d }) => {
    if (d.followupSent) return false;
    if (!d.droppedAt) return false;
    const age = nowMs - new Date(d.droppedAt).getTime();
    if (age < dueCutoff) return false;
    const dropKey = `${d.clinicName}|${d.droppedAt}`;
    if (sentDropIds.has(dropKey)) return false;
    // Must have an email — use drop's own email first, fall back to outreach lookup
    const clinic = clinics.find(c => c.clinicName === d.clinicName);
    const email = d.email || clinic?.email;
    if (!email) return false;
    return true;
  });

console.log(`\nVoicemail Follow-up Email`);
console.log(`Mode: ${DRY_RUN ? "dry-run" : "live"}`);
console.log(`SMTP: ${SMTP_HOST && SMTP_USER ? "configured" : "not configured"}`);
console.log(`Due for follow-up: ${due.length}\n`);

const transporter = createTransporter();
let sent = 0;

for (const { d, i } of due) {
  const clinic  = clinics.find(c => c.clinicName === d.clinicName);
  const email   = d.email || clinic?.email;
  const dropKey = `${d.clinicName}|${d.droppedAt}`;
  const { subject, body } = buildEmail(d, clinic);

  console.log(`  ${(d.clinicName || "").slice(0, 40)} → ${email}`);
  console.log(`  Subject: ${subject}`);

  if (DRY_RUN) {
    console.log(`  [DRY-RUN] would send\n`);
    continue;
  }

  if (!transporter) {
    console.log(`  ✗ SMTP not configured\n`);
    continue;
  }

  try {
    await transporter.sendMail({
      from:    `${SENDER_NAME} - ClinicFlow <${SMTP_FROM}>`,
      to:      email,
      subject,
      text:    body,
    });

    // Mark follow-up sent in drops log
    drops[i].followupSent    = true;
    drops[i].followupSentAt  = new Date().toISOString();

    // Append to follow-up email log
    sentLog.push({
      dropKey,
      clinicName:  d.clinicName,
      email,
      subject,
      sentAt:      new Date().toISOString(),
    });

    sent++;
    console.log(`  ✓ sent\n`);
  } catch (err) {
    console.log(`  ✗ ${err.message}\n`);
  }
}

if (!DRY_RUN && sent > 0) {
  writeJsonSafe(DROPS_LOG, drops);
  writeJsonSafe(EMAIL_LOG, sentLog);
}

console.log(`${"─".repeat(56)}`);
console.log(`  Voicemail follow-up emails sent: ${sent}`);
console.log(DRY_RUN ? "  (dry-run — nothing sent)" : `  Log → ${EMAIL_LOG}`);
