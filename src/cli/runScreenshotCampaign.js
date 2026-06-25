// src/cli/runScreenshotCampaign.js
// Runs the personalized screenshot outreach campaign.
//
// Usage:
//   node src/cli/runScreenshotCampaign.js --dry-run --limit 5
//   node src/cli/runScreenshotCampaign.js --limit 10
//   node src/cli/runScreenshotCampaign.js              (default: 20)

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { sendScreenshotEmail } from './sendScreenshotEmail.js';

dotenv.config();
if (process.platform === 'win32') process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');
const OUTREACH_PATH = path.join(ROOT, 'data', 'outreach.localDentists.json');

const args    = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const LIMIT   = (() => { const i = args.indexOf('--limit'); return i !== -1 ? Number(args[i + 1]) : 20; })();
const DELAY_MS = 3 * 60 * 1000; // 3 minutes between sends

function readJsonSafe(p, fb) {
  try { return JSON.parse(fs.readFileSync(p, 'utf-8')); } catch { return fb; }
}
function writeJson(p, data) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(data, null, 2), 'utf-8');
}
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function run() {
  const all = readJsonSafe(OUTREACH_PATH, []);

  // Top prospects: todo, have email, not yet screenshot-contacted, sorted by priority
  const prospects = all
    .filter(c =>
      c.status === 'todo' &&
      c.email &&
      !c.screenshotSentAt &&
      (c.emailConfidence === 'high' || c.emailConfidence === 'medium')
    )
    .sort((a, b) => (b.priorityScore || 0) - (a.priorityScore || 0))
    .slice(0, LIMIT);

  console.log(`\n${'═'.repeat(60)}`);
  console.log(`SCREENSHOT CAMPAIGN — ${DRY_RUN ? 'DRY RUN' : 'LIVE SEND'}`);
  console.log(`Prospects: ${prospects.length} | Limit: ${LIMIT} | Delay: ${DELAY_MS / 1000}s between sends`);
  console.log(`${'═'.repeat(60)}\n`);

  if (prospects.length === 0) {
    console.log('No eligible prospects — all have been contacted or lack high/medium confidence email.');
    return;
  }

  let sent = 0, errors = 0;

  for (let i = 0; i < prospects.length; i++) {
    const clinic = prospects[i];
    const idx    = all.findIndex(c => c.clinicName === clinic.clinicName && c.email === clinic.email);

    console.log(`\n[${i + 1}/${prospects.length}] ${clinic.clinicName}`);
    console.log(`  City:  ${clinic.city || '—'}`);
    console.log(`  Email: ${clinic.email}`);
    console.log(`  Pain:  ${clinic.painSignals?.[0] || 'none'}`);

    try {
      const result = await sendScreenshotEmail({
        clinicName:  clinic.clinicName,
        city:        clinic.city || '',
        email:       clinic.email,
        rating:      clinic.rating,
        reviewCount: clinic.reviewCount,
        painSignal:  clinic.painSignals?.[0] || null,
        type:        clinic.market || 'dental',
        contactName: clinic.contactName || null,
      }, { dryRun: DRY_RUN });

      if (result.sent || DRY_RUN) {
        if (!DRY_RUN && idx !== -1) {
          all[idx].screenshotSentAt       = new Date().toISOString();
          all[idx].screenshotEmailSubject = result.subject;
          all[idx].screenshotPath         = result.screenshotPath;
        }
        console.log(`  ${DRY_RUN ? '☐ (dry run)' : '✓ Sent'}`);
        if (!DRY_RUN) sent++;
      }
    } catch (e) {
      console.log(`  ✗ Error: ${e.message.slice(0, 100)}`);
      errors++;
    }

    if (i < prospects.length - 1) {
      if (!DRY_RUN) {
        console.log(`  ⏱ Waiting ${DELAY_MS / 1000}s before next send…`);
        await sleep(DELAY_MS);
      }
    }
  }

  // Persist tracking data
  if (!DRY_RUN && sent > 0) writeJson(OUTREACH_PATH, all);

  console.log(`\n${'─'.repeat(60)}`);
  console.log(`Campaign done: sent=${sent} errors=${errors} ${DRY_RUN ? '(dry run)' : ''}`);
  if (!DRY_RUN) console.log(`Tracking saved → ${OUTREACH_PATH}`);
}

run().catch(e => { console.error(e.message); process.exit(1); });
