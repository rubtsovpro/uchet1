/**
 * Second-wave cascade: await all un-awaited calls to any async function
 * in the project (exported + same-file local). Skips parameter initializers
 * (replaces async call defaults with undefined / {}).
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

function parse(file, text) {
  return ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
}

function isAsync(fn) {
  return !!(fn.modifiers && fn.modifiers.some((m) => m.kind === ts.SyntaxKind.AsyncKeyword));
}

function collectAsyncNames(sf) {
  /** @type {{exported:Set<string>, local:Set<string>}} */
  const out = { exported: new Set(), local: new Set() };
  function note(name, exp) {
    if (!name) return;
    out.local.add(name);
    if (exp) out.exported.add(name);
  }
  for (const stmt of sf.statements) {
    if (ts.isFunctionDeclaration(stmt) && stmt.name && isAsync(stmt)) {
      const exp = !!(stmt.modifiers && stmt.modifiers.some((m) => m.kind === ts.SyntaxKind.ExportKeyword));
      note(stmt.name.text, exp);
    }
    if (ts.isVariableStatement(stmt)) {
      const exp = !!(stmt.modifiers && stmt.modifiers.some((m) => m.kind === ts.SyntaxKind.ExportKeyword));
      for (const d of stmt.declarationList.declarations) {
        if (!ts.isIdentifier(d.name) || !d.initializer) continue;
        if (
          (ts.isArrowFunction(d.initializer) || ts.isFunctionExpression(d.initializer)) &&
          isAsync(d.initializer)
        ) {
          note(d.name.text, exp);
        }
      }
    }
  }
  return out;
}

