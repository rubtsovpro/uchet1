#!/usr/bin/env bash
# Полный синк каталога WMS из 1С HS: Подвеска (номенклатура+цены+остатки) + Фогель.
# Останавливает warehouse-wms на время записи в sqlite.
set -euo pipefail

WMS_ROOT="${WMS_ROOT:-/root/1c_pnevmopodveska1_ru/warehouse}"
AMO_ROOT="${AMO_ROOT:-/root/amo1c_pnevmopodveska1_ru/public_html}"
LOG="${LOG:-/tmp/sync-full-catalog-hs-$(date +%Y%m%d-%H%M%S).log}"

exec > >(tee -a "$LOG") 2>&1
echo "=== sync-full-catalog-hs $(date -Is) ==="
echo "LOG=$LOG"

HS_BASE_URL=$(grep -m1 '^HS_BASE_URL=' /etc/warehouse-wms.env | cut -d= -f2-)
HS_USER=$(grep -m1 '^HS_USER=' /etc/warehouse-wms.env | cut -d= -f2-)
HS_PASS=$(grep -m1 '^HS_PASS=' /etc/warehouse-wms.env | cut -d= -f2-)
FOGEL_HS_BASE_URL=$(grep -m1 '^FOGEL_HS_BASE_URL=' /etc/warehouse-wms.env 2>/dev/null | cut -d= -f2- || true)
if [[ -z "${FOGEL_HS_BASE_URL:-}" ]]; then
  FOGEL_HS_BASE_URL='https://bezmat.corp.rarus-cloud.ru/fogel_2025/hs/AmoCRM/'
fi
export HS_BASE_URL HS_USER HS_PASS FOGEL_HS_BASE_URL

echo "1) Stop warehouse-wms"
systemctl stop warehouse-wms

echo "2) HS full sync Подвеска + Фогель"
cd "${WMS_ROOT}/api"
node --experimental-sqlite dist/sync-cli.js --full-catalog-hs

echo "3) Start warehouse-wms"
systemctl start warehouse-wms
sleep 2
systemctl is-active warehouse-wms

echo "4) amo1c sync from WMS"
php "${AMO_ROOT}/bin/sync_amo1c_products_from_wms.php" --department=pnevmopodveska_2025
php "${AMO_ROOT}/bin/sync_amo1c_products_from_wms.php" --department=fogel_2025

echo "4b) cutover: только 1С→WMS, без Google Sheet picker"
php "${AMO_ROOT}/bin/enable_1c_catalog_cutover.php" 2>&1 | tail -20

echo "5) Stats"
node -e "
const {DatabaseSync}=require('node:sqlite');
const db=new DatabaseSync('${WMS_ROOT}/data/warehouse.sqlite',{readonly:true});
const q=(s)=>db.prepare(s).get();
console.log({
  products: q('SELECT COUNT(*) c FROM products').c,
  stock_nonzero: q('SELECT COUNT(*) c FROM stock_balances WHERE ABS(qty)>0.0001').c,
  prices: q('SELECT COUNT(*) c FROM product_prices').c,
  hs_synced_at: db.prepare(\"SELECT value FROM meta WHERE key='hs_synced_at'\").get()?.value,
  fogel_hs_synced_at: db.prepare(\"SELECT value FROM meta WHERE key='fogel_hs_synced_at'\").get()?.value,
});
"

echo "=== DONE $(date -Is) ==="
