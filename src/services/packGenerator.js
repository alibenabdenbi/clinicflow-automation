// src/services/packGenerator.js
// Generates a consultant-quality 3-tier offer pack for a confirmed lead.
// Offer is specific to the lead's pain point / theme, not generic.

import fs from "fs";
import path from "path";

function readJsonSafe(filePath, fallback = null) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, "utf-8"));
  } catch {
    return fallback;
  }
}

// ─── Pain-point → offer mapping ───────────────────────────────────────────────

const THEME_OFFERS = {
  "Client Acquisition": {
    pain: "getting a consistent flow of new clients without relying on referrals or paid ads",
    starter: {
      name: "Lead Capture Starter",
      price: "$297–$497",
      deliverables: [
        "1 automated follow-up sequence for new inquiry forms (3 messages, 7 days)",
        "Missed-call text-back setup (responds within 60 seconds)",
        "Simple lead tracking sheet (Google Sheets, no new software)",
      ],
      solves: "Stops new patient inquiries from slipping through the cracks",
      result: "Typically recovers 2–4 leads per month that would have gone unanswered",
    },
    growth: {
      name: "New Patient Growth System",
      price: "$797–$1,297",
      deliverables: [
        "Everything in Starter",
        "Google review request automation (sent 24h after appointment)",
        "Reactivation campaign for patients inactive 6+ months (1-time send)",
        "Monthly performance summary (leads captured, reviews gained)",
      ],
      solves: "Builds a steady review pipeline and reactivates dormant patients",
      result: "Clients typically see 8–15 new Google reviews in the first 60 days",
    },
    full: {
      name: "Full Client Acquisition Engine",
      price: "$1,997–$2,997",
      deliverables: [
        "Everything in Growth",
        "Custom booking confirmation and reminder sequence (reduces no-shows)",
        "Referral request automation for happy patients",
        "Quarterly strategy call to review and optimize sequences",
        "Done-for-you setup — no technical work required from the clinic team",
      ],
      solves: "Replaces ad-hoc follow-up with a reliable, automated patient acquisition system",
      result: "Clinics report 20–35% reduction in no-shows and a consistent 5-star review stream",
    },
  },

  "Client Ops & Freelancing": {
    pain: "scope creep, late payments, and clients who ghost after the work is done",
    starter: {
      name: "Scope & Invoice Starter Pack",
      price: "$297–$497",
      deliverables: [
        "1-page scope document template (clear deliverables, exclusions, revision policy)",
        "3-milestone payment schedule template (deposit, mid, completion)",
        "Invoice template with late-fee clause and payment terms",
      ],
      solves: "Sets clear expectations before work starts — prevents disputes",
      result: "Clients report fewer scope arguments and faster payment on first invoices",
    },
    growth: {
      name: "Client Workflow System",
      price: "$797–$1,297",
      deliverables: [
        "Everything in Starter",
        "7-day follow-up sequence for unpaid invoices (3 messages, escalating tone)",
        "Proposal template with embedded payment link",
        "Onboarding checklist sent automatically when a project starts",
      ],
      solves: "Automates the awkward parts of client management — follow-up, invoicing, onboarding",
      result: "Average payment time drops from 21 to 7 days for clients who implement this",
    },
    full: {
      name: "Complete Client Management Engine",
      price: "$1,997–$2,997",
      deliverables: [
        "Everything in Growth",
        "Custom CRM setup in Notion or Airtable (no monthly fees)",
        "Client health score tracking (risk flags for scope creep early)",
        "End-of-project review request + testimonial automation",
        "90-day support via email for any template adjustments",
      ],
      solves: "Treats client relationships as a system, not a series of one-off conversations",
      result: "Freelancers using this report 40% less time on admin and fewer payment disputes",
    },
  },

  "AI & Tech News": {
    pain: "keeping up with AI tools while figuring out which ones are actually useful for the business",
    starter: {
      name: "AI Workflow Audit",
      price: "$297–$497",
      deliverables: [
        "30-minute discovery call to map current manual workflows",
        "Written report: top 3 tasks that can be automated with existing AI tools",
        "Tool shortlist with cost estimates and time-to-implement ratings",
      ],
      solves: "Cuts through AI hype and identifies what's actually worth implementing now",
      result: "Most businesses find 2–3 hours/week of recoverable time in the first pass",
    },
    growth: {
      name: "AI Implementation Sprint",
      price: "$797–$1,297",
      deliverables: [
        "Everything in Starter",
        "Setup of 2 automations using existing free/low-cost tools",
        "Written SOPs so the team can maintain them without you",
        "30-day check-in call",
      ],
      solves: "Moves from 'we should use AI' to 'we are using AI' in under 30 days",
      result: "Clients recover an average of 5–8 hours/week after implementation",
    },
    full: {
      name: "Full AI Operations Buildout",
      price: "$1,997–$2,997",
      deliverables: [
        "Everything in Growth",
        "Complete automation audit across sales, ops, and delivery workflows",
        "Up to 5 automations built and deployed",
        "Team training session (1 hour, recorded)",
        "60-day support window for adjustments",
      ],
      solves: "Systematically removes manual bottlenecks across the business using AI",
      result: "Teams report freeing up 10–20% of working hours within 60 days",
    },
  },

  "Ecommerce & Conversion": {
    pain: "high traffic but low conversion — visitors leave without buying",
    starter: {
      name: "Conversion Quick Fix",
      price: "$297–$497",
      deliverables: [
        "Audit of top 3 drop-off points in the checkout flow",
        "Written recommendations with priority ranking",
        "Abandoned cart email sequence (3 messages over 5 days)",
      ],
      solves: "Identifies exactly where revenue is being lost and fixes the most common one",
      result: "Average cart recovery rate of 8–15% with a basic abandoned cart sequence",
    },
    growth: {
      name: "Conversion Rate Growth Pack",
      price: "$797–$1,297",
      deliverables: [
        "Everything in Starter",
        "Post-purchase upsell sequence (1 email, sent 24h after purchase)",
        "Review request automation (sent 7 days post-delivery)",
        "Monthly KPI summary: conversion rate, AOV, recovery rate",
      ],
      solves: "Increases revenue from existing traffic without spending more on ads",
      result: "Clients typically see 12–20% revenue increase from existing traffic within 90 days",
    },
    full: {
      name: "Full Ecommerce Revenue Engine",
      price: "$1,997–$2,997",
      deliverables: [
        "Everything in Growth",
        "Complete email flow buildout (welcome, nurture, win-back, VIP)",
        "A/B test framework for subject lines and CTAs",
        "Quarterly strategy call to review performance and iterate",
        "Done-for-you Klaviyo or Mailchimp setup",
      ],
      solves: "Turns email into a predictable revenue channel, not an afterthought",
      result: "Email typically contributes 25–35% of total revenue for optimized stores",
    },
  },
};

