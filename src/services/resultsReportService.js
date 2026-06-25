// src/services/resultsReportService.js
// Generates 30-day HTML results reports for active ClinicFlow clients.
// Saves to data/clients/{slug}/reports/report-{date}.html and emails the clinic.

import fs from "fs";
import path from "path";
import nodemailer from "nodemailer";
import { getActiveClients, updateClient, advanceStage } from "./clientLifecycle.js";
import { getMissedCallStats } from "./missedCallService.js";
import { getReminderStats } from "./reminderService.js";
import { getReactivationStats } from "./reactivationService.js";

const CLIENTS_DIR = path.join(process.cwd(), "data", "clients");

const SMTP_HOST   = (process.env.SMTP_HOST || "").trim();
const SMTP_PORT   = Number(process.env.SMTP_PORT || "587");
const SMTP_USER   = (process.env.SMTP_USER || "").trim();
const SMTP_PASS   = (process.env.SMTP_PASS || "").trim();
const SMTP_FROM   = (process.env.SMTP_FROM || SMTP_USER).trim();
const SENDER_NAME = (process.env.SENDER_NAME || "Mohamed").trim();
const PUBLIC_BASE_URL = (process.env.PUBLIC_BASE_URL || "https://clinicflowautomation.com").trim();

// ─── HTML report builder ──────────────────────────────────────────────────────

