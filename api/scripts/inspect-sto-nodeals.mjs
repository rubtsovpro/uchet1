import { get, all } from '../dist/db.js';
import { openDealLinksForStockRows, dealLinkedStockOnWarehouse } from '../dist/deal-stock-flow.js';

const stoId = String(get(`SELECT id FROM warehouses WHERE code = 'STO' LIMIT 1`)?.id || '');
const bals = all(
  `SELECT b.product_id, b.warehouse_id, b.qty, IFNULL(p.sku,'') AS sku, IFNULL(p.name,'') AS name,
          IFNULL(p.item_kind,'product') AS item_kind
   FROM stock_balances b
   LEFT JOIN products p ON p.id = b.product_id
   WHERE b.warehouse_id = ? AND b.qty > 0
   ORDER BY b.qty DESC`,
  [stoId]
);
const map = openDealLinksForStockRows(
  bals.map((r) => ({ product_id: r.product_id, warehouse_id: r.warehouse_id }))
);
const noDeal = [];
for (const r of bals) {
  const links = map.get(`${r.product_id}\0${r.warehouse_id}`) || [];
  if (links.length) continue;
  noDeal.push(r);
}
console.log({
  total_lines: bals.length,
  total_qty: bals.reduce((s, x) => s + Number(x.qty), 0),
  linked: dealLinkedStockOnWarehouse(stoId),
  no_deal_lines: noDeal.length,
  no_deal_qty: noDeal.reduce((s, x) => s + Number(x.qty), 0),
});
for (const r of noDeal) {
  const docs = all(
    `SELECT d.doc_type, IFNULL(d.deal_id,'') AS deal_id, IFNULL(d.comment,'') AS comment,
            IFNULL(d.created_at,d.doc_date) AS at, IFNULL(wf.code,'') AS from_code,
            IFNULL(wt.code,'') AS to_code, l.qty
     FROM stock_docs d
     JOIN stock_doc_lines l ON l.doc_id = d.id
     LEFT JOIN warehouses wf ON wf.id = d.warehouse_id
     LEFT JOIN warehouses wt ON wt.id = d.warehouse_to_id
     WHERE d.posted = 1 AND l.product_id = ?
       AND (
         (d.doc_type = 'transfer' AND d.warehouse_to_id = ?)
         OR (d.doc_type = 'in' AND IFNULL(NULLIF(l.warehouse_id,''), d.warehouse_id) = ?)
       )
     ORDER BY datetime(IFNULL(d.created_at, d.doc_date)) DESC
     LIMIT 4`,
    [r.product_id, stoId, stoId]
  );
  console.log('---', { sku: r.sku, name: r.name.slice(0, 60), qty: r.qty, kind: r.item_kind });
  console.log(docs);
}
