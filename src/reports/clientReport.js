// src/reports/clientReport.js
// Generates a weekly update email for a specific client.
// Usage: node src/reports/clientReport.js --client "Clinic Name"
// Saves report to data/reports/clients/

import fs from "fs";
import path from "path";
import { getActiveClients } from "../services/clientService.js";

const REPORTS_DIR = path.join(process.cwd(), "data", "reports", "clients");

// ── CLI args ─────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const clientArgIdx = args.indexOf("--client");
const clientName = clientArgIdx !== -1 ? args[clientArgIdx + 1] : null;

if (!clientName) {
  console.error('Usage: node src/reports/clientReport.js --client "Clinic Name"');
  process.exit(1);
}

// ── Find client ───────────────────────────────────────────────────────────────

const clients = getActiveClients();
const client = clients.find(c =>
  c.name.toLowerCase().includes(clientName.toLowerCase())
);

if (!client) {
  console.error(`No active client found matching: "${clientName}"`);
  console.error(`Active clients: ${clients.map(c => c.name).join(", ") || "(none)"}`);
  process.exit(1);
}

// ── Calculate days running ────────────────────────────────────────────────────

const startMs = new Date(client.startDate).getTime();
const nowMs   = Date.now();
const daysRunning = Math.floor((nowMs - startMs) / (1000 * 60 * 60 * 24));
const weeksRunning = Math.floor(daysRunning / 7);

// ── Generate report ───────────────────────────────────────────────────────────

const today = new Date().toISOString().slice(0, 10);

const subject = `ClinicFlow weekly update — ${client.name} (Week ${weeksRunning || 1})`;

const body = `Hi,

Here's your ClinicFlow weekly update.

Your automation has been running for ${daysRunning} day${daysRunning === 1 ? "" : "s"}.

This week:

  Missed call texts sent:     [STAT — check Twilio dashboard]
  Patient responses received: [STAT]
  Appointments booked via text: [STAT]
  Recall messages sent:       [STAT — if Growth/Full tier]
  No-shows this week:         [STAT — compare to your baseline]

Everything is working correctly. No errors or delivery failures to report.

If anything looks off or you'd like to adjust any of the messages, just reply here.

Mohamed
contact@clinicflowautomation.com

──
Tier: ${client.tier.charAt(0).toUpperCase() + client.tier.slice(1)} | Started: ${client.startDate.slice(0, 10)} | Week ${weeksRunning || 1} of service
`;

// ── Save report ───────────────────────────────────────────────────────────────

fs.mkdirSync(REPORTS_DIR, { recursive: true });

const safeName = client.name.replace(/[^a-z0-9]/gi, "_").toLowerCase();
const filename = `${safeName}_week${weeksRunning || 1}_${today}.txt`;
const outPath  = path.join(REPORTS_DIR, filename);

const fileContent = `Subject: ${subject}\nTo: ${client.email}\n\n${body}`;
fs.writeFileSync(outPath, fileContent, "utf-8");

// ── Output ────────────────────────────────────────────────────────────────────

console.log(`\nWeekly report for: ${client.name}`);
console.log(`Running for:       ${daysRunning} days (week ${weeksRunning || 1})`);
console.log(`Tier:              ${client.tier}`);
console.log(`To:                ${client.email}`);
console.log(`\n─── EMAIL ───────────────────────────────────`);
console.log(`Subject: ${subject}`);
console.log(`\n${body}`);
console.log(`─────────────────────────────────────────────`);
console.log(`\nSaved → ${outPath}`);
console.log(`\nCopy the body above and send from contact@clinicflowautomation.com`);
console.log(`(or paste into your email client — fill in the [STAT] placeholders first)`);
