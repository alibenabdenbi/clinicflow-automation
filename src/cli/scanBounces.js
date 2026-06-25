// src/cli/scanBounces.js
// Scans the IMAP inbox for mailer-daemon bounce notifications.
// Extracts failed recipient addresses from DSN payloads and marks them
// as bounced in outreach.localDentists.json.
// Usage: node src/cli/scanBounces.js [--days 14]

import fs from "fs";
import path from "path";
import { ImapFlow } from "imapflow";
import dotenv from "dotenv";

dotenv.config();

const IMAP_HOST = process.env.IMAP_HOST || "imap.zohocloud.ca";
const IMAP_PORT = Number(process.env.IMAP_PORT || "993");
const IMAP_USER = process.env.IMAP_USER || process.env.SMTP_USER || "";
const IMAP_PASS = process.env.IMAP_PASS || process.env.SMTP_PASS || "";

const OUTREACH_PATH = process.env.OUTREACH_JSON_PATH ||
  path.join(process.cwd(), "data", "outreach.localDentists.json");
const EMAIL_LOG_PATH = path.join(process.cwd(), "data", "smtp.emaillog.json");
const BOUNCES_PATH   = path.join(process.cwd(), "data", "bounces.json");

const DAYS_BACK = (() => {
  const i = process.argv.indexOf("--days");
  return i !== -1 ? Number(process.argv[i + 1]) || 30 : 30;
})();

// ─── Bounce subject patterns ──────────────────────────────────────────────────

const BOUNCE_SUBJECT_PATTERNS = [
  /undelivered mail returned/i,
  /mail delivery (failed|failure|status notification)/i,
  /delivery (status notification|failure notice|failed)/i,
  /returned to sender/i,
  /failure notice/i,
  /\bmailer.daemon\b/i,
  /message not delivered/i,
  /undeliverable/i,
  /bounce notification/i,
];

const BOUNCE_FROM_PATTERNS = [
  /^mailer-daemon@/i,
  /^postmaster@/i,
  /^bounce/i,
  /^daemon@/i,
  /^noreply@/i,
];

// ─── Extract failed recipient from DSN / bounce body ─────────────────────────

function extractBouncedEmails(rawSource) {
  const found = new Set();
  const text = rawSource.toString("utf-8");

  // RFC 3464 DSN: Final-Recipient: rfc822; email@domain.com
  const dsnMatches = text.matchAll(/Final-Recipient\s*:\s*rfc822\s*;\s*([^\s\r\n]+)/gi);
  for (const m of dsnMatches) {
    const addr = m[1].trim().replace(/[<>]/g, "").toLowerCase();
    if (isValidEmail(addr)) found.add(addr);
  }

  // X-Failed-Recipients header (Exim, some Zoho variants)
  const xFailed = text.matchAll(/X-Failed-Recipients\s*:\s*([^\r\n]+)/gi);
  for (const m of xFailed) {
    for (const addr of m[1].split(/[,;]/)) {
      const clean = addr.trim().replace(/[<>]/g, "").toLowerCase();
      if (isValidEmail(clean)) found.add(clean);
    }
  }

  // Original-Recipient header
  const origRecip = text.matchAll(/Original-Recipient\s*:\s*rfc822\s*;\s*([^\s\r\n]+)/gi);
  for (const m of origRecip) {
    const addr = m[1].trim().replace(/[<>]/g, "").toLowerCase();
    if (isValidEmail(addr)) found.add(addr);
  }

  // "To:" inside the embedded original message headers
  const embeddedTo = text.matchAll(/(?:^|\r\n)To\s*:\s*([^\r\n]+)/gi);
  for (const m of embeddedTo) {
    const raw = m[1];
    const emailMatch = raw.match(/([a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,})/);
    if (emailMatch) {
      const addr = emailMatch[1].toLowerCase();
      if (isValidEmail(addr)) found.add(addr);
    }
  }

  // Fallback: scan entire body for email addresses that match known sent addresses
  return [...found];
}

function isValidEmail(e) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e);
}

// ─── Parse error code from bounce body ───────────────────────────────────────

