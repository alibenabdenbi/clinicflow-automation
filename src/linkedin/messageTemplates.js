// src/linkedin/messageTemplates.js
// LinkedIn outreach message templates for dental clinic owners/dentists.

export const CONNECTION_REQUEST = (name, clinicName) =>
  `Hi ${name}, I help dental clinics recover missed call revenue with a quick automation. Would love to connect and share what I've found — no pitch, just a useful insight for ${clinicName}.`;

export const FOLLOW_UP_AFTER_CONNECT = (name, clinicName) =>
  `Thanks for connecting ${name}. Quick question — when a patient calls ${clinicName} and no one answers, what usually happens? I ask because I do free missed call audits and have an insight specific to your area. Worth 2 minutes?`;

// Fill template — replaces [Name] and [ClinicName] placeholders
export function fill(template, { name = "there", clinicName = "your clinic" } = {}) {
  return template
    .replace(/\[Name\]/g, name)
    .replace(/\[ClinicName\]/g, clinicName);
}

// Validate connection request is within 300-char LinkedIn limit
export function validateConnectionRequest(msg) {
  return { valid: msg.length <= 300, length: msg.length, limit: 300 };
}
