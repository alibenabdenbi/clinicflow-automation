// BBB owner name scraper — finds owner names for Canadian dental clinics
// Use owner name in greeting on info@ emails — no bounce risk
// Run: node src/cli/scrapeBBBOwners.js --limit 50

import { chromium } from 'playwright';
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
  !c.ownerName &&
  !c.verifiedEmailSent
).slice(offset, offset + limit);

console.log(`Searching BBB for ${targets.length} clinic owners...\n`);

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
});

let found = 0;

for (let i = 0; i < targets.length; i++) {
  const clinic = targets[i];
  try {
    const page = await context.newPage();
    await page.setDefaultTimeout(8000);

    const searchUrl = 'https://www.bbb.org/search?find_text=' +
      encodeURIComponent(clinic.clinicName + ' ' + (clinic.city || '')) +
      '&find_country=CAN&find_type=Business';

    await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 8000 });

    // Grab first profile link
    const profileHref = await page.evaluate(() => {
      const a = document.querySelector('a[href*="/profile/"]');
      return a ? a.getAttribute('href') : null;
    });

    if (profileHref) {
      const profileUrl = profileHref.startsWith('http')
        ? profileHref
        : 'https://www.bbb.org' + profileHref;

      await page.goto(profileUrl, { waitUntil: 'domcontentloaded', timeout: 8000 });

      // Extract owner from "Business Management" section
      const ownerName = await page.evaluate(() => {
        const headings = [...document.querySelectorAll('h3,h4,dt,strong,b')];
        for (const h of headings) {
          const text = h.innerText || '';
          if (/business management|owner|principal/i.test(text)) {
            // Look for the next sibling or nearby element with a name
            const next = h.nextElementSibling || h.parentElement?.nextElementSibling;
            if (next) {
              const name = next.innerText?.trim();
              if (name && name.length > 3 && name.length < 60) return name;
            }
          }
        }
        // Fallback: look for "Owner" label in definition lists
        const dts = [...document.querySelectorAll('dt')];
        for (const dt of dts) {
          if (/owner|principal/i.test(dt.innerText)) {
            const dd = dt.nextElementSibling;
            if (dd) return dd.innerText?.trim() || null;
          }
        }
        return null;
      });

      if (ownerName && ownerName.length > 2 && ownerName.length < 60) {
        const cleanName = ownerName.replace(/,\s*(owner|ceo|president|principal|dr\.?).*/i, '').trim();
        const firstName = cleanName.replace(/^Dr\.?\s*/i, '').split(' ')[0];

        const idx = dental.findIndex(d => d.email === clinic.email);
        if (idx !== -1) {
          dental[idx].ownerName    = cleanName;
          dental[idx].contactName  = firstName;
          dental[idx].ownerSource  = 'bbb';
          dental[idx].ownerFoundAt = new Date().toISOString();
        }
        found++;
        console.log(`✓ ${clinic.clinicName} — ${cleanName}`);
      }
    }

    await page.close();
  } catch {
    // silent — skip clinic
  }

  if ((i + 1) % 10 === 0) {
    fs.writeFileSync('data/outreach.localDentists.json', JSON.stringify(dental, null, 2));
    console.log(`[${i + 1}/${targets.length} checked, ${found} owners found]`);
  }

  await new Promise(r => setTimeout(r, 1500));
}

await browser.close();
fs.writeFileSync('data/outreach.localDentists.json', JSON.stringify(dental, null, 2));
console.log(`\n✓ BBB scrape complete: ${found}/${targets.length} owner names found`);
console.log(`Yield: ${((found / Math.max(targets.length, 1)) * 100).toFixed(1)}%`);
console.log('Owner names added to ownerName + contactName fields');
console.log('info@ + "Hi [First Name]" = named greeting, zero bounce risk');
