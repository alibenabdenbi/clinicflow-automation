// src/services/intakeHandler.js
// Detects onboarding reply emails from known clients.
// Handles: CSV patient list attachment, booking link, review link, clinic email.
// Called from replyHandler.js processMailbox when a message matches a known client.
//
// Returns: { handled: boolean, summary: string }

import fs from "fs";
import path from "path";

const CLIENTS_PATH  = path.join(process.cwd(), "data", "clients.json");
const CLIENTS_DIR   = path.join(process.cwd(), "data", "clients");
const NOTIFY_EMAIL  = process.env.NOTIFY_EMAIL || "m.aliben432@gmail.com";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function readJsonSafe(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, "utf-8"));
  } catch {
    return fallback;
  }
}

function writeJsonSafe(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
}

function safeClinicDir(clinicName) {
  return (clinicName || "unknown")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 50);
}

// ─── Link extractors ──────────────────────────────────────────────────────────

function extractBookingLink(text) {
  // Jane App links, common booking page patterns
  const patterns = [
    /https?:\/\/[a-z0-9\-]+\.janeapp\.com[^\s]*/gi,
    /https?:\/\/[^\s]*(?:book|booking|appointment|schedule|reserve)[^\s]*/gi,
    /https?:\/\/[^\s]*(?:calendly|acuityscheduling|mindbodyonline)[^\s]*/gi,
  ];
  for (const re of patterns) {
    const m = text.match(re);
    if (m) return m[0].replace(/[.,;)>\]]+$/, "");
  }
  return null;
}

function extractReviewLink(text) {
  // Google Maps review links
  const m = text.match(/https?:\/\/(?:maps\.google\.com|goo\.gl|g\.page|maps\.app\.goo\.gl)[^\s]*/gi);
  if (m) return m[0].replace(/[.,;)>\]]+$/, "");
  // search.google.com/local/writereview
  const m2 = text.match(/https?:\/\/search\.google\.com[^\s]*/gi);
  if (m2) return m2[0].replace(/[.,;)>\]]+$/, "");
  return null;
}

function extractClinicEmailFromBody(text, senderEmail) {
  // Look for an email different from the sender's that looks like a clinic address
  const allEmails = [...text.matchAll(/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g)]
    .map(m => m[0].toLowerCase())
    .filter(e => e !== senderEmail?.toLowerCase() && !e.includes("clinicflowautomation"));
  return allEmails[0] || null;
}

function countCsvRows(csvText) {
  const lines = csvText.split(/\r?\n/).filter(l => l.trim());
  return Math.max(0, lines.length - 1); // subtract header
}

// ─── Main export ──────────────────────────────────────────────────────────────

/**
 * Checks if an incoming email is an onboarding reply from a known client.
 * If so, handles it: saves CSV, extracts links, updates client record.
 *
 * @param {Object} opts
 * @param {string}   opts.fromEmail
 * @param {string}   opts.subject
 * @param {string}   opts.body         — plain text body
 * @param {Array}    opts.attachments  — [{ filename, content (Buffer|string), contentType }]
 * @param {Array}    opts.allRecords   — full outreach.localDentists.json (for clinic lookup)
 * @returns {{ handled: boolean, summary: string, notifyMessage: string|null }}
 */
export async function handleIntake({ fromEmail, subject, body = "", attachments = [], allRecords = [] }) {
  // 1. Is this from a known client?
  const clients = readJsonSafe(CLIENTS_PATH, []);
  const domain  = (fromEmail || "").split("@")[1]?.toLowerCase();

  let client = clients.find(c => c.email?.toLowerCase() === fromEmail.toLowerCase());
  if (!client && domain) {
    // Domain match fallback
    client = clients.find(c => c.email?.split("@")[1]?.toLowerCase() === domain);
  }

  if (!client) return { handled: false, summary: "", notifyMessage: null };

  // Only handle clients in onboarding status (or no status set yet)
  if (client.status && !["onboarding", "first_half_received"].includes(client.status)) {
    return { handled: false, summary: "", notifyMessage: null };
  }

  const clinicName = client.clinicName || fromEmail.split("@")[0];
  const dirName    = safeClinicDir(clinicName);
  const clientDir  = path.join(CLIENTS_DIR, dirName);
  fs.mkdirSync(clientDir, { recursive: true });

  const updates = {};
  const findings = [];

  // 2. Look for CSV attachment
  let patientCount = 0;
  const csvAttachment = attachments.find(a =>
    /\.csv$/i.test(a.filename || "") ||
    (a.contentType || "").includes("text/csv") ||
    (a.contentType || "").includes("application/vnd.ms-excel")
  );

  if (csvAttachment) {
    const csvText = typeof csvAttachment.content === "string"
      ? csvAttachment.content
      : csvAttachment.content?.toString("utf-8") || "";
    const csvPath = path.join(clientDir, "patients.csv");
    fs.writeFileSync(csvPath, csvText, "utf-8");
    patientCount = countCsvRows(csvText);
    updates.patientCsvPath     = csvPath;
    updates.patientCount       = patientCount;
    updates.patientListReceivedAt = new Date().toISOString();
    findings.push(`CSV saved: ${patientCount} patients → ${csvPath}`);
  }

  // 3. Extract booking link
  const bookingLink = extractBookingLink(body);
  if (bookingLink) {
    updates.bookingLink = bookingLink;
    findings.push(`Booking link: ${bookingLink}`);
  }

  // 4. Extract review link
  const reviewLink = extractReviewLink(body);
  if (reviewLink) {
    updates.reviewLink = reviewLink;
    findings.push(`Review link: ${reviewLink}`);
  }

  // 5. Extract clinic email from body
  const clinicEmailInBody = extractClinicEmailFromBody(body, fromEmail);
  if (clinicEmailInBody) {
    updates.clinicPatientEmail = clinicEmailInBody;
    findings.push(`Clinic email (patient-facing): ${clinicEmailInBody}`);
  }

  // 6. Save raw reply body for reference
  const replyPath = path.join(clientDir, `intake-reply-${Date.now()}.txt`);
  fs.writeFileSync(replyPath, `From: ${fromEmail}\nSubject: ${subject}\n\n${body}`, "utf-8");
  findings.push(`Raw reply saved: ${replyPath}`);

  // 7. Update client record
  const idx = clients.findIndex(c => c.email?.toLowerCase() === fromEmail.toLowerCase()
    || c.email?.split("@")[1]?.toLowerCase() === domain);
  if (idx !== -1) {
    Object.assign(clients[idx], updates, { intakeReceivedAt: new Date().toISOString() });
    writeJsonSafe(CLIENTS_PATH, clients);
  }

  // 8. Build notify message for operator
  const lines = [
    `Intake reply received from ${clinicName} <${fromEmail}>`,
    ``,
  ];
  if (patientCount > 0) {
    lines.push(`Patient list: ${patientCount} patients received`);
    lines.push(`Next step — run: npm run build:reactivation -- --client "${clinicName}"`);
    lines.push(``);
  }
  if (findings.length) {
    lines.push(`Extracted:`);
    findings.forEach(f => lines.push(`  • ${f}`));
  }
  if (!csvAttachment) {
    lines.push(`  ⚠ No CSV attachment found — may need to follow up for patient list`);
  }

  const notifyMessage = lines.join("\n");
  const summary = `Intake from ${clinicName}: ${patientCount} patients, ${findings.length} fields extracted`;

  return { handled: true, summary, notifyMessage };
}
