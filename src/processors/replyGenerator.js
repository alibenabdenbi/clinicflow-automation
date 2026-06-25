function pickAsyncOptions() {
  return [
    "Option A — Reply here with your booking link + preferred tone (friendly / formal) and I’ll tailor the exact messages + triggers.",
    "Option B — If you prefer, I can send a 2-minute checklist (forms / calls / reviews) and I’ll build the setup from your answers.",
  ];
}

export function generateReplyEmail({ lead, incomingText, planPreview }) {
  const clinicName = (lead?.clinicName || "there").trim();
  const opts = pickAsyncOptions();

  // Keep preview clean: no headings, no “Title/H1” spam
  const preview = (planPreview || "")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .filter((l) => !l.startsWith("#"))
    .filter((l) => !/^(\-|\*|\d+\.)\s+\*\*(Title|H1|Description|Primary)/i.test(l))
    .slice(0, 2)
    .join(" ");

  const subject = `Re: ${clinicName} — next step (async, no call needed)`;

  const text =
`Hi ${clinicName} team,

Thanks — understood.

We can do this fully async (no call / Zoom needed).  

${opts[0]}
${opts[1]}

Quick question so I tailor it correctly:
1) Do you want follow-ups for **website forms**, **missed calls**, or **both**?
2) Do you want **review requests** included?

${preview ? `\n(30-second preview)\n${preview}\n` : ""}

Best,  
Mohamed  
ClinicFlow Automation`;

  return { subject, text };
}