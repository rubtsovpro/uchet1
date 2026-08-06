# Отчёты УНФ → Учёт №1 (live vs stub)

**Дата:** 2026-07-19  
**Live:** https://1c.pnevmopodveska1.ru  
**Каталог API:** `GET /api/reports/catalog` · UI: Настройки → Отчёты

## Блокер 1С

Веб-клиент `https://bezmat.corp.rarus-cloud.ru/pnevmopodveska_2025/` сломан (`.vrd` / authform).  
OData есть (Basic Auth), но меню отчётов УНФ в браузере недоступно.  
Источник пунктов меню — MAP (скрины толстого клиента) + локальный SQLite sync.

## Live (таблицы из SQLite)

| Отчёт | Путь | Данные |
|-------|------|--------|
| Отчёты продаж | `/sales/reports` | stock_docs out (~10k), топ покупателей/SKU |
| Анализ продаж | `/sales/analysis` | по месяцам + топы |
| Розничные (прокси) | `/sales/retail-reports` | расходные по дням (не АТОЛ) |
| Отчёты закупок | `/purchases/reports` | приходы + топ поставщиков + ГТД |
| Приходы с ГТД | `/purchases/inbound-report` | строки с gtd_key |
| Отчёты склада | `/warehouse/reports` | остатки по складам, движения |
| Остатки ниже мин. | `/stock/low` | min_stock |
| Стоимость склада | `/stock-valuation` | оценка |
| Отчёты CRM | `/crm/reports` | сделки по воронкам/статусам |
| Отчёты компании | `/company/reports` | KPI + динамика |
| Каталог | `/settings/reports` | live/partial/stub |

## Partial

| Отчёт | Почему |
|-------|--------|
| Розничные | нет чеков АТОЛ |
| Деньги | cash_docs/payment_orders пустые; СБП Точка отдельно |
| СТО `/works/reports` | только счётчик заказ-нарядов |
| Маркировка | счётчики на `/marking` |

## Stub (тонкий журнал / экран без движка СКД)

- Авансовые отчёты, ежедневные отчёты персонала  
- Отчёт исполнителей СТО, отчёты производства  
- Отчёты/доп. обработки (персонал, производство)  

Полные СКД-отчёты УНФ (СКД, варианты, расшифровки) **не** портируются в одной волне.

## Smoke после деплоя

```bash
curl -sS -L --max-time 15 https://1c.pnevmopodveska1.ru/api/health
# после логина:
# /api/reports/catalog · /api/sales/reports · /api/crm/reports · /api/warehouse/reports
```
