#!/usr/bin/env node
/**
 * Дозаполнение counterparties.created_at из 1С PG (_fld3996 — дата в карточке).
 * Не затирает уже заполненные даты.
 */
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DB_PATH = process.env.WMS_DATA_DIR
  ? path.join(process.env.WMS_DATA_DIR, 'warehouse.sqlite')
  : path.join(ROOT, 'data', 'warehouse.sqlite');
const PG_DB = process.env.PG_1C_DB || 'Pnevmopodveska_2025';
const TMP = '/tmp/cp-created-at.csv';

function refToUuid(hexOrBuf) {
  const b = typeof hexOrBuf === 'string' ? Buffer.from(hexOrBuf, 'hex') : Buffer.from(hexOrBuf);
  if (b.length !== 16) return null;
  return (
    `${b.subarray(12, 16).toString('hex')}-` +
    `${b.subarray(10, 12).toString('hex')}-` +
    `${b.subarray(8, 10).toString('hex')}-` +
    `${b.subarray(0, 2).toString('hex')}-` +
    `${b.subarray(2, 8).toString('hex')}`
  ).toLowerCase();
}

function splitCsvLine(line) {
  const out = [];
  let cur = '';
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else q = false;
      } else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',') {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

const copy = `COPY (
  SELECT encode(_idrref,'hex') AS id_hex,
         to_char(_fld3996, 'YYYY-MM-DD HH24:MI:SS') AS created_at
  FROM _reference205x1
  WHERE _folder = true
    AND _fld3996 IS NOT NULL
    AND _fld3996 >= TIMESTAMP '1900-01-01'
) TO STDOUT WITH (FORMAT csv, HEADER true)`;

const r = spawnSync(
  'sudo',
  ['-u', 'postgres', 'psql', '-d', PG_DB, '-v', 'ON_ERROR_STOP=1', '-c', copy],
  { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 }
);
if (r.status !== 0) throw new Error(r.stderr || r.stdout);
fs.writeFileSync(TMP, r.stdout);

const db = new DatabaseSync(DB_PATH);
const cols = db.prepare('PRAGMA table_info(counterparties)').all().map((c) => c.name);
if (!cols.includes('created_at')) {
  db.exec(`ALTER TABLE counterparties ADD COLUMN created_at TEXT NOT NULL DEFAULT ''`);
}
db.exec(`
  UPDATE counterparties
  SET created_at = synced_at
  WHERE IFNULL(TRIM(created_at),'') = ''
    AND IFNULL(TRIM(synced_at),'') != ''
`);

const upd = db.prepare(
  `UPDATE counterparties SET created_at = ?
   WHERE id = ? AND IFNULL(TRIM(created_at),'') = ''`
);
const lines = r.stdout.replace(/^\uFEFF/, '').split(/\r?\n/).filter((l) => l.length);
let n = 0;
db.exec('BEGIN');
for (let i = 1; i < lines.length; i++) {
  const [idHex, created] = splitCsvLine(lines[i]);
  const id = refToUuid(idHex);
  if (!id || !created) continue;
  const info = upd.run(created, id);
  if (info.changes) n++;
}
db.exec('COMMIT');
const filled = db.prepare(`SELECT COUNT(*) c FROM counterparties WHERE IFNULL(TRIM(created_at),'') != ''`).get();
console.log({ updated_from_1c: n, with_created_at: filled.c });
