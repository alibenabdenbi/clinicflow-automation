import dotenv from 'dotenv';
dotenv.config();
import { generateProspectScreenshot } from '../src/services/screenshotEngine.js';
import { sendMail } from '../src/services/mailer.js';
import fs from 'fs';

const clinic = {
  clinicName: 'Toronto Physiotherapy',
  city: 'Toronto',
  rating: 4.9,
  reviewCount: 1235,
  type: 'physio',
};

const screenshotPath = await generateProspectScreenshot(clinic);
console.log('Screenshot:', screenshotPath, Math.round(fs.statSync(screenshotPath).size/1024), 'KB');

await sendMail({
  to: 'm.aliben432@gmail.com',
  subject: 'Toronto Physiotherapy — workflow reference I put together',
  text: `Hi,

I was mapping out how Toronto physio clinics typically handle missed calls — and used Toronto Physiotherapy as the reference point while building this.

A few workflow patterns stood out:
— missed-call recovery timing
— inactive patient reactivation
— reminder consistency rates
— front-desk follow-up visibility

No pitch — I just build operational systems for clinics and thought you might find it interesting.

Still refining this — would be curious whether any of it reflects what actually happens at Toronto Physiotherapy.

— Mohamed
clinicflowautomation.com
438-544-0442

---
Reply STOP to not hear from us again.
ClinicFlow Automation · Montreal, QC · Canada`,
  html: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;color:#1e293b;line-height:1.6">
<p style="margin:0 0 16px">Hi,</p>
<p style="margin:0 0 20px">I was mapping out how Toronto physio clinics typically handle missed calls — and used <strong>Toronto Physiotherapy</strong> as the reference point while building this.</p>
<img src="cid:clinic-preview" style="width:100%;border-radius:8px;margin:20px 0;box-shadow:0 4px 24px rgba(0,0,0,0.12)">
<p style="margin:0 0 8px;color:#64748b;font-size:14px">A few workflow patterns stood out:</p>
<ul style="margin:0 0 20px;padding-left:20px;color:#475569;font-size:14px;line-height:2">
  <li>missed-call recovery timing</li>
  <li>inactive patient reactivation</li>
  <li>reminder consistency rates</li>
  <li>front-desk follow-up visibility</li>
</ul>
<p style="margin:0 0 20px;color:#64748b;font-size:14px">No pitch — I just build operational systems for clinics and thought you might find it interesting.</p>
<p style="margin:0 0 4px">Still refining this — would be curious whether any of it reflects what actually happens at <strong>Toronto Physiotherapy</strong>.</p>
<br>
<p style="margin:0 0 4px">— Mohamed</p>
<p style="margin:0 0 4px"><a href="https://clinicflowautomation.com" style="color:#7c5cff;text-decoration:none">clinicflowautomation.com</a></p>
<p style="margin:0 0 32px">438-544-0442</p>
<p style="font-size:11px;color:#94a3b8;border-top:1px solid #e2e8f0;padding-top:12px">
Reply STOP to not hear from us again.<br>
ClinicFlow Automation · Montreal, QC · Canada
</p>
</div>`,
  attachments: [{ filename: 'clinic-preview.png', path: screenshotPath, cid: 'clinic-preview' }]
});

console.log('✓ V3 test sent to m.aliben432@gmail.com');
console.log('Check Gmail — confirm staff names, system sidebar, and new copy');
