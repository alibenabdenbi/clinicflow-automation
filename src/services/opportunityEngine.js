// src/services/opportunityEngine.js
// Proactive revenue opportunity hunter.
// Runs daily at 06:00 for every active client — goes looking for opportunities,
// does not wait to be triggered.
//
// 8 opportunity types in value order:
//   1. Birthday outreach (if birth_date in CSV)
//   2. Natural 5-6 month rebooking window
//   3. Cancelled but never rebooked
//   4. Long-lead appointment no-show risk (flag only)
//   5. Approaching 12 months inactive — act NOW
//   6. Exhausted recovery thread with high LTV — final attempt
//   7. Referral request after positive interaction (48h timing)
//   8. Seasonal campaign

import fs from "fs";
import path from "path";
import { sendSMS } from "./smsService.js";
import { getClient, getActiveClients } from "./clientLifecycle.js";
import { logEvent, getPatientHistory, EVENT_TYPES } from "./eventLog.js";

const CLIENTS_DIR = path.join(process.cwd(), "data", "clients");

// ─── CSV / file helpers ───────────────────────────────────────────────────────

function readJsonSafe(p, fb) {
  try {
    if (!fs.existsSync(p)) return fb;
    return JSON.parse(fs.readFileSync(p, "utf-8"));
  } catch { return fb; }
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

function loadPatients(clinicSlug) {
  const csvPath = path.join(CLIENTS_DIR, clinicSlug, "patients.csv");
  if (!fs.existsSync(csvPath)) return [];
  return parseCsv(fs.readFileSync(csvPath, "utf-8"));
}

function monthsAgo(isoDate, months) {
  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - months);
  return new Date(isoDate || 0) < cutoff;
}

function daysSince(isoDate) {
  if (!isoDate) return Infinity;
  return (Date.now() - new Date(isoDate).getTime()) / 86_400_000;
}

function daysUntil(isoDate) {
  if (!isoDate) return Infinity;
  return (new Date(isoDate).getTime() - Date.now()) / 86_400_000;
}

// ─── Dedup: was this patient contacted in the last N days? ────────────────────

function wasRecentlyContacted(clinicSlug, patientPhone, days = 14) {
  const history = getPatientHistory(clinicSlug, patientPhone);
  if (!history.length) return false;
  const cutoff = Date.now() - days * 86_400_000;
  return history.some(
    (e) =>
      e.direction === "outbound" &&
      new Date(e.timestamp).getTime() > cutoff
  );
}

function hasBeenSentOpportunity(clinicSlug, patientPhone, opportunityType, days = 30) {
  const history = getPatientHistory(clinicSlug, patientPhone);
  const cutoff  = Date.now() - days * 86_400_000;
  return history.some(
    (e) =>
      e.type === EVENT_TYPES.OPPORTUNITY_DETECTED &&
      e.metadata?.opportunityType === opportunityType &&
      new Date(e.timestamp).getTime() > cutoff
  );
}

// ─── Send + log helper ────────────────────────────────────────────────────────

async function sendOpportunity(clinicSlug, patient, opportunityType, message, value) {
  const clinic = getClient(clinicSlug);
  const from   = clinic?.twilioNumber || process.env.TWILIO_FROM_NUMBER;

  try {
    await sendSMS(patient.phone, message, from);
    logEvent(clinicSlug, {
      type:        EVENT_TYPES.OPPORTUNITY_DETECTED,
      patientPhone: patient.phone,
      patientName:  patient.name || null,
      direction:   "outbound",
      channel:     "sms",
      content:     message,
      outcome:     "sent",
      metadata:    { opportunityType, value },
    });
    return true;
  } catch (err) {
    console.error(`[opportunity] ✗ ${opportunityType} → ${patient.phone}: ${err.message}`);
    return false;
  }
}

// ─── Opportunity 1 — Birthday outreach ───────────────────────────────────────

