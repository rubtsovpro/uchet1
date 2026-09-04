/**
 * Т‑Банк Forma (рассрочка): HTTP-уведомления → оплата сделки + уведомление ответственному.
 * orderNumber при создании анкеты = id сделки/лида Amo (= crm_deals.id).
 */
import { all, get, run } from './db.js';
import { newGuid } from './ids.js';
import { syncDealPaidStatus } from './deal-payment-split.js';
import { markPaymentLinkPaidForDeal } from './payment-links.js';
import { notifyDealResponsible } from './staff-notifications.js';
import { ensureWarehouseTaskAfterPaid } from './sales-pipeline.js';
import { ensureOrderDocChain } from './order-doc-tree.js';

function asBool(v: unknown): boolean {
  return v === true || v === 1 || v === '1' || String(v).toLowerCase() === 'true';
}

function dealIdFromFormaOrder(raw: string): string {
  const s = String(raw || '').trim();
  if (!s) return '';
  // «25496085» или «amo-25496085-xxxx»
  const m = s.match(/(\d{5,})/);
  return m ? m[1] : s;
}

async function runTbankFormaPostPaidHooks(opts: {
  dealId: string;
  dealName?: string;
  payAmount: number;
  payId: string;
}): Promise<{ amo: unknown; automation: unknown }> {
  const { pushDealPaidToAmo } = await import('./amo-deal-paid.js');
  const amo = await pushDealPaidToAmo({ dealId: opts.dealId, source: 'tbank_forma' });

  const { runPostPaymentAutomation } = await import('./post-payment-automation.js');
  const automation = await runPostPaymentAutomation({
    dealId: opts.dealId,
    source: 'tbank_forma',
    username: 'tbank_forma',
    amount: opts.payAmount > 0 ? opts.payAmount : undefined,
    channel: 'tbank',
    paymentId: opts.payId,
    amoAlreadyPaid: amo?.ok === true && (amo as { already_paid?: boolean }).already_paid === true,
  });

  return { amo, automation };
}

function dealHasFullFiscal(dealId: string): boolean {
  const row = get<{ c: number }>(
    `SELECT COUNT(*) AS c FROM fiscal_receipts
     WHERE deal_id = ? AND kind = 'full'
       AND lower(IFNULL(status,'')) NOT IN ('error','cancelled','canceled')`,
    [dealId]
  );
  return Number(row?.c || 0) > 0;
}

