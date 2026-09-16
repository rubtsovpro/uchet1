/**
 * One-off: prepend await to top-level db get/all/run calls (not Map.get etc).
 */
import fs from 'node:fs';
import path from 'node:path';

const file = process.argv[2];
if (!file) {
  console.error('Usage: node fix-db-awaits.mjs <file.ts>');
  process.exit(1);
}

let src = fs.readFileSync(file, 'utf8');
for (const fn of ['get', 'all', 'run']) {
  src = src.replace(new RegExp(`(?<![.\\w])${fn}\\(`, 'g'), (match, offset, whole) => {
    const before = whole.slice(Math.max(0, offset - 8), offset);
    if (/await\s$/.test(before)) return match;
    return `await ${fn}(`;
  });
}
fs.writeFileSync(file, src);
console.log('Patched', path.basename(file));
