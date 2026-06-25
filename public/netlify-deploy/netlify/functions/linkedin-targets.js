const fs = require('fs');
const path = require('path');

exports.handler = async () => {
  try {
    const rotation = JSON.parse(fs.readFileSync(
      path.join(process.cwd(), 'data/linkedin/prospect-rotation.json'), 'utf8'
    ));
    const idx = rotation.currentIndex || 0;
    const targets = rotation.prospects?.slice(idx, idx + 3) || [];
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ ok: true, targets }),
    };
  } catch(e) {
    return { statusCode: 200, body: JSON.stringify({ ok: false, targets: [] }) };
  }
};
