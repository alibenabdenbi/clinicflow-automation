# System Upgrade — Email Copy, Follow-ups, Physio, Intelligence

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rewrite outreach email copy, add post-call follow-up email flow, add physio variant, upgrade follow-up sequences, add intelligent variant weighting, run RCDSO & physio enrichment, and add actionable daily intelligence section.

**Architecture:** All 7 parts touch existing files — no new services. Variant performance tracking uses a simple JSON file (data/variant-performance.json) read/written by emailPersonalizer.js exports. Post-call follow-up is a new CLI script that mirrors sendFollowups.js pattern. Daily report gains a new section driven by existing gathered stats.

**Tech Stack:** Node.js ESM, nodemailer (SMTP), Twilio SDK, plain JSON files for state.

---

## Task 1: Email Variants L, M, N (PART 1)

**Files:**
- Modify: `src/services/emailPersonalizer.js`

- [ ] **Step 1: Add variants L, M, N bodies to buildPersonalizedBody()**

In `buildPersonalizedBody()`, the `variants` array currently has 11 entries (A–K at indices 0–10).
Append 3 more entries after Variant K (index 10):

```js
    // Variant L — "What I'm seeing in [city]" (observation email)
    `${greeting}

I've been doing missed call audits for dental clinics across ${cityRef} over the last few months.

One pattern keeps coming up: most clinics lose 4-6 patients per week to unanswered calls — not because they're not trying, but because there's no automated follow-up when the front desk is busy.

I put together a quick audit for ${name} if you want to see the specific number. Free, takes me 10 minutes.

Worth it?

${senderName}`,

    // Variant M — "The missed call math"
    `${greeting}

If ${name} misses 5 calls per day and converts 30% of them — that's roughly 1-2 patients per day that don't book.

At $300 average visit value, that's $600-1,200 per day in revenue that never materializes.

I do free audits to find the exact number for your practice. No cost, no commitment — just a useful number to know.

Interested?

${senderName}
ClinicFlow Automation`,

    // Variant N — "Direct question"
    `${greeting}

Does ${name} have automated follow-up for missed calls?

Most clinics I talk to in ${cityRef} don't — and it's usually the biggest gap in their patient communication.

I do free audits to check. Takes 10 minutes.

${senderName}`,
```

- [ ] **Step 2: Add matching subjects to buildPersonalizedBody() subjects array**

The `subjects` array in `buildPersonalizedBody()` also needs 3 new entries at the same indices (11, 12, 13):

```js
    `Something I noticed about ${cityRef} dental clinics`.slice(0, 55),  // L
    `Quick math for ${name}`.slice(0, 55),                               // M
    `Quick question for ${name}`.slice(0, 55),                           // N
```

- [ ] **Step 3: Update personalizeSubject() to include L, M, N**

In `personalizeSubject()` around line 148, add 3 entries to its subjects array:

```js
    `Something I noticed about ${cityRef} dental clinics`.slice(0, 55),  // L
    `Quick math for ${name}`.slice(0, 55),                               // M
    `Quick question for ${name}`.slice(0, 55),                           // N
```

- [ ] **Step 4: Verify variantLabel handles indices 11-13 correctly**

`String.fromCharCode(65 + 11) === 'L'` ✓, `65 + 12 === 'M'` ✓, `65 + 13 === 'N'` ✓ — no code change needed.

---

## Task 2: Variant Performance Tracking (PART 5)

**Files:**
- Modify: `src/services/emailPersonalizer.js`
- Modify: `src/cli/sendBatch.js`

- [ ] **Step 1: Add performance tracking exports to emailPersonalizer.js**

Add at the bottom of the file (after `buildPersonalizedBody`):

