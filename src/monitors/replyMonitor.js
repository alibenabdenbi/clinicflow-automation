// src/monitors/replyMonitor.js
// Monitors Gmail via IMAP for replies to outreach emails.
// Sends SMS to Mohamed immediately when reply detected.
// Runs every 15 minutes via scheduler.

import Imap from 'imap';
import { simpleParser } from 'mailparser';
import https from 'https';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
dotenv.config();

const __dirname    = path.dirname(fileURLToPath(import.meta.url));
const ROOT         = path.resolve(__dirname, '../..');
const SEEN_FILE    = path.join(ROOT, 'data', 'reply-monitor-seen.json');
const REPLIES_FILE = path.join(ROOT, 'data', 'replies-detected.json');
const DENTAL_PATH  = path.join(ROOT, 'data', 'outreach.localDentists.json');

const OUR_EMAIL = (process.env.IMAP_USER || process.env.SMTP_USER || '').toLowerCase().trim();
const NOTIFY_TO = process.env.NOTIFY_PHONE || process.env.TWILIO_TO_NUMBER || '+15149617077';

// ─── Seen set (prevents re-alerting) ─────────────────────────────────────────

function loadSeen() {
  try { return new Set(JSON.parse(fs.readFileSync(SEEN_FILE, 'utf8'))); } catch { return new Set(); }
}
function saveSeen(seen) {
  fs.mkdirSync(path.dirname(SEEN_FILE), { recursive: true });
  fs.writeFileSync(SEEN_FILE, JSON.stringify([...seen].slice(-2000)));
}

// ─── Reply log ────────────────────────────────────────────────────────────────

function saveReply(reply) {
  let replies = [];
  try { replies = JSON.parse(fs.readFileSync(REPLIES_FILE, 'utf8')); } catch {}
  replies.unshift(reply);
  fs.writeFileSync(REPLIES_FILE, JSON.stringify(replies.slice(0, 200), null, 2));
}

// ─── Personalized auto-response ───────────────────────────────────────────────

const WARMUP_DOMAINS = ['getcleanmarketedge','nowe-firmy','paytechhcm','signalhire','virtualassis'];
const AUTO_SENT_FILE = path.join(ROOT, 'data', 'auto-responses-sent.json');

async function sendPersonalizedAutoResponse(reply) {
  if (!reply.fromEmail) return;
  if (reply.isAutoReply) return;
  if (WARMUP_DOMAINS.some(d => reply.fromEmail.includes(d))) return;

  // Idempotent — never send twice to the same address
  let sent = [];
  try { sent = JSON.parse(fs.readFileSync(AUTO_SENT_FILE, 'utf8')); } catch {}
  if (sent.includes(reply.fromEmail)) return;

  try {
    const { sendMail } = await import('../services/mailer.js');

    const dental = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/outreach.localDentists.json'), 'utf8'));
    const physio = fs.existsSync(path.join(ROOT, 'data/outreach.physioClinics.json'))
      ? JSON.parse(fs.readFileSync(path.join(ROOT, 'data/outreach.physioClinics.json'), 'utf8'))
      : [];
    const clinic      = [...dental, ...physio].find(c => c.email === reply.fromEmail);
    const clinicName  = clinic?.clinicName || reply.clinicName || 'your clinic';
    const firstName   = clinic?.ownerName?.split(' ')[0] || '';
    const isQuebec    = clinic?.language === 'fr';
    const slug        = clinicName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const pageExists  = fs.existsSync(path.join(ROOT, `public/netlify-deploy/for/${slug}.html`));
    const pageLink    = pageExists
      ? `\n\nI also built this page specifically for ${clinicName}:\nclinicflowautomation.com/for/${slug}`
      : '';
    const subjectBase = (reply.subject || 'ClinicFlow').replace(/^Re:\s*/i, '');

    const body = isQuebec
      ? `${firstName ? 'Bonjour ' + firstName + ',' : 'Bonjour,'}\n\nMerci pour votre réponse — je reviens vers vous dans l'heure.\n\nEn attendant, vous pouvez voir le système en action :\nclinicflowautomation.com/fr\n\nOu l'essayer comme un patient — textez n'importe quoi au :\n+1 (575) 573-5822${pageLink}\n\n— Mohamed\n438-544-0442`
      : `${firstName ? 'Hi ' + firstName + ',' : 'Hi,'}\n\nThanks for getting back to me — I'll follow up within the hour.\n\nIn the meantime you can see the system running live:\nclinicflowautomation.com/live\n\nOr experience it as a patient would — text anything to:\n+1 (575) 573-5822${pageLink}\n\n— Mohamed\n438-544-0442`;

    await sendMail({
      to: reply.fromEmail,
      subject: `Re: ${subjectBase}`,
      text: body,
    });

    sent.push(reply.fromEmail);
    fs.mkdirSync(path.dirname(AUTO_SENT_FILE), { recursive: true });
    fs.writeFileSync(AUTO_SENT_FILE, JSON.stringify(sent, null, 2));
    console.log(`  ✓ Auto-response sent to: ${reply.fromEmail}`);
  } catch (e) {
    console.error(`  Auto-response failed: ${e.message}`);
  }
}

