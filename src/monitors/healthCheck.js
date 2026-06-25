// src/monitors/healthCheck.js
// Checks system health: SMTP, data files, file sizes, scheduler.
// Logs to data/health.log. Runs standalone or on-demand.
// Also exported as checkHealth() so scheduler.js can call it every 6 hours.

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { createTransport } from "nodemailer";
import dotenv from "dotenv";

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const HEALTH_LOG = path.join(ROOT, "data", "health.log");
const DATA_DIR = path.join(ROOT, "data");

// ─── Logging ──────────────────────────────────────────────────────────────────

function appendLog(msg) {
  const ts = new Date().toISOString();
  const line = `[${ts}] ${msg}`;
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.appendFileSync(HEALTH_LOG, line + "\n", "utf-8");
  process.stdout.write(line + "\n");
}

// ─── Checks ───────────────────────────────────────────────────────────────────

async function checkSmtp() {
  const host = (process.env.SMTP_HOST || "").trim();
  const port = Number(process.env.SMTP_PORT || "0");
  const user = (process.env.SMTP_USER || "").trim();
  const pass = (process.env.SMTP_PASS || "").trim();

  if (!host || !port || !user || !pass) {
    return { ok: false, detail: "SMTP env vars not set" };
  }

  try {
    const secure =
      (process.env.SMTP_SECURE || "").toLowerCase() === "true" || port === 465;
    const transporter = createTransport({
      host,
      port,
      secure,
      auth: { user, pass },
      tls: { rejectUnauthorized: false },
      connectionTimeout: 10_000,
    });
    await transporter.verify();
    return { ok: true, detail: `connected to ${host}:${port}` };
  } catch (err) {
    return { ok: false, detail: `SMTP verify failed: ${err?.message || err}` };
  }
}

function checkFiles() {
  const REQUIRED = [
    "outreach.localDentists.json",
    "crm.leads.json",
    "smtp.sendlog.json",
  ];

  const issues = [];
  const MAX_MB = 50;

  for (const name of REQUIRED) {
    const fp = path.join(DATA_DIR, name);
    if (!fs.existsSync(fp)) {
      issues.push(`Missing: ${name}`);
      continue;
    }
    try {
      const stat = fs.statSync(fp);
      const mb = stat.size / (1024 * 1024);
      if (mb > MAX_MB) {
        issues.push(`${name} is ${mb.toFixed(1)} MB (> ${MAX_MB} MB limit)`);
      }
      // Try to parse JSON
      JSON.parse(fs.readFileSync(fp, "utf-8"));
    } catch (err) {
      issues.push(`${name}: ${err?.message || "unreadable"}`);
    }
  }

  // Check for very large files anywhere in data/
  try {
    for (const f of fs.readdirSync(DATA_DIR)) {
      const fp = path.join(DATA_DIR, f);
      if (!fs.statSync(fp).isFile()) continue;
      const mb = fs.statSync(fp).size / (1024 * 1024);
      if (mb > MAX_MB) {
        issues.push(`Large file: data/${f} is ${mb.toFixed(1)} MB`);
      }
    }
  } catch {
    // best effort
  }

  return { ok: issues.length === 0, issues };
}

function checkSchedulerLog() {
  const logPath = path.join(DATA_DIR, "scheduler.log");
  if (!fs.existsSync(logPath)) {
    return { ok: false, detail: "scheduler.log does not exist — scheduler may not have run yet" };
  }

  try {
    const content = fs.readFileSync(logPath, "utf-8");
    const lines = content.split("\n").filter(Boolean);
    if (lines.length === 0) {
      return { ok: false, detail: "scheduler.log is empty" };
    }

    // Check that the last log line is recent (within 25 hours — one full daily cycle)
    const lastLine = lines[lines.length - 1];
    const tsMatch = lastLine.match(/\[(\d{4}-\d{2}-\d{2}T[\d:.]+Z)\]/);
    if (tsMatch) {
      const lastTs = Date.parse(tsMatch[1]);
      const hoursSince = (Date.now() - lastTs) / (1000 * 60 * 60);
      if (hoursSince > 25) {
        return {
          ok: false,
          detail: `Scheduler last wrote ${hoursSince.toFixed(1)}h ago — may be stopped`,
        };
      }
      return { ok: true, detail: `Last activity ${hoursSince.toFixed(1)}h ago` };
    }

    return { ok: true, detail: "log exists and has content" };
  } catch (err) {
    return { ok: false, detail: `Cannot read scheduler.log: ${err?.message}` };
  }
}

function checkDataDir() {
  const required = ["outreach.localDentists.json", "crm.leads.json"];
  const missing = required.filter((f) => !fs.existsSync(path.join(DATA_DIR, f)));
  if (missing.length > 0) {
    return { ok: false, detail: `Missing critical data files: ${missing.join(", ")}` };
  }
  return { ok: true, detail: "All critical data files present" };
}

// ─── Main health check function ───────────────────────────────────────────────

export async function checkHealth() {
  appendLog("=== Health Check START ===");

  const results = {};

  // SMTP
  const smtp = await checkSmtp();
  results.smtp = smtp;
  appendLog(`SMTP: ${smtp.ok ? "✓" : "✗"} ${smtp.detail}`);

  // Files
  const files = checkFiles();
  results.files = files;
  if (files.ok) {
    appendLog("Files: ✓ all readable, all under size limit");
  } else {
    files.issues.forEach((i) => appendLog(`Files: ✗ ${i}`));
  }

  // Data dir
  const data = checkDataDir();
  results.data = data;
  appendLog(`Data: ${data.ok ? "✓" : "✗"} ${data.detail}`);

  // Scheduler
  const scheduler = checkSchedulerLog();
  results.scheduler = scheduler;
  appendLog(`Scheduler: ${scheduler.ok ? "✓" : "⚠"} ${scheduler.detail}`);

  const allOk = smtp.ok && files.ok && data.ok;
  appendLog(`=== Health Check END — overall: ${allOk ? "HEALTHY" : "ISSUES FOUND"} ===`);

  return { allOk, results };
}

// ─── Run standalone ───────────────────────────────────────────────────────────
// Only execute when run directly — not when imported by scheduler.js

import { pathToFileURL } from "url";

if (pathToFileURL(process.argv[1]).href === import.meta.url) {
  checkHealth().then(({ allOk }) => {
    if (!allOk) {
      console.error("\n⚠ Health check found issues — see data/health.log for details");
      process.exit(1);
    } else {
      console.log("\n✓ All systems healthy");
      process.exit(0);
    }
  }).catch((err) => {
    appendLog(`UNHANDLED: ${err?.message || err}`);
    process.exit(1);
  });
}
