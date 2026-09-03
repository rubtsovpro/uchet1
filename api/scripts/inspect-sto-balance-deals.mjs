import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { get, all } = require('../dist/db.js');
const { openDealLinksForStockRows } = require('../dist/deal-stock-flow.js');

const sto = get(`SELECT id, name FROM warehouses WHERE UPPER(IFNULL(code,'')) = 'STO' LIMIT 1`);
console.log('sto', sto);
const bals = all(
  `SELECT product_id, warehouse_id, qty FROM stock_balances WHERE warehouse_id = ? AND qty > 0`,
  [sto.id]
);
const map = openDealLinksForStockRows(bals.map((b) => ({ product_id: b.product_id, warehouse_id: b.warehouse_id })));
for (const b of bals) {
  const key = `${b.product_id}\0${b.warehouse_id}`;
  const deals = map.get(key) || [];
  const p = get(`SELECT sku, name FROM products WHERE id = ?`, [b.product_id]);
  console.log(
    JSON.stringify({
      sku: p?.sku,
      qty: b.qty,
      deals: deals.map((d) => ({
        id: d.deal_id,
        ch: d.amo_channel,
        resp: d.responsible_name,
        name: d.deal_name,
      })),
    })
  );
}
