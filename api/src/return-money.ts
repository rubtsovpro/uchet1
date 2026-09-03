/**
 * Возврат товара → цена как при последней продаже + требование возврата денег (Деньги).
 */
import { all, get, run } from './db.js';
import { createThinJournalDoc } from './parity-batch-a.js';

export type LastSalePrice = {
  price: number;
  source: string;
  deal_id: string;
};

/** Цена, по которой товар продавали последний раз (сделка / УПД / расход). */
export function getLastSalePrice(opts: {
  productId: string;
  serial?: string;
  dealId?: string;
}): LastSalePrice {
  const productId = String(opts.productId || '').trim();
  const serial = String(opts.serial || '').trim();
  const dealHint = String(opts.dealId || '').trim();
  if (!productId) return { price: 0, source: '', deal_id: '' };

  if (serial) {
    const unit = get<{ out_doc_id: string; out_line_id: string }>(
      `SELECT IFNULL(out_doc_id,'') AS out_doc_id, IFNULL(out_line_id,'') AS out_line_id
       FROM product_units WHERE lower(serial) = lower(?) LIMIT 1`,
      [serial]
    );
    if (unit?.out_line_id) {
      const line = get<{ price: number }>(
        `SELECT IFNULL(price,0) AS price FROM stock_doc_lines WHERE id = ?`,
        [unit.out_line_id]
      );
      if (line && Number(line.price) > 0) {
        const dealId =
          get<{ deal_id: string }>(
            `SELECT IFNULL(deal_id,'') AS deal_id FROM stock_docs WHERE id = ?`,
            [unit.out_doc_id]
          )?.deal_id || '';
        return { price: Number(line.price), source: 'out_line', deal_id: dealId };
      }
    }
    if (unit?.out_doc_id) {
      const dealId =
        get<{ deal_id: string }>(
          `SELECT IFNULL(deal_id,'') AS deal_id FROM stock_docs WHERE id = ?`,
          [unit.out_doc_id]
        )?.deal_id || '';
      if (dealId) {
        const fromDeal = priceFromDealItem(productId, dealId, serial);
        if (fromDeal.price > 0) return fromDeal;
      }
    }
  }

  if (dealHint) {
    const fromDeal = priceFromDealItem(productId, dealHint, serial);
    if (fromDeal.price > 0) return fromDeal;
    const fromSales = priceFromSalesDoc(productId, dealHint);
    if (fromSales.price > 0) return fromSales;
  }

  // последняя сделка с этим товаром
  const lastDeal = get<{ price: number; deal_id: string }>(
    `SELECT IFNULL(i.price,0) AS price, i.deal_id AS deal_id
     FROM crm_deal_items i
     JOIN crm_deals d ON d.id = i.deal_id
     WHERE IFNULL(i.product_guid,'') = ?
       AND IFNULL(i.price,0) > 0
     ORDER BY datetime(COALESCE(d.updated_at, d.created_at, d.queued_at)) DESC
     LIMIT 1`,
    [productId]
  );
  if (lastDeal && Number(lastDeal.price) > 0) {
    return {
      price: Number(lastDeal.price),
      source: 'crm_deal_items',
      deal_id: String(lastDeal.deal_id || ''),
    };
  }

  const lastSales = get<{ price: number; deal_id: string }>(
    `SELECT IFNULL(l.price,0) AS price, IFNULL(d.deal_id,'') AS deal_id
     FROM sales_doc_lines l
     JOIN sales_docs d ON d.id = l.doc_id
     WHERE IFNULL(l.product_guid,'') = ?
       AND IFNULL(l.price,0) > 0
     ORDER BY datetime(COALESCE(d.doc_date, d.created_at)) DESC
     LIMIT 1`,
    [productId]
  );
  if (lastSales && Number(lastSales.price) > 0) {
    return {
      price: Number(lastSales.price),
      source: 'sales_doc_lines',
      deal_id: String(lastSales.deal_id || ''),
    };
  }

  return { price: 0, source: '', deal_id: dealHint };
}

function priceFromDealItem(productId: string, dealId: string, serial: string): LastSalePrice {
  const items = all<{ price: number; serials_json: string }>(
    `SELECT IFNULL(price,0) AS price, IFNULL(serials_json,'') AS serials_json
     FROM crm_deal_items
     WHERE deal_id = ? AND IFNULL(product_guid,'') = ?`,
    [dealId, productId]
  );
  if (serial) {
    const serialLower = serial.toLowerCase();
    for (const it of items) {
      if (Number(it.price) <= 0) continue;
      try {
        const arr = it.serials_json ? (JSON.parse(it.serials_json) as unknown[]) : [];
        if (
          Array.isArray(arr) &&
          arr.some((s) => String(s || '').trim().toLowerCase() === serialLower)
        ) {
          return { price: Number(it.price), source: 'crm_deal_items.serial', deal_id: dealId };
        }
      } catch {
        /* ignore */
      }
    }
  }
  const withPrice = items.find((it) => Number(it.price) > 0);
  if (withPrice) {
    return { price: Number(withPrice.price), source: 'crm_deal_items', deal_id: dealId };
  }
  return { price: 0, source: '', deal_id: dealId };
}

