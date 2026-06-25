// src/templates/noWebsiteTemplates.js
// Outreach templates for dental clinics with no professional website.
// Angle: position the missing website as an opportunity, not a flaw.
// Used by sendBatch.js when --market nowebsite is set.

import { extractGreetingName } from "../services/emailPersonalizer.js";

/**
 * Simple string hash → stable seed (same clinic always picks same variant)
 */
function hashStr(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = Math.imul(31, h) + s.charCodeAt(i);
  return Math.abs(h);
}

function pick(arr, seed) {
  return arr[Math.abs(seed) % arr.length];
}

const SIGN = `Mohamed
ClinicFlow Automation
contact@clinicflowautomation.com
clinicflowautomation.com
Montreal, QC · Canadian-built · PIPEDA compliant
30-day guarantee · No monthly fees`;

// ─── Subject variants ─────────────────────────────────────────────────────────

const SUBJECTS = [
  (name, city) => `Quick question — ${name}`.slice(0, 50),
  (name, city) => `${name} — your online presence`.slice(0, 50),
  (name, city) => `Found your clinic on Google Maps${city ? `, ${city}` : ""}`.slice(0, 50),
];

/**
 * Returns a personalized subject line for a no-website clinic.
 */
export function noWebsiteSubject({ clinicName, city } = {}) {
  const name = (clinicName || "your clinic").replace(/\s+/g, " ").trim();
  const seed = hashStr(name + (city || ""));
  return pick(SUBJECTS, seed)(name, city);
}

// ─── Body variants ────────────────────────────────────────────────────────────

/**
 * Returns a personalized email body for a no-website clinic.
 * Under 120 words, plain text, human tone.
 * @param {{ clinicName: string, city: string, email: string }} opts
 */
export function noWebsiteBody({ clinicName, city, email } = {}) {
  const name = (clinicName || "your clinic").replace(/\s+/g, " ").trim();
  const loc = city ? ` in ${city}` : "";
  const seed = hashStr(name + (city || ""));

  const greetName = extractGreetingName(email || "");
  const greeting  = greetName ? `Hi ${greetName},` : "Hi,";

  const openers = [
    `I came across ${name} on Google Maps while looking at dental practices${loc}. I noticed you don't have a website yet — which actually puts you in a strong position to capture patients your competitors are losing online.`,
    `I found ${name} while researching dental clinics${loc}. You don't have a website yet — in a market where patients search Google before calling, that's actually a gap you can close faster than most clinics think.`,
    `I spotted ${name} on Google Maps${loc}. No website yet — which means patients searching for a dentist right now aren't finding you, but that's fixable quickly.`,
  ];

  const bodies = [
    `I help Canadian clinics get online and automate their patient follow-up. Most clients see their first new patient from Google within 30 days of launch — without paid ads.

Would it be worth a quick email exchange to see if it makes sense for ${name}?`,

    `I build professional websites for dental clinics and wire in patient follow-up automation at the same time — missed call texts, appointment reminders, and recall sequences. One setup, no monthly fee for the automation.

Worth a quick look? I can put together a 1-page overview specific to ${name}.`,

    `I help clinics get found online and keep their schedules full with automated patient follow-up. Setup takes about 5 days and there are no ongoing fees for the automation side.

Happy to send a 1-page breakdown if it sounds relevant.`,
  ];

  const opener = pick(openers, seed);
  const body = pick(bodies, seed + 1);

  return `${greeting}

${opener}

${body}

${SIGN}`;
}

// ─── Convenience exports matching MARKET_BODY / MARKET_SUBJECT shape ─────────

export const NOWEBSITE_BODY = (name, city, email) => noWebsiteBody({ clinicName: name, city, email });
export const NOWEBSITE_SUBJECT = (name, city) => noWebsiteSubject({ clinicName: name, city });
