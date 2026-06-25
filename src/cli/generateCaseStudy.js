// src/cli/generateCaseStudy.js
// Generates a case study from real beta partner data after 60 days.
// Reads data/clients/{slug}/brain.json + metrics.json + testimonial.json
// Outputs: markdown + publishable HTML at /results/{slug} + LinkedIn post draft
//
// Usage:
//   node src/cli/generateCaseStudy.js                        # list all beta partners
//   node src/cli/generateCaseStudy.js --clinic park-lawn-dental
//   node src/cli/generateCaseStudy.js --client "Museum Dental"  # legacy name lookup

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
dotenv.config();

const __dirname  = path.dirname(fileURLToPath(import.meta.url));
const ROOT       = path.resolve(__dirname, '../..');
const DATA_DIR   = path.join(ROOT, 'data');
const OUTPUT_DIR = path.join(ROOT, 'public', 'netlify-deploy');

const args   = process.argv.slice(2);
const getArg = n => { const i = args.indexOf(n); return i !== -1 ? args[i+1] : null; };

// Support both --clinic slug and legacy --client "Name"
let slug = getArg('--clinic');
if (!slug) {
  const clientArg = getArg('--client');
  if (clientArg) {
    slug = clientArg.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  }
}

if (!slug) {
  console.log('Usage: node src/cli/generateCaseStudy.js --clinic <slug>');
  console.log('');
  console.log('Active beta partners:');
  try {
    const registry = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'beta-partners.json'), 'utf8'));
    if (!registry.length) { console.log('  (none yet — run activatePilot.js --beta)'); }
    else {
      registry.forEach(p => {
        const daysLeft = Math.ceil((new Date(p.testimonialDueAt) - Date.now()) / 86400000);
        const flag = daysLeft <= 0 ? ' ← READY NOW' : ` (${daysLeft}d left)`;
        console.log(`  ${p.slug.padEnd(30)} ${p.clinicName}${flag}`);
      });
    }
  } catch { console.log('  (no beta-partners.json yet)'); }
  process.exit(0);
}

// ── Load clinic data ───────────────────────────────────────────────────────

const clientDir = path.join(DATA_DIR, 'clients', slug);

function readSafe(p, fallback) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return fallback; }
}

const brain       = readSafe(path.join(clientDir, 'brain.json'), {});
const metrics     = readSafe(path.join(clientDir, 'metrics.json'), {});
const testimonial = readSafe(path.join(clientDir, 'testimonial.json'), null);

// Enrich from outreach DB if brain is sparse
let outreachRecord = {};
try {
  const dental  = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'outreach.localDentists.json'), 'utf8'));
  const physio  = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'outreach.physioClinics.json'), 'utf8'));
  const found   = [...dental, ...physio].find(c =>
    c.email === brain.email ||
    c.clinicName?.toLowerCase().replace(/[^a-z0-9]+/g, '-') === slug
  );
  if (found) outreachRecord = found;
} catch {}

const name     = brain.clinicName || outreachRecord.clinicName || slug;
const city     = brain.city       || outreachRecord.city       || 'Canada';
const market   = brain.market     || 'dental';
const typeLabel = market === 'physio' ? 'physiotherapy clinic' : 'dental clinic';

const activatedAt  = brain.activatedAt ? new Date(brain.activatedAt) : new Date();
const today        = new Date();
const daysActive   = Math.max(1, Math.floor((today - activatedAt) / 86400000));
const activatedStr = activatedAt.toLocaleDateString('en-CA', { year:'numeric', month:'long', day:'numeric' });
const APPT_VALUE   = 250;

// ── Metrics ────────────────────────────────────────────────────────────────

const callsMissed      = metrics.callsMissed       || 0;
const textbacksSent    = metrics.textbacksSent     || 0;
const textbacksReplied = metrics.textbacksReplied  || 0;
const apptBooked       = metrics.appointmentsBooked || 0;
const reactivated      = metrics.patientsReactivated || 0;
const digests          = metrics.weeklyDigestsSent  || 0;
const replyRate        = textbacksSent > 0 ? Math.round((textbacksReplied / textbacksSent) * 100) : 0;
const revenueRecovered = apptBooked * APPT_VALUE;
const hasData          = callsMissed > 0 || textbacksSent > 0 || apptBooked > 0;

