/**
 * Fix remaining async cutover hotspots:
 * - .map(async ...) → await Promise.all(.map(async ...))
 * - await calls of names destructured from await import(...)
 * - `param: T = undefined` → `param?: T`
 * - sync Hono handlers that contain await → async
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

function findContainingFunction(node) {
  let cur = node.parent;
  while (cur) {
    if (
      ts.isFunctionDeclaration(cur) ||
      ts.isFunctionExpression(cur) ||
      ts.isArrowFunction(cur) ||
      ts.isMethodDeclaration(cur)
    ) {
      return cur;
    }
    cur = cur.parent;
  }
  return null;
}

function asyncInsertEdit(sf, fn) {
  if (isAsync(fn)) return null;
  if (ts.isArrowFunction(fn)) {
    return { start: fn.getStart(sf), end: fn.getStart(sf), text: 'async ' };
  }
  if (ts.isMethodDeclaration(fn)) {
    return { start: fn.getStart(sf), end: fn.getStart(sf), text: 'async ' };
  }
  if (ts.isFunctionDeclaration(fn) || ts.isFunctionExpression(fn)) {
    const fnKeyword = fn.getChildren(sf).find((c) => c.kind === ts.SyntaxKind.FunctionKeyword);
    if (fnKeyword) {
      return { start: fnKeyword.getStart(sf), end: fnKeyword.getStart(sf), text: 'async ' };
    }
  }
  return null;
}

let mapFixes = 0;
let dynFixes = 0;
let defaultFixes = 0;
let handlerFixes = 0;
let filesChanged = 0;

for (const file of listTsFiles(SRC)) {
  if (path.basename(file) === 'db.ts') continue;
  let text = fs.readFileSync(file, 'utf8');
  let changed = false;

  // 1) .map(async ...) → await Promise.all(...)
  {
    const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
    /** @type {{start:number,end:number,text:string}[]} */
    const edits = [];
    function visit(node) {
      if (
        ts.isCallExpression(node) &&
        ts.isPropertyAccessExpression(node.expression) &&
        node.expression.name.text === 'map' &&
        node.arguments[0] &&
        (ts.isArrowFunction(node.arguments[0]) || ts.isFunctionExpression(node.arguments[0])) &&
        isAsync(node.arguments[0])
      ) {
        const p = node.parent;
        const inPromiseAll =
          p &&
          ts.isCallExpression(p) &&
          ts.isPropertyAccessExpression(p.expression) &&
          ts.isIdentifier(p.expression.expression) &&
          p.expression.expression.text === 'Promise' &&
          p.expression.name.text === 'all';
        if (!inPromiseAll) {
          const alreadyAwaited = p && ts.isAwaitExpression(p);
          if (!alreadyAwaited) {
            edits.push({
              start: node.getStart(sf),
              end: node.getStart(sf),
              text: 'await Promise.all(',
            });
            edits.push({ start: node.getEnd(), end: node.getEnd(), text: ')' });
            mapFixes += 1;
            const fn = findContainingFunction(node);
            if (fn) {
              const e = asyncInsertEdit(sf, fn);
              if (e) edits.push(e);
            }
          } else {
            // await arr.map(async) → await Promise.all(arr.map(async))
            // replace await keyword position: wrap the call
            edits.push({
              start: node.getStart(sf),
              end: node.getStart(sf),
              text: 'Promise.all(',
            });
            edits.push({ start: node.getEnd(), end: node.getEnd(), text: ')' });
            mapFixes += 1;
          }
        }
      }
      ts.forEachChild(node, visit);
    }
    visit(sf);
    if (edits.length) {
      text = applyEdits(text, edits);
      changed = true;
    }
  }

  // 2) dynamic import destructured names — await calls, but never `new X(` / declarations
  {
    const re = /const\s*\{([^}]+)\}\s*=\s*await\s+import\s*\(([^)]+)\)\s*;/g;
    /** @type {string[]} */
    const names = [];
    let m;
    while ((m = re.exec(text))) {
      const mod = String(m[2] || '');
      // skip node builtins — constructors / sync APIs
      if (/node:/.test(mod)) continue;
      for (const part of m[1].split(',')) {
        const t = part.trim();
        if (!t) continue;
        const as = t.split(/\s+as\s+/i);
        const local = (as[1] || as[0]).trim();
        if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(local)) names.push(local);
      }
    }
    for (const name of [...new Set(names)]) {
      const callRe = new RegExp(`(?<!\\.)\\b${name}\\s*\\(`, 'g');
      text = text.replace(callRe, (match, offset) => {
        const before = text.slice(Math.max(0, offset - 24), offset);
        if (/await\s*$/.test(before)) return match;
        if (/\bnew\s*$/.test(before)) return match;
        if (/\bfunction\s*$/.test(before)) return match;
        if (/\basync\s+function\s*$/.test(before)) return match;
        dynFixes += 1;
        changed = true;
        return `await ${match}`;
      });
    }
  }

  // 3) param: T = undefined → param?: T
  {
    const next = text.replace(
      /(\(|,\s*)([A-Za-z_][\w]*)(\??):\s*([^=,\)]+?)\s*=\s*undefined(\s*[,\)])/g,
      (_full, pre, name, _q, typ, post) => {
        defaultFixes += 1;
        changed = true;
        return `${pre}${name}?: ${typ.trim()}${post}`;
      }
    );
    text = next;
  }

  // 4) sync route handlers with await → async
  {
    const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
    /** @type {{start:number,end:number,text:string}[]} */
    const edits = [];
    function visit(node) {
      if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
        const method = node.expression.name.text;
        if (['get', 'post', 'put', 'patch', 'delete', 'all', 'use', 'on'].includes(method)) {
          for (const arg of node.arguments) {
            if (
              (ts.isArrowFunction(arg) || ts.isFunctionExpression(arg)) &&
              !isAsync(arg)
            ) {
              let hasAwait = false;
              (function scan(n) {
                if (ts.isAwaitExpression(n)) hasAwait = true;
                else ts.forEachChild(n, scan);
              })(arg);
              if (hasAwait) {
                edits.push({ start: arg.getStart(sf), end: arg.getStart(sf), text: 'async ' });
                handlerFixes += 1;
              }
            }
          }
        }
      }
      ts.forEachChild(node, visit);
    }
    visit(sf);
    if (edits.length) {
      text = applyEdits(text, edits);
      changed = true;
    }
  }

  if (changed) {
    fs.writeFileSync(file, text);
    filesChanged += 1;
  }
}

console.log({ filesChanged, mapFixes, dynFixes, defaultFixes, handlerFixes });