async function checkBirthdays(clinicSlug, patients, clinic) {
  const found = [];
  const today = new Date();

  for (const p of patients) {
    const bday = p.birth_date || p.birthday || p.dob;
    if (!bday || !p.phone) continue;

    const d = new Date(bday);
    if (isNaN(d)) continue;

    // Check if birthday is within next 7 days (ignore year)
    const thisYear = new Date(today.getFullYear(), d.getMonth(), d.getDate());
    const diff     = (thisYear.getTime() - today.getTime()) / 86_400_000;
    if (diff < 0 || diff > 7) continue;

    if (wasRecentlyContacted(clinicSlug, p.phone, 14)) continue;
    if (hasBeenSentOpportunity(clinicSlug, p.phone, "birthday", 350)) continue; // once per year

    const firstName = (p.name || "").split(" ")[0] || "there";
    const msg = `Hi ${firstName}! Everyone at ${clinic.clinicName} wants to wish you a happy birthday! 🎂 We'd love to see you for a check-up to celebrate — reply to book a convenient time. — ${clinic.clinicName}`;

    const sent = await sendOpportunity(clinicSlug, p, "birthday", msg, "high");
    if (sent) {
      found.push({ patient: p.name, type: "birthday", daysUntil: Math.round(diff) });
      console.log(`[opportunity] ✓ Birthday: ${p.name} (${clinicSlug}) — birthday in ${Math.round(diff)} days`);
    }
  }

  return found;
}

// ─── Opportunity 2 — Natural 5-6 month rebooking window ──────────────────────

async function checkRebookingWindow(clinicSlug, patients, clinic) {
  const found = [];

  for (const p of patients) {
    if (!p.phone || !p.last_visit) continue;

    const months = daysSince(p.last_visit) / 30.44;
    if (months < 5 || months > 6.5) continue;

    // Skip if they have an upcoming appointment
    const nextAppt = p.next_appointment ? new Date(p.next_appointment) : null;
    if (nextAppt && nextAppt > new Date()) continue;

    if (wasRecentlyContacted(clinicSlug, p.phone, 14)) continue;
    if (hasBeenSentOpportunity(clinicSlug, p.phone, "rebook_window", 30)) continue;

    const firstName = (p.name || "").split(" ")[0] || "there";
    const msg = `Hi ${firstName}, it's been about 6 months since your last visit at ${clinic.clinicName}. Time for your next cleaning? Reply to book a convenient time — we usually have spots within 2 weeks. — ${clinic.clinicName}`;

    const sent = await sendOpportunity(clinicSlug, p, "rebook_window", msg, "high");
    if (sent) {
      found.push({ patient: p.name, type: "rebook_window", monthsAgo: Math.round(months * 10) / 10 });
      console.log(`[opportunity] ✓ Rebook window: ${p.name} (${clinicSlug}) — ${Math.round(months * 10) / 10}mo since last visit`);
    }
  }

  return found;
}

// ─── Opportunity 3 — Cancelled but never rebooked ────────────────────────────

async function checkCancelledNoRebook(clinicSlug, patients, clinic) {
  const found = [];
  const threads = readJsonSafe(path.join(CLIENTS_DIR, clinicSlug, "recovery-threads.json"), []);

  // Look for patients who opted_out of a thread in the last 30 days
  // but have no upcoming appointment — they intended to come, just had to cancel
  for (const p of patients) {
    if (!p.phone) continue;

    const nextAppt = p.next_appointment ? new Date(p.next_appointment) : null;
    if (nextAppt && nextAppt > new Date()) continue; // already has upcoming

    // Check event log for a cancellation signal in last 30 days
    const history = getPatientHistory(clinicSlug, p.phone);
    const recentCancel = history.find(
      (e) =>
        e.intent === "CANCEL" &&
        daysSince(e.timestamp) < 30
    );
    if (!recentCancel) continue;

    if (wasRecentlyContacted(clinicSlug, p.phone, 14)) continue;
    if (hasBeenSentOpportunity(clinicSlug, p.phone, "cancelled_no_rebook", 30)) continue;

    const firstName = (p.name || "").split(" ")[0] || "there";
    const msg = `Hi ${firstName}, we noticed you had to cancel recently. Whenever you're ready, we'd love to get you back in — just reply with a day that works and we'll find you a spot. — ${clinic.clinicName}`;

    const sent = await sendOpportunity(clinicSlug, p, "cancelled_no_rebook", msg, "high");
    if (sent) {
      found.push({ patient: p.name, type: "cancelled_no_rebook" });
      console.log(`[opportunity] ✓ Cancelled/no rebook: ${p.name} (${clinicSlug})`);
    }
  }

  return found;
}

// ─── Opportunity 4 — Long-lead no-show risk (flag only, no SMS) ──────────────

