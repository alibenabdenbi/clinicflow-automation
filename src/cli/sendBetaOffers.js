// src/cli/sendBetaOffers.js
// Selects the warmest 5 prospects and sends personalized Beta Partner Program offers.
// Free forever in exchange for a testimonial + case study after 60 days.
//
// Usage:
//   node src/cli/sendBetaOffers.js               # dry run — preview only, no send
//   node src/cli/sendBetaOffers.js --send         # live send
//   node src/cli/sendBetaOffers.js --limit 3      # send to top N (default 5)

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
dotenv.config();

import { sendMail } from '../services/mailer.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT     = path.resolve(__dirname, '../..');
const DATA_DIR = path.join(ROOT, 'data');

const args   = process.argv.slice(2);
const LIVE   = args.includes('--send');
const LIMIT  = (() => { const i = args.indexOf('--limit'); return i !== -1 ? parseInt(args[i+1]) || 5 : 5; })();
const DELAY  = 15000; // 15s between sends

// ── Candidate scoring ──────────────────────────────────────────────────────

function scoreClinic(c) {
  let score = 0;
  if (c.painSignals?.length) score += 50;
  if (c.personalFollowupSent) score += 30;
  if (c.phone || c.googlePhone) score += 20;
  if (c.rating >= 4.5) score += 15;
  if (c.reviewCount > 100) score += 10;
  const local = c.email?.split('@')[0]?.toLowerCase() || '';
  if (!['info', 'contact', 'admin', 'office', 'reception'].includes(local)) score += 25;
  return { ...c, betaScore: score };
}

function selectCandidates(all) {
  const warm = all
    .filter(c =>
      c.email &&
      c.mxValidated &&
      !c.excludeForever &&
      !c.replied &&
      !c.betaOfferSent &&
      (c.personalFollowupSent || c.videoEmailSent || c.pilotOfferSent)
    )
    .map(scoreClinic)
    .sort((a, b) => b.betaScore - a.betaScore)
    .slice(0, LIMIT);

  if (warm.length >= LIMIT) return warm;

  // Fallback: any MX-validated clinic that hasn't been beta-offered
  const warmEmails = new Set(warm.map(w => w.email));
  const fallback = all
    .filter(c =>
      c.email &&
      c.mxValidated &&
      !c.excludeForever &&
      !c.replied &&
      !c.betaOfferSent &&
      !warmEmails.has(c.email)
    )
    .map(scoreClinic)
    .sort((a, b) => b.betaScore - a.betaScore)
    .slice(0, LIMIT - warm.length);

  return [...warm, ...fallback];
}

// ── Name cleaning ──────────────────────────────────────────────────────────

function isGoogleDescription(name) {
  return /^(best|top|#1|leading)\s/i.test(name) ||
         /^dentist\s+in\s/i.test(name) ||
         (/\s[-–]\s/.test(name) && name.length > 45);
}

function cleanName(clinic) {
  const raw = clinic.clinicName || clinic.name || '';
  if (!raw) return null;
  if (!isGoogleDescription(raw)) return raw.length > 45 ? raw.slice(0, 45) + '…' : raw;

  // Try to extract the last segment after " - " or " – "
  const parts = raw.split(/\s[-–]\s/);
  if (parts.length > 1) {
    const last = parts[parts.length - 1].trim();
    if (last.length <= 45 && !isGoogleDescription(last)) return last;
  }
  // Strip Google-description prefix
  const stripped = raw.replace(/^(best|top|#1|leading)\s+\S+\s+(near|in)\s+[^-–]+\s*[-–]\s*/i, '');
  if (stripped !== raw && stripped.length <= 45) return stripped;

  return null; // Can't extract a clean name — omit from subject
}

// ── Email builder ──────────────────────────────────────────────────────────

function painText(clinic) {
  const raw = Array.isArray(clinic.painSignals) ? clinic.painSignals[0] : clinic.painSignals;
  if (!raw) return null;
  const text = typeof raw === 'object' ? (raw.text || raw.signal || '') : String(raw);
  return text.trim().length > 5 ? text.trim() : null;
}

function buildBetaEmail(clinic) {
  const name = cleanName(clinic);
  const firstName = clinic.ownerName?.split(' ')?.[0] || '';
  const isQuebec = clinic.language === 'fr' ||
    (clinic.province === 'QC' && /clinique|dentaire|soins|physio/i.test(clinic.clinicName || ''));
  const pain = painText(clinic);

  const subject = isQuebec
    ? `Partenaire bêta${name ? ' — ' + name : ''} — accès gratuit à vie`
    : `Beta partner${name ? ' — ' + name : ''} — free forever`;

  const greeting = firstName
    ? (isQuebec ? `Bonjour ${firstName},` : `Hi ${firstName},`)
    : (isQuebec ? 'Bonjour,' : 'Hi,');

  const painLine = pain
    ? (isQuebec
        ? `Un patient${name ? ' de ' + name : ''} a mentionné « ${pain.slice(0, 60)} » dans une évaluation Google.\n\n`
        : `A patient${name ? ' of ' + name : ''} mentioned "${pain.slice(0, 60)}" in a Google review.\n\n`)
    : '';

  const body = isQuebec
    ? `${greeting}

${painLine}Je vais être direct.

ClinicFlow lance son programme de partenaires bêta — 5 cliniques seulement.

Ce que vous obtenez :
→ ClinicFlow gratuit pour toujours — aucun frais jamais
→ Configuration complète en 5 jours — nous gérons tout
→ Textos automatiques pour chaque appel manqué
→ Rappels de rendez-vous
→ Réactivation des patients inactifs
→ Rapport hebdomadaire

Ce que nous vous demandons en échange :
→ Un témoignage honnête après 60 jours
→ Une étude de cas avec vos vrais chiffres

C'est tout. Aucun engagement financier. Jamais.

Nous avons besoin de 5 cliniques qui veulent faire partie de quelque chose qui n'a pas encore été fait au Canada.

Intéressé?

— Mohamed
438-544-0442
clinicflowautomation.com`
    : `${greeting}

${painLine}I'm going to be direct with you.

ClinicFlow is launching a Beta Partner Program — 5 clinics only.

What you get:
→ ClinicFlow free forever — no fees, ever
→ Full setup in 5 days — we handle everything
→ Automatic text-back for every missed call
→ Appointment reminders
→ Inactive patient reactivation
→ Weekly digest

What we ask in return:
→ An honest testimonial after 60 days
→ A case study with your real numbers

That's it. No financial commitment. Ever.

We need 5 clinics who want to be part of something that hasn't been done in Canada yet.

Interested?

— Mohamed
438-544-0442
clinicflowautomation.com`;

  return { subject, body, variant: isQuebec ? 'BETA-FR' : 'BETA' };
}

// ── Main ───────────────────────────────────────────────────────────────────

const dental = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'outreach.localDentists.json'), 'utf8'));
let physio = [];
try { physio = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'outreach.physioClinics.json'), 'utf8')); } catch {}

