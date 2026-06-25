// src/cli/postToGBP.js
// Posts today's LinkedIn field note to Google Business Profile.
// Run manually: node src/cli/postToGBP.js
// Runs automatically via scheduler at 08:00 Mon-Fri after post is generated.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
dotenv.config();

if (process.platform === 'win32') process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

import { postToGBP } from '../services/gbpPoster.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT      = path.resolve(__dirname, '../..');
const POST_PATH = path.join(ROOT, 'data', 'linkedin', 'daily-post.txt');
const LOG_PATH  = path.join(ROOT, 'data', 'linkedin', 'gbp-post-log.json');

const today = new Date().toISOString().slice(0, 10);

// Check credentials
const missingCreds = ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_REFRESH_TOKEN',
  'GOOGLE_BUSINESS_ACCOUNT_ID', 'GOOGLE_BUSINESS_LOCATION_ID']
  .filter(k => !process.env[k]);

if (missingCreds.length > 0) {
  console.log('⚠ Google Business Profile credentials not configured.');
  console.log('Missing:', missingCreds.join(', '));
  console.log('Setup: node src/cli/setupGoogleAuth.js');
  process.exit(0);
}

// Load today's post
let rawPost;
try {
  rawPost = fs.readFileSync(POST_PATH, 'utf8');
} catch {
  console.log('No daily post found. Run: node src/cli/generateLinkedInPost.js');
  process.exit(0);
}

// Check GBP log — don't double-post
let log = [];
try { log = JSON.parse(fs.readFileSync(LOG_PATH, 'utf8')); } catch {}
if (log.some(e => e.date === today)) {
  console.log('✓ Already posted to GBP today:', today);
  process.exit(0);
}

// Strip markdown headers from the LinkedIn post for GBP
const cleanPost = rawPost
  .replace(/^#.*$/gm, '')           // remove # headers
  .replace(/^---.*$/gm, '')         // remove dividers
  .replace(/Generated:.*$/gm, '')   // remove metadata
  .replace(/Format:.*$/gm, '')
  .replace(/\n{3,}/g, '\n\n')       // collapse extra newlines
  .trim();

// GBP posts do best with a CTA — rotate between calculator and demo
const seed = today.split('-').reduce((a, b) => a + parseInt(b), 0);
const ctas = [
  { type: 'LEARN_MORE', url: 'https://clinicflowautomation.com/calculator' },
  { type: 'LEARN_MORE', url: 'https://clinicflowautomation.com/demo' },
  { type: 'BOOK',       url: 'https://calendly.com/m-aliben432/clinicflow-15-min-intro' },
];
const cta = ctas[seed % ctas.length];

console.log(`Posting to Google Business Profile — ${today}`);
console.log('CTA:', cta.type, '→', cta.url);
console.log('Post length:', cleanPost.length, 'chars');
console.log('Preview:', cleanPost.slice(0, 120) + '...\n');

try {
  const result = await postToGBP(cleanPost, cta.type, cta.url);

  log.push({
    date:      today,
    postName:  result.name,
    url:       result.searchUrl || '',
    ctaType:   cta.type,
    ctaUrl:    cta.url,
    postedAt:  new Date().toISOString(),
    charCount: cleanPost.length,
  });
  fs.writeFileSync(LOG_PATH, JSON.stringify(log, null, 2));

  console.log('✓ Posted to Google Business Profile');
  console.log('  Post name:', result.name);
} catch (e) {
  console.error('✗ GBP post failed:', e.message);
  process.exit(1);
}
