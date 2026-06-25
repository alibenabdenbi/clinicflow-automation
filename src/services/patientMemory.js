// src/services/patientMemory.js
// Every patient has a memory. Claude reads it before writing to them.
// Built automatically from the event log — no manual entry needed.

import fs from "fs";
import path from "path";
import Anthropic from "@anthropic-ai/sdk";
import { getPatientHistory, logEvent } from "./eventLog.js";

const CLIENTS_DIR = path.join(process.cwd(), "data", "clients");

function readJsonSafe(p, fb) {
  try {
    if (!fs.existsSync(p)) return fb;
    return JSON.parse(fs.readFileSync(p, "utf-8"));
  } catch { return fb; }
}

function writeJsonSafe(p, data) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(data, null, 2), "utf-8");
}

function digitsOnly(s) { return String(s || "").replace(/\D/g, ""); }

function memoryPath(clinicSlug) {
  return path.join(CLIENTS_DIR, clinicSlug, "patient-memory.json");
}

// ─── Language detection ───────────────────────────────────────────────────────

function detectLanguage(messages) {
  const frenchPatterns = /\b(je|vous|nous|merci|bonjour|bonsoir|oui|non|rendez-vous|s'il|ça|très|aussi)\b/i;
  const combined = messages.map((m) => m.content || "").join(" ");
  if (frenchPatterns.test(combined)) return "french";
  if (/[àâäéèêëîïôùûüç]/i.test(combined)) return "french";
  return "english";
}

// ─── Build profile from event history ─────────────────────────────────────────

function buildProfileFromHistory(events) {
  if (!events.length) return null;

  const phone      = events[0].patientPhone;
  const name       = events.find((e) => e.patientName)?.patientName || null;
  const firstEvent = events[events.length - 1]; // oldest
  const lastEvent  = events[0];                  // newest

  // Reply timing analysis
  const inboundEvents  = events.filter((e) => e.direction === "inbound");
  const outboundEvents = events.filter((e) => e.direction === "outbound");
  const responseRate   = outboundEvents.length > 0
    ? Math.round((inboundEvents.length / outboundEvents.length) * 100) / 100
    : 0;

  // Best contact time from inbound reply timestamps
  let bestContactTime = { day: "Tuesday", hour: 10 };
  if (inboundEvents.length >= 2) {
    const hourCounts = {};
    const dayCounts  = {};
    inboundEvents.forEach((e) => {
      const d = new Date(e.timestamp);
      const h = d.getHours();
      const day = d.toLocaleDateString("en-CA", { weekday: "long" });
      hourCounts[h]   = (hourCounts[h]   || 0) + 1;
      dayCounts[day]  = (dayCounts[day]  || 0) + 1;
    });
    const bestHour = Number(Object.entries(hourCounts).sort(([,a],[,b])=>b-a)[0][0]);
    const bestDay  = Object.entries(dayCounts).sort(([,a],[,b])=>b-a)[0][0];
    bestContactTime = { day: bestDay, hour: bestHour };
  }

  // Reply time average
  let avgReplyMinutes = null;
  const replied = inboundEvents
    .map((inbound) => {
      const outboundBefore = outboundEvents.find(
        (out) => new Date(out.timestamp) < new Date(inbound.timestamp)
      );
      if (!outboundBefore) return null;
      return (new Date(inbound.timestamp) - new Date(outboundBefore.timestamp)) / 60000;
    })
    .filter((n) => n !== null && n < 1440); // ignore gaps > 24h

  if (replied.length) {
    avgReplyMinutes = Math.round(replied.reduce((a, b) => a + b, 0) / replied.length);
  }

  // Language detection
  const allInbound = inboundEvents.map((e) => ({ content: e.content }));
  const language   = detectLanguage(allInbound);

  // Appointment history from events
  const appointmentHistory = events
    .filter((e) => e.type === "appointment_reminder_72h" || e.type === "appointment_reminder_24h")
    .map((e) => ({
      date:    e.timestamp.slice(0, 10),
      type:    e.metadata?.serviceType || "appointment",
      outcome: e.outcome || "reminded",
    }));

  // Emotional history
  const emotionalHistory = events
    .filter((e) => e.sentiment && e.sentiment !== "neutral")
    .slice(0, 5)
    .map((e) => ({
      date:      e.timestamp.slice(0, 10),
      sentiment: e.sentiment,
      note:      e.content?.slice(0, 80) || "",
    }));

  // Recovery history
  const recoveryEvents = events.filter((e) => e.type?.startsWith("recovery_wave_") || e.type === "patient_replied" || e.type === "patient_booked");
  const timesBooked    = events.filter((e) => e.type === "patient_booked").length;

  // Last 10 messages for conversation context
  const conversationHistory = events.slice(0, 10).map((e) => ({
    direction:  e.direction,
    content:    (e.content || "").slice(0, 200),
    timestamp:  e.timestamp,
    outcome:    e.outcome,
  }));

  // Tags
  const tags = [];
  if (responseRate >= 0.8)  tags.push("responsive");
  if (timesBooked > 0)      tags.push("champion");
  if (responseRate < 0.2)   tags.push("hard_to_reach");
  if (emotionalHistory.some((h) => h.sentiment === "negative")) tags.push("needs_care");
  if (events.length >= 5)   tags.push("regular");

  return {
    phone,
    name,
    firstContact:      firstEvent.timestamp,
    lastContact:       lastEvent.timestamp,
    totalInteractions: events.length,
    appointmentHistory,
    communicationProfile: {
      averageReplyTimeMinutes: avgReplyMinutes,
      prefersTexting:          inboundEvents.length > 0,
      bestContactTime,
      languageDetected:        language,
      responseRate,
    },
    emotionalHistory,
    recoveryHistory: {
      timesContacted:  outboundEvents.length,
      timesResponded:  inboundEvents.length,
      timesBooked,
      lastOutcome:     lastEvent.outcome || null,
    },
    personalNotes:       null, // populated by extractPersonalNotes()
    tags,
    conversationHistory,
    ltv:               timesBooked * 200,
    churnRisk:         null, // from predictiveEngine
    recoveryLikelihood: null,
    lastUpdated:       new Date().toISOString(),
  };
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Return the full patient profile built from event history + cached personal notes.
 * Fast — reads from files, no API call.
 * @param {string} clinicSlug
 * @param {string} patientPhone — E.164
 * @returns {object|null}
 */
export function getPatientMemory(clinicSlug, patientPhone) {
  // Load cached memory if fresh enough (< 1 day old)
  const memPath = memoryPath(clinicSlug);
  const allMemory = readJsonSafe(memPath, {});
  const digits    = digitsOnly(patientPhone);
  const cached    = allMemory[digits];

  // Always rebuild from event log for accuracy
  const events  = getPatientHistory(clinicSlug, patientPhone);
  if (!events.length) return cached || null;

  const profile = buildProfileFromHistory(events);
  if (!profile) return null;

  // Preserve personal notes from cache
  if (cached?.personalNotes) profile.personalNotes = cached.personalNotes;
  if (cached?.churnRisk    != null) profile.churnRisk          = cached.churnRisk;
  if (cached?.recoveryLikelihood != null) profile.recoveryLikelihood = cached.recoveryLikelihood;

  return profile;
}

/**
 * Update patient memory based on a new event.
 * Called by logEvent — keeps memory in sync without a full rebuild.
 * @param {string} clinicSlug
 * @param {string} patientPhone
 * @param {object} event
 */
export function updatePatientMemory(clinicSlug, patientPhone, event) {
  if (!patientPhone) return;
  // Full rebuild is fast enough for now; optimize to incremental if needed
  const profile = getPatientMemory(clinicSlug, patientPhone);
  if (!profile) return;

  const memPath   = memoryPath(clinicSlug);
  const allMemory = readJsonSafe(memPath, {});
  const digits    = digitsOnly(patientPhone);
  allMemory[digits] = profile;
  writeJsonSafe(memPath, allMemory);
}

/**
 * Use Claude to extract personal notes from conversation history.
 * Runs monthly for active patients. Updates the memory file.
 * @param {string} clinicSlug
 * @param {string} patientPhone
 * @returns {Promise<string[]>} extracted notes
 */
export async function extractPersonalNotes(clinicSlug, patientPhone) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return [];

  const events = getPatientHistory(clinicSlug, patientPhone);
  const inbound = events.filter((e) => e.direction === "inbound").slice(0, 20);
  if (!inbound.length) return [];

  const messages = inbound.map((e) => `Patient: "${e.content?.slice(0, 150)}"`).join("\n");

  try {
    const anthropic = new Anthropic({ apiKey });
    const response  = await anthropic.messages.create({
      model:      "claude-opus-4-7",
      max_tokens: 300,
      messages: [{
        role:    "user",
        content: `Read these patient messages and extract any personal details worth remembering for future interactions. Only extract real facts mentioned — do not infer.

Messages:
${messages}

Return a JSON array of short notes. Examples: "Mentioned being anxious about needles", "Has young children — mention family-friendly services", "Prefers morning appointments based on message times", "Works shifts — needs flexible booking". Return [] if nothing notable.`,
      }],
    });

    const text = response.content.find((b) => b.type === "text")?.text || "[]";
    const notes = JSON.parse(text.match(/\[[\s\S]*\]/)?.[0] || "[]");

    // Save to memory
    const memPath   = memoryPath(clinicSlug);
    const allMemory = readJsonSafe(memPath, {});
    const digits    = digitsOnly(patientPhone);
    if (!allMemory[digits]) allMemory[digits] = {};
    allMemory[digits].personalNotes = Array.isArray(notes) ? notes.join(" | ") : String(notes);
    allMemory[digits].notesUpdatedAt = new Date().toISOString();
    writeJsonSafe(memPath, allMemory);

    return Array.isArray(notes) ? notes : [];
  } catch (err) {
    console.error(`[patientMemory] extractPersonalNotes failed: ${err.message}`);
    return [];
  }
}

/**
 * Return a formatted string for Claude's context window.
 * Concise — designed to fit comfortably in a system prompt.
 * @param {string} clinicSlug
 * @param {string} patientPhone
 * @returns {string}
 */
export function buildMemoryContext(clinicSlug, patientPhone) {
  const memory = getPatientMemory(clinicSlug, patientPhone);
  if (!memory) return "New patient — no history on file.";

  const lines = [];

  if (memory.name) lines.push(`Patient: ${memory.name}`);
  else             lines.push("Patient: Name unknown");

  if (memory.lastContact) {
    const last = new Date(memory.lastContact).toLocaleDateString("en-CA", { month: "long", day: "numeric", year: "numeric" });
    lines.push(`Last contact: ${last}`);
  }

  if (memory.recoveryHistory?.timesBooked > 0) {
    lines.push(`Booked ${memory.recoveryHistory.timesBooked} time(s) through ClinicFlow`);
  }

  if (memory.communicationProfile?.responseRate > 0) {
    lines.push(`Response rate: ${Math.round(memory.communicationProfile.responseRate * 100)}%`);
  }

  if (memory.communicationProfile?.bestContactTime) {
    const { day, hour } = memory.communicationProfile.bestContactTime;
    const timeStr = hour < 12 ? `${hour}am` : hour === 12 ? "12pm" : `${hour - 12}pm`;
    lines.push(`Best contact time: ${day} around ${timeStr}`);
  }

  if (memory.communicationProfile?.languageDetected === "french") {
    lines.push("Language: Responds in French — reply in French");
  }

  if (memory.personalNotes) {
    lines.push(`Notes: ${memory.personalNotes}`);
  }

  if (memory.emotionalHistory?.length) {
    const latest = memory.emotionalHistory[0];
    if (latest.sentiment !== "neutral") {
      lines.push(`Emotional note: Last interaction was ${latest.sentiment} — ${latest.note?.slice(0, 60)}`);
    }
  }

  const lastMessages = (memory.conversationHistory || []).slice(0, 4);
  if (lastMessages.length) {
    lines.push("\nRecent conversation:");
    lastMessages.forEach((m) => {
      const prefix = m.direction === "inbound" ? "Patient" : "Clinic";
      lines.push(`  ${prefix}: "${m.content?.slice(0, 100)}"`);
    });
  }

  return lines.join("\n");
}

// ─── Scheduler entry point ────────────────────────────────────────────────────

/**
 * Extract personal notes for every patient across all active clients.
 * Runs on the 1st of each month via scheduler.
 * Uses Claude to read conversation history and extract memorable personal details.
 * @returns {Promise<{ processed, extracted, errors }>}
 */
export async function extractPersonalNotesForAllClients() {
  const CLIENTS_PATH = path.join(process.cwd(), "data", "clients.json");
  let clients = [];
  try { clients = JSON.parse(fs.readFileSync(CLIENTS_PATH, "utf-8")); } catch {}

  const active = clients.filter((c) => c.clinicSlug && c.status === "active");
  console.log(`[patientMemory] Monthly notes extraction — ${active.length} active client(s)`);

  let processed = 0, extracted = 0;
  const errors = [];

  for (const client of active) {
    const slug      = client.clinicSlug;
    const eventsPath = path.join(CLIENTS_DIR, slug, "events.json");
    let events = [];
    try { events = JSON.parse(fs.readFileSync(eventsPath, "utf-8")); } catch {}

    // Collect unique patient phones that have inbound replies
    const activePhones = [
      ...new Set(
        events
          .filter((e) => e.direction === "inbound" && e.patientPhone)
          .map((e) => e.patientPhone)
      ),
    ];

    console.log(`[patientMemory] ${slug}: ${activePhones.length} patient(s) with conversation history`);

    for (const phone of activePhones) {
      processed++;
      try {
        const notes = await extractPersonalNotes(slug, phone);
        if (notes.length > 0) {
          extracted++;
          console.log(`[patientMemory] ✓ ${slug} | ${phone}: ${notes.length} note(s) — "${notes[0]?.slice(0, 60)}"`);
        }
        // Rate-limit: 1 second between Claude API calls to avoid hammering
        await new Promise((r) => setTimeout(r, 1000));
      } catch (err) {
        const msg = `${slug} | ${phone}: ${err.message}`;
        console.error(`[patientMemory] ✗ ${msg}`);
        errors.push(msg);
      }
    }
  }

  console.log(`[patientMemory] Done. Processed: ${processed} | With notes: ${extracted} | Errors: ${errors.length}`);
  return { processed, extracted, errors };
}
