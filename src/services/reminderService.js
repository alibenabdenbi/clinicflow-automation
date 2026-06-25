// src/services/reminderService.js
// Reads patient CSV for each active client, sends SMS appointment reminders.
// Runs daily at 8:30am via scheduler.

import fs from "fs";
import path from "path";
import { sendSMS } from "./smsService.js";
import { getActiveClients, updateClient } from "./clientLifecycle.js";
import { logEvent, EVENT_TYPES } from "./eventLog.js";

const CLIENTS_DIR = path.join(process.cwd(), "data", "clients");

// ─── Helpers ──────────────────────────────────────────────────────────────────

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

function parseCsv(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return [];
  const headers = lines[0].split(",").map((h) => h.trim().toLowerCase());
  return lines.slice(1).map((line) => {
    const vals = line.split(",");
    const obj  = {};
    headers.forEach((h, i) => { obj[h] = (vals[i] || "").trim(); });
    return obj;
  });
}

// ─── Patient CSV loader ───────────────────────────────────────────────────────

/**
 * Load and parse patients.csv for a clinic.
 * Expected columns: name, phone, email, next_appointment (YYYY-MM-DD HH:MM), last_visit
 * @param {string} clinicSlug
 * @returns {object[]}
 */
/**
 * Load and parse patients for a clinic.
 * Priority: (1) local CSV on disk, (2) Netlify Blobs (uploaded via portal).
 * @param {string} clinicSlug
 * @returns {object[]}
 */
export async function loadPatients(clinicSlug) {
  // 1. Local filesystem first (always authoritative on server)
  const csvPath = path.join(CLIENTS_DIR, clinicSlug, "patients.csv");
  if (fs.existsSync(csvPath)) {
    return parseCsv(fs.readFileSync(csvPath, "utf-8"));
  }

  // 2. Netlify Blobs — for CSV uploaded via portal when local file doesn't exist
  try {
    const { getStore } = await import("@netlify/blobs");
    const store = getStore({
      name:   "patient-csvs",
      siteID: process.env.NETLIFY_SITE_ID,
      token:  process.env.NETLIFY_ACCESS_TOKEN || process.env.NETLIFY_AUTH_TOKEN,
    });
    const csvText = await store.get(`patients-${clinicSlug}`, { type: "text" });
    if (csvText) {
      console.log(`[reminders] Loaded patients from Netlify Blobs for ${clinicSlug}`);
      return parseCsv(csvText);
    }
  } catch {
    // @netlify/blobs not available or not configured — expected on local server
  }

  console.warn(`[reminders] No patients data for ${clinicSlug}`);
  return [];
}

// ─── Appointment filter ───────────────────────────────────────────────────────

/**
 * Return patients whose next_appointment falls within a ±4-hour window
 * centred on `hoursAhead` from now. This prevents double-sending when
 * the scheduler runs multiple times per day.
 *
 * Example: hoursAhead=72 → appointments between 68h and 76h from now.
 *
 * @param {object[]} patients
 * @param {number}   hoursAhead  — 24 or 72
 * @returns {object[]}
 */
export function getUpcomingAppointments(patients, hoursAhead) {
  const now         = Date.now();
  const centre      = now + hoursAhead * 3_600_000;
  const windowStart = centre - 4 * 3_600_000;
  const windowEnd   = centre + 4 * 3_600_000;

  return patients.filter((p) => {
    if (!p.next_appointment || !p.phone) return false;
    const apptTime = new Date(p.next_appointment).getTime();
    if (isNaN(apptTime)) return false;
    return apptTime >= windowStart && apptTime <= windowEnd;
  });
}

// ─── SMS sender ───────────────────────────────────────────────────────────────

/**
 * Send a reminder SMS for one patient.
 * @param {object} patient
 * @param {object} clinic
 * @param {"72h"|"24h"} type
 */
