# WMS · steady-state лимиты (без nginx-заглушек)

После падений 2026-09-14 (sqlite lock / event loop / 502) рабочий режим — **лимиты**, не `return 200` на вебхуках.

## Держать постоянно

| Параметр | Значение | Где |
|----------|----------|-----|
| Amo webhook → Node | вкл | nginx **проксирует**, не stub |
| `AMO_WEBHOOK_SYNC_MAX` | `8` | env / systemd drop-in |
| `/warehouse/pick/handoffs` | `{ light: true }` | `api.ts` |
| `WMS_SYNC_MAX_CONCURRENT` | `1` | env / `steady-limits.conf` |
| `WMS_SYNC_CHILD_TIMEOUT_MS` | `25000` | то же |
| `GDRIVE_PURCHASE_POLL` | `0` | пока CPU стабилен |
| nginx `limit_req` на `/api/webhooks/amo` | 429, не фейковый OK | `deploy/nginx-uchetn1-ssl-mtu.conf` |
| nginx `limit_req` на `/api/warehouse/pick/` | **не ставить** (poll → 503) | то же; кэш `pickcache` OK |

Шаблон drop-in: `deploy/warehouse-wms.service.d/steady-limits.conf`.

## Если снова тяжело (порядок)

1. `AMO_WEBHOOK_SYNC_MAX`: 8 → 5 → 3  
2. concurrent оставить `1`  
3. fogel HS cron реже / временно off  
4. GDrive не включать  
5. Край: record-only webhook на час (**не** nginx stub ingest/amo)

## Запрещено при аварии

- `location = /api/webhooks/amo { return 200 "OK"; }`
- stub `/api/crm/deals/ingest`
- пустой `{ items: [], emergency_light: true }` на handoffs насовсем
- поднимать concurrent «чтобы быстрее догнало» под нагрузкой

## Аварийный restart

Workflow `restore-wms-now` может временно прижать sync; после стабилизации снова поставить **`WMS_SYNC_MAX_CONCURRENT=1`** через `steady-limits.conf`, не оставлять `0`.
