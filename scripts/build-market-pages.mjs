import fs from 'fs';

const markets = [
  {
    slug: 'dental',
    name: 'Dental Clinics',
    title: 'Dental Clinic Automation Software Canada — ClinicFlow',
    metaDesc: 'Automate patient communication for your Canadian dental clinic. Missed-call text-back in 60 seconds. One-time setup, no monthly fees.',
    hero: 'Stop losing patients to voicemail. ClinicFlow automatically texts missed callers within 60 seconds.',
    searches: ['dental clinic automation Canada', 'automate dental clinic', 'dental office software Canada', 'AI dental clinic Canada', 'dental patient communication software'],
    pain: ['Missed calls during lunch hour', 'Patients booking at competitor clinics', 'No follow-up system for missed calls', 'Front desk overwhelmed with calls', 'Manual appointment reminder calls'],
    fix: ['Every missed call gets a text in 60 seconds', 'AI responds as your receptionist naturally', 'Appointments book directly via SMS', '72h and 24h reminders sent automatically', 'Inactive patients reactivated monthly'],
    stat: '20-30%', statLabel: 'of dental calls go unanswered',
  },
  {
    slug: 'physio',
    name: 'Physiotherapy Clinics',
    title: 'Physiotherapy Clinic Software Canada — ClinicFlow',
    metaDesc: 'Automate patient communication for Canadian physiotherapy clinics. Missed-call text-back, appointment reminders, patient reactivation. One-time setup.',
    hero: "Physio patients in pain can't afford to wait. ClinicFlow texts missed callers within 60 seconds so they book immediately.",
    searches: ['physio clinic software Canada', 'physiotherapy automation', 'automate physio clinic', 'physio patient communication Canada', 'physiotherapy booking software'],
    pain: ['Missed calls between treatment sessions', 'Patients choosing competitors', 'No after-hours coverage', 'Manual booking follow-up', 'High no-show rates'],
    fix: ['Auto-text every missed caller in 60 seconds', 'Book appointments via SMS automatically', 'Reduce no-shows with automated reminders', 'Reactivate inactive patients monthly', 'Weekly digest of recovered patients'],
    stat: '6-8', statLabel: 'patients recovered per month on average',
  },
  {
    slug: 'salon',
    name: 'Salons & Spas',
    title: 'Salon & Spa Automation Software Canada — ClinicFlow',
    metaDesc: 'Automate client communication for Canadian salons and spas. Missed-call text-back, appointment reminders, client reactivation. One-time setup, no monthly fees.',
    hero: 'When a client calls your salon and no one picks up — they book elsewhere. ClinicFlow texts them within 60 seconds automatically.',
    searches: ['salon automation software Canada', 'spa booking automation Canada', 'automate my salon', 'salon client communication software', 'hair salon software Canada'],
    pain: ['Missed calls while styling clients', 'Clients not rebooking after visits', 'No-shows costing revenue', 'Manual reminder calls taking time', 'Front desk overwhelmed on busy days'],
    fix: ['Auto-text every missed client in 60 seconds', 'Automated rebooking reminders', 'Reduce no-shows with SMS reminders', "Reactivate clients who haven't visited in months", 'Works 24/7 including after hours'],
    stat: '40%', statLabel: 'reduction in no-shows with automated reminders',
  },
  {
    slug: 'restaurant',
    name: 'Restaurants',
    title: 'Restaurant Reservation Automation Canada — ClinicFlow',
    metaDesc: 'Automate reservation communication for Canadian restaurants. Missed-call text-back, booking confirmations, table reminders. One-time setup, no monthly fees.',
    hero: 'When a guest calls to reserve and no one answers — they book at the restaurant next door. ClinicFlow texts them within 60 seconds.',
    searches: ['restaurant reservation automation Canada', 'restaurant booking software Canada', 'automate restaurant reservations', 'restaurant communication software', 'missed call restaurant Canada'],
    pain: ['Missed reservation calls during service', 'No-shows wasting table covers', 'No follow-up for missed reservation calls', 'Staff busy during peak hours', 'Lost walk-in and reservation revenue'],
    fix: ['Auto-text every missed reservation call', 'Confirm reservations via SMS automatically', 'Reduce no-shows with reminder texts', 'Handle reservation changes via SMS', 'Never miss a booking again'],
    stat: '30%', statLabel: 'of restaurant calls go unanswered during service',
  },
  {
    slug: 'gym',
    name: 'Gyms & Fitness Studios',
    title: 'Gym & Fitness Studio Automation Canada — ClinicFlow',
    metaDesc: 'Automate member communication for Canadian gyms and fitness studios. Missed-call text-back, class reminders, member reactivation. One-time setup.',
    hero: 'Prospective members call your gym and no one answers — they sign up at the gym down the street. ClinicFlow fixes that in 60 seconds.',
    searches: ['gym automation software Canada', 'fitness studio software Canada', 'automate gym membership', 'gym member communication Canada', 'fitness studio booking automation'],
    pain: ['Missed calls from prospective members', 'Members cancelling without warning', 'No follow-up for missed trial inquiries', 'Class no-shows', 'Inactive members not returning'],
    fix: ['Auto-text every missed membership inquiry', 'Class reminder texts reduce no-shows', 'Reactivate lapsed members automatically', 'Handle membership questions via SMS', 'Convert more trial inquiries to members'],
    stat: '25%', statLabel: 'of gym inquiries are missed calls',
  },
  {
    slug: 'law',
    name: 'Law Offices',
    title: 'Law Office Automation Software Canada — ClinicFlow',
    metaDesc: 'Automate client communication for Canadian law offices. Missed-call text-back, consultation reminders, client follow-up. One-time setup, no monthly fees.',
    hero: 'A potential client calls your law office and reaches voicemail — they call the next lawyer on Google. ClinicFlow responds within 60 seconds.',
    searches: ['law office automation Canada', 'legal practice software Canada', 'automate law office', 'law firm client communication', 'legal office missed call software'],
    pain: ['Missed calls from potential clients', 'No intake follow-up system', 'Consultation no-shows', 'After-hours inquiry loss', 'Staff overwhelmed with intake calls'],
    fix: ['Auto-text every missed client inquiry', 'Consultation reminders via SMS', 'Handle intake questions automatically', '24/7 after-hours response', 'Never lose a potential client to voicemail'],
    stat: '10%', statLabel: 'higher reply rate for legal cold email vs other industries',
  },
  {
    slug: 'realestate',
    name: 'Real Estate Agents',
    title: 'Real Estate Agent Automation Canada — ClinicFlow',
    metaDesc: 'Automate client communication for Canadian real estate agents. Missed-call text-back, showing reminders, lead follow-up. One-time setup, no monthly fees.',
    hero: 'A buyer calls about a listing and you miss it — they call the next agent. ClinicFlow responds within 60 seconds so you never lose a lead.',
    searches: ['real estate automation Canada', 'realtor software Canada', 'automate real estate leads', 'real estate agent communication software', 'missed call real estate Canada'],
    pain: ['Missed calls from interested buyers', 'Leads going cold overnight', 'No follow-up for missed showing requests', 'Competing agents responding faster', 'Manual lead follow-up taking hours'],
    fix: ['Auto-text every missed buyer inquiry', 'Showing reminder texts reduce no-shows', 'Follow up leads instantly 24/7', 'Capture after-hours inquiries automatically', 'Respond faster than competing agents'],
    stat: '5 min', statLabel: 'response time doubles conversion vs 30 min',
  },
  {
    slug: 'veterinary',
    name: 'Veterinary Clinics',
    title: 'Veterinary Clinic Automation Canada — ClinicFlow',
    metaDesc: 'Automate pet owner communication for Canadian veterinary clinics. Missed-call text-back, appointment reminders, patient reactivation. One-time setup.',
    hero: 'When a worried pet owner calls and no one answers — they find another vet immediately. ClinicFlow texts them within 60 seconds.',
    searches: ['veterinary clinic software Canada', 'vet clinic automation', 'automate veterinary clinic', 'vet patient communication Canada', 'veterinary booking software Canada'],
    pain: ['Missed calls from worried pet owners', 'Emergency calls going to voicemail', 'No follow-up for missed appointments', 'Manual reminder calls', 'Inactive patients not returning for checkups'],
    fix: ['Auto-text every missed call in 60 seconds', 'Handle appointment bookings via SMS', 'Annual checkup reminders automatically', 'Emergency inquiry response 24/7', 'Reactivate patients due for checkups'],
    stat: '65%', statLabel: 'of pet owners switch vets after a bad communication experience',
  },
  {
    slug: 'optometry',
    name: 'Optometry Clinics',
    title: 'Optometry Clinic Software Canada — ClinicFlow',
    metaDesc: 'Automate patient communication for Canadian optometry clinics. Missed-call text-back, eye exam reminders, patient reactivation. One-time setup.',
    hero: 'Patients due for eye exams call to book and reach voicemail — ClinicFlow texts them within 60 seconds so they book with you, not a competitor.',
    searches: ['optometry clinic software Canada', 'eye clinic automation', 'automate optometry practice', 'optometry patient communication', 'eye exam reminder software Canada'],
    pain: ['Missed calls during exams', 'Patients overdue for eye exams not booking', 'No systematic recall system', 'Manual reminder calls', 'Patients going to optical chains instead'],
    fix: ['Auto-text every missed call in 60 seconds', 'Annual exam recall texts automatically', 'Appointment reminders reduce no-shows', 'Handle frame and lens questions via SMS', 'Reactivate patients overdue for exams'],
    stat: '2 years', statLabel: 'average time between eye exams — recall system essential',
  },
  {
    slug: 'chiro',
    name: 'Chiropractic Clinics',
    title: 'Chiropractic Clinic Software Canada — ClinicFlow',
    metaDesc: 'Automate patient communication for Canadian chiropractic clinics. Missed-call text-back, appointment reminders, patient reactivation. One-time setup.',
    hero: 'A patient in pain calls your chiro clinic and reaches voicemail. ClinicFlow texts them within 60 seconds — they book before the pain gets worse.',
    searches: ['chiropractic clinic software Canada', 'chiro automation', 'automate chiropractic practice', 'chiro patient communication Canada', 'chiropractic booking software'],
    pain: ['Missed calls from patients in pain', 'Patients choosing other practitioners', 'Irregular visit patterns hard to manage', 'No follow-up for missed appointments', 'Manual recall system'],
    fix: ['Auto-text every missed call in 60 seconds', 'Maintenance visit reminders automatically', 'Reduce no-shows with SMS reminders', 'Reactivate patients who stopped coming', 'Handle booking changes via SMS'],
    stat: '60%', statLabel: 'of new chiro patients come from online search — first response wins',
  },
];

