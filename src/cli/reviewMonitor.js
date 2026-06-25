// src/cli/reviewMonitor.js
// Daily monitor of Google reviews for target clinics.
// Flags new negative reviews mentioning phone/missed-call pain signals.
// Auto-generates personalized outreach referencing the specific review.
// Adds flagged clinics to high-priority send queue.
//
// Requires: GOOGLE_PLACES_API_KEY in .env
//
// Usage:
//   node src/cli/reviewMonitor.js --limit 100
//   node src/cli/reviewMonitor.js --limit 100 --dry-run

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const DATA_DIR = path.join(ROOT, "data");
const OUTREACH_PATH  = path.join(DATA_DIR, "outreach.localDentists.json");
const STATE_PATH     = path.join(DATA_DIR, "intelligence", "review-monitor-state.json");
const HOT_LEADS_PATH = path.join(DATA_DIR, "intelligence", "review-hot-leads.json");
const GB_LOG_PATH    = path.join(DATA_DIR, "intelligence", "google-business-log.json");

const PLACES_KEY = (process.env.GOOGLE_PLACES_API_KEY || "").trim();

const args    = process.argv.slice(2);
const DRY_RUN = args.includes("--dry-run");
const limitIdx = args.indexOf("--limit");
const LIMIT   = limitIdx !== -1 ? Number(args[limitIdx + 1]) : 100;

const PAIN_KEYWORDS = [
  "phone", "missed call", "no one answered", "couldn't reach", "hard to reach",
  "didn't answer", "never called back", "left voicemail", "no response",
  "unreachable", "keep calling", "multiple calls", "called several times",
  "busy signal", "no call back", "dropped the ball", "follow up",
];

const NEGATIVE_THRESHOLD = 3; // 3 stars or below

function readJsonSafe(p, fb) {
  try { if (!fs.existsSync(p)) return fb; return JSON.parse(fs.readFileSync(p, "utf-8")); }
  catch { return fb; }
}

function writeJsonSafe(p, data) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(data, null, 2), "utf-8");
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function isPainReview(text, rating) {
  if (rating > NEGATIVE_THRESHOLD) return false;
  const lower = text.toLowerCase();
  return PAIN_KEYWORDS.some(kw => lower.includes(kw));
}

