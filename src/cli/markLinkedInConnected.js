// src/cli/markLinkedInConnected.js
// Mark a LinkedIn connection request as sent so it won't appear in daily targets again.
// Usage: node src/cli/markLinkedInConnected.js "Person Name"
//        node src/cli/markLinkedInConnected.js "Person Name" "Clinic Name"

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');
const LINKEDIN_PATH = path.join(ROOT, 'data', 'linkedin', 'prospects.json');

const args = process.argv.slice(2);
const nameArg = args[0];
const clinicArg = args[1];

if (!nameArg) {
  console.log('Usage: node src/cli/markLinkedInConnected.js "Person Name" ["Clinic Name"]');
  process.exit(0);
}

const prospects = JSON.parse(fs.readFileSync(LINKEDIN_PATH, 'utf8'));

const idx = prospects.findIndex(p => {
  const pName = (p.name || p.personName || '').toLowerCase();
  const matches = pName.includes(nameArg.toLowerCase());
  if (!matches) return false;
  if (clinicArg) return (p.clinicName || '').toLowerCase().includes(clinicArg.toLowerCase());
  return true;
});

if (idx === -1) {
  console.log(`✗ No prospect found matching "${nameArg}"${clinicArg ? ` at "${clinicArg}"` : ''}`);
  console.log('Partial matches:');
  prospects
    .filter(p => (p.name || p.personName || '').toLowerCase().includes(nameArg.toLowerCase().split(' ')[0]))
    .slice(0, 5)
    .forEach(p => console.log(`  "${p.name || p.personName}" — ${p.clinicName}`));
  process.exit(1);
}

prospects[idx].connectionSent = true;
prospects[idx].connectionSentAt = new Date().toISOString();
fs.writeFileSync(LINKEDIN_PATH, JSON.stringify(prospects, null, 2));

const p = prospects[idx];
console.log(`✓ Marked: ${p.name || p.personName} — ${p.clinicName}`);
console.log(`  connectionSentAt: ${prospects[idx].connectionSentAt}`);
const remaining = prospects.filter(p => !p.connectionSent).length;
console.log(`  Remaining unsent: ${remaining}`);
