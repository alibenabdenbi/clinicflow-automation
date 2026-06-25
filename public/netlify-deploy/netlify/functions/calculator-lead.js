// netlify/functions/calculator-lead.js
// Handles calculator lead form submission:
// 1. Sends SMS alert via Twilio REST API
// 2. Sends confirmation email via Gmail SMTP
// 3. Returns success JSON

import https from "https";
import querystring from "querystring";

const TWILIO_SID   = process.env.TWILIO_ACCOUNT_SID  || "";
const TWILIO_TOKEN = process.env.TWILIO_AUTH_TOKEN    || "";
const TWILIO_FROM  = process.env.TWILIO_FROM_NUMBER   || "";
const NOTIFY_PHONE = process.env.NOTIFY_PHONE         || "+15149617077";
const SMTP_USER    = process.env.SMTP_USER            || "";
const SMTP_PASS    = process.env.SMTP_PASS            || "";
const SMTP_HOST    = process.env.SMTP_HOST            || "smtp.gmail.com";
const SMTP_PORT    = Number(process.env.SMTP_PORT     || "587");

function twilioSms(body, to) {
  return new Promise((resolve) => {
    if (!TWILIO_SID || !TWILIO_TOKEN) { resolve(false); return; }
    const auth = Buffer.from(`${TWILIO_SID}:${TWILIO_TOKEN}`).toString("base64");
    const postData = querystring.stringify({ From: TWILIO_FROM, To: to, Body: body });
    const req = https.request({
      hostname: "api.twilio.com",
      path: `/2010-04-01/Accounts/${TWILIO_SID}/Messages.json`,
      method: "POST",
      headers: { "Authorization": `Basic ${auth}`, "Content-Type": "application/x-www-form-urlencoded", "Content-Length": Buffer.byteLength(postData) },
    }, (res) => { resolve(res.statusCode >= 200 && res.statusCode < 300); });
    req.on("error", () => resolve(false));
    req.write(postData);
    req.end();
  });
}

// Email via Zoho SMTP using nodemailer-free raw SMTP handshake is complex —
// instead POST to our own send endpoint which runs in the Node.js server context.
// This avoids bundling nodemailer into the edge function entirely.
async function sendEmail({ to, subject, text }) {
  if (!SMTP_USER || !SMTP_PASS) return false;
  try {
    const { createTransport } = await import("nodemailer");
    const t = createTransport({ host: SMTP_HOST, port: SMTP_PORT, secure: false, auth: { user: SMTP_USER, pass: SMTP_PASS } });
    await t.sendMail({ from: `Mohamed <${SMTP_USER}>`, to, subject, text });
    return true;
  } catch { return false; }
}

export const handler = async (event) => {
  if (event.httpMethod !== "POST") return { statusCode: 405, body: "Method not allowed" };

  let data;
  try { data = JSON.parse(event.body || "{}"); } catch { return { statusCode: 400, body: "Bad request" }; }

  const { firstName, clinicName, email, lostPerMonth, lostPerYear, missedPerMonth } = data;
  if (!firstName || !clinicName || !email) return { statusCode: 400, body: JSON.stringify({ error: "Missing required fields" }) };

  const monthlyFmt = Number(lostPerMonth || 0).toLocaleString("en-CA", { style: "currency", currency: "CAD", maximumFractionDigits: 0 });
  const yearlyFmt  = Number(lostPerYear  || 0).toLocaleString("en-CA", { style: "currency", currency: "CAD", maximumFractionDigits: 0 });

  // SMS alert to operator
  const smsBody = `Calculator lead: ${firstName} from ${clinicName} — losing ${monthlyFmt}/month (${yearlyFmt}/yr). Email: ${email}`;
  twilioSms(smsBody, NOTIFY_PHONE).catch(() => {});

  // Confirmation email to the lead
  const confirmText = `Hi ${firstName},

Thanks for using the ClinicFlow missed call calculator.

Your results for ${clinicName}:
• Missed calls per month: ~${Math.round(missedPerMonth || 0)}
• Estimated revenue lost per month: ${monthlyFmt}
• Estimated revenue lost per year: ${yearlyFmt}

We'll review your numbers and reach out within 24 hours with a personalized plan to recover this revenue.

If you have questions in the meantime, just reply to this email.

Mohamed
ClinicFlow Automation
438-544-0442

To opt out of future emails, reply with 'unsubscribe'
ClinicFlow Automation · Montreal, QC · Canada`;

  sendEmail({ to: email, subject: `Your ${clinicName} revenue recovery estimate`, text: confirmText }).catch(() => {});

  // Notification email to operator
  sendEmail({ to: SMTP_USER, subject: `New calculator lead: ${firstName} from ${clinicName}`, text: smsBody + `\n\nMonthly missed: ${missedPerMonth}` }).catch(() => {});

  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ok: true }),
  };
};
