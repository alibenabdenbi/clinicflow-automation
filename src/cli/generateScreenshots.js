// src/cli/generateScreenshots.js
// Pre-generates personalized dashboard screenshots for target clinics.
// Output: public/netlify-deploy/thumbnails/[slug].png
// Run before deploying when you have a new batch of email targets.
//
// Usage:
//   node src/cli/generateScreenshots.js               # all todo clinics with email
//   node src/cli/generateScreenshots.js --limit 50    # first 50 only
//   node src/cli/generateScreenshots.js --force       # regenerate even if cached

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { generateClinicPreview } from '../services/previewGenerator.js';
import { takeScreenshot } from '../services/screenshotEngine.js';
import { readJson } from '../storage/files.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');
const OUT_DIR = path.join(ROOT, 'public', 'netlify-deploy', 'thumbnails');

const args = process.argv.slice(2);
const limitArg = args.indexOf('--limit');
const limit = limitArg !== -1 ? parseInt(args[limitArg + 1], 10) : Infinity;
const force = args.includes('--force');

fs.mkdirSync(OUT_DIR, { recursive: true });

function slug(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

const dental = readJson(path.join(ROOT, 'data', 'outreach.localDentists.json'), []);
const targets = dental
  .filter(c => c.email && c.status === 'todo')
  .slice(0, limit);

console.log(`Generating thumbnails for ${targets.length} clinics → ${OUT_DIR}\n`);

let generated = 0, skipped = 0, failed = 0;

for (const clinic of targets) {
  const s = slug(clinic.clinicName);
  const outPath = path.join(OUT_DIR, `${s}.png`);

  if (!force && fs.existsSync(outPath)) {
    skipped++;
    continue;
  }

  try {
    const html = generateClinicPreview({
      clinicName: clinic.clinicName,
      city: clinic.city,
      rating: clinic.rating,
      reviewCount: clinic.reviewCount,
      painSignal: (clinic.painSignals || [])[0] || null,
      type: 'dental',
    });
    await takeScreenshot(html, outPath);
    generated++;
    process.stdout.write(`✓ [${generated + skipped + failed}/${targets.length}] ${clinic.clinicName}\n`);
  } catch (e) {
    failed++;
    process.stdout.write(`✗ ${clinic.clinicName}: ${e.message}\n`);
  }
}

console.log(`\nDone: ${generated} generated, ${skipped} cached, ${failed} failed`);
console.log(`Deploy public/netlify-deploy/ to activate personalized thumbnails.`);
