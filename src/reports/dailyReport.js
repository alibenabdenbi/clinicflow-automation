// src/reports/dailyReport.js
// Generates a daily summary report and saves it to data/reports/daily_YYYY-MM-DD.txt
// Run with: node src/reports/dailyReport.js  (or npm run report)

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { isNamedEmail } from "../services/emailPersonalizer.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const DATA_DIR = path.join(ROOT, "data");
const REPORTS_DIR = path.join(DATA_DIR, "reports");

// ─── Helpers ──────────────────────────────────────────────────────────────────

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

function dateKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function pad(label, value, width = 42) {
  return `  ${label}: ${value}`.padEnd(width);
}

function flag(condition, msg) {
  return condition ? `  ⚠ WARNING: ${msg}` : null;
}

// ─── Data gathering ───────────────────────────────────────────────────────────

function gatherStats() {
  const today = todayKey();
  const yesterday = dateKey(new Date(Date.now() - 86_400_000));
  const twoDaysAgo = dateKey(new Date(Date.now() - 2 * 86_400_000));
  const errors = [];

  // ── CRM leads ──────────────────────────────────────────────────────────────
  const crmLeads = readJsonSafe(path.join(DATA_DIR, "crm.leads.json"), []);
  const totalCrmLeads = Array.isArray(crmLeads) ? crmLeads.length : 0;
  const crmNewToday = Array.isArray(crmLeads)
    ? crmLeads.filter((l) => (l.createdAt || "").startsWith(today)).length
    : 0;

  const crmByTier = { A: 0, B: 0, C: 0 };
  let crmConfirmed = 0;
  (crmLeads || []).forEach((l) => {
    const t = l.tier || "C";
    if (t in crmByTier) crmByTier[t]++;
    if (l.confirmed) crmConfirmed++;
  });

  // ── Outreach queue (local dentists) ───────────────────────────────────────
  const dentists = readJsonSafe(path.join(DATA_DIR, "outreach.localDentists.json"), []);
  const totalDentists = Array.isArray(dentists) ? dentists.length : 0;
  const emailsPending = Array.isArray(dentists)
    ? dentists.filter((d) => (d.status || "todo") === "todo" && d.email).length
    : 0;

  // Count all statuses that mean "an initial email was sent"
  const emailsSentTotal = Array.isArray(dentists)
    ? dentists.filter((d) =>
        ["sent", "followup_1_sent", "followup_2_sent", "followup_3_sent", "followups_complete", "followup_sent"].includes(d.status)
      ).length
    : 0;

  const noEmail = Array.isArray(dentists)
    ? dentists.filter((d) => !d.email).length
    : 0;

  // Follow-up stats (new 3-stage system)
  // FU1=4d, FU2=9d, FU3=16d after sentAt
  const FU_DAYS = [0, 4, 9, 16];
  const fu1Due = Array.isArray(dentists)
    ? dentists.filter((d) => {
        if (d.status !== "sent") return false;
        const count = Number(d.followupCount ?? 0);
        if (count >= 1) return false;
        const sentAt = Date.parse(d.sentAt || "");
        return Number.isFinite(sentAt) && Date.now() >= sentAt + FU_DAYS[1] * 86_400_000;
      }).length
    : 0;

  // How many FU1s will become due in the next 7 days (but not yet due)
  const fu1DueSoon = Array.isArray(dentists)
    ? dentists.filter((d) => {
        if (d.status !== "sent") return false;
        if (Number(d.followupCount ?? 0) >= 1) return false;
        const sentAt = Date.parse(d.sentAt || "");
        if (!Number.isFinite(sentAt)) return false;
        const dueMs = sentAt + FU_DAYS[1] * 86_400_000;
        return Date.now() < dueMs && dueMs <= Date.now() + 7 * 86_400_000;
      }).length
    : 0;

  const fu2Due = Array.isArray(dentists)
    ? dentists.filter((d) => {
        if (!["sent", "followup_1_sent"].includes(d.status)) return false;
        const count = Number(d.followupCount ?? 0);
        if (count !== 1) return false;
        const sentAt = Date.parse(d.sentAt || "");
        return Number.isFinite(sentAt) && Date.now() >= sentAt + FU_DAYS[2] * 86_400_000;
      }).length
    : 0;

  const followupsComplete = Array.isArray(dentists)
    ? dentists.filter((d) => d.status === "followups_complete").length
    : 0;

  const fu1Sent = Array.isArray(dentists)
    ? dentists.filter((d) => Number(d.followupCount ?? 0) >= 1).length
    : 0;
  const fu2Sent = Array.isArray(dentists)
    ? dentists.filter((d) => Number(d.followupCount ?? 0) >= 2).length
    : 0;
  const fu3Sent = Array.isArray(dentists)
    ? dentists.filter((d) => Number(d.followupCount ?? 0) >= 3).length
    : 0;

  // ── SMTP send log ──────────────────────────────────────────────────────────
  const sendLog = readJsonSafe(path.join(DATA_DIR, "smtp.sendlog.json"), {});
  const emailsSentToday = Number(sendLog[today] || 0);
  const emailsSentYesterday = Number(sendLog[yesterday] || 0);
  const emailsSentTwoDaysAgo = Number(sendLog[twoDaysAgo] || 0);
  // For dates that have _new/_fu suffix keys: use those (accurate split).
  // For older dates with only plain keys (before suffix tracking was added):
  // the plain key = all initial sends (no follow-ups ran then), so count those too.
  const datesWithSuffix = new Set(
    Object.keys(sendLog)
      .filter(k => /^\d{4}-\d{2}-\d{2}_new$/.test(k))
      .map(k => k.replace("_new", ""))
  );
  const totalNewSentAllTime =
    // Recent dates: use _new keys
    Object.entries(sendLog)
      .filter(([k]) => /^\d{4}-\d{2}-\d{2}_new$/.test(k))
      .reduce((sum, [, v]) => sum + Number(v || 0), 0) +
    // Legacy dates: plain key only (all were initial sends)
    Object.entries(sendLog)
      .filter(([k]) => /^\d{4}-\d{2}-\d{2}$/.test(k) && !datesWithSuffix.has(k))
      .reduce((sum, [, v]) => sum + Number(v || 0), 0);
  const totalFuSentAllTime = Object.entries(sendLog)
    .filter(([k]) => /^\d{4}-\d{2}-\d{2}_fu$/.test(k))
    .reduce((sum, [, v]) => sum + Number(v || 0), 0);
  const totalEmailsSentAllTime = totalNewSentAllTime + totalFuSentAllTime;

  // Open rate proxy: if follow-ups get sent, initial emails reached inboxes.
  // Proxy: (fu1Sent / emailsSentTotal) as a rough deliverability signal.
  const openRateProxy =
    emailsSentTotal > 0
      ? `${Math.round((fu1Sent / emailsSentTotal) * 100)}% (${fu1Sent}/${emailsSentTotal} proceeded to FU1)`
      : "N/A (no emails sent yet)";

  // Bounce rate: hard bounces / unique sends (dedup by email address to ignore double-log bug)
  const emailLogForBounce = readJsonSafe(path.join(DATA_DIR, "smtp.emaillog.json"), []);
  const uniqueSentEmails = new Set(
    (Array.isArray(emailLogForBounce) ? emailLogForBounce : [])
      .filter(e => e.status === "sent")
      .map(e => (e.email || "").toLowerCase().trim())
      .filter(Boolean)
  );
  const uniqueSentCount = uniqueSentEmails.size;
  const totalBouncedCount = Array.isArray(dentists)
    ? dentists.filter(d => d.status === "bounced").length : 0;
  const hardBouncedCount = Array.isArray(dentists)
    ? dentists.filter(d => d.status === "bounced" && d.bounceType === "permanent").length : 0;
  const bounceRateStr = uniqueSentCount > 0
    ? `${(totalBouncedCount / uniqueSentCount * 100).toFixed(1)}% total  |  ${(hardBouncedCount / uniqueSentCount * 100).toFixed(1)}% hard  (${totalBouncedCount} bounced / ${uniqueSentCount} unique sends)`
    : "N/A";

  // Offer acceptance (confirmed leads / total leads with outreach)
  const offerAcceptanceRate =
    totalCrmLeads > 0
      ? `${Math.round((crmConfirmed / totalCrmLeads) * 100)}% (${crmConfirmed}/${totalCrmLeads} confirmed)`
      : "N/A";

  // ── Validated offers ───────────────────────────────────────────────────────
  const validatedDir = path.join(DATA_DIR, "offers", "validated");
  let validatedOffersCount = 0;
  try {
    if (fs.existsSync(validatedDir)) {
      validatedOffersCount = fs.readdirSync(validatedDir).filter((f) => f.endsWith(".json")).length;
    }
  } catch { /* ignore */ }

  // ── Lead quality filter stats ──────────────────────────────────────────────
  // We can estimate from the opportunities file vs filtered
  const topOpps = readJsonSafe(path.join(DATA_DIR, "opportunities.intent.top20.json"), []);
  const highScoreOpps = (topOpps || []).filter((o) => (o.score || 0) >= 9).length;

  // ── Scheduler log — errors today ───────────────────────────────────────────
  const logPath = path.join(DATA_DIR, "scheduler.log");
  let schedulerErrors = [];
  let totalSchedulerErrorsToday = 0;
  try {
    if (fs.existsSync(logPath)) {
      const lines = fs.readFileSync(logPath, "utf-8").split("\n");
      schedulerErrors = lines.filter(
        (l) => l.includes(`[${today}`) && l.includes("ERROR")
      );
      totalSchedulerErrorsToday = schedulerErrors.length;
    }
  } catch {
    errors.push("Could not read scheduler.log");
  }

  // ── Health log — last status ───────────────────────────────────────────────
  const healthLog = path.join(DATA_DIR, "health.log");
  let lastHealthStatus = "unknown";
  try {
    if (fs.existsSync(healthLog)) {
      const lines = fs.readFileSync(healthLog, "utf-8").split("\n").filter(Boolean);
      const last = lines[lines.length - 1] || "";
      lastHealthStatus = last.includes("HEALTHY") ? "HEALTHY" : last.includes("ISSUES") ? "ISSUES FOUND" : "unknown";
    }
  } catch { /* ignore */ }

  // ── Problems & offers ─────────────────────────────────────────────────────
  const problems = readJsonSafe(path.join(DATA_DIR, "problems.top10.json"), []);
  const topTheme = problems?.[0]?.theme || "N/A";
  const offers = readJsonSafe(path.join(DATA_DIR, "offers.top3.json"), []);

  // ── Reply drafts — actionable intelligence ─────────────────────────────────
  const draftsDir = path.join(DATA_DIR, "reply-drafts");
  const actionRequired = [];       // replied, needs response
  const readyToClose = [];         // AUDIT_YES that have audit questions answered
  const outOfOfficeQueue = [];     // follow-up queue entries not yet done

  try {
    if (fs.existsSync(draftsDir)) {
      const draftFiles = fs.readdirSync(draftsDir).filter(f => f.endsWith(".json"));
      for (const f of draftFiles) {
        try {
          const d = JSON.parse(fs.readFileSync(path.join(draftsDir, f), "utf-8"));
          if (!d.fromEmail) continue;
          if (d.intent === "AUDIT_YES") readyToClose.push(d);
          else if (d.intent !== "NOT_INTERESTED" && d.intent !== "ALREADY_HAVE_SYSTEM" && d.status !== "sent") {
            actionRequired.push(d);
          }
        } catch {}
      }
    }
  } catch {}

  // Out of office follow-up queue
  try {
    const fuQueue = JSON.parse(fs.readFileSync(path.join(DATA_DIR, "follow-up-queue.json"), "utf-8"));
    if (Array.isArray(fuQueue)) {
      const now = new Date();
      fuQueue
        .filter(e => !e.done && e.followUpDate)
        .forEach(e => {
          const due = new Date(e.followUpDate);
          if (due <= now) outOfOfficeQueue.push({ ...e, overdue: true });
          else outOfOfficeQueue.push({ ...e, overdue: false });
        });
    }
  } catch {}

  // ── Hot prospects — recently emailed, no reply (proxy for opened) ──────────
  const sevenDaysAgo = Date.now() - 7 * 86_400_000;
  const hotProspects = Array.isArray(dentists)
    ? dentists.filter(d => {
        if (!["sent", "followup_1_sent"].includes(d.status)) return false;
        const sentAt = Date.parse(d.sentAt || "");
        return Number.isFinite(sentAt) && sentAt >= sevenDaysAgo;
      })
    : [];

  // ── Wins this week — check clients/ directory for recent payments ──────────
  const winsThisWeek = [];
  try {
    const clientsDir = path.join(DATA_DIR, "clients");
    if (fs.existsSync(clientsDir)) {
      const weekAgo = new Date(Date.now() - 7 * 86_400_000).toISOString();
      fs.readdirSync(clientsDir).forEach(slug => {
        const pf = path.join(clientsDir, slug, "payments.json");
        if (!fs.existsSync(pf)) return;
        try {
          const payments = JSON.parse(fs.readFileSync(pf, "utf-8"));
          (Array.isArray(payments) ? payments : []).forEach(p => {
            if (p.paidAt >= weekAgo) winsThisWeek.push({ clinic: slug, ...p });
          });
        } catch {}
      });
    }
  } catch {}

  // ── Deliverability trend — sends per day last 7 days ─────────────────────
  const delivTrend = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86_400_000);
    const dk = dateKey(d);
    const sent = Number(sendLog[dk + "_new"] || sendLog[dk] || 0);
    const fu = Number(sendLog[dk + "_fu"] || 0);
    delivTrend.push({ date: dk, sent, fu, total: sent + fu });
  }

  // ── Best performing subject line — which generated most FU1 proceeds ──────
  // Proxy: subject lines from initial sends for clinics that reached FU1
  const subjectMap = {};
  const emailLog = readJsonSafe(path.join(DATA_DIR, "smtp.emaillog.json"), []);
  if (Array.isArray(emailLog)) {
    // Map email → initial subject
    const initialSubjects = {};
    emailLog
      .filter(e => e.type === "initial" && e.subject)
      .forEach(e => { if (e.email) initialSubjects[e.email.toLowerCase()] = e.subject; });

    // Find clinics that reached FU1
    (Array.isArray(dentists) ? dentists : [])
      .filter(d => Number(d.followupCount ?? 0) >= 1)
      .forEach(d => {
        const subj = initialSubjects[(d.email || "").toLowerCase()];
        if (subj) subjectMap[subj] = (subjectMap[subj] || 0) + 1;
      });
  }
  const bestSubject = Object.entries(subjectMap)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([subj, count]) => ({ subject: subj, fu1Count: count }));

  // ── Variant performance table ──────────────────────────────────────────────
  // All active variants A-L plus review variant R
  const variantLabels = ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L", "R"];
  const variantStats = {};
  for (const v of variantLabels) {
    variantStats[v] = { sent: 0, fu1: 0, replies: 0 };
  }
  if (Array.isArray(dentists)) {
    for (const d of dentists) {
      const v = d.variantLabel;
      if (!v || !variantStats[v]) continue;
      // Count as sent if they have a variantLabel set and were actually emailed
      const wasSent = ["sent", "followup_1_sent", "followup_2_sent", "followup_3_sent",
                       "followups_complete", "cooling_off"].includes(d.status);
      if (wasSent) {
        variantStats[v].sent++;
        if (Number(d.followupCount ?? 0) >= 1) variantStats[v].fu1++;
      }
    }
  }
  // Reply rate: check reply-drafts for clinics with this variant
  try {
    const draftsDir = path.join(DATA_DIR, "reply-drafts");
    if (fs.existsSync(draftsDir)) {
      const draftFiles = fs.readdirSync(draftsDir).filter(f => f.endsWith(".json"));
      for (const f of draftFiles) {
        try {
          const d = JSON.parse(fs.readFileSync(path.join(draftsDir, f), "utf-8"));
          if (!d.fromEmail) continue;
          // Look up variant for this email in dentist records
          const rec = Array.isArray(dentists)
            ? dentists.find(dd => (dd.email || "").toLowerCase() === (d.fromEmail || "").toLowerCase())
            : null;
          if (rec?.variantLabel && variantStats[rec.variantLabel]) {
            variantStats[rec.variantLabel].replies++;
          }
        } catch {}
      }
    }
  } catch {}

  const variantPerf = variantLabels
    .map(v => {
      const { sent, fu1, replies } = variantStats[v];
      const fu1Pct  = sent > 0 ? `${Math.round((fu1 / sent) * 100)}%` : "—";
      const replyPct = sent > 0 ? `${Math.round((replies / sent) * 100)}%` : "—";
      return { variant: v, sent, fu1, fu1Pct, replies, replyPct };
    });

  // ── Voice outreach stats ──────────────────────────────────────────────────
  const callLog     = readJsonSafe(path.join(DATA_DIR, "calls", "call-log.json"), []);
  const dropsLog    = readJsonSafe(path.join(DATA_DIR, "calls", "voicemail-drops.json"), []);
  const voiceDropsToday    = dropsLog.filter(d => (d.droppedAt || "").startsWith(today)).length;
  const voiceCallsToday    = callLog.filter(d => (d.timestamp || "").startsWith(today) && d.outcome !== "callback_received").length;
  const callbacksToday     = callLog.filter(d => d.outcome === "callback_received" && (d.timestamp || "").startsWith(today)).length;
  const totalVoiceTouches  = callLog.length + dropsLog.length;
  const totalCallbacks     = callLog.filter(d => d.outcome === "callback_received").length;

  // ── Pipeline revenue estimate ─────────────────────────────────────────────
  const DEAL_VALUE = 1500; // one-time setup fee
  const pipelineRevenue = readyToClose.length * DEAL_VALUE;
  const winsRevenue = winsThisWeek.reduce((sum, w) => sum + Number(w.amount || DEAL_VALUE), 0);

  // ── Health warnings ────────────────────────────────────────────────────────
  const warnings = [
    flag(emailsPending < 10, `Only ${emailsPending} emails pending — refill the outreach queue`),
    flag(emailsSentToday === 0 && emailsSentYesterday === 0, "0 emails sent in 2 days — check SMTP credentials"),
    flag(totalSchedulerErrorsToday > 5, `${totalSchedulerErrorsToday} scheduler errors today — pipeline needs attention`),
    flag(noEmail > totalDentists * 0.9, `${noEmail}/${totalDentists} clinics have no email — enrichment may be stalled`),
    flag(crmNewToday === 0, "No new CRM leads discovered today — check if main pipeline ran"),
    flag(uniqueSentCount > 0 && totalBouncedCount / uniqueSentCount > 0.05,
      `Bounce rate ${(totalBouncedCount / uniqueSentCount * 100).toFixed(1)}% exceeds 5% — run smtpVerify and clean list`),
  ].filter(Boolean);

  return {
    today,
    totalCrmLeads,
    crmNewToday,
    crmByTier,
    crmConfirmed,
    offerAcceptanceRate,
    totalDentists,
    emailsPending,
    emailsSentTotal,
    emailsSentToday,
    emailsSentYesterday,
    totalEmailsSentAllTime,
    totalNewSentAllTime,
    totalFuSentAllTime,
    noEmail,
    uniqueSentCount,
    totalBouncedCount,
    hardBouncedCount,
    bounceRateStr,
    fu1Due,
    fu1Sent,
    fu2Sent,
    fu3Sent,
    followupsComplete,
    openRateProxy,
    schedulerErrors,
    totalSchedulerErrorsToday,
    errors,
    topTheme,
    offersGenerated: Array.isArray(offers) ? offers.length : 0,
    validatedOffersCount,
    highScoreOpps,
    lastHealthStatus,
    fu2Due,
    fu1DueSoon,
    warnings,
    // Part 6 additions
    actionRequired,
    readyToClose,
    hotProspects,
    winsThisWeek,
    outOfOfficeQueue,
    delivTrend,
    bestSubject,
    pipelineRevenue,
    winsRevenue,
    variantPerf,
    voiceDropsToday,
    voiceCallsToday,
    callbacksToday,
    totalVoiceTouches,
    totalCallbacks,
    recommendedActions: buildRecommendedActions(dentists, callLog, variantPerf, sendLog),
  };
}

