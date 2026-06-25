// src/cli/sendReferralOutreach.js
// Sends referral partner outreach emails (accountants, consultants, IT providers).
// Separate from main email batch — capped at 5/day, Tue/Wed/Thu only.
//
// Usage:
//   node src/cli/sendReferralOutreach.js
//   node src/cli/sendReferralOutreach.js --dry-run

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import nodemailer from "nodemailer";
import dotenv from "dotenv";
import { TEMPLATES, fill } from "../templates/referralPartnerTemplates.js";

dotenv.config();

const ROOT          = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const TARGETS_PATH  = path.join(ROOT, "data", "referral", "referral-targets.json");
const LOG_PATH      = path.join(ROOT, "data", "referral", "referral-sent-log.json");

const SMTP_HOST = (process.env.SMTP_HOST || "").trim();
const SMTP_PORT = Number(process.env.SMTP_PORT || 465);
const SMTP_USER = (process.env.SMTP_USER || "").trim();
const SMTP_PASS = (process.env.SMTP_PASS || "").trim();
const SMTP_FROM = (process.env.SMTP_FROM || SMTP_USER).trim();

const DAILY_CAP = 5;
const DRY_RUN   = process.argv.includes("--dry-run");

function readJsonSafe(p, fb) {
  try { return JSON.parse(fs.readFileSync(p, "utf-8")); } catch { return fb; }
}
function writeJson(p, data) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(data, null, 2), "utf-8");
}
function isWeekday() {
  const d = new Date().getDay();
  return d >= 2 && d <= 4; // Tue=2, Wed=3, Thu=4
}
function todayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}

if (!DRY_RUN && !isWeekday()) {
  console.log("Not Tue/Wed/Thu — skipping referral outreach.");
  process.exit(0);
}

const today   = todayKey();
const targets = readJsonSafe(TARGETS_PATH, []);
const log     = readJsonSafe(LOG_PATH, []);

const sentTodayCount = log.filter(e => (e.sentAt || "").startsWith(today)).length;
const remaining      = DAILY_CAP - sentTodayCount;

console.log(`Referral Outreach — ${today}`);
console.log(`Sent today: ${sentTodayCount} / ${DAILY_CAP} cap | Remaining: ${remaining}`);
if (DRY_RUN) console.log("DRY RUN — no emails will be sent\n");

if (remaining <= 0 && !DRY_RUN) {
  console.log("Daily cap reached. Exiting.");
  process.exit(0);
}

// Select targets: todo, has email, not already in log
const sentEmails = new Set(log.map(e => (e.email || "").toLowerCase()));
const queue = targets.filter(t =>
  (t.status === "todo" || !t.status) &&
  t.email &&
  !sentEmails.has(t.email.toLowerCase())
).slice(0, remaining);

if (queue.length === 0) {
  console.log("No referral targets to send. Add more to data/referral/referral-targets.json");
  process.exit(0);
}

// Set up transporter
const transporter = nodemailer.createTransport({
  host: SMTP_HOST, port: SMTP_PORT, secure: SMTP_PORT === 465,
  auth: { user: SMTP_USER, pass: SMTP_PASS },
  tls: { rejectUnauthorized: false },
});

if (!DRY_RUN) {
  await transporter.verify();
  console.log("✅ SMTP verify OK\n");
}

let sent = 0;

for (const target of queue) {
  // Determine template from type field
  const typeKey  = (target.type || "consultant").toLowerCase();
  const template = TEMPLATES[typeKey];

  // Derive firstName from name or contactName field
  const rawName   = target.name || target.contactName || target.company || "there";
  const firstName = rawName.split(/[\s,]+/)[0];

  let subject, body;

  if (template) {
    // Use type-based template
    ({ subject, body } = fill(template, { firstName, company: target.company || "" }));
  } else if (target.pitch?.subject && target.pitch?.body) {
    // Fall back to embedded pitch object (old-format records)
    subject = target.pitch.subject;
    body    = target.pitch.body;
  } else {
    console.log(`  ⊘ Skip ${target.email} — no template for type "${typeKey}" and no embedded pitch`);
    continue;
  }

  console.log(`→ ${target.company || target.name} <${target.email}>`);
  console.log(`  Subject: "${subject}"`);
  console.log(`  Type: ${typeKey} | Template: ${template ? typeKey : "embedded"}`);

  if (!DRY_RUN) {
    await transporter.sendMail({
      from: `Mohamed - ClinicFlow <${SMTP_FROM}>`,
      to: target.email,
      subject,
      text: body,
    });

    // Mark target as sent
    const idx = targets.findIndex(t => t.email === target.email);
    if (idx !== -1) {
      targets[idx].status    = "sent";
      targets[idx].sentAt    = new Date().toISOString();
    }

    // Append to log
    log.push({
      email:     target.email,
      company:   target.company || target.name || "",
      type:      typeKey,
      subject,
      sentAt:    new Date().toISOString(),
    });

    writeJson(TARGETS_PATH, targets);
    writeJson(LOG_PATH, log);
    console.log(`  ✓ Sent`);
  } else {
    console.log(`  [DRY RUN] Would send`);
  }

  sent++;
  console.log();
}

console.log(`Done. Referral emails sent: ${sent}`);
