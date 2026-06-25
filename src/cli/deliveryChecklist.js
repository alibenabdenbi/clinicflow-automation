// src/cli/deliveryChecklist.js
// Comprehensive delivery status for a client — shows all checks + timeline.
//
// Usage:
//   npm run checklist -- --client "Museum Dental"
//   npm run checklist  (shows all clients)

import fs from "fs";
import path from "path";

const CLIENTS_PATH = path.join(process.cwd(), "data", "clients.json");
const CLIENTS_DIR  = path.join(process.cwd(), "data", "clients");

function getArg(flag) {
  const i = process.argv.indexOf(flag);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : null;
}

const targetClient = getArg("--client") || null;

function readJsonSafe(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, "utf-8"));
  } catch { return fallback; }
}

function safeClinicDir(name) {
  return (name || "unknown")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 50);
}

function fmtDate(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  return d.toLocaleDateString("en-CA", { month: "short", day: "numeric" }) +
         " " + d.toLocaleTimeString("en-CA", { hour: "2-digit", minute: "2-digit", hour12: true });
}

function fmtDateShort(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  return d.toLocaleDateString("en-CA", { month: "short", day: "numeric" });
}

function addDays(iso, days) {
  if (!iso) return null;
  const d = new Date(iso);
  d.setDate(d.getDate() + days);
  return d.toISOString();
}

function checkLine(label, value, detail = "") {
  const icon   = value ? "✓" : "✗";
  const status = value ? "" : "  PENDING";
  const detailStr = detail ? `  ${detail}` : "";
  return { line: `  ${icon} ${label.padEnd(34)}${status}${detailStr}`, ok: !!value };
}

