import fs from "fs";
import path from "path";

const crmPath = path.join("data", "crm.leads.json");

function readCRM() {
  if (!fs.existsSync(crmPath)) return [];
  return JSON.parse(fs.readFileSync(crmPath, "utf-8"));
}

function writeCRM(data) {
  fs.writeFileSync(crmPath, JSON.stringify(data, null, 2));
}

export async function confirmLead(leadId) {
  const crm = readCRM();

  const index = crm.findIndex(l => l.leadId === leadId);

  if (index === -1) return null;

  crm[index].confirmed = true;
  crm[index].confirmedAt = new Date().toISOString();

  writeCRM(crm);

  return crm[index];
}