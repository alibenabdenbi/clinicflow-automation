// src/services/smsService.js
// Twilio SMS wrapper for ClinicFlow automation.
// Handles missed-call auto-text, appointment reminders, and recall messages.
//
// Usage (standalone test):
//   node src/services/smsService.js --test +1XXXXXXXXXX
//   node src/services/smsService.js --test +15149617077

import twilio from "twilio";
import dotenv from "dotenv";
import { pathToFileURL } from "url";

dotenv.config();

const ACCOUNT_SID  = (process.env.TWILIO_ACCOUNT_SID  || "").trim();
const AUTH_TOKEN   = (process.env.TWILIO_AUTH_TOKEN    || "").trim();
const FROM_NUMBER  = (process.env.TWILIO_FROM_NUMBER   || "").trim();

// ─── Client (lazy-initialised) ────────────────────────────────────────────────

let _client = null;
function getClient() {
  if (!_client) {
    if (!ACCOUNT_SID || !AUTH_TOKEN) {
      throw new Error("TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN must be set in .env");
    }
    _client = twilio(ACCOUNT_SID, AUTH_TOKEN);
  }
  return _client;
}

// ─── Core send function ───────────────────────────────────────────────────────

/**
 * Send an SMS via Twilio.
 * @param {string} to      — E.164 phone number e.g. "+15149617077"
 * @param {string} body    — Message text (max 1600 chars; >160 sends as multi-part)
 * @param {string} [from]  — Override from number (defaults to TWILIO_FROM_NUMBER)
 * @returns {Promise<{ sid, to, from, status, body, sent: true }>}
 */
export async function sendSMS(to, body, from = FROM_NUMBER) {
  if (!from) throw new Error("TWILIO_FROM_NUMBER not set in .env");
  if (!to)   throw new Error("sendSMS: 'to' number is required");
  if (!body) throw new Error("sendSMS: 'body' is required");

  const client = getClient();
  const message = await client.messages.create({ to, from, body });

  return {
    sent:   true,
    sid:    message.sid,
    to:     message.to,
    from:   message.from,
    status: message.status,
    body:   message.body,
  };
}

// ─── Landline lookup ─────────────────────────────────────────────────────────

/**
 * Check whether a phone number is a landline using Twilio Lookup V2.
 * Costs ~$0.005 per call. Returns one of:
 *   "mobile" | "landline" | "voip" | "fixedVoip" | "nonFixedVoip" | "unknown"
 *
 * If the lookup fails (network error, invalid creds) returns "unknown" so the
 * caller can decide to send anyway rather than silently dropping the lead.
 *
 * @param {string} phone — E.164 format e.g. "+15141234567"
 * @returns {Promise<string>} line type string
 */
export async function lookupLineType(phone) {
  if (!phone) return "unknown";
  try {
    const client = getClient();
    const result = await client.lookups.v2.phoneNumbers(phone)
      .fetch({ fields: "line_type_intelligence" });
    return result.lineTypeIntelligence?.type || "unknown";
  } catch (err) {
    // Don't throw — caller logs the warning and decides what to do.
    console.warn(`[lookup] ${phone}: ${err.message}`);
    return "unknown";
  }
}

// ─── Connection / credentials check ──────────────────────────────────────────

/**
 * Verify Twilio credentials by fetching account info.
 * Throws if credentials are invalid.
 * @returns {Promise<{ accountSid, friendlyName, status }>}
 */
export async function verifyTwilioConnection() {
  if (!ACCOUNT_SID || !AUTH_TOKEN) {
    throw new Error("TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN must be set in .env");
  }
  const client  = getClient();
  const account = await client.api.accounts(ACCOUNT_SID).fetch();
  return {
    accountSid:   account.sid,
    friendlyName: account.friendlyName,
    status:       account.status,
  };
}

// ─── Entry point (standalone test) ───────────────────────────────────────────

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const toIdx = process.argv.indexOf("--test");
  const testTo = toIdx !== -1 ? process.argv[toIdx + 1] : null;

  (async () => {
    console.log("── Twilio SMS Service ─────────────────────────────────");
    console.log(`Account SID : ${ACCOUNT_SID ? ACCOUNT_SID.slice(0, 8) + "…" : "NOT SET"}`);
    console.log(`Auth Token  : ${AUTH_TOKEN  ? "***" + AUTH_TOKEN.slice(-4) : "NOT SET"}`);
    console.log(`From number : ${FROM_NUMBER || "NOT SET"}`);
    console.log("");

    // Step 1: verify credentials
    process.stdout.write("Verifying Twilio credentials… ");
    try {
      const acct = await verifyTwilioConnection();
      console.log(`✅ Connected`);
      console.log(`  Account    : ${acct.friendlyName}`);
      console.log(`  SID        : ${acct.accountSid}`);
      console.log(`  Status     : ${acct.status}`);
    } catch (err) {
      console.log(`❌ Failed`);
      console.error(`  Error: ${err.message}`);
      process.exit(1);
    }

    // Step 2: send test SMS if --test flag provided
    if (testTo) {
      console.log("");
      const ts = new Date().toISOString();
      const body = `ClinicFlow SMS test — system working correctly. Sent at ${ts}`;
      process.stdout.write(`Sending test SMS to ${testTo}… `);
      try {
        const result = await sendSMS(testTo, body);
        console.log(`✅ Sent`);
        console.log(`  SID    : ${result.sid}`);
        console.log(`  To     : ${result.to}`);
        console.log(`  From   : ${result.from}`);
        console.log(`  Status : ${result.status}`);
        console.log(`  Body   : ${result.body}`);
      } catch (err) {
        console.log(`❌ Failed`);
        console.error(`  Error: ${err.message}`);
        if (err.code) console.error(`  Twilio error code: ${err.code}`);
        process.exit(1);
      }
    } else {
      console.log("");
      console.log("ℹ  No --test flag supplied — skipping SMS send.");
      console.log("   To send a test: node src/services/smsService.js --test +1XXXXXXXXXX");
    }

    console.log("\n── SMS service check complete ─────────────────────────");
  })();
}
