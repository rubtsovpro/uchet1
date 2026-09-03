/**
 * Структура подчинения по заказу покупателя:
 * Заказ → Расходная накладная (списание при товарах, в т.ч. СТО/автосервис)
 *         → Операция по платёжным картам
 *
 * Внутренние перемещения между складами — в разделе Склад, не в цепочке продажи.
 * OData 1С публикует только приход/расход — остальные документы ведутся локально.
 */
import { all, get, run } from './db.js';
import { createCardOp } from './menu-parity.js';
import { createThinJournalDoc } from './parity-batch-a.js';
import { getDealPaymentSplit } from './deal-payment-split.js';
import { buildDealSaleRules } from './deal-sale-rules.js';

/** Черновик заказа на перемещение по сделке — можно до оплаты, без резерва. */
export function ensureDealTransferOrderDraft(dealIdRaw: string): {
  created: boolean;
  id?: string;
  number?: string;
  already?: boolean;
} {
  const dealId = String(dealIdRaw || '').trim();
  if (!dealId) return { created: false };
  const existing = listTransferOrdersForDeal(dealId);
  if (existing.length) {
    return {
      created: false,
      already: true,
      id: existing[0].id,
      number: existing[0].number,
    };
  }
  if (listStoRequestsForDeal(dealId).length) {
    return { created: false, already: true };
  }
  if (!dealHasGoods(dealId)) return { created: false };
  const deal = get<{ id: string; name: string }>(
    `SELECT id, IFNULL(name,'') AS name FROM crm_deals WHERE id = ?`,
    [dealId]
  );
  if (!deal) return { created: false };
  const row = createThinJournalDoc('transfer_orders', {
    counterparty_name: String(deal.name || '').slice(0, 120),
    comment: `По заказу покупателя · сделка ${dealId}`,
    status: 'new',
    amount: 0,
    payload_json: JSON.stringify({
      kind: 'transfer_order',
      deal_id: dealId,
      stock_doc_id: '',
      auto: true,
      note: 'Можно до оплаты · без резерва; заказ не закрывать, пока деньги не приняты',
    }),
  }) as { id?: string; number?: string } | null;
  if (!row?.id) return { created: false };
  return { created: true, id: String(row.id), number: String(row.number || '') };
}

function dealIsPaid(dealId: string): boolean {
  const paid = get<{ c: number }>(
    `SELECT COUNT(*) AS c FROM deal_payments
     WHERE deal_id = ? AND status IN ('paid','confirmed','success','active')`,
    [dealId]
  )?.c;
  if (paid && paid > 0) return true;
  const d = get<{ payment_status?: string; paid?: number }>(
    `SELECT payment_status, paid FROM crm_deals WHERE id = ?`,
    [dealId]
  );
  if (!d) return false;
  if (Number(d.paid) === 1) return true;
  const ps = String(d.payment_status || '').toLowerCase();
  return ['paid', 'оплачен', 'оплачено', 'success'].includes(ps);
}

export type OrderDocKind =
  | 'customer_order'
  | 'transfer_order'
  | 'stock_transfer'
  | 'out'
  | 'card_op'
  | 'sales_doc'
  | 'warehouse_task'
  | 'sto_transfer';

export type OrderDocNode = {
  kind: OrderDocKind;
  label: string;
  id: string;
  number: string;
  doc_date: string;
  posted: boolean;
  amount: number;
  status: string;
  required: boolean;
  present: boolean;
  open: { type: string; id: string } | null;
  children: OrderDocNode[];
  comment?: string;
  /** Тип sales_docs / чека — для UI. */
  doc_type?: string;
  /** Подсветка: неоплата, нет чека и т.п. */
  alert?: boolean;
  alert_tip?: string;
};

export type OrderDocTree = {
  deal_id: string;
  complete: boolean;
  missing: string[];
  /** Есть товары (не услуги) — нужно списание для списания. */
  need_stock_out?: boolean;
  has_goods?: boolean;
  note: string;
  root: OrderDocNode;
};

