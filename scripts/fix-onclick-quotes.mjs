// Fix renderCard onclick outcome buttons — replace broken 'int' with 'int'
// Root cause: \'int\' in builder template literal collapses to 'int' in output,
// breaking the surrounding single-quoted JS string.
// Fix: use ' unicode escape which survives as a literal ' in the JS string
// and is then interpreted as a single-quote by the browser JS engine.
import fs from 'fs';

const Q = String.fromCharCode(39); // '

let html = fs.readFileSync('public/netlify-deploy/call-assistant.html', 'utf8');

// The broken pattern in the HTML is: + i + ','int')">
// where the ','int' is: end of 'setOutcome(', comma, then bare 'int' (broken string)
// We need: + i + ','int')">
// i.e., the comma is INSIDE the outer single-quoted string, followed by 'int'

const fixes = [
  ["," + Q + "int" + Q + ")", ",\\u0027int\\u0027)"],
  ["," + Q + "na"  + Q + ")", ",\\u0027na\\u0027)"],
  ["," + Q + "ni"  + Q + ")", ",\\u0027ni\\u0027)"],
  ["," + Q + "em"  + Q + ")", ",\\u0027em\\u0027)"],
  ["," + Q + "cb"  + Q + ")", ",\\u0027cb\\u0027)"],
];

let changed = 0;
for (const [from, to] of fixes) {
  if (html.includes(from)) {
    html = html.replaceAll(from, to);
    changed++;
    console.log("Fixed: " + JSON.stringify(from) + " -> " + to);
  }
}

console.log("Patterns fixed:", changed);

fs.writeFileSync('public/netlify-deploy/call-assistant.html', html, 'utf8');
fs.copyFileSync('public/netlify-deploy/call-assistant.html', 'public/call-assistant.html');

// Parse check
const verify = fs.readFileSync('public/netlify-deploy/call-assistant.html', 'utf8');
const scriptStart = verify.indexOf('<script>');
const scriptEnd   = verify.lastIndexOf('</script>');
const script = verify.slice(scriptStart + 8, scriptEnd);
try {
  new Function(script);
  console.log('\n✓ Script parses cleanly — no syntax errors');
} catch(e) {
  console.log('\n✗ Parse error:', e.message);
  const slines = script.split('\n');
  const errMatch = e.stack?.match(/<anonymous>:(\d+)/);
  const errLine = errMatch ? parseInt(errMatch[1]) : 0;
  if (errLine > 0) {
    console.log('Context:');
    slines.slice(Math.max(0, errLine-3), errLine+2).forEach((l, idx) => {
      console.log('  ' + (errLine - 2 + idx) + ': ' + l);
    });
  }
}

// Show the fixed lines
const vlines = verify.split('\n');
[387, 388, 389].forEach(n => console.log('Line ' + (n+1) + ':', vlines[n]));
