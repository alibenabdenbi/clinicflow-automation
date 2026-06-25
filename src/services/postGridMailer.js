// src/services/postGridMailer.js
// Generates and sends personalized physical letters via PostGrid API.
// Each letter contains the clinic's revenue loss estimate, their /for/ page URL,
// and any pain signal quote from their Google reviews.

const POSTGRID_BASE = 'https://api.postgrid.com/print-mail/v1';

const FROM_ADDRESS = {
  companyName:     'ClinicFlow Automation',
  firstName:       'Mohamed',
  lastName:        'Benabdenbi',
  addressLine1:    '1000 De La Gauchetiere W',
  city:            'Montreal',
  provinceOrState: 'QC',
  postalOrZip:     'H3B 4W5',
  country:         'CA',
};

// Monthly revenue at risk: 20 missed calls/day × 20% rate × 70% churn × 22 days × $250/patient
const MONTHLY_LOSS = Math.round(20 * 0.20 * 0.70 * 22 * 250);

function buildPainLine(clinic, isQuebec) {
  const signals = clinic.painSignals;
  if (!signals || (Array.isArray(signals) && signals.length === 0)) return '';
  const raw = Array.isArray(signals) ? signals[0] : signals;
  const text = typeof raw === 'string' ? raw : (raw?.text || raw?.signal || '');
  if (!text) return '';
  const quote = text.slice(0, 90);
  return isQuebec
    ? `<p>Un patient a récemment mentionné : <em>&ldquo;${quote}&rdquo;</em></p>`
    : `<p>A patient recently left a review mentioning: <em>&ldquo;${quote}&rdquo;</em></p>`;
}

function buildRatingLine(clinic, isQuebec) {
  if (!clinic.rating) return '';
  const stars = Math.round(clinic.rating);
  const starStr = '&#9733;'.repeat(stars) + '&#9734;'.repeat(Math.max(0, 5 - stars));
  return isQuebec
    ? `<p>Votre note Google : <strong>${starStr} ${clinic.rating} (${clinic.reviewCount || '?'} avis)</strong></p>`
    : `<p>Your Google rating: <strong>${starStr} ${clinic.rating} (${clinic.reviewCount || '?'} reviews)</strong></p>`;
}

function letterHtml(clinic) {
  const isQuebec = clinic.language === 'fr' ||
    (clinic.province === 'QC' && /clinique|dentaire|soins/i.test(clinic.clinicName || ''));
  const slug = clinic.slug ||
    (clinic.clinicName || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  const city = clinic.city || 'your area';

  const header = `
<p style="color:#888;font-size:11px;margin-bottom:36px;border-bottom:1px solid #eee;padding-bottom:12px">
  ClinicFlow Automation &nbsp;&bull;&nbsp; Montreal, QC &nbsp;&bull;&nbsp; contact@clinicflowautomation.com &nbsp;&bull;&nbsp; 438-544-0442
</p>`;

  if (isQuebec) {
    return `<!DOCTYPE html><html><body style="font-family:Georgia,serif;max-width:560px;margin:40px auto;color:#1a1a1a;line-height:1.9;font-size:14px">
${header}
<p>Madame, Monsieur,</p>

<p>Nous cartographions les habitudes de communication patients dans les cliniques dentaires canadiennes depuis plusieurs mois.</p>

<p>Voici ce que nous avons trouvé pour les cliniques à <strong>${city}</strong>&nbsp;:</p>

<ul style="padding-left:20px;margin:16px 0">
  <li>Taux d&rsquo;appels manqués moyen&nbsp;: <strong>20&ndash;30 % des appels entrants</strong></li>
  <li>Patients qui ne rappellent pas&nbsp;: <strong>70 % vont chez un concurrent</strong></li>
  <li>Perte de revenus mensuelle estimée&nbsp;: <strong>${MONTHLY_LOSS.toLocaleString()} $</strong></li>
</ul>

${buildRatingLine(clinic, true)}
${buildPainLine(clinic, true)}

<p>Nous avons construit un système qui envoie automatiquement un texto à chaque appelant manqué en moins de 60 secondes. La plupart répondent. La plupart prennent rendez-vous. Zéro intervention du personnel.</p>

<p>Nous avons créé une page spécifiquement pour <strong>${clinic.clinicName}</strong>&nbsp;:</p>

<p style="font-size:17px;font-weight:bold;letter-spacing:-0.02em;margin:20px 0">
  clinicflowautomation.com/for/${slug}
</p>

<p>Pilote gratuit de 30 jours — une seule place disponible ce mois-ci.</p>

<br>
<p>Cordialement,</p>
<p><strong>Mohamed Ali Benabdenbi</strong><br>
Fondateur, ClinicFlow Automation<br>
Montréal, Québec<br>
438-544-0442</p>
</body></html>`;
  }

  return `<!DOCTYPE html><html><body style="font-family:Georgia,serif;max-width:560px;margin:40px auto;color:#1a1a1a;line-height:1.9;font-size:14px">
${header}
<p>Dear ${clinic.clinicName},</p>

<p>We have been mapping patient communication patterns across Canadian dental clinics for the past several months.</p>

<p>Here is what we found for clinics in <strong>${city}</strong>:</p>

<ul style="padding-left:20px;margin:16px 0">
  <li>Average missed call rate: <strong>20&ndash;30% of incoming calls</strong></li>
  <li>Patients who don&rsquo;t call back: <strong>70% go to a competitor</strong></li>
  <li>Estimated monthly revenue at risk: <strong>$${MONTHLY_LOSS.toLocaleString()}</strong></li>
</ul>

${buildRatingLine(clinic, false)}
${buildPainLine(clinic, false)}

<p>We built a system that automatically texts every missed caller within 60 seconds. Most reply. Most book. You never knew the call was missed. No staff action required.</p>

<p>We built a page specifically for <strong>${clinic.clinicName}</strong>:</p>

<p style="font-size:17px;font-weight:bold;letter-spacing:-0.02em;margin:20px 0">
  clinicflowautomation.com/for/${slug}
</p>

<p>Free 30-day pilot &mdash; one spot available this month.</p>

<br>
<p>Sincerely,</p>
<p><strong>Mohamed Ali Benabdenbi</strong><br>
Founder, ClinicFlow Automation<br>
Montreal, Quebec<br>
438-544-0442</p>
</body></html>`;
}

export async function createLetter(clinic, apiKey) {
  const addressLine1 = clinic.addressLine1 || clinic.address || clinic.googleAddress || clinic.formattedAddress;
  if (!addressLine1) throw new Error('No physical address for this clinic');

  const html = letterHtml(clinic);

  const res = await fetch(`${POSTGRID_BASE}/letters`, {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      to: {
        companyName:     clinic.clinicName,
        addressLine1:    addressLine1,
        city:            clinic.city || '',
        provinceOrState: clinic.province || 'ON',
        postalOrZip:     clinic.postalCode || '',
        country:         'CA',
      },
      from: FROM_ADDRESS,
      html,
      color: false,
      doubleSided: false,
      description: `ClinicFlow outreach — ${clinic.clinicName}`,
    }),
  });

  const data = await res.json();
  if (!res.ok) throw new Error(data.message || data.error || `PostGrid ${res.status}`);
  return data;
}

export { letterHtml, MONTHLY_LOSS };
