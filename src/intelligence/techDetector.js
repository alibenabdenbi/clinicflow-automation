// src/intelligence/techDetector.js
// Next-level clinic tech detection:
//   - Follows booking links to identify platform from destination URL
//   - Scans page source for hidden signals (scripts, iframes, comments)
//   - Detects VoIP phone systems, live chat, SMS, patient portals
//   - Opportunity scoring for ClinicFlow prospecting
//
// Usage:
//   node src/intelligence/techDetector.js [--market dental|physio|all] [--limit N] [--google]

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import fetch from "node-fetch";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT      = path.resolve(__dirname, "../..");

// ─── CLI args ─────────────────────────────────────────────────────────────────

const MARKET_ARG = (() => {
  const i = process.argv.indexOf("--market");
  return i !== -1 ? process.argv[i + 1] : "all";
})();

const LIMIT_ARG = (() => {
  const i = process.argv.indexOf("--limit");
  return i !== -1 ? Number(process.argv[i + 1]) : Infinity;
})();

const ENABLE_GOOGLE = process.argv.includes("--google");

// ─── Market paths ──────────────────────────────────────────────────────────────

const MARKET_PATHS = {
  dental: path.join(ROOT, "data", "outreach.localDentists.json"),
  physio: path.join(ROOT, "data", "outreach.physioClinics.json"),
};

const OUT_PATH = path.join(ROOT, "data", "intelligence", "tech-stack.json");

// ─── User agent rotation (UPGRADE 7) ─────────────────────────────────────────

const USER_AGENTS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:123.0) Gecko/20100101 Firefox/123.0",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_3_1) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.3 Safari/605.1.15",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
];

