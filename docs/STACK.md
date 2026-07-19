# ИТ-ландшафт — Учёт №1 / Пневмоподвеска

**Документ Google:** https://docs.google.com/document/d/1FhZzPLBWwxTpB-1PUogEjJsXpGZDoWzTy1CIFIU67v0/edit  
**Название вкладки:** `Стек`  
**Дата фиксации:** 18.07.2026  
**Статус:** описание целевого и текущего ИТ-ландшафта решения; не заменяет ТЗ по функциональности

---

Ниже — текст для вкладки (между маркерами).

---

НАЧАЛО ВКЛАДКИ

# ИТ-ландшафт решения «Учёт №1»
**Проект:** Учёт №1 / MRAER («Альтернатива 1С»)  
**Продуктовый домен (цель):** `1c.pnevmopodveska1.ru`  
**Дата фиксации:** 18.07.2026  
**Назначение:** зафиксировать состав контуров, runtime, хранение, интеграции и топологию развёртывания — в объёме, достаточном для согласования архитектуры между сторонами.

Документ описывает **текущий** рабочий ландшафт и **целевые** изменения (единый домен, разделение API/Web). Версии пакетов — по lock-файлам на дату фиксации; версии Node/PHP на продакшене — по состоянию VPS на ту же дату.

---

## 1. Назначение и границы

**Входит в документ**

- Карта ИТ-контуров (WMS, amo1c, bank, внешние системы).
- Runtime и состав backend/frontend «Учёт №1».
- Модель хранения и кэширования (включая явные отсутствия: Redis и т.п.).
- Внешние интеграции и точки конфигурации.
- Топология VPS, проксирование, деплой.
- Целевой split `api` / `web` и консолидация на `1c.pnevmopodveska1.ru`.

**Не входит**

- Функциональные требования экранов и бизнес-правил (основное ТЗ, бриф экранов).
- Концепция модуля аналитики (отдельная вкладка / `TZ-analitika-roistat.md`).
- Сметы, SLA поддержки, политика резервного копирования как отдельный регламент.

---

## 2. Карта контуров

| Контур | Роль | Технологический стек |
|--------|------|----------------------|
| **Учёт №1 (WMS)** | Основной продукт: номенклатура, склад, CRM-сделки, документы, аналитика (план) | Node.js + TypeScript + Hono + SQLite; UI — Legacy JS и React/Vite |
| **amo1c** | Мост AmoCRM ↔ 1С / выгрузки для WMS | PHP на Apache |
| **bank** | СБП QR, overview, выгрузки в Google Sheets (операции/доход) | PHP + Composer (Google API Client) на Apache |
| **widget** | Печать и смежные виджеты | PHP |
| **1С УНФ / HS / OData** | Источник номенклатуры, остатков, цен, медиа | Внешние HTTP API |
| **AmoCRM** | Сделки, воронки, звонки (МегаФон АТС → Amo) | SaaS API |
| **S3 (FirstVDS)** | Фото и документы номенклатуры | S3-compatible API |
| **АТОЛ Онлайн** | Чеки (предоплата / полный расчёт) | HTTP API v4 |
| **СДЭК** | Виджет отгрузки из заданий склада | Внешний URL |

**Инфраструктура (общая):** один VPS (SSH-алиас `bank-vps`, hostname tech35), Ubuntu 24.04; Apache (прокси на Node :3101) + PHP 8.3 (mod_php) + Node.js 22.

---

## 3. Учёт №1 — backend (API)

### 3.1. Runtime (продакшен, 18.07.2026)

| Компонент | Значение |
|-----------|----------|
| ОС | Ubuntu 24.04.4 LTS |
| Node.js | v22.23.1 |
| Запуск | `node --experimental-sqlite dist/server.js` из каталога `api/` |
| systemd | `warehouse-wms.service` (`WorkingDirectory=.../warehouse/api`) |
| Порт | 3101 (`WMS_PORT`) |
| Прокси | Apache → `http://127.0.0.1:3101` (UI и `/api`) |
| Статика UI | `api` раздаёт `../web/dist` (legacy + React) |

