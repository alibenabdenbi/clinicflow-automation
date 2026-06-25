// src/services/htmlDeliveryBuilder.js
// Generates beautiful, self-contained branded HTML delivery files for ClinicFlow clients.
// No external dependencies — all CSS and JS is embedded.

import fs from "fs";
import path from "path";
import { parseEmailSections } from "./sequenceConverter.js";

// ─── Design system ────────────────────────────────────────────────────────────

const C = {
  navy:       "#1e3a5f",
  navyDark:   "#132847",
  teal:       "#0d7377",
  tealLight:  "#14a8a8",
  blueLight:  "#e8f2fa",
  bg:         "#ffffff",
  bgAlt:      "#f7f9fc",
  border:     "#e2e8f0",
  text:       "#2d3748",
  textLight:  "#718096",
  textXs:     "#a0aec0",
  success:    "#38a169",
  amber:      "#b7570a",
  amberBg:    "#fff8e6",
};

const FONT = `-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, sans-serif`;

// ─── Utilities ────────────────────────────────────────────────────────────────

function esc(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function encodeCopy(text) {
  // Store raw text for clipboard copy; encodeURIComponent handles newlines
  return encodeURIComponent(String(text ?? ""));
}

function highlightPlaceholders(rawText) {
  return esc(rawText).replace(
    /\[([A-Z][A-Za-z0-9 /]+)\]/g,
    `<mark style="background:${C.amberBg};color:${C.amber};border-radius:3px;padding:1px 5px;font-weight:600;font-size:0.9em;">[$1]</mark>`
  );
}

function sharedCSS() {
  return `
    *,*::before,*::after{box-sizing:border-box}
    html{-webkit-text-size-adjust:100%}
    body{margin:0;padding:0;font-family:${FONT};color:${C.text};background:${C.bg};line-height:1.6}
    h1,h2,h3,h4{margin:0;font-weight:700;line-height:1.25}
    p{margin:0 0 1em}
    a{color:${C.teal}}
    @media print{
      .no-print{display:none!important}
      body{-webkit-print-color-adjust:exact;print-color-adjust:exact}
    }
    @media(max-width:640px){
      .container{padding-left:16px!important;padding-right:16px!important}
    }
  `;
}

function pageHead(title, extraCSS = "") {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="X-UA-Compatible" content="IE=edge">
<title>${esc(title)}</title>
<style>
${sharedCSS()}
${extraCSS}
</style>`;
}

function cfHeader(clientInfo) {
  return `<header style="background:${C.navy};padding:14px 0;position:sticky;top:0;z-index:100" class="no-print">
  <div class="container" style="max-width:960px;margin:0 auto;padding:0 32px;display:flex;align-items:center;justify-content:space-between">
    <span style="font-size:11px;letter-spacing:3px;text-transform:uppercase;color:rgba(255,255,255,0.5);font-weight:600">CLINICFLOW</span>
    <span style="font-size:13px;color:rgba(255,255,255,0.75)">${esc(clientInfo.name)}</span>
  </div>
</header>`;
}

// ─── COVER PAGE ───────────────────────────────────────────────────────────────

const TIER_ITEMS = {
  starter: [
    "Missed Call Recovery (3-email sequence)",
    "Appointment Reminders — 72h + 24h SMS",
    "Monthly Newsletter Template",
    "Patient Tracking Dashboard",
    "Setup Guide — Mailchimp + Gmail",
  ],
  growth: [
    "Missed Call Recovery (3-email sequence)",
    "Appointment Reminders — 72h + 24h SMS",
    "New Patient Welcome (4-email sequence)",
    "Patient Reactivation Campaign (5-email sequence)",
    "Google Review Requests — automated",
    "Monthly Newsletter Template",
    "Patient Tracking Dashboard",
    "Setup Guide — Mailchimp + Gmail",
  ],
  full: [
    "Missed Call Recovery (3-email sequence)",
    "Appointment Reminders — 72h + 24h SMS",
    "New Patient Welcome (4-email sequence)",
    "Patient Reactivation Campaign (5-email sequence)",
    "Google Review Requests — automated",
    "Monthly Newsletter Template",
    "90-Day Patient Journey Map",
    "Brand Voice & Custom Templates",
    "Staff Training Guide",
    "Monthly Reporting Template",
    "Patient Tracking Dashboard",
    "Setup Guide — Mailchimp + Gmail",
  ],
};

export function buildCoverPage(clientInfo, tier) {
  const items = TIER_ITEMS[tier] ?? TIER_ITEMS.growth;
  const tierLabel = tier.toUpperCase();

  return `${pageHead(`ClinicFlow ${tierLabel} — ${clientInfo.name}`, `
    html,body{height:100%;min-height:100vh}
    body{background:${C.navy};display:flex;align-items:center;justify-content:center;min-height:100vh}
    .cover{max-width:640px;width:100%;margin:0 auto;padding:64px 40px;text-align:center;color:#fff}
    .cf-brand{font-size:10px;letter-spacing:4px;text-transform:uppercase;color:rgba(255,255,255,0.4);margin-bottom:52px;display:flex;align-items:center;justify-content:center;gap:12px}
    .cf-brand::before,.cf-brand::after{content:'';display:block;height:1px;width:32px;background:rgba(255,255,255,0.2)}
    .city{font-size:12px;letter-spacing:2px;text-transform:uppercase;color:rgba(255,255,255,0.45);margin-bottom:10px}
    .clinic-name{font-family:Georgia,'Times New Roman',serif;font-size:clamp(26px,5vw,44px);font-weight:400;color:#fff;margin-bottom:20px;line-height:1.2}
    .tier-badge{display:inline-block;border:1px solid rgba(255,255,255,0.2);background:rgba(255,255,255,0.08);color:rgba(255,255,255,0.8);font-size:10px;letter-spacing:3px;text-transform:uppercase;padding:6px 18px;border-radius:100px;margin-bottom:52px}
    .divider{width:40px;height:1px;background:rgba(255,255,255,0.15);margin:0 auto 36px}
    .included-label{font-size:10px;letter-spacing:2px;text-transform:uppercase;color:rgba(255,255,255,0.35);margin-bottom:24px}
    ul.items{list-style:none;margin:0 0 52px;padding:0}
    ul.items li{padding:11px 0;border-bottom:1px solid rgba(255,255,255,0.06);color:rgba(255,255,255,0.8);font-size:14px;display:flex;align-items:center;justify-content:center;gap:10px}
    ul.items li::before{content:'';display:block;width:5px;height:5px;border-radius:50%;background:${C.tealLight};flex-shrink:0}
    .start-btn{display:inline-block;background:#fff;color:${C.navy};padding:14px 36px;border-radius:3px;font-size:14px;font-weight:700;text-decoration:none;letter-spacing:0.3px}
    .contact{margin-top:44px;color:rgba(255,255,255,0.35);font-size:12px;line-height:2}
    .welcome-msg{font-size:13px;color:rgba(255,255,255,0.55);line-height:1.7;max-width:480px;margin:0 auto 40px;font-style:italic}
    .timeline{display:flex;justify-content:center;gap:0;margin:0 auto 52px;max-width:460px}
    .tl-step{flex:1;text-align:center;position:relative}
    .tl-step::after{content:'';position:absolute;top:14px;left:50%;width:100%;height:1px;background:rgba(255,255,255,0.15);z-index:0}
    .tl-step:last-child::after{display:none}
    .tl-dot{width:28px;height:28px;border-radius:50%;background:rgba(255,255,255,0.12);border:1px solid rgba(255,255,255,0.25);margin:0 auto 10px;position:relative;z-index:1;display:flex;align-items:center;justify-content:center}
    .tl-dot.tl-now{background:#14a8a8;border-color:#14a8a8}
    .tl-day{font-size:10px;letter-spacing:1px;text-transform:uppercase;color:rgba(255,255,255,0.35);margin-bottom:3px}
    .tl-label{font-size:11px;color:rgba(255,255,255,0.6);line-height:1.3}
    .direct-email{display:inline-block;margin-top:20px;background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.18);border-radius:4px;padding:10px 20px;font-size:12px;color:rgba(255,255,255,0.7);line-height:1.6}
    .direct-email a{color:rgba(255,255,255,0.9);text-decoration:none;font-weight:600}
    @media print{body{background:${C.navy}!important;color:#fff!important}}
  `)}
</head>
<body>
<div class="cover">
  <div class="cf-brand">CLINICFLOW</div>
  ${clientInfo.city ? `<div class="city">${esc(clientInfo.city)}</div>` : ""}
  <h1 class="clinic-name">${esc(clientInfo.name)}</h1>
  <div class="tier-badge">${esc(tierLabel)} PACKAGE</div>

  <p class="welcome-msg">Welcome to ClinicFlow, ${esc(clientInfo.name)}. I personally reviewed your setup before sending this package — the automations inside are configured for a ${esc(clientInfo.city || "Canadian")} dental clinic, not a generic template.</p>

  <div class="timeline">
    <div class="tl-step">
      <div class="tl-dot tl-now"></div>
      <div class="tl-day">Today</div>
      <div class="tl-label">Receive package</div>
    </div>
    <div class="tl-step">
      <div class="tl-dot"></div>
      <div class="tl-day">Day 5</div>
      <div class="tl-label">Setup complete</div>
    </div>
    <div class="tl-step">
      <div class="tl-dot"></div>
      <div class="tl-day">Day 7</div>
      <div class="tl-label">First check-in</div>
    </div>
  </div>

  <div class="divider"></div>
  <div class="included-label">What&rsquo;s included</div>
  <ul class="items">
    ${items.map(i => `<li>${esc(i)}</li>`).join("\n    ")}
  </ul>
  <a href="delivery-index.html" class="start-btn">Start here &rarr;</a>
  <div style="display:flex;justify-content:center;gap:12px;margin-top:28px;flex-wrap:wrap">
    <div style="background:rgba(255,255,255,0.07);border:1px solid rgba(255,255,255,0.15);border-radius:100px;padding:5px 14px;font-size:11px;color:rgba(255,255,255,0.6);letter-spacing:0.5px">PIPEDA Compliant</div>
    <div style="background:rgba(255,255,255,0.07);border:1px solid rgba(255,255,255,0.15);border-radius:100px;padding:5px 14px;font-size:11px;color:rgba(255,255,255,0.6);letter-spacing:0.5px">30-Day Support Included</div>
    <div style="background:rgba(255,255,255,0.07);border:1px solid rgba(255,255,255,0.15);border-radius:100px;padding:5px 14px;font-size:11px;color:rgba(255,255,255,0.6);letter-spacing:0.5px">Satisfaction Guarantee</div>
  </div>
  <div class="direct-email">
    Questions? Email me directly:<br>
    <a href="mailto:contact@clinicflowautomation.com">contact@clinicflowautomation.com</a> &mdash; I respond within 4 hours on weekdays
  </div>
  <div class="contact">
    Mohamed &mdash; ClinicFlow Automation &middot; Montreal, QC &middot; Canadian-built
  </div>
</div>
</body>
</html>`;
}

// ─── DELIVERY INDEX ───────────────────────────────────────────────────────────

export function buildDeliveryIndex(clientInfo, tier) {
  const isGrowthPlus = tier === "growth" || tier === "full";

  const sections = [
    {
      label: "Start Here",
      color: C.navy,
      files: [
        { name: "cover.html",               desc: "Your package overview — print as PDF" },
        { name: "certificate.html",          desc: "Certificate of setup delivery — print for records" },
        { name: "setup-guide.html",          desc: "Interactive step-by-step setup guide" },
        { name: "results-projection.html",   desc: "Revenue impact calculator" },
      ],
    },
    {
      label: "Email Sequences",
      color: C.teal,
      files: [
        { name: "missed-call-followup.html",  desc: "3-email missed call recovery — copy and import" },
        { name: "appointment-reminder.html",  desc: "72h + 24h SMS reminder templates" },
        ...(isGrowthPlus ? [
          { name: "new-patient-welcome.html",   desc: "4-email new patient welcome sequence" },
          { name: "reactivation-campaign.html", desc: "5-email dormant patient reactivation" },
          { name: "review-request.html",        desc: "Google review request — 2-email sequence" },
        ] : []),
        { name: "monthly-newsletter.html",    desc: "Monthly newsletter template with seasonal tips" },
      ],
    },
    {
      label: "Supporting Files",
      color: C.textLight,
      files: [
        { name: "setup-summary.md",           desc: "Full automation summary — print for your records" },
        { name: "tracking-spreadsheet.md",    desc: "Google Sheets tracker setup instructions" },
        { name: "verification-report.md",     desc: "Quality report — all checks passed" },
      ],
    },
    {
      label: "Ready-to-Import",
      color: C.textLight,
      files: [
        { name: "ready-to-import/",           desc: "Mailchimp JSON + HTML + EML files for each sequence" },
      ],
    },
  ];

  const sectionHTML = sections.map(s => `
  <section style="margin-bottom:40px">
    <h2 style="font-size:11px;letter-spacing:2px;text-transform:uppercase;color:${s.color};margin-bottom:16px;font-weight:700">${esc(s.label)}</h2>
    <div style="display:grid;gap:8px">
      ${s.files.map(f => `
      <a href="${esc(f.name)}" style="display:flex;align-items:center;padding:14px 18px;border:1px solid ${C.border};border-radius:6px;text-decoration:none;background:${C.bg};gap:16px;transition:border-color 0.15s" onmouseover="this.style.borderColor='${C.teal}'" onmouseout="this.style.borderColor='${C.border}'">
        <div style="width:8px;height:8px;border-radius:50%;background:${s.color};flex-shrink:0"></div>
        <div>
          <div style="font-size:14px;font-weight:600;color:${C.text}">${esc(f.name)}</div>
          <div style="font-size:12px;color:${C.textLight};margin-top:2px">${esc(f.desc)}</div>
        </div>
        <span style="margin-left:auto;color:${C.textXs};font-size:18px">&rarr;</span>
      </a>`).join("")}
    </div>
  </section>`).join("");

  return `${pageHead(`Delivery — ${clientInfo.name}`, `
    body{background:${C.bgAlt}}
    .container{max-width:700px;margin:0 auto;padding:40px 32px}
  `)}
</head>
<body>
${cfHeader(clientInfo)}
<div class="container">
  <div style="margin-bottom:40px;padding-bottom:32px;border-bottom:1px solid ${C.border}">
    <div style="font-size:11px;letter-spacing:2px;text-transform:uppercase;color:${C.textXs};margin-bottom:8px">CLINICFLOW ${esc(tier.toUpperCase())} PACKAGE</div>
    <h1 style="font-size:28px;color:${C.navy};margin-bottom:6px">${esc(clientInfo.name)}</h1>
    <p style="color:${C.textLight};margin:0">${esc(clientInfo.city ?? "")} &mdash; All files are ready to use. Start with <strong>setup-guide.html</strong>.</p>
  </div>
  ${sectionHTML}
  <div style="margin-top:48px;padding-top:24px;border-top:1px solid ${C.border};text-align:center;color:${C.textXs};font-size:12px">
    Questions? Mohamed &middot; contact@clinicflowautomation.com &middot; clinicflowautomation.com
  </div>
</div>
</body>
</html>`;
}

// ─── SETUP GUIDE ─────────────────────────────────────────────────────────────

function getSteps(tier, clientName) {
  const base = [
    {
      title: "Create Your Mailchimp Account",
      who: "Office Manager", time: "5 min",
      screenshot: "mailchimp.com homepage → large blue 'Sign Up Free' button, top right",
      steps: [
        `Go to <strong>mailchimp.com</strong> and click <em>Sign Up Free</em>`,
        `Use your clinic email as the account email`,
        `Enter <strong>${esc(clientName)}</strong> as your organization name`,
        `Select the <strong>Free plan</strong> — supports 500 contacts and 1,000 emails/month`,
        `Check your inbox and click the verification link`,
      ],
      tip: "No credit card required. The free plan is enough to start all your automations.",
    },
    {
      title: "Import Your Patient List",
      who: "Office Manager", time: "10 min",
      screenshot: "Mailchimp → Audience (left sidebar) → Add contacts → Import contacts → Upload a CSV",
      steps: [
        "Export your patient list from your practice management software (ask your vendor if unsure how)",
        "Your export should include: <strong>First Name, Last Name, Email, Last Visit Date</strong>",
        "In Mailchimp: click <strong>Audience</strong> &rarr; <strong>Add contacts</strong> &rarr; <strong>Import contacts</strong>",
        "Upload your CSV file and map the columns when prompted",
        "Click <strong>Import</strong> — Mailchimp will confirm how many contacts were added",
      ],
      tip: "Re-import monthly to keep your list current. Mailchimp handles duplicates automatically.",
    },
    {
      title: "Set Up Missed Call Recovery",
      who: "Office Manager", time: "30 min",
      screenshot: "Mailchimp → Automations → Create → Classic Automations → Welcome new subscribers",
      steps: [
        "In Mailchimp: <strong>Automations &rarr; Create &rarr; Classic Automations</strong>",
        `Rename it: <strong>Missed Call Recovery &mdash; ${esc(clientName)}</strong>`,
        "Click <em>Edit trigger</em> &rarr; change to <strong>API / Zapier</strong>",
        "Add <strong>Email 1</strong>: delay = Immediately &rarr; paste from <a href='missed-call-followup.html'>missed-call-followup.html</a>, Email 1",
        "Add <strong>Email 2</strong>: delay = 2 hours &rarr; paste Email 2 content",
        "Add <strong>Email 3</strong>: delay = 1 day &rarr; paste Email 3 content",
        "Click <strong>Next &rarr; Start Sending</strong>",
      ],
      tip: "Open missed-call-followup.html in a second tab — each email has a Copy button.",
    },
    {
      title: "Set Up Appointment Reminders",
      who: "Office Manager", time: "20 min",
      screenshot: "Mailchimp → Automations → Create → Classic Automation → Date-based",
      steps: [
        "In Mailchimp: <strong>Automations &rarr; Create &rarr; Classic Automation &rarr; Date-based</strong>",
        `Name it: <strong>Appointment Reminders</strong>`,
        "Set trigger to your appointment date field",
        "Add Email at <strong>72 hours before</strong> &rarr; paste from <a href='appointment-reminder.html'>appointment-reminder.html</a>",
        "Add Email at <strong>24 hours before</strong> &rarr; paste 24h content",
        "For SMS: use SimpleTexting or EZTexting ($25–40/month) with the SMS templates provided",
      ],
      tip: "SMS reminders have 98% open rates vs 20% for email. Worth the $25/month for high-value patients.",
    },
  ];

  if (tier === "starter") {
    return [
      ...base,
      {
        title: "Launch Monthly Newsletter",
        who: "Office Manager", time: "15 min first time · 10 min/month",
        screenshot: "Mailchimp → Campaigns → Create → Email → Regular",
        steps: [
          "In Mailchimp: <strong>Campaigns &rarr; Create &rarr; Email</strong>",
          "Name it: Monthly Newsletter",
          "Choose a simple one-column template",
          `Paste your newsletter content from <a href='monthly-newsletter.html'>monthly-newsletter.html</a>`,
          "Select your full audience, schedule for the 1st of each month, click Send",
        ],
        tip: "Takes 10 minutes per month once the template is saved. Choose the seasonal tip that matches the current month.",
      },
      {
        title: "Set Up Tracking + Go Live",
        who: "Office Manager + Front Desk", time: "30 min",
        screenshot: "Google Sheets — create new spreadsheet, set up tabs per instructions",
        steps: [
          `Set up your tracking spreadsheet using <a href='tracking-spreadsheet.md'>tracking-spreadsheet.md</a>`,
          "Share it with your front desk and practice manager",
          "Train your team: automations run in the background — patient replies come to your inbox",
          "Send yourself a test email from each automation to confirm it's active",
          `Email contact@clinicflowautomation.com with "All live" — we'll note your go-live date`,
        ],
        tip: "Once live, your only ongoing task is updating the tracking sheet (15 min/month).",
      },
    ];
  }

  // Growth / Full
  return [
    ...base,
    {
      title: "Set Up New Patient Welcome",
      who: "Office Manager", time: "30 min",
      screenshot: "Mailchimp → Audience → Tags → Create tag 'New Patient' → Automations → trigger: tag added",
      steps: [
        "Create a <strong>New Patient</strong> tag in your Mailchimp Audience",
        "In Mailchimp: <strong>Automations &rarr; Create &rarr; Classic Automation</strong>",
        "Trigger: <strong>Tag added to contact</strong> &rarr; select 'New Patient'",
        "Add 4 emails from <a href='new-patient-welcome.html'>new-patient-welcome.html</a>:",
        "&nbsp;&nbsp;Email 1: Immediately &nbsp;| &nbsp;Email 2: 1 day &nbsp;| &nbsp;Email 3: 2 days &nbsp;| &nbsp;Email 4: 8 days",
        "Replace <strong>[ReviewLink]</strong> in Email 4 with your Google Business Profile review URL",
      ],
      tip: "Get your Google Review link: search your clinic on Google Maps → your listing → 'Write a review' → copy the URL.",
    },
    {
      title: "Set Up Reactivation Campaign",
      who: "Office Manager", time: "30 min setup · runs monthly",
      screenshot: "Mailchimp → Audience → Import contacts → tag as 'Reactivation-[Month]' → Automations → tag trigger",
      steps: [
        "Export inactive patients from your PMS (last visit &gt; 12 months ago)",
        "Import them into Mailchimp and tag as <strong>Reactivation-[Month]</strong>",
        "In Mailchimp: <strong>Automations &rarr; Create</strong> → trigger: tag added",
        "Add 5 emails from <a href='reactivation-campaign.html'>reactivation-campaign.html</a>:",
        "&nbsp;&nbsp;Email 1: Immediately | Email 2: 14 days | Email 3: 28 days | Email 4: 42 days | Email 5: 56 days",
        "Repeat this monthly with a fresh export of inactive patients",
      ],
      tip: "Focus the first batch on patients inactive 12–18 months. They have the highest rebook rate (15–25%).",
    },
    {
      title: "Set Up Review Requests",
      who: "Office Manager", time: "15 min",
      screenshot: "Mailchimp → Automations → Create → Date-based → appointment completion date field",
      steps: [
        "In Mailchimp: <strong>Automations &rarr; Create &rarr; Date-based</strong>",
        "Trigger: <strong>2 days after</strong> appointment completion date",
        "Add Email 1 from <a href='review-request.html'>review-request.html</a> (Primary Message)",
        "Add Email 2: 5 days after Email 1 (Follow-Up)",
        "Replace <strong>[ReviewLink]</strong> with your Google Business Profile review URL",
        "Test the link in a private browser window — it should open the review box directly",
      ],
      tip: "A steady stream of reviews is one of the highest-ROI activities for a dental clinic. This runs on autopilot.",
    },
    {
      title: "Train Your Team &amp; Go Live",
      who: "Practice Owner + Front Desk", time: "30 min",
      screenshot: "No software needed — team meeting + tracking spreadsheet setup",
      steps: [
        "Review <strong>setup-summary.md</strong> with your front desk — explain what's automated",
        "Key message: patient replies come to your <em>regular inbox</em>, not a separate system",
        `Set up your tracking spreadsheet from <a href='tracking-spreadsheet.md'>tracking-spreadsheet.md</a>`,
        "Send yourself a test message from each automation to confirm it's firing",
        "Tag your first new patient in Mailchimp to trigger the welcome sequence",
        `Email contact@clinicflowautomation.com: <em>"All live — ${esc(clientName)}"</em>`,
      ],
      tip: "Once live, your monthly task is 20 min: update tracking sheet + send the reactivation patient list. Everything else runs automatically.",
    },
  ];
}

