// src/processors/emailFinder.js
// Real email discovery — not pattern guessing.
//
// Method priority (each tried in order, stops when high-confidence result found):
//   1. Hunter.io domain search  (750 free/month — real verified emails)
//   2. Website deep scan        (homepage → contact → team → doctor pages + nav links)
//   3. DDG clinic search        ("[name] [city] dental email")
//   4. DDG LinkedIn search      (site:linkedin.com "[name]")
//   5. DDG Google Business      ("[name] [city] dental")
//   6. DDG Facebook search      ("[name] [city] dental facebook email")
//
// All found emails are MX-verified before returning.
// Results are domain-cached (data/cache/emailFinder.json, 7-day TTL).
//
// Exported API (all signatures backward-compatible):
//   findBestEmailWithConfidence(website, opts) → { email, confidence, score, rawScore, source, contactName, isNamed }
//   findEmailsForWebsite(website, opts)        → string[]
//   findContactPageUrl(website)                → string|null
//   findBestEmailOnWebsite(website)            → string|null
//   extractClinicName(website)                 → string|null
//   extractClinicNameFromPage(html)            → string|null
//   scoreEmail(email, websiteUrl)              → { score, rawScore, confidence, isNamed } | null
//   extractContactName(email)                  → string|null

import fs from "fs";
import path from "path";
import net from "net";
import { fileURLToPath } from "url";
import fetch from "node-fetch";
import * as cheerio from "cheerio";
import { promises as dns } from "dns";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");

const TIMEOUT_MS = 12_000;
const CACHE_PATH = path.join(ROOT, "data", "cache", "emailFinder.json");
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

// ─── Config ───────────────────────────────────────────────────────────────────

// Hunter.io free tier: 750 domain searches/month
// Set HUNTER_API_KEY in .env to enable
const HUNTER_API_KEY = () => (process.env.HUNTER_API_KEY || "").trim();

const USER_AGENTS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:123.0) Gecko/20100101 Firefox/123.0",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_3_1) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.3 Safari/605.1.15",
];

const DEFAULT_HEADERS = {
  "User-Agent": USER_AGENTS[0],
  "Accept-Language": "en-CA,en;q=0.9,fr-CA;q=0.8,fr;q=0.7",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
};

