import Parser from "rss-parser";

const parser = new Parser();

export async function scrapeProductHunt({ limit = 50 } = {}) {
  // Product Hunt RSS (newest posts)
  const feedUrl = "https://www.producthunt.com/feed";
  const feed = await parser.parseURL(feedUrl);

  return (feed.items || []).slice(0, limit).map((it) => ({
    source: "producthunt",
    subreddit: "ProductHunt",
    id: it.guid || it.link,
    url: it.link,
    title: it.title || "",
    selftext: (it.contentSnippet || it.content || "").toString(),
    created_utc: it.isoDate ? Date.parse(it.isoDate) / 1000 : null,
    ups: 0,
    num_comments: 0,
  }));
}
