// src/cli/scrapeRCDSO.js
// Scrapes RCDSO (Ontario) "Find a Dentist" directory for professional contact info.
// ODQ (Quebec) redirects to homepage (JS-rendered) — skipped, requires Playwright.
//
// For each Ontario clinic in our queue:
//   1. Searches RCDSO by city + clinic name
//   2. Extracts: dentist full name, registration #, address, phone
//   3. Saves to clinic record: rcdsoPhone, rcdsoName, rcdsoRegistration, rcdsoAddress
//   4. If RCDSO phone differs from website phone → personalPhone=rcdsoPhone, personalPhoneScore=7
//
// Usage:
//   node src/cli/scrapeRCDSO.js
//   node src/cli/scrapeRCDSO.js --limit 50
//   node src/cli/scrapeRCDSO.js --dry-run

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import fetch from "node-fetch";

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT      = path.resolve(__dirname, "../..");
const DATA_DIR  = path.join(ROOT, "data");
const OUTREACH_PATH = path.join(DATA_DIR, "outreach.localDentists.json");
const LOG_PATH  = path.join(DATA_DIR, "intelligence", "rcdso-scrape.json");

const args    = process.argv.slice(2);
const DRY_RUN = args.includes("--dry-run");
const limitIdx = args.indexOf("--limit");
const LIMIT   = limitIdx !== -1 ? Number(args[limitIdx + 1]) : 50;
const FORCE   = args.includes("--force");

const ONTARIO_CITIES = [
  "Toronto","Ottawa","Mississauga","Vaughan","Brampton","Hamilton",
  "London","Windsor","Kingston","Sudbury","Markham","Richmond Hill",
  "Oakville","Burlington","Barrie","Oshawa","Ajax","Pickering",
  "Newmarket","Whitby","Etobicoke","North York","Scarborough",
  "Burnaby", // BC — not Ontario, skip gracefully
];

const ONTARIO_ONLY = new Set(ONTARIO_CITIES.filter(c =>
  !["Vancouver","Burnaby","Victoria","Surrey","Calgary","Edmonton",
    "Winnipeg","Montreal","Quebec City","Gatineau","Laval","Longueuil"].includes(c)
));

function readJsonSafe(p, fb) {
  try { if (!fs.existsSync(p)) return fb; return JSON.parse(fs.readFileSync(p, "utf-8")); }
  catch { return fb; }
}

function writeJsonSafe(p, data) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(data, null, 2), "utf-8");
}

