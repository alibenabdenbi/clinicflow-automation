// src/services/replyHandler.js
// Checks contact@clinicflowautomation.com inbox via IMAP for clinic replies.
// Classifies intent, drafts a response from replyTemplates.js, saves draft,
// and sends a notification email to the operator.
//
// Run manually:  node src/services/replyHandler.js
// Scheduled:     every 30 minutes via scheduler.js

import fs from "fs";
import path from "path";
import { ImapFlow } from "imapflow";
import nodemailer from "nodemailer";
import dotenv from "dotenv";
import { pathToFileURL } from "url";
import Anthropic from "@anthropic-ai/sdk";

import {
  fill,
  TELL_ME_MORE,
  HOW_MUCH,
  NOT_INTERESTED,
  ALREADY_HAVE_SYSTEM,
  AUDIT_YES,
} from "../templates/replyTemplates.js";

import { handleIntake } from "./intakeHandler.js";

import { sendSMS } from "./smsService.js";

dotenv.config();

// ─── Config ──────────────────────────────────────────────────────────────────

const IMAP_HOST     = process.env.IMAP_HOST     || "imap.zoho.com";
const IMAP_PORT     = Number(process.env.IMAP_PORT || "993");
const IMAP_USER     = process.env.IMAP_USER     || process.env.SMTP_USER || "";
const IMAP_PASS     = process.env.IMAP_PASS     || process.env.SMTP_PASS || "";

const SMTP_HOST     = (process.env.SMTP_HOST || "").trim();
const SMTP_PORT     = Number(process.env.SMTP_PORT || "587");
const SMTP_USER     = (process.env.SMTP_USER || "").trim();
const SMTP_PASS     = (process.env.SMTP_PASS || "").trim();
const SMTP_FROM     = (process.env.SMTP_FROM || SMTP_USER).trim();

const NOTIFY_EMAIL  = process.env.NOTIFY_EMAIL  || "m.aliben432@gmail.com";
const NOTIFY_PHONE  = process.env.NOTIFY_PHONE  || "+15149617077";

const OUTREACH_PATH       = process.env.OUTREACH_JSON_PATH
  || path.join(process.cwd(), "data", "outreach.localDentists.json");
const DRAFTS_DIR          = path.join(process.cwd(), "data", "reply-drafts");
const SEEN_PATH           = path.join(process.cwd(), "data", "imap-seen.json");
const SMS_LOG_PATH        = path.join(process.cwd(), "data", "sms.replies.json");
const FOLLOWUP_QUEUE_PATH = path.join(process.cwd(), "data", "follow-up-queue.json");

const ANTHROPIC_KEY = (process.env.ANTHROPIC_API_KEY || "").trim();
const anthropic = ANTHROPIC_KEY ? new Anthropic({ apiKey: ANTHROPIC_KEY }) : null;

// ─── Intent classification ────────────────────────────────────────────────────

// Regex fallback rules (used when ANTHROPIC_API_KEY is not set or API fails)
const REGEX_RULES = [
  {
    intent: "OUT_OF_OFFICE",
    confidence: "high",
    template: null,
    patterns: [/out of office/i, /away from (the )?office/i, /on vacation/i, /on leave/i, /\baway\b.*\bback\b/i, /\bback on\b/i, /\bback in\b/i, /automatic reply/i, /auto.?reply/i, /\bOOO\b/],
  },
  {
    intent: "HOW_MUCH",
    confidence: "high",
    template: HOW_MUCH,
    patterns: [/how much/i, /\bpric(e|ing|es)\b/i, /\bcost\b/i, /\bquote\b/i, /\bfee\b/i, /\brates?\b/i],
  },
  {
    intent: "AUDIT_YES",
    confidence: "high",
    template: AUDIT_YES,
    patterns: [/^\s*yes\s*[.!]?\s*$/i, /\bsure\b/i, /\bgo ahead\b/i, /\bsounds good\b/i, /\binterested\b/i, /^\s*ok(ay)?\s*[.!]?\s*$/i, /\bplease\b/i, /\bwhy not\b/i, /sounds interesting/i, /tell me more/i, /learn more/i],
  },
  {
    intent: "NOT_INTERESTED",
    confidence: "high",
    template: NOT_INTERESTED,
    patterns: [/not interested/i, /no thanks/i, /no thank you/i, /\bremove\b/i, /unsubscribe/i, /stop emailing/i, /please don.t/i, /don.t contact/i, /we.re (happy|good) with/i],
  },
  {
    intent: "ALREADY_HAVE_SYSTEM",
    confidence: "high",
    template: ALREADY_HAVE_SYSTEM,
    patterns: [/we already have/i, /we use/i, /we have a system/i, /already using/i, /already set up/i, /already got/i],
  },
];

