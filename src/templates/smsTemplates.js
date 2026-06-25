// src/templates/smsTemplates.js
// Outreach SMS templates for no-website dental clinic cold outreach.
//
// Rules:
//   - No URLs        — carrier spam filters flag cold SMS with links
//   - Under 160 chars — single SMS segment, reads naturally on any phone
//   - Sign "— Mohamed" — personal, not corporate
//   - STOP only in template 1 — CASL compliant, minimal spam signal
//
// Template 1 → initial cold send
// Template 2 → follow-up, day 3
// Template 3 → final, day 7+

/**
 * Template 1 — initial cold outreach.
 * Includes "Txt STOP to end" for CASL compliance.
 * @param {string} city — e.g. "Montreal" or "your area"
 * @returns {string}
 */
export function smsTemplate1(city = "your area") {
  return `Hi — noticed your clinic isn't showing up when patients search online in ${city}. Is that something you'd want to fix? — Mohamed\nTxt STOP to end`;
}

/**
 * Template 2 — day-3 follow-up.
 * No STOP line — recipient already received it in template 1.
 * @returns {string}
 */
export function smsTemplate2() {
  return `Following up on my note — we help dental clinics get found online in about 5 days. Worth a quick text back? — Mohamed`;
}

/**
 * Template 3 — final close-out message.
 * No STOP line.
 * @returns {string}
 */
export function smsTemplate3() {
  return `Last message from me — if getting found online ever becomes a priority, happy to help. — Mohamed, ClinicFlow`;
}
