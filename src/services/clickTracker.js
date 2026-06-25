// src/services/clickTracker.js
// Generates tracked redirect URLs for emails.
// Every click goes through /c?to=DEST&clinic=SLUG&type=TYPE
// which logs the click and fires SMS for Calendly/Proposal clicks.

const BASE = 'https://clinicflowautomation.com';
const CALENDLY = 'https://calendly.com/m-aliben432/clinicflow-15-min-intro';

export function clinicSlug(name = '') {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'unknown';
}

export function trackUrl(dest, clinic, type) {
  const slug = clinicSlug(clinic);
  return `${BASE}/c?to=${encodeURIComponent(dest)}&clinic=${encodeURIComponent(slug)}&type=${type}`;
}

export const TRACKED = {
  live:     (clinic) => trackUrl(`${BASE}/live`, clinic, 'live'),
  demo:     (clinic) => trackUrl(`${BASE}/demo`, clinic, 'demo'),
  calendly: (clinic) => trackUrl(CALENDLY, clinic, 'calendly'),
  pricing:  (clinic) => trackUrl(`${BASE}/pricing`, clinic, 'pricing'),
  proposal: (clinic) => trackUrl(
    `${BASE}/proposal?clinic=${encodeURIComponent(clinicSlug(clinic))}`,
    clinic,
    'proposal'
  ),
};