function extractSmtpCode(text) {
  const match = text.match(/\b(5\d{2})\b/);
  return match ? Number(match[1]) : null;
}

function classifyBounce(text) {
  const code = extractSmtpCode(text);
  if (!code) return { type: "unknown", code: null };
  if (code >= 500) return { type: "permanent", code };
  if (code >= 400) return { type: "temporary", code };
  return { type: "unknown", code };
}

// ─── Mark bounced in outreach file ───────────────────────────────────────────

function readJsonSafe(p, fallback) {
  try { return JSON.parse(fs.readFileSync(p, "utf-8")); }
  catch { return fallback; }
}

function markBounces(bounceMap) {
  const leads = readJsonSafe(OUTREACH_PATH, []);
  const emailLog = readJsonSafe(EMAIL_LOG_PATH, []);
  let marked = 0;

  for (const [email, { type, code, subject }] of Object.entries(bounceMap)) {
    const addr = email.toLowerCase().trim();
    const indexes = leads.reduce((acc, l, i) => {
      if ((l.email || "").toLowerCase().trim() === addr) acc.push(i);
      return acc;
    }, []);

    if (indexes.length === 0) {
      console.log(`  [no record] ${email} — not in outreach queue, skip`);
      continue;
    }

    for (const idx of indexes) {
      const l = leads[idx];
      if (l.status === "bounced") {
        console.log(`  [already bounced] ${email}  [${l.clinicName}]`);
        continue;
      }
      l.status = "bounced";
      l.bounceType = type;
      l.bounceCode = code;
      l.bouncedAt = new Date().toISOString();
      l.bounceNote = `Daemon bounce detected via IMAP scan — subject: "${subject}"`;
      delete l.followupDueAt;
      delete l.followupCount;
      console.log(`  ✓ Marked bounced: [${idx}] ${l.clinicName} <${email}> (${type}, ${code ?? "?"})`);
      marked++;

      emailLog.push({
        email: l.email,
        clinic: l.clinicName,
        status: "bounced",
        bounceType: type,
        bounceCode: code,
        source: "imap-daemon-scan",
        loggedAt: new Date().toISOString(),
      });

      // Also append to bounces.json
      const bounceLog = readJsonSafe(BOUNCES_PATH, []);
      const alreadyLogged = bounceLog.some(b => (b.email || "").toLowerCase() === addr);
      if (!alreadyLogged) {
        bounceLog.push({
          email: l.email,
          clinic: l.clinicName,
          bounceCode: code || null,
          bounceType: type,
          date: new Date().toISOString(),
          source: "imap-daemon-scan",
        });
        fs.writeFileSync(BOUNCES_PATH, JSON.stringify(bounceLog, null, 2));
      }
    }
  }

  fs.writeFileSync(OUTREACH_PATH, JSON.stringify(leads, null, 2));
  fs.writeFileSync(EMAIL_LOG_PATH, JSON.stringify(emailLog, null, 2));
  return marked;
}

// ─── IMAP scan ────────────────────────────────────────────────────────────────

const MAILBOXES = ["INBOX", "Spam", "Junk", "Junk Email", "Bulk Mail"];

