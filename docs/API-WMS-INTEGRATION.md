# Учёт №1 — WMS API (интеграция)

OpenAPI 3.0 · спецификация для внешних систем (Kloud / 1С / роботы).

**Prod:** `https://1c.pnevmopodveska1.ru/api`  
**Зеркало:** `https://uchetn1.ru/api`  
**Живая спека:** `https://1c.pnevmopodveska1.ru/api/openapi.json`  
**Swagger UI:** `https://1c.pnevmopodveska1.ru/api/swagger` (нужна сессия WMS или Basic, если включён)

---

## 1. Аутентификация

### 1.1 API-ключ (рекомендуется для интеграций)

Ключ выпускается в UI: **Помощь → Интеграции и API** (`/help/integrations`).

Передача ключа (любой вариант):

```http
X-Wms-Key: wms_xxxxxxxxxxxxxxxx
```

```http
X-Api-Key: wms_xxxxxxxxxxxxxxxx
```

```http
Authorization: Bearer wms_xxxxxxxxxxxxxxxx
```

```http
x-wms-ingest-key: wms_xxxxxxxxxxxxxxxx
```

```http
GET /api/products?key=wms_xxxxxxxxxxxxxxxx
```

Query-параметр: `?key=wms_xxxxxxxxxxxxxxxx`

Ключ показывается **один раз** при создании. В БД хранится hash + hint (`wms_…abc4`).

### 1.2 Scopes (права ключа)

| Scope | Раздел | Пути |
|-------|--------|------|
| `nomen` | Номенклатура | `/products`, `/categories`, `/units`, `/prices`, `/dicts/*` |
| `balances` | Остатки | `/balances`, `/stock/low`, `/stock/valuation` |
| `warehouses` | Склады | `/warehouses`, `/docs`, `/stock/*`, `/warehouse/tasks` |
| `storage` | Адресное хранение | `/warehouse/cells/*` |
| `all` | Всё перечисленное | полный доступ |

Для управления номенклатурой, остатками, складами и ячейками — scope **`all`**  
или все четыре: `nomen` + `balances` + `warehouses` + `storage`.

### 1.3 Сессия (UI)

Cookie `wms_sid` после `POST /api/login` — для интерактивной работы, не для роботов.

### 1.4 Ошибки

| HTTP | Тело | Причина |
|------|------|---------|
| 401 | `{ "error": "unauthorized" }` | нет / неверный ключ |
| 403 | `{ "error": "…" }` | нет scope или права `can_edit_*` |
| 404 | `{ "error": "not found" }` | сущность не найдена |
| 409 | `{ "error": "…", "has_links": true }` | удаление заблокировано связями |

Общий формат ошибки:

```json
{ "error": "текст ошибки" }
```

### 1.5 Пагинация

Параметры: `page` (с 1), `limit` (по умолчанию 50, **максимум 500**).

Если передать `limit` больше 500 на `/api/products` или `/api/balances` — ответ **400**
`{ "error": "limit max is 500", "max": 500 }` (раньше молча обрезалось до 500).

В успешном ответе списка также есть `limit_max: 500`.

Ответ со списком:

```json
{
  "items": [ … ],
  "total": 1234,
  "page": 1,
  "limit": 50,
  "pages": 25,
  "limit_max": 500
}
```

---

### 1.6 Контуры (`company_id`)

| Метод | Путь | Scope |
|-------|------|-------|
| GET | `/api/companies` | `nomen` или `all` |

Ответ: `{ items: [{ id, name, code, is_default, is_active }], default_id }`.

**Важно:**
- неизвестный `company_id` → **400**, не «вся база»;
- для запросов по API-ключу (без сессии UI) `company_id` **обязателен**;
  чтобы выгрузить все контуры — явно `company_id=all`.

Москва (прод): `00000000-0000-4000-8000-000000000001` (`PNEVMO`).

---

## 2. Health

### `GET /api/health`

Без авторизации.

**Response 200:**

```json
{
  "ok": true,
  "service": "warehouse-1c"
}
```

---

