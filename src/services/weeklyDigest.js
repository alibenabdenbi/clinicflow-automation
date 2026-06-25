// src/services/weeklyDigest.js
// Every Monday at 07:00, every active client receives a natural, specific
// weekly update from Claude — written like a message from a smart business partner.
// Not a report. A conversation.

import fs from "fs";
import path from "path";
import nodemailer from "nodemailer";
import Anthropic from "@anthropic-ai/sdk";
import dotenv from "dotenv";
import { sendSMS } from "./smsService.js";
import { getActiveClients } from "./clientLifecycle.js";
import { logEvent, EVENT_TYPES } from "./eventLog.js";
import { getOpportunitySummary } from "./opportunityEngine.js";

dotenv.config();

const CLIENTS_DIR = path.join(process.cwd(), "data", "clients");
const ANTHROPIC_API_KEY = (process.env.ANTHROPIC_API_KEY || "").trim();
const SMTP_HOST   = (process.env.SMTP_HOST || "").trim();
const SMTP_PORT   = Number(process.env.SMTP_PORT || "587");
const SMTP_USER   = (process.env.SMTP_USER || "").trim();
const SMTP_PASS   = (process.env.SMTP_PASS || "").trim();
const SMTP_FROM   = (process.env.SMTP_FROM || SMTP_USER).trim();

function readJsonSafe(p, fb) {
  try {
    if (!fs.existsSync(p)) return fb;
    return JSON.parse(fs.readFileSync(p, "utf-8"));
  } catch { return fb; }
}

function daysSince(isoDate) {
  if (!isoDate) return Infinity;
  return (Date.now() - new Date(isoDate).getTime()) / 86_400_000;
}

// ─── Data aggregation for digest ─────────────────────────────────────────────

function buildWeekSummary(clinicSlug) {
  const events  = readJsonSafe(path.join(CLIENTS_DIR, clinicSlug, "events.json"), []);
  const threads = readJsonSafe(path.join(CLIENTS_DIR, clinicSlug, "recovery-threads.json"), []);
  const scores  = readJsonSafe(path.join(CLIENTS_DIR, clinicSlug, "patient-scores.json"), { scores: [] });
  const intel   = readJsonSafe(path.join(CLIENTS_DIR, clinicSlug, "intelligence.json"), null);

  const cutoff7d = Date.now() - 7 * 86_400_000;

  // This week's events
  const weekEvents = events.filter((e) => new Date(e.timestamp).getTime() > cutoff7d);

  // Interaction counts
  const totalInteractions  = weekEvents.length;
  const inboundReplies     = weekEvents.filter((e) => e.direction === "inbound").length;
  const outboundMessages   = weekEvents.filter((e) => e.direction === "outbound").length;
  const recovered          = weekEvents.filter((e) => e.type === EVENT_TYPES.PATIENT_BOOKED).length;
  const escalations        = weekEvents.filter((e) => e.type === EVENT_TYPES.ESCALATION).length;
  const reminders          = weekEvents.filter((e) => ["appointment_reminder_72h","appointment_reminder_24h"].includes(e.type)).length;
  const opportunities      = weekEvents.filter((e) => e.type === EVENT_TYPES.OPPORTUNITY_DETECTED && e.outcome === "sent").length;
  const revenueThisWeek    = weekEvents.reduce((s, e) => s + (e.revenueAttributed || 0), 0) + recovered * 200;

  // Week's threads
  const weekThreads = threads.filter((t) => t.calledAt && new Date(t.calledAt).getTime() > cutoff7d);
  const weekMissed  = weekThreads.length;
  const weekBooked  = weekThreads.filter((t) => t.recovered).length;

  // Notable patients this week (for Claude to mention specifically)
  const notablePatients = weekEvents
    .filter((e) => e.patientName && (e.type === EVENT_TYPES.PATIENT_BOOKED || (e.type === EVENT_TYPES.PATIENT_REPLIED && e.sentiment === "positive")))
    .slice(0, 3)
    .map((e) => {
      const name = e.patientName.split(" ").map((w, i) => i === 0 ? w : w[0] + ".").join(" ");
      return `${name} (${e.type === EVENT_TYPES.PATIENT_BOOKED ? "booked an appointment" : "replied positively"})`;
    });

  // High-risk patterns from patient scores
  const urgentPatients = (scores.scores || [])
    .filter((s) => s.churnRisk >= 65 && s.recommendedAction === "urgent_outreach")
    .slice(0, 2)
    .map((s) => s.name?.split(" ").map((w, i) => i === 0 ? w : w[0] + ".").join(" "));

  // Opportunities acted on
  const opportunitySummary = getOpportunitySummary(clinicSlug, 7);

  // Heatmap insight — busiest call slot
  const heatmap     = intel?.heatmap;
  let busiestSlot   = null;
  if (heatmap) {
    let maxVal = 0;
    Object.entries(heatmap).forEach(([day, hours]) => {
      Object.entries(hours).forEach(([h, count]) => {
        if (count > maxVal) {
          maxVal = count;
          const dayNames = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
          const hour = Number(h);
          const timeStr = hour < 12 ? `${hour}am` : hour === 12 ? "12pm" : `${hour - 12}pm`;
          busiestSlot = maxVal > 0 ? `${dayNames[Number(day)]} at ${timeStr}` : null;
        }
      });
    });
  }

  return {
    weekMissed,
    weekBooked,
    inboundReplies,
    outboundMessages,
    totalInteractions,
    recovered,
    escalations,
    reminders,
    opportunities,
    revenueThisWeek,
    notablePatients,
    urgentPatients,
    opportunitySummary,
    busiestSlot,
    forecastExpected:     intel?.forecast?.scenarios?.expected?.revenue || 0,
    forecastConservative: intel?.forecast?.scenarios?.conservative?.revenue || 0,
  };
}

