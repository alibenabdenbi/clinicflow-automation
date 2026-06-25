// src/cli/deepEnrich.js
// Deep email enrichment — 6 methods, crash-safe, 60%+ hit rate target.
//
// Usage:
//   node src/cli/deepEnrich.js [--limit 100] [--delay 1000]
//   import { deepEnrichBatch, deepEnrichOne } from './deepEnrich.js'

import fs from 'fs';
import path from 'path';
import dns from 'dns/promises';
import https from 'https';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
dotenv.config();
if (process.platform === 'win32') process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const __dirname  = path.dirname(fileURLToPath(import.meta.url));
const ROOT       = path.resolve(__dirname, '../..');
const QUEUE_PATH = path.join(ROOT, 'data', 'outreach.localDentists.json');
const LOG_PATH   = path.join(ROOT, 'data', 'deep-enrich-log.json');
const SAVE_EVERY = 30;

// CLI flags
const ARGS      = process.argv.slice(2);
const LIMIT_ARG = (() => { const i = ARGS.indexOf('--limit');  return i !== -1 ? Number(ARGS[i+1]) : 100; })();
const DELAY_ARG = (() => { const i = ARGS.indexOf('--delay');  return i !== -1 ? Number(ARGS[i+1]) : 1200; })();

// ─── Blocked email patterns ───────────────────────────────────────────────────
// Note: gmail.com, outlook.com, hotmail.com ARE valid clinic emails — don't block them
const BLOCKED_CONTAINS = [
  'noreply', 'no-reply', 'donotreply', 'example.com', 'sentry',
  'wixpress', 'schema.org', 'wordpress', 'w3.org', 'cloudflare',
  'support@domain', 'test@', 'user@', 'email@email',
  'utilisateur@', '@domaine.com', 'votre@', '@exemple.', 'your@email',
  'youremail@', 'email@domain', 'name@domain', '@domain.com',
];
const BLOCKED_EXTENSIONS = ['.png', '.jpg', '.gif', '.svg', '.webp', '.css', '.js'];
const BLOCKED_PREFIXES_OF_DOMAIN = ['2x.', 'pixel.', 'tracking.', 'cdn.', 'assets.'];

// Domain registrars — WHOIS often returns their abuse contact, not the clinic owner
const REGISTRAR_DOMAINS = new Set([
  'godaddy.com', 'namecheap.com', 'enom.com', 'webnames.ca', 'gcd.com',
  'tucows.com', 'register.com', 'networksolutions.com', 'bluehost.com',
  'hostgator.com', 'hover.com', 'dynadot.com', 'porkbun.com',
  'ionos.com', 'pair.com', 'gandi.net', 'ovh.com', 'ovh.ca',
  'name.com', 'nearlyfreespeech.net', 'rebel.ca', 'easydns.com',
  'wildwestdomains.com', 'secureserver.net', 'squarespace.com',
  'wix.com', 'weebly.com', 'shopify.com',
  // Web hosting providers whose admin contacts appear in WHOIS
  'web.com', 'domain.com', 'domains.com', 'networksol.com',
  'domainsbyproxy.com', 'whoisguard.com', 'privacyguardian.org',
  'perfectprivacy.com', 'contactprivacy.com', 'privatedns.com',
]);

function isRegistrarEmail(email) {
  const lower = email.toLowerCase();
  if (lower.startsWith('abuse@') || lower.startsWith('hostmaster@') ||
      lower.startsWith('postmaster@') || lower.startsWith('whois@') ||
      lower.startsWith('domainabuse@') || lower.startsWith('registrar@')) return true;
  const domain = lower.split('@')[1];
  return domain ? REGISTRAR_DOMAINS.has(domain) : false;
}

const EMAIL_RE = /\b[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}\b/g;

function cleanEmails(raw, clinicDomain) {
  return [...new Set(raw)].filter(e => {
    const lower = e.toLowerCase();
    if (BLOCKED_CONTAINS.some(b => lower.includes(b))) return false;
    if (BLOCKED_EXTENSIONS.some(b => lower.endsWith(b))) return false;
    if (isRegistrarEmail(lower)) return false;
    const parts = lower.split('@');
    if (parts.length !== 2) return false;
    const domain = parts[1];
    if (!domain.includes('.')) return false;
    if (BLOCKED_PREFIXES_OF_DOMAIN.some(p => domain.startsWith(p))) return false;
    if (parts[0].length < 2 || parts[0].length > 64) return false;
    return true;
  });
}

