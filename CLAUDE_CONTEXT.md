# ClinicFlow Automation — Claude Context File
# Last updated: May 9, 2026

---

## WHO I AM

Mohamed Ali Benabdenbi
Founder, ClinicFlow Automation (clinicflowautomation.com)
Montreal, QC, Canada
Solo founder. Claude Code Pro on Windows 10.
Project path: D:\Poject-ORE-EMGINE
Contact: contact@clinicflowautomation.com
Notify phone: +15149617077
Payment: Interac e-transfer to m.aliben432@gmail.com

---

## WHAT THE BUSINESS DOES

Done-for-you patient communication automation for:
- Canadian dental clinics
- Physiotherapy clinics
- Hair salons and spas
- Any appointment-based business

Three core services:
1. Missed call follow-up — automatic SMS within 60 seconds, 3-wave intelligent recovery
2. Appointment reminders — SMS at 72h + 24h before visit
3. Patient reactivation — outreach to inactive patients 12+ months

Pricing:
- Starter: $397 / $200 upfront
- Growth: $997 / $500 upfront (most popular)
- Premium: $2,497 / $1,250 upfront
- Free tier: missed call only, 50 SMS/month, ClinicFlow branding

Split payment. 5-day delivery. No monthly fees. 30-day guarantee.

---

## CURRENT STATUS — MAY 9, 2026

- 0 paying clients
- 0 interested replies yet
- System runs automatically every morning via PM2
- Bounce rate: historical 10.6%, recent sends clean
- Phase 1 Intelligence + Booking Loop: fully built and verified

---

## ACTIVE LEADS & WATCH LIST

Museum Dental (Mary) — CLOSED. Never mention.
Greenwoods Pediatric Dentistry — opened FU1 twice, personal follow-up sent
Downtown Montreal clinic +15148616106 — 2 SMS sent, no reply yet
Calgary +14032391512 — SMS sent, no reply yet
Toronto +14165166468 — SMS sent, no reply yet
Pilot clinics (4) — St. Lawrence, Groupe Dentis, Spinel, Strasburg — watching for replies

If ANY reply comes in — stop everything and close it together immediately.

---

## OUTREACH PIPELINE

| Market | Total | Ready to Send |
|---|---|---|
| Dental | 3,597 | 93 |
| Physio | 705 | 4 |
| Salon/Spa | 701 | 16 (cleaned) |
| TOTAL | 5,003 | 113 |

---

## WHAT FIRES AUTOMATICALLY

- 06:00 daily — Proactive Opportunity Engine (8 revenue opportunity types)
- 06:05 1st/month — Free tier SMS reset
- 06:15 1st/month — Patient memory personal notes extraction (Claude)
- 06:30 Sun — Predictive intelligence analysis
- 06:45 daily — Pain signal scanner (30 clinics)
- 06:50 Sun — Predictive analysis (runPredictiveAnalysisForAll)
- 07:00 Mon — Weekly Intelligence Digest (Claude writes to clinic owners)
- 07:00 1st/month — Shareable results reports
- 07:05 Mon — LinkedIn enrichment
- 07:10 Mon — Referral partner finder
- 07:15 daily — Morning brief email
- 08:30 daily — Appointment reminders (72h + 24h, CSV-based)
- 08:31 daily — Reminder service (new CSV-based system)
- 09:00 Mon-Fri — Voicemail drops
- 09:15 daily — Onboarding orchestrator
- 09:30 1st Mon/month — Patient reactivation wave 1
- 09:45 May 10 — Limbour custom FU3 (ONE TIME)
- 10:00 Tue/Wed/Thu — Dental cold email batch
- 10:00 daily — 30-day results reports (for due clients)
- 10:15 daily — Twilio calls
- 11:00 daily — Follow-up sequences FU1/FU2/FU3
- 11:05 daily — Inbound summary + dashboard stats export
- 11:30 daily — Post-call follow-ups
- 15:00 Tue/Wed/Thu — Physio batch
- 15:30 Tue/Wed/Thu — Salon batch
- Every 30min — Patient recovery follow-ups (wave 2/3)
- Every 30min — IMAP reply checker
- Every 60min — Outcome check sender (YES/NO attendance confirmation)
- May 16 8am — Hunter reset enrich (100 records)

---

