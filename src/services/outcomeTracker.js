// src/services/outcomeTracker.js
// Closes the attribution loop from "patient booked" → "revenue confirmed."
//
// After every booking confirmation, schedules an outcome check for 24h after
// the appointment time. Sends Mohamed an SMS: "Did [Patient] show up?"
// Mohamed replies YES/NO → attribution logged or reschedule triggered.

import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";
import { sendSMS } from "./smsService.js";
import { logEvent, EVENT_TYPES } from "./eventLog.js";

const CLIENTS_DIR   = path.join(process.cwd(), "data", "clients");
const CLIENTS_PATH  = path.join(process.cwd(), "data", "clients.json");
const NOTIFY_PHONE  = (process.env.NOTIFY_PHONE || "+15149617077").trim();

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

function checksPath(clinicSlug) {
  return path.join(CLIENTS_DIR, clinicSlug, "outcome-checks.json");
}

// ─── Schedule ─────────────────────────────────────────────────────────────────

/**
 * Schedule an outcome check for 24h after the appointment.
 * Called by bookingService.confirmBooking after every successful booking.
 *
 * @param {string} clinicSlug
 * @param {object} booking  — { id, patientPhone, patientName, serviceType, slotChosen }
 * @returns {string} checkId
 */
export function scheduleOutcomeCheck(clinicSlug, booking) {
  if (!booking?.slotChosen?.iso) return null;

  const appointmentTime = new Date(booking.slotChosen.iso);
  // Fire 24h after the appointment time
  const checkAt = new Date(appointmentTime.getTime() + 24 * 3600_000).toISOString();

  const check = {
    id:           randomUUID(),
    clinicSlug,
    bookingId:    booking.id,
    patientPhone: booking.patientPhone,
    patientName:  booking.patientName  || null,
    serviceType:  booking.serviceType  || "appointment",
    servicePrice: booking.servicePrice || 200,
    slotIso:      booking.slotChosen.iso,
    slotDisplay:  booking.slotChosen.display,
    calendarEventId: booking.calendarEventId || null,
    checkAt,
    status:       "pending",  // pending → sent → answered
    smsSentAt:    null,
    outcome:      null,       // null | "attended" | "no_show"
    answeredAt:   null,
  };

  const checks = readJsonSafe(checksPath(clinicSlug), []);
  checks.push(check);
  writeJsonSafe(checksPath(clinicSlug), checks);

  console.log(`[outcomeTracker] Scheduled outcome check for ${booking.patientName || booking.patientPhone} at ${checkAt}`);
  return check.id;
}

// ─── Send due checks ──────────────────────────────────────────────────────────

/**
 * Send outcome check SMS to Mohamed for any checks that are due.
 * Runs hourly via scheduler.
 * @returns {Promise<number>} number of checks sent
 */
export async function sendDueOutcomeChecks() {
  const clients = readJsonSafe(CLIENTS_PATH, []);
  const active  = clients.filter((c) => c.clinicSlug && c.status === "active");

  let sent = 0;

  for (const client of active) {
    const slug   = client.clinicSlug;
    const checks = readJsonSafe(checksPath(slug), []);
    let changed  = false;

    for (const check of checks) {
      if (check.status !== "pending") continue;
      if (new Date(check.checkAt).getTime() > Date.now()) continue;

      // Build SMS to Mohamed
      const clinicName = client.clinicName || slug;
      const name       = check.patientName || check.patientPhone;
      const short      = check.slotDisplay?.replace(/^(Mon|Tue|Wed|Thu|Fri|Sat|Sun)\w* /, "$1 ") || "their appointment";
      const msg        = `Did ${name} show up for ${check.serviceType} at ${clinicName} (${short})?\n\nReply YES or NO — I'll log the outcome.`;

      try {
        await sendSMS(NOTIFY_PHONE, msg, process.env.TWILIO_FROM_NUMBER);
        check.status    = "sent";
        check.smsSentAt = new Date().toISOString();
        changed         = true;
        sent++;
        console.log(`[outcomeTracker] ✓ Check sent for ${name} (${slug})`);
      } catch (err) {
        console.error(`[outcomeTracker] ✗ SMS failed: ${err.message}`);
      }
    }

    if (changed) writeJsonSafe(checksPath(slug), checks);
  }

  return sent;
}

// ─── Process reply ────────────────────────────────────────────────────────────

/**
 * Process Mohamed's YES/NO reply to an outcome check.
 * Called by the SMS reply handler when an operator reply matches an outcome check.
 *
 * @param {string} clinicSlug
 * @param {string} bookingId
 * @param {'attended'|'no_show'} outcome
 * @returns {Promise<{ logged, rescheduleTriggered }>}
 */
