/**
 * АТОЛ Онлайн — чеки: предоплата, полный расчёт, возврат (sell_refund).
 * Без login/pass/group — режим prepared (черновик payload).
 * Credentials: meta.integration_atol или ATOL_* в env.
 */
import { all, get, run } from './db.js';
import { newGuid } from './ids.js';
import { getDeal, ensureDealBuyerContactFromAmo, normalizeDealPhone } from './deals.js';
import { getDealPaymentSplit } from './deal-payment-split.js';
import { getOrgProfile } from './sales-docs.js';
import {
  getAtolSettings,
  getAtolSettingsForDeal,
  listAtolProfileKeys,
  resolveAtolProfileKey,
  type AtolProfileKey,
  type AtolSettings,
} from './integration-settings.js';
import { organizationIdForDealRecord } from './deals.js';
import { pushFiscalNoteToAmo } from './amo-fiscal-note.js';

/** Чек продажи или возврата. */
export type FiscalKind = 'advance' | 'full' | 'refund' | 'refund_advance';

const SELL_KINDS = new Set(['advance', 'full']);
const REFUND_KINDS = new Set(['refund', 'refund_advance']);

export function atolConfigured(cfg: AtolSettings = getAtolSettings()): boolean {
  return Boolean(cfg.login && cfg.pass && cfg.group_code);
}

async function notifyFiscalAmoNote(
  dealId: string,
  kind: string,
  receipt: Record<string, unknown> | null | undefined,
  source = 'wms'
): Promise<void> {
  if (!receipt || typeof receipt !== 'object') return;
  const status = String(receipt.status || '').trim();
  if (status === 'prepared' && !String(receipt.atol_uuid || '').trim()) return;
  try {
    await pushFiscalNoteToAmo({
      dealId,
      kind,
      receipt: receipt as Record<string, unknown>,
      source,
    });
  } catch {
    /* Amo note не блокирует пробитие */
  }
}

function atolVatType(rate: number): string {
  if (!(rate > 0)) return 'none';
  if (rate === 5) return 'vat5';
  if (rate === 7) return 'vat7';
  if (rate === 10) return 'vat10';
  if (rate === 20) return 'vat20';
  if (rate === 22) return 'vat22';
  return 'vat5';
}

/** Для возврата: какой payment_method / тип оплаты был у исходного чека. */
function baseSellKind(kind: FiscalKind): 'advance' | 'full' {
  if (kind === 'refund_advance' || kind === 'advance') return 'advance';
  return 'full';
}

