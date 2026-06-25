// src/voicemail/voicemailScripts.js
// Three voicemail script variants, each under 25 seconds when spoken (~125 wpm).
// Usage: choose script based on outreach stage (see SCRIPT_SELECTOR).

export const SCRIPT_1 = ({ city = "your area", clinicName = "your clinic" } = {}) =>
  `Hi, this is Mohamed calling from ClinicFlow — I help dental clinics in ${city} recover missed call revenue. I do free audits and found something specific to your area worth sharing. Please call me back at 438-544-0442 or reply to an email from contact@clinicflowautomation.com. Thanks.`;

export const SCRIPT_2 = ({ city = "your area", clinicName } = {}) =>
  `Hi, quick message for whoever handles ${clinicName ? `${clinicName}'s` : "your"} patient communication. I do free missed call audits for dental clinics — takes me 10 minutes and costs nothing. Found some interesting data for ${city} practices. Happy to share — 438-544-0442.`;

export const SCRIPT_3 = ({ clinicName = "your clinic" } = {}) =>
  `Hi, I sent you an email last week about a free missed call audit for ${clinicName}. Just wanted to follow up personally — 438-544-0442. No obligation, just have something useful to share.`;

// Returns the right script number based on the clinic's outreach stage
// script 1 = first contact, script 2 = no reply after first email, script 3 = after FU1+
export function selectScript(lead) {
  const count = Number(lead.followupCount ?? 0);
  if (count === 0 && lead.status === "todo") return 1;
  if (count === 0) return 2;
  return 3;
}

// Fill and return a script with clinic data
export function buildScript(scriptNum, { clinicName, city }) {
  const opts = { clinicName: clinicName || "your clinic", city: city || "your area" };
  if (scriptNum === 1) return SCRIPT_1(opts);
  if (scriptNum === 2) return SCRIPT_2(opts);
  if (scriptNum === 3) return SCRIPT_3(opts);
  return SCRIPT_1(opts);
}

// Estimate spoken duration in seconds (125 words per minute)
export function estimateDuration(script) {
  const words = script.split(/\s+/).length;
  return Math.round((words / 125) * 60);
}

// Validate all scripts are under 25 seconds
export function validateScripts() {
  const examples = [
    buildScript(1, { clinicName: "Smile Dental", city: "Toronto" }),
    buildScript(2, { clinicName: "Smile Dental", city: "Toronto" }),
    buildScript(3, { clinicName: "Smile Dental", city: "Toronto" }),
  ];
  return examples.map((s, i) => ({
    script: i + 1,
    duration: estimateDuration(s),
    valid: estimateDuration(s) <= 25,
    text: s,
  }));
}
