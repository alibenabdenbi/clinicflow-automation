// src/scheduler.js
// Autonomous daily runner — schedules all pipeline jobs without any external dependencies.
// Run with: node src/scheduler.js  (or npm run scheduler)

import { execFile } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import { checkHealth } from "./monitors/healthCheck.js";
import { checkReplies } from "./services/replyHandler.js";
import { sendSMS } from "./services/smsService.js";

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const LOG_PATH = path.join(ROOT, "data", "scheduler.log");
const DATA_DIR = path.join(ROOT, "data");

// ─── Logging ─────────────────────────────────────────────────────────────────

function appendLog(msg) {
  const ts = new Date().toISOString();
  const line = `[${ts}] ${msg}`;
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.appendFileSync(LOG_PATH, line + "\n", "utf-8");
  console.log(line);
}

// ─── Job runner ──────────────────────────────────────────────────────────────

function runScript(relPath, extraArgs = [], { timeoutMs = 15 * 60 * 1000 } = {}) {
  const scriptPath = path.join(ROOT, relPath);
  const label = extraArgs.length ? `${relPath} ${extraArgs.join(" ")}` : relPath;

  return new Promise((resolve) => {
    appendLog(`START  ${label}`);

    execFile(
      process.execPath, // current node binary
      [scriptPath, ...extraArgs],
      {
        cwd: ROOT,
        env: process.env, // inherit dotenv-loaded vars
        timeout: timeoutMs,
      },
      (err, stdout, stderr) => {
        if (stdout) appendLog(`OUTPUT ${label}: ${stdout.trim().slice(0, 800)}`);
        if (err) {
          const errMsg = err.message || String(err);
          appendLog(`ERROR  ${label}: ${errMsg.slice(0, 500)}`);
          if (stderr) appendLog(`STDERR ${label}: ${stderr.trim().slice(0, 300)}`);
          resolve({ label, ok: false, error: errMsg });
        } else {
          appendLog(`DONE   ${label}`);
          resolve({ label, ok: true });
        }
      }
    );
  });
}

// ─── Scheduler helpers ───────────────────────────────────────────────────────

/**
 * Returns milliseconds until the next occurrence of HH:MM today or tomorrow.
 */
function msUntil(hour, minute = 0) {
  const now = new Date();
  const target = new Date();
  target.setHours(hour, minute, 0, 0);
  if (target <= now) {
    // already passed today — schedule for tomorrow
    target.setDate(target.getDate() + 1);
  }
  return target.getTime() - now.getTime();
}

function hhmm(hour, minute = 0) {
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

/**
 * Schedules a job to run at HH:MM every day.
 * Never throws — errors are logged and the next day's run is still scheduled.
 */
function scheduleInterval(intervalMs, label, fn) {
  appendLog(`Scheduled "${label}" → every ${Math.round(intervalMs / 60000)} min`);
  const tick = async () => {
    appendLog(`=== JOB START: ${label} ===`);
    try { await fn(); } catch (err) {
      appendLog(`UNHANDLED in "${label}": ${err?.message || err}`);
    }
    appendLog(`=== JOB END: ${label} ===`);
  };
  // Run once at start after a short delay, then on interval
  setTimeout(tick, 60_000);
  setInterval(tick, intervalMs);
}

function scheduleDaily(hour, minute, label, fn) {
  const delay = msUntil(hour, minute);
  const inMin = Math.round(delay / 60000);
  appendLog(`Scheduled "${label}" → ${hhmm(hour, minute)} daily (next run in ${inMin}min)`);

  const tick = async () => {
    appendLog(`=== JOB START: ${label} ===`);
    try {
      await fn();
    } catch (err) {
      appendLog(`UNHANDLED in "${label}": ${err?.message || err}`);
    }
    appendLog(`=== JOB END: ${label} ===`);
    // Re-schedule for the same time tomorrow
    setTimeout(tick, msUntil(hour, minute));
  };

  setTimeout(tick, delay);
}

// ─── Daily summary (6 PM) ────────────────────────────────────────────────────

function readJsonSafe(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, "utf-8"));
  } catch {
    return fallback;
  }
}

function todayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function buildDailySummary() {
  const today = todayKey();

  // Leads
  const crmLeads = readJsonSafe(path.join(DATA_DIR, "crm.leads.json"), []);
  const totalLeads = Array.isArray(crmLeads) ? crmLeads.length : 0;
  const newToday = Array.isArray(crmLeads)
    ? crmLeads.filter((l) => (l.createdAt || "").startsWith(today)).length
    : 0;

  // Emails
  const sendLog = readJsonSafe(path.join(DATA_DIR, "smtp.sendlog.json"), {});
  const emailsSentToday = Number(sendLog[today] || 0);

  // Outreach queue
  const dentists = readJsonSafe(path.join(DATA_DIR, "outreach.localDentists.json"), []);
  const emailsPending = Array.isArray(dentists)
    ? dentists.filter((d) => (d.status || "todo") === "todo" && d.email).length
    : 0;
  const followupsDue = Array.isArray(dentists)
    ? dentists.filter((d) => {
        if (d.status !== "sent" || !d.followupDueAt) return false;
        return new Date(d.followupDueAt) <= new Date();
      }).length
    : 0;

  // Errors from today's log
  let todayErrors = [];
  try {
    if (fs.existsSync(LOG_PATH)) {
      const lines = fs.readFileSync(LOG_PATH, "utf-8").split("\n");
      todayErrors = lines.filter(
        (l) => l.includes(`[${today}`) && l.includes("ERROR")
      );
    }
  } catch {
    // ignore
  }

  const lines = [
    "╔══════════════════════════════════════╗",
    "║      ORE-Engine Daily Summary        ║",
    `╠══════════════════════════════════════╣`,
    `║ Date:              ${today.padEnd(18)}║`,
    `║ CRM leads total:   ${String(totalLeads).padEnd(18)}║`,
    `║ New leads today:   ${String(newToday).padEnd(18)}║`,
    `║ Emails sent today: ${String(emailsSentToday).padEnd(18)}║`,
    `║ Emails pending:    ${String(emailsPending).padEnd(18)}║`,
    `║ Follow-ups due:    ${String(followupsDue).padEnd(18)}║`,
    `║ Errors today:      ${String(todayErrors.length).padEnd(18)}║`,
    "╚══════════════════════════════════════╝",
  ];

  if (todayErrors.length > 0) {
    lines.push("");
    lines.push("Errors:");
    todayErrors.slice(0, 5).forEach((e) => lines.push("  " + e.trim()));
  }

  return lines.join("\n");
}

// ─── Job definitions ─────────────────────────────────────────────────────────

// 08:00 — Full discovery pipeline

// Click sync — every hour (caches Netlify click data locally)
setInterval(async () => {
  try { await runScript("src/cli/syncClicks.js"); } catch(e) {}
}, 60 * 60 * 1000);

// Reply monitor — every 15 minutes (mission critical)
setInterval(async () => {
  try {
    const { checkForReplies } = await import('./monitors/replyMonitor.js');
    const result = await checkForReplies();
    if (result.newReplies?.length > 0) {
      appendLog(`📧 ${result.newReplies.length} new replies detected`);
    }
  } catch(e) { console.error('Reply monitor error:', e.message); }
}, 15 * 60 * 1000);

// Run 10s after startup to catch any missed replies
setTimeout(async () => {
  try {
    const { checkForReplies } = await import('./monitors/replyMonitor.js');
    await checkForReplies();
  } catch(e) { console.error('Startup reply check:', e.message); }
}, 10000);

scheduleDaily(8, 0, "Full Pipeline (main.js)", async () => {
  await runScript("src/main.js");
});

// 07:00 Monday — ClinicFlow Weekly newsletter to all validated clinics
scheduleDaily(7, 0, "ClinicFlow Weekly Newsletter (Monday)", async () => {
  if (new Date().getDay() !== 1) return; // Monday only
  await runScript("src/cli/sendWeeklyDigest.js", [], { timeoutMs: 60 * 60 * 1000 });
});

// Victoria Day follow-up — Tuesday May 19 at 8:30am ONLY
scheduleDaily(8, 30, "Victoria Day Follow-up (May 19 only)", async () => {
  const now = new Date();
  const isTuesdayMay19 = now.getDate() === 19 &&
    now.getMonth() === 4 && // May = index 4
    now.getDay() === 2;     // Tuesday = 2
  if (!isTuesdayMay19) return;
  await runScript("src/cli/sendVictoriaDayFollowup.js");
});

// 09:00 — Pilot offer follow-ups (24-72h window, once per clinic)
scheduleDaily(9, 0, "Pilot Follow-ups", async () => {
  await runScript("src/cli/sendPilotFollowups.js");
});

