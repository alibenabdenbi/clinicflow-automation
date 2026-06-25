// netlify/functions/call-recording.js
// Handles Twilio call recording + transcription webhooks.
// Upgraded to use voice intelligence: responds to WHAT the patient actually said.
//
// Twilio posts: From, CallSid, RecordingUrl, TranscriptionText (if configured)
// Route: POST /.netlify/functions/call-recording
//
// WHISPER UPGRADE: If TranscriptionText is empty, download RecordingUrl and
// send to OpenAI Whisper for higher-accuracy transcription before parsing.

const ACCOUNT_SID  = process.env.TWILIO_ACCOUNT_SID;
const AUTH_TOKEN   = process.env.TWILIO_AUTH_TOKEN;
const FROM_NUMBER  = process.env.TWILIO_FROM_NUMBER;
const NOTIFY_PHONE = process.env.NOTIFY_PHONE || '+15149617077';
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY || '';

// Per-clinic routing: map incoming Twilio number → clinic slug
// Add new clinics here as they onboard
const CLINIC_ROUTES = {
  '+14385440442': 'test-clinic',
  // '+15141234567': 'greenwoods-pediatric',
};

async function sendTwilioSMS(to, from, body) {
  const creds = Buffer.from(`${ACCOUNT_SID}:${AUTH_TOKEN}`).toString('base64');
  const res = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${ACCOUNT_SID}/Messages.json`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Basic ${creds}`,
      },
      body: new URLSearchParams({ From: from, To: to, Body: body }).toString(),
    }
  );
  return res.json();
}

async function parseTranscriptionWithClaude(transcriptionText) {
  if (!ANTHROPIC_KEY || !transcriptionText) return null;

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-opus-4-7',
      max_tokens: 300,
      messages: [{
        role: 'user',
        content: `Extract structured info from this voicemail transcript. Return JSON only.

Transcript: "${transcriptionText}"

Return: {"callerName": string|null, "intent": "book_appointment"|"reschedule"|"cancel"|"question"|"emergency"|"other", "urgency": "low"|"medium"|"high"|"emergency", "specificRequest": string (under 100 chars)}`,
      }],
    }),
  });

  if (!res.ok) return null;
  const data = await res.json();
  const text = data.content?.[0]?.text || '{}';
  try {
    return JSON.parse(text.match(/\{[\s\S]*\}/)?.[0] || '{}');
  } catch { return null; }
}

async function buildIntelligentResponse(transcriptionText, parsedInfo, clinicConfig) {
  if (!ANTHROPIC_KEY || !transcriptionText) return null;

  const name   = clinicConfig?.clinicName || 'the clinic';
  const phone  = clinicConfig?.clinicPhone || '';
  const caller = parsedInfo?.callerName ? `Hi ${parsedInfo.callerName}` : 'Hi';

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-opus-4-7',
      max_tokens: 200,
      system: `You are the patient SMS assistant for ${name}. Reply warmly and specifically to what the patient said in their voicemail. Keep response under 160 characters. End with " — ${name}".${phone ? ` Phone: ${phone}` : ''}`,
      messages: [{
        role: 'user',
        content: `The patient left this voicemail: "${transcriptionText}"\n\nThey want: ${parsedInfo?.specificRequest || 'unclear'}. Write a warm, specific SMS reply that addresses exactly what they said.`,
      }],
    }),
  });

  if (!res.ok) return null;
  const data = await res.json();
  return data.content?.[0]?.text?.trim() || null;
}

exports.handler = async (event) => {
  try {
    const params          = new URLSearchParams(event.body || '');
    const from            = params.get('From') || 'unknown';
    const to              = params.get('To') || FROM_NUMBER;    // which clinic number was called
    const recordingUrl    = params.get('RecordingUrl') || '';
    const transcriptionRaw = params.get('TranscriptionText') || '';
    const callSid         = params.get('CallSid') || '';

    // Identify which clinic was called
    const clinicSlug = CLINIC_ROUTES[to] || null;

    // Hardcoded clinic configs (kept here since Netlify can't read the filesystem)
    const CLINIC_CONFIGS = {
      'test-clinic': { clinicName: 'Test Dental Clinic', clinicPhone: '+15145618268', twilioFrom: FROM_NUMBER },
    };
    const clinicConfig = clinicSlug ? CLINIC_CONFIGS[clinicSlug] || null : null;

    console.log(JSON.stringify({
      event:         'call_recording',
      from,
      to,
      clinicSlug:    clinicSlug || 'unknown',
      callSid,
      hasTranscript: !!transcriptionRaw,
      recordingUrl:  recordingUrl?.slice(0, 60),
      receivedAt:    new Date().toISOString(),
    }));

    // Always alert Mohamed
    await sendTwilioSMS(
      NOTIFY_PHONE,
      FROM_NUMBER,
      `📞 VOICEMAIL — ${clinicConfig?.clinicName || to} from ${from}: "${(transcriptionRaw || '(no transcript)').slice(0, 100)}"`
    ).catch(() => {});

    // If we have a transcription and can identify the clinic → intelligent response
    if (transcriptionRaw && clinicSlug && from !== 'unknown') {
      const parsedInfo = await parseTranscriptionWithClaude(transcriptionRaw);
      const smsFrom    = clinicConfig?.twilioFrom || FROM_NUMBER;

      // Emergency — immediate direct response
      if (parsedInfo?.urgency === 'emergency') {
        const emergencyMsg = clinicConfig?.clinicPhone
          ? `This sounds urgent — please call us immediately at ${clinicConfig.clinicPhone}. We have emergency slots available. — ${clinicConfig.clinicName}`
          : `This sounds urgent. A team member will call you back within 30 minutes. — ${clinicConfig?.clinicName || 'the clinic'}`;
        await sendTwilioSMS(from, smsFrom, emergencyMsg).catch(() => {});
      } else {
        // Intelligent personalized response
        const intelligentReply = await buildIntelligentResponse(transcriptionRaw, parsedInfo, clinicConfig);
        if (intelligentReply) {
          await sendTwilioSMS(from, smsFrom, intelligentReply).catch(() => {});
          console.log(`[call-recording] Intelligent reply sent to ${from}: "${intelligentReply.slice(0, 80)}"`);
        }
      }
    } else if (!transcriptionRaw && clinicSlug && from !== 'unknown') {
      // No transcript — send standard missed call follow-up
      // WHISPER UPGRADE POINT: download recordingUrl and transcribe with Whisper here
      const clinicName = clinicConfig?.clinicName || 'the clinic';
      const clinicPhone = clinicConfig?.clinicPhone || '';
      const smsFrom    = clinicConfig?.twilioFrom || FROM_NUMBER;
      const fallbackMsg = `Hi! You called ${clinicName}. We missed your call — we'll follow up with you within 2 hours. Reply here to book or ask a question. — ${clinicName}`;
      await sendTwilioSMS(from, smsFrom, fallbackMsg).catch(() => {});
    }

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'text/xml' },
      body: '<Response></Response>',
    };
  } catch (err) {
    console.error('call-recording error:', err.message);
    return { statusCode: 200, body: '<Response></Response>' };
  }
};
