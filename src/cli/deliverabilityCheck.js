// src/cli/deliverabilityCheck.js
// Weekly email deliverability health check.
// Reports bounce rate, opt-outs, SMTP status, and recommendations.
// Runs standalone (npm run deliverability) or is called by scheduler weekly.

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { createTransport } from "nodemailer";
import dotenv from "dotenv";

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const DATA_DIR = path.join(ROOT, "data");
const REPORT_PATH = path.join(DATA_DIR, "deliverability.json");

// Statuses that indicate an email was actually sent
const SENT_STATUSES = new Set([
  "sent",
  "followup_1_sent",
  "followup_2_sent",
  "followup_3_sent",
  "personal_followup_sent",
  "cooling_off",
  "bounced",
  "unsubscribed",
  "opted-out",
]);

function readJsonSafe(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, "utf-8"));
  } catch {
    return fallback;
  }
}

function computeMetrics() {
  const dental  = readJsonSafe(path.join(DATA_DIR, "outreach.localDentists.json"), []);
  const physio  = readJsonSafe(path.join(DATA_DIR, "outreach.physioClinics.json"), []);
  const salon   = readJsonSafe(path.join(DATA_DIR, "outreach.salonBusinesses.json"), []);
  const all     = [...dental, ...physio, ...salon];

  // Historical — what was actually sent and what happened
  const contacted  = all.filter(c => SENT_STATUSES.has(c.status)).length;
  const bounced    = all.filter(c => c.status === "bounced").length;
  const optedOut   = all.filter(c => c.status === "unsubscribed" || c.status === "opted-out").length;
  const replied    = all.filter(c => c.replied).length;
  const noMx       = all.filter(c => c.status === "no_mx").length;
  const badEmail   = all.filter(c => c.status === "skip_bad_email").length;
  const inSequence = all.filter(c => c.status === "in_sequence").length;

  // Forward-looking — clean pipeline ready for next sends
  const mxValidatedReady   = all.filter(c => c.status === "todo" && c.mxValidated && !c.excludeForever && c.email).length;
  const unvalidatedTodo    = all.filter(c => c.status === "todo" && !c.mxValidated && !c.excludeForever && c.email).length;
  const permanentlyBlocked = all.filter(c => c.excludeForever).length;

  const bounceRate  = contacted > 0 ? (bounced / contacted * 100) : 0;
  const optOutRate  = contacted > 0 ? (optedOut / contacted * 100) : 0;
  const replyRate   = contacted > 0 ? (replied / contacted * 100) : 0;

  const breakdown = {};
  all.forEach(c => { breakdown[c.status] = (breakdown[c.status] || 0) + 1; });

  return {
    totalInDb: all.length,
    contacted,
    bounced,
    optedOut,
    replied,
    noMx,
    badEmail,
    inSequence,
    mxValidatedReady,
    unvalidatedTodo,
    permanentlyBlocked,
    bounceRate: parseFloat(bounceRate.toFixed(2)),
    optOutRate: parseFloat(optOutRate.toFixed(2)),
    replyRate:  parseFloat(replyRate.toFixed(2)),
    breakdown,
  };
}

