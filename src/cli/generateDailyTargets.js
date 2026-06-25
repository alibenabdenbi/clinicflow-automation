// src/cli/generateDailyTargets.js
// Generates 10 GMB + 10 Instagram outreach targets for today.
// Run: node src/cli/generateDailyTargets.js
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";

dotenv.config();
if (process.platform === "win32") process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

const __dirname         = path.dirname(fileURLToPath(import.meta.url));
const ROOT              = path.resolve(__dirname, "../..");
const DATA_DIR          = path.join(ROOT, "data");
const OUTREACH_PATH     = path.join(DATA_DIR, "outreach.localDentists.json");
const SALON_PATH        = path.join(DATA_DIR, "outreach.salonBusinesses.json");
const TARGETS_PATH      = path.join(DATA_DIR, "daily-targets.json");
const LINKEDIN_PATH     = path.join(DATA_DIR, "linkedin", "prospects.json");
const CALL_ASST_PATH    = path.join(ROOT, "public", "netlify-deploy", "call-assistant.html");
const CALL_PIN          = (process.env.ADMIN_KEY || "clinicflow").slice(-6).toUpperCase();

const ANTHROPIC_KEY = (process.env.ANTHROPIC_API_KEY || "").trim();

function readJsonSafe(p, fb) {
  try { if (!fs.existsSync(p)) return fb; return JSON.parse(fs.readFileSync(p, "utf-8")); }
  catch { return fb; }
}
function writeJson(p, data) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(data, null, 2), "utf-8");
}

// ─── Claude helpers ───────────────────────────────────────────────────────────

async function callClaude(prompt, maxTokens = 120) {
  if (!ANTHROPIC_KEY) return null;
  try {
    const { default: Anthropic } = await import("@anthropic-ai/sdk");
    const client = new Anthropic({ apiKey: ANTHROPIC_KEY });
    const msg    = await client.messages.create({
      model:      "claude-haiku-4-5-20251001",
      max_tokens: maxTokens,
      messages:   [{ role: "user", content: prompt }],
    });
    return msg.content[0]?.text?.trim() || null;
  } catch { return null; }
}

const GMB_SIG = " — Mohamed, ClinicFlow";

// Template-based GMB message generation — reliable char counts, no truncation risk.
// Claude is used only for Instagram DMs where there's no hard character limit.
function buildGMBMessage(clinic) {
  const city   = (clinic.city || "").split(",")[0].trim();
  const pain   = clinic.painSignals?.[0] || null;
  const rating = clinic.rating;
  const count  = clinic.reviewCount;
  // Use personalDetail only if it fits cleanly in the template; otherwise fall back to stats
  const rawDetail = clinic.personalDetail || "";
  const templateSuffix = ". Miss a call? Auto text-back in 60 sec—one-time setup." + GMB_SIG;
  const detail = rawDetail.length + templateSuffix.length <= 160
    ? rawDetail
    : (rating && count > 10 ? `${rating}-star clinic with ${count}+ Google reviews` : `dental clinic in ${city}`);

  // Pain-signal message — highest priority, most personal
  if (pain) {
    const body = `Hi — a patient review mentioned "${pain}". I help dental clinics in ${city} auto-reply to missed calls in 60 sec. One-time setup.`;
    if ((body + GMB_SIG).length <= 160) return body + GMB_SIG;
  }

  // Detail-based message when personalDetail is short enough
  if (detail && (detail + ". Miss a call? Auto text-back in 60 sec—one-time setup." + GMB_SIG).length <= 160) {
    return `${detail}. Miss a call? Auto text-back in 60 sec—one-time setup.${GMB_SIG}`;
  }

  // Rating + review count message
  if (rating && count > 50) {
    const body = `${rating}-star clinic with ${count}+ reviews in ${city}. Missed calls get an auto text-back in 60 sec—one-time setup.`;
    if ((body + GMB_SIG).length <= 160) return body + GMB_SIG;
  }

  // Universal fallback
  return `Hi — I help dental clinics in ${city} auto-reply to missed calls within 60 sec. One-time setup, no monthly fees. Worth a look?${GMB_SIG}`;
}

async function generateGMBMessage(clinic) {
  return buildGMBMessage(clinic);
}

