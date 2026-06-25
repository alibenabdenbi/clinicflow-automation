// netlify/functions/confirm-forwarding.js
// Called when a clinic clicks "I've set up call forwarding" on the welcome page.
// Marks forwardingConfirmed in Blobs and alerts Mohamed via SMS.
//
// POST /.netlify/functions/confirm-forwarding
// Body: { clinic, clinicName }

const ACCOUNT_SID  = process.env.TWILIO_ACCOUNT_SID;
const AUTH_TOKEN   = process.env.TWILIO_AUTH_TOKEN;
const FROM_NUMBER  = process.env.TWILIO_FROM_NUMBER;
const NOTIFY_PHONE = process.env.NOTIFY_PHONE || '+15149617077';

async function sendTwilioSMS(to, body) {
  if (!ACCOUNT_SID || !AUTH_TOKEN || !FROM_NUMBER) return;
  const creds = Buffer.from(`${ACCOUNT_SID}:${AUTH_TOKEN}`).toString('base64');
  await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${ACCOUNT_SID}/Messages.json`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Basic ${creds}`,
      },
      body: new URLSearchParams({ From: FROM_NUMBER, To: to, Body: body }).toString(),
    }
  );
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  let data = {};
  try { data = JSON.parse(event.body || '{}'); } catch {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON' }) };
  }

  const slug       = (data.clinic || '').trim().toLowerCase();
  const clinicName = (data.clinicName || slug).trim();

  if (!slug) {
    return { statusCode: 400, body: JSON.stringify({ error: 'clinic param required' }) };
  }

  // Update brain in Blobs
  try {
    const { getStore } = require('@netlify/blobs');
    const store = getStore({
      name:   'clinic-brains',
      siteID: process.env.NETLIFY_SITE_ID,
      token:  process.env.NETLIFY_ACCESS_TOKEN || process.env.NETLIFY_AUTH_TOKEN,
    });

    let brain = await store.get(slug, { type: 'json' });
    if (!brain) brain = { clinicSlug: slug, clinicName };

    brain.forwardingConfirmed   = true;
    brain.forwardingConfirmedAt = new Date().toISOString();
    brain.lastUpdated           = new Date().toISOString();

    await store.setJSON(slug, brain);
    console.log(JSON.stringify({ event: 'forwarding_confirmed', slug, clinicName }));
  } catch (blobErr) {
    console.warn('Blob update failed:', blobErr.message);
  }

  // Alert Mohamed via SMS
  try {
    const msg = `✓ ${clinicName} confirmed phone forwarding is set up. Ready for next step.`;
    await sendTwilioSMS(NOTIFY_PHONE, msg);
  } catch {}

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    body: JSON.stringify({ ok: true, message: 'Forwarding confirmation received.' }),
  };
};
