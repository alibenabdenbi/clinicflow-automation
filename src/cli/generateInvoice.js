// src/cli/generateInvoice.js
// Sends a payment request / invoice email to a clinic client.
// Does NOT auto-create a Wave invoice (Wave free tier has no API).
// Logs the send to data/invoices.json.
//
// Usage:
//   npm run invoice -- --client "Maple Leaf Dental" --tier growth --email info@mapleleafdental.ca
//   npm run invoice -- --client "Test" --tier starter --email t@t.com --dry-run

import fs from "fs";
import path from "path";
import nodemailer from "nodemailer";
import dotenv from "dotenv";
import { pathToFileURL } from "url";
import { generatePaymentEmail, TIERS } from "../services/paymentService.js";

dotenv.config();

// ─── Config ──────────────────────────────────────────────────────────────────

const SMTP_HOST = (process.env.SMTP_HOST || "").trim();
const SMTP_PORT = Number(process.env.SMTP_PORT || "587");
const SMTP_USER = (process.env.SMTP_USER || "").trim();
const SMTP_PASS = (process.env.SMTP_PASS || "").trim();
const SMTP_FROM = (process.env.SMTP_FROM || SMTP_USER).trim();
const SENDER_NAME = (process.env.SENDER_NAME || "Mohamed").trim();

const INVOICES_PATH = path.join(process.cwd(), "data", "invoices.json");

// ─── CLI args ─────────────────────────────────────────────────────────────────

function getArg(flag, required = false) {
  const i = process.argv.indexOf(flag);
  const val = i !== -1 ? process.argv[i + 1] : null;
  if (required && !val) {
    console.error(`Missing required argument: ${flag}`);
    console.error(`Usage: npm run invoice -- --client "Clinic Name" --tier [starter|growth|full] --email addr@domain.com`);
    process.exit(1);
  }
  return val;
}

const clientName = getArg("--client", true);
const tier       = getArg("--tier", true).toLowerCase();
const email      = getArg("--email", true);
const dryRun     = process.argv.includes("--dry-run");

// ─── Validate ─────────────────────────────────────────────────────────────────

if (!TIERS[tier]) {
  console.error(`Invalid tier "${tier}". Valid: ${Object.keys(TIERS).filter(k => !TIERS[k].isAddOn).join(", ")}`);
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

function logInvoice(entry) {
  const invoices = readJsonSafe(INVOICES_PATH, []);
  invoices.push(entry);
  writeJsonSafe(INVOICES_PATH, invoices);
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const tierInfo = TIERS[tier];
  const { subject, body } = generatePaymentEmail(tier, clientName);

  console.log(`\n══ ClinicFlow Invoice Generator ════════════════`);
  console.log(`Client: ${clientName}`);
  console.log(`Tier:   ${tierInfo.name} — $${tierInfo.price} CAD`);
  console.log(`To:     ${email}`);
  console.log(`\nSubject: ${subject}`);
  console.log(`\n─── Email body ─────────────────────────────────`);
  console.log(body);
  console.log(`────────────────────────────────────────────────\n`);

  if (dryRun) {
    console.log(`[DRY RUN] Email not sent. Remove --dry-run to send.`);
    return;
  }

  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) {
    console.error(`SMTP not configured — set SMTP_HOST, SMTP_USER, SMTP_PASS in .env`);
    process.exit(1);
  }

  const transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: SMTP_PORT,
    secure: SMTP_PORT === 465,
    auth: { user: SMTP_USER, pass: SMTP_PASS },
    tls: { rejectUnauthorized: false },
  });

  await transporter.verify();

  await transporter.sendMail({
    from: `${SENDER_NAME} - ClinicFlow <${SMTP_FROM}>`,
    to: email,
    subject,
    text: body,
  });

  const entry = {
    sentAt: new Date().toISOString(),
    clientName,
    tier,
    email,
    amount: tierInfo.price,
    currency: tierInfo.currency || "CAD",
    subject,
    status: "sent",
  };

  logInvoice(entry);

  console.log(`✓ Invoice email sent to ${email}`);
  console.log(`✓ Logged to data/invoices.json`);
  console.log(`\nNext steps:`);
  console.log(`  1. If client pays by Interac — check your bank, then run:`);
  console.log(`     npm run payment:confirm -- --email ${email} --tier ${tier} --method interac`);
  console.log(`  2. If client wants a Wave invoice — create it manually at waveapps.com`);
  console.log(`     See docs/wave-invoice-setup.md for step-by-step instructions`);
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main().catch((err) => {
    console.error("generateInvoice failed:", err.message);
    process.exit(1);
  });
}