TypeScript: target **ES2022**, module **NodeNext**, strict mode. Исходники: `api/src/` → `api/dist/`.

### 3.2. Зависимости npm (`api/package.json`, lockfileVersion 3)

| Пакет | Версия в lock | Назначение |
|-------|---------------|------------|
| hono | 4.12.30 | HTTP-фреймворк API |
| @hono/node-server | 1.19.14 | serve / serveStatic |
| pdfkit | 0.19.1 | PDF счетов, УПД и смежных документов |
| typescript | 5.9.3 | компиляция API → `api/dist/` |
| tsx | 4.23.1 | режим разработки (watch) |
| @types/node | 22.20.1 | типы Node |
| @types/pdfkit | (dev) | типы PDF |

### 3.3. Модули backend — зоны ответственности

| Модуль | Зона |
|--------|------|
| server | HTTP-приложение, auth gate, статика, login |
| api | Маршруты `/api/*` |
| db | Схема SQLite, миграции |
| auth | Аутентификация, сессии, права |
| audit / presence | Журнал действий, онлайн-присутствие |
| odata / hs / docs-sync | Синхронизация справочников, остатков, документов из 1С |
| media / media-coverage / s3 / image-size | Медиа → S3 |
| deals / staff | Сделки и сотрудники Amo (через CLI amo1c) |
| sales-docs / sales-docs-pdf / doc-numbering | Счета, УПД, PDF, нумерация |
| payments / bank-tochka | СБП / Точка (на текущем этапе — через контур bank) |
| atol | Фискальные чеки |
| marking | Честный знак / партии |
| stock / warehouse-tasks / ops | Склад, задания, операционный дашборд дня |
| category-tree / dicts | Категории, справочники |
| sync-cli / sync-lock | CLI синхронизации и блокировки |

---

## 4. Учёт №1 — frontend

### 4.1. Legacy UI (основной рабочий интерфейс)

| Параметр | Значение |
|----------|----------|
| Источники | `web/public/` (`legacy.html`, `legacy.js`, `styles.css`, `login.html`) |
| Сборка | копируются в `web/dist/` вместе с React (Vite `publicDir`) |
| Стек | Vanilla JS (без React); запросы `fetch` к `/api/...` |
| Шрифты | Google Fonts: Montserrat, Roboto, Roboto Mono |
| Охват | Номенклатура, склад, CRM-сделки, настройки; аналитика — в плане |

### 4.2. React SPA (частичные экраны)

Сборка: Vite → `web/dist/`. Dev-сервер Vite: порт **5173**, proxy `/api` → `:3101`.

| Пакет | Версия в lock | Назначение |
|-------|---------------|------------|
| react / react-dom | 19.2.7 | UI |
| react-router-dom | 7.18.1 | маршрутизация |
| @tanstack/react-query | 5.101.2 | данные с API |
| vite | 8.1.5 | сборка / dev |
| @vitejs/plugin-react | 6.0.3 | JSX |
| typescript | 6.0.3 | TypeScript для web |
| oxlint | 1.74.0 | lint |
| @types/react | 19.2.17 | типы |

**Параметры React Query:** `staleTime` 30 с; `retry` 1; `refetchOnWindowFocus` false.

**Feature-модули:** auth, crm, money (Точка), org, sales, home, legacy, shell.

**Маршруты React (через Node):** `/money/*`, часть CRM / sales / org. Остальной UI — legacy.

---

## 5. Хранение данных и кэширование

