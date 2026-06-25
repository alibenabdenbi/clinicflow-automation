// src/tests/testEmail.js
// Sends a single test email to verify SMTP is configured correctly.
// Run with: npm run test:email

import dotenv from "dotenv";
import nodemailer from "nodemailer";

dotenv.config();

const TO = "m.aliben432@gmail.com";

const HOST = (process.env.SMTP_HOST || "").trim();
const PORT = Number(process.env.SMTP_PORT || "0");
const USER = (process.env.SMTP_USER || "").trim();
const PASS = (process.env.SMTP_PASS || "").trim();
const FROM = (process.env.SMTP_FROM || USER).trim();
const SECURE = (process.env.SMTP_SECURE || "").toLowerCase() === "true" || PORT === 465;
const TLS_REJECT = (process.env.SMTP_TLS_REJECT_UNAUTHORIZED || "true").toLowerCase() !== "false";

if (!HOST || !PORT || !USER || !PASS) {
  console.error("❌ SMTP not configured — check .env (SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS)");
  process.exit(1);
}

console.log("SMTP config:");
console.log(`  Host:   ${HOST}`);
console.log(`  Port:   ${PORT}`);
console.log(`  Secure: ${SECURE}`);
console.log(`  User:   ${USER}`);
console.log(`  From:   ${FROM}`);
console.log(`  To:     ${TO}`);
console.log("");

const transporter = nodemailer.createTransport({
  host: HOST,
  port: PORT,
  secure: SECURE,
  auth: { user: USER, pass: PASS },
  tls: { rejectUnauthorized: false },
});

console.log("Verifying SMTP connection...");

try {
  await transporter.verify();
  console.log("✅ SMTP connection verified\n");
} catch (err) {
  console.error("❌ SMTP verify failed:", err.message);
  process.exit(1);
}

const timestamp = new Date().toISOString();
const subject = "ORE Engine — SMTP Test";
const text = `SMTP is working correctly. Sent at ${timestamp}`;

console.log(`Sending test email to ${TO}...`);

try {
  const info = await transporter.sendMail({ from: FROM, to: TO, subject, text });
  console.log("✅ Email sent successfully");
  console.log(`   Message ID: ${info.messageId}`);
  console.log(`   Response:   ${info.response}`);
} catch (err) {
  console.error("❌ Failed to send email:", err.message);
  process.exit(1);
}