function pickUA() {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ─── Domain cache (persist across runs) ──────────────────────────────────────

let _cache = null;

function loadCache() {
  if (_cache) return _cache;
  try {
    if (fs.existsSync(CACHE_PATH)) {
      _cache = JSON.parse(fs.readFileSync(CACHE_PATH, "utf-8"));
    } else {
      _cache = {};
    }
  } catch {
    _cache = {};
  }
  return _cache;
}

function saveCache() {
  if (!_cache) return;
  try {
    fs.mkdirSync(path.dirname(CACHE_PATH), { recursive: true });
    fs.writeFileSync(CACHE_PATH, JSON.stringify(_cache, null, 2), "utf-8");
  } catch {}
}

function getCached(domainKey) {
  const cache = loadCache();
  const entry = cache[domainKey];
  if (!entry) return null;
  if (Date.now() - new Date(entry.cachedAt).getTime() > CACHE_TTL_MS) return null;
  return entry.result;
}

function setCached(domainKey, result) {
  const cache = loadCache();
  cache[domainKey] = { cachedAt: new Date().toISOString(), result };
  saveCache();
}

// ─── Email scoring (1–10 raw scale) ──────────────────────────────────────────
//
// 10  dr.firstname@domain.com       — named doctor (highest value)
//  9  firstname.lastname@domain.com — full personal name
//  8  firstname@domain.com          — single given name
//  7  drsmith@domain.com            — doctor no-dot format
//  6  dentist@, owner@, principal@  — high-value role
//  5  reception@, appointments@     — monitored operational inbox
//  4  office@, clinic@, smile@      — operational but less personal
//  3  practice@, care@, dental@     — branded-ish but generic
//  2  info@, contact@, admin@       — catch-all
//  1  hello@, team@, mail@          — worst generic
//  ×  noreply, vendor, foreign      — blocked (return null)

const BLOCKED_LOCALS = new Set([
  "noreply", "no-reply", "donotreply", "do-not-reply", "bounce",
  "bounces", "postmaster", "mailer-daemon", "daemon", "abuse",
  "spam", "unsubscribe", "optout", "write", "writer", "writing",
  "content", "copywriter", "seo", "sem", "ppc", "ads", "marketing",
  "socialmedia", "wordpress", "developer", "dev", "webdev",
  "design", "designer", "agency", "freelance",
  "patients", "results", "online", "schedule", "scheduling",
]);

const BLOCKED_DOMAIN_PATTERNS = [
  "wixpress.com", "wix.com", "example.com", "example.org",
  "test.com", "mailinator.com", "sentry.", "ore.urg",
  "clinicflowautomation.com",
];

const MAJOR_PROVIDERS = new Set([
  "gmail.com", "googlemail.com", "outlook.com", "hotmail.com", "hotmail.ca",
  "live.com", "msn.com", "yahoo.com", "yahoo.ca", "icloud.com", "me.com",
  "mac.com", "rogers.com", "bell.net", "telus.net", "shaw.ca",
  "videotron.ca", "sympatico.ca", "cogeco.ca",
]);

// Named doctor patterns — score 10
const DR_PATTERNS = [
  /^dr\.[a-z]{2,}$/,           // dr.anna
  /^dre\.[a-z]{2,}$/,          // dre.chen (French)
  /^dr\.[a-z]{2,}\.[a-z]{2,}$/, // dr.anna.smith
  /^dre\.[a-z]{2,}\.[a-z]{2,}$/,
];

// No-dot doctor format — score 7
const DR_NODOT_PATTERNS = [
  /^dr[a-z]{3,}$/,             // drsmith
  /^dre[a-z]{3,}$/,            // drechen
];

// Full name patterns — score 9
const FULLNAME_PATTERNS = [
  /^[a-z]{3,}\.[a-z]{3,}$/,   // firstname.lastname
  /^[a-z]{3,}-[a-z]{3,}$/,    // firstname-lastname
];

// Single given name — score 8
// (local that looks like a real name but isn't a known generic)
const GENERIC_LOCALS_SET = new Set([
  "info", "contact", "admin", "support", "help", "mail", "email",
  "webmaster", "media", "inquiry", "inquiries", "general",
  "hello", "hi", "team", "web", "website", "online", "digital",
  "new", "office", "us", "here", "message", "messages",
]);

const HIGH_ROLE = new Set(["owner", "principal", "dentist", "doctor", "hygienist", "dds", "bds", "ortho"]);

const SCORE_5_PREFIXES = ["reception", "appointments", "appointment", "booking", "bookings", "appt", "appts", "secretary", "front", "frontdesk", "front-desk", "manager"];
const SCORE_4_PREFIXES = ["office", "clinic", "smile", "smiles", "practice", "desk", "operations", "welcome", "reach", "connect"];
const SCORE_3_PREFIXES = ["dental", "dentistry", "care", "service", "staff", "billing", "admin2"];
const SCORE_2_PREFIXES = ["info", "contact", "admin", "general", "inquiry", "inquiries", "mail", "email", "new"];
const SCORE_1_PREFIXES = ["hello", "hi", "team", "web", "website", "here", "us", "media", "support"];

function isDomainRelevant(emailDomain, clinicWebsite) {
  if (!clinicWebsite) return true;
  if (MAJOR_PROVIDERS.has(emailDomain)) return true;
  try {
    const siteDomain = new URL(clinicWebsite).hostname.replace(/^www\./i, "").toLowerCase();
    return (
      emailDomain === siteDomain ||
      emailDomain.endsWith("." + siteDomain) ||
      siteDomain.endsWith("." + emailDomain)
    );
  } catch {
    return true;
  }
}

/**
 * Scores an email address on a 1-10 raw scale.
 * Returns { score (1-3 legacy), rawScore (1-10), confidence, isNamed } or null if blocked.
 */
export function scoreEmail(email, clinicWebsite = "") {
  const e = (email || "").toLowerCase().trim();
  const atIdx = e.lastIndexOf("@");
  if (atIdx === -1) return null;

  const local = e.slice(0, atIdx);
  const domain = e.slice(atIdx + 1);

  if (BLOCKED_LOCALS.has(local)) return null;
  if (BLOCKED_DOMAIN_PATTERNS.some(p => domain.includes(p))) return null;

  const VENDOR_KW = ["write", "content", "seo", "marketing", "wordpress", "developer", "design", "agency", "freelance"];
  if (VENDOR_KW.some(k => local.includes(k))) return null;

  if (clinicWebsite && !isDomainRelevant(domain, clinicWebsite)) return null;

  let rawScore;
  let isNamed = false;

  // All known-prefix checks MUST run before the "single-word-name" heuristic,
  // otherwise "reception", "smile", "care" etc. get misclassified as named.

  if (DR_PATTERNS.some(re => re.test(local))) {
    rawScore = 10; isNamed = true;                                          // dr.anna@
  } else if (FULLNAME_PATTERNS.some(re => re.test(local))) {
    rawScore = 9; isNamed = true;                                           // anna.smith@
  } else if (DR_NODOT_PATTERNS.some(re => re.test(local))) {
    rawScore = 7; isNamed = true;                                           // drsmith@
  } else if (HIGH_ROLE.has(local)) {
    rawScore = 6;                                                            // owner@, dentist@
  } else if (SCORE_5_PREFIXES.some(p => local === p || local.startsWith(p + "-") || local.startsWith(p + "."))) {
    rawScore = 5;                                                            // reception@, appointments@
  } else if (SCORE_4_PREFIXES.some(p => local === p || local.startsWith(p + "-") || local.startsWith(p + "."))) {
    rawScore = 4;                                                            // office@, clinic@
  } else if (SCORE_3_PREFIXES.some(p => local === p || local.startsWith(p + "-") || local.startsWith(p + "."))) {
    rawScore = 3;                                                            // dental@, care@
  } else if (SCORE_2_PREFIXES.some(p => local === p)) {
    rawScore = 2;                                                            // info@, contact@
  } else if (SCORE_1_PREFIXES.some(p => local === p)) {
    rawScore = 1;                                                            // hello@, team@
  } else if (/^[a-z]{4,}$/.test(local) && !GENERIC_LOCALS_SET.has(local)) {
    // Single word ≥4 chars, not a known generic — likely a given name (e.g. john@, anna@)
    rawScore = 8; isNamed = true;
  } else {
    // Short or unrecognised — treat as low-grade generic
    rawScore = local.length >= 4 ? 3 : 2;
  }

  // Map to legacy 1/2/3 score and confidence tier
  let score, confidence;
  if (rawScore >= 7) { score = 3; confidence = "high"; }
  else if (rawScore >= 4) { score = 2; confidence = "medium"; }
  else { score = 1; confidence = "low"; }

  return { score, rawScore, confidence, isNamed };
}

// ─── Contact name extraction from email (UPGRADE 7) ──────────────────────────

/**
 * Extracts a human-readable contact name from a named email address.
 * dr.anna@clinic.com        → "Dr. Anna"
 * dr.anna.smith@clinic.com  → "Dr. Anna Smith"
 * anna.smith@clinic.com     → "Anna Smith"
 * drsmith@clinic.com        → "Dr. Smith"
 * Returns null for generic emails.
 */
export function extractContactName(email) {
  if (!email) return null;
  const local = email.split("@")[0].toLowerCase();

  const capitalize = s => s.charAt(0).toUpperCase() + s.slice(1);

  // dr.firstname or dr.firstname.lastname
  const drDot = local.match(/^dr\.([a-z]+)(?:\.([a-z]+))?$/);
  if (drDot) {
    const first = capitalize(drDot[1]);
    const last = drDot[2] ? " " + capitalize(drDot[2]) : "";
    return `Dr. ${first}${last}`;
  }

  // dre.firstname (French)
  const dreFr = local.match(/^dre\.([a-z]+)(?:\.([a-z]+))?$/);
  if (dreFr) {
    const first = capitalize(dreFr[1]);
    const last = dreFr[2] ? " " + capitalize(dreFr[2]) : "";
    return `Dre. ${first}${last}`;
  }

  // drsmith (no dot)
  const drNoDot = local.match(/^dr([a-z]{3,})$/);
  if (drNoDot) return `Dr. ${capitalize(drNoDot[1])}`;

  // dresmith (French no dot)
  const dreNoDot = local.match(/^dre([a-z]{3,})$/);
  if (dreNoDot) return `Dre. ${capitalize(dreNoDot[1])}`;

  // firstname.lastname
  const dotName = local.match(/^([a-z]{3,})\.([a-z]{3,})$/);
  if (dotName) return `${capitalize(dotName[1])} ${capitalize(dotName[2])}`;

  // firstname-lastname
  const dashName = local.match(/^([a-z]{3,})-([a-z]{3,})$/);
  if (dashName) return `${capitalize(dashName[1])} ${capitalize(dashName[2])}`;

  return null;
}

// ─── HTML utilities ────────────────────────────────────────────────────────────

const EMAIL_RE = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g;

function uniq(arr) {
  return Array.from(new Set((arr || []).filter(Boolean)));
}

function sameHost(baseUrl, candidateUrl) {
  try {
    const b = new URL(baseUrl).hostname.replace(/^www\./i, "");
    const c = new URL(candidateUrl).hostname.replace(/^www\./i, "");
    return b === c;
  } catch { return false; }
}

function stripHash(url) {
  try { const u = new URL(url); u.hash = ""; return u.href; } catch { return url; }
}

function baseDomain(websiteUrl) {
  try { return new URL(websiteUrl).hostname.replace(/^www\./i, "").toLowerCase(); } catch { return ""; }
}

// ─── HTTP ─────────────────────────────────────────────────────────────────────

async function fetchHtml(url, timeout = TIMEOUT_MS) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(url, {
      headers: { ...DEFAULT_HEADERS, "User-Agent": pickUA() },
      redirect: "follow",
      signal: ctrl.signal,
    });
    if (!res.ok) return null;
    const ct = res.headers.get("content-type") || "";
    if (!ct.includes("text/html") && !ct.includes("application/xhtml")) return null;
    return await res.text();
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

// ─── Email extractors from HTML ───────────────────────────────────────────────

function stripNonContent(html) {
  return (html || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ");
}

function extractFromText(text) {
  if (!text) return [];
  const clean = stripNonContent(text);
  const decoded = clean
    .replace(/\s*\[at\]\s*/gi, "@").replace(/\s*\(at\)\s*/gi, "@")
    .replace(/\s+at\s+/gi, "@")
    .replace(/\s*\[dot\]\s*/gi, ".").replace(/\s*\(dot\)\s*/gi, ".");
  return [...(decoded.match(EMAIL_RE) || [])];
}

function extractFromMailto($) {
  const emails = [];
  $("a[href^='mailto:'], a[href^='MAILTO:']").each((_, el) => {
    let raw = ($(el).attr("href") || "").replace(/^mailto:/i, "").split("?")[0].trim();
    try { raw = decodeURIComponent(raw); } catch {}
    raw.split(",").forEach(e => { if (e.trim()) emails.push(e.trim()); });
  });
  return emails;
}

function extractFromJsonLd($) {
  const emails = [];
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      const json = JSON.parse($(el).html() || "{}");
      const nodes = Array.isArray(json["@graph"]) ? json["@graph"] : [json];
      for (const node of nodes) {
        if (node.email) emails.push(String(node.email));
        if (node.contactPoint?.email) emails.push(String(node.contactPoint.email));
        if (Array.isArray(node.contactPoint)) node.contactPoint.forEach(cp => { if (cp.email) emails.push(String(cp.email)); });
        if (Array.isArray(node.employee)) node.employee.forEach(emp => { if (emp.email) emails.push(String(emp.email)); });
        if (Array.isArray(node.member)) node.member.forEach(m => { if (m.email) emails.push(String(m.email)); });
      }
    } catch {}
  });
  return emails;
}