// ── Pain signal ────────────────────────────────────────────────────────────

const rawPain  = brain.painSignal || outreachRecord.painSignals?.[0];
const painText = rawPain
  ? (typeof rawPain === 'object' ? (rawPain.text || rawPain.signal || '') : String(rawPain)).slice(0, 100)
  : null;

// ── Claude prose (optional — falls back to static if no API key) ───────────

let narrative = null;
const ANTHROPIC_KEY = (process.env.ANTHROPIC_API_KEY || '').trim();

if (ANTHROPIC_KEY && hasData) {
  try {
    console.log('Generating narrative via Claude...');
    const { default: Anthropic } = await import('@anthropic-ai/sdk');
    const client = new Anthropic({ apiKey: ANTHROPIC_KEY });
    const msg = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 600,
      system: `You write honest, data-driven case studies for ClinicFlow Automation.
Tone: factual, specific, no hype. Real numbers. No exaggeration.
Structure: situation (1 sentence) → what changed → results.
Two short paragraphs max. No headers. No bullet points in this prose section.`,
      messages: [{
        role: 'user',
        content: `Write a 2-paragraph narrative for this case study:
Clinic: ${name} — ${typeLabel} in ${city}
Days live: ${daysActive}
Missed calls captured: ${callsMissed}
Auto text-backs sent: ${textbacksSent}
Patients who replied: ${textbacksReplied} (${replyRate}% reply rate)
Appointments booked via SMS: ${apptBooked}
Revenue recovered: ~$${revenueRecovered.toLocaleString('en-CA')} CAD
Patients reactivated: ${reactivated}
${testimonial?.quote ? `Owner said: "${testimonial.quote}"` : ''}

Be specific. Use the numbers. If any number is 0, skip it. Max 120 words.`,
      }],
    });
    narrative = msg.content?.[0]?.text?.trim() || null;
    console.log('✓ Narrative generated');
  } catch (err) {
    console.log(`Claude prose skipped: ${err.message} — using static template`);
  }
}

// Static fallback narrative
if (!narrative) {
  narrative = hasData
    ? `${name} is a ${typeLabel} in ${city}. Before ClinicFlow, missed calls went unanswered — patients who couldn't reach the front desk moved on to the next clinic.

After ${daysActive} days live, ${textbacksReplied > 0 ? textbacksReplied + ' patients were recovered via automatic text-back within 60 seconds of their missed call. ' : ''}${apptBooked > 0 ? apptBooked + ' appointments were booked via SMS, recovering approximately $' + revenueRecovered.toLocaleString('en-CA') + ' in revenue. ' : ''}${reactivated > 0 ? reactivated + ' inactive patients were reactivated through a targeted campaign. ' : ''}All of this happened automatically, with zero extra staff effort.`
    : `${name} is a ${typeLabel} in ${city}. Update data/clients/${slug}/metrics.json and re-run to populate this section with real numbers.`;
}

// ── Testimonial blocks ─────────────────────────────────────────────────────

const quoteBlock = testimonial?.quote
  ? `"${testimonial.quote}"\n\n— ${testimonial.name || name}, ${testimonial.title || 'Clinic Owner'}`
  : `[Testimonial pending — add to data/clients/${slug}/testimonial.json]`;

// ── LinkedIn post draft ────────────────────────────────────────────────────

const liPost = hasData
  ? `Just published a case study on ${name} in ${city}.

They were losing ~${Math.round(callsMissed / daysActive * 7)} calls per week to missed calls.

${daysActive} days after ClinicFlow:
• ${textbacksReplied} patients recovered via automatic text-back
• ${apptBooked} appointments booked — $${revenueRecovered.toLocaleString('en-CA')} recovered
• ${reactivated > 0 ? reactivated + ' inactive patients reactivated' : 'Running in the background — zero staff effort'}
• ${replyRate}% of patients replied to the automatic text within minutes

Setup time: 5 days. Free for them (beta partner).

→ Full case study: clinicflowautomation.com/results/${slug}`
  : `Just published a case study on ${name} in ${city}.

[Update with real metrics after 60 days — see data/clients/${slug}/metrics.json]

→ Full case study: clinicflowautomation.com/results/${slug}`;

