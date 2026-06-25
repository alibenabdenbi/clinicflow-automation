// src/processors/templatePack.js

function clean(s = "") {
  return String(s).replace(/\s+/g, " ").trim();
}

function pickTone(tone = "friendly") {
  const t = String(tone || "").toLowerCase();
  if (t.includes("formal")) return "formal";
  return "friendly";
}

export function buildTemplatePack(clinic = {}) {
  const name = clean(clinic.clinicName || "your clinic");
  const tone = pickTone(clinic.tone);

  const greeting = tone === "formal" ? `Hello ${name} team,` : `Hi ${name} team,`;
  const signoff = tone === "formal" ? "Sincerely," : "Best,";
  const brand = `Mohamed\nClinicFlow Automation`;

  const bookingLine = clean(clinic.bookingLink)
    ? `Booking link: ${clean(clinic.bookingLink)}`
    : `If you share your booking link, I’ll include it in every message.`;

  const intakeLine = (() => {
    const forms = !!clinic.modules?.forms;
    const missed = !!clinic.modules?.missedCalls;
    const reviews = !!clinic.modules?.reviews;

    const parts = [];
    if (forms) parts.push("forms");
    if (missed) parts.push("missed calls");
    if (reviews) parts.push("reviews");

    return parts.length ? parts.join(" + ") : "forms / missed calls";
  })();

  // “Async only” conversion: no call ask, clear next step, short & human.
  return {
    outreach: {
      subject: `${name} — quick question`,
      text: `${greeting}

Quick question — who handles new patient inquiry follow-ups at ${name}?

I install a simple follow-up engine for ${intakeLine} so more inquiries turn into booked appointments:
• instant confirmation (under 60 seconds)
• a short follow-up sequence (day 1 / day 3)
• optional review requests after visits (24h + 72h)

If you’re open to it, I can send a one-page plan based on your website — tailored and concrete.

Should I send it?

${signoff}
${brand}`,
    },

    asyncReplyIfInterested: {
      subject: `Re: ${name} — perfect (we can do this async)`,
      text: `${greeting}

Perfect — we can do this fully async (no call needed).

Reply with ONE letter and I’ll tailor the exact setup + messages to match your intake:
A) Website forms
B) Missed calls
C) Both + review requests

Optional (helps me tailor fast): send your booking link.

${signoff}
${brand}`,
    },

    followupDay1: {
      subject: `Re: ${name} — quick follow-up`,
      text: `${greeting}

Quick follow-up — want me to send the one-page plan?

Reply A / B / C:
A) Forms
B) Missed calls
C) Both + reviews

${signoff}
${brand}`,
    },

    followupDay3: {
      subject: `Re: ${name} — should I close this?`,
      text: `${greeting}

Last note from me — if this isn’t a priority right now, no worries.

If you want the one-page plan, reply A / B / C:
A) Forms
B) Missed calls
C) Both + reviews

${signoff}
${brand}`,
    },
  };
}