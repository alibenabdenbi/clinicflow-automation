// src/processors/localDentistOutreach.js
import fs from "fs";
import path from "path";
import { findBestEmailOnWebsite, findContactPageUrl, findEmailsForWebsite } from "./emailFinder.js";
import { extractGreetingName } from "../services/emailPersonalizer.js";

function domainFromUrl(url) {
  try {
    const u = new URL(url);
    return u.hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function titleFromDomain(domain) {
  if (!domain) return "your clinic";
  const base = domain.split(".")[0] || domain;
  const cleaned = base.replace(/[-_]/g, " ").trim();
  return cleaned
    .split(" ")
    .filter(Boolean)
    .map((w) => w[0]?.toUpperCase() + w.slice(1))
    .join(" ");
}

function buildSubject({ clinicName = "your clinic" } = {}) {
  return `Quick question for ${clinicName}`;
}

function buildEmailBody({ clinicName = "your clinic", website = "", email = "" } = {}) {
  const greetName = extractGreetingName(email || "");
  const greeting  = greetName ? `Hi ${greetName},` : "Hi,";
  return `${greeting}

I'm reaching out because I'm building a small "clinic growth + follow-up" automation for dental clinics in Canada.

It helps with:
• new patient inquiry follow-ups (so fewer leads drop)
• review requests automation (Google reviews)
• missed-call / form submission auto-reply
• simple reactivation messages for inactive patients

If you want, I can generate a free 1-page plan tailored to your clinic based on your website (${website}).

Should I send it?

Thanks,
Mohamed
contact@clinicflowautomation.com`;
}

function buildContactFormMessage({ clinicName = "your clinic", website = "" } = {}) {
  return `Hi,

I'm building a simple automation for dental clinics in Canada that improves:
• inquiry follow-ups
• review requests (Google reviews)
• missed-call/form auto-reply
• reactivation messages

If you want, I can generate a free 1-page plan tailored to your clinic based on your website (${website}).

Reply "Yes" and I'll send it.

— Mohamed
contact@clinicflowautomation.com`;
}

function guessEmailsFromDomain(domain) {
  if (!domain) return [];
  const bases = [
    "contact",
    "info",
    "hello",
    "office",
    "clinic",
    "reception",
    "appointments",
    "booking",
    "admin",
    "support",
  ];
  return bases.map((b) => `${b}@${domain}`);
}

/**
 * Input: scoredLocal businesses from data/local.businesses.json
 * Output:
 * - data/local.dentists.leads.csv
 * - data/outreach.localDentists.json
 */
export async function enrichLocalDentistsAndWriteFiles({
  businesses = [],
  maxDentists = 30,
  outCsvPath = path.join("data", "local.dentists.leads.csv"),
  outJsonPath = path.join("data", "outreach.localDentists.json"),
} = {}) {
  const dentists = (businesses || [])
    .filter(Boolean)
    .filter((b) => b.website) // must have a site
    .sort((a, b) => (b.score || 0) - (a.score || 0))
    .slice(0, maxDentists);

  // Load existing queue — never overwrite sent/replied records
  let existingOutreach = [];
  try {
    if (fs.existsSync(outJsonPath)) {
      existingOutreach = JSON.parse(fs.readFileSync(outJsonPath, "utf-8"));
      if (!Array.isArray(existingOutreach)) existingOutreach = [];
    }
  } catch { existingOutreach = []; }

  const existingWebsites = new Set(
    existingOutreach.map((r) => (r.website || "").toLowerCase().replace(/\/+$/, "")).filter(Boolean)
  );

  // Collect only the newly enriched records — keep existing records separate so
  // we can re-read the file fresh just before writing (preventing a race condition
  // where sendBatch.js updates statuses during the hours-long enrichment loop and
  // this function then overwrites those changes with the stale snapshot from above).
  const newRecords = [];

  let added = 0;
  for (const d of dentists) {
    const website = d.website || "";
    const websiteKey = website.toLowerCase().replace(/\/+$/, "");
    if (existingWebsites.has(websiteKey)) continue; // already in queue
    const domain = domainFromUrl(website);

    let email = d.email || null;
    let contactPage = null;

    // Collect any emails we can find (for the "chips" in your panel)
    let foundEmails = [];
    if (website) {
      try {
        foundEmails = await findEmailsForWebsite(website, { maxPages: 2 });
      } catch {
        foundEmails = [];
      }
    }

    // Best email (priority-based)
    if (!email && website) {
      try {
        email = await findBestEmailOnWebsite(website);
      } catch {
        email = null;
      }
    }

    // Contact page
    if (website) {
      try {
        contactPage = await findContactPageUrl(website);
      } catch {
        contactPage = null;
      }
    }

    const clinicName = d.name || titleFromDomain(domain) || "your clinic";

    // Decide method
    const method = email ? "email" : contactPage ? "contact_form" : "manual";

    // Suggested emails for manual mode (your panel can show them as quick buttons)
    const guessedEmails = guessEmailsFromDomain(domain);

    newRecords.push({
      clinicName,
      website,
      domain,
      city: d.city || null,
      province: d.province || null,
      score: d.score ?? null,
      tier: d.tier || null,

      // enrichment
      email,
      emailConfidence: email ? "high" : "none", // confirmed by scraper → high; no email → none
      contactPage,
      foundEmails,
      guessedEmails,

      // workflow fields for the panel
      status: "todo", // todo | sent | replied | skip
      method, // email | contact_form | manual

      // copy/paste payload
      subject: buildSubject({ clinicName }),
      message:
        method === "email"
          ? buildEmailBody({ clinicName, website, email })
          : method === "contact_form"
          ? buildContactFormMessage({ clinicName, website })
          : buildEmailBody({ clinicName, website, email }), // even manual gets a ready message

      notes:
        method === "manual"
          ? "No email/contact page detected automatically. Open website and find the best email, then paste it in the panel."
          : "",
    });
    existingWebsites.add(websiteKey);
    added++;
  }

  // Re-read the file fresh before writing — sendBatch.js may have updated statuses
  // (sent, bounced, already_equipped, etc.) while enrichment was running above.
  // Using the fresh version as the base preserves those concurrent changes.
  let latestExisting = existingOutreach;
  try {
    if (fs.existsSync(outJsonPath)) {
      const parsed = JSON.parse(fs.readFileSync(outJsonPath, "utf-8"));
      if (Array.isArray(parsed)) latestExisting = parsed;
    }
  } catch { /* keep existingOutreach if re-read fails */ }

  // Only append records that are genuinely new (not present in the freshly-read file)
  const latestWebsites = new Set(
    latestExisting.map((r) => (r.website || "").toLowerCase().replace(/\/+$/, "")).filter(Boolean)
  );
  const trulyNew = newRecords.filter(
    r => !latestWebsites.has((r.website || "").toLowerCase().replace(/\/+$/, ""))
  );
  const outreach = [...latestExisting, ...trulyNew];

  console.log(`  Outreach merge: ${added} new record(s) added. Total queue: ${outreach.length}`);

  // Write JSON
  fs.mkdirSync(path.dirname(outJsonPath), { recursive: true });
  fs.writeFileSync(outJsonPath, JSON.stringify(outreach, null, 2), "utf-8");

  // Write CSV (simple)
  const header = [
    "clinicName",
    "website",
    "city",
    "province",
    "score",
    "tier",
    "email",
    "contactPage",
    "method",
    "status",
    "subject",
  ];

  const rows = outreach.map((o) =>
    header
      .map((k) => {
        const v = o[k] ?? "";
        const s = String(v).replace(/"/g, '""');
        return `"${s}"`;
      })
      .join(",")
  );

  fs.mkdirSync(path.dirname(outCsvPath), { recursive: true });
  fs.writeFileSync(outCsvPath, [header.join(","), ...rows].join("\n"), "utf-8");

  const outreachReady = outreach.filter((o) => o.method === "email" || o.method === "contact_form");

  return {
    dentistsEnriched: outreach.length,
    outreachReady: outreachReady.length,
    csvPath: outCsvPath,
    jsonPath: outJsonPath,
  };
}

// ✅ Alias export (so main.js can import either name)
export { enrichLocalDentistsAndWriteFiles as buildLocalDentistOutreach };