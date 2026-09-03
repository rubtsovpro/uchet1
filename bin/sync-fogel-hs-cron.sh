#!/usr/bin/env bash
# Инкрементальный синк Фогеля из 1С HS → WMS (остатки, цены, свойства).
# Подвеска не трогаем: склад и виджет работают в Учёте №1.
#
# ВАЖНО: warehouse-wms НЕ останавливаем. SQLite в WAL + busy_timeout —
# синк пишет параллельно с API. Раньше stop каждые 15 мин давал ~5 мин
# «потеряно соединение» на /pick, документах Amo и оплатах.
set -euo pipefail

WMS_ROOT="${WMS_ROOT:-/root/1c_pnevmopodveska1_ru/warehouse}"
AMO_ROOT="${AMO_ROOT:-/root/amo1c_pnevmopodveska1_ru/public_html}"
LOCK="${LOCK:-/var/lock/sync-fogel-hs-cron.lock}"
LOG="${LOG:-/var/log/sync-fogel-hs-cron.log}"
# Только для редкого ручного полного синка ночью: ALLOW_STOP_WMS=1
ALLOW_STOP_WMS="${ALLOW_STOP_WMS:-0}"

exec 9>"$LOCK"
if ! flock -n 9; then
  echo "=== skip $(date -Is) — already running ===" >>"$LOG"
  exit 0
fi

exec >>"$LOG" 2>&1

echo "=== sync-fogel-hs-cron $(date -Is) stop_wms=${ALLOW_STOP_WMS} ==="

wms_was_active=0
if systemctl is-active --quiet warehouse-wms 2>/dev/null; then
  wms_was_active=1
fi

restart_wms() {
  if [[ "$wms_was_active" != "1" ]]; then
    return 0
  fi
  if systemctl start warehouse-wms 2>/dev/null; then
    sleep 2
    systemctl is-active warehouse-wms || echo "WARN: warehouse-wms failed to start" >&2
  fi
}

HS_BASE_URL=$(grep -m1 '^HS_BASE_URL=' /etc/warehouse-wms.env | cut -d= -f2-)
HS_USER=$(grep -m1 '^HS_USER=' /etc/warehouse-wms.env | cut -d= -f2-)
HS_PASS=$(grep -m1 '^HS_PASS=' /etc/warehouse-wms.env | cut -d= -f2-)
FOGEL_HS_BASE_URL=$(grep -m1 '^FOGEL_HS_BASE_URL=' /etc/warehouse-wms.env 2>/dev/null | cut -d= -f2- || true)
if [[ -z "${FOGEL_HS_BASE_URL:-}" ]]; then
  FOGEL_HS_BASE_URL='https://bezmat.corp.rarus-cloud.ru/fogel_2025/hs/AmoCRM/'
fi
export HS_BASE_URL HS_USER HS_PASS FOGEL_HS_BASE_URL

if [[ "$ALLOW_STOP_WMS" == "1" ]]; then
  echo "1) Stop warehouse-wms (ALLOW_STOP_WMS=1)"
  trap restart_wms EXIT
  systemctl stop warehouse-wms
else
  echo "1) Keep warehouse-wms running (live sync)"
  if [[ "$wms_was_active" != "1" ]]; then
    echo "WARN: warehouse-wms не активен — поднимаем перед синком"
    restart_wms
  fi
fi

echo "2) Fogel HS sync"
cd "${WMS_ROOT}/api"
node --experimental-sqlite dist/sync-cli.js --fogel-hs-only

if [[ "$ALLOW_STOP_WMS" == "1" ]]; then
  echo "3) Start warehouse-wms"
  restart_wms
  trap - EXIT
else
  echo "3) warehouse-wms left running"
fi

echo "4) amo1c picker cache (fogel_2025 only)"
php "${AMO_ROOT}/bin/sync_amo1c_products_from_wms.php" --department=fogel_2025

echo "=== DONE $(date -Is) ==="
