// Fix the builder script: ' in template literal → ' in output (still broken).
// Need \\u0027 in builder → ' in HTML output → ' in browser JS engine.
import fs from 'fs';

let builder = fs.readFileSync('scripts/build-call-assistant.mjs', 'utf8');

// Current: ,'int')   (one backslash — template collapses to ,'int')
// Target:  ,\\u0027int\\u0027) (two backslashes — template produces ,'int') in HTML)

const single = ',\\u0027';   // string value: ,'  (one backslash)
const double_ = ',\\\\u0027'; // string value: ,\\u0027 (two backslashes)

const singleClose = '\\u0027)';  // ')
const doubleClose = '\\\\u0027)'; // \\u0027)

let changed = 0;

// Replace opening ,'  with  ,\\u0027  (for int, na, ni, em, cb)
['int','na','ni','em','cb'].forEach(code => {
  const fromOpen  = ',' + single.slice(1)  + code + singleClose;  // ,'XXX')
  const toOpen    = ',' + double_.slice(1) + code + doubleClose;   // ,\\u0027XXX\\u0027)
  if (builder.includes(fromOpen)) {
    builder = builder.replaceAll(fromOpen, toOpen);
    changed++;
    console.log('Fixed:', code);
  }
});

console.log('Patterns fixed:', changed);
fs.writeFileSync('scripts/build-call-assistant.mjs', builder, 'utf8');

// Verify the builder line
const rebuilt = fs.readFileSync('scripts/build-call-assistant.mjs', 'utf8');
const btnLine = rebuilt.split('\n').find(l => l.includes('out-int') && l.includes('onclick'));
console.log('\nBuilder onclick line:', btnLine?.trim());
console.log('Has \\\\u0027:', btnLine?.includes('\\\\u0027') ? 'YES' : 'NO — still wrong');
