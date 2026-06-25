// src/processors/offerBuilder.js

function pickPrimaryPain(painSnippet = "", fallback = "") {
  const s = (painSnippet || fallback || "").replace(/\s+/g, " ").trim();
  if (!s) return "things are getting messy and manual";
  return s.slice(0, 240);
}

function pickOfferByTheme(theme = "") {
  const t = (theme || "").toLowerCase();

  if (t.includes("client") && t.includes("acquisition")) {
    return {
      offerName: "Client Acquisition System (No-Spam)",
      promise: "Turn confused outreach into a simple pipeline that gets replies + booked calls.",
      deliverables: [
        "Ideal customer + offer positioning (1 page)",
        "Lead list method + qualifying rules",
        "Cold DM + cold email scripts (3 variants)",
        "Follow-up system (Day 1/3/7) + tracking sheet",
        "Simple booking + confirmation workflow",
      ],
      timeline: "48–72 hours",
      cta: "Want me to generate your outreach pack + follow-ups for free using your exact niche?",
    };
  }

  if (t.includes("ops") || t.includes("freelanc") || t.includes("client ops")) {
    return {
      offerName: "Scope → Deposit → Invoice Pack",
      promise: "Stop scope creep and late payments with a simple, repeatable client workflow.",
      deliverables: [
        "1-page scope template (ready to send)",
        "Deposit + milestones structure",
        "Invoice-ready wording (copy/paste)",
        "Follow-up system (Day 1/3/7) to reduce ghosting",
        "Simple checklist for delivery + sign-off",
      ],
      timeline: "24–48 hours",
      cta: "Want me to generate a free scope + milestones + invoice + follow-up pack for your current client?",
    };
  }

  if (t.includes("invoic") || t.includes("billing")) {
    return {
      offerName: "Invoice + Collections Automation",
      promise: "Get paid faster and reduce chargebacks with clearer terms + automatic follow-ups.",
      deliverables: [
        "Invoice structure + payment terms template",
        "Late fee / reminder schedule (gentle but firm)",
        "Chargeback prevention checklist",
        "Client sign-off + proof template",
        "Mini SOP you can repeat weekly",
      ],
      timeline: "24–48 hours",
      cta: "Want me to generate your invoice terms + reminders + chargeback-proof template for free?",
    };
  }

  return {
    offerName: "Mini Automation Sprint",
    promise: "Turn the manual parts of your workflow into a simple system you can repeat.",
    deliverables: [
      "Pain → workflow map (1 page)",
      "Automation plan (steps + tools)",
      "Templates/scripts for the most painful step",
      "Next actions for week 1",
    ],
    timeline: "48 hours",
    cta: "Want me to map your workflow and generate the templates for free?",
  };
}

function priceSuggestion(tier = "B") {
  if (tier === "A") return { range: "$300–$900", note: "High urgency / high value problem" };
  if (tier === "B") return { range: "$150–$400", note: "Clear pain + good fit" };
  return { range: "$50–$150", note: "Small fix / starter package" };
}

function buildConfirmLink(lead) {
  const id = lead?.leadId ?? lead?.id ?? lead?.postId ?? null;
  const safeId = id ? encodeURIComponent(String(id)) : "UNKNOWN_LEAD";
  return `http://localhost:3333/api/confirm/${safeId}`;
}

