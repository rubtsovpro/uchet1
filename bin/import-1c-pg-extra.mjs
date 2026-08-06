#!/usr/bin/env node
/**
 * Догрузка из PG-дампа 1С:
 *   договоры _reference128 → contracts
 *   складские _document500 → stock_docs (out, comment тип:складской)
 *   возвраты/прочее _document562 → stock_docs (in)
 *   оплаты _document572 → bank_docs_local (in)
 *
 * Запуск: node bin/import-1c-pg-extra.mjs
 */
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DB_PATH = process.env.WMS_DATA_DIR
  ? path.join(process.env.WMS_DATA_DIR, 'warehouse.sqlite')
  : path.join(ROOT, 'data', 'warehouse.sqlite');
const PG_DB = process.env.PG_1C_DB || 'Pnevmopodveska_2025';
const TMP = '/root/1c-rarus-s3/import-tmp';

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

function emptyUuid(id) {
  return !id || id === '00000000-0000-0000-0000-000000000000';
}

function psqlCopyTo(sqlSelect, outFile) {
  fs.mkdirSync(TMP, { recursive: true });
  const copy = `COPY (${sqlSelect}) TO STDOUT WITH (FORMAT csv, HEADER true)`;
  const r = spawnSync(
    'sudo',
    ['-u', 'postgres', 'psql', '-d', PG_DB, '-v', 'ON_ERROR_STOP=1', '-c', copy],
    { encoding: 'utf8', maxBuffer: 512 * 1024 * 1024 }
  );
  if (r.status !== 0) throw new Error(`psql COPY failed: ${r.stderr || r.stdout}`);
  fs.writeFileSync(outFile, r.stdout);
  return outFile;
}

function parseCsv(text) {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/).filter((l) => l.length);
  if (!lines.length) return { header: [], rows: [] };
  const header = splitCsvLine(lines[0]);
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = splitCsvLine(lines[i]);
    if (cols.length === 1 && cols[0] === '') continue;
    const obj = {};
    header.forEach((h, j) => {
      obj[h] = cols[j] ?? '';
    });
    rows.push(obj);
  }
  return { header, rows };
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

function newId() {
  return crypto.randomUUID();
}

function buildComment(parts) {
  return parts.filter(Boolean).join(' · ');
}

function ensureSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS contracts (
      id TEXT PRIMARY KEY,
      counterparty_id TEXT,
      code TEXT NOT NULL DEFAULT '',
      name TEXT NOT NULL DEFAULT '',
      is_active INTEGER NOT NULL DEFAULT 1,
      source TEXT NOT NULL DEFAULT 'local'
    );
    CREATE INDEX IF NOT EXISTS idx_contracts_cp ON contracts(counterparty_id);
    CREATE INDEX IF NOT EXISTS idx_contracts_code ON contracts(code);
    CREATE TABLE IF NOT EXISTS bank_docs_local (
      id TEXT PRIMARY KEY,
      doc_type TEXT NOT NULL DEFAULT 'in',
      number TEXT NOT NULL,
      doc_date TEXT NOT NULL,
      amount REAL NOT NULL DEFAULT 0,
      counterparty TEXT NOT NULL DEFAULT '',
      purpose TEXT NOT NULL DEFAULT '',
      source TEXT NOT NULL DEFAULT 'local',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
}

