// src/services/emailPersonalizer.js
// Generates personalized, human-sounding subject lines and email bodies.
// Never sounds like a template — varies by clinic name, city, and index.

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

// ─── Helpers ──────────────────────────────────────────────────────────────────

function pick(arr, seed) {
  return arr[Math.abs(seed) % arr.length];
}

function hashStr(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = Math.imul(31, h) + s.charCodeAt(i);
  }
  return Math.abs(h);
}

// ─── Clinic name cleaner ──────────────────────────────────────────────────────
// Strips website title bleed-through before using in subjects/bodies.

export function cleanClinicName(raw) {
  if (!raw) return "your clinic";

  // Strip generic " | …" suffixes before the first pipe split
  let name = raw
    .replace(/\s*\|\s*(just another\b.*|wordpress\b.*|.*\bdentist in\b.*|.*\bdental clinic in\b.*)/gi, "")
    .replace(/\s*\|\s*[A-Z][a-z]+,\s*[A-Z]{2}\s*$/g, "")   // " | City, BC" at end
    .split(/[|—]/)[0]
    .replace(/[.]{2,}.*$/, "")
    .replace(/\s*(dental clinic|dentistry|dental care|professional care|personal attention|superior results|family dentist|cosmetic dentist|your trusted|welcome to)\s*.*/gi, "")
    .trim();

  // Strip trailing .ca / .com
  name = name.replace(/\.(ca|com)$/i, "").trim();

  // Slug detection: all lowercase, no spaces (may have dots/hyphens)
  const isSlug = name.length > 0 && /^[a-z0-9][a-z0-9.\-]*$/.test(name);
  if (isSlug) {
    name = name
      .replace(/[.\-]+/g, " ")
      .replace(/\b\w/g, c => c.toUpperCase())
      .trim();
  }

  // Capitalize each word if no uppercase letters present at all
  if (name.length > 0 && name === name.toLowerCase()) {
    name = name.replace(/\b\w/g, c => c.toUpperCase());
  }

  if (name.length > 40) name = name.slice(0, 37) + "...";
  return name || raw.slice(0, 40);
}

// ─── Greeting extraction (IMPROVEMENT 1) ─────────────────────────────────────
// Extracts a personal name from a named email address.
// Returns "Dr. Anna" / "Wendy" / null (for generic addresses → use "Hi,").

const GENERIC_LOCAL = new Set([
  "info", "contact", "admin", "hello", "hi", "hey", "office", "reception",
  "mail", "enquiry", "inquiry", "general", "support", "team", "clinic",
  "dental", "dentistry", "care", "service", "appointment", "booking",
  "bookings", "staff", "billing", "client", "patients", "front", "desk",
  "noreply", "donotreply", "no-reply", "manager", "management",
  "appointments", "teeth", "tooth", "smile", "smiles", "health",
  // French generic terms
  "gestion", "direction", "accueil", "clinique", "secretariat", "secretaire",
  "administration", "administratif", "soins", "sante", "rdv", "reservation",
  // Known bad extractions from previous runs
  "barrhavendenture", "ludental", "sortedmedia", "bkdental", "greenapple",
  // Canadian neighbourhoods/cities used as email locals
  "verdun", "yaletown", "plateau", "fleetwood", "lougheed", "charolais",
  "burnaby", "surrey", "richmond", "langley", "coquitlam", "abbotsford",
  "kitchener", "fairway", "kitchenerfairway", "downtown", "uptown", "midtown",
  "westside", "eastside", "northside", "southside",
  // Generic business words extracted as names
  "hosted", "straighttalk", "toothwhisperer", "wellness", "family",
  "cosmetic", "emergency", "implant", "orthodont", "practice", "dentist",
]);

