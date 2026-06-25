// netlify/functions/track.js
// POST /api/track — logs page views with utm params
// Stored in Netlify Blobs, readable via /api/analytics
// High-intent pages (/calculator, /report-card, /report) also stored in intent-visits

const { getStore } = require('@netlify/blobs');
const https = require('https');

const HIGH_INTENT_PAGES = ['/calculator', '/report-card', '/report'];

function geoLookup(ip) {
  return new Promise((resolve) => {
    if (!ip || ip === '127.0.0.1' || ip.startsWith('::')) return resolve({});
    const req = https.get(`https://ipapi.co/${ip}/json/`, { timeout: 3000 }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch { resolve({}); } });
    });
    req.on('error', () => resolve({}));
    req.on('timeout', () => { req.destroy(); resolve({}); });
  });
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    let body;
    try { body = JSON.parse(event.body || '{}'); } catch { body = {}; }

    const entry = {
      page:         body.page || '/',
      ref:          body.ref || '',
      utm_source:   body.utm_source || '',
      utm_campaign: body.utm_campaign || '',
      ts:           body.ts || Date.now(),
      ip:           event.headers['x-forwarded-for']?.split(',')[0]?.trim() || '',
      ua:           event.headers['user-agent'] || '',
      day:          new Date().toISOString().slice(0, 10),
    };

    // High-intent pages: geolocate + store in intent-visits blob
    const isHighIntent = HIGH_INTENT_PAGES.some(p => entry.page === p || entry.page.startsWith(p + '?'));
    if (isHighIntent && entry.ip) {
      try {
        const geo = await geoLookup(entry.ip);
        const intentEntry = {
          page:    entry.page,
          city:    geo.city || null,
          region:  geo.region || null,
          country: geo.country_name || geo.country || null,
          ip:      entry.ip,
          ts:      entry.ts,
          day:     entry.day,
          ua:      entry.ua,
        };
        const intentStore = getStore({ name: 'intent-visits' });
        const key = `${entry.day}/${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        await intentStore.setJSON(key, intentEntry);
      } catch (e) {
        console.error('intent-visits store error:', e.message);
      }
    }

    // SMS alert when a /for/ personalized page is visited
    if (entry.page && entry.page.startsWith('/for/')) {
      try {
        const twilio = require('twilio');
        const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
        const slug = entry.page.replace('/for/', '');
        const clinicName = slug.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
        await client.messages.create({
          body: '🎯 PERSONAL PAGE VISITED!\nClinic: ' + clinicName + '\nThey read their custom page.\nCall them NOW: clinicflowautomation.com/call-assistant',
          from: process.env.TWILIO_FROM_NUMBER,
          to: process.env.NOTIFY_PHONE || process.env.TWILIO_TO_NUMBER,
        });
      } catch (e) {
        console.error('SMS alert failed:', e.message);
      }
    }

    // Store in Blobs keyed by day + random suffix
    try {
      const store = getStore({ name: 'pageviews' });
      const key = `${entry.day}/${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      await store.setJSON(key, entry);
    } catch (e) {
      // Blobs not configured — log only
      console.log('pageview:', JSON.stringify(entry));
    }

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: '{"ok":true}',
    };
  } catch (err) {
    console.error('track error:', err.message);
    return { statusCode: 200, body: '{"ok":false}' };
  }
};
