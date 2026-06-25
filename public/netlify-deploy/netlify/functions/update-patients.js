// netlify/functions/update-patients.js
// Receives a patient CSV upload from the portal, validates it,
// stores it in Netlify Blobs, and alerts Mohamed via SMS.
//
// POST /.netlify/functions/update-patients
// Body: { clinicSlug, key, csvBase64, filename }

const ACCOUNT_SID  = process.env.TWILIO_ACCOUNT_SID;
const AUTH_TOKEN   = process.env.TWILIO_AUTH_TOKEN;
const FROM_NUMBER  = process.env.TWILIO_FROM_NUMBER;
const NOTIFY_PHONE = process.env.NOTIFY_PHONE || '+15149617077';

const REQUIRED_COLUMNS = ['name', 'phone'];
const USEFUL_COLUMNS   = ['email', 'next_appointment', 'last_visit'];

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

function parseCSV(text) {
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  if (lines.length < 2) return { headers: [], rows: [] };
  const headers = lines[0].split(',').map(h => h.trim().toLowerCase().replace(/\s+/g, '_'));
  const rows    = lines.slice(1).map(line => {
    const vals = line.split(',');
    const obj  = {};
    headers.forEach((h, i) => { obj[h] = (vals[i] || '').trim(); });
    return obj;
  });
  return { headers, rows };
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  let data;
  try { data = JSON.parse(event.body || '{}'); } catch {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON' }) };
  }

  const { clinicSlug, key, csvBase64 } = data;
  if (!clinicSlug || !csvBase64) {
    return { statusCode: 400, body: JSON.stringify({ error: 'clinicSlug and csvBase64 required' }) };
  }

  // Validate the CSV
  let csvText;
  try {
    csvText = Buffer.from(csvBase64, 'base64').toString('utf-8');
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid base64 CSV data' }) };
  }

  const { headers, rows } = parseCSV(csvText);
  const missingRequired   = REQUIRED_COLUMNS.filter(c => !headers.includes(c));
  if (missingRequired.length > 0) {
    return {
      statusCode: 400,
      body: JSON.stringify({
        error: `CSV is missing required columns: ${missingRequired.join(', ')}`,
        found: headers,
        required: REQUIRED_COLUMNS,
      }),
    };
  }

  const validRows   = rows.filter(r => r.name && r.phone);
  const patientCount = validRows.length;

  // Store in Netlify Blobs
  let blobStored = false;
  try {
    const { getStore } = require('@netlify/blobs');
    const store = getStore({
      name:   'patient-csvs',
      siteID: process.env.NETLIFY_SITE_ID,
      token:  process.env.NETLIFY_ACCESS_TOKEN || process.env.NETLIFY_AUTH_TOKEN,
    });
    await store.set(`patients-${clinicSlug}`, csvText, { type: 'text/csv' });
    blobStored = true;
    console.log(JSON.stringify({ event: 'csv_uploaded', clinicSlug, patientCount }));
  } catch (blobErr) {
    // Log the CSV so it can be recovered from Netlify function logs
    console.log(`CSV_UPLOAD — ${clinicSlug} — ${patientCount} patients:`);
    console.log(csvText.slice(0, 2000));
    console.warn('Netlify Blobs unavailable:', blobErr.message);
  }

  // Alert Mohamed via SMS
  const foundUseful = USEFUL_COLUMNS.filter(c => headers.includes(c));
  const alertBody   = `Patient list updated for ${clinicSlug}: ${patientCount} patients loaded. Columns: ${headers.join(', ')}.${blobStored ? ' Stored in Blobs.' : ' Check function logs.'}`;
  try { await sendTwilioSMS(NOTIFY_PHONE, alertBody); } catch {}

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    body: JSON.stringify({
      ok: true,
      patientCount,
      columnsFound: headers,
      usefulColumnsFound: foundUseful,
      blobStored,
      message: `Successfully loaded ${patientCount} patients.`,
    }),
  };
};
