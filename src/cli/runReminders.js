// src/cli/runReminders.js
// Reads all active clients with a calendarId and sends appointment SMS reminders.
// Safe to run multiple times daily — deduplicates via reminders-sent.json log.
//
// Usage:  npm run reminders:run
// Scheduled: daily at 8:30am via scheduler.js

import fs from "fs";
import path from "path";
import dotenv from "dotenv";
import { runRemindersForClinic } from "../services/calendarService.js";

dotenv.config();

const CLIENTS_PATH = path.join(process.cwd(), "data", "clients.json");

function readJsonSafe(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, "utf-8"));
  } catch { return fallback; }
}

async function main() {
  const clients = readJsonSafe(CLIENTS_PATH, []);
  const active  = clients.filter(c => c.calendarId && c.status !== "churned");

  console.log(`[${new Date().toISOString()}] Appointment reminders — ${active.length} calendar(s) to check\n`);

  if (active.length === 0) {
    console.log("No clients with a calendarId configured. Run: npm run calendar:setup");
    return;
  }

  let totalSent    = 0;
  let totalSkipped = 0;
  let totalErrors  = 0;

  for (const client of active) {
    const name = client.clinicName || client.email || "unknown";
    console.log(`Checking: ${name} (${client.calendarId})`);
    try {
      const result = await runRemindersForClinic({
        clinicName:  name,
        calendarId:  client.calendarId,
        clinicPhone: client.clinicPhone || "",
      });
      console.log(`  Events: ${result.eventsChecked} | Sent: ${result.sent} | Skipped (no phone): ${result.skipped}`);
      if (result.errors.length) {
        result.errors.forEach(e => console.warn(`  ⚠ ${e}`));
      }
      totalSent    += result.sent;
      totalSkipped += result.skipped;
      totalErrors  += result.errors.length;
    } catch (e) {
      console.error(`  ✗ Failed for ${name}: ${e.message}`);
      totalErrors++;
    }
  }

  console.log(`\nDone. Sent: ${totalSent} | Skipped: ${totalSkipped} | Errors: ${totalErrors}`);
}

main().catch(e => {
  console.error("runReminders failed:", e.message);
  process.exit(1);
});
