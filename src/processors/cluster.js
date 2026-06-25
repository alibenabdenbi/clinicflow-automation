// src/processors/cluster.js

const THEME_KEYWORDS = [
  {
    theme: "Client Acquisition",
    keywords: [
      "lead", "leads", "outreach", "cold email", "cold dm", "linkedin",
      "prospecting", "book calls", "pipeline", "sales", "crm", "appointment",
      "follow up", "follow-up", "reply rate"
    ],
  },
  {
    theme: "Client Ops & Freelancing",
    keywords: [
      "scope creep", "invoice", "invoicing", "proposal", "contract", "milestone",
      "deposit", "late payment", "not paid", "ghosted", "client", "freelance",
      "upwork", "agreement"
    ],
  },
  {
    theme: "Ecommerce & Conversion",
    keywords: [
      "shopify", "woocommerce", "cart", "checkout", "conversion", "upsell",
      "abandoned cart", "landing page", "product page"
    ],
  },
  {
    theme: "AI & Tech News",
    keywords: [
      "ai", "agent", "llm", "gpt", "claude", "automation", "prompt",
      "api", "playwright", "crawler"
    ],
  },
  {
    theme: "Other",
    keywords: [],
  },
];

function toText(it) {
  const title = (it?.title || "").toString();
  const selftext = (it?.selftext || "").toString();
  return `${title}\n${selftext}`.toLowerCase();
}

function chooseTheme(it) {
  const text = toText(it);

  let best = { theme: "Other", hits: 0 };

  for (const bucket of THEME_KEYWORDS) {
    if (!bucket.keywords?.length) continue;

    let hits = 0;
    for (const k of bucket.keywords) {
      if (k && text.includes(k)) hits += 1;
    }

    if (hits > best.hits) best = { theme: bucket.theme, hits };
  }

  return best.theme;
}

// ✅ HARDENED: filters undefined/null items so we never crash
export function addThemes(items = []) {
  const safe = Array.isArray(items) ? items.filter(Boolean) : [];
  return safe.map((it) => ({
    ...it,
    title: (it?.title || "").toString(),
    selftext: (it?.selftext || "").toString(),
    theme: it?.theme || chooseTheme(it),
  }));
}

export function summarizeThemes(items = [], topN = 10) {
  const safe = Array.isArray(items) ? items.filter(Boolean) : [];

  const buckets = new Map();

  for (const it of safe) {
    const theme = it?.theme || "Other";
    if (!buckets.has(theme)) buckets.set(theme, []);
    buckets.get(theme).push(it);
  }

  const summaries = [];
  for (const [theme, arr] of buckets.entries()) {
    const scores = arr.map((x) => Number(x?.score || 0)).filter((n) => Number.isFinite(n));
    const count = arr.length;
    const avgScore = count ? scores.reduce((a, b) => a + b, 0) / Math.max(scores.length, 1) : 0;
    const maxScore = scores.length ? Math.max(...scores) : 0;

    summaries.push({
      theme,
      count,
      avgScore: Number(avgScore.toFixed(2)),
      maxScore: Number(maxScore.toFixed(2)),
      examples: arr.slice(0, 3).map((x) => ({
        title: x?.title || "",
        url: x?.url || x?.postUrl || null,
        source: x?.source || null,
        score: x?.score ?? null,
      })),
    });
  }

  summaries.sort((a, b) => (b.count || 0) - (a.count || 0));
  return summaries.slice(0, topN);
}