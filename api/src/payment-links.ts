/**
 * Промежуточная ссылка на оплату: СБП QR + карта + таймер + резерв на «Ожидание оплаты».
 */
import { writeAudit } from './audit.js';
import { randomBytes } from 'node:crypto';
import { all, get, run } from './db.js';
import { newGuid } from './ids.js';
import { deleteDealItem, getDeal, updateDealItem } from './deals.js';
import { createCrmEvent, createCrmTask } from './menu-parity.js';
import { createDocument } from './stock.js';
import { createDealSbpQr, markDealPaymentPaid, pollPendingSbpPayments } from './payments.js';
import { getUiSettings, saveUiSettings } from './phone.js';
import { resolveOrganizationId } from './organizations.js';
import { telegramSendMessage } from './telegram.js';
import { pollYandexPayForLink, yandexPayAvailableForOrganization } from './yandex-pay.js';

export const WAIT_PAY_CODE = 'WAIT-PAY';
export const WAIT_PAY_NAME = 'Ожидание оплаты';
/** По умолчанию 2 часа — клиенту хватает согласовать / лимиты банка. */
export const DEFAULT_PAYMENT_LINK_TIMER_MINUTES = 120;
/** Максимум хранения резерва: 30 суток. */
export const MAX_PAYMENT_LINK_TIMER_MINUTES = 30 * 24 * 60;

export type PaymentLinkSettings = {
  payment_link_timer_minutes: number;
  payment_link_reserve_enabled: boolean;
  payment_link_default_warehouse_id: string;
  payment_link_default_organization_id: string;
};

export function getPaymentLinkSettings(): PaymentLinkSettings {
  const s = getUiSettings() as PaymentLinkSettings & { phone_format?: string };
  const mins = Number(s.payment_link_timer_minutes);
  return {
    payment_link_timer_minutes:
      Number.isFinite(mins) && mins > 0
        ? Math.min(Math.floor(mins), MAX_PAYMENT_LINK_TIMER_MINUTES)
        : DEFAULT_PAYMENT_LINK_TIMER_MINUTES,
    payment_link_reserve_enabled: s.payment_link_reserve_enabled !== false,
    payment_link_default_warehouse_id: String(s.payment_link_default_warehouse_id || ''),
    payment_link_default_organization_id: String(s.payment_link_default_organization_id || ''),
  };
}

export function savePaymentLinkSettings(patch: Partial<PaymentLinkSettings>): PaymentLinkSettings {
  const cur = getPaymentLinkSettings();
  const next: PaymentLinkSettings = { ...cur };
  if (patch.payment_link_timer_minutes != null) {
    const m = Math.floor(Number(patch.payment_link_timer_minutes));
    if (Number.isFinite(m) && m > 0) {
      next.payment_link_timer_minutes = Math.min(m, MAX_PAYMENT_LINK_TIMER_MINUTES);
    }
  }
  if (patch.payment_link_reserve_enabled != null) {
    next.payment_link_reserve_enabled = Boolean(patch.payment_link_reserve_enabled);
  }
  if (patch.payment_link_default_warehouse_id != null) {
    next.payment_link_default_warehouse_id = String(patch.payment_link_default_warehouse_id || '');
  }
  if (patch.payment_link_default_organization_id != null) {
    next.payment_link_default_organization_id = String(
      patch.payment_link_default_organization_id || ''
    );
  }
  saveUiSettings(next as Parameters<typeof saveUiSettings>[0]);
  return getPaymentLinkSettings();
}

export function ensureWaitingPaymentWarehouse(): { id: string; name: string; code: string } {
  const row = get<{ id: string; name: string; code: string }>(
    `SELECT id, name, code FROM warehouses
     WHERE code = ? OR name = ? LIMIT 1`,
    [WAIT_PAY_CODE, WAIT_PAY_NAME]
  );
  if (row) {
    run(`UPDATE warehouses SET is_active = 1, name = ?, code = ? WHERE id = ?`, [
      WAIT_PAY_NAME,
      WAIT_PAY_CODE,
      row.id,
    ]);
    return { id: row.id, name: WAIT_PAY_NAME, code: WAIT_PAY_CODE };
  }
  const id = newGuid();
  run(`INSERT INTO warehouses (id, name, code, is_active) VALUES (?, ?, ?, 1)`, [
    id,
    WAIT_PAY_NAME,
    WAIT_PAY_CODE,
  ]);
  return { id, name: WAIT_PAY_NAME, code: WAIT_PAY_CODE };
}

function newPublicToken(): string {
  return randomBytes(24).toString('base64url');
}

function resolveProductId(item: Record<string, unknown>): string | null {
  const guid = String(item.product_guid || item.product_id || '').trim();
  if (guid) {
    const byId = get<{ id: string }>('SELECT id FROM products WHERE id = ?', [guid]);
    if (byId) return byId.id;
  }
  const sku = String(item.sku || item.code || '').trim();
  if (sku) {
    const bySku = get<{ id: string }>('SELECT id FROM products WHERE sku = ? OR code = ? LIMIT 1', [
      sku,
      sku,
    ]);
    if (bySku) return bySku.id;
  }
  return null;
}

/** Склад-источник с достаточным остатком (кроме WAIT-PAY). */
function pickSourceWarehouse(
  productId: string,
  qty: number,
  preferredId: string,
  waitId: string
): string | null {
  if (preferredId && preferredId !== waitId) {
    const bal = get<{ qty: number }>(
      `SELECT qty FROM stock_balances WHERE warehouse_id = ? AND product_id = ?`,
      [preferredId, productId]
    );
    if (bal && Number(bal.qty) + 0.0001 >= qty) return preferredId;
  }
  const rows = all<{ warehouse_id: string; qty: number }>(
    `SELECT warehouse_id, qty FROM stock_balances
     WHERE product_id = ? AND warehouse_id != ? AND qty >= ?
     ORDER BY qty DESC LIMIT 5`,
    [productId, waitId, qty]
  );
  return rows[0]?.warehouse_id || null;
}

const WORK_NAME_RE =
  /(снять\/установить|проверить\/исправить|осмотр|диагностик|ремонт|регулир|замен[аы].*работ|н\/ч|нормочас|услуг)/i;

