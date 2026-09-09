/**
 * Лоты мастер→поставщик/факт из листа Москвы (product_supplier_lots).
 * Для /pick: показать поставщика, мастер, факт и ячейку из документа/лота.
 */
import { all, get } from './db.js';

export type SupplierLotHint = {
  master_sku: string;
  fact_sku: string;
  supplier: string;
  cell_code: string;
  warehouse_name: string;
  qty: number;
};

let lotsTableReady: boolean | null = null;

export function supplierLotsTableReady(): boolean {
  if (lotsTableReady != null) return lotsTableReady;
  try {
    const hit = get<{ c: number }>(
      `SELECT COUNT(*) AS c FROM sqlite_master WHERE type='table' AND name='product_supplier_lots'`
    );
    lotsTableReady = Number(hit?.c || 0) > 0;
  } catch {
    lotsTableReady = false;
  }
  return lotsTableReady;
}

function parseSupplierFromNote(note: string): string {
  const m = String(note || '').match(/Поставщик:\s*([^\s·|,;]+)/i);
  return m ? String(m[1] || '').trim() : '';
}

function parseFactFromNote(note: string): string {
  const m = String(note || '').match(/Факт:\s*([^\s·|,;]+)/i);
  return m ? String(m[1] || '').trim() : '';
}

/**
 * Подсказка лота по карточке + опционально ячейке документа.
 * Если ячейка задана — берём лот с этой ячейкой; иначе — с наибольшим qty.
 */
export function resolveProductSupplierLotHint(
  productId: string,
  opts?: { preferCell?: string; dealId?: string }
): SupplierLotHint | null {
  const pid = String(productId || '').trim();
  if (!pid || !supplierLotsTableReady()) return null;

  const preferCell = String(opts?.preferCell || '').trim().toUpperCase();
  const dealId = String(opts?.dealId || '').trim();

  let noteSupplier = '';
  let noteFact = '';
  if (dealId) {
    const noteRow = get<{ note: string }>(
      `SELECT IFNULL(note,'') AS note FROM crm_deal_items
       WHERE deal_id = ? AND product_guid = ?
       ORDER BY line_no ASC LIMIT 1`,
      [dealId, pid]
    );
    const note = String(noteRow?.note || '');
    noteSupplier = parseSupplierFromNote(note);
    noteFact = parseFactFromNote(note);
  }

  const prod = get<{ sku: string }>(
    `SELECT IFNULL(sku,'') AS sku FROM products WHERE id = ?`,
    [pid]
  );
  const sku = String(prod?.sku || '').trim();

  const lots = all<{
    master_sku: string;
    fact_sku: string;
    supplier: string;
    cell_code: string;
    warehouse_name: string;
    qty: number;
  }>(
    `SELECT IFNULL(master_sku,'') AS master_sku,
            IFNULL(fact_sku,'') AS fact_sku,
            IFNULL(supplier,'') AS supplier,
            IFNULL(cell_code,'') AS cell_code,
            IFNULL(warehouse_name,'') AS warehouse_name,
            IFNULL(qty,0) AS qty
     FROM product_supplier_lots
     WHERE product_id = ?
        OR (? != '' AND (master_sku = ? OR fact_sku = ?))
     ORDER BY qty DESC, supplier ASC, fact_sku ASC`,
    [pid, sku, sku, sku]
  );
  if (!lots.length) {
    if (!noteSupplier && !noteFact && !sku) return null;
    return {
      master_sku: sku,
      fact_sku: noteFact || sku,
      supplier: noteSupplier,
      cell_code: preferCell,
      warehouse_name: '',
      qty: 0,
    };
  }

  let best = lots[0];
  if (preferCell) {
    const byCell = lots.find((l) => String(l.cell_code || '').trim().toUpperCase() === preferCell);
    if (byCell) best = byCell;
  }
  if (noteFact) {
    const byFact = lots.find(
      (l) => String(l.fact_sku || '').trim().toUpperCase() === noteFact.toUpperCase()
    );
    if (byFact) best = byFact;
  }
  if (noteSupplier) {
    const bySup = lots.find(
      (l) => String(l.supplier || '').trim().toUpperCase() === noteSupplier.toUpperCase()
    );
    if (bySup && (!preferCell || String(bySup.cell_code || '').toUpperCase() === preferCell)) {
      best = bySup;
    }
  }

  return {
    master_sku: String(best.master_sku || sku || '').trim(),
    fact_sku: String(best.fact_sku || noteFact || sku || '').trim(),
    supplier: String(best.supplier || noteSupplier || '').trim(),
    cell_code: String(best.cell_code || preferCell || '').trim(),
    warehouse_name: String(best.warehouse_name || '').trim(),
    qty: Number(best.qty) || 0,
  };
}

/** Поля для API строк /pick. */
export function supplierLotFieldsForLine(
  productId: string,
  opts?: { preferCell?: string; dealId?: string }
): {
  master_sku?: string;
  fact_sku?: string;
  supplier?: string;
  lot_cell_code?: string;
  lot_warehouse_name?: string;
} {
  const hint = resolveProductSupplierLotHint(productId, opts);
  if (!hint) return {};
  return {
    ...(hint.master_sku ? { master_sku: hint.master_sku } : {}),
    ...(hint.fact_sku ? { fact_sku: hint.fact_sku } : {}),
    ...(hint.supplier ? { supplier: hint.supplier } : {}),
    ...(hint.cell_code ? { lot_cell_code: hint.cell_code } : {}),
    ...(hint.warehouse_name ? { lot_warehouse_name: hint.warehouse_name } : {}),
  };
}