```js
// ─── Variant performance tracking (PART 5) ────────────────────────────────────
import { createRequire } from "module";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);
const PERF_PATH  = path.resolve(__dirname, "../../data/variant-performance.json");

function readPerf() {
  try {
    if (!fs.existsSync(PERF_PATH)) return {};
    return JSON.parse(fs.readFileSync(PERF_PATH, "utf-8"));
  } catch { return {}; }
}

function writePerf(data) {
  fs.mkdirSync(path.dirname(PERF_PATH), { recursive: true });
  fs.writeFileSync(PERF_PATH, JSON.stringify(data, null, 2), "utf-8");
}

export function recordVariantSend(label) {
  if (!label) return;
  const perf = readPerf();
  if (!perf[label]) perf[label] = { sends: 0, replies: 0, weight: 1.0 };
  perf[label].sends++;
  _maybeUpdateWeight(perf, label);
  writePerf(perf);
}

export function recordVariantReply(label) {
  if (!label) return;
  const perf = readPerf();
  if (!perf[label]) perf[label] = { sends: 0, replies: 0, weight: 1.0 };
  perf[label].replies++;
  _maybeUpdateWeight(perf, label);
  writePerf(perf);
}

function _maybeUpdateWeight(perf, label) {
  const v = perf[label];
  if (!v || v.sends < 20) return;
  const oldWeight = v.weight;
  const replyRate = v.replies / v.sends;
  // Baseline: 0.02 (2%) — weight 1.0. Each 1% above/below shifts weight by 0.5
  const baseline = 0.02;
  v.weight = Math.max(0.1, Math.min(3.0, 1.0 + (replyRate - baseline) / baseline * 0.5));
  if (Math.abs(v.weight - oldWeight) > 0.05) {
    const dir = v.weight > oldWeight ? "▲" : "▼";
    console.log(`[variant-perf] ${label}: ${dir} weight ${oldWeight.toFixed(2)} → ${v.weight.toFixed(2)} (${(replyRate*100).toFixed(1)}% reply rate, ${v.sends} sends)`);
  }
}

export function getVariantPerformance() {
  return readPerf();
}
```

- [ ] **Step 2: Change variant selection in buildPersonalizedBody to weighted selection**

Replace the current `const variantIdx = Math.abs(seed) % variants.length;` line (around line 406) with:

```js
  // Weighted variant selection — better-performing variants get more sends
  const perf = readPerf();
  const allLabels = variants.map((_, i) => String.fromCharCode(65 + i)); // A, B, C, ...
  const weights   = allLabels.map(l => (perf[l]?.weight ?? 1.0));
  const totalW    = weights.reduce((s, w) => s + w, 0);
  const thresholds = [];
  let cumulative = 0;
  for (const w of weights) { cumulative += w; thresholds.push(cumulative); }
  // Use seed to pick deterministically per clinic — pick from [0, totalW)
  const pick01   = (Math.abs(seed) % 10000) / 10000;
  const pick01W  = pick01 * totalW;
  const variantIdx = thresholds.findIndex(t => pick01W < t);
  const safeIdx    = variantIdx === -1 ? 0 : variantIdx;
  const variantLabel = String.fromCharCode(65 + safeIdx);
  const body         = variants[safeIdx];
  const subject      = subjects[safeIdx];
```

Note: Remove old `const variantIdx`, `const variantLabel`, `const body`, and `const subject` lines and replace with this block. Remove the `return { subject, body, variantLabel };` old form and verify the existing return statement still uses these new variable names.

- [ ] **Step 3: Import fs, path, fileURLToPath at top of emailPersonalizer.js (if not already there)**

The file currently has no imports. Add at the very top:
```js
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);
```
Remove the duplicate declarations added in Step 1 (Step 1 code above includes them redundantly — in the final file, only one set at the top).

- [ ] **Step 4: Update sendBatch.js to call recordVariantSend after each successful send**

In sendBatch.js, add to the import from emailPersonalizer:
```js
import { buildPersonalizedBody, extractGreetingName, isNamedEmail, clinicSlug, recordVariantSend } from "../services/emailPersonalizer.js";
```

After the line `leads[idx].variantLabel = variantLabel;` (around line 658), add:
```js
recordVariantSend(variantLabel);
```

---

## Task 3: Upgrade Follow-up Sequences FU1, FU2, FU3 (PART 4)

**Files:**
- Modify: `src/cli/sendFollowups.js`

- [ ] **Step 1: Rewrite buildFollowup1**

Replace `buildFollowup1` function body (lines ~149-165) with:

```js
function buildFollowup1({ clinicName, city, email, senderName }) {
  const name    = clinicName || "your clinic";
  const cityRef = city || "your area";
  const greetName = extractGreetingName(email || "");
  const greeting  = greetName ? `Hi ${greetName},` : "Hi,";
  return {
    subject: `One more thing — ${name}`,
    body: `${greeting}

One stat I should have mentioned — dental clinics in ${cityRef} typically miss 8-12 calls per day during peak hours (9am-12pm).

Most have no automated follow-up for those calls.

Still happy to check ${name}'s specific number — free, 10 minutes.

${senderName}`,
  };
}
```

- [ ] **Step 2: Rewrite buildFollowup2**

Replace `buildFollowup2` function body (lines ~167-186) with:

