// src/monitors/reviewMonitor.js
// Real-time Google review monitor: detects new negative communication reviews
// for prospects and sends a personal alert to the operator at the moment of pain.
//
// Two modes:
//  - Real (GOOGLE_PLACES_API_KEY set): polls Places API for fresh reviews
//  - Simulation (no API key): sends alerts from existing painSignals in the dental file

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { sendMail } from '../services/mailer.js';

if (process.platform === 'win32') process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');
const DATA_DIR = path.join(ROOT, 'data');
const SEEN_PATH = path.join(DATA_DIR, 'review-monitor-seen.json');
const DENTAL_PATH = path.join(DATA_DIR, 'outreach.localDentists.json');

const OPERATOR_EMAIL = process.env.OPERATOR_EMAIL || 'm.aliben432@gmail.com';
const BASE_URL = process.env.PUBLIC_BASE_URL || 'https://clinicflowautomation.com';
const BATCH_SIZE = 50;
const REQUEST_DELAY_MS = 1000;

const PAIN_KEYWORDS = [
  'no answer',
  'voicemail',
  "couldn't reach",
  'never called back',
  'no response',
  'hard to reach',
  'impossible to reach',
  'phone just rings',
  'left a message',
  'no call back',
  "didn't call back",
  'not responsive',
  'unreachable',
  'unanswered',
  'missed call',
  'keeps going to voicemail',
];

function loadSeen() {
  try {
    if (fs.existsSync(SEEN_PATH)) return JSON.parse(fs.readFileSync(SEEN_PATH, 'utf8'));
  } catch {}
  return {};
}

function saveSeen(seen) {
  fs.writeFileSync(SEEN_PATH, JSON.stringify(seen, null, 2));
}

function hasPainSignal(text) {
  if (!text) return null;
  const lower = text.toLowerCase();
  return PAIN_KEYWORDS.find(kw => lower.includes(kw)) || null;
}

function clinicSlug(clinic) {
  if (clinic.slug) return clinic.slug;
  return (clinic.clinicName || clinic.name || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

async function fetchReviews(placeId, apiKey) {
  const url = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${encodeURIComponent(placeId)}&fields=reviews&key=${apiKey}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Places API ${res.status}`);
  const json = await res.json();
  return json.result?.reviews || [];
}

async function sendPainAlert(clinic, review, keyword) {
  const slug = clinicSlug(clinic);
  const name = clinic.clinicName || clinic.name || clinic.email;
  const stars = '★'.repeat(review.rating || 1) + '☆'.repeat(Math.max(0, 5 - (review.rating || 1)));
  const reviewerName = review.author_name || 'A patient';

  const subject = `Pain signal: ${name} — missed call review`;
  const body = `New negative review detected — communication pain.

Clinic:   ${name}
City:     ${clinic.city || ''}
Email:    ${clinic.email || 'not on file'}

Review (${stars}):
"${review.text}"

Keyword: "${keyword}"
Reviewer: ${reviewerName}

Reach out now while the pain is fresh:
${BASE_URL}/for/${slug}

— Review Monitor`;

  await sendMail({ to: OPERATOR_EMAIL, subject, text: body });
}

export async function runReviewMonitor() {
  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) {
    console.log('GOOGLE_PLACES_API_KEY not set — running simulation mode');
    return runSimulationMode();
  }

  const dental = JSON.parse(fs.readFileSync(DENTAL_PATH, 'utf8'));
  const seen = loadSeen();
  let alertsSent = 0;
  let checked = 0;

  const candidates = dental
    .filter(c => c.placeId && !c.excludeForever && !c.reviewAlertSent)
    .slice(0, BATCH_SIZE);

  for (const clinic of candidates) {
    try {
      const reviews = await fetchReviews(clinic.placeId, apiKey);
      checked++;

      for (const review of reviews) {
        const reviewId = `${clinic.placeId}:${review.time}`;
        if (seen[reviewId]) continue;
        seen[reviewId] = true;

        const keyword = hasPainSignal(review.text);
        if (keyword && (review.rating || 5) <= 3) {
          await sendPainAlert(clinic, review, keyword);
          alertsSent++;
          const idx = dental.findIndex(d => d.email === clinic.email);
          if (idx !== -1) {
            dental[idx].reviewAlertSent = true;
            dental[idx].reviewAlertSentAt = new Date().toISOString();
          }
          break; // one alert per clinic per run
        }
      }

      await new Promise(r => setTimeout(r, REQUEST_DELAY_MS));
    } catch (e) {
      console.error(`Review fetch failed for ${clinic.clinicName || clinic.email}: ${e.message}`);
    }
  }

  saveSeen(seen);
  fs.writeFileSync(DENTAL_PATH, JSON.stringify(dental, null, 2));

  console.log(`Review monitor: checked ${checked} clinics, sent ${alertsSent} pain alerts`);
  return { checked, alertsSent };
}

export async function runSimulationMode() {
  const dental = JSON.parse(fs.readFileSync(DENTAL_PATH, 'utf8'));
  let alertsSent = 0;

  // Clinics with stored pain signals that haven't been alerted yet
  const candidates = dental.filter(c =>
    Array.isArray(c.painSignals) && c.painSignals.length > 0 &&
    !c.reviewAlertSent && !c.excludeForever && c.email
  ).slice(0, 5);

  for (const clinic of candidates) {
    const signal = clinic.painSignals[0];
    const signalText = typeof signal === 'string' ? signal : (signal?.text || signal?.signal || '');
    const keyword = hasPainSignal(signalText);
    if (!keyword) continue;

    const fakeReview = {
      text: signalText,
      rating: 2,
      author_name: 'Existing pain signal',
    };

    try {
      await sendPainAlert(clinic, fakeReview, keyword);
      alertsSent++;
      const idx = dental.findIndex(d => d.email === clinic.email);
      if (idx !== -1) {
        dental[idx].reviewAlertSent = true;
        dental[idx].reviewAlertSentAt = new Date().toISOString();
      }
    } catch (e) {
      console.error(`Sim alert failed for ${clinic.clinicName || clinic.email}: ${e.message}`);
    }
  }

  fs.writeFileSync(DENTAL_PATH, JSON.stringify(dental, null, 2));
  console.log(`Simulation mode: sent ${alertsSent} alerts from existing pain signals`);
  return { alertsSent, mode: 'simulation' };
}
