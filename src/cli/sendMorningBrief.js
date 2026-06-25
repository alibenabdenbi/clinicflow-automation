// Sends a daily morning brief to the operator's email.
// Usage: node src/cli/sendMorningBrief.js
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import nodemailer from "nodemailer";
import dotenv from "dotenv";
import { loadDailyPost, buildLinkedInBriefSection } from "../services/linkedinShare.js";
import { computeDailyAction, formatDailyAction } from "./computeDailyAction.js";
import { getIntentSignals, formatIntentSection } from "../services/intentEngine.js";
dotenv.config();

const ROOT      = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const DATA_DIR  = path.join(ROOT, "data");
const TO_EMAIL  = "m.aliben432@gmail.com";
const SMTP_HOST = process.env.SMTP_HOST;
const SMTP_PORT = Number(process.env.SMTP_PORT || 465);
const SMTP_USER = (process.env.SMTP_USER || "").trim();
const SMTP_PASS = process.env.SMTP_PASS;
const SMTP_FROM = (process.env.SMTP_FROM || SMTP_USER).trim();

function readJsonSafe(p, fallback) {
  try { return JSON.parse(fs.readFileSync(p, "utf-8")); } catch { return fallback; }
}

function todayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}

export async function buildBrief() {
  const today = todayKey();

  // ── #1 ACTION (always first — this is the whole point) ────────────────────
  let action;
  try {
    action = computeDailyAction();
    // Persist so scheduler and other tools can read it
    const DATA_DIR_BRIEF = path.join(ROOT, "data");
    fs.writeFileSync(
      path.join(DATA_DIR_BRIEF, "daily-action.json"),
      JSON.stringify({ ...action, generatedAt: new Date().toISOString() }, null, 2)
    );
  } catch (e) {
    action = { priority: 'ERROR', emoji: '⚠️', action: 'Could not compute daily action', why: e.message, script: '' };
  }

  const lines  = [
    `ClinicFlow Morning Brief — ${today}`,
    "=".repeat(48),
    "",
    formatDailyAction(action),
    "",
  ];

  // ── Intent signals — who's actively evaluating on the site ──────────────
  try {
    const intentSignals = await getIntentSignals();
    const intentText = formatIntentSection(intentSignals);
    if (intentText) {
      lines.push("── INTENT SIGNALS (visitors on calculator/report) ────");
      lines.push(intentText);
      lines.push("");
    }
  } catch (e) { /* live site not deployed — skip */ }

  // 0. Inbound SMS + calls (last 48h)
  const cutoff48h = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
  const inboundSms   = readJsonSafe(path.join(DATA_DIR, "inbound-sms.json"),   [])
    .filter(s => s.receivedAt >= cutoff48h && !s.responded);
  const inboundCalls = readJsonSafe(path.join(DATA_DIR, "inbound-calls.json"), [])
    .filter(c => c.receivedAt >= cutoff48h && !c.callbackDone);

  lines.push("── INBOUND ACTIVITY ──────────────────────────────");
  if (inboundSms.length === 0 && inboundCalls.length === 0) {
    lines.push("  No inbound messages in last 48h");
  } else {
    inboundSms.forEach(s =>
      lines.push(`  📱 ${s.clinicName} texted: "${(s.body || "").slice(0, 80)}" — ${s.receivedAt.slice(0, 16).replace("T", " ")}`)
    );
    inboundCalls.forEach(c =>
      lines.push(`  📞 ${c.clinicName} called: "${(c.transcription || "no transcription yet").slice(0, 80)}" — ${c.receivedAt.slice(0, 16).replace("T", " ")}`)
    );
  }
  lines.push("");

  // 1. Overnight replies — human only (bounces and auto-replies filtered upstream)
  const draftsDir = path.join(DATA_DIR, "reply-drafts");
  const allDrafts = fs.existsSync(draftsDir)
    ? fs.readdirSync(draftsDir)
        .filter(f => f.endsWith(".json"))
        .map(f => readJsonSafe(path.join(draftsDir, f), {}))
        .filter(d => !d.handled)
    : [];

  // Separate genuine interest from opt-outs
  const hotReplies = allDrafts.filter(d =>
    d.intent === 'INTERESTED' || d.intent === 'QUESTION' || d.intent === 'BOOKED' ||
    d.confidence === 'high' || d.positiveSignal
  );
  const optOuts = allDrafts.filter(d =>
    d.intent === 'UNSUBSCRIBE' || d.isNegative || d.intent === 'OPT_OUT'
  );
  const neutral = allDrafts.filter(d => !hotReplies.includes(d) && !optOuts.includes(d));

  lines.push("── HUMAN REPLIES (unhandled) ──────────────────────");
  if (hotReplies.length === 0 && neutral.length === 0) {
    lines.push("  No human replies — inbox clear.");
  } else {
    hotReplies.forEach(d => {
      lines.push(`  🔥 HOT: ${d.clinicName || "(unknown)"}`);
      lines.push(`    Intent: ${d.intent || "?"} | Subject: ${d.subject || "?"}`);
      if (d.fromEmail) lines.push(`    From: ${d.fromEmail}`);
    });
    neutral.forEach(d => {
      lines.push(`  📧 ${d.clinicName || "(unknown)"}`);
      lines.push(`    Intent: ${d.intent || "?"} | Subject: ${d.subject || "?"}`);
    });
  }
  if (optOuts.length > 0) {
    lines.push(`  ── OPT-OUTS TO REMOVE (${optOuts.length}) ──`);
    optOuts.forEach(d => lines.push(`  ✗ ${d.clinicName || d.fromEmail || "?"}`));
  }
  lines.push("");

  // 2. Today's send plan
  const dentists  = readJsonSafe(path.join(DATA_DIR, "outreach.localDentists.json"), []);
  const sendLog   = readJsonSafe(path.join(DATA_DIR, "smtp.emaillog.json"), []);
  const todaySends = sendLog.filter(e => (e.sentAt || "").startsWith(today));
  const pending   = dentists.filter(d => (d.status || "todo") === "todo" && d.emailConfidence === "high" && d.email);

  lines.push("── TODAY'S SEND PLAN ─────────────────────────────");
  lines.push(`  Sent so far today:      ${todaySends.length}`);
  lines.push(`  High-conf queue (todo): ${pending.length}`);
  if (todaySends.length > 0) {
    lines.push("  Recent sends:");
    todaySends.slice(0, 5).forEach(e => lines.push(`    • ${e.clinic} — variant:${e.variantLabel}`));
    if (todaySends.length > 5) lines.push(`    … and ${todaySends.length - 5} more`);
  }
  lines.push("");

  // 3. Voice drops today
  const drops     = readJsonSafe(path.join(DATA_DIR, "calls", "voicemail-drops.json"), []);
  const todayDrops = drops.filter(d => (d.scheduleTime || "").startsWith(today));

  lines.push("── VOICE DROPS TODAY (11:30am) ───────────────────");
  if (todayDrops.length === 0) {
    lines.push("  None scheduled.");
  } else {
    todayDrops.forEach(d => lines.push(`  • ${d.clinicName} | ${d.phone} | campaign:${d.campaignId}`));
  }
  lines.push("");

  // 4. Hot prospects (FU1 sent in last 7 days, no further action)
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const hot = dentists.filter(d =>
    d.sentAt && d.sentAt >= sevenDaysAgo &&
    (d.status === "followup_1_sent" || d.status === "sent")
  );

  lines.push("── HOT PROSPECTS (emailed last 7 days) ───────────");
  if (hot.length === 0) {
    lines.push("  None.");
  } else {
    // Rotate daily so different 8 show each day
    const offset = hot.length > 8 ? new Date().getDate() % hot.length : 0;
    const rotated = [...hot.slice(offset), ...hot.slice(0, offset)];
    rotated.slice(0, 8).forEach(d =>
      lines.push(`  • ${(d.clinicName || "?").padEnd(36)} ${d.email || ""} | ${d.sentAt?.slice(0,10)}`)
    );
    if (hot.length > 8) lines.push(`  … and ${hot.length - 8} more (rotating daily)`);
  }
  lines.push("");

  // 5. Calculator leads
  const calcLeads = readJsonSafe(path.join(DATA_DIR, "calculator-leads.json"), []);
  lines.push("── CALCULATOR LEADS ──────────────────────────────");
  const calcArr = Array.isArray(calcLeads) ? calcLeads : [];
  lines.push(`  Total: ${calcArr.length}`);
  if (calcArr.length > 0) {
    calcArr.slice(-3).forEach(l =>
      lines.push(`  • ${l.clinicName || l.name || "?"} | ${l.email || "no email"} | ${(l.submittedAt || l.createdAt || "?").slice(0,10)}`)
    );
  }
  lines.push("");

  // 6. Email open tracking stats
  lines.push("── EMAIL OPENS ───────────────────────────────────");
  try {
    const opens = readJsonSafe(path.join(DATA_DIR, "opens.json"), []);
    const todayOpens = opens.filter(o => (o.openedAt || "").startsWith(today));
    const byVariant = {};
    opens.forEach(o => { byVariant[o.variant] = (byVariant[o.variant] || 0) + 1; });
    const topEntry = Object.entries(byVariant).sort((a, b) => b[1] - a[1])[0];
    lines.push(`  Total: ${opens.length} | Today: ${todayOpens.length} | Top variant: ${topEntry ? topEntry[0] + " (" + topEntry[1] + ")" : "none yet"}`);
    if (todayOpens.length > 0) {
      todayOpens.slice(0, 3).forEach(o =>
        lines.push(`    • ${o.clinic || "?"} opened ${o.variant || "?"} at ${(o.openedAt || "").slice(11, 16)}`)
      );
    }
  } catch {
    lines.push("  Opens: no data yet");
  }
  lines.push("");

  // 7. LinkedIn hit list — rotation-first (French clinics), then enriched prospects
  const ROTATION_PATH = path.join(DATA_DIR, "linkedin", "prospect-rotation.json");
  const rotation = readJsonSafe(ROTATION_PATH, null);
  const useRotation = rotation && Array.isArray(rotation.prospects) && rotation.prospects.length > 0;

  lines.push("── TODAY'S LINKEDIN TARGETS ──────────────────────");

  let liTargets = [];  // hoisted — populated in else branch, read in action items

  if (useRotation) {
    const idx = rotation.currentIndex || 0;
    const rotSlice = rotation.prospects.slice(idx, idx + 3);
    const note = rotation.note ? ` [${rotation.note}]` : '';
    lines.push(`  Rotation: ${idx}/${rotation.prospects.length}${note}`);
    rotSlice.forEach((c, i) => {
      lines.push(`  ${i + 1}. ${(c.clinicName || '?').slice(0, 35)} — ${c.city || '?'} ⭐${c.rating || '?'}`);
      lines.push(`     Search: ${c.linkedinQuery}`);
      if (c.email) lines.push(`     Email:  ${c.email}`);
      lines.push("     ---");
    });
    // Advance index for tomorrow
    rotation.currentIndex = Math.min(idx + 3, rotation.prospects.length);
    try { fs.writeFileSync(ROTATION_PATH, JSON.stringify(rotation, null, 2)); } catch {}
    if (rotation.prospects.length - idx > 3) {
      lines.push(`  … ${rotation.prospects.length - idx - 3} more in rotation`);
    }
  } else {
    const prospects = readJsonSafe(path.join(DATA_DIR, "linkedin", "prospects.json"), []);
    liTargets = prospects
      .filter(p => !p.connectionSent)
      .sort((a, b) => {
        const aPain = (a.reviewPainScore || 0) >= 1 ? 0 : 1;
        const bPain = (b.reviewPainScore || 0) >= 1 ? 0 : 1;
        if (aPain !== bPain) return aPain - bPain;
        if ((b.reviewPainScore || 0) !== (a.reviewPainScore || 0))
          return (b.reviewPainScore || 0) - (a.reviewPainScore || 0);
        if (a.status === "todo" && b.status !== "todo") return -1;
        if (b.status === "todo" && a.status !== "todo") return 1;
        return 0;
      })
      .slice(0, 5);
    if (liTargets.length === 0) {
      lines.push("  No prospects yet — run: npm run linkedin:enrich");
    } else {
      liTargets.forEach((p, i) => {
        const name      = p.personName || "Unknown";
        const clinic    = (p.clinicName || "").slice(0, 35);
        const city      = (p.city || "").split(",")[0].trim();
        const angle     = p.angle || "outreach";
        const painFlag  = (p.reviewPainScore || 0) >= 1 ? " ★ PAIN SIGNAL" : "";
        lines.push(`  ${i + 1}. ${name} — ${clinic} — ${city} [${angle}]${painFlag}`);
        lines.push(`     Google: ${p.googleUrl}`);
        lines.push(`     LinkedIn: ${p.linkedinUrl}`);
        lines.push(`     ✉ ${p.connectionMessage}`);
        lines.push("     ---");
      });
      const remaining = prospects.filter(p => !p.connectionSent).length;
      if (remaining > 5) lines.push(`  … ${remaining - 5} more in queue (run npm run linkedin:enrich to refresh)`);
    }
  }
  lines.push("");

  // 8a. GMB daily targets
  const dailyTargets = readJsonSafe(path.join(DATA_DIR, "daily-targets.json"), null);
  const todayTargets = dailyTargets?.date === today ? dailyTargets : null;

  lines.push("── TODAY'S GMB MESSAGES (tap link → Message → paste) ─────");
  if (!todayTargets?.gmb?.length) {
    lines.push("  No targets yet — run: node src/cli/generateDailyTargets.js");
  } else {
    todayTargets.gmb.forEach((t, i) => {
      const city = (t.city || "").split(",")[0];
      lines.push(`  ${i + 1}. ${t.clinicName} — ${city} — ⭐${t.rating || "?"} (${t.reviewCount || 0} reviews)`);
      lines.push(`     Maps: ${t.mapsUrl}`);
      lines.push(`     Message: "${t.message}"`);
      if (t.personalDetail) lines.push(`     Why: ${t.personalDetail}`);
      lines.push("     ---");
    });
  }
  lines.push("");

  // 8b. Instagram daily targets
  lines.push("── TODAY'S INSTAGRAM DMs ─────────────────────────────────");
  if (!todayTargets?.instagram?.length) {
    lines.push("  No Instagram targets yet — enrichment populates these.");
  } else {
    todayTargets.instagram.forEach((t, i) => {
      lines.push(`  ${i + 1}. ${t.clinicName}`);
      lines.push(`     ${t.instagramUrl}`);
      lines.push(`     Message: "${t.message}"`);
    });
  }
  lines.push("");

  // 9. Priority action items
  const fu1Due = dentists.filter(d =>
    d.status === "sent" && d.followupDueAt && new Date(d.followupDueAt) <= new Date()
  );
  const gmbCount = todayTargets?.gmb?.length || 0;
  const igCount  = todayTargets?.instagram?.length || 0;
  lines.push("── ACTION ITEMS ──────────────────────────────────");
  if (drafts.length > 0)     lines.push(`  ★ Handle ${drafts.length} unread reply draft(s) — check Gmail`);
  if (fu1Due.length > 0)     lines.push(`  → Send FU1 to ${fu1Due.length} clinic(s) due today: npm run send:followups`);
  if (todayDrops.length > 0) lines.push(`  → ${todayDrops.length} voicemail drop(s) fire at 11:30am (Slybroadcast)`);
  if (liTargets.length > 0)  lines.push(`  → ${liTargets.length} LinkedIn target(s) above — send connection requests`);
  if (gmbCount > 0)          lines.push(`  → ${gmbCount} GMB message(s) above — open Maps link and tap Message`);
  if (igCount > 0)           lines.push(`  → ${igCount} Instagram DM(s) above — open handle and send`);
  if (drafts.length === 0 && fu1Due.length === 0 && todayDrops.length === 0 && liTargets.length === 0 && gmbCount === 0 && igCount === 0) {
    lines.push("  Nothing urgent — good morning!");
  }

  // LinkedIn daily post — one-tap share link
  const linkedInPost = loadDailyPost();
  const linkedInSection = buildLinkedInBriefSection(linkedInPost);
  if (linkedInSection) lines.push(linkedInSection);

  // Signal tracker — hot leads and confidence summary
  let signalSummary = { strong: 0, medium: 0, mobileOpens: 0, realHumans: 0, hotLeads: [] };
  try {
    const tracker = JSON.parse(fs.readFileSync(path.join(DATA_DIR, "signal-tracker.json"), "utf-8"));
    signalSummary = { ...signalSummary, ...(tracker.summary || {}), hotLeads: tracker.hotLeads || [] };
  } catch {}
  lines.push("\n── SIGNAL TRACKER ────────────────────────────────");
  if (signalSummary.strong > 0 || signalSummary.medium > 0) {
    lines.push(`  🔥 Strong (act NOW): ${signalSummary.strong}  ⚡ Medium: ${signalSummary.medium}  📱 Mobile: ${signalSummary.mobileOpens}`);
    signalSummary.hotLeads.slice(0, 3).forEach(l =>
      lines.push(`  → ${l.clinicName} (${l.confidence}) — ${l.hasMobile?'📱 Mobile':'💻 Desktop'} — ${l.openCount} open(s)`)
    );
  } else {
    lines.push("  No strong signals yet today.");
  }
  lines.push("  Dashboard → clinicflowautomation.com/signals (PIN: 8268)");

  // Click tracking summary — fetch from live API
  try {
    const clickRes = await Promise.race([
      fetch("https://clinicflowautomation.com/api/clicks"),
      new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), 5000)),
    ]);
    const clickData = await clickRes.json();
    if (clickData.ok) {
      lines.push("");
      lines.push("── LINK CLICKS ──────────────────────────────────────────");
      const calendly = (clickData.clicks || []).filter(c => c.type === "calendly");
      const live     = (clickData.clicks || []).filter(c => c.type === "live");
      const demo     = (clickData.clicks || []).filter(c => c.type === "demo");
      const proposal = (clickData.clicks || []).filter(c => c.type === "proposal");
      if (calendly.length > 0) {
        lines.push(`  🗓️  CALENDLY (${calendly.length}): ${calendly.map(c => c.clinic).join(", ")}`);
      }
      if (proposal.length > 0) {
        lines.push(`  📋 PROPOSAL (${proposal.length}): ${proposal.map(c => c.clinic).join(", ")}`);
      }
      if (live.length > 0) lines.push(`  🔴 Live page: ${live.length} click(s)`);
      if (demo.length > 0) lines.push(`  📱 Demo: ${demo.length} click(s)`);
      if (clickData.total === 0) lines.push("  No link clicks yet today");
      else lines.push(`  Total: ${clickData.total} click(s) today`);
    }
  } catch(e) { /* API unreachable or not deployed yet */ }

  // Hit list status
  try {
    const sequence = JSON.parse(fs.readFileSync(path.join(DATA_DIR, "hitlist", "sequence-tracker.json"), "utf-8"));
    const active   = sequence.filter(s => !s.replied && s.status === "in_sequence");
    const replied  = sequence.filter(s => s.replied);
    const booked   = sequence.filter(s => s.calendlyBooked);
    const touch1done = sequence.filter(s => s.touches?.touch1_email === "sent" || s.touches?.touch1_email === "done");
    lines.push("");
    lines.push("── TOP 50 HIT LIST ─────────────────────────────────────");
    lines.push(`  Active in sequence: ${active.length}`);
    lines.push(`  Touch 1 sent: ${touch1done.length}`);
    lines.push(`  Replied: ${replied.length}`);
    lines.push(`  Calendly booked: ${booked.length}`);
    if (replied.length > 0) {
      replied.forEach(s => lines.push(`  ★ REPLY: ${s.clinicName} — ${s.email}`));
    }

    // Mark-done commands for active entries (paste in terminal after a reply)
    const markDueEntries = sequence.filter(s =>
      !s.replied &&
      (s.touches?.touch1_email === 'sent' || s.touches?.touch1_email === 'done')
    ).slice(0, 8);
    if (markDueEntries.length > 0) {
      lines.push("");
      lines.push("── MARK-DONE COMMANDS (paste in terminal when they reply) ──");
      markDueEntries.forEach(s => {
        const safeEmail = (s.email || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
        const safeName  = (s.clinicName || '?').slice(0, 28);
        lines.push(`  ${safeName}:`);
        lines.push(`  node -e "const fs=require('fs');const d=JSON.parse(fs.readFileSync('data/hitlist/sequence-tracker.json','utf8'));const i=d.findIndex(x=>x.email==='${safeEmail}');if(i!==-1){d[i].replied=true;d[i].repliedAt=new Date().toISOString();fs.writeFileSync('data/hitlist/sequence-tracker.json',JSON.stringify(d,null,2));console.log('Done: ${safeName}');}"`);
        lines.push("");
      });
    }
  } catch(e) { /* hitlist not built yet */ }

  return lines.join("\n");
}

