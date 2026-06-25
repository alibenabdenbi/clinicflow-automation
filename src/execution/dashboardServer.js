// src/execution/dashboardServer.js
import express from "express";
import fs from "fs";
import path from "path";

const app = express();
const PORT = process.env.PORT || 8787;

const ROOT = process.cwd();
const DATA_DIR = path.join(ROOT, "data");
const PUBLIC_DIR = path.join(ROOT, "public");

// ---- helpers
function safeReadJson(file) {
  const p = path.join(DATA_DIR, file);
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, "utf-8"));
  } catch {
    return null;
  }
}

function safeWriteJson(file, data) {
  const p = path.join(DATA_DIR, file);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(data, null, 2), "utf-8");
}

function nowIso() {
  return new Date().toISOString();
}

function updateLead(crm, leadId, patch) {
  const idx = crm.findIndex((l) => l.leadId === leadId);
  if (idx === -1) return false;
  crm[idx] = {
    ...crm[idx],
    ...patch,
    updatedAt: nowIso(),
  };
  return true;
}

function updateQueueTask(queue, leadId, patch) {
  if (!queue || !Array.isArray(queue.tasks)) return false;
  const idx = queue.tasks.findIndex((t) => t.leadId === leadId);
  if (idx === -1) return false;
  queue.tasks[idx] = {
    ...queue.tasks[idx],
    ...patch,
    updatedAt: nowIso(),
  };
  return true;
}

// ---- static site
app.use(express.json({ limit: "1mb" }));
app.use(express.static(PUBLIC_DIR));

// ---- API
app.get("/api/health", (_req, res) => {
  res.json({ ok: true, time: nowIso() });
});

app.get("/api/outreach-queue", (_req, res) => {
  const queue = safeReadJson("outreach.queue.json");
  res.json(queue || { generatedAt: null, counts: {}, tasks: [] });
});

app.get("/api/crm", (_req, res) => {
  const crm = safeReadJson("crm.leads.json");
  res.json(crm || []);
});

/**
 * Edit a draft task in outreach.queue.json (no CRM update)
 * Body:
 * {
 *   "leadId": "...",
 *   "suggestedComment": "optional",
 *   "suggestedDM": "optional",
 *   "chosenAction": "comment" | "dm" | "email" | "unknown",
 *   "notes": "optional"
 * }
 */
app.post("/api/outreach/task-edit", (req, res) => {
  const { leadId, suggestedComment, suggestedDM, chosenAction, notes } = req.body || {};
  if (!leadId) return res.status(400).json({ ok: false, error: "leadId required" });

  const queue = safeReadJson("outreach.queue.json") || { generatedAt: null, counts: {}, tasks: [] };

  const patch = {};
  if (typeof suggestedComment === "string") patch.suggestedComment = suggestedComment;
  if (typeof suggestedDM === "string") patch.suggestedDM = suggestedDM;
  if (typeof chosenAction === "string") patch.chosenAction = chosenAction;
  if (typeof notes === "string") patch.notes = notes;

  const ok = updateQueueTask(queue, leadId, patch);
  if (!ok) return res.status(404).json({ ok: false, error: "leadId not found in outreach.queue.json" });

  safeWriteJson("outreach.queue.json", queue);
  res.json({ ok: true });
});

/**
 * One-call action: update CRM + outreach.queue together
 * Body:
 * {
 *   "leadId": "...",
 *   "action": "approve" | "sent" | "skip",
 *   "channel": "comment" | "dm" | "email" | "unknown",
 *   "note": "optional"
 * }
 */
app.post("/api/outreach/task-action", (req, res) => {
  const { leadId, action, channel, note } = req.body || {};
  if (!leadId || !action) {
    return res.status(400).json({ ok: false, error: "leadId + action required" });
  }

  const crm = safeReadJson("crm.leads.json") || [];
  const queue = safeReadJson("outreach.queue.json") || { generatedAt: null, counts: {}, tasks: [] };

  const newStatus =
    action === "approve" ? "approved" :
    action === "sent" ? "sent" :
    action === "skip" ? "skipped" :
    "updated";

  // 1) update CRM
  const crmOk = updateLead(crm, leadId, {
    status: newStatus,
    lastAction: `${action}${channel ? `:${channel}` : ""}`,
    lastActionAt: nowIso(),
    notes: note ? String(note) : (crm.find((l) => l.leadId === leadId)?.notes || ""),
  });

  if (!crmOk) {
    return res.status(404).json({ ok: false, error: "leadId not found in crm.leads.json" });
  }

  // 2) update queue task too (so UI stops showing it as draft)
  updateQueueTask(queue, leadId, {
    status: newStatus,
    chosenAction: channel || (queue.tasks.find((t) => t.leadId === leadId)?.chosenAction ?? "comment"),
    notes: note ? String(note) : (queue.tasks.find((t) => t.leadId === leadId)?.notes || ""),
  });

  safeWriteJson("crm.leads.json", crm);
  safeWriteJson("outreach.queue.json", queue);

  res.json({ ok: true });
});

/**
 * Keep your original endpoint too (optional)
 * Body:
 * {
 *   "leadId": "...",
 *   "action": "approve" | "sent" | "skip",
 *   "channel": "comment" | "dm" | "email" | "unknown",
 *   "note": "optional"
 * }
 */
app.post("/api/crm/action", (req, res) => {
  const { leadId, action, channel, note } = req.body || {};
  if (!leadId || !action) return res.status(400).json({ ok: false, error: "leadId + action required" });

  const crm = safeReadJson("crm.leads.json") || [];
  const ok = updateLead(crm, leadId, {
    status:
      action === "approve" ? "approved" :
      action === "sent" ? "sent" :
      action === "skip" ? "skipped" :
      "updated",
    lastAction: `${action}${channel ? `:${channel}` : ""}`,
    lastActionAt: nowIso(),
    notes: note ? String(note) : (crm.find((l) => l.leadId === leadId)?.notes || ""),
  });

  if (!ok) return res.status(404).json({ ok: false, error: "leadId not found in crm.leads.json" });

  safeWriteJson("crm.leads.json", crm);
  res.json({ ok: true });
});

app.listen(PORT, () => {
  console.log(`\n✅ Dashboard running: http://localhost:${PORT}/dashboard/\n`);
});