// 10:30 — Association follow-ups: send when sendDate matches today
scheduleDaily(10, 30, "Association Follow-ups", async () => {
  try {
    const followupPath = path.join(DATA_DIR, 'associations/followups-scheduled.json');
    if (!fs.existsSync(followupPath)) return;
    const followups = JSON.parse(fs.readFileSync(followupPath, 'utf-8'));
    const today = new Date().toISOString().slice(0, 10);
    const toSend = followups.filter(f => f.sendDate === today && !f.sent);
    if (toSend.length === 0) return;
    const { sendMail } = await import('./services/mailer.js');
    for (const f of toSend) {
      await sendMail({ to: f.to, subject: f.subject, text: f.body });
      const idx = followups.findIndex(x => x.to === f.to && x.sendDate === f.sendDate);
      if (idx !== -1) { followups[idx].sent = true; followups[idx].sentAt = new Date().toISOString(); }
      appendLog('Association follow-up sent: ' + f.assoc);
      await new Promise(r => setTimeout(r, 5000));
    }
    fs.writeFileSync(followupPath, JSON.stringify(followups, null, 2));
  } catch(e) {
    appendLog('Association follow-up error: ' + e.message);
  }
});

// 9:15 — Hit list multi-touch sequence (Mon-Fri)
scheduleDaily(9, 15, "Hit List Sequence", async () => {
  const day = new Date().getDay();
  if (day === 0 || day === 6) return;
  await runScript("src/cli/runHitListSequence.js");
});

// 9:32 — Screenshot campaign (Mon/Tue/Wed only — named prospects)
scheduleDaily(9, 32, "Screenshot Campaign (named prospects)", async () => {
  const day = new Date().getDay(); // 1=Mon 2=Tue 3=Wed
  if (![1, 2, 3].includes(day)) return;
  await runScript("src/cli/runScreenshotCampaign.js", ["--limit", "10"]);
});

// 09:00 — Pre-send email scraper (Tuesday only, 1 hour before batch)
scheduleDaily(9, 0, "Pre-Send Email Scraper (Tuesday)", async () => {
  if (new Date().getDay() !== 2) return;
  try {
    await runScript("src/cli/scrapeVerifiedEmails.js", ["--limit", "100"], { timeoutMs: 15 * 60 * 1000 });
    appendLog("Pre-send scrape complete");
  } catch (e) {
    appendLog("Pre-send scraper error: " + e.message);
  }
});

// 10:00 — First email batch (initial sends restricted to Tue/Wed/Thu)
scheduleDaily(10, 0, "Send Batch (morning)", async () => {
  const day = new Date().getDay(); // 2=Tue 3=Wed 4=Thu
  if (![2, 3, 4].includes(day)) {
    appendLog("Send Batch (morning): skipping initial sends — not Tue/Wed/Thu");
    return;
  }
  await runScript("src/cli/sendBatch.js", [], { timeoutMs: 60 * 60 * 1000 });
});

// 11:00 — Follow-ups
scheduleDaily(11, 0, "Send Follow-ups", async () => {
  await runScript("src/cli/sendFollowups.js");
});

// 11:00 — Export dashboard stats (after morning send + followups complete)
scheduleDaily(11, 0, "Export Dashboard Stats", async () => {
  await runScript("src/cli/exportDashboardStats.js");
});

// 11:05 — Export inbound summary (SMS + calls) for dashboard
scheduleDaily(11, 5, "Export Inbound Summary", async () => {
  await runScript("src/cli/exportInboundSummary.js");
});

// 11:30 — Post-call follow-up emails (24h after Twilio calls)
scheduleDaily(11, 30, "Call Follow-up Emails", async () => {
  await runScript("src/cli/sendCallFollowups.js");
});

// 11:30 — Voicemail follow-up emails (24h after Slybroadcast drops)
scheduleDaily(11, 30, "Voicemail Drop Follow-ups", async () => {
  await runScript("src/cli/sendVoicemailFollowup.js");
});

// 13:00 ET (10:00 PT) — Dental batch for Pacific timezone clinics
scheduleDaily(13, 0, "Send Batch (dental PT)", async () => {
  const day = new Date().getDay();
  if (![2, 3, 4].includes(day)) return; // Tue/Wed/Thu only
  await runScript("src/cli/sendBatch.js", ["--tz", "PT"], { timeoutMs: 60 * 60 * 1000 });
});

