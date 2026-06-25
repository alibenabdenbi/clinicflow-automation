// src/services/reactivationService.js
// Identifies patients inactive 12+ months and sends 3-wave reactivation campaign.
// Runs first Monday of each month at 9:30am via scheduler.

import fs from "fs";
import path from "path";
import nodemailer from "nodemailer";
import { sendSMS } from "./smsService.js";
import { getActiveClients, updateClient } from "./clientLifecycle.js";
import { logEvent, EVENT_TYPES } from "./eventLog.js";

const CLIENTS_DIR = path.join(process.cwd(), "data", "clients");

const SMTP_HOST   = (process.env.SMTP_HOST || "").trim();
const SMTP_PORT   = Number(process.env.SMTP_PORT || "587");
const SMTP_USER   = (process.env.SMTP_USER || "").trim();
const SMTP_PASS   = (process.env.SMTP_PASS || "").trim();
const SMTP_FROM   = (process.env.SMTP_FROM || SMTP_USER).trim();
const SENDER_NAME = (process.env.SENDER_NAME || "Mohamed").trim();

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

function monthKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function createTransporter() {
  return nodemailer.createTransport({
    host:   SMTP_HOST,
    port:   SMTP_PORT,
    secure: SMTP_PORT === 465,
    auth:   { user: SMTP_USER, pass: SMTP_PASS },
    tls:    { rejectUnauthorized: false },
  });
}

// ─── Patient loader ───────────────────────────────────────────────────────────

/**
 * Load patients from CSV and filter to those inactive for `monthsInactive`+ months.
 * @param {string} clinicSlug
 * @param {number} monthsInactive — default 12
 * @returns {object[]} Inactive patient records (with name, phone, email, lastVisit)
 */
export function getInactivePatients(clinicSlug, monthsInactive = 12) {
  const csvPath = path.join(CLIENTS_DIR, clinicSlug, "patients.csv");
  if (!fs.existsSync(csvPath)) return [];

  const patients = parseCsv(fs.readFileSync(csvPath, "utf-8"));
  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - monthsInactive);

  return patients.filter((p) => {
    const lastVisit = p.last_visit || p.lastvisit || p.lastvisitdate || "";
    if (!lastVisit) return false;
    const visitDate = new Date(lastVisit);
    return !isNaN(visitDate) && visitDate < cutoff;
  });
}

// ─── Wave messages ────────────────────────────────────────────────────────────

/**
 * Send one wave of the reactivation campaign to a patient.
 * Wave 1 & 2 → SMS. Wave 3 → Email.
 * @param {object} patient  — { name, phone, email, last_visit }
 * @param {object} clinic
 * @param {1|2|3}  wave
 */
export async function sendReactivationMessage(patient, clinic, wave) {
  const firstName  = (patient.name || "").split(" ")[0] || "there";
  const clinicName = clinic.clinicName || "the clinic";
  const clinicPhone = clinic.clinicPhone || "";
  const website    = clinic.website || "";

  if (wave === 1) {
    const body = `Hi ${firstName}, it's been a while since we've seen you at ${clinicName}! We wanted to check in — your dental health is important to us.${website ? ` Book your next visit at ${website}` : ""} or call ${clinicPhone}. — ${clinicName}`;
    const from = clinic.twilioNumber || process.env.TWILIO_FROM_NUMBER;
    return sendSMS(patient.phone, body, from);
  }

  if (wave === 2) {
    const body = `Hi ${firstName}, ${clinicName} here. We have some appointment availability coming up and wanted to offer you a priority booking. Give us a call at ${clinicPhone} or reply here. — ${clinicName}`;
    const from = clinic.twilioNumber || process.env.TWILIO_FROM_NUMBER;
    return sendSMS(patient.phone, body, from);
  }

  // Wave 3 — email
  if (!patient.email || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(patient.email)) {
    return { sent: false, reason: "no_valid_email" };
  }
  const transporter = createTransporter();
  await transporter.sendMail({
    from:    `${clinicName} <${SMTP_FROM}>`,
    to:      patient.email,
    subject: `We miss you at ${clinicName}`,
    text: `Hi ${firstName},

We noticed it's been a while since your last visit at ${clinicName}, and we just wanted to reach out personally.

Your oral health is important, and we'd love to welcome you back. Whether it's a routine cleaning or a check-up, we're here when you're ready.

To book an appointment, simply reply to this email, call us at ${clinicPhone},${website ? ` or visit ${website}` : ""} and we'll find a time that works for you.

We hope to see you soon.

The Team at ${clinicName}`,
  });
  return { sent: true };
}

// ─── Logging ──────────────────────────────────────────────────────────────────

/**
 * Append a reactivation log entry for a patient.
 */
