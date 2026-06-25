// netlify/functions/proposal-accept.js
// Called when a clinic clicks "I'm in" on the proposal page.
// Sends immediate SMS to Mohamed.
//
// POST /.netlify/functions/proposal-accept

const ACCOUNT_SID  = process.env.TWILIO_ACCOUNT_SID;
const AUTH_TOKEN   = process.env.TWILIO_AUTH_TOKEN;
const FROM_NUMBER  = process.env.TWILIO_FROM_NUMBER;
const NOTIFY_PHONE = process.env.NOTIFY_PHONE || '+15149617077';
const BASE_URL     = process.env.PUBLIC_BASE_URL || 'https://clinicflowautomation.com';

async function sendSMS(to, body) {
  if (!ACCOUNT_SID || !AUTH_TOKEN || !FROM_NUMBER) return;
  const creds = Buffer.from(`${ACCOUNT_SID}:${AUTH_TOKEN}`).toString('base64');
  await fetch(`https://api.twilio.com/2010-04-01/Accounts/${ACCOUNT_SID}/Messages.json`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: `Basic ${creds}` },
    body: new URLSearchParams({ From: FROM_NUMBER, To: to, Body: body }).toString(),
  });
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  let data = {};
  try { data = JSON.parse(event.body || '{}'); } catch {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON' }) };
  }

  const { clinicName, clinicSlug, acceptedAt } = data;
  const welcomeUrl = `${BASE_URL}/welcome?clinic=${clinicSlug || ''}`;
  const time = acceptedAt ? new Date(acceptedAt).toLocaleString('en-CA', { timeZone: 'America/Toronto' }) : 'now';

  const smsBody = `🎉 PROPOSAL ACCEPTED!
Clinic: ${clinicName || 'Unknown'}
Time: ${time}
→ Call them NOW to collect payment
Setup: ${welcomeUrl}`;

  try {
    await sendSMS(NOTIFY_PHONE, smsBody);
    console.log(JSON.stringify({ event: 'proposal_accepted', clinicName, clinicSlug, acceptedAt }));
  } catch(e) {
    console.error('SMS failed:', e.message);
  }

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    body: JSON.stringify({ ok: true }),
  };
};
