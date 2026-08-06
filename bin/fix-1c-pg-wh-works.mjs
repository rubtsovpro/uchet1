#!/usr/bin/env node
/**
 * Догрузка строк складских (_document500): товары + работы.
 * Чинит пустые карточки вроде 00НФ-023005 (только работы).
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

function refToUuid(hex) {
  const b = Buffer.from(hex, 'hex');
  if (b.length !== 16) return null;
  return (
    `${b.subarray(12, 16).toString('hex')}-` +
    `${b.subarray(10, 12).toString('hex')}-` +
    `${b.subarray(8, 10).toString('hex')}-` +
    `${b.subarray(0, 2).toString('hex')}-` +
    `${b.subarray(2, 8).toString('hex')}`
  ).toLowerCase();
}

function psqlCopyTo(sqlSelect, outFile) {
  fs.mkdirSync(TMP, { recursive: true });
  const copy = `COPY (${sqlSelect}) TO STDOUT WITH (FORMAT csv, HEADER true)`;
  const r = spawnSync(
    'sudo',
    ['-u', 'postgres', 'psql', '-d', PG_DB, '-v', 'ON_ERROR_STOP=1', '-c', copy],
    { encoding: 'utf8', maxBuffer: 512 * 1024 * 1024 }
  );
  if (r.status !== 0) throw new Error(r.stderr || r.stdout);
  fs.writeFileSync(outFile, r.stdout);
}

function parseCsv(text) {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/).filter((l) => l.length);
  if (!lines.length) return { rows: [] };
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
  return { rows };
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

function main() {
  const db = new DatabaseSync(DB_PATH);
  db.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=120000;');
  const hasProduct = db.prepare(`SELECT id FROM products WHERE id=?`);
  const delLines = db.prepare(`DELETE FROM stock_doc_lines WHERE doc_id=?`);
  const insLine = db.prepare(
    `INSERT INTO stock_doc_lines (id, doc_id, product_id, qty, price, amount, line_no, gtd_key, gtd_code, country_key)
     VALUES (?, ?, ?, ?, ?, ?, ?, '', '', '')`
  );
  const updAmt = db.prepare(`UPDATE stock_docs SET amount=?, comment=? WHERE id=?`);
  const getComment = db.prepare(`SELECT comment FROM stock_docs WHERE id=?`);

  console.log('export goods…');
  const gFile = path.join(TMP, 'fix500_goods.csv');
  psqlCopyTo(
    `SELECT encode(L._document500_idrref,'hex') AS doc_hex,
            encode(L._fld11049_rrref,'hex') AS product_hex,
            L._lineno11047::text AS line_no,
            coalesce(L._fld11052,0)::text AS qty,
            coalesce(L._fld11055,0)::text AS price,
            coalesce(L._fld11058,0)::text AS amount,
            'goods' AS kind
     FROM _document500_vt11046x1 L
     JOIN _document500x1 d ON d._idrref=L._document500_idrref
     WHERE NOT d._marked`,
    gFile
  );

  console.log('export works…');
  const wFile = path.join(TMP, 'fix500_works.csv');
  psqlCopyTo(
    `SELECT encode(L._document500_idrref,'hex') AS doc_hex,
            encode(L._fld11099rref,'hex') AS product_hex,
            L._lineno11097::text AS line_no,
            coalesce(L._fld11103,0)::text AS qty,
            coalesce(L._fld11104,0)::text AS price,
            coalesce(L._fld11105,0)::text AS amount,
            'work' AS kind
     FROM _document500_vt11096x1 L
     JOIN _document500x1 d ON d._idrref=L._document500_idrref
     WHERE NOT d._marked`,
    wFile
  );

  // sale links for comments
  console.log('export sale links…');
  const sFile = path.join(TMP, 'fix500_sales.csv');
  psqlCopyTo(
    `SELECT encode(d._idrref,'hex') AS doc_hex, coalesce(o._number,'') AS sale_number
     FROM _document500x1 d
     JOIN _document591x1 o ON o._fld15741_rrref=d._idrref
       AND encode(o._fld15741_rtref,'hex')='000001f4'
     WHERE NOT d._marked`,
    sFile
  );
  const saleByDoc = new Map();
  for (const r of parseCsv(fs.readFileSync(sFile, 'utf8')).rows) {
    if (r.sale_number) saleByDoc.set(r.doc_hex, r.sale_number);
  }

  const byDoc = new Map();
  for (const file of [gFile, wFile]) {
    for (const L of parseCsv(fs.readFileSync(file, 'utf8')).rows) {
      const list = byDoc.get(L.doc_hex) || [];
      list.push(L);
      byDoc.set(L.doc_hex, list);
    }
  }
  console.log('docs with lines', byDoc.size);

  let docs = 0;
  let linesN = 0;
  let skip = 0;
  db.exec('BEGIN');
  for (const [docHex, lines] of byDoc) {
    const id = refToUuid(docHex);
    if (!id) continue;
    const row = getComment.get(id);
    if (!row) continue; // only patch already imported warehouse docs
    delLines.run(id);
    let amount = 0;
    let hasGoods = false;
    let hasWork = false;
    for (const L of lines) {
      const productId = refToUuid(L.product_hex);
      const qty = Number(L.qty) || 0;
      if (!productId || !(qty > 0) || !hasProduct.get(productId)) {
        skip++;
        continue;
      }
      const price = Number(L.price) || 0;
      const lineAmount = Number(L.amount) || price * qty;
      // works get line_no offset 10000 to avoid clash with goods
      const lineNo = (L.kind === 'work' ? 10000 : 0) + (Number(L.line_no) || 0);
      insLine.run(crypto.randomUUID(), id, productId, qty, price, lineAmount, lineNo);
      amount += lineAmount;
      linesN++;
      if (L.kind === 'work') hasWork = true;
      else hasGoods = true;
    }
    let comment = String(row.comment || '');
    if (!comment.includes('тип:складской')) comment = `тип:складской · ${comment}`.trim();
    const sale = saleByDoc.get(docHex);
    if (sale && !comment.includes(`продажа:${sale}`)) {
      comment = comment.replace(/\s*·\s*продажа:[^·]+/g, '');
      comment = `${comment} · продажа:${sale}`.replace(/^ · /, '');
    }
    if (hasWork && !hasGoods && !comment.includes('только работы')) {
      comment = `${comment} · только работы`;
    }
    updAmt.run(amount, comment, id);
    docs++;
  }
  db.exec('COMMIT');
  console.log('DONE', { docs, linesN, skip });

  const sample = db
    .prepare(`SELECT number, amount, substr(comment,1,90) c,
      (SELECT count(*) FROM stock_doc_lines l WHERE l.doc_id=stock_docs.id) AS lines
     FROM stock_docs WHERE id=?`)
    .get('d7d80d69-8b60-11f1-b04b-0050569b6f2b');
  console.log('sample', sample);
}

main();
