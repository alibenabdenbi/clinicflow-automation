// netlify/functions/conversion-priority.js
// GET /api/conversion-priority — serves the ranked prospect list for signals dashboard.
// Data written by: node src/cli/buildConversionPriority.js (or run-on-demand scoring).
// Stored in Netlify Blobs under key 'conversion-priority' so it persists across deploys.

const { getStore } = require('@netlify/blobs');

exports.handler = async () => {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'no-store',
  };

  try {
    const store = getStore({ name: 'conversion-priority' });
    const data  = await store.get('top20', { type: 'json' });
    if (!data || !Array.isArray(data)) {
      return { statusCode: 200, headers, body: JSON.stringify({ ok: true, prospects: [] }) };
    }
    return { statusCode: 200, headers, body: JSON.stringify({ ok: true, prospects: data }) };
  } catch (err) {
    console.error('conversion-priority error:', err.message);
    return { statusCode: 200, headers, body: JSON.stringify({ ok: false, prospects: [] }) };
  }
};
