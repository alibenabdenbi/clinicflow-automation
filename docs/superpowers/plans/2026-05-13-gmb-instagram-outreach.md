# GMB + Instagram Outreach Generator — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enrich clinic records with Google My Business data, generate 10 personalized GMB + 10 Instagram copy-paste messages each morning via Claude, deliver them in the morning brief email, and track which clinics have been contacted.

**Architecture:** A new `gmbEnricher.js` service handles all Google Places API calls and Instagram HTML scraping, writing enriched fields directly back to `outreach.localDentists.json`. A new CLI `generateDailyTargets.js` selects top candidates and calls Claude Haiku for personalized messages. The morning brief reads `data/daily-targets.json` and appends two new sections. Two scheduler entries (06:30 enrichment, 07:00 target generation) run the pipeline daily before the 07:15 morning brief.

**Tech Stack:** Node.js ESM, `@anthropic-ai/sdk`, `cheerio` (HTML parsing), Google Places API (textsearch + place details), native `fetch`, existing `readJsonSafe`/`writeJson` pattern.

---

## File Map

| Action | File | Responsibility |
|--------|------|----------------|
| **Create** | `src/services/gmbEnricher.js` | Places API lookup, Instagram scraping, Claude personalDetail, `enrichWithGMB()`, `enrichBatch()`, `findInstagram()` |
| **Create** | `src/cli/generateDailyTargets.js` | Pick top 10 GMB + 10 IG candidates, call Claude for messages, save `data/daily-targets.json` |
| **Create** | `src/cli/markGMBSent.js` | CLI: stamp `gmbContactedAt` + `gmbMessage` on a clinic record |
| **Modify** | `src/cli/sendMorningBrief.js` | Append GMB + Instagram sections after LinkedIn section |
| **Modify** | `src/scheduler.js` | Add `scheduleDaily` for enrichment @ 06:30 and target generation @ 07:00 |

New fields written to each `outreach.localDentists.json` record:
`placeId`, `googleMapsUrl`, `rating`, `reviewCount`, `hasMessaging`, `googlePhone`, `isOpen`, `openingHours`, `recentReviews`, `painSignals`, `painScore`, `instagramHandle`, `socialLinks`, `personalDetail`, `gmbEnrichedAt`, `gmbContactedAt`, `gmbMessage`

---

## Task 1 — Create `src/services/gmbEnricher.js` (core enrichment)

**Files:**
- Create: `src/services/gmbEnricher.js`

- [ ] **Step 1: Create the file**

```javascript
// src/services/gmbEnricher.js
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import * as cheerio from "cheerio";
import dotenv from "dotenv";

dotenv.config();

// Windows TLS workaround (consistent with mailer.js pattern)
if (process.platform === "win32") process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT       = path.resolve(__dirname, "../..");
const DATA_DIR   = path.join(ROOT, "data");
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
  const q = encodeURIComponent(`${clinicName} dental ${city || ""} Canada`);
  const url = `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${q}&type=dentist&key=${GOOGLE_KEY}`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    const json = await res.json();
    if (json.status === "OK" && json.results?.length) return json.results[0];
  } catch {}
  return null;
}

async function getPlaceDetails(placeId) {
  const fields = "name,formatted_phone_number,website,opening_hours,reviews,rating,user_ratings_total,url,business_status";
  const url = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${placeId}&fields=${fields}&key=${GOOGLE_KEY}`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
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
      signal: AbortSignal.timeout(10_000),
      redirect: "follow",
    });
    if (!res.ok) return null;
    const html = await res.text();
    const $ = cheerio.load(html);

    // Priority 1: explicit <a href="...instagram.com/handle">
    let handle = null;
    $('a[href*="instagram.com"]').each((_, el) => {
      if (handle) return;
      const href = $(el).attr("href") || "";
      const m = href.match(/instagram\.com\/([a-zA-Z0-9_.]{2,30})\/?/);
      if (m && !["p", "reel", "explore", "stories"].includes(m[1])) {
        handle = `@${m[1]}`;
      }
    });
    if (handle) return handle;

    // Priority 2: any text/attribute containing instagram.com
    const raw = html.match(/instagram\.com\/([a-zA-Z0-9_.]{2,30})[/"'?]/);
    if (raw && !["p", "reel", "explore", "stories"].includes(raw[1])) {
      return `@${raw[1]}`;
    }
    return null;
  } catch { return null; }
}

