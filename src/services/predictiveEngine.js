// src/services/predictiveEngine.js
// Predictive Intelligence Engine — scores every patient and forecasts revenue.
// Pure heuristics, no ML dependencies. Runs offline in under a second per clinic.
//
// Outputs per clinic:
//   data/clients/{slug}/patient-scores.json  — per-patient predictions
//   data/clients/{slug}/intelligence.json    — clinic-level forecast + insights
//
// Scheduler: runs every Sunday at 06:00 and on demand via CLI.

import fs from "fs";
import path from "path";
import { getActiveClients, updateClient } from "./clientLifecycle.js";

const CLIENTS_DIR = path.join(process.cwd(), "data", "clients");
const CLIENTS_PATH = path.join(process.cwd(), "data", "clients.json");

// ─── Constants ────────────────────────────────────────────────────────────────

const AVG_VISIT_VALUE = 200;        // $ per dental visit
const INDUSTRY_REPLY_RATE = 0.12;   // 12% baseline for comparison

const CHURN_THRESHOLDS = { high: 65, medium: 35 };
const RECOVERY_THRESHOLDS = { high: 60, medium: 35 };

const RECOMMENDED_ACTIONS = {
  urgent_outreach:    "Start reactivation now — high churn risk, high recovery likelihood",
  at_risk_monitor:    "Patient is at risk but unlikely to respond to SMS — flag for manual outreach",
  reminder_needed:    "No upcoming appointment — send booking nudge",
  reminder_scheduled: "Appointment reminder will fire automatically",
  healthy:            "Patient on track — no action needed",
  routine_recall:     "Due for recall within next 2 months",
  reactivation_wave:  "Include in next monthly reactivation campaign",
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

function monthsSince(isoDate) {
  if (!isoDate) return 999;
  return (Date.now() - new Date(isoDate).getTime()) / (30.44 * 24 * 3600 * 1000);
}

function parseCsv(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return [];
  const headers = lines[0].split(",").map((h) => h.trim().toLowerCase());
  return lines.slice(1).map((line) => {
    const vals = line.split(",");
    const obj = {};
    headers.forEach((h, i) => { obj[h] = (vals[i] || "").trim(); });
    return obj;
  });
}

// ─── Data loaders ─────────────────────────────────────────────────────────────

function loadPatients(clinicSlug) {
  const csvPath = path.join(CLIENTS_DIR, clinicSlug, "patients.csv");
  if (!fs.existsSync(csvPath)) return [];
  return parseCsv(fs.readFileSync(csvPath, "utf-8"));
}

function loadThreads(clinicSlug) {
  return readJsonSafe(path.join(CLIENTS_DIR, clinicSlug, "recovery-threads.json"), []);
}

function loadReactivationLog(clinicSlug) {
  return readJsonSafe(path.join(CLIENTS_DIR, clinicSlug, "reactivation.json"), []);
}

// ─── Per-patient scoring ──────────────────────────────────────────────────────

/**
 * Compute churn risk score (0-100). Higher = more likely to never return.
 */
function computeChurnRisk(patient, threads) {
  const months = monthsSince(patient.last_visit || patient.lastvisit);
  const nextAppt = patient.next_appointment ? new Date(patient.next_appointment) : null;
  const hasUpcoming = nextAppt && nextAppt > new Date();
  const phone = digitsOnly(patient.phone || "");

  // Base: inactivity drives risk up. 24 months = ~60 points.
  let score = Math.min(60, months * 2.5);

  // Positive signals (reduce risk)
  if (hasUpcoming) score -= 30;           // already booked — very low risk
  if (months < 6) score -= 10;            // recently active

  // Recovery thread history
  const patientThreads = threads.filter((t) => phone && digitsOnly(t.callerNumber) === phone);
  const wasRecovered = patientThreads.some((t) => t.recovered);
  const hasReplied = patientThreads.some((t) => t.reply);
  if (wasRecovered) score -= 15;          // came back before — likely to again
  if (hasReplied) score -= 10;            // at least engaging

  // Contact data quality
  const hasEmail = patient.email && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(patient.email);
  if (hasEmail) score -= 5;               // more ways to reach them

  // Reactivation log history
  // (no bonus/penalty — already captured in reply status)

  return Math.max(0, Math.min(100, Math.round(score)));
}

/**
 * Compute recovery likelihood (0-100). Higher = more likely to book if contacted now.
 */
function computeRecoveryLikelihood(patient, threads) {
  const months = monthsSince(patient.last_visit || patient.lastvisit);
  const phone = digitsOnly(patient.phone || "");
  const nextAppt = patient.next_appointment ? new Date(patient.next_appointment) : null;
  const hasUpcoming = nextAppt && nextAppt > new Date();

  let score = 40; // baseline — most people can be reached if we try

  // Mobile number = can receive SMS
  if (phone) score += 15;

  // Recency: easier to re-engage someone who left recently
  if (months <= 14) score += 15;
  else if (months <= 24) score += 5;
  else if (months > 36) score -= 20; // very cold

  // Previous reply to recovery SMS
  const patientThreads = threads.filter((t) => phone && digitsOnly(t.callerNumber) === phone);
  const bestReply = patientThreads.find((t) => t.replyIntent === "booking");
  const anyReply = patientThreads.find((t) => t.reply);
  if (bestReply) score += 35;        // booked before through SMS — very high signal
  else if (anyReply) score += 15;    // at least replied

  // Already has appointment coming up — recovery already happened
  if (hasUpcoming) score -= 20;

  // Email makes multi-channel possible
  const hasEmail = patient.email && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(patient.email);
  if (hasEmail) score += 5;

  return Math.max(0, Math.min(100, Math.round(score)));
}

/**
 * Estimate patient lifetime value (3-year horizon, $200/visit).
 */
function computeLTV(patient) {
  const months = monthsSince(patient.last_visit || patient.lastvisit);
  // Estimate annual visits from inactivity pattern (we only have last_visit)
  const annualVisits =
    months <= 8  ? 3   :  // visits every 3-4 months
    months <= 14 ? 2   :  // visits every 6-7 months
    months <= 24 ? 1   :  // annual
    months <= 36 ? 0.7 :  // sporadic
                   0.3;   // likely churned

  const annualValue  = Math.round(annualVisits * AVG_VISIT_VALUE);
  const threeYearLTV = annualValue * 3;
  const label        = threeYearLTV >= 1000 ? "high" : threeYearLTV >= 400 ? "medium" : "low";

  return { annualValue, threeYearLTV, annualVisits, label };
}

/**
 * Determine the best day/hour to contact this patient.
 * Uses actual reply timestamps from recovery threads if available,
 * falls back to empirical dental clinic norms.
 */
function computeOptimalContactWindow(patient, threads) {
  const phone = digitsOnly(patient.phone || "");
  const patientThreads = threads.filter((t) => phone && digitsOnly(t.callerNumber) === phone);

  // Collect actual reply timestamps
  const replyTimes = patientThreads
    .flatMap((t) => t.messages.filter((m) => m.direction === "inbound" && m.receivedAt))
    .map((m) => new Date(m.receivedAt))
    .filter((d) => !isNaN(d));

  if (replyTimes.length >= 2) {
    // Compute from real data
    const hourCounts = {};
    const dayCounts  = {};
    replyTimes.forEach((d) => {
      const h   = d.getHours();
      const day = d.toLocaleDateString("en-CA", { weekday: "long" });
      hourCounts[h]   = (hourCounts[h]   || 0) + 1;
      dayCounts[day]  = (dayCounts[day]  || 0) + 1;
    });
    const bestHour = Number(Object.entries(hourCounts).sort(([,a],[,b]) => b-a)[0][0]);
    const bestDay  = Object.entries(dayCounts).sort(([,a],[,b]) => b-a)[0][0];
    return { day: bestDay, hour: bestHour, source: "observed" };
  }

  // Dental practice norms: Tue-Thu, 10am-12pm or 2pm-4pm
  // Vary by patient index to spread load across the day
  const phone3 = phone.slice(-1); // last digit as pseudo-random bucket
  const hour   = [10, 11, 14, 15, 10, 11, 14, 15, 10, 10][parseInt(phone3, 10)] || 10;
  const days   = ["Tuesday", "Wednesday", "Thursday", "Tuesday", "Wednesday",
                  "Thursday", "Tuesday", "Wednesday", "Thursday", "Tuesday"];
  const day    = days[parseInt(phone3, 10)] || "Tuesday";
  return { day, hour, source: "default" };
}

/**
 * Determine the recommended action for this patient.
 */
function computeRecommendedAction(patient, churnRisk, recoveryLikelihood) {
  const months    = monthsSince(patient.last_visit || patient.lastvisit);
  const nextAppt  = patient.next_appointment ? new Date(patient.next_appointment) : null;
  const hasUpcoming = nextAppt && nextAppt > new Date();

  if (hasUpcoming) return "reminder_scheduled";
  if (churnRisk >= CHURN_THRESHOLDS.high && recoveryLikelihood >= RECOVERY_THRESHOLDS.high) return "urgent_outreach";
  if (churnRisk >= CHURN_THRESHOLDS.high && recoveryLikelihood < RECOVERY_THRESHOLDS.medium) return "at_risk_monitor";
  if (churnRisk >= CHURN_THRESHOLDS.high) return "reactivation_wave";
  if (months >= 10 && months < 12) return "routine_recall";
  if (months >= 12 && !hasUpcoming) return "reminder_needed";
  return "healthy";
}

/**
 * Score one patient — the core function.
 * @returns {object} Full patient score record
 */
export function scorePatient(patient, threads, reactivationLog = []) {
  const churnRisk          = computeChurnRisk(patient, threads);
  const recoveryLikelihood = computeRecoveryLikelihood(patient, threads);
  const ltv                = computeLTV(patient);
  const contactWindow      = computeOptimalContactWindow(patient, threads);
  const action             = computeRecommendedAction(patient, churnRisk, recoveryLikelihood);

  const months     = monthsSince(patient.last_visit || patient.lastvisit);
  const nextAppt   = patient.next_appointment ? new Date(patient.next_appointment) : null;
  const hasUpcoming = nextAppt && nextAppt > new Date();

  return {
    name:              patient.name || "Unknown",
    phone:             patient.phone || null,
    email:             patient.email || null,
    lastVisit:         patient.last_visit || patient.lastvisit || null,
    nextAppointment:   patient.next_appointment || null,
    hasUpcoming,
    monthsInactive:    Math.round(months * 10) / 10,

    // Scores
    churnRisk,
    churnRiskLabel:    churnRisk >= CHURN_THRESHOLDS.high ? "high"
                     : churnRisk >= CHURN_THRESHOLDS.medium ? "medium" : "low",
    recoveryLikelihood,
    recoveryLabel:     recoveryLikelihood >= RECOVERY_THRESHOLDS.high ? "high"
                     : recoveryLikelihood >= RECOVERY_THRESHOLDS.medium ? "medium" : "low",
    ltv,

    // Timing
    optimalContactDay:  contactWindow.day,
    optimalContactHour: contactWindow.hour,
    contactSource:      contactWindow.source,

    // Action
    recommendedAction:  action,
    actionDescription:  RECOMMENDED_ACTIONS[action],

    scoredAt: new Date().toISOString(),
  };
}

// ─── Clinic-level forecast ────────────────────────────────────────────────────

/**
 * Revenue forecast for the next 30 days.
 */
function computeRevenueForecast(scores, clinicRecoveryRate) {
  const now    = new Date();
  const period = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

  const inactive  = scores.filter((s) => s.monthsInactive >= 12 && !s.hasUpcoming);
  const urgentOutreach = scores.filter((s) => s.recommendedAction === "urgent_outreach");
  const atRisk    = scores.filter((s) => s.churnRisk >= CHURN_THRESHOLDS.high);
  const healthy   = scores.filter((s) => s.churnRisk < CHURN_THRESHOLDS.medium);

  // Use clinic's actual recovery rate if known, else industry baseline
  const ourRate  = clinicRecoveryRate > 0 ? clinicRecoveryRate / 100 : INDUSTRY_REPLY_RATE;

  const conservativeRecoveries = Math.max(0, Math.round(inactive.length * INDUSTRY_REPLY_RATE));
  const expectedRecoveries     = Math.max(0, Math.round(inactive.length * ourRate * 1.1));
  const optimisticRecoveries   = Math.max(0, Math.round(inactive.length * ourRate * 1.6));

  // Weekly breakdown (assumes even distribution across 4 weeks)
  const byWeek = [1, 2, 3, 4].map((w) => ({
    week: w,
    expectedRecoveries: Math.round(expectedRecoveries / 4),
    expectedRevenue:    Math.round((expectedRecoveries / 4) * AVG_VISIT_VALUE),
  }));

  // LTV at risk (high churn patients × their 3-year LTV)
  const ltvAtRisk = atRisk.reduce((sum, s) => sum + (s.ltv?.threeYearLTV || 0), 0);

  return {
    period,
    inactiveCount:  inactive.length,
    urgentCount:    urgentOutreach.length,
    healthyCount:   healthy.length,
    scenarios: {
      conservative: {
        recoveries: conservativeRecoveries,
        revenue:    conservativeRecoveries * AVG_VISIT_VALUE,
        note:       "Industry average baseline (12% reply rate)",
      },
      expected: {
        recoveries: expectedRecoveries,
        revenue:    expectedRecoveries * AVG_VISIT_VALUE,
        note:       "Based on your clinic's observed recovery rate",
      },
      optimistic: {
        recoveries: optimisticRecoveries,
        revenue:    optimisticRecoveries * AVG_VISIT_VALUE,
        note:       "Assumes improved wave timing and personalization",
      },
    },
    ltvAtRisk,
    byWeek,
    generatedAt: new Date().toISOString(),
  };
}

/**
 * Compute heatmap data (day × hour) from recovery thread timestamps.
 * Returns a 7-row (Mon=0…Sun=6) × 10-col (8am-5pm) grid.
 */
function computeHeatmap(threads) {
  const heatmap = {};
  for (let d = 0; d < 7; d++) {
    heatmap[d] = {};
    for (let h = 8; h < 18; h++) heatmap[d][h] = 0;
  }

  threads.forEach((t) => {
    if (!t.calledAt) return;
    const d = new Date(t.calledAt);
    const dayIdx  = (d.getDay() + 6) % 7; // Mon=0, Sun=6
    const hour    = d.getHours();
    if (hour >= 8 && hour < 18 && heatmap[dayIdx]) {
      heatmap[dayIdx][hour] = (heatmap[dayIdx][hour] || 0) + 1;
    }
  });

  return heatmap;
}

/**
 * Compute comparison stats for previous month.
 * Very rough if threads are sparse — uses thread timestamps.
 */
function computeMonthComparison(threads, scores) {
  const now      = new Date();
  const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);

  const thisMonthThreads = threads.filter((t) => t.calledAt && new Date(t.calledAt) >= thisMonthStart);
  const lastMonthThreads = threads.filter((t) => {
    const d = t.calledAt && new Date(t.calledAt);
    return d && d >= lastMonthStart && d < thisMonthStart;
  });

  function stats(tl) {
    const calls    = tl.length;
    const recovered = tl.filter((t) => t.recovered).length;
    const rate     = calls > 0 ? Math.round((recovered / calls) * 100) : 0;
    return { calls, recovered, recoveryRate: rate, revenue: recovered * AVG_VISIT_VALUE };
  }

  return {
    thisMonth: stats(thisMonthThreads),
    lastMonth: stats(lastMonthThreads),
  };
}

