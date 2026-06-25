// src/server.js
// ORE Outreach Panel (manual sending + SMTP send + lead discovery + enrich + 1-page plan)
// Run: npm run server
// Open: http://localhost:3000

import express from "express";
import path from "path";
import fs from "fs";
import crypto from "crypto";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import nodemailer from "nodemailer";
import { spawn } from "child_process";
import { generateReplyEmail } from "./processors/replyGenerator.js";
import { findBestEmailOnWebsite, findContactPageUrl } from "./processors/emailFinder.js";
import { generateOnePagePlan } from "./processors/planGenerator.js";
import { buildTemplatePack } from "./processors/templatePack.js";
import helmet from "helmet";
import rateLimit from "express-rate-limit";


dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename); // kept (harmless)

const app = express();
app.set("trust proxy", true);
app.use(express.json({ limit: "2mb" }));
app.disable("x-powered-by");

// If you're behind Nginx/Cloudflare/Render/Fly/etc.
app.set("trust proxy", 1);

// Security headers
app.use(
  helmet({
    // your UI uses inline <script> in the HTML strings, so avoid strict CSP for now
    contentSecurityPolicy: false,
  })
);

// Basic rate limit for public endpoints (prevents abuse)
const publicLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120, // 120 req/min per IP
  standardHeaders: true,
  legacyHeaders: false,
});
app.use(publicLimiter);

const PORT = Number(process.env.PORT || 3000);

// ---- FILES ----
const OUTREACH_PATH = path.join(process.cwd(), "data", "outreach.localDentists.json");
const PLANS_DIR = path.join(process.cwd(), "data", "plans");
const SEND_LOG_PATH = path.join(process.cwd(), "data", "smtp.sendlog.json");
const CLINICS_PATH = path.join(process.cwd(), "data", "clinics.json");

// ---- DISCOVER ----
function findDiscoverScript() {
  const candidates = [
    (process.env.DISCOVER_SCRIPT || "").trim(),
    path.join(process.cwd(), "localBusinesses.js"),
    path.join(process.cwd(), "src", "scrapers", "localBusinesses.js"),
    path.join(process.cwd(), "src", "localBusinesses.js"),
  ].filter(Boolean);

  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) return p;
    } catch {}
  }
  return null;
}
const DISCOVER_SCRIPT = findDiscoverScript();
const DISCOVER_ENABLED = Boolean(DISCOVER_SCRIPT);

// ---- SMTP ----
const SMTP_HOST = (process.env.SMTP_HOST || "").trim();
const SMTP_PORT = Number(process.env.SMTP_PORT || "0");
const SMTP_USER = (process.env.SMTP_USER || "").trim();
const SMTP_PASS = (process.env.SMTP_PASS || "").trim();

const SMTP_SECURE =
  (process.env.SMTP_SECURE || "").toLowerCase() === "true" || SMTP_PORT === 465;

const SMTP_TLS_REJECT_UNAUTHORIZED =
  (process.env.SMTP_TLS_REJECT_UNAUTHORIZED || "true").toLowerCase() !== "false";

const SMTP_FROM = (process.env.SMTP_FROM || SMTP_USER).trim();
const MAX_EMAILS_PER_DAY = Number(process.env.MAX_EMAILS_PER_DAY || "20");
const FOLLOWUP_DELAY_DAYS = Number(process.env.FOLLOWUP_DELAY_DAYS || "3");
const BASE_URL = (process.env.PUBLIC_BASE_URL || `http://localhost:${PORT}`).replace(/\/$/, "");
const SMTP_ENABLED = Boolean(process.env.SMTP_HOST);
const PUBLIC_CONTACT_EMAIL = (process.env.PUBLIC_CONTACT_EMAIL || SMTP_FROM || "").trim();
const PUBLIC_BOOK_CALL_URL = (process.env.PUBLIC_BOOK_CALL_URL || "").trim();

// ---- PLAN WRAPPER (public plan page chrome) ----
function wrapPlanHtml({ clinic, innerHtml }) {
  const clinicName = String(clinic?.clinicName || "Your Clinic").trim();
  const website = String(clinic?.website || "").trim();
  const contactEmail = String(clinic?.contactEmail || process.env.SMTP_FROM || "").trim();
  const bookingLink = String(clinic?.bookingLink || "").trim();

  const emailHref = contactEmail
    ? `mailto:${encodeURIComponent(contactEmail)}?subject=${encodeURIComponent(
        `ClinicFlow — next step for ${clinicName}`
      )}`
    : `mailto:${encodeURIComponent(String(process.env.SMTP_FROM || ""))}?subject=${encodeURIComponent(
        `ClinicFlow — next step for ${clinicName}`
      )}`;

  const callBtn = bookingLink
    ? `<a class="btn btn2" href="${bookingLink}" target="_blank" rel="noreferrer">Book optional call</a>`
    : "";

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>ClinicFlow Plan — ${clinicName}</title>
<style>
 :root{
  --bg:#0b0f17;
  --card:rgba(255,255,255,.06);
  --card2:rgba(255,255,255,.035);
  --line:rgba(255,255,255,.12);
  --text:#e8eefc;
  --muted:#a7b0c5;
  --accent:#7c5cff;
  --accent2:#39d98a;
  --radius:18px;
  --shadow: 0 22px 70px rgba(0,0,0,.35);
}

*{box-sizing:border-box}
html,body{height:100%}
body{
  margin:0;
  font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial;
  color:var(--text);
  background:
    radial-gradient(1200px 700px at 18% -10%, rgba(124,92,255,.24), transparent 60%),
    radial-gradient(900px 600px at 95% 10%, rgba(57,217,138,.16), transparent 55%),
    linear-gradient(180deg, rgba(255,255,255,.03), transparent 18%),
    var(--bg);
}

a{color:#cdd6ff}
a:hover{opacity:.92}

.wrap{max-width:1020px;margin:0 auto;padding:30px 18px 70px}

.top{
  display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;
  margin-bottom:14px;
}

.brand{display:flex;gap:12px;align-items:center}
.logo{
  width:40px;height:40px;border-radius:14px;
  background:linear-gradient(135deg, rgba(124,92,255,.35), rgba(57,217,138,.18));
  border:1px solid rgba(255,255,255,.12);
  display:flex;align-items:center;justify-content:center;
  font-weight:900;color:var(--text); letter-spacing:.4px;
}
.brand div{line-height:1.15}
.brand .t1{font-weight:900}
.brand .t2{color:var(--muted);font-size:13px}

.pill{
  padding:9px 12px;border-radius:999px;
  border:1px solid rgba(255,255,255,.12);
  background:rgba(255,255,255,.04);
  color:var(--muted);
  font-size:12px;
}

.hero{
  border:1px solid rgba(255,255,255,.12);
  background:linear-gradient(180deg, rgba(255,255,255,.06), rgba(255,255,255,.03));
  border-radius:var(--radius);
  padding:18px;
  box-shadow:var(--shadow);
}

h1{margin:0 0 8px;font-size:24px;letter-spacing:.2px}
.sub{color:var(--muted);font-size:13px;line-height:1.6}
.sub b{color:var(--text)}

.cta{display:flex;gap:10px;flex-wrap:wrap;margin-top:14px}

.btn{
  display:inline-flex;align-items:center;justify-content:center;
  padding:10px 14px;border-radius:14px;
  text-decoration:none;font-weight:800;font-size:13px;
  border:1px solid rgba(124,92,255,.45);
  background: linear-gradient(180deg, rgba(124,92,255,.22), rgba(124,92,255,.12));
  color:var(--text);
  transition: transform .08s ease, filter .08s ease;
}
.btn:hover{transform:translateY(-1px); filter:brightness(1.05)}
.btn:active{transform:translateY(0px)}

.btn2{
  border:1px solid rgba(57,217,138,.35);
  background: linear-gradient(180deg, rgba(57,217,138,.18), rgba(57,217,138,.10));
}

.grid{display:grid;grid-template-columns:1fr;gap:12px;margin-top:12px}
@media(min-width:920px){ .grid{grid-template-columns: 1.15fr .85fr;} }

.card{
  border:1px solid rgba(255,255,255,.12);
  background:rgba(255,255,255,.04);
  border-radius:var(--radius);
  padding:14px;
}
.card h2{margin:0 0 10px;font-size:14px;color:var(--text)}
ul{margin:0;padding-left:18px;color:var(--muted);font-size:13px;line-height:1.6}

.content{
  margin-top:0;
  border:1px solid rgba(255,255,255,.12);
  background:rgba(0,0,0,.16);
  border-radius:var(--radius);
  padding:16px;
  overflow:hidden;
}
.content *{max-width:100%}
.content h1,.content h2,.content h3{color:var(--text)}
.content p,.content li{color:var(--muted)}
.content strong{color:var(--text)}

.foot{
  margin-top:14px;
  color:var(--muted);
  font-size:12px;
  opacity:.95;
}
</style>
</head>
<body>
  <div class="wrap">
    <div class="top">
      <div class="brand">
        <div class="logo">CF</div>
        <div>
          <div style="color:var(--text);font-weight:800">ClinicFlow</div>
          <div>Automation plan • built from your website</div>
        </div>
      </div>
      <div class="pill">Prepared for: <b>${clinicName}</b></div>
    </div>

    <div class="hero">
      <h1>Your 1-page plan is ready ✅</h1>
      <div class="sub">
        This is the exact “first automation” I’d set up for <b>${clinicName}</b>
        to convert more inquiries into booked appointments — without adding work for the front desk.
        ${website ? `<div style="margin-top:6px">Site reviewed: <a href="${website}" target="_blank" rel="noreferrer">${website}</a></div>` : ""}
      </div>

      <div class="cta">
        <a class="btn" href="${emailHref}">Reply by email (recommended)</a>
        ${callBtn}
      </div>
    </div>

    <div class="grid">
      <div class="content">
        ${innerHtml || "<p style='color:#a7b0c5'>Plan content not found.</p>"}
      </div>

      <div>
        <div class="card">
          <h2>What you get (when you say “yes”)</h2>
          <ul>
            <li>Instant response to form submissions (under 60 seconds)</li>
            <li>Missed-call auto text + email follow-up</li>
            <li>Simple 3-touch sequence (Day 0 / Day 1 / Day 3)</li>
            <li>Optional review requests after visits</li>
          </ul>
        </div>

        <div class="card" style="margin-top:12px">
          <h2>Next step</h2>
          <ul>
            <li>Reply with: <b>A) Forms</b>, <b>B) Missed calls</b>, or <b>C) Both (+ Reviews)</b></li>
            <li>I’ll send your exact message pack + setup steps.</li>
          </ul>
        </div>

        <div class="card" style="margin-top:12px">
          <h2>Why email is easiest</h2>
          <ul>
            <li>No call needed — you can approve the plan by email.</li>
            <li>Call is optional if you prefer it.</li>
          </ul>
        </div>
      </div>
    </div>

    <div class="foot">
      ClinicFlow Automation • Contact: <b>${contactEmail || "contact@clinicflowautomation.com"}</b>
    </div>
  </div>
