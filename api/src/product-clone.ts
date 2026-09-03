/**
 * Клонирование / создание номенклатуры для закупа (импорт заказа).
 */
import { all, get, run } from './db.js';
import { ensureSeqAtLeast, newGuid, nextCode } from './ids.js';

export type ProductRow = {
  id: string;
  sku: string;
  code: string;
  name: string;
  brand: string;
  category_id: string | null;
  unit_id: string;
  array_sku: string;
  warehouse_sku: string;
  barcode: string;
  gtin: string;
  item_kind: string;
  is_active: number;
  package_width_cm: number | null;
  package_height_cm: number | null;
  package_length_cm: number | null;
  package_weight_g: number | null;
  requires_marking: number;
  serial_tracked: number;
  min_stock: number;
  install_price: number;
  notupload: number;
  is_main: number;
};

function normSku(s: string): string {
  return String(s || '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '');
}

function splitCodes(s: string): string[] {
  return String(s || '')
    .split(/[,;|/]+/)
    .map((x) => x.trim())
    .filter(Boolean);
}

function joinComma(parts: string[]): string {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const p of parts) {
    const k = normSku(p);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(String(p).trim());
  }
  return out.join(',');
}

function joinSemi(parts: string[]): string {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const p of parts) {
    const k = normSku(p);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(String(p).trim());
  }
  return out.join(';');
}

/** Предпочесть «чистую» карточку MRAER без зеркал @podveska. */
export function findCleanProduct(sku: string): ProductRow | null {
  const k = normSku(sku);
  if (!k) return null;
  const rows = all<ProductRow>(
    `SELECT id, sku, IFNULL(code,'') AS code, IFNULL(name,'') AS name,
            IFNULL(brand,'') AS brand, category_id, IFNULL(unit_id,'') AS unit_id,
            IFNULL(array_sku,'') AS array_sku, IFNULL(warehouse_sku,'') AS warehouse_sku,
            IFNULL(barcode,'') AS barcode, IFNULL(gtin,'') AS gtin,
            IFNULL(item_kind,'product') AS item_kind, IFNULL(is_active,1) AS is_active,
            package_width_cm, package_height_cm, package_length_cm, package_weight_g,
            IFNULL(requires_marking,0) AS requires_marking,
            IFNULL(serial_tracked,0) AS serial_tracked,
            IFNULL(min_stock,0) AS min_stock,
            IFNULL(install_price,0) AS install_price,
            IFNULL(notupload,0) AS notupload,
            IFNULL(is_main,0) AS is_main
     FROM products
     WHERE upper(replace(IFNULL(sku,''),' ','')) = ?
     ORDER BY
       CASE WHEN id LIKE 'pnevmopodveska%' THEN 2 ELSE 0 END,
       CASE WHEN sku LIKE '%:%' THEN 1 ELSE 0 END,
       CASE WHEN upper(IFNULL(brand,'')) = 'MRAER' THEN 0 ELSE 1 END,
       length(sku)
     LIMIT 5`,
    [k]
  );
  return rows[0] || null;
}

