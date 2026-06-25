// src/cli/extractEmailsFromPlaces.js
// For clinics with no email: use Google Places API to find website + phone,
// then scrape the website for emails. Saves googlePhone for Twilio targeting.
//
// Usage:
//   node src/cli/extractEmailsFromPlaces.js [--limit 100] [--market dental|physio]

import fs from "fs";
import https from "https";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import fetch from "node-fetch";
import { findBestEmailWithConfidence } from "../processors/emailFinder.js";

// Windows corporate cert stores sometimes can't verify Google's leaf cert
const tlsAgent = new https.Agent({ rejectUnauthorized: false });

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT      = path.resolve(__dirname, "../..");
const DATA_DIR  = path.join(ROOT, "data");

const GOOGLE_KEY = (process.env.GOOGLE_PLACES_API_KEY || "").trim();
if (!GOOGLE_KEY || GOOGLE_KEY === "your_key_here") {
  console.error("GOOGLE_PLACES_API_KEY not set in .env"); process.exit(1);
}

const LIMIT_ARG = (() => {
  const i = process.argv.indexOf("--limit");
  return i !== -1 ? Number(process.argv[i + 1]) : 100;
})();

const MARKET_ARG = (() => {
  const i = process.argv.indexOf("--market");
  return i !== -1 ? process.argv[i + 1] : "dental";
})();

const QUEUE_PATHS = {
  dental: path.join(DATA_DIR, "outreach.localDentists.json"),
  physio: path.join(DATA_DIR, "outreach.physioClinics.json"),
};
const OUTREACH_PATH = QUEUE_PATHS[MARKET_ARG] || QUEUE_PATHS.dental;

function readJsonSafe(p, fb) {
  try { if (!fs.existsSync(p)) return fb; return JSON.parse(fs.readFileSync(p, "utf-8")); }
  catch { return fb; }
}
function writeJsonSafe(p, data) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(data, null, 2), "utf-8");
}
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

const MARKET_KEYWORDS = { dental: "dental", physio: "physiotherapy" };

async function searchPlace(clinicName, city) {
  const keyword = MARKET_KEYWORDS[MARKET_ARG] || MARKET_ARG;
  const q = encodeURIComponent(`${clinicName} ${city || ""} ${keyword}`);

  // Step 1: find place_id (findplacefromtext only supports basic fields)
  const findUrl = `https://maps.googleapis.com/maps/api/place/findplacefromtext/json?input=${q}&inputtype=textquery&fields=place_id,name&key=${GOOGLE_KEY}`;
  let placeId;
  try {
    const res = await fetch(findUrl, { signal: AbortSignal.timeout(8_000), agent: tlsAgent });
    const json = await res.json();
    if (json.status !== "OK" || !json.candidates?.[0]?.place_id) return null;
    placeId = json.candidates[0].place_id;
  } catch { return null; }

  // Step 2: fetch website + phone from Place Details
  const detailUrl = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${placeId}&fields=name,formatted_phone_number,website&key=${GOOGLE_KEY}`;
  try {
    const res = await fetch(detailUrl, { signal: AbortSignal.timeout(8_000), agent: tlsAgent });
    const json = await res.json();
    if (json.status === "OK" && json.result) return json.result;
  } catch {}
  return null;
}

async function main() {
  const records = readJsonSafe(OUTREACH_PATH, []);
  const targets = records
    .map((r, idx) => ({ r, idx }))
    .filter(({ r }) => !r.email && (r.status || "todo") === "todo")
    .slice(0, LIMIT_ARG);

  console.log(`\nGoogle Places Email Extractor — ${MARKET_ARG}`);
  console.log(`Targets: ${targets.length} clinics with no email`);
  console.log(`Limit: ${LIMIT_ARG}`);

  let emailsFound = 0, phonesFound = 0, websitesFound = 0;

  for (let i = 0; i < targets.length; i++) {
    const { r, idx } = targets[i];
    const label = `[${String(i + 1).padStart(String(targets.length).length)}/${targets.length}]`;
    process.stdout.write(`${label} ${(r.clinicName || "").slice(0, 45).padEnd(45)}`);

    const place = await searchPlace(r.clinicName, r.city || "");

    if (!place) { console.log(" — not found"); continue; }

    let updated = false;

    // Save Google phone if we don't have any phone
    if (place.formatted_phone_number && !r.phone && !r.googlePhone) {
      records[idx].googlePhone = place.formatted_phone_number;
      phonesFound++;
      updated = true;
    }

    // Save/update website if Places has one we don't
    const placeWebsite = place.website || "";
    if (placeWebsite && !r.website) {
      records[idx].website = placeWebsite;
      websitesFound++;
      updated = true;
    }

    // Scrape email from the website (use Places website if available, else existing)
    const websiteToScrape = placeWebsite || r.website;
    if (websiteToScrape) {
      try {
        const { email, confidence, source, contactName } = await findBestEmailWithConfidence(websiteToScrape, {
          clinicName: r.clinicName || "",
          city: r.city || "",
          useDdgFallback: false,
          useHunter: false,
        });
        if (email) {
          records[idx].email           = email;
          records[idx].emailConfidence  = confidence;
          records[idx].emailSource      = source || "places+website";
          records[idx].enrichedAt       = new Date().toISOString();
          if (contactName) records[idx].contactName = contactName;
          emailsFound++;
          updated = true;
          process.stdout.write(` ✓ ${confidence} ${email}${place.formatted_phone_number ? " 📞" : ""}\n`);
        } else {
          process.stdout.write(` — no email${place.formatted_phone_number ? " 📞 phone saved" : ""}\n`);
        }
      } catch {
        process.stdout.write(` — scrape error\n`);
      }
    } else {
      process.stdout.write(` — no website\n`);
    }

    if (!updated) continue;

    // Save progress every 10
    if ((i + 1) % 10 === 0) {
      writeJsonSafe(OUTREACH_PATH, records);
      console.log(`  [progress saved — ${i + 1}/${targets.length}]`);
    }

    await sleep(400);
  }

  writeJsonSafe(OUTREACH_PATH, records);

  console.log(`\n${"─".repeat(50)}`);
  console.log(`  Google Places extraction complete`);
  console.log(`  Emails found:    ${emailsFound}`);
  console.log(`  Phones found:    ${phonesFound}`);
  console.log(`  Websites added:  ${websitesFound}`);
  console.log(`  Saved → ${OUTREACH_PATH}`);
}

main().catch(e => { console.error("Failed:", e.message); process.exit(1); });
