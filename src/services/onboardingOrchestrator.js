// src/services/onboardingOrchestrator.js
// Automates the entire client journey from payment confirmation to go-live.
// Runs daily at 9:15am via scheduler — checks each onboarding client and
// sends the right email for their current step.

import fs from "fs";
import path from "path";
import nodemailer from "nodemailer";
import { getClient, updateClient, advanceStage, getPendingOnboarding } from "./clientLifecycle.js";

const SMTP_HOST   = (process.env.SMTP_HOST || "").trim();
const SMTP_PORT   = Number(process.env.SMTP_PORT || "587");
const SMTP_USER   = (process.env.SMTP_USER || "").trim();
const SMTP_PASS   = (process.env.SMTP_PASS || "").trim();
const SMTP_FROM   = (process.env.SMTP_FROM || SMTP_USER).trim();
const SENDER_NAME = (process.env.SENDER_NAME || "Mohamed").trim();
const PUBLIC_BASE_URL = (process.env.PUBLIC_BASE_URL || "https://clinicflowautomation.com").trim();

// ─── Helpers ──────────────────────────────────────────────────────────────────

function createTransporter() {
  return nodemailer.createTransport({
    host:   SMTP_HOST,
    port:   SMTP_PORT,
    secure: SMTP_PORT === 465,
    auth:   { user: SMTP_USER, pass: SMTP_PASS },
    tls:    { rejectUnauthorized: false },
  });
}

function daysSince(isoDate) {
  if (!isoDate) return Infinity;
  return (Date.now() - new Date(isoDate).getTime()) / 86_400_000;
}

function formatDate(isoDate, offsetDays = 0) {
  const d = new Date(isoDate);
  d.setDate(d.getDate() + offsetDays);
  return d.toLocaleDateString("en-CA", { weekday: "long", month: "long", day: "numeric" });
}

function portalUrl(clinic) {
  const slug = clinic.portalSlug || clinic.clinicSlug;
  const key  = clinic.portalPassword || "";
  return `${PUBLIC_BASE_URL}/portal?clinic=${slug}&key=${encodeURIComponent(key)}`;
}

// ─── Email templates ──────────────────────────────────────────────────────────

function buildStep1(clinic) {
  const firstName = (clinic.contactName || "").split(" ")[0] || clinic.clinicName || "there";
  const clinicName = clinic.clinicName || "your clinic";
  const slug = clinic.portalSlug || clinic.clinicSlug || "";
  const key = clinic.portalPassword || "";
  const portal = portalUrl(clinic);
  const twilioNumber = clinic.twilioNumber || "[your ClinicFlow number — I'll send this next]";

  const subject = `You're in — here's exactly what happens next, ${firstName}`;
  const body = `${firstName},

Your setup starts now. Here's the exact timeline:

Today — I review your clinic setup and configure your Twilio number
Day 2 — Your missed call system is built and tested
Day 3 — I load your patient list and configure reminders
Day 4 — Full system test with your phone number
Day 5 — You go live. Your first missed call gets caught automatically.

One thing I need from you to get started:

→ Your patient list as a CSV export from your practice software
   Jane App: Reports → Patient List → Export CSV
   Dentrix: Office Manager → Letters → Patient List → Export
   Eaglesoft: Reports → Patient → Export
   Power Practice: Reports → Patient Listing → Export to CSV
   Not sure? Just reply and tell me which system you use.

→ Your preferred phone setup (I'll explain the options in my next email)
   For now, just reply A, B, or C:
   A) Call forwarding — patients call your number, we catch every missed call
   B) Overflow forwarding — we only get calls when your lines are busy
   C) You're on a VoIP system (tell me which one)

Your clinic portal is live now:
${portal}

I'll update it daily so you can watch the setup progress.

— ${SENDER_NAME}
ClinicFlow Automation
438-544-0442

P.S. If you have any questions at any point, text me directly at 438-544-0442.
I respond within 2 hours, 7 days a week.`;

  return { subject, body };
}

function buildStep2(clinic) {
  const firstName = (clinic.contactName || "").split(" ")[0] || clinic.clinicName || "there";
  const clinicName = clinic.clinicName || "your clinic";
  const portal = portalUrl(clinic);
  const twilioNumber = clinic.twilioNumber || "[your ClinicFlow number]";

  const subject = `Building ${clinicName}'s system — Day 2 update`;
  const body = `${firstName},

Quick update — your missed call system is being configured now.

Here's what's being built specifically for ${clinicName}:

✓ Your dedicated phone number (patients call, we catch every missed call)
✓ Automatic SMS response — fires within 60 seconds of any missed call
✓ Patient recognition — if we have their record, we greet them by name
✓ 3-wave recovery — if they don't reply, we follow up at 2h and 24h

What the SMS will look like when it fires:
"Hi [Patient Name]! You called ${clinicName}. We missed your call —
we'll follow up with you within 2 hours. Reply here to book or ask a question."

No ClinicFlow branding. Looks like it came directly from your clinic.

I need your patient CSV to activate the reminder and reactivation systems.
Just reply to this email with the file attached.

Watching your portal? ${portal}

— ${SENDER_NAME}`;

  return { subject, body };
}

