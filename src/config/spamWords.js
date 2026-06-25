// src/config/spamWords.js
// Phrases that hurt email deliverability and spam score.
// Source: industry analysis of common spam filter triggers.

export const SPAM_WORDS = [
  // Hard sales pressure
  "act now", "acting now", "apply now",
  "buy now", "buy direct", "buy today",
  "call now", "call free", "call toll free",
  "click here", "click below", "click now", "click to",
  "don't miss", "don't hesitate",
  "limited time", "limited offer", "expires",
  "hurry", "last chance", "now or never",
  "offer expires", "once in a lifetime",
  "order now", "order today",
  "special offer", "special promotion",
  "urgent",

  // Bogus value claims
  "100%", "100 percent",
  "absolutely", "amazing", "astonishing", "incredible", "miracle",
  "guaranteed", "no questions asked",
  "proven", "risk-free", "no risk",
  "zero risk", "zero cost", "no cost",
  "no obligation", "no fees",

  // Money / income
  "earn extra", "extra income", "additional income",
  "earn money", "earn cash", "earn $",
  "cash bonus", "cash back", "money back",
  "make money", "make $",
  "double your", "triple your",
  "million dollar", "billion dollar",
  "get paid",

  // Promotions
  "bargain", "cheap", "cheapest",
  "discount", "save big", "save up to",
  "best price", "lowest price",
  "blow-out", "clearance",

  // Spam / marketing meta-language
  "bulk email", "mass email",
  "bulk order", "mass mailing",
  "marketing solution", "marketing offer",
  "increase sales", "increase traffic",
  "leads", // context-sensitive but risky in subject lines
  "opt in", "opt-in",
  "unsubscribe",          // avoid in first email
  "removal",              // "click to be removed"

  // Gimmicks
  "winner", "you have been selected", "you are a winner",
  "congratulations", "you've been selected",
  "join millions", "millions of",
  "be your own boss",

  // Health / finance (common spam verticals)
  "lose weight", "weight loss",
  "lower mortgage", "refinance",
  "bad credit", "no credit", "credit score",

  // Excessive punctuation triggers (as phrases)
  "!!!", "!!!",
];

/**
 * Scores a text for spam signals.
 * Returns { score: number, triggers: string[] }
 * score 0 = clean, higher = more spammy.
 */
export function spamScore(text) {
  const lower = (text || "").toLowerCase();
  const triggers = [];

  for (const word of SPAM_WORDS) {
    if (lower.includes(word.toLowerCase())) {
      triggers.push(word);
    }
  }

  // Excessive caps (more than 3 consecutive caps words)
  const capsWords = (text.match(/\b[A-Z]{3,}\b/g) || []);
  if (capsWords.length > 2) {
    triggers.push(`excessive caps: ${capsWords.slice(0, 3).join(", ")}`);
  }

  // Excessive exclamation marks
  const exclamations = (text.match(/!/g) || []).length;
  if (exclamations > 2) {
    triggers.push(`${exclamations} exclamation marks`);
  }

  return { score: triggers.length, triggers };
}
