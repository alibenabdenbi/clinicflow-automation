// src/cli/enrichEmailsAll.js
// One-shot: enrich ALL records in the outreach queue that haven't been attempted yet.
// No per-run cap — runs until every record with a website has been processed.
// Saves progress every 10 records. Safe to re-run (idempotent).

import fs from "fs";
import path from "path";
import dotenv from "dotenv";
import { findBestEmailWithConfidence, extractClinicName } from "../processors/emailFinder.js";

dotenv.config();

const OUTREACH_PATH =
  process.env.OUTREACH_JSON_PATH ||
  path.join(process.cwd(), "data", "outreach.localDentists.json");

const DELAY_MS = Number(process.env.ENRICH_DELAY_MS || "700");

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function readJsonSafe(filePath, fallback = []) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, "utf-8"));
  } catch { return fallback; }
}

function writeJsonSafe(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
}

function needsEnrichment(r) {
  if (!r.website) return false;
  if (r.emailConfidence === "high") return false;          // already best possible
  if (r.enrichedAt && r.emailConfidence === "none") return false; // tried, nothing found
  if (r.enrichedAt && r.email) return false;               // already enriched with something
  return true;
}

async function main() {
  const records = readJsonSafe(OUTREACH_PATH, []);
  const targets = records.map((r, idx) => ({ r, idx })).filter(({ r }) => needsEnrichment(r));

  console.log(`Total queue: ${records.length}`);
  console.log(`Need enrichment: ${targets.length}`);
  console.log(`Delay per record: ${DELAY_MS}ms`);
  console.log(`Estimated time: ~${Math.round(targets.length * DELAY_MS / 60000)} min\n`);

  if (targets.length === 0) {
    console.log("Nothing left to enrich. Done.");
    return;
  }

  const counts = { emails: 0, names: 0, high: 0, medium: 0, low: 0, none: 0 };

  for (let i = 0; i < targets.length; i++) {
    const { r, idx } = targets[i];
    const pct = `[${i + 1}/${targets.length}]`;

    try {
      const { email, confidence, score } = await findBestEmailWithConfidence(r.website);
      const realName = await extractClinicName(r.website);

      records[idx].email = email || records[idx].email || null;
      records[idx].emailConfidence = confidence;
      records[idx].emailScore = score || 0;
      records[idx].enrichedAt = new Date().toISOString();

      if (email) {
        counts.emails++;
        counts[confidence] = (counts[confidence] || 0) + 1;
        process.stdout.write(`${pct} ✓ ${confidence.padEnd(6)} ${email}  [${r.clinicName}]\n`);
      } else {
        counts.none++;
        process.stdout.write(`${pct} -        no email  [${r.clinicName}]\n`);
      }

      if (realName && realName !== r.clinicName && realName.length > 3) {
        records[idx].clinicName = realName;
        records[idx].nameSource = "website";
        counts.names++;
      }

      if (email) records[idx].method = "email";
      else if (records[idx].contactPage) records[idx].method = "contact_form";
      else records[idx].method = "manual";

    } catch (err) {
      records[idx].enrichError = String(err?.message || err).slice(0, 120);
      records[idx].enrichedAt = new Date().toISOString();
      process.stdout.write(`${pct} ✗ error: ${err?.message?.slice(0, 60)}\n`);
    }

    if ((i + 1) % 10 === 0) {
      writeJsonSafe(OUTREACH_PATH, records);
      process.stdout.write(`  ── saved at ${i + 1}/${targets.length} ──\n`);
    }

    if (i < targets.length - 1) await sleep(DELAY_MS);
  }

  writeJsonSafe(OUTREACH_PATH, records);

  console.log("\n══════════════════════════════════════");
  console.log(`Processed:   ${targets.length} records`);
  console.log(`Emails found:   ${counts.emails}`);
  console.log(`  High:      ${counts.high}`);
  console.log(`  Medium:    ${counts.medium}`);
  console.log(`  Low:       ${counts.low}`);
  console.log(`  None:      ${counts.none}`);
  console.log(`Names updated:  ${counts.names}`);
  console.log(`Saved → ${OUTREACH_PATH}`);
}

main().catch(e => { console.error("Fatal:", e?.message || e); process.exit(1); });
