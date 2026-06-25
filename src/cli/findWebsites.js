// src/cli/findWebsites.js
// Step 1 of the two-step physio email pipeline.
// Uses Playwright (real browser) to search Google for each clinic and extract
// the website URL from the Knowledge Panel or first organic result.
// Raw fetch isn't viable — DDG/Google serve JS bot-detection challenges.
//
// Usage:
//   node src/cli/findWebsites.js [--market physio|dental|all] [--limit N] [--dry-run]

import fs from "fs";
import path from "path";
import dotenv from "dotenv";
import { chromium } from "playwright";

dotenv.config();
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

// ─── CLI flags ────────────────────────────────────────────────────────────────

const MARKET_ARG = (() => {
  const i = process.argv.indexOf("--market");
  return i !== -1 ? process.argv[i + 1] : "physio";
})();

const LIMIT_ARG = (() => {
  const i = process.argv.indexOf("--limit");
  return i !== -1 ? Number(process.argv[i + 1]) : 100;
})();

const DRY_RUN = process.argv.includes("--dry-run");

// ─── Config ───────────────────────────────────────────────────────────────────

const MARKET_PATHS = {
  dental: path.join(process.cwd(), "data", "outreach.localDentists.json"),
  physio: path.join(process.cwd(), "data", "outreach.physioClinics.json"),
};

const MARKET_KEYWORDS = {
  dental: "dental clinic",
  physio: "physiotherapy",
};

const DELAY_MS_MIN = 2000;
const DELAY_MS_MAX = 4000;

const BLOCKLIST_HOSTS = new Set([
  "google.com", "bing.com", "yahoo.com", "duckduckgo.com",
  "facebook.com", "instagram.com", "twitter.com", "x.com", "youtube.com",
  "linkedin.com", "yelp.com", "yelp.ca", "yellowpages.ca", "411.ca",
  "canpages.ca", "foursquare.com", "tripadvisor.com", "ratemds.com",
  "clinicfinder.ca", "topdoctors.ca", "physicianfinder.ca",
  "healthgrades.com", "zocdoc.com", "vitals.com", "booksy.com",
  "jane.app", "clinicmaster.com", "mapquest.com", "maps.apple.com",
]);

function rand(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function isClinicUrl(urlStr, clinicName) {
  try {
    const u = new URL(urlStr);
    const host = u.hostname.replace("www.", "").toLowerCase();
    if (BLOCKLIST_HOSTS.has(host)) return false;
    if (host.includes("google.") || host.includes("gstatic.")) return false;
    // Must be http/https
    if (!urlStr.startsWith("http")) return false;
    return true;
  } catch { return false; }
}

// ─── Extract website from a Google search result page ────────────────────────

async function findWebsiteViaGoogle(page, clinicName, city, keyword) {
  const query = `"${clinicName}" ${city} ${keyword}`;
  const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(query)}&hl=en`;

  try {
    await page.goto(searchUrl, { waitUntil: "domcontentloaded", timeout: 20_000 });
    await sleep(rand(800, 1500));

    // 1. Knowledge Panel website button (most reliable)
    const kpWebsite = page.locator('a[aria-label*="website" i], a[data-ved][href]:has-text("Website"), [data-attrid="kc:/collection/knowledge_panels/has_url:website"] a').first();
    if (await kpWebsite.count() > 0) {
      const href = await kpWebsite.getAttribute("href").catch(() => null);
      if (href && isClinicUrl(href, clinicName)) return href.split("?")[0].replace(/\/$/, "");
    }

    // 2. First organic result link (h3 → parent a)
    const organicLinks = await page.locator('div#search a[href^="http"]:not([href*="google."]):not([href*="youtube."]) h3').all();
    for (const el of organicLinks.slice(0, 3)) {
      const parentA = await el.evaluateHandle(el => el.closest('a'));
      const href = await parentA.asElement()?.getAttribute("href").catch(() => null);
      if (href && isClinicUrl(href, clinicName)) {
        try { return new URL(href).origin; } catch { return href.split("?")[0]; }
      }
    }

    // 3. Fallback: any link in the results that's not a directory
    const allLinks = await page.locator('div#search a[href^="http"]').all();
    for (const el of allLinks.slice(0, 10)) {
      const href = await el.getAttribute("href").catch(() => null);
      if (href && isClinicUrl(href, clinicName)) {
        try { return new URL(href).origin; } catch { return null; }
      }
    }

    return null;
  } catch { return null; }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const markets = MARKET_ARG === "all" ? Object.keys(MARKET_PATHS) : [MARKET_ARG];

  const browser = await chromium.launch({
    headless: true,
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

  for (const market of markets) {
    const queuePath = MARKET_PATHS[market];
    if (!queuePath || !fs.existsSync(queuePath)) { console.log(`No queue: ${market}`); continue; }

    const records = JSON.parse(fs.readFileSync(queuePath, "utf-8"));
    const keyword = MARKET_KEYWORDS[market] || market;

    const targets = records
      .map((r, idx) => ({ r, idx }))
      .filter(({ r }) => !r.website && !r.email && !r.excludeForever && r.status === "todo" && r.clinicName && r.city)
      .slice(0, LIMIT_ARG);

    console.log(`\n── ${market.toUpperCase()} — ${targets.length} clinics (limit ${LIMIT_ARG}) ──`);
    if (DRY_RUN) console.log("DRY RUN — no changes saved\n");

    let found = 0, notFound = 0;

    for (let i = 0; i < targets.length; i++) {
      const { r, idx } = targets[i];
      const label = `[${String(i + 1).padStart(String(targets.length).length)}/${targets.length}]`;
      process.stdout.write(`${label} ${r.clinicName.slice(0, 44).padEnd(46)}`);

      const website = await findWebsiteViaGoogle(page, r.clinicName, r.city, keyword);

      if (website) {
        process.stdout.write(`→ ${website}\n`);
        if (!DRY_RUN) {
          records[idx].website = website;
          records[idx].websiteFoundAt = new Date().toISOString();
          records[idx].websiteSource = "google-search";
        }
        found++;
      } else {
        process.stdout.write(`— not found\n`);
        notFound++;
      }

      if (!DRY_RUN && (i + 1) % 25 === 0) {
        fs.writeFileSync(queuePath, JSON.stringify(records, null, 2));
        process.stdout.write(`  [saved ${i + 1}/${targets.length}]\n`);
      }

      if (i < targets.length - 1) await sleep(rand(DELAY_MS_MIN, DELAY_MS_MAX));
    }

    if (!DRY_RUN) fs.writeFileSync(queuePath, JSON.stringify(records, null, 2));

    console.log(`\n────────────────────────────────────────────────────`);
    console.log(`  Website discovery — ${market.toUpperCase()} complete`);
    console.log(`────────────────────────────────────────────────────`);
    console.log(`  Found:     ${found} (${Math.round(found / (targets.length || 1) * 100)}%)`);
    console.log(`  Not found: ${notFound}`);
    if (found > 0 && !DRY_RUN) console.log(`\n  Next: node src/cli/enrichEmails.js --market ${market} --limit ${found}`);
  }

  await browser.close();
}

main().catch(e => { console.error("findWebsites failed:", e.message); process.exit(1); });