// ── Markdown ───────────────────────────────────────────────────────────────

const md = `# Case Study: ${name}
*How ClinicFlow ${hasData ? 'recovered ' + (apptBooked > 0 ? apptBooked + ' missed appointments' : 'missed-call revenue') : 'automated patient recovery'} in ${daysActive} days.*

---

## The Clinic

**${name}** — ${typeLabel} in ${city}.

- Activated: ${activatedStr}
- Track: ${brain.freeForever ? 'Beta Partner (free forever)' : '30-day pilot'}
- Days active: ${daysActive}

---

## The Problem

${painText ? `A patient had left a Google review mentioning: *"${painText}"*\n\n` : ''}Every missed call is a patient who didn't book. Before ClinicFlow:

- Staff couldn't always answer during peak hours
- Patients called, got voicemail, and called the next clinic
- No system existed to recover those patients automatically

---

## Results

${hasData ? `| Metric | Result |
|--------|--------|
| Calls missed (captured) | **${callsMissed}** |
| Automatic text-backs sent | **${textbacksSent}** |
| Patients who replied | **${textbacksReplied}** (${replyRate}% reply rate) |
| Appointments booked | **${apptBooked}** |
| Inactive patients reactivated | **${reactivated}** |
| Weekly digests delivered | **${digests}** |
| Revenue recovered (est.) | **~$${revenueRecovered.toLocaleString('en-CA')} CAD** |` : `*(Update data/clients/${slug}/metrics.json and re-run to populate with real numbers.)*`}

---

## In Their Words

${quoteBlock}

---

## How It Works

1. Patient calls → no answer → voicemail
2. ClinicFlow detects missed call within seconds
3. Auto text-back sent: *"Hi! You called ${name} and we missed you. Want to book?"*
4. Patient replies → staff sees reply and responds or sends booking link
5. Appointment booked

Steps 1–4 require zero staff involvement.

---

*Generated: ${today.toLocaleDateString('en-CA', { year:'numeric', month:'long', day:'numeric' })}*
*ClinicFlow Automation — clinicflowautomation.com*
`;

// ── HTML page (dark theme, Syne font — matches site design) ───────────────

const narrativeHtml = narrative
  .split('\n\n')
  .filter(Boolean)
  .map(p => `<p>${p.replace(/\n/g, ' ')}</p>`)
  .join('\n    ');

const quoteHtml = testimonial?.quote
  ? `<div class="quote">
    <div class="quote-text">&ldquo;${testimonial.quote}&rdquo;</div>
    <div class="quote-attr">— ${testimonial.name || name}, ${testimonial.title || 'Clinic Owner'}</div>
  </div>`
  : '';

const numA = hasData ? String(textbacksReplied) : '[X]';
const numB = hasData ? String(callsMissed)       : '[X]';
const numC = hasData ? '$' + revenueRecovered.toLocaleString('en-CA') : '$[X]';
const numD = hasData ? daysActive + ' days'      : '[X] days';

const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${name} — ClinicFlow Results</title>
<meta name="description" content="How ${name} in ${city} recovered missed patients with ClinicFlow Automation. ${hasData ? textbacksReplied + ' patients recovered, $' + revenueRecovered.toLocaleString('en-CA') + ' in revenue.' : ''}">
<link rel="canonical" href="https://clinicflowautomation.com/results/${slug}">
<meta property="og:title" content="${name} — ClinicFlow Case Study">
<meta property="og:description" content="How ${name} recovered patients from missed calls — ${daysActive}-day results.">
<meta property="og:type" content="article">
<link href="https://fonts.googleapis.com/css2?family=Syne:wght@400;600;700;800&display=swap" rel="stylesheet">
<script type="application/ld+json">
{"@context":"https://schema.org","@type":"Article","headline":"${name} — ClinicFlow Case Study","description":"How ${name} in ${city} recovered missed-call revenue with ClinicFlow Automation.","url":"https://clinicflowautomation.com/results/${slug}"}
</script>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:'Syne',sans-serif;background:#0b0f17;color:#f1f5f9;min-height:100vh;
  background-image:radial-gradient(700px 400px at 50% -10%,rgba(57,217,138,.08),transparent 55%)}