// ─── SMS alert ────────────────────────────────────────────────────────────────

async function sendSMSAlert(reply) {
  const SID   = process.env.TWILIO_ACCOUNT_SID;
  const TOKEN = process.env.TWILIO_AUTH_TOKEN;
  const FROM  = process.env.TWILIO_FROM_NUMBER;
  if (!SID || !TOKEN || !FROM) return;

  const emoji = reply.positiveSignal ? '🔥' : '📧';
  const body  = `${emoji} REPLY: ${reply.clinicName}\nFrom: ${reply.fromEmail}\nSubj: ${(reply.subject || '').slice(0, 50)}\nPreview: ${(reply.preview || '').slice(0, 80)}\nCheck Gmail NOW`;

  try {
    const creds   = Buffer.from(`${SID}:${TOKEN}`).toString('base64');
    const payload = new URLSearchParams({ From: FROM, To: NOTIFY_TO, Body: body }).toString();
    await new Promise((resolve, reject) => {
      const req = https.request({
        hostname: 'api.twilio.com',
        path:     `/2010-04-01/Accounts/${SID}/Messages.json`,
        method:   'POST',
        headers:  { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: `Basic ${creds}`, 'Content-Length': Buffer.byteLength(payload) },
        rejectUnauthorized: false,
      }, (res) => { res.resume(); resolve(); });
      req.on('error', reject);
      req.write(payload);
      req.end();
    });
    console.log(`✓ SMS alert sent → ${NOTIFY_TO}`);
  } catch(e) { console.error('SMS failed:', e.message); }
}

// ─── Reply classifier ─────────────────────────────────────────────────────────

function classifyReply(subject, body) {
  const text = ((subject || '') + ' ' + (body || '')).toLowerCase();

  const POSITIVE = ['interested', 'yes', 'sounds good', 'tell me more', 'how does', 'when can',
    'schedule', 'call me', 'demo', 'pilot', 'free', 'setup', 'forward', 'try it', 'works',
    'perfect', 'great', 'love to', 'want to', 'sign up', 'available', 'next steps', 'get started',
    'reply to confirm', 'let me know', 'absolutely'];
  const NEGATIVE  = ['not interested', 'not in need', 'not looking', 'unsubscribe', 'remove me',
    'stop emailing', 'do not contact', 'no thanks', 'no thank you', 'please remove',
    'not relevant', 'doesn\'t apply', 'don\'t need'];
  const AUTO      = ['out of office', 'auto-reply', 'automatic reply', 'vacation', 'holiday',
    'i am away', 'je suis absent', 'will be back', 'will return', 'currently away'];

  const isPositive  = POSITIVE.some(k => text.includes(k));
  const isNegative  = NEGATIVE.some(k => text.includes(k));
  const isAutoReply = AUTO.some(k => text.includes(k));

  return { isPositive, isNegative, isAutoReply, positiveSignal: isPositive && !isNegative };
}

