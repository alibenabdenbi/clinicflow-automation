// src/cli/buildReactivation.js
// Reads a client's patient CSV, identifies inactive patients (12+ months),
// and generates a personalized reactivation email sequence for each.
//
// Usage:
//   npm run build:reactivation -- --client "Clinic Name"
//   npm run build:reactivation -- --client "Clinic Name" --months 12
//   npm run build:reactivation -- --client "Clinic Name" --dry-run

import fs from "fs";
import path from "path";
import dotenv from "dotenv";

dotenv.config();

const CLIENTS_PATH = path.join(process.cwd(), "data", "clients.json");
const CLIENTS_DIR  = path.join(process.cwd(), "data", "clients");

// ─── Args ─────────────────────────────────────────────────────────────────────

function getArg(flag) {
  const i = process.argv.indexOf(flag);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : null;
}

const clientName = getArg("--client");
const monthsArg  = Number(getArg("--months") || "12");
const dryRun     = process.argv.includes("--dry-run");

if (!clientName) {
  console.error("Usage: npm run build:reactivation -- --client \"Clinic Name\" [--months 12]");
  process.exit(1);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function readJsonSafe(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, "utf-8"));
  } catch { return fallback; }
}

function writeJsonSafe(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
}

function safeClinicDir(name) {
  return (name || "unknown")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 50);
}

// ─── CSV parser (no dependencies) ─────────────────────────────────────────────

function parseCsv(text) {
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  if (lines.length < 2) return [];

  function splitRow(line) {
    const cells = [];
    let cur = "";
    let inQuote = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuote && line[i + 1] === '"') { cur += '"'; i++; }
        else inQuote = !inQuote;
      } else if (ch === "," && !inQuote) {
        cells.push(cur.trim()); cur = "";
      } else {
        cur += ch;
      }
    }
    cells.push(cur.trim());
    return cells;
  }

  const headers = splitRow(lines[0]).map(h => h.toLowerCase().replace(/[^a-z0-9]+/g, "_"));
  return lines.slice(1).map(line => {
    const values = splitRow(line);
    const row = {};
    headers.forEach((h, i) => { row[h] = values[i] || ""; });
    return row;
  });
}

// ─── Date detection ────────────────────────────────────────────────────────────

// Common column names for last visit date in Jane App / Dentrix exports
const DATE_COLUMNS = [
  "last_visit", "last_visit_date", "last_appointment", "last_appointment_date",
  "last_seen", "last_seen_date", "date_of_last_visit", "last_visit_on",
  "most_recent_visit", "last_completed_visit", "last_appt_date", "last_appt",
];

// Common column names for patient email
const EMAIL_COLUMNS = [
  "email", "email_address", "patient_email", "e_mail", "contact_email",
];

// Common column names for patient name
const FNAME_COLUMNS = ["first_name", "firstname", "given_name", "fname", "patient_first_name"];
const LNAME_COLUMNS = ["last_name", "lastname", "surname", "lname", "family_name", "patient_last_name"];
const FULLNAME_COLUMNS = ["name", "full_name", "patient_name", "patient"];

function findColumn(headers, candidates) {
  return candidates.find(c => headers.includes(c)) || null;
}

function parseDate(str) {
  if (!str) return null;
  // Try ISO, MM/DD/YYYY, DD/MM/YYYY, YYYY-MM-DD
  const cleaned = str.trim().replace(/[^\d\/\-]/g, " ").trim();
  const d = new Date(cleaned);
  if (!isNaN(d.getTime())) return d;
  // Try MM/DD/YYYY
  const mdy = cleaned.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
  if (mdy) {
    const [, m, d2, y] = mdy;
    const fullY = y.length === 2 ? (Number(y) > 50 ? "19" : "20") + y : y;
    const dt = new Date(`${fullY}-${m.padStart(2,"0")}-${d2.padStart(2,"0")}`);
    if (!isNaN(dt.getTime())) return dt;
  }
  return null;
}

function isInactive(lastVisitDate, months) {
  if (!lastVisitDate) return true; // no date = assume inactive
  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - months);
  return lastVisitDate < cutoff;
}

