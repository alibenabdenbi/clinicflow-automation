// src/intelligence/reviewsScraper.js
// Fetches Google Reviews via Places API and extracts communication pain signals.
// Falls back to DuckDuckGo HTML scraping if no API key.
// Run: node src/intelligence/reviewsScraper.js [--limit 50]

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import fetch from "node-fetch";
import dotenv from "dotenv";

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT      = path.resolve(__dirname, "../..");

const MARKET_ARG = (() => {
  const i = process.argv.indexOf("--market");
  return i !== -1 ? process.argv[i + 1] : "dental";
})();

const QUEUE_PATHS = {
  dental: path.join(ROOT, "data", "outreach.localDentists.json"),
  physio: path.join(ROOT, "data", "outreach.physioClinics.json"),
};
const OUTREACH_PATH = QUEUE_PATHS[MARKET_ARG] || QUEUE_PATHS.dental;
const OUT_PATH = path.join(ROOT, "data", "intelligence", `reviews-analysis${MARKET_ARG !== "dental" ? "-" + MARKET_ARG : ""}.json`);

const GOOGLE_KEY = (process.env.GOOGLE_PLACES_API_KEY || "").trim();
const USE_GOOGLE = GOOGLE_KEY && GOOGLE_KEY !== "your_key_here";

// Communication pain keywords — specific phrases only, not broad trigger words.
// "call" and "phone" were removed — too broad, match positive reviews.
const PAIN_KEYWORDS = [
  // Missed call / unreachable
  "couldn't reach", "can't reach", "could not reach", "cannot reach",
  "no one answered", "nobody answered", "never called back", "didn't call back",
  "no callback", "no call back", "couldn't get through", "can't get through",
  "hard to reach", "difficult to reach", "hard to contact", "unreachable",
  "unanswered", "went to voicemail", "left a voicemail", "busy signal",
  // Response / follow-up failures
  "no response", "never responded", "never heard back", "didn't follow up",
  "no follow up", "dropped off", "never contacted",
  // Reminder / appointment failures
  "no reminder", "no appointment reminder", "forgot my appointment",
  "no confirmation", "missed my appointment", "no show", "forgot appointment",
  "rescheduled without", "cancelled without",
  // Other pain phrases
  "poor communication", "missed call", "never heard back",
  // Physio-specific
  "hard to book", "rebook",
];

// Positive sentiment words — if a sentence contains any of these near a pain keyword,
// it is likely a positive review, not a complaint. Skip it.
const POSITIVE_SENTIMENT = [
  "great", "excellent", "amazing", "wonderful", "fantastic",
  "accommodated", "helpful", "friendly", "recommend", "outstanding",
  "superb", "perfect", "love", "loved", "happy", "pleased",
  "impressed", "professional", "kind", "caring", "warm",
  "best", "top", "awesome", "brilliant", "terrific",
];

const LIMIT_ARG = (() => {
  const i = process.argv.indexOf("--limit");
  return i !== -1 ? Number(process.argv[i + 1]) : 100;
})();

function readJsonSafe(p, fb) {
  try { return JSON.parse(fs.readFileSync(p, "utf-8")); } catch { return fb; }
}
function writeJson(p, data) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(data, null, 2), "utf-8");
}
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ─── Google Places API ────────────────────────────────────────────────────────

async function findPlaceId(clinicName, city) {
  const query = encodeURIComponent(`${clinicName} ${city || ""} dental`);
  const url = `https://maps.googleapis.com/maps/api/place/findplacefromtext/json?input=${query}&inputtype=textquery&fields=place_id,name,rating,user_ratings_total&key=${GOOGLE_KEY}`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8_000) });
    const json = await res.json();
    if (json.status === "OK" && json.candidates?.[0]?.place_id) {
      return json.candidates[0];
    }
  } catch {}
  return null;
}

