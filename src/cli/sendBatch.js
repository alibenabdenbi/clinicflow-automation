// src/cli/sendBatch.js
// Sends a batch of outreach emails via SMTP.
// Only sends to HIGH confidence emails (warm-up phase).
// Pre-screens each clinic for existing booking/automation tools — skips already-equipped ones.
// Human-like pacing, MX verification, spam scoring, personalized content.

import fs from "fs";
import path from "path";
import dotenv from "dotenv";
import nodemailer from "nodemailer";
import fetch from "node-fetch";

import { verifyEmail } from "../services/emailVerifier.js";
import { buildPersonalizedBody, buildReactivationBody, isNamedEmail, clinicSlug, recordVariantSend } from "../services/emailPersonalizer.js";
import { buildAnomalyEmail } from "../templates/anomalyEmail.js";
import { buildVideoEmail } from "../templates/videoEmail.js";
import { buildFrenchEmail } from "../templates/frenchEmail.js";
import { buildReviewEmail } from "../templates/reviewEmail.js";
import { buildSignalEmail } from "../templates/signalEmail.js";
import { logSpamCheck } from "../services/spamChecker.js";
import { spamScore } from "../config/spamWords.js";
import { MARKET_BODY, MARKET_SUBJECT } from "../templates/replyTemplates.js";
import { NOWEBSITE_BODY, NOWEBSITE_SUBJECT } from "../templates/noWebsiteTemplates.js";
import { sortByPriority } from "../services/priorityScorer.js";

dotenv.config();

// Converts plain text email to minimal HTML (both parts improve deliverability)
function _toHtml(text, clinicSlug = '', variantLabel = '') {
  const escaped = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  const lines = escaped.split("\n").map(l => l === "" ? "<br>" : `<span>${l}</span><br>`).join("\n");
  const pixel = clinicSlug
    ? `<img src="https://clinicflowautomation.com/.netlify/functions/open?c=${encodeURIComponent(clinicSlug)}&v=${encodeURIComponent(variantLabel)}" width="1" height="1" style="display:none;border:0" alt="">`
    : '';
  return `<div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.6;color:#222;max-width:600px">${lines}${pixel}</div>`;
}

// ─── CLI flags ────────────────────────────────────────────────────────────────

const MARKET = (() => {
  const i = process.argv.indexOf("--market");
  return i !== -1 ? (process.argv[i + 1] || null) : null;
})();

const PREVIEW   = process.argv.includes("--preview");
const DRY_RUN   = process.argv.includes("--dry-run");   // preview without sending
const FORCE     = process.argv.includes("--force");      // bypass Tue-Thu day guard (use when local day ≠ UTC day)
const NO_TZ_GUARD = process.argv.includes("--no-tz-guard"); // bypass timezone window check
const SATURDAY  = process.argv.includes("--saturday");  // Saturday mode: bypass weekend+Tue-Thu guards, use voicemail queue order

const TZ_FILTER = (() => {
  const i = process.argv.indexOf("--tz");
  return i !== -1 ? (process.argv[i + 1] || null) : null;
})();

// ─── Config ──────────────────────────────────────────────────────────────────

const MARKET_PATHS = {
  physio:      path.join(process.cwd(), "data", "outreach.physioClinics.json"),
  salon:       path.join(process.cwd(), "data", "outreach.salonBusinesses.json"),
  legal:       path.join(process.cwd(), "data", "outreach.legalFirms.json"),
  realestate:  path.join(process.cwd(), "data", "outreach.realEstate.json"),
  nowebsite:   path.join(process.cwd(), "data", "outreach.noWebsiteClinics.json"),
};

const OUTREACH_PATH =
  (MARKET && MARKET_PATHS[MARKET]) ||
  process.env.OUTREACH_JSON_PATH ||
  path.join(process.cwd(), "data", "outreach.localDentists.json");

const SEND_LOG_PATH  = path.join(process.cwd(), "data", "smtp.sendlog.json");
const EMAIL_LOG_PATH = path.join(process.cwd(), "data", "smtp.emaillog.json");

const SMTP_HOST = (process.env.SMTP_HOST || "").trim();
const SMTP_PORT = Number(process.env.SMTP_PORT || "0");
const SMTP_USER = (process.env.SMTP_USER || "").trim();
const SMTP_PASS = (process.env.SMTP_PASS || "").trim();
const SMTP_FROM = (process.env.SMTP_FROM || SMTP_USER).trim();

const SMTP_SECURE =
  (process.env.SMTP_SECURE || "").toLowerCase() === "true" || SMTP_PORT === 465;

// Warmup complete — scaled to 30 new/day (Apr 23 2026)
const MAX_NEW_PER_DAY    = Number(process.env.MAX_NEW_EMAILS_PER_DAY  || "30");
const MAX_EMAILS_PER_DAY = Number(process.env.MAX_EMAILS_PER_DAY      || "55"); // grand total guard (30 new + 25 fu)
const FOLLOWUP_DELAY_DAYS = Number(process.env.FOLLOWUP_DELAY_DAYS    || "4");
// Per-run cap: never send more than this in one execution even if daily limit allows more
const MAX_PER_RUN = Number(process.env.SEND_MAX_PER_RUN || "30");
const SPAM_SCORE_LIMIT = Number(process.env.SPAM_SCORE_LIMIT || "2");
const PUBLIC_BASE_URL = (process.env.PUBLIC_BASE_URL || "").replace(/\/$/, "");

// ─── Utilities ────────────────────────────────────────────────────────────────

function todayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function readJsonSafe(filePath, fallback = []) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, "utf-8"));
  } catch {
    return fallback;
  }
}

function writeJsonSafe(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
}

function getSentToday() {
  const log = readJsonSafe(SEND_LOG_PATH, {});
  return Number(log[todayKey()] || 0);
}

function getSentTodayNew() {
  const log = readJsonSafe(SEND_LOG_PATH, {});
  return Number(log[todayKey() + "_new"] || 0);
}

function incSentToday() {
  const log = readJsonSafe(SEND_LOG_PATH, {});
  const k = todayKey();
  log[k] = Number(log[k] || 0) + 1;
  log[k + "_new"] = Number(log[k + "_new"] || 0) + 1;
  writeJsonSafe(SEND_LOG_PATH, log);
  return log[k];
}

