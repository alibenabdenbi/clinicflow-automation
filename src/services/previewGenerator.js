// src/services/previewGenerator.js
// Generates a personalized 1200x800 HTML operational preview for a prospect clinic.
// Designed to look like real internal front-desk software — not a marketing mockup.

/**
 * @param {object} clinic
 * @param {string} clinic.clinicName
 * @param {string} clinic.city
 * @param {number} [clinic.rating]
 * @param {number} [clinic.reviewCount]
 * @param {string} [clinic.painSignal]
 * @param {string} [clinic.type]  'dental' | 'physio' | 'salon'
 * @returns {string} full HTML document, 1200x800, no scroll
 */
export function generateClinicPreview(clinic) {
  const {
    clinicName = 'Your Clinic',
    city = 'Your City',
    rating = null,
    painSignal = null,
    type = 'dental',
  } = clinic;

  // Deterministic seed so same clinic always shows same numbers
  const seed = clinicName.split('').reduce((a, c) => a + c.charCodeAt(0), 0);
  const vary = (base, range) => base + (seed % range) - Math.floor(range / 2);

  const missedCallsRecovered = Math.max(3, vary(8, 6));
  const revenuePerPatient     = vary(185, 40);
  const revenueRecovered      = missedCallsRecovered * revenuePerPatient;
  const remindersSent         = Math.max(12, vary(41, 18));
  const remindersPending      = vary(4, 4);
  const deliveryRate          = Math.max(68, Math.min(94, vary(78, 12)));
  const undelivered           = Math.round(remindersSent * (1 - deliveryRate / 100));
  const pendingCallbacks      = Math.max(1, vary(3, 4));
  const overdueFollowups      = Math.max(4, vary(11, 8));
  const patientsReactivated   = Math.max(1, vary(2, 3));
  const activeThreads         = vary(3, 4);
  const lastSyncMin           = vary(4, 6);

  const businessLabel = type === 'physio' ? 'physiotherapy' : type === 'salon' ? 'salon' : 'dental';

  // Operational banner — observational, not salesy
  const bannerText = painSignal
    ? `Modeled from ${city} ${businessLabel} operational patterns — missed-call recovery focus`
    : `Modeled from ${city} ${businessLabel} operational patterns — 30-day simulation`;

  // Alert card if too many pending callbacks
  const showAlert = pendingCallbacks >= 2;

  // Feed items — real timestamps, mixed outcomes
  const today = new Date();
  const fmt = (d) => d.toLocaleTimeString('en-CA', { hour: '2-digit', minute: '2-digit', hour12: true });
  const t0 = fmt(new Date(today.getTime() - 23 * 60 * 1000));
  const t1 = fmt(new Date(today.getTime() - 2.1 * 60 * 60 * 1000));
  const t2 = fmt(new Date(today.getTime() - 5.3 * 60 * 60 * 1000));

  const shortName = clinicName.length > 22 ? clinicName.slice(0, 20) + '…' : clinicName;

  // Seeded staff names — deterministic per clinic
  const staffNames = ['Julie', 'Sarah', 'Marie', 'Jessica', 'Emma', 'Priya'];
  const staff1 = staffNames[seed % staffNames.length];
  const staff2 = staffNames[(seed + 2) % staffNames.length];

  // Seeded front desk load
  const loadLabels = ['Low', 'Moderate', 'Moderate', 'High'];
  const frontDeskLoad = loadLabels[seed % loadLabels.length];
  const loadColor = frontDeskLoad === 'High' ? '#ff5c7a' : frontDeskLoad === 'Moderate' ? '#f6b04d' : '#39d98a';

  // Seeded avg response time (42–67s)
  const avgResponseTime = Math.max(42, Math.min(67, vary(54, 26)));

  const feed = [
    { ts: `Today ${t0}`, icon: '✓',  color: '#39d98a', label: 'recovered',  text: `Patient called ${shortName} after hours — auto-text sent (${vary(47, 20)}s)` },
    { ts: `Today ${t1}`, icon: '⏳', color: '#f6b04d', label: 'pending',    text: `${staff1} marked callback as pending — follow-up scheduled` },
    { ts: `Today ${t2}`, icon: '⏳', color: '#f6b04d', label: 'no reply',   text: `Reminder sent to K.L. — no response yet, retry tomorrow` },
    { ts: 'Yesterday 4:47pm', icon: '🔄', color: '#60a5fa', label: 'pending', text: `Inactive patient reached out — booking conversation started` },
    { ts: 'Yesterday 2:11pm', icon: '✓',  color: '#39d98a', label: 'confirmed', text: `${staff2} manually resent reminder — patient confirmed ✓` },
    { ts: 'Yesterday 11:32am', icon: '🔄', color: '#60a5fa', label: 'reopened', text: `Front desk reopened M.T.'s follow-up thread` },
    { ts: 'Mon 9:08am', icon: '⚙',  color: '#94a3b8', label: 'queued',    text: `Voicemail from unknown number — transcription pending` },
    { ts: 'Mon 8:51am', icon: '✗',  color: '#ff5c7a', label: 'failed',    text: `SMS delivery failed (carrier) — retry scheduled in 4h` },
  ];

  const feedHtml = feed.map(f => `
    <div class="feed-row">
      <div class="feed-ts">${f.ts}</div>
      <div class="feed-status" style="color:${f.color}">${f.icon} ${f.label}</div>
      <div class="feed-text">${f.text}</div>
    </div>`).join('');

  const alertHtml = showAlert ? `
    <div class="alert-card">
      <span class="alert-icon">⚠</span>
      <span class="alert-msg">${pendingCallbacks} patients waiting for callback — oldest 2 days ago</span>
      <span class="alert-action">Review →</span>
    </div>` : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${clinicName} — ClinicFlow</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Syne:wght@400;600;700;800&family=Syne+Mono&display=swap" rel="stylesheet">
<style>
*{box-sizing:border-box;margin:0;padding:0}
html,body{
  width:1200px;height:800px;overflow:hidden;
  background:#0b0f17;color:#e8eefc;
  font-family:'Syne',ui-sans-serif,system-ui,sans-serif;
  background-image:
    radial-gradient(700px 400px at 8% -8%,rgba(124,92,255,.11),transparent 55%),
    radial-gradient(500px 350px at 92% 88%,rgba(57,217,138,.06),transparent 55%);
}
.wrap{width:1200px;height:800px;display:flex;flex-direction:column;padding:18px 26px 14px;overflow:hidden}

/* ── Top bar */
.topbar{display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;flex-shrink:0}
.brand{display:flex;align-items:center;gap:14px}
.brand-logo{font-size:11px;font-weight:700;color:#7c5cff;letter-spacing:.12em;text-transform:uppercase;opacity:.7}
.brand-sep{width:1px;height:14px;background:rgba(255,255,255,.12)}
.clinic-id{font-size:15px;font-weight:800;color:#e8eefc}
.topbar-right{display:flex;align-items:center;gap:16px}
.sync-label{font-size:11px;color:rgba(255,255,255,.28);font-family:'Syne Mono',monospace}

/* ── Banner */
.banner{font-size:11px;color:rgba(255,255,255,.38);background:rgba(255,255,255,.04);
  border:1px solid rgba(255,255,255,.07);border-radius:6px;padding:6px 12px;
  margin-bottom:12px;flex-shrink:0;letter-spacing:.02em}

/* ── Alert card */
.alert-card{display:flex;align-items:center;gap:10px;background:rgba(255,92,122,.08);
  border:1px solid rgba(255,92,122,.25);border-radius:8px;padding:7px 14px;
  margin-bottom:12px;flex-shrink:0}
.alert-icon{font-size:13px}
.alert-msg{font-size:12px;color:#ff9eb0;flex:1}
.alert-action{font-size:11px;font-weight:700;color:#ff5c7a;cursor:pointer;opacity:.7}

/* ── Stat grid */
.stats-row{display:grid;grid-template-columns:repeat(7,1fr);gap:10px;margin-bottom:12px;flex-shrink:0}
.stat-card{background:rgba(255,255,255,.055);border:1px solid rgba(255,255,255,.08);
  border-radius:12px;padding:12px 14px;backdrop-filter:blur(16px)}
.stat-num{font-size:22px;font-weight:800;line-height:1;margin-bottom:3px;font-family:'Syne',sans-serif}
.stat-lbl{font-size:10px;color:rgba(255,255,255,.4);text-transform:uppercase;letter-spacing:.06em;font-weight:600}
.stat-sub{font-size:10px;color:rgba(255,255,255,.22);margin-top:2px}

/* ── Content row */
.content-row{display:grid;grid-template-columns:1fr 268px;gap:12px;flex:1;min-height:0}

/* ── Feed */
.feed-card{background:rgba(255,255,255,.055);border:1px solid rgba(255,255,255,.08);
  border-radius:12px;padding:14px 16px;overflow:hidden;display:flex;flex-direction:column;backdrop-filter:blur(16px)}
.section-head{font-size:10px;font-weight:700;color:rgba(255,255,255,.3);text-transform:uppercase;
  letter-spacing:.1em;margin-bottom:10px;flex-shrink:0}
.feed-row{display:grid;grid-template-columns:106px 90px 1fr;gap:6px;align-items:center;
  padding:7px 0;border-bottom:1px solid rgba(255,255,255,.05);flex-shrink:0}
.feed-row:last-child{border:none}
.feed-ts{font-size:10px;color:rgba(255,255,255,.28);font-family:'Syne Mono',monospace}
.feed-status{font-size:10px;font-weight:700}
.feed-text{font-size:11px;color:rgba(255,255,255,.65);line-height:1.35}

/* ── Sidebar */
.sidebar{display:flex;flex-direction:column;gap:10px;overflow:hidden}
.side-card{background:rgba(255,255,255,.055);border:1px solid rgba(255,255,255,.08);
  border-radius:12px;padding:14px 16px;flex-shrink:0;backdrop-filter:blur(16px)}
.side-head{font-size:10px;font-weight:700;color:rgba(255,255,255,.3);text-transform:uppercase;
  letter-spacing:.1em;margin-bottom:10px}
.sys-row{display:flex;justify-content:space-between;align-items:center;
  padding:4px 0;border-bottom:1px solid rgba(255,255,255,.05);font-size:11px}
.sys-row:last-child{border:none}
.sys-key{color:rgba(255,255,255,.38)}
.sys-val{font-family:'Syne Mono',monospace;font-size:10px}
.sys-ok{color:#39d98a}
.sys-warn{color:#f6b04d}
.sys-err{color:#ff5c7a}

.metric-row{display:flex;justify-content:space-between;align-items:baseline;
  padding:5px 0;border-bottom:1px solid rgba(255,255,255,.05)}
.metric-row:last-child{border:none}
.metric-lbl{font-size:11px;color:rgba(255,255,255,.45)}
.metric-val{font-size:13px;font-weight:700;font-family:'Syne Mono',monospace}

/* ── Bottom bar */
.bottom-bar{display:flex;justify-content:space-between;align-items:center;
  margin-top:10px;padding-top:9px;border-top:1px solid rgba(255,255,255,.06);flex-shrink:0}
.bottom-left{font-size:10px;color:rgba(255,255,255,.2);font-family:'Syne Mono',monospace}
.bottom-right{font-size:10px;color:rgba(255,255,255,.14);font-style:italic}
</style>
</head>
<body>
<div class="wrap">

  <div class="topbar">
    <div class="brand">
      <div class="brand-logo">ClinicFlow</div>
      <div class="brand-sep"></div>
      <div class="clinic-id">${clinicName}</div>
    </div>
    <div class="topbar-right">
      <div class="sync-label">last sync: ${lastSyncMin}m ago</div>
    </div>
  </div>

  <div class="banner">${bannerText}</div>

  ${alertHtml}

  <div class="stats-row">
    <div class="stat-card">
      <div class="stat-num" style="color:#39d98a">${missedCallsRecovered}</div>
      <div class="stat-lbl">Calls recovered</div>
      <div class="stat-sub">This month</div>
    </div>
    <div class="stat-card">
      <div class="stat-num" style="color:#39d98a">$${revenueRecovered.toLocaleString()}</div>
      <div class="stat-lbl">Revenue recovered</div>
      <div class="stat-sub">~$${revenuePerPatient}/patient</div>
    </div>
    <div class="stat-card">
      <div class="stat-num" style="color:#7c5cff">${remindersSent}</div>
      <div class="stat-lbl">Reminders sent</div>
      <div class="stat-sub">${remindersPending} pending</div>
    </div>
    <div class="stat-card">
      <div class="stat-num" style="color:#f6b04d">${deliveryRate}%</div>
      <div class="stat-lbl">Delivery rate</div>
      <div class="stat-sub">${undelivered} undelivered</div>
    </div>
    <div class="stat-card">
      <div class="stat-num" style="color:#60a5fa">${pendingCallbacks}</div>
      <div class="stat-lbl">Callbacks pending</div>
      <div class="stat-sub">Oldest: 2 days ago</div>
    </div>
    <div class="stat-card">
      <div class="stat-num" style="color:#ff5c7a">${overdueFollowups}</div>
      <div class="stat-lbl">Overdue follow-ups</div>
      <div class="stat-sub">Need attention</div>
    </div>
    <div class="stat-card">
      <div class="stat-num" style="color:#a78bfa">${patientsReactivated}</div>
      <div class="stat-lbl">Reactivated</div>
      <div class="stat-sub">Inactive → booked</div>
    </div>
  </div>

  <div class="content-row">
    <div class="feed-card">
      <div class="section-head">Activity Log</div>
      ${feedHtml}
    </div>

    <div class="sidebar">
      <div class="side-card">
        <div class="side-head">System Status</div>
        <div class="sys-row">
          <span class="sys-key">Scheduler</span>
          <span class="sys-val sys-ok">running ✓</span>
        </div>
        <div class="sys-row">
          <span class="sys-key">Last sync</span>
          <span class="sys-val" style="color:rgba(255,255,255,.4)">${lastSyncMin}m ago</span>
        </div>
        <div class="sys-row">
          <span class="sys-key">Active threads</span>
          <span class="sys-val sys-ok">${activeThreads}</span>
        </div>
        <div class="sys-row">
          <span class="sys-key">Next batch</span>
          <span class="sys-val sys-warn">Today 3:00pm</span>
        </div>
        <div class="sys-row">
          <span class="sys-key">Front desk load</span>
          <span class="sys-val" style="color:${loadColor}">${frontDeskLoad}</span>
        </div>
        <div class="sys-row">
          <span class="sys-key">Avg response</span>
          <span class="sys-val sys-ok">${avgResponseTime}s</span>
        </div>
        <div class="sys-row">
          <span class="sys-key">Voicemail queue</span>
          <span class="sys-val sys-err">1 pending review</span>
        </div>
      </div>

      <div class="side-card">
        <div class="side-head">Workflow Metrics</div>
        <div class="metric-row">
          <span class="metric-lbl">Avg response time</span>
          <span class="metric-val" style="color:#39d98a">${vary(52, 20)}s</span>
        </div>
        <div class="metric-row">
          <span class="metric-lbl">Recovery rate</span>
          <span class="metric-val" style="color:#39d98a">${Math.min(94, vary(67, 16))}%</span>
        </div>
        <div class="metric-row">
          <span class="metric-lbl">Missed → booked</span>
          <span class="metric-val" style="color:#7c5cff">${vary(5, 4)} this week</span>
        </div>
        <div class="metric-row">
          <span class="metric-lbl">Unresponded</span>
          <span class="metric-val" style="color:#f6b04d">${vary(3, 4)} (2 overdue)</span>
        </div>
      </div>
    </div>
  </div>

  <div class="bottom-bar">
    <div class="bottom-left">Operational preview · ${city} ${businessLabel} · ${new Date().toLocaleDateString('en-CA')}</div>
    <div class="bottom-right">Operational preview — ${clinicName} — ${new Date().toLocaleDateString('en-CA', { month: 'short', day: 'numeric', year: 'numeric' })}</div>
  </div>

</div>
</body>
</html>`;
}