// ─── Recommended Actions ──────────────────────────────────────────────────────

function buildRecommendedActions(dentists, callLog, variantPerf, sendLog) {
  const lines = [];
  lines.push("TODAY'S RECOMMENDED ACTIONS");

  // 1. Top 3 FU1 candidates: named email + sent within 7 days + not yet FU1'd
  const sevenDaysAgo = Date.now() - 7 * 86_400_000;
  const fu1Candidates = (Array.isArray(dentists) ? dentists : [])
    .filter(d =>
      d.status === "sent" &&
      Number(d.followupCount ?? 0) === 0 &&
      d.email &&
      isNamedEmail(d.email) &&
      Number.isFinite(Date.parse(d.sentAt || "")) &&
      Date.parse(d.sentAt) >= sevenDaysAgo
    )
    .sort((a, b) => (b.opportunityScore || b.score || 0) - (a.opportunityScore || a.score || 0))
    .slice(0, 3);

  if (fu1Candidates.length > 0) {
    lines.push("  1. Send FU1 to these clinics today — named email, recent send, most likely to reply:");
    fu1Candidates.forEach(d => {
      const days = Math.floor((Date.now() - Date.parse(d.sentAt)) / 86_400_000);
      lines.push(`     → ${(d.clinicName || d.email || "").slice(0, 40).padEnd(40)}  (${days}d ago, ${d.email})`);
    });
  } else {
    lines.push("  1. No priority FU1 candidates today");
  }

  // 2. Top 3 clinics to call: have direct lines, no reply
  const callCandidates = (Array.isArray(dentists) ? dentists : [])
    .filter(d =>
      (d.phone || d.rcdsoPhone || d.personalPhone) &&
      ["sent", "followup_1_sent", "followup_2_sent"].includes(d.status || "")
    )
    .slice(0, 3);

  if (callCandidates.length > 0) {
    lines.push("  2. Call these clinics today — direct lines, no email reply:");
    callCandidates.forEach(d => {
      const phone = d.personalPhone || d.rcdsoPhone || d.phone;
      lines.push(`     → ${(d.clinicName || "").slice(0, 36).padEnd(36)}  ${phone}  (${d.status})`);
    });
  } else {
    lines.push("  2. No call candidates with direct lines today");
  }

  // 3. Clinics with Google review pain signals
  const reviewPainClinics = (Array.isArray(dentists) ? dentists : [])
    .filter(d => (d.reviewPainScore || 0) >= 2)
    .slice(0, 2);

  if (reviewPainClinics.length > 0) {
    lines.push("  3. These clinics have Google reviews mentioning communication problems:");
    reviewPainClinics.forEach(d =>
      lines.push(`     → ${(d.clinicName || "").slice(0, 45)}  (pain score: ${d.reviewPainScore})`)
    );
  } else {
    lines.push("  3. No new Google review pain signals detected");
  }

  // 4. Hunter reset countdown
  const now       = new Date();
  const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const daysLeft  = Math.ceil((nextMonth - now) / 86_400_000);
  const resetDate = nextMonth.toISOString().slice(0, 10);
  lines.push(`  4. Hunter resets in ${daysLeft} day(s) — run enrich on ${resetDate}`);

  // 5. Variant performance advisory
  const sorted = [...(variantPerf || [])].sort((a, b) => {
    const aR = a.sent > 0 ? a.replies / a.sent : 0;
    const bR = b.sent > 0 ? b.replies / b.sent : 0;
    return bR - aR;
  });
  if (sorted.length >= 2) {
    const best  = sorted[0];
    const worst = sorted[sorted.length - 1];
    lines.push(`  5. Best variant: ${best.variant} (${best.replyPct} reply rate, ${best.sent} sends)`);
    if ((worst.sent || 0) >= 20) {
      lines.push(`     Worst variant: ${worst.variant} (${worst.replyPct} reply rate) — consider pausing`);
    }
  } else {
    lines.push("  5. Not enough variant data yet (need 20+ sends per variant)");
  }

  return lines.join("\n");
}