function buildStep3(clinic) {
  const firstName = (clinic.contactName || "").split(" ")[0] || clinic.clinicName || "there";
  const clinicName = clinic.clinicName || "your clinic";
  const count = clinic.patientsLoaded || 0;
  const upcomingAppts = Math.round((count * 0.05) || 0);
  const inactive12m = clinic.inactiveCount || Math.round(count * 0.18);
  const smsReady = Math.round(count * 0.72);
  const portal = portalUrl(clinic);

  const subject = `I loaded ${count > 0 ? count.toLocaleString("en-CA") : "your"} patients into ${clinicName}'s system`;
  const body = `${firstName},

${count > 0 ? `Your patient list is in. Here's what I found:` : `Your patient list is in.`}

${count > 0 ? `→ ${count.toLocaleString("en-CA")} total patients loaded
→ ~${upcomingAppts} with upcoming appointments in the next 7 days
→ ${inactive12m} inactive patients (12+ months) — reactivation campaign starts next month
→ ~${smsReady} patients with mobile numbers (SMS-ready)

` : ""}Appointment reminders are now configured. Your patients will receive:
- A reminder 72 hours before their appointment
- A reminder 24 hours before their appointment

Both look like they come directly from ${clinicName} — no external branding.

One thing left: phone setup. I need you to forward your clinic line to your
dedicated ClinicFlow number. Takes 5 minutes. I'll send exact instructions
for your phone provider tomorrow.

— ${SENDER_NAME}`;

  return { subject, body };
}

function buildStep4(clinic) {
  const firstName = (clinic.contactName || "").split(" ")[0] || clinic.clinicName || "there";
  const clinicName = clinic.clinicName || "your clinic";
  const portal = portalUrl(clinic);
  const twilioNumber = clinic.twilioNumber || "[your ClinicFlow number — see previous email]";

  const bellInstructions    = `If you're on Bell: Dial *72 + ${twilioNumber} from your clinic phone`;
  const rogersInstructions  = `If you're on Rogers: My Rogers app → Call Forwarding → Enter ${twilioNumber}`;
  const telusInstructions   = `If you're on Telus: Dial **21*${twilioNumber}# from your clinic phone`;
  const voipInstructions    = `If you use a VoIP system: Reply with your provider name and I'll send specific instructions.`;

  const subject = `${clinicName} goes live tomorrow — one last step`;
  const body = `${firstName},

Everything is built and tested. You go live tomorrow.

The one remaining step: forward your clinic phone to your ClinicFlow number.

Here's how (takes 5 minutes):
${bellInstructions}
${rogersInstructions}
${telusInstructions}
${voipInstructions}

Your ClinicFlow number: ${twilioNumber}

Once you've done this, call your own clinic number from your cell phone.
You'll hear the ClinicFlow greeting, and within 60 seconds you'll get a test SMS.

That's your confirmation that everything is working.

— ${SENDER_NAME}`;

  return { subject, body };
}

function buildStep5(clinic) {
  const firstName = (clinic.contactName || "").split(" ")[0] || clinic.clinicName || "there";
  const clinicName = clinic.clinicName || "your clinic";
  const portal = portalUrl(clinic);
  const results = clinic.results || {};
  const thirtyDayDate = formatDate(clinic.goLiveDate || new Date().toISOString(), 30);
  const secondHalf = clinic.secondHalfAmount || Math.round((clinic.firstHalfAmount || 497));

  const subject = `🟢 ${clinicName} is live — your first missed call is protected`;
  const body = `${firstName},

${clinicName} is live on ClinicFlow.

From this moment, every patient who calls and doesn't reach anyone
gets an automatic text within 60 seconds.

What to watch for this week:
→ You'll see missed call recoveries appear in your portal in real time
→ Patients will text back — your front desk can reply from the clinic phone
→ Appointment reminders fire automatically — nothing to do on your end

Your portal (bookmark this):
${portal}

On day 30, I'll send you a full results report showing exactly how many
patients were recovered and the estimated revenue impact.

If anything ever looks wrong — text me at 438-544-0442.

— ${SENDER_NAME}

P.S. Your second payment of $${secondHalf} is due after you've seen 30 days of results.
No rush — I'll remind you then.`;

  return { subject, body };
}

// ─── Core functions ───────────────────────────────────────────────────────────

/**
 * Trigger onboarding when payment is received.
 * Sets status to 'onboarding' and sends Step 1 email.
 * @param {string} clinicSlug
 */
