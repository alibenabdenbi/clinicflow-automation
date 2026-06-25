// src/cli/generateLinkedInCalendar.js
// Generates a 30-day LinkedIn content calendar using Claude.
// Saves to data/linkedin/30-day-calendar.json

import Anthropic from '@anthropic-ai/sdk';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

dotenv.config();

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const data = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/seo/report-data.json'), 'utf8'));

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const topWords = data.topPainKeywords?.slice(0, 5).map(([w]) => w).join(', ') || 'response, communication, missed';

const msg = await client.messages.create({
  model: 'claude-sonnet-4-6',
  max_tokens: 8000,
  system: `You write LinkedIn posts for Mohamed Ali Benabdenbi, founder of ClinicFlow Automation in Montreal.
He maps patient communication patterns across Canadian dental clinics.
Tone: genuine field researcher. Never salesy. Never motivational. First person.
No emojis. No hashtags. No explicit CTAs. No "I help businesses" framing.
Uncertainty is authentic: "still not sure", "could be wrong", "not certain yet."
Under 150 words per post. End unresolved or with a genuine open question.

Key data (real, from ${data.totalClinics} Canadian clinics across ${data.citiesCovered} cities):
- ${data.painRate} of clinics have at least one communication complaint in their Google reviews
- Rating gap: ${data.ratingGap} stars between clinics with vs without communication issues
- Average rating across all clinics: ${data.avgRatingAll} stars
- Most common complaint words: ${topWords}
- City sample sizes: Toronto 480, Mississauga 258, Ottawa 222, Calgary 150, Vancouver 127, Kitchener 127`,

  messages: [{
    role: 'user',
    content: `Generate exactly 30 LinkedIn posts for a 30-day content calendar. Every post must be unique in angle and format.

Use these 10 formats, 3 posts each:
1. field note — a specific numbered observation from the data
2. uncomfortable truth — one hard fact the industry avoids
3. counter-intuitive finding — something that surprised you in the data
4. before/after — operational difference that changed outcomes
5. genuine question — real uncertainty, directed at clinic owners or dentists
6. city observation — specific to one Canadian market from the data
7. rating pattern — analysis of what review data reveals
8. perception vs reality — what people assume vs what the data shows
9. high-rated clinic behaviour — what separates them operationally
10. quiet industry observation — something slow-moving most don't notice

Return ONLY a JSON array. No markdown, no explanation:
[{"day":1,"format":"field note","post":"full post text"},...]`,
  }],
});

const raw   = msg.content[0].text.replace(/```json|```/g, '').trim();
const posts = JSON.parse(raw);

fs.mkdirSync(path.join(ROOT, 'data/linkedin'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'data/linkedin/30-day-calendar.json'), JSON.stringify(posts, null, 2));

console.log(`Generated ${posts.length} posts\n`);
console.log('=== PREVIEW — FIRST 7 DAYS ===\n');
posts.slice(0, 7).forEach(p => {
  console.log(`Day ${p.day} [${p.format}]:`);
  console.log(p.post);
  console.log('\n' + '─'.repeat(60) + '\n');
});
console.log('Saved: data/linkedin/30-day-calendar.json');
