#!/usr/bin/env bash
# Bare: /root/repos/anti1c-warehouse.git
# Push: git push bank-vps HEAD:main  →  checkout + build + restart
set -euo pipefail

APP="/root/1c_pnevmopodveska1_ru/warehouse"
BARE="/root/repos/anti1c-warehouse.git"

build_and_restart() {
  NODE_ENV= npm ci --prefix api
  NODE_ENV= npm install --prefix web
  NODE_ENV= npm run build --prefix api
  NODE_ENV= npm run build --prefix web
  npm prune --omit=dev --prefix api
  systemctl restart warehouse-wms
  sleep 1
  curl -sS -o /dev/null -w "health %{http_code}\n" "http://127.0.0.1:3101/api/health"
}

deploy_main=0
while read -r _oldrev _newrev ref; do
  case "$ref" in
    refs/heads/main|refs/heads/master) deploy_main=1 ;;
  esac
done

if [[ "$deploy_main" -ne 1 ]]; then
  echo "post-receive: не main — деплой пропущен"
  exit 0
fi

echo "→ sync $APP from bare main"
cd "$APP"
# Рабочее дерево — обычный git-clone; подтягиваем коммит из bare, не ломая .env/data
if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  if ! git remote get-url bare >/dev/null 2>&1; then
    git remote add bare "$BARE"
  else
    git remote set-url bare "$BARE"
  fi
  git fetch bare main
  git reset --hard bare/main
else
  git --git-dir="$BARE" --work-tree="$APP" checkout -f main
fi

build_and_restart
echo "OK post-receive deploy on $(hostname) $(git rev-parse --short HEAD 2>/dev/null || true)"
