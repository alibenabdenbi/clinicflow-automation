// netlify/functions/get-brain.js
// Reads the clinic brain from Netlify Blobs.
// Used by conversationEngine (Netlify function context) and the approval flow.
//
// GET /.netlify/functions/get-brain?clinic=SLUG
// GET /.netlify/functions/get-brain?clinic=SLUG&action=approve  → marks approved, shows brain JSON

exports.handler = async (event) => {
  const slug   = (event.queryStringParameters?.clinic || '').trim().toLowerCase();
  const action = (event.queryStringParameters?.action || '').trim();

  if (!slug) {
    return { statusCode: 400, body: JSON.stringify({ error: 'clinic param required' }) };
  }

  let brain = null;

  try {
    const { getStore } = require('@netlify/blobs');
    const store = getStore({
      name:   'clinic-brains',
      siteID: process.env.NETLIFY_SITE_ID,
      token:  process.env.NETLIFY_ACCESS_TOKEN || process.env.NETLIFY_AUTH_TOKEN,
    });
    brain = await store.get(slug, { type: 'json' });
  } catch (err) {
    console.warn('Netlify Blobs read failed:', err.message);
    return { statusCode: 404, body: JSON.stringify({ error: 'Brain not found', slug }) };
  }

  if (!brain) {
    return { statusCode: 404, body: JSON.stringify({ error: 'Brain not found', slug }) };
  }

  // Approval action — mark approved, return full JSON for Mohamed to paste
  if (action === 'approve') {
    brain.status      = 'approved';
    brain.approvedAt  = new Date().toISOString();
    brain.lastUpdated = new Date().toISOString();

    try {
      const { getStore } = require('@netlify/blobs');
      const store = getStore({
        name:   'clinic-brains',
        siteID: process.env.NETLIFY_SITE_ID,
        token:  process.env.NETLIFY_ACCESS_TOKEN || process.env.NETLIFY_AUTH_TOKEN,
      });
      await store.setJSON(slug, brain);
    } catch {}

    // Return pretty HTML with the brain JSON to copy/paste to server
    const html = `<!DOCTYPE html><html><head><title>Brain Approved — ${brain.clinicName}</title>
<style>body{background:#0b0f17;color:#e8eefc;font-family:monospace;padding:32px;}
pre{background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.1);border-radius:8px;padding:20px;overflow:auto;}
h1{color:#39d98a;margin-bottom:8px;}p{color:#a7b0c5;margin-bottom:16px;}</style></head><body>
<h1>✓ ${brain.clinicName} brain approved</h1>
<p>Save this JSON to: <code>data/clients/${slug}/clinic-brain.json</code></p>
<button onclick="navigator.clipboard.writeText(document.getElementById('j').textContent)" style="background:#7c5cff;color:#fff;border:none;border-radius:6px;padding:8px 16px;cursor:pointer;margin-bottom:16px;">Copy JSON</button>
<pre id="j">${JSON.stringify(brain, null, 2)}</pre></body></html>`;

    return { statusCode: 200, headers: { 'Content-Type': 'text/html' }, body: html };
  }

  // Default: return the brain JSON
  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    body: JSON.stringify(brain),
  };
};
