// src/services/patientRecoveryEngine.js
// Intelligent multi-touch patient recovery engine.
// Replaces single-SMS missed call handler with a sequenced follow-up system
// that personalizes by known patient, classifies reply intent, and stops when recovered.
//
// Recovery sequence:
//   Wave 1 (0 min)  — immediate SMS, clinic-branded
//   Wave 2 (+2h)    — personalized check-in if no reply
//   Wave 3 (+24h)   — final outreach with booking prompt if no reply
//   Exhausted       — sequence ends, thread archived

import fs from "fs";
import path from "path";
import { sendSMS, lookupLineType } from "./smsService.js";
import { getClient, updateClient } from "./clientLifecycle.js";
import { logEvent, EVENT_TYPES } from "./eventLog.js";

const CLIENTS_DIR = path.join(process.cwd(), "data", "clients");

// Wave timing in milliseconds
const WAVE_DELAY = {
  2: 2  * 60 * 60 * 1000,   // 2 hours
  3: 24 * 60 * 60 * 1000,   // 24 hours from wave 1
};

// ─── File helpers ─────────────────────────────────────────────────────────────

function readJsonSafe(p, fb) {
  try {
    if (!fs.existsSync(p)) return fb;
    return JSON.parse(fs.readFileSync(p, "utf-8"));
  } catch { return fb; }
}

function writeJsonSafe(p, data) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(data, null, 2), "utf-8");
}

function digitsOnly(s) {
  return String(s || "").replace(/\D/g, "");
}

function recoveryPath(clinicSlug) {
  return path.join(CLIENTS_DIR, clinicSlug, "recovery-threads.json");
}

// ─── Patient lookup ───────────────────────────────────────────────────────────

function parseCsv(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return [];
  const headers = lines[0].split(",").map((h) => h.trim().toLowerCase());
  return lines.slice(1).map((line) => {
    const vals = line.split(",");
    const obj = {};
    headers.forEach((h, i) => { obj[h] = (vals[i] || "").trim(); });
    return obj;
  });
}

/**
 * Match a phone number against the clinic's patient CSV.
 * @param {string} clinicSlug
 * @param {string} callerNumber — E.164
 * @returns {object|null} Patient record or null
 */
export function lookupPatient(clinicSlug, callerNumber) {
  const csvPath = path.join(CLIENTS_DIR, clinicSlug, "patients.csv");
  if (!fs.existsSync(csvPath)) return null;
  const patients = parseCsv(fs.readFileSync(csvPath, "utf-8"));
  const digits = digitsOnly(callerNumber);
  return patients.find((p) => p.phone && digitsOnly(p.phone) === digits) || null;
}

// ─── Reply intent classification ──────────────────────────────────────────────

/**
 * Classify a patient's reply message.
 * @param {string} body
 * @returns {"booking"|"opt_out"|"question"|"other"}
 */
export function classifyReply(body) {
  const b = (body || "").toLowerCase().trim();
  if (/\bstop\b|\bunsubscribe\b|\bopt.?out\b|\bno more\b|\bremove\b/.test(b)) return "opt_out";
  if (/\byes\b|\bbook\b|\bappoint\b|\bschedule\b|\bwhen\b|\bavailab\b|\bopen\b|\btime\b|\bsoon\b|\btoday\b|\btomorrow\b|\bmonday\b|\btuesday\b|\bwednesday\b|\bthursday\b|\bfriday\b/.test(b)) return "booking";
  if (/\?|how|what|where|which|who|help|info|cost|price|insurance/.test(b)) return "question";
  return "other";
}

// ─── Wave message builders ────────────────────────────────────────────────────

/**
 * Build the SMS body for a given wave.
 * @param {1|2|3} wave
 * @param {object} clinic
 * @param {object|null} patient
 * @returns {string}
 */
