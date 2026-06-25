// src/cli/resolveWebsites.js
// Fill missing websites in data/local.businesses.json using DuckDuckGo HTML (no API key).
// Usage:
//   node src/cli/resolveWebsites.js
// Env:
//   DISCOVERED_JSON_PATH=data/local.businesses.json
//   RESOLVE_MAX=200
//   RESOLVE_DELAY_MS=1200

import fs from "fs";
import path from "path";
import dotenv from "dotenv";

dotenv.config();

const DISCOVERED_PATH =
  process.env.DISCOVERED_JSON_PATH ||
  path.join(process.cwd(), "data", "local.businesses.json");

const RESOLVE_MAX = Number(process.env.RESOLVE_MAX || "200");
const DELAY_MS = Number(process.env.RESOLVE_DELAY_MS || "1200");

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function readJsonSafe(filePath, fallback = []) {
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

function cleanOrigin(u) {
  try {
    const url = new URL(/^https?:\/\//i.test(u) ? u : `https://${u}`);
    url.hash = "";
    return url.origin;
  } catch {
    return "";
  }
}

function looksBadDomain(origin) {
  const d = origin.replace(/^https?:\/\//i, "").toLowerCase();

  // directories/socials we DON'T want as "clinic website"
  const bad = [
    "facebook.com",
    "instagram.com",
    "linkedin.com",
    "yelp.",
    "yellowpages.",
    "411.ca",
    "canada247.info",
    "opencare.com",
    "ratemd.ca",
    "dentistfind.com",
    "safedental.",
    "wordpress.com",
    "wixsite.com",
    "goo.gl",
    "bit.ly",
    "t.co",
  ];

  return bad.some((x) => d.includes(x));
}

async function fetchText(url) {
  const res = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) ORE-Resolver/1.0",
      "Accept-Language": "en-CA,en;q=0.9,fr-CA;q=0.8,fr;q=0.7",
    },
    redirect: "follow",
  });
  const text = await res.text();
  return { ok: res.ok, status: res.status, text };
}

// Very small HTML parsing without extra libs
function extractFirstResultUrl(ddgHtml) {
  // DuckDuckGo html results often contain links like: <a rel="nofollow" class="result__a" href="...">
  const re = /class="result__a"[^>]*href="([^"]+)"/i;
  const m = ddgHtml.match(re);
  if (!m) return "";
  let href = m[1];

  // DDG sometimes gives direct URL, sometimes a redirect wrapper.
  // Handle redirect wrapper: /l/?uddg=<encoded>
  try {
    if (href.startsWith("/l/?")) {
      const u = new URL("https://duckduckgo.com" + href);
      const uddg = u.searchParams.get("uddg");
      if (uddg) href = decodeURIComponent(uddg);
    }
  } catch {}

  return href;
}

async function resolveOne(name, city, province) {
  const q = encodeURIComponent(`${name} dentist ${city} ${province} official website`);
  const url = `https://duckduckgo.com/html/?q=${q}`;

  const { ok, status, text } = await fetchText(url);
  if (!ok) return { website: "", error: `DDG HTTP ${status}` };

  const first = extractFirstResultUrl(text);
  if (!first) return { website: "", error: "No result found" };

  const origin = cleanOrigin(first);
  if (!origin) return { website: "", error: "Bad URL" };
  if (looksBadDomain(origin)) return { website: "", error: "Directory/social domain" };

  return { website: origin, error: "" };
}

async function main() {
  const items = readJsonSafe(DISCOVERED_PATH, []);
  if (!Array.isArray(items) || items.length === 0) {
    console.log("No discovered items found at:", DISCOVERED_PATH);
    process.exit(0);
  }

  // target: missing website
  const targets = items
    .map((x, idx) => ({ x, idx }))
    .filter(({ x }) => !String(x.website || "").trim())
    .slice(0, RESOLVE_MAX);

  console.log(`Resolving websites for ${targets.length} item(s) (max ${RESOLVE_MAX})`);
  console.log("File:", DISCOVERED_PATH);

  let filled = 0;

  for (const { x, idx } of targets) {
    const name = String(x.name || x.clinicName || "Dental Clinic").trim();
    const city = String(x.city || "").trim();
    const prov = String(x.province || x.state || "").trim();

    process.stdout.write(`\n• ${name} — ${city} ${prov}\n`);

    try {
      const { website, error } = await resolveOne(name, city, prov);
      if (website) {
        items[idx].website = website;
        items[idx].resolvedWebsiteAt = new Date().toISOString();
        delete items[idx].resolveError;
        filled++;
        console.log("  ✓ website:", website);
      } else {
        items[idx].resolveError = error || "not found";
        console.log("  - website:", items[idx].resolveError);
      }
    } catch (e) {
      items[idx].resolveError = e?.message || String(e);
      console.log("  ✗ error:", items[idx].resolveError);
    }

    await sleep(DELAY_MS);
  }

  writeJsonSafe(DISCOVERED_PATH, items);
  console.log(`\nDone. Filled ${filled} website(s). Saved -> ${DISCOVERED_PATH}`);
}

main().catch((e) => {
  console.error("Resolve failed:", e?.message || e);
  process.exit(1);
});