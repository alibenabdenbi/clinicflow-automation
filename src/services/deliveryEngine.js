// src/services/deliveryEngine.js
// Generates the full automation package for a paying ClinicFlow client.
// Uses Claude (Anthropic SDK) to write the actual email sequences and guides.
// Saves all files to data/deliveries/[clientname]/

import fs from "fs";
import path from "path";
import Anthropic from "@anthropic-ai/sdk";
import dotenv from "dotenv";
import { extractGreetingName } from "./emailPersonalizer.js";

dotenv.config();

const DELIVERIES_DIR = path.join(process.cwd(), "data", "deliveries");

// ─── Tier definitions ─────────────────────────────────────────────────────────

const TIER_DELIVERABLES = {
  starter: [
    "missed-call-followup.md",     // 3-email missed call recovery sequence
    "appointment-reminder.md",     // appointment reminder template (72h + 24h)
    "monthly-newsletter.md",       // monthly patient newsletter template
    "tracking-spreadsheet.md",     // simple tracking doc instructions
    "setup-summary.md",            // what was built + how to use it
    "setup-guide.md",              // step-by-step Mailchimp + Gmail setup
  ],
  growth: [
    "missed-call-followup.md",
    "appointment-reminder.md",
    "monthly-newsletter.md",
    "tracking-spreadsheet.md",
    "reactivation-campaign.md",    // 5-email dormant patient reactivation
    "new-patient-welcome.md",      // 4-email new patient welcome sequence
    "review-request.md",           // automated Google review request
    "setup-summary.md",
    "setup-guide.md",              // step-by-step Mailchimp + Gmail setup
  ],
  full: [
    "missed-call-followup.md",
    "appointment-reminder.md",
    "monthly-newsletter.md",
    "tracking-spreadsheet.md",
    "reactivation-campaign.md",
    "new-patient-welcome.md",
    "review-request.md",
    "branded-templates.md",        // custom branded email templates
    "90-day-patient-journey.md",   // 90-day patient journey map
    "staff-training-guide.md",     // staff training guide
    "monthly-reporting-template.md",
    "setup-summary.md",
    "setup-guide.md",              // step-by-step Mailchimp + Gmail setup
  ],
};

// ─── Claude prompt builder ────────────────────────────────────────────────────

function buildPrompt(deliverable, { name, city, website, tier }) {
  const ctx = `Clinic: ${name}, ${city}${website ? `, website: ${website}` : ""}. Tier: ${tier}.`;

  const prompts = {
    "missed-call-followup.md": `Write a 3-email sequence for ${name} in ${city} to follow up with patients who called but got no answer.
Email 1 (sent within 2 minutes): apologize, offer to call back or book online.
Email 2 (sent 2 hours later if no response): gentle reminder, emphasize convenience.
Email 3 (sent next morning): final outreach, offer direct phone time.
Keep each email under 80 words. Plain, warm, professional — not salesy. Use [PatientFirstName] placeholder. Include subject line for each.`,

    "appointment-reminder.md": `Write appointment reminder templates for ${name} in ${city}.
Include: 72-hour reminder (SMS format, under 160 chars), 24-hour reminder (SMS), day-of reminder (optional SMS).
Also include: confirmation reply instructions (patient replies YES/NO), cancellation/reschedule message.
Use [PatientFirstName], [AppointmentDate], [AppointmentTime], [ClinicPhone] as placeholders.`,

    "monthly-newsletter.md": `Write a monthly patient newsletter template for ${name} in ${city}.
Include: warm greeting, one dental health tip (seasonal/rotating), a gentle recall reminder, one promotion or service highlight, and a soft CTA to book.
Keep it under 250 words. Friendly, not clinical. Include subject line. Use [Month], [ClinicName] placeholders.`,

    "tracking-spreadsheet.md": `Create instructions for a simple tracking spreadsheet for ${name}'s automation system.
Include columns for: Patient Name, Phone, Email, Last Visit Date, Recall Due Date, Missed Call (Y/N), Follow-up Sent (Y/N), Appointment Booked (Y/N), Notes.
Provide Google Sheets setup instructions, color coding guide, and a monthly review checklist.`,

    "reactivation-campaign.md": `Write a 5-email reactivation campaign for dormant patients of ${name} in ${city} (patients not seen in 12+ months).
Email 1 (month 0): warm "we miss you" message.
Email 2 (week 2): reminder of services, what's new.
Email 3 (week 4): gentle nudge with a reason to come back (seasonal cleaning, new tech, etc.).
Email 4 (week 6): mild urgency — "your spot may be given to new patients".
Email 5 (week 8): graceful exit — leave door open.
Each under 100 words. Include subject lines. Use [PatientFirstName] placeholder.`,

    "new-patient-welcome.md": `Write a 4-email new patient welcome sequence for ${name} in ${city}.
Email 1 (day of booking): confirmation + what to expect, parking/directions if needed.
Email 2 (day before appointment): reminder + preparation tips (nothing to eat if sedation, etc. — keep generic).
Email 3 (day after first visit): thank you, care tips, next appointment reminder.
Email 4 (1 week later): check-in, review request, recall scheduling.
Under 100 words each. Subject lines included. Warm and personal tone.`,

    "review-request.md": `Write an automated review request sequence for ${name} in ${city}.
Primary message (sent 2 days after appointment): warm thank-you + Google review request with [ReviewLink] placeholder.
Follow-up (sent if no review after 5 days): gentle second ask.
Include instructions for where to get the Google review link and how to set up the automation trigger.
Keep both messages under 80 words. Conversational, never pushy.`,

    "branded-templates.md": `Create a brand voice guide and 5 custom email templates for ${name} in ${city}.
Brand voice section: 3 adjectives that describe the clinic's tone, do/don't list for language, sample phrases.
Templates: Welcome email, Recall reminder, Special offer, Seasonal message (winter oral health), Patient birthday greeting.
Each template: subject line + body under 150 words. Headers in the brand voice. [Placeholders] clearly marked.`,

    "90-day-patient-journey.md": `Create a 90-day patient journey map for a new patient at ${name} in ${city}.
Map every touchpoint from first call to 90-day follow-up: initial inquiry, booking confirmation, pre-visit reminders, day-of, post-visit, recall setup, review request, reactivation trigger.
For each touchpoint: what's sent, when, via what channel (SMS/email/call), and what action it triggers.
Format as a clear day-by-day timeline. Practical and specific.`,

    "staff-training-guide.md": `Write a staff training guide for ${name}'s automation system.
Sections: Overview (what's automated, what staff still handles), Daily responsibilities, How to handle replies from automation messages, Escalation process, FAQ from patients, How to pause/stop campaigns.
Keep it practical — written for a front-desk person, not a tech person. Under 800 words total.`,

    "monthly-reporting-template.md": `Create a monthly reporting template for ${name} to track their automation results.
Include metrics: Missed calls recovered, Appointment reminders sent / confirmed / no-shows, Reactivation emails sent / patients reactivated, Reviews requested / received, New patients welcomed.
Include a simple month-over-month comparison table and a "wins this month" section.
Instructions for how to pull each metric from their systems.`,

    "setup-guide.md": `Write a plain-language setup guide for ${name} in ${city} to configure their ClinicFlow ${tier} automations in Mailchimp and Gmail.
Mailchimp section: step-by-step instructions for each automation (missed call, reminders, welcome, reactivation, reviews). Include where to click, what to name things, what delay to set.
Gmail section: simpler manual workflow using Gmail templates for clinics not ready for Mailchimp.
For each automation include: estimated setup time, who at the clinic should handle it (dentist / front desk / office manager).
End with a quick-reference table: automation, setup time, ongoing time per month, who handles it.
Written for a practice manager, not a developer. Clear and specific.`,

    "setup-summary.md": `Write the setup summary document delivered to ${name} in ${city} after their ClinicFlow ${tier} setup.
Include: What was built (list each automation), How each one works (1-2 sentences each), How to pause or stop an automation, What to do if something breaks, How to contact support, What happens next (follow-up schedule).
Professional, clear, reassuring tone. Under 600 words.`,
  };

  return prompts[deliverable] || `Write professional content for: ${deliverable}. Context: ${ctx}`;
}

