// src/services/calendarService.js
// Google Calendar appointment reminder + slot booking service.
// Uses a service account to:
//   - Read clinic calendars for reminder sending (existing)
//   - Find available appointment slots (NEW)
//   - Create/cancel booking events (NEW)
//
// Setup: see docs/google-calendar-setup.md
// Credentials: data/google-credentials.json (service account key file)
// Write access: share clinic calendar with service account email and grant "Make changes to events"

import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";
import { google } from "googleapis";
import twilio from "twilio";
import dotenv from "dotenv";

dotenv.config();

const CREDS_PATH     = path.join(process.cwd(), "data", "google-credentials.json");
const CLIENTS_DIR    = path.join(process.cwd(), "data", "clients");
const CLIENTS_PATH   = path.join(process.cwd(), "data", "clients.json");

const TWILIO_SID     = process.env.TWILIO_ACCOUNT_SID || "";
const TWILIO_TOKEN   = process.env.TWILIO_AUTH_TOKEN  || "";
const TWILIO_FROM    = process.env.TWILIO_PHONE_NUMBER || "";

const CALENDAR_SCOPES_READ  = ["https://www.googleapis.com/auth/calendar.readonly"];
const CALENDAR_SCOPES_WRITE = [
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/calendar.readonly",
];

// ─── Auth ─────────────────────────────────────────────────────────────────────

function getAuth(write = false) {
  if (!fs.existsSync(CREDS_PATH)) {
    throw new Error(`Google credentials not found at ${CREDS_PATH}. See docs/google-calendar-setup.md`);
  }
  const creds  = JSON.parse(fs.readFileSync(CREDS_PATH, "utf-8"));
  const scopes = write ? CALENDAR_SCOPES_WRITE : CALENDAR_SCOPES_READ;
  return new google.auth.GoogleAuth({ credentials: creds, scopes });
}

function hasGoogleCredentials() {
  return fs.existsSync(CREDS_PATH);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function readJsonSafe(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, "utf-8"));
  } catch { return fallback; }
}

function writeJsonSafe(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
}

function safeClinicDir(name) {
  return (name || "unknown")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 50);
}

function hoursUntil(dateStr) {
  return (new Date(dateStr).getTime() - Date.now()) / (1000 * 60 * 60);
}

function formatDateTime(dateStr) {
  const d = new Date(dateStr);
  const date = d.toLocaleDateString("en-CA", { weekday: "long", month: "long", day: "numeric" });
  const time = d.toLocaleTimeString("en-CA", { hour: "numeric", minute: "2-digit", hour12: true });
  return { date, time };
}

// Parse patient first name and phone from calendar event.
// Clinic events are expected to follow the pattern:
//   Summary: "John Smith - Cleaning" or "Jane Doe"
//   Description: may contain phone number like "Phone: 514-555-1234" or "(514) 555-1234"
function parseEventDetails(event) {
  const summary     = event.summary || "";
  const description = event.description || "";
  const combined    = `${summary}\n${description}`;

  // First name: take first word of summary before any dash or comma
  const namePart = summary.split(/[-,]/)[0].trim();
  const firstName = namePart.split(/\s+/)[0] || "there";

  // Phone: look for phone patterns in description or attendees
  const phoneMatch = combined.match(/(?:phone|tel|cell|mobile|ph)[\s:]*([(\d)(\+\d)\d\s\-\.]{7,15})/i)
    || combined.match(/\b(\+?1?[\s\-.]?\(?\d{3}\)?[\s\-.]?\d{3}[\s\-.]?\d{4})\b/);
  const phone = phoneMatch ? phoneMatch[1].replace(/[^\d+]/g, "").replace(/^1(\d{10})$/, "+1$1") : null;

  // Try attendees for email/name
  const attendee = (event.attendees || []).find(a => !a.organizer && !a.self);
  const attendeeEmail = attendee?.email || null;

  return { firstName, phone, attendeeEmail };
}

// ─── Reminder log ─────────────────────────────────────────────────────────────

function loadReminderLog(clinicDir) {
  return readJsonSafe(path.join(clinicDir, "reminders-sent.json"), []);
}

function hasReminderBeenSent(log, eventId, type) {
  return log.some(e => e.eventId === eventId && e.type === type);
}

