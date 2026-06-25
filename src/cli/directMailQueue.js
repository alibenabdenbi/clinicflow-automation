// src/cli/directMailQueue.js
// Generates printable one-page direct mail letters for clinics after FU3 with no reply.
// Physical mail: no spam filter, highest response rate channel for B2B dentists.
// Cost: ~$1.30/stamp in Canada. 2-5% response rate vs 0.5% cold email.
//
// Outputs HTML files → print from Chrome → Save as PDF → mail.
// Also generates a mailing list CSV with addresses from RCDSO data.
//
// Usage:
//   node src/cli/directMailQueue.js
//   node src/cli/directMailQueue.js --limit 20

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const DATA_DIR = path.join(ROOT, "data");
const OUTREACH_PATH = path.join(DATA_DIR, "outreach.localDentists.json");
const OUT_DIR = path.join(DATA_DIR, "direct-mail");
const CSV_PATH = path.join(OUT_DIR, "mailing-list.csv");

const args    = process.argv.slice(2);
const limitIdx = args.indexOf("--limit");
const LIMIT   = limitIdx !== -1 ? Number(args[limitIdx + 1]) : 20;

function readJsonSafe(p, fb) {
  try { if (!fs.existsSync(p)) return fb; return JSON.parse(fs.readFileSync(p, "utf-8")); }
  catch { return fb; }
}

// Revenue calculation for missed calls
function calcMissedCallRevenue(city) {
  // Avg new patient value in Canadian dental market
  const avgValue = 350; // CAD per new patient
  const missedPerDay = 6;
  const conversionRate = 0.35; // 35% of callers book
  const monthly = missedPerDay * 22 * conversionRate * avgValue; // 22 working days
  return Math.round(monthly / 100) * 100; // round to nearest $100
}

// QR code using Google Charts API (no dependency needed)
function qrCodeImg(url) {
  const encoded = encodeURIComponent(url);
  return `https://chart.googleapis.com/chart?chs=120x120&cht=qr&chl=${encoded}&choe=UTF-8`;
}

