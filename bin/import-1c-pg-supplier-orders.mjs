#!/usr/bin/env node
/**
 * Заказы поставщикам из PG (_document501) → thin_journal_docs (journal_key=supplier_orders).
 * UI: /purchases/supplier-orders
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
const TMP = '/root/1c-rarus-s3/import-tmp';
const JOURNAL = 'supplier_orders';

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
    { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 }
  );
  if (r.status !== 0) throw new Error(`psql COPY failed: ${r.stderr || r.stdout}`);
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
  console.log('DB', DB_PATH);
  const db = new DatabaseSync(DB_PATH);
  db.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=120000;');

  const hdrFile = path.join(TMP, 'supplier_orders_hdr.csv');
  psqlCopyTo(
    `SELECT encode(d._idrref,'hex') AS id_hex,
            coalesce(d._number,'') AS number,
            to_char(d._date_time,'YYYY-MM-DD') AS doc_date,
            CASE WHEN d._posted THEN 1 ELSE 0 END AS posted,
            CASE WHEN d._marked THEN 1 ELSE 0 END AS marked,
            encode(d._fld11262rref,'hex') AS cp_hex,
            coalesce(c._description,'') AS cp_name,
            encode(d._fld11273rref,'hex') AS wh_hex,
            coalesce(w._description,'') AS wh_name,
            coalesce(string_agg(DISTINCT i._number, ', ' ORDER BY i._number), '') AS receipt_numbers
     FROM _document501 d
     LEFT JOIN _reference205x1 c ON c._idrref = d._fld11262rref
     LEFT JOIN _reference382 w ON w._idrref = d._fld11273rref
     LEFT JOIN _document581x1 i
       ON i._fld15197_rrref = d._idrref
      AND encode(i._fld15197_rtref,'hex') = '000001f5'
     WHERE NOT d._marked
     GROUP BY d._idrref, d._number, d._date_time, d._posted, d._marked,
              d._fld11262rref, c._description, d._fld11273rref, w._description`,
    hdrFile
  );
  const { rows: headers } = parseCsv(fs.readFileSync(hdrFile, 'utf8'));

  const lnFile = path.join(TMP, 'supplier_orders_lines.csv');
  psqlCopyTo(
    `SELECT encode(L._document501_idrref,'hex') AS doc_hex,
            encode(L._fld11287rref,'hex') AS product_hex,
            coalesce(n._description,'') AS product_name,
            coalesce(n._fld4926,'') AS article,
            L._lineno11286::text AS line_no,
            coalesce(L._fld11289,0)::text AS qty,
            coalesce(L._fld11291,0)::text AS price,
            coalesce(L._fld11294,0)::text AS amount
     FROM _document501_vt11285 L
     JOIN _document501 d ON d._idrref = L._document501_idrref
     LEFT JOIN _reference239x1 n ON n._idrref = L._fld11287rref
     WHERE NOT d._marked`,
    lnFile
  );
  const { rows: lines } = parseCsv(fs.readFileSync(lnFile, 'utf8'));
  const byDoc = new Map();
  for (const L of lines) {
    const list = byDoc.get(L.doc_hex) || [];
    list.push(L);
    byDoc.set(L.doc_hex, list);
  }

  const upsert = db.prepare(
    `INSERT INTO thin_journal_docs
      (id, journal_key, number, doc_date, status, counterparty_name, amount, comment, payload_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
     ON CONFLICT(id) DO UPDATE SET
       journal_key=excluded.journal_key,
       number=excluded.number,
       doc_date=excluded.doc_date,
       status=excluded.status,
       counterparty_name=excluded.counterparty_name,
       amount=excluded.amount,
       comment=excluded.comment,
       payload_json=excluded.payload_json,
       updated_at=datetime('now')`
  );

  let n = 0;
  db.exec('BEGIN');
  for (const h of headers) {
    const id = refToUuid(h.id_hex);
    if (!id) continue;
    const docLines = byDoc.get(h.id_hex) || [];
    let amount = 0;
    const payloadLines = [];
    for (const L of docLines) {
      const qty = Number(L.qty) || 0;
      const price = Number(L.price) || 0;
      const lineAmount = Number(L.amount) || qty * price;
      amount += lineAmount;
      payloadLines.push({
        product_id: refToUuid(L.product_hex),
        name: L.product_name || '',
        article: L.article || '',
        qty,
        price,
        amount: lineAmount,
        line_no: Number(L.line_no) || 0,
      });
    }
    const comment = [
      h.wh_name ? `склад:${h.wh_name}` : '',
      h.receipt_numbers ? `приходные:${h.receipt_numbers}` : '',
      'источник:1С',
    ]
      .filter(Boolean)
      .join(' · ');
    const payload = JSON.stringify({
      source: '1c',
      warehouse_id: emptyUuid(refToUuid(h.wh_hex)) ? null : refToUuid(h.wh_hex),
      counterparty_id: emptyUuid(refToUuid(h.cp_hex)) ? null : refToUuid(h.cp_hex),
      receipt_numbers: h.receipt_numbers || '',
      lines: payloadLines,
    });
    upsert.run(
      id,
      JOURNAL,
      h.number || id,
      h.doc_date || '1970-01-01',
      h.posted === '1' ? 'posted' : 'draft',
      (h.cp_name || '').trim(),
      amount,
      comment,
      payload
    );
    n++;
  }
  db.exec('COMMIT');

  db.prepare(
    `INSERT INTO meta (key, value) VALUES ('1c_pg_supplier_orders_at', ?)
     ON CONFLICT(key) DO UPDATE SET value=excluded.value`
  ).run(new Date().toISOString());

  console.log('DONE', {
    imported: n,
    inJournal: db.prepare(`SELECT count(*) c FROM thin_journal_docs WHERE journal_key=?`).get(JOURNAL).c,
  });
}

main();
