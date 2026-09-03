/** Audit 9 deals: Amo success + STO balances. Run on bank-vps. */
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { get, all } = require('../dist/db.js');
const { dealIsSuccessful } = require('../dist/deal-stock-flow.js');
const { syncDealsFromAmo1c } = require('../dist/deals.js');

const IDS = [
  '25721742', '25716112', '25721372', '25720798', '25654217',
  '25435269', '25704711', '25707659', '25703837',
];

const stoWh = get(`SELECT id, name, code FROM warehouses WHERE UPPER(IFNULL(code,'')) = 'STO' LIMIT 1`);

for (const id of IDS) {
  try {
    syncDealsFromAmo1c({ dealId: id, limit: 1 });
  } catch {
    /* */
  }
}

const rows = [];
for (const id of IDS) {
  const d = get(
    `SELECT status_id, status_name, amo_channel FROM crm_deals WHERE id = ?`,
    [id]
  );
  const success = dealIsSuccessful(id);
  const wo = get(
    `SELECT number FROM stock_docs WHERE deal_id = ? AND doc_type = 'out'
     AND posted = 1 AND comment LIKE '%Списание по продаже%' LIMIT 1`,
    [id]
  );
  const items = all(
    `SELECT i.product_guid, i.qty, i.sku, i.name FROM crm_deal_items i
     LEFT JOIN products p ON p.id = i.product_guid
     WHERE i.deal_id = ? AND IFNULL(p.item_kind,'product') != 'service'`,
    [id]
  );
  let onSto = 0;
  const stoLines = [];
  for (const it of items) {
    const pid = String(it.product_guid || '').trim();
    if (!pid) continue;
    const bal =
      get(`SELECT IFNULL(qty,0) AS qty FROM stock_balances WHERE warehouse_id = ? AND product_id = ?`, [
        stoWh.id,
        pid,
      ])?.qty ?? 0;
    const q = Number(bal) || 0;
    if (q > 0) {
      onSto += q;
      stoLines.push({ sku: it.sku, qty: q, need: it.qty });
    }
  }
  rows.push({
    id,
    channel: d?.amo_channel || '',
    status: d?.status_name || d?.status_id || '',
    success,
    writeoff: wo?.number || null,
    deal_qty: items.reduce((s, x) => s + (Number(x.qty) || 0), 0),
    on_sto: onSto,
    sto_lines: stoLines,
  });
}

const notSuccess = rows.filter((r) => !r.success);
const withSto = rows.filter((r) => r.on_sto > 0);
const successWithSto = rows.filter((r) => r.success && r.on_sto > 0);
const notSuccessWithSto = rows.filter((r) => !r.success && r.on_sto > 0);

const stoCard = get(
  `SELECT COUNT(*) AS lines, IFNULL(SUM(b.qty),0) AS qty
   FROM stock_balances b
   WHERE b.warehouse_id = ? AND b.qty > 0`,
  [stoWh.id]
);

console.log(
  JSON.stringify(
    {
      sto_warehouse: stoWh,
      sto_card: { positions: Number(stoCard?.lines || 0), qty_sum: Number(stoCard?.qty || 0) },
      not_success_count: notSuccess.length,
      not_success_ids: notSuccess.map((r) => r.id),
      with_sto_count: withSto.length,
      success_with_sto: successWithSto.map((r) => r.id),
      not_success_with_sto: notSuccessWithSto.map((r) => r.id),
      deals: rows,
    },
    null,
    2
  )
);
