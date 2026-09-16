/**
 * Mechanical prep for async all/get/run from db.js.
 * - await imported all/get/run (and aliases), with (await call()) when needed for precedence
 * - mark containing functions async
 * - cascade await only on callers of newly-async functions
 * Does NOT touch db.ts.
 */
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(__dirname, '../src');

/** @type {Map<string, string>} */
const fileTexts = new Map();
/** @type {Set<string>} */
const touchedFiles = new Set();
/** @type {Map<string, Set<string>>} */
const newlyAsyncByFile = new Map();

function noteNewlyAsync(file, name) {
  if (!name) return;
  if (!newlyAsyncByFile.has(file)) newlyAsyncByFile.set(file, new Set());
  newlyAsyncByFile.get(file).add(name);
}

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

function rel(p) {
  return path.relative(SRC, p);
}

function getText(file) {
  if (!fileTexts.has(file)) fileTexts.set(file, fs.readFileSync(file, 'utf8'));
  return fileTexts.get(file);
}

function setText(file, text) {
  fileTexts.set(file, text);
  touchedFiles.add(file);
}

function parse(file) {
  return ts.createSourceFile(file, getText(file), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
}

function isDbModule(spec) {
  return /(^|\/)db\.js$/.test(String(spec || '').replace(/\\/g, '/'));
}

function collectDbBindings(sf) {
  /** @type {Set<string>} */
  const names = new Set();
  for (const stmt of sf.statements) {
    if (!ts.isImportDeclaration(stmt) || !stmt.importClause) continue;
    const spec = stmt.moduleSpecifier;
    if (!ts.isStringLiteral(spec) || !isDbModule(spec.text)) continue;
    const named = stmt.importClause.namedBindings;
    if (!named || !ts.isNamedImports(named)) continue;
    for (const el of named.elements) {
      const imported = (el.propertyName || el.name).text;
      if (imported === 'all' || imported === 'get' || imported === 'run') {
        names.add(el.name.text);
      }
    }
  }
  return names;
}

function findContainingFunction(node) {
  let cur = node.parent;
  while (cur) {
    if (
      ts.isFunctionDeclaration(cur) ||
      ts.isFunctionExpression(cur) ||
      ts.isArrowFunction(cur) ||
      ts.isMethodDeclaration(cur) ||
      ts.isGetAccessorDeclaration(cur) ||
      ts.isSetAccessorDeclaration(cur)
    ) {
      return cur;
    }
    if (ts.isConstructorDeclaration(cur)) return cur;
    cur = cur.parent;
  }
  return null;
}

function functionAlreadyAsync(fn) {
  return !!(fn.modifiers && fn.modifiers.some((m) => m.kind === ts.SyntaxKind.AsyncKeyword));
}

function functionName(_sf, fn) {
  if (ts.isFunctionDeclaration(fn) && fn.name) return fn.name.text;
  if (ts.isMethodDeclaration(fn) && fn.name && ts.isIdentifier(fn.name)) return fn.name.text;
  if (ts.isFunctionExpression(fn) && fn.name) return fn.name.text;
  const parent = fn.parent;
  if (parent && ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name)) {
    return parent.name.text;
  }
  if (parent && ts.isPropertyAssignment(parent) && ts.isIdentifier(parent.name)) {
    return parent.name.text;
  }
  return null;
}

function applyEdits(text, edits) {
  const sorted = [...edits].sort((a, b) => b.start - a.start || b.end - a.end);
  const seen = new Set();
  const uniq = [];
  for (const e of sorted) {
    const k = `${e.start}:${e.end}:${e.text}`;
    if (seen.has(k)) continue;
    seen.add(k);
    uniq.push(e);
  }
  let out = text;
  for (const e of uniq) out = out.slice(0, e.start) + e.text + out.slice(e.end);
  return out;
}

function alreadyPromiseType(typeNode) {
  return (
    !!typeNode &&
    ts.isTypeReferenceNode(typeNode) &&
    ts.isIdentifier(typeNode.typeName) &&
    typeNode.typeName.text === 'Promise'
  );
}

