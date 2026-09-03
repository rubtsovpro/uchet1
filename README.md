# Учёт №1 (WMS)

Операционный контур вместо 1С УНФ для **Пневмоподвески**: заказы покупателей, склад, продажи, деньги, СТО и персонал — с живыми интеграциями (AmoCRM, банк, касса, СДЭК, медиа).

| | |
|--|--|
| **Прод** | https://1c.pnevmopodveska1.ru · https://uchetn1.ru |
| **Оплата** | https://pay.pnevmopodveska1.ru |
| **ПДн (SMS)** | https://pdn.pnevmopodveska1.ru · https://pdn.fogel.com.ru |
| **Стек** | Hono + SQLite (`api/`) · React + Vite + legacy UI (`web/`) |
| **На сервере** | `/root/1c_pnevmopodveska1_ru/warehouse` · systemd `warehouse-wms` · порт `3101` |

Фронт ходит в бэкенд **только через `/api`**. Node из `api` отдаёт статику `web/dist` (и отдельные HTML-экраны).

Эталон сценариев ЖЦ: `api/src/sale-scenarios.ts`. Правила на заказе: `api/src/deal-sale-rules.ts`. Бланки СТО: `api/src/sto-doc-templates.ts`, `docs/STO-DOCUMENTS.md`.

---

## Функционал (весь контур)

### CRM и продажи
- Заказы покупателей из AmoCRM (воронки, статусы, ответственные, канал / СТО / филиал / способ оплаты и отправки).
- Карточка заказа: позиции, гараж авто, организация продавца, блокировка смены юрлица после счёта.
- Пакет документов и «след. шаг» по матрице ЖЦ (оплата → ЗН/ПДн → склад → УПД → чеки → закрытие).
- Редактирование покупателя; пуш реквизитов в Amo (название контакта не затираем; ФИО «как в паспорте» отдельно от ярлыка «Имя Город»).
- Контрагенты, применимость, типы цен, номенклатура.

### Документы и журналы
- Типы `sales_docs`: **счёт** (`invoice`), **заказ-наряд** (`workorder`), **УПД** (`upd`), **счёт-фактура** (`sf`), **договор** (`contract`).
- Складские: приход / расход / перемещение (`stock_docs`).
- Журналы UI: счета, ЗН, УПД, СФ, договоры, приходные, списания.
- Дерево документов заказа, нумерация, связи, печать PDF (печать / подпись / скачать).

### Шаблоны документов СТО (подробно)

**Где лежат**
- Google Drive (источник правки): папка «Шаблоны документов СТО» · манифест `docs/sto-templates/gdrive-sto-edit.json` (подпапки Roman / Mikhail / ОБЩИЕ).
- Локальный кэш после синка: `api/assets/sto-templates/cache/{roman|mikhail}/`.
- DOCX/TXT в репозитории: `api/assets/sto-templates/docx/`, `…/txt/`.
- Оферты на сайт (PDF): `api/assets/sto-templates/published/dogovor-oferta-sto-roman.pdf`, `…-mikhail.pdf`.
- Реестр в коде + HTML-fallback: `api/src/sto-doc-templates.ts` · UI **Настройки → Шаблоны документов** · `GET /api/sto-doc-templates`.
- PDF пакета: Drive/DOCX → LibreOffice (`sto-pack-pdf.ts`, `sto-docx-pdf.ts`); счета/УПД/СФ — PDFKit (`sales-docs-pdf.ts`).
- Печати/факсимиле: `api/src/org-stamp.ts` · `data/org-stamps/{inn}-*.png` или `api/assets/stamps/`.

**Реестр бланков (код → id)**

