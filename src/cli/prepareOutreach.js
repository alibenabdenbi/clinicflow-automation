// src/cli/prepareOutreach.js
// Unified outreach preparation pipeline.
// Scores personalization level for each clinic and assigns an outreachPlan.
// Runs before send:batch to prioritize and route each clinic correctly.
//
// Personalization levels:
//   HIGH   — personal cell + review pain signal  → ringless voicemail first, then email
//   HIGH   — named email + pain signal           → personalized email (review quote)
//   MEDIUM — named email, no pain signal         → standard email with credibility line
//   MEDIUM — generic email only                  → standard email sequence
//   LOW    — phone only                          → Twilio call only
//
// Usage:
//   node src/cli/prepareOutreach.js
//   node src/cli/prepareOutreach.js --limit 30
//   node src/cli/prepareOutreach.js --dry-run

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { execFile } from "child_process";
import dotenv from "dotenv";

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const DATA_DIR = path.join(ROOT, "data");

const args = process.argv.slice(2);
const DRY_RUN   = args.includes("--dry-run");
const limitIdx  = args.indexOf("--limit");
const LIMIT     = limitIdx !== -1 ? Number(args[limitIdx + 1]) : 30;
const marketIdx = args.indexOf("--market");
const MARKET    = marketIdx !== -1 ? args[marketIdx + 1] : "dental";

const QUEUE_PATHS = {
  dental: path.join(DATA_DIR, "outreach.localDentists.json"),
  physio: path.join(DATA_DIR, "outreach.physioClinics.json"),
};
const OUTREACH_PATH = QUEUE_PATHS[MARKET] || QUEUE_PATHS.dental;

function readJsonSafe(p, fb) {
  try { if (!fs.existsSync(p)) return fb; return JSON.parse(fs.readFileSync(p, "utf-8")); }
  catch { return fb; }
}

function writeJsonSafe(p, data) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(data, null, 2), "utf-8");
}

// Heuristic: is the email address named (person's name) vs generic?
function isNamedEmail(email) {
  if (!email) return false;
  const local = email.split("@")[0].toLowerCase().replace(/[.\-_+]/g, "");
  const GENERIC = new Set([
    "info","contact","admin","hello","office","reception","mail","support",
    "team","clinic","dental","dentistry","care","booking","bookings","staff",
    "billing","front","desk","noreply","donotreply","no-reply","manager",
    "gestion","direction","accueil","clinique","secretariat","soins","rdv",
    "appointments","appointment","enquiry","inquiry","general","patients",
  ]);
  if (GENERIC.has(local)) return false;
  if (/\d/.test(local)) return false;
  if (local.length <= 3) return false;
  // Must look like a name: two parts separated by a dot/hyphen OR a single name ≥4 chars
  if (/^[a-z]{4,}$/.test(local)) return true;
  if (/^[a-z]{2,}\.[a-z]{2,}$/.test(local)) return true;
  return false;
}

function assignPlan(l) {
  const painScore      = l.reviewPainScore || 0;
  const personalScore  = l.personalPhoneScore || 0;
  const hasPersonalCell = personalScore >= 7;
  const hasPhone        = !!(l.phone || l.personalPhone);
  const hasEmail        = !!(l.email);
  const named           = isNamedEmail(l.email);
  const hasAudio        = !!(l.voicemailAudioPath);
  const bookingSoftware = l.bookingSoftware || null;
  const opportunityScore = l.opportunityScore || 0;

  // HIGH — personal cell + review pain signal
  if (hasPersonalCell && painScore >= 2) {
    return {
      personalizationLevel: "HIGH",
      primaryChannel:       hasAudio ? "ringless_voicemail" : "email",
      secondaryChannel:     "email",
      voiceCall:            true,
      scriptType:           1,
      readyToSend:          true,
    };
  }

  // HIGH — named email + pain signal
  if (named && painScore >= 2) {
    return {
      personalizationLevel: "HIGH",
      primaryChannel:       "email",
      secondaryChannel:     hasPhone ? "call" : null,
      voiceCall:            hasPhone,
      scriptType:           1,
      readyToSend:          true,
    };
  }

  // MEDIUM-HIGH — named email + booking software
  if (named && bookingSoftware) {
    return {
      personalizationLevel: "MEDIUM-HIGH",
      primaryChannel:       "email",
      secondaryChannel:     hasPhone ? "call" : null,
      voiceCall:            hasPhone,
      scriptType:           3,
      readyToSend:          true,
    };
  }

  // MEDIUM — named email (no pain signal)
  if (named && hasEmail) {
    return {
      personalizationLevel: "MEDIUM",
      primaryChannel:       "email",
      secondaryChannel:     hasPhone ? "call" : null,
      voiceCall:            hasPhone,
      scriptType:           opportunityScore >= 7 ? 2 : 4,
      readyToSend:          true,
    };
  }

  // MEDIUM — generic email
  if (hasEmail) {
    return {
      personalizationLevel: "MEDIUM",
      primaryChannel:       "email",
      secondaryChannel:     hasPhone ? "call" : null,
      voiceCall:            hasPhone,
      scriptType:           4,
      readyToSend:          true,
    };
  }

  // LOW — phone only
  if (hasPhone) {
    return {
      personalizationLevel: "LOW",
      primaryChannel:       "call",
      secondaryChannel:     null,
      voiceCall:            true,
      scriptType:           4,
      readyToSend:          true,
    };
  }

  // No contact info
  return {
    personalizationLevel: "NONE",
    primaryChannel:       null,
    secondaryChannel:     null,
    voiceCall:            false,
    scriptType:           null,
    readyToSend:          false,
  };
}

