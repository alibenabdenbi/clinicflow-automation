// netlify/functions/ref-track.js
// GET /.netlify/functions/ref-track?clinic=SLUG
// Logs referral link clicks and redirects to /pilot.
// Also increments referral click counter (logged to function console for now).

exports.handler = async (event) => {
  const clinic = (event.queryStringParameters?.clinic || '').trim().toLowerCase();
  const ip = event.headers?.['x-forwarded-for'] || event.headers?.['client-ip'] || 'unknown';
  const ua = event.headers?.['user-agent'] || '';
  const ref = event.headers?.referer || '';

  // Log for analytics (visible in Netlify function logs)
  console.log(JSON.stringify({
    event:    'ref_click',
    clinic,
    ip:       ip.split(',')[0].trim().slice(0, 45),
    ua:       ua.slice(0, 80),
    ref:      ref.slice(0, 100),
    clickedAt: new Date().toISOString(),
  }));

  // Return redirect to /ref.html?clinic=SLUG so the page can show the badge
  // (The actual tracking page then shows the CTA for /pilot)
  return {
    statusCode: 302,
    headers: {
      Location: `/ref.html?clinic=${encodeURIComponent(clinic)}`,
      'Cache-Control': 'no-store, no-cache',
    },
    body: '',
  };
};
