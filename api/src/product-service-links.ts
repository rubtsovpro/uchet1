/**
 * Связь товар → услуги (снятие/установка и др.).
 * В заказе автосервис/СТО при добавлении товара услуги предлагаются (не добавляются сами).
 */
import { all, get, run, db } from './db.js';
import { newGuid } from './ids.js';
import { resolveIsSto } from './deal-sale-rules.js';
import { loadRetailPrices } from './stock-valuation.js';

export const DEFAULT_INSTALL_SERVICE_SKU = 'SVC-INSTALL';
export const DEFAULT_INSTALL_SERVICE_NAME = 'Снятие / установка';

export function ensureProductServiceLinksSchema(): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS product_service_links (
      id TEXT PRIMARY KEY,
      product_id TEXT NOT NULL,
      service_product_id TEXT NOT NULL DEFAULT '',
      role TEXT NOT NULL DEFAULT 'install',
      price_override REAL,
      qty_mode TEXT NOT NULL DEFAULT 'same',
      auto_add INTEGER NOT NULL DEFAULT 1,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(product_id, service_product_id, role)
    );
    CREATE INDEX IF NOT EXISTS idx_psl_product ON product_service_links(product_id);
  `);
  try {
    const cols = all<{ name: string }>('PRAGMA table_info(products)').map((c) => c.name);
    if (!cols.includes('install_price')) {
      db.exec(`ALTER TABLE products ADD COLUMN install_price REAL NOT NULL DEFAULT 0`);
    }
    if (!cols.includes('price_min')) {
      db.exec(`ALTER TABLE products ADD COLUMN price_min REAL NOT NULL DEFAULT 0`);
    }
    if (!cols.includes('price_max')) {
      db.exec(`ALTER TABLE products ADD COLUMN price_max REAL NOT NULL DEFAULT 0`);
    }
  } catch {
    /* ignore */
  }
  try {
    const dic = all<{ name: string }>('PRAGMA table_info(crm_deal_items)').map((c) => c.name);
    if (!dic.includes('parent_item_id')) {
      db.exec(`ALTER TABLE crm_deal_items ADD COLUMN parent_item_id TEXT NOT NULL DEFAULT ''`);
    }
    if (!dic.includes('auto_service')) {
      db.exec(`ALTER TABLE crm_deal_items ADD COLUMN auto_service INTEGER NOT NULL DEFAULT 0`);
    }
  } catch {
    /* ignore */
  }
}

/** Услуга-шаблон «Снятие / установка» в номенклатуре. */
export function ensureDefaultInstallService(): { id: string; sku: string; name: string } {
  ensureProductServiceLinksSchema();
  let row = get<{ id: string; sku: string; name: string }>(
    `SELECT id, sku, name FROM products
     WHERE sku = ? OR (IFNULL(item_kind,'') = 'service' AND lower(name) = lower(?))
     LIMIT 1`,
    [DEFAULT_INSTALL_SERVICE_SKU, DEFAULT_INSTALL_SERVICE_NAME]
  );
  if (row) return { id: row.id, sku: row.sku, name: row.name };
  const unitId =
    get<{ id: string }>(`SELECT id FROM units WHERE short_name = ? LIMIT 1`, ['шт'])?.id ||
    get<{ id: string }>(`SELECT id FROM units LIMIT 1`)?.id ||
    '';
  if (!unitId) throw new Error('Нет единицы измерения «шт»');
  const id = newGuid();
  run(
    `INSERT INTO products (id, sku, code, name, category_id, unit_id, barcode, item_kind, brand)
     VALUES (?, ?, ?, ?, NULL, ?, '', 'service', '')`,
    [id, DEFAULT_INSTALL_SERVICE_SKU, DEFAULT_INSTALL_SERVICE_SKU, DEFAULT_INSTALL_SERVICE_NAME, unitId]
  );
  return { id, sku: DEFAULT_INSTALL_SERVICE_SKU, name: DEFAULT_INSTALL_SERVICE_NAME };
}

export type ServiceLink = {
  id: string;
  product_id: string;
  service_product_id: string;
  role: string;
  price_override: number | null;
  qty_mode: string;
  auto_add: number;
  sort_order: number;
  service_sku?: string;
  service_name?: string;
  service_item_kind?: string;
};

export function listProductServiceLinks(productId: string): ServiceLink[] {
  ensureProductServiceLinksSchema();
  return all<ServiceLink>(
    `SELECT l.*,
            IFNULL(p.sku,'') AS service_sku,
            IFNULL(p.name,'') AS service_name,
            IFNULL(p.item_kind,'service') AS service_item_kind
     FROM product_service_links l
     LEFT JOIN products p ON p.id = l.service_product_id
     WHERE l.product_id = ?
     ORDER BY l.sort_order, l.created_at`,
    [productId]
  );
}

/** Привязать услугу снятия/установки к товару (цена из install_price или явная). */
export function linkInstallService(
  productId: string,
  opts?: { price?: number; service_product_id?: string }
): ServiceLink {
  ensureProductServiceLinksSchema();
  const product = get<{ id: string; install_price: number; item_kind: string }>(
    `SELECT id, IFNULL(install_price,0) AS install_price, IFNULL(item_kind,'product') AS item_kind
     FROM products WHERE id = ?`,
    [productId]
  );
  if (!product) throw new Error('Товар не найден');
  if (String(product.item_kind) === 'service') {
    throw new Error('К услуге нельзя привязать услугу');
  }
  const svc = opts?.service_product_id
    ? get<{ id: string }>('SELECT id FROM products WHERE id = ?', [opts.service_product_id])
    : ensureDefaultInstallService();
  if (!svc?.id) throw new Error('Услуга не найдена');
  const price =
    opts?.price != null && Number.isFinite(Number(opts.price))
      ? Math.max(0, Number(opts.price))
      : Number(product.install_price) || null;

  const existing = get<{ id: string }>(
    `SELECT id FROM product_service_links
     WHERE product_id = ? AND role = 'install' LIMIT 1`,
    [productId]
  );
  if (existing) {
    run(
      `UPDATE product_service_links
       SET service_product_id = ?, price_override = ?, auto_add = 1, qty_mode = 'same'
       WHERE id = ?`,
      [svc.id, price, existing.id]
    );
  } else {
    run(
      `INSERT INTO product_service_links (
         id, product_id, service_product_id, role, price_override, qty_mode, auto_add, sort_order
       ) VALUES (?, ?, ?, 'install', ?, 'same', 1, 0)`,
      [newGuid(), productId, svc.id, price]
    );
  }
  if (price != null) {
    run(`UPDATE products SET install_price = ? WHERE id = ?`, [price, productId]);
  }
  const links = listProductServiceLinks(productId);
  const hit = links.find((l) => l.role === 'install') || links[0];
  if (!hit) throw new Error('Связь не создана');
  return hit;
}

export function setProductServiceLinks(
  productId: string,
  links: Array<{
    service_product_id: string;
    role?: string;
    price_override?: number | null;
    auto_add?: boolean;
    qty_mode?: string;
  }>
): ServiceLink[] {
  ensureProductServiceLinksSchema();
  const product = get('SELECT id FROM products WHERE id = ?', [productId]);
  if (!product) throw new Error('Товар не найден');
  run(`DELETE FROM product_service_links WHERE product_id = ?`, [productId]);
  let order = 0;
  for (const L of links) {
    const sid = String(L.service_product_id || '').trim();
    if (!sid) continue;
    const svc = get<{ item_kind: string }>('SELECT IFNULL(item_kind,\'product\') AS item_kind FROM products WHERE id = ?', [
      sid,
    ]);
    if (!svc) throw new Error(`Услуга ${sid} не найдена`);
    run(
      `INSERT INTO product_service_links (
         id, product_id, service_product_id, role, price_override, qty_mode, auto_add, sort_order
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        newGuid(),
        productId,
        sid,
        String(L.role || 'install').slice(0, 40),
        L.price_override == null || !Number.isFinite(Number(L.price_override))
          ? null
          : Math.max(0, Number(L.price_override) || 0),
        String(L.qty_mode || 'same'),
        L.auto_add === false ? 0 : 1,
        order++,
      ]
    );
  }
  return listProductServiceLinks(productId);
}

