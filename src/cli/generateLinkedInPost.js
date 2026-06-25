// src/cli/generateLinkedInPost.js
// Generates one daily LinkedIn post using Claude API.
// Saves to data/linkedin/daily-post.txt
//
// Usage: node src/cli/generateLinkedInPost.js

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
dotenv.config();
if (process.platform === 'win32') process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT      = path.resolve(__dirname, '../..');
const OUT_DIR   = path.join(ROOT, 'data', 'linkedin');
const OUT_PATH  = path.join(OUT_DIR, 'daily-post.txt');
const QUEUE_PATH = path.join(ROOT, 'data', 'outreach.localDentists.json');

// ─── 30-day calendar: use pre-generated posts first ───────────────────────────
try {
  const CALENDAR_PATH = path.join(OUT_DIR, '30-day-calendar.json');
  const LOG_PATH      = path.join(OUT_DIR, 'post-log.json');
  if (fs.existsSync(CALENDAR_PATH)) {
    const calendar = JSON.parse(fs.readFileSync(CALENDAR_PATH, 'utf-8'));
    const log      = fs.existsSync(LOG_PATH) ? JSON.parse(fs.readFileSync(LOG_PATH, 'utf-8')) : [];
    const nextIdx  = log.length % calendar.length;
    const entry    = calendar[nextIdx];
    if (entry?.post) {
      fs.mkdirSync(OUT_DIR, { recursive: true });
      const today = new Date().toISOString().slice(0, 10);
      // Write with proper header so loadDailyPost() doesn't skip line 1
      fs.writeFileSync(OUT_PATH,
        `# LinkedIn Post — ${today} (${entry.format})\n\n${entry.post}\n\n---\nGenerated: ${new Date().toISOString()}\nFormat: ${entry.format}\nSource: 30-day-calendar\n`,
        'utf-8');
      fs.writeFileSync(path.join(OUT_DIR, 'daily-post-meta.json'), JSON.stringify({
        generatedAt: new Date().toISOString(),
        format: entry.format,
        day: entry.day,
        source: '30-day-calendar',
      }, null, 2));
      console.log('Post loaded from 30-day calendar');
      console.log('Format:', entry.format, '| Day:', entry.day);
      console.log('\n' + entry.post);
      process.exit(0);
    }
  }
} catch (e) {
  console.log('Calendar not found — generating via API');
}

// ─── Real database stats for context ──────────────────────────────────────────

function loadStats() {
  try {
    const dental = JSON.parse(fs.readFileSync(QUEUE_PATH, 'utf-8'));
    const total  = dental.length;
    const cities = [...new Set(dental.map(c => c.city).filter(Boolean))].slice(0, 6);
    const pain   = dental.filter(c => c.painSignals?.length > 0);
    const withRating = dental.filter(c => c.rating > 0);
    const avgRating  = withRating.length
      ? (withRating.reduce((a, c) => a + (c.rating || 0), 0) / withRating.length).toFixed(1)
      : '4.8';
    const topSignals = {};
    pain.forEach(c => c.painSignals?.forEach(s => { topSignals[s] = (topSignals[s] || 0) + 1; }));
    const topSignal = Object.entries(topSignals).sort((a, b) => b[1] - a[1])[0]?.[0] || 'poor communication';
    return { total, cities: cities.join(', '), painCount: pain.length, topSignal, avgRating, withRating: withRating.length };
  } catch {
    return { total: 3609, cities: 'Toronto, Montreal, Vancouver, Calgary, Ottawa', painCount: 4, topSignal: 'poor communication', avgRating: '4.8', withRating: 137 };
  }
}

// ─── Format variants by day of week ──────────────────────────────────────────

const FORMATS = {
  1: { // Monday
    name: 'pattern-observation',
    instruction: `Write a "pattern observation" post. Start with what was noticed, not who you are. Reference real pain signal data (poor communication, difficulty getting through). Focus on a pattern you keep seeing across clinics, not a pitch.`,
  },
  2: { // Tuesday
    name: 'single-fact',
    instruction: `Write a "single fact" post. One observation. Under 60 words total. End with genuine uncertainty — something you're still trying to figure out. Very short. Almost too short.`,
  },
  3: { // Wednesday
    name: 'field-note',
    instruction: `Write a "field note" post. Start with "Field note #[pick a number 7-15]:" followed by a short observation in quotes. Then 2-3 sentences of genuine, unresolved observation. End with something still unresolved.`,
  },
  4: { // Thursday
    name: 'question',
    instruction: `Write a "genuine question" post. Ask a real question you're actually trying to understand — not rhetorical. Something specific about clinic communication patterns. End with "Still trying to understand this." or similar.`,
  },
  5: { // Friday
    name: 'counter-intuitive',
    instruction: `Write a "counter-intuitive" post. Challenge a common assumption about clinic communication or missed calls. Use a real observation to back it up. Something that would make a clinic owner pause and think.`,
  },
  6: { // Saturday
    name: 'quiet-observation',
    instruction: `Write a "quiet observation" post. Most personal, most uncertain. Something you noticed but aren't sure what to make of. End with "Not sure what to make of this yet." or similar. This is the most human-sounding format.`,
  },
  0: { // Sunday — reuse Saturday format
    name: 'quiet-observation',
    instruction: `Write a reflective post about something you observed during the week studying clinic communication patterns. Keep it honest and unresolved. Under 100 words.`,
  },
};