function pickUA() {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

// ─── Platform URL patterns (UPGRADE 1) ───────────────────────────────────────
// Matched against booking link destination URLs and page source

const URL_PLATFORM_PATTERNS = [
  { pattern: /jane\.app|go\.janeapp\.com|janeapp\.com/i,      name: "Jane App"          },
  { pattern: /1stoppractice\.com/i,                           name: "1-Stop Practice"   },
  { pattern: /powerdiary\.com/i,                              name: "Power Diary"       },
  { pattern: /clinicmaster\.com/i,                            name: "ClinicMaster"      },
  { pattern: /booker\.com/i,                                  name: "Booker"            },
  { pattern: /mindbodyonline\.com|mindbody\.io/i,             name: "Mindbody"          },
  { pattern: /simplepractice\.com/i,                          name: "SimplePractice"    },
  { pattern: /practicefusion\.com/i,                          name: "Practice Fusion"   },
  { pattern: /opendental\.com/i,                              name: "Open Dental"       },
  { pattern: /dentrix\.com/i,                                 name: "Dentrix"           },
  { pattern: /eaglesoft\.net/i,                               name: "Eaglesoft"         },
  { pattern: /dentimax\.com/i,                                name: "DentiMax"          },
  { pattern: /carestream\.com|carestreamdental\.com/i,        name: "Carestream"        },
  { pattern: /curve\.dental|curvedental\.com/i,               name: "Curve Dental"      },
  { pattern: /dovetailsoftware\.com/i,                        name: "Dovetail"          },
  { pattern: /freshdesk\.com/i,                               name: "Freshdesk"         },
  { pattern: /patientpop\.com/i,                              name: "PatientPop"        },
  { pattern: /zocdoc\.com/i,                                  name: "ZocDoc"            },
  { pattern: /calendly\.com/i,                                name: "Calendly"          },
  { pattern: /acuityscheduling\.com/i,                        name: "Acuity Scheduling" },
  { pattern: /squareup\.com\/(appointments|book)/i,           name: "Square"            },
  { pattern: /setmore\.com/i,                                 name: "Setmore"           },
  { pattern: /10to8\.com/i,                                   name: "10to8"             },
  { pattern: /appointy\.com/i,                                name: "Appointy"          },
  { pattern: /booksy\.com/i,                                  name: "Booksy"            },
  { pattern: /fresha\.com/i,                                   name: "Fresha"            },
  { pattern: /cliniko\.com/i,                                 name: "Cliniko"           },
  { pattern: /halaxy\.com/i,                                  name: "Halaxy"            },
  { pattern: /nookal\.com/i,                                  name: "Nookal"            },
  { pattern: /totalrecall\.ca/i,                              name: "Total Recall"      },
  { pattern: /tracker\.pt|trackerpt\.com/i,                   name: "Tracker"           },
  { pattern: /physiotools\.com/i,                             name: "Physiotools"       },
  { pattern: /pteverywhere\.com/i,                            name: "PT Everywhere"     },
  { pattern: /mogo\.ca|mogocloud/i,                           name: "Mogo"              },
  { pattern: /cleardent\.com/i,                               name: "Cleardent"         },
  { pattern: /powerpractice\.com/i,                           name: "Power Practice"    },
  { pattern: /dentalhq\.com/i,                                name: "DentalHQ"          },
  { pattern: /practiceweb\.ca/i,                              name: "PracticeWeb"       },
];

// ─── Booking link keywords (UPGRADE 1) ────────────────────────────────────────

const BOOKING_KEYWORDS = [
  "book", "appointment", "schedule", "reserve",
  "réserver", "rendez-vous", "booking", "réservation",
];

// ─── Chat / communication tools (UPGRADE 5) ───────────────────────────────────

const CHAT_TOOLS = [
  { name: "Intercom",   signals: ["intercom.io", "widget.intercom", "intercomSettings"] },
  { name: "Drift",      signals: ["drift.com", "js.driftt.com", "driftConfig"] },
  { name: "Tidio",      signals: ["tidio.com", "code.tidio.co"] },
  { name: "LiveChat",   signals: ["livechatinc.com", "cdn.livechatinc"] },
  { name: "Freshchat",  signals: ["freshchat.com", "wchat.freshchat.com"] },
  { name: "Crisp",      signals: ["crisp.chat", "client.crisp.chat"] },
  { name: "Zendesk",    signals: ["zopim.com", "zendesk.com/embeddable"] },
  { name: "HubSpot",    signals: ["js.hs-scripts.com", "hubspot.com/conversations"] },
  { name: "Tawk.to",    signals: ["tawk.to", "embed.tawk.to"] },
];

// ─── Reviews platforms (UPGRADE 5) ────────────────────────────────────────────

const REVIEWS_TOOLS = [
  { name: "Google Reviews", signals: ["maps.googleapis.com", "google.com/maps/embed", "google review", "write a review"] },
  { name: "Birdeye",        signals: ["birdeye.com", "birdeye widget"] },
  { name: "Podium",         signals: ["podium.com", "reviews.podium"] },
  { name: "Reputation.com", signals: ["reputation.com"] },
  { name: "Grade.us",       signals: ["grade.us"] },
  { name: "Yelp",           signals: ["yelp.com/biz", "yelp-widget"] },
];

// ─── VoIP signals (UPGRADE 4) ─────────────────────────────────────────────────

const VOIP_SIGNALS = [
  "openphone", "ringcentral", "grasshopper", "vonage", "8x8.com",
  "nextiva", "dialpad", "zoom phone", "zoomphone", "ooma", "aircall",
  "freshcaller", "talkdesk",
];

// ─── Online booking signals ───────────────────────────────────────────────────

const ONLINE_BOOKING_SIGNALS = [
  "book online", "book an appointment", "book now", "schedule online",
  "request appointment", "online booking", "book your appointment",
  "schedule appointment", "book a visit", "réserver en ligne",
  "prendre rendez-vous", "book a session", "book a consultation",
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function readJsonSafe(p, fb) {
  try { return JSON.parse(fs.readFileSync(p, "utf-8")); } catch { return fb; }
}

function writeJson(p, data) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(data, null, 2), "utf-8");
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ─── HTTP fetch with retry + user-agent rotation (UPGRADE 7) ─────────────────

async function fetchHtml(url, { timeout = 10_000 } = {}) {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(url, {
        headers: {
          "User-Agent": pickUA(),
          "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Accept-Language": "en-CA,en;q=0.9,fr;q=0.7",
          "Cache-Control": "no-cache",
        },
        redirect: "follow",
        signal: AbortSignal.timeout(timeout),
      });
      if (!res.ok) return { html: null, finalUrl: res.url };
      const html = await res.text();
      return { html, finalUrl: res.url };
    } catch {
      if (attempt === 0) await sleep(800);
    }
  }
  return { html: null, finalUrl: url };
}

