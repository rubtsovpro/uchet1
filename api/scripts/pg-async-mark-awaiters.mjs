/**
 * Mark any function containing await as async (+ Promise<> return type).
 * Also fix known bad patterns: `new await`, `await request(`, `function await`.
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
let madeAsync = 0;

for (const file of listTsFiles(SRC)) {
  if (path.basename(file) === 'db.ts') continue;
  let text = fs.readFileSync(file, 'utf8');

  // quick text fixes
  text = text.replace(/\bnew\s+await\s+/g, 'new ');
  text = text.replace(/\basync\s+function\s+await\s+/g, 'async function ');
  text = text.replace(/\bfunction\s+await\s+/g, 'function ');

  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  /** @type {{start:number,end:number,text:string}[]} */
  const edits = [];

  function hasAwait(fn) {
    let found = false;
    (function scan(n) {
      if (found) return;
      if (ts.isAwaitExpression(n)) {
        found = true;
        return;
      }
      // don't descend into nested functions
      if (
        n !== fn &&
        (ts.isFunctionDeclaration(n) ||
          ts.isFunctionExpression(n) ||
          ts.isArrowFunction(n) ||
          ts.isMethodDeclaration(n))
      ) {
        return;
      }
      ts.forEachChild(n, scan);
    })(fn);
    return found;
  }

  function visit(node) {
    if (
      ts.isFunctionDeclaration(node) ||
      ts.isFunctionExpression(node) ||
      ts.isArrowFunction(node) ||
      ts.isMethodDeclaration(node)
    ) {
      if (!isAsync(node) && hasAwait(node)) {
        if (ts.isArrowFunction(node)) {
          edits.push({ start: node.getStart(sf), end: node.getStart(sf), text: 'async ' });
        } else if (ts.isMethodDeclaration(node)) {
          edits.push({ start: node.getStart(sf), end: node.getStart(sf), text: 'async ' });
        } else {
          const fnKeyword = node
            .getChildren(sf)
            .find((c) => c.kind === ts.SyntaxKind.FunctionKeyword);
          if (fnKeyword) {
            edits.push({
              start: fnKeyword.getStart(sf),
              end: fnKeyword.getStart(sf),
              text: 'async ',
            });
          }
        }
        if (node.type && !alreadyPromiseType(node.type)) {
          edits.push({
            start: node.type.getStart(sf),
            end: node.type.getStart(sf),
            text: 'Promise<',
          });
          edits.push({ start: node.type.getEnd(), end: node.type.getEnd(), text: '>' });
        }
        madeAsync += 1;
      } else if (isAsync(node) && node.type && !alreadyPromiseType(node.type)) {
        edits.push({
          start: node.type.getStart(sf),
          end: node.type.getStart(sf),
          text: 'Promise<',
        });
        edits.push({ start: node.type.getEnd(), end: node.type.getEnd(), text: '>' });
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(sf);

  // Fix `const req = await request(` from node:https — request is sync ctor
  // Only when file imported request from node:https
  if (/from ['"]node:https['"]/.test(text) || /import\(['"]node:https['"]\)/.test(text)) {
    text = text.replace(/\bawait\s+request\s*\(/g, 'request(');
  }

  if (edits.length) {
    text = applyEdits(text, edits);
  }

  const before = fs.readFileSync(file, 'utf8');
  if (text !== before) {
    fs.writeFileSync(file, text);
    files += 1;
  }
}

console.log({ files, madeAsync });