// ─── Static fallback content (used when ANTHROPIC_API_KEY is not set) ─────────

function staticFallback(deliverable, { name, city, tier }) {
  const clinic = name || "your clinic";
  const tierLabel = tier.charAt(0).toUpperCase() + tier.slice(1);

  const fallbacks = {

// ─────────────────────────────────────────────────────────────────────────────
"missed-call-followup.md": `# Missed Call Follow-Up Sequence — ${clinic}

This sequence fires automatically when a patient calls and no one answers.
Trigger: missed call detected → Email 1 fires within 2 minutes.

---

## Email 1 — Within 2 Minutes of Missed Call

**Subject:** We just missed your call — ${clinic}

Hi [PatientFirstName],

We saw your call come in and we're sorry we missed you — we were most likely with another patient.

We'll call you back as soon as we're free, usually within the hour. If you'd rather not wait, you can book directly at [BookingLink] — it only takes a minute.

Talk soon,
The ${clinic} Team
[ClinicPhone]

---

## Email 2 — 2 Hours Later (if no response to Email 1)

**Subject:** Still hoping to connect — ${clinic}

Hi [PatientFirstName],

We tried to get back to you but may have missed you again. We haven't forgotten.

Whenever it's convenient, give us a call at [ClinicPhone] or book a time that works for you directly at [BookingLink] — no hold times, no phone tag.

The ${clinic} Team

---

## Email 3 — Next Morning (final follow-up)

**Subject:** One last try from ${clinic}

Hi [PatientFirstName],

We wanted to reach out one more time. If you're still looking for a dentist in ${city}, we'd genuinely love to help.

Call us at [ClinicPhone] whenever you're ready, or book at [BookingLink]. No pressure either way.

Warmly,
The ${clinic} Team

---

**Implementation note:** These messages fire automatically — no front desk action required. Patient replies land in your regular inbox. If a patient books, the remaining emails in the sequence cancel automatically.

**Privacy:** This automation complies with PIPEDA (Canadian privacy law). Patient data is never stored or shared by ClinicFlow.`,

// ─────────────────────────────────────────────────────────────────────────────
"appointment-reminder.md": `# Appointment Reminder Templates — ${clinic}

---

## 72-Hour SMS Reminder

Hi [PatientFirstName], this is ${clinic}. Your appointment is on [AppointmentDate] at [AppointmentTime]. Reply YES to confirm or call [ClinicPhone] if you need to reschedule. See you soon!

*(~160 chars — adjust "See you soon!" if your SMS platform requires strict 160-char limit)*

---

## 24-Hour SMS Reminder

Hi [PatientFirstName], see you tomorrow at [AppointmentTime] at ${clinic}! If anything comes up, call [ClinicPhone] and we'll find another time. Looking forward to it.

---

## Day-Of Reminder (Optional — send 2 hours before)

Hi [PatientFirstName], your appointment at ${clinic} is in about 2 hours ([AppointmentTime]). See you soon!

---

## Patient Confirms (replies YES)

Great — we'll see you at [AppointmentTime], [PatientFirstName]. If anything changes before then, just call [ClinicPhone].

---

## Patient Cancels (replies NO or CANCEL)

No problem at all, [PatientFirstName]. We've freed up your spot. Whenever you're ready to rebook, visit [BookingLink] or call us at [ClinicPhone] — we'll find a time that works for you.

---

## Patient Doesn't Respond (send if no reply to 72h reminder, 24h before appointment)

Hi [PatientFirstName], just checking in — we haven't heard back about your appointment tomorrow at [AppointmentTime]. Reply YES to confirm, or call [ClinicPhone] if you need to reschedule. Thanks!`,

// ─────────────────────────────────────────────────────────────────────────────
"monthly-newsletter.md": `# Monthly Patient Newsletter — ${clinic}

**Usage:** Send once per month to your active patient list. Choose the seasonal tip that fits the current month. The clinic update section takes 1 sentence — swap it each month. Total personalization time: under 5 minutes.

---

**Subject:** [Month] — a note from ${clinic}

Hi [PatientFirstName],

Quick update from ${clinic} — we'll keep it short.

**This month's tip** *(choose one by season)*:

- *Jan/Feb:* Post-holiday reset — if you've been indulging in sweets, now's the right time for a professional clean. Enamel damage from diet often shows up 4–6 weeks later, and a cleaning catches it before it costs more to fix.
- *Mar/Apr:* Spring allergy season causes dry mouth in a lot of patients, which raises cavity risk. Drink extra water, and if you're using antihistamines regularly, let us know at your next visit.
- *May/Jun:* Before summer travel, get any outstanding work done — dental care on the road is inconvenient and expensive. If you've been putting something off, now's a good time to clear it.
- *Jul/Aug:* Sports season reminder — if you or your kids play contact sports, ask us about custom mouthguards. Store-bought versions don't protect nearly as well.
- *Sep/Oct:* Back-to-school season: children should see a dentist every 6 months. If a checkup is overdue, book before the November rush fills up our schedule.
- *Nov/Dec:* Year-end reminder — if you have dental benefits, they typically reset January 1st. Any unused coverage disappears. Book before December to use what you've paid for.

**Your next visit:** If it's been 6 months or more since your last cleaning, you're due. Our schedule fills up — grab a time at [BookingLink] or call [ClinicPhone].

**At ${clinic} this month:** [One sentence — e.g. "We're now direct billing to Sun Life and Manulife." / "We've added Thursday evening hours." / "We're welcoming Dr. [Name] to our team."]

Thanks for being part of our practice. We look forward to seeing you.

— The ${clinic} Team
[ClinicPhone] | [BookingLink]

---
*To stop receiving these updates, reply with "unsubscribe" and we'll remove you immediately.*`,

// ─────────────────────────────────────────────────────────────────────────────
"tracking-spreadsheet.md": `# Automation Tracking Guide — ${clinic}

## Setup (5 minutes)

1. Go to **sheets.google.com** → New spreadsheet
2. Name it: **${clinic} — Automation Tracker**
3. Share with your front desk manager and practice owner (Editor access)
4. Create the tabs below

---

## Tab 1: Missed Call Recovery

| Date | Patient Name | Phone | Email Sent (Y/N) | Called Back (Y/N) | Appointment Booked (Y/N) | Notes |
|------|-------------|-------|-----------------|------------------|--------------------------|-------|

**Target:** 35–50% of missed calls should convert to booked appointments within 48 hours.

**Monthly check:** Count "Appointment Booked = Y" ÷ total rows = your recovery rate. If below 30%, check that the phone system is triggering correctly.

---

## Tab 2: Appointment Reminders

| Week of | Reminders Sent | Confirmed (YES) | Cancelled | No Response | Actual No-Shows |
|---------|---------------|-----------------|-----------|-------------|-----------------|

**Formula — confirmation rate:** \`=COUNTIF(C:C,"YES")/B2\` (adjust row reference)

**Target:** 65–75% confirmation rate. If lower, check that SMS numbers in your system are current.

**No-show tracking:** Compare "No Response" column with actual no-shows from your PMS to see how many unconfirmed patients still showed up.

---

## Tab 3: Reactivation Campaign *(Growth/Full)*

| Patient Name | Last Visit | Months Inactive | Email 1 Sent | Email 2 Sent | Reply Received | Rebooked (Y/N) |
|-------------|-----------|-----------------|-------------|-------------|----------------|----------------|

**Formula — months inactive:** \`=DATEDIF(B2,TODAY(),"M")\` (where B2 = last visit date)

**Target:** 15–25% rebook rate from reactivation sequences is strong. Below 10% usually means the patient list is too stale (2+ years inactive) — focus on the 12–18 month window first.

---

## Tab 4: Monthly Summary

| Month | Missed Calls Recovered | Reactivations Rebooked | Reviews Received | New Patients Welcomed |
|-------|----------------------|----------------------|------------------|-----------------------|

Fill this in on the first Monday of each month. It takes 10 minutes and gives you a clear trend line within 3 months.

---

## Conditional Formatting Rules

Apply via **Format → Conditional Formatting** on the "Last Visit" column in Tab 3:

- **Red fill:** \`=AND(B2<>"",DATEDIF(B2,TODAY(),"M")>=12)\` — reactivation candidates
- **Yellow fill:** \`=AND(B2<>"",DATEDIF(B2,TODAY(),"M")>=6,DATEDIF(B2,TODAY(),"M")<12)\` — recall due
- **Green fill:** \`=AND(B2<>"",DATEDIF(B2,TODAY(),"M")<6)\` — recently active

---

## Monthly Review Checklist (15 minutes, first Monday of each month)

- [ ] Fill in Tab 4 with last month's totals
- [ ] Check missed call recovery rate — trending up or down?
- [ ] Review Tab 3: any reactivation patients who replied but didn't book? Follow up personally.
- [ ] Check for automation replies in your inbox that need a human response
- [ ] If reactivation queue has 20+ patients, send the list to contact@clinicflowautomation.com for next batch`,

// ─────────────────────────────────────────────────────────────────────────────
"reactivation-campaign.md": `# Patient Reactivation Campaign — ${clinic}

**Who this targets:** Patients with no appointment in the last 12+ months.
**When to run:** Monthly — export your inactive patient list from your PMS and send it to contact@clinicflowautomation.com. We'll upload and launch within 24 hours.
**Best results:** Focus on the 12–18 month window first. Patients inactive 2+ years have much lower response rates.

---

## Email 1 — "We've been thinking about you" (Week 1)

**Subject:** It's been a while, [PatientFirstName]

Hi [PatientFirstName],

We noticed it's been some time since we've seen you at ${clinic}, and we wanted to check in.

Life gets busy — we completely understand. But a professional cleaning every 6 months catches the small things before they become expensive ones, and we'd love to get you back on track.

Book at [BookingLink] whenever you're ready, or call [ClinicPhone] and we'll take it from there.

The ${clinic} Team

---

## Email 2 — "What's new with us" (Week 2)

**Subject:** What's new at ${clinic}

Hi [PatientFirstName],

Just a quick update — in case it changes things for you.

Since you were last in, [choose one: "we've added same-day emergency appointments" / "we now direct bill to more insurance providers" / "we've updated our equipment for faster, more comfortable cleanings"]. We're always looking for ways to make visits easier.

If you've been putting off coming in for any reason, let's talk. Call [ClinicPhone] or book directly at [BookingLink].

The ${clinic} Team

---

## Email 3 — "A real reason to come back now" (Week 4)

**Subject:** Quick question, [PatientFirstName]

Hi [PatientFirstName],

One quick question: when was the last time you had a professional cleaning?

Most dental issues — early cavities, gum inflammation, enamel wear — take 12–18 months to become noticeable. A cleaning now catches what brushing misses and usually prevents a much more expensive fix later.

We have openings coming up. Grab one at [BookingLink] or call [ClinicPhone].

The ${clinic} Team

---

## Email 4 — "Gentle urgency" (Week 6)

**Subject:** [PatientFirstName], we want to hold your spot

Hi [PatientFirstName],

We try to keep preferred appointment times available for patients who've been with us — but when we haven't heard from someone for a while, those slots go to new patients on our waitlist.

If you'd like to keep your preferred time at ${clinic}, now's a good moment to book. [BookingLink] or [ClinicPhone].

If you've moved on to another dentist, no hard feelings — just reply and let us know, and we'll update your file.

The ${clinic} Team

---

## Email 5 — "The door stays open" (Week 8)

**Subject:** Our last email to you, [PatientFirstName]

Hi [PatientFirstName],

We're going to stop here — we don't want to be another thing in your inbox.

If you ever want to come back to ${clinic}, we'll be here. No awkward re-introductions needed — just book at [BookingLink] and we'll pick up where we left off.

We hope your smile has been treating you well.

Take care,
The ${clinic} Team
[ClinicPhone]

---

**How to launch a batch:** Export patients from your PMS (filter: last visit > 12 months ago). Send the list to contact@clinicflowautomation.com with the subject "Reactivation batch — ${clinic}". We'll confirm receipt and launch within 24 hours.`,

// ─────────────────────────────────────────────────────────────────────────────
"new-patient-welcome.md": `# New Patient Welcome Sequence — ${clinic}

**Trigger:** Fires automatically when a new patient books their first appointment.
**Goal:** Reduce no-shows, set expectations, start the relationship right.

---

## Email 1 — Confirmation (Day of Booking)

**Subject:** You're booked at ${clinic}

Hi [PatientFirstName],

Welcome — we're glad you chose ${clinic}.

Here's what you need before your visit:

- **Appointment:** [AppointmentDate] at [AppointmentTime]
- **Address:** [ClinicAddress], ${city}
- **Parking:** [Add parking details — e.g. "Free parking in our lot off [Street]" or "Street parking on [Street], usually available"]
- **New patient form:** [NewPatientFormLink] — takes about 3 minutes, saves time at the front desk

If you have dental X-rays from a previous dentist, feel free to bring them or ask your old clinic to send them ahead — it helps us skip the redundant work.

Any questions before your visit? Reply here or call [ClinicPhone].

We're looking forward to meeting you.

— The ${clinic} Team

---

## Email 2 — Preparation Reminder (Day Before Appointment)

**Subject:** See you tomorrow, [PatientFirstName]

Hi [PatientFirstName],

Your appointment at ${clinic} is tomorrow at [AppointmentTime]. A few things that make first visits smoother:

- Arrive 5–10 minutes early to complete any remaining paperwork
- Bring your insurance card if you have coverage
- Let us know of any medications you're currently taking when you arrive
- If you have any anxiety about dental visits, just mention it — we have options that help

If anything changes before tomorrow, call [ClinicPhone] as soon as possible and we'll sort it out.

See you then.
The ${clinic} Team

---

## Email 3 — Post-Visit Thank You (Day After Appointment)

**Subject:** Great to meet you, [PatientFirstName]

Hi [PatientFirstName],

Thank you for coming in yesterday — it was genuinely great to meet you.

A few things to keep in mind after your visit:
- Brush twice a day, floss once — consistency matters more than technique
- If any work you had done is still a little sensitive, that's normal and usually settles within 48 hours. Call us if it doesn't.
- Your next recommended visit is around [NextVisitDate] — we'll remind you as it gets closer

If you have any questions about your treatment plan or what we discussed, reply here or call [ClinicPhone].

Looking forward to seeing you again.
The ${clinic} Team

---

## Email 4 — 1-Week Check-In + Review Request (7 Days After Visit)

**Subject:** How was everything, [PatientFirstName]?

Hi [PatientFirstName],

We hope everything felt good after your appointment last week.

Two small things:

**1. If you have 60 seconds:** It would mean a lot if you shared your experience on Google. It helps other people in ${city} find a dentist they can trust, and it genuinely helps our practice.
→ [ReviewLink]

**2. Your next visit:** Most patients come back every 6 months for a cleaning. We can pre-book your spot now so you don't have to think about it later — call [ClinicPhone] or book at [BookingLink].

Thanks again for choosing ${clinic}.

The ${clinic} Team

---

**Note:** The [ReviewLink] should be your Google Business Profile review URL. Get it by searching "${clinic} ${city}" on Google Maps, clicking your listing, then clicking "Write a review" and copying the URL. Test it yourself first.`,

// ─────────────────────────────────────────────────────────────────────────────
"review-request.md": `# Google Review Request Sequence — ${clinic}

**Trigger:** Fires 2 days after a completed appointment.
**Goal:** Generate a steady stream of authentic Google reviews from happy patients.

---

## Primary Message — 2 Days After Appointment

**Subject:** A quick favour, [PatientFirstName]

Hi [PatientFirstName],

We hope your appointment went well and you're feeling good.

If you have 60 seconds, would you mind leaving us a review on Google? It helps other people in ${city} find a dentist they can actually trust — and it means a lot to our team.

→ [ReviewLink]

If anything about your visit wasn't quite right, please reply here instead. We'd rather hear it directly and have the chance to fix it.

Thank you either way.

The ${clinic} Team

---

## Follow-Up — 5 Days After Primary Message (if no review)

**Subject:** Still here, [PatientFirstName]

Hi [PatientFirstName],

We sent a note a few days ago about a Google review — completely understand if the timing wasn't right.

If you have a minute, we'd still appreciate it: [ReviewLink]

Either way, we're glad you came in, and we look forward to seeing you at your next visit.

The ${clinic} Team

---

## How to Get Your Google Review Link

1. Search **${clinic} ${city}** on Google Maps
2. Click your clinic listing
3. Click **"Write a review"**
4. Copy the full URL from your browser
5. Replace [ReviewLink] in both templates above with this URL

**Test it:** Open the link in a private/incognito browser window and confirm it opens the review box directly, not just your listing page.

---

## Responding to Negative Reviews

If a patient leaves 1–3 stars, respond within 24 hours:

> "Thank you for taking the time to leave feedback, [PatientFirstName]. We're sorry your experience wasn't what we hoped for — we'd very much like to understand what happened and make it right. Please call us at [ClinicPhone] so we can speak directly."

Keep it brief. Never identify the patient's treatment publicly. Never argue. A professional response to a negative review is often more reassuring to potential patients than the review itself.`,

// ─────────────────────────────────────────────────────────────────────────────
"branded-templates.md": `# Brand Voice & Custom Email Templates — ${clinic}

---

## Brand Voice Guide

**Three words that describe ${clinic}'s communication style:**
1. **Warm** — patients are people, not chart numbers. Use first names. Acknowledge their time.
2. **Clear** — no jargon, no corporate language. If a Grade 8 student can't read it, rewrite it.
3. **Trustworthy** — never pushy, never alarmist. Earn confidence through calm competence.

**Do:**
- Use contractions (we're, you're, we've)
- Write short sentences. Break up paragraphs.
- End emails with one clear action, not three
- Acknowledge inconvenience when it exists ("we know mornings are busy")

**Don't:**
- Use "synergy," "solutions," "cutting-edge," or "state-of-the-art"
- Use passive voice ("an appointment has been scheduled" → "we've booked your appointment")
- Write subject lines in ALL CAPS
- Add multiple CTAs to a single email

---

## Template 1: Welcome Email (New Patient, Pre-Visit)

**Subject:** Welcome to ${clinic}, [PatientFirstName]

Hi [PatientFirstName],

We're glad you found us.

Your appointment is confirmed for [AppointmentDate] at [AppointmentTime]. We're at [ClinicAddress] in ${city}.

If this is your first time at a dental clinic in a while — or if you're a bit nervous — just mention it when you arrive. We'll adjust the pace to make sure you're comfortable.

See you soon.
The ${clinic} Team | [ClinicPhone]

---

## Template 2: Recall Reminder (6-Month Cleaning Due)

**Subject:** Your cleaning is due, [PatientFirstName]

Hi [PatientFirstName],

It's been about 6 months since your last visit to ${clinic} — time for your regular cleaning and check-up.

These appointments are quick (usually 45–60 minutes) and the best way to stay ahead of anything that might be developing. Better to catch it now than in six months when it's bigger.

Book at [BookingLink] or call [ClinicPhone].

The ${clinic} Team

---

## Template 3: Special Offer / Service Highlight

**Subject:** Something you might not know we offer — ${clinic}

Hi [PatientFirstName],

Quick note — we wanted to share something we offer that a lot of patients aren't aware of: [service name, e.g. "same-day emergency appointments" / "custom nightguards for grinding" / "Invisalign consultations"].

If that's relevant to you or someone you know, we're happy to answer questions. Call [ClinicPhone] or reply here.

The ${clinic} Team

---

## Template 4: Seasonal Message (Winter Oral Health)

**Subject:** A few things worth knowing this winter, [PatientFirstName]

Hi [PatientFirstName],

A quick note heading into the colder months.

Two things that tend to come up this time of year: tooth sensitivity (cold air can trigger it, especially if enamel is worn) and dry mouth from indoor heating (which raises cavity risk). Neither is serious if caught early.

If either sounds familiar, mention it at your next visit and we'll take a look.

Warm winter wishes from all of us at ${clinic}.

The ${clinic} Team | [ClinicPhone]

---

## Template 5: Patient Birthday Greeting

**Subject:** Happy birthday from ${clinic}, [PatientFirstName]

Hi [PatientFirstName],

Wishing you a very happy birthday from everyone at ${clinic}.

As a small birthday note — if your teeth have been bothering you in any way, or if a visit is overdue, let us make it easy: [BookingLink] or [ClinicPhone]. Consider it a gift to yourself.

Enjoy your day.

The ${clinic} Team`,

// ─────────────────────────────────────────────────────────────────────────────
"90-day-patient-journey.md": `# 90-Day New Patient Journey — ${clinic}

This map covers every touchpoint from first contact to a fully engaged, recall-scheduled patient. Each step is automated unless marked [MANUAL].

---

## Day 0 — First Contact

**Event:** Patient calls or submits a web inquiry.

| If answered | If missed call |
|-------------|----------------|
| Book appointment, confirm details | Auto-text fires within 2 min |
| Send confirmation email (Email 1 of welcome sequence) | Email follow-up at 2h, next morning if no response |

**Goal:** Convert the inquiry to a booked appointment. Target: same-day or next-day slot offered.

---

## Day 0 (Booking Confirmed) — Welcome Email

**Channel:** Email
**Template:** New Patient Welcome, Email 1
**Content:** Confirmation details, address, parking, new patient form link
**Goal:** Reduce no-shows by confirming expectations immediately

---

## Day -1 (Day Before Appointment) — Preparation Reminder

**Channel:** Email + SMS
**Template:** New Patient Welcome Email 2 + 24h Appointment Reminder SMS
**Content:** What to bring, what to expect, how to reschedule
**Goal:** Confirm attendance, reduce last-minute cancellations

---

## Day 1 — Appointment Day

**Channel:** SMS (2 hours before)
**Template:** Day-Of Reminder SMS
**Content:** Brief confirmation, appointment time
**Goal:** Final nudge for forgetful patients

**[MANUAL] — Front desk:** Collect insurance info, confirm contact details are current in PMS

---

## Day 2 — Post-Visit Thank You

**Channel:** Email
**Template:** New Patient Welcome Email 3
**Content:** Thank you, post-care reminders, next visit date
**Goal:** Close the loop, establish trust, set recall expectation

---

## Day 9 — First Review Request

**Channel:** Email
**Template:** Review Request — Primary Message
**Content:** Warm ask for Google review, with direct link
**Goal:** Capture the review while experience is fresh

Day 14 — Follow-up review request if no review received.

---

## Day 30 — [MANUAL] Check-In Flag

**Action:** Front desk checks PMS — did patient schedule a follow-up or second appointment?
- If yes: mark as "active" in tracker
- If no: flag for Month 3 recall reminder

---

## Month 6 — Recall Reminder

**Channel:** Email + SMS
**Template:** Monthly newsletter + recall SMS
**Content:** "Your 6-month cleaning is due"
**Goal:** Prevent patient from going inactive

---

## Month 12 — Reactivation Trigger

**Condition:** If patient has not visited in 12 months
**Channel:** Email (5-part reactivation sequence)
**Goal:** Re-engage before the patient drifts to a competitor

---

## Summary of Automations by Day

| Day | Touchpoint | Channel | Automated? |
|-----|-----------|---------|------------|
| 0 | Missed call follow-up | Email/SMS | Yes |
| 0 | Booking confirmation | Email | Yes |
| -1 | Pre-visit reminder | Email + SMS | Yes |
| 1 | Day-of reminder | SMS | Yes |
| 2 | Post-visit thank you | Email | Yes |
| 9 | Review request | Email | Yes |
| 14 | Review follow-up | Email | Yes |
| 30 | Active patient check | PMS review | Manual |
| 180 | 6-month recall | Email + SMS | Yes |
| 365 | Reactivation (if lapsed) | 5-email sequence | Yes |`,

// ─────────────────────────────────────────────────────────────────────────────
"staff-training-guide.md": `# Staff Training Guide — ${clinic} Automation System

**Who this is for:** Front desk staff and practice managers.
**What this covers:** What the automations do, what your role is, and how to handle anything unexpected.

---

## What's Automated (You Don't Need to Do These)

| Automation | What it does | When it fires |
|-----------|-------------|---------------|
| Missed call follow-up | Texts and emails the patient within 2 minutes | Every missed call |
| Appointment reminders | SMS at 72h and 24h before each appointment | Automatically before every appointment |
| New patient welcome | 4-email sequence from booking to 1 week post-visit | Every new patient booking |
| Review requests | Email asking for a Google review | 2 days after each completed appointment |
| Reactivation campaign | 5-email sequence for inactive patients | Launched monthly (you send us the list) |
| Monthly newsletter | Template-based patient update | You fill in 2 fields and we send it |

**Important:** Do not manually send any of these messages — the automation is already doing it. Sending duplicates confuses patients and triggers spam filters.

---

## What You Still Handle

1. **Replies from patients** — Any patient who replies to an automated message lands in your regular inbox. Treat these like normal patient emails.

2. **Calls from patients who got an automated message** — Answer normally. You don't need to reference the automation.

3. **New patient forms** — Make sure the link in the welcome email goes to your current form. Check it monthly.

4. **Monthly reactivation batch** — Export inactive patients from your PMS (last visit > 12 months) and email the list to contact@clinicflowautomation.com. We handle the rest.

5. **Tracking spreadsheet** — Update it on the first Monday of each month (takes 15 minutes).

---

## Common Patient Questions

**"I got a text saying I missed my appointment but I never had one."**
The automation fires on missed *calls*, not missed appointments. The patient called, no one answered, and the system followed up. Treat it as a lead — book them in.

**"I keep getting reminder texts — how do I make it stop?"**
Check if they're in the system multiple times (duplicate records in PMS). Merge duplicates. If it's a single record, email contact@clinicflowautomation.com.

**"I got a review request email but I didn't just have an appointment."**
The trigger is based on "appointment completed" status in your PMS. Check if someone accidentally marked an old appointment as completed. Update the status and let us know.

**"I replied to an email and got no response."**
Patient replies go to your regular inbox at [ClinicPhone email]. Check the inbox — it may have gone to a subfolder.

---

## How to Pause an Automation

Email **contact@clinicflowautomation.com** with:
- Subject: \`Pause [automation name] — ${clinic}\`
- Body: Reason and how long (e.g. "pausing missed call follow-up for 2 weeks — front desk coverage issue")

We'll confirm and pause within 4 business hours.

---

## Escalation

| Issue | Who handles it |
|-------|----------------|
| Patient complaint about automation | Front desk responds, escalate to practice manager if needed |
| Automation not firing | Email contact@clinicflowautomation.com |
| Patient data concerns | Practice owner + contact@clinicflowautomation.com |
| Anything urgent | Call [ClinicPhone] and also email us — we monitor both |

Response time: within 4 business hours on weekdays.`,

// ─────────────────────────────────────────────────────────────────────────────
"monthly-reporting-template.md": `# Monthly Automation Report — ${clinic}

**Fill this in on the first Monday of each month. Takes 15 minutes.**

---

## Report for: [Month Year]

### Missed Call Recovery

| Metric | This Month | Last Month | Change |
|--------|-----------|-----------|--------|
| Total missed calls | | | |
| Follow-up sequences triggered | | | |
| Patients who called back / replied | | | |
| Appointments booked from follow-up | | | |
| **Recovery rate** (booked ÷ missed calls) | | | |

Target recovery rate: **35–50%**

---

### Appointment Reminders

| Metric | This Month | Last Month | Change |
|--------|-----------|-----------|--------|
| Reminders sent (72h + 24h) | | | |
| Confirmed (YES reply) | | | |
| Cancelled via SMS | | | |
| No response | | | |
| Actual no-shows | | | |
| **No-show rate** (no-shows ÷ total appointments) | | | |

Target no-show rate: **<10%**

---

### Reactivation Campaign *(Growth/Full)*

| Metric | This Month | Last Month | Change |
|--------|-----------|-----------|--------|
| Patients in active sequence | | | |
| Replies received | | | |
| Appointments rebooked | | | |
| **Rebook rate** (rebooked ÷ in sequence) | | | |

Target rebook rate: **15–25%**

---

### Reviews

| Metric | This Month | Last Month | Change |
|--------|-----------|-----------|--------|
| Review requests sent | | | |
| Google reviews received | | | |
| Average star rating (current) | | | |
| **Request-to-review rate** | | | |

Target request-to-review rate: **15–25%**

---

### New Patient Welcome

| Metric | This Month | Last Month | Change |
|--------|-----------|-----------|--------|
| New patients welcomed | | | |
| Completed all 4 emails | | | |
| Booked follow-up appointment | | | |

---

## Wins This Month

*(List 2–3 specific wins — e.g. "Recovered 8 missed calls, 4 booked same week" / "Reactivated 3 patients from June batch")*

1.
2.
3.

---

## Issues / Adjustments Needed

*(Note anything that didn't work as expected, patient complaints, or sequences that need updating)*

---

## Next Month's Focus

*(One or two priorities — e.g. "Launch larger reactivation batch" / "Test new review request subject line" / "Update newsletter for holiday season")*

---

*Report prepared by: [Name] | Date: [Date]*
*Send a copy to contact@clinicflowautomation.com for your records.*`,

// ─────────────────────────────────────────────────────────────────────────────
"setup-guide.md": `# Client Setup Guide — ${clinic}

**What this covers:** How to configure your ClinicFlow automations in Mailchimp (recommended) or Gmail (simpler manual option).

**Who should do this:** Office manager or practice manager. No technical background needed.

**Total setup time:** Approximately 2–3 hours for ${tier === "growth" || tier === "full" ? "the full Growth package" : "the Starter package"}.

---

## Option A — Set Up in Mailchimp (Recommended)

Mailchimp's free plan supports up to 500 contacts and 1,000 emails/month — enough for most clinics to start. Automations are included in the free plan.

**Before you start:** Create a free account at mailchimp.com using your clinic email.

---

### Automation 1: Missed Call Recovery
*Setup time: 30 minutes | Who: Office manager*

1. In Mailchimp, click **Automations** in the left sidebar → **Create**
2. Select **Classic Automations** → **Welcome new subscribers**
3. Rename the automation: **"Missed Call Recovery — ${clinic}"**
4. Click **Edit trigger** → change to **API / Zapier** (your phone system or Zapier will fire this)
5. Add **Email 1** (Immediate):
   - Click **Add email** → set delay to **immediately**
   - Subject and body: copy from **missed-call-followup.md, Email 1**
6. Add **Email 2** (2 hours):
   - Delay: **2 hours** after previous email
   - Content: copy from **missed-call-followup.md, Email 2**
7. Add **Email 3** (Next morning):
   - Delay: **1 day** after previous email
   - Content: copy from **missed-call-followup.md, Email 3**
8. Click **Next** → **Start Sending**

---

### Automation 2: Appointment Reminders
*Setup time: 20 minutes | Who: Office manager or front desk*

1. **Automations** → **Create** → **Classic Automation** → **Date-based**
2. Name: **"Appointment Reminders — ${clinic}"**
3. Set trigger to: **A contact's date** → select your appointment date field
4. Add Email/SMS at **72 hours before** → paste 72h reminder from **appointment-reminder.md**
5. Add Email/SMS at **24 hours before** → paste 24h reminder from **appointment-reminder.md**

**For SMS:** Mailchimp's free plan does not include SMS. Use **SimpleTexting** ($25/month) or **EZTexting** ($19/month) as a separate tool for the SMS templates.
${tier !== "starter" ? `
---

### Automation 3: New Patient Welcome
*Setup time: 30 minutes | Who: Office manager*

1. **Automations** → **Create** → **Classic Automation**
2. Name: **"New Patient Welcome — ${clinic}"**
3. Trigger: **Subscribes to list** (create a "New Patients" audience tag in Mailchimp — apply it when a new patient books)
4. Add 4 emails:
   - Email 1: Immediately on trigger → copy from **new-patient-welcome.md, Email 1**
   - Email 2: 1 day after trigger → copy from **new-patient-welcome.md, Email 2**
   - Email 3: 2 days after trigger → copy from **new-patient-welcome.md, Email 3**
   - Email 4: 8 days after trigger → copy from **new-patient-welcome.md, Email 4**
5. Replace **[ReviewLink]** in Email 4 with your Google Business Profile review URL

---

### Automation 4: Patient Reactivation Campaign
*Setup time: 30 minutes | Who: Office manager — repeat monthly*

1. Export inactive patients from your PMS: last visit > 12 months ago
2. In Mailchimp: **Audience** → **Import contacts** → upload CSV → tag as "Reactivation-[Month]"
3. **Automations** → **Create** → **Classic Automation**
4. Trigger: tagged with "Reactivation" tag
5. Add 5 emails with these delays (copy content from **reactivation-campaign.md**):
   - Email 1: Immediately
   - Email 2: 14 days after
   - Email 3: 28 days after
   - Email 4: 42 days after
   - Email 5: 56 days after

---

### Automation 5: Google Review Requests
*Setup time: 15 minutes | Who: Office manager*

1. **Automations** → **Create** → **Classic Automation** → **Date-based**
2. Name: **"Review Request — ${clinic}"**
3. Trigger: **A contact's date** → your appointment completed date field
4. Add Email 1: **2 days after** appointment date → copy from **review-request.md, Primary Message**
5. Add Email 2: **7 days after** appointment date → copy from **review-request.md, Follow-Up**
6. Replace **[ReviewLink]** with your Google Business Profile review URL` : ""}

---

## Option B — Set Up in Gmail (Simpler, Manual)

Gmail doesn't automate sends, but your front desk can use saved templates to send quickly.

### Create Gmail Templates
1. In Gmail → **Settings (gear)** → **See all settings** → **Advanced** tab
2. Enable **Templates** → **Save Changes**
3. Click **Compose** → write the email (copy from sequence files)
4. Bottom-right → **three dots (⋮)** → **Templates** → **Save draft as template** → name it (e.g., "Missed Call — Email 1")

### Daily Front Desk Workflow (Gmail)

| Task | When | Template to use |
|------|------|----------------|
| Missed call follow-up | Within 2 min of missed call | Missed Call — Email 1 |
| Appointment reminder (72h) | 3 days before each appointment | Reminder — 72h |
| Appointment reminder (24h) | 1 day before each appointment | Reminder — 24h |
| New patient welcome | Day of booking | Welcome — Email 1 |
| Review request | 2 days after visit | Review Request |

**Realistic time:** 3–5 min per email. For 20 patients/day, this is ~60–90 minutes. Mailchimp automation is worth setting up once volume exceeds 15 patients/day.

---

## Quick Reference

| Automation | Setup time | Monthly time | Who handles it |
|-----------|-----------|-------------|----------------|
| Missed call recovery | 30 min | 0 (automated) | Office manager (setup) |
| Appointment reminders | 20 min | 0 (automated) | Office manager (setup) |${tier !== "starter" ? `
| New patient welcome | 30 min | 0 (automated) | Office manager (setup) |
| Reactivation campaign | 30 min setup + monthly | 20 min/month | Office manager |
| Review requests | 15 min | 0 (automated) | Office manager (setup) |` : ""}
| Monthly newsletter | 15 min | 10 min/month | Office manager or dentist |
| Tracking spreadsheet | 10 min | 15 min/month | Office manager |
| **Total** | **~${tier === "starter" ? "1.5" : "2.5"} hours** | **~${tier === "starter" ? "25" : "45"} min/month** | — |

---

## Get Stuck? We Help.

Email us at any point during setup:

**Mohamed**
contact@clinicflowautomation.com
clinicflowautomation.com

Weekdays 9am–6pm ET — we typically reply within 4 hours. Screen-sharing calls available for Growth/Full clients.`,

// ─────────────────────────────────────────────────────────────────────────────
"setup-summary.md": `# What's Now Live — ${clinic}
## ClinicFlow ${tierLabel} Package

---

## What We Built for You

${tier === "starter" ? `Your Starter package is now live with 3 automation systems:

| # | Automation | Status |
|---|-----------|--------|
| 1 | **Missed Call Follow-up** | Live — fires within 2 minutes of a missed call |
| 2 | **Appointment Reminders** | Live — SMS at 72h and 24h before each appointment |
| 3 | **Monthly Newsletter** | Ready — we send on your behalf each month |` : tier === "growth" ? `Your Growth package is now live with 6 automation systems:

| # | Automation | Status |
|---|-----------|--------|
| 1 | **Missed Call Follow-up** | Live — fires within 2 minutes of a missed call |
| 2 | **Appointment Reminders** | Live — SMS at 72h and 24h before each appointment |
| 3 | **New Patient Welcome** | Live — 4-email sequence triggered on first booking |
| 4 | **Reactivation Campaign** | Live — 5-email sequence running for inactive patients |
| 5 | **Google Review Automation** | Live — fires 2 days after each completed visit |
| 6 | **Monthly Results Report** | Live — delivered to you on the first Monday each month |` : `Your Full package is now live — all automation systems are running. See below for what's active.`}

---

## What Happens Automatically from Here

Everything below runs without any action from your team:

- **Missed calls** → patients receive a follow-up text within 2 minutes
- **Upcoming appointments** → patients receive SMS reminders at 72h and 24h before their visit
- **Inactive patients** → reactivation emails go out on the schedule we built *(Growth/Full)*
- **New patients** → welcome sequence fires automatically on first booking *(Growth/Full)*
- **Post-visit** → Google review request fires 2 days after each completed appointment *(Growth/Full)*
- **Monthly** → you receive a results report summarizing everything sent and every response

---

## Your Only Job

Check the monthly report I send you and reply to any patient responses that land in your inbox.

That's it. You don't need to log into any dashboard, export any lists, or trigger anything manually.

---

## If You Need to Pause or Change Anything

Email **contact@clinicflowautomation.com** with:
- Subject: \`Change request — ${clinic}\`

We confirm and apply within 4 business hours. Your data is never deleted — pausing just stops future sends.

---

## Contact

**Mohamed**
ClinicFlow Automation
contact@clinicflowautomation.com
clinicflowautomation.com

Available weekdays 9am–6pm ET. All emails answered within 4 business hours.

---

## Privacy & Compliance

All automations comply with **PIPEDA** (Canada's Personal Information Protection and Electronic Documents Act). Patient data is never stored, sold, or shared. Patient lists used for reactivation campaigns are deleted after use.

---

*ClinicFlow ${tierLabel} Package — built for ${clinic} in ${city}.*
*30-day satisfaction guarantee. Delivered by ClinicFlow Automation.*`,

  };

  return fallbacks[deliverable]
    || `# ${deliverable.replace(/-/g, " ").replace(".md", "")} — ${clinic}\n\n[Contact contact@clinicflowautomation.com to receive this file — it is part of your ${tierLabel} package.]\n`;
}