</body>
</html>`;
}

// ---- SMTP transporter ----
let transporter = null;
if (SMTP_ENABLED) {
  transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: SMTP_PORT,
    secure: SMTP_SECURE,
    auth: { user: SMTP_USER, pass: SMTP_PASS },
    tls: { rejectUnauthorized: false },
  });
}

async function sendClinicPackEmail({ clinic }) {
  if (!SMTP_ENABLED || !transporter) return { ok: false, error: "SMTP not configured" };
  const to = String(clinic.contactEmail || "").trim();
  if (!to) return { ok: false, error: "Clinic has no contactEmail" };

  const planUrl = `${BASE_URL}/clinic-plan/${encodeURIComponent(clinic.id)}`;
  const subject = `ClinicFlow — your plan + follow-up message pack (${clinic.clinicName})`;

  const text = `
Hi ${clinic.clinicName} team,

Thanks — your ClinicFlow onboarding is complete ✅

Here’s your 1-page plan:
${planUrl}

Attached:
- plan (HTML + MD)
- message pack (JSON)

If you want, reply with:
A) Forms
B) Missed Calls
C) Both (+ Reviews)
and I’ll tailor the exact automations + messages.

Best,
Mohamed
${SMTP_FROM}
`.trim();

  const attachments = [];

  const planPath = String(clinic.planPath || "").trim();
  const planHtmlPath = String(clinic.planHtmlPath || "").trim();

  if (planPath && fs.existsSync(planPath)) attachments.push({ filename: `plan.${clinic.id}.md`, path: planPath });
  if (planHtmlPath && fs.existsSync(planHtmlPath)) attachments.push({ filename: `plan.${clinic.id}.html`, path: planHtmlPath });

  if (clinic.templates) {
    attachments.push({
      filename: `templates.${clinic.id}.json`,
      content: JSON.stringify(clinic.templates, null, 2),
      contentType: "application/json",
    });
  }

  await transporter.sendMail({ from: SMTP_FROM, to, subject, text, attachments });
  return { ok: true };
}

// ===== Admin auth =====
const ADMIN_KEY = (process.env.ADMIN_KEY || "").trim();
const ADMIN_BASIC_USER = (process.env.ADMIN_BASIC_USER || "").trim();
const ADMIN_BASIC_PASS = (process.env.ADMIN_BASIC_PASS || "").trim();

function parseBasicAuth(req) {
  const h = String(req.headers.authorization || "");
  if (!h.startsWith("Basic ")) return null;
  try {
    const raw = Buffer.from(h.slice(6), "base64").toString("utf8");
    const idx = raw.indexOf(":");
    if (idx === -1) return null;
    return { user: raw.slice(0, idx), pass: raw.slice(idx + 1) };
  } catch {
    return null;
  }
}

function requireAdmin(req, res) {
  // In production: ADMIN_KEY must exist
  if (process.env.NODE_ENV === "production" && !ADMIN_KEY) {
    res.status(500).json({ ok: false, error: "Server misconfigured: ADMIN_KEY missing" });
    return false;
  }

  // 1) API header key
  const key = String(req.headers["x-admin-key"] || "").trim();
  if (ADMIN_KEY && key === ADMIN_KEY) return true;

  // 2) Browser Basic Auth (nice for visiting / and /admin)
  if (ADMIN_BASIC_USER && ADMIN_BASIC_PASS) {
    const creds = parseBasicAuth(req);
    if (creds && creds.user === ADMIN_BASIC_USER && creds.pass === ADMIN_BASIC_PASS) return true;

    res.set("WWW-Authenticate", 'Basic realm="ClinicFlow Admin"');
    res.status(401).send("Unauthorized");
    return false;
  }

  // If no basic auth configured, require header key
  res.status(401).json({ ok: false, error: "Unauthorized (missing/invalid admin credentials)" });
  return false;
}
// Admin: send pack email
app.post("/api/send-clinic-pack/:id", async (req, res) => {
  if (!requireAdmin(req, res)) return;

  const id = String(req.params.id || "").trim();
  const clinics = loadClinics();
  const clinic = clinics[id];
  if (!clinic) return res.status(404).json({ ok: false, error: "Clinic not found" });

  try {
    const r = await sendClinicPackEmail({ clinic });
    if (!r.ok) return res.status(400).json(r);

    clinic.packSentAt = new Date().toISOString();
    clinics[id] = clinic;
    saveClinics(clinics);

    return res.json({ ok: true, id, packSentAt: clinic.packSentAt });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e?.message || String(e) });
  }
});

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function todayKey() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}
function readSendLog() {
  try {
    if (!fs.existsSync(SEND_LOG_PATH)) return {};
    return JSON.parse(fs.readFileSync(SEND_LOG_PATH, "utf-8"));
  } catch {
    return {};
  }
}
function writeSendLog(obj) {
  fs.mkdirSync(path.dirname(SEND_LOG_PATH), { recursive: true });
  fs.writeFileSync(SEND_LOG_PATH, JSON.stringify(obj, null, 2), "utf-8");
}
function getTodayCount() {
  const log = readSendLog();
  return Number(log[todayKey()] || 0);
}
function incTodayCount() {
  const log = readSendLog();
  const k = todayKey();
  log[k] = Number(log[k] || 0) + 1;
  writeSendLog(log);
  return log[k];
}
function remainingToday() {
  return Math.max(0, MAX_EMAILS_PER_DAY - getTodayCount());
}

async function verifySmtpOnce() {
  if (!transporter) return;

  const timeout = new Promise((_, rej) => setTimeout(() => rej(new Error("SMTP verify timeout")), 5000));

  try {
    await Promise.race([transporter.verify(), timeout]);
    console.log("SMTP verify OK");
  } catch (err) {
    console.log("SMTP verify failed:", err?.message || err);
  }
}
setTimeout(() => {
  verifySmtpOnce().catch(() => {});
}, 0);
// ---- SAFETY: validate ids used in file paths ----
const SAFE_ID = /^[a-f0-9]{12}$/i; // your ids are md5 slice(0,12)

function assertSafeId(id) {
  const s = String(id || "").trim();
  if (!SAFE_ID.test(s)) return null;
  return s.toLowerCase();
}
// ---- HELPERS ----
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
function readJsonObjectSafe(filePath, fallback = {}) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, "utf-8")) || fallback;
  } catch {
    return fallback;
  }
}
function writeJsonObjectSafe(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
}

function makeId(obj) {
  const input = `${obj.clinicName || ""}__${obj.website || ""}`.toLowerCase();
  return crypto.createHash("md5").update(input).digest("hex").slice(0, 12);
}
function domainFromWebsite(website) {
  try {
    const u = new URL(website);
    return u.hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}
function suggestionsFromWebsite(website) {
  const d = domainFromWebsite(website);
  if (!d) return [];
  return [`contact@${d}`, `info@${d}`, `hello@${d}`, `office@${d}`, `appointments@${d}`];
}

function normalizeRecord(r) {
  const safe = r || {};
  const clinicName = safe.clinicName || safe.name || "Dental Clinic";
  const website = safe.website || "";
  const id = safe.id || makeId({ clinicName, website });

  const email = String(safe.email || "").trim();
  const contactPage = String(safe.contactPage || "").trim();

  const status = safe.status || "todo";
  const method = email ? "email" : contactPage ? "contact_form" : safe.method || "manual";

  const planPath = String(safe.planPath || "").trim();
  const planHtmlPath = String(safe.planHtmlPath || "").trim();

  return {
    ...safe,
    id,
    clinicName,
    website,
    status,
    method,
    email,
    contactPage,
    notes: safe.notes || "",
    sentAt: safe.sentAt || "",
    followupDueAt: safe.followupDueAt || "",
    enrichedAt: safe.enrichedAt || "",
    discoveredAt: safe.discoveredAt || "",
    source: safe.source || "",
    planPath,
    planHtmlPath,
    planGeneratedAt: safe.planGeneratedAt || "",
    suggestedEmails: suggestionsFromWebsite(website),
  };
}

// ---- LIGHT CACHE for leads (helps /api/leads speed) ----
let _leadsCache = { mtimeMs: 0, data: [] };

function loadOutreach() {
  let stat = null;
  try {
    stat = fs.existsSync(OUTREACH_PATH) ? fs.statSync(OUTREACH_PATH) : null;
  } catch {}

  const mtimeMs = stat?.mtimeMs || 0;

  if (_leadsCache.data?.length && _leadsCache.mtimeMs === mtimeMs) {
    // still normalize to keep suggestedEmails consistent
    return (_leadsCache.data || []).map(normalizeRecord);
  }

  const data = readJsonSafe(OUTREACH_PATH, []);
  const normalized = (data || []).map(normalizeRecord);

  // save back only if needed (strip suggestedEmails)
  const stripped = normalized.map(({ suggestedEmails, ...rest }) => rest);
  const changed = JSON.stringify(data) !== JSON.stringify(stripped);
  if (changed) writeJsonSafe(OUTREACH_PATH, stripped);

  _leadsCache = { mtimeMs, data: stripped };
  return normalized;
}
function saveOutreach(list) {
  const toSave = (list || []).map(({ suggestedEmails, ...rest }) => rest);
  writeJsonSafe(OUTREACH_PATH, toSave);
  try {
    const stat = fs.existsSync(OUTREACH_PATH) ? fs.statSync(OUTREACH_PATH) : null;
    _leadsCache = { mtimeMs: stat?.mtimeMs || Date.now(), data: toSave };
  } catch {
    _leadsCache = { mtimeMs: Date.now(), data: toSave };
  }
}

// ---- MESSAGE BUILDERS ----
function buildSubject(lead) {
  const name = (lead.clinicName || "your clinic").trim();
  return `${name} — quick question`;
}
function buildEmailBody(lead) {
  const clinicName = (lead.clinicName || "your clinic").trim();
  const website = (lead.website || "").trim();
  const planLink = `${BASE_URL}/plan/${encodeURIComponent(lead.id)}`;
  const replyEmail = SMTP_FROM || "contact@clinicflowautomation.com";

  return `Hi ${clinicName} team,

