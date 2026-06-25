// src/cli/sendWeeklyDigest.js
// Sends the weekly ClinicFlow newsletter to all MX-validated clinics.
// Runs every Monday at 7am via scheduler.
// Pure value — no pitch. Builds familiarity over months.
// Clinics that reply to the digest become warm leads automatically.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
dotenv.config();

import { sendMail } from '../services/mailer.js';

const ROOT    = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const DIGEST_PATH = path.join(ROOT, 'data/newsletter/latest.txt');

if (!fs.existsSync(DIGEST_PATH)) {
  console.error('No digest found at', DIGEST_PATH, '— run generateWeeklyDigest.js first');
  process.exit(1);
}

const digest = fs.readFileSync(DIGEST_PATH, 'utf8').trim();

const dental = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/outreach.localDentists.json'), 'utf8'));
const physio = fs.existsSync(path.join(ROOT, 'data/outreach.physioClinics.json'))
  ? JSON.parse(fs.readFileSync(path.join(ROOT, 'data/outreach.physioClinics.json'), 'utf8'))
  : [];

const all = [...dental, ...physio];

// Only MX-validated, non-bounced, non-excluded clinics
const recipients = all.filter(c =>
  c.email &&
  c.mxValidated && c.lastContactedAt &&
  !c.excludeForever &&
  c.status !== 'bounced' &&
  c.status !== 'opted-out' &&
  c.status !== 'unsubscribed'
);

const dateStr = new Date().toLocaleDateString('en-CA', { month: 'long', day: 'numeric' });
const dateStrFr = new Date().toLocaleDateString('fr-CA', { month: 'long', day: 'numeric' });

console.log(`Sending weekly digest to ${recipients.length} validated clinics...`);

let sent = 0;
let failed = 0;
for (const clinic of recipients) {
  const isQuebec = clinic.language === 'fr';
  const subject  = isQuebec
    ? `ClinicFlow Weekly — ${dateStrFr}`
    : `ClinicFlow Weekly — ${dateStr}`;

  try {
    await sendMail({ to: clinic.email, subject, text: digest });
    sent++;
    if (sent % 25 === 0 || sent === 1) console.log(`  Sent ${sent}/${recipients.length}`);
    await new Promise(r => setTimeout(r, 2000));
  } catch {
    failed++;
  }
}

console.log(`\nWeekly digest complete: ${sent} sent, ${failed} failed`);
