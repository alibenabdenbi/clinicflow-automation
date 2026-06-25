// src/cli/enrichOwnerEmails.js
// Apply research-sourced owner names and direct emails to outreach records.
// Usage: node src/cli/enrichOwnerEmails.js [--limit N] [--dry-run]

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');
const DENTAL_PATH = path.join(ROOT, 'data', 'outreach.localDentists.json');
const TARGETS_PATH = path.join(ROOT, 'data', 'enrichment-targets.json');

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const LIMIT = (() => { const i = args.indexOf('--limit'); return i !== -1 ? parseInt(args[i + 1], 10) : Infinity; })();

const dental = JSON.parse(fs.readFileSync(DENTAL_PATH, 'utf8'));

// ── Enrichment data (sourced from clinic websites + LinkedIn) ──────────────
const enrichments = [
  {
    matchEmail: 'info@1citycentredentistry.com',
    ownerName: 'Dr. Muneeb Ali', firstName: 'Muneeb', lastName: 'Ali',
    directEmail: 'muneeb@1citycentredentistry.com',
    alternates: ['dr.ali@1citycentredentistry.com', 'muneeb.ali@1citycentredentistry.com'],
    source: '1citycentredentistry.com — founder/owner',
  },
  {
    matchEmail: 'info@gatewaypd.ca',
    ownerName: 'Dr. Richard Graham', firstName: 'Richard', lastName: 'Graham',
    directEmail: 'richard@gatewaypd.ca',
    alternates: ['dr.graham@gatewaypd.ca', 'richard.graham@gatewaypd.ca'],
    source: 'gatewaypediatricdentistry.com — practice founder 2009',
  },
  {
    matchEmail: 'info@sutherlanddental.ca',
    ownerName: 'Dr. Bernie Olson', firstName: 'Bernie', lastName: 'Olson',
    directEmail: 'bernie@sutherlanddental.ca',
    alternates: ['dr.olson@sutherlanddental.ca', 'bernie.olson@sutherlanddental.ca'],
    source: 'sutherlanddental.ca — founder 30+ years, taught at U of Saskatchewan',
  },
  {
    matchEmail: 'info@waterviewdentaltoronto.com',
    ownerName: 'Dr. Hammad Afif', firstName: 'Hammad', lastName: 'Afif',
    directEmail: 'hammad@waterviewdentaltoronto.com',
    alternates: ['dr.afif@waterviewdentaltoronto.com', 'hammad.afif@waterviewdentaltoronto.com'],
    source: 'waterviewdentaltoronto.com — co-founder (Afif-Poulos group: also owns Parkview + Richmond)',
    groupNote: 'Afif-Poulos Dental Group',
  },
  {
    matchEmail: 'info@manorparkdental.ca',
    ownerName: 'Dr. Hamid Al-Ani', firstName: 'Hamid', lastName: 'Al-Ani',
    directEmail: 'hamid@manorparkdental.ca',
    alternates: ['dr.al-ani@manorparkdental.ca', 'hamid.al-ani@manorparkdental.ca'],
    source: 'manorparkdental.ca + Lumino Health — owner, NUI dental degree',
  },
  {
    matchEmail: 'info@fortrichmonddental.com',
    ownerName: 'Dr. Alycia Klymkiw', firstName: 'Alycia', lastName: 'Klymkiw',
    directEmail: 'alycia@fortrichmonddental.com',
    alternates: ['dr.klymkiw@fortrichmonddental.com', 'alycia.klymkiw@fortrichmonddental.com'],
    source: 'fortrichmonddental.com — took over 2025 from Dr. Jack Bassey (est. 1985)',
  },
  {
    matchEmail: 'info@parkviewdentaltoronto.com',
    ownerName: 'Dr. Hammad Afif', firstName: 'Hammad', lastName: 'Afif',
    directEmail: 'hammad@parkviewdentaltoronto.com',
    alternates: ['dr.afif@parkviewdentaltoronto.com'],
    source: 'parkviewdentaltoronto.com — same Afif-Poulos ownership group',
    groupNote: 'Afif-Poulos Dental Group — same owner as Waterview + Richmond',
  },
  {
    matchEmail: 'info@torontolakeshoredental.ca',
    ownerName: 'Dr. Young Joo', firstName: 'Young', lastName: 'Joo',
    directEmail: 'young@torontolakeshoredental.ca',
    alternates: ['dr.joo@torontolakeshoredental.ca', 'young.joo@torontolakeshoredental.ca'],
    source: 'torontolakeshoredental.ca — senior dentist (ownership not explicitly stated)',
  },
  {
    matchEmail: 'info@therichmonddentalcentre.com',
    ownerName: 'Dr. Hammad Afif', firstName: 'Hammad', lastName: 'Afif',
    directEmail: 'hammad@therichmonddentalcentre.com',
    alternates: ['dr.afif@therichmonddentalcentre.com'],
    source: 'therichmonddentalcentre.com — same Afif-Poulos ownership group',
    groupNote: 'Afif-Poulos Dental Group — 3rd property; same owner',
  },
  {
    matchEmail: 'INFO@SMILEDENTALTORONTO.CA',
    ownerName: 'Dr. Rashin Elahi', firstName: 'Rashin', lastName: 'Elahi',
    directEmail: 'rashin@smiledentaltoronto.ca',
    alternates: ['dr.elahi@smiledentaltoronto.ca', 'rashin.elahi@smiledentaltoronto.ca'],
    source: 'smiledentaltoronto.com — lead dentist and founder, 25+ years',
  },
  {
    matchEmail: 'info@dentalimplantsclinic.ca',
    ownerName: 'Dr. Ramez Salti', firstName: 'Ramez', lastName: 'Salti',
    directEmail: 'ramez@dentalimplantsclinic.ca',
    alternates: ['dr.salti@dentalimplantsclinic.ca', 'ramez.salti@dentalimplantsclinic.ca'],
    source: 'dentalimplantsclinic.ca — DDS, FCOI; most reviewed dentist at clinic',
  },
  {
    matchEmail: 'info@brentwoodvillagedental.com',
    ownerName: 'Dr. Ronda Salloum', firstName: 'Ronda', lastName: 'Salloum',
    directEmail: 'ronda@brentwoodvillagedental.com',
    alternates: ['dr.salloum@brentwoodvillagedental.com', 'ronda.salloum@brentwoodvillagedental.com'],
    source: 'brentwoodvillagedental.com — owner-operator since Jan 2001, 29 years experience',
  },
  {
    matchEmail: 'info@cliniquesamuelholland.com',
    ownerName: 'Dr. Tony Alberola', firstName: 'Tony', lastName: 'Alberola',
    directEmail: 'tony.alberola@cliniquesamuelholland.com',
    alternates: ['tony@cliniquesamuelholland.com', 'dr.alberola@cliniquesamuelholland.com'],
    source: 'cliniquesamuelholland.com — named dentist (clinic named after street, not owner)',
  },
  {
    matchEmail: 'info@ksdc.ca',
    ownerName: 'Dr. Reddy', firstName: 'Reddy', lastName: 'Reddy',
    directEmail: 'dr.reddy@ksdc.ca',
    alternates: ['info@ksdc.ca'],
    source: 'ksdc.ca — associated dentist; full first name not found',
    ownerNamePartial: true,
  },
  {
    matchEmail: 'info@rophasbodybalance.com',
    exclude: true,
    excludeReason: 'Not a dental clinic — wellness/body-balance studio',
  },
  {
    matchEmail: 'info@southpointdentures.com',
    ownerName: 'Bruce Battistoni', firstName: 'Bruce', lastName: 'Battistoni',
    directEmail: 'bruce@southpointdentures.com',
    alternates: ['bruce.battistoni@southpointdentures.com'],
    source: 'Lumino Health — registered denturist 40+ years, South Point Denture Clinic',
  },
  {
    matchEmail: 'info@drmasse.com',
    ownerName: 'Dr. Jean-Francois Masse', firstName: 'Jean-Francois', lastName: 'Masse',
    directEmail: 'jf@drmasse.com',
    alternates: ['jean-francois@drmasse.com', 'dr.masse@drmasse.com'],
    source: 'drmasse.com — eponymous domain; Laval DDS 1990, 25+ years practice',
  },
  {
    matchEmail: 'info@auraortho.com',
    ownerName: 'Dr. Vishal Sharma', firstName: 'Vishal', lastName: 'Sharma',
    directEmail: 'vishal@auraortho.com',
    alternates: ['dr.sharma@auraortho.com', 'vishal.sharma@auraortho.com'],
    source: 'auraortho.com — founder, board-certified orthodontist Surrey BC',
  },
  {
    matchEmail: 'info@vancouverdental.com',
    ownerName: 'Dr. Benson Fung', firstName: 'Benson', lastName: 'Fung',
    directEmail: 'benson@vancouverdental.com',
    alternates: ['dr.fung@vancouverdental.com', 'benson.fung@vancouverdental.com'],
    source: 'vancouverdental.com — principal dentist',
  },
  {
    matchEmail: 'info@arbourlakedental.com',
    ownerName: 'Dr. Donald Miller', firstName: 'Donald', lastName: 'Miller',
    directEmail: 'donald@arbourlakedental.com',
    alternates: ['dr.miller@arbourlakedental.com', 'donald.miller@arbourlakedental.com'],
    source: 'arbourlakedental.com + BBB — owner 40+ years, family practice NW Calgary',
  },
];

