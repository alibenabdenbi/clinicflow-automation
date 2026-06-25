// src/templates/planTemplate.js

function mdEscape(s) {
  return String(s || "").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function renderPlanMarkdown({ clinicName, website, meta, services, keywords }) {
  const name = mdEscape(clinicName || "Clinic");
  const site = mdEscape(website || "");
  const title = mdEscape(meta?.title || "(not found)");
  const h1 = mdEscape(meta?.h1 || "(not found)");
  const desc = mdEscape(meta?.desc || "(not found)");
  const serviceLine = services?.length ? services.map(mdEscape).join(" • ") : "(not detected)";
  const keywordLine = keywords?.length ? keywords.join(", ") : "(not detected)";

  return `# Growth Plan (1 Page) — ${name}

**Website:** ${site}

---

## 1) What we saw on your site (fast snapshot)
- **Title:** ${title}
- **Headline (H1):** ${h1}
- **Description:** ${desc}
- **Services / links:** ${serviceLine}
- **Keywords:** ${keywordLine}

---

## 2) The 3 fastest wins (0–14 days)
1) **Instant lead response (60s):** auto-reply for forms + missed calls so leads don’t bounce.
2) **Review engine:** review request 24h after appointment + reminder at 72h.
3) **Reactivation:** reach inactive patients (6–12 months) with a simple check-in + booking link.

---

## 3) 30-day “simple system” (repeatable)
- One inbox for leads (web form + email + missed calls)
- 3-message sequence: **instant → day 1 → day 3**
- Weekly tracking: leads received, response time, booked count, review count

---

## 4) What I can set up for you (deliverables)
- Form + missed call triggers
- Follow-up sequence (copy + automation)
- Review requests (Google link + reminders)
- Reactivation list + message templates

---

## 5) Next step (easy)
Reply **YES** and I’ll tailor this plan with 2–3 precise tweaks based on your services + location.
`;
}

export function renderPlanHtml({ clinicName, website, meta, services, keywords }) {
  // clean, “legit” email-friendly HTML
  const md = renderPlanMarkdown({ clinicName, website, meta, services, keywords });

  // minimal markdown -> html (keep it simple + safe)
  const esc = (s) => String(s || "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  const lines = md.split("\n");
  let html = "";
  for (const line of lines) {
    if (line.startsWith("# ")) html += `<h1 style="margin:0 0 12px;font-size:22px">${esc(line.slice(2))}</h1>`;
    else if (line.startsWith("## ")) html += `<h2 style="margin:18px 0 8px;font-size:16px">${esc(line.slice(3))}</h2>`;
    else if (line.startsWith("- ")) html += `<div style="margin:4px 0">• ${esc(line.slice(2))}</div>`;
    else if (/^\d+\)/.test(line)) html += `<div style="margin:6px 0">${esc(line)}</div>`;
    else if (line === "---") html += `<hr style="border:none;border-top:1px solid #e5e7eb;margin:16px 0"/>`;
    else if (!line.trim()) html += `<div style="height:10px"></div>`;
    else html += `<div style="margin:6px 0">${esc(line)}</div>`;
  }

  return `
<div style="font-family:Inter,system-ui,-apple-system,Segoe UI,Roboto,Arial;line-height:1.45;color:#111">
  <div style="max-width:720px;margin:0 auto;padding:18px;border:1px solid #e5e7eb;border-radius:14px;background:#fff">
    ${html}
    <div style="margin-top:16px;font-size:12px;color:#6b7280">
      Sent by ORE Outreach • If you want a customized version, reply YES.
    </div>
  </div>
</div>
`.trim();
}