// ─── Claude personalDetail ────────────────────────────────────────────────────

async function generatePersonalDetail(clinicName, city, rating, reviewCount, painSignals, reviewSnippet) {
  // Rule-based fallback (always works, no API needed)
  const ruleBased = (() => {
    if (painSignals.length) return `patient mentioned "${painSignals[0]}"`;
    if (rating >= 4.8 && reviewCount > 100) return `${rating} stars with ${reviewCount}+ reviews`;
    if (rating >= 4.5 && reviewCount > 50) return `highly rated with ${reviewCount} Google reviews`;
    if (reviewCount > 200) return `${reviewCount}+ Google reviews`;
    return `${rating || "?"} stars on Google`;
  })();

  if (!ANTHROPIC_KEY) return ruleBased;

  const prompt = `Write ONE short phrase (under 70 chars) personalizing B2B outreach to a dental clinic.
Use the most compelling detail available. Examples: "patient mentioned no callback in a 2-star review", "4.9 stars with 300+ reviews", "offers pediatric dentistry".

Clinic: ${clinicName}, ${city}
Rating: ${rating} (${reviewCount} reviews)
Pain signals: ${painSignals.slice(0, 2).join(", ") || "none"}
Review snippet: "${(reviewSnippet || "").slice(0, 100)}"

Reply with ONLY the phrase. No quotes. No explanation.`;

  try {
    const { default: Anthropic } = await import("@anthropic-ai/sdk");
    const client = new Anthropic({ apiKey: ANTHROPIC_KEY });
    const msg = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 80,
      messages: [{ role: "user", content: prompt }],
    });
    return msg.content[0]?.text?.trim() || ruleBased;
  } catch { return ruleBased; }
}

// ─── Public API ───────────────────────────────────────────────────────────────

export async function enrichWithGMB(clinic) {
  if (!GOOGLE_KEY) throw new Error("GOOGLE_PLACES_API_KEY not set in .env");

  const city = (clinic.city || "").split(",")[0].trim();
  const place = await findPlace(clinic.clinicName, city);
  if (!place) return null;

  const details = await getPlaceDetails(place.place_id);
  const { painSignals, painScore } = extractPainSignals(details?.reviews);

  const instagramHandle = await findInstagram(details?.website || clinic.website);

  const recentReviews = (details?.reviews || []).slice(0, 3).map(r => ({
    rating: r.rating,
    text: (r.text || "").slice(0, 150),
    time: r.relative_time_description,
  }));

  const rating     = details?.rating || place.rating || null;
  const reviewCount = details?.user_ratings_total || place.user_ratings_total || 0;
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
  const all = readJsonSafe(OUTREACH_PATH, []);
  const targets = clinics.filter(c => !c.placeId).slice(0, limit);

  console.log(`GMB Enricher — ${targets.length} clinics (skipping already enriched)`);
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
```

- [ ] **Step 2: Smoke-test enrichment on 1 clinic**

```bash
node --input-type=module << 'EOF'
import dotenv from 'dotenv'; dotenv.config();
import { enrichWithGMB } from './src/services/gmbEnricher.js';
const result = await enrichWithGMB({ clinicName: "Yonge Eglinton Dental", city: "Toronto", website: "" });
console.log(JSON.stringify(result, null, 2));
EOF
```

Expected: JSON object with `placeId`, `rating`, `reviewCount`, `googleMapsUrl`. If `GOOGLE_PLACES_API_KEY` is valid, `placeId` will be a non-null string starting with `ChIJ`.

- [ ] **Step 3: Commit**

```bash
git add src/services/gmbEnricher.js
git commit -m "feat: add gmbEnricher service — Places API enrichment + Instagram finder"
```

---

## Task 2 — Create `src/cli/generateDailyTargets.js`

**Files:**
- Create: `src/cli/generateDailyTargets.js`

- [ ] **Step 1: Create the file**

```javascript
// src/cli/generateDailyTargets.js
// Generates 10 GMB + 10 Instagram outreach targets for today.
// Run: node src/cli/generateDailyTargets.js
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";

dotenv.config();
if (process.platform === "win32") process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

const __dirname    = path.dirname(fileURLToPath(import.meta.url));
const ROOT         = path.resolve(__dirname, "../..");
const DATA_DIR     = path.join(ROOT, "data");
const OUTREACH_PATH = path.join(DATA_DIR, "outreach.localDentists.json");
const SALON_PATH   = path.join(DATA_DIR, "outreach.salonBusinesses.json");
const TARGETS_PATH = path.join(DATA_DIR, "daily-targets.json");

const ANTHROPIC_KEY = (process.env.ANTHROPIC_API_KEY || "").trim();

function readJsonSafe(p, fb) {
  try { if (!fs.existsSync(p)) return fb; return JSON.parse(fs.readFileSync(p, "utf-8")); }
  catch { return fb; }
}
function writeJson(p, data) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(data, null, 2), "utf-8");
}

