// src/product/scopePayShield.js

function clean(s) {
  return (s || "").replace(/\r/g, "").trim();
}

function lines(s) {
  return clean(s).split("\n").map(x => x.trim()).filter(Boolean);
}

function guessProjectName(text) {
  const t = text.toLowerCase();
  if (t.includes("shopify")) return "Shopify project";
  if (t.includes("website") || t.includes("site")) return "Website project";
  if (t.includes("app") || t.includes("mobile")) return "App project";
  if (t.includes("logo") || t.includes("brand")) return "Branding project";
  return "Client project";
}

function extractDeliverables(text) {
  const ls = lines(text);

  // pick bullet-like lines
  const bulletish = ls.filter(l =>
    l.startsWith("-") || l.startsWith("*") || /^\d+[\).]/.test(l)
  ).map(l => l.replace(/^[-*\d\).]+\s*/, "").trim());

  // if none, attempt to infer from keywords
  if (bulletish.length >= 3) return bulletish.slice(0, 10);

  const t = text.toLowerCase();
  const inferred = [];

  if (t.includes("landing page")) inferred.push("Landing page");
  if (t.includes("shopify")) inferred.push("Shopify store setup + theme config");
  if (t.includes("products")) inferred.push("Product pages (copy + layout)");
  if (t.includes("payments") || t.includes("stripe")) inferred.push("Payments setup (Stripe/Shopify Payments)");
  if (t.includes("emails") || t.includes("klaviyo")) inferred.push("Email setup (basic flows)");
  if (t.includes("seo")) inferred.push("Basic SEO (titles/meta/sitemap)");
  if (t.includes("api")) inferred.push("API integration");
  if (t.includes("automation")) inferred.push("Automation workflow (v1)");

  if (inferred.length) return inferred.slice(0, 8);

  // fallback
  return [
    "Discovery call + requirements summary",
    "Scope document + timeline",
    "Deliverable #1",
    "Deliverable #2"
  ];
}

function extractTimeline(text) {
  const t = text.toLowerCase();
  const match = t.match(/(\d+)\s*(day|days|week|weeks|month|months)/i);
  if (match) return `${match[1]} ${match[2]}(s)`;
  return "7–14 days (estimate)";
}

function extractBudget(text) {
  const match = text.match(/(\$|cad|usd)?\s?(\d{2,6})(\s?(cad|usd))?/i);
  if (match) return `${match[1] ? match[1] : ""}${match[2]} ${match[4] ? match[4].toUpperCase() : ""}`.trim();
  return null;
}

function buildMilestones(deliverables, timeline) {
  // 3-step default: deposit / mid / final
  const chunk1 = deliverables.slice(0, Math.max(1, Math.ceil(deliverables.length / 3)));
  const chunk2 = deliverables.slice(chunk1.length, chunk1.length + Math.max(1, Math.ceil(deliverables.length / 3)));
  const chunk3 = deliverables.slice(chunk1.length + chunk2.length);

  const ms = [
    {
      name: "Milestone 1 — Kickoff + first deliverables",
      percent: 40,
      includes: chunk1.length ? chunk1 : ["Kickoff + initial work"]
    },
    {
      name: "Milestone 2 — Core build",
      percent: 30,
      includes: chunk2.length ? chunk2 : ["Core implementation"]
    },
    {
      name: "Milestone 3 — Final + handoff",
      percent: 30,
      includes: chunk3.length ? chunk3 : ["Final fixes + handoff"]
    }
  ];

  // add timeline hint
  ms[0].due = `Day 0–${Math.max(2, Math.round(0.3 * 14))} (within ${timeline})`;
  ms[1].due = `Midpoint (within ${timeline})`;
  ms[2].due = `Final day (within ${timeline})`;

  return ms;
}

function nowStamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

export function generateScopePack({ conversationText, clientName = "Client", freelancerName = "You" }) {
  const text = clean(conversationText);
  const projectName = guessProjectName(text);
  const deliverables = extractDeliverables(text);
  const timeline = extractTimeline(text);
  const budget = extractBudget(text);

  const milestones = buildMilestones(deliverables, timeline);

  const scopeMd = `# Scope of Work — ${projectName}

**Client:** ${clientName}  
**Provider:** ${freelancerName}  
**Timeline:** ${timeline}${budget ? `  \n**Budget mentioned:** ${budget}` : ""}

## Objective
Deliver the agreed scope with clear milestones and payment terms to reduce delays, scope creep, and ghosting.

## Deliverables
${deliverables.map(d => `- ${d}`).join("\n")}

## Assumptions
- Client provides required assets/access (logins, brand kit, content) within 48 hours of request.
- 1–2 revision rounds per milestone unless otherwise agreed.
- Any additional work outside deliverables becomes a **Change Request**.

## Change Request Policy
Anything not listed under Deliverables = new scope.  
Change requests are billed separately or added as a new milestone.

## Acceptance Criteria
A deliverable is “accepted” when:
- It matches the deliverable description, and
- Client confirms approval in writing (message/email) or after 72 hours with no objections.
`;

  const milestonesMd = `# Milestones & Payment Plan — ${projectName}

**Payment structure:** Deposit + milestone billing (recommended)

${milestones.map(m => `## ${m.name}
**%:** ${m.percent}%  
**Due:** ${m.due}  
**Includes:**
${m.includes.map(x => `- ${x}`).join("\n")}
`).join("\n")}

## Payment Terms
- Invoice due: **Net 7** (7 days)
- Late fee: **2% per week** after due date (optional)
- Work pauses if payment is overdue by 7+ days
`;

  const invoiceMd = `# Invoice Text (Copy/Paste)

**Invoice For:** ${projectName}  
**Client:** ${clientName}  
**Provider:** ${freelancerName}

## Line Items (Example)
- Deposit / Milestone 1 — 40%
- Milestone 2 — 30%
- Milestone 3 — 30%

## Terms
Payment due within **7 days**.  
If payment is delayed, work pauses until the invoice is paid.  
Change requests are billed separately.
`;

  const followupsMd = `# Follow-up & Anti-Ghosting Sequence (Copy/Paste)

## Reminder 1 (Day 1 after sending invoice)
Hey ${clientName} — quick check-in on the invoice for **${projectName}**.  
Once it’s paid, I’ll lock the schedule and start Milestone 1.

## Reminder 2 (Day 3)
Hey ${clientName}, just following up.  
To keep the timeline on track, I need the invoice cleared + any missing access/assets.

## Reminder 3 (Day 7)
Hey ${clientName}, final reminder before I pause work on **${projectName}**.  
Once payment is done, I’ll resume immediately.

## “Scope Creep” Response Template
Happy to add that — it’s outside the original deliverables, so I’ll send a quick change request + updated quote/timeline.
`;

  const tracker = {
    generatedAt: new Date().toISOString(),
    projectName,
    clientName,
    freelancerName,
    timeline,
    budgetMentioned: budget,
    status: "Proposed",
    deliverables,
    milestones,
    nextActions: [
      "Send Scope of Work for approval",
      "Send Deposit / Milestone 1 invoice",
      "Collect client assets/access"
    ]
  };

  return { stamp: nowStamp(), scopeMd, milestonesMd, invoiceMd, followupsMd, tracker };
}