// ─── Clinic lookup ────────────────────────────────────────────────────────────

function findClinic(fromEmail) {
  try {
    const dental = JSON.parse(fs.readFileSync(DENTAL_PATH, 'utf-8'));
    const addr = fromEmail.toLowerCase();
    let match = dental.find(c => (c.email || '').toLowerCase() === addr);
    if (!match) {
      const domain = addr.split('@')[1];
      if (domain) match = dental.find(c => (c.email || '').toLowerCase().endsWith('@' + domain));
    }
    return match || null;
  } catch { return null; }
}

function markReplied(clinic, classification, receivedAt) {
  try {
    const dental = JSON.parse(fs.readFileSync(DENTAL_PATH, 'utf-8'));
    const idx = dental.findIndex(d => d.email === clinic.email);
    if (idx === -1) return;
    dental[idx].replied              = true;
    dental[idx].repliedAt            = receivedAt;
    dental[idx].replyClassification  = classification.positiveSignal ? 'interested'
      : classification.isNegative ? 'unsubscribed' : 'neutral';
    if (classification.isNegative) dental[idx].status = 'bounced'; // treat opt-outs as done
    fs.writeFileSync(DENTAL_PATH, JSON.stringify(dental, null, 2));
  } catch(e) { console.error('DB update failed:', e.message); }
}

// ─── IMAP fetch ───────────────────────────────────────────────────────────────

