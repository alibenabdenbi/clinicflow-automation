// netlify/functions/report-lead.js
// Handles lead capture from /report and /report-card pages.
// Sends SMS alert to Mohamed + personalized email to the lead.
// Fields: name, clinic, email, source ('report' | 'report-card'), grade?, city?

import https from 'https';
import querystring from 'querystring';

const TWILIO_SID   = process.env.TWILIO_ACCOUNT_SID  || '';
const TWILIO_TOKEN = process.env.TWILIO_AUTH_TOKEN    || '';
const TWILIO_FROM  = process.env.TWILIO_FROM_NUMBER   || '';
const NOTIFY_PHONE = process.env.NOTIFY_PHONE         || '+15149617077';
const SMTP_USER    = process.env.SMTP_USER            || '';
const SMTP_PASS    = process.env.SMTP_PASS            || '';
const SMTP_HOST    = process.env.SMTP_HOST            || 'smtp.zoho.com';
const SMTP_PORT    = Number(process.env.SMTP_PORT     || '587');

function twilioSms(body) {
  return new Promise((resolve) => {
    if (!TWILIO_SID || !TWILIO_TOKEN || !NOTIFY_PHONE) { resolve(false); return; }
    const auth     = Buffer.from(`${TWILIO_SID}:${TWILIO_TOKEN}`).toString('base64');
    const postData = querystring.stringify({ From: TWILIO_FROM, To: NOTIFY_PHONE, Body: body });
    const req = https.request({
      hostname: 'api.twilio.com',
      path:     `/2010-04-01/Accounts/${TWILIO_SID}/Messages.json`,
      method:   'POST',
      headers:  { 'Authorization': `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(postData) },
    }, (res) => { resolve(res.statusCode >= 200 && res.statusCode < 300); });
    req.on('error', () => resolve(false));
    req.write(postData);
    req.end();
  });
}

async function sendEmail({ to, subject, text }) {
  if (!SMTP_USER || !SMTP_PASS) return false;
  try {
    const { createTransport } = await import('nodemailer');
    const t = createTransport({ host: SMTP_HOST, port: SMTP_PORT, secure: false, auth: { user: SMTP_USER, pass: SMTP_PASS } });
    await t.sendMail({ from: `Mohamed <${SMTP_USER}>`, to, subject, text });
    return true;
  } catch { return false; }
}

export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type' }, body: '' };
  }
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method not allowed' };

  let data;
  try { data = JSON.parse(event.body || '{}'); } catch { return { statusCode: 400, body: 'Bad request' }; }

  const { name, clinic, email, source, grade, city } = data;
  if (!email || !email.includes('@')) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid email' }) };
  }

  const sourceName = source === 'report-card' ? 'Report Card' : 'Research Report';
  const clinicLine = clinic ? ` from ${clinic}` : '';
  const gradeLine  = grade  ? ` — Grade: ${grade}` : '';

  // SMS alert
  const smsBody = source === 'report-card'
    ? `📊 Report Card lead${clinicLine}: ${email}${gradeLine}${city ? ' · ' + city : ''}`
    : `📄 Report lead${clinicLine}: ${email}`;
  twilioSms(smsBody).catch(() => {});

  // Personalized email to lead
  let emailText;
  if (source === 'report-card') {
    emailText = `Hi ${name},

Here's your full clinic communication grade report${clinic ? ' for ' + clinic : ''}.

Your grade: ${grade || 'pending'}${city ? '\nCity: ' + city : ''}

What your grade means:
${grade === 'A' ? 'Your communication is strong. You\'re ahead of most clinics in your city.' :
  grade === 'B' ? 'Your communication is above average, with a few areas to improve.' :
  grade === 'C' ? 'Your clinic has meaningful communication gaps that are likely affecting your ratings and new patient acquisition.' :
  'Your clinic has significant communication gaps. Patients who can\'t reach you are booking with competitors.'}

The most effective fix:
Automatic SMS follow-up within 60 seconds of every missed call. Clinics that implement this recover 4–8 patients per month who would otherwise book elsewhere.

See how it works:
https://clinicflowautomation.com/demo

Calculate your exact revenue loss:
https://clinicflowautomation.com/calculator

Book 15 minutes with me:
https://calendly.com/m-aliben432/clinicflow-15-min-intro

— Mohamed
ClinicFlow Automation
438-544-0442

To opt out, reply with 'unsubscribe'.
ClinicFlow Automation · Montreal, QC · Canada`;
  } else {
    emailText = `Hi ${name},

Here's the province-specific data you requested from our 2026 Canadian Clinic Communication Report.

Our full dataset covers 4,314 clinics across 45 Canadian cities — including Ontario, British Columbia, Quebec, and Alberta markets.

Key findings for Canadian clinics:
• Clinics with communication complaints average 4.49 stars vs 4.75 stars for those without
• 70% of patients who reach voicemail don't leave a message — they call the next clinic
• A dental clinic missing 5 calls/day loses ~$27,500/month in potential revenue
• Automatic SMS follow-up within 60 seconds recovers 60% of missed callers

The full report (with city-by-city breakdown):
https://clinicflowautomation.com/report

Calculate your clinic's specific revenue loss:
https://clinicflowautomation.com/calculator

Start a free 30-day pilot:
https://clinicflowautomation.com/intake

Book 15 minutes with me directly:
https://calendly.com/m-aliben432/clinicflow-15-min-intro

— Mohamed
ClinicFlow Automation
438-544-0442

To opt out, reply with 'unsubscribe'.
ClinicFlow Automation · Montreal, QC · Canada`;
  }

  const emailSubject = source === 'report-card'
    ? `Your clinic communication grade report — ClinicFlow`
    : `Province data from the 2026 Canadian Clinic Report — ClinicFlow`;

  sendEmail({ to: email, subject: emailSubject, text: emailText }).catch(() => {});
  sendEmail({ to: SMTP_USER, subject: `New ${sourceName} lead: ${email}${clinicLine}`, text: smsBody }).catch(() => {});

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    body: JSON.stringify({ ok: true }),
  };
};