// ─── Email sequence builder ────────────────────────────────────────────────────

function capitalize(s) {
  return s ? s.charAt(0).toUpperCase() + s.slice(1).toLowerCase() : "";
}

function buildReactivationSequence(patient, clinicName, bookingLink, reviewLink, clinicPhone) {
  const firstName = capitalize(patient._firstName) || "there";
  const booking   = bookingLink  || "[booking link]";
  const phone     = clinicPhone  || "";
  const sign      = `The team at ${clinicName}`;

  // Email 1 — week 1 (day 0): warm check-in
  const email1 = {
    day: 0,
    subject: `Hi ${firstName} — it's been a while`,
    body: `Hi ${firstName},

It's been a while since we've seen you at ${clinicName}, and we wanted to check in.

Regular check-ups catch small things before they become bigger issues — and most visits take less than an hour.

If you're ready to book:
${booking}

If you have any questions first, just reply to this email.

${sign}`,
  };

  // Email 2 — week 2 (day 7): new update
  const email2 = {
    day: 7,
    subject: `A few things have changed at ${clinicName}`,
    body: `Hi ${firstName},

Wanted to follow up on my last note — and share a quick update.

We've been working on making visits as smooth as possible: shorter wait times, online booking, and text reminders before every appointment so nothing slips through the cracks.

If you'd like to get back in for a check-up or cleaning:
${booking}

Always happy to answer any questions — just reply here${phone ? ` or call us at ${phone}` : ""}.

${sign}`,
  };

  // Email 3 — week 4 (day 21): gentle urgency
  const email3 = {
    day: 21,
    subject: `Quick question, ${firstName}`,
    body: `Hi ${firstName},

Quick question — when was your last professional cleaning?

For most people, 6 months is the recommended window. If it's been longer, a quick visit now is much simpler (and cheaper) than waiting until there's an issue.

We have availability coming up:
${booking}

${sign}`,
  };

  // Email 4 — week 6 (day 35): hold your spot
  const email4 = {
    day: 35,
    subject: `We want to keep your spot, ${firstName}`,
    body: `Hi ${firstName},

We'd love to keep you as a patient at ${clinicName}.

If life has just been busy — completely understandable. We make it easy to come back with no judgment, flexible scheduling, and reminders so you never have to think about it.

Book when you're ready:
${booking}

${phone ? `Or call us directly: ${phone}\n\n` : ""}${sign}`,
  };

  // Email 5 — week 8 (day 49): graceful exit
  const email5 = {
    day: 49,
    subject: `Our last note to you, ${firstName}`,
    body: `Hi ${firstName},

This is the last note we'll send — we don't want to fill your inbox.

If you ever want to come back to ${clinicName}, the door is always open:
${booking}

${reviewLink ? `And if you have a moment, we'd love to hear about your past experience:\n${reviewLink}\n\n` : ""}Wishing you and your family good health.

${sign}`,
  };

  return [email1, email2, email3, email4, email5];
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  // Find client record
  const clients = readJsonSafe(CLIENTS_PATH, []);
  const client  = clients.find(c =>
    (c.clinicName || "").toLowerCase() === clientName.toLowerCase()
  );

  const dirName   = safeClinicDir(clientName);
  const clientDir = path.join(CLIENTS_DIR, dirName);
  const csvPath   = path.join(clientDir, "patients.csv");

  if (!fs.existsSync(csvPath)) {
    console.error(`No patient CSV found at: ${csvPath}`);
    console.error(`Make sure the client has replied to the onboarding email with their patient list.`);
    process.exit(1);
  }

  const csvText = fs.readFileSync(csvPath, "utf-8");
  const rows    = parseCsv(csvText);

  if (rows.length === 0) {
    console.error(`CSV at ${csvPath} appears empty or unparseable.`);
    process.exit(1);
  }

  const headers = Object.keys(rows[0]);

  // Detect columns
  const dateCol  = findColumn(headers, DATE_COLUMNS);
  const emailCol = findColumn(headers, EMAIL_COLUMNS);
  const fnCol    = findColumn(headers, FNAME_COLUMNS);
  const lnCol    = findColumn(headers, LNAME_COLUMNS);
  const nameCol  = findColumn(headers, FULLNAME_COLUMNS);

  console.log(`\n══ Reactivation Campaign Builder ════════════════`);
  console.log(`Client:  ${clientName}`);
  console.log(`CSV:     ${csvPath}`);
  console.log(`Rows:    ${rows.length}`);
  console.log(`Columns detected:`);
  console.log(`  Last visit date : ${dateCol || "(not found — all marked inactive)"}`);
  console.log(`  Email           : ${emailCol || "(not found — emails missing)"}`);
  console.log(`  First name      : ${fnCol || "(using name column)"}`);
  console.log(`  Last name       : ${lnCol || "(not found)"}`);
  console.log(`════════════════════════════════════════════════\n`);

  const cutoffLabel = `${monthsArg} months`;
  const bookingLink = client?.bookingLink  || null;
  const reviewLink  = client?.reviewLink   || null;
  const clinicPhone = client?.clinicPhone  || null;

  // Filter inactive patients
  const queue = [];
  let noEmail = 0;
  let noDate  = 0;
  let active  = 0;

  for (const row of rows) {
    const lastVisitStr = dateCol ? row[dateCol] : null;
    const lastVisit    = parseDate(lastVisitStr);
    if (!lastVisit) noDate++;

    if (!isInactive(lastVisit, monthsArg)) {
      active++;
      continue;
    }

    const patientEmail = emailCol ? row[emailCol]?.trim() : null;
    if (!patientEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(patientEmail)) {
      noEmail++;
      continue;
    }

    // Build name
    let firstName = fnCol ? row[fnCol] : "";
    let lastName  = lnCol ? row[lnCol] : "";
    if (!firstName && nameCol) {
      const parts = (row[nameCol] || "").trim().split(/\s+/);
      firstName = parts[0] || "";
      lastName  = parts.slice(1).join(" ") || "";
    }

    const sequence = buildReactivationSequence(
      { _firstName: firstName, _lastName: lastName },
      clientName,
      bookingLink,
      reviewLink,
      clinicPhone
    );

    queue.push({
      patientEmail,
      firstName: capitalize(firstName),
      lastName:  capitalize(lastName),
      lastVisit: lastVisitStr || "(unknown)",
      status: "pending",
      sequence,
    });
  }

  // Stats
  console.log(`Total patients:   ${rows.length}`);
  console.log(`Active (< ${cutoffLabel}): ${active}`);
  console.log(`No date in CSV:   ${noDate}`);
  console.log(`No email:         ${noEmail}`);
  console.log(`In campaign:      ${queue.length}`);

  if (queue.length === 0) {
    console.log(`\nNo inactive patients with valid emails found.`);
    console.log(`Check that the CSV has email and last-visit-date columns.`);
    console.log(`Column headers found: ${headers.join(", ")}`);
    return;
  }

  // Preview first 3
  console.log(`\nSample patients:`);
  queue.slice(0, 3).forEach((p, i) => {
    console.log(`  ${i + 1}. ${p.firstName} ${p.lastName} <${p.patientEmail}> — last visit: ${p.lastVisit}`);
  });

  if (dryRun) {
    console.log(`\n[DRY RUN] No files written. Remove --dry-run to save campaign.`);
    return;
  }

  // Save campaign
  const queuePath = path.join(clientDir, "reactivation-queue.json");
  writeJsonSafe(queuePath, {
    generatedAt: new Date().toISOString(),
    clinicName: clientName,
    totalPatients: rows.length,
    inactiveMonths: monthsArg,
    campaignSize: queue.length,
    bookingLink,
    reviewLink,
    patients: queue,
  });

  console.log(`\n✓ Campaign saved → ${queuePath}`);
  console.log(`\nNext step: review the queue and send with your email tool.`);
  console.log(`Each patient gets a 3-email sequence at day 0, 7, and 21.`);
  console.log(`\nWhen delivery is confirmed, run:`);
  console.log(`  npm run payment:confirm -- --client "${clientName}" --email [their_email] --tier [tier] --method [method] --payment second_half`);
}

main().catch(e => {
  console.error("buildReactivation failed:", e.message);
  process.exit(1);
});
