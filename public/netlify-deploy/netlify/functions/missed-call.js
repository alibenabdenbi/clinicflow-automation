// netlify/functions/missed-call.js
// Public Twilio webhook for clinic missed-call follow-up.
// URL: clinicflowautomation.com/.netlify/functions/missed-call?clinic=SLUG
//
// Twilio fires this when a forwarded call goes unanswered.
// Returns TwiML immediately; fires follow-up SMS in-process.

const ACCOUNT_SID  = process.env.TWILIO_ACCOUNT_SID;
const AUTH_TOKEN   = process.env.TWILIO_AUTH_TOKEN;
const FROM_NUMBER  = process.env.TWILIO_FROM_NUMBER;
const BRAND        = "ClinicFlow Automation";

// Per-clinic config — add new paying clients here.
// Each key is the clinicSlug passed via ?clinic=SLUG
const CLINIC_CONFIG = {
  "test-clinic": {
    clinicName:  "Test Dental Clinic",
    clinicPhone: "+15145618268",
    twilioFrom:  process.env.TWILIO_FROM_NUMBER,
    isFree:      false,
  },
  // Add real clinics as:
  // "greenwoods-pediatric": {
  //   clinicName: "Greenwoods Pediatric Dentistry",
  //   clinicPhone: "+15141234567",
  //   twilioFrom: process.env.TWILIO_CLINIC_1_FROM || process.env.TWILIO_FROM_NUMBER,
  //   isFree: false,
  // },
};

async function sendTwilioSMS(to, from, body) {
  const creds = Buffer.from(`${ACCOUNT_SID}:${AUTH_TOKEN}`).toString("base64");
  const res = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${ACCOUNT_SID}/Messages.json`,
    {
      method:  "POST",
      headers: {
        "Content-Type":  "application/x-www-form-urlencoded",
        Authorization:   `Basic ${creds}`,
      },
      body: new URLSearchParams({ From: from, To: to, Body: body }).toString(),
    }
  );
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Twilio SMS error ${res.status}: ${text.slice(0, 200)}`);
  }
  return res.json();
}

function buildSmsBody(clinic, isFree) {
  const name  = clinic?.clinicName || "the clinic";
  const phone = clinic?.clinicPhone || "";
  if (isFree) {
    return `Hi! You called ${name}. We missed your call but will get back to you shortly.${phone ? ` Call us back at ${phone}.` : ""} — Powered by ${BRAND}`;
  }
  return `Hi! You called ${name}. We missed your call — we'll follow up with you within 2 hours. Reply here to book an appointment or ask a question. — ${name}`;
}

function buildTwiML(clinicName) {
  const safe = (clinicName || "the clinic").replace(/[<>&"]/g, "");
  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="alice">Thank you for calling ${safe}. We missed your call but will be in touch shortly. Goodbye.</Say>
  <Hangup/>
</Response>`;
}

exports.handler = async (event) => {
  try {
    const params       = new URLSearchParams(event.body || "");
    const queryParams  = event.queryStringParameters || {};
    const clinicSlug   = (queryParams.clinic || "").trim().toLowerCase();
    const callerNumber = (params.get("From") || params.get("Caller") || "").trim();
    const callSid      = (params.get("CallSid") || "").trim();

    console.log(JSON.stringify({ event: "missed_call", clinicSlug, callerNumber, callSid }));

    const clinic = CLINIC_CONFIG[clinicSlug] || null;
    const twiml  = buildTwiML(clinic?.clinicName);

    // Return TwiML immediately
    const twimlResponse = {
      statusCode: 200,
      headers:    { "Content-Type": "text/xml" },
      body:       twiml,
    };

    if (!clinic) {
      console.warn(`[missed-call] Unknown clinic slug: ${clinicSlug}`);
      return twimlResponse;
    }

    if (!callerNumber) {
      console.warn(`[missed-call] No caller number in request`);
      return twimlResponse;
    }

    // Fire SMS (in-process — Netlify functions are synchronous so we await before returning,
    // but TwiML response must still be fast; keep this path < 3s)
    try {
      const from = clinic.twilioFrom || FROM_NUMBER;
      const body = buildSmsBody(clinic, clinic.isFree);
      await sendTwilioSMS(callerNumber, from, body);
      console.log(`[missed-call] ✓ SMS sent to ${callerNumber} for ${clinicSlug}`);
    } catch (smsErr) {
      console.error(`[missed-call] SMS failed: ${smsErr.message}`);
    }

    return twimlResponse;
  } catch (err) {
    console.error(`[missed-call] Fatal: ${err.message}`);
    return {
      statusCode: 200,
      headers:    { "Content-Type": "text/xml" },
      body:       `<?xml version="1.0" encoding="UTF-8"?><Response><Hangup/></Response>`,
    };
  }
};
