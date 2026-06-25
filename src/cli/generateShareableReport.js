// src/cli/generateShareableReport.js
// Generates a beautiful standalone HTML report shareable by clinics.
// Saved to: public/netlify-deploy/results/{slug}.html
// Public URL: clinicflowautomation.com/results/{slug}
// Run: node src/cli/generateShareableReport.js --client test-clinic
// Run all: node src/cli/generateShareableReport.js --all

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const CLIENTS_PATH = path.join(ROOT, "data", "clients.json");
const CLIENTS_DIR  = path.join(ROOT, "data", "clients");
const OUTPUT_DIR   = path.join(ROOT, "public", "netlify-deploy", "results");
const BASE_URL = (process.env.PUBLIC_BASE_URL || "https://clinicflowautomation.com").trim();

function readJsonSafe(p, fb) {
  try { return JSON.parse(fs.readFileSync(p, "utf-8")); } catch { return fb; }
}

function getArg(flag) {
  const i = process.argv.indexOf(flag);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : null;
}

function formatMonth(iso) {
  if (!iso) return "This month";
  return new Date(iso).toLocaleDateString("en-CA", { month: "long", year: "numeric" });
}

function maskName(name) {
  if (!name) return "Patient";
  const parts = name.trim().split(" ");
  return parts[0] + (parts[1] ? " " + parts[1][0] + "." : "");
}

function buildSampleInteractions(threads = []) {
  return threads
    .filter((t) => t.status === "recovered" && t.messages.length > 0)
    .slice(0, 4)
    .map((t) => {
      const calledAt = new Date(t.calledAt);
      const dayStr = calledAt.toLocaleDateString("en-CA", { weekday: "short", month: "short", day: "numeric" });
      const timeStr = calledAt.toLocaleTimeString("en-CA", { hour: "numeric", minute: "2-digit", hour12: true });
      const wave1 = t.messages.find((m) => m.wave === 1);
      const replyMsg = t.messages.find((m) => m.direction === "inbound");
      const smsDelay = wave1 ? Math.round((new Date(wave1.sentAt) - calledAt) / 1000) : 60;
      const patientLabel = t.patientName ? maskName(t.patientName) : "Patient";
      return {
        dayStr,
        timeStr,
        smsDelay,
        patientLabel,
        replyText: replyMsg?.body?.slice(0, 60) || "Yes, I'd like to book",
        recovered: true,
      };
    });
}

