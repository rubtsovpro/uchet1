/**
 * Связь товар → услуги (снятие/установка и др.).
 * В заказе автосервис/СТО при добавлении товара услуги предлагаются (не добавляются сами).
 */
import { all, get, run, db } from './db.js';
import { newGuid } from './ids.js';
import { resolveIsSto } from './deal-sale-rules.js';
import { loadRetailPrices } from './stock-valuation.js';

export const DEFAULT_INSTALL_SERVICE_SKU = 'SVC-INSTALL';
export const DEFAULT_INSTALL_SERVICE_NAME = 'Снятие/Установка';

/** Имя строки услуги: «Снятие/Установка (деталь…)» — цена install_price, в названии что снимаем/ставим. */
export function installServiceLineName(partName: string, baseName = DEFAULT_INSTALL_SERVICE_NAME): string {
  let n = String(partName || '').trim();
  // убрать ведущие артикулы / коды (MRAA…, НФ-…, 00-…)
  n = n.replace(/^(?:[A-ZА-Я]{2,}[\w./-]*\s+)+/iu, '').trim();
  n = n.replace(/\s*[|·].*$/u, '').trim();
  n = n.replace(/\s{2,}/g, ' ').trim();
  if (!n) return baseName;
  // не дублировать, если уже обёрнуто
  if (/^снятие\s*\/\s*установка\s*\(/iu.test(n)) return n;
  const max = 160;
  if (n.length > max) n = n.slice(0, max - 1).trimEnd() + '…';
  return `${baseName} (${n})`;
}

export async function ensureProductServiceLinksSchema(): Promise<void> {
  await Promise.resolve(
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
  `)
  );
  try {
    const cols = (await all<{ name: string }>('PRAGMA table_info(products)')).map((c) => c.name);
    if (!cols.includes('install_price')) {
      await Promise.resolve(
        db.exec(`ALTER TABLE products ADD COLUMN install_price REAL NOT NULL DEFAULT 0`)
      );
    }
    if (!cols.includes('price_min')) {
      await Promise.resolve(
        db.exec(`ALTER TABLE products ADD COLUMN price_min REAL NOT NULL DEFAULT 0`)
      );
    }
    if (!cols.includes('price_max')) {
      await Promise.resolve(
        db.exec(`ALTER TABLE products ADD COLUMN price_max REAL NOT NULL DEFAULT 0`)
      );
    }
  } catch {
    /* ignore */
  }
  try {
    const dic = (await all<{ name: string }>('PRAGMA table_info(crm_deal_items)')).map((c) => c.name);
    if (!dic.includes('parent_item_id')) {
      await Promise.resolve(
        db.exec(`ALTER TABLE crm_deal_items ADD COLUMN parent_item_id TEXT NOT NULL DEFAULT ''`)
      );
    }
    if (!dic.includes('auto_service')) {
      await Promise.resolve(
        db.exec(`ALTER TABLE crm_deal_items ADD COLUMN auto_service INTEGER NOT NULL DEFAULT 0`)
      );
    }
  } catch {
    /* ignore */
  }
}

/** Услуга-шаблон «Снятие / установка» в номенклатуре. */
export async function ensureDefaultInstallService(): Promise<{ id: string; sku: string; name: string }> {
  await ensureProductServiceLinksSchema();
  let row = await get<{ id: string; sku: string; name: string }>(
    `SELECT id, sku, name FROM products
     WHERE sku = ? OR (IFNULL(item_kind,'') = 'service' AND lower(replace(name,' ','')) LIKE 'снятие/установка%')
     ORDER BY CASE WHEN IFNULL(is_active,1)=1 THEN 0 ELSE 1 END, created_at DESC
     LIMIT 1`,
    [DEFAULT_INSTALL_SERVICE_SKU]
  );
  if (row) {
    // имя-шаблон в карточке — короткое; в заказе/доках будет «Снятие/Установка (товар)»
    return { id: row.id, sku: row.sku || DEFAULT_INSTALL_SERVICE_SKU, name: DEFAULT_INSTALL_SERVICE_NAME };
  }
  const unitId =
    (await get<{ id: string }>(`SELECT id FROM units WHERE short_name = ? LIMIT 1`, ['шт']))?.id ||
    (await get<{ id: string }>(`SELECT id FROM units LIMIT 1`))?.id ||
    '';
  if (!unitId) throw new Error('Нет единицы измерения «шт»');
  const id = newGuid();
  await run(
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

export async function listProductServiceLinks(productId: string): Promise<ServiceLink[]> {
  await ensureProductServiceLinksSchema();
  return await all<ServiceLink>(
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
export async function linkInstallService(
  productId: string,
  opts?: { price?: number; service_product_id?: string }
): Promise<ServiceLink> {
  await ensureProductServiceLinksSchema();
  const product = await get<{ id: string; install_price: number; item_kind: string }>(
    `SELECT id, IFNULL(install_price,0) AS install_price, IFNULL(item_kind,'product') AS item_kind
     FROM products WHERE id = ?`,
    [productId]
  );
  if (!product) throw new Error('Товар не найден');
  if (String(product.item_kind) === 'service') {
    throw new Error('К услуге нельзя привязать услугу');
  }
  const svc = opts?.service_product_id
    ? await get<{ id: string }>('SELECT id FROM products WHERE id = ?', [opts.service_product_id])
    : await ensureDefaultInstallService();
  if (!svc?.id) throw new Error('Услуга не найдена');
  const price =
    opts?.price != null && Number.isFinite(Number(opts.price))
      ? Math.max(0, Number(opts.price))
      : Number(product.install_price) || null;

  const existing = await get<{ id: string }>(
    `SELECT id FROM product_service_links
     WHERE product_id = ? AND role = 'install' LIMIT 1`,
    [productId]
  );
  if (existing) {
    await run(
      `UPDATE product_service_links
       SET service_product_id = ?, price_override = ?, auto_add = 1, qty_mode = 'same'
       WHERE id = ?`,
      [svc.id, price, existing.id]
    );
  } else {
    await run(
      `INSERT INTO product_service_links (
         id, product_id, service_product_id, role, price_override, qty_mode, auto_add, sort_order
       ) VALUES (?, ?, ?, 'install', ?, 'same', 1, 0)`,
      [newGuid(), productId, svc.id, price]
    );
  }
  if (price != null) {
    await run(`UPDATE products SET install_price = ? WHERE id = ?`, [price, productId]);
  }
  const links = await listProductServiceLinks(productId);
  const hit = links.find((l) => l.role === 'install') || links[0];
  if (!hit) throw new Error('Связь не создана');
  return hit;
}

export async function setProductServiceLinks(
  productId: string,
  links: Array<{
    service_product_id: string;
    role?: string;
    price_override?: number | null;
    auto_add?: boolean;
    qty_mode?: string;
  }>
): Promise<ServiceLink[]> {
  await ensureProductServiceLinksSchema();
  const product = await get('SELECT id FROM products WHERE id = ?', [productId]);
  if (!product) throw new Error('Товар не найден');
  await run(`DELETE FROM product_service_links WHERE product_id = ?`, [productId]);
  let order = 0;
  for (const L of links) {
    const sid = String(L.service_product_id || '').trim();
    if (!sid) continue;
    const svc = await get<{ item_kind: string }>('SELECT IFNULL(item_kind,\'product\') AS item_kind FROM products WHERE id = ?', [
      sid,
    ]);
    if (!svc) throw new Error(`Услуга ${sid} не найдена`);
    await run(
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
  return await listProductServiceLinks(productId);
}

async function productUnitName(unitId: string | undefined): Promise<string> {
  if (!unitId) return 'шт';
  return (
    (await get<{ short_name: string }>('SELECT short_name FROM units WHERE id = ?', [unitId]))
      ?.short_name || 'шт'
  );
}

function roundMoney(n: number): number {
  return Math.round(Number(n) || 0);
}

/** Цена снятия/установки: колонка products.install_price или тип цены товара «Снятие/Установка». */
export async function resolveInstallPrice(productId: string): Promise<number> {
  await ensureProductServiceLinksSchema();
  const col = await get<{ install_price: number }>(
    `SELECT IFNULL(install_price,0) AS install_price FROM products WHERE id = ?`,
    [productId]
  );
  const fromCol = Number(col?.install_price) || 0;
  if (fromCol > 0) return fromCol;
  const fromPp = await get<{ price: number }>(
    `SELECT price FROM product_prices
     WHERE product_id = ?
       AND (
         price_type = 'Снятие/Установка'
         OR price_type = 'Цена снятие/установки'
         OR lower(replace(IFNULL(price_type,''), ' ', '')) LIKE '%снятие%установ%'
         OR lower(price_type) LIKE '%снят%'
         OR lower(price_type) LIKE '%установ%'
       )
     ORDER BY CASE
       WHEN price_type = 'Снятие/Установка' THEN 0
       WHEN price_type = 'Цена снятие/установки' THEN 1
       ELSE 2
     END
     LIMIT 1`,
    [productId]
  );
  return Math.max(0, Number(fromPp?.price) || 0);
}

export function isInstallServiceSkuOrName(sku: string, name = ''): boolean {
  if (String(sku || '').trim().toUpperCase() === DEFAULT_INSTALL_SERVICE_SKU) return true;
  return /^снятие\s*\/\s*установка(\s*\(|$)/iu.test(String(name || '').trim());
}

/**
 * КН для услуги установки: «Снятие/Установка (товар)».
 * Имя позиции в заказе остаётся коротким «Снятие/Установка».
 */
export async function resolveInstallClientName(it: {
  sku?: string | null;
  name?: string | null;
  note?: string | null;
  parent_item_id?: string | null;
}): Promise<string> {
  const sku = String(it.sku || '').trim();
  const name = String(it.name || '').trim();
  if (!isInstallServiceSkuOrName(sku, name)) return '';

  const note = String(it.note || '').trim();
  const fromNote = note.match(/^КН:\s*(.+)$/u);
  if (fromNote?.[1]?.trim()) return fromNote[1].trim().slice(0, 255);

  // старые строки, где длинное имя уже в name
  if (/^снятие\s*\/\s*установка\s*\(/iu.test(name)) return name.slice(0, 255);

  const parentId = String(it.parent_item_id || '').trim();
  if (parentId) {
    const parent = await get<{ name: string }>(
      `SELECT IFNULL(name,'') AS name FROM crm_deal_items WHERE id = ? LIMIT 1`,
      [parentId]
    );
    const pn = String(parent?.name || '').trim();
    if (pn) return installServiceLineName(pn);
  }
  return DEFAULT_INSTALL_SERVICE_NAME;
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
export async function suggestLinkedServicesForDealItem(input: {
  dealId: string;
  parentItemId: string;
  productId: string;
  qty: number;
}): Promise<ServiceSuggestion[]> {
  await ensureProductServiceLinksSchema();
  const deal = await get<Record<string, unknown>>('SELECT * FROM crm_deals WHERE id = ?', [input.dealId]);
  if (!deal) return [];
  if (!resolveIsSto(deal)) return [];

  const product = await get<{ item_kind: string; name: string }>(
    `SELECT IFNULL(item_kind,'product') AS item_kind, IFNULL(name,'') AS name
     FROM products WHERE id = ?`,
    [input.productId]
  );
  if (!product || String(product.item_kind) === 'service') return [];

  const installPrice = await resolveInstallPrice(input.productId);

  let links = (await listProductServiceLinks(input.productId)).filter((l) => Number(l.auto_add) === 1);
  if (!links.length && installPrice > 0) {
    await linkInstallService(input.productId, { price: installPrice });
    links = (await listProductServiceLinks(input.productId)).filter((l) => Number(l.auto_add) === 1);
  }
  if (!links.length) return [];

  const retailMap = await loadRetailPrices(links.map((l) => l.service_product_id).filter(Boolean));
  const out: ServiceSuggestion[] = [];

  for (const link of links) {
    const svc = await get<Record<string, unknown>>(`SELECT * FROM products WHERE id = ?`, [
      link.service_product_id,
    ]);
    if (!svc) continue;

    const already = !!await get(
      `SELECT id FROM crm_deal_items
       WHERE deal_id = ? AND parent_item_id = ? AND product_guid = ?`,
      [input.dealId, input.parentItemId, String(svc.id)]
    );

    const qty =
      link.qty_mode === 'fixed' ? 1 : Math.max(0.001, Number(input.qty) || 1);
    const role = String(link.role || 'install');
    const isInstall =
      role === 'install' ||
      isInstallServiceSkuOrName(String(svc.sku || ''), String(svc.name || ''));
    // Цена только из типа цены товара «Снятие/Установка» / install_price — не розница шаблона SVC-INSTALL.
    let price = 0;
    if (isInstall) {
      price =
        link.price_override != null && Number.isFinite(Number(link.price_override)) && Number(link.price_override) > 0
          ? Math.max(0, Number(link.price_override))
          : installPrice;
    } else {
      price =
        link.price_override != null && Number.isFinite(Number(link.price_override))
          ? Math.max(0, Number(link.price_override))
          : retailMap.get(String(svc.id)) ?? 0;
    }
    const lineName = isInstall
      ? installServiceLineName(String(product.name || ''))
      : String(svc.name || DEFAULT_INSTALL_SERVICE_NAME);
    out.push({
      service_product_id: String(svc.id),
      sku: String(svc.sku || ''),
      code: String(svc.code || ''),
      // в подсказке показываем КН-вид; в заказ пишется короткое имя услуги
      name: lineName,
      role,
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
export async function listPendingServiceSuggestionsForDeal(dealId: string): Promise<Array<{
  parent_item_id: string;
  product_label: string;
  product_id: string;
  suggestions: ServiceSuggestion[];
}>> {
  await ensureProductServiceLinksSchema();
  const deal = await get<Record<string, unknown>>('SELECT * FROM crm_deals WHERE id = ?', [dealId]);
  if (!deal || !resolveIsSto(deal)) return [];

  const items = await all<{
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
    const kind = await get<{ item_kind: string }>(
      `SELECT IFNULL(item_kind,'product') AS item_kind FROM products WHERE id = ?`,
      [productId]
    );
    if (!kind || String(kind.item_kind) === 'service') continue;

    const suggestions = await suggestLinkedServicesForDealItem({
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
export async function applySuggestedServicesForDealItem(input: {
  dealId: string;
  parentItemId: string;
  services: Array<{ service_product_id: string; qty?: number; price?: number }>;
  mark?: string;
  model?: string;
  generation?: string;
}): Promise<Record<string, unknown>[]> {
  await ensureProductServiceLinksSchema();
  const deal = await get<Record<string, unknown>>('SELECT * FROM crm_deals WHERE id = ?', [input.dealId]);
  if (!deal) throw new Error('not found');
  if (!resolveIsSto(deal)) throw new Error('Услуги к товару — только в автосервисе / СТО');

  const parent = await get<{ product_guid: string; name: string }>(
    `SELECT product_guid, name FROM crm_deal_items WHERE id = ? AND deal_id = ?`,
    [input.parentItemId, input.dealId]
  );
  if (!parent) throw new Error('Позиция товара не найдена');

  const created: Record<string, unknown>[] = [];
  for (const sel of input.services || []) {
    const sid = String(sel.service_product_id || '').trim();
    if (!sid) continue;
    const svc = await get<Record<string, unknown>>(`SELECT * FROM products WHERE id = ?`, [sid]);
    if (!svc) continue;
    if (String(svc.item_kind || 'product') !== 'service') {
      throw new Error(`«${svc.name || sid}» не услуга`);
    }
    const already = await get(
      `SELECT id FROM crm_deal_items
       WHERE deal_id = ? AND parent_item_id = ? AND product_guid = ?`,
      [input.dealId, input.parentItemId, sid]
    );
    if (already) continue;

    const qty = Math.max(0.001, Number(sel.qty) || 1);
    const isInstall = isInstallServiceSkuOrName(String(svc.sku || ''), String(svc.name || ''));
    let price =
      sel.price != null && Number.isFinite(Number(sel.price)) ? Math.max(0, Number(sel.price)) : 0;
    if (!(price > 0) && isInstall) {
      price = await resolveInstallPrice(String(parent.product_guid || ''));
    }
    if (!(price > 0) && !isInstall) {
      price = (await loadRetailPrices([sid])).get(sid) ?? 0;
    }
    const amount = roundMoney(qty * price);
    const maxLine =
      (await get<{ m: number }>(
        'SELECT COALESCE(MAX(line_no), 0) AS m FROM crm_deal_items WHERE deal_id = ?',
        [input.dealId]
      ))?.m ?? 0;
    const itemId = newGuid();
    const note = `К ${String(parent.name || '').slice(0, 80)}`;
    // В заказе — просто услуга «Снятие/Установка»; КН «Снятие/Установка (товар)» собирается при документах/виджете
    const lineName = isInstall
      ? DEFAULT_INSTALL_SERVICE_NAME
      : String(svc.name || DEFAULT_INSTALL_SERVICE_NAME);
    const clientName = isInstall
      ? installServiceLineName(String(parent.name || ''))
      : '';
    await run(
      `INSERT INTO crm_deal_items (
         id, deal_id, product_guid, sku, code, name, brand, price, qty, amount, unit,
         department, note, line_no, warehouse_id, supplier_id, in_doc_id,
         mark, model, generation, parent_item_id, auto_service
       ) VALUES (?, ?, ?, ?, ?, ?, '', ?, ?, ?, ?, '', ?, ?, '', '', '', ?, ?, ?, ?, 1)`,
      [
        itemId,
        input.dealId,
        String(svc.id),
        String(svc.sku || ''),
        String(svc.code || ''),
        lineName,
        price,
        qty,
        amount,
        await productUnitName(svc.unit_id as string | undefined),
        // note хранит КН-подсказку, если колонки client_name нет
        isInstall && clientName ? `КН: ${clientName}` : note,
        Number(maxLine) + 1,
        // у услуги-установки не тащим применимость товара — иначе УПД/счёт пересоберут имя детали
        isInstall ? '' : String(input.mark || ''),
        isInstall ? '' : String(input.model || ''),
        isInstall ? '' : String(input.generation || ''),
        input.parentItemId,
      ]
    );
    const row = await get('SELECT * FROM crm_deal_items WHERE id = ?', [itemId]);
    if (row) created.push(row);
  }
  return created;
}