// Score for sorting — higher = more personalized = process first
function planSortScore(plan) {
  const levels = { HIGH: 100, "MEDIUM-HIGH": 75, MEDIUM: 50, LOW: 25, NONE: 0 };
  return levels[plan.personalizationLevel] || 0;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

const leads = readJsonSafe(OUTREACH_PATH, []);

// Load tech-stack for bookingSoftware enrichment
const techStack = readJsonSafe(path.join(DATA_DIR, "intelligence", "tech-stack.json"), {});
const techClinics = techStack.clinics || [];
const techByName = {};
for (const t of techClinics) {
  if (t.clinicName) techByName[t.clinicName.toLowerCase().slice(0, 30)] = t;
}

// Non-dental market values — skip when running dental prep
const NON_DENTAL_MARKETS = new Set(["physio", "chiro", "optometry", "massage", "other"]);

// Target: todo clinics without an outreachPlan, filtered by market
const targets = leads
  .map((l, idx) => ({ l, idx }))
  .filter(({ l }) => {
    if ((l.status || "todo") !== "todo") return false;
    if (l.outreachPlanAt) return false;
    if (MARKET === "dental" && NON_DENTAL_MARKETS.has(l.market)) return false;
    return true;
  })
  .slice(0, LIMIT);

console.log(`\nOutreach Preparation Pipeline`);
console.log(`Mode: ${DRY_RUN ? "dry-run" : "live"} | Limit: ${LIMIT}`);
console.log(`Targets: ${targets.length} clinics without outreachPlan\n`);

const counts = { HIGH: 0, "MEDIUM-HIGH": 0, MEDIUM: 0, LOW: 0, NONE: 0 };
const highVoiceList = [];

for (const { l, idx } of targets) {
  // Enrich with tech-stack data
  const techKey = (l.clinicName || "").toLowerCase().slice(0, 30);
  const tech = techByName[techKey] || {};
  const enriched = {
    ...l,
    bookingSoftware: l.bookingSoftware || tech.bookingSoftware || null,
    opportunityScore: l.opportunityScore || tech.opportunityScore || 0,
  };

  const plan = assignPlan(enriched);
  counts[plan.personalizationLevel] = (counts[plan.personalizationLevel] || 0) + 1;

  const label = plan.personalizationLevel.padEnd(12);
  const primary = (plan.primaryChannel || "none").padEnd(20);
  console.log(`  ${label} | ${primary} | ${(l.clinicName || "").slice(0, 40)}`);

  if (!DRY_RUN) {
    leads[idx].outreachPlan    = plan;
    leads[idx].outreachPlanAt  = new Date().toISOString();
    // Carry bookingSoftware enrichment back to record if found from tech-stack
    if (tech.bookingSoftware && !l.bookingSoftware) leads[idx].bookingSoftware = tech.bookingSoftware;
    if (tech.opportunityScore && !l.opportunityScore) leads[idx].opportunityScore = tech.opportunityScore;
  }

  // Flag HIGH clinics needing voice generation
  if (plan.personalizationLevel === "HIGH" && !l.voicemailAudioPath && (l.phone || l.personalPhone)) {
    highVoiceList.push(l.clinicName);
  }
}

// ── Second pass: flag emailed clinics with phones for voice follow-up ─────────
// Any clinic that received at least 1 email and has a phone but no voiceCall flag
const EMAILED_STATUSES = new Set(["sent", "followup_1_sent", "followup_2_sent", "followup_3_sent"]);
let voiceFlagCount = 0;
for (let i = 0; i < leads.length; i++) {
  const l = leads[i];
  if (!EMAILED_STATUSES.has(l.status)) continue;
  const hasPhone = !!(l.phone || l.rcdsoPhone || l.personalPhone);
  if (!hasPhone) continue;
  if (l.outreachPlan?.voiceCall === true) continue; // already flagged
  if (!DRY_RUN) {
    if (!leads[i].outreachPlan) leads[i].outreachPlan = {};
    leads[i].outreachPlan.voiceCall = true;
  }
  voiceFlagCount++;
}
if (voiceFlagCount > 0) {
  console.log(`  Voice-flagged ${voiceFlagCount} emailed clinic(s) with phones for Twilio follow-up`);
}

if (!DRY_RUN && (targets.length > 0 || voiceFlagCount > 0)) {
  writeJsonSafe(OUTREACH_PATH, leads);
}

console.log(`\n${"─".repeat(56)}`);
console.log(`  Outreach Prep — ${targets.length} clinics processed`);
console.log(`${"─".repeat(56)}`);
console.log(`  HIGH:         ${counts.HIGH}`);
console.log(`  MEDIUM-HIGH:  ${counts["MEDIUM-HIGH"] || 0}`);
console.log(`  MEDIUM:       ${counts.MEDIUM || 0}`);
console.log(`  LOW:          ${counts.LOW || 0}`);
console.log(`  NONE:         ${counts.NONE || 0}`);

if (highVoiceList.length > 0) {
  console.log(`\n  ⚠  ${highVoiceList.length} HIGH clinics need voice files — run: npm run voice:generate`);
  highVoiceList.slice(0, 5).forEach(n => console.log(`     • ${n}`));
}

console.log(DRY_RUN ? "\n  (dry-run — no changes written)" : `\n  Saved → ${OUTREACH_PATH}`);
