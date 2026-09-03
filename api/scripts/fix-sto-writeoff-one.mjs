/**
 * One-shot: досписать со СТО всё спущенное по сделке.
 * Usage: node --experimental-sqlite scripts/fix-sto-writeoff-one.mjs 25667915
 */
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

const { get, all } = require('../dist/db.js');
const { writeOffStoOnDealSuccess, dealIsSuccessful } = require('../dist/deal-stock-flow.js');

const id = String(process.argv[2] || '').trim();
if (!id) {
  console.error('usage: fix-sto-writeoff-one.mjs <dealId>');
  process.exit(1);
}

const sto = String(
  get(`SELECT id FROM warehouses WHERE UPPER(IFNULL(code,'')) = 'STO' LIMIT 1`)?.id || ''
);

const before = all(
  `SELECT IFNULL(p.sku,'') AS sku, IFNULL(p.name,'') AS name, b.qty
   FROM stock_balances b
   JOIN products p ON p.id = b.product_id
   WHERE b.warehouse_id = ? AND b.qty > 0
     AND b.product_id IN (SELECT product_guid FROM crm_deal_items WHERE deal_id = ?)`,
  [sto, id]
);
console.log('deal', id, 'success', dealIsSuccessful(id), 'sto_before', before);

const r = writeOffStoOnDealSuccess(id, {
  createdBy: 'досписание спущенного',
  requireSuccess: true,
});
console.log('result', r);

const after = all(
  `SELECT IFNULL(p.sku,'') AS sku, IFNULL(p.name,'') AS name, b.qty
   FROM stock_balances b
   JOIN products p ON p.id = b.product_id
   WHERE b.warehouse_id = ? AND b.qty > 0
     AND b.product_id IN (SELECT product_guid FROM crm_deal_items WHERE deal_id = ?)`,
  [sto, id]
);
console.log('sto_after', after);
