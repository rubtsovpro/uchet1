#!/usr/bin/env bash
# Деплой Учёт №1 (WMS) на bank-vps через GitHub.
# Репозиторий: https://github.com/rubtsovpro/uchet1
#
# Локально:  ./deploy/deploy.sh
# На сервере: ./deploy/deploy.sh --local
set -euo pipefail

REMOTE_HOST="${WMS_DEPLOY_HOST:-bank-vps}"
REMOTE_APP="/root/1c_pnevmopodveska1_ru/warehouse"
GITHUB_REPO="${WMS_GITHUB_REPO:-https://github.com/rubtsovpro/uchet1.git}"
BRANCH="${WMS_DEPLOY_BRANCH:-main}"

if [[ "${1:-}" == "--local" ]]; then
  cd "$REMOTE_APP"
  if ! git remote get-url origin >/dev/null 2>&1; then
    git remote add origin "$GITHUB_REPO"
  else
    git remote set-url origin "$GITHUB_REPO"
  fi
  git fetch origin
  git reset --hard "origin/${BRANCH}"
  npm ci
  npm run build
  npm prune --omit=dev
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

# origin = GitHub
if ! git remote get-url origin >/dev/null 2>&1; then
  git remote add origin "$GITHUB_REPO"
else
  git remote set-url origin "$GITHUB_REPO"
fi

echo "→ push origin/${BRANCH} ($GITHUB_REPO)"
git push -u origin "HEAD:${BRANCH}"

echo "→ pull + build on $REMOTE_HOST"
ssh "$REMOTE_HOST" bash -s <<EOF
set -euo pipefail
cd '$REMOTE_APP'
git remote set-url origin '$GITHUB_REPO' 2>/dev/null || git remote add origin '$GITHUB_REPO'
git fetch origin
git reset --hard origin/${BRANCH}
npm ci
npm run build
npm prune --omit=dev
systemctl restart warehouse-wms
sleep 1
curl -sS -o /dev/null -w 'health %{http_code}\n' http://127.0.0.1:3101/api/health
echo OK \$(git rev-parse --short HEAD)
EOF
