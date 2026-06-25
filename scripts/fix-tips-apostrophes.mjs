// Fix unescaped apostrophes in TIPS array
import fs from 'fs';

const Q = String.fromCharCode(39); // straight apostrophe: '

let html = fs.readFileSync('public/netlify-deploy/call-assistant.html', 'utf8');

const lines = html.split('\n');
let changed = 0;

const fixed = lines.map(line => {
  if (line.includes('Stay warm') && line.includes('don') && line.includes('t pitch')) {
    // Change outer single quotes to double quotes on this line
    const trimmed = line.trimStart();
    const indent = line.slice(0, line.length - trimmed.length);
    // Remove outer single quotes and wrap in double quotes
    const inner = trimmed.replace(/^'/, '').replace(/'^$/, '').replace(/,\s*$/, '');
    // Actually: just do a targeted replacement of the outer quote characters
    const out = line
      .replace(Q + 'Stay warm', '"Stay warm')
      .replace('pitch.' + Q + ',', 'pitch.",');
    changed++;
    return out;
  }
  if (line.includes('After 5 calls') && line.includes('ll feel')) {
    const out = line
      .replace(Q + 'After 5 calls', '"After 5 calls')
      .replace('natural.' + Q + ',', 'natural.",');
    changed++;
    return out;
  }
  return line;
});

console.log('Lines changed:', changed);

if (changed === 0) {
  const tipLines = lines.filter(l => l.includes('warm') || l.includes('After 5'));
  console.log('Could not match. Found:');
  tipLines.forEach(l => {
    const codes = Array.from(l).map(c => c.charCodeAt(0).toString(16)).join(' ');
    console.log('  text:', l);
    console.log('  hex:', codes);
  });
} else {
  html = fixed.join('\n');
  fs.writeFileSync('public/netlify-deploy/call-assistant.html', html, 'utf8');
  fs.copyFileSync('public/netlify-deploy/call-assistant.html', 'public/call-assistant.html');

  const verify = fs.readFileSync('public/netlify-deploy/call-assistant.html', 'utf8');
  const scriptStart = verify.indexOf('<script>');
  const scriptEnd   = verify.lastIndexOf('</script>');
  const script = verify.slice(scriptStart + 8, scriptEnd);
  try {
    new Function(script);
    console.log('✓ Script parses cleanly');
  } catch(e) {
    console.log('Parse error:', e.message);
    const slines = script.split('\n');
    const errMatch = e.stack?.match(/<anonymous>:(\d+)/);
    const errLine = errMatch ? parseInt(errMatch[1]) : 0;
    if (errLine > 0) {
      slines.slice(Math.max(0,errLine-3), errLine+2).forEach((l,i) => {
        console.log((errLine-2+i) + ': ' + l);
      });
    }
  }

  const vlines = verify.split('\n');
  console.log('Line 281:', vlines[280]);
  console.log('Line 289:', vlines[288]);
}
