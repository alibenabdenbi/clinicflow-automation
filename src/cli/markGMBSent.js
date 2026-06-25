// src/cli/markGMBSent.js
// Marks a clinic as GMB-contacted so it won't appear in future target lists.
// Usage: node src/cli/markGMBSent.js "Clinic Name"
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname     = path.dirname(fileURLToPath(import.meta.url));
const ROOT          = path.resolve(__dirname, "../..");
const OUTREACH_PATH = path.join(ROOT, "data", "outreach.localDentists.json");
const TARGETS_PATH  = path.join(ROOT, "data", "daily-targets.json");

const name = process.argv.slice(2).join(" ").trim();
if (!name) {
  console.error("Usage: node src/cli/markGMBSent.js \"Clinic Name\"");
  process.exit(1);
}

const clinics = JSON.parse(fs.readFileSync(OUTREACH_PATH, "utf-8"));
const targets = (() => {
  try { return JSON.parse(fs.readFileSync(TARGETS_PATH, "utf-8")); }
  catch { return { gmb: [] }; }
})();

const matches = clinics.filter(c =>
  (c.clinicName || "").toLowerCase().includes(name.toLowerCase())
);

if (matches.length === 0) {
  console.error(`No clinic found matching: "${name}"`);
  process.exit(1);
}
if (matches.length > 1) {
  console.log(`Multiple matches — be more specific:`);
  matches.forEach(c => console.log(`  • ${c.clinicName} (${c.city || "?"})`));
  process.exit(1);
}

const clinic     = matches[0];
const todayEntry = (targets.gmb || []).find(t => t.clinicName === clinic.clinicName);
const idx        = clinics.findIndex(c => c.clinicName === clinic.clinicName);

clinics[idx].gmbContactedAt = new Date().toISOString();
if (todayEntry?.message) clinics[idx].gmbMessage = todayEntry.message;

fs.writeFileSync(OUTREACH_PATH, JSON.stringify(clinics, null, 2), "utf-8");
console.log(`✓ Marked GMB sent: ${clinic.clinicName} (${clinic.city || "?"})`);
if (todayEntry?.message) console.log(`  Message recorded: "${todayEntry.message.slice(0, 100)}"`);
