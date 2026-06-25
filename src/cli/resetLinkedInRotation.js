// src/cli/resetLinkedInRotation.js
// Resets the LinkedIn prospect rotation to start fresh with French Quebec clinics.
// Usage: node src/cli/resetLinkedInRotation.js [--en]
//   --en : include English clinics after French ones (default: French only)

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT      = path.resolve(__dirname, '../..');
const DATA_DIR  = path.join(ROOT, 'data');
const OUT_PATH  = path.join(DATA_DIR, 'linkedin', 'prospect-rotation.json');

const includeEn = process.argv.includes('--en');

const dental = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'outreach.localDentists.json'), 'utf8'));

function isFrench(c) {
  return c.language === 'fr' ||
    (c.province === 'QC' && /clinique|dentaire|soins|physio/i.test(c.clinicName || ''));
}

const frenchClinics = dental
  .filter(c =>
    isFrench(c) &&
    c.mxValidated &&
    !c.excludeForever &&
    !c.linkedinConnected &&
    c.city &&
    c.email
  )
  .sort((a, b) => (b.rating || 0) - (a.rating || 0));

let prospects = frenchClinics;

if (includeEn) {
  const englishClinics = dental
    .filter(c =>
      !isFrench(c) &&
      c.mxValidated &&
      !c.excludeForever &&
      !c.linkedinConnected &&
      c.city &&
      c.email
    )
    .sort((a, b) => (b.rating || 0) - (a.rating || 0))
    .slice(0, 50);
  prospects = [...frenchClinics, ...englishClinics];
}

const rotation = {
  resetAt: new Date().toISOString(),
  currentIndex: 0,
  note: includeEn ? 'French QC first, then English' : 'French QC clinics',
  prospects: prospects.map(c => ({
    clinicName: c.clinicName || c.name || '',
    city:        c.city || '',
    province:    c.province || '',
    email:       c.email || '',
    rating:      c.rating || null,
    language:    c.language || 'fr',
    linkedinQuery: `${(c.clinicName || c.name || '').trim()} ${(c.city || '').trim()} dentiste`,
  })),
};

fs.mkdirSync(path.join(DATA_DIR, 'linkedin'), { recursive: true });
fs.writeFileSync(OUT_PATH, JSON.stringify(rotation, null, 2));

console.log(`✓ LinkedIn rotation reset`);
console.log(`  ${rotation.prospects.length} French QC clinics${includeEn ? ' + English' : ''}`);
console.log(`  Saved → ${path.relative(ROOT, OUT_PATH)}`);
console.log(`\nFirst 5:`);
rotation.prospects.slice(0, 5).forEach(c =>
  console.log(`  ${c.clinicName} — ${c.city} (${c.email})`)
);