/** Поиск по sku / code / array_sku / warehouse_sku. */
export function findProductByAnySku(sku: string): ProductRow | null {
  const exact = findCleanProduct(sku);
  if (exact) return exact;
  const k = normSku(sku);
  if (!k) return null;
  const row = get<ProductRow>(
    `SELECT id, sku, IFNULL(code,'') AS code, IFNULL(name,'') AS name,
            IFNULL(brand,'') AS brand, category_id, IFNULL(unit_id,'') AS unit_id,
            IFNULL(array_sku,'') AS array_sku, IFNULL(warehouse_sku,'') AS warehouse_sku,
            IFNULL(barcode,'') AS barcode, IFNULL(gtin,'') AS gtin,
            IFNULL(item_kind,'product') AS item_kind, IFNULL(is_active,1) AS is_active,
            package_width_cm, package_height_cm, package_length_cm, package_weight_g,
            IFNULL(requires_marking,0) AS requires_marking,
            IFNULL(serial_tracked,0) AS serial_tracked,
            IFNULL(min_stock,0) AS min_stock,
            IFNULL(install_price,0) AS install_price,
            IFNULL(notupload,0) AS notupload,
            IFNULL(is_main,0) AS is_main
     FROM products
     WHERE upper(replace(IFNULL(code,''),' ','')) = ?
        OR (',' || upper(replace(replace(IFNULL(array_sku,''),' ',''),';',',')) || ',')
             LIKE '%' || ? || '%'
        OR (';' || upper(replace(replace(IFNULL(warehouse_sku,''),' ',''),',',';')) || ';')
             LIKE '%' || ? || '%'
     ORDER BY
       CASE WHEN id LIKE 'pnevmopodveska%' THEN 2 ELSE 0 END,
       CASE WHEN upper(IFNULL(brand,'')) = 'MRAER' THEN 0 ELSE 1 END
     LIMIT 1`,
    [k, k, k]
  );
  return row || null;
}

/**
 * AE12679 → MRAE12679, AA20460 → MRAA20460.
 * Уже с MR — без изменений.
 */
export function normalizeImportSku(raw: string): { sku: string; normalized_from?: string } {
  const trimmed = String(raw || '').trim();
  const k = normSku(trimmed);
  if (!k) return { sku: '' };
  if (/^MR[A-Z]{2}\d+/i.test(k)) return { sku: k };
  if (/^[AE]{2}\d{5,}$/i.test(k) || /^A[AE]\d{5,}$/i.test(k)) {
    return { sku: 'MR' + k, normalized_from: k };
  }
  return { sku: k };
}

function twinId(productId: string): string {
  const id = String(productId || '');
  if (id.startsWith('pnevmopodveska_2025::')) return id;
  return `pnevmopodveska_2025::${id}`;
}

function copyChildRows(table: string, cols: string[], fromId: string, toId: string): number {
  const rows = all<Record<string, unknown>>(`SELECT * FROM ${table} WHERE product_id = ?`, [
    fromId,
  ]);
  for (const row of rows) {
    const id = newGuid();
    const values = cols.map((c) => {
      if (c === 'id') return id;
      if (c === 'product_id') return toId;
      return row[c] as string | number | null;
    });
    run(
      `INSERT OR IGNORE INTO ${table} (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`,
      values
    );
  }
  return rows.length;
}

export function ensureOldSkuOnCard(
  productId: string,
  oldSku: string
): { changed: boolean; array_sku: string; warehouse_sku: string } {
  const old = String(oldSku || '').trim();
  const p = get<{ id: string; array_sku: string; warehouse_sku: string }>(
    `SELECT id, IFNULL(array_sku,'') AS array_sku, IFNULL(warehouse_sku,'') AS warehouse_sku
     FROM products WHERE id = ?`,
    [productId]
  );
  if (!p || !old) {
    return { changed: false, array_sku: p?.array_sku || '', warehouse_sku: p?.warehouse_sku || '' };
  }
  const asku = joinComma([...splitCodes(p.array_sku), old]);
  const wsku = joinSemi([...splitCodes(p.warehouse_sku), old]);
  const changed = asku !== p.array_sku || wsku !== p.warehouse_sku;
  if (changed) {
    run(`UPDATE products SET array_sku = ?, warehouse_sku = ? WHERE id = ?`, [
      asku,
      wsku,
      productId,
    ]);
  }
  return { changed, array_sku: asku, warehouse_sku: wsku };
}