function roundMoney(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Телефон для АТОЛ.
 * Без «+» АТОЛ считает номер РФ без кода страны и дописывает +7
 * (из 7938… получается +77938…). Нужен вид +7XXXXXXXXXX.
 */
function normalizeAtolPhone(raw: string): string {
  const digits = normalizeDealPhone(raw);
  if (!digits) return '';
  return digits.startsWith('+') ? digits : `+${digits}`;
}

/** АТОЛ v5: в client обязательны email и phone. */
function buildAtolClientContact(
  deal: Record<string, unknown>,
  cfg: ReturnType<typeof getAtolSettings>,
  org: ReturnType<typeof getOrgProfile>
): Record<string, string> {
  const phone = normalizeAtolPhone(String(deal.buyer_phone || ''));
  const email =
    String(deal.buyer_email || '').trim() ||
    String(cfg.client_email || '').trim() ||
    String(cfg.company_email || '').trim() ||
    String(org.phone || '').trim() ||
    'noreply@pnevmopodveska1.ru';

  if (!phone) {
    throw new Error(
      'В сделке нет телефона покупателя — АТОЛ не примет чек. Укажите телефон контакта в Amo и обновите заказ.'
    );
  }

  return {
    email: email.includes('@') ? email : 'noreply@pnevmopodveska1.ru',
    phone,
  };
}

function getLastPaidPaymentAmount(dealId: string): number {
  const row = get<{ amount: number }>(
    `SELECT amount FROM deal_payments
     WHERE deal_id = ?
       AND lower(IFNULL(status,'')) IN ('paid','confirmed','success','accepted')
       AND IFNULL(amount,0) > 0
     ORDER BY datetime(created_at) DESC LIMIT 1`,
    [dealId]
  );
  return row ? roundMoney(Number(row.amount)) : 0;
}

/** Уже пробитый/в очереди чек этого типа (не error/cancelled). */
function findActiveFiscalSellReceipt(
  dealId: string,
  kind: 'advance' | 'full'
): Record<string, unknown> | null {
  const row = get(
    `SELECT id, kind, status, amount, created_at FROM fiscal_receipts
     WHERE deal_id = ? AND kind = ?
       AND IFNULL(status,'') NOT IN ('error','cancelled')
     ORDER BY datetime(created_at) DESC LIMIT 1`,
    [dealId, kind]
  ) as Record<string, unknown> | undefined;
  return row || null;
}

function getSuccessfulFiscalAmount(dealId: string, kind: 'advance' | 'full'): number {
  const rows = all<{ amount: number; status: string }>(
    `SELECT amount, status FROM fiscal_receipts
     WHERE deal_id = ? AND kind = ?
       AND IFNULL(status,'') NOT IN ('error','cancelled')`,
    [dealId, kind]
  );
  let sum = 0;
  for (const r of rows) {
    if (isSuccessfulFiscalStatus(String(r.status))) sum += Number(r.amount) || 0;
  }
  return roundMoney(sum);
}

/** Чек 1/2 не пробиваем повторно, если уже есть успешный или wait/sent. */
function assertNoDuplicateFiscalSell(dealId: string, kind: FiscalKind): void {
  if (kind !== 'advance' && kind !== 'full') return;
  const existing = findActiveFiscalSellReceipt(dealId, kind);
  if (!existing) return;
  const st = String(existing.status || '').toLowerCase();
  if (!isSuccessfulFiscalStatus(st)) return;
  const label = kind === 'full' ? '2 (полный расчёт)' : '1 (аванс)';
  const amt = roundMoney(Number(existing.amount) || 0);
  throw new Error(
    `Чек ${label} уже есть (статус «${st}», ${amt} ₽). Повторно не пробиваем — проверьте ОФД и сделку.`
  );
}

function validateReceiptPayload(receipt: {
  items: Array<{ sum: number }>;
  payments: Array<{ sum: number }>;
  total: number;
}): void {
  const itemsSum = roundMoney(receipt.items.reduce((s, it) => s + (Number(it.sum) || 0), 0));
  const total = roundMoney(Number(receipt.total) || 0);
  const paySum = roundMoney(receipt.payments.reduce((s, p) => s + (Number(p.sum) || 0), 0));
  if (Math.abs(itemsSum - total) > 0.009) {
    throw new Error(
      `Сумма строк (${itemsSum} ₽) ≠ total (${total} ₽) — чек не отправлен. Сверьте заказ и оплату.`
    );
  }
  if (Math.abs(paySum - total) > 0.009) {
    throw new Error(
      `Сумма оплаты (${paySum} ₽) ≠ total (${total} ₽) — чек не отправлен.`
    );
  }
  if (!(total > 0)) {
    throw new Error('Сумма чека 0 — нечего пробивать.');
  }
}

type AtolReceiptItem = {
  name: string;
  price: number;
  quantity: number;
  sum: number;
  measure?: number;
  measurement_unit?: string;
  payment_method: string;
  payment_object: number | string;
  vat: { type: string };
};

function isAtolProtocolV4(cfg: AtolSettings): boolean {
  return /\/v4\/?$/i.test(String(cfg.api_url || '').replace(/\/$/, '') + '/')
    || String(cfg.api_url || '').includes('/possystem/v4');
}

/** v5: payment_object number + measure; v4 (ФФД 1.05): string + measurement_unit. */
function adaptReceiptItemsForProtocol(
  items: AtolReceiptItem[],
  cfg: AtolSettings
): AtolReceiptItem[] {
  if (!isAtolProtocolV4(cfg)) return items;
  return items.map((it) => {
    const { measure: _m, ...rest } = it;
    return {
      ...rest,
      payment_object:
        typeof it.payment_object === 'number'
          ? it.payment_object === 4
            ? 'service'
            : 'commodity'
          : it.payment_object || 'commodity',
      measurement_unit: it.measurement_unit || 'шт',
    };
  });
}

function scaleReceiptItems(items: AtolReceiptItem[], targetTotal: number): AtolReceiptItem[] {
  const srcTotal = roundMoney(items.reduce((s, it) => s + (Number(it.sum) || 0), 0));
  if (!(srcTotal > 0) || Math.abs(srcTotal - targetTotal) <= 0.009) return items;
  const ratio = targetTotal / srcTotal;
  const scaled = items.map((it) => {
    const sum = roundMoney(Number(it.sum) * ratio);
    const qty = Number(it.quantity) || 1;
    return {
      ...it,
      sum,
      price: roundMoney(qty ? sum / qty : sum),
    };
  });
  const scaledSum = roundMoney(scaled.reduce((s, it) => s + (Number(it.sum) || 0), 0));
  const drift = roundMoney(targetTotal - scaledSum);
  if (Math.abs(drift) >= 0.01 && scaled.length) {
    const last = scaled[scaled.length - 1];
    const lastSum = roundMoney(Number(last.sum) + drift);
    const qty = Number(last.quantity) || 1;
    last.sum = lastSum;
    last.price = roundMoney(qty ? lastSum / qty : lastSum);
  }
  return scaled;
}

function buildReceiptPayload(
  deal: Record<string, unknown> & { items?: Array<Record<string, unknown>> },
  kind: FiscalKind
) {
  const orgId = organizationIdForDealRecord(deal) || undefined;
  const org = getOrgProfile(orgId);
  const cfg = getAtolSettingsForDeal({ ...deal, organization_id: orgId });
  const items = Array.isArray(deal.items) ? deal.items : [];
  const vatRate = Number(org.vat_rate) || 5;
  const sellKind = baseSellKind(kind);
  const paymentMethod = sellKind === 'advance' ? 'full_prepayment' : 'full_payment';
  const fallbackTotal = roundMoney(
    items.reduce((s, it) => s + (Number(it.amount) || 0), 0) || Number(deal.price) || 0
  );

  let receiptItems: AtolReceiptItem[] = (
    items.length
      ? items
      : [{ name: String(deal.name || 'Заказ'), qty: 1, amount: fallbackTotal, price: fallbackTotal }]
  ).map((it) => {
    const sum = roundMoney(Number(it.amount) || Number(it.price) * Number(it.qty) || 0);
    const qty = Number(it.qty) || 1;
    return {
      name: String(it.name || 'Товар').slice(0, 128),
      price: roundMoney(Number(it.price) || (qty ? sum / qty : sum)),
      quantity: qty,
      sum,
      measure: 0,
      payment_method: paymentMethod,
      payment_object: 1,
      vat: { type: atolVatType(vatRate) },
    };
  });

  let total = roundMoney(receiptItems.reduce((s, it) => s + Number(it.sum) || 0, 0));
  const dealId = String(deal.id || '');
  const split = dealId ? getDealPaymentSplit(dealId) : null;

  // Сумма чека — по фактическому приходу денег (deal_payments), не deal.price.
  if (sellKind === 'advance') {
    const advanceDue = roundMoney(
      (dealId ? getLastPaidPaymentAmount(dealId) : 0) || split?.paid_total || 0
    );
    if (advanceDue <= 0) {
      throw new Error('Нет оплаченных платежей — сумма аванса 0, чек не отправлен.');
    }
    if (total > 0 && advanceDue <= total + 0.009) {
      receiptItems = [
        {
          name: 'Аванс (предоплата)',
          price: advanceDue,
          quantity: 1,
          sum: advanceDue,
          measure: 0,
          payment_method: paymentMethod,
          payment_object: 1,
          vat: { type: atolVatType(vatRate) },
        },
      ];
      total = advanceDue;
    }
  } else if (sellKind === 'full' && dealId) {
    const advFiscal = getSuccessfulFiscalAmount(dealId, 'advance');
    let fiscalTotal = total;
    if (split && split.paid_total > 0) {
      fiscalTotal = roundMoney(split.paid_total - advFiscal);
      if (fiscalTotal <= 0) fiscalTotal = roundMoney(split.paid_total);
    }
    if (fiscalTotal > 0 && Math.abs(fiscalTotal - total) > 0.009) {
      receiptItems = scaleReceiptItems(receiptItems, fiscalTotal);
      total = roundMoney(receiptItems.reduce((s, it) => s + (Number(it.sum) || 0), 0));
    }
  }

  if (total <= 0) {
    total = fallbackTotal;
  }

  receiptItems = adaptReceiptItemsForProtocol(receiptItems, cfg);

  const client = buildAtolClientContact(deal, cfg, org);

  const payload = {
    timestamp: atolTimestamp(),
    external_id: '',
    receipt: {
      client,
      company: {
        email: cfg.company_email || org.phone || 'noreply@pnevmopodveska1.ru',
        sno: cfg.sno || 'usn_income',
        inn: cfg.inn || org.inn || '',
        payment_address: cfg.payment_address || 'https://pay.pnevmopodveska1.ru',
      },
      items: receiptItems,
      // 1 — безнал (СБП/карта), 2 — наличные
      payments: [{ type: sellKind === 'advance' ? 1 : 2, sum: total }],
      total,
    },
  };
  validateReceiptPayload(payload.receipt);
  return payload;
}

async function atolGetToken(cfg: AtolSettings = getAtolSettings()): Promise<string> {
  const base = cfg.api_url.replace(/\/$/, '');
  const res = await fetch(`${base}/getToken`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      login: cfg.login,
      pass: cfg.pass,
    }),
  });
  const data = (await res.json()) as { token?: string; error?: { text?: string } };
  if (!data.token) {
    throw new Error(data.error?.text || 'АТОл: не получен token');
  }
  return data.token;
}

