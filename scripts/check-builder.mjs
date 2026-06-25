import fs from 'fs';
const builder = fs.readFileSync('scripts/build-call-assistant.mjs', 'utf8');
const lines = builder.split('\n');
const btnLines = lines.filter(l => l.includes('out-int') && l.includes('onclick'));
if (!btnLines.length) {
  console.log('No out-int onclick line found in builder');
  // Show lines near renderCard
  lines.forEach((l, i) => {
    if (l.includes('setOutcome')) console.log(i+1 + ': ' + l);
  });
} else {
  btnLines.forEach(l => {
    console.log('Line:', l.trim());
    const idx = l.indexOf('u0027');
    console.log('Has u0027:', idx > -1 ? 'yes, at char ' + idx : 'NO');
    const idx2 = l.indexOf('\\\\u0027');
    console.log('Has \\\\u0027:', idx2 > -1 ? 'yes' : 'NO');
  });
}

// Also run the builder and check the HTML output onclick line
console.log('\n--- Running builder to check output ---');
