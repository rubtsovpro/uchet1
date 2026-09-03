/**
 * Анализ заказа поставщику: заказано / получено / осталось.
 */
import type { Hono } from 'hono';
import { all, get, run } from './db.js';
import { getThinJournalDoc, parseThinSupplierOrderLines } from './parity-batch-a.js';

export type AnalysisReceipt = {
  id: string;
  number: string;
  doc_date: string;
  qty: number;
  discrepancy_act_id?: string;
  discrepancy_act_number?: string;
};

export type AnalysisLine = {
  product_id: string;
  sku: string;
  name: string;
  qty_ordered: number;
  qty_received: number;
  qty_remaining: number;
  price_ordered: number;
  receipts: AnalysisReceipt[];
};

export function refreshThinSupplierOrderStatus(orderId: string): string | null {
  const id = String(orderId || '').trim();
  if (!id) return null;
  const row = get<{ id: string; status: string; payload_json: string }>(
    `SELECT id, IFNULL(status,'') AS status, IFNULL(payload_json,'') AS payload_json
     FROM thin_journal_docs WHERE id = ? AND journal_key = 'supplier_orders'`,
    [id]
  );
  if (!row) return null;
  const cur = String(row.status || '').trim().toLowerCase();
  if (cur === 'cancelled' || cur === 'canceled' || cur === 'draft') return cur || 'draft';

  const orderedLines = parseThinSupplierOrderLines(row.payload_json);
  const orderedMap = new Map<string, number>();
  for (const l of orderedLines) {
    const pid = String(l.product_id || '').trim();
    if (!pid) continue;
    orderedMap.set(pid, (orderedMap.get(pid) || 0) + (Number(l.qty) || 0));
  }

  const receivedRows = all<{ product_id: string; qty: number }>(
    `SELECT IFNULL(l.product_id,'') AS product_id, SUM(l.qty) AS qty
     FROM stock_doc_lines l
     JOIN stock_docs d ON d.id = l.doc_id
     WHERE d.doc_type = 'in' AND d.posted = 1
       AND IFNULL(d.source_supplier_order_id,'') = ?
     GROUP BY l.product_id`,
    [id]
  );
  const receivedMap = new Map<string, number>();
  for (const r of receivedRows) {
    receivedMap.set(String(r.product_id), Number(r.qty) || 0);
  }

  let anyReceived = false;
  let allDone = orderedMap.size > 0;
  for (const [pid, ord] of orderedMap) {
    const got = receivedMap.get(pid) || 0;
    if (got > 0.0001) anyReceived = true;
    if (got + 0.0001 < ord) allDone = false;
  }
  // излишки по товарам вне заказа не ломают «получен»
  for (const [pid, got] of receivedMap) {
    if (!orderedMap.has(pid) && got > 0) anyReceived = true;
  }

  let next = cur;
  if (allDone && anyReceived) next = 'received';
  else if (anyReceived) next = 'partial';
  else if (cur === 'posted' || cur === 'confirmed' || cur === 'sent' || cur === 'paid') {
    next = 'in_transit';
  }

  if (next && next !== cur) {
    run(
      `UPDATE thin_journal_docs SET status = ?, updated_at = datetime('now') WHERE id = ?`,
      [next, id]
    );
  }
  return next;
}

