// src/cli/exportInboundSummary.js
// Reads inbound-sms.json and inbound-calls.json and writes a summary JSON
// for the intelligence dashboard. Runs daily at 11:05am via scheduler.
//
// Usage: node src/cli/exportInboundSummary.js

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const ROOT      = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const DATA_DIR  = path.join(ROOT, "data");
const OUT_LOCAL = path.join(DATA_DIR, "inbound-summary.json");
const OUT_NETLIFY = path.join(ROOT, "public", "netlify-deploy", "data", "inbound-summary.json");

function readJsonSafe(p) {
  try { return JSON.parse(fs.readFileSync(p, "utf-8")); } catch { return []; }
}

const sms   = readJsonSafe(path.join(DATA_DIR, "inbound-sms.json"));
const calls = readJsonSafe(path.join(DATA_DIR, "inbound-calls.json"));

const summary = {
  totalSms:         sms.length,
  totalCalls:       calls.length,
  unrespondedSms:   sms.filter(s => !s.responded).map(s => ({
    clinicName: s.clinicName,
    from:       s.from,
    body:       s.body,
    receivedAt: s.receivedAt,
  })),
  unrespondedCalls: calls.filter(c => !c.callbackDone).map(c => ({
    clinicName:    c.clinicName,
    from:          c.from,
    transcription: c.transcription,
    recordingUrl:  c.recordingUrl,
    receivedAt:    c.receivedAt,
  })),
  generatedAt: new Date().toISOString(),
};

fs.mkdirSync(path.dirname(OUT_LOCAL), { recursive: true });
fs.writeFileSync(OUT_LOCAL, JSON.stringify(summary, null, 2));

fs.mkdirSync(path.dirname(OUT_NETLIFY), { recursive: true });
fs.writeFileSync(OUT_NETLIFY, JSON.stringify(summary, null, 2));

const uSms   = summary.unrespondedSms.length;
const uCalls = summary.unrespondedCalls.length;
console.log(`✓ Inbound summary exported`);
console.log(`  SMS: ${summary.totalSms} total, ${uSms} unresponded`);
console.log(`  Calls: ${summary.totalCalls} total, ${uCalls} unresponded`);
console.log(`  → ${OUT_LOCAL}`);
console.log(`  → ${OUT_NETLIFY}`);
