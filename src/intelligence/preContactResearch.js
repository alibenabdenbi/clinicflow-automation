// src/intelligence/preContactResearch.js
// Pre-send research: checks Google review snippets from DDG for communication pain signals.
// Call researchClinic() before sending to get reviewPainScore + reviewPainQuotes.
// Call enrichQueue() to run research on the next N todo clinics in the outreach queue.

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import fetch from "node-fetch";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const DATA_DIR = path.join(ROOT, "data");
const OUTREACH_PATH = path.join(DATA_DIR, "outreach.localDentists.json");

// Communication pain keywords — phrases a frustrated patient would write
const PAIN_KEYWORDS = [
  "hard to reach", "no callback", "missed call", "no reminder",
  "forgot appointment", "never heard back", "couldn't get through",
  "no response", "didn't call back", "hard to contact",
  "no confirmation", "poor communication", "unreachable",
  "left a message", "voicemail", "busy signal", "no one answered",
  "no follow", "didn't follow up", "dropped the ball",
  "phone", "call back", "reach them",
];

function readJsonSafe(p, fb) {
  try { return JSON.parse(fs.readFileSync(p, "utf-8")); } catch { return fb; }
}
function writeJsonSafe(p, data) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(data, null, 2), "utf-8");
}
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// Strips HTML entities and tags, collapses whitespace
function cleanText(html) {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ").replace(/&#\d+;/g, " ").replace(/&[a-z]+;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Pull a readable review-like fragment from a snippet
function extractQuoteFragment(snippet) {
  const clean = cleanText(snippet);
  // Remove leading star ratings / numbers like "4.2 · 54 reviews ·"
  const stripped = clean.replace(/^[\d.★☆·\s]+(?:reviews?|stars?|ratings?)\s*[·—\-]*\s*/i, "");
  // Truncate to first 120 chars at a word boundary
  if (stripped.length <= 120) return stripped;
  const cut = stripped.slice(0, 120);
  const lastSpace = cut.lastIndexOf(" ");
  return (lastSpace > 60 ? cut.slice(0, lastSpace) : cut) + "…";
}

async function fetchHtml(url, timeoutMs = 12_000) {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept-Language": "en-CA,en;q=0.9",
        "Accept": "text/html,application/xhtml+xml",
      },
      redirect: "follow",
      signal: ctrl.signal,
    });
    clearTimeout(t);
    if (!res.ok) return "";
    return await res.text();
  } catch { return ""; }
}

function extractSnippetsFromDDG(html) {
  const snippets = [];
  const re = /class="result__snippet"[^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const text = cleanText(m[1]);
    if (text.length > 20) snippets.push(text);
  }
  return snippets;
}

// Returns true if the snippet looks like natural language (not JSON/nav/boilerplate)
function isNaturalLanguage(s) {
  if (!s || s.length < 25) return false;
  if (s.includes("{") || s.includes("}") || s.includes("[") || s.includes("]")) return false;
  // Too many pipe/colon separators = nav menu or structured data
  if ((s.match(/[|:]/g) || []).length > 3) return false;
  // Requires at least 4 space-separated tokens (words)
  if (s.trim().split(/\s+/).length < 4) return false;
  // Reject contact/nav blocks containing "Telephone:" label
  if (/\bTelephone:/i.test(s)) return false;
  // At least 40% of characters should be letters
  const letters = (s.match(/[a-z]/gi) || []).length;
  if (letters / s.length < 0.4) return false;
  return true;
}

// Scrape the clinic's own website for review/testimonial mentions
async function scrapeWebsiteForPain(websiteUrl) {
  if (!websiteUrl) return [];
  const base = websiteUrl.replace(/\/$/, "");
  const pages = [base, `${base}/reviews`, `${base}/testimonials`, `${base}/about`];
  const snippets = [];
  const seen = new Set();

  for (const page of pages) {
    const html = await fetchHtml(page, 8_000);
    if (!html) continue;

    const text = cleanText(html);
    const sentences = text.split(/[.!?]\s+/);
    for (const sentence of sentences) {
      const s = sentence.trim();
      const lower = s.toLowerCase();
      // Must match a pain keyword AND pass natural language check AND not be a duplicate
      if (
        PAIN_KEYWORDS.some(kw => lower.includes(kw)) &&
        isNaturalLanguage(s) &&
        s.length < 200 &&
        !seen.has(s.slice(0, 40))
      ) {
        seen.add(s.slice(0, 40));
        snippets.push(s);
      }
    }
    if (snippets.length >= 3) break;
    await sleep(500);
  }
  return snippets;
}

