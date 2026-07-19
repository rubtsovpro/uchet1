#!/bin/bash
# Устойчивая полная выгрузка фото 1С → S3 (пачки, без OOM).
set -uo pipefail
cd /root/1c_pnevmopodveska1_ru/warehouse
mkdir -p logs

LOCK=logs/media-full-sync.lock
exec 9>"$LOCK"
if ! flock -n 9; then
  echo "media-full-sync already running — exit"
  exit 0
fi

set -a
# shellcheck disable=SC1091
source /etc/warehouse-wms.env
set +a

LOG=logs/media-full-sync.log
BATCH="${MEDIA_BATCH:-25}"
MAX_ROUNDS="${MEDIA_MAX_ROUNDS:-800}"
NODE_HEAP="${MEDIA_NODE_HEAP:-1024}"
RESULT=logs/media-round-last.txt

echo "===== LOOP START $(date -Is) pid=$$ batch=$BATCH heap=${NODE_HEAP}m =====" | tee -a "$LOG"

round=0
stall=0
while [ "$round" -lt "$MAX_ROUNDS" ]; do
  # Если идёт синк каталога из UI — ждём (до 15 мин, иначе снимаем протухший lock)
  while [ -f logs/catalog-sync.lock ]; do
    lock_age=$(( $(date +%s) - $(stat -c %Y logs/catalog-sync.lock 2>/dev/null || echo 0) ))
    if [ "$lock_age" -gt 900 ]; then
      echo "catalog-sync.lock старше 15 мин — снимаем" | tee -a "$LOG"
      rm -f logs/catalog-sync.lock
      break
    fi
    echo "ждём окончания синка каталога (${lock_age}с)…" | tee -a "$LOG"
    sleep 5
  done

  round=$((round + 1))
  echo "----- round $round $(date -Is) -----" | tee -a "$LOG"
  set +e
  node --max-old-space-size="$NODE_HEAP" api/dist/sync-cli.js --media-only --media-limit="$BATCH" >"$RESULT" 2>&1
  ec=$?
  set -e
  tee -a "$LOG" <"$RESULT"
  if [ "$ec" -ne 0 ]; then
    echo "round $round exit=$ec — пауза 20с" | tee -a "$LOG"
    sleep 20
    continue
  fi
  # Media sync done { products: N, uploaded: N, ... }
  products=$(sed -n 's/.*products: *\([0-9][0-9]*\).*/\1/p' "$RESULT" | tail -1)
  uploaded=$(sed -n 's/.*uploaded: *\([0-9][0-9]*\).*/\1/p' "$RESULT" | tail -1)
  empty=$(sed -n 's/.*empty: *\([0-9][0-9]*\).*/\1/p' "$RESULT" | tail -1)
  errors=$(sed -n 's/.*errors: *\([0-9][0-9]*\).*/\1/p' "$RESULT" | tail -1)
  products=${products:-0}
  uploaded=${uploaded:-0}
  empty=${empty:-0}
  errors=${errors:-0}
  echo "round $round ok products=$products uploaded=$uploaded empty=$empty errors=$errors" | tee -a "$LOG"
  if [ "$products" -eq 0 ]; then
    echo "Нет товаров без медиа — готово" | tee -a "$LOG"
    break
  fi
  # stall только если нет upload И нет empty (иначе очередь двигается маркерами)
  if [ "$uploaded" -eq 0 ] && [ "$empty" -eq 0 ]; then
    stall=$((stall + 1))
  else
    stall=0
  fi
  if [ "$stall" -ge 40 ]; then
    echo "40 раундов без прогресса — стоп" | tee -a "$LOG"
    break
  fi
  sleep 3
done

node --input-type=module >>"$LOG" 2>&1 <<'JS'
import { get } from './api/dist/db.js';
import { mediaSyncMeta } from './api/dist/media.js';
const m = mediaSyncMeta();
console.log(JSON.stringify({
  at: new Date().toISOString(),
  ...m,
  products: get('SELECT COUNT(*) AS c FROM products')?.c,
  with_img: get("SELECT COUNT(DISTINCT product_id) AS c FROM product_media WHERE kind = 'image'")?.c,
  empty_marked: get("SELECT COUNT(*) AS c FROM product_media WHERE kind = 'empty'")?.c,
}, null, 2));
JS

echo "===== LOOP DONE $(date -Is) =====" | tee -a "$LOG"
