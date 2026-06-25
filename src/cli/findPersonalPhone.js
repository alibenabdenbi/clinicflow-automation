// src/cli/findPersonalPhone.js
// Searches for personal direct lines for clinics that have a contactName set.
// Sources: 1) DuckDuckGo, 2) RCDSO directory, 3) clinic website /contact /team /about
// Scores: personal cell=10, direct line=7, main clinic=3
//
// Usage:
//   node src/cli/findPersonalPhone.js
//   node src/cli/findPersonalPhone.js --limit 20
//   node src/cli/findPersonalPhone.js --dry-run

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

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function extractCanadianPhone(text) {
  if (!text) return null;
  const re = /\b(\+?1[\s\-.]?)?\(?(4[0-9]{2}|5[0-9]{2}|6[0-9]{2}|7[0-9]{2}|8[0-9]{2}|9[0-9]{2})\)?[\s\-.]?[0-9]{3}[\s\-.]?[0-9]{4}\b/g;
  const matches = text.match(re);
  if (!matches) return null;
  const digits = matches[0].replace(/\D/g, "");
  const ten = digits.length === 11 ? digits.slice(1) : digits;
  return ten.length === 10 ? `+1${ten}` : null;
}

// Phone number signals that suggest a personal/direct number vs main clinic line
function scorePhoneSource(context, clinicPhone) {
  const lower = (context || "").toLowerCase();
  // Direct/cell signals
  if (/\b(cell|mobile|direct|dr\.|doctor|personal)\b/.test(lower)) return 10;
  // If different from known clinic main number → likely direct
  if (clinicPhone) {
    const existing = clinicPhone.replace(/\D/g, "");
    const found = (context.match(/[\d\s\-\(\)\.+]{10,}/g) || []).map(s => s.replace(/\D/g, ""));
    for (const f of found) {
      const ten = f.length === 11 ? f.slice(1) : f;
      const existingTen = existing.length === 11 ? existing.slice(1) : existing;
      if (ten.length === 10 && existingTen.length === 10 && ten !== existingTen) return 7;
    }
  }
  return 3;
}

async function fetchHtml(url, timeoutMs = 8000) {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    const res = await fetch(url, {
      signal: ctrl.signal,
      redirect: "follow",
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept-Language": "en-CA,en;q=0.9",
      },
    });
    clearTimeout(t);
    if (!res.ok) return "";
    return await res.text();
  } catch { return ""; }
}

function cleanText(html) {
  return html.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
}

// Search DuckDuckGo for personal/direct number
async function searchDDG(query) {
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
  const html = await fetchHtml(url, 10000);
  if (!html || html.length < 500) return { phone: null, context: null };
  const text = cleanText(html);
  const phone = extractCanadianPhone(text);
  if (!phone) return { phone: null, context: null };
  // Extract context around the phone number
  const idx = text.indexOf(phone.replace("+1", "").replace(/\D/g, "").replace(/(\d{3})(\d{3})(\d{4})/, "$1"));
  const context = idx >= 0 ? text.slice(Math.max(0, idx - 80), idx + 50) : "";
  return { phone, context };
}

// Search RCDSO directory for dentist
async function searchRCDSO(drName, clinicName) {
  const query = `site:rcdso.org "${drName}" OR "${clinicName}"`;
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
  const html = await fetchHtml(url, 10000);
  if (!html || html.length < 500) return { phone: null, context: null };
  const text = cleanText(html);
  const phone = extractCanadianPhone(text);
  if (!phone) return { phone: null, context: null };
  const context = "RCDSO directory listing";
  return { phone, context };
}

// Scrape clinic website pages for direct numbers associated with named staff
async function scrapeWebsiteForDirectNumber(websiteUrl, drName, existingPhone) {
  if (!websiteUrl) return { phone: null, context: null };
  const base = websiteUrl.replace(/\/$/, "");
  const pages = [
    `${base}/contact`,
    `${base}/team`,
    `${base}/about`,
    `${base}/staff`,
    `${base}/our-team`,
    `${base}/contact-us`,
  ];

  const drLast = (drName || "").split(/\s+/).pop()?.toLowerCase() || "";

  for (const page of pages) {
    const html = await fetchHtml(page, 6000);
    if (!html || html.length < 200) continue;
    const text = cleanText(html);

    // Look for a phone number near the doctor's name
    if (drLast && text.toLowerCase().includes(drLast)) {
      const idx = text.toLowerCase().indexOf(drLast);
      const nearby = text.slice(Math.max(0, idx - 100), idx + 200);
      const phone = extractCanadianPhone(nearby);
      if (phone) {
        const score = scorePhoneSource(nearby, existingPhone);
        if (score >= 7) return { phone, context: `website:${page} near Dr.${drLast}` };
      }
    }

    // Fallback: any phone on page
    const phone = extractCanadianPhone(text);
    if (phone) {
      const score = scorePhoneSource(text, existingPhone);
      return { phone, context: `website:${page}` };
    }
    await sleep(400);
  }
  return { phone: null, context: null };
}

