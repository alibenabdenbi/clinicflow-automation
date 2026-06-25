// src/cli/runHitListSequence.js
// Runs daily at 09:15 — fires the right touch for each hit list prospect
// based on how many days have passed since touch 1 was sent.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
dotenv.config();

if (process.platform === 'win32') process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

import { sendMail } from '../services/mailer.js';
import { buildPilotEmail } from '../templates/pilotOffer.js';
import { buildBreakupEmail } from '../templates/breakupEmail.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');
const DATA_DIR = path.join(ROOT, 'data');

const CALENDLY = 'https://calendly.com/m-aliben432/clinicflow-15-min-intro';
const DAY_MS   = 24 * 60 * 60 * 1000;

const SEQUENCE_PATH = path.join(DATA_DIR, 'hitlist', 'sequence-tracker.json');
const DENTAL_PATH   = path.join(DATA_DIR, 'outreach.localDentists.json');
const LOCK_PATH     = path.join(DATA_DIR, 'hitlist', 'sequence.lock');

// Prevent concurrent runs from double-sending
if (fs.existsSync(LOCK_PATH)) {
  const age = Date.now() - fs.statSync(LOCK_PATH).mtimeMs;
  if (age < 30 * 60 * 1000) { // stale if older than 30 min
    console.log('⚠ Another run is in progress (lock file exists). Exiting.');
    process.exit(0);
  }
  fs.unlinkSync(LOCK_PATH); // remove stale lock
}
fs.writeFileSync(LOCK_PATH, String(process.pid));
process.on('exit', () => { try { fs.unlinkSync(LOCK_PATH); } catch {} });
process.on('SIGINT', () => process.exit(1));
process.on('SIGTERM', () => process.exit(1));

const sequence = JSON.parse(fs.readFileSync(SEQUENCE_PATH, 'utf8'));
const dental   = JSON.parse(fs.readFileSync(DENTAL_PATH, 'utf8'));
const now      = Date.now();

let touch2Sent = 0, touch3Sent = 0, touch4Sent = 0, touch7Sent = 0;

for (const prospect of sequence) {
  if (prospect.replied || prospect.status === 'closed') continue;

  // Backfill touch1SentAt for older records marked done before timestamp tracking was added.
  // Treat them as 7 days old so touch2/3/4 become eligible immediately.
  if (!prospect.touch1SentAt && prospect.touches?.touch1_email === 'done') {
    const idx = sequence.findIndex(s => s.email === prospect.email);
    sequence[idx].touch1SentAt = new Date(now - 7 * DAY_MS).toISOString();
    prospect.touch1SentAt = sequence[idx].touch1SentAt;
  }

  if (!prospect.touch1SentAt) continue;

  const daysSince = (now - new Date(prospect.touch1SentAt).getTime()) / DAY_MS;

  // TOUCH 2 — Day 3 — Follow-up with /live + demo number
  if (daysSince >= 3 && prospect.touches.touch2_followup === 'pending') {
    try {
      await sendMail({
        to: prospect.email,
        subject: `Re: ${prospect.clinicName}`,
        text: `Hi,

Following up on the preview I sent a few days ago.

The live system is running here if you want to see it:
clinicflowautomation.com/live

Or experience it as a patient would — text anything to +1 (575) 573-5822

Happy to book a quick call: ${CALENDLY}

— Mohamed
438-544-0442`,
      });
      const idx = sequence.findIndex(s => s.email === prospect.email);
      sequence[idx].touches.touch2_followup = 'sent';
      sequence[idx].touch2SentAt = new Date().toISOString();
      touch2Sent++;
      console.log(`✓ Touch 2 → ${prospect.clinicName}`);
      await new Promise(r => setTimeout(r, 15000));
    } catch(e) { console.log(`✗ Touch 2 failed: ${prospect.clinicName} — ${e.message}`); }

  // TOUCH 3 — Day 5 — Personal pilot offer
  } else if (daysSince >= 5 && prospect.touches.touch3_personal === 'pending' && prospect.touches.touch2_followup !== 'pending') {
    try {
      const clinic = dental.find(d => d.email === prospect.email) || prospect;
      const { subject, body } = buildPilotEmail(clinic);
      await sendMail({ to: prospect.email, subject, text: body });
      const idx = sequence.findIndex(s => s.email === prospect.email);
      sequence[idx].touches.touch3_personal = 'sent';
      sequence[idx].touch3SentAt = new Date().toISOString();
      const didx = dental.findIndex(d => d.email === prospect.email);
      if (didx !== -1) { dental[didx].pilotOfferSent = true; dental[didx].pilotOfferSentAt = new Date().toISOString(); }
      touch3Sent++;
      console.log(`✓ Touch 3 (pilot) → ${prospect.clinicName}`);
      await new Promise(r => setTimeout(r, 15000));
    } catch(e) { console.log(`✗ Touch 3 failed: ${prospect.clinicName} — ${e.message}`); }

  // TOUCH 7 — Day 14 — Breakup email (highest reply rate of any touch)
  } else if (daysSince >= 14 && prospect.touches.touch7_final === 'pending' && prospect.touches.touch3_personal !== 'pending') {
    try {
      const clinic = dental.find(d => d.email === prospect.email) || prospect;
      const { subject, body, variantLabel } = buildBreakupEmail(clinic);
      await sendMail({ to: prospect.email, subject, text: body });
      const idx = sequence.findIndex(s => s.email === prospect.email);
      sequence[idx].touches.touch7_final = 'sent';
      sequence[idx].touch7SentAt = new Date().toISOString();
      touch7Sent++;
      console.log(`✓ Touch 7 (breakup/${variantLabel}) → ${prospect.clinicName}`);
      await new Promise(r => setTimeout(r, 15000));
    } catch(e) { console.log(`✗ Touch 7 failed: ${prospect.clinicName} — ${e.message}`); }

  // TOUCH 4 — Day 7 — SMS with demo number
  } else if (daysSince >= 7 && prospect.touches.touch4_sms === 'pending' && prospect.phone) {
    try {
      const { default: twilio } = await import('twilio');
      const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
      await client.messages.create({
        body: `Hi — Mohamed from ClinicFlow. Sent you a couple of emails about auto missed-call text-back for ${prospect.clinicName}. Want to see what your patients would experience? Text anything to +1 (575) 573-5822 — 60 seconds. Or book a call: ${CALENDLY}`,
        from: process.env.TWILIO_FROM_NUMBER,
        to: prospect.phone,
      });
      const idx = sequence.findIndex(s => s.email === prospect.email);
      sequence[idx].touches.touch4_sms = 'sent';
      sequence[idx].touch4SentAt = new Date().toISOString();
      touch4Sent++;
      console.log(`✓ Touch 4 (SMS) → ${prospect.clinicName} ${prospect.phone}`);
      await new Promise(r => setTimeout(r, 5000));
    } catch(e) { console.log(`✗ Touch 4 failed: ${prospect.clinicName} — ${e.message}`); }
  }
}

fs.writeFileSync(SEQUENCE_PATH, JSON.stringify(sequence, null, 2));
fs.writeFileSync(DENTAL_PATH, JSON.stringify(dental, null, 2));

console.log(`\n=== HIT LIST SEQUENCE COMPLETE ===`);
console.log(`Touch 2 (follow-up):  ${touch2Sent} sent`);
console.log(`Touch 3 (pilot):      ${touch3Sent} sent`);
console.log(`Touch 4 (SMS demo):   ${touch4Sent} sent`);
console.log(`Touch 7 (breakup):    ${touch7Sent} sent`);
