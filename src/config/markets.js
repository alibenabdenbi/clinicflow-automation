// src/config/markets.js
// Market definitions for multi-vertical outreach expansion.
// Each market defines OSM query tags, email copy variants, and pain signals.
//
// Usage in localBusinesses.js: node localBusinesses.js "Toronto" "ON" --market physio
// Usage in sendBatch.js: automatically uses market copy when lead.market is set

export const MARKETS = {

  // ── Dental (default — always existed) ────────────────────────────────────────
  dental: {
    label: "Dental Clinic",
    osmTags: [
      { key: "amenity", values: ["dentist", "orthodontist", "endodontist", "periodontist"] },
      { key: "healthcare", values: ["dentist", "orthodontist"] },
      { key: "office",     values: ["dentist"] },
    ],
    websiteTags: ["website", "contact:website", "url"],
    outreach: {
      painPoint: "missed calls and patient recall",
      offerLine: "missed call auto-text, appointment reminders, and recall campaigns",
      subjectVariants: [
        (name) => `Quick question for ${name}`.slice(0, 50),
        (name) => `${name} — a small idea`.slice(0, 50),
        (name) => `Had a thought about ${name}`.slice(0, 50),
        (name) => `Question about ${name}`.slice(0, 50),
      ],
      bodyOpeners: [
        (name, city) => `I came across ${name} while looking at dental practices${city ? ` in ${city}` : ""}.`,
        (name, city) => `I found ${name} when I was researching clinics${city ? ` in ${city}` : ""}.`,
        (name, city) => `I noticed ${name} while looking at dental offices${city ? ` in ${city}` : ""} online.`,
      ],
    },
  },

  // ── Physiotherapy ─────────────────────────────────────────────────────────────
  physio: {
    label: "Physiotherapy Clinic",
    osmTags: [
      { key: "healthcare",         values: ["physiotherapist", "physiotherapy"] },
      { key: "amenity",            values: ["physiotherapist"] },
      { key: "healthcare:speciality", values: ["physiotherapy", "physical_therapy"] },
    ],
    websiteTags: ["website", "contact:website", "url"],
    outreach: {
      painPoint: "new patient follow-up and appointment no-shows",
      offerLine: "missed inquiry auto-reply, appointment reminders, and patient reactivation",
      subjectVariants: [
        (name) => `Quick question for ${name}`.slice(0, 50),
        (name) => `${name} — a small idea`.slice(0, 50),
        (name) => `Question about ${name}`.slice(0, 50),
        (name, city) => `${city ? city + " — " : ""}quick question`.slice(0, 50),
      ],
      bodyOpeners: [
        (name, city) => `I came across ${name} while looking at physiotherapy clinics${city ? ` in ${city}` : ""}.`,
        (name, city) => `I found ${name} when researching rehab and physio practices${city ? ` in ${city}` : ""}.`,
        (name, city) => `I noticed ${name} while going through local physio clinics${city ? ` in ${city}` : ""}.`,
      ],
      painLines: [
        "A common challenge I hear from physio teams is that new patient inquiries — especially after hours — don't always get followed up before the patient books somewhere else.",
        "One thing that keeps coming up with clinic managers is how hard it is to stay on top of discharge follow-ups and recall reminders when the schedule is full.",
        "Patient reactivation — reaching out to clients who haven't been in for 3–6 months — is something most physio clinics want to do but rarely have time for.",
        "A lot of front desks I speak with are managing reminders manually, which leads to inconsistent confirmation rates and higher no-shows.",
      ],
    },
  },

  // ── Law Firm / Legal ──────────────────────────────────────────────────────────
  legal: {
    label: "Law Firm",
    osmTags: [
      { key: "office", values: ["lawyer", "law_firm", "notary"] },
      { key: "amenity", values: ["lawyer"] },
    ],
    websiteTags: ["website", "contact:website", "url"],
    outreach: {
      painPoint: "new client inquiry follow-up and consultation scheduling",
      offerLine: "inquiry auto-response, consultation reminder sequences, and client reactivation",
      subjectVariants: [
        (name) => `Quick question for ${name}`.slice(0, 50),
        (name) => `${name} — a quick idea`.slice(0, 50),
        (name) => `Had a thought about ${name}`.slice(0, 50),
        (name, city) => `${city ? city + " — " : ""}quick question`.slice(0, 50),
      ],
      bodyOpeners: [
        (name, city) => `I came across ${name} while researching law firms${city ? ` in ${city}` : ""}.`,
        (name, city) => `I found ${name} when looking at legal practices${city ? ` in ${city}` : ""}.`,
        (name, city) => `I noticed ${name} while going through local firms${city ? ` in ${city}` : ""}.`,
      ],
      painLines: [
        "A recurring issue I hear from firm administrators is that potential client inquiries — especially web form submissions and after-hours calls — often don't get a response within the window when the person is still actively looking.",
        "One thing that comes up often is consultation no-shows: someone books a first meeting, then life happens, and without a reminder sequence the seat goes empty.",
        "Client reactivation is something most smaller firms know they should do — reaching back out to past clients for wills, real estate, or corporate updates — but rarely have a system for.",
        "A lot of front offices I speak with are managing consultation reminders manually via calendar notes, which means they depend entirely on staff remembering.",
      ],
    },
  },

  // ── Real Estate / Brokerage ───────────────────────────────────────────────────
  realestate: {
    label: "Real Estate Brokerage",
    osmTags: [
      { key: "office", values: ["real_estate", "real_estate_agent", "estate_agent"] },
      { key: "amenity", values: ["real_estate_agent"] },
    ],
    websiteTags: ["website", "contact:website", "url"],
    outreach: {
      painPoint: "lead follow-up speed and client nurture",
      offerLine: "instant lead auto-response, showing reminders, and past-client reactivation",
      subjectVariants: [
        (name) => `Quick question for ${name}`.slice(0, 50),
        (name) => `${name} — a small idea`.slice(0, 50),
        (name) => `Had a thought about ${name}`.slice(0, 50),
        (name, city) => `${city ? city + " — " : ""}quick thought`.slice(0, 50),
      ],
      bodyOpeners: [
        (name, city) => `I came across ${name} while looking at brokerages${city ? ` in ${city}` : ""}.`,
        (name, city) => `I found ${name} when researching real estate offices${city ? ` in ${city}` : ""}.`,
        (name, city) => `I noticed ${name} while going through local brokerages${city ? ` in ${city}` : ""}.`,
      ],
      painLines: [
        "One thing that keeps coming up with agents and team leads is speed-to-lead: web inquiries that don't get a response within 5 minutes have a much lower conversion rate, and it's hard to maintain that pace manually.",
        "A recurring challenge I hear is past-client reactivation — keeping in touch with buyers and sellers who transacted 1–2 years ago and could refer or transact again, but aren't being nurtured.",
        "Showing reminders and pre-appointment confirmations are something most teams handle manually, which creates inconsistency and no-shows that waste everyone's time.",
        "A lot of agents I speak with are generating leads from multiple sources but don't have a consistent follow-up system beyond the first call.",
      ],
    },
  },
};

/**
 * Get a market config by key (case-insensitive). Defaults to dental.
 * @param {string} key
 * @returns {object}
 */
export function getMarket(key = "dental") {
  const k = (key || "dental").toLowerCase().trim();
  return MARKETS[k] || MARKETS.dental;
}

/**
 * List all available market keys.
 * @returns {string[]}
 */
export function listMarkets() {
  return Object.keys(MARKETS);
}
