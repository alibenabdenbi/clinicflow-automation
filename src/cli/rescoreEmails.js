// src/cli/rescoreEmails.js
// Re-scores all existing emails in the outreach queue using the updated rules
// in emailFinder.js — no web requests, pure in-memory re-evaluation.
// Run after fixing emailFinder.js to retroactively clean up false positives.

import fs from "fs";
import path from "path";

const OUTREACH_PATH = path.join(process.cwd(), "data", "outreach.localDentists.json");

function readJsonSafe(p, fb) {
  try { return JSON.parse(fs.readFileSync(p, "utf-8")); } catch { return fb; }
}
function writeJsonSafe(p, d) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(d, null, 2), "utf-8");
}

// ── Inline scoring (mirrors emailFinder.js rules exactly) ──────────────────

const LOW_PREFIXES = new Set([
  "info","contact","admin","support","help","mail","email",
  "webmaster","media","inquiry","inquiries","general","hello","hi","team",
]);
const MEDIUM_PREFIXES = [
  "reception","appointments","booking","booking-requests","appt",
  "dental","clinic","smile","smiles","practice","front-desk",
  "frontdesk","office","secretary","front","desk",
];
const BLOCKED = new Set([
  "noreply","no-reply","donotreply","do-not-reply","bounce","bounces",
  "postmaster","mailer-daemon","daemon","abuse","spam","unsubscribe","optout",
  "user","username","test","example","demo","sample","webmaster",
  "write","writer","writing","content","copywriter",
  "seo","sem","ppc","ads","marketing","socialmedia",
  "wordpress","developer","dev","webdev","design","designer",
  "agency","freelance",
]);
const BLOCKED_DOMAIN_PATTERNS = [
  "wixpress.com","wix.com","example.com","example.org","test.com",
  "mailinator.com","guerrillamail.com","tempmail.com",
  "sentry.","sentry-next.","ore.urg","clinicflowautomation.com",
];
const MAJOR_PROVIDERS = new Set([
  "gmail.com","googlemail.com","outlook.com","hotmail.com","hotmail.ca",
  "live.com","msn.com","yahoo.com","yahoo.ca","icloud.com","me.com","mac.com",
  "rogers.com","bell.net","telus.net","shaw.ca","videotron.ca",
]);
const VENDOR_KEYWORDS = ["write","content","seo","marketing","wordpress","developer","design","agency","freelance"];

function baseDomain(url) {
  try {
    if (/^https?:\/\//i.test(url)) return new URL(url).hostname.replace(/^www\./i,"").toLowerCase();
    return url.toLowerCase().replace(/^www\./i,"");
  } catch { return ""; }
}

function isDomainRelevant(emailDomain, clinicWebsite) {
  if (!clinicWebsite) return true;
  if (MAJOR_PROVIDERS.has(emailDomain)) return true;
  const siteDomain = baseDomain(clinicWebsite);
  if (!siteDomain) return true;
  return emailDomain === siteDomain || emailDomain.endsWith("."+siteDomain) || siteDomain.endsWith("."+emailDomain);
}

function scoreEmail(email, clinicWebsite = "") {
  const e = (email || "").toLowerCase().trim();
  const atIdx = e.lastIndexOf("@");
  if (atIdx === -1) return null;
  const local = e.slice(0, atIdx);
  const domain = e.slice(atIdx + 1);

  if (BLOCKED.has(local)) return null;
  if (BLOCKED_DOMAIN_PATTERNS.some(p => domain.includes(p))) return null;
  if (VENDOR_KEYWORDS.some(k => local.includes(k))) return null;
  if (clinicWebsite && !isDomainRelevant(domain, clinicWebsite)) return null;

  if (LOW_PREFIXES.has(local)) return { score: 1, confidence: "low" };
  if (MEDIUM_PREFIXES.some(m => local === m || local.startsWith(m))) return { score: 2, confidence: "medium" };

  const looksPersonal = local.includes(".") || local.includes("-") || /^(dr|dre|dentist|hygienist)/.test(local);
  if (looksPersonal || local.length >= 6) return { score: 3, confidence: "high" };
  return { score: 2, confidence: "medium" };
}

// ── Main ───────────────────────────────────────────────────────────────────

const records = readJsonSafe(OUTREACH_PATH, []);
const withEmail = records.filter(r => r.email);

console.log(`Total records: ${records.length}`);
console.log(`Records with email: ${withEmail.length}\n`);

let cleared = 0;
let upgraded = 0;
let downgraded = 0;
const rejected = [];

for (let i = 0; i < records.length; i++) {
  const r = records[i];
  if (!r.email) continue;

  const oldConfidence = r.emailConfidence || "unset";
  const result = scoreEmail(r.email, r.website || "");

  if (!result) {
    // Email now rejected by updated rules
    rejected.push({ email: r.email, clinic: r.clinicName, website: r.website, reason: "blocked by updated rules" });
    records[i].email = null;
    records[i].emailConfidence = "none";
    records[i].emailScore = 0;
    records[i].emailRejectedAt = new Date().toISOString();
    records[i].method = records[i].contactPage ? "contact_form" : "manual";
    cleared++;
  } else {
    // Update confidence/score with new rules
    const newConf = result.confidence;
    records[i].emailConfidence = newConf;
    records[i].emailScore = result.score;
    if (oldConfidence !== "unset" && oldConfidence !== newConf) {
      if (result.score > (oldConfidence === "high" ? 3 : oldConfidence === "medium" ? 2 : 1)) upgraded++;
      else downgraded++;
    }
    // Assign method
    if (r.email) records[i].method = "email";
  }
}

writeJsonSafe(OUTREACH_PATH, records);

// Summary
const newWithEmail = records.filter(r => r.email).length;
const conf = { high:0, medium:0, low:0 };
records.filter(r => r.email).forEach(r => { if (r.emailConfidence in conf) conf[r.emailConfidence]++; });

console.log("══ RESCORE RESULTS ══════════════════════");
console.log(`Emails cleared (false positives): ${cleared}`);
console.log(`Emails remaining: ${newWithEmail}`);
console.log(`  High confidence:   ${conf.high}`);
console.log(`  Medium confidence: ${conf.medium}`);
console.log(`  Low confidence:    ${conf.low}`);

if (rejected.length > 0) {
  console.log(`\nRejected emails (${rejected.length}):`);
  rejected.slice(0, 20).forEach(r => console.log(`  ✗ ${r.email}  [${r.clinic}]`));
}

console.log(`\nSaved → ${OUTREACH_PATH}`);
