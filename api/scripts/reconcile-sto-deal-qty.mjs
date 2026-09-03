/**
 * СТО: оставить только qty, спущенное по сделке(ам) на этот склад.
 * Лишнее → STO-RES-MSK (Отложено под СТО).
 *
 * Usage: node --experimental-sqlite scripts/reconcile-sto-deal-qty.mjs [--dry-run]
 */
import { get, all } from '../dist/db.js';
import { createDocument } from '../dist/stock.js';
import { ensureWarehouseByCode } from '../dist/supply-chain.js';
import { dealLinkedStockOnWarehouse, openDealLinksForStockRows } from '../dist/deal-stock-flow.js';

const dryRun = process.argv.includes('--dry-run');

const stoId = String(get(`SELECT id FROM warehouses WHERE code = 'STO' LIMIT 1`)?.id || '');
if (!stoId) {
  console.error('STO not found');
  process.exit(1);
}
const resId = ensureWarehouseByCode('STO-RES-MSK', 'Отложено под СТО');

function dealInboundQtyOnSto(productId, dealId) {
  const pid = String(productId || '');
  const did = String(dealId || '');
  if (!pid || !did) return 0;
  const row = get(
    `SELECT IFNULL(SUM(l.qty), 0) AS q
     FROM stock_docs d
     JOIN stock_doc_lines l ON l.doc_id = d.id
     WHERE d.posted = 1
       AND IFNULL(d.deal_id, '') = ?
       AND l.product_id = ?
       AND (
         (d.doc_type = 'transfer' AND d.warehouse_to_id = ?)
         OR (d.doc_type = 'in' AND IFNULL(NULLIF(l.warehouse_id, ''), d.warehouse_id) = ?)
       )`,
    [did, pid, stoId, stoId]
  );
  return Number(row?.q) || 0;
}

function dealOutboundQtyFromSto(productId, dealId) {
  const pid = String(productId || '');
  const did = String(dealId || '');
  if (!pid || !did) return 0;
  const row = get(
    `SELECT IFNULL(SUM(l.qty), 0) AS q
     FROM stock_docs d
     JOIN stock_doc_lines l ON l.doc_id = d.id
     WHERE d.posted = 1
       AND d.doc_type = 'out'
       AND d.warehouse_id = ?
       AND IFNULL(d.deal_id, '') = ?
       AND l.product_id = ?`,
    [stoId, did, pid]
  );
  return Number(row?.q) || 0;
}

function allowedQtyOnSto(productId, dealId) {
  const inbound = dealInboundQtyOnSto(productId, dealId);
  const outbound = dealOutboundQtyFromSto(productId, dealId);
  return Math.max(0, inbound - outbound);
}

const rows = all(
  `SELECT b.product_id, b.qty, IFNULL(p.sku, '') AS sku, IFNULL(p.name, '') AS name,
          IFNULL(p.item_kind, 'product') AS item_kind
   FROM stock_balances b
   LEFT JOIN products p ON p.id = b.product_id
   WHERE b.warehouse_id = ? AND b.qty > 0
     AND IFNULL(p.item_kind, 'product') != 'service'`,
  [stoId]
);

const linkMap = openDealLinksForStockRows(
  rows.map((r) => ({ product_id: r.product_id, warehouse_id: stoId }))
);

const moves = [];
for (const r of rows) {
  const bal = Number(r.qty) || 0;
  const links = linkMap.get(`${r.product_id}\0${stoId}`) || [];
  const dealId = String(links[0]?.deal_id || '').trim();
  let allowed = 0;
  if (dealId) {
    allowed = allowedQtyOnSto(r.product_id, dealId);
  }
  const excess = bal - allowed;
  if (excess <= 0) continue;
  moves.push({
    product_id: r.product_id,
    sku: r.sku,
    name: r.name,
    deal_id: dealId || '—',
    bal,
    allowed,
    excess,
  });
}

console.log('before', {
  lines: rows.length,
  qty: rows.reduce((s, x) => s + Number(x.qty), 0),
  linked: dealLinkedStockOnWarehouse(stoId),
  to_move_lines: moves.length,
  to_move_qty: moves.reduce((s, x) => s + x.excess, 0),
});
console.log('moves', moves);

if (!moves.length) {
  console.log('nothing to do');
  process.exit(0);
}

if (dryRun) {
  console.log('dry-run, skip posting');
  process.exit(0);
}

const docId = createDocument({
  doc_type: 'transfer',
  warehouse_id: stoId,
  warehouse_to_id: resId,
  comment: 'СТО: оставить только qty по спуску со сделкой → лишнее в Отложено',
  lines: moves.map((m) => ({
    product_id: m.product_id,
    qty: m.excess,
    warehouse_id: stoId,
  })),
  post: true,
  ignore_stock: true,
});

const left = get(
  `SELECT COUNT(*) AS c, IFNULL(SUM(qty), 0) AS q
   FROM stock_balances WHERE warehouse_id = ? AND qty > 0`,
  [stoId]
);
console.log('after', {
  docId,
  sto_left: left,
  linked: dealLinkedStockOnWarehouse(stoId),
});