export async function checkForReplies() {
  return new Promise((resolve) => {
    const seen      = loadSeen();
    const newReplies = [];

    const imap = new Imap({
      user:        process.env.IMAP_USER  || OUR_EMAIL,
      password:    process.env.IMAP_PASS  || process.env.GMAIL_APP_PASSWORD || '',
      host:        process.env.IMAP_HOST  || 'imap.gmail.com',
      port:        Number(process.env.IMAP_PORT || 993),
      tls:         true,
      tlsOptions:  { rejectUnauthorized: false },
      authTimeout: 15000,
    });

    const done = (result) => { try { imap.end(); } catch {} resolve(result); };

    imap.once('error', (err) => {
      console.error('IMAP error:', err.message);
      done({ checked: 0, newReplies: [] });
    });

    imap.once('ready', () => {
      imap.openBox('INBOX', true, (err) => {
        if (err) return done({ checked: 0, newReplies: [] });

        const since = new Date(Date.now() - 72 * 60 * 60 * 1000); // last 72h
        imap.search(['ALL', ['SINCE', since]], (err, results) => {
          if (err || !results?.length) return done({ checked: 0, newReplies: [] });

          const fetch = imap.fetch(results.slice(-100), { bodies: '' }); // max 100
          const raws  = [];

          fetch.on('message', (msg) => {
            let buf = '';
            msg.on('body', (stream) => stream.on('data', (chunk) => buf += chunk.toString('utf8')));
            msg.once('end', () => raws.push(buf));
          });

          fetch.once('error', (err) => console.error('Fetch error:', err.message));

          fetch.once('end', async () => {
            for (const raw of raws) {
              try {
                const parsed = await simpleParser(raw);
                const msgId  = parsed.messageId;
                if (!msgId || seen.has(msgId)) continue;

                const from    = parsed.from?.text || '';
                const subject = parsed.subject   || '';

                // Skip mailer-daemon / bounce notifications — log as bounce, don't alert
                const fromAddr = (parsed.from?.value?.[0]?.address || '').toLowerCase();
                const subjectLow = subject.toLowerCase();

                const BOUNCE_SENDERS = ['mailer-daemon', 'postmaster', 'noreply', 'no-reply',
                  'bounce', 'bounces', 'donotreply', 'do-not-reply', 'notifications', 'delivery'];
                const BOUNCE_SUBJECTS = ['delivery status notification', 'mail delivery failed',
                  'undeliverable', 'returned mail', 'failure notice', 'delivery failure',
                  'message not delivered', 'mail system error', 'returned to sender',
                  'non-delivery report', 'delivery notification'];

                const isBounce = BOUNCE_SENDERS.some(s => fromAddr.includes(s)) ||
                                 BOUNCE_SUBJECTS.some(s => subjectLow.includes(s));

                if (isBounce) {
                  seen.add(msgId);
                  // Extract bounced address and mark in DB
                  const bodyRaw = parsed.text || '';
                  const bouncedMatch = bodyRaw.match(
                    /(?:wasn't delivered to|failed.*?to|delivering.*?to)\s+([^\s]+@[^\s]+)/i
                  ) || bodyRaw.match(/([a-zA-Z0-9._+-]+@[a-zA-Z0-9._+-]+\.[a-zA-Z]{2,})/);
                  if (bouncedMatch) {
                    const bouncedEmail = bouncedMatch[1].replace(/[^a-zA-Z0-9@._+-]/g, '');
                    console.log(`  ⊘ Bounce: ${bouncedEmail}`);
                    try {
                      const dental = JSON.parse(fs.readFileSync(DENTAL_PATH, 'utf-8'));
                      const bi = dental.findIndex(d => (d.email||'').toLowerCase() === bouncedEmail.toLowerCase());
                      if (bi !== -1 && dental[bi].status !== 'bounced') {
                        dental[bi].status = 'bounced';
                        dental[bi].bouncedAt = new Date().toISOString();
                        dental[bi].bounceReason = fromAddr;
                        fs.writeFileSync(DENTAL_PATH, JSON.stringify(dental, null, 2));
                      }
                    } catch {}
                  }
                  continue;
                }

                // Only process replies (has Re: or In-Reply-To)
                const isReply = subjectLow.startsWith('re:') ||
                                !!parsed.inReplyTo || !!(parsed.references?.length);
                if (!isReply) { seen.add(msgId); continue; }

                // Skip our own emails
                if (fromAddr === OUR_EMAIL) { seen.add(msgId); continue; }

                const bodyText = parsed.text || parsed.html?.replace(/<[^>]+>/g, ' ') || '';
                const classification = classifyReply(subject, bodyText);

                // Skip auto-replies that aren't positive
                if (classification.isAutoReply && !classification.isPositive) {
                  seen.add(msgId);
                  console.log(`  ⊘ Auto-reply skipped: ${fromAddr}`);
                  continue;
                }

                const clinic = findClinic(fromAddr);
                const reply  = {
                  messageId:   msgId,
                  from,
                  fromEmail:   fromAddr,
                  subject,
                  preview:     bodyText.slice(0, 200).replace(/\s+/g, ' ').trim(),
                  clinicName:  clinic?.clinicName || fromAddr,
                  city:        clinic?.city        || '',
                  receivedAt:  parsed.date?.toISOString() || new Date().toISOString(),
                  ...classification,
                };

                seen.add(msgId);
                newReplies.push(reply);
                saveReply(reply);
                await sendSMSAlert(reply);
                await sendPersonalizedAutoResponse(reply);

                if (clinic) markReplied(clinic, classification, reply.receivedAt);

                const tag = reply.positiveSignal ? '🔥 POSITIVE' : reply.isNegative ? '❌ OPT-OUT' : '📧 neutral';
                console.log(`  ${tag}: ${reply.clinicName} — "${reply.preview.slice(0, 60)}"`);
              } catch(e) { /* malformed email — skip */ }
            }

            saveSeen(seen);
            done({ checked: raws.length, newReplies });
          });
        });
      });
    });

    imap.connect();
  });
}

// ─── CLI entry point ──────────────────────────────────────────────────────────
const isMain = process.argv[1] &&
  (process.argv[1].endsWith('replyMonitor.js') || process.argv[1].endsWith('replyMonitor'));

if (isMain) {
  console.log('Checking replies...');
  const result = await checkForReplies();
  console.log(`Checked ${result.checked} emails, found ${result.newReplies.length} new replies`);
}
