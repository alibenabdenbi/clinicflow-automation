// src/intelligence/competitorAnalysis.js
// Scrapes public pricing and feature pages from competitor dental software sites.
// Run: node src/intelligence/competitorAnalysis.js

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import fetch from "node-fetch";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT      = path.resolve(__dirname, "../..");
const OUT_PATH  = path.join(ROOT, "data", "intelligence", "competitor-gaps.json");

function writeJson(p, data) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(data, null, 2), "utf-8");
}
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ─── Competitors to analyse ───────────────────────────────────────────────────

const COMPETITORS = [
  {
    name: "MaxAssist",
    url: "https://www.maxassist.com",
    pricingUrl: "https://www.maxassist.com/pricing",
    reviewsUrl: null,
    pricingSignals: ["per month", "/month", "$", "monthly", "annual"],
    featureSignals: [
      "recall", "reminder", "reactivation", "missed call", "appointment",
      "patient communication", "sms", "email", "newsletter",
    ],
    gapSignals: [
      "not included", "add-on", "additional", "upgrade required",
      "contact us for pricing", "enterprise only",
    ],
  },
  {
    name: "Jane App",
    url: "https://jane.app",
    pricingUrl: "https://jane.app/pricing",
    reviewsUrl: null,
    pricingSignals: ["per month", "/month", "$", "monthly", "per practitioner"],
    featureSignals: [
      "booking", "reminder", "waitlist", "telehealth", "charting",
      "billing", "insurance", "patient portal",
    ],
    gapSignals: [
      "not available", "coming soon", "basic plan", "add-on",
    ],
  },
  {
    name: "Dentrix",
    url: "https://www.dentrix.com",
    pricingUrl: "https://www.dentrix.com/products/dentrix",
    reviewsUrl: null,
    pricingSignals: ["per month", "contact", "$", "quote", "pricing"],
    featureSignals: [
      "appointment", "recall", "patient communication", "reminders",
      "billing", "insurance", "charting", "x-ray",
    ],
    gapSignals: [
      "add-on", "module", "additional cost", "not included", "enterprise",
    ],
  },
];

// ─── Fetch page text ──────────────────────────────────────────────────────────

async function fetchPage(url) {
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Accept": "text/html",
      },
      redirect: "follow",
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return null;
    const html  = await res.text();
    // Strip tags, collapse whitespace
    return html.replace(/<script[\s\S]*?<\/script>/gi, " ")
               .replace(/<style[\s\S]*?<\/style>/gi, " ")
               .replace(/<[^>]+>/g, " ")
               .replace(/\s+/g, " ")
               .trim()
               .slice(0, 30_000);
  } catch {
    return null;
  }
}

// ─── Extract pricing ──────────────────────────────────────────────────────────

function extractPricing(text) {
  if (!text) return [];
  // Look for patterns like $X/month, $X per month, $X/mo
  const priceRe = /\$\s*[\d,]+(?:\.\d+)?\s*(?:\/\s*(?:month|mo|user|seat|practitioner)|per\s*(?:month|user|seat|practitioner))?/gi;
  const matches = [...new Set((text.match(priceRe) || []).map(m => m.trim()))];
  return matches.slice(0, 8);
}

// ─── Extract features ─────────────────────────────────────────────────────────

function detectSignals(text, signals) {
  if (!text) return [];
  const lower = text.toLowerCase();
  return signals.filter(s => lower.includes(s.toLowerCase()));
}

// ─── Gap analysis ─────────────────────────────────────────────────────────────

// Features that ClinicFlow provides that competitors commonly lack or charge extra for
const CLINICFLOW_DIFFERENTIATORS = [
  {
    gap: "Split payment / pay-after-delivery model",
    description: "ClinicFlow charges second half only after client sees it working. Competitors require full payment upfront or monthly subscriptions.",
  },
  {
    gap: "One-time setup fee vs. monthly subscription",
    description: "Competitors charge $150–$500/month indefinitely. ClinicFlow is one-time.",
  },
  {
    gap: "Done-for-you implementation",
    description: "Competitor tools are self-serve — clinics must configure everything. ClinicFlow builds it for them.",
  },
  {
    gap: "No training required",
    description: "Dentrix/Eaglesoft require staff training days. ClinicFlow requires zero changes to clinic workflow.",
  },
  {
    gap: "Works alongside any PMS",
    description: "Competitor tools often require switching or deep integration. ClinicFlow overlays any existing system.",
  },
  {
    gap: "Canadian-focused PIPEDA compliance",
    description: "US-based tools may not meet Canadian privacy requirements out of the box.",
  },
  {
    gap: "Direct patient list reactivation",
    description: "Most tools automate future patients only. ClinicFlow sends to the existing inactive patient list.",
  },
];

