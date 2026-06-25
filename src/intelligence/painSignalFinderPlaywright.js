// src/intelligence/painSignalFinderPlaywright.js
// Pain Signal Finder — Playwright edition.
// Opens Google Maps in a real browser, navigates to each clinic's review page,
// and extracts actual review text. This is the only reliable way to access
// Google Reviews without a paid API.
//
// Usage:
//   node src/intelligence/painSignalFinderPlaywright.js [--limit 30] [--headless]

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { chromium } from "playwright";
import dotenv from "dotenv";

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const DATA_DIR = path.join(ROOT, "data");

const OUTREACH_PATH = path.join(DATA_DIR, "outreach.localDentists.json");
const OUT_PATH      = path.join(DATA_DIR, "intelligence", "pain-signal-results.json");
const QUEUE_PATH    = path.join(DATA_DIR, "pain-signal-queue.json");
const DRAFTS_DIR    = path.join(DATA_DIR, "reply-drafts");

const args       = process.argv.slice(2);
const LIMIT_IDX  = args.indexOf("--limit");
const LIMIT      = LIMIT_IDX !== -1 ? Number(args[LIMIT_IDX + 1]) : 30;
const HEADLESS   = args.includes("--headless");
const FORCE      = args.includes("--force");

// ── Pain signal groups ─────────────────────────────────────────────────────────
const PAIN_GROUPS = [
  {
    name: "unreachable",
    keywords: [
      "can't get through", "cannot get through", "couldn't reach", "hard to reach",
      "hard to contact", "difficult to contact", "difficult to reach",
      "receptionist never answers", "never answers", "nobody answers",
      "impossible to reach", "unreachable", "no one picks up", "no answer",
      "phone goes unanswered", "never pick up",
    ],
  },
  {
    name: "no_callback",
    keywords: [
      "no callback", "never called back", "didn't call back", "no call back",
      "never heard back", "no response", "left a message", "no return call",
      "waiting for a call", "still waiting", "called multiple times",
    ],
  },
  {
    name: "voicemail",
    keywords: [
      "voicemail", "answering machine", "goes to voicemail",
      "always voicemail", "stuck on voicemail", "just a voicemail",
    ],
  },
  {
    name: "no_reminder",
    keywords: [
      "no reminder", "didn't remind", "forgot my appointment", "missed my appointment",
      "no confirmation", "no appointment reminder", "never reminded",
      "missed appointment", "appointment was forgotten",
    ],
  },
  {
    name: "poor_comms",
    keywords: [
      "poor communication", "bad communication", "communication issues",
      "lack of communication", "no follow-up", "no follow up", "never follow",
      "front desk never", "front desk doesn't", "office doesn't respond",
    ],
  },
];

function scoreText(text) {
  const lower = text.toLowerCase();
  const hitGroups = new Set();
  const hitKeywords = [];
  const quotes = [];
  for (const group of PAIN_GROUPS) {
    for (const kw of group.keywords) {
      if (lower.includes(kw)) {
        hitGroups.add(group.name);
        if (!hitKeywords.includes(kw)) hitKeywords.push(kw);
        const idx = lower.indexOf(kw);
        const start = Math.max(0, idx - 80);
        const end   = Math.min(text.length, idx + kw.length + 120);
        const snippet = text.slice(start, end).replace(/\s+/g, " ").trim();
        if (snippet.length > 20 && !quotes.some(q => q.includes(kw))) {
          quotes.push(`"...${snippet}..."`);
        }
      }
    }
  }
  return { score: hitGroups.size, keywords: hitKeywords, groups: [...hitGroups], quotes };
}

