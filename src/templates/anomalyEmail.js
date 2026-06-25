// src/templates/anomalyEmail.js
// Three cold email variants that delay the brain's categorization
// long enough for curiosity to form.
import { TRACKED } from '../services/clickTracker.js';
//
// Usage:
//   import { buildAnomalyEmail } from '../templates/anomalyEmail.js';
//   const { subject, body, variant } = buildAnomalyEmail(clinic);

/**
 * @param {object} clinic
 * @param {string} clinic.clinicName
 * @param {string} clinic.city
 * @param {string} [clinic.email]
 * @param {string[]} [clinic.painSignals]
 * @param {string} [clinic.contactName]
 * @returns {{ subject: string, body: string, variant: string }}
 */
export function buildAnomalyEmail(clinic) {
  const {
    clinicName = 'your clinic',
    city       = 'your city',
    painSignals = [],
    contactName = null,
  } = clinic;

  const name = contactName ? contactName.split(' ')[0] : 'there';
  const hasPain = painSignals.length > 0;

  // Clinic with pain signal → always Variant C
  if (hasPain) return variantC(name, clinicName, city, painSignals[0]);

  // Rotate A/B by clinic name hash (deterministic per clinic)
  const hash = clinicName.split('').reduce((a, c) => a + c.charCodeAt(0), 0);
  return hash % 2 === 0 ? variantA(name, city, clinicName) : variantB(name, city, clinicName);
}

// ─── Variant A — "Something I noticed" ───────────────────────────────────────

function variantA(name, city, clinicName = '') {
  const liveUrl     = TRACKED.live(clinicName || city);
  const calendlyUrl = TRACKED.calendly(clinicName || city);
  const subject = `something I noticed about ${city} clinics`;
  const body = `Hi ${name},

While reviewing callback flows across ${city} clinics, one pattern keeps showing up: calls that come in during peak hours go unanswered with no follow-up after.

Built a small live feed showing what this looks like:
${liveUrl}

Or text anything to +1 (575) 573-5822 to experience it yourself — takes 60 seconds.

Also published a free communication grade tool if you want to see how ${clinicName || city} compares to other clinics in ${city}: clinicflowautomation.com/report-card

Curious whether this matches what you see.

No new software. No training. One call forwarding setting on your existing phone — takes 2 minutes.

If you want to talk through it: ${calendlyUrl}

— Ali

Reply STOP to opt out.`;

  return { subject, body, variant: 'variant-a' };
}

// ─── Variant B — "The 12-2pm window" ─────────────────────────────────────────

function variantB(name, city, clinicName = '') {
  const liveUrl     = TRACKED.live(clinicName || city);
  const calendlyUrl = TRACKED.calendly(clinicName || city);
  const subject = `the 12-2pm window`;
  const body = `Hi ${name},

Something I keep seeing comparing clinics across ${city}: the lunch-hour window is where most missed callbacks disappear. Front desk is busy, nobody follows up, patient moves on.

If you're curious what that looks like in a live system:
${liveUrl}

Or text anything to +1 (575) 573-5822 to experience it yourself — takes 60 seconds.

Not sure if this is a universal pattern or specific to certain clinic types — still figuring that out.

No new software. No training. One call forwarding setting on your existing phone — takes 2 minutes.

Happy to talk through it: ${calendlyUrl}

— Ali

Reply STOP to opt out.`;

  return { subject, body, variant: 'variant-b' };
}

// ─── Variant C — Pain signal (for clinics with review complaints) ─────────────

function variantC(name, clinicName, city, painSignal) {
  const liveUrl     = TRACKED.live(clinicName);
  const calendlyUrl = TRACKED.calendly(clinicName);
  const subject = `noticed something about ${clinicName}`;
  const body = `Hi ${name},

I was looking at ${clinicName}'s Google reviews before reaching out. A few patients mentioned difficulty getting through — could be coincidence, but I've seen the same pattern at other ${city} clinics.

Built something that addresses exactly this:
${liveUrl}

Or text anything to +1 (575) 573-5822 to experience it yourself — takes 60 seconds.

Still refining it — curious whether it reflects what actually happens at ${clinicName}.

No new software. No training. One call forwarding setting on your existing phone — takes 2 minutes.

Happy to talk through it: ${calendlyUrl}

— Ali

Reply STOP to opt out.`;

  return { subject, body, variant: 'variant-c' };
}

// ─── Selector helper for sendBatch.js ────────────────────────────────────────
// Returns the variant key to use for logging/tracking.

export function anomalyVariantFor(clinic) {
  if ((clinic.painSignals || []).length > 0) return 'variant-c';
  const hash = (clinic.clinicName || '').split('').reduce((a, c) => a + c.charCodeAt(0), 0);
  return hash % 2 === 0 ? 'variant-a' : 'variant-b';
}
