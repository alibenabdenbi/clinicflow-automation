// src/cli/intakeHandler.js
// Processes a client's patient CSV, counts total and inactive patients,
// updates the client record, and shows what Email 3 would look like.
//
// Usage:
//   node src/cli/intakeHandler.js --client "Museum Dental" [--months 12]

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
dotenv.config();

const ROOT         = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const CLIENTS_PATH = path.join(ROOT, "data", "clients.json");
const CLIENTS_DIR  = path.join(ROOT, "data", "clients");

function getArg(flag) {
  const i = process.argv.indexOf(flag);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : null;
}

const clientName = getArg("--client");
const monthsArg  = Number(getArg("--months") || "12");

if (!clientName) {
  console.error("Usage: node src/cli/intakeHandler.js --client \"Clinic Name\"");
  process.exit(1);
}

function readJsonSafe(p, fallback) {
  try { return JSON.parse(fs.readFileSync(p, "utf-8")); } catch { return fallback; }
}

function safeClinicDir(name) {
  return (name || "unknown")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 50);
}

function parseCsv(text) {
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  if (lines.length < 2) return [];
  const headers = lines[0].split(",").map(h => h.trim().toLowerCase());
  return lines.slice(1).map(line => {
    const vals = line.split(",");
    const obj = {};
    headers.forEach((h, i) => { obj[h] = (vals[i] || "").trim(); });
    return obj;
  });
}

// Find client record
const clients  = readJsonSafe(CLIENTS_PATH, []);
const clientIdx = clients.findIndex(c =>
  (c.clinicName || c.name || "").toLowerCase().includes(clientName.toLowerCase()) &&
  c.status === "onboarding"
);

if (clientIdx === -1) {
  console.error(`Client not found in onboarding state: "${clientName}"`);
  console.error("Run payment:confirm first, or check data/clients.json");
  process.exit(1);
}

const client  = clients[clientIdx];
const dirName = safeClinicDir(client.clinicName || client.name || clientName);
const csvPath = path.join(CLIENTS_DIR, dirName, "patients.csv");

if (!fs.existsSync(csvPath)) {
  console.error(`No patient CSV found at: ${csvPath}`);
  console.error("Create it first: data/clients/<slug>/patients.csv");
  process.exit(1);
}

// Parse CSV
const csvText  = fs.readFileSync(csvPath, "utf-8");
const patients = parseCsv(csvText);

const cutoff = new Date();
cutoff.setMonth(cutoff.getMonth() - monthsArg);

let totalPatients  = 0;
let inactiveCount  = 0;
let validEmails    = 0;
const inactiveList = [];

for (const p of patients) {
  totalPatients++;
  const lastVisit = p.lastvisit || p.last_visit || p.lastvisitdate || "";
  const email     = p.email || "";
  if (email && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) validEmails++;
  if (lastVisit) {
    const visitDate = new Date(lastVisit);
    if (!isNaN(visitDate) && visitDate < cutoff) {
      inactiveCount++;
      inactiveList.push({ name: p.name || "Patient", email, lastVisit });
    }
  }
}

console.log(`\n── Intake: ${client.clinicName || clientName} ────────────────`);
console.log(`  CSV:              ${csvPath}`);
console.log(`  Total patients:   ${totalPatients}`);
console.log(`  Valid emails:     ${validEmails}`);
console.log(`  Inactive (${monthsArg}m+):  ${inactiveCount}`);
console.log(`  Est. bookings:    ${Math.round(inactiveCount * 0.08)}–${Math.round(inactiveCount * 0.12)} (8–12% response rate)`);
console.log(`  Est. revenue:     $${(Math.round(inactiveCount * 0.08) * 200).toLocaleString("en-CA")}–$${(Math.round(inactiveCount * 0.12) * 200).toLocaleString("en-CA")}`);

// Update client record
clients[clientIdx].patientCount     = totalPatients;
clients[clientIdx].inactiveCount    = inactiveCount;
clients[clientIdx].csvReceivedAt    = new Date().toISOString();
clients[clientIdx].status           = "csv_received";
fs.writeFileSync(CLIENTS_PATH, JSON.stringify(clients, null, 2));
console.log(`\n  ✓ Client record updated (patientCount, inactiveCount, status: csv_received)`);

// Show Email 3
const name           = client.name || client.clinicName || "there";
const clinicName     = client.clinicName || client.name || "your clinic";
const bookingsLow    = Math.round(inactiveCount * 0.08);
const bookingsHigh   = Math.round(inactiveCount * 0.12);
const revLow         = (bookingsLow  * 200).toLocaleString("en-CA");
const revHigh        = (bookingsHigh * 200).toLocaleString("en-CA");
const senderName     = process.env.SENDER_NAME || "Mohamed";

const email3Subject  = `Got it — ${clinicName}'s campaign is being built now`;
const email3Body     = `Hi ${name},

Patient list received — thank you.

I'm building your reactivation campaign now. Here's what I found:

Total patients in your list: ${totalPatients}
Patients inactive 12+ months: ${inactiveCount} — these are your reactivation targets
Estimated bookings from first campaign: ${bookingsLow}–${bookingsHigh} appointments
Estimated revenue recovered: $${revLow}–$${revHigh}

Your campaign goes live within 24 hours. I'll send you a confirmation the moment the first emails start going out.

While I build this, one more thing — I need three quick details to activate your appointment reminders and missed call follow-up:

1. The email your patients recognize (e.g. info@yourclinic.ca)
2. Your online booking link
3. Your Google review link (search your clinic on Google Maps → Write a Review → copy that URL)

Reply with those three and I'll have your full system live by tomorrow.

${senderName}`;

console.log(`\n── Email 3 (sent to ${client.email}) ────────────────────────`);
console.log(`Subject: ${email3Subject}`);
console.log(`\n${email3Body}`);
console.log("─".repeat(60));