export function createMinimalProduct(input: {
  sku: string;
  name?: string;
  brand?: string;
  category_id?: string | null;
  old_sku?: string;
}): { product: ProductRow; created: boolean } {
  const sku = normSku(input.sku);
  if (!sku) throw new Error('sku required');
  const existing = findCleanProduct(sku);
  if (existing) {
    if (input.old_sku) ensureOldSkuOnCard(existing.id, input.old_sku);
    return { product: findCleanProduct(sku) || existing, created: false };
  }
  const mx = get<{ m: number }>(
    `SELECT MAX(CAST(substr(v, instr(v, '-') + 1) AS INTEGER)) AS m FROM (
       SELECT sku AS v FROM products WHERE sku LIKE 'НФ-%'
       UNION ALL
       SELECT code AS v FROM products WHERE code LIKE 'НФ-%'
     )`
  )?.m;
  if (mx && Number.isFinite(Number(mx))) ensureSeqAtLeast('НФ', Number(mx));
  const unitId =
    get<{ id: string }>(`SELECT id FROM units WHERE short_name = ? LIMIT 1`, ['шт'])?.id ||
    get<{ id: string }>(`SELECT id FROM units LIMIT 1`)?.id ||
    '';
  if (!unitId) throw new Error('нет единиц измерения');
  const id = newGuid();
  const code = nextCode('НФ');
  const name = String(input.name || '').trim() || sku;
  const brand = String(input.brand || 'MRAER').trim() || 'MRAER';
  const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
  const old = String(input.old_sku || '').trim();
  const arraySku = joinComma([sku, old].filter(Boolean));
  const warehouseSku = old ? joinSemi([old]) : '';
  run(
    `INSERT INTO products (
       id, sku, name, category_id, unit_id, barcode, is_active, created_at, brand, code,
       array_sku, warehouse_sku, item_kind, is_main
     ) VALUES (?,?,?,?,?,?,1,?,?,?,?,?,'product',0)`,
    [
      id,
      sku,
      name,
      input.category_id || null,
      unitId,
      sku,
      now,
      brand,
      code,
      arraySku,
      warehouseSku,
    ]
  );
  return { product: findCleanProduct(sku)!, created: true };
}

