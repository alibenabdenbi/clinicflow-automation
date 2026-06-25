# Client Setup Guide — Bayview Village Dental

**What this covers:** How to configure your ClinicFlow automations in Mailchimp (recommended) or Gmail (simpler manual option).

**Who should do this:** Office manager or practice manager. No technical background needed.

**Total setup time:** Approximately 2–3 hours for the full Growth package.

---

## Option A — Set Up in Mailchimp (Recommended)

Mailchimp's free plan supports up to 500 contacts and 1,000 emails/month — enough for most clinics to start. Automations are included in the free plan.

**Before you start:** Create a free account at mailchimp.com using your clinic email.

---

### Automation 1: Missed Call Recovery
*Setup time: 30 minutes | Who: Office manager*

1. In Mailchimp, click **Automations** in the left sidebar → **Create**
2. Select **Classic Automations** → **Welcome new subscribers**
3. Rename the automation: **"Missed Call Recovery — Bayview Village Dental"**
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
2. Name: **"Appointment Reminders — Bayview Village Dental"**
3. Set trigger to: **A contact's date** → select your appointment date field
4. Add Email/SMS at **72 hours before** → paste 72h reminder from **appointment-reminder.md**
5. Add Email/SMS at **24 hours before** → paste 24h reminder from **appointment-reminder.md**

**For SMS:** Mailchimp's free plan does not include SMS. Use **SimpleTexting** ($25/month) or **EZTexting** ($19/month) as a separate tool for the SMS templates.

---

### Automation 3: New Patient Welcome
*Setup time: 30 minutes | Who: Office manager*

1. **Automations** → **Create** → **Classic Automation**
2. Name: **"New Patient Welcome — Bayview Village Dental"**
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
2. Name: **"Review Request — Bayview Village Dental"**
3. Trigger: **A contact's date** → your appointment completed date field
4. Add Email 1: **2 days after** appointment date → copy from **review-request.md, Primary Message**
5. Add Email 2: **7 days after** appointment date → copy from **review-request.md, Follow-Up**
6. Replace **[ReviewLink]** with your Google Business Profile review URL

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
| Appointment reminders | 20 min | 0 (automated) | Office manager (setup) |
| New patient welcome | 30 min | 0 (automated) | Office manager (setup) |
| Reactivation campaign | 30 min setup + monthly | 20 min/month | Office manager |
| Review requests | 15 min | 0 (automated) | Office manager (setup) |
| Monthly newsletter | 15 min | 10 min/month | Office manager or dentist |
| Tracking spreadsheet | 10 min | 15 min/month | Office manager |
| **Total** | **~2.5 hours** | **~45 min/month** | — |

---

## Get Stuck? We Help.

Email us at any point during setup:

**Mohamed**
contact@clinicflowautomation.com
clinicflowautomation.com

Weekdays 9am–6pm ET — we typically reply within 4 hours. Screen-sharing calls available for Growth/Full clients.