export type AtolCorrectionOperation = 'sell_correction' | 'buy_correction';
export type AtolCorrectionBasis = 'instruction' | 'self';

function atolTimestamp(d = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/** dd.mm.yyyy из ISO или уже готовой строки. */
export function atolBaseDate(raw: string): string {
  const s = String(raw || '').trim();
  if (!s) throw new Error('Укажите дату расчёта');
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[3]}.${iso[2]}.${iso[1]}`;
  const ru = s.match(/^(\d{2})\.(\d{2})\.(\d{4})/);
  if (ru) return `${ru[1]}.${ru[2]}.${ru[3]}`;
  throw new Error('Дата: YYYY-MM-DD или dd.mm.yyyy');
}

function vatSumForAmount(amount: number, vatType: string): number {
  const sum = Number(amount) || 0;
  if (!(sum > 0) || vatType === 'none') return 0;
  const m = /^vat(\d+)$/.exec(vatType);
  if (!m) return 0;
  const rate = Number(m[1]) || 0;
  if (!(rate > 0)) return 0;
  return Math.round((sum * rate * 100) / (100 + rate)) / 100;
}

async function atolSendDocument(
  path: 'sell' | 'sell_refund' | AtolCorrectionOperation,
  payload: Record<string, unknown>,
  cfg: AtolSettings = getAtolSettings()
): Promise<Record<string, unknown>> {
  const base = cfg.api_url.replace(/\/$/, '');
  const group = cfg.group_code;
  const token = await atolGetToken(cfg);
  const res = await fetch(`${base}/${encodeURIComponent(group)}/${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Token: token,
    },
    body: JSON.stringify(payload),
  });
  const data = (await res.json()) as Record<string, unknown>;
  if (!res.ok) {
    throw new Error(JSON.stringify(data).slice(0, 400));
  }
  return data;
}

