// src/cli/verifyNoWebsite.js
// Lead credibility verification for no-website dental clinics.
//
// PART 1: Score every record from OSM data + phone validation + optional Google check
// PART 2: Email discovery for phone-only records via web search
// PART 3: Credibility report
//
// Usage:
//   node src/cli/verifyNoWebsite.js              ← score all, discover emails, report
//   node src/cli/verifyNoWebsite.js --score-only ← skip email discovery (faster)
//   node src/cli/verifyNoWebsite.js --limit 50   ← cap email discovery at N records

import fs from "fs";
import path from "path";
import https from "https";
import http from "http";
import { findEmailsForWebsite } from "../processors/emailFinder.js";

const QUEUE_PATH  = path.join(process.cwd(), "data", "outreach.noWebsiteClinics.json");
const REPORT_PATH = path.join(process.cwd(), "data", "reports", "nowebsite-credibility-report.txt");
const TIMEOUT_MS  = 12_000;

const SCORE_ONLY = process.argv.includes("--score-only");
const LIMIT_IDX  = process.argv.indexOf("--limit");
const DISCOVER_LIMIT = LIMIT_IDX !== -1 ? Number(process.argv[LIMIT_IDX + 1]) || 50 : 50;

// ─── Canadian area codes (valid as of 2025) ────────────────────────────────────

const CA_AREA_CODES = new Set([
  // Ontario
  "416","647","437","905","289","365","249","343","613","226","519","548","705","807",
  // Quebec
  "514","438","450","579","418","581","819","873","367",
  // BC
  "604","778","236","250","672",
  // Alberta
  "403","587","825","780",
  // Manitoba
  "204","431",
  // Saskatchewan
  "306","639",
  // Nova Scotia / NB / PEI / NL
  "902","506","709",
  // Territories
  "867",
  // Toll-free (valid but not landline)
  "800","888","877","866","855","844","833",
]);

// Area codes that are almost always mobile in Canada (NANP assignment patterns)
const LIKELY_MOBILE_CODES = new Set(["647","437","778","236","587","825","431","639","873","367","365","548","672"]);

// ─── Phone validation ──────────────────────────────────────────────────────────

function validatePhone(raw) {
  if (!raw || typeof raw !== "string") return { valid: false, reason: "missing" };

  // Strip everything except digits
  const digits = raw.replace(/\D/g, "");

  // Handle leading country code
  const local = digits.startsWith("1") && digits.length === 11 ? digits.slice(1) : digits;

  if (local.length !== 10) return { valid: false, reason: `wrong length (${local.length} digits)` };

  const area = local.slice(0, 3);
  if (!CA_AREA_CODES.has(area)) return { valid: false, reason: `unrecognised area code ${area}` };

  // NANP: area code and exchange cannot start with 0 or 1
  if (local[0] === "0" || local[0] === "1") return { valid: false, reason: "area starts with 0/1" };
  if (local[3] === "0" || local[3] === "1") return { valid: false, reason: "exchange starts with 0/1" };

  const likelyMobile = LIKELY_MOBILE_CODES.has(area);

  return {
    valid: true,
    digits: local,
    formatted: `(${local.slice(0,3)}) ${local.slice(3,6)}-${local.slice(6)}`,
    area,
    likelyMobile,
    likelyLandline: !likelyMobile,
  };
}

// ─── OSM credibility score ─────────────────────────────────────────────────────
// Max 5 points based on data richness in the record.

function osmCredibilityScore(r) {
  let score = 0;
  const signals = [];

  // +1 name (always present after our filter, but sanity check)
  if (r.clinicName && r.clinicName.trim()) { score++; signals.push("name"); }

  // +1 phone
  if (r.phone) { score++; signals.push("phone"); }

  // +1 street address
  if (r.address && r.address.trim()) { score++; signals.push("address"); }

  // +1 coordinates (shows it has a real map pin with enough detail)
  if (r.lat != null && r.lon != null) { score++; signals.push("coordinates"); }

  // +1 email (rare but strongest signal)
  if (r.email) { score++; signals.push("email"); }

  return { score, signals };
}

// ─── Quality gate ──────────────────────────────────────────────────────────────

function qualityGate(credScore, phoneResult) {
  if (credScore >= 3 && phoneResult.valid) return "ready";
  if (credScore >= 2) return "review";
  return "skip";
}

