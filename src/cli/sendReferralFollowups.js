// src/cli/sendReferralFollowups.js
// Sends FU1 to referral partners who haven't replied in 7+ days.
// Usage: node src/cli/sendReferralFollowups.js [--dry-run]

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import nodemailer from "nodemailer";
import dotenv from "dotenv";
dotenv.config();

const ROOT          = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const TARGETS_PATH  = path.join(ROOT, "data", "referral", "referral-targets.json");
const SMTP_HOST     = (process.env.SMTP_HOST || "").trim();
const SMTP_PORT     = Number(process.env.SMTP_PORT || 465);
const SMTP_USER     = (process.env.SMTP_USER || "").trim();
const SMTP_PASS     = process.env.SMTP_PASS;
const SMTP_FROM     = (process.env.SMTP_FROM || SMTP_USER).trim();
const SENDER_NAME   = (process.env.SENDER_NAME || "Mohamed").trim();
const DRY_RUN       = process.argv.includes("--dry-run");
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

function readJsonSafe(p, fallback) {
  try { return JSON.parse(fs.readFileSync(p, "utf-8")); } catch { return fallback; }
}

const FU1_SUBJECT = "Quick follow-up — ClinicFlow referral program";
const FU1_BODY    = (company) => `Hi,

Following up on my email about referring dental clinic clients to ClinicFlow Automation.

To make it concrete — if you mention us to a clinic owner and they sign up, you earn $150–375 per client. No selling required.

I've attached a one-pager you can share if helpful.

Worth a quick call?

${SENDER_NAME}
ClinicFlow Automation
contact@clinicflowautomation.com
438-544-0442`;

async function main() {
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) {
    console.error("SMTP not configured — check .env");
    process.exit(1);
  }

  const targets = readJsonSafe(TARGETS_PATH, []);
  if (!Array.isArray(targets) || targets.length === 0) {
    console.log("No referral targets found at:", TARGETS_PATH);
    return;
  }

  const now = Date.now();
  const due = targets.filter(t => {
    if (!t.email) return false;
    if (t.status === "replied" || t.status === "fu1_sent") return false;
    const sentAt = t.generatedAt || t.sentAt || null;
    if (!sentAt) return false;
    return now - new Date(sentAt).getTime() >= SEVEN_DAYS_MS;
  });

  console.log(`\n── Referral Follow-up ────────────────────────────`);
  console.log(`  Targets total: ${targets.length}`);
  console.log(`  FU1 eligible:  ${due.length} (pitched 7+ days ago, no reply)`);

  if (due.length === 0) {
    console.log("  Nothing to send today.");
    return;
  }

  const transporter = nodemailer.createTransport({
    host: SMTP_HOST, port: SMTP_PORT,
    secure: SMTP_PORT === 465,
    auth: { user: SMTP_USER, pass: SMTP_PASS },
    tls: { rejectUnauthorized: false },
  });

  // Generate one-pager inline (plain text attachment)
  const onePager = `ClinicFlow Automation — Referral Partner Brief
============================================

WHAT WE DO
• Automated missed call follow-up — patients who call and reach voicemail get a text within 60 seconds
• Patient reactivation — we email inactive patients (18+ months) with personalized re-engagement sequences
• Appointment reminders — SMS 72h and 24h before each visit, reducing no-shows by 30–40%

WHAT YOU EARN (15% of first payment)
• Starter ($397)  → $60 per referral
• Growth  ($997)  → $150 per referral
• Premium ($2,497) → $375 per referral

HOW TO REFER
"Just introduce us by email — forward their details to contact@clinicflowautomation.com."

CONTACT
Mohamed Ali Bencherif
contact@clinicflowautomation.com
438-544-0442
clinicflowautomation.com
`;

  let sent = 0;
  for (const t of due) {
    console.log(`  → ${t.company} <${t.email}>`);
    if (DRY_RUN) {
      console.log(`    [DRY-RUN] would send FU1`);
      continue;
    }
    try {
      await transporter.sendMail({
        from:    SMTP_FROM,
        to:      t.email,
        subject: FU1_SUBJECT,
        text:    FU1_BODY(t.company),
        attachments: [{
          filename: "ClinicFlow-Referral-Partner-Brief.txt",
          content:  onePager,
        }],
      });
      t.status    = "fu1_sent";
      t.fu1SentAt = new Date().toISOString();
      sent++;
      console.log(`    ✓ sent`);
    } catch (e) {
      console.error(`    ✗ failed: ${e.message}`);
    }
  }

  // Persist updated statuses
  if (!DRY_RUN && sent > 0) {
    fs.writeFileSync(TARGETS_PATH, JSON.stringify(targets, null, 2));
    console.log(`\n  Sent: ${sent} | Saved → ${TARGETS_PATH}`);
  }

  if (DRY_RUN) console.log("\n  *** DRY-RUN — nothing sent ***");
}

main().catch(e => { console.error(e.message); process.exit(1); });
