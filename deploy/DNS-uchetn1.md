# DNS и HTTPS — uchetn1.ru (ролевые экраны + Swagger)

VPS: `155.212.160.31` (bank-vps / tech35.fvds.ru).  
Регистратор/NS: Spaceweb (`ns1–4.spaceweb.*`).

## Статус (проверено dig @8.8.8.8 · 2026-07-19)

| Хост | DNS A → 155.212.160.31 | HTTPS (LE) | Landing | Apache ServerAlias | App host→screen |
|------|------------------------|------------|---------|--------------------|-----------------|
| `uchetn1.ru` | ✅ | ✅ apex+www | `/` (WMS) | ✅ | ✅ wms |
| `www.uchetn1.ru` | ✅ | ✅ | `/` (WMS) | ✅ | ✅ wms |
| `pick.uchetn1.ru` | ❌ нет A | ❌ | `/pick` | ✅ | ✅ pick |
| `photo.uchetn1.ru` | ❌ нет A | ❌ | `/photo` | ✅ | ✅ photo |
| `lift.uchetn1.ru` | ❌ нет A | ❌ | `/lift` | ✅ | ✅ lift |
| `reception.uchetn1.ru` | ❌ нет A | ❌ | `/reception` | ✅ | ✅ reception |
| `in.uchetn1.ru` | ❌ нет A | ❌ | `/reception` (алиас) | ✅ | ✅ reception |
| `swagger.uchetn1.ru` | ❌ нет A | ❌ | `/api/swagger` | ✅ (шаблон) | ✅ swagger |
| `api-docs.uchetn1.ru` | ❌ нет A | ❌ | `/api/swagger` (алиас) | ✅ (шаблон) | ✅ swagger |

**Блокер:** в DNS нет A-записей для ролевых поддоменов и swagger. Apache + Node готовы; certbot `--expand` — сразу после появления A.

Staff / полный WMS остаётся на `uchetn1.ru` (и live `1c.pnevmopodveska1.ru`).

## Добавить в DNS (Spaceweb) — обязательно

Все записи: тип **A**, значение **`155.212.160.31`**, TTL по умолчанию.

| Имя | Экран |
|-----|--------|
| `pick` | `/pick` кладовщик |
| `photo` | `/photo` фотограф |
| `lift` | `/lift` подъёмник |
| `reception` | `/reception` приёмщик |
| `in` | `/reception` (короткий алиас) |
| `swagger` | `/api/swagger` OpenAPI (только admin) |
| `api-docs` | то же (опциональный алиас) |

Уже есть: `@` и `www` → `155.212.160.31`.

Опционально вместо отдельных: `*` (wildcard) → `155.212.160.31`.

Пути на `1c.pnevmopodveska1.ru` (`/pick`, `/photo`, `/api/swagger`, …) продолжают работать.

## Оплата: pay.pnevmopodveska1.ru

| Хост | Назначение |
|------|------------|
| `pay.pnevmopodveska1.ru` | Публичные ссылки `/pay/{token}`, демо `/pay-demo` |

**DNS (Spaceweb):** A `pay` → `155.212.160.31`

**После появления A:**

```bash
ssh bank-vps
export PATH=/usr/sbin:/usr/bin:/bin:$PATH
certbot --apache -d pay.pnevmopodveska1.ru --non-interactive --agree-tos --redirect \
  -m admin@pnevmopodveska1.ru || certbot --apache -d pay.pnevmopodveska1.ru
# при необходимости дописать SSL-vhost из deploy/apache-pay-le-ssl.conf
apache2ctl configtest && systemctl reload apache2
```

Шаблоны: `deploy/apache-pay.conf`, `deploy/apache-pay-le-ssl.conf`.  
Env: `PAY_PUBLIC_URL=https://pay.pnevmopodveska1.ru` в `/etc/warehouse-wms.env`.

## Добавить в DNS (Spaceweb) — обязательно

- Основной: **https://swagger.uchetn1.ru/** → `/api/swagger`
- Короткие редиректы **только на swagger-хосте**: `/swagger`, `/docs` → `/api/swagger`
- Spec: `/api/openapi.json`
- Auth: логин WMS (`wms_sid`), роль admin / системный admin; иначе 403; без сессии → `/login?next=`
- Env: `SWAGGER_ENABLED=1` в `/etc/warehouse-wms.env`

## Путь `/docs` на uchetn1.ru / 1c.…

| URL | Что |
|-----|-----|
| `https://uchetn1.ru/docs` | **Расходные накладные** (WMS SPA) |
| `https://uchetn1.ru/amo-docs` | Документация API **amo1c** (бывший `/docs`) |
| `https://swagger.uchetn1.ru/` | OpenAPI Учёт №1 |

На apex **не** делать `ProxyPass /docs !` — иначе вместо расходных отдаётся статика amo1c.

## Внешний IP в аудите (не 127.0.0.1)

Цепочка: **HAProxy :443 (TCP/SNI) → nginx :4443 → (apache) → node :3101**.  
Без PROXY protocol nginx видит только `127.0.0.1`.

- HAProxy: `server nginx_ssl 127.0.0.1:4443 send-proxy-v2` (см. `deploy/haproxy-uchetn1-snippet.cfg`)
- nginx: `listen … proxy_protocol` + `real_ip_header proxy_protocol` (`deploy/nginx-uchetn1-ssl-mtu.conf`)
- API: `clientIpFromHeaders` берёт первый публичный IP из `X-Real-IP` / `X-Forwarded-For`

Старые записи аудита с `127.0.0.1` не переписываются — новый IP появится в новых действиях.

## Apache (шаблоны → VPS)

- HTTP: `/etc/apache2/sites-enabled/uchetn1.conf` — все ServerAlias + rewrite `/` → экран
- SSL: `/etc/apache2/sites-enabled/uchetn1-le-ssl.conf` — те же Alias + rewrite  
Локальные шаблоны: `deploy/apache-uchetn1-screens.conf`, `deploy/apache-uchetn1-screens-le-ssl.conf`.

После деплоя шаблонов на VPS:

```bash
ssh bank-vps
cp /root/1c_pnevmopodveska1_ru/warehouse/deploy/apache-uchetn1-screens.conf /etc/apache2/sites-available/uchetn1.conf
# SSL: смержить ServerAlias + rewrite в uchetn1-le-ssl.conf (не затирать пути сертификата)
apache2ctl configtest && systemctl reload apache2
```

## Certbot (после появления A в dig)

```bash
ssh bank-vps
certbot --apache --expand --non-interactive --agree-tos \
  -d uchetn1.ru -d www.uchetn1.ru \
  -d pick.uchetn1.ru -d photo.uchetn1.ru \
  -d lift.uchetn1.ru -d in.uchetn1.ru -d reception.uchetn1.ru \
  -d swagger.uchetn1.ru -d api-docs.uchetn1.ru
apache2ctl configtest && systemctl reload apache2
```

После успешного expand — расширить HTTP→HTTPS rewrite в `uchetn1.conf` на все имена из сертификата (сейчас редирект только для apex/www — пока нет LE на поддоменах).

Wildcard `*.uchetn1.ru` — только DNS-01 (API Spaceweb); обычно проще перечислить имена.

## Авторизация / UI

- Cookie `wms_sid` **без** `Domain=` → сессия своя на каждом хосте (на swagger нужно войти отдельно).
- После входа `home_path` = экран поддомена (`/pick`, `/photo`, `/api/swagger`, …).
- `/help`: четыре карточки → `https://pick|photo|reception|lift.uchetn1.ru`.
- Quick re-login: `localStorage.wms_last_user` на origin; форма «Продолжить как …» + PIN/пароль.
