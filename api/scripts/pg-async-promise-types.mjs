/**
 * Fix TS1064: wrap async function return types in Promise<...>.
 * Also strip illegal await from parameter initializers (TS2524).
 */
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
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

function applyEdits(text, edits) {
  const sorted = [...edits].sort((a, b) => b.start - a.start || b.end - a.end);
  const seen = new Set();
  let out = text;
  for (const e of sorted) {
    const k = `${e.start}:${e.end}:${e.text}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out = out.slice(0, e.start) + e.text + out.slice(e.end);
  }
  return out;
}

function isAsync(fn) {
  return !!(fn.modifiers && fn.modifiers.some((m) => m.kind === ts.SyntaxKind.AsyncKeyword));
}

function alreadyPromiseType(typeNode) {
  return (
    !!typeNode &&
    ts.isTypeReferenceNode(typeNode) &&
    ts.isIdentifier(typeNode.typeName) &&
    typeNode.typeName.text === 'Promise'
  );
}

let files = 0;
let wraps = 0;
let defaultFixes = 0;

for (const file of listTsFiles(SRC)) {
  if (path.basename(file) === 'db.ts') continue;
  let text = fs.readFileSync(file, 'utf8');
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  /** @type {{start:number,end:number,text:string}[]} */
  const edits = [];

  function fixFn(fn) {
    if (!isAsync(fn)) return;
    if (fn.type && !alreadyPromiseType(fn.type)) {
      edits.push({ start: fn.type.getStart(sf), end: fn.type.getStart(sf), text: 'Promise<' });
      edits.push({ start: fn.type.getEnd(), end: fn.type.getEnd(), text: '>' });
      wraps += 1;
    }
    if (fn.parameters) {
      for (const p of fn.parameters) {
        if (!p.initializer) continue;
        function stripAwait(node) {
          if (ts.isAwaitExpression(node)) {
            const awaitKw = node.getChildren(sf).find((c) => c.kind === ts.SyntaxKind.AwaitKeyword);
            if (awaitKw) {
              let delEnd = awaitKw.getEnd();
              while (delEnd < text.length && /\s/.test(text[delEnd])) delEnd++;
              edits.push({ start: awaitKw.getStart(sf), end: delEnd, text: '' });
              defaultFixes += 1;
            }
          }
          ts.forEachChild(node, stripAwait);
        }
        stripAwait(p.initializer);
      }
    }
  }

  function visit(node) {
    if (
      ts.isFunctionDeclaration(node) ||
      ts.isFunctionExpression(node) ||
      ts.isArrowFunction(node) ||
      ts.isMethodDeclaration(node)
    ) {
      fixFn(node);
    }
    ts.forEachChild(node, visit);
  }
  visit(sf);

  if (edits.length) {
    fs.writeFileSync(file, applyEdits(text, edits));
    files += 1;
  }
}

console.log({ files, wraps, defaultFixes });
