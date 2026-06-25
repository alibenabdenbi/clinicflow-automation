// src/processors/enrichContact.js

const SKIP_HOSTS = new Set([
  "github.com",
  "news.ycombinator.com",
  "www.indiehackers.com",
  "indiehackers.com",
  "wordpress.org",
  "www.wordpress.org",
  "producthunt.com",
  "www.producthunt.com",
  "reddit.com",
  "www.reddit.com",
]);

function safeUrl(u) {
  try {
    return new URL(u);
  } catch {
    return null;
  }
}

function uniq(arr) {
  return [...new Set(arr.filter(Boolean))];
}

function extractEmails(text) {
  if (!text) return [];
  // decent email regex for web scraping
  const re = /([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/g;
  return uniq((text.match(re) || []).map((x) => x.trim()));
}

function extractLinks(html, baseUrl) {
  if (!html) return [];
  const links = [];
  const re = /href\s*=\s*["']([^"']+)["']/gi;
  let m;
  while ((m = re.exec(html))) {
    const href = (m[1] || "").trim();
    if (!href) continue;
    if (href.startsWith("mailto:")) continue;

    try {
      const abs = new URL(href, baseUrl).toString();
      links.push(abs);
    } catch {
      // ignore
    }
  }
  return uniq(links);
}

function pickBestPage(links, type) {
  const needles =
    type === "contact"
      ? ["contact", "support", "help", "get-in-touch"]
      : type === "about"
      ? ["about", "team", "company", "who-we-are"]
      : ["pricing", "plans", "billing"];

  const scored = links
    .map((u) => {
      const low = u.toLowerCase();
      let score = 0;
      for (const n of needles) if (low.includes(`/${n}`) || low.includes(n)) score += 2;
      if (low.includes("?")) score -= 0.5;
      return { u, score };
    })
    .sort((a, b) => b.score - a.score);

  return scored[0]?.score > 0 ? scored[0].u : null;
}

/**
 * Enrich a lead with contact info based on a website URL.
 * Returns { contactEmail, contactPage, aboutPage, pricingPage, enrichedFrom }
 */
export async function enrichLeadContact({ postUrl } = {}) {
  const urlObj = safeUrl(postUrl);
  if (!urlObj) return null;

  const host = urlObj.hostname.toLowerCase();
  if (SKIP_HOSTS.has(host)) return null;

  // Only enrich real websites
  if (!/^https?:$/.test(urlObj.protocol)) return null;

  // Fetch homepage
  let html = "";
  try {
    const res = await fetch(urlObj.toString(), {
      redirect: "follow",
      headers: {
        "User-Agent": "ORE-Engine/1.0 (+contact-enrichment)",
        Accept: "text/html,application/xhtml+xml",
      },
    });
    if (!res.ok) return null;
    html = await res.text();
  } catch {
    return null;
  }

  const emails = extractEmails(html);
  const links = extractLinks(html, urlObj.toString());

  const contactPage = pickBestPage(links, "contact");
  const aboutPage = pickBestPage(links, "about");
  const pricingPage = pickBestPage(links, "pricing");

  // If no emails on homepage, try contact page quickly
  let contactEmail = emails[0] || null;

  if (!contactEmail && contactPage) {
    try {
      const res2 = await fetch(contactPage, {
        redirect: "follow",
        headers: {
          "User-Agent": "ORE-Engine/1.0 (+contact-enrichment)",
          Accept: "text/html,application/xhtml+xml",
        },
      });
      if (res2.ok) {
        const html2 = await res2.text();
        const emails2 = extractEmails(html2);
        contactEmail = emails2[0] || null;
      }
    } catch {
      // ignore
    }
  }

  // Nothing found = return null (avoid junk fields)
  if (!contactEmail && !contactPage && !pricingPage) return null;

  return {
    contactEmail,
    contactPage,
    aboutPage,
    pricingPage,
    enrichedFrom: urlObj.origin,
  };
}