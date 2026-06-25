// netlify/functions/call-outcome.js
// Records call outcomes from the call assistant and alerts Mohamed via SMS when interested.
// POST body: { clinicName, status, timestamp }
// Statuses: interested | not-interested | no-answer | wants-email

import twilio from "twilio";

const ACCOUNT_SID  = process.env.TWILIO_ACCOUNT_SID;
const AUTH_TOKEN   = process.env.TWILIO_AUTH_TOKEN;
const FROM_NUMBER  = process.env.TWILIO_FROM_NUMBER;
const MOHAMED_PHONE = process.env.OWNER_PHONE || "+15149617077";

export const handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  let body;
  try {
    body = JSON.parse(event.body || "{}");
  } catch {
    return { statusCode: 400, body: "Invalid JSON" };
  }

  const { clinicName, status, timestamp } = body;
  if (!clinicName || !status) {
    return { statusCode: 400, body: "Missing clinicName or status" };
  }

  console.log(`[call-outcome] ${status} — ${clinicName} @ ${timestamp}`);

  // Send SMS alert for interested leads
  if (status === "interested" && ACCOUNT_SID && AUTH_TOKEN && FROM_NUMBER) {
    try {
      const client = twilio(ACCOUNT_SID, AUTH_TOKEN);
      await client.messages.create({
        to:   MOHAMED_PHONE,
        from: FROM_NUMBER,
        body: `🔥 CALL LEAD: "${clinicName}" is INTERESTED — follow up NOW with proposal + calendar link`,
      });
      console.log(`[call-outcome] SMS alert sent to ${MOHAMED_PHONE}`);
    } catch (err) {
      console.error(`[call-outcome] SMS failed: ${err.message}`);
    }
  }

  return {
    statusCode: 200,
    headers: { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" },
    body: JSON.stringify({ ok: true, status, clinicName }),
  };
};
