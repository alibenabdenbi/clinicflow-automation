// src/cli/triggerOnboarding.js
// Sends the onboarding email to a client and logs it to data/clients.json.
//
// Usage:
//   npm run onboard -- --client "Maple Dental" --email their@email.com --tier growth
//   npm run onboard -- --client "Maple Dental" --email their@email.com --tier growth --dry-run

import fs from "fs";
import path from "path";
import dotenv from "dotenv";
import nodemailer from "nodemailer";
import { fill, ONBOARDING } from "../templates/replyTemplates.js";
import { extractGreetingName } from "../services/emailPersonalizer.js";

dotenv.config();

const SMTP_HOST   = (process.env.SMTP_HOST || "").trim();
const SMTP_PORT   = Number(process.env.SMTP_PORT || "587");
const SMTP_USER   = (process.env.SMTP_USER || "").trim();
const SMTP_PASS   = (process.env.SMTP_PASS || "").trim();
const SMTP_FROM   = (process.env.SMTP_FROM || SMTP_USER).trim();
const SENDER_NAME = (process.env.SENDER_NAME || "Mohamed").trim();

const CLIENTS_PATH = path.join(process.cwd(), "data", "clients.json");

// ─── Args ─────────────────────────────────────────────────────────────────────

function getArg(flag) {
  const i = process.argv.indexOf(flag);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : null;
}

const clientName = getArg("--client");
const email      = getArg("--email");
const tier       = (getArg("--tier") || "growth").toLowerCase();
const dryRun     = process.argv.includes("--dry-run");

if (!clientName || !email) {
  console.error("Usage: npm run onboard -- --client \"Clinic Name\" --email their@email.com --tier growth");
  process.exit(1);
}

if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
  console.error(`Invalid email: ${email}`);
  process.exit(1);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function readJsonSafe(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, "utf-8"));
  } catch {
    return fallback;
  }
}

function writeJsonSafe(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const rendered = fill(ONBOARDING, { clinicName: clientName, email });

  console.log(`\n══ ClinicFlow Onboarding ════════════════════════`);
  console.log(`Client: ${clientName}`);
  console.log(`Email:  ${email}`);
  console.log(`Tier:   ${tier}`);
  console.log(`Subject: ${rendered.subject}`);
  console.log(`════════════════════════════════════════════════\n`);
  console.log(rendered.body);
  console.log();

  if (dryRun) {
    console.log(`[DRY RUN] No email sent, no file written.`);
    return;
  }

  // Send email
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) {
    console.warn("SMTP not configured — email not sent. Set SMTP_HOST, SMTP_USER, SMTP_PASS in .env");
  } else {
    const transporter = nodemailer.createTransport({
      host: SMTP_HOST, port: SMTP_PORT,
      secure: SMTP_PORT === 465,
      auth: { user: SMTP_USER, pass: SMTP_PASS },
      tls: { rejectUnauthorized: false },
    });
    try {
      await transporter.verify();
      await transporter.sendMail({
        from: `${SENDER_NAME} - ClinicFlow <${SMTP_FROM}>`,
        to: email,
        subject: rendered.subject,
        text: rendered.body,
      });
      console.log(`✓ Onboarding email sent to ${email}`);
    } catch (e) {
      console.warn(`  ⚠ Could not send email: ${e.message}`);
    }
  }

  // Update clients.json — find existing record or create one
  const clients = readJsonSafe(CLIENTS_PATH, []);
  const idx = clients.findIndex(c => c.email?.toLowerCase() === email.toLowerCase());

  const now = new Date().toISOString();
  if (idx !== -1) {
    clients[idx].status = "onboarding";
    clients[idx].onboardingEmailSentAt = now;
    clients[idx].tier = clients[idx].tier || tier;
  } else {
    clients.push({
      createdAt: now,
      clinicName: clientName,
      email,
      tier,
      status: "onboarding",
      onboardingEmailSentAt: now,
    });
  }
  writeJsonSafe(CLIENTS_PATH, clients);
  console.log(`✓ Client status set to "onboarding" in data/clients.json`);
  console.log(`\nThey will send you their patient list and details within 24–48 hours.`);
  console.log(`When their CSV arrives, run:`);
  console.log(`  npm run build:reactivation -- --client "${clientName}"`);
}

main().catch(e => {
  console.error("triggerOnboarding failed:", e.message);
  process.exit(1);
});