function isGoodsLine(it: Record<string, unknown>): boolean {
  const kind = String(it.line_kind || it.kind || it.item_kind || '').toLowerCase();
  if (kind === 'work' || kind === 'service') return false;
  const productId = String(it.product_guid || it.product_id || '').trim();
  if (productId) {
    const row = get<{ item_kind: string }>(
      `SELECT CASE WHEN IFNULL(item_kind,'product') = 'service' THEN 'service' ELSE 'product' END AS item_kind
       FROM products WHERE id = ?`,
      [productId]
    );
    if (row?.item_kind === 'service') return false;
  }
  const name = String(it.name || '');
  const sku = String(it.sku || it.code || '');
  if (WORK_NAME_RE.test(name) && !sku && !productId) return false;
  return true;
}

export type StockNeed = { productId: string; qty: number; name: string; sourceWh: string | null };

/** Проверка остатков по позициям сделки (услуги пропускаем). */
export function planDealStockNeeds(
  deal: Record<string, unknown>,
  preferredWh = ''
): { needs: StockNeed[]; missing: string[] } {
  const waitWh = ensureWaitingPaymentWarehouse();
  const items = (deal.items as Array<Record<string, unknown>>) || [];
  const needs: StockNeed[] = [];
  const missing: string[] = [];
  for (const it of items) {
    if (!isGoodsLine(it)) continue;
    const productId = resolveProductId(it);
    const qty = Number(it.qty || it.quantity || 0) || 0;
    if (!(qty > 0)) continue;
    if (!productId) {
      missing.push(`${String(it.name || it.sku || 'позиция')} × ${qty} (нет в номенклатуре)`);
      continue;
    }
    const lineWh = String(it.warehouse_id || '').trim();
    const sourceWh =
      lineWh || pickSourceWarehouse(productId, qty, preferredWh, waitWh.id);
    const name = String(it.name || it.sku || productId);
    needs.push({ productId, qty, name, sourceWh });
    if (!sourceWh) missing.push(`${name} × ${qty}`);
  }
  return { needs, missing };
}

/** Нельзя выставлять счёт / ссылку, если товара нет на складе. */
export function assertDealStockAvailable(dealId: string, preferredWh?: string): void {
  const deal = getDeal(dealId) as Record<string, unknown> | null;
  if (!deal) throw new Error('Сделка не найдена');
  const settings = getPaymentLinkSettings();
  const preferred =
    preferredWh || settings.payment_link_default_warehouse_id || '';
  const { missing } = planDealStockNeeds(deal, preferred);
  if (missing.length) {
    throw new Error(
      `Нет на складе — счёт / оплату выставить нельзя: ${missing.slice(0, 5).join('; ')}`
    );
  }
}

function publicBaseUrl(): string {
  return (
    process.env.PAY_PUBLIC_URL ||
    process.env.WMS_PUBLIC_URL ||
    process.env.PUBLIC_BASE_URL ||
    'https://pay.pnevmopodveska1.ru'
  ).replace(/\/$/, '');
}

export function paymentLinkPublicUrl(token: string): string {
  return `${publicBaseUrl()}/pay/${encodeURIComponent(token)}`;
}

function bankAcquiringUrl(): string {
  return (
    process.env.BANK_ACQUIRING_CREATE_URL ||
    'https://bank.pnevmopodveska1.ru/api/acquiring_create_payment.php'
  ).trim();
}

function bankSbpKey(): string {
  return (process.env.BANK_SBP_KEY || process.env.WMS_BANK_API_KEY || '').trim();
}

/** Попытка создать платёжную ссылку эквайринга Точки (если продукт не подключён — ошибка). */
export async function tryCreateAcquiringLink(input: {
  dealId: string;
  amount: number;
  purpose?: string;
  returnUrl?: string;
}): Promise<{ ok: boolean; url?: string; error?: string }> {
  const key = bankSbpKey();
  if (!key) {
    return { ok: false, error: 'эквайринг не подключён (нет BANK_SBP_KEY)' };
  }
  try {
    const res = await fetch(bankAcquiringUrl(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Wms-Key': key,
      },
      body: JSON.stringify({
        deal_id: input.dealId,
        amount: input.amount,
        purpose: input.purpose || `Оплата заказа ${input.dealId}`,
        return_url: input.returnUrl || '',
      }),
      signal: AbortSignal.timeout(45_000),
    });
    const raw = await res.text();
    let data: { ok?: boolean; url?: string; payment_url?: string; error?: string } = {};
    try {
      data = JSON.parse(raw) as typeof data;
    } catch {
      return {
        ok: false,
        error: `эквайринг не подключён (банк: не JSON ${res.status})`,
      };
    }
    const url = String(data.url || data.payment_url || '').trim();
    if (res.ok && data.ok && url) {
      return { ok: true, url };
    }
    return {
      ok: false,
      error: String(data.error || 'эквайринг не подключён'),
    };
  } catch (e) {
    return {
      ok: false,
      error:
        e instanceof Error
          ? `эквайринг не подключён (${e.message})`
          : 'эквайринг не подключён',
    };
  }
}

export function createPaymentLinkFromDeal(input: {
  dealId: string;
  timerMinutes?: number;
  reserve?: boolean;
  sourceWarehouseId?: string;
  organizationId?: string;
}): Promise<{
  link: Record<string, unknown>;
  url: string;
  payment: Record<string, unknown> | null;
  reserves: Array<Record<string, unknown>>;
  acquiring: { ok: boolean; url?: string; error?: string };
}> {
  return createPaymentLinkFromDealInner(input);
}

