// src/services/bookingService.js
// Multi-turn booking state machine.
// Manages the 2-3 SMS exchanges needed to go from "I want to book" to confirmed appointment.
//
// State flow:
//   slots_offered → [patient picks] → confirmed
//                 → [patient confused] → clarify → confirmed
//                 → [patient cancels] → cancelled → offer rebook

import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";
import Anthropic from "@anthropic-ai/sdk";
import dotenv from "dotenv";
import { getAvailableSlots, formatSlotsForSMS, createBookingEvent, cancelBookingEvent } from "./calendarService.js";
import { scheduleOutcomeCheck } from "./outcomeTracker.js";
import { logEvent, EVENT_TYPES, getPatientHistory } from "./eventLog.js";

dotenv.config();

const CLIENTS_DIR       = path.join(process.cwd(), "data", "clients");
const ANTHROPIC_API_KEY = (process.env.ANTHROPIC_API_KEY || "").trim();

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

function bookingsPath(clinicSlug) {
  return path.join(CLIENTS_DIR, clinicSlug, "bookings.json");
}

// ─── Booking record I/O ───────────────────────────────────────────────────────

function loadBookings(clinicSlug) {
  return readJsonSafe(bookingsPath(clinicSlug), []);
}

function saveBookings(clinicSlug, bookings) {
  writeJsonSafe(bookingsPath(clinicSlug), bookings);
}

/**
 * Get the active (non-resolved) booking record for a patient.
 * "Active" means status is 'slots_offered' — still waiting for slot choice.
 * @param {string} clinicSlug
 * @param {string} patientPhone
 * @returns {object|null}
 */
export function getPendingBooking(clinicSlug, patientPhone) {
  const bookings = loadBookings(clinicSlug);
  const digits   = (patientPhone || "").replace(/\D/g, "");
  // Find newest pending booking for this patient
  return bookings
    .filter(
      (b) =>
        b.status === "slots_offered" &&
        (b.patientPhone || "").replace(/\D/g, "") === digits &&
        // Expire after 2 hours
        Date.now() - new Date(b.offeredAt).getTime() < 2 * 3600_000
    )
    .sort((a, b) => new Date(b.offeredAt) - new Date(a.offeredAt))[0] || null;
}

function getClinicBrain(clinicSlug) {
  return readJsonSafe(path.join(CLIENTS_DIR, clinicSlug, "clinic-brain.json"), null);
}

function getClinicRecord(clinicSlug) {
  return readJsonSafe(path.join(process.cwd(), "data", "clients.json"), [])
    .find((c) => c.clinicSlug === clinicSlug) || null;
}

// ─── Service type detection ───────────────────────────────────────────────────

function detectServiceType(messageBody, brain) {
  const b = (messageBody || "").toLowerCase();
  if (!brain?.services) return "appointment";
  // Try to match patient's message against known service names
  for (const svc of brain.services) {
    if (svc.name && b.includes(svc.name.toLowerCase().split(" ")[0])) return svc.name;
  }
  if (/clean|hygiene|polish/i.test(b)) return "Cleaning & Exam";
  if (/whitening|whitening|bleach/i.test(b)) return "Teeth Whitening";
  if (/invisalign|braces|ortho/i.test(b)) return "Invisalign Consultation";
  if (/emergency|urgent|pain/i.test(b)) return "Dental Emergency";
  return "appointment";
}

// ─── Slot choice detection ────────────────────────────────────────────────────

/**
 * Intelligently parse a patient's reply to identify which slot they chose.
 * Handles: "1", "option 2", "wednesday works", "the 10am one", "second one"
 *
 * @param {string} messageBody
 * @param {Array<{ display, iso }>} slotsOffered
 * @returns {Promise<number|null>} 0-based index, or null if unclear
 */
