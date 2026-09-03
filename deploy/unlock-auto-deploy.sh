#!/usr/bin/env bash
# Снять .protect-prod и вернуть автодеплой (Actions + bare post-receive).
# Запуск с Mac после sync main≈прод и явной команды владельца:
#   ./deploy/unlock-auto-deploy.sh
set -euo pipefail

REMOTE="${WMS_DEPLOY_HOST:-bank-vps}"
APP="/root/1c_pnevmopodveska1_ru/warehouse"
BARE="/root/repos/anti1c-warehouse.git"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
HOOK_SRC="$ROOT/deploy/git-hooks/post-receive-deploy.sh"

if [[ ! -f "$HOOK_SRC" ]]; then
  echo "нет $HOOK_SRC" >&2
  exit 1
fi

scp "$HOOK_SRC" "$REMOTE:$BARE/hooks/post-receive"

ssh "$REMOTE" bash -s <<EOF
set -euo pipefail
APP='$APP'
BARE='$BARE'
chmod +x "\$BARE/hooks/post-receive"
rm -f "\$APP/.protect-prod"
cd "\$APP"
git config --local --unset wms.protectProd 2>/dev/null || true
# бэкапы кода оставляем (cron)
echo "OK unlocked on \$(hostname)"
test ! -f "\$APP/.protect-prod" && echo "protect: removed"
head -5 "\$BARE/hooks/post-receive"
git -C "\$APP" rev-parse --short HEAD
EOF

echo "Local: удалите .protect-prod из репо при коммите unlock (если ещё лежит)."
echo "Actions: закоммитьте восстановленный .github/workflows/deploy-prod.yml и push main."
