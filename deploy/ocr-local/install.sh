#!/usr/bin/env bash
# Установка / обновление локального OCR на VPS (тот же хост, что warehouse-wms).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
APP_ROOT="$(cd "$ROOT/../.." && pwd)"
VENV="$ROOT/.venv"
SVC=warehouse-ocr-local

cd "$ROOT"
python3 -m venv "$VENV"
# shellcheck disable=SC1091
source "$VENV/bin/activate"
pip install -U pip wheel
pip install -r requirements.txt
# rapidocr тянет opencv-python (с libGL) — на headless VPS оставляем только headless
pip uninstall -y opencv-python 2>/dev/null || true
pip install --force-reinstall "opencv-python-headless==4.11.0.86"

# права на entrypoints (rsync/umask иногда снимает +x → systemd 203/EXEC)
chmod -R a+rx "$VENV/bin"

install -m 644 "$ROOT/warehouse-ocr-local.service" /etc/systemd/system/${SVC}.service
systemctl daemon-reload
systemctl enable "$SVC"
systemctl restart "$SVC"
sleep 2
curl -sS "http://127.0.0.1:3105/health" || true
echo
# прогрев модели в фоне
curl -sS -X POST "http://127.0.0.1:3105/ocr/warmup" >/dev/null 2>&1 || true
echo "OK $SVC · bind 127.0.0.1:3105"
echo "Добавьте в /etc/warehouse-wms.env: OCR_LOCAL_URL=http://127.0.0.1:3105"
echo "  OCR_MODE=local"
