// localBusinesses.js
// Discover local businesses via OpenStreetMap (Nominatim + Overpass).
// Supports multiple markets (dental, physio, legal, realestate) via --market flag.
// - No API keys
// - Works with: node localBusinesses.js "Toronto" "ON"
//               node localBusinesses.js "Toronto" "ON" --market physio
// - Saves results so we can enrich websites later.

import fs from "fs";
import path from "path";
import { getMarket } from "./src/config/markets.js";

const OUT_PATH = path.join(process.cwd(), "data", "local.businesses.json");
const STATE_PATH = path.join(process.cwd(), "data", "local.businesses.state.json");

const TIMEOUT_MS     = 45_000; // 45s client timeout > 30s server timeout — avoids client aborting before server responds
const RETRY_ATTEMPTS = 3;
const RETRY_DELAY_MS = 2_000;

const ROTATION = [
  // Ontario
  ["Toronto", "ON"],
  ["Mississauga", "ON"],
  ["Brampton", "ON"],
  ["Vaughan", "ON"],
  ["Ottawa", "ON"],
  ["Hamilton", "ON"],
  ["Kitchener", "ON"],
  ["London", "ON"],
  ["Markham", "ON"],
  ["Richmond Hill", "ON"],
  // Quebec
  ["Montreal", "QC"],
  ["Laval", "QC"],
  ["Longueuil", "QC"],
  ["Quebec City", "QC"],
  // British Columbia
  ["Vancouver", "BC"],
  ["Surrey", "BC"],
  ["Burnaby", "BC"],
  ["Victoria", "BC"],
  ["Richmond", "BC"],
  // Alberta
  ["Calgary", "AB"],
  ["Edmonton", "AB"],
  // Manitoba / Saskatchewan
  ["Winnipeg", "MB"],
  ["Saskatoon", "SK"],
  ["Regina", "SK"],
  // Atlantic
  ["Halifax", "NS"],
];

const OVERPASS_ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.nchc.org.tw/api/interpreter",
];

function readJsonSafe(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, "utf-8"));
  } catch {
    return fallback;
  }
}

function writeJsonSafe(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
}

function isLikelyHtml(text) {
  const t = (text || "").trim().slice(0, 200).toLowerCase();
  return t.startsWith("<!doctype") || t.startsWith("<html") || t.includes("<title>");
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchText(url, opts = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      ...opts,
      signal: ctrl.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) ORE-LeadDiscovery/1.0",
        "Accept-Language": "en-CA,en;q=0.9,fr-CA;q=0.8,fr;q=0.7",
        ...(opts.headers || {}),
      },
    });

    const text = await res.text();
    return { ok: res.ok, status: res.status, text };
  } catch (err) {
    // Translate the generic AbortError into a message that includes the URL.
    if (err.name === "AbortError" || err.message?.includes("aborted")) {
      throw new Error(`Request timed out after ${TIMEOUT_MS / 1000}s — ${url}`);
    }
    throw new Error(`Network error (${err.message}) — ${url}`);
  } finally {
    clearTimeout(t);
  }
}

/**
 * Wraps fetchText with up to RETRY_ATTEMPTS attempts and RETRY_DELAY_MS between them.
 * @param {string} label  — short name shown in logs e.g. "Nominatim" or "Overpass overpass-api.de"
 * @param {string} url
 * @param {object} opts
 */
async function fetchWithRetry(label, url, opts = {}) {
  let lastErr;
  for (let attempt = 1; attempt <= RETRY_ATTEMPTS; attempt++) {
    try {
      const result = await fetchText(url, opts);
      if (attempt > 1) console.log(`  ✓ ${label} succeeded on attempt ${attempt}`);
      return result;
    } catch (err) {
      lastErr = err;
      const willRetry = attempt < RETRY_ATTEMPTS;
      console.warn(
        `  ⚠ ${label} attempt ${attempt}/${RETRY_ATTEMPTS} failed: ${err.message}` +
        (willRetry ? ` — retrying in ${RETRY_DELAY_MS / 1000}s…` : " — giving up")
      );
      if (willRetry) await sleep(RETRY_DELAY_MS);
    }
  }
  throw lastErr;
}

