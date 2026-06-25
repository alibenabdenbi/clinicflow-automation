// src/cli/sendCallFollowups.js
// Sends a follow-up email 24h after a Twilio call for clinics that haven't replied.
// Reads data/calls/call-log.json, finds calls from yesterday with no email reply sent.
// Run: node src/cli/sendCallFollowups.js
// npm script: calls:followup

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import nodemailer from "nodemailer";

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT      = path.resolve(__dirname, "../..");
const CALL_LOG  = path.join(ROOT, "data", "calls", "call-log.json");

const SMTP_HOST   = (process.env.SMTP_HOST   || "").trim();
const SMTP_PORT   = Number(process.env.SMTP_PORT || "0");
const SMTP_USER   = (process.env.SMTP_USER   || "").trim();
const SMTP_PASS   = (process.env.SMTP_PASS   || "").trim();
const SMTP_FROM   = (process.env.SMTP_FROM   || SMTP_USER).trim();
const SMTP_SECURE = (process.env.SMTP_SECURE || "").toLowerCase() === "true" || SMTP_PORT === 465;
const SENDER_NAME = "Mohamed";

function readJsonSafe(p, fb) {
  try { if (!fs.existsSync(p)) return fb; return JSON.parse(fs.readFileSync(p, "utf-8")); }
  catch { return fb; }
}

function writeJsonSafe(p, data) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(data, null, 2), "utf-8");
}

function yesterdayKey() {
  return new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
}

function buildEmail({ clinicName, city }) {
  const name    = clinicName || "your clinic";
  const cityRef = city || "your area";
  return {
    subject: `Called your office yesterday — ${name}`,
    body: `Hi,

I called ${name} yesterday — wanted to follow up by email in case it's easier to connect this way.

I do free missed call audits for dental clinics in ${cityRef}. Takes 10 minutes, no cost.

Worth a quick look?

${SENDER_NAME}
ClinicFlow Automation`,
  };
}

async function main() {
  const yesterday = yesterdayKey();
  console.log(`\nCall Follow-up Sender — checking calls from ${yesterday}`);

  const callLog = readJsonSafe(CALL_LOG, []);
  const candidates = callLog.filter(c =>
    c.timestamp?.startsWith(yesterday) &&
    c.email &&
    !c.followUpEmailSent &&
    c.outcome !== "callback_received"
  );

  console.log(`Found ${candidates.length} clinic(s) to follow up`);

  if (candidates.length === 0) {
    console.log("Nothing to send.");
    return;
  }

  if (!SMTP_HOST || !SMTP_PORT || !SMTP_USER || !SMTP_PASS) {
    console.log("SMTP not configured. Check .env");
    return;
  }

  const transporter = nodemailer.createTransport({
    host:   SMTP_HOST,
    port:   SMTP_PORT,
    secure: SMTP_SECURE,
    auth:   { user: SMTP_USER, pass: SMTP_PASS },
  });

  let sent = 0;
  for (const entry of candidates) {
    const { subject, body } = buildEmail(entry);
    try {
      await transporter.sendMail({
        from:    `${SENDER_NAME} <${SMTP_FROM}>`,
        to:      entry.email,
        subject,
        text:    body,
      });
      entry.followUpEmailSent   = true;
      entry.followUpEmailSentAt = new Date().toISOString();
      console.log(`  ✓ sent → ${entry.email} (${entry.clinicName})`);
      sent++;
    } catch (err) {
      console.log(`  ✗ failed → ${entry.email}: ${err.message}`);
    }
  }

  writeJsonSafe(CALL_LOG, callLog);
  console.log(`\n${sent} follow-up email(s) sent. Log saved → ${CALL_LOG}`);
}

main().catch(e => {
  console.error("sendCallFollowups failed:", e?.message || e);
  process.exit(1);
});