export function listFiscalReceipts(dealId: string) {
  return all(
    `SELECT id, kind, status, amount, atol_uuid, external_id, error,
            parent_receipt_id, created_at, updated_at
     FROM fiscal_receipts WHERE deal_id = ? ORDER BY datetime(created_at) DESC`,
    [dealId]
  );
}

export function getFiscalReceipt(id: string) {
  return get('SELECT * FROM fiscal_receipts WHERE id = ?', [id]) || null;
}

function isSuccessfulFiscalStatus(status: string): boolean {
  const s = String(status || '').toLowerCase();
  return ['wait', 'sent', 'done', 'ready', 'ok', 'success'].includes(s) || s === 'prepared';
}

/**
 * Найти исходный чек для возврата: явный id или последний успешный advance/full.
 */
export function findRefundBaseReceipt(
  dealId: string,
  opts?: { parent_receipt_id?: string; prefer?: 'advance' | 'full' }
): Record<string, unknown> | null {
  const parentId = String(opts?.parent_receipt_id || '').trim();
  if (parentId) {
    const row = get(
      `SELECT * FROM fiscal_receipts WHERE id = ? AND deal_id = ?`,
      [parentId, dealId]
    ) as Record<string, unknown> | undefined;
    if (!row) throw new Error('Исходный чек не найден');
    const k = String(row.kind || '');
    if (!SELL_KINDS.has(k)) throw new Error('Возврат можно сделать только по чеку предоплаты или полного расчёта');
    return row;
  }

  const prefer = opts?.prefer;
  const order = prefer === 'advance' ? ['advance', 'full'] : ['full', 'advance'];
  for (const kind of order) {
    const row = get(
      `SELECT * FROM fiscal_receipts
       WHERE deal_id = ? AND kind = ?
         AND IFNULL(status,'') NOT IN ('error','cancelled')
       ORDER BY datetime(created_at) DESC LIMIT 1`,
      [dealId, kind]
    ) as Record<string, unknown> | undefined;
    if (row && isSuccessfulFiscalStatus(String(row.status))) return row;
    if (row) return row;
  }
  return null;
}

function refundKindForBase(baseKind: string): FiscalKind {
  return baseKind === 'advance' ? 'refund_advance' : 'refund';
}

type DealForFiscal = Record<string, unknown> & { items?: Array<Record<string, unknown>> };

