/**
 * ReturnType<typeof asyncFn> → Awaited<ReturnType<typeof asyncFn>>
 * Safe for sync fns too (Awaited<T> = T).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(__dirname, '../src');

function listTsFiles(dir) {
  const out = [];
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      if (ent.name === 'node_modules' || ent.name === 'dist' || ent.name === 'types') continue;
      out.push(...listTsFiles(p));
    } else if (ent.isFile() && ent.name.endsWith('.ts') && !ent.name.endsWith('.d.ts')) {
      out.push(p);
    }
  }
  return out;
}

let files = 0;
let n = 0;

for (const f of listTsFiles(SRC)) {
  if (path.basename(f) === 'db.ts') continue;
  const before = fs.readFileSync(f, 'utf8');
  let out = '';
  let i = 0;
  let changed = false;
  while (i < before.length) {
    const idx = before.indexOf('ReturnType<', i);
    if (idx < 0) {
      out += before.slice(i);
      break;
    }
    const pre = before.slice(Math.max(0, idx - 8), idx);
    if (pre.endsWith('Awaited<')) {
      out += before.slice(i, idx + 'ReturnType<'.length);
      i = idx + 'ReturnType<'.length;
      continue;
    }
    let depth = 0;
    let j = idx + 'ReturnType'.length;
    for (; j < before.length; j++) {
      const ch = before[j];
      if (ch === '<') depth++;
      else if (ch === '>') {
        depth--;
        if (depth === 0) {
          j++;
          break;
        }
      }
    }
    out += before.slice(i, idx) + 'Awaited<' + before.slice(idx, j) + '>';
    n += 1;
    changed = true;
    i = j;
  }
  if (changed) {
    fs.writeFileSync(f, out);
    files += 1;
  }
}

console.log({ files, n });
