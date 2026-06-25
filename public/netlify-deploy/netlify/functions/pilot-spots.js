const { getStore } = require('@netlify/blobs');

exports.handler = async (event) => {
  const store = getStore({
    name: 'pilot-spots',
    siteID: process.env.NETLIFY_SITE_ID,
    token: process.env.NETLIFY_TOKEN,
  });

  const method = event.httpMethod;
  // New key each month — automatic reset without cron needed
  const monthKey = 'spots-' + new Date().toISOString().slice(0, 7);

  try {
    if (method === 'GET') {
      let data = { spots: 3, month: monthKey };
      try {
        const existing = await store.get(monthKey, { type: 'json' });
        if (existing) data = existing;
      } catch (e) {}
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify({ ok: true, spots: data.spots, month: data.month }),
      };
    }

    if (method === 'POST') {
      let data = { spots: 3, month: monthKey };
      try {
        const existing = await store.get(monthKey, { type: 'json' });
        if (existing) data = existing;
      } catch (e) {}

      if (data.spots <= 0) {
        return {
          statusCode: 200,
          headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
          body: JSON.stringify({ ok: false, spots: 0, message: 'No spots remaining' }),
        };
      }

      data.spots = Math.max(0, data.spots - 1);
      await store.set(monthKey, JSON.stringify(data));

      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify({ ok: true, spots: data.spots, claimed: true }),
      };
    }

    return { statusCode: 405, body: 'Method Not Allowed' };
  } catch (e) {
    // Fail open — never block a conversion over a counter error
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ ok: true, spots: 2 }),
    };
  }
};
