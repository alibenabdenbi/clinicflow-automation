import fs from 'fs';
import dotenv from 'dotenv';
dotenv.config();
import { sendMail } from '../src/services/mailer.js';
import { buildVideoEmail } from '../src/templates/videoEmail.js';

const dental = JSON.parse(fs.readFileSync('data/outreach.localDentists.json', 'utf8'));
let physio = [];
try { physio = JSON.parse(fs.readFileSync('data/outreach.physioClinics.json', 'utf8')); } catch {}
const all = [...dental, ...physio];

const GENERIC = ['info','contact','hello','admin','office','reception','front','booking',
  'appointment','dental','clinic','welcome','smile','team','care','health','general','enquiry'];

const targets = all.filter(c => {
  const local = c.email?.split('@')[0]?.toLowerCase() || '';
  const isNamed = local.length > 2 && local.length < 15 &&
    !/\d/.test(local) && !GENERIC.includes(local);
  return isNamed && c.email && c.emailConfidence === 'high' &&
    !c.videoEmailSent && !c.pilotOfferSent && !c.screenshotSentAt &&
    c.status !== 'bounced' && c.status === 'todo';
}).slice(0, 15);

console.log(`Sending video email to ${targets.length} named prospects...\n`);
targets.forEach(c => console.log(' -', c.clinicName, '—', c.email));
console.log();

let sent = 0;
for (let i = 0; i < targets.length; i++) {
  const clinic = targets[i];
  const { subject, textBody, htmlBody } = buildVideoEmail(clinic);

  try {
    await sendMail({ to: clinic.email, subject, text: textBody, html: htmlBody });

    const di = dental.findIndex(d => d.email === clinic.email);
    if (di !== -1) { dental[di].videoEmailSent = true; dental[di].videoEmailSentAt = new Date().toISOString(); }
    const pi = physio.findIndex(p => p.email === clinic.email);
    if (pi !== -1) { physio[pi].videoEmailSent = true; physio[pi].videoEmailSentAt = new Date().toISOString(); }

    sent++;
    console.log(`✓ [${sent}/${targets.length}] ${clinic.clinicName} — ${clinic.email}`);
    console.log(`  Subject: ${subject}`);
    if (i < targets.length - 1) { console.log('  Waiting 30s...'); await new Promise(r => setTimeout(r, 30000)); }
  } catch(e) { console.log(`✗ ${clinic.clinicName} — ${e.message}`); }
}

fs.writeFileSync('data/outreach.localDentists.json', JSON.stringify(dental, null, 2));
if (physio.length) fs.writeFileSync('data/outreach.physioClinics.json', JSON.stringify(physio, null, 2));
console.log(`\n✓ ${sent}/${targets.length} video emails sent`);