export function cloneProductFrom(input: {
  new_sku: string;
  from_sku?: string;
  from_product_id?: string;
  old_sku?: string;
  minimal?: boolean;
}): {
  product: ProductRow;
  created: boolean;
  meta?: Record<string, unknown>;
} {
  const newSku = normSku(input.new_sku);
  if (!newSku) throw new Error('new_sku required');
  const existing = findCleanProduct(newSku);
  if (existing) {
    if (input.old_sku) ensureOldSkuOnCard(existing.id, input.old_sku);
    return { product: findCleanProduct(newSku) || existing, created: false };
  }

  let src: ProductRow | null = null;
  if (input.from_product_id) {
    src =
      get<ProductRow>(
        `SELECT id, sku, IFNULL(code,'') AS code, IFNULL(name,'') AS name,
              IFNULL(brand,'') AS brand, category_id, IFNULL(unit_id,'') AS unit_id,
              IFNULL(array_sku,'') AS array_sku, IFNULL(warehouse_sku,'') AS warehouse_sku,
              IFNULL(barcode,'') AS barcode, IFNULL(gtin,'') AS gtin,
              IFNULL(item_kind,'product') AS item_kind, IFNULL(is_active,1) AS is_active,
              package_width_cm, package_height_cm, package_length_cm, package_weight_g,
              IFNULL(requires_marking,0) AS requires_marking,
              IFNULL(serial_tracked,0) AS serial_tracked,
              IFNULL(min_stock,0) AS min_stock,
              IFNULL(install_price,0) AS install_price,
              IFNULL(notupload,0) AS notupload,
              IFNULL(is_main,0) AS is_main
       FROM products WHERE id = ?`,
        [input.from_product_id]
      ) || null;
  }
  if (!src && input.from_sku) src = findProductByAnySku(input.from_sku);
  if (!src && input.old_sku) src = findProductByAnySku(input.old_sku);

  if (!src || input.minimal) {
    return createMinimalProduct({
      sku: newSku,
      name: src?.name,
      brand: src?.brand || 'MRAER',
      category_id: src?.category_id,
      old_sku: input.old_sku || input.from_sku,
    });
  }

  const mx = get<{ m: number }>(
    `SELECT MAX(CAST(substr(v, instr(v, '-') + 1) AS INTEGER)) AS m FROM (
       SELECT sku AS v FROM products WHERE sku LIKE 'НФ-%'
       UNION ALL
       SELECT code AS v FROM products WHERE code LIKE 'НФ-%'
     )`
  )?.m;
  if (mx && Number.isFinite(Number(mx))) ensureSeqAtLeast('НФ', Number(mx));

  const id = newGuid();
  const code = nextCode('НФ');
  const old = String(input.old_sku || input.from_sku || '').trim();
  const arraySku = joinComma([...splitCodes(src.array_sku), newSku, src.sku, old].filter(Boolean));
  const now = new Date().toISOString().replace('T', ' ').slice(0, 19);

  run(
    `INSERT INTO products (
       id, sku, name, category_id, unit_id, barcode, is_active, created_at, brand, code,
       array_sku, notupload, package_width_cm, package_height_cm, package_length_cm, package_weight_g,
       gtin, requires_marking, min_stock, serial_tracked, item_kind, install_price,
       is_main, warehouse_sku
     ) VALUES (?,?,?,?,?,?,1,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      id,
      newSku,
      src.name,
      src.category_id,
      src.unit_id,
      newSku,
      now,
      src.brand || 'MRAER',
      code,
      arraySku,
      src.notupload || 0,
      src.package_width_cm,
      src.package_height_cm,
      src.package_length_cm,
      src.package_weight_g,
      src.gtin || '',
      src.requires_marking || 0,
      src.min_stock || 0,
      src.serial_tracked || 0,
      src.item_kind || 'product',
      src.install_price || 0,
      0,
      old ? joinSemi([old]) : '',
    ]
  );

  const twin = twinId(src.id);
  const twinExists = !!get(`SELECT id FROM products WHERE id = ?`, [twin]);
  const pickFrom = (table: string) =>
    twinExists &&
    get(`SELECT product_id FROM ${table} WHERE product_id = ? LIMIT 1`, [twin])
      ? twin
      : src!.id;

  const apps = copyChildRows(
    'product_applicability',
    ['id', 'product_id', 'mark', 'model', 'only_model', 'generation', 'years'],
    pickFrom('product_applicability'),
    id
  );
  const prices = copyChildRows(
    'product_prices',
    ['id', 'product_id', 'price_type', 'price'],
    pickFrom('product_prices'),
    id
  );
  const props = copyChildRows(
    'product_properties',
    ['id', 'product_id', 'property', 'value'],
    pickFrom('product_properties'),
    id
  );

  const mediaSrc = all<Record<string, unknown>>(
    `SELECT * FROM product_media WHERE product_id = ? AND IFNULL(kind,'') != 'empty'`,
    [src.id]
  );
  for (const m of mediaSrc) {
    const midSrc = String(m.id || '');
    const suffix = midSrc.includes('|') ? midSrc.split('|').slice(1).join('|') : newGuid();
    run(
      `INSERT OR IGNORE INTO product_media
        (id, product_id, kind, mime, ext, s3_key, url, size, sha256, sort_order, synced_at, width, height, orientation)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        `${id}|${suffix}`,
        id,
        String(m.kind || 'image'),
        String(m.mime || ''),
        String(m.ext || ''),
        String(m.s3_key || ''),
        String(m.url || ''),
        Number(m.size) || 0,
        String(m.sha256 || ''),
        Number(m.sort_order) || 0,
        String(m.synced_at || ''),
        m.width == null ? null : Number(m.width),
        m.height == null ? null : Number(m.height),
        m.orientation == null ? null : String(m.orientation),
      ]
    );
  }

  if (old) ensureOldSkuOnCard(id, old);

  return {
    product: findCleanProduct(newSku)!,
    created: true,
    meta: {
      id,
      code,
      from: src.sku,
      apps,
      prices,
      props,
      media: mediaSrc.length,
    },
  };
}
