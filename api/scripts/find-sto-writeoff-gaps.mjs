import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { get, all } = require('../dist/db.js');
const { dealIsSuccessful, writeOffStoOnDealSuccess } = require('../dist/deal-stock-flow.js');

const sto = get(`SELECT id FROM warehouses WHERE UPPER(IFNULL(code,'')) = 'STO' LIMIT 1`).id;

const deals = all(
  `SELECT DISTINCT d.deal_id AS id
   FROM stock_docs d
   LEFT JOIN warehouses wf ON wf.id = d.warehouse_id
   WHERE IFNULL(d.posted,0)=1 AND d.doc_type='transfer' AND d.warehouse_to_id=?
     AND IFNULL(d.deal_id,'') != ''
     AND (IFNULL(d.comment,'') LIKE '%Спуск на СТО%' OR UPPER(IFNULL(wf.code,'')) LIKE 'STO-RES-%')`,
  [sto]
);

const need = [];
for (const row of deals) {
  const id = String(row.id);
  const desc = all(
    `SELECT l.product_id AS pid, IFNULL(SUM(l.qty),0) AS q
     FROM stock_docs d
     JOIN stock_doc_lines l ON l.doc_id=d.id
     LEFT JOIN warehouses wf ON wf.id=d.warehouse_id
     WHERE d.deal_id=? AND d.posted=1 AND d.doc_type='transfer' AND d.warehouse_to_id=?
       AND (IFNULL(d.comment,'') LIKE '%Спуск на СТО%' OR UPPER(IFNULL(wf.code,'')) LIKE 'STO-RES-%')
     GROUP BY l.product_id`,
    [id, sto]
  );
  const wo = all(
    `SELECT l.product_id AS pid, IFNULL(SUM(l.qty),0) AS q
     FROM stock_docs d JOIN stock_doc_lines l ON l.doc_id=d.id
     WHERE d.deal_id=? AND d.posted=1 AND d.doc_type='out'
       AND IFNULL(d.comment,'') LIKE '%Списание по продаже%'
     GROUP BY l.product_id`,
    [id]
  );
  const woMap = new Map(wo.map((x) => [x.pid, Number(x.q) || 0]));
  let pending = 0;
  const lines = [];
  for (const r of desc) {
    const left = Math.max(0, (Number(r.q) || 0) - (woMap.get(r.pid) || 0));
    const onSto =
      Number(
        get(`SELECT IFNULL(qty,0) AS qty FROM stock_balances WHERE warehouse_id=? AND product_id=?`, [
          sto,
          r.pid,
        ])?.qty
      ) || 0;
    const can = Math.min(left, onSto);
    if (can > 0) {
      pending += can;
      lines.push({ pid: r.pid, can, left, onSto });
    }
  }
  if (pending > 0) {
    need.push({ id, success: dealIsSuccessful(id), pending, lines });
  }
}

console.log('deals needing writeoff leftover', need.length);
for (const n of need) console.log(JSON.stringify(n));

const dry = process.argv.includes('--apply');
if (dry) {
  for (const n of need.filter((x) => x.success)) {
    const r = writeOffStoOnDealSuccess(n.id, {
      createdBy: 'досписание спущенного batch',
      requireSuccess: true,
    });
    console.log('applied', n.id, r);
  }
}
