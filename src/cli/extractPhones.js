// src/cli/extractPhones.js
// Extracts phone numbers for clinics that have none.
// Tries: 1) DuckDuckGo search, 2) clinic website scrape
//
// Usage:
//   node src/cli/extractPhones.js --limit 30
//   node src/cli/extractPhones.js --limit 30 --dry-run

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import fetch from "node-fetch";

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const DATA_DIR = path.join(ROOT, "data");
const OUTREACH_PATH = path.join(DATA_DIR, "outreach.localDentists.json");

const args = process.argv.slice(2);
const DRY_RUN  = args.includes("--dry-run");
const limitIdx = args.indexOf("--limit");
const LIMIT    = limitIdx !== -1 ? Number(args[limitIdx + 1]) : 30;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function readJsonSafe(p, fallback) {
  try {
    if (!fs.existsSync(p)) return fallback;
    return JSON.parse(fs.readFileSync(p, "utf-8"));
  } catch { return fallback; }
}

function writeJsonSafe(p, data) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(data, null, 2), "utf-8");
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// Extract 10-digit Canadian phone numbers (formats: +1XXXXXXXXXX, (XXX) XXX-XXXX, XXX-XXX-XXXX, etc.)
function extractCanadianPhone(text) {
  if (!text) return null;
  // Normalise to digits first, then match patterns
  const patterns = [
    /\b(\+?1[\s\-.]?)?\(?(4[0-9]{2}|5[0-9]{2}|6[0-9]{2}|7[0-9]{2}|8[0-9]{2}|9[0-9]{2})\)?[\s\-.]?[0-9]{3}[\s\-.]?[0-9]{4}\b/g,
  ];
  for (const re of patterns) {
    const matches = text.match(re);
    if (matches && matches.length > 0) {
      // Normalise: strip everything but digits, add +1 prefix
      const digits = matches[0].replace(/\D/g, "");
      const ten = digits.length === 11 ? digits.slice(1) : digits;
      if (ten.length === 10) return `+1${ten}`;
    }
  }
  return null;
}

async function fetchDDG(query, timeoutMs = 8000) {
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Accept-Language": "en-CA,en;q=0.9",
      },
    });
    clearTimeout(t);
    if (!res.ok) return "";
    return await res.text();
  } catch {
    return "";
  }
}

async function fetchWebsite(url, timeoutMs = 8000) {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    const res = await fetch(url, {
      signal: ctrl.signal,
      redirect: "follow",
      headers: { "User-Agent": "Mozilla/5.0 (compatible; ClinicFlow/1.0)" },
    });
    clearTimeout(t);
    if (!res.ok) return "";
    return await res.text();
  } catch {
    return "";
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

const leads = readJsonSafe(OUTREACH_PATH, []);
const noPhone = leads
  .map((l, idx) => ({ l, idx }))
  .filter(({ l }) => !l.phone || !l.phone.trim())
  .slice(0, LIMIT);

console.log(`\nPhone Extractor`);
console.log(`Mode: ${DRY_RUN ? "dry-run" : "live"} | Limit: ${LIMIT}`);
console.log(`Targets: ${noPhone.length} clinics without phones\n`);

let found = 0;
let fromDDG = 0;
let fromSite = 0;

for (let i = 0; i < noPhone.length; i++) {
  const { l, idx } = noPhone[i];
  const name = l.clinicName || l.name || "";
  const city = l.city || "";

  console.log(`[${i + 1}/${noPhone.length}] ${name}`);

  let phone = null;

  // Method 1: Search DuckDuckGo
  const query = `"${name}" ${city} dental phone`;
  const html = await fetchDDG(query);
  if (html) {
    // Strip HTML tags, look for phone
    const text = html.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ");
    phone = extractCanadianPhone(text);
    if (phone) {
      console.log(`  ✓ DDG: ${phone}`);
      fromDDG++;
    }
  }

  // Method 2: Scrape website if DDG failed and clinic has a website
  if (!phone && l.website) {
    const siteHtml = await fetchWebsite(l.website);
    if (siteHtml) {
      const text = siteHtml.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ");
      phone = extractCanadianPhone(text);
      if (phone) {
        console.log(`  ✓ Website: ${phone}`);
        fromSite++;
      }
    }
  }

  if (!phone) {
    console.log(`  ✗ Not found`);
  } else {
    found++;
    if (!DRY_RUN) {
      leads[idx].phone = phone;
      leads[idx].phoneFoundAt = new Date().toISOString();
      leads[idx].phoneSource = fromSite > fromDDG ? "website" : "ddg";
    }
  }

  // Rate limit: ~3s between requests to avoid DDG blocks
  if (i < noPhone.length - 1) await sleep(3000);
}

if (!DRY_RUN && found > 0) {
  writeJsonSafe(OUTREACH_PATH, leads);
}

console.log(`\n${"─".repeat(50)}`);
console.log(`  Phone Extractor — ${noPhone.length} clinics processed`);
console.log(`${"─".repeat(50)}`);
console.log(`  Found phones:       ${found}`);
console.log(`  From DDG:           ${fromDDG}`);
console.log(`  From website:       ${fromSite}`);
console.log(`  Not found:          ${noPhone.length - found}`);
console.log(`  Success rate:       ${noPhone.length > 0 ? Math.round((found / noPhone.length) * 100) : 0}%`);
console.log(`${DRY_RUN ? "\n  (dry-run — no changes written)" : `\n  Saved → ${OUTREACH_PATH}`}`);
