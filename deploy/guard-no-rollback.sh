#!/usr/bin/env bash
# Подключать в любом деплое: source deploy/guard-no-rollback.sh
# Выход 1, если на цели висит .protect-prod и не выставлен WMS_UNLOCK_ROLLBACK=YES

wms_refuse_rollback() {
  local app="${1:-/root/1c_pnevmopodveska1_ru/warehouse}"
  if [[ "${WMS_UNLOCK_ROLLBACK:-}" == "YES" ]]; then
    echo "WARN: WMS_UNLOCK_ROLLBACK=YES — защита снята для этого запуска" >&2
    return 0
  fi
  if [[ -f "$app/.protect-prod" ]]; then
    echo "BLOCKED: $app/.protect-prod — откат/reset/clean запрещены." >&2
    echo "Сначала sync git=прод. Аварийный снять: WMS_UNLOCK_ROLLBACK=YES (только осознанно)." >&2
    return 1
  fi
  return 0
}

wms_refuse_git_reset_cmd() {
  # Вызывать на VPS перед опасными командами
  if [[ "${WMS_UNLOCK_ROLLBACK:-}" == "YES" ]]; then
    return 0
  fi
  if [[ -f .protect-prod ]] || [[ -f /root/1c_pnevmopodveska1_ru/warehouse/.protect-prod ]]; then
    echo "BLOCKED: git reset/clean на warehouse под .protect-prod" >&2
    return 1
  fi
  return 0
}
