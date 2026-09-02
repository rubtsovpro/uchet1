#!/usr/bin/env bash
# На VPS: read-only deploy key → GitHub → origin по SSH (для Actions git fetch).
# Запуск с Mac: ./deploy/setup-vps-github-deploy-key.sh
set -euo pipefail

REPO="${GITHUB_REPO:-rubtsovpro/uchet1}"
REMOTE="${WMS_DEPLOY_HOST:-bank-vps}"
APP="/root/1c_pnevmopodveska1_ru/warehouse"
KEY="/root/.ssh/uchet1_github_ro"

echo "→ ключ на $REMOTE"
PUB=$(ssh "$REMOTE" bash -s <<EOF
set -euo pipefail
mkdir -p /root/.ssh
chmod 700 /root/.ssh
if [[ ! -f $KEY ]]; then
  ssh-keygen -t ed25519 -N '' -f $KEY -C 'uchet1-vps-ro'
fi
chmod 600 $KEY
# ssh config для github.com этим ключом
if ! grep -q 'Host github.com-uchet1' /root/.ssh/config 2>/dev/null; then
  cat >> /root/.ssh/config <<'CFG'

Host github.com-uchet1
  HostName github.com
  User git
  IdentityFile /root/.ssh/uchet1_github_ro
  IdentitiesOnly yes
CFG
fi
chmod 600 /root/.ssh/config 2>/dev/null || true
cat ${KEY}.pub
EOF
)

echo "→ public key (Deploy keys на GitHub):"
echo "$PUB"

TITLE="uchet1-vps-ro-$(date +%Y%m%d)"
# Добавить deploy key, если ещё нет
EXISTING=$(gh api "repos/$REPO/keys" --jq '.[].key' 2>/dev/null || true)
if echo "$EXISTING" | grep -Fq "$(echo "$PUB" | awk '{print $1" "$2}')"; then
  echo "Deploy key уже есть в GitHub"
else
  echo "→ gh api: add deploy key (read-only)"
  gh api "repos/$REPO/keys" -f title="$TITLE" -f key="$PUB" -F read_only=true >/dev/null
  echo "Deploy key добавлен"
fi

echo "→ origin на VPS → git@github.com-uchet1:rubtsovpro/uchet1.git"
ssh "$REMOTE" bash -s <<EOF
set -euo pipefail
cd "$APP"
git remote set-url origin git@github.com-uchet1:rubtsovpro/uchet1.git
ssh -o StrictHostKeyChecking=accept-new -T git@github.com-uchet1 2>&1 | head -5 || true
git fetch origin 2>&1 | head -20
git rev-parse --abbrev-ref HEAD
git log -1 --oneline origin/main 2>/dev/null || git log -1 --oneline
EOF

echo "OK: VPS может git fetch origin"
