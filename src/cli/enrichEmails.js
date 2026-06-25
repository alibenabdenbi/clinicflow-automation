// src/cli/enrichEmails.js
// Enriches outreach queue with real verified emails using multi-method discovery:
//   - Hunter.io domain search (if HUNTER_API_KEY set)
//   - Website deep scan (homepage → contact → team → doctor pages)
//   - DuckDuckGo clinic / LinkedIn / Google Business / Facebook searches
//   - MX verification on every found email
//   - Named email → contactName extraction
//
// Usage:
//   node src/cli/enrichEmails.js [--market dental|physio|all] [--limit N] [--force] [--unenriched-only]
//
// --unenriched-only  (default) Skip records that already have high or medium confidence emails
// --force            Re-enrich everything, including high/medium confidence records

import fs from "fs";
import path from "path";
import https from "https";
import dotenv from "dotenv";
import { findBestEmailWithConfidence, extractClinicName } from "../processors/emailFinder.js";

// SSL bypass for Hunter.io and clinic website scraping — enricher only, not a server
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

dotenv.config();

// ─── CLI flags ────────────────────────────────────────────────────────────────

const MARKET_ARG = (() => {
  const i = process.argv.indexOf("--market");
  return i !== -1 ? process.argv[i + 1] : "dental";
})();

const LIMIT_ARG = (() => {
  const i = process.argv.indexOf("--limit");
  return i !== -1 ? Number(process.argv[i + 1]) : Infinity;
})();

const FORCE = process.argv.includes("--force");
// --unenriched-only is the default; flag is accepted explicitly but changes nothing
const UNENRICHED_ONLY = !FORCE;

// ─── Config ───────────────────────────────────────────────────────────────────

const MARKET_QUEUE_PATHS = {
  dental: path.join(process.cwd(), "data", "outreach.localDentists.json"),
  physio: path.join(process.cwd(), "data", "outreach.physioClinics.json"),
};

// 2s delay between clinics (UPGRADE 9)
const DELAY_MS = Number(process.env.ENRICH_DELAY_MS || "2000");
const HUNTER_API_KEY = (process.env.HUNTER_API_KEY || "").trim();
const HUNTER_ENABLED = !!HUNTER_API_KEY;

// ─── Helpers ──────────────────────────────────────────────────────────────────

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

// ─── Hunter credits check ─────────────────────────────────────────────────────

function checkHunterCredits() {
  return new Promise((resolve) => {
    if (!HUNTER_API_KEY) { resolve(null); return; }
    const url = `https://api.hunter.io/v2/account?api_key=${encodeURIComponent(HUNTER_API_KEY)}`;
    https.get(url, (res) => {
      let raw = "";
      res.on("data", c => raw += c);
      res.on("end", () => {
        try {
          const j = JSON.parse(raw);
          resolve(j?.data ?? null);
        } catch { resolve(null); }
      });
    }).on("error", () => resolve(null));
  });
}

// ─── Enrichment filter ────────────────────────────────────────────────────────

function needsEnrichment(record) {
  if (FORCE) return !!record.website;
  // Default (--unenriched-only): skip records that already have a good email
  if (record.emailConfidence === "high" || record.emailConfidence === "medium") return false;
  // Skip records already attempted with no result (avoid burning API credits on dead domains)
  if (record.enrichedAt && !record.email && record.emailConfidence === "none") return false;
  return !!record.website;
}

// ─── Process one queue file ───────────────────────────────────────────────────