function extractFromHcard($) {
  const emails = [];
  $('[itemprop="email"]').each((_, el) => {
    const href = $(el).attr("href") || "";
    const content = $(el).attr("content") || $(el).text() || "";
    if (href.startsWith("mailto:")) {
      emails.push(href.replace(/^mailto:/i, "").split("?")[0].trim());
    } else if (content.includes("@")) {
      const m = content.match(EMAIL_RE);
      if (m) emails.push(...m);
    }
  });
  $('[class*="email"]').each((_, el) => {
    const href = $(el).attr("href") || "";
    const text = $(el).text().trim();
    if (href.startsWith("mailto:")) {
      emails.push(href.replace(/^mailto:/i, "").split("?")[0].trim());
    } else if (text.includes("@")) {
      const m = text.match(EMAIL_RE);
      if (m) emails.push(...m);
    }
  });
  $("[data-email]").each((_, el) => {
    const val = $(el).attr("data-email") || "";
    if (val.includes("@")) emails.push(val.trim());
  });
  return emails;
}

function extractFromMeta($) {
  const emails = [];
  $('meta[content*="@"]').each((_, el) => {
    const content = $(el).attr("content") || "";
    (content.match(EMAIL_RE) || []).forEach(e => emails.push(e));
  });
  $('meta[name="email"], meta[name="contact-email"], meta[property="og:email"]').each((_, el) => {
    const content = $(el).attr("content") || "";
    if (content.includes("@")) emails.push(content.trim());
  });
  return emails;
}

