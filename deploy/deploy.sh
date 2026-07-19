#!/usr/bin/env bash
# Деплой Учёт №1 (WMS) на bank-vps.
# Локально:  ./deploy/deploy.sh
# На сервере: ./deploy/deploy.sh --local
# Hotfix без git: ./deploy/deploy.sh --rsync
set -euo pipefail

REMOTE_HOST="${WMS_DEPLOY_HOST:-bank-vps}"
REMOTE_APP="/root/1c_pnevmopodveska1_ru/warehouse"
BRANCH="${WMS_DEPLOY_BRANCH:-main}"

build_and_restart() {
  npm ci --prefix api
  npm install --prefix web
  npm run build --prefix api
  npm run build --prefix web
  npm prune --omit=dev --prefix api
  systemctl restart warehouse-wms
  sleep 1
  curl -sS -o /dev/null -w "health %{http_code}\n" "http://127.0.0.1:3101/api/health"
}

if [[ "${1:-}" == "--local" ]]; then
  cd "$REMOTE_APP"
  if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    git fetch origin 2>/dev/null || true
    git reset --hard "origin/${BRANCH}" 2>/dev/null || true
  fi
  build_and_restart
  echo "OK deployed on $(hostname)"
  exit 0
fi

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [[ "${1:-}" == "--rsync" ]]; then
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

if git remote get-url origin >/dev/null 2>&1; then
  echo "→ push origin/${BRANCH}"
  git push -u origin "HEAD:${BRANCH}"
else
  echo "Нет git remote origin — деплой через rsync"
  exec "$0" --rsync
fi

echo "→ pull + build on $REMOTE_HOST"
ssh "$REMOTE_HOST" bash -s <<EOF
set -euo pipefail
cd '$REMOTE_APP'
if git rev-parse --is-inside-work-tree >/dev/null 2>&1 && git remote get-url origin >/dev/null 2>&1; then
  git fetch origin
  git reset --hard origin/${BRANCH}
fi
npm ci --prefix api
npm install --prefix web
npm run build --prefix api
npm run build --prefix web
npm prune --omit=dev --prefix api
systemctl restart warehouse-wms
sleep 1
curl -sS -o /dev/null -w 'health %{http_code}\n' http://127.0.0.1:3101/api/health
echo OK \$(git rev-parse --short HEAD 2>/dev/null || echo rsync)
EOF
