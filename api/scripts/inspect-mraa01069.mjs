import { get, all } from '../dist/db.js';

const stoId = String(get(`SELECT id FROM warehouses WHERE code = 'STO' LIMIT 1`)?.id || '');
const p = get(`SELECT id, sku, name FROM products WHERE sku = 'MRAA01069'`);
console.log('product', p);
console.log('bal', get(`SELECT qty FROM stock_balances WHERE product_id=? AND warehouse_id=?`, [p.id, stoId]));
console.log(
  'crm',
  get(
    `SELECT id, name, status_name, IFNULL(amo_channel,'') ch FROM crm_deals WHERE id = '25654217'`
  )
);

const docs = all(
  `SELECT d.id, d.doc_type, d.posted, IFNULL(d.deal_id,'') deal_id, l.qty,
          substr(IFNULL(d.comment,''),1,120) comment, IFNULL(d.created_at,d.doc_date) at,
          IFNULL(wf.code,'') fr, IFNULL(wt.code,'') tto
   FROM stock_docs d
   JOIN stock_doc_lines l ON l.doc_id = d.id
   LEFT JOIN warehouses wf ON wf.id = d.warehouse_id
   LEFT JOIN warehouses wt ON wt.id = d.warehouse_to_id
   WHERE l.product_id = ?
   ORDER BY datetime(IFNULL(d.created_at, d.doc_date)) DESC
   LIMIT 30`,
  [p.id]
);
console.log('docs', docs);

const writeoffs = all(
  `SELECT d.id, d.doc_type, IFNULL(d.deal_id,'') deal_id, l.qty, substr(IFNULL(d.comment,''),1,140) comment,
          IFNULL(d.created_at,d.doc_date) at
   FROM stock_docs d
   JOIN stock_doc_lines l ON l.doc_id = d.id
   WHERE l.product_id = ? AND d.posted = 1 AND d.doc_type = 'out'
   ORDER BY datetime(IFNULL(d.created_at, d.doc_date)) DESC LIMIT 10`,
  [p.id]
);
console.log('outs', writeoffs);

const dealOuts = all(
  `SELECT d.id, d.doc_type, l.product_id, l.qty, substr(IFNULL(d.comment,''),1,140) comment
   FROM stock_docs d
   JOIN stock_doc_lines l ON l.doc_id = d.id
   WHERE d.deal_id = '25654217' AND d.posted = 1
   ORDER BY datetime(IFNULL(d.created_at, d.doc_date))`
);
console.log('deal_docs', dealOuts);
