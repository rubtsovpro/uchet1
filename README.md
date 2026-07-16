# Анти1С — склад WMS (`1c.pnevmopodveska1.ru`)

TypeScript + Hono + SQLite. Синк каталога/документов из 1С, персонал и сделки из Amo (amo1c).

## Локально

```bash
npm ci
cp .env.example .env   # заполнить
npm run build
npm start
```

## Git и деплой

Репозиторий отдельный (не общий `/Downloads/php`).

**Origin на VPS (bare):** `bank-vps:/root/repos/anti1c-warehouse.git`  
**Рабочая копия на проде:** `/root/1c_pnevmopodveska1_ru/warehouse`

```bash
# первый раз (уже сделано скриптом):
# git remote add origin bank-vps:/root/repos/anti1c-warehouse.git

git add -A && git commit -m "..."
./deploy/deploy.sh
```

Секреты только в `/etc/warehouse-wms.env` на сервере — не в git.

## Полезные кнопки UI

- Синк справочников / HS / документы 1С
- Сделки Amo, персонал
- Ориентация фото
