// netlify/functions/clicks.js
// GET /api/clicks — returns today's click data for signals dashboard

const { getStore } = require('@netlify/blobs');

exports.handler = async (event) => {
  try {
    const store = getStore({ name: 'clicks' });
    const today = new Date().toISOString().slice(0, 10);
    let clicks = [];
    try {
      const ex = await store.get(`clicks-${today}`, { type: 'json' });
      if (Array.isArray(ex)) clicks = ex;
    } catch {}

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({
        ok: true,
        date: today,
        clicks: clicks.sort((a, b) => new Date(b.clickedAt) - new Date(a.clickedAt)),
        total: clicks.length,
        calendlyClicks: clicks.filter(c => c.type === 'calendly').length,
        liveClicks:     clicks.filter(c => c.type === 'live').length,
        demoClicks:     clicks.filter(c => c.type === 'demo').length,
      }),
    };
  } catch (e) {
    return { statusCode: 200, body: JSON.stringify({ ok: false, error: e.message }) };
  }
};