function checkLongLeadRisk(clinicSlug, patients, clinic) {
  const found = [];

  for (const p of patients) {
    if (!p.next_appointment || !p.last_visit) continue;

    const apptDate = new Date(p.next_appointment);
    if (apptDate <= new Date()) continue;

    const leadDays = daysUntil(p.next_appointment);
    if (leadDays < 21) continue;

    // Flag this appointment as high-risk in the event log
    const alreadyFlagged = getPatientHistory(clinicSlug, p.phone)
      .some((e) => e.metadata?.opportunityType === "high_risk_appointment" && daysSince(e.timestamp) < 7);
    if (alreadyFlagged) continue;

    logEvent(clinicSlug, {
      type:        EVENT_TYPES.OPPORTUNITY_DETECTED,
      patientPhone: p.phone,
      patientName:  p.name || null,
      direction:   "system",
      channel:     "system",
      content:     `High no-show risk: ${p.name} booked ${Math.round(leadDays)} days in advance (${p.next_appointment})`,
      outcome:     "flagged",
      metadata:    { opportunityType: "high_risk_appointment", leadDays: Math.round(leadDays), value: "medium" },
    });

    found.push({ patient: p.name, type: "high_risk_appointment", leadDays: Math.round(leadDays) });
    console.log(`[opportunity] ⚑ High no-show risk: ${p.name} (${clinicSlug}) — ${Math.round(leadDays)}d lead`);
  }

  return found;
}

// ─── Opportunity 5 — Approaching 12 months inactive ──────────────────────────

async function checkApproaching12Months(clinicSlug, patients, clinic) {
  const found = [];

  for (const p of patients) {
    if (!p.phone || !p.last_visit) continue;

    const months = daysSince(p.last_visit) / 30.44;
    if (months < 10 || months >= 12) continue;

    const nextAppt = p.next_appointment ? new Date(p.next_appointment) : null;
    if (nextAppt && nextAppt > new Date()) continue;

    if (wasRecentlyContacted(clinicSlug, p.phone, 14)) continue;
    if (hasBeenSentOpportunity(clinicSlug, p.phone, "approaching_12mo", 30)) continue;

    const firstName = (p.name || "").split(" ")[0] || "there";
    const msg = `Hi ${firstName}, it's been a while since we've seen you at ${clinic.clinicName}! Your next cleaning is coming up — don't let too much time pass. Reply to book before your calendar fills up. — ${clinic.clinicName}`;

    const sent = await sendOpportunity(clinicSlug, p, "approaching_12mo", msg, "high");
    if (sent) {
      found.push({ patient: p.name, type: "approaching_12mo", monthsAgo: Math.round(months * 10) / 10 });
      console.log(`[opportunity] ✓ Approaching 12mo: ${p.name} (${clinicSlug}) — ${Math.round(months * 10) / 10}mo inactive`);
    }
  }

  return found;
}

// ─── Opportunity 6 — Exhausted high-LTV recovery thread ──────────────────────

async function checkExhaustedHighLTV(clinicSlug, patients, clinic) {
  const found     = [];
  const threads   = readJsonSafe(path.join(CLIENTS_DIR, clinicSlug, "recovery-threads.json"), []);
  const scoresData = readJsonSafe(path.join(CLIENTS_DIR, clinicSlug, "patient-scores.json"), { scores: [] });
  const scoreMap  = {};
  (scoresData.scores || []).forEach((s) => {
    if (s.phone) scoreMap[s.phone.replace(/\D/g, "")] = s;
  });

  const exhausted = threads.filter(
    (t) => t.status === "exhausted" && t.resolvedAt && daysSince(t.resolvedAt) >= 30
  );

  for (const thread of exhausted) {
    const phone  = thread.callerNumber;
    if (!phone) continue;
    const digits = phone.replace(/\D/g, "");
    const score  = scoreMap[digits];
    const ltv    = score?.ltv?.threeYearLTV || 0;
    if (ltv < 500) continue;

    if (wasRecentlyContacted(clinicSlug, phone, 30)) continue;
    if (hasBeenSentOpportunity(clinicSlug, phone, "final_attempt", 60)) continue;

    const firstName = (thread.patientName || "").split(" ")[0] || "there";
    const msg = `Hi ${firstName}, I know we've reached out a few times — I wanted to try one more time because we genuinely value you as a patient at ${clinic.clinicName}. If there's anything we can do to make it easier, please let us know. — ${clinic.clinicName}`;

    // Find the patient record for phone
    const patient = patients.find((p) => p.phone?.replace(/\D/g, "") === digits)
      || { phone, name: thread.patientName };

    const sent = await sendOpportunity(clinicSlug, patient, "final_attempt", msg, "medium");
    if (sent) {
      found.push({ patient: thread.patientName, type: "final_attempt", ltv });
      console.log(`[opportunity] ✓ Final attempt: ${thread.patientName} (${clinicSlug}) — LTV $${ltv}`);
    }
  }

  return found;
}