async function fetchPlaceReviews(placeId) {
  const url = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${placeId}&fields=reviews,rating,user_ratings_total&key=${GOOGLE_KEY}`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8_000) });
    const json = await res.json();
    if (json.status === "OK") return json.result;
  } catch {}
  return null;
}

/**
 * Returns true if a sentence reads as a positive experience rather than a complaint.
 * Used to suppress false positives where a pain keyword appears in a positive context.
 */
function isPositiveSentence(sentence) {
  const lower = sentence.toLowerCase();
  return POSITIVE_SENTIMENT.some(word => lower.includes(word));
}

/**
 * Extracts the specific sentence containing a pain keyword from a review.
 * Returns null if no qualifying sentence found, or if the sentence is positive.
 */
function extractPainSentence(reviewText, keywords) {
  const sentences = reviewText.match(/[^.!?]+[.!?]+/g) || [reviewText];
  for (const sentence of sentences) {
    const lower = sentence.toLowerCase();
    if (!keywords.some(kw => lower.includes(kw))) continue;
    const clean = sentence.trim();
    // Quality filters: must be meaningful, not a rating opener
    if (clean.length < 20) continue;
    if (/^I (give|gave|rate|rated|would give|would rate)\s+[1-5]/i.test(clean)) continue;
    if (/^\d\s*(star|\/5|out of)/i.test(clean)) continue;
    // Sentiment check: skip sentences that are clearly positive in tone
    if (isPositiveSentence(clean)) continue;
    return clean.length > 120 ? clean.slice(0, 117) + "..." : clean;
  }
  return null;
}

function scoreReviews(reviews) {
  if (!reviews || reviews.length === 0) return { score: 0, keywords: [], quotes: [] };
  const keywords = new Set();
  const quotes = [];

  for (const review of reviews) {
    const text = (review.text || "");
    const lower = text.toLowerCase();
    const found = PAIN_KEYWORDS.filter(kw => lower.includes(kw));
    if (found.length > 0) {
      // Extract the specific pain sentence and check sentiment before counting
      const sentence = extractPainSentence(text, [...found]);
      if (!sentence) continue; // filtered out (positive context or quality check)
      found.forEach(kw => keywords.add(kw));
      quotes.push(sentence);
    }
  }

  return {
    score: Math.min(5, keywords.size),
    keywords: [...keywords],
    quotes: quotes.slice(0, 2),
  };
}

async function getReviewsViaGoogle(clinicName, city) {
  const place = await findPlaceId(clinicName, city);
  if (!place) return { score: 0, keywords: [], quotes: [], source: "google_not_found" };

  const details = await fetchPlaceReviews(place.place_id);
  if (!details) return { score: 0, keywords: [], quotes: [], source: "google_no_details" };

  const { score, keywords, quotes } = scoreReviews(details.reviews || []);
  return {
    score,
    keywords,
    quotes,
    rating: details.rating || null,
    reviewCount: details.user_ratings_total || 0,
    source: "google_places",
  };
}

// ─── DDG fallback ─────────────────────────────────────────────────────────────

async function getReviewsViaDDG(clinicName, city) {
  const query = encodeURIComponent(`"${clinicName}" ${city} reviews`);
  const url   = `https://html.duckduckgo.com/html/?q=${query}`;
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return { score: 0, keywords: [], quotes: [], source: "ddg_failed" };
    const html  = await res.text();
    const lower = html.toLowerCase();
    const found = PAIN_KEYWORDS.filter(kw => lower.includes(kw));
    return { score: Math.min(5, found.length), keywords: found, quotes: [], source: "ddg" };
  } catch {
    return { score: 0, keywords: [], quotes: [], source: "ddg_error" };
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function run() {
  const clinics = readJsonSafe(OUTREACH_PATH, []);
  const candidates = clinics.filter(c => c.clinicName).slice(0, LIMIT_ARG);

  console.log(`Reviews scraper — ${candidates.length} clinics`);
  console.log(`Source: ${USE_GOOGLE ? "Google Places API" : "DuckDuckGo (no API key)"}`);
  if (!USE_GOOGLE) {
    console.log(`  → To enable Google Places: set GOOGLE_PLACES_API_KEY in .env`);
    console.log(`  → Get free key: console.cloud.google.com → Enable Places API`);
  }

  const results = [];
  const keywordTally = {};
  let withPain = 0;

  for (let i = 0; i < candidates.length; i++) {
    const c = candidates[i];
    process.stdout.write(`  [${i + 1}/${candidates.length}] ${(c.clinicName || "").slice(0, 45).padEnd(45)}`);

    const data = USE_GOOGLE
      ? await getReviewsViaGoogle(c.clinicName, c.city || "")
      : await getReviewsViaDDG(c.clinicName, c.city || "");

    results.push({
      clinicName:         c.clinicName,
      city:               c.city || "",
      website:            c.website || "",
      reviewPainScore:    data.score,
      reviewPainKeywords: data.keywords,
      reviewPainQuotes:   data.quotes,
      reviewPainSource:   data.source,
      googleRating:       data.rating || null,
      googleReviewCount:  data.reviewCount || 0,
      scrapedAt:          new Date().toISOString(),
    });

    if (data.score > 0) {
      withPain++;
      data.keywords.forEach(kw => { keywordTally[kw] = (keywordTally[kw] || 0) + 1; });
    }

    const tag = data.source === "google_places" ? `⭐${data.rating || "?"} (${data.reviewCount || 0} reviews)` : "";
    console.log(` score=${data.score} [${data.source}] ${tag} keywords=[${data.keywords.slice(0,3).join(", ")}]`);

    // Write pain signals back to outreach record
    if (data.score > 0 && c.clinicName) {
      const idx = clinics.findIndex(r => r.clinicName === c.clinicName);
      if (idx !== -1) {
        clinics[idx].reviewPainScore  = data.score;
        clinics[idx].reviewPainQuotes = data.quotes;
        clinics[idx].reviewPainSource = data.source;
      }
    }

    if (i < candidates.length - 1) await sleep(USE_GOOGLE ? 300 : 2_500);
  }

  // Save pain signals back to outreach queue
  if (withPain > 0) {
    fs.writeFileSync(OUTREACH_PATH, JSON.stringify(clinics, null, 2), "utf-8");
    console.log(`\n✓ Pain signals written back to outreach queue (${withPain} clinics)`);
  }

  const topComplaints = Object.entries(keywordTally)
    .sort((a, b) => b[1] - a[1]).slice(0, 10)
    .map(([kw, count]) => ({ keyword: kw, count }));

  const highPain = results
    .filter(r => r.reviewPainScore > 0)
    .sort((a, b) => b.reviewPainScore - a.reviewPainScore)
    .slice(0, 10);

  const output = {
    generatedAt:            new Date().toISOString(),
    source:                 USE_GOOGLE ? "google_places" : "ddg",
    totalAnalysed:          results.length,
    clinicsWithPainSignals: withPain,
    topComplaints,
    highPainClinics: highPain.map(r => ({
      clinicName:   r.clinicName,
      city:         r.city,
      painScore:    r.reviewPainScore,
      keywords:     r.reviewPainKeywords,
      quotes:       r.reviewPainQuotes,
      googleRating: r.googleRating,
    })),
    all: results,
  };

  writeJson(OUT_PATH, output);
  console.log(`\n── Top communication complaints ──`);
  if (topComplaints.length === 0) {
    console.log("  None found — " + (USE_GOOGLE ? "reviews may not mention these keywords" : "DDG not returning review text"));
  } else {
    topComplaints.forEach((t, i) => console.log(`  ${i + 1}. "${t.keyword}" — ${t.count} clinics`));
  }
  console.log(`\nSaved → ${OUT_PATH}`);
}

run().catch(e => { console.error("Reviews scraper failed:", e.message); process.exit(1); });