function tier(score) {
  if (score >= 3) return "CRITICAL";
  if (score === 2) return "HIGH";
  if (score === 1) return "MEDIUM";
  return "none";
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function rand(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }

// ── Google Maps scraper ────────────────────────────────────────────────────────
async function scrapeGoogleMaps(page, clinicName, city) {
  const query = encodeURIComponent(`${clinicName} ${city} dental`);
  const searchUrl = `https://www.google.com/maps/search/${query}`;

  try {
    await page.goto(searchUrl, { waitUntil: "domcontentloaded", timeout: 25_000 });
    await sleep(rand(1500, 2500));

    // If we landed on a list, click the first result — use a short timeout so we
    // don't block when Google navigated directly to the business page already.
    const firstResult = page.locator('[role="article"], .Nv2PK').first();
    const isListView = await firstResult.count() > 0;
    if (isListView) {
      try {
        await firstResult.click({ timeout: 5_000 });
        await sleep(rand(1200, 2000));
      } catch { /* already on business page */ }
    }

    // Wait for the Reviews tab to appear (means we're on a business page)
    const reviewsTabLocator = page.locator('button[aria-label*="Review" i], button:has-text("Reviews"), [data-tab-index="1"]').first();
    try {
      await reviewsTabLocator.waitFor({ state: "visible", timeout: 8_000 });
      await reviewsTabLocator.click();
      await sleep(rand(1500, 2500));
    } catch {
      // No reviews tab found — business page may not have loaded or has no reviews
      return { reviewTexts: [], dates: [] };
    }

    // Sort by Newest
    const sortBtn = page.locator('[aria-label*="Sort" i], button:has-text("Sort by")').first();
    if (await sortBtn.count() > 0) {
      try {
        await sortBtn.click({ timeout: 3_000 });
        await sleep(600);
        const newestOpt = page.locator('[aria-label*="Newest" i], li:has-text("Newest")').first();
        if (await newestOpt.count() > 0) {
          await newestOpt.click();
          await sleep(rand(1000, 1500));
        }
      } catch { /* sort failed, use default order */ }
    }

    // Scroll reviews panel to load more
    const reviewPanel = page.locator('[aria-label*="Review" i][role="main"], .m6QErb').first();
    if (await reviewPanel.count() > 0) {
      for (let s = 0; s < 3; s++) {
        await reviewPanel.evaluate(el => el.scrollBy(0, 800));
        await sleep(500);
      }
    }

    // Expand "More" buttons
    const moreButtons = page.locator('button:has-text("More")');
    const moreCount = await moreButtons.count();
    for (let i = 0; i < Math.min(moreCount, 15); i++) {
      try { await moreButtons.nth(i).click({ timeout: 2_000 }); await sleep(200); } catch {}
    }

    // Extract review text — try multiple selectors Google uses
    const reviewTexts = await page.locator('.wiI7pd, .jlymHd, [data-review-id] span, .MyEned span').allTextContents();
    const dates = await page.locator('.rsqaWe, .xRkPPb, [data-review-id] .DU9Pgb').allTextContents();

    return {
      reviewTexts: reviewTexts.filter(t => t.trim().length > 15),
      dates: dates.filter(Boolean),
    };
  } catch (err) {
    return { reviewTexts: [], dates: [], error: err.message.slice(0, 100) };
  }
}

// ── Generate email ─────────────────────────────────────────────────────────────
function generatePainEmail(clinicName, result) {
  const rawQuote = result.reviewPainQuotes?.[0] || "";
  const cleanQuote = rawQuote.replace(/^"?\.\.\./, "").replace(/\.\.\."?$/, "").trim().slice(0, 200);
  const quoteBlock = cleanQuote.length > 20
    ? `One patient wrote: "${cleanQuote}"`
    : `Patients mentioned communication issues at ${clinicName}`;

  return {
    subject: `Saw something in your Google reviews — ${clinicName}`,
    body: `Hi,

I was looking at ${clinicName}'s Google reviews before reaching out.
${quoteBlock}

That's exactly what I fix for dental clinics. Automated follow-up so no call goes unanswered — patients get a text within 60 seconds.

Free audit, 10 minutes, no commitment.

Worth a look?

Mohamed
ClinicFlow Automation
438-544-0442`,
  };
}

// ── Helpers ────────────────────────────────────────────────────────────────────
function readJsonSafe(p, fb) {
  try { return JSON.parse(fs.readFileSync(p, "utf-8")); } catch { return fb; }
}
function writeJson(p, data) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(data, null, 2), "utf-8");
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  const leads = readJsonSafe(OUTREACH_PATH, []);

  // Prioritise: high opportunity score, have email, todo status
  const existing = readJsonSafe(OUT_PATH, { all: [] });
  const alreadyDone = new Set(
    (existing.all || [])
      .filter(r => r.source === "google-maps-playwright" && (r.reviewPainScore || 0) >= 0)
      .map(r => r.clinicName?.toLowerCase())
  );

  const candidates = leads
    .filter(c => c.clinicName && (c.website || c.email))
    .filter(c => FORCE || !alreadyDone.has(c.clinicName?.toLowerCase()))
    .sort((a, b) => (b.opportunityScore || 0) - (a.opportunityScore || 0))
    .slice(0, LIMIT);

  console.log(`\nPain Signal Finder (Playwright / Google Maps)`);
  console.log(`Clinics to scan:  ${candidates.length}  (limit: ${LIMIT})`);
  console.log(`Headless:         ${HEADLESS}`);
  console.log(`Already scanned:  ${alreadyDone.size}\n`);

  const browser = await chromium.launch({
    headless: HEADLESS,
    args: ["--no-sandbox", "--disable-blink-features=AutomationControlled"],
  });
  const context = await browser.newContext({
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    locale: "en-CA",
    geolocation: { latitude: 43.6532, longitude: -79.3832 }, // Toronto
    permissions: ["geolocation"],
  });
  const page = await context.newPage();

  // Accept cookies / consent if shown
  await page.goto("https://www.google.com", { waitUntil: "domcontentloaded", timeout: 15_000 }).catch(() => {});
  const consentBtn = page.locator('button:has-text("Accept all"), button:has-text("I agree"), [aria-label*="Accept all"]').first();
  if (await consentBtn.count() > 0) { await consentBtn.click(); await sleep(800); }

  const results = [];
  let critical = 0, high = 0, medium = 0, none = 0;

  for (let i = 0; i < candidates.length; i++) {
    const clinic = candidates[i];
    process.stdout.write(`[${i + 1}/${candidates.length}] ${(clinic.clinicName || "").slice(0, 45).padEnd(45)}  `);

    const { reviewTexts, dates, error } = await scrapeGoogleMaps(page, clinic.clinicName, clinic.city || "");

    if (error) {
      process.stdout.write(`✗ error: ${error.slice(0, 50)}\n`);
      results.push({ clinicName: clinic.clinicName, city: clinic.city, email: clinic.email, reviewPainScore: 0, reviewPainTier: "none", reviewPainKeywords: [], reviewPainGroups: [], reviewPainQuotes: [], reviewsFound: 0, error, scrapedAt: new Date().toISOString(), source: "google-maps-playwright" });
      continue;
    }

    const combined = reviewTexts.join(" ");
    const { score, keywords, groups, quotes } = scoreText(combined);
    const t = tier(score);

    if (t !== "none")     { process.stdout.write(`${t}  keywords: ${keywords.slice(0,3).join(", ")}\n`); }
    else                  { process.stdout.write(`ok (${reviewTexts.length} reviews, 0 pain signals)\n`); }

    if (t === "CRITICAL") {
      critical++;
      quotes.forEach(q => console.log(`  → ${q.slice(0, 120)}`));
    } else if (t === "HIGH")   { high++; }
    else if (t === "MEDIUM")   { medium++; }
    else                       { none++; }

    results.push({
      clinicName:         clinic.clinicName,
      city:               clinic.city || "",
      email:              clinic.email || "",
      website:            clinic.website || "",
      reviewPainScore:    score,
      reviewPainTier:     t,
      reviewPainKeywords: keywords,
      reviewPainGroups:   groups,
      reviewPainQuotes:   quotes.slice(0, 3),
      reviewsFound:       reviewTexts.length,
      recentDates:        dates.slice(0, 3),
      hasRecentReview:    dates.some(d => /day|week|hour/i.test(d)),
      scrapedAt:          new Date().toISOString(),
      source:             "google-maps-playwright",
    });

    // Save progress every 5 clinics
    if ((i + 1) % 5 === 0) {
      const partial = buildOutput([...(existing.all || []), ...results]);
      writeJson(OUT_PATH, partial);
    }

    // Polite delay
    if (i < candidates.length - 1) await sleep(rand(2500, 4000));
  }

  await browser.close();

  // Merge with existing results
  const allResults = [...(existing.all || []).filter(r => r.source !== "google-maps-playwright"), ...results];
  const output = buildOutput(allResults);
  writeJson(OUT_PATH, output);

  // Update outreach records
  const resultMap = new Map(results.map(r => [r.clinicName?.toLowerCase(), r]));
  let updated = 0;
  for (let i = 0; i < leads.length; i++) {
    const r = resultMap.get(leads[i].clinicName?.toLowerCase());
    if (r) {
      leads[i].reviewPainScore  = r.reviewPainScore;
      leads[i].reviewPainQuotes = r.reviewPainQuotes;
      updated++;
    }
  }
  writeJson(OUTREACH_PATH, leads);

  // Priority queue
  const priorityQueue = results
    .filter(r => r.reviewPainTier === "CRITICAL" || r.reviewPainTier === "HIGH")
    .sort((a, b) => b.reviewPainScore - a.reviewPainScore)
    .map(r => {
      const email = generatePainEmail(r.clinicName, r);
      return {
        clinicName: r.clinicName, city: r.city, email: r.email, tier: r.reviewPainTier,
        reviewPainScore: r.reviewPainScore, reviewPainGroups: r.reviewPainGroups,
        reviewPainQuotes: r.reviewPainQuotes, hasRecentReview: r.hasRecentReview,
        subject: email.subject, emailDraft: email.body,
        addedAt: new Date().toISOString(),
      };
    });

  // Merge with existing queue
  const existingQueue = readJsonSafe(QUEUE_PATH, []);
  const merged = [...existingQueue.filter(q => !priorityQueue.some(p => p.clinicName === q.clinicName)), ...priorityQueue]
    .sort((a, b) => b.reviewPainScore - a.reviewPainScore);
  writeJson(QUEUE_PATH, merged);

  // Save CRITICAL email drafts
  fs.mkdirSync(DRAFTS_DIR, { recursive: true });
  for (const r of priorityQueue.filter(r => r.tier === "CRITICAL")) {
    const slug = r.clinicName.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 40);
    writeJson(path.join(DRAFTS_DIR, `pain-signal-${slug}.json`), {
      generatedAt: new Date().toISOString(), clinicName: r.clinicName,
      email: r.email, type: "pain_signal", tier: r.tier,
      reviewPainScore: r.reviewPainScore, reviewPainQuotes: r.reviewPainQuotes,
      subject: r.subject, body: r.emailDraft,
    });
  }

  console.log(`\n${"═".repeat(58)}`);
  console.log(`  Playwright Scan — ${results.length} clinics`);
  console.log(`${"═".repeat(58)}`);
  console.log(`  CRITICAL (3+): ${critical}`);
  console.log(`  HIGH (2):      ${high}`);
  console.log(`  MEDIUM (1):    ${medium}`);
  console.log(`  None:          ${none}`);
  console.log(`  Outreach records updated: ${updated}`);
  console.log(`  Priority queue total:     ${merged.length}`);

  const top20 = merged.slice(0, 20);
  if (top20.length > 0) {
    console.log(`\n${"─".repeat(58)}`);
    console.log(`  TOP ${top20.length} CLINICS — COMMUNICATION PAIN SIGNALS`);
    console.log(`${"─".repeat(58)}`);
    top20.forEach((r, i) => {
      const recent = r.hasRecentReview ? " ⚡RECENT" : "";
      console.log(`\n  ${i + 1}. [${r.tier}]${recent} ${r.clinicName}  (${r.city})`);
      console.log(`     Score: ${r.reviewPainScore}  |  Groups: ${r.reviewPainGroups?.join(", ")}`);
      console.log(`     Email: ${r.email || "(no email)"}`);
      r.reviewPainQuotes?.slice(0, 2).forEach(q => console.log(`     → ${q.slice(0, 130)}`));
    });
  } else {
    console.log(`\n  No CRITICAL/HIGH clinics found in this batch.`);
  }

  console.log(`\n  Results → ${OUT_PATH}`);
  console.log(`  Queue   → ${QUEUE_PATH}`);
}