function priceFromSalesDoc(productId: string, dealId: string): LastSalePrice {
  const row = get<{ price: number }>(
    `SELECT IFNULL(l.price,0) AS price
     FROM sales_doc_lines l
     JOIN sales_docs d ON d.id = l.doc_id
     WHERE IFNULL(d.deal_id,'') = ?
       AND IFNULL(l.product_guid,'') = ?
       AND IFNULL(l.price,0) > 0
     ORDER BY datetime(COALESCE(d.doc_date, d.created_at)) DESC
     LIMIT 1`,
    [dealId, productId]
  );
  if (row && Number(row.price) > 0) {
    return { price: Number(row.price), source: 'sales_doc_lines', deal_id: dealId };
  }
  return { price: 0, source: '', deal_id: dealId };
}

/** Черновик «Требование возврата денег» (ТВД) — по складскому возврату или по требованию на склад. */
export function createMoneyRefundFromReturn(opts: {
  stockDocId?: string;
  stockDocNumber?: string;
  warehouseTaskId?: string;
  warehouseTaskNumber?: string;
  amount: number;
  dealId?: string;
  counterpartyName?: string;
  counterpartyId?: string;
  serials?: string[];
  lines?: Array<{
    product_id?: string;
    name?: string;
    sku?: string;
    qty?: number;
    price?: number;
  }>;
  comment?: string;
}): { id: string; number: string } | null {
  const stockDocId = String(opts.stockDocId || '').trim();
  const taskId = String(opts.warehouseTaskId || '').trim();
  const amount = Math.round(Number(opts.amount) || 0);
  if (!(amount > 0)) return null;
  if (!stockDocId && !taskId && !String(opts.dealId || '').trim()) return null;

  // не дублировать
  try {
    const key = stockDocId
      ? `%"stock_doc_id":"${stockDocId.replace(/"/g, '')}"%`
      : taskId
        ? `%"warehouse_task_id":"${taskId.replace(/"/g, '')}"%`
        : '';
    if (key) {
      const exists = get<{ id: string; number: string }>(
        `SELECT id, number FROM thin_journal_docs
         WHERE journal_key = 'money_refund_requests'
           AND IFNULL(payload_json,'') LIKE ?
         LIMIT 1`,
        [key]
      );
      if (exists) return { id: exists.id, number: exists.number };
    }
  } catch {
    /* ignore */
  }

  const serials = (opts.serials || []).map((s) => String(s || '').trim()).filter(Boolean);
  const basisLabel = opts.stockDocNumber || opts.warehouseTaskNumber || stockDocId || taskId;
  const comment =
    String(opts.comment || '').trim() ||
    `основание:возврат ${basisLabel}`;
  const row = createThinJournalDoc('money_refund_requests', {
    counterparty_name: String(opts.counterpartyName || '').trim(),
    amount,
    comment,
    status: 'draft',
    payload_json: JSON.stringify({
      kind: 'refund',
      basis: stockDocId ? 'return' : 'return_request',
      stock_doc_id: stockDocId,
      stock_doc_number: opts.stockDocNumber || '',
      warehouse_task_id: taskId,
      warehouse_task_number: opts.warehouseTaskNumber || '',
      deal_id: String(opts.dealId || '').trim(),
      counterparty_id: String(opts.counterpartyId || '').trim(),
      serials,
      lines: Array.isArray(opts.lines) ? opts.lines : [],
    }),
  }) as { id?: string; number?: string } | undefined;

  if (!row?.id) return null;

  if (stockDocId) {
    try {
      run(
        `UPDATE stock_docs
         SET comment = CASE
           WHEN IFNULL(comment,'') = '' THEN ?
           WHEN instr(comment, 'ТВД') > 0 THEN comment
           ELSE comment || ' · ' || ?
         END
         WHERE id = ?`,
        [
          `Требование возврата денег ${row.number}`,
          `ТВД ${row.number}`,
          stockDocId,
        ]
      );
    } catch {
      /* ignore */
    }
  }

  return { id: String(row.id), number: String(row.number || '') };
}