## 3. Номенклатура · scope `nomen`

### `GET /api/products`

Список товаров и услуг.

**Query:**

| Параметр | Тип | Описание |
|----------|-----|----------|
| `q` | string | Поиск: sku, code, barcode, name, brand, category, применимость |
| `category_id` | string | UUID категории; `__none__` — без категории |
| `category` | string | имя категории |
| `mark` | string | марка авто (применимость) |
| `model` | string | модель |
| `generation` | string | поколение |
| `archived` | string | `0` активные (default), `1` архив, `all` |
| `item_kind` | string | `product` \| `service` |
| `is_main` | string | `1` \| `0` |
| `company_id` | UUID контура | обязателен для выгрузки филиала; неизвестный → **400** |
| `include` | string | `prices` — цены из `product_prices` в каждой строке |
| `with_prices` | `1` | алиас `include=prices` |
| `sort` | string | `created_at`, `sku`, `name`, `stock_qty`, … |
| `dir` | string | `asc` \| `desc` |
| `page`, `limit` | int | пагинация; **limit max 500** (иначе 400) |

**Связка с остатками:** матчить только по `product_id`. Поле `sku` может содержать хвосты синка `@podveska` / `:hex` — не использовать как ключ стыковки.

**Response 200:** `ProductList`

```json
{
  "items": [{
    "id": "uuid",
    "sku": "НФ-000123",
    "code": "НФ-000123",
    "name": "Амортизатор передний",
    "brand": "Bilstein",
    "barcode": "4607123456789",
    "warehouse_sku": "",
    "array_sku": "",
    "category_id": "uuid",
    "category": "Амортизаторы",
    "unit": "шт",
    "item_kind": "product",
    "is_active": 1,
    "stock_qty": 5,
    "stock_places": "Основной 3 · МСК 2"
  }],
  "total": 100,
  "page": 1,
  "limit": 50,
  "pages": 2
}
```

---

### `GET /api/products/{id}`

Полная карточка товара.

**Path:** `id` — UUID товара

**Response 200:**

```json
{
  "id": "uuid",
  "sku": "…",
  "name": "…",
  "brand": "…",
  "barcode": "…",
  "properties": [
    { "property": "Длина", "value": "500 мм", "options": ["400 мм", "500 мм"] }
  ],
  "prices": [
    { "price_type": "Розничная цена", "price": 15000, "has_value": true },
    { "price_type": "ОПТ1", "price": 12000, "has_value": true }
  ],
  "applicability": [
    { "id": "uuid", "mark": "Mercedes", "model": "W221", "generation": "", "years": "2005-2012" }
  ],
  "rests": [
    {
      "warehouse_id": "uuid",
      "warehouse": "Основной",
      "warehouse_code": "MAIN",
      "qty": 3,
      "reserved_qty": 0,
      "is_reserve": 0
    }
  ],
  "media": [],
  "inbound_layers": [],
  "purchase_history": { "total": 5, "items": [] },
  "related": []
}
```

---

### `POST /api/products`

Создать товар или услугу.

**Request:**

```json
{
  "name": "Амортизатор передний",
  "sku": "НФ-999999",
  "code": "НФ-999999",
  "barcode": "4607123456789",
  "category_id": "uuid",
  "unit_id": "uuid",
  "item_kind": "product"
}
```

| Поле | Обяз. | Описание |
|------|-------|----------|
| `name` | да | наименование |
| `sku` | нет | артикул; если пусто — автонумерация `НФ-…` / `УСЛ-…` |
| `code` | нет | код 1С; default = sku |
| `barcode` | нет | штрихкод |
| `category_id` | нет | UUID категории |
| `unit_id` | нет | UUID ед. изм.; default «шт» |
| `item_kind` | нет | `product` (default) \| `service` |

**Response 201:**

```json
{ "id": "uuid", "sku": "НФ-999999", "code": "НФ-999999", "item_kind": "product" }
```

**Errors:** 409 — SKU уже существует (без автохвоста). Дубли с `@podveska` / `:hex` создаёт только синк 1С при коллизии артикула между карточками, не этот POST.