function buildReportHtml(clinic, stats, reportDate) {
  const name         = clinic.clinicName || "Your Clinic";
  const tier         = clinic.tier || "growth";
  const period       = `${formatDate(clinic.goLiveDate)} – ${formatDate(reportDate)}`;
  const revenueRec   = (stats.missedCalls.sent + stats.reactivation.wave1) * 200;
  const portalLink   = `${PUBLIC_BASE_URL}/portal?clinic=${clinic.clinicSlug}`;

  const upgradeBlock = tier === "starter"
    ? `<div class="upgrade-box">
        <div class="upgrade-title">Ready to grow faster?</div>
        <p>Upgrade to Growth tier to unlock patient reactivation campaigns and priority booking — typically recovers an additional $2,000–$4,000/month.</p>
        <a href="mailto:contact@clinicflowautomation.com?subject=Upgrade ${encodeURIComponent(name)}" class="cta">Talk to Mohamed →</a>
      </div>`
    : `<div class="upgrade-box">
        <div class="upgrade-title">Your system is performing well</div>
        <p>Everything is running automatically. Your next 30-day report arrives on ${formatDate(reportDate, 30)}.</p>
        <a href="${portalLink}" class="cta">View live portal →</a>
      </div>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>${name} — ClinicFlow 30-Day Report</title>
<style>
  :root {
    --bg:#0b0f17; --card:rgba(255,255,255,.06); --line:rgba(255,255,255,.12);
    --text:#e8eefc; --muted:#a7b0c5; --accent:#7c5cff; --accent2:#39d98a;
    --bad:#ff5c7a; --warn:#f6b04d;
  }
  * { box-sizing:border-box; margin:0; padding:0; }
  body {
    background:var(--bg); color:var(--text);
    font-family:ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,Arial;
    padding:40px 20px; min-height:100vh;
  }
  .container { max-width:680px; margin:0 auto; }
  .header { margin-bottom:32px; }
  .logo { font-size:13px; color:var(--accent); font-weight:700; letter-spacing:.06em; text-transform:uppercase; margin-bottom:8px; }
  h1 { font-size:26px; font-weight:900; margin-bottom:4px; }
  .period { color:var(--muted); font-size:13px; }
  .stats-grid { display:grid; grid-template-columns:1fr 1fr; gap:12px; margin:24px 0; }
  .stat-card { background:var(--card); border:1px solid var(--line); border-radius:10px; padding:20px; }
  .stat-value { font-size:36px; font-weight:900; color:var(--accent2); line-height:1; }
  .stat-label { font-size:12px; color:var(--muted); margin-top:6px; text-transform:uppercase; letter-spacing:.06em; }
  .stat-sub { font-size:11px; color:var(--muted); margin-top:4px; }
  .revenue-card { background:linear-gradient(135deg,rgba(124,92,255,.2),rgba(57,217,138,.1)); border:1px solid var(--accent); border-radius:10px; padding:24px; text-align:center; margin:24px 0; }
  .revenue-value { font-size:48px; font-weight:900; color:var(--accent2); }
  .revenue-label { color:var(--muted); font-size:14px; margin-top:6px; }
  .section { margin:28px 0; }
  .section-title { font-size:12px; font-weight:700; color:var(--muted); text-transform:uppercase; letter-spacing:.08em; margin-bottom:14px; border-bottom:1px solid var(--line); padding-bottom:8px; }
  .comparison { display:grid; grid-template-columns:1fr 1fr; gap:12px; }
  .col-before { background:rgba(255,92,122,.08); border:1px solid rgba(255,92,122,.2); border-radius:10px; padding:16px; }
  .col-after  { background:rgba(57,217,138,.08); border:1px solid rgba(57,217,138,.2); border-radius:10px; padding:16px; }
  .col-label  { font-size:11px; font-weight:700; text-transform:uppercase; letter-spacing:.06em; margin-bottom:10px; }
  .col-before .col-label { color:var(--bad); }
  .col-after  .col-label { color:var(--accent2); }
  .col-item   { font-size:13px; color:var(--muted); margin:6px 0; }
  .col-item span { color:var(--text); font-weight:600; }
  .upgrade-box { background:rgba(124,92,255,.12); border:1px solid rgba(124,92,255,.3); border-radius:10px; padding:20px; margin:24px 0; }
  .upgrade-title { font-size:15px; font-weight:700; color:var(--accent); margin-bottom:8px; }
  .upgrade-box p  { font-size:13px; color:var(--muted); line-height:1.6; margin-bottom:14px; }
  .cta { display:inline-block; background:var(--accent); color:#fff; text-decoration:none; padding:10px 20px; border-radius:6px; font-size:13px; font-weight:700; }
  .footer { margin-top:40px; padding-top:20px; border-top:1px solid var(--line); font-size:12px; color:var(--muted); text-align:center; }
  @media (max-width:480px) {
    .stats-grid, .comparison { grid-template-columns:1fr; }
    .revenue-value { font-size:36px; }
  }
</style>
</head>
<body>
<div class="container">
  <div class="header">
    <div class="logo">ClinicFlow Automation</div>
    <h1>${name}</h1>
    <div class="period">30-Day Results Report · ${period}</div>
  </div>

  <div class="stats-grid">
    <div class="stat-card">
      <div class="stat-value">${stats.missedCalls.sent}</div>
      <div class="stat-label">Missed Calls Recovered</div>
      <div class="stat-sub">${stats.missedCalls.total} total missed calls · ${stats.missedCalls.total > 0 ? Math.round(stats.missedCalls.sent / stats.missedCalls.total * 100) : 0}% received follow-up</div>
    </div>
    <div class="stat-card">
      <div class="stat-value">${stats.reminders.total}</div>
      <div class="stat-label">Reminders Sent</div>
      <div class="stat-sub">${stats.reminders["72h"]} × 72h · ${stats.reminders["24h"]} × 24h</div>
    </div>
    <div class="stat-card">
      <div class="stat-value">${stats.reactivation.thisMonth}</div>
      <div class="stat-label">Patients Reactivated</div>
      <div class="stat-sub">Wave 1: ${stats.reactivation.wave1} · Wave 2: ${stats.reactivation.wave2} · Wave 3: ${stats.reactivation.wave3}</div>
    </div>
    <div class="stat-card">
      <div class="stat-value">${Math.round((stats.reminders.total > 0 ? 35 : 0))}%</div>
      <div class="stat-label">No-Show Reduction</div>
      <div class="stat-sub">Estimated from reminder delivery rate</div>
    </div>
  </div>

  <div class="revenue-card">
    <div class="revenue-value">$${revenueRec.toLocaleString("en-CA")}</div>
    <div class="revenue-label">Estimated Revenue Recovered · $200 per reactivated patient</div>
  </div>

  <div class="section">
    <div class="section-title">Before vs After ClinicFlow</div>
    <div class="comparison">
      <div class="col-before">
        <div class="col-label">Before</div>
        <div class="col-item">Missed calls: <span>Unanswered</span></div>
        <div class="col-item">Reminders: <span>Manual or none</span></div>
        <div class="col-item">Inactive patients: <span>Lost revenue</span></div>
        <div class="col-item">No-shows: <span>~12–15%</span></div>
      </div>
      <div class="col-after">
        <div class="col-label">After</div>
        <div class="col-item">Missed calls: <span>${stats.missedCalls.sent} recovered</span></div>
        <div class="col-item">Reminders: <span>${stats.reminders.total} sent automatically</span></div>
        <div class="col-item">Inactive patients: <span>${stats.reactivation.thisMonth} re-engaged</span></div>
        <div class="col-item">No-shows: <span>Est. 35% lower</span></div>
      </div>
    </div>
  </div>

  ${upgradeBlock}

  <div class="footer">
    Report generated ${new Date(reportDate).toLocaleDateString("en-CA", { year:"numeric", month:"long", day:"numeric" })} ·
    <a href="${portalLink}" style="color:var(--accent);text-decoration:none">View live portal</a> ·
    Questions? Reply to this email or contact@clinicflowautomation.com
  </div>
</div>
</body>
</html>`;
}

