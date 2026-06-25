// src/intelligence/painSignalFinder.js
// Google Reviews Pain Signal Finder
// Searches for dental clinics whose patients publicly complain about
// missed calls, no follow-up, and communication problems.
//
// Strategy:
//   1. DuckDuckGo HTML: search "[clinic] [city] reviews" AND pain keywords
//   2. Bing HTML: same query (fallback/supplement)
//   3. Clinic website: check embedded JSON-LD for review data
//
// Scoring:
//   CRITICAL  (reviewPainScore >= 3) — 3+ distinct pain keyword matches
//   HIGH      (reviewPainScore == 2) — 2 matches
//   MEDIUM    (reviewPainScore == 1) — 1 match
//
// Usage:
//   node src/intelligence/painSignalFinder.js [--limit 100] [--concurrency 5] [--force]

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import fetch from "node-fetch";
import dotenv from "dotenv";

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const DATA_DIR = path.join(ROOT, "data");

const OUTREACH_PATH = path.join(DATA_DIR, "outreach.localDentists.json");
const OUT_PATH      = path.join(DATA_DIR, "intelligence", "pain-signal-results.json");
const QUEUE_PATH    = path.join(DATA_DIR, "pain-signal-queue.json");
const DRAFTS_DIR    = path.join(DATA_DIR, "reply-drafts");

const args = process.argv.slice(2);
const LIMIT_IDX   = args.indexOf("--limit");
const LIMIT       = LIMIT_IDX !== -1 ? Number(args[LIMIT_IDX + 1]) : 9999;
const CONC_IDX    = args.indexOf("--concurrency");
const CONCURRENCY = CONC_IDX !== -1 ? Number(args[CONC_IDX + 1]) : 4;
const FORCE       = args.includes("--force");

// ── Pain keyword groups ────────────────────────────────────────────────────────
// Grouped so a single review about "couldn't reach" + "voicemail" = 2 groups hit
const PAIN_GROUPS = [
  {
    name: "unreachable",
    keywords: [
      "can't get through", "cannot get through", "couldn't reach", "hard to reach",
      "hard to contact", "difficult to contact", "difficult to reach",
      "receptionist never answers", "never answers", "nobody answers",
      "impossible to reach", "unreachable",
    ],
  },
  {
    name: "no_callback",
    keywords: [
      "no callback", "never called back", "didn't call back", "no call back",
      "never heard back", "no response", "left a message", "no return call",
      "waiting for a call",
    ],
  },
  {
    name: "voicemail",
    keywords: [
      "voicemail", "answering machine", "message machine", "goes to voicemail",
      "always voicemail", "stuck on voicemail",
    ],
  },
  {
    name: "no_reminder",
    keywords: [
      "no reminder", "didn't remind", "forgot my appointment", "missed my appointment",
      "no confirmation", "no appointment reminder", "never reminded",
    ],
  },
  {
    name: "poor_comms",
    keywords: [
      "poor communication", "bad communication", "communication issues",
      "lack of communication", "no follow-up", "no follow up", "never follow",
    ],
  },
];

const ALL_KEYWORDS = PAIN_GROUPS.flatMap(g => g.keywords);

// ── Scoring helpers ────────────────────────────────────────────────────────────
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
        // Extract a ~150-char quote around the keyword
        const idx = lower.indexOf(kw);
        const start = Math.max(0, idx - 60);
        const end   = Math.min(text.length, idx + kw.length + 90);
        const snippet = text.slice(start, end).replace(/\s+/g, " ").trim();
        if (snippet.length > 20 && !quotes.some(q => q.includes(kw))) {
          quotes.push(`"...${snippet}..."`);
        }
      }
    }
  }

  return { score: hitGroups.size, keywords: hitKeywords, groupsHit: [...hitGroups], quotes };
}

function tier(score) {
  if (score >= 3) return "CRITICAL";
  if (score === 2) return "HIGH";
  if (score === 1) return "MEDIUM";
  return "none";
}

// ── Fetch helpers ──────────────────────────────────────────────────────────────
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

const HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-CA,en;q=0.9",
};

async function fetchHtml(url, timeoutMs = 12_000) {
  try {
    const res = await fetch(url, {
      headers: HEADERS,
      signal: AbortSignal.timeout(timeoutMs),
      redirect: "follow",
    });
    if (!res.ok) return "";
    return await res.text();
  } catch {
    return "";
  }
}

