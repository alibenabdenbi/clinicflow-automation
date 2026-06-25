// src/processors/businessScorer.js

function safeStr(v) {
  return (v ?? "").toString();
}

function includesAny(haystack, arr) {
  const h = safeStr(haystack).toLowerCase();
  return arr.some((x) => h.includes(x));
}

export function scoreBusinessLead(biz = {}) {
  const name = safeStr(biz.name);
  const website = safeStr(biz.website);
  const category = safeStr(biz.category);
  const city = safeStr(biz.city);

  let score = 0;
  const reasons = [];

  // Target: clinics/dentists
  if (includesAny(category, ["dent", "clinic", "dental", "orthodont", "hygien"])) {
    score += 6;
    reasons.push("clinic category match");
  }

  // Name signal
  if (includesAny(name, ["clinic", "dental", "dentist", "centre", "center"])) {
    score += 3;
    reasons.push("name indicates clinic");
  }

  // Website exists
  if (website.startsWith("http")) {
    score += 2;
    reasons.push("has website");
  }

  // City exists
  if (city.trim().length > 1) {
    score += 1;
    reasons.push("has city");
  }

  // Cap and tier
  score = Math.max(0, Math.min(10, Number(score.toFixed(2))));
  const tier = score >= 8 ? "A" : score >= 5 ? "B" : "C";

  return {
    ...biz,
    score,
    tier,
    reasons,
  };
}