// ─── Generate one file via Claude (with static fallback) ──────────────────────

async function generateFile(anthropic, deliverable, clientInfo) {
  if (!anthropic) {
    return staticFallback(deliverable, clientInfo);
  }

  const prompt = buildPrompt(deliverable, clientInfo);
  const message = await anthropic.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 1024,
    messages: [{ role: "user", content: prompt }],
  });

  return message.content[0]?.text || staticFallback(deliverable, clientInfo);
}

// ─── Onboarding email builder ─────────────────────────────────────────────────

/**
 * Build a personalized consultant-style onboarding email.
 * Sounds like a real person reviewed the clinic, not a template.
 */
function buildOnboardingEmail({ name, city, email, tier, website, doneForYou }) {
  const clinicName = name || "your clinic";

  return {
    to: email,
    subject: `Welcome to ClinicFlow — here's what happens next for ${clinicName}`,
    body: `Hi,

Payment received — thank you for trusting us with ${clinicName}.

Here's exactly what happens over the next 48 hours:

What I need from you (takes 5 minutes):
1. Your patient list — export as CSV from your booking system and reply with it attached
2. Three quick details:
   - The email your patients recognize (e.g. info@${clinicName.toLowerCase().replace(/\s+/g, "")}.com)
   - Your online booking link
   - Your Google review link (search your clinic on Google Maps → Write a Review → copy that URL)
3. Share your Google Calendar with contact@clinicflowautomation.com so I can set up appointment reminders

What I do once I have these (takes 48 hours):
- Build your patient reactivation campaign and start sending to inactive patients
- Set up appointment reminder SMS for upcoming bookings
- Configure your missed call follow-up sequence
- Send you a confirmation with everything that's live

You'll receive a confirmation email when your first automation goes live. After that you just check the monthly report I send you.

Any questions — reply here, I respond within 4 hours on weekdays.

Mohamed
ClinicFlow Automation
contact@clinicflowautomation.com`,
  };
}

