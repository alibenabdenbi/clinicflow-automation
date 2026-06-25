// src/cli/sendHitListTouch1.js — sends touch 1 to remaining pending hit list prospects
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
dotenv.config();
import { sendMail } from './src/services/mailer.js';
import { buildVideoEmail } from './src/templates/videoEmail.js';
import { buildFrenchEmail } from './src/templates/frenchEmail.js';

const ROOT     = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const sequence = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/hitlist/sequence-tracker.json'), 'utf8'));
const dental   = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/outreach.localDentists.json'), 'utf8'));

const remaining = sequence.filter(s => s.touches.touch1_email === 'pending');
console.log('Remaining touch 1:', remaining.length);

let sent = 0;
for (const prospect of remaining) {
  const clinic = dental.find(d => d.email === prospect.email) || prospect;
  let subject, body, htmlBody;

  if (clinic.language === 'fr') {
    const fr = buildFrenchEmail(clinic);
    subject  = fr.subject;
    body     = fr.body;
  } else {
    const vid = buildVideoEmail(clinic);
    subject   = vid.subject;
    body      = vid.textBody;
    htmlBody  = vid.htmlBody;
  }

  try {
    await sendMail({ to: prospect.email, subject, text: body, html: htmlBody });

    const idx = sequence.findIndex(s => s.email === prospect.email);
    sequence[idx].touches.touch1_email = 'sent';
    sequence[idx].touch1SentAt = new Date().toISOString();

    const didx = dental.findIndex(d => d.email === prospect.email);
    if (didx !== -1) {
      dental[didx].videoEmailSent    = true;
      dental[didx].videoEmailSentAt  = new Date().toISOString();
    }

    sent++;
    console.log('[' + sent + '/' + remaining.length + '] ' + prospect.clinicName + ' — ' + prospect.email);
    if (sent < remaining.length) await new Promise(r => setTimeout(r, 30000));
  } catch(e) {
    console.log('FAIL ' + prospect.clinicName + ' — ' + e.message);
  }
}

fs.writeFileSync(path.join(ROOT, 'data/hitlist/sequence-tracker.json'), JSON.stringify(sequence, null, 2));
fs.writeFileSync(path.join(ROOT, 'data/outreach.localDentists.json'), JSON.stringify(dental, null, 2));
console.log('\n' + sent + ' touch 1 emails sent — full 47-prospect hit list now in sequence');