async function scanMailbox(client, mailboxName, since, sentAddrs) {
  const results = {};

  try {
    await client.mailboxOpen(mailboxName);
  } catch {
    console.log(`  Mailbox "${mailboxName}" not found — skipping`);
    return results;
  }

  let scanned = 0;
  let matched = 0;

  for await (const msg of client.fetch({ since }, { envelope: true, source: true })) {
    scanned++;
    const fromAddr = msg.envelope?.from?.[0];
    const fromEmail = fromAddr ? `${fromAddr.mailbox}@${fromAddr.host}`.toLowerCase() : "";
    const subject = msg.envelope?.subject || "";

    const isBounceSender = BOUNCE_FROM_PATTERNS.some(p => p.test(fromEmail));
    const isBounceSubject = BOUNCE_SUBJECT_PATTERNS.some(p => p.test(subject));

    if (!isBounceSender && !isBounceSubject) continue;

    matched++;
    const rawSource = msg.source || Buffer.alloc(0);
    const text = rawSource.toString("utf-8");
    const candidates = extractBouncedEmails(rawSource);

    // Filter to only addresses we actually sent to
    const relevant = sentAddrs.size > 0
      ? candidates.filter(e => sentAddrs.has(e))
      : candidates;

    const { type, code } = classifyBounce(text);

    console.log(`  [${mailboxName}] Bounce from ${fromEmail}: "${subject.slice(0, 60)}"`);
    if (candidates.length === 0) {
      console.log(`    → Could not extract recipient address`);
    }
    for (const email of relevant) {
      console.log(`    → Failed recipient: ${email} (${type}, ${code ?? "?"})`);
      if (!results[email] || type === "permanent") {
        results[email] = { type, code, subject };
      }
    }
    // Log unmatched candidates for visibility
    const unmatched = candidates.filter(e => !sentAddrs.has(e));
    for (const e of unmatched) {
      console.log(`    → Candidate not in sent list: ${e}`);
    }
  }

  console.log(`  [${mailboxName}] Scanned ${scanned} messages, found ${matched} bounce notifications, ${Object.keys(results).length} matched recipients`);
  return results;
}

async function main() {
  if (!IMAP_USER || !IMAP_PASS) {
    console.error("IMAP credentials not set. Check IMAP_USER / IMAP_PASS in .env");
    process.exit(1);
  }

  // Build set of all addresses we ever sent to (for filtering)
  const emailLog = readJsonSafe(EMAIL_LOG_PATH, []);
  const sentAddrs = new Set(
    emailLog
      .filter(e => e.status === "sent")
      .map(e => (e.email || "").toLowerCase().trim())
      .filter(Boolean)
  );
  console.log(`Sent addresses in log: ${sentAddrs.size}`);

  const since = new Date();
  since.setDate(since.getDate() - DAYS_BACK);
  console.log(`Scanning bounces since: ${since.toISOString().slice(0, 10)} (${DAYS_BACK} days back)\n`);

  const client = new ImapFlow({
    host: IMAP_HOST,
    port: IMAP_PORT,
    secure: true,
    auth: { user: IMAP_USER, pass: IMAP_PASS },
    logger: false,
    tls: { rejectUnauthorized: false },
  });

  const allBounces = {};

  try {
    await client.connect();
    console.log("IMAP connected\n");

    for (const mbox of MAILBOXES) {
      const results = await scanMailbox(client, mbox, since, sentAddrs);
      Object.assign(allBounces, results);
    }

    await client.logout();
  } catch (err) {
    console.error(`IMAP error: ${err.message}`);
    try { await client.logout(); } catch {}
    process.exit(1);
  }

  console.log(`\n── Bounce summary ──`);
  console.log(`Total bounced addresses found: ${Object.keys(allBounces).length}`);

  if (Object.keys(allBounces).length === 0) {
    console.log("No bounces detected in inbox.");
  } else {
    const marked = markBounces(allBounces);
    console.log(`Records marked bounced: ${marked}`);
  }

  // ── Bounce rate calculation ────────────────────────────────────────────────
  const leads = readJsonSafe(OUTREACH_PATH, []);
  const totalSent = leads.filter(l =>
    ["sent","followup_1_sent","followup_2_sent","followup_3_sent","followups_complete","bounced"].includes(l.status)
  ).length;
  const totalBounced = leads.filter(l => l.status === "bounced").length;
  const bounceRate = totalSent > 0 ? (totalBounced / totalSent * 100).toFixed(2) : "0.00";

  console.log(`\n── Bounce rate ──`);
  console.log(`Total ever sent:    ${totalSent}`);
  console.log(`Total bounced:      ${totalBounced}`);
  console.log(`Bounce rate:        ${bounceRate}%`);

  if (Number(bounceRate) > 5) {
    console.log(`\n⚠  BOUNCE RATE EXCEEDS 5% — sending should be paused and list cleaned.`);
    process.exitCode = 2;
  } else {
    console.log(`✓  Bounce rate within acceptable range (< 5%)`);
  }
}

main().catch(e => {
  console.error("Bounce scan failed:", e.message);
  process.exit(1);
});
