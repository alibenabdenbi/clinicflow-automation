// netlify/functions/intent-visits.js
// GET /api/intent-visits — returns high-intent page visits from last 7 days
// Visitors who hit /calculator, /report-card, or /report are actively evaluating

const { getStore } = require('@netlify/blobs');

exports.handler = async (event) => {
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
  };

  try {
    const store = getStore({ name: 'intent-visits' });
    const visits = [];
    const today = new Date();

    for (let i = 0; i < 7; i++) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      const day = d.toISOString().slice(0, 10);
      try {
        const listed = await store.list({ prefix: `${day}/` });
        for (const entry of (listed.blobs || [])) {
          try {
            const data = await store.get(entry.key, { type: 'json' });
            if (data) visits.push(data);
          } catch {}
        }
      } catch {}
    }

    visits.sort((a, b) => (b.ts || 0) - (a.ts || 0));

    // Deduplicate by IP within same day to avoid double-counting refreshes
    const seen = new Set();
    const deduped = visits.filter(v => {
      const key = `${v.ip}:${v.page}:${v.day}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ ok: true, visits: deduped, total: deduped.length }),
    };
  } catch (err) {
    console.error('intent-visits error:', err.message);
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ ok: false, visits: [], total: 0, error: err.message }),
    };
  }
};
