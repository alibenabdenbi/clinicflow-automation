// src/templates/replyTemplates.js
// Ready-to-send reply templates for inbound email responses.
// Each template has a subject and body with {clinicName} and {city} placeholders.
// Call fill(template, { clinicName, city }) to render.

import { extractGreetingName } from "../services/emailPersonalizer.js";
import { pickSalonVariant } from "./salonTemplates.js";

// Minimal hash for deterministic variant selection in market bodies.
function _hashStr(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = Math.imul(31, h) + s.charCodeAt(i);
  return Math.abs(h);
}
function _pick(arr, seed) { return arr[Math.abs(seed) % arr.length]; }

export function fill(template, vars = {}) {
  // Compute smart greeting if an email is provided; fall back to bare "Hi,"
  const greetName = vars.email ? extractGreetingName(vars.email) : null;
  const greeting  = greetName ? `Hi ${greetName},` : "Hi,";
  const resolved  = { greeting, ...vars };
  return {
    subject: template.subject.replace(/\{(\w+)\}/g, (_, k) => resolved[k] ?? ""),
    body:    template.body.replace(/\{(\w+)\}/g,    (_, k) => resolved[k] ?? ""),
  };
}

// ── Template 1: "tell me more" ────────────────────────────────────────────────
// Use when: clinic replies with "what is this?" / "tell me more" / "how does it work?"

export const TELL_ME_MORE = {
  subject: "Re: {clinicName} — here's exactly what I'd set up",
  body: `{greeting}

Here's the short version of what I do:

When a patient calls {clinicName} and nobody picks up, they get an automatic text back within 60 seconds — keeping them engaged instead of calling the next clinic on Google.

On top of that I set up appointment reminders (SMS at 72h and 24h before each visit) and a reactivation campaign for patients you haven't seen in 12+ months.

You send me your patient list. I build everything in 5 days. You see it running before you pay the second half.

Most clinics I work with recover 4–6 patients in the first month just from the missed call follow-up alone.

Want me to take a quick look at {clinicName}'s setup and tell you what I'd build specifically?

Mohamed

To opt out of future emails, reply with 'unsubscribe'
ClinicFlow Automation · Montreal, QC · Canada`,
};

// ── Template 2: "how much does it cost?" ─────────────────────────────────────
// Use when: clinic asks for pricing directly

export const HOW_MUCH = {
  subject: "Re: ClinicFlow pricing — {clinicName}",
  body: `{greeting}

Three options:

Starter — $397 · $200 now, $197 after results
Missed call follow-up only. Automatic text to every caller who doesn't reach you.

Growth — $997 · $500 now, $497 after results  ← most clinics choose this
Everything in Starter plus appointment reminders (SMS at 72h + 24h) and a reactivation campaign for patients inactive 12+ months.

Premium — $2,497 · $1,250 now, $1,247 after results
Everything in Growth plus monthly reporting and priority support.

You pay the second half only after you've seen it working. 30-day money-back if you're not satisfied.

Based on what you've told me, Growth is probably the right fit for {clinicName} — but happy to talk through it if you want to make sure.

Payment is by Interac e-transfer to m.aliben432@gmail.com when you're ready to move forward.

Mohamed

To opt out of future emails, reply with 'unsubscribe'
ClinicFlow Automation · Montreal, QC · Canada`,
};

// ── Template 3: "not interested" ─────────────────────────────────────────────
// Use when: clinic says no, not now, or not relevant

export const NOT_INTERESTED = {
  subject: "Re: {clinicName} — understood",
  body: `{greeting}

Completely understood — appreciate you taking the time to reply.

No more emails from me. If anything changes down the road, just reply here.

Wishing {clinicName} a full schedule.

Mohamed

ClinicFlow Automation · Montreal, QC · Canada`,
};

// ── Template 4: "we already have a system" ───────────────────────────────────
// Use when: clinic says they already use Jane App, Dentrix, Curve, etc.

export const ALREADY_HAVE_SYSTEM = {
  subject: "Re: {clinicName} — what system are you on?",
  body: `{greeting}

Good to know — which system are you currently using?

The reason I ask: ClinicFlow isn't a replacement for practice management software. It sits alongside whatever you're already running (Jane App, Dentrix, Curve, etc.) and handles the patient communication layer specifically — missed call texts, reminder sequences, recall outreach — which most PMS platforms don't do automatically out of the box.

If you're already getting automated reminders and recall campaigns without staff effort, you probably don't need us. But if any of that is still manual, it might be worth a quick look at clinicflowautomation.com.

Either way, happy to hear what you're working with.

Mohamed

Not relevant? Just reply and let me know.
ClinicFlow Automation · Montreal, QC · Canada`,
};

