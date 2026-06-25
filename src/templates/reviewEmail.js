// Review-based hyper-personalized email
// Uses actual pain signal from Google reviews
// Highest conversion rate of any variant

export function buildReviewEmail(clinic) {
  const name = clinic.clinicName;
  const city = clinic.city || 'your city';
  const pain = clinic.painSignals?.[0] || '';
  const firstName = clinic.ownerName?.split(' ')[0] || '';
  const isQuebec = clinic.language === 'fr';

  const painPhrase = pain.length > 60 ? pain.slice(0, 60) + '...' : pain;

  if (isQuebec) {
    return {
      subject: `Un patient a mentionné quelque chose — ${name}`,
      body: `${firstName ? 'Bonjour ' + firstName + ',' : 'Bonjour,'}

En analysant les avis Google pour des cliniques à ${city}, j'ai remarqué qu'un patient a mentionné :

"${painPhrase}"

C'est exactement le problème que ClinicFlow résout. Quand un patient appelle et que personne ne répond, il reçoit automatiquement un texto en 60 secondes — avant qu'il appelle la clinique suivante.

Vous pouvez voir le système en action : clinicflowautomation.com/fr

Pilote gratuit de 30 jours disponible cette semaine — une seule place.

— Ali
438-544-0442
https://calendly.com/m-aliben432/clinicflow-15-min-intro`,
    };
  }

  return {
    subject: `Something a patient mentioned — ${name}`,
    body: `${firstName ? 'Hi ' + firstName + ',' : 'Hi,'}

While reviewing Google feedback for clinics in ${city}, I noticed a patient mentioned:

"${painPhrase}"

That's exactly what ClinicFlow fixes. When a patient calls and no one picks up, they get an automatic text within 60 seconds — before they call the next clinic.

You can see it running: clinicflowautomation.com/live
Or experience it: text anything to +1 (575) 573-5822

Free 30-day pilot open this week — one spot available.

Worth a quick reply?

— Ali
438-544-0442
https://calendly.com/m-aliben432/clinicflow-15-min-intro`,
  };
}