// Words that signal a practice name / location rather than a person
const PRACTICE_TOKENS = [
  "dental", "dentistry", "smile", "smiles", "clinic", "care", "health",
  "physio", "rehab", "medical", "ortho", "dds", "pdds", "bds",
  "toronto", "montreal", "vancouver", "calgary", "etobicoke", "mississauga",
  "scarborough", "brampton", "markham", "richmond", "eglinton", "bloor",
  "dundas", "west", "east", "north", "south", "downtown", "midtown",
  "uptown", "village", "centre", "center", "group", "associates",
];

function isGenericLocal(local) {
  const clean = local.toLowerCase().replace(/[.\-_+]/g, "");
  if (/\d/.test(clean)) return true;                    // has digits → initials/abbrev
  if (clean.length <= 3) return true;                   // too short → initials
  if (GENERIC_LOCAL.has(clean)) return true;            // exact match
  if (GENERIC_LOCAL.has(local.toLowerCase())) return true;
  for (const t of PRACTICE_TOKENS) {
    if (clean.startsWith(t) || clean.endsWith(t)) return true;
  }
  return false;
}

/**
 * Extracts a greeting name from an email address local part.
 * Returns a string like "Wendy" or "Dr. Anna", or null for generic addresses.
 * @param {string} email
 * @returns {string|null}
 */
export function extractGreetingName(email) {
  if (!email || typeof email !== "string") return null;
  const local = email.split("@")[0].toLowerCase();

  // Dr. prefix handling: dr.firstname or drfirstname
  if (local.startsWith("dr.") && local.length > 4) {
    const rest = local.slice(3);
    const first = rest.split(/[.\-_]/)[0];
    if (first.length >= 2 && /^[a-z]+$/.test(first)) {
      return "Dr. " + first.charAt(0).toUpperCase() + first.slice(1);
    }
    return null;
  }
  if (/^dr[a-z]{2,}$/.test(local)) {
    const rest = local.slice(2);
    if (!isGenericLocal(rest)) {
      return "Dr. " + rest.charAt(0).toUpperCase() + rest.slice(1);
    }
    return null;
  }

  // Generic check (strips punctuation for comparison)
  if (isGenericLocal(local)) return null;

  // dot-separated: take first component (e.g. "wendy.smith" → "Wendy")
  if (/^[a-z]+\.[a-z]+$/.test(local)) {
    const first = local.split(".")[0];
    if (first.length >= 3 && !isGenericLocal(first)) {
      return first.charAt(0).toUpperCase() + first.slice(1);
    }
  }

  // Simple single word, all letters, reasonable length
  // Reject long compound words that are likely clinic names not person names
  if (/^[a-z]{4,14}$/.test(local)) {
    // Additional heuristic: if local contains embedded practice tokens it's a clinic name
    const EMBEDDED = ["dental","denture","dentist","clinic","smile","health","care","ortho",
      "barrhaven","westend","downtown","eastside","northside","village","centre","center"];
    if (EMBEDDED.some(t => local.includes(t))) return null;
    return local.charAt(0).toUpperCase() + local.slice(1);
  }

  return null;
}

/**
 * Returns true if the email address appears to belong to a named person
 * (not a generic info@ / contact@ style address).
 * Used by sendBatch.js to prioritize named contacts in the send queue.
 * @param {string} email
 * @returns {boolean}
 */
export function isNamedEmail(email) {
  return extractGreetingName(email) !== null;
}

/**
 * URL-safe slug from a clinic name — used for UTM tracking.
 * @param {string} clinicName
 * @returns {string}
 */
export function clinicSlug(clinicName) {
  return (clinicName || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50);
}

// ─── Subject line ─────────────────────────────────────────────────────────────
// 7 subjects paired 1-to-1 with the 7 body variants below (A-G).
// Both functions use the same seed so subject and body always match.

/**
 * Returns a personalized subject line paired to the matching body variant.
 * @param {{ clinicName: string, city: string }} opts
 * @returns {string}
 */
