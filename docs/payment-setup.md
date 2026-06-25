# Payment Setup

## Split payment structure (default)

All tiers now use a 50/50 split — half upfront, half after the client confirms delivery. This removes all risk for the client and eliminates chargebacks.

| Tier    | Total   | First half | Second half |
|---------|---------|------------|-------------|
| Starter | $397    | $200       | $197        |
| Growth  | $997    | $500       | $497        |
| Full    | $2,497  | $1,250     | $1,247      |

**How it works:**
1. Client sends first half via Interac to `m.aliben432@gmail.com`
2. Build completes within 48 hours
3. Client confirms everything is working
4. Client sends second half

**CLI flow:**
```bash
# When first half arrives:
npm run payment:confirm -- --client "Clinic Name" --email clinic@domain.com --tier growth --method interac --payment first_half

# After delivery and client confirms:
npm run payment:confirm -- --client "Clinic Name" --email clinic@domain.com --tier growth --method interac --payment second_half
```

`first_half` → logs payment, adds to clients.json, sends onboarding email, triggers delivery reminder.
`second_half` → marks client complete, sends thank-you + referral request email, notifies operator.

---

ClinicFlow accepts three payment methods. Interac e-transfer is the default for Canadian clients (zero fees, instant). Wave and Stripe are available for clients who prefer invoiced billing or credit card.

---

## Option 1: Interac e-Transfer (no setup required)

**Already works.** Clients send to `contact@clinicflowautomation.com`.

To enable auto-deposit (so you don't have to manually accept each transfer):
1. Log into your online banking
2. Go to Interac e-Transfer settings → Auto-deposit
3. Register `contact@clinicflowautomation.com`

Once auto-deposit is on, transfers arrive in your account within minutes and you get an email notification.

---

## Option 2: Wave Invoice

Wave is free invoicing software with built-in credit card and bank transfer payment links.

1. Sign up at https://www.waveapps.com (free)
2. Go to **Sales** → **Invoices** → **Create invoice**
3. Add client name, line item (e.g. "ClinicFlow Growth Setup"), amount
4. Set payment methods: enable **Credit card** and **Bank transfer**
5. Click **Send invoice** — Wave emails the client a payment link automatically

**After the client pays:**
- Wave notifies you by email
- The invoice status updates to "Paid"
- Funds arrive in 1–2 business days (bank transfer) or 2 days (card)

Wave takes 2.9% + $0.30 for credit card; bank transfer is 1% (max $10).

**To add a reusable Wave link to `paymentService.js`:**
Replace `[WAVE_INVOICE_LINK_PLACEHOLDER]` with your Wave business profile link (Settings → Public profile) — or just generate a fresh invoice link per client.

---

## Option 3: Stripe Payment Links (for later)

---

## Step 1: Create a Stripe account

Go to https://dashboard.stripe.com and sign up (or log in). Enable your account for Canada (CAD).

---

## Step 2: Create a Payment Link for each tier

In the Stripe Dashboard:

1. Go to **Products** → **Add product**
2. Create three products:

| Product Name              | Price   | Currency | Billing  |
|---------------------------|---------|----------|----------|
| ClinicFlow Starter        | $397.00 | CAD      | One-time |
| ClinicFlow Growth         | $997.00 | CAD      | One-time |
| ClinicFlow Full           | $2,497  | CAD      | One-time |

3. After creating each product, go to **Payment Links** → **Create link**
4. Select the product, click **Create link**
5. Copy the link (format: `https://buy.stripe.com/XXXXXXXX`)

---

## Step 3: Paste the links into paymentService.js

Open `src/services/paymentService.js` and replace the placeholders:

```js
// Line 14 — Starter
stripeLink: "[STRIPE_LINK_TIER_1]",
// → replace with:
stripeLink: "https://buy.stripe.com/YOUR_STARTER_LINK",

// Line 28 — Growth
stripeLink: "[STRIPE_LINK_TIER_2]",
// → replace with:
stripeLink: "https://buy.stripe.com/YOUR_GROWTH_LINK",

// Line 42 — Full
stripeLink: "[STRIPE_LINK_TIER_3]",
// → replace with:
stripeLink: "https://buy.stripe.com/YOUR_FULL_LINK",
```

---

## Step 4: Add a webhook for payment confirmation (optional but recommended)

In Stripe Dashboard → **Developers** → **Webhooks**:

1. Add endpoint: `https://yourdomain.com/api/stripe/webhook`
2. Listen for: `checkout.session.completed`
3. When triggered, log the client name + tier + amount to `data/clients.json`

This is optional for v1 — you can manually confirm payments and run `addClient()` from `src/services/clientService.js` yourself.

---

## Step 5: Test mode first

Before going live:
1. Use Stripe's **test mode** links (toggle at top-left of dashboard)
2. Use test card `4242 4242 4242 4242` (any expiry, any CVV)
3. Confirm the payment appears in your test dashboard
4. Switch to **live mode** when ready to charge real clients

---

## Tips

- Keep your Stripe secret key in `.env` as `STRIPE_SECRET_KEY=sk_live_...`
- Never commit `.env` to git
- Set the payment link description to something the client will recognize on their bank statement: "ClinicFlow Automation Setup"
