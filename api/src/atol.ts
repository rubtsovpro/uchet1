/**
 * АТОЛ Онлайн — чеки: предоплата, полный расчёт, возврат (sell_refund).
 * Без login/pass/group — режим prepared (черновик payload).
 * Credentials: meta.integration_atol или ATOL_* в env.
 */
import { all, get, run } from './db.js';
import { newGuid } from './ids.js';
import { getDeal } from './deals.js';
import { getOrgProfile } from './sales-docs.js';
import { getAtolSettings } from './integration-settings.js';

/** Чек продажи или возврата. */
export type FiscalKind = 'advance' | 'full' | 'refund' | 'refund_advance';

const SELL_KINDS = new Set(['advance', 'full']);
const REFUND_KINDS = new Set(['refund', 'refund_advance']);

export function atolConfigured(): boolean {
  const s = getAtolSettings();
  return Boolean(s.login && s.pass && s.group_code);
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

function buildReceiptPayload(
  deal: Record<string, unknown> & { items?: Array<Record<string, unknown>> },
  kind: FiscalKind
) {
  const org = getOrgProfile();
  const items = Array.isArray(deal.items) ? deal.items : [];
  const vatRate = Number(org.vat_rate) || 5;
  const sellKind = baseSellKind(kind);
  const paymentMethod = sellKind === 'advance' ? 'full_prepayment' : 'full_payment';
  const total =
    Number(deal.price) ||
    items.reduce((s, it) => s + (Number(it.amount) || 0), 0);

  const receiptItems = (
    items.length
      ? items
      : [{ name: String(deal.name || 'Заказ'), qty: 1, amount: total, price: total }]
  ).map((it) => {
    const sum = Number(it.amount) || Number(it.price) * Number(it.qty) || 0;
    return {
      name: String(it.name || 'Товар').slice(0, 128),
      price: Number(it.price) || sum,
      quantity: Number(it.qty) || 1,
      sum,
      measurement_unit: String(it.unit || 'шт'),
      payment_method: paymentMethod,
      payment_object: 'commodity',
      vat: { type: atolVatType(vatRate) },
    };
  });

  const cfg = getAtolSettings();
  const client: Record<string, string> = {};
  const email = cfg.client_email;
  const phone = String(deal.buyer_phone || '').trim();
  if (email) client.email = email;
  if (phone) client.phone = phone.replace(/\D/g, '').replace(/^8/, '7');

  return {
    timestamp: new Date().toISOString().replace('T', ' ').slice(0, 19),
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
}

async function atolGetToken(): Promise<string> {
  const cfg = getAtolSettings();
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

async function atolSendDocument(
  path: 'sell' | 'sell_refund',
  payload: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const cfg = getAtolSettings();
  const base = cfg.api_url.replace(/\/$/, '');
  const group = cfg.group_code;
  const token = await atolGetToken();
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

/** Чек 1: предоплата / чек 2: полный расчёт. */
export async function prepareOrSendFiscalReceipt(input: {
  dealId: string;
  kind: FiscalKind;
  send?: boolean;
  parent_receipt_id?: string;
}) {
  if (REFUND_KINDS.has(input.kind)) {
    return prepareOrSendFiscalRefund({
      dealId: input.dealId,
      send: input.send,
      parent_receipt_id: input.parent_receipt_id,
      kind: input.kind === 'refund_advance' ? 'refund_advance' : 'refund',
    });
  }

  const deal = getDeal(input.dealId) as
    | (Record<string, unknown> & { items?: Array<Record<string, unknown>> })
    | null;
  if (!deal) throw new Error('Сделка не найдена');

  const id = newGuid();
  const externalId = `${input.kind}_${deal.id}_${Date.now()}`;
  const payload = buildReceiptPayload(deal, input.kind);
  payload.external_id = externalId;

  const amount = Number(payload.receipt.total) || 0;
  const wantSend = Boolean(input.send) && atolConfigured();

  let status = 'prepared';
  let result: Record<string, unknown> = { mode: 'prepared', note: 'АТОл credentials не заданы — черновик' };
  let atolUuid = '';
  let error = '';

  if (wantSend) {
    try {
      result = await atolSendDocument('sell', payload);
      atolUuid = String(result.uuid || '');
      status = atolUuid ? 'wait' : 'sent';
    } catch (e) {
      status = 'error';
      error = e instanceof Error ? e.message : String(e);
      result = { error };
    }
  } else if (input.send && !atolConfigured()) {
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

  return getFiscalReceipt(id);
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
  const payload = buildReceiptPayload(deal, refundKind);
  payload.external_id = externalId;

  // Сумма — как у исходного чека, если есть
  const baseAmount = Number(base.amount) || 0;
  if (baseAmount > 0) {
    (payload.receipt as { total: number; payments: Array<{ type: number; sum: number }> }).total =
      baseAmount;
    (payload.receipt as { payments: Array<{ type: number; sum: number }> }).payments = [
      { type: baseKind === 'advance' ? 1 : 2, sum: baseAmount },
    ];
  }

  const amount =
    Number((payload.receipt as { total?: number }).total) || baseAmount || 0;
  const wantSend = Boolean(input.send) && atolConfigured();

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
      result = await atolSendDocument('sell_refund', payload);
      result = { ...result, parent_receipt_id: base.id, parent_atol_uuid: base.atol_uuid };
      atolUuid = String(result.uuid || '');
      status = atolUuid ? 'wait' : 'sent';
    } catch (e) {
      status = 'error';
      error = e instanceof Error ? e.message : String(e);
      result = { error, parent_receipt_id: base.id };
    }
  } else if (input.send && !atolConfigured()) {
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

  return getFiscalReceipt(id);
}

export function atolStatusInfo() {
  const s = getAtolSettings();
  return {
    configured: atolConfigured(),
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
    },
    note_refund:
      'Чек возврата уходит в ОФД через АТОЛ. Возврат денег на карту/СБП в Точке — отдельная операция банка.',
  };
}

/** Проверка getToken без пробития чека. */
export async function testAtolConnection(): Promise<{
  ok: boolean;
  configured: boolean;
  message: string;
}> {
  if (!atolConfigured()) {
    return {
      ok: false,
      configured: false,
      message: 'Не заданы login / pass / group_code',
    };
  }
  try {
    await atolGetToken();
    return { ok: true, configured: true, message: 'Токен АТОЛ получен' };
  } catch (e) {
    return {
      ok: false,
      configured: true,
      message: e instanceof Error ? e.message : String(e),
    };
  }
}
