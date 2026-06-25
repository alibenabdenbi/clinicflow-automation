// src/services/priorityScorer.js
// Scores each todo clinic 0-100 to rank send order by reply likelihood.
//
// Breakdown (max 100):
//   +30  Named email      (dr.anna@, firstname@, firstname.lastname@)
//   +20  Opportunity score (opportunityScore field, scaled 5–10 → 0–20)
//   +20  Email confidence  (high=20, medium=12, low=5, none=0)
//   +15  Email score       (emailScore 0–10, scaled to 0–15)
//   +10  Priority flag     (priority === "high")
//   + 5  Has real website  (website present and not a placeholder)

import { isNamedEmail } from "./emailPersonalizer.js";

/**
 * Score a single clinic record.
 * @param {object} lead
 * @returns {{ total: number, breakdown: string[], reasons: object }}
 */
export function scoreLead(lead) {
  let total = 0;
  const breakdown = [];
  const reasons = {};

  // ── +30 Named email ───────────────────────────────────────────────────────
  if (lead.email && isNamedEmail(lead.email)) {
    total += 30;
    breakdown.push("named(+30)");
    reasons.namedEmail = 30;
  }

  // ── +20 Opportunity score (field range 5–10, linear scale) ───────────────
  const oScore = Number(lead.opportunityScore ?? 0);
  if (oScore >= 5) {
    const oPoints = Math.round(((oScore - 5) / 5) * 20);
    total += oPoints;
    breakdown.push(`oScore:${oScore}(+${oPoints})`);
    reasons.opportunityScore = oPoints;
  }

  // ── +20 Email confidence ──────────────────────────────────────────────────
  const confPoints = { high: 20, medium: 12, low: 5, none: 0 };
  const conf = (lead.emailConfidence || "none").toLowerCase();
  const cPoints = confPoints[conf] ?? 0;
  if (cPoints > 0) {
    total += cPoints;
    breakdown.push(`conf:${conf}(+${cPoints})`);
    reasons.emailConfidence = cPoints;
  }

  // ── +15 Email score (0–10 raw → 0–15 scaled) ─────────────────────────────
  const eScore = Math.min(10, Math.max(0, Number(lead.emailScore ?? 0)));
  if (eScore > 0) {
    const ePoints = Math.round((eScore / 10) * 15);
    total += ePoints;
    breakdown.push(`eScore:${eScore}(+${ePoints})`);
    reasons.emailScore = ePoints;
  }

  // ── +10 Priority flag ─────────────────────────────────────────────────────
  if (lead.priority === "high") {
    total += 10;
    breakdown.push("priority(+10)");
    reasons.priorityFlag = 10;
  }

  // ── +5 Has a real website ─────────────────────────────────────────────────
  if (lead.website && /^https?:\/\/.{4,}/.test(lead.website)) {
    total += 5;
    breakdown.push("hasWebsite(+5)");
    reasons.hasWebsite = 5;
  }

  // ── +25/+15 Review pain signal — pushes Variant R clinics to top ─────────
  const painScore = Number(lead.reviewPainScore ?? 0);
  if (painScore >= 2) {
    total += 25;
    breakdown.push(`painScore:${painScore}(+25)`);
    reasons.reviewPain = 25;
  } else if (painScore === 1) {
    total += 15;
    breakdown.push(`painScore:${painScore}(+15)`);
    reasons.reviewPain = 15;
  }

  return {
    total: Math.min(100, total),
    breakdown: breakdown.join(" | "),
    reasons,
  };
}

/**
 * Sort an array of {l, idx} candidate entries by priority score descending.
 * Tie-break: prefer records with no prior contact (no sentAt on any field).
 * Mutates nothing — returns a new sorted array.
 * @param {Array<{l: object, idx: number}>} candidates
 * @returns {Array<{l: object, idx: number, priorityScore: number, scoreBreakdown: string}>}
 */
export function sortByPriority(candidates) {
  return candidates
    .map((entry) => {
      const { total, breakdown } = scoreLead(entry.l);
      return { ...entry, priorityScore: total, scoreBreakdown: breakdown };
    })
    .sort((a, b) => {
      // Primary: priority score descending
      if (b.priorityScore !== a.priorityScore) return b.priorityScore - a.priorityScore;
      // Tie-break: never-contacted first (no sentAt anywhere)
      const aContacted = Boolean(a.l.sentAt || a.l.followup1SentAt);
      const bContacted = Boolean(b.l.sentAt || b.l.followup1SentAt);
      if (aContacted !== bContacted) return aContacted ? 1 : -1;
      return 0;
    });
}