function logReminder(clinicDir, entry) {
  const logPath = path.join(clinicDir, "reminders-sent.json");
  const log = loadReminderLog(clinicDir);
  log.push({ ...entry, sentAt: new Date().toISOString() });
  writeJsonSafe(logPath, log);
}

// ─── SMS sender ───────────────────────────────────────────────────────────────

async function sendSmsReminder(to, body) {
  if (!TWILIO_SID || !TWILIO_TOKEN || !TWILIO_FROM) {
    throw new Error("Twilio credentials not configured (TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_PHONE_NUMBER)");
  }
  // Normalize phone to E.164
  let phone = to.replace(/[^\d+]/g, "");
  if (!phone.startsWith("+")) {
    phone = phone.length === 10 ? `+1${phone}` : `+${phone}`;
  }
  const client = twilio(TWILIO_SID, TWILIO_TOKEN);
  return client.messages.create({ from: TWILIO_FROM, to: phone, body });
}

// ─── Main service ─────────────────────────────────────────────────────────────

/**
 * Checks a single clinic calendar for upcoming appointments and sends SMS reminders.
 * @param {{ clinicName: string, calendarId: string, clinicPhone?: string }} opts
 * @returns {{ sent: number, skipped: number, errors: string[] }}
 */
export async function runRemindersForClinic({ clinicName, calendarId, clinicPhone = "" }) {
  const dirName   = safeClinicDir(clinicName);
  const clinicDir = path.join(CLIENTS_DIR, dirName);
  fs.mkdirSync(clinicDir, { recursive: true });

  const auth     = getAuth();
  const calendar = google.calendar({ version: "v3", auth });

  const now     = new Date();
  const in7Days = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

  const { data } = await calendar.events.list({
    calendarId,
    timeMin: now.toISOString(),
    timeMax: in7Days.toISOString(),
    singleEvents: true,
    orderBy: "startTime",
    maxResults: 100,
  });

  const events = data.items || [];
  const log    = loadReminderLog(clinicDir);

  let sent = 0, skipped = 0;
  const errors = [];

  for (const event of events) {
    const startStr = event.start?.dateTime || event.start?.date;
    if (!startStr) continue;

    const hours = hoursUntil(startStr);
    if (hours < 0) continue; // past

    const { firstName, phone } = parseEventDetails(event);
    if (!phone) { skipped++; continue; } // no phone to text

    const { date, time } = formatDateTime(startStr);
    const eventId = event.id;

    // 72h reminder — send when appointment is 48–80h away
    if (hours >= 48 && hours <= 80 && !hasReminderBeenSent(log, eventId, "72h")) {
      const body = `Hi ${firstName}, reminder: appointment at ${clinicName} on ${date} at ${time}.${clinicPhone ? ` Reply YES to confirm or call ${clinicPhone} to reschedule.` : " Reply YES to confirm."}`;
      try {
        await sendSmsReminder(phone, body);
        logReminder(clinicDir, { eventId, type: "72h", phone, clinicName });
        console.log(`  ✓ 72h reminder → ${firstName} (${phone})`);
        sent++;
      } catch (e) {
        errors.push(`72h reminder failed for event ${eventId}: ${e.message}`);
      }
    }

    // 24h reminder — send when appointment is 12–28h away
    if (hours >= 12 && hours <= 28 && !hasReminderBeenSent(log, eventId, "24h")) {
      const body = `Hi ${firstName}, see you tomorrow at ${time} at ${clinicName}.${clinicPhone ? ` Questions? Call ${clinicPhone}.` : ""}`;
      try {
        await sendSmsReminder(phone, body);
        logReminder(clinicDir, { eventId, type: "24h", phone, clinicName });
        console.log(`  ✓ 24h reminder → ${firstName} (${phone})`);
        sent++;
      } catch (e) {
        errors.push(`24h reminder failed for event ${eventId}: ${e.message}`);
      }
    }
  }

  return { sent, skipped, errors, eventsChecked: events.length };
}

// ─── Slot availability ────────────────────────────────────────────────────────

const DAY_NAMES_LOWER = ["sunday","monday","tuesday","wednesday","thursday","friday","saturday"];

function parseTimeStr(t) {
  if (!t) return null;
  const [h, m] = t.split(":").map(Number);
  return { h: h || 0, m: m || 0 };
}

