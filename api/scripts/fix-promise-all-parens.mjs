/** Fix broken `(await Promise.all(...);` → `(await Promise.all(...));` */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src');

function walk(dir, out = []) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      if (ent.name === 'node_modules' || ent.name === 'dist') continue;
      walk(p, out);
    } else if (ent.name.endsWith('.ts') && !ent.name.endsWith('.d.ts')) out.push(p);
  }
  return out;
}

let fixed = 0;
for (const f of walk(SRC)) {
  let s = fs.readFileSync(f, 'utf8');
  const before = s;
  // (await Promise.all( ... \n    );  where next line is not another )
  s = s.replace(
    /\(await Promise\.all\(([\s\S]*?)\n(\s+)\)\;/g,
    (full, body, indent) => {
      if (!body.includes('map(async') && !body.includes('map( async')) return full;
      if (full.includes(')));\n') || full.includes(')));\r\n')) return full;
      return `(await Promise.all(${body}\n${indent}));\n`;
    }
  );
  // stray ").filter" after map — ").\n    ).filter"
  s = s.replace(/\n(\s+)\)\.filter\(/g, '\n$1.filter(');
  if (s !== before) {
    fs.writeFileSync(f, s);
    fixed++;
    console.log('fixed', path.relative(SRC, f));
  }
}
console.log('files', fixed);