| Объект | Размещение | Примечание |
|--------|------------|------------|
| Основная БД | SQLite `data/warehouse.sqlite` (`node:sqlite` / DatabaseSync), WAL | Серверного кэша (Redis/Memcached) нет |
| Сессии | таблица `sessions`, cookie `wms_sid`, TTL 14 суток | В SQLite |
| Presence («кто онлайн») | таблица `user_presence` (+ IP, UA, OS, browser, device, region); heartbeat ~40 с; окно online 120 с; GeoIP через ip-api.com + кэш `ip_geo_cache` (7 суток) | В SQLite |
| Audit | таблица `audit_log` | В SQLite |
| Sync lock | файловая/логическая блокировка `sync-lock` | Без внешнего кэша |
| Статика JS/CSS | `Cache-Control: no-store` для `.js` / `.css` / legacy | Браузерный кэш отключён намеренно |
| UI prefs | `localStorage` (сворачивание сайдбара) | Только клиент |
| React Query | клиентский кэш запросов 30 с | См. §4.2 |

**Явно отсутствует:** Redis, Memcached, CDN-кэш приложения, Elasticsearch.

---

## 6. Смежные контуры

### 6.1. bank.pnevmopodveska1.ru (PHP + Composer)

Функциональность целевым образом переносится под `1c.pnevmopodveska1.ru`; контур bank на дату фиксации остаётся рабочим.

| Пакет | Версия | Назначение |
|-------|--------|------------|
| google/apiclient | v2.14.0 | Google Sheets / Docs API |
| google/apiclient-services | v0.302.0 | сервисы API |
| google/auth | v1.26.0 | аутентификация SA |
| guzzlehttp/guzzle | 6.5.8 | HTTP |
| guzzlehttp/promises | 1.5.3 | promises |
| guzzlehttp/psr7 | 1.9.1 | PSR-7 |
| firebase/php-jwt | v6.4.0 | JWT |
| phpseclib/phpseclib | 3.0.37 | crypto (зависимость Google) |
| monolog/monolog | 1.27.1 | логирование |
| psr/cache, psr/log, psr/http-message | — | интерфейсы PSR (не Redis) |

PHP на продакшене: **8.3.6** + `libapache2-mod-php8.3`.  
Сервисный аккаунт Google: JSON-ключ в контуре bank.  
Типовые сценарии: выгрузки операций/дохода в Sheets; СБП / Точка API.

### 6.2. amo1c (PHP)

- Классический PHP (HTTP/curl к AmoCRM и 1С).
- CLI-выгрузки для WMS: сделки и сотрудники (пути задаются в окружении WMS).
- Звонки МегаФон → AmoCRM — источник данных для будущего раздела `/analytics` (см. вкладку аналитики).

---

## 7. Внешние интеграции

| Система | Протокол | Точка конфигурации |
|---------|----------|-------------------|
| 1С OData | HTTP Basic | `ODATA_*` |
| HS (HTTP-сервис 1С) | HTTP Basic | `HS_BASE_URL`, `HS_USER`, `HS_PASS` |
| S3 | S3 API | `S3_ENDPOINT`, `S3_BUCKET`, ключи; публичный endpoint `*.s3.firstvds.ru` |
| AmoCRM | API + CLI export | через контур amo1c |
| Точка Банк | HTTP через bank | `BANK_SBP_*`, `BANK_TOCHKA_*` |
| АТОЛ | HTTPS | `ATOL_*` |
| Честный знак / CRPT | HTTPS | `CRPT_*` |
| СДЭК (виджет) | URL | `CDEK_WIDGET_URL` |
| Google Sheets / Docs | API SA | Composer + JSON-ключ в bank |
| МегаФон АТС | → Amo (без прямого API в WMS v1) | — |

---

## 8. Инфраструктура и развёртывание

| Параметр | Значение |
|----------|----------|
| VPS | FirstVDS; hostname tech35; SSH-алиас `bank-vps` |
| Каталог WMS | `/root/1c_pnevmopodveska1_ru/warehouse` |
| Пакеты | `api/` (Node) + `web/` (Vite); SQLite в `data/` |
| Деплой | `deploy/deploy.sh` (`--rsync` или git): `npm ci --prefix api|web` → `build:api` + `build:web` → restart |
| Секреты | `/etc/warehouse-wms.env` (вне репозитория) |

