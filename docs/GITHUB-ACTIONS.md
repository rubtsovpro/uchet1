# GitHub Actions · Учёт №1 (`rubtsovpro/uchet1`)

## Поток

1. **Push в `main`** → workflow **CI** (npm ci + build api/web).
2. CI упал → Telegram ❌.
3. CI OK → workflow **Deploy prod** (SSH на tech35 → `git fetch` → build → `warehouse-wms` → health).
4. Deploy OK/FAIL → Telegram ✅/❌.

Локально по-прежнему можно: `git push origin main` (CI+deploy) и/или `git push bank-vps HEAD:main` (post-receive без GitHub Actions).

## Secrets (Settings → Secrets and variables → Actions)

| Secret | Назначение |
|--------|------------|
| `DEPLOY_HOST` | `tech35.fvds.ru` или `155.212.160.31` |
| `DEPLOY_USER` | `root` |
| `DEPLOY_SSH_KEY` | Приватный ключ с доступом на VPS (например `~/.ssh/github_actions`) |
| `TELEGRAM_BOT_TOKEN` | Тот же бот, что в `/etc/warehouse-wms.env` |
| `TELEGRAM_NOTIFY_CHAT_ID` | Куда слать алерты (обычно `TELEGRAM_WAREHOUSE_CHAT_ID` или 2FA chat) |
| `TELEGRAM_WORKER_URL` | Cloudflare worker gateway (опционально, для РФ) |
| `TELEGRAM_WORKER_SECRET` | Secret worker (опционально) |

Завести скриптом (нужен `gh` + auth):

```bash
./deploy/setup-github-secrets.sh
```

## VPS: pull с GitHub

На сервере `origin` должен ходить по **SSH deploy key** (read-only), иначе Actions `git fetch origin` падает:

```text
/root/.ssh/uchet1_github_ro   # private
GitHub → repo Settings → Deploy keys → public key (read-only)
origin = git@github.com:rubtsovpro/uchet1.git
```

Скрипт: `./deploy/setup-vps-github-deploy-key.sh` (запускать с машины с `ssh bank-vps`).

## Проверка

```bash
gh workflow list -R rubtsovpro/uchet1
gh run list -R rubtsovpro/uchet1 -L 5
gh secret list -R rubtsovpro/uchet1
```
