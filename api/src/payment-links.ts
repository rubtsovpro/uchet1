/**
 * Промежуточная ссылка на оплату: СБП QR + карта + таймер.
 * Резерв на «Ожидание оплаты» больше не делаем.
 */
import { resolveAmoBranchForDeal } from './amo-deal-branch.js';
import { writeAudit } from './audit.js';
import { randomBytes } from 'node:crypto';
import { all, get, run } from './db.js';
import { newGuid } from './ids.js';
import { deleteDealItem, getDeal, updateDealItem, dealShipFieldsReady, organizationIdForDealRecord } from './deals.js';
import { cashAcceptedOnSite } from './deal-sale-rules.js';
import { createCrmEvent, createCrmTask } from './menu-parity.js';
import { createDocument } from './stock.js';
import { getDealPaymentSplit } from './deal-payment-split.js';
import { createDealSbpQr, markDealPaymentPaid, pollPendingSbpPayments } from './payments.js';
import { digitsOnly, getUiSettings, saveUiSettings } from './phone.js';
import { resolveOrganizationId, getOrganization } from './organizations.js';
import { telegramSendMessage } from './telegram.js';
import { notifyDealResponsible } from './staff-notifications.js';
import { pollYandexPayForLink, yandexPayAvailableForOrganization } from './yandex-pay.js';
import { sendTargetSms, smsSenderForOrg, targetsmsConfigured } from './targetsms.js';
import { INN_BMP } from './sto-sites.js';

export {
  dealNeedsCodStockReserve,
  dealNeedsStoStockReserve,
  dealNeedsClientStockReserve,
  ensureDealClientStockReserve,
  markDealStockReservesSold,
  releaseDealStockReserves,
  reserveStockForCodDeal,
  reserveStockForStoDeal,
  reserveStockForDeal,
  reserveStockForInvoice,
} from './stock-reserve.js';

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
    // Резерв WAIT-PAY отключён: товар при ссылке / счёте не бронируем.
    payment_link_reserve_enabled: false,
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
  // Игнорируем включение: WAIT-PAY больше не используем.
  next.payment_link_reserve_enabled = false;
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

/** Первое фото товара из product_media (публичный URL S3). */
function productThumbUrl(productId: string | null): string {
  if (!productId) return '';
  const row = get<{ url: string }>(
    `SELECT url FROM product_media
     WHERE product_id = ? AND kind = 'image' AND IFNULL(url,'') != ''
     ORDER BY sort_order ASC, synced_at ASC
     LIMIT 1`,
    [productId]
  );
  return String(row?.url || '').trim();
}

/** Склад-источник с достаточным остатком (кроме WAIT-PAY). */
export function pickSourceWarehouse(
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
  const st = getDealInvoiceStockStatus(dealId, preferredWh);
  if (!st.ok) {
    throw new Error(
      `Нет на складе — счёт / оплату выставить нельзя: ${st.missing.slice(0, 5).join('; ')}`
    );
  }
}

/** Активный резерв по сделке (ссылка оплаты или счёт юрлица). */
export function dealActiveReserveQtyByProduct(dealId: string): Map<string, number> {
  const rows = all<{ product_id: string; qty: number }>(
    `SELECT product_id, qty FROM stock_reserves
     WHERE deal_id = ? AND status = 'active'`,
    [dealId]
  );
  const m = new Map<string, number>();
  for (const r of rows) {
    const pid = String(r.product_id || '');
    if (!pid) continue;
    m.set(pid, (m.get(pid) || 0) + (Number(r.qty) || 0));
  }
  return m;
}

/**
 * Готовность к счёту: есть свободный остаток (резерв WAIT-PAY больше не требуется).
 */