I put together a quick 1-page follow-up plan based on your site (${website}).
It focuses on: faster replies to new inquiries + a simple 2-step follow-up.

Plan link:
${planLink}

If you want it tailored, just reply with:
A) Forms
B) Missed Calls
C) Both (+ Reviews)

Email is totally fine (recommended). Optional call only if you prefer.

Best,
Mohamed
ClinicFlow Automation
${replyEmail}`.trim();
}
function isPublicRoute(req) {
  const p = req.path || "";

  // Public pages
  if (p === "/start") return true;
  if (p === "/api/onboard-clinic") return true;

  // Public plan viewing links
  if (p.startsWith("/plan/")) return true;
  if (p.startsWith("/clinic-plan/")) return true;
  if (p.startsWith("/clinic-plan-md/")) return true;

  if (p === "/health") return true;
  if (p === "/track") return true;          // email click-tracking — must be public
  if (p === "/webhooks/sms-inbound")   return true;  // Twilio inbound SMS
  if (p === "/webhooks/call-inbound")  return true;  // Twilio inbound call
  if (p === "/webhooks/call-recording") return true; // Twilio recording/transcription
  if (p.startsWith("/webhooks/missed-call/")) return true;  // ClinicFlow missed call follow-up
  if (p.startsWith("/webhooks/patient-reply/")) return true; // Patient SMS reply handler
  if (p === "/intelligence") return true;   // intelligence dashboard (password-protected in JS)
  if (p.startsWith("/data/intelligence/")) return true; // JSON feeds for dashboard
  if (p === "/api/portal") return true;
  return false;
}

// Everything not public requires admin in production
app.use((req, res, next) => {
  if (isPublicRoute(req)) return next();
  if (!requireAdmin(req, res)) return;
  return next();
});
const adminLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 300, // admin can do more
  standardHeaders: true,
  legacyHeaders: false,
});

app.use("/api", adminLimiter);
// ---- API ----
app.get("/api/leads", (req, res) => {
  const leads = loadOutreach();
  res.json({ ok: true, count: leads.length, leads });
});

app.get("/api/stats", (req, res) => {
  res.json({
    ok: true,
    smtpEnabled: SMTP_ENABLED,
    discoverEnabled: DISCOVER_ENABLED,
    discoverScript: DISCOVER_SCRIPT || "",
    today: todayKey(),
    maxEmailsPerDay: MAX_EMAILS_PER_DAY,
    sentToday: getTodayCount(),
    remainingToday: remainingToday(),
    followupDelayDays: FOLLOWUP_DELAY_DAYS,
    opens: (() => {
      try {
        const o = JSON.parse(fs.readFileSync('data/opens.json', 'utf8'));
        const byVariant = {};
        o.forEach(e => { byVariant[e.variant] = (byVariant[e.variant]||0)+1; });
        return { total: o.length, byVariant, recent: o.slice(-5) };
      } catch { return { total: 0, byVariant: {}, recent: [] }; }
    })()});
});

app.post("/api/leads/:id", (req, res) => {
  const { id } = req.params;
  const patch = req.body || {};

  const leads = loadOutreach();
  const idx = leads.findIndex((l) => l.id === id);
  if (idx === -1) return res.status(404).json({ ok: false, error: "Not found" });

  const allowed = ["email", "status", "notes", "contactPage"];
  for (const k of allowed) {
    if (k in patch) leads[idx][k] = patch[k] ?? "";
  }

  leads[idx] = normalizeRecord(leads[idx]);
  saveOutreach(leads);

  res.json({ ok: true, lead: leads[idx] });
});

// ---- GENERATE / READ 1-PAGE PLAN (NO EMAIL SEND) ----
app.post("/api/plan/:id", async (req, res) => {
  const id = assertSafeId(req.params.id);
  if (!id) return res.status(400).json({ ok:false, error:"Bad id" });

  const leads = loadOutreach();
  const idx = leads.findIndex((l) => l.id === id);
  if (idx === -1) return res.status(404).json({ ok: false, error: "Lead not found" });

  const lead = leads[idx];
  if (!lead.website) return res.status(400).json({ ok: false, error: "Lead has no website" });

  try {
    const result = await generateOnePagePlan({
      clinicName: lead.clinicName || lead.name || "Clinic",
      website: lead.website,
      contactEmail: PUBLIC_CONTACT_EMAIL,
      bookCallUrl: PUBLIC_BOOK_CALL_URL,
    });

    if (!result?.ok) {
      const msg = result?.error || "Plan generation failed";
      leads[idx].lastError = msg;
      saveOutreach(leads);
      return res.status(500).json({ ok: false, error: msg });
    }

    fs.mkdirSync(PLANS_DIR, { recursive: true });

    const mdPath = path.join(PLANS_DIR, `${id}.md`);
    fs.writeFileSync(mdPath, String(result.planMd || ""), "utf-8");

    const htmlPath = path.join(PLANS_DIR, `${id}.html`);
    fs.writeFileSync(htmlPath, String(result.planHtml || ""), "utf-8");

    leads[idx].planPath = mdPath;
    leads[idx].planHtmlPath = htmlPath;
    leads[idx].planGeneratedAt = new Date().toISOString();
    leads[idx] = normalizeRecord(leads[idx]);
    saveOutreach(leads);

    return res.json({
      ok: true,
      id,
      planPath: mdPath,
      planHtmlPath: htmlPath,
      planPreview: String(result.planMd || "").slice(0, 800),
      lead: leads[idx],
    });
  } catch (e) {
    const msg = e?.message || String(e);
    leads[idx].lastError = msg;
    saveOutreach(leads);
    return res.status(500).json({ ok: false, error: msg });
  }
});
app.get("/health", (req, res) => {
  res.json({ ok: true });
});

app.get("/api/plan/:id", (req, res) => {
  const id = assertSafeId(req.params.id);
  if (!id) return res.status(400).json({ ok:false, error:"Bad id" });
   const leads = loadOutreach();
  const lead = leads.find((l) => l.id === id);
  if (!lead) return res.status(404).json({ ok: false, error: "Lead not found" });

  const p = String(lead.planPath || "").trim();
  if (!p) return res.status(404).json({ ok: false, error: "No plan generated yet" });

  try {
    if (!fs.existsSync(p)) return res.status(404).json({ ok: false, error: "Plan file missing on disk" });
    const planMd = fs.readFileSync(p, "utf-8");
    return res.json({ ok: true, id, planMd });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e?.message || String(e) });
  }
});

// Public: serve LEAD plan HTML
// Public: serve LEAD plan HTML (themed)
app.get("/plan/:id", (req, res) => {
  const id = assertSafeId(req.params.id);
  if (!id) return res.status(400).send("Bad id");

  const leads = loadOutreach();
  const lead = leads.find((l) => l.id === id);
  if (!lead) return res.status(404).send("Lead not found");

  const htmlPath = path.join(PLANS_DIR, `${id}.html`);
  if (!fs.existsSync(htmlPath)) return res.status(404).send("Plan not generated yet");

  let inner = fs.readFileSync(htmlPath, "utf-8");

  // Keep your injected globals (used by some generated templates)
  const inject = `
<script>
  var bookCallUrl = ${JSON.stringify(PUBLIC_BOOK_CALL_URL || "")};
  var contactEmail = ${JSON.stringify(PUBLIC_CONTACT_EMAIL || SMTP_FROM || "")};