## SERVICE DELIVERY ENGINE (fully built, ready for first real client)

### Core Services
- missedCallService.js — triggers patientRecoveryEngine
- patientRecoveryEngine.js — 3-wave intelligent recovery with intent classification
- predictiveEngine.js — churn risk, LTV, recovery likelihood per patient
- reminderService.js — 72h/24h SMS from patient CSV or Netlify Blobs
- reactivationService.js — monthly inactive patient campaigns, sorted by churn×LTV

### Phase 1 Intelligence Layer (built May 8-9 2026)
- eventLog.js — unified event store, single source of truth for all activity
- clinicBrain.js — Claude reads clinic hours/team/services/tone before every message
- patientMemory.js — per-patient profile built from full interaction history
- conversationEngine.js — 15-category intent, 5-level emotion, Claude writes replies
- voiceIntelligence.js — transcribes voicemails, responds to what patient actually said
- opportunityEngine.js — hunts 8 revenue opportunities every morning at 06:00
- weeklyDigest.js — Claude writes natural business-partner weekly update to clinic owner

### Complete Booking Loop (built May 9 2026)
- bookingService.js — multi-turn booking state machine (2-3 SMS exchanges)
- calendarService.js — fetches real Google Calendar slots, creates/cancels booking events
- outcomeTracker.js — confirms attendance 24h later, attributes revenue, triggers rebook on no-show
- Portal CSV upload — drag-and-drop patient list update at /portal, stored in Netlify Blobs

### Client Experience
- onboardingOrchestrator.js — 5-email premium sequence with carrier-specific phone setup
- resultsReportService.js — 30-day shareable HTML report
- clientLifecycle.js — state machine: lead → onboarding → active → reporting
- Intake form at /intake — 10-step animated onboarding, builds Clinic Brain automatically

---

## HOW THE BOOKING LOOP WORKS

Patient: "I'd like to book a cleaning"
→ conversationEngine detects BOOK_APPOINTMENT, bypasses Claude
→ bookingService.initiateBooking() → calendarService.getAvailableSlots()
→ Slots from Google Calendar (or clinic hours fallback)
→ SMS: "Reply 1, 2, or 3: 1) Mon at 9am 2) Tue at 2pm 3) Wed at 10am"

Patient: "Option 2"
→ detectSlotChoice() matches → confirmBooking()
→ Google Calendar event created, outcome check scheduled for 24h after appt

[24h after appointment]
→ Outcome Check Sender fires: "Did [Patient] show up? Reply YES or NO"
→ Mohamed: "yes" → $200 revenue attributed
→ Mohamed: "no" → rebook offer sent to patient automatically

---

## WEBSITE PAGES

- / — homepage
- /pricing — conversion-optimized (multi-market: dental, physio, salon)
- /compare — vs Weave/Podium/NexHealth/Jane App
- /portal — client mission control dashboard (real-time, rebuilds from event log)
- /intake — 10-step clinic onboarding form → Clinic Brain via Netlify Blobs
- /pilot — free setup offer
- /calculator — revenue loss calculator
- /blog — SEO article
- /referral — referral program
- /quiz — free audit
- /results/SLUG — shareable 30-day report
- /ref?clinic=SLUG — viral referral landing page

---

## NETLIFY FUNCTIONS (19 total)

calculator-lead, call-inbound, call-recording, capture-lead, chat,
client-stats, contact-form, get-brain, intake-submit, missed-call,
open, pilot-apply, portal, ref-track, referral-signup, save-brain,
sms-inbound, submit-testimonial, update-patients

---

## DAILY JOBS (manual)

1. Check Zoho inbox — 2 minutes
2. Do 5 LinkedIn connections from morning brief — 10 minutes
3. After LinkedIn: npm run linkedin:sent -- "Name 1" "Name 2" etc
4. Watch phone for SMS replies
5. Any reply -> bring here immediately

---

## HOW TO RESTART SCHEDULER

Open CMD as Administrator:
cd /d D:\Poject-ORE-EMGINE
pm2 restart all
pm2 save

---

## INTERACTION PREFERENCES

- Trust Claude judgment completely
- Direct honest assessments — no optimistic framing
- Think like it's your own business
- Handle technical decisions proactively
- Work at the highest possible level
- When any reply comes in — close it together immediately
- No trailing summaries
- No emoji unless requested
