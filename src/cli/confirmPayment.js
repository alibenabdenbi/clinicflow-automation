// src/cli/confirmPayment.js
// Confirms a client payment, logs it, and adds the client to clients.json.
// Run this as soon as payment is received (Interac, Wave, or Stripe).
//
// Usage:
//   npm run payment:confirm -- --client "Maple Dental" --email clinic@domain.com --tier growth --method interac --payment first_half
//   npm run payment:confirm -- --client "Maple Dental" --email clinic@domain.com --tier growth --method interac --payment second_half
//   npm run payment:confirm -- --email clinic@domain.com --tier growth --method wave --client "Maple Dental" --city Toronto
//   npm run payment:confirm -- --email clinic@domain.com --tier full   --method stripe --setup

import fs from "fs";
import path from "path";
import dotenv from "dotenv";
import nodemailer from "nodemailer";
import { pathToFileURL } from "url";
import { addClient } from "../services/clientService.js";
import { TIERS } from "../services/paymentService.js";
import { fill, ONBOARDING } from "../templates/replyTemplates.js";
import { sendSMS } from "../services/smsService.js";

dotenv.config();

// ─── Config ──────────────────────────────────────────────────────────────────

const SMTP_HOST   = (process.env.SMTP_HOST || "").trim();
const SMTP_PORT   = Number(process.env.SMTP_PORT || "587");
const SMTP_USER   = (process.env.SMTP_USER || "").trim();
const SMTP_PASS   = (process.env.SMTP_PASS || "").trim();
const SMTP_FROM   = (process.env.SMTP_FROM || SMTP_USER).trim();
const SENDER_NAME = (process.env.SENDER_NAME || "Mohamed").trim();
const NOTIFY_EMAIL   = process.env.NOTIFY_EMAIL || "m.aliben432@gmail.com";
const CLINIC_PHONE_ARG = null; // passed via --phone flag below

const PAYMENTS_PATH  = path.join(process.cwd(), "data", "payments.json");
const REFERRALS_PATH = path.join(process.cwd(), "data", "referrals.json");

// ─── CLI args ─────────────────────────────────────────────────────────────────

function getArg(flag, required = false) {
  const i = process.argv.indexOf(flag);
  const val = i !== -1 ? process.argv[i + 1] : null;
  if (required && !val) {
    console.error(`Missing required argument: ${flag}`);
    console.error(`Usage: npm run payment:confirm -- --email addr@domain.com --tier [starter|growth|full] --method [interac|wave|stripe]`);
    process.exit(1);
  }
  return val;
}

const email       = getArg("--email",   true);
const tier        = getArg("--tier",    true).toLowerCase();
const method      = getArg("--method",  true).toLowerCase();
const clientName  = getArg("--client")  || "";
const city        = getArg("--city")    || "";
const paymentType = (getArg("--payment") || "full").toLowerCase(); // first_half | second_half | full
const doneForYou  = process.argv.includes("--setup");
const dryRun      = process.argv.includes("--dry-run");
const clinicPhone = getArg("--phone") || "";

if (!["first_half", "second_half", "full"].includes(paymentType)) {
  console.error(`Invalid --payment "${paymentType}". Valid: first_half, second_half, full`);
  process.exit(1);
}

// ─── Validate ─────────────────────────────────────────────────────────────────

if (!TIERS[tier]) {
  console.error(`Invalid tier "${tier}". Valid: starter, growth, full`);
  process.exit(1);
}

