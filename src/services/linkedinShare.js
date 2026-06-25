// src/services/linkedinShare.js
// Generates a one-tap LinkedIn sharing link for the daily post.
// Uses LinkedIn's official share URL — zero automation, zero ban risk.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname  = path.dirname(fileURLToPath(import.meta.url));
const ROOT       = path.resolve(__dirname, '../..');
const POST_PATH  = path.join(ROOT, 'data', 'linkedin', 'daily-post.txt');
const LOG_PATH   = path.join(ROOT, 'data', 'linkedin', 'post-log.json');

export function loadDailyPost() {
  try {
    if (!fs.existsSync(POST_PATH)) return null;
    const raw = fs.readFileSync(POST_PATH, 'utf8').trim();
    if (!raw) return null;
    // Strip the metadata header (lines starting with # or ---)
    const lines = raw.split('\n');
    const bodyStart = lines.findIndex((l, i) => i > 0 && !l.startsWith('#') && !l.startsWith('---') && l.trim() !== '');
    const bodyLines = lines.slice(bodyStart).filter(l => !l.startsWith('---') && !l.startsWith('Generated:') && !l.startsWith('Format:'));
    return bodyLines.join('\n').trim() || null;
  } catch { return null; }
}

export function wasPostedToday() {
  try {
    const today = new Date().toISOString().slice(0, 10);
    const log = JSON.parse(fs.readFileSync(LOG_PATH, 'utf8'));
    return log.some(e => e.date === today);
  } catch { return false; }
}

export function buildLinkedInShareUrl(postText) {
  const encoded = encodeURIComponent(postText);
  // LinkedIn's official share endpoint — opens compose with text prefilled
  const shareUrl = `https://www.linkedin.com/feed/?shareActive=true&text=${encoded}`;
  return { shareUrl, postText };
}

// ── Plain-text section for morning brief email ─────────────────────────────

export function buildLinkedInBriefSection(postText) {
  if (!postText) return '';
  const { shareUrl } = buildLinkedInShareUrl(postText);
  const alreadyPosted = wasPostedToday();

  if (alreadyPosted) {
    return `\n── LINKEDIN ──────────────────────────────────────────────
✓ Already posted today.\n`;
  }

  return `
── LINKEDIN POST (10 seconds) ────────────────────────────
Open link → paste text → post:

  ${shareUrl}

Post text:
---
${postText}
---
After posting: node src/cli/markLinkedInPosted.js
`;
}

// ── HTML section for brief (if brief ever gains HTML mode) ────────────────

export function buildLinkedInBriefHTML(postText) {
  if (!postText) return '';
  const { shareUrl } = buildLinkedInShareUrl(postText);
  const alreadyPosted = wasPostedToday();
  const escaped = postText
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  if (alreadyPosted) {
    return `<div style="background:#f0fdf4;border-left:3px solid #16a34a;padding:12px 16px;margin:16px 0;border-radius:4px;font-size:13px;color:#15803d">✓ LinkedIn — already posted today.</div>`;
  }

  return `<div style="background:#f8fafc;border-left:3px solid #0077b5;padding:16px;margin:20px 0;border-radius:4px">
  <div style="font-size:11px;font-weight:700;color:#0077b5;text-transform:uppercase;letter-spacing:1px;margin-bottom:10px">Today's LinkedIn Post</div>
  <div style="background:#fff;border:1px solid #e2e8f0;border-radius:6px;padding:14px;margin-bottom:14px;font-size:14px;color:#1e293b;line-height:1.7;white-space:pre-wrap">${escaped}</div>
  <a href="${shareUrl}" style="display:inline-block;background:#0077b5;color:#fff;padding:10px 20px;border-radius:6px;text-decoration:none;font-size:14px;font-weight:600;margin-right:10px">Post to LinkedIn →</a>
  <span style="font-size:12px;color:#94a3b8">LinkedIn will open — paste text → post. 10 seconds.</span>
</div>`;
}