/**
 * Searches for review pain signals about a clinic.
 * Primary source: DuckDuckGo HTML search.
 * Fallback when DDG is rate-limited: scrape clinic website directly.
 *
 * @param {{ clinicName: string, city: string, website?: string }} opts
 * @returns {Promise<{ reviewPainScore: number, reviewPainQuotes: string[], reviewedAt: string, source: string }>}
 */
export async function researchClinic({ clinicName, city, website = null }) {
  const reviewedAt = new Date().toISOString();

  // ── Try DDG first ──────────────────────────────────────────────────────────
  const q = `"${clinicName}" ${city || ""} reviews`.trim();
  const ddgUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(q)}`;
  const ddgHtml = await fetchHtml(ddgUrl, 12_000);

  if (ddgHtml && ddgHtml.length > 2000) {
    const snippets = extractSnippetsFromDDG(ddgHtml);
    const painSnippets = snippets.filter(s =>
      PAIN_KEYWORDS.some(kw => s.toLowerCase().includes(kw))
    );
    if (snippets.length > 0) {
      return {
        reviewPainScore:  Math.min(5, painSnippets.length),
        reviewPainQuotes: painSnippets.slice(0, 2).map(s => extractQuoteFragment(s)),
        reviewedAt,
        source: "ddg",
      };
    }
  }

  // ── Fallback: scrape clinic website directly ───────────────────────────────
  if (website) {
    const snippets = await scrapeWebsiteForPain(website);
    if (snippets.length > 0) {
      return {
        reviewPainScore:  Math.min(5, snippets.length),
        reviewPainQuotes: snippets.slice(0, 2).map(s => extractQuoteFragment(s)),
        reviewedAt,
        source: "website",
      };
    }
  }

  return { reviewPainScore: 0, reviewPainQuotes: [], reviewedAt, source: "none" };
}

/**
 * Runs pre-contact research on the next `limit` todo clinics and saves results to outreach queue.
 * @param {{ limit?: number, dryRun?: boolean, onProgress?: Function }} opts
 * @returns {Promise<{ processed: number, withPainSignals: number, results: Array }>}
 */
export async function enrichQueue({ limit = 20, dryRun = false, onProgress = null } = {}) {
  const leads = readJsonSafe(OUTREACH_PATH, []);

  const candidates = leads
    .map((l, idx) => ({ l, idx }))
    .filter(({ l }) =>
      (l.status || "todo") === "todo" &&
      l.email &&
      l.clinicName &&
      !l.reviewedAt  // skip already-researched
    )
    .slice(0, limit);

  const results = [];
  let withPainSignals = 0;

  for (let i = 0; i < candidates.length; i++) {
    const { l, idx } = candidates[i];
    if (onProgress) onProgress(i + 1, candidates.length, l.clinicName);

    const research = await researchClinic({ clinicName: l.clinicName, city: l.city || "", website: l.website || null });

    if (research.reviewPainScore >= 2) withPainSignals++;

    results.push({
      clinicName:       l.clinicName,
      city:             l.city || "",
      email:            l.email,
      reviewPainScore:  research.reviewPainScore,
      reviewPainQuotes: research.reviewPainQuotes,
    });

    if (!dryRun) {
      leads[idx].reviewPainScore  = research.reviewPainScore;
      leads[idx].reviewPainQuotes = research.reviewPainQuotes;
      leads[idx].reviewedAt       = research.reviewedAt;
    }

    if (i < candidates.length - 1) await sleep(2_500);
  }

  if (!dryRun && results.length > 0) {
    writeJsonSafe(OUTREACH_PATH, leads);
  }

  return { processed: results.length, withPainSignals, results };
}
