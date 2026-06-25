// Multi-source email enrichment: website + BBB + Google Business
// Target: 15-20 verified contacts per day
// Run: node src/cli/enrichMultiSource.js --limit 50

import fs from 'fs';
import https from 'https';
import http from 'http';
import dotenv from 'dotenv';
dotenv.config();

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const args = process.argv.slice(2);
const getArg = (flag, def) => { const i = args.indexOf(flag); return i !== -1 ? parseInt(args[i + 1]) : def; };
const limit  = getArg('--limit', 50);
const offset = getArg('--offset', 0);
const dryRun = args.includes('--dry-run');

const DATA_PATH = 'data/outreach.localDentists.json';
const dental = JSON.parse(fs.readFileSync(DATA_PATH, 'utf8'));

const targets = dental.filter(c =>
  c.status === 'todo' &&
  c.mxValidated &&
  !c.excludeForever &&
  !c.ownerEmailVerified &&
  !c.scrapedEmail &&
  !c.verifiedEmailSent
).slice(offset, offset + limit);

console.log(`Multi-source enrichment: ${targets.length} clinics\n`);

const EMAIL_RE = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g;
const GENERIC = new Set(['info','contact','office','reception','admin','booking','dental',
  'smile','clinic','front','hello','mail','enquiries','appointments','noreply','no-reply',
  'support','webmaster','test','donotreply','notifications','hello']);

function fetchUrl(url, timeoutMs = 7000) {
  const hardDeadline = new Promise(r => setTimeout(() => r(''), timeoutMs + 2000));
  const fetch = new Promise((resolve) => {
    const mod = url.startsWith('https') ? https : http;
    const req = mod.get(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
      rejectUnauthorized: false,
    }, (res) => {
      if ((res.statusCode === 301 || res.statusCode === 302) && res.headers.location) {
        return fetchUrl(res.headers.location, timeoutMs).then(resolve);
      }
      let body = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { body += chunk; if (body.length > 300000) res.destroy(); });
      res.on('end', () => resolve(body));
      res.on('error', () => resolve(''));
    });
    req.setTimeout(timeoutMs, () => { req.destroy(); resolve(''); });
    req.on('error', () => resolve(''));
  });
  return Promise.race([fetch, hardDeadline]);
}

function extractEmails(html, domain) {
  // Decode Cloudflare obfuscation
  const cfEmails = [];
  const cfRe = /data-cfemail="([0-9a-f]+)"/gi;
  let m;
  while ((m = cfRe.exec(html)) !== null) {
    try {
      const enc = m[1];
      const key = parseInt(enc.slice(0, 2), 16);
      let decoded = '';
      for (let i = 2; i < enc.length; i += 2) {
        decoded += String.fromCharCode(parseInt(enc.slice(i, i + 2), 16) ^ key);
      }
      if (decoded.includes('@')) cfEmails.push(decoded.toLowerCase());
    } catch {}
  }

  const raw = (html.match(EMAIL_RE) || []).map(e => e.toLowerCase());
  const all = [...new Set([...raw, ...cfEmails])];

  const EXCLUDED_DOMAINS = ['bbb.org', 'yellowpages.ca', 'google.com', 'facebook.com',
    'yelp.ca', 'yelp.com', 'healthgrades.com', 'ratemds.com', 'spabreaks.com'];
  // Filter: must be plausible clinic email
  return all.filter(e => {
    if (!e.includes('@') || e.length > 80) return false;
    if (/\.(png|jpg|gif|svg|css|js)$/i.test(e)) return false;
    const domain = e.split('@')[1] || '';
    if (EXCLUDED_DOMAINS.some(d => domain.endsWith(d))) return false;
    return true;
  });
}

