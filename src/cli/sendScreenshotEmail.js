// src/cli/sendScreenshotEmail.js
// Sends a personalized screenshot email to a prospect.
// Tone: observational researcher, not a salesperson.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { sendMail } from '../services/mailer.js';
import { generateProspectScreenshot } from '../services/screenshotEngine.js';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function businessLabel(type) {
  if (type === 'physio') return 'physio clinic';
  if (type === 'salon')  return 'salon';
  return 'dental clinic';
}

function subject(clinicName, type) {
  if (type === 'physio') return `${clinicName} — workflow concept I put together`;
  if (type === 'salon')  return `${clinicName} — I mapped out your patient flow`;
  return `${clinicName} — operational flow I modeled`;
}

/**
 * Sends a personalized screenshot email to a single clinic.
 * @param {object} clinic - { clinicName, city, email, rating, reviewCount, painSignal, type, contactName }
 * @param {object} [opts]
 * @param {boolean} [opts.dryRun]
 * @returns {Promise<{sent, screenshotPath, subject}>}
 */
export async function sendScreenshotEmail(clinic, { dryRun = false } = {}) {
  const bLabel  = businessLabel(clinic.type);
  const subLine = subject(clinic.clinicName, clinic.type);
  const hi      = clinic.contactName ? clinic.contactName.split(' ')[0] : 'there';

  const screenshotPath = await generateProspectScreenshot(clinic);
  const sizekb = Math.round(fs.statSync(screenshotPath).size / 1024);
  console.log(`  Screenshot: ${path.basename(screenshotPath)} (${sizekb} KB)`);

  const plainText = `Hi ${hi},

I was mapping out how ${clinic.city} ${bLabel}s typically handle missed calls — and used ${clinic.clinicName} as the reference point while building this.

A few things stood out while modeling the workflow:
— missed-call recovery timing
— inactive patient reactivation patterns
— reminder consistency rates
— front-desk follow-up visibility

No pitch — I just build operational systems for clinics and thought you might find it interesting.

Still refining this — would be curious whether any of it reflects what actually happens at ${clinic.clinicName}.

— Mohamed
clinicflowautomation.com
438-544-0442

---
Reply STOP to not hear from us again.
ClinicFlow Automation · Montreal, QC · Canada`;

  const htmlBody = `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:24px;color:#1e293b;line-height:1.65">
  <p style="margin:0 0 16px;font-size:15px">Hi ${hi},</p>
  <p style="margin:0 0 20px;font-size:15px">I was studying how ${clinic.city} ${bLabel}s handle missed calls and patient follow-up, and ended up building a small operational preview using <strong>${clinic.clinicName}</strong> as the example.</p>

  <img src="cid:clinic-preview"
    style="width:100%;border-radius:8px;margin:20px 0 24px;box-shadow:0 4px 24px rgba(0,0,0,0.15);display:block">

  <p style="margin:0 0 8px;font-size:14px;color:#475569">A few things stood out while modeling the workflow:</p>
  <ul style="margin:0 0 24px;padding-left:20px;font-size:14px;color:#475569;line-height:1.9">
    <li>missed-call recovery timing</li>
    <li>inactive patient reactivation patterns</li>
    <li>reminder consistency rates</li>
    <li>front-desk follow-up visibility</li>
  </ul>

  <p style="margin:0 0 20px;font-size:14px;color:#64748b">No pitch — I just build operational systems for clinics and thought you might find it interesting.</p>

  <p style="margin:0 0 6px;font-size:15px">Still refining this — would be curious whether any of it reflects what actually happens at ${clinic.clinicName}.</p>

  <p style="margin:0 0 32px;font-size:15px">— Mohamed<br>
    <a href="https://clinicflowautomation.com" style="color:#7c5cff;text-decoration:none">clinicflowautomation.com</a><br>
    <span style="color:#94a3b8">438-544-0442</span>
  </p>

  <p style="font-size:11px;color:#94a3b8;border-top:1px solid #e2e8f0;padding-top:14px;margin:0">
    Reply STOP to not hear from us again. · ClinicFlow Automation · Montreal, QC · Canada
  </p>
</div>`;

  if (dryRun) {
    console.log(`  [DRY RUN] To: ${clinic.email} | Subject: ${subLine}`);
    return { sent: false, screenshotPath, subject: subLine };
  }

  await sendMail({
    to:          clinic.email,
    subject:     subLine,
    text:        plainText,
    html:        htmlBody,
    attachments: [{
      filename: 'clinic-preview.png',
      path:     screenshotPath,
      cid:      'clinic-preview',
    }],
  });

  return { sent: true, screenshotPath, subject: subLine };
}
