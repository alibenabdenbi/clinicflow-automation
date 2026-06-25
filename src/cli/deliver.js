// src/cli/deliver.js
// Delivery CLI — generates and sends the full ClinicFlow package for a paying client.
// Usage: node src/cli/deliver.js --client "Clinic Name" --tier starter --email clinic@domain.com --city Toronto [--website https://...]
//        npm run deliver -- --client "Test Dental" --tier starter --email test@testdental.com --city Toronto

import fs from "fs";
import path from "path";
import dns from "dns/promises";
import nodemailer from "nodemailer";
import dotenv from "dotenv";
import { pathToFileURL } from "url";

import { runDelivery } from "../services/deliveryEngine.js";
import { convertSequences } from "../services/sequenceConverter.js";
import { verifyDelivery } from "../services/deliveryVerifier.js";
import { addClient, markDelivered } from "../services/clientService.js";
import { buildHTMLDelivery } from "../services/htmlDeliveryBuilder.js";

dotenv.config();

// ─── CLI arg parsing ──────────────────────────────────────────────────────────

function getArg(flag, required = false) {
  const i = process.argv.indexOf(flag);
  const val = i !== -1 ? process.argv[i + 1] : null;
  if (required && !val) {
    console.error(`Missing required argument: ${flag}`);
    console.error(`Usage: node src/cli/deliver.js --client "Name" --tier starter --email addr@domain.com --city Toronto [--website https://...]`);
    process.exit(1);
  }
  return val;
}

// ─── Send delivery email ──────────────────────────────────────────────────────

