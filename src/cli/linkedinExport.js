// src/cli/linkedinExport.js
// Exports LinkedIn prospects as two PhantomBuster-ready CSVs.
//
// File 1: data/linkedin/phantombuster-search.csv
//   → for "LinkedIn Search Export" phantom: searchQuery, expectedName, clinicName, city
//
// File 2: data/linkedin/phantombuster-messages.csv
//   → for "LinkedIn Message Sender" phantom: linkedinUrl, firstName, clinicName, city,
//     connectionMessage, followUpMessage
//
// Also exports a legacy combined CSV for manual use.
//
// Usage:
//   node src/cli/linkedinExport.js
//   node src/cli/linkedinExport.js --all    (include already-contacted prospects)

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const PROSPECTS_PATH = path.join(ROOT, "data", "linkedin", "prospects.json");
const OUT_DIR = path.join(ROOT, "data", "linkedin");

const today = new Date().toISOString().slice(0, 10);
const EXPORT_ALL = process.argv.includes("--all");

// ─── Message templates ────────────────────────────────────────────────────────

function connectionMessage(firstName, clinicName, city) {
  const msg = `Hi ${firstName}, I help dental clinics in ${city} recover missed call revenue — found something specific to your area. Free audit, no commitment. Would love to connect. — Mohamed`;
  return msg.slice(0, 300);
}

function followUpMessage(firstName, clinicName, city) {
  const msg = `Thanks for connecting ${firstName}! Quick question — when a patient calls ${clinicName} and no one answers, what usually happens? Found a specific gap most ${city} clinics have. Worth 2 minutes?`;
  return msg.slice(0, 300);
}

// Build search queries from outreach queue when prospects.json is empty
function buildSearchQueriesFromOutreach() {
  const OUTREACH_PATH = path.join(ROOT, "data", "outreach.localDentists.json");
  try {
    const leads = JSON.parse(fs.readFileSync(OUTREACH_PATH, "utf-8"));
    return leads
      .filter(l => l.contactName && l.clinicName)
      .map(l => ({
        searchQuery: `${l.contactName} dentist ${l.city || ""}`.trim(),
        expectedName: l.contactName,
        clinicName: l.clinicName,
        city: l.city || "",
      }));
  } catch {
    return [];
  }
}

function readJsonSafe(p, fb) {
  try { return JSON.parse(fs.readFileSync(p, "utf-8")); } catch { return fb; }
}

