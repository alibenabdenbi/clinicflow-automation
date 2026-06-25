# Twilio SMS Webhook Setup

Routes incoming SMS to +14385440442 → forwards to Mohamed's personal number (+15149617077) and logs replies.

---

## How it works

```
Clinic texts +14385440442
        │
        ▼
Twilio HTTP POST → /sms/incoming (your server)
        │
        ├─ Validates Twilio signature (rejects spoofed requests)
        ├─ Logs entry to data/sms.replies.json
        ├─ Matches sender phone against outreach.noWebsiteClinics.json
        ├─ If matched → sends notification email to Mohamed with draft reply
        │
        └─ Returns TwiML <Message to="+15149617077">SMS from [number]: [text]</Message>
                │
                ▼
        Mohamed receives the forwarded SMS on his personal phone
```

---

## Step 1 — Set the webhook URL in Twilio

1. Go to [console.twilio.com](https://console.twilio.com) → **Phone Numbers** → **Manage** → **Active numbers**
2. Click **+14385440442**
3. Scroll to **Messaging Configuration**
4. Set **"A message comes in"**:
   - Type: **Webhook**
   - URL: `https://YOUR_DOMAIN/sms/incoming`
   - Method: **HTTP POST**
5. Click **Save**

---

## Step 2 — Development: expose localhost with ngrok

Install ngrok if you haven't:
```bash
npm install -g ngrok
# or: brew install ngrok
```

Start the server and ngrok in two terminals:
```bash
# Terminal 1 — start the server
npm run dashboard

# Terminal 2 — expose port 3000
ngrok http 3000
```

ngrok will print a URL like:
```
Forwarding  https://a1b2c3d4.ngrok.io → http://localhost:3000
```

Set the Twilio webhook URL to:
```
https://a1b2c3d4.ngrok.io/sms/incoming
```

**Note:** The ngrok URL changes every session (free tier). Update the Twilio webhook each time, or buy an ngrok static domain.

Test it by texting +14385440442. You should see:
- A forwarded SMS arrive on +15149617077
- A new entry appear in `data/sms.replies.json`

---

## Step 3 — Production: deploy to Railway (always-live webhook)

1. Push the repo to GitHub
2. Go to [railway.app](https://railway.app) → **New Project** → **Deploy from GitHub repo**
3. Add environment variables from your `.env` (all `SMTP_*`, `TWILIO_*`, `NOTIFY_*`, etc.)
4. Railway auto-assigns a domain like `ore-engine-production.up.railway.app`
5. Set the Twilio webhook to:
   ```
   https://ore-engine-production.up.railway.app/sms/incoming
   ```

Railway keeps the process running 24/7 so Twilio can always reach the webhook — no ngrok needed.

---

## Environment variables required

| Variable | Description |
|---|---|
| `TWILIO_ACCOUNT_SID` | From Twilio console → Account Info |
| `TWILIO_AUTH_TOKEN` | From Twilio console → Account Info |
| `TWILIO_FROM_NUMBER` | `+14385440442` (your Twilio number) |
| `NOTIFY_PHONE` | `+15149617077` (Mohamed's personal number — forward destination) |
| `NOTIFY_EMAIL` | `m.aliben432@gmail.com` (notification email) |
| `SMTP_*` | Existing Zoho SMTP credentials (for notification emails) |

---

## Verifying the signature check

The webhook validates `X-Twilio-Signature` on every request using `TWILIO_AUTH_TOKEN`. This prevents anyone who learns the URL from spoofing SMS replies.

If you see `[sms-webhook] Invalid Twilio signature` in the logs:
- Check that `TWILIO_AUTH_TOKEN` in `.env` matches the token in Twilio console
- Check that `trust proxy` is set in the server (it is — `app.set("trust proxy", 1)`) so `req.protocol` returns `https` behind ngrok/Railway
- The signature is computed against the full URL — make sure the webhook URL in Twilio exactly matches the public URL (no trailing slash, correct scheme)

---

## Data logged

Each incoming SMS is appended to `data/sms.replies.json`:

```json
{
  "id": "SMxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
  "from": "+15141234567",
  "to": "+14385440442",
  "body": "Hi, interested in the automation",
  "receivedAt": "2026-04-12T14:23:00.000Z",
  "clinicName": "St-Laurent Dental",
  "clinicFound": true,
  "intent": "TELL_ME_MORE",
  "draftBody": "Hi,\n\nThanks for reaching out...",
  "draftSubject": "Re: ClinicFlow — how it works for St-Laurent Dental",
  "processed": false
}
```

The `processed` flag is set to `true` once `replyHandler.js` picks it up (runs every 30 minutes via the scheduler) and saves a draft to `data/reply-drafts/`.
