import fs from 'fs';
import dotenv from 'dotenv';
dotenv.config();
import { sendMail } from '../src/services/mailer.js';
import { buildPilotEmail } from '../src/templates/pilotOffer.js';

const dental = JSON.parse(fs.readFileSync('data/outreach.localDentists.json', 'utf8'));

// Warm leads: tracked via personalFollowupAt OR known manual sends
const trackedWarm = dental.filter(c =>
  (c.personalFollowupAt || c.status === 'personal_followup_sent') &&
  c.email &&
  !c.pilotOfferSent &&
  c.status !== 'bounced'
);

// Also include manually-sent personal followups not yet tracked
const manualWarm = [
  'dentistree', 'mercier', 'metropoint', 'metro-point'
].map(n => dental.find(c =>
  c.clinicName?.toLowerCase().includes(n) &&
  c.email && !c.pilotOfferSent && c.status !== 'bounced'
)).filter(Boolean);

const targets = [...new Set([...trackedWarm, ...manualWarm])];

console.log(`Sending pilot offer to ${targets.length} warm leads:\n`);
targets.forEach(c => console.log(' -', c.clinicName, '—', c.email));
console.log();

let sent = 0;
for (let i = 0; i < targets.length; i++) {
  const clinic = targets[i];
  const { subject, body } = buildPilotEmail(clinic);

  try {
    await sendMail({ to: clinic.email, subject, text: body });

    const idx = dental.findIndex(c => c.email === clinic.email);
    if (idx !== -1) {
      dental[idx].pilotOfferSent   = true;
      dental[idx].pilotOfferSentAt = new Date().toISOString();
    }

    sent++;
    console.log(`✓ [${sent}/${targets.length}] ${clinic.clinicName}`);
    console.log(`  Subject: ${subject}`);

    if (i < targets.length - 1) {
      console.log(`  Waiting 30s...`);
      await new Promise(r => setTimeout(r, 30000));
    }
  } catch(e) {
    console.log(`✗ Failed: ${clinic.clinicName} — ${e.message}`);
  }
}

fs.writeFileSync('data/outreach.localDentists.json', JSON.stringify(dental, null, 2));
console.log(`\n✓ Pilot offer sent to ${sent} warm leads. DB updated.`);
