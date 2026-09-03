/**
 * Внешний API сведения номенклатуры (ТЗ 24.08.2026).
 * Ничего не запускает сам — только методы для вызова извне (Миша / скрипты).
 */
import type { Hono } from 'hono';
import { all, get, run } from './db.js';
import { newGuid } from './ids.js';
import { actorFromContext, canDo } from './auth.js';
import { auditFromContext } from './audit.js';
import { invalidateStockValuationCache, productInboundLayers } from './stock-valuation.js';

const CODE_TYPES = new Set(['1c', 'oem', 'supplier', 'old_mraer', 'barcode', 'gtin', 'sku', 'other']);

export type MergeKeepField = 'master' | 'source';

export type ProductMergeInput = {
  source_ids: string[];
  keep?: Partial<Record<'name' | 'category' | 'prices' | 'barcode', MergeKeepField>>;
  move_stock?: boolean;
  move_reserves?: boolean;
  move_cells?: boolean;
  move_suppliers?: boolean;
  merge_codes_to?: 'crosses' | 'alt_codes' | 'both';
  archive_sources?: boolean;
  comment?: string;
  dry_run?: boolean;
};

type ProductRow = {
  id: string;
  sku: string;
  name: string;
  code: string;
  barcode: string;
  gtin: string;
  array_sku: string;
  category_id: string | null;
  is_active: number;
  brand: string;
};

let schemaReady = false;