export function buildWaveMessage(wave, clinic, patient) {
  const clinicName = clinic.clinicName || "the clinic";
  const clinicPhone = clinic.clinicPhone || "";
  const website = clinic.website || "";
  const isFree = clinic.isFree || clinic.brandingEnabled;
  const slug = clinic.clinicSlug || clinic.portalSlug || "";
  // Free tier: append referral link so patients can spread ClinicFlow virally
  const refSuffix = isFree && slug
    ? `\n\n— Sent via ClinicFlow · clinicflowautomation.com/ref/${slug}`
    : ` — ${clinicName}`;
  const firstName = patient?.name?.split(" ")[0] || null;
  const greet = firstName ? `Hi ${firstName}` : "Hi";

  if (wave === 1) {
    return `${greet}! You called ${clinicName}. We missed your call — we'll follow up with you within 2 hours. Reply here to book an appointment or ask a question.${refSuffix}`;
  }

  if (wave === 2) {
    const lastVisitLine = patient?.last_visit
      ? ` We last saw you in ${new Date(patient.last_visit).toLocaleDateString("en-CA", { month: "long", year: "numeric" })}.`
      : "";
    return `${greet}, ${clinicName} here — just checking in on your missed call.${lastVisitLine} Do you need to book an appointment? Reply YES and we'll get you set up. — ${clinicName}`;
  }

  // Wave 3
  const callToAction = website
    ? `Book online at ${website} or call ${clinicPhone}.`
    : clinicPhone
      ? `Give us a call at ${clinicPhone}.`
      : "Reply here and we'll reach out.";
  return `${greet}, final check-in from ${clinicName}. We don't want you to miss out on the care you need. ${callToAction} We're here for you. — ${clinicName}`;
}

// ─── Thread management ────────────────────────────────────────────────────────

function loadThreads(clinicSlug) {
  return readJsonSafe(recoveryPath(clinicSlug), []);
}

function saveThreads(clinicSlug, threads) {
  writeJsonSafe(recoveryPath(clinicSlug), threads);
}

/**
 * Find an open (non-resolved) thread for a caller.
 */
function findOpenThread(threads, callerNumber) {
  const digits = digitsOnly(callerNumber);
  return threads.find(
    (t) =>
      digitsOnly(t.callerNumber) === digits &&
      !["replied", "recovered", "opted_out", "exhausted"].includes(t.status)
  );
}

// ─── Core: start recovery thread ─────────────────────────────────────────────

/**
 * Called by the webhook on every missed call.
 * Creates a recovery thread, sends wave 1 immediately (async).
 * Returns TwiML synchronously so Twilio never times out.
 *
 * @param {string} clinicSlug
 * @param {string} callerNumber — E.164
 * @param {string} callSid
 * @returns {Promise<{ ok, twiml, error? }>}
 */
export async function startRecoveryThread(clinicSlug, callerNumber, callSid) {
  const clinic = getClient(clinicSlug);

  if (!clinic) {
    return {
      ok: false, error: "clinic_not_found",
      twiml: `<?xml version="1.0" encoding="UTF-8"?><Response><Hangup/></Response>`,
    };
  }

  if (!clinic.services?.missedCall) {
    return { ok: false, error: "service_not_enabled", twiml: buildTwiML(clinic) };
  }

  // Free-tier cap
  if (clinic.isFree) {
    const sent = clinic.freeSmsSentThisMonth || 0;
    const limit = clinic.freeSmsLimit || 50;
    if (sent >= limit) {
      _logThread(clinicSlug, callerNumber, callSid, "skipped_limit", null);
      return { ok: false, error: "free_limit_reached", twiml: buildTwiML(clinic) };
    }
    updateClient(clinicSlug, { freeSmsSentThisMonth: sent + 1 });
  }

  const twiml = buildTwiML(clinic);
  const now = Date.now();
  const patient = lookupPatient(clinicSlug, callerNumber);

  const thread = {
    id:          `recovery_${now}_${Math.random().toString(36).slice(2, 8)}`,
    callSid,
    clinicSlug,
    callerNumber,
    calledAt:    new Date(now).toISOString(),
    patientName:      patient?.name || null,
    patientLastVisit: patient?.last_visit || null,
    isKnownPatient:   !!patient,
    status:      "wave1_pending",
    wave:        1,
    nextWaveAt:  new Date(now + WAVE_DELAY[2]).toISOString(),
    messages:    [],
    reply:       null,
    replyIntent: null,
    resolvedAt:  null,
    recovered:   false,
  };

  const threads = loadThreads(clinicSlug);
  threads.push(thread);
  saveThreads(clinicSlug, threads);

  // Send wave 1 async — never block TwiML response
  setImmediate(async () => {
    await _sendWave(clinicSlug, thread.id, 1, clinic, patient);
  });

  return { ok: true, twiml, callSid, threadId: thread.id };
}

