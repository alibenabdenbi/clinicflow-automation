// src/scrapers/reddit.js
const DEFAULT_SUBREDDITS = ["smallbusiness", "Entrepreneur", "shopify", "freelance", "startups"];

function getEnv(name, fallback = null) {
  const v = process.env[name];
  return v && String(v).trim().length ? v : fallback;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function buildListingUrl(subreddit, sort = "hot", limit = 50) {
  // raw_json=1 prevents HTML entities (&amp;) in some fields
  const safeLimit = Math.max(1, Math.min(Number(limit || 50), 100));
  return `https://oauth.reddit.com/r/${encodeURIComponent(subreddit)}/${encodeURIComponent(
    sort
  )}?limit=${safeLimit}&raw_json=1`;
}

async function getRedditToken() {
  const clientId = getEnv("REDDIT_CLIENT_ID");
  const clientSecret = getEnv("REDDIT_CLIENT_SECRET");

  if (!clientId || !clientSecret) {
    throw new Error(
      "Missing Reddit OAuth env vars. Set REDDIT_CLIENT_ID and REDDIT_CLIENT_SECRET."
    );
  }

  const userAgent =
    getEnv("REDDIT_USER_AGENT") ||
    "OREEngine/1.0 (by u/yourusername)"; // Reddit recommends descriptive UA

  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");

  const res = await fetch("https://www.reddit.com/api/v1/access_token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "User-Agent": userAgent,
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: new URLSearchParams({ grant_type: "client_credentials" }).toString(),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Reddit token request failed (${res.status}): ${text.slice(0, 200)}`);
  }

  const data = await res.json();
  if (!data?.access_token) throw new Error("Reddit token response missing access_token.");

  return { token: data.access_token, userAgent };
}

function toItemFromChild(child) {
  const d = child?.data;
  if (!d || d.over_18) return null;

  const author = d.author && d.author !== "[deleted]" ? d.author : null;
  const permalink = d.permalink || "";
  const url = permalink.startsWith("http") ? permalink : `https://www.reddit.com${permalink}`;

  const ups = Number(d.ups || 0);
  const num_comments = Number(d.num_comments || 0);
  const score = ups + num_comments * 0.6;

  const title = d.title || "";
  const selftext = d.selftext || "";
  const text = `${title}\n\n${selftext}`.trim();

  return {
    source: "reddit",
    subreddit: d.subreddit || null,
    id: d.id,
    url,
    title,
    selftext,
    text,
    author,
    authorUrl: author ? `https://www.reddit.com/user/${author}` : null,
    created_utc: d.created_utc || null,
    ups,
    num_comments,
    score,
  };
}

async function fetchListing({ token, userAgent, subreddit, sort, limit }) {
  const url = buildListingUrl(subreddit, sort, limit);

  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      "User-Agent": userAgent,
      Accept: "application/json",
    },
  });

  // Respect rate limit if provided
  const remaining = Number(res.headers.get("x-ratelimit-remaining"));
  const resetSec = Number(res.headers.get("x-ratelimit-reset"));
  if (!Number.isNaN(remaining) && remaining <= 1 && !Number.isNaN(resetSec)) {
    // small buffer
    await sleep(Math.ceil(resetSec * 1000) + 250);
  }

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Reddit listing failed for r/${subreddit} (${res.status}): ${text.slice(0, 200)}`);
  }

  const json = await res.json();
  const children = json?.data?.children ?? [];
  return children.map(toItemFromChild).filter(Boolean);
}

export async function scrapeReddit({ subreddits = DEFAULT_SUBREDDITS, sort = "hot", limit = 50 } = {}) {
  const results = [];

  // OAuth token (official way)
  const { token, userAgent } = await getRedditToken();

  // Fetch each subreddit sequentially (gentle + stable)
  for (const s of subreddits) {
    try {
      const items = await fetchListing({ token, userAgent, subreddit: s, sort, limit });
      results.push(...items);
      // gentle spacing
      await sleep(350);
    } catch (err) {
      console.log(`⚠️ Reddit r/${s} failed, continuing. Reason: ${err?.message || err}`);
    }
  }

  return results;
}