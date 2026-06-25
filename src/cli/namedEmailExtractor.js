// src/cli/namedEmailExtractor.js
// For clinics with only generic emails (info@, contact@, etc.),
// finds the dentist's name then probes dr.firstname@, firstname@,
// firstname.lastname@, drlastname@ patterns with MX + SMTP verification.
//
// Usage:
//   node src/cli/namedEmailExtractor.js [--limit N] [--dry-run]
//
// --limit N     Process at most N clinics (default: 10)
// --dry-run     Show candidates without saving changes

import fs from "fs";
import path from "path";
import dotenv from "dotenv";
import fetch from "node-fetch";
import * as cheerio from "cheerio";
import {
  scoreEmail,
  extractContactName,
  probeNamedEmailPatterns,
  extractDentistNameFromHtml,
  nameFromClinicName,
  fetchDDGHtml,
} from "../processors/emailFinder.js";

dotenv.config();

const OUTREACH_PATH = process.env.OUTREACH_JSON_PATH ||
  path.join(process.cwd(), "data", "outreach.localDentists.json");

const LIMIT = (() => {
  const i = process.argv.indexOf("--limit");
  return i !== -1 ? Number(process.argv[i + 1]) : 10;
})();

const DRY_RUN = process.argv.includes("--dry-run");

const DELAY_MS = 2_000;
const TIMEOUT_MS = 12_000;

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function readJsonSafe(p, fb = []) {
  try { return JSON.parse(fs.readFileSync(p, "utf-8")); } catch { return fb; }
}

function writeJsonSafe(p, data) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(data, null, 2), "utf-8");
}

// Generic email local parts (score ≤ 2)
const GENERIC_LOCALS = new Set([
  "info", "contact", "admin", "general", "inquiry", "inquiries",
  "mail", "email", "hello", "hi", "team", "support", "web",
]);

function isGenericEmail(email) {
  if (!email) return false;
  const local = email.split("@")[0].toLowerCase();
  return GENERIC_LOCALS.has(local);
}

function getDomain(email) {
  return email ? email.split("@")[1]?.toLowerCase() : null;
}

// Fetch a page with timeout
async function fetchPage(url) {
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        Accept: "text/html",
      },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      redirect: "follow",
    });
    if (!res.ok) return null;
    const ct = res.headers.get("content-type") || "";
    if (!ct.includes("text/html")) return null;
    return await res.text();
  } catch { return null; }
}

// Find dentist name from website About/Team pages
async function findNameFromWebsite(website) {
  if (!website) return null;
  try {
    const base = new URL(website).href;
    const pagesToTry = [
      base,
      new URL("/about", base).href,
      new URL("/about-us", base).href,
      new URL("/team", base).href,
      new URL("/our-team", base).href,
      new URL("/our-doctors", base).href,
      new URL("/meet-the-team", base).href,
      new URL("/dentist", base).href,
    ];
    for (const url of pagesToTry) {
      const html = await fetchPage(url);
      if (!html) continue;
      const name = extractDentistNameFromHtml(html);
      if (name?.first) return name;
    }
  } catch {}
  return null;
}

// Find dentist name from DDG search
async function findNameFromSearch(clinicName, city) {
  if (!clinicName) return null;
  const query = `"${clinicName}"${city ? ` ${city}` : ""} dentist name`;
  const html = await fetchDDGHtml(query);
  if (!html) return null;

  // Look for "Dr. Firstname Lastname" in DDG snippets
  const matches = html.match(/\b(?:Dr\.?|Dre\.?)\s+([A-Z][a-z]{1,15})\s+([A-Z][a-z]{1,20})/g);
  if (matches && matches.length > 0) {
    const m = matches[0].match(/([A-Z][a-z]{1,15})\s+([A-Z][a-z]{1,20})/);
    if (m) return { first: m[1].toLowerCase(), last: m[2].toLowerCase() };
  }
  const singleMatch = html.match(/\b(?:Dr\.?|Dre\.?)\s+([A-Z][a-z]{1,20})\b/);
  if (singleMatch) {
    const m = singleMatch[0].match(/([A-Z][a-z]{1,20})$/);
    if (m) return { first: m[1].toLowerCase(), last: null };
  }
  return null;
}

