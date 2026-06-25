// src/templates/pilotOffer.js
// Pilot offer email — free 30-day trial for warm leads who've already seen us.

export function buildPilotEmail(clinic) {
  const firstName = clinic.ownerName?.split(' ')[0] ||
                    clinic.contactName?.split(' ')[0] ||
                    'there';
  const city = (clinic.city || 'your city').split(',')[0].trim();
  const name = clinic.clinicName;
  const hasPain = (clinic.painSignals || []).length > 0;

  const subject = hasPain
    ? `Free 30-day pilot — ${name}`
    : `One spot open this week — ${name}`;

  const body = `Hi ${firstName},

I've reached out a couple of times about the missed-call system. Instead of another follow-up, I want to make a different kind of offer.

I'll set up the complete system for ${name} — free for 30 days.

Here's exactly what that means:
- I configure everything myself using your clinic's information
- You forward missed calls to a number I give you — takes 2 minutes
- The system automatically texts every missed caller within 60 seconds
- I send you a report after 30 days showing exactly how many patients you recovered

No payment now. No commitment. No risk.

You can see the system running live before deciding:
clinicflowautomation.com/fr

Want to experience it as a patient would? Text anything to +1 (575) 573-5822 — 60 seconds.

Full pricing: clinicflowautomation.com/pricing

If it works — and I'm confident it will for a ${city} clinic — we talk about continuing at $497 (half our normal rate, as a thank-you for being a pilot).

If it doesn't work — nothing owed. You just cancel the call forwarding.

I have one spot open this week.

Interested?

Or book a 15-min call directly: https://calendly.com/m-aliben432/clinicflow-15-min-intro

— Ali
ClinicFlow Automation
438-544-0442
clinicflowautomation.com

Reply STOP to opt out.`;

  return { subject, body, firstName, name };
}

export function buildFrenchPilotEmail(clinic) {
  const firstName = clinic.ownerName?.split(' ')[0] || '';
  const name = clinic.clinicName;
  const city = clinic.city || 'votre ville';

  const subject = `Pilote gratuit — ${name}`;
  const body = `${firstName ? 'Bonjour ' + firstName + ',' : 'Bonjour,'}

Je veux vous faire une offre directe.

Je configure le système complet pour ${name} — gratuitement pendant 30 jours.

Voici ce que ça implique :
- Je configure tout moi-même avec les informations de votre clinique
- Vous redirigez les appels manqués vers un numéro que je vous donne — 2 minutes
- Chaque appelant manqué reçoit un texto automatique en 60 secondes
- Après 30 jours, je vous envoie un rapport montrant combien de patients vous avez récupérés

Aucun paiement maintenant. Aucun engagement. Aucun risque.

Vous pouvez voir le système en action : clinicflowautomation.com/live

Si ça fonctionne — et j'en suis convaincu — on discute de la suite à 497$.
Si ça ne fonctionne pas — vous ne devez rien.

Une seule place disponible cette semaine.

Ça vous intéresse ?

— Ali
438-544-0442
https://calendly.com/m-aliben432/clinicflow-15-min-intro`;

  return { subject, body };
}
