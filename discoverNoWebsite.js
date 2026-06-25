// discoverNoWebsite.js
// Discover dental clinics with NO website (or only social/placeholder URLs) via Overpass/OSM.
// These are prospects for the ClinicFlow Digital offer (website + automation package).
//
// Usage: node discoverNoWebsite.js ["City"] ["Province"]
//        node discoverNoWebsite.js "Toronto" "ON"
//        node discoverNoWebsite.js              ← rotates through cities automatically
//
// Output: data/outreach.noWebsiteClinics.json

import fs from "fs";
import path from "path";

const OUT_PATH   = path.join(process.cwd(), "data", "outreach.noWebsiteClinics.json");
const STATE_PATH = path.join(process.cwd(), "data", "local.nowebsite.state.json");
const TIMEOUT_MS = 30000;
const NOMINATIM_UA = "ClinicFlowAutomation/1.0 (contact@clinicflowautomation.com)";

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

const ROTATION = [
  ["Toronto",       "ON"],
  ["Mississauga",   "ON"],
  ["Brampton",      "ON"],
  ["Ottawa",        "ON"],
  ["Hamilton",      "ON"],
  ["Kitchener",     "ON"],
  ["London",        "ON"],
  ["Markham",       "ON"],
  ["Vaughan",       "ON"],
  ["Richmond Hill", "ON"],
  ["Montreal",      "QC"],
  ["Laval",         "QC"],
  ["Quebec City",   "QC"],
  ["Vancouver",     "BC"],
  ["Surrey",        "BC"],
  ["Burnaby",       "BC"],
  ["Calgary",       "AB"],
  ["Edmonton",      "AB"],
  ["Winnipeg",      "MB"],
  ["Halifax",       "NS"],
];

const OVERPASS_ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.nchc.org.tw/api/interpreter",
];

// Social / placeholder domains — these count as "no real website"
const PLACEHOLDER_DOMAINS = [
  "facebook.com", "fb.com", "instagram.com", "twitter.com", "linkedin.com",
  "yelp.com", "yellowpages.ca", "yellowpages.com",
  "google.com", "maps.google.com", "goo.gl",
  "booking.com", "healthgrades.com", "ratemds.com",
  "wix.com", "wixsite.com", "weebly.com", "godaddy.com",
];

function isPlaceholderOrNoWebsite(website) {
  if (!website || !website.trim()) return true;
  try {
    const { hostname } = new URL(website);
    const host = hostname.replace(/^www\./, "").toLowerCase();
    return PLACEHOLDER_DOMAINS.some((d) => host === d || host.endsWith("." + d));
  } catch {
    return true;
  }
}

function readJsonSafe(p, fallback) {
  try {
    if (!fs.existsSync(p)) return fallback;
    const r = JSON.parse(fs.readFileSync(p, "utf-8"));
    return r ?? fallback;
  } catch { return fallback; }
}

function writeJsonSafe(p, data) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(data, null, 2), "utf-8");
}

async function fetchText(url, opts = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { ...opts, signal: ctrl.signal });
    const text = await res.text();
    return { ok: res.ok, status: res.status, text };
  } catch (err) {
    return { ok: false, status: 0, text: "", error: err };
  } finally {
    clearTimeout(t);
  }
}

function isLikelyHtml(text) {
  return /^<!doctype|^<html/i.test((text || "").trim().slice(0, 100));
}