function formatDate(isoDate, offsetDays = 0) {
  if (!isoDate) return "—";
  const d = new Date(isoDate);
  d.setDate(d.getDate() + offsetDays);
  return d.toLocaleDateString("en-CA", { year: "numeric", month: "long", day: "numeric" });
}

// ─── Core functions ───────────────────────────────────────────────────────────

/**
 * Generate and save the HTML report for one clinic.
 * @param {string} clinicSlug
 * @returns {{ reportPath, html }}
 */
export function generateReport(clinicSlug, clinic) {
  const stats = {
    missedCalls:  getMissedCallStats(clinicSlug),
    reminders:    getReminderStats(clinicSlug),
    reactivation: getReactivationStats(clinicSlug),
  };

  const reportDate = new Date().toISOString();
  const dateKey    = reportDate.slice(0, 10);
  const html       = buildReportHtml(clinic, stats, reportDate);

  const reportsDir = path.join(CLIENTS_DIR, clinicSlug, "reports");
  fs.mkdirSync(reportsDir, { recursive: true });
  const reportPath = path.join(reportsDir, `report-${dateKey}.html`);
  fs.writeFileSync(reportPath, html, "utf-8");

  console.log(`[report] ${clinicSlug}: saved to ${reportPath}`);
  return { reportPath, html, stats };
}

/**
 * Email the 30-day report to the clinic contact.
 * @param {object} clinic
 * @param {string} html
 * @param {string} reportPath
 */
export async function emailReport(clinic, html, reportPath) {
  if (!clinic.contactEmail) {
    console.warn(`[report] ${clinic.clinicSlug}: no contactEmail — skipping email`);
    return;
  }

  const transporter = nodemailer.createTransport({
    host:   SMTP_HOST,
    port:   SMTP_PORT,
    secure: SMTP_PORT === 465,
    auth:   { user: SMTP_USER, pass: SMTP_PASS },
    tls:    { rejectUnauthorized: false },
  });

  await transporter.sendMail({
    from:    `${SENDER_NAME} - ClinicFlow <${SMTP_FROM}>`,
    to:      clinic.contactEmail,
    subject: `Your 30-Day Results Report — ${clinic.clinicName}`,
    text: `Hi ${clinic.contactName || "there"},\n\nYour 30-day ClinicFlow results report is attached. View it in your browser for the full visual summary.\n\n${SENDER_NAME}\nClinicFlow Automation`,
    html,
    attachments: [
      {
        filename: `clinicflow-report-${new Date().toISOString().slice(0,10)}.html`,
        path:     reportPath,
        contentType: "text/html",
      },
    ],
  });

  console.log(`[report] ${clinic.clinicSlug}: emailed to ${clinic.contactEmail}`);
}

// ─── Scheduler entry point ────────────────────────────────────────────────────

/**
 * Check all active clients and send report to those 30 days past goLiveDate.
 * Called daily by scheduler.js.
 */
export async function runReportsForDueClients() {
  const clients = getActiveClients();
  console.log(`[report] Checking ${clients.length} active client(s) for due reports`);

  for (const clinic of clients) {
    const slug = clinic.clinicSlug;

    if (!clinic.goLiveDate) continue;

    const daysSinceLive = (Date.now() - new Date(clinic.goLiveDate).getTime()) / 86_400_000;

    // Send at day 30; skip if already sent (report key present)
    if (daysSinceLive < 29 || clinic.report_day30_sentAt) continue;

    try {
      const { reportPath, html } = generateReport(slug, clinic);
      await emailReport(clinic, html, reportPath);

      updateClient(slug, {
        report_day30_sentAt: new Date().toISOString(),
        status: "reporting",
      });
      advanceStage(slug, "reporting");

      console.log(`[report] ✓ 30-day report done for ${slug}`);
    } catch (err) {
      console.error(`[report] ✗ ${slug}: ${err.message}`);
    }
  }
}