function productUnitName(unitId: string | undefined): string {
  if (!unitId) return 'шт';
  return (
    get<{ short_name: string }>('SELECT short_name FROM units WHERE id = ?', [unitId])
      ?.short_name || 'шт'
  );
}

function roundMoney(n: number): number {
  return Math.round(Number(n) || 0);
}

/** Цена снятия/установки: колонка products.install_price или product_prices. */
export function resolveInstallPrice(productId: string): number {
  ensureProductServiceLinksSchema();
  const col = get<{ install_price: number }>(
    `SELECT IFNULL(install_price,0) AS install_price FROM products WHERE id = ?`,
    [productId]
  );
  const fromCol = Number(col?.install_price) || 0;
  if (fromCol > 0) return fromCol;
  const fromPp = get<{ price: number }>(
    `SELECT price FROM product_prices
     WHERE product_id = ?
       AND (
         price_type = 'Цена снятие/установки'
         OR lower(price_type) LIKE '%снят%'
         OR lower(price_type) LIKE '%установ%'
       )
     ORDER BY CASE WHEN price_type = 'Цена снятие/установки' THEN 0 ELSE 1 END
     LIMIT 1`,
    [productId]
  );
  return Math.max(0, Number(fromPp?.price) || 0);
}

export type ServiceSuggestion = {
  service_product_id: string;
  sku: string;
  code: string;
  name: string;
  role: string;
  qty: number;
  price: number;
  amount: number;
  already: boolean;
};

