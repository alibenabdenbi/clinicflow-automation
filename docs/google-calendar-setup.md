# Google Calendar Setup

ClinicFlow uses a Google service account to read clinic calendars and send SMS appointment reminders via Twilio.

---

## Step 1 — Create a Google Cloud project

1. Go to https://console.cloud.google.com
2. Click **Select a project** → **New Project**
3. Name it `clinicflow-reminders` (or any name)
4. Click **Create**

---

## Step 2 — Enable Google Calendar API

1. In your project, go to **APIs & Services** → **Library**
2. Search for "Google Calendar API"
3. Click it → **Enable**

---

## Step 3 — Create a service account

1. Go to **APIs & Services** → **Credentials**
2. Click **+ Create Credentials** → **Service account**
3. Name: `clinicflow-calendar-reader`
4. Role: **Viewer** (or no role — calendar access is granted by the clinic)
5. Click **Done**

---

## Step 4 — Download credentials JSON

1. Click the service account you just created
2. Go to **Keys** tab → **Add Key** → **Create new key**
3. Choose **JSON** → **Create**
4. A `.json` file downloads automatically

---

## Step 5 — Save credentials to the project

Move the downloaded file to:

```
data/google-credentials.json
```

This file is in `.gitignore` — never commit it.

The file contains a `client_email` field like:
`clinicflow-calendar-reader@your-project.iam.gserviceaccount.com`

This is the email address clinics use to share their calendar with you.

---

## Step 6 — Clinic shares their calendar

Send the clinic these instructions (or use `npm run calendar:setup` to send automatically):

1. Open Google Calendar (calendar.google.com)
2. On the left sidebar, find your clinic calendar
3. Click the three dots (⋮) next to it → **Settings and sharing**
4. Scroll to **Share with specific people**
5. Click **+ Add people**
6. Enter the service account email (from your `google-credentials.json` → `client_email`)
7. Set permission to **See all event details**
8. Click **Send**

---

## Step 7 — Register the calendar in ClinicFlow

```bash
npm run calendar:setup -- --client "Clinic Name" --calendar-id "their.calendar@gmail.com" --phone "514-555-1234"
```

This saves the `calendarId` to `data/clients.json` and sends the clinic sharing instructions.

---

## Appointment format (for best reminder results)

Ask clinics to format their calendar events as:

- **Title:** `FirstName LastName - Procedure` (e.g. "Jane Smith - Cleaning")
- **Description:** Include patient phone number: `Phone: 514-555-1234`

ClinicFlow parses the first name from the title and the phone from the description to send personalized SMS reminders.

---

## Running reminders manually

```bash
npm run reminders:run
```

Reminders run automatically every day at 8:30am via `scheduler.js`.

---

## Reminder timing

| Reminder | When it fires |
|----------|--------------|
| 72h SMS  | 48–80 hours before appointment |
| 24h SMS  | 12–28 hours before appointment |

Duplicate reminders are prevented by `data/clients/[name]/reminders-sent.json`.

---

## Troubleshooting

- **"Google credentials not found"** → make sure `data/google-credentials.json` exists
- **"Calendar not found"** → clinic hasn't shared their calendar yet; resend instructions
- **"No phone number"** → patient record in calendar doesn't have a phone in the description
- **Twilio errors** → check `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER` in `.env`
