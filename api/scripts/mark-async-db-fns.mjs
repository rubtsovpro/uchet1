/**
 * Add async to function declarations whose bodies use await get/all/run (db).
 */
import fs from 'node:fs';

const file = process.argv[2];
let src = fs.readFileSync(file, 'utf8');

const fnStart =
  /^(export )?(async )?(function \w+|const \w+ = (async )?\([^)]*\) =>|const \w+ = async function)/;

const lines = src.split('\n');
const out = [];
let i = 0;

function bodyUsesDbAwait(bodyLines) {
  const body = bodyLines.join('\n');
  return /\bawait (get|all|run)\(/.test(body);
}

function injectAsync(line) {
  if (/\basync function\b/.test(line) || /\basync \([^)]*\)\s*=>/.test(line)) return line;
  if (/^export function /.test(line)) return line.replace(/^export function /, 'export async function ');
  if (/^function /.test(line)) return line.replace(/^function /, 'async function ');
  if (/^export const \w+ = function/.test(line))
    return line.replace(/^export const (\w+) = function/, 'export async function $1');
  if (/^const \w+ = function/.test(line))
    return line.replace(/^const (\w+) = function/, 'async function $1');
  return line;
}

while (i < lines.length) {
  const line = lines[i];
  const m = line.match(/^(export )?(async )?(function (\w+)|const (\w+) = (async )?function)/);
  if (m && !line.includes('=>')) {
    const start = i;
    let depth = 0;
    let started = false;
    const body = [line];
    i++;
    while (i < lines.length) {
      const l = lines[i];
      for (const ch of l) {
        if (ch === '{') {
          depth++;
          started = true;
        } else if (ch === '}') depth--;
      }
      body.push(l);
      i++;
      if (started && depth === 0) break;
    }
    if (bodyUsesDbAwait(body)) {
      body[0] = injectAsync(body[0]);
    }
    out.push(...body);
  } else {
    out.push(line);
    i++;
  }
}

fs.writeFileSync(file, out.join('\n'));
console.log('Marked async in', file);