async function geocodeCity(city, prov) {
  const q = encodeURIComponent(`${city}, ${prov}, Canada`);
  const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${q}`;

  console.log(`Geocoding: ${city}, ${prov}, Canada…`);
  const { ok, status, text } = await fetchWithRetry(
    `Nominatim [${city} ${prov}]`,
    url,
    { headers: { Accept: "application/json" } }
  );
  if (!ok) throw new Error(`Nominatim HTTP ${status} for "${city} ${prov}"`);

  const arr = JSON.parse(text);
  if (!arr?.length) throw new Error(`Nominatim found 0 results for: ${city} ${prov}`);

  const hit = arr[0];
  const bbox = hit.boundingbox?.map(Number);
  if (!bbox || bbox.length !== 4) throw new Error("Nominatim missing boundingbox");

  const [south, north, west, east] = bbox;
  return { south, north, west, east };
}

// All website-bearing tag keys (universal across markets)
const WEBSITE_TAG_KEYS = ["website", "contact:website", "url", "contact:url"];

/**
 * Build an Overpass query for a given market's OSM tag definitions.
 * osmTags is an array of { key, values[] } — see src/config/markets.js.
 */
function buildOverpassQuery({ south, west, north, east }, osmTags) {
  const bbox = `${south},${west},${north},${east}`;
  const lines = [];

  for (const { key, values } of osmTags) {
    for (const val of values) {
      for (const wtag of WEBSITE_TAG_KEYS) {
        lines.push(`  nwr["${key}"="${val}"]["${wtag}"](${bbox});`);
      }
    }
  }

  return `
[out:json][timeout:60];
(
${lines.join("\n")}
);
out center tags;`;
}

function extractWebsite(tags = {}) {
  // OSM has multiple variants people use
  const raw =
    tags.website ||
    tags["contact:website"] ||
    tags.url ||
    tags["contact:url"] ||
    tags["website:en"] ||
    tags["website:fr"] ||
    tags["brand:website"] ||
    tags["operator:website"] ||
    "";

  try {
    if (!raw) return "";
    let u = String(raw).trim();
    if (!u) return "";

    // Sometimes multiple URLs are separated by space/semicolon/comma
    u = u.split(/[,\s;]+/).filter(Boolean)[0] || "";
    if (!u) return "";

    if (!/^https?:\/\//i.test(u)) u = "https://" + u;

    const parsed = new URL(u);
    parsed.hash = "";
    // normalize trailing slash
    parsed.pathname = parsed.pathname.replace(/\/+$/, "");
    return parsed.origin;
  } catch {
    return "";
  }
}

function extractEmail(tags = {}) {
  const e = tags.email || tags["contact:email"] || "";
  return (e || "").trim();
}

function extractPhone(tags = {}) {
  const p = tags.phone || tags["contact:phone"] || tags["phone:mobile"] || "";
  return (p || "").trim();
}

function extractAddress(tags = {}) {
  const street = tags["addr:street"] || "";
  const number = tags["addr:housenumber"] || "";
  const full = tags["addr:full"] || "";
  if (full) return full.trim();
  if (street) return `${number} ${street}`.trim();
  return "";
}

// Websites that are placeholder / social / not a real clinic site
const PLACEHOLDER_DOMAINS = [
  "facebook.com", "fb.com", "instagram.com", "twitter.com", "linkedin.com",
  "wix.com", "wixsite.com", "weebly.com", "squarespace.com",
  "godaddy.com", "siteground.com",
  "yelp.com", "yellowpages.ca", "yellowpages.com",
  "google.com", "maps.google.com",
  "booking.com", "healthgrades.com", "ratemds.com",
];

function isPlaceholderWebsite(website) {
  if (!website) return true;
  try {
    const { hostname } = new URL(website);
    const host = hostname.replace(/^www\./, "").toLowerCase();
    return PLACEHOLDER_DOMAINS.some((d) => host === d || host.endsWith("." + d));
  } catch {
    return true;
  }
}

/**
 * Quality score for a clinic record.
 * +1 has a real website, +1 has a real email, +1 has phone, +1 has address.
 * Max 4.
 */
function clinicQualityScore({ website, email, phone, address }) {
  let q = 0;
  if (website && !isPlaceholderWebsite(website)) q++;
  if (email && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) q++;
  if (phone) q++;
  if (address) q++;
  return q;
}

function stableKey({ website, name, lat, lon, city, prov }) {
  // If we have a website, that’s the best key.
  if (website) return `site:${website.toLowerCase()}`;
  // Otherwise use a fallback key so we can still store them uniquely.
  const n = (name || "").toLowerCase().replace(/\s+/g, " ").trim();
  const la = lat != null ? String(lat) : "";
  const lo = lon != null ? String(lon) : "";
  return `place:${n}|${city}|${prov}|${la}|${lo}`;
}

async function overpassFetch(query) {
  let lastErr = null;

  for (const endpoint of OVERPASS_ENDPOINTS) {
    const label = `Overpass [${new URL(endpoint).hostname}]`;
    const opts = {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        Accept: "application/json",
      },
      body: new URLSearchParams({ data: query }).toString(),
    };

    // Retry loop per endpoint — covers network failures AND 5xx (504, 502, 503).
    let ok, status, text;
    let endpointFailed = false;
    for (let attempt = 1; attempt <= RETRY_ATTEMPTS; attempt++) {
      try {
        ({ ok, status, text } = await fetchText(endpoint, opts));
      } catch (err) {
        lastErr = new Error(`${label} attempt ${attempt}/${RETRY_ATTEMPTS}: ${err.message}`);
        const willRetry = attempt < RETRY_ATTEMPTS;
        console.warn(`  ⚠ ${label} attempt ${attempt}/${RETRY_ATTEMPTS} failed: ${err.message}` +
          (willRetry ? ` — retrying in ${RETRY_DELAY_MS / 1000}s…` : " — giving up"));
        if (willRetry) { await sleep(RETRY_DELAY_MS); continue; }
        endpointFailed = true;
        break;
      }

      // Retry server-side errors (502, 503, 504) the same as network failures.
      if (!ok && status >= 500) {
        lastErr = new Error(`Overpass HTTP ${status} from ${endpoint}`);
        const willRetry = attempt < RETRY_ATTEMPTS;
        console.warn(`  ⚠ ${label} attempt ${attempt}/${RETRY_ATTEMPTS}: HTTP ${status}` +
          (willRetry ? ` — retrying in ${RETRY_DELAY_MS / 1000}s…` : " — giving up"));
        if (willRetry) { await sleep(RETRY_DELAY_MS); continue; }
        endpointFailed = true;
        break;
      }

      break; // got a non-5xx response — proceed to parse
    }
    if (endpointFailed) {
      console.warn(`  Skipping endpoint ${endpoint} after all retries failed.`);
      continue;
    }

    if (!ok) {
      lastErr = new Error(`Overpass HTTP ${status} from ${endpoint}`);
      console.warn(`  ⚠ ${label}: HTTP ${status} — trying next endpoint`);
      continue;
    }
    if (isLikelyHtml(text)) {
      lastErr = new Error(`Overpass returned HTML (rate-limited?) from ${endpoint}`);
      console.warn(`  ⚠ ${label}: returned HTML, not JSON — trying next endpoint`);
      continue;
    }

    try {
      const json = JSON.parse(text);
      return { endpoint, json };
    } catch {
      lastErr = new Error(`Overpass JSON parse failed from ${endpoint}`);
      console.warn(`  ⚠ ${label}: JSON parse failed — trying next endpoint`);
      continue;
    }
  }
  throw lastErr || new Error("Overpass failed: all 3 endpoints exhausted");
}

function pickCityProvFromArgsOrRotation() {
  // Support: node localBusinesses.js "Toronto" "ON" [--market physio]
  const args = process.argv.slice(2);
  const marketFlagIdx = args.indexOf("--market");
  const marketKey = marketFlagIdx !== -1 ? (args[marketFlagIdx + 1] || "dental") : "dental";

  // Filter out --market and its value to get positional args
  const positional = args.filter((a, i) => {
    if (a === "--market") return false;
    if (i > 0 && args[i - 1] === "--market") return false;
    return true;
  });

  const cityArg = (positional[0] || "").trim();
  const provArg = (positional[1] || "").trim().toUpperCase();

  if (cityArg && provArg) return { city: cityArg, prov: provArg, rotated: false, marketKey };

  const state = readJsonSafe(STATE_PATH, { rotationIndex: 0 });
  const idx = Number(state.rotationIndex || 0) % ROTATION.length;
  const [city, prov] = ROTATION[idx];
  writeJsonSafe(STATE_PATH, { rotationIndex: idx + 1 });

  return { city, prov, rotated: true, marketKey };
}

async function main() {
  const { city, prov, rotated, marketKey } = pickCityProvFromArgsOrRotation();
  const market = getMarket(marketKey);

  const existing = readJsonSafe(OUT_PATH, []);
  const existingSet = new Set(
    existing
      .filter((x) => x.website)
      .map((x) => `site:${(x.website || "").toLowerCase().trim()}`)
  );

  console.log(`Market: ${market.label} (${marketKey})`);
  console.log(`Query: ${marketKey} ${city} ${prov}${rotated ? " (rotated)" : ""}`);

  const bbox = await geocodeCity(city, prov);
  const q = buildOverpassQuery(bbox, market.osmTags);

  const { endpoint, json } = await overpassFetch(q);

  const elements = Array.isArray(json?.elements) ? json.elements : [];
  console.log(`✅ Overpass OK from: ${endpoint}`);
  console.log(`Found (raw elements): ${elements.length}`);

  let addedTotal = 0;
  let addedWithWebsite = 0;

  // Secondary dedup: track name+city combos to prevent same clinic via different OSM nodes
  const nameSet = new Set(
    existing.map((x) => `${(x.name || "").toLowerCase().trim()}|${(x.city || "").toLowerCase()}`)
  );

  let skippedPlaceholder = 0;
  let skippedQuality = 0;
  let skippedDup = 0;

  for (const el of elements) {
    const tags = el.tags || {};
    // Try real name sources in priority order; skip generic/empty fallbacks
    const name = String(
      tags.name || tags.brand || tags.operator || tags["name:en"] || tags["name:fr"] || ""
    ).trim() || null;
    if (!name) continue; // skip unnamed entries — domain-slug names are useless
    const email = extractEmail(tags);
    const phone = extractPhone(tags);
    const address = extractAddress(tags);

    const lat = el.lat ?? el.center?.lat ?? null;
    const lon = el.lon ?? el.center?.lon ?? null;
    const website = extractWebsite(tags);

    // Skip placeholder websites (Facebook, Wix, Yelp, etc.)
    if (isPlaceholderWebsite(website)) {
      skippedPlaceholder++;
      continue;
    }

    // Quality gate: need at least website + 1 other signal
    const quality = clinicQualityScore({ website, email, phone, address });
    if (quality < 2) {
      skippedQuality++;
      continue;
    }

    // URL-based dedup
    const urlKey = `site:${website.toLowerCase()}`;
    if (existingSet.has(urlKey)) { skippedDup++; continue; }

    // Name+city dedup
    const nameKey = `${name.toLowerCase().trim()}|${city.toLowerCase()}`;
    if (nameSet.has(nameKey)) { skippedDup++; continue; }

    existing.push({
      name,
      website,
      email: email || "",
      phone: phone || "",
      address: address || "",
      city,
      province: prov,
      market: marketKey,
      qualityScore: quality,
      source: "overpass",
      osmType: el.type || "",
      osmId: el.id || null,
      lat,
      lon,
      foundAt: new Date().toISOString(),
      query: `${marketKey} ${city} ${prov}`,
    });

    existingSet.add(urlKey);
    nameSet.add(nameKey);
    addedTotal++;
    addedWithWebsite++;
  }

  console.log(`Skipped (placeholder website): ${skippedPlaceholder}`);
  console.log(`Skipped (quality < 2): ${skippedQuality}`);
  console.log(`Skipped (duplicate): ${skippedDup}`);

  writeJsonSafe(OUT_PATH, existing);

  console.log(`Added total new places: ${addedTotal}`);
  console.log(`Added with website: ${addedWithWebsite}`);
  console.log(`Saved: ${OUT_PATH}`);
  console.log(`Total saved now: ${existing.length}`);
}

main().catch((e) => {
  console.error("❌ localBusinesses failed:", e?.message || e);
  process.exit(1);
});