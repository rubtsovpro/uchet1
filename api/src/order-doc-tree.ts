/**
 * Структура подчинения по заказу покупателя (как в 1С):
 * Заказ → Заказ на перемещение (обязателен при товарах/СТО)
 *         → Перемещение запасов (информационно, если уже создано)
 *      → Расходная накладная → Операция по платёжным картам
 *
 * OData 1С публикует только приход/расход — остальные документы ведутся локально.
 * «Перемещение запасов» не блокирует цепочку: достаточно заказа на перемещение.
 */
import { all, get, run } from './db.js';
import { createThinJournalDoc } from './parity-batch-a.js';
import { createCardOp } from './menu-parity.js';

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
};

export type OrderDocTree = {
  deal_id: string;
  complete: boolean;
  missing: string[];
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
  const row = get<{ c: number }>(
    `SELECT COUNT(*) AS c FROM crm_deal_items
     WHERE deal_id = ?
       AND IFNULL(product_guid,'') != ''
       AND IFNULL(qty,0) > 0`,
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
  }>(
    `SELECT id, IFNULL(name,'') AS name, IFNULL(price,0) AS price,
            IFNULL(updated_at,'') AS updated_at, IFNULL(created_at,'') AS created_at,
            IFNULL(is_sto,0) AS is_sto, IFNULL(paid,0) AS paid,
            IFNULL(payment_status,'') AS payment_status
     FROM crm_deals WHERE id = ?`,
    [dealId]
  );
  if (!deal) return null;

  const hasGoods = dealHasGoods(dealId);
  const paid = dealIsPaid(dealId) || Number(deal.paid) === 1;
  const needTransfer = Number(deal.is_sto) === 1 || hasGoods;
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

  const transferOrderNodes: OrderDocNode[] = transferOrders.map((to) => ({
    kind: 'transfer_order' as const,
    label: 'Заказ на перемещение',
    id: to.id,
    number: to.number,
    doc_date: String(to.doc_date || '').slice(0, 10),
    posted: String(to.status || '') === 'done',
    amount: Number(to.amount) || 0,
    status: String(to.status || 'draft'),
    required: needTransfer,
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
      label: 'Заказ на перемещение (СТО)',
      id: sr.id,
      number: sr.number,
      doc_date: String(sr.created_at || '').slice(0, 10),
      posted: String(sr.status || '') === 'done',
      amount: 0,
      status: String(sr.status || ''),
      required: needTransfer,
      present: true,
      open: { type: 'sto_transfer', id: sr.id },
      children: transferChildren,
      comment: sr.comment,
    });
  }

  if (needTransfer && !transferOrderNodes.length) {
    const ph = placeholder('transfer_order', 'Заказ на перемещение', true);
    ph.children = transferChildren;
    transferOrderNodes.push(ph);
  } else if (transferOrderNodes.length === 1 && transferOrderNodes[0].children.length === 0) {
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

  const rootChildren: OrderDocNode[] = [...transferOrderNodes, ...outNodes];

  // Дополнительно: задания склада и sales-docs как информационные (не блокируют complete)
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
  for (const sd of salesDocs) {
    const labels: Record<string, string> = {
      invoice: 'Счёт',
      upd: 'УПД',
      sf: 'СФ',
      workorder: 'Заказ-наряд',
    };
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
      children: [],
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
    status: paid ? 'paid' : 'open',
    required: true,
    present: true,
    open: { type: 'deal', id: dealId },
    children: rootChildren,
    comment: deal.name,
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
    note:
      'OData 1С публикует только приход/расход. Заказ на перемещение обязателен при товарах/СТО; само перемещение запасов — по факту склада и не блокирует структуру.',
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

  const deal = get<{ id: string; price: number; is_sto: number; name: string }>(
    `SELECT id, IFNULL(price,0) AS price, IFNULL(is_sto,0) AS is_sto, IFNULL(name,'') AS name
     FROM crm_deals WHERE id = ?`,
    [dealId]
  );
  if (!deal) return { tree: null, created };

  const hasGoods = dealHasGoods(dealId);
  const needTransfer = Number(deal.is_sto) === 1 || hasGoods;
  const paid = dealIsPaid(dealId);

  if (needTransfer && !listTransferOrdersForDeal(dealId).length && !listStoRequestsForDeal(dealId).length) {
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
        note: 'Черновик заказа на перемещение — укажите склады и проведите перемещение',
      }),
    }) as { id?: string; number?: string } | null;
    if (row?.id) created.push(`transfer_order:${row.number || row.id}`);
  }

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
  if (!row) return null;
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
  return listTransferOrdersForDeal(dealId)
    .map((row) => getDealTransferOrderDetail(row.id))
    .filter((x): x is Record<string, unknown> => !!x);
}
