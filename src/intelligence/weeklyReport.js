// src/intelligence/weeklyReport.js
// Runs all intelligence scrapers and sends a weekly market intelligence email.
// Invoked by scheduler.js every Monday at 07:00.
// Run manually: node src/intelligence/weeklyReport.js

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { execFile } from "child_process";
import { promisify } from "util";
import nodemailer from "nodemailer";
import dotenv from "dotenv";

dotenv.config();

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT      = path.resolve(__dirname, "../..");
const INTEL_DIR = path.join(ROOT, "data", "intelligence");

const NOTIFY_EMAIL = process.env.NOTIFY_EMAIL || "m.aliben432@gmail.com";

function readJsonSafe(p, fb) {
  try { return JSON.parse(fs.readFileSync(p, "utf-8")); } catch { return fb; }
}

async function runScript(relPath, args = []) {
  const scriptPath = path.join(ROOT, relPath);
  try {
    const { stdout } = await execFileAsync(process.execPath, [scriptPath, ...args], {
      cwd: ROOT, env: process.env, timeout: 10 * 60 * 1000,
    });
    return { ok: true, output: stdout.trim().slice(0, 500) };
  } catch (e) {
    return { ok: false, error: e.message.slice(0, 200) };
  }
}

function buildEmailBody() {
  const tech       = readJsonSafe(path.join(INTEL_DIR, "tech-stack.json"), null);
  const reviews    = readJsonSafe(path.join(INTEL_DIR, "reviews-analysis.json"), null);
  const audit      = readJsonSafe(path.join(INTEL_DIR, "audit-patterns.json"), null);
  const competitor = readJsonSafe(path.join(INTEL_DIR, "competitor-gaps.json"), null);

  const lines = [
    `ClinicFlow — Weekly Market Intelligence`,
    `Generated: ${new Date().toLocaleString("en-CA")}`,
    ``,
    `═══════════════════════════════════════`,
    `TECH STACK (website scan)`,
    `═══════════════════════════════════════`,
  ];

  if (tech?.stats) {
    const s = tech.stats;
    lines.push(`Clinics scanned:          ${s.totalScanned}`);
    lines.push(`With booking software:    ${s.withBookingSoftware} (${Math.round(s.withBookingSoftware / s.reachable * 100)}%)`);
    lines.push(`With online booking:      ${s.withOnlineBooking} (${Math.round(s.withOnlineBooking / s.reachable * 100)}%)`);
    lines.push(`Without any booking tool: ${s.reachable - s.withBookingSoftware} — PRIME TARGETS`);
    lines.push(``);
    lines.push(`Most common booking systems:`);
    (tech.stats.bookingSystemRanking || []).slice(0, 5).forEach((b, i) =>
      lines.push(`  ${i + 1}. ${b.name} — ${b.count} clinics (${b.pct})`)
    );
  } else {
    lines.push("No tech stack data. Run: node src/intelligence/techDetector.js");
  }

  lines.push(``);
  lines.push(`═══════════════════════════════════════`);
  lines.push(`PATIENT COMPLAINTS (review signals)`);
  lines.push(`═══════════════════════════════════════`);

  if (reviews?.topComplaints?.length > 0) {
    lines.push(`Clinics with pain signals: ${reviews.clinicsWithPainSignals} / ${reviews.totalAnalysed}`);
    lines.push(``);
    lines.push(`Top communication complaints:`);
    reviews.topComplaints.slice(0, 5).forEach((t, i) =>
      lines.push(`  ${i + 1}. "${t.keyword}" — ${t.count} clinics`)
    );
  } else {
    lines.push("No reviews data. Run: node src/intelligence/reviewsScraper.js");
  }

  lines.push(``);
  lines.push(`═══════════════════════════════════════`);
  lines.push(`AUDIT INSIGHTS (${audit?.totalAudits ?? 0} responses)`);
  lines.push(`═══════════════════════════════════════`);

  if (audit?.totalAudits > 0) {
    const p = audit.patterns;
    const topBooking   = p.bookingSystems?.[0];
    const topMissed    = p.missedCallHandling?.[0];
    const topReminder  = p.reminderAdoption?.[0];
    const topReact     = p.reactivationAdoption?.[0];
    if (topBooking)  lines.push(`Most common booking system:    ${topBooking.label} (${topBooking.pct})`);
    if (topMissed)   lines.push(`Most common missed call resp:  ${topMissed.label} (${topMissed.pct})`);
    if (topReminder) lines.push(`Reminder adoption:             ${topReminder.label} (${topReminder.pct})`);
    if (topReact)    lines.push(`Reactivation adoption:         ${topReact.label} (${topReact.pct})`);
  } else {
    lines.push("No audit responses yet.");
  }

  lines.push(``);
  lines.push(`═══════════════════════════════════════`);
  lines.push(`COMPETITOR SUMMARY`);
  lines.push(`═══════════════════════════════════════`);

  if (competitor?.competitors?.length > 0) {
    competitor.competitors.forEach(c => {
      lines.push(`${c.name}:`);
      lines.push(`  Monthly fees: ${c.isMonthlyBilling ? "YES" : "No"} | Done-for-you: ${c.hasDoneForYou ? "Yes" : "NO"} | Missed call feature: ${c.hasMissedCallRecovery ? "Yes" : "NO"}`);
      if (c.pricingFound?.length > 0) lines.push(`  Pricing: ${c.pricingFound.slice(0, 3).join(", ")}`);
    });
    lines.push(``);
    lines.push(`Our key advantages:`);
    (competitor.clinicFlowDifferentiators || []).slice(0, 4).forEach((d, i) =>
      lines.push(`  ${i + 1}. ${d.gap}`)
    );
  } else {
    lines.push("No competitor data. Run: node src/intelligence/competitorAnalysis.js");
  }

  lines.push(``);
  lines.push(`─────────────────────────────────────`);
  lines.push(`ClinicFlow Intelligence | contact@clinicflowautomation.com`);

  return lines.join("\n");
}

