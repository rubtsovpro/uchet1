import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { get, all } = require('../dist/db.js');

const sto = get(`SELECT id, name, code FROM warehouses WHERE UPPER(IFNULL(code,'')) = 'STO' LIMIT 1`);
console.log('sto', sto);

const bal = all(
  `SELECT b.product_id, IFNULL(p.sku,'') AS sku, IFNULL(p.name,'') AS name, b.qty
   FROM stock_balances b
   LEFT JOIN products p ON p.id = b.product_id
   WHERE b.warehouse_id = ? AND b.qty > 0
   ORDER BY b.qty DESC
   LIMIT 50`,
  [sto.id]
);
console.log('sto_balances', bal.length);
for (const r of bal) console.log(JSON.stringify(r));

const d = String(process.argv[2] || '25667915');
const docs = all(
  `SELECT d.number, d.doc_type, d.posted, IFNULL(d.comment,'') AS comment,
     (SELECT IFNULL(SUM(l.qty),0) FROM stock_doc_lines l WHERE l.doc_id=d.id) AS qty
   FROM stock_docs d WHERE d.deal_id=? ORDER BY d.created_at`,
  [d]
);
console.log('docs', d);
for (const x of docs) console.log(JSON.stringify(x));

const desc = all(
  `SELECT l.product_id, IFNULL(p.sku,'') AS sku, SUM(l.qty) AS qty
   FROM stock_docs d
   JOIN stock_doc_lines l ON l.doc_id=d.id
   LEFT JOIN products p ON p.id=l.product_id
   LEFT JOIN warehouses wf ON wf.id=d.warehouse_id
   WHERE d.deal_id=? AND d.posted=1 AND d.doc_type='transfer' AND d.warehouse_to_id=?
     AND (d.comment LIKE '%Спуск на СТО%' OR UPPER(IFNULL(wf.code,'')) LIKE 'STO-RES-%')
   GROUP BY l.product_id`,
  [d, sto.id]
);
console.log('descended', desc);

const wo = all(
  `SELECT l.product_id, IFNULL(p.sku,'') AS sku, SUM(l.qty) AS qty, d.number
   FROM stock_docs d
   JOIN stock_doc_lines l ON l.doc_id=d.id
   LEFT JOIN products p ON p.id=l.product_id
   WHERE d.deal_id=? AND d.posted=1 AND d.doc_type='out' AND d.comment LIKE '%Списание по продаже%'
   GROUP BY l.product_id, d.number`,
  [d]
);
console.log('writeoff', wo);

const items = all(
  `SELECT product_guid, qty, name, sku FROM crm_deal_items WHERE deal_id=?`,
  [d]
);
console.log('items', items);

for (const r of desc) {
  const balQty = get(
    `SELECT IFNULL(qty,0) AS qty FROM stock_balances WHERE warehouse_id=? AND product_id=?`,
    [sto.id, r.product_id]
  )?.qty;
  console.log('sto_now', r.sku, balQty);
}