function assessHealth(metrics) {
  const issues = [];
  const warnings = [];
  const goods = [];

  // Bounce rate thresholds (industry: <2% excellent, <5% ok, >8% critical)
  if (metrics.bounceRate >= 8) {
    issues.push(`Bounce rate ${metrics.bounceRate}% is CRITICAL (>8%) — Gmail may throttle or block sending`);
  } else if (metrics.bounceRate >= 5) {
    warnings.push(`Bounce rate ${metrics.bounceRate}% is elevated (5–8%) — monitor closely`);
  } else if (metrics.bounceRate >= 2) {
    warnings.push(`Bounce rate ${metrics.bounceRate}% is acceptable but rising — consider list hygiene`);
  } else {
    goods.push(`Bounce rate ${metrics.bounceRate}% is excellent (<2%)`);
  }

  // Opt-out rate (>1% is a spam signal)
  if (metrics.optOutRate >= 2) {
    issues.push(`Opt-out rate ${metrics.optOutRate}% is high — subject lines or targeting need review`);
  } else if (metrics.optOutRate >= 1) {
    warnings.push(`Opt-out rate ${metrics.optOutRate}% is approaching threshold (1%)`);
  } else {
    goods.push(`Opt-out rate ${metrics.optOutRate}% is healthy`);
  }

  // Reply rate (good proxy for inbox delivery — if people reply, it landed)
  if (metrics.replyRate >= 2) {
    goods.push(`Reply rate ${metrics.replyRate}% is strong — emails are landing in inbox`);
  } else if (metrics.replyRate >= 0.5) {
    goods.push(`Reply rate ${metrics.replyRate}% is normal for cold outreach`);
  } else if (metrics.contacted >= 50) {
    warnings.push(`Reply rate ${metrics.replyRate}% is low — may indicate spam folder placement`);
  }

  // Bad email / no MX
  if (metrics.noMx + metrics.badEmail > 20) {
    warnings.push(`${metrics.noMx + metrics.badEmail} addresses with bad MX or bad format — enrichment quality may be degrading`);
  }

  // Overall
  const status = issues.length > 0 ? "CRITICAL" : warnings.length > 0 ? "WARNING" : "HEALTHY";

  return { status, issues, warnings, goods };
}

function buildRecommendations(metrics, health) {
  const recs = [];

  if (metrics.bounceRate >= 8) {
    recs.push("URGENT: Pause sending for 48h and remove all bounced addresses from future sends");
    recs.push("Run MX validation on the next batch before sending (nslookup on each domain)");
    recs.push("Verify SPF/DKIM/DMARC at mxtoolbox.com — one failed record can cause cascade rejection");
  }

  if (metrics.bounceRate >= 5) {
    recs.push("Remove the 31 bounced clinics from future sends — they are dragging your sender score");
    recs.push("Consider reducing daily send volume to 30/day for 2 weeks to rebuild reputation");
  }

  if (metrics.optOutRate >= 1) {
    recs.push("A/B test subject lines — current rate signals the opening hook isn't resonating");
    recs.push("Segment by city — French QC clinics may need a different approach");
  }

  if (health.status === "HEALTHY") {
    recs.push("Deliverability is strong — safe to increase daily send cap by 10-15 emails");
    recs.push("Consider adding a warm-up sequence for new email domains if you expand");
  }

  recs.push("Verify at mxtoolbox.com: SPF, DKIM, DMARC for clinicflowautomation.com");
  recs.push("Check Gmail Postmaster Tools for domain reputation at postmaster.google.com");

  return recs;
}

async function checkSmtp() {
  try {
    const transporter = createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT || 587),
      secure: (process.env.SMTP_SECURE || "").toLowerCase() === "true",
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
      tls: { rejectUnauthorized: false },
      connectionTimeout: 10_000,
    });
    await transporter.verify();
    return { ok: true, detail: `${process.env.SMTP_HOST} reachable` };
  } catch (err) {
    return { ok: false, detail: err.message };
  }
}

