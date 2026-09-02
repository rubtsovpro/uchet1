#!/usr/bin/env bash
# Деплой Учёт №1 (WMS) на bank-vps.
# Локально:  ./deploy/deploy.sh
# На сервере: ./deploy/deploy.sh --local-build  (без git reset)
# Forward-only: ./deploy/deploy.sh --rsync
# Откат запрещён при .protect-prod — см. deploy/guard-no-rollback.sh
set -euo pipefail

REMOTE_HOST="${WMS_DEPLOY_HOST:-bank-vps}"
REMOTE_APP="/root/1c_pnevmopodveska1_ru/warehouse"
BRANCH="${WMS_DEPLOY_BRANCH:-main}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/guard-no-rollback.sh"

build_and_restart() {
  # На VPS часто NODE_ENV=production — иначе npm ci режет typescript (devDependency)
  NODE_ENV= npm ci --prefix api
  NODE_ENV= npm install --prefix web
  NODE_ENV= npm run build --prefix api
  NODE_ENV= npm run build --prefix web
  # Vite publicDir → dist; крупные/долгие файлы иногда не попадают — дублируем явно
  if [[ -d web/public && -d web/dist ]]; then
    rsync -a --exclude 'assets/' web/public/ web/dist/
  fi
  npm prune --omit=dev --prefix api
  systemctl restart warehouse-wms
  # локальный OCR: python -m uvicorn + chmod bin (иначе systemd 203/EXEC)
  if [[ -d deploy/ocr-local/.venv ]]; then
    OCR_DIR="$(pwd)/deploy/ocr-local"
    chmod -R a+rx "$OCR_DIR/.venv/bin" 2>/dev/null || true
    if [[ -f "$OCR_DIR/warehouse-ocr-local.service" ]]; then
      install -m 644 "$OCR_DIR/warehouse-ocr-local.service" /etc/systemd/system/warehouse-ocr-local.service
      systemctl daemon-reload
    fi
    systemctl enable warehouse-ocr-local 2>/dev/null || true
    systemctl restart warehouse-ocr-local || true
  elif systemctl list-unit-files warehouse-ocr-local.service &>/dev/null; then
    systemctl restart warehouse-ocr-local || true
  fi
  sleep 1
  curl -sS -o /dev/null -w "health %{http_code}\n" "http://127.0.0.1:3101/api/health"
  curl -sS -o /dev/null -w "ocr %{http_code}\n" "http://127.0.0.1:3105/health" 2>/dev/null || echo "ocr (not installed)"
}

if [[ "${1:-}" == "--local" ]]; then
  echo "BLOCKED: ./deploy/deploy.sh --local больше не делает git reset --hard (запрет отката)."
  echo "Сборка/рестарт без отката: WMS_ALLOW_BUILD_ONLY=1 $0 --local-build"
  if [[ "${WMS_ALLOW_BUILD_ONLY:-}" == "1" && "${2:-}" == "--local-build" ]] || [[ "${1:-}" == "--local-build" ]]; then
    cd "$REMOTE_APP"
    build_and_restart
    echo "OK build-only on $(hostname) (no git reset)"
    exit 0
  fi
  exit 1
fi

if [[ "${1:-}" == "--local-build" ]]; then
  cd "$REMOTE_APP"
  build_and_restart
  echo "OK build-only on $(hostname) (no git reset)"
  exit 0
fi

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [[ "${1:-}" == "--rsync" ]]; then
  if ! ssh "$REMOTE_HOST" "test ! -f '$REMOTE_APP/.protect-prod' || [[ \"\${WMS_UNLOCK_ROLLBACK:-}\" == YES ]]"; then
    if [[ "${WMS_UNLOCK_ROLLBACK:-}" != "YES" ]]; then
      # rsync С локалки Вперёд на прод — это не откат; разрешаем, но без --delete если protect
      echo "→ rsync forward-only (без --delete): на проде .protect-prod"
      rsync -az \
        --exclude node_modules \
        --exclude 'api/node_modules' \
        --exclude 'web/node_modules' \
        --exclude data \
        --exclude '.env' \
        --exclude '.env.*' \
        --exclude '.git' \
        --exclude 'deploy/ocr-local/.venv' \
        --exclude 'deploy/ocr-local/**/.venv' \
        ./ "$REMOTE_HOST:$REMOTE_APP/"
      ssh "$REMOTE_HOST" bash -s <<EOF
set -euo pipefail
cd '$REMOTE_APP'
$(declare -f build_and_restart)
build_and_restart
echo OK rsync-forward on \$(hostname)
EOF
      exit 0
    fi
  fi
  echo "→ rsync api/ web/ deploy/ package.json → $REMOTE_HOST:$REMOTE_APP"
  # /public = только корневой архив (не web/public — оттуда vite копирует статику в dist)
  rsync -az --delete \
    --exclude node_modules \
    --exclude dist \
    --exclude data \
    --exclude '.env' \
    --exclude '.git' \
    --exclude 'web/node_modules' \
    --exclude 'api/node_modules' \
    --exclude 'api/dist' \
    --exclude 'web/dist' \
    --exclude '/public/' \
    --exclude 'deploy/ocr-local/.venv' \
    --exclude 'deploy/ocr-local/**/.venv' \
    ./ "$REMOTE_HOST:$REMOTE_APP/"
  ssh "$REMOTE_HOST" bash -s <<EOF
set -euo pipefail
cd '$REMOTE_APP'
$(declare -f build_and_restart)
build_and_restart
echo OK rsync on \$(hostname)
EOF
  exit 0
fi

if [[ -n "$(git status --porcelain 2>/dev/null || true)" ]]; then
  echo "Есть незакоммиченные изменения. Commit, или используйте: ./deploy/deploy.sh --rsync"
  git status -sb 2>/dev/null || true
  exit 1
fi

# Чистый git: push в GitHub (+ Actions) и/или в bare на VPS (post-receive → прод)
pushed=0
if git remote get-url origin >/dev/null 2>&1; then
  echo "→ push origin/${BRANCH}"
  git push -u origin "HEAD:${BRANCH}"
  pushed=1
fi
if git remote get-url bank-vps >/dev/null 2>&1; then
  echo "→ push bank-vps/${BRANCH} (post-receive автодеплой)"
  git push bank-vps "HEAD:${BRANCH}"
  pushed=1
  echo "OK: деплой на VPS через post-receive"
  exit 0
fi
if [[ "$pushed" -eq 0 ]]; then
  echo "Нет remote origin/bank-vps — деплой через rsync"
  exec "$0" --rsync
fi

# Fallback: origin есть, bank-vps нет — НЕ reset на сервере (запрет отката)
echo "BLOCKED: автоматический pull+reset на VPS отключён."
echo "Сначала sync git = прод, либо явный безопасный деплой."
exit 1

