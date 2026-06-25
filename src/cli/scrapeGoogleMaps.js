// src/cli/scrapeGoogleMaps.js
// Discovers dental (and physio) clinics via Google Maps using Playwright.
// Searches for businesses in every major Canadian city and merges new
// records into the appropriate outreach queue.
//
// Usage:
//   node src/cli/scrapeGoogleMaps.js                        # dental, all cities
//   node src/cli/scrapeGoogleMaps.js --market physio        # physio, all cities
//   node src/cli/scrapeGoogleMaps.js --city "Windsor" --province "ON"
//   node src/cli/scrapeGoogleMaps.js --limit-cities 10      # first N cities only
//   node src/cli/scrapeGoogleMaps.js --dry-run              # print without saving

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { chromium } from "playwright";
import { v4 as uuidv4 } from "uuid";
import dotenv from "dotenv";

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const DATA_DIR = path.join(ROOT, "data");

// ── CLI flags ─────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const MARKET = (() => { const i = args.indexOf("--market"); return i !== -1 ? args[i+1] : "dental"; })();
const CITY_ARG = (() => { const i = args.indexOf("--city"); return i !== -1 ? args[i+1] : null; })();
const PROV_ARG = (() => { const i = args.indexOf("--province"); return i !== -1 ? args[i+1] : null; })();
const LIMIT_CITIES = (() => { const i = args.indexOf("--limit-cities"); return i !== -1 ? Number(args[i+1]) : 9999; })();
const DRY_RUN = args.includes("--dry-run");
const HEADLESS = !args.includes("--show-browser");
// Max results per search query (Google Maps shows ~20 initially, ~80 with scrolling)
const MAX_PER_QUERY = 60;

// ── Output paths ──────────────────────────────────────────────────────────────
const OUTREACH_PATHS = {
  dental: path.join(DATA_DIR, "outreach.localDentists.json"),
  physio: path.join(DATA_DIR, "outreach.physioClinics.json"),
};
const OUTREACH_PATH = OUTREACH_PATHS[MARKET] || OUTREACH_PATHS.dental;

// ── City / query definitions ──────────────────────────────────────────────────
const ALL_CITIES = [
  // Ontario
  { city: "Toronto",       province: "ON" },
  { city: "Ottawa",        province: "ON" },
  { city: "Mississauga",   province: "ON" },
  { city: "Brampton",      province: "ON" },
  { city: "Hamilton",      province: "ON" },
  { city: "London",        province: "ON" },
  { city: "Windsor",       province: "ON" },
  { city: "Kitchener",     province: "ON" },
  { city: "Waterloo",      province: "ON" },
  { city: "Markham",       province: "ON" },
  { city: "Vaughan",       province: "ON" },
  { city: "Richmond Hill", province: "ON" },
  { city: "Oakville",      province: "ON" },
  { city: "Burlington",    province: "ON" },
  { city: "Barrie",        province: "ON" },
  { city: "Sudbury",       province: "ON" },
  { city: "Thunder Bay",   province: "ON" },
  { city: "Kingston",      province: "ON" },
  { city: "Guelph",        province: "ON" },
  { city: "Oshawa",        province: "ON" },
  // Quebec
  { city: "Montreal",       province: "QC" },
  { city: "Quebec City",    province: "QC" },
  { city: "Laval",          province: "QC" },
  { city: "Gatineau",       province: "QC" },
  { city: "Longueuil",      province: "QC" },
  { city: "Sherbrooke",     province: "QC" },
  { city: "Saguenay",       province: "QC" },
  { city: "Trois-Rivieres", province: "QC" },
  { city: "Terrebonne",     province: "QC" },
  // British Columbia
  { city: "Vancouver",    province: "BC" },
  { city: "Surrey",       province: "BC" },
  { city: "Burnaby",      province: "BC" },
  { city: "Richmond",     province: "BC" },
  { city: "Kelowna",      province: "BC" },
  { city: "Victoria",     province: "BC" },
  { city: "Abbotsford",   province: "BC" },
  { city: "Coquitlam",    province: "BC" },
  // Alberta
  { city: "Calgary",    province: "AB" },
  { city: "Edmonton",   province: "AB" },
  { city: "Red Deer",   province: "AB" },
  { city: "Lethbridge", province: "AB" },
  // Others
  { city: "Winnipeg",  province: "MB" },
  { city: "Halifax",   province: "NS" },
  { city: "Saskatoon", province: "SK" },
  { city: "Regina",    province: "SK" },
];

const SEARCH_TERMS = {
  dental: ["dental clinic", "dentist", "family dentist"],
  physio: ["physiotherapy clinic", "physio", "rehabilitation clinic"],
};

// ── Helpers ───────────────────────────────────────────────────────────────────
function readJsonSafe(p, fb) {
  try { return JSON.parse(fs.readFileSync(p, "utf-8")); } catch { return fb; }
}
function writeJsonSafe(p, data) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(data, null, 2), "utf-8");
}
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function rand(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }

function normalizeUrl(raw) {
  if (!raw) return "";
  try {
    let u = raw.trim();
    if (!u) return "";
    if (!/^https?:\/\//i.test(u)) u = "https://" + u;
    const p = new URL(u);
    p.hash = "";
    p.pathname = p.pathname.replace(/\/+$/, "");
    return p.origin + (p.pathname !== "/" ? p.pathname : "");
  } catch { return ""; }
}

function fingerprint(name, city) {
  return `${(name || "").toLowerCase().replace(/[^a-z0-9]/g, "")}|${(city || "").toLowerCase()}`;
}

// ── Google Maps scraper ────────────────────────────────────────────────────────
async function searchCity(page, searchTerm, city, province) {
  const query = encodeURIComponent(`${searchTerm} ${city} ${province} Canada`);
  const url   = `https://www.google.com/maps/search/${query}`;

  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 25_000 });
    await sleep(rand(1500, 2500));

    // Accept cookies if shown
    const acceptBtn = page.locator('button:has-text("Accept all"), button:has-text("I agree"), [aria-label*="Accept all"]').first();
    if (await acceptBtn.count() > 0) {
      try { await acceptBtn.click({ timeout: 3_000 }); await sleep(500); } catch {}
    }

    // Wait for results feed to appear
    const feed = page.locator('[role="feed"], .m6QErb[aria-label]').first();
    try { await feed.waitFor({ state: "visible", timeout: 10_000 }); }
    catch { return []; } // no results loaded

    // Scroll the feed to load more results
    const scrollTarget = page.locator('[role="feed"]').first();
    let prevCount = 0;
    for (let scroll = 0; scroll < 8; scroll++) {
      const items = await page.locator('[role="feed"] [role="article"], [role="feed"] .Nv2PK').count();
      if (items >= MAX_PER_QUERY) break;
      if (scroll > 2 && items === prevCount) break; // no new items loading
      prevCount = items;
      try {
        await scrollTarget.evaluate(el => el.scrollBy(0, 1200));
        await sleep(rand(800, 1400));
      } catch { break; }
    }

    // Extract all result cards
    const results = [];
    const articles = page.locator('[role="feed"] [role="article"], [role="feed"] .Nv2PK');
    const count = Math.min(await articles.count(), MAX_PER_QUERY);

    for (let i = 0; i < count; i++) {
      try {
        const card = articles.nth(i);

        // Business name
        const nameEl = card.locator('.qBF1Pd, [class*="fontHeadline"], h3').first();
        const name = (await nameEl.textContent({ timeout: 2_000 }).catch(() => "")).trim();
        if (!name) continue;

        // Skip if clearly not a clinic
        const lower = name.toLowerCase();
        const skipWords = ["college", "university", "school", "supply", "equipment", "wholesale", "pharmacy"];
        if (skipWords.some(w => lower.includes(w))) continue;

        // Rating
        const ratingEl = card.locator('.MW4etd, [aria-label*="stars"], [aria-label*="étoiles"]').first();
        const ratingText = await ratingEl.getAttribute("aria-label", { timeout: 1_000 }).catch(() => "");
        const rating = parseFloat((ratingText || "").match(/[\d.]+/)?.[0] || "0") || 0;

        // Review count
        const reviewEl = card.locator('.UY7F9, [aria-label*="review"], [aria-label*="avis"]').first();
        const reviewText = await reviewEl.textContent({ timeout: 1_000 }).catch(() => "");
        const reviewCount = parseInt((reviewText || "").replace(/[^0-9]/g, "") || "0") || 0;

        // Address / secondary info lines
        const infoLines = await card.locator('.W4Efsd > span, .W4Efsd .W4Efsd').allTextContents().catch(() => []);
        const address = infoLines.find(l => /\d/.test(l) && l.length > 5) || "";

        // Phone — sometimes visible in list
        const phone = infoLines.find(l => /\+?[\d\s\-().]{7,}/.test(l) && l.replace(/[^0-9]/g, "").length >= 7) || "";

        results.push({ name, address, phone, rating, reviewCount, city, province });
      } catch { /* skip malformed card */ }
    }

    return results;
  } catch (err) {
    console.warn(`    ⚠ Search failed (${err.message.slice(0, 60)})`);
    return [];
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  // Determine cities to process
  let cities = CITY_ARG
    ? [{ city: CITY_ARG, province: PROV_ARG || "ON" }]
    : ALL_CITIES.slice(0, LIMIT_CITIES);

  const terms = SEARCH_TERMS[MARKET] || SEARCH_TERMS.dental;

  console.log(`\nGoogle Maps Clinic Scraper`);
  console.log(`Market:    ${MARKET}`);
  console.log(`Cities:    ${cities.length}`);
  console.log(`Queries:   ${cities.length * terms.length} total (${terms.length}/city)`);
  console.log(`Headless:  ${HEADLESS}`);
  console.log(`Dry run:   ${DRY_RUN}\n`);

  // Load existing queue for dedup
  const existing = readJsonSafe(OUTREACH_PATH, []);
  const existingFingerprints = new Set(
    existing.map(e => fingerprint(e.clinicName || e.name, e.city))
  );
  console.log(`Existing queue: ${existing.length} records\n`);

  const browser = await chromium.launch({
    headless: HEADLESS,
    args: ["--no-sandbox", "--disable-blink-features=AutomationControlled"],
  });
  const context = await browser.newContext({
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    locale: "en-CA",
    viewport: { width: 1280, height: 900 },
  });
  const page = await context.newPage();

  // Accept Google consent once
  await page.goto("https://www.google.com", { waitUntil: "domcontentloaded", timeout: 15_000 }).catch(() => {});
  const consent = page.locator('button:has-text("Accept all"), button:has-text("I agree")').first();
  if (await consent.count() > 0) {
    try { await consent.click(); await sleep(600); } catch {}
  }

  const allNew = [];
  const cityStats = [];

  for (let ci = 0; ci < cities.length; ci++) {
    const { city, province } = cities[ci];
    let cityNew = 0;
    let cityTotal = 0;

    for (const term of terms) {
      process.stdout.write(`  [${ci+1}/${cities.length}] ${city}, ${province}  "${term}"... `);

      const found = await searchCity(page, term, city, province);
      cityTotal += found.length;

      for (const f of found) {
        const fp = fingerprint(f.name, city);
        if (existingFingerprints.has(fp)) continue;
        existingFingerprints.add(fp);

        const record = {
          id:            uuidv4().slice(0, 12),
          clinicName:    f.name,
          website:       normalizeUrl(f.website || ""),
          domain:        "",
          city,
          province,
          score:         null,
          tier:          null,
          email:         "",
          emailConfidence: "none",
          contactPage:   "",
          foundEmails:   [],
          guessedEmails: [],
          status:        "todo",
          method:        "manual",
          notes:         `Discovered by scrapeGoogleMaps.js — "${term}"`,
          sentAt:        "",
          followupDueAt: "",
          lastError:     "",
          enrichedAt:    "",
          discoveredAt:  new Date().toISOString(),
          source:        "google-maps-scraper",
          planPath:      "",
          planHtmlPath:  "",
          planGeneratedAt: "",
          opportunityScore: 8,
          address:       f.address || "",
          phone:         f.phone   || "",
          googleRating:  f.rating  || null,
          googleReviews: f.reviewCount || null,
          market:        MARKET === "physio" ? "physio" : undefined,
        };
        // Remove undefined keys
        Object.keys(record).forEach(k => record[k] === undefined && delete record[k]);
        allNew.push(record);
        cityNew++;
      }

      console.log(`${found.length} found  (+${cityNew} new so far)`);
      await sleep(rand(1200, 2200));
    }

    cityStats.push({ city, province, scraped: cityTotal, new: cityNew });
    await sleep(rand(1000, 2000));
  }

  await browser.close();

  // ── Summary ─────────────────────────────────────────────────────────────────
  const total = allNew.length;
  console.log(`\n${"═".repeat(56)}`);
  console.log(`  Google Maps Scrape — Complete`);
  console.log(`${"═".repeat(56)}`);
  cityStats.forEach(s => {
    if (s.new > 0) console.log(`  ${`${s.city}, ${s.province}`.padEnd(22)} +${s.new} new  (${s.scraped} scraped)`);
  });
  console.log(`\n  Total new clinics found: ${total}`);
  console.log(`  Existing queue was:      ${existing.length}`);
  console.log(`  New queue will be:       ${existing.length + total}`);

  if (DRY_RUN) {
    console.log("\n  Dry run — no changes saved.");
    console.log("  Sample new records:");
    allNew.slice(0, 5).forEach(r => console.log(`    • ${r.clinicName}  (${r.city})  rating=${r.googleRating}`));
    return;
  }

  if (total > 0) {
    const merged = [...existing, ...allNew];
    writeJsonSafe(OUTREACH_PATH, merged);
    console.log(`\n  Saved → ${OUTREACH_PATH}`);
    console.log(`  Run 'npm run enrich' to find emails for new clinics.`);
  } else {
    console.log("\n  No new clinics found.");
  }

  // Projection
  const avgPerCity = total / Math.max(cities.length, 1);
  const remaining = ALL_CITIES.length - cities.length;
  console.log(`\n  Avg new clinics/city: ${avgPerCity.toFixed(0)}`);
  if (remaining > 0) {
    console.log(`  Projected total if run on all ${ALL_CITIES.length} cities: ~${Math.round(avgPerCity * ALL_CITIES.length)}`);
  }
}

main().catch(e => {
  console.error("\nScraper failed:", e.message);
  process.exit(1);
});
