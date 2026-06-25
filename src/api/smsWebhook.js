// src/api/smsWebhook.js
// Twilio webhook handler for incoming SMS on +14385440442.
//
// What it does:
//   1. Validates the Twilio request signature (rejects spoofed requests).
//   2. Forwards the message to Mohamed's personal number (+15149617077) via TwiML:
//      "SMS from [their number]: [their message]"
//   3. Appends the conversation to data/sms.replies.json.
//   4. Tries to match the sender's phone against outreach.noWebsiteClinics.json.
//   5. If matched: sends Mohamed a notification email with the clinic name and draft reply.
//
// Route: POST /sms/incoming  (registered in server.js)
// Body: Twilio posts application/x-www-form-urlencoded — handled by the urlencoded
//       middleware added in server.js before this route.

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import express from "express";
import nodemailer from "nodemailer";
import twilio from "twilio";
import dotenv from "dotenv";

import {
  fill,
  TELL_ME_MORE,
  HOW_MUCH,
  NOT_INTERESTED,
  ALREADY_HAVE_SYSTEM,
} from "../templates/replyTemplates.js";

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");

// ─── Config ───────────────────────────────────────────────────────────────────

const AUTH_TOKEN   = (process.env.TWILIO_AUTH_TOKEN  || "").trim();
const NOTIFY_PHONE = (process.env.NOTIFY_PHONE       || "+15149617077").trim();
const NOTIFY_EMAIL = (process.env.NOTIFY_EMAIL       || "m.aliben432@gmail.com").trim();
const TWILIO_FROM  = (process.env.TWILIO_FROM_NUMBER || "+14385440442").trim();

const SMTP_HOST = (process.env.SMTP_HOST || "").trim();
const SMTP_PORT = Number(process.env.SMTP_PORT || "587");
const SMTP_USER = (process.env.SMTP_USER || "").trim();
const SMTP_PASS = (process.env.SMTP_PASS || "").trim();
const SMTP_FROM = (process.env.SMTP_FROM || SMTP_USER).trim();

const SMS_LOG_PATH    = path.join(ROOT, "data", "sms.replies.json");
const NO_WEBSITE_PATH = path.join(ROOT, "data", "outreach.noWebsiteClinics.json");

// Twilio posts form-encoded bodies — add urlencoded parser scoped to this route.
const urlencodedParser = express.urlencoded({ extended: false });

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

/** Strip non-digits for phone comparison — works across +1 (514)… formats */
function digitsOnly(phone) {
  return String(phone || "").replace(/\D/g, "");
}

// ─── Clinic lookup ────────────────────────────────────────────────────────────

function matchClinicByPhone(fromNumber) {
  const clinics = readJsonSafe(NO_WEBSITE_PATH, []);
  const digits = digitsOnly(fromNumber);
  if (!digits) return null;

  return (
    clinics.find((c) => digitsOnly(c.phoneFormatted) === digits) ||
    clinics.find((c) => digitsOnly(c.phone)          === digits) ||
    null
  );
}

// ─── Intent classification ────────────────────────────────────────────────────

const INTENT_RULES = [
  {
    intent:   "HOW_MUCH",
    template: HOW_MUCH,
    patterns: [/how much/i, /\bpric(e|ing|es)\b/i, /\bcost\b/i, /\bquote\b/i, /\bfee\b/i, /\brates?\b/i],
  },
  {
    intent:   "TELL_ME_MORE",
    template: TELL_ME_MORE,
    patterns: [/tell me more/i, /more info/i, /\binterested\b/i, /how does it work/i, /learn more/i, /sounds good/i],
  },
  {
    intent:   "NOT_INTERESTED",
    template: NOT_INTERESTED,
    patterns: [/not interested/i, /no thanks/i, /\bremove\b/i, /unsubscribe/i, /\bstop\b/i, /don.t contact/i],
  },
  {
    intent:   "ALREADY_HAVE_SYSTEM",
    template: ALREADY_HAVE_SYSTEM,
    patterns: [/we already have/i, /we use/i, /already using/i, /already set up/i],
  },
];

function classifyIntent(body) {
  for (const rule of INTENT_RULES) {
    if (rule.patterns.some((p) => p.test(body))) {
      return { intent: rule.intent, template: rule.template };
    }
  }
  return { intent: "NEEDS_REVIEW", template: null };
}

// ─── Notification email ───────────────────────────────────────────────────────

