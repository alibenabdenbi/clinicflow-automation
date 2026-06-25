// src/processors/leads.js
import { extractPainSignals } from "./painExtractor.js";

/**
 * Recompute painHits + painSnippet from text using your existing extractor
 * so we don't depend on upstream fields always being present.
 */
function computePainMetaFromText({ title = "", selftext = "", extra = "" }) {
  const fakeItem = {
    source: "local",
    title,
    selftext: `${selftext}\n\n${extra}`.trim(),
  };

  const [out] = extractPainSignals([fakeItem]) || [];

  const painHits =
    Number(out?.painHits ?? 0) ||
    (Array.isArray(out?.painSignals) ? out.painSignals.length : 0) ||
    (Array.isArray(out?.painMatches) ? out.painMatches.length : 0) ||
    0;

  const painSnippet =
    out?.painSnippet ||
    out?.painText ||
    out?.selftext?.slice(0, 220) ||
    `${title} ${selftext}`.slice(0, 220);

  return { painHits, painSnippet };
}

function computeIntentScore(text = "") {
  const t = (text || "").toLowerCase();

  const patterns = [
    /anyone (know|recommend)/,
    /what (tool|software|app)/,
    /looking for (a )?(tool|software|app|template)/,
    /(need|want) (help|advice|recommendation)/,
    /(client|customer).*(ghost|refus|won't pay|not pay|late)/,
    /invoice|invoicing|late fee|contract|scope creep|proposal|milestone/,
    /price|cost range|how much/,
    /recommend (a )?(service|agency|freelancer)/,
  ];

  let score = 0;
  for (const p of patterns) if (p.test(t)) score += 1;

  return Math.min(score, 4);
}

function computeUrgencyScore(item) {
  if (typeof item?.urgencyScore === "number") return item.urgencyScore;

  const t = `${item?.title || ""} ${item?.selftext || ""}`.toLowerCase();
  let u = 5.0;
  if (/(urgent|asap|immediately|today|yesterday)/.test(t)) u += 2;
  if (/(ghost|not paid|won't pay|scam|refusing payment|chargeback)/.test(t)) u += 2;
  if (/(help|advice|what should i do)/.test(t)) u += 1;
  return Math.max(0, Math.min(u, 10));
}

function pickTier(total) {
  if (total >= 11) return "A";
  if (total >= 8) return "B";
  return "C";
}

function pickAction(tier) {
  if (tier === "A") return "comment_then_dm";
  if (tier === "B") return "comment";
  return "skip";
}

function buildMessage({ item, painSnippet }) {
  const title = item?.title || "your post";
  const name = item?.author || item?.name || "there";

  return `
Hey ${name},

I saw your post: "${title}"

This part stood out:
"${(painSnippet || "").replace(/\s+/g, " ").slice(0, 220)}"

If you want, I can generate a quick “client workflow pack”:
• 1-page scope (ready to send)
• deposit + milestones
• invoice-ready terms
• Day 1/3/7 follow-ups

Want me to generate it for your situation?`
    .trim();
}

/**
 * Confidence scoring (0..1) so you can prioritize better leads.
 */
function computeConfidence({ painHits, intentScore, urgencyScore, item }) {
  const reasons = [];
  let c = 0.15;

  if (painHits >= 2) {
    c += 0.20;
    reasons.push("multiple pain signals");
  }
  if (intentScore >= 2) {
    c += 0.25;
    reasons.push("question/buyer-intent language");
  }
  if (urgencyScore >= 7) {
    c += 0.10;
    reasons.push("high urgency language");
  }

  // bonus: source quality heuristics
  const src = (item?.source || "").toLowerCase();
  if (src === "reddit" || src === "indiehackers") {
    c += 0.10;
    reasons.push("community lead source");
  }
  if (src === "wordpress") {
    c -= 0.05;
    reasons.push("plugin review source (lower buyer fit)");
  }

  // has a real person name/author
  const hasName = Boolean(item?.author || item?.name);
  if (hasName) {
    c += 0.05;
    reasons.push("has identifiable author/name");
  }

  c = Math.max(0, Math.min(1, Number(c.toFixed(2))));
  return { confidenceScore: c, confidenceReasons: reasons };
}

/**
 * Basic leads generator (stable).
 */
export function generateLeads({ items = [], chosenTheme = null, maxLeads = 25 }) {
  const leads = [];

  for (const it of items || []) {
    if (chosenTheme && it?.theme !== chosenTheme) continue;

    const title = it?.title || "";
    const selftext = it?.selftext || "";
    const extra = it?.painSnippet || "";

    const recomputed = computePainMetaFromText({ title, selftext, extra });

    const upstreamPainHits =
      Number(it?.painHits ?? 0) ||
      (Array.isArray(it?.painSignals) ? it.painSignals.length : 0) ||
      0;

    const painHits = Math.max(upstreamPainHits, recomputed.painHits);
    const painSnippet = it?.painSnippet || recomputed.painSnippet;

    const intentScore =
      typeof it?.intentScore === "number"
        ? it.intentScore
        : computeIntentScore(`${title}\n${selftext}\n${painSnippet}`);

    const urgencyScore = computeUrgencyScore(it);
    const totalLeadScore = Number((urgencyScore + painHits + intentScore).toFixed(2));

    const tier = pickTier(totalLeadScore);
    const action = pickAction(tier);
    if (action === "skip") continue;        // totalLeadScore < 8
    if (totalLeadScore < 9) continue;       // drop weak Tier B — only keep score >= 9

    leads.push({
      name: it?.author || it?.name || "unknown",
      platform: it?.source || "unknown",
      subreddit: it?.subreddit || null,
      profileUrl:
        it?.profileUrl ||
        (it?.source === "reddit" && it?.author ? `https://www.reddit.com/user/${it.author}` : null),
      postUrl: it?.url || it?.postUrl || null,
      postTitle: title,
      painSnippet,
      urgencyScore: Number(urgencyScore.toFixed(2)),
      painHits,
      intentScore,
      totalLeadScore,
      tier,
      action,
      contactMethod: (it?.source === "reddit" ? "reddit" : it?.source) || "unknown",
      theme: it?.theme || null,
      message: buildMessage({ item: it, painSnippet }),
    });
  }

  leads.sort((a, b) => (b.totalLeadScore || 0) - (a.totalLeadScore || 0));
  return leads.slice(0, maxLeads);
}

/**
 * Advanced wrapper (so main.js can call it).
 * Adds confidence + optional enrichment hook later.
 */
export async function generateLeadsAdvanced({
  items = [],
  chosenTheme = null,
  maxLeads = 25,
  enableConfidence = true,
  enableEnrichment = false, // reserved for later
} = {}) {
  const leads = generateLeads({ items, chosenTheme, maxLeads });

  if (!enableConfidence && !enableEnrichment) return leads;

  return leads.map((l) => {
    const { confidenceScore, confidenceReasons } = enableConfidence
      ? computeConfidence({
          painHits: l.painHits,
          intentScore: l.intentScore,
          urgencyScore: l.urgencyScore,
          item: { source: l.platform, author: l.name },
        })
      : { confidenceScore: null, confidenceReasons: [] };

    return {
      ...l,
      confidenceScore,
      confidenceReasons,
      // enableEnrichment: later we can add website/contact discovery for local clinics
    };
  });
}