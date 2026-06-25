// src/cli/buildConversionPriority.js
// Scores all contacted clinics and saves the top 20 conversion priority list.
// Also copies to public/netlify-deploy/data/ so the signals dashboard picks it up on next deploy.
// Usage: npm run priority

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT    = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const dental  = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/outreach.localDentists.json'), 'utf8'));
const physio  = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/outreach.physioClinics.json'), 'utf8'));
const sequence = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/hitlist/sequence-tracker.json'), 'utf8'));
const all     = [...dental, ...physio];

const seqMap = {};
sequence.forEach(s => { seqMap[s.email] = s; });

const CONTACTED = new Set(['sent','followup_1_sent','followup_2_sent','followup_3_sent','personal_followup_sent','cooling_off','in_sequence']);
const EXCLUDE   = new Set(['bounced','opted-out','unsubscribed','skip_low_quality']);

const scored = all
  .filter(c => {
    const seq = seqMap[c.email];
    return (CONTACTED.has(c.status) || seq?.touches?.touch1_email === 'sent')
      && !EXCLUDE.has(c.status) && !c.replied && c.email;
  })
  .map(c => {
    const seq = seqMap[c.email];
    let score = 0;
    const reasons = [];

    if (c.openCount > 3)      { score += 40; reasons.push('opened 4+ times'); }
    else if (c.openCount > 1) { score += 20; reasons.push('opened multiple times'); }
    else if (c.openCount > 0) { score += 10; reasons.push('opened once'); }
    if (c.mobileOpen)         { score += 30; reasons.push('mobile open'); }

    if (c.painSignals?.length > 0) { score += 35; reasons.push('pain signal: ' + c.painSignals[0]?.slice(0, 25)); }

    const local = (c.email || '').split('@')[0].toLowerCase();
    const isNamed = local.length > 2 && local.length < 15 &&
      !['info','contact','admin','office','reception','front','booking','appointment','dental','clinic'].includes(local);
    if (isNamed) { score += 25; reasons.push('named email'); }

    if (c.pilotOfferSent || c.personalFollowupSent)        { score += 20; reasons.push('got personal/pilot email'); }
    if (seq?.personalizedPageSent || c.personalizedPageSent) { score += 15; reasons.push('got personal page'); }
    if (c.videoEmailSent)                                   { score += 10; reasons.push('got video email'); }
    if (seq?.touches?.touch2_followup === 'sent')           { score += 12; reasons.push('touch 2 sent'); }
    if (seq?.touches?.touch3_closer === 'sent')             { score += 18; reasons.push('touch 3 sent'); }

    const phone = c.phone || c.googlePhone || seq?.phone;
    if (phone)           { score += 10; reasons.push('has phone'); }
    if (c.rating >= 4.8) { score += 8;  reasons.push('4.8+ stars'); }

    const lastTouch = seq?.touch2SentAt || seq?.touch1SentAt || c.sentAt || c.lastContactedAt;
    if (lastTouch) {
      const days = (Date.now() - new Date(lastTouch).getTime()) / 86400000;
      if (days < 2)       { score += 15; reasons.push('touched today'); }
      else if (days < 5)  { score += 8;  reasons.push('touched this week'); }
    }

    return {
      clinicName: c.clinicName || seq?.clinicName,
      email: c.email,
      phone: phone || null,
      city: c.city || seq?.city,
      score,
      reasons,
      slug: (c.clinicName || 'clinic').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''),
      generatedAt: new Date().toISOString(),
    };
  })
  .sort((a, b) => b.score - a.score)
  .slice(0, 20);

// Save locally
const outPath = path.join(ROOT, 'data/hitlist/conversion-priority.json');
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(scored, null, 2));

// Copy to deploy path so signals dashboard picks it up on next Netlify deploy
const deployPath = path.join(ROOT, 'public/netlify-deploy/data/conversion-priority.json');
fs.mkdirSync(path.dirname(deployPath), { recursive: true });
fs.writeFileSync(deployPath, JSON.stringify(scored, null, 2));

console.log('Top 20 conversion priority:\n');
scored.forEach((c, i) => {
  console.log(`${i+1}. [${c.score}pts] ${c.clinicName} — ${c.city || ''}`);
  console.log(`   ${c.email}${c.phone ? ' · ' + c.phone : ''}`);
  console.log(`   ${c.reasons.slice(0, 3).join(' · ')}`);
});

console.log(`\nSaved: data/hitlist/conversion-priority.json`);
console.log(`Copied: public/netlify-deploy/data/conversion-priority.json`);
console.log(`Deploy to Netlify → signals dashboard shows updated list.`);
