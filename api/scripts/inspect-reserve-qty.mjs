import { get, all } from '../dist/db.js';

const resId = String(get(`SELECT id FROM warehouses WHERE code = 'STO-RES-MSK' LIMIT 1`)?.id || '');
const rows = all(
  `SELECT IFNULL(p.sku,'') sku, b.qty
   FROM stock_balances b
   LEFT JOIN products p ON p.id = b.product_id
   WHERE b.warehouse_id = ? AND b.qty > 0
   ORDER BY b.qty DESC`,
  [resId]
);
console.log({
  lines: rows.length,
  qty: rows.reduce((s, r) => s + Number(r.qty), 0),
  qty13: rows.filter((r) => Number(r.qty) === 13),
  mraa: rows.filter((r) => r.sku === 'MRAA01069'),
});

for (const id of ['25745318', '25643945', '25742894']) {
  console.log(id, get(`SELECT id, name, status_name FROM crm_deals WHERE id = ?`, [id]));
}
