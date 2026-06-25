// src/api/callbackWebhook.js
// Twilio voice webhook for incoming calls to +14385440442.
// When a clinic calls back after a voicemail drop:
//   1. Cross-references the caller's number against outreach.localDentists.json
//   2. If matched: SMS alert to Mohamed → "CALLBACK from [ClinicName] — [phone]"
//   3. Logs to data/calls/callbacks.json
//   4. Returns TwiML to connect the call normally
//
// Route: POST /voice/incoming  (registered in server.js)

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import express from "express";
import twilio from "twilio";
import dotenv from "dotenv";
import { sendSMS } from "../services/smsService.js";

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const DATA_DIR = path.join(ROOT, "data");
const OUTREACH_PATH  = path.join(DATA_DIR, "outreach.localDentists.json");
const CALLBACKS_LOG  = path.join(DATA_DIR, "calls", "callbacks.json");

const AUTH_TOKEN   = (process.env.TWILIO_AUTH_TOKEN  || "").trim();
const NOTIFY_PHONE = (process.env.NOTIFY_PHONE       || "+15149617077").trim();
const FORWARD_TO   = NOTIFY_PHONE; // forward the call to Mohamed's number

const urlencodedParser = express.urlencoded({ extended: false });

function readJsonSafe(p, fb) {
  try { if (!fs.existsSync(p)) return fb; return JSON.parse(fs.readFileSync(p, "utf-8")); }
  catch { return fb; }
}

function writeJsonSafe(p, data) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(data, null, 2), "utf-8");
}

function digitsOnly(phone) {
  return String(phone || "").replace(/\D/g, "");
}

// Match a calling number against all clinic phone fields
function matchClinic(fromNumber) {
  const clinics = readJsonSafe(OUTREACH_PATH, []);
  const digits = digitsOnly(fromNumber);
  if (!digits) return null;
  return clinics.find(c =>
    digitsOnly(c.phone)         === digits ||
    digitsOnly(c.personalPhone) === digits
  ) || null;
}

export function registerCallbackWebhookRoute(app) {
  app.post("/voice/incoming", urlencodedParser, async (req, res) => {

    // Validate Twilio signature
    const sig        = req.headers["x-twilio-signature"] || "";
    const webhookUrl = `${req.protocol}://${req.get("host")}/voice/incoming`;
    if (AUTH_TOKEN) {
      const valid = twilio.validateRequest(AUTH_TOKEN, sig, webhookUrl, req.body);
      if (!valid) {
        console.warn(`[callback-webhook] Invalid signature from ${req.ip} — rejected`);
        return res.status(403).type("text/xml").send("<Response/>");
      }
    }

    const from   = (req.body.From    || "").trim();
    const callSid = (req.body.CallSid || "").trim();
    console.log(`[callback-webhook] Incoming call from ${from}`);

    // Match against clinic database
    const clinic     = matchClinic(from);
    const clinicName = clinic?.clinicName || null;
    const now        = new Date().toISOString();

    // Log to callbacks.json
    const entry = {
      callSid,
      from,
      clinicName: clinicName || null,
      clinicFound: Boolean(clinic),
      city:   clinic?.city  || null,
      email:  clinic?.email || null,
      receivedAt: now,
    };
    try {
      const log = readJsonSafe(CALLBACKS_LOG, []);
      log.push(entry);
      writeJsonSafe(CALLBACKS_LOG, log);
    } catch (err) {
      console.error("[callback-webhook] callbacks.json write failed:", err.message);
    }

    // SMS alert if we matched a clinic
    if (clinic) {
      const city = clinic.city ? ` (${clinic.city})` : "";
      const msg  = `CALLBACK from ${clinicName}${city} — ${from}`;
      sendSMS(NOTIFY_PHONE, msg).catch(e =>
        console.warn("[callback-webhook] SMS alert failed:", e.message)
      );
      console.log(`[callback-webhook] Matched clinic: ${clinicName} — SMS alert sent`);
    } else {
      console.log(`[callback-webhook] No clinic match for ${from}`);
    }

    // TwiML: forward call to Mohamed's personal number
    const escapedForward = FORWARD_TO.replace(/&/g, "&amp;");
    const twiml = [
      `<?xml version="1.0" encoding="UTF-8"?>`,
      `<Response>`,
      `  <Dial>${escapedForward}</Dial>`,
      `</Response>`,
    ].join("\n");

    res.type("text/xml").send(twiml);
  });
}
