#!/usr/bin/env bash
# Hourly cron wrapper: MSK nomen meta → WMS (подвеска only, no stock).
set -euo pipefail

ROOT="${WMS_ROOT:-/root/1c_pnevmopodveska1_ru/warehouse}"
PHP_BIN="${PHP_BIN:-php}"
LOG_DIR="${MSK_NOMEN_SYNC_LOG_DIR:-$ROOT/logs}"
LOCK="${MSK_NOMEN_SYNC_LOCK:-/var/lock/sync_msk_nomen_meta_hourly.lock}"
SCRIPT="$ROOT/tools/sync_msk_nomen_meta_hourly.php"

mkdir -p "$LOG_DIR"
mkdir -p "$(dirname "$LOCK")"

if [[ ! -f "$SCRIPT" ]]; then
  echo "$(date -Is) ERR: missing $SCRIPT" >>"$LOG_DIR/msk_nomen_meta_hourly.log"
  exit 1
fi

exec 9>"$LOCK"
if ! flock -n 9; then
  echo "$(date -Is) skip: already running" >>"$LOG_DIR/msk_nomen_meta_hourly.log"
  exit 0
fi

cd "$ROOT"
export GOOGLE_SA_JSON="${GOOGLE_SA_JSON:-/root/bank_pnevmopodveska1_ru/public_html/pnevmopodveska1-677b14845bb0.json}"
export GOOGLE_PHP_AUTOLOAD="${GOOGLE_PHP_AUTOLOAD:-/root/bank_pnevmopodveska1_ru/public_html/vendor/autoload.php}"
export WMS_SQLITE="${WMS_SQLITE:-$ROOT/data/warehouse.sqlite}"
export MSK_NOMEN_SYNC_LOG_DIR="$LOG_DIR"

"$PHP_BIN" "$SCRIPT" --apply >>"$LOG_DIR/msk_nomen_meta_hourly.cron.log" 2>&1
