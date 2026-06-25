// src/cli/sendFollowups.js
// 3-stage follow-up system.
// FU1 (day 4): casual check-in referencing the first email
// FU2 (day 9): adds a new piece of value (a quick tip)
// FU3 (day 16): graceful final exit
// Never sends more than 3 follow-ups per clinic.

import fs from "fs";
import path from "path";
import dotenv from "dotenv";
import nodemailer from "nodemailer";
import { extractGreetingName, cleanClinicName } from "../services/emailPersonalizer.js";
import { logSpamCheck } from "../services/spamChecker.js";
import { buildPilotEmail } from "../templates/pilotOffer.js";

dotenv.config();

function _toHtml(text, clinicSlug = '', variantLabel = '') {
  const escaped = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const lines = escaped.split("\n").map(l => l === "" ? "<br>" : `<span>${l}</span><br>`).join("\n");
  const pixel = clinicSlug
    ? `<img src="https://clinicflowautomation.com/.netlify/functions/open?c=${encodeURIComponent(clinicSlug)}&v=${encodeURIComponent(variantLabel)}" width="1" height="1" style="display:none;border:0" alt="">`
    : '';
  return `<div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.6;color:#222;max-width:600px">${lines}${pixel}</div>`;
}

// ─── Config ──────────────────────────────────────────────────────────────────

const OUTREACH_PATH =
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

const TLS_REJECT_UNAUTHORIZED =
  (process.env.SMTP_TLS_REJECT_UNAUTHORIZED || "true").toLowerCase() !== "false";

const MAX_EMAILS_PER_DAY   = Number(process.env.MAX_EMAILS_PER_DAY        || "55");
const MAX_FOLLOWUP_PER_DAY = Number(process.env.MAX_FOLLOWUP_PER_DAY      || "25");
const MAX_PER_RUN          = Number(process.env.FOLLOWUP_MAX_PER_RUN      || "25");
const SENDER_NAME = (process.env.SENDER_NAME || "Mohamed").trim();

// Days after initial sentAt when each follow-up fires
const FOLLOWUP_DAYS = [0, 4, 9, 16]; // index 1 = FU1, index 2 = FU2, index 3 = FU3

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

function appendEmailLog(entry) {
  const log = readJsonSafe(EMAIL_LOG_PATH, []);
  log.push({ ...entry, loggedAt: new Date().toISOString() });
  writeJsonSafe(EMAIL_LOG_PATH, log);
}

// ─── 24h cross-run dedup ─────────────────────────────────────────────────────
// Reads smtp.emaillog.json and returns a Set of email addresses contacted in
// the last 24 hours. Prevents duplicate follow-ups if two runs overlap.
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

function getSentToday() {
  const log = readJsonSafe(SEND_LOG_PATH, {});
  return Number(log[todayKey()] || 0);
}

function getSentTodayFollowup() {
  const log = readJsonSafe(SEND_LOG_PATH, {});
  return Number(log[todayKey() + "_fu"] || 0);
}

function incSentToday() {
  const log = readJsonSafe(SEND_LOG_PATH, {});
  const k = todayKey();
  log[k]          = Number(log[k]          || 0) + 1;
  log[k + "_fu"]  = Number(log[k + "_fu"]  || 0) + 1;
  writeJsonSafe(SEND_LOG_PATH, log);
}

function remainingToday() {
  // Respect both the follow-up specific cap and the daily total cap.
  const fuRemaining    = Math.max(0, MAX_FOLLOWUP_PER_DAY - getSentTodayFollowup());
  const totalRemaining = Math.max(0, MAX_EMAILS_PER_DAY   - getSentToday());
  return Math.min(fuRemaining, totalRemaining);
}

function isBadEmail(email) {
  const e = String(email || "").trim().toLowerCase();
  if (!e) return true;
  const blocked = ["noreply", "no-reply", "donotreply", "example.com", "wixpress.com"];
  const blockedExact = [
    SMTP_FROM.toLowerCase(),
    SMTP_USER.toLowerCase(),
    "contact@ore.urg",
  ].filter(Boolean);
  if (blockedExact.includes(e)) return true;
  if (blocked.some((b) => e.includes(b))) return true;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e)) return true;
  return false;
}