export function personalizeSubject({ clinicName, city } = {}) {
  const name = (clinicName || "your clinic").replace(/\s+/g, " ").trim();
  const seed = hashStr(name + (city || ""));

  const cityRef = city || "your area";
  const subjects = [
    `Quick question for ${name}`.slice(0, 55),                                // A
    `Quick question for ${name}`.slice(0, 55),                               // B
    `Something I noticed about ${name}`.slice(0, 55),                        // C
    `What I've found in ${cityRef} dental clinics`.slice(0, 55),             // D
    `What ${name} might be leaving on the table`.slice(0, 55),               // E
    `Quick thought for ${name}`.slice(0, 55),                                // F
    `Unlike Jane App — ${name}`.slice(0, 55),                                // G
    `Noticed something about ${name}`.slice(0, 55),                          // H
    `${cityRef} dental clinics — what I'm seeing`.slice(0, 55),              // I
    `${name} — quick question`.slice(0, 55),                                  // J
    `6 patients recovered in 2 weeks — ${name}`.slice(0, 55),               // K
    `Something I noticed about ${cityRef} dental clinics`.slice(0, 55),     // L
    `Quick math for ${name}`.slice(0, 55),                                   // M
    `Quick question for ${name}`.slice(0, 55),                               // N
  ];

  return pick(subjects, seed);
}

// ─── Opening paragraph ────────────────────────────────────────────────────────

export function personalizeOpening({ clinicName, city, website } = {}) {
  const name = (clinicName || "your clinic").replace(/\s+/g, " ").trim();
  const loc  = city ? ` in ${city}` : "";
  const seed = hashStr(name + (city || ""));

  const openers = [
    `I came across ${name} while looking at dental practices${loc}.`,
    `I found ${name} when I was researching clinics${loc}.`,
    `I noticed ${name} while looking at dental offices${loc} online.`,
    `I was looking at practices${loc} and came across ${name}.`,
    `I spotted ${name} while going through local clinics${loc}.`,
  ];

  const painLines = [
    "Most clinics I talk to mention the same thing — new patient inquiries fall through the cracks, especially missed calls and web form submissions.",
    "A recurring theme I hear from clinic teams is that follow-up on missed calls and online inquiries is hard to keep consistent.",
    "One thing that keeps coming up is how hard it is to get Google reviews from happy patients, even when the care is excellent.",
    "Patient reactivation is something most clinics know they should do but rarely have the bandwidth to tackle.",
    "A lot of clinic teams I speak with are stretched thin, and inquiry follow-up ends up being reactive rather than systematic.",
  ];

  const bridges = [
    "That's actually what I've been building a fix for.",
    "I put together a lightweight system that handles this automatically.",
    "I've been helping a few clinics solve this with a simple automation.",
    "That's the problem I set out to solve with a small tool I built.",
  ];

  return `${pick(openers, seed)} ${pick(painLines, seed + 1)} ${pick(bridges, seed + 2)}`;
}

// ─── Email body ───────────────────────────────────────────────────────────────
// 6 variants paired 1-to-1 with the 6 subjects above.
// Both use pick(arr, seed) with the same seed — subject and body always match.

/**
 * Builds a personalized plain-text email body (< 150 words).
 * Free audit angle — no pricing, no links in body, ends with yes/no question.
 *
 * @param {Object} opts
 * @param {string} opts.clinicName
 * @param {string} opts.city
 * @param {string} [opts.website]
 * @param {string} [opts.email]             — used for smart greeting
 * @param {string} [opts.contactName]       — explicit contact name (overrides email-derived name)
 * @param {number} [opts.reviewPainScore]   — 0-5, from preContactResearch
 * @param {string[]} [opts.reviewPainQuotes] — up to 2 review snippets with pain signals
 * @param {string} [opts.senderName]
 * @param {string} [opts.senderEmail]
 * @param {string} [opts.trackingUrl]       — replaces bare domain in signature
 * @returns {{ subject: string, body: string, variantLabel: string }}
 */
