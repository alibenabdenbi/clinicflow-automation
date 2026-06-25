// src/api/patientReplyWebhook.js
// Handles inbound SMS replies from patients to clinic Twilio numbers.
// Route: POST /webhooks/patient-reply/:clinicSlug
//
// Uses conversationEngine (Claude + clinic brain + patient memory) instead of
// the basic intent classifier in patientRecoveryEngine.

import express from "express";
import { handlePatientMessage } from "../services/conversationEngine.js";

const urlencodedParser = express.urlencoded({ extended: false });

export function registerPatientReplyWebhookRoute(app) {
  app.post("/webhooks/patient-reply/:clinicSlug", urlencodedParser, async (req, res) => {
    const clinicSlug   = (req.params.clinicSlug || "").trim().toLowerCase();
    const callerNumber = (req.body.From || "").trim();
    const body         = (req.body.Body || "").trim();
    const msgSid       = (req.body.MessageSid || "").trim();

    console.log(`[webhook/patient-reply] ${clinicSlug} ← ${callerNumber}: "${body.slice(0, 60)}" (${msgSid})`);

    // Return TwiML immediately — conversation engine fires async
    res.set("Content-Type", "text/xml");
    res.send(`<?xml version="1.0" encoding="UTF-8"?><Response/>`);

    // Process with full intelligence: clinic brain + patient memory + Claude
    setImmediate(async () => {
      try {
        const result = await handlePatientMessage(clinicSlug, callerNumber, body);
        console.log(`[webhook/patient-reply] ${clinicSlug}: intent=${result.intent} emotion=${result.emotion} sent=${result.sent}`);
      } catch (err) {
        console.error(`[webhook/patient-reply] Error: ${err.message}`);
      }
    });
  });
}