async function sendNotificationEmail({ from, body, clinicName, intent, draftBody }) {
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) return;

  const transporter = nodemailer.createTransport({
    host: SMTP_HOST, port: SMTP_PORT,
    secure: SMTP_PORT === 465,
    auth: { user: SMTP_USER, pass: SMTP_PASS },
    tls: { rejectUnauthorized: false },
  });

  const intentLabels = {
    HOW_MUCH:            "asking about pricing",
    TELL_ME_MORE:        "wants more info",
    NOT_INTERESTED:      "not interested",
    ALREADY_HAVE_SYSTEM: "already has a system",
    NEEDS_REVIEW:        "needs manual review",
  };

  const display  = clinicName || from;
  const subject  = `SMS reply from ${display} — ${intentLabels[intent] || intent}`;

  const lines = [
    `A clinic replied via SMS.`,
    ``,
    `From:    ${from}`,
    `Clinic:  ${clinicName || "(no match found)"}`,
    `Intent:  ${intentLabels[intent] || intent}`,
    ``,
    `Message:`,
    body,
  ];
  if (draftBody) {
    lines.push(``, `─── Draft reply ────────────────────────────────────────`, draftBody);
  } else {
    lines.push(``, `No draft generated — reply manually.`);
  }
  lines.push(``, `—`, `Mohamed - ClinicFlow`, `contact@clinicflowautomation.com`);

  await transporter.sendMail({
    from: `Mohamed - ClinicFlow <${SMTP_FROM}>`,
    to:   NOTIFY_EMAIL,
    subject,
    text: lines.join("\n"),
  });
}

// ─── Route registration ───────────────────────────────────────────────────────

/**
 * Register POST /sms/incoming on an Express app.
 * @param {import("express").Application} app
 */
export function registerSmsWebhookRoute(app) {
  app.post("/sms/incoming", urlencodedParser, async (req, res) => {

    // ── 1. Validate Twilio request signature ─────────────────────────────────
    // Build the full URL Twilio signed against. With `trust proxy = 1` set in
    // server.js, req.protocol returns the value from X-Forwarded-Proto (https
    // in production), so the URL will match what Twilio computed regardless of
    // whether we're behind ngrok, Railway, or Cloudflare.
    const twilioSig  = req.headers["x-twilio-signature"] || "";
    const webhookUrl = `${req.protocol}://${req.get("host")}/sms/incoming`;

    if (AUTH_TOKEN) {
      const valid = twilio.validateRequest(AUTH_TOKEN, twilioSig, webhookUrl, req.body);
      if (!valid) {
        console.warn(`[sms-webhook] Invalid Twilio signature from ${req.ip} — rejected`);
        return res.status(403).type("text/xml").send("<Response/>");
      }
    } else {
      console.warn("[sms-webhook] TWILIO_AUTH_TOKEN not set — signature check skipped");
    }

    // ── 2. Parse payload ──────────────────────────────────────────────────────
    const from    = (req.body.From       || "").trim();
    const msgBody = (req.body.Body       || "").trim();
    const to      = (req.body.To         || TWILIO_FROM).trim();
    const msgSid  = (req.body.MessageSid || "").trim();

    if (!from || !msgBody) {
      return res.type("text/xml").send("<Response/>");
    }

    console.log(`[sms-webhook] From: ${from}  Body: "${msgBody.slice(0, 80)}"`);

    // ── 3. Match clinic by phone ──────────────────────────────────────────────
    const clinic     = matchClinicByPhone(from);
    const clinicName = clinic?.clinicName || clinic?.name || null;

    // ── 4. Classify intent ────────────────────────────────────────────────────
    const { intent, template } = classifyIntent(msgBody);
    const draftFilled = template
      ? fill(template, { clinicName: clinicName || "your clinic", city: clinic?.city || "" })
      : null;

    // ── 5. Append to sms.replies.json ─────────────────────────────────────────
    const entry = {
      id:           msgSid || `sms_${Date.now()}`,
      from,
      to,
      body:         msgBody,
      receivedAt:   new Date().toISOString(),
      clinicName:   clinicName || null,
      clinicFound:  Boolean(clinic),
      intent,
      draftBody:    draftFilled?.body    || null,
      draftSubject: draftFilled?.subject || null,
      processed:    false,
    };

    try {
      const log = readJsonSafe(SMS_LOG_PATH, []);
      log.push(entry);
      writeJsonSafe(SMS_LOG_PATH, log);
    } catch (err) {
      console.error("[sms-webhook] sms.replies.json write failed:", err.message);
    }

    // ── 6. Notification email (only when a clinic was matched) ────────────────
    if (clinic) {
      sendNotificationEmail({
        from,
        body:       msgBody,
        clinicName,
        intent,
        draftBody:  draftFilled?.body || null,
      }).catch((err) =>
        console.warn("[sms-webhook] Notification email failed:", err.message)
      );
    }

    // ── 7. TwiML — forward to Mohamed's personal number ───────────────────────
    // Twilio executes the <Message> verb immediately as it processes the response,
    // so no extra REST API call is needed.
    const forwardText = `SMS from ${from}: ${msgBody}`;
    const escaped = forwardText
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");

    const twiml = [
      `<?xml version="1.0" encoding="UTF-8"?>`,
      `<Response>`,
      `  <Message to="${NOTIFY_PHONE}">${escaped}</Message>`,
      `</Response>`,
    ].join("\n");

    res.type("text/xml").send(twiml);
    console.log(`[sms-webhook] Forwarded to ${NOTIFY_PHONE} — clinic: ${clinicName || "(no match)"} — intent: ${intent}`);
  });
}