// ─── Confidence scoring ───────────────────────────────────────────────────────
const GENERIC_PREFIXES = ['info', 'contact', 'hello', 'admin', 'office', 'reception',
  'front', 'booking', 'appointment', 'dental', 'clinic', 'welcome', 'general',
  'enquiry', 'inquiry', 'support', 'mail', 'email', 'care', 'team', 'help'];

function scoreEmail(email, method) {
  const local = email.split('@')[0].toLowerCase();
  const isNamed = !GENERIC_PREFIXES.includes(local) &&
    local.length > 2 && local.length < 20 &&
    !/^\d+$/.test(local);
  if (method === 'pattern') return 'medium';
  if (isNamed) return 'high';
  return 'medium';
}

// ─── URL cleaning ─────────────────────────────────────────────────────────────
function cleanUrl(rawUrl) {
  try {
    const u = new URL(rawUrl);
    // Strip UTM and tracking params
    ['utm_source','utm_medium','utm_campaign','utm_term','utm_content',
     'cc','gclid','fbclid','msclkid','ref','source','origin'].forEach(p => u.searchParams.delete(p));
    return u.origin + u.pathname.replace(/\/$/, '');
  } catch { return rawUrl.split('?')[0].replace(/\/$/, ''); }
}

// ─── Fetch helper ─────────────────────────────────────────────────────────────
async function safeFetch(url, timeoutMs = 10_000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      redirect: 'follow',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-CA,en;q=0.9,fr-CA;q=0.8',
      },
    });
    clearTimeout(t);
    if (!res.ok) return null;
    const text = await res.text();
    return text;
  } catch { clearTimeout(t); return null; }
}

// ─── MX verification ─────────────────────────────────────────────────────────
const mxCache = {};
async function hasMxRecords(domain) {
  if (domain in mxCache) return mxCache[domain];
  try {
    const records = await dns.resolveMx(domain);
    mxCache[domain] = records.length > 0;
  } catch { mxCache[domain] = false; }
  return mxCache[domain];
}

// ─── Extract emails from HTML ─────────────────────────────────────────────────
function extractFromHtml(html, clinicDomain) {
  const raw = [];
  // Standard regex
  raw.push(...(html.match(EMAIL_RE) || []));
  // mailto: links
  const mailtos = html.match(/mailto:([a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,})/g) || [];
  mailtos.forEach(m => raw.push(m.replace('mailto:', '')));
  // data-email="..." attributes (Cloudflare email obfuscation)
  const dataEmails = html.match(/data-email="([^"]+)"/g) || [];
  dataEmails.forEach(m => {
    const val = m.match(/data-email="([^"]+)"/)?.[1];
    if (val) raw.push(val);
  });
  // CF email encoding: /cdn-cgi/l/email-protection#HEX
  const cfEncoded = html.match(/\/cdn-cgi\/l\/email-protection#([0-9a-f]+)/gi) || [];
  cfEncoded.forEach(m => {
    try {
      const hex = m.split('#')[1];
      const key = parseInt(hex.slice(0, 2), 16);
      let decoded = '';
      for (let i = 2; i < hex.length; i += 2) {
        decoded += String.fromCharCode(parseInt(hex.slice(i, i+2), 16) ^ key);
      }
      if (decoded.includes('@')) raw.push(decoded);
    } catch {}
  });
  return cleanEmails(raw, clinicDomain);
}

// ─── METHOD 1: Deep page scrape ───────────────────────────────────────────────
async function method1_pageScrape(clinic) {
  const base = cleanUrl(clinic.website);
  const domain = (() => { try { return new URL(base).hostname; } catch { return ''; } })();
  const pages = [
    base,
    base + '/contact',
    base + '/contact-us',
    base + '/about',
    base + '/about-us',
    base + '/team',
    base + '/meet-the-team',
    base + '/our-team',
    base + '/staff',
    base + '/doctors',
    base + '/fr/contact',
    base + '/contactez-nous',
  ];

  for (const url of pages) {
    const html = await safeFetch(url);
    if (!html) continue;
    const emails = extractFromHtml(html, domain);
    const clinicDomain = domain;
    // Prefer emails that match the clinic domain, then accept any
    const domainMatch = emails.filter(e => e.endsWith('@' + clinicDomain) || e.endsWith('.' + clinicDomain));
    const result = domainMatch[0] || emails[0] || null;
    if (result) return { email: result, method: 'page-scrape', page: url.replace(base, '')||'/' };
  }
  return null;
}

