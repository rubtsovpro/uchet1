/**
 * Яндекс Пэй + Сплит: создание заказа (paymentUrl) и webhook оплаты.
 * Кабинет: https://pay.yandex.ru/ · организация: https://id.yandex.ru/org
 * Docs: https://pay.yandex.ru/docs/ru/custom/integration-guide-link.md
 */
import { all, get, run } from './db.js';
import {
  getYandexPaySettings,
  getYandexPaySettingsForOrg,
  type YandexPaySettings,
} from './integration-settings.js';

function publicPayBaseUrl(): string {
  return (
    process.env.PAY_PUBLIC_URL ||
    process.env.WMS_PUBLIC_URL ||
    process.env.PUBLIC_BASE_URL ||
    'https://pay.pnevmopodveska1.ru'
  ).replace(/\/$/, '');
}

function paymentLinkPublicUrl(token: string): string {
  return `${publicPayBaseUrl()}/pay/${encodeURIComponent(token)}`;
}

function apiBase(env: string): string {
  return env === 'production'
    ? 'https://pay.yandex.ru/api/merchant/v1'
    : 'https://sandbox.pay.yandex.ru/api/merchant/v1';
}

function authKey(s: YandexPaySettings): string {
  if (s.env === 'production') return s.api_key || s.merchant_id;
  return s.api_key || s.merchant_id;
}

export function yandexPayConfigured(s?: YandexPaySettings | null): boolean {
  const cfg = s || getYandexPaySettings();
  if (!cfg) return false;
  if (!(cfg.enabled === '1' || cfg.enabled === 'true')) return false;
  return Boolean(cfg.merchant_id && authKey(cfg));
}

/** Доступен ли Сплит для юрлица ссылки на оплату. */
export function yandexPayAvailableForOrganization(organizationId?: string | null): boolean {
  const orgId = String(organizationId || '').trim();
  if (!orgId) {
    // без юрлица на ссылке — любой включённый профиль
    return yandexPayConfigured(getYandexPaySettings());
  }
  return yandexPayConfigured(getYandexPaySettingsForOrg(orgId));
}

function parseMethods(raw: string): string[] {
  const list = String(raw || '')
    .split(/[,;\s]+/)
    .map((x) => x.trim().toUpperCase())
    .filter((x) => x === 'CARD' || x === 'SPLIT');
  return list.length ? [...new Set(list)] : ['SPLIT'];
}

function moneyStr(n: number): string {
  return (Math.round((Number(n) || 0) * 100) / 100).toFixed(2);
}

export type YandexPayCartItem = {
  productId: string;
  title: string;
  quantity: number;
  total: number;
};

function dealItemsForYandex(dealId: string): YandexPayCartItem[] {
  const rows = all<{
    id: string;
    product_guid: string;
    name: string;
    sku: string;
    qty: number;
    price: number;
    amount: number;
  }>(
    `SELECT id, IFNULL(product_guid,'') AS product_guid, IFNULL(name,'') AS name,
            IFNULL(sku,'') AS sku, IFNULL(qty,0) AS qty, IFNULL(price,0) AS price,
            IFNULL(amount,0) AS amount
     FROM crm_deal_items WHERE deal_id = ?`,
    [dealId]
  );
  return rows.map((r) => ({
    productId: String(r.product_guid || r.id || 'item'),
    title: String(r.name || r.sku || 'Товар').slice(0, 200),
    quantity: Number(r.qty) || 1,
    total: Number(r.amount) || (Number(r.price) || 0) * (Number(r.qty) || 1),
  }));
}