```js
function buildFollowup2({ clinicName, city, email, senderName }) {
  const name    = clinicName || "your clinic";
  const cityRef = city || "your area";
  const greetName = extractGreetingName(email || "");
  const greeting  = greetName ? `Hi ${greetName},` : "Hi,";
  return {
    subject: `What happened at a ${cityRef} clinic last month`,
    body: `${greeting}

A dental clinic in ${cityRef} I worked with last month had 247 inactive patients in their system — patients who hadn't been in for 12+ months.

We sent a reactivation campaign. 11 booked appointments in the first week.

Worth checking if ${name} has a similar opportunity?

${senderName}`,
  };
}
```

- [ ] **Step 3: Rewrite buildFollowup3**

Replace `buildFollowup3` function body (lines ~188-204) with:

```js
function buildFollowup3({ clinicName, email, senderName }) {
  const name    = clinicName || "your clinic";
  const greetName = extractGreetingName(email || "");
  const greeting  = greetName ? `Hi ${greetName},` : "Hi,";
  return {
    subject: `Closing the loop — ${name}`,
    body: `${greeting}

I've reached out a few times about a free missed call audit for ${name}.

If the timing isn't right — completely understand.

I'll leave it here. If things change and you want that audit, just reply to this email anytime.

${senderName}
ClinicFlow Automation`,
  };
}
```

---

## Task 4: Physio Appointment Reminder Variant (PART 3)

**Files:**
- Modify: `src/templates/replyTemplates.js`

- [ ] **Step 1: Add 4th physio variant to MARKET_BODY.physio**

In `MARKET_BODY.physio` function, the `variants` array currently has 3 entries. Add a 4th:

```js
      // Variant 4 — appointment reminders / no-shows angle
      `${greeting}

Does ${name} have automated appointment reminders going out to patients before their sessions?

Most physio clinics I've looked at${loc} don't — and no-shows are usually 15-20% higher as a result.

I set this up done-for-you — free audit to see what's missing.

${sign}`,
```

- [ ] **Step 2: Add 4th subject to MARKET_SUBJECT.physio**

```js
  physio: (name, city) => {
    const seed = _hashStr((name || "") + (city || ""));
    const variants = [
      `Quick thought for ${name}`.slice(0, 52),
      `Patient retention at ${name}`.slice(0, 52),
      `${city ? city + " physio" : "Your clinic"} — one idea`.slice(0, 52),
      `Quick question for ${name}`.slice(0, 52),  // new
    ];
    return _pick(variants, seed);
  },
```

---

## Task 5: Post-Call Follow-up Email (PART 2)

**Files:**
- Modify: `src/cli/twilioCallQueue.js`
- Create: `src/cli/sendCallFollowups.js`
- Modify: `package.json`
- Modify: `src/scheduler.js`

- [ ] **Step 1: Add followUpEmailDue to call log entry in twilioCallQueue.js**

In `twilioCallQueue.js`, in the call log entry object (around line 189-198), add the field:

```js
    const entry = {
      clinicName:        name,
      city,
      email:             l.email || "",
      phone,
      callSid,
      outcome:           "dialed",
      scriptType:        "auto-amd",
      timestamp:         new Date().toISOString(),
      followUpEmailDue:  new Date(Date.now() + 86_400_000).toISOString().slice(0, 10),
      followUpEmailSent: false,
    };
```

- [ ] **Step 2: Create src/cli/sendCallFollowups.js**

```js
// src/cli/sendCallFollowups.js
// Sends a follow-up email 24h after a Twilio call for clinics that haven't replied.
// Reads data/calls/call-log.json, finds calls from yesterday with no email reply.
// Run: node src/cli/sendCallFollowups.js
// npm run calls:followup

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import nodemailer from "nodemailer";

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT      = path.resolve(__dirname, "../..");
const CALL_LOG  = path.join(ROOT, "data", "calls", "call-log.json");

const SMTP_HOST   = (process.env.SMTP_HOST || "").trim();
const SMTP_PORT   = Number(process.env.SMTP_PORT || "0");
const SMTP_USER   = (process.env.SMTP_USER || "").trim();
const SMTP_PASS   = (process.env.SMTP_PASS || "").trim();
const SMTP_FROM   = (process.env.SMTP_FROM || SMTP_USER).trim();
const SMTP_SECURE = (process.env.SMTP_SECURE || "").toLowerCase() === "true" || SMTP_PORT === 465;
const SENDER_NAME = "Mohamed";

function readJsonSafe(p, fb) {
  try { if (!fs.existsSync(p)) return fb; return JSON.parse(fs.readFileSync(p, "utf-8")); }
  catch { return fb; }
}

function writeJsonSafe(p, data) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(data, null, 2), "utf-8");
}

function todayKey() {
  const d = new Date();
  return d.toISOString().slice(0, 10);
}

function yesterdayKey() {
  return new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
}

function buildFollowupEmail({ clinicName, city }) {
  const name   = clinicName || "your clinic";
  const cityRef = city || "your area";
  return {
    subject: `Called your office yesterday — ${name}`,
    body: `Hi,