// New-email cap: capped by MAX_NEW_PER_DAY (15) independently of follow-ups
function remainingToday() {
  return Math.max(0, MAX_NEW_PER_DAY - getSentTodayNew());
}

// ─── Per-email audit log ─────────────────────────────────────────────────────
// smtp.emaillog.json: array of { email, clinic, status, sentAt, smtpCode?, error? }
// This is the source of truth for tracing individual bounces.

const DAY_NAMES = ["sunday","monday","tuesday","wednesday","thursday","friday","saturday"];

function appendEmailLog(entry) {
  const now = new Date();
  const log = readJsonSafe(EMAIL_LOG_PATH, []);
  log.push({
    ...entry,
    sendDay:  DAY_NAMES[now.getDay()],
    sendHour: now.getHours(),
    loggedAt: now.toISOString(),
  });
  writeJsonSafe(EMAIL_LOG_PATH, log);
}

// ─── 24h cross-run dedup ─────────────────────────────────────────────────────
// Reads smtp.emaillog.json and returns a Set of email addresses contacted in
// the last 24 hours. Prevents duplicate sends when two batch runs overlap.
function getRecentSent24h() {
  const log = readJsonSafe(EMAIL_LOG_PATH, []);
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  const recent = new Set();
  for (const entry of log) {
    const ts = entry.sentAt || entry.loggedAt || '';
    if (!ts) continue;
    try {
      if (new Date(ts).getTime() >= cutoff) {
        const addr = (entry.email || entry.to || '').toLowerCase().trim();
        if (addr) recent.add(addr);
      }
    } catch { /* malformed date — skip */ }
  }
  return recent;
}

// ─── Bounce log (data/bounces.json) ──────────────────────────────────────────

const BOUNCES_PATH = path.join(process.cwd(), "data", "bounces.json");

function appendBounceLog({ email, clinic, bounceCode, date }) {
  const log = readJsonSafe(BOUNCES_PATH, []);
  log.push({ email, clinic, bounceCode: bounceCode || null, date: date || new Date().toISOString() });
  writeJsonSafe(BOUNCES_PATH, log);
}

// ─── Bounce handling ─────────────────────────────────────────────────────────
// SMTP 5xx permanent failures detected synchronously during sendMail().
// Async daemon bounces must be marked manually via markBouncedByEmail().

const BOUNCE_CODES = new Set([550, 551, 552, 553, 554]);

function isSmtpBounce(err) {
  const code = err?.responseCode ?? err?.code;
  if (typeof code === "number" && BOUNCE_CODES.has(code)) return true;
  // Some SMTP libs surface the code inside the message string
  if (typeof err?.message === "string") {
    const match = err.message.match(/\b(55[0-4])\b/);
    if (match) return true;
  }
  return false;
}

/**
 * Marks a clinic record as bounced in outreach.localDentists.json.
 * Safe to call multiple times — idempotent.
 * @param {object[]} leads   — mutable leads array (written by caller)
 * @param {number}   idx     — index into leads
 * @param {string}   reason  — human-readable reason
 * @param {number}   [smtpCode]
 */
function markBounced(leads, idx, reason, smtpCode) {
  leads[idx].status      = "bounced";
  leads[idx].bouncedAt   = new Date().toISOString();
  leads[idx].bounceReason = reason;
  if (smtpCode) leads[idx].bounceCode = smtpCode;
  // Clear follow-up fields so scheduler never retries this record
  delete leads[idx].followupDueAt;
  delete leads[idx].followupCount;
}

/**
 * Marks a clinic as bounced by email address (for async daemon bounces).
 * Reads, mutates, and writes outreach.localDentists.json directly.
 * @param {string} email
 * @param {string} [reason]
 */
export function markBouncedByEmail(email, reason = "async daemon bounce") {
  const leads = readJsonSafe(OUTREACH_PATH, []);
  const idx = leads.findIndex(
    l => (l.email || "").toLowerCase().trim() === email.toLowerCase().trim()
  );
  if (idx === -1) {
    console.error(`✗ No record found for email: ${email}`);
    process.exit(1);
  }
  markBounced(leads, idx, reason);
  appendEmailLog({
    email: leads[idx].email,
    clinic: leads[idx].clinicName,
    status: "bounced",
    reason,
  });
  appendBounceLog({ email: leads[idx].email, clinic: leads[idx].clinicName, date: new Date().toISOString() });
  writeJsonSafe(OUTREACH_PATH, leads);
  console.log(`✓ Marked bounced: ${leads[idx].clinicName} <${email}>`);
  console.log(`  Reason: ${reason}`);
  console.log(`  Record will never be retried.`);
  return leads[idx];
}

// ─── Email validation ────────────────────────────────────────────────────────

function isBadEmail(email, { smtpFrom = "" } = {}) {
  const e = String(email || "").trim().toLowerCase().replace(/[;,]+$/, "");
  if (!e) return true;
  // Reject anything with chars that don't belong in an email address
  if (/[;,<>\s]/.test(e)) return true;

  const blockedContains = [
    "noreply", "no-reply", "donotreply", "do-not-reply",
    "example.com", "test@", "sentry-next.wixpress.com", "wixpress.com",
  ];

  const blockedExact = [
    String(smtpFrom || "").trim().toLowerCase(),
    "contact@ore.urg",
    "contact@clinicflowautomation.com",
  ].filter(Boolean);

  if (blockedExact.includes(e)) return true;
  if (blockedContains.some((x) => e.includes(x))) return true;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e)) return true;

  return false;
}

// ─── Human-like pacing ───────────────────────────────────────────────────────

function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randomDelay() {
  const ms = randInt(45_000, 180_000);
  console.log(`  ⏱ Waiting ${Math.round(ms / 1000)}s before next send…`);
  return new Promise((res) => setTimeout(res, ms));
}

// ─── Domain 7-day dedup ──────────────────────────────────────────────────────

