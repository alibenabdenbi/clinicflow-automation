// src/cli/mergeDiscoveredToOutreach.js
// Merge discovered businesses -> outreach list (adds only new websites)
// Input:  data/local.businesses.json
// Output: data/outreach.localDentists.json

import fs from "fs";
import path from "path";
import crypto from "crypto";

const DISCOVERED_PATH =
  process.env.DISCOVERED_JSON_PATH ||
  path.join(process.cwd(), "data", "local.businesses.json");

const OUTREACH_PATH =
  process.env.OUTREACH_JSON_PATH ||
  path.join(process.cwd(), "data", "outreach.localDentists.json");

function readJsonSafe(filePath, fallback = []) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, "utf-8"));
  } catch {
    return fallback;
  }
}

function writeJsonSafe(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
}

function cleanWebsite(u) {
  const raw = String(u || "").trim();
  if (!raw) return "";
  try {
    const url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
    url.hash = "";
    // keep origin for stable dedupe
    return url.origin;
  } catch {
    return raw;
  }
}

function makeId(obj) {
  const input = `${obj.clinicName || ""}__${obj.website || ""}`.toLowerCase();
  return crypto.createHash("md5").update(input).digest("hex").slice(0, 12);
}

function normalizeOutreachLead(r) {
  const website = cleanWebsite(r.website);
  const clinicName = r.clinicName || r.name || "Dental Clinic";
  const id = r.id || makeId({ clinicName, website });

  const email = String(r.email || "").trim();
  const contactPage = String(r.contactPage || "").trim();

  const method = email ? "email" : contactPage ? "contact_form" : "manual";
  const status = r.status || "todo";

  return {
    id,
    clinicName,
    website,
    city: r.city || "",
    province: r.province || r.state || "",
    score: r.score ?? null,
    tier: r.tier ?? null,

    email,
    emailConfidence: r.emailConfidence || (email ? "high" : "none"),
    contactPage,
    method,
    status,

    notes: r.notes || "",
    source: r.source || "",
    discoveredAt: r.discoveredAt || r.foundAt || "",
    enrichedAt: r.enrichedAt || "",
    sentAt: r.sentAt || "",
    followupDueAt: r.followupDueAt || "",
    lastError: r.lastError || "",
  };
}

async function main() {
  const discovered = readJsonSafe(DISCOVERED_PATH, []);
  const outreach = readJsonSafe(OUTREACH_PATH, []);

  if (!Array.isArray(discovered) || discovered.length === 0) {
    console.log("No discovered businesses found at:", DISCOVERED_PATH);
    process.exit(0);
  }

  const existingWebsites = new Set(
    outreach
      .map((l) => cleanWebsite(l.website).toLowerCase())
      .filter(Boolean)
  );

  let added = 0;

  for (const b of discovered) {
    const website = cleanWebsite(b.website);
    if (!website) continue;

    const key = website.toLowerCase();
    if (existingWebsites.has(key)) continue;

    const lead = normalizeOutreachLead({
      clinicName: b.name || b.clinicName || "Dental Clinic",
      website,
      city: b.city || "",
      province: b.province || "",
      email: b.email || "",
      notes: "Merged from local.businesses.json",
      source: b.source || "overpass",
      discoveredAt: b.foundAt || new Date().toISOString(),
      status: "todo",
    });

    outreach.push(lead);
    existingWebsites.add(key);
    added++;
  }

  writeJsonSafe(OUTREACH_PATH, outreach);

  console.log("Merged discovered -> outreach");
  console.log("Discovered file:", DISCOVERED_PATH);
  console.log("Outreach file:", OUTREACH_PATH);
  console.log(`+ Added ${added} new lead(s). Total outreach now: ${outreach.length}`);
}

main().catch((e) => {
  console.error("Merge failed:", e?.message || e);
  process.exit(1);
});