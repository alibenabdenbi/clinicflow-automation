import fs from 'fs';
import dotenv from 'dotenv';
dotenv.config();
import { sendMail } from '../src/services/mailer.js';

const dental = JSON.parse(fs.readFileSync('data/outreach.localDentists.json', 'utf8'));

const targets = [
  'family braces',
  'nourkeyhani',
  'yonge dental care',
  'arch dental centre',
];

for (const name of targets) {
  const clinic = dental.find(c =>
    c.clinicName?.toLowerCase().includes(name.toLowerCase())
  );

  if (!clinic?.email) {
    console.log('Not found:', name);
    continue;
  }

  const firstName = clinic.ownerName?.split(' ')[0] || 'there';

  await sendMail({
    to: clinic.email,
    subject: `Re: ${clinic.clinicName}`,
    text: `Hi ${firstName},

Wanted to follow up personally.

I have one free pilot spot open this week for a ${clinic.city || 'Canadian'} clinic.

Full setup at no cost. You just forward missed calls to a number I give you — takes 2 minutes. After 30 days I send you a report showing exactly how many patients you recovered.

No commitment. No risk.

Worth a quick reply?

— Mohamed
438-544-0442
clinicflowautomation.com/live`,
  });

  console.log('✓ Sent to:', clinic.clinicName, '—', clinic.email);
  await new Promise(r => setTimeout(r, 15000));
}

console.log('\nDone. Ball is in their court.');
