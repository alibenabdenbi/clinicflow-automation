// src/services/clinicBrain.js
// Structured knowledge base for each ClinicFlow client.
// Claude reads this before writing ANY patient-facing message.
// Intake form populates it; clinic owner can update it.

import fs from "fs";
import path from "path";

const CLIENTS_DIR = path.join(process.cwd(), "data", "clients");

// ─── Helpers ──────────────────────────────────────────────────────────────────

function brainPath(clinicSlug) {
  return path.join(CLIENTS_DIR, clinicSlug, "clinic-brain.json");
}

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

// Day of week helpers
const DAY_NAMES = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

function parseTime(t) {
  if (!t) return null;
  const [h, m] = t.split(":").map(Number);
  return { h: h || 0, m: m || 0 };
}

// ─── Brain loader ─────────────────────────────────────────────────────────────

/**
 * Load and return the full clinic brain for a given slug.
 * Returns null if no brain file exists.
 * @param {string} clinicSlug
 * @returns {object|null}
 */
export function getClinicBrain(clinicSlug) {
  return readJsonSafe(brainPath(clinicSlug), null);
}

// ─── Hours logic ──────────────────────────────────────────────────────────────

/**
 * Returns true if the current local time is within the clinic's business hours.
 * Considers holidays from the brain.
 * @param {string} clinicSlug
 * @returns {boolean}
 */
export function isWithinHours(clinicSlug) {
  const brain = getClinicBrain(clinicSlug);
  if (!brain?.hours) return true; // no data → assume open

  const now     = new Date();
  const today   = DAY_NAMES[now.getDay()]; // getDay() returns 0=Sunday
  const dayConf = brain.hours[today];

  if (!dayConf || dayConf.closed) return false;

  // Check holidays
  const todayKey = now.toISOString().slice(0, 10);
  if (brain.holidays?.some((h) => h.date === todayKey)) return false;

  const open  = parseTime(dayConf.open);
  const close = parseTime(dayConf.close);
  if (!open || !close) return true;

  const nowMin   = now.getHours() * 60 + now.getMinutes();
  const openMin  = open.h  * 60 + open.m;
  const closeMin = close.h * 60 + close.m;

  return nowMin >= openMin && nowMin < closeMin;
}

/**
 * Returns a human-readable string for the next time the clinic opens.
 * e.g. "today at 9am", "tomorrow at 9am", "Monday at 9am"
 * @param {string} clinicSlug
 * @returns {string}
 */
export function getNextOpenTime(clinicSlug) {
  const brain = getClinicBrain(clinicSlug);
  if (!brain?.hours) return "during business hours";

  const now = new Date();

  for (let offset = 0; offset <= 7; offset++) {
    const check   = new Date(now);
    check.setDate(now.getDate() + offset);
    const dayName = DAY_NAMES[check.getDay()];
    const dayConf = brain.hours[dayName];

    if (!dayConf || dayConf.closed) continue;

    // Check holiday
    const dateKey = check.toISOString().slice(0, 10);
    if (brain.holidays?.some((h) => h.date === dateKey)) continue;

    const open = parseTime(dayConf.open);
    if (!open) continue;

    // If same day, make sure open time hasn't passed
    if (offset === 0) {
      const nowMin  = now.getHours() * 60 + now.getMinutes();
      const openMin = open.h * 60 + open.m;
      if (nowMin >= openMin) continue; // already past opening
    }

    const timeStr = open.h <= 12
      ? `${open.h === 0 ? 12 : open.h}:${String(open.m).padStart(2, "0")}${open.h < 12 ? "am" : "pm"}`
      : `${open.h - 12}:${String(open.m).padStart(2, "0")}pm`;

    if (offset === 0)   return `today at ${timeStr}`;
    if (offset === 1)   return `tomorrow at ${timeStr}`;
    const dayDisplay = dayName.charAt(0).toUpperCase() + dayName.slice(1);
    return `${dayDisplay} at ${timeStr}`;
  }

  return "soon — please call us for our current hours";
}

/**
 * Return the next N available appointment slots formatted for SMS.
 * @param {string} clinicSlug
 * @param {number} count
 * @returns {string} formatted slot list or fallback message
 */
export function findAvailableSlots(clinicSlug, count = 3) {
  const brain = getClinicBrain(clinicSlug);
  const slots  = brain?.availableSlots;

  if (!slots?.length) {
    const phone = brain?.contact?.phone || "";
    return phone
      ? `Please call us at ${phone} or reply here and we'll find you a time.`
      : `Reply here with your preferred day and time and we'll get you booked.`;
  }

  const now   = Date.now();
  const future = slots
    .filter((s) => new Date(s.date + " " + (s.time || "00:00")).getTime() > now)
    .slice(0, count);

  if (!future.length) return `Reply here with your preferred day and time.`;

  return future
    .map((s) => {
      const d = new Date(s.date + "T" + (s.time || "09:00") + ":00");
      const day  = d.toLocaleDateString("en-CA", { weekday: "long", month: "short", day: "numeric" });
      const time = d.toLocaleTimeString("en-CA", { hour: "numeric", minute: "2-digit", hour12: true });
      return `${day} at ${time}`;
    })
    .join(", ");
}

// ─── Brain writer ─────────────────────────────────────────────────────────────

/**
 * Merge updates into the clinic brain and persist.
 * @param {string} clinicSlug
 * @param {object} updates
 * @returns {object} The updated brain
 */
export function updateBrain(clinicSlug, updates) {
  const existing = getClinicBrain(clinicSlug) || {};
  const updated  = deepMerge(existing, updates);
  updated.lastUpdated = new Date().toISOString();
  writeJsonSafe(brainPath(clinicSlug), updated);
  return updated;
}