/** Сделка из Amo → WMS перед чеком (контакт обязателен). */
function ensureDealForFiscal(
  dealId: string,
  opts?: { clientPhoneFallback?: string }
): DealForFiscal {
  const id = String(dealId || '').trim();
  if (!id) throw new Error('Сделка не найдена');
  const { deal, phone } = ensureDealBuyerContactFromAmo(id);
  if (!deal) {
    throw new Error(
      `Сделка ${id} не найдена в Учёте №1. Откройте заказ в Учёте или дождитесь синка из Amo.`
    );
  }
  let phoneFinal = phone;
  const fallbackRaw = String(opts?.clientPhoneFallback || '').trim();
  if (!phoneFinal && fallbackRaw) {
    phoneFinal = normalizeDealPhone(fallbackRaw);
    if (phoneFinal) {
      // Подтянуть телефон плательщика (СБП/банк) в сделку, если в Amo пусто
      run(
        `UPDATE crm_deals SET buyer_phone = ?, synced_at = datetime('now')
         WHERE id = ? AND IFNULL(buyer_phone,'') = ''`,
        [fallbackRaw.startsWith('+') ? fallbackRaw : `+${phoneFinal}`, id]
      );
      (deal as Record<string, unknown>).buyer_phone =
        fallbackRaw.startsWith('+') || fallbackRaw.startsWith('7')
          ? fallbackRaw
          : `+${phoneFinal}`;
    }
  }
  if (!phoneFinal) {
    throw new Error(
      `У сделки ${id} нет телефона в Amo (контакт / компания) и нет телефона плательщика в оплате. Укажите телефон в карточке — без него АТОЛ не примет чек.`
    );
  }
  return deal as DealForFiscal;
}