// ─── Opportunity 7 — Referral request after positive outcome ─────────────────

async function checkReferralTiming(clinicSlug, patients, clinic) {
  const found   = [];
  const allEvts = readJsonSafe(path.join(CLIENTS_DIR, clinicSlug, "events.json"), []);

  // Find patients who had a positive interaction in last 48 hours
  const cutoff48h = Date.now() - 48 * 3600 * 1000;
  const positivePatients = allEvts
    .filter(
      (e) =>
        new Date(e.timestamp).getTime() > cutoff48h &&
        (e.type === EVENT_TYPES.PATIENT_BOOKED ||
          (e.type === EVENT_TYPES.PATIENT_REPLIED && e.sentiment === "positive"))
    )
    .map((e) => e.patientPhone)
    .filter(Boolean);

  const uniquePhones = [...new Set(positivePatients)];

  for (const phone of uniquePhones) {
    if (wasRecentlyContacted(clinicSlug, phone, 14)) continue;
    if (hasBeenSentOpportunity(clinicSlug, phone, "referral_request", 60)) continue;

    const patient   = patients.find((p) => p.phone === phone) || { phone };
    const firstName = (patient.name || "").split(" ")[0] || "there";
    const msg       = `Hi ${firstName}, so glad we could help! If you know anyone who's been putting off their dental visit, we'd love to help them too — just mention ${clinic.clinicName}. We appreciate every referral! — ${clinic.clinicName}`;

    const sent = await sendOpportunity(clinicSlug, patient, "referral_request", msg, "medium");
    if (sent) {
      found.push({ patient: patient.name || phone, type: "referral_request" });
      logEvent(clinicSlug, {
        type:        EVENT_TYPES.REFERRAL_SENT,
        patientPhone: phone,
        direction:   "outbound",
        channel:     "sms",
        content:     msg,
        outcome:     "sent",
        metadata:    { opportunityType: "referral_request" },
      });
      console.log(`[opportunity] ✓ Referral request: ${patient.name || phone} (${clinicSlug})`);
    }
  }

  return found;
}

// ─── Opportunity 8 — Seasonal campaign ───────────────────────────────────────

async function checkSeasonalCampaign(clinicSlug, patients, clinic) {
  const found = [];
  const month = new Date().getMonth() + 1; // 1-12

  const seasonal = {
    10: { name: "preholiday", msg: (n, c) => `Hi ${n}, the holidays are coming fast! Book your check-up at ${c} now before the year-end rush — slots fill up quickly in December. — ${c}` },
    11: { name: "preholiday", msg: (n, c) => `Hi ${n}, one more chance to get that check-up in before the holidays! ${c} still has November openings. Reply to book. — ${c}` },
    1:  { name: "newyear",    msg: (n, c) => `Hi ${n}, new year, fresh start! ${c} is booking January appointments — is this the year you get your dental health on track? Reply to book. — ${c}` },
    5:  { name: "summersmile", msg: (n, c) => `Hi ${n}, summer's almost here! Get that clean, bright smile before the season — ${c} has great May availability. Reply to book. — ${c}` },
    6:  { name: "summersmile", msg: (n, c) => `Hi ${n}, still time for a summer smile refresh at ${c}! Reply to book before the school-year rush hits. — ${c}` },
    8:  { name: "backtoschool", msg: (n, c) => `Hi ${n}, back-to-school time! Before the September craze hits, get everyone's teeth checked at ${c}. Reply to book family appointments. — ${c}` },
  };

  const campaign = seasonal[month];
  if (!campaign) return found;

  for (const p of patients) {
    if (!p.phone) continue;

    const nextAppt = p.next_appointment ? new Date(p.next_appointment) : null;
    if (nextAppt && nextAppt > new Date()) continue;

    if (wasRecentlyContacted(clinicSlug, p.phone, 21)) continue;
    if (hasBeenSentOpportunity(clinicSlug, p.phone, `seasonal_${campaign.name}`, 60)) continue;

    const firstName = (p.name || "").split(" ")[0] || "there";
    const msg       = campaign.msg(firstName, clinic.clinicName);

    const sent = await sendOpportunity(clinicSlug, p, `seasonal_${campaign.name}`, msg, "medium");
    if (sent) {
      found.push({ patient: p.name, type: `seasonal_${campaign.name}` });
      console.log(`[opportunity] ✓ Seasonal (${campaign.name}): ${p.name} (${clinicSlug})`);
    }
  }

  return found;
}

