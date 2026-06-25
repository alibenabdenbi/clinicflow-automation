// scripts/build-signals-dashboard.mjs
// Builds public/netlify-deploy/signals.html from signal-tracker.json
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
dotenv.config();

const ROOT = new URL('../', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1');

const signals = JSON.parse(fs.readFileSync('data/signal-tracker.json', 'utf8'));
const dental  = JSON.parse(fs.readFileSync('data/outreach.localDentists.json', 'utf8'));

const contacted  = dental.filter(c => c.status === 'sent' || c.sentAt || c.lastContactedAt).length;
const bounced    = dental.filter(c => c.status === 'bounced').length;
const screenshot = dental.filter(c => c.screenshotSentAt).length;
const personal   = dental.filter(c => c.personalFollowupAt).length;
const readyToSend = dental.filter(c => c.email && c.status === 'todo').length;

let linkedinStreak = 0;
try {
  const log = JSON.parse(fs.readFileSync('data/linkedin/post-log.json', 'utf8'));
  linkedinStreak = log.length;
} catch {}

const confColors = {
  STRONG: { bg: '#14532d', text: '#4ade80', border: '#16a34a', label: '🔥 STRONG' },
  MEDIUM: { bg: '#78350f', text: '#fcd34d', border: '#d97706', label: '⚡ MEDIUM' },
  WEAK:   { bg: '#1e3a5f', text: '#93c5fd', border: '#2563eb', label: '👁 WEAK' },
  BOT:    { bg: '#1a1a2e', text: '#4a5568', border: '#2d3748', label: '🤖 BOT' },
};

const hotLeadCards = signals.hotLeads.map(lead => {
  const conf = confColors[lead.confidence];
  const mailSubject = encodeURIComponent(`Re: ${lead.clinicName}`);
  const mailBody = encodeURIComponent(
`Hi,

Just following up personally — noticed you'd seen my previous note.

When a patient calls ${lead.clinicName} and no one picks up, they get an automatic text within 60 seconds. Most reply. Most book.

See it running live: clinicflowautomation.com/live

Happy to walk through it this week if timing is right.

— Mohamed
438-544-0442`);

  return `<div style="background:#111827;border:1px solid ${conf.border};border-left:4px solid ${conf.border};border-radius:12px;padding:18px;margin-bottom:12px">
  <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:12px;flex-wrap:wrap;gap:8px">
    <div>
      <div style="font-size:18px;font-weight:700;color:#f1f5f9;margin-bottom:4px">${lead.clinicName}</div>
      <div style="font-size:13px;color:#94a3b8">${lead.city} · ${lead.variant} · ${lead.hasMobile?'📱 Mobile':'💻 Desktop'} · ${lead.openCount} open${lead.openCount>1?'s':''}</div>
    </div>
    <div style="background:${conf.bg};color:${conf.text};padding:4px 12px;border-radius:20px;font-size:12px;font-weight:700;border:1px solid ${conf.border}">${conf.label}</div>
  </div>
  <div style="background:#0f172a;border-radius:8px;padding:12px;margin-bottom:12px;font-size:13px;color:#cbd5e1">
    <span style="color:#94a3b8">Action: </span>${lead.action}
  </div>
  <div style="display:flex;gap:8px;flex-wrap:wrap">
    ${lead.personalEmailSent
      ? `<span style="background:#14532d;color:#4ade80;padding:8px 16px;border-radius:8px;font-size:13px;font-weight:600">✓ Personal email sent</span>`
      : `<a href="mailto:${lead.email}?subject=${mailSubject}&body=${mailBody}" style="background:#7c5cff;color:#fff;padding:8px 16px;border-radius:8px;font-size:13px;font-weight:600;text-decoration:none">Send Personal Email →</a>`
    }
    ${lead.phone ? `<a href="tel:${lead.phone}" style="background:#1e3a5f;color:#93c5fd;padding:8px 16px;border-radius:8px;font-size:13px;font-weight:600;text-decoration:none">📞 Call</a>` : ''}
  </div>
</div>`;
}).join('');

const allSignalRows = signals.allSignals.map(s => {
  const conf = confColors[s.confidence];
  return `<tr style="border-bottom:1px solid #1e293b">
  <td style="padding:10px 12px;color:#f1f5f9;font-size:14px">${s.clinicName}</td>
  <td style="padding:10px 12px;color:#94a3b8;font-size:13px">${s.variant}</td>
  <td style="padding:10px 12px;font-size:13px">${s.hasMobile?'📱':'💻'}</td>
  <td style="padding:10px 12px;font-size:13px;color:#94a3b8">${s.openCount}×</td>
  <td style="padding:10px 12px"><span style="background:${conf.bg};color:${conf.text};padding:2px 10px;border-radius:20px;font-size:11px;font-weight:700">${conf.label}</span></td>
</tr>`;
}).join('');

const lastUpdated = new Date(signals.lastUpdated).toLocaleString('en-CA', { dateStyle:'medium', timeStyle:'short' });

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
.pin-input{font-size:24px;letter-spacing:8px;padding:14px 20px;border:2px solid rgba(255,255,255,.15);border-radius:12px;background:rgba(255,255,255,.07);color:#fff;text-align:center;width:200px;margin-bottom:14px;outline:none}
.pin-input:focus{border-color:#7c5cff}
.pin-btn{background:#7c5cff;color:#fff;border:none;padding:14px 0;border-radius:10px;font-size:16px;font-weight:700;width:200px;cursor:pointer}
.pin-err{color:#f87171;margin-top:10px;font-size:14px;display:none}
.top-bar{display:flex;justify-content:space-between;align-items:center;margin-bottom:24px;padding-bottom:16px;border-bottom:1px solid #1e293b;flex-wrap:wrap;gap:12px}
.section-title{font-size:12px;font-weight:700;color:#4a5568;text-transform:uppercase;letter-spacing:1px;margin:24px 0 12px}
.stat-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-bottom:8px}
@media(max-width:600px){.stat-grid{grid-template-columns:repeat(2,1fr)}}
.stat-card{background:#111827;border-radius:12px;padding:16px;text-align:center;border:1px solid #1e293b}
.stat-num{font-size:28px;font-weight:800;margin-bottom:4px}
.stat-lbl{font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:.5px}
.funnel{display:flex;gap:0;margin-bottom:8px;overflow-x:auto;border-radius:12px;overflow:hidden;border:1px solid #1e293b}
.funnel-step{flex:1;min-width:70px;padding:12px 8px;text-align:center;background:#111827;border-right:1px solid #1e293b}
.funnel-step:last-child{border:none}
.funnel-num{font-size:20px;font-weight:800;color:#f1f5f9}
.funnel-lbl{font-size:10px;color:#64748b;text-transform:uppercase;margin-top:3px}
.funnel-rate{font-size:11px;color:#4a5568;margin-top:2px}
table{width:100%;border-collapse:collapse;background:#111827;border-radius:12px;overflow:hidden}
th{padding:10px 12px;text-align:left;font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:.5px;border-bottom:1px solid #1e293b}
.linkedin-bar{background:#111827;border-radius:12px;padding:16px;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px;margin-bottom:8px}
.refresh-btn{background:#1e293b;color:#94a3b8;border:none;padding:8px 14px;border-radius:8px;font-size:12px;cursor:pointer}
</style>
</head>
<body>

<div id="pin-screen">
  <div style="font-size:11px;letter-spacing:4px;color:#4a5568;margin-bottom:8px">CLINICFLOW</div>
  <div style="font-size:20px;font-weight:700;color:#fff;margin-bottom:4px">Signal Tracker</div>
  <div style="font-size:13px;color:#64748b;margin-bottom:28px">Internal — Mohamed only</div>
  <input class="pin-input" type="password" id="pin-inp" placeholder="PIN" maxlength="4" autocomplete="off" inputmode="numeric">
  <button class="pin-btn" onclick="checkPin()">Unlock</button>
  <div class="pin-err" id="pin-err">Wrong PIN</div>
</div>

<div id="app">
  <div class="top-bar">
    <div>
      <div style="font-size:11px;letter-spacing:3px;color:#4a5568">CLINICFLOW</div>
      <div style="font-size:20px;font-weight:700">Signal Tracker</div>
      <div style="font-size:12px;color:#64748b">Updated: ${lastUpdated}</div>
    </div>
    <button class="refresh-btn" onclick="location.reload()">↻ Refresh</button>
  </div>

  <div class="section-title">Today's Pulse</div>
  <div class="stat-grid">
    <div class="stat-card"><div class="stat-num" style="color:#4ade80">${signals.summary.strong}</div><div class="stat-lbl">🔥 Strong Signals</div></div>
    <div class="stat-card"><div class="stat-num" style="color:#fbbf24">${signals.summary.medium}</div><div class="stat-lbl">⚡ Medium Signals</div></div>
    <div class="stat-card"><div class="stat-num" style="color:#60a5fa">${signals.summary.mobileOpens}</div><div class="stat-lbl">📱 Mobile Opens</div></div>
    <div class="stat-card"><div class="stat-num" style="color:#a78bfa">${signals.summary.realHumans}</div><div class="stat-lbl">👤 Real Humans</div></div>
    <div class="stat-card"><div class="stat-num" style="color:#f97316">${screenshot}</div><div class="stat-lbl">📸 Screenshots Sent</div></div>
    <div class="stat-card"><div class="stat-num" style="color:#0077b5">${linkedinStreak}</div><div class="stat-lbl">LinkedIn Streak</div></div>
  </div>

  <div class="section-title">Pipeline Funnel</div>
  <div class="funnel">
    <div class="funnel-step"><div class="funnel-num">${dental.length.toLocaleString()}</div><div class="funnel-lbl">Mapped</div></div>
    <div class="funnel-step"><div class="funnel-num">${contacted.toLocaleString()}</div><div class="funnel-lbl">Contacted</div><div class="funnel-rate">${Math.round(contacted/dental.length*100)}%</div></div>
    <div class="funnel-step"><div class="funnel-num">${signals.summary.realHumans}</div><div class="funnel-lbl">Opened</div></div>
    <div class="funnel-step"><div class="funnel-num">${personal}</div><div class="funnel-lbl">Personal</div></div>
    <div class="funnel-step"><div class="funnel-num" style="color:#4ade80">0</div><div class="funnel-lbl">Closed</div></div>
  </div>

  ${signals.hotLeads.length > 0 ? `
  <div class="section-title">Act On These — Hot Leads</div>
  ${hotLeadCards}` : `<div style="color:#64748b;padding:20px;text-align:center;background:#111827;border-radius:12px;margin-top:12px">No hot leads yet today</div>`}

  <div class="section-title">All Signals Today</div>
  <table>
    <thead><tr><th>Clinic</th><th>Variant</th><th>Device</th><th>Opens</th><th>Confidence</th></tr></thead>
    <tbody>${allSignalRows}</tbody>
  </table>

  <div class="section-title">LinkedIn</div>
  <div class="linkedin-bar">
    <div>
      <div style="font-size:13px;color:#94a3b8;margin-bottom:4px">Posts logged</div>
      <div style="font-size:28px;font-weight:800;color:#0077b5">${linkedinStreak} day${linkedinStreak!==1?'s':''}</div>
    </div>
    <a href="https://www.linkedin.com/feed/?shareActive=true" target="_blank" style="background:#0077b5;color:#fff;padding:10px 16px;border-radius:8px;font-size:13px;font-weight:600;text-decoration:none">Post Today →</a>
  </div>

  <div class="section-title">System Status</div>
  <div style="background:#111827;border-radius:12px;padding:16px;font-size:13px;color:#94a3b8;line-height:2.2;border:1px solid #1e293b">
    <div>📧 Ready to send: <span style="color:#f1f5f9;font-weight:600">${readyToSend} clinics</span></div>
    <div>📸 Screenshots sent: <span style="color:#f1f5f9;font-weight:600">${screenshot}</span></div>
    <div>🏥 Bounced: <span style="color:#f87171;font-weight:600">${bounced}</span></div>
    <div>🌐 Live page: <a href="/live" style="color:#7c5cff">clinicflowautomation.com/live</a></div>
    <div>📊 Next batch: <span style="color:#f1f5f9;font-weight:600">Monday 10:00am (anomaly emails)</span></div>
  </div>
</div>

<script>
function checkPin() {
  if (document.getElementById('pin-inp').value === '8268') {
    document.getElementById('pin-screen').style.display = 'none';
    document.getElementById('app').style.display = 'block';
    sessionStorage.setItem('signal_auth','1');
  } else {
    document.getElementById('pin-err').style.display = 'block';
    document.getElementById('pin-inp').value = '';
    setTimeout(() => document.getElementById('pin-err').style.display = 'none', 2000);
  }
}
document.getElementById('pin-inp').addEventListener('keypress', e => { if (e.key === 'Enter') checkPin(); });
if (sessionStorage.getItem('signal_auth') === '1') {
  document.getElementById('pin-screen').style.display = 'none';
  document.getElementById('app').style.display = 'block';
}
</script>
</body>
</html>`;

fs.writeFileSync('public/netlify-deploy/signals.html', html);
fs.copyFileSync('public/netlify-deploy/signals.html', 'public/signals.html');
console.log('✓ signals.html built');
console.log('Size:', Math.round(fs.statSync('public/netlify-deploy/signals.html').size/1024), 'KB');
console.log('\nHot leads summary:');
signals.hotLeads.forEach(l => {
  console.log(`  ${l.confidence} — ${l.clinicName} — ${l.hasMobile?'📱':'💻'} — ${l.openCount} opens — ${l.personalEmailSent?'✓ sent':'needs email'}`);
});
