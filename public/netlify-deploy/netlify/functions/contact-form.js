// netlify/functions/contact-form.js
// Handles website contact form submissions.
// Sends SMS alert to operator + confirmation email to lead.

import https from "https";
import querystring from "querystring";
import nodemailer from "nodemailer";

const TWILIO_SID   = process.env.TWILIO_ACCOUNT_SID  || "";
const TWILIO_TOKEN = process.env.TWILIO_AUTH_TOKEN    || "";
const TWILIO_FROM  = process.env.TWILIO_FROM_NUMBER   || "";
const NOTIFY_PHONE = process.env.NOTIFY_PHONE         || "+15149617077";
const SMTP_HOST    = process.env.SMTP_HOST            || "smtp.gmail.com";
const SMTP_PORT    = Number(process.env.SMTP_PORT     || "587");
const SMTP_USER    = process.env.SMTP_USER            || "";
const SMTP_PASS    = process.env.SMTP_PASS            || "";
const SMTP_FROM_ADDR = process.env.SMTP_FROM          || SMTP_USER;

function twilioSms(body) {
  return new Promise((resolve) => {
    if (!TWILIO_SID || !TWILIO_TOKEN) { resolve(false); return; }
    const auth     = Buffer.from(`${TWILIO_SID}:${TWILIO_TOKEN}`).toString("base64");
    const postData = querystring.stringify({ From: TWILIO_FROM, To: NOTIFY_PHONE, Body: body });
    const req = https.request({
      hostname: "api.twilio.com",
      path: `/2010-04-01/Accounts/${TWILIO_SID}/Messages.json`,
      method: "POST",
      headers: { "Authorization": `Basic ${auth}`, "Content-Type": "application/x-www-form-urlencoded", "Content-Length": Buffer.byteLength(postData) },
    }, (res) => { resolve(res.statusCode < 300); });
    req.on("error", () => resolve(false));
    req.write(postData);
    req.end();
  });
}

async function sendEmail({ to, subject, text }) {
  if (!SMTP_USER || !SMTP_PASS) return false;
  try {
    const t = nodemailer.createTransport({ host: SMTP_HOST, port: SMTP_PORT, secure: false, auth: { user: SMTP_USER, pass: SMTP_PASS } });
    await t.sendMail({ from: `Mohamed <${SMTP_FROM_ADDR}>`, to, subject, text });
    return true;
  } catch { return false; }
}

export const handler = async (event) => {
  if (event.httpMethod !== "POST") return { statusCode: 405, body: "Method not allowed" };

  let data;
  try { data = JSON.parse(event.body || "{}"); } catch { return { statusCode: 400, body: "Bad request" }; }

  const { clinicName, city, email, pkg, message } = data;
  if (!clinicName || !email) return { statusCode: 400, body: JSON.stringify({ error: "Missing required fields" }) };

  const smsBody = `Website lead: ${clinicName}${city ? " in " + city : ""} — ${email}${pkg ? " | " + pkg : ""}${message ? " | " + message.slice(0, 80) : ""}`;

  twilioSms(smsBody).catch(() => {});

  const confirmText = `Hi,

Thanks for reaching out about ClinicFlow Automation.

I'll review your message and be in touch within one business day.

Mohamed
ClinicFlow Automation
438-544-0442
contact@clinicflowautomation.com`;

  sendEmail({ to: email, subject: "Got your message — ClinicFlow", text: confirmText }).catch(() => {});
  sendEmail({ to: SMTP_USER, subject: `Website lead: ${clinicName}`, text: smsBody }).catch(() => {});

  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ok: true }),
  };
};