function resolveImport(fromFile, spec) {
  if (!spec.startsWith('.')) return null;
  const base = path.resolve(path.dirname(fromFile), spec);
  for (const c of [base, base + '.ts', base.replace(/\.js$/, '.ts'), path.join(base, 'index.ts')]) {
    if (fs.existsSync(c) && fs.statSync(c).isFile()) return c;
  }
  return null;
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

function needsParenWrap(call) {
  const p = call.parent;
  if (!p) return false;
  if (ts.isPropertyAccessExpression(p) && p.expression === call) return true;
  if (ts.isElementAccessExpression(p) && p.expression === call) return true;
  if (ts.isCallExpression(p) && p.expression === call) return true;
  if (ts.isNonNullExpression(p) && p.expression === call) return true;
  return false;
}

function callAlreadyAwaited(call) {
  if (call.parent && ts.isAwaitExpression(call.parent) && call.parent.expression === call) return true;
  let node = call;
  let parent = call.parent;
  while (
    parent &&
    ((ts.isPropertyAccessExpression(parent) && parent.expression === node) ||
      (ts.isElementAccessExpression(parent) && parent.expression === node) ||
      (ts.isNonNullExpression(parent) && parent.expression === node))
  ) {
    node = parent;
    parent = parent.parent;
  }
  if (parent && ts.isAwaitExpression(parent) && parent.expression === node) return true;
  return false;
}

function inParamInitializer(node) {
  let cur = node.parent;
  while (cur) {
    if (ts.isParameter(cur) && cur.initializer) {
      // node is inside initializer?
      let n = node;
      while (n && n !== cur) {
        if (n === cur.initializer) return true;
        n = n.parent;
      }
    }
    if (
      ts.isFunctionDeclaration(cur) ||
      ts.isFunctionExpression(cur) ||
      ts.isArrowFunction(cur) ||
      ts.isMethodDeclaration(cur)
    ) {
      break;
    }
    cur = cur.parent;
  }
  // simpler walk
  cur = node;
  while (cur) {
    const p = cur.parent;
    if (p && ts.isParameter(p) && p.initializer === cur) return true;
    if (p && ts.isParameter(p) && p.initializer) {
      // ancestor of initializer
      let x = cur;
      while (x && x !== p) {
        if (x === p.initializer) return true;
        x = x.parent;
      }
    }
    cur = p;
  }
  return false;
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

function functionAlreadyAsync(fn) {
  return !!(fn.modifiers && fn.modifiers.some((m) => m.kind === ts.SyntaxKind.AsyncKeyword));
}

function asyncInsertEdit(sf, fn) {
  if (functionAlreadyAsync(fn)) return null;
  if (ts.isArrowFunction(fn)) {
    return { start: fn.getStart(sf), end: fn.getStart(sf), text: 'async ' };
  }
  if (ts.isMethodDeclaration(fn)) {
    return { start: fn.getStart(sf), end: fn.getStart(sf), text: 'async ' };
  }
  if (ts.isFunctionDeclaration(fn) || ts.isFunctionExpression(fn)) {
    const fnKeyword = fn.getChildren(sf).find((c) => c.kind === ts.SyntaxKind.FunctionKeyword);
    if (fnKeyword) return { start: fnKeyword.getStart(sf), end: fnKeyword.getStart(sf), text: 'async ' };
  }
  return null;
}

function alreadyPromiseType(typeNode) {
  return (
    !!typeNode &&
    ts.isTypeReferenceNode(typeNode) &&
    ts.isIdentifier(typeNode.typeName) &&
    typeNode.typeName.text === 'Promise'
  );
}

function pushPromiseReturn(sf, fn, edits) {
  if (!fn.type || alreadyPromiseType(fn.type)) return;
  edits.push({ start: fn.type.getStart(sf), end: fn.type.getStart(sf), text: 'Promise<' });
  edits.push({ start: fn.type.getEnd(), end: fn.type.getEnd(), text: '>' });
}

const files = listTsFiles(SRC).filter((f) => path.basename(f) !== 'db.ts');
/** @type {Map<string, Set<string>>} */
const exportsByFile = new Map();
/** @type {Map<string, string>} */
const texts = new Map();

for (const f of files) {
  texts.set(f, fs.readFileSync(f, 'utf8'));
  const sf = parse(f, texts.get(f));
  exportsByFile.set(f, collectAsyncNames(sf).exported);
}

let total = 0;
for (let pass = 0; pass < 8; pass++) {
  let passEdits = 0;
  // refresh exports
  for (const f of files) {
    const sf = parse(f, texts.get(f));
    exportsByFile.set(f, collectAsyncNames(sf).exported);
  }

  for (const f of files) {
    const text = texts.get(f);
    const sf = parse(f, text);
    const local = collectAsyncNames(sf);
    /** @type {Set<string>} */
    const callNames = new Set(local.local);

    for (const stmt of sf.statements) {
      if (!ts.isImportDeclaration(stmt) || !stmt.importClause) continue;
      const spec = stmt.moduleSpecifier;
      if (!ts.isStringLiteral(spec)) continue;
      const resolved = resolveImport(f, spec.text);
      if (!resolved) continue;
      const exp = exportsByFile.get(resolved);
      if (!exp?.size) continue;
      const named = stmt.importClause.namedBindings;
      if (named && ts.isNamedImports(named)) {
        for (const el of named.elements) {
          const imported = (el.propertyName || el.name).text;
          if (exp.has(imported)) callNames.add(el.name.text);
        }
      }
    }

    if (!callNames.size) continue;

    /** @type {{start:number,end:number,text:string}[]} */
    const edits = [];
    /** @type {Set<ts.Node>} */
    const toAsync = new Set();

    function isInsideParamInit(node) {
      let cur = node;
      while (cur) {
        const p = cur.parent;
        if (!p) break;
        if (ts.isParameter(p) && p.initializer) {
          let x = cur;
          while (x && x !== p) {
            if (x === p.initializer) return true;
            x = x.parent;
          }
        }
        cur = p;
      }
      return false;
    }

    function visit(node) {
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
        const name = node.expression.text;
        if (callNames.has(name) && !callAlreadyAwaited(node)) {
          if (isInsideParamInit(node)) {
            // Replace entire default call expression chain with undefined
            // Find topmost expression starting from this call used as initializer
            let top = node;
            while (
              top.parent &&
              ((ts.isPropertyAccessExpression(top.parent) && top.parent.expression === top) ||
                (ts.isElementAccessExpression(top.parent) && top.parent.expression === top) ||
                (ts.isCallExpression(top.parent) && top.parent.expression === top) ||
                (ts.isNonNullExpression(top.parent) && top.parent.expression === top) ||
                (ts.isParenthesizedExpression(top.parent) && top.parent.expression === top))
            ) {
              top = top.parent;
            }
            edits.push({ start: top.getStart(sf), end: top.getEnd(), text: 'undefined' });
          } else {
            if (needsParenWrap(node)) {
              edits.push({ start: node.getStart(sf), end: node.getStart(sf), text: '(await ' });
              edits.push({ start: node.getEnd(), end: node.getEnd(), text: ')' });
            } else {
              edits.push({ start: node.getStart(sf), end: node.getStart(sf), text: 'await ' });
            }
            const fn = findContainingFunction(node);
            if (fn) toAsync.add(fn);
          }
        }
      }
      ts.forEachChild(node, visit);
    }
    visit(sf);

    for (const fn of toAsync) {
      if (!functionAlreadyAsync(fn)) {
        const e = asyncInsertEdit(sf, fn);
        if (e) {
          edits.push(e);
          pushPromiseReturn(sf, fn, edits);
        }
      }
    }

    if (edits.length) {
      texts.set(f, applyEdits(text, edits));
      passEdits += edits.length;
    }
  }
  console.log(`pass ${pass + 1}: ${passEdits}`);
  total += passEdits;
  if (passEdits === 0) break;
}

for (const f of files) {
  fs.writeFileSync(f, texts.get(f));
}
console.log(`total edits: ${total}`);
