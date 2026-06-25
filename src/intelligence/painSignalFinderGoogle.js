// src/intelligence/painSignalFinderGoogle.js
// Pain Signal Finder — Google Search HTML edition.
//
// Google embeds review snippets and Knowledge Panel data inside <script> tags
// as JSON within the initial HTML response — no JavaScript rendering needed.
// We fetch the search results page and extract review text from those blobs.
//
// Usage:
//   node src/intelligence/painSignalFinderGoogle.js [--limit 50] [--concurrency 2]
//   node src/intelligence/painSignalFinderGoogle.js --force

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

const args         = process.argv.slice(2);
const LIMIT_IDX    = args.indexOf("--limit");
const LIMIT        = LIMIT_IDX !== -1 ? Number(args[LIMIT_IDX + 1]) : 9999;
const CONC_IDX     = args.indexOf("--concurrency");
const CONCURRENCY  = CONC_IDX !== -1 ? Number(args[CONC_IDX + 1]) : 2;
const FORCE        = args.includes("--force");

// Delay range between requests to avoid rate-limit (ms)
const DELAY_MIN = 1800;
const DELAY_MAX = 3200;

// ── Pain signal groups ─────────────────────────────────────────────────────────
const PAIN_GROUPS = [
  {
    name: "unreachable",
    keywords: [
      "can't get through", "cannot get through", "couldn't reach", "hard to reach",
      "hard to contact", "difficult to contact", "difficult to reach",
      "receptionist never answers", "never answers", "nobody answers",
      "impossible to reach", "unreachable", "no one picks up", "no answer",
    ],
  },
  {
    name: "no_callback",
    keywords: [
      "no callback", "never called back", "didn't call back", "no call back",
      "never heard back", "no response", "left a message", "no return call",
      "waiting for a call", "still waiting",
    ],
  },
  {
    name: "voicemail",
    keywords: [
      "voicemail", "answering machine", "message machine", "goes to voicemail",
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
      "receptionist is rude", "front desk never", "front desk doesn't",
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
        const start = Math.max(0, idx - 70);
        const end   = Math.min(text.length, idx + kw.length + 100);
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

// ── Google fetch ───────────────────────────────────────────────────────────────
// Rotate User-Agents to reduce blocking
const USER_AGENTS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:125.0) Gecko/20100101 Firefox/125.0",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_4_1) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4.1 Safari/605.1.15",
];
let uaIdx = 0;
function nextUA() { return USER_AGENTS[uaIdx++ % USER_AGENTS.length]; }

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function rand(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }

async function googleSearch(query, timeoutMs = 15_000) {
  const q = encodeURIComponent(query);
  const url = `https://www.google.com/search?q=${q}&hl=en&gl=ca&num=10`;
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": nextUA(),
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-CA,en;q=0.9",
        "Accept-Encoding": "identity",
        "Cache-Control": "no-cache",
        "Pragma": "no-cache",
      },
      signal: AbortSignal.timeout(timeoutMs),
      redirect: "follow",
    });
    if (!res.ok) return "";
    return await res.text();
  } catch {
    return "";
  }
}

// Strip HTML to plain readable text — crucially removes href/src URLs first
// so that query keywords echoed in URL parameters don't trigger false positives.
function htmlToPlainText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    // Strip URL-bearing attributes before removing tags
    .replace(/\s(?:href|src|action|data-url|data-src)="[^"]*"/gi, "")
    .replace(/\s(?:href|src|action|data-url|data-src)='[^']*'/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ").trim();
}

// Extract all human-readable text fragments from Google HTML.
// Uses plain-text extraction to avoid false positives from URL echo.
function extractTextFragments(html) {
  const fragments = [];

  // 1. Primary: strip HTML to plain text and use whole block
  const plain = htmlToPlainText(html);
  fragments.push(plain);

  // 2. JSON string values embedded in <script> data blobs (review text)
  const jsonStrRe = /"([^"\\]{40,400})"/g;
  let m;
  while ((m = jsonStrRe.exec(html)) !== null) {
    const s = m[1]
      .replace(/\\n/g, " ").replace(/\\t/g, " ")
      .replace(/\\u[\dA-Fa-f]{4}/g, " ").trim();
    // Must look like a sentence (has spaces, not a URL, not a CSS class)
    if (s.includes(" ") && !/^https?:|^\/\/|^[A-Z0-9_]+$|^[a-z0-9-]+$/.test(s)) {
      fragments.push(s);
    }
  }

  // 3. Review-specific JSON keys Google uses in Knowledge Panel data
  for (const key of ["reviewText", "snippet", "description", "text", "reviewBody"]) {
    const re = new RegExp(`"${key}"\\s*:\\s*"([^"\\\\]{20,}?)"`, "g");
    while ((m = re.exec(html)) !== null) {
      const s = m[1].replace(/\\n/g, " ").replace(/\\t/g, " ").trim();
      if (s.includes(" ")) fragments.push(s);
    }
  }

  return [...new Set(fragments)];
}

