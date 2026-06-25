// src/cli/sps.js
import fs from "fs";
import path from "path";
import { generateScopePack } from "../product/scopePayShield.js";

function ensureDir(p) {
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
}

function readArg(name) {
  const idx = process.argv.indexOf(name);
  if (idx === -1) return null;
  return process.argv[idx + 1] ?? null;
}

async function main() {
  const inputFile = readArg("--in");
  const client = readArg("--client") || "Client";
  const you = readArg("--you") || "You";

  if (!inputFile) {
    console.log("Usage:");
    console.log("  node src/cli/sps.js --in data/convo.txt --client \"Acme\" --you \"Mohamed\"");
    process.exit(1);
  }

  const convo = fs.readFileSync(inputFile, "utf-8");

  const pack = generateScopePack({
    conversationText: convo,
    clientName: client,
    freelancerName: you
  });

  const outDir = path.join("data", "outputs", `sps_${pack.stamp}`);
  ensureDir(outDir);

  fs.writeFileSync(path.join(outDir, "scope.md"), pack.scopeMd, "utf-8");
  fs.writeFileSync(path.join(outDir, "milestones.md"), pack.milestonesMd, "utf-8");
  fs.writeFileSync(path.join(outDir, "invoice.md"), pack.invoiceMd, "utf-8");
  fs.writeFileSync(path.join(outDir, "followups.md"), pack.followupsMd, "utf-8");
  fs.writeFileSync(path.join(outDir, "tracker.json"), JSON.stringify(pack.tracker, null, 2), "utf-8");

  console.log("✅ Scope & Pay Shield generated:");
  console.log(`   ${outDir}`);
  console.log("Files:");
  console.log(" - scope.md");
  console.log(" - milestones.md");
  console.log(" - invoice.md");
  console.log(" - followups.md");
  console.log(" - tracker.json");
}

main().catch((e) => {
  console.error("❌ Error:", e);
  process.exit(1);
});
