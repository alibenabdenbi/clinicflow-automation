exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type'
      },
      body: ''
    };
  }

  try {
    const { messages } = JSON.parse(event.body);

    console.log('API key present:', !!process.env.ANTHROPIC_API_KEY);
    console.log('Messages received:', JSON.stringify(messages));

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 300,
        system: `You are the ClinicFlow Automation assistant. You help Canadian clinic owners — dental clinics, physio clinics, hair salons, and any appointment-based business — understand how ClinicFlow works and whether it's right for them.

WHAT CLINICFLOW DOES:
Done-for-you patient/client communication automation. We handle:
- Missed call follow-up: automatic SMS within 60 seconds of any missed call
- Appointment reminders: SMS at 72h and 24h before each appointment
- Patient reactivation: outreach to patients inactive 12+ months
- Booking automation: patients can book appointments via SMS reply
- AI intelligence: system learns your clinic and responds like a real team member

PRICING:
- Starter: $397 one-time ($200 now, $197 after results) — missed call follow-up only
- Growth: $997 one-time ($500 now, $497 after results) — all three services (most popular)
- Premium: $2,497 one-time ($1,250 now, $1,247 after results) — full system + priority support
- Free tier available: missed call only, 50 SMS/month

KEY FACTS:
- No monthly fees ever
- Setup in 5 days
- Pay second half only after seeing results
- 30-day money-back guarantee
- Works with any practice management software (Jane App, Dentrix, Eaglesoft, etc.)
- CASL compliant
- Built specifically for Canadian clinics
- Mohamed (founder) does all setup personally

HOW TO RESPOND:
- Be warm and helpful
- Answer questions directly
- If they seem interested, guide them to /pilot for the free setup offer
- If they ask about pricing, give exact numbers
- Keep responses concise — this is a chat widget, not an essay
- Never make up features that aren't listed above`,
        messages: messages
      })
    });

    console.log('Anthropic response status:', response.status);
    const data = await response.json();
    console.log('Anthropic response:', JSON.stringify(data));

    if (!response.ok) {
      throw new Error(`Anthropic API error: ${data.error?.message || response.status}`);
    }

    return {
      statusCode: 200,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({
        response: data.content[0].text
      })
    };
  } catch (err) {
    console.log('Error details:', JSON.stringify({
      message: err.message,
      status: err.status,
      cause: err.cause
    }));
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message })
    };
  }
};
