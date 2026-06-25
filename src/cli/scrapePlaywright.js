import { chromium } from 'playwright';
// Playwright-based email scraper
// Handles JS-rendered pages, contact forms, obfuscated emails
// Run: node src/cli/scrapePlaywright.js --limit 50

import fs from 'fs';
import dotenv from 'dotenv';
dotenv.config();

const args = process.argv.slice(2);
const getArg = (flag, def) => { const i = args.indexOf(flag); return i !== -1 ? parseInt(args[i + 1]) : def; };
const limit  = getArg('--limit', 50);
const offset = getArg('--offset', 0);

const dental = JSON.parse(fs.readFileSync('data/outreach.localDentists.json', 'utf8'));

const targets = dental.filter(c =>
  c.status === 'todo' &&
  c.mxValidated &&
  !c.excludeForever &&
  c.website &&
  !c.scrapedEmail &&
  !c.verifiedEmailSent
).slice(offset, offset + limit);

console.log(`Playwright scraping ${targets.length} clinics...\n`);

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
});

const emailRegex = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g;
const genericPrefixes = ['noreply','no-reply','support','admin','webmaster','wordpress','test'];
const genericLocalParts = new Set(['info','contact','office','reception','admin','booking','dental',
  'smile','clinic','front','hello','mail','enquiries','enquiry','appointments','appt']);
const contactPaths = ['/contact','/contact-us','/about','/team','/staff',
  '/meet-the-doctor','/meet-the-dentist','/our-team','/dentists','/about-us'];

let found = 0;

for (let i = 0; i < targets.length; i++) {
  const clinic = targets[i];
  const domain = clinic.email?.split('@')[1];
  const emails = new Set();

  try {
    const page = await context.newPage();
    await page.setDefaultTimeout(8000);

    const base = clinic.website?.replace(/\/$/, '');
    const urlsToCheck = [clinic.website, ...contactPaths.map(p => base + p)].slice(0, 4);

    for (const url of urlsToCheck) {
      try {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 6000 });

        const content = await page.content();
        const text = await page.evaluate(() => document.body?.innerText || '');

        const mailtoLinks = await page.evaluate(() =>
          [...document.querySelectorAll('a[href^="mailto:"]')]
            .map(a => a.href.replace('mailto:', '').split('?')[0].trim().toLowerCase())
        );

        const htmlEmails = content.match(emailRegex) || [];
        const textEmails = text.match(emailRegex) || [];
        [...htmlEmails, ...textEmails, ...mailtoLinks].forEach(e => {
          const clean = e.toLowerCase().trim();
          if (clean.includes('@') && !genericPrefixes.some(s => clean.startsWith(s))) {
            emails.add(clean);
          }
        });

        if (emails.size > 0) break;
      } catch {
        // silent — try next path
      }
    }

    await page.close();

    // Prefer domain-matching, then Gmail/Hotmail/Outlook (small clinics often use these)
    const domainEmails = [...emails].filter(e =>
      (domain && e.endsWith('@' + domain)) ||
      /\@(gmail|hotmail|outlook|yahoo)\.com$/.test(e)
    );

    // Prefer named (non-generic) addresses
    const namedEmails = domainEmails.filter(e => {
      const local = e.split('@')[0];
      return !genericLocalParts.has(local) && local.length > 2;
    });

    const bestEmail = namedEmails[0] || domainEmails[0];

    if (bestEmail && bestEmail !== clinic.email?.toLowerCase()) {
      const idx = dental.findIndex(d => d.email === clinic.email);
      if (idx !== -1) {
        dental[idx].scrapedEmail = bestEmail;
        dental[idx].scrapedEmailSource = 'playwright';
        dental[idx].scrapedEmailFoundAt = new Date().toISOString();
      }
      found++;
      console.log(`✓ ${clinic.clinicName} — ${bestEmail}`);
    }

  } catch {
    // silent — skip clinic
  }

  if ((i + 1) % 10 === 0) {
    console.log(`[${i+1}/${targets.length} checked, ${found} found so far]`);
    fs.writeFileSync('data/outreach.localDentists.json', JSON.stringify(dental, null, 2));
  }
}

await browser.close();
fs.writeFileSync('data/outreach.localDentists.json', JSON.stringify(dental, null, 2));
console.log(`\n✓ Playwright scrape complete: ${found}/${targets.length} verified emails found`);
console.log(`Yield: ${((found / Math.max(targets.length, 1)) * 100).toFixed(1)}%`);