export async function detectSlotChoice(messageBody, slotsOffered) {
  if (!messageBody || !slotsOffered?.length) return null;

  const b = messageBody.trim().toLowerCase();

  // Explicit number
  const numMatch = b.match(/^[#]?\s*([123])\s*[.)!]?\s*$/);
  if (numMatch) return Number(numMatch[1]) - 1;

  // Ordinal words
  if (/\b(first|1st|option\s*1|number\s*1)\b/.test(b)) return 0;
  if (/\b(second|2nd|option\s*2|number\s*2)\b/.test(b)) return 1;
  if (/\b(third|3rd|option\s*3|number\s*3)\b/.test(b)) return 2;

  // "the 2" / "number 2" / "#2"
  const numWordMatch = b.match(/\b(?:the\s+)?(?:option|number|slot|#)\s*([123])\b/);
  if (numWordMatch) return Number(numWordMatch[1]) - 1;

  // Day name matching
  const dayPatterns = [
    /\b(mon(?:day)?)\b/, /\b(tue(?:sday)?)\b/, /\b(wed(?:nesday)?)\b/,
    /\b(thu(?:rsday)?)\b/, /\b(fri(?:day)?)\b/, /\b(sat(?:urday)?)\b/, /\b(sun(?:day)?)\b/,
  ];
  for (const [i, slot] of slotsOffered.entries()) {
    const slotLow = slot.display.toLowerCase();
    for (const pattern of dayPatterns) {
      const match = b.match(pattern);
      if (match && slotLow.includes(match[1].slice(0, 3))) return i;
    }
  }

  // Time matching — "the 2pm one", "10am"
  const timeMatch = b.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i);
  if (timeMatch) {
    let hour = Number(timeMatch[1]);
    const min  = Number(timeMatch[2] || "0");
    const ampm = timeMatch[3].toLowerCase();
    if (ampm === "pm" && hour < 12) hour += 12;
    if (ampm === "am" && hour === 12) hour = 0;
    const targetMin = hour * 60 + min;
    for (const [i, slot] of slotsOffered.entries()) {
      const d     = new Date(slot.iso);
      const slotM = d.getHours() * 60 + d.getMinutes();
      if (Math.abs(slotM - targetMin) <= 30) return i;
    }
  }

  // Month + day matching — "may 13", "the 14th"
  const dayNumMatch = b.match(/\b(?:may|june|july|aug|sep|oct|nov|dec|jan|feb|mar|apr)\w*\s+(\d{1,2})\b|\b(\d{1,2})(?:st|nd|rd|th)\b/i);
  if (dayNumMatch) {
    const dayNum = Number(dayNumMatch[1] || dayNumMatch[2]);
    for (const [i, slot] of slotsOffered.entries()) {
      if (new Date(slot.iso).getDate() === dayNum) return i;
    }
  }

  // Claude fallback for ambiguous replies
  if (ANTHROPIC_API_KEY && slotsOffered.length) {
    try {
      const anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY });
      const slotList  = slotsOffered.map((s, i) => `${i + 1}. ${s.display}`).join("\n");
      const response  = await anthropic.messages.create({
        model:      "claude-opus-4-7",
        max_tokens: 20,
        messages: [{
          role:    "user",
          content: `Patient replied: "${messageBody}"\n\nAvailable slots:\n${slotList}\n\nWhich slot did the patient choose? Reply with just the number (1, 2, or 3) or "unclear" if it cannot be determined.`,
        }],
      });
      const text = response.content.find((b) => b.type === "text")?.text?.trim().toLowerCase();
      if (text === "1") return 0;
      if (text === "2") return 1;
      if (text === "3") return 2;
    } catch {}
  }

  return null;
}

// ─── Initiate booking ─────────────────────────────────────────────────────────

/**
 * Start the booking flow. Fetches real slots, creates a pending record,
 * returns the SMS message to send to the patient.
 *
 * @param {string} clinicSlug
 * @param {string} patientPhone
 * @param {string} messageBody — original patient message (for service type detection)
 * @param {string|null} patientName
 * @returns {Promise<{ message, bookingId, slots }>}
 */
export async function initiateBooking(clinicSlug, patientPhone, messageBody, patientName = null) {
  const brain       = getClinicBrain(clinicSlug);
  const clinic      = getClinicRecord(clinicSlug);
  const clinicName  = clinic?.clinicName || clinicSlug;
  const serviceType = detectServiceType(messageBody, brain);

  // Fetch available slots
  const slots = await getAvailableSlots(clinicSlug, serviceType, 3);

  if (!slots.length) {
    // No slots found — fall back to manual booking
    const phone  = brain?.contact?.phone || clinic?.clinicPhone || "";
    const msg    = `Hi${patientName ? ` ${patientName.split(" ")[0]}` : ""}! I'd love to get you booked in at ${clinicName}. Could you tell me your preferred day and time, or call us at ${phone}? — ${clinicName}`;
    return { message: msg, bookingId: null, slots: [] };
  }

  // Save pending booking record
  const bookingId = randomUUID();
  const record    = {
    id:           bookingId,
    clinicSlug,
    patientPhone,
    patientName:  patientName || null,
    serviceType,
    status:       "slots_offered",
    slotsOffered: slots,
    slotChosen:   null,
    calendarEventId: null,
    offeredAt:    new Date().toISOString(),
    confirmedAt:  null,
    cancelledAt:  null,
  };

  const bookings = loadBookings(clinicSlug);
  bookings.push(record);
  saveBookings(clinicSlug, bookings);

  // Format SMS
  const firstName = patientName?.split(" ")[0] || "";
  const greeting  = firstName ? `Hi ${firstName}! ` : "Hi! ";
  const tentNote  = slots[0]?.tentative ? " (subject to confirmation)" : "";
  const slotsText = formatSlotsForSMS(slots);
  const message   = `${greeting}Happy to book your ${serviceType} at ${clinicName}${tentNote}!\n\n${slotsText}\n\n— ${clinicName}`;

  logEvent(clinicSlug, {
    type:        EVENT_TYPES.OPPORTUNITY_DETECTED,
    patientPhone,
    patientName: patientName || null,
    direction:   "outbound",
    channel:     "sms",
    content:     message,
    intent:      "BOOK_APPOINTMENT",
    outcome:     "slots_offered",
    metadata:    { bookingId, serviceType, slotCount: slots.length },
  });

  console.log(`[booking] ${clinicSlug}: slots offered to ${patientPhone} (${serviceType})`);
  return { message, bookingId, slots };
}

// ─── Confirm booking ──────────────────────────────────────────────────────────

/**
 * Confirm the booking when patient picks a slot.
 * Creates a Google Calendar event and sends confirmation SMS.
 *
 * @param {string} clinicSlug
 * @param {string} patientPhone
 * @param {number} slotIndex  — 0-based
 * @returns {Promise<{ message, confirmed, calendarEventId }>}
 */
export async function confirmBooking(clinicSlug, patientPhone, slotIndex) {
  const bookings = loadBookings(clinicSlug);
  const digits   = (patientPhone || "").replace(/\D/g, "");
  const idx      = bookings.findIndex(
    (b) =>
      b.status === "slots_offered" &&
      (b.patientPhone || "").replace(/\D/g, "") === digits
  );

  if (idx === -1) {
    return { message: null, confirmed: false, calendarEventId: null };
  }

  const booking = bookings[idx];
  const slot    = booking.slotsOffered[slotIndex];
  if (!slot) {
    return { message: null, confirmed: false, calendarEventId: null };
  }

  const clinic     = getClinicRecord(clinicSlug);
  const clinicName = clinic?.clinicName || clinicSlug;
  const brain      = getClinicBrain(clinicSlug);
  const clinicPhone = brain?.contact?.phone || clinic?.clinicPhone || "";

  // Create calendar event
  const patient   = { name: booking.patientName || null, phone: patientPhone };
  const { eventId, calendarLinked } = await createBookingEvent(clinicSlug, slot, patient, booking.serviceType);

  // Update booking record
  bookings[idx].status          = "confirmed";
  bookings[idx].slotChosen      = slot;
  bookings[idx].calendarEventId = eventId;
  bookings[idx].confirmedAt     = new Date().toISOString();
  saveBookings(clinicSlug, bookings);

  // Confirmation message
  const firstName  = (booking.patientName || "").split(" ")[0] || "";
  const greet      = firstName ? `${firstName}! ` : "! ";
  const reminderNote = clinicPhone ? ` We'll send you a reminder the day before. Questions? Call ${clinicPhone}.` : " We'll send you a reminder the day before.";
  const calNote    = calendarLinked ? "" : " (Your appointment has been noted — our team will confirm shortly.)";
  const message    = `Perfect${greet}You're booked for ${slot.display} at ${clinicName}.${reminderNote}${calNote} See you then! — ${clinicName}`;

  // Log as patient_booked
  logEvent(clinicSlug, {
    type:        EVENT_TYPES.PATIENT_BOOKED,
    patientPhone,
    patientName: booking.patientName || null,
    direction:   "system",
    channel:     "sms",
    content:     `Booking confirmed: ${slot.display} | ${booking.serviceType}`,
    outcome:     "booked",
    revenueAttributed: 200,
    metadata:    { bookingId: booking.id, eventId, slot: slot.iso, serviceType: booking.serviceType, calendarLinked },
  });

  // Schedule outcome check for 24h after appointment
  scheduleOutcomeCheck(clinicSlug, {
    id:          booking.id,
    patientPhone,
    patientName: booking.patientName || null,
    serviceType: booking.serviceType,
    slotChosen:  slot,
    calendarEventId: eventId,
  });

  console.log(`[booking] ✓ Confirmed: ${patientPhone} | ${slot.display} | ${booking.serviceType} (${clinicSlug})`);
  return { message, confirmed: true, calendarEventId: eventId, slot };
}

// ─── Cancel booking ───────────────────────────────────────────────────────────

/**
 * Cancel the patient's upcoming confirmed booking.
 * Deletes the Google Calendar event and offers to rebook.
 *
 * @param {string} clinicSlug
 * @param {string} patientPhone
 * @returns {Promise<{ message, cancelled }>}
 */
export async function cancelBooking(clinicSlug, patientPhone) {
  const bookings = loadBookings(clinicSlug);
  const digits   = (patientPhone || "").replace(/\D/g, "");

  // Find most recent confirmed booking for this patient
  const idx = bookings
    .map((b, i) => ({ b, i }))
    .filter(({ b }) =>
      b.status === "confirmed" &&
      (b.patientPhone || "").replace(/\D/g, "") === digits &&
      b.slotChosen?.iso &&
      new Date(b.slotChosen.iso) > new Date()
    )
    .sort((a, b) => new Date(a.b.slotChosen?.iso) - new Date(b.b.slotChosen?.iso))[0]?.i ?? -1;

  if (idx === -1) {
    const clinic = getClinicRecord(clinicSlug);
    return {
      message: `I don't see an upcoming booking on file. If you need to cancel or reschedule, please call ${clinic?.clinicPhone || "us"} directly. — ${clinic?.clinicName || clinicSlug}`,
      cancelled: false,
    };
  }

  const booking  = bookings[idx];
  const clinic   = getClinicRecord(clinicSlug);
  const brain    = getClinicBrain(clinicSlug);
  const clinicName  = clinic?.clinicName || clinicSlug;
  const clinicPhone = brain?.contact?.phone || clinic?.clinicPhone || "";

  // Cancel the calendar event
  if (booking.calendarEventId) {
    await cancelBookingEvent(clinicSlug, booking.calendarEventId).catch(() => {});
  }

  bookings[idx].status      = "cancelled";
  bookings[idx].cancelledAt = new Date().toISOString();
  saveBookings(clinicSlug, bookings);

  const slotDisplay = booking.slotChosen?.display || "your appointment";
  const firstName   = (booking.patientName || "").split(" ")[0] || "";
  const greet       = firstName ? `${firstName}, ` : "";
  const message     = `No problem${greet ? ", " + greet : ""}your ${slotDisplay} has been cancelled. Whenever you're ready to rebook, just reply here${clinicPhone ? ` or call ${clinicPhone}` : ""}. — ${clinicName}`;

  logEvent(clinicSlug, {
    type:        "booking_cancelled",
    patientPhone,
    patientName: booking.patientName || null,
    direction:   "system",
    channel:     "sms",
    content:     `Booking cancelled: ${slotDisplay}`,
    outcome:     "cancelled",
    metadata:    { bookingId: booking.id, slot: booking.slotChosen?.iso },
  });

  console.log(`[booking] Cancelled: ${patientPhone} | ${slotDisplay} (${clinicSlug})`);
  return { message, cancelled: true };
}
