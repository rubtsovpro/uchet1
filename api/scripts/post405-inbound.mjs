/**
 * Приход пост. 405 (Поставщик Т) → Основной + ячейки.
 * Usage (on VPS):
 *   set -a; source /etc/warehouse-wms.env; set +a
 *   node scripts/post405-inbound.mjs /tmp/post405_lines.json
 *   node scripts/post405-inbound.mjs /tmp/post405_lines.json --apply
 */
import fs from 'node:fs';
import { all, get } from '../dist/db.js';
import { createInboundWithPlacements } from '../dist/warehouse-inbound.js';

const MAIN = 'b7142cc4-2b3a-11ec-80bf-00155d3d52d2';
const CP = '6a671d10-edb8-11ee-80c8-00155d07def5'; // Поставщик Т (Китай)
const DEFAULT_CELL = 'П.1';
const COMMENT = 'пост. 405 · Поставщик Т · приход с Google Sheet';

const path = process.argv[2] || '/tmp/post405_lines.json';
const apply = process.argv.includes('--apply');

function norm(s) {
  return String(s || '')
    .trim()
    .toUpperCase();
}

const linesRaw = JSON.parse(fs.readFileSync(path, 'utf8'));
if (!Array.isArray(linesRaw) || !linesRaw.length) {
  console.error('empty lines');
  process.exit(1);
}

const already = get(
  `SELECT id, number, comment FROM stock_docs
   WHERE doc_type = 'in' AND comment LIKE ?
   ORDER BY created_at DESC LIMIT 1`,
  ['%пост. 405%']
);
if (already?.id) {
  console.error('Уже есть приход:', already.number, already.comment);
  process.exit(2);
}

const products = all(
  `SELECT id, sku, brand, IFNULL(is_active,1) AS is_active
   FROM products
   WHERE IFNULL(item_kind,'product') != 'service'`
);
const bySku = new Map();
for (const p of products) {
  const k = norm(p.sku);
  if (!bySku.has(k)) bySku.set(k, []);
  bySku.get(k).push(p);
}

const inboundLines = [];
const skipped = [];
for (const line of linesRaw) {
  const sku = String(line.sku || '').trim();
  const qty = Number(line.qty) || 0;
  if (!sku || !(qty > 0)) continue;
  const hits = (bySku.get(norm(sku)) || []).filter(
    (p) => Number(p.is_active) === 1 && norm(p.brand) === 'MRAER'
  );
  if (!hits.length) {
    skipped.push({ sku, qty, reason: 'нет активного MRAER' });
    continue;
  }
  const p = hits[0];
  const hint = get(
    `SELECT IFNULL(c.code,'') AS cell_code
     FROM stock_cell_balances b
     JOIN warehouse_cells c ON c.id = b.cell_id
     WHERE b.warehouse_id = ? AND b.qty > 0
       AND (IFNULL(b.product_id,'') = ? OR IFNULL(b.sku,'') = ?)
     ORDER BY b.qty DESC
     LIMIT 1`,
    [MAIN, p.id, p.sku]
  );
  const cell = String(hint?.cell_code || '').trim() || DEFAULT_CELL;
  inboundLines.push({
    product_id: p.id,
    qty,
    price: 0,
    placements: [{ cell_code: cell, qty }],
    _sku: sku,
    _cell: cell,
  });
}

const qtySum = inboundLines.reduce((s, l) => s + l.qty, 0);
console.log(
  JSON.stringify(
    {
      apply,
      lines: inboundLines.length,
      qty_sum: qtySum,
      skipped,
      default_cell: DEFAULT_CELL,
      sample: inboundLines.slice(0, 5).map((l) => ({
        sku: l._sku,
        qty: l.qty,
        cell: l._cell,
      })),
      cells_used: [...new Set(inboundLines.map((l) => l._cell))].sort(),
    },
    null,
    2
  )
);

if (!apply) {
  console.log('Dry-run. Для проведения: добавьте --apply');
  process.exit(0);
}

if (!inboundLines.length) {
  console.error('Нет строк для прихода');
  process.exit(3);
}

const before = new Map();
for (const l of inboundLines) {
  const q =
    Number(
      get(`SELECT qty FROM stock_balances WHERE warehouse_id = ? AND product_id = ?`, [
        MAIN,
        l.product_id,
      ])?.qty
    ) || 0;
  before.set(l.product_id, q);
}

const result = createInboundWithPlacements({
  warehouse_id: MAIN,
  counterparty_id: CP,
  comment: COMMENT,
  lines: inboundLines.map(({ product_id, qty, price, placements }) => ({
    product_id,
    qty,
    price,
    placements,
  })),
});

const mismatches = [];
for (const l of inboundLines) {
  const after =
    Number(
      get(`SELECT qty FROM stock_balances WHERE warehouse_id = ? AND product_id = ?`, [
        MAIN,
        l.product_id,
      ])?.qty
    ) || 0;
  const expect = (before.get(l.product_id) || 0) + l.qty;
  if (Math.abs(after - expect) > 0.001) {
    mismatches.push({ sku: l._sku, before: before.get(l.product_id), qty: l.qty, after, expect });
  }
}

console.log(
  JSON.stringify(
    {
      ok: true,
      doc_id: result.id,
      number: result.number,
      lines: inboundLines.length,
      qty_sum: qtySum,
      mismatches,
    },
    null,
    2
  )
);