async function sendDeliveryEmail(deliveryEmail, attachments) {
  const host = (process.env.SMTP_HOST || "").trim();
  const port = Number(process.env.SMTP_PORT || "587");
  const user = (process.env.SMTP_USER || "").trim();
  const pass = (process.env.SMTP_PASS || "").trim();
  const from = (process.env.SMTP_FROM || user).trim();

  if (!host || !user || !pass) {
    console.warn("  SMTP not configured — delivery email not sent (saved locally only)");
    return false;
  }

  const transporter = nodemailer.createTransport({
    host, port, secure: port === 465,
    auth: { user, pass },
    tls: { rejectUnauthorized: false },
  });

  const mailOptions = {
    from,
    to: deliveryEmail.to,
    subject: deliveryEmail.subject,
    text: deliveryEmail.body,
    attachments: attachments
      .filter((a) => a.path && fs.existsSync(a.path))
      .map((a) => ({ filename: a.name, path: a.path })),
  };

  await transporter.sendMail(mailOptions);
  return true;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const clientName  = getArg("--client", true);
  const tier        = getArg("--tier",   true).toLowerCase();
  const email       = getArg("--email",  true);
  const city        = getArg("--city",   true);
  const website     = getArg("--website") || "";
  const doneForYou  = process.argv.includes("--setup");

  if (!["starter", "growth", "full"].includes(tier)) {
    console.error(`Invalid tier: "${tier}". Must be: starter, growth, or full`);
    process.exit(1);
  }

  if (doneForYou && tier === "full") {
    console.log(`Note: Full tier includes done-for-you setup by default — --setup flag applied.`);
  }

  // ── Warn if email domain looks fake or unresolvable ───────────────────────
  const emailDomain = email.split("@")[1] || "";
  const looksLikeTest = /^test[^@]*@|@test\.|\.test$|\.local$|\.invalid$|\.example\.com$/i.test(email);
  try {
    await dns.resolveMx(emailDomain);
    if (looksLikeTest) {
      console.warn(`  ⚠ Warning: email looks like a test address (${email}) but domain resolved.`);
      console.warn(`    Delivery email WILL be sent. Use a real client address for production.`);
    }
  } catch {
    if (looksLikeTest) {
      console.warn(`\n  ⚠ TEST EMAIL WARNING: ${email}`);
      console.warn(`    Domain "${emailDomain}" has no MX record — email will bounce.`);
      console.warn(`    Delivery email will NOT be sent (SMTP will fail).`);
      console.warn(`    Use a real client email address for production deliveries.\n`);
    } else {
      console.warn(`  ⚠ Warning: could not resolve MX for "${emailDomain}" — delivery email may bounce.`);
    }
  }

  const clientInfo = { name: clientName, city, email, tier, website, doneForYou };

  console.log(`\n══ ClinicFlow Delivery Engine ══════════════════`);
  console.log(`Client:  ${clientName}`);
  console.log(`City:    ${city}`);
  console.log(`Email:   ${email}`);
  console.log(`Tier:    ${tier}`);
  console.log(`Website: ${website || "(not provided)"}`);
  console.log(`═════════════════════════════════════════════\n`);

  // 1. Run delivery engine (generate all files via Claude)
  let result;
  try {
    result = await runDelivery(clientInfo);
  } catch (err) {
    console.error(`\n✗ Delivery generation failed: ${err.message}`);
    process.exit(1);
  }

  const { deliveryDir, files, deliveryEmail } = result;
  const succeeded = files.filter((f) => f.path);
  const failed    = files.filter((f) => f.error);

  console.log(`\n── Generated files ──────────────────────────────`);
  succeeded.forEach((f) => console.log(`  ✓ ${f.name}  (${f.size} chars)`));
  if (failed.length) failed.forEach((f) => console.log(`  ✗ ${f.name}  — ${f.error}`));
  console.log(`\nSaved to: ${deliveryDir}`);

  // 2. Generate HTML presentation files
  console.log(`\n── Generating HTML presentation files ──────────`);
  try {
    const { files: htmlFiles } = await buildHTMLDelivery(deliveryDir, clientInfo, tier);
    console.log(`  → ${htmlFiles.length} HTML files generated`);
    htmlFiles.forEach((f) => console.log(`  ✓ ${f}`));
  } catch (err) {
    console.warn(`  Warning: HTML generation failed — ${err.message}`);
    console.warn(`  Stack: ${err.stack}`);
  }

  // 3. Send delivery email with attachments
  console.log(`\n── Sending delivery email to ${email} ────────────`);
  let emailSent = false;
  try {
    emailSent = await sendDeliveryEmail(deliveryEmail, succeeded);
    if (emailSent) console.log(`  ✓ Delivery email sent`);
  } catch (err) {
    console.error(`  ✗ Email send failed: ${err.message}`);
  }

  // Save delivery email to file regardless
  const emailPath = path.join(deliveryDir, "delivery-email.txt");
  fs.writeFileSync(emailPath, `To: ${deliveryEmail.to}\nSubject: ${deliveryEmail.subject}\n\n${deliveryEmail.body}`);
  console.log(`  ✓ Email body saved to: delivery-email.txt`);

  // 4. Convert sequences to import-ready formats
  console.log(`\n── Converting sequences to import-ready formats ─`);
  try {
    const { outDir, results: convResults } = await convertSequences(deliveryDir, clientInfo);
    for (const r of convResults) {
      if (r.skipped) continue;
      if (r.error) { console.log(`  ✗ ${r.sequence}: ${r.error}`); }
    }
    const converted = convResults.filter((r) => !r.skipped && !r.error);
    const totalImportFiles = converted.reduce((n, r) => n + r.files.length, 0);
    console.log(`  → ${converted.length} sequence(s) converted, ${totalImportFiles} files → ${outDir}`);
  } catch (err) {
    console.warn(`  Warning: sequence conversion failed — ${err.message}`);
  }

  // 5. Verify delivery quality
  console.log(`\n── Running delivery verification ────────────────`);
  try {
    const filenames = succeeded.map((f) => f.name);
    const { pass, results: verifyResults, reportPath } = verifyDelivery(
      deliveryDir, clientInfo, tier, filenames
    );
    const total = verifyResults.flatMap((r) => r.checks).filter((c) => !c.informational).length;
    const passed = verifyResults.flatMap((r) => r.checks).filter((c) => !c.informational && c.pass).length;
    const failed = verifyResults.filter((r) => !r.pass);
    if (pass) {
      console.log(`  ✅ VERIFIED — ${passed}/${total} checks passed`);
    } else {
      console.log(`  ⚠ ${failed.length} file(s) have issues — ${passed}/${total} checks passed`);
      failed.forEach((r) => {
        const failedChecks = r.checks.filter((c) => !c.informational && !c.pass);
        failedChecks.forEach((c) => console.log(`    ✗ ${r.file}: ${c.name}${c.detail ? ` — ${c.detail}` : ""}`));
      });
    }
    console.log(`  Report: verification-report.md`);
  } catch (err) {
    console.warn(`  Warning: verification failed — ${err.message}`);
  }

  // 6. Add to clients.json
  console.log(`\n── Updating client records ──────────────────────`);
  try {
    const newClient = addClient(clientName, city, email, tier, new Date().toISOString());
    if (doneForYou && newClient) {
      newClient.doneForYou = true;
      // clientService persists via its own write — patch clients.json directly
      const clientsPath = new URL("../../data/clients.json", import.meta.url).pathname.replace(/^\/([A-Z]:)/, "$1");
      try {
        const all = JSON.parse(fs.readFileSync(clientsPath, "utf-8"));
        const rec = all.find(c => c.email.toLowerCase() === email.toLowerCase());
        if (rec) { rec.doneForYou = true; fs.writeFileSync(clientsPath, JSON.stringify(all, null, 2)); }
      } catch { /* non-fatal */ }
    }
    markDelivered(email);
  } catch (err) {
    console.warn(`  Warning: ${err.message}`);
  }

  // 4. Summary
  console.log(`\n══ DELIVERY COMPLETE ═══════════════════════════`);
  console.log(`Files generated:  ${succeeded.length}/${files.length}`);
  console.log(`Email sent:       ${emailSent ? "yes" : "no (check SMTP config)"}`);
  console.log(`Client logged:    data/clients.json`);
  console.log(`Delivery folder:  ${deliveryDir}`);
  if (failed.length) console.log(`\n⚠ ${failed.length} file(s) failed to generate — check ANTHROPIC_API_KEY`);
}

// ─── Guard ────────────────────────────────────────────────────────────────────

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main().catch((err) => {
    console.error("Deliver failed:", err.message);
    process.exit(1);
  });
}