/** Чек 1: предоплата / чек 2: полный расчёт. */
export async function prepareOrSendFiscalReceipt(input: {
  dealId: string;
  kind: FiscalKind;
  send?: boolean;
  parent_receipt_id?: string;
  /** Телефон плательщика из банка/СБП — если в Amo пусто. */
  client_phone?: string;
  /**
   * Юрлицо кассы из оплаты/бота: mp | rp.
   * Приоритетнее org сделки — чтобы СБП БМП не ушёл на кассу БРП при кривом org.
   */
  legal_entity?: string;
}) {
  if (REFUND_KINDS.has(input.kind)) {
    return prepareOrSendFiscalRefund({
      dealId: input.dealId,
      send: input.send,
      parent_receipt_id: input.parent_receipt_id,
      kind: input.kind === 'refund_advance' ? 'refund_advance' : 'refund',
      legal_entity: input.legal_entity,
    });
  }

  const deal = ensureDealForFiscal(input.dealId, {
    clientPhoneFallback: input.client_phone,
  });
  const orgId = organizationIdForDealRecord(deal) || undefined;
  const legal = String(input.legal_entity || '')
    .trim()
    .toLowerCase();
  const dealForAtol = {
    ...deal,
    organization_id: orgId,
    ...(legal === 'mp' || legal === 'rp' ? { fiscal_legal_entity: legal } : {}),
  };
  const atolCfg = getAtolSettingsForDeal(dealForAtol);
  assertNoDuplicateFiscalSell(String(deal.id), input.kind);

  const id = newGuid();
  const externalId = `${input.kind}_${deal.id}_${Date.now()}`;
  let payload: ReturnType<typeof buildReceiptPayload>;
  try {
    payload = buildReceiptPayload(dealForAtol, input.kind);
  } catch (e) {
    throw e instanceof Error ? e : new Error(String(e));
  }
  payload.external_id = externalId;

  const amount = Number(payload.receipt.total) || 0;
  const wantSend = Boolean(input.send) && atolConfigured(atolCfg);

  let status = 'prepared';
  let result: Record<string, unknown> = { mode: 'prepared', note: 'АТОл credentials не заданы — черновик' };
  let atolUuid = '';
  let error = '';

  if (wantSend) {
    try {
      result = await atolSendDocument('sell', payload, atolCfg);
      atolUuid = String(result.uuid || '');
      status = atolUuid ? 'wait' : 'sent';
    } catch (e) {
      status = 'error';
      error = e instanceof Error ? e.message : String(e);
      result = { error };
    }
  } else if (input.send && !atolConfigured(atolCfg)) {
    status = 'prepared';
    result = {
      mode: 'prepared',
      note: 'Задайте логин/пароль/группу АТОЛ в Настройки → Интеграции → АТОЛ',
    };
  }

  run(
    `INSERT INTO fiscal_receipts (
       id, deal_id, kind, external_id, atol_uuid, status, amount, payload_json, result_json, error,
       parent_receipt_id
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      String(deal.id),
      input.kind,
      externalId,
      atolUuid,
      status,
      amount,
      JSON.stringify(payload),
      JSON.stringify(result),
      error,
      '',
    ]
  );

  const saved = getFiscalReceipt(id);
  if (saved && input.send) {
    await notifyFiscalAmoNote(String(deal.id), input.kind, saved as Record<string, unknown>);
  }
  return saved;
}

/**
 * Чек возврата (АТОЛ sell_refund) по исходному чеку предоплаты или полного расчёта.
 * Деньги покупателю в банке/СБП — отдельно (Точка); здесь только фискальный документ в ОФД.
 */
export async function prepareOrSendFiscalRefund(input: {
  dealId: string;
  send?: boolean;
  parent_receipt_id?: string;
  kind?: 'refund' | 'refund_advance';
  legal_entity?: string;
}) {
  const deal = getDeal(input.dealId) as
    | (Record<string, unknown> & { items?: Array<Record<string, unknown>> })
    | null;
  if (!deal) throw new Error('Сделка не найдена');

  const prefer =
    input.kind === 'refund_advance'
      ? 'advance'
      : input.kind === 'refund'
        ? 'full'
        : undefined;

  const base = findRefundBaseReceipt(String(deal.id), {
    parent_receipt_id: input.parent_receipt_id,
    prefer,
  });
  if (!base) {
    throw new Error(
      'Нет чека для возврата. Сначала пробейте предоплату или полный расчёт.'
    );
  }

  const baseKind = String(base.kind || 'full');
  const refundKind = refundKindForBase(baseKind);
  const id = newGuid();
  const externalId = `${refundKind}_${deal.id}_${Date.now()}`;
  const orgId = organizationIdForDealRecord(deal as Record<string, unknown>) || undefined;

  // Касса возврата = касса исходного чека (ИНН в payload), иначе явный legal, иначе org сделки.
  let fiscalLegal = '';
  try {
    const basePayload = JSON.parse(String(base.payload_json || '{}')) as {
      receipt?: { company?: { inn?: string } };
    };
    const baseInn = String(basePayload?.receipt?.company?.inn || '').replace(/\D/g, '');
    if (baseInn === '231295963240') fiscalLegal = 'mp';
    else if (baseInn === '231215603728') fiscalLegal = 'rp';
  } catch {
    /* ignore */
  }
  if (!fiscalLegal) {
    const legal = String(input.legal_entity || '')
      .trim()
      .toLowerCase();
    if (legal === 'mp' || legal === 'rp') fiscalLegal = legal;
  }

  const dealForAtol = {
    ...deal,
    organization_id: orgId,
    ...(fiscalLegal ? { fiscal_legal_entity: fiscalLegal } : {}),
  };
  const atolCfg = getAtolSettingsForDeal(dealForAtol);
  const payload = buildReceiptPayload(dealForAtol as DealForFiscal, refundKind);
  payload.external_id = externalId;

  // Сумма — как у исходного чека, если есть; строки пропорционально подгоняем под total.
  const baseAmount = Number(base.amount) || 0;
  if (baseAmount > 0) {
    const receipt = payload.receipt as {
      total: number;
      items: AtolReceiptItem[];
      payments: Array<{ type: number; sum: number }>;
    };
    receipt.items = scaleReceiptItems(receipt.items, baseAmount);
    receipt.total = baseAmount;
    receipt.payments = [{ type: baseKind === 'advance' ? 1 : 2, sum: baseAmount }];
    validateReceiptPayload(receipt);
  }

  const amount =
    Number((payload.receipt as { total?: number }).total) || baseAmount || 0;
  const wantSend = Boolean(input.send) && atolConfigured(atolCfg);

  let status = 'prepared';
  let result: Record<string, unknown> = {
    mode: 'prepared',
    note: 'АТОл credentials не заданы — черновик возврата',
    parent_receipt_id: base.id,
  };
  let atolUuid = '';
  let error = '';

  if (wantSend) {
    try {
      result = await atolSendDocument('sell_refund', payload, atolCfg);
      result = { ...result, parent_receipt_id: base.id, parent_atol_uuid: base.atol_uuid };
      atolUuid = String(result.uuid || '');
      status = atolUuid ? 'wait' : 'sent';
    } catch (e) {
      status = 'error';
      error = e instanceof Error ? e.message : String(e);
      result = { error, parent_receipt_id: base.id };
    }
  } else if (input.send && !atolConfigured(atolCfg)) {
    status = 'prepared';
    result = {
      mode: 'prepared',
      note: 'Задайте логин/пароль/группу АТОЛ в Настройки → Интеграции → АТОЛ',
      parent_receipt_id: base.id,
    };
  }

  run(
    `INSERT INTO fiscal_receipts (
       id, deal_id, kind, external_id, atol_uuid, status, amount, payload_json, result_json, error,
       parent_receipt_id
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      String(deal.id),
      refundKind,
      externalId,
      atolUuid,
      status,
      amount,
      JSON.stringify(payload),
      JSON.stringify(result),
      error,
      String(base.id),
    ]
  );

  const saved = getFiscalReceipt(id);
  if (saved && input.send) {
    await notifyFiscalAmoNote(String(deal.id), refundKind, saved as Record<string, unknown>);
  }
  return saved;
}

