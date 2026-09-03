import { get, all } from '../dist/db.js';
import { dealLinkedStockOnWarehouse, openDealLinksForStockRows } from '../dist/deal-stock-flow.js';

const stoId = String(get(`SELECT id FROM warehouses WHERE code = 'STO' LIMIT 1`)?.id || '');

function dealInboundQtyOnSto(productId, dealId) {
  const row = get(
    `SELECT IFNULL(SUM(l.qty), 0) AS q
     FROM stock_docs d JOIN stock_doc_lines l ON l.doc_id = d.id
     WHERE d.posted = 1 AND IFNULL(d.deal_id,'') = ? AND l.product_id = ?
       AND ((d.doc_type = 'transfer' AND d.warehouse_to_id = ?)
         OR (d.doc_type = 'in' AND IFNULL(NULLIF(l.warehouse_id,''), d.warehouse_id) = ?))`,
    [dealId, productId, stoId, stoId]
  );
  return Number(row?.q) || 0;
}

function dealOutboundQtyFromSto(productId, dealId) {
  const row = get(
    `SELECT IFNULL(SUM(l.qty), 0) AS q
     FROM stock_docs d JOIN stock_doc_lines l ON l.doc_id = d.id
     WHERE d.posted = 1 AND d.doc_type = 'out' AND d.warehouse_id = ?
       AND IFNULL(d.deal_id,'') = ? AND l.product_id = ?`,
    [stoId, dealId, productId]
  );
  return Number(row?.q) || 0;
}

const rows = all(
  `SELECT b.product_id, b.qty, IFNULL(p.sku,'') sku, IFNULL(p.name,'') name
   FROM stock_balances b LEFT JOIN products p ON p.id = b.product_id
   WHERE b.warehouse_id = ? AND b.qty > 0
     AND IFNULL(p.item_kind,'product') != 'service'
   ORDER BY b.qty DESC, p.sku`,
  [stoId]
);

const linkMap = openDealLinksForStockRows(
  rows.map((r) => ({ product_id: r.product_id, warehouse_id: stoId }))
);

const audit = [];
let ok = 0;
let bad = 0;

for (const r of rows) {
  const bal = Number(r.qty) || 0;
  const links = linkMap.get(`${r.product_id}\0${stoId}`) || [];
  const dealId = String(links[0]?.deal_id || '').trim();
  const inbound = dealId ? dealInboundQtyOnSto(r.product_id, dealId) : 0;
  const outbound = dealId ? dealOutboundQtyFromSto(r.product_id, dealId) : 0;
  const allowed = dealId ? Math.max(0, inbound - outbound) : 0;
  const row = {
    sku: r.sku,
    bal,
    deal_id: dealId || '—',
    inbound,
    outbound,
    allowed,
    ok: bal === allowed && !!dealId,
    delta: bal - allowed,
    status: links[0]?.status_name || get(`SELECT status_name FROM crm_deals WHERE id = ?`, [dealId])?.status_name || '',
    channel: links[0]?.amo_channel || '',
  };
  audit.push(row);
  if (row.ok) ok++;
  else bad++;
}

console.log(JSON.stringify({
  metrics: dealLinkedStockOnWarehouse(stoId),
  total_lines: rows.length,
  total_qty: rows.reduce((s, x) => s + Number(x.qty), 0),
  ok_lines: ok,
  bad_lines: bad,
}, null, 2));

console.log('\n--- all lines ---');
for (const a of audit) {
  console.log(a);
}

const byDeal = new Map();
for (const a of audit) {
  const k = a.deal_id;
  if (!byDeal.has(k)) byDeal.set(k, { lines: 0, qty: 0, ok: true, items: [] });
  const g = byDeal.get(k);
  g.lines++;
  g.qty += a.bal;
  if (!a.ok) g.ok = false;
  g.items.push(a);
}
console.log('\n--- by deal ---');
for (const [dealId, g] of [...byDeal.entries()].sort((a, b) => b[1].qty - a[1].qty)) {
  const crm =
    dealId !== '—'
      ? get(`SELECT name, status_name, amo_channel FROM crm_deals WHERE id = ?`, [dealId])
      : null;
  const wo =
    dealId !== '—'
      ? Number(
          get(
            `SELECT COUNT(*) AS c FROM stock_docs
             WHERE deal_id = ? AND posted = 1 AND doc_type = 'out'
               AND IFNULL(comment,'') LIKE '%Списание по продаже%'`,
            [dealId]
          )?.c || 0
        )
      : 0;
  const success = /успеш/i.test(String(crm?.status_name || ''));
  console.log({
    deal_id: dealId,
    name: crm?.name?.slice(0, 60),
    status: crm?.status_name,
    channel: crm?.amo_channel,
    writeoffs: wo,
    success,
    ...g,
    ok: g.ok && !success && wo === 0,
  });
}