// Map intent string → template object
const TEMPLATE_MAP = {
  HOW_MUCH,
  AUDIT_YES,
  TELL_ME_MORE,
  NOT_INTERESTED,
  ALREADY_HAVE_SYSTEM,
};

function regexClassify(subject, body) {
  const text = `${subject}\n${body}`;
  for (const rule of REGEX_RULES) {
    if (rule.patterns.some((p) => p.test(text))) {
      return { intent: rule.intent, confidence: rule.confidence, template: rule.template, source: "regex" };
    }
  }
  return { intent: "NEEDS_REVIEW", confidence: "low", template: null, source: "regex" };
}

// Extract return date from OUT_OF_OFFICE messages
function extractReturnDate(text) {
  const patterns = [
    /\b(?:back|return(?:ing)?|available)\s+(?:on\s+)?([A-Z][a-z]+\s+\d{1,2}(?:,?\s+\d{4})?)/i,
    /\b(?:back|return(?:ing)?)\s+(?:on\s+)?(\d{1,2}[\/\-]\d{1,2}(?:[\/\-]\d{2,4})?)/i,
    /\buntil\s+([A-Z][a-z]+\s+\d{1,2}(?:,?\s+\d{4})?)/i,
    /\buntil\s+(\d{1,2}[\/\-]\d{1,2}(?:[\/\-]\d{2,4})?)/i,
  ];
  for (const re of patterns) {
    const m = text.match(re);
    if (m) return m[1].trim();
  }
  return null;
}

// Save OUT_OF_OFFICE entry to follow-up queue
function scheduleFollowUp({ fromEmail, clinicName, returnDate, originalBody }) {
  let followUpDate;
  if (returnDate) {
    try {
      const d = new Date(returnDate);
      if (!isNaN(d.getTime())) {
        d.setDate(d.getDate() + 2); // 2 days after return
        followUpDate = d.toISOString().slice(0, 10);
      }
    } catch {}
  }
  if (!followUpDate) {
    // Default: follow up in 2 weeks
    const d = new Date();
    d.setDate(d.getDate() + 14);
    followUpDate = d.toISOString().slice(0, 10);
  }

  let queue = [];
  try { queue = JSON.parse(fs.readFileSync(FOLLOWUP_QUEUE_PATH, "utf-8")); } catch {}
  if (!Array.isArray(queue)) queue = [];

  // Don't duplicate
  if (!queue.some(e => e.fromEmail === fromEmail)) {
    queue.push({
      fromEmail,
      clinicName,
      returnDate: returnDate || null,
      followUpDate,
      scheduledAt: new Date().toISOString(),
      originalBody: (originalBody || "").slice(0, 300),
      done: false,
    });
    try {
      fs.mkdirSync(path.dirname(FOLLOWUP_QUEUE_PATH), { recursive: true });
      fs.writeFileSync(FOLLOWUP_QUEUE_PATH, JSON.stringify(queue, null, 2), "utf-8");
    } catch {}
  }
  return followUpDate;
}