export async function createYandexPayOrder(input: {
  orderId: string;
  amount: number;
  items: YandexPayCartItem[];
  successUrl: string;
  errorUrl: string;
  ttlSec?: number;
  settings?: YandexPaySettings | null;
}): Promise<{
  ok: boolean;
  paymentUrl?: string;
  orderId?: string;
  error?: string;
  raw?: unknown;
}> {
  const s = input.settings || getYandexPaySettings();
  if (!yandexPayConfigured(s)) {
    return {
      ok: false,
      error:
        'Яндекс Сплит не настроен для этого юрлица (Настройки → Интеграции → Яндекс Сплит)',
    };
  }
  const amount = Number(input.amount) || 0;
  if (!(amount > 0)) return { ok: false, error: 'Сумма должна быть больше нуля' };

  const items = (input.items || [])
    .filter((it) => Number(it.quantity) > 0)
    .map((it) => ({
      productId: String(it.productId || 'item').slice(0, 128),
      title: String(it.title || 'Товар').slice(0, 200),
      quantity: { count: String(Math.max(1, Math.round(Number(it.quantity) || 1))) },
      total: moneyStr(it.total),
    }));
  if (!items.length) {
    items.push({
      productId: 'order',
      title: `Заказ ${input.orderId}`,
      quantity: { count: '1' },
      total: moneyStr(amount),
    });
  }

  const body = {
    orderId: String(input.orderId).slice(0, 100),
    currencyCode: 'RUB',
    merchantId: s.merchant_id,
    availablePaymentMethods: parseMethods(s.payment_methods),
    cart: {
      items,
      total: { amount: moneyStr(amount) },
    },
    redirectUrls: {
      onSuccess: input.successUrl,
      onError: input.errorUrl,
    },
    ttl: Math.min(86400, Math.max(300, Number(input.ttlSec) || 7200)),
  };

  try {
    const res = await fetch(`${apiBase(s.env)}/orders`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Api-Key ${authKey(s)}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(45_000),
    });
    const rawText = await res.text();
    let raw: Record<string, unknown> = {};
    try {
      raw = JSON.parse(rawText) as Record<string, unknown>;
    } catch {
      return { ok: false, error: `Яндекс Пэй: не JSON (${res.status})`, raw: rawText.slice(0, 200) };
    }
    const data = (raw.data || raw) as Record<string, unknown>;
    const paymentUrl = String(data.paymentUrl || data.payment_url || '').trim();
    if (res.ok && paymentUrl) {
      return {
        ok: true,
        paymentUrl,
        orderId: String(data.orderId || input.orderId),
        raw,
      };
    }
    const errMsg =
      String(
        (raw as { reason?: string }).reason ||
          (data as { reason?: string }).reason ||
          (raw as { message?: string }).message ||
          ''
      ).trim() || `HTTP ${res.status}`;
    return { ok: false, error: `Яндекс Пэй: ${errMsg}`, raw };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? `Яндекс Пэй: ${e.message}` : 'Яндекс Пэй: ошибка сети',
    };
  }
}

export async function getYandexPayOrderStatus(
  orderId: string,
  settings?: YandexPaySettings | null
): Promise<{ ok: boolean; status?: string; raw?: unknown; error?: string }> {
  const s = settings || getYandexPaySettings();
  if (!s.merchant_id || !authKey(s)) {
    return { ok: false, error: 'не настроено' };
  }
  try {
    const res = await fetch(`${apiBase(s.env)}/orders/${encodeURIComponent(orderId)}`, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        Authorization: `Api-Key ${authKey(s)}`,
      },
      signal: AbortSignal.timeout(30_000),
    });
    const raw = (await res.json()) as Record<string, unknown>;
    const data = (raw.data || raw) as Record<string, unknown>;
    const status = String(data.paymentStatus || data.status || '').toUpperCase();
    return { ok: res.ok, status, raw };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'error' };
  }
}