function buildLetter(lead) {
  const name = lead.clinicName || "your dental clinic";
  const city = (lead.city || "your city").split(",")[0].trim();
  const address = lead.rcdsoAddress || lead.address || null;
  const revenue = calcMissedCallRevenue(city);
  const ownerName = lead.rcdsoName || lead.contactName || null;
  const greeting = ownerName ? `Dear ${ownerName.split(" ")[0]},` : "Dear Clinic Owner,";
  const auditUrl = "https://clinicflowautomation.com/audit";
  const qrSrc = qrCodeImg(auditUrl);
  const today = new Date().toLocaleDateString("en-CA", { month: "long", day: "numeric", year: "numeric" });

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <title>ClinicFlow Letter — ${name}</title>
  <style>
    @page { size: letter; margin: 0; }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: Georgia, "Times New Roman", serif;
      font-size: 11pt;
      line-height: 1.65;
      color: #1a1a1a;
      background: #fff;
      width: 8.5in;
      min-height: 11in;
      padding: 0.85in 1.1in;
    }
    .header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 36pt; }
    .brand { font-family: Arial, sans-serif; }
    .brand-name { font-size: 16pt; font-weight: 700; color: #1a4a8a; letter-spacing: -0.3px; }
    .brand-tag  { font-size: 8.5pt; color: #555; margin-top: 1pt; }
    .date { font-size: 9pt; color: #555; text-align: right; }
    .recipient { margin-bottom: 24pt; font-size: 10pt; color: #333; line-height: 1.7; }
    .greeting { font-size: 11.5pt; margin-bottom: 16pt; }
    p { margin-bottom: 14pt; }
    .highlight {
      background: #f0f6ff;
      border-left: 3px solid #1a4a8a;
      padding: 12pt 14pt;
      margin: 20pt 0;
      border-radius: 0 4pt 4pt 0;
    }
    .highlight strong { color: #1a4a8a; }
    .calc-box {
      border: 1pt solid #ccd;
      padding: 14pt 16pt;
      margin: 18pt 0;
      font-family: Arial, sans-serif;
      font-size: 10pt;
    }
    .calc-row { display: flex; justify-content: space-between; margin-bottom: 6pt; }
    .calc-total { font-weight: 700; font-size: 12pt; border-top: 1pt solid #aab; padding-top: 8pt; margin-top: 8pt; color: #c00; }
    .cta-box {
      display: flex;
      align-items: center;
      gap: 24pt;
      border: 2pt solid #1a4a8a;
      padding: 16pt 20pt;
      margin: 24pt 0;
      border-radius: 4pt;
    }
    .qr-section { text-align: center; flex-shrink: 0; }
    .qr-section img { width: 90pt; height: 90pt; display: block; margin: 0 auto 4pt; }
    .qr-label { font-size: 7.5pt; color: #555; font-family: Arial, sans-serif; }
    .cta-text { flex: 1; }
    .cta-title { font-size: 13pt; font-weight: 700; color: #1a4a8a; margin-bottom: 8pt; font-family: Arial, sans-serif; }
    .cta-steps { font-size: 9.5pt; font-family: Arial, sans-serif; color: #333; }
    .cta-steps li { margin-bottom: 4pt; list-style: none; padding-left: 14pt; position: relative; }
    .cta-steps li::before { content: "✓"; position: absolute; left: 0; color: #1a4a8a; font-weight: 700; }
    .sign { margin-top: 28pt; }
    .sign-name { font-weight: 700; font-size: 11.5pt; }
    .sign-title { font-size: 9.5pt; color: #555; margin-top: 2pt; }
    .footer { margin-top: 32pt; padding-top: 10pt; border-top: 0.5pt solid #ccc; font-size: 8pt; color: #888; font-family: Arial, sans-serif; }
    @media print { body { padding: 0.75in 1in; } }
  </style>
</head>
<body>

  <div class="header">
    <div class="brand">
      <div class="brand-name">ClinicFlow Automation</div>
      <div class="brand-tag">Patient Communication Systems for Dental Clinics</div>
    </div>
    <div class="date">${today}<br>clinicflowautomation.com</div>
  </div>

  ${address ? `<div class="recipient">${name}<br>${address}</div>` : ""}

  <div class="greeting">${greeting}</div>

  <p>I've been reviewing dental clinics in ${city} over the past few months. ${name} caught my attention — you have a solid reputation, but I noticed something that's likely costing you real revenue.</p>

  <div class="highlight">
    <strong>The average dental clinic in ${city} loses $${revenue.toLocaleString()}/month</strong> in unbooked appointments from missed and unanswered calls — patients who called once, didn't reach anyone, and never called back.
  </div>

  <div class="calc-box">
    <div style="font-weight:700;margin-bottom:10pt;font-size:10.5pt;">Quick Revenue Calculation for ${name}</div>
    <div class="calc-row"><span>Missed calls per day (industry average)</span><span>6 calls</span></div>
    <div class="calc-row"><span>Working days per month</span><span>22 days</span></div>
    <div class="calc-row"><span>Caller conversion rate (% who would book)</span><span>35%</span></div>
    <div class="calc-row"><span>Average new patient value</span><span>$350</span></div>
    <div class="calc-row calc-total"><span>Monthly missed revenue</span><span>$${revenue.toLocaleString()}</span></div>
  </div>

  <p>I fix this with a simple automated follow-up system — when a patient calls and no one answers, they automatically receive a text within 60 seconds offering to book online or speak with someone. Most clinics see 3–6 recovered patients in the first two weeks.</p>

  <p>Setup takes 5 business days. There are no monthly fees. You see results before you pay anything.</p>

  <div class="cta-box">
    <div class="cta-text">
      <div class="cta-title">Free Missed Call Audit</div>
      <ul class="cta-steps">
        <li>Scan the QR code or visit clinicflowautomation.com/audit</li>
        <li>Tell me about your current setup (2 minutes)</li>
        <li>I'll show you exactly what ${name} is losing — free</li>
        <li>No commitment, no sales call unless you want one</li>
      </ul>
    </div>
    <div class="qr-section">
      <img src="${qrSrc}" alt="QR Code" />
      <div class="qr-label">Scan to request<br>your free audit</div>
    </div>
  </div>

  <p>Or simply reply to this letter — my contact details are below. I'm based in Montreal and work with clinics across Canada.</p>

  <div class="sign">
    <div class="sign-name">Mohamed</div>
    <div class="sign-title">ClinicFlow Automation</div>
    <div class="sign-title" style="margin-top:4pt;">contact@clinicflowautomation.com</div>
    <div class="sign-title">438-544-0442</div>
  </div>

  <div class="footer">
    ClinicFlow Automation · contact@clinicflowautomation.com · clinicflowautomation.com<br>
    To be removed from our mailing list, please email contact@clinicflowautomation.com with "Remove" in the subject line.
  </div>

</body>
</html>`;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

const leads = readJsonSafe(OUTREACH_PATH, []);

// Target: cooling_off (post-FU3) or followup_2_sent with no reply
const targets = leads
  .filter(l => {
    const s = l.status || "todo";
    if (!["cooling_off", "followup_2_sent", "followup_3_sent"].includes(s)) return false;
    if (l.directMailSentAt) return false; // already sent
    return true;
  })
  .slice(0, LIMIT);

console.log(`\nDirect Mail Queue Generator`);
console.log(`Targets: ${targets.length} clinics (post-FU3 / cooling off)`);
console.log(`Output:  ${OUT_DIR}\n`);

fs.mkdirSync(OUT_DIR, { recursive: true });

// CSV mailing list header
const csvRows = ["Name,Clinic,City,Address,Email,Phone,Status"];
let generated = 0;

for (const lead of targets) {
  const slug = (lead.clinicName || "clinic")
    .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
  const fileName = `letter-${slug}.html`;
  const outPath = path.join(OUT_DIR, fileName);

  const html = buildLetter(lead);
  fs.writeFileSync(outPath, html, "utf-8");
  generated++;

  const city = (lead.city || "").split(",")[0].trim();
  csvRows.push([
    lead.rcdsoName || lead.contactName || "",
    `"${(lead.clinicName || "").replace(/"/g, "'")}"`,
    city,
    `"${(lead.rcdsoAddress || lead.address || "").replace(/"/g, "'")}"`,
    lead.email || "",
    lead.phone || lead.rcdsoPhone || "",
    lead.status || "",
  ].join(","));

  console.log(`  ✓ ${fileName}`);
}

fs.writeFileSync(CSV_PATH, csvRows.join("\n"), "utf-8");

console.log(`\n${"─".repeat(56)}`);
console.log(`  Letters generated: ${generated}`);
console.log(`  Mailing CSV:       ${CSV_PATH}`);
console.log(`\n  To print: open each HTML in Chrome → Print → Save as PDF`);
console.log(`  Cost per letter: ~$1.30 stamp + $0.10 paper`);
console.log(`  Expected response rate: 2–5%`);
