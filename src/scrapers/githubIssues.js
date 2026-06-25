export async function scrapeGitHubIssues({ query, limit = 50 } = {}) {
  const q = encodeURIComponent(query || "CRM outreach automation pain");
  const url = `https://api.github.com/search/issues?q=${q}&per_page=${Math.min(limit, 100)}`;

  const res = await fetch(url, {
    headers: {
      "User-Agent": "ORE-Engine",
      Accept: "application/vnd.github+json",
      // Optional: add token to avoid rate limits:
      ...(process.env.GITHUB_TOKEN ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {}),
    },
  });

  if (!res.ok) return [];
  const data = await res.json();

  return (data.items || []).slice(0, limit).map((it) => ({
    source: "github",
    subreddit: "GitHubIssues",
    id: it.html_url,
    url: it.html_url,
    title: it.title || "",
    selftext: (it.body || "").toString(),
    created_utc: it.created_at ? Date.parse(it.created_at) / 1000 : null,
    ups: it.comments || 0,
    num_comments: it.comments || 0,
  }));
}
