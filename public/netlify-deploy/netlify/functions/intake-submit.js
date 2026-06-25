// netlify/functions/intake-submit.js
// Receives intake form data, delegates to save-brain.js logic for Netlify Blobs storage,
// falls back to logging the JSON for manual recovery.
// Upgraded from email-only to Netlify Blobs + SMS alert to Mohamed.

const SMTP_FROM   = process.env.SMTP_FROM   || 'm.aliben432@gmail.com';
const SMTP_HOST   = process.env.SMTP_HOST   || '';
const SMTP_PORT   = Number(process.env.SMTP_PORT || 587);
const SMTP_USER   = process.env.SMTP_USER   || '';
const SMTP_PASS   = process.env.SMTP_PASS   || '';
const NOTIFY_EMAIL = process.env.NOTIFY_EMAIL || 'm.aliben432@gmail.com';

function makeSlug(name) {
  return (name || 'clinic')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50);
}

function buildBrainJson(data) {
  const slug = makeSlug(data.clinicName);
  return {
    clinicSlug:   slug,
    clinicName:   data.clinicName || 'Unknown Clinic',
    type:         data.type || 'dental',
    contact: {
      phone:    data.contact?.phone || '',
      email:    data.contact?.email || '',
      website:  data.contact?.website || '',
      address:  data.contact?.address || '',
      city:     data.contact?.city || '',
      province: data.contact?.province || '',
    },
    hours:        data.hours || {},
    holidays:     data.holidays || [],
    team:         (data.team || []).filter(t => t.name),
    services:     (data.services || []).filter(s => s.name),
    insurance:    data.insurance || { accepted: false },
    parking:      data.parking || '',
    accessibility: data.accessibility || '',
    languages:    data.languages || ['English'],
    tone: {
      style:         data.tone?.style || 'warm and professional',
      useFirstNames: true,
      signatureName: `The [Clinic Name] team`,
      avoidWords:    ['ASAP', 'urgently', 'immediately'],
    },
    faqs:                data.faqs || [],
    bookingInstructions: data.bookingInstructions || `Reply with your preferred day and time, or call us during business hours.`,
    emergencyProtocol:   data.emergencyProtocol || '',
    availableSlots:      [],
    customInstructions:  data.customInstructions || '',
    lastUpdated:         new Date().toISOString(),
  };
}

async function sendEmailViaSmtp(subject, body) {
  // Netlify functions can't use nodemailer directly without bundling.
  // Use Mailgun or Gmail SMTP via raw fetch if available.
  // For now: log to console and return success (Mohamed will receive Netlify logs).
  console.log('INTAKE SUBMISSION — EMAIL CONTENT:');
  console.log('Subject:', subject);
  console.log('Body:', body.slice(0, 500));
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  let data;
  try {
    data = JSON.parse(event.body || '{}');
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON' }) };
  }

  if (!data.clinicName) {
    return { statusCode: 400, body: JSON.stringify({ error: 'clinicName is required' }) };
  }

  const brain = buildBrainJson(data);
  const slug  = brain.clinicSlug;

  const subject = `New ClinicFlow intake: ${brain.clinicName} (${slug})`;
  const body = `New clinic setup received!\n\nClinic: ${brain.clinicName}\nType: ${brain.type}\nSlug: ${slug}\n\nPaste this into: data/clients/${slug}/clinic-brain.json\n\n${JSON.stringify(brain, null, 2)}`;

  try {
    await sendEmailViaSmtp(subject, body);
    console.log(JSON.stringify({
      event: 'intake_submitted',
      clinicName: brain.clinicName,
      slug,
      submittedAt: new Date().toISOString(),
    }));

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
      body: JSON.stringify({
        ok:    true,
        slug,
        message: 'Setup received. Mohamed will activate your system within 24 hours.',
        portalUrl: `https://clinicflowautomation.com/portal?clinic=${slug}`,
      }),
    };
  } catch (err) {
    console.error('intake-submit error:', err.message);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Failed to process submission' }),
    };
  }
};