function escapeCSV(val) {
  const s = String(val || "").replace(/"/g, '""');
  return /[",\n\r]/.test(s) ? `"${s}"` : s;
}

// ─── CSV 1 — PhantomBuster Search ─────────────────────────────────────────────

function buildSearchCSV(prospects, searchQueries) {
  const headers = ["searchQuery", "expectedName", "clinicName", "city"].join(",");

  // Rows from real prospects
  const prospectRows = prospects.map(p => {
    const name = p.name || p.nameFirst || "";
    const query = `${name} dentist ${p.city || ""}`.trim();
    return [query, name, p.clinicName || "", p.city || ""].map(escapeCSV).join(",");
  });

  // Rows from outreach queue contactNames (when prospects.json is empty)
  const queueRows = searchQueries.map(q =>
    [q.searchQuery, q.expectedName, q.clinicName, q.city].map(escapeCSV).join(",")
  );

  const rows = prospectRows.length > 0 ? prospectRows : queueRows;
  return [headers, ...rows].join("\n");
}

// ─── CSV 2 — PhantomBuster Messages ───────────────────────────────────────────

function buildMessagesCSV(prospects) {
  const headers = ["linkedinUrl", "firstName", "clinicName", "city", "connectionMessage", "followUpMessage"].join(",");

  const rows = prospects
    .filter(p => p.profileUrl)
    .map(p => {
      const firstName = (p.name || p.nameFirst || "there").split(" ")[0];
      const city = (p.city || "your area").split(",")[0].trim();
      const connMsg = connectionMessage(firstName, p.clinicName || "your clinic", city);
      const fuMsg   = followUpMessage(firstName, p.clinicName || "your clinic", city);
      return [p.profileUrl, firstName, p.clinicName || "", p.city || "", connMsg, fuMsg].map(escapeCSV).join(",");
    });

  return [headers, ...rows].join("\n");
}

// ─── Main ─────────────────────────────────────────────────────────────────────

fs.mkdirSync(OUT_DIR, { recursive: true });

const prospects = readJsonSafe(PROSPECTS_PATH, []);
const toExport = EXPORT_ALL ? prospects : prospects.filter(p => !p.connectionSent);
const searchQueries = buildSearchQueriesFromOutreach();

// Write search CSV
const searchCSV = buildSearchCSV(toExport, searchQueries);
const searchPath = path.join(OUT_DIR, "phantombuster-search.csv");
fs.writeFileSync(searchPath, searchCSV, "utf-8");

// Write messages CSV (only if we have LinkedIn URLs)
const messagesCSV = buildMessagesCSV(toExport);
const messagesPath = path.join(OUT_DIR, "phantombuster-messages.csv");
fs.writeFileSync(messagesPath, messagesCSV, "utf-8");

// Legacy combined export
const legacyPath = path.join(OUT_DIR, `prospects_export_${today}.csv`);
const legacyHeaders = ["Name","LinkedIn URL","Clinic","City","Connection Message","Follow-Up Message","Connection Sent","Follow-Up Sent"].join(",");
const legacyRows = toExport.map(p => {
  const firstName = (p.name || p.nameFirst || "there").split(" ")[0];
  const city = (p.city || "your area").split(",")[0].trim();
  return [
    p.name || "", p.profileUrl || "", p.clinicName || "", p.city || "",
    connectionMessage(firstName, p.clinicName || "your clinic", city),
    followUpMessage(firstName, p.clinicName || "your clinic", city),
    p.connectionSent ? "yes" : "no",
    p.followUpSent ? "yes" : "no",
  ].map(escapeCSV).join(",");
});
fs.writeFileSync(legacyPath, [legacyHeaders, ...legacyRows].join("\n"), "utf-8");

// Validate message lengths
const overLimit = toExport.filter(p => {
  const firstName = (p.name || p.nameFirst || "there").split(" ")[0];
  const city = (p.city || "your area").split(",")[0].trim();
  return connectionMessage(firstName, p.clinicName || "your clinic", city).length > 300;
}).length;

const searchRows = searchCSV.split("\n").length - 1;
const msgRows    = messagesCSV.split("\n").length - 1;

console.log(`\nLinkedIn PhantomBuster Export`);
console.log(`${"─".repeat(50)}`);
console.log(`  Prospects in JSON:         ${prospects.length}`);
console.log(`  Exported (${EXPORT_ALL ? "all" : "unsent"}):        ${toExport.length}`);
console.log(`  Search queries (queue):    ${searchQueries.length}`);
console.log(`  Conn. msgs over 300 chars: ${overLimit}`);
console.log(``);
console.log(`  File 1 (search):    ${searchPath}`);
console.log(`         → ${searchRows} row(s)`);
console.log(`  File 2 (messages):  ${messagesPath}`);
console.log(`         → ${msgRows} row(s) with LinkedIn URLs`);
console.log(`  Legacy combined:    ${legacyPath}`);
console.log(``);
console.log(`Next steps:`);
console.log(`  1. Import phantombuster-search.csv into "LinkedIn Search Export" phantom`);
console.log(`     → it will find LinkedIn profile URLs for each searchQuery`);
console.log(`     → copy resulting URLs back into prospects.json`);
console.log(`  2. Import phantombuster-messages.csv into "LinkedIn Message Sender" phantom`);
console.log(`     → see docs/phantombuster-setup.md for full guide`);