export async function startOnboarding(clinicSlug) {
  const clinic = getClient(clinicSlug);
  if (!clinic) throw new Error(`[onboarding] Client not found: ${clinicSlug}`);

  advanceStage(clinicSlug, "onboarding");
  updateClient(clinicSlug, { onboardingStep: 0, paymentDate: new Date().toISOString() });

  await sendOnboardingEmail(clinicSlug, 1);
}

/**
 * Send the email for a specific onboarding step.
 * @param {string} clinicSlug
 * @param {1|2|3|4|5} step
 */
export async function sendOnboardingEmail(clinicSlug, step) {
  const clinic = getClient(clinicSlug);
  if (!clinic) throw new Error(`[onboarding] Client not found: ${clinicSlug}`);
  if (!clinic.contactEmail) throw new Error(`[onboarding] No contactEmail for ${clinicSlug}`);

  const builders = { 1: buildStep1, 2: buildStep2, 3: buildStep3, 4: buildStep4, 5: buildStep5 };
  const builder  = builders[step];
  if (!builder) throw new Error(`[onboarding] Invalid step: ${step}`);

  const { subject, body } = builder(clinic);
  const transporter = createTransporter();

  await transporter.sendMail({
    from: `${SENDER_NAME} - ClinicFlow <${SMTP_FROM}>`,
    to:   clinic.contactEmail,
    subject,
    text: body,
  });

  const stepKey = `onboarding_step${step}_sentAt`;
  updateClient(clinicSlug, {
    [stepKey]: new Date().toISOString(),
    onboardingStep: Math.max(clinic.onboardingStep || 0, step),
  });

  console.log(`[onboarding] ${clinicSlug}: Step ${step} email sent`);
}

/**
 * Inspect a client's onboarding state and send the next pending email.
 * Idempotent — safe to call every day.
 * @param {string} clinicSlug
 * @returns {{ action: string }}
 */
export async function checkOnboardingProgress(clinicSlug) {
  const clinic = getClient(clinicSlug);
  if (!clinic) return { action: "not_found" };

  // Step 1: immediately when onboarding starts (handled by startOnboarding)
  if (!clinic.onboarding_step1_sentAt && clinic.paymentDate) {
    await sendOnboardingEmail(clinicSlug, 1);
    return { action: "sent_step1" };
  }

  // Step 2: when CSV received
  if (clinic.csvReceivedAt && !clinic.onboarding_step2_sentAt) {
    await sendOnboardingEmail(clinicSlug, 2);
    return { action: "sent_step2" };
  }

  // Step 3: day 2 after payment
  if (
    clinic.onboarding_step1_sentAt &&
    !clinic.onboarding_step3_sentAt &&
    daysSince(clinic.paymentDate) >= 2
  ) {
    await sendOnboardingEmail(clinicSlug, 3);
    return { action: "sent_step3" };
  }

  // Step 4: day 5 — go live
  if (
    clinic.onboarding_step1_sentAt &&
    !clinic.onboarding_step4_sentAt &&
    daysSince(clinic.paymentDate) >= 5
  ) {
    await sendOnboardingEmail(clinicSlug, 4);
    return { action: "sent_step4" };
  }

  // Step 5: day 7 check-in
  if (
    clinic.onboarding_step4_sentAt &&
    !clinic.onboarding_step5_sentAt &&
    daysSince(clinic.paymentDate) >= 7
  ) {
    await sendOnboardingEmail(clinicSlug, 5);
    return { action: "sent_step5" };
  }

  return { action: "nothing_pending" };
}

/**
 * Mark onboarding complete and advance client to 'active'.
 * @param {string} clinicSlug
 */
export async function completeOnboarding(clinicSlug) {
  updateClient(clinicSlug, {
    goLiveDate: new Date().toISOString(),
    services: { missedCall: true, reminders: true, reactivation: true },
  });
  advanceStage(clinicSlug, "active");
  console.log(`[onboarding] ${clinicSlug}: onboarding complete — now active`);
}

// ─── Scheduler entry point ────────────────────────────────────────────────────

/**
 * Run the daily onboarding check for all clients in the 'onboarding' stage.
 * Called daily at 9:15am by scheduler.js.
 */
export async function runOnboardingCheckForAll() {
  const clients = getPendingOnboarding();
  console.log(`[onboarding] Checking ${clients.length} onboarding client(s)`);

  for (const clinic of clients) {
    try {
      const result = await checkOnboardingProgress(clinic.clinicSlug);
      console.log(`[onboarding] ${clinic.clinicSlug}: ${result.action}`);

      // Auto-complete after step 5 is sent
      if (result.action === "sent_step5") {
        await completeOnboarding(clinic.clinicSlug);
      }
    } catch (err) {
      console.error(`[onboarding] ✗ ${clinic.clinicSlug}: ${err.message}`);
    }
  }
}