| Код | id | Назначение |
|-----|-----|------------|
| 01 | `sto-contract-person` | Договор-оферта физлица (на СТО часто ссылка на сайт, не печать) |
| 02 | `sto-contract-legal` | Договор юр/ИП (контур Михаил / СТО) |
| 02 МСК | `sto-contract-legal-msk` | Договор юр/ИП · Роман (ИНН `231215603728`) |
| 03 / 03ф / 03ю | `sto-workorder`, `…-person`, `…-legal` | Заказ-наряд |
| 10 | `sto-no-show` | Акт неявки (доп. на заказе) |
| 11 | `sto-pdn-consent` | Согласие ПДн (только физ на СТО; SMS-подпись) |
| 12 | `sto-legal-note` | Служебная памятка |
| 13 | `sto-order` | Приказ |
| 14 | `sto-reception-reglament` | Регламент приёмщика |
| 15 | `sto-checklist` | Чек-лист приёмки (доп. на заказе) |
| 00 / 00б | `sto-cheat-sheet`, `sto-how-apply` | Шпаргалки |

**Клиентский пакет печати** (`STO_CLIENT_PACK_IDS`): 01, 02, 03ф, 03ю, 11.  
**Доп. на заказе** (`STO_EXTRA_DEAL_DOCS`): только `sto-no-show`, `sto-checklist`.

Файлы 04–09 (приёмка, гарантия и т.п.) лежат в `docx/`/`txt/` как процессные бланки — **не** в активном реестре печати и не в Drive-манифесте.

**Эндпоинты PDF**
- `GET /crm/deals/:id/sto-pack.pdf` — полный пакет (договор + ЗН×2, для физ — ПДн×1)
- `GET /crm/deals/:id/sto-pdn.pdf`
- `GET /crm/deals/:id/sto-extra/:templateId.pdf`
- `GET /sales-docs/:id/pdf`
- Query: `stamps=0`, `signs=0`, `download=1`, `organization_id`

Выбор шаблона договора/ЗН: по роли покупателя и ИНН продавца (`suggestStoContractTemplateId` / `suggestStoWorkorderTemplateId`). Сайты СТО: Фогель / Стрела / Можайка (`sto-sites.ts`).

### Склад
- Остатки, приход / расход, перемещения, задания на сборку, курьер СТО.
- Маршруты из ЖЦ: `WAIT-PAY` → выдача / доставка / СТО.
- Смена кладовщика `/pick`, приёмка `/supply`, скан `/in/scan`.
- Оценка склада, Data Matrix / КИЗ, штрихкоды, применимость партий, фото номенклатуры (S3).
- **Визуализация склада** — см. ниже.

### Визуализация склада (адресные ячейки)

Интерактивный **план склада** (эталон — Москва): стеллажи, проходы, полки, заполненность, содержимое ячейки.

| | |
|--|--|
| **UI** | Склад → **Адресные ячейки** · `/warehouse/cells` · view `wh-cells` |
| **API карта** | `GET /api/warehouse/cells/map?warehouse_id=` |
| **Ячейка** | `GET /api/warehouse/cells/{code}` — SKU / кол-во в ячейке |
| **Остатки по ячейкам** | `GET /api/warehouse/cells/balances` |
| **Импорт** | снимок листа → `POST /warehouse/cells/import-cache` · `tools/fetch_cells_sheet.php` + `bin/import-cells-cache.mjs` |
| **Код** | `api/src/warehouse-cells.ts` · UI `renderWarehouseCellsMap` в `legacy.js` |

**Как устроен план МСК**
- Верх — зона сервиса; слева ряд **A** (пары A1/A2 …, проходы ≈1,2 м, A13 самовывоз); справа ряд **B**.
- Клик по стеллажу/отсеку → уровни полок → выбор ячейки → док с содержимым.
- Подсветка: заполнена / пустая / нет в снэпшоте; в метке `заполнено/всего` полок и сумма qty.
- Переключатель склада в тулбаре (по умолчанию «Москва» без «СТО»).

**Смежная «картинка» склада (не план ячеек)**
- `/pick` · `pick.uchetn1.ru` — смена кладовщика, задания, «со склада» по ячейке.
- `/ops` — очередь склада, блок оплаты, FIFO/розница.
- `/warehouse/kpd` — KPI этапов сборки (avg / P50 / P90).
- Остатки с колонкой резерва WAIT-PAY; фото без кадра — `/media/photos`, `/photo`.

