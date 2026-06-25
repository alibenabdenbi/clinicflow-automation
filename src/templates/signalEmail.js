// src/templates/signalEmail.js
// Signal-based first-touch email. Every clinic gets a first line drawn from
// their specific data: pain signal quote → review count → star rating → city.
// Bilingual: QC/FR clinics receive the French variant automatically.

const BASE_URL = 'https://clinicflowautomation.com';
const SENDER = '— Ali\n438-544-0442';

function painText(clinic) {
  const raw = Array.isArray(clinic.painSignals) ? clinic.painSignals[0] : clinic.painSignals;
  if (!raw) return null;
  const text = typeof raw === 'object' ? (raw.text || raw.signal || '') : String(raw);
  return text.trim().length > 5 ? text.trim() : null;
}

function getFirstLine(clinic, isQuebec) {
  const name    = clinic.clinicName || clinic.name || '';
  const city    = clinic.city || '';
  const rating  = clinic.rating  || 0;
  const reviews = clinic.reviewCount || 0;
  const pain    = painText(clinic);

  // 1 — Patient left a review mentioning a communication pain word
  if (pain) {
    return isQuebec
      ? `Un patient a mentionné « ${pain.slice(0, 60)} » dans un avis sur ${name} — c'est exactement ce que ClinicFlow résout.`
      : `A patient mentioned "${pain.slice(0, 60)}" in a review of ${name} — that's exactly what ClinicFlow fixes.`;
  }

  // 2 — Busy clinic with many reviews = higher missed call volume
  if (reviews >= 300) {
    return isQuebec
      ? `${name} compte ${reviews} avis Google — les cliniques aussi actives manquent souvent 25-35 % de leurs appels en période de pointe.`
      : `${name} has ${reviews} Google reviews — busy clinics like yours typically miss 25-35% of calls during peak hours.`;
  }

  // 3 — Exceptional rating = reputation to protect, every missed call hurts more
  if (rating >= 4.8 && reviews >= 80) {
    return isQuebec
      ? `La note de ${rating}★ de ${name} est exceptionnelle — les cliniques à ce niveau perdent souvent 3-5 patients par jour aux appels manqués avant de trouver une solution.`
      : `${name}'s ${rating}★ rating is exceptional — clinics at that level typically lose 3-5 patients per day to missed calls before they find a solution.`;
  }

  // 4 — City-specific observation (always true if city is set)
  if (city) {
    return isQuebec
      ? `En cartographiant les appels manqués dans les cliniques de ${city}, ${name} est ressortie dans nos données.`
      : `Been mapping missed call patterns across clinics in ${city} — ${name} came up in our data.`;
  }

  // 5 — Generic fallback
  return isQuebec
    ? `${name} est ressortie dans notre analyse des habitudes de communication patient au Canada.`
    : `${name} came up in our analysis of Canadian clinic communication patterns.`;
}

export function buildSignalEmail(clinic) {
  const name = clinic.clinicName || clinic.name || 'your clinic';
  const slug = clinic.slug ||
    name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  const pageUrl = `${BASE_URL}/for/${slug}`;

  const isQuebec = clinic.language === 'fr' ||
    (clinic.province === 'QC' && /clinique|dentaire|soins/i.test(name));

  const city    = clinic.city || '';
  const rating  = clinic.rating  || 0;
  const reviews = clinic.reviewCount || 0;
  const pain    = painText(clinic);
  const firstLine = getFirstLine({ ...clinic, clinicName: name }, isQuebec);

  // Operational subject lines — under 7 words, references their specific situation
  const shortName2 = name.split(/\s+/).slice(0, 2).join(' '); // first 2 words only
  function getSubject() {
    if (pain) {
      return isQuebec
        ? `Avis patient — ${shortName2}`
        : `Patient review — ${shortName2}`;
    }
    if (reviews >= 300) {
      return isQuebec
        ? `${reviews} avis — appels manqués, ${shortName2}?`
        : `${reviews} reviews — missed calls, ${shortName2}?`;
    }
    if (rating >= 4.8 && reviews >= 80) {
      return isQuebec
        ? `${rating}★ (${reviews} avis) — appels manqués?`
        : `${rating}★ (${reviews} reviews) — missed calls?`;
    }
    // Hash the unique email (not name) so two clinics in the same city never
    // collide just because their names share characters. 16 variants keeps the
    // birthday-paradox collision rate below ~5% for batches of ≤10 per city.
    const hashSrc = clinic.email || clinic.domain || name;
    // Position-weighted so info@clinicA and info@clinicB diverge early;
    // mod 17 (prime) gives better bucket distribution than a power of 2.
    const hash = hashSrc.split('').reduce((h, c, i) => (Math.imul(h, 31) + c.charCodeAt(0) * (i + 1)) >>> 0, 5381);
    const cityOrName = city || shortName2;
    const n2 = name.slice(0, 20);
    const n3 = name.slice(0, 25);
    const variants = isQuebec ? [
      `Appels manqués à ${cityOrName}`,
      `Une question pour ${n3}`,
      `Ce que j'ai trouvé — ${n3}`,
      `Patients perdus à ${cityOrName}`,
      `${n2} — appels manqués?`,
      `Données de ${cityOrName} — ${n2}`,
      `Pour ${n3}`,
      `Cliniques à ${cityOrName} — ce que j'observe`,
      `Question rapide — ${n3}`,
      `${n2} — un détail intéressant`,
      `Ce que j'observe à ${cityOrName}`,
      `Juste une question, ${n2}`,
      `Analyse ${cityOrName} — ${n2}`,
      `${n3} — quelque chose à partager`,
      `Retours patients à ${cityOrName}`,
      `${n2} — données locales`,
    ] : [
      `Missed calls at ${n3}`,
      `Quick question — ${n3}`,
      `Something I noticed — ${n3}`,
      `${cityOrName} dental clinics — what I found`,
      `${n2} — missed calls?`,
      `For ${n3}`,
      `${cityOrName} data — ${n2}`,
      `What I found in ${cityOrName}`,
      `A quick thought — ${n3}`,
      `${n2} — something worth sharing`,
      `Local data for ${n3}`,
      `Just a question, ${n2}`,
      `${cityOrName} clinics — what I'm seeing`,
      `${n3} — local insight`,
      `Patient patterns in ${cityOrName}`,
      `${n2} — one thing I noticed`,
    ];
    return variants[hash % 17 % variants.length];
  }

  const subject = getSubject();

  const body = isQuebec
    ? `${firstLine}

Texto automatique à chaque appelant manqué en 60 secondes. Configuration 2 minutes. Aucun logiciel.

Une place disponible : clinicflowautomation.com/for/${slug}

${SENDER}`
    : `${firstLine}

Automatic text to every missed caller within 60 seconds. 2-minute setup. No new software.

One spot open this week: clinicflowautomation.com/for/${slug}

${SENDER}`;

  return {
    subject,
    body,
    variant: isQuebec ? 'SIGNAL-FR' : 'SIGNAL',
  };
}
