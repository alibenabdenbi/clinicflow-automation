// scripts/build-call-assistant.mjs
// Builds public/netlify-deploy/call-assistant.html with embedded clinic data.
// Run: node scripts/build-call-assistant.mjs
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const CALL_PIN = (process.env.ADMIN_KEY || 'clinicflow').slice(-6).toUpperCase();
const today = new Date().toISOString().slice(0, 10);

// ── Load targets (use pre-built if available, else build from source) ────────
let callTargets;
const prebuild = path.join(ROOT, 'data', 'call-targets-build.json');
if (fs.existsSync(prebuild)) {
  callTargets = JSON.parse(fs.readFileSync(prebuild, 'utf8'));
} else {
  const dental = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'outreach.localDentists.json'), 'utf8'));
  callTargets = dental
    .filter(c => c.status === 'todo' && (c.phone || c.personalPhone || c.googlePhone))
    .sort((a, b) => {
      if ((b.painScore||0) !== (a.painScore||0)) return (b.painScore||0)-(a.painScore||0);
      if ((b.reviewCount||0) !== (a.reviewCount||0)) return (b.reviewCount||0)-(a.reviewCount||0);
      return (b.opportunityScore||0)-(a.opportunityScore||0);
    })
    .slice(0, 25)
    .map(c => ({
      id: Math.random().toString(36).slice(2,8),
      name: c.clinicName || '',
      city: (c.city||'').split(',')[0].trim(),
      phone: c.phone || c.personalPhone || c.googlePhone || '',
      rating: c.rating || 0,
      reviews: c.reviewCount || 0,
      pain: c.painSignals?.[0] || '',
      why: c.painSignals?.[0]
        ? 'Pain signal: ' + c.painSignals[0].slice(0,80)
        : c.rating ? c.rating + '★ with ' + (c.reviewCount||0) + ' reviews' : 'High priority lead',
      status: 'todo', notes: '', calledAt: null, callbackDate: null,
    }));
}

const DATA_JSON = JSON.stringify(callTargets);

// ── HTML ─────────────────────────────────────────────────────────────────────
const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<title>Call Assistant — ClinicFlow</title>
<style>
:root{
  --bg:#f0f4f8;--card:#fff;--dark:#0b0f17;--dark2:#1a1f2e;
  --purple:#7c5cff;--green:#4ade80;
  --green-bg:#dcfce7;--green-text:#166534;
  --yellow-bg:#fef9c3;--yellow-text:#854d0e;
  --red-bg:#fee2e2;--red-text:#991b1b;
  --blue-bg:#e0e7ff;--blue-text:#3730a3;
  --orange:#f97316;--gray:#94a3b8;
  --text:#0f172a;--text2:#64748b;--border:#e2e8f0;
  --shadow:0 2px 8px rgba(0,0,0,.08);
}
*{box-sizing:border-box;margin:0;padding:0;-webkit-tap-highlight-color:transparent}
html,body{height:100%;overflow:hidden}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:var(--bg);color:var(--text)}

