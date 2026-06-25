// src/cli/sendReactivation.js
// Sends reactivation emails from a client's reactivation queue.
// From: contact@clinicflowautomation.com (display name: "[ClinicName] Team")
// Daily cap: 30 emails per client per run.
// 60–90 second random delay between sends.
//
// Usage:
//   npm run send:reactivation -- --client "Clinic Name"
//   npm run send:reactivation -- --client "Clinic Name" --dry-run
//   npm run send:reactivation -- --client "Clinic Name" --cap 20

import fs from "fs";
import path from "path";
import dotenv from "dotenv";
import nodemailer from "nodemailer";

dotenv.config();

const SMTP_HOST   = (process.env.SMTP_HOST || "").trim();
const SMTP_PORT   = Number(process.env.SMTP_PORT || "587");
const SMTP_USER   = (process.env.SMTP_USER || "").trim();
const SMTP_PASS   = (process.env.SMTP_PASS || "").trim();
const SMTP_FROM   = (process.env.SMTP_FROM || SMTP_USER).trim();

const CLIENTS_DIR = path.join(process.cwd(), "data", "clients");

function getArg(flag) {
  const i = process.argv.indexOf(flag);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : null;
}

const clientName = getArg("--client");
const dryRun     = process.argv.includes("--dry-run");
const dailyCap   = Number(getArg("--cap") || "30");

if (!clientName) {
  console.error('Usage: npm run send:reactivation -- --client "Clinic Name"');
  process.exit(1);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function safeClinicDir(name) {
  return (name || "unknown")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 50);
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

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function randomDelay() {
  return 60_000 + Math.floor(Math.random() * 30_000); // 60–90 seconds
}

function todayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// Determine which email in the sequence a patient should receive next.
// Uses the sentLog to find which emails have already been sent.
function getNextEmail(patient, sentLog) {
  const patientLog = sentLog.filter(e => e.patientEmail === patient.patientEmail);
  const sentIndices = new Set(patientLog.map(e => e.emailIndex));

  // Find the first unsent email in the sequence that is due
  for (let i = 0; i < patient.sequence.length; i++) {
    if (sentIndices.has(i)) continue;

    const email = patient.sequence[i];

    // Check if due — based on days since campaign started (campaignStartedAt)
    if (patient.campaignStartedAt) {
      const startMs   = Date.parse(patient.campaignStartedAt);
      const daysSince = (Date.now() - startMs) / (1000 * 60 * 60 * 24);
      if (daysSince < email.day) continue; // not yet due
    } else {
      // No campaignStartedAt — only send email 0 (first email)
      if (i > 0) continue;
    }

    return { email, index: i };
  }
  return null;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const dirName   = safeClinicDir(clientName);
  const clientDir = path.join(CLIENTS_DIR, dirName);
  const queuePath = path.join(clientDir, "reactivation-queue.json");
  const sentPath  = path.join(clientDir, "reactivation-sent.json");

  if (!fs.existsSync(queuePath)) {
    console.error(`No reactivation queue found at: ${queuePath}`);
    console.error(`Run: npm run build:reactivation -- --client "${clientName}" first`);
    process.exit(1);
  }

  const queue   = readJsonSafe(queuePath, { patients: [] });
  const sentLog = readJsonSafe(sentPath, []);
  const today   = todayKey();

  // Count emails sent today
  const sentToday = sentLog.filter(e => e.sentAt?.startsWith(today)).length;
  const remaining = dailyCap - sentToday;

  console.log(`\n══ Reactivation Send — ${clientName} ════════════════`);
  console.log(`Queue:          ${queue.patients?.length || 0} patients`);
  console.log(`Sent today:     ${sentToday} / ${dailyCap} daily cap`);
  console.log(`Capacity left:  ${remaining}`);
  console.log(`Delay between:  60–90 seconds`);
  console.log(`Dry run:        ${dryRun}`);
  console.log(`════════════════════════════════════════════════\n`);

  if (remaining <= 0) {
    console.log("Daily cap reached. Run again tomorrow.");
    return;
  }

  if (!dryRun && (!SMTP_HOST || !SMTP_USER || !SMTP_PASS)) {
    console.error("SMTP not configured — set SMTP_HOST, SMTP_USER, SMTP_PASS in .env");
    process.exit(1);
  }

  let transporter;
  if (!dryRun) {
    transporter = nodemailer.createTransport({
      host: SMTP_HOST, port: SMTP_PORT,
      secure: SMTP_PORT === 465,
      auth: { user: SMTP_USER, pass: SMTP_PASS },
      tls: { rejectUnauthorized: false },
    });
    await transporter.verify();
  }

  const displayFrom = `${clientName} Team <${SMTP_FROM}>`;

  let sent     = 0;
  let skipped  = 0;

  const patients = queue.patients || [];

  for (let i = 0; i < patients.length && sent < remaining; i++) {
    const patient = patients[i];

    // Skip already fully completed patients
    const completedEmails = sentLog.filter(e => e.patientEmail === patient.patientEmail).length;
    if (completedEmails >= (patient.sequence?.length || 0)) {
      skipped++;
      continue;
    }

    const next = getNextEmail(patient, sentLog);
    if (!next) { skipped++; continue; }

    const { email, index } = next;

    console.log(`[${sent + 1}] ${patient.firstName} ${patient.lastName} <${patient.patientEmail}> — Email ${index + 1}: "${email.subject}"`);

    if (!dryRun) {
      try {
        await transporter.sendMail({
          from:    displayFrom,
          to:      patient.patientEmail,
          subject: email.subject,
          text:    email.body,
        });

        // Log the send
        sentLog.push({
          patientEmail: patient.patientEmail,
          firstName:    patient.firstName,
          lastName:     patient.lastName,
          emailIndex:   index,
          subject:      email.subject,
          sentAt:       new Date().toISOString(),
        });
        writeJsonSafe(sentPath, sentLog);

        // Set campaignStartedAt on first email
        if (index === 0 && !patient.campaignStartedAt) {
          patient.campaignStartedAt = new Date().toISOString();
        }

        console.log(`  ✓ Sent`);
        sent++;

        if (sent < remaining && i < patients.length - 1) {
          const delay = randomDelay();
          console.log(`  Waiting ${Math.round(delay / 1000)}s...`);
          await sleep(delay);
        }
      } catch (e) {
        console.warn(`  ✗ Failed: ${e.message}`);
      }
    } else {
      console.log(`  [DRY RUN] Would send`);
      sent++;
    }
  }

  // Save updated queue with campaignStartedAt dates
  if (!dryRun) {
    writeJsonSafe(queuePath, { ...queue, patients });
  }

  console.log(`\n══ Done ════════════════════════════════════════`);
  console.log(`Sent: ${sent} | Skipped: ${skipped}`);
  if (dryRun) console.log(`(Dry run — no emails sent)`);
}

main().catch(e => {
  console.error("sendReactivation failed:", e.message);
  process.exit(1);
});
