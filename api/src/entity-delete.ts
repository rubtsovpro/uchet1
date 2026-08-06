/**
 * Правило: при наличии связей — нельзя hard-delete, только архив (is_active=0).
 * Без связей hard-delete допускается; UI всегда предлагает «В архив».
 */
import { all, get, run } from './db.js';

export const LINKED_DELETE_MSG = 'Нельзя удалить: есть связи. Перенесите в архив.';

type LinkCheck = { key: string; sql: string; params?: Array<string | number> };

function tableExists(name: string): boolean {
  const row = get<{ name: string }>(
    `SELECT name FROM sqlite_master WHERE type='table' AND name = ?`,
    [name]
  );
  return !!row;
}

function countSafe(sql: string, params: Array<string | number> = []): number {
  try {
    return get<{ c: number }>(sql, params)?.c ?? 0;
  } catch {
    return 0;
  }
}

function runChecks(checks: LinkCheck[]): { linked: boolean; counts: Record<string, number>; total: number } {
  const counts: Record<string, number> = {};
  let total = 0;
  for (const ch of checks) {
    const n = countSafe(ch.sql, ch.params || []);
    counts[ch.key] = n;
    total += n;
  }
  return { linked: total > 0, counts, total };
}

export function warehouseLinkInfo(id: string) {
  const checks: LinkCheck[] = [
    { key: 'stock_docs', sql: 'SELECT COUNT(*) AS c FROM stock_docs WHERE warehouse_id = ?', params: [id] },
    {
      key: 'stock_balances',
      sql: 'SELECT COUNT(*) AS c FROM stock_balances WHERE warehouse_id = ? AND ABS(qty) > 0.0000001',
      params: [id],
    },
    {
      key: 'product_store_rests',
      sql: 'SELECT COUNT(*) AS c FROM product_store_rests WHERE warehouse_id = ? AND ABS(qty) > 0.0000001',
      params: [id],
    },
  ];
  if (tableExists('warehouse_tasks')) {
    checks.push({
      key: 'warehouse_tasks',
      sql: 'SELECT COUNT(*) AS c FROM warehouse_tasks WHERE warehouse_id = ?',
      params: [id],
    });
  }
  if (tableExists('sales_docs')) {
    checks.push({
      key: 'sales_docs',
      sql: 'SELECT COUNT(*) AS c FROM sales_docs WHERE warehouse_id = ?',
      params: [id],
    });
  }
  return runChecks(checks);
}

export function productLinkInfo(id: string) {
  const checks: LinkCheck[] = [
    {
      key: 'stock_doc_lines',
      sql: 'SELECT COUNT(*) AS c FROM stock_doc_lines WHERE product_id = ?',
      params: [id],
    },
    {
      key: 'stock_balances',
      sql: 'SELECT COUNT(*) AS c FROM stock_balances WHERE product_id = ? AND ABS(qty) > 0.0000001',
      params: [id],
    },
    {
      key: 'product_store_rests',
      sql: 'SELECT COUNT(*) AS c FROM product_store_rests WHERE product_id = ? AND ABS(qty) > 0.0000001',
      params: [id],
    },
  ];
  if (tableExists('sales_doc_lines')) {
    checks.push({
      key: 'sales_doc_lines',
      sql: 'SELECT COUNT(*) AS c FROM sales_doc_lines WHERE product_id = ?',
      params: [id],
    });
  }
  if (tableExists('crm_deal_items')) {
    checks.push({
      key: 'crm_deal_items',
      sql: 'SELECT COUNT(*) AS c FROM crm_deal_items WHERE product_guid = ?',
      params: [id],
    });
  }
  if (tableExists('warehouse_task_lines')) {
    checks.push({
      key: 'warehouse_task_lines',
      sql: 'SELECT COUNT(*) AS c FROM warehouse_task_lines WHERE product_id = ?',
      params: [id],
    });
  }
  if (tableExists('sto_wo_materials')) {
    checks.push({
      key: 'sto_wo_materials',
      sql: 'SELECT COUNT(*) AS c FROM sto_wo_materials WHERE product_id = ?',
      params: [id],
    });
  }
  return runChecks(checks);
}