async function createPaymentLinkFromDealInner(input: {
  dealId: string;
  timerMinutes?: number;
  reserve?: boolean;
  sourceWarehouseId?: string;
  organizationId?: string;
}) {
  const deal = getDeal(input.dealId) as Record<string, unknown> | null;
  if (!deal) throw new Error('Сделка не найдена');
  // Юрлицо / ИП тоже могут платить картой / СБП по ссылке (альтернатива переводу по счёту).

  const settings = getPaymentLinkSettings();
  const organizationId = resolveOrganizationId(
    input.organizationId || settings.payment_link_default_organization_id
  );
  const timerMinutes =
    input.timerMinutes != null && Number(input.timerMinutes) > 0
      ? Math.min(Math.floor(Number(input.timerMinutes)), 24 * 60)
      : settings.payment_link_timer_minutes;
  const doReserve =
    input.reserve != null ? Boolean(input.reserve) : settings.payment_link_reserve_enabled;

  const amount = Number(deal.price) || 0;
  if (!(amount > 0)) {
    throw new Error('Сумма заказа 0 — укажите сумму или добавьте позиции');
  }

  // активная pending-ссылка → вернуть её
  const existing = get(
    `SELECT * FROM payment_links
     WHERE deal_id = ? AND status = 'pending'
       AND datetime(expires_at) > datetime('now')
     ORDER BY datetime(created_at) DESC LIMIT 1`,
    [input.dealId]
  ) as Record<string, unknown> | undefined;
  if (existing) {
    const payment = existing.payment_id
      ? get('SELECT * FROM deal_payments WHERE id = ?', [String(existing.payment_id)])
      : null;
    return {
      link: existing,
      url: paymentLinkPublicUrl(String(existing.token)),
      payment: payment as Record<string, unknown> | null,
      reserves: all(`SELECT * FROM stock_reserves WHERE payment_link_id = ?`, [
        String(existing.id),
      ]) as Array<Record<string, unknown>>,
      acquiring: {
        ok: Boolean(existing.acquiring_url),
        url: String(existing.acquiring_url || '') || undefined,
        error: String(existing.acquiring_error || '') || undefined,
      },
    };
  }

  const waitWh = ensureWaitingPaymentWarehouse();
  const preferredWh =
    String(input.sourceWarehouseId || settings.payment_link_default_warehouse_id || '').trim();

  type LineAgg = { productId: string; qty: number; sourceWh: string; name: string };
  const reservePlan: LineAgg[] = [];
  if (doReserve) {
    const items = (deal.items as Array<Record<string, unknown>>) || [];
    const missing: string[] = [];
    for (const it of items) {
      const productId = resolveProductId(it);
      const qty = Number(it.qty || it.quantity || 0) || 0;
      if (!(qty > 0)) continue;
      if (!productId) continue;
      const sourceWh = pickSourceWarehouse(productId, qty, preferredWh, waitWh.id);
      if (!sourceWh) {
        missing.push(`${String(it.name || it.sku || productId)} × ${qty}`);
        continue;
      }
      reservePlan.push({
        productId,
        qty,
        sourceWh,
        name: String(it.name || ''),
      });
    }
    if (missing.length) {
      throw new Error(`Нет остатка для резерва: ${missing.slice(0, 3).join('; ')}`);
    }
  }

  const payment = await createDealSbpQr({
    dealId: input.dealId,
    amount,
    ttlSec: timerMinutes * 60,
  });

  const id = newGuid();
  const token = newPublicToken();
  const expiresAt = new Date(Date.now() + timerMinutes * 60_000)
    .toISOString()
    .replace(/\.\d{3}Z$/, 'Z');

  const returnUrl = paymentLinkPublicUrl(token);
  const acquiring = await tryCreateAcquiringLink({
    dealId: input.dealId,
    amount,
    purpose: `Оплата заказа ${input.dealId}`,
    returnUrl,
  });

  const originalQtys: Record<string, number> = {};
  for (const it of ((deal.items as Array<Record<string, unknown>>) || [])) {
    const iid = String(it.id || '').trim();
    if (!iid) continue;
    originalQtys[iid] = Number(it.qty || it.quantity || 0) || 0;
  }

  run(
    `INSERT INTO payment_links (
       id, token, deal_id, status, amount, expires_at, timer_minutes,
       payment_id, acquiring_url, acquiring_error, meta_json, organization_id
     ) VALUES (?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      token,
      input.dealId,
      amount,
      expiresAt,
      timerMinutes,
      String((payment as { id?: string })?.id || ''),
      acquiring.ok ? String(acquiring.url || '') : '',
      acquiring.ok ? '' : String(acquiring.error || 'эквайринг не подключён'),
      JSON.stringify({
        wait_warehouse_id: waitWh.id,
        original_qtys: originalQtys,
      }),
      organizationId,
    ]
  );

  const reserves: Array<Record<string, unknown>> = [];
  if (reservePlan.length) {
    const bySource = new Map<string, LineAgg[]>();
    for (const a of reservePlan) {
      const list = bySource.get(a.sourceWh) || [];
      list.push(a);
      bySource.set(a.sourceWh, list);
    }

    for (const [sourceWh, lines] of bySource) {
      const merged = new Map<string, number>();
      for (const l of lines) {
        merged.set(l.productId, (merged.get(l.productId) || 0) + l.qty);
      }
      const docLines = [...merged.entries()].map(([product_id, qty]) => ({ product_id, qty }));
      const docId = createDocument({
        doc_type: 'transfer',
        warehouse_id: sourceWh,
        warehouse_to_id: waitWh.id,
        comment: `Резерв оплаты · сделка ${input.dealId} · ссылка ${id}`,
        organization_id: organizationId,
        lines: docLines,
        post: true,
      });
      for (const [productId, qty] of merged) {
        const rid = newGuid();
        run(
          `INSERT INTO stock_reserves (
             id, payment_link_id, deal_id, product_id, qty,
             source_warehouse_id, reserve_warehouse_id, status, stock_doc_id
           ) VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?)`,
          [rid, id, input.dealId, productId, qty, sourceWh, waitWh.id, docId]
        );
        reserves.push(
          get('SELECT * FROM stock_reserves WHERE id = ?', [rid]) as Record<string, unknown>
        );
      }
    }
  }

  const link = get('SELECT * FROM payment_links WHERE id = ?', [id]) as Record<string, unknown>;
  return {
    link,
    url: paymentLinkPublicUrl(token),
    payment: payment as Record<string, unknown> | null,
    reserves,
    acquiring,
  };
}

export function getPaymentLinkByToken(token: string) {
  return (
    (get('SELECT * FROM payment_links WHERE token = ?', [String(token || '').trim()]) as
      | Record<string, unknown>
      | undefined) || null
  );
}

export function listPaymentLinksForDeal(dealId: string) {
  return all(
    `SELECT id, token, status, amount, expires_at, timer_minutes, payment_id,
            acquiring_url, acquiring_error, created_at, paid_at, expired_at
     FROM payment_links WHERE deal_id = ? ORDER BY datetime(created_at) DESC LIMIT 20`,
    [dealId]
  );
}

function secondsLeft(expiresAt: string): number {
  const t = Date.parse(expiresAt);
  if (!Number.isFinite(t)) return 0;
  return Math.max(0, Math.floor((t - Date.now()) / 1000));
}

const SHIP_CHANNEL_LABELS: Record<string, string> = {
  cdek_prepaid: 'Доставка СДЭК',
  cdek_cod: 'СДЭК · наложенный платёж',
  pickup: 'Самовывоз / установка в сервисе',
  bus: 'Отправка автобусом',
  own_courier: 'Доставка курьером',
};

function publicDealNumber(deal: Record<string, unknown> | null, dealId: string): string {
  const id = String(dealId || '').trim();
  if (/^\d{4,}$/.test(id)) return id;
  const name = String(deal?.name || '');
  const m = name.match(/(?:№|#)\s*(\d{3,})/i) || name.match(/\b(\d{5,})\b/);
  if (m) return m[1];
  return id.replace(/[^a-zA-Z0-9]/g, '').slice(-8) || id.slice(0, 8);
}

function parseLinkMeta(link: Record<string, unknown>): {
  wait_warehouse_id?: string;
  original_qtys?: Record<string, number>;
} {
  try {
    const raw = String(link.meta_json || '{}');
    const parsed = JSON.parse(raw || '{}') as {
      wait_warehouse_id?: string;
      original_qtys?: Record<string, number>;
    };
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function ensureOriginalQtys(
  link: Record<string, unknown>,
  dealItems: Array<Record<string, unknown>>
): Record<string, number> {
  const meta = parseLinkMeta(link);
  if (meta.original_qtys && Object.keys(meta.original_qtys).length) {
    return meta.original_qtys;
  }
  const originalQtys: Record<string, number> = {};
  for (const it of dealItems) {
    const iid = String(it.id || '').trim();
    if (!iid) continue;
    originalQtys[iid] = Number(it.qty || it.quantity || 0) || 0;
  }
  const nextMeta = { ...meta, original_qtys: originalQtys };
  run(`UPDATE payment_links SET meta_json = ? WHERE id = ?`, [
    JSON.stringify(nextMeta),
    String(link.id),
  ]);
  return originalQtys;
}

function isStockLine(it: Record<string, unknown>): boolean {
  const kind = String(it.item_kind || 'product').toLowerCase();
  if (kind === 'service') return false;
  return Boolean(resolveProductId(it));
}

/** Публичное представление ссылки (без внутренних id склада как секрета — ок). */
export function getPublicPaymentLinkView(token: string) {
  const link = getPaymentLinkByToken(token);
  if (!link) return null;

  const dealId = String(link.deal_id);
  const deal = getDeal(dealId) as Record<string, unknown> | null;
  const paymentId = String(link.payment_id || '');
  const payment = paymentId
    ? (get(
        `SELECT id, kind, amount, status, qrc_id, payload,
                CASE WHEN length(image_png_base64)>0 THEN 1 ELSE 0 END AS has_image
         FROM deal_payments WHERE id = ?`,
        [paymentId]
      ) as Record<string, unknown> | undefined)
    : null;

  const dealItems = ((deal?.items as Array<Record<string, unknown>>) || []).slice();
  const originalQtys =
    String(link.status) === 'pending' ? ensureOriginalQtys(link, dealItems) : {};
  const editable =
    String(link.status) === 'pending' && secondsLeft(String(link.expires_at)) > 0;

  const items = dealItems.map((it) => {
    const id = String(it.id || '');
    const qty = Number(it.qty || it.quantity || 0) || 0;
    const stock = isStockLine(it);
    const maxQty = Math.max(qty, Number(originalQtys[id]) || qty);
    return {
      id,
      name: String(it.display_name || it.name_display || it.name || ''),
      sku: String(it.sku || ''),
      qty,
      max_qty: maxQty,
      price: Number(it.price || 0) || 0,
      amount: Number(it.amount || (Number(it.price) || 0) * qty) || 0,
      unit: String(it.unit || ''),
      item_kind: stock ? 'product' : String(it.item_kind || 'service'),
      editable: editable && stock && Boolean(id),
    };
  });

  const status = String(link.status);
  const expiresAt = String(link.expires_at);
  let left = secondsLeft(expiresAt);
  if (status !== 'pending') left = 0;

  const shipChannel = String(deal?.ship_channel || '').trim();
  const managerName = String(deal?.responsible_name || '').trim();
  const rid = String(deal?.responsible_user_id || '').trim();
  const manager = rid
    ? (get<{ email?: string; name?: string }>(
        `SELECT email, name FROM staff WHERE amo_id = ? LIMIT 1`,
        [rid]
      ) as { email?: string; name?: string } | undefined)
    : undefined;
  const managerEmail = String(manager?.email || '').trim();

  let phase: 'paid' | 'expired' | 'urgent' | 'pending' = 'pending';
  if (status === 'paid') phase = 'paid';
  else if (status === 'expired' || status === 'cancelled' || (status === 'pending' && left <= 0))
    phase = 'expired';
  else if (status === 'pending' && left > 0 && left <= 15 * 60) phase = 'urgent';

  return {
    token: String(link.token),
    status,
    phase,
    amount: Number(link.amount) || 0,
    expires_at: expiresAt,
    seconds_left: left,
    timer_minutes: Number(link.timer_minutes) || DEFAULT_PAYMENT_LINK_TIMER_MINUTES,
    deal_id: dealId,
    deal_number: publicDealNumber(deal, dealId),
    deal_name: String(deal?.name || '').slice(0, 120),
    ship_channel: shipChannel || null,
    ship_label: shipChannel ? SHIP_CHANNEL_LABELS[shipChannel] || shipChannel : null,
    manager: {
      name: managerName || String(manager?.name || '').trim() || null,
      email: managerEmail || null,
    },
    can_edit_items: editable && items.some((x) => x.editable),
    items,
    sbp: payment
      ? {
          payment_id: String(payment.id),
          status: String(payment.status || ''),
          qrc_id: String(payment.qrc_id || ''),
          payload: String(payment.payload || ''),
          has_image: Number(payment.has_image) === 1,
          // ?v= — чтобы браузер не показывал старый QR после смены суммы
          image_url:
            Number(payment.has_image) === 1
              ? `/api/public/pay/${encodeURIComponent(token)}/qr.png?v=${encodeURIComponent(String(payment.id))}`
              : null,
        }
      : null,
    acquiring: {
      available: Boolean(String(link.acquiring_url || '').trim()),
      url: String(link.acquiring_url || '').trim() || null,
      message: String(link.acquiring_error || '').trim() || null,
    },
    yandex_pay: {
      available:
        Boolean(String(link.yandex_pay_url || '').trim()) ||
        (yandexPayAvailableForOrganization(String(link.organization_id || '')) &&
          status === 'pending'),
      url: String(link.yandex_pay_url || '').trim() || null,
      order_id: String(link.yandex_order_id || '').trim() || null,
      message: String(link.yandex_pay_error || '').trim() || null,
      configured: yandexPayAvailableForOrganization(String(link.organization_id || '')),
    },
    paid_at: link.paid_at || null,
    expired_at: link.expired_at || null,
  };
}

/** Частично вернуть резерв WAIT-PAY → исходный склад (когда клиент уменьшил qty). */
function releaseReserveDelta(
  link: Record<string, unknown>,
  productId: string,
  deltaQty: number
): void {
  if (!(deltaQty > 0) || !productId) return;
  const reserves = all(
    `SELECT * FROM stock_reserves
     WHERE payment_link_id = ? AND product_id = ? AND status = 'active'
     ORDER BY datetime(created_at) ASC`,
    [String(link.id), productId]
  ) as Array<{
    id: string;
    qty: number;
    source_warehouse_id: string;
    reserve_warehouse_id: string;
  }>;
  let left = deltaQty;
  for (const r of reserves) {
    if (!(left > 0)) break;
    const have = Number(r.qty) || 0;
    if (!(have > 0)) continue;
    const take = Math.min(have, left);
    try {
      createDocument({
        doc_type: 'transfer',
        warehouse_id: r.reserve_warehouse_id,
        warehouse_to_id: r.source_warehouse_id,
        comment: `Правка оплаты · снятие резерва · ссылка ${link.id}`,
        organization_id: String(link.organization_id || ''),
        lines: [{ product_id: productId, qty: take }],
        post: true,
      });
    } catch (e) {
      console.warn('[payment-links] releaseReserveDelta failed', e);
    }
    const nextQty = Math.round((have - take) * 1000) / 1000;
    if (nextQty <= 0.0001) {
      run(
        `UPDATE stock_reserves SET status = 'released', qty = 0, released_at = datetime('now')
         WHERE id = ?`,
        [r.id]
      );
    } else {
      run(`UPDATE stock_reserves SET qty = ? WHERE id = ?`, [nextQty, r.id]);
    }
    left -= take;
  }
}

/**
 * Клиент на /pay: уменьшить qty или убрать товар из наличия.
 * Увеличивать нельзя. Услуги не трогаем. Пересчёт суммы + новый QR СБП.
 */
export async function updatePublicPaymentLinkItems(
  token: string,
  patches: Array<{ id?: string; qty?: number }>
): Promise<
  | { ok: true; view: NonNullable<ReturnType<typeof getPublicPaymentLinkView>> }
  | { ok: false; error: string; status?: number }
> {
  const link = getPaymentLinkByToken(token);
  if (!link) return { ok: false, error: 'not found', status: 404 };
  if (String(link.status) !== 'pending') {
    return { ok: false, error: 'Ссылка уже не активна', status: 400 };
  }
  if (secondsLeft(String(link.expires_at)) <= 0) {
    expirePaymentLink(String(link.id), 'timer');
    return { ok: false, error: 'Время оплаты истекло', status: 400 };
  }

  const dealId = String(link.deal_id);
  const deal = getDeal(dealId) as Record<string, unknown> | null;
  if (!deal) return { ok: false, error: 'Сделка не найдена', status: 404 };

  const dealItems = ((deal.items as Array<Record<string, unknown>>) || []).slice();
  const originalQtys = ensureOriginalQtys(link, dealItems);
  const byId = new Map(dealItems.map((it) => [String(it.id), it]));

  if (!Array.isArray(patches) || !patches.length) {
    return { ok: false, error: 'Нет изменений', status: 400 };
  }

  const changes: Array<{ id: string; from: number; to: number; name: string }> = [];

  for (const p of patches) {
    const id = String(p.id || '').trim();
    if (!id || !byId.has(id)) {
      return { ok: false, error: 'Позиция не найдена', status: 400 };
    }
    const it = byId.get(id)!;
    if (!isStockLine(it)) {
      return { ok: false, error: 'Услуги менять нельзя — только товары со склада', status: 400 };
    }
    const cur = Number(it.qty || 0) || 0;
    const maxQ = Number(originalQtys[id]) || cur;
    let next = Number(p.qty);
    if (!Number.isFinite(next) || next < 0) {
      return { ok: false, error: 'Некорректное количество', status: 400 };
    }
    next = Math.round(next * 1000) / 1000;
    if (next > maxQ + 1e-9) {
      return {
        ok: false,
        error: `Нельзя увеличить «${String(it.name || '').slice(0, 40)}» выше ${maxQ}`,
        status: 400,
      };
    }
    if (Math.abs(next - cur) < 1e-9) continue;
    changes.push({ id, from: cur, to: next, name: String(it.name || '') });
  }

  if (!changes.length) {
    const view = getPublicPaymentLinkView(token);
    if (!view) return { ok: false, error: 'not found', status: 404 };
    return { ok: true, view };
  }

  // Сначала считаем новую сумму и выпускаем QR — состав сделки трогаем только после успеха банка
  const changeById = new Map(changes.map((c) => [c.id, c]));
  let newAmount = 0;
  for (const it of dealItems) {
    const id = String(it.id || '');
    const ch = changeById.get(id);
    const qty = ch ? ch.to : Number(it.qty || 0) || 0;
    if (qty <= 0) continue;
    const price = Number(it.price || 0) || 0;
    const lineAmt = Number(it.amount);
    if (ch) {
      newAmount += Math.round(price * qty * 100) / 100;
    } else if (Number.isFinite(lineAmt) && lineAmt > 0) {
      newAmount += lineAmt;
    } else {
      newAmount += Math.round(price * qty * 100) / 100;
    }
  }
  newAmount = Math.round(newAmount * 100) / 100;
  if (!(newAmount > 0)) {
    return {
      ok: false,
      error: 'В заказе должна остаться хотя бы одна позиция с суммой',
      status: 400,
    };
  }

  const leftSec = secondsLeft(String(link.expires_at));
  const prevPaymentId = String(link.payment_id || '');
  let paymentId = prevPaymentId;
  try {
    const payment = await createDealSbpQr({
      dealId,
      amount: newAmount,
      purpose: `Оплата заказа ${dealId}`,
      ttlSec: Math.max(60, leftSec),
    });
    paymentId = String((payment as { id?: string })?.id || '');
    if (!paymentId) throw new Error('Банк не вернул платёж');
  } catch (e) {
    console.warn('[payment-links] recreate SBP after edit failed', e);
    return {
      ok: false,
      error:
        'Не удалось обновить QR под новую сумму. Попробуйте ещё раз через минуту.',
      status: 502,
    };
  }

  for (const ch of changes) {
    const it = byId.get(ch.id)!;
    const productId = resolveProductId(it);
    if (ch.to <= 0) {
      const del = deleteDealItem(dealId, ch.id);
      if (!del.ok) return { ok: false, error: del.error, status: 400 };
      if (productId) releaseReserveDelta(link, productId, ch.from);
    } else {
      const upd = updateDealItem(dealId, ch.id, { qty: ch.to });
      if (!upd.ok) return { ok: false, error: upd.error, status: 400 };
      if (productId && ch.to < ch.from) {
        releaseReserveDelta(link, productId, ch.from - ch.to);
      }
    }
  }

  // Старый QR больше не принимаем — иначе можно оплатить устаревшую сумму
  if (prevPaymentId && prevPaymentId !== paymentId) {
    run(
      `UPDATE deal_payments SET status = 'cancelled'
       WHERE id = ? AND status NOT IN ('paid','confirmed','success')`,
      [prevPaymentId]
    );
  }

  const acquiring = await tryCreateAcquiringLink({
    dealId,
    amount: newAmount,
    purpose: `Оплата заказа ${dealId}`,
    returnUrl: paymentLinkPublicUrl(token),
  });

  run(
    `UPDATE payment_links SET amount = ?, payment_id = ?,
       acquiring_url = ?, acquiring_error = ?
     WHERE id = ?`,
    [
      newAmount,
      paymentId,
      acquiring.ok ? String(acquiring.url || '') : '',
      acquiring.ok ? '' : String(acquiring.error || ''),
      String(link.id),
    ]
  );

  writeAudit({
    action: 'pay.items_edit',
    entity: 'payment_link',
    entityId: String(link.id),
    summary: `Клиент изменил состав оплаты · ${newAmount} ₽`,
    actor: null,
    path: '/api/public/pay/.../items',
    meta: { changes, amount: newAmount },
  });

  const view = getPublicPaymentLinkView(token);
  if (!view) return { ok: false, error: 'not found', status: 404 };
  return { ok: true, view };
}

export function getPublicPaymentQrPng(token: string): Buffer | null {
  const link = getPaymentLinkByToken(token);
  if (!link?.payment_id) return null;
  const row = get<{ image_png_base64?: string }>(
    `SELECT image_png_base64 FROM deal_payments WHERE id = ?`,
    [String(link.payment_id)]
  );
  if (!row?.image_png_base64) return null;
  return Buffer.from(String(row.image_png_base64), 'base64');
}

/** Пометить ссылку оплаченной и резервы — sold (товар остаётся на WAIT-PAY до отгрузки). */
export function markPaymentLinkPaidForDeal(dealId: string, source = 'payment') {
  const links = all<{ id: string }>(
    `SELECT id FROM payment_links WHERE deal_id = ? AND status = 'pending'`,
    [dealId]
  );
  for (const l of links) {
    run(
      `UPDATE payment_links SET status = 'paid', paid_at = datetime('now') WHERE id = ?`,
      [l.id]
    );
    run(
      `UPDATE stock_reserves SET status = 'sold', released_at = datetime('now')
       WHERE payment_link_id = ? AND status = 'active'`,
      [l.id]
    );
  }
  return { deal_id: dealId, links: links.length, source };
}

export function markPaymentLinkPaidByPaymentId(paymentId: string) {
  const link = get<{ id: string; deal_id: string }>(
    `SELECT id, deal_id FROM payment_links WHERE payment_id = ? AND status = 'pending'`,
    [paymentId]
  );
  if (!link) return null;
  return markPaymentLinkPaidForDeal(link.deal_id, 'payment_id');
}

/** Вернуть товар с WAIT-PAY на исходный склад, снять резерв. */
export function expirePaymentLink(linkId: string, reason = 'timer') {
  const link = get('SELECT * FROM payment_links WHERE id = ?', [linkId]) as
    | Record<string, unknown>
    | undefined;
  if (!link) return null;
  if (String(link.status) !== 'pending') return link;

  const reserves = all(
    `SELECT * FROM stock_reserves WHERE payment_link_id = ? AND status = 'active'`,
    [linkId]
  ) as Array<{
    id: string;
    product_id: string;
    qty: number;
    source_warehouse_id: string;
    reserve_warehouse_id: string;
  }>;

  const bySource = new Map<string, Array<{ product_id: string; qty: number; id: string }>>();
  for (const r of reserves) {
    const key = r.source_warehouse_id;
    const list = bySource.get(key) || [];
    list.push({ product_id: r.product_id, qty: Number(r.qty), id: r.id });
    bySource.set(key, list);
  }

  for (const [sourceWh, lines] of bySource) {
    const waitId = reserves[0]?.reserve_warehouse_id;
    if (!waitId) continue;
    const merged = new Map<string, number>();
    for (const l of lines) {
      merged.set(l.product_id, (merged.get(l.product_id) || 0) + l.qty);
    }
    let docId = '';
    try {
      docId = createDocument({
        doc_type: 'transfer',
        warehouse_id: waitId,
        warehouse_to_id: sourceWh,
        comment: `Снятие резерва оплаты (${reason}) · ссылка ${linkId}`,
        organization_id: String(link.organization_id || ''),
        lines: [...merged.entries()].map(([product_id, qty]) => ({ product_id, qty })),
        post: true,
      });
    } catch (e) {
      // если на WAIT-PAY уже нет qty — всё равно закрываем резерв
      console.warn('[payment-links] return transfer failed', e);
    }
    for (const l of lines) {
      run(
        `UPDATE stock_reserves SET status = 'released', return_doc_id = ?, released_at = datetime('now')
         WHERE id = ?`,
        [docId, l.id]
      );
    }
  }

  run(
    `UPDATE payment_links SET status = 'expired', expired_at = datetime('now') WHERE id = ?`,
    [linkId]
  );
  return get('SELECT * FROM payment_links WHERE id = ?', [linkId]);
}

/** Cron: истекшие pending → возврат резерва. */
export function expireDuePaymentLinks(limit = 50): {
  ok: boolean;
  expired: number;
  items: Array<{ id: string; deal_id: string; token: string }>;
} {
  const due = all<{ id: string; deal_id: string; token: string }>(
    `SELECT id, deal_id, token FROM payment_links
     WHERE status = 'pending' AND datetime(expires_at) <= datetime('now')
     ORDER BY datetime(expires_at) ASC LIMIT ?`,
    [Math.min(Math.max(limit, 1), 200)]
  );
  const items: Array<{ id: string; deal_id: string; token: string }> = [];
  for (const row of due) {
    expirePaymentLink(row.id, 'timer');
    items.push(row);
  }
  return { ok: true, expired: items.length, items };
}

/**
 * Публично: после истечения резерва — проверить остатки в учёте и снова зарезервировать
 * (новая ссылка /pay с таймером и QR).
 */
export async function renewPublicPaymentReserve(token: string): Promise<
  | {
      ok: true;
      available: true;
      url: string;
      token: string;
      view: NonNullable<ReturnType<typeof getPublicPaymentLinkView>>;
    }
  | {
      ok: true;
      available: false;
      missing: string[];
      message: string;
      view: NonNullable<ReturnType<typeof getPublicPaymentLinkView>> | null;
    }
  | { ok: false; error: string; status?: number }
> {
  const link = getPaymentLinkByToken(token);
  if (!link) return { ok: false, error: 'not found', status: 404 };

  const status = String(link.status || '');
  if (status === 'paid') {
    return { ok: false, error: 'Заказ уже оплачен', status: 400 };
  }

  // ещё активна — просто вернуть текущую
  if (status === 'pending' && secondsLeft(String(link.expires_at)) > 0) {
    const view = getPublicPaymentLinkView(token);
    if (!view) return { ok: false, error: 'not found', status: 404 };
    return {
      ok: true,
      available: true,
      url: paymentLinkPublicUrl(token),
      token,
      view,
    };
  }

  // добить истечение, если pending просрочен
  if (status === 'pending') {
    expirePaymentLink(String(link.id), 'timer');
  }

  const dealId = String(link.deal_id);
  const deal = getDeal(dealId) as Record<string, unknown> | null;
  if (!deal) return { ok: false, error: 'Сделка не найдена', status: 404 };

  // антиспам: не чаще раза в 45 сек с этой ссылки
  let meta: Record<string, unknown> = {};
  try {
    meta = JSON.parse(String(link.meta_json || '{}') || '{}') as Record<string, unknown>;
  } catch {
    meta = {};
  }
  const lastRenew = Date.parse(String(meta.last_renew_at || ''));
  if (Number.isFinite(lastRenew) && Date.now() - lastRenew < 45_000) {
    return {
      ok: false,
      error: 'Подождите немного и нажмите ещё раз',
      status: 429,
    };
  }

  const settings = getPaymentLinkSettings();
  const preferred = settings.payment_link_default_warehouse_id || '';
  const { missing } = planDealStockNeeds(deal, preferred);
  const viewOld = getPublicPaymentLinkView(token);

  if (missing.length) {
    writeAudit({
      action: 'pay.renew_unavailable',
      entity: 'payment_link',
      entityId: String(link.id),
      summary: `Нет наличия для повторного резерва · сделка ${dealId}`,
      actor: null,
      path: '/api/public/pay/.../renew-reserve',
      meta: { missing: missing.slice(0, 10) },
    });
    return {
      ok: true,
      available: false,
      missing: missing.slice(0, 8),
      message:
        'Товара сейчас нет в нужном количестве. Напишите менеджеру — подберём альтернативу или сообщим, когда появится.',
      view: viewOld,
    };
  }

  try {
    const created = await createPaymentLinkFromDeal({
      dealId,
      reserve: true,
      organizationId: String(link.organization_id || '') || undefined,
    });
    const newToken = String(created.link.token || '');
    run(
      `UPDATE payment_links SET meta_json = ? WHERE id = ?`,
      [
        JSON.stringify({ ...meta, last_renew_at: new Date().toISOString() }),
        String(link.id),
      ]
    );
    writeAudit({
      action: 'pay.renew_reserve',
      entity: 'payment_link',
      entityId: String(created.link.id),
      summary: `Повторный резерв после проверки наличия · сделка ${dealId}`,
      actor: null,
      path: '/api/public/pay/.../renew-reserve',
      meta: { from_token: token, new_token: newToken },
    });
    const view = getPublicPaymentLinkView(newToken);
    if (!view) return { ok: false, error: 'Ссылка создана, но не открывается', status: 500 };
    return {
      ok: true,
      available: true,
      url: created.url,
      token: newToken,
      view,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Не удалось зарезервировать';
    return { ok: false, error: msg, status: 400 };
  }
}

/** Публичный poll: статус оплаты по токену (+ опрос Точки). */
export async function pollPublicPaymentLink(token: string) {
  const link = getPaymentLinkByToken(token);
  if (!link) return null;

  if (String(link.status) === 'pending') {
    const left = secondsLeft(String(link.expires_at));
    if (left <= 0) {
      expirePaymentLink(String(link.id), 'timer');
    } else if (link.payment_id || link.deal_id) {
      try {
        await pollPendingSbpPayments({ dealId: String(link.deal_id), limit: 5 });
      } catch {
        /* ignore poll errors for public */
      }
      // markDealPaymentPaid hook inside poll → markPaymentLinkPaid
      const refreshed = getPaymentLinkByToken(token);
      if (refreshed && String(refreshed.status) === 'pending') {
        const deal = get<{ paid?: number; payment_status?: string }>(
          `SELECT paid, payment_status FROM crm_deals WHERE id = ?`,
          [String(link.deal_id)]
        );
        if (
          Number(deal?.paid) === 1 ||
          ['paid', 'оплачен', 'оплачено'].includes(
            String(deal?.payment_status || '').toLowerCase()
          )
        ) {
          markPaymentLinkPaidForDeal(String(link.deal_id), 'deal_paid');
        }
      }
      try {
        await pollYandexPayForLink(token);
      } catch {
        /* */
      }
    }
  }

  return getPublicPaymentLinkView(token);
}

export async function ensureAcquiringForPublicToken(token: string) {
  const link = getPaymentLinkByToken(token);
  if (!link) return null;
  if (String(link.status) !== 'pending') {
    return {
      ok: false,
      error: 'Ссылка уже не активна',
      url: String(link.acquiring_url || '') || null,
    };
  }
  if (String(link.acquiring_url || '').trim()) {
    return { ok: true, url: String(link.acquiring_url) };
  }
  const r = await tryCreateAcquiringLink({
    dealId: String(link.deal_id),
    amount: Number(link.amount) || 0,
    returnUrl: paymentLinkPublicUrl(token),
  });
  if (r.ok && r.url) {
    run(
      `UPDATE payment_links SET acquiring_url = ?, acquiring_error = '' WHERE id = ?`,
      [r.url, String(link.id)]
    );
    return { ok: true, url: r.url };
  }
  const err = r.error || 'эквайринг не подключён';
  run(`UPDATE payment_links SET acquiring_error = ? WHERE id = ?`, [err, String(link.id)]);
  return { ok: false, error: err, url: null };
}

/** Суммы активного резерва по товарам на складе WAIT-PAY (для остатков). */
export function reservedQtyByProductWarehouse(): Map<string, number> {
  const rows = all<{ product_id: string; reserve_warehouse_id: string; qty: number }>(
    `SELECT product_id, reserve_warehouse_id, SUM(qty) AS qty
     FROM stock_reserves WHERE status = 'active'
     GROUP BY product_id, reserve_warehouse_id`
  );
  const map = new Map<string, number>();
  for (const r of rows) {
    map.set(`${r.reserve_warehouse_id}:${r.product_id}`, Number(r.qty) || 0);
  }
  return map;
}

export function isWaitingPaymentWarehouse(idOrCode: string): boolean {
  const w = get<{ id: string; code: string; name: string }>(
    `SELECT id, code, name FROM warehouses WHERE id = ? OR code = ?`,
    [idOrCode, idOrCode]
  );
  if (!w) return false;
  return w.code === WAIT_PAY_CODE || w.name === WAIT_PAY_NAME;
}

/**
 * Вопрос клиента со страницы оплаты → примечание в сделку + задача ответственному.
 */
export async function submitPublicPayQuestion(
  token: string,
  input: { text?: string; contact_name?: string; contact_phone?: string }
): Promise<
  | { ok: true; task_id: string; event_id: string }
  | { ok: false; error: string; status?: number }
> {
  const link = getPaymentLinkByToken(token);
  if (!link) return { ok: false, error: 'not found', status: 404 };

  const text = String(input.text || '')
    .trim()
    .replace(/\s+/g, ' ')
    .slice(0, 2000);
  if (text.length < 3) return { ok: false, error: 'Напишите вопрос (минимум 3 символа)', status: 400 };

  const dealId = String(link.deal_id);
  const recent = get<{ c: number }>(
    `SELECT COUNT(*) AS c FROM crm_events
     WHERE deal_id = ? AND kind = 'pay_question'
       AND datetime(event_at) >= datetime('now', '-1 hour')`,
    [dealId]
  );
  if ((Number(recent?.c) || 0) >= 8) {
    return {
      ok: false,
      error: 'Слишком много сообщений. Подождите немного или дождитесь ответа менеджера.',
      status: 429,
    };
  }

  const deal = getDeal(dealId) as Record<string, unknown> | null;
  const dealNumber = publicDealNumber(deal, dealId);
  const assignee = String(deal?.responsible_user_id || '').trim();
  const contactName = String(input.contact_name || '').trim().slice(0, 120);
  const contactPhone = String(input.contact_phone || '').trim().slice(0, 40);
  const contactBits = [contactName, contactPhone].filter(Boolean).join(', ');

  const title = `Вопрос по оплате · заказ №${dealNumber}`;
  const comment = [
    text,
    contactBits ? `Контакт: ${contactBits}` : '',
    `Ссылка оплаты: ${String(link.token).slice(0, 8)}…`,
  ]
    .filter(Boolean)
    .join('\n');

  const event = createCrmEvent({
    kind: 'pay_question',
    title,
    deal_id: dealId,
    comment,
  }) as { id?: string };

  const due = new Date(Date.now() + 60 * 60_000).toISOString();
  const task = createCrmTask({
    title: `Ответить клиенту · заказ №${dealNumber}`,
    status: 'open',
    due_at: due,
    deal_id: dealId,
    comment,
    assignee_amo_id: assignee,
    source: 'pay_page',
    payment_link_id: String(link.id),
  }) as { id?: string };

  writeAudit({
    action: 'pay.question',
    entity: 'payment_link',
    entityId: String(link.id),
    summary: `Вопрос по заказу №${dealNumber}`,
    actor: null,
    path: '/api/public/pay/.../question',
    meta: { contact: contactBits || null, from: 'pay_page' },
  });

  if (assignee) {
    const staff = get<{ telegram_chat_id?: string; name?: string }>(
      `SELECT telegram_chat_id, name FROM staff WHERE amo_id = ? LIMIT 1`,
      [assignee]
    );
    const chatId = String(staff?.telegram_chat_id || '').trim();
    if (chatId) {
      const msg =
        `❓ Вопрос по оплате\nЗаказ №${dealNumber}\n\n${text}` +
        (contactBits ? `\n\nКонтакт: ${contactBits}` : '');
      void telegramSendMessage(chatId, msg).catch(() => undefined);
    }
  }

  return {
    ok: true,
    task_id: String(task?.id || ''),
    event_id: String(event?.id || ''),
  };
}
