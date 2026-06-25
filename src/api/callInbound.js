// src/api/callInbound.js
// Handles inbound calls and post-recording webhooks for ClinicFlow Twilio number.
//
// Routes:
//   POST /webhooks/call-inbound   — answers call with TwiML greeting + Record verb
//   POST /webhooks/call-recording — receives recording URL + transcription, logs + alerts

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import express from "express";
import nodemailer from "nodemailer";
import dotenv from "dotenv";

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const DATA_DIR = path.join(ROOT, "data");

const OUTREACH_PATH   = path.join(DATA_DIR, "outreach.localDentists.json");
const CALLLOG_PATH    = path.join(DATA_DIR, "calls", "call-log.json");
const INBOUND_CALLS   = path.join(DATA_DIR, "inbound-calls.json");

const NOTIFY_PHONE  = (process.env.NOTIFY_PHONE        || "+15149617077").trim();
const NOTIFY_EMAIL  = (process.env.NOTIFY_EMAIL        || "m.aliben432@gmail.com").trim();
const TWILIO_FROM   = (process.env.TWILIO_FROM_NUMBER   || "+14385440442").trim();
const ACCOUNT_SID   = (process.env.TWILIO_ACCOUNT_SID   || "").trim();
const AUTH_TOKEN    = (process.env.TWILIO_AUTH_TOKEN    || "").trim();
const SMTP_HOST     = (process.env.SMTP_HOST            || "").trim();
const SMTP_PORT     = Number(process.env.SMTP_PORT      || 465);
const SMTP_USER     = (process.env.SMTP_USER            || "").trim();
const SMTP_PASS     = (process.env.SMTP_PASS            || "").trim();
const SMTP_FROM_ENV = (process.env.SMTP_FROM            || SMTP_USER).trim();

const urlencodedParser = express.urlencoded({ extended: false });

function readJsonSafe(p, fb) {
  try { return JSON.parse(fs.readFileSync(p, "utf-8")); } catch { return fb; }
}
function writeJsonSafe(p, data) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(data, null, 2), "utf-8");
}
function digitsOnly(s) { return String(s || "").replace(/\D/g, ""); }

function lookupClinic(from) {
  const d = digitsOnly(from);
  if (!d) return null;
  const outreach = readJsonSafe(OUTREACH_PATH, []);
  const match = outreach.find(c =>
    digitsOnly(c.phone) === d || digitsOnly(c.personalPhone) === d
  );
  if (match) return match.clinicName || match.name || null;
  const callLog = readJsonSafe(CALLLOG_PATH, []);
  const logMatch = callLog.find(c => digitsOnly(c.phone) === d);
  return logMatch?.clinicName || null;
}

async function sendSmsAlert(body) {
  if (!ACCOUNT_SID || !AUTH_TOKEN) return;
  const creds = Buffer.from(`${ACCOUNT_SID}:${AUTH_TOKEN}`).toString("base64");
  await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${ACCOUNT_SID}/Messages.json`,
    {
      method: "POST",
      headers: { Authorization: `Basic ${creds}`, "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ From: TWILIO_FROM, To: NOTIFY_PHONE, Body: body }),
    }
  );
}

async function sendEmailAlert({ clinicName, from, transcription, recordingUrl, receivedAt }) {
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) return;
  const transporter = nodemailer.createTransport({
    host: SMTP_HOST, port: SMTP_PORT, secure: SMTP_PORT === 465,
    auth: { user: SMTP_USER, pass: SMTP_PASS },
    tls: { rejectUnauthorized: false },
  });
  const text = [
    `Inbound voicemail received.`,
    ``,
    `From:          ${from}`,
    `Clinic:        ${clinicName}`,
    `Time:          ${receivedAt}`,
    `Transcription: ${transcription || "(transcribing...)"}`,
    `Recording:     ${recordingUrl || "(pending)"}`,
    ``,
    `—`,
    `Mohamed - ClinicFlow`,
  ].join("\n");

  await transporter.sendMail({
    from: `Mohamed - ClinicFlow <${SMTP_FROM_ENV}>`,
    to: NOTIFY_EMAIL,
    subject: `Inbound voicemail — ${clinicName}`,
    text,
  });
}

export function registerCallInboundRoutes(app) {

  // ── Answer inbound call with greeting + record verb ──────────────────────────
  app.post("/webhooks/call-inbound", urlencodedParser, (req, res) => {
    const from = (req.body.From || "").trim();
    const clinicName = lookupClinic(from) || `Unknown — ${from}`;
    console.log(`[call-inbound] Incoming call from ${from} — clinic: ${clinicName}`);

    const twiml = [
      `<?xml version="1.0" encoding="UTF-8"?>`,
      `<Response>`,
      `  <Say voice="Polly.Joanna">Thank you for calling ClinicFlow Automation. We're not available right now but we'll call you back within 2 hours. Please leave your name, clinic name, and a brief message after the tone.</Say>`,
      `  <Record maxLength="60" transcribe="true" transcribeCallback="/webhooks/call-recording" action="/webhooks/call-recording" playBeep="true"/>`,
      `</Response>`,
    ].join("\n");

    res.type("text/xml").send(twiml);
  });

  // ── Receive recording + transcription ────────────────────────────────────────
  app.post("/webhooks/call-recording", urlencodedParser, async (req, res) => {
    const from          = (req.body.From           || req.body.Caller || "").trim();
    const recordingUrl  = (req.body.RecordingUrl   || "").trim();
    const transcription = (req.body.TranscriptionText || "").trim();
    const receivedAt    = new Date().toISOString();

    const clinicName = lookupClinic(from) || `Unknown — ${from}`;
    console.log(`[call-recording] From: ${from} | Clinic: ${clinicName} | Transcription: "${transcription.slice(0, 80)}"`);

    // Log to inbound-calls.json
    const entry = { from, clinicName, recordingUrl, transcription: transcription || null, receivedAt, callbackDone: false };
    try {
      const log = readJsonSafe(INBOUND_CALLS, []);
      log.push(entry);
      writeJsonSafe(INBOUND_CALLS, log);
    } catch (e) { console.error("[call-recording] log write failed:", e.message); }

    // SMS alert
    const smsBody = `📞 VOICEMAIL: ${clinicName} (${from}): ${transcription || "transcribing..."}`;
    sendSmsAlert(smsBody).catch(e => console.warn("[call-recording] SMS alert failed:", e.message));

    // Email alert
    sendEmailAlert({ clinicName, from, transcription, recordingUrl, receivedAt })
      .catch(e => console.warn("[call-recording] email alert failed:", e.message));

    res.sendStatus(200);
  });
}