// ─── Claude digest generation ─────────────────────────────────────────────────

/**
 * Generate the weekly digest message using Claude.
 * @param {string} clinicSlug
 * @param {object} clinic
 * @param {object} summary
 * @returns {Promise<string>} the digest text (5 sentences max)
 */
async function generateDigestWithClaude(clinicSlug, clinic, summary) {
  if (!ANTHROPIC_API_KEY) {
    return buildFallbackDigest(clinic, summary);
  }

  const anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY });

  const dataBlock = `
Last 7 days for ${clinic.clinicName}:
- Total patient interactions: ${summary.totalInteractions}
- Missed calls handled: ${summary.weekMissed} (${summary.weekBooked} converted to bookings)
- Inbound replies from patients: ${summary.inboundReplies}
- Appointment reminders sent: ${summary.reminders}
- Revenue attributed this week: $${summary.revenueThisWeek}
- Proactive opportunities acted on: ${summary.opportunities}
- Escalations (emergencies/complaints): ${summary.escalations}
${summary.notablePatients.length ? `- Notable patients: ${summary.notablePatients.join(", ")}` : ""}
${summary.urgentPatients.length ? `- Patients approaching churn risk: ${summary.urgentPatients.join(", ")}` : ""}
${summary.busiestSlot ? `- Busiest call time: ${summary.busiestSlot}` : ""}
${summary.opportunitySummary.acted > 0 ? `- Opportunities proactively sent: ${summary.opportunitySummary.acted} (${Object.keys(summary.opportunitySummary.byType).join(", ")})` : ""}
Revenue forecast next 30 days: $${summary.forecastConservative} (conservative) to $${summary.forecastExpected} (expected)`.trim();

  try {
    const response = await anthropic.messages.create({
      model:      "claude-opus-4-7",
      max_tokens: 300,
      thinking:   { type: "adaptive" },
      system:     `You are writing a weekly summary SMS from ClinicFlow to the owner of ${clinic.clinicName}.
Write it like a smart business partner giving a Monday morning update — direct, specific, human.
Keep it to 4-5 sentences max. No bullet points. No headers. Plain text only.
Mention 1-2 specific things you noticed and what you did about them.
End with one brief forward-looking observation.
Start with "Good morning" — do NOT start with "Hi" or use their name.
Do NOT mention dollar amounts unless they're meaningful (>$100).
Sound like a real person who was paying attention, not a dashboard.`,
      messages: [{
        role:    "user",
        content: `Write the weekly digest message.\n\n${dataBlock}`,
      }],
    });

    return response.content.find((b) => b.type === "text")?.text?.trim() || buildFallbackDigest(clinic, summary);
  } catch (err) {
    console.error(`[weeklyDigest] Claude API error: ${err.message}`);
    return buildFallbackDigest(clinic, summary);
  }
}

/**
 * Deterministic fallback if Claude is unavailable.
 */