const all  = [...dental, ...physio];
const candidates = selectCandidates(all);

const mode = LIVE ? 'LIVE SEND' : 'DRY RUN';
console.log(`\n=== Beta Partner Program — ${mode} ===`);
console.log(`Selected ${candidates.length} of ${LIMIT} candidates from ${all.length} total\n`);

candidates.forEach((c, i) => {
  const name   = cleanName(c) || c.clinicName;
  const pain   = painText(c);
  console.log(`${i+1}. ${name} — ${c.city || '?'}`);
  console.log(`   Email:  ${c.email}`);
  console.log(`   Score:  ${c.betaScore}pts  |  Phone: ${c.phone || c.googlePhone || 'none'}`);
  if (pain) console.log(`   Pain:   "${pain.slice(0, 70)}"`);
  console.log();
});

if (!LIVE) {
  console.log('─'.repeat(52));
  console.log('DRY RUN — no emails sent.');
  console.log('Preview first email:\n');
  if (candidates.length > 0) {
    const { subject, body } = buildBetaEmail(candidates[0]);
    console.log(`Subject: ${subject}`);
    console.log('─'.repeat(52));
    console.log(body);
    console.log('─'.repeat(52));
  }
  console.log('\nTo send for real: node src/cli/sendBetaOffers.js --send');
  process.exit(0);
}

// ── Live send ──────────────────────────────────────────────────────────────

let sent = 0;
let failed = 0;

for (const clinic of candidates) {
  const { subject, body, variant } = buildBetaEmail(clinic);
  try {
    await sendMail({ to: clinic.email, subject, text: body });

    // Mark in dental DB
    const di = dental.findIndex(d => d.email === clinic.email);
    if (di !== -1) {
      dental[di].betaOfferSent   = true;
      dental[di].betaOfferSentAt = new Date().toISOString();
      dental[di].betaVariant     = variant;
    }
    // Mark in physio DB
    const pi = physio.findIndex(p => p.email === clinic.email);
    if (pi !== -1) {
      physio[pi].betaOfferSent   = true;
      physio[pi].betaOfferSentAt = new Date().toISOString();
      physio[pi].betaVariant     = variant;
    }

    sent++;
    console.log(`✓ [${variant}] ${clinic.clinicName} — ${clinic.email}`);
  } catch (e) {
    failed++;
    console.log(`✗ ${clinic.clinicName} — ${e.message}`);
  }

  if (candidates.indexOf(clinic) < candidates.length - 1) {
    console.log(`  Waiting ${DELAY/1000}s...`);
    await new Promise(r => setTimeout(r, DELAY));
  }
}

// Save both databases
fs.writeFileSync(path.join(DATA_DIR, 'outreach.localDentists.json'), JSON.stringify(dental, null, 2));
if (physio.length > 0) {
  fs.writeFileSync(path.join(DATA_DIR, 'outreach.physioClinics.json'), JSON.stringify(physio, null, 2));
}

console.log('\n=== Beta Program Launched ===');
console.log(`${sent} offer${sent !== 1 ? 's' : ''} sent  |  ${failed} failed`);
console.log('\nWhen one says yes:');
console.log('  node src/cli/activatePilot.js --clinic "Name" --email addr@domain.com --beta');
console.log('\nAfter 60 days:');
console.log('  node src/cli/generateCaseStudy.js --clinic slug');
console.log('\nOne real number is worth 10,000 cold emails.');
