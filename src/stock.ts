import { all, get, run } from './db.js';
import { newGuid, nextCode } from './ids.js';

export type DocType = 'in' | 'out' | 'transfer';

export function nextDocNumber(docType: DocType): string {
  const prefix = docType === 'in' ? 'IN' : docType === 'out' ? 'OUT' : 'TR';
  return nextCode(prefix, 5);
}

function applyDelta(warehouseId: string, productId: string, delta: number): void {
  const existing = get<{ qty: number }>(
    'SELECT qty FROM stock_balances WHERE warehouse_id = ? AND product_id = ?',
    [warehouseId, productId]
  );
  if (!existing) {
    if (delta < 0) {
      throw new Error('Недостаточно остатка');
    }
    run(
      'INSERT INTO stock_balances (warehouse_id, product_id, qty) VALUES (?, ?, ?)',
      [warehouseId, productId, delta]
    );
    return;
  }
  const next = Number(existing.qty) + delta;
  if (next < -0.0001) {
    throw new Error('Недостаточно остатка');
  }
  run(
    'UPDATE stock_balances SET qty = ? WHERE warehouse_id = ? AND product_id = ?',
    [next, warehouseId, productId]
  );
}

export function postDocument(docId: string): void {
  const doc = get<{
    id: string;
    doc_type: DocType;
    posted: number;
    warehouse_id: string;
    warehouse_to_id: string | null;
  }>('SELECT * FROM stock_docs WHERE id = ?', [docId]);
  if (!doc) throw new Error('Документ не найден');
  if (doc.posted) throw new Error('Уже проведён');

  const lines = all<{ product_id: string; qty: number }>(
    'SELECT product_id, qty FROM stock_doc_lines WHERE doc_id = ?',
    [docId]
  );
  if (!lines.length) throw new Error('Нет строк');

  run('BEGIN');
  try {
    for (const line of lines) {
      const qty = Number(line.qty);
      if (!(qty > 0)) throw new Error('Количество должно быть > 0');
      if (doc.doc_type === 'in') {
        applyDelta(doc.warehouse_id, line.product_id, qty);
      } else if (doc.doc_type === 'out') {
        applyDelta(doc.warehouse_id, line.product_id, -qty);
      } else {
        if (!doc.warehouse_to_id) throw new Error('Не указан склад-получатель');
        applyDelta(doc.warehouse_id, line.product_id, -qty);
        applyDelta(doc.warehouse_to_id, line.product_id, qty);
      }
    }
    run('UPDATE stock_docs SET posted = 1 WHERE id = ?', [docId]);
    run('COMMIT');
  } catch (e) {
    run('ROLLBACK');
    throw e;
  }
}

export function createDocument(input: {
  doc_type: DocType;
  warehouse_id: string;
  warehouse_to_id?: string | null;
  counterparty_id?: string | null;
  comment?: string;
  lines: Array<{ product_id: string; qty: number }>;
  post?: boolean;
}): string {
  const id = newGuid();
  const number = nextDocNumber(input.doc_type);
  const docDate = new Date().toISOString().slice(0, 10);
  run(
    `INSERT INTO stock_docs
      (id, doc_type, number, doc_date, warehouse_id, warehouse_to_id, counterparty_id, comment, posted)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)`,
    [
      id,
      input.doc_type,
      number,
      docDate,
      input.warehouse_id,
      input.warehouse_to_id ?? null,
      input.counterparty_id ?? null,
      input.comment ?? '',
    ]
  );
  for (const line of input.lines) {
    run(
      'INSERT INTO stock_doc_lines (id, doc_id, product_id, qty) VALUES (?, ?, ?, ?)',
      [newGuid(), id, line.product_id, line.qty]
    );
  }
  if (input.post !== false) {
    postDocument(id);
  }
  return id;
}
