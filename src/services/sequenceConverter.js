// src/services/sequenceConverter.js
// Converts markdown sequence files into three ready-to-import formats:
//   1. mailchimp-import.json  — Mailchimp Customer Journey reference payload
//   2. email-N-{slug}.html   — Clean HTML email (copy into any email tool)
//   3. email-N-{slug}.eml    — Standard .eml file (importable into Gmail/Outlook/Apple Mail)
//
// Output: data/deliveries/[client]/ready-to-import/[sequence]/

import fs from "fs";
import path from "path";

// ─── Clean filename slugs per sequence ───────────────────────────────────────

const EMAIL_SLUGS = {
  "missed-call-followup":   { 1: "01-immediate", 2: "02-two-hours", 3: "03-next-morning" },
  "reactivation-campaign":  { 1: "01-we-miss-you", 2: "02-whats-new", 3: "03-reason-to-return", 4: "04-hold-your-spot", 5: "05-door-stays-open" },
  "new-patient-welcome":    { 1: "01-booking-confirmed", 2: "02-day-before", 3: "03-post-visit-thanks", 4: "04-one-week-checkin" },
  "review-request":         { 1: "01-review-ask", 2: "02-review-followup" },
};

// ─── Sequences to convert ─────────────────────────────────────────────────────

const SEQUENCE_FILES = [
  "missed-call-followup",
  "reactivation-campaign",
  "new-patient-welcome",
  "review-request",
];

const SEQUENCE_META = {
  "missed-call-followup": {
    label: "Missed Call Recovery",
    trigger: "Missed call detected by phone system",
  },
  "reactivation-campaign": {
    label: "Patient Reactivation Campaign",
    trigger: "Patient inactive 12+ months — manual monthly batch",
  },
  "new-patient-welcome": {
    label: "New Patient Welcome",
    trigger: "New patient books first appointment",
  },
  "review-request": {
    label: "Google Review Request",
    trigger: "Appointment marked completed in PMS",
  },
};

// ─── Timing parser ────────────────────────────────────────────────────────────

function parseTiming(headerText) {
  const t = headerText;

  const rx = (pattern) => t.match(pattern);

  if (rx(/within (\d+) minute/i)) {
    const n = parseInt(rx(/within (\d+) minute/i)[1]);
    return { amount: n, unit: "minutes", delayDays: 0, label: `Within ${n} minutes of trigger` };
  }
  if (rx(/day of booking|immediately/i)) {
    return { amount: 0, unit: "days", delayDays: 0, label: "Immediately on trigger" };
  }
  if (rx(/(\d+) hours? later/i)) {
    const n = parseInt(rx(/(\d+) hours? later/i)[1]);
    return { amount: n, unit: "hours", delayDays: +(n / 24).toFixed(2), label: `${n} hours after trigger` };
  }
  if (rx(/next morning/i)) {
    return { amount: 1, unit: "days", delayDays: 1, label: "Next morning (~24h after trigger)" };
  }
  if (rx(/day before/i)) {
    return { amount: 1, unit: "days", delayDays: -1, label: "1 day before appointment", relative: true };
  }
  if (rx(/(\d+) days? after/i)) {
    const n = parseInt(rx(/(\d+) days? after/i)[1]);
    return { amount: n, unit: "days", delayDays: n, label: `${n} days after trigger` };
  }
  if (rx(/day after|1 day after/i)) {
    return { amount: 1, unit: "days", delayDays: 1, label: "1 day after trigger" };
  }
  if (rx(/week (\d+)/i)) {
    const n = parseInt(rx(/week (\d+)/i)[1]);
    return { amount: n * 7, unit: "days", delayDays: n * 7, label: `Week ${n} (day ${n * 7})` };
  }
  if (rx(/5 days? after/i)) {
    return { amount: 5, unit: "days", delayDays: 5, label: "5 days after trigger" };
  }

  return { amount: 0, unit: "days", delayDays: 0, label: headerText };
}

// ─── Markdown parser ──────────────────────────────────────────────────────────

/**
 * Parse a markdown sequence file into an array of email objects.
 * Handles headers of the form: ## Email N — ..., ## Primary Message — ..., ## Follow-Up — ...
 */
