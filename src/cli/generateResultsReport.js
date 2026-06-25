// src/cli/generateResultsReport.js
// Generates and emails the 30-day results report for a client.
// Run automatically by the scheduler 30 days after paidAt, or manually.
//
// Usage:
//   node src/cli/generateResultsReport.js --client "Museum Dental"
//   node src/cli/generateResultsReport.js --all       # process all due clients
//   node src/cli/generateResultsReport.js --dry-run

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import nodemailer from "nodemailer";

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT         = path.resolve(__dirname, "../..");
const DATA_DIR     = path.join(ROOT, "data");
const CLIENTS_PATH = path.join(DATA_DIR, "clients.json");
const CALLS_LOG    = path.join(DATA_DIR, "calls", "call-log.json");

const SMTP_HOST   = (process.env.SMTP_HOST || "").trim();
const SMTP_PORT   = Number(process.env.SMTP_PORT || "587");
const SMTP_USER   = (process.env.SMTP_USER || "").trim();
const SMTP_PASS   = (process.env.SMTP_PASS || "").trim();
const SMTP_FROM   = (process.env.SMTP_FROM || SMTP_USER).trim();
const SENDER_NAME = (process.env.SENDER_NAME || "Mohamed").trim();
const NOTIFY_EMAIL = process.env.NOTIFY_EMAIL || "m.aliben432@gmail.com";

const args     = process.argv.slice(2);
const DRY_RUN  = args.includes("--dry-run");
const RUN_ALL  = args.includes("--all");
const clientArgIdx = args.indexOf("--client");
const CLIENT_NAME  = clientArgIdx !== -1 ? args[clientArgIdx + 1] : null;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function readJsonSafe(p, fallback) {
  try {
    if (!fs.existsSync(p)) return fallback;
    return JSON.parse(fs.readFileSync(p, "utf-8"));
  } catch { return fallback; }
}

function writeJsonSafe(p, data) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(data, null, 2), "utf-8");
}

function safeClinicDir(name) {
  return (name || "unknown")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 50);
}

function daysSince(isoDate) {
  if (!isoDate) return 0;
  return (Date.now() - new Date(isoDate).getTime()) / 86_400_000;
}

function fmtDate(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-CA", { month: "long", day: "numeric", year: "numeric" });
}

// ─── Data aggregation ─────────────────────────────────────────────────────────

function gatherStats(client) {
  const dirName = safeClinicDir(client.clinicName || client.name || "");
  const dir     = path.join(DATA_DIR, "clients", dirName);

  // Reactivation sent
  const reactivationSent = readJsonSafe(path.join(dir, "reactivation-sent.json"), []);
  const emailsSent    = reactivationSent.length || client.reactivationEmailsSent || 0;
  const emailsOpened  = reactivationSent.filter(e => e.openedAt).length;
  const emailsReplied = reactivationSent.filter(e => e.repliedAt || e.replied).length;
  const emailsBooked  = reactivationSent.filter(e => e.booked).length;

  // Appointment reminders
  const remindersSent = readJsonSafe(path.join(dir, "reminders-sent.json"), []);
  const remindersCount   = remindersSent.length;
  const avgApptPerWeek   = 20; // conservative estimate if no data
  const noshowsPrevented = remindersCount > 0
    ? Math.round(remindersCount * 0.08)
    : Math.round(avgApptPerWeek * 4 * 0.08);

  // Missed call follow-up — count sequences for this client
  const callLog = readJsonSafe(CALLS_LOG, []);
  const clientEmail = (client.email || "").toLowerCase();
  const missedCallCount = callLog.filter(c =>
    c.clinicEmail === clientEmail || c.clinicName === (client.clinicName || client.name)
  ).length;
  const missedCallsTriggered = missedCallCount || 0;

  // Revenue
  const avgVisit = 200;
  const bookedCount    = emailsBooked || Math.round(emailsReplied * 0.6);
  const revLow  = bookedCount * avgVisit;
  const revHigh = Math.round(revLow * 1.3);

  // ROI
  const tierCost = { starter: 397, growth: 997, full: 2497 };
  const invested = tierCost[(client.tier || "growth").toLowerCase()] || 997;
  const roiMultiple = revLow > 0 ? (revLow / invested).toFixed(1) : null;

  return {
    emailsSent, emailsOpened, emailsReplied, emailsBooked: bookedCount,
    remindersCount, noshowsPrevented,
    missedCallsTriggered,
    revLow, revHigh, invested, roiMultiple,
  };
}

// ─── Email builder ────────────────────────────────────────────────────────────

