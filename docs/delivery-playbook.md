# ClinicFlow Delivery Playbook

This is your step-by-step guide for what to do after a clinic pays — from payment confirmation to a happy client 7 days later.

---

## When a clinic pays for Starter ($397)

### The 5 deliverables you build:

1. **Missed call auto-text** — A Twilio (or equivalent) flow that sends an SMS within 2 minutes of a missed call: *"Hi, you've reached [Clinic Name]. Sorry we missed you — you can book online at [link] or reply here and we'll call you right back."*

2. **Appointment reminder: 72-hour text** — Automated SMS sent 3 days before appointment: *"Hi [First Name], just a reminder of your appointment at [Clinic Name] on [Date] at [Time]. Reply YES to confirm or call us at [phone] to reschedule."*

3. **Appointment reminder: 24-hour text** — Final confirmation SMS the day before: *"Hi [First Name], see you tomorrow at [Time] at [Clinic Name]. Reply STOP if you need to cancel."*

4. **Weekly email report** — A Monday morning email to the clinic owner showing: calls missed, texts sent, responses received, appointments booked via text. Can be a manually-generated summary in v1.

5. **Setup documentation** — A 1-page PDF explaining what was set up, how to pause/stop it, and who to contact. Delivered by email.

### What you need from the clinic before you start:
- Their phone number (the one patients call)
- Their booking link (if they have online booking)
- Their preferred reply-to number or email
- Their practice management software name (for future reference)

---

## When a clinic pays for Growth ($997)

### Everything in Starter, plus:

6. **Recall campaign — 5-month message** — *"Hi [First Name], it's been about 5 months since your last visit at [Clinic Name]. Time for a cleaning! Book at [link] or call us at [phone]."*

7. **Recall campaign — 6-month message** — *"Hi [First Name], a friendly reminder from [Clinic Name] — your 6-month checkup is due. Book anytime at [link]."*

8. **Recall campaign — 7-month final nudge** — *"Hi [First Name], last reminder from [Clinic Name] — if you'd like to keep your spot on our patient list, book your cleaning at [link]. No hard feelings if now isn't a good time."*

9. **New patient welcome sequence** — 3 messages over the first 2 weeks after a patient's first visit: day 1 (thank you + what to expect), day 7 (check-in), day 14 (recall reminder setup + review request).

10. **Post-appointment follow-up** — 2 days after any appointment: *"Thanks for coming in [First Name]! If you have a moment, we'd love a Google review: [link]. Your next cleaning can be booked at [link]."*

### 90-day check-in:
Schedule a 15-minute video call at the 90-day mark. Review: how many messages sent, any issues, what to adjust.

---

## When a clinic pays for Full ($2,497)

### Everything in Growth, plus:

11. **Custom messaging** — Rewrite all SMS templates in the clinic's brand voice. Review their website copy, ask 3 questions about their tone, then write custom versions.

12. **Booking software integration** — Connect the automation to their PMS (Jane App, Dentrix, Curve, etc.) so appointment data flows automatically. Specifics depend on the software.

13. **Staff training session** — 1-hour video call with front desk staff. Walk through: what the system does, what texts they'll see, how to handle replies, how to pause campaigns.

14. **Priority delivery** — Commit to completing setup within 5 business days of receiving their info.

15. **6-month check-in** — Calendar reminder to yourself. At 6 months: email the clinic, review stats, offer 1 round of adjustments at no charge.

---

## How to deliver

### Files to send on completion:
- `[ClinicName]-setup-summary.pdf` — what was built, how it works, how to pause it
- `[ClinicName]-message-templates.txt` — all SMS/email text they can edit in future
- (Full tier only) `[ClinicName]-training-recording.mp4` — recording of the training call

### Email to send on delivery:

**Subject:** ClinicFlow is live for [Clinic Name] — here's what was set up

**Body:**
> Hi [Name],
>
> Your ClinicFlow automation is live as of today.
>
> Attached: a summary of everything that was set up, including your message templates and instructions for making changes.
>
> What happens next:
> - You don't need to do anything — the system runs in the background
> - You'll receive your first weekly report next Monday
> - If anything looks off or needs adjusting, reply here
>
> Congratulations on getting this off your plate.
>
> Mohamed

---

## The first 7 days after delivery

**Day 1:** Send delivery email with attachments. Mark the client as delivered in `data/clients.json` using `markDelivered()`.

**Day 2:** Check that the missed call flow fired at least once (or simulate a missed call manually to test). Email the clinic: *"Just checking in — everything is running. Have you had a chance to look at the setup summary?"*

**Day 3:** No action needed unless the clinic responds.

**Day 5:** Send a brief check-in: *"Hi [Name], it's been a few days since go-live. Any questions or anything you'd like to adjust?"*

**Day 7:** First weekly report goes out. This is the first real proof-of-value moment. Make sure the report is clear and shows something positive (even if small — e.g., "3 missed calls recovered this week").

**Day 7 action:** Log into your send records, confirm report was sent, note any response from the clinic.

---

## What to do if the client isn't happy

1. Reply within 4 hours. Always.
2. Ask one clarifying question before defending anything: *"What specifically isn't working the way you expected?"*
3. If it's a setup issue: fix it within 24 hours, no charge.
4. If it's an expectation mismatch: refer back to the deliverables they were sent before paying.
5. If they want a refund: evaluate case by case. For Starter/Growth, offer to fix the issue first. If they're still unhappy after the fix, refund. Not worth the friction.

---

## Tracking your clients

All active clients are stored in `data/clients.json`.
Use `src/services/clientService.js` to add, update, and query them.

```bash
# Add a new client after payment confirmed
node -e "
import('./src/services/clientService.js').then(m =>
  m.addClient('Green Apple Dentistry', 'Vaughan', 'greenappledentistry@gmail.com', 'growth', new Date().toISOString())
)"
```

---

## Accepted payment methods

When a clinic is ready to pay, offer all three — lead with Interac since it's zero-fee for Canadian clients:

**1. Interac e-Transfer (preferred)**
- Send to: `contact@clinicflowautomation.com`
- Ask them to include the clinic name in the message field
- You'll receive an email notification instantly; no action needed to accept if auto-deposit is enabled

**2. Wave invoice (credit card or bank transfer)**
- Log into Wave (wave.com) → Invoices → Create invoice
- Set the client name, amount, and due date (suggest 7 days)
- Send via Wave — it emails them a professional invoice with a card payment link built in
- Wave takes ~2.9% + $0.30 for card payments; bank transfer is free
- Replace `[WAVE_INVOICE_LINK_PLACEHOLDER]` in `paymentService.js` with the invoice link once created

**3. Stripe (credit card link)**
- Use only if the clinic specifically asks for a direct card link
- See `docs/payment-setup.md` for how to create Stripe payment links
- Replace `[STRIPE_LINK_PLACEHOLDER]` in `paymentService.js` once created

**After payment arrives:**
1. Reply to confirm receipt: *"Got it — thank you. I'll follow up within one business day to get started."*
2. Run `addClient()` to log them in `data/clients.json`
3. Begin delivery checklist for their tier