// Freemail providers where many unrelated people share the same domain.
// For these, dedup by full email address, not domain.
const FREEMAIL_DOMAINS = new Set([
  "gmail.com", "googlemail.com",
  "hotmail.com", "hotmail.ca", "outlook.com", "outlook.ca", "live.com", "live.ca",
  "yahoo.com", "yahoo.ca",
  "icloud.com", "me.com", "mac.com",
  "rogers.com", "shaw.ca", "bell.net", "sympatico.ca", "cogeco.ca", "videotron.ca",
]);

function emailDomain(email) {
  const parts = String(email || "").trim().toLowerCase().split("@");
  return parts.length === 2 ? parts[1] : null;
}

function domainSentRecently(leads, domain, days = 7) {
  if (!domain) return false;
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  return leads.some((l) => {
    if (!l.sentAt) return false;
    if (emailDomain(l.email) !== domain) return false;
    return new Date(l.sentAt).getTime() >= cutoff;
  });
}

function emailSentRecently(leads, email, days = 7) {
  if (!email) return false;
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  const addr = email.trim().toLowerCase();
  return leads.some((l) => {
    if (!l.sentAt) return false;
    if ((l.email || "").trim().toLowerCase() !== addr) return false;
    return new Date(l.sentAt).getTime() >= cutoff;
  });
}

/**
 * Returns true if this email (or its domain) was sent to recently.
 * For freemail providers, checks the full address so different clinics
 * on gmail.com don't block each other.
 */
function recentlySent(leads, email, days = 7) {
  const domain = emailDomain(email);
  if (domain && FREEMAIL_DOMAINS.has(domain)) {
    return emailSentRecently(leads, email, days);
  }
  return domainSentRecently(leads, domain, days);
}

// ─── Relevance check: does the clinic already have booking/automation? ────────

// Keywords that indicate the clinic already has the tools we'd be selling
const EQUIPPED_KEYWORDS = [
  // Online booking platforms
  "jane app", "janeapp", "jane.app",
  "dentrix", "eaglesoft", "curve dental", "opendental", "open dental",
  "carestream", "dentimax", "practiceworks", "orthotrac",
  "mogo", "maxident", "tracker", "cleardent",
  // Patient portal / automation signals
  "patient portal", "patient login", "online portal",
  "automated reminder", "automated follow-up", "automated followup",
  "text reminder", "sms reminder", "appointment reminder",
  "two-way text", "two way text",
  // Online booking CTAs that imply an integrated system (not just a contact form)
  "book online now", "book your appointment online", "schedule online",
  "request appointment online", "online scheduling",
];

// These alone are NOT enough — almost every site has a "contact us" form
const WEAK_SIGNALS = [
  "contact us", "contact form", "send us a message", "book an appointment",
  "call us", "request an appointment",
];

async function checkClinicRelevance(website) {
  if (!website) return { status: "needs_service", signals: [] };

  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 10_000);
    const res = await fetch(website, {
      signal: ctrl.signal,
      redirect: "follow",
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; ORE-Screener/1.0)",
        Accept: "text/html",
      },
    });
    clearTimeout(t);

    if (!res.ok) return { status: "needs_service", signals: [] };

    const html = (await res.text()).toLowerCase();

    const found = EQUIPPED_KEYWORDS.filter((kw) => html.includes(kw));
    if (found.length > 0) {
      return { status: "already_equipped", signals: found };
    }

    return { status: "needs_service", signals: [] };
  } catch {
    // Can't reach site — don't skip, let it through
    return { status: "needs_service", signals: [] };
  }
}

// ─── Send-time optimization ───────────────────────────────────────────────────
// DST-aware UTC offsets for Canadian timezones (summer = DST active Apr–Nov).
// Returns the current local hour (0–23) for a given timezone abbreviation.
const TZ_UTC_OFFSETS = { AT: -3, ET: -4, CT: -5, MT: -6, PT: -7 };

function localHourForTimezone(tz) {
  const offsetHours = TZ_UTC_OFFSETS[tz] ?? TZ_UTC_OFFSETS.ET;
  const utcMs = Date.now() + new Date().getTimezoneOffset() * 60_000;
  return new Date(utcMs + offsetHours * 3_600_000).getHours();
}

/**
 * Returns true if now is within the send window for this clinic.
 * Window: optimalSendHour - 1  →  optimalSendHour + 4  (5-hour window).
 * Clinics with no optimalSendHour always pass.
 */