export function counterpartyLinkInfo(id: string) {
  const checks: LinkCheck[] = [
    {
      key: 'stock_docs',
      sql: 'SELECT COUNT(*) AS c FROM stock_docs WHERE counterparty_id = ?',
      params: [id],
    },
  ];
  if (tableExists('cash_docs')) {
    checks.push({
      key: 'cash_docs',
      sql: 'SELECT COUNT(*) AS c FROM cash_docs WHERE counterparty_id = ?',
      params: [id],
    });
  }
  if (tableExists('sales_docs')) {
    checks.push({
      key: 'sales_docs',
      sql: 'SELECT COUNT(*) AS c FROM sales_docs WHERE counterparty_id = ?',
      params: [id],
    });
  }
  if (tableExists('crm_deals')) {
    checks.push({
      key: 'crm_deals',
      sql: 'SELECT COUNT(*) AS c FROM crm_deals WHERE company_id = ?',
      params: [id],
    });
  }
  if (tableExists('crm_events')) {
    checks.push({
      key: 'crm_events',
      sql: 'SELECT COUNT(*) AS c FROM crm_events WHERE counterparty_id = ?',
      params: [id],
    });
  }
  return runChecks(checks);
}

export function organizationLinkInfo(id: string) {
  const checks: LinkCheck[] = [];
  if (tableExists('sales_docs')) {
    checks.push({
      key: 'sales_docs',
      sql: 'SELECT COUNT(*) AS c FROM sales_docs WHERE organization_id = ?',
      params: [id],
    });
  }
  if (tableExists('stock_docs')) {
    checks.push({
      key: 'stock_docs',
      sql: 'SELECT COUNT(*) AS c FROM stock_docs WHERE organization_id = ?',
      params: [id],
    });
  }
  if (tableExists('payment_links')) {
    checks.push({
      key: 'payment_links',
      sql: 'SELECT COUNT(*) AS c FROM payment_links WHERE organization_id = ?',
      params: [id],
    });
  }
  return runChecks(checks);
}

export function categoryLinkInfo(id: string) {
  return runChecks([
    {
      key: 'products',
      sql: 'SELECT COUNT(*) AS c FROM products WHERE category_id = ?',
      params: [id],
    },
    {
      key: 'children',
      sql: 'SELECT COUNT(*) AS c FROM categories WHERE parent_id = ?',
      params: [id],
    },
  ]);
}

export function bankAccountLinkInfo(id: string) {
  const row = get<{ account: string }>('SELECT account FROM company_bank_accounts WHERE id = ?', [id]);
  const account = String(row?.account || '').trim();
  const checks: LinkCheck[] = [];
  if (tableExists('bank_docs_local') && account) {
    checks.push({
      key: 'bank_docs_local',
      sql: `SELECT COUNT(*) AS c FROM bank_docs_local
            WHERE IFNULL(account,'') = ? OR IFNULL(payload_json,'') LIKE ?`,
      params: [account, `%${account}%`],
    });
  }
  if (tableExists('deal_payments') && account) {
    checks.push({
      key: 'deal_payments',
      sql: 'SELECT COUNT(*) AS c FROM deal_payments WHERE account = ?',
      params: [account],
    });
  }
  // Даже без FK — если счёт единственный активный, не даём hard-delete «в никуда»
  if (!checks.length) {
    return { linked: false, counts: {}, total: 0 };
  }
  return runChecks(checks);
}

export function priceTypeLinkInfo(name: string) {
  return runChecks([
    {
      key: 'product_prices',
      sql: 'SELECT COUNT(*) AS c FROM product_prices WHERE price_type = ?',
      params: [name],
    },
  ]);
}

export type EntityKind =
  | 'warehouse'
  | 'product'
  | 'counterparty'
  | 'organization'
  | 'category'
  | 'bank_account'
  | 'price_type';

export function linkInfo(kind: EntityKind, id: string, extraName?: string) {
  switch (kind) {
    case 'warehouse':
      return warehouseLinkInfo(id);
    case 'product':
      return productLinkInfo(id);
    case 'counterparty':
      return counterpartyLinkInfo(id);
    case 'organization':
      return organizationLinkInfo(id);
    case 'category':
      return categoryLinkInfo(id);
    case 'bank_account':
      return bankAccountLinkInfo(id);
    case 'price_type':
      return priceTypeLinkInfo(extraName || id);
    default:
      return { linked: false, counts: {}, total: 0 };
  }
}

/** 409 если есть связи. */
export function rejectHardDeleteIfLinked(kind: EntityKind, id: string, extraName?: string) {
  const info = linkInfo(kind, id, extraName);
  if (info.linked) {
    const err = new Error(LINKED_DELETE_MSG) as Error & { status: number; links: typeof info };
    err.status = 409;
    err.links = info;
    throw err;
  }
  return info;
}

export function hardDeleteWarehouse(id: string): void {
  rejectHardDeleteIfLinked('warehouse', id);
  run('DELETE FROM stock_balances WHERE warehouse_id = ?', [id]);
  run('DELETE FROM product_store_rests WHERE warehouse_id = ?', [id]);
  run('DELETE FROM warehouses WHERE id = ?', [id]);
}

