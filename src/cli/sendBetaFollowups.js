// src/cli/sendBetaFollowups.js
// Sends timed follow-ups to beta offer recipients who haven't replied.
// Day 3: scarcity — one spot claimed, 1 left
// Day 5: pain signal resurface — their actual Google review quote
// Day 7: demo invite — text the number and experience it
//
// Runs daily from scheduler at 9:47am. Safe to re-run — guards prevent double-sends.
// Usage: node src/cli/sendBetaFollowups.js [--dry-run]

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
dotenv.config();

import { sendMail } from '../services/mailer.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT      = path.resolve(__dirname, '../..');
const DATA_DIR  = path.join(ROOT, 'data');

const DRY_RUN = process.argv.includes('--dry-run');
const DAY_MS  = 24 * 60 * 60 * 1000;
const DELAY   = 15000; // 15s between sends

// ── Helpers (mirrors sendBetaOffers.js) ──────────────────────────────────────

function isGoogleDescription(name) {
  return /^(best|top|#1|leading)\s/i.test(name) ||
         /^dentist\s+in\s/i.test(name) ||
         (/\s[-–]\s/.test(name) && name.length > 45);
}

function cleanName(clinic) {
  const raw = clinic.clinicName || clinic.name || '';
  if (!raw) return null;
  if (!isGoogleDescription(raw)) return raw.length > 45 ? raw.slice(0, 45) + '…' : raw;
  const parts = raw.split(/\s[-–]\s/);
  if (parts.length > 1) {
    const last = parts[parts.length - 1].trim();
    if (last.length <= 45 && !isGoogleDescription(last)) return last;
  }
  return null;
}

function painText(clinic) {
  const raw = Array.isArray(clinic.painSignals) ? clinic.painSignals[0] : clinic.painSignals;
  if (!raw) return null;
  const text = typeof raw === 'object' ? (raw.text || raw.signal || '') : String(raw);
  return text.trim().length > 5 ? text.trim().slice(0, 120) : null;
}

function isQuebec(clinic) {
  return clinic.language === 'fr' ||
    (clinic.province === 'QC' && /clinique|dentaire|soins|physio/i.test(clinic.clinicName || ''));
}

function firstName(clinic) {
  return clinic.ownerName?.split(' ')?.[0] || '';
}

// ── Email builders ────────────────────────────────────────────────────────────

function buildFollowup1(clinic) {
  const fr    = isQuebec(clinic);
  const name  = cleanName(clinic);
  const first = firstName(clinic);

  const subject = fr
    ? `Une place vient d'être prise${name ? ' — ' + name : ''}`
    : `One spot just got claimed${name ? ' — ' + name : ''}`;

  const greeting = first
    ? (fr ? `Bonjour ${first},` : `Hi ${first},`)
    : (fr ? 'Bonjour,' : 'Hi,');

  const body = fr
    ? `${greeting}

Une des 5 places bêta vient d'être prise.

Il en reste 1.

Si vous aviez envisagé d'y participer — c'est maintenant ou jamais.

clinicflowautomation.com/beta

— Mohamed
438-544-0442`
    : `${greeting}

One of the 5 beta spots just got claimed.

1 left.

If you were considering it — now or never.

clinicflowautomation.com/beta

— Mohamed
438-544-0442`;

  return { subject, body };
}

function buildFollowup2(clinic) {
  const fr    = isQuebec(clinic);
  const name  = cleanName(clinic) || clinic.clinicName;
  const first = firstName(clinic);
  const pain  = painText(clinic);

  // If no pain signal, skip this touch
  if (!pain) return null;

  const subject = fr
    ? `Ce qu'un patient a dit${name ? ' — ' + name : ''}`
    : `What a patient said${name ? ' — ' + name : ''}`;

  const greeting = first
    ? (fr ? `Bonjour ${first},` : `Hi ${first},`)
    : (fr ? 'Bonjour,' : 'Hi,');

  const body = fr
    ? `${greeting}

Je voulais vous montrer quelque chose avant de fermer la dernière place bêta.

Un patient a écrit ceci${name ? ' sur ' + name : ''} :

"${pain}"

ClinicFlow aurait intercepté cet appel manqué automatiquement. Le patient aurait reçu un texto en 60 secondes. Il aurait pris rendez-vous.

La place gratuite est encore disponible.

clinicflowautomation.com/beta

— Mohamed
438-544-0442`
    : `${greeting}

Wanted to show you something before I close the last beta spot.

A patient wrote this${name ? ' about ' + name : ''} :

"${pain}"

ClinicFlow would have caught that missed call automatically. The patient would have gotten a text in 60 seconds. They would have booked.

The free spot is still open.

clinicflowautomation.com/beta

— Mohamed
438-544-0442`;

  return { subject, body };
}

function buildFollowup3(clinic) {
  const fr    = isQuebec(clinic);
  const first = firstName(clinic);

  const subject = fr
    ? `Voyez comment ça fonctionne — 60 secondes`
    : `See it working — 60 seconds`;

  const greeting = first
    ? (fr ? `Bonjour ${first},` : `Hi ${first},`)
    : (fr ? 'Bonjour,' : 'Hi,');

  const body = fr
    ? `${greeting}

Avant que je ferme définitivement la dernière place bêta — voulez-vous voir le système en action?

Textez n'importe quoi au :

+1 (575) 573-5822

C'est exactement ce que vos patients vivraient quand ils appellent et que personne ne répond.

60 secondes. Aucun engagement.

— Mohamed
438-544-0442`
    : `${greeting}

Before I close the last beta spot for good — want to see it working?

Text anything to:

+1 (575) 573-5822

That's exactly what your patients would experience when they call and no one picks up.

60 seconds. Zero commitment.

— Mohamed
438-544-0442`;

  return { subject, body };
}

// ── Main ──────────────────────────────────────────────────────────────────────

const dental = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'outreach.localDentists.json'), 'utf8'));
let physio = [];
try { physio = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'outreach.physioClinics.json'), 'utf8')); } catch {}

