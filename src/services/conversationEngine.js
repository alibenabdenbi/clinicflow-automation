// src/services/conversationEngine.js
// The brain behind every patient SMS interaction.
// Claude API + Clinic Brain + Patient Memory = responses that feel human.

import Anthropic from "@anthropic-ai/sdk";
import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import { buildSystemPrompt, isWithinHours, getNextOpenTime } from "./clinicBrain.js";
import { buildMemoryContext } from "./patientMemory.js";
import { getPatientHistory, logEvent, EVENT_TYPES } from "./eventLog.js";
import { sendSMS } from "./smsService.js";
import { getClient } from "./clientLifecycle.js";
import {
  getPendingBooking,
  initiateBooking,
  confirmBooking,
  cancelBooking,
  detectSlotChoice,
} from "./bookingService.js";

dotenv.config();

const ANTHROPIC_API_KEY = (process.env.ANTHROPIC_API_KEY || "").trim();
const NOTIFY_PHONE      = (process.env.NOTIFY_PHONE || "+15149617077").trim();
const CLIENTS_DIR       = path.join(process.cwd(), "data", "clients");

// ─── Brain loader: local filesystem first, Netlify Blobs fallback ─────────────

/**
 * Load the clinic brain from the local filesystem (server-side) or
 * from Netlify Blobs (Netlify function context).
 * Local filesystem is always tried first — it is the source of truth on the server.
 *
 * @param {string} clinicSlug
 * @returns {Promise<object|null>}
 */
async function loadClinicBrain(clinicSlug) {
  // 1. Try local filesystem (server-side Node.js — always wins when file exists)
  const localPath = path.join(CLIENTS_DIR, clinicSlug, "clinic-brain.json");
  if (fs.existsSync(localPath)) {
    try { return JSON.parse(fs.readFileSync(localPath, "utf-8")); } catch {}
  }

  // 2. Try Netlify Blobs (Netlify function context — approved brains pending local sync)
  try {
    const { getStore } = await import("@netlify/blobs");
    const store = getStore({
      name:   "clinic-brains",
      siteID: process.env.NETLIFY_SITE_ID,
      token:  process.env.NETLIFY_ACCESS_TOKEN || process.env.NETLIFY_AUTH_TOKEN,
    });
    const brain = await store.get(clinicSlug, { type: "json" });
    if (brain) {
      console.log(`[conversationEngine] Loaded brain for ${clinicSlug} from Netlify Blobs`);
      return brain;
    }
  } catch {
    // @netlify/blobs not available in this context — expected on the server
  }

  return null;
}

// ─── Intent classification ────────────────────────────────────────────────────

