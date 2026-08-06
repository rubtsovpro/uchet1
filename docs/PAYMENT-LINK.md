# Ссылка на оплату (промежуточный экран)

Публичная страница заказа для клиента: позиции, QR СБП, оплата картой, таймер резерва.

## URL

- Публично: **`https://pay.pnevmopodveska1.ru/pay/{token}`**
- Демо состояний: `https://pay.pnevmopodveska1.ru/pay-demo`
- JSON: `GET /api/public/pay/{token}` (на том же хосте)
- Poll: `POST|GET /api/public/pay/{token}/poll`
- Карта: `POST /api/public/pay/{token}/acquiring`
- Повторный резерв: `POST /api/public/pay/{token}/renew-reserve` (после истечения — проверка остатков + новая ссылка)
- Создать из сделки: `POST /api/crm/deals/{id}/payment-link`

Токен — случайный `base64url` (24 байта), не id сделки.

База ссылок: env `PAY_PUBLIC_URL` (по умолчанию `https://pay.pnevmopodveska1.ru`).  
Адрес расчётов в АТОЛ: тот же хост (`payment_address`).

Старый URL `https://1c.pnevmopodveska1.ru/pay/…` тоже работает, пока живёт прокси на `1c.`.

## Настройки

UI: **Настройки → Ссылка на оплату** (`/settings/payment-link`)

| Параметр | По умолчанию | Описание |
|----------|--------------|----------|
| `payment_link_timer_minutes` | **120** | Минут до снятия резерва (2 часа) |
| `payment_link_reserve_enabled` | true | Перенос на склад «Ожидание оплаты» |
| `payment_link_default_warehouse_id` | пусто | Предпочтительный склад-источник |

Хранение: `meta.ui_settings` (+ алиас API `/payment-link-settings`).

## Резерв

1. При создании ссылки — transfer на склад `WAIT-PAY` / «Ожидание оплаты» (создаётся сам).
2. Запись в `stock_reserves` (status `active`); в **Остатках** колонка «Резерв» / метка склада.
3. Cron каждую минуту: `GET/POST /api/cron/expire-payment-reserves` — по `expires_at` возврат на исходный склад, status `released` / ссылка `expired`.
4. При оплате (poll СБП / webhook / mark-paid) — ссылка `paid`, резерв `sold` (товар остаётся на WAIT-PAY до отгрузки).

## Эквайринг

Bank: `POST https://bank.pnevmopodveska1.ru/api/acquiring_create_payment.php`  
Live на **ИП Безматерных Роман Павлович** (`customerCode` `302943132`, `merchantId` `200000000041755`).  
Создаёт платёжную ссылку Точки (`merch.tochka.com`). Кнопка «Оплатить картой» на `/pay/{token}` ходит сюда.

## Яндекс Пэй / Сплит

Организация: [id.yandex.ru/org](https://id.yandex.ru/org) · кабинет: [pay.yandex.ru](https://pay.yandex.ru/)  
UI: **Настройки → Яндекс Пэй / Сплит** (`/settings/yandex-pay`)

| Параметр | Env / meta |
|----------|------------|
| Merchant ID | `YANDEX_PAY_MERCHANT_ID` |
| API Key | `YANDEX_PAY_API_KEY` (sandbox = merchant id) |
| Среда | `YANDEX_PAY_ENV` = `sandbox` \| `production` |
| Вкл. | `YANDEX_PAY_ENABLED=1` |

- Кнопка на `/pay/{token}` → `POST /api/public/pay/{token}/yandex-pay` → `paymentUrl`
- Callback URL в кабинете: `https://pay.pnevmopodveska1.ru/api/public/yandex-pay/webhook`
- Docs: [интеграция без SDK](https://pay.yandex.ru/docs/ru/custom/integration-guide-link.md)

## Правка состава на странице оплаты

Клиент на `/pay/{token}` может **уменьшить количество** или **убрать** товар со склада (не услуги).

- API: `PATCH /api/public/pay/{token}/items` · тело `{ "items": [{ "id": "<deal_item_id>", "qty": 1 }] }` (`qty: 0` = убрать)
- Увеличить выше исходного нельзя
- Пересчитываются сумма сделки, резерв WAIT-PAY, **новый QR СБП** и ссылка карты (старый QR помечается отменённым)
- Услуги в заказе не редактируются
- Новый QR выпускается до смены состава: если банк не ответил — заказ и старый QR без изменений
