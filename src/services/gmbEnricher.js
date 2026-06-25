// src/services/gmbEnricher.js
// Google My Business enrichment: Places API lookup, Instagram scraping, Claude personalDetail.
// Exports: enrichWithGMB(clinic), enrichBatch(clinics, limit), findInstagram(website)
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import * as cheerio from "cheerio";
import dotenv from "dotenv";

dotenv.config();

// Windows TLS workaround (consistent with mailer.js tls: { rejectUnauthorized: false })
if (process.platform === "win32") process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

const __dirname     = path.dirname(fileURLToPath(import.meta.url));
const ROOT          = path.resolve(__dirname, "../..");
const DATA_DIR      = path.join(ROOT, "data");
const OUTREACH_PATH = path.join(DATA_DIR, "outreach.localDentists.json");

const GOOGLE_KEY    = (process.env.GOOGLE_PLACES_API_KEY || "").trim();
const ANTHROPIC_KEY = (process.env.ANTHROPIC_API_KEY || "").trim();

const PAIN_KEYWORDS = [
  "couldn't reach", "can't reach", "could not reach", "cannot reach",
  "no one answered", "nobody answered", "never called back", "didn't call back",
  "no callback", "no call back", "couldn't get through", "can't get through",
  "hard to reach", "difficult to reach", "hard to contact", "unreachable",
  "unanswered", "went to voicemail", "left a voicemail", "busy signal",
  "no response", "never responded", "never heard back", "didn't follow up",
  "no follow up", "dropped off", "never contacted",
  "no reminder", "no appointment reminder", "forgot my appointment",
  "no confirmation", "missed my appointment", "no show",
  "poor communication", "missed call",
];

function readJsonSafe(p, fb) {
  try { return JSON.parse(fs.readFileSync(p, "utf-8")); } catch { return fb; }
}
function writeJson(p, data) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(data, null, 2), "utf-8");
}
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ─── Google Places API ────────────────────────────────────────────────────────

async function findPlace(clinicName, city) {
  const q   = encodeURIComponent(`${clinicName} dental ${city || ""} Canada`);
  const url = `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${q}&type=dentist&key=${GOOGLE_KEY}`;
  try {
    const res  = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    const json = await res.json();
    if (json.status === "OK" && json.results?.length) return json.results[0];
  } catch {}
  return null;
}

