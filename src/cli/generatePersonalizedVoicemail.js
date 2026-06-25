// src/cli/generatePersonalizedVoicemail.js
// Generates personalized voicemail scripts (and optionally MP3s via ElevenLabs)
// based on what we know about each clinic.
//
// Script types:
//   1 — Has review pain signals (reviewPainScore >= 2)
//   2 — High opportunity score, no review signals
//   3 — Uses known booking software (Jane App, etc.)
//   4 — Default (no specific data)
//
// Usage:
//   node src/cli/generatePersonalizedVoicemail.js
//   node src/cli/generatePersonalizedVoicemail.js --limit 10
//   node src/cli/generatePersonalizedVoicemail.js --dry-run

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import fetch from "node-fetch";

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const DATA_DIR = path.join(ROOT, "data");
const OUTREACH_PATH = path.join(DATA_DIR, "outreach.localDentists.json");
const AUDIO_DIR = path.join(DATA_DIR, "audio");
const LOG_PATH  = path.join(DATA_DIR, "calls", "voicemail-scripts.json");

const ELEVENLABS_API_KEY = (process.env.ELEVENLABS_API_KEY || "").trim();
// Eric — Smooth, Trustworthy, conversational, american
const ELEVENLABS_VOICE   = "cjVigY5qzO86Huf0OWal";

const args = process.argv.slice(2);
const DRY_RUN  = args.includes("--dry-run");
const limitIdx = args.indexOf("--limit");
const LIMIT    = limitIdx !== -1 ? Number(args[limitIdx + 1]) : 999;
const CLINIC_FILTER = (() => { const i = args.indexOf("--clinic"); return i !== -1 ? args[i + 1] : null; })();
const CITY_OVERRIDE = (() => { const i = args.indexOf("--city");   return i !== -1 ? args[i + 1] : null; })();
const FORCE         = args.includes("--force"); // re-generate even if script already exists

function readJsonSafe(p, fb) {
  try { if (!fs.existsSync(p)) return fb; return JSON.parse(fs.readFileSync(p, "utf-8")); }
  catch { return fb; }
}

function writeJsonSafe(p, data) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(data, null, 2), "utf-8");
}

function clinicSlug(name) {
  return (name || "clinic").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
}

// Estimate speaking duration (average 150 words/min, ~2.5 chars/word)
function estimateDuration(text) {
  const words = text.trim().split(/\s+/).length;
  const secs = Math.round((words / 150) * 60);
  return `~${secs}s`;
}

// ─── Script generators ────────────────────────────────────────────────────────