/** Wrap `: T` → `: Promise<T>` for async fns */
function pushPromiseReturnEdits(sf, fn, edits) {
  if (!fn.type || alreadyPromiseType(fn.type)) return;
  edits.push({ start: fn.type.getStart(sf), end: fn.type.getStart(sf), text: 'Promise<' });
  edits.push({ start: fn.type.getEnd(), end: fn.type.getEnd(), text: '>' });
}

function asyncInsertEdit(sf, fn) {
  if (functionAlreadyAsync(fn)) return null;
  if (ts.isConstructorDeclaration(fn)) return null;
  if (ts.isArrowFunction(fn)) {
    return { start: fn.getStart(sf), end: fn.getStart(sf), text: 'async ' };
  }
  if (
    ts.isMethodDeclaration(fn) ||
    ts.isGetAccessorDeclaration(fn) ||
    ts.isSetAccessorDeclaration(fn)
  ) {
    const start = fn.getStart(sf);
    return { start, end: start, text: 'async ' };
  }
  if (ts.isFunctionDeclaration(fn) || ts.isFunctionExpression(fn)) {
    const fnKeyword = fn.getChildren(sf).find((c) => c.kind === ts.SyntaxKind.FunctionKeyword);
    if (fnKeyword) {
      return { start: fnKeyword.getStart(sf), end: fnKeyword.getStart(sf), text: 'async ' };
    }
    return { start: fn.getStart(sf), end: fn.getStart(sf), text: 'async ' };
  }
  return null;
}

/** Strip await from parameter initializers (illegal). */
function stripAwaitInParamDefaults(sf, fn, edits, text) {
  if (!fn.parameters) return;
  for (const p of fn.parameters) {
    if (!p.initializer) continue;
    function walk(node) {
      if (ts.isAwaitExpression(node)) {
        const awaitKw = node.getChildren(sf).find((c) => c.kind === ts.SyntaxKind.AwaitKeyword);
        if (awaitKw) {
          let delEnd = awaitKw.getEnd();
          while (delEnd < text.length && /\s/.test(text[delEnd])) delEnd++;
          edits.push({ start: awaitKw.getStart(sf), end: delEnd, text: '' });
        }
      }
      ts.forEachChild(node, walk);
    }
    walk(p.initializer);
  }
}

/** Parent requires (await call()) for correct precedence */
function needsParenWrap(call) {
  const p = call.parent;
  if (!p) return false;
  if (ts.isPropertyAccessExpression(p) && p.expression === call) return true;
  if (ts.isElementAccessExpression(p) && p.expression === call) return true;
  if (ts.isCallExpression(p) && p.expression === call) return true;
  if (ts.isTaggedTemplateExpression(p) && p.tag === call) return true;
  if (ts.isNonNullExpression(p) && p.expression === call) return true;
  return false;
}

/**
 * True if call is already awaited:
 * - await call()
 * - (await call())
 * - await call().prop  (wrong precedence — treat as done so we don't stack awaits;
 *   a fix-up pass rewrites these to (await call()).prop)
 */
function callAlreadyAwaited(call) {
  if (!call.parent) return false;
  if (ts.isAwaitExpression(call.parent) && call.parent.expression === call) return true;

  // Walk member chain upward: call().a.b
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

  // (await call()) — ParenthesizedExpression > AwaitExpression > Call
  // already covered by first check when call.parent is AwaitExpression
  return false;
}

/** Push await edits for a CallExpression */
function pushAwaitCall(sf, call, edits) {
  if (callAlreadyAwaited(call)) return false;
  if (needsParenWrap(call)) {
    edits.push({ start: call.getStart(sf), end: call.getStart(sf), text: '(await ' });
    edits.push({ start: call.getEnd(), end: call.getEnd(), text: ')' });
  } else {
    edits.push({ start: call.getStart(sf), end: call.getStart(sf), text: 'await ' });
  }
  return true;
}