async function claudeClassify(subject, body) {
  if (!anthropic) return null;
  try {
    const emailBody = `Subject: ${subject}\n\n${body}`.slice(0, 1500);
    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 500,
      messages: [{
        role: "user",
        content: `Classify this reply to a cold email about a complimentary communication setup check for a dental clinic.

Reply: "${emailBody}"

Return JSON only:
{
  "intent": "AUDIT_YES|HOW_MUCH|NOT_INTERESTED|ALREADY_HAVE_SYSTEM|REFERRAL_REQUEST|OUT_OF_OFFICE|NEEDS_REVIEW",
  "confidence": "high|medium|low",
  "keyPhrase": "the most important phrase that determined intent",
  "suggestedResponse": "one sentence on how to respond"
}`,
      }],
    });

    const raw = response.content?.[0]?.text || "";
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;
    const parsed = JSON.parse(jsonMatch[0]);

    const validIntents = ["AUDIT_YES", "HOW_MUCH", "NOT_INTERESTED", "ALREADY_HAVE_SYSTEM", "REFERRAL_REQUEST", "OUT_OF_OFFICE", "NEEDS_REVIEW", "TELL_ME_MORE"];
    if (!validIntents.includes(parsed.intent)) return null;

    return {
      intent: parsed.intent,
      confidence: parsed.confidence || "medium",
      template: TEMPLATE_MAP[parsed.intent] || null,
      keyPhrase: parsed.keyPhrase || null,
      suggestedResponse: parsed.suggestedResponse || null,
      source: "claude",
    };
  } catch (e) {
    const msg = e?.message || String(e);
    const isBillingError = e?.status === 402 || e?.status === 529 ||
      /credit|billing|payment|quota|overloaded/i.test(msg);
    if (isBillingError) {
      console.warn("  Claude classification unavailable — using regex fallback");
    } else {
      console.warn(`  Claude classify failed: ${msg} — falling back to regex`);
    }
    return null;
  }
}

async function classifyIntent(subject, body) {
  // Try Claude API first
  const claudeResult = await claudeClassify(subject, body);
  if (claudeResult) return claudeResult;
  // Fallback to regex
  return regexClassify(subject, body);
}

// ─── Clinic lookup ────────────────────────────────────────────────────────────

function loadOutreach() {
  try {
    return JSON.parse(fs.readFileSync(OUTREACH_PATH, "utf-8"));
  } catch {
    return [];
  }
}

function findClinicByEmail(fromEmail, records) {
  const domain = (fromEmail || "").split("@")[1]?.toLowerCase();
  if (!domain) return null;

  // Exact email match first
  let match = records.find(
    (r) => (r.email || "").toLowerCase() === fromEmail.toLowerCase()
  );
  if (match) return match;

  // Domain match (their reply might come from a different local part)
  match = records.find((r) => {
    const d = (r.email || "").split("@")[1]?.toLowerCase();
    return d && d === domain;
  });
  return match || null;
}

// ─── Draft persistence ────────────────────────────────────────────────────────

function saveDraft(draft) {
  fs.mkdirSync(DRAFTS_DIR, { recursive: true });
  const safeDate = new Date().toISOString().slice(0, 10);
  const safeName = (draft.clinicName || draft.fromEmail || "unknown")
    .replace(/[^a-z0-9]/gi, "_")
    .toLowerCase()
    .slice(0, 40);
  const ts = Date.now(); // unique per-message to prevent collisions
  const filename = `${safeDate}-${safeName}-${ts}.json`;
  const outPath = path.join(DRAFTS_DIR, filename);
  fs.writeFileSync(outPath, JSON.stringify(draft, null, 2), "utf-8");
  return outPath;
}

// ─── Seen message tracking ────────────────────────────────────────────────────

function loadSeen() {
  try { return new Set(JSON.parse(fs.readFileSync(SEEN_PATH, "utf-8"))); }
  catch { return new Set(); }
}

function saveSeen(seen) {
  fs.mkdirSync(path.dirname(SEEN_PATH), { recursive: true });
  fs.writeFileSync(SEEN_PATH, JSON.stringify([...seen]), "utf-8");
}

// ─── SMTP notify ──────────────────────────────────────────────────────────────

