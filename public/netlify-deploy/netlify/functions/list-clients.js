// netlify/functions/list-clients.js
// Returns all clinic brains from the clinic-brains Netlify Blobs store.
// GET /.netlify/functions/list-clients

exports.handler = async (event) => {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'no-store',
  };

  try {
    const { getStore } = require('@netlify/blobs');
    const store = getStore({
      name:   'clinic-brains',
      siteID: process.env.NETLIFY_SITE_ID,
      token:  process.env.NETLIFY_ACCESS_TOKEN || process.env.NETLIFY_AUTH_TOKEN,
    });

    // List all keys in the store
    const { blobs } = await store.list();

    const clients = [];
    for (const blob of blobs) {
      try {
        const brain = await store.get(blob.key, { type: 'json' });
        if (brain) clients.push(brain);
      } catch {}
    }

    // Sort: most recent first
    clients.sort((a, b) => {
      const ta = a.submittedAt || a.lastUpdated || '';
      const tb = b.submittedAt || b.lastUpdated || '';
      return tb.localeCompare(ta);
    });

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ ok: true, count: clients.length, clients }),
    };

  } catch (err) {
    console.error('list-clients error:', err.message);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ ok: false, error: err.message, clients: [] }),
    };
  }
};