// 15:00 — Physio email batch
scheduleDaily(15, 0, "Send Batch (physio)", async () => {
  await runScript("src/cli/sendBatch.js", ["--market", "physio"], { timeoutMs: 60 * 60 * 1000 });
});

// 15:30 Tue/Wed/Thu — Send salon/spa outreach batch
scheduleDaily(15, 30, "Send Batch (salon)", async () => {
  const day = new Date().getDay();
  if (![2, 3, 4].includes(day)) return;
  await runScript("src/cli/sendBatch.js", ["--market", "salon"]);
});

// 09:00 Monday — Referral partner follow-ups (7+ days no reply)
scheduleDaily(9, 0, "Referral Follow-ups (Monday)", async () => {
  if (new Date().getDay() !== 1) return; // Monday only
  await runScript("src/cli/sendReferralFollowups.js");
});

// 07:05 Monday — LinkedIn enrichment (generates search URLs for new named records)
scheduleDaily(7, 5, "LinkedIn Enrichment (Monday)", async () => {
  if (new Date().getDay() !== 1) return;
  await runScript("src/linkedin/linkedinProspector.js", ["--limit", "100"]);
});

// 07:10 Monday — Referral partner finder (dental accountants, consultants, IT)
scheduleDaily(7, 10, "Referral partner finder (Monday)", async () => {
  if (new Date().getDay() !== 1) return;
  await runScript("src/scrapers/referralPartnerFinder.js");
});

// 07:00 — GMB + Instagram + Call daily targets (runs after 06:30 enrichment, before 07:15 brief)
scheduleDaily(7, 0, "GMB + Instagram Daily Targets", async () => {
  await runScript("src/cli/generateDailyTargets.js");
});

// 07:30 Mon-Fri — GMB browser agent (sends today's 10 messages headless)
scheduleDaily(7, 30, "GMB Browser Agent", async () => {
  const day = new Date().getDay(); // 0=Sun 6=Sat
  if (day === 0 || day === 6) return;
  await runScript("src/cli/runGMBAgent.js", [], { timeoutMs: 30 * 60 * 1000 });
});

// 08:00 Mon-Fri — Instagram DM agent (sends today's 10 DMs headless)
scheduleDaily(8, 0, "Instagram DM Agent", async () => {
  const day = new Date().getDay();
  if (day === 0 || day === 6) return;
  await runScript("src/cli/runInstagramAgent.js", [], { timeoutMs: 30 * 60 * 1000 });
});

// 09:30 Mon-Fri — SMS outreach to clinic phone numbers (20/day)
scheduleDaily(9, 30, "SMS Outreach (dental)", async () => {
  const day = new Date().getDay();
  if (day === 0 || day === 6) return;
  await runScript("src/cli/sendSMSOutreach.js", ["--limit", "20"], { timeoutMs: 20 * 60 * 1000 });
});

// 07:12 Mon-Fri — Post to Google Business Profile (same post as LinkedIn)
scheduleDaily(7, 12, "GBP Post", async () => {
  const day = new Date().getDay();
  if (day === 0 || day === 6) return;
  await runScript("src/cli/postToGBP.js");
});

// 06:58 — SMS morning alert (before email brief — phone gets the one-liner first)
scheduleDaily(6, 58, "SMS Morning Alert", async () => {
  try {
    const dental    = readJsonSafe(path.join(DATA_DIR, "outreach.localDentists.json"), []);
    const replied   = dental.filter(c => c.replied).length;
    const betaRep   = dental.filter(c => c.betaOfferSent && c.replied).length;
    const pilots    = dental.filter(c => c.pilotOfferSent && !c.replied).length;

    const seq       = readJsonSafe(path.join(DATA_DIR, "hitlist", "sequence-tracker.json"), []);
    const activeSeq = seq.filter(s => !s.replied && s.touches?.touch1_email === "sent").length;

    const action    = readJsonSafe(path.join(DATA_DIR, "daily-action.json"), { priority: "BUILD", action: "Check signals dashboard" });

    const emoji     = action.priority === "URGENT" ? "🔴" : action.priority === "HOT" ? "🟠" : "🟡";
    const day       = new Date().toLocaleDateString("en-CA", { weekday: "short", month: "short", day: "numeric" });

    const body = [
      `☀️ ClinicFlow — ${day}`,
      ``,
      `${emoji} TODAY: ${action.action}`,
      ``,
      `📊 Pipeline:`,
      `- ${activeSeq} in hit list sequence`,
      `- ${pilots} pilot offers pending`,
      `- ${betaRep} beta replies`,
      `- ${replied} total replies ever`,
      ``,
      (action.priority === "URGENT" || action.priority === "HOT") ? "⚡ CHECK EMAIL NOW" : "✓ Machine running",
    ].join("\n");

    const to = process.env.NOTIFY_PHONE || process.env.TWILIO_TO_NUMBER;
    if (!to) { appendLog("SMS Morning Alert: NOTIFY_PHONE not set — skipped"); return; }
    await sendSMS(to, body);
    appendLog("SMS morning alert sent");
  } catch (err) {
    appendLog(`SMS morning alert error: ${err?.message || err}`);
  }
});

