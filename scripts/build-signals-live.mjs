// Builds signals.html that loads live data from /.netlify/functions/get-signals
import fs from 'fs';
import dotenv from 'dotenv';
dotenv.config();

const dental       = JSON.parse(fs.readFileSync('data/outreach.localDentists.json', 'utf8'));
const contacted    = dental.filter(c => c.sentAt || c.lastContactedAt || c.status === 'sent').length;
const bounced      = dental.filter(c => c.status === 'bounced').length;
const screenshot   = dental.filter(c => c.screenshotSentAt).length;
const personal     = dental.filter(c => c.personalFollowupAt).length;
const readyToSend  = dental.filter(c => c.email && c.status === 'todo').length;
let linkedinStreak = 0;
try { const log = JSON.parse(fs.readFileSync('data/linkedin/post-log.json', 'utf8')); linkedinStreak = log.length; } catch {}

const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1">
<title>Signal Tracker — ClinicFlow</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#0b0f17;color:#f1f5f9;min-height:100vh}
#pin-screen{position:fixed;inset:0;background:#0b0f17;display:flex;flex-direction:column;align-items:center;justify-content:center;z-index:999;padding:20px}
#app{display:none;padding:20px;max-width:900px;margin:0 auto;padding-bottom:60px}
.pin-input{font-size:24px;letter-spacing:8px;padding:14px 20px;border:2px solid rgba(255,255,255,.15);border-radius:12px;background:rgba(255,255,255,.07);color:#fff;text-align:center;width:200px;margin-bottom:14px;outline:none;transition:border-color .2s}
.pin-input:focus{border-color:#7c5cff}
.pin-btn{background:#7c5cff;color:#fff;border:none;padding:14px 0;border-radius:10px;font-size:16px;font-weight:700;width:200px;cursor:pointer}
.pin-err{color:#f87171;margin-top:10px;font-size:14px;display:none}
.top-bar{display:flex;justify-content:space-between;align-items:center;margin-bottom:24px;padding-bottom:16px;border-bottom:1px solid #1e293b;flex-wrap:wrap;gap:10px}
.section-title{font-size:12px;font-weight:700;color:#4a5568;text-transform:uppercase;letter-spacing:1px;margin:24px 0 12px}
.stat-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-bottom:8px}
@media(max-width:600px){.stat-grid{grid-template-columns:repeat(2,1fr)}}
.stat-card{background:#111827;border-radius:12px;padding:16px;text-align:center;border:1px solid #1e293b}
.stat-num{font-size:32px;font-weight:800;margin-bottom:4px}
.stat-lbl{font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:.5px}
.funnel{display:flex;margin-bottom:8px;background:#111827;border-radius:12px;overflow:hidden;border:1px solid #1e293b}
.funnel-step{flex:1;min-width:70px;padding:14px 8px;text-align:center;border-right:1px solid #1e293b}
.funnel-step:last-child{border:none}
.funnel-num{font-size:22px;font-weight:800;color:#f1f5f9}
.funnel-lbl{font-size:10px;color:#64748b;text-transform:uppercase;margin-top:3px}
.funnel-rate{font-size:11px;color:#4a5568;margin-top:2px}
.lead-card{background:#111827;border-radius:12px;padding:18px;margin-bottom:12px;border:1px solid #1e293b;border-left-width:4px}
.conf-badge{padding:3px 10px;border-radius:20px;font-size:11px;font-weight:700}
table{width:100%;border-collapse:collapse;background:#111827;border-radius:12px;overflow:hidden;border:1px solid #1e293b}
th{padding:10px 12px;text-align:left;font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:.5px;border-bottom:1px solid #1e293b}
td{padding:10px 12px;font-size:13px;color:#94a3b8;border-bottom:1px solid #0f172a}
tr:last-child td{border:none}
.refresh-btn{background:#1e293b;color:#94a3b8;border:none;padding:8px 14px;border-radius:8px;font-size:12px;cursor:pointer}
.pulse{animation:pulse 2s infinite}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.3}}
.action-btn{background:#7c5cff;color:#fff;border:none;padding:8px 14px;border-radius:8px;font-size:12px;font-weight:600;cursor:pointer;text-decoration:none;display:inline-block;margin-right:8px}
.done-tag{background:#14532d;color:#4ade80;padding:8px 14px;border-radius:8px;font-size:12px;font-weight:600;display:inline-block}
.empty-state{color:#64748b;padding:20px;text-align:center;background:#111827;border-radius:12px;font-size:14px}
</style>
</head>
<body>

<div id="pin-screen">
  <div style="font-size:11px;letter-spacing:4px;color:#4a5568;margin-bottom:8px">CLINICFLOW</div>
  <div style="font-size:22px;font-weight:700;color:#fff;margin-bottom:4px">Signal Tracker</div>
  <div style="font-size:13px;color:#64748b;margin-bottom:28px">Internal — Mohamed only</div>
  <input class="pin-input" type="password" id="pin-inp" placeholder="PIN" maxlength="4" autocomplete="off" inputmode="numeric">
  <button class="pin-btn" onclick="checkPin()">Unlock</button>
  <div class="pin-err" id="pin-err">Wrong PIN</div>
</div>

<div id="app">
  <div class="top-bar">
    <div>
      <div style="font-size:11px;letter-spacing:3px;color:#4a5568">CLINICFLOW</div>
      <div style="font-size:22px;font-weight:700">Signal Tracker</div>
      <div style="font-size:12px;color:#64748b" id="last-updated">Loading live data...</div>
    </div>
    <button class="refresh-btn" onclick="loadSignals()">↻ Refresh</button>
  </div>

  <div class="section-title">Today's Pulse</div>
  <div class="stat-grid">
    <div class="stat-card"><div class="stat-num pulse" style="color:#4ade80" id="stat-strong">—</div><div class="stat-lbl">🔥 Strong</div></div>
    <div class="stat-card"><div class="stat-num pulse" style="color:#fbbf24" id="stat-medium">—</div><div class="stat-lbl">⚡ Medium</div></div>
    <div class="stat-card"><div class="stat-num pulse" style="color:#60a5fa" id="stat-mobile">—</div><div class="stat-lbl">📱 Mobile</div></div>
    <div class="stat-card"><div class="stat-num pulse" style="color:#a78bfa" id="stat-humans">—</div><div class="stat-lbl">👤 Real Humans</div></div>
    <div class="stat-card"><div class="stat-num" style="color:#f97316">${screenshot}</div><div class="stat-lbl">📸 Screenshots</div></div>
    <div class="stat-card"><div class="stat-num" style="color:#0077b5">${linkedinStreak}</div><div class="stat-lbl">LinkedIn Posts</div></div>
  </div>

  <div class="section-title">Pipeline Funnel</div>
  <div class="funnel">
    <div class="funnel-step"><div class="funnel-num">${dental.length.toLocaleString()}</div><div class="funnel-lbl">Mapped</div></div>
    <div class="funnel-step"><div class="funnel-num">${contacted.toLocaleString()}</div><div class="funnel-lbl">Contacted</div><div class="funnel-rate">${Math.round(contacted/dental.length*100)}%</div></div>
    <div class="funnel-step"><div class="funnel-num" id="funnel-opened">—</div><div class="funnel-lbl">Opened</div></div>
    <div class="funnel-step"><div class="funnel-num">${personal}</div><div class="funnel-lbl">Personal</div></div>
    <div class="funnel-step"><div class="funnel-num" style="color:#4ade80">0</div><div class="funnel-lbl">Closed</div></div>
  </div>

  <div class="section-title">🔥 Hot Leads — Act On These</div>
  <div id="hot-leads"><div class="empty-state pulse">Loading live signals from Blobs...</div></div>

  <div class="section-title">All Signals Today</div>
  <div id="all-signals"><div class="empty-state pulse">Loading...</div></div>

  <div class="section-title">LinkedIn</div>
  <div style="background:#111827;border-radius:12px;padding:16px;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px;border:1px solid #1e293b">
    <div>
      <div style="font-size:13px;color:#94a3b8;margin-bottom:4px">Posts logged</div>
      <div style="font-size:32px;font-weight:800;color:#0077b5">${linkedinStreak} day${linkedinStreak!==1?'s':''}</div>
    </div>
    <a href="https://www.linkedin.com/feed/?shareActive=true" target="_blank"
       style="background:#0077b5;color:#fff;padding:10px 16px;border-radius:8px;font-size:13px;font-weight:600;text-decoration:none">Post Today →</a>
  </div>

  <div class="section-title">System Status</div>
  <div style="background:#111827;border-radius:12px;padding:16px;font-size:13px;color:#94a3b8;line-height:2.2;border:1px solid #1e293b">
    <div>📧 Ready to send: <span style="color:#f1f5f9;font-weight:600">${readyToSend} clinics</span></div>
    <div>📸 Screenshots sent: <span style="color:#f1f5f9;font-weight:600">${screenshot}</span></div>
    <div>🏥 Bounced: <span style="color:#f87171;font-weight:600">${bounced}</span></div>
    <div>🌐 Live page: <a href="/live" style="color:#7c5cff">clinicflowautomation.com/live</a></div>
    <div>📊 Next batch: Monday 10:00am — anomaly emails</div>
    <div>🔄 Signals: <span style="color:#4ade80;font-weight:600">Live — Netlify Blobs, updates on every open</span></div>
  </div>
</div>

<script>
const PIN = '8268';
const C = {
  STRONG: { bg:'#14532d', text:'#4ade80', border:'#16a34a', label:'🔥 STRONG' },
  MEDIUM: { bg:'#78350f', text:'#fcd34d', border:'#d97706', label:'⚡ MEDIUM' },
  WEAK:   { bg:'#1e3a5f', text:'#93c5fd', border:'#2563eb', label:'👁 WEAK'   },
  BOT:    { bg:'#1a1f2e', text:'#4a5568', border:'#374151', label:'🤖 BOT'    },
};

function checkPin() {
  if (document.getElementById('pin-inp').value === PIN) {
    document.getElementById('pin-screen').style.display = 'none';
    document.getElementById('app').style.display = 'block';
    sessionStorage.setItem('cf_sig','1');
    loadSignals();
    setInterval(loadSignals, 5 * 60 * 1000);
  } else {
    document.getElementById('pin-err').style.display = 'block';
    document.getElementById('pin-inp').value = '';
    setTimeout(() => document.getElementById('pin-err').style.display = 'none', 2000);
  }
}
document.getElementById('pin-inp').addEventListener('keypress', e => { if (e.key==='Enter') checkPin(); });
if (sessionStorage.getItem('cf_sig')==='1') {
  document.getElementById('pin-screen').style.display = 'none';
  document.getElementById('app').style.display = 'block';
  loadSignals();
  setInterval(loadSignals, 5*60*1000);
}

async function loadSignals() {
  try {
    const res  = await fetch('/.netlify/functions/get-signals');
    const data = await res.json();
    if (!data.ok) { showFallback('API error: ' + data.error); return; }
    renderSignals(data);
  } catch(err) {
    showFallback('Could not reach API — check Netlify deploy');
  }
}

function renderSignals(data) {
  document.getElementById('last-updated').textContent =
    'Live — updated ' + new Date(data.lastUpdated).toLocaleTimeString('en-CA');

  ['strong','medium','mobile','humans'].forEach((k,i) => {
    const vals = [data.summary.strong, data.summary.medium, data.summary.mobileOpens, data.summary.realHumans];
    const el = document.getElementById('stat-'+k);
    if (el) { el.textContent = vals[i]; el.classList.remove('pulse'); }
  });
  const fo = document.getElementById('funnel-opened');
  if (fo) fo.textContent = data.summary.realHumans;

  // Hot leads
  const hotEl = document.getElementById('hot-leads');
  if (!data.hotLeads.length) {
    hotEl.innerHTML = '<div class="empty-state">No hot leads yet today — opens appear here instantly</div>';
  } else {
    hotEl.innerHTML = data.hotLeads.map(lead => {
      const conf = C[lead.confidence] || C.BOT;
      const subj = encodeURIComponent('Re: ' + lead.clinicName);
      const body = encodeURIComponent('Hi,\\n\\nJust following up — noticed you had seen my previous note.\\n\\nWhen a patient calls ' + lead.clinicName + ' and no one picks up, they get an automatic text within 60 seconds. Most reply. Most book.\\n\\nSee it: clinicflowautomation.com/live\\n\\nHappy to walk through it.\\n\\n— Mohamed\\n438-544-0442');
      return \`<div class="lead-card" style="border-left-color:\${conf.border}">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:8px;margin-bottom:12px">
          <div>
            <div style="font-size:18px;font-weight:700;color:#f1f5f9">\${lead.clinicName}</div>
            <div style="font-size:13px;color:#94a3b8;margin-top:3px">\${lead.hasMobile?'📱 Mobile':'💻 Desktop'} · \${lead.variant} · \${lead.openCount} open\${lead.openCount>1?'s':''} · \${ago(lead.lastOpenedAt)}</div>
          </div>
          <span class="conf-badge" style="background:\${conf.bg};color:\${conf.text}">\${conf.label}</span>
        </div>
        <div style="background:#0f172a;border-radius:8px;padding:10px;font-size:13px;color:#cbd5e1;margin-bottom:12px">\${action(lead)}</div>
        <a href="mailto:?subject=\${subj}&body=\${body}" class="action-btn">Send Personal Email →</a>
      </div>\`;
    }).join('');
  }

  // All signals table
  const allEl = document.getElementById('all-signals');
  if (!data.allSignals.length) {
    allEl.innerHTML = '<div class="empty-state">No opens tracked today yet</div>';
  } else {
    allEl.innerHTML = '<table><thead><tr><th>Clinic</th><th>Variant</th><th>Device</th><th>Opens</th><th>Confidence</th><th>Time</th></tr></thead><tbody>' +
      data.allSignals.map(s => {
        const conf = C[s.confidence] || C.BOT;
        return \`<tr>
          <td style="color:#f1f5f9">\${s.clinicName}</td>
          <td>\${s.variant}</td>
          <td>\${s.hasMobile?'📱':'💻'}</td>
          <td>\${s.openCount}×</td>
          <td><span class="conf-badge" style="background:\${conf.bg};color:\${conf.text}">\${conf.label}</span></td>
          <td>\${ago(s.lastOpenedAt)}</td>
        </tr>\`;
      }).join('') + '</tbody></table>';
  }
}

function showFallback(msg) {
  document.getElementById('last-updated').textContent = msg || 'Offline — using cached data';
  document.getElementById('hot-leads').innerHTML =
    '<div class="empty-state">Fallowfield Dental (Ottawa) 🔥 STRONG — personal email sent<br>Beddington Dental (Calgary) 🔥 STRONG — personal email sent</div>';
  document.getElementById('all-signals').innerHTML = '<div class="empty-state">API offline</div>';
}

function ago(iso) {
  if (!iso) return '—';
  const m = Math.floor((Date.now() - new Date(iso)) / 60000);
  if (m < 1)  return 'just now';
  if (m < 60) return m + 'm ago';
  if (m < 1440) return Math.floor(m/60) + 'h ago';
  return Math.floor(m/1440) + 'd ago';
}

function action(lead) {
  if (lead.confidence === 'STRONG') return '⚡ Send personal email NOW — opened on mobile';
  if (lead.confidence === 'MEDIUM' && lead.hasMobile) return '📱 Send personal email today — human on phone';
  if (lead.confidence === 'MEDIUM') return '💻 Follow up — opened multiple times';
  return '👁 Monitor — single desktop open';
}
</script>
</body>
</html>`;

fs.writeFileSync('public/netlify-deploy/signals.html', html);
fs.copyFileSync('public/netlify-deploy/signals.html', 'public/signals.html');
console.log('✓ signals.html rebuilt — loads live from /.netlify/functions/get-signals');
console.log('Size:', Math.round(fs.statSync('public/netlify-deploy/signals.html').size / 1024), 'KB');
