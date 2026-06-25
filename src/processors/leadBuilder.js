// src/processors/leadBuilder.js

function normalize(s) {
  return (s || "").toString().toLowerCase();
}

function getPainCount(it) {
  if (typeof it.painHits === "number") return it.painHits;
  if (Array.isArray(it.painSignals)) return it.painSignals.length;
  if (Array.isArray(it.painKeywords)) return it.painKeywords.length;
  return 0;
}

function getAuthor(it) {
  return it.author || it.username || it.user || it.by || null;
}

function getProfileUrl(it) {
  const a = getAuthor(it);
  if (!a) return null;
  if (it.source === "reddit") return `https://www.reddit.com/user/${a}`;
  return it.authorUrl || it.profileUrl || null;
}

function bestText(it) {
  return (it.text || it.selftext || it.title || "").toString();
}

function sentenceSnippet(text, max = 220) {
  const t = (text || "").replace(/\s+/g, " ").replace(/"/g, "'").trim();
  if (!t) return "";
  if (t.length <= max) return t;

  const cut = t.slice(0, max);
  const lastStop = Math.max(cut.lastIndexOf("."), cut.lastIndexOf("?"), cut.lastIndexOf("!"));
  if (lastStop > 80) return cut.slice(0, lastStop + 1).trim();

  const lastSpace = cut.lastIndexOf(" ");
  return (lastSpace > 80 ? cut.slice(0, lastSpace) : cut).trim() + "…";
}

// High buyer-intent keywords (people pay to fix these)
const BUYER_INTENT = [
  "ghost", "ghosted", "unpaid", "late payment", "overdue", "invoice", "invoicing",
  "scope creep", "change request", "milestone", "deposit", "contract", "proposal",
  "dispute", "payment dispute", "chargeback", "refund", "collections",
  "client won't pay", "client not paying", "paid late", "net 30", "terms"
];

// Stuff that is often NOT a buyer today (good content, but low conversion)
const LOW_INTENT = [
  "get your first client", "how do i get clients", "network", "cold email",
  "upwork is dead", "looking for advice", "resources", "what works", "how would you",
  "scraped 200k", "best way to get clients"
];

function keywordScore(text) {
  const t = normalize(text);
  let score = 0;

  for (const k of BUYER_INTENT) if (t.includes(k)) score += 2;
  for (const k of LOW_INTENT) if (t.includes(k)) score -= 3;

  return score;
}

function leadTier(totalScore) {
  if (totalScore >= 10) return "A";
  if (totalScore >= 7) return "B";
  return "C";
}

function recommendAction(it, tier) {
  if (it.source === "reddit") {
    if (tier === "A") return "comment_then_dm";
    if (tier === "B") return "comment";
    return "skip_or_comment_light";
  }
  return "manual";
}

/**
 * Buyer-first lead builder:
 * - Doesn’t require painHits if buyer-intent is strong
 * - Theme match is a bonus, not a hard gate
 */
export function buildLeads(items, chosenTheme, opts = {}) {
  const {
    max = 25,
    minBaseScore = 3.8,      // was too high for volume
    minTotalScore = 7.0,     // keeps quality
    allowCrossTheme = true
  } = opts;

  const candidates = [];

  for (const it of items) {
    const author = getAuthor(it);
    if (!author) continue; // must be contactable

    const base = Number(it.score ?? it.urgencyScore ?? 0);
    if (base < minBaseScore) continue;

    const pain = getPainCount(it);
    const text = bestText(it);
    const ks = keywordScore(`${it.title}\n${text}`);

    // Theme bonus (helps keep relevance)
    const themeBonus = it.theme === chosenTheme ? 1.5 : 0;

    // Total score: base + pain + intent + theme bonus
    const total = base + pain + ks + themeBonus;

    // Hard reject: super low intent
    if (ks <= -3) continue;

    // If cross-theme is off, require theme match
    if (!allowCrossTheme && it.theme !== chosenTheme) continue;

    // Keep only if total is decent OR it’s a very strong buyer intent
    const isStrongBuyer = ks >= 4; // invoice/dispute/ghosting etc
    if (total < minTotalScore && !isStrongBuyer) continue;

    const tier = leadTier(total);

    candidates.push({
      name: author,
      platform: it.source || "unknown",
      subreddit: it.subreddit || null,
      profileUrl: getProfileUrl(it),
      postUrl: it.url,
      postTitle: it.title,
      painSnippet: sentenceSnippet(text, 220),
      urgencyScore: Number(base.toFixed(2)),
      painHits: pain,
      intentScore: ks,
      totalLeadScore: Number(total.toFixed(2)),
      tier,
      action: recommendAction(it, tier),
      contactMethod: it.source === "reddit" ? "reddit" : "manual",
      theme: it.theme || null
    });
  }

  // Sort + dedupe by postUrl
  candidates.sort((a, b) => b.totalLeadScore - a.totalLeadScore);

  const seen = new Set();
  const out = [];
  for (const c of candidates) {
    if (!c.postUrl || seen.has(c.postUrl)) continue;
    seen.add(c.postUrl);
    out.push(c);
    if (out.length >= max) break;
  }

  return out;
}

export function personalizeLeads(leads, brandName) {
  return leads.map((l) => {
    const opener =
      l.platform === "reddit" && l.subreddit
        ? `Hey — saw your post in r/${l.subreddit}: "${l.postTitle}"`
        : `Hey ${l.name} — quick question about "${l.postTitle}"`;

    const cta =
      l.tier === "A"
        ? "Want me to generate a free Scope + Milestone + Invoice + follow-up pack for your current client?"
        : "Want a free pack for one client to see if it helps?";

    return {
      ...l,
      message: `${opener}

This part stood out:
"${l.painSnippet}"

${brandName} turns client chat into:
• 1-page scope
• deposit + milestones
• invoice-ready text
• Day 1/3/7 follow-ups

${cta}`
    };
  });
}
