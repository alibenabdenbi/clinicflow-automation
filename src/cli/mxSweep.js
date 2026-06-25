// src/cli/mxSweep.js
// Runs MX verification on every todo record in outreach.localDentists.json.
// Records that fail MX are marked status: no_mx so sendBatch never attempts them.
// Usage: node src/cli/mxSweep.js [--concurrency 10]

import fs from "fs";
import path from "path";
import { promises as dns } from "dns";
import dotenv from "dotenv";

dotenv.config();

const OUTREACH_PATH = process.env.OUTREACH_JSON_PATH ||
  path.join(process.cwd(), "data", "outreach.localDentists.json");

const CONCURRENCY = (() => {
  const i = process.argv.indexOf("--concurrency");
  return i !== -1 ? Number(process.argv[i + 1]) || 10 : 10;
})();

// ─── MX check ────────────────────────────────────────────────────────────────

const mxCache = new Map();

async function hasMx(domain) {
  if (mxCache.has(domain)) return mxCache.get(domain);
  try {
    const records = await dns.resolveMx(domain);
    const result = records && records.length > 0
      ? { valid: true, reason: "ok" }
      : { valid: false, reason: "no MX records" };
    mxCache.set(domain, result);
    return result;
  } catch (err) {
    const code = err?.code || "";
    let result;
    if (code === "ENOTFOUND" || code === "ENODATA" || code === "ESERVFAIL") {
      result = { valid: false, reason: `domain unreachable (${code})` };
    } else {
      // Transient DNS error — don't penalise
      result = { valid: true, reason: `mx_check_skipped (${code})` };
    }
    mxCache.set(domain, result);
    return result;
  }
}

// ─── Pool runner ─────────────────────────────────────────────────────────────

async function runPool(tasks, concurrency) {
  const results = new Array(tasks.length);
  let next = 0;
  async function worker() {
    while (next < tasks.length) {
      const i = next++;
      results[i] = await tasks[i]();
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker));
  return results;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const leads = JSON.parse(fs.readFileSync(OUTREACH_PATH, "utf-8"));

  // Only check todo records that have an email set
  const candidates = leads
    .map((l, i) => ({ l, i }))
    .filter(({ l }) => (l.status || "todo") === "todo" && l.email);

  console.log(`MX sweep — checking ${candidates.length} todo records (concurrency ${CONCURRENCY})\n`);

  let noMx = 0;
  let ok = 0;
  let skipped = 0;
  const failed = [];

  const tasks = candidates.map(({ l, i }) => async () => {
    const domain = (l.email || "").split("@")[1]?.toLowerCase();
    if (!domain) { skipped++; return; }

    const { valid, reason } = await hasMx(domain);
    if (!valid) {
      leads[i].status = "no_mx";
      leads[i].skipReason = reason;
      leads[i].mxCheckedAt = new Date().toISOString();
      noMx++;
      failed.push({ clinicName: l.clinicName, email: l.email, reason });
    } else {
      ok++;
    }
  });

  await runPool(tasks, CONCURRENCY);

  fs.writeFileSync(OUTREACH_PATH, JSON.stringify(leads, null, 2));

  console.log(`Results:`);
  console.log(`  MX valid (ok):         ${ok}`);
  console.log(`  No MX (marked no_mx):  ${noMx}`);
  console.log(`  Skipped (no email):    ${skipped}`);

  if (failed.length > 0) {
    console.log(`\nFailed MX records:`);
    failed.forEach(f => console.log(`  ${f.email}  [${f.clinicName}]  — ${f.reason}`));
  }

  // Recompute todo count after sweep
  const todoAfter = leads.filter(l => (l.status || "todo") === "todo").length;
  console.log(`\nTodo records remaining after sweep: ${todoAfter}`);
}

main().catch(e => {
  console.error("MX sweep failed:", e.message);
  process.exit(1);
});
