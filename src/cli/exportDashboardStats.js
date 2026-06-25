// src/cli/exportDashboardStats.js
// Exports two sets of stats every time it runs:
//
//   1. Outreach pipeline stats → public/netlify-deploy/data/outreach-stats.json
//      (same as before: sent emails, bounces, follow-up queue, variant opens)
//
//   2. Client delivery stats → rebuilds data/clients/{slug}/stats.json for
//      every active client by reading their events.json from scratch.
//      This is the source of truth the portal reads via the client-stats
//      Netlify function. Running this daily guarantees the portal is never
//      showing stale or incomplete data.
//
// Run daily at 11:00 via scheduler, or manually:
//   node src/cli/exportDashboardStats.js

import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
dotenv.config();

const ROOT        = process.cwd();
const CLIENTS_DIR = path.join(ROOT, 'data', 'clients');
const OUT_DIR     = path.join(ROOT, 'public', 'netlify-deploy', 'data');

// ─── Helpers ──────────────────────────────────────────────────────────────────

function readJsonSafe(p, fb) {
  try {
    if (!fs.existsSync(p)) return fb;
    return JSON.parse(fs.readFileSync(p, 'utf-8'));
  } catch { return fb; }
}

function writeJsonSafe(p, data) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(data, null, 2), 'utf-8');
}

function digitsOnly(s) { return String(s || '').replace(/\D/g, ''); }

// ─── 1. Outreach pipeline export (unchanged) ──────────────────────────────────

function exportOutreachStats() {
  const outreach = readJsonSafe('data/outreach.localDentists.json', []);
  const physio   = readJsonSafe('data/outreach.physioClinics.json', []);
  const salon    = readJsonSafe('data/outreach.salonBusinesses.json', []);
  const all      = [...outreach, ...physio, ...salon];

  const statusCounts = {};
  const variantCounts = {};
  all.forEach(c => {
    statusCounts[c.status] = (statusCounts[c.status] || 0) + 1;
    if (c.variantLabel) variantCounts[c.variantLabel] = (variantCounts[c.variantLabel] || 0) + 1;
  });

  const sent      = statusCounts['sent']             || 0;
  const fu1       = statusCounts['followup_1_sent']  || 0;
  const fu2       = statusCounts['followup_2_sent']  || 0;
  const fu3       = statusCounts['followup_3_sent']  || 0;
  const bounced   = statusCounts['bounced']          || 0;
  const totalSent = sent + fu1 + fu2 + fu3;

  let opens = [];
  try { opens = JSON.parse(fs.readFileSync('data/opens.json', 'utf-8')); } catch {}

  const now    = Date.now();
  const fuDays = { sent: 4, followup_1_sent: 4, followup_2_sent: 7 };
  const fuLabels = { sent: 'FU1 due', followup_1_sent: 'FU2 due', followup_2_sent: 'FU3 due' };

  const fuQueue = all
    .filter(c => fuDays[c.status] && (c.lastSentAt || c.sentAt))
    .map(c => {
      const last    = new Date(c.lastSentAt || c.sentAt).getTime();
      const due     = last + fuDays[c.status] * 86_400_000;
      const daysLeft = Math.ceil((due - now) / 86_400_000);
      return { clinicName: c.clinicName, status: c.status, stageLabel: fuLabels[c.status], daysLeft };
    })
    .sort((a, b) => a.daysLeft - b.daysLeft)
    .slice(0, 15);

  const variantOpens = {};
  opens.forEach(o => { variantOpens[o.variant] = (variantOpens[o.variant] || 0) + 1; });

  const stats = {
    generatedAt: new Date().toISOString(),
    sent: totalSent,
    bounced,
    followups: fu1 + fu2 + fu3,
    variantCounts,
    variantOpens,
    statusCounts,
    fuQueue,
    recentOpens: [...opens].sort((a, b) => b.openedAt.localeCompare(a.openedAt)).slice(0, 8),
    totalOpens: opens.length,
  };

  fs.mkdirSync(OUT_DIR, { recursive: true });
  writeJsonSafe(path.join(OUT_DIR, 'outreach-stats.json'), stats);
  console.log(`✓ Stats exported to ${OUT_DIR}/outreach-stats.json`);
  console.log(`  Sent: ${totalSent} | Bounced: ${bounced} | Opens: ${opens.length} | FU queue: ${fuQueue.length}`);
}

// ─── 2. Client delivery stats rebuilt from event log ─────────────────────────