---

### `PATCH /api/products/{id}`

Изменить карточку.

**Request (любые поля):**

```json
{
  "name": "…",
  "sku": "…",
  "brand": "…",
  "barcode": "…",
  "code": "…",
  "array_sku": "…",
  "warehouse_sku": "…",
  "category_id": "uuid|null",
  "is_active": true,
  "item_kind": "product",
  "min_stock": 2,
  "package_width_cm": 30,
  "package_height_cm": 15,
  "package_length_cm": 40,
  "package_weight_g": 2500,
  "gtin": "…",
  "requires_marking": false,
  "serial_tracked": false,
  "is_main": true,
  "install_price": 0,
  "notupload": false
}
```

**Response 200:** обновлённый объект товара

---

### `POST /api/products/{id}/archive`

Перевести в архив (`is_active = 0`).

**Response 200:** карточка с `is_active: 0`

---

### `DELETE /api/products/{id}`

Жёсткое удаление.

**Response 200:** `{ "ok": true }`  
**Response 409:** `{ "error": "…", "has_links": true, "link_counts": { … } }` — есть связи (документы, сделки)

---

### `PUT /api/products/{id}/properties`

Дополнительные характеристики (свойства).

**Request:**

```json
{
  "properties": [
    { "property": "Длина", "value": "500 мм" },
    { "property": "Материал", "value": "Сталь" }
  ]
}
```

**Response 200:**

```json
{ "ok": true, "properties": [ { "property": "Длина", "value": "500 мм" } ] }
```

---

### `PUT /api/products/{id}/applicability`

Применимость (марка / модель / годы).

**Request:**

```json
{
  "applicability": [
    {
      "mark": "Mercedes",
      "model": "W221",
      "generation": "S-class",
      "years": "2005-2012"
    },
    { "id": "uuid-существующей-строки", "_delete": true }
  ]
}
```

**Response 200:** `{ "ok": true, "applicability": [ … ] }`

---

### `PUT /api/products/{id}/prices`

Цены по типам.

**Request:**

```json
{
  "prices": [
    { "price_type": "Розничная цена", "price": 15000 },
    { "price_type": "ОПТ1", "price": 12000 },
    { "price_type": "ОПТ2", "price": 11000 },
    { "price_type": "Цена снятие/установки", "price": 3000 },
    { "price_type": "Цена Маркетплейс", "price": 14500 }
  ]
}
```

**Response 200:**

```json
{
  "ok": true,
  "prices": [ { "price_type": "Розничная цена", "price": 15000 } ],
  "changes": [ "Розничная цена: 14000 → 15000" ]
}
```

---

### `GET /api/products/{id}/units`

Упаковки / единицы измерения товара.

---

### `GET /api/products/{id}/purchase-history`

История закупок (все приходные строки по товару).

**Query:** `limit` (default 50, max 200)

**Response 200:**

```json
{
  "total": 12,
  "items": [{
    "doc_date": "2026-01-15",
    "counterparty": "Поставщик",
    "number": "IN-00123",
    "qty": 10,
    "price": 8500
  }]
}
```

---

### `GET /api/products/{id}/inbound-layers`

FIFO-слои: какие приходы покрывают текущий остаток.

**Response 200:**

```json
{
  "layers": [],
  "value": 85000,
  "unit_cost": 8500,
  "qty_unpriced": 0,
  "method_note": "FIFO по приходам"
}
```

---

### `GET /api/prices/matrix`

Матрица цен по многим товарам.

**Query:** `limit` (default 200)

---

### `GET /api/categories`

Плоский список категорий.

---

### `GET /api/categories/tree`

Дерево категорий (вложенность).

---

### `POST /api/categories`

**Request:** `{ "name": "Амортизаторы", "parent_id": "uuid|null" }`

---

### `DELETE /api/categories/{id}`

Удалить категорию.

---

### `GET /api/units`

Справочник единиц измерения.

**Response 200:** массив `{ id, name, short_name }`

---

### `POST /api/units`

**Request:** `{ "name": "Штука", "short_name": "шт" }`