async function main() {
  console.log(`\nNamed Email Extractor`);
  console.log(`Mode: ${DRY_RUN ? "dry-run" : "live"} | Limit: ${LIMIT}`);

  const records = readJsonSafe(OUTREACH_PATH, []);
  if (!records.length) { console.log("No records found."); process.exit(0); }

  // Find clinics with only generic emails that have a website
  const targets = records
    .map((r, idx) => ({ r, idx }))
    .filter(({ r }) => r.email && isGenericEmail(r.email) && r.website && r.status === "todo")
    .slice(0, LIMIT);

  console.log(`Targets: ${targets.length} clinics with generic emails\n`);

  if (targets.length === 0) {
    console.log("No eligible clinics found (need: todo status + generic email + website).");
    process.exit(0);
  }

  let upgraded = 0;
  let notFound = 0;
  let smtpVerified = 0;

  for (let i = 0; i < targets.length; i++) {
    const { r, idx } = targets[i];
    const label = `[${i + 1}/${targets.length}]`;
    const domain = getDomain(r.email);
    console.log(`${label} ${(r.clinicName || r.website || "").slice(0, 48)}`);
    console.log(`  Current: ${r.email} (generic)`);

    if (!domain) { console.log("  ✗ No domain"); notFound++; continue; }

    // Step 1: find dentist name
    let name = null;

    // Try clinic name first (fastest, no network)
    name = nameFromClinicName(r.clinicName || "");
    if (name?.first) {
      console.log(`  Name from clinic name: ${name.first}${name.last ? " " + name.last : ""}`);
    }

    // Try website
    if (!name?.first) {
      name = await findNameFromWebsite(r.website);
      if (name?.first) console.log(`  Name from website: ${name.first}${name.last ? " " + name.last : ""}`);
      await sleep(500);
    }

    // Try DDG search
    if (!name?.first) {
      name = await findNameFromSearch(r.clinicName, r.city);
      if (name?.first) console.log(`  Name from DDG: ${name.first}${name.last ? " " + name.last : ""}`);
      await sleep(800);
    }

    if (!name?.first) {
      console.log(`  ✗ Could not determine dentist name`);
      notFound++;
      if (i < targets.length - 1) await sleep(DELAY_MS);
      continue;
    }

    // Step 2: probe email patterns
    console.log(`  Probing patterns for ${name.first}${name.last ? " " + name.last : ""} @${domain}...`);
    const result = await probeNamedEmailPatterns(domain, name);

    if (!result) {
      console.log(`  ✗ No pattern verified`);
      notFound++;
    } else {
      console.log(`  ✓ Found: ${result.email} (${result.confidence}, SMTP verified)`);
      smtpVerified++;
      upgraded++;

      if (!DRY_RUN) {
        records[idx].email = result.email;
        records[idx].emailConfidence = result.confidence;
        records[idx].emailScore = result.rawScore;
        records[idx].emailSource = result.source;
        records[idx].contactName = result.contactName || null;
        records[idx].namedEmailFoundAt = new Date().toISOString();
        records[idx].previousGenericEmail = r.email;
      }
    }

    if (i < targets.length - 1) await sleep(DELAY_MS);
  }

  if (!DRY_RUN && upgraded > 0) {
    writeJsonSafe(OUTREACH_PATH, records);
    console.log(`\nSaved → ${OUTREACH_PATH}`);
  }

  console.log(`\n${"─".repeat(50)}`);
  console.log(`  Named Email Extractor — ${targets.length} clinics processed`);
  console.log(`${"─".repeat(50)}`);
  console.log(`  Upgraded to named email: ${upgraded}`);
  console.log(`  SMTP-verified:           ${smtpVerified}`);
  console.log(`  Name not found:          ${notFound}`);
  console.log(`  Improvement rate:        ${targets.length > 0 ? Math.round(upgraded / targets.length * 100) : 0}%`);
  if (DRY_RUN) console.log(`\n  (dry-run — no changes written)`);
}

main().catch(e => { console.error("Named email extractor failed:", e.message); process.exit(1); });