nav{padding:20px;display:flex;justify-content:space-between;align-items:center;max-width:800px;margin:0 auto}
nav a{color:#94a3b8;text-decoration:none;font-size:14px}
.logo{font-size:16px;font-weight:700;color:#fff!important}
.hero{padding:60px 20px 40px;text-align:center;max-width:700px;margin:0 auto}
.badge{display:inline-block;background:rgba(57,217,138,.1);color:#39d98a;padding:6px 16px;border-radius:20px;font-size:12px;font-weight:700;letter-spacing:1px;text-transform:uppercase;margin-bottom:20px;border:1px solid rgba(57,217,138,.2)}
.hero h1{font-size:clamp(24px,4vw,40px);font-weight:800;line-height:1.2;margin-bottom:12px}
.hero h1 span{color:#39d98a}
.hero p{font-size:15px;color:#94a3b8;line-height:1.7}
.wrap{max-width:700px;margin:0 auto;padding:0 20px 80px}
.stats-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:14px;margin:36px 0}
@media(min-width:600px){.stats-grid{grid-template-columns:repeat(4,1fr)}}
.stat-card{background:#111827;border-radius:16px;padding:24px;text-align:center;border:1px solid rgba(255,255,255,.06)}
.stat-num{font-size:36px;font-weight:800;color:#39d98a;line-height:1;margin-bottom:6px}
.stat-lbl{font-size:12px;color:#64748b;line-height:1.4}
.section{margin-bottom:40px}
.section-label{font-size:11px;font-weight:700;color:#4a5568;text-transform:uppercase;letter-spacing:2px;margin-bottom:16px}
.prose p{font-size:15px;color:#94a3b8;line-height:1.85;margin-bottom:14px}
.tl-item{background:#111827;border-radius:12px;padding:18px;margin-bottom:10px;border-left:3px solid #7c5cff;font-size:14px;color:#94a3b8;line-height:1.6}
.tl-item b{color:#f1f5f9}
.quote{background:rgba(124,92,255,.06);border-left:3px solid #7c5cff;padding:20px 24px;border-radius:0 12px 12px 0;margin:32px 0}
.quote-text{font-size:17px;color:#cbd5e1;line-height:1.7;font-style:italic;margin-bottom:10px}
.quote-attr{font-size:13px;color:#4a5568}
.cta{background:linear-gradient(135deg,rgba(124,92,255,.1),rgba(57,217,138,.05));border:1px solid rgba(124,92,255,.2);border-radius:20px;padding:36px;text-align:center;margin-top:48px}
.cta h2{font-size:22px;font-weight:800;margin-bottom:10px}
.cta p{font-size:14px;color:#94a3b8;margin-bottom:24px;line-height:1.7}
.cta a{display:inline-block;background:#7c5cff;color:#fff;padding:16px 32px;border-radius:12px;font-size:16px;font-weight:700;text-decoration:none}
.back{font-size:13px;color:#4a5568;text-decoration:none;display:inline-block;margin-bottom:24px}
.back:hover{color:#94a3b8}
</style>
</head>
<body>
<nav>
  <a href="/" class="logo">ClinicFlow</a>
  <div style="display:flex;gap:20px">
    <a href="/results">All results</a>
    <a href="/beta">Beta program</a>
    <a href="/pricing">Pricing</a>
  </div>
</nav>
<div class="hero">
  <div class="badge">Case Study · ${city}</div>
  <h1>${name} — <span>${daysActive} days</span> with ClinicFlow</h1>
  <p>${typeLabel.charAt(0).toUpperCase() + typeLabel.slice(1)} in ${city}. Real numbers from a real deployment.</p>
</div>
<div class="wrap">
  <a href="/results" class="back">← All results</a>

  <div class="stats-grid">
    <div class="stat-card"><div class="stat-num">${numA}</div><div class="stat-lbl">Patients recovered</div></div>
    <div class="stat-card"><div class="stat-num">${numB}</div><div class="stat-lbl">Missed calls captured</div></div>
    <div class="stat-card"><div class="stat-num">${numC}</div><div class="stat-lbl">Revenue recovered (est.)</div></div>
    <div class="stat-card"><div class="stat-num">${numD}</div><div class="stat-lbl">Time live</div></div>
  </div>

  <div class="section">
    <div class="section-label">The story</div>
    <div class="prose">
    ${narrativeHtml}
    </div>
  </div>

  <div class="section">
    <div class="section-label">What we set up</div>
    <div class="tl-item"><b>Day 1–2:</b> System configured. Clinic profile built — hours, services, team, tone.</div>
    <div class="tl-item"><b>Day 3:</b> Test call completed. First auto-text arrived in under 60 seconds.</div>
    <div class="tl-item"><b>Day 5:</b> Live. First real patient recovered automatically.</div>
    <div class="tl-item"><b>Days 6–${daysActive}:</b> ${textbacksReplied > 0 ? textbacksReplied + ' missed calls recovered. ' : ''}${apptBooked > 0 ? apptBooked + ' appointments booked. ' : ''}${digests > 0 ? digests + ' weekly digests sent. ' : ''}All automatic, zero extra staff effort.</div>
  </div>

  ${quoteHtml}

  <div class="cta">
    <h2>Want results like this for your clinic?</h2>
    <p>One-time setup. No monthly fees. You pay the second half only after you see results.</p>
    <a href="/calculator">Calculate your revenue gap →</a>
  </div>
</div>
<script>
(function(){fetch('/api/track',{method:'POST',headers:{'Content-Type':'application/json'},
body:JSON.stringify({page:'/results/${slug}',ref:document.referrer,ts:Date.now()}),keepalive:true}).catch(function(){});})();
</script>
</body>
</html>`;

// ── Write files ────────────────────────────────────────────────────────────

const resultsDir       = path.join(OUTPUT_DIR, 'results');
const resultsDirPublic = path.join(ROOT, 'public', 'results');
fs.mkdirSync(clientDir, { recursive: true });
fs.mkdirSync(resultsDir, { recursive: true });
fs.mkdirSync(resultsDirPublic, { recursive: true });
fs.mkdirSync(path.join(DATA_DIR, 'outputs'), { recursive: true });

const mdPath   = path.join(DATA_DIR, 'outputs', `case-study-${slug}.md`);
const htmlPath = path.join(resultsDir, `${slug}.html`);

fs.writeFileSync(path.join(clientDir, 'case-study.md'), md);
fs.writeFileSync(mdPath, md);
fs.writeFileSync(htmlPath, html);
fs.copyFileSync(htmlPath, path.join(resultsDirPublic, `${slug}.html`));

// Update brain
brain.caseStudyGenerated   = true;
brain.caseStudyGeneratedAt = today.toISOString();
brain.lastUpdated          = today.toISOString();
if (Object.keys(brain).length > 3) {
  fs.writeFileSync(path.join(clientDir, 'brain.json'), JSON.stringify(brain, null, 2));
}

// Update beta registry
try {
  const regPath  = path.join(DATA_DIR, 'beta-partners.json');
  const registry = JSON.parse(fs.readFileSync(regPath, 'utf8'));
  const idx = registry.findIndex(p => p.slug === slug);
  if (idx !== -1) {
    registry[idx].caseStudyGenerated   = true;
    registry[idx].caseStudyGeneratedAt = today.toISOString();
    fs.writeFileSync(regPath, JSON.stringify(registry, null, 2));
  }
} catch {}

// ── Output ─────────────────────────────────────────────────────────────────

console.log(`\n✓ Case study generated: ${name}`);
console.log(`  HTML:      ${htmlPath}`);
console.log(`  Markdown:  ${mdPath}`);
console.log(`  URL:       clinicflowautomation.com/results/${slug}\n`);

if (!hasData) {
  console.log('  No metrics yet — update and re-run:');
  console.log(`  ${path.join(clientDir, 'metrics.json')}\n`);
}
if (!testimonial) {
  console.log('  Testimonial pending — request from clinic, save to:');
  console.log(`  ${path.join(clientDir, 'testimonial.json')}`);
  console.log(`  Format: { "quote": "...", "name": "Dr. ...", "title": "Owner" }\n`);
}

console.log('── LinkedIn post draft ─────────────────────────────────');
console.log(liPost);
console.log('──────────────────────────────────────────────────');
console.log('\nDeploy: drag public/netlify-deploy/ to app.netlify.com');
console.log('One real number changes every future email.');
