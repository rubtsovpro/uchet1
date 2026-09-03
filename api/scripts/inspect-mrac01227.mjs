import { get, all } from '../dist/db.js';
import { openDealLinksForStockRows } from '../dist/deal-stock-flow.js';

const stoId = String(get(`SELECT id FROM warehouses WHERE code = 'STO' LIMIT 1`)?.id || '');
const p = get(`SELECT id, sku, name FROM products WHERE sku = 'MRAC01227'`);
console.log('product', p);

const bal = all(
  `SELECT w.code, b.qty FROM stock_balances b JOIN warehouses w ON w.id=b.warehouse_id
   WHERE b.product_id=? AND b.qty>0`,
  [p.id]
);
console.log('balances', bal);

const inSto = all(
  `SELECT d.id, IFNULL(d.deal_id,'') deal_id, l.qty, d.doc_type,
          IFNULL(wf.code,'') fr, IFNULL(wt.code,'') tto,
          substr(IFNULL(d.comment,''),1,100) c, IFNULL(d.created_at,d.doc_date) at
   FROM stock_docs d JOIN stock_doc_lines l ON l.doc_id=d.id
   LEFT JOIN warehouses wf ON wf.id=d.warehouse_id
   LEFT JOIN warehouses wt ON wt.id=d.warehouse_to_id
   WHERE l.product_id=? AND d.posted=1
     AND ((d.doc_type='transfer' AND d.warehouse_to_id=?) OR (d.doc_type='in' AND IFNULL(NULLIF(l.warehouse_id,''), d.warehouse_id)=?))
   ORDER BY datetime(IFNULL(d.created_at,d.doc_date))`,
  [p.id, stoId, stoId]
);
console.log('inbounds to STO', inSto);
console.log('inbound qty sum', inSto.reduce((s, r) => s + Number(r.qty), 0));

const outs = all(
  `SELECT IFNULL(d.deal_id,'') deal_id, l.qty, substr(IFNULL(d.comment,''),1,100) c, IFNULL(d.created_at,d.doc_date) at
   FROM stock_docs d JOIN stock_doc_lines l ON l.doc_id=d.id
   WHERE l.product_id=? AND d.posted=1 AND d.doc_type='out' AND d.warehouse_id=?
   ORDER BY datetime(IFNULL(d.created_at,d.doc_date))`,
  [p.id, stoId]
);
console.log('outs from STO', outs);

const link = openDealLinksForStockRows([{ product_id: p.id, warehouse_id: stoId }]);
console.log('UI deal link', link.get(`${p.id}\0${stoId}`));