</script>`.trim();

  // Put injection at top of plan HTML content (safe)
  inner = `${inject}\n${inner}`;

  // Wrap in your consistent theme chrome
  const themed = wrapPlanHtml({
    clinic: {
      clinicName: lead.clinicName || "Clinic",
      website: lead.website || "",
      contactEmail: PUBLIC_CONTACT_EMAIL || SMTP_FROM || "",
      bookingLink: PUBLIC_BOOK_CALL_URL || "",
    },
    innerHtml: inner,
  });

  res.set("Content-Type", "text/html; charset=utf-8");
  res.send(themed);
});
app.post("/api/reply/:id", async (req, res) => {
  const { id } = req.params;
  const incomingText = String(req.body?.text || "");

  const leads = loadOutreach();
  const lead = leads.find((l) => l.id === id);
  if (!lead) return res.status(404).json({ ok: false, error: "Lead not found" });

  let planPreview = "";
  try {
    const p = String(lead.planPath || "").trim();
    if (p && fs.existsSync(p)) planPreview = fs.readFileSync(p, "utf-8").slice(0, 1200);
  } catch {}

  const out = generateReplyEmail({ lead, incomingText, planPreview });

  lead.notes = (lead.notes ? lead.notes + "\n\n" : "") + `Reply received:\n${incomingText}`;
  saveOutreach(leads);

  return res.json({ ok: true, subject: out.subject, text: out.text });
});

// ---- SEND SMTP ----
app.post("/api/send/:id", async (req, res) => {
  const { id } = req.params;

  if (!SMTP_ENABLED || !transporter) {
    return res.status(400).json({ ok: false, error: "SMTP not configured (.env missing)" });
  }
  if (remainingToday() <= 0) {
    return res.status(429).json({
      ok: false,
      error: `Daily limit reached (${MAX_EMAILS_PER_DAY}/day). Try tomorrow.`,
    });
  }

  const leads = loadOutreach();
  const idx = leads.findIndex((l) => l.id === id);
  if (idx === -1) return res.status(404).json({ ok: false, error: "Lead not found" });

  const lead = leads[idx];
  if (!lead.email) return res.status(400).json({ ok: false, error: "No email set for this lead" });

  const subject = buildSubject(lead);
  const text = buildEmailBody(lead);

  try {
    await transporter.sendMail({ from: SMTP_FROM, to: lead.email, subject, text });

    lead.status = "sent";
    lead.sentAt = new Date().toISOString();

    const due = new Date();
    due.setDate(due.getDate() + FOLLOWUP_DELAY_DAYS);
    lead.followupDueAt = due.toISOString();

    incTodayCount();

    leads[idx] = normalizeRecord(lead);
    saveOutreach(leads);

    res.json({
      ok: true,
      sentToday: getTodayCount(),
      remainingToday: remainingToday(),
      lead: leads[idx],
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: err?.message || "Send failed" });
  }
});

// ---- ENRICH (EMAIL + CONTACT PAGE) ----
let ENRICH_RUNNING = false;

app.post("/api/enrich", async (req, res) => {
  if (ENRICH_RUNNING) return res.status(409).json({ ok: false, error: "Enrich already running" });

  const limit = Math.max(1, Math.min(50, Number(req.query.limit || "10")));
  const delayMs = Math.max(200, Math.min(5000, Number(req.query.delayMs || "900")));

  const leads = loadOutreach();

  const targets = leads
    .filter((l) => (l.status || "todo") === "todo")
    .filter((l) => l.website)
    .filter((l) => !String(l.email || "").trim() || !String(l.contactPage || "").trim())
    .slice(0, limit);

  ENRICH_RUNNING = true;

  let scanned = targets.length;
  let updated = 0;
  let foundEmail = 0;
  let foundContact = 0;

  try {
    for (const lead of targets) {
      try {
        if (!String(lead.contactPage || "").trim()) {
          const c = await findContactPageUrl(lead.website);
          if (c) {
            lead.contactPage = c;
            foundContact++;
          }
          await sleep(delayMs);
        }

        if (!String(lead.email || "").trim()) {
          const best = await findBestEmailOnWebsite(lead.website);
          if (best) {
            lead.email = best;
            foundEmail++;
          }
          await sleep(delayMs);
        }

        lead.enrichedAt = new Date().toISOString();
        updated++;
      } catch (e) {
        lead.notes = (lead.notes ? lead.notes + "\n" : "") + `Enrich error: ${e?.message || e}`;
        lead.lastError = e?.message || String(e);
      }
    }

    const normalized = leads.map(normalizeRecord);
    saveOutreach(normalized);

    return res.json({
      ok: true,
      scanned,
      updated,
      foundEmail,
      foundContact,
      remainingMissingEmail: normalized.filter((l) => l.website && !String(l.email || "").trim()).length,
      remainingMissingContact: normalized.filter((l) => l.website && !String(l.contactPage || "").trim()).length,
    });
  } finally {
    ENRICH_RUNNING = false;
  }
});

// ---- DISCOVER NEW LEADS ----
app.post("/api/discover", async (req, res) => {
  if (!DISCOVER_ENABLED || !DISCOVER_SCRIPT) {
    return res.status(400).json({
      ok: false,
      error: "localBusinesses.js not found. Put it in project root OR src/scrapers/",
    });
  }

  const city = (req.body?.city || "").trim();
  const prov = (req.body?.prov || "").trim();

  const args = [DISCOVER_SCRIPT];
  if (city && prov) args.push(city, prov);

  const run = spawn(process.execPath, args, {
    cwd: process.cwd(),
    stdio: ["ignore", "pipe", "pipe"],
  });

  let out = "";
  let err = "";
  run.stdout.on("data", (d) => (out += d.toString()));
  run.stderr.on("data", (d) => (err += d.toString()));

  run.on("close", (code) => {
    if (code !== 0) {
      return res.status(500).json({ ok: false, error: "Discover script failed", details: err || out });
    }

    const businessesPath = path.join(process.cwd(), "data", "local.businesses.json");
    const businesses = readJsonSafe(businessesPath, []);

    const leads = loadOutreach();
    const existing = new Set(leads.map((l) => (l.website || "").toLowerCase()).filter(Boolean));

    let added = 0;
    for (const b of businesses) {
      const website = String(b.website || "").trim();
      if (!website) continue;

      const key = website.toLowerCase();
      if (existing.has(key)) continue;

      leads.push(
        normalizeRecord({
          clinicName: b.name || "Clinic",
          website,
          city: b.city || "",
          province: b.province || "",
          score: b.score ?? null,
          tier: b.tier ?? null,
          email: b.email || "",
          contactPage: "",
          status: "todo",
          notes: "Discovered by localBusinesses.js",
          discoveredAt: b.foundAt || new Date().toISOString(),
          source: b.source || "overpass",
        })
      );

      existing.add(key);
      added++;
    }

    saveOutreach(leads);

    return res.json({
      ok: true,
      discoverScript: DISCOVER_SCRIPT,
      discoverOutput: out.trim().slice(0, 4000),
      added,
      totalLeads: leads.length,
    });
  });
});

// Public: client portal status (password = clinic slug)
app.get("/api/portal", (req, res) => {
  res.set("Access-Control-Allow-Origin", "*");

  const slug = String(req.query.slug || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  if (!slug) return res.status(401).json({ error: "Invalid access code" });

  const CLIENTS_PATH = path.join(process.cwd(), "data", "clients.json");
  const clients = readJsonSafe(CLIENTS_PATH, []);

  const client = clients.find(c => {
    const clientSlug = String(c.name || "").toLowerCase().replace(/[^a-z0-9]/g, "");
    return clientSlug === slug;
  });

  if (!client) return res.status(401).json({ error: "Invalid access code" });

  return res.json({
    clinicName: client.name || "",
    stage: client.stage || "payment",
    paymentReceived: client.paymentReceived ?? false,
    csvReceived: client.csvReceived ?? false,
    campaignBuilt: client.campaignBuilt ?? false,
    systemLive: client.systemLive ?? false,
    goLiveDate: client.goLiveDate || "",
    automations: client.automations || { reactivation: "pending", reminders: "pending", missedCall: "pending" },
    nextAction: client.nextAction || "",
    mohamedEmail: "contact@clinicflowautomation.com",
    mohamedPhone: "438-544-0442",
  });
});

// ===== LAYER 2: ONBOARDING + CLINIC CONFIG + ACTIVATION =====
function makeClinicId({ clinicName = "", website = "" }) {
  const input = `${clinicName}__${website}`.toLowerCase();
  return crypto.createHash("md5").update(input).digest("hex").slice(0, 12);
}

function normalizeClinicConfig(input = {}) {
  const clinicName = String(input.clinicName || "").trim() || "Clinic";
  const website = String(input.website || "").trim();
  const id = String(input.id || "").trim() || makeClinicId({ clinicName, website });

  const modules = input.modules || {};
  return {
    id,
    clinicName,
    website,
    city: String(input.city || "").trim(),
    province: String(input.province || "").trim(),
    timezone: String(input.timezone || "America/Toronto").trim(),

    contactEmail: String(input.contactEmail || "").trim(),
    bookingLink: String(input.bookingLink || "").trim(),
    phoneNumber: String(input.phoneNumber || "").trim(),
    reviewLink: String(input.reviewLink || "").trim(),

    tone: String(input.tone || "friendly").trim(),
    modules: {
      forms: Boolean(modules.forms ?? true),
      missedCalls: Boolean(modules.missedCalls ?? true),
      reviews: Boolean(modules.reviews ?? false),
    },

    goal: String(input.goal || "more bookings").trim(),
    status: String(input.status || "pending").trim(),

    createdAt: String(input.createdAt || new Date().toISOString()),
    activatedAt: String(input.activatedAt || ""),

    templates: input.templates || null,
    planPath: String(input.planPath || ""),
    planHtmlPath: String(input.planHtmlPath || ""),
  };
}

function loadClinics() {
  const obj = readJsonObjectSafe(CLINICS_PATH, {});
  return obj && typeof obj === "object" ? obj : {};
}
function saveClinics(obj) {
  writeJsonObjectSafe(CLINICS_PATH, obj || {});
}

// Public onboarding page
app.get("/start", (req, res) => {
  res.set("Content-Type", "text/html; charset=utf-8");
  res.send(`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>ClinicFlow — Start</title>
<style>
:root{
  --bg:#0b0f17;
  --card:rgba(255,255,255,.06);
  --line:rgba(255,255,255,.12);
  --text:#e8eefc;
  --muted:#a7b0c5;
  --accent:#7c5cff;
  --good:#39d98a;
  --bad:#ef4444;
  --radius:18px;
  --shadow: 0 22px 70px rgba(0,0,0,.35);
}