function parseEmailSections(markdown) {
  const emails = [];

  // Split into blocks by ## headers
  const blocks = markdown.split(/\n(?=## )/);
  let emailNum = 0;

  for (const block of blocks) {
    const firstLine = block.split("\n")[0];

    // Only process email section headers — skip How-to, Setup, Responding, etc.
    if (!/^## (Email \d+|Primary Message|Follow-Up)\b/i.test(firstLine)) continue;

    emailNum++;
    const header = firstLine.replace(/^## /, "").trim();

    // Get block content (everything after the ## header line)
    let content = block.replace(/^[^\n]+\n/, "").trim();

    // Cut at --- that precedes implementation notes or non-email sections
    const sepIdx = content.indexOf("\n---");
    if (sepIdx !== -1) {
      const afterSep = content.slice(sepIdx + 4).trimStart();
      if (/^\*\*Implementation|^\*\*How to|^\*\*Note|^## (How|Responding|What|Setup)/i.test(afterSep)) {
        content = content.slice(0, sepIdx).trim();
      }
    }
    // Also strip a trailing ---
    content = content.replace(/\n---\s*$/, "").trim();

    // Extract subject
    const subjectMatch = content.match(/\*\*Subject:\*\*\s*(.+)/);
    if (!subjectMatch) continue;
    const subject = subjectMatch[1].trim();

    // Body = everything after the subject line
    const subjectEnd = content.indexOf(subjectMatch[0]) + subjectMatch[0].length;
    const body = content.slice(subjectEnd).trim();

    // Safe filename slug from header
    const slug = header
      .toLowerCase()
      .replace(/["']/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 44);

    emails.push({
      number: emailNum,
      header,
      timing: parseTiming(header),
      subject,
      body,
      slug,
    });
  }

  return emails;
}

// ─── HTML generator ───────────────────────────────────────────────────────────

function escapeHtml(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatInline(line) {
  return escapeHtml(line)
    // **bold**
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    // [PLACEHOLDER] — highlight so clinics notice them
    .replace(/\[([A-Z][A-Za-z0-9 /]+)\]/g,
      '<span style="background:#fff3cd;color:#b7570a;font-weight:bold;padding:1px 4px;border-radius:2px;font-size:13px;">[$1]</span>');
}

function bodyToHtml(text) {
  const out = [];
  let inList = false;
  const listItems = [];

  const flushList = () => {
    if (inList && listItems.length) {
      out.push(`<ul style="margin:8px 0 16px 0;padding-left:20px;">${listItems.splice(0).join("")}</ul>`);
      inList = false;
    }
  };

  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) { flushList(); continue; }

    if (trimmed.startsWith("- ")) {
      inList = true;
      listItems.push(`<li style="margin:4px 0;">${formatInline(trimmed.slice(2))}</li>`);
      continue;
    }

    flushList();
    out.push(`<p style="margin:0 0 14px 0;">${formatInline(line)}</p>`);
  }

  flushList();
  return out.join("\n      ");
}

function generateHTML(email, clientInfo, seqLabel) {
  const bodyHtml = bodyToHtml(email.body);
  const domain = (clientInfo.website || "yourclinic.com")
    .replace(/^https?:\/\//, "").replace(/\/$/, "");

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="X-UA-Compatible" content="IE=edge">
<title>${escapeHtml(email.subject)}</title>
</head>
<body style="margin:0;padding:0;background-color:#f2f2f2;">

<table role="presentation" cellpadding="0" cellspacing="0" width="100%"
  style="background-color:#f2f2f2;padding:28px 0;">
<tr><td align="center">

<table role="presentation" cellpadding="0" cellspacing="0" width="600"
  style="max-width:600px;width:100%;background:#ffffff;border-radius:4px;overflow:hidden;">

  <!-- Header bar -->
  <tr>
    <td style="background-color:#2c3e50;padding:18px 32px;">
      <p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:13px;
         color:#ffffff;letter-spacing:0.4px;">${escapeHtml(clientInfo.name)}</p>
    </td>
  </tr>

  <!-- Body -->
  <tr>
    <td style="padding:32px 32px 20px 32px;font-family:Arial,Helvetica,sans-serif;
       font-size:15px;line-height:1.65;color:#333333;">
      ${bodyHtml}
    </td>
  </tr>

  <!-- Footer -->
  <tr>
    <td style="background-color:#f9f9f9;padding:16px 32px;border-top:1px solid #e8e8e8;">
      <p style="margin:0 0 4px 0;font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#aaaaaa;">
        ${escapeHtml(clientInfo.name)}&nbsp;&middot;&nbsp;${escapeHtml(clientInfo.city || "")}
      </p>
      <p style="margin:0 0 4px 0;font-family:Arial,Helvetica,sans-serif;font-size:11px;color:#cccccc;">
        <em>To stop receiving messages, reply with &ldquo;unsubscribe&rdquo;.</em>
      </p>
      <p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:10px;color:#dddddd;">
        This automation complies with PIPEDA (Canadian privacy law). Patient data is never stored or shared.
      </p>
    </td>
  </tr>

</table>

<!-- Developer reference -->
<!--
  Sequence : ${escapeHtml(seqLabel)}
  Email    : ${email.number} of sequence
  Subject  : ${escapeHtml(email.subject)}
  Timing   : ${escapeHtml(email.timing.label)}
  Generated: ClinicFlow delivery engine
-->

</td></tr>
</table>

</body>
</html>`;
}

// ─── EML generator ────────────────────────────────────────────────────────────

function generateEML(email, clientInfo, seqLabel) {
  const domain = (clientInfo.website || "yourclinic.com")
    .replace(/^https?:\/\//, "").replace(/\/$/, "");
  const fromEmail = `contact@${domain}`;
  const date = new Date().toUTCString();
  const boundary = `_cfbound_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const html = generateHTML(email, clientInfo, seqLabel);

  return [
    "MIME-Version: 1.0",
    `Date: ${date}`,
    `From: "${clientInfo.name}" <${fromEmail}>`,
    "To: [PatientFirstName] <patient@example.com>",
    `Subject: ${email.subject}`,
    `X-CF-Sequence: ${seqLabel}`,
    `X-CF-Email-Number: ${email.number}`,
    `X-CF-Send-Timing: ${email.timing.label}`,
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: 8bit",
    "",
    email.body,
    "",
    `--${boundary}`,
    "Content-Type: text/html; charset=UTF-8",
    "Content-Transfer-Encoding: 8bit",
    "",
    html,
    "",
    `--${boundary}--`,
  ].join("\r\n");
}

// ─── Mailchimp JSON generator ─────────────────────────────────────────────────

function generateMailchimpJSON(emails, clientInfo, seqName) {
  const meta = SEQUENCE_META[seqName] || { label: seqName, trigger: "Custom trigger" };
  const domain = (clientInfo.website || "yourclinic.com")
    .replace(/^https?:\/\//, "").replace(/\/$/, "");

  return {
    _note: "Mailchimp Customer Journey reference file. Use the data below when building your automation in Mailchimp: Automations → Customer Journeys → Create Journey.",
    automation_name: meta.label,
    trigger: meta.trigger,
    client: clientInfo.name,
    city: clientInfo.city || "",
    from_name: clientInfo.name,
    from_email: `contact@${domain}`,
    total_emails: emails.length,
    sequence_duration_days: emails.at(-1)?.timing.delayDays ?? 0,
    emails: emails.map((e) => ({
      step: e.number,
      timing: {
        label: e.timing.label,
        amount: e.timing.amount,
        unit: e.timing.unit,
        mailchimp_delay_setting: e.timing.amount === 0
          ? "Send immediately after trigger"
          : `Wait ${e.timing.amount} ${e.timing.unit} after previous step`,
      },
      subject_line: e.subject,
      subject_char_count: e.subject.length,
      preview_text: e.body.split("\n").find((l) => l.trim() && !/^Hi /.test(l.trim())) || "",
      body_plain_text: e.body,
      body_word_count: e.body.split(/\s+/).filter(Boolean).length,
      placeholders_to_fill: [
        ...new Set([...e.body.matchAll(/\[([^\]]+)\]/g)].map((m) => m[0])),
      ],
    })),
  };
}

// ─── Main export ──────────────────────────────────────────────────────────────

/**
 * Convert all sequence files in a delivery directory to import-ready formats.
 * @param {string} deliveryDir   — path to client delivery folder
 * @param {{ name, city, website }} clientInfo
 * @returns {{ outDir, results }}
 */
export { parseEmailSections };

export async function convertSequences(deliveryDir, clientInfo) {
  const outDir = path.join(deliveryDir, "ready-to-import");
  fs.mkdirSync(outDir, { recursive: true });

  const results = [];

  for (const seqName of SEQUENCE_FILES) {
    const mdPath = path.join(deliveryDir, `${seqName}.md`);
    if (!fs.existsSync(mdPath)) {
      results.push({ sequence: seqName, skipped: true, reason: "file not in this tier" });
      continue;
    }

    const markdown = fs.readFileSync(mdPath, "utf-8");
    const emails = parseEmailSections(markdown);

    if (emails.length === 0) {
      results.push({ sequence: seqName, error: "No emails could be parsed from markdown" });
      continue;
    }

    const seqDir = path.join(outDir, seqName);
    fs.mkdirSync(seqDir, { recursive: true });

    const seqLabel = SEQUENCE_META[seqName]?.label || seqName;
    const files = [];

    // 1. Mailchimp JSON
    const jsonContent = generateMailchimpJSON(emails, clientInfo, seqName);
    fs.writeFileSync(
      path.join(seqDir, "mailchimp-import.json"),
      JSON.stringify(jsonContent, null, 2)
    );
    files.push("mailchimp-import.json");

    // 2. HTML + EML per email
    for (const email of emails) {
      const cleanSlug = EMAIL_SLUGS[seqName]?.[email.number]
        ?? `${String(email.number).padStart(2, "0")}-email`;
      const base = cleanSlug;

      fs.writeFileSync(
        path.join(seqDir, `${base}.html`),
        generateHTML(email, clientInfo, seqLabel)
      );
      files.push(`${base}.html`);

      fs.writeFileSync(
        path.join(seqDir, `${base}.eml`),
        generateEML(email, clientInfo, seqLabel)
      );
      files.push(`${base}.eml`);
    }

    results.push({ sequence: seqName, label: seqLabel, emailCount: emails.length, files });
    console.log(`  ✓ ${seqLabel}: ${emails.length} emails → ${files.length} files`);
  }

  return { outDir, results };
}
