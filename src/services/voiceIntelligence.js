// src/services/voiceIntelligence.js
// When a patient calls and leaves a voicemail, we transcribe it and respond
// to what they ACTUALLY said — not a generic "we missed your call" message.

import Anthropic from "@anthropic-ai/sdk";
import dotenv from "dotenv";
import { handlePatientMessage } from "./conversationEngine.js";
import { logEvent, EVENT_TYPES, getEvents } from "./eventLog.js";

dotenv.config();

const ANTHROPIC_API_KEY = (process.env.ANTHROPIC_API_KEY || "").trim();

// ─── Transcription ────────────────────────────────────────────────────────────

/**
 * Parse a Twilio-provided transcription into a structured format.
 * Twilio's built-in transcription is free — Whisper is commented for future upgrade.
 *
 * @param {string} transcriptionText — from Twilio's TranscriptionText param
 * @param {string} clinicSlug
 * @param {string} callerPhone
 * @returns {Promise<object>} structured transcription
 */
export async function transcribeVoicemail(transcriptionText, clinicSlug, callerPhone) {
  // If no transcription provided (recording-only webhook), return minimal structure
  if (!transcriptionText || transcriptionText === "Transcription pending...") {
    return {
      text:            null,
      callerName:      null,
      intent:          "unknown",
      urgency:         "low",
      specificRequest: null,
      callbackNumber:  callerPhone,
      rawTranscript:   transcriptionText || null,
    };
  }

  // WHISPER UPGRADE POINT:
  // To use OpenAI Whisper for higher accuracy, download the recording from
  // the recordingUrl, send to:
  // const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  // const transcription = await openai.audio.transcriptions.create({
  //   file: fs.createReadStream(localRecordingPath),
  //   model: "whisper-1",
  // });
  // Then pass transcription.text below instead of transcriptionText.

  // Use Claude to extract structured info from Twilio's transcription
  if (!ANTHROPIC_API_KEY) {
    return {
      text:            transcriptionText,
      callerName:      null,
      intent:          "unknown",
      urgency:         "low",
      specificRequest: transcriptionText,
      callbackNumber:  callerPhone,
      rawTranscript:   transcriptionText,
    };
  }

  try {
    const anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY });
    const response  = await anthropic.messages.create({
      model:      "claude-opus-4-7",
      max_tokens: 300,
      messages: [{
        role:    "user",
        content: `A patient left a voicemail. Extract structured information from this transcript.

Transcript: "${transcriptionText}"

Return a JSON object with these fields:
- callerName: string or null (their name if they said it)
- intent: one of "book_appointment", "reschedule", "cancel", "question", "complaint", "emergency", "other"
- urgency: one of "low", "medium", "high", "emergency"
- specificRequest: string (what they specifically asked for, under 100 chars)
- callbackNumber: string or null (if they mentioned a different callback number)

Return only valid JSON, nothing else.`,
      }],
    });

    const text   = response.content.find((b) => b.type === "text")?.text || "{}";
    const parsed = JSON.parse(text.match(/\{[\s\S]*\}/)?.[0] || "{}");

    return {
      text:            transcriptionText,
      callerName:      parsed.callerName   || null,
      intent:          parsed.intent       || "other",
      urgency:         parsed.urgency      || "low",
      specificRequest: parsed.specificRequest || transcriptionText.slice(0, 100),
      callbackNumber:  parsed.callbackNumber || callerPhone,
      rawTranscript:   transcriptionText,
    };
  } catch (err) {
    console.error(`[voiceIntelligence] Transcription parsing failed: ${err.message}`);
    return {
      text:            transcriptionText,
      callerName:      null,
      intent:          "other",
      urgency:         "low",
      specificRequest: transcriptionText.slice(0, 100),
      callbackNumber:  callerPhone,
      rawTranscript:   transcriptionText,
    };
  }
}

// ─── Intelligent response ─────────────────────────────────────────────────────