function digitsOnly(phone) {
  return (phone || "").replace(/\D/g, "");
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// Parse dentist records from RCDSO search results HTML
function parseRcdsoResults(html) {
  const records = [];

  // Find all dentist IDs in the page
  const idMatches = [...html.matchAll(/dentist\?id=(\d+)/g)];
  const ids = [...new Set(idMatches.map(m => m[1]))];

  for (const id of ids) {
    // Extract the text block around this dentist's record
    const idIdx = html.lastIndexOf(`dentist?id=${id}`);
    const block = html.slice(Math.max(0, idIdx - 3000), idIdx + 3000);
    const text = block
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&nbsp;/g, " ")
      .replace(/\s+/g, " ")
      .trim();

    // Extract name — appears immediately before "Registration Number:"
    // Strip known HTML artifact prefixes (navigation links rendered as text)
    const ARTIFACTS = /^(?:Only Members|Has Conditions|Not Entitled|View Details|Locations|Outcomes|Sort By|Name:\s*A to Z|Name:\s*Z to A|Search Result[^A-Z]*)\s*/i;
    const nameMatch = text.match(/\b([A-Z][a-zA-ZÀ-ÿ'\-]+(?:\s+[A-Z][a-zA-ZÀ-ÿ'\-]+){1,4})\s+Registration Number:\s*(\d{4,6})/);
    const rawName  = nameMatch?.[1]?.trim() || null;
    const fullName = rawName ? rawName.replace(ARTIFACTS, "").trim() : null;
    const regNum   = nameMatch?.[2]?.trim() || null;

    // Extract status
    const statusMatch = text.match(/(?:Current\s+)?Status:\s*(Member|Not Entitled|Suspended|Revoked|Resigned)/i);
    const status = statusMatch?.[1] || null;

    // Extract practice name — appears after "Primary Practice"
    const practiceMatch = text.match(/Primary Practice[:\s]+([A-Za-zÀ-ÿ][^\n]{3,60}?)(?:\s+\d{1,5}\s)/);
    const practiceName = practiceMatch?.[1]?.trim() || null;

    // Extract address
    const addrMatch = text.match(/(\d{1,5}\s+[A-Za-z][^\n,]{5,60}(?:\s+#\s*\d+)?)/);
    const address = addrMatch?.[1]?.trim() || null;

    // Extract phone
    const phoneMatch = text.match(/Phone:\s*((?:\(?\d{3}\)?[-.\s]\d{3}[-.\s]\d{4}))/);
    const phone = phoneMatch?.[1]?.replace(/[-.\s\(\)]/g, "").replace(/^(\d{10})$/, "+1$1") || null;
    const phoneFormatted = phoneMatch?.[1]?.trim() || null;

    if (fullName || regNum) {
      records.push({ id, fullName, regNum, status, practiceName, address, phone, phoneFormatted });
    }
  }

  return records;
}

// Search RCDSO for a clinic
async function searchRcdso(clinicName, city) {
  const params = new URLSearchParams({
    City:       city || "",
    Alpha:      "",
    ConstitID:  "",
    AlphaParent: clinicName || "",
    Address1:   "",
    PhoneNum:   "",
  });

  const url = `https://www.rcdso.org/find-a-dentist/search-results?${params}`;

  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Referer":    "https://www.rcdso.org/en-ca/find-a-dentist",
        "Accept":     "text/html",
      },
    });
    if (!res.ok) return { ok: false, reason: `HTTP ${res.status}`, records: [] };
    const html = await res.text();
    const records = parseRcdsoResults(html);
    return { ok: true, records };
  } catch (err) {
    return { ok: false, reason: err.message, records: [] };
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

const leads = readJsonSafe(OUTREACH_PATH, []);
const log   = readJsonSafe(LOG_PATH, []);

// Filter: Ontario clinics only, not already scraped (unless --force)
const targets = leads
  .map((l, idx) => ({ l, idx }))
  .filter(({ l }) => {
    const city = (l.city || "").split(",")[0].trim();
    if (!ONTARIO_ONLY.has(city)) return false;
    if (!FORCE && l.rcdsoScrapedAt) return false;
    return true;
  })
  .slice(0, LIMIT);

console.log(`\nRCDSO Directory Scraper`);
console.log(`Mode: ${DRY_RUN ? "dry-run" : "live"} | Limit: ${LIMIT} | Force: ${FORCE}`);
console.log(`Ontario targets: ${targets.length}\n`);

let found = 0;
let newPhones = 0;
let newEmails = 0; // RCDSO doesn't publish emails — kept for extensibility

for (let i = 0; i < targets.length; i++) {
  const { l, idx } = targets[i];
  const city = (l.city || "").split(",")[0].trim();
  const clinicName = l.clinicName || "";

  process.stdout.write(`[${i + 1}/${targets.length}] ${clinicName.slice(0, 45).padEnd(45)} `);

  if (DRY_RUN) {
    console.log(`[DRY-RUN] would search city="${city}" clinic="${clinicName}"`);
    continue;
  }

  const result = await searchRcdso(clinicName, city);

  if (!result.ok) {
    console.log(`✗ ${result.reason}`);
    await sleep(1000);
    continue;
  }

  if (result.records.length === 0) {
    // Retry with just city (broader search)
    const broader = await searchRcdso("", city);
    // Try to find a record whose practiceName closely matches our clinicName
    const nameLower = clinicName.toLowerCase();
    const match = broader.records.find(r =>
      r.practiceName && nameLower.includes(r.practiceName.toLowerCase().split(" ")[0].toLowerCase())
    );
    if (match) result.records.push(match);
  }

  if (result.records.length === 0) {
    console.log(`— not found`);
    leads[idx].rcdsoScrapedAt = new Date().toISOString();
    leads[idx].rcdsoFound = false;
    continue;
  }

  const rec = result.records[0]; // use first match
  found++;

  // Compare phones
  const existingDigits = digitsOnly(l.phone || "");
  const rcdsoDigits    = digitsOnly(rec.phone || "");
  const phoneIsDifferent = rcdsoDigits.length >= 10 && rcdsoDigits !== existingDigits;

  console.log(`✓ ${rec.fullName || "?"} reg#${rec.regNum} ${rec.phoneFormatted || "no phone"} ${phoneIsDifferent ? "[NEW PHONE]" : ""}`);

  // Update clinic record
  leads[idx].rcdsoName         = rec.fullName   || null;
  leads[idx].rcdsoRegistration = rec.regNum      || null;
  leads[idx].rcdsoStatus       = rec.status      || null;
  leads[idx].rcdsoPhone        = rec.phoneFormatted || null;
  leads[idx].rcdsoAddress      = rec.address     || null;
  leads[idx].rcdsoScrapedAt    = new Date().toISOString();
  leads[idx].rcdsoFound        = true;

  // If RCDSO phone is different from website phone → treat as more direct line (score 7)
  if (phoneIsDifferent && !leads[idx].personalPhone) {
    leads[idx].personalPhone      = rec.phone;
    leads[idx].personalPhoneScore = 7;
    leads[idx].personalPhoneSource = "rcdso";
    newPhones++;
  }

  // Log entry
  log.push({
    clinicName,
    city,
    rcdsoId:     rec.id,
    rcdsoName:   rec.fullName,
    rcdsoReg:    rec.regNum,
    rcdsoPhone:  rec.phoneFormatted,
    phoneIsNew:  phoneIsDifferent,
    scrapedAt:   new Date().toISOString(),
  });

  // Polite delay
  await sleep(800);
}

if (!DRY_RUN) {
  writeJsonSafe(OUTREACH_PATH, leads);
  writeJsonSafe(LOG_PATH, log);
}

const notFound = targets.length - found - (DRY_RUN ? targets.length : 0);
console.log(`\n${"─".repeat(56)}`);
console.log(`  RCDSO Scraper — ${targets.length} Ontario clinics processed`);
console.log(`${"─".repeat(56)}`);
console.log(`  Found in RCDSO:        ${found}`);
console.log(`  Not found:             ${notFound}`);
console.log(`  New phone numbers:     ${newPhones}  (score=7, direct professional line)`);
console.log(`  Log → ${LOG_PATH}`);
console.log(DRY_RUN ? "\n  (dry-run — no changes written)" : "");
console.log(`\n  Note: ODQ (Quebec) directory requires JavaScript rendering`);
console.log(`        and does not expose a crawlable API — skipped.`);
console.log(`        Use Playwright for Quebec clinics if needed.`);
