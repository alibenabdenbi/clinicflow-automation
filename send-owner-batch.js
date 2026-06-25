import fs from 'fs';
import dotenv from 'dotenv';
dotenv.config();
import { sendMail } from './src/services/mailer.js';

const dental = JSON.parse(fs.readFileSync('data/outreach.localDentists.json', 'utf8'));

const targets = [
  'muneeb@1citycentredentistry.com',
  'richard@gatewaypd.ca',
  'bernie@sutherlanddental.ca',
  'hammad@waterviewdentaltoronto.com',
  'hamid@manorparkdental.ca',
  'alycia@fortrichmonddental.com',
  'young@torontolakeshoredental.ca',
  'rashin@smiledentaltoronto.ca',
  'ramez@dentalimplantsclinic.ca',
  'ronda@brentwoodvillagedental.com',
  'tony.alberola@cliniquesamuelholland.com',
  'dr.reddy@ksdc.ca',
  'bruce@southpointdentures.com',
  'jf@drmasse.com',
  'vishal@auraortho.com',
  'benson@vancouverdental.com',
  'donald@arbourlakedental.com',
];

let sent = 0;
for (const email of targets) {
  const clinic = dental.find(d => d.email === email);
  if (!clinic) { console.log('Not found:', email); continue; }

  const firstName = clinic.contactName || '';
  const slug = clinic.clinicName?.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  const isQuebec = clinic.language === 'fr';
  const pain = clinic.painSignals?.[0];
  const city = clinic.city;

  const subject = pain
    ? (isQuebec ? `Avis patient — ${clinic.clinicName.slice(0, 30)}` : `Patient review — ${clinic.clinicName.slice(0, 30)}`)
    : (isQuebec ? `Question rapide, ${firstName}` : `Quick question, ${firstName}`);

  const body = isQuebec
    ? `${firstName ? 'Bonjour ' + firstName + ',' : 'Bonjour,'}

${pain
  ? `Un patient a mentionné "${pain.slice(0, 60)}" dans un avis sur ${clinic.clinicName}.`
  : `En cartographiant les appels manqués dans les cliniques de ${city}, ${clinic.clinicName} est ressortie dans nos données.`
}

Quand un patient appelle et que personne ne répond, ClinicFlow envoie automatiquement un texto en 60 secondes. Aucun nouveau logiciel. Aucune formation. Un seul paramètre sur votre téléphone existant — 2 minutes.

clinicflowautomation.com/for/${slug}

Pilote gratuit 30 jours disponible cette semaine.

— Mohamed
438-544-0442`
    : `Hi ${firstName},

${pain
  ? `A patient mentioned "${pain.slice(0, 60)}" in a review of ${clinic.clinicName}.`
  : `Been mapping missed call patterns across ${city} clinics — ${clinic.clinicName} came up in our data.`
}

When a patient calls and no one picks up, ClinicFlow texts them automatically within 60 seconds. No new software. No training. One call forwarding setting — 2 minutes.

clinicflowautomation.com/for/${slug}

Free 30-day pilot — one spot open this week.

Worth a quick reply?

— Mohamed
438-544-0442`;

  try {
    await sendMail({ to: email, subject, text: body });
    const idx = dental.findIndex(d => d.email === email);
    if (idx !== -1) {
      dental[idx].ownerEmailSent = true;
      dental[idx].ownerEmailSentAt = new Date().toISOString();
      dental[idx].status = 'sent';
      dental[idx].lastContactedAt = new Date().toISOString();
    }
    sent++;
    console.log(`[${sent}/17] ${firstName} — ${clinic.clinicName} — ${city}`);
    await new Promise(r => setTimeout(r, 25000));
  } catch (e) {
    console.log(`FAIL ${clinic.clinicName} — ${e.message}`);
  }
}

fs.writeFileSync('data/outreach.localDentists.json', JSON.stringify(dental, null, 2));
console.log(`\n${sent}/17 sent`);