async function enrichQueue(queuePath, marketName) {
  const records = readJsonSafe(queuePath, []);
  if (!Array.isArray(records) || records.length === 0) {
    console.log(`  No records found at: ${queuePath}`);
    return;
  }

  const targets = records
    .map((r, idx) => ({ r, idx }))
    .filter(({ r }) => needsEnrichment(r))
    .slice(0, isFinite(LIMIT_ARG) ? LIMIT_ARG : undefined);

  if (targets.length === 0) {
    console.log(`  ${marketName}: nothing to enrich (all high-confidence or no websites)`);
    return;
  }

  console.log(`\n── ${marketName.toUpperCase()} — ${targets.length} records to enrich ──`);

  // Counters
  let emailsFound = 0;
  let namesUpdated = 0;
  let namedCount = 0;
  let genericCount = 0;
  let mxVerified = 0;

  const methodCounts = {};
  const confidenceCounts = { high: 0, medium: 0, low: 0, none: 0 };

  for (let i = 0; i < targets.length; i++) {
    const { r, idx } = targets[i];
    const label = `[${String(i + 1).padStart(String(targets.length).length)}/${targets.length}]`;

    process.stdout.write(`${label} ${(r.clinicName || r.website || "").slice(0, 48).padEnd(48)}\n`);

    try {
      const { email, confidence, rawScore, source, isNamed, contactName, hunterConfidence, allFound } =
        await findBestEmailWithConfidence(r.website, {
          clinicName: r.clinicName || "",
          city: r.city || "",
          useDdgFallback: true,
          useHunter: true,
          searchKeyword: marketName === "physio" ? "physiotherapy" : marketName === "salon" ? "salon" : "dental",
        });

      // Update record
      records[idx].email           = email || records[idx].email || null;
      records[idx].emailConfidence = confidence;
      records[idx].emailScore      = rawScore;
      records[idx].enrichedAt      = new Date().toISOString();
      records[idx].emailSource     = source || null;

      if (contactName) {
        records[idx].contactName = contactName;
      }

      if (email) {
        emailsFound++;
        methodCounts[source] = (methodCounts[source] || 0) + 1;
        confidenceCounts[confidence] = (confidenceCounts[confidence] || 0) + 1;
        mxVerified++; // all returned emails passed MX check

        if (isNamed) namedCount++; else genericCount++;

        const nameTag   = contactName ? `  → ${contactName}` : "";
        const hunterTag = hunterConfidence != null ? `  [hunter: ${hunterConfidence}%]` : "";
        const namedTag  = isNamed ? "  [named]" : "";
        const methodTag = source ? `  via ${source}` : "";
        process.stdout.write(`  ✓ ${confidence} (${rawScore}/10)  ${email}${methodTag}${namedTag}${nameTag}${hunterTag}\n`);

        records[idx].method = "email";

      } else {
        confidenceCounts["none"] = (confidenceCounts["none"] || 0) + 1;
        const tried = allFound?.length ? `  (found ${allFound.length} candidates, none passed MX)` : "";
        process.stdout.write(`  - no email found${tried}\n`);
      }

      // Extract real clinic name from website
      const realName = await extractClinicName(r.website);
      if (realName && realName !== r.clinicName) {
        records[idx].clinicName = realName;
        records[idx].nameSource = "website";
        namesUpdated++;
        process.stdout.write(`  ✓ name: "${realName}"\n`);
      }

    } catch (err) {
      process.stdout.write(`  ✗ error: ${err?.message || String(err)}\n`);
      records[idx].enrichError  = String(err?.message || err).slice(0, 120);
      records[idx].enrichedAt   = new Date().toISOString();
    }

    // Save progress every 10 records
    if ((i + 1) % 10 === 0) {
      writeJsonSafe(queuePath, records);
      process.stdout.write(`  [progress saved — ${i + 1}/${targets.length}]\n`);
    }

    if (i < targets.length - 1) await sleep(DELAY_MS);
  }

  // Final save
  writeJsonSafe(queuePath, records);

  // ─── Summary report (UPGRADE 10) ──────────────────────────────────────────
  const total = targets.length;
  const pct = (n) => total > 0 ? ` (${Math.round(n / total * 100)}%)` : "";

  console.log(`\n${"─".repeat(52)}`);
  console.log(`  ${marketName.toUpperCase()} enrich complete — ${total} records`);
  console.log(`${"─".repeat(52)}`);
  console.log(`  Emails found:      ${emailsFound}${pct(emailsFound)}`);
  console.log(`  MX-verified:       ${mxVerified}`);
  console.log(`  Names updated:     ${namesUpdated}`);
  console.log(`\n  Confidence breakdown:`);
  console.log(`    High:   ${confidenceCounts.high || 0}`);
  console.log(`    Medium: ${confidenceCounts.medium || 0}`);
  console.log(`    Low:    ${confidenceCounts.low || 0}`);
  console.log(`    None:   ${confidenceCounts.none || 0}`);

  if (emailsFound > 0) {
    const namedPct  = Math.round(namedCount / emailsFound * 100);
    const genericPct = Math.round(genericCount / emailsFound * 100);
    console.log(`\n  Named vs generic:`);
    console.log(`    Named (dr.anna@, anna.smith@):  ${namedCount} (${namedPct}%)`);
    console.log(`    Generic (info@, reception@):    ${genericCount} (${genericPct}%)`);

    console.log(`\n  Discovery method breakdown:`);
    const sortedMethods = Object.entries(methodCounts).sort((a, b) => b[1] - a[1]);
    for (const [method, count] of sortedMethods) {
      console.log(`    ${method.padEnd(25)} ${count} (${Math.round(count / emailsFound * 100)}%)`);
    }
  }

  console.log(`\n  Saved → ${queuePath}`);
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\nEmail Enricher`);

  // ── Hunter credits check ──────────────────────────────────────────────────
  if (HUNTER_ENABLED) {
    const account = await checkHunterCredits();
    if (account) {
      const searches   = account.requests?.searches   ?? {};
      const verifs     = account.requests?.verifications ?? {};
      const used       = searches.used   ?? "?";
      const available  = searches.available ?? "?";
      const vUsed      = verifs.used      ?? "?";
      const vAvail     = verifs.available ?? "?";
      const reset      = account.reset_date ?? "unknown";
      console.log(`Hunter.io: enabled — plan: ${account.plan_name || "unknown"}`);
      console.log(`  Searches  : ${used} used, ${available} remaining  (resets ${reset})`);
      console.log(`  Verifications: ${vUsed} used, ${vAvail} remaining`);
      if (Number(available) === 0) {
        console.log(`  ⚠  No Hunter searches remaining — Hunter will be skipped this month`);
      }
    } else {
      console.log(`Hunter.io: enabled (key set) — could not fetch account info`);
    }
  } else {
    console.log(`Hunter.io: disabled (no HUNTER_API_KEY)`);
  }

  console.log(`Delay: ${DELAY_MS}ms between clinics`);

  if (FORCE) {
    console.log(`Mode: --force (re-enriching ALL records, including high/medium confidence)`);
  } else {
    console.log(`Mode: --unenriched-only (skipping high/medium confidence — use --force to override)`);
  }

  if (isFinite(LIMIT_ARG)) console.log(`Limit: ${LIMIT_ARG} records`);

  const markets = MARKET_ARG === "all"
    ? Object.keys(MARKET_QUEUE_PATHS)
    : [MARKET_ARG];

  for (const market of markets) {
    const queuePath = MARKET_QUEUE_PATHS[market];
    if (!queuePath || !fs.existsSync(queuePath)) {
      console.log(`\n${market}: queue file not found — skipping`);
      continue;
    }
    await enrichQueue(queuePath, market);
  }
}

main().catch(e => {
  console.error("Enrich failed:", e?.message || e);
  process.exit(1);
});