// ─── Internal wave sender ─────────────────────────────────────────────────────

async function _sendWave(clinicSlug, threadId, wave, clinic, patient) {
  const threads = loadThreads(clinicSlug);
  const idx = threads.findIndex((t) => t.id === threadId);
  if (idx === -1) return;

  const thread = threads[idx];
  const body = buildWaveMessage(wave, clinic, patient || { name: thread.patientName, last_visit: thread.patientLastVisit });
  const from = clinic.twilioNumber || process.env.TWILIO_FROM_NUMBER;

  // Skip landlines for wave 2+ (wave 1 already sent before we can check)
  if (wave >= 2) {
    let lineType = "unknown";
    try { lineType = await lookupLineType(thread.callerNumber); } catch {}
    if (lineType === "landline" || lineType === "fixedVoip") {
      console.log(`[recovery] ${clinicSlug}: ${thread.callerNumber} is ${lineType} — skipping wave ${wave}`);
      threads[idx].status = "exhausted";
      threads[idx].resolvedAt = new Date().toISOString();
      saveThreads(clinicSlug, threads);
      return;
    }
  }

  // Predictive gate: skip wave 3 if recovery likelihood is very low (< 25)
  // Wave 2 always sends — it's the second chance. Wave 3 only for likely responders.
  if (wave === 3) {
    let recoveryLikelihood = 50; // neutral default
    try {
      const { getPatientRecoveryLikelihood } = await import("./predictiveEngine.js");
      recoveryLikelihood = getPatientRecoveryLikelihood(clinicSlug, thread.callerNumber);
    } catch {}
    if (recoveryLikelihood < 25) {
      console.log(`[recovery] ${clinicSlug}: recovery likelihood ${recoveryLikelihood}% < 25 — skipping wave 3 for ${thread.callerNumber}`);
      threads[idx].status = "exhausted";
      threads[idx].resolvedAt = new Date().toISOString();
      saveThreads(clinicSlug, threads);
      return;
    }
    console.log(`[recovery] ${clinicSlug}: recovery likelihood ${recoveryLikelihood}% ≥ 25 — sending wave 3`);
  }

  let sid = null;
  let success = false;

  try {
    const result = await sendSMS(thread.callerNumber, body, from);
    sid = result.sid;
    success = true;
    console.log(`[recovery] ✓ Wave ${wave} → ${thread.callerNumber} (${clinicSlug}) | SID: ${sid}`);
  } catch (err) {
    console.error(`[recovery] ✗ Wave ${wave} failed for ${thread.callerNumber}: ${err.message}`);
  }

  // Reload threads (may have changed while awaiting)
  const freshThreads = loadThreads(clinicSlug);
  const freshIdx = freshThreads.findIndex((t) => t.id === threadId);
  if (freshIdx === -1) return;

  freshThreads[freshIdx].messages.push({
    wave,
    sentAt: new Date().toISOString(),
    body,
    sid,
    success,
  });

  if (success) {
    freshThreads[freshIdx].status = wave < 3 ? `wave${wave}_sent` : "wave3_sent";
    freshThreads[freshIdx].wave = wave;
    if (wave < 3) {
      freshThreads[freshIdx].nextWaveAt = new Date(Date.now() + WAVE_DELAY[wave + 1]).toISOString();
    } else {
      freshThreads[freshIdx].nextWaveAt = null;
    }
    // Update clinic results counter (only on wave 1)
    if (wave === 1) {
      const c = getClient(clinicSlug);
      const results = c?.results || {};
      updateClient(clinicSlug, {
        results: { ...results, missedCallsHandled: (results.missedCallsHandled || 0) + 1 },
      });
    }
    // Log to unified event log
    const waveEventType = [
      EVENT_TYPES.RECOVERY_WAVE_1,
      EVENT_TYPES.RECOVERY_WAVE_2,
      EVENT_TYPES.RECOVERY_WAVE_3,
    ][wave - 1];
    logEvent(clinicSlug, {
      type:         waveEventType,
      patientPhone: thread.callerNumber,
      patientName:  thread.patientName || null,
      direction:    "outbound",
      channel:      "sms",
      content:      body,
      outcome:      "sent",
      metadata:     { wave, sid, threadId },
    });
  } else {
    freshThreads[freshIdx].status = "wave1_failed";
    logEvent(clinicSlug, {
      type:         EVENT_TYPES.RECOVERY_WAVE_1,
      patientPhone: thread.callerNumber,
      patientName:  thread.patientName || null,
      direction:    "outbound",
      channel:      "sms",
      content:      body,
      outcome:      "failed",
      metadata:     { wave },
    });
  }

  saveThreads(clinicSlug, freshThreads);
}

