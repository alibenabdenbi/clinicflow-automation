// src/scrapers/wpPlugins.js
import { CheerioCrawler, RequestQueue } from "crawlee";

const DEFAULT_KEYWORDS = [
  "chatbot",
  "crm",
  "lead generation",
  "contact form",
  "booking",
  "newsletter",
  "email marketing",
  "live chat",
];

function cleanText(s = "") {
  return String(s).replace(/\s+/g, " ").trim();
}

function hasPainKeywords(t = "") {
  const x = t.toLowerCase();
  return /(doesn'?t work|not working|broken|bug|issue|problem|waste|refund|scam|support.*(slow|bad)|token|billing|charge|expensive|hard to|complicated|setup|bloat|slow|speed|crash)/.test(x);
}

function questionIntent(t = "") {
  const x = t.toLowerCase();
  return /\?/.test(t) || /(how do i|anyone know|what should i|is there a way|can someone|recommend)/.test(x);
}

function extractEmail(t = "") {
  const m = String(t).match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  return m ? m[0] : null;
}

export async function scrapeWpPlugins({
  keywords = DEFAULT_KEYWORDS,
  pagesPerKeyword = 1,
  maxPluginsPerKeyword = 5,
  maxReviewsPerPlugin = 8,
} = {}) {
  const out = [];
  const queue = await RequestQueue.open();

  for (const kw of keywords) {
    for (let p = 1; p <= pagesPerKeyword; p++) {
      const url = `https://wordpress.org/plugins/search/${encodeURIComponent(kw)}/page/${p}/`;
      await queue.addRequest({ url, userData: { kind: "search", kw } });
    }
  }

  const crawler = new CheerioCrawler({
    requestQueue: queue,
    maxConcurrency: 3,
    requestHandler: async ({ request, $, log }) => {
      const { kind, kw } = request.userData || {};

      if (kind === "search") {
        const links = [];

        // plugin card link
        $(".plugin-card .entry-title a, .plugin-card h3 a").each((_, a) => {
          const href = $(a).attr("href");
          if (href && href.includes("/plugins/")) links.push(href);
        });

        const unique = [...new Set(links)].slice(0, maxPluginsPerKeyword);

        log.info(`Collected ${unique.length} plugins from: ${request.url}`);

        for (const pluginUrl of unique) {
          const reviewsUrl = pluginUrl.endsWith("/")
            ? `${pluginUrl}reviews/`
            : `${pluginUrl}/reviews/`;

          await queue.addRequest({
            url: reviewsUrl,
            userData: { kind: "reviews", kw, pluginUrl },
          });
        }
        return;
      }

      if (kind === "reviews") {
        const pluginTitle =
          cleanText($("h1").first().text()) ||
          cleanText($(".plugin-title").first().text()) ||
          request.url;

        // Each review block
        const reviewBlocks =
          $(".wporg-ratings .review").length ? $(".wporg-ratings .review") : $(".review");

        let taken = 0;

        reviewBlocks.each((_, el) => {
          if (taken >= maxReviewsPerPlugin) return;

          const block = $(el);

          const reviewText =
            cleanText(block.find(".review-content").text()) ||
            cleanText(block.text());

          if (!reviewText) return;

          // rating: sometimes stars in aria-label like "Rated 2 out of 5"
          const ratingText =
            block.find('[aria-label*="out of 5"]').attr("aria-label") ||
            block.find(".wporg-ratings .rating").attr("aria-label") ||
            "";

          let rating = null;
          const m = ratingText.match(/Rated\s+(\d)\s+out of 5/i);
          if (m) rating = Number(m[1]);

          const author =
            cleanText(block.find(".reviewer").text()) ||
            cleanText(block.find(".review__author").text()) ||
            cleanText(block.find(".comment-author").text()) ||
            "unknown";

          // High-intent filter:
          // - prefer negative / mixed reviews (1–3)
          // - long enough
          // - pain keywords OR question intent
          const longEnough = reviewText.length >= 220;
          const pain = hasPainKeywords(reviewText);
          const intent = questionIntent(reviewText);

          const okRating = rating === null ? true : rating <= 3;

          if (!(okRating && longEnough && (pain || intent))) return;

          taken += 1;

          out.push({
            source: "wordpress",
            subreddit: "WordPressPlugins",
            id: request.url,
            url: request.url,
            title: pluginTitle,
            selftext: reviewText,
            created_utc: null,
            ups: 0,
            num_comments: 0,
            author,
            rating,
            keyword: kw,
            contactEmail: extractEmail(reviewText),
            hasQuestionIntent: intent,
          });
        });

        return;
      }
    },
  });

  await crawler.run();
  return out;
}