# Учёт №1 (WMS)

Склад и продажи для Пневмоподвески: синк с 1С / Amo, документы (счёт, УПД, заказ-наряд), медиа в S3.

Стек: **Hono + SQLite** (`api/`), **React + Vite + TanStack Query** + legacy UI (`web/`).

## Структура

```
api/          backend: Hono, SQLite, интеграции → dist/
web/          frontend: React + legacy static → dist/
data/         SQLite (WMS_DATA_DIR), вне пакетов
docs/         ТЗ и стек
deploy/       systemd, apache, deploy.sh
```

Фронт ходит в бэкенд **только через `/api`**. На переходный период Node из `api` раздаёт статику из `web/dist`.

## Локально

```bash
npm ci
cp .env.example .env
npm run build          # api + web
npm start              # api на :3101, отдаёт web/dist
```

Раздельные билды:

```bash
npm run build:api
npm run build:web
```

Dev: `npm run dev:api` (:3101) и `npm run dev:web` (:5173, proxy `/api` → :3101).

## Деплой

```bash
./deploy/deploy.sh --rsync   # без требования чистого git
# или ./deploy/deploy.sh     # push + pull на сервере
```

Прод: `1c.pnevmopodveska1.ru`. Секреты только в `/etc/warehouse-wms.env`.

### Swagger / OpenAPI

- UI: `/api/swagger` (не `/api/docs` — там складские документы)
- Spec: `/api/openapi.json`
- Вкл.: `SWAGGER_ENABLED=1` в env
- Доступ: сессия роли `admin` / системный admin, либо `SWAGGER_BASIC_USER` + `SWAGGER_BASIC_PASS`
- Try-it-out только для GET

Классический UI: `/` и `/legacy.html` → redirect. React: `/money/*`, часть CRM/sales/org.

## Bank / СБП

Платежи СБП и overview Точки пока идут через `bank.pnevmopodveska1.ru` (`BANK_SBP_*`, `BANK_TOCHKA_*`). Перенос под `1c.*` — этап B плана split.
