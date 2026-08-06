# Учёт №1 (WMS)

Склад и продажи для Пневмоподвески: синк с 1С / Amo, документы (счёт, УПД, заказ-наряд), медиа в S3.

Стек: **Hono + SQLite** (`api/`), **React + Vite + TanStack Query** + legacy UI (`web/`).

Локальный корень проекта: `/Users/a_/Downloads/php/uchetn1` (раньше: `new_serv/1c_pnevmopodveska1_ru/warehouse`). На сервере путь прежний: `/root/1c_pnevmopodveska1_ru/warehouse`.

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

- Поддомен: `https://swagger.uchetn1.ru` (алиас `api-docs.uchetn1.ru`) → `/api/swagger`
- Spec: `/api/openapi.json`
- Вкл.: `SWAGGER_ENABLED=1` в env
- Доступ: тот же логин WMS, только `admin` / системный admin (иначе 403; без сессии → `/login?next=`)
- Опционально: `SWAGGER_BASIC_USER` + `SWAGGER_BASIC_PASS`
- Try-it-out только для GET
- DNS: A `swagger` (и при желании `api-docs`) → `155.212.160.31`, затем certbot --expand — см. `deploy/DNS-uchetn1.md`

Классический UI: `/` и `/legacy.html` → redirect. React: `/money/*`, часть CRM/sales/org.

## Bank / СБП

Платежи СБП и overview Точки пока идут через `bank.pnevmopodveska1.ru` (`BANK_SBP_*`, `BANK_TOCHKA_*`). Перенос под `1c.*` — этап B плана split.
