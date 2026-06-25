// netlify/functions/analytics.js
// GET /api/analytics — returns today's page view summary for signals dashboard

const { getStore } = require('@netlify/blobs');

exports.handler = async (event) => {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'no-store',
  };

  try {
    const store = getStore({ name: 'pageviews' });
    const today = new Date().toISOString().slice(0, 10);

    const { blobs } = await store.list({ prefix: today });
    const views = (await Promise.all(
      blobs.map(b => store.get(b.key, { type: 'json' }).catch(() => null))
    )).filter(Boolean);

    const pages = {};
    const sources = {};
    views.forEach(v => {
      const p = v.page || '/';
      pages[p] = (pages[p] || 0) + 1;
      const src = v.utm_source || (v.ref ? new URL(v.ref).hostname : '') || 'direct';
      sources[src] = (sources[src] || 0) + 1;
    });

    const totalViews = views.length;
    const topPage = Object.entries(pages).sort((a, b) => b[1] - a[1])[0]?.[0] || '/';

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ ok: true, totalViews, pages, sources, topPage }),
    };
  } catch (err) {
    console.error('analytics error:', err.message);
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ ok: false, error: err.message, totalViews: 0, pages: {}, sources: {} }),
    };
  }
};