Внешний доступ к карте: scope `storage` · `GET /api/warehouse/cells/map` (см. API keys / swagger).

### Деньги, оплата, касса, чеки — все платёжные контуры

| Контур | Что делает | Где |
|--------|------------|-----|
| **Ссылка на оплату WMS** | Токен → публичная страница; резерв WAIT-PAY; таймер | `pay.pnevmopodveska1.ru/pay/{token}` · `POST /crm/deals/:id/payment-link` · `/settings/payment-link` · `docs/PAYMENT-LINK.md` |
| **Точка · СБП QR** | Создание/статус QR через bank-bridge | `BANK_SBP_*` · `/settings/tochka` · `/money/tochka` |
| **Точка · эквайринг** | Карта merch.tochka.com | acquiring в bank-bridge |
| **Яндекс Пэй / Сплит** | Карта и рассрочка на `/pay` | `YANDEX_PAY_*` · `/settings/yandex-pay` · webhook `/api/public/yandex-pay/webhook` |
| **Виджет Amo (fallback)** | Если WMS-ссылка недоступна — виджет по `deal_id` | `https://pay.pnevmopodveska1.ru/?l={id}` · Фогель: `pay.fogel.com.ru` · `PAY_*_WIDGET_URL` |
| **Наличные на месте** | «Принято налом» | `POST /crm/deals/:id/accept-cash` |
| **Р/с (банк)** | Счёт юр/ИП, предоплата/постоплата | сценарии L*/I* |
| **Наложка COD** | СДЭК наложка / Авито доставка — без ссылки оплаты | сценарий F1c · `checks=0` |
| **Отсрочка партнёра** | credit / delay | P1a–P3a |
| **Касса / кассовая книга** | Регистры, журнал | `/kassa` |
| **Возвраты денег** | Журнал + возврат Точка / ПП | `return-money.ts` |
| **АТОЛ Онлайн** | Чеки: предоплата, полный расчёт, возврат, коррекция | `/settings/atol` · `docs/ATOL-CHECKS.md` · `payment_address` = pay-host |
| **Курсы ЦБ** | USD/EUR в шапке | ЦБ РФ |
| **T-Bank рассрочка** | Опционально (закомментировано) | `TBANK_INSTALLMENT_URL` |
| **ПДн перед оплатой** | На СТО физ: SMS-согласие на brand-доменах | TargetSMS · `pdn-sms-sign.ts` |

Публичное API оплаты: `GET/POST /api/public/pay/{token}` (+ poll, acquiring, yandex-pay, renew-reserve). Демо: `/pay-demo`.

### СТО и работы
- ЗН: авто, СТС (фото + OCR), работы/материалы, жалобы клиента из Amo.
- Гейты: ЗН / ПДн до оплаты и закрытия (`deal-workorder-gate.ts`).
- Экраны: подъёмник `/lift`, приёмщик `/reception`, учёт работ слесаря.
- SMS ПДн: код → страница согласия → снимок текста согласия.

### Персонал, права, чаты, компания
- Сотрудники, роли, матрица разделов (`staff.ts`).
- 2FA админа через Telegram (опционально).
- Чаты DM/группы (React `/chats`, вложения S3).
- Организации, банки, склады, логотипы/печати, гарантии.
- Избранное, аудит, presence (кто онлайн).

### Закупки, налоги, отчёты, доставка, медиа
- Поставщики, приходные, корзины закупок / цены с Drive.
- Налоги: календарь, НДС, УСН/КУДиР, зарплата, Контур (паритет).
- Хаб отчётов (`reports-hub.ts`).
- СДЭК: виджет + native API.
- Фото каталога: `/photo` · `photo.uchetn1.ru`.
- Идеи `/ideas`, помощь `/help` (ЖЦ, интеграции, экраны).

