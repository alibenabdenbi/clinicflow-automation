// src/linkedin/linkedinProspector.js
// Generates LinkedIn and Google search URLs for named dental clinic contacts.
// Does NOT make any HTTP requests — outputs ready-to-use search URLs for manual outreach.
//
// Usage:
//   node src/linkedin/linkedinProspector.js [--limit N] [--force]
//
// --limit N   Process at most N records (default: 100)
// --force     Re-process records already in prospects.json

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");

const OUTREACH_PATH = process.env.OUTREACH_JSON_PATH ||
  path.join(ROOT, "data", "outreach.localDentists.json");
const PROSPECTS_PATH = path.join(ROOT, "data", "linkedin", "prospects.json");

const LIMIT = (() => {
  const i = process.argv.indexOf("--limit");
  return i !== -1 ? Number(process.argv[i + 1]) : 100;
})();
const FORCE = process.argv.includes("--force");

function readJsonSafe(p, fb) {
  try { return JSON.parse(fs.readFileSync(p, "utf-8")); } catch { return fb; }
}

function writeJsonSafe(p, data) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(data, null, 2), "utf-8");
}

function cleanPersonName(raw) {
  return (raw || "").replace(/^Dr\.\s*/i, "").trim();
}

function buildUrls(personName, city) {
  const cityPart = city ? ` ${city}` : "";
  const googleQ  = encodeURIComponent(`site:linkedin.com/in "${personName}" dentist${cityPart}`);
  const liKw     = encodeURIComponent(`${personName} dentist${cityPart}`);
  return {
    googleUrl:   `https://www.google.com/search?q=${googleQ}`,
    linkedinUrl: `https://www.linkedin.com/search/results/people/?keywords=${liKw}`,
  };
}

function buildConnectionMessage(personName, clinicName, { reviewPainScore = 0 } = {}) {
  const firstName = personName.split(/\s+/)[0] || "there";
  const clinic    = (clinicName || "your clinic").slice(0, 40);
  if (reviewPainScore >= 1) {
    const msg = `Hi ${firstName}, one of ${clinic}'s patients left a review about not hearing back — I help fix exactly that. Automated follow-up for missed calls, 5-day setup, no monthly fees. Worth connecting?`;
    if (msg.length <= 300) return msg;
  }
  const long = `Hi ${firstName}, I noticed ${clinic} doesn't have automated follow-up for missed calls — patients who call and don't reach you often book elsewhere. I help dental clinics fix this in 5 days, no monthly fees. Worth a quick look?`;
  if (long.length <= 300) return long;
  return `Hi ${firstName}, patients who call ${clinic} and don't reach anyone often book elsewhere. I automate the follow-up — 5-day setup, no monthly fees. Worth connecting?`;
}

const ANGLE = {
  todo:            "first touch",
  sent:            "parallel",
  followup_1_sent: "last push",
  followup_2_sent: "last push",
};

export async function enrichLinkedIn({ limit = LIMIT, force = FORCE } = {}) {
  const records  = readJsonSafe(OUTREACH_PATH, []);
  const existing = readJsonSafe(PROSPECTS_PATH, []);
  const existingKeys = new Set(existing.map(p => p.email || p.clinicName));

  const targets = records
    .filter(r => {
      if (!(r.rcdsoName || r.contactName)) return false;
      if (!["todo", "sent", "followup_1_sent", "followup_2_sent"].includes(r.status)) return false;
      if (!force && existingKeys.has(r.email || r.clinicName)) return false;
      const mkt = r.market || null;
      if (mkt && mkt !== "dental") return false;
      return true;
    })
    .slice(0, limit);

  if (targets.length === 0) {
    console.log("No new named records to enrich. Use --force to re-run all.");
    return existing;
  }

  console.log(`\nLinkedIn Enrichment — ${targets.length} records (limit ${limit})`);
  console.log("Generating search URLs (no HTTP requests)\n");

  const newProspects = targets.map(r => {
    const personName = cleanPersonName(r.rcdsoName || r.contactName);
    const city       = (r.city || "").split(",")[0].trim();
    const { googleUrl, linkedinUrl } = buildUrls(personName, city);
    const painScore  = r.reviewPainScore || 0;
    const painQuotes = r.reviewPainQuotes || [];
    const msg   = buildConnectionMessage(personName, r.clinicName, { reviewPainScore: painScore });
    const angle = ANGLE[r.status] || "outreach";
    const painFlag = painScore >= 1 ? ` ★pain` : "";

    console.log(`  ${personName.padEnd(28)} | ${(r.clinicName || "").slice(0, 30).padEnd(30)} | ${city.padEnd(16)} | [${angle}]${painFlag}`);

    return {
      clinicName:        r.clinicName     || "",
      email:             r.email          || "",
      city:              r.city           || "",
      province:          r.province       || "",
      status:            r.status         || "",
      angle,
      personName,
      reviewPainScore:   painScore,
      reviewPainQuotes:  painQuotes,
      googleUrl,
      linkedinUrl,
      connectionMessage: msg,
      enrichedAt:        new Date().toISOString(),
      connectionSent:    false,
      followUpSent:      false,
    };
  });

  const all = [...existing, ...newProspects];
  writeJsonSafe(PROSPECTS_PATH, all);
  console.log(`\nEnriched: ${newProspects.length} new  |  Total in prospects.json: ${all.length}`);
  console.log(`Saved → ${PROSPECTS_PATH}`);
  return all;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  enrichLinkedIn()
    .then(() => process.exit(0))
    .catch(e => { console.error(e.message); process.exit(1); });
}