export function buildSetupGuide(clientInfo, tier) {
  const steps = getSteps(tier, clientInfo.name);
  const total = steps.length;
  const safeName = clientInfo.name.replace(/[^a-z0-9]/gi, "_").toLowerCase();

  const stepDots = steps.map((_, i) => `<div class="dot" id="dot-${i + 1}" data-n="${i + 1}">${i + 1}</div>`).join("");

  const stepPanels = steps.map((s, i) => {
    const n = i + 1;
    const stuckSubject = encodeURIComponent(`Setup question: Step ${n} — ${s.title}`);
    const stuckBody = encodeURIComponent(`Hi Mohamed,\n\nI'm on Step ${n} of the setup guide (${s.title}) and I'm stuck:\n\n[describe what's happening]\n\nClinic: ${clientInfo.name}\n`);
    return `
<div id="panel-${n}" class="panel" style="display:none">
  <div class="step-meta">
    <span class="meta-badge">${esc(s.time)}</span>
    <span class="meta-badge">${esc(s.who)}</span>
  </div>
  <h2 class="step-title">${esc(s.title)}</h2>
  <div class="screenshot-note">
    <div class="ss-label">WHERE TO CLICK</div>
    <div class="ss-text">${s.screenshot}</div>
  </div>
  <ol class="step-list">
    ${s.steps.map(st => `<li>${st}</li>`).join("")}
  </ol>
  <div class="tip-box">
    <div class="tip-label">TIP</div>
    <div>${s.tip}</div>
  </div>
  <div class="stuck-wrap">
    <span class="stuck-label">Stuck on this step?</span>
    <a href="mailto:contact@clinicflowautomation.com?subject=${stuckSubject}&body=${stuckBody}" class="stuck-btn">Email Mohamed</a>
  </div>
  <div class="nav-btns">
    ${n > 1 ? `<button class="btn-back" onclick="goTo(${n - 1})">&#8592; Back</button>` : "<span></span>"}
    <button class="btn-complete" onclick="complete(${n})">Mark as Complete &#8594;</button>
  </div>
</div>`;
  }).join("");

  return `${pageHead(`Setup Guide — ${clientInfo.name}`, `
    body{background:${C.bgAlt}}
    .container{max-width:720px;margin:0 auto;padding:40px 32px}
    .progress-wrap{background:${C.bg};border:1px solid ${C.border};border-radius:8px;padding:24px 28px;margin-bottom:24px}
    .progress-header{display:flex;align-items:center;justify-content:space-between;margin-bottom:16px}
    .progress-label{font-size:12px;color:${C.textLight};font-weight:600;letter-spacing:1px;text-transform:uppercase}
    .progress-count{font-size:12px;color:${C.textXs}}
    .dots{display:flex;gap:6px;flex-wrap:wrap}
    .dot{width:32px;height:32px;border-radius:50%;background:${C.bgAlt};border:2px solid ${C.border};display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;color:${C.textLight};cursor:pointer;transition:all 0.2s;flex-shrink:0}
    .dot.active{background:${C.navy};border-color:${C.navy};color:#fff}
    .dot.done{background:${C.success};border-color:${C.success};color:#fff}
    .dot.done::after{content:'✓';font-size:14px}
    .dot.done span{display:none}
    .panel{background:${C.bg};border:1px solid ${C.border};border-radius:8px;padding:32px;animation:fadeIn 0.2s}
    @keyframes fadeIn{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}
    .step-meta{display:flex;gap:8px;margin-bottom:12px}
    .meta-badge{font-size:11px;letter-spacing:1px;text-transform:uppercase;background:${C.blueLight};color:${C.navy};padding:4px 10px;border-radius:100px;font-weight:600}
    .step-title{font-size:22px;color:${C.navy};margin-bottom:20px;padding-bottom:16px;border-bottom:1px solid ${C.border}}
    .screenshot-note{background:${C.bgAlt};border-left:3px solid ${C.teal};padding:12px 16px;margin-bottom:24px;border-radius:0 4px 4px 0}
    .ss-label{font-size:10px;letter-spacing:2px;text-transform:uppercase;color:${C.teal};font-weight:700;margin-bottom:4px}
    .ss-text{font-size:13px;color:${C.text};line-height:1.5}
    .step-list{margin:0 0 20px;padding-left:20px;display:grid;gap:10px}
    .step-list li{font-size:14px;line-height:1.6;color:${C.text};padding-left:4px}
    .step-list li a{color:${C.teal};font-weight:600}
    .tip-box{background:${C.amberBg};border-left:3px solid #f6ad55;padding:12px 16px;margin-bottom:28px;border-radius:0 4px 4px 0;font-size:13px;color:${C.text}}
    .tip-label{font-size:10px;letter-spacing:2px;text-transform:uppercase;color:${C.amber};font-weight:700;margin-bottom:4px}
    .nav-btns{display:flex;justify-content:space-between;align-items:center}
    .btn-complete{background:${C.navy};color:#fff;border:none;padding:12px 28px;border-radius:4px;font-size:14px;font-weight:700;cursor:pointer}
    .btn-complete:hover{background:${C.navyDark}}
    .btn-back{background:none;border:1px solid ${C.border};color:${C.textLight};padding:12px 20px;border-radius:4px;font-size:14px;cursor:pointer}
    #done-screen{display:none;text-align:center;background:${C.bg};border:1px solid ${C.border};border-radius:8px;padding:60px 32px}
    .done-check{width:72px;height:72px;background:${C.success};border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:32px;color:#fff;margin:0 auto 24px}
    .consultant-card{display:flex;align-items:center;gap:16px;background:${C.bg};border:1px solid ${C.border};border-radius:8px;padding:18px 22px;margin-bottom:20px}
    .consultant-avatar{width:44px;height:44px;border-radius:50%;background:${C.navy};color:#fff;display:flex;align-items:center;justify-content:center;font-size:18px;font-weight:700;flex-shrink:0}
    .consultant-name{font-size:14px;font-weight:700;color:${C.text};margin-bottom:2px}
    .consultant-detail{font-size:12px;color:${C.textLight};margin-bottom:4px}
    .consultant-email{font-size:12px;color:${C.teal};font-weight:600;text-decoration:none}
    .pct-bar-wrap{margin-top:14px;background:${C.bgAlt};border-radius:100px;height:6px;overflow:hidden}
    .pct-bar{height:6px;background:${C.success};border-radius:100px;transition:width 0.3s;width:0%}
    .stuck-wrap{display:flex;align-items:center;gap:12px;margin-bottom:20px;padding:10px 14px;background:${C.bgAlt};border-radius:6px;border:1px solid ${C.border}}
    .stuck-label{font-size:12px;color:${C.textLight};flex:1}
    .stuck-btn{font-size:12px;font-weight:700;color:${C.navy};background:${C.bg};border:1px solid ${C.border};padding:6px 14px;border-radius:4px;text-decoration:none;white-space:nowrap}
    .stuck-btn:hover{background:${C.blueLight}}
    .checkin-timeline{display:grid;grid-template-columns:1fr 1fr;gap:12px;text-align:left;margin-bottom:28px}
    .checkin-card{background:${C.bgAlt};border-radius:6px;padding:16px 18px;border:1px solid ${C.border}}
    .checkin-day{font-size:11px;letter-spacing:1px;text-transform:uppercase;color:${C.teal};font-weight:700;margin-bottom:6px}
    .checkin-text{font-size:13px;color:${C.text};line-height:1.5}
  `)}
</head>
<body>
${cfHeader(clientInfo)}
<div class="container">

  <div style="margin-bottom:20px">
    <h1 style="font-size:26px;color:${C.navy};margin-bottom:6px">Setup Guide</h1>
    <p style="color:${C.textLight};margin:0">Follow these steps to go live. Progress is saved automatically.</p>
  </div>

  <div class="consultant-card">
    <div class="consultant-avatar">M</div>
    <div>
      <div class="consultant-name">Mohamed — ClinicFlow Automation</div>
      <div class="consultant-detail">Your dedicated consultant &middot; Responds within 4 hours on weekdays</div>
      <a href="mailto:contact@clinicflowautomation.com" class="consultant-email">contact@clinicflowautomation.com</a>
    </div>
  </div>

  <div class="progress-wrap">
    <div class="progress-header">
      <span class="progress-label">Your Progress</span>
      <span class="progress-count" id="prog-label">0 of ${total} complete</span>
    </div>
    <div class="dots">${stepDots}</div>
    <div class="pct-bar-wrap"><div class="pct-bar" id="pct-bar"></div></div>
  </div>

  ${stepPanels}

  <div id="done-screen">
    <div class="done-check">&#10003;</div>
    <h2 style="font-size:26px;color:${C.navy};margin-bottom:12px">Your automations are live.</h2>
    <p style="color:${C.textLight};max-width:480px;margin:0 auto 28px">Mohamed has been notified that you've completed setup. Expect a check-in email within 24 hours.</p>

    <div style="max-width:480px;margin:0 auto 28px">
      <div style="font-size:11px;letter-spacing:1px;text-transform:uppercase;color:${C.textXs};margin-bottom:12px;text-align:left">WHAT HAPPENS NEXT</div>
      <div class="checkin-timeline">
        <div class="checkin-card">
          <div class="checkin-day">Day 7</div>
          <div class="checkin-text">Mohamed sends a week-1 check-in email with 3 specific questions about how the automations are running.</div>
        </div>
        <div class="checkin-card">
          <div class="checkin-day">Day 30</div>
          <div class="checkin-text">Monthly results check-in — review what's working, adjust any sequences, and plan the next steps for your clinic.</div>
        </div>
      </div>
    </div>

    <a href="delivery-index.html" style="color:${C.teal};font-size:14px">&larr; Back to all files</a>
  </div>

</div>
<script>
const KEY = "cf_${safeName}";
const TOTAL = ${total};

function save(n, done) { localStorage.setItem(KEY + "_" + n, done ? "1" : ""); }
function isDone(n) { return !!localStorage.getItem(KEY + "_" + n); }

function updateDots() {
  let done = 0;
  for (let i = 1; i <= TOTAL; i++) {
    const d = document.getElementById("dot-" + i);
    if (!d) continue;
    d.className = "dot";
    if (isDone(i)) { d.className = "dot done"; d.innerHTML = ""; done++; }
  }
  const prog = document.getElementById("prog-label");
  if (prog) prog.textContent = done + " of " + TOTAL + " complete";
  const bar = document.getElementById("pct-bar");
  if (bar) bar.style.width = Math.round((done / TOTAL) * 100) + "%";
}

function goTo(n) {
  document.querySelectorAll(".panel").forEach(p => p.style.display = "none");
  document.getElementById("done-screen").style.display = "none";
  const panel = document.getElementById("panel-" + n);
  if (panel) { panel.style.display = "block"; }
  document.querySelectorAll(".dot").forEach(d => d.classList.remove("active"));
  const dot = document.getElementById("dot-" + n);
  if (dot) dot.classList.add("active");
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function notifySetupComplete() {
  try {
    fetch("/api/setup-complete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clinicName: "${esc(clientInfo.name)}", completedAt: new Date().toISOString() }),
    }).catch(() => {}); // fire and forget — don't block UI on network error
  } catch(e) {}
}

function complete(n) {
  save(n, true);
  updateDots();
  const next = n + 1;
  if (next > TOTAL) {
    notifySetupComplete();
    document.querySelectorAll(".panel").forEach(p => p.style.display = "none");
    document.getElementById("done-screen").style.display = "block";
    document.querySelectorAll(".dot").forEach(d => d.classList.remove("active"));
  } else {
    goTo(next);
  }
}

function init() {
  updateDots();
  // Find first incomplete step
  for (let i = 1; i <= TOTAL; i++) {
    if (!isDone(i)) { goTo(i); return; }
  }
  // All done
  document.getElementById("done-screen").style.display = "block";
}

document.addEventListener("DOMContentLoaded", init);
</script>
</body>
</html>`;
}

// ─── RESULTS PROJECTION CALCULATOR ───────────────────────────────────────────

export function buildResultsProjection(clientInfo, tier) {
  const investmentAmt = tier === "starter" ? 397 : tier === "growth" ? 997 : 2497;

  return `${pageHead(`Revenue Projection — ${clientInfo.name}`, `
    body{background:${C.bgAlt}}
    .container{max-width:820px;margin:0 auto;padding:40px 32px}
    .card{background:${C.bg};border:1px solid ${C.border};border-radius:8px;padding:28px 32px;margin-bottom:20px}
    .inputs-grid{display:grid;grid-template-columns:1fr 1fr;gap:20px}
    @media(max-width:580px){.inputs-grid{grid-template-columns:1fr}}
    .input-group label{display:block;font-size:11px;letter-spacing:1px;text-transform:uppercase;color:${C.textLight};font-weight:700;margin-bottom:6px}
    .input-group input{width:100%;padding:10px 14px;border:1px solid ${C.border};border-radius:4px;font-size:16px;color:${C.text};background:${C.bg};outline:none;font-family:${FONT}}
    .input-group input:focus{border-color:${C.teal};box-shadow:0 0 0 3px rgba(13,115,119,0.1)}
    .input-hint{font-size:11px;color:${C.textXs};margin-top:4px}
    .results-grid{display:grid;grid-template-columns:1fr 1fr 1fr;gap:16px}
    @media(max-width:640px){.results-grid{grid-template-columns:1fr 1fr}}
    @media(max-width:400px){.results-grid{grid-template-columns:1fr}}
    .metric{background:${C.bgAlt};border-radius:6px;padding:16px 18px;border:1px solid ${C.border}}
    .metric-value{font-size:26px;font-weight:800;color:${C.navy};line-height:1;margin-bottom:4px;font-variant-numeric:tabular-nums}
    .metric-label{font-size:12px;color:${C.textLight}}
    .roi-banner{background:${C.navy};border-radius:8px;padding:28px 32px;text-align:center;color:#fff;margin-top:20px}
    .roi-main{font-size:clamp(22px,4vw,32px);font-weight:800;margin-bottom:8px;line-height:1.2}
    .roi-sub{font-size:14px;color:rgba(255,255,255,0.65)}
    .disclaimer{font-size:11px;color:${C.textXs};text-align:center;margin-top:16px;line-height:1.6}
  `)}
</head>
<body>
${cfHeader(clientInfo)}
<div class="container">

  <div style="margin-bottom:28px">
    <h1 style="font-size:26px;color:${C.navy};margin-bottom:6px">Revenue Impact Projection</h1>
    <p style="color:${C.textLight};margin:0">Enter your clinic&rsquo;s numbers. Results update instantly.</p>
  </div>

  <div class="card">
    <h2 style="font-size:13px;letter-spacing:1px;text-transform:uppercase;color:${C.textXs};margin-bottom:20px;font-weight:700">YOUR CLINIC NUMBERS</h2>
    <div class="inputs-grid">
      <div class="input-group">
        <label>Monthly patients seen</label>
        <input type="number" id="patients" value="200" min="1" oninput="calc()">
        <div class="input-hint">Active patients per month</div>
      </div>
      <div class="input-group">
        <label>Missed calls per week</label>
        <input type="number" id="missed" value="15" min="0" oninput="calc()">
        <div class="input-hint">Calls that go unanswered</div>
      </div>
      <div class="input-group">
        <label>Current no-show rate (%)</label>
        <input type="number" id="noshow" value="12" min="0" max="100" oninput="calc()">
        <div class="input-hint">% of booked appointments that don't show</div>
      </div>
      <div class="input-group">
        <label>Average visit value ($)</label>
        <input type="number" id="value" value="150" min="1" oninput="calc()">
        <div class="input-hint">Revenue per patient visit</div>
      </div>
    </div>
  </div>

  <div class="card">
    <h2 style="font-size:13px;letter-spacing:1px;text-transform:uppercase;color:${C.textXs};margin-bottom:20px;font-weight:700">ESTIMATED MONTHLY IMPACT</h2>
    <div class="results-grid">
      <div class="metric">
        <div class="metric-value" id="r-recovered">—</div>
        <div class="metric-label">Missed calls recovered</div>
      </div>
      <div class="metric">
        <div class="metric-value" id="r-call-rev">—</div>
        <div class="metric-label">Revenue from recovered calls</div>
      </div>
      <div class="metric">
        <div class="metric-value" id="r-noshows">—</div>
        <div class="metric-label">No-shows prevented</div>
      </div>
      <div class="metric">
        <div class="metric-value" id="r-noshow-rev">—</div>
        <div class="metric-label">Revenue saved from no-shows</div>
      </div>
      <div class="metric">
        <div class="metric-value" id="r-reactiv">—</div>
        <div class="metric-label">Reactivated patients</div>
      </div>
      <div class="metric">
        <div class="metric-value" id="r-reactiv-rev">—</div>
        <div class="metric-label">Reactivation revenue</div>
      </div>
    </div>
  </div>

  <div class="roi-banner">
    <div class="roi-main" id="roi-main">Enter your numbers above</div>
    <div class="roi-sub" id="roi-sub">Estimated total monthly impact</div>
  </div>

  <div class="disclaimer">
    Projections based on industry averages: 35% missed call recovery rate, 45% no-show reduction from reminders, 18% reactivation rebook rate.<br>
    Actual results vary by clinic. These figures are estimates only — not a guarantee.
  </div>

</div>
<script>
const INVESTMENT = ${investmentAmt};

function fmt(n) {
  if (n >= 1000) return "$" + (n / 1000).toFixed(1).replace(/\\.0$/, "") + "k";
  return "$" + Math.round(n);
}

function calc() {
  const P = Math.max(0, parseFloat(document.getElementById("patients").value) || 0);
  const M = Math.max(0, parseFloat(document.getElementById("missed").value) || 0);
  const N = Math.max(0, Math.min(100, parseFloat(document.getElementById("noshow").value) || 0));
  const V = Math.max(0, parseFloat(document.getElementById("value").value) || 0);

  const missedPerMonth = M * 4.33;
  const recovered = Math.round(missedPerMonth * 0.35);
  const callRev = recovered * V;

  const noshowsPerMonth = P * (N / 100);
  const noshowsPrevented = Math.round(noshowsPerMonth * 0.45);
  const noshowRev = noshowsPrevented * V;

  const reactivated = Math.round(28 * 0.18);
  const reactivRev = reactivated * V;

  const total = callRev + noshowRev + reactivRev;

  set("r-recovered", recovered + " patients");
  set("r-call-rev", fmt(callRev));
  set("r-noshows", noshowsPrevented + " appointments");
  set("r-noshow-rev", fmt(noshowRev));
  set("r-reactiv", reactivated + " patients");
  set("r-reactiv-rev", fmt(reactivRev));

  if (total > 0) {
    const weeks = Math.ceil(INVESTMENT / (total / 4.33));
    document.getElementById("roi-main").textContent =
      fmt(total) + "/month total impact — $" + INVESTMENT.toLocaleString() + " pays back in " + weeks + " week" + (weeks === 1 ? "" : "s");
    document.getElementById("roi-sub").textContent =
      "Recovered calls (" + fmt(callRev) + ") + No-show savings (" + fmt(noshowRev) + ") + Reactivation (" + fmt(reactivRev) + ")";
  } else {
    document.getElementById("roi-main").textContent = "Enter your numbers above";
    document.getElementById("roi-sub").textContent = "Estimated total monthly impact";
  }
}

function set(id, val) {
  const el = document.getElementById(id);
  if (el) el.textContent = val;
}

document.addEventListener("DOMContentLoaded", calc);
</script>
</body>
</html>`;
}

// ─── SEQUENCE TIMELINE HTML ───────────────────────────────────────────────────

const SEQ_META = {
  "missed-call-followup":  { label: "Missed Call Recovery",         trigger: "Patient calls — no one answers",           color: C.navy },
  "reactivation-campaign": { label: "Patient Reactivation Campaign", trigger: "Monthly batch — patients inactive 12+ months", color: C.teal },
  "new-patient-welcome":   { label: "New Patient Welcome",           trigger: "New patient books first appointment",       color: "#5a67d8" },
  "review-request":        { label: "Google Review Request",         trigger: "Appointment marked completed in PMS",       color: "#2f855a" },
};

function timingConnector(label) {
  return `
<div style="display:flex;align-items:center;gap:12px;padding:4px 0 4px 22px;margin:0">
  <div style="width:2px;height:32px;background:${C.border};margin-left:-1px;flex-shrink:0"></div>
  <div style="font-size:11px;color:${C.textXs};letter-spacing:0.5px;font-style:italic">${esc(label)}</div>
</div>`;
}

export function buildSequenceHTML(seqName, mdContent, clientInfo) {
  const emails = parseEmailSections(mdContent);
  const meta = SEQ_META[seqName] ?? { label: seqName, trigger: "Automated trigger", color: C.navy };

  const emailCards = emails.map((email, i) => {
    const isLast = i === emails.length - 1;
    const copyData = encodeCopy(email.body);
    const highlightedBody = highlightPlaceholders(email.body);

    const card = `
<div style="display:flex;align-items:flex-start;gap:16px">
  <!-- Timeline dot + line -->
  <div style="display:flex;flex-direction:column;align-items:center;flex-shrink:0;padding-top:18px">
    <div style="width:22px;height:22px;border-radius:50%;background:${meta.color};color:#fff;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:800;flex-shrink:0">${email.number}</div>
    ${!isLast ? `<div style="width:2px;flex:1;min-height:32px;background:${C.border};margin-top:6px"></div>` : ""}
  </div>
  <!-- Card -->
  <div style="flex:1;margin-bottom:${isLast ? "0" : "8px"}">
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px;flex-wrap:wrap">
      <div style="background:${meta.color}18;color:${meta.color};border-radius:100px;padding:3px 12px;font-size:11px;font-weight:700;letter-spacing:0.5px;text-transform:uppercase">${esc(email.timing.label)}</div>
      <div style="font-size:12px;color:${C.textXs}">Email ${email.number} of ${emails.length}</div>
    </div>
    <div style="background:${C.bg};border:1px solid ${C.border};border-radius:8px;overflow:hidden">
      <!-- Subject header -->
      <div style="padding:14px 18px;background:${C.bgAlt};border-bottom:1px solid ${C.border};display:flex;align-items:flex-start;justify-content:space-between;gap:12px">
        <div>
          <div style="font-size:10px;letter-spacing:1.5px;text-transform:uppercase;color:${C.textXs};margin-bottom:4px;font-weight:700">SUBJECT LINE</div>
          <div style="font-size:14px;font-weight:700;color:${C.text}">${esc(email.subject)}</div>
        </div>
        <div style="font-size:11px;color:${C.textXs};white-space:nowrap;padding-top:2px">${email.subject.length} chars</div>
      </div>
      <!-- Body -->
      <div style="padding:18px;position:relative">
        <button onclick="copyBlock(this)" data-copy="${copyData}"
          style="position:absolute;top:14px;right:14px;background:${meta.color};color:#fff;border:none;padding:6px 14px;border-radius:4px;font-size:12px;font-weight:700;cursor:pointer;font-family:inherit">
          Copy
        </button>
        <pre style="margin:0;white-space:pre-wrap;font-family:Georgia,'Times New Roman',serif;font-size:13px;line-height:1.7;color:${C.text};padding-right:60px">${highlightedBody}</pre>
      </div>
    </div>
  </div>
</div>`;

    if (isLast) return card;

    const nextEmail = emails[i + 1];
    const gapLabel = nextEmail
      ? `Then wait: ${nextEmail.timing.label.replace(" after trigger", "")}`
      : "";

    return card + `
<div style="padding-left:38px;margin:0 0 8px">
  <div style="font-size:12px;color:${C.textXs};font-style:italic;padding:6px 0">&darr; &nbsp;${esc(gapLabel)}</div>
</div>`;
  }).join("");

  const allPlaceholders = [...new Set(emails.flatMap(e =>
    [...e.body.matchAll(/\[([A-Z][A-Za-z0-9 /]+)\]/g)].map(m => m[0])
  ))];

  return `${pageHead(`${meta.label} — ${clientInfo.name}`, `
    body{background:${C.bgAlt}}
    .container{max-width:760px;margin:0 auto;padding:40px 32px}
    @media print{body{background:#fff}.container{padding:20px}}
    pre mark{border-radius:3px}
  `)}
</head>
<body>
${cfHeader(clientInfo)}
<div class="container">

  <!-- Hero -->
  <div style="margin-bottom:36px;padding-bottom:28px;border-bottom:1px solid ${C.border}">
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:12px;flex-wrap:wrap">
      <div style="background:${meta.color};color:#fff;border-radius:100px;padding:4px 14px;font-size:11px;font-weight:700;letter-spacing:1px;text-transform:uppercase">${emails.length}-EMAIL SEQUENCE</div>
      <div style="font-size:13px;color:${C.textLight}">Fully automated &mdash; no front desk action required</div>
    </div>
    <h1 style="font-size:26px;color:${C.navy};margin-bottom:8px">${esc(meta.label)}</h1>
    <div style="display:flex;align-items:center;gap:8px">
      <div style="font-size:11px;letter-spacing:1px;text-transform:uppercase;color:${C.textXs};font-weight:700">TRIGGER</div>
      <div style="font-size:13px;color:${C.text}">${esc(meta.trigger)}</div>
    </div>
  </div>

  <!-- Timeline -->
  <div style="margin-bottom:36px">
    ${emailCards}
  </div>

  <!-- Placeholder reference -->
  ${allPlaceholders.length > 0 ? `
  <div style="background:${C.amberBg};border:1px solid #f6e09a;border-radius:8px;padding:18px 22px">
    <div style="font-size:11px;letter-spacing:1px;text-transform:uppercase;color:${C.amber};font-weight:700;margin-bottom:8px">PLACEHOLDERS TO FILL</div>
    <div style="display:flex;flex-wrap:wrap;gap:8px">
      ${allPlaceholders.map(p => `<code style="background:#fff;border:1px solid #f6e09a;border-radius:4px;padding:3px 8px;font-size:12px;color:${C.amber};font-family:monospace">${esc(p)}</code>`).join("")}
    </div>
    <div style="font-size:12px;color:${C.textLight};margin-top:8px">Your email platform will replace these automatically, or fill them in manually before sending.</div>
  </div>` : ""}

  <div style="margin-top:32px;text-align:right;color:${C.textXs};font-size:12px">
    ${esc(clientInfo.name)} &mdash; ClinicFlow ${esc(clientInfo.tier ?? "")} Package &mdash; clinicflowautomation.com
  </div>
</div>

<script>
function copyBlock(btn) {
  const text = decodeURIComponent(btn.getAttribute("data-copy"));
  if (navigator.clipboard) {
    navigator.clipboard.writeText(text).then(() => flash(btn));
  } else {
    const ta = document.createElement("textarea");
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    document.body.removeChild(ta);
    flash(btn);
  }
}
function flash(btn) {
  const orig = btn.textContent;
  btn.textContent = "Copied!";
  btn.style.background = "${C.success}";
  setTimeout(() => { btn.textContent = orig; btn.style.background = ""; }, 2000);
}
</script>
</body>
</html>`;
}

// ─── DOCUMENT VIEW HTML (appointment-reminder, monthly-newsletter) ────────────

export function buildDocumentHTML(mdContent, title, clientInfo) {
  // Convert markdown to clean HTML sections with copy boxes
  const sections = [];
  let currentSection = null;

  for (const line of mdContent.split("\n")) {
    if (line.startsWith("## ")) {
      if (currentSection) sections.push(currentSection);
      currentSection = { heading: line.slice(3).trim(), lines: [] };
    } else if (currentSection) {
      currentSection.lines.push(line);
    } else {
      if (!sections.length) sections.push({ heading: "", lines: [] });
      sections[0].lines.push(line);
    }
  }
  if (currentSection) sections.push(currentSection);

  const sectionsHTML = sections.filter(s => s.heading || s.lines.some(l => l.trim())).map(s => {
    const rawText = s.lines.join("\n").trim();
    if (!rawText && !s.heading) return "";

    // Check if this section has SMS/email template content worth copying
    const hasTemplate = rawText.includes("[PatientFirstName]") || rawText.length > 60;
    const copyBtn = hasTemplate
      ? `<button onclick="copyBlock(this)" data-copy="${encodeCopy(rawText)}"
           style="float:right;background:${C.navy};color:#fff;border:none;padding:5px 12px;border-radius:4px;font-size:11px;font-weight:700;cursor:pointer;font-family:inherit;margin:-4px 0 8px 12px">Copy</button>`
      : "";

    const bodyHTML = rawText
      .split("\n")
      .map(l => {
        const t = l.trim();
        if (!t) return "";
        if (t.startsWith("- ")) return `<li style="margin:4px 0">${highlightPlaceholders(t.slice(2))}</li>`;
        if (t.startsWith("|")) return ""; // table row (handled separately)
        return `<p style="margin:0 0 8px;line-height:1.65;font-size:14px">${highlightPlaceholders(l)}</p>`;
      }).join("");

    return `
<div style="background:${C.bg};border:1px solid ${C.border};border-radius:8px;padding:22px 24px;margin-bottom:16px;overflow:hidden">
  ${s.heading ? `<h2 style="font-size:16px;color:${C.navy};margin-bottom:14px;padding-bottom:10px;border-bottom:1px solid ${C.border}">${esc(s.heading)}</h2>` : ""}
  ${copyBtn}
  <div style="font-family:Georgia,serif;color:${C.text}">${bodyHTML}</div>
</div>`;
  }).join("");

  return `${pageHead(`${title} — ${clientInfo.name}`, `
    body{background:${C.bgAlt}}
    .container{max-width:760px;margin:0 auto;padding:40px 32px}
  `)}
</head>
<body>
${cfHeader(clientInfo)}
<div class="container">
  <div style="margin-bottom:28px;padding-bottom:24px;border-bottom:1px solid ${C.border}">
    <h1 style="font-size:26px;color:${C.navy};margin-bottom:4px">${esc(title)}</h1>
    <p style="color:${C.textLight};margin:0">${esc(clientInfo.name)} &mdash; ClinicFlow Package</p>
  </div>
  ${sectionsHTML}
</div>
<script>
function copyBlock(btn) {
  const text = decodeURIComponent(btn.getAttribute("data-copy"));
  if (navigator.clipboard) {
    navigator.clipboard.writeText(text).then(() => flash(btn));
  } else {
    const ta = document.createElement("textarea"); ta.value = text;
    document.body.appendChild(ta); ta.select(); document.execCommand("copy"); document.body.removeChild(ta);
    flash(btn);
  }
}
function flash(btn) {
  const orig = btn.textContent; btn.textContent = "Copied!"; btn.style.background = "${C.success}";
  setTimeout(() => { btn.textContent = orig; btn.style.background = ""; }, 2000);
}
</script>
</body>
</html>`;
}

// ─── MAIN ENTRY POINT ─────────────────────────────────────────────────────────

// ─── CERTIFICATE OF SETUP ────────────────────────────────────────────────────

export function buildCertificate(clientInfo, tier) {
  const tierLabel = tier.charAt(0).toUpperCase() + tier.slice(1);
  const date = new Date().toLocaleDateString("en-CA", { year: "numeric", month: "long", day: "numeric" });
  const tierPrices = { starter: "$397 CAD", growth: "$997 CAD", full: "$2,497 CAD" };
  const tierPrice = tierPrices[tier] ?? "";

  return `${pageHead(`Certificate of Setup — ${clientInfo.name}`, `
    html,body{height:100%;background:#fff}
    body{display:flex;align-items:center;justify-content:center;min-height:100vh;padding:40px 20px}
    .cert{max-width:640px;width:100%;margin:0 auto;border:1px solid ${C.border};border-radius:4px;overflow:hidden;box-shadow:0 4px 32px rgba(0,0,0,0.06)}
    .cert-header{background:${C.navy};padding:32px 40px;text-align:center}
    .cert-body{padding:48px 52px;text-align:center}
    .cert-footer{background:${C.bgAlt};border-top:1px solid ${C.border};padding:20px 40px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:12px}
    @media(max-width:560px){.cert-body{padding:32px 24px}.cert-header{padding:24px}.cert-footer{padding:16px 24px}}
    @media print{body{background:#fff}.cert{box-shadow:none;border:1px solid #ccc}}
  `)}
</head>
<body>
<div class="cert">
  <div class="cert-header">
    <div style="font-size:10px;letter-spacing:4px;text-transform:uppercase;color:rgba(255,255,255,0.4);margin-bottom:12px">ClinicFlow Automation</div>
    <div style="font-size:20px;font-weight:700;color:#fff;letter-spacing:0.5px">Certificate of Setup Delivery</div>
  </div>
  <div class="cert-body">
    <div style="font-size:12px;letter-spacing:2px;text-transform:uppercase;color:${C.textXs};margin-bottom:24px">This certifies that the following has been delivered to</div>
    <div style="font-family:Georgia,'Times New Roman',serif;font-size:clamp(22px,4vw,36px);font-weight:400;color:${C.navy};margin-bottom:6px">${esc(clientInfo.name)}</div>
    <div style="font-size:14px;color:${C.textLight};margin-bottom:36px">${esc(clientInfo.city || "")}</div>

    <div style="display:inline-block;background:${C.blueLight};border:1px solid #c5d9f0;border-radius:4px;padding:8px 20px;font-size:13px;font-weight:700;color:${C.navy};letter-spacing:0.5px;margin-bottom:36px">
      ClinicFlow ${esc(tierLabel)} Package &nbsp;&middot;&nbsp; ${tierPrice} one-time
    </div>

    <div style="border-top:1px solid ${C.border};border-bottom:1px solid ${C.border};padding:20px 0;margin-bottom:36px">
      <div style="font-size:11px;letter-spacing:1px;text-transform:uppercase;color:${C.textXs};margin-bottom:12px">Delivery includes</div>
      <div style="font-size:14px;color:${C.text};line-height:2">
        ${(TIER_ITEMS[tier] ?? TIER_ITEMS.growth).map(i => esc(i)).join(" &nbsp;&middot;&nbsp; ")}
      </div>
    </div>

    <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:16px;margin-bottom:36px">
      <div>
        <div style="font-size:10px;letter-spacing:1px;text-transform:uppercase;color:${C.textXs};margin-bottom:4px">Delivery date</div>
        <div style="font-size:14px;font-weight:700;color:${C.text}">${date}</div>
      </div>
      <div>
        <div style="font-size:10px;letter-spacing:1px;text-transform:uppercase;color:${C.textXs};margin-bottom:4px">Support included</div>
        <div style="font-size:14px;font-weight:700;color:${C.text}">30 days</div>
      </div>
      <div>
        <div style="font-size:10px;letter-spacing:1px;text-transform:uppercase;color:${C.textXs};margin-bottom:4px">Guarantee</div>
        <div style="font-size:14px;font-weight:700;color:${C.text}">30-day satisfaction</div>
      </div>
    </div>

    <div style="border-top:1px solid ${C.border};padding-top:28px;margin-top:8px">
      <div style="font-size:13px;color:${C.textLight};margin-bottom:16px">Delivered by</div>
      <div style="font-size:16px;font-weight:700;color:${C.text}">Mohamed</div>
      <div style="font-size:13px;color:${C.textLight}">ClinicFlow Automation &middot; Montreal, QC</div>
      <div style="font-size:13px;color:${C.textLight}">contact@clinicflowautomation.com</div>
      <div style="margin-top:20px;font-family:Georgia,serif;font-size:22px;color:${C.navy};border-bottom:1px solid ${C.border};display:inline-block;padding-bottom:4px;padding-right:32px">Mohamed</div>
    </div>
  </div>
  <div class="cert-footer">
    <div style="display:flex;gap:12px;flex-wrap:wrap">
      <span style="font-size:11px;color:${C.textXs}">PIPEDA Compliant</span>
      <span style="color:${C.border}">·</span>
      <span style="font-size:11px;color:${C.textXs}">Patient data never stored</span>
      <span style="color:${C.border}">·</span>
      <span style="font-size:11px;color:${C.textXs}">Canadian-built</span>
    </div>
    <div style="font-size:11px;color:${C.textXs}">clinicflowautomation.com</div>
  </div>
</div>
</body>
</html>`;
}

const SEQUENCE_DOCS = ["missed-call-followup", "reactivation-campaign", "new-patient-welcome", "review-request"];

const TIER_HTML_FILES = {
  starter: ["missed-call-followup", "appointment-reminder", "monthly-newsletter"],
  growth:  ["missed-call-followup", "reactivation-campaign", "new-patient-welcome", "review-request", "appointment-reminder", "monthly-newsletter"],
  full:    ["missed-call-followup", "reactivation-campaign", "new-patient-welcome", "review-request", "appointment-reminder", "monthly-newsletter"],
};

/**
 * Generate all HTML delivery files for a client.
 * @param {string} deliveryDir
 * @param {{ name, city, website }} clientInfo
 * @param {string} tier
 * @returns {{ files: string[] }} list of generated filenames
 */
export async function buildHTMLDelivery(deliveryDir, clientInfo, tier) {
  const generated = [];

  function write(filename, html) {
    fs.writeFileSync(path.join(deliveryDir, filename), html, "utf-8");
    generated.push(filename);
  }

  // 1. Cover page
  write("cover.html", buildCoverPage(clientInfo, tier));

  // 2. Certificate of setup
  write("certificate.html", buildCertificate(clientInfo, tier));

  // 3. Setup guide
  write("setup-guide.html", buildSetupGuide(clientInfo, tier));

  // 3. Results calculator
  write("results-projection.html", buildResultsProjection(clientInfo, tier));

  // 4. Sequence & document HTML files
  const htmlFiles = TIER_HTML_FILES[tier] ?? TIER_HTML_FILES.growth;

  for (const name of htmlFiles) {
    const mdPath = path.join(deliveryDir, `${name}.md`);
    if (!fs.existsSync(mdPath)) continue;

    const mdContent = fs.readFileSync(mdPath, "utf-8");
    let html;

    if (SEQUENCE_DOCS.includes(name)) {
      html = buildSequenceHTML(name, mdContent, clientInfo);
    } else {
      const titles = {
        "appointment-reminder": "Appointment Reminder Templates",
        "monthly-newsletter":   "Monthly Patient Newsletter",
      };
      html = buildDocumentHTML(mdContent, titles[name] ?? name, clientInfo);
    }

    write(`${name}.html`, html);
  }

  // 5. Delivery index (built last so it knows what's available)
  write("delivery-index.html", buildDeliveryIndex(clientInfo, tier));

  return { files: generated };
}
