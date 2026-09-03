/**
 * Переносит остатки на складе СТО без привязки к сделке → Отложено под СТО (STO-RES-MSK).
 * На СТО по правилам учёта могут быть только позиции со сделкой.
 *
 * Usage (на сервере из api/):
 *   node --experimental-sqlite scripts/move-sto-orphans-to-reserve.mjs
 */
import { get, all } from "../dist/db.js";
import { createDocument } from "../dist/stock.js";
import { ensureWarehouseByCode } from "../dist/supply-chain.js";
import {
  dealLinkedStockOnWarehouse,
  openDealLinksForStockRows,
} from "../dist/deal-stock-flow.js";

const stoId = String(get("SELECT id FROM warehouses WHERE code = ? LIMIT 1", ["STO"])?.id || "");
if (!stoId) {
  console.error("STO warehouse not found");
  process.exit(1);
}

const resId = ensureWarehouseByCode("STO-RES-MSK", "Отложено под СТО");
const rows = all(
  `SELECT b.product_id, b.qty, IFNULL(p.sku,'') AS sku
   FROM stock_balances b
   LEFT JOIN products p ON p.id = b.product_id
   WHERE b.warehouse_id = ? AND b.qty > 0
     AND IFNULL(p.item_kind,'product') != 'service'`,
  [stoId]
);

// «Сирота» = нет актуальной открытой сделки в UI (списанные/закрытые не считаются).
const linkMap = openDealLinksForStockRows(
  rows.map((r) => ({ product_id: r.product_id, warehouse_id: stoId }))
);
const orphans = rows.filter((r) => {
  const links = linkMap.get(`${r.product_id}\0${stoId}`) || [];
  return !links.length;
});

const orphanQty = orphans.reduce((s, x) => s + Number(x.qty || 0), 0);
console.log("before", {
  sto_id: stoId,
  res_id: resId,
  orphan_lines: orphans.length,
  orphan_qty: orphanQty,
  linked: dealLinkedStockOnWarehouse(stoId),
});

if (!orphans.length) {
  console.log("nothing to move");
  process.exit(0);
}

const docId = createDocument({
  doc_type: "transfer",
  warehouse_id: stoId,
  warehouse_to_id: resId,
  comment: "Исправление: на СТО без сделки быть не может → Отложено под СТО",
  lines: orphans.map((o) => ({
    product_id: o.product_id,
    qty: Number(o.qty),
    warehouse_id: stoId,
  })),
  post: true,
  ignore_stock: true,
});

const left = get(
  "SELECT COUNT(*) AS c, IFNULL(SUM(qty),0) AS q FROM stock_balances WHERE warehouse_id = ? AND qty > 0",
  [stoId]
);
console.log("after", {
  docId,
  sto_left_lines: left?.c,
  sto_left_qty: left?.q,
  linked: dealLinkedStockOnWarehouse(stoId),
});
