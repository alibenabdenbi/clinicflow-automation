// src/services/clientLifecycle.js
// Unified state machine for ClinicFlow clients.
// Single source of truth for all client records in data/clients.json.

import fs from "fs";
import path from "path";

const CLIENTS_PATH = path.join(process.cwd(), "data", "clients.json");

const VALID_STAGES = [
  "lead",
  "payment_received",
  "onboarding",
  "active",
  "reporting",
  "churned",
];

// ─── I/O helpers ──────────────────────────────────────────────────────────────

function readClients() {
  try {
    if (!fs.existsSync(CLIENTS_PATH)) return [];
    return JSON.parse(fs.readFileSync(CLIENTS_PATH, "utf-8"));
  } catch {
    return [];
  }
}

function writeClients(clients) {
  fs.mkdirSync(path.dirname(CLIENTS_PATH), { recursive: true });
  fs.writeFileSync(CLIENTS_PATH, JSON.stringify(clients, null, 2), "utf-8");
}

// ─── Default record shape ─────────────────────────────────────────────────────

export function defaultClientRecord(overrides = {}) {
  return {
    clinicSlug: "",
    clinicName: "",
    contactName: "",
    contactEmail: "",
    clinicPhone: "",
    city: "",
    tier: "growth",
    status: "lead",
    twilioNumber: null,
    phoneSetup: null,
    services: {
      missedCall: false,
      reminders: false,
      reactivation: false,
    },
    isFree: false,
    freeSmsSentThisMonth: 0,
    freeSmsLimit: 50,
    brandingEnabled: false,
    referralCount: 0,
    patientsLoaded: 0,
    patientsCsvPath: null,
    goLiveDate: null,
    paymentDate: null,
    firstHalfPaid: false,
    secondHalfPaid: false,
    firstHalfAmount: 0,
    secondHalfAmount: 0,
    results: {
      missedCallsHandled: 0,
      appointmentsReminded: 0,
      patientsReactivated: 0,
      estimatedRevenueRecovered: 0,
    },
    onboardingStep: 0,
    portalPassword: "",
    portalSlug: "",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    stageHistory: [],
    ...overrides,
  };
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Look up a client by their slug.
 * @param {string} clinicSlug
 * @returns {object|null}
 */
export function getClient(clinicSlug) {
  if (!clinicSlug) return null;
  return readClients().find((c) => c.clinicSlug === clinicSlug) || null;
}

/**
 * Merge updates into a client record and persist.
 * @param {string} clinicSlug
 * @param {object} updates
 * @returns {object|null} Updated record, or null if not found.
 */
export function updateClient(clinicSlug, updates) {
  const clients = readClients();
  const idx = clients.findIndex((c) => c.clinicSlug === clinicSlug);
  if (idx === -1) {
    console.warn(`[lifecycle] updateClient: slug not found — ${clinicSlug}`);
    return null;
  }
  // Deep-merge nested results object if present in updates
  if (updates.results && clients[idx].results) {
    updates.results = { ...clients[idx].results, ...updates.results };
  }
  Object.assign(clients[idx], updates, { updatedAt: new Date().toISOString() });
  writeClients(clients);
  return clients[idx];
}

/**
 * Move a client to a new lifecycle stage and record the transition.
 * @param {string} clinicSlug
 * @param {string} newStage  — must be one of VALID_STAGES
 * @returns {object|null}
 */
export function advanceStage(clinicSlug, newStage) {
  if (!VALID_STAGES.includes(newStage)) {
    throw new Error(`[lifecycle] Invalid stage "${newStage}". Valid: ${VALID_STAGES.join(", ")}`);
  }
  const clients = readClients();
  const idx = clients.findIndex((c) => c.clinicSlug === clinicSlug);
  if (idx === -1) {
    console.warn(`[lifecycle] advanceStage: slug not found — ${clinicSlug}`);
    return null;
  }
  const prev = clients[idx].status;
  if (prev === newStage) return clients[idx]; // no-op

  clients[idx].status = newStage;
  clients[idx].updatedAt = new Date().toISOString();
  if (!Array.isArray(clients[idx].stageHistory)) clients[idx].stageHistory = [];
  clients[idx].stageHistory.push({ from: prev, to: newStage, at: new Date().toISOString() });

  writeClients(clients);
  console.log(`[lifecycle] ${clinicSlug}: ${prev} → ${newStage}`);
  return clients[idx];
}

/**
 * Returns all clients currently in the 'active' stage.
 * @returns {object[]}
 */
export function getActiveClients() {
  return readClients().filter((c) => c.status === "active");
}

/**
 * Returns all clients currently in the 'onboarding' stage.
 * @returns {object[]}
 */
export function getPendingOnboarding() {
  return readClients().filter((c) => c.status === "onboarding");
}

/**
 * Add a brand-new client record. Errors if slug already exists.
 * @param {object} fields — must include clinicSlug, clinicName, contactEmail
 * @returns {object} The created record.
 */
export function createClient(fields) {
  if (!fields.clinicSlug) throw new Error("[lifecycle] clinicSlug is required");
  const clients = readClients();
  const exists = clients.find((c) => c.clinicSlug === fields.clinicSlug);
  if (exists) throw new Error(`[lifecycle] Client already exists: ${fields.clinicSlug}`);
  const record = defaultClientRecord(fields);
  clients.push(record);
  writeClients(clients);
  console.log(`[lifecycle] Created client: ${fields.clinicSlug}`);
  return record;
}

/**
 * Reset monthly free-tier SMS counter for all free clients.
 * Runs first day of month via scheduler.
 */
export function resetFreeSmsCounts() {
  const clients = readClients();
  let reset = 0;
  for (const c of clients) {
    if (c.isFree) {
      c.freeSmsSentThisMonth = 0;
      c.updatedAt = new Date().toISOString();
      reset++;
    }
  }
  writeClients(clients);
  console.log(`[lifecycle] Reset free SMS counts for ${reset} client(s)`);
  return reset;
}

/**
 * Apply referral upgrade rules for a free client.
 * 1 referral → branding removed, limit 200
 * 2 referrals → upgraded to Starter (unlimited)
 * @param {string} clinicSlug
 */
export function applyReferralUpgrade(clinicSlug) {
  const client = getClient(clinicSlug);
  if (!client || !client.isFree) return null;
  const refs = (client.referralCount || 0) + 1;
  const updates = { referralCount: refs };
  if (refs === 1) {
    updates.brandingEnabled = false;
    updates.freeSmsLimit = 200;
    console.log(`[lifecycle] ${clinicSlug}: 1 referral — branding removed, limit → 200`);
  } else if (refs >= 2) {
    updates.isFree = false;
    updates.tier = "starter";
    updates.freeSmsLimit = Infinity;
    console.log(`[lifecycle] ${clinicSlug}: 2 referrals — upgraded to Starter`);
  }
  return updateClient(clinicSlug, updates);
}
