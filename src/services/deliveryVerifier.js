// src/services/deliveryVerifier.js
// Post-generation quality checker for ClinicFlow delivery packages.
// Runs after deliveryEngine generates all files.
// Writes verification-report.md to the delivery directory.

import fs from "fs";
import path from "path";

// ─── Rules ───────────────────────────────────────────────────────────────────

const SUBJECT_MAX_CHARS = 50;

// Expected email counts per sequence file
const EXPECTED_EMAIL_COUNTS = {
  "missed-call-followup.md": 3,
  "reactivation-campaign.md": 5,
  "new-patient-welcome.md": 4,
  "review-request.md": 2,
};

// Minimum file sizes (chars) — catches empty/stub files
const MIN_FILE_SIZE = {
  "missed-call-followup.md": 800,
  "appointment-reminder.md": 400,
  "monthly-newsletter.md": 400,
  "tracking-spreadsheet.md": 600,
  "reactivation-campaign.md": 1500,
  "new-patient-welcome.md": 1500,
  "review-request.md": 600,
  "setup-summary.md": 800,
  "setup-guide.md": 1000,
  "branded-templates.md": 800,
  "90-day-patient-journey.md": 800,
  "staff-training-guide.md": 800,
  "monthly-reporting-template.md": 600,
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function countEmailHeaders(content) {
  return (content.match(/^## (Email \d+|Primary Message|Follow-Up)\b/gm) || []).length;
}

function extractSubjects(content) {
  return [...content.matchAll(/\*\*Subject:\*\*\s*(.+)/g)].map((m) => m[1].trim());
}

function extractPlaceholders(content) {
  return [...new Set([...content.matchAll(/\[([A-Z][A-Za-z0-9 /]+)\]/g)].map((m) => m[0]))];
}

function hasTimingInfo(content) {
  return /Within \d+ [Mm]inute|hours? [Ll]ater|[Nn]ext [Mm]orning|[Ww]eek \d+|\d+ [Dd]ay|\d+ [Hh]our|[Dd]ay [Aa]fter|[Dd]ay [Bb]efore/i.test(content);
}

// ─── Single-file checker ──────────────────────────────────────────────────────

function checkFile(filePath, filename) {
  const result = { file: filename, checks: [], placeholders: [], pass: true };

  // 1 — File exists
  const exists = fs.existsSync(filePath);
  result.checks.push({ name: "File exists", pass: exists });
  if (!exists) { result.pass = false; return result; }

  const content = fs.readFileSync(filePath, "utf-8");
  const size = content.trim().length;

  // 2 — Minimum size
  const minSize = MIN_FILE_SIZE[filename] || 200;
  const sizePass = size >= minSize;
  result.checks.push({
    name: `Minimum content (≥${minSize} chars)`,
    pass: sizePass,
    detail: sizePass ? `${size} chars` : `Only ${size} chars — looks like a stub`,
  });

  // 3 — No undefined / null / [object Object] text
  const badText = content.match(/\b(undefined|null|\[object Object\])/g);
  result.checks.push({
    name: "No undefined/null text",
    pass: !badText,
    detail: badText ? `Found: ${[...new Set(badText)].join(", ")}` : null,
  });

  // 4 — No unclosed brackets ([ with no matching ])
  const unclosedMatch = content.match(/\[[^\]\n]{1,80}$/m);
  result.checks.push({
    name: "No unclosed brackets",
    pass: !unclosedMatch,
    detail: unclosedMatch ? `Possible unclosed bracket: "${unclosedMatch[0].slice(0, 60)}"` : null,
  });

  // 5 — No [Content to be customized] placeholder stubs
  const hasStub = /\[Content to be customized|Add ANTHROPIC_API_KEY/i.test(content);
  result.checks.push({
    name: "Not a stub (real content)",
    pass: !hasStub,
    detail: hasStub ? "File is a placeholder stub — check ANTHROPIC_API_KEY or static fallback" : null,
  });

  // 6 — Subject lines ≤ SUBJECT_MAX_CHARS
  const subjects = extractSubjects(content);
  const longSubjects = subjects.filter((s) => s.length > SUBJECT_MAX_CHARS);
  result.checks.push({
    name: `Subject lines ≤${SUBJECT_MAX_CHARS} chars`,
    pass: longSubjects.length === 0,
    detail: longSubjects.length > 0
      ? longSubjects.map((s) => `"${s}" (${s.length})`).join("; ")
      : subjects.length > 0 ? `${subjects.length} subject(s) checked — all OK` : null,
  });

  // 7 — Email count (sequence files only)
  if (EXPECTED_EMAIL_COUNTS[filename]) {
    const expected = EXPECTED_EMAIL_COUNTS[filename];
    const found = countEmailHeaders(content);
    const countPass = found === expected;
    result.checks.push({
      name: `Email count (expected ${expected})`,
      pass: countPass,
      detail: countPass ? `${found} emails found` : `Found ${found}, expected ${expected}`,
    });
  }

  // 8 — Timing specified (sequence files only)
  if (EXPECTED_EMAIL_COUNTS[filename]) {
    const timingPass = hasTimingInfo(content);
    result.checks.push({
      name: "Send timing specified",
      pass: timingPass,
      detail: !timingPass ? "No timing indicators found in email headers" : null,
    });
  }

  // 9 — List placeholders (informational — always passes)
  result.placeholders = extractPlaceholders(content);
  result.checks.push({
    name: `Placeholders documented (${result.placeholders.length})`,
    pass: true,
    detail: result.placeholders.length > 0
      ? result.placeholders.join("  ·  ")
      : "None (no placeholders found — check if expected)",
    informational: true,
  });

  // Overall pass = all non-informational checks passed
  result.pass = result.checks
    .filter((c) => !c.informational)
    .every((c) => c.pass);

  return result;
}

// ─── Report builder ───────────────────────────────────────────────────────────

function buildReport(allResults, clientInfo, tier, verifiedAt) {
  const totalChecks = allResults.flatMap((r) => r.checks).filter((c) => !c.informational).length;
  const passedChecks = allResults.flatMap((r) => r.checks).filter((c) => !c.informational && c.pass).length;
  const failedFiles = allResults.filter((r) => !r.pass).map((r) => r.file);
  const overallPass = failedFiles.length === 0;

  const statusIcon = (pass) => (pass ? "✅" : "❌");
  const infoIcon = "ℹ️";

  const lines = [
    `# Delivery Verification Report`,
    ``,
    `**Client:** ${clientInfo.name} — ${clientInfo.city || ""}`,
    `**Tier:** ${tier.charAt(0).toUpperCase() + tier.slice(1)}`,
    `**Verified:** ${verifiedAt}`,
    `**Overall:** ${overallPass ? "✅ VERIFIED — all checks passed" : `❌ ISSUES FOUND — ${failedFiles.length} file(s) need attention`}`,
    `**Score:** ${passedChecks}/${totalChecks} checks passed`,
    ``,
    `---`,
    ``,
  ];

  for (const result of allResults) {
    lines.push(`## ${statusIcon(result.pass)} ${result.file}`);
    lines.push(`\`\`\``);
    for (const check of result.checks) {
      const icon = check.informational ? infoIcon : statusIcon(check.pass);
      const detail = check.detail ? `  → ${check.detail}` : "";
      lines.push(`${icon}  ${check.name}${detail}`);
    }
    lines.push(`\`\`\``);
    lines.push(``);
  }

  if (failedFiles.length > 0) {
    lines.push(`---`);
    lines.push(`## Action Required`);
    lines.push(``);
    failedFiles.forEach((f) => {
      const result = allResults.find((r) => r.file === f);
      const failed = result?.checks.filter((c) => !c.informational && !c.pass) || [];
      lines.push(`**${f}**`);
      failed.forEach((c) => lines.push(`  - ${c.name}${c.detail ? `: ${c.detail}` : ""}`));
      lines.push(``);
    });
  }

  lines.push(`---`);
  lines.push(`*Generated by ClinicFlow delivery verifier*`);

  return lines.join("\n");
}

// ─── Main export ──────────────────────────────────────────────────────────────

/**
 * Verify all delivery files for a client package.
 * Writes verification-report.md to deliveryDir.
 * @param {string} deliveryDir
 * @param {{ name, city }} clientInfo
 * @param {string} tier
 * @param {string[]} filenames  — list of expected filenames (from manifest)
 * @returns {{ pass, results, reportPath }}
 */
export function verifyDelivery(deliveryDir, clientInfo, tier, filenames) {
  const allResults = [];
  const verifiedAt = new Date().toISOString();

  for (const filename of filenames) {
    const filePath = path.join(deliveryDir, filename);
    allResults.push(checkFile(filePath, filename));
  }

  const failedFiles = allResults.filter((r) => !r.pass);
  const pass = failedFiles.length === 0;

  const report = buildReport(allResults, clientInfo, tier, verifiedAt);
  const reportPath = path.join(deliveryDir, "verification-report.md");
  fs.writeFileSync(reportPath, report, "utf-8");

  return { pass, results: allResults, reportPath };
}
