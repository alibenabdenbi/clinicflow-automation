// src/cli/auditRespond.js
// Generates a personalized audit response email and saves it to data/reply-drafts/.
//
// Usage:
//   npm run audit:respond -- \
//     --client "Infinity Dental" \
//     --email "reception@infinitydentaloffice.com" \
//     --missed "Voicemail only — no callback system" \
//     --reminders "Manual calls, no automated reminders" \
//     --reactivation "Nothing in place" \
//     --biggest "Missed call recovery — 5+ calls/day going unanswered"

import fs from "fs";
import path from "path";
import { fill, AUDIT_RESPONSE } from "../templates/replyTemplates.js";

const DRAFTS_DIR = path.join(process.cwd(), "data", "reply-drafts");

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith("--")) {
      const key = argv[i].slice(2);
      const val = argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : "";
      args[key] = val;
      if (val) i++;
    }
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));

const clinicName      = args.client      || "";
const email           = args.email       || "";
const auditMissedCalls   = args.missed   || "(fill in)";
const auditReminders     = args.reminders || "(fill in)";
const auditReactivation  = args.reactivation || "(fill in)";
const auditBiggest       = args.biggest  || "(fill in)";

if (!clinicName) {
  console.error("Error: --client \"Clinic Name\" is required.");
  console.error("Usage: npm run audit:respond -- --client \"Clinic Name\" --missed \"...\" --reminders \"...\" --reactivation \"...\" --biggest \"...\"");
  process.exit(1);
}

const rendered = fill(AUDIT_RESPONSE, {
  clinicName,
  email,
  auditMissedCalls,
  auditReminders,
  auditReactivation,
  auditBiggest,
});

// Save draft
fs.mkdirSync(DRAFTS_DIR, { recursive: true });
const safeDate = new Date().toISOString().slice(0, 10);
const safeName = clinicName.replace(/[^a-z0-9]/gi, "_").toLowerCase().slice(0, 40);
const filename = `${safeDate}-audit-response-${safeName}.json`;
const outPath = path.join(DRAFTS_DIR, filename);

const draft = {
  generatedAt: new Date().toISOString(),
  clinicName,
  email: email || null,
  type: "audit_response",
  auditMissedCalls,
  auditReminders,
  auditReactivation,
  auditBiggest,
  subject: rendered.subject,
  body: rendered.body,
};

fs.writeFileSync(outPath, JSON.stringify(draft, null, 2), "utf-8");

console.log("─".repeat(60));
console.log(`Subject: ${rendered.subject}`);
console.log("─".repeat(60));
console.log(rendered.body);
console.log("─".repeat(60));
console.log(`\nDraft saved → ${outPath}`);