/**
 * Respond to a voicemail by treating the transcription as a patient message.
 * Uses conversationEngine so the response is personalized, not generic.
 *
 * @param {string} clinicSlug
 * @param {string} callerPhone — E.164
 * @param {object} transcription — result of transcribeVoicemail()
 * @returns {Promise<{ message, intent, sent }>}
 */
export async function respondToVoicemail(clinicSlug, callerPhone, transcription) {
  // Log the voicemail transcription event
  logEvent(clinicSlug, {
    type:        EVENT_TYPES.VOICE_TRANSCRIBED,
    patientPhone: callerPhone,
    patientName: transcription.callerName || null,
    direction:   "inbound",
    channel:     "voice",
    content:     transcription.text || transcription.specificRequest || "Voicemail received",
    intent:      transcription.intent,
    sentiment:   transcription.urgency === "emergency" ? "urgent" : "neutral",
    outcome:     "transcribed",
    metadata: {
      urgency:         transcription.urgency,
      specificRequest: transcription.specificRequest,
    },
  });

  // If no usable transcription, fall back to the regular missed-call SMS
  if (!transcription.text && !transcription.specificRequest) {
    console.log(`[voiceIntelligence] No transcription for ${callerPhone} — using generic response`);
    return { message: null, intent: "unknown", sent: false };
  }

  // Build a message for Claude that includes what the patient said
  let claudeMessage = transcription.specificRequest || transcription.text || "";
  if (transcription.callerName) {
    claudeMessage = `[Patient identified themselves as ${transcription.callerName}] ${claudeMessage}`;
  }

  // Use conversationEngine — same logic as SMS reply, different trigger
  const result = await handlePatientMessage(clinicSlug, callerPhone, claudeMessage);

  return {
    message: result.response,
    intent:  result.intent,
    sent:    result.sent,
    escalated: result.escalated,
  };
}

// ─── Call pattern analytics ───────────────────────────────────────────────────

/**
 * Analyze voice call patterns for a clinic.
 * Returns insights that feed the portal heatmap and predictive engine.
 *
 * @param {string} clinicSlug
 * @returns {object} analytics summary
 */
export function analyzeCallPatterns(clinicSlug) {
  // Get all missed call and voice events
  const voiceEvents = getEvents(clinicSlug, {
    type: [EVENT_TYPES.MISSED_CALL, EVENT_TYPES.VOICE_TRANSCRIBED],
  });

  if (!voiceEvents.length) {
    return {
      totalCalls:         0,
      voicemailRate:      0,
      responseRate:       0,
      conversionRate:     0,
      commonReasons:      [],
      busiestHour:        null,
      busiestDay:         null,
    };
  }

  // Busiest hour and day
  const hourCounts = {};
  const dayCounts  = {};
  const reasonCounts = {};

  voiceEvents.forEach((e) => {
    const d = new Date(e.timestamp);
    const h = d.getHours();
    const day = d.toLocaleDateString("en-CA", { weekday: "long" });
    hourCounts[h]   = (hourCounts[h]   || 0) + 1;
    dayCounts[day]  = (dayCounts[day]  || 0) + 1;
    if (e.intent) reasonCounts[e.intent] = (reasonCounts[e.intent] || 0) + 1;
  });

  const busiestHour = Object.entries(hourCounts).sort(([,a],[,b])=>b-a)[0]?.[0];
  const busiestDay  = Object.entries(dayCounts).sort(([,a],[,b])=>b-a)[0]?.[0];
  const commonReasons = Object.entries(reasonCounts)
    .sort(([,a],[,b])=>b-a)
    .slice(0, 3)
    .map(([reason]) => reason);

  const missedCalls     = voiceEvents.filter((e) => e.type === EVENT_TYPES.MISSED_CALL).length;
  const voicemails      = voiceEvents.filter((e) => e.type === EVENT_TYPES.VOICE_TRANSCRIBED).length;
  const voicemailRate   = missedCalls > 0 ? Math.round((voicemails / missedCalls) * 100) : 0;

  return {
    totalCalls:     voiceEvents.length,
    missedCalls,
    voicemailRate,
    busiestHour:    busiestHour ? `${busiestHour}:00` : null,
    busiestDay,
    commonReasons,
  };
}
