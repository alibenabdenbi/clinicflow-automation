import * as cheerio from 'cheerio';
async function getFetch() {
  if (typeof fetch === "function") return fetch;
  const mod = await import("node-fetch");
  return mod.default;
}

function clean(s = "") {
  return String(s).replace(/\s+/g, " ").trim();
}

function pickTop(items, n = 8) {
  const seen = new Set();
  const out = [];
  for (const x of items) {
    const v = clean(x);
    if (!v) continue;
    const key = v.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(v);
    if (out.length >= n) break;
  }
  return out;
}

export async function getWebsiteSignals(url, { timeoutMs = 9000 } = {}) {
  const fetchFn = await getFetch();
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetchFn(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; ClinicFlowBot/1.0)",
        Accept: "text/html,application/xhtml+xml",
      },
      redirect: "follow",
    });

    if (!res.ok) {
      return { ok: false, url, error: `HTTP ${res.status}` };
    }

    const html = await res.text();
    const $ = cheerio.load(html);

    const title = clean($("title").first().text());
    const h1 = clean($("h1").first().text());
    const metaDescription = clean($('meta[name="description"]').attr("content") || "");

    const navTexts = [];
    $("nav a, header a, .menu a").each((_, el) => navTexts.push($(el).text()));

    const buttonTexts = [];
    $("a.btn, a.button, button, .btn, .button, [role='button']").each((_, el) =>
      buttonTexts.push($(el).text())
    );

    const raw = [...navTexts, ...buttonTexts]
      .map(clean)
      .filter((x) => x && x.length >= 3 && x.length <= 55)
      .filter((x) => !/home|about|contact|blog|login|privacy|terms|careers|news/i.test(x));

    const services = pickTop(raw, 10);

    return {
      ok: true,
      url,
      title: title || "",
      h1: h1 || "",
      metaDescription: metaDescription || "",
      services,
    };
  } catch (e) {
    return { ok: false, url, error: e?.message || String(e) };
  } finally {
    clearTimeout(t);
  }
}