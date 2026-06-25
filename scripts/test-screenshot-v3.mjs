import dotenv from 'dotenv';
dotenv.config();
import { generateClinicPreview } from '../src/services/previewGenerator.js';
import { takeScreenshot } from '../src/services/screenshotEngine.js';
import fs from 'fs';

const clinic = {
  clinicName: 'Toronto Physiotherapy',
  city: 'Toronto',
  rating: 4.9,
  reviewCount: 1235,
  type: 'physio',
};

const html = generateClinicPreview(clinic);
const p = await takeScreenshot(html, 'data/screenshots/toronto-physio-v3.png');
console.log('✓ V3 screenshot saved');
console.log('Size:', Math.round(fs.statSync(p).size / 1024), 'KB');

// Verify the new human traces are in the HTML
const seed = 'Toronto Physiotherapy'.split('').reduce((a, c) => a + c.charCodeAt(0), 0);
const staffNames = ['Julie', 'Sarah', 'Marie', 'Jessica', 'Emma', 'Priya'];
const staff1 = staffNames[seed % staffNames.length];
const staff2 = staffNames[(seed + 2) % staffNames.length];
const loadLabels = ['Low', 'Moderate', 'Moderate', 'High'];
const load = loadLabels[seed % loadLabels.length];

console.log(`\nStaff names for this clinic: ${staff1}, ${staff2}`);
console.log('Front desk load:', load);
console.log('Has staff names in HTML:', html.includes(staff1) ? '✓' : '✗');
console.log('Has front desk load:', html.includes('Front desk load') ? '✓' : '✗');
console.log('Has "marked callback":', html.includes('marked callback') ? '✓' : '✗');
console.log('Has "manually resent":', html.includes('manually resent') ? '✓' : '✗');
console.log('Has "carrier":', html.includes('carrier') ? '✓' : '✗');

console.log('\nNew email opening:');
console.log('Subject: Toronto Physiotherapy — workflow reference I put together');
console.log('\nOpening: I was mapping out how Toronto physio clinics typically handle');
console.log('  missed calls — and used Toronto Physiotherapy as the reference');
console.log('  point while building this.');
console.log('\nClosing: Still refining this — would be curious whether any of it');
console.log('  reflects what actually happens at Toronto Physiotherapy.');
