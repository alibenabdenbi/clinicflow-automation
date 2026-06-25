// src/api/missedCallWebhook.js
// Twilio webhook for clinic missed call follow-up.
// Clinic forwards their number to a Twilio number assigned to them.
// Twilio POST /webhooks/missed-call/:clinicSlug → answers with TwiML + fires SMS.

import express from "express";
import { handleMissedCall } from "../services/missedCallService.js";

const urlencodedParser = express.urlencoded({ extended: false });

export function registerMissedCallWebhookRoute(app) {
  // POST /webhooks/missed-call/:clinicSlug
  // Must be in isPublicRoute whitelist — no admin auth required.
  // Returns TwiML immediately; SMS fires async so we never hit Twilio's 15s timeout.
  app.post("/webhooks/missed-call/:clinicSlug", urlencodedParser, async (req, res) => {
    const clinicSlug   = (req.params.clinicSlug || "").trim().toLowerCase();
    const callerNumber = (req.body.From    || req.body.Caller || "").trim();
    const callSid      = (req.body.CallSid || "").trim();

    console.log(`[webhook/missed-call] ${clinicSlug} ← ${callerNumber} (${callSid})`);

    const { twiml } = await handleMissedCall(clinicSlug, callerNumber, callSid)
      .catch((err) => {
        console.error(`[webhook/missed-call] Error: ${err.message}`);
        return {
          twiml: `<?xml version="1.0" encoding="UTF-8"?><Response><Hangup/></Response>`,
        };
      });

    res.set("Content-Type", "text/xml");
    res.send(twiml);
  });
}