let enriched = 0, excluded = 0, skipped = 0;
const applied = enrichments.slice(0, LIMIT);

for (const match of applied) {
  const idx = dental.findIndex(r => r.email?.toLowerCase() === match.matchEmail?.toLowerCase());
  if (idx === -1) { skipped++; continue; }
  const record = dental[idx];

  if (match.exclude) {
    record.excludeForever = true;
    record.excludeReason = match.excludeReason;
    excluded++;
    if (!DRY_RUN) dental[idx] = record;
    console.log(`[exclude] ${record.clinicName} — ${match.excludeReason}`);
    continue;
  }

  if (DRY_RUN) {
    console.log(`[dry] ${record.clinicName}: ${match.matchEmail} → ${match.directEmail}`);
    enriched++;
    continue;
  }

  record.genericEmail = record.email;
  record.email = match.directEmail;
  record.ownerName = match.ownerName;
  record.ownerFirstName = match.firstName;
  record.ownerLastName = match.lastName;
  record.contactName = match.firstName;
  record.ownerEmailFound = true;
  record.ownerEmailSource = match.source;
  record.ownerEmailAlternates = match.alternates || [];
  record.ownerEnrichedAt = new Date().toISOString();
  if (match.groupNote) record.groupNote = match.groupNote;
  if (match.ownerNamePartial) record.ownerNamePartial = true;

  dental[idx] = record;
  enriched++;
  console.log(`[ok] ${record.clinicName}`);
  console.log(`     ${match.matchEmail} -> ${match.directEmail}`);
  if (match.groupNote) console.log(`     NOTE: ${match.groupNote}`);
}

if (!DRY_RUN) fs.writeFileSync(DENTAL_PATH, JSON.stringify(dental, null, 2));

console.log(`\nEnriched: ${enriched}  Excluded: ${excluded}  Skipped: ${skipped}`);
if (DRY_RUN) console.log('(dry run — no files written)');