/** Создать / вернуть ссылку Яндекс Пэй+Сплит для публичного токена оплаты. */
export async function ensureYandexPayForPublicToken(token: string): Promise<{
  ok: boolean;
  url?: string | null;
  error?: string;
  order_id?: string;
}> {
  const link = get<{
    id: string;
    token: string;
    deal_id: string;
    status: string;
    amount: number;
    timer_minutes: number;
    organization_id: string;
    yandex_pay_url: string;
    yandex_order_id: string;
  }>(
    `SELECT id, token, deal_id, status, amount, timer_minutes,
            IFNULL(organization_id,'') AS organization_id,
            IFNULL(yandex_pay_url,'') AS yandex_pay_url,
            IFNULL(yandex_order_id,'') AS yandex_order_id
     FROM payment_links WHERE token = ?`,
    [token]
  );
  if (!link) return { ok: false, error: 'not found' };
  if (String(link.status) !== 'pending') {
    return { ok: false, error: 'Ссылка уже не активна' };
  }
  if (String(link.yandex_pay_url || '').trim()) {
    return {
      ok: true,
      url: String(link.yandex_pay_url),
      order_id: String(link.yandex_order_id || ''),
    };
  }

  const linkOrg = String(link.organization_id || '').trim();
  const settings =
    (linkOrg ? getYandexPaySettingsForOrg(linkOrg) : null) ||
    (yandexPayConfigured(getYandexPaySettings()) ? getYandexPaySettings() : null);
  if (!yandexPayConfigured(settings)) {
    const err = linkOrg
      ? 'Яндекс Сплит не подключён для этого юрлица'
      : 'Яндекс Сплит не подключён (укажите юрлицо на ссылке и профиль в Интеграциях)';
    run(`UPDATE payment_links SET yandex_pay_error = ? WHERE id = ?`, [err, link.id]);
    return { ok: false, error: err, url: null };
  }

  // уникальный orderId при каждом создании (повтор после смены методов → 409 у Яндекса)
  const orderId = `wms-${link.deal_id}-${String(link.id).slice(0, 8)}-${Date.now().toString(36).slice(-6)}`;
  const returnBase = paymentLinkPublicUrl(token);
  const created = await createYandexPayOrder({
    orderId,
    amount: Number(link.amount) || 0,
    items: dealItemsForYandex(String(link.deal_id)),
    successUrl: `${returnBase}?yp=ok`,
    errorUrl: `${returnBase}?yp=err`,
    ttlSec: Math.max(300, (Number(link.timer_minutes) || 120) * 60),
    settings,
  });
  if (created.ok && created.paymentUrl) {
    run(
      `UPDATE payment_links
       SET yandex_pay_url = ?, yandex_order_id = ?, yandex_pay_error = ''
       WHERE id = ?`,
      [created.paymentUrl, created.orderId || orderId, link.id]
    );
    return { ok: true, url: created.paymentUrl, order_id: created.orderId || orderId };
  }
  const err = created.error || 'не удалось создать заказ Яндекс Пэй';
  run(`UPDATE payment_links SET yandex_pay_error = ? WHERE id = ?`, [err, link.id]);
  return { ok: false, error: err, url: null };
}

const PAID_STATUSES = new Set(['CAPTURED', 'SUCCESS', 'PAID', 'CONFIRMED']);

function dealIdFromYandexOrderId(orderId: string): string {
  const s = String(orderId || '').trim();
  if (!s) return '';
  const prefixed = s.match(/^(?:amo|wms)-(\d+)-/i);
  if (prefixed) return prefixed[1];
  const digits = s.match(/(\d{5,})/);
  return digits ? digits[1] : '';
}

/** Разбор тела webhook Яндекс Пэй (JWT payload или плоский JSON). */
export function parseYandexPayWebhookBody(body: Record<string, unknown>): {
  orderId: string;
  status: string;
} {
  const orderObj = (body.order ||
    (body.data as { order?: Record<string, unknown> } | undefined)?.order ||
    (typeof body.event === 'object' && body.event !== null
      ? (body.event as { order?: Record<string, unknown> }).order
      : undefined)) as { orderId?: string; paymentStatus?: string } | undefined;

  const orderId = String(
    body.orderId ||
      orderObj?.orderId ||
      (body.data as { orderId?: string } | undefined)?.orderId ||
      ''
  ).trim();

  const status = String(
    body.paymentStatus ||
      orderObj?.paymentStatus ||
      (body.data as { paymentStatus?: string } | undefined)?.paymentStatus ||
      body.status ||
      ''
  )
    .trim()
    .toUpperCase();

  return { orderId, status };
}

