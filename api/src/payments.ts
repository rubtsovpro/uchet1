/**
 * СБП QR через bank.pnevmopodveska1.ru (Точка).
 */
import { all, get, run } from './db.js';
import { newGuid } from './ids.js';
import { ensureWarehouseTaskAfterPaid } from './sales-pipeline.js';
import { dealIsLegalEntity, getDeal } from './deals.js';
import { getOrgProfile } from './sales-docs.js';
import { getTochkaBridgeSettings } from './integration-settings.js';
import { ensureOrderDocChain } from './order-doc-tree.js';
import { createCashDoc } from './menu-parity.js';
import {
  type PaymentCovers,
  getDealPaymentSplit,
  syncDealPaidStatus,
  roundDealMoney,
} from './deal-payment-split.js';

export type { PaymentCovers } from './deal-payment-split.js';
export { getDealBasketTotals, getDealPaymentSplit, syncDealPaidStatus } from './deal-payment-split.js';

const PAID_STATUSES = new Set(['paid', 'confirmed', 'success', 'accepted']);

function bankSbpUrl(): string {
  return getTochkaBridgeSettings().sbp_create_url;
}

function bankSbpStatusUrl(): string {
  return getTochkaBridgeSettings().sbp_status_url;
}

function bankSbpKey(): string {
  return getTochkaBridgeSettings().bank_sbp_key;
}