function runChecklist(client) {
  const name    = client.clinicName || client.name || client.email || "unknown";
  const dirName = safeClinicDir(name);
  const dir     = path.join(CLIENTS_DIR, dirName);

  const paidAt      = client.paidAt || client.onboardingTriggeredAt || null;
  const split = { growth: { first: 500, second: 497 }, starter: { first: 200, second: 197 }, full: { first: 1250, second: 1247 } };
  const tierKey = (client.tier || "growth").toLowerCase();
  const amounts = split[tierKey] || split.growth;

  const checks = [];

  // 1. First half payment
  const firstPaid = !!(paidAt);
  const firstAmount = amounts.first;
  const firstDetail = firstPaid
    ? `$${firstAmount} — ${fmtDateShort(paidAt)}`
    : `awaiting $${firstAmount}`;
  checks.push(checkLine("Payment received (first half)", firstPaid, firstDetail));

  // 2. Onboarding email sent
  const email1Sent = !!(client.delivery_email1_sentAt || client.onboardingEmailSentAt);
  const email1Detail = email1Sent
    ? fmtDate(client.delivery_email1_sentAt || client.onboardingEmailSentAt)
    : "sends automatically on payment confirm";
  checks.push(checkLine("Onboarding email sent", email1Sent, email1Detail));

  // 3. Patient CSV received
  const csvPath   = path.join(dir, "patients.csv");
  const csvExists = fs.existsSync(csvPath) || !!client.csvReceivedAt;
  const patCount  = client.patientCount ? `${client.patientCount} patients` : "";
  const csvDetail = csvExists
    ? (client.csvReceivedAt ? `${fmtDateShort(client.csvReceivedAt)}${patCount ? " — " + patCount : ""}` : patCount || "on file")
    : "awaiting reply from clinic";
  checks.push(checkLine("Patient list received", csvExists, csvDetail));

  // 4. Reactivation campaign built
  const queuePath  = path.join(dir, "reactivation-queue.json");
  const queueData  = readJsonSafe(queuePath, null);
  const queueBuilt = !!queueData || !!client.reactivationBuiltAt;
  const queueDetail = queueBuilt
    ? (queueData ? `${queueData.campaignSize ?? queueData.patients?.length ?? "?"} targets` : "built")
    : "pending CSV";
  checks.push(checkLine("Reactivation campaign built", queueBuilt, queueDetail));

  // 5. Calendar / reminders connected
  const calConnected = !!client.calendarId || !!client.remindersActive;
  const calDetail    = calConnected ? (client.calendarId || "active") : "pending booking link";
  checks.push(checkLine("Calendar connected", calConnected, calDetail));

  // 6. First batch sent
  const sentPath  = path.join(dir, "reactivation-sent.json");
  const sentLog   = readJsonSafe(sentPath, []);
  const batchSent = sentLog.length > 0 || !!client.reactivationEmailsSent;
  const batchDetail = batchSent
    ? `${client.reactivationEmailsSent || sentLog.length} emails sent`
    : "pending campaign build";
  checks.push(checkLine("First batch sent", batchSent, batchDetail));

  // 7. Reminders active
  const remLogPath = path.join(dir, "reminders-sent.json");
  const remLog     = readJsonSafe(remLogPath, []);
  const remActive  = calConnected;
  const remDetail  = calConnected
    ? (remLog.length > 0 ? `${remLog.length} reminders sent` : "calendar linked")
    : "needs calendar first";
  checks.push(checkLine("Reminders active", remActive, remDetail));

  // 8. Second payment received
  const secondPaid = client.status === "complete" || !!client.completedAt;
  const secondDetail = secondPaid
    ? `$${amounts.second} — ${fmtDateShort(client.completedAt)}`
    : `$${amounts.second} — due on Day 5`;
  checks.push(checkLine("Second payment received", secondPaid, secondDetail));

  // ── Next action ────────────────────────────────────────────────────────────
  let nextAction = "";
  if (!firstPaid) {
    nextAction = "Awaiting first payment";
  } else if (!email1Sent) {
    nextAction = "Send onboarding email — run: npm run deliver:engine";
  } else if (!csvExists) {
    const followupDate = paidAt ? addDays(paidAt, 1) : null;
    nextAction = `Follow up on patient list — email 2 sends automatically${followupDate ? " " + fmtDateShort(followupDate) : ""}`;
  } else if (!queueBuilt) {
    nextAction = `Build reactivation campaign — run: npm run build:reactivation -- --client "${name}"`;
  } else if (!batchSent) {
    nextAction = `Send first batch — run: npm run send:reactivation -- --client "${name}"`;
  } else if (!calConnected) {
    nextAction = "Set up calendar reminders — run: npm run calendar:setup";
  } else if (!secondPaid) {
    nextAction = "Collect second payment ($" + amounts.second + ") — project is live";
  } else {
    nextAction = "Project complete — 30-day report due " + (paidAt ? fmtDateShort(addDays(paidAt, 30)) : "");
  }

  // ── Timeline ───────────────────────────────────────────────────────────────
  const timeline = [];
  if (paidAt) {
    timeline.push([fmtDateShort(paidAt),         "Payment confirmed, onboarding sent"]);
    timeline.push([fmtDateShort(addDays(paidAt, 1)),  csvExists ? "Patient list received ✓" : "CSV follow-up sends automatically (if not received)"]);
    timeline.push([fmtDateShort(addDays(paidAt, 2)),  queueBuilt ? "Campaign built ✓" : "[Campaign build — pending CSV]"]);
    timeline.push([fmtDateShort(addDays(paidAt, 5)),  "Projected go-live"]);
    timeline.push([fmtDateShort(addDays(paidAt, 5)),  "Day 5 confirmation email"]);
    timeline.push([fmtDateShort(addDays(paidAt, 14)), "2-week check-in"]);
    timeline.push([fmtDateShort(addDays(paidAt, 30)), "30-day results report"]);
  }

  const okCount = checks.filter(c => c.ok).length;
  const total   = checks.length;

  return { name, checks, okCount, total, nextAction, timeline };
}

// ─── Main ─────────────────────────────────────────────────────────────────────

const clients = readJsonSafe(CLIENTS_PATH, []);

const targets = targetClient
  ? clients.filter(c => (c.clinicName || c.name || "").toLowerCase().includes(targetClient.toLowerCase()))
  : clients;

const W = 44;
const SEP = "━".repeat(W);

if (targets.length === 0) {
  if (targetClient) {
    console.log(`\n${SEP}`);
    console.log(`  CLINICFLOW DELIVERY STATUS — ${targetClient}`);
    console.log(SEP);
    const mock = { clinicName: targetClient };
    const result = runChecklist(mock);
    result.checks.forEach(c => console.log(c.line));
    console.log(`\n  NEXT ACTION: ${result.nextAction}`);
  } else {
    console.log("No clients found in data/clients.json.");
  }
  process.exit(0);
}

for (const client of targets) {
  const result = runChecklist(client);

  console.log(`\n${SEP}`);
  console.log(`  CLINICFLOW DELIVERY STATUS — ${result.name}`);
  console.log(SEP);

  result.checks.forEach(c => console.log(c.line));

  console.log(`\n  NEXT ACTION: ${result.nextAction}`);

  if (result.timeline.length > 0) {
    console.log(`\n  TIMELINE:`);
    const maxDateLen = Math.max(...result.timeline.map(([d]) => (d || "").length));
    for (const [date, event] of result.timeline) {
      console.log(`  ${(date || "").padEnd(maxDateLen + 2)}${event}`);
    }
  }

  console.log("");
}
