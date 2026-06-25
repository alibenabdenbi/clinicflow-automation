// src/cli/syncClicks.js
// Fetches today's click data from the live Netlify API and caches locally.
// Run manually or via scheduler. Used by morning brief and signal checks.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');

try {
  const res = await fetch('https://clinicflowautomation.com/api/clicks', {
    signal: AbortSignal.timeout(8000),
  });
  const data = await res.json();
  if (data.ok) {
    fs.writeFileSync(
      path.join(ROOT, 'data', 'clicks-cache.json'),
      JSON.stringify({ syncedAt: new Date().toISOString(), ...data }, null, 2)
    );
    console.log(`✓ Clicks synced: ${data.total} today (${data.calendlyClicks} Calendly)`);
  } else {
    console.log('Click sync: API returned ok=false');
  }
} catch (e) {
  console.log('Click sync skipped:', e.message);
}
