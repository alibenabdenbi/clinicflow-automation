exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type' },
      body: ''
    };
  }

  try {
    const { clinicName, yourName, email, city, phone, challenge } = JSON.parse(event.body);

    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken  = process.env.TWILIO_AUTH_TOKEN;
    const from       = process.env.TWILIO_FROM_NUMBER;
    const to         = '+15149617077';

    const credentials = Buffer.from(`${accountSid}:${authToken}`).toString('base64');

    const smsBody = [
      `🦷 PILOT APPLICATION`,
      `Name: ${yourName}`,
      `Clinic: ${clinicName} — ${city}`,
      `Challenge: ${challenge}`,
      `Email: ${email}`,
      `Phone: ${phone || 'not provided'}`,
    ].join('\n');

    await fetch(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${credentials}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ From: from, To: to, Body: smsBody }),
    });

    console.log(`Pilot application received: ${yourName} <${email}> — ${clinicName}, ${city}`);

    return {
      statusCode: 200,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ success: true, message: "We'll be in touch within 24 hours" }),
    };
  } catch (err) {
    console.error('pilot-apply error:', err.message);
    return {
      statusCode: 500,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ error: err.message }),
    };
  }
};
