import fetch from "node-fetch";

const BASE = "https://hacker-news.firebaseio.com/v0";

async function getJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HN fetch failed: ${res.status}`);
  return res.json();
}

export async function scrapeHackerNews({ type = "topstories", limit = 50 }) {
  const ids = await getJson(`${BASE}/${type}.json`);
  const slice = ids.slice(0, limit);

  const items = [];
  for (const id of slice) {
    const data = await getJson(`${BASE}/item/${id}.json`);
    if (!data || data.deleted || data.dead) continue;

    items.push({
      source: "hackernews",
      subreddit: "HackerNews", // reuse display field
      id: String(id),
      url: data.url || `https://news.ycombinator.com/item?id=${id}`,
      title: data.title || "",
      selftext: data.text ? String(data.text) : "",
      created_utc: data.time,
      ups: data.score || 0,
      num_comments: data.descendants || 0
    });
  }

  return items;
}