// ─── Report builder ───────────────────────────────────────────────────────────

function buildReport(s) {
  const sep = "─".repeat(52);
  const lines = [];

  lines.push("ORE-Engine — Daily Report");
  lines.push(`Date: ${s.today}`);
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push(sep);

  // ── Discovery & CRM
  lines.push("");
  lines.push("DISCOVERY & CRM");
  lines.push(pad("Total CRM leads", s.totalCrmLeads));
  lines.push(pad("New leads today", s.crmNewToday));
  lines.push(pad("Tier A", s.crmByTier.A));
  lines.push(pad("Tier B", s.crmByTier.B));
  lines.push(pad("Tier C", s.crmByTier.C));
  lines.push(pad("Confirmed / accepted", s.crmConfirmed));
  lines.push(pad("Offer acceptance rate", s.offerAcceptanceRate));
  lines.push(pad("Top theme today", s.topTheme));
  lines.push(pad("High-score signals (>=9)", s.highScoreOpps));
  lines.push(pad("Validated offer packs", s.validatedOffersCount));

  // ── Email outreach
  lines.push("");
  lines.push("EMAIL OUTREACH");
  lines.push(pad("Total clinics in queue", s.totalDentists));
  lines.push(pad("Emails pending (todo)", s.emailsPending));
  lines.push(pad("Initial emails sent (all time)", s.emailsSentTotal));
  lines.push(pad("Emails sent today", s.emailsSentToday));
  lines.push(pad("Emails sent yesterday", s.emailsSentYesterday));
  lines.push(pad("Total sent all time (SMTP)", s.totalEmailsSentAllTime));
  lines.push(pad("  → Initial sends (all time)", s.totalNewSentAllTime));
  lines.push(pad("  → Follow-ups (all time)", s.totalFuSentAllTime));
  lines.push(pad("Clinics with no email", s.noEmail));
  lines.push(pad("Open rate proxy", s.openRateProxy));
  lines.push(pad("Unique sends (deduped)", s.uniqueSentCount));
  lines.push(pad("Bounce rate (deduped)", s.bounceRateStr));
  if (s.totalBouncedCount / Math.max(s.uniqueSentCount, 1) > 0.05) {
    lines.push(`  ⚠ BOUNCE RATE EXCEEDS 5% — pause sending and clean list`);
  }

  // ── Follow-ups
  lines.push("");
  lines.push("FOLLOW-UPS (3-stage)");
  lines.push(pad("FU1 due now", s.fu1Due));
  lines.push(pad("FU1 due in next 7 days", s.fu1DueSoon));
  lines.push(pad("FU2 due now", s.fu2Due));
  lines.push(pad("FU1 sent (total)", s.fu1Sent));
  lines.push(pad("FU2 sent (total)", s.fu2Sent));
  lines.push(pad("FU3 sent (total)", s.fu3Sent));
  lines.push(pad("Sequences complete", s.followupsComplete));

  // ── Actionable intelligence (Part 6)
  lines.push("");
  lines.push("ACTION REQUIRED");
  if (s.actionRequired.length === 0) {
    lines.push("  None — inbox is clear");
  } else {
    lines.push(`  ${s.actionRequired.length} reply(s) need a response:`);
    s.actionRequired.slice(0, 5).forEach(d => {
      const src = d.classifySource === "claude" ? " [AI]" : "";
      lines.push(`  • ${(d.clinicName || d.fromEmail || "Unknown").slice(0, 35).padEnd(35)} → ${d.intent}${src}`);
      if (d.suggestedResponse) lines.push(`    Suggested: ${d.suggestedResponse.slice(0, 80)}`);
    });
    if (s.actionRequired.length > 5) lines.push(`  ... and ${s.actionRequired.length - 5} more`);
  }

  lines.push("");
  lines.push("HOT PROSPECTS (emailed in last 7 days, no reply yet)");
  if (s.hotProspects.length === 0) {
    lines.push("  None");
  } else {
    lines.push(`  ${s.hotProspects.length} clinic(s) worth following up:`);
    s.hotProspects.slice(0, 5).forEach(d => {
      const daysSince = d.sentAt ? Math.floor((Date.now() - Date.parse(d.sentAt)) / 86_400_000) : "?";
      lines.push(`  • ${(d.clinicName || d.email || "").slice(0, 38).padEnd(38)} ${daysSince}d ago  ${d.status}`);
    });
    if (s.hotProspects.length > 5) lines.push(`  ... and ${s.hotProspects.length - 5} more`);
  }

  lines.push("");
  lines.push("READY TO CLOSE (replied AUDIT_YES — send them the 3 questions)");
  if (s.readyToClose.length === 0) {
    lines.push("  None yet");
  } else {
    lines.push(`  ${s.readyToClose.length} clinic(s) ready for audit:`);
    s.readyToClose.forEach(d => {
      lines.push(`  • ${(d.clinicName || d.fromEmail || "Unknown").slice(0, 50)}`);
    });
    lines.push(`  Estimated pipeline: $${s.pipelineRevenue.toLocaleString()}`);
  }

  if (s.outOfOfficeQueue.length > 0) {
    lines.push("");
    lines.push("OUT OF OFFICE — FOLLOW-UP QUEUE");
    s.outOfOfficeQueue.forEach(e => {
      const flag = e.overdue ? " ⚠ DUE" : "";
      lines.push(`  • ${(e.clinicName || e.fromEmail || "").slice(0, 35).padEnd(35)} follow up ${e.followUpDate}${flag}`);
    });
  }

  lines.push("");
  lines.push("WINS THIS WEEK");
  if (s.winsThisWeek.length === 0) {
    lines.push("  No payments recorded this week");
  } else {
    s.winsThisWeek.forEach(w => lines.push(`  ✓ ${w.clinic}  $${w.amount || "paid"}`));
    lines.push(`  Total: $${s.winsRevenue.toLocaleString()}`);
  }

  lines.push("");
  lines.push("DELIVERABILITY TREND (last 7 days)");
  s.delivTrend.forEach(({ date, sent, fu, total }) => {
    const bar = "█".repeat(Math.min(20, total));
    lines.push(`  ${date}  new:${String(sent).padStart(2)} fu:${String(fu).padStart(2)} total:${String(total).padStart(3)}  ${bar}`);
  });

  lines.push("");
  lines.push("BEST PERFORMING SUBJECT LINES (by FU1 proceed rate)");
  if (s.bestSubject.length === 0) {
    lines.push("  Not enough data yet");
  } else {
    s.bestSubject.forEach(({ subject, fu1Count }) => {
      lines.push(`  ${String(fu1Count).padStart(3)} FU1s  "${subject.slice(0, 60)}"`);
    });
  }

  lines.push("");
  lines.push("VARIANT PERFORMANCE");
  if (s.variantPerf.length === 0) {
    lines.push("  No variant data yet (variantLabel field added going forward)");
  } else {
    lines.push(`  ${"Variant".padEnd(9)}${"Sent".padEnd(7)}${"→FU1".padEnd(10)}${"Reply rate"}`);
    lines.push(`  ${"─".repeat(38)}`);
    s.variantPerf.forEach(({ variant, sent, fu1, fu1Pct, replies, replyPct }) => {
      lines.push(`  ${variant.padEnd(9)}${String(sent).padEnd(7)}${`${fu1} (${fu1Pct})`.padEnd(10)}${replyPct}`);
    });
  }

  // ── Recommended Actions (Part 7)
  lines.push("");
  lines.push(s.recommendedActions);

  // ── Voice outreach
  lines.push("");
  lines.push("VOICE OUTREACH");
  lines.push(pad("Voicemail drops today", s.voiceDropsToday));
  lines.push(pad("Twilio calls made today", s.voiceCallsToday));
  lines.push(pad("Callbacks received today", s.callbacksToday));
  lines.push(pad("Total voice touches (all time)", s.totalVoiceTouches));
  lines.push(pad("Total callbacks (all time)", s.totalCallbacks));

  // ── System health
  lines.push("");
  lines.push("SYSTEM HEALTH");
  lines.push(pad("Last health check", s.lastHealthStatus));
  lines.push(pad("Scheduler errors today", s.totalSchedulerErrorsToday));

  if (s.schedulerErrors.length > 0) {
    lines.push("  Recent errors:");
    s.schedulerErrors.slice(0, 5).forEach((e) => lines.push("    " + e.trim()));
  }

  // ── Warnings
  if (s.warnings.length > 0) {
    lines.push("");
    lines.push("WARNINGS");
    s.warnings.forEach((w) => lines.push(w));
  }

  if (s.errors.length > 0) {
    lines.push("");
    lines.push("REPORT ERRORS");
    s.errors.forEach((e) => lines.push("  ! " + e));
  }

  lines.push("");
  lines.push(sep);
  lines.push("End of report");

  return lines.join("\n");
}

// ─── Main ─────────────────────────────────────────────────────────────────────

const stats = gatherStats();
const report = buildReport(stats);

console.log(report);

fs.mkdirSync(REPORTS_DIR, { recursive: true });
const outPath = path.join(REPORTS_DIR, `daily_${stats.today}.txt`);
fs.writeFileSync(outPath, report, "utf-8");
console.log(`\nReport saved → ${outPath}`);