function buildScript(clinic) {
  const name = clinic.clinicName || "your clinic";
  const city = clinic.city || "your area";
  const cityRef = city.split(",")[0].trim();

  // Extract last name from contactName if available
  const lastName = (() => {
    if (!clinic.contactName) return "";
    const parts = clinic.contactName.trim().split(/\s+/);
    return parts[parts.length - 1] || "";
  })();
  const drSign = lastName ? ` Thanks Dr. ${lastName}.` : " Thanks.";

  // Type 1 — Review pain signals
  if ((clinic.reviewPainScore || 0) >= 2) {
    return {
      scriptType: 1,
      personalizationLevel: "HIGH",
      text: `Hey, this is Mohamed calling from ClinicFlow — I'm based in Montreal.\n\nSo I was going through Google reviews for dental clinics in ${cityRef} recently, and ${name} came up. A few patients mentioned having difficulty getting through by phone. I actually do free audits for exactly this — I look at your setup and tell you the exact revenue you're losing to missed calls.\n\nTakes me 10 minutes, costs you nothing, no sales pitch. Just useful information.\n\nCall me back at 438-544-0442 whenever you get a chance. Thanks, have a great day.`,
    };
  }

  // Type 3 — Known booking software
  const softwareName = clinic.bookingSoftware;
  if (softwareName) {
    return {
      scriptType: 3,
      personalizationLevel: "MEDIUM-HIGH",
      text: `Hey, this is Mohamed from ClinicFlow Automation in Montreal.\n\nQuick question for ${name} — do you have automated follow-up running for missed calls through ${softwareName}? Most clinics using ${softwareName} don't, and it's usually where the biggest revenue leak is. I do free audits to find the exact number.\n\nCall me back at 438-544-0442. No obligation at all. Thanks.`,
    };
  }

  // Type 2 — High opportunity score
  if ((clinic.opportunityScore || 0) >= 7 || (clinic.techScore || 0) >= 7) {
    return {
      scriptType: 2,
      personalizationLevel: "MEDIUM",
      text: `Hey, this is Mohamed calling — I'm with ClinicFlow Automation in Montreal.\n\nI've been doing research on dental clinics in ${cityRef} and ${name} came up as a practice where I think I can show you something valuable. I do free missed call audits — most clinics I look at are losing between 4 and 8 patients per week just from unanswered calls with no follow-up.\n\nCompletely free to look at, no commitment. Call me back at 438-544-0442 whenever works for you. Thanks.`,
    };
  }

  // Type 4 — Default
  return {
    scriptType: 4,
    personalizationLevel: "LOW",
    text: `Hey, this is Mohamed calling from ClinicFlow — calling from Montreal.\n\nI do free missed call audits for dental clinics across Canada. I've been looking at practices in ${cityRef} and found some patterns worth sharing. Takes 10 minutes, costs nothing.\n\nIf you're curious, call me back at 438-544-0442. No pitch, just something useful. Thanks, have a good day.`,
  };
}

// ─── ElevenLabs TTS ───────────────────────────────────────────────────────────

