// netlify/functions/referral-track.js
// Tracks referral link clicks and redirects to intake with ref code.
// GET /ref?code=CLINIC_SLUG

exports.handler = async (event) => {
  const referrerSlug = event.queryStringParameters?.code || '';
  const BASE = process.env.PUBLIC_BASE_URL || 'https://clinicflowautomation.com';

  if (!referrerSlug) {
    return { statusCode: 302, headers: { Location: BASE + '/intake' }, body: '' };
  }

  // Log click in Netlify Blobs
  try {
    const { getStore } = require('@netlify/blobs');
    const store = getStore({
      name:   'referrals',
      siteID: process.env.NETLIFY_SITE_ID,
      token:  process.env.NETLIFY_ACCESS_TOKEN || process.env.NETLIFY_AUTH_TOKEN,
    });
    const key = `ref-${referrerSlug}`;
    let refData = { clicks: 0, conversions: 0, slug: referrerSlug, firstClick: null, lastClick: null };
    try {
      const existing = await store.get(key, { type: 'json' });
      if (existing) refData = existing;
    } catch {}
    refData.clicks++;
    refData.lastClick = new Date().toISOString();
    if (!refData.firstClick) refData.firstClick = refData.lastClick;
    await store.setJSON(key, refData);
    console.log(JSON.stringify({ event: 'referral_click', slug: referrerSlug, clicks: refData.clicks }));
  } catch(e) {
    console.error('Blob error:', e.message);
  }

  // Redirect to intake with ref code preserved
  const intakeUrl = `${BASE}/intake?ref=${encodeURIComponent(referrerSlug)}`;
  return { statusCode: 302, headers: { Location: intakeUrl }, body: '' };
};
