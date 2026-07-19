/**
 * АТОЛ Онлайн — подготовка двух чеков (предоплата + полный расчёт).
 * Без ATOL_LOGIN/PASS работает в режиме prepared (черновик payload), без отправки.
 */
import { all, get, run } from './db.js';
import { newGuid } from './ids.js';
import { getDeal } from './deals.js';
import { getOrgProfile } from './sales-docs.js';

export type FiscalKind = 'advance' | 'full';

function atolConfigured(): boolean {
  return Boolean(
    (process.env.ATOL_LOGIN || '').trim() &&
      (process.env.ATOL_PASS || '').trim() &&
      (process.env.ATOL_GROUP_CODE || '').trim()
  );
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

function buildReceiptPayload(
  deal: Record<string, unknown> & { items?: Array<Record<string, unknown>> },
  kind: FiscalKind
) {
  const org = getOrgProfile();
  const items = Array.isArray(deal.items) ? deal.items : [];
  const vatRate = Number(org.vat_rate) || 5;
  const paymentMethod = kind === 'advance' ? 'full_prepayment' : 'full_payment';
  const total =
    Number(deal.price) ||
    items.reduce((s, it) => s + (Number(it.amount) || 0), 0);

  const receiptItems = (items.length ? items : [{ name: String(deal.name || 'Заказ'), qty: 1, amount: total, price: total }]).map(
    (it) => {
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
    }
  );

  const client: Record<string, string> = {};
  const email = String(process.env.ATOL_CLIENT_EMAIL || '').trim();
  const phone = String(deal.buyer_phone || '').trim();
  if (email) client.email = email;
  if (phone) client.phone = phone.replace(/\D/g, '').replace(/^8/, '7');

  return {
    timestamp: new Date().toISOString().replace('T', ' ').slice(0, 19),
    external_id: '',
    receipt: {
      client,
      company: {
        email: String(process.env.ATOL_COMPANY_EMAIL || org.phone || 'noreply@pnevmopodveska1.ru'),
        sno: String(process.env.ATOL_SNO || 'usn_income'),
        inn: String(process.env.ATOL_INN || org.inn || ''),
        payment_address: String(process.env.ATOL_PAYMENT_ADDRESS || 'https://1c.pnevmopodveska1.ru'),
      },
      items: receiptItems,
      payments: [{ type: kind === 'advance' ? 1 : 2, sum: total }],
      total,
    },
  };
}

async function atolGetToken(): Promise<string> {
  const base = (process.env.ATOL_API_URL || 'https://online.atol.ru/possystem/v4').replace(/\/$/, '');
  const res = await fetch(`${base}/getToken`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      login: process.env.ATOL_LOGIN,
      pass: process.env.ATOL_PASS,
    }),
  });
  const data = (await res.json()) as { token?: string; error?: { text?: string } };
  if (!data.token) {
    throw new Error(data.error?.text || 'АТОл: не получен token');
  }
  return data.token;
}

async function atolSendSell(payload: Record<string, unknown>): Promise<Record<string, unknown>> {
  const base = (process.env.ATOL_API_URL || 'https://online.atol.ru/possystem/v4').replace(/\/$/, '');
  const group = (process.env.ATOL_GROUP_CODE || '').trim();
  const token = await atolGetToken();
  const res = await fetch(`${base}/${encodeURIComponent(group)}/sell`, {
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
    `SELECT id, kind, status, amount, atol_uuid, external_id, error, created_at, updated_at
     FROM fiscal_receipts WHERE deal_id = ? ORDER BY datetime(created_at) DESC`,
    [dealId]
  );
}

export function getFiscalReceipt(id: string) {
  return get('SELECT * FROM fiscal_receipts WHERE id = ?', [id]) || null;
}

/** Чек 1: предоплата / чек 2: полный расчёт. */
export async function prepareOrSendFiscalReceipt(input: {
  dealId: string;
  kind: FiscalKind;
  send?: boolean;
}) {
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
      result = await atolSendSell(payload);
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
      note: 'Задайте ATOL_LOGIN, ATOL_PASS, ATOL_GROUP_CODE в .env — тогда чек уйдёт в АТОЛ',
    };
  }

  run(
    `INSERT INTO fiscal_receipts (
       id, deal_id, kind, external_id, atol_uuid, status, amount, payload_json, result_json, error
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
    ]
  );

  return getFiscalReceipt(id);
}

export function atolStatusInfo() {
  return {
    configured: atolConfigured(),
    api_url: process.env.ATOL_API_URL || 'https://online.atol.ru/possystem/v4',
    group_code: process.env.ATOL_GROUP_CODE || '',
    inn: process.env.ATOL_INN || getOrgProfile().inn || '',
    sno: process.env.ATOL_SNO || 'usn_income',
    kinds: {
      advance: 'Чек 1 — предоплата (full_prepayment) после QR/оплаты',
      full: 'Чек 2 — полный расчёт (full_payment) при выдаче',
    },
  };
}
