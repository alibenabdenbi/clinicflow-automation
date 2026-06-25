// netlify/functions/thumbnail.js
// GET /api/thumbnail?clinic=SLUG
// Redirects to /thumbnails/[slug].png if a personalized screenshot was deployed.
// Falls back to static thumbnail.png.
// Screenshots are pre-generated locally by src/cli/generateScreenshots.js
// and saved to public/netlify-deploy/thumbnails/ before deploying.

const fs = require('fs');
const path = require('path');

exports.handler = async (event) => {
  const raw = event.queryStringParameters?.clinic || '';
  const slug = raw.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

  if (slug) {
    // Check if a personalized screenshot exists as a deployed static file
    const personalizedPath = path.join(process.cwd(), 'thumbnails', `${slug}.png`);
    if (fs.existsSync(personalizedPath)) {
      const img = fs.readFileSync(personalizedPath);
      return {
        statusCode: 200,
        headers: {
          'Content-Type': 'image/png',
          'Cache-Control': 'public, max-age=86400',
        },
        body: img.toString('base64'),
        isBase64Encoded: true,
      };
    }
  }

  // Static fallback
  const staticPath = path.join(process.cwd(), 'thumbnail.png');
  if (fs.existsSync(staticPath)) {
    const img = fs.readFileSync(staticPath);
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'image/png',
        'Cache-Control': 'public, max-age=3600',
      },
      body: img.toString('base64'),
      isBase64Encoded: true,
    };
  }

  return {
    statusCode: 302,
    headers: { Location: 'https://clinicflowautomation.com/live' },
    body: '',
  };
};
