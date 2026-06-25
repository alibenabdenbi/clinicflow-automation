// netlify/functions/open.js
// Serves a 1x1 tracking pixel and stores every open in Netlify Blobs.
// Deployed at: clinicflowautomation.com/.netlify/functions/open

const PIXEL = Buffer.from(
  'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
  'base64'
);

const PIXEL_RESPONSE = {
  statusCode: 200,
  headers: {
    'Content-Type': 'image/gif',
    'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
    'Pragma': 'no-cache',
  },
  body: PIXEL.toString('base64'),
  isBase64Encoded: true,
};

const BOT_UA_RE = /Googlebot|Bingbot|Slurp|DuckDuck|Baidu|preview|PreviewAgent|MailChimp|SendGrid|ZoomInfo/i;
const BOT_IPS   = ['66.249.', '74.125.', '209.85.', '4.204.72.', '4.204.73.'];

function classify(ip, ua) {
  const uaBot = BOT_UA_RE.test(ua);
  const ipBot = BOT_IPS.some(p => (ip || '').startsWith(p));
  const isBot = uaBot || ipBot;
  const isMobile = !isBot && ((ua || '').includes('iPhone') || (ua || '').includes('Android'));
  let confidence = 'BOT';
  if (!isBot) confidence = isMobile ? 'MOBILE_HUMAN' : 'DESKTOP_HUMAN';
  return { isBot, isMobile, confidence };
}

exports.handler = async (event) => {
  const ua     = event.headers['user-agent'] || '';
  const ip     = (event.headers['x-forwarded-for'] || event.headers['client-ip'] || '').split(',')[0].trim();
  const clinic = event.queryStringParameters?.c || 'unknown';
  const variant = event.queryStringParameters?.v || 'unknown';

  const { isBot, isMobile, confidence } = classify(ip, ua);

  const openEvent = {
    clinic,
    variant,
    ip: ip.slice(0, 45),
    ua: ua.slice(0, 120),
    isBot,
    isMobile,
    confidence,
    openedAt: new Date().toISOString(),
    date: new Date().toISOString().slice(0, 10),
  };

  // Always log for Netlify function logs
  console.log(JSON.stringify({ event: 'email_open', ...openEvent }));

  // Store in Netlify Blobs
  try {
    const { getStore } = await import('@netlify/blobs');
    const store = getStore({
        name: 'email-opens',
        siteID: process.env.NETLIFY_SITE_ID,
        token: process.env.NETLIFY_TOKEN,
      });
    const today = openEvent.date;

    // Append to today's open list
    const dayKey = `opens-${today}`;
    let todayOpens = [];
    try {
      const existing = await store.get(dayKey, { type: 'json' });
      if (Array.isArray(existing)) todayOpens = existing;
    } catch {}
    todayOpens.push(openEvent);
    await store.set(dayKey, JSON.stringify(todayOpens));

    // Update per-clinic aggregate
    const clinicKey = `clinic-${clinic}`;
    let clinicData = { slug: clinic, opens: [], openCount: 0, hasMobile: false, hasHuman: false, confidence: 'BOT', lastOpen: null };
    try {
      const existing = await store.get(clinicKey, { type: 'json' });
      if (existing && existing.opens) clinicData = existing;
    } catch {}

    clinicData.opens.push(openEvent);
    clinicData.openCount  = clinicData.opens.length;
    clinicData.lastOpen   = openEvent.openedAt;
    clinicData.hasMobile  = clinicData.opens.some(o => o.isMobile);
    clinicData.hasHuman   = clinicData.opens.some(o => !o.isBot);

    const mobileCount  = clinicData.opens.filter(o => o.isMobile).length;
    const humanCount   = clinicData.opens.filter(o => !o.isBot).length;
    if (clinicData.hasMobile && mobileCount >= 2)       clinicData.confidence = 'STRONG';
    else if (clinicData.hasMobile)                       clinicData.confidence = 'MEDIUM';
    else if (clinicData.hasHuman && humanCount >= 2)     clinicData.confidence = 'MEDIUM';
    else if (clinicData.hasHuman)                        clinicData.confidence = 'WEAK';
    else                                                  clinicData.confidence = 'BOT';

    await store.set(clinicKey, JSON.stringify(clinicData));

  } catch (blobErr) {
    // Blob write failure is non-fatal — pixel still returns
    console.error('Blob error:', blobErr.message);
  }

  return PIXEL_RESPONSE;
};
