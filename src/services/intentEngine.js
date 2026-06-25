// src/services/intentEngine.js
// Fetches high-intent page visits from the live site and cross-references
// visitor cities against the dental prospect database.
// Called from sendMorningBrief.js to flag prospects as "actively searching".

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT     = path.resolve(__dirname, '../..');
const DATA_DIR = path.join(ROOT, 'data');

const INTENT_API = 'https://clinicflowautomation.com/api/intent-visits';

function readSafe(p, fallback) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return fallback; }
}

function normalizeCity(city) {
  return (city || '').toLowerCase().trim().replace(/[^a-z\s]/g, '');
}

export async function getIntentSignals() {
  const dental = readSafe(path.join(DATA_DIR, 'outreach.localDentists.json'), []);

  // Build a city → [clinics] map from dental prospects not yet converted
  const cityMap = {};
  for (const c of dental) {
    if (c.status === 'converted' || c.excludeForever) continue;
    const city = normalizeCity(c.city);
    if (!city) continue;
    if (!cityMap[city]) cityMap[city] = [];
    cityMap[city].push(c);
  }

  let visits = [];
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    const res = await fetch(INTENT_API, { signal: ctrl.signal });
    clearTimeout(timer);
    const data = await res.json();
    visits = data.visits || [];
  } catch (e) {
    return { visits: [], matches: [], error: e.message };
  }

  // Cross-reference each visit's city against prospects
  const matches = [];
  const seenClinics = new Set();

  for (const visit of visits) {
    if (!visit.city) continue;
    const visitorCity = normalizeCity(visit.city);
    const prospects = cityMap[visitorCity] || [];

    for (const prospect of prospects) {
      const key = prospect.email || prospect.clinicName;
      if (seenClinics.has(key)) continue;
      seenClinics.add(key);

      matches.push({
        clinicName:  prospect.clinicName,
        city:        prospect.city,
        email:       prospect.email,
        phone:       prospect.phone || prospect.googlePhone || null,
        visitedPage: visit.page,
        visitedAt:   new Date(visit.ts).toISOString(),
        rating:      prospect.rating,
        reviewCount: prospect.reviewCount,
        status:      prospect.status,
      });
    }
  }

  matches.sort((a, b) => new Date(b.visitedAt) - new Date(a.visitedAt));

  return { visits, matches, error: null };
}

// Format for morning brief email/console
export function formatIntentSection(signals) {
  if (!signals.visits.length) return null;

  const lines = [`🧠 INTENT SIGNAL — ${signals.visits.length} visitor${signals.visits.length !== 1 ? 's' : ''} on high-intent pages`];

  for (const v of signals.visits.slice(0, 5)) {
    const city = v.city ? ` · ${v.city}` : '';
    const minsAgo = Math.round((Date.now() - v.ts) / 60000);
    const when = minsAgo < 60 ? `${minsAgo}m ago` : `${Math.round(minsAgo / 60)}h ago`;
    lines.push(`  ${v.page}${city} — ${when}`);
  }

  if (signals.matches.length > 0) {
    lines.push('');
    lines.push(`  Matching prospects in visitor cities:`);
    for (const m of signals.matches.slice(0, 3)) {
      lines.push(`  ⚡ ${m.clinicName} (${m.city}) — ${m.email || 'no email'}`);
    }
  }

  return lines.join('\n');
}