// ─── Claude message generators ────────────────────────────────────────────────

async function callClaude(prompt, maxTokens = 100) {
  if (!ANTHROPIC_KEY) return null;
  try {
    const { default: Anthropic } = await import("@anthropic-ai/sdk");
    const client = new Anthropic({ apiKey: ANTHROPIC_KEY });
    const msg = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: maxTokens,
      messages: [{ role: "user", content: prompt }],
    });
    return msg.content[0]?.text?.trim() || null;
  } catch { return null; }
}

async function generateGMBMessage(clinic) {
  const city   = (clinic.city || "").split(",")[0].trim();
  const detail = clinic.personalDetail || `${clinic.rating || "?"} stars on Google`;
  const pain   = clinic.painSignals?.[0] || null;

  const fallback = `Hi ${clinic.clinicName} — I noticed ${detail}. I help dental clinics in ${city} auto-reply to missed calls within 60 sec. One-time setup. Worth a look? — Mohamed, ClinicFlow`;

  const prompt = `Write a GMB outreach message for a dental clinic. Strict rules:
- Under 160 characters TOTAL (count carefully)
- Must mention the specific detail: "${detail}"
- Offer: automatic missed-call text-back within 60 seconds, one-time setup
- End signature: "— Mohamed, ClinicFlow"
- Tone: direct and helpful, not salesy
- No emojis

Clinic: ${clinic.clinicName}, ${city}${pain ? `\nPain signal: "${pain}"` : ""}

Reply with ONLY the message text. Nothing else. Count the characters before replying.`;

  const result = await callClaude(prompt, 120);
  return result || fallback;
}