function stripHtml(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Extract DuckDuckGo result snippets
function parseDdgSnippets(html) {
  const snippets = [];
  // result__snippet spans
  const re = /class="result__snippet"[^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const text = stripHtml(m[1]);
    if (text.length > 20) snippets.push(text);
  }
  // Also grab all text that contains pain keywords
  const plain = stripHtml(html);
  for (const kw of ALL_KEYWORDS) {
    if (plain.toLowerCase().includes(kw)) {
      const idx = plain.toLowerCase().indexOf(kw);
      const start = Math.max(0, idx - 80);
      const end   = Math.min(plain.length, idx + kw.length + 120);
      snippets.push(plain.slice(start, end).trim());
    }
  }
  return snippets;
}

// Extract Bing snippets
function parseBingSnippets(html) {
  const snippets = [];
  const re = /class="b_caption"[^>]*>[\s\S]*?<p[^>]*>([\s\S]*?)<\/p>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const text = stripHtml(m[1]);
    if (text.length > 20) snippets.push(text);
  }
  const plain = stripHtml(html);
  for (const kw of ALL_KEYWORDS) {
    if (plain.toLowerCase().includes(kw)) {
      const idx = plain.toLowerCase().indexOf(kw);
      const start = Math.max(0, idx - 80);
      const end   = Math.min(plain.length, idx + kw.length + 120);
      snippets.push(plain.slice(start, end).trim());
    }
  }
  return snippets;
}

// Extract JSON-LD reviews from a website
function extractJsonLdReviews(html) {
  const texts = [];
  const re = /<script[^>]+type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    try {
      const data = JSON.parse(m[1]);
      const items = Array.isArray(data) ? data : [data];
      for (const item of items) {
        const reviews = item.review || item.reviews || [];
        for (const r of (Array.isArray(reviews) ? reviews : [reviews])) {
          const body = r?.reviewBody || r?.description || "";
          if (body.length > 10) texts.push(body);
        }
        // Also check aggregateRating
        if (item.aggregateRating) {
          const count = item.aggregateRating.reviewCount || 0;
          if (count > 0) texts.push(`(${count} reviews, ${item.aggregateRating.ratingValue} stars)`);
        }
      }
    } catch {}
  }
  return texts;
}

// ── Per-clinic analysis ────────────────────────────────────────────────────────
async function analyzeClinic(clinic) {
  const name = clinic.clinicName || "";
  const city = clinic.city || "";
  const allText = [];
  let sources = [];

  // 1. DuckDuckGo — pain-keyword targeted query
  const ddgQuery = encodeURIComponent(`"${name}" ${city} reviews`);
  const ddgHtml  = await fetchHtml(`https://html.duckduckgo.com/html/?q=${ddgQuery}`);
  if (ddgHtml) {
    const snippets = parseDdgSnippets(ddgHtml);
    allText.push(...snippets);
    if (snippets.length) sources.push("ddg");
  }

  // 2. DuckDuckGo — second query targeting specific pain signals
  const ddgQuery2 = encodeURIComponent(`"${name}" "voicemail" OR "missed call" OR "no callback" OR "hard to reach"`);
  const ddgHtml2  = await fetchHtml(`https://html.duckduckgo.com/html/?q=${ddgQuery2}`);
  if (ddgHtml2) {
    const snippets2 = parseDdgSnippets(ddgHtml2);
    allText.push(...snippets2);
    if (snippets2.length) sources.push("ddg-pain");
  }

  await sleep(600);

  // 3. Clinic website — JSON-LD reviews
  if (clinic.website) {
    const siteHtml = await fetchHtml(clinic.website, 8_000);
    if (siteHtml) {
      const ldReviews = extractJsonLdReviews(siteHtml);
      allText.push(...ldReviews);
      if (ldReviews.length) sources.push("jsonld");
    }
  }

  // Combine and score
  const combined = allText.join(" ");
  const { score, keywords, groupsHit, quotes } = scoreText(combined);

  return {
    clinicName:    name,
    city,
    website:       clinic.website || "",
    email:         clinic.email   || "",
    reviewPainScore:   score,
    reviewPainTier:    tier(score),
    reviewPainKeywords: keywords,
    reviewPainGroups:  groupsHit,
    reviewPainQuotes:  quotes.slice(0, 3),
    sources,
    scrapedAt: new Date().toISOString(),
  };
}

