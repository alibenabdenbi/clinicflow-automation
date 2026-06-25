// src/cli/sendPhysicalLetters.js
// Sends personalized physical letters via PostGrid to top priority prospects.
//
// Usage:
//   node src/cli/sendPhysicalLetters.js --dry-run          # preview, no API calls
//   node src/cli/sendPhysicalLetters.js --limit 10         # send 10 letters live
//   node src/cli/sendPhysicalLetters.js --limit 50         # full 50-letter campaign

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
dotenv.config();

if (process.platform === 'win32') process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

import { createLetter, letterHtml, MONTHLY_LOSS } from '../services/postGridMailer.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');
const DATA_DIR = path.join(ROOT, 'data');

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const LIMIT = (() => {
  const i = args.indexOf('--limit');
  return i !== -1 ? parseInt(args[i + 1]) || 5 : 5;
})();

const API_KEY = process.env.POSTGRID_API_KEY;
if (!API_KEY && !DRY_RUN) {
  console.log('');
  console.log('POSTGRID_API_KEY not set in .env');
  console.log('');
  console.log('Setup steps:');
  console.log('  1. Go to postgrid.com (Canadian company, free account)');
  console.log('  2. Dashboard → API Keys → copy your test key (starts with test_sk_)');
  console.log('  3. Add to .env:  POSTGRID_API_KEY=test_sk_...');
  console.log('  4. Run: node src/cli/sendPhysicalLetters.js --limit 5 --dry-run');
  console.log('  5. Live run: node src/cli/sendPhysicalLetters.js --limit 50');
  console.log('');
  console.log('Cost: ~$2-3/letter CAD (printing + postage, delivered in 3-5 days)');
  process.exit(1);
}

const priority = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'hitlist', 'conversion-priority.json'), 'utf8'));
const dental   = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'outreach.localDentists.json'), 'utf8'));

// Merge and filter to those with a physical address
const targets = priority
  .map(p => ({ ...dental.find(d => d.email === p.email) || {}, ...p }))
  .filter(c =>
    (c.addressLine1 || c.address || c.googleAddress || c.formattedAddress) &&
    !c.letterSent &&
    !c.excludeForever
  )
  .slice(0, LIMIT);

if (targets.length === 0) {
  console.log('No targets with physical addresses found.');
  console.log('');
  console.log('Run address enrichment first:');
  console.log('  node src/cli/enrichAddresses.js --priority-only');
  console.log('');
  console.log('Priority clinics with placeId:', priority.filter(p => {
    const c = dental.find(d => d.email === p.email);
    return c?.placeId;
  }).length, '/', priority.length);
  process.exit(0);
}

const mode = DRY_RUN ? 'DRY RUN' : 'LIVE';
console.log(`\n=== PostGrid Physical Letter Campaign — ${mode} ===`);
console.log(`Sending ${targets.length} personalized letters\n`);

let sent = 0;
let failed = 0;

for (const clinic of targets) {
  const addressLine1 = clinic.addressLine1 || clinic.address || clinic.googleAddress || clinic.formattedAddress;
  const slug = clinic.slug || clinic.clinicName?.toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'clinic';

  if (DRY_RUN) {
    console.log(`[DRY RUN] ${clinic.clinicName}`);
    console.log(`  Address:  ${addressLine1}`);
    console.log(`  City:     ${clinic.city || '?'}  Province: ${clinic.province || 'ON'}`);
    console.log(`  Postal:   ${clinic.postalCode || '(none)'}`);
    console.log(`  URL:      clinicflowautomation.com/for/${slug}`);
    console.log(`  Rating:   ${clinic.rating ? `${clinic.rating}★ (${clinic.reviewCount} reviews)` : 'n/a'}`);
    const _sig = Array.isArray(clinic.painSignals) ? clinic.painSignals[0] : clinic.painSignals;
    const _sigText = _sig ? String(typeof _sig === 'object' ? (_sig.text || _sig.signal || '') : _sig).slice(0, 60) : 'none';
    console.log(`  Pain:     ${_sigText || 'none'}`);
    console.log();
    continue;
  }

  try {
    const result = await createLetter(clinic, API_KEY);
    const idx = dental.findIndex(d => d.email === clinic.email);
    if (idx !== -1) {
      dental[idx].letterSent    = true;
      dental[idx].letterSentAt  = new Date().toISOString();
      dental[idx].postGridId    = result.id;
    }
    sent++;
    console.log(`✓ ${clinic.clinicName} — PostGrid ID: ${result.id}`);
    await new Promise(r => setTimeout(r, 1000));
  } catch (e) {
    failed++;
    console.log(`✗ ${clinic.clinicName} — ${e.message}`);
  }
}

if (!DRY_RUN) {
  fs.writeFileSync(path.join(DATA_DIR, 'outreach.localDentists.json'), JSON.stringify(dental, null, 2));
}

console.log(`\n=== Campaign ${DRY_RUN ? 'preview' : 'complete'} ===`);
if (DRY_RUN) {
  console.log(`${targets.length} letters previewed above`);
  console.log('Run without --dry-run to send live');
} else {
  console.log(`${sent} letters queued for printing and delivery`);
  if (failed > 0) console.log(`${failed} failed — check error messages above`);
  console.log('Arrives at clinics in 3-5 business days');
}

console.log(`\nEstimated cost: $${(targets.length * 2.5).toFixed(0)}–$${(targets.length * 3).toFixed(0)} CAD`);
console.log('One client signed = $500 = campaign pays for itself 3×');