export function hardDeleteProduct(id: string): void {
  rejectHardDeleteIfLinked('product', id);
  run('BEGIN');
  try {
    run('DELETE FROM product_applicability WHERE product_id = ?', [id]);
    run('DELETE FROM product_properties WHERE product_id = ?', [id]);
    run('DELETE FROM product_prices WHERE product_id = ?', [id]);
    run('DELETE FROM product_related WHERE product_id = ? OR related_id = ?', [id, id]);
    run('DELETE FROM product_media WHERE product_id = ?', [id]);
    run('DELETE FROM product_store_rests WHERE product_id = ?', [id]);
    run('DELETE FROM stock_balances WHERE product_id = ?', [id]);
    run('DELETE FROM products WHERE id = ?', [id]);
    run('COMMIT');
  } catch (e) {
    try {
      run('ROLLBACK');
    } catch {
      /* ignore */
    }
    throw e;
  }
}

export function hardDeleteCounterparty(_id: string): void {
  throw new Error('Удаление контрагентов запрещено. Перенесите в архив.');
}

export function hardDeleteOrganization(id: string): void {
  rejectHardDeleteIfLinked('organization', id);
  const row = get<{ is_default: number }>('SELECT is_default FROM organizations WHERE id = ?', [id]);
  if (!row) throw new Error('Организация не найдена');
  if (row.is_default) throw new Error('Нельзя удалить организацию по умолчанию');
  run('DELETE FROM organizations WHERE id = ?', [id]);
}

export function hardDeleteCategory(id: string): void {
  rejectHardDeleteIfLinked('category', id);
  run('DELETE FROM categories WHERE id = ?', [id]);
}

export function hardDeleteBankAccount(id: string): void {
  rejectHardDeleteIfLinked('bank_account', id);
  run('DELETE FROM company_bank_accounts WHERE id = ?', [id]);
}

/** Сумма |qty| по складу (balances + rests). */
export function warehouseStockQty(id: string): number {
  const fromBal = get<{ s: number }>(
    `SELECT IFNULL(SUM(ABS(qty)),0) AS s FROM stock_balances
     WHERE warehouse_id = ? AND ABS(qty) > 0.0000001`,
    [id]
  );
  const fromRest = get<{ s: number }>(
    `SELECT IFNULL(SUM(ABS(qty)),0) AS s FROM product_store_rests
     WHERE warehouse_id = ? AND ABS(qty) > 0.0000001`,
    [id]
  );
  return Math.max(Number(fromBal?.s) || 0, Number(fromRest?.s) || 0);
}

export function archiveWarehouse(id: string) {
  const stockQty = warehouseStockQty(id);
  if (stockQty > 0.0000001) {
    const err = new Error(
      'На складе есть остатки. Сначала создайте заказ на перемещение.'
    ) as Error & { status: number; stock_qty: number; has_stock: boolean };
    err.status = 409;
    err.stock_qty = stockQty;
    err.has_stock = true;
    throw err;
  }
  run('UPDATE warehouses SET is_active = 0 WHERE id = ?', [id]);
  return get('SELECT * FROM warehouses WHERE id = ?', [id]);
}

export function archiveProduct(id: string) {
  run('UPDATE products SET is_active = 0 WHERE id = ?', [id]);
  return get('SELECT * FROM products WHERE id = ?', [id]);
}

export function archiveCounterparty(id: string) {
  run('UPDATE counterparties SET is_active = 0 WHERE id = ?', [id]);
  return get('SELECT * FROM counterparties WHERE id = ?', [id]);
}

export function archiveBankAccount(id: string) {
  run('UPDATE company_bank_accounts SET is_active = 0 WHERE id = ?', [id]);
  return get('SELECT * FROM company_bank_accounts WHERE id = ?', [id]);
}

/** Удобный payload для UI: can_delete = нет связей. */
export function withDeleteMeta<T extends Record<string, unknown>>(
  kind: EntityKind,
  row: T | null | undefined,
  idField = 'id'
): (T & { has_links: boolean; can_delete: boolean; link_counts: Record<string, number> }) | null {
  if (!row) return null;
  const id = String(row[idField] ?? '');
  const extra = kind === 'price_type' ? String(row.name ?? '') : undefined;
  const info = linkInfo(kind, id, extra);
  return {
    ...row,
    has_links: info.linked,
    can_delete: !info.linked,
    link_counts: info.counts,
  };
}

/** Список таблиц, на которые смотрим (для отладки/тестов). */
export function listEntityKinds(): EntityKind[] {
  return ['warehouse', 'product', 'counterparty', 'organization', 'category', 'bank_account', 'price_type'];
}