*{box-sizing:border-box}
html,body{height:100%}

body{
  margin:0;
  padding:34px 18px;
  font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial;
  background:
    radial-gradient(1200px 700px at 18% -10%, rgba(124,92,255,.25), transparent 60%),
    radial-gradient(1000px 600px at 92% 10%, rgba(57,217,138,.16), transparent 60%),
    var(--bg);
  color:var(--text);
}

.wrap{max-width:900px;margin:0 auto}
.card{
  background:linear-gradient(180deg, rgba(255,255,255,.06), rgba(255,255,255,.03));
  border:1px solid var(--line);
  border-radius:var(--radius);
  padding:18px;
  box-shadow:var(--shadow);
}

h1{margin:0 0 8px;font-size:22px;letter-spacing:.2px}
.sub{color:var(--muted);font-size:13px;line-height:1.6;margin-bottom:16px}

label{display:block;color:var(--muted);font-size:12px;margin:12px 0 6px}

input, select{
  width:100%;
  background:rgba(255,255,255,.04);
  border:1px solid rgba(255,255,255,.12);
  border-radius:14px;
  padding:11px 12px;
  color:var(--text);
  outline:none;
  font:inherit;
}

input:focus, select:focus{
  border-color: rgba(124,92,255,.55);
  box-shadow: 0 0 0 4px rgba(124,92,255,.16);
}

.row{display:grid;grid-template-columns:1fr;gap:12px}
@media(min-width:820px){ .row{grid-template-columns:1fr 1fr} }

.checks{display:flex;gap:12px;flex-wrap:wrap;margin-top:10px}
.check{
  border:1px solid rgba(255,255,255,.12);
  border-radius:14px;
  padding:10px 12px;
  background:rgba(255,255,255,.04);
  display:flex;gap:10px;align-items:center;
  color:var(--muted);font-size:13px;
}
.check input{accent-color: var(--accent)}

.btn{
  margin-top:16px;
  width:100%;
  background: linear-gradient(180deg, rgba(124,92,255,.24), rgba(124,92,255,.12));
  border:1px solid rgba(124,92,255,.45);
  border-radius:14px;
  padding:12px 12px;
  cursor:pointer;
  color:var(--text);
  font:inherit;
  font-weight:800;
  transition: transform .08s ease, filter .08s ease;
}
.btn:hover{transform: translateY(-1px); filter:brightness(1.05)}
.btn:disabled{opacity:.6; cursor:not-allowed; transform:none}

.ok{margin-top:14px;color:var(--good);font-size:13px}
.err{margin-top:14px;color:var(--bad);font-size:13px}
</style>
</head>
<body>
  <div class="wrap">
    <div class="card">
      <h1>ClinicFlow — Start</h1>
      <div class="sub">
        Fill this once. We’ll configure your follow-up engine and send back a one-page plan + message pack.
      </div>

      <div class="row">
        <div><label>Clinic name</label><input id="clinicName" placeholder="e.g., Smile Directory" /></div>
        <div><label>Website</label><input id="website" placeholder="https://example.com" /></div>
        <div><label>City</label><input id="city" placeholder="Toronto" /></div>
        <div><label>Province</label><input id="province" placeholder="ON" /></div>
        <div><label>Contact email (for updates)</label><input id="contactEmail" placeholder="office@example.com" /></div>
        <div><label>Timezone</label><input id="timezone" value="America/Toronto" /></div>
        <div><label>Booking link (optional)</label><input id="bookingLink" placeholder="https://..." /></div>
        <div><label>Review link (optional)</label><input id="reviewLink" placeholder="https://..." /></div>
        <div>
          <label>Tone</label>
          <select id="tone">
            <option value="friendly">Friendly</option>
            <option value="formal">Formal</option>
          </select>
        </div>
        <div>
          <label>Main goal</label>
          <select id="goal">
            <option value="more bookings">More bookings</option>
            <option value="faster response">Faster response</option>
            <option value="more reviews">More reviews</option>
          </select>
        </div>
      </div>

      <label>Modules</label>
      <div class="checks">
        <label class="check"><input type="checkbox" id="mForms" checked /> Forms</label>
        <label class="check"><input type="checkbox" id="mMissed" checked /> Missed calls</label>
        <label class="check"><input type="checkbox" id="mReviews" /> Reviews</label>
      </div>

      <button class="btn" id="submitBtn">Submit onboarding</button>
      <div id="msg"></div>
    </div>
  </div>

<script>
  const el = (id)=>document.getElementById(id);
  el("submitBtn").addEventListener("click", async ()=>{
    el("submitBtn").disabled = true;
    el("msg").textContent = "";
    try{
      const payload = {
        clinicName: el("clinicName").value.trim(),
        website: el("website").value.trim(),
        city: el("city").value.trim(),
        province: el("province").value.trim(),
        contactEmail: el("contactEmail").value.trim(),
        timezone: el("timezone").value.trim(),
        bookingLink: el("bookingLink").value.trim(),
        reviewLink: el("reviewLink").value.trim(),
        tone: el("tone").value,
        goal: el("goal").value,
        modules: { forms: el("mForms").checked, missedCalls: el("mMissed").checked, reviews: el("mReviews").checked }
      };

      const res = await fetch("/api/onboard-clinic", {
        method:"POST",
        headers:{ "Content-Type":"application/json" },
        body: JSON.stringify(payload)
      });
      const json = await res.json();
      if(!json.ok) throw new Error(json.error || "Onboarding failed");
      el("msg").innerHTML = '<div class="ok">Submitted ✅ Your reference ID: <b>'+json.id+'</b></div>';
    }catch(e){
      el("msg").innerHTML = '<div class="err">'+(e?.message || e)+'</div>';
    }finally{
      el("submitBtn").disabled = false;
    }
  });
</script>
</body>
</html>`);
});

// Create/Update clinic onboarding (public)
app.post("/api/onboard-clinic", (req, res) => {
  const clinic = normalizeClinicConfig(req.body || {});

  if (!clinic.website || !/^https?:\/\//i.test(clinic.website)) {
    return res.status(400).json({ ok: false, error: "Website must start with http(s)://" });
  }
  if (!clinic.clinicName || clinic.clinicName.length < 2) {
    return res.status(400).json({ ok: false, error: "Clinic name is required" });
  }

  const clinics = loadClinics();
  clinics[clinic.id] = clinic;
  saveClinics(clinics);

  return res.json({ ok: true, id: clinic.id, clinic });
});

// Admin: list clinics
app.get("/api/clinics", (req, res) => {
  if (!requireAdmin(req, res)) return;
  const clinics = loadClinics();
  const list = Object.values(clinics).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  res.json({ ok: true, count: list.length, clinics: list });
});

// Admin: activate clinic (generate templates + plan)
app.post("/api/activate-clinic/:id", async (req, res) => {
  if (!requireAdmin(req, res)) return;

  const id = String(req.params.id || "").trim();
  const clinics = loadClinics();
  const clinic = clinics[id];
  if (!clinic) return res.status(404).json({ ok: false, error: "Clinic not found" });

  try {
    let planResult = null;
    if (clinic.website) {
      planResult = await generateOnePagePlan({
        clinicName: clinic.clinicName,
        website: clinic.website,
        contactEmail: PUBLIC_CONTACT_EMAIL,
        bookCallUrl: PUBLIC_BOOK_CALL_URL,
      });
    }

    const templates = buildTemplatePack(clinic);

    let planPath = String(clinic.planPath || "");
    let planHtmlPath = String(clinic.planHtmlPath || "");

    if (planResult?.ok) {
      fs.mkdirSync(PLANS_DIR, { recursive: true });
      planPath = path.join(PLANS_DIR, `clinic.${id}.md`);
      planHtmlPath = path.join(PLANS_DIR, `clinic.${id}.html`);
      fs.writeFileSync(planPath, String(planResult.planMd || ""), "utf-8");
      fs.writeFileSync(planHtmlPath, String(planResult.planHtml || ""), "utf-8");
    }

    const updated = normalizeClinicConfig({
      ...clinic,
      status: "active",
      activatedAt: new Date().toISOString(),
      templates,
      planPath,
      planHtmlPath,
    });

    clinics[id] = updated;
    saveClinics(clinics);

    return res.json({ ok: true, id, clinic: updated, planOk: !!planResult?.ok });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e?.message || String(e) });
  }
});

// Serve clinic plan HTML (public link)
app.get("/clinic-plan/:id", (req, res) => {
  const id = String(req.params.id || "").trim();
  const clinics = loadClinics();
  const clinic = clinics[id];
  if (!clinic) return res.status(404).send("Clinic not found");

  const p = String(clinic.planHtmlPath || "").trim();
  if (!p || !fs.existsSync(p)) return res.status(404).send("Plan not generated");

  res.set("Content-Type", "text/html; charset=utf-8");
  const inner = fs.readFileSync(p, "utf-8");
  res.send(wrapPlanHtml({ clinic, innerHtml: inner }));
});

// Serve clinic plan MD (optional)
app.get("/clinic-plan-md/:id", (req, res) => {
  const id = String(req.params.id || "").trim();
  const clinics = loadClinics();
  const clinic = clinics[id];
  if (!clinic) return res.status(404).send("Clinic not found");

  const p = String(clinic.planPath || "").trim();
  if (!p || !fs.existsSync(p)) return res.status(404).send("Plan not generated");

  res.set("Content-Type", "text/plain; charset=utf-8");
  res.send(fs.readFileSync(p, "utf-8"));
});

// ===== UI (optimized for speed) =====
app.get("/", (req, res) => {
  const SMTP_FROM_JS = JSON.stringify(SMTP_FROM || "");
  const BASE_URL_JS = JSON.stringify(BASE_URL || "");
  res.set("Content-Type", "text/html; charset=utf-8");

  res.send(`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>ORE Outreach Panel</title>
