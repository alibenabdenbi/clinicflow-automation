const PAIN_PHRASES = [
  "i hate", "i'm tired", "so annoying", "annoying", "frustrat", "pain",
  "waste of time", "manual", "spreadsheet", "excel", "nightmare", "sucks",
  "does anyone know", "is there a tool", "i wish", "looking for", "need a way",
  "can't find", "no solution", "too expensive", "takes forever"
];

const B2B_HINTS = [
  "client", "customers", "invoice", "billing", "accounting", "inventory",
  "supplier", "purchase order", "shipping", "warehouse", "logistics",
  "crm", "sales", "bookkeeping", "tax", "contractor", "agency", "store",
  "shopify", "ecommerce", "restaurant", "construction"
];

export function extractPainSignals(items) {
  return items.map((it) => {
    const text = `${it.title || ""}\n${it.selftext || ""}`.toLowerCase();

    const painHits = PAIN_PHRASES.filter(p => text.includes(p)).length;
    const b2bHits = B2B_HINTS.filter(p => text.includes(p)).length;

    const hasQuestionIntent =
      text.includes("?") ||
      text.includes("does anyone") ||
      text.includes("is there") ||
      text.includes("looking for") ||
      text.includes("need a way");

    // Basic “pain statement”
    const painStatement =
      (it.title || "").trim() ||
      (it.selftext || "").slice(0, 140).trim();

    return {
      ...it,
      painHits,
      b2bHits,
      hasQuestionIntent,
      painStatement
    };
  });
}