function inSendWindow(lead) {
  if (NO_TZ_GUARD) return true;
  if (!lead.optimalSendHour) return true;
  const localHour = localHourForTimezone(lead.timezone || "ET");
  // Send only when it's >= the optimal hour in the clinic's local time (up to +4h).
  // This keeps PT clinics (7am) out of the 10am ET batch and reserves them for the 13:00 ET slot.
  return localHour >= lead.optimalSendHour && localHour <= lead.optimalSendHour + 4;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

function buildEmailContent(l) {
  const senderName = (process.env.SENDER_NAME || "Mohamed").trim();
  const name = l.clinicName || l.name || "your clinic";
  const city = l.city || "";

  if (MARKET === "nowebsite") {
    return {
      subject: NOWEBSITE_SUBJECT(name, city),
      text: NOWEBSITE_BODY(name, city, l.email),
    };
  }
  if (MARKET && MARKET_BODY[MARKET] && MARKET_SUBJECT[MARKET]) {
    return {
      subject: MARKET_SUBJECT[MARKET](name, city),
      text: MARKET_BODY[MARKET](name, city, l.email),
    };
  }

  // Route: pain-signal clinics or named high-confidence → anomaly email
  // Named = local part is personal/unique (not info@, contact@, etc.)
  const emailLocal = (l.email || '').split('@')[0].toLowerCase();
  const emailIsNamed = emailLocal.length > 2 && emailLocal.length < 15 &&
    !/\d/.test(emailLocal) &&
    !['info','contact','hello','admin','office','reception','front',
      'booking','appointment','dental','clinic','welcome','smile',
      'team','care','health','general','enquiry','inquiry'].includes(emailLocal);
  const hasPainSignals = (l.painSignals || []).length > 0;

  // Signal route — personalized first line from real clinic data (first touch for all dental)
  // Draws from: pain signal quote → review count → star rating → city. Bilingual.
  if (!l.signalEmailSent) {
    const sig = buildSignalEmail({ ...l, clinicName: name, city });
    return { subject: sig.subject, text: sig.body, html: null, variantLabel: sig.variant };
  }

  // Review route — pain signal detected in Google reviews (subsequent touch after signal)
  if (l.painSignals?.length > 0 && !l.reviewEmailSent) {
    const rev = buildReviewEmail({ ...l, clinicName: name, city });
    return { subject: rev.subject, text: rev.body, html: null, variantLabel: l.language === 'fr' ? 'REVIEW-FR' : 'REVIEW' };
  }

  // French/Quebec route — language-matched email for FR-flagged clinics
  if (l.language === 'fr') {
    const fr = buildFrenchEmail({ ...l, clinicName: name, city });
    return { subject: fr.subject, text: fr.body, html: null, variantLabel: 'FR' };
  }

  // Highest-value route: named email + high confidence = video thumbnail email
  if (emailIsNamed && l.emailConfidence === 'high' && !l.videoEmailSent && !l.pilotOfferSent) {
    const video = buildVideoEmail({ ...l, clinicName: name, city });
    return { subject: video.subject, text: video.textBody, html: video.htmlBody, variantLabel: 'VIDEO' };
  }

  const useAnomaly = hasPainSignals || (emailIsNamed && l.emailConfidence === 'high');

  if (useAnomaly) {
    const anomaly = buildAnomalyEmail(l);
    return {
      subject:      anomaly.subject,
      text:         anomaly.body,
      variantLabel: anomaly.variant,
    };
  }

  // Standard personalized email
  const slug = clinicSlug(name);
  const trackingUrl = PUBLIC_BASE_URL
    ? `${PUBLIC_BASE_URL}/track?clinic=${encodeURIComponent(slug)}&utm_source=email&utm_campaign=cold`
    : null;

  const isGmail = (l.email || '').toLowerCase().includes('@gmail.com');

  const { subject, body, variantLabel } = buildPersonalizedBody({
    clinicName:       name,
    city,
    website:          l.website,
    email:            l.email,
    contactName:      l.contactName || null,
    aiOpener:         l.aiOpener         || null,
    reviewPainScore:  l.reviewPainScore  || 0,
    reviewPainQuotes: l.reviewPainQuotes || [],
    bookingSoftware:  l.bookingSoftware  || null,
    senderName,
    senderEmail:      SMTP_FROM,
    trackingUrl,
    gmailMode:        isGmail,
  });

  return {
    subject,
    text: body,
    variantLabel,
  };
}

// ─── Reactivation batch ───────────────────────────────────────────────────────
// Re-engage cooling_off clinics that have been quiet for 60+ days.
// Max 5 per run so it never competes with the main send cap.
async function runReactivationBatch(leads, transporter) {
  const SIXTY_DAYS_MS = 60 * 24 * 60 * 60 * 1000;
  const now = Date.now();
  const candidates = leads
    .map((l, idx) => ({ l, idx }))
    .filter(({ l }) => {
      if (l.status !== "cooling_off") return false;
      if (!l.email || isBadEmail(l.email, { smtpFrom: SMTP_FROM })) return false;
      const cooledAt = l.cooledOffAt ? new Date(l.cooledOffAt).getTime() : 0;
      return now - cooledAt >= SIXTY_DAYS_MS;
    });

  if (candidates.length === 0) return;

  const batch = candidates.slice(0, 5);
  console.log(`\n── Reactivation pass: ${batch.length} cooling_off clinic(s) ready ──`);

  for (const { l, idx } of batch) {
    const { subject, body, variantLabel } = buildReactivationBody({
      clinicName: l.clinicName,
      city:       l.city,
      senderName: (process.env.SENDER_NAME || "Mohamed").trim(),
    });
    if (DRY_RUN) {
      console.log(`  [DRY-RUN] REACTIVATION ${l.clinicName} → variant:${variantLabel}`);
      continue;
    }
    try {
      await transporter.sendMail({
        from: SMTP_FROM, to: l.email, subject, text: body,
        html: _toHtml(body, l.clinicName?.toLowerCase().replace(/[^a-z0-9]+/g, '-') || '', variantLabel || ''),
        headers: { "X-Mailer": "Google Mail" },
      });
      leads[idx].status       = "sent";
      leads[idx].sentAt       = new Date().toISOString();
      leads[idx].variantLabel = variantLabel;
      leads[idx].followupCount = 0;
      const due = new Date();
      due.setDate(due.getDate() + FOLLOWUP_DELAY_DAYS);
      leads[idx].followupDueAt = due.toISOString();
      appendEmailLog({ email: l.email, clinic: l.clinicName, status: "sent", sentAt: leads[idx].sentAt, subject, variantLabel, personalizationLevel: "LOW" });
      console.log(`  ✓ Reactivation sent: ${l.clinicName} (${variantLabel})`);
    } catch (e) {
      console.error(`  ✗ Reactivation failed: ${l.clinicName} — ${e.message}`);
    }
  }
}

async function main() {
  // ── Cold-send pause gate (data/send-config.json) ──────────────────────────
  const sendConfig = readJsonSafe(path.join(process.cwd(), "data", "send-config.json"), {});
  if (sendConfig.coldSendsPaused) {
    const resumeAfter = sendConfig.coldSendsResumeAfter ? new Date(sendConfig.coldSendsResumeAfter) : null;
    const stillPaused = !resumeAfter || new Date() < resumeAfter;
    if (stillPaused) {
      const reason = sendConfig.coldSendsPausedReason || "manually paused";
      const resume = resumeAfter ? resumeAfter.toLocaleString("en-CA") : "manually";
      console.log(`⛔ Cold sends paused — ${reason}`);
      console.log(`   Resumes: ${resume}`);
      console.log(`   Warm sends (hit list, follow-ups) are unaffected.`);
      process.exit(0);
    } else {
      // Auto-clear the pause flag once resume time has passed
      sendConfig.coldSendsPaused = false;
      writeJsonSafe(path.join(process.cwd(), "data", "send-config.json"), sendConfig);
      console.log("✓ Cold-send pause expired — resuming normal batch");
    }
  }

  // ── IMPROVEMENT 6: Weekend detection ──────────────────────────────────────
  // Dental clinic owners don't read cold email on weekends. Sending on Sat/Sun
  // wastes daily cap and nudges spam filters negatively.
  // Exception: --saturday flag targets voicemail-only prospects who check personal email on weekends.
  const dayOfWeek = new Date().getDay(); // 0 = Sun, 6 = Sat
  if ((dayOfWeek === 0 || dayOfWeek === 6) && !SATURDAY) {
    console.log(`Weekend — skipping send. Clinic owners check email Monday–Friday.`);
    console.log(`Today is ${["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"][dayOfWeek]}.`);
    console.log(`Use --saturday to run prioritized voicemail-only queue.`);
    process.exit(0);
  }
  if (SATURDAY) {
    console.log(`Saturday mode — voicemail-likelihood queue. Bypassing weekend + Tue-Thu guards.\n`);
  }

  const leads = readJsonSafe(OUTREACH_PATH, []);

  // ── PREVIEW MODE — print emails without sending ───────────────────────────
  if (PREVIEW) {
    console.log(`\n── PREVIEW MODE — no emails will be sent ──`);
    console.log(`Market:     ${MARKET || "dental (default)"}`);
    console.log(`Queue file: ${OUTREACH_PATH}`);
    if (!Array.isArray(leads) || leads.length === 0) {
      console.log("No leads found at:", OUTREACH_PATH);
      return;
    }

    // nowebsite queue uses different schema — no emailConfidence field, has direct email
    // physio + salon allow medium confidence (high-conf count is below threshold)
    const confFilter = (l) => {
      if (MARKET === "nowebsite") return true;
      if (MARKET === "physio" || MARKET === "salon") return l.emailConfidence === "high" || l.emailConfidence === "medium";
      return l.emailConfidence === "high";
    };
    const candidates = leads
      .map((l, idx) => ({ l, idx }))
      .filter(({ l }) => (l.status || "todo") === "todo" && !l.name_needs_review && !l.excludeForever)
      .filter(({ l }) => confFilter(l))
      .filter(({ l }) => !isBadEmail(l.email, { smtpFrom: SMTP_FROM }))
      .filter(({ l }) => l.mxValidated === true); // MX pre-validated only — reduces bounce rate

    const previewList = candidates.slice(0, 3);
    console.log(`\nShowing ${previewList.length} of ${candidates.length} eligible candidates:\n`);

    for (const { l } of previewList) {
      const { subject, text } = buildEmailContent(l);
      console.log("─".repeat(60));
      console.log(`To:      ${l.clinicName || l.name} <${l.email}>`);
      if (l.city) console.log(`City:    ${l.city}`);
      console.log(`Subject: ${subject}`);
      console.log(`\n${text}`);
      console.log("");
    }

    console.log("─".repeat(60));
    console.log(`\nPREVIEW ONLY — 0 emails sent.`);
    return;
  }

  if (!SMTP_HOST || !SMTP_PORT || !SMTP_USER || !SMTP_PASS) {
    console.log("SMTP not configured. Check .env");
    process.exit(1);
  }

  const transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: SMTP_PORT,
    secure: SMTP_SECURE,
    auth: { user: SMTP_USER, pass: SMTP_PASS },
    tls: { rejectUnauthorized: false },
  });

  await transporter.verify();
  console.log("✅ SMTP verify OK\n");

  // Reactivation pass: re-engage cooling_off clinics after 60 days (max 5/run)
  await runReactivationBatch(leads, transporter);

  if (!Array.isArray(leads) || leads.length === 0) {
    console.log("No leads found at:", OUTREACH_PATH);
    process.exit(0);
  }

  const remaining = remainingToday();
  const cap = DRY_RUN && remaining <= 0 ? MAX_PER_RUN : Math.min(remaining, MAX_PER_RUN);

  console.log(`Date:        ${todayKey()}`);
  console.log(`Market:      ${MARKET || "dental (default)"}`);
  console.log(`Queue:       ${OUTREACH_PATH}`);
  console.log(`New cap: ${MAX_NEW_PER_DAY}/day | Sent new today: ${getSentTodayNew()} | Cap this run: ${cap}`);
  console.log(`Mode:        HIGH + MEDIUM confidence\n`);

  if (cap <= 0) {
    if (!DRY_RUN) {
      console.log("Daily limit reached. Exiting.");
      process.exit(0);
    }
    console.log("Daily limit reached — dry-run preview shows next batch.\n");
  }

  // ── Tue-Thu guard for new initial sends ──────────────────────────────────
  const todayDay = new Date().getDay(); // 2=Tue 3=Wed 4=Thu
  const isTueThuDay = [2, 3, 4].includes(todayDay);
  if (!isTueThuDay && !DRY_RUN && !FORCE && !SATURDAY) {
    console.log(`Initial sends restricted to Tue/Wed/Thu — today is ${DAY_NAMES[todayDay]}. Skipping new outreach.`);
    console.log(`Use --force to override (e.g. when local day differs from UTC day).`);
    process.exit(0);
  }
  if (FORCE && !isTueThuDay) {
    console.log(`--force: bypassing Tue-Thu guard (system day: ${DAY_NAMES[todayDay]})\n`);
  }

  // ── Unsubscribe list — never send to opted-out addresses ─────────────────
  const unsubPath = path.join(process.cwd(), "data", "unsubscribes.json");
  const unsubEmails = new Set(
    (readJsonSafe(unsubPath, []))
      .map(u => (u.email || "").toLowerCase().trim())
      .filter(Boolean)
  );

  // ── FILTER 1: status = todo + market guard ───────────────────────────────
  // For the dental run (default): only records where market === "dental" or market is unset.
  // For explicit --market X runs: only records matching that market.
  // This prevents physio/other records that slipped into the dental queue from being sent.
  const currentMarket = MARKET || "dental";
  const todoLeads = leads
    .map((l, idx) => ({ l, idx }))
    .filter(({ l }) => {
      if ((l.status || "todo") !== "todo") return false;
      if (l.name_needs_review) return false;
      if (l.email && unsubEmails.has(l.email.toLowerCase().trim())) {
        console.log(`  Skipping ${l.email} — unsubscribed`);
        return false;
      }
      // Market guard: pass if record market matches current run, or if record has no market set
      const recordMarket = l.market || null;
      if (recordMarket && recordMarket !== currentMarket) return false;
      return true;
    });

  const nameReviewCount = leads.filter(l => l.name_needs_review).length;
  const marketFiltered  = leads.filter(l =>
    (l.status || "todo") === "todo" && l.market && l.market !== currentMarket
  ).length;
  console.log(`Queue (todo):          ${todoLeads.length}`);
  if (nameReviewCount)  console.log(`Skipped (name needs review):   ${nameReviewCount}`);
  if (marketFiltered)   console.log(`Skipped (wrong market [${currentMarket}]): ${marketFiltered}`);

  // ── FILTER 2: Confidence threshold ─────────────────────────────────────────
  // nowebsite: no filter (direct confirmed emails)
  // physio + salon: high OR medium (high-conf count below threshold in these markets)
  // all others: high only (warmup phase)
  const RELAXED_MIN_CONF = new Set(["high", "medium"]);
  let skippedLowConf = 0;
  const highOnly = todoLeads.filter(({ l }) => {
    if (MARKET === "nowebsite") return true;
    const allowed = RELAXED_MIN_CONF.has(l.emailConfidence);
    if (!allowed) {
      skippedLowConf++;
      return false;
    }
    return true;
  });

  const confLabel = "high/medium";
  console.log(`Skipped (below ${confLabel} confidence): ${skippedLowConf}  [held for later]`);
  console.log(`${confLabel.charAt(0).toUpperCase() + confLabel.slice(1)} confidence candidates: ${highOnly.length}`);

  // ── FILTER 2.5: Hunter verification for low-conf generic emails ────────────
  // Low-conf generic addresses (info@, contact@, admin@, reception@) normally get held.
  // Hunter verification unlocks deliverable ones and pre-emptively marks undeliverables.
  // Results cached on the clinic record — API credits only spent once per address.
  const HUNTER_API_KEY = (process.env.HUNTER_API_KEY || "").trim();
  const GENERIC_EMAIL_PREFIXES = ["info@", "contact@", "admin@", "reception@"];
  const isGenericEmail = (email) => {
    const e = (email || "").toLowerCase();
    return GENERIC_EMAIL_PREFIXES.some(p => e.startsWith(p));
  };

  let hunterVerifiedCount = 0;
  let hunterSkippedCount = 0;
  const hunterApproved = [];

  if (HUNTER_API_KEY) {
    const verifyQueue = todoLeads.filter(({ l }) => {
      if (l.emailConfidence === "high" || l.emailConfidence === "medium") return false;
      if (!l.email || isBadEmail(l.email, { smtpFrom: SMTP_FROM })) return false;
      // Already confirmed bad — don't re-verify
      if (l.verificationResult === "undeliverable" || l.verificationResult === "risky") return false;
      return isGenericEmail(l.email);
    });

    if (verifyQueue.length > 0) {
      console.log(`\n── Hunter verification (${verifyQueue.length} low-conf generic emails) ──`);
      for (const { l, idx } of verifyQueue) {
        // Use cached result when available — no credit spent
        if (!l.verificationResult) {
          try {
            const vUrl = `https://api.hunter.io/v2/email-verifier?email=${encodeURIComponent(l.email)}&api_key=${HUNTER_API_KEY}`;
            const ctrl = new AbortController();
            const t = setTimeout(() => ctrl.abort(), 12_000);
            const vRes = await fetch(vUrl, { signal: ctrl.signal });
            clearTimeout(t);
            const vData = await vRes.json();
            leads[idx].verificationResult = vData?.data?.result || "unknown";
            leads[idx].verifiedAt = new Date().toISOString();
          } catch {
            leads[idx].verificationResult = "error";
          }
        }

        const result = leads[idx].verificationResult;
        if (result === "deliverable") {
          console.log(`  ✓ Deliverable: ${l.email}  [${l.clinicName}]`);
          hunterApproved.push({ l, idx });
          hunterVerifiedCount++;
        } else {
          console.log(`  ⊘ ${result}: ${l.email}  [${l.clinicName}]`);
          if (result === "undeliverable") {
            leads[idx].status = "bounced";
            leads[idx].bouncedAt = new Date().toISOString();
            leads[idx].bounceReason = "Hunter verification: undeliverable";
            appendBounceLog({
              email: l.email, clinic: l.clinicName,
              bounceCode: null, date: new Date().toISOString(), source: "hunter-verify"
            });
          }
          hunterSkippedCount++;
        }
      }
      console.log(`Hunter: ${hunterVerifiedCount} deliverable | ${hunterSkippedCount} skipped\n`);
    }
  }

  // ── FILTER 3: email quality ────────────────────────────────────────────────
  let skippedBadEmail = 0;
  const goodEmail = [...highOnly, ...hunterApproved].filter(({ l }) => {
    if (isBadEmail(l.email, { smtpFrom: SMTP_FROM })) {
      console.log(`  ⊘ Skip (bad email format): ${l.email}  [${l.clinicName}]`);
      skippedBadEmail++;
      return false;
    }
    if (l.pilotOutreach === true) return false; // reserved for manual pilot outreach
    return true;
  });

  // ── FILTER 4: dedup — block any email already contacted (ever) + 7-day domain guard ──
  let skippedDomain = 0;
  const dedupedDomain = goodEmail.filter(({ l }) => {
    const addr = (l.email || "").toLowerCase().trim();
    // Exact-email check: if ANY other record with this address has a non-todo status,
    // the clinic has already been contacted regardless of when — skip unconditionally.
    const alreadyContacted = leads.some((other) => {
      if ((other.email || "").toLowerCase().trim() !== addr) return false;
      const s = other.status || "todo";
      return s !== "todo" && other !== l;
    });
    if (alreadyContacted) {
      console.log(`  ⊘ Skip (already contacted): ${l.email}  [${l.clinicName}]`);
      skippedDomain++;
      return false;
    }
    if (recentlySent(leads, l.email, 7)) {
      console.log(`  ⊘ Skip (domain sent < 7 days): ${l.email}  [${l.clinicName}]`);
      skippedDomain++;
      return false;
    }
    return true;
  });

  console.log(`Skipped (dedup — already contacted or domain < 7d): ${skippedDomain}`);
  console.log(`After dedup:                   ${dedupedDomain.length}`);

  // ── Send order: priority score 0-100 (named email, oScore, conf, emailScore, priority, website) ──
  const scored = sortByPriority(dedupedDomain);

  // Saturday mode: re-sort using voicemail-likelihood order from send-queue-saturday.json
  if (SATURDAY) {
    const satQueuePath = path.join(process.cwd(), "data", "send-queue-saturday.json");
    const satQueue = readJsonSafe(satQueuePath, []);
    if (satQueue.length > 0) {
      const satOrder = new Map(satQueue.map((c, i) => [(c.email || "").toLowerCase(), i]));
      scored.sort((a, b) => {
        const ai = satOrder.get((a.l.email || "").toLowerCase());
        const bi = satOrder.get((b.l.email || "").toLowerCase());
        if (ai !== undefined && bi !== undefined) return ai - bi;
        if (ai !== undefined) return -1;
        if (bi !== undefined) return 1;
        return (b.priorityScore || 0) - (a.priorityScore || 0);
      });
      console.log(`  Saturday queue: voicemail-score order (${satQueue.length} ranked)`);
      console.log(`  Top 5: ${scored.slice(0, 5).map(e => {
        const sat = satQueue.find(c => c.email?.toLowerCase() === e.l.email?.toLowerCase());
        return `[${sat?.voicemailScore ?? '?'}vm] ${e.l.email}`;
      }).join(", ")}`);
    }
  } else if (scored.length > 0) {
    console.log(`  Priority scores — top 5: ${scored.slice(0, 5).map(e => `[${e.priorityScore}] ${e.l.email}`).join(", ")}`);
  }

  // ── FILTER 4.5: Send-time optimization — timezone + optimal hour window ────
  // If --tz <zone> is set, only send to clinics in that timezone.
  // Regardless, only send if the clinic's local time is within its optimal window.
  let skippedTz = 0;
  const tzFiltered = scored.filter(({ l }) => {
    if (TZ_FILTER && (l.timezone || "ET") !== TZ_FILTER) {
      skippedTz++;
      return false;
    }
    if (!inSendWindow(l)) {
      skippedTz++;
      return false;
    }
    return true;
  });
  if (skippedTz > 0 || TZ_FILTER || !NO_TZ_GUARD) {
    const nowInfo = TZ_FILTER ? `current ${TZ_FILTER} hour: ${localHourForTimezone(TZ_FILTER)}` : "";
    console.log(`Send-time filter: ${tzFiltered.length} in window, ${skippedTz} outside${TZ_FILTER ? ` (--tz ${TZ_FILTER}, ${nowInfo})` : ""}`);
  }

  // ── FILTER 5: Relevance screen — already equipped? ────────────────────────
  console.log(`\n── Relevance screening (visiting websites) ──`);

  let skippedEquipped = 0;
  let screened = 0;
  const relevant = [];

  for (const entry of tzFiltered) {
    if (relevant.length >= cap) break;
    screened++;

    const { l, idx } = entry;
    const { status: relStatus, signals } = await checkClinicRelevance(l.website);

    if (relStatus === "already_equipped") {
      console.log(`  ⊘ Skip (already equipped): ${l.clinicName}  [${signals.slice(0,2).join(", ")}]`);
      leads[idx].status = "already_equipped";
      leads[idx].equippedSignals = signals;
      leads[idx].equippedCheckedAt = new Date().toISOString();
      skippedEquipped++;
    } else {
      console.log(`  ✓ Needs service:  ${l.clinicName}  [${l.website}]`);
      relevant.push(entry);
    }
  }

  console.log(`\nAlready equipped (skipped): ${skippedEquipped}`);
  console.log(`Needs service (kept):       ${relevant.length}`);

  // ── FILTER 6: MX verification ─────────────────────────────────────────────
  console.log(`\n── MX verification ──`);

  const targets = [];
  for (const entry of relevant) {
    if (targets.length >= cap) break;
    const { valid, reason } = await verifyEmail(entry.l.email);
    if (!valid) {
      console.log(`  ⊘ Skip (MX fail — ${reason}): ${entry.l.email}`);
      leads[entry.idx].status = "skip_bad_email";
      leads[entry.idx].skipReason = reason;
    } else {
      targets.push(entry);
    }
  }

  console.log(`Verified (MX OK): ${targets.length}\n`);

  // ── SEND ──────────────────────────────────────────────────────────────────
  let sent = 0;
  let sentHighPrio = 0;
  let spamSkipped = 0;
  const sentThisRun = new Set();
  const recentSent24h = getRecentSent24h();
  if (recentSent24h.size > 0) {
    console.log(`24h dedup: ${recentSent24h.size} email(s) contacted in last 24h — will skip if seen again\n`);
  }

  for (let i = 0; i < targets.length; i++) {
    const { l, idx } = targets[i];

    // In-run dedup: prevent double-sends when two records share the same email
    const emailKey = (l.email || "").toLowerCase().trim();
    if (sentThisRun.has(emailKey)) {
      console.log(`  ⊘ Skip (duplicate in this run): ${l.email}  [${l.clinicName}]`);
      continue;
    }
    // 24h cross-run dedup: blocks duplicates if two batch runs overlap in time
    if (recentSent24h.has(emailKey)) {
      console.log(`  ⊘ Skip (already sent to ${l.email} in last 24h)`);
      continue;
    }

    const { subject, text, html: emailHtml, variantLabel } = buildEmailContent(l);

    // Spam score gate
    const { score: sScore, triggers } = spamScore(`${subject}\n${text}`);
    if (sScore > SPAM_SCORE_LIMIT) {
      console.log(`  ⊘ Skip (spam score ${sScore}): ${triggers.slice(0, 3).join(", ")}`);
      spamSkipped++;
      continue;
    }

    const pScore = targets[i].priorityScore ?? "?";
    const pBreak = targets[i].scoreBreakdown ?? "";
    console.log(`→ [${i + 1}/${targets.length}] [${pScore}] ${l.clinicName || "(clinic)"}  <${l.email}>`);
    console.log(`  Score: ${pBreak}`);
    console.log(`  Subject: "${subject}"`);

    // ── DRY-RUN: show what would send without actually sending ────────────────
    if (DRY_RUN) {
      const bodyPreview = text.split("\n").filter(l => l.trim()).slice(0, 3).join(" / ");
      console.log(`  [DRY-RUN] variant:${variantLabel} spam:${sScore}`);
      console.log(`  Body preview: "${bodyPreview.slice(0, 120)}…"`);
      sentThisRun.add(emailKey);
      sent++;
      continue;
    }

    try {
      logSpamCheck({ subject, body: text }, l.clinicName);
      await transporter.sendMail({
        from: SMTP_FROM,
        to: l.email,
        subject,
        text,
        html: emailHtml || _toHtml(text, l.clinicName?.toLowerCase().replace(/[^a-z0-9]+/g, '-') || '', variantLabel || ''),
        headers: { 'X-Mailer': 'Google Mail' },
      });

      leads[idx].status = "sent";
      leads[idx].sentAt = new Date().toISOString();
      leads[idx].followupCount = 0;
      leads[idx].priorityScore = targets[i].priorityScore;
      leads[idx].subjectSent = subject;
      leads[idx].variantLabel = variantLabel;
      if (variantLabel === 'VIDEO') {
        leads[idx].videoEmailSent   = true;
        leads[idx].videoEmailSentAt = new Date().toISOString();
      }
      if (variantLabel === 'SIGNAL' || variantLabel === 'SIGNAL-FR') {
        leads[idx].signalEmailSent   = true;
        leads[idx].signalEmailSentAt = new Date().toISOString();
      }
      if (variantLabel === 'REVIEW' || variantLabel === 'REVIEW-FR') {
        leads[idx].reviewEmailSent   = true;
        leads[idx].reviewEmailSentAt = new Date().toISOString();
      }
      recordVariantSend(variantLabel);
      if (l.priority === "high") sentHighPrio++;

      const due = new Date();
      due.setDate(due.getDate() + FOLLOWUP_DELAY_DAYS);
      leads[idx].followupDueAt = due.toISOString();

      const personalizationLevel = l.outreachPlan?.personalizationLevel || (l.reviewPainScore >= 2 ? "HIGH" : "MEDIUM");
      leads[idx].personalizationLevel = personalizationLevel;
      appendEmailLog({ email: l.email, clinic: l.clinicName, status: "sent", sentAt: leads[idx].sentAt, subject, variantLabel, personalizationLevel });
      sentThisRun.add(emailKey);
      incSentToday();
      sent++;
      console.log("  ✓ sent");

      if (i < targets.length - 1) await randomDelay();
    } catch (e) {
      const msg = e?.message || String(e);
      const code = e?.responseCode ?? null;

      if (isSmtpBounce(e)) {
        // Permanent SMTP rejection — mark bounced immediately, never retry
        markBounced(leads, idx, msg, code);
        appendEmailLog({ email: l.email, clinic: l.clinicName, status: "bounced", smtpCode: code, error: msg });
        appendBounceLog({ email: l.email, clinic: l.clinicName, bounceCode: code, date: new Date().toISOString() });
        console.log(`  ✗ BOUNCED (${code ?? "5xx"}): ${msg.slice(0, 120)}`);
        console.log(`    → ${l.clinicName} marked bounced — will not retry`);
      } else {
        // Transient failure — keep status as todo so next run retries
        leads[idx].lastError = msg;
        leads[idx].lastErrorAt = new Date().toISOString();
        appendEmailLog({ email: l.email, clinic: l.clinicName, status: "error", smtpCode: code, error: msg });
        console.log(`  ✗ failed (${code ?? "?"}): ${msg.slice(0, 120)}`);
      }
    }
  }

  if (!DRY_RUN) writeJsonSafe(OUTREACH_PATH, leads);

  console.log("\n══ BATCH COMPLETE ════════════════════════");
  if (DRY_RUN) console.log("  *** DRY-RUN — no emails sent, no files modified ***");
  console.log(`Sent:                  ${sent}  (high-priority: ${sentHighPrio})`);
  console.log(`Spam-skipped:          ${spamSkipped}`);
  console.log(`Already equipped:      ${skippedEquipped}`);
  console.log(`Held (not high conf):  ${skippedLowConf}`);
  console.log(`Daily remaining:       ${Math.max(0, MAX_EMAILS_PER_DAY - getSentToday())}`);
  if (!DRY_RUN) console.log(`Saved → ${OUTREACH_PATH}`);
}

// ─── Entry point guard — only execute when run directly, not when imported ────
import { pathToFileURL } from "url";

const isMain = process.argv[1] &&
  pathToFileURL(process.argv[1]).href === import.meta.url;

if (isMain) {
  // ── CLI: mark a daemon bounce manually ──────────────────────────────────
  // Usage: node src/cli/sendBatch.js --bounce "email@address.com"
  //        node src/cli/sendBatch.js --bounce "email@address.com" --reason "550 user unknown"
  const bounceFlag = process.argv.indexOf("--bounce");
  if (bounceFlag !== -1) {
    const emailArg = process.argv[bounceFlag + 1];
    const reasonFlag = process.argv.indexOf("--reason");
    const reasonArg = reasonFlag !== -1 ? process.argv[reasonFlag + 1] : "async daemon bounce";
    if (!emailArg || emailArg.startsWith("--")) {
      console.error('Usage: node src/cli/sendBatch.js --bounce "email@domain.com" [--reason "reason"]');
      process.exit(1);
    }
    markBouncedByEmail(emailArg, reasonArg);
  } else {
    main().catch((e) => {
      console.error("Send batch failed:", e?.message || e);
      process.exit(1);
    });
  }
}