export async function sendReminder(patient, clinic, type) {
  const firstName  = (patient.name || "").split(" ")[0] || "there";
  const clinicName = clinic.clinicName || "your clinic";
  const clinicPhone = clinic.clinicPhone || "";
  const appt = new Date(patient.next_appointment);
  const dayStr  = appt.toLocaleDateString("en-CA", {
    weekday: "long", month: "long", day: "numeric",
  });
  const timeStr = appt.toLocaleTimeString("en-CA", {
    hour: "numeric", minute: "2-digit", hour12: true,
  });

  let body;
  if (type === "72h") {
    body = `Hi ${firstName}, this is a reminder from ${clinicName} — you have an appointment on ${dayStr} at ${timeStr}. Reply YES to confirm or call ${clinicPhone} to reschedule.`;
  } else {
    body = `Hi ${firstName}, reminder: your appointment at ${clinicName} is tomorrow at ${timeStr}. See you then! Reply STOP to unsubscribe.`;
  }

  const from = clinic.twilioNumber || process.env.TWILIO_FROM_NUMBER;
  return sendSMS(patient.phone, body, from);
}

// ─── Logging ──────────────────────────────────────────────────────────────────

/**
 * Append one entry to the clinic's reminder log (dedup check uses this too).
 */
export function logReminder(clinicSlug, patientName, phone, type) {
  const logPath = path.join(CLIENTS_DIR, clinicSlug, "reminders.json");
  const log = readJsonSafe(logPath, []);
  log.push({ patientName, phone, type, at: new Date().toISOString() });
  writeJsonSafe(logPath, log);
}

/**
 * Check whether a reminder of the given type was already sent to this phone
 * within the last 6 hours (prevents double-send on scheduler restarts).
 */
export function alreadySentReminder(clinicSlug, phone, type) {
  const logPath = path.join(CLIENTS_DIR, clinicSlug, "reminders.json");
  const log = readJsonSafe(logPath, []);
  const sixHoursAgo = Date.now() - 6 * 3_600_000;
  return log.some(
    (e) => e.phone === phone && e.type === type && new Date(e.at).getTime() > sixHoursAgo
  );
}

/**
 * Return aggregate stats for a clinic's reminder log.
 */
export function getReminderStats(clinicSlug) {
  const logPath = path.join(CLIENTS_DIR, clinicSlug, "reminders.json");
  const log = readJsonSafe(logPath, []);
  return {
    total:  log.length,
    "72h":  log.filter((e) => e.type === "72h").length,
    "24h":  log.filter((e) => e.type === "24h").length,
  };
}

// ─── Scheduler entry point ────────────────────────────────────────────────────

/**
 * Run reminders for all active clients with reminders enabled.
 * Called daily at 8:30am by scheduler.js.
 * @returns {Promise<{ totalSent, totalSkipped, errors }>}
 */
export async function runRemindersForAllClients() {
  const clients = getActiveClients().filter((c) => c.services?.reminders);
  console.log(`[reminders] Checking ${clients.length} active clinic(s)`);

  let totalSent = 0, totalSkipped = 0;
  const errors = [];

  for (const clinic of clients) {
    const slug     = clinic.clinicSlug;
    const patients = await loadPatients(slug);
    if (!patients.length) {
      console.log(`[reminders] ${slug}: no patients loaded`);
      continue;
    }

    for (const type of ["72h", "24h"]) {
      const hours    = type === "72h" ? 72 : 24;
      const upcoming = getUpcomingAppointments(patients, hours);

      for (const patient of upcoming) {
        if (alreadySentReminder(slug, patient.phone, type)) {
          totalSkipped++;
          continue;
        }
        try {
          await sendReminder(patient, clinic, type);
          logReminder(slug, patient.name, patient.phone, type);
          const results = clinic.results || {};
          updateClient(slug, {
            results: {
              ...results,
              appointmentsReminded: (results.appointmentsReminded || 0) + 1,
            },
          });
          logEvent(slug, {
            type:        type === "72h" ? EVENT_TYPES.REMINDER_72H : EVENT_TYPES.REMINDER_24H,
            patientPhone: patient.phone,
            patientName:  patient.name || null,
            direction:   "outbound",
            channel:     "sms",
            content:     `${type} appointment reminder sent`,
            outcome:     "sent",
            metadata:    { appointmentDate: patient.next_appointment },
          });
          totalSent++;
          console.log(`[reminders] ✓ ${type} sent to ${patient.name} (${slug})`);
        } catch (err) {
          const msg = `${slug} | ${patient.name} | ${type}: ${err.message}`;
          console.error(`[reminders] ✗ ${msg}`);
          errors.push(msg);
        }
      }
    }
  }

  console.log(`[reminders] Done. Sent: ${totalSent} | Skipped: ${totalSkipped} | Errors: ${errors.length}`);
  return { totalSent, totalSkipped, errors };
}