/** Назначение СБП под regex Точки (без · / ё / «» и пр.). */
function sanitizeSbpPurpose(raw: string): string {
  let s = String(raw || '')
    .replace(/[·•]/g, '-')
    .replace(/[–—]/g, '-')
    .replace(/[«»“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/Ё/g, 'Е')
    .replace(/ё/g, 'е')
    .replace(/[\r\n\t]+/g, ' ');
  s = s.replace(/[^A-Za-zА-Яа-я0-9 !"#$%&'()*+,\-./:;<=>?@^_`{|}~#№[\]\\]/gu, '');
  s = s.replace(/\s+/g, ' ').trim();
  return s.slice(0, 140);
}

function humanizeBankError(err: string): string {
  const s = String(err || '');
  const jsonStart = s.indexOf('{');
  if (jsonStart >= 0) {
    try {
      const j = JSON.parse(s.slice(jsonStart)) as {
        message?: string;
        Errors?: Array<{ message?: string }>;
      };
      const detail = j.Errors?.[0]?.message || j.message || '';
      if (detail && /match pattern/i.test(detail)) {
        return 'Точка: недопустимые символы в назначении платежа';
      }
      if (detail) return 'Точка: ' + detail;
    } catch {
      /* keep raw */
    }
  }
  return s;
}

export function listDealPayments(dealId: string) {
  return all(
    `SELECT id, kind, amount, status, qrc_id, payload, account, purpose, created_at,
            CASE WHEN length(image_png_base64)>0 THEN 1 ELSE 0 END AS has_image
     FROM deal_payments WHERE deal_id = ? ORDER BY datetime(created_at) DESC`,
    [dealId]
  );
}

export function getDealPayment(id: string) {
  return get('SELECT * FROM deal_payments WHERE id = ?', [id]) || null;
}

/** Удалить запись QR/оплаты со сделки (локальная история; QR в банке не отменяется). */
export function deleteDealPayment(id: string) {
  const row = getDealPayment(id);
  if (!row) return null;
  run('DELETE FROM deal_payments WHERE id = ?', [id]);
  return row;
}

export async function createDealSbpQr(input: {
  dealId: string;
  amount?: number;
  purpose?: string;
  account?: string;
  ttlSec?: number;
}) {
  const deal = getDeal(input.dealId) as Record<string, unknown> | null;
  if (!deal) throw new Error('Сделка не найдена');
  if (dealIsLegalEntity(deal)) {
    throw new Error(
      'У сделки указана компания (юрлицо) — оплата только по счёту, QR СБП недоступен'
    );
  }

  const amount =
    input.amount != null && Number(input.amount) > 0
      ? Number(input.amount)
      : Number(deal.price) || 0;
  if (!(amount > 0)) {
    throw new Error('Сумма заказа 0 — укажите сумму или добавьте позиции');
  }

  const org = getOrgProfile();
  const account =
    (input.account || '').replace(/\D/g, '') ||
    String(org.rs || '').replace(/\D/g, '') ||
    '40802810109500030587';

  const purpose = sanitizeSbpPurpose(
    (input.purpose || '').trim() ||
      `Оплата заказа ${deal.id}` +
        (deal.name ? ` - ${String(deal.name).slice(0, 80)}` : '')
  );

  const key = bankSbpKey();
  if (!key) {
    throw new Error('Не задан ключ Точка (Настройки → Интеграции → Точка Банк)');
  }

  const res = await fetch(bankSbpUrl(), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Wms-Key': key,
    },
    body: JSON.stringify({
      deal_id: String(deal.id),
      amount,
      purpose,
      account,
      ttl_sec: input.ttlSec ?? 86400,
    }),
  });
  const raw = await res.text();
  let data: Record<string, unknown> = {};
  try {
    data = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    throw new Error(`Банк: не JSON (${res.status}): ${raw.slice(0, 200)}`);
  }
  if (!res.ok || !data.ok) {
    throw new Error(humanizeBankError(String(data.error || `Банк HTTP ${res.status}`)));
  }

  const id = newGuid();
  run(
    `INSERT INTO deal_payments (
       id, deal_id, kind, amount, status, qrc_id, payload, image_png_base64, account, purpose, meta_json
     ) VALUES (?, ?, 'sbp_qr', ?, 'created', ?, ?, ?, ?, ?, ?)`,
    [
      id,
      String(deal.id),
      amount,
      String(data.qrc_id || ''),
      String(data.payload || ''),
      String(data.image_png_base64 || ''),
      String(data.account || account),
      String(data.purpose || purpose),
      JSON.stringify({ merchant_id: data.merchant_id || '', ttl_sec: data.ttl_sec || null }),
    ]
  );

  return getDealPayment(id);
}

/** Пометить оплату / сделку как оплаченную (ручной статус или webhook банка). */
export function markDealPaymentPaid(input: {
  paymentId?: string;
  dealId?: string;
  qrcId?: string;
  source?: string;
}) {
  let payment = input.paymentId ? getDealPayment(input.paymentId) : null;
  if (!payment && input.qrcId) {
    payment =
      get(`SELECT * FROM deal_payments WHERE qrc_id = ? ORDER BY datetime(created_at) DESC LIMIT 1`, [
        String(input.qrcId),
      ]) || null;
  }
  if (!payment && input.dealId) {
    payment =
      get(
        `SELECT * FROM deal_payments WHERE deal_id = ? AND status NOT IN ('paid','confirmed','success')
         ORDER BY datetime(created_at) DESC LIMIT 1`,
        [String(input.dealId)]
      ) || null;
  }
  const dealId = String(input.dealId || (payment as { deal_id?: string } | null)?.deal_id || '');
  if (!dealId && !payment) throw new Error('Платёж / сделка не найдены');

  if (payment) {
    run(`UPDATE deal_payments SET status = 'paid' WHERE id = ?`, [
      String((payment as { id: string }).id),
    ]);
  }

  if (dealId) {
    try {
      run(
        `UPDATE payment_links SET status = 'paid', paid_at = datetime('now')
         WHERE deal_id = ? AND status = 'pending'`,
        [dealId]
      );
      run(
        `UPDATE stock_reserves SET status = 'sold', released_at = datetime('now')
         WHERE deal_id = ? AND status = 'active'`,
        [dealId]
      );
    } catch {
      /* таблицы появятся после migrate */
    }
  }

  // Не слепо paid=1: учитываем корзины товар/услуги и частичные оплаты
  const synced = dealId
    ? syncDealPaidStatus(dealId)
    : { split: null, paid: false, payment_status: '' };

  let warehouseTask: { created: boolean; task: Record<string, unknown> | null; reason?: string } | null =
    null;
  if (dealId && synced.paid) {
    try {
      warehouseTask = ensureWarehouseTaskAfterPaid({ dealId });
    } catch {
      warehouseTask = null;
    }
    try {
      ensureOrderDocChain(dealId);
    } catch {
      /* дерево */
    }
  }

  return {
    ok: true,
    deal_id: dealId,
    payment: payment ? getDealPayment(String((payment as { id: string }).id)) : null,
    source: input.source || 'manual',
    warehouse_task: warehouseTask,
    payment_split: synced.split,
    fully_paid: synced.paid,
    payment_status: synced.payment_status,
  };
}

/**
 * Приём наличных на СТО / самовывозе.
 * covers: goods | services | all — за товар / услуги / всё оставшееся.
 * Можно несколько раз (услуги, потом второй баллон и т.п.).
 */
export function acceptDealCashPayment(input: {
  dealId: string;
  amount?: number;
  covers?: PaymentCovers | string;
  actorName?: string;
  cash_register_id?: string;
  skip_cash_doc?: boolean;
}) {
  const dealId = String(input.dealId || '').trim();
  if (!dealId) throw new Error('deal_id обязателен');
  const deal = getDeal(dealId) as Record<string, unknown> | null;
  if (!deal) throw new Error('Сделка не найдена');

  const coversRaw = String(input.covers || 'all').toLowerCase();
  const covers: PaymentCovers =
    coversRaw === 'goods' || coversRaw === 'product' || coversRaw === 'товар'
      ? 'goods'
      : coversRaw === 'services' || coversRaw === 'service' || coversRaw === 'услуги'
        ? 'services'
        : 'all';

  const split = getDealPaymentSplit(dealId);
  if (split.fully_paid) {
    throw new Error('Заказ уже полностью оплачен');
  }

  let amount = Number(input.amount);
  if (!(amount > 0)) {
    if (covers === 'goods') amount = split.due_goods;
    else if (covers === 'services') amount = split.due_services;
    else amount = split.due_total;
  }
  amount = roundDealMoney(amount);
  if (!(amount > 0)) {
    throw new Error(
      covers === 'goods'
        ? 'По товарам доплачивать нечего'
        : covers === 'services'
          ? 'По услугам доплачивать нечего'
          : 'Доплачивать нечего'
    );
  }

  const coversLabel =
    covers === 'goods' ? 'товар' : covers === 'services' ? 'услуги' : 'всё';
  const id = newGuid();
  const actor = String(input.actorName || '').trim();
  const purpose =
    `Наличные · ${coversLabel} · заказ ${dealId}` +
    (deal.name ? ` · ${String(deal.name).slice(0, 60)}` : '');

  run(
    `INSERT INTO deal_payments (
       id, deal_id, kind, amount, status, qrc_id, payload, image_png_base64, account, purpose, meta_json
     ) VALUES (?, ?, 'cash', ?, 'paid', '', '', '', '', ?, ?)`,
    [
      id,
      dealId,
      amount,
      purpose,
      JSON.stringify({
        source: 'cash_accept',
        covers,
        accepted_at: new Date().toISOString(),
        accepted_by: actor || null,
        sto: Number(deal.is_sto) === 1 || Boolean(deal.amo_sto),
      }),
    ]
  );

  const synced = syncDealPaidStatus(dealId);
  let warehouseTask: { created: boolean; task: Record<string, unknown> | null; reason?: string } | null =
    null;
  if (synced.paid) {
    try {
      run(
        `UPDATE payment_links SET status = 'paid', paid_at = datetime('now')
         WHERE deal_id = ? AND status = 'pending'`,
        [dealId]
      );
      run(
        `UPDATE stock_reserves SET status = 'sold', released_at = datetime('now')
         WHERE deal_id = ? AND status = 'active'`,
        [dealId]
      );
    } catch {
      /* ignore */
    }
    try {
      warehouseTask = ensureWarehouseTaskAfterPaid({ dealId });
    } catch {
      warehouseTask = null;
    }
    try {
      ensureOrderDocChain(dealId);
    } catch {
      /* ignore */
    }
  }

  let cashDoc: Record<string, unknown> | null = null;
  let cashDocError: string | null = null;
  if (!input.skip_cash_doc) {
    try {
      const cpId = String(
        deal.counterparty_id || deal.buyer_counterparty_id || deal.company_counterparty_id || ''
      ).trim();
      cashDoc = createCashDoc({
        doc_type: 'in',
        amount,
        counterparty_id: cpId || undefined,
        cash_register_id: input.cash_register_id,
        comment: `Нал · ${coversLabel} · сделка ${dealId}${actor ? ' · ' + actor : ''}`,
      }) as Record<string, unknown>;
      if (cashDoc?.id) {
        run(`UPDATE deal_payments SET meta_json = ? WHERE id = ?`, [
          JSON.stringify({
            source: 'cash_accept',
            covers,
            accepted_at: new Date().toISOString(),
            accepted_by: actor || null,
            sto: Number(deal.is_sto) === 1 || Boolean(deal.amo_sto),
            cash_doc_id: String(cashDoc.id),
          }),
          id,
        ]);
      }
    } catch (e) {
      cashDocError = e instanceof Error ? e.message : 'cash_doc failed';
    }
  }

  return {
    ok: true,
    deal_id: dealId,
    payment: getDealPayment(id),
    source: 'cash',
    warehouse_task: warehouseTask,
    cash_doc: cashDoc,
    cash_doc_error: cashDocError,
    cash_received: true,
    covers,
    payment_split: synced.split,
    fully_paid: synced.paid,
    payment_status: synced.payment_status,
  };
}

function isPaymentAlreadyPaid(status: string): boolean {
  return PAID_STATUSES.has(String(status || '').toLowerCase());
}

type PendingPaymentRow = {
  id: string;
  deal_id: string;
  qrc_id: string;
  status: string;
  amount: number;
};

/** Неоплаченные СБП QR с qrc_id (для poll Точки). */
export function listPendingSbpPayments(opts?: { dealId?: string; limit?: number }): PendingPaymentRow[] {
  const limit = Math.min(Math.max(Number(opts?.limit) || 40, 1), 100);
  if (opts?.dealId) {
    return all(
      `SELECT id, deal_id, qrc_id, status, amount FROM deal_payments
       WHERE deal_id = ? AND kind = 'sbp_qr' AND qrc_id != ''
         AND lower(status) NOT IN ('paid','confirmed','success','accepted','cancelled','canceled','superseded')
       ORDER BY datetime(created_at) DESC LIMIT ?`,
      [String(opts.dealId), limit]
    ) as PendingPaymentRow[];
  }
  return all(
    `SELECT id, deal_id, qrc_id, status, amount FROM deal_payments
     WHERE kind = 'sbp_qr' AND qrc_id != ''
       AND lower(status) NOT IN ('paid','confirmed','success','accepted','cancelled','canceled','superseded')
       AND datetime(created_at) >= datetime('now', '-14 days')
     ORDER BY datetime(created_at) DESC LIMIT ?`,
    [limit]
  ) as PendingPaymentRow[];
}

type BankStatusItem = {
  qrc_id?: string;
  status?: string;
  paid?: boolean;
};

/**
 * Опрос Точки (через bank-прокси) по незакрытым QR → mark paid при Accepted.
 */
export async function pollPendingSbpPayments(opts?: {
  dealId?: string;
  limit?: number;
}): Promise<{
  ok: boolean;
  checked: number;
  marked: number;
  items: Array<{
    payment_id: string;
    deal_id: string;
    qrc_id: string;
    bank_status: string;
    paid: boolean;
    marked: boolean;
  }>;
  error?: string;
  warehouse_task?: unknown;
}> {
  const key = bankSbpKey();
  if (!key) {
    return { ok: false, checked: 0, marked: 0, items: [], error: 'Не задан BANK_SBP_KEY' };
  }

  const pending = listPendingSbpPayments(opts);
  if (!pending.length) {
    return { ok: true, checked: 0, marked: 0, items: [] };
  }

  const qrcIds = pending.map((p) => p.qrc_id).filter(Boolean);
  const res = await fetch(bankSbpStatusUrl(), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Wms-Key': key,
    },
    body: JSON.stringify({ qrc_ids: qrcIds }),
    signal: AbortSignal.timeout(60_000),
  });
  const raw = await res.text();
  let data: { ok?: boolean; error?: string; items?: BankStatusItem[] } = {};
  try {
    data = JSON.parse(raw) as typeof data;
  } catch {
    return {
      ok: false,
      checked: 0,
      marked: 0,
      items: [],
      error: `Банк: не JSON (${res.status}): ${raw.slice(0, 200)}`,
    };
  }
  if (!res.ok || !data.ok) {
    return {
      ok: false,
      checked: 0,
      marked: 0,
      items: [],
      error: humanizeBankError(String(data.error || `Банк HTTP ${res.status}`)),
    };
  }

  const byQrc = new Map<string, BankStatusItem>();
  for (const it of data.items || []) {
    const qid = String(it.qrc_id || '').trim();
    if (qid) byQrc.set(qid, it);
  }

  const items: Array<{
    payment_id: string;
    deal_id: string;
    qrc_id: string;
    bank_status: string;
    paid: boolean;
    marked: boolean;
  }> = [];
  let marked = 0;
  let lastWarehouseTask: unknown = null;

  for (const p of pending) {
    if (isPaymentAlreadyPaid(p.status)) continue;
    const st = byQrc.get(p.qrc_id);
    const bankStatus = String(st?.status || 'Unknown');
    const paid = Boolean(st?.paid) || bankStatus.toLowerCase() === 'accepted';
    let didMark = false;
    if (paid) {
      const mr = markDealPaymentPaid({ paymentId: p.id, qrcId: p.qrc_id, source: 'tochka_poll' });
      lastWarehouseTask = mr.warehouse_task || lastWarehouseTask;
      didMark = true;
      marked += 1;
    } else if (bankStatus && bankStatus !== 'Unknown' && bankStatus !== String(p.status)) {
      // зеркалим промежуточный статус Точки (NotStarted / InProgress / Rejected)
      run(`UPDATE deal_payments SET status = ? WHERE id = ? AND lower(status) NOT IN ('paid','confirmed','success','accepted')`, [
        bankStatus,
        p.id,
      ]);
    }
    items.push({
      payment_id: p.id,
      deal_id: p.deal_id,
      qrc_id: p.qrc_id,
      bank_status: bankStatus,
      paid,
      marked: didMark,
    });
  }

  return { ok: true, checked: pending.length, marked, items, warehouse_task: lastWarehouseTask };
}