export function buildPersonalizedBody({
  clinicName,
  city,
  website,
  email,
  contactName      = null,
  reviewPainScore  = 0,
  reviewPainQuotes = [],
  senderName       = "Mohamed",
  senderEmail      = "",
  trackingUrl      = null,
  bookingSoftware  = null,
  gmailMode        = false,
  aiOpener         = null,
} = {}) {
  const name    = cleanClinicName(clinicName);
  const cityRef = city || "your area";
  const seed    = hashStr(name + (city || ""));

  // Smart greeting — contactName field overrides, then email-derived name, then generic
  const greetName = contactName || extractGreetingName(email || "");
  const greeting  = greetName ? `Hi ${greetName},` : "Hi,";

  // Minimal signature — conversational tone, CASL-compliant + calculator PS
  const sign = gmailMode
    ? `${senderName}\n\nNot relevant? Just reply and let me know.\nClinicFlow Automation · Montreal, QC · Canada`
    : `${senderName}\n\nNot relevant? Just reply and let me know.\nClinicFlow Automation · Montreal, QC · Canada\n\nPS — see what unanswered calls are costing your practice: clinicflowautomation.com/calculator`;
  const shortSign = sign;

  // ── Review-based variant (takes priority when pain score ≥ 1 AND quote is usable) ──
  if (reviewPainScore >= 1) {
    const rawQuote = reviewPainQuotes?.[0];
    // Quality filter: only use the quote if it's a specific communication sentence,
    // not a general complaint or rating opener.
    const isGoodQuote = rawQuote &&
      rawQuote.length >= 20 &&
      !/^I (highly recommend|really recommend|would not recommend|give|gave|rate)/i.test(rawQuote);

    if (isGoodQuote) {
      return {
        subject: `One of your patients said something that caught my attention`,
        variantLabel: "R",
        body: `${greeting}

I was researching ${name} before reaching out and came across this review:

"${rawQuote}"

That specific complaint — patients not hearing back — is exactly what I help fix. I set up an automated system that texts patients within 60 seconds of a missed call, sends appointment reminders, and reactivates patients who haven't been in for a year.

Most clinics I work with recover 4–6 patients in the first month. Setup takes 5 days. No monthly fees.

Worth a 2-minute conversation?

${sign}`,
      };
    }
    // Bad quote — fall through to weighted variant selection below
  }

  // ── 14 variants A-N — conversational one-to-one style, under 60 words each ──
  const variants = [
    // Variant A
    `${greeting}

One thing I've noticed working with dental clinics in ${cityRef}: most have no system for what happens when a patient calls and no one picks up.

Quick question for ${name}: is there anything automated in place for that right now?

Happy to take a look — no obligation.

${sign}`,

    // Variant B
    `${greeting}

When a patient calls ${name} after hours or during a busy period and no one answers — what happens next?

I ask because I look at communication setups for dental clinics in ${cityRef} and that's usually where I find the most recoverable revenue.

Happy to take a look at your setup — no charge.

${sign}`,

    // Variant C
    `${greeting}

Every dental clinic in ${cityRef} I've looked at this month has the same gap: no system for callers who don't reach anyone. They call once, get voicemail, and book the next clinic on Google.

Reached out to ${name} specifically. Worth a conversation?

${sign}`,

    // Variant D
    `${greeting}

I looked at ${name}'s setup before sending this. One thing stood out: there's no automated response for patients who call and don't reach anyone. That's revenue leaving every day.

I help clinics in ${cityRef} set up a system for exactly this.

${sign}`,

    // Variant E
    `${greeting}

A dental clinic I work with in ${cityRef} had the same setup most clinics do — calls going to voicemail, no follow-up. In the first two weeks after we fixed it, they recovered 6 patients who would have booked elsewhere.

I set up the same system for ${name} in 5 days. Missed call follow-up, appointment reminders, reactivation for patients you haven't seen in 12+ months.

One-time setup. No monthly fees. You see it working before you pay the second half.

Worth a quick look?

${sign}`,

    // Variant F
    `${greeting}

The average dental clinic misses 3+ calls per day when the front desk is busy. Each one is a patient who calls the next clinic on Google instead.

I help dental clinics in ${cityRef} set up automated follow-up for exactly this. Happy to walk you through it.

${sign}`,

    // Variant G
    `${greeting}

Jane App handles scheduling. Weave handles phones. Neither does what I do: automatic SMS to every patient who calls ${name} and doesn't reach anyone — within 60 seconds, no staff involvement.

Happy to explain what it would look like for ${name}.

Unlike Jane App or Dentrix — there's no monthly fee, no training, and I handle everything. You just provide the patient list.

${sign}`,

    // Variant H
    `${greeting}

I checked ${name}'s setup before sending this. There's no automated response for patients who call and don't reach anyone. Every missed call is a patient who may not call back.

Happy to show you what that gap typically looks like. No obligation.

${sign}`,

    // Variant I
    `${greeting}

Going through ${cityRef} dental clinics this month, one gap shows up everywhere: no system for patients who call and don't reach anyone. They don't leave voicemails. They book elsewhere.

${name} was on my list — worth a look?

${sign}`,

    // Variant J
    `${greeting}

When a patient calls ${name} and no one picks up, they don't always leave a voicemail. Most of the time they call the next clinic on Google. Does ${name} have anything in place to stop that?

I help dental clinics in ${cityRef} set this up. Happy to explain how it works.

${sign}`,

    // Variant K
    `${greeting}

A clinic I worked with last month recovered 6 inactive patients in the first 2 weeks — just from automating their missed call follow-up.

Here's what that looks like at ${name}: a patient calls, nobody picks up, they get an automatic text within 60 seconds. Most of them book instead of calling the next clinic on Google.

5-day setup. Split payment — you pay the second half only after you see it running. No monthly fees.

Is this worth 2 minutes of your time?

${sign}`,

    // Variant L
    `${greeting}

I've been going through dental clinics in ${cityRef} this month. Every single one has the same gap: no system for when a patient calls and doesn't reach anyone. The patient leaves — or doesn't. ${name} was on my list.

Worth a conversation?

${sign}`,

    // Variant M
    `${greeting}

If ${name} misses 3 calls a day and converts even 1 of them into a booking, that's roughly $200 recovered. Per day. Most clinics I talk to aren't recovering any of them — the patient just calls the next clinic on Google.

I automate the follow-up so that doesn't happen. Patient calls, no answer, they get a text within 60 seconds.

Setup takes 5 days. No monthly fees. You pay the second half after you see it working.

Worth a look?

${sign}`,

    // Variant N
    `${greeting}

When a patient calls ${name} and the line is busy or no one answers — what happens to that patient?

Most clinics don't. The patient leaves a voicemail or doesn't, and there's no follow-up unless someone remembers to call back.

I fix that. Automatic text within 60 seconds of a missed call, appointment reminders, reactivation for patients inactive 12+ months. Done in 5 days, no monthly fees.

Reply if you want to see how it works for ${name}.

${sign}`,

    // Variant O — The Google problem
    `${greeting}

I was looking at ${name}'s Google reviews before reaching out. One pattern came up more than once:

When patients call and can't reach anyone, they don't always leave a voicemail. Sometimes they leave a Google review instead.

"Hard to reach" and "never called back" are among the most common complaints I see on dental clinic reviews across ${cityRef}.

I set up an automated follow-up system so every caller gets a response within 60 seconds — before frustration turns into a review.

5-day setup. No monthly fees. You see it working before paying the second half.

Worth a look?

${sign}`,

    // Variant P — The slow season play
    `${greeting}

May through August is typically slower for dental clinics — family travel, schedule changes, deferred appointments. The clinics that come out ahead are the ones reaching inactive patients before the slowdown hits.

I run a patient reactivation campaign for ${name}: automated outreach to every patient who hasn't booked in 12+ months. Most clinics bring back 10–20% of them within 30 days.

5-day setup. No monthly fees. Results before you pay the second half.

Interested in getting ahead of the summer?

${sign}`,

    // Variant Q — The front desk problem
    `${greeting}

Dental front desks handle phones, check-ins, insurance, scheduling, and patient questions — all at the same time.

Missing calls during busy periods isn't a failure. It's arithmetic.

What I do: when a patient calls ${name} and doesn't reach anyone, they get an automatic text within 60 seconds. It keeps them engaged, answers basic questions, and books them before they call the next clinic on Google.

Your front desk doesn't touch it. It runs in the background.

5-day setup. No monthly fees. You see it working before paying the second half.

Worth 2 minutes?

${sign}`,
  ];

  // Subject array — 17 entries, one per variant (A–Q)
  const subjects = [
    `${name} — how do you handle missed calls?`.slice(0, 55),                    // A
    `What happens when ${name} misses a call?`.slice(0, 55),                     // B
    `${cityRef} clinics are losing patients to this`.slice(0, 55),               // C
    `I looked at ${name}'s setup before reaching out`.slice(0, 55),              // D
    `A Toronto clinic recovered 6 patients in 2 weeks — ${name}`.slice(0, 55),   // E
    `${name} — 3 calls a day go unanswered`.slice(0, 55),                        // F
    `Unlike Jane App — ${name}`.slice(0, 55),                                    // G
    `${name} has no follow-up for missed calls`.slice(0, 55),                    // H
    `${cityRef} dental clinics — what I'm seeing`.slice(0, 55),                  // I
    `${name} — patients are calling and leaving`.slice(0, 55),                   // J
    `6 patients recovered in 2 weeks — ${name}`.slice(0, 55),                   // K
    `Every ${cityRef} clinic I've checked has this gap`.slice(0, 55),            // L
    `Quick math for ${name}`.slice(0, 55),                                       // M
    `${name} — missed calls`.slice(0, 55),                                       // N
    `${name} — your Google reviews`.slice(0, 55),                                // O
    `Quiet period coming — ${name}`.slice(0, 55),                                // P
    `Your front desk can't answer every call. Here's the fix.`.slice(0, 55),    // Q
  ];

  // Jane App users → always get Variant G (competitor differentiation)
  const usesJaneApp = (bookingSoftware || "").toLowerCase().includes("jane");
  if (usesJaneApp) {
    const gIdx = 6; // G is index 6
    return { subject: subjects[gIdx], body: variants[gIdx], variantLabel: "G" };
  }

  // Weighted variant selection — respects variant performance data
  const perf      = _readPerf();
  const allLabels = variants.map((_, i) => String.fromCharCode(65 + i));
  const weights   = allLabels.map(l => (perf[l]?.weight ?? 1.0));
  const totalW    = weights.reduce((s, w) => s + w, 0);
  const thresholds = [];
  let cumulative = 0;
  for (const w of weights) { cumulative += w; thresholds.push(cumulative); }
  const pick01  = (Math.abs(seed) % 10000) / 10000;
  const pickW   = pick01 * totalW;
  const rawIdx  = thresholds.findIndex(t => pickW < t);
  const safeIdx = rawIdx === -1 ? 0 : rawIdx;

  const variantLabel = String.fromCharCode(65 + safeIdx);
  const body         = variants[safeIdx];

  // Personalize subject with contactName when available (26% higher open rate)
  const rawSubject  = subjects[safeIdx];
  const subjName    = contactName || extractGreetingName(email || "");
  const subject     = subjName
    ? rawSubject.replace(
        new RegExp(`\\s+for\\s+${name.replace(/[.*+?^${}()|[\]\\]/g,"\\$&")}`, "i"),
        `, ${subjName}`
      )
    : rawSubject;

  // Inject AI-generated opener after greeting if provided
  const finalBody = aiOpener
    ? body.replace(greeting + '\n\n', greeting + '\n\n' + aiOpener + '\n\n')
    : body;

  return { subject, body: finalBody, variantLabel };
}

