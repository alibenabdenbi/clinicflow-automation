# Wave Invoice Setup

Wave (waveapps.com) is free invoicing software for Canadian freelancers. ClinicFlow uses it when a client requests a formal invoice or prefers credit card / bank transfer over Interac.

---

## 1. Create a Wave account

1. Go to https://www.waveapps.com and sign up (free)
2. Business name: **ClinicFlow Automation**
3. Country: **Canada** — province: **Quebec** (or your province)
4. Business type: **Freelancer / Self-employed**

---

## 2. Add your business details

Go to **Settings → Business profile**:

| Field           | Value                              |
|-----------------|------------------------------------|
| Business name   | ClinicFlow Automation              |
| Email           | contact@clinicflowautomation.com   |
| Website         | clinicflowautomation.com           |
| Phone           | (optional)                         |
| Address         | Montreal, QC, Canada               |

Upload a logo if you have one — it appears on client-facing invoices.

---

## 3. Enable payment acceptance

Go to **Payments → Set up payments**:

- Enable **Credit card** payments (2.9% + $0.30 per transaction)
- Enable **Bank transfer / ACH** payments (1%, max $10)

Wave deposits funds to your bank account in 1–2 business days.

To connect your bank account: **Payments → Payout settings → Add bank account**.

---

## 4. Create product catalogue (optional but faster)

Go to **Products & Services → Add a product** and create:

| Product                  | Price    | Currency |
|--------------------------|----------|----------|
| ClinicFlow Starter Setup | $397.00  | CAD      |
| ClinicFlow Growth Setup  | $997.00  | CAD      |
| ClinicFlow Full Setup    | $2,497.00| CAD      |
| Done-for-you Add-on      | $150.00  | CAD      |
| Monthly Support Retainer | $97.00   | CAD      |

Saved products auto-fill when you create invoices — saves time.

---

## 5. Create a client invoice manually

1. Go to **Sales → Invoices → Create invoice**
2. Select or add the client (name + email)
3. Add the relevant line item from your product catalogue
4. Set **Due date**: usually "Upon receipt" or 7 days
5. Under **Payment options**: check both Credit card and Bank transfer
6. Click **Save & send** — Wave emails the client a payment page automatically

The client gets a branded email with a "Pay now" button. No account needed on their end.

---

## 6. Use generateInvoice.js (automated)

The `generateInvoice.js` CLI builds and emails a payment request without opening Wave manually. Use it when a clinic confirms they want an invoice sent.

```bash
# Send invoice to a client
npm run invoice -- --client "Maple Leaf Dental" --tier growth --email info@mapleleafdental.ca

# Preview without sending
npm run invoice -- --client "Test Clinic" --tier starter --email test@test.com --dry-run
```

What it does:
1. Builds an invoice email using `generatePaymentEmail()` from `paymentService.js`
2. Sends it to the client via SMTP (same Zoho account used for outreach)
3. Logs the invoice to `data/invoices.json` with timestamp and status

**Note:** This does NOT create a Wave invoice automatically (Wave's API is not publicly available in their free tier). You still need to create the Wave invoice manually if the client pays by card or bank transfer. The CLI sends the payment instructions and logs the event.

---

## 7. After payment

1. Wave notifies you by email when payment is received
2. Run `npm run payment:confirm -- --email clinic@domain.com --tier growth --method wave` to update `data/clients.json`
3. Start the delivery process: `npm run deliver -- --client "Clinic Name" --tier growth --email clinic@domain.com --city Toronto`

---

## Tips

- Set up **automatic payment reminders** in Wave: Settings → Invoice reminders → 3 days before due, on due date, 7 days after
- Wave invoices are PDF-ready — you can download and attach them to your SMTP email manually if needed
- For Interac payments, just confirm by checking your bank — no Wave step needed