/**
 * Generate a human-readable insight paragraph for the clinic.
 * This is what shows in the portal and the weekly brief email.
 */
export function generateInsightSummary(clinicSlug, scores, forecast, clinic) {
  const name   = clinic?.clinicName || clinicSlug;
  const urgent = scores.filter((s) => s.recommendedAction === "urgent_outreach");
  const atRisk = scores.filter((s) => s.churnRisk >= CHURN_THRESHOLDS.high);
  const healthy = scores.filter((s) => s.churnRisk < CHURN_THRESHOLDS.medium);
  const topLTV  = scores
    .filter((s) => s.ltv?.threeYearLTV >= 600 && s.churnRisk >= CHURN_THRESHOLDS.medium)
    .sort((a, b) => b.ltv.threeYearLTV - a.ltv.threeYearLTV)
    .slice(0, 2);

  const lines = [];

  if (urgent.length > 0) {
    const names = urgent.slice(0, 2).map((s) => s.name.split(" ")[0]).join(" and ");
    lines.push(`${urgent.length === 1 ? `${names} is` : `${names} are`} at high churn risk with a strong chance of responding — reactivation is recommended this week.`);
  }

  if (atRisk.length > 0 && atRisk.length !== urgent.length) {
    lines.push(`${atRisk.length} patient${atRisk.length > 1 ? "s are" : " is"} at elevated churn risk this month.`);
  }

  if (forecast.ltvAtRisk > 0) {
    lines.push(`$${forecast.ltvAtRisk.toLocaleString("en-CA")} in patient lifetime value is at risk if these patients don't return.`);
  }

  lines.push(`Revenue forecast for ${forecast.period}: $${forecast.scenarios.conservative.revenue.toLocaleString("en-CA")} (conservative) to $${forecast.scenarios.optimistic.revenue.toLocaleString("en-CA")} (optimistic).`);

  if (healthy.length > 0) {
    lines.push(`${healthy.length} patient${healthy.length > 1 ? "s are" : " is"} on track with no action needed.`);
  }

  if (topLTV.length > 0) {
    const tvNames = topLTV.map((s) => s.name.split(" ")[0]).join(" and ");
    lines.push(`High-value patient${topLTV.length > 1 ? "s" : ""} to prioritize: ${tvNames} (estimated $${topLTV[0].ltv.threeYearLTV.toLocaleString("en-CA")} in 3-year value).`);
  }

  return lines.join(" ");
}

