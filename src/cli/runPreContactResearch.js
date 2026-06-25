// src/cli/runPreContactResearch.js
// Runs pre-contact research on the next N todo clinics and saves review pain scores.
// Shows before/after email comparison for first 3 clinics with pain signals.
//
// Usage:
//   node src/cli/runPreContactResearch.js              # research 20 clinics
//   node src/cli/runPreContactResearch.js --limit 50
//   node src/cli/runPreContactResearch.js --dry-run

import { enrichQueue } from "../intelligence/preContactResearch.js";
import { buildPersonalizedBody } from "../services/emailPersonalizer.js";
import fs from "fs";
import path from "path";
import dotenv from "dotenv";

dotenv.config();

const ROOT = process.cwd();
const OUTREACH_PATH = path.join(ROOT, "data", "outreach.localDentists.json");

const args = process.argv.slice(2);
const DRY_RUN  = args.includes("--dry-run");
const limitIdx = args.indexOf("--limit");
const LIMIT    = limitIdx !== -1 ? Number(args[limitIdx + 1]) : 20;

function readJsonSafe(p, fb) {
  try { return JSON.parse(fs.readFileSync(p, "utf-8")); } catch { return fb; }
}

console.log(`\nPre-Contact Research`);
console.log(`Mode: ${DRY_RUN ? "dry-run" : "live"} | Limit: ${LIMIT}\n`);

const { processed, withPainSignals, results } = await enrichQueue({
  limit: LIMIT,
  dryRun: DRY_RUN,
  onProgress: (i, total, name) => {
    process.stdout.write(`[${i}/${total}] ${name.slice(0,45).padEnd(45)}`);
  },
});

// Print result per clinic on the same line as progress
for (let i = 0; i < results.length; i++) {
  const r = results[i];
  const scoreStr = r.reviewPainScore >= 2 ? `  ⚠ pain score: ${r.reviewPainScore}` : `  score: ${r.reviewPainScore}`;
  // The progress already printed the clinic name — just add score
  if (i === 0) {
    // Re-read the outreach for show
  }
}

console.log(`\n${"─".repeat(56)}`);
console.log(`  Pre-Contact Research — ${processed} clinics processed`);
console.log(`${"─".repeat(56)}`);
console.log(`  With pain signals (score ≥ 2): ${withPainSignals}`);
console.log(`  Without pain signals:          ${processed - withPainSignals}`);

// ── Before/after comparison for first 3 clinics with pain signals ─────────────

const painClinics = results.filter(r => r.reviewPainScore >= 2).slice(0, 3);
const genericSample = results.filter(r => r.reviewPainScore < 2).slice(0, 1);

if (painClinics.length === 0) {
  console.log("\nNo clinics with pain signals found in this batch.");
  console.log("(DDG may be rate-limiting — try again later or run on a different set)");
} else {
  console.log(`\n${"═".repeat(56)}`);
  console.log("BEFORE / AFTER COMPARISON — Clinics With Pain Signals");
  console.log("═".repeat(56));

  // Load latest outreach data (or use dry-run results)
  const leads = readJsonSafe(OUTREACH_PATH, []);
  const byName = {};
  for (const l of leads) if (l.clinicName) byName[l.clinicName] = l;

  for (const r of painClinics) {
    const rec = byName[r.clinicName] || { clinicName: r.clinicName, city: r.city, email: r.email };

    console.log(`\n${"─".repeat(56)}`);
    console.log(`CLINIC: ${r.clinicName} (${r.city})`);
    console.log(`Email:  ${r.email}`);
    console.log(`Pain score: ${r.reviewPainScore}/5`);
    if (r.reviewPainQuotes.length > 0) {
      console.log(`Quotes:`);
      r.reviewPainQuotes.forEach((q, i) => console.log(`  ${i+1}. "${q}"`));
    }

    // BEFORE — generic email (no review data)
    const before = buildPersonalizedBody({
      clinicName: r.clinicName,
      city:       r.city,
      email:      r.email,
    });
    console.log(`\n── BEFORE (generic variant ${before.variantLabel}) ──`);
    console.log(`Subject: ${before.subject}`);
    console.log(before.body);

    // AFTER — with review pain data
    const after = buildPersonalizedBody({
      clinicName:       r.clinicName,
      city:             r.city,
      email:            r.email,
      reviewPainScore:  r.reviewPainScore,
      reviewPainQuotes: r.reviewPainQuotes,
    });
    console.log(`\n── AFTER (variant ${after.variantLabel} — review-personalized) ──`);
    console.log(`Subject: ${after.subject}`);
    console.log(after.body);
  }
}

// Show a generic clinic for contrast
if (genericSample.length > 0) {
  const r = genericSample[0];
  const after = buildPersonalizedBody({ clinicName: r.clinicName, city: r.city, email: r.email });
  console.log(`\n${"─".repeat(56)}`);
  console.log(`GENERIC (no pain signals) — ${r.clinicName}`);
  console.log(`Subject: ${after.subject}`);
  console.log(`Variant: ${after.variantLabel}`);
  console.log(`(body unchanged — using standard rotation)`);
}