// ─── Scheduler: send overdue waves ────────────────────────────────────────────

/**
 * Run scheduled follow-up waves for all open threads across all clients.
 * Called by scheduler every 30 minutes.
 * @returns {Promise<{ checked, sent, errors }>}
 */
export async function runScheduledFollowUps() {
  const CLIENTS_PATH = path.join(process.cwd(), "data", "clients.json");
  let clients = [];
  try {
    clients = JSON.parse(fs.readFileSync(CLIENTS_PATH, "utf-8"));
  } catch {}

  const activeClients = clients.filter(
    (c) => c.clinicSlug && c.status === "active" && c.services?.missedCall
  );

  let checked = 0, sent = 0;
  const errors = [];

  for (const client of activeClients) {
    const slug = client.clinicSlug;
    const threads = loadThreads(slug);
    const now = Date.now();

    const due = threads.filter(
      (t) =>
        t.nextWaveAt &&
        new Date(t.nextWaveAt).getTime() <= now &&
        ["wave1_sent", "wave2_sent"].includes(t.status) &&
        !["replied", "recovered", "opted_out", "exhausted"].includes(t.status)
    );

    checked += due.length;

    for (const thread of due) {
      const nextWave = thread.wave + 1;
      if (nextWave > 3) continue;

      // Re-fetch clinic in case record changed
      const clinic = getClient(slug);
      if (!clinic) continue;

      const patient = thread.isKnownPatient
        ? { name: thread.patientName, last_visit: thread.patientLastVisit }
        : null;

      try {
        await _sendWave(slug, thread.id, nextWave, clinic, patient);
        sent++;
      } catch (err) {
        const msg = `${slug} | ${thread.callerNumber} | wave${nextWave}: ${err.message}`;
        errors.push(msg);
        console.error(`[recovery] ✗ ${msg}`);
      }

      // Mark exhausted if this was wave 3
      if (nextWave === 3) {
        const freshThreads = loadThreads(slug);
        const idx = freshThreads.findIndex((t) => t.id === thread.id);
        if (idx !== -1 && freshThreads[idx].status === "wave3_sent") {
          // Will be marked exhausted on next run (give time for reply to come in)
          freshThreads[idx].nextWaveAt = null;
          saveThreads(slug, freshThreads);
        }
      }
    }

    // Mark wave3_sent threads with no nextWaveAt as exhausted
    const freshThreads = loadThreads(slug);
    let changed = false;
    for (const t of freshThreads) {
      if (t.status === "wave3_sent" && !t.nextWaveAt && !t.resolvedAt) {
        t.status = "exhausted";
        t.resolvedAt = new Date().toISOString();
        changed = true;
      }
    }
    if (changed) saveThreads(slug, freshThreads);
  }

  console.log(`[recovery] Follow-up run: checked=${checked} sent=${sent} errors=${errors.length}`);
  return { checked, sent, errors };
}

// ─── Inbound reply handler ────────────────────────────────────────────────────

