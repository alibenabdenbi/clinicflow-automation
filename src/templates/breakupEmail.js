// Breakup email — touch 7, day 14
// Closing the loop creates urgency without pressure — highest reply rate of any follow-up type.

export function buildBreakupEmail(clinic) {
  const name = clinic.clinicName;
  const firstName = clinic.ownerFirstName || clinic.contactName || clinic.ownerName?.split(' ').find(w => !w.startsWith('Dr')) || '';
  const greeting = firstName ? `Hi ${firstName},` : 'Hi,';
  const slug = name?.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  const isQuebec = clinic.language === 'fr' || clinic.city?.toLowerCase().includes('montreal') || clinic.city?.toLowerCase().includes('québec') || clinic.city?.toLowerCase().includes('laval');

  if (isQuebec) {
    return {
      subject: `Dernier message — ${name}`,
      variantLabel: 'BREAKUP-FR',
      body: `${greeting}

Je ne veux pas encombrer votre boîte de réception.

C'est mon dernier message concernant ClinicFlow pour ${name}.

Si la récupération des appels manqués n'est pas une priorité en ce moment — pas de problème du tout. Le moment n'est peut-être simplement pas le bon.

Si jamais ça devient pertinent, la page que j'ai créée pour vous sera toujours là :
clinicflowautomation.com/for/${slug}

Bonne continuation.

— Ali
438-544-0442`,
    };
  }

  return {
    subject: `Last note — ${name}`,
    variantLabel: 'BREAKUP',
    body: `${greeting}

I don't want to keep filling your inbox.

This is my last note about ClinicFlow for ${name}.

If missed call recovery isn't a priority right now — completely understood. The timing might just not be right.

If it ever becomes relevant, the page I built for you will still be there:
clinicflowautomation.com/for/${slug}

Wishing you a great week.

— Ali
438-544-0442`,
  };
}
