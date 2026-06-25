// src/cli/generateWelcomePDF.js
// Generates a 1-page welcome PDF for a new ClinicFlow client.
// Attached automatically to Email 1 by deliveryEngine.js.
//
// Uses pdfkit (pure JS, no binary deps).
//
// Usage:
//   node src/cli/generateWelcomePDF.js --client "Museum Dental" --tier growth
//   Returns: path to generated PDF

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT      = path.resolve(__dirname, "../..");
const OUT_DIR   = path.join(ROOT, "data", "welcome-pdfs");

// ─── Colour palette ───────────────────────────────────────────────────────────
const NAVY   = "#0a1628";
const BLUE   = "#1a3a6e";
const ACCENT = "#4a90d9";
const WHITE  = "#ffffff";
const LIGHT  = "#8ba4c8";
const BODY   = "#c8d8f0";

// ─── Content ──────────────────────────────────────────────────────────────────

function buildContent(clinicName, tier) {
  const tierDetails = {
    starter: { label: "Starter", price: "$397", items: [
      "Patient reactivation campaign",
      "Appointment reminder system (SMS)",
      "Missed call follow-up sequence",
    ]},
    growth: { label: "Growth", price: "$997", items: [
      "Patient reactivation campaign",
      "Appointment reminder system (SMS — 72h & 24h)",
      "Missed call follow-up sequence",
      "New patient welcome sequence",
      "Google review automation",
      "Monthly results report",
    ]},
    full: { label: "Full", price: "$2,497", items: [
      "Everything in Growth",
      "Custom email sequences (3 campaigns)",
      "Referral program automation",
      "Priority support + quarterly strategy call",
      "Advanced analytics dashboard",
    ]},
  };

  const tierKey = (tier || "growth").toLowerCase();
  const tierInfo = tierDetails[tierKey] || tierDetails.growth;

  return { clinicName, tierInfo };
}

// ─── PDF generation ───────────────────────────────────────────────────────────

