// src/api/setupComplete.js
// Express endpoint: POST /api/setup-complete
// Called by setup-guide.html when client marks the final step complete.
// Sends a notification email to Mohamed and logs setupCompletedAt in clients.json.

import fs from "fs";
import path from "path";
import nodemailer from "nodemailer";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const CLIENTS_PATH = path.join(ROOT, "data", "clients.json");

const NOTIFY_EMAIL = "m.aliben432@gmail.com";

function readJsonSafe(p, fb) {
  try { return JSON.parse(fs.readFileSync(p, "utf-8")) ?? fb; } catch { return fb; }
}
function writeJsonSafe(p, d) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(d, null, 2), "utf-8");
}

async function sendNotification(clinicName, completedAt) {
  const host = (process.env.SMTP_HOST || "").trim();
  const port = Number(process.env.SMTP_PORT || "587");
  const user = (process.env.SMTP_USER || "").trim();
  const pass = (process.env.SMTP_PASS || "").trim();
  const from = process.env.SMTP_FROM || user;

  if (!host || !user || !pass) return; // silently skip if SMTP not configured

  const transporter = nodemailer.createTransport({
    host, port, secure: port === 465,
    auth: { user, pass },
    tls: { rejectUnauthorized: false },
  });

  const ts = new Date(completedAt).toLocaleString("en-CA", {
    timeZone: "America/Toronto",
    dateStyle: "medium",
    timeStyle: "short",
  });

  await transporter.sendMail({
    from,
    to: NOTIFY_EMAIL,
    subject: `Setup complete: ${clinicName} finished onboarding`,
    text: `Setup complete: ${clinicName} finished their onboarding at ${ts} (Toronto time).\n\nTime to send the day-7 check-in in your calendar.\n\nThis message was sent automatically by ClinicFlow.`,
  });
}

/**
 * Register the setup-complete route on an Express app.
 * @param {import('express').Application} app
 */
export function registerSetupCompleteRoute(app) {
  app.post("/api/setup-complete", async (req, res) => {
    const { clinicName, completedAt } = req.body || {};

    if (!clinicName) {
      return res.status(400).json({ error: "clinicName is required" });
    }

    const ts = completedAt || new Date().toISOString();

    // Update clients.json
    try {
      const clients = readJsonSafe(CLIENTS_PATH, []);
      const match = clients.find(
        (c) => c.name.toLowerCase().trim() === clinicName.toLowerCase().trim()
      );
      if (match) {
        match.setupCompletedAt = ts;
        writeJsonSafe(CLIENTS_PATH, clients);
      } else {
        // Unknown clinic — still log it
        console.log(`[setup-complete] Unknown clinic: "${clinicName}" — not in clients.json`);
      }
    } catch (err) {
      console.error("[setup-complete] clients.json update failed:", err.message);
    }

    // Send notification email (non-blocking)
    sendNotification(clinicName, ts).catch((err) => {
      console.error("[setup-complete] notification email failed:", err.message);
    });

    res.json({ ok: true, clinicName, completedAt: ts });
  });
}