function allEmailsFromPage(html) {
  if (!html) return [];
  const $ = cheerio.load(html);
  return uniq([
    ...extractFromMailto($),
    ...extractFromJsonLd($),
    ...extractFromHcard($),
    ...extractFromMeta($),
    ...extractFromText(html),
  ]).map(e => e.trim().toLowerCase()).filter(e => e.includes("@") && e.includes("."));
}

// ─── Nav-link discovery for team/doctor pages (UPGRADE 3) ─────────────────────

const NAV_KEYWORDS = ["about", "team", "staff", "doctor", "dentist", "hygienist", "our-team", "meet", "provider", "equipe", "médecin", "praticien"];

function findNavLinks(html, baseUrl) {
  if (!html) return [];
  const $ = cheerio.load(html);
  const found = [];
  const seen = new Set();

  $("a").each((_, el) => {
    const href = ($(el).attr("href") || "").trim();
    const text = ($(el).text() || "").toLowerCase().trim();
    if (!href || /^(mailto:|tel:|#|javascript:)/i.test(href)) return;

    const hrefLower = href.toLowerCase();
    const isNav = NAV_KEYWORDS.some(kw => hrefLower.includes(kw) || text.includes(kw));
    if (!isNav) return;

    try {
      const abs = stripHash(new URL(href, baseUrl).href);
      if (sameHost(baseUrl, abs) && !seen.has(abs)) {
        seen.add(abs);
        found.push(abs);
      }
    } catch {}
  });
  return found.slice(0, 5);
}

// ─── Contact page finder ──────────────────────────────────────────────────────

export async function findContactPageUrl(websiteUrl) {
  try {
    const site = new URL(websiteUrl).href;
    const html = await fetchHtml(site);
    if (!html) return null;
    const $ = cheerio.load(html);
    const candidates = [];

    $("a").each((_, el) => {
      const href = ($(el).attr("href") || "").trim();
      const text = ($(el).text() || "").toLowerCase();
      if (!href) return;
      const isContact = href.toLowerCase().includes("contact") ||
        text.includes("contact") || text.includes("contactez") ||
        text.includes("nous joindre") || text.includes("get in touch");
      if (!isContact) return;
      try {
        const abs = stripHash(new URL(href, site).href);
        if (sameHost(site, abs)) candidates.push(abs);
      } catch {}
    });

    return candidates.find(u => u.toLowerCase().includes("/contact")) || candidates[0] || null;
  } catch {
    return null;
  }
}

// ─── Website deep scan (UPGRADE 3) ────────────────────────────────────────────

/**
 * Scans the website for emails:
 * homepage → contact (discovered via nav) → well-known paths → nav-discovered team/doctor pages
 * Returns raw email strings (unscored, deduplicated).
 */
export async function findEmailsForWebsite(websiteUrl, { maxPages = 10 } = {}) {
  try {
    const site = new URL(websiteUrl).href;
    const visited = new Set();
    const allEmails = [];
    let homepageHtml = null;

    async function scan(url) {
      const u = stripHash(url);
      if (!u || visited.has(u) || !sameHost(site, u)) return null;
      visited.add(u);
      const html = await fetchHtml(u);
      if (html) allEmails.push(...allEmailsFromPage(html));
      return html;
    }

    // 1. Homepage
    homepageHtml = await scan(site);

    // 2. Contact page discovered from homepage
    const contactUrl = await findContactPageUrl(site);
    if (contactUrl) await scan(contactUrl);

    // 3. Well-known paths — team/doctor pages first (named email hotspots)
    const base = new URL(site);
    const wellKnown = [
      "/team", "/our-team", "/meet-the-team", "/meet-us",
      "/our-doctors", "/doctors", "/our-dentists", "/dentists",
      "/staff", "/dentist", "/about", "/about-us", "/a-propos",
      "/contact", "/contact-us", "/contactez-nous",
    ];
    for (const p of wellKnown) {
      if (visited.size >= maxPages) break;
      await scan(new URL(p, base).href);
    }

    // 4. Nav-discovered links (UPGRADE 3 — follow internal nav links)
    if (homepageHtml && visited.size < maxPages) {
      const navLinks = findNavLinks(homepageHtml, site);
      for (const link of navLinks) {
        if (visited.size >= maxPages) break;
        await scan(link);
      }
    }

    return uniq(allEmails);
  } catch {
    return [];
  }
}

// ─── DuckDuckGo search helper ─────────────────────────────────────────────────

async function searchDDG(query, websiteUrl = "") {
  if (!query) return [];
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": pickUA(),
        Accept: "text/html",
        "Accept-Language": "en-CA,en;q=0.9",
      },
      redirect: "follow",
      signal: AbortSignal.timeout(12_000),
    });
    if (!res.ok) return [];
    const html = await res.text();
    return uniq(
      extractFromText(html)
        .map(e => e.toLowerCase().trim())
        .filter(e => scoreEmail(e, websiteUrl) !== null)
    );
  } catch {
    return [];
  }
}

// Returns raw DDG HTML (for link/snippet extraction)
async function fetchDDGHtml(query) {
  if (!query) return "";
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": pickUA(), Accept: "text/html", "Accept-Language": "en-CA,en;q=0.9" },
      redirect: "follow",
      signal: AbortSignal.timeout(12_000),
    });
    if (!res.ok) return "";
    return await res.text();
  } catch { return ""; }
}

