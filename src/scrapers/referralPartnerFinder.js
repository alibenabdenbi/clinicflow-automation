// src/scrapers/referralPartnerFinder.js
// Finds dental accountants, consultants, and IT providers via Google Places API.
// Extracts contact emails from their websites and saves to referral-targets.json.
//
// Usage:
//   node src/scrapers/referralPartnerFinder.js
//   node src/scrapers/referralPartnerFinder.js --dry-run

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import fetch from "node-fetch";
import dotenv from "dotenv";

dotenv.config();

const __dirname  = path.dirname(fileURLToPath(import.meta.url));
const ROOT       = path.resolve(__dirname, "../..");
const TARGETS_PATH = path.join(ROOT, "data", "referral", "referral-targets.json");
const GOOGLE_KEY = (process.env.GOOGLE_PLACES_API_KEY || "").trim();
const DRY_RUN    = process.argv.includes("--dry-run");

function readJsonSafe(p, fb) {
  try { return JSON.parse(fs.readFileSync(p, "utf-8")); } catch { return fb; }
}
function writeJson(p, data) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(data, null, 2), "utf-8");
}
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ─── Search queries + type mapping ───────────────────────────────────────────

const SEARCHES = [
  { query: "dental accountant Canada",                         type: "dental_accountant" },
  { query: "accountant dental practice Canada",                type: "dental_accountant" },
  { query: "dental consultant Canada",                         type: "dental_consultant" },
  { query: "dental practice management consultant Canada",     type: "dental_consultant" },
  { query: "dental office consultant Ontario",                 type: "dental_consultant" },
  { query: "dental office consultant Quebec",                  type: "dental_consultant" },
  { query: "dental office consultant British Columbia",        type: "dental_consultant" },
  { query: "dental coach Canada",                              type: "dental_consultant" },
  { query: "dental IT support Canada",                         type: "dental_it"         },
];

// ─── Google Places textsearch ─────────────────────────────────────────────────

async function searchPlaces(query) {
  const url = `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${encodeURIComponent(query)}&key=${GOOGLE_KEY}`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    const json = await res.json();
    if (json.status === "OK" || json.status === "ZERO_RESULTS") return json.results || [];
    console.warn(`  Places API: ${json.status} for "${query}"`);
    return [];
  } catch (e) {
    console.warn(`  Places fetch error: ${e.message}`);
    return [];
  }
}

