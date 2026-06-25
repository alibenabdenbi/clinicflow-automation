// src/cli/prioritizeQueue.js
// Cross-references tech-stack intelligence with outreach queue and:
//   - Annotates high-opportunity clinics (score >= 9) with priority: "high"
//   - Marks clinics with detected booking software as already_equipped
//   - Re-sorts queue: high-priority todo first, then normal todo, equipped last
//
// Usage: node src/cli/prioritizeQueue.js [--market dental|physio|all] [--dry-run]

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");

const MARKET_ARG = (() => {
  const i = process.argv.indexOf("--market");
  return i !== -1 ? process.argv[i + 1] : "dental";
})();
const DRY_RUN = process.argv.includes("--dry-run");

const MARKET_QUEUE_PATHS = {
  dental: path.join(ROOT, "data", "outreach.localDentists.json"),
  physio: path.join(ROOT, "data", "outreach.physioClinics.json"),
};

const TECH_STACK_PATH = path.join(ROOT, "data", "intelligence", "tech-stack.json");

const HIGH_OPPORTUNITY_THRESHOLD = 9;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, "utf-8"));
}
function writeJson(p, data) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(data, null, 2), "utf-8");
}

// Normalize website URL for reliable matching:
// - lowercase
// - strip protocol
// - strip www.
// - strip trailing slash
function normalizeUrl(url) {
  if (!url) return "";
  return url
    .toLowerCase()
    .replace(/^https?:\/\//i, "")
    .replace(/^www\./, "")
    .replace(/\/$/, "")
    .trim();
}

// ─── Queue sort order ─────────────────────────────────────────────────────────
// 0 = top (high priority todo)
// 1 = normal todo
// 2 = non-todo (sent, followup, etc.) — leave in place
// 3 = already_equipped / alreadyEquipped

function queueSortKey(lead) {
  const status = lead.status || "todo";
  if (status === "already_equipped") return 3;
  if (status !== "todo") return 2;
  if (lead.priority === "high") return 0;
  return 1;
}

// ─── Process one queue file ────────────────────────────────────────────────────

function processQueue(queuePath, techByUrl) {
  const leads = readJson(queuePath);

  let annotatedHigh = 0;
  let annotatedEquipped = 0;
  let alreadyHad = 0;

  for (const lead of leads) {
    const key = normalizeUrl(lead.website);
    const tech = techByUrl[key];
    if (!tech) continue;

    const currentStatus = lead.status || "todo";

    // Stamp opportunityScore on every matched lead regardless of status
    lead.opportunityScore     = tech.opportunityScore;
    lead.techDetectedAt       = tech.scannedAt;

    if (tech.bookingSoftware && currentStatus === "todo") {
      // Already has booking software — move to equipped
      lead.status             = "already_equipped";
      lead.alreadyEquipped    = true;
      lead.bookingSoftware    = tech.bookingSoftware;
      lead.equippedSignals    = [tech.bookingSoftware];
      lead.equippedCheckedAt  = tech.scannedAt;
      annotatedEquipped++;
    } else if (tech.bookingSoftware && currentStatus !== "todo") {
      // Already processed — just stamp the software name
      lead.bookingSoftware    = tech.bookingSoftware;
      alreadyHad++;
    } else if (tech.opportunityScore >= HIGH_OPPORTUNITY_THRESHOLD && currentStatus === "todo") {
      // High opportunity — promote
      lead.priority           = "high";
      annotatedHigh++;
    }
  }

  // Re-sort: high-priority todo first → normal todo → other statuses → equipped
  // Use stable sort (slice trick ensures equal-key records keep original relative order)
  leads.sort((a, b) => queueSortKey(a) - queueSortKey(b));

  return { leads, annotatedHigh, annotatedEquipped, alreadyHad };
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  if (!fs.existsSync(TECH_STACK_PATH)) {
    console.error(`Tech stack not found: ${TECH_STACK_PATH}`);
    console.error("Run: node src/intelligence/techDetector.js --market all");
    process.exit(1);
  }

  const techStack  = readJson(TECH_STACK_PATH);
  const techClinics = techStack.clinics || [];

  // Build lookup map: normalized website URL → tech record
  const techByUrl = {};
  for (const t of techClinics) {
    if (!t.website) continue;
    techByUrl[normalizeUrl(t.website)] = t;
  }

  console.log(`\nPrioritize Queue`);
  console.log(`Tech stack: ${techClinics.length} records  (${Object.keys(techByUrl).length} with website)`);
  if (DRY_RUN) console.log(`DRY RUN — no files will be written\n`);

  const markets = MARKET_ARG === "all" ? Object.keys(MARKET_QUEUE_PATHS) : [MARKET_ARG];

  for (const market of markets) {
    const queuePath = MARKET_QUEUE_PATHS[market];
    if (!queuePath || !fs.existsSync(queuePath)) {
      console.log(`  ${market}: queue file not found — skipping`);
      continue;
    }

    const { leads, annotatedHigh, annotatedEquipped, alreadyHad } = processQueue(queuePath, techByUrl);

    const todo          = leads.filter(l => (l.status || "todo") === "todo");
    const highPrio      = todo.filter(l => l.priority === "high");
    const highWithEmail = highPrio.filter(l => l.email && l.email.trim() && l.emailConfidence !== "none");
    const highHigh      = highPrio.filter(l => l.emailConfidence === "high" || l.emailConfidence === "medium");
    const equipped      = leads.filter(l => l.status === "already_equipped");

    console.log(`\n── ${market.toUpperCase()} ──────────────────────────────────────────`);
    console.log(`  Total in queue:                 ${leads.length}`);
    console.log(`  Newly marked high-priority:     ${annotatedHigh}`);
    console.log(`  Newly marked already_equipped:  ${annotatedEquipped}`);
    console.log(`  Software-stamped (non-todo):    ${alreadyHad}`);
    console.log(`\n  TODO queue after update:        ${todo.length}`);
    console.log(`  ├─ high priority (score 9+):    ${highPrio.length}`);
    console.log(`  │  ├─ with any email:            ${highWithEmail.length}`);
    console.log(`  │  └─ high/med confidence email: ${highHigh.length}`);
    console.log(`  └─ normal priority:              ${todo.length - highPrio.length}`);
    console.log(`  already_equipped total:          ${equipped.length}`);

    if (highHigh.length > 0) {
      console.log(`\n  Top high-opportunity clinics ready to send:`);
      highHigh.slice(0, 10).forEach((l, i) =>
        console.log(`    ${i + 1}. [${l.opportunityScore}/10] ${(l.clinicName || "").slice(0, 38).padEnd(38)}  ${l.emailConfidence}  ${l.email}`)
      );
    }

    if (!DRY_RUN) {
      writeJson(queuePath, leads);
      console.log(`\n  ✓ Saved → ${queuePath}`);
    }
  }
}

main().catch(e => { console.error("prioritizeQueue failed:", e.message); process.exit(1); });
