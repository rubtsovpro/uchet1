/**
 * Коррекция остатков — только администраторы Учёта (не склад / picker).
 */
import { all, get, run } from './db.js';
import { createDocument, nextDocNumber } from './stock.js';
import { newGuid } from './ids.js';
import { productIsService } from './product-kind.js';

export const STOCK_ADJUST_DOC_PREFIX = 'Коррекция остатков ·';

export type StockAdjustActor = {
  id?: string;
  name?: string;
  login?: string;
  role?: string;
  isSystemAdmin?: boolean;
};

export function actorIsStockAdjustAdmin(
  actor: StockAdjustActor | null | undefined
): boolean {
  return !!(actor && (actor.isSystemAdmin || actor.role === 'admin'));
}

export function stockAdjustAdminDocFilter(alias = 'd'): string {
  return ` AND IFNULL(${alias}.admin_only, 0) = 0`;
}

export function ensureStockAdjustmentsSchema(): void {
  const docCols = all<{ name: string }>('PRAGMA table_info(stock_docs)').map((c) => c.name);
  if (!docCols.includes('admin_only')) {
    run(`ALTER TABLE stock_docs ADD COLUMN admin_only INTEGER NOT NULL DEFAULT 0`);
  }
  run(`
    CREATE TABLE IF NOT EXISTS stock_adjustments (
      id TEXT PRIMARY KEY,
      warehouse_id TEXT NOT NULL,
      product_id TEXT NOT NULL,
      qty_before REAL NOT NULL,
      qty_delta REAL NOT NULL,
      qty_after REAL NOT NULL,
      comment TEXT NOT NULL DEFAULT '',
      doc_id TEXT NOT NULL,
      doc_number TEXT NOT NULL DEFAULT '',
      doc_type TEXT NOT NULL DEFAULT '',
      created_by_id TEXT NOT NULL DEFAULT '',
      created_by_name TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  run(`CREATE INDEX IF NOT EXISTS idx_stock_adj_wh ON stock_adjustments(warehouse_id, created_at)`);
  run(`CREATE INDEX IF NOT EXISTS idx_stock_adj_doc ON stock_adjustments(doc_id)`);
}

function productQtyOnWarehouse(warehouseId: string, productId: string): number {
  return (
    Number(
      get<{ q: number }>(
        `SELECT IFNULL(qty, 0) AS q FROM stock_balances WHERE warehouse_id = ? AND product_id = ?`,
        [warehouseId, productId]
      )?.q
    ) || 0
  );
}

function actorLabel(actor: StockAdjustActor | null | undefined): string {
  return String(actor?.name || actor?.login || 'администратор').trim() || 'администратор';
}

export function createStockAdjustment(input: {
  warehouse_id: string;
  product_id: string;
  /** Новое количество после коррекции (>= 0). */
  qty_after: number;
  comment: string;
  actor?: StockAdjustActor | null;
}): {
  id: string;
  warehouse_id: string;
  product_id: string;
  qty_before: number;
  qty_delta: number;
  qty_after: number;
  comment: string;
  doc_id: string;
  doc_number: string;
  doc_type: string;
} {
  ensureStockAdjustmentsSchema();

  const warehouseId = String(input.warehouse_id || '').trim();
  const productId = String(input.product_id || '').trim();
  const comment = String(input.comment || '').trim();
  const qtyAfter = Math.max(0, Number(input.qty_after) || 0);

  if (!warehouseId) throw new Error('Укажите склад');
  if (!productId) throw new Error('Укажите товар');
  if (productIsService(productId)) throw new Error('Услуги не корректируют остаток');
  if (comment.length < 3) throw new Error('Комментарий обязателен (минимум 3 символа)');

  const wh = get<{ id: string }>(`SELECT id FROM warehouses WHERE id = ?`, [warehouseId]);
  if (!wh) throw new Error('Склад не найден');
  const prod = get<{ id: string; name: string }>(
    `SELECT id, IFNULL(name,'') AS name FROM products WHERE id = ?`,
    [productId]
  );
  if (!prod) throw new Error('Товар не найден');

  const qtyBefore = productQtyOnWarehouse(warehouseId, productId);
  const qtyDelta = Math.round((qtyAfter - qtyBefore) * 1000) / 1000;
  if (Math.abs(qtyDelta) < 0.0001) {
    throw new Error(`Остаток уже ${qtyBefore} — изменений нет`);
  }

  const actorName = actorLabel(input.actor);
  const docComment = `${STOCK_ADJUST_DOC_PREFIX} ${comment} · ${actorName} · было ${qtyBefore} → стало ${qtyAfter}`;

  const docType = qtyDelta > 0 ? 'in' : 'out';
  const docId = createDocument({
    doc_type: docType,
    warehouse_id: warehouseId,
    comment: docComment,
    serials_optional: true,
    lines: [
      {
        product_id: productId,
        qty: Math.abs(qtyDelta),
        warehouse_id: warehouseId,
      },
    ],
    post: true,
  });

  run(`UPDATE stock_docs SET admin_only = 1 WHERE id = ?`, [docId]);

  const doc = get<{ number: string; doc_type: string }>(
    `SELECT number, doc_type FROM stock_docs WHERE id = ?`,
    [docId]
  );

  const adjId = newGuid();
  run(
    `INSERT INTO stock_adjustments (
       id, warehouse_id, product_id, qty_before, qty_delta, qty_after,
       comment, doc_id, doc_number, doc_type, created_by_id, created_by_name
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      adjId,
      warehouseId,
      productId,
      qtyBefore,
      qtyDelta,
      qtyAfter,
      comment,
      docId,
      String(doc?.number || nextDocNumber(docType)),
      String(doc?.doc_type || docType),
      String(input.actor?.id || ''),
      actorName,
    ]
  );

  return {
    id: adjId,
    warehouse_id: warehouseId,
    product_id: productId,
    qty_before: qtyBefore,
    qty_delta: qtyDelta,
    qty_after: qtyAfter,
    comment,
    doc_id: docId,
    doc_number: String(doc?.number || ''),
    doc_type: String(doc?.doc_type || docType),
  };
}

export function listStockAdjustments(opts: {
  warehouse_id?: string;
  limit?: number;
  offset?: number;
}): { items: Array<Record<string, unknown>>; total: number } {
  ensureStockAdjustmentsSchema();
  const limit = Math.min(200, Math.max(1, Number(opts.limit) || 50));
  const offset = Math.max(0, Number(opts.offset) || 0);
  const wh = String(opts.warehouse_id || '').trim();
  const where = wh ? 'WHERE a.warehouse_id = ?' : '';
  const params: Array<string | number> = wh ? [wh] : [];
  const total =
    Number(
      get<{ c: number }>(`SELECT COUNT(*) AS c FROM stock_adjustments a ${where}`, params)?.c
    ) || 0;
  const items = all(
    `SELECT a.*,
            IFNULL(w.name,'') AS warehouse_name,
            IFNULL(w.code,'') AS warehouse_code,
            IFNULL(p.name,'') AS product_name,
            IFNULL(p.sku,'') AS product_sku
     FROM stock_adjustments a
     LEFT JOIN warehouses w ON w.id = a.warehouse_id
     LEFT JOIN products p ON p.id = a.product_id
     ${where}
     ORDER BY datetime(a.created_at) DESC, a.id DESC
     LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );
  return { items, total };
}