// 07:14 — LinkedIn rotation advance (daily, new 3 targets before morning brief)
// linkedin-rotation
scheduleDaily(7, 14, "LinkedIn Rotation", async () => {
  try {
    const { default: fsSync } = await import('fs');
    const { default: pathSync } = await import('path');
    const file = pathSync.join(process.cwd(), 'data/linkedin/prospect-rotation.json');
    const rotation = JSON.parse(fsSync.readFileSync(file, 'utf8'));
    rotation.currentIndex = (rotation.currentIndex || 0) + 3;
    if (rotation.currentIndex >= rotation.prospects.length) rotation.currentIndex = 0;
    rotation.lastAdvancedAt = new Date().toISOString();
    fsSync.writeFileSync(file, JSON.stringify(rotation, null, 2));
    appendLog('LinkedIn rotation advanced to index: ' + rotation.currentIndex);
  } catch(e) {
    appendLog('LinkedIn rotation error: ' + e.message);
  }
});

// 07:15 — Morning brief email to operator
scheduleDaily(7, 15, "Morning Brief Email", async () => {
  await runScript("src/cli/sendMorningBrief.js");
});

// 06:30 — GMB enrichment (50 clinics/day, before brief + pain scan)
scheduleDaily(6, 30, "GMB Enrichment (50 clinics)", async () => {
  try {
    const { enrichBatch } = await import("./services/gmbEnricher.js");
    const data       = readJsonSafe(path.join(DATA_DIR, "outreach.localDentists.json"), []);
    const unenriched = data
      .filter(c => !c.placeId && c.status === "todo")
      .sort((a, b) => (b.reviewPainScore || 0) - (a.reviewPainScore || 0))
      .slice(0, 50);
    if (unenriched.length === 0) {
      appendLog("GMB Enrichment: all todo clinics already enriched");
      return;
    }
    await enrichBatch(unenriched, 50);
  } catch (err) {
    appendLog(`GMB enrichment error: ${err?.message || err}`);
  }
});

// 06:45 — Review pain signal scan (runs before prepareOutreach so pain scores are fresh)
scheduleDaily(6, 45, "Review Pain Scan (pre-send)", async () => {
  await runScript("src/intelligence/reviewsScraper.js", ["--limit", "30"], { timeoutMs: 20 * 60 * 1000 });
});

// 07:30 — Daily enrich (20 records, keeps email pipeline full)
scheduleDaily(7, 30, "Daily Enrich (dental)", async () => {
  await runScript("src/cli/enrichEmails.js", ["--market", "dental", "--limit", "20"]);
});

// 07:00 Monday — Weekly deeper enrich (45 records)
scheduleDaily(7, 0, "Weekly Enrich (dental, Mon only)", async () => {
  if (new Date().getDay() !== 1) return; // Monday only
  await runScript("src/cli/enrichEmails.js", ["--market", "dental", "--limit", "45"]);
});

// 07:00, 13:00, 19:00 — Health checks every 6 hours
for (const hour of [7, 13, 19]) {
  scheduleDaily(hour, 0, `Health Check (${hour}:00)`, async () => {
    try {
      const { allOk } = await checkHealth();
      if (!allOk) appendLog("⚠ Health check found issues — see data/health.log");
    } catch (err) {
      appendLog(`Health check threw: ${err?.message || err}`);
    }
  });
}

// 08:30 — Appointment reminders (SMS via Twilio, reads all client calendars)
scheduleDaily(8, 30, "Appointment Reminders", async () => {
  await runScript("src/cli/runReminders.js");
});

