// src/execution/runOutreach.js
import fs from "fs";
import path from "path";
import { pathToFileURL } from "url";

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf-8"));
}
function writeJson(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
}
function nowIso() {
  return new Date().toISOString();
}

function pickCommentText(lead) {
  const text = `${lead.postTitle || ""} ${lead.painSnippet || ""}`.toLowerCase();

  const isGhosting = /ghost|ignored|no response|follow up|follow-up/.test(text);
  const isScope = /scope creep|extra work|change request|revisions|unpaid revisions/.test(text);
  const isInvoice = /invoice|invoicing|billing|subscription|tool cost|quickbooks|freshbooks/.test(text);
  const isDispute = /dispute|chargeback|refus|refusing payment|scam|fraud/.test(text);

  if (isGhosting) {
    return "That’s brutal. Biggest fix I’ve seen: deposit + milestone plan + follow-ups (Day 1/3/7) written upfront. If you want, paste the key requirements and I’ll generate a clean scope + milestone invoice plan.";
  }
  if (isScope) {
    return "Scope creep is the silent killer. A 1-page scope + change-request rule + milestone billing usually stops it fast. If you want, paste the requirements and I’ll generate a scope + milestone plan you can reuse.";
  }
  if (isInvoice) {
    return "A lot of invoicing tools are overpriced for what freelancers need. A simple scope + milestone plan + reminder templates goes a long way. If you want, I can generate a clean scope+invoice pack from your client message.";
  }
  if (isDispute) {
    return "Payment disputes suck. Best defense is documentation: scope, acceptance checkpoints, and milestone invoicing with written confirmations. If you paste the client convo/requirements, I can generate a proof-friendly scope + milestone plan.";
  }

  return "Quick thought: a 1-page scope + deposit/milestones + 2–3 scheduled follow-ups prevents most payment headaches. If you want, paste the key requirements and I’ll generate a clean scope + milestone invoice plan.";
}

function pickDmText(lead, productName = "ScopeShield") {
  const name = lead.name || "there";
  const title = (lead.postTitle || "your post").replace(/\s+/g, " ").trim();
  const snippet = (lead.painSnippet || "").replace(/\s+/g, " ").slice(0, 180);

  return (
`Hey ${name} — I saw your post: "${title}"

This part stood out:
"${snippet}"

I’m building ${productName}: paste client chat → it generates:
• 1-page scope
• deposit + milestones
• invoice-ready text
• Day 1/3/7 follow-ups

Want me to run it free on one of your current clients and send you the pack?`
  ).trim();
}

function tierFromLead(lead) {
  return lead.tier || "B";
}

function makeTask(lead) {
  const platform = (lead.platform || "").toLowerCase();
  const tier = tierFromLead(lead);

  // default: reddit comments are safest; DM optional
  if (platform === "reddit") {
    return {
      leadId: lead.leadId,
      tier,
      platform: "reddit",
      subreddit: lead.subreddit || null,
      name: lead.name || null,
      postTitle: lead.postTitle,
      postUrl: lead.postUrl,
      profileUrl: lead.profileUrl,
      type: "comment",                 // <- approval queue item
      suggestedText: pickCommentText(lead),
      dmText: pickDmText(lead, "ScopeShield"), // optional if you decide to DM
    };
  }

  return {
    leadId: lead.leadId,
    tier,
    platform: lead.platform || "unknown",
    name: lead.name || null,
    postTitle: lead.postTitle,
    postUrl: lead.postUrl,
    profileUrl: lead.profileUrl,
    type: "dm",
    suggestedText: pickDmText(lead, "ScopeShield"),
  };
}

function selectTodaysTasks(leads, limit = 12) {
  const sorted = [...leads].sort((a, b) => {
    const ta = (a.tier || "B") === "A" ? 0 : 1;
    const tb = (b.tier || "B") === "A" ? 0 : 1;
    const sa = typeof a.score === "number" ? -a.score : 0;
    const sb = typeof b.score === "number" ? -b.score : 0;
    return ta - tb || sa - sb;
  });
  return sorted.slice(0, limit);
}

function isFollowupDue(lead) {
  if (!lead?.nextFollowUpAt) return false;
  const due = Date.parse(lead.nextFollowUpAt);
  return Number.isFinite(due) && due <= Date.now();
}

export async function runOutreach({ tasksToday = 12 } = {}) {
  const readyPath = path.join("data", "leads.ready.json");
  const crmPath = path.join("data", "crm.leads.json");

  if (!fs.existsSync(readyPath)) throw new Error("Missing data/leads.ready.json — run `npm run start` first.");
  if (!fs.existsSync(crmPath)) throw new Error("Missing data/crm.leads.json — run `npm run start` first.");

  const readyBatch = readJson(readyPath); // today’s fresh leads
  const crm = readJson(crmPath);          // long-lived state

  const totalLeads = crm.length;
  const tierA_new = crm.filter((l) => l.tier === "A" && l.status === "new").length;
  const tierB_new = crm.filter((l) => l.tier !== "A" && l.status === "new").length;
  const followups_due = crm.filter((l) => isFollowupDue(l) && !["closed_won", "closed_lost"].includes(l.status)).length;

  // only pick leads that are still "new" in CRM
  const crmById = new Map(crm.map((l) => [l.leadId, l]));
  const onlyNew = (readyBatch || []).filter((l) => (crmById.get(l.leadId)?.status || "new") === "new");

  const todaysLeads = selectTodaysTasks(onlyNew, tasksToday);
  const tasks = todaysLeads.map(makeTask);

  // mark selected as queued in CRM
  const now = nowIso();
  const taskLeadIds = new Set(tasks.map((t) => t.leadId));
  const updatedCrm = crm.map((l) => {
    if (!taskLeadIds.has(l.leadId)) return l;
    return {
      ...l,
      status: "queued",
      lastAction: "queued",
      lastActionAt: now,
      updatedAt: now,
    };
  });

  const out = {
    generatedAt: now,
    counts: { totalLeads, tierA_new, tierB_new, followups_due, tasks_today: tasks.length },
    tasks, // approval queue
  };

  writeJson(path.join("data", "outreach.queue.json"), out);
  writeJson(crmPath, updatedCrm);

  console.log("\n=== AUTONOMOUS OUTREACH ===\n");
  console.log(`Leads total (CRM): ${totalLeads} | Tasks today: ${tasks.length}`);
  console.log(`Tier A new: ${tierA_new} | Tier B new: ${tierB_new}`);
  console.log(`Followups due: ${followups_due}`);
  console.log("\nSaved: data/outreach.queue.json");
  console.log("Updated: data/crm.leads.json\n");
}

// ✅ robust “run as script” check (works on Windows)
const isDirectRun =
  process.argv[1] &&
  pathToFileURL(process.argv[1]).href === import.meta.url;

if (isDirectRun) {
  runOutreach({ tasksToday: 12 }).catch((e) => {
    console.error("❌ runOutreach error:", e);
    process.exit(1);
  });
}