/**
 * Process a patient's SMS reply. Matches to an open thread, classifies intent,
 * sends appropriate response, and stops the follow-up sequence.
 *
 * @param {string} clinicSlug
 * @param {string} callerNumber — E.164
 * @param {string} body — reply text
 * @returns {{ matched, intent, response }}
 */
export async function processIncomingReply(clinicSlug, callerNumber, body) {
  const threads = loadThreads(clinicSlug);
  const idx = threads.findIndex(
    (t) =>
      digitsOnly(t.callerNumber) === digitsOnly(callerNumber) &&
      !["replied", "recovered", "opted_out", "exhausted"].includes(t.status)
  );

  if (idx === -1) {
    return { matched: false, intent: null, response: null };
  }

  const intent = classifyReply(body);
  const clinic  = getClient(clinicSlug);
  const thread  = threads[idx];
  const clinicName = clinic?.clinicName || "the clinic";
  const clinicPhone = clinic?.clinicPhone || "";
  const website = clinic?.website || "";
  const firstName = thread.patientName?.split(" ")[0] || null;
  const greet = firstName ? `Hi ${firstName}` : "Hi";

  let replyBody = null;
  let newStatus = "replied";

  if (intent === "opt_out") {
    replyBody = `You've been removed from our follow-up list. If you ever need to reach us, call ${clinicPhone || clinicName}. — ${clinicName}`;
    newStatus = "opted_out";
  } else if (intent === "booking") {
    const bookingInfo = website
      ? `Book online at ${website} or call ${clinicPhone}.`
      : clinicPhone
        ? `Call us at ${clinicPhone} to set up your appointment.`
        : `Reply here with your preferred day and time.`;
    replyBody = `${greet}! We're glad you reached out. ${bookingInfo} We look forward to seeing you. — ${clinicName}`;
    newStatus = "recovered";
  } else if (intent === "question") {
    replyBody = `${greet}, thanks for your message! Someone from ${clinicName} will get back to you shortly.${clinicPhone ? ` You can also call us directly at ${clinicPhone}.` : ""} — ${clinicName}`;
    newStatus = "replied";
  } else {
    replyBody = `${greet}, thanks for reaching out! Someone from ${clinicName} will follow up with you shortly. — ${clinicName}`;
    newStatus = "replied";
  }

  // Send response
  const from = clinic?.twilioNumber || process.env.TWILIO_FROM_NUMBER;
  let sid = null;
  try {
    const result = await sendSMS(callerNumber, replyBody, from);
    sid = result.sid;
  } catch (err) {
    console.error(`[recovery] Reply send failed: ${err.message}`);
  }

  // Update thread
  threads[idx].status = newStatus;
  threads[idx].reply = body;
  threads[idx].replyIntent = intent;
  threads[idx].nextWaveAt = null; // stop sequence
  threads[idx].resolvedAt = new Date().toISOString();
  threads[idx].recovered = newStatus === "recovered";
  threads[idx].messages.push({
    wave: "reply",
    direction: "inbound",
    receivedAt: new Date().toISOString(),
    body,
    intent,
  });
  if (replyBody) {
    threads[idx].messages.push({
      wave: "reply_response",
      direction: "outbound",
      sentAt: new Date().toISOString(),
      body: replyBody,
      sid,
    });
  }

  saveThreads(clinicSlug, threads);

  // Log inbound reply to event log
  logEvent(clinicSlug, {
    type:         EVENT_TYPES.PATIENT_REPLIED,
    patientPhone: callerNumber,
    patientName:  thread.patientName || null,
    direction:    "inbound",
    channel:      "sms",
    content:      body,
    intent,
    sentiment:    intent === "booking" ? "positive" : intent === "opt_out" ? "negative" : "neutral",
    outcome:      newStatus,
    revenueAttributed: newStatus === "recovered" ? 200 : 0,
  });

  // Also log the outbound response
  if (replyBody) {
    const outcomeType = newStatus === "recovered"
      ? EVENT_TYPES.PATIENT_BOOKED
      : newStatus === "opted_out"
        ? EVENT_TYPES.PATIENT_OPTED_OUT
        : EVENT_TYPES.CLINIC_BRAIN_ANSWER;
    logEvent(clinicSlug, {
      type:         outcomeType,
      patientPhone: callerNumber,
      patientName:  thread.patientName || null,
      direction:    "outbound",
      channel:      "sms",
      content:      replyBody,
      intent,
      outcome:      newStatus,
    });
  }

  console.log(`[recovery] Reply from ${callerNumber} (${clinicSlug}): intent=${intent} → status=${newStatus}`);
  return { matched: true, intent, response: replyBody };
}

