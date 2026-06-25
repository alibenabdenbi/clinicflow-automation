function pickBuyer(theme) {
  switch (theme) {
    case "Client Ops & Freelancing":
      return ["Freelancers", "Agencies (2–20 ppl)", "Consultants"];
    case "Client Acquisition":
      return ["Local service businesses", "Small B2B companies", "Solo founders"];
    case "Invoicing & Billing":
      return ["Small businesses (1–20 ppl)", "Contractors", "Freelancers"];
    case "Ecommerce Ops":
      return ["Shopify stores (10–500 orders/month)", "DTC brands", "Small ecom teams"];
    case "Pricing & Costs":
      return ["Bootstrapped founders", "Small teams replacing expensive SaaS", "Startups"];
    default:
      return ["Small business owners", "Founders", "Operators"];
  }
}

function pickChannel(theme) {
  switch (theme) {
    case "Client Ops & Freelancing":
      return ["Reddit (freelance)", "LinkedIn DMs to agencies", "Upwork/Fiverr communities"];
    case "Client Acquisition":
      return ["Google Maps outreach", "LinkedIn local business", "Facebook groups"];
    case "Invoicing & Billing":
      return ["Contractor Facebook groups", "Reddit (smallbusiness)", "YouTube shorts ‘invoice tips’"];
    case "Ecommerce Ops":
      return ["Shopify app ecosystem", "Shopify FB groups", "Email outreach to stores"];
    case "Pricing & Costs":
      return ["Product Hunt", "IndieHackers", "Reddit (SaaS/founders)"];
    default:
      return ["Reddit", "Indie communities", "Cold email"];
  }
}

function anglesForTheme(theme) {
  switch (theme) {
    case "Client Ops & Freelancing":
      return [
        {
          name: "Anti-Ghosting Payment Flow",
          what: "Simple contract + deposit + milestone invoice flow with auto-reminders and ‘proof pack’.",
          pricing: "$9–$29/mo (solo) or $49–$149/mo (agency)"
        },
        {
          name: "Scope Creep Shield",
          what: "Proposal builder that turns chat into scope, tracks changes, and generates ‘change request’ invoices.",
          pricing: "$19–$49/mo"
        },
        {
          name: "Client Ops Dashboard",
          what: "One board: proposals → signed → invoice → paid → follow-up, with templates + auto emails.",
          pricing: "$29–$99/mo"
        }
      ];
    case "Client Acquisition":
      return [
        {
          name: "Google Maps Lead Miner + Outreach",
          what: "Find leads + generate personalized outreach + follow-up tracker.",
          pricing: "$49–$199/mo"
        },
        {
          name: "Offer/Positioning Fixer",
          what: "Wizard that turns your business into a clear offer + landing page + scripts (done in 30 mins).",
          pricing: "$29–$99/mo"
        },
        {
          name: "Local Sales System",
          what: "CRM-lite + pipeline + reminders + quote templates for local services.",
          pricing: "$29–$149/mo"
        }
      ];
    case "Invoicing & Billing":
      return [
        {
          name: "Professional Invoice Pack",
          what: "Invoice templates + brand styling + ‘looks legit’ builder + PDF/email automation.",
          pricing: "$5–$19/mo"
        },
        {
          name: "Invoice Dispute Resolver Kit",
          what: "Auto generates payment terms, late fees notices, and dispute documentation.",
          pricing: "$9–$29/mo"
        },
        {
          name: "Cheap Invoicing Alternative",
          what: "Minimal invoicing + reminders + payment links, aimed at ‘apps are too expensive’ users.",
          pricing: "$5–$15/mo"
        }
      ];
    case "Ecommerce Ops":
      return [
        {
          name: "Returns + Support Autopilot",
          what: "Automate return labels, status emails, and FAQ responses for Shopify.",
          pricing: "$29–$199/mo"
        },
        {
          name: "Pricing Compliance Checker",
          what: "Scan store for ‘sale pricing’ risks + policy issues (like the lawsuit warning post).",
          pricing: "$49–$299/mo"
        },
        {
          name: "Ops Checklist + Alerts",
          what: "Daily ops checklist + alerts for inventory/fulfillment/payment issues.",
          pricing: "$19–$99/mo"
        }
      ];
    case "Pricing & Costs":
      return [
        {
          name: "Cheaper Typeform Alternative (Niche)",
          what: "Not general forms—focus on one niche: leads + booking + simple CRM export.",
          pricing: "$9–$29/mo"
        },
        {
          name: "Tool Cost Cutter",
          what: "Audit stack → recommend replacements → automate migrations.",
          pricing: "$199 setup + $29/mo"
        },
        {
          name: "Micro-SaaS Bundle",
          what: "One subscription for 3 tiny tools founders constantly pay for separately.",
          pricing: "$19–$49/mo"
        }
      ];
    default:
      return [
        {
          name: "Operator Pain Fix",
          what: "Micro-tool that removes a repeated manual workflow found in posts.",
          pricing: "$9–$49/mo"
        },
        {
          name: "Done-for-you Setup + Automation",
          what: "Service first: you automate their workflow with templates and scripts.",
          pricing: "$500–$5,000 setup + $99–$499/mo"
        },
        {
          name: "Niche Report + Playbook",
          what: "Weekly actionable report for a niche + templates and scripts.",
          pricing: "$19–$99/mo"
        }
      ];
  }
}

export function enrichProblems(problems) {
  return problems.map((p) => {
    const buyers = pickBuyer(p.theme);
    const channels = pickChannel(p.theme);
    const angles = anglesForTheme(p.theme);

    return {
      ...p,
      idealBuyers: buyers,
      bestChannels: channels,
      productAngles: angles
    };
  });
}