// ─── Main analysis function ───────────────────────────────────────────────────

/**
 * Run full predictive analysis for one clinic.
 * Saves patient-scores.json and intelligence.json.
 * @param {string} clinicSlug
 * @returns {{ scores, forecast, summary, heatmap, comparison }}
 */
export async function analyzeClinic(clinicSlug) {
  const clinic          = readJsonSafe(CLIENTS_PATH, []).find((c) => c.clinicSlug === clinicSlug);
  const patients        = loadPatients(clinicSlug);
  const threads         = loadThreads(clinicSlug);
  const reactivationLog = loadReactivationLog(clinicSlug);

  if (!patients.length) {
    console.log(`[predictive] ${clinicSlug}: no patients loaded — skipping`);
    return null;
  }

  console.log(`[predictive] ${clinicSlug}: scoring ${patients.length} patients…`);

  // Score every patient
  const scores = patients.map((p) => scorePatient(p, threads, reactivationLog));

  // Compute clinic-level recovery rate from threads
  const totalThreads  = threads.length;
  const recoveredCount = threads.filter((t) => t.recovered).length;
  const clinicRecoveryRate = totalThreads > 0
    ? Math.round((recoveredCount / totalThreads) * 100)
    : 0;

  const forecast   = computeRevenueForecast(scores, clinicRecoveryRate);
  const heatmap    = computeHeatmap(threads);
  const comparison = computeMonthComparison(threads, scores);
  const summary    = generateInsightSummary(clinicSlug, scores, forecast, clinic);

  // Build patients-at-risk list (for portal)
  const patientsAtRisk = patients
    .map((p) => {
      const months = monthsSince(p.last_visit || p.lastvisit);
      return { name: p.name, lastVisit: p.last_visit || p.lastvisit, monthsInactive: Math.round(months) };
    })
    .filter((p) => p.monthsInactive >= 10 && p.monthsInactive <= 13)
    .sort((a, b) => b.monthsInactive - a.monthsInactive);

  // Build recovery stats for portal funnel
  const recovery = {
    total:        threads.length,
    wave1Sent:    threads.filter((t) => t.messages?.some((m) => m.wave === 1 && m.success)).length,
    wave2Sent:    threads.filter((t) => t.messages?.some((m) => m.wave === 2 && m.success)).length,
    wave3Sent:    threads.filter((t) => t.messages?.some((m) => m.wave === 3 && m.success)).length,
    replied:      threads.filter((t) => t.reply != null).length,
    recovered:    recoveredCount,
    optedOut:     threads.filter((t) => t.status === "opted_out").length,
    exhausted:    threads.filter((t) => t.status === "exhausted").length,
    waiting:      threads.filter((t) => ["wave1_sent", "wave2_sent"].includes(t.status)).length,
    replyRate:    totalThreads > 0 ? Math.round((threads.filter((t) => t.reply != null).length / totalThreads) * 100) : 0,
    recoveryRate: clinicRecoveryRate,
  };

  // Persist
  writeJsonSafe(path.join(CLIENTS_DIR, clinicSlug, "patient-scores.json"), {
    clinicSlug,
    generatedAt: new Date().toISOString(),
    patientCount: scores.length,
    scores,
  });

  const intelligence = {
    clinicSlug,
    generatedAt:  new Date().toISOString(),
    summary,
    forecast,
    heatmap,
    comparison,
    patientsAtRisk,
    recovery,
    topActions: scores
      .filter((s) => ["urgent_outreach", "at_risk_monitor", "reactivation_wave"].includes(s.recommendedAction))
      .sort((a, b) => b.churnRisk - a.churnRisk)
      .slice(0, 5)
      .map((s) => ({
        name:   s.name,
        action: s.recommendedAction,
        churnRisk: s.churnRisk,
        recoveryLikelihood: s.recoveryLikelihood,
        ltvLabel: s.ltv.label,
      })),
  };

  writeJsonSafe(path.join(CLIENTS_DIR, clinicSlug, "intelligence.json"), intelligence);

  // Update stats.json with latest predictions (feeds the portal)
  const statsPath = path.join(CLIENTS_DIR, clinicSlug, "stats.json");
  const stats = readJsonSafe(statsPath, {});
  writeJsonSafe(statsPath, {
    ...stats,
    ...(clinic || {}),
    recovery,
    heatmap,
    patientsAtRisk,
    comparison,
    intelligence: {
      summary,
      forecastConservative: forecast.scenarios.conservative.revenue,
      forecastExpected:     forecast.scenarios.expected.revenue,
      forecastOptimistic:   forecast.scenarios.optimistic.revenue,
      urgentPatients:       scores.filter((s) => s.recommendedAction === "urgent_outreach").length,
      atRiskLTV:            forecast.ltvAtRisk,
    },
    updatedAt: new Date().toISOString(),
  });

  console.log(`[predictive] ✓ ${clinicSlug}: scores saved | recovery rate: ${clinicRecoveryRate}% | forecast: $${forecast.scenarios.expected.revenue}`);
  return { scores, forecast, summary, heatmap, comparison, recovery, patientsAtRisk };
}

