// src/services/eventLog.js
// Single source of truth for every patient interaction across every service.
// Every service writes here. Every report reads from here.
// Events are append-only — never overwritten, never deleted.

import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";

const CLIENTS_DIR = path.join(process.cwd(), "data", "clients");

// ─── Valid event types ────────────────────────────────────────────────────────

export const EVENT_TYPES = {
  MISSED_CALL:              "missed_call",
  RECOVERY_WAVE_1:          "recovery_wave_1",
  RECOVERY_WAVE_2:          "recovery_wave_2",
  RECOVERY_WAVE_3:          "recovery_wave_3",
  PATIENT_REPLIED:          "patient_replied",
  PATIENT_BOOKED:           "patient_booked",
  REMINDER_72H:             "appointment_reminder_72h",
  REMINDER_24H:             "appointment_reminder_24h",
  REACTIVATION_WAVE_1:      "reactivation_wave_1",
  REACTIVATION_WAVE_2:      "reactivation_wave_2",
  REACTIVATION_WAVE_3:      "reactivation_wave_3",
  PATIENT_OPTED_OUT:        "patient_opted_out",
  ESCALATION:               "escalation",
  CLINIC_BRAIN_ANSWER:      "clinic_brain_answer",
  EMOTIONAL_ESCALATION:     "emotional_escalation",
  VOICE_TRANSCRIBED:        "voice_transcribed",
  OPPORTUNITY_DETECTED:     "opportunity_detected",
  REFERRAL_SENT:            "referral_sent",
};

// ─── File helpers ─────────────────────────────────────────────────────────────

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

function eventsPath(clinicSlug) {
  return path.join(CLIENTS_DIR, clinicSlug, "events.json");
}

function statsPath(clinicSlug) {
  return path.join(CLIENTS_DIR, clinicSlug, "stats.json");
}

// ─── Heatmap helpers ──────────────────────────────────────────────────────────

/**
 * Increment the right heatmap cell (day × hour) for a given timestamp.
 * Heatmap key: day 0=Mon…6=Sun, hour 8-17.
 */
export function updateHeatmap(clinicSlug, timestamp) {
  const d   = new Date(timestamp || Date.now());
  const day  = (d.getDay() + 6) % 7; // Mon=0…Sun=6
  const hour = d.getHours();
  if (hour < 8 || hour > 17) return; // outside tracked window

  const stats = readJsonSafe(statsPath(clinicSlug), {});
  if (!stats.heatmap) {
    stats.heatmap = {};
    for (let i = 0; i < 7; i++) {
      stats.heatmap[i] = {};
      for (let h = 8; h <= 17; h++) stats.heatmap[i][h] = 0;
    }
  }
  if (!stats.heatmap[day]) stats.heatmap[day] = {};
  stats.heatmap[day][hour] = (stats.heatmap[day][hour] || 0) + 1;
  writeJsonSafe(statsPath(clinicSlug), stats);
}

// ─── Funnel + recent activity updater ────────────────────────────────────────

function updateStats(clinicSlug, event) {
  const stats = readJsonSafe(statsPath(clinicSlug), {});

  // Update heatmap for inbound calls
  if (event.type === EVENT_TYPES.MISSED_CALL) {
    updateHeatmap(clinicSlug, event.timestamp);
  }

  // Update recovery funnel counters in stats
  if (!stats.recovery) {
    stats.recovery = {
      total: 0, wave1Sent: 0, wave2Sent: 0, wave3Sent: 0,
      replied: 0, recovered: 0, optedOut: 0, exhausted: 0, waiting: 0,
      replyRate: 0, recoveryRate: 0,
    };
  }

  switch (event.type) {
    case EVENT_TYPES.MISSED_CALL:       stats.recovery.total++;                break;
    case EVENT_TYPES.RECOVERY_WAVE_1:   stats.recovery.wave1Sent++;            break;
    case EVENT_TYPES.RECOVERY_WAVE_2:   stats.recovery.wave2Sent++;            break;
    case EVENT_TYPES.RECOVERY_WAVE_3:   stats.recovery.wave3Sent++;            break;
    case EVENT_TYPES.PATIENT_REPLIED:   stats.recovery.replied++;              break;
    case EVENT_TYPES.PATIENT_BOOKED:    stats.recovery.recovered++;            break;
    case EVENT_TYPES.PATIENT_OPTED_OUT: stats.recovery.optedOut++;             break;
  }

  // Update recent activity for portal feed (last 50 events)
  if (!stats.recentActivity) stats.recentActivity = [];
  stats.recentActivity.unshift({
    type:        event.type,
    patientName: event.patientName || null,
    callerNumber: event.patientPhone || null,
    message:     event.content?.slice(0, 100) || "",
    time:        event.timestamp,
    outcome:     event.outcome,
  });
  if (stats.recentActivity.length > 50) stats.recentActivity = stats.recentActivity.slice(0, 50);

  // Revenue
  if (event.revenueAttributed > 0) {
    if (!stats.results) stats.results = {};
    stats.results.estimatedRevenueRecovered =
      (stats.results.estimatedRevenueRecovered || 0) + event.revenueAttributed;
  }

  stats.updatedAt = new Date().toISOString();
  writeJsonSafe(statsPath(clinicSlug), stats);
}

