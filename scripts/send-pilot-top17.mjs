import fs from 'fs';
import dotenv from 'dotenv';
dotenv.config();
import { sendMail } from '../src/services/mailer.js';
import { buildPilotEmail } from '../src/templates/pilotOffer.js';

const dental = JSON.parse(fs.readFileSync('data/outreach.localDentists.json', 'utf8'));
let physio = [];
try { physio = JSON.parse(fs.readFileSync('data/outreach.physioClinics.json', 'utf8')); } catch {}
const all = [...dental, ...physio];

const skipEmails = [
  'cdlm.info@gmail.com',
  'staffdrpkahlon@gmail.com',
  'kpennell@torontophysiotherapy.ca',
];

const targets = all
  .filter(c =>
    c.status === 'todo' &&
    c.email &&
    !c.pilotOfferSent &&
    !skipEmails.includes(c.email) &&
    c.email !== 'youremail@gmail.com' &&
    !c.email.includes('example') &&
    c.status !== 'bounced'
  )
  .map(c => {
    let score = 0;
    const local = c.email?.split('@')[0]?.toLowerCase() || '';
    const isNamed = local.length > 2 && local.length < 15 &&
      !/\d/.test(local) &&
      !['info','contact','hello','admin','office','reception',
        'front','booking','appointment','dental','clinic',
        'welcome','smile','team','care','health'].includes(local);
    if (isNamed) score += 30;
    if (c.painSignals?.length > 0) score += 25;
    if (c.rating >= 4.8) score += 10;
    if (c.reviewCount > 200) score += 10;
    if (c.emailConfidence === 'high') score += 15;
    return { ...c, score };
  })
  .sort((a,b) => b.score - a.score)
  .slice(0, 17);

console.log(`Sending pilot offer to ${targets.length} prospects...\n`);

let sent = 0;
for (let i = 0; i < targets.length; i++) {
  const clinic = targets[i];
  const { subject, body } = buildPilotEmail(clinic);

  try {
    await sendMail({ to: clinic.email, subject, text: body });

    const dentalIdx = dental.findIndex(d => d.email === clinic.email);
    if (dentalIdx !== -1) {
      dental[dentalIdx].pilotOfferSent   = true;
      dental[dentalIdx].pilotOfferSentAt = new Date().toISOString();
    }
    const physioIdx = physio.findIndex(p => p.email === clinic.email);
    if (physioIdx !== -1) {
      physio[physioIdx].pilotOfferSent   = true;
      physio[physioIdx].pilotOfferSentAt = new Date().toISOString();
    }

    sent++;
    console.log(`✓ [${sent}/17] ${clinic.clinicName} — ${clinic.email}`);

    if (i < targets.length - 1) {
      console.log(`  Waiting 30s...`);
      await new Promise(r => setTimeout(r, 30000));
    }
  } catch(e) {
    console.log(`✗ Failed: ${clinic.clinicName} — ${e.message}`);
  }
}

fs.writeFileSync('data/outreach.localDentists.json', JSON.stringify(dental, null, 2));
if (physio.length) fs.writeFileSync('data/outreach.physioClinics.json', JSON.stringify(physio, null, 2));
console.log(`\n✓ ${sent}/17 pilot offers sent`);
