exports.handler = async (event) => {
  try {
    const params = new URLSearchParams(event.body || '');
    const from = params.get('From') || 'unknown';
    const callSid = params.get('CallSid') || '';

    // Log the inbound call
    console.log(JSON.stringify({
      event: 'call_inbound',
      from,
      callSid,
      receivedAt: new Date().toISOString(),
    }));

    // Send SMS alert to Mohamed
    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken  = process.env.TWILIO_AUTH_TOKEN;
    const fromNumber = process.env.TWILIO_FROM_NUMBER;
    const notifyPhone = process.env.NOTIFY_PHONE || '+15149617077';

    const alertBody = new URLSearchParams({
      From: fromNumber,
      To: notifyPhone,
      Body: `📞 INBOUND CALL from ${from} — they will leave a voicemail`,
    }).toString();

    await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Authorization: 'Basic ' + Buffer.from(`${accountSid}:${authToken}`).toString('base64'),
        },
        body: alertBody,
      }
    );

    // Return TwiML — play ElevenLabs Eric greeting, then record voicemail
    const greetingUrl      = 'https://clinicflowautomation.com/audio/clinicflow-inbound-greeting.mp3';
    const recordingWebhook = 'https://clinicflowautomation.com/.netlify/functions/call-recording';

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'text/xml' },
      body: `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Play>${greetingUrl}</Play>
  <Record maxLength="60" transcribe="true" transcribeCallback="${recordingWebhook}" action="${recordingWebhook}" playBeep="true"/>
</Response>`,
    };
  } catch (err) {
    console.error('call-inbound error:', err.message);
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'text/xml' },
      body: `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say>Thank you for calling ClinicFlow Automation. Please call back shortly.</Say>
</Response>`,
    };
  }
};
