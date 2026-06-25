// src/cli/computeDailyAction.js
// Determines the single highest-leverage action for today.
// Priority order: page visitor → hot opener → SMS-ready → sequence touch → build task.
// Saves result to data/daily-action.json and prints it.
// Also exported as computeDailyAction() for use in sendMorningBrief.js.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT     = path.resolve(__dirname, '../..');
const DATA_DIR = path.join(ROOT, 'data');

const DAY_MS   = 24 * 60 * 60 * 1000;
const NOW      = Date.now();

function readSafe(p, fallback) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return fallback; }
}

function daysSince(isoStr) {
  return (NOW - new Date(isoStr).getTime()) / DAY_MS;
}

export function computeDailyAction() {
  const dental   = readSafe(path.join(DATA_DIR, 'outreach.localDentists.json'), []);
  const sequence = readSafe(path.join(DATA_DIR, 'hitlist', 'sequence-tracker.json'), []);
  const opens    = readSafe(path.join(DATA_DIR, 'opens.json'), []);
  const tracker  = readSafe(path.join(DATA_DIR, 'signal-tracker.json'), {});
  const replies  = readSafe(path.join(DATA_DIR, 'reply-drafts'), null); // may not be a file

  // ── PRIORITY 1: Someone visited their /for/ page today ─────────────────────
  const pageVisitors = dental.filter(c =>
    c.forPageVisitedAt && daysSince(c.forPageVisitedAt) < 1
  );
  if (pageVisitors.length > 0) {
    const c = pageVisitors.sort((a, b) =>
      new Date(b.forPageVisitedAt) - new Date(a.forPageVisitedAt)
    )[0];
    const phone = c.phone || c.googlePhone || c.rcdsoPhone || null;
    return {
      priority:   'URGENT',
      emoji:      '🔴',
      action:     `Call ${c.clinicName}`,
      why:        `They visited clinicflowautomation.com/for/${c.slug || '...'} today — actively considering`,
      script:     `"Hi, this is Mohamed from ClinicFlow. I noticed you checked out the page I built specifically for ${c.clinicName}. Wanted to follow up personally — did it make sense for your practice?"`,
      phone,
      email:      c.email,
      clinicName: c.clinicName,
    };
  }

  // ── PRIORITY 2: Hot opener — 3+ email opens in last 3 days ─────────────────
  // Check signal-tracker hotLeads first (pre-aggregated), then raw opens.json
  const hotLeads = (tracker.hotLeads || []).filter(l =>
    (l.openCount || 0) >= 3 &&
    l.lastOpenedAt && daysSince(l.lastOpenedAt) <= 3 &&
    !l.replied
  );

  if (hotLeads.length === 0 && opens.length > 0) {
    // Aggregate from raw opens.json
    const opensByClinic = {};
    opens.forEach(o => {
      if (!o.clinic) return;
      const key = o.clinic;
      if (!opensByClinic[key]) opensByClinic[key] = { count: 0, lastAt: o.openedAt, email: o.email };
      opensByClinic[key].count++;
      if (o.openedAt > opensByClinic[key].lastAt) opensByClinic[key].lastAt = o.openedAt;
    });
    Object.entries(opensByClinic)
      .filter(([, v]) => v.count >= 3 && daysSince(v.lastAt) <= 3)
      .forEach(([name, v]) => hotLeads.push({ clinicName: name, openCount: v.count, lastOpenedAt: v.lastAt, email: v.email }));
  }

  if (hotLeads.length > 0) {
    const lead = hotLeads.sort((a, b) => (b.openCount || 0) - (a.openCount || 0))[0];
    const clinic = dental.find(d => d.clinicName === lead.clinicName || d.email === lead.email) || lead;
    const phone  = clinic.phone || clinic.googlePhone || null;
    return {
      priority:   'HOT',
      emoji:      '🔥',
      action:     `Personal email to ${lead.clinicName}`,
      why:        `Opened ${lead.openCount}× in 3 days — keeps coming back to read it`,
      script:     `Subject: Re: ${lead.clinicName}\n\n"Hi — I noticed you've seen my previous notes a few times. Wanted to reach out personally. The free 30-day pilot I mentioned is still open this week. Worth a quick reply?"`,
      phone,
      email:      clinic.email || lead.email,
      clinicName: lead.clinicName,
    };
  }

  // ── PRIORITY 3: Hit list prospect ready for SMS (day 7+) ───────────────────
  const smsReady = sequence.filter(s => {
    if (!s.touch1SentAt || s.replied || s.status === 'closed') return false;
    if (s.touches?.touch4_sms !== 'pending' || !s.phone) return false;
    return daysSince(s.touch1SentAt) >= 7;
  });

  if (smsReady.length > 0) {
    const s = smsReady[0];
    const CALENDLY = 'https://calendly.com/m-aliben432/clinicflow-15-min-intro';
    return {
      priority:   'WARM',
      emoji:      '📱',
      action:     `SMS ${s.clinicName}`,
      why:        `Day ${Math.floor(daysSince(s.touch1SentAt))} in sequence — SMS gets highest response rate at this stage`,
      script:     `"Hi — Mohamed from ClinicFlow. Sent you a couple of emails about auto missed-call text-back for ${s.clinicName}. Want to see what your patients would experience? Text anything to +1 (575) 573-5822 — 60 seconds. Or book a call: ${CALENDLY}"`,
      phone:      s.phone,
      email:      s.email,
      clinicName: s.clinicName,
    };
  }

  // ── PRIORITY 4: Next sequence touch due today ───────────────────────────────
  const touch3Due = sequence.filter(s => {
    if (!s.touch1SentAt || s.replied || s.status === 'closed') return false;
    if (s.touches?.touch3_personal !== 'pending') return false;
    return daysSince(s.touch1SentAt) >= 5;
  });

  if (touch3Due.length > 0) {
    const s = touch3Due[0];
    return {
      priority:   'SEQUENCE',
      emoji:      '✉️',
      action:     `Pilot offer email to ${s.clinicName}`,
      why:        `Day ${Math.floor(daysSince(s.touch1SentAt))} — touch 3 (personal pilot offer) is due`,
      script:     `Run: node src/cli/runHitListSequence.js`,
      phone:      s.phone,
      email:      s.email,
      clinicName: s.clinicName,
    };
  }

  // ── PRIORITY 5: Follow-ups due today ───────────────────────────────────────
  const followupsDue = dental.filter(d =>
    d.status === 'sent' && d.followupDueAt && new Date(d.followupDueAt) <= new Date()
  );
  if (followupsDue.length > 5) {
    return {
      priority:   'FOLLOWUP',
      emoji:      '↩️',
      action:     `Send ${followupsDue.length} follow-ups`,
      why:        `${followupsDue.length} clinics are past their follow-up date — reply rates drop fast after 7 days`,
      script:     `Run: npm run send:followups`,
      phone:      null,
      email:      null,
      clinicName: null,
    };
  }

  // ── PRIORITY 6: Default build task ─────────────────────────────────────────
  return {
    priority:   'BUILD',
    emoji:      '🚀',
    action:     'Deploy to Netlify + submit sitemap to Google Search Console',
    why:        'FAQ pages, blog posts, comparison pages, and scarcity counter are built but not live — every day without deploy is lost SEO compound',
    script:     '1. Drag public/netlify-deploy/ to app.netlify.com\n2. Google Search Console → Sitemaps → add/resubmit sitemap.xml\n3. Check: clinicflowautomation.com/faq',
    phone:      null,
    email:      null,
    clinicName: null,
  };
}

