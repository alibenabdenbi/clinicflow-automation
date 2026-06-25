import fs from "fs";
import path from "path";

const TESTIMONIALS_PATH = path.join(process.cwd(), "data", "testimonials.json");
const NPS_PATH          = path.join(process.cwd(), "data", "nps-scores.json");
const NOTIFY_PHONE      = "+15149617077";
const TWILIO_SID        = process.env.TWILIO_ACCOUNT_SID;
const TWILIO_TOKEN      = process.env.TWILIO_AUTH_TOKEN;
const TWILIO_FROM       = process.env.TWILIO_PHONE_NUMBER;
const SMTP_HOST         = process.env.SMTP_HOST;
const SMTP_USER         = (process.env.SMTP_USER || "").trim();
const SMTP_PASS         = process.env.SMTP_PASS;
const SMTP_FROM         = (process.env.SMTP_FROM || SMTP_USER).trim();

async function sendSMS(to, body) {
  if (!TWILIO_SID || !TWILIO_TOKEN || !TWILIO_FROM) return;
  await fetch(`https://api.twilio.com/2010-04-01/Accounts/${TWILIO_SID}/Messages.json`, {
    method: "POST",
    headers: {
      Authorization: "Basic " + Buffer.from(`${TWILIO_SID}:${TWILIO_TOKEN}`).toString("base64"),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: `From=${encodeURIComponent(TWILIO_FROM)}&To=${encodeURIComponent(to)}&Body=${encodeURIComponent(body)}`,
  });
}

export const handler = async (event) => {
  if (event.httpMethod !== "POST") return { statusCode: 405, body: "Method Not Allowed" };

  let body;
  try { body = JSON.parse(event.body || "{}"); } catch { return { statusCode: 400, body: "Bad JSON" }; }

  const { clinicName, city, contactName, problem, rating, email } = body;
  if (!clinicName || !problem) {
    return { statusCode: 400, body: JSON.stringify({ error: "clinicName and problem required" }) };
  }

  const record = {
    clinicName,
    city:        city || "",
    contactName: contactName || "",
    problem,
    rating:      Number(rating) || 5,
    email:       email || "",
    submittedAt: new Date().toISOString(),
    approved:    false,
  };

  // Save testimonial
  try {
    const existing = fs.existsSync(TESTIMONIALS_PATH) ? JSON.parse(fs.readFileSync(TESTIMONIALS_PATH, "utf-8")) : [];
    existing.push(record);
    fs.mkdirSync(path.dirname(TESTIMONIALS_PATH), { recursive: true });
    fs.writeFileSync(TESTIMONIALS_PATH, JSON.stringify(existing, null, 2));
  } catch (e) { console.error("Save failed:", e.message); }

  // SMS to operator
  try {
    const stars = "★".repeat(Number(rating) || 5);
    await sendSMS(NOTIFY_PHONE, `New testimonial ${stars} from ${clinicName}${city ? ` (${city})` : ""}: "${problem.slice(0, 120)}"`);
  } catch (e) { console.error("SMS failed:", e.message); }

  // Thank-you email to clinic
  if (email && SMTP_HOST && SMTP_USER && SMTP_PASS) {
    try {
      const { default: nodemailer } = await import("nodemailer");
      const t = nodemailer.createTransport({ host: SMTP_HOST, port: 465, secure: true, auth: { user: SMTP_USER, pass: SMTP_PASS } });
      await t.sendMail({
        from: SMTP_FROM,
        to: email,
        subject: `Thank you for your feedback — ${clinicName}`,
        text: `Hi ${contactName || "there"},\n\nThank you for sharing your experience with ClinicFlow. Your feedback means a lot and helps other clinics decide if we're the right fit for them.\n\nIf you ever need anything or want to share your results with another clinic owner, we're always here.\n\nMohamed\nClinicFlow Automation\ncontact@clinicflowautomation.com`,
      });
    } catch (e) { console.error("Email failed:", e.message); }
  }

  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ok: true, message: "Thank you for your testimonial!" }),
  };
};
