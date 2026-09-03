/**
 * Докидка MRAD01012 × 5 к пост. 405.
 *   WMS_DATA_DIR=... node scripts/post405-mrad01012.mjs
 */
import { get } from '../dist/db.js';
import { createInboundWithPlacements } from '../dist/warehouse-inbound.js';

const MAIN = 'b7142cc4-2b3a-11ec-80bf-00155d3d52d2';
const CP = '6a671d10-edb8-11ee-80c8-00155d07def5';
const SKU = 'MRAD01012';
const QTY = 5;

const p = get(
  `SELECT id, sku, brand, is_active, name FROM products
   WHERE upper(IFNULL(sku,'')) = ?
     AND IFNULL(is_active,1) = 1
     AND upper(IFNULL(brand,'')) = 'MRAER'
   LIMIT 1`,
  [SKU]
);
if (!p?.id) throw new Error('product not found active MRAER');

const hint = get(
  `SELECT IFNULL(c.code,'') AS cell_code
   FROM stock_cell_balances b
   JOIN warehouse_cells c ON c.id = b.cell_id
   WHERE b.warehouse_id = ? AND b.qty > 0
     AND (IFNULL(b.product_id,'') = ? OR upper(IFNULL(b.sku,'')) = ?)
   ORDER BY b.qty DESC LIMIT 1`,
  [MAIN, p.id, SKU]
);
const cell = String(hint?.cell_code || '').trim() || 'П.1';

const before =
  Number(
    get(`SELECT qty FROM stock_balances WHERE warehouse_id = ? AND product_id = ?`, [MAIN, p.id])
      ?.qty
  ) || 0;

const result = createInboundWithPlacements({
  warehouse_id: MAIN,
  counterparty_id: CP,
  comment: 'пост. 405 · докидка MRAD01012 (не вошло в IN-00001)',
  lines: [
    {
      product_id: String(p.id),
      qty: QTY,
      price: 0,
      placements: [{ cell_code: cell, qty: QTY }],
    },
  ],
});

const after =
  Number(
    get(`SELECT qty FROM stock_balances WHERE warehouse_id = ? AND product_id = ?`, [MAIN, p.id])
      ?.qty
  ) || 0;

const doc = get(`SELECT number, posted, comment FROM stock_docs WHERE id = ?`, [result.id]);
console.log(
  JSON.stringify(
    {
      ok: true,
      number: doc?.number,
      posted: doc?.posted,
      comment: doc?.comment,
      product: { id: p.id, sku: p.sku, name: p.name, brand: p.brand },
      cell,
      qty: QTY,
      balance_before: before,
      balance_after: after,
    },
    null,
    2
  )
);
