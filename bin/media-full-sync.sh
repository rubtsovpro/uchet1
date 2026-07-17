#!/bin/bash
# Устойчивая полная выгрузка фото 1С → S3 (пачки, без OOM).
set -uo pipefail
cd /root/1c_pnevmopodveska1_ru/warehouse
mkdir -p logs
set -a
# shellcheck disable=SC1091
source /etc/warehouse-wms.env
set +a

LOG=logs/media-full-sync.log
BATCH="${MEDIA_BATCH:-80}"
MAX_ROUNDS="${MEDIA_MAX_ROUNDS:-500}"

echo "===== LOOP START $(date -Is) pid=$$ batch=$BATCH =====" | tee -a "$LOG"

round=0
stall=0
while [ "$round" -lt "$MAX_ROUNDS" ]; do
  round=$((round + 1))
  echo "----- round $round $(date -Is) -----" | tee -a "$LOG"
  # лимит heap Node — на VPS 1.8ГБ иначе OOM-killer
  set +e
  OUT=$(node --max-old-space-size=384 dist/sync-cli.js --media-only --media-limit="$BATCH" 2>&1)
  ec=$?
  set -e
  echo "$OUT" | tee -a "$LOG"
  if [ "$ec" -ne 0 ]; then
    echo "round $round exit=$ec — пауза 15с" | tee -a "$LOG"
    sleep 15
    continue
  fi
  uploaded=$(echo "$OUT" | sed -n 's/.*uploaded[: ]*\([0-9][0-9]*\).*/\1/p' | tail -1)
  products=$(echo "$OUT" | sed -n 's/.*"products":\([0-9][0-9]*\).*/\1/p' | tail -1)
  # fallback parse from "Media sync done { ... }"
  if [ -z "${uploaded:-}" ]; then
    uploaded=$(echo "$OUT" | tr ',' '\n' | sed -n 's/.*uploaded: *\([0-9]*\).*/\1/p' | tail -1)
  fi
  if [ -z "${products:-}" ]; then
    products=$(echo "$OUT" | tr ',' '\n' | sed -n 's/.*products: *\([0-9]*\).*/\1/p' | tail -1)
  fi
  uploaded=${uploaded:-0}
  products=${products:-0}
  echo "round $round parsed products=$products uploaded=$uploaded" | tee -a "$LOG"
  if [ "$products" -eq 0 ]; then
    echo "Нет товаров без медиа — готово" | tee -a "$LOG"
    break
  fi
  if [ "$uploaded" -eq 0 ]; then
    stall=$((stall + 1))
  else
    stall=0
  fi
  # много раундов только empty — тоже прогресс (маркеры empty), не стоп сразу
  if [ "$stall" -ge 50 ] && [ "$uploaded" -eq 0 ]; then
    echo "50 раундов без upload — стоп" | tee -a "$LOG"
    break
  fi
  sleep 2
done

node --input-type=module >>"$LOG" 2>&1 <<'JS'
import { get } from './dist/db.js';
import { mediaSyncMeta } from './dist/media.js';
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
