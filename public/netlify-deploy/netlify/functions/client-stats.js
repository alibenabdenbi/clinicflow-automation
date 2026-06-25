const fs   = require('fs');
const path = require('path');

exports.handler = async (event) => {
  const slug = event.queryStringParameters?.clinic;
  const key  = event.queryStringParameters?.key;

  if (!slug) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Missing clinic' }) };
  }

  try {
    const statsPath = path.join('/var/task/data/clients', slug, 'stats.json');
    if (!fs.existsSync(statsPath)) {
      return { statusCode: 200, body: JSON.stringify({ warming: true }) };
    }
    const stats = JSON.parse(fs.readFileSync(statsPath, 'utf8'));
    if (stats.portalPassword && stats.portalPassword !== key) {
      return { statusCode: 401, body: JSON.stringify({ error: 'Invalid password' }) };
    }
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
      body: JSON.stringify(stats),
    };
  } catch (e) {
    return { statusCode: 200, body: JSON.stringify({ warming: true }) };
  }
};