async function generateInstagramMessage(clinic) {
  const city   = (clinic.city || "").split(",")[0].trim();
  const name   = clinic.clinicName || "";
  const detail = clinic.personalDetail || "";
  const isSalon = /salon|spa|hair|beauty|nail/i.test(name);
  const businessType = isSalon ? "salon/spa" : "dental clinic";

  const fallback = `${name} — with ${clinic.reviewCount}+ reviews you're clearly doing great work. I help ${businessType}s set up automatic text-back for missed calls, patients hear back in 60 seconds. Worth a look? — Mohamed, ClinicFlow`;

  const painLine = clinic.painSignals?.[0]
    ? `Pain signal from reviews (reference subtly, don't quote directly): "${clinic.painSignals[0]}"`
    : `Pain signal: none`;

  const prompt = `Write a short Instagram DM from Mohamed (founder of ClinicFlow Automation) to the owner of this ${businessType}.

Clinic: ${name}
Instagram: ${clinic.instagramHandle || name}
Rating: ${clinic.rating} stars from ${clinic.reviewCount} reviews
Personal detail: ${detail || `${clinic.rating}-star ${businessType} in ${city}`}
${painLine}

Rules:
- NO "Hey!" opener and NO emoji of any kind
- Start with the clinic name or a direct observation about their profile
- Reference ONLY "${name}" — never substitute a different clinic name
- Under 280 characters total
- Three sentences max: (1) something specific you noticed, (2) what you do, (3) one-line CTA
- Say "automatic text-back within 60 seconds" — never "automation software"
- End with "— Mohamed, ClinicFlow"
- Sound like a real person, not a marketing bot

Message only. Nothing else.`;

  const raw = await callClaude(prompt, 150);
  const result = raw ? raw.replace(/\n+/g, " ").replace(/\s{2,}/g, " ").trim() : null;
  return result || fallback;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function run() {
  const today    = new Date().toISOString().slice(0, 10);
  const dentists = readJsonSafe(OUTREACH_PATH, []);
  const salons   = readJsonSafe(SALON_PATH, []);

  // ── 10 GMB targets: enriched + not yet contacted + todo ─────────────────────
  const gmbCandidates = dentists
    .filter(c => c.placeId && !c.gmbContactedAt && c.status === "todo")
    .sort((a, b) => {
      if ((b.painScore  || 0) !== (a.painScore  || 0)) return (b.painScore  || 0) - (a.painScore  || 0);
      if ((b.rating     || 0) !== (a.rating     || 0)) return (b.rating     || 0) - (a.rating     || 0);
      return (b.reviewCount || 0) - (a.reviewCount || 0);
    })
    .slice(0, 10);

  console.log(`\nGenerating targets for ${today}`);
  console.log(`GMB candidates available: ${gmbCandidates.length}`);

  const gmbTargets = [];
  for (const clinic of gmbCandidates) {
    process.stdout.write(`  GMB [${gmbTargets.length + 1}/${gmbCandidates.length}] ${(clinic.clinicName || "").slice(0, 38).padEnd(38)} `);
    const message = await generateGMBMessage(clinic);
    gmbTargets.push({
      clinicName:    clinic.clinicName,
      city:          clinic.city || "",
      mapsUrl:       clinic.googleMapsUrl || "",
      message,
      personalDetail: clinic.personalDetail || "",
      painSignal:    clinic.painSignals?.[0] || null,
      rating:        clinic.rating || null,
      reviewCount:   clinic.reviewCount || 0,
    });
    process.stdout.write(`✓ (${message.length} chars)\n`);
    await new Promise(r => setTimeout(r, 250));
  }

  // ── 10 Instagram targets: dentists + salons with instagramHandle ─────────────
  const igPool = [
    ...dentists.filter(c => c.instagramHandle && !c.instagramDMSentAt),
    ...salons.filter(c => c.instagramHandle && !c.instagramDMSentAt),
  ].slice(0, 10);

  console.log(`\nInstagram candidates available: ${igPool.length}`);

  const igTargets = [];
  for (const clinic of igPool) {
    process.stdout.write(`  IG  [${igTargets.length + 1}/${igPool.length}] ${(clinic.clinicName || "").slice(0, 38).padEnd(38)} `);
    const message = await generateInstagramMessage(clinic);
    const handle  = (clinic.instagramHandle || "").replace("@", "");
    igTargets.push({
      clinicName:      clinic.clinicName,
      instagramHandle: clinic.instagramHandle || "",
      instagramUrl:    `https://instagram.com/${handle}`,
      message,
      personalDetail:  clinic.personalDetail || "",
    });
    process.stdout.write(`✓\n`);
    await new Promise(r => setTimeout(r, 250));
  }

  // ── 5 LinkedIn targets: rotate daily so 5 new prospects show every day ─────────
  const linkedinProspects = readJsonSafe(LINKEDIN_PATH, []);
  const linkedinPool = linkedinProspects.filter(p => !p.connectionSent);
  // Date-seeded offset: advances each day so the window never repeats
  const dateSeed = today.split("-").reduce((a, b) => a + parseInt(b, 10), 0);
  const offset   = linkedinPool.length > 5 ? dateSeed % (linkedinPool.length - 5 + 1) : 0;
  const linkedinTargets = [
    ...linkedinPool.slice(offset),
    ...linkedinPool.slice(0, offset),
  ].slice(0, 5).map(p => ({
    name:        p.name || p.personName || "LinkedIn Prospect",
    clinicName:  p.clinicName,
    city:        p.city || "",
    profileUrl:  p.profileUrl || p.linkedinUrl || p.googleUrl || "",
    message:     p.connectionMessage || "",
  }));

  // ── 10 call targets: phone + todo + not yet sms-contacted, priority order ──────
  const callCandidates = dentists
    .filter(c => {
      const phone = c.phone || c.googlePhone;
      if (!phone) return false;
      if (c.status !== "todo") return false;
      if (c.smsContactedAt || c.gmbContactedAt) return false;
      return true;
    })
    .sort((a, b) => {
      if ((b.painScore || 0) !== (a.painScore || 0)) return (b.painScore || 0) - (a.painScore || 0);
      if ((b.reviewCount || 0) !== (a.reviewCount || 0)) return (b.reviewCount || 0) - (a.reviewCount || 0);
      return (b.opportunityScore || 0) - (a.opportunityScore || 0);
    })
    .slice(0, 10)
    .map(c => ({
      clinicName:    c.clinicName,
      city:          (c.city || "").split(",")[0].trim(),
      phone:         c.phone || c.googlePhone,
      rating:        c.rating || null,
      reviewCount:   c.reviewCount || 0,
      painSignal:    c.painSignals?.[0] || null,
      personalDetail: c.personalDetail || "",
      website:       c.website || "",
      mapsUrl:       c.googleMapsUrl || "",
      callStatus:    "pending",
    }));

  const output = { date: today, gmb: gmbTargets, instagram: igTargets, calls: callCandidates, linkedin: linkedinTargets };
  writeJson(TARGETS_PATH, output);

  // ── Print full summary ────────────────────────────────────────────────────────
  console.log(`\n${"═".repeat(62)}`);
  console.log(`TODAY'S TARGETS — ${today}`);
  console.log(`${"═".repeat(62)}`);

  console.log(`\n── GMB MESSAGES (tap Maps link → Message button → paste) ──`);
  if (gmbTargets.length === 0) {
    console.log("  No enriched clinics yet — run enrichment first:");
    console.log("  node src/cli/enrichGMBBatch.js");
  } else {
    gmbTargets.forEach((t, i) => {
      const city = (t.city || "").split(",")[0];
      console.log(`\n${i + 1}. ${t.clinicName} — ${city} — ⭐${t.rating || "?"} (${t.reviewCount} reviews)`);
      console.log(`   Maps: ${t.mapsUrl}`);
      console.log(`   "${t.message}"`);
      if (t.personalDetail) console.log(`   Why: ${t.personalDetail}`);
      if (t.painSignal) console.log(`   Pain signal: "${t.painSignal}"`);
    });
  }

  console.log(`\n── INSTAGRAM DMs ──────────────────────────────────────────`);
  if (igTargets.length === 0) {
    console.log("  No Instagram handles found yet — enrichment will populate these.");
  } else {
    igTargets.forEach((t, i) => {
      console.log(`\n${i + 1}. ${t.clinicName}`);
      console.log(`   ${t.instagramUrl}`);
      console.log(`   "${t.message}"`);
    });
  }

  console.log(`\n── LINKEDIN CONNECTIONS (5 new today — never repeat) ──────`);
  if (linkedinTargets.length === 0) {
    console.log("  No pending LinkedIn prospects.");
  } else {
    linkedinTargets.forEach((t, i) => {
      console.log(`\n${i + 1}. ${t.name} — ${t.clinicName} — ${t.city}`);
      console.log(`   ${t.profileUrl}`);
      if (t.message) console.log(`   "${t.message.slice(0, 100)}${t.message.length > 100 ? '…' : ''}"`);
    });
  }

  console.log(`\n── CALL QUEUE ─────────────────────────────────────────────`);
  if (callCandidates.length === 0) {
    console.log("  No callable clinics found.");
  } else {
    callCandidates.forEach((c, i) => {
      console.log(`\n${i + 1}. ${c.clinicName} — ${c.city}`);
      console.log(`   📞 ${c.phone}`);
      if (c.personalDetail) console.log(`   Why: ${c.personalDetail}`);
      if (c.painSignal) console.log(`   Pain: "${c.painSignal}"`);
    });
  }

  // ── Generate call-assistant.html with embedded data ─────────────────────────
  try {
    if (fs.existsSync(CALL_ASST_PATH)) {
      let html = fs.readFileSync(CALL_ASST_PATH, "utf-8");
      // Replace or insert the embedded data script block
      const dataBlock = `<script id="embedded-data">
window.CALL_QUEUE = ${JSON.stringify(callCandidates, null, 2)};
window.TARGETS_DATE = "${today}";
window.CALL_PIN = "${CALL_PIN}";
</script>`;
      if (html.includes('<script id="embedded-data">')) {
        html = html.replace(/<script id="embedded-data">[\s\S]*?<\/script>/, dataBlock);
      } else {
        html = html.replace("</body>", dataBlock + "\n</body>");
      }
      fs.writeFileSync(CALL_ASST_PATH, html, "utf-8");
      console.log(`\n✓ call-assistant.html updated with ${callCandidates.length} call targets`);
    }
  } catch (e) {
    console.log(`⚠ Could not update call-assistant.html: ${e.message}`);
  }

  console.log(`\n${"─".repeat(62)}`);
  console.log(`GMB: ${gmbTargets.length} | Instagram: ${igTargets.length} | LinkedIn: ${linkedinTargets.length} | Calls: ${callCandidates.length} | Saved → ${TARGETS_PATH}`);
  console.log(`Mark sent: node src/cli/markGMBSent.js "Clinic Name"`);
}

run().catch(e => { console.error(e.message); process.exit(1); });
