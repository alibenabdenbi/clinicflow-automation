// Removes bad emails introduced by the first enrichment run:
// 1. Registrar abuse emails from WHOIS (abuse@godaddy.com etc.)
// 2. Pattern emails with truncated clinic-name prefixes (not standard prefixes)
import fs from 'fs';

const QUEUE_PATH = 'data/outreach.localDentists.json';
const dental = JSON.parse(fs.readFileSync(QUEUE_PATH, 'utf8'));

const REGISTRAR_DOMAINS = new Set([
  'godaddy.com', 'namecheap.com', 'enom.com', 'webnames.ca', 'gcd.com',
  'tucows.com', 'register.com', 'networksolutions.com', 'bluehost.com',
  'hostgator.com', 'hover.com', 'dynadot.com', 'porkbun.com',
  'ionos.com', 'gandi.net', 'ovh.com', 'ovh.ca', 'name.com',
  'rebel.ca', 'easydns.com', 'wildwestdomains.com', 'secureserver.net',
]);

const BAD_PREFIXES = ['abuse', 'hostmaster', 'postmaster', 'whois', 'domainabuse', 'registrar'];

const VALID_PATTERN_PREFIXES = new Set([
  'info', 'contact', 'hello', 'reception', 'office', 'admin',
  'dental', 'clinic', 'booking', 'appointments', 'physio',
]);

function isBadEmail(email, source) {
  if (!email) return false;
  const lower = email.toLowerCase();
  const [local, domain] = lower.split('@');
  if (!domain) return false;

  // Bad WHOIS emails
  if (BAD_PREFIXES.some(p => local.startsWith(p))) return true;
  if (REGISTRAR_DOMAINS.has(domain)) return true;

  // Bad pattern emails — prefix that's NOT a standard prefix
  if (source === 'pattern' && !VALID_PATTERN_PREFIXES.has(local)) return true;

  return false;
}

let removed = 0;
let kept = 0;

dental.forEach(c => {
  if (c.email && (c.emailSource === 'whois' || c.emailSource === 'pattern')) {
    if (isBadEmail(c.email, c.emailSource)) {
      console.log(`  Removing [${c.emailSource}] ${c.email} — ${c.clinicName}`);
      delete c.email;
      delete c.emailConfidence;
      delete c.emailSource;
      delete c.emailFoundAt;
      delete c.emailMxVerified;
      removed++;
      return;
    }
  }
  if (c.email) kept++;
});

fs.writeFileSync(QUEUE_PATH, JSON.stringify(dental, null, 2), 'utf8');
console.log(`\nCleanup done: removed ${removed} bad emails, kept ${kept}`);

// Show surviving emails by source
const sources = {};
dental.filter(c => c.email).forEach(c => {
  const s = c.emailSource || 'unknown';
  sources[s] = (sources[s] || 0) + 1;
});
console.log('Remaining by source:', sources);