function buildOutreach({ lead, offer, problemStatement }) {
  const name = lead?.name && lead.name !== "unknown" ? lead.name : "there";
  const pain = pickPrimaryPain(lead?.painSnippet, lead?.postTitle);
  const confirm = buildConfirmLink(lead);

  const shortDM = `
Hey ${name} — I saw this and it’s super common:
"${pain}"

If you want, I can generate a quick pack for you:
• ${offer.deliverables[0]}
• ${offer.deliverables[1]}
• ${offer.deliverables[2]}

If yes, tap confirm and I’ll send it:
${confirm}
`.trim();

  const mediumDM = `
Hey ${name},

I saw your post: "${lead?.postTitle || "your post"}"

This part stood out:
"${pain}"

I’m building a small system that turns this into something clean + repeatable:
${offer.deliverables.slice(0, 5).map((d) => `• ${d}`).join("\n")}

If you want, I can generate the full pack for you (free).
Confirm here:
${confirm}
`.trim();

  const comment = `
I’ve seen this a lot. The fastest fix is: scope + deposit + milestones + follow-ups.
If you want, I can generate a 1-page scope + invoice wording + Day 1/3/7 follow-ups for your exact situation.
Reply “YES” and tell me your niche + typical project size.
`.trim();

  const email = `
Subject: Quick pack to fix: ${problemStatement || "scope + payment workflow"}

Hi ${name},

I came across your post and the pain is very clear:
"${pain}"

If you’d like, I can put together a small “workflow pack” for you:
${offer.deliverables.map((d) => `- ${d}`).join("\n")}

It takes about ${offer.timeline}. If you want it, confirm here:
${confirm}

Thanks,
(Your Name)
`.trim();

  return { shortDM, mediumDM, comment, email };
}

/**
 * Build offers + outreach scripts for the best leads.
 */
export function buildOffers({ leads = [], problems = [], maxOffers = 3 } = {}) {
  const topProblem = problems?.[0] || null;
  const defaultTheme = topProblem?.theme || (leads?.[0]?.theme ?? null);
  const defaultProblemStatement = topProblem?.problemStatement || null;

  const bestLeads = [...leads]
    .sort((a, b) => (b.totalLeadScore || b.score || 0) - (a.totalLeadScore || a.score || 0))
    .slice(0, Math.max(10, maxOffers * 5));

  const offers = [];
  const messages = [];

  for (const lead of bestLeads) {
    const theme = lead?.theme || defaultTheme || "General";
    const offer = pickOfferByTheme(theme);
    const pricing = priceSuggestion(lead?.tier || "B");

    const offerObj = {
      leadId: lead?.leadId || null,
      leadName: lead?.name || null,
      platform: lead?.platform || null,
      postUrl: lead?.postUrl || null,
      theme,
      offerName: offer.offerName,
      promise: offer.promise,
      deliverables: offer.deliverables,
      timeline: offer.timeline,
      price: pricing,
      primaryPain: pickPrimaryPain(lead?.painSnippet, lead?.postTitle),
      problemStatement: defaultProblemStatement,
      confirmLink: buildConfirmLink(lead),
    };

    const outreach = buildOutreach({
      lead,
      offer,
      problemStatement: defaultProblemStatement,
    });

    offers.push(offerObj);
    messages.push({
      leadId: offerObj.leadId,
      name: offerObj.leadName,
      platform: offerObj.platform,
      postUrl: offerObj.postUrl,
      theme: offerObj.theme,
      offerName: offerObj.offerName,
      confirmLink: offerObj.confirmLink,
      outreach,
    });
  }

  const seen = new Set();
  const topOffers = [];
  for (const o of offers) {
    const key = `${o.theme}__${o.offerName}`;
    if (seen.has(key)) continue;
    seen.add(key);
    topOffers.push(o);
    if (topOffers.length >= maxOffers) break;
  }

  return { offers: topOffers, messages };
}

export function buildOnePagerMarkdown({ offers = [] } = {}) {
  const o = offers?.[0];
  if (!o) return "# Offer\n\nNo offers yet.\n";

  return (
    `
# ${o.offerName}

**Promise:** ${o.promise}

## What you get
${o.deliverables.map((d) => `- ${d}`).join("\n")}

## Timeline
- ${o.timeline}

## Pricing (typical)
- ${o.price?.range || "TBD"} — ${o.price?.note || ""}

## Confirm
If you want me to generate your pack, confirm here:
${o.confirmLink}
`.trim() + "\n"
  );
}

/**
 * ✅ Compatibility exports (so old imports won’t break)
 */
export function buildLandingOnePager(args) {
  return buildOnePagerMarkdown(args);
}

export function buildOutreachMessages({ leads = [], problems = [], maxOffers = 3 } = {}) {
  const { messages } = buildOffers({ leads, problems, maxOffers });
  return messages;
}