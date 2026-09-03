/**
 * Корзины оплаты заказа: товар / услуги / всё.
 * Вынесено отдельно, чтобы deals.ts и payments.ts не зацикливались.
 */
import { all, run } from './db.js';

export type PaymentCovers = 'goods' | 'services' | 'all';

const PAID_STATUSES = new Set(['paid', 'confirmed', 'success', 'accepted']);

function roundMoney(n: number): number {
  return Math.round(Number(n) || 0);
}

function parsePaymentMeta(raw: unknown): Record<string, unknown> {
  try {
    const o = JSON.parse(String(raw || '{}'));
    return o && typeof o === 'object' ? (o as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export function paymentCoversOf(row: { meta_json?: string; kind?: string }): PaymentCovers {
  const meta = parsePaymentMeta(row.meta_json);
  const c = String(meta.covers || '').toLowerCase();
  if (c === 'goods' || c === 'product' || c === 'товар') return 'goods';
  if (c === 'services' || c === 'service' || c === 'услуги' || c === 'услуга') return 'services';
  return 'all';
}

/** Суммы заказа: товары / услуги / всего (по item_kind позиций). */
export function getDealBasketTotals(dealId: string): {
  goods: number;
  services: number;
  total: number;
} {
  const rows = all<{ item_kind: string; amount: number }>(
    `SELECT
       CASE
         WHEN IFNULL(p.item_kind,'product') = 'service' THEN 'service'
         WHEN lower(replace(IFNULL(u.short_name,''), '.', '')) IN ('усл','услуга','услуг') THEN 'service'
         ELSE 'product'
       END AS item_kind,
       IFNULL(i.amount, IFNULL(i.qty,0) * IFNULL(i.price,0)) AS amount
     FROM crm_deal_items i
     LEFT JOIN products p ON p.id = NULLIF(TRIM(IFNULL(i.product_guid,'')), '')
     LEFT JOIN units u ON u.id = p.unit_id
     WHERE i.deal_id = ?`,
    [dealId]
  );
  let goods = 0;
  let services = 0;
  for (const r of rows) {
    const a = Number(r.amount) || 0;
    if (r.item_kind === 'service') services += a;
    else goods += a;
  }
  goods = roundMoney(goods);
  services = roundMoney(services);
  return { goods, services, total: roundMoney(goods + services) };
}

/**
 * Сколько уже оплачено по корзинам.
 * covers=goods|services — в свою корзину;
 * covers=all — сначала закрывает остаток товаров, потом услуг.
 */
export function getDealPaymentSplit(dealId: string): {
  goods: number;
  services: number;
  total: number;
  paid_goods: number;
  paid_services: number;
  paid_total: number;
  due_goods: number;
  due_services: number;
  due_total: number;
  fully_paid: boolean;
  partial: boolean;
} {
  const basket = getDealBasketTotals(dealId);
  const pays = all<{ amount: number; status: string; meta_json: string; kind: string }>(
    `SELECT amount, status, IFNULL(meta_json,'{}') AS meta_json, kind
     FROM deal_payments WHERE deal_id = ?`,
    [dealId]
  );
  let paidGoods = 0;
  let paidServices = 0;
  let paidAll = 0;
  for (const p of pays) {
    if (!PAID_STATUSES.has(String(p.status || '').toLowerCase())) continue;
    const amt = Number(p.amount) || 0;
    if (!(amt > 0)) continue;
    const covers = paymentCoversOf(p);
    if (covers === 'goods') paidGoods += amt;
    else if (covers === 'services') paidServices += amt;
    else paidAll += amt;
  }
  paidGoods = roundMoney(paidGoods);
  paidServices = roundMoney(paidServices);
  paidAll = roundMoney(paidAll);

  let gRem = Math.max(0, roundMoney(basket.goods - paidGoods));
  let sRem = Math.max(0, roundMoney(basket.services - paidServices));
  let pool = paidAll;
  const toGoods = Math.min(gRem, pool);
  pool = roundMoney(pool - toGoods);
  gRem = roundMoney(gRem - toGoods);
  const toServices = Math.min(sRem, pool);
  sRem = roundMoney(sRem - toServices);

  const paid_goods = roundMoney(basket.goods - gRem);
  const paid_services = roundMoney(basket.services - sRem);
  const paid_total = roundMoney(paid_goods + paid_services);
  const due_goods = gRem;
  const due_services = sRem;
  const due_total = roundMoney(due_goods + due_services);
  const fully_paid = basket.total > 0 ? due_total <= 0.009 : paid_total > 0;
  const partial = !fully_paid && paid_total > 0.009;

  return {
    goods: basket.goods,
    services: basket.services,
    total: basket.total,
    paid_goods,
    paid_services,
    paid_total,
    due_goods,
    due_services,
    due_total,
    fully_paid,
    partial,
  };
}

/** Выставить paid / partial по фактическим оплатам и корзинам. */
export function syncDealPaidStatus(dealId: string): {
  split: ReturnType<typeof getDealPaymentSplit>;
  paid: boolean;
  payment_status: string;
} {
  const split = getDealPaymentSplit(dealId);
  const payment_status = split.fully_paid ? 'paid' : split.partial ? 'partial' : '';
  const paidFlag = split.fully_paid ? 1 : 0;
  try {
    run(
      `UPDATE crm_deals SET paid = ?, payment_status = ?, updated_at = datetime('now') WHERE id = ?`,
      [paidFlag, payment_status, dealId]
    );
  } catch {
    run(`UPDATE crm_deals SET paid = ?, payment_status = ? WHERE id = ?`, [
      paidFlag,
      payment_status,
      dealId,
    ]);
  }
  const invoiceStatus = split.fully_paid ? 'paid' : split.partial ? 'partial' : 'issued';
  try {
    run(
      `UPDATE sales_docs SET status = ? WHERE deal_id = ? AND doc_type = 'invoice'`,
      [invoiceStatus, dealId]
    );
  } catch {
    /* ignore */
  }
  if (split.fully_paid) {
    try {
      run(
        `UPDATE payment_links SET status = 'cancelled', expired_at = datetime('now')
         WHERE deal_id = ? AND status = 'pending'`,
        [dealId]
      );
    } catch {
      /* payment_links */
    }
  }
  return { split, paid: !!paidFlag, payment_status };
}

export function roundDealMoney(n: number): number {
  return roundMoney(n);
}