const now = Date.now();
let sent = 0;

for (const db of [dental, physio]) {
  for (let i = 0; i < db.length; i++) {
    const clinic = db[i];

    if (!clinic.betaOfferSent)   continue;
    if (!clinic.betaOfferSentAt) continue;
    if (clinic.replied)          continue;
    if (clinic.betaAccepted)     continue;
    if (!clinic.email)           continue;

    const daysSince = (now - new Date(clinic.betaOfferSentAt).getTime()) / DAY_MS;

    let touch = null;
    let touchKey = null;
    let touchAtKey = null;

    if (daysSince >= 3 && !clinic.betaFollowup1Sent) {
      touch       = buildFollowup1(clinic);
      touchKey    = 'betaFollowup1Sent';
      touchAtKey  = 'betaFollowup1SentAt';
    } else if (daysSince >= 5 && !clinic.betaFollowup2Sent) {
      touch       = buildFollowup2(clinic);  // may be null if no pain signal
      touchKey    = 'betaFollowup2Sent';
      touchAtKey  = 'betaFollowup2SentAt';
      // Still mark as sent even if skipped, so we don't block FU3
      if (!touch) {
        db[i].betaFollowup2Sent   = true;
        db[i].betaFollowup2SentAt = new Date().toISOString();
        db[i].betaFollowup2Skip   = 'no-pain-signal';
        console.log(`  Skipped day-5 (no pain signal): ${clinic.clinicName}`);
        continue;
      }
    } else if (daysSince >= 7 && !clinic.betaFollowup3Sent) {
      touch      = buildFollowup3(clinic);
      touchKey   = 'betaFollowup3Sent';
      touchAtKey = 'betaFollowup3SentAt';
    }

    if (!touch) continue;

    const touchNum = touchKey.includes('1') ? 3 : touchKey.includes('2') ? 5 : 7;
    console.log(`Day-${touchNum} FU → ${clinic.clinicName} <${clinic.email}>`);
    if (DRY_RUN) {
      console.log(`  Subject: ${touch.subject}`);
      console.log(`  Preview: ${touch.body.slice(0, 80).replace(/\n/g, ' ')}...`);
      console.log();
      continue;
    }

    try {
      await sendMail({ to: clinic.email, subject: touch.subject, text: touch.body });
      db[i][touchKey]   = true;
      db[i][touchAtKey] = new Date().toISOString();
      sent++;
      console.log(`  ✓ sent`);
    } catch (err) {
      console.error(`  ✗ ${err.message}`);
    }

    if (sent > 0) {
      await new Promise(r => setTimeout(r, DELAY));
    }
  }
}

if (!DRY_RUN) {
  fs.writeFileSync(path.join(DATA_DIR, 'outreach.localDentists.json'), JSON.stringify(dental, null, 2));
  if (physio.length > 0) {
    fs.writeFileSync(path.join(DATA_DIR, 'outreach.physioClinics.json'), JSON.stringify(physio, null, 2));
  }
}

if (DRY_RUN) {
  console.log('DRY RUN complete — no emails sent.');
} else {
  console.log(`Beta follow-up sequence complete: ${sent} sent`);
}
