# ClinicFlow Automation

> Patient communication automation for Canadian dental and physiotherapy clinics.

**Live:** [clinicflowautomation.com](https://clinicflowautomation.com)

---

## What It Does

ClinicFlow automates patient communication for independent Canadian health clinics. When a patient calls and no one picks up, the system automatically sends an SMS within 60 seconds — recovering missed appointments before patients call a competitor.

**Core features:**
- Missed call text-back via Twilio SMS
- Automated multi-touch outreach sequences (email + SMS)
- AI-powered personalization using clinic review data
- Real-time signal tracking dashboard
- Bilingual support (English + French)
- Google Places API integration for clinic data enrichment
- Personalized clinic landing pages (/for/[clinic-slug])
- Call assistant for sales partners with live lead scoring

---

## Tech Stack

| Layer | Technology |
|---|---|
| Runtime | Node.js 22 |
| Scheduling | PM2 + custom scheduler |
| Email | Nodemailer + Gmail SMTP |
| SMS | Twilio |
| AI | Anthropic Claude API |
| Scraping | Playwright (headless Chromium) |
| Data enrichment | Hunter.io API + Google Places API |
| Frontend | HTML/CSS/JS — Netlify |
| Serverless | Netlify Functions |
| Storage | Netlify Blobs |

---

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    ClinicFlow Engine                    │
│                                                         │
│  ┌──────────────┐   ┌──────────────┐   ┌────────────┐  │
│  │ Google Maps  │   │  Hunter.io   │   │ Google     │  │
│  │ Scraper      │──▶│  Enrichment  │──▶│ Places API │  │
│  └──────────────┘   └──────────────┘   └────────────┘  │
│          │                                    │          │
│          ▼                                    ▼          │
│  ┌──────────────────────────────────────────────────┐   │
│  │              Clinic Database (JSON)               │   │
│  │   507 dental + 1,987 physio clinics across CA     │   │
│  └──────────────────────────────────────────────────┘   │
│          │                                               │
│          ▼                                               │
│  ┌──────────────┐   ┌──────────────┐   ┌────────────┐  │
│  │ Email Engine │   │  SMS Engine  │   │ Signal     │  │
│  │ (Nodemailer) │   │  (Twilio)    │   │ Tracker    │  │
│  └──────────────┘   └──────────────┘   └────────────┘  │
│          │                 │                  │          │
│          └─────────────────┴──────────────────┘         │
│                            │                             │
│                            ▼                             │
│              ┌─────────────────────────┐                 │
│              │   PM2 Scheduler         │                 │
│              │   10+ daily jobs        │                 │
│              │   6:58am → 3:00pm       │                 │
│              └─────────────────────────┘                 │
└─────────────────────────────────────────────────────────┘
                            │
                            ▼
              ┌─────────────────────────┐
              │   Netlify (Frontend)    │
              │   clinicflowautomation  │
              │   .com                  │
              │   100+ pages            │
              │   Serverless Functions  │
              └─────────────────────────┘
```

---

## Key Systems Built

### Outreach Engine
- Multi-touch email sequences (7 touches over 14 days)
- A/B/C testing across 3 offer angles simultaneously
- Pain signal detection from Google Reviews
- Bilingual routing (EN/FR) by province
- Bounce detection and sender reputation management
- Lockfile-based concurrency protection

### Data Pipeline
- Google Maps scraper → 1,987 physio + 507 dental clinics
- Google Places API enrichment → websites, phones, emails
- Hunter.io integration → named owner email discovery
- Playwright scraper → JS-rendered contact page extraction
- MX validation before every send

### Signal Tracker (Live Dashboard)
- Real-time email open tracking via pixel
- Mobile vs desktop detection
- Bot filtering (Microsoft, Google scanning)
- Hot lead scoring and alerting
- Live at: clinicflowautomation.com/signals

### Call Assistant
- PIN-protected partner tool
- Lead scoring and call prioritization
- Opening scripts, objection handlers, voicemail scripts
- One-tap demo SMS trigger
- Outcome tracking (Interested / Callback / Not Now)

### Scheduler (PM2)
```
06:58  SMS morning brief → founder's phone
07:10  LinkedIn rotation → fresh targets daily
07:15  Morning brief email
08:05  Google Places review monitor (50 clinics)
09:00  Pre-send email scraper (Tue only)
09:15  Hit list sequence runner
09:47  Beta follow-up sequence
10:00  Cold batch (Tue/Wed/Thu only)
10:30  Association follow-ups
```

---

## Project Structure

```
clinicflow/
├── src/
│   ├── cli/                    # All runnable scripts
│   │   ├── sendBatch.js        # Cold email batch sender
│   │   ├── sendFollowups.js    # Follow-up sequence runner
│   │   ├── scrapeGoogleMaps.js # Clinic discovery
│   │   ├── extractEmailsFromPlaces.js  # Email enrichment
│   │   ├── enrichEmails.js     # Hunter.io enrichment
│   │   ├── scrapePlaywright.js # JS-rendered scraper
│   │   ├── buildCallAssistant.js
│   │   └── sendMorningBrief.js
│   ├── monitors/
│   │   └── replyMonitor.js     # IMAP reply detection
│   ├── services/
│   │   └── mailer.js           # Email sending service
│   ├── templates/
│   │   ├── signalEmail.js      # Main email template
│   │   ├── breakupEmail.js     # Final touch template
│   │   └── frenchEmail.js      # FR variants
│   └── scheduler.js            # PM2 job scheduler
├── netlify/
│   └── functions/              # Serverless API endpoints
│       ├── track.js            # Open pixel tracker
│       ├── reply-handler.js    # Inbound reply processor
│       ├── trigger-demo.js     # SMS demo trigger
│       └── call-outcome.js     # Call result tracker
├── public/
│   └── netlify-deploy/         # Frontend (100+ pages)
│       ├── index.html
│       ├── signals.html        # Live dashboard
│       ├── call-assistant.html # Partner tool
│       ├── physio.html
│       ├── dental.html
│       └── for/                # Personalized clinic pages
├── data/                       # gitignored — contains real data
├── .env                        # gitignored — contains API keys
├── .env.example                # Safe template for contributors
└── README.md
```

---

## Environment Variables

Copy `.env.example` to `.env` and fill in your values:

```bash
# Email
GMAIL_USER=your@gmail.com
GMAIL_APP_PASSWORD=your_app_password

# SMS
TWILIO_ACCOUNT_SID=ACxxxxxxxx
TWILIO_AUTH_TOKEN=xxxxxxxx
TWILIO_FROM_NUMBER=+1xxxxxxxxxx
NOTIFY_PHONE=+1xxxxxxxxxx

# AI & Enrichment
ANTHROPIC_API_KEY=sk-ant-xxxxxxxx
HUNTER_API_KEY=xxxxxxxx
GOOGLE_PLACES_API_KEY=AIzaxxxxxxxx

# Netlify
NETLIFY_SITE_ID=xxxxxxxx
NETLIFY_TOKEN=xxxxxxxx
```

---

## Results

- 2,494 Canadian clinics mapped (dental + physio)
- 100+ page SEO content cluster live
- 7-touch automated sequences with breakup email
- Real-time signal tracking with bot filtering
- Bilingual outreach (EN + FR) across all provinces
- Zero blacklist entries maintained throughout

---

## About

Built by **Ali Benabdenbi** — solo founder, Montreal QC.

ClinicFlow Automation is a done-for-you patient communication system. Clinics get set up in 2 minutes with no new software, no training, and no monthly fees.

[clinicflowautomation.com](https://clinicflowautomation.com) · [contact@clinicflowautomation.com](mailto:contact@clinicflowautomation.com)