---

### `GET /api/dicts/brands`

Бренды. **Query:** `q` — фильтр по имени.

---

### `GET /api/dicts/marks`

Марки автомобилей (справочник применимости).

---

### `GET /api/dicts/generations`

Поколения моделей.

---

### `GET /api/dicts/price-types`

Справочник типов цен.

**Response 200:**

```json
[
  { "id": "uuid", "name": "Розничная цена", "products_count": 1520 },
  { "id": "uuid", "name": "ОПТ1", "products_count": 890 }
]
```

Стандартные типы: **Розничная цена**, **ОПТ1**, **ОПТ2**, **Цена снятие/установки**, **Цена Маркетплейс**.

---

### `POST /api/dicts/price-types`

**Request:** `{ "name": "ОПТ3" }`

---

### `PATCH /api/dicts/price-types/{id}`

Переименовать тип цены (каскадно обновляет `product_prices`).

**Request:** `{ "name": "ОПТ VIP" }`

---

### `DELETE /api/dicts/price-types/{id}`

Удалить тип цены из справочника.

---

### `GET /api/public/product/{ref}.json`

Публичный JSON товара (scope `public` или `nomen`).

**Query / Header:** ключ `?key=` или `X-Wms-Key`

---

## 4. Остатки · scope `balances`

### `GET /api/balances`

Остатки по складам.

**Query:**

| Параметр | Описание |
|----------|----------|
| `warehouse_id` | UUID склада |
| `product_id` | UUID товара |
| `company_id` | UUID юрлица (фильтр по организации) |
| `q` | поиск по sku / name / barcode |
| `sort` | `qty`, `sku`, `name`, `warehouse`, `reserved`, `marks` |
| `dir` | `asc` \| `desc` |
| `page`, `limit` | пагинация |

**Response 200:**

```json
{
  "items": [{
    "product_id": "uuid",
    "sku": "НФ-000123",
    "warehouse_sku": "",
    "name": "Амортизатор",
    "warehouse_id": "uuid",
    "warehouse": "Основной",
    "warehouse_code": "MAIN",
    "qty": 3,
    "reserved_qty": 1,
    "unit": "шт",
    "category": "Амортизаторы",
    "item_kind": "product",
    "is_reserve": 0,
    "dm_codes": ["DM…"]
  }],
  "total": 500,
  "page": 1,
  "limit": 50,
  "totals": {}
}
```

---

### `GET /api/stock/low`

Низкие остатки (ниже `min_stock`).

**Query:** `limit` (default 300)

---

### `GET /api/stock/valuation`

Оценка остатков FIFO + розница.

**Query:**

| Параметр | Описание |
|----------|----------|
| `warehouse_id` | фильтр по складу |
| `q` | поиск |
| `items` | `0` — только итоги без строк |
| `page`, `limit` | пагинация |

**Response 200:**

```json
{
  "total_value": 1500000,
  "total_value_retail": 2100000,
  "total_value_last_purchase": 1600000,
  "by_warehouse": [],
  "items": [],
  "method_note": "FIFO по приходам"
}
```

---

## 5. Склады · scope `warehouses`

### `GET /api/warehouses`

Список складов.

**Query:**

| Параметр | Описание |
|----------|----------|
| `archived` | `0` активные, `1` архив, `all` |
| `company_id` | фильтр по юрлицу |
| `totals` | `1` — добавить суммы остатков |

**Response 200:** массив складов

```json
[{
  "id": "uuid",
  "name": "Основной",
  "code": "MAIN",
  "is_active": 1,
  "company_id": "uuid",
  "has_links": true,
  "can_delete": false
}]
```

---

### `GET /api/warehouses/stock-totals`

Суммы остатков по складам (закуп FIFO + розница).

**Response 200:**

```json
{
  "method": "fifo_inbound",
  "currency": "RUB",
  "items": [{
    "warehouse_id": "uuid",
    "warehouse_name": "Основной",
    "value_purchase": 500000,
    "value_retail": 720000,
    "qty": 120,
    "lines": 85
  }]
}
```