// ─── Main ─────────────────────────────────────────────────────────────────────

const leads = readJsonSafe(OUTREACH_PATH, []);

// Target: clinics with contactName but no personalPhone yet
const targets = leads
  .map((l, idx) => ({ l, idx }))
  .filter(({ l }) => l.contactName && !l.personalPhone)
  .slice(0, LIMIT);

console.log(`\nPersonal Phone Finder`);
console.log(`Mode: ${DRY_RUN ? "dry-run" : "live"} | Limit: ${LIMIT}`);
console.log(`Targets: ${targets.length} clinics with contactName, no personalPhone\n`);

let found = 0;
const results = [];

for (let i = 0; i < targets.length; i++) {
  const { l, idx } = targets[i];
  const name = l.clinicName || "";
  const contactName = l.contactName || "";
  const city = l.city || "";
  const existingPhone = l.phone || null;

  console.log(`[${i + 1}/${targets.length}] ${name} — ${contactName}`);

  let bestPhone = null;
  let bestScore = 0;
  let bestSource = null;
  let bestContext = null;

  // Method 1: DDG — dr name + clinic name + phone
  const ddgResult = await searchDDG(`"${contactName}" "${name}" dentist phone`);
  if (ddgResult.phone) {
    const score = scorePhoneSource(ddgResult.context, existingPhone);
    if (score > bestScore) { bestPhone = ddgResult.phone; bestScore = score; bestSource = "ddg"; bestContext = ddgResult.context; }
  }
  await sleep(1500);

  // Method 2: RCDSO directory
  if (bestScore < 7) {
    const rcdsoResult = await searchRCDSO(contactName, name);
    if (rcdsoResult.phone) {
      const score = scorePhoneSource(rcdsoResult.context, existingPhone) + 1; // slight boost for RCDSO
      if (score > bestScore) { bestPhone = rcdsoResult.phone; bestScore = score; bestSource = "rcdso"; bestContext = rcdsoResult.context; }
    }
    await sleep(1500);
  }

  // Method 3: Clinic website pages
  if (bestScore < 7 && l.website) {
    const webResult = await scrapeWebsiteForDirectNumber(l.website, contactName, existingPhone);
    if (webResult.phone) {
      const score = scorePhoneSource(webResult.context, existingPhone);
      if (score > bestScore) { bestPhone = webResult.phone; bestScore = score; bestSource = "website"; bestContext = webResult.context; }
    }
  }

  const sourceLabel = bestSource || "none";
  const scoreLabel = bestScore >= 7 ? `direct/cell(${bestScore})` : bestScore > 0 ? `clinic(${bestScore})` : "none";
  console.log(`  → ${bestPhone || "not found"} [${scoreLabel}] [${sourceLabel}]`);

  if (bestPhone) {
    found++;
    results.push({ clinicName: name, contactName, phone: bestPhone, score: bestScore, source: bestSource });
    if (!DRY_RUN) {
      leads[idx].personalPhone = bestPhone;
      leads[idx].personalPhoneScore = bestScore;
      leads[idx].personalPhoneSource = bestSource;
      leads[idx].personalPhoneFoundAt = new Date().toISOString();
    }
  }

  if (i < targets.length - 1) await sleep(2000);
}

if (!DRY_RUN && found > 0) {
  writeJsonSafe(OUTREACH_PATH, leads);
}

console.log(`\n${"─".repeat(54)}`);
console.log(`  Personal Phone Finder — ${targets.length} clinics processed`);
console.log(`${"─".repeat(54)}`);
console.log(`  Personal/direct lines found:  ${results.filter(r => r.score >= 7).length}`);
console.log(`  Clinic lines found:           ${results.filter(r => r.score < 7 && r.score > 0).length}`);
console.log(`  Not found:                    ${targets.length - found}`);
if (results.length > 0) {
  console.log(`\n  Results:`);
  for (const r of results) {
    const tag = r.score >= 10 ? "[CELL]" : r.score >= 7 ? "[DIRECT]" : "[CLINIC]";
    console.log(`  ${tag.padEnd(10)} ${r.contactName} — ${r.phone} (${r.source})`);
  }
}
console.log(DRY_RUN ? "\n  (dry-run — no changes written)" : `\n  Saved → ${OUTREACH_PATH}`);