async function generateAudio(text, outputPath) {
  if (!ELEVENLABS_API_KEY || ELEVENLABS_API_KEY === "placeholder") return { ok: false, reason: "no_api_key" };

  try {
    const res = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${ELEVENLABS_VOICE}`,
      {
        method: "POST",
        headers: {
          "xi-api-key": ELEVENLABS_API_KEY,
          "Content-Type": "application/json",
          "Accept": "audio/mpeg",
        },
        body: JSON.stringify({
          text,
          model_id: "eleven_multilingual_v2",
          voice_settings: {
            stability: 0.30,
            similarity_boost: 0.80,
            style: 0.20,
            use_speaker_boost: true,
          },
        }),
      }
    );

    if (!res.ok) {
      const err = await res.text().catch(() => "");
      return { ok: false, reason: `elevenlabs_${res.status}: ${err.slice(0, 100)}` };
    }

    const buffer = Buffer.from(await res.arrayBuffer());
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, buffer);
    return { ok: true, bytes: buffer.length };
  } catch (err) {
    return { ok: false, reason: err.message };
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

const leads = readJsonSafe(OUTREACH_PATH, []);

// Target clinics with phone or personalPhone, no script generated yet
// --clinic filters by name (partial match); --force re-generates existing scripts
const targets = leads
  .map((l, idx) => ({ l, idx }))
  .filter(({ l }) => {
    if (CLINIC_FILTER) {
      return (l.clinicName || "").toLowerCase().includes(CLINIC_FILTER.toLowerCase());
    }
    return (l.phone || l.personalPhone) && (FORCE || !l.voicemailScriptAt);
  })
  .slice(0, LIMIT);

// Apply city override when targeting a specific clinic
if (CITY_OVERRIDE && targets.length > 0) {
  targets.forEach(t => { t.l = { ...t.l, city: CITY_OVERRIDE }; });
}

// Also load tech-stack data for bookingSoftware enrichment
const techStackData = readJsonSafe(path.join(DATA_DIR, "intelligence", "tech-stack.json"), {});
const techClinics = techStackData.clinics || [];
const techByName = {};
for (const t of techClinics) {
  if (t.clinicName) techByName[t.clinicName.toLowerCase().slice(0, 30)] = t;
}

console.log(`\nVoicemail Script Generator`);
console.log(`ElevenLabs: ${ELEVENLABS_API_KEY && ELEVENLABS_API_KEY !== "placeholder" ? "enabled" : "disabled (no key)"}`);
console.log(`Mode: ${DRY_RUN ? "dry-run" : "live"} | Limit: ${LIMIT}`);
console.log(`Targets: ${targets.length} clinics with phone, no script yet\n`);

const log = readJsonSafe(LOG_PATH, []);
let generated = 0;
let audioCreated = 0;

for (let i = 0; i < targets.length; i++) {
  const { l, idx } = targets[i];

  // Enrich with tech-stack data if available
  const techKey = (l.clinicName || "").toLowerCase().slice(0, 30);
  const tech = techByName[techKey] || {};
  const enriched = { ...l, bookingSoftware: l.bookingSoftware || tech.bookingSoftware || null, opportunityScore: l.opportunityScore || tech.opportunityScore || 0 };

  const { scriptType, personalizationLevel, text } = buildScript(enriched);
  const duration = estimateDuration(text);
  const slug = clinicSlug(l.clinicName);
  const audioPath = path.join(AUDIO_DIR, `${slug}-voicemail.mp3`);
  const audioRelative = `data/audio/${slug}-voicemail.mp3`;

  console.log(`[${i + 1}/${targets.length}] ${(l.clinicName || "").slice(0, 45)}`);
  console.log(`  Type: ${scriptType} | Level: ${personalizationLevel} | Duration: ${duration}`);
  console.log(`  Script: "${text.slice(0, 80)}…"`);

  let audioResult = { ok: false, reason: "dry_run" };

  if (!DRY_RUN) {
    // Generate audio if ElevenLabs is configured
    audioResult = await generateAudio(text, audioPath);
    if (audioResult.ok) {
      audioCreated++;
      console.log(`  Audio: saved → ${audioRelative} (${audioResult.bytes} bytes)`);
    } else {
      console.log(`  Audio: ${audioResult.reason}`);
    }

    // Save script to log
    const entry = {
      clinicName:          l.clinicName,
      city:                l.city || "",
      email:               l.email || "",
      phone:               l.phone || l.personalPhone || "",
      scriptType,
      personalizationLevel,
      scriptText:          text,
      durationEstimate:    duration,
      audioPath:           audioResult.ok ? audioRelative : null,
      generatedAt:         new Date().toISOString(),
    };
    log.push(entry);

    // Mark clinic record
    leads[idx].voicemailScriptAt    = new Date().toISOString();
    leads[idx].voicemailScriptType  = scriptType;
    leads[idx].voicemailScript      = text;
    leads[idx].voicemailPersonLevel = personalizationLevel;
    if (audioResult.ok) leads[idx].voicemailAudioPath = audioRelative;
  }

  generated++;
}

if (!DRY_RUN) {
  writeJsonSafe(LOG_PATH, log);
  writeJsonSafe(OUTREACH_PATH, leads);
}

console.log(`\n${"─".repeat(56)}`);
console.log(`  Voicemail Script Generator — ${targets.length} clinics processed`);
console.log(`${"─".repeat(56)}`);
console.log(`  Scripts generated:     ${generated}`);
console.log(`  Audio files created:   ${audioCreated}`);
const byType = [1,2,3,4].map(t => targets.filter(({l}) => buildScript(l).scriptType === t).length);
console.log(`  Type 1 (pain signal):  ${byType[0]}`);
console.log(`  Type 2 (high opp):     ${byType[1]}`);
console.log(`  Type 3 (booking sw):   ${byType[2]}`);
console.log(`  Type 4 (default):      ${byType[3]}`);
console.log(DRY_RUN ? "\n  (dry-run — no changes written)" : `\n  Log → ${LOG_PATH}`);