// ─── Follow-up scheduling ─────────────────────────────────────────────────────

/**
 * Returns which follow-up number should be sent next, or null if done.
 * followupCount 0 → next is FU1
 * followupCount 1 → next is FU2
 * followupCount 2 → next is FU3
 * followupCount 3 → done
 */
function nextFollowupNum(lead) {
  const count = Number(lead.followupCount ?? 0);
  if (count >= 3) return null;
  return count + 1;
}

/**
 * Returns true if the nth follow-up is due.
 * FU1/FU2: days from initial sentAt.
 * FU3: 14 days after followup2SentAt (falls back to day 16 from sentAt).
 */
function isDue(lead, num) {
  if (num === 3) {
    const fu2At = Date.parse(String(lead.followup2SentAt || ""));
    if (Number.isFinite(fu2At)) {
      return Date.now() >= fu2At + 14 * 24 * 60 * 60 * 1000;
    }
    // fallback: 16 days from sentAt
  }
  const sentAt = Date.parse(String(lead.sentAt || ""));
  if (!Number.isFinite(sentAt)) return false;
  const delayDays = FOLLOWUP_DAYS[num] || 0;
  const dueMs = sentAt + delayDays * 24 * 60 * 60 * 1000;
  return Date.now() >= dueMs;
}

// ─── Email content ────────────────────────────────────────────────────────────

function buildFollowup1({ clinicName, city, email, senderName }) {
  const name      = clinicName || "your clinic";
  const greetName = extractGreetingName(email || "");
  const greeting  = greetName ? `Hi ${greetName},` : "Hi,";
      return {
    subject: `Still worth a look — ${name}?`,
    body: `${greeting}

The short version of what I do: when a patient calls ${name} and no one picks up, they get an automatic text within 60 seconds keeping them engaged. Most clinics recover 4–6 patients a month they were otherwise losing to voicemail.

5-day setup. No monthly fees. You see it working before paying the second half.

Worth a look?

${senderName}
ClinicFlow Automation · Montreal, QC · Canada`,
  };
}

function buildFollowup2({ clinicName, email, senderName }) {
  const name      = clinicName || "your clinic";
  const greetName = extractGreetingName(email || "");
  const greeting  = greetName ? `Hi ${greetName},` : "Hi,";
      return {
    subject: `${name} — one thing I didn't mention`,
    body: `${greeting}

One thing I didn't mention in my last email:

Most dental clinics have 50–200 patients who haven't booked in over 12 months and haven't been contacted. A simple reactivation campaign typically brings back 10–20% of them in the first 30 days.

I include this as part of the Growth package — no extra cost, no extra work on your end.

Still happy to take a look at ${name}'s setup if timing is right.

${senderName}
ClinicFlow Automation · Montreal, QC · Canada`,
  };
}

function buildFollowup3({ clinicName, email, senderName }) {
  const name      = clinicName || "your clinic";
  const greetName = extractGreetingName(email || "");
  const greeting  = greetName ? `Hi ${greetName},` : "Hi,";
      return {
    subject: `${name} — last note`,
    body: `${greeting}

Last email from me on this.

If unanswered calls and inactive patients aren't a priority right now, no problem at all. I'll leave it here.

If it ever becomes relevant — a slow month, a new front desk hire, a push to grow — just reply and I'll pick it up same day.

${senderName}
ClinicFlow Automation · Montreal, QC · Canada`,
  };
}