// ── Template 5: referral request ─────────────────────────────────────────────
// Use when: a client has been live for 30+ days and results are solid.
// Send manually — never automated.

export const REFERRAL_REQUEST = {
  subject: "A small favour — {clinicName}",
  body: `{greeting}

Really glad the setup has been working well for {clinicName}.

One small favour — if you know another clinic owner who might benefit from the same system, I'd love an introduction. For any successful referral I'll add a free automation sequence to your package.

No pressure at all — just thought I'd mention it.

Mohamed
ClinicFlow Automation · Montreal, QC · Canada`,
};

// ── Template 6: audit yes — fires when clinic replies yes to the audit offer ──
// Use when: clinic replies "yes", "sure", "go ahead", "sounds good", etc.
// Sends the 3-question intake to run the audit.

export const AUDIT_YES = {
  subject: "Great — 3 quick questions for {clinicName}",
  body: `{greeting}

Great — this takes about 2 minutes.

1. What booking system does {clinicName} use?
   (Jane App, Dentrix, Power Practice, phone/paper, or something else)

2. When a patient calls and no one answers — what happens?
   (voicemail only? front desk calls back same day? nothing?)

3. When did you last reach out to patients you haven't seen in 12+ months?
   (never / occasionally / something is already running)

Just quick answers — no right or wrong. I'll send what I find within 24 hours.

Mohamed

To opt out of future emails, reply with 'unsubscribe'
ClinicFlow Automation · Montreal, QC · Canada`,
};

// ── Template 7: onboarding — sent immediately after first-half payment received ─
// Use when: client has paid and you need their patient list + clinic details.
// Send via: npm run onboard -- --client "Name" --email "x" --tier growth
// Also sent automatically by confirmPayment.js when --payment first_half is used.

export const ONBOARDING = {
  subject: "Welcome to ClinicFlow — let's get {clinicName} set up",
  body: `{greeting}

Payment received — thank you. I'll have everything live within 48 hours.

I need three things from you to get started:

STEP 1 — Your patient list
Export your patient list from your booking system as a CSV and reply with it attached.
- Jane App: Reports → Patient List → Export
- Dentrix: Office Manager → Letters → Export
- Not sure how? Just tell me which system you use and I'll send exact steps.

STEP 2 — A few quick details
Please reply with:
- The email address your patients recognize (e.g. info@yourclinic.com)
- Your online booking link (Jane App URL or website booking page)
- Your Google review link (search your clinic on Google Maps → Write a Review → copy that URL)

STEP 3 — Appointment reminders setup
I'll send you a Google Calendar sharing invite to contact@clinicflowautomation.com.
Accept it and add your upcoming appointments — reminders fire automatically.
If you already use Google Calendar just share it with contact@clinicflowautomation.com

Once I have everything above I will:
- Launch your reactivation campaign within 24 hours
- Set up your appointment reminder system
- Send you a confirmation with everything that's live

Your first reactivation emails will start going out within 48 hours of setup.

Mohamed
ClinicFlow Automation
contact@clinicflowautomation.com`,
};

// ── Template 8: audit response — fill in manually after they answer the 5 Qs ─
// Use when: clinic has answered the 3 audit questions and you're ready to present findings.
// Fill {auditMissedCalls}, {auditReminders}, {auditReactivation}, {auditBiggest} manually
// or via: npm run audit:respond -- --client "Name" --missed "..." --reminders "..." --reactivation "..." --biggest "..."

export const AUDIT_RESPONSE = {
  subject: "Your {clinicName} audit — here's what I found",
  body: `{greeting}

Based on what you shared, here's what I'm seeing at {clinicName}:

Missed calls: {auditMissedCalls}

Appointment reminders: {auditReminders}

Patient reactivation: {auditReactivation}

The biggest opportunity I see: {auditBiggest}

I can set all of this up for {clinicName} — done for you, no monthly fees, takes about 5 days.

Want me to walk you through exactly what that looks like?

Mohamed
ClinicFlow Automation · Montreal, QC · Canada`,
};

// ── Market-specific outreach bodies ──────────────────────────────────────────
// Used by sendBatch.js when a lead has a market field other than "dental".
// Each export is a function: (clinicName, city, email) => string