// ─── Patient-level API (used by recovery engine) ──────────────────────────────

/**
 * Get the recovery likelihood for a specific patient phone number.
 * Used by patientRecoveryEngine to decide whether to send wave 3.
 * Falls back to 50 (neutral) if no score exists yet.
 *
 * @param {string} clinicSlug
 * @param {string} phone — E.164
 * @returns {number} 0-100
 */
export function getPatientRecoveryLikelihood(clinicSlug, phone) {
  const scoresData = readJsonSafe(
    path.join(CLIENTS_DIR, clinicSlug, "patient-scores.json"),
    null
  );
  if (!scoresData?.scores) return 50;

  const digits  = digitsOnly(phone);
  const match   = scoresData.scores.find((s) => digitsOnly(s.phone || "") === digits);
  return match?.recoveryLikelihood ?? 50;
}

/**
 * Get the churn risk for a specific patient.
 * @param {string} clinicSlug
 * @param {string} phone — E.164
 * @returns {number} 0-100
 */
export function getPatientChurnRisk(clinicSlug, phone) {
  const scoresData = readJsonSafe(
    path.join(CLIENTS_DIR, clinicSlug, "patient-scores.json"),
    null
  );
  if (!scoresData?.scores) return 50;

  const digits = digitsOnly(phone);
  const match  = scoresData.scores.find((s) => digitsOnly(s.phone || "") === digits);
  return match?.churnRisk ?? 50;
}