async function geocodeCity(city, prov) {
  const q = encodeURIComponent(`${city}, ${prov}, Canada`);
  const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${q}`;
  await sleep(1000); // Nominatim rate limit: max 1 req/sec
  const { ok, status, text } = await fetchText(url, {
    headers: {
      Accept: "application/json",
      "User-Agent": NOMINATIM_UA,
    },
  });
  if (!ok) throw new Error(`Nominatim failed (${status})`);
  const arr = JSON.parse(text);
  if (!arr?.length) throw new Error(`Nominatim 0 results: ${city} ${prov}`);
  const bbox = arr[0].boundingbox?.map(Number);
  if (!bbox || bbox.length !== 4) throw new Error("Nominatim missing boundingbox");
  const [south, north, west, east] = bbox;
  return { south, north, west, east };
}

/**
 * Overpass query that fetches dental clinics WITHOUT a website tag —
 * or with only a social/placeholder URL.
 * We query for amenity=dentist nodes/ways/relations that do NOT have a website tag.
 */
function buildNoWebsiteQuery({ south, west, north, east }) {
  const bbox = `${south},${west},${north},${east}`;
  // Two sets: (1) no website tag at all, (2) has website but it's a placeholder (hard to filter server-side, handled client-side)
  return `
[out:json][timeout:30];
(
  nwr["amenity"="dentist"][!"website"][!"contact:website"][!"url"](${bbox});
  nwr["amenity"="dentist"]["website"~"facebook\\.com|fb\\.com|instagram\\.com|yelp\\.com"](${bbox});
  nwr["healthcare"="dentist"][!"website"][!"contact:website"][!"url"](${bbox});
);
out center tags;`;
}

async function overpassFetch(query) {
  let lastErr = null;
  for (const endpoint of OVERPASS_ENDPOINTS) {
    const { ok, status, text } = await fetchText(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8", Accept: "application/json" },
      body: new URLSearchParams({ data: query }).toString(),
    });
    if (!ok) { lastErr = new Error(`Overpass HTTP ${status}`); continue; }
    if (isLikelyHtml(text)) { lastErr = new Error(`Overpass returned HTML from ${endpoint}`); continue; }
    try {
      const json = JSON.parse(text);
      return { endpoint, json };
    } catch { lastErr = new Error(`JSON parse failed from ${endpoint}`); continue; }
  }
  throw lastErr || new Error("All Overpass endpoints failed");
}

function extractField(tags, ...keys) {
  for (const k of keys) { if (tags[k]) return String(tags[k]).trim(); }
  return "";
}

function guessEmailsFromDomain(domain) {
  if (!domain) return [];
  return ["info", "contact", "hello", "admin"].map((p) => `${p}@${domain}`);
}

function pickCity(args) {
  const positional = args.filter((a) => !a.startsWith("--"));
  const cityArg = (positional[0] || "").trim();
  const provArg = (positional[1] || "").trim().toUpperCase();
  if (cityArg && provArg) return { city: cityArg, prov: provArg, rotated: false };
  const state = readJsonSafe(STATE_PATH, { rotationIndex: 0 });
  const idx = Number(state.rotationIndex || 0) % ROTATION.length;
  const [city, prov] = ROTATION[idx];
  writeJsonSafe(STATE_PATH, { rotationIndex: idx + 1 });
  return { city, prov, rotated: true };
}

async function main() {
  const { city, prov, rotated } = pickCity(process.argv.slice(2));
  console.log(`Discovering no-website clinics: ${city}, ${prov}${rotated ? " (rotated)" : ""}`);

  const existing = readJsonSafe(OUT_PATH, []);
  // Build dedup set from (name + city) and from email
  const nameSet = new Set(
    existing.map((r) => `${(r.clinicName || "").toLowerCase().trim()}|${(r.city || "").toLowerCase()}`)
  );
  const emailSet = new Set(
    existing.map((r) => (r.email || "").toLowerCase()).filter(Boolean)
  );

  const bbox = await geocodeCity(city, prov);
  const query = buildNoWebsiteQuery(bbox);
  const { endpoint, json } = await overpassFetch(query);

  const elements = Array.isArray(json?.elements) ? json.elements : [];
  console.log(`✅ Overpass OK from: ${endpoint}`);
  console.log(`Raw elements: ${elements.length}`);

  let added = 0;
  let skippedDup = 0;
  let skippedNoName = 0;

  for (const el of elements) {
    const tags = el.tags || {};
    const name = extractField(tags, "name", "brand", "operator", "name:en", "name:fr");
    if (!name) { skippedNoName++; continue; }

    const rawWebsite = extractField(tags, "website", "contact:website", "url");
    // If they DO have a real website, skip (not our target)
    if (rawWebsite && !isPlaceholderOrNoWebsite(rawWebsite)) continue;

    const nameKey = `${name.toLowerCase().trim()}|${city.toLowerCase()}`;
    if (nameSet.has(nameKey)) { skippedDup++; continue; }

    const email  = extractField(tags, "email", "contact:email");
    const phone  = extractField(tags, "phone", "contact:phone", "phone:mobile");
    const street = extractField(tags, "addr:street");
    const number = extractField(tags, "addr:housenumber");
    const addrFull = extractField(tags, "addr:full");
    const address = addrFull || (street ? `${number} ${street}`.trim() : "");

    const lat = el.lat ?? el.center?.lat ?? null;
    const lon = el.lon ?? el.center?.lon ?? null;

    // Guess emails from clinic name if no direct email
    const namePart = name.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 20);
    const guessedEmails = email ? [] : [
      `info@${namePart}dental.ca`,
      `contact@${namePart}dental.ca`,
    ];

    const method = email ? "email" : phone ? "phone" : "manual";

    const record = {
      clinicName:    name,
      website:       rawWebsite || null, // null = no website; could be facebook URL
      socialUrl:     (rawWebsite && isPlaceholderOrNoWebsite(rawWebsite)) ? rawWebsite : null,
      city,
      province:      prov,
      email:         email || null,
      guessedEmails,
      phone:         phone || null,
      address:       address || null,
      lat,
      lon,
      method,
      status:        "todo",
      market:        "nowebsite",
      source:        "overpass",
      discoveredAt:  new Date().toISOString(),
    };

    existing.push(record);
    nameSet.add(nameKey);
    if (email) emailSet.add(email.toLowerCase());
    added++;
  }

  writeJsonSafe(OUT_PATH, existing);

  console.log(`Skipped (no name):   ${skippedNoName}`);
  console.log(`Skipped (duplicate): ${skippedDup}`);
  console.log(`Added:               ${added}`);
  console.log(`Total no-website queue: ${existing.length}`);
  console.log(`Saved: ${OUT_PATH}`);
}

main().catch((e) => {
  console.error("❌ discoverNoWebsite failed:", e?.message || e);
  process.exit(1);
});
