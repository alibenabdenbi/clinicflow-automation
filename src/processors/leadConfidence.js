// src/processors/leadConfidence.js
import fs from "fs";
import path from "path";

const ROOT = process.cwd();
const DATA_DIR = path.join(ROOT, "data");
const HISTORY_PATH = path.join(DATA_DIR, "lead_history.json");

function readJsonSafe(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, "utf-8"));
  } catch {
    return fallback;
  }
}

function writeJsonSafe(filePath, obj) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(obj, null, 2), "utf-8");
}

/**
 * Updates lead history and returns a map keyed by leadId.
 * Stored fields:
 * - seenCount, firstSeenAt, lastSeenAt
 */
export function updateLeadHistory(leads = []) {
  const now = new Date().toISOString();

  const hist = readJsonSafe(HISTORY_PATH, {});
  const map = typeof hist === "object" && hist ? hist : {};

  for (const l of leads.filter(Boolean)) {
    const id = String(l.leadId || "").trim();
    if (!id) continue;

    if (!map[id]) {
      map[id] = { seenCount: 0, firstSeenAt: now, lastSeenAt: now };
    }

    map[id].seenCount = Number(map[id].seenCount || 0) + 1;
    map[id].lastSeenAt = now;
    if (!map[id].firstSeenAt) map[id].firstSeenAt = now;
  }

  writeJsonSafe(HISTORY_PATH, map);
  return map;
}

export function getLeadHistoryMap() {
  const hist = readJsonSafe(HISTORY_PATH, {});
  return typeof hist === "object" && hist ? hist : {};
}