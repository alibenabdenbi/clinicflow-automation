// src/templates/salonTemplates.js
// Cold outreach email variants for salon/spa/beauty market.
// 4 angles: no-show, missed call, reactivation, review-triggered.
// Used by sendBatch.js via MARKET_BODY['salon'] in replyTemplates.js.

import { extractGreetingName } from "../services/emailPersonalizer.js";

function _hashStr(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = Math.imul(31, h) + s.charCodeAt(i);
  return Math.abs(h);
}
function _pick(arr, seed) { return arr[Math.abs(seed) % arr.length]; }

const SIGN = `Mohamed\n\nTo opt out of future emails, reply with 'unsubscribe'\nClinicFlow Automation · Montreal, QC · Canada`;

/**
 * Variant SA — The no-show problem
 * Subject: "{name} — quick question about no-shows"
 */
export function variantSA(name, city, email) {
  const greetName = extractGreetingName(email || "");
  const greeting  = greetName ? `Hi ${greetName},` : "Hi,";
  const loc       = city ? ` in ${city}` : "";

  const subject = `${name} — quick question about no-shows`.slice(0, 60);
  const body = `${greeting}

Quick question — what happens at ${name} when a client books an appointment and doesn't show up?

Most salons${loc} lose 2–4 appointments a week to no-shows and last-minute cancellations. That's $200–400 in revenue that just disappears — not including the stylist's time.

I help salons fix this automatically: confirmation texts when someone books, 24h reminders before each appointment, and an instant follow-up when someone no-shows. Setup takes 3 days. No monthly fees.

Worth a look?

${SIGN}`;
  return { subject, body };
}

/**
 * Variant SB — The missed call problem
 * Subject: "When {name} misses a call..."
 */
export function variantSB(name, city, email) {
  const greetName = extractGreetingName(email || "");
  const greeting  = greetName ? `Hi ${greetName},` : "Hi,";

  const subject = `When ${name} misses a call...`.slice(0, 60);
  const body = `${greeting}

When a client calls ${name} and the line is busy or no one answers — what happens next?

Most of the time, nothing. The client calls the next salon on Google.

I set up an automatic text that fires within 60 seconds of any missed call. The client gets a response immediately and stays engaged instead of booking elsewhere.

3-day setup. No monthly fees. You see it working before paying the second half.

Worth a quick look?

${SIGN}`;
  return { subject, body };
}

/**
 * Variant SC — The reactivation opportunity
 * Subject: "Clients {name} hasn't seen in a while"
 */
export function variantSC(name, city, email) {
  const greetName = extractGreetingName(email || "");
  const greeting  = greetName ? `Hi ${greetName},` : "Hi,";

  const subject = `Clients ${name} hasn't seen in a while`.slice(0, 60);
  const body = `${greeting}

Most salons have a group of clients who came once or twice and disappeared — never heard from again, never contacted.

I run an automatic reactivation campaign for ${name}: personalized outreach to every client who hasn't booked in 6+ months. Most salons bring back 15–25% of them within 30 days.

One-time setup. No monthly fees. No work on your end.

Interested in seeing how many clients ${name} could recover?

${SIGN}`;
  return { subject, body };
}

/**
 * Variant SR — Review-triggered (uses actual pain signal quote)
 * Subject: "Saw something about {name}"
 */
export function variantSR(name, city, email, reviewQuote) {
  const greetName = extractGreetingName(email || "");
  const greeting  = greetName ? `Hi ${greetName},` : "Hi,";
  const quote     = (reviewQuote || "").slice(0, 160);

  const subject = `Saw something about ${name}`.slice(0, 60);
  const body = `${greeting}

I was looking at ${name}'s reviews before reaching out. A client mentioned: "${quote}"

That specific issue — clients not hearing back after missed calls or appointments — is exactly what I help fix. Automatic follow-up for missed calls, booking confirmations, and reminders. No client should leave without hearing from you.

3-day setup. No monthly fees.

Worth a conversation?

${SIGN}`;
  return { subject, body };
}

/**
 * Master selector used by MARKET_BODY['salon'] in replyTemplates.js.
 * Picks variant deterministically by name hash; uses SR when pain quote available.
 * @param {string} name
 * @param {string} city
 * @param {string} email
 * @param {string} [reviewQuote]  — if present, SR is preferred over hash rotation
 * @returns {{ subject: string, body: string, variantLabel: string }}
 */
export function pickSalonVariant(name, city, email, reviewQuote) {
  if (reviewQuote && reviewQuote.length > 20) {
    const { subject, body } = variantSR(name, city, email, reviewQuote);
    return { subject, body, variantLabel: "SR" };
  }
  const seed     = _hashStr((name || "") + (city || ""));
  const variants = [
    { fn: variantSA, label: "SA" },
    { fn: variantSB, label: "SB" },
    { fn: variantSC, label: "SC" },
    { fn: variantSB, label: "SB" }, // SB twice — missed call angle performs well
  ];
  const picked = _pick(variants, seed);
  const { subject, body } = picked.fn(name, city, email);
  return { subject, body, variantLabel: picked.label };
}

export const SALON_SUBJECTS = {
  SA: (name) => `${name} — quick question about no-shows`.slice(0, 60),
  SB: (name) => `When ${name} misses a call...`.slice(0, 60),
  SC: (name) => `Clients ${name} hasn't seen in a while`.slice(0, 60),
  SR: (name) => `Saw something about ${name}`.slice(0, 60),
};