export async function applyTbankFormaWebhook(payload: Record<string, unknown>) {
  const orderRaw = String(payload.id || payload.orderNumber || payload.order_number || '').trim();
  const status = String(payload.status || '').toLowerCase().trim();
  const committed = asBool(payload.committed);
  const demo = asBool(payload.demo);
  const dealId = dealIdFromFormaOrder(orderRaw);
  if (!dealId) {
    return { ok: false, error: 'no_order_id', action: 'ignored' as const };
  }
  if (!status) {
    return { ok: false, error: 'no_status', deal_id: dealId, action: 'ignored' as const };
  }

  const deal = get<{ id: string; name?: string; paid?: number; payment_status?: string }>(
    `SELECT id, name, paid, payment_status FROM crm_deals WHERE id = ?`,
    [dealId]
  );
  if (!deal) {
    return { ok: false, error: 'deal_not_found', deal_id: dealId, action: 'ignored' as const };
  }

  const amount =
    Number(payload.order_amount ?? payload.transfer_amount ?? payload.credit_amount ?? 0) || 0;

  // Идемпотентность по событию Forma
  const eventKey = `forma:${orderRaw}:${status}:${committed ? '1' : '0'}`;
  const already = get<{ id: string; amount?: number }>(
    `SELECT id, amount FROM deal_payments
     WHERE deal_id = ? AND IFNULL(meta_json,'') LIKE ?
     LIMIT 1`,
    [dealId, `%"event_key":"${eventKey}"%`]
  );
  if (already?.id && (status === 'signed' || status === 'approved')) {
    // Повторный signed без чека — добить TG / Sheets / фискал
    if (status === 'signed' && !dealHasFullFiscal(dealId)) {
      const payAmount = Number(already.amount) > 0 ? Number(already.amount) : amount;
      const hooks = await runTbankFormaPostPaidHooks({
        dealId,
        dealName: deal.name,
        payAmount,
        payId: already.id,
      });
      return {
        ok: true,
        deal_id: dealId,
        action: 'duplicate_automation' as const,
        status,
        payment_id: already.id,
        ...hooks,
      };
    }
    return {
      ok: true,
      deal_id: dealId,
      action: 'duplicate' as const,
      status,
      payment_id: already.id,
    };
  }

  if (status === 'approved') {
    const n = notifyDealResponsible({
      deal_id: dealId,
      kind: 'tbank_approved',
      title: 'Рассрочка одобрена',
      body: `Сделка ${deal.name || dealId}: банк одобрил Т‑Рассрочку. Ждём подпись клиента.`,
      meta: { forma_status: status, order_id: orderRaw, demo },
    });
    return {
      ok: true,
      deal_id: dealId,
      action: 'notified_approved' as const,
      status,
      notifications: n.created,
    };
  }

  if (status === 'rejected' || status === 'canceled' || status === 'cancelled') {
    const n = notifyDealResponsible({
      deal_id: dealId,
      kind: 'tbank_rejected',
      title: status === 'rejected' ? 'Рассрочка отклонена' : 'Рассрочка отменена',
      body: `Сделка ${deal.name || dealId}: статус Forma «${status}».`,
      meta: { forma_status: status, order_id: orderRaw, demo },
    });
    return {
      ok: true,
      deal_id: dealId,
      action: 'notified_reject' as const,
      status,
      notifications: n.created,
    };
  }

  if (status !== 'signed') {
    return {
      ok: true,
      deal_id: dealId,
      action: 'ignored_status' as const,
      status,
    };
  }

  // signed: считаем оплатой (автоподтверждение Forma / committed)
  // Если committed=false и явно выключено — только уведомление.
  const forceOnSigned =
    String(process.env.TBANK_FORMA_MARK_PAID_ON_SIGNED || '1').trim() !== '0';
  const markPaid = committed || forceOnSigned;

  if (!markPaid) {
    const n = notifyDealResponsible({
      deal_id: dealId,
      kind: 'tbank_signed',
      title: 'Рассрочка подписана',
      body: `Сделка ${deal.name || dealId}: клиент подписал, ждём подтверждение (commit) банка.`,
      meta: { forma_status: status, order_id: orderRaw, committed, demo },
    });
    return {
      ok: true,
      deal_id: dealId,
      action: 'notified_signed_wait_commit' as const,
      status,
      notifications: n.created,
    };
  }

  let payAmount = amount;
  if (!(payAmount > 0)) {
    const price = Number(
      get<{ price?: number }>(`SELECT price FROM crm_deals WHERE id = ?`, [dealId])?.price
    );
    payAmount = price > 0 ? price : 0;
  }

  const payId = newGuid();
  const purpose = `Т‑Рассрочка Forma · заказ ${dealId}` + (deal.name ? ` · ${String(deal.name).slice(0, 60)}` : '');
  const meta = {
    source: 'tbank_forma',
    event_key: eventKey,
    forma_status: status,
    forma_order_id: orderRaw,
    committed,
    demo,
    product: payload.product || null,
    term: payload.term || null,
    loan_number: payload.loan_number || null,
  };
  run(
    `INSERT INTO deal_payments (
       id, deal_id, kind, amount, status, qrc_id, payload, image_png_base64, account, purpose, meta_json
     ) VALUES (?, ?, 'tbank_installment', ?, 'paid', '', '', '', '', ?, ?)`,
    [payId, dealId, Math.max(0, payAmount), purpose, JSON.stringify(meta)]
  );

  try {
    markPaymentLinkPaidForDeal(dealId, 'tbank_forma');
  } catch {
    /* */
  }
  const synced = syncDealPaidStatus(dealId);
  let warehouseTask: unknown = null;
  if (synced.paid) {
    try {
      warehouseTask = ensureWarehouseTaskAfterPaid({ dealId });
    } catch {
      warehouseTask = null;
    }
    try {
      ensureOrderDocChain(dealId);
    } catch {
      /* */
    }
  }

  const n = notifyDealResponsible({
    deal_id: dealId,
    kind: 'deal_paid_tbank',
    title: 'Сделка оплачена · рассрочка',
    body: `Сделка ${deal.name || dealId} оплачена через Т‑Рассрочку${
      payAmount > 0 ? ` · ${Math.round(payAmount).toLocaleString('ru-RU')} ₽` : ''
    }. Чек и разноска уходят автоматически.`,
    meta: { forma_status: status, order_id: orderRaw, payment_id: payId, demo },
  });

  const hooks = await runTbankFormaPostPaidHooks({
    dealId,
    dealName: deal.name,
    payAmount,
    payId,
  });

  return {
    ok: true,
    deal_id: dealId,
    action: 'marked_paid' as const,
    status,
    committed,
    payment_id: payId,
    fully_paid: synced.paid,
    payment_status: synced.payment_status,
    notifications: n.created,
    warehouse_task: warehouseTask,
    amo: hooks.amo,
    automation: hooks.automation,
  };
}

/** Диагностика: последние платежи Forma по сделке. */
export function listTbankFormaPayments(dealId: string) {
  return all(
    `SELECT id, amount, status, purpose, meta_json, created_at
     FROM deal_payments
     WHERE deal_id = ? AND kind = 'tbank_installment'
     ORDER BY datetime(created_at) DESC LIMIT 20`,
    [String(dealId || '').trim()]
  );
}
