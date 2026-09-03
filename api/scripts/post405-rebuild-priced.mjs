/**
 * Пересобрать черновик пост. 405 с ценами закупки из Google Sheet.
 * Не проводит документ.
 *
 *   WMS_DATA_DIR=... node scripts/post405-rebuild-priced.mjs /tmp/post405_priced.json
 */
import fs from 'node:fs';
import { all, db, get, run } from '../dist/db.js';
import { createDocument } from '../dist/stock.js';
import { insertLinePlacements } from '../dist/warehouse-cells.js';

const MAIN = 'b7142cc4-2b3a-11ec-80bf-00155d3d52d2';
const CP = '6a671d10-edb8-11ee-80c8-00155d07def5';
const SUPPLY = '405';
const path = process.argv[2] || '/tmp/post405_priced.json';

// ensure column
const cols = all(`PRAGMA table_info(stock_docs)`).map((c) => String(c.name));
if (!cols.includes('supply_number')) {
  db.exec(`ALTER TABLE stock_docs ADD COLUMN supply_number TEXT NOT NULL DEFAULT ''`);
  console.log('added supply_number column');
}

const raw = JSON.parse(fs.readFileSync(path, 'utf8'));
if (!Array.isArray(raw) || !raw.length) throw new Error('empty sheet lines');

// merge same sku + same price
const merged = new Map(); // key sku|price -> {sku, qty, price, amount}
for (const row of raw) {
  const sku = String(row.sku || '').trim().toUpperCase();
  const qty = Number(row.qty) || 0;
  const price = Math.round((Number(row.price) || 0) * 100) / 100;
  if (!sku || !(qty > 0)) continue;
  const key = `${sku}|${price}`;
  if (!merged.has(key)) {
    merged.set(key, { sku, qty: 0, price, amount: 0 });
  }
  const m = merged.get(key);
  m.qty += qty;
  m.amount = Math.round(m.price * m.qty);
}

function norm(s) {
  return String(s || '')
    .trim()
    .toUpperCase();
}

const products = all(
  `SELECT id, sku, brand, IFNULL(is_active,1) AS is_active
   FROM products WHERE IFNULL(item_kind,'product') != 'service'`
);
const bySku = new Map();
for (const p of products) {
  const k = norm(p.sku);
  if (!bySku.has(k)) bySku.set(k, []);
  bySku.get(k).push(p);
}

const inboundLines = [];
const skipped = [];
for (const m of [...merged.values()].sort((a, b) => a.sku.localeCompare(b.sku) || a.price - b.price)) {
  const hits = (bySku.get(norm(m.sku)) || []).filter(
    (p) => Number(p.is_active) === 1 && norm(p.brand) === 'MRAER'
  );
  if (!hits.length) {
    skipped.push(m);
    continue;
  }
  const p = hits[0];
  const hint = get(
    `SELECT IFNULL(c.code,'') AS cell_code
     FROM stock_cell_balances b
     JOIN warehouse_cells c ON c.id = b.cell_id
     WHERE b.warehouse_id = ? AND b.qty > 0
       AND (IFNULL(b.product_id,'') = ? OR upper(IFNULL(b.sku,'')) = ?)
     ORDER BY b.qty DESC LIMIT 1`,
    [MAIN, p.id, m.sku]
  );
  const cell = String(hint?.cell_code || '').trim() || 'П.1';
  inboundLines.push({
    product_id: String(p.id),
    qty: m.qty,
    price: m.price,
    placements: [{ cell_code: cell, qty: m.qty }],
    _sku: m.sku,
    _cell: cell,
  });
}

if (!inboundLines.length) throw new Error('no lines matched');

// wipe old post.405 drafts (unposted only)
const old = all(
  `SELECT id, number, posted FROM stock_docs
   WHERE doc_type = 'in'
     AND (
       number IN ('IN-00001','IN-00002','IN-00003')
       OR (IFNULL(posted,0)=0 AND (comment LIKE '%пост. 405%' OR IFNULL(supply_number,'') = '405'))
     )`
);
for (const d of old) {
  if (Number(d.posted) === 1) {
    console.warn('skip posted', d.number);
    continue;
  }
  run(`DELETE FROM stock_doc_line_placements WHERE doc_id = ?`, [d.id]);
  run(`DELETE FROM stock_doc_lines WHERE doc_id = ?`, [d.id]);
  run(`DELETE FROM stock_docs WHERE id = ?`, [d.id]);
  console.log('deleted draft', d.number);
}

const docId = createDocument({
  doc_type: 'in',
  warehouse_id: MAIN,
  counterparty_id: CP,
  supply_number: SUPPLY,
  comment: `пост. ${SUPPLY} · Поставщик Т · черновик (товар ещё не принят) · цены из листа`,
  serials_optional: true,
  post: false,
  lines: inboundLines.map((l) => ({
    product_id: l.product_id,
    qty: l.qty,
    price: l.price,
    warehouse_id: MAIN,
  })),
});

// ensure supply_number set (in case old dist without column in INSERT)
run(`UPDATE stock_docs SET supply_number = ? WHERE id = ?`, [SUPPLY, docId]);

const dbLines = all(
  `SELECT id, product_id, qty, price, amount FROM stock_doc_lines WHERE doc_id = ? ORDER BY rowid`,
  [docId]
);
if (dbLines.length !== inboundLines.length) {
  throw new Error(`lines mismatch ${dbLines.length} vs ${inboundLines.length}`);
}
dbLines.forEach((dbLine, idx) => {
  insertLinePlacements({
    doc_id: docId,
    line_id: String(dbLine.id),
    warehouse_id: MAIN,
    product_id: String(dbLine.product_id),
    placements: inboundLines[idx].placements,
  });
});

const doc = get(
  `SELECT id, number, posted, supply_number, comment, amount FROM stock_docs WHERE id = ?`,
  [docId]
);
const sum = dbLines.reduce((s, l) => s + (Number(l.amount) || 0), 0);
const qty = dbLines.reduce((s, l) => s + (Number(l.qty) || 0), 0);
const multi = inboundLines.filter((l, i, arr) =>
  arr.some((x, j) => j !== i && x._sku === l._sku && x.price !== l.price)
);

console.log(
  JSON.stringify(
    {
      ok: true,
      draft: doc,
      lines: dbLines.length,
      qty_sum: qty,
      amount_sum: sum,
      skipped,
      multi_price_lines: multi.map((l) => ({ sku: l._sku, qty: l.qty, price: l.price })),
      sample: dbLines.slice(0, 5).map((l, i) => ({
        sku: inboundLines[i]._sku,
        qty: l.qty,
        price: l.price,
        amount: l.amount,
      })),
      url: `https://1c.pnevmopodveska1.ru/docs/${doc?.id}`,
    },
    null,
    2
  )
);