function transformDbCalls(file) {
  if (path.basename(file) === 'db.ts') return 0;
  const sf = parse(file);
  const dbNames = collectDbBindings(sf);
  if (!dbNames.size) return 0;

  /** @type {{start:number,end:number,text:string}[]} */
  const edits = [];
  /** @type {Set<ts.Node>} */
  const funcsToAsync = new Set();

  function visit(node) {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      dbNames.has(node.expression.text)
    ) {
      if (pushAwaitCall(sf, node, edits)) {
        const fn = findContainingFunction(node);
        if (fn) funcsToAsync.add(fn);
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(sf);

  for (const fn of funcsToAsync) {
    if (functionAlreadyAsync(fn)) {
      pushPromiseReturnEdits(sf, fn, edits);
      continue;
    }
    const e = asyncInsertEdit(sf, fn);
    if (e) {
      edits.push(e);
      pushPromiseReturnEdits(sf, fn, edits);
      const name = functionName(sf, fn);
      if (name) noteNewlyAsync(file, name);
    }
  }

  if (!edits.length) return 0;
  setText(file, applyEdits(getText(file), edits));
  return edits.length;
}

function resolveImport(fromFile, spec) {
  if (!spec.startsWith('.')) return null;
  const base = path.resolve(path.dirname(fromFile), spec);
  for (const c of [base, base + '.ts', base.replace(/\.js$/, '.ts'), path.join(base, 'index.ts')]) {
    if (fs.existsSync(c) && fs.statSync(c).isFile()) return c;
  }
  return null;
}

function collectImportsOfNewlyAsync(sf) {
  /** @type {Set<string>} */
  const names = new Set();
  for (const stmt of sf.statements) {
    if (!ts.isImportDeclaration(stmt) || !stmt.importClause) continue;
    const spec = stmt.moduleSpecifier;
    if (!ts.isStringLiteral(spec)) continue;
    const resolved = resolveImport(sf.fileName, spec.text);
    if (!resolved) continue;
    const asyncSet = newlyAsyncByFile.get(resolved);
    if (!asyncSet?.size) continue;
    const named = stmt.importClause.namedBindings;
    if (named && ts.isNamedImports(named)) {
      for (const el of named.elements) {
        const imported = (el.propertyName || el.name).text;
        if (asyncSet.has(imported)) names.add(el.name.text);
      }
    }
  }
  return names;
}

function transformCascade(file) {
  if (path.basename(file) === 'db.ts') return 0;
  const sf = parse(file);
  const localNewly = newlyAsyncByFile.get(file) || new Set();
  const importedNewly = collectImportsOfNewlyAsync(sf);
  const callNames = new Set([...localNewly, ...importedNewly]);
  if (!callNames.size) return 0;

  /** @type {{start:number,end:number,text:string}[]} */
  const edits = [];
  /** @type {Set<ts.Node>} */
  const toAsync = new Set();

  function visit(node) {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
      if (callNames.has(node.expression.text)) {
        if (pushAwaitCall(sf, node, edits)) {
          const fn = findContainingFunction(node);
          if (fn) toAsync.add(fn);
        }
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(sf);

  for (const fn of toAsync) {
    if (functionAlreadyAsync(fn)) {
      pushPromiseReturnEdits(sf, fn, edits);
      continue;
    }
    const e = asyncInsertEdit(sf, fn);
    if (e) {
      edits.push(e);
      pushPromiseReturnEdits(sf, fn, edits);
      const name = functionName(sf, fn);
      if (name) noteNewlyAsync(file, name);
    }
  }

  if (!edits.length) return 0;
  setText(file, applyEdits(getText(file), edits));
  return edits.length;
}

/** Rewrite await call().prop → (await call()).prop */
function fixAwaitPrecedence(file) {
  if (path.basename(file) === 'db.ts') return 0;
  const sf = parse(file);
  /** @type {{start:number,end:number,text:string}[]} */
  const edits = [];

  function visit(node) {
    if (ts.isAwaitExpression(node)) {
      let expr = node.expression;
      let depth = 0;
      while (
        (ts.isPropertyAccessExpression(expr) ||
          ts.isElementAccessExpression(expr) ||
          ts.isNonNullExpression(expr)) &&
        expr.expression
      ) {
        depth += 1;
        expr = expr.expression;
      }
      if (ts.isCallExpression(expr) && depth > 0) {
        const awaitKw = node.getChildren(sf).find((c) => c.kind === ts.SyntaxKind.AwaitKeyword);
        if (awaitKw) {
          let delEnd = awaitKw.getEnd();
          const text = getText(file);
          while (delEnd < text.length && /\s/.test(text[delEnd])) delEnd++;
          edits.push({ start: awaitKw.getStart(sf), end: delEnd, text: '' });
        }
        edits.push({ start: expr.getStart(sf), end: expr.getStart(sf), text: '(await ' });
        edits.push({ start: expr.getEnd(), end: expr.getEnd(), text: ')' });
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(sf);
  if (!edits.length) return 0;
  setText(file, applyEdits(getText(file), edits));
  return edits.length;
}

function addPrepareTodos(file) {
  if (path.basename(file) === 'db.ts') return 0;
  const text = getText(file);
  const lines = text.split('\n');
  let changed = 0;
  const out = lines.map((line) => {
    if (/db\.(prepare|exec)\s*\(/.test(line) && !/PG: replace prepare/.test(line)) {
      changed += 1;
      return line.replace(/(db\.(?:prepare|exec)\s*\()/, '/* PG: replace prepare */ $1');
    }
    return line;
  });
  if (changed) setText(file, out.join('\n'));
  return changed;
}

function main() {
  const files = listTsFiles(SRC).filter((f) => path.basename(f) !== 'db.ts');
  console.log(`Files scanned: ${files.length}`);

  let totalDb = 0;
  for (const f of files) totalDb += transformDbCalls(f);
  console.log(`Pass A (db await/async) edits: ${totalDb}`);

  for (let i = 0; i < 25; i++) {
    let n = 0;
    for (const f of files) n += transformCascade(f);
    console.log(`Cascade pass ${i + 1}: ${n} edits`);
    if (n === 0) break;
    if (i >= 3 && n > 0) {
      // safety: fix precedence each few passes
      let fp = 0;
      for (const f of files) fp += fixAwaitPrecedence(f);
      if (fp) console.log(`  precedence fixes: ${fp}`);
    }
  }

  let prep = 0;
  for (const f of files) prep += addPrepareTodos(f);
  console.log(`PG prepare TODOs: ${prep}`);

  // final precedence sweep
  let fp = 0;
  for (const f of files) fp += fixAwaitPrecedence(f);
  console.log(`Final precedence fixes: ${fp}`);

  // Strip await in param defaults + ensure Promise<> on all newly-async (second sweep)
  let paramStrips = 0;
  for (const f of touchedFiles.size ? touchedFiles : files) {
    const sf = parse(f);
    const text = getText(f);
    /** @type {{start:number,end:number,text:string}[]} */
    const edits = [];
    function visit(node) {
      if (
        ts.isFunctionDeclaration(node) ||
        ts.isFunctionExpression(node) ||
        ts.isArrowFunction(node) ||
        ts.isMethodDeclaration(node)
      ) {
        if (functionAlreadyAsync(node)) {
          pushPromiseReturnEdits(sf, node, edits);
          const before = edits.length;
          stripAwaitInParamDefaults(sf, node, edits, text);
          paramStrips += edits.length - before;
        }
      }
      ts.forEachChild(node, visit);
    }
    visit(sf);
    if (edits.length) setText(f, applyEdits(getText(f), edits));
  }
  console.log(`Param-default await strips: ${paramStrips}`);

  let written = 0;
  for (const f of touchedFiles) {
    fs.writeFileSync(f, getText(f));
    written += 1;
  }
  console.log(`Files written: ${written}`);

  // sanity
  let bad = 0;
  for (const f of touchedFiles) {
    const t = getText(f);
    const m = t.match(/await\s+await\b/g);
    if (m) {
      bad += m.length;
      console.log('BAD', rel(f), m.length);
    }
  }
  console.log(`await await leftovers: ${bad}`);
  console.log('---');
  console.log([...touchedFiles].map(rel).sort().join('\n'));
}

main();