// ─── Day-7 check-in email builder ─────────────────────────────────────────────

/**
 * Build the day-7 check-in email. Called by sendCheckIn.js.
 * @param {{ name, email }} client
 * @returns {{ to, subject, body }}
 */
export function buildDay7CheckIn({ name, email }) {
  const greetName = extractGreetingName(email || "");
  const greeting  = greetName ? `Hi ${greetName},` : "Hi,";
  return {
    to: email,
    subject: `Week 1 check-in — ${name}`,
    body: `${greeting}

One week in. Checking in on how the setup is going.

Three quick questions:

1. Have you seen any missed call recovery emails go out yet? You'll know if one fires — you get a copy to your inbox since you're the sender. If nothing has gone out, it usually means the trigger in Mailchimp needs a small adjustment — just reply here and I'll walk you through it in two minutes.

2. Did you get the tracking spreadsheet set up in Google Sheets? If not, it's worth doing this week — it takes 5 minutes and gives you a clear picture of what's working by the end of the month.

3. Any questions about the sequences before we move into week 2? Now is a good time to adjust anything before the reactivation batch goes out.

No need for a long reply — even a one-liner telling me where you're at helps me give you better support.

Mohamed
contact@clinicflowautomation.com`,
  };
}

// ─── Monthly report email builder ─────────────────────────────────────────────