async function sendReport(report) {
  const to = process.env.REPORT_EMAIL || process.env.SMTP_USER;
  if (!to) return;

  const { metrics, health, recommendations } = report;

  const statusEmoji = health.status === "HEALTHY" ? "✅" : health.status === "WARNING" ? "⚠️" : "🚨";
  const lines = [
    `${statusEmoji} Email Deliverability Report — ${report.date}`,
    `Status: ${health.status}`,
    "",
    "=== METRICS ===",
    `Total in database:  ${metrics.totalInDb.toLocaleString()}`,
    `Ever contacted:     ${metrics.contacted}`,
    `Bounced:            ${metrics.bounced} (${metrics.bounceRate}%)`,
    `Opted out:          ${metrics.optedOut} (${metrics.optOutRate}%)`,
    `Replied:            ${metrics.replied} (${metrics.replyRate}%)`,
    `No MX / bad email:  ${metrics.noMx + metrics.badEmail}`,
    "",
  ];

  if (health.issues.length)   lines.push("🚨 ISSUES:", ...health.issues.map(i => `  • ${i}`), "");
  if (health.warnings.length) lines.push("⚠️ WARNINGS:", ...health.warnings.map(w => `  • ${w}`), "");
  if (health.goods.length)    lines.push("✅ GOOD:", ...health.goods.map(g => `  • ${g}`), "");

  lines.push("=== RECOMMENDATIONS ===", ...recommendations.map(r => `  → ${r}`), "");
  lines.push(`SMTP: ${report.smtp.ok ? "✓ connected" : "✗ " + report.smtp.detail}`);
  lines.push("Check SPF/DKIM/DMARC: https://mxtoolbox.com/SuperTool.aspx");

  try {
    const transporter = createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT || 587),
      secure: (process.env.SMTP_SECURE || "").toLowerCase() === "true",
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
      tls: { rejectUnauthorized: false },
    });
    await transporter.sendMail({
      from: `ClinicFlow System <${process.env.SMTP_USER}>`,
      to,
      subject: `${statusEmoji} Deliverability ${health.status} — ${report.date}`,
      text: lines.join("\n"),
    });
    console.log(`Report emailed to ${to}`);
  } catch (err) {
    console.error("Failed to send report email:", err.message);
  }
}

export async function runDeliverabilityCheck({ silent = false } = {}) {
  const date = new Date().toISOString().slice(0, 10);

  const metrics        = computeMetrics();
  const health         = assessHealth(metrics);
  const recommendations = buildRecommendations(metrics, health);
  const smtp           = await checkSmtp();

  const report = { date, metrics, health, recommendations, smtp, generatedAt: new Date().toISOString() };

  // Persist report
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));

  if (!silent) {
    const statusEmoji = health.status === "HEALTHY" ? "✅" : health.status === "WARNING" ? "⚠️" : "🚨";
    console.log(`\n${statusEmoji}  DELIVERABILITY ${health.status} — ${date}`);
    console.log(`\n── Historical (what already sent) ──────────────────────`);
    console.log(`   Contacted: ${metrics.contacted} | Bounced: ${metrics.bounced} (${metrics.bounceRate}%) | Replied: ${metrics.replied} (${metrics.replyRate}%)`);
    console.log(`   Opted out: ${metrics.optedOut} (${metrics.optOutRate}%) | Blocked forever: ${metrics.permanentlyBlocked}`);
    console.log(`\n── Forward pipeline (next sends) ───────────────────────`);
    console.log(`   MX-validated & ready:  ${metrics.mxValidatedReady}`);
    console.log(`   Not yet validated:     ${metrics.unvalidatedTodo} (need MX check before send)`);
    console.log(`   Permanently excluded:  ${metrics.permanentlyBlocked}`);
    if (health.issues.length)   { console.log(""); health.issues.forEach(i => console.log(`   🚨 ${i}`)); }
    if (health.warnings.length) { console.log(""); health.warnings.forEach(w => console.log(`   ⚠️  ${w}`)); }
    if (health.goods.length)    { console.log(""); health.goods.forEach(g => console.log(`   ✅ ${g}`)); }
    console.log("\nRecommendations:");
    recommendations.forEach(r => console.log(`   → ${r}`));
    console.log(`\nSMTP: ${smtp.ok ? "✓" : "✗"} ${smtp.detail}`);
    console.log(`Report saved: ${REPORT_PATH}`);
  }

  await sendReport(report);
  return report;
}

// ─── Standalone entry point ───────────────────────────────────────────────────

import { pathToFileURL } from "url";
if (pathToFileURL(process.argv[1]).href === import.meta.url) {
  runDeliverabilityCheck().catch(err => {
    console.error("Deliverability check failed:", err.message);
    process.exit(1);
  });
}
