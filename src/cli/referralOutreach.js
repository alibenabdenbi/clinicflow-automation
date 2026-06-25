// src/cli/referralOutreach.js
// Generates personalized partnership pitch emails for the referral network:
// - Dental supply companies (visit 10+ clinics/week)
// - Dental associations (RCDSO, ODA, CDA)
// - Practice management consultants
// - Dental software companies (Jane App resellers)
//
// Referral fee: 15% of first payment for each clinic sent that becomes a client.
// A rep who visits 50 clinics/week could send 2-3 clients/month = $150-$450/mo passive.
//
// Usage:
//   node src/cli/referralOutreach.js
//   node src/cli/referralOutreach.js --preview

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const DATA_DIR = path.join(ROOT, "data");
const OUT_PATH = path.join(DATA_DIR, "referral", "referral-targets.json");
const PITCH_DIR = path.join(DATA_DIR, "referral", "pitches");

const PREVIEW = process.argv.includes("--preview");

function writeJsonSafe(p, data) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(data, null, 2), "utf-8");
}

// ── Referral target database ──────────────────────────────────────────────────

const REFERRAL_TARGETS = [
  // ── Dental supply companies ─────────────────────────────────────────────────
  {
    type: "dental_supply",
    company: "Henry Schein Canada",
    role: "Territory Sales Representative",
    website: "henryschein.ca",
    email: "canada@henryschein.com",
    linkedin: "https://www.linkedin.com/company/henry-schein/",
    reach: "500+ dental offices across Canada",
    contactNote: "Find regional rep via LinkedIn search: 'Henry Schein dental sales Ontario'",
  },
  {
    type: "dental_supply",
    company: "Patterson Dental Canada",
    role: "Sales Representative",
    website: "pattersondental.ca",
    email: "info@pattersondental.ca",
    linkedin: "https://www.linkedin.com/company/patterson-companies/",
    reach: "300+ Ontario dental practices",
    contactNote: "Find Ontario rep via LinkedIn search: 'Patterson Dental Ontario territory'",
  },
  {
    type: "dental_supply",
    company: "Sinclair Dental",
    role: "Sales Representative",
    website: "sinclairco.com",
    email: "info@sinclairco.com",
    linkedin: "https://www.linkedin.com/company/sinclair-dental/",
    reach: "Canadian dental clinics",
    contactNote: "Canadian-owned distributor — very warm to Canadian startups",
  },
  {
    type: "dental_supply",
    company: "Benco Dental Canada",
    role: "Territory Sales Manager",
    website: "benco.com",
    email: "sales@benco.com",
    linkedin: "https://www.linkedin.com/company/benco-dental/",
    reach: "Ontario dental practices",
    contactNote: "Expanding aggressively in Canada",
  },

  // ── Dental practice management consultants ──────────────────────────────────
  {
    type: "consultant",
    company: "ACT Dental",
    role: "Practice Management Coach",
    website: "actdental.com",
    email: "info@actdental.com",
    linkedin: "https://www.linkedin.com/company/act-dental/",
    reach: "100+ Canadian dental practices per year",
    contactNote: "They run workshops — offer to present free training on missed call recovery",
  },
  {
    type: "consultant",
    company: "Dental Practice Heroes",
    role: "Business Coach",
    website: "dentalpracticeheroes.com",
    email: "info@dentalpracticeheroes.com",
    linkedin: "https://www.linkedin.com/company/dental-practice-heroes/",
    reach: "Small practice owners",
    contactNote: "Podcast + community — offer content collaboration",
  },
  {
    type: "consultant",
    company: "Practice Cafe",
    role: "Marketing Consultant",
    website: "practicecafe.com",
    email: "hello@practicecafe.com",
    linkedin: "https://www.linkedin.com/company/practice-cafe/",
    reach: "Dental marketing clients",
    contactNote: "White-label partnership potential",
  },

  // ── Dental associations ─────────────────────────────────────────────────────
  {
    type: "association",
    company: "Ontario Dental Association (ODA)",
    role: "Partnerships / Member Services",
    website: "oda.ca",
    email: "info@oda.ca",
    linkedin: "https://www.linkedin.com/company/ontario-dental-association/",
    reach: "9,000+ Ontario dentists",
    contactNote: "Apply to ODA vendor program — $500 annual fee, direct access to member newsletter",
  },
  {
    type: "association",
    company: "Canadian Dental Association (CDA)",
    role: "Industry Partnerships",
    website: "cda-adc.ca",
    email: "reception@cda-adc.ca",
    linkedin: "https://www.linkedin.com/company/canadian-dental-association/",
    reach: "22,000+ Canadian dentists",
    contactNote: "CDA Essentials newsletter reaches all members — explore advertising",
  },

  // ── Dental software companies ───────────────────────────────────────────────
  {
    type: "software_partner",
    company: "Jane App",
    role: "Partnership Team",
    website: "jane.app",
    email: "partnerships@jane.app",
    linkedin: "https://www.linkedin.com/company/jane-app/",
    reach: "50,000+ health clinics in Canada",
    contactNote: "Jane users who need missed-call automation that Jane doesn't offer — perfect complement",
  },
  {
    type: "software_partner",
    company: "Maxident",
    role: "Business Development",
    website: "maxident.com",
    email: "info@maxident.com",
    linkedin: "https://www.linkedin.com/company/maxident/",
    reach: "Dental software users across Canada",
    contactNote: "Offer integration: ClinicFlow + Maxident for unified patient communication",
  },
];

