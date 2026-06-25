import dotenv from 'dotenv';
dotenv.config();
import { generateClinicPreview } from '../src/services/previewGenerator.js';
import { takeScreenshot } from '../src/services/screenshotEngine.js';
import { sendMail } from '../src/services/mailer.js';
import fs from 'fs';

const clinic = {
  clinicName: 'Toronto Physiotherapy',
  city: 'Toronto',
  rating: 4.9,
  reviewCount: 1235,
  painSignal: null,
  type: 'physio',
};

console.log('Generating new realistic preview...');
const html = generateClinicPreview(clinic);

const cachePath = 'data/screenshots/toronto-physiotherapy.png';
if (fs.existsSync(cachePath)) fs.unlinkSync(cachePath);

const screenshotPath = await takeScreenshot(html, cachePath);
console.log('New screenshot saved:', screenshotPath);
console.log('Size:', Math.round(fs.statSync(screenshotPath).size / 1024), 'KB');

await sendMail({
  to: 'm.aliben432@gmail.com',
  subject: 'Toronto Physiotherapy — workflow concept I put together',
  text: `Hi,

I was studying how Toronto physio clinics handle missed calls and patient follow-up, and ended up building a small operational preview using Toronto Physiotherapy as the example.

A few things stood out while modeling the workflow:
— missed-call recovery timing
— inactive patient reactivation patterns
— reminder consistency rates
— front-desk follow-up visibility

No pitch — I just build operational systems for clinics and thought you might find it interesting.

If any of it resonates, I'm happy to walk through it.

— Mohamed
clinicflowautomation.com
438-544-0442

---
Reply STOP to not hear from us again.
ClinicFlow Automation · Montreal, QC`,
  html: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;color:#1e293b">
<p style="margin:0 0 16px">Hi,</p>
<p style="margin:0 0 20px">I was studying how Toronto physio clinics handle missed calls and patient follow-up, and ended up building a small operational preview using <strong>Toronto Physiotherapy</strong> as the example.</p>
<img src="cid:clinic-preview" style="width:100%;border-radius:8px;margin:20px 0;box-shadow:0 4px 24px rgba(0,0,0,0.15)">
<p style="margin:0 0 8px;color:#64748b;font-size:14px">A few things stood out while modeling the workflow:</p>
<ul style="margin:0 0 20px;padding-left:20px;color:#475569;font-size:14px;line-height:1.8">
  <li>missed-call recovery timing</li>
  <li>inactive patient reactivation patterns</li>
  <li>reminder consistency rates</li>
  <li>front-desk follow-up visibility</li>
</ul>
<p style="margin:0 0 20px;color:#64748b;font-size:14px">No pitch — I just build operational systems for clinics and thought you might find it interesting.</p>
<p style="margin:0 0 4px">If any of it resonates, I'm happy to walk through it.</p>
<p style="margin:0 0 32px">— Mohamed<br>
<a href="https://clinicflowautomation.com" style="color:#7c5cff">clinicflowautomation.com</a><br>
438-544-0442</p>
<p style="font-size:11px;color:#94a3b8;border-top:1px solid #e2e8f0;padding-top:12px">
Reply STOP to not hear from us again.<br>
ClinicFlow Automation · Montreal, QC · Canada
</p>
</div>`,
  attachments: [{ filename: 'clinic-preview.png', path: screenshotPath, cid: 'clinic-preview' }]
});

console.log('✓ New test email sent to m.aliben432@gmail.com');
console.log('Check Gmail — compare this version to the previous one');
