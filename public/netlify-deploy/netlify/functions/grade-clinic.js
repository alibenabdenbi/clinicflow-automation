// netlify/functions/grade-clinic.js
// POST /api/grade-clinic — calls Claude API server-side to generate clinic report card
// Never exposes the API key to the browser

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

    const { clinicName, city } = body;
    if (!clinicName || !city) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'clinicName and city required' }) };
    }

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 600,
        system: `You are a patient communication analyst for Canadian dental clinics.
Generate a realistic clinic communication report card. Return ONLY valid JSON — no markdown.

{
  "grade": "A|B|C|D|F",
  "gradeLabel": "Excellent|Good|Fair|Poor|Critical",
  "rating": 4.7,
  "cityAvg": 4.6,
  "cityRank": "Top 15%",
  "ratingGap": "+0.1",
  "findings": [
    {"type": "good|bad", "text": "specific finding"},
    {"type": "good|bad", "text": "specific finding"},
    {"type": "bad", "text": "specific finding"}
  ],
  "gradeDesc": "One sentence summary of communication performance",
  "ctaHeadline": "Personalized headline based on grade",
  "ctaBody": "Personalized CTA body based on situation"
}

Rules: Most clinics grade B or C. Bad clinics: mention missed calls, voicemail issues, slow response. Good clinics: still mention room for improvement after hours. City averages: Toronto ~4.5, Montreal ~4.4, Vancouver ~4.6, Ottawa ~4.7, Calgary ~4.6.`,
        messages: [{ role: 'user', content: `Report card for: ${clinicName} in ${city}, Canada` }],
      }),
    });

    const data = await response.json();
    const text = data.content?.[0]?.text || '';
    const report = JSON.parse(text.replace(/```json|```/g, '').trim());

    return { statusCode: 200, headers, body: JSON.stringify(report) };
  } catch (err) {
    console.error('grade-clinic error:', err.message);
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        grade: 'C', gradeLabel: 'Fair',
        rating: 4.4, cityAvg: 4.5, cityRank: 'Middle 50%', ratingGap: '-0.1',
        findings: [
          { type: 'bad', text: 'Missed calls during peak hours likely go unanswered' },
          { type: 'bad', text: 'No automated follow-up when patients cannot reach the front desk' },
          { type: 'good', text: 'Strong rating suggests good clinical care' },
        ],
        gradeDesc: 'Good clinical care, but communication gaps are likely costing new patients.',
        ctaHeadline: 'Fix your communication grade in 5 days',
        ctaBody: 'ClinicFlow automatically texts every missed caller within 60 seconds. Free 30-day pilot available this week.',
      }),
    };
  }
};
