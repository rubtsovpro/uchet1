# Учёт №1 · API номенклатуры для внешнего сведения (merge MRAER)

**Дата:** 24.08.2026  
**Для:** Миша / скрипты / интеграции  
**Prod:** `https://1c.pnevmopodveska1.ru/api` · зеркало `https://uchetn1.ru/api`

WMS **ничего не меняет сам** — все операции сведения, архива, merge и загрузки остатков запускаются **снаружи** через API (ключ + `dry_run`).

Общая спека интеграции: [API-WMS-INTEGRATION.md](./API-WMS-INTEGRATION.md)  
Живая OpenAPI: `/api/openapi.json` · Swagger: `/api/swagger`

---

## 1. Аутентификация и права

```http
X-Wms-Key: wms_xxxxxxxxxxxxxxxx
Content-Type: application/json
```

| Scope | Что даёт |
|-------|----------|
| `nomen` | `/products`, `/categories`, `/prices`, кроссы, merge |
| `balances` | `/balances`, `/stock/valuation` |
| `warehouses` | `/docs`, складские документы |
| `storage` | `/warehouse/cells/*` |
| `all` | всё перечисленное |

Изменяющие методы (merge, bulk, archive, PUT codes) требуют права **`can_edit_products`** (роль с доступом к номенклатуре) **или** scope `all`.

Пагинация списков: `page` (с 1), `limit` (default 50, **max 500**). На `/api/products` и `/api/balances` запрос с `limit>500` → HTTP 400.

---

## 2. Две обособленные базы номенклатуры

В одном WMS лежат **две независимые выгрузки из 1С**, они **не смешиваются**:

| Контур | `source_department` | HS / 1С | Город |
|--------|---------------------|---------|-------|
| **Пневмоподвеска · Москва** | `pnevmopodveska_2025` | `…/pnevmopodveska_2025/hs/AmoCRM/` | Москва |
| **Фогель · Краснодар** | `fogel_2025` | `…/fogel_2025/hs/AmoCRM/` | Краснодар |

У каждой карточки в WMS:

- `source_department` — к какой базе относится  
- `catalog_guid` — GUID номенклатуры в 1С этой базы  
- `id` в WMS — **свой UUID**, у Подвески и Фогеля **разные**, даже если название похоже  

### Жёсткие правила для Миши

1. **Merge только внутри одного `source_department`.**  
   Нельзя сливать картоchку Фогеля в мастер Подвески (и наоборот).
2. **Сведение MRAER (1 242 эталона)** — отдельный план **по каждому контуру**.
3. Синк из 1С (`POST /sync/hs`) для Подвески **не трогает** товары Фогеля и наоборот.
4. Перед массовым merge — **снимок** (`POST /snapshots`) по списку `product_ids` этого контура.
5. Сначала **`dry_run: true`**, потом боевой вызов с тем же телом и **`idempotency_key`**.

Фильтр по контуру в списке (поле есть в карточке, в ответе `GET /products`):

```http
GET /api/products?limit=50&page=1
```

→ в каждом `item` смотреть `source_department`.  
Точечно:

```http
GET /api/products/{id}
```

---

## 3. Рекомендуемый порядок работ (снаружи)

```
1. POST /snapshots  { "label": "до merge podveska", "product_ids": [...] }
2. POST /products/bulk/merge  { "dry_run": true, "operations": [...] }
3. Проверить отчёт (остатки по складам, codes_added, warnings)
4. POST /products/bulk/merge  { "dry_run": false, "idempotency_key": "merge-podveska-2026-08-24-batch-1", ... }
5. GET /products?q=<старый код 1С>  → должен найти мастер
6. GET /stock/valuation  → сверка сумм (после загрузки себестоимости)
```

---

## 4. Merge карточек (главный блок)

### `POST /api/products/{master_id}/merge`

Объединить дубли в **мастер-карточку** одной транзакцией.

**Request:**

```json
{
  "source_ids": ["uuid-дубля-1", "uuid-дубля-2"],
  "keep": {
    "name": "master",
    "category": "master",
    "prices": "master",
    "barcode": "master"
  },
  "move_stock": true,
  "move_reserves": true,
  "move_cells": true,
  "move_suppliers": true,
  "merge_codes_to": "both",
  "archive_sources": true,
  "comment": "свод дублей MRAER, batch 1",
  "dry_run": true
}
```