### Настройки / интеграции (UI)
- AmoCRM: OAuth, webhooks, **правила продажи / поля / сценарии ЖЦ** (`/settings/amo`).
- Шаблоны документов + матрица пакета (`/settings/doc-templates`).
- Ссылка оплаты, Точка, Яндекс Пэй, АТОЛ, СДЭК, DaData, OCR/DeepSeek, каналы, права, audit.

---

## Жизненный цикл заказа (настройка и матрица)

### Поля Amo → заказ (`amo-sale-config.ts`)
| Поле Amo | Колонка | Значения (смысл) |
|----------|---------|------------------|
| Канал реализации | `amo_channel` | Автосервис / Самовывоз / Отправка |
| Тип оплаты | `amo_payment_type` | Предоплата / Постоплата |
| Способ оплаты | `amo_pay_method` | Наличка, Карта, Р/с, QR, СБП, СДЭК Наложка, Отсрочка, … |
| Способ отправки | `amo_shipment` | ТК СДЭК, СДЭК наложка, Авито, Автобус, Курьер, … |
| Филиал | `amo_branch` | Можайка / Стрела / Фогель → контур организации |
| СТО | `amo_sto` | Стрела Фогель / Подвеска / Фадеева / Можайское |
| + | | ИНН, Партнёр, Жалоба клиента (в ЗН) |

Сопоставление → сценарий: `matchSaleScenario` · подсказка шагов: `buildDealHintSteps` · готовность закрытия: `GET /crm/deals/:id/close-readiness` · отгрузки: `…/ship-readiness`.

**Гейты:** при `zn=1` — создать/напечатать ЗН (+ госномер при СТС) до оплаты; при `pdn=1` — согласие ПДн (сканы/SMS) до оплаты и закрытия.

Настройки: **Интеграции → Amo → Правила**; визуализация — **Помощь → ЖЦ** · API `GET /help/sale-scenarios`, `/help/lifecycle-marks`. Чеклист: `docs/TEST-sale-scenarios.md`.

### Полная матрица сценариев F1a…P0

Колонки документов: **dog** договор · **apps** приложения · **dover** доверенность · **pas** паспорт · **sts** СТС · **zn** ЗН · **pdn** ПДн · **inv** счёт · **upd** УПД · **xfer** перемещение · **wh** склад · **checks** число чеков АТОЛ (`0` / `1` / `2` / `0/1`).