// 09:00 — Day-7 check-ins (runs daily, only sends when clients are due)
scheduleDaily(9, 0, "Day-7 Check-ins", async () => {
  await runScript("src/cli/sendCheckIn.js", ["--day", "7"]);
});

// First Monday of each month at 09:30 — monthly results report
scheduleDaily(9, 30, "Monthly Report (first Monday)", async () => {
  const now = new Date();
  const dayOfWeek = now.getDay(); // 1 = Monday
  const dayOfMonth = now.getDate();
  if (dayOfWeek === 1 && dayOfMonth <= 7) {
    await runScript("src/cli/sendMonthlyReport.js");
  }
});

// 07:00 Monday — Weekly market intelligence report
scheduleDaily(7, 0, "Weekly Intelligence Report (Monday)", async () => {
  const now = new Date();
  if (now.getDay() === 1) { // 1 = Monday
    await runScript("src/intelligence/weeklyReport.js");
  }
});

// 07:30 Monday — Weekly deliverability health check
scheduleDaily(7, 30, "Deliverability Health Check (Monday)", async () => {
  if (new Date().getDay() !== 1) return; // Monday only
  try {
    const { runDeliverabilityCheck } = await import("./cli/deliverabilityCheck.js");
    await runDeliverabilityCheck({ silent: false });
  } catch (err) {
    appendLog(`Deliverability check error: ${err?.message || err}`);
  }
});

// 09:05 — Beta 60-day case study auto-trigger
scheduleDaily(9, 5, "Beta Case Study Auto-trigger", async () => {
  try {
    const regPath  = path.join(DATA_DIR, 'beta-partners.json');
    if (!fs.existsSync(regPath)) return;
    const registry = JSON.parse(fs.readFileSync(regPath, 'utf8'));
    const ready    = registry.filter(p => {
      if (p.caseStudyGenerated) return false;
      const days = Math.floor((Date.now() - new Date(p.activatedAt).getTime()) / 86400000);
      return days >= 60;
    });
    for (const partner of ready) {
      appendLog(`Beta 60-day trigger: generating case study for ${partner.clinicName}`);
      await runScript('src/cli/generateCaseStudy.js', ['--clinic', partner.slug]);
      // SMS Mohamed — case study is live
      const to = process.env.NOTIFY_PHONE || process.env.TWILIO_TO_NUMBER;
      if (to) {
        try {
          await sendSMS(to, `✓ Case study auto-generated: ${partner.clinicName}\nPublish: clinicflowautomation.com/results/${partner.slug}\nDeploy to make it live.`);
        } catch {}
      }
    }
  } catch (err) {
    appendLog(`Beta case study trigger error: ${err?.message || err}`);
  }
});

// 09:15 — Onboarding orchestrator: check all onboarding clients and send next step
scheduleDaily(9, 15, "Onboarding Orchestrator", async () => {
  try {
    const { runOnboardingCheckForAll } = await import("./services/onboardingOrchestrator.js");
    await runOnboardingCheckForAll();
  } catch (err) {
    appendLog(`Onboarding orchestrator error: ${err?.message || err}`);
  }
});

// 08:30 — Appointment reminders via new reminder service (replaces runReminders.js for active clients)
// Note: runReminders.js (calendar-based) still runs for legacy clients with calendarId
scheduleDaily(8, 31, "Reminder Service (CSV-based)", async () => {
  try {
    const { runRemindersForAllClients } = await import("./services/reminderService.js");
    await runRemindersForAllClients();
  } catch (err) {
    appendLog(`Reminder service error: ${err?.message || err}`);
  }
});

// First Monday of each month at 09:30 — patient reactivation wave 1
scheduleDaily(9, 30, "Reactivation Service (first Monday)", async () => {
  const now = new Date();
  if (now.getDay() !== 1 || now.getDate() > 7) return;
  try {
    const { runReactivationForAllClients } = await import("./services/reactivationService.js");
    await runReactivationForAllClients();
  } catch (err) {
    appendLog(`Reactivation service error: ${err?.message || err}`);
  }
});

// 10:00 — 30-day results reports for clients due
scheduleDaily(10, 0, "30-Day Results Reports", async () => {
  try {
    const { runReportsForDueClients } = await import("./services/resultsReportService.js");
    await runReportsForDueClients();
  } catch (err) {
    appendLog(`Results report service error: ${err?.message || err}`);
  }
});