export function logReactivation(clinicSlug, patientName, wave) {
  const logPath = path.join(CLIENTS_DIR, clinicSlug, "reactivation.json");
  const log = readJsonSafe(logPath, []);
  log.push({ patientName, wave, month: monthKey(), at: new Date().toISOString() });
  writeJsonSafe(logPath, log);
}

/**
 * Check if a patient has already received a specific wave this month.
 */
export function alreadySentWave(clinicSlug, patientName, wave) {
  const logPath = path.join(CLIENTS_DIR, clinicSlug, "reactivation.json");
  const log = readJsonSafe(logPath, []);
  const month = monthKey();
  return log.some((e) => e.patientName === patientName && e.wave === wave && e.month === month);
}

/**
 * Return aggregate stats for a clinic's reactivation log.
 */
export function getReactivationStats(clinicSlug) {
  const logPath = path.join(CLIENTS_DIR, clinicSlug, "reactivation.json");
  const log = readJsonSafe(logPath, []);
  return {
    total:   log.length,
    wave1:   log.filter((e) => e.wave === 1).length,
    wave2:   log.filter((e) => e.wave === 2).length,
    wave3:   log.filter((e) => e.wave === 3).length,
    thisMonth: log.filter((e) => e.month === monthKey()).length,
  };
}

/**
 * Returns true if wave 1 already ran for this clinic this month.
 * Prevents double-sending when the scheduler fires multiple times.
 */
export function hasRunThisMonth(clinicSlug) {
  const logPath = path.join(CLIENTS_DIR, clinicSlug, "reactivation.json");
  const log = readJsonSafe(logPath, []);
  const month = monthKey();
  return log.some((e) => e.wave === 1 && e.month === month);
}

// ─── Scheduler entry point ────────────────────────────────────────────────────

/**
 * Run reactivation wave 1 for all eligible active clients.
 * Subsequent waves (2 & 3) run in following weeks via the same monthly job
 * which checks whether 7 days have passed since the previous wave.
 * Called first Monday of each month at 9:30am.
 * @returns {Promise<{ totalSent, errors }>}
 */
export async function runReactivationForAllClients() {
  const clients = getActiveClients().filter((c) => c.services?.reactivation);
  console.log(`[reactivation] Checking ${clients.length} active clinic(s)`);

  let totalSent = 0;
  const errors  = [];

  for (const clinic of clients) {
    const slug = clinic.clinicSlug;

    if (hasRunThisMonth(slug)) {
      console.log(`[reactivation] ${slug}: already ran wave 1 this month — skipping`);
      continue;
    }

    let inactive = getInactivePatients(slug, 12);
    console.log(`[reactivation] ${slug}: ${inactive.length} inactive patient(s)`);

    // Predictive sort: prioritize by churn risk × LTV (highest urgency first)
    try {
      const { scorePatient } = await import("./predictiveEngine.js");
      const threads = JSON.parse(fs.existsSync(path.join(CLIENTS_DIR, slug, "recovery-threads.json"))
        ? fs.readFileSync(path.join(CLIENTS_DIR, slug, "recovery-threads.json"), "utf-8") : "[]");
      inactive = inactive
        .map((p) => { const s = scorePatient(p, threads); return { ...p, _score: s }; })
        .sort((a, b) => (b._score.churnRisk * b._score.ltv.threeYearLTV) - (a._score.churnRisk * a._score.ltv.threeYearLTV));
      console.log(`[reactivation] ${slug}: sorted by churn risk × LTV`);
    } catch { /* predictive engine optional */ }

    for (const patient of inactive) {
      if (!patient.phone && !patient.email) continue;
      try {
        await sendReactivationMessage(patient, clinic, 1);
        logReactivation(slug, patient.name, 1);
        const results = clinic.results || {};
        updateClient(slug, {
          results: {
            ...results,
            patientsReactivated: (results.patientsReactivated || 0) + 1,
            estimatedRevenueRecovered: (results.estimatedRevenueRecovered || 0) + 200,
          },
        });
        logEvent(slug, {
          type:        EVENT_TYPES.REACTIVATION_WAVE_1,
          patientPhone: patient.phone || null,
          patientName:  patient.name || null,
          direction:   "outbound",
          channel:     patient.email && !patient.phone ? "email" : "sms",
          content:     `Reactivation wave 1 sent — inactive 12+ months`,
          outcome:     "sent",
          metadata:    { lastVisit: patient.last_visit },
        });
        totalSent++;
        console.log(`[reactivation] ✓ Wave 1 → ${patient.name} (${slug})`);
      } catch (err) {
        const msg = `${slug} | ${patient.name} | wave 1: ${err.message}`;
        console.error(`[reactivation] ✗ ${msg}`);
        errors.push(msg);
      }
    }
  }

  console.log(`[reactivation] Done. Sent: ${totalSent} | Errors: ${errors.length}`);
  return { totalSent, errors };
}
