// src/cli/sendVictoriaDayFollowup.js
// Runs once on Tuesday May 19 at 8:30am.
// Personal touch to all pilot offers sent on Victoria Day (May 18).
// Clinics open their inbox fresh — this is the first thing they see.
//
// Usage: node src/cli/sendVictoriaDayFollowup.js

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { sendMail } from '../services/mailer.js';
dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');
const DENTAL_PATH = path.join(ROOT, 'data', 'outreach.localDentists.json');

const dental = JSON.parse(fs.readFileSync(DENTAL_PATH, 'utf-8'));
let physio = [];
try {
  physio = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'outreach.physioClinics.json'), 'utf-8'));
} catch {}

const all = [...dental, ...physio];

// All pilot offers sent May 18 with no reply yet
const targets = all.filter(c =>
  c.pilotOfferSentAt?.startsWith('2026-05-18') &&
  !c.replied &&
  !c.victoriadayFollowupSent &&
  c.status !== 'bounced' &&
  c.email
);

console.log(`Victoria Day follow-up — ${targets.length} clinics`);
if (targets.length === 0) { console.log('Nothing to send.'); process.exit(0); }

let sent = 0;
for (let i = 0; i < targets.length; i++) {
  const clinic = targets[i];
  const firstName = clinic.ownerName?.split(' ')[0] ||
                    clinic.contactName?.split(' ')[0] || 'there';

  try {
    await sendMail({
      to: clinic.email,
      subject: `Back from the long weekend — ${clinic.clinicName}`,
      text: `Hi ${firstName},

Wanted to make sure my note from Sunday landed — most inboxes were quiet over the long weekend.

Quick version: I want to set up our missed-call text-back system for ${clinic.clinicName} completely free for 30 days.

No cost. No commitment. You just forward missed calls to a number I give you — takes 2 minutes.

After 30 days I send you a report showing exactly how many patients you recovered.

One spot still open this week.

Worth a quick reply?

— Mohamed
438-544-0442

Reply STOP to opt out.`,
    });

    const dentalIdx = dental.findIndex(d => d.email === clinic.email);
    if (dentalIdx !== -1) {
      dental[dentalIdx].victoriadayFollowupSent   = true;
      dental[dentalIdx].victoriadayFollowupSentAt = new Date().toISOString();
    }
    const physioIdx = physio.findIndex(p => p.email === clinic.email);
    if (physioIdx !== -1) {
      physio[physioIdx].victoriadayFollowupSent   = true;
      physio[physioIdx].victoriadayFollowupSentAt = new Date().toISOString();
    }

    sent++;
    console.log(`✓ [${sent}/${targets.length}] ${clinic.clinicName}`);

    if (i < targets.length - 1) {
      console.log('  Waiting 30s...');
      await new Promise(r => setTimeout(r, 30_000));
    }
  } catch(e) {
    console.log(`✗ Failed: ${clinic.clinicName} — ${e.message}`);
  }
}

fs.writeFileSync(DENTAL_PATH, JSON.stringify(dental, null, 2));
if (physio.length) {
  fs.writeFileSync(path.join(ROOT, 'data', 'outreach.physioClinics.json'), JSON.stringify(physio, null, 2));
}
console.log(`\nVictoria Day follow-up done: ${sent}/${targets.length}`);