if (!["interac", "wave", "stripe"].includes(method)) {
  console.error(`Invalid method "${method}". Valid: interac, wave, stripe`);
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

function logPayment(entry) {
  const payments = readJsonSafe(PAYMENTS_PATH, []);
  payments.push(entry);
  writeJsonSafe(PAYMENTS_PATH, payments);
}

// ─── Split payment amounts ────────────────────────────────────────────────────

const SPLIT = {
  starter: { firstHalf: 200, secondHalf: 197 },
  growth:  { firstHalf: 500, secondHalf: 497 },
  full:    { firstHalf: 1250, secondHalf: 1247 },
};

// ─── Email builders ───────────────────────────────────────────────────────────

function buildConfirmationEmail(name, tierInfo, payType) {
  const deliveryDays = tierInfo.deliveryDays || 7;
  const tierName = tierInfo.name;
  const split = SPLIT[tier] || {};

  if (payType === "first_half") {
    // Delegate to ONBOARDING template — filled at call time in main()
    return null;
  }

  if (payType === "second_half") {
    return {
      subject: `All done — thank you, ${name || "and welcome"}`,
      body: `Hi${name ? ` ${name}` : ""},

Thank you — second payment received. You're all set.

Your ClinicFlow ${tierName} setup is complete and live. Everything is in place and running.

A few things to keep in mind:
  • If anything needs adjusting in the first 30 days, just reply here — I'll fix it at no charge
  • If you're ever not satisfied, the 30-day guarantee applies — full refund, no questions

One small favour — if you know another clinic owner who'd benefit from the same system, I'd love an introduction. For any successful referral I'll add a free automation sequence to your package.

Thanks again for trusting ClinicFlow with your clinic.

${SENDER_NAME}
ClinicFlow Automation
contact@clinicflowautomation.com
clinicflowautomation.com`,
    };
  }

  // Legacy full-payment flow
  return {
    subject: `Payment confirmed — ClinicFlow ${tierName} setup starting now`,
    body: `Hi${name ? ` ${name}` : ""},

Thank you — payment received.

Your ClinicFlow ${tierName} setup is now in progress. Here's what happens next:

  • I'll reach out within one business day to confirm your clinic details (email platform, contact info, preferred tone)
  • Setup will be complete within ${deliveryDays} business days from that point
  • You'll receive all files and a setup guide by email when ready

If you have any questions in the meantime, just reply to this email.

${SENDER_NAME}
ClinicFlow Automation
contact@clinicflowautomation.com
clinicflowautomation.com`,
  };
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const tierInfo = TIERS[tier];
  const split = SPLIT[tier] || {};
  const amountPaid = paymentType === "first_half" ? split.firstHalf
                   : paymentType === "second_half" ? split.secondHalf
                   : tierInfo.price;

  console.log(`\n══ ClinicFlow Payment Confirmation ══════════════`);
  console.log(`Email:   ${email}`);
  console.log(`Tier:    ${tierInfo.name} — $${tierInfo.price} CAD total`);
  console.log(`Payment: ${paymentType === "first_half" ? `First half — $${split.firstHalf}` : paymentType === "second_half" ? `Second half — $${split.secondHalf}` : `Full — $${tierInfo.price}`}`);
  console.log(`Method:  ${method}`);
  if (clientName) console.log(`Client:  ${clientName}`);
  if (city)       console.log(`City:    ${city}`);
  if (doneForYou) console.log(`Setup:   done-for-you included`);
  console.log(`════════════════════════════════════════════════\n`);

  if (dryRun) {
    console.log(`[DRY RUN] No changes made. Remove --dry-run to confirm.`);
    return;
  }

  // 1. Log payment record
  const paymentEntry = {
    confirmedAt: new Date().toISOString(),
    email,
    clientName: clientName || "(not provided)",
    city: city || "(not provided)",
    tier,
    paymentType,
    amount: amountPaid,
    totalPrice: tierInfo.price,
    currency: tierInfo.currency || "CAD",
    method,
    doneForYou: doneForYou || (tier === "full"),
    status: paymentType === "second_half" ? "complete" : "first_half_received",
  };
  logPayment(paymentEntry);
  console.log(`✓ Payment logged to data/payments.json`);

  // 2. Add/update clients.json
  const clientsPath = path.join(process.cwd(), "data", "clients.json");
  const now = new Date().toISOString();

  if (paymentType === "first_half" || paymentType === "full") {
    addClient(
      clientName || email.split("@")[0],
      city || "",
      email,
      tier,
      now
    );
    // Set status to onboarding and flag doneForYou if applicable
    const clients = readJsonSafe(clientsPath, []);
    const idx = clients.findIndex(c => c.email?.toLowerCase() === email.toLowerCase());
    if (idx !== -1) {
      clients[idx].status = "onboarding";
      clients[idx].onboardingTriggeredAt = now;
      if (doneForYou || tier === "full") clients[idx].doneForYou = true;
      writeJsonSafe(clientsPath, clients);
    }
    console.log(`✓ Client added to data/clients.json (status: onboarding)`);
  } else if (paymentType === "second_half") {
    const clients = readJsonSafe(clientsPath, []);
    const idx = clients.findIndex(c => c.email?.toLowerCase() === email.toLowerCase());
    if (idx !== -1) {
      clients[idx].status = "complete";
      clients[idx].completedAt = now;
      writeJsonSafe(clientsPath, clients);
      console.log(`✓ Client marked complete in data/clients.json`);
    }
  }

  // 3. Build and send client email
  const paymentLabel = paymentType === "first_half" ? `First half — $${split.firstHalf}`
                     : paymentType === "second_half" ? `Second half — $${split.secondHalf} (PROJECT COMPLETE)`
                     : `Full — $${tierInfo.price}`;

  // first_half → ONBOARDING template; others → inline builder
  let subject, body;
  if (paymentType === "first_half") {
    const rendered = fill(ONBOARDING, { clinicName: clientName || email.split("@")[0], email });
    subject = rendered.subject;
    body    = rendered.body;
  } else {
    const built = buildConfirmationEmail(clientName, tierInfo, paymentType);
    subject = built.subject;
    body    = built.body;
  }

  console.log(`\nEmail to client:`);
  console.log(`  Subject: ${subject}`);

  if (SMTP_HOST && SMTP_USER && SMTP_PASS) {
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
        subject,
        text: body,
      });
      if (paymentType === "first_half") {
        console.log(`✓ Onboarding email sent to ${email}`);
      } else {
        console.log(`✓ Confirmation email sent to ${email}`);
      }
    } catch (e) {
      console.warn(`  ⚠ Could not send email: ${e.message}`);
    }

    // 3b. SMS to clinic on first_half payment
    if (paymentType === "first_half" && clinicPhone) {
      const phoneDigits = clinicPhone.replace(/\D/g, "");
      const e164 = phoneDigits.length === 10 ? `+1${phoneDigits}` : `+${phoneDigits}`;
      const smsBody = `Hi ${clientName || "there"}, payment received — Mohamed from ClinicFlow here. Your setup starts today. Expect an email with next steps shortly. Questions? Text or call 438-544-0442.`;
      try {
        await sendSMS(e164, smsBody);
        console.log(`✓ Welcome SMS sent to ${e164}`);
      } catch (e) {
        console.warn(`  ⚠ SMS not sent: ${e.message}`);
      }
    }

    // 4. Notify operator
    try {
      await transporter.sendMail({
        from: `${SENDER_NAME} - ClinicFlow <${SMTP_FROM}>`,
        to: NOTIFY_EMAIL,
        subject: `Payment received — ${clientName || email} (${tierInfo.name} · ${paymentLabel})`,
        text: `Payment confirmed.\n\nClient: ${clientName || "(unnamed)"}\nEmail:  ${email}\nTier:   ${tierInfo.name} ($${tierInfo.price} CAD total)\nPayment: ${paymentLabel}\nMethod: ${method}\nDone-for-you: ${doneForYou || tier === "full" ? "yes" : "no"}\n\n${paymentType === "second_half" ? "Project is now COMPLETE. Consider sending referral request in 30 days." : `Onboarding email sent. Client will reply with patient list + details within 24–48 hours.\nWhen CSV arrives, run:\n  npm run build:reactivation -- --client "${clientName || "Clinic Name"}"`}`,
      });
      console.log(`✓ Operator notification sent to ${NOTIFY_EMAIL}`);
    } catch { /* non-fatal */ }
  } else {
    console.warn(`  SMTP not configured — email not sent`);
  }

  // 5. Referral system — trigger on second_half payment
  if (paymentType === "second_half" && SMTP_HOST && SMTP_USER && SMTP_PASS) {
    const clientSlug = (clientName || email.split("@")[0])
      .toLowerCase().replace(/[^a-z0-9]+/g, "").slice(0, 20);
    const referralLink = `https://clinicflowautomation.com?ref=${clientSlug}`;

    // Log referral entry
    const referrals = readJsonSafe(REFERRALS_PATH, []);
    const existing  = referrals.find(r => r.email === email);
    if (!existing) {
      referrals.push({
        clientName: clientName || email,
        email,
        slug: clientSlug,
        referralLink,
        createdAt: new Date().toISOString(),
        clicks: 0,
        conversions: 0,
      });
      writeJsonSafe(REFERRALS_PATH, referrals);
    }

    // Send referral thank-you email
    const transporter2 = nodemailer.createTransport({
      host: SMTP_HOST, port: SMTP_PORT,
      secure: SMTP_PORT === 465,
      auth: { user: SMTP_USER, pass: SMTP_PASS },
      tls: { rejectUnauthorized: false },
    });
    const refSubject = `One more thing — ${clientName || "a small favour"}`;
    const refBody = `Hi ${clientName || "there"},

Thank you again — the full project is complete and I hope the results speak for themselves.

One small thing: if you know another clinic owner who could benefit from the same system, I'd love an introduction.

For any successful referral, I'll add a free automation sequence to your package — no expiry, just my way of saying thank you.

Your referral link: ${referralLink}

Anyone who signs up through that link will be connected directly to you so I can follow up accordingly.

No pressure at all — just thought I'd mention it.

${SENDER_NAME}
ClinicFlow Automation
438-544-0442`;

    try {
      await transporter2.sendMail({
        from: `${SENDER_NAME} - ClinicFlow <${SMTP_FROM}>`,
        to: email,
        subject: refSubject,
        text: refBody,
      });
      console.log(`✓ Referral email sent to ${email} (link: ${referralLink})`);
    } catch (e) {
      console.warn(`  ⚠ Referral email not sent: ${e.message}`);
    }
  }

  console.log(`\n══ DONE ════════════════════════════════════════`);
  if (paymentType === "first_half") {
    console.log(`Onboarding email sent to ${email}.`);
    console.log(`They will send you their patient list and details within 24–48 hours.`);
    console.log(`\nWhen CSV arrives, run:`);
    console.log(`  npm run build:reactivation -- --client "${clientName || "Clinic Name"}"`);
    console.log(`\nWhen client confirms delivery, collect second half ($${split.secondHalf}) then run:`);
    console.log(`  npm run payment:confirm -- --client "${clientName || "Clinic Name"}" --email ${email} --tier ${tier} --method ${method} --payment second_half`);
  } else if (paymentType === "second_half") {
    console.log(`Project complete. Client notified + thank you sent.`);
  } else {
    console.log(`Next step — run delivery:`);
    console.log(`  npm run deliver -- --client "${clientName || "Clinic Name"}" --tier ${tier} --email ${email} --city "${city || "City"}"${doneForYou ? " --setup" : ""}`);
  }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main().catch((err) => {
    console.error("confirmPayment failed:", err.message);
    process.exit(1);
  });
}