export function getSupplierOrderAnalysis(
  orderId: string,
  mode: 'by_product' | 'by_line' = 'by_product'
): {
  order: Record<string, unknown>;
  mode: string;
  lines: AnalysisLine[];
  totals: {
    qty_ordered: number;
    qty_received: number;
    qty_remaining: number;
    amount_ordered: number;
  };
} {
  const id = String(orderId || '').trim();
  if (!id) throw new Error('order_id обязателен');
  const order = getThinJournalDoc('supplier_orders', id);
  if (!order) throw new Error('Заказ поставщику не найден');

  const orderedLines = Array.isArray(order.lines) ? order.lines : [];

  const receiptLines = all<{
    doc_id: string;
    number: string;
    doc_date: string;
    product_id: string;
    qty: number;
  }>(
    `SELECT d.id AS doc_id, IFNULL(d.number,'') AS number,
            IFNULL(d.doc_date,'') AS doc_date,
            IFNULL(l.product_id,'') AS product_id,
            l.qty AS qty
     FROM stock_docs d
     JOIN stock_doc_lines l ON l.doc_id = d.id
     WHERE d.doc_type = 'in' AND d.posted = 1
       AND IFNULL(d.source_supplier_order_id,'') = ?
     ORDER BY d.doc_date, d.number, l.rowid`,
    [id]
  );

  const actByInbound = new Map<string, { id: string; number: string }>();
  const inboundIds = [...new Set(receiptLines.map((r) => r.doc_id))];
  if (inboundIds.length) {
    const ph = inboundIds.map(() => '?').join(',');
    const list = all<{ id: string; number: string; inbound_doc_id: string }>(
      `SELECT id, IFNULL(number,'') AS number, IFNULL(inbound_doc_id,'') AS inbound_doc_id
       FROM purchase_discrepancy_acts WHERE inbound_doc_id IN (${ph})`,
      inboundIds
    );
    for (const a of list) {
      actByInbound.set(String(a.inbound_doc_id), {
        id: String(a.id),
        number: String(a.number),
      });
    }
  }

  const receivedByProduct = new Map<
    string,
    { qty: number; receipts: Map<string, AnalysisReceipt> }
  >();
  for (const r of receiptLines) {
    const pid = String(r.product_id || '').trim();
    if (!pid) continue;
    if (!receivedByProduct.has(pid)) {
      receivedByProduct.set(pid, { qty: 0, receipts: new Map() });
    }
    const bucket = receivedByProduct.get(pid)!;
    bucket.qty += Number(r.qty) || 0;
    const prev = bucket.receipts.get(r.doc_id);
    const act = actByInbound.get(r.doc_id);
    if (prev) {
      prev.qty += Number(r.qty) || 0;
    } else {
      bucket.receipts.set(r.doc_id, {
        id: r.doc_id,
        number: r.number,
        doc_date: String(r.doc_date || '').slice(0, 10),
        qty: Number(r.qty) || 0,
        discrepancy_act_id: act?.id,
        discrepancy_act_number: act?.number,
      });
    }
  }

  const lines: AnalysisLine[] = [];

  if (mode === 'by_line') {
    orderedLines.forEach((l, idx) => {
      const pid = String(l.product_id || '').trim();
      const ord = Number(l.qty) || 0;
      // для by_line: пропорционально не делим received — показываем 0 на строке кроме агрегации;
      // проще показать ordered per line и received only on first occurrence of product
      const bucket = pid ? receivedByProduct.get(pid) : undefined;
      const already = lines.filter((x) => x.product_id === pid).length;
      let got = 0;
      if (bucket && already === 0) got = bucket.qty;
      lines.push({
        product_id: pid,
        sku: String(l.sku || l.article || ''),
        name: String(l.name || ''),
        qty_ordered: ord,
        qty_received: got,
        qty_remaining: ord - got,
        price_ordered: Number(l.price) || 0,
        receipts: bucket ? [...bucket.receipts.values()] : [],
        // @ts-expect-error line index for UI
        line_no: Number(l.line_no) || idx + 1,
      });
    });
  } else {
    const byPid = new Map<
      string,
      { sku: string; name: string; qty: number; priceSum: number; priceQty: number }
    >();
    for (const l of orderedLines) {
      const pid = String(l.product_id || '').trim() || `__art:${l.article || l.sku || ''}`;
      const qty = Number(l.qty) || 0;
      const price = Number(l.price) || 0;
      if (!byPid.has(pid)) {
        byPid.set(pid, {
          sku: String(l.sku || l.article || ''),
          name: String(l.name || ''),
          qty: 0,
          priceSum: 0,
          priceQty: 0,
        });
      }
      const b = byPid.get(pid)!;
      b.qty += qty;
      if (price > 0 && qty > 0) {
        b.priceSum += price * qty;
        b.priceQty += qty;
      }
    }
    for (const [pid, b] of byPid) {
      const realPid = pid.startsWith('__art:') ? '' : pid;
      const bucket = realPid ? receivedByProduct.get(realPid) : undefined;
      const got = bucket?.qty || 0;
      lines.push({
        product_id: realPid,
        sku: b.sku,
        name: b.name,
        qty_ordered: b.qty,
        qty_received: got,
        qty_remaining: b.qty - got,
        price_ordered: b.priceQty > 0 ? Math.round(b.priceSum / b.priceQty) : 0,
        receipts: bucket ? [...bucket.receipts.values()] : [],
      });
    }
    // товары только в приходе (излишек без заказа)
    for (const [pid, bucket] of receivedByProduct) {
      if (byPid.has(pid)) continue;
      const p = get<{ sku: string; name: string }>(
        `SELECT IFNULL(sku,'') AS sku, IFNULL(name,'') AS name FROM products WHERE id = ?`,
        [pid]
      );
      lines.push({
        product_id: pid,
        sku: String(p?.sku || ''),
        name: String(p?.name || ''),
        qty_ordered: 0,
        qty_received: bucket.qty,
        qty_remaining: -bucket.qty,
        price_ordered: 0,
        receipts: [...bucket.receipts.values()],
      });
    }
  }

  lines.sort((a, b) => a.sku.localeCompare(b.sku, 'ru') || a.name.localeCompare(b.name, 'ru'));

  const totals = lines.reduce(
    (acc, l) => {
      acc.qty_ordered += l.qty_ordered;
      acc.qty_received += l.qty_received;
      acc.qty_remaining += l.qty_remaining;
      acc.amount_ordered += Math.round(l.qty_ordered * (l.price_ordered || 0));
      return acc;
    },
    { qty_ordered: 0, qty_received: 0, qty_remaining: 0, amount_ordered: 0 }
  );

  return {
    order: {
      id: order.id,
      number: order.number,
      status: order.status,
      doc_date: order.doc_date,
      counterparty_id: order.counterparty_id,
      counterparty_name: order.counterparty_name,
      invoice_number: (order as { invoice_number?: string }).invoice_number || '',
      expected_arrival_date:
        (order as { expected_arrival_date?: string }).expected_arrival_date || '',
      amount: order.amount,
      lines_count: order.lines_count,
    },
    mode,
    lines,
    totals,
  };
}

export function mountSupplierOrderAnalysisRoutes(api: Hono): void {
  api.get('/purchases/supplier-orders/:id/analysis', (c) => {
    try {
      const mode =
        String(c.req.query('mode') || 'by_product').toLowerCase() === 'by_line'
          ? 'by_line'
          : 'by_product';
      return c.json(getSupplierOrderAnalysis(c.req.param('id'), mode));
    } catch (e) {
      return c.json({ error: e instanceof Error ? e.message : 'error' }, 400);
    }
  });

  api.post('/purchases/supplier-orders/:id/refresh-status', (c) => {
    try {
      const status = refreshThinSupplierOrderStatus(c.req.param('id'));
      const order = getThinJournalDoc('supplier_orders', c.req.param('id'));
      return c.json({ ok: true, status, order });
    } catch (e) {
      return c.json({ error: e instanceof Error ? e.message : 'error' }, 400);
    }
  });
}