// ── Google Places lookups ─────────────────────────────────────────────────────
async function findPlaceId(clinicName, city) {
  const query = encodeURIComponent(`${clinicName} dental ${city} Canada`);
  const url = `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${query}&type=dentist&key=${PLACES_KEY}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) return null;
  const json = await res.json();
  return json.results?.[0]?.place_id || null;
}

async function getReviews(placeId) {
  const url = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${placeId}&fields=reviews,rating,name&key=${PLACES_KEY}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) return null;
  const json = await res.json();
  return json.result || null;
}

// ── Generate personalized outreach for pain review ────────────────────────────
function buildHotLeadEmail(lead, review) {
  const name = lead.clinicName || "your clinic";
  const city = (lead.city || "").split(",")[0].trim();
  const snippet = (review.text || "").slice(0, 100).replace(/\n/g, " ");
  const senderName = process.env.SENDER_NAME || "Mohamed";

  return {
    subject: `I noticed a recent review mentioned ${name}`.slice(0, 55),
    body: `Hi,

I came across a recent review for ${name} that mentioned difficulty reaching someone by phone.

That's exactly the problem I help dental clinics in ${city} fix — when a patient calls and no one answers, they receive an automated follow-up within 60 seconds so you don't lose the appointment.

Most clinics I work with recover 3–6 missed patients in the first two weeks. Free audit, no commitment.

Worth a quick look?

${senderName}
ClinicFlow Automation`,
    reviewSnippet: snippet,
    reviewRating: review.rating,
  };
}

// ─── Main ─────────────────────────────────────────────────────────────────────

if (!PLACES_KEY) {
  console.error("⚠  GOOGLE_PLACES_API_KEY not set in .env");
  console.error("   Get a key at: https://console.cloud.google.com/apis/credentials");
  process.exit(1);
}

const leads = readJsonSafe(OUTREACH_PATH, []);
const state = readJsonSafe(STATE_PATH, {}); // { [clinicName]: { lastReviewTime, placeId } }
const existingHotLeads = readJsonSafe(HOT_LEADS_PATH, []);
const gbLog = readJsonSafe(GB_LOG_PATH, []);

// Use known placeIds from previous google-business-outreach runs
const knownPlaceIds = {};
for (const entry of gbLog) {
  if (entry.placeId) knownPlaceIds[entry.clinicName] = entry.placeId;
}

// Target: priority clinics — high opportunity score or already emailed
const priorityStatuses = new Set(["sent", "followup_1_sent", "followup_2_sent", "todo"]);
const targets = leads
  .filter(l => l.clinicName && priorityStatuses.has(l.status || "todo"))
  .sort((a, b) => (b.opportunityScore || 0) - (a.opportunityScore || 0))
  .slice(0, LIMIT);

console.log(`\nGoogle Review Monitor`);
console.log(`Mode: ${DRY_RUN ? "dry-run" : "live"} | Limit: ${LIMIT}`);
console.log(`Targets: ${targets.length} priority clinics\n`);

const newHotLeads = [];
let scanned = 0, hotCount = 0;

for (const lead of targets) {
  const city = (lead.city || "").split(",")[0].trim();
  process.stdout.write(`  ${(lead.clinicName || "").slice(0, 38).padEnd(38)} `);

  try {
    await sleep(250);
    scanned++;

    // Get or find placeId
    let placeId = knownPlaceIds[lead.clinicName] || state[lead.clinicName]?.placeId;
    if (!placeId) {
      placeId = await findPlaceId(lead.clinicName, city);
      await sleep(200);
    }

    if (!placeId) {
      console.log("not found");
      continue;
    }

    const details = await getReviews(placeId);
    if (!details?.reviews?.length) {
      console.log("no reviews");
      continue;
    }

    // Find new pain reviews since last scan
    const lastScan = state[lead.clinicName]?.lastScanAt
      ? new Date(state[lead.clinicName].lastScanAt).getTime()
      : 0;

    const painReviews = details.reviews.filter(r => {
      const ts = (r.time || 0) * 1000;
      const isNew = ts > lastScan || lastScan === 0;
      return isNew && isPainReview(r.text || "", r.rating || 5);
    });

    if (painReviews.length > 0) {
      hotCount++;
      const topReview = painReviews[0];
      const emailDraft = buildHotLeadEmail(lead, topReview);

      const hotLead = {
        clinicName:  lead.clinicName,
        city,
        email:       lead.email || null,
        currentStatus: lead.status,
        placeId,
        rating:      details.rating,
        painReviews: painReviews.map(r => ({
          rating: r.rating,
          text: (r.text || "").slice(0, 200),
          time: r.relative_time_description,
        })),
        emailDraft,
        detectedAt: new Date().toISOString(),
        outreachStatus: "pending",
      };

      newHotLeads.push(hotLead);
      console.log(`🔥 ${painReviews.length} pain review(s) — ★${details.rating}`);
    } else {
      console.log(`ok  ★${details.rating} | ${details.reviews.length} reviews`);
    }

    // Update state
    state[lead.clinicName] = {
      placeId,
      lastScanAt: new Date().toISOString(),
      rating: details.rating,
    };

  } catch (e) {
    console.log(`err: ${e.message.slice(0, 40)}`);
  }
}

if (!DRY_RUN) {
  const merged = [...existingHotLeads.filter(h => !newHotLeads.find(n => n.clinicName === h.clinicName)), ...newHotLeads];
  writeJsonSafe(HOT_LEADS_PATH, merged);
  writeJsonSafe(STATE_PATH, state);
}

console.log(`\n${"─".repeat(56)}`);
console.log(`  Scanned:       ${scanned}`);
console.log(`  🔥 Hot leads:  ${hotCount} (new pain reviews detected)`);
console.log(`  Saved →       ${HOT_LEADS_PATH}`);

if (hotCount > 0) {
  console.log(`\nHot leads found:`);
  newHotLeads.forEach(h => {
    console.log(`  • ${h.clinicName} (${h.city}) — ${h.painReviews.length} pain review(s)`);
    console.log(`    Email draft subject: "${h.emailDraft.subject}"`);
  });
  console.log(`\nNext: review ${HOT_LEADS_PATH} and manually send the draft emails`);
  console.log(`or add to sendBatch priority queue.`);
}