function buildFallbackDigest(clinic, summary) {
  const lines = [`Good morning! This week I handled ${summary.totalInteractions} patient interactions for ${clinic.clinicName}.`];

  if (summary.weekMissed > 0) {
    lines.push(`I caught ${summary.weekMissed} missed call${summary.weekMissed > 1 ? "s" : ""} — ${summary.weekBooked > 0 ? `${summary.weekBooked} patient${summary.weekBooked > 1 ? "s" : ""} booked` : "follow-up messages sent to all"}.`);
  }
  if (summary.reminders > 0) {
    lines.push(`${summary.reminders} appointment reminder${summary.reminders > 1 ? "s" : ""} went out automatically.`);
  }
  if (summary.opportunities > 0) {
    lines.push(`I proactively reached out to ${summary.opportunities} patient${summary.opportunities > 1 ? "s" : ""} I identified as ready to rebook.`);
  }
  if (summary.urgentPatients.length > 0) {
    lines.push(`Heads up: ${summary.urgentPatients[0]} is approaching the 12-month mark — I'll act on that this week.`);
  } else if (summary.forecastExpected > 0) {
    lines.push(`Revenue forecast for the next 30 days: $${summary.forecastExpected}. Have a great week!`);
  } else {
    lines.push("Have a great week — everything is running automatically.");
  }

  return lines.join(" ");
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Generate the weekly digest text for one clinic.
 * Does NOT send — just returns the message for preview or testing.
 * @param {string} clinicSlug
 * @returns {Promise<string>} digest text
 */
export async function generateWeeklyDigest(clinicSlug) {
  const clinic = (readJsonSafe("data/clients.json", [])).find((c) => c.clinicSlug === clinicSlug);
  if (!clinic) return null;

  const summary = buildWeekSummary(clinicSlug);
  return generateDigestWithClaude(clinicSlug, clinic, summary);
}

/**
 * Generate AND send the weekly digest to a clinic's contact phone and email.
 * @param {string} clinicSlug
 * @returns {Promise<{ sms, email, digest }>}
 */
export async function sendWeeklyDigest(clinicSlug) {
  const clientsRaw = readJsonSafe("data/clients.json", []);
  const clinic     = clientsRaw.find((c) => c.clinicSlug === clinicSlug);
  if (!clinic) return { sms: false, email: false, digest: null };

  const summary = buildWeekSummary(clinicSlug);
  const digest  = await generateDigestWithClaude(clinicSlug, clinic, summary);

  let smsSent   = false;
  let emailSent = false;

  // Send SMS to clinic contact phone
  const contactPhone = clinic.clinicPhone || clinic.contactPhone;
  if (contactPhone && digest) {
    const from = clinic.twilioNumber || process.env.TWILIO_FROM_NUMBER;
    try {
      await sendSMS(contactPhone, digest, from);
      smsSent = true;
      console.log(`[weeklyDigest] ✓ SMS sent to ${contactPhone} (${clinicSlug})`);
    } catch (err) {
      console.error(`[weeklyDigest] ✗ SMS failed (${clinicSlug}): ${err.message}`);
    }
  }

  // Send email to clinic contact email
  const contactEmail = clinic.contactEmail;
  if (contactEmail && digest && SMTP_HOST && SMTP_USER && SMTP_PASS) {
    try {
      const transporter = nodemailer.createTransport({
        host:   SMTP_HOST,
        port:   SMTP_PORT,
        secure: SMTP_PORT === 465,
        auth:   { user: SMTP_USER, pass: SMTP_PASS },
        tls:    { rejectUnauthorized: false },
      });

      const now     = new Date();
      const weekStr = now.toLocaleDateString("en-CA", { month: "long", day: "numeric" });

      await transporter.sendMail({
        from:    `ClinicFlow <${SMTP_FROM}>`,
        to:      contactEmail,
        subject: `${clinic.clinicName} — Week of ${weekStr}`,
        text:    digest + "\n\n— ClinicFlow Automation\nView your portal: https://clinicflowautomation.com/portal?clinic=" + clinicSlug,
      });
      emailSent = true;
      console.log(`[weeklyDigest] ✓ Email sent to ${contactEmail} (${clinicSlug})`);
    } catch (err) {
      console.error(`[weeklyDigest] ✗ Email failed (${clinicSlug}): ${err.message}`);
    }
  }

  // Log the digest
  logEvent(clinicSlug, {
    type:      "weekly_digest_sent",
    direction: "outbound",
    channel:   "sms",
    content:   digest,
    outcome:   smsSent || emailSent ? "sent" : "failed",
    metadata:  {
      smsSent,
      emailSent,
      weekSummary: {
        interactions: summary.totalInteractions,
        recovered:    summary.recovered,
        revenue:      summary.revenueThisWeek,
        opportunities: summary.opportunities,
      },
    },
  });

  return { sms: smsSent, email: emailSent, digest };
}

/**
 * Send weekly digest to ALL active clients.
 * Scheduler entry point — every Monday at 07:00.
 */
export async function sendWeeklyDigestForAll() {
  const clients = getActiveClients();
  console.log(`[weeklyDigest] Generating for ${clients.length} active client(s)`);

  let sent = 0;
  for (const clinic of clients) {
    try {
      const result = await sendWeeklyDigest(clinic.clinicSlug);
      if (result.sms || result.email) sent++;
      // Brief delay between sends to avoid rate limits
      await new Promise((r) => setTimeout(r, 2000));
    } catch (err) {
      console.error(`[weeklyDigest] ✗ ${clinic.clinicSlug}: ${err.message}`);
    }
  }

  console.log(`[weeklyDigest] Done. Sent: ${sent}/${clients.length}`);
  return { sent, total: clients.length };
}
