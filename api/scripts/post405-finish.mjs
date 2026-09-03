/**
 * Провести уже созданный черновик пост. 405.
 *   node scripts/post405-finish.mjs
 */
import { get, all } from '../dist/db.js';
import { postDocument } from '../dist/stock.js';

const MAIN = 'b7142cc4-2b3a-11ec-80bf-00155d3d52d2';
const doc = get(
  `SELECT id, number, posted, comment FROM stock_docs
   WHERE doc_type = 'in' AND comment LIKE '%пост. 405%'
   ORDER BY created_at DESC LIMIT 1`
);
if (!doc?.id) {
  console.error('Документ пост. 405 не найден');
  process.exit(1);
}
if (Number(doc.posted) === 1) {
  console.log('Уже проведён', doc.number);
  process.exit(0);
}

const lines = all(
  `SELECT l.product_id, l.qty, IFNULL(p.sku,'') AS sku
   FROM stock_doc_lines l
   LEFT JOIN products p ON p.id = l.product_id
   WHERE l.doc_id = ?`,
  [doc.id]
);
const before = new Map();
for (const l of lines) {
  const q =
    Number(
      get(`SELECT qty FROM stock_balances WHERE warehouse_id = ? AND product_id = ?`, [
        MAIN,
        l.product_id,
      ])?.qty
    ) || 0;
  before.set(l.product_id, q);
}

postDocument(String(doc.id), { serialsOptional: true });

const mismatches = [];
let qtySum = 0;
for (const l of lines) {
  qtySum += Number(l.qty) || 0;
  const after =
    Number(
      get(`SELECT qty FROM stock_balances WHERE warehouse_id = ? AND product_id = ?`, [
        MAIN,
        l.product_id,
      ])?.qty
    ) || 0;
  const expect = (before.get(l.product_id) || 0) + Number(l.qty);
  if (Math.abs(after - expect) > 0.001) {
    mismatches.push({ sku: l.sku, before: before.get(l.product_id), qty: l.qty, after, expect });
  }
}

const posted = get(`SELECT number, posted FROM stock_docs WHERE id = ?`, [doc.id]);
console.log(
  JSON.stringify(
    {
      ok: true,
      number: posted?.number,
      posted: posted?.posted,
      lines: lines.length,
      qty_sum: qtySum,
      mismatches,
      sample: lines.slice(0, 3).map((l) => ({
        sku: l.sku,
        qty: l.qty,
        before: before.get(l.product_id),
        after:
          Number(
            get(`SELECT qty FROM stock_balances WHERE warehouse_id = ? AND product_id = ?`, [
              MAIN,
              l.product_id,
            ])?.qty
          ) || 0,
      })),
    },
    null,
    2
  )
);
