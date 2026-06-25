// src/cli/sendPilotFollowups.js
// Auto follow-up for pilot offers that haven't received a reply after 24h.
// Runs once per clinic — never sends more than one follow-up.
// Scheduled daily at 09:00.
//
// Usage: node src/cli/sendPilotFollowups.js

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { sendMail } from '../services/mailer.js';
dotenv.config();

const __dirname  = path.dirname(fileURLToPath(import.meta.url));
const ROOT       = path.resolve(__dirname, '../..');
const DENTAL_PATH = path.join(ROOT, 'data', 'outreach.localDentists.json');

const ONE_DAY   = 24 * 60 * 60 * 1000;
const THREE_DAYS = 3 * ONE_DAY;
const now = Date.now();

function readJsonSafe(p, fb) {
  try { return JSON.parse(fs.readFileSync(p, 'utf-8')); } catch { return fb; }
}

const dental = readJsonSafe(DENTAL_PATH, []);

let physio = [];
try {
  const physioPath = path.join(ROOT, 'data', 'outreach.physioClinics.json');
  physio = readJsonSafe(physioPath, []);
} catch {}

const all = [...dental, ...physio];

const needsFollowup = all.filter(c => {
  if (!c.pilotOfferSentAt) return false;
  if (c.pilotFollowupSent) return false;
  if (c.replied) return false;
  if (c.status === 'bounced') return false;
  if (!c.email) return false;
  const age = now - new Date(c.pilotOfferSentAt).getTime();
  return age >= ONE_DAY && age < THREE_DAYS;
});

console.log(`Pilot follow-ups needed: ${needsFollowup.length}`);
if (needsFollowup.length === 0) {
  console.log('Nothing to send — check back tomorrow.');
  process.exit(0);
}

let sent = 0;
for (let i = 0; i < needsFollowup.length; i++) {
  const clinic = needsFollowup[i];
  const firstName = clinic.ownerName?.split(' ')[0] ||
                    clinic.contactName?.split(' ')[0] || 'there';

  try {
    await sendMail({
      to: clinic.email,
      subject: `Still have that spot open — ${clinic.clinicName}`,
      text: `Hi ${firstName},

Just checking if my last note landed.

The 30-day free pilot for ${clinic.clinicName} — still available this week.

One question: when a patient calls your clinic right now and no one picks up, what happens?

If the answer is "they probably hang up and call somewhere else" — that's exactly what this fixes.

No cost. No commitment. One phone setting change.

Worth a 2-minute call to see if it makes sense?

— Mohamed
438-544-0442

Reply STOP to opt out.`,
    });

    // Mark in dental DB (physio records stay in physio file)
    const idx = dental.findIndex(d => d.email === clinic.email);
    if (idx !== -1) {
      dental[idx].pilotFollowupSent   = true;
      dental[idx].pilotFollowupSentAt = new Date().toISOString();
    }

    sent++;
    console.log(`✓ [${sent}] ${clinic.clinicName} — ${clinic.email}`);

    if (i < needsFollowup.length - 1) {
      console.log('  Waiting 30s...');
      await new Promise(r => setTimeout(r, 30_000));
    }
  } catch(e) {
    console.log(`✗ Failed: ${clinic.clinicName} — ${e.message}`);
  }
}

fs.writeFileSync(DENTAL_PATH, JSON.stringify(dental, null, 2));
console.log(`\nPilot follow-ups sent: ${sent}/${needsFollowup.length}`);
