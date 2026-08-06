#!/usr/bin/env node
/**
 * Импорт приходных/расходных из PG-дампа 1С + связи «из чего» + цены.
 *
 * Соответствие OData:
 *   Document_РасходнаяНакладная → _document591x1
 *   Document_ПриходнаяНакладная → _document581x1
 *
 * Связи (в comment):
 *   расходная ← складской _document500 (через _fld15741)
 *   расходная ← договор _reference128 (_fld15760)
 *   приходная на основании расходной → doc_type=return (возврат от покупателя)
 *
 * Запуск на VPS:
 *   cd /root/1c_pnevmopodveska1_ru/warehouse && node bin/import-1c-pg-docs.mjs
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

function newLineId() {
  return crypto.randomUUID();
}

function buildComment(parts) {
  return parts.filter(Boolean).join(' · ');
}

function main() {
  console.log('DB', DB_PATH);
  const db = new DatabaseSync(DB_PATH);
  db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=OFF; PRAGMA busy_timeout=120000;');

  const fallbackWh =
    db.prepare(`SELECT id FROM warehouses WHERE is_active=1 ORDER BY name LIMIT 1`).get()?.id ||
    db.prepare(`SELECT id FROM warehouses LIMIT 1`).get()?.id;
  if (!fallbackWh) throw new Error('no warehouses in WMS — run import-1c-pg.mjs first');

  const hasProduct = db.prepare(`SELECT id FROM products WHERE id=?`);
  const hasCp = db.prepare(`SELECT id FROM counterparties WHERE id=?`);
  const hasWh = db.prepare(`SELECT id FROM warehouses WHERE id=?`);

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

  // ——— OUT: расходные 591 ———
  console.log('export out headers (591)…');
  const outHdrFile = path.join(TMP, 'docs591_hdr.csv');
  psqlCopyTo(
    `SELECT encode(d._idrref,'hex') AS id_hex,
            coalesce(d._number,'') AS number,
            to_char(d._date_time,'YYYY-MM-DD') AS doc_date,
            CASE WHEN d._posted THEN 1 ELSE 0 END AS posted,
            encode(d._fld15746rref,'hex') AS cp_hex,
            encode(d._fld15768rref,'hex') AS wh_hex,
            encode(d._fld15741_rrref,'hex') AS basis500_hex,
            coalesce(b._number,'') AS basis500_number,
            encode(d._fld15760_rrref,'hex') AS contract_hex,
            coalesce(ct._description,'') AS contract_name,
            coalesce(d._fld15742,'') AS comment_raw
     FROM _document591x1 d
     LEFT JOIN _document500x1 b
       ON b._idrref = d._fld15741_rrref
      AND encode(d._fld15741_rtref,'hex') = '000001f4'
     LEFT JOIN _reference128 ct
       ON ct._idrref = d._fld15760_rrref
      AND encode(d._fld15760_rtref,'hex') = '00000080'
     WHERE NOT d._marked`,
    outHdrFile
  );
  const { rows: outHdr } = parseCsv(fs.readFileSync(outHdrFile, 'utf8'));
  console.log('out headers', outHdr.length);

  console.log('export out lines…');
  const outLnFile = path.join(TMP, 'docs591_lines.csv');
  psqlCopyTo(
    `SELECT encode(L._document591_idrref,'hex') AS doc_hex,
            encode(L._fld15811rref,'hex') AS product_hex,
            L._lineno15800::text AS line_no,
            coalesce(L._fld15810,0)::text AS qty,
            coalesce(L._fld15802,0)::text AS price,
            coalesce(L._fld15826,0)::text AS amount
     FROM _document591_vt15799x1 L
     JOIN _document591x1 d ON d._idrref = L._document591_idrref
     WHERE NOT d._marked`,
    outLnFile
  );
  const { rows: outLines } = parseCsv(fs.readFileSync(outLnFile, 'utf8'));
  const outLinesByDoc = new Map();
  for (const L of outLines) {
    const list = outLinesByDoc.get(L.doc_hex) || [];
    list.push(L);
    outLinesByDoc.set(L.doc_hex, list);
  }
  console.log('out lines', outLines.length);

  let outN = 0;
  let outLnN = 0;
  let outSkipLn = 0;
  db.exec('BEGIN');
  for (const h of outHdr) {
    const id = refToUuid(h.id_hex);
    if (!id) continue;
    let wh = refToUuid(h.wh_hex);
    if (emptyUuid(wh) || !hasWh.get(wh)) wh = fallbackWh;
    let cp = refToUuid(h.cp_hex);
    if (emptyUuid(cp) || !hasCp.get(cp)) cp = null;
    const comment = buildComment([
      h.comment_raw?.trim(),
      h.basis500_number ? `складской:${h.basis500_number}` : '',
      h.contract_name ? `договор:${h.contract_name}` : '',
    ]);
    const lines = outLinesByDoc.get(h.id_hex) || [];
    let amount = 0;
    for (const L of lines) amount += Number(L.amount) || 0;
    upsertDoc.run(id, 'out', h.number || id, h.doc_date || '1970-01-01', wh, cp, comment, Number(h.posted) || 0, amount);
    delLines.run(id);
    for (const L of lines) {
      const productId = refToUuid(L.product_hex);
      const qty = Number(L.qty) || 0;
      if (!productId || !(qty > 0) || !hasProduct.get(productId)) {
        outSkipLn++;
        continue;
      }
      const price = Number(L.price) || 0;
      const lineAmount = Number(L.amount) || price * qty;
      insLine.run(newLineId(), id, productId, qty, price, lineAmount, Number(L.line_no) || 0);
      outLnN++;
    }
    outN++;
    if (outN % 1000 === 0) console.log('out…', outN);
  }
  db.exec('COMMIT');
  console.log('out docs', outN, 'lines', outLnN, 'skipLines', outSkipLn);

  // ——— IN: приходные 581 ———
  console.log('export in headers (581)…');
  const inHdrFile = path.join(TMP, 'docs581_hdr.csv');
  psqlCopyTo(
    `SELECT encode(d._idrref,'hex') AS id_hex,
            coalesce(d._number,'') AS number,
            to_char(d._date_time,'YYYY-MM-DD') AS doc_date,
            CASE WHEN d._posted THEN 1 ELSE 0 END AS posted,
            encode(d._fld15204rref,'hex') AS cp_hex,
            encode(d._fld15217rref,'hex') AS wh_hex,
            encode(d._fld15197_rrref,'hex') AS basis591_hex,
            coalesce(o._number,'') AS basis591_number,
            encode(d._fld15197_rtref,'hex') AS basis_rt,
            coalesce(d._fld15209,'') AS comment_raw
     FROM _document581x1 d
     LEFT JOIN _document591x1 o
       ON o._idrref = d._fld15197_rrref
      AND encode(d._fld15197_rtref,'hex') = '0000024f'
     WHERE NOT d._marked`,
    inHdrFile
  );
  const { rows: inHdr } = parseCsv(fs.readFileSync(inHdrFile, 'utf8'));
  console.log('in headers', inHdr.length);

  console.log('export in lines…');
  const inLnFile = path.join(TMP, 'docs581_lines.csv');
  psqlCopyTo(
    `SELECT encode(L._document581_idrref,'hex') AS doc_hex,
            encode(L._fld15240rref,'hex') AS product_hex,
            L._lineno15239::text AS line_no,
            coalesce(NULLIF(L._fld52644,0), CASE WHEN coalesce(L._fld15244,0)>0 THEN round(L._fld15247/L._fld15244,3) ELSE 1 END, 1)::text AS qty,
            coalesce(L._fld15244,0)::text AS price,
            coalesce(L._fld15247,0)::text AS amount
     FROM _document581_vt15238x1 L
     JOIN _document581x1 d ON d._idrref = L._document581_idrref
     WHERE NOT d._marked`,
    inLnFile
  );
  const { rows: inLines } = parseCsv(fs.readFileSync(inLnFile, 'utf8'));
  const inLinesByDoc = new Map();
  for (const L of inLines) {
    const list = inLinesByDoc.get(L.doc_hex) || [];
    list.push(L);
    inLinesByDoc.set(L.doc_hex, list);
  }
  console.log('in lines', inLines.length);

  let inN = 0;
  let inLnN = 0;
  let inSkipLn = 0;
  db.exec('BEGIN');
  for (const h of inHdr) {
    const id = refToUuid(h.id_hex);
    if (!id) continue;
    let wh = refToUuid(h.wh_hex);
    if (emptyUuid(wh) || !hasWh.get(wh)) wh = fallbackWh;
    let cp = refToUuid(h.cp_hex);
    if (emptyUuid(cp) || !hasCp.get(cp)) cp = null;
    const isReturn = Boolean(h.basis591_number);
    const comment = buildComment([
      h.comment_raw?.trim(),
      isReturn ? `возврат от покупателя · на основании расходной:${h.basis591_number}` : '',
      !isReturn && h.basis_rt === '000001f5' ? 'основание:док.501' : '',
      !isReturn && h.basis_rt === '000001f4' ? 'основание:складской' : '',
    ]);
    const lines = inLinesByDoc.get(h.id_hex) || [];
    let amount = 0;
    for (const L of lines) amount += Number(L.amount) || 0;
    const docType = isReturn ? 'return' : 'in';
    upsertDoc.run(id, docType, h.number || id, h.doc_date || '1970-01-01', wh, cp, comment, Number(h.posted) || 0, amount);
    delLines.run(id);
    for (const L of lines) {
      const productId = refToUuid(L.product_hex);
      let qty = Number(L.qty) || 0;
      const price = Number(L.price) || 0;
      const lineAmount = Number(L.amount) || 0;
      if (!qty && price > 0 && lineAmount > 0) qty = lineAmount / price;
      if (!productId || !(qty > 0) || !hasProduct.get(productId)) {
        inSkipLn++;
        continue;
      }
      insLine.run(newLineId(), id, productId, qty, price, lineAmount || price * qty, Number(L.line_no) || 0);
      inLnN++;
    }
    inN++;
  }
  db.exec('COMMIT');
  console.log('in docs', inN, 'lines', inLnN, 'skipLines', inSkipLn);

  // ——— prices ———
  console.log('export price types…');
  const ptFile = path.join(TMP, 'price_types.csv');
  psqlCopyTo(
    `SELECT encode(_idrref,'hex') AS id_hex, coalesce(_description,'') AS name, coalesce(_code,'') AS code
     FROM _reference106 WHERE NOT _marked`,
    ptFile
  );
  const { rows: ptRows } = parseCsv(fs.readFileSync(ptFile, 'utf8'));
  const upsertPt = db.prepare(
    `INSERT INTO dict_price_types (id, name, products_count)
     VALUES (?, ?, 0)
     ON CONFLICT(id) DO UPDATE SET name=excluded.name`
  );
  // name is UNIQUE — prefer update by name if id differs
  const ptByName = db.prepare(`SELECT id FROM dict_price_types WHERE name=?`);
  let ptN = 0;
  db.exec('BEGIN');
  for (const r of ptRows) {
    const id = refToUuid(r.id_hex);
    const name = (r.name || r.code || '').trim();
    if (!id || !name) continue;
    const existing = ptByName.get(name);
    if (existing && existing.id !== id) {
      // keep existing name row; prices use name string
      ptN++;
      continue;
    }
    try {
      upsertPt.run(id, name);
      ptN++;
    } catch {
      /* unique name clash */
    }
  }
  db.exec('COMMIT');
  console.log('price types', ptN);

  console.log('export prices (latest)…');
  const prFile = path.join(TMP, 'prices.csv');
  psqlCopyTo(
    `SELECT DISTINCT ON (p._fld26714rref, p._fld26713rref)
            encode(p._fld26714rref,'hex') AS product_hex,
            encode(p._fld26713rref,'hex') AS type_hex,
            coalesce(t._description,'') AS type_name,
            p._fld26716::text AS price
     FROM _inforg26712 p
     LEFT JOIN _reference106 t ON t._idrref = p._fld26713rref
     WHERE p._fld26716 IS NOT NULL AND p._fld26716 <> 0
     ORDER BY p._fld26714rref, p._fld26713rref, p._period DESC`,
    prFile
  );
  const { rows: prRows } = parseCsv(fs.readFileSync(prFile, 'utf8'));
  const upsertPrice = db.prepare(
    `INSERT INTO product_prices (id, product_id, price_type, price)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET price=excluded.price, price_type=excluded.price_type`
  );
  let prN = 0;
  let prSkip = 0;
  db.exec('BEGIN');
  for (const r of prRows) {
    const productId = refToUuid(r.product_hex);
    const typeName = (r.type_name || '').trim() || refToUuid(r.type_hex) || 'Цена';
    const price = Number(r.price) || 0;
    if (!productId || !price || !hasProduct.get(productId)) {
      prSkip++;
      continue;
    }
    const id = `${productId}|${typeName}`;
    upsertPrice.run(id, productId, typeName, price);
    prN++;
  }
  db.exec('COMMIT');
  console.log('prices', prN, 'skipped', prSkip);

  // refresh products_count
  db.exec(`
    UPDATE dict_price_types SET products_count = (
      SELECT count(DISTINCT product_id) FROM product_prices WHERE price_type = dict_price_types.name
    )`);

  const stats = {
    out: db.prepare(`SELECT count(*) c FROM stock_docs WHERE source='1c' AND doc_type='out'`).get().c,
    in: db.prepare(`SELECT count(*) c FROM stock_docs WHERE source='1c' AND doc_type='in'`).get().c,
    returns: db.prepare(`SELECT count(*) c FROM stock_docs WHERE source='1c' AND doc_type='return'`).get().c,
    outWithBasis: db
      .prepare(`SELECT count(*) c FROM stock_docs WHERE source='1c' AND doc_type='out' AND comment LIKE '%складской:%'`)
      .get().c,
    prices: db.prepare(`SELECT count(*) c FROM product_prices`).get().c,
    priceTypes: db.prepare(`SELECT count(*) c FROM dict_price_types`).get().c,
  };
  db.prepare(
    `INSERT INTO meta (key, value) VALUES ('1c_pg_docs_import_at', ?)
     ON CONFLICT(key) DO UPDATE SET value=excluded.value`
  ).run(new Date().toISOString());
  console.log('DONE', stats);
}

main();