function buildHtml(clinic, stats, threads, reportDate) {
  const slug        = clinic.clinicSlug || "clinic";
  const name        = clinic.clinicName || slug;
  const period      = formatMonth(reportDate);
  const missed      = stats.wave1Sent || 0;
  const recovered   = stats.recovered || 0;
  const replyRate   = missed > 0 ? Math.round((stats.replied / missed) * 100) : 0;
  const recoveryRate = missed > 0 ? Math.round((recovered / missed) * 100) : 0;
  const revenue     = recovered * 200;
  const portalUrl   = `${BASE_URL}/portal?clinic=${slug}&key=${clinic.portalPassword || ""}`;
  const reportUrl   = `${BASE_URL}/results/${slug}`;
  const interactions = buildSampleInteractions(threads);

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<meta property="og:title" content="${name} — ClinicFlow Results · ${period}"/>
<meta property="og:description" content="${name} recovered $${revenue.toLocaleString("en-CA")} in patient revenue using ClinicFlow Automation."/>
<title>${name} — ClinicFlow Results · ${period}</title>
<link rel="preconnect" href="https://fonts.googleapis.com"/>
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin/>
<link href="https://fonts.googleapis.com/css2?family=Syne:wght@400;600;700;800&family=Syne+Mono&display=swap" rel="stylesheet"/>
<style>
:root{--bg:#0b0f17;--card:rgba(255,255,255,.06);--line:rgba(255,255,255,.1);
  --text:#e8eefc;--muted:#a7b0c5;--accent:#7c5cff;--accent2:#39d98a;--gold:#f6b04d;--bad:#ff5c7a;--radius:12px;}
*{box-sizing:border-box;margin:0;padding:0;}
body{background:var(--bg);color:var(--text);font-family:'Syne',ui-sans-serif,system-ui,sans-serif;min-height:100vh;
  background-image:radial-gradient(900px 600px at 50% -5%,rgba(124,92,255,.12),transparent 55%);}
.wrap{max-width:780px;margin:0 auto;padding:40px 24px 80px;}
/* Header */
.rpt-header{text-align:center;padding:48px 0 40px;border-bottom:1px solid var(--line);margin-bottom:48px;}
.rpt-logo{font-size:12px;font-weight:700;color:var(--accent);letter-spacing:.1em;text-transform:uppercase;margin-bottom:16px;}
.rpt-clinic{font-size:clamp(24px,4vw,36px);font-weight:800;margin-bottom:6px;}
.rpt-period{font-size:14px;color:var(--muted);}
/* Stats */
.stat-row{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:48px;}
@media(max-width:600px){.stat-row{grid-template-columns:repeat(2,1fr);}}
.sc{background:var(--card);border:1px solid var(--line);border-radius:var(--radius);padding:20px;text-align:center;}
.sc-val{font-family:'Syne Mono',monospace;font-size:36px;font-weight:400;line-height:1;margin-bottom:6px;}
.sc-lbl{font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.06em;}
.c-gold{color:var(--gold);}
.c-green{color:var(--accent2);}
.c-purple{color:var(--accent);}
.c-blue{color:#60a5fa;}
/* Quote */
.quote-block{
  background:linear-gradient(135deg,rgba(246,176,77,.08),rgba(57,217,138,.04));
  border:1px solid rgba(246,176,77,.25);border-radius:16px;
  padding:36px;text-align:center;margin-bottom:48px;
}
.quote-text{font-size:clamp(16px,2.5vw,20px);font-weight:700;line-height:1.4;margin-bottom:12px;}
.quote-text em{font-style:normal;color:var(--gold);}
.quote-attr{font-size:13px;color:var(--muted);}
/* Timeline */
.timeline-section{margin-bottom:48px;}
.tl-title{font-size:16px;font-weight:700;margin-bottom:20px;}
.tl-item{display:flex;gap:16px;margin-bottom:16px;align-items:flex-start;}
.tl-dot{width:10px;height:10px;border-radius:50%;background:var(--accent2);flex-shrink:0;margin-top:4px;}
.tl-dot.waiting{background:var(--gold);}
.tl-body{flex:1;}
.tl-event{font-size:14px;font-weight:600;}
.tl-detail{font-size:12px;color:var(--muted);margin-top:3px;}
.tl-badge{display:inline-block;background:rgba(57,217,138,.12);color:var(--accent2);
  font-size:10px;font-weight:700;padding:2px 8px;border-radius:4px;text-transform:uppercase;margin-left:8px;}
/* Interactions */
.interactions{margin-bottom:48px;}
.int-title{font-size:16px;font-weight:700;margin-bottom:16px;}
.int-item{background:var(--card);border:1px solid var(--line);border-radius:var(--radius);
  padding:20px;margin-bottom:12px;}
.int-row{display:flex;align-items:flex-start;gap:12px;margin-bottom:10px;}
.int-icon{font-size:16px;flex-shrink:0;}
.int-text{font-size:13px;color:var(--muted);}
.int-text strong{color:var(--text);}
.int-reply{background:rgba(57,217,138,.06);border:1px solid rgba(57,217,138,.15);
  border-radius:8px;padding:10px 14px;font-size:13px;color:var(--accent2);margin-top:4px;}
/* Share */
.share-section{background:rgba(124,92,255,.08);border:1px solid rgba(124,92,255,.2);
  border-radius:var(--radius);padding:28px;margin-bottom:48px;text-align:center;}
.share-title{font-size:16px;font-weight:700;margin-bottom:8px;}
.share-sub{font-size:13px;color:var(--muted);margin-bottom:20px;line-height:1.6;}
.share-btns{display:flex;gap:10px;justify-content:center;flex-wrap:wrap;}
.share-btn{padding:10px 20px;border-radius:8px;font-size:13px;font-weight:700;
  cursor:pointer;border:none;font-family:inherit;transition:all .2s;}
.btn-copy{background:var(--accent);color:#fff;}
.btn-copy:hover{opacity:.85;}
.btn-email{background:rgba(255,255,255,.06);color:var(--text);border:1px solid var(--line);}
.btn-email:hover{background:rgba(255,255,255,.1);}
/* Review */
.review-section{border:1px solid var(--line);border-radius:var(--radius);padding:24px;
  text-align:center;margin-bottom:48px;}
.review-section p{font-size:14px;color:var(--muted);margin-bottom:16px;line-height:1.6;}
.review-btn{display:inline-block;background:rgba(246,176,77,.1);color:var(--gold);
  border:1px solid rgba(246,176,77,.25);border-radius:8px;padding:10px 20px;
  font-size:13px;font-weight:700;text-decoration:none;transition:all .2s;}
.review-btn:hover{background:rgba(246,176,77,.18);}
/* CTA */
.bottom-cta{
  text-align:center;padding:48px 0 0;border-top:1px solid var(--line);
}
.bottom-cta h2{font-size:clamp(20px,3vw,28px);font-weight:800;margin-bottom:10px;}
.bottom-cta p{font-size:14px;color:var(--muted);margin-bottom:24px;}
.bottom-cta a{display:inline-block;background:var(--accent);color:#fff;padding:14px 32px;
  border-radius:10px;font-size:15px;font-weight:700;text-decoration:none;transition:all .2s;}
.bottom-cta a:hover{background:#6d4fe8;transform:translateY(-2px);}
.powered{text-align:center;font-size:11px;color:var(--muted);margin-top:32px;}
.powered a{color:var(--accent);text-decoration:none;}
@keyframes fadeUp{from{opacity:0;transform:translateY(16px);}to{opacity:1;transform:translateY(0);}}
.stat-row .sc{animation:fadeUp .4s ease both;}
.sc:nth-child(1){animation-delay:.05s;}.sc:nth-child(2){animation-delay:.1s;}
.sc:nth-child(3){animation-delay:.15s;}.sc:nth-child(4){animation-delay:.2s;}
</style>
</head>
<body>
<div class="wrap">

<div class="rpt-header">
  <div class="rpt-logo">ClinicFlow Automation</div>
  <div class="rpt-clinic">${name}</div>
  <div class="rpt-period">${period} Results Report</div>
</div>

<div class="stat-row">
  <div class="sc"><div class="sc-val c-purple">${missed}</div><div class="sc-lbl">Calls handled</div></div>
  <div class="sc"><div class="sc-val c-green">${recovered}</div><div class="sc-lbl">Patients recovered</div></div>
  <div class="sc"><div class="sc-val c-gold">$${revenue.toLocaleString("en-CA")}</div><div class="sc-lbl">Revenue recovered</div></div>
  <div class="sc"><div class="sc-val c-blue">${replyRate}%</div><div class="sc-lbl">Reply rate</div></div>
</div>

<div class="quote-block">
  <div class="quote-text">"${name} recovered <em>$${revenue.toLocaleString("en-CA")}</em> in patient revenue this month — automatically, with zero staff time."</div>
  <div class="quote-attr">ClinicFlow Automation · ${period} results</div>
</div>

${interactions.length ? `
<div class="interactions">
  <div class="int-title">Sample patient interactions this month</div>
  ${interactions.map((i) => `
  <div class="int-item">
    <div class="int-row">
      <div class="int-icon">📱</div>
      <div class="int-text"><strong>${i.patientLabel}</strong> called ${i.dayStr} at ${i.timeStr}</div>
    </div>
    <div class="int-row">
      <div class="int-icon">⚡</div>
      <div class="int-text">Automatic follow-up SMS sent in <strong>${i.smsDelay}s</strong></div>
    </div>
    <div class="int-reply">"${i.replyText}"</div>
    <div style="font-size:12px;color:var(--accent2);margin-top:8px;font-weight:700;">✓ Appointment booked</div>
  </div>`).join("")}
</div>` : ""}

<div class="share-section">
  <div class="share-title">Share your results</div>
  <div class="share-sub">Send this report to a colleague — if their clinic isn't using ClinicFlow, they're missing calls.</div>
  <div class="share-btns">
    <button class="share-btn btn-copy" onclick="copyLink()">📋 Copy report link</button>
    <button class="share-btn btn-email" onclick="emailReport()">✉ Email to colleague</button>
  </div>
</div>

<div class="review-section">
  <p>Did ClinicFlow work for you? A Google review helps other Canadian dentists find us.</p>
  <a class="review-btn" href="https://g.page/r/clinicflowautomation/review" target="_blank">⭐ Leave a Google review →</a>
</div>

<div class="bottom-cta">
  <h2>Get ClinicFlow for your clinic</h2>
  <p>Setup in 5 days. Pay the second half only after you see results. No monthly fees.</p>
  <a href="${BASE_URL}/pricing">See pricing →</a>
</div>

<div class="powered">Powered by <a href="${BASE_URL}">ClinicFlow Automation</a> · Montreal, QC</div>

</div>
<script>
const REPORT_URL = '${reportUrl}';
function copyLink() {
  navigator.clipboard.writeText(REPORT_URL).then(() => {
    const btn = document.querySelector('.btn-copy');
    btn.textContent = '✓ Copied!';
    setTimeout(() => { btn.textContent = '📋 Copy report link'; }, 2000);
  });
}
function emailReport() {
  const subj = encodeURIComponent('${name} — ClinicFlow Results · ${period}');
  const body = encodeURIComponent('I thought you might find this interesting — our dental clinic has been using ClinicFlow to automatically follow up on every missed call. Here are our results this month:\\n\\n' + REPORT_URL + '\\n\\nHappy to talk more if you want details.');
  window.location.href = 'mailto:?subject=' + subj + '&body=' + body;
}
</script>
</body>
</html>`;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const slug = getArg("--client");
  const runAll = process.argv.includes("--all");

  const allClients = readJsonSafe(CLIENTS_PATH, []);
  let targets = [];

  if (slug) {
    const c = allClients.find((c) => c.clinicSlug === slug || (c.clinicName || "").toLowerCase().includes(slug.toLowerCase()));
    if (!c) { console.error(`Client not found: ${slug}`); process.exit(1); }
    targets = [c];
  } else if (runAll) {
    targets = allClients.filter((c) => c.clinicSlug && c.status === "active");
  } else {
    console.error('Usage: node generateShareableReport.js --client SLUG [or --all]');
    process.exit(1);
  }

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  let generated = 0;

  for (const clinic of targets) {
    const cSlug = clinic.clinicSlug;
    const threadsPath = path.join(CLIENTS_DIR, cSlug, "recovery-threads.json");
    const threads = readJsonSafe(threadsPath, []);

    // Build stats from threads
    const stats = {
      total:     threads.length,
      wave1Sent: threads.filter((t) => t.messages.some((m) => m.wave === 1 && m.success)).length,
      replied:   threads.filter((t) => t.reply != null).length,
      recovered: threads.filter((t) => t.recovered).length,
    };

    const reportDate = new Date().toISOString();
    const html = buildHtml(clinic, stats, threads, reportDate);
    const outPath = path.join(OUTPUT_DIR, `${cSlug}.html`);
    fs.writeFileSync(outPath, html, "utf-8");
    console.log(`✓ ${clinic.clinicName || cSlug} → ${outPath}`);
    console.log(`  Stats: ${stats.wave1Sent} calls | ${stats.recovered} recovered | $${stats.recovered * 200} revenue`);
    generated++;
  }

  console.log(`\nGenerated ${generated} report(s).`);
}

main().catch((err) => { console.error(err.message); process.exit(1); });