function deepMerge(target, source) {
  const out = { ...target };
  for (const [k, v] of Object.entries(source)) {
    if (v && typeof v === "object" && !Array.isArray(v) && typeof out[k] === "object" && !Array.isArray(out[k])) {
      out[k] = deepMerge(out[k] || {}, v);
    } else {
      out[k] = v;
    }
  }
  return out;
}

// ─── System prompt builder ────────────────────────────────────────────────────

/**
 * Build the complete Claude system prompt that encapsulates clinic knowledge.
 * This is what Claude reads before every patient SMS interaction.
 *
 * @param {string} clinicSlug
 * @returns {string} Full system prompt
 */
export function buildSystemPrompt(clinicSlug) {
  const brain = getClinicBrain(clinicSlug);
  if (!brain) {
    return `You are a patient communication assistant for a dental clinic.
Be warm, helpful, and professional. Keep responses under 160 characters when possible.
If you don't know the answer, say you'll have someone from the team follow up shortly.`;
  }

  const name    = brain.clinicName || "the clinic";
  const phone   = brain.contact?.phone || "";
  const website = brain.contact?.website || "";
  const type    = brain.type || "dental";
  const tone    = brain.tone?.style || "warm and professional";

  // Hours summary
  let hoursSummary = "";
  if (brain.hours) {
    const days = Object.entries(brain.hours)
      .map(([day, conf]) => {
        if (conf.closed) return `${day}: closed`;
        return `${day}: ${conf.open || "?"} – ${conf.close || "?"}`;
      })
      .join(", ");
    hoursSummary = `HOURS: ${days}`;
  }

  // Services summary
  let servicesSummary = "";
  if (brain.services?.length) {
    servicesSummary = `SERVICES:\n` + brain.services
      .map((s) => `- ${s.name}${s.duration ? ` (${s.duration} min)` : ""}${s.price != null ? `, $${s.price}` : ""}${s.description ? ` — ${s.description}` : ""}`)
      .join("\n");
  }

  // Insurance
  let insuranceSummary = "";
  if (brain.insurance) {
    const ins = brain.insurance;
    if (ins.accepted) {
      insuranceSummary = `INSURANCE: We accept ${(ins.providers || []).join(", ")}. Direct billing: ${ins.directBilling ? "yes" : "no"}. ${ins.notes || ""}`;
    } else {
      insuranceSummary = "INSURANCE: We do not accept insurance — payment at time of service.";
    }
  }

  // Team summary
  let teamSummary = "";
  if (brain.team?.length) {
    teamSummary = `TEAM:\n` + brain.team
      .map((m) => `- ${m.name}, ${m.role}${m.specialties?.length ? ` (specialties: ${m.specialties.join(", ")})` : ""}${m.bio ? ` — ${m.bio}` : ""}`)
      .join("\n");
  }

  // FAQs
  let faqSummary = "";
  if (brain.faqs?.length) {
    faqSummary = `FREQUENTLY ASKED QUESTIONS:\n` + brain.faqs
      .map((f) => `Q: ${f.question}\nA: ${f.answer}`)
      .join("\n\n");
  }

  const avoidWords = brain.tone?.avoidWords?.length
    ? `\nAvoid using these words: ${brain.tone.avoidWords.join(", ")}.`
    : "";

  const currentlyOpen = isWithinHours(clinicSlug);
  const nextOpen = currentlyOpen ? "" : `\nThe clinic is currently CLOSED. Next open: ${getNextOpenTime(clinicSlug)}. Do not promise to call back today if the clinic is closed.`;

  return `You are the patient communication assistant for ${name}, a ${type} clinic.
You respond to patients on behalf of the clinic via SMS.
Your tone should be ${tone}.${avoidWords}

CLINIC CONTACT:
${phone ? `Phone: ${phone}` : ""}
${website ? `Website: ${website}` : ""}
${brain.contact?.address ? `Address: ${brain.contact.address}` : ""}
${brain.parking ? `Parking: ${brain.parking}` : ""}
${brain.accessibility ? `Accessibility: ${brain.accessibility}` : ""}
${brain.languages?.length ? `Languages spoken: ${brain.languages.join(", ")}` : ""}

${hoursSummary}
${nextOpen}

${servicesSummary}

${insuranceSummary}

${teamSummary}

${faqSummary}

BOOKING INSTRUCTIONS:
${brain.bookingInstructions || `Reply here with your preferred day and time, or call ${phone}.`}

${brain.emergencyProtocol ? `EMERGENCY PROTOCOL:\n${brain.emergencyProtocol}` : ""}

${brain.customInstructions ? `ADDITIONAL INSTRUCTIONS:\n${brain.customInstructions}` : ""}

RULES YOU MUST FOLLOW:
- Always use the patient's first name when you know it.
- Never make up information — only use what is in this clinic knowledge base.
- If you don't know the answer, say "I'll have someone from our team follow up with you shortly."
- Never promise a specific appointment time unless you have confirmed availability.
- If a patient seems distressed or mentions pain, respond with urgency and empathy.
- Keep responses under 160 characters when possible (one SMS). For complex answers, use 2-3 short sentences max.
- Never mention that you are an AI unless directly asked.
- If directly asked if you are an AI, say: "I'm the automated assistant for ${name} — a real team member will follow up if you need more help."
- Always end with a clear next step.
- Never promote or mention competitors.
- ${brain.tone?.signatureName ? `Sign off as: ${brain.tone.signatureName.replace("[Clinic Name]", name)}` : `Sign off as: The ${name} team`}`.trim();
}