<style>
 :root{
  --bg:#070A12;
  --panel: rgba(255,255,255,.06);
  --panel2: rgba(255,255,255,.04);
  --line: rgba(255,255,255,.10);

  --text:#EAF0FF;
  --muted:#A8B1C7;

  --brand:#7C5CFF;
  --brand2:#5B8CFF;

  --good:#37D997;
  --warn:#F6B04D;
  --bad:#FF5C7A;

  --radius: 16px;
  --shadow: 0 18px 60px rgba(0,0,0,.40);
}

*{box-sizing:border-box}
html,body{height:100%}
body{
  margin:0;
  font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial;
  font-size:14px;
  line-height:1.35;
  color:var(--text);
  background:
    radial-gradient(900px 500px at 15% -10%, rgba(124,92,255,.18), transparent 60%),
    radial-gradient(900px 500px at 95% 0%, rgba(91,140,255,.12), transparent 55%),
    var(--bg);
}

/* Links */
.meta a{color:#C9D3FF;text-decoration:none}
.meta a:hover{text-decoration:underline}

/* Header */
header{
  position: sticky;
  top: 0;
  z-index: 30;
  padding: 16px 18px 12px;
  backdrop-filter: blur(10px);
  background: linear-gradient(180deg, rgba(7,10,18,.92), rgba(7,10,18,.65));
  border-bottom: 1px solid rgba(255,255,255,.08);
}

.headerInner{
  max-width: 1380px;
  margin: 0 auto;
  display:flex;
  align-items:flex-end;
  justify-content:space-between;
  gap:12px;
}

h1{margin:0;font-size:18px;letter-spacing:.2px;font-weight:900}
.sub{margin:6px 0 0;color:var(--muted);font-size:12.5px}

.pill{
  padding: 8px 12px;
  border:1px solid rgba(255,255,255,.10);
  background: rgba(255,255,255,.04);
  border-radius: 999px;
  color: var(--muted);
  font-size: 12px;
  white-space: nowrap;
}

/* Main layout */
main{max-width:1380px;margin:0 auto;padding:14px 18px 50px}
.grid{display:grid;grid-template-columns:repeat(12,1fr);gap:14px}

/* Toolbar */
.bar{
  display:flex;
  flex-wrap:wrap;
  gap:10px;
  align-items:center;
  padding:12px;
  border-radius: var(--radius);
  background: rgba(255,255,255,.035);
  border: 1px solid rgba(255,255,255,.08);
}

input, select, textarea, button{font:inherit;color:inherit}

.search, .select{
  background: rgba(255,255,255,.035);
  border: 1px solid rgba(255,255,255,.10);
  border-radius: 12px;
  padding: 10px 12px;
  outline: none;
}

.search{flex:1; min-width:240px}
.select{min-width:140px}

.search:focus, .select:focus{
  border-color: rgba(124,92,255,.55);
  box-shadow: 0 0 0 4px rgba(124,92,255,.14);
}

/* Cards */
.card{
  grid-column: span 12;
  border-radius: var(--radius);
  border: 1px solid rgba(255,255,255,.10);
  background: linear-gradient(180deg, rgba(255,255,255,.055), rgba(255,255,255,.03));
  box-shadow: var(--shadow);
  padding: 14px;
}

@media(min-width:1100px){ .card{ grid-column: span 6; } }
@media(min-width:1400px){ .card{ grid-column: span 4; } } /* 3 columns on big screens */

.toprow{display:flex;align-items:flex-start;justify-content:space-between;gap:10px}
.name{font-weight:900;font-size:14.5px}
.meta{
  margin-top:6px;
  color:var(--muted);
  font-size:12px;
  line-height:1.45;
  word-break:break-word;
}

/* Badges */
.badge{
  font-size:11px;
  padding: 6px 10px;
  border-radius: 999px;
  border:1px solid rgba(255,255,255,.12);
  background: rgba(0,0,0,.18);
  color: var(--muted);
  white-space:nowrap;
}
.badge.good{border-color: rgba(55,217,151,.35); color: rgba(55,217,151,.95)}
.badge.warn{border-color: rgba(246,176,77,.35); color: rgba(246,176,77,.95)}
.badge.bad{border-color: rgba(255,92,122,.35); color: rgba(255,92,122,.95)}

/* Form fields inside cards */
.row{display:flex;gap:10px;flex-wrap:wrap;margin-top:10px}

.field{
  width:100%;
  background: rgba(255,255,255,.035);
  border: 1px solid rgba(255,255,255,.10);
  border-radius: 12px;
  padding: 10px 12px;
  outline:none;
}
.field:focus{
  border-color: rgba(124,92,255,.55);
  box-shadow: 0 0 0 4px rgba(124,92,255,.12);
}
textarea.field{min-height:88px; resize:vertical}

/* Chips (suggested emails) */
.sugs{
  display:flex;
  gap:8px;
  flex-wrap:wrap;
  margin-top:10px;
}
.chip{
  font-size:12px;
  padding: 7px 10px;
  border-radius: 999px;
  border: 1px solid rgba(255,255,255,.10);
  background: rgba(255,255,255,.03);
  cursor:pointer;
  color: var(--muted);
}
.chip:hover{
  border-color: rgba(124,92,255,.45);
  color: var(--text);
}

/* Buttons (base) */
.btn{
  border-radius: 12px;
  padding: 9px 11px;
  border: 1px solid rgba(255,255,255,.10);
  background: rgba(255,255,255,.03);
  cursor:pointer;
  font-weight: 700;
  transition: transform .08s ease, filter .08s ease, border-color .08s ease;
}
.btn:hover{transform: translateY(-1px); filter: brightness(1.06)}
.btn:active{transform: translateY(0px)}
.btn.secondary{background: rgba(255,255,255,.02)}

/* Make PRIMARY actions look like primary (no HTML changes) */
button[data-action="smtp"]{
  border-color: rgba(124,92,255,.55);
  background: linear-gradient(180deg, rgba(124,92,255,.28), rgba(124,92,255,.12));
}
button[data-action="gmail"]{
  border-color: rgba(91,140,255,.45);
  background: linear-gradient(180deg, rgba(91,140,255,.20), rgba(91,140,255,.10));
}

/* Make “Copy” actions smaller + quieter */
button[data-action="copy-subject"],
button[data-action="copy-message"],
button[data-action="copy-plan"]{
  font-weight:650;
  opacity:.95;
}

/* Make “danger-ish” actions subtle */
button[data-action="mark-reply"]{
  border-color: rgba(55,217,151,.25);
}
button[data-action="open-site"], button[data-action="open-plan"]{
  opacity:.95;
}

/* Small helper text */
.hint{
  color: var(--muted);
  font-size: 12px;
  margin-top: 10px;
  opacity: .92;
}

.copyok{color: rgba(55,217,151,.95); font-size:12px; margin-left:8px}
</style>
</head>
<body>
<header>
  <div class="headerInner">
    <div>
      <h1>ORE Outreach Panel</h1>
      <div class="sub">Paste missing emails, Discover, Enrich, generate a plan, then send via SMTP or open Gmail draft.</div>
    </div>
    <div class="pill" id="stats">Loading...</div>
  </div>
</header>

<main>
  <div class="bar">
    <input class="search" id="q" placeholder="Search clinic / city / website..." />
    <select class="select" id="status">
      <option value="all">All statuses</option>
      <option value="todo">To do</option>
      <option value="sent">Sent</option>
      <option value="reply">Replied</option>
      <option value="skip">Skipped</option>
    </select>
    <select class="select" id="method">
      <option value="all">All methods</option>
      <option value="email">Email</option>
      <option value="contact_form">Contact form</option>
      <option value="manual">Manual</option>
    </select>

    <select class="select" id="limit" title="Render limit (faster)">
      <option value="60">Show 60</option>
      <option value="120" selected>Show 120</option>
      <option value="300">Show 300</option>
      <option value="all">Show all</option>
    </select>

    <input class="search" id="city" style="max-width:220px;flex:0" placeholder="City (optional)" />
    <input class="search" id="prov" style="max-width:110px;flex:0" placeholder="Prov (ON/QC...)" />

    <button class="btn secondary" id="discoverBtn" title="Find new dentists and add them to your list">Discover New Leads</button>
    <button class="btn secondary" id="enrichBtn" title="Find missing contact page + email (safe mode)">Enrich Missing</button>
  </div>

  <div class="grid" id="grid"></div>
</main>

<script>
  const SMTP_FROM = ${SMTP_FROM_JS};
  const BASE_URL = ${BASE_URL_JS};

  let ALL = [];
  let STATS = { smtpEnabled:false, discoverEnabled:false, remainingToday:0, sentToday:0, maxEmailsPerDay:0 };

  const grid = document.getElementById("grid");

  function esc(s){
    return (s ?? "").toString().replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }

  function badgeFor(lead){
    const m = lead.method || "manual";
    const status = lead.status || "todo";
    let cls = "warn";
    if(status === "sent") cls = "good";
    else if(status === "skip") cls = "bad";
    else if(lead.email) cls = "good";
    else if(lead.contactPage) cls = "warn";
    else cls = "bad";
    const label = status + " · " + m;
    return '<span class="badge '+cls+'">'+esc(label)+'</span>';
  }

  function buildSubject(lead){
    const name = lead.clinicName || "your clinic";
    return name + " - quick growth idea";
  }

  function buildEmailBody(lead){
    const clinicName = lead.clinicName || "your clinic";
    const website = lead.website || "";
    return \`Hi \${clinicName} team,

I'm reaching out because I'm building a small clinic growth + follow-up automation for dental clinics in Canada.

It helps with:
- new patient inquiry follow-ups (so fewer leads drop)
- review requests automation (Google reviews)
- missed-call / form submission auto-reply
- simple reactivation messages for inactive patients

If you want, I can generate a free 1-page plan tailored to your clinic based on your website (\${website}).

Should I send it?

Thanks,
Mohamed
\${SMTP_FROM}\`;
  }

  async function copy(text, el){
    try{
      await navigator.clipboard.writeText(text);
      if(el){
        const ok = document.createElement("span");
        ok.className = "copyok";
        ok.textContent = "Copied";
        el.appendChild(ok);
        setTimeout(()=> ok.remove(), 900);
      }
    }catch(e){
      alert("Copy failed (clipboard blocked). You can still copy manually.");
    }
  }

  function openGmailDraft(lead){
    if(!lead.email){
      alert("No email set yet. Paste an email first (or click a suggestion).");
      return;
    }
    const subject = encodeURIComponent(buildSubject(lead));
    const body = encodeURIComponent(buildEmailBody(lead));
    const to = encodeURIComponent(lead.email);
    const url = \`https://mail.google.com/mail/?view=cm&fs=1&to=\${to}&su=\${subject}&body=\${body}\`;
    window.open(url, "_blank");
  }

  async function patchLead(id, patch){
    const res = await fetch("/api/leads/" + encodeURIComponent(id), {
      method:"POST",
      headers:{ "Content-Type":"application/json" },
      body: JSON.stringify(patch)
    });
    const json = await res.json();
    if(!json.ok) throw new Error(json.error || "Save failed");
    const idx = ALL.findIndex(x => x.id === id);
    if(idx !== -1) ALL[idx] = json.lead;
  }

  async function refreshStats(){
    const res = await fetch("/api/stats");
    const json = await res.json();
    if(json.ok) STATS = json;
  }

  async function sendSmtp(id){
    if(!STATS.smtpEnabled){
      alert("SMTP is not configured (check .env).");
      return;
    }
    if(STATS.remainingToday <= 0){
      alert("Daily SMTP limit reached. Try tomorrow.");
      return;
    }
    const res = await fetch("/api/send/" + encodeURIComponent(id), { method:"POST" });
    const json = await res.json();
    if(!json.ok){
      alert(json.error || "Send failed");
      return;
    }
    const idx = ALL.findIndex(x => x.id === id);
    if(idx !== -1) ALL[idx] = json.lead;
    await refreshStats();
    render();
  }

  async function discover(){
    if(!STATS.discoverEnabled){
      alert("Discover script not found. Put localBusinesses.js in root or src/scrapers/.");
      return;
    }
    const btn = document.getElementById("discoverBtn");
    btn.disabled = true; btn.textContent = "Discovering...";
    try{
      const city = (document.getElementById("city")?.value || "").trim();
      const prov = (document.getElementById("prov")?.value || "").trim();

      const res = await fetch("/api/discover", {
        method:"POST",
        headers:{ "Content-Type":"application/json" },
        body: JSON.stringify({ city, prov })
      });

      const json = await res.json();
      if(!json.ok) alert(json.error || "Discover failed");
      else{
        alert("Discover done. Added: " + json.added + " new leads.");
        await init();
      }
    }finally{
      btn.disabled = false; btn.textContent = "Discover New Leads";
    }
  }

  async function enrich(){
    const btn = document.getElementById("enrichBtn");
    btn.disabled = true; btn.textContent = "Enriching...";
    try{
      const res = await fetch("/api/enrich?limit=10&delayMs=900", { method:"POST" });
      const json = await res.json();
      if(!json.ok) alert(json.error || "Enrich failed");
      else{
        alert(\`Enrich done. scanned=\${json.scanned}, foundEmail=\${json.foundEmail}, foundContact=\${json.foundContact}\`);
        await init();
      }
    }finally{
      btn.disabled = false; btn.textContent = "Enrich Missing";
    }
  }

  async function generatePlan(id){
    const res = await fetch("/api/plan/" + encodeURIComponent(id), { method:"POST" });
    const json = await res.json();
    if(!json.ok){
      alert(json.error || "Plan failed");
      return null;
    }
    const idx = ALL.findIndex(x => x.id === id);
    if(idx !== -1) ALL[idx] = json.lead || ALL[idx];
    return json;
  }

  async function copyPlan(id, btn){
    const res = await fetch("/api/plan/" + encodeURIComponent(id));
    const json = await res.json();
    if(!json.ok){
      alert(json.error || "No plan");
      return;
    }
    await copy(json.planMd || "", btn);
  }

  function render(){
    const q = (document.getElementById("q").value || "").toLowerCase().trim();
    const status = document.getElementById("status").value;
    const method = document.getElementById("method").value;

    const limitVal = document.getElementById("limit").value;
    const limit = limitVal === "all" ? Infinity : Number(limitVal || 120);

    const filteredAll = ALL.filter(l=>{
      const blob = (l.clinicName + " " + (l.city||"") + " " + (l.province||"") + " " + (l.website||"") + " " + (l.email||"")).toLowerCase();
      if(q && !blob.includes(q)) return false;
      if(status !== "all" && (l.status||"todo") !== status) return false;
      if(method !== "all" && (l.method||"manual") !== method) return false;
      return true;
    });

    const filtered = filteredAll.slice(0, limit);

    const todo = ALL.filter(l => (l.status||"todo")==="todo").length;
    const sent = ALL.filter(l => (l.status||"todo")==="sent").length;
    const manual = ALL.filter(l => (l.method||"manual")==="manual").length;

    const smtpLine = STATS.smtpEnabled
      ? \`SMTP: \${STATS.sentToday}/\${STATS.maxEmailsPerDay} today (remaining \${STATS.remainingToday})\`
      : "SMTP: off";

    document.getElementById("stats").textContent =
      \`\${filtered.length}/\${filteredAll.length} shown · \${todo} todo · \${sent} sent · \${manual} manual · \${smtpLine}\`;

    grid.innerHTML = filtered.map(l=>{
      const websiteLink = l.website ? '<a href="'+esc(l.website)+'" target="_blank" rel="noreferrer">'+esc(l.website)+'</a>' : "(no website)";
      const contactLink = l.contactPage ? ' · <a href="'+esc(l.contactPage)+'" target="_blank" rel="noreferrer">contact page</a>' : "";
      const sugs = (l.suggestedEmails||[]).map(e => '<span class="chip" data-email="'+esc(e)+'">'+esc(e)+'</span>').join("");

      const planLine = l.planGeneratedAt
        ? "<br/>Plan: <a href='/plan/" + encodeURIComponent(l.id) + "' target='_blank' rel='noreferrer'>open</a> · " +
          "<span style='color:#a7b0c5'>" + esc(l.planGeneratedAt) + "</span>"
        : "";

      return \`
        <div class="card" data-id="\${esc(l.id)}">
          <div class="toprow">
            <div>
              <div class="name">\${esc(l.clinicName || "Clinic")}</div>
              <div class="meta">
                \${websiteLink}\${contactLink}<br/>
                \${esc(l.city||"")} \${l.province ? "· "+esc(l.province) : ""} \${l.score ? "· score "+esc(l.score) : ""} \${l.tier ? "· "+esc(l.tier) : ""}
                \${l.sentAt ? "<br/>Sent: "+esc(l.sentAt) : ""}
                \${l.followupDueAt ? "<br/>Followup due: "+esc(l.followupDueAt) : ""}
                \${planLine}
              </div>
            </div>
            \${badgeFor(l)}
          </div>

          <div class="row">
            <input class="field" placeholder="Email (paste here if missing)" value="\${esc(l.email || "")}" data-role="email" />
            <select class="field" data-role="status">
              <option value="todo" \${(l.status||"todo")==="todo"?"selected":""}>todo</option>
              <option value="sent" \${(l.status||"todo")==="sent"?"selected":""}>sent</option>
              <option value="reply" \${(l.status||"todo")==="reply"?"selected":""}>reply</option>
              <option value="skip" \${(l.status||"todo")==="skip"?"selected":""}>skip</option>
            </select>
          </div>

          \${sugs ? '<div class="sugs">'+sugs+'</div>' : ''}

          <div class="row">
            <button class="btn" data-action="smtp">Send SMTP</button>
            <button class="btn" data-action="gmail">Open Gmail Draft</button>
            <button class="btn" data-action="copy-subject">Copy Subject</button>
            <button class="btn" data-action="copy-message">Copy Message</button>
            <button class="btn secondary" data-action="open-site">Open Website</button>
            <button class="btn secondary" data-action="mark-reply">Mark Reply</button>
            <button class="btn secondary" data-action="gen-plan">Generate Plan</button>
            <button class="btn secondary" data-action="copy-plan">Copy Plan</button>
            <button class="btn secondary" data-action="reply">Generate Reply</button>
            <button class="btn secondary" data-action="open-plan">Open Plan</button>
          </div>

          <div class="row">
            <textarea class="field" data-role="notes" placeholder="Notes (optional)">\${esc(l.notes || "")}</textarea>
          </div>

          <div class="hint">Tip: If email is missing, click a suggested email chip, or open the website and find it, then paste it here.</div>
        </div>
      \`;
    }).join("");
  }

  // ---- ONE set of listeners (fast) ----
  const notesTimers = new Map();

  grid.addEventListener("click", async (e) => {
    const card = e.target.closest(".card");
    if(!card) return;
    const id = card.getAttribute("data-id");
    const lead = ALL.find(x=>x.id===id);
    if(!lead) return;

    // chip click
    const chip = e.target.closest(".chip");
    if(chip){
      const email = chip.getAttribute("data-email") || "";
      const emailInput = card.querySelector('[data-role="email"]');
      if(emailInput) emailInput.value = email;
      await patchLead(id, { email: email.trim() });
      render();
      return;
    }

    const btn = e.target.closest("button[data-action]");
    if(!btn) return;
    const action = btn.getAttribute("data-action");

    if(action==="open-site"){ if(lead.website) window.open(lead.website, "_blank"); return; }
    if(action==="open-plan"){ window.open("/plan/" + encodeURIComponent(id), "_blank"); return; }
    if(action==="gmail"){ openGmailDraft(lead); return; }
    if(action==="copy-subject"){ await copy(buildSubject(lead), btn); return; }
    if(action==="copy-message"){ await copy(buildEmailBody(lead), btn); return; }
    if(action==="mark-reply"){ await patchLead(id, { status:"reply" }); render(); return; }
    if(action==="copy-plan"){ await copyPlan(id, btn); return; }
    if(action==="smtp"){
      if(!lead.email){ alert("Paste an email first (or click a suggestion)."); return; }
      await sendSmtp(id);
      return;
    }

    if(action==="gen-plan"){
      btn.disabled = true;
      const old = btn.textContent;
      btn.textContent = "Generating...";
      try{
        const json = await generatePlan(id);
        if(json) alert("Plan generated");
        await init();
      }finally{
        btn.disabled = false;
        btn.textContent = old;
      }
      return;
    }

    if(action==="reply"){
      const pasted = prompt("Paste their reply here:");
      if(!pasted) return;
      const res = await fetch("/api/reply/" + encodeURIComponent(id), {
        method:"POST",
        headers:{ "Content-Type":"application/json" },
        body: JSON.stringify({ text: pasted })
      });
      const json = await res.json();
      if(!json.ok){ alert(json.error || "Reply gen failed"); return; }
      await copy("Subject: " + json.subject + "\\n\\n" + json.text, btn);
      alert("Reply generated + copied");
      return;
    }
  });

  grid.addEventListener("change", async (e)=>{
    const card = e.target.closest(".card");
    if(!card) return;
    const id = card.getAttribute("data-id");
    const role = e.target.getAttribute("data-role");
    if(!role) return;

    if(role === "email"){
      await patchLead(id, { email: (e.target.value || "").trim() });
      render();
      return;
    }
    if(role === "status"){
      await patchLead(id, { status: e.target.value });
      render();
      return;
    }
  });

  // notes: debounce save (so it doesn't lag typing)
  grid.addEventListener("input", (e)=>{
    const card = e.target.closest(".card");
    if(!card) return;
    const id = card.getAttribute("data-id");
    const role = e.target.getAttribute("data-role");
    if(role !== "notes") return;

    clearTimeout(notesTimers.get(id));
    notesTimers.set(id, setTimeout(async ()=>{
      try{ await patchLead(id, { notes: e.target.value || "" }); }
      catch(err){ console.log("notes save failed", err); }
    }, 400));
  });

  async function init(){
    try{
      await refreshStats();
      const res = await fetch("/api/leads");
      const json = await res.json();
      if(!json.ok){
        document.getElementById("stats").textContent = "API error: " + (json.error || "unknown");
        return;
      }
      ALL = json.leads || [];
      render();
    }catch(e){
      console.error(e);
      document.getElementById("stats").textContent = "Load failed: " + (e?.message || e);
    }
  }

  // small debounce for search
  let t = null;
  document.getElementById("q").addEventListener("input", () => {
    clearTimeout(t);
    t = setTimeout(render, 120);
  });
  document.getElementById("status").addEventListener("change", render);
  document.getElementById("method").addEventListener("change", render);
  document.getElementById("limit").addEventListener("change", render);
  document.getElementById("discoverBtn").addEventListener("click", discover);
  document.getElementById("enrichBtn").addEventListener("click", enrich);

  init();
</script>
</body>
</html>`);
});