// Extract LinkedIn /in/ profile slugs from DDG search HTML
// DDG encodes URLs in hrefs but shows them as text — match both
function extractLinkedInSlugs(html) {
  const seen = new Set();
  const results = [];

  // Decode URL-encoding so %2F → / and %2E → .
  let decoded = html;
  try { decoded = decodeURIComponent(html.replace(/\+/g, " ")); } catch {}
  const combined = html + " " + decoded;

  const re = /linkedin\.com(?:%2F|\/+)in(?:%2F|\/)([a-z0-9][a-z0-9%\-]{1,60})/gi;
  let m;
  while ((m = re.exec(combined)) !== null) {
    let slug = m[1].toLowerCase();
    try { slug = decodeURIComponent(slug); } catch {}
    slug = slug.replace(/-+$/, "").replace(/[^a-z0-9\-]/g, "-").replace(/-+/g, "-");
    if (!slug || slug.length < 3 || seen.has(slug)) continue;
    // Filter out non-person paths
    if (/^(company|school|groups?|jobs?|learning|pulse|feed|search|in$)/.test(slug)) continue;
    seen.add(slug);
    results.push(slug);
  }
  return results.slice(0, 4);
}

// Guess first/last name from a LinkedIn slug like "anna-smith-dds-1234b5"
function nameFromLinkedInSlug(slug) {
  const parts = slug
    .replace(/-\d+[a-z]*$/, "")    // strip trailing ID like -1234b5
    .replace(/-(dds|dmd|bds|msc|phd|dr|mba)$/i, "") // strip credentials
    .split("-")
    .filter(p => p.length > 1 && !/^\d+$/.test(p));
  if (parts.length < 2) return null;
  return { first: parts[0], last: parts[parts.length - 1] };
}

// Extract dentist name from an About/Team page HTML
function extractDentistNameFromHtml(html, clinicName = "") {
  if (!html) return null;
  const $ = cheerio.load(html);

  // Look for "Dr. Firstname Lastname" patterns near headings
  const candidates = [];
  $("h1, h2, h3, h4, .doctor-name, .team-member-name, .staff-name, [class*='dentist'], [class*='doctor']").each((_, el) => {
    const text = $(el).text().trim();
    const m = text.match(/\b(Dr\.?|Dre\.?)\s+([A-Z][a-z]{1,15})\s+([A-Z][a-z]{1,20})/);
    if (m) candidates.push({ first: m[2].toLowerCase(), last: m[3].toLowerCase() });
    const m2 = text.match(/\b(Dr\.?|Dre\.?)\s+([A-Z][a-z]{1,20})\b/);
    if (m2 && !m) candidates.push({ first: m2[2].toLowerCase(), last: null });
  });

  if (candidates.length > 0) return candidates[0];

  // Fallback: scan body text for Dr. patterns
  const bodyText = $("body").text();
  const m = bodyText.match(/\b(Dr\.?|Dre\.?)\s+([A-Z][a-z]{1,15})\s+([A-Z][a-z]{1,20})/);
  if (m) return { first: m[2].toLowerCase(), last: m[3].toLowerCase() };

  const m2 = bodyText.match(/\b(Dr\.?|Dre\.?)\s+([A-Z][a-z]{1,20})\b/);
  if (m2) return { first: m2[2].toLowerCase(), last: null };

  return null;
}

// Extract likely dentist name from clinic name string
// "Dr. Smith Dental" → { first: null, last: "smith" }
// "Smith & Jones Dental" → null
function nameFromClinicName(clinicName) {
  if (!clinicName) return null;
  const m = clinicName.match(/\b(?:Dr\.?|Dre\.?)\s+([A-Z][a-z]{1,15})(?:\s+([A-Z][a-z]{1,20}))?/i);
  if (!m) return null;
  return { first: m[1].toLowerCase(), last: m[2] ? m[2].toLowerCase() : null };
}

// ─── Hunter.io domain search (UPGRADE 1) ─────────────────────────────────────

/**
 * Queries Hunter.io domain-search API.
 * Returns array of { email, rawScore, confidence, source, isNamed, hunterConfidence, contactName }
 * sorted best-first.
 */