// ─── Variant performance tracking ─────────────────────────────────────────────
// data/variant-performance.json: { "A": { sends, replies, weight }, ... }

const PERF_PATH = path.resolve(__dirname, "../../data/variant-performance.json");

function _readPerf() {
  try {
    if (!fs.existsSync(PERF_PATH)) return {};
    return JSON.parse(fs.readFileSync(PERF_PATH, "utf-8"));
  } catch { return {}; }
}

function _writePerf(data) {
  fs.mkdirSync(path.dirname(PERF_PATH), { recursive: true });
  fs.writeFileSync(PERF_PATH, JSON.stringify(data, null, 2), "utf-8");
}

function _maybeUpdateWeight(perf, label) {
  const v = perf[label];
  if (!v || v.sends < 20) return;
  const oldWeight = v.weight ?? 1.0;
  const replyRate = v.replies / v.sends;
  const baseline  = 0.02; // 2% — weight 1.0
  v.weight = Math.max(0.1, Math.min(3.0, 1.0 + (replyRate - baseline) / baseline * 0.5));
  if (Math.abs(v.weight - oldWeight) > 0.05) {
    const dir = v.weight > oldWeight ? "▲" : "▼";
    console.log(`[variant-perf] ${label}: ${dir} weight ${oldWeight.toFixed(2)} → ${v.weight.toFixed(2)} (${(replyRate * 100).toFixed(1)}% reply rate, ${v.sends} sends)`);
  }
}

