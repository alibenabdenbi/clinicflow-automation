// src/cli/markLinkedInPosted.js
// Run after posting on LinkedIn to track consistency.
// Usage: node src/cli/markLinkedInPosted.js

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { loadDailyPost } from '../services/linkedinShare.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT      = path.resolve(__dirname, '../..');
const LOG_PATH  = path.join(ROOT, 'data', 'linkedin', 'post-log.json');

const today = new Date().toISOString().slice(0, 10);
let log = [];
try { log = JSON.parse(fs.readFileSync(LOG_PATH, 'utf8')); } catch { log = []; }

const alreadyLogged = log.find(e => e.date === today);
if (alreadyLogged) {
  console.log(`✓ Already marked as posted for today: ${today}`);
  process.exit(0);
}

const post = loadDailyPost();
log.push({
  date:        today,
  postedAt:    new Date().toISOString(),
  postPreview: post ? post.slice(0, 100) + (post.length > 100 ? '…' : '') : '(no post found)',
});

fs.mkdirSync(path.dirname(LOG_PATH), { recursive: true });
fs.writeFileSync(LOG_PATH, JSON.stringify(log, null, 2));

const streak = (() => {
  let s = 0;
  for (let i = log.length - 1; i >= 0; i--) {
    const d = new Date(log[i].date);
    const expected = new Date();
    expected.setDate(expected.getDate() - (log.length - 1 - i));
    if (d.toISOString().slice(0,10) === expected.toISOString().slice(0,10)) s++;
    else break;
  }
  return s;
})();

console.log(`✓ LinkedIn post marked as done for ${today}`);
console.log(`Total posts logged: ${log.length} | Current streak: ${streak} day${streak !== 1 ? 's' : ''}`);
console.log('Consistency is what makes this work.');