| Поле | Default | Действие |
|------|---------|----------|
| `move_stock` | `true` | Остатки источников → мастер **по каждому складу** |
| `move_reserves` | `true` | Резервы под сделки Amo переезжают на мастер |
| `move_cells` | `true` | Адресные ячейки (`stock_cell_balances`) → мастер |
| `move_suppliers` | `true` | Связи `supplier_product_apps` → мастер |
| `merge_codes_to` | `both` | `crosses` → `array_sku`; `alt_codes` → таблица кроссов; `both` |
| `archive_sources` | `true` | `is_active = 0`, роль alias |
| `dry_run` | `false` | `true` — только план, **БД не меняется** |

**Response 200 (dry_run и боевой):**

```json
{
  "ok": true,
  "dry_run": true,
  "master_id": "uuid",
  "master_sku": "НФ-000123",
  "sources": [
    {
      "id": "uuid",
      "sku": "НФ-000456",
      "by_warehouse": [
        { "warehouse_id": "…", "warehouse": "ФИЛИАЛ МОСКВА", "qty": 3 }
      ],
      "codes": ["НФ-000456", "A2123201530"]
    }
  ],
  "moved": {
    "qty": 12,
    "by_warehouse": [
      { "warehouse": "ФИЛИАЛ МОСКВА", "qty": 10 },
      { "warehouse": "Склад Брак", "qty": 2 }
    ]
  },
  "codes_added": ["НФ-000456", "A2123201530"],
  "archived": ["uuid-1", "uuid-2"],
  "warnings": []
}
```

**Ошибки (метод проверяет сам):**

| HTTP | Причина |
|------|---------|
| 400 | источник = мастер; карточка не найдена |
| 409 | непроведённые документы по источнику (`details.documents`) |
| 409 | источник в открытых сделках / резервах (`details.deals`) |

**Не трогаем:** проведённые строки прошлых документов (история сохраняется).  
**История закупок мастера:** `GET /products/{id}/purchase-history` учитывает объединённые источники через `product_merge_map`.

---

### `POST /api/products/bulk/merge`

До **500** операций за вызов. Одна ошибка **не роняет** весь батч.

```json
{
  "dry_run": true,
  "idempotency_key": "merge-batch-001",
  "operations": [
    {
      "master_id": "uuid-master",
      "source_ids": ["uuid-a", "uuid-b"],
      "comment": "группа 42"
    }
  ]
}
```

**Response:**

```json
{
  "ok": true,
  "dry_run": true,
  "results": [ { "ok": true, "master_id": "…", "moved": { … } } ]
}
```

Повтор с тем же `idempotency_key` → **тот же ответ**, без повторного merge.

---

## 5. Кроссы / альтернативные номера

### `GET /api/products/{id}/codes`

```json
{
  "product_id": "uuid",
  "codes": [
    { "type": "1c", "value": "НФ-00027236", "note": "код 1С объединённой карточки" },
    { "type": "oem", "value": "A2123201530" },
    { "type": "supplier", "value": "TYDL4231L", "supplier": "T" },
    { "type": "barcode", "value": "4607123456789" }
  ]
}
```

Типы: `1c` · `oem` · `supplier` · `old_mraer` · `barcode` · `gtin` · `sku` · `other`.

### `PUT /api/products/{id}/codes`

```json
{
  "replace": false,
  "codes": [
    { "type": "1c", "value": "НФ-00027236", "note": "из 1С" }
  ]
}
```

`replace: true` — удалить старые кроссы, записать новый список.

### `DELETE /api/products/{id}/codes?value=…&type=1c`

Удалить один кросс или все (`без value`).

**Поиск** (`GET /products?q=`) ищет также:

- `array_sku` (старые кроссы в поле карточки)  
- таблицу `product_alt_codes`  
- `code`, `sku`, `barcode`, `warehouse_sku`

---

## 6. Массовые операции и идемпотентность

### `POST /api/products/bulk/archive`

```json
{
  "ids": ["uuid-1", "uuid-2"],
  "idempotency_key": "archive-batch-001"
}
```

→ `{ "ok": true, "archived": 2, "results": […] }`

### `PATCH /api/products/bulk`

