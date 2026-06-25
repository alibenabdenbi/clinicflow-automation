// src/cli/smtpVerify.js
// SMTP RCPT TO probe on all todo clinic emails.
// Connects to each clinic's mail server and issues EHLO/MAIL FROM/RCPT TO.
// Marks 550-rejected addresses as bounced before we ever send to them.
// Usage: node src/cli/smtpVerify.js [--concurrency 10] [--timeout 6000]

import fs from "fs";
import path from "path";
import net from "net";
import { promises as dns } from "dns";
import dotenv from "dotenv";

dotenv.config();

const OUTREACH_PATH = process.env.OUTREACH_JSON_PATH ||
  path.join(process.cwd(), "data", "outreach.localDentists.json");
const BOUNCES_PATH = path.join(process.cwd(), "data", "bounces.json");

const CONCURRENCY = (() => {
  const i = process.argv.indexOf("--concurrency");
  return i !== -1 ? Number(process.argv[i + 1]) || 10 : 10;
})();

const TIMEOUT_MS = (() => {
  const i = process.argv.indexOf("--timeout");
  return i !== -1 ? Number(process.argv[i + 1]) || 6000 : 6000;
})();

const EHLO_DOMAIN = "clinicflowautomation.com";
const MAIL_FROM_ADDR = `contact@${EHLO_DOMAIN}`;

const mxCache = new Map();

async function resolveMxHost(domain) {
  if (mxCache.has(domain)) return mxCache.get(domain);
  try {
    const records = await dns.resolveMx(domain);
    if (!records || records.length === 0) { mxCache.set(domain, null); return null; }
    records.sort((a, b) => a.priority - b.priority);
    const host = records[0].exchange;
    mxCache.set(domain, host);
    return host;
  } catch {
    mxCache.set(domain, null);
    return null;
  }
}

// ── SMTP probe ─────────────────────────────────────────────────────────────────
// Returns { result: "ok"|"rejected"|"timeout"|"error"|"catchall", code, reason }
async function smtpProbe(email) {
  const domain = (email.split("@")[1] || "").toLowerCase();
  if (!domain) return { result: "error", code: null, reason: "no domain" };

  const mxHost = await resolveMxHost(domain);
  if (!mxHost) return { result: "error", code: null, reason: "no MX record" };

  return new Promise((resolve) => {
    const socket = new net.Socket();
    let buffer = "";
    let step = 0; // 0=banner 1=ehlo 2=mailfrom 3=rcptto
    let settled = false;
    let timer;

    const done = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { socket.write("QUIT\r\n"); } catch {}
      socket.destroy();
      resolve(result);
    };

    timer = setTimeout(() => {
      done({ result: "timeout", code: null, reason: `no response within ${TIMEOUT_MS}ms` });
    }, TIMEOUT_MS);

    socket.on("data", (chunk) => {
      buffer += chunk.toString("ascii");
      let idx;
      while ((idx = buffer.indexOf("\r\n")) !== -1) {
        const line = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        if (line.length < 3) continue;
        const code = parseInt(line.slice(0, 3), 10);
        const isFinal = line[3] !== "-"; // multiline continuation uses "-"
        if (!isFinal) continue; // wait for final line

        if (step === 0) {
          if (code === 220) {
            socket.write(`EHLO ${EHLO_DOMAIN}\r\n`);
            step = 1;
          } else {
            done({ result: "error", code, reason: `unexpected banner ${code}` });
          }
        } else if (step === 1) {
          if (code === 250) {
            socket.write(`MAIL FROM:<${MAIL_FROM_ADDR}>\r\n`);
            step = 2;
          } else {
            done({ result: "error", code, reason: `EHLO rejected (${code})` });
          }
        } else if (step === 2) {
          if (code === 250) {
            socket.write(`RCPT TO:<${email}>\r\n`);
            step = 3;
          } else {
            done({ result: "error", code, reason: `MAIL FROM rejected (${code})` });
          }
        } else if (step === 3) {
          if (code === 250 || code === 251) {
            done({ result: "ok", code, reason: "accepted" });
          } else if (code >= 550 && code <= 554) {
            done({ result: "rejected", code, reason: `user unknown (${code})` });
          } else if (code >= 400 && code < 500) {
            done({ result: "tempfail", code, reason: `temporary failure (${code})` });
          } else {
            done({ result: "error", code, reason: `unexpected RCPT TO code ${code}` });
          }
        }
      }
    });

    socket.on("error", (err) => {
      done({ result: "error", code: null, reason: err.message });
    });

    socket.on("close", () => {
      if (!settled) done({ result: "error", code: null, reason: "connection closed unexpectedly" });
    });

    socket.connect(25, mxHost);
  });
}

