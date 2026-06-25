// src/processors/crm.js
import crypto from "crypto";

function stableIdFromLead(lead) {
  const base = `${lead.platform || ""}|${lead.postUrl || lead.url || ""}|${lead.name || ""}|${lead.postTitle || lead.title || ""}`;
  return crypto.createHash("sha1").update(base).digest("hex").slice(0, 12);
}

export function initializeCRM(leads) {
  const now = new Date().toISOString();

  return (leads || []).map((l) => {
    const leadId = l.leadId || stableIdFromLead(l);

    return {
      // identity
      leadId,
      tier: l.tier || "B",
      platform: l.platform || l.source || "unknown",
      subreddit: l.subreddit || null,
      name: l.name || l.author || null,

      // content
      postTitle: l.postTitle || l.title || "",
      postUrl: l.postUrl || l.url || "",
      profileUrl: l.profileUrl || null,
      painSnippet: l.painSnippet || l.snippet || "",
      theme: l.theme || null,
      score: typeof l.totalLeadScore === "number" ? l.totalLeadScore : (typeof l.score === "number" ? l.score : null),

      // outreach state
      status: l.status || "new", // new -> queued -> acted -> replied -> closed_won/closed_lost
      lastAction: l.lastAction || null, // comment|dm|email|followup
      lastActionAt: l.lastActionAt || null,
      nextFollowUpAt: l.nextFollowUpAt || null,

      // tracking
      createdAt: l.createdAt || now,
      updatedAt: now,

      // room for later
      notes: l.notes || "",
      tags: Array.isArray(l.tags) ? l.tags : [],
    };
  });
}

/**
 * Merge incoming leads into existing CRM:
 * - keeps your existing statuses/notes (important)
 * - updates content fields if they changed
 */
export function mergeCrmLeads(existing = [], incoming = []) {
  const byId = new Map();

  for (const e of existing || []) {
    if (!e?.leadId) continue;
    byId.set(e.leadId, e);
  }

  for (const inc of incoming || []) {
    const leadId = inc?.leadId;
    if (!leadId) continue;

    const prev = byId.get(leadId);

    if (!prev) {
      byId.set(leadId, inc);
      continue;
    }

    // Preserve stateful fields from prev
    const merged = {
      ...inc,

      status: prev.status || inc.status,
      lastAction: prev.lastAction ?? inc.lastAction,
      lastActionAt: prev.lastActionAt ?? inc.lastActionAt,
      nextFollowUpAt: prev.nextFollowUpAt ?? inc.nextFollowUpAt,

      notes: (prev.notes && prev.notes.trim().length > 0) ? prev.notes : (inc.notes || ""),
      tags: Array.isArray(prev.tags) && prev.tags.length ? prev.tags : (Array.isArray(inc.tags) ? inc.tags : []),

      createdAt: prev.createdAt || inc.createdAt,
      updatedAt: new Date().toISOString(),
    };

    byId.set(leadId, merged);
  }

  // stable order: newest first
  return Array.from(byId.values()).sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""));
}
