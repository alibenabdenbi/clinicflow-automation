function norm(s) {
  return (s || "").toLowerCase();
}

// micro-problem buckets (client acquisition)
const BUCKETS = [
  { bucket: "Lead quality is trash", keys: ["low quality", "junk leads", "spam", "bots", "fake leads"] },
  { bucket: "Outreach gets ignored", keys: ["no reply", "ignored", "open rate", "reply rate", "cold email"] },
  { bucket: "Ads account issues", keys: ["banned", "disabled", "restricted", "meta banned", "ad account"] },
  { bucket: "Tracking is broken", keys: ["tracking", "pixel", "attribution", "analytics", "utm"] },
  { bucket: "Funnels/landing pages don’t convert", keys: ["landing page", "conversion", "bounce", "funnel"] },
  { bucket: "CRM follow-up chaos", keys: ["follow up", "follow-up", "crm", "pipeline", "deal stage"] },
  { bucket: "Local business lead gen", keys: ["local", "google business", "maps", "reviews", "near me"] },
  { bucket: "Scheduling drop-offs", keys: ["booking", "calendar", "appointment", "no show", "no-show"] },
];

function bucketFor(item) {
  const text = norm(`${item.title || ""} ${item.selftext || ""}`);
  for (const b of BUCKETS) if (b.keys.some(k => text.includes(k))) return b.bucket;
  return "Other acquisition pain";
}

export function buildClientAcquisitionProblemMap(items, topN = 10) {
  const only = items.filter(i => (i.theme || "").includes("Client Acquisition"));
  const map = new Map();

  for (const it of only) {
    const b = bucketFor(it);
    const current = map.get(b) || { bucket: b, count: 0, avgScore: 0, maxScore: 0, examples: [] };

    current.count += 1;
    current.avgScore += (it.score || 0);
    current.maxScore = Math.max(current.maxScore, it.score || 0);

    if (current.examples.length < 3) {
      current.examples.push({ title: it.title, url: it.url, score: it.score, source: it.source });
    }

    map.set(b, current);
  }

  const arr = [...map.values()].map(x => ({
    ...x,
    avgScore: Number((x.avgScore / x.count).toFixed(2))
  }));

  arr.sort((a, b) => (b.avgScore * Math.log(1 + b.count)) - (a.avgScore * Math.log(1 + a.count)));

  return arr.slice(0, topN);
}
