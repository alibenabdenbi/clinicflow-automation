const DEMO_CLINIC = {
  name: 'Demo Dental Clinic',
  city: 'Montreal',
  hours: 'Monday-Friday 8am-5pm, Saturday 9am-2pm',
  services: 'general dentistry, cleanings, whitening, emergency care',
};

const SYSTEM_PROMPT = `You are the automated patient communication system for Demo Dental Clinic in Montreal.

A patient called and no one picked up. The system auto-texted them within 60 seconds. Now they are replying via SMS.

Your job:
- Respond naturally as if you are the clinic's front-desk AI
- Help them book an appointment or answer questions
- Keep responses under 160 characters when possible (SMS length)
- Be warm, professional, brief

Clinic info:
- Hours: Monday-Friday 8am-5pm, Saturday 9am-2pm
- Services: general dentistry, cleanings, whitening, emergency care
- Booking: reply here or call 438-544-0442`;

const PITCH = `[DEMO] This is ClinicFlow Automation — the system that just helped you. Want this for your clinic? Visit clinicflowautomation.com/pricing or text CLINIC — Mohamed`;

// In-process conversation store (resets on cold start — fine for demo)
const conversations = {};

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: { 'Access-Control-Allow-Origin': '*' }, body: '' };
  }

  try {
    const params = new URLSearchParams(event.body);
    const from = params.get('From') || 'unknown';
    const message = (params.get('Body') || '').trim();

    // CLINIC keyword — skip demo, go straight to intake
    if (message.toUpperCase() === 'CLINIC') {
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'text/xml' },
        body: `<?xml version="1.0" encoding="UTF-8"?><Response><Message>Perfect! Book a 15-min call with Mohamed: https://calendly.com/m-aliben432/clinicflow-15-min-intro — or call directly: 438-544-0442. Takes 15 minutes to see if it fits. — Mohamed</Message></Response>`,
      };
    }

    console.log(JSON.stringify({ event: 'demo_sms', from, message, ts: new Date().toISOString() }));

    if (!conversations[from]) {
      conversations[from] = { messages: [], turnCount: 0 };
    }

    const conv = conversations[from];
    conv.turnCount++;
    conv.messages.push({ role: 'user', content: message || 'Hello' });

    let responseText;

    if (conv.turnCount === 1) {
      // First turn — the "missed call" auto-text experience
      responseText = `Hi! You called Demo Dental Clinic and we missed you. How can we help? We can book an appointment or answer any questions 🦷`;
    } else {
      const Anthropic = require('@anthropic-ai/sdk');
      const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

      const systemPrompt = conv.turnCount >= 3
        ? SYSTEM_PROMPT + `\n\nIMPORTANT: After answering, append this exact pitch on a new line:\n${PITCH}`
        : SYSTEM_PROMPT;

      const response = await anthropic.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 200,
        system: systemPrompt,
        messages: conv.messages,
      });

      responseText = response.content[0].text;
    }

    conv.messages.push({ role: 'assistant', content: responseText });

    const safe = responseText
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'text/xml' },
      body: `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${safe}</Message></Response>`,
    };
  } catch (err) {
    console.error('demo-sms error:', err.message);
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'text/xml' },
      body: `<?xml version="1.0" encoding="UTF-8"?><Response><Message>Thanks for texting! Our team will follow up shortly. — Demo Dental</Message></Response>`,
    };
  }
};
