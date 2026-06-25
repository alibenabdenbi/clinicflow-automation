import { CheerioCrawler, PlaywrightCrawler, log } from "crawlee";

const SEARCH_QUERIES = [
  "lead generation",
  "linkedin outreach",
  "cold email",
  "email finder",
  "crm",
  "prospecting",
  "sales outreach",
];

// ✅ Legacy search is way easier to parse
function legacySearchUrl(q) {
  return `https://chrome.google.com/webstore/search/${encodeURIComponent(q)}?hl=en`;
}

function toModernDetailUrl(legacyHref) {
  // legacyHref example: /webstore/detail/slug/abcdefghijklmnop
  // We want: https://chromewebstore.google.com/detail/slug/abcdefghijklmnop?hl=en
  if (!legacyHref) return null;
  const parts = legacyHref.split("/").filter(Boolean);
  const idx = parts.indexOf("detail");
  if (idx === -1) return null;

  const slug = parts[idx + 1];
  const id = parts[idx + 2];
  if (!slug || !id) return null;

  return `https://chromewebstore.google.com/detail/${slug}/${id}?hl=en`;
}

export async function scrapeChromeWebStore({
  maxExtensionsPerQuery = 6,
  maxReviewChars = 2500,
} = {}) {
  const modernUrls = new Set();
  const results = [];

  // 1) COLLECT extension detail URLs from legacy search (Cheerio)
  const collector = new CheerioCrawler({
    maxConcurrency: 1,
    sameDomainDelaySecs: 2,
    requestHandlerTimeoutSecs: 45,
    preNavigationHooks: [
      async ({ request }) => {
        request.headers = {
          ...request.headers,
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
          "Accept-Language": "en-US,en;q=0.9",
        };
      },
    ],
    async requestHandler({ $, request }) {
      const hrefs = [];
      $("a[href*='/webstore/detail/']").each((_, el) => {
        const href = $(el).attr("href");
        if (href) hrefs.push(href);
      });

      const unique = [...new Set(hrefs)]
        .map(toModernDetailUrl)
        .filter(Boolean)
        .slice(0, maxExtensionsPerQuery);

      unique.forEach((u) => modernUrls.add(u));

      log.info(`Collected ${unique.length} extensions from: ${request.url}`);
    },
  });

  await collector.run(SEARCH_QUERIES.map(legacySearchUrl));

  if (modernUrls.size === 0) {
    log.warning("Chrome collector found 0 extension URLs (legacy too). Google might be blocking your IP.");
    return [];
  }

  // 2) DEEP crawl modern detail pages (Playwright)
  const deep = new PlaywrightCrawler({
    maxConcurrency: 1,
    sameDomainDelaySecs: 2,
    requestHandlerTimeoutSecs: 90,
    async requestHandler({ page, request }) {
      await page.waitForTimeout(1200);

      const title = await page
        .$eval("h1", (el) => el.textContent?.trim() || "")
        .catch(() => "");

      // Scroll to load more content
      for (let i = 0; i < 5; i++) {
        await page.mouse.wheel(0, 1100);
        await page.waitForTimeout(800);
      }

      // Extract short text blocks (review-ish)
      const blocks = await page
        .$$eval("div, span", (nodes) => {
          const texts = nodes
            .map((n) => (n.textContent || "").replace(/\s+/g, " ").trim())
            .filter((t) => t.length >= 30 && t.length <= 300);
          return [...new Set(texts)];
        })
        .catch(() => []);

      const snippets = blocks.slice(0, 25);
      const combined = snippets.join(" | ").slice(0, maxReviewChars);

      results.push({
        source: "chromewebstore",
        subreddit: "ChromeWebStore",
        id: request.url,
        url: request.url,
        title: title || "Chrome extension",
        selftext: combined,
        created_utc: null,
        ups: 0,
        num_comments: snippets.length,
      });
    },
  });

  await deep.run([...modernUrls]);

  return results;
}
