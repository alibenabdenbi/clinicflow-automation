import fs from "fs";
import path from "path";

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, "utf-8"));
}

function headline(thing) {
  return `\n=== ${thing} ===\n`;
}

function sampleLeads() {
  // v1: static lead sources (free). Next: we auto-scrape/email list.
  return [
    { channel: "Reddit", target: "r/freelance", action: "Reply to 10 posts/day about ghosting, invoices, scope creep." },
    { channel: "Reddit", target: "r/smallbusiness", action: "Reply to 5 posts/day about invoicing/tools being expensive." },
    { channel: "IndieHackers", target: "Group: Founders", action: "Comment on 5 threads where people sell services." },
    { channel: "LinkedIn", target: "Agencies (2–20 ppl)", action: "DM 10 agency owners/day with the short message." },
    { channel: "Facebook", target: "Freelancer groups", action: "Post once/day: ‘I’ll generate your scope+invoice plan free’." }
  ];
}

function dailyChecklist() {
  return [
    "Run engine (npm run start) → refresh next_action.json",
    "DM 15 people (5 Reddit, 5 LinkedIn, 5 IH/FB)",
    "Offer free run: they send a client convo → you return scope pack",
    "Ask 1 question only: ‘If this saves you time + prevents ghosting, would you pay $19?’",
    "Log outcomes (yes/no/price feedback) in a note"
  ];
}

async function main() {
  const nextPath = path.join("data", "next_action.json");
  if (!fs.existsSync(nextPath)) {
    console.log("❌ data/next_action.json not found. Run: npm run start");
    process.exit(1);
  }

  const nx = readJson(nextPath);

  console.log(headline("AUTONOMOUS OUTREACH"));
  console.log(`Chosen Theme: ${nx.chosenTheme}`);
  console.log(`Problem: ${nx.problemStatement}`);
  console.log(`Angle: ${nx.chosenAngle?.name || "N/A"}`);

  console.log(headline("WHERE TO SELL (TODAY)"));
  (nx.outreach?.whereToFind || []).forEach((w) => console.log(`- ${w}`));

  console.log(headline("DM SCRIPTS"));
  (nx.outreach?.messages || []).forEach((m, i) => {
    console.log(`\n[${i + 1}] ${m.name}\n${m.text}\n`);
  });

  console.log(headline("LEADS (STARTER LIST)"));
  sampleLeads().forEach((l, i) => {
    console.log(`${i + 1}. ${l.channel} — ${l.target}\n   ${l.action}`);
  });

  console.log(headline("DAILY CHECKLIST"));
  dailyChecklist().forEach((c, i) => console.log(`${i + 1}. ${c}`));

  console.log("\n✅ Next step: run Scope & Pay Shield for anyone who replies.\n");
}

main().catch((e) => {
  console.error("❌ Error:", e);
  process.exit(1);
});
