// netlify/functions/click.js
// GET /c?to=URL&clinic=SLUG&type=live|demo|calendly|proposal
// Logs the click, fires SMS for high-value clicks, redirects.

const { getStore } = require('@netlify/blobs');

exports.handler = async (event) => {
  const params = event.queryStringParameters || {};
  const to     = params.to ? decodeURIComponent(params.to) : null;
  const clinic = params.clinic || 'unknown';
  const type   = params.type || 'link';

  if (!to) {
    return { statusCode: 302, headers: { Location: 'https://clinicflowautomation.com' } };
  }

  // Log click asynchronously — don't block redirect
  const logClick = async () => {
    const entry = {
      clinic,
      type,
      to,
      clickedAt: new Date().toISOString(),
      ip: event.headers['x-forwarded-for']?.split(',')[0]?.trim() || '',
    };

    try {
      const store = getStore({ name: 'clicks' });
      const today = entry.clickedAt.slice(0, 10);
      const key   = `clicks-${today}`;
      let clicks  = [];
      try { const ex = await store.get(key, { type: 'json' }); if (Array.isArray(ex)) clicks = ex; } catch {}
      clicks.push(entry);
      await store.setJSON(key, clicks);
    } catch (e) {
      console.log('click log:', JSON.stringify(entry), e.message);
    }

    // SMS alert for Calendly and Proposal clicks
    if (type === 'calendly' || type === 'proposal') {
      const sid   = process.env.TWILIO_ACCOUNT_SID;
      const token = process.env.TWILIO_AUTH_TOKEN;
      const from  = process.env.TWILIO_FROM_NUMBER;
      const to_   = process.env.NOTIFY_PHONE || '+15149617077';
      const body  = type === 'calendly'
        ? `📅 CALENDLY CLICKED!\nClinic: ${clinic}\nCheck Calendly NOW — they may book.`
        : `📋 PROPOSAL CLICKED!\nClinic: ${clinic}\nThey're reading the proposal.`;

      const payload = new URLSearchParams({ From: from, To: to_, Body: body }).toString();
      await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Authorization: 'Basic ' + Buffer.from(`${sid}:${token}`).toString('base64'),
        },
        body: payload,
      }).catch(e => console.error('SMS failed:', e.message));
    }
  };

  logClick().catch(e => console.error('logClick failed:', e.message));

  return {
    statusCode: 302,
    headers: { Location: to, 'Cache-Control': 'no-store' },
  };
};