function buildReport(client, stats) {
  const clinicName = client.clinicName || client.name || "your clinic";
  const goLiveDate = fmtDate(client.goLiveAt || client.paidAt);
  const reportDate = fmtDate(new Date().toISOString());

  const roiLine = stats.roiMultiple
    ? `ROI: ${stats.roiMultiple}× your investment (${stats.revLow.toLocaleString("en-CA")} recovered on $${stats.invested} invested)`
    : `Investment: $${stats.invested} — results building month over month`;

  const subject = `Your ${clinicName} 30-day results — ClinicFlow`;

  const body = `Hi ${client.name || clinicName},

Here's your 30-day results summary for ${clinicName}.

Period: ${goLiveDate} → ${reportDate}

──────────────────────────────────────
PATIENT REACTIVATION
──────────────────────────────────────
Emails sent to inactive patients: ${stats.emailsSent}
Opened: ${stats.emailsOpened || "—"}
Replied: ${stats.emailsReplied || "—"}
Appointments booked: ${stats.emailsBooked}

──────────────────────────────────────
APPOINTMENT REMINDERS
──────────────────────────────────────
Reminder messages sent: ${stats.remindersCount}
Estimated no-shows prevented: ${stats.noshowsPrevented}

──────────────────────────────────────
MISSED CALL FOLLOW-UP
──────────────────────────────────────
Follow-up sequences triggered: ${stats.missedCallsTriggered}

──────────────────────────────────────
RESULTS SUMMARY
──────────────────────────────────────
Estimated revenue recovered: $${stats.revLow.toLocaleString("en-CA")}–$${stats.revHigh.toLocaleString("en-CA")}
${roiLine}

──────────────────────────────────────

Everything continues running automatically. Your campaigns will keep improving as more patients engage.

If you'd like to discuss results or expand any part of the system, just reply here.

${SENDER_NAME}
ClinicFlow Automation
438-544-0442
contact@clinicflowautomation.com`;

  return { subject, body };
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const clients = readJsonSafe(CLIENTS_PATH, []);

  let targets;
  if (CLIENT_NAME) {
    targets = clients.filter(c =>
      (c.clinicName || c.name || "").toLowerCase().includes(CLIENT_NAME.toLowerCase())
    );
    if (targets.length === 0) {
      console.log(`No client found matching "${CLIENT_NAME}"`);
      process.exit(1);
    }
  } else if (RUN_ALL) {
    // All clients 30+ days post-payment who haven't received the report
    targets = clients.filter(c =>
      c.paidAt &&
      !c.resultsReportSentAt &&
      daysSince(c.paidAt) >= 30 &&
      c.email
    );
  } else {
    console.log("Usage: node generateResultsReport.js --client \"Clinic Name\" [--dry-run]");
    console.log("       node generateResultsReport.js --all [--dry-run]");
    process.exit(0);
  }

  if (targets.length === 0) {
    console.log("No clients due for results report.");
    return;
  }

  let transporter = null;
  if (!DRY_RUN && SMTP_HOST && SMTP_USER && SMTP_PASS) {
    transporter = nodemailer.createTransport({
      host: SMTP_HOST, port: SMTP_PORT,
      secure: SMTP_PORT === 465,
      auth: { user: SMTP_USER, pass: SMTP_PASS },
      tls: { rejectUnauthorized: false },
    });
    await transporter.verify();
    console.log("✅ SMTP OK\n");
  }

  let sent = 0;

  for (const client of targets) {
    const clinicName = client.clinicName || client.name || client.email;
    console.log(`\n→ ${clinicName}`);

    const stats = gatherStats(client);
    const { subject, body } = buildReport(client, stats);

    console.log(`  Subject: "${subject}"`);
    console.log(`  Stats: ${stats.emailsSent} sent | ${stats.emailsBooked} booked | $${stats.revLow}–$${stats.revHigh} recovered`);

    if (DRY_RUN) {
      console.log(`  [DRY RUN] Would send to ${client.email}`);
      continue;
    }

    if (!transporter) {
      console.log(`  ✗ SMTP not configured — skipping send`);
      continue;
    }

    try {
      await transporter.sendMail({
        from: `${SENDER_NAME} - ClinicFlow <${SMTP_FROM}>`,
        to: client.email,
        subject,
        text: body,
      });
      client.resultsReportSentAt = new Date().toISOString();
      sent++;
      console.log(`  ✓ sent`);

      // Notify operator
      await transporter.sendMail({
        from: `${SENDER_NAME} - ClinicFlow <${SMTP_FROM}>`,
        to: NOTIFY_EMAIL,
        subject: `30-day report sent — ${clinicName}`,
        text: `Results report sent to ${client.email}.\n\nStats:\n- Emails sent: ${stats.emailsSent}\n- Booked: ${stats.emailsBooked}\n- Revenue recovered: $${stats.revLow}–$${stats.revHigh}\n- ROI: ${stats.roiMultiple || "?"}x`,
      }).catch(() => {});
    } catch (err) {
      console.error(`  ✗ failed: ${err.message}`);
    }
  }

  if (!DRY_RUN && sent > 0) {
    writeJsonSafe(CLIENTS_PATH, clients);
  }

  console.log(`\n${"─".repeat(48)}`);
  console.log(`  Results reports sent: ${sent}${DRY_RUN ? " (dry run)" : ""}`);
}

main().catch(err => {
  console.error("generateResultsReport fatal:", err?.message || err);
  process.exit(1);
});