export function getDealInvoiceStockStatus(
  dealId: string,
  preferredWh?: string
): {
  ok: boolean;
  reserved: boolean;
  missing: string[];
  needs_count: number;
  reserves: Array<Record<string, unknown>>;
} {
  const deal = getDeal(dealId) as Record<string, unknown> | null;
  if (!deal) {
    return { ok: false, reserved: false, missing: ['Сделка не найдена'], needs_count: 0, reserves: [] };
  }
  const settings = getPaymentLinkSettings();
  const preferred =
    preferredWh || settings.payment_link_default_warehouse_id || '';
  const waitWh = ensureWaitingPaymentWarehouse();
  const { needs } = planDealStockNeeds(deal, preferred);
  const reservedMap = dealActiveReserveQtyByProduct(dealId);
  const missing: string[] = [];
  let fullyReserved = needs.length > 0;
  for (const n of needs) {
    const have = reservedMap.get(n.productId) || 0;
    if (have + 0.0001 >= n.qty) continue;
    fullyReserved = false;
    const still = Math.round((n.qty - have) * 1000) / 1000;
    const wh = pickSourceWarehouse(n.productId, still, preferred, waitWh.id);
    if (!wh) missing.push(`${n.name} × ${still}`);
  }
  if (!needs.length) fullyReserved = false;
  const reserves = all(
    `SELECT * FROM stock_reserves WHERE deal_id = ? AND status = 'active'
     ORDER BY datetime(created_at) DESC`,
    [dealId]
  ) as Array<Record<string, unknown>>;
  return {
    ok: missing.length === 0,
    reserved: fullyReserved && missing.length === 0,
    missing,
    needs_count: needs.length,
    reserves,
  };
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

/**
 * Та же публичная оплата, что виджет Amo: pay…/?l={leadId}
 * (QR / карта / рассрочка на PHP-форме, не /pay/{token} Учёта).
 */
export function amoWidgetPayUrl(opts: {
  dealId: string;
  inn?: string | null;
  companyCode?: string | null;
  companyName?: string | null;
  organizationId?: string | null;
}): string {
  const dealId = String(opts.dealId || '').trim();
  if (!dealId) return '';
  let brand: 'fogel' | 'pnevmo' = 'pnevmo';
  const orgId = String(opts.organizationId || '').trim();
  if (orgId) {
    const org = getOrganization(orgId);
    if (org) {
      const inn = String(org.inn || '').replace(/\D/g, '');
      const code = String(org.code || org.name || org.short_name || '')
        .toLowerCase()
        .replace(/ё/g, 'е');
      if (inn === INN_BMP || /fogel|фогел|strela|стрел/.test(code)) brand = 'fogel';
    }
  } else {
    const inn = String(opts.inn || '').replace(/\D/g, '');
    const code = String(opts.companyCode || opts.companyName || '')
      .toLowerCase()
      .replace(/ё/g, 'е');
    if (inn === INN_BMP || /fogel|фогел|strela|стрел/.test(code)) brand = 'fogel';
  }
  const tpl =
    brand === 'fogel'
      ? String(process.env.PAY_FOGEL_WIDGET_URL || 'https://pay.fogel.com.ru/?l={deal_id}').trim()
      : String(
          process.env.PAY_PNEVMO_WIDGET_URL ||
            process.env.PAY_WIDGET_URL ||
            'https://pay.pnevmopodveska1.ru/?l={deal_id}'
        ).trim();
  return tpl
    .replace(/\{deal_id\}/gi, encodeURIComponent(dealId))
    .replace(/\{lead_id\}/gi, encodeURIComponent(dealId));
}

/** Фогель / Краснодар: ссылка на оплату без резерва на WAIT-PAY (самовывоз / СТО). */
export function isFogelBranchDeal(deal: Record<string, unknown> | null | undefined): boolean {
  if (!deal) return false;
  const branch = resolveAmoBranchForDeal(deal).toLowerCase().replace(/ё/g, 'е');
  if (/фогель|fogel/.test(branch)) return true;
  const sto = String(deal.amo_sto || '')
    .toLowerCase()
    .replace(/ё/g, 'е');
  if (/фогель|fogel/.test(sto)) return true;
  const orgId = String(deal.org_company_id || '').trim();
  if (orgId) {
    const org = getOrganization(orgId);
    if (org) {
      const inn = String(org.inn || '').replace(/\D/g, '');
      const code = String(org.code || org.name || org.short_name || '')
        .toLowerCase()
        .replace(/ё/g, 'е');
      if (inn === INN_BMP && /фогель|fogel|стрел|strela|краснодар/.test(code)) return true;
    }
  }
  return false;
}

function phoneForPaymentSms(raw: unknown): string {
  const d = digitsOnly(raw);
  if (d.length === 11 && d.startsWith('7')) return d;
  if (d.length === 11 && d.startsWith('8')) return `7${d.slice(1)}`;
  if (d.length === 10) return `7${d}`;
  throw new Error('Укажите мобильный телефон заказчика (+7…)');
}

function maskPhoneSms(phone: string): string {
  const d = digitsOnly(phone);
  if (d.length < 10) return '***';
  return `+${d.slice(0, 1)} (${d.slice(1, 4)}) ***-**-${d.slice(-2)}`;
}

/**
 * Создать/взять активную ссылку на оплату и отправить клиенту SMS (TargetSMS).
 * Отправитель: Fogel / Pnevmo1 по организации сделки.
 */
export async function sendPaymentLinkSms(input: {
  dealId: string;
  organizationId?: string;
}): Promise<{
  ok: true;
  url: string;
  sms_id: string;
  phone_masked: string;
  sender: string;
  created: boolean;
  link: Record<string, unknown> | null;
  source: 'wms' | 'amo_widget';
}> {
  if (!targetsmsConfigured()) {
    throw new Error('SMS временно недоступна (TargetSMS не настроен)');
  }
  const dealId = String(input.dealId || '').trim();
  const deal = getDeal(dealId) as Record<string, unknown> | null;
  if (!deal) throw new Error('Сделка не найдена');

  const before = get(
    `SELECT id FROM payment_links
     WHERE deal_id = ? AND status = 'pending'
       AND datetime(expires_at) > datetime('now')
     ORDER BY datetime(created_at) DESC LIMIT 1`,
    [dealId]
  ) as { id?: string } | undefined;

  let url = '';
  let createdFlag = false;
  let link: Record<string, unknown> | null = null;
  let source: 'wms' | 'amo_widget' = 'amo_widget';
  let orgId = String(input.organizationId || '').trim();

  try {
    const created = await createPaymentLinkFromDeal({
      dealId,
      organizationId: input.organizationId,
    });
    url = String(created.url || '').trim();
    link = created.link;
    createdFlag = !before?.id;
    source = 'wms';
    orgId = String(created.link.organization_id || orgId || '').trim();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/ПДн|заказ-наряд|госномер|распечата|ЗН\b|юрлицо|ИП — оплата|Сумма заказа|уже оплачен/i.test(msg)) {
      throw e instanceof Error ? e : new Error(msg);
    }
    /* технический сбой Учёта → та же ссылка, что виджет Amo */
    url = amoWidgetPayUrl({
      dealId,
      organizationId: orgId || undefined,
    });
    source = 'amo_widget';
  }
  if (!url) {
    url = amoWidgetPayUrl({ dealId, organizationId: orgId || undefined });
    source = 'amo_widget';
  }
  if (!url) throw new Error('Не удалось получить ссылку на оплату');

  const phone = phoneForPaymentSms(deal.buyer_phone);
  const org = orgId ? getOrganization(orgId) : undefined;
  const sender = smsSenderForOrg({
    inn: org?.inn,
    companyCode: org?.code,
    companyName: org?.name || org?.short_name,
  });
  const amount = Number(link?.amount) || Number(deal.price) || 0;
  const amountLabel =
    amount > 0
      ? ` ${Math.round(amount).toLocaleString('ru-RU')} ₽`
      : '';
  const smsText = `Оплата заказа${amountLabel}: ${url}`;
  const sent = await sendTargetSms({
    phone,
    text: smsText,
    sender,
    nameDelivery: `pay-link-${dealId.slice(0, 24)}`,
  });
  if (!sent.ok) throw new Error(sent.error);

  writeAudit({
    action: 'deal.payment_link_sms',
    entity: 'crm_deal',
    entityId: dealId,
    summary: `SMS ссылка на оплату → ${maskPhoneSms(phone)} (${sender}, ${source})`,
    after: { url, sms_id: sent.sms_id, sender, source },
  });

  return {
    ok: true,
    url,
    sms_id: sent.sms_id,
    phone_masked: maskPhoneSms(phone),
    sender,
    created: createdFlag,
    link,
    source,
  };
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
  customerCode?: string;
}): Promise<{ ok: boolean; url?: string; operation_id?: string; error?: string }> {
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
        ...(String(input.customerCode || '').trim()
          ? { customer_code: String(input.customerCode).trim() }
          : {}),
      }),
      signal: AbortSignal.timeout(45_000),
    });
    const raw = await res.text();
    let data: {
      ok?: boolean;
      url?: string;
      payment_url?: string;
      operation_id?: string;
      error?: string;
    } = {};
    try {
      data = JSON.parse(raw) as typeof data;
    } catch {
      return {
        ok: false,
        error: `эквайринг не подключён (банк: не JSON ${res.status})`,
      };
    }
    const url = String(data.url || data.payment_url || '').trim();
    const operationId = String(data.operation_id || '').trim();
    if (res.ok && data.ok && url) {
      return { ok: true, url, operation_id: operationId || undefined };
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

function mergePaymentLinkMeta(linkId: string, patch: Record<string, unknown>) {
  const row = get<{ meta_json: string }>(
    `SELECT IFNULL(meta_json,'') AS meta_json FROM payment_links WHERE id = ?`,
    [linkId]
  );
  let meta: Record<string, unknown> = {};
  try {
    meta = row?.meta_json ? (JSON.parse(row.meta_json) as Record<string, unknown>) : {};
  } catch {
    meta = {};
  }
  run(`UPDATE payment_links SET meta_json = ? WHERE id = ?`, [
    JSON.stringify({ ...meta, ...patch }),
    linkId,
  ]);
}

/** Снять все pending-ссылки, когда заказ уже оплачен (не создавать повторно QR). */
export function expirePendingPaymentLinksForDeal(dealId: string, reason = 'already_paid') {
  const id = String(dealId || '').trim();
  if (!id) return { expired: 0 };
  const pending = all<{ id: string }>(
    `SELECT id FROM payment_links WHERE deal_id = ? AND status = 'pending'`,
    [id]
  );
  for (const row of pending) {
    expirePaymentLink(String(row.id), reason);
  }
  return { expired: pending.length };
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
  const splitGuard = getDealPaymentSplit(input.dealId);
  if (
    splitGuard.fully_paid ||
    Number(deal.paid) === 1 ||
    String(deal.payment_status || '').toLowerCase() === 'paid'
  ) {
    expirePendingPaymentLinksForDeal(input.dealId, 'already_paid');
    throw new Error('Заказ уже оплачен — ссылка не нужна');
  }
  // Компания в Amo / юр / ИП / партнёр ≠ блокер: ссылка (QR · карта · Сплит) доступна всем.
  // Безнал по счёту — отдельно в документах, не вместо ссылки.
  const shipReady = dealShipFieldsReady(deal);
  if (!shipReady.ok) {
    throw new Error(
      'При канале «Отправка» сначала укажите: ' + shipReady.missing.join(' и ')
    );
  }

  // Резерв на «Ожидание оплаты» отключён — ссылка только на оплату.
  const settings = getPaymentLinkSettings();
  const organizationId = organizationIdForDealRecord(
    deal,
    input.organizationId || settings.payment_link_default_organization_id
  );
  const payOrg = getOrganization(organizationId);
  const customerCode = String(payOrg?.code || '').trim();
  const timerMinutes =
    input.timerMinutes != null && Number(input.timerMinutes) > 0
      ? Math.min(Math.floor(Number(input.timerMinutes)), 24 * 60)
      : settings.payment_link_timer_minutes;

  const split = getDealPaymentSplit(input.dealId);
  const due = Number(split?.due_total) || 0;
  const amount = due > 0.009 ? due : Number(deal.price) || 0;
  if (!(amount > 0.009)) {
    throw new Error(
      due <= 0.009 && Number(deal.price) > 0
        ? 'Заказ уже оплачен — ссылка не нужна'
        : 'Сумма заказа 0 — укажите сумму или добавьте позиции'
    );
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

  // ЗН / форма покупателя (физ·юр) не блокируют ссылку. Резерв WAIT-PAY не делаем.

  const payment = await createDealSbpQr({
    dealId: input.dealId,
    amount,
    ttlSec: timerMinutes * 60,
    organizationId,
    customerCode: customerCode || undefined,
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
    customerCode: customerCode || undefined,
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
        original_qtys: originalQtys,
        reserve_disabled: true,
        ...(acquiring.ok && acquiring.operation_id
          ? { acquiring_operation_id: acquiring.operation_id }
          : {}),
      }),
      organizationId,
    ]
  );

  const link = get('SELECT * FROM payment_links WHERE id = ?', [id]) as Record<string, unknown>;
  return {
    link,
    url: paymentLinkPublicUrl(token),
    payment: payment as Record<string, unknown> | null,
    reserves: [] as Array<Record<string, unknown>>,
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
  avito_cod: 'Авито доставка · оплата при получении',
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
    const productId = resolveProductId(it);
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
      image_url: productThumbUrl(productId),
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
    can_edit_items: false,
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
    /** Т‑Банк Forma · публичная форма рассрочки (new_serv / rassrochka). */
    tbank_installment: (() => {
      const tpl = String(process.env.TBANK_INSTALLMENT_URL || '').trim() ||
        'https://rassrochka.pnevmopodveska1.ru/?l={deal_id}';
      const url = tpl
        .replace(/\{deal_id\}/gi, encodeURIComponent(dealId))
        .replace(/\{lead_id\}/gi, encodeURIComponent(dealId));
      return {
        available: Boolean(dealId) && status === 'pending',
        url: dealId ? url : null,
        label: 'Т‑Банк · рассрочка',
      };
    })(),
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
      newAmount += Math.round(price * qty);
    } else if (Number.isFinite(lineAmt) && lineAmt > 0) {
      newAmount += lineAmt;
    } else {
      newAmount += Math.round(price * qty);
    }
  }
  newAmount = Math.round(newAmount);
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
  if (acquiring.ok && acquiring.operation_id) {
    mergePaymentLinkMeta(String(link.id), {
      acquiring_operation_id: acquiring.operation_id,
    });
  }

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

  // Резерв WAIT-PAY отключён: уведомление «Снят с резерва» только если реально
  // снимали active stock_reserves (старые ссылки). Истёкшая ссылка без резерва — тихо.
  const dealId = String(link.deal_id || '').trim();
  if (dealId && reserves.length > 0 && (reason === 'timer' || reason === 'expired')) {
    const deal = get<{ name?: string }>('SELECT name FROM crm_deals WHERE id = ?', [dealId]);
    const mins = Number(link.timer_minutes) || DEFAULT_PAYMENT_LINK_TIMER_MINUTES;
    const dealLabel = String(deal?.name || '').trim() || dealId;
    try {
      notifyDealResponsible({
        deal_id: dealId,
        kind: 'reserve_released',
        title: 'Снят с резерва · нет оплаты',
        body: `Заказ ${dealLabel}: резерв WAIT-PAY снят по таймеру (${mins} мин) — оплата не поступила.`,
        href: `/deals/${encodeURIComponent(dealId)}`,
        meta: { payment_link_id: linkId, reason, timer_minutes: mins },
      });
    } catch (e) {
      console.warn('[payment-links] notify on expire failed', e);
    }
  }

  return get('SELECT * FROM payment_links WHERE id = ?', [linkId]);
}

