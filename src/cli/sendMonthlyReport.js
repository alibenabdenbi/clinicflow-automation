// src/cli/sendMonthlyReport.js
// Sends personalized monthly results check-in emails to all active clients.
// Runs on the first Monday of each month (scheduled in scheduler.js).
//
// Usage:
//   node src/cli/sendMonthlyReport.js            # send to all active clients
//   node src/cli/sendMonthlyReport.js --dry-run  # preview without sending

import fs from "fs";
import path from "path";
import nodemailer from "nodemailer";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import { buildMonthlyReportEmail } from "../services/deliveryEngine.js";

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const CLIENTS_PATH = path.join(ROOT, "data", "clients.json");

const DRY_RUN = process.argv.includes("--dry-run");

function readJsonSafe(p, fb) {
  try { return JSON.parse(fs.readFileSync(p, "utf-8")) ?? fb; } catch { return fb; }
}
function writeJsonSafe(p, d) {
  fs.writeFileSync(p, JSON.stringify(d, null, 2), "utf-8");
}

function thisMonthKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

async function createTransport() {
  const host = (process.env.SMTP_HOST || "").trim();
  const port = Number(process.env.SMTP_PORT || "587");
  const user = (process.env.SMTP_USER || "").trim();
  const pass = (process.env.SMTP_PASS || "").trim();
  if (!host || !user || !pass) throw new Error("SMTP not configured in .env");
  return nodemailer.createTransport({
    host, port, secure: port === 465,
    auth: { user, pass },
    tls: { rejectUnauthorized: false },
  });
}

async function main() {
  const clients = readJsonSafe(CLIENTS_PATH, []);
  const monthKey = thisMonthKey();
  const reportKey = `monthlyReport_${monthKey}_sent`;

  const eligible = clients.filter((c) => {
    if (!c.delivered || c.status !== "active") return false;
    if (c[reportKey]) return false;
    return true;
  });

  console.log(`\n── Monthly Report — ${monthKey} ────────────────────────`);
  console.log(`Eligible clients: ${eligible.length}${DRY_RUN ? "  (DRY RUN)" : ""}`);
  if (!eligible.length) { console.log("Nothing to send — all clients already received this month's report."); return; }

  let transport;
  if (!DRY_RUN) transport = await createTransport();
  const from = process.env.SMTP_FROM || process.env.SMTP_USER;

  let sent = 0;
  for (const client of eligible) {
    const mail = buildMonthlyReportEmail(client);
    if (DRY_RUN) {
      console.log(`\n[DRY RUN] → ${client.email} (${client.name}, ${client.tier})`);
      console.log(`Subject: ${mail.subject}`);
      console.log(`Body preview:\n${mail.body.slice(0, 300)}…`);
      sent++;
      continue;
    }
    process.stdout.write(`Sending to ${client.email} (${client.name})… `);
    try {
      await transport.sendMail({ from, to: mail.to, subject: mail.subject, text: mail.body });
      client[reportKey] = new Date().toISOString();
      console.log("✅");
      sent++;
    } catch (err) {
      console.log(`❌ ${err.message}`);
    }
  }

  if (!DRY_RUN) writeJsonSafe(CLIENTS_PATH, clients);

  console.log(`\nSent: ${sent}/${eligible.length}`);
  console.log(`${"─".repeat(52)}\n`);
}

main().catch((err) => { console.error("sendMonthlyReport failed:", err.message); process.exit(1); });
