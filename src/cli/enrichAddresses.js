// src/cli/enrichAddresses.js
// Fetches street addresses from Google Places API for clinics that have a
// placeId but no physical address yet. Stores addressLine1, postalCode,
// province, and formattedAddress on each record.
//
// Usage:
//   node src/cli/enrichAddresses.js                   # top 50 unenriched
//   node src/cli/enrichAddresses.js --priority-only   # only the 20 priority prospects
//   node src/cli/enrichAddresses.js --limit 100

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
dotenv.config();

if (process.platform === 'win32') process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');
const DATA_DIR = path.join(ROOT, 'data');

const PRIORITY_PATH = path.join(DATA_DIR, 'hitlist', 'conversion-priority.json');
const DENTAL_PATH   = path.join(DATA_DIR, 'outreach.localDentists.json');

const args = process.argv.slice(2);
const PRIORITY_ONLY = args.includes('--priority-only');
const LIMIT = (() => {
  const i = args.indexOf('--limit');
  return i !== -1 ? parseInt(args[i + 1]) || 50 : 50;
})();

const API_KEY = process.env.GOOGLE_PLACES_API_KEY;
if (!API_KEY) {
  console.error('GOOGLE_PLACES_API_KEY not set in .env');
  process.exit(1);
}

const dental = JSON.parse(fs.readFileSync(DENTAL_PATH, 'utf8'));

let candidates;
if (PRIORITY_ONLY) {
  const priority = JSON.parse(fs.readFileSync(PRIORITY_PATH, 'utf8'));
  const priorityEmails = new Set(priority.map(p => p.email));
  candidates = dental.filter(d =>
    priorityEmails.has(d.email) && d.placeId && !d.addressLine1
  );
} else {
  candidates = dental.filter(d => d.placeId && !d.addressLine1).slice(0, LIMIT);
}

console.log(`Enriching ${candidates.length} clinics with physical addresses...`);

function parseComponents(components) {
  const get = (type, nameType = 'long_name') =>
    components.find(c => c.types.includes(type))?.[nameType] || '';

  const streetNum  = get('street_number');
  const route      = get('route');
  const subpremise = get('subpremise');
  const postalCode = get('postal_code');
  const province   = get('administrative_area_level_1', 'short_name');
  const city       = get('locality') || get('sublocality') || get('administrative_area_level_2');

  let addressLine1 = [streetNum, route].filter(Boolean).join(' ');
  if (subpremise) addressLine1 = `${subpremise}-${addressLine1}`;

  return { addressLine1, postalCode, province, city };
}

async function fetchAddress(placeId) {
  const fields = 'formatted_address,address_components';
  const url = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${encodeURIComponent(placeId)}&fields=${fields}&key=${API_KEY}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Places API ${res.status}`);
  const json = await res.json();
  if (json.status !== 'OK') throw new Error(`Places status: ${json.status}`);

  const result = json.result;
  const parsed = parseComponents(result.address_components || []);
  return {
    formattedAddress: result.formatted_address || '',
    ...parsed,
  };
}

let enriched = 0;
let failed   = 0;

for (const clinic of candidates) {
  const idx = dental.findIndex(d => d.email === clinic.email);
  if (idx === -1) continue;

  try {
    const addr = await fetchAddress(clinic.placeId);

    if (addr.addressLine1) {
      dental[idx].addressLine1     = addr.addressLine1;
      dental[idx].formattedAddress = addr.formattedAddress;
      dental[idx].postalCode       = addr.postalCode || dental[idx].postalCode || '';
      if (addr.province) dental[idx].province = addr.province;
      if (addr.city && !dental[idx].city) dental[idx].city = addr.city;
      dental[idx].addressEnrichedAt = new Date().toISOString();
      enriched++;
      console.log(`✓ ${clinic.clinicName} → ${addr.addressLine1}, ${addr.city || dental[idx].city}`);
    } else {
      console.log(`~ ${clinic.clinicName}: no street number in response (${addr.formattedAddress})`);
    }

    await new Promise(r => setTimeout(r, 200));
  } catch (e) {
    failed++;
    console.log(`✗ ${clinic.clinicName}: ${e.message}`);
  }
}

fs.writeFileSync(DENTAL_PATH, JSON.stringify(dental, null, 2));
console.log(`\nAddress enrichment complete: ${enriched} enriched, ${failed} failed`);
