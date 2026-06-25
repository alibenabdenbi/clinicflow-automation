function normalizeText(s) {
  return (s || "")
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, "")
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// super simple fingerprint: remove short words
function fingerprint(title) {
  const t = normalizeText(title);
  const words = t.split(" ").filter(w => w.length >= 4);
  return words.slice(0, 12).sort().join(" ");
}

export function dedupeByTitle(items) {
  const seen = new Set();
  const out = [];

  for (const it of items) {
    const fp = fingerprint(it.title || "");
    if (!fp) continue;
    if (seen.has(fp)) continue;
    seen.add(fp);
    out.push(it);
  }
  return out;
}

export function toProblemStatement(it) {
  const title = (it.title || "").trim();
  const theme = it.theme || "Other";

  // very simple normalization templates
  if (theme === "Invoicing & Billing") {
    return "Small businesses are frustrated with invoicing/billing tools (pricing, professionalism, getting paid, disputes).";
  }
  if (theme === "Client Ops & Freelancing") {
    return "Freelancers struggle with client ops: getting paid, ghosting, scope creep, proposals, and platform reliability.";
  }
  if (theme === "Client Acquisition") {
    return "Small businesses struggle to consistently acquire clients/leads and convert them without wasting time/money.";
  }
  if (theme === "Pricing & Costs") {
    return "Founders/business owners feel SaaS and tooling costs are too high and want cheaper alternatives.";
  }
  if (theme === "Inventory & Purchasing") {
    return "Businesses struggle with inventory and purchasing decisions (reorder, suppliers, cash tied in stock).";
  }

  // fallback: use title as problem hint
  return `Problem signal: "${title}"`;
}