async function searchHunter(domain) {
  const key = HUNTER_API_KEY();
  if (!key) return [];

  try {
    const url = `https://api.hunter.io/v2/domain-search?domain=${encodeURIComponent(domain)}&api_key=${encodeURIComponent(key)}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return [];
    const json = await res.json();

    const emails = (json?.data?.emails || []);
    if (!emails.length) return [];

    return emails
      .map(entry => {
        const email = (entry.value || "").toLowerCase().trim();
        if (!email.includes("@")) return null;
        const scored = scoreEmail(email);
        if (!scored) return null;

        // If Hunter gives us first/last name, that's extra signal
        const hasName = entry.first_name || entry.last_name;
        const hunterConf = entry.confidence || 0;

        // Boost score if Hunter says "personal" type and gives a name
        let { rawScore, confidence, isNamed } = scored;
        if (entry.type === "personal" && hasName) {
          rawScore = Math.max(rawScore, 9);
          isNamed = true;
          confidence = "high";
        } else if (entry.type === "personal") {
          rawScore = Math.max(rawScore, 7);
          isNamed = true;
          confidence = "high";
        }

        const contactName = extractContactName(email) ||
          (hasName ? [entry.first_name, entry.last_name].filter(Boolean).map(n => n.charAt(0).toUpperCase() + n.slice(1)).join(" ") : null);

        return {
          email,
          rawScore,
          score: rawScore >= 7 ? 3 : rawScore >= 4 ? 2 : 1,
          confidence: rawScore >= 7 ? "high" : rawScore >= 4 ? "medium" : "low",
          isNamed,
          source: "hunter",
          hunterConfidence: hunterConf,
          contactName: contactName || null,
        };
      })
      .filter(Boolean)
      .sort((a, b) => b.rawScore - a.rawScore);
  } catch {
    return [];
  }
}

// ─── MX verification ─────────────────────────────────────────────────────────

const _mxCache = new Map();

async function hasMxRecords(domain) {
  if (_mxCache.has(domain)) return _mxCache.get(domain);
  try {
    const records = await dns.resolveMx(domain);
    const ok = records && records.length > 0;
    _mxCache.set(domain, ok);
    return ok;
  } catch (err) {
    const code = err?.code || "";
    // Network error — give benefit of the doubt
    const ok = code !== "ENOTFOUND" && code !== "ENODATA";
    _mxCache.set(domain, ok);
    return ok;
  }
}

async function verifyEmailMx(email) {
  const domain = email.split("@")[1];
  if (!domain) return false;
  return hasMxRecords(domain);
}

// ─── Pick best email from a list ──────────────────────────────────────────────

function pickBestEmail(emails, websiteUrl = "") {
  if (!emails || emails.length === 0) return { email: null, confidence: "none", score: 0, rawScore: 0 };
  let best = null;
  let bestRaw = 0;
  for (const e of emails) {
    const result = scoreEmail(e, websiteUrl);
    if (!result) continue;
    if (result.rawScore > bestRaw) {
      bestRaw = result.rawScore;
      best = { email: e, ...result };
    }
  }
  return best || { email: null, confidence: "none", score: 0, rawScore: 0 };
}

// ─── Main: find best email with confidence (all methods) ─────────────────────

/**
 * Finds the best real email for a clinic using all available methods.
 * Stops as soon as a high-confidence result is found.
 *
 * @param {string} websiteUrl
 * @param {{ clinicName?, city?, useDdgFallback?, useHunter? }} opts
 * @returns {Promise<{
 *   email: string|null,
 *   confidence: "high"|"medium"|"low"|"none",
 *   score: number,
 *   rawScore: number,
 *   source: string,
 *   isNamed: boolean,
 *   contactName: string|null,
 *   hunterConfidence?: number,
 *   allFound: string[],
 * }>}
 */
export async function findBestEmailWithConfidence(websiteUrl, {
  clinicName = "",
  city = "",
  useDdgFallback = true,
  useHunter = true,
  searchKeyword = "dental",
} = {}) {
  const kw = searchKeyword || "dental";
  const domain = baseDomain(websiteUrl);
  const cacheKey = domain || websiteUrl;

  // Check domain cache
  const cached = getCached(cacheKey);
  if (cached) return { ...cached, source: cached.source + " (cached)" };

  const allFound = [];
  let best = null;

  // ── METHOD 1: Hunter.io ────────────────────────────────────────────────────
  if (useHunter && HUNTER_API_KEY()) {
    const hunterResults = await searchHunter(domain);
    if (hunterResults.length > 0) {
      for (const r of hunterResults) allFound.push(r.email);
      // Verify MX for top result
      const top = hunterResults[0];
      const mxOk = await verifyEmailMx(top.email);
      if (mxOk && top.rawScore >= 4) {
        best = { ...top, allFound };
      }
    }
    if (best?.confidence === "high") {
      setCached(cacheKey, best);
      return best;
    }
    await sleep(300);
  }

  // ── METHOD 2: Website deep scan ───────────────────────────────────────────
  {
    const emails = await findEmailsForWebsite(websiteUrl, { maxPages: 10 });
    allFound.push(...emails);
    const picked = pickBestEmail(emails, websiteUrl);
    if (picked.email) {
      const mxOk = await verifyEmailMx(picked.email);
      if (mxOk) {
        const candidate = {
          ...picked,
          source: "website",
          isNamed: picked.isNamed || false,
          contactName: extractContactName(picked.email),
          allFound,
        };
        if (!best || candidate.rawScore > best.rawScore) best = candidate;
      }
    }
    if (best?.confidence === "high") {
      setCached(cacheKey, best);
      return best;
    }
  }

  if (!useDdgFallback || !clinicName) {
    const result = best || { email: null, confidence: "none", score: 0, rawScore: 0, source: "none", isNamed: false, contactName: null, allFound };
    setCached(cacheKey, result);
    return result;
  }

  // ── METHOD 3: DDG clinic search ───────────────────────────────────────────
  {
    const emails = await searchDDG(`${clinicName}${city ? " " + city : ""} ${kw} email`, websiteUrl);
    allFound.push(...emails);
    const picked = pickBestEmail(emails, websiteUrl);
    if (picked.email) {
      const mxOk = await verifyEmailMx(picked.email);
      if (mxOk) {
        const candidate = {
          ...picked,
          source: "duckduckgo-clinic",
          isNamed: picked.isNamed || false,
          contactName: extractContactName(picked.email),
          allFound,
        };
        if (!best || candidate.rawScore > best.rawScore) best = candidate;
      }
    }
    if (best?.confidence === "high") {
      setCached(cacheKey, best);
      return best;
    }
    await sleep(1_200);
  }

  // ── METHOD 4: DDG LinkedIn search (UPGRADE 2) ────────────────────────────
  {
    const emails = await searchDDG(`site:linkedin.com "${clinicName}" ${kw}`, websiteUrl);
    allFound.push(...emails);
    const picked = pickBestEmail(emails, websiteUrl);
    if (picked.email) {
      const mxOk = await verifyEmailMx(picked.email);
      if (mxOk) {
        const candidate = {
          ...picked,
          source: "linkedin",
          isNamed: picked.isNamed || false,
          contactName: extractContactName(picked.email),
          allFound,
        };
        if (!best || candidate.rawScore > best.rawScore) best = candidate;
      }
    }
    if (best?.confidence === "high") {
      setCached(cacheKey, best);
      return best;
    }
    await sleep(1_200);
  }

  // ── METHOD 5: DDG Google Business Profile (UPGRADE 4) ────────────────────
  {
    const emails = await searchDDG(`"${clinicName}"${city ? " " + city : ""} ${kw}`, websiteUrl);
    allFound.push(...emails);
    const picked = pickBestEmail(emails, websiteUrl);
    if (picked.email) {
      const mxOk = await verifyEmailMx(picked.email);
      if (mxOk) {
        const candidate = {
          ...picked,
          source: "google-business",
          isNamed: picked.isNamed || false,
          contactName: extractContactName(picked.email),
          allFound,
        };
        if (!best || candidate.rawScore > best.rawScore) best = candidate;
      }
    }
    if (best?.confidence === "high") {
      setCached(cacheKey, best);
      return best;
    }
    await sleep(1_200);
  }

  // ── METHOD 6: DDG Facebook search (UPGRADE 5) ────────────────────────────
  {
    const emails = await searchDDG(`"${clinicName}"${city ? " " + city : ""} ${kw} facebook email`, websiteUrl);
    allFound.push(...emails);
    const picked = pickBestEmail(emails, websiteUrl);
    if (picked.email) {
      const mxOk = await verifyEmailMx(picked.email);
      if (mxOk) {
        const candidate = {
          ...picked,
          source: "facebook",
          isNamed: picked.isNamed || false,
          contactName: extractContactName(picked.email),
          allFound,
        };
        if (!best || candidate.rawScore > best.rawScore) best = candidate;
      }
    }
    if (best?.confidence === "high") { setCached(cacheKey, best); return best; }
  }

  // ── METHOD 7: LinkedIn PhantomBuster-style name→email ────────────────────
  if (clinicName) {
    const liHtml = await fetchDDGHtml(`site:linkedin.com/in "${clinicName}" ${kw} owner`);
    const slugs = extractLinkedInSlugs(liHtml);
    for (const slug of slugs.slice(0, 2)) {
      const name = nameFromLinkedInSlug(slug);
      if (!name) continue;
      const nameQuery = `"${name.first} ${name.last || clinicName}" "${clinicName}" email`;
      const emails = await searchDDG(nameQuery, websiteUrl);
      allFound.push(...emails);
      const picked = pickBestEmail(emails, websiteUrl);
      if (picked.email) {
        const mxOk = await verifyEmailMx(picked.email);
        if (mxOk) {
          const candidate = {
            ...picked,
            source: "linkedin-name-search",
            isNamed: picked.isNamed || false,
            contactName: extractContactName(picked.email) || (name.last ? `${name.first} ${name.last}` : name.first),
            allFound,
          };
          if (!best || candidate.rawScore > best.rawScore) best = candidate;
        }
      }
      if (best?.confidence === "high") { setCached(cacheKey, best); return best; }
      await sleep(800);
    }
    await sleep(600);
  }

  // ── METHOD 8: Google Maps snippet search ──────────────────────────────────
  {
    const query = `"${clinicName}"${city ? ` "${city}"` : ""} dental email contact`;
    const emails = await searchDDG(query, websiteUrl);
    allFound.push(...emails);
    const picked = pickBestEmail(emails, websiteUrl);
    if (picked.email) {
      const mxOk = await verifyEmailMx(picked.email);
      if (mxOk) {
        const candidate = {
          ...picked,
          source: "google-maps-ddg",
          isNamed: picked.isNamed || false,
          contactName: extractContactName(picked.email),
          allFound,
        };
        if (!best || candidate.rawScore > best.rawScore) best = candidate;
      }
    }
    if (best?.confidence === "high") { setCached(cacheKey, best); return best; }
    await sleep(1_200);
  }

  // ── METHOD 9: Canadian dental directories (RCDSO / CDA / ODQ) ────────────
  {
    const dirQueries = [
      `site:rcdso.org "${clinicName}" email`,
      `site:cda-adc.ca "${clinicName}" email`,
      `site:odq.qc.ca "${clinicName}" courriel email`,
    ];
    for (const q of dirQueries) {
      const emails = await searchDDG(q, websiteUrl);
      allFound.push(...emails);
      const picked = pickBestEmail(emails, websiteUrl);
      if (picked.email) {
        const mxOk = await verifyEmailMx(picked.email);
        if (mxOk) {
          const candidate = {
            ...picked,
            source: "dental-directory",
            isNamed: picked.isNamed || false,
            contactName: extractContactName(picked.email),
            allFound,
          };
          if (!best || candidate.rawScore > best.rawScore) best = candidate;
        }
      }
      if (best?.confidence === "high") { setCached(cacheKey, best); return best; }
      await sleep(1_000);
    }
  }

  // ── METHOD 10: Yelp Canada ────────────────────────────────────────────────
  {
    const query = `site:yelp.ca "${clinicName}"${city ? ` ${city}` : ""} dental email`;
    const emails = await searchDDG(query, websiteUrl);
    allFound.push(...emails);
    const picked = pickBestEmail(emails, websiteUrl);
    if (picked.email) {
      const mxOk = await verifyEmailMx(picked.email);
      if (mxOk) {
        const candidate = {
          ...picked,
          source: "yelp",
          isNamed: picked.isNamed || false,
          contactName: extractContactName(picked.email),
          allFound,
        };
        if (!best || candidate.rawScore > best.rawScore) best = candidate;
      }
    }
    if (best?.confidence === "high") { setCached(cacheKey, best); return best; }
    await sleep(1_200);
  }

  // ── METHOD 11: Yellow Pages Canada ────────────────────────────────────────
  {
    const query = `site:yellowpages.ca "${clinicName}"${city ? ` ${city}` : ""} dental email`;
    const emails = await searchDDG(query, websiteUrl);
    allFound.push(...emails);
    const picked = pickBestEmail(emails, websiteUrl);
    if (picked.email) {
      const mxOk = await verifyEmailMx(picked.email);
      if (mxOk) {
        const candidate = {
          ...picked,
          source: "yellowpages",
          isNamed: picked.isNamed || false,
          contactName: extractContactName(picked.email),
          allFound,
        };
        if (!best || candidate.rawScore > best.rawScore) best = candidate;
      }
    }
  }

  const result = best
    ? { ...best, allFound: uniq(allFound) }
    : { email: null, confidence: "none", score: 0, rawScore: 0, source: "none", isNamed: false, contactName: null, allFound: uniq(allFound) };

  setCached(cacheKey, result);
  return result;
}

// ─── Named email pattern probing (Part 2) ─────────────────────────────────────

/**
 * Given a domain and candidate name parts, try email patterns and verify with MX + SMTP.
 * Returns the best verified named email or null.
 */
export async function probeNamedEmailPatterns(domain, { first, last }) {
  if (!domain || !first) return null;
  const patterns = [];

  if (first && last) {
    patterns.push(`dr.${first}@${domain}`);
    patterns.push(`${first}.${last}@${domain}`);
    patterns.push(`${first}@${domain}`);
    patterns.push(`dr${last}@${domain}`);
    patterns.push(`dr.${first}.${last}@${domain}`);
    patterns.push(`${last}@${domain}`);
  } else {
    patterns.push(`dr.${first}@${domain}`);
    patterns.push(`${first}@${domain}`);
    patterns.push(`dr${first}@${domain}`);
  }

  const hasMx = await hasMxRecords(domain);
  if (!hasMx) return null;

  for (const candidate of patterns) {
    const scored = scoreEmail(candidate);
    if (!scored || !scored.isNamed) continue;
    const mxOk = await verifyEmailMx(candidate);
    if (!mxOk) continue;
    // SMTP probe
    const smtpOk = await smtpProbeRcpt(candidate);
    if (smtpOk) {
      return { email: candidate, ...scored, source: "smtp-probe", contactName: extractContactName(candidate) };
    }
  }
  return null;
}

// Basic SMTP RCPT TO probe — checks if server accepts the address
async function smtpProbeRcpt(email) {
  const domain = email.split("@")[1];
  if (!domain) return false;
  try {
    const records = await dns.resolveMx(domain);
    if (!records || records.length === 0) return false;
    const mx = records.sort((a, b) => a.priority - b.priority)[0].exchange;

    return await new Promise((resolve) => {
      const socket = new net.Socket();
      let state = "greeting";
      const timer = setTimeout(() => { socket.destroy(); resolve(false); }, 8_000);
      const send = (cmd) => { try { socket.write(cmd + "\r\n"); } catch {} };
      const done = (ok) => { clearTimeout(timer); try { socket.destroy(); } catch {} resolve(ok); };

      socket.connect(25, mx);
      socket.on("data", (buf) => {
        const line = buf.toString("utf-8");
        if (state === "greeting" && line.startsWith("220")) {
          state = "ehlo"; send("EHLO clinicflowautomation.com");
        } else if (state === "ehlo" && line.includes("250")) {
          if (line.includes("250-") && !line.match(/250 /)) return; // multi-line, wait for last
          state = "mail"; send("MAIL FROM:<probe@clinicflowautomation.com>");
        } else if (state === "mail" && line.startsWith("250")) {
          state = "rcpt"; send(`RCPT TO:<${email}>`);
        } else if (state === "rcpt") {
          const ok = line.startsWith("250") || line.startsWith("251");
          state = "quit"; send("QUIT"); done(ok);
        } else if (line.match(/^[45]\d\d /) && state !== "greeting" && state !== "quit") {
          done(false);
        }
      });
      socket.on("error", () => done(false));
      socket.on("close", () => { if (state !== "quit") done(false); });
    });
  } catch { return false; }
}

export { extractDentistNameFromHtml, nameFromClinicName, fetchDDGHtml, extractLinkedInSlugs, nameFromLinkedInSlug };

// ─── Legacy shims (backward-compatible) ──────────────────────────────────────

/**
 * Returns just the best email string (no metadata).
 * Legacy callers: localDentistOutreach.js, server.js
 */
export async function findBestEmailOnWebsite(websiteUrl) {
  const { email } = await findBestEmailWithConfidence(websiteUrl, { useDdgFallback: false });
  return email;
}

// ─── Clinic name extraction ───────────────────────────────────────────────────

const TITLE_STRIP = [
  /\s*[|\-–—]\s*(dental|dentist|dentistry|clinic|office|centre|center|orthodont\w*|specialist\w*).*$/i,
  /\s*(dental|dentist|dentistry|clinic|office|centre|center)\s*$/i,
  /\s*[|\-–—]\s*home\s*$/i,
  /\s*[|\-–—]\s*welcome\s*$/i,
];

function cleanTitle(raw) {
  if (!raw) return "";
  let t = raw.trim();
  for (const re of TITLE_STRIP) t = t.replace(re, "").trim();
  t = t.replace(/[,.\-–—|]+$/, "").trim();
  return t.length > 2 ? t : "";
}

export function extractClinicNameFromPage(html) {
  if (!html) return null;
  const $ = cheerio.load(html);
  const ogSiteName = $('meta[property="og:site_name"]').attr("content") || "";
  if (ogSiteName.trim().length > 2) return cleanTitle(ogSiteName) || null;
  const title = $("title").first().text() || "";
  const cleanedTitle = cleanTitle(title);
  if (cleanedTitle.length > 2) return cleanedTitle;
  const h1 = $("h1").first().text().trim();
  if (h1.length > 2) return cleanTitle(h1) || null;
  return null;
}

export async function extractClinicName(websiteUrl) {
  try {
    const html = await fetchHtml(new URL(websiteUrl).href);
    return extractClinicNameFromPage(html);
  } catch {
    return null;
  }
}
