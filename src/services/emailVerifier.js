// src/services/emailVerifier.js
// Verifies an email address is real before we attempt to send.
// Checks: format, unmonitored local parts, disposable domains, MX records.

import { promises as dns } from "dns";

// Well-known disposable / throwaway email domains
const DISPOSABLE_DOMAINS = new Set([
  "mailinator.com", "guerrillamail.com", "tempmail.com", "throwam.com",
  "sharklasers.com", "guerrillamailblock.com", "grr.la", "guerrillamail.info",
  "spam4.me", "trashmail.me", "dispostable.com", "maildrop.cc", "yopmail.com",
  "yopmail.fr", "fakeinbox.com", "mailnull.com", "10minutemail.com",
  "10minutemail.net", "throwaway.email", "getnada.com", "tempail.com",
  "trashmail.com", "trashmail.net", "trashmail.io", "spamgourmet.com",
]);

// Local parts that indicate an unmonitored system mailbox — replies go nowhere
const BAD_LOCAL_PARTS = [
  "noreply", "no-reply", "donotreply", "do-not-reply",
  "bounce", "bounces", "postmaster", "mailer-daemon",
  "daemon", "abuse", "spam",
];

// Cache MX results for the same domain within a run to avoid duplicate DNS lookups
const mxCache = new Map();

/**
 * Verifies an email address.
 * @param {string} email
 * @returns {Promise<{valid: boolean, reason: string}>}
 */
export async function verifyEmail(email) {
  const e = String(email || "").trim().toLowerCase();

  // 1. Format check
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e)) {
    return { valid: false, reason: "invalid format" };
  }

  const atIdx = e.lastIndexOf("@");
  const local = e.slice(0, atIdx);
  const domain = e.slice(atIdx + 1);

  // 2. Unmonitored local part
  if (BAD_LOCAL_PARTS.some((b) => local.includes(b))) {
    return { valid: false, reason: `unmonitored mailbox (${local})` };
  }

  // 3. Disposable domain
  if (DISPOSABLE_DOMAINS.has(domain)) {
    return { valid: false, reason: "disposable email domain" };
  }

  // 4. MX record check (with cache)
  if (mxCache.has(domain)) {
    const cached = mxCache.get(domain);
    return cached;
  }

  try {
    const records = await dns.resolveMx(domain);
    const result =
      records && records.length > 0
        ? { valid: true, reason: "ok" }
        : { valid: false, reason: "no MX records for domain" };

    mxCache.set(domain, result);
    return result;
  } catch (err) {
    const code = err?.code || "";
    let result;

    if (code === "ENOTFOUND" || code === "ENODATA" || code === "ESERVFAIL") {
      result = { valid: false, reason: `domain unreachable (${code})` };
    } else {
      // Network timeout or transient error — give benefit of the doubt
      result = { valid: true, reason: "mx_check_skipped (network error)" };
    }

    mxCache.set(domain, result);
    return result;
  }
}

/**
 * Batch-verifies an array of emails and returns only the valid ones.
 * @param {string[]} emails
 * @returns {Promise<string[]>}
 */
export async function filterValidEmails(emails) {
  const results = await Promise.all(
    (emails || []).map(async (email) => {
      const { valid } = await verifyEmail(email);
      return valid ? email : null;
    })
  );
  return results.filter(Boolean);
}
