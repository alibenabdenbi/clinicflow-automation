// src/services/gbpPoster.js
// Posts to Google Business Profile using the My Business API.
// Requires OAuth 2.0 credentials — run: node src/cli/setupGoogleAuth.js

const TOKEN_URL    = 'https://oauth2.googleapis.com/token';
const GBP_API_BASE = 'https://mybusiness.googleapis.com/v4';

async function getAccessToken() {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id:     process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      refresh_token: process.env.GOOGLE_REFRESH_TOKEN,
      grant_type:    'refresh_token',
    }),
  });
  const data = await res.json();
  if (!data.access_token) throw new Error(`Token error: ${JSON.stringify(data)}`);
  return data.access_token;
}

/**
 * Post a text update to Google Business Profile.
 * @param {string} text - The post body (max ~1500 chars for GBP)
 * @param {string} [callToActionType] - 'LEARN_MORE' | 'BOOK' | 'SIGN_UP' | 'CALL'
 * @param {string} [callToActionUrl] - URL for the CTA button
 * @returns {Promise<object>} GBP API response
 */
export async function postToGBP(text, callToActionType = 'LEARN_MORE', callToActionUrl = 'https://clinicflowautomation.com/calculator') {
  const accountId  = process.env.GOOGLE_BUSINESS_ACCOUNT_ID;
  const locationId = process.env.GOOGLE_BUSINESS_LOCATION_ID;

  if (!accountId || !locationId) {
    throw new Error('Missing GOOGLE_BUSINESS_ACCOUNT_ID or GOOGLE_BUSINESS_LOCATION_ID');
  }
  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_REFRESH_TOKEN) {
    throw new Error('Missing Google OAuth credentials');
  }

  const token = await getAccessToken();

  const body = {
    languageCode: 'en',
    summary: text.slice(0, 1500),
    callToAction: {
      actionType: callToActionType,
      url: callToActionUrl,
    },
    topicType: 'STANDARD',
  };

  const res = await fetch(
    `${GBP_API_BASE}/accounts/${accountId}/locations/${locationId}/localPosts`,
    {
      method:  'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body:    JSON.stringify(body),
    }
  );

  const result = await res.json();
  if (result.error) throw new Error(`GBP API error: ${result.error.message}`);
  return result;
}

/**
 * List recent GBP posts — useful for verifying and deduplication.
 */
export async function listGBPPosts(maxResults = 5) {
  const accountId  = process.env.GOOGLE_BUSINESS_ACCOUNT_ID;
  const locationId = process.env.GOOGLE_BUSINESS_LOCATION_ID;
  const token = await getAccessToken();

  const res = await fetch(
    `${GBP_API_BASE}/accounts/${accountId}/locations/${locationId}/localPosts?pageSize=${maxResults}`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  return res.json();
}