// ---- ERROR HANDLER ----
app.use((err, req, res, next) => {
  console.error("Express error:", err);
  if (res.headersSent) return next(err);
  res.status(500).json({ ok: false, error: err?.message || "Server error" });
});

// ── Setup-complete webhook ──────────────────────────────────────────────────────
import { registerSetupCompleteRoute } from "./api/setupComplete.js";
registerSetupCompleteRoute(app);

// ── SMS forwarding webhook (Twilio → Mohamed's phone) ───────────────────────────
import { registerSmsWebhookRoute } from "./api/smsWebhook.js";
registerSmsWebhookRoute(app);

// ── Inbound SMS handler (clinic replies → log + auto-reply) ─────────────────────
import { registerSmsInboundRoute } from "./api/smsInbound.js";
registerSmsInboundRoute(app);

// ── Inbound call + recording handler ────────────────────────────────────────────
import { registerCallInboundRoutes } from "./api/callInbound.js";
registerCallInboundRoutes(app);

// ── Voice callback webhook (incoming calls → clinic match + SMS alert) ───────────
import { registerCallbackWebhookRoute } from "./api/callbackWebhook.js";
registerCallbackWebhookRoute(app);

// ── Missed call follow-up webhook (clinic missed call → auto-SMS to patient) ─────
import { registerMissedCallWebhookRoute } from "./api/missedCallWebhook.js";
registerMissedCallWebhookRoute(app);