function buildOutput(results) {
  const withSignals = results.filter(r => (r.reviewPainScore || 0) > 0);
  const byTier = { CRITICAL: 0, HIGH: 0, MEDIUM: 0 };
  for (const r of withSignals) if (byTier[r.reviewPainTier] !== undefined) byTier[r.reviewPainTier]++;
  const kwTally = {};
  for (const r of withSignals) for (const kw of (r.reviewPainKeywords || [])) kwTally[kw] = (kwTally[kw] || 0) + 1;
  return {
    generatedAt: new Date().toISOString(),
    totalAnalysed: results.length,
    clinicsWithPainSignals: withSignals.length, byTier,
    topComplaints: Object.entries(kwTally).sort((a,b)=>b[1]-a[1]).slice(0,10).map(([kw,count])=>({kw,count})),
    highPainClinics: withSignals.sort((a,b)=>(b.reviewPainScore||0)-(a.reviewPainScore||0)).slice(0,20).map(r=>({
      clinicName: r.clinicName, city: r.city, email: r.email, tier: r.reviewPainTier,
      reviewPainScore: r.reviewPainScore, reviewPainGroups: r.reviewPainGroups, reviewPainQuotes: r.reviewPainQuotes,
      hasRecentReview: r.hasRecentReview,
    })),
    all: results,
  };
}

main().catch(e => { console.error("Failed:", e.message); process.exit(1); });