/** Webhook / ручная проверка статуса Яндекс Пэй → mark paid. */
export async function applyYandexPayPaymentEvent(input: {
  orderId?: string;
  status?: string;
  event?: Record<string, unknown>;
  settings?: YandexPaySettings | null;
}): Promise<{
  ok: boolean;
  marked?: boolean;
  deal_id?: string;
  error?: string;
  action?: string;
  payment_id?: string;
  amo?: unknown;
  automation?: unknown;
}> {
  let orderId = String(
    input.orderId ||
      input.event?.orderId ||
      (input.event?.data as { orderId?: string } | undefined)?.orderId ||
      ''
  ).trim();
  let status = String(input.status || '').toUpperCase();
  if ((!orderId || !status) && input.event) {
    const parsed = parseYandexPayWebhookBody(input.event);
    if (!orderId) orderId = parsed.orderId;
    if (!status) status = parsed.status;
  }
  if (!orderId) return { ok: false, error: 'orderId required' };

  if (!status) {
    const polled = await getYandexPayOrderStatus(orderId, input.settings);
    status = String(polled.status || '').toUpperCase();
  }
  if (!PAID_STATUSES.has(status)) {
    return { ok: true, marked: false };
  }

  const eventKey = `yandex:${orderId}:${status}`;
  const already = get<{ id: string }>(
    `SELECT id FROM deal_payments
     WHERE IFNULL(meta_json,'') LIKE ?
     LIMIT 1`,
    [`%"event_key":"${eventKey}"%`]
  );
  if (already?.id) {
    const dealId = dealIdFromYandexOrderId(orderId);
    let amo: Awaited<ReturnType<typeof import('./amo-deal-paid.js').pushDealPaidToAmo>> | undefined;
    if (dealId) {
      const { getDealBasketTotals, syncDealPaidStatus } = await import('./deal-payment-split.js');
      const existingPay = get<{ amount: number }>(
        'SELECT amount FROM deal_payments WHERE id = ?',
        [already.id]
      );
      let fixAmount = Number(existingPay?.amount) || 0;
      if (!(fixAmount > 0)) {
        const basket = getDealBasketTotals(dealId);
        if (basket.total > 0) {
          fixAmount = basket.total;
          run('UPDATE deal_payments SET amount = ? WHERE id = ?', [fixAmount, already.id]);
          syncDealPaidStatus(dealId);
        }
      }
      const { pushDealPaidToAmo } = await import('./amo-deal-paid.js');
      amo = await pushDealPaidToAmo({ dealId, source: 'yandex_split' });
      const { runPostPaymentAutomation } = await import('./post-payment-automation.js');
      await runPostPaymentAutomation({
        dealId,
        source: 'yandex_split',
        username: 'yandex_split',
        amount: fixAmount > 0 ? fixAmount : undefined,
        amoAlreadyPaid: amo?.ok === true && amo.already_paid === true,
      });
    }
    return {
      ok: true,
      marked: false,
      deal_id: dealId || undefined,
      action: 'duplicate',
      payment_id: already.id,
      amo,
    };
  }

  const link = get<{ id: string; deal_id: string; payment_id: string; status: string; amount: number }>(
    `SELECT id, deal_id, IFNULL(payment_id,'') AS payment_id, status, IFNULL(amount,0) AS amount
     FROM payment_links WHERE yandex_order_id = ?
     ORDER BY datetime(created_at) DESC LIMIT 1`,
    [orderId]
  );

  let dealId = link?.deal_id ? String(link.deal_id) : dealIdFromYandexOrderId(orderId);
  if (!dealId) return { ok: false, error: 'payment link not found' };

  const deal = get<{ id: string; name?: string; price?: number; paid?: number }>(
    `SELECT id, name, price, paid FROM crm_deals WHERE id = ?`,
    [dealId]
  );
  if (!deal) return { ok: false, error: 'deal_not_found', deal_id: dealId };

  let payAmount = link && Number(link.amount) > 0 ? Number(link.amount) : 0;
  if (!(payAmount > 0)) {
    payAmount = Number(deal.price) || 0;
  }
  if (!(payAmount > 0)) {
    const { getDealBasketTotals } = await import('./deal-payment-split.js');
    const basket = getDealBasketTotals(dealId);
    if (basket.total > 0) {
      payAmount = basket.total;
    }
  }

  const { newGuid } = await import('./ids.js');
  const { syncDealPaidStatus } = await import('./deal-payment-split.js');
  const { markPaymentLinkPaidForDeal } = await import('./payment-links.js');
  const { notifyDealResponsible } = await import('./staff-notifications.js');
  const { ensureWarehouseTaskAfterPaid } = await import('./sales-pipeline.js');
  const { ensureOrderDocChain } = await import('./order-doc-tree.js');

  const payId = newGuid();
  const purpose =
    `Яндекс Сплит · заказ ${dealId}` + (deal.name ? ` · ${String(deal.name).slice(0, 60)}` : '');
  const meta = {
    source: 'yandex_pay',
    event_key: eventKey,
    yandex_order_id: orderId,
    yandex_status: status,
  };
  run(
    `INSERT INTO deal_payments (
       id, deal_id, kind, amount, status, qrc_id, payload, image_png_base64, account, purpose, meta_json
     ) VALUES (?, ?, 'yandex_split', ?, 'paid', '', '', '', '', ?, ?)`,
    [payId, dealId, Math.max(0, payAmount), purpose, JSON.stringify(meta)]
  );

  try {
    markPaymentLinkPaidForDeal(dealId, 'yandex_pay');
  } catch {
    /* */
  }
  if (link && String(link.status) !== 'paid') {
    run(
      `UPDATE payment_links SET status = 'paid', paid_at = datetime('now') WHERE id = ? AND status = 'pending'`,
      [link.id]
    );
  }

  const synced = syncDealPaidStatus(dealId);
  if (synced.paid) {
    try {
      ensureWarehouseTaskAfterPaid({ dealId });
    } catch {
      /* */
    }
    try {
      ensureOrderDocChain(dealId);
    } catch {
      /* */
    }
  }

  notifyDealResponsible({
    deal_id: dealId,
    kind: 'deal_paid_yandex',
    title: 'Сделка оплачена · Яндекс Сплит',
    body: `Сделка ${deal.name || dealId} оплачена через Яндекс Сплит${
      payAmount > 0 ? ` · ${Math.round(payAmount).toLocaleString('ru-RU')} ₽` : ''
    }. Выбейте чек 1 (аванс) в Документах.`,
    meta: { yandex_order_id: orderId, payment_id: payId, status },
  });

  const { pushDealPaidToAmo } = await import('./amo-deal-paid.js');
  const amo = await pushDealPaidToAmo({ dealId, source: 'yandex_split' });

  const { runPostPaymentAutomation } = await import('./post-payment-automation.js');
  const automation = await runPostPaymentAutomation({
    dealId,
    source: 'yandex_split',
    username: 'yandex_split',
    amount: payAmount > 0 ? payAmount : undefined,
    amoAlreadyPaid: amo?.ok === true && amo.already_paid === true,
  });

  return {
    ok: true,
    marked: true,
    deal_id: dealId,
    action: 'marked_paid',
    payment_id: payId,
    amo,
    automation,
  };
}

/** Poll: если есть yandex_order_id — проверить статус у Яндекса. */
export async function pollYandexPayForLink(token: string): Promise<boolean> {
  const link = get<{
    yandex_order_id: string;
    status: string;
    organization_id: string;
  }>(
    `SELECT IFNULL(yandex_order_id,'') AS yandex_order_id, status,
            IFNULL(organization_id,'') AS organization_id
     FROM payment_links WHERE token = ?`,
    [token]
  );
  if (!link || String(link.status) !== 'pending') return false;
  const oid = String(link.yandex_order_id || '').trim();
  if (!oid) return false;
  const settings = getYandexPaySettingsForOrg(String(link.organization_id || '')) || undefined;
  const r = await applyYandexPayPaymentEvent({ orderId: oid, settings });
  return Boolean(r.marked);
}