// ─── Main ─────────────────────────────────────────────────────────────────────

async function run() {
  console.log("Competitor analysis — scraping 3 competitor sites\n");

  const competitorData = [];

  for (const comp of COMPETITORS) {
    console.log(`Analysing ${comp.name} (${comp.url})...`);

    const [mainText, pricingText] = await Promise.all([
      fetchPage(comp.url),
      fetchPage(comp.pricingUrl),
    ]);

    const combinedText = [mainText, pricingText].filter(Boolean).join(" ");
    const lower = combinedText.toLowerCase();

    const pricing         = extractPricing(combinedText);
    const featuresFound   = detectSignals(combinedText, comp.featureSignals);
    const gapSignals      = detectSignals(combinedText, comp.gapSignals);
    const hasMissedCall   = lower.includes("missed call");
    const hasReactivation = lower.includes("reactivation") || lower.includes("recall");
    const hasSplitPayment = lower.includes("split payment") || lower.includes("pay after");
    const hasDoneForYou   = lower.includes("done for you") || lower.includes("done-for-you") || lower.includes("we set up") || lower.includes("we build");
    const isMonthly       = lower.includes("per month") || lower.includes("/month") || lower.includes("monthly");

    const weaknesses = [];
    if (!hasMissedCall)   weaknesses.push("No missed call recovery feature");
    if (!hasSplitPayment) weaknesses.push("No split payment / pay-after-delivery");
    if (!hasDoneForYou)   weaknesses.push("Self-serve only — no done-for-you setup");
    if (isMonthly)        weaknesses.push("Requires ongoing monthly subscription");

    competitorData.push({
      name:             comp.name,
      url:              comp.url,
      pricingFound:     pricing,
      featuresDetected: featuresFound,
      isMonthlyBilling: isMonthly,
      hasMissedCallRecovery: hasMissedCall,
      hasReactivation,
      hasSplitPayment,
      hasDoneForYou,
      weaknesses,
      gapSignalsFound:  gapSignals,
      scrapedAt:        new Date().toISOString(),
      reachable:        combinedText.length > 100,
    });

    console.log(`  Pricing found: ${pricing.join(", ") || "hidden"}`);
    console.log(`  Monthly billing: ${isMonthly ? "YES" : "no"}`);
    console.log(`  Missed call feature: ${hasMissedCall ? "yes" : "NO"}`);
    console.log(`  Done-for-you: ${hasDoneForYou ? "yes" : "NO"}`);
    console.log(`  Weaknesses: ${weaknesses.join("; ") || "none found"}\n`);

    await sleep(2_000);
  }

  const output = {
    generatedAt: new Date().toISOString(),
    clinicFlowDifferentiators: CLINICFLOW_DIFFERENTIATORS,
    competitors: competitorData,
    summary: {
      allRequireMonthlyFees: competitorData.every(c => c.isMonthlyBilling),
      noneHaveSplitPayment:  competitorData.every(c => !c.hasSplitPayment),
      noneAreDoneForYou:     competitorData.every(c => !c.hasDoneForYou),
      commonWeaknesses:      [...new Set(competitorData.flatMap(c => c.weaknesses))],
    },
  };

  writeJson(OUT_PATH, output);

  console.log("── ClinicFlow competitive advantages ──");
  CLINICFLOW_DIFFERENTIATORS.forEach((d, i) =>
    console.log(`  ${i + 1}. ${d.gap}`)
  );
  console.log(`\nSaved → ${OUT_PATH}`);
}

run().catch(e => { console.error("Competitor analysis failed:", e.message); process.exit(1); });