export const MARKET_BODY = {

  // ── Physiotherapy — 4 rotating variants, booking recovery angle ──────────────
  physio: (name, city, email) => {
    const greetName = extractGreetingName(email || "");
    const greeting  = greetName ? `Hi ${greetName},` : "Hi,";
    const loc       = city ? ` in ${city}` : "";
    const seed      = _hashStr((name || "") + (city || ""));
    const sign      = `Mohamed\n\nTo opt out of future emails, reply with 'unsubscribe'\nClinicFlow Automation · Montreal, QC · Canada`;

    const variants = [
      // Variant 1 — missed call → missed booking
      `${greeting}

80% of missed calls to physio clinics are patients ready to book — who call somewhere else when no one picks up.

Clinics using ClinicFlow recover 10–15 additional appointments per month automatically. Every missed caller gets a text within 60 seconds.

2-minute setup. No new software. No monthly fees.

Worth a look?

${sign}`,

      // Variant 2 — no-show + concrete number
      `${greeting}

Does ${name} have automated reminders going out before each session?

Most physio clinics${loc} don't — no-shows run 15–20% higher as a result. Adding a 48h + 24h reminder sequence typically recovers 10–15 appointments a month that would otherwise be lost.

One-time setup, no monthly fees. Happy to check what you're currently using.

${sign}`,

      // Variant 3 — cancellation slot recovery
      `${greeting}

When ${name} gets a last-minute cancellation, does the slot get filled — or does it go empty?

Most physio clinics lose 8–12 hours of billable time per month to unfilled cancellations. An automated rebooking sequence texts the cancellation list within minutes and typically fills the slot the same day.

One-time setup, no ongoing software fee.

Worth a quick look?

${sign}`,

      // Variant 4 — inactive patient reactivation
      `${greeting}

Does ${name} have a system for patients you haven't seen in 3+ months?

Most physio clinics have 50–150 patients who dropped off mid-plan with no follow-up. An automated reactivation campaign to that list typically brings back 10–15 patients in the first month.

Happy to walk you through it — no commitment.

${sign}`,
    ];

    return _pick(variants, seed);
  },

  legal: (name, city, email) => {
    const greetName = extractGreetingName(email || "");
    const greeting  = greetName ? `Hi ${greetName},` : "Hi,";
    return `${greeting}

I came across ${name} while researching law firms${city ? ` in ${city}` : ""}.

One thing that keeps coming up with firm administrators is speed-to-lead: potential client inquiries that don't get a response within a few hours often go cold. Consultation no-shows are another recurring issue — without a reminder sequence, the seat goes empty and the time is lost.

I put together a simple automation that handles both: instant acknowledgement of new inquiries, a consultation reminder sequence, and a follow-up cadence for past clients. One-time setup, no ongoing software fee.

Happy to send a quick overview if it sounds relevant.

Mohamed
ClinicFlow Automation`;
  },

  // ── Salon / Spa / Beauty — 4 rotating variants ───────────────────────────────
  salon: (name, city, email, reviewQuote) => {
    const { body } = pickSalonVariant(name, city, email, reviewQuote);
    return body;
  },

  realestate: (name, city, email) => {
    const greetName = extractGreetingName(email || "");
    const greeting  = greetName ? `Hi ${greetName},` : "Hi,";
    return `${greeting}

I came across ${name} while looking at brokerages${city ? ` in ${city}` : ""}.

One thing that consistently affects conversion rates is speed-to-lead — web inquiries that don't get a response within a few minutes have a significantly lower close rate. Past-client reactivation is another area most teams want to do but rarely have a consistent system for.

I built a lightweight automation that handles both: instant lead acknowledgement, showing reminders, and a reactivation sequence for clients who transacted 1–2 years ago. One-time setup, no monthly fee.

Worth a quick look? I can send a 1-page overview specific to ${name || "your team"}.

Mohamed
ClinicFlow Automation`;
  },

};

export const MARKET_SUBJECT = {
  physio: (name, city) => {
    const seed = _hashStr((name || "") + (city || ""));
    const variants = [
      `Missed bookings at ${name}`.slice(0, 52),
      `10–15 extra appointments — ${name}`.slice(0, 52),
      `Cancellation slots at ${name}`.slice(0, 52),
      `Inactive patients at ${name}`.slice(0, 52),
    ];
    return _pick(variants, seed);
  },
  salon:       (name, city, _email, reviewQuote) => {
    const { subject } = pickSalonVariant(name, city, "", reviewQuote || "");
    return subject;
  },
  legal:       (name)       => `Quick question for ${name}`.slice(0, 52),
  realestate:  (name)       => `Quick question for ${name}`.slice(0, 52),
  // nowebsite uses its own template module — these are stubs for sendBatch fallback
  nowebsite:   (name)       => `Quick question — ${name}`.slice(0, 52),
};