/**
 * Get the optimal contact window for a specific patient.
 * @param {string} clinicSlug
 * @param {string} phone
 * @returns {{ day: string, hour: number }}
 */
export function getOptimalContactWindow(clinicSlug, phone) {
  const scoresData = readJsonSafe(
    path.join(CLIENTS_DIR, clinicSlug, "patient-scores.json"),
    null
  );
  if (!scoresData?.scores) return { day: "Tuesday", hour: 10 };

  const digits = digitsOnly(phone);
  const match  = scoresData.scores.find((s) => digitsOnly(s.phone || "") === digits);
  return match
    ? { day: match.optimalContactDay, hour: match.optimalContactHour }
    : { day: "Tuesday", hour: 10 };
}

/**
 * Get full clinic intelligence report.
 * @param {string} clinicSlug
 * @returns {object|null}
 */
export function getClinicIntelligence(clinicSlug) {
  return readJsonSafe(path.join(CLIENTS_DIR, clinicSlug, "intelligence.json"), null);
}

/**
 * Return patients at elevated churn risk above the given threshold.
 * @param {string} clinicSlug
 * @param {number} threshold — 0-100, default 65
 * @returns {object[]}
 */
export function getAtRiskPatients(clinicSlug, threshold = CHURN_THRESHOLDS.high) {
  const data = readJsonSafe(path.join(CLIENTS_DIR, clinicSlug, "patient-scores.json"), null);
  if (!data?.scores) return [];
  return data.scores
    .filter((s) => s.churnRisk >= threshold)
    .sort((a, b) => b.churnRisk - a.churnRisk);
}

// ─── Scheduler entry point ────────────────────────────────────────────────────

/**
 * Run analysis for all active clients.
 * Called every Sunday at 06:00 by scheduler.
 * @returns {Promise<{ analyzed, errors }>}
 */
export async function runPredictiveAnalysisForAll() {
  let allClients = [];
  try { allClients = JSON.parse(fs.readFileSync(CLIENTS_PATH, "utf-8")); } catch {}

  const active = allClients.filter((c) => c.clinicSlug && c.status === "active");
  console.log(`[predictive] Running analysis for ${active.length} active client(s)`);

  let analyzed = 0;
  const errors = [];

  for (const clinic of active) {
    try {
      const result = await analyzeClinic(clinic.clinicSlug);
      if (result) analyzed++;
    } catch (err) {
      const msg = `${clinic.clinicSlug}: ${err.message}`;
      console.error(`[predictive] ✗ ${msg}`);
      errors.push(msg);
    }
  }

  console.log(`[predictive] Done. Analyzed: ${analyzed} | Errors: ${errors.length}`);
  return { analyzed, errors };
}