function closeMoneyRefundRequestsForDeal(dealId: string) {
  const id = String(dealId || '').trim();
  if (!id) return 0;
  const rows = all<{ id: string; payload_json: string; status: string }>(
    `SELECT id, IFNULL(payload_json,'') AS payload_json, IFNULL(status,'') AS status
     FROM thin_journal_docs
     WHERE journal_key = 'money_refund_requests'
       AND IFNULL(status,'') IN ('', 'draft', 'open', 'new')
       AND IFNULL(payload_json,'') LIKE ?`,
    [`%"deal_id":"${id.replace(/"/g, '')}"%`]
  );
  let n = 0;
  for (const r of rows) {
    try {
      const payload = r.payload_json ? (JSON.parse(r.payload_json) as { deal_id?: string }) : {};
      if (String(payload.deal_id || '').trim() !== id) continue;
    } catch {
      continue;
    }
    run(
      `UPDATE thin_journal_docs
       SET status = 'done', updated_at = datetime('now'),
           comment = CASE
             WHEN IFNULL(comment,'') = '' THEN 'деньги возвращены'
             WHEN instr(lower(comment), 'деньги возвращены') > 0 THEN comment
             ELSE comment || ' · деньги возвращены'
           END
       WHERE id = ?`,
      [r.id]
    );
    n += 1;
  }
  return n;
}

/** Отметка на заказе: деньги покупателю уже вернули (Точка/банк вручную). */
export function markDealMoneyRefunded(
  dealId: string,
  actor?: { id?: string; name?: string } | null
): {
  deal_id: string;
  money_refunded_at: string;
  money_refunded_by: string;
  money_refunded_by_name: string;
  closed_tvd: number;
} {
  const id = String(dealId || '').trim();
  if (!id) throw new Error('Нет заказа');
  const deal = get<{ id: string }>('SELECT id FROM crm_deals WHERE id = ?', [id]);
  if (!deal) throw new Error('Заказ не найден');

  const existing = get<{ money_refunded_at: string }>(
    `SELECT IFNULL(money_refunded_at,'') AS money_refunded_at FROM crm_deals WHERE id = ?`,
    [id]
  );
  if (String(existing?.money_refunded_at || '').trim()) {
    const row = get<{
      money_refunded_at: string;
      money_refunded_by: string;
      money_refunded_by_name: string;
    }>(
      `SELECT IFNULL(money_refunded_at,'') AS money_refunded_at,
              IFNULL(money_refunded_by,'') AS money_refunded_by,
              IFNULL(money_refunded_by_name,'') AS money_refunded_by_name
       FROM crm_deals WHERE id = ?`,
      [id]
    );
    return {
      deal_id: id,
      money_refunded_at: String(row?.money_refunded_at || ''),
      money_refunded_by: String(row?.money_refunded_by || ''),
      money_refunded_by_name: String(row?.money_refunded_by_name || ''),
      closed_tvd: 0,
    };
  }

  const by = String(actor?.id || '').trim();
  const byName = String(actor?.name || '').trim();
  run(
    `UPDATE crm_deals SET
       money_refunded_at = datetime('now'),
       money_refunded_by = ?,
       money_refunded_by_name = ?,
       updated_at = datetime('now')
     WHERE id = ?`,
    [by, byName, id]
  );
  const closed = closeMoneyRefundRequestsForDeal(id);
  const row = get<{
    money_refunded_at: string;
    money_refunded_by: string;
    money_refunded_by_name: string;
  }>(
    `SELECT IFNULL(money_refunded_at,'') AS money_refunded_at,
            IFNULL(money_refunded_by,'') AS money_refunded_by,
            IFNULL(money_refunded_by_name,'') AS money_refunded_by_name
     FROM crm_deals WHERE id = ?`,
    [id]
  );
  return {
    deal_id: id,
    money_refunded_at: String(row?.money_refunded_at || ''),
    money_refunded_by: String(row?.money_refunded_by || ''),
    money_refunded_by_name: String(row?.money_refunded_by_name || ''),
    closed_tvd: closed,
  };
}

export function clearDealMoneyRefunded(dealId: string): { deal_id: string; ok: boolean } {
  const id = String(dealId || '').trim();
  if (!id) throw new Error('Нет заказа');
  const deal = get<{ id: string }>('SELECT id FROM crm_deals WHERE id = ?', [id]);
  if (!deal) throw new Error('Заказ не найден');
  run(
    `UPDATE crm_deals SET
       money_refunded_at = '',
       money_refunded_by = '',
       money_refunded_by_name = '',
       updated_at = datetime('now')
     WHERE id = ?`,
    [id]
  );
  return { deal_id: id, ok: true };
}
