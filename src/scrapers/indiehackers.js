import { PlaywrightCrawler } from "crawlee";

export async function scrapeIndieHackers({ limitPages = 2, maxPosts = 50 }) {
  const postUrls = new Set();
  const results = [];

  const groupUrls = [];
  for (let i = 1; i <= limitPages; i++) {
    groupUrls.push(`https://www.indiehackers.com/group/startups?page=${i}`);
    groupUrls.push(`https://www.indiehackers.com/group/marketing?page=${i}`);
    groupUrls.push(`https://www.indiehackers.com/group/founders?page=${i}`);
  }

  // 1) Collect post URLs (rendered)
  const collector = new PlaywrightCrawler({
    maxConcurrency: 1,
    requestHandlerTimeoutSecs: 60,
    async requestHandler({ page }) {
      await page.waitForTimeout(1500);

      const links = await page.$$eval("a[href^='/post/']", (as) =>
        as.map((a) => a.getAttribute("href")).filter(Boolean)
      );

      links.forEach((href) => postUrls.add(`https://www.indiehackers.com${href}`));
    }
  });

  await collector.run(groupUrls);

  const urls = [...postUrls].slice(0, maxPosts);

  // 2) Deep crawl posts to get title/body
  const deep = new PlaywrightCrawler({
    maxConcurrency: 1,
    requestHandlerTimeoutSecs: 60,
    async requestHandler({ page, request }) {
      await page.waitForTimeout(1500);

      const title = await page.title();
      const text = await page.evaluate(() => {
        const article = document.querySelector("article");
        if (!article) return "";
        return (article.innerText || "").replace(/\s+/g, " ").trim();
      });

      results.push({
        source: "indiehackers",
        subreddit: "IndieHackers",
        id: request.url.split("/post/")[1] || request.url,
        url: request.url,
        title: (title || "").replace(" | Indie Hackers", "").trim(),
        selftext: text.slice(0, 4000),
        created_utc: null,
        ups: 0,
        num_comments: 0
      });
    }
  });

  if (urls.length > 0) {
    await deep.run(urls);
  }

  return results;
}