Apache: ProxyPass `/api` и `/` на Node :3101; отдельные DocumentRoot для PHP-контуров (bank, amo1c) и исключений под документацию/swagger при необходимости.

---

## 9. Сводка размещения компонентов

- React + TanStack Query — `web/` (частичные экраны).
- Legacy JS — `web/public` → `web/dist` (основной рабочий интерфейс).
- Hono API — `api/src` → `api/dist`; статика с `web/dist`.
- SQLite — `data/warehouse.sqlite` (корень репо / `WMS_DATA_DIR`).
- Composer (Google / Guzzle) — контур bank (`vendor` + composer.lock).
- Серверный кэш — отсутствует (нет Redis).
- Клиентский кэш — React Query 30 с + localStorage для UI-prefs.
- Сессии — SQLite `sessions` + cookie `wms_sid`.
- Медиа — S3.
- Аналитика / атрибуция (план) — будущий `/analytics`; звонки из AmoCRM.

---

## 10. Целевая архитектура (домен и split API/Web)

**Этап A (выполнен, 18.07.2026):** разделение пакетов в одном репозитории:

- пакет `api/` — backend (§3);
- пакет `web/` — frontend (§4), сборка в `web/dist`;
- корневые скрипты `build` / `build:api` / `build:web` / `start`;
- единый продуктовый домен `1c.pnevmopodveska1.ru` (UI + `/api`).

**Этап B (план):** отказ от отдельного хоста `bank.*` и устаревшего контура 1cpodveska — перенос money/СБП под `1c.*`, 301, снятие vhost.

Cookie-сессия и callback-URL внешних систем (Точка, Amo ingest, вебхуки) должны быть приведены к origin `1c.pnevmopodveska1.ru` до отключения старых хостов. Физический VPS может остаться тем же; меняется схема vhost / проксирования.

**Остаточные зависимости от `bank.pnevmopodveska1.ru` (намеренно сохранены):**

- `BANK_SBP_CREATE_URL` → `/api/sbp_create_qr.php` (СБП QR);
- `BANK_TOCHKA_OVERVIEW_URL` → `/api/tochka_overview.php`;
- ссылка на `income.php` в UI money (открытие в новой вкладке).

---

## 11. Допущения

- Один VPS обслуживает bank, amo1c и WMS; масштабирование на несколько узлов в текущем объёме не требуется.
- SQLite при текущей нагрузке достаточен; переход на клиент-серверную СУБД — отдельное архитектурное решение.
- Прямой API Мегафон в контуре WMS v1 не используется (звонки — через AmoCRM).
- Версии npm/composer фиксируются lock-файлами; обновление мажорных версий — через отдельное согласование.

---

## 12. Риски

- Сосуществование Legacy UI и React увеличивает стоимость единообразия UX до завершения миграции экранов.
- Зависимость платежей и Sheets от контура bank до переноса под единый домен — риск рассинхрона callback/DNS при поэтапном cutover.
- Отсутствие серверного кэша упрощает эксплуатацию, но ограничивает горизонтальное масштабирование read-нагрузки.
- Качество медиа и синхронизации с 1С зависит от доступности OData/HS и S3; сбои внешних API требуют runbook и мониторинга sync-lock.

---

## 13. Критерии актуальности документа

Документ считается актуальным, если на дату ревизии совпадают:

1. Версия Node.js и PHP на VPS с указанными в §3.1 и §6.1.
2. Порт WMS, unit systemd и схема Apache → Node.
3. Состав ключевых npm/composer-зависимостей (hono, react, google/apiclient) с lock-файлами.
4. Продуктовый домен-цель: `1c.pnevmopodveska1.ru`.
5. Перечень внешних систем из §7 без неучтённых новых интеграций в проде.

При существенном изменении ландшафта — обновить этот документ и вкладку «Стек» одной ревизией.

---

*Версии npm/composer — из package-lock / composer.lock на 18.07.2026. Прод Node/PHP — с VPS на ту же дату.*

КОНЕЦ ВКЛАДКИ
