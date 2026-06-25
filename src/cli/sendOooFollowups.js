// src/cli/sendOooFollowups.js
// Sends follow-up emails to out-of-office contacts when their return date arrives.
// Reads data/follow-up-queue.json, sends to entries where followUpDate <= today and done=false.
//
// Usage:
//   node src/cli/sendOooFollowups.js
//   node src/cli/sendOooFollowups.js --dry-run

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import nodemailer from "nodemailer";

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const DATA_DIR = path.join(ROOT, "data");
const QUEUE_PATH = path.join(DATA_DIR, "follow-up-queue.json");

const SMTP_HOST   = (process.env.SMTP_HOST || "").trim();
const SMTP_PORT   = Number(process.env.SMTP_PORT || "587");
const SMTP_USER   = (process.env.SMTP_USER || "").trim();
const SMTP_PASS   = (process.env.SMTP_PASS || "").trim();
const SMTP_FROM   = (process.env.SMTP_FROM || SMTP_USER).trim();
const SENDER_NAME = (process.env.SENDER_NAME || "Mohamed").trim();

const DRY_RUN = process.argv.includes("--dry-run");

function readJsonSafe(p, fallback) {
  try {
    if (!fs.existsSync(p)) return fallback;
    return JSON.parse(fs.readFileSync(p, "utf-8"));
  } catch { return fallback; }
}

function writeJsonSafe(p, data) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(data, null, 2), "utf-8");
}

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}

function buildFollowUpEmail(entry) {
  const name = entry.clinicName || "there";
  return {
    subject: `Following up — free audit for ${name}`,
    body: `Hi,

I reached out a couple of weeks ago about a free missed call audit for ${name}.

Just circling back in case the timing works better now. Still happy to take a look — no cost, takes me 10 minutes.

Worth a quick conversation?

${SENDER_NAME}
ClinicFlow Automation
clinicflowautomation.com`,
  };
}

async function main() {
  const queue = readJsonSafe(QUEUE_PATH, []);
  if (!Array.isArray(queue) || queue.length === 0) {
    console.log("OOO follow-up queue is empty.");
    return;
  }

  const today = todayStr();
  const due = queue.filter(e => !e.done && e.followUpDate && e.followUpDate <= today);

  console.log(`OOO Follow-up Sender — ${DRY_RUN ? "dry-run" : "live"}`);
  console.log(`Queue: ${queue.length} total | Due today: ${due.length}\n`);

  if (due.length === 0) {
    console.log("Nothing due. Next follow-up:", queue.filter(e => !e.done).map(e => e.followUpDate).sort()[0] || "none");
    return;
  }

  let transporter = null;
  if (!DRY_RUN) {
    if (!SMTP_HOST || !SMTP_PORT || !SMTP_USER || !SMTP_PASS) {
      console.error("SMTP not configured. Check .env");
      process.exit(1);
    }
    transporter = nodemailer.createTransport({
      host: SMTP_HOST,
      port: SMTP_PORT,
      secure: SMTP_PORT === 465,
      auth: { user: SMTP_USER, pass: SMTP_PASS },
      tls: { rejectUnauthorized: false },
    });
    await transporter.verify();
    console.log("✅ SMTP OK\n");
  }

  let sent = 0;
  for (const entry of due) {
    const { subject, body } = buildFollowUpEmail(entry);
    console.log(`→ ${entry.clinicName || entry.fromEmail} <${entry.fromEmail}>`);
    console.log(`  Subject: "${subject}"`);
    console.log(`  Scheduled: ${entry.followUpDate} | Return date: ${entry.returnDate || "unknown"}`);

    if (DRY_RUN) {
      console.log("  [DRY RUN] Would send");
      continue;
    }

    try {
      await transporter.sendMail({ from: SMTP_FROM, to: entry.fromEmail, subject, text: body });
      const idx = queue.findIndex(e => e.fromEmail === entry.fromEmail);
      if (idx !== -1) {
        queue[idx].done = true;
        queue[idx].sentAt = new Date().toISOString();
      }
      sent++;
      console.log("  ✓ sent");
    } catch (err) {
      console.error(`  ✗ failed: ${err?.message || err}`);
    }
  }

  if (!DRY_RUN) writeJsonSafe(QUEUE_PATH, queue);
  console.log(`\nDone. Sent: ${sent}${DRY_RUN ? " (dry run)" : ""}`);
}

main().catch(err => {
  console.error("sendOooFollowups fatal:", err?.message || err);
  process.exit(1);
});
