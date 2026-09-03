# Налоги, зарплата и Контур.Экстерн

Внутренний документ контура «Налоги и зарплата» в Учёте №1.

## Мультиорг

Все расчёты и отправки в контексте `organizations.id` (переключатель юрлица в экране / query `organization_id`).  
ИП Безматерных и контуры MRAER — равноправные записи в справочнике организаций.

## Модули API

| Путь | Назначение |
|------|------------|
| `api/src/tax/schema.ts` | таблицы `tax_*` / `payroll_*` |
| `api/src/tax/settings.ts` | режим УСН/НДС, ИФНС, СФР, thumbprint ЭЦП |
| `api/src/tax/calendar.ts` | календарь сдач/уплат |
| `api/src/tax/vat.ts` | книги НДС из УПД/СФ + черновик XML |
| `api/src/tax/usn-kudir.ts` | КУДиР, УСН, уведомления |
| `api/src/tax/payroll.ts` | начисление ЗП, НДФЛ, взносы |
| `api/src/tax/payroll-reports.ts` | 6‑НДФЛ / РСВ / ЕФС‑1 / перс. (черновик XML) |
| `api/src/tax/kontur.ts` | адаптер Контур.Экстерн |
| `api/src/tax/archive.ts` | эталоны PDF/XLS |
| `api/src/tax/routes.ts` | HTTP |

Права: `can_tax` / `can_payroll`, раздел меню `tax` (роли admin, accountant, manager).

## UI

Раздел **Налоги** в сайдбаре → `/tax` (`web/public/sections-tax.js`): календарь, НДС, УСН, зарплата, отчёты, отправки, архив, настройки.

## Эталоны (не в git)

Локальные пакеты клиента (Downloads: ИП Безматерных, КУДиР, книги покупок/продаж) — только для сверки.  
Загрузка в UI → `data/tax/{orgId}/archive/`. Копии с ПДн **не коммитить**.

## Контур.Экстерн — чеклист подключения

1. Заявка партнёра/API: https://kontur.ru/extern/api/razrabotchikam-po  
2. Получить `api-key`, `client_id`, `account_id`; тестовый контур.  
3. Привязать налогоплательщиков (ИП Безматерных + org MRAER) в кабинете Экстерна.  
4. ЭЦП: thumbprint в настройках org или `KONTUR_EXTERN_SIGNATURE_B64`.  
5. Сначала **тестовые ИФНС-роботы** (коды в docs Kontur, часто `0087` и др.), потом прод.  
6. Секреты только в `/etc/warehouse-wms.env` (см. `.env.example`).

Сценарий отправки ФНС: Create draft → Upload content → Add document → Add signature → Check → Prepare → Send (`deferred=true`) → опрос task/docflow.  
Док: https://developer.kontur.ru/Docs/extern-api/scenarios/FNS/report/send_report.html

Без ключей API работает **dry-run**: XML собирается локально, filing со статусом `dry_run`.

## Переменные окружения

```
KONTUR_EXTERN_API_KEY=
KONTUR_EXTERN_CLIENT_ID=
KONTUR_EXTERN_ACCOUNT_ID=
KONTUR_EXTERN_BASE_URL=https://extern-api.testkontur.ru
KONTUR_EXTERN_AUTH_URL=https://identity.testkontur.ru/connect/token
KONTUR_EXTERN_SCOPE=extern.api
KONTUR_EXTERN_TEST=1
# KONTUR_EXTERN_SIGNATURE_B64=
```

## Ограничения текущего инкремента

- XML деклараций — **каркас** (не финальный XSD ФНС текущего года); перед боевой отправкой заменить на актуальный формат.  
- Книги НДС строятся из `sales_docs` (upd/sf/invoice) и приходных; ручные правки — колонка `manual`.  
- Зарплата: оклад × рабочие дни; НДФЛ 13% без прогрессии 15% и вычетов (упрощение).  
- Подпись: серверный сценарий через API Add signature; клиентский плагин Контура — следующий шаг.
