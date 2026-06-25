// src/cli/sendCustom.js
// Sends a single custom email from a JSON file in data/custom-sends/
// Usage: node src/cli/sendCustom.js data/custom-sends/limbour-fu3.json

import fs from 'fs';
import dotenv from 'dotenv';
import nodemailer from 'nodemailer';
dotenv.config();

const file = process.argv[2];
if (!file) {
  console.error('Usage: node src/cli/sendCustom.js <path-to-json>');
  process.exit(1);
}

const email = JSON.parse(fs.readFileSync(file, 'utf-8'));

if (email.sent) {
  console.log(`Already sent to ${email.to} at ${email.sentAt}. Skipping.`);
  process.exit(0);
}

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT),
  secure: Number(process.env.SMTP_PORT) === 465,
  auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  tls: { rejectUnauthorized: false },
});

await transporter.verify();

await transporter.sendMail({
  from: `Mohamed - ClinicFlow <${process.env.SMTP_FROM}>`,
  to: email.to,
  subject: email.subject,
  text: email.body,
});

// Mark as sent so it can't fire twice
email.sent = true;
email.sentAt = new Date().toISOString();
fs.writeFileSync(file, JSON.stringify(email, null, 2));

// Update outreach record status so generic FU3 doesn't double-send
if (email.clinicEmail || email.to) {
  const queuePath = 'data/outreach.localDentists.json';
  try {
    const leads = JSON.parse(fs.readFileSync(queuePath, 'utf-8'));
    const target = email.to;
    const idx = leads.findIndex(l => (l.email || '').toLowerCase() === target.toLowerCase());
    if (idx !== -1 && leads[idx].status === 'followup_2_sent') {
      leads[idx].status = 'followup_3_sent';
      leads[idx].followup3SentAt = email.sentAt;
      leads[idx].followupCount = 3;
      fs.writeFileSync(queuePath, JSON.stringify(leads, null, 2));
      console.log(`  Updated outreach status → followup_3_sent (${leads[idx].clinicName})`);
    }
  } catch { /* non-fatal — record update is best-effort */ }
}

console.log(`✓ Sent to ${email.to}`);
console.log(`  Subject: ${email.subject}`);
console.log(`  Marked sent in ${file}`);