// 06:00 daily — Proactive Opportunity Engine (hunts for revenue, acts automatically)
scheduleDaily(6, 0, "Proactive Opportunity Engine", async () => {
  try {
    const { runOpportunityEngineForAll } = await import("./services/opportunityEngine.js");
    await runOpportunityEngineForAll();
  } catch (err) {
    appendLog(`Opportunity engine error: ${err?.message || err}`);
  }
});

// 07:00 every Monday — Weekly Intelligence Digest (SMS + email to clinic owners)
scheduleDaily(7, 0, "Weekly Intelligence Digest (Monday)", async () => {
  if (new Date().getDay() !== 1) return; // 1 = Monday
  try {
    const { sendWeeklyDigestForAll } = await import("./services/weeklyDigest.js");
    await sendWeeklyDigestForAll();
  } catch (err) {
    appendLog(`Weekly digest error: ${err?.message || err}`);
  }
});

// First day of each month at 06:00 — reset free-tier SMS counts (runs after opportunity engine)
scheduleDaily(6, 5, "Free Tier SMS Reset (1st of month)", async () => {
  if (new Date().getDate() !== 1) return;
  try {
    const { resetFreeSmsCounts } = await import("./services/clientLifecycle.js");
    resetFreeSmsCounts();
  } catch (err) {
    appendLog(`Free SMS reset error: ${err?.message || err}`);
  }
});

// Every hour — send outcome check SMS to Mohamed for due appointment checks
scheduleInterval(60 * 60 * 1000, "Outcome Check Sender", async () => {
  try {
    const { sendDueOutcomeChecks } = await import("./services/outcomeTracker.js");
    await sendDueOutcomeChecks();
  } catch (err) {
    appendLog(`Outcome check sender error: ${err?.message || err}`);
  }
});

// 06:30 every Sunday — predictive intelligence analysis for all active clients
scheduleDaily(6, 30, "Predictive Intelligence Analysis (Sunday)", async () => {
  if (new Date().getDay() !== 0) return; // 0 = Sunday
  try {
    const { runPredictiveAnalysisForAll } = await import("./services/predictiveEngine.js");
    await runPredictiveAnalysisForAll();
  } catch (err) {
    appendLog(`Predictive analysis error: ${err?.message || err}`);
  }
});

// 07:00 on 1st of month — generate shareable results reports for all active clients
scheduleDaily(7, 0, "Shareable Results Reports (1st of month)", async () => {
  if (new Date().getDate() !== 1) return;
  await runScript("src/cli/generateShareableReport.js", ["--all"]);
});

// 06:15 on 1st of month — extract AI personal notes from patient conversation history
// Uses Claude to read each patient's event history and extract memorable details:
// "Mentioned being anxious", "Prefers mornings", "Has young children", etc.
// Stored in patient-memory.json and included in Claude's context for future interactions.
scheduleDaily(6, 15, "Patient Memory Personal Notes (1st of month)", async () => {
  if (new Date().getDate() !== 1) return;
  try {
    const { extractPersonalNotesForAllClients } = await import("./services/patientMemory.js");
    await extractPersonalNotesForAllClients();
  } catch (err) {
    appendLog(`Patient memory extraction error: ${err?.message || err}`);
  }
});

// Every 30 minutes — patient recovery follow-ups (wave 2 at +2h, wave 3 at +24h)
scheduleInterval(30 * 60 * 1000, "Patient Recovery Follow-ups", async () => {
  try {
    const { runScheduledFollowUps } = await import("./services/patientRecoveryEngine.js");
    await runScheduledFollowUps();
  } catch (err) {
    appendLog(`Patient recovery follow-ups error: ${err?.message || err}`);
  }
});

// 10:30 — OOO follow-up sender: re-engage out-of-office contacts when their return date arrives
scheduleDaily(10, 30, "OOO Follow-up Sender", async () => {
  await runScript("src/cli/sendOooFollowups.js");
});

// 07:00 — Outreach preparation: score and assign outreach plans for next 50 clinics
scheduleDaily(7, 0, "Outreach Prepare (personalization scoring)", async () => {
  await runScript("src/cli/prepareOutreach.js", ["--limit", "50"]);
});

