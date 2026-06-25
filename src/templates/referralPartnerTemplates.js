// src/templates/referralPartnerTemplates.js
// Email templates for referral partner outreach (accountants, consultants, IT).
// Used by src/cli/sendReferralOutreach.js

export function fill(template, { firstName = "there", company = "" } = {}) {
  return {
    subject: template.subject.replace(/\{firstName\}/g, firstName).replace(/\{company\}/g, company),
    body:    template.body.replace(/\{firstName\}/g, firstName).replace(/\{company\}/g, company),
  };
}

export const DENTAL_ACCOUNTANT = {
  subject: "Quick question — your dental clinic clients",
  body: `Hi {firstName},

I work with dental clinics across Canada on patient communication automation — missed call follow-up, appointment reminders, patient reactivation.

I'm looking to connect with accountants who work with dental clinic owners. The reason: your clients trust your recommendations, and I'd like to offer you a referral arrangement — $250 per clinic that signs up through you, no selling required on your part.

You just introduce us by email. I handle everything else.

If any of your clients mention losing patients to missed calls or no-shows, I'm the person to know.

Worth a quick call to see if it's a fit?

Mohamed
ClinicFlow Automation
contact@clinicflowautomation.com
438-544-0442
clinicflowautomation.com/referral

---
To opt out of future emails, reply with 'unsubscribe'.
ClinicFlow Automation · Montreal, QC · Canada`,
};

export const DENTAL_CONSULTANT = {
  subject: "Referral partnership — dental clinic automation",
  body: `Hi {firstName},

I run ClinicFlow Automation — done-for-you patient communication for Canadian dental clinics. Missed call follow-up, appointment reminders, patient reactivation. One-time setup, no monthly fees.

I'm reaching out to dental consultants specifically because you're already working with clinic owners on growth — and this complements that work directly.

The arrangement: $250 for every Growth package client you refer, $375 for Premium. No selling. Just an introduction. I close it.

Happy to send you a one-pager or jump on a 15-minute call.

Mohamed
ClinicFlow Automation
contact@clinicflowautomation.com
438-544-0442
clinicflowautomation.com/referral

---
To opt out of future emails, reply with 'unsubscribe'.
ClinicFlow Automation · Montreal, QC · Canada`,
};

export const DENTAL_IT = {
  subject: "Your dental clinic clients — quick question",
  body: `Hi {firstName},

You set up and support the tech at dental clinics. I automate their patient communication — missed calls, reminders, reactivation. We're solving different problems for the same clients.

I pay $250 per clinic referral, no strings. If a client ever mentions losing patients to unanswered calls or no-shows, just forward them my contact.

That's the whole arrangement.

Mohamed
ClinicFlow Automation
contact@clinicflowautomation.com
438-544-0442
clinicflowautomation.com/referral

---
To opt out of future emails, reply with 'unsubscribe'.
ClinicFlow Automation · Montreal, QC · Canada`,
};

export const TEMPLATES = {
  dental_accountant: DENTAL_ACCOUNTANT,
  accountant:        DENTAL_ACCOUNTANT,
  dental_consultant: DENTAL_CONSULTANT,
  consultant:        DENTAL_CONSULTANT,
  dental_it:         DENTAL_IT,
  it:                DENTAL_IT,
};