export function recordVariantSend(label) {
  if (!label) return;
  const perf = _readPerf();
  if (!perf[label]) perf[label] = { sends: 0, replies: 0, weight: 1.0 };
  perf[label].sends++;
  _maybeUpdateWeight(perf, label);
  _writePerf(perf);
}

export function recordVariantReply(label) {
  if (!label) return;
  const perf = _readPerf();
  if (!perf[label]) perf[label] = { sends: 0, replies: 0, weight: 1.0 };
  perf[label].replies++;
  _maybeUpdateWeight(perf, label);
  _writePerf(perf);
}

export function getVariantPerformance() {
  return _readPerf();
}

// ─── Reactivation variants (cooling_off → re-engage after 60 days) ────────────

export function buildReactivationBody({ clinicName, city, senderName = "Mohamed" }) {
  const name    = clinicName || "your clinic";
  const cityRef = city ? `in ${city}` : "";
  const sign    = `${senderName}\nClinicFlow Automation · Montreal, QC · Canada`;

  const idx = Math.floor(Math.random() * 3);

  if (idx === 0) {
    return {
      subject:      `${name} — still losing patients to missed calls?`.slice(0, 60),
      body:         `Hi,\n\nReached out a couple months ago. The problem I mentioned — patients calling and not reaching anyone — doesn't go away on its own.\n\nTiming may be better now — happy to take a fresh look if useful.\n\n${sign}`,
      variantLabel: "REACT1",
    };
  }
  if (idx === 1) {
    return {
      subject:      `${name} — what a missed call actually costs`.slice(0, 60),
      body:         `Hi,\n\nBuilt a calculator showing exactly what missed calls cost dental clinics ${cityRef}.\n\nThe number is usually surprising.\n\nclinicflowautomation.com/calculator — takes 30 seconds.\n\n${sign}`,
      variantLabel: "REACT2",
    };
  }
  return {
    subject:      `Last note — ${name}`.slice(0, 60),
    body:         `Hi,\n\nOne last email on this. If missed calls aren't a priority right now, no problem at all.\n\nI look at communication gaps for dental clinics — takes 10 minutes, no obligation.\n\n${sign}`,
    variantLabel: "REACT3",
  };
}
