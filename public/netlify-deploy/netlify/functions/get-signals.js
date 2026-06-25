// netlify/functions/get-signals.js
// Returns live classified signal data from Netlify Blobs.
// Deployed at: clinicflowautomation.com/.netlify/functions/get-signals

exports.handler = async (event) => {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'no-store',
  };

  try {
    const { getStore } = await import('@netlify/blobs');
    const store = getStore({
      name: 'email-opens',
      siteID: process.env.NETLIFY_SITE_ID,
      token: process.env.NETLIFY_TOKEN,
    });

    const today     = new Date().toISOString().slice(0, 10);
    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);

    // Load today's and yesterday's raw opens
    let todayOpens = [], yesterdayOpens = [];
    try { const t = await store.get(`opens-${today}`, { type: 'json' }); if (Array.isArray(t)) todayOpens = t; } catch {}
    try { const y = await store.get(`opens-${yesterday}`, { type: 'json' }); if (Array.isArray(y)) yesterdayOpens = y; } catch {}

    // Group today's opens by clinic and classify
    const byClinic = {};
    todayOpens.forEach(o => {
      if (!byClinic[o.clinic]) byClinic[o.clinic] = {
        slug: o.clinic,
        clinicName: o.clinic.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' '),
        variant: o.variant,
        opens: [],
      };
      byClinic[o.clinic].opens.push(o);
    });

    const classified = Object.values(byClinic).map(c => {
      const humanOpens  = c.opens.filter(o => !o.isBot);
      const mobileOpens = c.opens.filter(o => o.isMobile);
      const hasMobile   = mobileOpens.length > 0;
      const hasHuman    = humanOpens.length > 0;

      const isPilotOffer = c.opens.some(o => (o.variant || '').toUpperCase() === 'PILOT');
      let confidence, confidenceScore;
      if (hasMobile && mobileOpens.length >= 2)       { confidence = isPilotOffer ? 'PILOT' : 'STRONG'; confidenceScore = isPilotOffer ? 4 : 3; }
      else if (hasMobile)                               { confidence = 'MEDIUM'; confidenceScore = 2; }
      else if (hasHuman && humanOpens.length >= 2)     { confidence = 'MEDIUM'; confidenceScore = 2; }
      else if (hasHuman)                                { confidence = 'WEAK';   confidenceScore = 1; }
      else                                              { confidence = 'BOT';    confidenceScore = 0; }

      return {
        slug: c.slug,
        clinicName: c.clinicName,
        variant: c.variant,
        openCount: c.opens.length,
        humanOpenCount: humanOpens.length,
        mobileOpenCount: mobileOpens.length,
        hasMobile,
        hasHuman,
        confidence,
        confidenceScore,
        lastOpenedAt: c.opens[c.opens.length - 1]?.openedAt,
      };
    }).sort((a, b) => b.confidenceScore - a.confidenceScore);

    const summary = {
      totalOpened:  classified.length,
      strong:       classified.filter(c => c.confidence === 'STRONG').length,
      medium:       classified.filter(c => c.confidence === 'MEDIUM').length,
      weak:         classified.filter(c => c.confidence === 'WEAK').length,
      bot:          classified.filter(c => c.confidence === 'BOT').length,
      pilot:        classified.filter(c => c.confidence === 'PILOT').length,
      realHumans:   classified.filter(c => c.hasHuman).length,
      mobileOpens:  classified.filter(c => c.hasMobile).length,
    };

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        ok: true,
        date: today,
        lastUpdated: new Date().toISOString(),
        summary,
        hotLeads: classified.filter(c => c.confidenceScore >= 2),
        allSignals: classified,
        yesterdayRawCount: yesterdayOpens.length,
      }),
    };

  } catch (err) {
    console.error('get-signals error:', err.message);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ ok: false, error: err.message }),
    };
  }
};