async function sendReport(body) {
  const host = (process.env.SMTP_HOST || "").trim();
  const port = Number(process.env.SMTP_PORT || "587");
  const user = (process.env.SMTP_USER || "").trim();
  const pass = (process.env.SMTP_PASS || "").trim();
  const from = (process.env.SMTP_FROM || user).trim();
  if (!host || !user || !pass) throw new Error("SMTP not configured");

  const transporter = nodemailer.createTransport({
    host, port,
    secure: port === 465,
    auth: { user, pass },
    tls: { rejectUnauthorized: false },
  });

  const week = new Date().toLocaleDateString("en-CA", { month: "short", day: "numeric", year: "numeric" });
  await transporter.sendMail({
    from, to: NOTIFY_EMAIL,
    subject: `This week's market intelligence for ClinicFlow — ${week}`,
    text: body,
  });
}

async function run() {
  console.log("Weekly intelligence report — running all scrapers...\n");

  // Run scrapers with a limit to keep it fast
  const scrapers = [
    { label: "Tech detector",       script: "src/intelligence/techDetector.js",    args: ["--limit", "100"] },
    { label: "Reviews scraper",     script: "src/intelligence/reviewsScraper.js",  args: ["--limit", "50"]  },
    { label: "Audit aggregator",    script: "src/intelligence/auditAggregator.js", args: []                  },
    { label: "Competitor analysis", script: "src/intelligence/competitorAnalysis.js", args: []              },
  ];

  for (const s of scrapers) {
    process.stdout.write(`  Running ${s.label}... `);
    const result = await runScript(s.script, s.args);
    console.log(result.ok ? "✓" : `✗ ${result.error}`);
  }

  const body = buildEmailBody();
  console.log("\n── Email preview ──\n" + body.slice(0, 600) + "\n...\n");

  try {
    await sendReport(body);
    console.log(`✅ Weekly intelligence report sent to ${NOTIFY_EMAIL}`);
  } catch (e) {
    console.error("❌ Failed to send email:", e.message);
    console.log("Report body saved to console above.");
  }
}

run().catch(e => { console.error("Weekly report failed:", e.message); process.exit(1); });
