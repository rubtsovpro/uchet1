#!/usr/bin/env bash
# Заводит GitHub Actions secrets для rubtsovpro/uchet1.
# Запуск с Mac: ./deploy/setup-github-secrets.sh
set -euo pipefail

REPO="${GITHUB_REPO:-rubtsovpro/uchet1}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if ! gh auth status -h github.com >/dev/null 2>&1; then
  echo "Нужен gh auth login (scopes: repo, workflow)"
  exit 1
fi

DEPLOY_HOST="${DEPLOY_HOST:-155.212.160.31}"
DEPLOY_USER="${DEPLOY_USER:-root}"
SSH_KEY_FILE="${DEPLOY_SSH_KEY_FILE:-$HOME/.ssh/id_ed25519_bank}"
if [[ ! -f "$SSH_KEY_FILE" ]]; then
  echo "Нет приватного ключа: задайте DEPLOY_SSH_KEY_FILE=~/.ssh/id_ed25519_bank"
  exit 1
fi

echo "→ DEPLOY_HOST / USER / SSH_KEY ($SSH_KEY_FILE)"
gh secret set DEPLOY_HOST -R "$REPO" --body "$DEPLOY_HOST"
gh secret set DEPLOY_USER -R "$REPO" --body "$DEPLOY_USER"
gh secret set DEPLOY_SSH_KEY -R "$REPO" <"$SSH_KEY_FILE"

# Telegram с VPS env (без печати значений)
if ssh -o BatchMode=yes bank-vps true 2>/dev/null; then
  echo "→ Telegram secrets с bank-vps /etc/warehouse-wms.env"
  eval "$(ssh bank-vps 'python3 - <<"PY"
from pathlib import Path
env={}
for line in Path("/etc/warehouse-wms.env").read_text(errors="replace").splitlines():
    line=line.strip()
    if not line or line.startswith("#") or "=" not in line: continue
    k,v=line.split("=",1)
    env[k]=v.strip().strip("\"'\''")
def esc(s):
    return s.replace("\\","\\\\").replace("\"","\\\"")
for k in ["TELEGRAM_BOT_TOKEN","TELEGRAM_WAREHOUSE_CHAT_ID","TELEGRAM_2FA_CHAT_ID","TELEGRAM_WORKER_URL","TELEGRAM_WORKER_SECRET"]:
    v=env.get(k,"")
    if v:
        print(f"export {k}=\"{esc(v)}\"")
PY')"
  if [[ -n "${TELEGRAM_BOT_TOKEN:-}" ]]; then
    gh secret set TELEGRAM_BOT_TOKEN -R "$REPO" --body "$TELEGRAM_BOT_TOKEN"
  fi
  CHAT="${TELEGRAM_WAREHOUSE_CHAT_ID:-${TELEGRAM_2FA_CHAT_ID:-}}"
  if [[ -n "$CHAT" ]]; then
    gh secret set TELEGRAM_NOTIFY_CHAT_ID -R "$REPO" --body "$CHAT"
  fi
  if [[ -n "${TELEGRAM_WORKER_URL:-}" ]]; then
    gh secret set TELEGRAM_WORKER_URL -R "$REPO" --body "$TELEGRAM_WORKER_URL"
  fi
  if [[ -n "${TELEGRAM_WORKER_SECRET:-}" ]]; then
    gh secret set TELEGRAM_WORKER_SECRET -R "$REPO" --body "$TELEGRAM_WORKER_SECRET"
  fi
else
  echo "bank-vps недоступен — Telegram secrets задайте вручную"
fi

echo "→ текущие secrets:"
gh secret list -R "$REPO"
echo "OK. Дальше: ./deploy/setup-vps-github-deploy-key.sh"