export type FiscalCorrectionInput = {
  dealId?: string;
  operation?: AtolCorrectionOperation;
  correction_type?: AtolCorrectionBasis;
  base_date: string;
  base_number: string;
  base_name?: string;
  amount: number;
  payment_type?: 1 | 2;
  vat_type?: string;
  client_email?: string;
  client_phone?: string;
  send?: boolean;
};

/** Чек коррекции (ФФД 1.05: неприменение ККТ / по предписанию ФНС). */
export async function prepareOrSendFiscalCorrection(input: FiscalCorrectionInput) {
  const operation: AtolCorrectionOperation =
    input.operation === 'buy_correction' ? 'buy_correction' : 'sell_correction';
  const corrType: AtolCorrectionBasis =
    input.correction_type === 'self' ? 'self' : 'instruction';
  const amount = Number(input.amount);
  if (!(amount > 0)) throw new Error('Сумма должна быть больше 0');
  const baseDate = atolBaseDate(input.base_date);
  const baseNumber = String(input.base_number || '').trim();
  if (!baseNumber) throw new Error('Укажите номер документа-основания (требование ФНС)');
  const baseName = String(input.base_name || '').trim();

  const dealId = String(input.dealId || '').trim();
  let deal: (Record<string, unknown> & { items?: Array<Record<string, unknown>> }) | null = null;
  if (dealId) {
    deal = getDeal(dealId) as
      | (Record<string, unknown> & { items?: Array<Record<string, unknown>> })
      | null;
    if (!deal) throw new Error('Заказ не найден');
  }

  const orgId = deal ? organizationIdForDealRecord(deal) || undefined : undefined;
  const org = getOrgProfile(orgId);
  const cfg = deal
    ? getAtolSettingsForDeal({ ...deal, organization_id: orgId })
    : getAtolSettings();
  const vatRate = Number(org.vat_rate) || 5;
  const vatType =
    String(input.vat_type || '').trim() ||
    (vatRate > 0 ? atolVatType(vatRate) : 'none');
  const paymentType = input.payment_type === 2 ? 2 : 1;

  const client: Record<string, string> = {};
  const email = String(input.client_email || cfg.client_email || '').trim();
  const phoneRaw = String(input.client_phone || deal?.buyer_phone || '').trim();
  if (deal && !normalizeAtolPhone(phoneRaw) && !email) {
    Object.assign(client, buildAtolClientContact(deal, cfg, org));
  } else {
    const builtEmail =
      email ||
      String(deal?.buyer_email || '').trim() ||
      String(cfg.company_email || '').trim() ||
      'noreply@pnevmopodveska1.ru';
    const builtPhone = normalizeAtolPhone(phoneRaw);
    if (builtEmail.includes('@')) client.email = builtEmail;
    if (builtPhone) client.phone = builtPhone;
    if (!client.email || !client.phone) {
      if (deal) Object.assign(client, buildAtolClientContact(deal, cfg, org));
    }
  }

  const id = newGuid();
  const suffix = dealId || 'manual';
  const externalId = `correction_${suffix}_${Date.now()}`;
  // ATOL v5: base_name только для type=instruction; для self схема запрещает поле.
  const correctionInfo: Record<string, string> = {
    type: corrType,
    base_date: baseDate,
    base_number: baseNumber,
  };
  if (corrType === 'instruction' && baseName) {
    correctionInfo.base_name = baseName.slice(0, 256);
  }

  const vatAmount = vatSumForAmount(amount, vatType);
  const itemName =
    baseName ||
    (corrType === 'self'
      ? 'Коррекция расчёта (самостоятельно)'
      : 'Коррекция расчёта по предписанию');
  // ATOL Online v5 требует items + total в correction (не только payments/vats).
  const items = [
    {
      name: itemName.slice(0, 128),
      price: amount,
      quantity: 1,
      measure: 0,
      sum: amount,
      payment_method: paymentType === 1 ? 'full_prepayment' : 'full_payment',
      payment_object: 1,
      vat: { type: vatType, sum: vatAmount },
    },
  ];

  const payload: Record<string, unknown> = {
    timestamp: atolTimestamp(),
    external_id: externalId,
    correction: {
      company: {
        email: cfg.company_email || org.phone || 'noreply@pnevmopodveska1.ru',
        sno: cfg.sno || 'usn_income',
        inn: cfg.inn || org.inn || '',
        payment_address: cfg.payment_address || 'https://pay.pnevmopodveska1.ru',
      },
      correction_info: correctionInfo,
      items,
      payments: [{ type: paymentType, sum: amount }],
      vats: [{ type: vatType, sum: vatAmount }],
      total: amount,
    },
  };
  if (Object.keys(client).length) {
    (payload.correction as Record<string, unknown>).client = client;
  }

  const wantSend = Boolean(input.send) && atolConfigured(cfg);
  let status = 'prepared';
  let result: Record<string, unknown> = {
    mode: 'prepared',
    note: 'АТОЛ credentials не заданы — черновик коррекции',
    operation,
  };
  let atolUuid = '';
  let error = '';

  if (wantSend) {
    try {
      result = await atolSendDocument(operation, payload, cfg);
      result = { ...result, operation };
      atolUuid = String(result.uuid || '');
      status = atolUuid ? 'wait' : 'sent';
    } catch (e) {
      status = 'error';
      error = e instanceof Error ? e.message : String(e);
      result = { error, operation };
    }
  } else if (input.send && !atolConfigured(cfg)) {
    status = 'prepared';
    result = {
      mode: 'prepared',
      note: 'Задайте логин/пароль/группу АТОЛ в Настройки → Интеграции → АТОЛ',
      operation,
    };
  }

  const kind = operation === 'buy_correction' ? 'correction_expense' : 'correction_income';
  run(
    `INSERT INTO fiscal_receipts (
       id, deal_id, kind, external_id, atol_uuid, status, amount, payload_json, result_json, error,
       parent_receipt_id
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      dealId,
      kind,
      externalId,
      atolUuid,
      status,
      amount,
      JSON.stringify(payload),
      JSON.stringify(result),
      error,
      '',
    ]
  );

  const saved = getFiscalReceipt(id);
  if (saved && input.send !== false) {
    await notifyFiscalAmoNote(dealId, kind, saved as Record<string, unknown>, 'wms:correction');
  }
  return saved;
}

export function atolStatusInfo() {
  const profiles = listAtolProfileKeys().map((key) => {
    const s = getAtolSettings(key);
    return {
      profile: key,
      label: key === 'mp' ? 'БМП · Фогель / Стрела' : 'БРП · Москва',
      configured: atolConfigured(s),
      group_code: s.group_code,
      inn: s.inn || getOrgProfile().inn || '',
      payment_address: s.payment_address,
    };
  });
  const s = getAtolSettings();
  return {
    configured: profiles.some((p) => p.configured),
    profiles,
    api_url: s.api_url,
    group_code: s.group_code,
    inn: s.inn || getOrgProfile().inn || '',
    sno: s.sno || 'usn_income',
    settings_path: '/settings/atol',
    payment_address: s.payment_address,
    kinds: {
      advance: 'Чек 1 — предоплата (full_prepayment) после QR/оплаты',
      full: 'Чек 2 — полный расчёт (full_payment) при выдаче',
      refund: 'Возврат по полному расчёту (sell_refund → ОФД)',
      refund_advance: 'Возврат предоплаты (sell_refund → ОФД)',
      correction_income: 'Чек коррекции прихода (sell_correction → ОФД)',
      correction_expense: 'Чек коррекции расхода (buy_correction → ОФД)',
    },
    note_correction:
      'Коррекция — когда расчёт был без ККТ или по предписанию ФНС. Не путать с обычным приходом и возвратом.',
    note_refund:
      'Чек возврата уходит в ОФД через АТОЛ. Возврат денег на карту/СБП в Точке — отдельная операция банка.',
  };
}

/** Проверка getToken без пробития чека. */
export async function testAtolConnection(profile: AtolProfileKey = 'rp'): Promise<{
  ok: boolean;
  configured: boolean;
  message: string;
  profile?: AtolProfileKey;
}> {
  const cfg = getAtolSettings(profile);
  if (!atolConfigured(cfg)) {
    return {
      ok: false,
      configured: false,
      message: 'Не заданы login / pass / group_code',
      profile,
    };
  }
  try {
    await atolGetToken(cfg);
    return { ok: true, configured: true, message: 'Токен АТОЛ получен', profile };
  } catch (e) {
    return {
      ok: false,
      configured: true,
      message: e instanceof Error ? e.message : String(e),
      profile,
    };
  }
}