const INTENT_PATTERNS = {
  BOOK_APPOINTMENT: /\b(book|schedule|make|need|want).{0,20}(appointment|appoint|visit|cleaning|exam|checkup|check.?up)\b|\b(when|do you have|any).{0,20}(available|openings?|slots?)\b/i,
  RESCHEDULE:       /\b(reschedule|change|move|shift|different day|different time|postpone|push back)\b/i,
  CANCEL:           /\b(cancel|cancell|can't make|cant make|unable to|won't be able)\b/i,
  CONFIRM:          /^\s*(yes|yeah|yep|confirmed?|confirm|ok|okay|sounds good|perfect|great|sure|absolutely)\s*[!.]*\s*$/i,
  ASK_HOURS:        /\b(hour|open|close|when.{0,15}open|what time|what are your)\b/i,
  ASK_PRICE:        /\b(cost|price|how much|fee|charge|rate|quote|expensive)\b/i,
  ASK_SERVICE:      /\b(do you|offer|provide|available|invisalign|whitening|cleaning|filling|crown|root canal|braces|implant|veneer|scaling|massage|physio|treatment)\b/i,
  ASK_INSURANCE:    /\b(insurance|coverage|covered|plan|benefit|sunlife|manulife|green shield|blue cross|desjardins)\b/i,
  ASK_LOCATION:     /\b(address|where|location|parking|directions?|how do i get|transit|bus|metro)\b/i,
  COMPLAINT:        /\b(unhappy|disappointe|frustrat|terrible|awful|worst|bad experience|unprofessional|rude|never again|waste|refund|sue)\b/i,
  COMPLIMENT:       /\b(thank|thanks|great job|amazing|wonderful|excellent|love|best|fantastic|perfect|happy|satisfied)\b/i,
  OPT_OUT:          /^\s*(stop|unsubscribe|opt.?out|remove me|don't (text|contact|message)|no more (texts?|messages?))\s*[.!]*\s*$|stop (texting|messaging|contacting) (me|us)/i,
  EMERGENCY:        /\b(emergency|severe pain|swollen|swelling|broken tooth|fell out|can't eat|unbearable|911|help|urgent|face is swelling)\b/i,
  CONFUSED:         /\b(who (is this|are you)|what is this|not sure|confused|mistake|wrong number)\b/i,
  OTHER:            null,
};

/**
 * Classify a patient message into one of 15 intents.
 * @param {string} body
 * @returns {string} intent key
 */
export function classifyIntent(body) {
  const b = (body || "").trim();
  for (const [intent, pattern] of Object.entries(INTENT_PATTERNS)) {
    if (pattern && pattern.test(b)) return intent;
  }
  return "OTHER";
}

// ─── Emotion detection ────────────────────────────────────────────────────────

/**
 * Detect the emotional tone of a patient message.
 * @param {string} body
 * @returns {'positive'|'neutral'|'negative'|'urgent'|'emergency'}
 */
export function detectEmotion(body) {
  const b = (body || "").toLowerCase();

  // Emergency first — highest priority
  if (/\b(severe pain|swelling|swollen face|can't breathe|blood|broken|knocked out|emergency|urgent|horrible pain|unbearable)\b/.test(b)) return "emergency";

  // Urgency
  if (/\b(urgent|asap|right away|immediately|today|need help|hurting|in pain|hurt|ache)\b/.test(b)) return "urgent";

  // Negative
  if (/\b(angry|upset|frustrated|disappointed|terrible|awful|horrible|worst|unfair|unacceptable|ridiculous|disgusting)\b/.test(b)) return "negative";

  // Positive
  if (/\b(thanks?|great|amazing|wonderful|perfect|love|excellent|awesome|fantastic|happy|appreciate|grateful)\b/.test(b)) return "positive";

  return "neutral";
}

// ─── Claude API call ──────────────────────────────────────────────────────────

/**
 * Generate a response using Claude with full clinic + patient context.
 * Falls back to a generic response if the API fails.
 *
 * @param {string} systemPrompt — full clinic brain prompt
 * @param {string} patientContext — memory context string
 * @param {string} message — the patient's actual message
 * @param {string} clinicSlug — for logging
 * @returns {Promise<string>} response text
 */
export async function generateResponse(systemPrompt, patientContext, message, clinicSlug) {
  if (!ANTHROPIC_API_KEY) {
    console.warn("[conversationEngine] No ANTHROPIC_API_KEY — using fallback response");
    return "Thank you for your message! A member of our team will follow up with you shortly.";
  }

  const anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY });

  const fullSystem = `${systemPrompt}

PATIENT CONTEXT:
${patientContext}`;

  try {
    const response = await anthropic.messages.create({
      model:      "claude-opus-4-7",
      max_tokens: 300,
      thinking:   { type: "adaptive" },
      system:     fullSystem,
      messages: [{ role: "user", content: message }],
    });

    const text = response.content.find((b) => b.type === "text")?.text || "";
    return text.trim();
  } catch (err) {
    console.error(`[conversationEngine] Claude API error: ${err.message}`);
    return "Thank you for reaching out! Someone from our team will follow up with you shortly.";
  }
}

// ─── Escalation ───────────────────────────────────────────────────────────────

/**
 * Escalate to Mohamed via SMS and send a holding message to the patient.
 * @param {string} clinicSlug
 * @param {string} patientPhone
 * @param {string} reason
 * @param {string} messageBody
 */
export async function escalate(clinicSlug, patientPhone, reason, messageBody) {
  const clinic    = getClient(clinicSlug);
  const clinicName = clinic?.clinicName || clinicSlug;
  const from       = clinic?.twilioNumber || process.env.TWILIO_FROM_NUMBER;

  console.log(`[conversationEngine] ESCALATION — ${clinicSlug} | ${patientPhone} | ${reason}`);

  // Alert Mohamed
  try {
    const alertBody = `🚨 ESCALATION — ${clinicName}\nPatient: ${patientPhone}\nReason: ${reason}\nMessage: "${messageBody?.slice(0, 100)}"`;
    await sendSMS(NOTIFY_PHONE, alertBody, process.env.TWILIO_FROM_NUMBER);
  } catch (err) {
    console.error(`[conversationEngine] Escalation SMS failed: ${err.message}`);
  }

  // Patient holding message
  let holdingMessage;
  if (reason === "emergency") {
    const emergencyPhone = clinic?.clinicPhone || "";
    holdingMessage = emergencyPhone
      ? `This sounds urgent. Please call us immediately at ${emergencyPhone} — we have same-day emergency slots available. — ${clinicName}`
      : `This sounds urgent. A team member will call you back within the next 30 minutes. — ${clinicName}`;
  } else {
    holdingMessage = `I'll have someone from our team follow up with you within 2 hours. — ${clinicName}`;
  }

  try {
    await sendSMS(patientPhone, holdingMessage, from);
  } catch {}

  logEvent(clinicSlug, {
    type:        EVENT_TYPES.ESCALATION,
    patientPhone,
    direction:   "system",
    channel:     "sms",
    content:     `Escalated: ${reason} | Patient said: "${messageBody?.slice(0, 80)}"`,
    sentiment:   reason === "emergency" ? "urgent" : "negative",
    outcome:     "escalated",
    metadata:    { reason },
  });

  return { escalated: true, reason, holdingMessage };
}

// ─── Main entry point ─────────────────────────────────────────────────────────

/**
 * Handle every inbound patient message.
 * This is the single entry point for all patient SMS interactions.
 *
 * @param {string} clinicSlug
 * @param {string} patientPhone — E.164
 * @param {string} messageBody
 * @returns {Promise<{ response, intent, emotion, action, escalated, sent }>}
 */
export async function handlePatientMessage(clinicSlug, patientPhone, messageBody) {
  const clinic  = getClient(clinicSlug);
  const from    = clinic?.twilioNumber || process.env.TWILIO_FROM_NUMBER;

  // Log the inbound message first — always
  const intent  = classifyIntent(messageBody);
  const emotion = detectEmotion(messageBody);

  logEvent(clinicSlug, {
    type:        EVENT_TYPES.PATIENT_REPLIED,
    patientPhone,
    direction:   "inbound",
    channel:     "sms",
    content:     messageBody,
    intent,
    sentiment:   emotion,
    outcome:     "received",
  });

  // ── Emergency → escalate immediately (highest priority) ──────────────────
  if (emotion === "emergency" || intent === "EMERGENCY") {
    const esc = await escalate(clinicSlug, patientPhone, "emergency", messageBody);
    return { response: esc.holdingMessage, intent, emotion, action: "escalated", escalated: true, sent: true };
  }

  // ── Complaint → escalate ─────────────────────────────────────────────────
  if (intent === "COMPLAINT") {
    const esc = await escalate(clinicSlug, patientPhone, "complaint", messageBody);
    return { response: esc.holdingMessage, intent, emotion, action: "escalated", escalated: true, sent: true };
  }

  // ── Opt-out ───────────────────────────────────────────────────────────────
  if (intent === "OPT_OUT") {
    const clinicName = clinic?.clinicName || "the clinic";
    const optOutMsg  = `You've been removed from our follow-up list. Call us any time if you need to book — ${clinic?.clinicPhone || ""}. — ${clinicName}`;
    try { await sendSMS(patientPhone, optOutMsg, from); } catch {}
    logEvent(clinicSlug, {
      type: EVENT_TYPES.PATIENT_OPTED_OUT, patientPhone, direction: "outbound",
      channel: "sms", content: optOutMsg, outcome: "opted_out",
    });
    return { response: optOutMsg, intent, emotion, action: "opted_out", escalated: false, sent: true };
  }

  // ── BOOKING STATE MACHINE ─────────────────────────────────────────────────
  // Check BEFORE passing to Claude — booking flow bypasses generic AI response

  // Step 1: Is patient mid-booking flow? (they were offered slots, now picking)
  const pendingBooking = getPendingBooking(clinicSlug, patientPhone);
  if (pendingBooking && intent !== "CANCEL") {
    const slotIndex = await detectSlotChoice(messageBody, pendingBooking.slotsOffered);
    if (slotIndex !== null) {
      // Patient picked a slot — confirm it
      const result = await confirmBooking(clinicSlug, patientPhone, slotIndex);
      if (result.confirmed && result.message) {
        let sent = false;
        try { await sendSMS(patientPhone, result.message, from); sent = true; } catch {}
        logEvent(clinicSlug, {
          type: EVENT_TYPES.CLINIC_BRAIN_ANSWER, patientPhone, direction: "outbound",
          channel: "sms", content: result.message, intent: "BOOK_APPOINTMENT",
          outcome: "sent", metadata: { action: "booking_confirmed" },
        });
        return { response: result.message, intent: "BOOK_APPOINTMENT", emotion, action: "booking_confirmed", escalated: false, sent };
      }
    } else {
      // Slot choice unclear — ask Claude to clarify in booking context
      const slotList  = pendingBooking.slotsOffered.map((s, i) => `${i + 1}. ${s.display}`).join(", ");
      const clarifyMsg = `Sorry, I didn't catch that! Could you reply with 1, 2, or 3 to pick a time?\n${slotList}\n— ${clinic?.clinicName || "us"}`;
      let sent = false;
      try { await sendSMS(patientPhone, clarifyMsg, from); sent = true; } catch {}
      return { response: clarifyMsg, intent, emotion, action: "booking_clarify", escalated: false, sent };
    }
  }

  // Step 2: Patient wants to cancel their booking
  if (intent === "CANCEL") {
    const result = await cancelBooking(clinicSlug, patientPhone);
    let sent = false;
    if (result.message) {
      try { await sendSMS(patientPhone, result.message, from); sent = true; } catch {}
    }
    return { response: result.message, intent: "CANCEL", emotion, action: result.cancelled ? "booking_cancelled" : "no_booking_found", escalated: false, sent };
  }

  // Step 3: Patient wants to book (fresh request, no pending booking)
  if (intent === "BOOK_APPOINTMENT" || intent === "RESCHEDULE") {
    // Get patient name from memory if available
    const history    = getPatientHistory(clinicSlug, patientPhone);
    const patientName = history.find((e) => e.patientName)?.patientName || null;

    const result = await initiateBooking(clinicSlug, patientPhone, messageBody, patientName);
    let sent = false;
    if (result.message) {
      try { await sendSMS(patientPhone, result.message, from); sent = true; } catch {}
      logEvent(clinicSlug, {
        type: EVENT_TYPES.CLINIC_BRAIN_ANSWER, patientPhone, patientName,
        direction: "outbound", channel: "sms", content: result.message,
        intent: "BOOK_APPOINTMENT", outcome: sent ? "sent" : "failed",
        metadata: { action: "slots_offered", bookingId: result.bookingId },
      });
    }
    return {
      response: result.message,
      intent: "BOOK_APPOINTMENT",
      emotion,
      action: result.slots?.length ? "slots_offered" : "booking_fallback",
      escalated: false,
      sent,
    };
  }

  // ── All other intents → Claude with full clinic brain + memory ────────────

  // Build full context for Claude
  const systemPrompt   = buildSystemPrompt(clinicSlug);
  const patientContext = buildMemoryContext(clinicSlug, patientPhone);
  const withinHours    = isWithinHours(clinicSlug);
  const nextOpen       = withinHours ? "" : getNextOpenTime(clinicSlug);

  const contextWithHours = patientContext + (
    withinHours ? "" : `\n\nNOTE: The clinic is currently CLOSED. Next open: ${nextOpen}. Do not promise same-day callbacks.`
  );

  // Generate Claude response
  const responseText = await generateResponse(systemPrompt, contextWithHours, messageBody, clinicSlug);

  // Send via Twilio
  let sent = false;
  if (patientPhone && responseText) {
    try { await sendSMS(patientPhone, responseText, from); sent = true; }
    catch (err) { console.error(`[conversationEngine] SMS send failed: ${err.message}`); }
  }

  // Log the outbound response
  logEvent(clinicSlug, {
    type:        EVENT_TYPES.CLINIC_BRAIN_ANSWER,
    patientPhone,
    direction:   "outbound",
    channel:     "sms",
    content:     responseText,
    intent,
    sentiment:   "neutral",
    outcome:     sent ? "sent" : "failed",
    metadata:    { intent, emotion, withinHours },
    revenueAttributed: 0,
  });

  return { response: responseText, intent, emotion, action: "claude_response", escalated: false, sent };
}
