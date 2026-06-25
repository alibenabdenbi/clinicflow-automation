// src/cli/setupCalendar.js
// Onboards a clinic's Google Calendar for appointment reminders.
//
// Usage:
//   npm run calendar:setup -- --client "Clinic Name" --calendar-id "clinic@gmail.com"
//   npm run calendar:setup -- --client "Clinic Name" --calendar-id "their.calendar@gmail.com" --phone "514-555-1234"

import fs from "fs";
import path from "path";
import dotenv from "dotenv";
import nodemailer from "nodemailer";

dotenv.config();

const CLIENTS_PATH = path.join(process.cwd(), "data", "clients.json");
const CREDS_PATH   = path.join(process.cwd(), "data", "google-credentials.json");

const SMTP_HOST    = (process.env.SMTP_HOST || "").trim();
const SMTP_PORT    = Number(process.env.SMTP_PORT || "587");
const SMTP_USER    = (process.env.SMTP_USER || "").trim();
const SMTP_PASS    = (process.env.SMTP_PASS || "").trim();
const SMTP_FROM    = (process.env.SMTP_FROM || SMTP_USER).trim();
const SENDER_NAME  = (process.env.SENDER_NAME || "Mohamed").trim();

function getArg(flag) {
  const i = process.argv.indexOf(flag);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : null;
}

const clientName  = getArg("--client");
const calendarId  = getArg("--calendar-id");
const clinicPhone = getArg("--phone") || "";
const dryRun      = process.argv.includes("--dry-run");

if (!clientName || !calendarId) {
  console.error('Usage: npm run calendar:setup -- --client "Clinic Name" --calendar-id "their@gmail.com"');
  process.exit(1);
}

function readJsonSafe(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, "utf-8"));
  } catch { return fallback; }
}

function writeJsonSafe(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
}

// Get service account email from credentials (for sharing instructions)
function getServiceAccountEmail() {
  try {
    const creds = JSON.parse(fs.readFileSync(CREDS_PATH, "utf-8"));
    return creds.client_email || null;
  } catch {
    return null;
  }
}

async function main() {
  const serviceEmail = getServiceAccountEmail();

  console.log(`\n══ Calendar Setup — ${clientName} ══════════════════`);
  console.log(`Calendar ID:  ${calendarId}`);
  if (clinicPhone) console.log(`Phone:        ${clinicPhone}`);
  if (serviceEmail) console.log(`Service acct: ${serviceEmail}`);
  console.log(`════════════════════════════════════════════════\n`);

  if (!dryRun) {
    // Save calendarId to client record
    const clients = readJsonSafe(CLIENTS_PATH, []);
    const idx = clients.findIndex(c =>
      (c.clinicName || "").toLowerCase() === clientName.toLowerCase()
    );

    if (idx !== -1) {
      clients[idx].calendarId  = calendarId;
      clients[idx].clinicPhone = clinicPhone || clients[idx].clinicPhone || "";
      clients[idx].calendarConnectedAt = new Date().toISOString();
      writeJsonSafe(CLIENTS_PATH, clients);
      console.log(`✓ Calendar ID saved to data/clients.json`);
    } else {
      console.warn(`  ⚠ Client "${clientName}" not found in clients.json — creating entry`);
      clients.push({
        createdAt: new Date().toISOString(),
        clinicName: clientName,
        calendarId,
        clinicPhone,
        calendarConnectedAt: new Date().toISOString(),
      });
      writeJsonSafe(CLIENTS_PATH, clients);
    }
  }

  // Build sharing instructions email
  const shareEmail = serviceEmail || "clinicflow-service@your-project.iam.gserviceaccount.com";
  const instructions = `Hi,

To connect your calendar for appointment reminders, please do the following:

1. Open Google Calendar (calendar.google.com)
2. On the left sidebar, find your clinic calendar
3. Click the three dots (⋮) next to it → "Settings and sharing"
4. Scroll to "Share with specific people"
5. Click "+ Add people"
6. Enter this email address: ${shareEmail}
7. Set permission to "See all event details"
8. Click Send

That's it — once shared, reminders will start automatically.

Format your appointments like this for best results:
  Title: "FirstName LastName - Procedure"
  Description: include the patient's phone number (e.g. "Phone: 514-555-1234")

Mohamed
ClinicFlow Automation
contact@clinicflowautomation.com`;

  console.log("Instructions to send to clinic:\n");
  console.log(instructions);

  // Find client email to send instructions to
  const clients = readJsonSafe(CLIENTS_PATH, []);
  const client  = clients.find(c => (c.clinicName || "").toLowerCase() === clientName.toLowerCase());
  const toEmail = client?.email;

  if (!dryRun && toEmail && SMTP_HOST && SMTP_USER && SMTP_PASS) {
    const transporter = nodemailer.createTransport({
      host: SMTP_HOST, port: SMTP_PORT,
      secure: SMTP_PORT === 465,
      auth: { user: SMTP_USER, pass: SMTP_PASS },
      tls: { rejectUnauthorized: false },
    });
    try {
      await transporter.sendMail({
        from: `${SENDER_NAME} - ClinicFlow <${SMTP_FROM}>`,
        to: toEmail,
        subject: `Step 3 — Connecting your calendar (${clientName})`,
        text: instructions,
      });
      console.log(`\n✓ Instructions sent to ${toEmail}`);
    } catch (e) {
      console.warn(`  ⚠ Could not send instructions email: ${e.message}`);
    }
  } else if (!toEmail) {
    console.log(`\n(No email found for ${clientName} — send instructions manually)`);
  }

  console.log(`\nReminders will run automatically every day at 8:30am via scheduler.`);
  console.log(`To test manually: npm run reminders:run`);
}

main().catch(e => {
  console.error("setupCalendar failed:", e.message);
  process.exit(1);
});