| id | Сценарий | Канал | Покуп. | Оплата | dog | apps | dover | sts | zn | pdn | inv | upd | xfer | wh | checks |
|----|----------|-------|--------|--------|-----|------|-------|-----|----|-----|-----|-----|------|-----|--------|
| F1a | Физ · отправка · предоплата карта/СБП | ship | person | prepay/card | | | | | | | ✓ | | ✓ | WAIT-PAY·→доставка | 2 |
| F1b | Физ · отправка · постоплата | ship | person | postpay/card | | | | | | | ✓ | | ✓ | →доставка | 1 |
| F1c | Физ · отправка · наложка | ship | person | postpay/cod | | | | | | | ✓ | | ✓ | →доставка | 0 |
| F2a | Физ · самовывоз · предоплата | pickup | person | prepay/card | | | | | ✓ | | | | ✓ | WAIT-PAY·→выдача | 2 |
| F2b | Физ · самовывоз · на месте | pickup | person | onsite/cash | | | | | ✓ | | | | ✓ | →выдача | 1 |
| F3a | Физ · СТО · предоплата | sto | person | prepay/card | ✓ | | | ✓ | ✓ | ✓ | | | ✓ | →СТО | 2 |
| F3b | Физ · СТО · на месте | sto | person | onsite/cash | ✓ | | | ✓ | ✓ | ✓ | | | ✓ | →СТО | 1 |
| F3s | Физ · СТО · только услуги | sto | person | onsite/cash | ✓ | | | ✓ | ✓ | ✓ | | | | — | 1 |
| L1a | Юр · отправка · р/с предоплата | ship | legal | prepay/bank | ✓ | ✓ | ✓ | | | | ✓ | ✓ | ✓ | WAIT-PAY·→доставка | 0 |
| L1b | Юр · отправка · постоплата | ship | legal | postpay/bank | ✓ | ✓ | ✓ | | | | ✓ | ✓ | ✓ | →доставка | 0 |
| L1c | Юр · отправка · карта/СБП | ship | legal | prepay/card | ✓ | ✓ | ✓ | | | | ✓ | ✓ | ✓ | WAIT-PAY·→доставка | 1 |
| L2a | Юр · самовывоз · р/с | pickup | legal | prepay/bank | ✓ | ✓ | ✓ | | ✓ | | ✓ | ✓ | ✓ | WAIT-PAY·→выдача | 0 |
| L2b | Юр · самовывоз · на месте | pickup | legal | onsite/card | ✓ | ✓ | ✓ | | ✓ | | ✓ | ✓ | ✓ | →выдача | 0/1 |
| L3a | Юр · СТО · р/с предоплата | sto | legal | prepay/bank | ✓ | ✓ | | ✓ | ✓ | | ✓ | ✓ | ✓ | →СТО | 0 |
| L3b | Юр · СТО · постоплата | sto | legal | postpay/bank | ✓ | ✓ | | ✓ | ✓ | | ✓ | ✓ | ✓ | →СТО | 0 |
| L3c | Юр · СТО · на месте | sto | legal | onsite/card | ✓ | ✓ | | ✓ | ✓ | | ✓ | ✓ | ✓ | →СТО | 1 |
| I1a/b | ИП · отправка | ship | ip | bank | как L1 | | | | | | | | | | | |
| I2a/b | ИП · самовывоз | pickup | ip | bank/card | как L2 | | | | | | | | | | | |
| I3a/b | ИП · СТО | sto | ip | bank/card | как L3 | | | | | | | | | | | |
| P1a | Партнёр · отправка · отсрочка | ship | partner | credit/delay | ✓ | ✓ | ✓ | | | | ✓ | ✓ | ✓ | →доставка | 0 |
| P2a | Партнёр · самовывоз · отсрочка | pickup | partner | credit/delay | ✓ | ✓ | ✓ | | ✓ | | ✓ | ✓ | ✓ | →выдача | 0 |
| P3a | Партнёр · СТО · отсрочка | sto | partner | credit/delay | ✓ | ✓ | | ✓ | ✓ | | ✓ | ✓ | ✓ | →СТО | 0 |
| P0 | Партнёр · редкая карта/СБП | any | partner | card | | | | | | | ✓ | | ✓ | WAIT-PAY·→доставка | 1 |

Юр/ИП на отправке/самовывозе: рамочный договор поставки/ремонта + приложения (гарантия, форма заявки, акт недостатков) + счёт + УПД; доверенность при получении товара.

---

## Интеграции (сводка)

| Система | Назначение |
|---------|------------|
| **AmoCRM** (+ `deploy/amo1c-bin`) | Сделки, контрагенты, стадии, webhooks, OAuth, поля ЖЦ, пуш покупателя |
| **1С OData / HS** | Исторический синк; live OData бухгалтерии (контрагенты, реализации, СФ) — по запросу объектов |
| **Точка Банк** | СБП QR, эквайринг, overview, возвраты |
| **Яндекс Пэй / Сплит** | Карта и рассрочка на `/pay` |
| **Виджеты pay.*** | Fallback-оплата Amo (пневмо / Фогель) |
| **АТОЛ Онлайн** | Фискальные чеки |
| **СДЭК** | Виджет и native API |
| **DaData** | ИНН / ФИО / адрес |
| **S3** | Фото каталога, СТС, чаты |
| **Telegram** | 2FA админа |
| **DeepSeek / CF Workers AI** | OCR СТС |
| **TargetSMS** | Коды ПДн |
| **ЦБ РФ** | Курсы |

Секреты на проде — `/etc/warehouse-wms.env` (+ meta в SQLite из UI). Пример: `.env.example`.

