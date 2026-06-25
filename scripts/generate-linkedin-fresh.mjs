import fs from 'fs';
import dotenv from 'dotenv';
dotenv.config();

const dental  = JSON.parse(fs.readFileSync('data/outreach.localDentists.json', 'utf8'));
const pain    = dental.filter(c => c.painSignals?.length > 0);
const cities  = [...new Set(dental.map(c => c.city).filter(Boolean))];
const withRating = dental.filter(c => c.rating > 0);

const dataCtx = {
  totalClinics: dental.length,
  topCities: cities.slice(0, 5).join(', '),
  withPainSignals: pain.length,
  avgRatingWithPain:    (pain.filter(c=>c.rating>0).reduce((a,c)=>a+(c.rating||0),0)/Math.max(pain.filter(c=>c.rating>0).length,1)).toFixed(1),
  avgRatingWithout: (withRating.filter(c=>!c.painSignals?.length).reduce((a,c)=>a+(c.rating||0),0)/Math.max(withRating.filter(c=>!c.painSignals?.length).length,1)).toFixed(1),
};

const today = new Date();
const dayOfWeek = today.getDay();
const weekNumber = Math.floor(Date.now() / (7 * 24 * 60 * 60 * 1000));
const formatIndex = (dayOfWeek + weekNumber) % 7;
const todayStr = today.toISOString().slice(0, 10);

const formats = [
  { name: 'pattern-observation', prompt: `Write a LinkedIn post observing a specific pattern noticed while studying ${dataCtx.totalClinics} Canadian dental clinics. ${dataCtx.withPainSignals} clinics have reviews mentioning communication problems. Average rating drops from ${dataCtx.avgRatingWithout} to ${dataCtx.avgRatingWithPain} stars when patients mention difficulty reaching the clinic. Cities: ${dataCtx.topCities}. Be specific and grounded. Show genuine uncertainty.` },
  { name: 'single-truth', prompt: `Write a LinkedIn post sharing one uncomfortable operational truth about how dental clinics handle missed calls. Under 80 words. End with a real question. Based on studying ${dataCtx.totalClinics} Canadian clinics.` },
  { name: 'field-note', prompt: `Write a LinkedIn field note (start with "Field note #${Math.floor(Math.random()*15)+6}:") about something specific observed studying patient communication at Canadian clinics. Under 100 words. Researcher notebook tone. No conclusion.` },
  { name: 'counter-intuitive', prompt: `Write a LinkedIn post challenging a common assumption about how dental clinics handle patient calls. Something that seems obvious but is wrong based on data from ${dataCtx.totalClinics} clinics. Don't be preachy.` },
  { name: 'genuine-question', prompt: `Write a LinkedIn post asking a real operational question for dental clinic owners about patient communication. Not rhetorical — genuinely trying to understand. Under 80 words.` },
  { name: 'before-after', prompt: `Write a LinkedIn post showing the concrete operational difference before and after a clinic addresses their missed-call gap. No sales language. Under 100 words.` },
  { name: 'quiet-observation', prompt: `Write a quiet LinkedIn observation about the gap between how clinics think they handle patient communication versus what actually happens. Personal, uncertain tone. Under 70 words. Builder thinking out loud.` },
];

const fmt = formats[formatIndex];
console.log(`Format: "${fmt.name}" (day ${dayOfWeek}, week ${weekNumber % 7}, index ${formatIndex})`);

let post = null;
try {
  const { default: Anthropic } = await import('@anthropic-ai/sdk');
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const msg = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 300,
    system: `You write LinkedIn posts for Mohamed, founder of ClinicFlow Automation in Montreal.
He studies patient communication patterns at Canadian clinics and builds operational systems.
Tone: genuine field notes from a curious builder. Never salesy. Never motivational.
No emojis. No hashtags. No CTAs. No "I help businesses."
Include genuine uncertainty: "still not sure", "could be wrong", "not certain yet."
Vary sentence structure. Under 120 words. End unresolved.`,
    messages: [{ role: 'user', content: fmt.prompt }],
  });
  post = msg.content[0]?.text?.trim() || null;
  console.log('✓ Claude API responded');
} catch(e) {
  console.error('Claude API error:', e.message);
}

// Varied fallbacks by day — never the same text twice
if (!post) {
  const fallbacks = [
    `Looked at missed-call data across ${dataCtx.totalClinics} dental clinics this week.\n\nClinics with reviews mentioning communication problems average ${dataCtx.avgRatingWithPain} stars. Clinics without those complaints average ${dataCtx.avgRatingWithout}.\n\nNot sure if the lower rating causes the communication problems or the other way around. Could be both. Could be neither.\n\nStill trying to understand what actually changes between the two groups.`,
    `Something I keep seeing: the busiest clinics are often the ones with the most missed-call complaints.\n\nYou'd think busier means more staff to answer. But I think it means more calls coming in when the front desk is already occupied.\n\nCould be wrong. But the pattern shows up too often to ignore.`,
    `Ran through reviews for about ${dataCtx.totalClinics} Canadian dental clinics.\n\nThe phrase that shows up most in negative reviews isn't about the dentist. It's about not being able to get through.\n\n"Tried calling multiple times." "No one answers." "Left a voicemail, never heard back."\n\nNot sure what to do with that finding yet.`,
    `A dental clinic in ${dataCtx.topCities.split(',')[0]} had ${dataCtx.withPainSignals > 0 ? 'multiple' : 'several'} reviews mentioning missed calls.\n\nThey also had a 4.8 rating and hundreds of happy patients.\n\nSo the problem isn't that they're a bad clinic. It's that some calls are falling through and nobody is catching them.\n\nThat gap is what I'm trying to understand.`,
    `Field note: clinics with the most reviews about communication issues aren't the ones with the worst dentists.\n\nThey're usually the ones that got busy faster than their systems could scale.\n\nNot sure if that's a fixable problem or just what growth looks like for a while.`,
    `Been mapping how ${dataCtx.topCities.split(',')[0]} dental clinics handle calls that come in outside front desk hours.\n\nMost of them: voicemail, or nothing.\n\nThe patient calls back the next morning if they remember. Most don't.\n\nI keep wondering what the right response time actually is. 60 seconds? 5 minutes? Tomorrow morning? The clinics don't seem to have a defined answer.`,
    `Interesting pattern across Canadian dental clinics: the ones with the most five-star reviews often have at least one review mentioning difficulty getting through.\n\nLike the clinic is genuinely excellent but has one gap — calls falling through during busy hours.\n\nNot sure that's fixable without adding staff. Still thinking about it.`,
  ];
  post = fallbacks[dayOfWeek];
  console.log('Using varied fallback for day', dayOfWeek);
}

console.log('\n=== TODAY\'S LINKEDIN POST ===\n');
console.log(post);
console.log('\n============================');
console.log('Word count:', post.split(/\s+/).length);

fs.mkdirSync('data/linkedin', { recursive: true });
fs.writeFileSync('data/linkedin/daily-post.txt', post);
fs.writeFileSync('data/linkedin/daily-post-meta.json', JSON.stringify({ generatedAt: new Date().toISOString(), format: fmt.name, dayOfWeek, todayStr, wordCount: post.split(/\s+/).length }, null, 2));
console.log('\n✓ Fresh post saved to data/linkedin/daily-post.txt');