/* PIN */
#pin-screen{position:fixed;inset:0;background:var(--dark);display:flex;flex-direction:column;align-items:center;justify-content:center;z-index:9999;padding:30px}
.pin-logo{font-size:48px;margin-bottom:12px}
.pin-title{color:#fff;font-size:24px;font-weight:800;margin-bottom:6px}
.pin-sub{color:rgba(255,255,255,.4);font-size:14px;margin-bottom:36px}
.pin-input{font-size:26px;letter-spacing:10px;padding:16px 24px;border:2px solid rgba(255,255,255,.15);border-radius:14px;background:rgba(255,255,255,.07);color:#fff;text-align:center;width:220px;margin-bottom:14px;outline:none;transition:border-color .2s}
.pin-input:focus{border-color:var(--purple)}
.pin-btn{background:var(--purple);color:#fff;border:none;padding:15px 0;border-radius:12px;font-size:17px;font-weight:700;width:220px;cursor:pointer;transition:opacity .2s}
.pin-btn:active{opacity:.8}
.pin-err{color:#f87171;font-size:14px;margin-top:12px;display:none}

/* APP */
#app{display:none;height:100%;flex-direction:column}
#app.visible{display:flex}
.screen{display:none;flex:1;overflow:hidden;flex-direction:column}
.screen.active{display:flex}

/* TOP BAR */
.top-bar{background:var(--dark);color:#fff;padding:14px 16px;display:flex;justify-content:space-between;align-items:center;flex-shrink:0}
.top-bar-title{font-size:17px;font-weight:700}
.top-bar-date{font-size:12px;color:rgba(255,255,255,.4)}

/* STATS */
.stats-row{background:var(--dark2);display:flex;flex-shrink:0}
.stat-item{flex:1;padding:10px 8px;text-align:center;border-right:1px solid rgba(255,255,255,.06)}
.stat-item:last-child{border:none}
.stat-num{font-size:22px;font-weight:800;color:#fff}
.stat-num.g{color:var(--green)}
.stat-num.y{color:#fbbf24}
.stat-num.r{color:#f87171}
.stat-lbl{font-size:10px;color:rgba(255,255,255,.35);text-transform:uppercase;letter-spacing:.5px;margin-top:1px}

/* QUEUE */
.queue-list{flex:1;overflow-y:auto;padding:10px 12px 80px;-webkit-overflow-scrolling:touch}
.section-lbl{font-size:11px;font-weight:700;color:var(--gray);text-transform:uppercase;letter-spacing:.8px;padding:10px 4px 6px}

/* CARDS */
.clinic-card{background:var(--card);border-radius:14px;margin-bottom:10px;overflow:hidden;box-shadow:var(--shadow);border-left:4px solid var(--border);transition:transform .1s}
.clinic-card:active{transform:scale(.99)}
.clinic-card.has-pain{border-left-color:var(--orange)}
.clinic-card.is-priority{border-left-color:var(--purple)}
.clinic-card.done-int{border-left-color:var(--green);opacity:.85}
.clinic-card.done-na{opacity:.65}
.clinic-card.done-ni{opacity:.5}
.clinic-card.done-em{opacity:.7}
.clinic-card.done-cb{border-left-color:var(--blue-text);opacity:.8}

.card-header{padding:13px 14px 0;cursor:pointer;user-select:none}
.card-name{font-size:17px;font-weight:700;color:var(--text);margin-bottom:3px;display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.card-meta{font-size:13px;color:var(--text2);display:flex;gap:10px;flex-wrap:wrap;align-items:center}
.pain-tag{background:#fff7ed;color:var(--orange);padding:3px 9px;border-radius:20px;font-size:11px;font-weight:600;margin-top:6px;display:inline-block;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.status-chip{font-size:11px;font-weight:700;padding:2px 8px;border-radius:20px}
.chip-int{background:var(--green-bg);color:var(--green-text)}
.chip-na{background:var(--yellow-bg);color:var(--yellow-text)}
.chip-ni{background:var(--red-bg);color:var(--red-text)}
.chip-cb{background:var(--blue-bg);color:var(--blue-text)}
.chip-em{background:#f1f5f9;color:var(--text2)}

.card-actions{padding:10px 14px 12px;display:flex;gap:8px}
.btn-call{flex:1;background:var(--green-bg);color:var(--green-text);border:none;padding:13px 10px;border-radius:10px;font-size:15px;font-weight:700;cursor:pointer;text-decoration:none;text-align:center;display:flex;align-items:center;justify-content:center;gap:6px}
.btn-call:active{opacity:.85}
.btn-script{background:var(--purple);color:#fff;border:none;padding:13px 14px;border-radius:10px;font-size:14px;font-weight:600;cursor:pointer}
.btn-more{background:var(--bg);color:var(--text2);border:none;padding:13px 14px;border-radius:10px;font-size:14px;font-weight:600;cursor:pointer}

.outcome-bar{display:none;padding:10px 14px 12px;background:#f8fafc;border-top:1px solid var(--border);gap:6px;flex-wrap:wrap}
.outcome-bar.visible{display:flex}
.out-btn{flex:1;min-width:60px;padding:10px 6px;border-radius:9px;border:none;font-size:12px;font-weight:700;cursor:pointer;text-align:center}
.out-btn:active{opacity:.8}
.out-int{background:var(--green-bg);color:var(--green-text)}
.out-na{background:var(--yellow-bg);color:var(--yellow-text)}
.out-ni{background:var(--red-bg);color:var(--red-text)}
.out-cb{background:var(--blue-bg);color:var(--blue-text)}
.out-em{background:#f1f5f9;color:var(--text2)}

.notes-wrap{padding:0 14px 12px}
.notes-area{width:100%;padding:9px 12px;border:1px solid var(--border);border-radius:8px;font-size:13px;resize:none;font-family:inherit;color:var(--text);background:#fff;min-height:56px}
.notes-area:focus{outline:none;border-color:var(--purple)}

/* COACH */
.coach-bar{position:fixed;bottom:0;left:0;right:0;background:var(--dark);color:rgba(255,255,255,.6);padding:10px 16px;font-size:13px;text-align:center;z-index:30;border-top:1px solid rgba(255,255,255,.05);transition:opacity .3s}
.coach-bar b{color:var(--purple)}

/* CALL TIMER */
.call-timer{display:none;background:var(--purple);color:#fff;padding:8px 16px;text-align:center;font-size:13px;font-weight:600;flex-shrink:0}
.call-timer.visible{display:block}
.timer-val{font-size:20px;font-weight:800;letter-spacing:2px;margin-top:2px}

/* SCRIPT MODAL */
.modal-overlay{display:none;position:fixed;inset:0;background:rgba(0,0,0,.72);z-index:500;overflow-y:auto;padding:20px 14px 40px;-webkit-overflow-scrolling:touch}
.modal-overlay.visible{display:block}
.modal-box{background:#fff;border-radius:20px;padding:22px;max-width:560px;margin:0 auto}
.modal-title{font-size:20px;font-weight:800;color:var(--text);margin-bottom:4px}
.modal-sub{font-size:13px;color:var(--text2);margin-bottom:18px}
.lang-toggle{display:flex;gap:8px;margin-bottom:16px}
.lang-btn{flex:1;padding:10px;border-radius:8px;border:2px solid var(--border);font-size:14px;font-weight:600;cursor:pointer;background:#fff;color:var(--text2);transition:all .15s}
.lang-btn.active{border-color:var(--purple);color:var(--purple);background:#f5f3ff}
.script-block{margin-bottom:18px}
.script-lbl{font-size:11px;font-weight:700;color:var(--purple);text-transform:uppercase;letter-spacing:.8px;margin-bottom:7px}
.script-text{background:#f8fafc;border-radius:10px;padding:13px;font-size:14px;line-height:1.7;color:var(--text);border-left:3px solid var(--purple)}
.script-text em{color:var(--text2);font-style:italic}
.obj-section-lbl{font-size:11px;font-weight:700;color:var(--gray);text-transform:uppercase;letter-spacing:.8px;margin:20px 0 10px}
.obj-card{background:#fff7ed;border-radius:10px;margin-bottom:8px;overflow:hidden}
.obj-q{padding:12px 14px;font-weight:600;color:var(--orange);cursor:pointer;font-size:14px;display:flex;justify-content:space-between;align-items:center;user-select:none}
.obj-q::after{content:'\\25BE';font-size:16px;transition:transform .2s}
.obj-q.open::after{transform:rotate(180deg)}
.obj-a{max-height:0;overflow:hidden;transition:max-height .3s ease,padding .3s;font-size:14px;color:var(--text);line-height:1.65;padding:0 14px}
.obj-a.open{max-height:300px;padding:0 14px 13px}
.modal-close{width:100%;padding:15px;background:var(--dark);color:#fff;border:none;border-radius:12px;font-size:16px;font-weight:700;cursor:pointer;margin-top:14px}
.modal-close:active{opacity:.8}

/* CALLBACK MODAL */
.cb-modal{display:none;position:fixed;inset:0;background:rgba(0,0,0,.72);z-index:600;align-items:center;justify-content:center;padding:20px}
.cb-modal.visible{display:flex}
.cb-box{background:#fff;border-radius:18px;padding:24px;width:100%;max-width:400px}
.cb-box h3{font-size:18px;font-weight:700;margin-bottom:16px}
.cb-input{width:100%;padding:12px 14px;border:2px solid var(--border);border-radius:10px;font-size:15px;margin-bottom:12px;font-family:inherit;outline:none}
.cb-input:focus{border-color:var(--purple)}
.cb-btns{display:flex;gap:10px}
.cb-confirm{flex:1;background:var(--purple);color:#fff;border:none;padding:13px;border-radius:10px;font-size:15px;font-weight:700;cursor:pointer}
.cb-cancel{background:var(--bg);color:var(--text2);border:none;padding:13px 18px;border-radius:10px;font-size:15px;font-weight:600;cursor:pointer}

/* CELEBRATION */
.celebrate{display:none;position:fixed;inset:0;background:rgba(0,0,0,.85);z-index:700;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:30px}
.celebrate.visible{display:flex}
.celebrate-emoji{font-size:80px;margin-bottom:16px;animation:bounce .5s infinite alternate}
.celebrate-title{color:#fff;font-size:30px;font-weight:800;margin-bottom:10px}
.celebrate-sub{color:rgba(255,255,255,.75);font-size:16px;margin-bottom:30px;max-width:320px;line-height:1.5}
.celebrate-btn{background:var(--green);color:var(--green-text);border:none;padding:16px 32px;border-radius:14px;font-size:17px;font-weight:700;cursor:pointer}
@keyframes bounce{0%{transform:translateY(0) scale(1)}100%{transform:translateY(-14px) scale(1.05)}}

.hidden{display:none!important}
</style>
</head>
<body>

<div id="pin-screen">
  <div class="pin-logo">📞</div>
  <div class="pin-title">Call Assistant</div>
  <div class="pin-sub">ClinicFlow Automation</div>
  <input class="pin-input" type="password" id="pin-inp" placeholder="PIN" maxlength="6" autocomplete="off" inputmode="text">
  <button class="pin-btn" onclick="checkPin()">Unlock</button>
  <div class="pin-err" id="pin-err">Wrong PIN — try again</div>
</div>

<div id="app">
  <div class="call-timer" id="call-timer">
    <div>On call with <strong id="timer-name">—</strong></div>
    <div class="timer-val" id="timer-val">0:00</div>
  </div>
  <div class="screen active" id="screen-queue">
    <div class="top-bar">
      <div class="top-bar-title">📞 Call Queue</div>
      <div class="top-bar-date" id="hdr-date"></div>
    </div>
    <div class="stats-row">
      <div class="stat-item"><div class="stat-num" id="s-total">0</div><div class="stat-lbl">Total</div></div>
      <div class="stat-item"><div class="stat-num g" id="s-int">0</div><div class="stat-lbl">Interested</div></div>
      <div class="stat-item"><div class="stat-num y" id="s-na">0</div><div class="stat-lbl">No Answer</div></div>
      <div class="stat-item"><div class="stat-num r" id="s-ni">0</div><div class="stat-lbl">Not Int.</div></div>
      <div class="stat-item"><div class="stat-num" id="s-done">0</div><div class="stat-lbl">Done</div></div>
    </div>
    <div class="queue-list" id="queue-list"></div>
    <div class="coach-bar"><b id="coach-tip">Stay warm — ask questions, don't pitch.</b></div>
  </div>
</div>

<!-- SCRIPT MODAL -->
<div class="modal-overlay" id="script-modal">
  <div class="modal-box">
    <div class="modal-title" id="script-clinic-name">Call Script</div>
    <div class="modal-sub">Read naturally — don't rush. Pause after each question.</div>
    <div class="lang-toggle">
      <button class="lang-btn active" id="lang-en" onclick="setLang('en')">🇨🇦 English</button>
      <button class="lang-btn" id="lang-fr" onclick="setLang('fr')">🇫🇷 Français</button>
    </div>

    <div id="script-en">
      <div class="script-block">
        <div class="script-lbl">Step 1 — Gatekeeper</div>
        <div class="script-text">"Hi, may I speak with the clinic owner or office manager please?"<br><br><em>[If asked who's calling:]</em><br>"This is [Your Name] from ClinicFlow Automation — it's a quick call about patient communication."</div>
      </div>
      <div class="script-block">
        <div class="script-lbl">Step 2 — Opening</div>
        <div class="script-text">"Hi [Name], I'll be quick — I'm [Your Name] from ClinicFlow Automation in Montreal.<br><br>We help dental clinics set up automatic text-back for missed calls. When a patient calls and no one picks up, they get a text within 60 seconds. Most clinics recover 4–6 patients a month they were losing to voicemail.<br><br>It's one-time setup, no monthly fees, and you only pay the second half after you see it working.<br><br>Is that worth 2 minutes?"</div>
      </div>
      <div class="script-block">
        <div class="script-lbl">Step 3 — Discovery</div>
        <div class="script-text">"Great. So right now when a patient calls and doesn't reach anyone — what happens?<br><br><em>[Let them answer — don't fill the silence]</em><br><br>With ClinicFlow, they get an automatic text: 'Hi, you called [Clinic], we missed you — reply to book.' Most patients reply. Most book.<br><br>Setup takes 5 days. I handle everything."</div>
      </div>
      <div class="script-block">
        <div class="script-lbl">Step 4 — Close</div>
        <div class="script-text">"The Growth package is $997 one-time — $500 now, $497 after you see results in 30 days. No monthly fees ever.<br><br>Can I send you a 2-minute overview to your email? What's the best address?"</div>
      </div>
    </div>

    <div id="script-fr" class="hidden">
      <div class="script-block">
        <div class="script-lbl">Étape 1 — Réceptionniste</div>
        <div class="script-text">"Bonjour, puis-je parler au propriétaire ou au gestionnaire de la clinique s'il vous plaît?"<br><br><em>[Si on demande qui appelle:]</em><br>"C'est [Votre Nom] de ClinicFlow Automation — c'est un appel rapide sur la communication patients."</div>
      </div>
      <div class="script-block">
        <div class="script-lbl">Étape 2 — Ouverture</div>
        <div class="script-text">"Bonjour [Nom], je serai bref — je m'appelle [Votre Nom] de ClinicFlow Automation à Montréal.<br><br>On aide les cliniques dentaires à configurer des réponses automatiques par SMS pour les appels manqués. Quand un patient appelle et que personne ne répond, il reçoit un texto en 60 secondes. La plupart des cliniques récupèrent 4–6 patients par mois.<br><br>C'est une configuration unique, sans frais mensuels, et vous ne payez la deuxième moitié qu'après les résultats.<br><br>Ça vaut 2 minutes de votre temps?"</div>
      </div>
      <div class="script-block">
        <div class="script-lbl">Étape 3 — Découverte</div>
        <div class="script-text">"Parfait. En ce moment, quand un patient appelle et ne rejoint personne — que se passe-t-il?<br><br><em>[Laissez-les répondre — ne remplissez pas le silence]</em><br><br>Avec ClinicFlow, ils reçoivent un texto automatique en 60 secondes. La plupart répondent. La plupart réservent."</div>
      </div>
      <div class="script-block">
        <div class="script-lbl">Étape 4 — Clôture</div>
        <div class="script-text">"Le forfait Croissance est de 997$ une fois — 500$ maintenant, 497$ après les résultats. Aucuns frais mensuels.<br><br>Puis-je vous envoyer un aperçu de 2 minutes par courriel? Quelle est la meilleure adresse?"</div>
      </div>
    </div>

    <div class="obj-section-lbl">Objections — tap to reveal answer</div>
    <div class="obj-card"><div class="obj-q" onclick="togObj(this)">"We already have voicemail"</div><div class="obj-a">80% of patients don't leave a voicemail — they just call the next clinic on Google. This catches the ones who hang up before the beep. You keep all your existing systems.</div></div>
    <div class="obj-card"><div class="obj-q" onclick="togObj(this)">"Not interested"</div><div class="obj-a">Totally understand. Just curious — do you have anything in place for patients who call after hours or when the front desk is tied up with another patient?</div></div>
    <div class="obj-card"><div class="obj-q" onclick="togObj(this)">"Send me an email"</div><div class="obj-a">Of course — what's the best email? I'll send a 2-minute overview right now while we're talking so you have it in front of you.</div></div>
    <div class="obj-card"><div class="obj-q" onclick="togObj(this)">"How much does it cost?"</div><div class="obj-a">$997 one-time — no monthly fees ever. $500 now, $497 after you see it working in 30 days. Most clinics recover that in the first month from patients they'd have lost to voicemail.</div></div>
    <div class="obj-card"><div class="obj-q" onclick="togObj(this)">"We already use Weave / Podium / Jane"</div><div class="obj-a">Those are great tools — the difference is we do the entire setup for you and there's no monthly subscription. Many clinics use us alongside their existing system to fill the gaps.</div></div>
    <div class="obj-card"><div class="obj-q" onclick="togObj(this)">"Call me back later"</div><div class="obj-a">Of course — what time works best? I'll make a note right now. Morning or afternoon usually?</div></div>
    <div class="obj-card"><div class="obj-q" onclick="togObj(this)">"We're too busy right now"</div><div class="obj-a">That's exactly when this helps most — busy means calls get missed. Setup takes 5 days and then it runs itself with zero work from your team.</div></div>
    <div class="obj-card"><div class="obj-q" onclick="togObj(this)">"Nous ne sommes pas intéressés" (French)</div><div class="obj-a">Je comprends tout à fait. Juste par curiosité — avez-vous quelque chose en place pour les patients qui appellent en dehors des heures ou quand la réception est occupée?</div></div>
    <div class="obj-card"><div class="obj-q" onclick="togObj(this)">"We're a small clinic, can't afford it"</div><div class="obj-a">That's fair — $997 is real money. Here's the thing: if you recover even 2 extra patients a month, that's $300–500 in revenue. The system pays for itself in the first 2–3 months. And the split payment means you pay the second half after you see it working.</div></div>

    <button class="modal-close" onclick="closeScript()">Close Script</button>
  </div>
</div>

<!-- CALLBACK MODAL -->
<div class="cb-modal" id="cb-modal">
  <div class="cb-box">
    <h3>📅 Schedule Callback</h3>
    <input class="cb-input" type="text" id="cb-name-show" readonly>
    <input class="cb-input" type="datetime-local" id="cb-date">
    <input class="cb-input" type="text" id="cb-notes" placeholder="Notes (optional)">
    <div class="cb-btns">
      <button class="cb-confirm" onclick="confirmCallback()">Save</button>
      <button class="cb-cancel" onclick="closeCb()">Cancel</button>
    </div>
  </div>
</div>

<!-- CELEBRATION -->
<div class="celebrate" id="celebrate">
  <div class="celebrate-emoji">🎉</div>
  <div class="celebrate-title">Interested!</div>
  <div class="celebrate-sub" id="cel-sub">Mohamed has been notified. Ask for their email now!</div>
  <button class="celebrate-btn" onclick="closeCelebrate()">Continue Calling</button>
</div>

<script>
const PIN = '8268';
const CLINICS = ${DATA_JSON};

const TIPS = [
  'Stay warm — ask questions, don\\'t pitch.',
  'Silence after your pitch is okay. Let them think.',
  'Agree with objections first, then redirect.',
  'Your goal: a conversation, not a sale.',
  '"Do you have anything for missed calls?" — use it.',
  'Keep it under 2 minutes. Respect their time.',
  'Best move: offer to send info while still on the call.',
  'Pain signal in their reviews = your strongest opener.',
  'After 5 calls you\\'ll feel completely natural.',
  'Every no gets you one call closer to a yes.',
];

let data = CLINICS.map(c => ({...c}));
let lang = 'en';
let tipIdx = 0;
let timerInterval = null;
let timerSeconds = 0;
let activeCbIdx = null;
let activeCallIdx = null;

// ── PIN ──────────────────────────────────────────────────────────────────────
function checkPin() {
  const v = document.getElementById('pin-inp').value.toUpperCase();
  if (v === PIN) {
    document.getElementById('pin-screen').style.display = 'none';
    document.getElementById('app').classList.add('visible');
    init();
  } else {
    const err = document.getElementById('pin-err');
    err.style.display = 'block';
    document.getElementById('pin-inp').value = '';
    document.getElementById('pin-inp').focus();
    setTimeout(() => err.style.display = 'none', 2000);
  }
}
document.getElementById('pin-inp').addEventListener('keypress', e => { if (e.key === 'Enter') checkPin(); });

// ── INIT ─────────────────────────────────────────────────────────────────────
function init() {
  document.getElementById('hdr-date').textContent =
    new Date().toLocaleDateString('en-CA', {weekday:'long', month:'short', day:'numeric'});
  render();
  rotateTip();
  setInterval(rotateTip, 9000);
}

// ── RENDER ───────────────────────────────────────────────────────────────────
function render() {
  updateStats();
  const list   = document.getElementById('queue-list');
  const todo   = data.filter(c => c.status === 'todo');
  const done   = data.filter(c => c.status !== 'todo');
  let out = '';

  if (!data.length) {
    out = '<div style="text-align:center;padding:60px 20px;color:#94a3b8"><div style="font-size:48px;margin-bottom:12px">📋</div><div style="font-size:18px;font-weight:700;color:#64748b;margin-bottom:6px">No clinics loaded</div><div style="font-size:14px">Redeploy after running generateDailyTargets.js</div></div>';
  } else {
    if (todo.length) {
      out += '<div class="section-lbl">To Call (' + todo.length + ')</div>';
      todo.forEach(c => { out += renderCard(c, data.indexOf(c)); });
    }
    if (done.length) {
      out += '<div class="section-lbl" style="margin-top:8px">Completed (' + done.length + ')</div>';
      done.forEach(c => { out += renderCard(c, data.indexOf(c)); });
    }
  }
  list.innerHTML = out;
}

function renderCard(c, i) {
  const hasPain   = !!c.pain;
  const cardClass = hasPain ? 'has-pain' : 'is-priority';
  const doneClass = c.status !== 'todo' ? ' done-' + c.status : '';
  const chips = {
    'int': '<span class="status-chip chip-int">&#x2705; Interested</span>',
    'na' : '<span class="status-chip chip-na">&#x1F4F5; No Answer</span>',
    'ni' : '<span class="status-chip chip-ni">&#x274C; Not Int.</span>',
    'cb' : '<span class="status-chip chip-cb">&#x1F4C5; Callback</span>',
    'em' : '<span class="status-chip chip-em">&#x1F4E7; Emailed</span>',
  };
  const chip = chips[c.status] || '';
  const painHtml = hasPain
    ? '<div class="pain-tag">&#9888; ' + esc(c.pain.slice(0,72)) + (c.pain.length > 72 ? '...' : '') + '</div>'
    : '';
  const cbHtml = c.callbackDate
    ? '<span>&#x1F4C5; ' + esc(c.callbackDate) + '</span>'
    : '';
  const notesHtml = c.notes
    ? '<div class="notes-wrap"><textarea class="notes-area" rows="2" oninput="saveNotes(' + i + ',this.value)">' + esc(c.notes) + '</textarea></div>'
    : '';

  return '<div class="clinic-card ' + cardClass + doneClass + '" id="card-' + i + '">'
    + '<div class="card-header" onclick="toggleOb(' + i + ')">'
    +   '<div class="card-name">' + esc(c.name) + (chip ? ' ' + chip : '') + '</div>'
    +   '<div class="card-meta">'
    +     '<span>&#x1F4CD; ' + esc(c.city) + '</span>'
    +     (c.rating ? '<span>&#x2B50; ' + c.rating + ' (' + c.reviews + ')</span>' : '')
    +     cbHtml
    +   '</div>'
    +   painHtml
    + '</div>'
    + '<div class="card-actions">'
    +   '<a href="tel:' + esc(c.phone) + '" class="btn-call" onclick="startTimer(' + i + ')">&#x1F4DE; ' + fmtPhone(c.phone) + '</a>'
    +   '<button class="btn-script" onclick="openScript(' + i + ')">Script</button>'
    +   '<button class="btn-more" onclick="toggleOb(' + i + ')">&#8943;</button>'
    + '</div>'
    + '<div class="outcome-bar" id="ob-' + i + '">'
    +   '<button class="out-btn out-int" onclick="setOutcome(' + i + ',\\u0027int\\u0027)">&#x2705; Interested</button>'
    +   '<button class="out-btn out-na"  onclick="setOutcome(' + i + ',\\u0027na\\u0027)">&#x1F4F5; No Answer</button>'
    +   '<button class="out-btn out-ni"  onclick="setOutcome(' + i + ',\\u0027ni\\u0027)">&#x274C; Not Int.</button>'
    +   '<button class="out-btn out-cb"  onclick="openCb(' + i + ')">&#x1F4C5; Callback</button>'
    +   '<button class="out-btn out-em"  onclick="sendEmail(' + i + ')">&#x1F4E7; Email</button>'
    + '</div>'
    + notesHtml
    + '</div>';
}

function updateStats() {
  document.getElementById('s-total').textContent = data.length;
  document.getElementById('s-int').textContent   = data.filter(c => c.status === 'int').length;
  document.getElementById('s-na').textContent    = data.filter(c => c.status === 'na').length;
  document.getElementById('s-ni').textContent    = data.filter(c => c.status === 'ni').length;
  document.getElementById('s-done').textContent  = data.filter(c => c.status !== 'todo').length;
}

// ── TOGGLE OUTCOME BAR ────────────────────────────────────────────────────────
function toggleOb(i) {
  const ob = document.getElementById('ob-' + i);
  if (!ob) return;
  const isOpen = ob.classList.contains('visible');
  document.querySelectorAll('.outcome-bar').forEach(el => el.classList.remove('visible'));
  if (!isOpen) {
    ob.classList.add('visible');
    // Lazy-add notes textarea if not already there
    const card = document.getElementById('card-' + i);
    if (!card.querySelector('.notes-area')) {
      const wrap = document.createElement('div');
      wrap.className = 'notes-wrap';
      const ta = document.createElement('textarea');
      ta.className = 'notes-area';
      ta.rows = 2;
      ta.placeholder = 'Notes from this call...';
      ta.value = data[i].notes || '';
      ta.oninput = () => { data[i].notes = ta.value; };
      wrap.appendChild(ta);
      card.appendChild(wrap);
      setTimeout(() => ta.focus(), 50);
    }
  }
}

// ── CALL TIMER ───────────────────────────────────────────────────────────────
function startTimer(i) {
  activeCallIdx = i;
  timerSeconds  = 0;
  clearInterval(timerInterval);
  document.getElementById('timer-name').textContent = data[i].name;
  document.getElementById('call-timer').classList.add('visible');
  timerInterval = setInterval(() => {
    timerSeconds++;
    const m = Math.floor(timerSeconds / 60);
    const s = timerSeconds % 60;
    document.getElementById('timer-val').textContent = m + ':' + String(s).padStart(2,'0');
    if (timerSeconds === 30) {
      const ob = document.getElementById('ob-' + i);
      if (ob) ob.classList.add('visible');
    }
  }, 1000);
  // Open outcomes immediately too
  setTimeout(() => {
    const ob = document.getElementById('ob-' + i);
    if (ob) ob.classList.add('visible');
  }, 600);
}

function stopTimer() {
  clearInterval(timerInterval);
  timerInterval = null;
  document.getElementById('call-timer').classList.remove('visible');
  activeCallIdx = null;
}

// ── OUTCOMES ─────────────────────────────────────────────────────────────────
function setOutcome(i, status) {
  data[i].status   = status;
  data[i].calledAt = new Date().toISOString();
  stopTimer();
  document.querySelectorAll('.outcome-bar').forEach(el => el.classList.remove('visible'));

  if (status === 'int') {
    fetch('/.netlify/functions/call-outcome', {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({clinicName:data[i].name, city:data[i].city, phone:data[i].phone, outcome:'interested', notes:data[i].notes||''}),
    }).catch(() => {});
    document.getElementById('cel-sub').textContent =
      data[i].name + ' is interested! Mohamed has been notified. Get their email now!';
    document.getElementById('celebrate').classList.add('visible');
  }
  render();
}

// ── CALLBACK ─────────────────────────────────────────────────────────────────
function openCb(i) {
  activeCbIdx = i;
  document.getElementById('cb-name-show').value = data[i].name;
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(10, 0, 0, 0);
  document.getElementById('cb-date').value  = d.toISOString().slice(0,16);
  document.getElementById('cb-notes').value = data[i].notes || '';
  document.getElementById('cb-modal').classList.add('visible');
}

function confirmCallback() {
  if (activeCbIdx === null) return;
  const dateVal  = document.getElementById('cb-date').value;
  const notesVal = document.getElementById('cb-notes').value;
  data[activeCbIdx].status       = 'cb';
  data[activeCbIdx].callbackDate = dateVal
    ? new Date(dateVal).toLocaleDateString('en-CA',{weekday:'short',month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'})
    : '';
  data[activeCbIdx].notes = notesVal;
  closeCb();
  stopTimer();
  render();
}

function closeCb() {
  activeCbIdx = null;
  document.getElementById('cb-modal').classList.remove('visible');
}

// ── EMAIL ────────────────────────────────────────────────────────────────────
function sendEmail(i) {
  const c   = data[i];
  const sub = encodeURIComponent('ClinicFlow Automation — ' + c.name);
  const bod = encodeURIComponent(
    'Hi,\\n\\nThank you for your time today.\\n\\nAs I mentioned, ClinicFlow Automation helps dental clinics set up automatic text-back for missed calls — patients get a response within 60 seconds.\\n\\nGrowth package: $997 one-time. $500 now, $497 after results in 30 days. No monthly fees. Setup in 5 days.\\n\\nLearn more: clinicflowautomation.com\\n\\nHappy to answer any questions.\\n\\n— Mohamed\\nClinicFlow Automation\\n438-544-0442'
  );
  window.open('mailto:?subject=' + sub + '&body=' + bod);
  setOutcome(i, 'em');
}

function saveNotes(i, val) { data[i].notes = val; }

// ── SCRIPT MODAL ─────────────────────────────────────────────────────────────
function openScript(i) {
  document.getElementById('script-clinic-name').textContent = data[i].name;
  document.getElementById('script-modal').classList.add('visible');
}
function closeScript() {
  document.getElementById('script-modal').classList.remove('visible');
}
function setLang(l) {
  lang = l;
  document.getElementById('script-en').classList.toggle('hidden', l !== 'en');
  document.getElementById('script-fr').classList.toggle('hidden', l !== 'fr');
  document.getElementById('lang-en').classList.toggle('active', l === 'en');
  document.getElementById('lang-fr').classList.toggle('active', l === 'fr');
}
function togObj(el) {
  el.classList.toggle('open');
  el.nextElementSibling.classList.toggle('open');
}

// ── CELEBRATE ────────────────────────────────────────────────────────────────
function closeCelebrate() {
  document.getElementById('celebrate').classList.remove('visible');
}

// ── COACHING TIPS ────────────────────────────────────────────────────────────
function rotateTip() {
  const el = document.getElementById('coach-tip');
  el.style.transition = 'opacity .3s';
  el.style.opacity = '0';
  setTimeout(() => {
    el.textContent = TIPS[tipIdx++ % TIPS.length];
    el.style.opacity = '1';
  }, 300);
}

// ── UTILS ────────────────────────────────────────────────────────────────────
function fmtPhone(p) {
  if (!p) return '';
  const d = p.replace(/\\D/g, '');
  if (d.length === 11) return '(' + d.slice(1,4) + ') ' + d.slice(4,7) + '-' + d.slice(7);
  if (d.length === 10) return '(' + d.slice(0,3) + ') ' + d.slice(3,6) + '-' + d.slice(6);
  return p;
}
function esc(s) {
  return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
</script>
</body>
</html>`;

// ── Write output ──────────────────────────────────────────────────────────────
const outDir  = path.join(ROOT, 'public', 'netlify-deploy');
const outPath = path.join(outDir, 'call-assistant.html');
const pubPath = path.join(ROOT, 'public', 'call-assistant.html');

fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(outPath, html, 'utf8');
fs.copyFileSync(outPath, pubPath);

// Clean up temp file
if (fs.existsSync(path.join(ROOT, 'data', 'call-targets-build.json'))) {
  fs.unlinkSync(path.join(ROOT, 'data', 'call-targets-build.json'));
}

const size = fs.statSync(outPath).size;
console.log('✓ call-assistant.html built');
console.log('  Clinics:  ', callTargets.length);
console.log('  PIN:      ', CALL_PIN);
console.log('  Size:     ', Math.round(size/1024), 'KB');
console.log('  netlify-deploy:', outPath);
console.log('  public:       ', pubPath);
console.log('');
console.log('Features included:');
console.log('  ✓ PIN lock (' + CALL_PIN + ')');
console.log('  ✓ Live call timer — starts on tap, auto-shows outcomes at 30s');
console.log('  ✓ English + French full scripts (4-step each)');
console.log('  ✓ 9 objection handlers (tap-to-reveal)');
console.log('  ✓ Outcome buttons: Interested / No Answer / Not Int. / Callback / Email');
console.log('  ✓ Callback modal with date-time picker');
console.log('  ✓ Lazy-loaded notes textarea per clinic');
console.log('  ✓ Celebration screen + Netlify function alert on INTERESTED');
console.log('  ✓ Pre-filled mailto opener');
console.log('  ✓ Stats bar (live totals)');
console.log('  ✓ To Call / Completed sections');
console.log('  ✓ Pain signal badges with orange border accent');
console.log('  ✓ Coaching tips rotating every 9s');
console.log('  ✓ Mobile-native: no zoom, safe-area aware, iOS web app meta');