// ─── Stats ────────────────────────────────────────────────────────────────────

/**
 * Comprehensive recovery stats for a clinic.
 * Also used by getMissedCallStats() for backward compatibility.
 * @param {string} clinicSlug
 * @returns {object}
 */
export function getRecoveryStats(clinicSlug) {
  const threads = loadThreads(clinicSlug);
  const total       = threads.length;
  const wave1Sent   = threads.filter((t) => t.messages.some((m) => m.wave === 1 && m.success)).length;
  const wave2Sent   = threads.filter((t) => t.messages.some((m) => m.wave === 2 && m.success)).length;
  const wave3Sent   = threads.filter((t) => t.messages.some((m) => m.wave === 3 && m.success)).length;
  const replied     = threads.filter((t) => t.reply != null).length;
  const recovered   = threads.filter((t) => t.recovered).length;
  const optedOut    = threads.filter((t) => t.status === "opted_out").length;
  const exhausted   = threads.filter((t) => t.status === "exhausted").length;
  const knownPatients = threads.filter((t) => t.isKnownPatient).length;
  const replyRate   = wave1Sent > 0 ? Math.round((replied / wave1Sent) * 100) : 0;
  const recoveryRate = wave1Sent > 0 ? Math.round((recovered / wave1Sent) * 100) : 0;

  const byIntent = { booking: 0, question: 0, opt_out: 0, other: 0 };
  threads.forEach((t) => { if (t.replyIntent) byIntent[t.replyIntent] = (byIntent[t.replyIntent] || 0) + 1; });

  return {
    total,
    wave1Sent,
    wave2Sent,
    wave3Sent,
    replied,
    recovered,
    optedOut,
    exhausted,
    knownPatients,
    replyRate,
    recoveryRate,
    byIntent,
  };
}

// ─── Backward-compat shim (replaces missedCallService.getMissedCallStats) ─────

/**
 * Drop-in replacement for the old getMissedCallStats() shape.
 * Called by resultsReportService.
 */
export function getMissedCallStats(clinicSlug) {
  const s = getRecoveryStats(clinicSlug);
  return {
    total:   s.total,
    sent:    s.wave1Sent,
    failed:  s.total - s.wave1Sent,
    skipped: 0,
    // extended fields
    recovered:    s.recovered,
    replyRate:    s.replyRate,
    recoveryRate: s.recoveryRate,
  };
}

// ─── TwiML builder (kept for webhook + Netlify function) ─────────────────────

export function buildTwiML(clinic) {
  const name = (clinic?.clinicName || "the clinic").replace(/[<>&"]/g, "");
  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="alice">Thank you for calling ${name}. We missed your call but will be in touch shortly. Goodbye.</Say>
  <Hangup/>
</Response>`;
}

// ─── Private thread logger (for skipped/disabled cases) ──────────────────────

function _logThread(clinicSlug, callerNumber, callSid, status, patient) {
  const threads = loadThreads(clinicSlug);
  threads.push({
    id:          `recovery_${Date.now()}_skip`,
    callSid,
    clinicSlug,
    callerNumber,
    calledAt:    new Date().toISOString(),
    patientName:      patient?.name || null,
    patientLastVisit: patient?.last_visit || null,
    isKnownPatient:   !!patient,
    status,
    wave:        0,
    nextWaveAt:  null,
    messages:    [],
    reply:       null,
    replyIntent: null,
    resolvedAt:  new Date().toISOString(),
    recovered:   false,
  });
  saveThreads(clinicSlug, threads);
}