/**
 * Rebuild one client's stats.json completely from their events.json.
 * This is authoritative — event log is the source of truth.
 *
 * Reads:
 *   data/clients/{slug}/events.json
 *   data/clients/{slug}/recovery-threads.json  (for thread-level detail)
 *   data/clients/{slug}/patient-scores.json     (for predictive data)
 *   data/clients/{slug}/intelligence.json       (for forecast)
 *   data/clients/{slug}/clinic-brain.json       (for meta)
 *
 * Writes:
 *   data/clients/{slug}/stats.json   — read by client-stats Netlify function → portal
 */
function rebuildClientStats(clientRecord) {
  const slug   = clientRecord.clinicSlug;
  if (!slug) return;

  const dir    = path.join(CLIENTS_DIR, slug);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const events  = readJsonSafe(path.join(dir, 'events.json'), []);
  const threads = readJsonSafe(path.join(dir, 'recovery-threads.json'), []);
  const scores  = readJsonSafe(path.join(dir, 'patient-scores.json'), { scores: [] });
  const intel   = readJsonSafe(path.join(dir, 'intelligence.json'), null);
  const brain   = readJsonSafe(path.join(dir, 'clinic-brain.json'), null);

  const now   = Date.now();
  const thisMonthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).getTime();
  const lastMonthStart = new Date(new Date().getFullYear(), new Date().getMonth() - 1, 1).getTime();

  // ── Recovery funnel from threads (most accurate) ──────────────────────────
  const totalThreads   = threads.length;
  const wave1Sent      = threads.filter(t => t.messages?.some(m => m.wave === 1 && m.success)).length;
  const wave2Sent      = threads.filter(t => t.messages?.some(m => m.wave === 2 && m.success)).length;
  const wave3Sent      = threads.filter(t => t.messages?.some(m => m.wave === 3 && m.success)).length;
  const replied        = threads.filter(t => t.reply != null).length;
  const recovered      = threads.filter(t => t.recovered).length;
  const optedOut       = threads.filter(t => t.status === 'opted_out').length;
  const exhausted      = threads.filter(t => t.status === 'exhausted').length;
  const waiting        = threads.filter(t => ['wave1_sent', 'wave2_sent'].includes(t.status)).length;
  const replyRate      = wave1Sent > 0 ? Math.round((replied / wave1Sent) * 100) : 0;
  const recoveryRate   = wave1Sent > 0 ? Math.round((recovered / wave1Sent) * 100) : 0;

  // ── Monthly comparison from threads ──────────────────────────────────────
  function monthStats(start, end) {
    const mThreads = threads.filter(t => {
      const ts = new Date(t.calledAt || 0).getTime();
      return ts >= start && ts < end;
    });
    const mWave1    = mThreads.filter(t => t.messages?.some(m => m.wave === 1 && m.success)).length;
    const mRecovered = mThreads.filter(t => t.recovered).length;
    const mRate     = mWave1 > 0 ? Math.round((mRecovered / mWave1) * 100) : 0;
    return { calls: mThreads.length, recovered: mRecovered, recoveryRate: mRate, revenue: mRecovered * 200 };
  }
  const thisMonthStats = monthStats(thisMonthStart, now);
  const lastMonthStats = monthStats(lastMonthStart, thisMonthStart);

  // ── Recent activity from event log (last 50, newest first) ───────────────
  const recentActivity = [...events]
    .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
    .slice(0, 50)
    .map(e => ({
      type:         e.type,
      patientName:  e.patientName  || null,
      callerNumber: e.patientPhone || null,
      message:      (e.content || '').slice(0, 100),
      time:         e.timestamp,
      outcome:      e.outcome,
      direction:    e.direction,
      sentiment:    e.sentiment    || null,
      intent:       e.intent       || null,
    }));

  // ── Heatmap rebuilt from MISSED_CALL events ───────────────────────────────
  const heatmap = {};
  for (let d = 0; d < 7; d++) {
    heatmap[d] = {};
    for (let h = 8; h < 18; h++) heatmap[d][h] = 0;
  }
  events
    .filter(e => e.type === 'missed_call')
    .forEach(e => {
      const d   = new Date(e.timestamp);
      const day  = (d.getDay() + 6) % 7;   // Mon=0…Sun=6
      const hour = d.getHours();
      if (hour >= 8 && hour < 18 && heatmap[day]) {
        heatmap[day][hour] = (heatmap[day][hour] || 0) + 1;
      }
    });

  // ── Patients at risk (10–13 months inactive) from CSV ────────────────────
  let patientsAtRisk = [];
  const csvPath = path.join(dir, 'patients.csv');
  if (fs.existsSync(csvPath)) {
    const lines   = fs.readFileSync(csvPath, 'utf-8').split(/\r?\n/).filter(l => l.trim());
    const headers = lines[0]?.split(',').map(h => h.trim().toLowerCase()) || [];
    const patients = lines.slice(1).map(line => {
      const vals = line.split(',');
      const obj  = {};
      headers.forEach((h, i) => { obj[h] = (vals[i] || '').trim(); });
      return obj;
    });
    patientsAtRisk = patients
      .map(p => {
        const lastVisit = p.last_visit || p.lastvisit || '';
        if (!lastVisit) return null;
        const months = (now - new Date(lastVisit).getTime()) / (30.44 * 24 * 3600 * 1000);
        if (months < 10 || months > 13) return null;
        return { name: p.name, lastVisit, monthsInactive: Math.round(months) };
      })
      .filter(Boolean)
      .sort((a, b) => b.monthsInactive - a.monthsInactive);
  }

  // ── Aggregated results from events ───────────────────────────────────────
  const missedCallsHandled    = threads.filter(t => t.messages?.some(m => m.wave === 1 && m.success)).length;
  const appointmentsReminded  = events.filter(e => ['appointment_reminder_72h', 'appointment_reminder_24h'].includes(e.type)).length;
  const patientsReactivated   = events.filter(e => e.type === 'reactivation_wave_1').length;
  const revenueAttributed     = events.reduce((sum, e) => sum + (e.revenueAttributed || 0), 0)
    + recovered * 200; // base recovery revenue

  // ── Referral data ─────────────────────────────────────────────────────────
  const referralEvents = events.filter(e => e.type === 'referral_sent');

  // ── Build the complete stats object ──────────────────────────────────────
  const statsOut = {
    // Client identity (from clients.json record)
    ...clientRecord,

    // Rebuild timestamp
    updatedAt: new Date().toISOString(),

    // Service results from events
    results: {
      missedCallsHandled,
      appointmentsReminded,
      patientsReactivated,
      estimatedRevenueRecovered: revenueAttributed,
    },

    // Recovery funnel
    recovery: {
      total: totalThreads,
      wave1Sent,
      wave2Sent,
      wave3Sent,
      replied,
      recovered,
      optedOut,
      exhausted,
      waiting,
      replyRate,
      recoveryRate,
    },

    // Portal feed
    recentActivity,
    heatmap,
    patientsAtRisk,

    // Month-over-month
    comparison: {
      thisMonth: thisMonthStats,
      lastMonth: lastMonthStats,
    },

    // Intelligence (from predictive engine output)
    intelligence: intel ? {
      summary:              intel.summary || '',
      forecastConservative: intel.forecast?.scenarios?.conservative?.revenue || 0,
      forecastExpected:     intel.forecast?.scenarios?.expected?.revenue     || 0,
      forecastOptimistic:   intel.forecast?.scenarios?.optimistic?.revenue   || 0,
      urgentPatients:       (intel.topActions || []).filter(a => a.action === 'urgent_outreach').length,
      atRiskLTV:            intel.forecast?.ltvAtRisk || 0,
    } : null,

    // Brain metadata for portal display
    brain: brain ? {
      type:      brain.type,
      languages: brain.languages,
      services:  (brain.services || []).length,
      hasFaqs:   (brain.faqs || []).length > 0,
    } : null,

    // Referral
    referral: {
      count:   clientRecord.referralCount || 0,
      clicks:  referralEvents.length,
      signups: 0,
    },
  };

  writeJsonSafe(path.join(dir, 'stats.json'), statsOut);
  return { slug, missedCallsHandled, recovered, revenueAttributed, events: events.length };
}

/**
 * Rebuild stats.json for ALL active clients and export a combined summary.
 */
function exportClientStats() {
  const clients = readJsonSafe('data/clients.json', []);
  const active  = clients.filter(c => c.clinicSlug && c.status === 'active');

  console.log(`\n✓ Rebuilding client stats from event log (${active.length} active client(s))...`);

  const summary = [];
  for (const client of active) {
    try {
      const result = rebuildClientStats(client);
      summary.push(result);
      console.log(`  ${result.slug}: ${result.events} events | ${result.missedCallsHandled} handled | ${result.recovered} recovered | $${result.revenueAttributed} revenue`);
    } catch (err) {
      console.error(`  ✗ ${client.clinicSlug}: ${err.message}`);
    }
  }

  // Export combined client summary for operator monitoring
  writeJsonSafe(path.join(OUT_DIR, 'clients-stats.json'), {
    generatedAt: new Date().toISOString(),
    activeClients: active.length,
    clients: summary,
  });
  console.log(`✓ Client stats exported to ${OUT_DIR}/clients-stats.json`);
}

// ─── Main ─────────────────────────────────────────────────────────────────────

exportOutreachStats();
exportClientStats();
