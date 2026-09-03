import { get, all } from '../dist/db.js';
import { openDealLinksForStockRows, dealLinkedStockOnWarehouse } from '../dist/deal-stock-flow.js';

const stoId = String(get(`SELECT id FROM warehouses WHERE code = 'STO' LIMIT 1`)?.id || '');
const bals = all(
  `SELECT b.product_id, b.warehouse_id, b.qty, IFNULL(p.sku,'') sku, IFNULL(p.name,'') name
   FROM stock_balances b
   LEFT JOIN products p ON p.id = b.product_id
   WHERE b.warehouse_id = ? AND b.qty > 0
   ORDER BY b.qty DESC`,
  [stoId]
);

const map = openDealLinksForStockRows(
  bals.map((r) => ({ product_id: r.product_id, warehouse_id: r.warehouse_id }))
);
const byDeal = new Map();
for (const r of bals) {
  const links = map.get(`${r.product_id}\0${r.warehouse_id}`) || [];
  const dealId = links[0]?.deal_id || '(нет)';
  if (!byDeal.has(dealId)) byDeal.set(dealId, { qty: 0, lines: 0, meta: links[0] || null });
  const b = byDeal.get(dealId);
  b.qty += Number(r.qty);
  b.lines += 1;
}

console.log('STO linked metrics:', dealLinkedStockOnWarehouse(stoId));
console.log('STO balance:', {
  lines: bals.length,
  qty: bals.reduce((s, x) => s + Number(x.qty), 0),
});

const dealIds = [...byDeal.keys()].filter((x) => x !== '(нет)');
const deals = dealIds.length
  ? all(
      `SELECT id, name, status_name, IFNULL(amo_channel,'') amo_channel
       FROM crm_deals WHERE id IN (${dealIds.map(() => '?').join(',')})`,
      dealIds
    )
  : [];
const dealMap = new Map(deals.map((d) => [String(d.id), d]));

for (const [dealId, info] of [...byDeal.entries()].sort((a, b) => b[1].qty - a[1].qty)) {
  const d = dealMap.get(dealId);
  console.log({
    deal_id: dealId,
    lines: info.lines,
    qty: info.qty,
    status: d?.status_name || info.meta?.status_name || '?',
    channel: d?.amo_channel || info.meta?.amo_channel || '',
    name: (d?.name || info.meta?.deal_name || '').slice(0, 70),
  });
}

const success = deals.filter((d) => /успеш/i.test(String(d.status_name || '')));
console.log(
  '\nУспешные на СТО:',
  success.length,
  success.map((d) => ({ id: d.id, status: d.status_name, name: d.name }))
);

for (const d of success) {
  const wo = all(
    `SELECT id, doc_type, substr(IFNULL(comment,''),1,120) comment, IFNULL(created_at,doc_date) at
     FROM stock_docs WHERE deal_id = ? AND posted = 1 AND doc_type = 'out'
     ORDER BY datetime(IFNULL(created_at, doc_date)) DESC LIMIT 5`,
    [d.id]
  );
  console.log('writeoffs', d.id, wo);
}

for (const id of dealIds) {
  const wo = get(
    `SELECT COUNT(*) AS c FROM stock_docs
     WHERE deal_id = ? AND posted = 1 AND doc_type = 'out'
       AND IFNULL(comment,'') LIKE '%Списание по продаже%'`,
    [id]
  );
  console.log('detail', id, {
    writeoffs: wo?.c,
    crm: get(`SELECT status_name, amo_status_id FROM crm_deals WHERE id = ?`, [id]),
  });
}
