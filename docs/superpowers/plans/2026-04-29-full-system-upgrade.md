# Full System Upgrade Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** PM2 fix + SEO landing page + LinkedIn drafts + reactivation sequence + referral page + case study generator + morning brief + OG/SEO meta + unsubscribe page + Netlify deploy.

**Architecture:** Eight independent deliverables sharing the existing Node/Netlify/nodemailer stack. HTML files land in `public/netlify-deploy/`. Logic files land in `src/cli/` or `src/services/`. No new dependencies.

**Tech Stack:** Node.js ESM, nodemailer (SMTP), Netlify Functions, vanilla HTML/CSS matching existing site palette (`--blue: #1a6bbd`, `--accent: #0fa86e`, `--text: #1a2332`).

---

## File Map

| Action | Path |
|--------|------|
| Create | `public/netlify-deploy/missed-call-dental-canada.html` |
| Modify | `public/netlify-deploy/_redirects` |
| Create | `data/linkedin/posts.md` |
| Modify | `src/services/emailPersonalizer.js` (add REACT1/2/3 variants) |
| Modify | `src/cli/sendBatch.js` (add reactivation batch) |
| Create | `public/netlify-deploy/referral.html` |
| Create | `public/netlify-deploy/netlify/functions/referral-signup.js` |
| Create | `src/cli/generateCaseStudy.js` |
| Modify | `package.json` (add case:study + brief:send scripts) |
| Create | `src/cli/sendMorningBrief.js` |
| Modify | `src/scheduler.js` (add 7:15am brief job) |
| Modify | `public/netlify-deploy/index.html` (OG + JSON-LD + canonical + robots) |
| Create | `public/netlify-deploy/unsubscribe.html` |
| Modify | `src/services/replyHandler.js` (include unsubscribe URL in reply) |

---

### Task 0: PM2 Fix (URGENT)

- [ ] Run: `pm2 start src/scheduler.js --name clinicflow-scheduler`
- [ ] Run: `pm2 save`
- [ ] Run: `pm2 list` and confirm `clinicflow-scheduler` shows `online`

---

### Task 1: SEO Landing Page

**Files:**
- Create: `public/netlify-deploy/missed-call-dental-canada.html`
- Modify: `public/netlify-deploy/_redirects`