// ─── Platform detection from URL ─────────────────────────────────────────────

function platformFromUrl(url) {
  if (!url) return null;
  for (const { pattern, name } of URL_PLATFORM_PATTERNS) {
    if (pattern.test(url)) return name;
  }
  return null;
}

// ─── Extract booking links from HTML (UPGRADE 1) ─────────────────────────────

function extractBookingLinks(html, baseUrl) {
  const links = [];
  const seen = new Set();

  // Match <a> tags — capture href and inner text
  const aTagRe = /<a(?:\s[^>]*)?\shref=["']([^"'#][^"']*?)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = aTagRe.exec(html)) !== null) {
    const rawHref = m[1].trim();
    const innerText = m[2].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").toLowerCase().trim();

    const hrefLower = rawHref.toLowerCase();
    const isBooking = BOOKING_KEYWORDS.some(kw => innerText.includes(kw) || hrefLower.includes(kw));
    if (!isBooking) continue;

    // Skip mailto/tel/anchor
    if (/^(mailto:|tel:|#|javascript:)/i.test(rawHref)) continue;

    let fullUrl = rawHref;
    if (!rawHref.startsWith("http")) {
      try { fullUrl = new URL(rawHref, baseUrl).href; } catch { continue; }
    }

    if (seen.has(fullUrl)) continue;
    seen.add(fullUrl);
    links.push({ href: fullUrl, text: innerText.slice(0, 80) });
    if (links.length >= 4) break;
  }
  return links;
}

// ─── Source-level platform detection (UPGRADE 2) ─────────────────────────────

function detectFromSource(html) {
  if (!html) return null;

  // Extract specific tag attributes for targeted matching
  const scriptSrcs   = [...html.matchAll(/<script[^>]+src=["']([^"']+)["']/gi)].map(m => m[1]);
  const iframeSrcs   = [...html.matchAll(/<iframe[^>]+src=["']([^"']+)["']/gi)].map(m => m[1]);
  const htmlComments = [...html.matchAll(/<!--([\s\S]*?)-->/g)].map(m => m[1].toLowerCase());
  const cssClasses   = [...html.matchAll(/class=["']([^"']+)["']/gi)].map(m => m[1].toLowerCase());

  // Plain-text visible mentions (e.g. "Book with Jane App", "Powered by Jane")
  const visibleText = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").toLowerCase();

  for (const { pattern, name } of URL_PLATFORM_PATTERNS) {
    for (const src of scriptSrcs) {
      if (pattern.test(src)) return { software: name, method: "script", evidence: src.slice(0, 80) };
    }
    for (const src of iframeSrcs) {
      if (pattern.test(src)) return { software: name, method: "iframe", evidence: src.slice(0, 80) };
    }
    for (const comment of htmlComments) {
      if (pattern.test(comment)) return { software: name, method: "comment" };
    }
    for (const cls of cssClasses) {
      if (pattern.test(cls)) return { software: name, method: "css-class", evidence: cls.slice(0, 40) };
    }
    // Visible text mentions — catches "Book with Jane App", "Powered by Cliniko" etc.
    if (pattern.test(visibleText)) return { software: name, method: "text-mention" };
  }
  return null;
}

// ─── Follow booking links and identify platform from URL (UPGRADE 1) ──────────

async function followBookingLinks(links) {
  for (const link of links) {
    // First check the href itself before fetching
    const directMatch = platformFromUrl(link.href);
    if (directMatch) {
      return { software: directMatch, bookingUrl: link.href, method: "booking-link" };
    }

    // Follow the link and check the final URL after redirects
    try {
      const { finalUrl } = await fetchHtml(link.href, { timeout: 8_000 });
      if (finalUrl && finalUrl !== link.href) {
        const redirectMatch = platformFromUrl(finalUrl);
        if (redirectMatch) {
          return { software: redirectMatch, bookingUrl: finalUrl, method: "booking-link-redirect" };
        }
      }
    } catch {
      // skip failed booking links
    }
  }
  return null;
}

// ─── Google Business booking check via DuckDuckGo (UPGRADE 3) ────────────────

async function checkGoogleBooking(clinicName) {
  if (!ENABLE_GOOGLE) return null;
  try {
    const q = encodeURIComponent(`site:business.google.com "${clinicName}"`);
    const { html } = await fetchHtml(`https://html.duckduckgo.com/html/?q=${q}`, { timeout: 8_000 });
    if (!html) return null;
    const hasGoogleBusiness = html.includes("business.google.com");
    // Check if the result has a Reserve/booking button indicator
    const hasReserve = /google.*reserve|reserve.*with.*google/i.test(html);
    return { found: hasGoogleBusiness, hasReserve };
  } catch {
    return null;
  }
}

// ─── Phone type detection (UPGRADE 4) ────────────────────────────────────────

function detectPhoneType(html) {
  if (!html) return "unknown";
  const lower = html.toLowerCase();
  const isVoip = VOIP_SIGNALS.some(s => lower.includes(s));
  const hasPhone = /tel:[+\d]/.test(html) || /\(\d{3}\)\s*\d{3}[-.\s]\d{4}/.test(html);
  if (isVoip) return "voip";
  if (hasPhone) return "landline";
  return "unknown";
}

// ─── Communication tools detection (UPGRADE 5) ────────────────────────────────

function detectCommunicationTools(html) {
  if (!html) {
    return { chatTool: null, hasSmsReminders: false, hasPatientPortal: false, reviewsPlatform: null };
  }
  const lower = html.toLowerCase();

  const chatTool = CHAT_TOOLS.find(t => t.signals.some(s => lower.includes(s)));
  const reviewsTool = REVIEWS_TOOLS.find(t => t.signals.some(s => lower.includes(s)));

  const hasSmsReminders = [
    "sms reminder", "text reminder", "text message reminder",
    "reminder by text", "appointment reminder", "rappel par sms",
    "text us", "text message", "two-way text",
  ].some(s => lower.includes(s));

  const hasPatientPortal = [
    "patient portal", "patient login", "patient login", "my account",
    "patient access", "online portal", "portail patient",
  ].some(s => lower.includes(s));

  return {
    chatTool:         chatTool?.name || null,
    hasSmsReminders,
    hasPatientPortal,
    reviewsPlatform:  reviewsTool?.name || null,
  };
}

// ─── Opportunity scoring (UPGRADE 6) ─────────────────────────────────────────

function scoreOpportunity(tech) {
  let score = 0;
  if (!tech.bookingSoftware)   score += 3;  // No booking software — biggest gap
  if (!tech.chatTool)          score += 2;  // No live chat
  if (!tech.hasSmsReminders)   score += 2;  // No SMS reminders
  if (!tech.hasOnlineBooking)  score += 2;  // Phone only
  if (!tech.reviewsPlatform)   score += 1;  // No reviews widget
  return score; // max 10
}

// ─── Full clinic analysis ─────────────────────────────────────────────────────

async function analyzeClinic(c) {
  const { html, finalUrl } = await fetchHtml(c.website);

  if (!html) {
    return {
      clinicName:        c.clinicName,
      city:              c.city || "",
      market:            c._market || "",
      website:           c.website,
      status:            "unreachable",
      opportunityScore:  null,
      scannedAt:         new Date().toISOString(),
    };
  }

  const lower = html.toLowerCase();

  // ── UPGRADE 2: Source-level detection ─────────────────────────────────────
  const sourceDetection = detectFromSource(html);

  // ── UPGRADE 1: Follow booking links ───────────────────────────────────────
  const bookingLinks = extractBookingLinks(html, finalUrl || c.website);
  const linkDetection = await followBookingLinks(bookingLinks);

  // Resolve final booking software (link-follow wins over page-source)
  let bookingSoftware = null;
  let bookingUrl      = null;
  let detectionMethod = null;

  if (linkDetection) {
    bookingSoftware = linkDetection.software;
    bookingUrl      = linkDetection.bookingUrl;
    detectionMethod = linkDetection.method;
  } else if (sourceDetection) {
    bookingSoftware = sourceDetection.software;
    bookingUrl      = sourceDetection.evidence || null;
    detectionMethod = sourceDetection.method;
  }

  // ── Online booking present (any method) ───────────────────────────────────
  const hasOnlineBooking =
    !!bookingSoftware ||
    ONLINE_BOOKING_SIGNALS.some(s => lower.includes(s)) ||
    bookingLinks.length > 0;

  // ── UPGRADE 4 + 5 ─────────────────────────────────────────────────────────
  const phoneType = detectPhoneType(html);
  const comms     = detectCommunicationTools(html);

  // ── UPGRADE 3 (optional) ──────────────────────────────────────────────────
  const googleBooking = await checkGoogleBooking(c.clinicName);

  // ── UPGRADE 6: Score ──────────────────────────────────────────────────────
  const tech = {
    bookingSoftware,
    chatTool:       comms.chatTool,
    hasSmsReminders: comms.hasSmsReminders,
    hasOnlineBooking,
    reviewsPlatform: comms.reviewsPlatform,
  };
  const opportunityScore = scoreOpportunity(tech);

  return {
    clinicName:        c.clinicName,
    city:              c.city || "",
    market:            c._market || "",
    website:           c.website,
    status:            "scanned",
    // UPGRADE 8 fields
    bookingSoftware:   bookingSoftware || null,
    bookingUrl:        bookingUrl || null,
    hasOnlineBooking,
    hasChat:           !!comms.chatTool,
    chatTool:          comms.chatTool,
    hasSmsReminders:   comms.hasSmsReminders,
    hasPatientPortal:  comms.hasPatientPortal,
    phoneType,
    reviewsPlatform:   comms.reviewsPlatform,
    opportunityScore,
    detectionMethod,
    googleBooking:     googleBooking || undefined,
    scannedAt:         new Date().toISOString(),
  };
}

// ─── Summary report (UPGRADE 9) ───────────────────────────────────────────────

function printSummary(results) {
  const scanned = results.filter(r => r.status === "scanned");
  const n = scanned.length;
  if (n === 0) { console.log("No reachable sites to summarise."); return; }

  const pct = (x) => `${Math.round(x / n * 100)}%`;

  // Booking software tally
  const swTally = {};
  for (const r of scanned) {
    if (r.bookingSoftware) swTally[r.bookingSoftware] = (swTally[r.bookingSoftware] || 0) + 1;
  }
  const swRanking = Object.entries(swTally).sort((a, b) => b[1] - a[1]);

  const withBookingSw   = scanned.filter(r => r.bookingSoftware).length;
  const withOnline      = scanned.filter(r => r.hasOnlineBooking).length;
  const withChat        = scanned.filter(r => r.hasChat).length;
  const withSms         = scanned.filter(r => r.hasSmsReminders).length;
  const withPortal      = scanned.filter(r => r.hasPatientPortal).length;
  const withReviews     = scanned.filter(r => r.reviewsPlatform).length;
  const voipCount       = scanned.filter(r => r.phoneType === "voip").length;

  const avgScore = (scanned.reduce((s, r) => s + (r.opportunityScore ?? 0), 0) / n).toFixed(1);

  const top10 = [...scanned]
    .sort((a, b) => (b.opportunityScore ?? 0) - (a.opportunityScore ?? 0))
    .slice(0, 10);

  // Most common missing tools
  const missingTools = [];
  if (n - withBookingSw > 0) missingTools.push(`No booking software: ${n - withBookingSw} (${pct(n - withBookingSw)})`);
  if (n - withOnline > 0)    missingTools.push(`No online booking: ${n - withOnline} (${pct(n - withOnline)})`);
  if (n - withChat > 0)      missingTools.push(`No live chat: ${n - withChat} (${pct(n - withChat)})`);
  if (n - withSms > 0)       missingTools.push(`No SMS reminders: ${n - withSms} (${pct(n - withSms)})`);
  if (n - withReviews > 0)   missingTools.push(`No reviews widget: ${n - withReviews} (${pct(n - withReviews)})`);

  console.log(`\n${"═".repeat(62)}`);
  console.log(`  TECH STACK REPORT — ${n} reachable / ${results.length} scanned`);
  console.log(`${"═".repeat(62)}`);

  console.log(`\n── Presence ──────────────────────────────────────────────────`);
  console.log(`  Booking software detected:  ${withBookingSw.toString().padStart(4)} / ${n}  (${pct(withBookingSw)})`);
  console.log(`  Online booking present:     ${withOnline.toString().padStart(4)} / ${n}  (${pct(withOnline)})`);
  console.log(`  Live chat widget:           ${withChat.toString().padStart(4)} / ${n}  (${pct(withChat)})`);
  console.log(`  SMS reminders:              ${withSms.toString().padStart(4)} / ${n}  (${pct(withSms)})`);
  console.log(`  Patient portal:             ${withPortal.toString().padStart(4)} / ${n}  (${pct(withPortal)})`);
  console.log(`  Reviews widget:             ${withReviews.toString().padStart(4)} / ${n}  (${pct(withReviews)})`);
  console.log(`  VoIP phone system:          ${voipCount.toString().padStart(4)} / ${n}  (${pct(voipCount)})`);

  console.log(`\n── Booking software ranking ──────────────────────────────────`);
  if (swRanking.length === 0) {
    console.log("  No known booking software detected in this batch");
  } else {
    swRanking.forEach(([name, count], i) =>
      console.log(`  ${String(i + 1).padStart(2)}. ${name.padEnd(24)} ${String(count).padStart(4)} clinics  (${pct(count)})`)
    );
  }

  console.log(`\n── Opportunity scoring ───────────────────────────────────────`);
  console.log(`  Average opportunity score: ${avgScore} / 10`);
  console.log(`\n  Top 10 highest-opportunity clinics:`);
  top10.forEach((r, i) =>
    console.log(`  ${String(i + 1).padStart(2)}. [${r.opportunityScore}/10] ${(r.clinicName || "").slice(0, 40).padEnd(40)}  ${r.city}`)
  );

  console.log(`\n── Most common missing tools (opportunity gaps) ──────────────`);
  missingTools.forEach(t => console.log(`  • ${t}`));

  console.log(`\n── Per-market breakdown ──────────────────────────────────────`);
  const markets = [...new Set(results.map(r => r.market).filter(Boolean))];
  for (const m of markets) {
    const ms = scanned.filter(r => r.market === m);
    if (!ms.length) continue;
    const msw = ms.filter(r => r.bookingSoftware).length;
    const msAvg = (ms.reduce((s, r) => s + (r.opportunityScore ?? 0), 0) / ms.length).toFixed(1);
    console.log(`  ${m.padEnd(10)}  ${ms.length} sites | booking sw: ${msw} (${Math.round(msw/ms.length*100)}%) | avg score: ${msAvg}`);
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function run() {
  // Load clinic data
  let clinics = [];
  let queueLabel;

  if (MARKET_ARG === "all") {
    for (const [market, filePath] of Object.entries(MARKET_PATHS)) {
      if (!fs.existsSync(filePath)) continue;
      const rows = readJsonSafe(filePath, []);
      rows.forEach(r => { r._market = market; });
      clinics = clinics.concat(rows);
    }
    queueLabel = `all markets (${Object.keys(MARKET_PATHS).join(", ")})`;
  } else {
    const filePath = MARKET_PATHS[MARKET_ARG];
    if (!filePath || !fs.existsSync(filePath)) {
      console.error(`Unknown/missing market: ${MARKET_ARG}. Valid: ${Object.keys(MARKET_PATHS).join(", ")}, all`);
      process.exit(1);
    }
    clinics = readJsonSafe(filePath, []);
    clinics.forEach(r => { r._market = MARKET_ARG; });
    queueLabel = `${MARKET_ARG} (${filePath})`;
  }

  const candidates = clinics
    .filter(c => c.website && c.clinicName)
    .slice(0, LIMIT_ARG);

  const limitNote = isFinite(LIMIT_ARG) ? ` (limited to first ${LIMIT_ARG})` : "";
  console.log(`\nTech Detector v2 — ${candidates.length} clinics${limitNote}`);
  console.log(`Market:  ${queueLabel}`);
  console.log(`Upgrades: booking-link-follow, source-scan, VoIP, chat, SMS, scoring`);
  if (ENABLE_GOOGLE) console.log(`Google Business: enabled`);
  console.log(`Delay: 3s between sites\n`);

  const results = [];

  for (let i = 0; i < candidates.length; i++) {
    const c = candidates[i];
    const label = `[${String(i + 1).padStart(candidates.length.toString().length)}/${candidates.length}]`;
    process.stdout.write(`${label} ${(c.clinicName || "").slice(0, 42).padEnd(42)} `);

    const result = await analyzeClinic(c);
    results.push(result);

    if (result.status === "unreachable") {
      console.log("✗ unreachable");
    } else {
      const parts = [];
      if (result.bookingSoftware) parts.push(`sw=${result.bookingSoftware}(${result.detectionMethod})`);
      else parts.push("no-sw");
      if (result.hasOnlineBooking) parts.push("online-booking");
      if (result.hasChat) parts.push(`chat=${result.chatTool}`);
      if (result.hasSmsReminders) parts.push("sms");
      if (result.phoneType !== "unknown") parts.push(result.phoneType);
      parts.push(`score=${result.opportunityScore}`);
      console.log(parts.join("  "));
    }

    if (i < candidates.length - 1) await sleep(3_000);
  }

  // Write bookingSoftware back to outreach records for Jane App → Variant G routing
  const softwareFound = results.filter(r => r.bookingSoftware);
  if (softwareFound.length > 0) {
    for (const [market, filePath] of Object.entries(MARKET_PATHS)) {
      if (!fs.existsSync(filePath)) continue;
      const records = readJsonSafe(filePath, []);
      let updated = 0;
      for (const result of softwareFound) {
        const idx = records.findIndex(r => r.clinicName === result.clinicName && r.website === result.website);
        if (idx !== -1 && records[idx].bookingSoftware !== result.bookingSoftware) {
          records[idx].bookingSoftware = result.bookingSoftware;
          updated++;
        }
      }
      if (updated > 0) {
        writeJson(filePath, records);
        console.log(`\n✓ bookingSoftware written to ${market} queue (${updated} records)`);
      }
    }
  }

  const output = {
    generatedAt: new Date().toISOString(),
    market: MARKET_ARG,
    totalScanned: results.length,
    reachable: results.filter(r => r.status === "scanned").length,
    clinics: results,
  };
  writeJson(OUT_PATH, output);

  printSummary(results);
  console.log(`\nSaved → ${OUT_PATH}`);
}

run().catch(e => { console.error("Tech detector failed:", e.message); process.exit(1); });