// ─── Core: logEvent ───────────────────────────────────────────────────────────

/**
 * Append one event to the clinic's event log and update stats.json.
 *
 * @param {string} clinicSlug
 * @param {object} event  — partial event; id and timestamp are auto-assigned
 * @returns {object} The full saved event record
 */
export function logEvent(clinicSlug, event) {
  if (!clinicSlug || !event?.type) {
    console.warn("[eventLog] logEvent called with missing slug or type");
    return null;
  }

  const full = {
    id:               randomUUID(),
    clinicSlug,
    type:             event.type,
    patientPhone:     event.patientPhone   || null,
    patientName:      event.patientName    || null,
    direction:        event.direction      || "outbound",
    channel:          event.channel        || "sms",
    content:          event.content        || "",
    sentiment:        event.sentiment      || null,
    intent:           event.intent         || null,
    outcome:          event.outcome        || "pending",
    revenueAttributed: event.revenueAttributed || 0,
    metadata:         event.metadata       || {},
    timestamp:        event.timestamp      || new Date().toISOString(),
  };

  // Append to events.json
  const p = eventsPath(clinicSlug);
  const events = readJsonSafe(p, []);
  events.push(full);
  writeJsonSafe(p, events);

  // Update stats.json async-style (fire-and-forget; errors logged, never thrown)
  try {
    updateStats(clinicSlug, full);
  } catch (err) {
    console.error(`[eventLog] stats update error (${clinicSlug}): ${err.message}`);
  }

  return full;
}

// ─── Queries ──────────────────────────────────────────────────────────────────

/**
 * Return events filtered by type, patientPhone, since-date, and/or limit.
 * Always sorted newest-first.
 *
 * @param {string} clinicSlug
 * @param {{ type?, patientPhone?, since?, limit? }} filters
 * @returns {object[]}
 */
export function getEvents(clinicSlug, filters = {}) {
  const all = readJsonSafe(eventsPath(clinicSlug), []);
  let result = all;

  if (filters.type) {
    const types = Array.isArray(filters.type) ? filters.type : [filters.type];
    result = result.filter((e) => types.includes(e.type));
  }
  if (filters.patientPhone) {
    const d = digitsOnly(filters.patientPhone);
    result = result.filter((e) => digitsOnly(e.patientPhone) === d);
  }
  if (filters.since) {
    const since = new Date(filters.since).getTime();
    result = result.filter((e) => new Date(e.timestamp).getTime() >= since);
  }

  // Sort newest first
  result = result.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

  if (filters.limit && filters.limit > 0) result = result.slice(0, filters.limit);
  return result;
}

/**
 * Return the full interaction history for one patient phone number.
 * This is the patient's memory — read by AI before responding.
 *
 * @param {string} clinicSlug
 * @param {string} patientPhone — E.164
 * @returns {object[]} Events sorted newest-first
 */
export function getPatientHistory(clinicSlug, patientPhone) {
  return getEvents(clinicSlug, { patientPhone });
}

/**
 * Return last N events formatted for portal activity feed display.
 * @param {string} clinicSlug
 * @param {number} limit
 * @returns {object[]}
 */
export function getRecentActivity(clinicSlug, limit = 20) {
  return getEvents(clinicSlug, { limit });
}

// ─── Revenue attribution ──────────────────────────────────────────────────────

/**
 * Log a revenue attribution event when a recovered patient books.
 * @param {string} clinicSlug
 * @param {string} patientPhone
 * @param {number} amount — dollars
 */
export function attributeRevenue(clinicSlug, patientPhone, amount = 200) {
  return logEvent(clinicSlug, {
    type:             "opportunity_detected",
    patientPhone,
    direction:        "system",
    channel:          "system",
    content:          `Revenue attributed: $${amount}`,
    outcome:          "booked",
    revenueAttributed: amount,
  });
}