/**
 * Build the monthly results report email for a client.
 * @param {{ name, email, tier, city }} client
 * @returns {{ to, subject, body }}
 */
export function buildMonthlyReportEmail({ name, email, tier, city }) {
  const month = new Date().toLocaleString("en-CA", { month: "long", year: "numeric" });
  const greetName = extractGreetingName(email || "");
  const greeting  = greetName ? `Hi ${greetName},` : "Hi,";

  const NEXT_STEP = {
    starter: `Consider upgrading to the Growth package to add the reactivation campaign. Clinics on the Starter plan who add the reactivation sequence typically see 8–15 additional booked appointments in the first batch — enough to cover the upgrade cost in month one. Email me if you want to talk through it.`,
    growth: `Your reactivation campaign should have run at least once this month. How many replies did you get? If it's fewer than 5, it's usually a list issue — we can adjust the targeting. Reply with your reactivation numbers and I'll give you specific feedback.`,
    full: `Schedule a 15-minute email review with me to plan next quarter. At this stage the automations are running — what we should look at now is whether the sequences need tuning based on your reply patterns and review growth. Reply to this email to book a time.`,
  };

  return {
    to: email,
    subject: `${month} results check-in — ${name}`,
    body: `${greeting}

Monthly check-in for ${name} in ${city}. Here's a quick template to fill in your results this month:

--- ${month} Results ---

Missed calls recovered (appointments booked from follow-up): ___
No-shows this month vs last month: ___
New Google reviews received: ___
${tier !== "starter" ? `Reactivation emails sent: ___ / Patients rebooked: ___\n` : ""}New patients through welcome sequence: ___
Any patient replies to automated messages that needed attention: ___

---

Fill those in and reply to this email — I'll review your numbers and send back specific feedback within 24 hours.

Recommended next step for your clinic:

${NEXT_STEP[tier] || NEXT_STEP.growth}

What's working well across our ${city} clients this month: appointment reminders sent 72 hours out are converting significantly better than 24-hour-only reminders. If you haven't set up the 72-hour reminder yet, that's your highest-ROI action this week.

Mohamed
contact@clinicflowautomation.com`,
  };
}