/** Предложить связанные услуги для позиции (автосервис / СТО) — без записи в заказ. */
export function suggestLinkedServicesForDealItem(input: {
  dealId: string;
  parentItemId: string;
  productId: string;
  qty: number;
}): ServiceSuggestion[] {
  ensureProductServiceLinksSchema();
  const deal = get<Record<string, unknown>>('SELECT * FROM crm_deals WHERE id = ?', [input.dealId]);
  if (!deal) return [];
  if (!resolveIsSto(deal)) return [];

  const product = get<{ item_kind: string; name: string }>(
    `SELECT IFNULL(item_kind,'product') AS item_kind, IFNULL(name,'') AS name
     FROM products WHERE id = ?`,
    [input.productId]
  );
  if (!product || String(product.item_kind) === 'service') return [];

  const installPrice = resolveInstallPrice(input.productId);

  let links = listProductServiceLinks(input.productId).filter((l) => Number(l.auto_add) === 1);
  if (!links.length && installPrice > 0) {
    linkInstallService(input.productId, { price: installPrice });
    links = listProductServiceLinks(input.productId).filter((l) => Number(l.auto_add) === 1);
  }
  if (!links.length) return [];

  const retailMap = loadRetailPrices(links.map((l) => l.service_product_id).filter(Boolean));
  const out: ServiceSuggestion[] = [];

  for (const link of links) {
    const svc = get<Record<string, unknown>>(`SELECT * FROM products WHERE id = ?`, [
      link.service_product_id,
    ]);
    if (!svc) continue;

    const already = !!get(
      `SELECT id FROM crm_deal_items
       WHERE deal_id = ? AND parent_item_id = ? AND product_guid = ?`,
      [input.dealId, input.parentItemId, String(svc.id)]
    );

    const qty =
      link.qty_mode === 'fixed' ? 1 : Math.max(0.001, Number(input.qty) || 1);
    let price =
      link.price_override != null && Number.isFinite(Number(link.price_override))
        ? Math.max(0, Number(link.price_override))
        : retailMap.get(String(svc.id)) ?? 0;
    if (!(price > 0) && installPrice > 0 && link.role === 'install') {
      price = installPrice;
    }
    out.push({
      service_product_id: String(svc.id),
      sku: String(svc.sku || ''),
      code: String(svc.code || ''),
      name: String(svc.name || DEFAULT_INSTALL_SERVICE_NAME),
      role: String(link.role || 'install'),
      qty,
      price,
      amount: roundMoney(qty * price),
      already,
    });
  }
  return out.filter((s) => !s.already);
}

/**
 * Для СТО/автосервис: товары в заказе, к которым ещё не добавлены связанные услуги.
 */