async function sendNotification({ clinicName, intent, confidence, draftPath, fromEmail, originalBody, draftBody }) {
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) {
    console.warn("  SMTP not configured — skipping notification email");
    return;
  }
  const transporter = nodemailer.createTransport({
    host: SMTP_HOST, port: SMTP_PORT, secure: SMTP_PORT === 465,
    auth: { user: SMTP_USER, pass: SMTP_PASS },
    tls: { rejectUnauthorized: false },
  });

  const displayName = clinicName && clinicName !== "unknown" ? clinicName : fromEmail;

  // ── AUDIT_YES gets a dedicated notification format ─────────────────────────
  if (intent === "INTAKE") {
    const subject = `Onboarding intake from ${displayName}`;
    const text = draftBody || "(see data/clients/ for extracted files)";
    const fromHeader = `Mohamed - ClinicFlow <${SMTP_FROM}>`;
    await transporter.sendMail({ from: fromHeader, to: NOTIFY_EMAIL, subject, text });
    return;
  }

  if (intent === "AUDIT_YES") {
    const subject = `Audit request from ${displayName} — send them the 3 questions`;
    const text = [
      `${displayName} replied yes to your audit offer.`,
      ``,
      `From:    ${displayName} <${fromEmail}>`,
      ``,
      `Their message:`,
      `─────────────────────────`,
      originalBody || "(no body captured)",
      `─────────────────────────`,
      ``,
      `Draft 3-question reply (ready to send):`,
      `─────────────────────────`,
      draftBody || "(draft not available)",
      `─────────────────────────`,
      ``,
      `Draft saved to:`,
      draftPath,
      ``,
      `---`,
      `Mohamed - ClinicFlow`,
      `contact@clinicflowautomation.com`,
    ].join("\n");
    const fromHeader = `Mohamed - ClinicFlow <${SMTP_FROM}>`;
    await transporter.sendMail({ from: fromHeader, to: NOTIFY_EMAIL, subject, text });
    return;
  }

  // ── Standard notification for all other intents ────────────────────────────
  const actionLabel = confidence === "high" ? "Draft reply ready to send" : "Needs manual review";
  const subject = `Reply from ${displayName} — ${actionLabel}`;

  const intentLabels = {
    HOW_MUCH:           "Asking about pricing",
    TELL_ME_MORE:       "Wants more information",
    NOT_INTERESTED:     "Not interested",
    ALREADY_HAVE_SYSTEM:"Already has a system",
    NEEDS_REVIEW:       "Could not be classified",
  };
  const intentLabel = intentLabels[intent] || intent;

  const text = [
    `A clinic has replied to your outreach.`,
    ``,
    `From:    ${displayName} <${fromEmail}>`,
    `Intent:  ${intentLabel}`,
    ``,
    confidence === "high"
      ? `A draft reply has been prepared. Review it and send manually when ready.`
      : `This reply was not matched automatically. Read it and reply directly.`,
    ``,
    `Draft saved to:`,
    draftPath,
    ``,
    `---`,
    `Mohamed - ClinicFlow`,
    `contact@clinicflowautomation.com`,
  ].join("\n");

  const fromHeader = `Mohamed - ClinicFlow <${SMTP_FROM}>`;
  await transporter.sendMail({ from: fromHeader, to: NOTIFY_EMAIL, subject, text });
}

// ─── Message processor (shared across mailboxes) ──────────────────────────────

