// src/cli/googleBusinessOutreach.js
// Searches Google Places for each clinic's Business Profile.
// Extracts: owner name from review responses, messaging status.
// Adds qualifying clinics to data/google-messages-queue.json.
//
// Requires: GOOGLE_PLACES_API_KEY in .env
//
// Usage:
//   node src/cli/googleBusinessOutreach.js --limit 50
//   node src/cli/googleBusinessOutreach.js --limit 50 --dry-run

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const DATA_DIR = path.join(ROOT, "data");
const OUTREACH_PATH = path.join(DATA_DIR, "outreach.localDentists.json");
const QUEUE_PATH    = path.join(DATA_DIR, "google-messages-queue.json");
const LOG_PATH      = path.join(DATA_DIR, "intelligence", "google-business-log.json");

const PLACES_KEY = (process.env.GOOGLE_PLACES_API_KEY || "").trim();

const args    = process.argv.slice(2);
const DRY_RUN = args.includes("--dry-run");
const limitIdx = args.indexOf("--limit");
const LIMIT   = limitIdx !== -1 ? Number(args[limitIdx + 1]) : 50;

const PAIN_KEYWORDS = [
  "phone", "missed call", "didn't answer", "no one answered", "couldn't reach",
  "left voicemail", "never called back", "hard to reach", "no response",
  "unanswered", "receptionist", "busy signal", "hold", "wait time",
];

function readJsonSafe(p, fb) {
  try { if (!fs.existsSync(p)) return fb; return JSON.parse(fs.readFileSync(p, "utf-8")); }
  catch { return fb; }
}