// ─── Main ─────────────────────────────────────────────────────────────────────

export async function generateDailyLinkedInPost() {
  // Always delete cached post — force fresh generation every day
  try { fs.unlinkSync(OUT_PATH); } catch {} // ok if doesn't exist
  const stats = loadStats();
  const day = new Date().getDay();
  const format = FORMATS[day] || FORMATS[5];
  const today = new Date().toISOString().slice(0, 10);

  const systemPrompt = `You write short LinkedIn posts for Mohamed, a builder in Montreal studying patient communication patterns at Canadian dental and physiotherapy clinics.

He is NOT a marketing person. He builds operational systems and is genuinely trying to understand patterns in how clinics handle missed calls and patient follow-up.

Tone rules:
- Write like field notes from someone genuinely studying this
- Include occasional uncertainty: "still not sure why", "could be wrong", "not certain yet"
- Never sound like a consultant or thought leader
- Never pitch anything or mention pricing
- No emojis, no hashtags, no CTAs
- Vary sentence structure — never start two consecutive sentences the same way
- Avoid overusing: "operational", "workflow", "systems", "platform", "solution"
- Under 120 words total
- End with something unresolved or a genuine question, not a confident conclusion

The reader should think: "this person is actually studying this, not selling it"

Write only the post text. Nothing else. No quotes around it. No label like "Post:"`;

  const userPrompt = `Today's format: ${format.name}

${format.instruction}

Real data context (use naturally, not as bullet points):
- ${stats.total} Canadian clinics mapped across ${stats.cities}
- ${stats.withRating} clinics with Google reviews, avg rating ${stats.avgRating}
- Most common issue in reviews: "${stats.topSignal}"
- ${stats.painCount} clinics with explicit communication complaints in reviews

Write one LinkedIn post for today (${today}). Nothing else.`;

  let post = null;
  try {
    const { default: Anthropic } = await import('@anthropic-ai/sdk');
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const msg = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 250,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    });
    post = msg.content[0]?.text?.trim() || null;
  } catch (e) {
    console.error('Claude API error:', e.message);
  }

  if (!post) {
    // Fallback — deterministic post if API fails
    const dayFallbacks = [
    "Something I keep seeing: the busiest clinics are often the ones with the most missed-call complaints. You'd think busier means more staff. But I think it means more calls coming in when the front desk is already occupied. Could be wrong. But the pattern shows up too often to ignore.",
    "Looked at missed-call data across thousands of Canadian dental clinics. The phrase that shows up most in negative reviews isn't about the dentist. It's about not being able to get through. Still not sure what to do with that finding.",
    "Field note #12: clinics with the most five-star reviews often have at least one review mentioning difficulty getting through. Like the clinic is genuinely excellent but has one gap — calls falling through during busy hours. Not sure that's fixable without adding staff.",
    "A pattern across Canadian dental clinics: most have no defined response time for missed calls. The patient calls back if they remember. Most don't. I keep wondering what the right response window actually is. 60 seconds? 5 minutes? Tomorrow morning?",
    "The clinics with communication complaints in their reviews aren't usually bad clinics. They got busy faster than their systems could scale. Not sure if that's a fixable problem or just what growth looks like for a while.",
    "Been looking at what happens between a missed call and the next available appointment at dental clinics. The gap is usually invisible. Nobody tracks it. Nobody owns it. That's the part I'm still trying to understand.",
    "Something quiet I noticed: clinics that respond to negative reviews online almost always have fewer of them. Correlation, not causation, probably. But the pattern is consistent enough to be interesting.",
  ];
  post = dayFallbacks[new Date().getDay()];
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const output = `# LinkedIn Post — ${today} (${format.name})\n\n${post}\n\n---\nGenerated: ${new Date().toISOString()}\nFormat: ${format.name}\n`;
  fs.writeFileSync(OUT_PATH, output, 'utf-8');

  return { post, format: format.name, date: today };
}

// ─── Entry point ──────────────────────────────────────────────────────────────
const isMain = process.argv[1] &&
  (process.argv[1].endsWith('generateLinkedInPost.js') || process.argv[1].endsWith('generateLinkedInPost'));

if (isMain) {
  const { post, format, date } = await generateDailyLinkedInPost();
  console.log(`\n── LinkedIn Post — ${date} (${format}) ──────────────────────\n`);
  console.log(post);
  console.log(`\n────────────────────────────────────────────────────────────`);
  console.log(`Saved → ${path.join('data', 'linkedin', 'daily-post.txt')}`);
}
