function chooseAngle(problem) {
  // For now: always pick the highest-leverage angle for this theme
  const angles = problem.productAngles || [];
  if (!angles.length) return null;

  // Prefer anything with "Shield", "Flow", "Anti-Ghosting"
  const preferred = angles.find(a =>
    (a.name || "").toLowerCase().includes("ghost") ||
    (a.name || "").toLowerCase().includes("shield") ||
    (a.name || "").toLowerCase().includes("flow")
  );

  return preferred || angles[0];
}

function mvpFor(theme, angleName) {
  // MVP = smallest shippable that solves 1 painful job
  if (theme === "Client Ops & Freelancing") {
    return {
      productName: "Scope & Pay Shield",
      promise: "Turn client chat into scope + invoice plan + auto follow-ups in 5 minutes.",
      v1Features: [
        "Input: paste client convo / requirements",
        "Output 1: 1-page Scope (deliverables, timeline, assumptions)",
        "Output 2: Payment plan (deposit + milestones)",
        "Output 3: Invoice-ready text + late fee/reminder templates",
        "Tracker: status = Proposed → Signed → Invoiced → Paid",
        "Automations: reminder schedule (Day 1 / Day 3 / Day 7)",
      ],
      notInV1: [
        "Full payment processing",
        "Full contract legality per country",
        "Complex CRM",
      ],
      pricing: ["$19 one-time templates", "$29/mo automation tracker", "$199 agency setup"]
    };
  }

  return {
    productName: "Operator Mini Tool",
    promise: "Remove a repeated manual workflow.",
    v1Features: ["Collect info", "Generate output", "Save history", "Email templates"],
    notInV1: ["Everything else"],
    pricing: ["$9–$49/mo"]
  };
}

function outreachPack(theme) {
  if (theme === "Client Ops & Freelancing") {
    return {
      target: ["Freelancers", "Small agencies"],
      whereToFind: [
        "Reddit: r/freelance, r/smallbusiness",
        "LinkedIn: agencies (2–20 employees)",
        "Facebook groups: freelancers/designers/devs",
        "IndieHackers: founders offering services"
      ],
      messages: [
        {
          name: "Short DM",
          text:
`Hey — quick question. Do clients ever ghost you after you send a proposal/invoice?
I built a tiny tool that turns client chat into a clean scope + milestone invoice plan + follow-up reminders in 5 mins.
Want to test it free on one of your current clients?`
        },
        {
          name: "More direct",
          text:
`I saw a lot of freelancers losing money to scope creep + ghosting.
I’m shipping “Scope & Pay Shield”: paste the client convo → it generates scope, deposit/milestones, invoice text, and 3 follow-up reminders.
If I run it on your latest client request and you like the output, would you pay $19 for the template pack?`
        },
        {
          name: "Agency angle",
          text:
`If you run an agency: do you have a consistent process for scope, change requests, and getting paid on time?
I’m testing a simple ops tool that standardizes scope + milestone billing + automated reminders.
If it saves your team 2–3 hours/week, would $29/mo be reasonable?`
        }
      ]
    };
  }

  return { target: [], whereToFind: [], messages: [] };
}

export function buildNextAction(problems) {
  // Pick the top problem by avgScore * log(count)
  const ranked = [...problems].sort((a, b) => (b.avgScore * Math.log(1 + b.evidenceCount)) - (a.avgScore * Math.log(1 + a.evidenceCount)));
  const chosen = ranked[0];

  const angle = chooseAngle(chosen);
  const mvp = mvpFor(chosen.theme, angle?.name || "");
  const outreach = outreachPack(chosen.theme);

  return {
    chosenTheme: chosen.theme,
    problemStatement: chosen.problemStatement,
    evidenceCount: chosen.evidenceCount,
    avgScore: chosen.avgScore,
    chosenAngle: angle,
    mvp,
    outreach
  };
}