// ── Format for email/console ───────────────────────────────────────────────

export function formatDailyAction(action) {
  const bar = '═'.repeat(52);
  const lines = [
    `╔${bar}╗`,
    `║  ${action.emoji}  TODAY'S #1 ACTION                         ║`,
    `╠${bar}╣`,
    `║  [${action.priority}] ${action.action}`.padEnd(53) + '║',
    `╠${bar}╣`,
    `║  WHY:`.padEnd(53) + '║',
  ];

  // Wrap the why text to 50 chars
  const why = action.why || '';
  const whyChunks = why.match(/.{1,50}/g) || [why];
  whyChunks.forEach(chunk => {
    lines.push(`║  ${chunk}`.padEnd(53) + '║');
  });

  lines.push(`╠${bar}╣`);
  lines.push(`║  SCRIPT:`.padEnd(53) + '║');

  const script = action.script || '';
  const scriptLines = script.split('\n');
  scriptLines.forEach(sl => {
    const chunks = sl.match(/.{1,50}/g) || [sl || ' '];
    chunks.forEach(chunk => {
      lines.push(`║  ${chunk}`.padEnd(53) + '║');
    });
  });

  if (action.phone || action.email) {
    lines.push(`╠${bar}╣`);
    if (action.phone) lines.push(`║  Phone: ${action.phone}`.padEnd(53) + '║');
    if (action.email) lines.push(`║  Email: ${action.email}`.padEnd(53) + '║');
  }

  lines.push(`╚${bar}╝`);
  return lines.join('\n');
}

// ── CLI entry point ────────────────────────────────────────────────────────

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const action = computeDailyAction();

  console.log('\n' + formatDailyAction(action) + '\n');
  console.log(`Priority: ${action.priority}`);
  console.log(`Action:   ${action.action}`);
  console.log(`Why:      ${action.why}`);

  // Save for morning brief and other consumers
  fs.writeFileSync(
    path.join(DATA_DIR, 'daily-action.json'),
    JSON.stringify({ ...action, generatedAt: new Date().toISOString() }, null, 2)
  );
  console.log('\n✓ Saved to data/daily-action.json');
}
