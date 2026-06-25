// Fix TIPS in builder: single-backslash escapes collapse in template literals.
// don\'t in builder template -> don't in HTML (broken JS string)
// don\\'t in builder template -> don\'t in HTML (valid JS escape)
import fs from 'fs';

let builder = fs.readFileSync('scripts/build-call-assistant.mjs', 'utf8');

// The builder file contains literal text: don\'t and you\'ll
// (one backslash before apostrophe). We need two backslashes.

// To search for one backslash in the file, use \\ in JS string literal.
// To replace with two backslashes, use \\\\ in JS string literal.
const from1 = "don\\'t pitch";    // matches: don\'t pitch  (one backslash)
const to1   = "don\\\\'t pitch";  // writes:  don\\'t pitch (two backslashes)

const from2 = "you\\'ll feel";
const to2   = "you\\\\'ll feel";

console.log('Searching for:', JSON.stringify(from1));
console.log('Found:', builder.includes(from1));

let changed = 0;
if (builder.includes(from1)) { builder = builder.replace(from1, to1); changed++; }
if (builder.includes(from2)) { builder = builder.replace(from2, to2); changed++; }
console.log('Fixed:', changed, 'patterns');

fs.writeFileSync('scripts/build-call-assistant.mjs', builder, 'utf8');

// Show the fixed lines
const tipsStart = builder.indexOf('const TIPS');
const tipsEnd   = builder.indexOf('];', tipsStart) + 2;
console.log('\nTIPS section now:');
console.log(builder.slice(tipsStart, tipsEnd));