// ─── Main delivery engine ─────────────────────────────────────────────────────

/**
 * Generate the full delivery package for a client.
 * @param {{ name, city, email, tier, website }} clientInfo
 * @returns {{ deliveryDir, files, deliveryEmail }}
 */
export async function runDelivery(clientInfo) {
  const { name, city, email, tier } = clientInfo;

  if (!["starter", "growth", "full"].includes(tier)) {
    throw new Error(`Unknown tier: ${tier}. Must be starter, growth, or full.`);
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  const anthropic = apiKey ? new Anthropic({ apiKey }) : null;
  if (!anthropic) {
    console.log("  (ANTHROPIC_API_KEY not set — using static templates. Add key to .env for AI-generated content.)");
  }

  // Create delivery directory
  const safeName = name.replace(/[^a-z0-9]/gi, "_").toLowerCase();
  const deliveryDir = path.join(DELIVERIES_DIR, safeName);
  fs.mkdirSync(deliveryDir, { recursive: true });

  const deliverables = TIER_DELIVERABLES[tier];
  const generatedFiles = [];

  console.log(`\nGenerating ${tier} package for ${name} (${deliverables.length} files)…`);

  for (const deliverable of deliverables) {
    process.stdout.write(`  → ${deliverable} … `);
    try {
      const content = await generateFile(anthropic, deliverable, clientInfo);
      const filePath = path.join(deliveryDir, deliverable);
      fs.writeFileSync(filePath, content, "utf-8");
      generatedFiles.push({ name: deliverable, path: filePath, size: content.length });
      process.stdout.write(`done (${content.length} chars)\n`);
    } catch (err) {
      process.stdout.write(`FAILED: ${err.message}\n`);
      generatedFiles.push({ name: deliverable, path: null, error: err.message });
    }
  }

  // Write manifest
  const manifest = {
    client: clientInfo,
    tier,
    generatedAt: new Date().toISOString(),
    files: generatedFiles,
  };
  fs.writeFileSync(path.join(deliveryDir, "manifest.json"), JSON.stringify(manifest, null, 2));

  // Build delivery email body
  const fileList = generatedFiles
    .filter((f) => f.path)
    .map((f) => `  • ${f.name}`)
    .join("\n");

  const deliveryEmail = buildOnboardingEmail(clientInfo, tier);

  return { deliveryDir, files: generatedFiles, deliveryEmail };
}
