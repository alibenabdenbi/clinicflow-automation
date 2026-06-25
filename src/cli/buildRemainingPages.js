// src/cli/buildRemainingPages.js
// Builds /for/ pages for hit list prospects that don't have one yet.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT     = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const sequence = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/hitlist/sequence-tracker.json'), 'utf8'));
const dental   = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/outreach.localDentists.json'), 'utf8'));

fs.mkdirSync(path.join(ROOT, 'public/netlify-deploy/for'), { recursive: true });
fs.mkdirSync(path.join(ROOT, 'public/for'), { recursive: true });

const esc = s => String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');

function buildPage(clinic, slug) {
  const name    = clinic.clinicName || 'Your Clinic';
  const city    = clinic.city || 'Canada';
  const rating  = clinic.rating || '';
  const reviews = clinic.reviewCount || 0;
  const pain    = clinic.painSignals?.[0] || '';

  const metaRating  = rating  ? `<span class="meta-item"><strong>${esc(String(rating))}</strong> Google rating</span>` : '';
  const metaReviews = reviews ? `<span class="meta-item"><strong>${reviews}</strong> reviews</span>` : '';
  const painBlock   = pain
    ? `<div class="pain-signal">A patient mentioned: &quot;${esc(pain.slice(0, 100))}&quot;<span class="pain-note">This is the exact problem ClinicFlow fixes.</span></div>`
    : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>ClinicFlow — Built for ${esc(name)}</title>
<meta name="robots" content="noindex,nofollow">
<link href="https://fonts.googleapis.com/css2?family=Syne:wght@400;600;700;800&display=swap" rel="stylesheet">
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:'Syne',sans-serif;background:#0b0f17;color:#f1f5f9;min-height:100vh}
.wrap{max-width:640px;margin:0 auto;padding:40px 20px 80px}
.badge{display:inline-block;background:rgba(57,217,138,.1);color:#39d98a;padding:6px 16px;border-radius:20px;font-size:12px;font-weight:700;letter-spacing:1px;text-transform:uppercase;margin-bottom:24px;border:1px solid rgba(57,217,138,.2)}
h1{font-size:clamp(24px,4vw,36px);font-weight:800;line-height:1.2;margin-bottom:16px}
h1 span{color:#7c5cff}
.sub{font-size:15px;color:#94a3b8;line-height:1.7;margin-bottom:32px}
.clinic-card{background:#111827;border-radius:16px;padding:24px;margin-bottom:24px;border:1px solid rgba(255,255,255,.06)}
.clinic-name{font-size:20px;font-weight:800;margin-bottom:10px}
.clinic-meta{display:flex;gap:16px;flex-wrap:wrap;margin-bottom:16px;font-size:13px;color:#94a3b8}
.clinic-meta strong{color:#f1f5f9}
.meta-item{font-size:13px;color:#94a3b8}
.pain-signal{background:rgba(239,68,68,.06);border:1px solid rgba(239,68,68,.15);border-radius:10px;padding:14px;margin-bottom:16px;font-size:14px;color:#fca5a5;line-height:1.6}
.pain-note{display:block;font-size:12px;color:#94a3b8;margin-top:6px}
.calc{background:#0b0f17;border-radius:12px;padding:20px;border:1px solid rgba(255,255,255,.06)}
.calc-row{display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid rgba(255,255,255,.04);font-size:14px}
.calc-row:last-child{border:none;padding-top:12px;font-weight:700;font-size:16px}
.lbl{color:#94a3b8}.val{color:#f1f5f9}.total-val{color:#f87171}
.solution{background:rgba(57,217,138,.06);border:1px solid rgba(57,217,138,.15);border-radius:12px;padding:20px;margin-bottom:24px}
.solution h3{font-size:16px;font-weight:700;color:#39d98a;margin-bottom:12px}
.solution p{font-size:14px;color:#94a3b8;line-height:1.7}
.btn-p{display:block;background:#7c5cff;color:#fff;padding:16px;border-radius:12px;font-size:16px;font-weight:700;text-decoration:none;margin-bottom:10px;text-align:center}
.btn-s{display:block;background:rgba(255,255,255,.06);color:#f1f5f9;padding:14px;border-radius:12px;font-size:14px;font-weight:600;text-decoration:none;border:1px solid rgba(255,255,255,.1);margin-bottom:10px;text-align:center}
.from{margin-top:32px;padding-top:24px;border-top:1px solid rgba(255,255,255,.06);font-size:14px;color:#64748b;line-height:1.7}
.from strong{color:#f1f5f9}
</style>
</head>
<body>
<div class="wrap">
  <div class="badge">Built specifically for ${esc(name)}</div>
  <h1>What ClinicFlow would do<br>for <span>${esc(name)}</span></h1>
  <p class="sub">Based on your clinic's actual data. Takes 2 minutes to read.</p>

  <div class="clinic-card">
    <div class="clinic-name">${esc(name)}</div>
    <div class="clinic-meta">
      <span class="meta-item">&#x1F4CD; <strong>${esc(city)}</strong></span>
      ${metaRating}
      ${metaReviews}
    </div>
    ${painBlock}
    <div class="calc">
      <div class="calc-row"><span class="lbl">Estimated daily calls</span><span class="val">~20</span></div>
      <div class="calc-row"><span class="lbl">Missed call rate</span><span class="val">20%</span></div>
      <div class="calc-row"><span class="lbl">Patients who don't call back</span><span class="val">70%</span></div>
      <div class="calc-row"><span class="lbl">Average visit value</span><span class="val">$250</span></div>
      <div class="calc-row"><span class="lbl">Monthly revenue at risk</span><span class="total-val">~$14,000</span></div>
    </div>
  </div>

  <div class="solution">
    <h3>What changes with ClinicFlow</h3>
    <p>Every missed call gets a text in 60 seconds. The AI responds as your receptionist and books the appointment — before they call another clinic.</p>
    <p style="margin-top:10px">Most clinics recover 60% of missed callers. For ${esc(name)} that's roughly <strong style="color:#39d98a">~$8,400/month</strong> recovered.</p>
  </div>

  <a href="/intake?clinic=${esc(slug)}" class="btn-p">Start free 30-day pilot &#x2192;</a>
  <a href="https://calendly.com/m-aliben432/clinicflow-15-min-intro" class="btn-s" target="_blank">&#x1F4C5; Book 15 min with Mohamed</a>
  <a href="/live" class="btn-s">See the system running live &#x2192;</a>

  <div class="from">
    <strong>From Mohamed</strong><br>
    Built this page specifically for ${esc(name)} based on your clinic data.<br><br>
    Questions? 438-544-0442 &middot; contact@clinicflowautomation.com
  </div>
</div>
<script>
(function(){
  fetch('/api/track',{method:'POST',headers:{'Content-Type':'application/json'},
  body:JSON.stringify({page:'/for/${esc(slug)}',ref:document.referrer,ts:Date.now()}),keepalive:true}).catch(function(){});
})();
</script>
</body>
</html>`;
}

const prospects = sequence
  .filter(s => !s.replied)
  .map(s => {
    const clinic = dental.find(d => d.email === s.email) || {};
    const slug = (s.clinicName || 'clinic').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const hasPage = fs.existsSync(path.join(ROOT, `public/netlify-deploy/for/${slug}.html`));
    return { ...s, ...clinic, slug, hasPage };
  })
  .filter(c => !c.hasPage)
  .sort((a, b) => (b.score || 0) - (a.score || 0));

console.log('Hit list prospects without personalized page:', prospects.length);

const built = [];
for (const clinic of prospects) {
  const html = buildPage(clinic, clinic.slug);
  fs.writeFileSync(path.join(ROOT, `public/netlify-deploy/for/${clinic.slug}.html`), html, 'utf8');
  fs.copyFileSync(
    path.join(ROOT, `public/netlify-deploy/for/${clinic.slug}.html`),
    path.join(ROOT, `public/for/${clinic.slug}.html`)
  );
  built.push({ slug: clinic.slug, name: clinic.clinicName, email: clinic.email });
  console.log(`✓ /for/${clinic.slug}`);
}

const totalPages = fs.readdirSync(path.join(ROOT, 'public/netlify-deploy/for')).length;
console.log(`\n${built.length} new personalized pages built`);
console.log('Total /for/ pages:', totalPages);

// Save list for sending page links
fs.writeFileSync(path.join(ROOT, 'data/personalized-pages-new.json'), JSON.stringify(built, null, 2));
console.log('\nReady to send page links — saved to data/personalized-pages-new.json');
