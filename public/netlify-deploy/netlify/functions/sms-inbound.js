const https = require('https');

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: { 'Access-Control-Allow-Origin': '*' }, body: '' };
  }

  try {
    // Parse Twilio's URL-encoded POST body
    const params = new URLSearchParams(event.body);
    const from = params.get('From') || 'unknown';
    const body = params.get('Body') || '';
    const to = params.get('To') || '';

    // Send SMS alert to Mohamed via Twilio
    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken = process.env.TWILIO_AUTH_TOKEN;
    const fromNumber = process.env.TWILIO_FROM_NUMBER;
    const notifyPhone = process.env.NOTIFY_PHONE || '+15149617077';

    const alertMessage = `📱 SMS REPLY from ${from}: "${body.slice(0, 100)}"`;

    // Send alert SMS
    const twilioBody = new URLSearchParams({
      From: fromNumber,
      To: notifyPhone,
      Body: alertMessage,
    }).toString();

    await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Authorization: 'Basic ' + Buffer.from(`${accountSid}:${authToken}`).toString('base64'),
        },
        body: twilioBody,
      }
    );

    // Send auto-reply to clinic
    const replyBody = new URLSearchParams({
      From: fromNumber,
      To: from,
      Body: "Hi! Thanks for reaching out to ClinicFlow Automation. Mohamed will follow up with you shortly. You can also reach us at contact@clinicflowautomation.com",
    }).toString();

    await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Authorization: 'Basic ' + Buffer.from(`${accountSid}:${authToken}`).toString('base64'),
        },
        body: replyBody,
      }
    );

    // Log to Netlify function console
    console.log(JSON.stringify({
      event: 'sms_inbound',
      from,
      body,
      to,
      receivedAt: new Date().toISOString(),
    }));

    // Return empty TwiML so Twilio doesn't complain
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'text/xml' },
      body: '<Response></Response>',
    };
  } catch (err) {
    console.error('sms-inbound error:', err.message);
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'text/xml' },
      body: '<Response></Response>',
    };
  }
};