function parsePayload(raw: string): Record<string, unknown> {
  try {
    const p = JSON.parse(String(raw || '') || '{}');
    return p && typeof p === 'object' && !Array.isArray(p) ? (p as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function dealHasGoods(dealId: string): boolean {
  /** Только товары (не услуги) — услуги в расходную не входят. */
  const row = get<{ c: number }>(
    `SELECT COUNT(*) AS c
     FROM crm_deal_items i
     LEFT JOIN products p ON p.id = NULLIF(TRIM(IFNULL(i.product_guid,'')), '')
     WHERE i.deal_id = ?
       AND IFNULL(i.product_guid,'') != ''
       AND IFNULL(i.qty,0) > 0
       AND IFNULL(p.item_kind, 'product') != 'service'`,
    [dealId]
  );
  return (Number(row?.c) || 0) > 0;
}

function listTransferOrdersForDeal(dealId: string) {
  return all<{
    id: string;
    number: string;
    doc_date: string;
    status: string;
    amount: number;
    comment: string;
    payload_json: string;
  }>(
    `SELECT id, number, doc_date, status, IFNULL(amount,0) AS amount,
            IFNULL(comment,'') AS comment, IFNULL(payload_json,'') AS payload_json
     FROM thin_journal_docs
     WHERE journal_key = 'transfer_orders'
       AND (
         payload_json LIKE ?
         OR payload_json LIKE ?
         OR comment LIKE ?
       )
     ORDER BY datetime(created_at) DESC
     LIMIT 20`,
    [`%"deal_id":"${dealId}"%`, `%"deal_id": "${dealId}"%`, `%сделка ${dealId}%`]
  ).filter((row) => {
    const p = parsePayload(row.payload_json);
    return String(p.deal_id || '').trim() === dealId || row.comment.includes(`сделка ${dealId}`);
  });
}

function listStockTransfersForDeal(dealId: string) {
  return all<{
    id: string;
    number: string;
    doc_date: string;
    posted: number;
    amount: number;
    comment: string;
  }>(
    `SELECT id, number, IFNULL(doc_date,'') AS doc_date, IFNULL(posted,0) AS posted,
            IFNULL(amount,0) AS amount, IFNULL(comment,'') AS comment
     FROM stock_docs
     WHERE doc_type = 'transfer'
       AND (
         IFNULL(deal_id,'') = ?
         OR IFNULL(basis_order_id,'') = ?
         OR comment LIKE ?
       )
     ORDER BY datetime(doc_date) DESC, number DESC
     LIMIT 20`,
    [dealId, dealId, `%сделка ${dealId}%`]
  );
}

function listOutsForDeal(dealId: string) {
  return all<{
    id: string;
    number: string;
    doc_date: string;
    posted: number;
    amount: number;
    comment: string;
  }>(
    `SELECT id, number, IFNULL(doc_date,'') AS doc_date, IFNULL(posted,0) AS posted,
            IFNULL(amount,0) AS amount, IFNULL(comment,'') AS comment
     FROM stock_docs
     WHERE doc_type = 'out'
       AND (IFNULL(deal_id,'') = ? OR IFNULL(basis_order_id,'') = ?)
     ORDER BY datetime(doc_date) DESC, number DESC
     LIMIT 20`,
    [dealId, dealId]
  );
}

function listCardOpsForDeal(dealId: string, outIds: string[]) {
  const byDeal = all<{
    id: string;
    number: string;
    doc_date: string;
    amount: number;
    status: string;
    comment: string;
    stock_doc_id: string;
  }>(
    `SELECT id, number, doc_date, IFNULL(amount,0) AS amount, IFNULL(status,'') AS status,
            IFNULL(comment,'') AS comment, IFNULL(stock_doc_id,'') AS stock_doc_id
     FROM card_ops
     WHERE IFNULL(deal_id,'') = ?
     ORDER BY datetime(doc_date) DESC, number DESC
     LIMIT 20`,
    [dealId]
  );
  if (!outIds.length) return byDeal;
  const placeholders = outIds.map(() => '?').join(',');
  const byOut = all<{
    id: string;
    number: string;
    doc_date: string;
    amount: number;
    status: string;
    comment: string;
    stock_doc_id: string;
  }>(
    `SELECT id, number, doc_date, IFNULL(amount,0) AS amount, IFNULL(status,'') AS status,
            IFNULL(comment,'') AS comment, IFNULL(stock_doc_id,'') AS stock_doc_id
     FROM card_ops
     WHERE stock_doc_id IN (${placeholders})
     ORDER BY datetime(doc_date) DESC, number DESC
     LIMIT 20`,
    outIds
  );
  const seen = new Set(byDeal.map((r) => r.id));
  for (const r of byOut) {
    if (!seen.has(r.id)) byDeal.push(r);
  }
  return byDeal;
}

function listStoRequestsForDeal(dealId: string) {
  return all<{
    id: string;
    number: string;
    status: string;
    created_at: string;
    comment: string;
  }>(
    `SELECT id, number, status, created_at, IFNULL(comment,'') AS comment
     FROM sto_transfer_requests
     WHERE deal_id = ?
     ORDER BY datetime(created_at) DESC
     LIMIT 10`,
    [dealId]
  );
}

function listWarehouseTasksForDeal(dealId: string) {
  return all<{
    id: string;
    number: string;
    status: string;
    created_at: string;
    stock_doc_id: string;
  }>(
    `SELECT id, number, status, created_at, IFNULL(stock_doc_id,'') AS stock_doc_id
     FROM warehouse_tasks
     WHERE deal_id = ?
     ORDER BY datetime(created_at) DESC
     LIMIT 10`,
    [dealId]
  );
}

function listFiscalForDeal(dealId: string) {
  return all<{ id: string; kind: string; status: string; created_at: string }>(
    `SELECT id, IFNULL(kind,'') AS kind, IFNULL(status,'') AS status,
            IFNULL(created_at,'') AS created_at
     FROM fiscal_receipts WHERE deal_id = ?
     ORDER BY datetime(created_at) DESC LIMIT 40`,
    [dealId]
  );
}

function listPaymentsForDeal(dealId: string) {
  return all<{ id: string; kind: string; status: string; amount: number }>(
    `SELECT id, IFNULL(kind,'') AS kind, IFNULL(status,'') AS status, IFNULL(amount,0) AS amount
     FROM deal_payments WHERE deal_id = ?
     ORDER BY datetime(created_at) DESC LIMIT 40`,
    [dealId]
  );
}

function fiscalOk(
  rows: Array<{ kind: string; status: string }>,
  kinds: string[]
): boolean {
  const bad = new Set(['error', 'cancelled', 'canceled']);
  const want = new Set(kinds);
  return rows.some(
    (f) => want.has(String(f.kind || '')) && !bad.has(String(f.status || '').toLowerCase())
  );
}

function listSalesDocsForDeal(dealId: string) {
  return all<{
    id: string;
    number: string;
    doc_date: string;
    doc_type: string;
    total: number;
    status: string;
  }>(
    `SELECT id, number, IFNULL(doc_date,'') AS doc_date, IFNULL(doc_type,'') AS doc_type,
            IFNULL(total,0) AS total, IFNULL(status,'') AS status
     FROM sales_docs WHERE deal_id = ?
     ORDER BY datetime(created_at) DESC LIMIT 20`,
    [dealId]
  );
}

function placeholder(kind: OrderDocKind, label: string, required: boolean): OrderDocNode {
  return {
    kind,
    label,
    id: '',
    number: '—',
    doc_date: '',
    posted: false,
    amount: 0,
    status: 'missing',
    required,
    present: false,
    open: null,
    children: [],
  };
}

/** Дерево документов по сделке (= заказ покупателя). */
export function buildOrderDocTree(dealIdRaw: string): OrderDocTree | null {
  const dealId = String(dealIdRaw || '').trim();
  if (!dealId) return null;
  const deal = get<{
    id: string;
    name: string;
    price: number;
    updated_at: string;
    created_at: string;
    is_sto: number;
    paid: number;
    payment_status: string;
    amo_channel: string;
    amo_pay_method: string;
    amo_payment_type: string;
    amo_shipment: string;
    ship_channel: string;
    buyer_kind: string;
    buyer_inn: string;
    is_partner: number;
    is_legal_entity: number;
    client_role: string;
  }>(
    `SELECT id, IFNULL(name,'') AS name, IFNULL(price,0) AS price,
            IFNULL(updated_at,'') AS updated_at, IFNULL(created_at,'') AS created_at,
            IFNULL(is_sto,0) AS is_sto, IFNULL(paid,0) AS paid,
            IFNULL(payment_status,'') AS payment_status,
            IFNULL(amo_channel,'') AS amo_channel,
            IFNULL(amo_pay_method,'') AS amo_pay_method,
            IFNULL(amo_payment_type,'') AS amo_payment_type,
            IFNULL(amo_shipment,'') AS amo_shipment,
            IFNULL(ship_channel,'') AS ship_channel,
            IFNULL(buyer_kind,'') AS buyer_kind,
            IFNULL(buyer_inn,'') AS buyer_inn,
            IFNULL(is_partner,0) AS is_partner,
            IFNULL(is_legal_entity,0) AS is_legal_entity,
            IFNULL(client_role,'client') AS client_role
     FROM crm_deals WHERE id = ?`,
    [dealId]
  );
  if (!deal) return null;

  const hasGoods = dealHasGoods(dealId);
  const payments = listPaymentsForDeal(dealId);
  const fiscalRows = listFiscalForDeal(dealId);
  const split = getDealPaymentSplit(dealId);
  const unpaid = Number(split.due_total) > 0.009;
  const paid = !unpaid && (dealIsPaid(dealId) || Number(deal.paid) === 1);
  const dealForRules: Record<string, unknown> = {
    ...deal,
    id: dealId,
    payments,
    fiscal_receipts: fiscalRows,
  };
  const rules = buildDealSaleRules(dealForRules);
  const allowUnpaid =
    rules.payment_scheme === 'cod' || rules.payment_scheme === 'credit';
  // При продаже факт выдачи/списания — расходная (в т.ч. СТО / автосервис).
  // Внутренние «заказы на перемещение» между складами — отдельно в разделе Склад, не в цепочке продажи.
  const needOut = hasGoods;
  const needCard = paid;

  const transferOrders = listTransferOrdersForDeal(dealId);
  const stoReqs = listStoRequestsForDeal(dealId);
  const stockTransfers = listStockTransfersForDeal(dealId);
  const outs = listOutsForDeal(dealId);
  const cardOps = listCardOpsForDeal(
    dealId,
    outs.map((o) => o.id)
  );
  const tasks = listWarehouseTasksForDeal(dealId);
  const salesDocs = listSalesDocsForDeal(dealId);

  // Перемещение запасов — только если уже есть (не обязательно, не блокирует complete)
  const transferChildren: OrderDocNode[] = [];
  for (const t of stockTransfers) {
    transferChildren.push({
      kind: 'stock_transfer',
      label: 'Перемещение запасов',
      id: t.id,
      number: t.number,
      doc_date: String(t.doc_date || '').slice(0, 10),
      posted: Boolean(t.posted),
      amount: Number(t.amount) || 0,
      status: t.posted ? 'posted' : 'draft',
      required: false,
      present: true,
      open: { type: 'doc', id: t.id },
      children: [],
      comment: t.comment,
    });
  }
  // Перемещения из payload заказа на перемещение, если ещё не в stockTransfers
  for (const to of transferOrders) {
    const p = parsePayload(to.payload_json);
    const sid = String(p.stock_doc_id || '').trim();
    if (!sid || transferChildren.some((c) => c.id === sid)) continue;
    const st = get<{
      id: string;
      number: string;
      doc_date: string;
      posted: number;
      amount: number;
      comment: string;
    }>(
      `SELECT id, number, IFNULL(doc_date,'') AS doc_date, IFNULL(posted,0) AS posted,
              IFNULL(amount,0) AS amount, IFNULL(comment,'') AS comment
       FROM stock_docs WHERE id = ?`,
      [sid]
    );
    if (st) {
      transferChildren.push({
        kind: 'stock_transfer',
        label: 'Перемещение запасов',
        id: st.id,
        number: st.number,
        doc_date: String(st.doc_date || '').slice(0, 10),
        posted: Boolean(st.posted),
        amount: Number(st.amount) || 0,
        status: st.posted ? 'posted' : 'draft',
        required: false,
        present: true,
        open: { type: 'doc', id: st.id },
        children: [],
        comment: st.comment,
      });
    }
  }

  // Старые заказы на перемещение по сделке — справочно (не обязательны в цепочке продажи)
  const transferOrderNodes: OrderDocNode[] = transferOrders.map((to) => ({
    kind: 'transfer_order' as const,
    label: 'Перемещение между складами',
    id: to.id,
    number: to.number,
    doc_date: String(to.doc_date || '').slice(0, 10),
    posted: String(to.status || '') === 'done',
    amount: Number(to.amount) || 0,
    status: String(to.status || 'draft'),
    required: false,
    present: true,
    open: { type: 'transfer_order', id: to.id },
    children: transferChildren.filter((c) => {
      const p = parsePayload(to.payload_json);
      const sid = String(p.stock_doc_id || '').trim();
      return !sid || c.id === sid;
    }),
    comment: to.comment,
  }));

  for (const sr of stoReqs) {
    if (transferOrderNodes.some((n) => n.id === sr.id)) continue;
    transferOrderNodes.push({
      kind: 'sto_transfer',
      label: 'Перемещение СТО',
      id: sr.id,
      number: sr.number,
      doc_date: String(sr.created_at || '').slice(0, 10),
      posted: String(sr.status || '') === 'done',
      amount: 0,
      status: String(sr.status || ''),
      required: false,
      present: true,
      open: { type: 'sto_transfer', id: sr.id },
      children: transferChildren,
      comment: sr.comment,
    });
  }

  if (transferOrderNodes.length === 1 && transferOrderNodes[0].children.length === 0) {
    transferOrderNodes[0].children = transferChildren;
  } else if (transferOrderNodes.length > 1) {
    for (const n of transferOrderNodes) {
      if (!n.children.length && transferChildren.length) {
        n.children = transferChildren;
      }
    }
  }

  const outNodes: OrderDocNode[] = outs.map((o) => {
    const cards = cardOps.filter((c) => !c.stock_doc_id || c.stock_doc_id === o.id);
    const cardChildren: OrderDocNode[] =
      cards.length > 0
        ? cards.map((c) => ({
            kind: 'card_op' as const,
            label: 'Операция по платёжным картам',
            id: c.id,
            number: c.number,
            doc_date: String(c.doc_date || '').slice(0, 10),
            posted: String(c.status || '') === 'ok',
            amount: Number(c.amount) || 0,
            status: String(c.status || ''),
            required: needCard,
            present: true,
            open: { type: 'card_op', id: c.id },
            children: [],
            comment: c.comment,
          }))
        : needCard
          ? [placeholder('card_op', 'Операция по платёжным картам', true)]
          : [];
    return {
      kind: 'out' as const,
      label: 'Расходная накладная',
      id: o.id,
      number: o.number,
      doc_date: String(o.doc_date || '').slice(0, 10),
      posted: Boolean(o.posted),
      amount: Number(o.amount) || 0,
      status: o.posted ? 'posted' : 'draft',
      required: needOut,
      present: true,
      open: { type: 'doc', id: o.id },
      children: cardChildren,
      comment: o.comment,
    };
  });

  if (needOut && !outNodes.length) {
    const ph = placeholder('out', 'Расходная накладная', true);
    if (needCard) {
      ph.children = [placeholder('card_op', 'Операция по платёжным картам', true)];
    }
    outNodes.push(ph);
  } else if (outNodes.length && needCard && !cardOps.length) {
    for (const o of outNodes) {
      if (!o.children.length) {
        o.children = [placeholder('card_op', 'Операция по платёжным картам', true)];
      }
    }
  } else if (!outs.length && cardOps.length) {
    // Оплата без расходной — всё равно показать
    outNodes.push({
      ...placeholder('out', 'Расходная накладная', needOut),
      children: cardOps.map((c) => ({
        kind: 'card_op' as const,
        label: 'Операция по платёжным картам',
        id: c.id,
        number: c.number,
        doc_date: String(c.doc_date || '').slice(0, 10),
        posted: String(c.status || '') === 'ok',
        amount: Number(c.amount) || 0,
        status: String(c.status || ''),
        required: needCard,
        present: true,
        open: { type: 'card_op', id: c.id },
        children: [],
        comment: c.comment,
      })),
    });
  }

  // Сначала расходные (списание со склада), затем справочные складские заявки
  const rootChildren: OrderDocNode[] = [...outNodes, ...transferOrderNodes];

  // Дополнительно: задания склада и sales-docs
  for (const t of tasks) {
    rootChildren.push({
      kind: 'warehouse_task',
      label: 'Задание склада',
      id: t.id,
      number: t.number,
      doc_date: String(t.created_at || '').slice(0, 10),
      posted: ['handed', 'shipped', 'done'].includes(String(t.status || '')),
      amount: 0,
      status: String(t.status || ''),
      required: false,
      present: true,
      open: { type: 'warehouse_task', id: t.id },
      children: [],
    });
  }

  const hasAdvance = fiscalOk(fiscalRows, ['advance']);
  const hasFull = fiscalOk(fiscalRows, ['full']);
  const hasSell = hasAdvance || hasFull;
  const fiscalNeed = rules.fiscal_need;
  const invoiceUnpaidAlert =
    unpaid && !allowUnpaid
      ? 'Счёт не оплачен — деньги от клиента ещё не приняты'
      : '';

  let fiscalAlertTip = '';
  if (fiscalNeed !== 'none') {
    if ((paid || !unpaid) && !hasSell) {
      fiscalAlertTip =
        fiscalNeed === 'full_only'
          ? 'Оплачено — нужно выбить чек АТОЛ (полный)'
          : 'Нужно выбить чек АТОЛ (аванс / полный)';
    } else if (fiscalNeed === 'advance_then_full' && hasAdvance && outs.length && !hasFull) {
      fiscalAlertTip = 'Нужен чек 2 (полный расчёт) после выдачи';
    } else if (fiscalNeed === 'full_only' && (paid || outs.length) && !hasFull) {
      fiscalAlertTip = 'Нужно выбить полный чек АТОЛ';
    }
  }

  for (const sd of salesDocs) {
    const labels: Record<string, string> = {
      invoice: 'Счёт',
      upd: 'УПД',
      sf: 'СФ',
      workorder: 'Заказ-наряд',
      contract: 'Договор',
    };
    const isInvoice = String(sd.doc_type || '') === 'invoice';
    const tips: string[] = [];
    if (isInvoice && invoiceUnpaidAlert) tips.push(invoiceUnpaidAlert);
    if (isInvoice && fiscalAlertTip) tips.push(fiscalAlertTip);
    const children: OrderDocNode[] = [];
    if (isInvoice && fiscalNeed !== 'none') {
      if (hasSell) {
        for (const f of fiscalRows.filter((r) =>
          ['advance', 'full'].includes(String(r.kind || ''))
        ).slice(0, 4)) {
          children.push({
            kind: 'sales_doc',
            label: f.kind === 'advance' ? 'Чек · аванс' : 'Чек · полный',
            id: f.id,
            number: '',
            doc_date: String(f.created_at || '').slice(0, 10),
            posted: !['error', 'cancelled', 'canceled'].includes(
              String(f.status || '').toLowerCase()
            ),
            amount: 0,
            status: String(f.status || ''),
            required: false,
            present: true,
            open: { type: 'sales_doc', id: sd.id },
            children: [],
            doc_type: 'fiscal',
          });
        }
      } else {
        children.push({
          ...placeholder('sales_doc', 'Чек АТОЛ', false),
          doc_type: 'fiscal',
          alert: !!fiscalAlertTip || (isInvoice && unpaid && !allowUnpaid),
          alert_tip:
            fiscalAlertTip ||
            (unpaid && !allowUnpaid
              ? 'Чек после оплаты'
              : 'Чек ещё не выбит'),
          comment: fiscalAlertTip || 'Чек ещё не выбит',
        });
      }
    }
    rootChildren.push({
      kind: 'sales_doc',
      label: labels[sd.doc_type] || 'Документ продажи',
      id: sd.id,
      number: sd.number,
      doc_date: String(sd.doc_date || '').slice(0, 10),
      posted: String(sd.status || '') !== 'draft',
      amount: Number(sd.total) || 0,
      status: String(sd.status || ''),
      required: false,
      present: true,
      open: { type: 'sales_doc', id: sd.id },
      children,
      doc_type: String(sd.doc_type || ''),
      alert: tips.length > 0,
      alert_tip: tips.join('. ') || undefined,
    });
  }

  // Если счёта ещё нет, но чек уже «нужен» после оплаты — отдельная строка
  if (
    fiscalNeed !== 'none' &&
    fiscalAlertTip &&
    !salesDocs.some((s) => String(s.doc_type) === 'invoice')
  ) {
    rootChildren.push({
      ...placeholder('sales_doc', 'Чек АТОЛ', false),
      doc_type: 'fiscal',
      alert: true,
      alert_tip: fiscalAlertTip,
    });
  }

  const root: OrderDocNode = {
    kind: 'customer_order',
    label: 'Заказ покупателя',
    id: dealId,
    number: dealId,
    doc_date: String(deal.created_at || deal.updated_at || '').slice(0, 10),
    posted: true,
    amount: Number(deal.price) || 0,
    status: unpaid && !allowUnpaid ? 'unpaid' : paid ? 'paid' : 'open',
    required: true,
    present: true,
    open: { type: 'deal', id: dealId },
    children: rootChildren,
    comment: deal.name,
    alert: unpaid && !allowUnpaid,
    alert_tip:
      unpaid && !allowUnpaid
        ? 'Деньги от клиента ещё не приняты — заказ нельзя закрыть'
        : undefined,
  };

  const missing: string[] = [];
  const walk = (n: OrderDocNode) => {
    if (n.required && !n.present) missing.push(n.label);
    for (const c of n.children) walk(c);
  };
  walk(root);

  return {
    deal_id: dealId,
    complete: missing.length === 0,
    missing,
    need_stock_out: needOut,
    has_goods: hasGoods,
    note:
      'OData 1С публикует только приход/расход. В продаже факт списания — расходная накладная; внутренние перемещения между складами — в разделе Склад. Подсветка: неоплаченный счёт и невыбитый чек.',
    root,
  };
}

/** Создать недостающие обязательные документы цепочки (где это безопасно без складов/остатков). */
export function ensureOrderDocChain(dealIdRaw: string): {
  tree: OrderDocTree | null;
  created: string[];
} {
  const dealId = String(dealIdRaw || '').trim();
  const created: string[] = [];
  if (!dealId) return { tree: null, created };

  const deal = get<{
    id: string;
    price: number;
    is_sto: number;
    name: string;
    amo_channel: string;
  }>(
    `SELECT id, IFNULL(price,0) AS price, IFNULL(is_sto,0) AS is_sto, IFNULL(name,'') AS name,
            IFNULL(amo_channel,'') AS amo_channel
     FROM crm_deals WHERE id = ?`,
    [dealId]
  );
  if (!deal) return { tree: null, created };

  const paid = dealIsPaid(dealId);

  // Привязать уже существующие перемещения без deal_id, если в comment есть сделка
  run(
    `UPDATE stock_docs SET deal_id = ?
     WHERE doc_type = 'transfer'
       AND IFNULL(deal_id,'') = ''
       AND comment LIKE ?`,
    [dealId, `%сделка ${dealId}%`]
  );

  // При оплате — операция по карте (если ещё нет)
  if (paid) {
    const outsNow = listOutsForDeal(dealId);
    const cards = listCardOpsForDeal(
      dealId,
      outsNow.map((o) => o.id)
    );
    if (!cards.length) {
      const amount =
        Number(outsNow[0]?.amount) || Number(deal.price) || 0;
      if (amount > 0) {
        const op = createCardOp({
          amount,
          status: 'ok',
          comment: outsNow[0]
            ? `К расходной ${outsNow[0].number} · сделка ${dealId}`
            : `По заказу покупателя · сделка ${dealId}`,
          deal_id: dealId,
          stock_doc_id: outsNow[0]?.id || '',
        });
        if (op && (op as { id?: string }).id) {
          created.push(`card_op:${(op as { number?: string }).number || (op as { id: string }).id}`);
        }
      }
    } else if (outsNow[0]?.id) {
      run(
        `UPDATE card_ops SET stock_doc_id = ?
         WHERE deal_id = ? AND IFNULL(stock_doc_id,'') = ''`,
        [outsNow[0].id, dealId]
      );
    }
  }

  return { tree: buildOrderDocTree(dealId), created };
}

/** После создания расходной — связать и досоздать операцию по карте при оплате. */
export function linkOutToOrderChain(dealId: string, stockDocId: string): void {
  const id = String(dealId || '').trim();
  const docId = String(stockDocId || '').trim();
  if (!id || !docId) return;
  run(
    `UPDATE stock_docs SET deal_id = CASE WHEN IFNULL(deal_id,'')='' THEN ? ELSE deal_id END,
                          basis_order_id = CASE WHEN IFNULL(basis_order_id,'')='' THEN ? ELSE basis_order_id END
     WHERE id = ?`,
    [id, id, docId]
  );
  if (dealIsPaid(id)) {
    ensureOrderDocChain(id);
  }
}

/** Привязать перемещение к заказу. */
export function linkTransferToOrder(dealId: string, stockDocId: string, transferOrderId?: string): void {
  const id = String(dealId || '').trim();
  const docId = String(stockDocId || '').trim();
  if (!id || !docId) return;
  run(`UPDATE stock_docs SET deal_id = ?, basis_order_id = ? WHERE id = ?`, [id, id, docId]);
  const toId = String(transferOrderId || '').trim();
  if (toId) {
    const row = get<{ payload_json: string }>(
      `SELECT IFNULL(payload_json,'') AS payload_json FROM thin_journal_docs WHERE id = ?`,
      [toId]
    );
    const p = parsePayload(row?.payload_json || '');
    p.deal_id = id;
    p.stock_doc_id = docId;
    run(
      `UPDATE thin_journal_docs SET payload_json = ?, updated_at = datetime('now') WHERE id = ?`,
      [JSON.stringify(p), toId]
    );
  } else {
    const orders = listTransferOrdersForDeal(id);
    if (orders[0]) {
      const p = parsePayload(orders[0].payload_json);
      if (!String(p.stock_doc_id || '').trim()) {
        p.deal_id = id;
        p.stock_doc_id = docId;
        run(
          `UPDATE thin_journal_docs SET payload_json = ?, status = 'done', updated_at = datetime('now')
           WHERE id = ?`,
          [JSON.stringify(p), orders[0].id]
        );
      }
    }
  }
}

function staffNameById(staffId: string): string {
  const id = String(staffId || '').trim();
  if (!id) return '';
  return (
    get<{ name: string }>(`SELECT IFNULL(name,'') AS name FROM staff WHERE id = ?`, [id])?.name ||
    ''
  );
}

function stockDocLinesWithSerials(stockDocId: string) {
  const docId = String(stockDocId || '').trim();
  if (!docId) return [];
  return all<{
    id: string;
    product_id: string;
    qty: number;
    serials_json: string;
    sku: string;
    name: string;
  }>(
    `SELECT l.id, l.product_id, IFNULL(l.qty,0) AS qty, IFNULL(l.serials_json,'[]') AS serials_json,
            IFNULL(p.sku,'') AS sku, IFNULL(p.name,'') AS name
     FROM stock_doc_lines l
     LEFT JOIN products p ON p.id = l.product_id
     WHERE l.doc_id = ?
     ORDER BY IFNULL(l.line_no,0), l.id`,
    [docId]
  ).map((l) => {
    let serials: string[] = [];
    try {
      const raw = JSON.parse(String(l.serials_json || '[]'));
      serials = Array.isArray(raw) ? raw.map((s) => String(s || '').trim()).filter(Boolean) : [];
    } catch {
      serials = [];
    }
    return {
      product_id: l.product_id,
      sku: l.sku,
      name: l.name,
      qty: Number(l.qty) || 0,
      serials,
    };
  });
}

type XferLine = {
  product_id: string;
  sku: string;
  name: string;
  qty: number;
  serials: string[];
};

/** Серийники с задания кладовщика (dims_json) — пока документ запасов ещё без марок. */
function overlayWarehouseTaskSerials(lines: XferLine[], warehouseTaskId: string): XferLine[] {
  const taskId = String(warehouseTaskId || '').trim();
  if (!taskId) return lines;
  const tls = all<{
    product_id: string;
    sku: string;
    name: string;
    qty: number;
    dims_json: string;
  }>(
    `SELECT IFNULL(product_id,'') AS product_id, IFNULL(sku,'') AS sku,
            IFNULL(name,'') AS name, IFNULL(qty,0) AS qty,
            IFNULL(dims_json,'{}') AS dims_json
     FROM warehouse_task_lines WHERE task_id = ? ORDER BY line_no, id`,
    [taskId]
  );
  if (!tls.length) return lines;

  const serialsByPid = new Map<string, string[]>();
  const taskLines: XferLine[] = [];
  for (const l of tls) {
    let serials: string[] = [];
    try {
      const dims = JSON.parse(String(l.dims_json || '{}') || '{}') as { serials?: unknown };
      if (Array.isArray(dims.serials)) {
        serials = dims.serials.map((s) => String(s || '').trim()).filter(Boolean);
      }
    } catch {
      serials = [];
    }
    const pid = String(l.product_id || '').trim();
    if (pid && serials.length) {
      const prev = serialsByPid.get(pid) || [];
      serialsByPid.set(pid, [...prev, ...serials]);
    }
    taskLines.push({
      product_id: pid,
      sku: l.sku,
      name: l.name,
      qty: Number(l.qty) || 0,
      serials,
    });
  }

  if (!lines.length) return taskLines;

  return lines.map((row) => {
    const extra = serialsByPid.get(String(row.product_id || '').trim()) || [];
    if (!extra.length) return row;
    const have = new Set((row.serials || []).map((s) => s.toLowerCase()));
    const merged = [...(row.serials || [])];
    for (const s of extra) {
      if (!have.has(s.toLowerCase())) {
        have.add(s.toLowerCase());
        merged.push(s);
      }
    }
    return { ...row, serials: merged };
  });
}

/** Карточка перемещения С… (sto_transfer_requests + задание + серийники + ход). */
function getStoTransferOrderDetail(idRaw: string): Record<string, unknown> | null {
  const id = String(idRaw || '').trim();
  if (!id) return null;
  const req = get<{
    id: string;
    number: string;
    status: string;
    deal_id: string;
    comment: string;
    created_by: string;
    created_at: string;
    warehouse_task_id: string;
    courier_status: string;
    dest_warehouse_id: string;
    source: string;
  }>(
    `SELECT id, IFNULL(number,'') AS number, IFNULL(status,'') AS status,
            IFNULL(deal_id,'') AS deal_id, IFNULL(comment,'') AS comment,
            IFNULL(created_by,'') AS created_by, IFNULL(created_at,'') AS created_at,
            IFNULL(warehouse_task_id,'') AS warehouse_task_id,
            IFNULL(courier_status,'') AS courier_status,
            IFNULL(dest_warehouse_id,'') AS dest_warehouse_id,
            IFNULL(source,'') AS source
     FROM sto_transfer_requests
     WHERE id = ? OR number = ?
     ORDER BY CASE WHEN id = ? THEN 0 ELSE 1 END
     LIMIT 1`,
    [id, id, id]
  );
  if (!req) return null;

  const dealId = String(req.deal_id || '').trim();
  let dealName = '';
  let buyerName = '';
  if (dealId) {
    const deal = get<{ name: string; buyer_name: string }>(
      `SELECT IFNULL(name,'') AS name, IFNULL(buyer_name,'') AS buyer_name FROM crm_deals WHERE id = ?`,
      [dealId]
    );
    dealName = String(deal?.name || '').trim();
    buyerName = String(deal?.buyer_name || '').trim();
  }

  const whName = (wid: string) => {
    const w = get<{ code: string; name: string }>(
      `SELECT IFNULL(code,'') AS code, IFNULL(name,'') AS name FROM warehouses WHERE id = ?`,
      [wid]
    );
    return [w?.name || w?.code].filter(Boolean).join('') || '';
  };

  const warehouseTaskId = String(req.warehouse_task_id || '').trim();
  let taskStatus = '';
  let taskStatusLabel = '';
  let taskCreatedAt = '';
  let taskHandedAt = '';
  let warehouseTaskNumber = String(req.number || '');

  const activity: Array<{
    at: string;
    who: string;
    who_id: string;
    event: string;
    action: string;
    detail: string;
  }> = [];
  const pickers: Array<{ id: string; name: string; at: string; event: string; action: string }> =
    [];

  const eventAction = (ev: string): string => {
    const e = String(ev || '').trim();
    const map: Record<string, string> = {
      'task.created': 'Задание поступило на склад',
      'status.picking': 'Взял в работу',
      'status.packed': 'Подготовил',
      'status.ready': 'К выдаче',
      'status.handed': 'Переместил по складам',
      'status.cancelled': 'Отменил',
      'unit.scanned': 'Выбрал экземпляр (скан)',
      'unit.manual': 'Указал уникальный номер',
      'unit.cleared': 'Снял экземпляр',
      created: 'Создал перемещение',
      warehouse_task: 'Создал задание складу',
      transferred_courier: 'Перенёс на склад курьера',
      courier_handoff: 'Выдал задание курьеру',
      courier_accepted: 'Курьер принял задание',
      courier_picked_up: 'Курьер к выполнению',
      courier_delivered: 'Курьер выполнил задание',
      courier_cancelled: 'Отмена у курьера',
    };
    return map[e] || (e.startsWith('status.') ? `Статус: ${e.slice(7)}` : e || 'Событие');
  };

  const createdByName = String(req.created_by || '').trim() || '—';
  activity.push({
    at: String(req.created_at || '').replace('T', ' ').slice(0, 19),
    who: createdByName,
    who_id: '',
    event: 'transfer_order.created',
    action: 'Создал перемещение',
    detail: dealId ? `заказ ${dealId}` : 'без заказа',
  });

  if (warehouseTaskId) {
    const task = get<{
      status: string;
      number: string;
      created_at: string;
      handed_at: string;
    }>(
      `SELECT IFNULL(status,'') AS status, IFNULL(number,'') AS number,
              IFNULL(created_at,'') AS created_at, IFNULL(handed_at,'') AS handed_at
       FROM warehouse_tasks WHERE id = ?`,
      [warehouseTaskId]
    );
    if (task) {
      taskStatus = task.status;
      warehouseTaskNumber = task.number || warehouseTaskNumber;
      taskCreatedAt = task.created_at || '';
      taskHandedAt = task.handed_at || '';
      const map: Record<string, string> = {
        new: 'Новое',
        picking: 'Сборка',
        packed: 'Упаковано',
        ready: 'К выдаче',
        handed: 'Сделано',
        cancelled: 'Не сделано',
      };
      taskStatusLabel = map[taskStatus] || taskStatus;
    }
    const events = all<{
      actor_id: string;
      event: string;
      created_at: string;
      payload_json: string;
    }>(
      `SELECT IFNULL(actor_id,'') AS actor_id, IFNULL(event,'') AS event,
              IFNULL(created_at,'') AS created_at, IFNULL(payload_json,'') AS payload_json
       FROM warehouse_task_events
       WHERE task_id = ?
       ORDER BY datetime(created_at) ASC
       LIMIT 100`,
      [warehouseTaskId]
    );
    const seenPicker = new Set<string>();
    for (const e of events) {
      const aid = String(e.actor_id || '').trim();
      const who =
        aid === '__admin__'
          ? 'Админ'
          : aid
            ? staffNameById(aid) || aid.slice(0, 8)
            : '—';
      let detail = '';
      try {
        const pl = JSON.parse(String(e.payload_json || '{}') || '{}') as Record<string, unknown>;
        if (pl.serial) detail = `№ ${pl.serial}`;
        else if (Array.isArray(pl.cleared) && pl.cleared.length) {
          detail = `снято: ${(pl.cleared as unknown[]).map(String).join(', ')}`;
        } else if (pl.track) detail = `трек ${pl.track}`;
      } catch {
        /* ignore */
      }
      const action = eventAction(e.event);
      activity.push({
        at: String(e.created_at || ''),
        who,
        who_id: aid,
        event: String(e.event || ''),
        action,
        detail,
      });
      if (aid && aid !== '__admin__' && !seenPicker.has(aid) && String(e.event) !== 'task.created') {
        seenPicker.add(aid);
        pickers.push({ id: aid, name: who, at: String(e.created_at || ''), event: String(e.event), action });
      }
    }
  }

  // события заявки (курьер и т.п.)
  try {
    const sev = all<{
      event: string;
      actor_id: string;
      actor_name: string;
      summary: string;
      created_at: string;
    }>(
      `SELECT IFNULL(event,'') AS event, IFNULL(actor_id,'') AS actor_id,
              IFNULL(actor_name,'') AS actor_name, IFNULL(summary,'') AS summary,
              IFNULL(created_at,'') AS created_at
       FROM sto_transfer_request_events
       WHERE request_id = ?
       ORDER BY datetime(created_at) ASC
       LIMIT 80`,
      [req.id]
    );
    for (const e of sev) {
      const ev = String(e.event || '');
      if (ev === 'created' || ev === 'warehouse_task') continue; // уже есть из task/создания
      activity.push({
        at: String(e.created_at || ''),
        who: String(e.actor_name || '').trim() || (e.actor_id ? staffNameById(e.actor_id) : '') || '—',
        who_id: String(e.actor_id || ''),
        event: ev,
        action: eventAction(ev),
        detail: String(e.summary || '').trim(),
      });
    }
  } catch {
    /* schema may miss table briefly */
  }

  // товары + серийники из задания / строк заявки / stock_docs
  const linesMap = new Map<
    string,
    { product_id: string; sku: string; name: string; qty: number; serials: string[] }
  >();
  const addLine = (pid: string, sku: string, name: string, qty: number, serials: string[]) => {
    const key = pid || `${sku}|${name}`;
    const cur = linesMap.get(key) || {
      product_id: pid,
      sku,
      name,
      qty: 0,
      serials: [] as string[],
    };
    cur.qty = Math.max(cur.qty, qty);
    for (const s of serials) {
      if (s && !cur.serials.includes(s)) cur.serials.push(s);
    }
    if (!cur.sku && sku) cur.sku = sku;
    if (!cur.name && name) cur.name = name;
    linesMap.set(key, cur);
  };

  if (warehouseTaskId) {
    const tls = all<{
      product_id: string;
      sku: string;
      name: string;
      qty: number;
      dims_json: string;
    }>(
      `SELECT IFNULL(product_id,'') AS product_id, IFNULL(sku,'') AS sku,
              IFNULL(name,'') AS name, IFNULL(qty,0) AS qty,
              IFNULL(dims_json,'{}') AS dims_json
       FROM warehouse_task_lines WHERE task_id = ? ORDER BY line_no, id`,
      [warehouseTaskId]
    );
    for (const l of tls) {
      let serials: string[] = [];
      try {
        const dims = JSON.parse(String(l.dims_json || '{}') || '{}') as { serials?: unknown };
        if (Array.isArray(dims.serials)) {
          serials = dims.serials.map((s) => String(s || '').trim()).filter(Boolean);
        }
      } catch {
        serials = [];
      }
      addLine(l.product_id, l.sku, l.name, Number(l.qty) || 0, serials);
    }
  }

  const reqLines = all<{
    product_id: string;
    qty: number;
    serial: string;
    sku: string;
    product_name: string;
  }>(
    `SELECT IFNULL(l.product_id,'') AS product_id, IFNULL(l.qty,0) AS qty,
            IFNULL(l.serial,'') AS serial, IFNULL(p.sku,'') AS sku,
            IFNULL(p.name,'') AS product_name
     FROM sto_transfer_request_lines l
     LEFT JOIN products p ON p.id = l.product_id
     WHERE l.request_id = ?`,
    [req.id]
  );
  for (const l of reqLines) {
    addLine(
      l.product_id,
      l.sku,
      l.product_name,
      Number(l.qty) || 0,
      String(l.serial || '').trim() ? [String(l.serial).trim()] : []
    );
  }

  const stockDocs = dealId
    ? all<{
        id: string;
        number: string;
        warehouse_id: string;
        warehouse_to_id: string;
        comment: string;
        doc_date: string;
        created_at: string;
        posted: number;
      }>(
        `SELECT id, number, IFNULL(warehouse_id,'') AS warehouse_id,
                IFNULL(warehouse_to_id,'') AS warehouse_to_id,
                IFNULL(comment,'') AS comment, IFNULL(doc_date,'') AS doc_date,
                IFNULL(created_at,'') AS created_at, IFNULL(posted,0) AS posted
         FROM stock_docs
         WHERE doc_type = 'transfer' AND IFNULL(deal_id,'') = ?
         ORDER BY datetime(created_at) ASC`,
        [dealId]
      )
    : [];

  let fromLabel = 'Основной склад';
  let toLabel = '';
  let warehouseFromId = '';
  let warehouseToId = String(req.dest_warehouse_id || '').trim();
  if (warehouseToId) toLabel = whName(warehouseToId) || 'Склад назначения';
  const movements = stockDocs.map((d) => {
    const f = whName(d.warehouse_id) || d.warehouse_id.slice(0, 8);
    const t = whName(d.warehouse_to_id) || d.warehouse_to_id.slice(0, 8);
    if (!warehouseFromId && d.warehouse_id) {
      warehouseFromId = d.warehouse_id;
      fromLabel = f || fromLabel;
    }
    if (!toLabel && d.warehouse_to_id) {
      warehouseToId = d.warehouse_to_id;
      toLabel = t;
    }
    const docLines = stockDocLinesWithSerials(d.id);
    for (const l of docLines) {
      addLine(l.product_id, l.sku, l.name, l.qty, l.serials);
    }
    activity.push({
      at: String(d.created_at || d.doc_date || ''),
      who: pickers[0]?.name || createdByName || '—',
      who_id: pickers[0]?.id || '',
      event: 'stock_transfer.posted',
      action: 'Проведено перемещение запасов',
      detail: `${d.number}: ${f} → ${t}`,
    });
    return {
      id: d.id,
      number: d.number,
      from_label: f,
      to_label: t,
      at: d.created_at || d.doc_date,
      comment: d.comment,
      posted: Boolean(d.posted),
      lines: docLines,
    };
  });

  if (!toLabel) {
    toLabel =
      String(req.source || '') === 'warehouse' && /курьер/i.test(String(req.comment || ''))
        ? 'Склад курьера'
        : warehouseToId
          ? whName(warehouseToId) || 'СТО'
          : 'СТО / курьер';
  }

  const lines = [...linesMap.values()];
  const qtySum = lines.reduce((s, l) => s + (Number(l.qty) || 0), 0);
  const serialCount = lines.reduce((s, l) => s + (l.serials?.length || 0), 0);
  const lastStock = movements[movements.length - 1] || null;

  const courierMap: Record<string, string> = {
    new: 'Ждёт курьера',
    accepted: 'Курьер принял',
    picked_up: 'Курьер к выполнению',
    delivered: 'Курьер выполнил',
    cancelled: 'Отмена у курьера',
  };
  const courierStatus = String(req.courier_status || '').trim();

  const activityDesc = [...activity].sort((a, b) =>
    String(b.at || '').localeCompare(String(a.at || ''))
  );

  const statusMap: Record<string, string> = {
    new: 'Новое',
    done: 'Выполнено',
    cancelled: 'Отменено',
  };

  return {
    id: req.id,
    number: req.number,
    doc_date: String(req.created_at || '').slice(0, 10),
    status: req.status,
    status_label: statusMap[req.status] || req.status,
    comment: String(req.comment || '').trim(),
    user_comment: String(req.comment || '').trim(),
    created_at: req.created_at,
    updated_at: req.created_at,
    deal_id: dealId,
    deal_name: dealName,
    buyer_name: buyerName,
    by_deal: Boolean(dealId),
    from_label: fromLabel,
    to_label: toLabel,
    warehouse_from_id: warehouseFromId,
    warehouse_to_id: warehouseToId,
    stock_doc_id: lastStock?.id || '',
    stock_doc_number: lastStock?.number || '',
    stock_posted: lastStock ? lastStock.posted : false,
    stock_movements: movements,
    warehouse_task_id: warehouseTaskId,
    warehouse_task_number: warehouseTaskNumber,
    warehouse_task_status: taskStatus,
    warehouse_task_status_label: taskStatusLabel,
    warehouse_task_created_at: taskCreatedAt,
    warehouse_task_picked_at: '',
    warehouse_task_handed_at: taskHandedAt,
    courier_status: courierStatus,
    courier_status_label: courierStatus ? courierMap[courierStatus] || courierStatus : '',
    created_by_name: createdByName,
    pickers,
    picker_names: pickers.map((x) => x.name).filter(Boolean),
    activity: activityDesc,
    lines,
    lines_count: lines.length,
    qty_sum: qtySum,
    serials_count: serialCount,
    kind: 'sto_transfer',
    note:
      'Что перенесли, кто и когда, уникальные номера экземпляров — ниже. Клик по заказу открывает карточку покупателя.',
  };
}

/** Карточка заказа на перемещение для UI цепочки заказа. */
export function getDealTransferOrderDetail(idRaw: string): Record<string, unknown> | null {
  const id = String(idRaw || '').trim();
  if (!id) return null;
  const row = get<{
    id: string;
    number: string;
    doc_date: string;
    status: string;
    amount: number;
    comment: string;
    payload_json: string;
    created_at: string;
    updated_at: string;
  }>(
    `SELECT id, number, doc_date, status, IFNULL(amount,0) AS amount,
            IFNULL(comment,'') AS comment, IFNULL(payload_json,'') AS payload_json,
            IFNULL(created_at,'') AS created_at, IFNULL(updated_at,'') AS updated_at
     FROM thin_journal_docs
     WHERE id = ? AND journal_key = 'transfer_orders'`,
    [id]
  );
  if (!row) {
    return getStoTransferOrderDetail(id);
  }
  const p = parsePayload(row.payload_json);
  const dealId = String(p.deal_id || '').trim();
  let stockDocId = String(p.stock_doc_id || '').trim();
  let stockDocNumber = String(p.stock_doc_number || '').trim();
  let fromLabel = String(p.from_label || '').trim();
  let toLabel = String(p.to_label || '').trim();
  let warehouseFromId = String(p.warehouse_from_id || '').trim();
  let warehouseToId = String(p.warehouse_to_id || '').trim();
  let warehouseTaskId = String(p.warehouse_task_id || '').trim();
  let warehouseTaskNumber = String(p.warehouse_task_number || '').trim();

  let stockDoc: {
    id: string;
    number: string;
    posted: number;
    doc_date: string;
    warehouse_id: string;
    warehouse_to_id: string;
    comment: string;
  } | null = null;
  if (stockDocId) {
    stockDoc =
      get<{
        id: string;
        number: string;
        posted: number;
        doc_date: string;
        warehouse_id: string;
        warehouse_to_id: string;
        comment: string;
      }>(
        `SELECT id, number, IFNULL(posted,0) AS posted, IFNULL(doc_date,'') AS doc_date,
                IFNULL(warehouse_id,'') AS warehouse_id, IFNULL(warehouse_to_id,'') AS warehouse_to_id,
                IFNULL(comment,'') AS comment
         FROM stock_docs WHERE id = ?`,
        [stockDocId]
      ) || null;
  }
  if (stockDoc) {
    stockDocNumber = stockDoc.number || stockDocNumber;
    warehouseFromId = warehouseFromId || stockDoc.warehouse_id;
    warehouseToId = warehouseToId || stockDoc.warehouse_to_id;
  }
  if (warehouseFromId && !fromLabel) {
    const w = get<{ code: string; name: string }>(
      `SELECT IFNULL(code,'') AS code, IFNULL(name,'') AS name FROM warehouses WHERE id = ?`,
      [warehouseFromId]
    );
    fromLabel = [w?.code, w?.name].filter(Boolean).join(' · ') || warehouseFromId.slice(0, 8);
  }
  if (warehouseToId && !toLabel) {
    const w = get<{ code: string; name: string }>(
      `SELECT IFNULL(code,'') AS code, IFNULL(name,'') AS name FROM warehouses WHERE id = ?`,
      [warehouseToId]
    );
    toLabel = [w?.code, w?.name].filter(Boolean).join(' · ') || warehouseToId.slice(0, 8);
  }

  if (!warehouseTaskId && stockDocId) {
    const t = get<{ id: string; number: string }>(
      `SELECT id, number FROM warehouse_tasks
       WHERE stock_doc_id = ? AND channel = 'transfer'
       ORDER BY datetime(created_at) DESC LIMIT 1`,
      [stockDocId]
    );
    if (t) {
      warehouseTaskId = t.id;
      warehouseTaskNumber = t.number;
    }
  }

  let taskStatus = '';
  let taskStatusLabel = '';
  let taskCreatedAt = '';
  let taskPickedAt = '';
  let taskHandedAt = '';
  const pickers: Array<{ id: string; name: string; at: string; event: string; action: string }> =
    [];
  const activity: Array<{
    at: string;
    who: string;
    who_id: string;
    event: string;
    action: string;
    detail: string;
  }> = [];

  const transferEventAction = (ev: string): string => {
    const e = String(ev || '').trim();
    if (e === 'task.created') return 'Заказ поступил на склад';
    if (e === 'status.picking') return 'Взял в работу';
    if (e === 'status.packed') return 'Подготовил к перемещению';
    if (e === 'status.ready') return 'Готово к перемещению';
    if (e === 'status.handed') return 'Переместил';
    if (e === 'status.cancelled') return 'Отменил';
    if (e.startsWith('status.')) return `Статус: ${e.slice(7)}`;
    return e || 'Событие';
  };

  const createdByName =
    String(p.created_by_name || '').trim() || staffNameById(String(p.created_by || ''));

  // 1) Создание заказа на перемещение
  activity.push({
    at: String(row.created_at || row.doc_date || ''),
    who: createdByName || '—',
    who_id: String(p.created_by || '').trim(),
    event: 'transfer_order.created',
    action: 'Создал заказ на перемещение',
    detail: [fromLabel && toLabel ? `${fromLabel} → ${toLabel}` : '', String(p.user_comment || '').trim()]
      .filter(Boolean)
      .join(' · '),
  });

  if (warehouseTaskId) {
    const task = get<{
      status: string;
      number: string;
      created_at: string;
      picked_at: string;
      handed_at: string;
    }>(
      `SELECT IFNULL(status,'') AS status, IFNULL(number,'') AS number,
              IFNULL(created_at,'') AS created_at,
              IFNULL(picked_at,'') AS picked_at,
              IFNULL(handed_at,'') AS handed_at
       FROM warehouse_tasks WHERE id = ?`,
      [warehouseTaskId]
    );
    if (task) {
      taskStatus = task.status;
      warehouseTaskNumber = task.number || warehouseTaskNumber;
      taskCreatedAt = task.created_at || '';
      taskPickedAt = task.picked_at || '';
      taskHandedAt = task.handed_at || '';
      const map: Record<string, string> = {
        new: 'Новое',
        picking: 'Сборка',
        packed: 'Упаковано',
        ready: 'К выдаче',
        handed: 'Сделано',
        cancelled: 'Не сделано',
      };
      taskStatusLabel = map[taskStatus] || taskStatus;
    }
    const events = all<{
      actor_id: string;
      event: string;
      created_at: string;
      payload_json: string;
    }>(
      `SELECT IFNULL(actor_id,'') AS actor_id, IFNULL(event,'') AS event,
              IFNULL(created_at,'') AS created_at, IFNULL(payload_json,'') AS payload_json
       FROM warehouse_task_events
       WHERE task_id = ?
       ORDER BY datetime(created_at) ASC
       LIMIT 80`,
      [warehouseTaskId]
    );
    const seenPicker = new Set<string>();
    for (const e of events) {
      const aid = String(e.actor_id || '').trim();
      const who = aid ? staffNameById(aid) || aid.slice(0, 8) : '—';
      const action = transferEventAction(e.event);
      let detail = '';
      try {
        const pl = JSON.parse(String(e.payload_json || '{}') || '{}') as Record<string, unknown>;
        if (pl.block_reason) detail = String(pl.block_reason);
        else if (pl.track) detail = `трек ${pl.track}`;
      } catch {
        /* ignore */
      }
      activity.push({
        at: String(e.created_at || ''),
        who,
        who_id: aid,
        event: String(e.event || ''),
        action,
        detail,
      });
      if (aid && !seenPicker.has(aid) && String(e.event || '') !== 'task.created') {
        seenPicker.add(aid);
        pickers.push({
          id: aid,
          name: who,
          at: String(e.created_at || ''),
          event: String(e.event || ''),
          action,
        });
      }
    }
  }

  if (stockDoc && Number(stockDoc.posted) === 1) {
    activity.push({
      at: String(stockDoc.doc_date || row.updated_at || ''),
      who: pickers[0]?.name || createdByName || '—',
      who_id: pickers[0]?.id || String(p.created_by || '').trim(),
      event: 'stock_transfer.posted',
      action: 'Проведено перемещение запасов',
      detail: stockDocNumber ? `док. ${stockDocNumber}` : '',
    });
  }

  let lines = stockDocLinesWithSerials(stockDocId);
  if (!lines.length && Array.isArray(p.line_details)) {
    lines = (p.line_details as Array<Record<string, unknown>>).map((l) => ({
      product_id: String(l.product_id || ''),
      sku: String(l.sku || l.article || ''),
      name: String(l.name || ''),
      qty: Number(l.qty) || 0,
      serials: Array.isArray(l.serials) ? (l.serials as unknown[]).map(String) : [],
    }));
  } else if (!lines.length && Array.isArray(p.lines)) {
    lines = (p.lines as Array<Record<string, unknown>>).map((l) => ({
      product_id: String(l.product_id || ''),
      sku: String(l.article || l.sku || ''),
      name: String(l.name || ''),
      qty: Number(l.qty) || 0,
      serials: [],
    }));
  }
  lines = overlayWarehouseTaskSerials(lines, warehouseTaskId);

  const qtySum = lines.reduce((s, l) => s + (Number(l.qty) || 0), 0);
  const serialCount = lines.reduce((s, l) => s + (l.serials?.length || 0), 0);

  // свежие события сверху для UI
  const activityDesc = [...activity].sort((a, b) =>
    String(b.at || '').localeCompare(String(a.at || ''))
  );

  return {
    id: row.id,
    number: row.number,
    doc_date: row.doc_date,
    status: row.status,
    comment: String(p.user_comment || row.comment || '').trim(),
    user_comment: String(p.user_comment || '').trim(),
    created_at: row.created_at,
    updated_at: row.updated_at,
    deal_id: dealId,
    from_label: fromLabel,
    to_label: toLabel,
    warehouse_from_id: warehouseFromId,
    warehouse_to_id: warehouseToId,
    stock_doc_id: stockDocId,
    stock_doc_number: stockDocNumber,
    stock_posted: stockDoc ? Boolean(stockDoc.posted) : false,
    warehouse_task_id: warehouseTaskId,
    warehouse_task_number: warehouseTaskNumber,
    warehouse_task_status: taskStatus,
    warehouse_task_status_label: taskStatusLabel,
    warehouse_task_created_at: taskCreatedAt,
    warehouse_task_picked_at: taskPickedAt,
    warehouse_task_handed_at: taskHandedAt,
    created_by_name: createdByName,
    pickers,
    picker_names: pickers.map((x) => x.name).filter(Boolean),
    activity: activityDesc,
    lines,
    lines_count: lines.length,
    qty_sum: qtySum,
    serials_count: serialCount,
    note:
      'В заказе покупателя — артикул и количество. В заказе на перемещение кладовщик указывает конкретные марки (экземпляры) при переносе.',
  };
}

/** Список заказов на перемещение по заказу покупателя. */
export function listDealTransferOrdersDetailed(dealIdRaw: string): Record<string, unknown>[] {
  const dealId = String(dealIdRaw || '').trim();
  if (!dealId) return [];
  const thin = listTransferOrdersForDeal(dealId)
    .map((row) => getDealTransferOrderDetail(row.id))
    .filter((x): x is Record<string, unknown> => !!x);
  const sto = listStoRequestsForDeal(dealId)
    .map((row) => getStoTransferOrderDetail(row.id))
    .filter((x): x is Record<string, unknown> => !!x);
  const seen = new Set(thin.map((x) => String(x.id || '')));
  for (const s of sto) {
    if (!seen.has(String(s.id || ''))) thin.push(s);
  }
  thin.sort((a, b) =>
    String(b.created_at || b.doc_date || '').localeCompare(String(a.created_at || a.doc_date || ''))
  );
  return thin;
}
