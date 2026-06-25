// src/main.js
import fs from "fs";
import path from "path";

// ✅ Scrapers (Reddit kept OFF for now)
import { scrapeHackerNews } from "./scrapers/hackernews.js";
import { scrapeIndieHackers } from "./scrapers/indiehackers.js";
import { scrapeChromeWebStore } from "./scrapers/chromeReviews.js";
import { scrapeWpPlugins } from "./scrapers/wpPlugins.js";

// ✅ Extra sources you already have
import { scrapeProductHunt } from "./scrapers/producthunt.js";
import { scrapeGitHubIssues as scrapeGithubIssues } from "./scrapers/githubIssues.js";

// Processing
import { extractPainSignals } from "./processors/painExtractor.js";
import { scoreSignals, rankTopByIntent } from "./processors/scorer.js";
import { addThemes, summarizeThemes } from "./processors/cluster.js";
import { filterJunk, filterByScore } from "./processors/filters.js";
import { dedupeByTitle, toProblemStatement } from "./processors/normalize.js";
import { enrichProblems } from "./processors/angles.js";
import { buildNextAction } from "./processors/nextAction.js";
import { buildClientAcquisitionProblemMap } from "./processors/problemMap.js";

// Leads + CRM
import { generateLeadsAdvanced } from "./processors/leads.js";
import { initializeCRM, mergeCrmLeads } from "./processors/crm.js";
// Storage
import { writeJson } from "./storage/files.js";

// Local businesses — read from file populated by `npm run discover`
import { scoreBusinessLead } from "./processors/businessScorer.js";

// ✅ Offer system (MATCHES your current offerBuilder.js)
import { buildOffers, buildOnePagerMarkdown } from "./processors/offerBuilder.js";
import { enrichLocalDentistsAndWriteFiles } from "./processors/localDentistOutreach.js";
function readJsonSafe(filePath, fallback = null) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, "utf-8"));
  } catch {
    return fallback;
  }
}

async function safeRun(label, fn, fallback = []) {
  try {
    const res = await fn();
    return Array.isArray(res) ? res : fallback;
  } catch (err) {
    console.log(`⚠️ ${label} failed, continuing. Reason: ${err?.message || err}`);
    return fallback;
  }
}