async function getPlaceDetails(placeId) {
  const fields = "name,formatted_phone_number,website,opening_hours,reviews,rating,user_ratings_total,url,business_status";
  const url    = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${placeId}&fields=${fields}&key=${GOOGLE_KEY}`;
  try {
    const res  = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    const json = await res.json();
    if (json.status === "OK") return json.result;
  } catch {}
  return null;
}

function extractPainSignals(reviews) {
  if (!Array.isArray(reviews)) return { painSignals: [], painScore: 0 };
  const found = new Set();
  for (const review of reviews) {
    const text = (review.text || "").toLowerCase();
    PAIN_KEYWORDS.forEach(kw => { if (text.includes(kw)) found.add(kw); });
  }
  return { painSignals: [...found], painScore: Math.min(5, found.size) };
}

// ─── Instagram / social finder ────────────────────────────────────────────────

export async function findInstagram(website) {
  if (!website) return null;
  try {
    const res = await fetch(website, {
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" },
      signal:  AbortSignal.timeout(10_000),
      redirect: "follow",
    });
    if (!res.ok) return null;
    const html = await res.text();
    const $    = cheerio.load(html);

    // Priority 1: explicit <a href="...instagram.com/handle">
    let handle = null;
    $('a[href*="instagram.com"]').each((_, el) => {
      if (handle) return;
      const href = $(el).attr("href") || "";
      const m    = href.match(/instagram\.com\/([a-zA-Z0-9_.]{2,30})\/?/);
      if (m && !["p", "reel", "explore", "stories", "accounts"].includes(m[1])) {
        handle = `@${m[1]}`;
      }
    });
    if (handle) return handle;

    // Priority 2: any text/attribute containing instagram.com
    const raw = html.match(/instagram\.com\/([a-zA-Z0-9_.]{2,30})[/"'?]/);
    if (raw && !["p", "reel", "explore", "stories", "accounts"].includes(raw[1])) {
      return `@${raw[1]}`;
    }
    return null;
  } catch { return null; }
}

// ─── Claude personalDetail ────────────────────────────────────────────────────

async function generatePersonalDetail(clinicName, city, rating, reviewCount, painSignals, reviewSnippet) {
  // Rule-based fallback — always reliable, no API cost
  const ruleBased = (() => {
    if (painSignals.length) return `patient mentioned "${painSignals[0]}"`;
    if (rating >= 4.8 && reviewCount > 100) return `${rating} stars with ${reviewCount}+ reviews`;
    if (rating >= 4.5 && reviewCount > 50)  return `highly rated with ${reviewCount} Google reviews`;
    if (reviewCount > 200) return `${reviewCount}+ Google reviews`;
    return `${rating || "?"} stars on Google`;
  })();

  if (!ANTHROPIC_KEY) return ruleBased;

  const prompt = `Write ONE short phrase (under 70 chars) that personalizes a B2B outreach message to this dental clinic.
Use the most compelling detail available. Good examples: "patient mentioned no callback in a 2-star review", "4.9 stars with 300+ reviews", "offers pediatric dentistry".

Clinic: ${clinicName}, ${city}
Rating: ${rating} (${reviewCount} reviews)
Pain signals: ${painSignals.slice(0, 2).join(", ") || "none"}
Review snippet: "${(reviewSnippet || "").slice(0, 100)}"

Reply with ONLY the phrase. No quotes. No explanation.`;

  try {
    const { default: Anthropic } = await import("@anthropic-ai/sdk");
    const client = new Anthropic({ apiKey: ANTHROPIC_KEY });
    const msg    = await client.messages.create({
      model:      "claude-haiku-4-5-20251001",
      max_tokens: 80,
      messages:   [{ role: "user", content: prompt }],
    });
    return msg.content[0]?.text?.trim() || ruleBased;
  } catch { return ruleBased; }
}

// ─── Public API ───────────────────────────────────────────────────────────────

export async function enrichWithGMB(clinic) {
  if (!GOOGLE_KEY) throw new Error("GOOGLE_PLACES_API_KEY not set in .env");

  const city  = (clinic.city || "").split(",")[0].trim();
  const place = await findPlace(clinic.clinicName, city);
  if (!place) return null;

  const details = await getPlaceDetails(place.place_id);
  const { painSignals, painScore } = extractPainSignals(details?.reviews);

  const instagramHandle = await findInstagram(details?.website || clinic.website);

  const recentReviews = (details?.reviews || []).slice(0, 3).map(r => ({
    rating: r.rating,
    text:   (r.text || "").slice(0, 150),
    time:   r.relative_time_description,
  }));

  const rating       = details?.rating       || place.rating             || null;
  const reviewCount  = details?.user_ratings_total || place.user_ratings_total || 0;
  const reviewSnippet = details?.reviews?.[0]?.text || "";

  const personalDetail = await generatePersonalDetail(
    clinic.clinicName, city, rating, reviewCount, painSignals, reviewSnippet
  );

  return {
    placeId:       place.place_id,
    googleMapsUrl: details?.url || `https://www.google.com/maps/place/?q=place_id:${place.place_id}`,
    rating,
    reviewCount,
    // NOTE: Places API does not expose GMB messaging status.
    // hasMessaging=true means business_status=OPERATIONAL — a superset of messaging-enabled businesses.
    hasMessaging:  details?.business_status === "OPERATIONAL",
    googlePhone:   details?.formatted_phone_number || null,
    website:       details?.website || clinic.website || null,
    isOpen:        details?.opening_hours?.open_now ?? null,
    openingHours:  (details?.opening_hours?.weekday_text || []).join("; ") || null,
    recentReviews,
    painSignals,
    painScore,
    instagramHandle,
    personalDetail,
    gmbEnrichedAt: new Date().toISOString(),
  };
}

export async function enrichBatch(clinics, limit = 50) {
  const all     = readJsonSafe(OUTREACH_PATH, []);
  const targets = clinics.filter(c => !c.placeId).slice(0, limit);

  console.log(`GMB Enricher — ${targets.length} clinics (skipping already-enriched)`);
  let enriched = 0, notFound = 0, errors = 0;

  for (let i = 0; i < targets.length; i++) {
    const clinic = targets[i];
    process.stdout.write(`  [${i + 1}/${targets.length}] ${(clinic.clinicName || "").slice(0, 44).padEnd(44)} `);

    try {
      const data = await enrichWithGMB(clinic);
      if (!data) {
        process.stdout.write("not found\n");
        notFound++;
      } else {
        const idx = all.findIndex(c => c.id === clinic.id || c.clinicName === clinic.clinicName);
        if (idx !== -1) Object.assign(all[idx], data);
        enriched++;
        const ig = data.instagramHandle ? ` ig:${data.instagramHandle}` : "";
        process.stdout.write(`⭐${data.rating} (${data.reviewCount} reviews) pain=${data.painScore}${ig}\n`);
      }
    } catch (e) {
      process.stdout.write(`error: ${e.message.slice(0, 55)}\n`);
      errors++;
    }

    if (i < targets.length - 1) await sleep(350);
  }

  writeJson(OUTREACH_PATH, all);
  console.log(`\nDone: enriched=${enriched} notFound=${notFound} errors=${errors}`);
  console.log(`Saved → ${OUTREACH_PATH}`);
  return { enriched, notFound, errors };
}
