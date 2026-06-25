// src/api/smsInbound.js
// Handles inbound SMS replies from clinics on the ClinicFlow Twilio number.
// Route: POST /webhooks/sms-inbound
//
// Flow:
//   1. Parse From / Body / To from Twilio form payload
//   2. Look up clinic by phone in outreach.localDentists.json + call-log.json
//   3. Log to data/inbound-sms.json
//   4. Send SMS alert to Mohamed
//   5. Send auto-reply TwiML back to clinic
//   6. Return <Response/>

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import express from "express";
import dotenv from "dotenv";

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const DATA_DIR = path.join(ROOT, "data");

const OUTREACH_PATH  = path.join(DATA_DIR, "outreach.localDentists.json");
const CALLLOG_PATH   = path.join(DATA_DIR, "calls", "call-log.json");
const INBOUND_SMS    = path.join(DATA_DIR, "inbound-sms.json");

const NOTIFY_PHONE   = (process.env.NOTIFY_PHONE       || "+15149617077").trim();
const TWILIO_FROM    = (process.env.TWILIO_FROM_NUMBER  || "+14385440442").trim();
const ACCOUNT_SID    = (process.env.TWILIO_ACCOUNT_SID  || "").trim();
const AUTH_TOKEN     = (process.env.TWILIO_AUTH_TOKEN   || "").trim();

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

async function sendSmsAlert(to, body) {
  if (!ACCOUNT_SID || !AUTH_TOKEN) return;
  const creds = Buffer.from(`${ACCOUNT_SID}:${AUTH_TOKEN}`).toString("base64");
  await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${ACCOUNT_SID}/Messages.json`,
    {
      method: "POST",
      headers: { Authorization: `Basic ${creds}`, "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ From: TWILIO_FROM, To: to, Body: body }),
    }
  );
}

export function registerSmsInboundRoute(app) {
  app.post("/webhooks/sms-inbound", urlencodedParser, async (req, res) => {
    const from    = (req.body.From || "").trim();
    const msgBody = (req.body.Body || "").trim();

    if (!from) return res.type("text/xml").send("<Response/>");

    const clinicName = lookupClinic(from) || `Unknown — ${from}`;
    console.log(`[sms-inbound] From: ${from} | Clinic: ${clinicName} | "${msgBody.slice(0, 60)}"`);

    // Log entry
    const entry = { from, body: msgBody, clinicName, receivedAt: new Date().toISOString(), responded: false };
    try {
      const log = readJsonSafe(INBOUND_SMS, []);
      log.push(entry);
      writeJsonSafe(INBOUND_SMS, log);
    } catch (e) { console.error("[sms-inbound] log write failed:", e.message); }

    // Alert Mohamed
    const alertMsg = `📱 SMS REPLY: ${clinicName} (${from}): ${msgBody.slice(0, 140)}`;
    sendSmsAlert(NOTIFY_PHONE, alertMsg).catch(e =>
      console.warn("[sms-inbound] alert SMS failed:", e.message)
    );

    // Auto-reply TwiML
    const reply = "Hi! Thanks for reaching out. Mohamed will follow up with you shortly. You can also reach us at contact@clinicflowautomation.com";
    const escaped = reply.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    res.type("text/xml").send([
      `<?xml version="1.0" encoding="UTF-8"?>`,
      `<Response>`,
      `  <Message>${escaped}</Message>`,
      `</Response>`,
    ].join("\n"));
  });
}