async function main() {
  console.log("\nORE v1 — collecting signals...\n");

  // 1️⃣ COLLECT
  const redditItems = []; // ✅ Reddit OFF

  const hnItems = await safeRun("HackerNews", () => scrapeHackerNews({ type: "topstories", limit: 50 }));
  const ihItems = await safeRun("IndieHackers", () => scrapeIndieHackers({ limitPages: 2, maxPosts: 50 }));
  const productHuntItems = await safeRun("ProductHunt", () => scrapeProductHunt({ pages: 2 }));

  const githubQueries = [
    "crm integration",
    "invoice automation",
    "proposal generator",
    "booking payments",
    "lead generation automation",
  ];
  const githubItems = await safeRun("GitHubIssues", async () => {
    const results = await Promise.all(
      githubQueries.map((q) => scrapeGithubIssues({ query: q, limit: 10 }))
    );
    return results.flat();
  });

  const chromeItems = await safeRun("ChromeWebStore", () => scrapeChromeWebStore({ maxExtensionsPerQuery: 6 }));
  const wpItems = await safeRun("WordPressPlugins", () =>
    scrapeWpPlugins({ pagesPerKeyword: 1, maxPluginsPerKeyword: 5, maxReviewsPerPlugin: 8 })
  );

  // 2️⃣ SAVE RAW
  writeJson(path.join("data", "raw.reddit.json"), redditItems);
  writeJson(path.join("data", "raw.hn.json"), hnItems);
  writeJson(path.join("data", "raw.indiehackers.json"), ihItems);
  writeJson(path.join("data", "raw.producthunt.json"), productHuntItems);
  writeJson(path.join("data", "raw.github.json"), githubItems);
  writeJson(path.join("data", "raw.chrome.json"), chromeItems);
  writeJson(path.join("data", "raw.wordpress.json"), wpItems);

  // 3️⃣ MERGE
  const allItems = [...redditItems, ...hnItems, ...ihItems, ...productHuntItems, ...githubItems, ...wpItems, ...chromeItems];
  writeJson(path.join("data", "raw.all.json"), allItems);

  // 4️⃣ PIPELINE
  const withPain = extractPainSignals(allItems);
  const scored = scoreSignals(withPain);
  const highQuality = filterByScore(scored, 4);   // drop noise before theme assignment
  const themed = addThemes(highQuality);
  const cleaned = filterJunk(themed);
  const deduped = dedupeByTitle(cleaned);

  // 5️⃣ PROBLEM MAP
  const caMap = buildClientAcquisitionProblemMap(deduped, 10);
  writeJson(path.join("data", "problem_map.client_acquisition.json"), caMap);

  // 6️⃣ RANK + THEMES
  const topPostsByIntent = rankTopByIntent(deduped, 20);
  writeJson(path.join("data", "opportunities.intent.top20.json"), topPostsByIntent);

  const topThemes = summarizeThemes(topPostsByIntent, 10);
  writeJson(path.join("data", "themes.top10.json"), topThemes);

  // 7️⃣ PROBLEMS
  const problemsBase = topThemes.map((t) => {
    const example = t.examples?.[0] || null;
    return {
      theme: t.theme,
      problemStatement: toProblemStatement({ theme: t.theme, title: example?.title || "" }),
      evidenceCount: t.count,
      avgScore: t.avgScore,
      maxScore: t.maxScore,
      examples: t.examples || [],
    };
  });

  const problems = enrichProblems(problemsBase);
  writeJson(path.join("data", "problems.top10.json"), problems);

  // 8️⃣ LEADS + CRM
  const chosenTheme = problems?.[0]?.theme || null;

  const crmPath = path.join("data", "crm.leads.json");
  const existingCrm = readJsonSafe(crmPath, []);

  let addedCount = 0;
  let crmIncoming = [];

  if (chosenTheme) {
const leads = await generateLeadsAdvanced({
  items: deduped,
  chosenTheme,
  maxLeads: 25,
  enableConfidence: true,
  enableEnrichment: true,
}); crmIncoming = initializeCRM(leads);

    const merged = mergeCrmLeads(existingCrm, crmIncoming);

    const existingIds = new Set((existingCrm || []).map((l) => l.leadId));
    addedCount = (crmIncoming || []).filter((l) => !existingIds.has(l.leadId)).length;

    writeJson(path.join("data", "leads.ready.json"), crmIncoming);
    writeJson(crmPath, merged);

    console.log(`- Leads generated: ${crmIncoming.length} (added ${addedCount})`);
    console.log(`- CRM saved: data/crm.leads.json`);
  } else {
    console.log("- Leads generated: 0 (no chosen theme)");
    writeJson(crmPath, existingCrm || []);
  }

  // 9️⃣ OFFERS + OUTREACH + ONE-PAGER (✅ FIXED)
  const { offers, messages } = buildOffers({
    leads: crmIncoming,
    problems,
    maxOffers: 3,
  });

  writeJson(path.join("data", "offers.top3.json"), offers);
  writeJson(path.join("data", "outreach.messages.json"), messages);

  const onePager = buildOnePagerMarkdown({ offers });
  fs.writeFileSync(path.join("data", "landing.onepager.md"), onePager, "utf-8");

  console.log(`- Offers saved: data/offers.top3.json`);
  console.log(`- Outreach saved: data/outreach.messages.json`);
  console.log(`- One pager saved: data/landing.onepager.md`);

  // 10️⃣ NEXT ACTION
  const nextAction = buildNextAction(problems);
  writeJson(path.join("data", "next_action.json"), nextAction);

  // 11️⃣ LOCAL BUSINESS (dentists) → score from already-discovered file + enrich emails + export
  // Discovery runs separately via `npm run discover` — we just read the file here.
  const rawLocal = readJsonSafe(path.join("data", "local.businesses.json")) || [];
  const scoredLocal = rawLocal.filter(Boolean).map((b) => scoreBusinessLead(b));

  const dentistRes = await enrichLocalDentistsAndWriteFiles({
  businesses: scoredLocal,
  maxDentists: 30,
  outCsvPath: path.join("data", "local.dentists.leads.csv"),
  outJsonPath: path.join("data", "outreach.localDentists.json"),
});


  // ✅ SUMMARY
  console.log("✅ Done.");
  console.log(
    `- Reddit: ${redditItems.length}, HN: ${hnItems.length}, IH: ${ihItems.length}, PH: ${productHuntItems.length}, GH: ${githubItems.length}, WP: ${wpItems.length}, Chrome: ${chromeItems.length}`
  );
  console.log(`- Total raw: ${allItems.length}`);
  console.log(`- After cleaning: ${cleaned.length}, After dedupe: ${deduped.length}`);
  console.log(`- Intent posts saved: data/opportunities.intent.top20.json`);
  console.log(`- Top themes saved: data/themes.top10.json`);
  console.log(`- Problems saved: data/problems.top10.json`);
  console.log(`- Client Acquisition map saved: data/problem_map.client_acquisition.json`);
  console.log(`- Next action saved: data/next_action.json`);
  console.log(`- Local businesses saved: data/local.businesses.json (${scoredLocal.length})\n`);
console.log(`\n- Dentists enriched: ${dentistRes.dentistsEnriched}`);
console.log(`- Outreach ready: ${dentistRes.outreachReady}`);
console.log(`- CSV ready: ${dentistRes.csvPath}`);
console.log(`- Outreach JSON: ${dentistRes.jsonPath}\n`);
}

main().catch((err) => {
  console.error("❌ Error:", err);
  process.exit(1);
});