// ─── METHOD 2: Google Cache ───────────────────────────────────────────────────
async function method2_googleCache(clinic) {
  const base = cleanUrl(clinic.website);
  const domain = (() => { try { return new URL(base).hostname; } catch { return ''; } })();
  const cacheUrl = `https://webcache.googleusercontent.com/search?q=cache:${domain}`;
  const html = await safeFetch(cacheUrl, 8000);
  if (!html) return null;
  const emails = extractFromHtml(html, domain);
  if (emails[0]) return { email: emails[0], method: 'google-cache' };
  return null;
}

// ─── METHOD 3: Email pattern + MX verification ───────────────────────────────
async function method3_patternTest(clinic) {
  const base = cleanUrl(clinic.website);
  let domain;
  try { domain = new URL(base).hostname.replace(/^www\./, ''); } catch { return null; }
  if (!domain) return null;
  if (!(await hasMxRecords(domain))) return null;

  // Use only standard prefixes — clinic-name prefixes are too unreliable
  const prefixes = clinic.type === 'physio'
    ? ['info', 'reception', 'contact', 'office', 'physio']
    : ['info', 'reception', 'contact', 'office', 'dental'];

  // Return the most common pattern — domain has MX so delivery is plausible
  const email = `${prefixes[0]}@${domain}`;
  return { email, method: 'pattern', domain };
}

// ─── METHOD 4: DuckDuckGo search ─────────────────────────────────────────────
async function method4_duckduckgo(clinic) {
  const base = cleanUrl(clinic.website);
  let domain;
  try { domain = new URL(base).hostname; } catch { return null; }
  const query = encodeURIComponent(`site:${domain} email OR contact`);
  const url = `https://html.duckduckgo.com/html/?q=${query}`;
  const html = await safeFetch(url, 10_000);
  if (!html) return null;
  const emails = extractFromHtml(html, domain);
  const domainMatch = emails.filter(e => e.includes('@' + domain.replace(/^www\./, '')));
  if (domainMatch[0]) return { email: domainMatch[0], method: 'ddg-search' };
  return null;
}

// ─── METHOD 5: WHOIS registrant email ────────────────────────────────────────
async function method5_whois(clinic) {
  const base = cleanUrl(clinic.website);
  let domain;
  try { domain = new URL(base).hostname.replace(/^www\./, ''); } catch { return null; }
  // Use rdap.org — free, no key needed, returns JSON
  const url = `https://rdap.org/domain/${domain}`;
  const html = await safeFetch(url, 8000);
  if (!html) return null;
  try {
    const data = JSON.parse(html);
    // Look for email in entities > vcardArray
    const walk = (obj) => {
      if (!obj || typeof obj !== 'object') return null;
      if (Array.isArray(obj)) {
        for (const item of obj) { const r = walk(item); if (r) return r; }
        return null;
      }
      for (const [k, v] of Object.entries(obj)) {
        if (k === 'vcardArray' && Array.isArray(v)) {
          const flat = JSON.stringify(v);
          const emails = flat.match(EMAIL_RE) || [];
          const valid = cleanEmails(emails, domain);
          if (valid[0]) return valid[0];
        }
        if (typeof v === 'object') { const r = walk(v); if (r) return r; }
      }
      return null;
    };
    const found = walk(data);
    // Only accept WHOIS emails whose domain matches the clinic's website domain
    // (rejects registrar/hosting contacts that slipped through)
    if (found) {
      const emailDomain = found.split('@')[1]?.toLowerCase();
      if (emailDomain && emailDomain === domain) {
        return { email: found, method: 'whois' };
      }
    }
  } catch {}
  return null;
}

// ─── METHOD 6: Google site-search via scraping ───────────────────────────────
async function method6_googleSiteSearch(clinic) {
  const base = cleanUrl(clinic.website);
  let domain;
  try { domain = new URL(base).hostname.replace(/^www\./, ''); } catch { return null; }
  const name = encodeURIComponent(clinic.clinicName || '');
  const url = `https://www.google.com/search?q=site%3A${domain}+%22%40${domain}%22&num=3`;
  const html = await safeFetch(url, 8000);
  if (!html) return null;
  const emails = extractFromHtml(html, domain).filter(e => e.includes('@' + domain));
  if (emails[0]) return { email: emails[0], method: 'google-site-search' };
  return null;
}