/** Cron: истекшие pending-ссылки → expired; возврат со склада WAIT-PAY только если ещё был active-резерв (новые ссылки резерв не держат). */
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
    if (r.operation_id) {
      mergePaymentLinkMeta(String(link.id), {
        acquiring_operation_id: r.operation_id,
      });
    }
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

export type ActiveReserveOrder = {
  deal_id: string;
  deal_name: string;
  qty: number;
  created_at: string;
  sales_doc_id: string;
  payment_link_id: string;
};

/**
 * Активные резервы WAIT-PAY по парам товар+склад — для ссылок на заказы покупателей.
 */
export function activeReserveOrdersForPairs(
  pairs: Array<{ product_id: string; warehouse_id: string }>
): Map<string, ActiveReserveOrder[]> {
  const map = new Map<string, ActiveReserveOrder[]>();
  const uniq = new Map<string, { product_id: string; warehouse_id: string }>();
  for (const p of pairs) {
    const productId = String(p.product_id || '').trim();
    const warehouseId = String(p.warehouse_id || '').trim();
    if (!productId || !warehouseId) continue;
    uniq.set(`${warehouseId}\0${productId}`, { product_id: productId, warehouse_id: warehouseId });
  }
  if (!uniq.size) return map;

  // Один запрос по всем активным резервам нужных пар (страница остатков небольшая).
  const rows = all<{
    product_id: string;
    reserve_warehouse_id: string;
    deal_id: string;
    deal_name: string;
    qty: number;
    created_at: string;
    sales_doc_id: string;
    payment_link_id: string;
  }>(
    `SELECT sr.product_id, sr.reserve_warehouse_id, sr.deal_id,
            IFNULL(d.name, '') AS deal_name,
            sr.qty, IFNULL(sr.created_at, '') AS created_at,
            IFNULL(sr.sales_doc_id, '') AS sales_doc_id,
            IFNULL(sr.payment_link_id, '') AS payment_link_id
     FROM stock_reserves sr
     LEFT JOIN crm_deals d ON d.id = sr.deal_id
     WHERE sr.status = 'active'
     ORDER BY datetime(sr.created_at) ASC`
  );
  const want = uniq;
  for (const r of rows) {
    const key = `${r.reserve_warehouse_id}\0${r.product_id}`;
    if (!want.has(key)) continue;
    const dealId = String(r.deal_id || '').trim();
    if (!dealId) continue;
    const list = map.get(key) || [];
    const existing = list.find((x) => x.deal_id === dealId);
    if (existing) {
      existing.qty = Math.round((existing.qty + (Number(r.qty) || 0)) * 1000) / 1000;
      if (r.created_at && (!existing.created_at || r.created_at < existing.created_at)) {
        existing.created_at = r.created_at;
      }
      if (!existing.sales_doc_id && r.sales_doc_id) existing.sales_doc_id = r.sales_doc_id;
      if (!existing.payment_link_id && r.payment_link_id) {
        existing.payment_link_id = r.payment_link_id;
      }
    } else {
      list.push({
        deal_id: dealId,
        deal_name: String(r.deal_name || '').trim(),
        qty: Number(r.qty) || 0,
        created_at: String(r.created_at || '').trim(),
        sales_doc_id: String(r.sales_doc_id || '').trim(),
        payment_link_id: String(r.payment_link_id || '').trim(),
      });
    }
    map.set(key, list);
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