export async function processOutcomeReply(clinicSlug, bookingId, outcome) {
  const checks  = readJsonSafe(checksPath(clinicSlug), []);
  const idx     = checks.findIndex(
    (c) => (c.bookingId === bookingId || c.id === bookingId) && c.status === "sent"
  );
  if (idx === -1) return { logged: false, rescheduleTriggered: false };

  const check = checks[idx];
  const client = readJsonSafe(CLIENTS_PATH, []).find((c) => c.clinicSlug === clinicSlug);

  checks[idx].outcome    = outcome;
  checks[idx].status     = "answered";
  checks[idx].answeredAt = new Date().toISOString();
  writeJsonSafe(checksPath(clinicSlug), checks);

  // Log to event log
  logEvent(clinicSlug, {
    type:        outcome === "attended" ? EVENT_TYPES.PATIENT_BOOKED : "appointment_no_show",
    patientPhone: check.patientPhone,
    patientName:  check.patientName || null,
    direction:   "system",
    channel:     "system",
    content:     `Outcome confirmed: ${outcome} | ${check.slotDisplay}`,
    outcome:     outcome === "attended" ? "attended" : "no_show",
    revenueAttributed: outcome === "attended" ? (check.servicePrice || 200) : 0,
    metadata:    { bookingId, checkId: check.id, serviceType: check.serviceType },
  });

  if (outcome === "attended") {
    console.log(`[outcomeTracker] ✓ ATTENDED: ${check.patientName || check.patientPhone} | $${check.servicePrice || 200} attributed`);
    return { logged: true, rescheduleTriggered: false };
  }

  // No-show → trigger reschedule offer to patient
  let rescheduleTriggered = false;
  const clinicName = client?.clinicName || clinicSlug;
  const clinicPhone = client?.clinicPhone || "";
  const firstName  = (check.patientName || "").split(" ")[0] || "there";
  const rescheduleMsg = `Hi ${firstName}, we noticed you weren't able to make it to your ${check.serviceType} appointment yesterday at ${clinicName}. Life happens! Whenever you're ready to rebook, just reply here${clinicPhone ? ` or call ${clinicPhone}` : ""}. — ${clinicName}`;

  try {
    const from = client?.twilioNumber || process.env.TWILIO_FROM_NUMBER;
    await sendSMS(check.patientPhone, rescheduleMsg, from);
    rescheduleTriggered = true;
    logEvent(clinicSlug, {
      type:        EVENT_TYPES.OPPORTUNITY_DETECTED,
      patientPhone: check.patientPhone,
      patientName:  check.patientName || null,
      direction:   "outbound",
      channel:     "sms",
      content:     rescheduleMsg,
      outcome:     "sent",
      metadata:    { opportunityType: "no_show_rebook", bookingId },
    });
    console.log(`[outcomeTracker] ✓ No-show rebook offer sent to ${check.patientPhone}`);
  } catch (err) {
    console.error(`[outcomeTracker] ✗ Rebook SMS failed: ${err.message}`);
  }

  return { logged: true, rescheduleTriggered };
}

// ─── Operator reply parser ────────────────────────────────────────────────────

/**
 * Parse an incoming SMS from Mohamed to detect YES/NO outcome replies.
 * Returns null if the message doesn't look like an outcome reply.
 *
 * @param {string} messageBody
 * @returns {'attended'|'no_show'|null}
 */
export function parseOutcomeReply(messageBody) {
  const b = (messageBody || "").trim().toLowerCase();
  if (/^(yes|y|yep|yeah|attended|showed up|came|they came|she came|he came)/.test(b)) return "attended";
  if (/^(no|n|nope|no show|didn't|didnt|missed|wasn't|wasnt)/.test(b)) return "no_show";
  return null;
}

/**
 * Find the most recent pending outcome check across all active clients.
 * Used when Mohamed replies YES/NO without specifying which check.
 * @returns {{ clinicSlug, check }|null}
 */
export function getMostRecentSentCheck() {
  const clients = readJsonSafe(CLIENTS_PATH, []);
  const active  = clients.filter((c) => c.clinicSlug && c.status === "active");

  let newest = null;
  for (const client of active) {
    const checks = readJsonSafe(checksPath(client.clinicSlug), []);
    const sent   = checks.filter((c) => c.status === "sent");
    for (const check of sent) {
      if (!newest || new Date(check.smsSentAt) > new Date(newest.check.smsSentAt)) {
        newest = { clinicSlug: client.clinicSlug, check };
      }
    }
  }
  return newest;
}