I called ${name} yesterday — wanted to follow up by email in case it's easier to connect this way.

I do free missed call audits for dental clinics in ${cityRef}. Takes 10 minutes, no cost.

Worth a quick look?

${SENDER_NAME}
ClinicFlow Automation`,
  };
}

async function main() {
  const yesterday = yesterdayKey();
  console.log(`\nCall Follow-up Sender — checking calls from ${yesterday}`);

  const callLog = readJsonSafe(CALL_LOG, []);
  const candidates = callLog.filter(c =>
    c.timestamp?.startsWith(yesterday) &&
    c.email &&
    !c.followUpEmailSent &&
    c.outcome !== "callback_received"
  );

  console.log(`Found ${candidates.length} clinic(s) called yesterday with email + no reply`);

  if (candidates.length === 0) {
    console.log("Nothing to send.");
    return;
  }

  if (!SMTP_HOST || !SMTP_PORT || !SMTP_USER || !SMTP_PASS) {
    console.log("SMTP not configured. Check .env");
    return;
  }

  const transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: SMTP_PORT,
    secure: SMTP_SECURE,
    auth: { user: SMTP_USER, pass: SMTP_PASS },
  });

  let sent = 0;
  for (const entry of candidates) {
    const { subject, body } = buildFollowupEmail(entry);
    try {
      await transporter.sendMail({
        from: `${SENDER_NAME} <${SMTP_FROM}>`,
        to: entry.email,
        subject,
        text: body,
      });
      entry.followUpEmailSent = true;
      entry.followUpEmailSentAt = new Date().toISOString();
      console.log(`  ✓ sent → ${entry.email} (${entry.clinicName})`);
      sent++;
    } catch (err) {
      console.log(`  ✗ failed → ${entry.email}: ${err.message}`);
    }
  }

  writeJsonSafe(CALL_LOG, callLog);
  console.log(`\n${sent} follow-up email(s) sent. Log updated → ${CALL_LOG}`);
}

main().catch(e => {
  console.error("sendCallFollowups failed:", e?.message || e);
  process.exit(1);
});
```

- [ ] **Step 3: Add npm script to package.json**

Add to scripts:
```json
"calls:followup": "node src/cli/sendCallFollowups.js"
```

- [ ] **Step 4: Add scheduler entry to src/scheduler.js**

After the existing `scheduleDaily(11, 0, "Send Follow-ups", ...)` block, add:

```js
scheduleDaily(11, 30, "Call Follow-up Emails", async () => {
  await runScript("src/cli/sendCallFollowups.js");
});
```

---

## Task 6: Daily Intelligence Brief — Recommended Actions (PART 7)

**Files:**
- Modify: `src/reports/dailyReport.js`

- [ ] **Step 1: Add buildRecommendedActions helper and wire into buildReport**

Add this function before `buildReport()`:

