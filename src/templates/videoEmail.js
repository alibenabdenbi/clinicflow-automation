// src/templates/videoEmail.js
// Video thumbnail email — higher click rate than plain text.
// Thumbnail links to /live page. No actual video needed.
import { TRACKED } from '../services/clickTracker.js';

export function buildVideoEmail(clinic) {
  const firstName = clinic.ownerName?.split(' ')[0] ||
                    clinic.contactName?.split(' ')[0] ||
                    'there';
  const city = (clinic.city || 'your city').split(',')[0].trim();
  const name = clinic.clinicName;
  const hasPain = (clinic.painSignals || []).length > 0;

  const clinicSlug  = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  const liveUrl     = TRACKED.live(name);
  const calendlyUrl = TRACKED.calendly(name);

  const subject = hasPain
    ? `${name} — I recorded something for you`
    : `${city} clinics — what happens after a missed call`;

  const textBody = `Hi ${firstName},

I put together a short clip showing what happens when a patient calls ${name} and no one picks up — and what the system does automatically after.

Watch here: clinicflowautomation.com/live

Takes about 60 seconds to see the full picture.

Or experience it yourself: text anything to +1 (575) 573-5822

— Mohamed
438-544-0442

P.S. Want to talk through it? Book 15 min: ${calendlyUrl}

Or if this looks relevant, I have one free pilot spot open this week — full setup, no cost, 30 days.

Reply STOP to opt out. ClinicFlow Automation · Montreal, QC`;

  const htmlBody = `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;color:#1e293b;line-height:1.6">
  <p style="margin:0 0 16px;font-size:15px">Hi ${firstName},</p>

  <p style="margin:0 0 20px;font-size:15px">
    I put together a quick look at what happens when a patient calls
    <strong>${name}</strong> and no one picks up — and what the system does automatically after.
  </p>

  <!-- Video Thumbnail -->
  <a href="https://clinicflowautomation.com/live?utm_source=email&utm_medium=video&utm_campaign=${encodeURIComponent(name)}&utm_content=thumbnail"
     style="display:block;margin:0 0 24px;text-decoration:none;border-radius:12px;overflow:hidden;position:relative;max-width:560px">
    <div style="position:relative;background:#0b0f17;border-radius:12px;overflow:hidden;line-height:0">
      <img src="https://clinicflowautomation.com/api/thumbnail?clinic=${encodeURIComponent(clinicSlug)}&city=${encodeURIComponent(city)}"
           alt="See ClinicFlow running live — ${name} dashboard"
           width="560"
           style="display:block;width:100%;border-radius:12px;max-width:560px">
      <table role="presentation" style="position:absolute;top:0;left:0;width:100%;height:100%;border-collapse:collapse">
        <tr><td style="text-align:center;vertical-align:middle">
          <div style="display:inline-block;width:64px;height:64px;background:rgba(255,255,255,0.95);border-radius:50%;box-shadow:0 4px 20px rgba(0,0,0,0.4);line-height:64px;text-align:center">
            <span style="display:inline-block;width:0;height:0;border-style:solid;border-width:11px 0 11px 22px;border-color:transparent transparent transparent #0b0f17;margin-left:5px;vertical-align:middle"></span>
          </div>
        </td></tr>
      </table>
      <div style="position:absolute;bottom:10px;right:10px;background:rgba(0,0,0,0.75);color:#fff;padding:3px 8px;border-radius:4px;font-size:11px;font-family:monospace;font-weight:700">LIVE</div>
    </div>
  </a>

  <p style="margin:0 0 20px;font-size:14px;color:#64748b">Takes about 60 seconds to see the full picture.<br><br>Or experience it yourself — text anything to <strong>+1 (575) 573-5822</strong></p>

  <p style="margin:0 0 4px;font-size:15px">— Mohamed</p>
  <p style="margin:0 0 28px;font-size:14px;color:#64748b">438-544-0442</p>

  <div style="padding:14px 16px;background:#f8fafc;border-radius:8px;border-left:3px solid #7c5cff">
    <p style="margin:0;font-size:13px;color:#64748b">
      <strong style="color:#0f172a">P.S.</strong> Want to talk through it first?
      <a href="${calendlyUrl}" style="color:#39d98a">Book 15 min here →</a><br>
      Or if this looks relevant — I have one free pilot spot open this week. Full setup, no cost, 30 days.
    </p>
  </div>

  <p style="margin:24px 0 0;font-size:11px;color:#94a3b8;border-top:1px solid #e2e8f0;padding-top:12px">
    Reply STOP to opt out. ClinicFlow Automation · Montreal, QC · Canada
  </p>
</div>`;

  return { subject, textBody, htmlBody };
}
