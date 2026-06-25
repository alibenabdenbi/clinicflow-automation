// src/cli/activatePilot.js
// Run when a clinic says YES to pilot or beta offer.
//
// Usage:
//   node src/cli/activatePilot.js --clinic "Fallowfield Dental" --email info@fd.com [--phone +1...]
//   node src/cli/activatePilot.js --clinic "Park Lawn Dental" --email info@pl.ca --beta   ← free forever

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');
const DATA_DIR = path.join(ROOT, 'data');

const args      = process.argv.slice(2);
const getArg    = (name) => { const i = args.indexOf(name); return i !== -1 ? args[i+1] : null; };

const clinicName = getArg('--clinic');
const email      = getArg('--email');
const phone      = getArg('--phone') || '';
const isBeta     = args.includes('--beta');

if (!clinicName || !email) {
  console.log('Usage:');
  console.log('  node src/cli/activatePilot.js --clinic "Name" --email addr@domain.com [--phone +1...]');
  console.log('  Add --beta for Beta Partner track (free forever, 60-day case study)');
  process.exit(1);
}

const slug     = clinicName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
const now      = new Date();
const daysLen  = isBeta ? 60 : 30;
const endDate  = new Date(now.getTime() + daysLen * 24 * 60 * 60 * 1000);
const track    = isBeta ? 'beta' : 'pilot';

const label = isBeta ? 'BETA PARTNER' : 'PILOT';
console.log(`\n ACTIVATING ${label}: ${clinicName}`);
console.log('='.repeat(40) + '\n');

// ── 1. Client directory ────────────────────────────────────────────────────

const clientDir = path.join(DATA_DIR, 'clients', slug);
fs.mkdirSync(clientDir, { recursive: true });

const brain = {
  clinicName,
  clinicSlug:    slug,
  email,
  phone,
  market:        'dental',
  track,
  status:        track,
  activatedAt:   now.toISOString(),
  endDate:       endDate.toISOString(),
  freeForever:   isBeta,
  configured:    false,
  forwardingConfirmed: false,
  live:          false,
  // Beta-specific
  testimonialRequested:  false,
  testimonialReceived:   false,
  caseStudyGenerated:    false,
  lastUpdated:           now.toISOString(),
};

fs.writeFileSync(path.join(clientDir, 'brain.json'), JSON.stringify(brain, null, 2));

// Seed an empty metrics file the case study generator will fill over time
const metrics = {
  callsTotal:          0,
  callsMissed:         0,
  textbacksSent:       0,
  textbacksReplied:    0,
  appointmentsBooked:  0,
  patientsReactivated: 0,
  weeklyDigestsSent:   0,
  updatedAt:           now.toISOString(),
};
const metricsPath = path.join(clientDir, 'metrics.json');
if (!fs.existsSync(metricsPath)) {
  fs.writeFileSync(metricsPath, JSON.stringify(metrics, null, 2));
}

console.log(`✓ Client directory: data/clients/${slug}/`);
console.log(`✓ Brain + metrics initialized`);

// ── 2. Beta partners registry ──────────────────────────────────────────────

if (isBeta) {
  const registryPath = path.join(DATA_DIR, 'beta-partners.json');
  let registry = [];
  try { registry = JSON.parse(fs.readFileSync(registryPath, 'utf8')); } catch {}

  const existing = registry.findIndex(p => p.email === email);
  const entry = {
    clinicName,
    slug,
    email,
    phone,
    activatedAt:          now.toISOString(),
    testimonialDueAt:     endDate.toISOString(),
    caseStudyDueAt:       endDate.toISOString(),
    testimonialReceived:  false,
    caseStudyGenerated:   false,
    live:                 false,
  };

  if (existing !== -1) {
    registry[existing] = entry;
  } else {
    registry.push(entry);
  }

  fs.writeFileSync(registryPath, JSON.stringify(registry, null, 2));
  console.log(`✓ Added to beta-partners.json (${registry.length} total)`);
}

// ── 3. Mark in outreach databases ─────────────────────────────────────────

let markedInDB = false;
const outreachFiles = [
  path.join(DATA_DIR, 'outreach.localDentists.json'),
  path.join(DATA_DIR, 'outreach.physioClinics.json'),
];
for (const dbPath of outreachFiles) {
  try {
    const db = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
    const idx = db.findIndex(c =>
      c.email?.toLowerCase() === email.toLowerCase() ||
      c.clinicName?.toLowerCase() === clinicName.toLowerCase()
    );
    if (idx !== -1) {
      db[idx].status      = track;
      db[idx].activatedAt = now.toISOString();
      if (isBeta) {
        db[idx].betaPartner  = true;
        db[idx].freeForever  = true;
      }
      fs.writeFileSync(dbPath, JSON.stringify(db, null, 2));
      console.log(`✓ Marked as ${track} in ${path.basename(dbPath)}`);
      markedInDB = true;
    }
  } catch {}
}
if (!markedInDB) {
  console.log('  (clinic not found in outreach databases — manual add may be needed)');
}

// ── 4. Welcome email content ───────────────────────────────────────────────

const CALENDLY = process.env.CALENDLY_URL || 'https://calendly.com/m-aliben432/clinicflow-15-min-intro';

console.log(`\n WELCOME EMAIL — paste into Gmail now:`);
console.log('─'.repeat(52));
console.log(`To: ${email}`);

if (isBeta) {
  console.log(`Subject: You're a ClinicFlow Beta Partner — here's what happens next\n`);
  console.log(`Hi,

You're in. Official Beta Partner.

Here's exactly what happens now:

1. Setup (5 days)
   I'll configure everything — call forwarding, text-back system, welcome message.
   All I need from you: your clinic's phone number (you already gave it).

2. Go live
   We do a quick test call together. You'll experience exactly what your patients do.

3. Run for 60 days
   You do nothing different. ClinicFlow runs in the background.

4. At day 60
   We pull your real numbers together and write the case study.
   You give an honest testimonial about what actually happened.

Your setup link:
clinicflowautomation.com/welcome?clinic=${slug}

Takes 2 minutes. Just confirms your call forwarding setup.

Text or call me directly with anything: 438-544-0442

— Mohamed
ClinicFlow Automation`);
} else {
  console.log(`Subject: You're in — here's how to get ${clinicName} live\n`);
  console.log(`Hi,

You're confirmed for the 30-day pilot. Let's get you live.

Your setup portal: clinicflowautomation.com/welcome?clinic=${slug}

It walks you through the one thing we need from you — setting up call forwarding. Takes about 2 minutes.

Once that's done I'll send you your dedicated ClinicFlow number and we'll do a quick test call together.

Any questions — text or call me directly: 438-544-0442

— Mohamed
ClinicFlow Automation`);
}

console.log('─'.repeat(52));

// ── 5. Next steps checklist ────────────────────────────────────────────────

const caseStudyDate = endDate.toLocaleDateString('en-CA', { year:'numeric', month:'long', day:'numeric' });

console.log(`\n NEXT STEPS:`);
console.log(`  1. Send welcome email above now`);
console.log(`  2. Assign Twilio number in dashboard`);
console.log(`  3. Set brain.json configured:true when call forwarding confirmed`);
console.log(`  4. Set brain.json live:true after test call passes`);
if (isBeta) {
  console.log(`  5. Day 60 (${caseStudyDate}) — request testimonial + generate case study:`);
  console.log(`     node src/cli/generateCaseStudy.js --clinic ${slug}`);
}
console.log('');
console.log(` Pilot ends: ${caseStudyDate}`);
if (isBeta) console.log(` Free forever after that.`);