```json
{
  "ids": ["uuid-1", "uuid-2"],
  "patch": { "name": "…", "category_id": "uuid", "brand": "MRAER" },
  "idempotency_key": "patch-names-001"
}
```

Допустимые поля в `patch`:  
`name`, `sku`, `code`, `brand`, `category_id`, `barcode`, `gtin`, `array_sku`, `is_active`.

### `POST /api/products/catalog/normalize-sku-clones`

Разовая чистка артикулов с хвостом `:c42d9996` → нормальный sku + запись старого в кроссы.

```json
{ "dry_run": true, "limit": 5000 }
```

---

## 7. Снимок и откат

### `POST /api/snapshots`

```json
{
  "label": "перед merge podveska 24.08",
  "product_ids": ["uuid-1", "uuid-2"]
}
```

Без `product_ids` — снимок **всей** номенклатуры (осторожно, большой JSON).

Сохраняет: карточки, `stock_balances`, `product_prices`, `product_alt_codes`.

### `GET /api/snapshots/{id}`

Метаданные + `payload`.

### `POST /api/snapshots/{id}/restore`

```json
{
  "dry_run": true,
  "restore_stock": true,
  "restore_prices": true
}
```

`dry_run: true` — только план. Боевой restore перезаписывает поля карточек и (опционально) остатки/цены из снимка.

---

## 8. Карточка товара · CRUD

| Метод | Путь | Назначение |
|-------|------|------------|
| GET | `/products` | Список + поиск |
| GET | `/products/facet-counts` | Счётчики фильтров |
| GET | `/products/{id}` | Полная карточка |
| POST | `/products` | Создать |
| PATCH | `/products/{id}` | Изменить |
| POST | `/products/{id}/archive` | В архив |
| DELETE | `/products/{id}` | Запрещено, если есть связи → 405 |

### Новые query у `GET /products`

| Параметр | Описание |
|----------|----------|
| `code=` | Точный код 1С / sku / кросс |
| `ids=` | UUID через запятую (до 500) |
| `updated_since=` | ISO дата, `created_at >=` |
| `include=prices` / `with_prices=1` | цены из `product_prices` (+ `price_min`/`price_max` по ним) |
| `company_id=` | UUID контура; неизвестный → **400** |
| `limit` | max **500**, иначе **400** |

### `GET /api/companies`

Список контуров (`id` / `name` / `code`) для `company_id`. Scope: `nomen` или `all`.

### `POST /products` · защита от дублей

**409** при совпадении `sku` или `code` — **без** автоматического хвоста `:uuid`:

```json
{
  "error": "Код 1С уже существует",
  "existing_id": "uuid",
  "sku": "НФ-000123",
  "code": "НФ-000123"
}
```

**Upsert** (обновить вместо создания):

```http
POST /api/products?on_conflict=update&match_by=code
```

`match_by`: `code` | `sku`.

### Подресурсы карточки

| Метод | Путь |
|-------|------|
| PUT | `/products/{id}/prices` |
| PUT | `/products/{id}/properties` |
| PUT | `/products/{id}/applicability` |
| GET | `/products/{id}/inbound-layers` |
| GET | `/products/{id}/purchase-history` |
| GET | `/products/{id}/cost` |
| GET/PUT | `/products/{id}/service-links` |
| GET | `/products/{id}/units` |
| GET/PATCH | `/products/{id}/marking` |

### `GET /api/products/{id}/cost`

Себестоимость единицы (FIFO по приходам):

```json
{
  "product_id": "uuid",
  "method": "fifo_inbound",
  "qty": 5,
  "unit_cost": 8200,
  "total_value": 41000,
  "last_price": 8500,
  "merged_sources": ["uuid-source-1"]
}
```

---

## 9. Цены

| Метод | Путь |
|-------|------|
| GET | `/prices/matrix?limit=&page=` |
| PUT | `/products/{id}/prices` |
| POST | `/sync/prices` | синк розницы из HS (по контуру) |

`GET /prices/matrix` — матрица типов цен; используйте `page` + `limit` (max 500 на страницу).

---

## 10. Остатки и складские документы

| Метод | Путь | Назначение |
|-------|------|------------|
| GET | `/balances` | Остатки по складам |
| GET | `/stock/valuation` | Оценка склада FIFO |
| GET | `/stock/low` | Низкий остаток |
| GET | `/docs` | Журнал документов |
| GET | `/docs/{id}` | Карточка документа |
| POST | `/docs` | Создать документ |

