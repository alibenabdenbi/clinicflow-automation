// src/processors/scorer.js

function sourceWeight(source) {
  const s = (source || "").toLowerCase();
  if (s === "wordpress") return 0.65;
  if (s === "hackernews") return 0.75;
  if (s === "indiehackers") return 0.9;
  if (s === "reddit") return 1.0;
  if (s === "chrome") return 0.7;
  if (s === "producthunt") return 0.85;
 if (s === "github") return 0.95;
  return 0.85;
}

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function logScore(x) {
  return Math.log10(1 + Math.max(0, x));
}

function getText(it) {
  return `${it.title || ""} ${(it.selftext || "")}`.toLowerCase();
}

function hasAny(text, keywords) {
  return keywords.some((k) => text.includes(k));
}

function countMatches(text, patterns) {
  let c = 0;
  for (const p of patterns) {
    if (p instanceof RegExp) {
      if (p.test(text)) c++;
    } else {
      if (text.includes(p)) c++;
    }
  }
  return c;
}
function isQualifiedBuyer(text = "") {
  const t = text.toLowerCase();

  const buyerSignals = [
    "client",
    "customer",
    "invoice",
    "payment",
    "leads",
    "conversion",
    "sales",
    "agency",
    "freelancer",
    "consulting",
    "ads not working",
    "need more clients",
    "late payment",
    "chargeback",
    "proposal",
  ];

  return buyerSignals.some(k => t.includes(k));
}
function computeIntentBoost(text) {
  const revenuePatterns = [
    /\$\s?\d[\d,]*(\.\d+)?\s?(k|m)?/i,
    /\b\d{1,3}\s?(k|m)\b/i,
    /\b(mrr|arr|revenue|profit|sales)\b/i,
    /\b(6\s?figures|seven\s?figures|eight\s?figures)\b/i,
    /\b(\/mo|per\s?month|monthly)\b/i,
    /\b₹\s?\d[\d,]*(\.\d+)?\b/i,
    /\b(cr|crore|lakh)\b/i
  ];
  const strongMoneyPain = [
  "not getting paid",
  "client won't pay",
  "chargeback",
  "late payment",
  "invoice overdue",
  "ghosted",
  "scope creep",
  "refund dispute",
  "need clients fast",
  "ads not converting",
  "no sales",
  "lost revenue",
];

  const revenueHit = countMatches(text, revenuePatterns);
  const revenueBoost = revenueHit > 0 ? 5 : 0;
const strongBoost = hasAny(text, strongMoneyPain) ? 8 : 0;
  const hiringKeywords = [
    "hire", "hiring", "looking to hire", "recruit", "recruiting",
    "outsourcing", "outsource", "agency", "contractor", "freelancer needed",
    "need a developer", "need help", "assistant", "va", "virtual assistant"
  ];
  const hiringBoost = hasAny(text, hiringKeywords) ? 4 : 0;

  const clientPainKeywords = [
    "can't find clients", "cant find clients", "no clients",
    "lead generation", "leads", "prospecting", "cold email", "cold dm",
    "linkedin outreach", "upwork is dead", "fiverr is dead",
    "ads not working", "facebook ads", "meta banned", "google ads",
    "no conversions", "low conversion", "conversion rate",
    "where do i find clients", "how to get clients", "client acquisition"
  ];
  const clientPainBoost = hasAny(text, clientPainKeywords) ? 6 : 0;

  const opsPainKeywords = [
    "too much admin", "overwhelmed", "burnout", "burned out",
    "manual", "spreadsheet", "excel", "copy paste", "copy/paste",
    "bottleneck", "workflow", "process", "system", "automation",
    "takes too long", "wasting time", "inefficient", "operations"
  ];
  const opsBoost = hasAny(text, opsPainKeywords) ? 4 : 0;

  const urgencyKeywords = ["urgent", "asap", "now", "immediately", "this week", "deadline"];
  const urgencyBoost = hasAny(text, urgencyKeywords) ? 2 : 0;

const total =
  revenueBoost +
  hiringBoost +
  clientPainBoost +
  opsBoost +
  urgencyBoost +
  strongBoost;

  return { revenueBoost, hiringBoost, clientPainBoost, opsBoost, urgencyBoost, intentBoost: total };
}

export function scoreSignals(items) {
  return (items || []).map((it) => {
    const up = it.ups ?? 0;
    const com = it.num_comments ?? 0;

    const engagement = (logScore(up) * 18) + (logScore(com) * 14);

    const pain = (it.painHits ?? 0) * 6;
    const b2b = (it.b2bHits ?? 0) * 7;

    const intentQ = it.hasQuestionIntent ? 10 : 0;

    const text = getText(it);

    const recurringHints = ["monthly", "weekly", "every day", "workflow", "process", "repeat", "recurring"].some((k) =>
      text.includes(k)
    ) ? 6 : 0;

    const length = (it.selftext || "").length + (it.title || "").length;
    const thinPenalty = length < 60 ? 8 : 0;

    const intentParts = computeIntentBoost(text);

    const w = sourceWeight(it.source);

    // Overall raw score
    const rawBase = engagement + pain + b2b + intentQ + recurringHints - thinPenalty;
    const raw = rawBase * w;
    const score10 = clamp(raw / 10, 0, 10);

    // Buyer-intent raw score
    const intentRaw = (pain + b2b + intentQ + recurringHints + intentParts.intentBoost) - thinPenalty;
    const intentScore10 = clamp(intentRaw / 10, 0, 10);
    if (!isQualifiedBuyer(text)) {
    return {
      ...it,
      rawScore: Number(raw.toFixed(2)),
      score: Number(score10.toFixed(2)),
      intentRaw: Number(intentRaw.toFixed(2)),
      intentScore: Number(intentScore10.toFixed(2)),
      intentBreakdown: intentParts
    };
     
  }
  });
}

// ✅ These are the exports main.js expects
export function rankTop(items, topN = 20) {
  return [...(items || [])]
    .sort((a, b) => (b.score || 0) - (a.score || 0))
    .slice(0, topN);
}

export function rankTopByIntent(items, topN = 20) {
  return [...(items || [])]
    .sort((a, b) => (b.intentScore || 0) - (a.intentScore || 0))
    .slice(0, topN);
}