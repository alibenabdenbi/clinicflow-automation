// src/cli/scrapeVerifiedEmails.js
// Scrapes clinic websites for real named email addresses.
// No guessing. Only sends what is explicitly found on the page.
// Targets /contact and /about pages where named emails appear.

import fs from 'fs';
import https from 'https';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
dotenv.config();

if (process.platform === 'win32') process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');
const DENTAL_PATH = path.join(ROOT, 'data', 'outreach.localDentists.json');

const args = process.argv.slice(2);
const LIMIT = (() => { const i = args.indexOf('--limit'); return i !== -1 ? parseInt(args[i + 1], 10) : 30; })();

const GENERIC = new Set(['info','contact','admin','office','reception','booking',
  'hello','front','dental','smile','clinic','mail','noreply','no-reply',
  'support','webmaster','test','team','appointments','enquiries','enquiry',
  'privacy','legal','billing','accounts','media','press','sales']);

function fetchHtml(url, timeoutMs = 7000) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const mod = parsed.protocol === 'https:' ? https : http;
    const req = mod.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'en-CA,en;q=0.9,fr-CA;q=0.8',
      },
      rejectUnauthorized: false,
    }, (res) => {
      // Follow one redirect
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
        try {
          const redirectUrl = new URL(res.headers.location, url).href;
          return fetchHtml(redirectUrl, timeoutMs).then(resolve).catch(reject);
        } catch { return reject(new Error('bad redirect')); }
      }
      if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}`));
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8', 0, 200000)));
      res.on('error', reject);
    });
    req.setTimeout(timeoutMs, () => { req.destroy(); reject(new Error('timeout')); });
    req.on('error', reject);
  });
}

function extractNamedEmails(html, domain) {
  // Decode Cloudflare email obfuscation
  const decoded = html.replace(/data-cfemail="([0-9a-f]+)"/gi, (_, hex) => {
    const bytes = hex.match(/.{2}/g).map(h => parseInt(h, 16));
    const key = bytes[0];
    return bytes.slice(1).map(b => String.fromCharCode(b ^ key)).join('');
  });

  const emailRegex = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g;
  const all = [...new Set((decoded.match(emailRegex) || []).map(e => e.toLowerCase()))];

  // Filter to same domain only
  const onDomain = all.filter(e => e.endsWith('@' + domain.toLowerCase()));

  // Remove generic/system prefixes
  return onDomain.filter(e => !GENERIC.has(e.split('@')[0]));
}

function contactUrls(baseUrl) {
  const base = baseUrl.replace(/\/$/, '');
  return [
    `${base}/contact`,
    `${base}/contact-us`,
    `${base}/about`,
    `${base}/about-us`,
    `${base}/our-team`,
    `${base}/equipe`,    // French
    `${base}/contact/`,
    base,                // homepage last
  ];
}

const dental = JSON.parse(fs.readFileSync(DENTAL_PATH, 'utf8'));

const targets = dental
  .filter(c =>
    c.website &&
    c.status === 'todo' &&
    c.mxValidated &&
    !c.excludeForever &&
    !c.ownerEmailVerified
  )
  .sort((a, b) => (b.reviewCount || 0) - (a.reviewCount || 0))
  .slice(0, LIMIT);

console.log(`Scraping ${targets.length} clinic websites for named emails...\n`);

let found = 0, checked = 0, errors = 0;

for (const clinic of targets) {
  checked++;
  const domain = clinic.email?.split('@')[1]?.toLowerCase();
  if (!domain) continue;

  let namedEmails = [];
  let sourceUrl = '';

  for (const url of contactUrls(clinic.website)) {
    try {
      const html = await fetchHtml(url);
      namedEmails = extractNamedEmails(html, domain);
      if (namedEmails.length > 0) { sourceUrl = url; break; }
    } catch (_) {
      // try next page
    }
  }

  if (namedEmails.length > 0) {
    const best = namedEmails[0];
    const idx = dental.findIndex(d => d.email === clinic.email);
    if (idx !== -1) {
      dental[idx].ownerEmailVerified = best;
      dental[idx].ownerEmailVerifiedAt = new Date().toISOString();
      dental[idx].ownerEmailSource = `scraped:${sourceUrl}`;
      dental[idx].ownerEmailVerifiedAlternates = namedEmails.slice(1);
    }
    found++;
    console.log(`✓ ${clinic.clinicName} [${clinic.city}]`);
    console.log(`  Found: ${best}${namedEmails.length > 1 ? ` (+${namedEmails.length - 1} more)` : ''}`);
    console.log(`  From:  ${sourceUrl}`);
  } else {
    errors++;
  }

  if (checked % 10 === 0) console.log(`  [${checked}/${targets.length} checked, ${found} found so far]`);
  await new Promise(r => setTimeout(r, 800));
}

fs.writeFileSync(DENTAL_PATH, JSON.stringify(dental, null, 2));

console.log(`\n${'─'.repeat(50)}`);
console.log(`Checked : ${checked}`);
console.log(`Found   : ${found} verified named emails`);
console.log(`No email: ${errors}`);
if (found > 0) console.log('\nNext: node src/cli/sendVerifiedEmails.js');
