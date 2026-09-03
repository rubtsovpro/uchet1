#!/usr/bin/env bash
# Ставит защиту на tech35: .protect-prod, blocked post-receive, бэкап кода.
# Запуск с Mac: ./deploy/install-prod-guards.sh
# Снять защиту (автодеплой снова): ./deploy/unlock-auto-deploy.sh
set -euo pipefail

REMOTE="${WMS_DEPLOY_HOST:-bank-vps}"
APP="/root/1c_pnevmopodveska1_ru/warehouse"
BARE="/root/repos/anti1c-warehouse.git"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

scp "$ROOT/.protect-prod" "$REMOTE:$APP/.protect-prod"
scp "$ROOT/deploy/guard-no-rollback.sh" "$REMOTE:$APP/deploy/guard-no-rollback.sh"

ssh "$REMOTE" bash -s <<EOF
set -euo pipefail
APP='$APP'
BARE='$BARE'
chmod 644 "\$APP/.protect-prod"
chmod 755 "\$APP/deploy/guard-no-rollback.sh"

# post-receive: только блок
HOOK="\$BARE/hooks/post-receive"
mkdir -p "\$BARE/hooks"
if [[ -f "\$HOOK" ]] && ! grep -q 'ЗАБЛОКИРОВАНО: запрет отката' "\$HOOK" 2>/dev/null; then
  cp -a "\$HOOK" "\$HOOK.bak-\$(date +%Y%m%d%H%M%S)"
fi
cat > "\$HOOK" <<'HOOK'
#!/usr/bin/env bash
echo "post-receive: BLOCKED (no rollback). .protect-prod on warehouse." >&2
exit 0
HOOK
chmod +x "\$HOOK"

# Бэкап кода раз в день (не data/) — чтобы можно было ОТКАТИТЬ ОТКАТ
mkdir -p /root/backups/wms-code
cat > /usr/local/sbin/wms-backup-code.sh <<'BKP'
#!/usr/bin/env bash
set -euo pipefail
APP=/root/1c_pnevmopodveska1_ru/warehouse
DEST=/root/backups/wms-code
stamp=\$(date +%Y%m%d-%H%M%S)
mkdir -p "\$DEST"
tar -C "\$APP" -czf "\$DEST/wms-\$stamp.tgz" \
  --exclude=node_modules \
  --exclude=api/node_modules \
  --exclude=web/node_modules \
  --exclude=data \
  --exclude='.env' \
  --exclude='.env.*' \
  api/src web/public web/dist api/dist deploy package.json \
  .protect-prod 2>/dev/null || true
# хранить ~14 копий
ls -1t "\$DEST"/wms-*.tgz 2>/dev/null | tail -n +15 | xargs -r rm -f
echo "OK backup \$DEST/wms-\$stamp.tgz"
BKP
chmod +x /usr/local/sbin/wms-backup-code.sh
/usr/local/sbin/wms-backup-code.sh

# cron daily 03:15
CRON_LINE='15 3 * * * root /usr/local/sbin/wms-backup-code.sh >/var/log/wms-backup-code.log 2>&1'
if [[ -d /etc/cron.d ]]; then
  echo "\$CRON_LINE" > /etc/cron.d/wms-backup-code
  chmod 644 /etc/cron.d/wms-backup-code
fi

# Подсказка в git config worktree (не блокирует reset, но помечает)
cd "\$APP"
git config --local wms.protectProd true 2>/dev/null || true

echo "OK guards on \$(hostname)"
test -f "\$APP/.protect-prod" && echo "protect: yes"
head -3 "\$HOOK"
ls -1t /root/backups/wms-code/wms-*.tgz 2>/dev/null | head -3
EOF

echo "Guards installed. Deploy Actions must stay blocked until sync."
