#!/bin/bash
# Полный перенос номенклатуры и остатков Фогеля из PG-дампа 1С в Учёт №1.
# Перед запуском: восстановить свежий дамп в PostgreSQL (PG_1C_DB).
#
#   export PG_1C_DB=Fogel_2025   # имя БД после restore
#   ./bin/run-fogel-pg-import.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

PG_DB="${PG_1C_DB:-Fogel_2025}"
DUMP="${PG_RESTORE_DUMP:-/var/lib/postgresql/restore/${PG_DB}}"
STAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP="data/warehouse.sqlite.bak-fogel-${STAMP}"

echo "===== Fogel PG import ${STAMP} ====="
echo "PG_1C_DB=${PG_DB}"

if ! sudo -u postgres psql -d "$PG_DB" -c 'SELECT 1' >/dev/null 2>&1; then
  if [[ -f "$DUMP" ]]; then
    echo "Restoring PG from ${DUMP}…"
    PG_1C_DB="$PG_DB" PG_RESTORE_DUMP="$DUMP" ./bin/do-restore-pg.sh
  else
    echo "ERROR: PostgreSQL database '${PG_DB}' not found and dump missing: ${DUMP}"
    exit 1
  fi
fi

if [[ -f data/warehouse.sqlite ]]; then
  cp -a data/warehouse.sqlite "$BACKUP"
  echo "Backup: $BACKUP"
fi

export PG_1C_DB="$PG_DB"
node bin/import-1c-pg.mjs
node bin/import-1c-pg-extra.mjs || true

if [[ -f /etc/warehouse-wms.env ]]; then
  set -a
  # shellcheck disable=SC1091
  source /etc/warehouse-wms.env
  set +a
fi

if [[ -f bin/import-s3-catalog-photos.mjs ]]; then
  echo "Link S3 catalog photos → product_media…"
  node bin/import-s3-catalog-photos.mjs || echo "WARN: S3 photo link skipped"
fi

systemctl restart warehouse-wms
sleep 2
systemctl is-active warehouse-wms

echo "Sync amo1c picker catalog…"
php /root/amo1c_pnevmopodveska1_ru/public_html/bin/sync_amo1c_products_from_wms.php --department=fogel_2025

echo "Audit widget vs WMS (90 days)…"
php scripts/audit_widget_vs_wms_products.php --days=90 | tail -30

echo "===== Fogel import done ====="