// ── Concurrency pool ───────────────────────────────────────────────────────────
async function runPool(tasks, concurrency, onResult) {
  let next = 0;
  async function worker() {
    while (next < tasks.length) {
      const i = next++;
      const result = await tasks[i]();
      onResult(result, i);
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker));
}

// ── Email generator ────────────────────────────────────────────────────────────
function generatePainEmail(clinic, result) {
  const name   = clinic.clinicName || "your clinic";
  const quote  = result.reviewPainQuotes?.[0] || `a patient mentioned issues with communication`;
  const cleanQuote = quote.replace(/^"?\.\.\./, "").replace(/\.\.\."?$/, "").trim();

  return {
    subject: `Saw something in your Google reviews — ${name}`,
    body: `Hi,

I was looking at ${name}'s Google reviews before reaching out.
${cleanQuote}

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

  // Only analyse clinics with a name (skip phone-only records)
  const existing = readJsonSafe(OUT_PATH, { all: [] });
  const alreadyDone = new Set(
    (existing.all || []).map(r => r.clinicName?.toLowerCase())
  );

  const candidates = leads
    .filter(c => c.clinicName && (c.website || c.email))
    .filter(c => FORCE || !alreadyDone.has(c.clinicName?.toLowerCase()))
    .slice(0, LIMIT);

  console.log(`\nPain Signal Finder`);
  console.log(`Clinics to scan:   ${candidates.length}  (concurrency: ${CONCURRENCY})`);
  console.log(`Existing results:  ${alreadyDone.size}\n`);

  const results = [...(FORCE ? [] : (existing.all || []))];
  let critical = 0, high = 0, medium = 0, none = 0;

  const tasks = candidates.map((clinic, i) => async () => {
    return await analyzeClinic(clinic);
  });

  let processed = 0;
  await runPool(tasks, CONCURRENCY, (result, i) => {
    processed++;
    const t = result.reviewPainTier;
    if (t === "CRITICAL") { critical++; process.stdout.write(`\n  🔴 CRITICAL  ${result.clinicName} — ${result.reviewPainKeywords.join(", ")}`); }
    else if (t === "HIGH")   { high++;     process.stdout.write(`\n  🟠 HIGH      ${result.clinicName}`); }
    else if (t === "MEDIUM") { medium++;   process.stdout.write(`\n  🟡 MEDIUM    ${result.clinicName}`); }
    else                     { none++;     process.stdout.write("."); }
    results.push(result);

    // Write progress every 25 clinics
    if (processed % 25 === 0) {
      writeJson(OUT_PATH, buildOutput(results));
      process.stdout.write(`\n  [${processed}/${candidates.length}] saved progress\n`);
    }
  });

  // Final write
  const output = buildOutput(results);
  writeJson(OUT_PATH, output);

  // Update reviewPainScore / reviewPainQuotes in outreach records
  let updated = 0;
  const resultMap = new Map(results.map(r => [r.clinicName?.toLowerCase(), r]));
  for (let i = 0; i < leads.length; i++) {
    const key = leads[i].clinicName?.toLowerCase();
    const r = resultMap.get(key);
    if (r && r.reviewPainScore > 0) {
      leads[i].reviewPainScore  = r.reviewPainScore;
      leads[i].reviewPainQuotes = r.reviewPainQuotes;
      updated++;
    }
  }
  writeJson(OUTREACH_PATH, leads);

  // Build high-priority queue (CRITICAL + HIGH)
  const priorityQueue = results
    .filter(r => r.reviewPainTier === "CRITICAL" || r.reviewPainTier === "HIGH")
    .sort((a, b) => b.reviewPainScore - a.reviewPainScore)
    .map(r => {
      const lead = leads.find(l => l.clinicName?.toLowerCase() === r.clinicName?.toLowerCase());
      const email = generatePainEmail(lead || {}, r);
      return {
        clinicName:       r.clinicName,
        city:             r.city,
        email:            r.email || lead?.email || "",
        tier:             r.reviewPainTier,
        reviewPainScore:  r.reviewPainScore,
        reviewPainGroups: r.reviewPainGroups,
        reviewPainQuotes: r.reviewPainQuotes,
        subject:          email.subject,
        emailDraft:       email.body,
        addedAt:          new Date().toISOString(),
      };
    });
  writeJson(QUEUE_PATH, priorityQueue);

  // Save CRITICAL email drafts individually
  const criticalLeads = priorityQueue.filter(r => r.tier === "CRITICAL");
  fs.mkdirSync(DRAFTS_DIR, { recursive: true });
  for (const r of criticalLeads) {
    const slug = (r.clinicName || "clinic").toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 40);
    const draftPath = path.join(DRAFTS_DIR, `pain-signal-${slug}.json`);
    writeJson(draftPath, {
      generatedAt:     new Date().toISOString(),
      clinicName:      r.clinicName,
      email:           r.email,
      type:            "pain_signal",
      tier:            r.tier,
      reviewPainScore: r.reviewPainScore,
      reviewPainQuotes: r.reviewPainQuotes,
      subject:         r.subject,
      body:            r.emailDraft,
    });
  }

  console.log(`\n\n${"═".repeat(56)}`);
  console.log(`  Pain Signal Scan — ${processed} clinics scanned`);
  console.log(`${"═".repeat(56)}`);
  console.log(`  CRITICAL (3+): ${critical}`);
  console.log(`  HIGH (2):      ${high}`);
  console.log(`  MEDIUM (1):    ${medium}`);
  console.log(`  None:          ${none}`);
  console.log(`\n  Updated outreach records: ${updated}`);
  console.log(`  Priority queue:           ${priorityQueue.length} clinics`);
  console.log(`  Email drafts saved:       ${criticalLeads.length} CRITICAL`);
  console.log(`\n  Results → ${OUT_PATH}`);
  console.log(`  Queue   → ${QUEUE_PATH}`);

  // Print top 20 CRITICAL
  const top20 = priorityQueue.slice(0, 20);
  if (top20.length > 0) {
    console.log(`\n${"─".repeat(56)}`);
    console.log(`  TOP ${Math.min(20, top20.length)} PRIORITY CLINICS WITH REVIEW PAIN SIGNALS`);
    console.log(`${"─".repeat(56)}`);
    top20.forEach((r, i) => {
      console.log(`\n  ${i + 1}. [${r.tier}] ${r.clinicName}  (${r.city})`);
      console.log(`     Score: ${r.reviewPainScore}  |  Groups: ${r.reviewPainGroups.join(", ")}`);
      console.log(`     Email: ${r.email || "(no email)"}`);
      r.reviewPainQuotes?.forEach(q => console.log(`     Quote: ${q.slice(0, 120)}`));
    });
  } else {
    console.log(`\n  No CRITICAL/HIGH clinics found in this batch.`);
    console.log(`  This can happen if:`);
    console.log(`  - DuckDuckGo rate-limited requests (results came back empty)`);
    console.log(`  - Clinic names are too short/generic for precise matching`);
    console.log(`  - Reviews are behind JS walls (need Playwright for Google Maps)`);
  }
}

function buildOutput(results) {
  const withSignals = results.filter(r => r.reviewPainScore > 0);
  const byTier = { CRITICAL: 0, HIGH: 0, MEDIUM: 0 };
  for (const r of withSignals) {
    if (byTier[r.reviewPainTier] !== undefined) byTier[r.reviewPainTier]++;
  }

  const keywordTally = {};
  for (const r of withSignals) {
    for (const kw of r.reviewPainKeywords) {
      keywordTally[kw] = (keywordTally[kw] || 0) + 1;
    }
  }
  const topComplaints = Object.entries(keywordTally)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([kw, count]) => ({ keyword: kw, count }));

  return {
    generatedAt:            new Date().toISOString(),
    totalAnalysed:          results.length,
    clinicsWithPainSignals: withSignals.length,
    byTier,
    topComplaints,
    highPainClinics: withSignals
      .sort((a, b) => b.reviewPainScore - a.reviewPainScore)
      .slice(0, 20)
      .map(r => ({
        clinicName:       r.clinicName,
        city:             r.city,
        email:            r.email,
        tier:             r.reviewPainTier,
        reviewPainScore:  r.reviewPainScore,
        reviewPainGroups: r.reviewPainGroups,
        reviewPainQuotes: r.reviewPainQuotes,
      })),
    all: results,
  };
}

main().catch(e => {
  console.error("Pain signal finder failed:", e.message);
  process.exit(1);
});