function buildPage(market) {
  const painItems = market.pain.map(p => `<li class="bad">${p}</li>`).join('');
  const fixItems  = market.fix.map(f => `<li class="good">${f}</li>`).join('');
  const keywords  = market.searches.join(', ');
  const jsonLdDesc = market.metaDesc.replace(/"/g, '\\"');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${market.title}</title>
<meta name="description" content="${market.metaDesc}">
<meta name="keywords" content="${keywords}">
<link rel="canonical" href="https://clinicflowautomation.com/${market.slug}">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Syne:wght@400;600;700;800&display=swap" rel="stylesheet">
<script type="application/ld+json">
{"@context":"https://schema.org","@type":"SoftwareApplication","name":"ClinicFlow Automation","description":"${jsonLdDesc}","url":"https://clinicflowautomation.com/${market.slug}","applicationCategory":"BusinessApplication","offers":{"@type":"Offer","price":"497","priceCurrency":"CAD"},"provider":{"@type":"Organization","name":"ClinicFlow Automation","url":"https://clinicflowautomation.com"}}
</script>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:'Syne',sans-serif;background:#0b0f17;color:#f1f5f9;min-height:100vh}
nav{padding:20px;display:flex;justify-content:space-between;align-items:center;max-width:1000px;margin:0 auto}
nav a{color:#94a3b8;text-decoration:none;font-size:14px}
.logo{font-size:16px;font-weight:700;color:#fff!important}
.hero{padding:80px 20px 60px;text-align:center;max-width:800px;margin:0 auto}
.badge{display:inline-block;background:rgba(124,92,255,.1);color:#7c5cff;padding:6px 16px;border-radius:20px;font-size:12px;font-weight:700;letter-spacing:1px;text-transform:uppercase;margin-bottom:20px;border:1px solid rgba(124,92,255,.2)}
h1{font-size:clamp(28px,5vw,52px);font-weight:800;line-height:1.15;margin-bottom:20px}
h1 span{color:#39d98a}
.sub{font-size:17px;color:#94a3b8;line-height:1.7;max-width:580px;margin:0 auto 40px}
.wrap{max-width:800px;margin:0 auto;padding:0 20px 80px}
.cta-group{display:flex;gap:12px;justify-content:center;flex-wrap:wrap;margin-bottom:60px}
.btn-p{background:#7c5cff;color:#fff;padding:16px 28px;border-radius:12px;font-size:15px;font-weight:700;text-decoration:none}
.btn-s{background:rgba(255,255,255,.06);color:#f1f5f9;padding:16px 28px;border-radius:12px;font-size:15px;font-weight:600;text-decoration:none;border:1px solid rgba(255,255,255,.1)}
.stat-hero{text-align:center;margin-bottom:48px;padding:32px;background:#111827;border-radius:20px;border:1px solid rgba(255,255,255,.06)}
.stat-big{font-size:56px;font-weight:800;color:#f87171;line-height:1;margin-bottom:8px}
.stat-lbl{font-size:16px;color:#94a3b8}
.two-col{display:grid;grid-template-columns:1fr 1fr;gap:24px;margin-bottom:48px}
@media(max-width:600px){.two-col{grid-template-columns:1fr}}
.col-card{background:#111827;border-radius:16px;padding:24px;border:1px solid rgba(255,255,255,.06)}
.col-title{font-size:14px;font-weight:700;text-transform:uppercase;letter-spacing:1px;margin-bottom:16px}
.col-title.red{color:#f87171}.col-title.green{color:#39d98a}
ul{list-style:none;padding:0}
li{display:flex;gap:10px;align-items:flex-start;padding:8px 0;border-bottom:1px solid rgba(255,255,255,.04);font-size:14px;color:#94a3b8;line-height:1.5}
li:last-child{border:none}
li.bad::before{content:'\\2717';color:#f87171;font-weight:700;flex-shrink:0;margin-top:1px}
li.good::before{content:'\\2713';color:#39d98a;font-weight:700;flex-shrink:0;margin-top:1px}
.flow{margin-bottom:48px}
.flow-step{display:flex;gap:16px;align-items:flex-start;padding:16px 0;border-bottom:1px solid rgba(255,255,255,.04)}
.flow-num{width:32px;height:32px;border-radius:50%;background:rgba(124,92,255,.15);color:#7c5cff;font-size:14px;font-weight:700;display:flex;align-items:center;justify-content:center;flex-shrink:0;margin-top:2px}
.flow-text strong{display:block;color:#f1f5f9;margin-bottom:4px;font-size:15px}
.flow-text span{font-size:14px;color:#94a3b8;line-height:1.6}
.faq{margin-bottom:48px}
.faq h3{font-size:16px;font-weight:700;margin-bottom:8px;margin-top:24px;color:#f1f5f9}
.faq p{font-size:14px;color:#94a3b8;line-height:1.8}
.final{background:linear-gradient(135deg,rgba(124,92,255,.1),rgba(57,217,138,.05));border:1px solid rgba(124,92,255,.2);border-radius:20px;padding:40px;text-align:center}
.final h2{font-size:28px;font-weight:800;margin-bottom:12px}
.final p{font-size:15px;color:#94a3b8;margin-bottom:24px;line-height:1.7}
</style>
</head>
<body>
<nav>
  <a href="/" class="logo">ClinicFlow</a>
  <div style="display:flex;gap:20px;flex-wrap:wrap">
    <a href="/calculator">Calculator</a>
    <a href="/pricing">Pricing</a>
    <a href="/live">Live</a>
    <a href="/demo">Demo</a>
  </div>
</nav>
<div class="hero">
  <div class="badge">${market.name} &middot; Canada</div>
  <h1>Automate Your<br><span>${market.name}</span></h1>
  <p class="sub">${market.hero}</p>
  <div class="cta-group">
    <a href="/intake?market=${market.slug}" class="btn-p">Start free 30-day pilot &rarr;</a>
    <a href="https://calendly.com/m-aliben432/clinicflow-15-min-intro" class="btn-s" target="_blank">Book 15-min call</a>
  </div>
</div>
<div class="wrap">
  <div class="stat-hero">
    <div class="stat-big">${market.stat}</div>
    <div class="stat-lbl">${market.statLabel}</div>
  </div>
  <div class="two-col">
    <div class="col-card">
      <div class="col-title red">The problem</div>
      <ul>${painItems}</ul>
    </div>
    <div class="col-card">
      <div class="col-title green">The fix</div>
      <ul>${fixItems}</ul>
    </div>
  </div>
  <div class="flow">
    <h2 style="font-size:24px;font-weight:800;margin-bottom:24px">How it works</h2>
    <div class="flow-step"><div class="flow-num">1</div><div class="flow-text"><strong>Client calls &mdash; no one answers</strong><span>Happens during busy periods, after hours, or when staff is occupied.</span></div></div>
    <div class="flow-step"><div class="flow-num">2</div><div class="flow-text"><strong>Automatic text sent within 60 seconds</strong><span>We missed your call &mdash; reply here to book or ask a question.</span></div></div>
    <div class="flow-step"><div class="flow-num">3</div><div class="flow-text"><strong>Client replies &mdash; AI responds naturally</strong><span>Our system reads your business profile and responds as your staff.</span></div></div>
    <div class="flow-step"><div class="flow-num">4</div><div class="flow-text"><strong>Appointment booked &mdash; appears in your calendar</strong><span>You see the booking. Client gets a reminder. You never knew the call was missed.</span></div></div>
    <div class="flow-step"><div class="flow-num">5</div><div class="flow-text"><strong>Runs itself from this point forward</strong><span>No ongoing work. Every missed call handled automatically 24/7.</span></div></div>
  </div>
  <div class="faq">
    <h2 style="font-size:24px;font-weight:800;margin-bottom:8px">Common questions</h2>
    <h3>Do I need to change my phone system?</h3>
    <p>No. You enable one call forwarding setting on your existing phone &mdash; takes 2 minutes. We walk you through it.</p>
    <h3>Is ClinicFlow available across Canada?</h3>
    <p>Yes &mdash; all provinces. English and French supported.</p>
    <h3>How much does it cost?</h3>
    <p>$997 one-time. $500 now, $497 after you see results. No monthly fees ever. 30-day guarantee.</p>
    <h3>How long does setup take?</h3>
    <p>5 days. We handle everything &mdash; you just provide your business information.</p>
    <h3>What if it doesn&apos;t work?</h3>
    <p>If you don&apos;t recover at least 3 missed clients in 30 days, you don&apos;t pay the second half. No risk.</p>
  </div>
  <div class="final">
    <h2>Ready to stop losing clients to voicemail?</h2>
    <p>One free pilot spot open this week.<br>Full setup at no cost. You only pay if it works.</p>
    <a href="/intake?market=${market.slug}" class="btn-p" style="display:inline-block;margin-bottom:12px">Start free pilot &rarr;</a><br>
    <a href="https://calendly.com/m-aliben432/clinicflow-15-min-intro" target="_blank" class="btn-s" style="display:inline-block;margin-bottom:12px">Book a 15-min call</a><br>
    <a href="/demo" class="btn-s" style="display:inline-block">Try the demo &rarr;</a>
  </div>
</div>
<script>(function(){fetch('/api/track',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({page:window.location.pathname,ref:document.referrer,ts:Date.now()}),keepalive:true}).catch(function(){});})();</script>
</body>
</html>`;
}

let built = 0;
for (const market of markets) {
  const html = buildPage(market);
  fs.writeFileSync(`public/netlify-deploy/${market.slug}.html`, html);
  fs.copyFileSync(`public/netlify-deploy/${market.slug}.html`, `public/${market.slug}.html`);
  built++;
  console.log(`✓ ${market.slug}.html (${Math.round(html.length / 1024)}KB)`);
}

// Sitemap
let sitemap = fs.readFileSync('public/netlify-deploy/sitemap.xml', 'utf8');
for (const m of markets) {
  if (!sitemap.includes(`/${m.slug}<`)) {
    sitemap = sitemap.replace('</urlset>',
      `  <url><loc>https://clinicflowautomation.com/${m.slug}</loc><changefreq>monthly</changefreq><priority>0.9</priority></url>\n</urlset>`
    );
  }
}
fs.writeFileSync('public/netlify-deploy/sitemap.xml', sitemap);
fs.copyFileSync('public/netlify-deploy/sitemap.xml', 'public/sitemap.xml');

// _redirects
let redirects = fs.readFileSync('public/netlify-deploy/_redirects', 'utf8');
const newRoutes = markets
  .filter(m => !redirects.includes(`/${m.slug} `))
  .map(m => `/${m.slug}  /${m.slug}.html  200`)
  .join('\n');
if (newRoutes) {
  redirects = newRoutes + '\n' + redirects;
  fs.writeFileSync('public/netlify-deploy/_redirects', redirects);
}

console.log(`\n✓ ${built} pages built`);
console.log('✓ Sitemap + _redirects updated\n');
console.log('Search terms covered:');
for (const m of markets) console.log(`  /${m.slug}: ${m.searches[0]}`);