// Default offer for unrecognized themes
const DEFAULT_OFFER = THEME_OFFERS["Client Acquisition"];

// ─── Pack builder ─────────────────────────────────────────────────────────────

function getThemeOffer(theme) {
  if (!theme) return DEFAULT_OFFER;
  const key = Object.keys(THEME_OFFERS).find(
    (k) => theme.toLowerCase().includes(k.toLowerCase().split(" ")[0].toLowerCase())
  );
  return THEME_OFFERS[key] || DEFAULT_OFFER;
}

/**
 * Generates a structured 3-tier offer pack for a confirmed CRM lead.
 *
 * @param {Object} lead - CRM lead object (must have leadId, theme, title)
 * @returns {Object} pack
 */
export async function generatePackForLead(lead) {
  if (!lead) return null;

  const offerDef = getThemeOffer(lead.theme);

  const clinicOrName =
    lead.clinicName || lead.name || lead.title?.slice(0, 60) || "your business";

  const pack = {
    leadId: lead.leadId,
    generatedAt: new Date().toISOString(),
    lead: {
      title: lead.title || "",
      source: lead.source || "",
      theme: lead.theme || "",
      tier: lead.tier || "",
      url: lead.url || "",
    },
    painSummary: `The core challenge: ${offerDef.pain}.`,
    offer: {
      tailoredFor: clinicOrName,
      tiers: [
        {
          name: offerDef.starter.name,
          price: offerDef.starter.price,
          deliverables: offerDef.starter.deliverables,
          solves: offerDef.starter.solves,
          expectedResult: offerDef.starter.result,
        },
        {
          name: offerDef.growth.name,
          price: offerDef.growth.price,
          deliverables: offerDef.growth.deliverables,
          solves: offerDef.growth.solves,
          expectedResult: offerDef.growth.result,
        },
        {
          name: offerDef.full.name,
          price: offerDef.full.price,
          deliverables: offerDef.full.deliverables,
          solves: offerDef.full.solves,
          expectedResult: offerDef.full.result,
        },
      ],
    },
    nextActions: [
      `Reply to ${clinicOrName} referencing: "${offerDef.pain}"`,
      "Send Starter tier first — easiest yes and lowest risk for them",
      "If no reply in 4 days, follow up with the specific result stat from Starter",
    ],
  };

  // Also try to pull any existing enrichment data
  const existingOffers = readJsonSafe(path.join("data", "offers.top3.json"), []);
  const matchedExisting = existingOffers.find((o) => o.theme === lead.theme);
  if (matchedExisting?.description) {
    pack.contextFromPipeline = matchedExisting.description;
  }

  return pack;
}