function main() {
  console.log('DB', DB_PATH);
  const db = new DatabaseSync(DB_PATH);
  db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=OFF; PRAGMA busy_timeout=120000;');
  ensureSchema(db);

  const fallbackWh =
    db.prepare(`SELECT id FROM warehouses WHERE is_active=1 ORDER BY name LIMIT 1`).get()?.id ||
    db.prepare(`SELECT id FROM warehouses LIMIT 1`).get()?.id;
  if (!fallbackWh) throw new Error('no warehouses');

  const hasProduct = db.prepare(`SELECT id FROM products WHERE id=?`);
  const hasCp = db.prepare(`SELECT id FROM counterparties WHERE id=?`);
  const hasWh = db.prepare(`SELECT id FROM warehouses WHERE id=?`);
  const cpName = db.prepare(`SELECT name FROM counterparties WHERE id=?`);

  const upsertDoc = db.prepare(
    `INSERT INTO stock_docs
      (id, doc_type, number, doc_date, warehouse_id, warehouse_to_id, counterparty_id, comment, posted, amount, source)
     VALUES (?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, '1c')
     ON CONFLICT(id) DO UPDATE SET
       number=excluded.number,
       doc_date=excluded.doc_date,
       warehouse_id=excluded.warehouse_id,
       counterparty_id=excluded.counterparty_id,
       comment=excluded.comment,
       posted=excluded.posted,
       amount=excluded.amount,
       source='1c'`
  );
  const delLines = db.prepare(`DELETE FROM stock_doc_lines WHERE doc_id=?`);
  const insLine = db.prepare(
    `INSERT INTO stock_doc_lines
      (id, doc_id, product_id, qty, price, amount, line_no, gtd_key, gtd_code, country_key)
     VALUES (?, ?, ?, ?, ?, ?, ?, '', '', '')`
  );

  // ——— contracts ———
  console.log('export contracts…');
  const ctFile = path.join(TMP, 'contracts.csv');
  psqlCopyTo(
    `SELECT encode(c._idrref,'hex') AS id_hex,
            encode(c._ownerid_rrref,'hex') AS cp_hex,
            coalesce(c._code,'') AS code,
            coalesce(c._description,'') AS name,
            CASE WHEN c._marked THEN 1 ELSE 0 END AS marked
     FROM _reference128 c`,
    ctFile
  );
  const { rows: ctRows } = parseCsv(fs.readFileSync(ctFile, 'utf8'));
  const upsertCt = db.prepare(
    `INSERT INTO contracts (id, counterparty_id, code, name, is_active, source)
     VALUES (?, ?, ?, ?, ?, '1c')
     ON CONFLICT(id) DO UPDATE SET
       counterparty_id=excluded.counterparty_id,
       code=excluded.code,
       name=excluded.name,
       is_active=excluded.is_active,
       source='1c'`
  );
  let ctN = 0;
  db.exec('BEGIN');
  for (const r of ctRows) {
    const id = refToUuid(r.id_hex);
    if (!id) continue;
    let cp = refToUuid(r.cp_hex);
    if (emptyUuid(cp) || !hasCp.get(cp)) cp = null;
    upsertCt.run(id, cp, (r.code || '').trim(), (r.name || r.code || id).trim(), r.marked === '1' ? 0 : 1);
    ctN++;
  }
  db.exec('COMMIT');
  console.log('contracts', ctN);

  // ——— 500 warehouse out ———
  console.log('export warehouse docs 500…');
  const h500 = path.join(TMP, 'docs500_hdr.csv');
  psqlCopyTo(
    `SELECT encode(d._idrref,'hex') AS id_hex,
            coalesce(d._number,'') AS number,
            to_char(d._date_time,'YYYY-MM-DD') AS doc_date,
            CASE WHEN d._posted THEN 1 ELSE 0 END AS posted,
            encode(d._fld10975rref,'hex') AS cp_hex,
            encode(d._fld11020rref,'hex') AS wh_hex,
            coalesce(s._number,'') AS sale_number,
            coalesce(ct._description,'') AS contract_name
     FROM _document500x1 d
     LEFT JOIN LATERAL (
       SELECT o._number FROM _document591x1 o
       WHERE o._fld15741_rrref = d._idrref
         AND encode(o._fld15741_rtref,'hex') = '000001f4'
       ORDER BY o._date_time DESC LIMIT 1
     ) s ON true
     LEFT JOIN _reference128 ct
       ON ct._idrref = d._fld10991_rrref
      AND encode(d._fld10991_rtref,'hex') = '00000080'
     WHERE NOT d._marked`,
    h500
  );
  const { rows: hdr500 } = parseCsv(fs.readFileSync(h500, 'utf8'));
  const l500 = path.join(TMP, 'docs500_lines.csv');
  psqlCopyTo(
    `SELECT encode(L._document500_idrref,'hex') AS doc_hex,
            encode(L._fld11049_rrref,'hex') AS product_hex,
            L._lineno11047::text AS line_no,
            coalesce(L._fld11052,0)::text AS qty,
            coalesce(L._fld11055,0)::text AS price,
            coalesce(L._fld11058,0)::text AS amount,
            'goods' AS kind
     FROM _document500_vt11046x1 L
     JOIN _document500x1 d ON d._idrref = L._document500_idrref
     WHERE NOT d._marked
     UNION ALL
     SELECT encode(L._document500_idrref,'hex'),
            encode(L._fld11099rref,'hex'),
            (10000 + L._lineno11097)::text,
            coalesce(L._fld11103,0)::text,
            coalesce(L._fld11104,0)::text,
            coalesce(L._fld11105,0)::text,
            'work'
     FROM _document500_vt11096x1 L
     JOIN _document500x1 d ON d._idrref = L._document500_idrref
     WHERE NOT d._marked`,
    l500
  );
  const { rows: lines500 } = parseCsv(fs.readFileSync(l500, 'utf8'));
  const map500 = new Map();
  for (const L of lines500) {
    const list = map500.get(L.doc_hex) || [];
    list.push(L);
    map500.set(L.doc_hex, list);
  }
  let n500 = 0;
  let ln500 = 0;
  db.exec('BEGIN');
  for (const h of hdr500) {
    const id = refToUuid(h.id_hex);
    if (!id) continue;
    let wh = refToUuid(h.wh_hex);
    if (emptyUuid(wh) || !hasWh.get(wh)) wh = fallbackWh;
    let cp = refToUuid(h.cp_hex);
    if (emptyUuid(cp) || !hasCp.get(cp)) cp = null;
    const comment = buildComment([
      'тип:складской',
      h.sale_number ? `продажа:${h.sale_number}` : '',
      h.contract_name ? `договор:${h.contract_name}` : '',
      lines.some((L) => L.kind === 'work') && !lines.some((L) => L.kind === 'goods' || !L.kind)
        ? 'только работы'
        : '',
    ]);
    const lines = map500.get(h.id_hex) || [];
    let amount = 0;
    for (const L of lines) amount += Number(L.amount) || 0;
    upsertDoc.run(id, 'out', h.number || id, h.doc_date || '1970-01-01', wh, cp, comment, Number(h.posted) || 0, amount);
    delLines.run(id);
    for (const L of lines) {
      const productId = refToUuid(L.product_hex);
      const qty = Number(L.qty) || 0;
      if (!productId || !(qty > 0) || !hasProduct.get(productId)) continue;
      const price = Number(L.price) || 0;
      const lineAmount = Number(L.amount) || price * qty;
      insLine.run(newId(), id, productId, qty, price, lineAmount, Number(L.line_no) || 0);
      ln500++;
    }
    n500++;
    if (n500 % 2000 === 0) console.log('500…', n500);
  }
  db.exec('COMMIT');
  console.log('stock 500', n500, 'lines', ln500);

  // ——— 562 returns / misc in ———
  console.log('export docs 562…');
  const h562 = path.join(TMP, 'docs562_hdr.csv');
  psqlCopyTo(
    `SELECT encode(d._idrref,'hex') AS id_hex,
            coalesce(d._number,'') AS number,
            to_char(d._date_time,'YYYY-MM-DD') AS doc_date,
            CASE WHEN d._posted THEN 1 ELSE 0 END AS posted,
            encode(d._fld14076rref,'hex') AS wh_hex,
            encode(d._fld14060_rtref,'hex') AS basis_rt,
            coalesce(b500._number,'') AS basis500_number,
            encode(b500._fld10975rref,'hex') AS cp_from500_hex,
            coalesce(b497._number,'') AS basis497_number
     FROM _document562x1 d
     LEFT JOIN _document500x1 b500
       ON b500._idrref = d._fld14060_rrref
      AND encode(d._fld14060_rtref,'hex') = '000001f4'
     LEFT JOIN _document497x1 b497
       ON b497._idrref = d._fld14060_rrref
      AND encode(d._fld14060_rtref,'hex') = '000001f1'
     WHERE NOT d._marked`,
    h562
  );
  const { rows: hdr562 } = parseCsv(fs.readFileSync(h562, 'utf8'));
  const l562 = path.join(TMP, 'docs562_lines.csv');
  psqlCopyTo(
    `SELECT encode(L._document562_idrref,'hex') AS doc_hex,
            encode(L._fld14093rref,'hex') AS product_hex,
            L._lineno14092::text AS line_no,
            coalesce(L._fld14097,0)::text AS qty,
            coalesce(L._fld14101,0)::text AS price,
            coalesce(L._fld14102,0)::text AS amount
     FROM _document562_vt14091x1 L
     JOIN _document562x1 d ON d._idrref = L._document562_idrref
     WHERE NOT d._marked`,
    l562
  );
  const { rows: lines562 } = parseCsv(fs.readFileSync(l562, 'utf8'));
  const map562 = new Map();
  for (const L of lines562) {
    const list = map562.get(L.doc_hex) || [];
    list.push(L);
    map562.set(L.doc_hex, list);
  }
  let n562 = 0;
  let ln562 = 0;
  db.exec('BEGIN');
  for (const h of hdr562) {
    const id = refToUuid(h.id_hex);
    if (!id) continue;
    let wh = refToUuid(h.wh_hex);
    if (emptyUuid(wh) || !hasWh.get(wh)) wh = fallbackWh;
    let cp = refToUuid(h.cp_from500_hex);
    if (emptyUuid(cp) || !hasCp.get(cp)) cp = null;
    const comment = buildComment([
      'тип:складской приход',
      h.basis500_number ? `на основании складского:${h.basis500_number}` : '',
      h.basis497_number ? `на основании:${h.basis497_number}` : '',
    ]);
    const lines = map562.get(h.id_hex) || [];
    let amount = 0;
    for (const L of lines) amount += Number(L.amount) || 0;
    upsertDoc.run(id, 'in', h.number || id, h.doc_date || '1970-01-01', wh, cp, comment, Number(h.posted) || 0, amount);
    delLines.run(id);
    for (const L of lines) {
      const productId = refToUuid(L.product_hex);
      const qty = Number(L.qty) || 0;
      if (!productId || !(qty > 0) || !hasProduct.get(productId)) continue;
      const price = Number(L.price) || 0;
      const lineAmount = Number(L.amount) || price * qty;
      insLine.run(newId(), id, productId, qty, price, lineAmount, Number(L.line_no) || 0);
      ln562++;
    }
    n562++;
  }
  db.exec('COMMIT');
  console.log('stock 562', n562, 'lines', ln562);

  // ——— 572 payments → bank_docs_local ———
  console.log('export payments 572…');
  const h572 = path.join(TMP, 'docs572.csv');
  psqlCopyTo(
    `SELECT encode(d._idrref,'hex') AS id_hex,
            coalesce(d._number,'') AS number,
            to_char(d._date_time,'YYYY-MM-DD') AS doc_date,
            coalesce(d._fld14489,0)::text AS amount,
            encode(d._fld14467rref,'hex') AS cp_hex,
            coalesce(d._fld14476,'') AS purpose,
            coalesce(s._number,'') AS sale_number,
            CASE WHEN d._posted THEN 1 ELSE 0 END AS posted
     FROM _document572x1 d
     LEFT JOIN _document591x1 s
       ON s._idrref = d._fld14462_rrref
      AND encode(d._fld14462_rtref,'hex') = '0000024f'
     WHERE NOT d._marked`,
    h572
  );
  const { rows: payRows } = parseCsv(fs.readFileSync(h572, 'utf8'));
  const upsertPay = db.prepare(
    `INSERT INTO bank_docs_local
      (id, doc_type, number, doc_date, amount, counterparty, purpose, source, created_at)
     VALUES (?, 'in', ?, ?, ?, ?, ?, '1c', datetime('now'))
     ON CONFLICT(id) DO UPDATE SET
       number=excluded.number,
       doc_date=excluded.doc_date,
       amount=excluded.amount,
       counterparty=excluded.counterparty,
       purpose=excluded.purpose,
       source='1c'`
  );
  let payN = 0;
  db.exec('BEGIN');
  for (const r of payRows) {
    const id = refToUuid(r.id_hex);
    if (!id) continue;
    const amount = Number(r.amount) || 0;
    let cp = refToUuid(r.cp_hex);
    let name = '';
    if (!emptyUuid(cp) && hasCp.get(cp)) name = cpName.get(cp)?.name || '';
    const purpose = buildComment([
      (r.purpose || '').trim(),
      r.sale_number ? `расходная:${r.sale_number}` : '',
      r.posted === '0' ? 'не проведён' : '',
    ]);
    upsertPay.run(id, r.number || id, r.doc_date || '1970-01-01', amount, name, purpose);
    payN++;
  }
  db.exec('COMMIT');
  console.log('payments 572', payN);

  const stats = {
    contracts: db.prepare(`SELECT count(*) c FROM contracts WHERE source='1c'`).get().c,
    out: db.prepare(`SELECT count(*) c FROM stock_docs WHERE source='1c' AND doc_type='out'`).get().c,
    in: db.prepare(`SELECT count(*) c FROM stock_docs WHERE source='1c' AND doc_type='in'`).get().c,
    warehouseOut: db
      .prepare(`SELECT count(*) c FROM stock_docs WHERE source='1c' AND comment LIKE '%тип:складской%'`)
      .get().c,
    stockIn562: db
      .prepare(`SELECT count(*) c FROM stock_docs WHERE source='1c' AND comment LIKE '%тип:складской приход%'`)
      .get().c,
    bank: db.prepare(`SELECT count(*) c FROM bank_docs_local WHERE source='1c'`).get().c,
  };
  db.prepare(
    `INSERT INTO meta (key, value) VALUES ('1c_pg_extra_import_at', ?)
     ON CONFLICT(key) DO UPDATE SET value=excluded.value`
  ).run(new Date().toISOString());
  console.log('DONE', stats);
}

main();
