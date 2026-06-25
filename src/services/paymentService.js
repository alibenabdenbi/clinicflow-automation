// src/services/paymentService.js
// Defines the 3 ClinicFlow service tiers and generates payment emails.
// Three payment options accepted: Interac e-transfer, Wave invoice, Stripe.
// See docs/payment-setup.md for setup instructions.

// Payment options available to all tiers
export const PAYMENT_OPTIONS = {
  interac: {
    method: "Interac e-Transfer",
    details: "Send to contact@clinicflowautomation.com — add your clinic name in the message field",
  },
  wave: {
    method: "Wave invoice (credit card or bank transfer)",
    details: "[WAVE_INVOICE_LINK_PLACEHOLDER]",
    note: "We'll send you a formal invoice via Wave if you prefer this route — just ask",
  },
  stripe: {
    method: "Stripe (credit card)",
    details: "[STRIPE_LINK_PLACEHOLDER]",
    note: "Direct card payment link — available on request",
  },
};

export const TIERS = {
  starter: {
    id: "starter",
    name: "Starter",
    price: 397,
    currency: "CAD",
    description: "Done-for-you missed call recovery + appointment reminders + monthly newsletter. We build it, you approve it.",
    deliverables: [
      "Missed call follow-up sequence (fires within 2 minutes of missed call)",
      "Appointment reminders — SMS at 72h and 24h before each visit",
      "Monthly newsletter (we send on your behalf)",
      "Monthly results report",
    ],
    addOns: [],
    deliveryDays: 5,
  },
  growth: {
    id: "growth",
    name: "Growth",
    price: 997,
    currency: "CAD",
    description: "Everything in Starter + patient reactivation campaign + new patient welcome + Google review automation. Fully built and managed.",
    deliverables: [
      "Everything in Starter",
      "Patient reactivation campaign (5 emails — sent directly to inactive patients)",
      "New patient welcome sequence (4 emails)",
      "Google review automation (fires after each completed visit)",
      "Monthly results report",
    ],
    addOns: [],
    deliveryDays: 7,
  },
  full: {
    id: "full",
    name: "Full",
    price: 2497,
    currency: "CAD",
    description: "Everything in Growth + priority support + monthly management + quarterly optimization.",
    deliverables: [
      "Everything in Growth",
      "Custom branded templates in your clinic's voice",
      "Priority support — same-day response",
      "Monthly management",
      "Quarterly optimization review",
    ],
    addOns: [],
    deliveryDays: 7,
  },
  retainer: {
    id: "retainer",
    name: "Monthly Support Retainer",
    price: 97,
    currency: "CAD",
    billingCycle: "monthly",
    description: "Optional ongoing support — available on any tier",
    deliverables: [
      "Monthly results review with written summary",
      "2 sequence updates per month on request",
      "One new automation added per quarter",
      "Priority email support — same-day response",
    ],
    note: "Add-on only — requires an active Starter, Growth, or Full setup. Cancel anytime.",
  },

  // ── Digital packages (for clinics with no website) ────────────────────────

  digital_starter: {
    id: "digital_starter",
    name: "Digital Starter",
    price: 797,
    currency: "CAD",
    description: "One-page website + Google Business Profile setup + missed call automation",
    deliverables: [
      "Professional one-page website (mobile-optimised, fast-loading)",
      "Google Business Profile setup guide (step-by-step, we walk you through it)",
      "Missed call auto-text — responds within 2 minutes of a missed call",
      "Basic appointment reminder (24h before visit)",
      "60-day email support",
    ],
    deliveryDays: 5,
    market: "nowebsite",
  },
  digital_growth: {
    id: "digital_growth",
    name: "Digital Growth",
    price: 1497,
    currency: "CAD",
    description: "3–5 page website + Google Business Profile optimization + full automation suite",
    deliverables: [
      "3–5 page professional website (Home, About, Services, Contact, Book Online)",
      "Google Business Profile optimization (photos, categories, posts, review strategy)",
      "Full automation suite: missed call texts, appointment reminders (72h + 24h), recall campaign, new patient welcome",
      "Post-visit follow-up with Google review request",
      "90-day check-in call included",
    ],
    deliveryDays: 7,
    market: "nowebsite",
  },
  digital_full: {
    id: "digital_full",
    name: "Digital Full",
    price: 2497,
    currency: "CAD",
    description: "Everything in Digital Growth + monthly newsletter + review automation + 90-day growth plan",
    deliverables: [
      "Everything in Digital Growth",
      "Monthly patient newsletter (written, branded, sent on your behalf)",
      "Automated Google review request sequence (3-touch, staggered)",
      "Personalized 90-day growth plan with monthly milestones",
      "Custom messaging in your clinic's brand voice",
      "6-month check-in and website updates included",
    ],
    deliveryDays: 7,
    market: "nowebsite",
  },
};

/**
 * Returns a ready-to-send payment email for the given tier.
 * @param {"starter"|"growth"|"full"} tierId
 * @param {string} clinicName
 * @returns {{ subject: string, body: string }}
 */
export function generatePaymentEmail(tierId, clinicName) {
  const tier = TIERS[tierId];
  if (!tier) throw new Error(`Unknown tier: ${tierId}`);

  const deliverableList = tier.deliverables
    .map((d, i) => `  ${i + 1}. ${d}`)
    .join("\n");

  const isRecurring = tier.billingCycle === "monthly";
  const subject = `ClinicFlow ${tier.name} — how to pay ($${tier.price} CAD${isRecurring ? "/mo" : ""})`;

  const body = `Hi,

Thanks for confirming — here's how to pay for the ${tier.name} package.

Amount: $${tier.price} CAD ${isRecurring ? `per month (cancel anytime)` : `(one-time, no subscription, no monthly fees)`}

Payment options — whatever is easiest for you:

  1. Interac e-Transfer (easiest for most Canadian clinics)
     Send to: contact@clinicflowautomation.com
     Message field: "${clinicName} — ${tier.name}"

  2. Wave invoice (credit card or bank transfer)
     I can send you a formal invoice via Wave — just reply and I'll have it to you within the hour.
     Link: ${PAYMENT_OPTIONS.wave.details}

  3. Stripe (credit card link)
     Available on request — reply "Stripe" and I'll send the direct card link.
     ${PAYMENT_OPTIONS.stripe.details}

What's included:
${deliverableList}

Once payment is confirmed, I'll reach out within one business day to gather the setup details I need. Most setups are complete within ${tier.deliveryDays} business days from that point.

If you have any questions before paying, just reply here.

Mohamed
contact@clinicflowautomation.com`;

  return { subject, body };
}