---

### `GET /api/warehouses/{id}`

Карточка склада.

---

### `GET /api/warehouses/{id}/movements`

Движения по складу.

---

### `POST /api/warehouses`

Создать склад.

**Request:**

```json
{
  "name": "Склад №2",
  "code": "WH-000002",
  "company_id": "uuid"
}
```

**Response 201:** объект склада

---

### `PATCH /api/warehouses/{id}`

Изменить склад.

---

### `POST /api/warehouses/{id}/archive`

Архивировать склад.

---

### `DELETE /api/warehouses/{id}`

Удалить (если `can_delete: true`).

---

### `GET /api/docs`

Журнал складских документов.

**Query:**

| Параметр | Описание |
|----------|----------|
| `type` | `in` \| `out` \| `transfer` \| `return` |
| `deal_id` | номер сделки Amo |
| `warehouse_id` | склад |
| `posted` | `0` черновик, `1` проведён |
| `sort`, `dir`, `page`, `limit` | сортировка и пагинация |

---

### `GET /api/docs/{id}`

Карточка документа + строки.

---

### `POST /api/docs`

Создать документ (при `post: true` — сразу провести).

**Request:**

```json
{
  "doc_type": "in",
  "warehouse_id": "uuid",
  "warehouse_to_id": "uuid",
  "counterparty_id": "uuid",
  "deal_id": "25689129",
  "comment": "Приход от поставщика",
  "organization_id": "uuid",
  "serials_optional": false,
  "post": false,
  "lines": [{
    "product_id": "uuid",
    "qty": 2,
    "price": 8500,
    "warehouse_id": "uuid",
    "serials": ["DM12345678901234"],
    "apps": [{ "mark": "Mercedes", "model": "W221" }]
  }]
}
```

| `doc_type` | Описание |
|------------|----------|
| `in` | приход |
| `out` | расход / списание |
| `transfer` | перемещение (`warehouse_to_id` обязателен) |
| `return` | возврат от покупателя |

**Response 201:** объект документа

---

### `GET /api/stock/transfers`

Журнал перемещений.

---

### `GET /api/stock/writeoffs`

Журнал списаний.

---

### `POST /api/stock/transfer-request`

Заявка на перемещение между складами.

---

### `GET /api/warehouse/tasks`

Задания кладовщику.

---

### Маркировка · Data Matrix

| Метод | Путь | Описание |
|-------|------|----------|
| GET | `/api/products/{id}/marking` | марки товара |
| PATCH | `/api/products/{id}/marking-flags` | флаги маркировки |
| POST | `/api/docs/marks/preview` | превью кодов |
| POST | `/api/docs/{id}/datamatrix/allocate` | выделить коды |
| GET | `/api/docs/{id}/datamatrix/labels.pdf` | PDF этикеток |

---

## 6. Адресное хранение · scope `storage`

### `GET /api/warehouse/cells/meta`

Метаинформация: склады, стеллажи, статистика.

**Query:** `warehouse_id`

---

### `GET /api/warehouse/cells/map`

Карта ячеек (стеллаж → ячейки).

**Query:** `warehouse_id`

**Response 200:**

```json
{
  "warehouse_id": "uuid",
  "warehouse_name": "Основной",
  "racks": [{
    "rack": "A",
    "kind": "shelf",
    "bay_max": 5,
    "level_max": 4,
    "cells": [{
      "id": "uuid",
      "code": "A1-2-3",
      "bay": 1,
      "level": 2,
      "kind": "shelf",
      "sku_count": 2,
      "qty_sum": 5
    }]
  }]
}
```

---

### `GET /api/warehouse/cells/balances`

Остатки по ячейкам.

**Query:**

| Параметр | Описание |
|----------|----------|
| `warehouse_id` | склад |
| `q` | поиск по sku / названию |
| `rack` | стеллаж |
| `limit`, `offset` | пагинация |

**Response 200:**

