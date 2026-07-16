#!/usr/bin/env bash
# Деплой Анти1С WMS на bank-vps через git.
# Локально:  ./deploy/deploy.sh
# На сервере: ./deploy/deploy.sh --local
set -euo pipefail

REMOTE_HOST="${WMS_DEPLOY_HOST:-bank-vps}"
REMOTE_APP="/root/1c_pnevmopodveska1_ru/warehouse"
REMOTE_BARE="/root/repos/anti1c-warehouse.git"
BRANCH="${WMS_DEPLOY_BRANCH:-main}"

if [[ "${1:-}" == "--local" ]]; then
  cd "$REMOTE_APP"
  git fetch origin
  git reset --hard "origin/${BRANCH}"
  npm ci --omit=dev
  npm run build
  systemctl restart warehouse-wms
  sleep 1
  curl -sS -o /dev/null -w "health %{http_code}\n" "http://127.0.0.1:3101/api/health"
  echo "OK deployed $(git rev-parse --short HEAD) on $(hostname)"
  exit 0
fi

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [[ -n "$(git status --porcelain)" ]]; then
  echo "Есть незакоммиченные изменения. Сначала commit, потом deploy."
  git status -sb
  exit 1
fi

git push origin "HEAD:${BRANCH}"
ssh "$REMOTE_HOST" "cd '$REMOTE_APP' && git fetch origin && git reset --hard origin/${BRANCH} && npm ci --omit=dev && npm run build && systemctl restart warehouse-wms && sleep 1 && curl -sS -o /dev/null -w 'health %{http_code}\n' http://127.0.0.1:3101/api/health && echo OK \$(git rev-parse --short HEAD)"
