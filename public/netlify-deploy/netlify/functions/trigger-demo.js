// netlify/functions/trigger-demo.js
// POST /api/trigger-demo — sends opening demo SMS to a prospect after a sales call.
// Called by the "📱 Demo SMS" button in call-assistant.html.
// When the prospect texts back, demo-sms.js handles the AI receptionist response.

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
  };

  try {
    let body;
    try { body = JSON.parse(event.body || '{}'); } catch { body = {}; }

    const { phone, clinic } = body;
    if (!phone) {
      return { statusCode: 400, headers, body: JSON.stringify({ ok: false, error: 'phone required' }) };
    }

    const twilio = require('twilio');
    const client = twilio(
      process.env.TWILIO_ACCOUNT_SID,
      process.env.TWILIO_AUTH_TOKEN
    );

    await client.messages.create({
      body: `Hi — you just spoke with Mohamed's team about ClinicFlow.\n\nText anything back to this number and experience exactly what your patients would feel when they call ${clinic || 'your clinic'} and no one picks up.\n\nTakes 60 seconds. — ClinicFlow Team`,
      from: process.env.TWILIO_FROM_NUMBER,
      to: phone,
    });

    return { statusCode: 200, headers, body: JSON.stringify({ ok: true }) };
  } catch (err) {
    console.error('trigger-demo error:', err.message);
    return { statusCode: 500, headers, body: JSON.stringify({ ok: false, error: err.message }) };
  }
};