async function generateInstagramMessage(clinic) {
  const city     = (clinic.city || "").split(",")[0].trim();
  const fallback = `Hey! I help clinics in ${city} never miss a patient — auto-replies to missed calls + inquiries. Curious? — Mohamed`;

  const prompt = `Write an Instagram DM for a ${clinic.clinicName.toLowerCase().includes("salon") || clinic.clinicName.toLowerCase().includes("spa") || clinic.clinicName.toLowerCase().includes("hair") ? "salon/spa" : "dental clinic"}. Rules:
- Under 200 characters
- Friendly and natural — not a cold sales pitch
- Service: automated follow-up for missed calls and inquiries
- End: "— Mohamed"
- Instagram casual tone

Business: ${clinic.clinicName}, ${city}

Reply with ONLY the message. Nothing else.`;

  const result = await callClaude(prompt, 120);
  return result || fallback;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function run() {
  const today    = new Date().toISOString().slice(0, 10);
  const dentists = readJsonSafe(OUTREACH_PATH, []);
  const salons   = readJsonSafe(SALON_PATH, []);

  // ── 10 GMB targets ──────────────────────────────────────────────────────────
  const gmbCandidates = dentists
    .filter(c => c.placeId && !c.gmbContactedAt && c.status === "todo")
    .sort((a, b) => {
      if ((b.painScore || 0) !== (a.painScore || 0)) return (b.painScore || 0) - (a.painScore || 0);
      if ((b.rating || 0) !== (a.rating || 0)) return (b.rating || 0) - (a.rating || 0);
      return (b.reviewCount || 0) - (a.reviewCount || 0);
    })
    .slice(0, 10);

  console.log(`\nGenerating targets for ${today}`);
  console.log(`GMB candidates available: ${gmbCandidates.length}`);

  const gmbTargets = [];
  for (const clinic of gmbCandidates) {
    process.stdout.write(`  GMB [${gmbTargets.length + 1}/10] ${(clinic.clinicName || "").slice(0, 38).padEnd(38)} `);
    const message = await generateGMBMessage(clinic);
    gmbTargets.push({
      clinicName:    clinic.clinicName,
      city:          clinic.city || "",
      mapsUrl:       clinic.googleMapsUrl || "",
      message,
      personalDetail: clinic.personalDetail || "",
      painSignal:    clinic.painSignals?.[0] || null,
      rating:        clinic.rating || null,
      reviewCount:   clinic.reviewCount || 0,
    });
    process.stdout.write(`✓ (${message.length} chars)\n`);
    await new Promise(r => setTimeout(r, 250));
  }

  // ── 10 Instagram targets ────────────────────────────────────────────────────
  const igPool = [
    ...dentists.filter(c => c.instagramHandle && !c.gmbContactedAt),
    ...salons.filter(c => c.instagramHandle && !c.gmbContactedAt),
  ];

  console.log(`\nInstagram candidates available: ${igPool.length}`);

  const igTargets = [];
  for (const clinic of igPool.slice(0, 10)) {
    process.stdout.write(`  IG  [${igTargets.length + 1}/10] ${(clinic.clinicName || "").slice(0, 38).padEnd(38)} `);
    const message = await generateInstagramMessage(clinic);
    const handle  = (clinic.instagramHandle || "").replace("@", "");
    igTargets.push({
      clinicName:    clinic.clinicName,
      instagramUrl:  `https://instagram.com/${handle}`,
      message,
      personalDetail: clinic.personalDetail || "",
    });
    process.stdout.write(`✓\n`);
    await new Promise(r => setTimeout(r, 250));
  }

  const output = { date: today, gmb: gmbTargets, instagram: igTargets };
  writeJson(TARGETS_PATH, output);

  // ── Print summary ───────────────────────────────────────────────────────────
  console.log(`\n${"═".repeat(60)}`);
  console.log(`TODAY'S TARGETS — ${today}`);
  console.log(`${"═".repeat(60)}`);
  console.log(`\n── GMB MESSAGES (tap Maps link → Message → paste) ──────────`);
  if (gmbTargets.length === 0) {
    console.log("  No enriched clinics yet — run: node src/cli/enrichGMB.js first");
  } else {
    gmbTargets.forEach((t, i) => {
      const city = (t.city || "").split(",")[0];
      console.log(`\n${i + 1}. ${t.clinicName} — ${city} — ⭐${t.rating || "?"} (${t.reviewCount} reviews)`);
      console.log(`   Maps: ${t.mapsUrl}`);
      console.log(`   "${t.message}"`);
      if (t.personalDetail) console.log(`   Why: ${t.personalDetail}`);
    });
  }

  console.log(`\n── INSTAGRAM DMs ──────────────────────────────────────────`);
  if (igTargets.length === 0) {
    console.log("  No Instagram handles found yet — enrichment will populate these.");
  } else {
    igTargets.forEach((t, i) => {
      console.log(`\n${i + 1}. ${t.clinicName}`);
      console.log(`   ${t.instagramUrl}`);
      console.log(`   "${t.message}"`);
    });
  }

  console.log(`\nSaved → ${TARGETS_PATH}`);
}

run().catch(e => { console.error(e.message); process.exit(1); });
```

- [ ] **Step 2: Verify syntax**

```bash
node --check src/cli/generateDailyTargets.js
```

Expected: no output (clean parse).

- [ ] **Step 3: Commit**

```bash
git add src/cli/generateDailyTargets.js
git commit -m "feat: add generateDailyTargets CLI — 10 GMB + 10 Instagram messages via Claude Haiku"
```

---

## Task 3 — Create `src/cli/markGMBSent.js`

**Files:**
- Create: `src/cli/markGMBSent.js`

- [ ] **Step 1: Create the file**

```javascript
// src/cli/markGMBSent.js
// Marks a clinic as GMB-contacted so it won't appear in future target lists.
// Usage: node src/cli/markGMBSent.js "Clinic Name"
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname     = path.dirname(fileURLToPath(import.meta.url));
const ROOT          = path.resolve(__dirname, "../..");
const OUTREACH_PATH = path.join(ROOT, "data", "outreach.localDentists.json");
const TARGETS_PATH  = path.join(ROOT, "data", "daily-targets.json");

const name = process.argv.slice(2).join(" ").trim();
if (!name) {
  console.error("Usage: node src/cli/markGMBSent.js \"Clinic Name\"");
  process.exit(1);
}

const clinics = JSON.parse(fs.readFileSync(OUTREACH_PATH, "utf-8"));
const targets = (() => {
  try { return JSON.parse(fs.readFileSync(TARGETS_PATH, "utf-8")); }
  catch { return { gmb: [] }; }
})();

const matches = clinics.filter(c =>
  (c.clinicName || "").toLowerCase().includes(name.toLowerCase())
);

if (matches.length === 0) {
  console.error(`No clinic found matching: "${name}"`);
  process.exit(1);
}
if (matches.length > 1) {
  console.log(`Multiple matches — be more specific:`);
  matches.forEach(c => console.log(`  • ${c.clinicName} (${c.city || "?"})`));
  process.exit(1);
}

const clinic     = matches[0];
const todayEntry = (targets.gmb || []).find(t => t.clinicName === clinic.clinicName);
const idx        = clinics.findIndex(c => c.clinicName === clinic.clinicName);

clinics[idx].gmbContactedAt = new Date().toISOString();
if (todayEntry?.message) clinics[idx].gmbMessage = todayEntry.message;

fs.writeFileSync(OUTREACH_PATH, JSON.stringify(clinics, null, 2), "utf-8");
console.log(`✓ Marked GMB sent: ${clinic.clinicName} (${clinic.city || "?"})`);
if (todayEntry?.message) console.log(`  Message recorded: "${todayEntry.message.slice(0, 80)}..."`);
```

- [ ] **Step 2: Verify syntax**

```bash
node --check src/cli/markGMBSent.js
```

Expected: no output.

- [ ] **Step 3: Commit**

```bash
git add src/cli/markGMBSent.js
git commit -m "feat: add markGMBSent CLI — stamps gmbContactedAt on clinic record"
```

---

## Task 4 — Update `src/cli/sendMorningBrief.js` (GMB + Instagram sections)

**Files:**
- Modify: `src/cli/sendMorningBrief.js`

The `buildBrief()` function builds the brief as a `lines` array. We insert two new sections after the LinkedIn section (after the `if (remaining > 5)` block) and before the `// 8. Priority action items` comment.

- [ ] **Step 1: Find the exact insertion point**

Open `src/cli/sendMorningBrief.js`. The LinkedIn section ends with:
```js
    if (remaining > 5) lines.push(`  … ${remaining - 5} more in queue (run npm run linkedin:enrich to refresh)`);
  }

  // 8. Priority action items
```

- [ ] **Step 2: Insert GMB + Instagram sections**

Add after the closing `}` of the LinkedIn block and before `// 8. Priority action items`:

```javascript
  lines.push("");

  // 8a. GMB daily targets
  const dailyTargets = readJsonSafe(path.join(DATA_DIR, "daily-targets.json"), null);
  const todayTargets = dailyTargets?.date === today ? dailyTargets : null;

  lines.push("── TODAY'S GMB MESSAGES (tap link → Message → paste) ─────");
  if (!todayTargets?.gmb?.length) {
    lines.push("  No targets yet — run: node src/cli/generateDailyTargets.js");
  } else {
    todayTargets.gmb.forEach((t, i) => {
      const city = (t.city || "").split(",")[0];
      lines.push(`  ${i + 1}. ${t.clinicName} — ${city} — ⭐${t.rating || "?"} (${t.reviewCount || 0} reviews)`);
      lines.push(`     Maps: ${t.mapsUrl}`);
      lines.push(`     Message: "${t.message}"`);
      if (t.personalDetail) lines.push(`     Why: ${t.personalDetail}`);
      lines.push("     ---");
    });
  }
  lines.push("");

  // 8b. Instagram daily targets
  lines.push("── TODAY'S INSTAGRAM DMs ─────────────────────────────────");
  if (!todayTargets?.instagram?.length) {
    lines.push("  No Instagram targets yet — enrichment populates these.");
  } else {
    todayTargets.instagram.forEach((t, i) => {
      lines.push(`  ${i + 1}. ${t.clinicName}`);
      lines.push(`     ${t.instagramUrl}`);
      lines.push(`     Message: "${t.message}"`);
    });
  }
  lines.push("");
```

- [ ] **Step 3: Also add action item for GMB targets**

In the `// 8. Priority action items` block, find:
```js
  if (liTargets.length > 0)  lines.push(`  → ${liTargets.length} LinkedIn target(s) above — send connection requests`);
```

Add after it:
```js
  const gmbCount = todayTargets?.gmb?.length || 0;
  const igCount  = todayTargets?.instagram?.length || 0;
  if (gmbCount > 0) lines.push(`  → ${gmbCount} GMB message(s) above — open Maps link and tap Message`);
  if (igCount > 0)  lines.push(`  → ${igCount} Instagram DM(s) above — open handle and send`);
```

- [ ] **Step 4: Verify syntax**

```bash
node --check src/cli/sendMorningBrief.js
```

Expected: no output.

- [ ] **Step 5: Commit**

```bash
git add src/cli/sendMorningBrief.js
git commit -m "feat: add GMB + Instagram sections to morning brief"
```

---

## Task 5 — Update `src/scheduler.js` (two new jobs)

**Files:**
- Modify: `src/scheduler.js`

- [ ] **Step 1: Add GMB enrichment job at 06:30**

Find the `// 06:45 — Review pain signal scan` block and add BEFORE it:

```javascript
// 06:30 — GMB enrichment (50 clinics/day, runs before review scan + brief)
scheduleDaily(6, 30, "GMB Enrichment (50 clinics)", async () => {
  try {
    const { enrichBatch } = await import("./services/gmbEnricher.js");
    const data = readJsonSafe(path.join(DATA_DIR, "outreach.localDentists.json"), []);
    const unenriched = data
      .filter(c => !c.placeId && c.status === "todo")
      .sort((a, b) => (b.reviewPainScore || 0) - (a.reviewPainScore || 0))
      .slice(0, 50);
    if (unenriched.length === 0) {
      appendLog("GMB Enrichment: all todo clinics already enriched");
      return;
    }
    await enrichBatch(unenriched, 50);
  } catch (err) {
    appendLog(`GMB enrichment error: ${err?.message || err}`);
  }
});
```

- [ ] **Step 2: Add daily targets job at 07:00 (alongside existing 07:00 jobs)**

Find the block of 07:00 jobs and add a new `scheduleDaily(7, 0, ...)`:

```javascript
// 07:00 — GMB + Instagram daily targets (runs after 06:30 enrichment, before 07:15 brief)
scheduleDaily(7, 0, "GMB + Instagram Daily Targets", async () => {
  await runScript("src/cli/generateDailyTargets.js");
});
```

- [ ] **Step 3: Update boot log to mention new jobs**

Find the boot log line:
```js
appendLog("Jobs: painScan@06:45, ...");
```

Replace with:
```js
appendLog("Jobs: gmbEnrich@06:30, painScan@06:45, gmbTargets@07:00, prepare@07:00, enrich@07:30, pipeline@08:00, reminders@08:30, send:dental@10:00, followups@11:00, send:physio@15:00, summary@18:00, intelligence@07:00-Monday");
```

- [ ] **Step 4: Verify syntax**

```bash
node --check src/scheduler.js
```

Expected: no output.

- [ ] **Step 5: Commit**

```bash
git add src/scheduler.js
git commit -m "feat: add GMB enrichment (06:30) and daily targets (07:00) to scheduler"
```

---

## Task 6 — Run first GMB enrichment (100 priority clinics)

This is a live run against the Google Places API. It will consume ~200 API credits (2 calls × 100 clinics).

- [ ] **Step 1: Run the enrichment**

```bash
node --input-type=module << 'EOF'
import dotenv from 'dotenv';
dotenv.config();
import { enrichBatch } from './src/services/gmbEnricher.js';
import fs from 'fs';

const data = JSON.parse(fs.readFileSync('data/outreach.localDentists.json', 'utf8'));

const prioritized = data
  .filter(c => !c.placeId && c.status === 'todo')
  .sort((a, b) => {
    if ((b.reviewPainScore || 0) !== (a.reviewPainScore || 0))
      return (b.reviewPainScore || 0) - (a.reviewPainScore || 0);
    return (b.reviewCount || 0) - (a.reviewCount || 0);
  })
  .slice(0, 100);

console.log(`Enriching ${prioritized.length} priority clinics...`);
await enrichBatch(prioritized, 100);

const updated = JSON.parse(fs.readFileSync('data/outreach.localDentists.json', 'utf8'));
const enriched     = updated.filter(c => c.placeId);
const withMessaging = updated.filter(c => c.hasMessaging);
const withPain     = updated.filter(c => (c.painScore || 0) > 0 && c.placeId);
const withIg       = updated.filter(c => c.instagramHandle);

console.log('\n=== ENRICHMENT RESULTS ===');
console.log(`Enriched:            ${enriched.length}`);
console.log(`GMB messaging (est): ${withMessaging.length}`);
console.log(`Pain signals found:  ${withPain.length}`);
console.log(`Instagram found:     ${withIg.length}`);

console.log('\nTop 10 GMB targets:');
updated
  .filter(c => c.placeId)
  .sort((a, b) => (b.painScore || 0) - (a.painScore || 0))
  .slice(0, 10)
  .forEach((c, i) => {
    console.log(`${i+1}. ${c.clinicName} — ${(c.city||'').split(',')[0]} — ⭐${c.rating} (${c.reviewCount} reviews)`);
    if (c.painSignals?.length) console.log(`   Pain: "${c.painSignals[0]}"`);
    if (c.googleMapsUrl) console.log(`   Maps: ${c.googleMapsUrl}`);
    if (c.instagramHandle) console.log(`   IG: ${c.instagramHandle}`);
  });
EOF
```

Expected: 100 lines of output with ratings + pain scores. Final summary shows counts.

- [ ] **Step 2: Verify records were written**

```bash
node --input-type=module -e "
import fs from 'fs';
const d = JSON.parse(fs.readFileSync('data/outreach.localDentists.json', 'utf8'));
const e = d.filter(c => c.placeId);
const ig = d.filter(c => c.instagramHandle);
const pain = d.filter(c => (c.painScore||0) > 0 && c.placeId);
console.log('enriched:', e.length, '| instagram:', ig.length, '| pain:', pain.length);
console.log('sample placeId:', e[0]?.placeId);
"
```

Expected: `enriched: N | instagram: M | pain: P` with non-zero N.

---

## Task 7 — Run `generateDailyTargets.js` and review output

- [ ] **Step 1: Run target generation**

```bash
node src/cli/generateDailyTargets.js
```

Expected output: 10 GMB entries each with a message under 160 chars, and however many Instagram targets were found. Full messages printed to console.

- [ ] **Step 2: Verify `data/daily-targets.json`**

```bash
node --input-type=module -e "
import fs from 'fs';
const t = JSON.parse(fs.readFileSync('data/daily-targets.json', 'utf8'));
console.log('date:', t.date);
console.log('gmb count:', t.gmb.length);
console.log('instagram count:', t.instagram.length);
console.log('\\nFirst GMB message:');
console.log(t.gmb[0]?.message);
console.log('chars:', t.gmb[0]?.message?.length);
"
```

Expected: `gmb count: 10` (or however many enriched clinics exist), message under 160 chars.

- [ ] **Step 3: Verify morning brief includes GMB section**

```bash
node --input-type=module -e "
import { buildBrief } from './src/cli/sendMorningBrief.js';
const brief = await buildBrief();
const hasGMB = brief.includes('GMB MESSAGES');
const hasIG = brief.includes('INSTAGRAM');
console.log('Has GMB section:', hasGMB);
console.log('Has Instagram section:', hasIG);
// Print just the GMB section
const lines = brief.split('\n');
const start = lines.findIndex(l => l.includes('GMB MESSAGES'));
if (start !== -1) lines.slice(start, start + 15).forEach(l => console.log(l));
"
```

Expected: `Has GMB section: true`, followed by the first few GMB target lines.

- [ ] **Step 4: Test markGMBSent with the first result**

```bash
node --input-type=module -e "
import fs from 'fs';
const t = JSON.parse(fs.readFileSync('data/daily-targets.json', 'utf8'));
console.log('First clinic name:', t.gmb[0]?.clinicName);
"
```

Then mark it (replace `<NAME>` with the clinic name printed above):

```bash
node src/cli/markGMBSent.js "<NAME>"
```

Expected: `✓ Marked GMB sent: <Name> (<City>)`

Then verify:

```bash
node --input-type=module -e "
import fs from 'fs';
const d = JSON.parse(fs.readFileSync('data/outreach.localDentists.json', 'utf8'));
const t = JSON.parse(fs.readFileSync('data/daily-targets.json', 'utf8'));
const name = t.gmb[0]?.clinicName;
const clinic = d.find(c => c.clinicName === name);
console.log('gmbContactedAt:', clinic?.gmbContactedAt);
console.log('gmbMessage:', clinic?.gmbMessage?.slice(0, 80));
"
```

Expected: `gmbContactedAt` is a non-null ISO timestamp.

- [ ] **Step 5: Commit data file and final state**

```bash
git add src/cli/generateDailyTargets.js src/cli/markGMBSent.js src/cli/sendMorningBrief.js src/scheduler.js src/services/gmbEnricher.js
git commit -m "feat: GMB + Instagram outreach system — enricher, targets, brief, scheduler, markSent"
```

---

## Task 8 — Update `WHAT_WE_DID.md`

**Files:**
- Modify: `WHAT_WE_DID.md`

- [ ] **Step 1: Prepend new entry**

Read `WHAT_WE_DID.md` and add at the top:

```markdown
## 2026-05-13 — GMB + Instagram Outreach System

**What:** Full Google My Business enrichment pipeline + daily outreach target generator.

**Files added:**
- `src/services/gmbEnricher.js` — `enrichWithGMB()`, `enrichBatch()`, `findInstagram()`. Calls Google Places API (textsearch + details), scrapes clinic websites for Instagram handles, generates `personalDetail` via Claude Haiku.
- `src/cli/generateDailyTargets.js` — Runs at 07:00 daily. Picks 10 GMB + 10 Instagram targets, generates personalized copy-paste messages via Claude Haiku. Output: `data/daily-targets.json`.
- `src/cli/markGMBSent.js` — `node src/cli/markGMBSent.js "Clinic Name"` stamps `gmbContactedAt` to prevent re-contacting.

**Files modified:**
- `src/cli/sendMorningBrief.js` — Added GMB Messages + Instagram DMs sections after LinkedIn.
- `src/scheduler.js` — Added `gmbEnrich@06:30` (50 clinics/day) and `gmbTargets@07:00`.

**New schema fields on clinic records:** `placeId`, `googleMapsUrl`, `rating`, `reviewCount`, `hasMessaging`, `googlePhone`, `isOpen`, `openingHours`, `recentReviews`, `painSignals`, `painScore`, `instagramHandle`, `personalDetail`, `gmbEnrichedAt`, `gmbContactedAt`, `gmbMessage`.

**Note:** `hasMessaging` is approximate — Places API doesn't expose GMB messaging status directly. It's `true` when `business_status === 'OPERATIONAL'`. Verify the Message button before sending.
```

- [ ] **Step 2: Commit**

```bash
git add WHAT_WE_DID.md
git commit -m "docs: update WHAT_WE_DID with GMB + Instagram outreach system"
```

---

## Self-Review — Spec Coverage Check

| Spec section | Covered by |
|---|---|
| `enrichWithGMB(clinic)` returns all listed fields | Task 1 |
| `enrichBatch(clinics, limit=50)` skips enriched, rate-limits, saves | Task 1 |
| `findInstagram(clinic)` scrapes website for IG handle | Task 1 (exported) |
| Daily targets: 10 GMB + 10 Instagram | Task 2 |
| GMB message < 160 chars, references specific detail | Task 2 (`generateGMBMessage`) |
| Priority: pain signals → rating → reviewCount | Task 2 (sort order) |
| Salons included in Instagram pool | Task 2 (reads `outreach.salonBusinesses.json`) |
| `data/daily-targets.json` output format | Task 2 |
| Morning brief GMB section with Maps link + Why | Task 4 |
| Morning brief Instagram section | Task 4 |
| Action items updated with GMB + IG counts | Task 4 |
| Scheduler: enrichment @ 06:30 | Task 5 |
| Scheduler: target generation @ 07:00 | Task 5 |
| `markGMBSent.js` stamps `gmbContactedAt` + `gmbMessage` | Task 3 |
| First 100 clinic enrichment run | Task 6 |
| `generateDailyTargets` run + full output shown | Task 7 |
| Syntax check all new files | Tasks 1–5 (each has `--check` step) |
| `WHAT_WE_DID.md` updated | Task 8 |
| `personalDetail` in enricher | Task 1 (`generatePersonalDetail`) |
| Social links (FB, Twitter) secondary | Task 1 — **GAP**: spec mentions `socialLinks` array for secondary socials. Added to schema docs but not implemented. Low priority since spec only uses `instagramHandle`. ✅ acceptable scope cut — can add later. |