// ─── Main engine ──────────────────────────────────────────────────────────────

/**
 * Run all 8 opportunity checks for one clinic.
 * @param {string} clinicSlug
 * @returns {Promise<{ opportunitiesFound, actionsTaken, skipped, details }>}
 */
export async function runOpportunityEngine(clinicSlug) {
  const clinic = getClient(clinicSlug);
  if (!clinic) return { opportunitiesFound: 0, actionsTaken: 0, skipped: 0, details: [] };

  const patients = loadPatients(clinicSlug);
  if (!patients.length) {
    console.log(`[opportunity] ${clinicSlug}: no patients — skipping`);
    return { opportunitiesFound: 0, actionsTaken: 0, skipped: 0, details: [] };
  }

  console.log(`[opportunity] ${clinicSlug}: checking ${patients.length} patients across 8 opportunity types`);

  const all = [];

  // Run all 8 checks — catch each independently so one failure doesn't abort the rest
  const checks = [
    () => checkBirthdays          (clinicSlug, patients, clinic),
    () => checkRebookingWindow     (clinicSlug, patients, clinic),
    () => checkCancelledNoRebook   (clinicSlug, patients, clinic),
    () => Promise.resolve(checkLongLeadRisk(clinicSlug, patients, clinic)), // sync
    () => checkApproaching12Months (clinicSlug, patients, clinic),
    () => checkExhaustedHighLTV    (clinicSlug, patients, clinic),
    () => checkReferralTiming      (clinicSlug, patients, clinic),
    () => checkSeasonalCampaign    (clinicSlug, patients, clinic),
  ];

  for (const check of checks) {
    try {
      const results = await check();
      all.push(...results);
    } catch (err) {
      console.error(`[opportunity] ${clinicSlug}: check failed — ${err.message}`);
    }
  }

  const actionsTaken = all.filter((o) => o.type !== "high_risk_appointment").length;
  const flagged      = all.filter((o) => o.type === "high_risk_appointment").length;

  console.log(`[opportunity] ${clinicSlug}: ${all.length} found | ${actionsTaken} messages sent | ${flagged} flagged`);

  return {
    opportunitiesFound: all.length,
    actionsTaken,
    flagged,
    skipped:    0,
    details:    all,
    clinicSlug,
    ranAt:      new Date().toISOString(),
  };
}

/**
 * Run for all active clients.
 * Scheduler entry point — daily at 06:00.
 */
export async function runOpportunityEngineForAll() {
  const clients = getActiveClients();
  console.log(`[opportunity] Running for ${clients.length} active client(s)`);

  let totalFound = 0, totalActions = 0;
  const results = [];

  for (const clinic of clients) {
    const result = await runOpportunityEngine(clinic.clinicSlug);
    totalFound   += result.opportunitiesFound;
    totalActions += result.actionsTaken;
    results.push(result);
  }

  console.log(`[opportunity] Done. Total found: ${totalFound} | Total actions: ${totalActions}`);
  return { totalFound, totalActions, results };
}

/**
 * Return a summary of opportunities found and acted on in the last N days.
 * Used in the weekly digest.
 * @param {string} clinicSlug
 * @param {number} days
 * @returns {object}
 */
export function getOpportunitySummary(clinicSlug, days = 7) {
  const events = readJsonSafe(path.join(CLIENTS_DIR, clinicSlug, "events.json"), []);
  const cutoff = Date.now() - days * 86_400_000;

  const recent = events.filter(
    (e) =>
      e.type === EVENT_TYPES.OPPORTUNITY_DETECTED &&
      new Date(e.timestamp).getTime() > cutoff
  );

  const byType = {};
  recent.forEach((e) => {
    const t = e.metadata?.opportunityType || "unknown";
    byType[t] = (byType[t] || 0) + 1;
  });

  const acted  = recent.filter((e) => e.outcome === "sent").length;
  const flagged = recent.filter((e) => e.outcome === "flagged").length;

  return {
    total:  recent.length,
    acted,
    flagged,
    byType,
    period: `last ${days} days`,
  };
}
