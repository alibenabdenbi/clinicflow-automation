# Missed Call Follow-Up Sequence — Christie Park Dental

This sequence fires automatically when a patient calls and no one answers.
Trigger: missed call detected → Email 1 fires within 2 minutes.

---

## Email 1 — Within 2 Minutes of Missed Call

**Subject:** We just missed your call — Christie Park Dental

Hi [PatientFirstName],

We saw your call come in and we're sorry we missed you — we were most likely with another patient.

We'll call you back as soon as we're free, usually within the hour. If you'd rather not wait, you can book directly at [BookingLink] — it only takes a minute.

Talk soon,
The Christie Park Dental Team
[ClinicPhone]

---

## Email 2 — 2 Hours Later (if no response to Email 1)

**Subject:** Still hoping to connect — Christie Park Dental

Hi [PatientFirstName],

We tried to get back to you but may have missed you again. We haven't forgotten.

Whenever it's convenient, give us a call at [ClinicPhone] or book a time that works for you directly at [BookingLink] — no hold times, no phone tag.

The Christie Park Dental Team

---

## Email 3 — Next Morning (final follow-up)

**Subject:** One last try from Christie Park Dental

Hi [PatientFirstName],

We wanted to reach out one more time. If you're still looking for a dentist in Toronto, we'd genuinely love to help.

Call us at [ClinicPhone] whenever you're ready, or book at [BookingLink]. No pressure either way.

Warmly,
The Christie Park Dental Team

---

**Implementation note:** These messages fire automatically — no front desk action required. Patient replies land in your regular inbox. If a patient books, the remaining emails in the sequence cancel automatically.

**Privacy:** This automation complies with PIPEDA (Canadian privacy law). Patient data is never stored or shared by ClinicFlow.