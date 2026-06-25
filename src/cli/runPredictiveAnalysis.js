// src/cli/runPredictiveAnalysis.js
// Runs the predictive intelligence engine for one or all active clients.
//
// Usage:
//   node src/cli/runPredictiveAnalysis.js --client test-clinic
//   node src/cli/runPredictiveAnalysis.js --all
//   node src/cli/runPredictiveAnalysis.js --client test-clinic --report

import dotenv from "dotenv";
dotenv.config();

import fs from "fs";
import { analyzeClinic, runPredictiveAnalysisForAll } from "../services/predictiveEngine.js";

function getArg(flag) {
  const i = process.argv.indexOf(flag);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : null;
}

const slug    = getArg("--client");
const runAll  = process.argv.includes("--all");
const report  = process.argv.includes("--report");

if (!slug && !runAll) {
  console.error('Usage: node src/cli/runPredictiveAnalysis.js --client SLUG [--report]');
  console.error('       node src/cli/runPredictiveAnalysis.js --all');
  process.exit(1);
}

async function main() {
  if (runAll) {
    await runPredictiveAnalysisForAll();
    return;
  }

  const result = await analyzeClinic(slug);
  if (!result) { console.error(`No result for ${slug}`); process.exit(1); }

  const { scores, forecast, summary, heatmap, comparison, recovery, patientsAtRisk } = result;

  console.log(`\n${"═".repeat(60)}`);
  console.log(`  Predictive Intelligence — ${slug}`);
  console.log(`${"═".repeat(60)}\n`);

  console.log("INSIGHT SUMMARY:");
  console.log(`  ${summary}\n`);

  console.log("RECOVERY FUNNEL:");
  console.log(`  Missed calls: ${recovery.total}`);
  console.log(`  Wave 1 sent:  ${recovery.wave1Sent}`);
  console.log(`  Replied:      ${recovery.replied}  (${recovery.replyRate}%)`);
  console.log(`  Recovered:    ${recovery.recovered} (${recovery.recoveryRate}%)\n`);

  console.log("REVENUE FORECAST:");
  console.log(`  Conservative: $${forecast.scenarios.conservative.revenue.toLocaleString("en-CA")} (${forecast.scenarios.conservative.recoveries} patients)`);
  console.log(`  Expected:     $${forecast.scenarios.expected.revenue.toLocaleString("en-CA")} (${forecast.scenarios.expected.recoveries} patients)`);
  console.log(`  Optimistic:   $${forecast.scenarios.optimistic.revenue.toLocaleString("en-CA")} (${forecast.scenarios.optimistic.recoveries} patients)`);
  console.log(`  LTV at risk:  $${forecast.ltvAtRisk.toLocaleString("en-CA")}\n`);

  if (patientsAtRisk.length) {
    console.log("PATIENTS APPROACHING 12 MONTHS:");
    patientsAtRisk.forEach((p) => {
      console.log(`  ${p.name} — ${p.monthsInactive} months (last: ${p.lastVisit || "unknown"})`);
    });
    console.log();
  }

  if (report) {
    console.log("PATIENT SCORES:");
    scores.forEach((s) => {
      const churnBar = "▓".repeat(Math.round(s.churnRisk / 10)).padEnd(10);
      const recBar   = "▓".repeat(Math.round(s.recoveryLikelihood / 10)).padEnd(10);
      console.log(`\n  ${s.name}`);
      console.log(`    Churn risk:  [${churnBar}] ${s.churnRisk}%  (${s.churnRiskLabel})`);
      console.log(`    Recovery:    [${recBar}] ${s.recoveryLikelihood}%  (${s.recoveryLabel})`);
      console.log(`    LTV:         $${s.ltv.threeYearLTV}/3yr  (${s.ltv.label})`);
      console.log(`    Contact:     ${s.optimalContactDay} at ${s.optimalContactHour}:00`);
      console.log(`    Action:      ${s.recommendedAction}`);
      console.log(`    → ${s.actionDescription}`);
    });
  }

  console.log(`\nFiles saved:`);
  console.log(`  data/clients/${slug}/patient-scores.json`);
  console.log(`  data/clients/${slug}/intelligence.json`);
  console.log(`  data/clients/${slug}/stats.json  (portal updated)`);
}

main().catch((err) => { console.error("Error:", err.message); process.exit(1); });