// ── Pitch email generator ─────────────────────────────────────────────────────

function buildPitch(target) {
  const { type, company, role, reach, contactNote } = target;

  const typeIntros = {
    dental_supply: `You're visiting dental clinics every day — you see firsthand what they're struggling with.`,
    consultant: `You work closely with dental practice owners on growth and efficiency.`,
    association: `Your members are exactly the dental clinic owners I help.`,
    software_partner: `Your customers are dental clinics who need the tools to grow — we solve different problems for the same people.`,
  };

  const typeValues = {
    dental_supply: `When you mention ClinicFlow to a clinic owner and they become a client, you earn 15% of their first payment — $60 to $375 per referral depending on tier. A rep who visits 50 clinics/week could earn $300–$900/month with just 2-3 referrals.`,
    consultant: `Every clinic you coach is a potential referral. When they sign up through your link, you earn 15% — typically $60 to $375 per client. For consultants with 20+ active clients, that's $500–$1,000/month in passive income.`,
    association: `A vendor partner listing or newsletter mention reaches thousands of members at once. We'd pay a 15% referral fee on every member who becomes a client, or explore a flat sponsorship arrangement.`,
    software_partner: `We serve the same clinics with complementary tools. A referral partnership means your users get a more complete solution, and you earn 15% of the first payment for every clinic you send our way.`,
  };

  const subject = `Partnership opportunity — 15% referral for every dental clinic you send us`;

  const body = `Hi,

I run ClinicFlow Automation — we help Canadian dental clinics recover missed call revenue through automated follow-up systems.

${typeIntros[type] || "You work with dental clinic owners."}

Here's the opportunity:

${typeValues[type]}

What we do: When a patient calls a clinic and no one answers, they receive an automated text within 60 seconds offering to book online or speak with the team. Most clinics recover 3–6 patients in the first two weeks.

Setup: 5 business days. One-time fee ($397–$997). No monthly subscription. Money-back if they see no results.

If you'd like to talk, I'm happy to jump on a 15-minute call or send a one-pager you can share with your ${type === "dental_supply" ? "clients" : "network"}.

Mohamed
ClinicFlow Automation
contact@clinicflowautomation.com
438-544-0442
clinicflowautomation.com`;

  return { subject, body };
}

// ─── Main ─────────────────────────────────────────────────────────────────────

console.log(`\nReferral Outreach Generator`);
console.log(`Targets: ${REFERRAL_TARGETS.length} referral partners\n`);

fs.mkdirSync(PITCH_DIR, { recursive: true });

const targets = REFERRAL_TARGETS.map(t => {
  const pitch = buildPitch(t);
  return { ...t, pitch, generatedAt: new Date().toISOString(), status: "pending" };
});

if (!PREVIEW) {
  writeJsonSafe(OUT_PATH, targets);
}

// Save individual pitch files
let saved = 0;
for (const t of targets) {
  const slug = t.company.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  const outPath = path.join(PITCH_DIR, `${slug}.txt`);

  const content = [
    `TO: ${t.company} — ${t.role}`,
    `EMAIL: ${t.email}`,
    `LINKEDIN: ${t.linkedin}`,
    `REACH: ${t.reach}`,
    `NOTE: ${t.contactNote}`,
    ``,
    `SUBJECT: ${t.pitch.subject}`,
    ``,
    t.pitch.body,
  ].join("\n");

  if (!PREVIEW) {
    fs.writeFileSync(outPath, content, "utf-8");
    saved++;
  }

  console.log(`  [${t.type.padEnd(16)}] ${t.company}`);
  console.log(`    Email: ${t.email}`);
  if (PREVIEW) {
    console.log(`    Subject: ${t.pitch.subject}`);
    console.log(`    Note: ${t.contactNote}`);
  }
  console.log("");
}

console.log(`${"─".repeat(56)}`);
if (PREVIEW) {
  console.log(`  Preview mode — ${targets.length} pitches generated (not saved)`);
  console.log(`  Run without --preview to save to ${PITCH_DIR}`);
} else {
  console.log(`  ${targets.length} referral targets saved → ${OUT_PATH}`);
  console.log(`  ${saved} pitch emails saved → ${PITCH_DIR}`);
}

// Show sample pitch
console.log(`\n${"─".repeat(56)}`);
console.log(`SAMPLE PITCH (${targets[0].company}):`);
console.log(`${"─".repeat(56)}`);
console.log(`Subject: ${targets[0].pitch.subject}\n`);
console.log(targets[0].pitch.body);