async function main() {
  const brief = await buildBrief();

  // Always print to console (useful when called from scheduler)
  console.log("\n" + brief + "\n");

  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) {
    console.log("SMTP not configured — brief printed to console only.");
    return;
  }

  const transporter = nodemailer.createTransport({
    host:   SMTP_HOST,
    port:   SMTP_PORT,
    secure: SMTP_PORT === 465,
    auth:   { user: SMTP_USER, pass: SMTP_PASS },
    tls:    { rejectUnauthorized: false },
  });

  const today = todayKey();
  const dailyAction = readJsonSafe(path.join(ROOT, "data", "daily-action.json"), {});
  const urgentPrefix = ['URGENT', 'HOT'].includes(dailyAction.priority)
    ? `${dailyAction.emoji || '🔴'} ${dailyAction.priority}: ${(dailyAction.action || '').slice(0, 35)} — `
    : '';
  await transporter.sendMail({
    from:    SMTP_FROM,
    to:      TO_EMAIL,
    subject: `${urgentPrefix}ClinicFlow Brief — ${today}`,
    text:    brief,
  });

  console.log(`Morning brief emailed → ${TO_EMAIL}`);
}

// Only run when invoked directly (not when imported for buildBrief)
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch(e => { console.error(e.message); process.exit(1); });
}