export async function generateWelcomePDF(clinicName, tier = "growth") {
  // Lazy-import pdfkit so the rest of the app doesn't require it
  let PDFDocument;
  try {
    const mod = await import("pdfkit");
    PDFDocument = mod.default || mod;
  } catch {
    throw new Error(
      "pdfkit is not installed. Run: npm install pdfkit\n" +
      "Then retry: node src/cli/generateWelcomePDF.js"
    );
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });

  const slug = (clinicName || "clinic")
    .toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  const outPath = path.join(OUT_DIR, `welcome-${slug}.pdf`);

  const { tierInfo } = buildContent(clinicName, tier);

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 0 });
    const stream = fs.createWriteStream(outPath);
    doc.pipe(stream);

    const W = 595.28;
    const H = 841.89;

    // ── Background ─────────────────────────────────────────────────────────
    doc.rect(0, 0, W, H).fill(NAVY);

    // ── Top accent bar ──────────────────────────────────────────────────────
    doc.rect(0, 0, W, 6).fill(ACCENT);

    // ── Left sidebar ────────────────────────────────────────────────────────
    doc.rect(0, 6, 220, H - 6).fill(BLUE);

    // Sidebar: brand
    doc.fillColor(ACCENT)
       .font("Helvetica-Bold")
       .fontSize(9)
       .text("CLINICFLOW AUTOMATION", 30, 50, { width: 160, characterSpacing: 1.2 });

    doc.fillColor(WHITE)
       .font("Helvetica-Bold")
       .fontSize(18)
       .text("Welcome\nPackage", 30, 72, { width: 160, lineGap: 4 });

    // Sidebar: what's included
    doc.fillColor(ACCENT)
       .font("Helvetica-Bold")
       .fontSize(8)
       .text("WHAT'S INCLUDED", 30, 160, { width: 160, characterSpacing: 1 });

    doc.moveDown(0.4);
    let itemY = 182;
    for (const item of tierInfo.items) {
      doc.fillColor(ACCENT).font("Helvetica-Bold").fontSize(10).text("✓", 30, itemY);
      doc.fillColor(BODY).font("Helvetica").fontSize(10).text(item, 50, itemY, { width: 150 });
      itemY += 22;
    }

    // Sidebar: contact
    doc.fillColor(LIGHT)
       .font("Helvetica")
       .fontSize(9)
       .text("Your dedicated automation specialist", 30, H - 180, { width: 160 });

    doc.fillColor(WHITE)
       .font("Helvetica-Bold")
       .fontSize(11)
       .text("Mohamed", 30, H - 158);

    doc.fillColor(LIGHT)
       .font("Helvetica")
       .fontSize(9)
       .text("ClinicFlow Automation", 30, H - 142)
       .text("438-544-0442", 30, H - 128)
       .text("contact@clinicflowautomation.com", 30, H - 114);

    // ── Main content area ────────────────────────────────────────────────────
    const MX = 248; // main content left edge
    const MW = W - MX - 32;

    // Clinic name
    doc.fillColor(ACCENT)
       .font("Helvetica-Bold")
       .fontSize(9)
       .text("PREPARED FOR", MX, 50, { characterSpacing: 1 });

    doc.fillColor(WHITE)
       .font("Helvetica-Bold")
       .fontSize(24)
       .text(clinicName || "Your Clinic", MX, 68, { width: MW });

    doc.fillColor(LIGHT)
       .font("Helvetica")
       .fontSize(11)
       .text(`${tierInfo.label} Package — ${tierInfo.price}`, MX, 102);

    // Divider
    doc.rect(MX, 126, MW, 1).fill(BLUE);

    // Timeline section
    doc.fillColor(ACCENT)
       .font("Helvetica-Bold")
       .fontSize(9)
       .text("YOUR SETUP TIMELINE", MX, 144, { characterSpacing: 1 });

    const timeline = [
      ["TODAY",  "Mohamed reviews your practice and prepares your custom setup"],
      ["DAY 2",  "Patient reactivation campaign goes live"],
      ["DAY 3",  "Appointment reminders activate for upcoming bookings"],
      ["DAY 4",  "Missed call follow-up sequence tested and confirmed"],
      ["DAY 5",  "Full system review — summary of everything running sent to you"],
      ["DAY 30", "Your first results report delivered"],
    ];

    let tlY = 168;
    for (const [day, event] of timeline) {
      doc.fillColor(ACCENT).font("Helvetica-Bold").fontSize(9).text(day.padEnd(6), MX, tlY, { width: 44 });
      doc.fillColor(BODY).font("Helvetica").fontSize(9).text(event, MX + 50, tlY, { width: MW - 50 });
      tlY += 20;
    }

    // Divider
    doc.rect(MX, tlY + 8, MW, 1).fill(BLUE);

    // How it works
    doc.fillColor(ACCENT)
       .font("Helvetica-Bold")
       .fontSize(9)
       .text("HOW IT WORKS", MX, tlY + 24, { characterSpacing: 1 });

    const howItWorks = [
      "You provide your patient list — one CSV export from your booking system.",
      "Mohamed builds and configures everything. You don't touch any technical settings.",
      "Campaigns go live. Patients receive emails and SMS automatically.",
      "You receive replies from interested patients directly in your inbox.",
      "Monthly results reports show you exactly what was recovered.",
    ];

    let hiY = tlY + 48;
    for (let i = 0; i < howItWorks.length; i++) {
      const numY = hiY;
      doc.fillColor(ACCENT).font("Helvetica-Bold").fontSize(9).text(String(i + 1) + ".", MX, numY, { width: 16 });
      doc.fillColor(BODY).font("Helvetica").fontSize(9).text(howItWorks[i], MX + 20, numY, { width: MW - 20 });
      hiY += 22;
    }

    // Guarantee box
    const gBoxY = H - 120;
    doc.rect(MX, gBoxY, MW, 72).fill("#0f1f3d");
    doc.rect(MX, gBoxY, 3, 72).fill(ACCENT);

    doc.fillColor(WHITE)
       .font("Helvetica-Bold")
       .fontSize(10)
       .text("30-Day Satisfaction Guarantee", MX + 16, gBoxY + 14, { width: MW - 20 });

    doc.fillColor(LIGHT)
       .font("Helvetica")
       .fontSize(9)
       .text(
         "If you're not satisfied with the results within the first 30 days, " +
         "the second half of your payment is fully refunded — no questions asked.",
         MX + 16, gBoxY + 32, { width: MW - 24 }
       );

    doc.end();
    stream.on("finish", () => resolve(outPath));
    stream.on("error", reject);
  });
}

// ─── CLI entry point ──────────────────────────────────────────────────────────

if (process.argv[1] && process.argv[1].endsWith("generateWelcomePDF.js")) {
  const argClientIdx = process.argv.indexOf("--client");
  const argTierIdx   = process.argv.indexOf("--tier");
  const clinicName   = argClientIdx !== -1 ? process.argv[argClientIdx + 1] : "Your Clinic";
  const tier         = argTierIdx   !== -1 ? process.argv[argTierIdx   + 1] : "growth";

  generateWelcomePDF(clinicName, tier)
    .then(p => console.log(`✓ PDF generated: ${p}`))
    .catch(err => { console.error("generateWelcomePDF failed:", err.message); process.exit(1); });
}