```json
{
  "total": 150,
  "rows": [{
    "cell_code": "A1-2-3",
    "rack": "A",
    "bay": 1,
    "level": 2,
    "sku": "НФ-000123",
    "name": "Амортизатор",
    "qty": 2
  }],
  "limit": 100,
  "offset": 0
}
```

---

### `GET /api/warehouse/cells/{code}`

Содержимое одной ячейки.

**Path:** `code` — адрес ячейки (URL-encoded), напр. `A1-2-3`  
**Query:** `warehouse_id`

---

### `POST /api/warehouse/cells/import`

Импорт / обновление остатков по ячейкам.

**Request:**

```json
{
  "warehouse_id": "uuid",
  "replace": false,
  "source": "google-sheet",
  "rows": [{
    "cell_code": "A1-2-3",
    "sku": "НФ-000123",
    "qty": 2,
    "rack": "A",
    "bay": 1,
    "level": 2
  }]
}
```

**Response 200:** `{ "ok": true, "imported": 10, "updated": 5, … }`

---

### `POST /api/warehouse/cells/import-cache`

Импорт из локального кэша Google-таблицы «Март. Ячейки».

---

## 7. Типовые сценарии

### Найти товар и узнать остатки

```http
GET /api/products?q=НФ-000123
GET /api/products/{id}
GET /api/balances?product_id={id}
GET /api/warehouse/cells/balances?q=НФ-000123
```

### Обновить цены и характеристики

```http
PUT /api/products/{id}/prices
PUT /api/products/{id}/properties
PATCH /api/products/{id}
```

### Архивировать товар

```http
POST /api/products/{id}/archive
```

### Создать и провести приход

```http
POST /api/docs
{ "doc_type": "in", "warehouse_id": "…", "post": true, "lines": [ … ] }
```

---

## 8. Выпуск ключа (admin)

```http
POST /api/settings/integrations/api-keys
Cookie: wms_sid=…
Content-Type: application/json

{
  "staff_id": "uuid-сотрудника",
  "name": "Kloud integration",
  "scopes": ["all"],
  "note": "Безматерных · Стрела/Фогель"
}
```

**Response:**

```json
{
  "ok": true,
  "key": "wms_xxxxxxxxxxxxxxxx",
  "key_hint": "wms_…abc4",
  "scopes": ["all"]
}
```

Поле `key` — только в этом ответе.

---

## 9. OpenAPI components (schemas)

```yaml
components:
  securitySchemes:
    wmsKey:
      type: apiKey
      in: header
      name: X-Wms-Key

  schemas:
    Error:
      type: object
      properties:
        error:
          type: string

    Health:
      type: object
      properties:
        ok: { type: boolean }
        service: { type: string, example: warehouse-1c }

    ProductList:
      type: object
      properties:
        items: { type: array, items: { type: object } }
        total: { type: integer }
        page: { type: integer }
        limit: { type: integer }
        pages: { type: integer }

    ProductPrice:
      type: object
      properties:
        price_type: { type: string, example: "Розничная цена" }
        price: { type: number }
        has_value: { type: boolean }

    ProductProperty:
      type: object
      properties:
        property: { type: string }
        value: { type: string }

    BalanceRow:
      type: object
      properties:
        product_id: { type: string, format: uuid }
        sku: { type: string }
        warehouse_id: { type: string, format: uuid }
        warehouse: { type: string }
        qty: { type: number }
        reserved_qty: { type: number }

    StockDoc:
      type: object
      properties:
        id: { type: string, format: uuid }
        doc_type: { enum: [in, out, transfer, return] }
        number: { type: string }
        posted: { type: integer, enum: [0, 1] }
        warehouse_id: { type: string }
        deal_id: { type: string }
        lines: { type: array }
```

Полная машиночитаемая спека: **`GET /api/openapi.json`**

---

## 10. Контакты и окружения

| Окружение | Base URL |
|-----------|----------|
| Production | `https://1c.pnevmopodveska1.ru/api` |
| Зеркало | `https://uchetn1.ru/api` |
| Local dev | `http://127.0.0.1:3101/api` |

Документ актуален для **Учёт №1 / WMS** (Hono + SQLite, tech35 VPS).
