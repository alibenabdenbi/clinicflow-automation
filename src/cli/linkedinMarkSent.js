// src/cli/linkedinMarkSent.js
// Marks LinkedIn connection requests as sent in data/linkedin/prospects.json.
// Prevents the morning brief from showing the same person twice.
//
// Usage:
//   node src/cli/linkedinMarkSent.js "Jordan Albino" "Ali Hosseini"
//   npm run linkedin:sent -- "Jordan Albino" "Ali Hosseini"

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const ROOT          = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const PROSPECTS_PATH = path.join(ROOT, "data", "linkedin", "prospects.json");

const names = process.argv.slice(2);

if (names.length === 0) {
  console.log("Usage: node src/cli/linkedinMarkSent.js \"Full Name\" \"Another Name\"");
  console.log("Marks those prospects connectionSent: true in prospects.json.");
  process.exit(0);
}

const prospects = JSON.parse(fs.readFileSync(PROSPECTS_PATH, "utf-8"));
const now = new Date().toISOString();
let marked = 0;
const notFound = [];

for (const target of names) {
  const needle = target.trim().toLowerCase();
  // Exact full-name match only (case insensitive) to avoid false positives
  const matches = prospects.filter(p => {
    const pn = (p.personName || p.name || "").toLowerCase().trim();
    return pn === needle;
  });

  if (matches.length === 0) {
    notFound.push(target);
    console.log(`  ✗ Not found: "${target}"`);
    continue;
  }

  matches.forEach(p => {
    if (p.connectionSent) {
      console.log(`  ↩ Already sent: "${p.personName || p.name}" — ${p.clinicName}`);
    } else {
      p.connectionSent   = true;
      p.connectionSentAt = now;
      console.log(`  ✓ Marked sent: "${p.personName || p.name}" — ${p.clinicName}`);
      marked++;
    }
  });
}

fs.writeFileSync(PROSPECTS_PATH, JSON.stringify(prospects, null, 2), "utf-8");
console.log(`\n${marked} prospect(s) marked connectionSent. ${notFound.length > 0 ? `Not found: ${notFound.join(", ")}` : ""}`);
