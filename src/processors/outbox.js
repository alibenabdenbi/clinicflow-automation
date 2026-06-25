// src/processors/outbox.js

import fs from "fs";
import path from "path";

const OUTBOX_PATH = path.resolve("data/outbox.json");

function readOutbox() {
  if (!fs.existsSync(OUTBOX_PATH)) {
    fs.writeFileSync(OUTBOX_PATH, JSON.stringify([], null, 2));
  }
  return JSON.parse(fs.readFileSync(OUTBOX_PATH, "utf-8"));
}

function writeOutbox(data) {
  fs.writeFileSync(OUTBOX_PATH, JSON.stringify(data, null, 2));
}

export function queueMessage(message) {
  const outbox = readOutbox();

  const entry = {
    id: `msg_${message.leadId}_${Date.now()}`,
    leadId: message.leadId,
    platform: message.platform,
    postUrl: message.postUrl,
    offerName: message.offerName,
    confirmLink: message.confirmLink,
    emailBody: message.outreach?.email || "",
    shortDM: message.outreach?.shortDM || "",
    mediumDM: message.outreach?.mediumDM || "",
    status: "READY_TO_SEND",
    createdAt: new Date().toISOString(),
    sentAt: null,
  };

  outbox.push(entry);
  writeOutbox(outbox);

  return entry;
}

export function markAsSent(messageId) {
  const outbox = readOutbox();
  const msg = outbox.find(m => m.id === messageId);
  if (!msg) return null;

  msg.status = "SENT";
  msg.sentAt = new Date().toISOString();
  writeOutbox(outbox);

  return msg;
}