function scoreEmail(email, domain) {
  const local = email.split('@')[0];
  const emailDomain = email.split('@')[1];
  let score = 0;
  if (domain && emailDomain === domain) score += 10;
  else if (/\@(gmail|hotmail|outlook|yahoo)\.com$/.test(email)) score += 5;
  else score -= 5;
  if (!GENERIC.has(local)) score += 8;
  if (/^dr[.\-_]?[a-z]/.test(local)) score += 5;
  if (/[a-z]+\.[a-z]+@/.test(email)) score += 3;
  return score;
}

async function tryWebsite(clinic) {
  if (!clinic.website) return null;
  const domain = clinic.email?.split('@')[1];
  const base = clinic.website.replace(/\/$/, '');
  const paths = ['', '/contact', '/contact-us', '/about', '/team', '/our-team',
    '/meet-the-doctor', '/meet-the-dentist', '/about-us', '/staff', '/doctors'];

  const found = new Set();
  for (const p of paths.slice(0, 5)) {
    const html = await fetchUrl(base + p);
    if (!html) continue;
    extractEmails(html, domain).forEach(e => found.add(e));
    if (found.size > 0) break;
  }

  if (!found.size) return null;
  const sorted = [...found].sort((a, b) => scoreEmail(b, domain) - scoreEmail(a, domain));
  return { email: sorted[0], source: 'website', all: sorted };
}

async function tryBBB(clinic) {
  const query = encodeURIComponent(`${clinic.clinicName} ${clinic.city}`);
  const url = `https://www.bbb.org/search?find_text=${query}&find_country=CAN`;
  const html = await fetchUrl(url, 8000);
  if (!html) return null;

  const domain = clinic.email?.split('@')[1];
  const emails = extractEmails(html, domain);
  if (!emails.length) return null;

  const domainMatch = emails.find(e => domain && e.endsWith('@' + domain));
  if (domainMatch) return { email: domainMatch, source: 'bbb' };

  const nonGeneric = emails.find(e => !GENERIC.has(e.split('@')[0]));
  if (nonGeneric) return { email: nonGeneric, source: 'bbb' };
  return null;
}

async function tryYellowPages(clinic) {
  const slug = clinic.clinicName.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40);
  const city = clinic.city?.toLowerCase().replace(/[^a-z]+/g, '-') || '';
  const url = `https://www.yellowpages.ca/search/si/1/${encodeURIComponent(clinic.clinicName)}/${encodeURIComponent(clinic.city || 'canada')}`;
  const html = await fetchUrl(url, 8000);
  if (!html) return null;

  const domain = clinic.email?.split('@')[1];
  const emails = extractEmails(html, domain);
  if (!emails.length) return null;

  const best = emails.sort((a, b) => scoreEmail(b, domain) - scoreEmail(a, domain))[0];
  if (best && best !== clinic.email?.toLowerCase()) return { email: best, source: 'yellowpages' };
  return null;
}

let found = 0;
let checked = 0;

for (const clinic of targets) {
  checked++;
  let result = null;

  try {
    result = await tryWebsite(clinic);
    if (!result) result = await tryBBB(clinic);
    if (!result) result = await tryYellowPages(clinic);
  } catch {}

  if (result && result.email !== clinic.email?.toLowerCase()) {
    const idx = dental.findIndex(d => d.email === clinic.email);
    if (idx !== -1 && !dryRun) {
      dental[idx].scrapedEmail = result.email;
      dental[idx].scrapedEmailSource = result.source;
      dental[idx].scrapedEmailFoundAt = new Date().toISOString();
    }
    found++;
    console.log(`✓ [${result.source}] ${clinic.clinicName} — ${result.email}`);
  }

  if (checked % 10 === 0) {
    console.log(`[${checked}/${targets.length} checked, ${found} found]`);
    if (!dryRun) fs.writeFileSync(DATA_PATH, JSON.stringify(dental, null, 2));
  }
}

if (!dryRun) fs.writeFileSync(DATA_PATH, JSON.stringify(dental, null, 2));
console.log(`\n✓ Multi-source enrichment complete: ${found}/${targets.length}`);
console.log(`Yield: ${((found / Math.max(targets.length, 1)) * 100).toFixed(1)}%`);
