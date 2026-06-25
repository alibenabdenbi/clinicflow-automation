
export function buildFrenchEmail(clinic) {
  const name = clinic.clinicName || 'votre clinique';
  const city = clinic.city || 'votre ville';
  const firstName = clinic.ownerName?.split(' ')[0] || '';

  const subject = `Quelque chose que j'ai remarqué — ${city}`;

  const body = `${firstName ? 'Bonjour ' + firstName + ',' : 'Bonjour,'}

En cartographiant les flux de communication dans les cliniques de ${city}, j'ai remarqué quelque chose de récurrent.

Quand un patient appelle et que personne ne répond — il ne laisse généralement pas de message. Il cherche la prochaine clinique sur Google et prend rendez-vous là.

ClinicFlow envoie un texto automatique au patient dans les 60 secondes suivant un appel manqué. La plupart répondent. La plupart prennent rendez-vous.

Aucun nouveau logiciel. Aucune formation. Un seul paramètre de renvoi d'appel sur votre téléphone existant — 2 minutes.

Vous pouvez voir le système en action : clinicflowautomation.com/fr
Ou l'essayer comme patient : textez n'importe quoi au +1 (575) 573-5822

Pilote gratuit de 30 jours disponible cette semaine — une seule place.

Réservez 15 minutes : https://calendly.com/m-aliben432/clinicflow-15-min-intro

— Ali
438-544-0442`;

  return { subject, body };
}
