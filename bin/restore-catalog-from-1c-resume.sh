#!/usr/bin/env bash
# Продолжение restore после отката sqlite (шаги 5–9).
set -euo pipefail

WMS_ROOT="${WMS_ROOT:-/root/1c_pnevmopodveska1_ru/warehouse}"
DATA="${WMS_ROOT}/data"
DB="${DATA}/warehouse.sqlite"
AMO_ROOT="${AMO_ROOT:-/root/amo1c_pnevmopodveska1_ru/public_html}"
LOG="${LOG:-/tmp/restore-catalog-from-1c-resume-$(date +%Y%m%d-%H%M%S).log}"

exec > >(tee -a "$LOG") 2>&1
echo "=== restore-catalog-from-1c-resume $(date -Is) ==="

HS_BASE_URL=$(grep -m1 '^HS_BASE_URL=' /etc/warehouse-wms.env | cut -d= -f2-)
HS_USER=$(grep -m1 '^HS_USER=' /etc/warehouse-wms.env | cut -d= -f2-)
HS_PASS=$(grep -m1 '^HS_PASS=' /etc/warehouse-wms.env | cut -d= -f2-)
export HS_BASE_URL HS_USER HS_PASS

echo "5) HS sync Подвеска"
cd "${WMS_ROOT}/api"
node --experimental-sqlite dist/sync-cli.js --hs-only

echo "6) Fogel HS full import"
php "${WMS_ROOT}/bin/import-fogel-hs-full.php"

echo "7) amo1c: очистка picker_catalog"
php -r "
require '${AMO_ROOT}/Classes/DbHelper.php';
require '${AMO_ROOT}/includes/picker_catalog.php';
\$db = DbHelper::getInstance();
picker_catalog_ensure_table(\$db);
foreach (['pnevmopodveska_2025','fogel_2025'] as \$d) {
  \$db->prepare(\"DELETE FROM picker_catalog WHERE department = ? AND kind = 'product'\")->execute([\$d]);
  echo \"picker_catalog cleared: \$d\\n\";
}
"

echo "8) amo1c: sync products from WMS"
php "${AMO_ROOT}/bin/sync_amo1c_products_from_wms.php" --department=pnevmopodveska_2025
php "${AMO_ROOT}/bin/sync_amo1c_products_from_wms.php" --department=fogel_2025

echo "9) Stats"
node -e "
const {DatabaseSync}=require('node:sqlite');
const db=new DatabaseSync('${DB}',{readonly:true});
const q=(s)=>db.prepare(s).get();
console.log({
  products: q('SELECT COUNT(*) c FROM products').c,
  categories: q('SELECT COUNT(*) c FROM categories').c,
  warehouses: q('SELECT COUNT(*) c FROM warehouses').c,
  stock: q('SELECT COUNT(*) c FROM stock_balances WHERE ABS(qty)>0.0001').c,
  hs_synced_at: db.prepare(\"SELECT value FROM meta WHERE key='hs_synced_at'\").get()?.value,
});
"

echo "=== DONE $(date -Is) ==="