async function processMailbox(client, mailboxName, since, records, seen, drafts) {
  try {
    await client.mailboxOpen(mailboxName);
  } catch {
    // Mailbox doesn't exist on this server — skip silently
    console.log(`  Mailbox "${mailboxName}" not found — skipping`);
    return;
  }

  const SYSTEM_LOCAL = ["mailer-daemon", "postmaster", "noreply", "no-reply", "donotreply", "do-not-reply", "bounce", "notifications", "notification", "daemon"];
  const SYSTEM_SUBJECTS = [
    /^\[clinicflow/i,
    /smtp test/i,
    /undelivered mail/i,
    /undeliverable/i,
    /mail delivery/i,
    /delivery status/i,
    /delivery notification/i,
    /delivery failure/i,
    /returned to sender/i,
    /message not delivered/i,
    /non.?delivery/i,
    /mail system error/i,
    /auto.?reply/i,
    /out of office/i,
    /automatic reply/i,
    /\bfailure notice\b/i,
  ];

  for await (const msg of client.fetch({ since }, { envelope: true, source: true })) {
    const msgId = msg.envelope?.messageId || `${mailboxName}:${msg.seq}`;
    if (seen.has(msgId)) continue;
    seen.add(msgId);

    const fromAddr = msg.envelope?.from?.[0];
    const fromEmail = fromAddr
      ? `${fromAddr.mailbox}@${fromAddr.host}`.toLowerCase()
      : null;

    if (!fromEmail || fromEmail.startsWith("undefined@") || fromEmail === "@") {
      console.log(`  [${mailboxName}] Skipped: unparseable sender`);
      continue;
    }

    const subject = msg.envelope?.subject || "";
    const fromDomain = fromEmail.split("@")[1]?.toLowerCase() || "";

    // Skip own addresses — outbound domain, SMTP sender, personal Gmail, Zoho system
    const ownAddresses = new Set([
      SMTP_FROM.toLowerCase(),
      SMTP_USER.toLowerCase(),
      IMAP_USER.toLowerCase(),
      (NOTIFY_EMAIL || "").toLowerCase(),
    ].filter(Boolean));
    if (fromDomain === "clinicflowautomation.com" || ownAddresses.has(fromEmail)) {
      console.log(`  [${mailboxName}] Skipped own sender: ${fromEmail}`);
      continue;
    }

    const fromLocal = fromEmail.split("@")[0].toLowerCase();
    if (SYSTEM_LOCAL.some((s) => fromLocal.includes(s))) {
      console.log(`  [${mailboxName}] Skipped system sender: ${fromEmail}`);
      continue;
    }

    if (SYSTEM_SUBJECTS.some((r) => r.test(subject))) {
      console.log(`  [${mailboxName}] Skipped system subject: "${subject}"`);
      continue;
    }

    const rawSource = msg.source?.toString("utf-8") || "";
    const bodyMatch = rawSource.match(/\r?\n\r?\n([\s\S]+)/);
    const body = bodyMatch ? bodyMatch[1].slice(0, 2000) : rawSource.slice(0, 2000);

    const clinic = findClinicByEmail(fromEmail, records);
    // Derive a readable clinic name from the email domain when no record is found
    const clinicName = clinic?.clinicName || clinic?.name || (() => {
      const domain = fromEmail.split("@")[1] || "";
      const base = domain.split(".")[0] || fromEmail.split("@")[0];
      const derived = base
        .replace(/[-_]+/g, " ")
        .replace(/([a-z])([A-Z])/g, "$1 $2")
        .replace(/\b\w/g, c => c.toUpperCase())
        .trim();
      if (!derived || /^undefined$/i.test(derived)) return `Unknown Clinic — ${fromEmail}`;
      return derived;
    })();
    const city = clinic?.city || "";

    // ── Onboarding intake check — runs before standard classification ─────────
    // If email is from a known client in onboarding status, handle as intake.
    // Parse any attachments from raw source for CSV detection.
    const attachments = [];
    const attachMatches = [...rawSource.matchAll(/Content-Disposition:\s*attachment[^\r\n]*\r?\nContent-Type:\s*([^\r\n]+)/gi)];
    for (const m of attachMatches) {
      const fnMatch = rawSource.match(/filename[*=]+["']?([^"'\r\n;]+)/i);
      attachments.push({ filename: fnMatch?.[1] || "", contentType: m[1].trim(), content: "" });
    }
    // Also check for CSV inline content (base64 or plaintext between MIME boundaries)
    const csvInline = rawSource.match(/Content-Type:\s*text\/csv[^\r\n]*\r?\n[\s\S]*?\r?\n\r?\n([\s\S]+?)(?=--|\r?\n--)/i);
    if (csvInline) {
      attachments.push({ filename: "patients.csv", contentType: "text/csv", content: csvInline[1] });
    }

    const intake = await handleIntake({
      fromEmail,
      subject,
      body,
      attachments,
      allRecords: records,
    });

    if (intake.handled) {
      console.log(`  [${mailboxName}][INTAKE] ${clinicName} <${fromEmail}> — ${intake.summary}`);
      // Notify operator about intake
      if (intake.notifyMessage) {
        try {
          await sendNotification({
            clinicName,
            intent: "INTAKE",
            confidence: "high",
            draftPath: "(intake handled — see data/clients/)",
            fromEmail,
            originalBody: body.slice(0, 500),
            draftBody: intake.notifyMessage,
          });
          console.log(`    → Intake notification sent to ${NOTIFY_EMAIL}`);
        } catch (e) {
          console.warn(`    → Intake notification failed: ${e.message}`);
        }
      }
      // Mark seen and continue — don't run standard classification
      seen.add(msgId);
      continue;
    }

    const { intent, confidence, template, source: classifySource, keyPhrase, suggestedResponse } = await classifyIntent(subject, body);

    // Handle OUT_OF_OFFICE — schedule a follow-up and skip drafting a reply
    if (intent === "OUT_OF_OFFICE") {
      const returnDate = extractReturnDate(`${subject}\n${body}`);
      const followUpDate = scheduleFollowUp({ fromEmail, clinicName, returnDate, originalBody: body.slice(0, 300) });
      console.log(`  [${mailboxName}][OUT_OF_OFFICE] ${clinicName} <${fromEmail}> — follow-up scheduled ${followUpDate}${returnDate ? ` (returns ${returnDate})` : ""} [${classifySource}]`);
      seen.add(msgId);
      continue;
    }

    let draftResponse = null;
    if (template) {
      draftResponse = fill(template, { clinicName, city });
    }

    const draft = {
      receivedAt: new Date().toISOString(),
      fromEmail,
      clinicName,
      city,
      mailbox: mailboxName,
      clinicFound: Boolean(clinic),
      originalSubject: subject,
      originalBody: body.slice(0, 1000),
      intent,
      confidence,
      classifySource: classifySource || "regex",
      keyPhrase: keyPhrase || null,
      suggestedResponse: suggestedResponse || null,
      draftSubject: draftResponse?.subject || null,
      draftBody: draftResponse?.body || null,
      status: confidence === "high" ? "draft_ready" : "needs_review",
    };

    const draftPath = saveDraft(draft);
    drafts.push(draft);

    // Persist unsubscribe requests and mark lead cooling_off
    if (intent === "NOT_INTERESTED" || body.toLowerCase().includes("unsubscribe")) {
      try {
        const unsubPath = path.join(process.cwd(), "data", "unsubscribes.json");
        const unsubs = fs.existsSync(unsubPath) ? JSON.parse(fs.readFileSync(unsubPath, "utf-8")) : [];
        if (!unsubs.find(u => u.email === fromEmail)) {
          unsubs.push({ email: fromEmail, clinicName, recordedAt: new Date().toISOString() });
          fs.writeFileSync(unsubPath, JSON.stringify(unsubs, null, 2), "utf-8");
        }
        // Mark lead as cooling_off in outreach queue
        const leads = JSON.parse(fs.readFileSync(OUTREACH_PATH, "utf-8"));
        const idx = leads.findIndex(l => (l.email || "").toLowerCase() === fromEmail.toLowerCase());
        if (idx !== -1 && leads[idx].status !== "cooling_off") {
          leads[idx].status = "cooling_off";
          leads[idx].cooledOffAt = new Date().toISOString();
          fs.writeFileSync(OUTREACH_PATH, JSON.stringify(leads, null, 2), "utf-8");
        }
        // Append unsubscribe confirmation URL to the draft body
        if (draft.draftBody) {
          draft.draftBody += "\n\nYou can view your unsubscribe confirmation at:\nhttps://clinicflowautomation.com/unsubscribe";
        }
      } catch (e) { /* non-fatal */ }
    }

    console.log(`  [${mailboxName}][${confidence.toUpperCase()}] ${clinicName} <${fromEmail}> → ${intent} [${classifySource || "regex"}]`);

    try {
      await sendNotification({ clinicName, intent, confidence, draftPath, fromEmail, originalBody: body.slice(0, 500), draftBody: draftResponse?.body || null });
      console.log(`    → Notification sent to ${NOTIFY_EMAIL}`);
    } catch (e) {
      console.warn(`    → Notification failed: ${e.message}`);
    }

    // SMS alert to operator
    const intentLabelsShort = {
      HOW_MUCH:            "asking about pricing",
      TELL_ME_MORE:        "wants more info",
      NOT_INTERESTED:      "not interested",
      ALREADY_HAVE_SYSTEM: "already has a system",
      AUDIT_YES:           "said yes to audit — send 3 questions",
      REFERRAL_REQUEST:    "asking for a referral",
      NEEDS_REVIEW:        "needs manual review",
    };
    const intentShort = intentLabelsShort[intent] || intent;
    const smsBody = `ClinicFlow reply: ${clinicName} (${intentShort}). Check drafts.`;
    try {
      await sendSMS(NOTIFY_PHONE, smsBody);
      console.log(`    → SMS alert sent to ${NOTIFY_PHONE}`);
    } catch (e) {
      console.warn(`    → SMS alert failed: ${e.message}`);
    }
  }
}

// ─── SMS reply processing ─────────────────────────────────────────────────────
// Reads data/sms.replies.json and generates drafts for any entry with
// processed: false. Mirrors the email draft flow so drafts land in the same
// data/reply-drafts/ directory and are visible in the same panel.

async function processSmsReplies() {
  let entries;
  try {
    if (!fs.existsSync(SMS_LOG_PATH)) return 0;
    entries = JSON.parse(fs.readFileSync(SMS_LOG_PATH, "utf-8"));
    if (!Array.isArray(entries)) return 0;
  } catch {
    return 0;
  }

  const pending = entries.filter((e) => !e.processed);
  if (pending.length === 0) return 0;

  let processed = 0;
  for (const entry of pending) {
    const { intent, clinicName, body, from, draftBody, draftSubject } = entry;

    const draft = {
      receivedAt:      entry.receivedAt || new Date().toISOString(),
      fromPhone:       from,
      fromEmail:       null,
      clinicName:      clinicName || from,
      city:            "",
      channel:         "sms",
      clinicFound:     entry.clinicFound || false,
      originalSubject: null,
      originalBody:    body?.slice(0, 1000) || "",
      intent,
      confidence:      draftBody ? "high" : "low",
      draftSubject:    draftSubject || null,
      draftBody:       draftBody    || null,
      status:          draftBody ? "draft_ready" : "needs_review",
    };

    saveDraft(draft);
    entry.processed = true;

    console.log(`  [sms][${draft.confidence.toUpperCase()}] ${draft.clinicName} (${from}) → ${intent}`);

    // Notification email for anything that didn't already trigger one
    // (clinic not matched → no email was sent from the webhook)
    if (!entry.clinicFound) {
      try {
        await sendNotification({
          clinicName: draft.clinicName,
          intent,
          confidence: draft.confidence,
          draftPath: "(sms draft — see reply-drafts/)",
          fromEmail: `SMS: ${from}`,
        });
      } catch (e) {
        console.warn(`    → SMS notification failed: ${e.message}`);
      }
    }

    processed++;
  }

  // Write back updated processed flags
  try {
    fs.writeFileSync(SMS_LOG_PATH, JSON.stringify(entries, null, 2), "utf-8");
  } catch (err) {
    console.error(`  sms.replies.json write failed: ${err.message}`);
  }

  return processed;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

// Mailboxes to scan in order. Common Zoho spam folder names included.
const MAILBOXES_TO_SCAN = ["INBOX", "Spam", "Junk", "Junk Email", "Bulk Mail"];

export async function checkReplies() {
  console.log(`[${new Date().toISOString()}] Reply handler: connecting to IMAP…`);

  if (!IMAP_USER || !IMAP_PASS) {
    console.warn("  IMAP credentials not set (IMAP_USER / IMAP_PASS). Skipping.");
    return { processed: 0, drafts: [] };
  }

  const records = loadOutreach();
  const seen = loadSeen();
  const drafts = [];

  const client = new ImapFlow({
    host: IMAP_HOST,
    port: IMAP_PORT,
    secure: true,
    auth: { user: IMAP_USER, pass: IMAP_PASS },
    logger: false,
    tls: { rejectUnauthorized: false },
  });

  try {
    await client.connect();

    const since = new Date();
    since.setDate(since.getDate() - 7);

    for (const mailboxName of MAILBOXES_TO_SCAN) {
      await processMailbox(client, mailboxName, since, records, seen, drafts);
    }

    saveSeen(seen);
    await client.logout();

  } catch (err) {
    console.error(`  IMAP error: ${err.message}`);
    console.error(`  IMAP code: ${err.code || "(none)"}`);
    console.error(`  IMAP server response: ${err.response || "(none)"}`);
    console.error(`  IMAP auth failed: ${err.authenticationFailed ?? false}`);
    console.error(`  IMAP stack: ${err.stack || "(none)"}`);
    try { await client.logout(); } catch {}
    throw err;
  }

  // Also process any incoming SMS replies logged by the Twilio webhook
  const smsCount = await processSmsReplies();
  if (smsCount > 0) {
    console.log(`  SMS replies processed: ${smsCount}`);
  }

  console.log(`  Done. Processed ${drafts.length} email reply(s), ${smsCount} SMS reply(s).`);
  return { processed: drafts.length + smsCount, drafts };
}

// ─── Entry point ──────────────────────────────────────────────────────────────

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  checkReplies()
    .then(({ processed }) => {
      console.log(`Reply check complete. New replies: ${processed}`);
      process.exit(0);
    })
    .catch((err) => {
      console.error("Reply handler failed:", err.message);
      process.exit(1);
    });
}
