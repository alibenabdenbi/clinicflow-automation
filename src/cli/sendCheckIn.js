// src/cli/sendCheckIn.js
// Sends day-7 (or custom) check-in emails to clients who completed setup N days ago.
//
// Usage:
//   node src/cli/sendCheckIn.js --day 7     # find clients delivered 7+ days ago, no day-7 checkin sent
//   node src/cli/sendCheckIn.js --dry-run   # preview without sending

import fs from "fs";
import path from "path";
import nodemailer from "nodemailer";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import { buildDay7CheckIn } from "../services/deliveryEngine.js";

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT      = path.resolve(__dirname, "../..");
const CLIENTS_PATH = path.join(ROOT, "data", "clients.json");

const args = process.argv.slice(2);
const DAY_NUM = Number(args[args.indexOf("--day") + 1] || 7);
const DRY_RUN = args.includes("--dry-run");

const CLIENT_LOG_PATH = path.join(ROOT, "data", "client.sends.json");

function readJsonSafe(p, fb) {
  try { return JSON.parse(fs.readFileSync(p, "utf-8")) ?? fb; } catch { return fb; }
}
function writeJsonSafe(p, d) {
  fs.writeFileSync(p, JSON.stringify(d, null, 2), "utf-8");
}
function appendClientLog(entry) {
  const log = readJsonSafe(CLIENT_LOG_PATH, []);
  log.push({ ...entry, loggedAt: new Date().toISOString() });
  writeJsonSafe(CLIENT_LOG_PATH, log);
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
  const now = Date.now();
  const thresholdMs = DAY_NUM * 24 * 60 * 60 * 1000;
  const checkInKey = `checkin_day${DAY_NUM}_sent`;

  const due = clients.filter((c) => {
    if (!c.delivered || !c.deliveredAt) return false;
    if (c[checkInKey]) return false;
    if (c.status !== "active") return false;
    const deliveredMs = Date.parse(c.deliveredAt);
    return Number.isFinite(deliveredMs) && now >= deliveredMs + thresholdMs;
  });

  console.log(`\n── Day-${DAY_NUM} Check-In ──────────────────────────────`);
  console.log(`Clients due: ${due.length}${DRY_RUN ? "  (DRY RUN)" : ""}`);
  if (!due.length) { console.log("Nothing to send."); return; }

  let transport;
  if (!DRY_RUN) transport = await createTransport();
  const from = process.env.SMTP_FROM || process.env.SMTP_USER;

  let sent = 0;
  for (const client of due) {
    const mail = buildDay7CheckIn(client);
    if (DRY_RUN) {
      console.log(`\n[DRY RUN] Would send to: ${client.email} (${client.name})`);
      console.log(`Subject: ${mail.subject}`);
      console.log(`Body preview: ${mail.body.slice(0, 120)}…`);
      sent++;
      continue;
    }
    // Guard: never send to test@ or placeholder addresses
    if (/^test@/i.test(client.email)) {
      console.log(`⊘ Skipped ${client.name} — test@ address (${client.email})`);
      continue;
    }

    process.stdout.write(`Sending to ${client.email} (${client.name})… `);
    try {
      await transport.sendMail({ from, to: mail.to, subject: mail.subject, text: mail.body });
      client[checkInKey] = new Date().toISOString();
      // Audit log
      appendClientLog({ type: `checkin_day${DAY_NUM}`, client: client.name, email: client.email, subject: mail.subject, sentAt: client[checkInKey] });
      console.log("✅ sent");
      sent++;
    } catch (err) {
      console.log(`❌ ${err.message}`);
    }
  }

  if (!DRY_RUN) writeJsonSafe(CLIENTS_PATH, clients);

  console.log(`\nSent: ${sent}/${due.length}`);
  console.log(`${"─".repeat(52)}\n`);
}

main().catch((err) => { console.error("sendCheckIn failed:", err.message); process.exit(1); });