async function fetchPlaceDetails(placeId) {
  const fields = "name,formatted_address,website,formatted_phone_number,place_id";
  const url = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${placeId}&fields=${fields}&key=${GOOGLE_KEY}`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8_000) });
    const json = await res.json();
    if (json.status === "OK") return json.result;
  } catch {}
  return null;
}

// ─── Email extraction ─────────────────────────────────────────────────────────

const EMAIL_REGEX = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g;

const GENERIC_LOCAL = new Set([
  "info", "contact", "hello", "hi", "admin", "office", "reception",
  "mail", "email", "support", "team", "noreply", "no-reply", "donotreply",
  "enquiry", "inquiry", "general", "hello", "help", "service",
  "news", "newsletter", "marketing", "sales", "booking", "bookings",
  "webmaster", "postmaster", "abuse", "spam",
]);

function isUsableEmail(email) {
  const local = email.split("@")[0].toLowerCase();
  // Skip generic locals
  if (GENERIC_LOCAL.has(local)) return false;
  // Skip if local part is too short
  if (local.length < 3) return false;
  // Skip if domain looks like an image/asset host
  const domain = email.split("@")[1]?.toLowerCase() || "";
  if (/\.(png|jpg|gif|svg|pdf|js|css|woff)$/i.test(domain)) return false;
  // Skip common non-contact domains
  if (/example\.com|sentry\.io|w3\.org|schema\.org|googleapis\.com/.test(domain)) return false;
  return true;
}

async function fetchPage(url, timeoutMs = 8000) {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/122 Safari/537.36" },
      signal: AbortSignal.timeout(timeoutMs),
      redirect: "follow",
    });
    if (!res.ok) return null;
    const ct = res.headers.get("content-type") || "";
    if (!ct.includes("text")) return null;
    return await res.text();
  } catch { return null; }
}

async function extractEmailsFromWebsite(websiteUrl) {
  const base = websiteUrl.replace(/\/+$/, "");
  const pagesToTry = [base, `${base}/contact`, `${base}/contact-us`, `${base}/about`];

  const found = new Set();

  for (const pageUrl of pagesToTry) {
    const html = await fetchPage(pageUrl);
    if (!html) continue;
    const matches = html.match(EMAIL_REGEX) || [];
    for (const email of matches) {
      const lower = email.toLowerCase();
      if (isUsableEmail(lower)) found.add(lower);
    }
    if (found.size > 0) break; // stop after first page that yields emails
    await sleep(500);
  }

  return [...found];
}

// ─── City extraction from formatted_address ───────────────────────────────────

function extractCity(address) {
  if (!address) return "";
  // "123 Main St, Toronto, ON M5V 1A1, Canada" → "Toronto"
  const parts = address.split(",").map(s => s.trim());
  // Find the part that looks like a city (before province abbreviation)
  for (let i = 1; i < parts.length; i++) {
    const p = parts[i];
    // Skip parts that are postal codes, country names, or province abbreviations
    if (/^[A-Z]{2}$/.test(p)) continue;
    if (/Canada|United States/i.test(p)) continue;
    if (/^[A-Z]\d[A-Z]\s?\d[A-Z]\d$/.test(p)) continue; // Canadian postal code
    if (/^\d{5}(-\d{4})?$/.test(p)) continue; // US zip
    if (/^[A-Z]{2}\s+\w/i.test(p)) continue; // "ON M5V..."
    return p.replace(/\s+[A-Z]\d[A-Z].*$/, "").trim(); // strip postal from city
  }
  return parts[0] || "";
}

// ─── Main ─────────────────────────────────────────────────────────────────────

if (!GOOGLE_KEY) {
  console.error("GOOGLE_PLACES_API_KEY not set in .env — exiting.");
  process.exit(1);
}

const existing    = readJsonSafe(TARGETS_PATH, []);
const seenEmails  = new Set(existing.map(t => (t.email || "").toLowerCase()).filter(Boolean));
const seenPlaces  = new Set(existing.map(t => t.placeId).filter(Boolean));

console.log(`\nReferral Partner Finder`);
console.log(`Existing targets: ${existing.length} | Known emails: ${seenEmails.size}`);
if (DRY_RUN) console.log("DRY RUN — results will not be saved\n");

let totalPlaces = 0;
let totalEmails = 0;
const newTargets = [];

for (const { query, type } of SEARCHES) {
  console.log(`\n── "${query}"`);
  const results = await searchPlaces(query);
  console.log(`  ${results.length} place(s) found`);
  totalPlaces += results.length;

  for (const place of results) {
    const placeId = place.place_id;
    if (seenPlaces.has(placeId)) {
      console.log(`  ↩ Already processed: ${place.name}`);
      continue;
    }
    seenPlaces.add(placeId);

    await sleep(300);
    const details = await fetchPlaceDetails(placeId);
    if (!details) continue;

    const name    = details.name || place.name || "";
    const address = details.formatted_address || place.formatted_address || "";
    const website = details.website || "";
    const phone   = details.formatted_phone_number || "";
    const city    = extractCity(address);

    process.stdout.write(`  ${name} (${city})`);

    if (!website) {
      process.stdout.write(` — no website\n`);
      continue;
    }

    await sleep(600);
    const emails = await extractEmailsFromWebsite(website);

    if (emails.length === 0) {
      process.stdout.write(` — no email found\n`);
      // Still save as a lead without email for manual follow-up
      if (!DRY_RUN) {
        newTargets.push({
          name, company: name, email: "", type, city, website, phone,
          placeId, address, status: "no_email", foundAt: new Date().toISOString(),
        });
      }
      continue;
    }

    // Pick the best email (prefer named/personal over dept emails)
    const bestEmail = emails[0];
    process.stdout.write(` — ${bestEmail}\n`);

    if (seenEmails.has(bestEmail)) {
      console.log(`    (duplicate email — skipping)`);
      continue;
    }
    seenEmails.add(bestEmail);
    totalEmails++;

    if (!DRY_RUN) {
      newTargets.push({
        name, company: name, email: bestEmail, type, city, website, phone,
        placeId, address, status: "todo", foundAt: new Date().toISOString(),
      });
    }
  }
}

if (!DRY_RUN && newTargets.length > 0) {
  const all = [...existing, ...newTargets];
  writeJson(TARGETS_PATH, all);
  console.log(`\n✓ Saved ${newTargets.length} new targets (${totalEmails} with emails)`);
  console.log(`  Total in file: ${all.length}`);
} else if (DRY_RUN) {
  console.log(`\n[DRY RUN] Would have added ${newTargets.length} targets (${totalEmails} with emails)`);
} else {
  console.log(`\nNo new targets found.`);
}

console.log(`\nSummary: ${totalPlaces} places searched | ${totalEmails} new emails extracted`);