// 08:00 May 16 — Hunter quota reset: maximize enrichment on reset day
scheduleDaily(8, 0, "Hunter Reset Enrich (May 16 only)", async () => {
  const now = new Date();
  if (now.getMonth() === 4 && now.getDate() === 16) { // Month 4 = May (0-indexed)
    appendLog("Hunter monthly quota reset — running max enrichment batch");
    await runScript("src/cli/enrichEmails.js", ["--market", "dental", "--limit", "100"], { timeoutMs: 60 * 60 * 1000 });
  }
});

// 09:00 — Slybroadcast ringless voicemail drops (Mon-Fri, guarded inside script)
scheduleDaily(9, 0, "Voicemail Drop (Slybroadcast)", async () => {
  await runScript("src/cli/voicemailDrop.js");
});

// 09:45 May 10 only — Limbour custom FU3 (review-aware, bilingual closer)
scheduleDaily(9, 45, "Limbour custom FU3 (May 10 only)", async () => {
  const now = new Date();
  if (now.getMonth() !== 4 || now.getDate() !== 10) return; // month is 0-indexed, 4 = May
  await runScript("src/cli/sendCustom.js", ["data/custom-sends/limbour-fu3.json"]);
});

// 09:47 — Beta follow-up sequence (day 3 urgency / day 5 pain signal / day 7 demo)
scheduleDaily(9, 47, "Beta Follow-ups", async () => {
  await runScript("src/cli/sendBetaFollowups.js");
});

// 08:05 — Review pain monitor (Google reviews → missed-call pain signals → operator alert)
scheduleDaily(8, 5, "Review Pain Monitor", async () => {
  try {
    const { runReviewMonitor } = await import('./monitors/reviewMonitor.js');
    await runReviewMonitor();
  } catch (err) {
    appendLog(`Review monitor error: ${err?.message || err}`);
  }
});

// 10:15 — Twilio automated calls (Mon-Fri, 10am-3pm window guarded inside script)
scheduleDaily(10, 15, "Twilio Calls (auto-AMD)", async () => {
  await runScript("src/cli/twilioCallQueue.js");
});

// 18:00 — Daily summary to console
scheduleDaily(18, 0, "Daily Summary", async () => {
  const summary = buildDailySummary();
  console.log("\n" + summary + "\n");
  appendLog("Daily summary printed to console");
});

// ─── Boot message ─────────────────────────────────────────────────────────────

// Reply inbox check every 30 minutes
scheduleInterval(30 * 60 * 1000, "Reply Handler (IMAP)", async () => {
  await checkReplies();
});

appendLog("=== ORE-Engine Scheduler started ===");
appendLog(`Node: ${process.version} | PID: ${process.pid}`);
appendLog("Jobs: gmbEnrich@06:30, painScan@06:45, gmbTargets@07:00, gmbAgent@07:30, igAgent@08:00, pipeline@08:00, reminders@08:30, smsOutreach@09:30, send:dental@10:00, followups@11:00, send:physio@15:00, summary@18:00, intelligence@07:00-Monday");

// Keep process alive
process.on("uncaughtException", (err) => {
  appendLog(`UNCAUGHT EXCEPTION: ${err?.message || err}`);
});
process.on("unhandledRejection", (reason) => {
  appendLog(`UNHANDLED REJECTION: ${reason}`);
});

// Keep the event loop alive — without this Node exits immediately after scheduling
process.stdin.resume();

// ─── Heartbeat + dead man's switch ───────────────────────────────────────────

let lastHeartbeatMs = Date.now();
const DEAD_MAN_PHONE = "+15149617077";
const DEAD_MAN_THRESHOLD_MS = 2 * 60 * 60 * 1000; // 2 hours

// Heartbeat: log every 60 minutes to confirm the process is still running
setInterval(() => {
  lastHeartbeatMs = Date.now();
  appendLog("Scheduler heartbeat — still running");
}, 60 * 60 * 1000);

// Dead man's switch: check every 30 minutes if heartbeat has been recent
setInterval(async () => {
  const elapsed = Date.now() - lastHeartbeatMs;
  if (elapsed >= DEAD_MAN_THRESHOLD_MS) {
    const hours = Math.round(elapsed / 1000 / 60 / 60);
    appendLog(`DEAD MAN ALERT: No heartbeat for ${hours}h — sending SMS`);
    try {
      await sendSMS(DEAD_MAN_PHONE, "ClinicFlow scheduler may be down — check PC");
    } catch (err) {
      appendLog(`Dead man SMS failed: ${err?.message || err}`);
    }
  }
}, 30 * 60 * 1000);