---

## Экраны и хосты

| URL / хост | Кто |
|------------|-----|
| `/`, `/legacy.html` | Полный WMS (taxi UI) |
| `pay.pnevmopodveska1.ru` · `/pay/{token}` | Оплата по ссылке |
| `pay.pnevmopodveska1.ru/?l={deal}` | Виджет Amo (пневмо) |
| `pdn.pnevmopodveska1.ru` / `pdn.fogel.com.ru` | Согласие ПДн |
| `pick.uchetn1.ru` `/pick` | Кладовщик |
| `/warehouse/cells` | План адресных ячеек (визуализация склада) |
| `photo.uchetn1.ru` `/photo` | Фотограф |
| `lift.uchetn1.ru` `/lift` | Подъёмник |
| `reception.uchetn1.ru` `/reception` | Приёмщик |
| `/supply`, `/in/scan` | Приёмка / скан |
| `swagger.uchetn1.ru` | OpenAPI (admin) |

DNS: `deploy/DNS-uchetn1.md`. React: CRM / sales / money / org / chats; операционка — `web/public/legacy.js`.

---

## Структура репозитория

```
api/          backend (Hono, SQLite, интеграции) → dist/
web/          React + legacy static → dist/
data/         SQLite (WMS_DATA_DIR), не в git
docs/         ТЗ, роадмап, журналы, брендбук, STO-DOCUMENTS, PAYMENT-LINK
deploy/       systemd, apache, DNS, amo1c-bin, deploy.sh
bin/          импорты 1С/PG, S3, утилиты каталога
tools/        выгрузки в Google Docs / Sheets
```

---

## Локально

```bash
npm ci
cp .env.example .env
npm run build          # api + web
npm start              # :3101, отдаёт web/dist
```

```bash
npm run build:api
npm run build:web
npm run dev:api        # :3101
npm run dev:web        # :5173, proxy /api → :3101
```

---

## Деплой

Предпочтительно **через git** (чистый `main`):

```bash
./deploy/deploy.sh
# push → GitHub origin + bare на bank-vps → post-receive: build + restart
```

Hotfix без коммита:

```bash
./deploy/deploy.sh --rsync
```

Прод-смоук на VPS: `curl -sS -o /dev/null -w "%{http_code}\n" http://127.0.0.1:3101/api/health` → `200`.

CI: `.github/workflows/deploy-prod.yml` (SSH на VPS при push в `main`).

### Swagger / OpenAPI

- https://swagger.uchetn1.ru (алиас `api-docs.uchetn1.ru`) → `/api/swagger`
- Spec: `/api/openapi.json`
- `SWAGGER_ENABLED=1`; доступ — сессия admin (иначе 403)
- Опционально Basic: `SWAGGER_BASIC_USER` / `SWAGGER_BASIC_PASS`
- Try-it-out только для GET

---

## Документация

| Файл | О чём |
|------|--------|
| `docs/VISION-uchet1.md` | Видение и коммерческий контур |
| `docs/ROADMAP-uchet1.md` | Роадмап / оценка |
| `docs/DONE-log-uchet1.md` | Журнал сделанного |
| `docs/TZ-ne-uchteno.md` + `docs/sections/` | ТЗ по разделам |
| `docs/STO-DOCUMENTS.md` | Бланки СТО, Drive, процесс |
| `docs/PAYMENT-LINK.md` | Ссылки на оплату |
| `docs/ATOL-CHECKS.md` | Чеки АТОЛ |
| `docs/TEST-sale-scenarios.md` | Чеклист сценариев ЖЦ |
| `docs/BRANDBOOK-uchet1.md` | Бренд |
| `docs/MAP-1C-UNF-to-uchet1.md` | Соответствие УНФ → Учёт №1 |
| `deploy/DNS-uchetn1.md` | DNS / HTTPS / ролевые хосты |

Очередь кейсов rubtsov.pro в этом репозитории **не ведётся** (локальная папка `.rubtsov/` в git не хранится).
