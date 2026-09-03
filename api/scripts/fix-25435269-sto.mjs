import { get } from '../dist/db.js';
import { createDocument } from '../dist/stock.js';
import { resolvePickSiteForDeal, reserveWarehouseForPickSite } from '../dist/handoff-reserve.js';
import { stoWarehouseId } from '../dist/supply-chain.js';
import { notifyAmoWarehousePacked } from '../dist/amo-pick-handoff.js';

const dealId = '25435269';
const site = resolvePickSiteForDeal(dealId);
const reserveWh = reserveWarehouseForPickSite(site).id;
const stoWh = stoWarehouseId();
const pid = get(
  `SELECT product_guid AS id FROM crm_deal_items
   WHERE deal_id = ? AND IFNULL(product_guid,'') != '' LIMIT 1`,
  [dealId]
)?.id;
const onSto =
  Number(
    get('SELECT qty FROM stock_balances WHERE warehouse_id = ? AND product_id = ?', [
      stoWh,
      pid,
    ])?.qty
  ) || 0;
if (onSto >= 1) {
  console.log('already on STO', onSto);
  process.exit(0);
}
const docId = createDocument({
  doc_type: 'transfer',
  warehouse_id: reserveWh,
  warehouse_to_id: stoWh,
  deal_id: dealId,
  comment: `Восстановление на СТО · Резерв → СТО · сделка ${dealId}`,
  lines: [{ product_id: pid, qty: 1, warehouse_id: reserveWh }],
  post: true,
  ignore_stock: true,
  serials_optional: true,
});
const num = get('SELECT number FROM stock_docs WHERE id = ?', [docId])?.number;
void notifyAmoWarehousePacked({ dealId, text: `Склад: Резерв → СТО · ${num}` }).catch(() => {});
console.log('restored', num);
