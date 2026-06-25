// netlify/functions/save-brain.js
// Receives the clinic brain JSON from the intake form,
// stores it in Netlify Blobs, and alerts Mohamed via SMS.
//
// POST /.netlify/functions/save-brain
// Body: { clinicSlug, clinicName, ...brain fields }

const ACCOUNT_SID  = process.env.TWILIO_ACCOUNT_SID;
const AUTH_TOKEN   = process.env.TWILIO_AUTH_TOKEN;
const FROM_NUMBER  = process.env.TWILIO_FROM_NUMBER;
const NOTIFY_PHONE = process.env.NOTIFY_PHONE || '+15149617077';
const BASE_URL     = process.env.PUBLIC_BASE_URL || 'https://clinicflowautomation.com';

function makeSlug(name) {
  return (name || 'clinic')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50);
}

async function sendTwilioSMS(to, body) {
  if (!ACCOUNT_SID || !AUTH_TOKEN) return;
  const creds = Buffer.from(`${ACCOUNT_SID}:${AUTH_TOKEN}`).toString('base64');
  await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${ACCOUNT_SID}/Messages.json`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: `Basic ${creds}` },
      body: new URLSearchParams({ From: FROM_NUMBER, To: to, Body: body }).toString(),
    }
  );
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  let data;
  try { data = JSON.parse(event.body || '{}'); } catch {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON' }) };
  }

  if (!data.clinicName) {
    return { statusCode: 400, body: JSON.stringify({ error: 'clinicName required' }) };
  }

  const slug = data.clinicSlug || makeSlug(data.clinicName);
  const brain = {
    clinicSlug:   slug,
    clinicName:   data.clinicName,
    type:         data.type || 'dental',
    contact:      data.contact || {},
    hours:        data.hours || {},
    holidays:     data.holidays || [],
    team:         (data.team || []).filter(t => t.name),
    services:     (data.services || []).filter(s => s.name),
    insurance:    data.insurance || { accepted: false },
    parking:      data.parking || '',
    accessibility: data.accessibility || '',
    languages:    data.languages || ['English'],
    tone:         data.tone || { style: 'warm and professional' },
    faqs:         data.faqs || [],
    bookingInstructions: data.bookingInstructions || '',
    emergencyProtocol:   data.emergencyProtocol || '',
    availableSlots:      [],
    customInstructions:  data.customInstructions || '',
    status:       'pending_approval',
    submittedAt:  new Date().toISOString(),
    lastUpdated:  new Date().toISOString(),
  };

  // Store in Netlify Blobs
  try {
    const { getStore } = require('@netlify/blobs');
    const store = getStore({
      name: 'clinic-brains',
      siteID: process.env.NETLIFY_SITE_ID,
      token:  process.env.NETLIFY_ACCESS_TOKEN || process.env.NETLIFY_AUTH_TOKEN,
    });
    await store.setJSON(slug, brain);
    console.log(JSON.stringify({ event: 'brain_saved', slug, clinicName: brain.clinicName }));
  } catch (blobErr) {
    // Blobs unavailable — log the full JSON so Mohamed can recover from Netlify logs
    console.log('BRAIN_SUBMISSION — paste into data/clients/' + slug + '/clinic-brain.json:');
    console.log(JSON.stringify(brain, null, 2));
    console.warn('Netlify Blobs save failed:', blobErr.message);
  }

  // Alert Mohamed via SMS with approval link
  const approvalUrl = `${BASE_URL}/.netlify/functions/get-brain?clinic=${slug}&action=approve`;
  const alertBody   = `New clinic setup: ${brain.clinicName} (${slug}). Review: ${approvalUrl}`;
  try { await sendTwilioSMS(NOTIFY_PHONE, alertBody); } catch {}

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    body: JSON.stringify({
      ok:       true,
      slug,
      message:  'Setup received. Mohamed will activate your system within 24 hours.',
      portalUrl: `${BASE_URL}/portal?clinic=${slug}`,
    }),
  };
};
