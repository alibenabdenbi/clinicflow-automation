import fs from 'fs';
import dotenv from 'dotenv';
dotenv.config();
import { sendMail } from '../src/services/mailer.js';
import { buildVideoEmail } from '../src/templates/videoEmail.js';

const dental = JSON.parse(fs.readFileSync('data/outreach.localDentists.json', 'utf8'));
let physio = [], salon = [];
try { physio = JSON.parse(fs.readFileSync('data/outreach.physioClinics.json', 'utf8')); } catch {}
try { salon = JSON.parse(fs.readFileSync('data/outreach.salonBusinesses.json', 'utf8')); } catch {}
const all = [...dental, ...physio, ...salon];

const SKIP = ['info','contact','hello','admin','office','reception','front','booking',
  'appointment','dental','clinic','welcome','smile','team','care','health',
  'salon','spa','beauty','physio','therapy'];

const targets = all.filter(c => {
  const local = c.email?.split('@')[0]?.toLowerCase() || '';
  const isNamed = local.length > 2 && local.length < 20 &&
    !/\d{3}/.test(local) && !SKIP.includes(local);
  return c.email && !c.videoEmailSent && !c.pilotOfferSent && !c.screenshotSentAt &&
    c.status !== 'bounced' && c.status === 'todo' &&
    c.email !== 'youremail@gmail.com' && !c.email.includes('example') && isNamed;
}).sort((a,b) => (b.priorityScore||0) - (a.priorityScore||0)).slice(0, 20);

console.log(`Sending video emails to ${targets.length} named prospects tonight...\n`);
targets.forEach(c => console.log(` - ${c.clinicName} — ${c.email} — ${c.city}`));
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
    const si = salon.findIndex(s => s.email === clinic.email);
    if (si !== -1) { salon[si].videoEmailSent = true; salon[si].videoEmailSentAt = new Date().toISOString(); }
    sent++;
    console.log(`✓ [${sent}/${targets.length}] ${clinic.clinicName} — ${clinic.email} — ${clinic.city}`);
    if (i < targets.length - 1) { console.log('  Waiting 30s...'); await new Promise(r => setTimeout(r, 30000)); }
  } catch(e) { console.log(`✗ ${clinic.clinicName} — ${e.message}`); }
}

fs.writeFileSync('data/outreach.localDentists.json', JSON.stringify(dental, null, 2));
if (physio.length) fs.writeFileSync('data/outreach.physioClinics.json', JSON.stringify(physio, null, 2));
if (salon.length) fs.writeFileSync('data/outreach.salonBusinesses.json', JSON.stringify(salon, null, 2));

console.log(`\n✓ ${sent}/${targets.length} video emails sent tonight`);
console.log('These land in inboxes now.');
console.log('Tuesday morning they open their email and see a play button.');
console.log('Nobody else is doing this.');