export function ensureCatalogApiSchema(): void {
  if (schemaReady) return;
  run(`
    CREATE TABLE IF NOT EXISTS product_alt_codes (
      id TEXT PRIMARY KEY,
      product_id TEXT NOT NULL,
      code_type TEXT NOT NULL DEFAULT 'other',
      value TEXT NOT NULL,
      supplier TEXT NOT NULL DEFAULT '',
      note TEXT NOT NULL DEFAULT '',
      source_product_id TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (product_id) REFERENCES products(id)
    )
  `);
  run(`CREATE INDEX IF NOT EXISTS idx_pac_product ON product_alt_codes(product_id)`);
  run(`CREATE INDEX IF NOT EXISTS idx_pac_value ON product_alt_codes(value)`);
  run(`CREATE UNIQUE INDEX IF NOT EXISTS idx_pac_unique ON product_alt_codes(product_id, code_type, value)`);

  run(`
    CREATE TABLE IF NOT EXISTS product_merge_map (
      master_product_id TEXT NOT NULL,
      source_product_id TEXT NOT NULL,
      merged_at TEXT NOT NULL DEFAULT (datetime('now')),
      comment TEXT NOT NULL DEFAULT '',
      PRIMARY KEY (master_product_id, source_product_id)
    )
  `);
  run(`CREATE INDEX IF NOT EXISTS idx_pmm_source ON product_merge_map(source_product_id)`);

  run(`
    CREATE TABLE IF NOT EXISTS catalog_idempotency (
      idempotency_key TEXT PRIMARY KEY,
      operation TEXT NOT NULL DEFAULT '',
      response_json TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  run(`
    CREATE TABLE IF NOT EXISTS catalog_snapshots (
      id TEXT PRIMARY KEY,
      label TEXT NOT NULL DEFAULT '',
      payload_json TEXT NOT NULL,
      product_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  run(`
    CREATE TABLE IF NOT EXISTS product_price_merge_log (
      id TEXT PRIMARY KEY,
      master_product_id TEXT NOT NULL,
      source_product_id TEXT NOT NULL,
      price_type TEXT NOT NULL,
      master_price REAL NOT NULL DEFAULT 0,
      source_price REAL NOT NULL DEFAULT 0,
      action TEXT NOT NULL DEFAULT 'kept_master',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  schemaReady = true;
}

function withTransaction<T>(fn: () => T): T {
  run('BEGIN IMMEDIATE');
  try {
    const out = fn();
    run('COMMIT');
    return out;
  } catch (e) {
    run('ROLLBACK');
    throw e;
  }
}

function normCode(raw: string): string {
  return String(raw || '')
    .trim()
    .replace(/\s+/g, ' ')
    .toUpperCase();
}

function splitCodes(raw: string): string[] {
  return String(raw || '')
    .split(/[,;|\n]+/)
    .map((x) => x.trim())
    .filter(Boolean);
}

function mergeArraySku(existing: string, extras: string[]): string {
  const set = new Set<string>();
  for (const x of [...splitCodes(existing), ...extras]) {
    const n = x.trim();
    if (n) set.add(n);
  }
  return [...set].join(', ');
}

function loadProduct(id: string): ProductRow | null {
  return (
    get<ProductRow>(
      `SELECT id, sku, name, IFNULL(code,'') AS code, IFNULL(barcode,'') AS barcode,
              IFNULL(gtin,'') AS gtin, IFNULL(array_sku,'') AS array_sku,
              category_id, IFNULL(is_active,1) AS is_active, IFNULL(brand,'') AS brand
       FROM products WHERE id = ?`,
      [id]
    ) || null
  );
}

export function mergedSourceIds(productId: string): string[] {
  ensureCatalogApiSchema();
  const rows = all<{ source_product_id: string }>(
    `SELECT source_product_id FROM product_merge_map WHERE master_product_id = ?`,
    [productId]
  );
  return rows.map((r) => String(r.source_product_id)).filter(Boolean);
}

export function allRelatedProductIds(productId: string): string[] {
  const sources = mergedSourceIds(productId);
  return [productId, ...sources];
}

function listAltCodes(productId: string) {
  ensureCatalogApiSchema();
  return all<{
    id: string;
    type: string;
    value: string;
    supplier: string;
    note: string;
    source_product_id: string;
    created_at: string;
  }>(
    `SELECT id, code_type AS type, value, supplier, note, source_product_id, created_at
     FROM product_alt_codes WHERE product_id = ? ORDER BY code_type, value`,
    [productId]
  ).map((r) => ({
    type: r.type,
    value: r.value,
    supplier: r.supplier || undefined,
    note: r.note || undefined,
    source_product_id: r.source_product_id || undefined,
    created_at: r.created_at,
  }));
}

function upsertAltCode(
  productId: string,
  entry: { type?: string; value: string; supplier?: string; note?: string; source_product_id?: string }
): void {
  const type = CODE_TYPES.has(String(entry.type || '').toLowerCase())
    ? String(entry.type).toLowerCase()
    : 'other';
  const value = String(entry.value || '').trim();
  if (!value) return;
  const existing = get<{ id: string }>(
    `SELECT id FROM product_alt_codes WHERE product_id = ? AND code_type = ? AND value = ?`,
    [productId, type, value]
  );
  if (existing?.id) return;
  run(
    `INSERT INTO product_alt_codes (id, product_id, code_type, value, supplier, note, source_product_id)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      newGuid(),
      productId,
      type,
      value,
      String(entry.supplier || '').trim(),
      String(entry.note || '').trim(),
      String(entry.source_product_id || '').trim(),
    ]
  );
}

function collectCodesFromProduct(p: ProductRow): Array<{ type: string; value: string; note?: string }> {
  const out: Array<{ type: string; value: string; note?: string }> = [];
  if (p.code) out.push({ type: '1c', value: p.code, note: 'code' });
  if (p.sku && p.sku !== p.code) out.push({ type: 'sku', value: p.sku, note: 'sku' });
  if (p.barcode) out.push({ type: 'barcode', value: p.barcode });
  if (p.gtin) out.push({ type: 'gtin', value: p.gtin });
  for (const x of splitCodes(p.array_sku)) {
    out.push({ type: 'oem', value: x });
  }
  return out;
}

function stockByWarehouse(productId: string): Array<{ warehouse_id: string; warehouse: string; qty: number }> {
  return all<{ warehouse_id: string; warehouse: string; qty: number }>(
    `SELECT b.warehouse_id, w.name AS warehouse, SUM(b.qty) AS qty
     FROM (
       SELECT warehouse_id, product_id, qty FROM stock_balances WHERE product_id = ? AND qty != 0
       UNION ALL
       SELECT warehouse_id, product_id, qty FROM product_store_rests
       WHERE product_id = ? AND qty != 0
         AND NOT EXISTS (
           SELECT 1 FROM stock_balances sb
           WHERE sb.product_id = product_store_rests.product_id
             AND sb.warehouse_id = product_store_rests.warehouse_id
             AND sb.qty != 0
         )
     ) b
     JOIN warehouses w ON w.id = b.warehouse_id
     GROUP BY b.warehouse_id, w.name
     HAVING SUM(b.qty) != 0`,
    [productId, productId]
  ).map((r) => ({
    warehouse_id: r.warehouse_id,
    warehouse: r.warehouse,
    qty: Math.round((Number(r.qty) || 0) * 1000) / 1000,
  }));
}

function findUnpostedDocs(productIds: string[]): string[] {
  if (!productIds.length) return [];
  const ph = productIds.map(() => '?').join(',');
  return all<{ number: string }>(
    `SELECT DISTINCT d.number
     FROM stock_docs d
     JOIN stock_doc_lines l ON l.doc_id = d.id
     WHERE IFNULL(d.posted,0) = 0 AND l.product_id IN (${ph})`,
    productIds
  ).map((r) => String(r.number));
}

function findOpenDeals(productIds: string[]): Array<{ deal_id: string; name: string }> {
  if (!productIds.length) return [];
  const ph = productIds.map(() => '?').join(',');
  const fromItems = all<{ deal_id: string; name: string }>(
    `SELECT DISTINCT d.id AS deal_id, IFNULL(d.name,'') AS name
     FROM crm_deal_items i
     JOIN crm_deals d ON d.id = i.deal_id
     WHERE i.product_guid IN (${ph})`,
    productIds
  );
  const fromReserves = all<{ deal_id: string; name: string }>(
    `SELECT DISTINCT r.deal_id, IFNULL(d.name,'') AS name
     FROM stock_reserves r
     LEFT JOIN crm_deals d ON d.id = r.deal_id
     WHERE r.product_id IN (${ph})
       AND IFNULL(r.deal_id,'') != ''
       AND lower(IFNULL(r.status,'')) NOT IN ('cancelled','released','done')`,
    productIds
  );
  const map = new Map<string, string>();
  for (const r of [...fromItems, ...fromReserves]) {
    if (r.deal_id) map.set(String(r.deal_id), String(r.name || ''));
  }
  return [...map.entries()].map(([deal_id, name]) => ({ deal_id, name }));
}

function bumpStock(masterId: string, warehouseId: string, delta: number): void {
  if (!(Math.abs(delta) > 0.0000001)) return;
  const row = get<{ qty: number }>(
    `SELECT qty FROM stock_balances WHERE warehouse_id = ? AND product_id = ?`,
    [warehouseId, masterId]
  );
  if (row) {
    run(`UPDATE stock_balances SET qty = ? WHERE warehouse_id = ? AND product_id = ?`, [
      Math.round((Number(row.qty) + delta) * 1000) / 1000,
      warehouseId,
      masterId,
    ]);
  } else if (delta > 0) {
    run(`INSERT INTO stock_balances (warehouse_id, product_id, qty) VALUES (?, ?, ?)`, [
      warehouseId,
      masterId,
      delta,
    ]);
  }
}

function moveStoreRest(masterId: string, sourceId: string, warehouseId: string, qty: number): void {
  bumpStock(masterId, warehouseId, qty);
  run(
    `UPDATE product_store_rests SET qty = 0 WHERE product_id = ? AND warehouse_id = ?`,
    [sourceId, warehouseId]
  );
}

function moveCellBalances(master: ProductRow, source: ProductRow): number {
  const rows = all<{
    warehouse_id: string;
    cell_id: string;
    sku: string;
    qty: number;
  }>(
    `SELECT warehouse_id, cell_id, sku, qty FROM stock_cell_balances WHERE product_id = ? AND qty != 0`,
    [source.id]
  );
  let moved = 0;
  for (const r of rows) {
    const qty = Number(r.qty) || 0;
    if (!(qty > 0)) continue;
    const masterSku = master.sku;
    const target = get<{ qty: number }>(
      `SELECT qty FROM stock_cell_balances
       WHERE warehouse_id = ? AND cell_id = ? AND sku = ?`,
      [r.warehouse_id, r.cell_id, masterSku]
    );
    if (target) {
      run(
        `UPDATE stock_cell_balances SET product_id = ?, product_name = ?, qty = ?
         WHERE warehouse_id = ? AND cell_id = ? AND sku = ?`,
        [
          master.id,
          master.name,
          Math.round((Number(target.qty) + qty) * 1000) / 1000,
          r.warehouse_id,
          r.cell_id,
          masterSku,
        ]
      );
    } else {
      run(
        `UPDATE stock_cell_balances SET product_id = ?, sku = ?, product_name = ?
         WHERE warehouse_id = ? AND cell_id = ? AND sku = ?`,
        [master.id, masterSku, master.name, r.warehouse_id, r.cell_id, r.sku]
      );
    }
    run(
      `DELETE FROM stock_cell_balances WHERE warehouse_id = ? AND cell_id = ? AND sku = ? AND product_id = ?`,
      [r.warehouse_id, r.cell_id, r.sku, source.id]
    );
    moved += qty;
  }
  return moved;
}

function logSourcePrices(masterId: string, sourceId: string): void {
  const masterPrices = all<{ price_type: string; price: number }>(
    `SELECT price_type, price FROM product_prices WHERE product_id = ?`,
    [masterId]
  );
  const masterMap = new Map(masterPrices.map((p) => [p.price_type, Number(p.price) || 0]));
  const sourcePrices = all<{ price_type: string; price: number }>(
    `SELECT price_type, price FROM product_prices WHERE product_id = ?`,
    [sourceId]
  );
  for (const sp of sourcePrices) {
    const mp = masterMap.get(sp.price_type) ?? 0;
    run(
      `INSERT INTO product_price_merge_log
         (id, master_product_id, source_product_id, price_type, master_price, source_price, action)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        newGuid(),
        masterId,
        sourceId,
        sp.price_type,
        mp,
        Number(sp.price) || 0,
        mp > 0 ? 'kept_master' : 'source_only',
      ]
    );
    if (!(mp > 0) && Number(sp.price) > 0) {
      run(
        `INSERT OR IGNORE INTO product_prices (id, product_id, price_type, price)
         VALUES (?, ?, ?, ?)`,
        [newGuid(), masterId, sp.price_type, Number(sp.price)]
      );
    }
  }
}

function copySupplierLinks(masterId: string, sourceId: string): number {
  const rows = all<{ supplier_id: string }>(
    `SELECT supplier_id FROM supplier_product_apps WHERE product_id = ?`,
    [sourceId]
  );
  let n = 0;
  for (const r of rows) {
    run(
      `INSERT OR IGNORE INTO supplier_product_apps (id, product_id, supplier_id) VALUES (?, ?, ?)`,
      [newGuid(), masterId, r.supplier_id]
    );
    n += 1;
  }
  return n;
}

export function planProductMerge(masterId: string, input: ProductMergeInput) {
  ensureCatalogApiSchema();
  const master = loadProduct(masterId);
  if (!master) throw new Error('Мастер-карточка не найдена');

  const sourceIds = [...new Set((input.source_ids || []).map((x) => String(x || '').trim()).filter(Boolean))];
  const warnings: string[] = [];
  const sources: ProductRow[] = [];

  for (const sid of sourceIds) {
    if (sid === masterId) throw new Error('Источник совпадает с мастером');
    const src = loadProduct(sid);
    if (!src) throw new Error(`Карточка-источник не найдена: ${sid}`);
    if (!src.is_active) warnings.push(`Источник ${sid} уже в архиве — будет пропущен`);
    sources.push(src);
  }

  const activeSources = sources.filter((s) => s.is_active);
  const activeIds = activeSources.map((s) => s.id);

  const unposted = findUnpostedDocs(activeIds);
  if (unposted.length) {
    const err = new Error(`Непроведённые документы по источникам: ${unposted.join(', ')}`);
    (err as Error & { status?: number; details?: unknown }).status = 409;
    (err as Error & { details?: unknown }).details = { documents: unposted };
    throw err;
  }

  const openDeals = findOpenDeals(activeIds);
  if (openDeals.length) {
    const err = new Error(
      `Источник в открытых сделках Amo: ${openDeals.map((d) => d.deal_id).join(', ')}`
    );
    (err as Error & { status?: number; details?: unknown }).status = 409;
    (err as Error & { details?: unknown }).details = { deals: openDeals };
    throw err;
  }

  const byWarehouse: Array<{ warehouse: string; qty: number }> = [];
  let totalQty = 0;
  const perSource: Array<{
    id: string;
    sku: string;
    by_warehouse: Array<{ warehouse_id: string; warehouse: string; qty: number }>;
    codes: string[];
  }> = [];

  for (const src of activeSources) {
    const whRows = stockByWarehouse(src.id);
    const codes = collectCodesFromProduct(src).map((c) => c.value);
    perSource.push({ id: src.id, sku: src.sku, by_warehouse: whRows, codes });
    for (const w of whRows) {
      totalQty += w.qty;
      const hit = byWarehouse.find((x) => x.warehouse === w.warehouse);
      if (hit) hit.qty = Math.round((hit.qty + w.qty) * 1000) / 1000;
      else byWarehouse.push({ warehouse: w.warehouse, qty: w.qty });
    }
  }

  const codesAdded = [
    ...new Set(
      activeSources.flatMap((s) => collectCodesFromProduct(s).map((c) => c.value).filter(Boolean))
    ),
  ].filter((c) => {
    const mCodes = new Set(collectCodesFromProduct(master).map((x) => normCode(x.value)));
    return !mCodes.has(normCode(c));
  });

  return {
    ok: true,
    dry_run: !!input.dry_run,
    master_id: masterId,
    master_sku: master.sku,
    sources: perSource,
    moved: { qty: Math.round(totalQty * 1000) / 1000, by_warehouse: byWarehouse },
    codes_added: codesAdded,
    archived: input.archive_sources === false ? [] : activeIds,
    warnings,
    options: {
      move_stock: input.move_stock !== false,
      move_reserves: input.move_reserves !== false,
      move_cells: input.move_cells !== false,
      move_suppliers: input.move_suppliers !== false,
      merge_codes_to: input.merge_codes_to || 'both',
      archive_sources: input.archive_sources !== false,
    },
  };
}

export function executeProductMerge(masterId: string, input: ProductMergeInput) {
  const plan = planProductMerge(masterId, input);
  if (input.dry_run) return plan;

  const master = loadProduct(masterId)!;
  const mergeCodesTo = input.merge_codes_to || 'both';
  const codesAdded: string[] = [];
  const archived: string[] = [];

  withTransaction(() => {
    for (const srcInfo of plan.sources) {
      const source = loadProduct(srcInfo.id);
      if (!source || !source.is_active) continue;

      if (input.move_stock !== false) {
        for (const w of srcInfo.by_warehouse) {
          bumpStock(masterId, w.warehouse_id, w.qty);
          run(`UPDATE stock_balances SET qty = 0 WHERE product_id = ? AND warehouse_id = ?`, [
            source.id,
            w.warehouse_id,
          ]);
          moveStoreRest(masterId, source.id, w.warehouse_id, w.qty);
        }
      }

      if (input.move_reserves !== false) {
        run(
          `UPDATE stock_reserves SET product_id = ?
           WHERE product_id = ? AND lower(IFNULL(status,'')) IN ('active','reserved','hold','open')`,
          [masterId, source.id]
        );
      }

      if (input.move_cells !== false) {
        moveCellBalances(master, source);
      }

      if (input.move_suppliers !== false) {
        copySupplierLinks(masterId, source.id);
      }

      logSourcePrices(masterId, source.id);

      const codeEntries = collectCodesFromProduct(source);
      let arraySku = master.array_sku;
      for (const ce of codeEntries) {
        if (!ce.value) continue;
        if (mergeCodesTo === 'crosses' || mergeCodesTo === 'both') {
          arraySku = mergeArraySku(arraySku, [ce.value]);
        }
        if (mergeCodesTo === 'alt_codes' || mergeCodesTo === 'both') {
          upsertAltCode(masterId, {
            type: ce.type,
            value: ce.value,
            note: ce.note || `merge from ${source.sku}`,
            source_product_id: source.id,
          });
        }
        if (!collectCodesFromProduct(master).some((x) => normCode(x.value) === normCode(ce.value))) {
          codesAdded.push(ce.value);
        }
      }
      if (mergeCodesTo === 'crosses' || mergeCodesTo === 'both') {
        run(`UPDATE products SET array_sku = ? WHERE id = ?`, [arraySku, masterId]);
      }

      run(
        `INSERT OR REPLACE INTO product_merge_map (master_product_id, source_product_id, merged_at, comment)
         VALUES (?, ?, datetime('now'), ?)`,
        [masterId, source.id, String(input.comment || '').trim()]
      );

      if (input.archive_sources !== false) {
        run(`UPDATE products SET is_active = 0, master_product_id = ?, dedup_role = 'alias' WHERE id = ?`, [
          masterId,
          source.id,
        ]);
        archived.push(source.id);
      }

      run(
        `UPDATE crm_deal_items SET product_guid = ?, sku = ?, code = ?
         WHERE product_guid = ?`,
        [masterId, master.sku, master.code, source.id]
      );
    }
  });

  invalidateStockValuationCache();

  return {
    ...plan,
    dry_run: false,
    codes_added: [...new Set(codesAdded)],
    archived,
  };
}

export function productUnitCost(productId: string) {
  const layers = productInboundLayers(productId);
  return {
    product_id: productId,
    method: 'fifo_inbound',
    qty: layers.qty,
    unit_cost: layers.unit_cost,
    total_value: layers.value,
    last_price: layers.last_price,
    merged_sources: mergedSourceIds(productId),
  };
}

function readIdempotency(key: string): unknown | null {
  ensureCatalogApiSchema();
  const row = get<{ response_json: string }>(
    `SELECT response_json FROM catalog_idempotency WHERE idempotency_key = ?`,
    [key]
  );
  if (!row?.response_json) return null;
  try {
    return JSON.parse(row.response_json);
  } catch {
    return null;
  }
}

function writeIdempotency(key: string, operation: string, response: unknown): void {
  ensureCatalogApiSchema();
  run(
    `INSERT OR REPLACE INTO catalog_idempotency (idempotency_key, operation, response_json, created_at)
     VALUES (?, ?, ?, datetime('now'))`,
    [key, operation, JSON.stringify(response)]
  );
}

function requireCatalogEdit(c: { json: (b: unknown, s?: number) => Response }): boolean {
  const actor = actorFromContext(c as never);
  if (!canDo(actor, 'can_edit_products')) {
    c.json({ error: 'Недостаточно прав: редактирование номенклатуры' }, 403);
    return false;
  }
  return true;
}

function httpError(c: { json: (b: unknown, s?: number) => Response }, e: unknown) {
  const err = e as Error & { status?: number; details?: unknown };
  const status = err.status && err.status >= 400 && err.status < 600 ? err.status : 400;
  return c.json({ error: err.message || 'error', details: err.details || undefined }, status);
}

export function mountProductCatalogApiRoutes(api: Hono): void {
  ensureCatalogApiSchema();

  api.post('/products/:master_id/merge', async (c) => {
    if (!requireCatalogEdit(c)) return c.res;
    const masterId = c.req.param('master_id');
    const body = (await c.req.json().catch(() => ({}))) as ProductMergeInput;
    try {
      const result = executeProductMerge(masterId, body);
      if (!body.dry_run) {
        auditFromContext(c, {
          action: 'product.merge',
          entity: 'product',
          entityId: masterId,
          summary: `Merge ${body.source_ids?.length || 0} → ${masterId}${body.dry_run ? ' (dry)' : ''}`,
          after: result,
        });
      }
      return c.json(result);
    } catch (e) {
      return httpError(c, e);
    }
  });

  api.get('/products/:id/codes', (c) => {
    const id = c.req.param('id');
    if (!loadProduct(id)) return c.json({ error: 'not found' }, 404);
    return c.json({ product_id: id, codes: listAltCodes(id) });
  });

  api.put('/products/:id/codes', async (c) => {
    if (!requireCatalogEdit(c)) return c.res;
    const id = c.req.param('id');
    if (!loadProduct(id)) return c.json({ error: 'not found' }, 404);
    const body = (await c.req.json().catch(() => ({}))) as {
      codes?: Array<{ type?: string; value: string; supplier?: string; note?: string }>;
      replace?: boolean;
    };
    if (body.replace) {
      run(`DELETE FROM product_alt_codes WHERE product_id = ?`, [id]);
    }
    for (const code of body.codes || []) {
      upsertAltCode(id, code);
    }
    auditFromContext(c, {
      action: 'product.codes.set',
      entity: 'product',
      entityId: id,
      summary: `Кроссы: ${(body.codes || []).length} шт.`,
    });
    return c.json({ ok: true, product_id: id, codes: listAltCodes(id) });
  });

  api.delete('/products/:id/codes', async (c) => {
    if (!requireCatalogEdit(c)) return c.res;
    const id = c.req.param('id');
    const value = (c.req.query('value') || '').trim();
    const type = (c.req.query('type') || '').trim().toLowerCase();
    if (!loadProduct(id)) return c.json({ error: 'not found' }, 404);
    if (value) {
      run(
        `DELETE FROM product_alt_codes WHERE product_id = ? AND value = ?${type ? ' AND code_type = ?' : ''}`,
        type ? [id, value, type] : [id, value]
      );
    } else {
      run(`DELETE FROM product_alt_codes WHERE product_id = ?`, [id]);
    }
    return c.json({ ok: true, product_id: id, codes: listAltCodes(id) });
  });

  api.get('/products/:id/cost', (c) => {
    const id = c.req.param('id');
    if (!loadProduct(id)) return c.json({ error: 'not found' }, 404);
    return c.json(productUnitCost(id));
  });

  api.post('/products/bulk/merge', async (c) => {
    if (!requireCatalogEdit(c)) return c.res;
    const body = (await c.req.json().catch(() => ({}))) as {
      operations?: Array<{ master_id: string; source_ids: string[] } & ProductMergeInput>;
      dry_run?: boolean;
      idempotency_key?: string;
    };
    const key = String(body.idempotency_key || '').trim();
    if (key) {
      const cached = readIdempotency(key);
      if (cached) return c.json(cached);
    }
    const ops = Array.isArray(body.operations) ? body.operations.slice(0, 500) : [];
    const results: unknown[] = [];
    for (const op of ops) {
      try {
        results.push(
          executeProductMerge(String(op.master_id || ''), {
            ...op,
            source_ids: op.source_ids || [],
            dry_run: body.dry_run,
          })
        );
      } catch (e) {
        results.push({ ok: false, master_id: op.master_id, error: e instanceof Error ? e.message : String(e) });
      }
    }
    const payload = { ok: true, dry_run: !!body.dry_run, results };
    if (key) writeIdempotency(key, 'bulk_merge', payload);
    return c.json(payload);
  });

  api.post('/products/bulk/archive', async (c) => {
    if (!requireCatalogEdit(c)) return c.res;
    const body = (await c.req.json().catch(() => ({}))) as {
      ids?: string[];
      idempotency_key?: string;
    };
    const key = String(body.idempotency_key || '').trim();
    if (key) {
      const cached = readIdempotency(key);
      if (cached) return c.json(cached);
    }
    const ids = [...new Set((body.ids || []).map((x) => String(x || '').trim()).filter(Boolean))].slice(0, 5000);
    const results: Array<{ id: string; ok: boolean; error?: string }> = [];
    for (const id of ids) {
      const p = loadProduct(id);
      if (!p) {
        results.push({ id, ok: false, error: 'not found' });
        continue;
      }
      run(`UPDATE products SET is_active = 0 WHERE id = ?`, [id]);
      results.push({ id, ok: true });
    }
    const payload = { ok: true, archived: results.filter((r) => r.ok).length, results };
    if (key) writeIdempotency(key, 'bulk_archive', payload);
    return c.json(payload);
  });

  api.patch('/products/bulk', async (c) => {
    if (!requireCatalogEdit(c)) return c.res;
    const body = (await c.req.json().catch(() => ({}))) as {
      ids?: string[];
      patch?: Record<string, unknown>;
      idempotency_key?: string;
    };
    const key = String(body.idempotency_key || '').trim();
    if (key) {
      const cached = readIdempotency(key);
      if (cached) return c.json(cached);
    }
    const allowed = ['name', 'sku', 'code', 'brand', 'category_id', 'barcode', 'gtin', 'array_sku', 'is_active'];
    const patch = body.patch || {};
    const fields = Object.keys(patch).filter((k) => allowed.includes(k));
    if (!fields.length) return c.json({ error: 'patch: нет допустимых полей' }, 400);
    const ids = [...new Set((body.ids || []).map((x) => String(x || '').trim()).filter(Boolean))].slice(0, 5000);
    const setSql = fields.map((f) => `${f} = ?`).join(', ');
    const results: Array<{ id: string; ok: boolean; error?: string }> = [];
    for (const id of ids) {
      if (!loadProduct(id)) {
        results.push({ id, ok: false, error: 'not found' });
        continue;
      }
      try {
        run(`UPDATE products SET ${setSql} WHERE id = ?`, [
          ...fields.map((f) => patch[f] as string | number | null),
          id,
        ]);
        results.push({ id, ok: true });
      } catch (e) {
        results.push({ id, ok: false, error: e instanceof Error ? e.message : String(e) });
      }
    }
    const payload = { ok: true, updated: results.filter((r) => r.ok).length, results };
    if (key) writeIdempotency(key, 'bulk_patch', payload);
    return c.json(payload);
  });

  api.post('/snapshots', async (c) => {
    if (!requireCatalogEdit(c)) return c.res;
    const body = (await c.req.json().catch(() => ({}))) as { label?: string; product_ids?: string[] };
    const ids = body.product_ids?.length
      ? [...new Set(body.product_ids.map(String))]
      : all<{ id: string }>(`SELECT id FROM products`).map((r) => r.id);
    const ph = ids.map(() => '?').join(',') || "''";
    const products = ids.length
      ? all(`SELECT * FROM products WHERE id IN (${ph})`, ids)
      : [];
    const stock = ids.length
      ? all(`SELECT * FROM stock_balances WHERE product_id IN (${ph})`, ids)
      : [];
    const prices = ids.length
      ? all(`SELECT * FROM product_prices WHERE product_id IN (${ph})`, ids)
      : [];
    const codes = ids.length
      ? all(`SELECT * FROM product_alt_codes WHERE product_id IN (${ph})`, ids)
      : [];
    const id = newGuid();
    const payload = { products, stock_balances: stock, product_prices: prices, product_alt_codes: codes };
    run(
      `INSERT INTO catalog_snapshots (id, label, payload_json, product_count) VALUES (?, ?, ?, ?)`,
      [id, String(body.label || '').trim() || 'snapshot', JSON.stringify(payload), products.length]
    );
    return c.json({ ok: true, id, label: body.label || '', product_count: products.length }, 201);
  });

  api.get('/snapshots/:id', (c) => {
    const row = get<{ id: string; label: string; payload_json: string; product_count: number; created_at: string }>(
      `SELECT id, label, payload_json, product_count, created_at FROM catalog_snapshots WHERE id = ?`,
      [c.req.param('id')]
    );
    if (!row) return c.json({ error: 'not found' }, 404);
    let payload: unknown = null;
    try {
      payload = JSON.parse(row.payload_json);
    } catch {
      payload = null;
    }
    return c.json({
      id: row.id,
      label: row.label,
      product_count: row.product_count,
      created_at: row.created_at,
      payload,
    });
  });

  api.post('/snapshots/:id/restore', async (c) => {
    if (!requireCatalogEdit(c)) return c.res;
    const body = (await c.req.json().catch(() => ({}))) as { dry_run?: boolean; restore_stock?: boolean; restore_prices?: boolean };
    const row = get<{ payload_json: string }>(`SELECT payload_json FROM catalog_snapshots WHERE id = ?`, [
      c.req.param('id'),
    ]);
    if (!row) return c.json({ error: 'not found' }, 404);
    const payload = JSON.parse(row.payload_json) as {
      products?: ProductRow[];
      stock_balances?: Array<{ warehouse_id: string; product_id: string; qty: number }>;
      product_prices?: Array<{ product_id: string; price_type: string; price: number }>;
    };
    const plan = {
      products: (payload.products || []).length,
      stock_rows: (payload.stock_balances || []).length,
      price_rows: (payload.product_prices || []).length,
    };
    if (body.dry_run) return c.json({ ok: true, dry_run: true, plan });

    withTransaction(() => {
      for (const p of payload.products || []) {
        run(
          `UPDATE products SET sku=?, name=?, code=?, barcode=?, gtin=?, array_sku=?, category_id=?, is_active=?, brand=?
           WHERE id=?`,
          [
            p.sku,
            p.name,
            p.code,
            p.barcode,
            p.gtin,
            p.array_sku,
            p.category_id,
            p.is_active,
            p.brand,
            p.id,
          ]
        );
      }
      if (body.restore_stock !== false) {
        for (const s of payload.stock_balances || []) {
          run(
            `INSERT INTO stock_balances (warehouse_id, product_id, qty) VALUES (?, ?, ?)
             ON CONFLICT(warehouse_id, product_id) DO UPDATE SET qty = excluded.qty`,
            [s.warehouse_id, s.product_id, s.qty]
          );
        }
      }
      if (body.restore_prices !== false) {
        for (const pr of payload.product_prices || []) {
          run(`DELETE FROM product_prices WHERE product_id = ? AND price_type = ?`, [
            pr.product_id,
            pr.price_type,
          ]);
          run(
            `INSERT INTO product_prices (id, product_id, price_type, price) VALUES (?, ?, ?, ?)`,
            [newGuid(), pr.product_id, pr.price_type, pr.price]
          );
        }
      }
    });
    invalidateStockValuationCache();
    return c.json({ ok: true, restored: plan });
  });

  api.post('/products/catalog/normalize-sku-clones', async (c) => {
    if (!requireCatalogEdit(c)) return c.res;
    const body = (await c.req.json().catch(() => ({}))) as { dry_run?: boolean; limit?: number };
    const lim = Math.min(10000, Math.max(1, Number(body.limit) || 5000));
    const rows = all<{ id: string; sku: string }>(
      `SELECT id, sku FROM products
       WHERE sku GLOB '*:[0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]'
       LIMIT ?`,
      [lim]
    );
    const actions: Array<{ id: string; from: string; to: string; suffix: string }> = [];
    for (const r of rows) {
      const m = String(r.sku).match(/^(.*):([0-9a-f]{6,8})$/i);
      if (!m) continue;
      const base = m[1]!.trim();
      const suffix = m[2]!;
      if (!base) continue;
      actions.push({ id: r.id, from: r.sku, to: base, suffix });
    }
    if (body.dry_run) return c.json({ ok: true, dry_run: true, count: actions.length, actions });

    let fixed = 0;
    for (const a of actions) {
      const clash = get<{ id: string }>(`SELECT id FROM products WHERE sku = ? AND id != ?`, [a.to, a.id]);
      if (clash) continue;
      upsertAltCode(a.id, { type: 'sku', value: a.from, note: 'бывший sku с хвостом :id' });
      run(`UPDATE products SET sku = ? WHERE id = ?`, [a.to, a.id]);
      fixed += 1;
    }
    return c.json({ ok: true, fixed, scanned: actions.length });
  });
}
