import { DatabaseSync } from 'node:sqlite';

const db = new DatabaseSync('/root/1c_pnevmopodveska1_ru/warehouse/data/warehouse.sqlite');
const ids = [
  '25721742', '25716112', '25721372', '25720798', '25654217',
  '25435269', '25704711', '25707659', '25703837',
];

const dealStmt = db.prepare(
  `SELECT amo_channel, status_name, status_id FROM crm_deals WHERE id = ?`
);
const docsStmt = db.prepare(
  `SELECT number, doc_type, IFNULL(posted,0) AS posted, comment, created_at
   FROM stock_docs WHERE deal_id = ? AND doc_type IN ('transfer','out')
   ORDER BY datetime(created_at) ASC`
);
const saleWoStmt = db.prepare(
  `SELECT number FROM stock_docs
   WHERE deal_id = ? AND doc_type = 'out' AND IFNULL(posted,0) = 1
     AND comment LIKE '%Списание по продаже%' LIMIT 1`
);
const stoBalStmt = db.prepare(
  `SELECT COUNT(*) AS c FROM stock_balances b
   INNER JOIN warehouses w ON w.id = b.warehouse_id AND UPPER(IFNULL(w.code,'')) = 'STO'
   WHERE b.qty > 0 AND b.product_id IN (SELECT product_guid FROM crm_deal_items WHERE deal_id = ?)`
);
const reserveBalStmt = db.prepare(
  `SELECT COUNT(*) AS c FROM stock_balances b
   INNER JOIN warehouses w ON w.id = b.warehouse_id
     AND (UPPER(IFNULL(w.code,'')) LIKE 'STO-RES%' OR IFNULL(w.name,'') LIKE '%Резерв СТО%')
   WHERE b.qty > 0 AND b.product_id IN (SELECT product_guid FROM crm_deal_items WHERE deal_id = ?)`
);

function stepLabel(comment) {
  const c = String(comment || '');
  if (/Списание по продаже/i.test(c)) return 'sale_writeoff';
  if (/Спуск на СТО/i.test(c) && Number(0) === 0) {
    if (/Склад ГОТОВО|transfer/i.test(c)) return 'reserve_to_sto_done';
  }
  if (/Спуск на СТО/i.test(c)) return 'reserve_to_sto_task';
  if (/Передача на склад/i.test(c) && /Склад ГОТОВО|→/i.test(c)) return 'main_to_reserve_done';
  if (/Передача на склад/i.test(c)) return 'main_to_reserve_draft';
  if (c.includes('→') && /резерв|СТО/i.test(c)) return 'transfer';
  return 'other';
}

for (const id of ids) {
  const deal = dealStmt.get(id);
  const docs = docsStmt.all(id);
  const saleWo = saleWoStmt.get(id);
  const onSto = stoBalStmt.get(id)?.c ?? 0;
  const onReserve = reserveBalStmt.get(id)?.c ?? 0;
  const openDraft = docs.find(
    (d) => /Передача на склад/i.test(d.comment) && !d.posted && d.doc_type === 'out'
  );
  const openToSto = docs.find(
    (d) => /Спуск на СТО/i.test(d.comment) && !d.posted && d.doc_type === 'out'
  );
  const transfers = docs.filter((d) => d.doc_type === 'transfer' && d.posted);

  console.log(JSON.stringify({
    id,
    channel: deal?.amo_channel || null,
    status: deal?.status_name || null,
    on_reserve_skus: onReserve,
    on_sto_skus: onSto,
    sale_writeoff: saleWo?.number || null,
    open_main_to_reserve: openDraft && !/Спуск/i.test(openDraft.comment) ? openDraft.number : null,
    open_reserve_to_sto: openToSto?.number || null,
    transfers: transfers.map((t) => ({
      number: t.number,
      hint: stepLabel(t.comment),
      comment: String(t.comment || '').slice(0, 120),
    })),
    all_docs: docs.map((d) => ({
      number: d.number,
      type: d.doc_type,
      posted: d.posted,
      hint: stepLabel(d.comment),
    })),
  }));
}