// ── Patient SMS reply webhook (patient replies → recovery engine) ─────────────
import { registerPatientReplyWebhookRoute } from "./api/patientReplyWebhook.js";
registerPatientReplyWebhookRoute(app);

// ── Intelligence dashboard ────────────────────────────────────────────────────────
const INTEL_DIR = path.join(process.cwd(), "data", "intelligence");
const PUBLIC_DIR = path.join(process.cwd(), "public");

app.get("/intelligence", (req, res) => {
  const file = path.join(PUBLIC_DIR, "intelligence.html");
  if (fs.existsSync(file)) res.sendFile(file);
  else res.status(404).send("intelligence.html not found");
});

// Serve intelligence JSON files for the dashboard
app.get("/data/intelligence/:file", (req, res) => {
  const filename = path.basename(req.params.file); // prevent path traversal
  const filePath = path.join(INTEL_DIR, filename);
  if (!filename.endsWith(".json") || !fs.existsSync(filePath)) {
    return res.status(404).json({ ok: false, error: "Not found" });
  }
  res.setHeader("Content-Type", "application/json");
  res.sendFile(filePath);
});

// ── UTM link-click tracking ──────────────────────────────────────────────────────
const LINK_CLICKS_PATH = path.join(process.cwd(), "data", "link-clicks.json");

// ── Open tracking pixel ──
app.get('/open', async (req, res) => {
  const pixel = Buffer.from(
    'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
    'base64'
  );
  res.writeHead(200, {
    'Content-Type': 'image/gif',
    'Content-Length': pixel.length,
    'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
    'Pragma': 'no-cache',
  });
  res.end(pixel);

  try {
    const clinic  = req.query.c || 'unknown';
    const variant = req.query.v || 'unknown';
    const ip      = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '';
    const ua      = req.headers['user-agent'] || '';

    const botPatterns = /Googlebot|Bingbot|Slurp|DuckDuck|Baidu|preview|PreviewAgent|Outlook-iOS|BlackBerry|MailChimp|SendGrid/i;
    if (botPatterns.test(ua)) return;

    const logPath = 'data/opens.json';
    let opens = [];
    try { opens = JSON.parse(fs.readFileSync(logPath, 'utf8')); } catch {}

    const thirtyMin = 30 * 60 * 1000;
    const recent = opens.find(o =>
      o.clinic === clinic &&
      Date.now() - new Date(o.openedAt).getTime() < thirtyMin
    );
    if (recent) return;

    opens.push({ clinic, variant, openedAt: new Date().toISOString(), ip: ip.slice(0, 45), ua: ua.slice(0, 120) });
    fs.writeFileSync(logPath, JSON.stringify(opens, null, 2));

    try {
      const dbPath = 'data/outreach.localDentists.json';
      const db = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
      const idx = db.findIndex(c => c.clinicSlug === clinic || c.clinicName?.toLowerCase().replace(/[^a-z0-9]/g, '-') === clinic);
      if (idx !== -1) {
        db[idx].lastOpenedAt = new Date().toISOString();
        db[idx].openCount = (db[idx].openCount || 0) + 1;
        fs.writeFileSync(dbPath, JSON.stringify(db, null, 2));
      }
    } catch {}
  } catch (err) {
    console.error('[open-pixel] error:', err.message);
  }
});

app.get("/track", (req, res) => {
  const clinic    = String(req.query.clinic || "unknown").slice(0, 100);
  const clickedAt = new Date().toISOString();
  const ip        = req.ip || "";
  const userAgent = (req.headers["user-agent"] || "").slice(0, 200);

  let clicks = [];
  try {
    if (fs.existsSync(LINK_CLICKS_PATH)) {
      clicks = JSON.parse(fs.readFileSync(LINK_CLICKS_PATH, "utf-8"));
      if (!Array.isArray(clicks)) clicks = [];
    }
  } catch { /* start fresh */ }
  clicks.push({ clinic, clickedAt, ip, userAgent });
  try {
    fs.mkdirSync(path.dirname(LINK_CLICKS_PATH), { recursive: true });
    fs.writeFileSync(LINK_CLICKS_PATH, JSON.stringify(clicks, null, 2), "utf-8");
  } catch (e) {
    console.error("[track] write failed:", e?.message);
  }

  res.redirect(302, "https://clinicflowautomation.com?utm_source=email&utm_campaign=cold");
});

// ---- START ----
app.listen(PORT, () => {
  console.log(`Outreach Panel running on http://localhost:${PORT}`);
  console.log(`Using: ${OUTREACH_PATH}`);
  console.log(`Discover enabled: ${DISCOVER_ENABLED} ${DISCOVER_SCRIPT ? "(" + DISCOVER_SCRIPT + ")" : ""}`);
  console.log(`SMTP enabled: ${SMTP_ENABLED}`);
});