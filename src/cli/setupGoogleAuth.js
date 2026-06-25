// src/cli/setupGoogleAuth.js
// One-time OAuth setup to get a refresh token for Google Business Profile API.
// Run: node src/cli/setupGoogleAuth.js
// Follow the URL printed, authorize, paste the code back.

import dotenv from 'dotenv';
import { createServer } from 'http';
import { URL } from 'url';
dotenv.config();

const CLIENT_ID     = process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const REDIRECT_URI  = 'http://localhost:3456/callback';

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.log(`
===  GOOGLE OAUTH SETUP ===

Step 1 — Create credentials in Google Cloud Console:
  1. Go to: https://console.cloud.google.com
  2. Create project "ClinicFlow" (or use existing)
  3. Enable: "My Business API" and "My Business Account Management API"
  4. Go to APIs & Services → Credentials → Create OAuth 2.0 Client ID
  5. Application type: Web application
  6. Authorized redirect URI: http://localhost:3456/callback
  7. Copy Client ID and Client Secret

Step 2 — Add to .env:
  GOOGLE_CLIENT_ID=your_client_id
  GOOGLE_CLIENT_SECRET=your_client_secret

Step 3 — Run this script again:
  node src/cli/setupGoogleAuth.js

Step 4 — Get Business Account and Location IDs:
  Run after auth: node src/cli/setupGoogleAuth.js --list
`);
  process.exit(0);
}

// List mode — show account and location IDs
if (process.argv.includes('--list')) {
  const token = await getAccessToken();
  const accounts = await fetch('https://mybusinessaccountmanagement.googleapis.com/v1/accounts',
    { headers: { Authorization: `Bearer ${token}` } }).then(r => r.json());
  console.log('\nYour GBP Accounts:');
  (accounts.accounts || []).forEach(a => {
    console.log(`  ${a.accountName} — ID: ${a.name.split('/').pop()}`);
  });
  if (accounts.accounts?.[0]) {
    const accountName = accounts.accounts[0].name;
    const locations = await fetch(
      `https://mybusinessbusinessinformation.googleapis.com/v1/${accountName}/locations`,
      { headers: { Authorization: `Bearer ${token}` } }
    ).then(r => r.json());
    console.log('\nLocations:');
    (locations.locations || []).forEach(l => {
      console.log(`  ${l.title} — ID: ${l.name.split('/').pop()}`);
    });
    const acctId = accountName.split('/').pop();
    const locId  = locations.locations?.[0]?.name?.split('/').pop();
    console.log('\nAdd to .env:');
    console.log(`  GOOGLE_BUSINESS_ACCOUNT_ID=${acctId}`);
    if (locId) console.log(`  GOOGLE_BUSINESS_LOCATION_ID=${locId}`);
  }
  process.exit(0);
}

async function getAccessToken() {
  const token = process.env.GOOGLE_REFRESH_TOKEN;
  if (!token) throw new Error('No refresh token — run setup first');
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: CLIENT_ID, client_secret: CLIENT_SECRET, refresh_token: token, grant_type: 'refresh_token' }),
  });
  const data = await res.json();
  return data.access_token;
}

// OAuth flow
const SCOPES = [
  'https://www.googleapis.com/auth/business.manage',
].join(' ');

const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?` +
  `client_id=${encodeURIComponent(CLIENT_ID)}` +
  `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}` +
  `&response_type=code` +
  `&scope=${encodeURIComponent(SCOPES)}` +
  `&access_type=offline` +
  `&prompt=consent`;

console.log('\n=== GOOGLE OAUTH SETUP ===\n');
console.log('1. Open this URL in your browser:\n');
console.log(authUrl);
console.log('\n2. Authorize ClinicFlow to manage your Business Profile');
console.log('3. You will be redirected to localhost — the token will be captured automatically\n');

// Local server to catch the callback
const server = createServer(async (req, res) => {
  const url    = new URL(req.url, 'http://localhost:3456');
  const code   = url.searchParams.get('code');
  if (!code) { res.end('No code'); return; }

  try {
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id:     CLIENT_ID,
        client_secret: CLIENT_SECRET,
        redirect_uri:  REDIRECT_URI,
        grant_type:    'authorization_code',
      }),
    });
    const tokens = await tokenRes.json();

    if (tokens.refresh_token) {
      console.log('\n✓ SUCCESS! Add this to your .env:\n');
      console.log(`GOOGLE_REFRESH_TOKEN=${tokens.refresh_token}`);
      console.log('\nThen run: node src/cli/setupGoogleAuth.js --list');
      console.log('to find your Account ID and Location ID.\n');
      res.end('<h2>✓ Authorization successful! Check your terminal for the refresh token.</h2>');
    } else {
      console.log('✗ No refresh token in response:', tokens);
      res.end('<h2>✗ No refresh token. Check terminal.</h2>');
    }
  } catch (e) {
    console.error('Token exchange failed:', e.message);
    res.end('<h2>Error — check terminal</h2>');
  }
  server.close();
  process.exit(0);
});

server.listen(3456, () => console.log('Waiting for OAuth callback on port 3456...'));