function writeJsonSafe(p, data) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(data, null, 2), "utf-8");
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ── Google Places Text Search ─────────────────────────────────────────────────
async function findPlace(clinicName, city) {
  const query = encodeURIComponent(`${clinicName} dental ${city} Canada`);
  const url = `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${query}&type=dentist&key=${PLACES_KEY}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
  if (!res.ok) throw new Error(`Places API ${res.status}`);
  const json = await res.json();
  if (json.status !== "OK" || !json.results?.length) return null;
  return json.results[0]; // best match
}

// ── Place details (reviews + owner responses) ─────────────────────────────────
async function getPlaceDetails(placeId) {
  const fields = "name,reviews,user_ratings_total,rating,url,business_status";
  const url = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${placeId}&fields=${fields}&key=${PLACES_KEY}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
  if (!res.ok) throw new Error(`Place Details API ${res.status}`);
  const json = await res.json();
  return json.result || null;
}

// ── Extract owner name from review responses ──────────────────────────────────
function extractOwnerName(reviews) {
  if (!Array.isArray(reviews)) return null;
  for (const review of reviews) {
    if (!review.owner_answer) continue;
    // Look for "Thanks, [Name]" or "— [Name]" or "Regards, [Name]" patterns
    const sig = review.owner_answer.match(
      /(?:regards|sincerely|thanks|thank you|cheers|—|-)\s*[,]?\s*([A-Z][a-z]{2,15}(?:\s[A-Z][a-z]{2,15})?)/i
    );
    if (sig?.[1]) return sig[1].trim();
    // Fallback: "Hi, I'm [Name]" or "I'm [Name]"
    const intro = review.owner_answer.match(/\bI(?:'m| am)\s+([A-Z][a-z]{2,15})\b/);
    if (intro?.[1]) return intro[1];
  }
  return null;
}

// ── Detect pain reviews ───────────────────────────────────────────────────────
function detectPainReviews(reviews) {
  if (!Array.isArray(reviews)) return [];
  return reviews
    .filter(r => {
      const text = (r.text || "").toLowerCase();
      return r.rating <= 3 && PAIN_KEYWORDS.some(kw => text.includes(kw));
    })
    .map(r => ({
      rating: r.rating,
      text: (r.text || "").slice(0, 200),
      time: r.relative_time_description,
    }));
}

// ─── Main ─────────────────────────────────────────────────────────────────────

if (!PLACES_KEY) {
  console.error("⚠  GOOGLE_PLACES_API_KEY not set in .env — cannot query Google Places.");
  console.error("   Get a key at: https://console.cloud.google.com/apis/credentials");
  console.error("   Enable: Places API");
  process.exit(1);
}

const leads = readJsonSafe(OUTREACH_PATH, []);
const existingQueue = readJsonSafe(QUEUE_PATH, []);
const log = readJsonSafe(LOG_PATH, []);

const processedNames = new Set(log.map(l => l.clinicName));

// Target: sent or followup clinics not yet scanned
const targets = leads
  .filter(l => {
    if (!l.clinicName) return false;
    if (processedNames.has(l.clinicName)) return false;
    const s = l.status || "todo";
    return ["sent", "followup_1_sent", "followup_2_sent", "followup_3_sent", "todo"].includes(s);
  })
  .slice(0, LIMIT);

console.log(`\nGoogle Business Profile Scanner`);
console.log(`Mode: ${DRY_RUN ? "dry-run" : "live"} | Limit: ${LIMIT}`);
console.log(`Targets: ${targets.length} clinics\n`);

const newQueueEntries = [];
let scanned = 0, found = 0, painFound = 0;

for (const lead of targets) {
  const city = (lead.city || "").split(",")[0].trim();
  process.stdout.write(`  ${(lead.clinicName || "").slice(0, 40).padEnd(40)} `);

  try {
    await sleep(300); // respect rate limits
    scanned++;

    const place = await findPlace(lead.clinicName, city);
    if (!place) {
      console.log("not found");
      log.push({ clinicName: lead.clinicName, scannedAt: new Date().toISOString(), found: false });
      continue;
    }

    const details = await getPlaceDetails(place.place_id);
    const ownerName = details ? extractOwnerName(details.reviews) : null;
    const painReviews = details ? detectPainReviews(details.reviews) : [];
    const rating = details?.rating || place.rating;
    const totalReviews = details?.user_ratings_total || place.user_ratings_total || 0;

    found++;
    if (painReviews.length) painFound++;

    const entry = {
      clinicName:   lead.clinicName,
      city,
      email:        lead.email || null,
      phone:        lead.phone || null,
      placeId:      place.place_id,
      googleUrl:    details?.url || `https://maps.google.com/?cid=${place.place_id}`,
      rating,
      totalReviews,
      ownerName:    ownerName || null,
      painReviews,
      hasPainSignal: painReviews.length > 0,
      scannedAt:    new Date().toISOString(),
      outreachStatus: "pending",
    };

    const statusStr = painReviews.length
      ? `★${rating} | ${painReviews.length} pain review(s) | owner: ${ownerName || "unknown"}`
      : `★${rating} | ${totalReviews} reviews | owner: ${ownerName || "unknown"}`;
    console.log(statusStr);

    if (!DRY_RUN) {
      newQueueEntries.push(entry);
      log.push({ clinicName: lead.clinicName, scannedAt: new Date().toISOString(), found: true, placeId: place.place_id });
    }

  } catch (e) {
    console.log(`error: ${e.message.slice(0, 60)}`);
    log.push({ clinicName: lead.clinicName, scannedAt: new Date().toISOString(), found: false, error: e.message.slice(0, 80) });
  }
}

if (!DRY_RUN) {
  const merged = [...existingQueue, ...newQueueEntries];
  writeJsonSafe(QUEUE_PATH, merged);
  writeJsonSafe(LOG_PATH, log);
}

console.log(`\n${"─".repeat(56)}`);
console.log(`  Scanned:         ${scanned}`);
console.log(`  Found on Google: ${found}`);
console.log(`  Pain signals:    ${painFound}`);
console.log(`  Queue saved →   ${QUEUE_PATH}`);
console.log(DRY_RUN ? "\n  (dry-run — nothing written)" : "");