export function listPendingServiceSuggestionsForDeal(dealId: string): Array<{
  parent_item_id: string;
  product_label: string;
  product_id: string;
  suggestions: ServiceSuggestion[];
}> {
  ensureProductServiceLinksSchema();
  const deal = get<Record<string, unknown>>('SELECT * FROM crm_deals WHERE id = ?', [dealId]);
  if (!deal || !resolveIsSto(deal)) return [];

  const items = all<{
    id: string;
    product_guid: string;
    name: string;
    qty: number;
    parent_item_id: string;
  }>(
    `SELECT id,
            IFNULL(product_guid,'') AS product_guid,
            IFNULL(name,'') AS name,
            IFNULL(qty,1) AS qty,
            IFNULL(parent_item_id,'') AS parent_item_id
     FROM crm_deal_items
     WHERE deal_id = ?
     ORDER BY line_no, name`,
    [dealId]
  );

  const out: Array<{
    parent_item_id: string;
    product_label: string;
    product_id: string;
    suggestions: ServiceSuggestion[];
  }> = [];

  for (const it of items) {
    if (String(it.parent_item_id || '').trim()) continue;
    const productId = String(it.product_guid || '').trim();
    if (!productId) continue;
    const kind = get<{ item_kind: string }>(
      `SELECT IFNULL(item_kind,'product') AS item_kind FROM products WHERE id = ?`,
      [productId]
    );
    if (!kind || String(kind.item_kind) === 'service') continue;

    const suggestions = suggestLinkedServicesForDealItem({
      dealId,
      parentItemId: String(it.id),
      productId,
      qty: Number(it.qty) || 1,
    });
    if (!suggestions.length) continue;
    out.push({
      parent_item_id: String(it.id),
      product_label: String(it.name || '').slice(0, 120),
      product_id: productId,
      suggestions,
    });
  }
  return out;
}

/** Добавить выбранные услуги к позиции товара в заказе. */
export function applySuggestedServicesForDealItem(input: {
  dealId: string;
  parentItemId: string;
  services: Array<{ service_product_id: string; qty?: number; price?: number }>;
  mark?: string;
  model?: string;
  generation?: string;
}): Record<string, unknown>[] {
  ensureProductServiceLinksSchema();
  const deal = get<Record<string, unknown>>('SELECT * FROM crm_deals WHERE id = ?', [input.dealId]);
  if (!deal) throw new Error('not found');
  if (!resolveIsSto(deal)) throw new Error('Услуги к товару — только в автосервисе / СТО');

  const parent = get<{ product_guid: string; name: string }>(
    `SELECT product_guid, name FROM crm_deal_items WHERE id = ? AND deal_id = ?`,
    [input.parentItemId, input.dealId]
  );
  if (!parent) throw new Error('Позиция товара не найдена');

  const created: Record<string, unknown>[] = [];
  for (const sel of input.services || []) {
    const sid = String(sel.service_product_id || '').trim();
    if (!sid) continue;
    const svc = get<Record<string, unknown>>(`SELECT * FROM products WHERE id = ?`, [sid]);
    if (!svc) continue;
    if (String(svc.item_kind || 'product') !== 'service') {
      throw new Error(`«${svc.name || sid}» не услуга`);
    }
    const already = get(
      `SELECT id FROM crm_deal_items
       WHERE deal_id = ? AND parent_item_id = ? AND product_guid = ?`,
      [input.dealId, input.parentItemId, sid]
    );
    if (already) continue;

    const qty = Math.max(0.001, Number(sel.qty) || 1);
    const price =
      sel.price != null && Number.isFinite(Number(sel.price))
        ? Math.max(0, Number(sel.price))
        : loadRetailPrices([sid]).get(sid) ?? 0;
    const amount = roundMoney(qty * price);
    const maxLine =
      get<{ m: number }>(
        'SELECT COALESCE(MAX(line_no), 0) AS m FROM crm_deal_items WHERE deal_id = ?',
        [input.dealId]
      )?.m ?? 0;
    const itemId = newGuid();
    const note = `К ${String(parent.name || '').slice(0, 80)}`;
    run(
      `INSERT INTO crm_deal_items (
         id, deal_id, product_guid, sku, code, name, brand, price, qty, amount, unit,
         department, note, line_no, warehouse_id, supplier_id, in_doc_id,
         mark, model, generation, parent_item_id, auto_service
       ) VALUES (?, ?, ?, ?, ?, ?, '', ?, ?, ?, ?, '', ?, ?, '', '', '', ?, ?, ?, ?, 0)`,
      [
        itemId,
        input.dealId,
        String(svc.id),
        String(svc.sku || ''),
        String(svc.code || ''),
        String(svc.name || DEFAULT_INSTALL_SERVICE_NAME),
        price,
        qty,
        amount,
        productUnitName(svc.unit_id as string | undefined),
        note,
        Number(maxLine) + 1,
        String(input.mark || ''),
        String(input.model || ''),
        String(input.generation || ''),
        input.parentItemId,
      ]
    );
    const row = get('SELECT * FROM crm_deal_items WHERE id = ?', [itemId]);
    if (row) created.push(row);
  }
  return created;
}
