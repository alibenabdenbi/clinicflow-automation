// src/intelligence/auditAggregator.js
// Reads all audit responses in data/reply-drafts/ and builds a pattern report.
// Run: node src/intelligence/auditAggregator.js

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname  = path.dirname(fileURLToPath(import.meta.url));
const ROOT       = path.resolve(__dirname, "../..");
const DRAFTS_DIR = path.join(ROOT, "data", "reply-drafts");
const OUT_PATH   = path.join(ROOT, "data", "intelligence", "audit-patterns.json");

function readJsonSafe(p, fb) {
  try { return JSON.parse(fs.readFileSync(p, "utf-8")); } catch { return fb; }
}
function writeJson(p, data) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(data, null, 2), "utf-8");
}

// ─── Keyword classifiers ──────────────────────────────────────────────────────

const BOOKING_SYSTEM_PATTERNS = [
  { name: "Jane App",      re: /jane\s*app|janeapp/i },
  { name: "Dentrix",       re: /dentrix/i },
  { name: "Curve Dental",  re: /curve\s*dental/i },
  { name: "Open Dental",   re: /open\s*dental/i },
  { name: "Eaglesoft",     re: /eaglesoft/i },
  { name: "Mogo",          re: /\bmogo\b/i },
  { name: "Cleardent",     re: /cleardent/i },
  { name: "Power Practice",re: /power\s*practice/i },
  { name: "Paper/Manual",  re: /paper|manual|written|no system|don'?t use/i },
  { name: "Phone Only",    re: /phone\s*only|just\s*phone|only\s*phone|call us/i },
];

const MISSED_CALL_PATTERNS = [
  { name: "Voicemail only",        re: /voicemail|voice\s*mail/i },
  { name: "Front desk calls back", re: /call(s)?\s*back|callback|front\s*desk.*call/i },
  { name: "Nothing happens",       re: /nothing|never|don'?t\s*(call|follow)|no\s*follow/i },
  { name: "Automated text",        re: /auto.*text|text.*auto|sms|text\s*message/i },
];

const REMINDER_PATTERNS = [
  { name: "No reminders",          re: /no\s*reminder|don'?t\s*send|not\s*send|never\s*send/i },
  { name: "Manual calls only",     re: /manual|call\s*patient|staff\s*call/i },
  { name: "SMS reminders",         re: /text|sms|message/i },
  { name: "Email reminders",       re: /email\s*reminder/i },
  { name: "Automated reminders",   re: /auto.*remind|remind.*auto/i },
];

const REACTIVATION_PATTERNS = [
  { name: "Never done",            re: /never|not\s*(done|tried)|don'?t\s*do|no\s*reactivat/i },
  { name: "Occasional manual",     re: /occasional|sometimes|manual|when\s*(we have|there'?s)\s*time/i },
  { name: "Has automation",        re: /automat|running|system|campaign/i },
];

const GBP_PATTERNS = [
  { name: "Has GBP",    re: /yes|have|got it|set up|active/i },
  { name: "No GBP",     re: /no|don'?t\s*have|not\s*sure|what'?s\s*that/i },
];

function classify(text, patterns) {
  if (!text) return "Unknown";
  for (const p of patterns) {
    if (p.re.test(text)) return p.name;
  }
  return "Other";
}

// ─── Parse audit files ────────────────────────────────────────────────────────

function parseAuditFile(filePath) {
  const raw = readJsonSafe(filePath, null);
  if (!raw) return null;

  // reply-drafts files contain: { clinicName, email, date, answers: { q1, q2, q3, q4, q5 } }
  // OR they may contain raw text from auto-captured replies
  const answers = raw.answers || {};
  const rawText = raw.rawText || raw.body || JSON.stringify(raw);

  return {
    clinicName:    raw.clinicName || raw.clinic || path.basename(filePath, ".json"),
    email:         raw.email || "",
    date:          raw.date || raw.receivedAt || raw.createdAt || null,
    bookingSystem: classify(answers.q1 || rawText, BOOKING_SYSTEM_PATTERNS),
    missedCallHandling: classify(answers.q2 || rawText, MISSED_CALL_PATTERNS),
    hasReminders:  classify(answers.q3 || rawText, REMINDER_PATTERNS),
    hasReactivation: classify(answers.q4 || rawText, REACTIVATION_PATTERNS),
    hasGBP:        classify(answers.q5 || rawText, GBP_PATTERNS),
    raw: answers,
  };
}

// ─── Main ─────────────────────────────────────────────────────────────────────

function run() {
  // Ensure drafts dir exists
  fs.mkdirSync(DRAFTS_DIR, { recursive: true });

  const files = fs.readdirSync(DRAFTS_DIR)
    .filter(f => f.endsWith(".json"))
    .map(f => path.join(DRAFTS_DIR, f));

  console.log(`Audit aggregator — found ${files.length} audit files in ${DRAFTS_DIR}`);

  const parsed = files.map(parseAuditFile).filter(Boolean);

  if (parsed.length === 0) {
    console.log("No audit responses to aggregate yet.");
    const empty = {
      generatedAt: new Date().toISOString(),
      totalAudits: 0,
      patterns: {},
      audits: [],
    };
    writeJson(OUT_PATH, empty);
    console.log(`Saved empty report → ${OUT_PATH}`);
    return;
  }

  // Tally each dimension
  function tally(field) {
    const counts = {};
    for (const a of parsed) {
      const v = a[field] || "Unknown";
      counts[v] = (counts[v] || 0) + 1;
    }
    return Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .map(([label, count]) => ({ label, count, pct: Math.round(count / parsed.length * 100) + "%" }));
  }

  const patterns = {
    bookingSystems:       tally("bookingSystem"),
    missedCallHandling:   tally("missedCallHandling"),
    reminderAdoption:     tally("hasReminders"),
    reactivationAdoption: tally("hasReactivation"),
    googleBusinessProfile: tally("hasGBP"),
  };

  const output = {
    generatedAt: new Date().toISOString(),
    totalAudits: parsed.length,
    patterns,
    audits: parsed.map(a => ({
      clinicName: a.clinicName,
      date: a.date,
      bookingSystem: a.bookingSystem,
      missedCallHandling: a.missedCallHandling,
      hasReminders: a.hasReminders,
      hasReactivation: a.hasReactivation,
      hasGBP: a.hasGBP,
    })),
  };

  writeJson(OUT_PATH, output);

  console.log(`\n── Audit patterns (${parsed.length} responses) ──`);
  console.log("\nBooking systems:");
  patterns.bookingSystems.forEach(r => console.log(`  ${r.label.padEnd(22)} ${r.count} (${r.pct})`));
  console.log("\nMissed call handling:");
  patterns.missedCallHandling.forEach(r => console.log(`  ${r.label.padEnd(22)} ${r.count} (${r.pct})`));
  console.log("\nReminder adoption:");
  patterns.reminderAdoption.forEach(r => console.log(`  ${r.label.padEnd(22)} ${r.count} (${r.pct})`));
  console.log("\nReactivation adoption:");
  patterns.reactivationAdoption.forEach(r => console.log(`  ${r.label.padEnd(22)} ${r.count} (${r.pct})`));
  console.log("\nGoogle Business Profile:");
  patterns.googleBusinessProfile.forEach(r => console.log(`  ${r.label.padEnd(22)} ${r.count} (${r.pct})`));
  console.log(`\nSaved → ${OUT_PATH}`);
}

run();