/**
 * Fetch the next N available appointment slots for a clinic.
 * Reads Google Calendar if configured; falls back to clinic-hours-based tentative slots.
 *
 * @param {string} clinicSlug
 * @param {string} serviceType  — matched against brain.services[].name
 * @param {number} count        — number of slots to return (default 3)
 * @returns {Promise<Array<{ display, iso, duration, tentative }>>}
 */
export async function getAvailableSlots(clinicSlug, serviceType = "appointment", count = 3) {
  // Load clinic brain for hours and service duration
  const brainPath = path.join(process.cwd(), "data", "clients", clinicSlug, "clinic-brain.json");
  const brain     = readJsonSafe(brainPath, null);

  // Resolve service duration from brain
  let duration = 60; // default 60 min
  if (brain?.services?.length) {
    const svcMatch = brain.services.find(
      (s) => s.name?.toLowerCase().includes(serviceType.toLowerCase()) ||
             serviceType.toLowerCase().includes(s.name?.toLowerCase())
    );
    if (svcMatch?.duration) duration = svcMatch.duration;
  }

  // Try Google Calendar path
  const clientRecord = readJsonSafe(path.join(process.cwd(), "data", "clients.json"), [])
    .find((c) => c.clinicSlug === clinicSlug);
  const calendarId = clientRecord?.calendarId;

  let existingEvents = [];
  if (calendarId && hasGoogleCredentials()) {
    try {
      const auth     = getAuth(false);
      const calendar = google.calendar({ version: "v3", auth });
      const now      = new Date();
      const in14Days = new Date(now.getTime() + 14 * 86_400_000);
      const { data } = await calendar.events.list({
        calendarId,
        timeMin:      now.toISOString(),
        timeMax:      in14Days.toISOString(),
        singleEvents: true,
        orderBy:      "startTime",
        maxResults:   200,
      });
      existingEvents = (data.items || []).map((e) => ({
        start: new Date(e.start?.dateTime || e.start?.date),
        end:   new Date(e.end?.dateTime   || e.end?.date),
      }));
    } catch (err) {
      console.warn(`[calendarService] Could not fetch calendar events: ${err.message}`);
    }
  }

  // Generate candidate slots from clinic hours
  const slots = [];
  const now   = new Date();
  // Minimum 24h notice
  const earliest = new Date(now.getTime() + 24 * 3600_000);

  // Scan up to 21 days ahead to find `count` open slots
  for (let dayOffset = 1; dayOffset <= 21 && slots.length < count; dayOffset++) {
    const day = new Date(now);
    day.setDate(now.getDate() + dayOffset);
    day.setHours(0, 0, 0, 0);

    const dayName  = DAY_NAMES_LOWER[day.getDay()];
    const dayConf  = brain?.hours?.[dayName];
    if (!dayConf || dayConf.closed) continue;

    const openTime  = parseTimeStr(dayConf.open  || "09:00");
    const closeTime = parseTimeStr(dayConf.close || "17:00");

    if (!openTime || !closeTime) continue;

    // Generate candidate start times at 30-min intervals within business hours
    const openMin  = openTime.h  * 60 + openTime.m;
    const closeMin = closeTime.h * 60 + closeTime.m;

    for (let startMin = openMin; startMin + duration <= closeMin && slots.length < count; startMin += 30) {
      const slotStart = new Date(day);
      slotStart.setHours(Math.floor(startMin / 60), startMin % 60, 0, 0);

      if (slotStart < earliest) continue;

      const slotEnd = new Date(slotStart.getTime() + duration * 60_000);

      // Check for conflict with existing calendar events
      const conflict = existingEvents.some(
        (e) => slotStart < e.end && slotEnd > e.start
      );
      if (conflict) continue;

      // Skip lunch (12:00–13:00)
      if (startMin >= 720 && startMin < 780) continue;

      const dayStr  = slotStart.toLocaleDateString("en-CA", { weekday: "long", month: "long", day: "numeric" });
      const timeStr = slotStart.toLocaleTimeString("en-CA", { hour: "numeric", minute: "2-digit", hour12: true });

      slots.push({
        display:   `${dayStr} at ${timeStr}`,
        iso:       slotStart.toISOString(),
        duration,
        tentative: !calendarId || !hasGoogleCredentials(),
      });
    }
  }

  return slots;
}

/**
 * Format slots array for SMS — must stay readable and brief.
 * @param {Array} slots
 * @returns {string}
 */