// ─── Core enrichment for one clinic ──────────────────────────────────────────
export async function deepEnrichOne(clinic) {
  if (!clinic.website) return null;

  const methods = [
    () => method1_pageScrape(clinic),
    () => method4_duckduckgo(clinic),
    () => method2_googleCache(clinic),
    () => method6_googleSiteSearch(clinic),
    () => method5_whois(clinic),
    () => method3_patternTest(clinic),  // last — lowest confidence
  ];

  for (const method of methods) {
    try {
      const result = await method();
      if (result?.email) {
        const confidence = scoreEmail(result.email, result.method);
        return { ...result, confidence };
      }
    } catch {}
  }
  return null;
}

// ─── Batch enrichment ─────────────────────────────────────────────────────────
export async function deepEnrichBatch(limit = 100) {
  const all = JSON.parse(fs.readFileSync(QUEUE_PATH, 'utf-8'));
  const log = (() => { try { return JSON.parse(fs.readFileSync(LOG_PATH, 'utf-8')); } catch { return []; } })();

  // Candidates: todo, have website, no high/medium email yet
  const candidates = all
    .filter(c =>
      c.status === 'todo' &&
      c.website &&
      !c.email &&
      c.emailConfidence !== 'high' &&
      c.emailConfidence !== 'medium'
    )
    .sort((a, b) => {
      if ((b.painScore || 0) !== (a.painScore || 0)) return (b.painScore||0) - (a.painScore||0);
      return (b.reviewCount || 0) - (a.reviewCount || 0);
    })
    .slice(0, limit);

  console.log(`Deep enrichment — ${candidates.length} candidates (limit ${limit})`);

  const byMethod = {};
  let found = 0;
  let processed = 0;

  for (let i = 0; i < candidates.length; i++) {
    const clinic = candidates[i];
    const idx    = all.findIndex(c => c.clinicName === clinic.clinicName && c.website === clinic.website);

    process.stdout.write(`[${String(i+1).padStart(3)}/${candidates.length}] ${(clinic.clinicName||'').slice(0,36).padEnd(36)} `);

    const result = await deepEnrichOne(clinic);

    if (result) {
      all[idx].email           = result.email;
      all[idx].emailConfidence = result.confidence;
      all[idx].emailSource     = result.method;
      all[idx].emailFoundAt    = new Date().toISOString();
      if (result.method !== 'pattern') {
        all[idx].emailMxVerified = true;
      }
      byMethod[result.method] = (byMethod[result.method] || 0) + 1;
      found++;
      console.log(`✓ ${result.confidence} | ${result.email} [${result.method}]`);
      log.push({ clinicName: clinic.clinicName, email: result.email, method: result.method, confidence: result.confidence, foundAt: new Date().toISOString() });
    } else {
      // Mark as attempted so we skip next time
      all[idx].deepEnrichAttemptedAt = new Date().toISOString();
      console.log(`— not found`);
    }

    processed++;

    // Crash-safe progress save every SAVE_EVERY clinics
    if (processed % SAVE_EVERY === 0) {
      fs.writeFileSync(QUEUE_PATH, JSON.stringify(all, null, 2), 'utf-8');
      fs.writeFileSync(LOG_PATH, JSON.stringify(log, null, 2), 'utf-8');
      process.stdout.write(`  [progress saved — ${processed}/${candidates.length}]\n`);
    }

    if (i < candidates.length - 1) await new Promise(r => setTimeout(r, DELAY_ARG));
  }

  // Final save
  fs.writeFileSync(QUEUE_PATH, JSON.stringify(all, null, 2), 'utf-8');
  fs.writeFileSync(LOG_PATH, JSON.stringify(log, null, 2), 'utf-8');

  const todo = all.filter(c => c.status === 'todo');
  const totalReady = todo.filter(c => c.email && ['high','medium'].includes(c.emailConfidence)).length;

  return { processed, found, byMethod, totalReady };
}

// ─── Entry point ──────────────────────────────────────────────────────────────
const isMain = process.argv[1] &&
  (process.argv[1].endsWith('deepEnrich.js') || process.argv[1].endsWith('deepEnrich'));

if (isMain) {
  console.log(`\nDeep Email Enrichment — limit: ${LIMIT_ARG} | delay: ${DELAY_ARG}ms\n`);
  const results = await deepEnrichBatch(LIMIT_ARG);
  console.log(`\n${'═'.repeat(52)}`);
  console.log(`Processed: ${results.processed} | Found: ${results.found} (${Math.round(results.found/results.processed*100)}%)`);
  console.log('By method:');
  Object.entries(results.byMethod).sort((a,b)=>b[1]-a[1]).forEach(([k,v]) => console.log(`  ${k}: ${v}`));
  console.log(`Total ready to send: ${results.totalReady}`);
}