// ── Per-clinic search ──────────────────────────────────────────────────────────
async function analyzeClinic(clinic) {
  const name = (clinic.clinicName || "").trim();
  const city = (clinic.city || "").trim();
  const allFragments = [];

  // Query 1: general reviews search
  const q1 = `"${name}" ${city} dental reviews`;
  const html1 = await googleSearch(q1);
  if (html1) allFragments.push(...extractTextFragments(html1));

  await sleep(rand(DELAY_MIN, DELAY_MAX));

  // Query 2: pain-specific search — finds if anyone wrote about comms issues
  const q2 = `"${name}" "voicemail" OR "missed call" OR "no callback" OR "hard to reach" reviews`;
  const html2 = await googleSearch(q2);
  if (html2) allFragments.push(...extractTextFragments(html2));

  const combined = allFragments.join(" ");
  const { score, keywords, groups, quotes } = scoreText(combined);

  // Also detect recent reviews (last 30 days) via date markers in snippets
  const recentMarkers = ["day ago", "days ago", "week ago", "hours ago", "just now", "yesterday"];
  const hasRecent = allFragments.some(f => recentMarkers.some(m => f.toLowerCase().includes(m)));

  return {
    clinicName:         name,
    city,
    website:            clinic.website || "",
    email:              clinic.email   || "",
    reviewPainScore:    score,
    reviewPainTier:     tier(score),
    reviewPainKeywords: keywords,
    reviewPainGroups:   groups,
    reviewPainQuotes:   quotes.slice(0, 3),
    hasRecentReview:    hasRecent,
    scrapedAt:          new Date().toISOString(),
    source:             "google-html",
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

function generatePainEmail(clinic, result) {
  const name = clinic.clinicName || "your clinic";
  const rawQuote = result.reviewPainQuotes?.[0] || "";
  const cleanQuote = rawQuote
    .replace(/^"?\.\.\./, "").replace(/\.\.\."?$/, "").trim()
    .slice(0, 200);
  const quoteBlock = cleanQuote.length > 20
    ? `One patient wrote: "${cleanQuote}"`
    : `Patients mentioned issues with missed calls and follow-up at ${name}`;

  return {
    subject: `Saw something in your Google reviews — ${name}`,
    body: `Hi,

I was looking at ${name}'s Google reviews before reaching out.
${quoteBlock}

That's exactly what I fix for dental clinics. Automated follow-up so no call goes unanswered — patients get a text within 60 seconds.

Free audit, 10 minutes, no commitment.

Worth a look?

Mohamed
ClinicFlow Automation
438-544-0442`,
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

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  const leads = readJsonSafe(OUTREACH_PATH, []);

  const existing = readJsonSafe(OUT_PATH, { all: [] });
  const alreadyDoneGoogle = new Set(
    (existing.all || [])
      .filter(r => r.source === "google-html")
      .map(r => r.clinicName?.toLowerCase())
  );

  const candidates = leads
    .filter(c => c.clinicName && (c.website || c.email))
    .filter(c => FORCE || !alreadyDoneGoogle.has(c.clinicName?.toLowerCase()))
    .slice(0, LIMIT);

  console.log(`\nPain Signal Finder (Google HTML)`);
  console.log(`Clinics to scan:   ${candidates.length}  (concurrency: ${CONCURRENCY})`);
  console.log(`Already scanned:   ${alreadyDoneGoogle.size}`);
  console.log(`Delay: ${DELAY_MIN}–${DELAY_MAX}ms between requests per worker\n`);

  const results = [];
  let critical = 0, high = 0, medium = 0, none = 0;
  let processed = 0;

  const tasks = candidates.map(clinic => async () => analyzeClinic(clinic));

  await runPool(tasks, CONCURRENCY, (result) => {
    processed++;
    const t = result.reviewPainTier;
    if (t === "CRITICAL") { critical++; console.log(`\n  🔴 CRITICAL  [${processed}] ${result.clinicName}  (${result.city})`); result.reviewPainQuotes?.forEach(q => console.log(`     ${q.slice(0,120)}`)); }
    else if (t === "HIGH")   { high++;     console.log(`\n  🟠 HIGH      [${processed}] ${result.clinicName}  (${result.city})`); }
    else if (t === "MEDIUM") { medium++;   console.log(`\n  🟡 MEDIUM    [${processed}] ${result.clinicName}  (${result.city})`); }
    else                     { none++;     process.stdout.write(processed % 50 === 0 ? `\n  [${processed}/${candidates.length}] ` : "."); }
    results.push(result);

    if (processed % 20 === 0) {
      const partial = buildOutput(results);
      writeJson(OUT_PATH, partial);
    }
  });

  // Final output
  const output = buildOutput(results);
  writeJson(OUT_PATH, output);

  // Update outreach records
  const resultMap = new Map(results.map(r => [r.clinicName?.toLowerCase(), r]));
  let updated = 0;
  for (let i = 0; i < leads.length; i++) {
    const r = resultMap.get(leads[i].clinicName?.toLowerCase());
    if (r && r.reviewPainScore > 0) {
      leads[i].reviewPainScore  = r.reviewPainScore;
      leads[i].reviewPainQuotes = r.reviewPainQuotes;
      updated++;
    }
  }
  writeJson(OUTREACH_PATH, leads);

  // Build priority queue
  const priorityQueue = results
    .filter(r => r.reviewPainTier === "CRITICAL" || r.reviewPainTier === "HIGH")
    .sort((a, b) => b.reviewPainScore - a.reviewPainScore)
    .map(r => {
      const lead = leads.find(l => l.clinicName?.toLowerCase() === r.clinicName?.toLowerCase());
      const email = generatePainEmail(lead || {}, r);
      return {
        clinicName: r.clinicName, city: r.city,
        email: r.email || lead?.email || "",
        tier: r.reviewPainTier, reviewPainScore: r.reviewPainScore,
        reviewPainGroups: r.reviewPainGroups, reviewPainQuotes: r.reviewPainQuotes,
        hasRecentReview: r.hasRecentReview,
        subject: email.subject, emailDraft: email.body,
        addedAt: new Date().toISOString(),
      };
    });
  writeJson(QUEUE_PATH, priorityQueue);

  // Save individual drafts for CRITICAL
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

  console.log(`\n\n${"═".repeat(58)}`);
  console.log(`  Pain Signal Scan Complete — ${processed} clinics`);
  console.log(`${"═".repeat(58)}`);
  console.log(`  CRITICAL (3+): ${critical}`);
  console.log(`  HIGH (2):      ${high}`);
  console.log(`  MEDIUM (1):    ${medium}`);
  console.log(`  None:          ${none}`);
  console.log(`  Outreach records updated: ${updated}`);
  console.log(`  Priority queue: ${priorityQueue.length}`);

  const top20 = priorityQueue.slice(0, 20);
  if (top20.length > 0) {
    console.log(`\n${"─".repeat(58)}`);
    console.log(`  TOP ${top20.length} — CLINICS WITH COMMUNICATION PAIN SIGNALS`);
    console.log(`${"─".repeat(58)}`);
    top20.forEach((r, i) => {
      const recent = r.hasRecentReview ? " ⚡NEW" : "";
      console.log(`\n  ${i + 1}. [${r.tier}]${recent} ${r.clinicName}  (${r.city})`);
      console.log(`     Score ${r.reviewPainScore} | Groups: ${r.reviewPainGroups.join(", ")}`);
      console.log(`     Email: ${r.email || "(no email)"}`);
      r.reviewPainQuotes?.forEach(q => console.log(`     → ${q.slice(0, 130)}`));
    });
  }
}

function buildOutput(results) {
  const withSignals = results.filter(r => r.reviewPainScore > 0);
  const byTier = { CRITICAL: 0, HIGH: 0, MEDIUM: 0 };
  for (const r of withSignals) if (byTier[r.reviewPainTier] !== undefined) byTier[r.reviewPainTier]++;
  const kwTally = {};
  for (const r of withSignals) for (const kw of r.reviewPainKeywords) kwTally[kw] = (kwTally[kw] || 0) + 1;
  return {
    generatedAt: new Date().toISOString(), totalAnalysed: results.length,
    clinicsWithPainSignals: withSignals.length, byTier,
    topComplaints: Object.entries(kwTally).sort((a,b)=>b[1]-a[1]).slice(0,10).map(([kw,count])=>({kw,count})),
    highPainClinics: withSignals.sort((a,b)=>b.reviewPainScore-a.reviewPainScore).slice(0,20).map(r=>({
      clinicName: r.clinicName, city: r.city, email: r.email, tier: r.reviewPainTier,
      reviewPainScore: r.reviewPainScore, reviewPainGroups: r.reviewPainGroups, reviewPainQuotes: r.reviewPainQuotes,
      hasRecentReview: r.hasRecentReview,
    })),
    all: results,
  };
}

main().catch(e => { console.error("Failed:", e.message); process.exit(1); });
