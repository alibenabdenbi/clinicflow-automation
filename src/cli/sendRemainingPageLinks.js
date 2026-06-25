// src/cli/sendRemainingPageLinks.js
// Sends personalized /for/ page links to all hit list prospects who haven't received one.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
dotenv.config();
import { sendMail } from '../services/mailer.js';

const ROOT     = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const sequence = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/hitlist/sequence-tracker.json'), 'utf8'));
const dental   = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/outreach.localDentists.json'), 'utf8'));

const targets = sequence
  .filter(s => s.touches.touch1_email === 'sent' && !s.personalizedPageSent && !s.replied)
  .map(s => {
    const clinic = dental.find(d => d.email === s.email) || {};
    return { ...s, ...clinic };
  })
  .filter(c => c.email);

console.log('Sending personalized page links to ' + targets.length + ' prospects...\n');

let sent = 0;
for (const clinic of targets) {
  const slug      = (clinic.clinicName || 'clinic').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const firstName = clinic.ownerName?.split(' ')[0] || '';
  const isQuebec  = clinic.language === 'fr';
  const pageUrl   = 'https://clinicflowautomation.com/for/' + slug;
  const hasPain   = (clinic.painSignals?.length || 0) > 0;

  const subject = isQuebec
    ? "J'ai créé quelque chose pour " + clinic.clinicName
    : 'Built this specifically for ' + clinic.clinicName;

  const body = isQuebec
    ? (firstName ? 'Bonjour ' + firstName + ',' : 'Bonjour,')
      + '\n\nJ\'ai remarqué ' + clinic.clinicName + ' dans nos données et j\'ai créé cette page spécifiquement pour vous :\n\n'
      + pageUrl
      + '\n\nVos données réelles — votre note Google, votre ville'
      + (hasPain ? ', et ce qu\'un patient a mentionné dans ses avis' : '')
      + '.\n\nPrend 2 minutes à lire.\n\n— Mohamed\n438-544-0442'
    : (firstName ? 'Hi ' + firstName + ',' : 'Hi,')
      + '\n\nI noticed ' + clinic.clinicName + ' in our dataset and built this specifically for you:\n\n'
      + pageUrl
      + '\n\nYour actual data — your Google rating, your city'
      + (hasPain ? ', and what a patient mentioned in your reviews' : '')
      + '.\n\nTakes 2 minutes to read.\n\n— Mohamed\n438-544-0442';

  try {
    await sendMail({ to: clinic.email, subject, text: body });

    const idx = sequence.findIndex(s => s.email === clinic.email);
    if (idx !== -1) {
      sequence[idx].personalizedPageSent   = true;
      sequence[idx].personalizedPageSentAt = new Date().toISOString();
    }

    sent++;
    console.log('[' + sent + '/' + targets.length + '] ' + clinic.clinicName);
    console.log('   -> ' + pageUrl);
    if (sent < targets.length) await new Promise(r => setTimeout(r, 15000));
  } catch(e) {
    console.log('FAIL ' + clinic.clinicName + ' -- ' + e.message);
  }
}

fs.writeFileSync(path.join(ROOT, 'data/hitlist/sequence-tracker.json'), JSON.stringify(sequence, null, 2));
console.log('\n' + sent + ' personalized page links sent');
console.log('\nEvery hit list prospect now has:');
console.log('  touch 1 email (video or French)');
console.log('  personalized /for/ page');
console.log('  page link sent to inbox');
console.log('\nSMS fires to your phone the moment any of them visits their page.');
