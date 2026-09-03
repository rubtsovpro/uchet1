import { get, all } from '../dist/db.js';
import { listCourierRuns } from '../dist/sto-parts-flow.js';
import { courierDeliveryRouteLabel } from '../dist/sto-parts-courier.js';

const dealId = '25317409';

console.log('crm', get(`SELECT * FROM crm_deals WHERE id = ?`, [dealId]));

const runs = all(`SELECT * FROM courier_runs WHERE deal_id = ? OR IFNULL(comment,'') LIKE ? ORDER BY created_at DESC`, [
  dealId,
  `%${dealId}%`,
]);
console.log('courier_runs raw', runs);

const listed = listCourierRuns({ scope: 'all', q: dealId, limit: 20 });
console.log('listCourierRuns', JSON.stringify(listed.items, null, 2));

console.log('route label', courierDeliveryRouteLabel(dealId));

const doc = runs[0]?.stock_doc_id
  ? get(
      `SELECT d.id, d.number, d.doc_type, d.posted, IFNULL(d.comment,'') comment,
              IFNULL(wf.code,'') fr, IFNULL(wt.code,'') tto
       FROM stock_docs d
       LEFT JOIN warehouses wf ON wf.id=d.warehouse_id
       LEFT JOIN warehouses wt ON wt.id=d.warehouse_to_id
       WHERE d.id = ?`,
      [runs[0].stock_doc_id]
    )
  : null;
console.log('stock doc', doc);

const bals = all(
  `SELECT w.code, p.sku, b.qty
   FROM stock_balances b
   JOIN warehouses w ON w.id=b.warehouse_id
   JOIN products p ON p.id=b.product_id
   WHERE b.qty > 0 AND w.code IN ('COURIER','STO','STO-RES-MSK','НФ-000032')
     AND b.product_id IN (
       SELECT DISTINCT l.product_id FROM stock_doc_lines l
       JOIN stock_docs d ON d.id=l.doc_id
       WHERE d.deal_id = ? OR IFNULL(d.comment,'') LIKE ?
     )`,
  [dealId, `%${dealId}%`]
);
console.log('balances', bals);

const task = runs[0]?.warehouse_task_id
  ? get(`SELECT id, number, status, comment FROM warehouse_tasks WHERE id = ?`, [runs[0].warehouse_task_id])
  : null;
console.log('warehouse_task', task);

const req = runs[0]?.sto_request_id
  ? get(`SELECT id, number, deal_id, status, comment FROM sto_transfer_requests WHERE id = ?`, [
      runs[0].sto_request_id,
    ])
  : null;
console.log('sto_request', req);