- [ ] Create `public/netlify-deploy/missed-call-dental-canada.html`:

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>Missed Call Follow-Up for Canadian Dental Clinics | ClinicFlow</title>
  <meta name="description" content="Automated missed call recovery for dental clinics across Canada. Setup in 5 days, no monthly fees. 98% of Canadian dental clinics have no automated follow-up."/>
  <meta name="robots" content="index, follow"/>
  <link rel="canonical" href="https://clinicflowautomation.com/missed-call-dental-canada"/>
  <meta property="og:title" content="Missed Call Follow-Up for Canadian Dental Clinics | ClinicFlow"/>
  <meta property="og:description" content="Automated missed call recovery for dental clinics. Setup in 5 days, no monthly fees."/>
  <meta property="og:url" content="https://clinicflowautomation.com/missed-call-dental-canada"/>
  <meta property="og:type" content="article"/>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    :root { --blue: #1a6bbd; --blue-dark: #114f93; --accent: #0fa86e; --text: #1a2332; --muted: #5a6a80; --border: #d0dcea; --bg: #f7fafd; --white: #ffffff; --radius: 10px; }
    body { font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif; color: var(--text); background: var(--white); line-height: 1.6; font-size: 16px; }
    .wrap { max-width: 860px; margin: 0 auto; padding: 0 20px; }
    nav { background: var(--white); border-bottom: 1px solid var(--border); padding: 14px 0; }
    nav .inner { display: flex; align-items: center; justify-content: space-between; max-width: 860px; margin: 0 auto; padding: 0 20px; }
    .brand { font-weight: 800; font-size: 17px; color: var(--blue-dark); text-decoration: none; }
    .brand span { color: var(--accent); }
    .hero { background: linear-gradient(160deg,#f0f6ff 0%,#e4f0fb 50%,#f7fafd 100%); padding: 72px 0 56px; text-align: center; }
    h1 { font-size: clamp(24px,4.5vw,42px); font-weight: 900; line-height: 1.12; letter-spacing: -.5px; max-width: 740px; margin: 0 auto 20px; }
    h1 em { color: var(--blue); font-style: normal; }
    .sub { font-size: 18px; color: var(--muted); max-width: 540px; margin: 0 auto 32px; }
    .btn { background: var(--blue); color: #fff; padding: 14px 30px; border-radius: var(--radius); font-weight: 800; font-size: 15px; text-decoration: none; display: inline-block; margin: 4px; transition: background .15s; }
    .btn:hover { background: var(--blue-dark); }
    .btn-ghost { background: transparent; color: var(--blue); border: 2px solid var(--blue); }
    .btn-ghost:hover { background: var(--blue-light, #e8f1fb); }
    section { padding: 64px 0; }
    section:nth-child(even) { background: var(--bg); }
    h2 { font-size: clamp(20px,3.5vw,32px); font-weight: 800; margin-bottom: 14px; letter-spacing: -.3px; }
    h2 em { color: var(--blue); font-style: normal; }
    .lead { font-size: 17px; color: var(--muted); margin-bottom: 28px; max-width: 620px; }
    .stat-row { display: flex; flex-wrap: wrap; gap: 20px; margin: 32px 0; justify-content: center; }
    .stat-box { background: var(--white); border: 1px solid var(--border); border-radius: 14px; padding: 28px 36px; text-align: center; min-width: 180px; flex: 1; box-shadow: 0 2px 8px rgba(0,0,0,.04); }
    .stat-box .num { font-size: 42px; font-weight: 900; color: var(--blue); line-height: 1; }
    .stat-box .label { font-size: 13px; color: var(--muted); margin-top: 6px; }
    .steps { display: flex; flex-direction: column; gap: 20px; margin-top: 32px; }
    .step { display: flex; gap: 18px; align-items: flex-start; }
    .step-num { background: var(--blue); color: #fff; width: 38px; height: 38px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-weight: 900; font-size: 16px; flex-shrink: 0; margin-top: 2px; }
    .step-body h3 { font-weight: 700; margin-bottom: 4px; }
    .step-body p { color: var(--muted); }
    .includes { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 16px; margin-top: 28px; }
    .include-card { background: var(--white); border: 1px solid var(--border); border-radius: var(--radius); padding: 20px 22px; }
    .include-card h3 { font-weight: 700; margin-bottom: 6px; font-size: 15px; }
    .include-card p { color: var(--muted); font-size: 14px; }
    .pricing-tiers { display: flex; flex-wrap: wrap; gap: 20px; margin-top: 28px; justify-content: center; }
    .tier { border: 2px solid var(--border); border-radius: 14px; padding: 28px 24px; flex: 1; min-width: 200px; max-width: 260px; text-align: center; }
    .tier.highlight { border-color: var(--blue); background: #f0f6ff; }
    .tier .price { font-size: 36px; font-weight: 900; color: var(--blue); }
    .tier .price-label { font-size: 12px; color: var(--muted); margin-top: 2px; }
    .tier h3 { font-weight: 700; margin-bottom: 10px; }
    .tier ul { list-style: none; text-align: left; font-size: 14px; color: var(--muted); margin-top: 12px; }
    .tier ul li { padding: 4px 0; padding-left: 18px; position: relative; }
    .tier ul li::before { content: "✓"; position: absolute; left: 0; color: var(--accent); font-weight: 700; }
    .faq { margin-top: 28px; }
    .faq-item { border-bottom: 1px solid var(--border); padding: 18px 0; }
    .faq-item h3 { font-weight: 700; margin-bottom: 8px; font-size: 16px; }
    .faq-item p { color: var(--muted); }
    .cta-section { background: linear-gradient(135deg, var(--blue-dark) 0%, var(--blue) 100%); color: #fff; text-align: center; padding: 72px 0; }
    .cta-section h2 { color: #fff; }
    .cta-section p { color: rgba(255,255,255,.8); margin-bottom: 28px; font-size: 17px; }
    .btn-white { background: #fff; color: var(--blue-dark); }
    .btn-white:hover { background: #e8f1fb; color: var(--blue-dark); }
    footer { background: var(--text); color: rgba(255,255,255,.6); text-align: center; padding: 28px; font-size: 13px; }
    footer a { color: rgba(255,255,255,.7); text-decoration: none; margin: 0 8px; }
  </style>
</head>
<body>

<nav>
  <div class="inner">
    <a class="brand" href="/">Clinic<span>Flow</span></a>
    <a class="btn" href="/calculator" style="font-size:13px;padding:9px 18px;">See your revenue gap →</a>
  </div>
</nav>

<div class="hero">
  <div class="wrap">
    <p style="font-size:13px;font-weight:600;color:var(--blue);margin-bottom:14px;letter-spacing:.5px;text-transform:uppercase;">Dental Clinic Automation · Canada</p>
    <h1>Your dental clinic is <em>losing patients</em> to missed calls. Here's the fix.</h1>
    <p class="sub">98% of Canadian dental clinics have no automated follow-up when a call goes unanswered. Every missed call is a patient choosing your competitor.</p>
    <div>
      <a class="btn" href="/calculator">Calculate your revenue gap</a>
      <a class="btn btn-ghost" href="/quiz">Free missed call audit</a>
    </div>
  </div>
</div>

<section>
  <div class="wrap">
    <h2>The problem: <em>missed calls cost more than you think</em></h2>
    <p class="lead">We scanned Google reviews from 400+ Canadian dental clinics. The data is clear: unanswered calls and no-callback systems are the #1 patient complaint — and most clinics have no idea it's happening.</p>
    <div class="stat-row">
      <div class="stat-box"><div class="num">98%</div><div class="label">of Canadian dental clinics have no automated missed call follow-up</div></div>
      <div class="stat-box"><div class="num">8–12</div><div class="label">calls go unanswered per day at the average dental clinic</div></div>
      <div class="stat-box"><div class="num">$2,800+</div><div class="label">in patient value lost per week to unrecovered missed calls</div></div>
      <div class="stat-box"><div class="num">60 sec</div><div class="label">our system responds after a missed call — before they call your competitor</div></div>
    </div>
  </div>
</section>

<section>
  <div class="wrap">
    <h2>How it works — <em>3 steps, done in 5 days</em></h2>
    <p class="lead">No software to learn. No monthly subscription. We build it, you approve it, it runs automatically.</p>
    <div class="steps">
      <div class="step"><div class="step-num">1</div><div class="step-body"><h3>Call goes unanswered</h3><p>A patient calls your clinic during a busy period, lunch, or after hours. Nobody picks up.</p></div></div>
      <div class="step"><div class="step-num">2</div><div class="step-body"><h3>Patient gets an automatic text within 60 seconds</h3><p>"Hi, we saw your call — we're with a patient right now. Want to book online? [link] Or we'll call you back shortly." Sent automatically, every time.</p></div></div>
      <div class="step"><div class="step-num">3</div><div class="step-body"><h3>Patient books or you call back a warm lead</h3><p>They click the link and book — or they reply and your front desk has a warm lead waiting. Either way, the patient isn't calling your competitor.</p></div></div>
    </div>
  </div>
</section>

<section>
  <div class="wrap">
    <h2>What's included</h2>
    <p class="lead">One setup, three systems working for your clinic 24/7.</p>
    <div class="includes">
      <div class="include-card"><h3>📞 Missed Call Recovery</h3><p>Automatic SMS to every missed caller within 60 seconds. Includes booking link. Works after hours too.</p></div>
      <div class="include-card"><h3>📅 Appointment Reminders</h3><p>Automated text reminders 48h and 2h before each appointment. Reduces no-shows by up to 40%.</p></div>
      <div class="include-card"><h3>💤 Patient Reactivation</h3><p>We find your inactive patients (18+ months since last visit) and send a personalized re-engagement sequence.</p></div>
      <div class="include-card"><h3>📊 Monthly Report</h3><p>See calls recovered, appointments saved, and revenue recaptured. Know exactly what the system is doing for you.</p></div>
    </div>
  </div>
</section>

<section>
  <div class="wrap">
    <h2>Pricing — <em>split payment, no monthly fee</em></h2>
    <p class="lead">Pay half to start, half on completion. No recurring fees. No contracts.</p>
    <div class="pricing-tiers">
      <div class="tier">
        <h3>Starter</h3>
        <div class="price">$397</div>
        <div class="price-label">one-time · split payment</div>
        <ul>
          <li>Missed call SMS recovery</li>
          <li>Appointment reminders</li>
          <li>30-day setup support</li>
          <li>Up to 500 patients/mo</li>
        </ul>
      </div>
      <div class="tier highlight">
        <h3>Growth ⭐</h3>
        <div class="price">$997</div>
        <div class="price-label">one-time · split payment</div>
        <ul>
          <li>Everything in Starter</li>
          <li>Patient reactivation campaign</li>
          <li>Monthly performance reports</li>
          <li>Up to 2,000 patients/mo</li>
        </ul>
      </div>
      <div class="tier">
        <h3>Premium</h3>
        <div class="price">$2,497</div>
        <div class="price-label">one-time · split payment</div>
        <ul>
          <li>Everything in Growth</li>
          <li>Custom recall sequences</li>
          <li>Dedicated 90-day support</li>
          <li>Unlimited patients</li>
        </ul>
      </div>
    </div>
  </div>
</section>

<section>
  <div class="wrap">
    <h2>Frequently asked questions</h2>
    <div class="faq">
      <div class="faq-item">
        <h3>How long does setup take?</h3>
        <p>5 business days from payment to live system. We handle everything — you approve the messages before anything goes live.</p>
      </div>
      <div class="faq-item">
        <h3>Do I need to change my phone system?</h3>
        <p>No. We work with your existing number. No new hardware, no IT involvement.</p>
      </div>
      <div class="faq-item">
        <h3>What if a patient opts out of texts?</h3>
        <p>Every message includes a one-click opt-out. Opt-outs are permanent and automatically respected.</p>
      </div>
      <div class="faq-item">
        <h3>Is this PIPEDA compliant?</h3>
        <p>Yes. All data is stored on Canadian servers. We include a compliant consent flow in the setup.</p>
      </div>
      <div class="faq-item">
        <h3>What's your refund policy?</h3>
        <p>If the system isn't live and working within 10 business days of your first payment, you get a full refund — no questions.</p>
      </div>
    </div>
  </div>
</section>

<div class="cta-section">
  <div class="wrap">
    <h2>Find out what your clinic is losing</h2>
    <p>Enter 4 numbers. See your annual revenue gap from missed calls. Takes 30 seconds.</p>
    <a class="btn btn-white" href="/calculator">Open the calculator →</a>
    <span style="display:inline-block;width:14px;"></span>
    <a class="btn" href="/quiz" style="background:rgba(255,255,255,.15);border:2px solid rgba(255,255,255,.4);">Book free audit</a>
  </div>
</div>

<footer>
  <p>ClinicFlow Automation · Montreal, QC · Canada · <a href="mailto:contact@clinicflowautomation.com">contact@clinicflowautomation.com</a></p>
  <p style="margin-top:8px;"><a href="/">Home</a><a href="/calculator">Calculator</a><a href="/quiz">Audit</a><a href="/privacy-policy">Privacy</a><a href="/unsubscribe">Unsubscribe</a></p>
</footer>

</body>
</html>
```

- [ ] Append to `public/netlify-deploy/_redirects`:
```
/blog  /missed-call-dental-canada  302
```

---

### Task 2: LinkedIn Post Drafts

**Files:**
- Create: `data/linkedin/posts.md`

- [ ] Create `data/linkedin/posts.md` with the 5 posts exactly as specified in task.md.

---

### Task 3: Reactivation Sequence

**Files:**
- Modify: `src/services/emailPersonalizer.js` (export `buildReactivationBody`)
- Modify: `src/cli/sendBatch.js` (add `runReactivationBatch` before main send)

- [ ] Add to end of `src/services/emailPersonalizer.js`:

```js
export function buildReactivationBody({ clinicName, city, senderName = "Mohamed", senderEmail = "" }) {
  const name = clinicName || "your clinic";
  const cityRef = city ? `in ${city}` : "";
  const sign = `${senderName}\nClinicFlow Automation · Montreal, QC · Canada`;

  const idx = Math.floor(Math.random() * 3);
  if (idx === 0) {
    return {
      subject: `Checking back in — ${name}`.slice(0, 60),
      body: `Hi,\n\nReached out a few months ago about unanswered calls at ${name}.\n\nTiming may be better now — happy to take a fresh look if useful.\n\n${sign}`,
      variantLabel: "REACT1",
    };
  }
  if (idx === 1) {
    return {
      subject: `Something new for ${name}`.slice(0, 60),
      body: `Hi,\n\nBuilt a calculator showing exactly what missed calls cost dental clinics ${cityRef}.\n\nThe number is usually surprising.\n\nclinicflowautomation.com/calculator — takes 30 seconds.\n\n${sign}`,
      variantLabel: "REACT2",
    };
  }
  return {
    subject: `Still relevant? — ${name}`.slice(0, 60),
    body: `Hi,\n\nChecking if the timing is better now for ${name}.\n\nI look at communication gaps for dental clinics — takes 10 minutes, no obligation.\n\n${sign}`,
    variantLabel: "REACT3",
  };
}
```

- [ ] In `src/cli/sendBatch.js`, import `buildReactivationBody` alongside existing import:
```js
import { buildPersonalizedBody, isNamedEmail } from "../services/emailPersonalizer.js";
```
becomes:
```js
import { buildPersonalizedBody, buildReactivationBody, isNamedEmail } from "../services/emailPersonalizer.js";
```

- [ ] In `src/cli/sendBatch.js`, add `runReactivationBatch()` function before `main()`:

```js
async function runReactivationBatch(leads, transporter) {
  const SIXTY_DAYS_MS = 60 * 24 * 60 * 60 * 1000;
  const now = Date.now();
  const candidates = leads
    .map((l, idx) => ({ l, idx }))
    .filter(({ l }) => {
      if (l.status !== "cooling_off") return false;
      if (!l.email || isBadEmail(l.email, { smtpFrom: SMTP_FROM })) return false;
      const cooledAt = l.cooledOffAt ? new Date(l.cooledOffAt).getTime() : 0;
      return now - cooledAt >= SIXTY_DAYS_MS;
    });

  if (candidates.length === 0) {
    appendLog("Reactivation: no cooling_off clinics ready (< 60 days)");
    return;
  }

  const batch = candidates.slice(0, 5); // max 5 reactivations per run
  appendLog(`Reactivation: ${batch.length} clinic(s) eligible`);

  for (const { l, idx } of batch) {
    const { subject, body, variantLabel } = buildReactivationBody({
      clinicName: l.clinicName, city: l.city,
      senderName: (process.env.SENDER_NAME || "Mohamed").trim(),
      senderEmail: SMTP_FROM,
    });
    if (DRY_RUN) {
      console.log(`  [REACTIVATION DRY-RUN] ${l.clinicName} → variant:${variantLabel}`);
      continue;
    }
    try {
      await transporter.sendMail({ from: SMTP_FROM, to: l.email, subject, text: body, html: _toHtml(body), headers: { 'X-Mailer': 'Zoho Mail' } });
      leads[idx].status = "sent";
      leads[idx].sentAt = new Date().toISOString();
      leads[idx].variantLabel = variantLabel;
      leads[idx].followupCount = 0;
      const due = new Date(); due.setDate(due.getDate() + FOLLOWUP_DELAY_DAYS);
      leads[idx].followupDueAt = due.toISOString();
      appendEmailLog({ email: l.email, clinic: l.clinicName, status: "sent", sentAt: leads[idx].sentAt, subject, variantLabel, personalizationLevel: "LOW" });
      console.log(`  ✓ Reactivation sent: ${l.clinicName} (${variantLabel})`);
    } catch (e) {
      console.error(`  ✗ Reactivation failed: ${l.clinicName} — ${e.message}`);
    }
  }
}
```

- [ ] In `main()` of `sendBatch.js`, call `runReactivationBatch` right before the `// ── FILTER 1` block:
```js
// Reactivation pass: re-engage cooling_off clinics after 60 days
await runReactivationBatch(leads, transporter);
```

---

### Task 4: Referral Program Page + Netlify Function

**Files:**
- Create: `public/netlify-deploy/referral.html`
- Create: `public/netlify-deploy/netlify/functions/referral-signup.js`

- [ ] Create `public/netlify-deploy/referral.html` with referral program page matching site styles.

- [ ] Create `public/netlify-deploy/netlify/functions/referral-signup.js`:

```js
import fs from "fs";
import path from "path";

const PARTNERS_PATH = path.join(process.cwd(), "data", "referral-partners.json");
const NOTIFY_PHONE  = "+15149617077";
const TWILIO_SID    = process.env.TWILIO_ACCOUNT_SID;
const TWILIO_TOKEN  = process.env.TWILIO_AUTH_TOKEN;
const TWILIO_FROM   = process.env.TWILIO_PHONE_NUMBER;

export const handler = async (event) => {
  if (event.httpMethod !== "POST") return { statusCode: 405, body: "Method Not Allowed" };

  let body;
  try { body = JSON.parse(event.body || "{}"); } catch { return { statusCode: 400, body: "Bad JSON" }; }

  const { name, email, company, clinicsPerWeek } = body;
  if (!name || !email) return { statusCode: 400, body: JSON.stringify({ error: "name and email required" }) };

  const record = { name, email, company: company || "", clinicsPerWeek: clinicsPerWeek || "", registeredAt: new Date().toISOString() };

  // Save to file
  try {
    const existing = fs.existsSync(PARTNERS_PATH) ? JSON.parse(fs.readFileSync(PARTNERS_PATH, "utf-8")) : [];
    existing.push(record);
    fs.writeFileSync(PARTNERS_PATH, JSON.stringify(existing, null, 2));
  } catch (e) { console.error("Save failed:", e.message); }

  // SMS alert
  if (TWILIO_SID && TWILIO_TOKEN && TWILIO_FROM) {
    try {
      const msg = encodeURIComponent(`New referral partner: ${name} from ${company || "unknown"} (${email})`);
      await fetch(`https://api.twilio.com/2010-04-01/Accounts/${TWILIO_SID}/Messages.json`, {
        method: "POST",
        headers: {
          Authorization: "Basic " + Buffer.from(`${TWILIO_SID}:${TWILIO_TOKEN}`).toString("base64"),
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: `From=${encodeURIComponent(TWILIO_FROM)}&To=${encodeURIComponent(NOTIFY_PHONE)}&Body=${msg}`,
      });
    } catch (e) { console.error("SMS failed:", e.message); }
  }

  return { statusCode: 200, body: JSON.stringify({ ok: true, message: "Registration received — we'll be in touch within 24 hours." }) };
};
```

---

### Task 5: Case Study Generator

**Files:**
- Create: `src/cli/generateCaseStudy.js`
- Modify: `package.json`

- [ ] Create `src/cli/generateCaseStudy.js`:

```js
// Usage: node src/cli/generateCaseStudy.js --client "Museum Dental"
import fs from "fs";
import path from "path";
import dotenv from "dotenv";
dotenv.config();

const ROOT = path.resolve(import.meta.dirname, "../..");
const OUTREACH_PATH = path.join(ROOT, "data", "outreach.localDentists.json");
const OUTPUT_DIR    = path.join(ROOT, "public", "netlify-deploy");

const clientArg = process.argv[process.argv.indexOf("--client") + 1] || "";
if (!clientArg) { console.error("Usage: --client \"Clinic Name\""); process.exit(1); }

const leads  = JSON.parse(fs.readFileSync(OUTREACH_PATH, "utf-8"));
const record = leads.find(l => (l.clinicName || "").toLowerCase().includes(clientArg.toLowerCase()));

if (!record) { console.error(`Clinic not found: ${clientArg}`); process.exit(1); }

const name   = record.clinicName;
const city   = record.city || "Canada";
const slug   = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const outHtml = path.join(OUTPUT_DIR, `case-study-${slug}.html`);

const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>Case Study: ${name} | ClinicFlow Automation</title>
  <meta name="description" content="How ${name} in ${city} recovered inactive patients and stopped losing calls with ClinicFlow Automation."/>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    :root { --blue: #1a6bbd; --blue-dark: #114f93; --accent: #0fa86e; --text: #1a2332; --muted: #5a6a80; --border: #d0dcea; --white: #ffffff; --radius: 10px; }
    body { font-family: ui-sans-serif, system-ui, -apple-system, Arial, sans-serif; color: var(--text); background: var(--white); line-height: 1.7; font-size: 16px; }
    .wrap { max-width: 760px; margin: 0 auto; padding: 0 20px; }
    nav { border-bottom: 1px solid var(--border); padding: 14px 0; }
    nav .inner { display: flex; align-items: center; justify-content: space-between; max-width: 760px; margin: 0 auto; padding: 0 20px; }
    .brand { font-weight: 800; color: var(--blue-dark); text-decoration: none; font-size: 17px; }
    .brand span { color: var(--accent); }
    .hero { padding: 60px 0 40px; }
    .tag { font-size: 12px; font-weight: 700; color: var(--accent); letter-spacing: .8px; text-transform: uppercase; margin-bottom: 16px; }
    h1 { font-size: clamp(22px, 4vw, 36px); font-weight: 900; line-height: 1.15; margin-bottom: 16px; letter-spacing: -.3px; }
    .meta { font-size: 14px; color: var(--muted); margin-bottom: 40px; }
    .results { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 16px; margin: 32px 0; }
    .result-box { border: 2px solid var(--border); border-radius: var(--radius); padding: 22px; text-align: center; }
    .result-box .num { font-size: 36px; font-weight: 900; color: var(--blue); }
    .result-box .lbl { font-size: 13px; color: var(--muted); margin-top: 4px; }
    h2 { font-size: 22px; font-weight: 800; margin: 40px 0 12px; }
    p { margin-bottom: 16px; color: var(--text); }
    blockquote { border-left: 4px solid var(--accent); margin: 28px 0; padding: 16px 20px; background: #f0f9f5; border-radius: 0 var(--radius) var(--radius) 0; font-style: italic; font-size: 17px; }
    .cta { background: linear-gradient(135deg, var(--blue-dark), var(--blue)); color: #fff; border-radius: 14px; padding: 40px 32px; text-align: center; margin: 48px 0; }
    .cta h2 { color: #fff; margin-top: 0; }
    .cta p { color: rgba(255,255,255,.8); }
    .btn { background: #fff; color: var(--blue-dark); padding: 13px 28px; border-radius: var(--radius); font-weight: 800; text-decoration: none; display: inline-block; margin-top: 12px; }
  </style>
</head>
<body>
<nav><div class="inner"><a class="brand" href="/">Clinic<span>Flow</span></a></div></nav>
<div class="wrap">
  <div class="hero">
    <div class="tag">Case Study · ${city}</div>
    <h1>How ${name} stopped losing patients to missed calls</h1>
    <div class="meta">${city} · 30-day results · ClinicFlow Automation</div>
  </div>

  <div class="results">
    <div class="result-box"><div class="num">[X]</div><div class="lbl">Inactive patients reactivated</div></div>
    <div class="result-box"><div class="num">[X]</div><div class="lbl">Missed calls recovered</div></div>
    <div class="result-box"><div class="num">$[X]</div><div class="lbl">Estimated revenue recovered</div></div>
    <div class="result-box"><div class="num">5 days</div><div class="lbl">Setup time</div></div>
  </div>

  <h2>The problem</h2>
  <p>${name} was losing patients to missed calls every day. Like 98% of Canadian dental clinics, they had no automated follow-up — calls went unanswered and patients moved on to competitors.</p>

  <h2>What we set up</h2>
  <p>In 5 business days, ClinicFlow built three systems:</p>
  <ul style="margin:12px 0 16px 20px;color:var(--muted);">
    <li style="margin-bottom:8px;">Automatic SMS response within 60 seconds of every missed call</li>
    <li style="margin-bottom:8px;">Appointment reminder sequence (48h and 2h before each visit)</li>
    <li>Reactivation campaign for patients inactive 18+ months</li>
  </ul>

  <h2>30-day results</h2>
  <p>[Update with real metrics from client after 30 days — reactivation emails sent, replies received, appointments booked, estimated revenue recovered.]</p>

  <blockquote>"[Placeholder — add real quote from clinic owner once received.]"<br><br><strong>— [Name], ${name}</strong></blockquote>

  <div class="cta">
    <h2>Want the same for your clinic?</h2>
    <p>Find out exactly what you're losing — then we'll set it up in 5 days.</p>
    <a class="btn" href="/calculator">Calculate your revenue gap →</a>
  </div>
</div>
<footer style="text-align:center;padding:24px;font-size:13px;color:var(--muted);border-top:1px solid var(--border);">
  <a href="/" style="color:var(--muted);text-decoration:none;">ClinicFlow Automation</a> · Montreal, QC · Canada
</footer>
</body>
</html>`;

fs.writeFileSync(outHtml, html);
console.log(`Case study saved → ${outHtml}`);

// LinkedIn post
const liPost = `Just published a case study on ${name} in ${city}.\n\nThey were losing [X] patients per week to unanswered calls.\n\n30 days after setup:\n• [X] inactive patients reactivated\n• [X] missed calls recovered\n• $[X] in estimated revenue recovered\n\nSetup time: 5 days. No monthly fee.\n\n→ Full case study: clinicflowautomation.com/case-study-${slug}`;
console.log("\n── LinkedIn post draft ──");
console.log(liPost);
```

- [ ] Add to `package.json` scripts:
```json
"case:study": "node src/cli/generateCaseStudy.js"
```

---

### Task 6: Morning Brief Email

**Files:**
- Create: `src/cli/sendMorningBrief.js`
- Modify: `package.json`
- Modify: `src/scheduler.js`

- [ ] Create `src/cli/sendMorningBrief.js`:

```js
// Sends a daily morning brief to the operator email.
// Usage: node src/cli/sendMorningBrief.js
import fs from "fs";
import path from "path";
import nodemailer from "nodemailer";
import dotenv from "dotenv";
dotenv.config();

const ROOT       = path.resolve(import.meta.dirname, "../..");
const DATA_DIR   = path.join(ROOT, "data");
const TO_EMAIL   = "m.aliben432@gmail.com";
const SMTP_HOST  = process.env.SMTP_HOST;
const SMTP_PORT  = Number(process.env.SMTP_PORT || 465);
const SMTP_USER  = (process.env.SMTP_USER || "").trim();
const SMTP_PASS  = process.env.SMTP_PASS;
const SMTP_FROM  = (process.env.SMTP_FROM || SMTP_USER).trim();

function readJsonSafe(p, fallback) {
  try { return JSON.parse(fs.readFileSync(p, "utf-8")); } catch { return fallback; }
}

function todayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}

async function buildBrief() {
  const today = todayKey();
  const lines = [];

  // 1. Overnight replies
  const draftsDir = path.join(DATA_DIR, "reply-drafts");
  const drafts = fs.existsSync(draftsDir)
    ? fs.readdirSync(draftsDir).filter(f => f.endsWith(".json"))
        .map(f => readJsonSafe(path.join(draftsDir, f), {}))
        .filter(d => !d.handled)
    : [];
  lines.push("── REPLIES RECEIVED (unhandled) ──────────────────");
  if (drafts.length === 0) {
    lines.push("  None — inbox clear.");
  } else {
    drafts.forEach(d => lines.push(`  • ${d.clinicName || "(unknown)"} → ${d.intent || "?"} | subject: ${d.subject || "?"}`));
  }
  lines.push("");

  // 2. Today's send plan
  const dentists = readJsonSafe(path.join(DATA_DIR, "outreach.localDentists.json"), []);
  const sendLog  = readJsonSafe(path.join(DATA_DIR, "smtp.emaillog.json"), []);
  const todaySends = sendLog.filter(e => (e.sentAt || "").startsWith(today));
  const pending = dentists.filter(d => (d.status || "todo") === "todo" && d.emailConfidence === "high" && d.email);
  lines.push("── TODAY'S SENDS ─────────────────────────────────");
  lines.push(`  Sent so far today: ${todaySends.length}`);
  lines.push(`  High-confidence queue (todo): ${pending.length}`);
  todaySends.slice(0, 5).forEach(e => lines.push(`  • ${e.clinic} — variant:${e.variantLabel}`));
  if (todaySends.length > 5) lines.push(`  … and ${todaySends.length - 5} more`);
  lines.push("");

  // 3. Voice drops today
  const drops = readJsonSafe(path.join(DATA_DIR, "calls", "voicemail-drops.json"), []);
  const todayDrops = drops.filter(d => (d.scheduleTime || "").startsWith(today));
  lines.push("── VOICE DROPS TODAY ─────────────────────────────");
  if (todayDrops.length === 0) {
    lines.push("  None scheduled for today.");
  } else {
    todayDrops.forEach(d => lines.push(`  • ${d.clinicName} — ${d.phone} (campaign: ${d.campaignId})`));
  }
  lines.push("");

  // 4. Hot prospects
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const hot = dentists.filter(d => d.sentAt && d.sentAt >= sevenDaysAgo && d.status === "followup_1_sent");
  lines.push("── HOT PROSPECTS (FU1 sent, no reply) ───────────");
  if (hot.length === 0) {
    lines.push("  None.");
  } else {
    hot.slice(0, 8).forEach(d => lines.push(`  • ${d.clinicName} | ${d.email} | sent ${d.sentAt?.slice(0,10)}`));
    if (hot.length > 8) lines.push(`  … and ${hot.length - 8} more`);
  }
  lines.push("");

  // 5. Calculator leads
  const calcLeads = readJsonSafe(path.join(DATA_DIR, "calculator-leads.json"), []);
  lines.push("── CALCULATOR LEADS ──────────────────────────────");
  lines.push(`  Total: ${Array.isArray(calcLeads) ? calcLeads.length : 0}`);
  if (Array.isArray(calcLeads) && calcLeads.length > 0) {
    calcLeads.slice(-3).forEach(l => lines.push(`  • ${l.clinicName || l.name || "?"} | ${l.email || "no email"}`));
  }
  lines.push("");

  // 6. Priority actions
  const fu1Due = dentists.filter(d => d.status === "sent" && d.followupDueAt && new Date(d.followupDueAt) <= new Date());
  lines.push("── ACTION ITEMS ──────────────────────────────────");
  if (fu1Due.length > 0) lines.push(`  • Send FU1 to ${fu1Due.length} clinic(s) due today`);
  if (drafts.length > 0)  lines.push(`  • Handle ${drafts.length} unread reply draft(s)`);
  if (todayDrops.length > 0) lines.push(`  • ${todayDrops.length} voicemail drop(s) fire at 11:30am`);
  if (fu1Due.length === 0 && drafts.length === 0) lines.push("  • Nothing urgent — good morning!");

  return lines.join("\n");
}

async function main() {
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) {
    console.error("SMTP not configured — skipping morning brief");
    process.exit(0);
  }

  const body  = await buildBrief();
  const today = todayKey();
  console.log(`\n── Morning Brief ${today} ──\n${body}`);

  const transporter = nodemailer.createTransport({ host: SMTP_HOST, port: SMTP_PORT, secure: SMTP_PORT === 465, auth: { user: SMTP_USER, pass: SMTP_PASS } });

  await transporter.sendMail({
    from: SMTP_FROM,
    to: TO_EMAIL,
    subject: `ClinicFlow Morning Brief — ${today}`,
    text: body,
  });

  console.log(`Morning brief sent → ${TO_EMAIL}`);
}

main().catch(e => { console.error(e.message); process.exit(1); });
```

- [ ] Add to `package.json` scripts:
```json
"brief:send": "node src/cli/sendMorningBrief.js"
```

- [ ] Add to `src/scheduler.js` before the `// ─── Boot message` line:
```js
// 07:15 — Morning brief email to operator
scheduleDaily(7, 15, "Morning Brief Email", async () => {
  await runScript("src/cli/sendMorningBrief.js");
});
```

---

### Task 7: Website OG + Structured Data

**Files:**
- Modify: `public/netlify-deploy/index.html` (head section)

- [ ] Add after the existing `<meta name="description"...>` tag in `public/netlify-deploy/index.html`:

```html
  <meta name="robots" content="index, follow"/>
  <link rel="canonical" href="https://clinicflowautomation.com"/>
  <meta property="og:title" content="ClinicFlow Automation — Missed Call Recovery for Canadian Dental Clinics"/>
  <meta property="og:description" content="Done-for-you patient communication automation. Setup in 5 days, no monthly fees."/>
  <meta property="og:url" content="https://clinicflowautomation.com"/>
  <meta property="og:type" content="website"/>
  <script type="application/ld+json">
  {
    "@context": "https://schema.org",
    "@type": "LocalBusiness",
    "name": "ClinicFlow Automation",
    "description": "Done-for-you missed call recovery and patient communication automation for Canadian dental clinics.",
    "telephone": "438-544-0442",
    "email": "contact@clinicflowautomation.com",
    "address": { "@type": "PostalAddress", "addressLocality": "Montreal", "addressRegion": "QC", "addressCountry": "CA" },
    "areaServed": "CA",
    "url": "https://clinicflowautomation.com"
  }
  </script>
```

---

### Task 8: Unsubscribe Page + replyHandler Update

**Files:**
- Create: `public/netlify-deploy/unsubscribe.html`
- Modify: `src/services/replyHandler.js`

- [ ] Create `public/netlify-deploy/unsubscribe.html`:

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>Unsubscribed | ClinicFlow</title>
  <meta name="robots" content="noindex"/>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: ui-sans-serif, system-ui, -apple-system, Arial, sans-serif; background: #f7fafd; color: #1a2332; display: flex; min-height: 100vh; align-items: center; justify-content: center; padding: 20px; }
    .card { background: #fff; border: 1px solid #d0dcea; border-radius: 14px; padding: 48px 40px; max-width: 460px; width: 100%; text-align: center; }
    .icon { font-size: 48px; margin-bottom: 20px; }
    h1 { font-size: 24px; font-weight: 800; margin-bottom: 12px; color: #1a2332; }
    p { color: #5a6a80; line-height: 1.6; margin-bottom: 24px; }
    a { color: #1a6bbd; text-decoration: none; font-weight: 600; }
    a:hover { text-decoration: underline; }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">✓</div>
    <h1>You've been removed.</h1>
    <p>You won't hear from us again. Your email has been permanently removed from our list.</p>
    <p>If this was a mistake, email us at <a href="mailto:contact@clinicflowautomation.com">contact@clinicflowautomation.com</a> and we'll sort it out.</p>
    <a href="/">← Back to ClinicFlow</a>
  </div>
</body>
</html>
```

- [ ] In `src/services/replyHandler.js`, find the block that sends the confirmation reply after an unsubscribe (around line 540–565). Add the unsubscribe page URL to the confirmation message body. Locate the draft response for NOT_INTERESTED/unsubscribe intent and append:
```
You can view our unsubscribe confirmation at: https://clinicflowautomation.com/unsubscribe
```

---

### Task 9: Deploy + Final Validation

- [ ] Copy any missing HTML from `public/` to `public/netlify-deploy/` (referral.html, unsubscribe.html, missed-call-dental-canada.html)
- [ ] Run: `npx netlify-cli deploy --dir public/netlify-deploy --prod`
- [ ] Run: `npm run report`
- [ ] Show morning brief preview: `node src/cli/sendMorningBrief.js` with `--preview` or by reading `buildBrief()` output
