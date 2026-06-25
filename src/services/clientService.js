// src/services/clientService.js
// Simple CRM for paying ClinicFlow clients.
// All client data lives in data/clients.json.

import fs from "fs";
import path from "path";

const CLIENTS_PATH = path.join(process.cwd(), "data", "clients.json");

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

/**
 * Add a new paying client.
 * @param {string} name       — Clinic name
 * @param {string} city       — City
 * @param {string} email      — Contact email
 * @param {"starter"|"growth"|"full"} tier
 * @param {string} startDate  — ISO date string (payment confirmed date)
 * @returns {object}          — The new client record
 */
export function addClient(name, city, email, tier, startDate = new Date().toISOString()) {
  const clients = readClients();

  const existing = clients.find(c => c.email.toLowerCase() === email.toLowerCase());
  if (existing) {
    console.warn(`Client with email ${email} already exists. Use updateClient() to modify.`);
    return existing;
  }

  const client = {
    id: `client_${Date.now()}`,
    name,
    city,
    email,
    tier,
    startDate,
    status: "active",
    delivered: false,
    deliveredAt: null,
    notes: "",
    createdAt: new Date().toISOString(),
  };

  clients.push(client);
  writeClients(clients);
  console.log(`✓ Added client: ${name} (${tier})`);
  return client;
}

/**
 * Returns all active clients.
 * @returns {object[]}
 */
export function getActiveClients() {
  return readClients().filter(c => c.status === "active");
}

/**
 * Returns all clients regardless of status.
 * @returns {object[]}
 */
export function getAllClients() {
  return readClients();
}

/**
 * Marks a client as delivered (setup complete).
 * @param {string} clientEmail
 * @returns {object|null}  — Updated client, or null if not found
 */
export function markDelivered(clientEmail) {
  const clients = readClients();
  const idx = clients.findIndex(c => c.email.toLowerCase() === clientEmail.toLowerCase());
  if (idx === -1) {
    console.warn(`No client found with email: ${clientEmail}`);
    return null;
  }
  clients[idx].delivered = true;
  clients[idx].deliveredAt = new Date().toISOString();
  writeClients(clients);
  console.log(`✓ Marked delivered: ${clients[idx].name}`);
  return clients[idx];
}

/**
 * Update arbitrary fields on a client record.
 * @param {string} clientEmail
 * @param {object} updates
 * @returns {object|null}
 */
export function updateClient(clientEmail, updates) {
  const clients = readClients();
  const idx = clients.findIndex(c => c.email.toLowerCase() === clientEmail.toLowerCase());
  if (idx === -1) {
    console.warn(`No client found with email: ${clientEmail}`);
    return null;
  }
  Object.assign(clients[idx], updates, { updatedAt: new Date().toISOString() });
  writeClients(clients);
  return clients[idx];
}