### Начальные остатки с ценой (себестоимость)

Приход с ценой в строках → FIFO-слои для valuation:

```json
POST /api/docs
{
  "doc_type": "in",
  "warehouse_id": "uuid-склада",
  "comment": "opening balance 24.08.2026",
  "lines": [
    { "product_id": "uuid", "qty": 10, "price": 8500 }
  ],
  "post": true
}
```

После проведения: `GET /stock/valuation`, `GET /products/{id}/cost`.

---

## 11. Адресное хранение · scope `storage`

| Метод | Путь |
|-------|------|
| GET | `/warehouse/cells/meta` |
| GET | `/warehouse/cells/map` |
| GET | `/warehouse/cells/balances?q=&warehouse_id=` |
| GET | `/warehouse/cells/{code}` |
| POST | `/warehouse/cells/import` |
| POST | `/warehouse/cells/import-cache` |

При **merge** с `move_cells: true` остатки в ячейках переписываются на мастер (sku мастера).

Query `warehouse_id` — UUID склада WMS.

---

## 12. Поставщики и партии

| Метод | Путь |
|-------|------|
| GET | `/product-units?product_id=` | экземпляры / DM |
| GET | `/product-units/sources?product_id=` | партии для строки заказа |
| GET | `/product-units/trace/{code}` | история по DM |

Связь «товар ↔ поставщик»: таблица `supplier_product_apps`.  
При merge с `move_suppliers: true` связи источников копируются на мастер (`INSERT OR IGNORE`).

---

## 13. Журнал изменений

```http
GET /api/audit?entity=product&entity_id={uuid}&page=1&limit=50
```

События merge: `action: product.merge`, `product.codes.set`, `product.create`, …

---

## 14. Синк номенклатуры из 1С (HS)

| Метод | Контур |
|-------|--------|
| `POST /sync/hs` | Подвеска (`pnevmopodveska_2025`) |
| CLI / отдельный вызов | Фогель (`fogel_2025`) — через `sync-cli --fogel-hs-only` на сервере |

**Не использовать** для сведения дублей — только актуализация из 1С.  
После включения **409 вместо клонов** повторный залив не должен плодить `:uuid` в sku.

---

## 15. Справочно: nomen-dedup (Google Sheet)

Отдельный контур, **не заменяет** merge API:

| Метод | Путь |
|-------|------|
| GET | `/nomen-dedup/status` |
| POST | `/nomen-dedup/sync` |
| POST | `/nomen-dedup/apply` |
| GET | `/nomen-dedup/groups` |

Работает с Google Sheet «Закупка ТОП MRA…». Для боевого сведения 1 442 карточек используйте **`/products/.../merge`**, не `/nomen-dedup/apply`.

---

## 16. Приёмка (чеклист)

1. `dry_run` merge — отчёт `moved.by_warehouse` совпадает с ручной сверкой.  
2. Боевой merge — сумма остатка **по каждому складу** до = после.  
3. Розничная цена мастера не изменилась (`GET /products/{id}` → `prices`).  
4. `GET /products?q=<старый код 1С>` находит **мастер**.  
5. Проведённые расходные/приходные по старому id открываются, суммы те же.  
6. Повтор bulk с тем же `idempotency_key` **не задваивает** остаток.  
7. Merge **не пересекает** `pnevmopodveska_2025` и `fogel_2025`.

---

## 17. Пример curl (dry_run merge)

```bash
BASE=https://1c.pnevmopodveska1.ru/api
KEY=wms_xxxxxxxx

curl -sS -X POST "$BASE/products/MASTER_UUID/merge" \
  -H "X-Wms-Key: $KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "source_ids": ["SOURCE_UUID_1","SOURCE_UUID_2"],
    "dry_run": true,
    "move_stock": true,
    "move_reserves": true,
    "move_cells": true,
    "move_suppliers": true,
    "merge_codes_to": "both",
    "archive_sources": true,
    "comment": "MRAER group test"
  }' | jq .
```

---

*Документ отражает код в `uchetn1/api/src/product-catalog-api.ts` и связанные маршруты WMS. Деплой на prod — после `npm run build` и рестарта `warehouse-wms`.*