```js
function buildRecommendedActions(s, dentists, callLog, sendLog) {
  const lines = [];
  lines.push("TODAY'S RECOMMENDED ACTIONS");

  // 1. Top 3 FU1 candidates: named email + sent within 7 days + not yet FU1'd
  const sevenDaysAgo = Date.now() - 7 * 86_400_000;
  const fu1Candidates = (Array.isArray(dentists) ? dentists : [])
    .filter(d =>
      d.status === "sent" &&
      Number(d.followupCount ?? 0) === 0 &&
      d.email &&
      isNamedEmail(d.email) &&
      Number.isFinite(Date.parse(d.sentAt || "")) &&
      Date.parse(d.sentAt) >= sevenDaysAgo
    )
    .sort((a, b) => (b.opportunityScore || b.score || 0) - (a.opportunityScore || a.score || 0))
    .slice(0, 3);

  if (fu1Candidates.length > 0) {
    lines.push("  1. Send FU1 to these clinics today — named email, recent send, most likely to reply:");
    fu1Candidates.forEach(d => {
      const daysSince = Math.floor((Date.now() - Date.parse(d.sentAt)) / 86_400_000);
      lines.push(`     → ${(d.clinicName || d.email).slice(0, 40)}  (${daysSince}d ago, ${d.email})`);
    });
  } else {
    lines.push("  1. No priority FU1 candidates today (none: named email + sent in last 7 days)");
  }

  // 2. Top 3 clinics to call: have direct lines, no email reply
  const callCandidates = (Array.isArray(dentists) ? dentists : [])
    .filter(d =>
      (d.phone || d.rcdsoPhone || d.personalPhone) &&
      ["sent", "followup_1_sent", "followup_2_sent"].includes(d.status || "")
    )
    .slice(0, 3);

  if (callCandidates.length > 0) {
    lines.push("  2. Call these clinics today — direct lines, no email reply:");
    callCandidates.forEach(d => {
      const phone = d.personalPhone || d.rcdsoPhone || d.phone;
      lines.push(`     → ${(d.clinicName || "").slice(0, 38)}  ${phone}  (${d.status})`);
    });
  } else {
    lines.push("  2. No call candidates with direct lines today");
  }

  // 3. Clinics with Google review pain signals
  const reviewPainClinics = (Array.isArray(dentists) ? dentists : [])
    .filter(d => d.reviewPainScore >= 2)
    .slice(0, 2);

  if (reviewPainClinics.length > 0) {
    lines.push("  3. These clinics have Google reviews mentioning communication problems:");
    reviewPainClinics.forEach(d => {
      lines.push(`     → ${(d.clinicName || "").slice(0, 45)}  (pain score: ${d.reviewPainScore})`);
    });
  } else {
    lines.push("  3. No new Google review pain signals detected");
  }

  // 4. Hunter reset countdown
  const now = new Date();
  const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const daysToReset = Math.ceil((nextMonth - now) / 86_400_000);
  const resetDate = nextMonth.toISOString().slice(0, 10);
  lines.push(`  4. Hunter resets in ${daysToReset} day(s) — run enrich on ${resetDate}`);

  // 5. Best/worst variant advisory
  const sorted = [...s.variantPerf].sort((a, b) => {
    const aR = a.sent > 0 ? a.replies / a.sent : 0;
    const bR = b.sent > 0 ? b.replies / b.sent : 0;
    return bR - aR;
  });
  if (sorted.length >= 2) {
    const best  = sorted[0];
    const worst = sorted[sorted.length - 1];
    lines.push(`  5. Best variant: ${best.variant} (${best.replyPct} reply rate, ${best.sent} sends)`);
    if (worst.sent >= 20) {
      lines.push(`     Worst variant: ${worst.variant} (${worst.replyPct} reply rate) — consider pausing`);
    }
  } else {
    lines.push("  5. Not enough variant data yet (need 20+ sends per variant)");
  }

  return lines.join("\n");
}
```

Note: `isNamedEmail` must be imported. Add to the top of dailyReport.js:
```js
import { isNamedEmail } from "../services/emailPersonalizer.js";
```

- [ ] **Step 2: Pass dentists + callLog into buildReport and call buildRecommendedActions**

In `gatherStats()`, the function already returns all needed data in `s`. Pass `dentists` and `callLog` to `buildReport` or embed `buildRecommendedActions` call inside `gatherStats` and attach result to `s`.

Simplest: add to `gatherStats()` return:
```js
    recommendedActions: buildRecommendedActions_inline(dentists, callLog, variantPerf_stats, sendLog),
```
but since `buildRecommendedActions` needs `s.variantPerf` which is computed later, instead call it inside `buildReport(s)` after `variantPerf` is set:

In `buildReport(s)`, after the VARIANT PERFORMANCE section and before VOICE OUTREACH, add:
```js
  // ── Recommended Actions (Part 7)
  lines.push("");
  lines.push(s.recommendedActions);
```

And in `gatherStats()` near the end, before `return`, add:
```js
  const recommendedActions = buildRecommendedActions({ variantPerf }, dentists, callLog, sendLog);
```

Then include `recommendedActions` in the return object.

---

## Task 7: Execute Physio Enrichment (PART 3)

- [ ] **Step 1: Run enrichment**

```bash
node src/cli/enrichEmails.js --market physio --limit 45
```

Expected: finds emails for up to 45 physio clinics, saves to `data/outreach.physioClinics.json`.

---

## Task 8: Execute RCDSO Scraper (PART 6)

- [ ] **Step 1: Run RCDSO scraper**

```bash
node src/cli/scrapeRCDSO.js --limit 500
```

Expected output: number of new phone numbers found, total clinics now with RCDSO direct lines.

---

## Task 9: Run Daily Report (final verification)

- [ ] **Step 1: Run report**

```bash
node src/reports/dailyReport.js
```

Expected: report includes TODAY'S RECOMMENDED ACTIONS section. Check for errors.