// ── Pool runner ────────────────────────────────────────────────────────────────
async function runPool(tasks, concurrency) {
  let next = 0;
  async function worker() {
    while (next < tasks.length) {
      const i = next++;
      await tasks[i]();
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker));
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function readJsonSafe(p, fallback) {
  try { return JSON.parse(fs.readFileSync(p, "utf-8")); }
  catch { return fallback; }
}

function appendBounceLog(entry) {
  const log = readJsonSafe(BOUNCES_PATH, []);
  const addr = (entry.email || "").toLowerCase();
  if (!log.some(b => (b.email || "").toLowerCase() === addr)) {
    log.push(entry);
    fs.writeFileSync(BOUNCES_PATH, JSON.stringify(log, null, 2));
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  const leads = readJsonSafe(OUTREACH_PATH, []);

  const candidates = leads
    .map((l, i) => ({ l, i }))
    .filter(({ l }) => (l.status || "todo") === "todo" && l.email);

  console.log(`SMTP RCPT TO verify — ${candidates.length} todo records  (concurrency ${CONCURRENCY}, timeout ${TIMEOUT_MS}ms)\n`);

  // Quick port-25 reachability check — abort if globally blocked to avoid nuking the queue
  console.log("Checking port-25 reachability via gmail.com MX...");
  const testProbe = await smtpProbe("probe-test@gmail.com");
  const port25Blocked = testProbe.result === "timeout" || testProbe.result === "error";
  if (port25Blocked) {
    console.error(`\n✗ Port 25 is blocked on this machine (got: ${testProbe.result} — ${testProbe.reason})`);
    console.error("  Cannot run SMTP RCPT TO probe — all probes would timeout and incorrectly mark records as no_mx.");
    console.error("  Options:");
    console.error("    1. Run this script from a server with outbound port 25 open.");
    console.error("    2. Use a transactional email provider's verification API (e.g. ZeroBounce, NeverBounce).");
    console.error("    3. Rely on MX sweep (npm run mxsweep) + scanBounces for post-send bounce handling.");
    process.exit(1);
  }
  console.log(`  Port 25 reachable (gmail responded: ${testProbe.result}, code ${testProbe.code})\n`);

  let okCount       = 0;
  let rejectedCount = 0;
  let timeoutCount  = 0;
  let errorCount    = 0;
  let tempfailCount = 0;

  const rejected = [];

  const tasks = candidates.map(({ l, i }) => async () => {
    const { result, code, reason } = await smtpProbe(l.email);

    if (result === "rejected") {
      leads[i].status     = "bounced";
      leads[i].bouncedAt  = new Date().toISOString();
      leads[i].bounceType = "permanent";
      leads[i].bounceCode = code;
      leads[i].bounceReason = `smtp-verify: ${reason}`;
      delete leads[i].followupDueAt;
      delete leads[i].followupCount;
      appendBounceLog({
        email: l.email,
        clinic: l.clinicName,
        bounceCode: code,
        bounceType: "permanent",
        date: new Date().toISOString(),
        source: "smtp-rcpt-probe",
      });
      rejected.push({ email: l.email, clinic: l.clinicName, code, reason });
      rejectedCount++;
      console.log(`  ✗ REJECTED  ${l.email}  [${l.clinicName}]  → ${code} ${reason}`);
    } else if (result === "timeout" || result === "error") {
      leads[i].status = "no_mx";
      leads[i].skipReason = `smtp-verify: ${reason}`;
      leads[i].mxCheckedAt = new Date().toISOString();
      if (result === "timeout") timeoutCount++;
      else errorCount++;
    } else if (result === "tempfail") {
      tempfailCount++;
      // Leave as todo — temporary failure, retry next run
    } else {
      okCount++;
    }
  });

  await runPool(tasks, CONCURRENCY);

  fs.writeFileSync(OUTREACH_PATH, JSON.stringify(leads, null, 2));

  console.log("\n── Results ─────────────────────────────────────────────────────");
  console.log(`  OK (250):          ${okCount}`);
  console.log(`  Rejected (5xx):    ${rejectedCount}  ← marked bounced`);
  console.log(`  Temp fail (4xx):   ${tempfailCount}  ← left as todo`);
  console.log(`  Timeout/error:     ${timeoutCount + errorCount}  ← marked no_mx`);

  if (rejected.length > 0) {
    console.log("\nPermanently rejected addresses:");
    rejected.forEach(r => console.log(`  ${r.email}  [${r.clinic}]  — ${r.reason}`));
  }

  const todoAfter = leads.filter(l => (l.status || "todo") === "todo" && l.email).length;
  console.log(`\nTodo queue after verification: ${todoAfter}`);
  console.log(`Removed from queue: ${candidates.length - todoAfter}`);
}

main().catch(e => {
  console.error("smtpVerify failed:", e.message);
  process.exit(1);
});