// ─── Lightweight HTTP fetch (no node-fetch dep needed here) ───────────────────

function fetchText(url, opts = {}) {
  return new Promise((resolve) => {
    const timeout = opts.timeout || TIMEOUT_MS;
    const ua = opts.ua || "ClinicFlowAutomation/1.0 (contact@clinicflowautomation.com)";

    try {
      const parsed = new URL(url);
      const mod = parsed.protocol === "https:" ? https : http;

      const req = mod.get(url, {
        headers: { "User-Agent": ua, Accept: "text/html,application/json", ...(opts.headers || {}) },
        timeout,
      }, (res) => {
        let body = "";
        res.setEncoding("utf-8");
        res.on("data", (c) => { body += c; if (body.length > 200_000) req.destroy(); });
        res.on("end", () => resolve({ ok: res.statusCode < 400, status: res.statusCode, text: body }));
      });

      req.on("error", () => resolve({ ok: false, status: 0, text: "" }));
      req.on("timeout", () => { req.destroy(); resolve({ ok: false, status: 0, text: "" }); });
    } catch {
      resolve({ ok: false, status: 0, text: "" });
    }
  });
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

// ─── DuckDuckGo search → first organic result URL ─────────────────────────────

async function searchForWebsite(clinicName, city) {
  const q = encodeURIComponent(`"${clinicName}" ${city} dental`);
  const url = `https://html.duckduckgo.com/html/?q=${q}`;

  const { ok, text } = await fetchText(url, { timeout: 10_000 });
  if (!ok || !text) return null;

  // DDG HTML result links look like: <a class="result__a" href="...">
  const matches = [...text.matchAll(/result__url[^>]*>([^<]+)</g)];
  for (const m of matches) {
    const raw = m[1].trim();
    // Skip social / aggregators
    if (/facebook|yelp|yellowpages|google|maps\.|ratemds|healthgrades|instagram/i.test(raw)) continue;
    try {
      const u = raw.startsWith("http") ? raw : `https://${raw}`;
      new URL(u); // validate
      return u;
    } catch { continue; }
  }

  // Fallback: look for result__snippet links
  const hrefs = [...text.matchAll(/href="(https?:\/\/[^"]+)"/g)].map(m => m[1]);
  for (const h of hrefs) {
    if (/facebook|yelp|yellowpages|google|ratemds|healthgrades|duckduckgo/i.test(h)) continue;
    try { new URL(h); return h; } catch { continue; }
  }

  return null;
}

// ─── Google Maps check via search result HTML ──────────────────────────────────

async function checkGoogleMaps(clinicName, city) {
  // Use DuckDuckGo to search for Google Maps listing (avoids Google bot detection)
  const q = encodeURIComponent(`${clinicName} ${city} site:google.com/maps`);
  const url = `https://html.duckduckgo.com/html/?q=${q}`;
  const { ok, text } = await fetchText(url, { timeout: 10_000 });
  if (!ok || !text) return { found: false };

  const mapsMatch = text.match(/google\.com\/maps\/place\/([^"&\s<]+)/);
  if (mapsMatch) {
    return {
      found: true,
      mapsUrl: `https://www.google.com/maps/place/${mapsMatch[1]}`,
    };
  }
  return { found: false };
}

// ─── Email discovery for phone-only records ────────────────────────────────────

async function discoverEmail(record) {
  const { clinicName, city } = record;

  // Step 1: search DuckDuckGo for their website
  const websiteUrl = await searchForWebsite(clinicName, city);
  if (!websiteUrl) return { email: null, source: null, websiteFound: null };

  await sleep(1000);

  // Step 2: scrape found website for email
  try {
    const emails = await findEmailsForWebsite(websiteUrl, { maxPages: 2 });
    if (emails.length > 0) {
      return { email: emails[0].email, source: "website_scraped", websiteFound: websiteUrl };
    }
  } catch { /* site unreachable */ }

  return { email: null, source: null, websiteFound: websiteUrl };
}

// ─── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`[${new Date().toISOString()}] No-website credibility verification`);
  console.log(`Mode: ${SCORE_ONLY ? "score-only (no email discovery)" : `score + email discovery (limit: ${DISCOVER_LIMIT})`}`);

  if (!fs.existsSync(QUEUE_PATH)) {
    console.error("Queue not found:", QUEUE_PATH);
    process.exit(1);
  }

  const records = JSON.parse(fs.readFileSync(QUEUE_PATH, "utf-8"));
  console.log(`Records to process: ${records.length}\n`);

  // ── PASS 1: Static scoring (no network) ──────────────────────────────────────

  console.log("── Pass 1: Static scoring ──────────────────────────────────────");
  for (const r of records) {
    // Skip already-verified records
    if (r.verified) continue;

    const { score, signals } = osmCredibilityScore(r);
    const phoneResult = validatePhone(r.phone);
    const quality = qualityGate(score, phoneResult);

    r.credibilityScore    = score;
    r.credibilitySignals  = signals;
    r.phoneValid          = phoneResult.valid;
    r.phoneFormatted      = phoneResult.formatted || null;
    r.phoneLikelyLandline = phoneResult.likelyLandline || false;
    r.quality             = quality;

    // Stamp emailConfidence so sendBatch picks them up without a manual step
    if (r.email && !r.emailConfidence) r.emailConfidence = "high";
  }

  const ready  = records.filter(r => r.quality === "ready");
  const review = records.filter(r => r.quality === "review");
  const skip   = records.filter(r => r.quality === "skip");

  console.log(`  Ready:  ${ready.length}`);
  console.log(`  Review: ${review.length}`);
  console.log(`  Skip:   ${skip.length}`);

  // ── PASS 2: Google Maps verification (top ready candidates only) ──────────────

  if (!SCORE_ONLY) {
    console.log(`\n── Pass 2: Google Maps spot-check (top 20 ready) ───────────────`);
    const toCheck = ready
      .filter(r => !r.verified_google)
      .sort((a, b) => b.credibilityScore - a.credibilityScore)
      .slice(0, 20);

    let gmFound = 0;
    for (let i = 0; i < toCheck.length; i++) {
      const r = toCheck[i];
      process.stdout.write(`  [${i+1}/${toCheck.length}] ${r.clinicName} (${r.city})… `);
      await sleep(1500);
      const result = await checkGoogleMaps(r.clinicName, r.city);
      r.verified_google = result.found;
      r.googleMapsUrl   = result.mapsUrl || null;
      if (result.found) { gmFound++; process.stdout.write(`✓ found\n`); }
      else              { process.stdout.write(`not found in search\n`); }
    }
    console.log(`  Google-verified: ${gmFound}/${toCheck.length}`);
  }

  // ── PASS 3: Email discovery for phone-only ready/review records ───────────────

  let emailsFound = 0;
  const phoneOnlyReady = records.filter(r =>
    !r.email &&
    r.phone &&
    (r.quality === "ready" || r.quality === "review") &&
    !r.emailDiscoveryAttempted
  );

  if (!SCORE_ONLY && phoneOnlyReady.length > 0) {
    const toDiscover = phoneOnlyReady.slice(0, DISCOVER_LIMIT);
    console.log(`\n── Pass 3: Email discovery for ${toDiscover.length} phone-only records ──`);

    for (let i = 0; i < toDiscover.length; i++) {
      const r = toDiscover[i];
      process.stdout.write(`  [${i+1}/${toDiscover.length}] ${r.clinicName}… `);
      r.emailDiscoveryAttempted = true;

      await sleep(1200);
      try {
        const result = await discoverEmail(r);
        if (result.email) {
          r.email        = result.email;
          r.emailSource  = result.source;
          r.websiteFound = result.websiteFound;
          r.method       = "email";
          r.emailConfidence = "medium"; // discovered, not scraped from own site
          emailsFound++;
          process.stdout.write(`✓ ${result.email}\n`);
        } else if (result.websiteFound) {
          r.websiteFound = result.websiteFound;
          process.stdout.write(`website found, no email\n`);
        } else {
          process.stdout.write(`no results\n`);
        }
      } catch (err) {
        process.stdout.write(`error: ${err.message}\n`);
      }
    }

    console.log(`  Emails discovered: ${emailsFound}/${toDiscover.length}`);
  }

  // ── Save updated queue ────────────────────────────────────────────────────────

  fs.writeFileSync(QUEUE_PATH, JSON.stringify(records, null, 2), "utf-8");
  console.log(`\nQueue saved → ${QUEUE_PATH}`);

  // ── PART 3: Report ────────────────────────────────────────────────────────────

  const readyFinal   = records.filter(r => r.quality === "ready");
  const reviewFinal  = records.filter(r => r.quality === "review");
  const skipFinal    = records.filter(r => r.quality === "skip");
  const withEmail    = records.filter(r => r.email);
  const gmVerified   = records.filter(r => r.verified_google);

  // Top 10 ready by credibility score, prefer landline + email
  const top10 = [...readyFinal]
    .sort((a, b) => {
      // Sort: has email > landline > score
      const aVal = (a.email ? 10 : 0) + (a.phoneLikelyLandline ? 5 : 0) + (a.credibilityScore || 0);
      const bVal = (b.email ? 10 : 0) + (b.phoneLikelyLandline ? 5 : 0) + (b.credibilityScore || 0);
      return bVal - aVal;
    })
    .slice(0, 10);

  const now = new Date().toISOString();
  const lines = [
    "ClinicFlow — No-Website Clinic Credibility Report",
    `Generated: ${now}`,
    "═".repeat(60),
    "",
    "SUMMARY",
    `  Total records processed:  ${records.length}`,
    `  Ready (contactable):      ${readyFinal.length}`,
    `  Review (borderline):      ${reviewFinal.length}`,
    `  Skip (low quality):       ${skipFinal.length}`,
    `  With email address:       ${withEmail.length}`,
    `  Google Maps verified:     ${gmVerified.length}`,
    `  Emails discovered:        ${emailsFound}`,
    "",
    "SCORING CRITERIA",
    "  +1  Has clinic name",
    "  +1  Has phone number",
    "  +1  Has street address",
    "  +1  Has GPS coordinates",
    "  +1  Has email address",
    "  Ready  = score ≥ 3 AND valid Canadian phone",
    "  Review = score ≥ 2",
    "  Skip   = score < 2",
    "",
    "PHONE VALIDATION BREAKDOWN",
    `  Valid Canadian phones:     ${records.filter(r=>r.phoneValid).length}`,
    `  Likely landline:           ${records.filter(r=>r.phoneLikelyLandline).length}`,
    `  Invalid / missing:         ${records.filter(r=>!r.phoneValid).length}`,
    "",
    "SCORE DISTRIBUTION",
    ...[5,4,3,2,1,0].map(s => {
      const n = records.filter(r=>r.credibilityScore===s).length;
      return `  Score ${s}: ${n} records`;
    }),
    "",
    "═".repeat(60),
    "TOP 10 MOST CREDIBLE NO-WEBSITE CLINICS — READY TO CONTACT",
    "═".repeat(60),
    "",
    ...top10.flatMap((r, i) => [
      `${i+1}. ${r.clinicName}`,
      `   City:         ${r.city}, ${r.province}`,
      `   Score:        ${r.credibilityScore}/5  [${(r.credibilitySignals||[]).join(", ")}]`,
      `   Phone:        ${r.phoneFormatted || r.phone || "—"}  (${r.phoneLikelyLandline ? "likely landline" : "likely mobile"})`,
      `   Address:      ${r.address || "—"}`,
      `   Email:        ${r.email || "none found"}${r.emailSource ? ` [${r.emailSource}]` : ""}`,
      `   Google Maps:  ${r.verified_google ? r.googleMapsUrl || "verified" : "not checked"}`,
      `   Website found:${r.websiteFound || "none"}`,
      `   Status:       ${r.status}`,
      "",
    ]),
    "═".repeat(60),
    "READY CLINICS WITH EMAIL (immediately contactable)",
    "═".repeat(60),
    "",
    ...readyFinal
      .filter(r => r.email)
      .map(r => `  ${r.clinicName.padEnd(40)} ${r.city.padEnd(15)} ${r.email}`),
    "",
    "═".repeat(60),
    `End of report — ${now}`,
  ];

  const report = lines.join("\n");
  fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
  fs.writeFileSync(REPORT_PATH, report, "utf-8");

  // Print summary + top 10 to console
  console.log("\n" + "═".repeat(60));
  console.log(report);
  console.log(`\nReport saved → ${REPORT_PATH}`);
}

main().catch((e) => {
  console.error("verifyNoWebsite failed:", e?.message || e);
  console.error(e?.stack);
  process.exit(1);
});
