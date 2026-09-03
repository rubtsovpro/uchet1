import { get, all } from '../dist/db.js';

const stoId = String(get(`SELECT id FROM warehouses WHERE code = 'STO' LIMIT 1`)?.id || '');
const p = get(`SELECT id FROM products WHERE sku = 'MRAC01227'`);

const allDocs = all(
  `SELECT d.doc_type, d.posted, IFNULL(d.deal_id,'') deal_id, l.qty,
          IFNULL(wf.code,'') fr, IFNULL(wt.code,'') tto,
          substr(IFNULL(d.comment,''),1,110) c, IFNULL(d.created_at,d.doc_date) at
   FROM stock_docs d JOIN stock_doc_lines l ON l.doc_id=d.id
   LEFT JOIN warehouses wf ON wf.id=d.warehouse_id
   LEFT JOIN warehouses wt ON wt.id=d.warehouse_to_id
   WHERE l.product_id=?
   ORDER BY datetime(IFNULL(d.created_at,d.doc_date)) DESC
   LIMIT 40`,
  [p.id]
);
for (const d of allDocs) {
  const touchesSto =
    d.fr === 'STO' ||
    d.tto === 'STO' ||
    (d.doc_type === 'out' && d.fr === 'STO');
  if (touchesSto || d.qty >= 10) console.log(d);
}

// net on STO from all posted docs
let net = 0;
for (const d of all(
  `SELECT d.*, l.qty, IFNULL(wf.code,'') fr, IFNULL(wt.code,'') tto,
          IFNULL(NULLIF(l.warehouse_id,''), d.warehouse_id) line_wh
   FROM stock_docs d JOIN stock_doc_lines l ON l.doc_id=d.id
   LEFT JOIN warehouses wf ON wf.id=d.warehouse_id
   LEFT JOIN warehouses wt ON wt.id=d.warehouse_to_id
   WHERE l.product_id=? AND d.posted=1`,
  [p.id]
)) {
  if (d.doc_type === 'transfer') {
    if (d.warehouse_to_id === stoId) net += Number(d.qty);
    if (d.warehouse_id === stoId) net -= Number(d.qty);
  } else if (d.doc_type === 'in' && d.line_wh === stoId) net += Number(d.qty);
  else if (d.doc_type === 'out' && d.warehouse_id === stoId) net -= Number(d.qty);
}
console.log('computed net STO from docs', net);