export function formatSlotsForSMS(slots) {
  if (!slots.length) return "No slots available right now. Please call us to book.";
  const lines = ["Reply 1, 2, or 3:"];
  slots.slice(0, 3).forEach((s, i) => {
    // Shorten: "Tuesday May 13 at 2:00pm" → "Tue May 13 at 2pm"
    const short = s.display
      .replace(/day /, " ")         // Wednesday → Wednes (prefix)
      .replace(/(\w{3})\w* /, "$1 ") // Full day name to 3 chars
      .replace(/:00([ap]m)/, "$1");   // 2:00pm → 2pm
    lines.push(`${i + 1}) ${short}`);
  });
  return lines.join("\n");
}

// ─── Booking creation ─────────────────────────────────────────────────────────

/**
 * Create a Google Calendar event for a confirmed booking.
 * Falls back to a local pending record if Google Calendar is not configured.
 *
 * @param {string} clinicSlug
 * @param {{ iso, duration, display }} slot
 * @param {{ name, phone, email? }} patient
 * @param {string} serviceType
 * @returns {Promise<{ eventId, calendarLinked }>}
 */
export async function createBookingEvent(clinicSlug, slot, patient, serviceType) {
  const brainPath    = path.join(process.cwd(), "data", "clients", clinicSlug, "clinic-brain.json");
  const brain        = readJsonSafe(brainPath, {});
  const clientRecord = readJsonSafe(path.join(process.cwd(), "data", "clients.json"), [])
    .find((c) => c.clinicSlug === clinicSlug);
  const calendarId   = clientRecord?.calendarId;
  const clinicEmail  = brain?.contact?.email || clientRecord?.contactEmail || "";

  const startTime = new Date(slot.iso);
  const endTime   = new Date(startTime.getTime() + (slot.duration || 60) * 60_000);

  // Always create a local record first (source of truth regardless of Calendar)
  const localEventId = `booking_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  if (calendarId && hasGoogleCredentials()) {
    try {
      const auth     = getAuth(true); // write scope
      const calendar = google.calendar({ version: "v3", auth });

      const event = {
        summary:     `${serviceType} — ${patient.name || "Patient"} (${patient.phone || ""})`,
        description: `Booked via ClinicFlow automated system\nPatient: ${patient.name || "Unknown"}\nPhone: ${patient.phone || "Unknown"}\nService: ${serviceType}`,
        start: { dateTime: startTime.toISOString() },
        end:   { dateTime: endTime.toISOString()   },
        attendees: clinicEmail ? [{ email: clinicEmail }] : [],
        reminders: { useDefault: false, overrides: [{ method: "email", minutes: 60 }] },
      };

      const { data } = await calendar.events.insert({ calendarId, resource: event, sendUpdates: "all" });
      console.log(`[calendarService] ✓ Calendar event created: ${data.id}`);
      return { eventId: data.id, calendarLinked: true };
    } catch (err) {
      console.error(`[calendarService] Calendar event creation failed: ${err.message}`);
      // Fall through to local-only
    }
  }

  // Local-only booking (no Google Calendar configured)
  console.log(`[calendarService] Booking saved locally (no Google Calendar): ${localEventId}`);
  return { eventId: localEventId, calendarLinked: false };
}

/**
 * Cancel a Google Calendar booking event.
 * @param {string} clinicSlug
 * @param {string} eventId
 * @returns {Promise<boolean>} true if cancelled, false if not found or local-only
 */
export async function cancelBookingEvent(clinicSlug, eventId) {
  if (!eventId || eventId.startsWith("booking_")) {
    // Local-only booking — just return true (the bookingService handles state)
    return true;
  }

  const clientRecord = readJsonSafe(path.join(process.cwd(), "data", "clients.json"), [])
    .find((c) => c.clinicSlug === clinicSlug);
  const calendarId = clientRecord?.calendarId;

  if (!calendarId || !hasGoogleCredentials()) return false;

  try {
    const auth     = getAuth(true);
    const calendar = google.calendar({ version: "v3", auth });
    await calendar.events.delete({ calendarId, eventId, sendUpdates: "all" });
    console.log(`[calendarService] ✓ Event cancelled: ${eventId}`);
    return true;
  } catch (err) {
    console.error(`[calendarService] Cancel failed for ${eventId}: ${err.message}`);
    return false;
  }
}
