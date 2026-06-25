/**
 * Filters items that scored too low in scorer.js to be worth processing.
 * Items below minScore are noise — low engagement, weak pain signals.
 * Call this AFTER scoreSignals() in the pipeline.
 */
export function filterByScore(items, minScore = 4) {
  return (items || []).filter((it) => {
    const score = Number(it?.score ?? 0);
    if (score >= minScore) return true;
    // Even low-score items survive if they have strong pain + question intent
    const painHits = Number(it?.painHits ?? 0);
    return painHits >= 3 && it?.hasQuestionIntent === true;
  });
}

const BAD_TITLE_PATTERNS = [
  "group rules",
  "please read",
  "weekly",
  "this week",
  "ongoing issues",
  "megathread",
  "daily thread",
  "promote your business",
  "ama",
  "top news",
  "newsletter"
];

export function filterJunk(items) {
  return items.filter(it => {
    const title = (it.title || "").toLowerCase();
    const text = `${it.title || ""} ${(it.selftext || "")}`.toLowerCase();
const looksLikeNews = ["released", "launch", "announced", "introducing", "news"].some(k => text.includes(k));
const hasPain = (it.painHits ?? 0) >= 1 || it.hasQuestionIntent === true;
if (it.source === "hackernews" && !hasPain) return false;

// if it's newsy AND no pain signals, drop it
if (looksLikeNews && !hasPain) return false;

    if (!title) return false;

    // remove obvious pinned / admin stuff
    if (BAD_TITLE_PATTERNS.some(p => title.includes(p))) return false;

    // remove very low-engagement + no pain signals
    const hasSignal = (it.painHits ?? 0) >= 1 || (it.hasQuestionIntent === true);
    const engagement = (it.ups ?? 0) + (it.num_comments ?? 0);

    if (!hasSignal && engagement < 10) return false;

    return true;
  });
}
