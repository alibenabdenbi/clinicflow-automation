// src/cli/runFollowups.js
// Sends automatic follow-up emails for leads due for follow-up.

import fs from "fs";
import path from "path";
import dotenv from "dotenv";
import nodemailer from "nodemailer";

dotenv.config();

const OUTREACH_PATH =
  process.env.OUTREACH_JSON_PATH ||
  path.join(process.cwd(), "data", "outreach.localDentists.json");

const SEND_LOG_PATH = path.join(process.cwd(), "data", "smtp.sendlog.json");

const SMTP_HOST = process.env.SMTP_HOST;
const SMTP_PORT = Number(process.env.SMTP_PORT || 465);
const SMTP_USER = process.env.SMTP_USER;
const SMTP_PASS = process.env.SMTP_PASS;
const SMTP_SECURE =
  (process.env.SMTP_SECURE || "").toLowerCase() === "true" || SMTP_PORT === 465;

const MAX_EMAILS_PER_DAY = Number(process.env.MAX_EMAILS_PER_DAY || 20);
const FOLLOWUP_DELAY_DAYS = Number(process.env.FOLLOWUP_DELAY_DAYS || 3);
const SMTP_FROM = process.env.SMTP_FROM || SMTP_USER;

function todayKey() {
  const d = new Date();
  return d.toISOString().slice(0, 10);
}

function readJson(file, fallback = {}) {
  try {
    if (!fs.existsSync(file)) return fallback;
    return JSON.parse(fs.readFileSync(file, "utf-8"));
  } catch {
    return fallback;
  }
}

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2), "utf-8");
}

function remainingToday() {
  const log = readJson(SEND_LOG_PATH, {});
  const sent = Number(log[todayKey()] || 0);
  return MAX_EMAILS_PER_DAY - sent;
}

function incrementToday() {
  const log = readJson(SEND_LOG_PATH, {});
  log[todayKey()] = Number(log[todayKey()] || 0) + 1;
  writeJson(SEND_LOG_PATH, log);
}

function buildFollowupEmail(lead) {
  return `Hi ${lead.clinicName || "there"},

Just following up in case my last message got buried.

I put together a quick idea on how your clinic could:
• Improve new patient follow-ups
• Increase Google reviews
• Capture missed-call leads automatically

Would you like me to send the free 1-page plan?

Best,
Mohamed`;
}

async function main() {
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) {
    console.log("SMTP not configured.");
    process.exit(1);
  }

  const transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: SMTP_PORT,
    secure: SMTP_SECURE,
    auth: { user: SMTP_USER, pass: SMTP_PASS },
    tls: { rejectUnauthorized: false },
  });

  const leads = readJson(OUTREACH_PATH, []);
  const now = new Date();

  const dueLeads = leads.filter(
    (l) =>
      l.status === "sent" &&
      l.followupDueAt &&
      new Date(l.followupDueAt) <= now &&
      l.email
  );

  console.log(`Found ${dueLeads.length} follow-up candidate(s).`);

  let sentCount = 0;

  for (const lead of dueLeads) {
    if (remainingToday() <= 0) {
      console.log("Daily limit reached.");
      break;
    }

    try {
      await transporter.sendMail({
        from: SMTP_FROM,
        to: lead.email,
        subject: "Quick follow-up",
        text: buildFollowupEmail(lead),
      });

      lead.status = "followup_sent";
      lead.followupCount = (lead.followupCount || 0) + 1;

      const next = new Date();
      next.setDate(next.getDate() + FOLLOWUP_DELAY_DAYS);
      lead.followupDueAt = next.toISOString();

      incrementToday();
      sentCount++;
      console.log(`✓ Follow-up sent to ${lead.clinicName}`);
    } catch (e) {
      console.log(`✗ Failed for ${lead.clinicName}`);
    }
  }

  writeJson(OUTREACH_PATH, leads);
  console.log(`Done. Sent ${sentCount} follow-ups.`);
}

main();