function buildFollowupEmail(lead, num) {
  const opts = {
    clinicName: cleanClinicName(lead.clinicName || lead.name),
    city:       lead.city || "",
    email:      lead.email || "",
    website:    lead.website || "",
    senderName: SENDER_NAME,
  };

  // FU1 smart routing: clinics that opened but didn't reply get the pilot offer
  // "opened" is set when the tracking pixel fires or the signal dashboard syncs opens
  if (num === 1 && !lead.pilotOfferSent) {
    const hasOpened = !!(lead.openedAt || lead.emailOpened || lead.emailOpenedAt ||
                         lead.opened || lead.hasHuman || lead.hasMobile);
    const hasPainSignal = (lead.painSignals || []).length > 0;
    const isNamedEmail  = (() => {
      const local = (lead.email || '').split('@')[0].toLowerCase();
      return local.length > 2 && local.length < 20 && !/\d{3}/.test(local) &&
        !['info','contact','hello','admin','office','reception','front','booking',
          'appointment','dental','clinic','welcome'].includes(local);
    })();
    if (hasOpened || hasPainSignal || isNamedEmail) {
      const pilot = buildPilotEmail({ ...lead, clinicName: opts.clinicName, city: opts.city });
      return { ...pilot, _isPilotOffer: true };
    }
  }

  if (num === 1) return buildFollowup1(opts);
  if (num === 2) return buildFollowup2(opts);
  if (num === 3) return buildFollowup3(opts);
  return null;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

const LOCK_PATH = path.join(process.cwd(), "data", "sendFollowups.lock");

function acquireLock() {
  const now = Date.now();
  try {
    if (fs.existsSync(LOCK_PATH)) {
      const age = now - Number(fs.readFileSync(LOCK_PATH, "utf-8").trim() || 0);
      if (age < 10 * 60 * 1000) {
        console.log(`sendFollowups already running (lock age ${Math.round(age/1000)}s). Exiting.`);
        process.exit(0);
      }
      fs.unlinkSync(LOCK_PATH); // stale lock (>10 min)
    }
    fs.writeFileSync(LOCK_PATH, String(now), "utf-8");
    return true;
  } catch { return false; }
}

function releaseLock() {
  try { fs.unlinkSync(LOCK_PATH); } catch { /* already gone */ }
}

async function main() {
  if (!acquireLock()) { console.log("Could not acquire lock. Exiting."); process.exit(0); }

  if (!SMTP_HOST || !SMTP_PORT || !SMTP_USER || !SMTP_PASS) {
    releaseLock();
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
  console.log("✅ SMTP verify OK");

  const leads = readJsonSafe(OUTREACH_PATH, []);
  if (!Array.isArray(leads) || leads.length === 0) {
    console.log("No leads found at:", OUTREACH_PATH);
    process.exit(0);
  }

  // ── Cooling-off reset: promote records whose 60-day window has expired ────
  const COOLING_OFF_DAYS = 60;
  let resetCount = 0;
  const now = Date.now();
  for (let i = 0; i < leads.length; i++) {
    const l = leads[i];
    if (l.status !== "cooling_off") continue;
    const until = l.coolingOffUntil ? new Date(l.coolingOffUntil).getTime() : 0;
    if (now >= until) {
      leads[i].status = "todo";
      leads[i].followupCount = 0;
      leads[i].sentAt = "";
      leads[i].subjectSent = "";
      delete leads[i].followupDueAt;
      delete leads[i].followup1SentAt;
      delete leads[i].followup2SentAt;
      delete leads[i].followup3SentAt;
      delete leads[i].coolingOffUntil;
      leads[i].coolingOffResetAt = new Date().toISOString();
      resetCount++;
    }
  }
  if (resetCount > 0) {
    console.log(`♻  Cooling-off reset: ${resetCount} clinic(s) returned to todo after 60-day pause`);
  }

  const remaining = remainingToday();
  const cap = Math.min(remaining, MAX_PER_RUN);

  console.log(`Today: ${todayKey()} | Sent today: ${getSentToday()} | Cap: ${cap}`);
  if (cap <= 0) {
    console.log("Daily limit reached. Exiting.");
    process.exit(0);
  }

  // Find leads that need a follow-up sent now
  const due = [];
  const seenFollowupEmails = new Set(); // dedup: never send two follow-ups to same address in one run
  const recentSent24h = getRecentSent24h(); // cross-run dedup: block if sent to this address in last 24h
  if (recentSent24h.size > 0) {
    console.log(`24h dedup: ${recentSent24h.size} email(s) contacted in last 24h — will skip if seen again`);
  }
  for (let idx = 0; idx < leads.length; idx++) {
    const l = leads[idx];
    if (due.length >= cap) break;

    // Must have been initially sent
    if (!["sent", "followup_1_sent", "followup_2_sent"].includes(l.status)) continue;
    if (l.name_needs_review) continue;  // hold until name is manually fixed
    if (isBadEmail(l.email)) continue;

    const num = nextFollowupNum(l);
    if (!num) continue;      // already completed all 3
    if (!isDue(l, num)) continue;  // not time yet

    // Skip if another record with the same email is already queued this run
    const emailKey = (l.email || "").toLowerCase().trim();
    if (seenFollowupEmails.has(emailKey)) {
      console.log(`  ⊘ Skip (duplicate email in run): ${l.email}  [${l.clinicName}]`);
      continue;
    }
    // 24h cross-run dedup: skip if this address was already emailed in the last 24h
    if (recentSent24h.has(emailKey)) {
      console.log(`  ⊘ Skip (already sent to ${l.email} in last 24h)`);
      continue;
    }
    seenFollowupEmails.add(emailKey);

    due.push({ idx, l, num });
  }

  console.log(`Follow-ups due: ${due.length} (cap ${cap})`);
  if (due.length === 0) {
    console.log("Nothing due. Exiting.");
    process.exit(0);
  }

  let sent = 0;

  for (const { idx, l, num } of due) {
    const email = buildFollowupEmail(l, num);
    if (!email) continue;

    console.log(`\n→ FU${num}: ${l.clinicName || "(clinic)"} <${l.email}>`);
    console.log(`  Subject: "${email.subject}"`);

    try {
      logSpamCheck({ subject: email.subject, body: email.body }, l.clinicName);
      await transporter.sendMail({
        from: SMTP_FROM,
        to: l.email,
        subject: email.subject,
        text: email.body,
        html: _toHtml(email.body, l.clinicName?.toLowerCase().replace(/[^a-z0-9]+/g, '-') || '', `FU${num}`),
      });

      leads[idx].followupCount = num;
      leads[idx][`followup${num}SentAt`] = new Date().toISOString();
      leads[idx].variantLabel = `FU${num}`;
      if (email._isPilotOffer) {
        leads[idx].pilotOfferSent   = true;
        leads[idx].pilotOfferSentAt = new Date().toISOString();
        console.log(`  → Routed to PILOT OFFER (opened/named/pain signal)`);
      }
      if (num >= 3) {
        leads[idx].status = "cooling_off";
        const until = new Date();
        until.setDate(until.getDate() + 60);
        leads[idx].coolingOffUntil = until.toISOString();
        leads[idx].coolingOffStartedAt = new Date().toISOString();
      } else {
        leads[idx].status = `followup_${num}_sent`;
      }
      leads[idx].lastError = "";

      appendEmailLog({
        email:       l.email,
        clinic:      l.clinicName,
        status:      "sent",
        type:        `followup_${num}`,
        subject:     email.subject,
        sentAt:      leads[idx][`followup${num}SentAt`],
        variantLabel: `FU${num}`,
      });
      incSentToday();
      sent++;
      const statusLabel = leads[idx].status === "cooling_off"
        ? `cooling_off (resumes ${leads[idx].coolingOffUntil?.slice(0,10)})`
        : leads[idx].status;
      console.log(`  ✓ FU${num} sent — status → ${statusLabel}`);
    } catch (e) {
      const msg  = e?.message || String(e);
      const code = e?.responseCode ?? null;
      leads[idx].lastError   = msg;
      leads[idx].lastErrorAt = new Date().toISOString();
      appendEmailLog({
        email:   l.email,
        clinic:  l.clinicName,
        status:  "error",
        type:    `followup_${num}`,
        subject: email.subject,
        smtpCode: code,
        error:   msg.slice(0, 120),
      });
      console.log(`  ✗ failed (${code ?? "?"}): ${msg.slice(0, 120)}`);
    }
  }

  writeJsonSafe(OUTREACH_PATH, leads);
  releaseLock();
  console.log(`\nDone. Follow-ups sent: ${sent}. Updated → ${OUTREACH_PATH}`);
}

main().catch((e) => {
  releaseLock();
  console.error("Follow-ups failed:", e?.message || e);
  process.exit(1);
});
