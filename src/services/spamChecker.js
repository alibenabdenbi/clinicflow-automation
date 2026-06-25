// src/services/spamChecker.js
// Local SpamAssassin-style content check. Returns a score and flag list.
// Score < 3.0 = pass. Score >= 3.0 = warn before sending.

const SPAM_WORDS = [
  // Financial triggers
  { pattern: /\bfree\b/gi,           score: 0.8, label: "word 'free'" },
  { pattern: /\bguarantee[ds]?\b/gi, score: 1.0, label: "word 'guarantee'" },
  { pattern: /\bact now\b/gi,        score: 1.5, label: "phrase 'act now'" },
  { pattern: /\blimited time\b/gi,   score: 1.0, label: "phrase 'limited time'" },
  { pattern: /\bno risk\b/gi,        score: 0.7, label: "phrase 'no risk'" },
  { pattern: /\bno commitment\b/gi,  score: 0.6, label: "phrase 'no commitment'" },
  { pattern: /\b100%\b/gi,           score: 0.5, label: "phrase '100%'" },
  { pattern: /\bclick here\b/gi,     score: 1.5, label: "phrase 'click here'" },
  // 'unsubscribe' not penalised — intentionally present for CASL compliance
  { pattern: /\bpromotion\b/gi,      score: 0.5, label: "word 'promotion'" },
  { pattern: /\bdiscount\b/gi,       score: 0.5, label: "word 'discount'" },
  { pattern: /\boffer\b/gi,          score: 0.3, label: "word 'offer'" },
];

const SUBJECT_SPAM = [
  { pattern: /^re:/i,                score: 0.6, label: "subject starts with 'Re:' (cold email)" },
  { pattern: /free/i,                score: 0.8, label: "subject contains 'free'" },
  { pattern: /!/,                    score: 0.5, label: "exclamation mark in subject" },
  { pattern: /\$\d/,                 score: 0.6, label: "dollar amount in subject" },
  { pattern: /[A-Z]{4,}/,            score: 0.5, label: "all-caps word in subject" },
  { pattern: /.{61,}/,               score: 0.3, label: "subject over 60 characters" },
];

/**
 * Check a single email for spam signals.
 * @param {{ subject: string, body: string }} email
 * @returns {{ score: number, flags: string[], pass: boolean }}
 */
export function checkSpamScore({ subject = "", body = "" }) {
  const flags = [];
  let score = 0;

  // ── Subject checks ────────────────────────────────────────────────────────
  for (const rule of SUBJECT_SPAM) {
    if (rule.pattern.test(subject)) {
      score += rule.score;
      flags.push(`[subject] ${rule.label} (+${rule.score})`);
    }
  }

  // ── Body word checks ──────────────────────────────────────────────────────
  for (const rule of SPAM_WORDS) {
    const matches = (body.match(rule.pattern) || []).length;
    if (matches > 0) {
      const contrib = rule.score * Math.min(matches, 3); // cap at 3x
      score += contrib;
      flags.push(`[body] ${rule.label} ×${matches} (+${contrib.toFixed(1)})`);
    }
  }

  // ── Structural checks ─────────────────────────────────────────────────────
  const exclamations = (body.match(/!/g) || []).length;
  if (exclamations > 0) {
    score += exclamations * 0.5;
    flags.push(`[body] ${exclamations} exclamation mark(s) (+${(exclamations * 0.5).toFixed(1)})`);
  }

  const allCapsWords = (body.match(/\b[A-Z]{4,}\b/g) || []).length;
  if (allCapsWords > 0) {
    score += allCapsWords * 0.6;
    flags.push(`[body] ${allCapsWords} all-caps word(s) (+${(allCapsWords * 0.6).toFixed(1)})`);
  }

  const dollarAmounts = (body.match(/\$\d/g) || []).length;
  if (dollarAmounts > 0) {
    score += dollarAmounts * 0.5;
    flags.push(`[body] ${dollarAmounts} dollar amount(s) (+${(dollarAmounts * 0.5).toFixed(1)})`);
  }

  const wordCount = body.split(/\s+/).filter(Boolean).length;
  if (wordCount > 200) {
    score += 0.5;
    flags.push(`[body] ${wordCount} words — over 200 (+0.5)`);
  }

  // "no cost" used more than once
  const noCostCount = (body.match(/\bno cost\b/gi) || []).length;
  if (noCostCount > 1) {
    score += 0.4 * (noCostCount - 1);
    flags.push(`[body] 'no cost' appears ${noCostCount} times (+${(0.4 * (noCostCount - 1)).toFixed(1)})`);
  }

  // ── URL count ─────────────────────────────────────────────────────────────
  const urlCount = (body.match(/https?:\/\//g) || []).length;
  if (urlCount > 1) {
    score += urlCount * 0.4;
    flags.push(`[body] ${urlCount} URL(s) (+${(urlCount * 0.4).toFixed(1)})`);
  }

  const finalScore = Math.round(score * 10) / 10;
  return {
    score: finalScore,
    flags,
    pass: finalScore < 3.0,
  };
}

/**
 * Log the spam check result to console.
 * @param {{ subject: string, body: string }} email
 * @param {string} [clinicName]
 * @returns {boolean} true if passes (score < 3.0)
 */
export function logSpamCheck({ subject, body }, clinicName = "") {
  const result = checkSpamScore({ subject, body });
  if (!result.pass) {
    console.log(`  ⚠ SPAM SCORE ${result.score}/10 — ${clinicName || subject.slice(0, 40)}`);
    result.flags.forEach(f => console.log(`    · ${f}`));
  }
  return result.pass;
}
