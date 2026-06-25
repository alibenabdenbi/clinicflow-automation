import fs from "fs";
import path from "path";

const PARTNERS_PATH = path.join(process.cwd(), "data", "referral-partners.json");
const NOTIFY_PHONE  = "+15149617077";
const TWILIO_SID    = process.env.TWILIO_ACCOUNT_SID;
const TWILIO_TOKEN  = process.env.TWILIO_AUTH_TOKEN;
const TWILIO_FROM   = process.env.TWILIO_PHONE_NUMBER;

export const handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  let body;
  try {
    body = JSON.parse(event.body || "{}");
  } catch {
    return { statusCode: 400, body: "Bad JSON" };
  }

  const { name, email, company, clinicsPerWeek } = body;
  if (!name || !email) {
    return { statusCode: 400, body: JSON.stringify({ error: "name and email required" }) };
  }

  const record = {
    name,
    email,
    company:       company || "",
    clinicsPerWeek: clinicsPerWeek || "",
    registeredAt:  new Date().toISOString(),
  };

  // Persist to file
  try {
    const existing = fs.existsSync(PARTNERS_PATH)
      ? JSON.parse(fs.readFileSync(PARTNERS_PATH, "utf-8"))
      : [];
    existing.push(record);
    fs.mkdirSync(path.dirname(PARTNERS_PATH), { recursive: true });
    fs.writeFileSync(PARTNERS_PATH, JSON.stringify(existing, null, 2));
  } catch (e) {
    console.error("Save failed:", e.message);
  }

  // SMS alert to operator
  if (TWILIO_SID && TWILIO_TOKEN && TWILIO_FROM) {
    try {
      const smsBody = `New referral partner: ${name} from ${company || "unknown"} (${email}) — ${clinicsPerWeek || "?"} clinics/wk`;
      await fetch(`https://api.twilio.com/2010-04-01/Accounts/${TWILIO_SID}/Messages.json`, {
        method: "POST",
        headers: {
          Authorization: "Basic " + Buffer.from(`${TWILIO_SID}:${TWILIO_TOKEN}`).toString("base64"),
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: `From=${encodeURIComponent(TWILIO_FROM)}&To=${encodeURIComponent(NOTIFY_PHONE)}&Body=${encodeURIComponent(smsBody)}`,
      });
    } catch (e) {
      console.error("SMS alert failed:", e.message);
    }
  }

  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ok: true, message: "Registration received — we'll be in touch within 24 hours." }),
  };
};
