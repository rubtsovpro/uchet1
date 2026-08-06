/**
 * HTTP-сервис 1С hs/AmoCRM — полный синк как в amo1c 1в1:
 *   Get/Categories, Get/Stores, Get/employees,
 *   Get/products (+ применимости, package, array_sku),
 *   Get/property_products, Get/prices, Get/Rests.
 * Get/image — отдельно в media.ts.
 */
import { all, db, get, run } from './db.js';
import { rebuildDictionaries } from './dicts.js';
import { invalidateStockValuationCache } from './stock-valuation.js';

const HS_BASE = (process.env.HS_BASE_URL || '').replace(/\/?$/, '/');
const HS_USER = process.env.HS_USER || '';
const HS_PASS = process.env.HS_PASS || '';

function authHeader(): string {
  return 'Basic ' + Buffer.from(`${HS_USER}:${HS_PASS}`).toString('base64');
}

export function hsConfigured(): boolean {
  return Boolean(HS_BASE && HS_USER && HS_PASS);
}

function assertHsConfigured(): void {
  if (!hsConfigured()) {
    throw new Error('HS_* не заданы (HS_BASE_URL, HS_USER, HS_PASS)');
  }
}

/** GET+JSON body как в amo1c sendCurlRequest. */
export async function hsGet(path: string, body: unknown): Promise<unknown> {
  assertHsConfigured();
  const { request } = await import('node:https');
  const { URL } = await import('node:url');
  const full = new URL(HS_BASE + path.replace(/^\//, ''));
  const payload =
    body === '' || body === null || body === undefined
      ? Buffer.alloc(0)
      : Buffer.from(JSON.stringify(body), 'utf8');

  const text = await new Promise<string>((resolve, reject) => {
    const headers: Record<string, string> = {
      Authorization: authHeader(),
      Accept: 'application/json',
    };
    if (payload.length) {
      headers['Content-Type'] = 'application/json';
      headers['Content-Length'] = String(payload.length);
    } else {
      headers['Content-Length'] = '0';
    }
    const req = request(
      {
        protocol: full.protocol,
        hostname: full.hostname,
        port: full.port || 443,
        path: full.pathname + full.search,
        method: 'GET',
        headers,
        timeout: 300_000,
      },
      (res) => {
        const chunks: Buffer[] = [];
        let total = 0;
        // Get/products по категориям бывает >512MB; Get/image одной карточки — до ~200MB (много фото).
        const maxBytes = /Get\/image/i.test(path)
          ? 220 * 1024 * 1024
          : 80 * 1024 * 1024;
        res.on('data', (c: Buffer) => {
          total += c.length;
          if (total > maxBytes) {
            req.destroy();
            reject(
              new Error(
                `HS ${path}: response too large (${Math.round(total / 1024 / 1024)}MB > ${maxBytes / 1024 / 1024}MB)`
              )
            );
            return;
          }
          chunks.push(c);
        });
        res.on('end', () => {
          let bodyText: string;
          try {
            bodyText = Buffer.concat(chunks).toString('utf8');
          } catch (e) {
            reject(
              new Error(
                `HS ${path}: cannot decode body (${Math.round(total / 1024 / 1024)}MB): ${
                  e instanceof Error ? e.message : e
                }`
              )
            );
            return;
          }
          if ((res.statusCode || 0) >= 400) {
            if (
              res.statusCode === 404 &&
              (/не найдена номенклатура/i.test(bodyText) ||
                /отсутствует доп/i.test(bodyText) ||
                /Отсутствуют цены/i.test(bodyText) ||
                /Отсутствует/i.test(bodyText))
            ) {
              resolve('[]');
              return;
            }
            if (
              res.statusCode === 500 &&
              /Поле объекта не обнаружено \(guid\)/i.test(bodyText)
            ) {
              resolve('[]');
              return;
            }
            reject(new Error(`HS ${path} HTTP ${res.statusCode}: ${bodyText.slice(0, 240)}`));
            return;
          }
          resolve(bodyText);
        });
      }
    );
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error(`HS ${path}: timeout`));
    });
    if (payload.length) req.write(payload);
    req.end();
  });

  if (text.includes('Отсутствует')) return [];
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error(`HS ${path}: не JSON (${text.slice(0, 120)})`);
  }
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type HsFit = {
  mark?: string;
  model?: string;
  only_model?: string;
  generation?: string;
  years?: string;
};

type HsProduct = {
  guid?: string;
  id?: string;
  code?: string;
  sku?: string;
  name?: string;
  brand?: string;
  Бренд?: string;
  category?: string;
  measurementUnit?: string;
  array_sku?: string[];
  array?: HsFit[];
  package?: {
    width_cm?: number | string;
    height_cm?: number | string;
    length_cm?: number | string;
    weight_g?: number | string;
  };
  additional_products?: Array<{ guid?: string; id?: string } | string>;
  notupload?: number | boolean;
};

type HsPropItem = {
  guid?: string;
  id?: string;
  array_property?: Array<{ property?: string; value?: string }>;
};

type HsPriceItem = {
  product?: string;
  guid?: string;
  id?: string;
  array?: Array<{ typeprice?: string; price?: number | string }>;
};

type HsRestItem = {
  product?: string;
  warehouse?: string;
  quantity?: number | string;
  articul?: string;
  brand?: string;
};

function productGuid(row: { guid?: string; id?: string; product?: string }): string {
  return String(row.product || row.guid || row.id || '').trim();
}

function numOrNull(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(String(v).replace(',', '.').replace(/[^\d.-]/g, ''));
  return Number.isFinite(n) ? n : null;
}

function ensureDefaultUnit(): string {
  const u = get<{ id: string }>(`SELECT id FROM units WHERE short_name = 'шт' LIMIT 1`);
  if (u?.id) return u.id;
  const id = '00000000-0000-5000-8000-000000000001';
  run(`INSERT OR IGNORE INTO units (id, name, short_name) VALUES (?, 'Штука', 'шт')`, [id]);
  return id;
}

function upsertHsCategory(row: { guid?: string; name?: string; code?: string }): void {
  const id = String(row.guid || '').trim();
  if (!UUID_RE.test(id)) return;
  const name = String(row.name || row.code || id).trim() || id;
  run(
    `INSERT INTO categories (id, name, parent_id) VALUES (?, ?, NULL)
     ON CONFLICT(id) DO UPDATE SET name = excluded.name`,
    [id, name]
  );
}

function upsertHsStore(row: { guid?: string; name?: string; code?: string }): void {
  const id = String(row.guid || '').trim();
  if (!UUID_RE.test(id)) return;
  const name = String(row.name || row.code || id).trim() || id;
  const code = String(row.code || id.slice(0, 8)).trim() || id.slice(0, 8);
  const clash = get<{ id: string }>(
    `SELECT id FROM warehouses WHERE code = ? AND id != ?`,
    [code, id]
  );
  const safeCode = clash ? `${code}:${id.slice(0, 6)}` : code;
  run(
    `INSERT INTO warehouses (id, name, code, is_active) VALUES (?, ?, ?, 1)
     ON CONFLICT(id) DO UPDATE SET name = excluded.name, is_active = 1`,
    [id, name, safeCode]
  );
}

function upsertHsProduct(row: HsProduct, unitId: string): boolean {
  const id = productGuid(row);
  if (!UUID_RE.test(id)) return false;

  const code = String(row.code || '').trim();
  let sku = String(row.sku || row.code || id).trim() || id;
  const clash = get<{ id: string }>(`SELECT id FROM products WHERE sku = ? AND id != ?`, [sku, id]);
  if (clash) sku = `${sku}:${id.slice(0, 8)}`;
  let name = String(row.name || '').trim();
  if (!name || UUID_RE.test(name)) {
    name = code || sku || id;
  }

  const brand = String(row.brand || row['Бренд'] || '').trim();
  const arraySku = Array.isArray(row.array_sku) ? row.array_sku.filter(Boolean).join(',') : '';
  const catId = String(row.category || '').trim();
  if (catId && UUID_RE.test(catId)) {
    run(`INSERT OR IGNORE INTO categories (id, name, parent_id) VALUES (?, ?, NULL)`, [
      catId,
      catId,
    ]);
  }
  const notupload =
    row.notupload === true || row.notupload === 1 || String(row.notupload) === '1' ? 1 : 0;
  const mUnit = String(row.measurementUnit || '').trim();
  const pkg = row.package && typeof row.package === 'object' ? row.package : null;
  const w = pkg ? numOrNull(pkg.width_cm) : null;
  const h = pkg ? numOrNull(pkg.height_cm) : null;
  const l = pkg ? numOrNull(pkg.length_cm) : null;
  const wg = pkg ? numOrNull(pkg.weight_g) : null;

  run(
    `INSERT INTO products (
       id, sku, name, category_id, unit_id, barcode, brand, is_active,
       code, array_sku, notupload, package_width_cm, package_height_cm,
       package_length_cm, package_weight_g, hs_category_id, measurement_unit
     ) VALUES (?, ?, ?, ?, ?, '', ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       sku = excluded.sku,
       name = CASE
         WHEN excluded.name != '' AND length(excluded.name) = 36 AND excluded.name GLOB '*-*-*-*-*'
           THEN COALESCE(NULLIF(products.name, ''), excluded.sku, excluded.name)
         WHEN excluded.name != '' THEN excluded.name
         ELSE COALESCE(NULLIF(products.name, ''), excluded.sku, products.name)
       END,
       category_id = COALESCE(NULLIF(excluded.category_id,''), products.category_id),
       brand = CASE WHEN excluded.brand != '' THEN excluded.brand ELSE products.brand END,
       code = excluded.code,
       array_sku = excluded.array_sku,
       notupload = excluded.notupload,
       package_width_cm = COALESCE(excluded.package_width_cm, products.package_width_cm),
       package_height_cm = COALESCE(excluded.package_height_cm, products.package_height_cm),
       package_length_cm = COALESCE(excluded.package_length_cm, products.package_length_cm),
       package_weight_g = COALESCE(excluded.package_weight_g, products.package_weight_g),
       hs_category_id = excluded.hs_category_id,
       measurement_unit = CASE WHEN excluded.measurement_unit != '' THEN excluded.measurement_unit ELSE products.measurement_unit END,
       is_active = 1`,
    [
      id,
      sku,
      name,
      catId && UUID_RE.test(catId) ? catId : null,
      unitId,
      brand,
      code,
      arraySku,
      notupload,
      w,
      h,
      l,
      wg,
      catId,
      mUnit,
    ]
  );
  return true;
}

async function syncCategoriesAndStores(): Promise<{ categories: number; stores: number }> {
  const catsRaw = await hsGet('Get/Categories', '');
  const storesRaw = await hsGet('Get/Stores', '');
  let categories = 0;
  let stores = 0;
  if (Array.isArray(catsRaw)) {
    for (const row of catsRaw as Array<{ guid?: string; name?: string; code?: string }>) {
      upsertHsCategory(row);
      if (UUID_RE.test(String(row.guid || ''))) categories += 1;
    }
  }
  if (Array.isArray(storesRaw)) {
    for (const row of storesRaw as Array<{ guid?: string; name?: string; code?: string }>) {
      upsertHsStore(row);
      if (UUID_RE.test(String(row.guid || ''))) stores += 1;
    }
  }
  return { categories, stores };
}

async function syncEmployees(): Promise<number> {
  const raw = await hsGet('Get/employees', '');
  if (!Array.isArray(raw)) return 0;
  let n = 0;
  const ins = db.prepare(
    `INSERT INTO employees (id, code, name) VALUES (?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET code = excluded.code, name = excluded.name`
  );
  run('BEGIN');
  try {
    for (const row of raw as Array<{ guid?: string; code?: string; name?: string }>) {
      const id = String(row.guid || '').trim();
      if (!UUID_RE.test(id)) continue;
      ins.run(id, String(row.code || '').trim(), String(row.name || id).trim());
      n += 1;
    }
    run('COMMIT');
  } catch (e) {
    try {
      run('ROLLBACK');
    } catch {
      /* ignore */
    }
    throw e;
  }
  return n;
}

async function fetchHsCategoryIds(): Promise<string[]> {
  const raw = await hsGet('Get/Categories', '');
  if (!Array.isArray(raw)) return [];
  const ids: string[] = [];
  for (const row of raw as Array<{ guid?: string }>) {
    const id = String(row.guid || '').trim();
    if (UUID_RE.test(id)) ids.push(id);
  }
  return ids;
}

export type HsSyncResult = {
  categories: number;
  stores: number;
  employees: number;
  productsUpserted: number;
  applicability: number;
  properties: number;
  prices: number;
  related: number;
  rests: number;
  restRows: number;
  dictionaries?: ReturnType<typeof rebuildDictionaries>;
  seconds: number;
};

/** Полный синк HS как amo1c products + property + prices + rests + stores/categories. */
export async function syncApplicabilityAndProperties(): Promise<HsSyncResult> {
  assertHsConfigured();
  const t0 = Date.now();
  const unitId = ensureDefaultUnit();

  const { categories, stores } = await syncCategoriesAndStores();
  console.log('HS categories', categories, 'stores', stores);
  let employees = 0;
  try {
    employees = await syncEmployees();
  } catch (e) {
    console.warn('HS employees skip:', e instanceof Error ? e.message : e);
  }

  const catIds = await fetchHsCategoryIds();
  if (!catIds.length) {
    throw new Error('HS Get/Categories вернул пусто — проверьте HS_*');
  }

  run('DELETE FROM product_applicability');
  run('DELETE FROM product_properties');
  run('DELETE FROM product_prices');
  run('DELETE FROM product_related');

  let productsUpserted = 0;
  let appCount = 0;
  let propCount = 0;
  let priceCount = 0;
  let relatedCount = 0;
  const batches = chunk(catIds, 12);

  const insertApp = db.prepare(`
    INSERT OR IGNORE INTO product_applicability
      (id, product_id, mark, model, only_model, generation, years)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  const insertProp = db.prepare(`
    INSERT OR IGNORE INTO product_properties (id, product_id, property, value)
    VALUES (?, ?, ?, ?)
  `);
  const insertPrice = db.prepare(`
    INSERT OR REPLACE INTO product_prices (id, product_id, price_type, price)
    VALUES (?, ?, ?, ?)
  `);
  const insertRelated = db.prepare(`
    INSERT OR IGNORE INTO product_related (product_id, related_id) VALUES (?, ?)
  `);
  const updateBrand = db.prepare(`UPDATE products SET brand = ? WHERE id = ?`);
  const updatePkg = db.prepare(`
    UPDATE products SET
      package_width_cm = COALESCE(?, package_width_cm),
      package_height_cm = COALESCE(?, package_height_cm),
      package_length_cm = COALESCE(?, package_length_cm),
      package_weight_g = COALESCE(?, package_weight_g)
    WHERE id = ?
  `);

  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i]!;
    console.log(`HS batch ${i + 1}/${batches.length}, categories=${batch.length}`);

    let products: HsProduct[] = [];
    let props: HsPropItem[] = [];
    let prices: HsPriceItem[] = [];

    try {
      const body = batch.map((guid) => ({ guid }));
      const [prodRaw, propRaw, priceRaw] = await Promise.all([
        hsGet('Get/products', body),
        hsGet('Get/property_products', body),
        hsGet('Get/prices', body),
      ]);
      products = Array.isArray(prodRaw) ? (prodRaw as HsProduct[]) : [];
      props = Array.isArray(propRaw) ? (propRaw as HsPropItem[]) : [];
      prices = Array.isArray(priceRaw) ? (priceRaw as HsPriceItem[]) : [];
    } catch (e) {
      console.warn(`HS batch ${i + 1} failed, retry one-by-one:`, e instanceof Error ? e.message : e);
      for (const guid of batch) {
        try {
          const prodRaw = await hsGet('Get/products', [{ guid }]);
          if (Array.isArray(prodRaw)) products.push(...(prodRaw as HsProduct[]));
        } catch (err) {
          console.warn(`HS products skip ${guid}:`, err instanceof Error ? err.message : err);
        }
        try {
          const propRaw = await hsGet('Get/property_products', [{ guid }]);
          if (Array.isArray(propRaw)) props.push(...(propRaw as HsPropItem[]));
        } catch (err) {
          console.warn(`HS props skip ${guid}:`, err instanceof Error ? err.message : err);
        }
        try {
          const priceRaw = await hsGet('Get/prices', [{ guid }]);
          if (Array.isArray(priceRaw)) prices.push(...(priceRaw as HsPriceItem[]));
        } catch (err) {
          console.warn(`HS prices skip ${guid}:`, err instanceof Error ? err.message : err);
        }
      }
    }

    run('BEGIN');
    try {
      for (const row of products) {
        if (!upsertHsProduct(row, unitId)) continue;
        productsUpserted += 1;
        const pid = productGuid(row);

        const fits = Array.isArray(row.array) ? row.array : [];
        for (const fit of fits) {
          const mark = String(fit.mark || '').trim();
          const model = String(fit.model || '').trim();
          const onlyModel = String(fit.only_model || '').trim();
          const generation = String(fit.generation || '').trim();
          const years = String(fit.years || '').trim();
          if (!mark && !model && !onlyModel && !generation && !years) continue;
          const id = `${pid}|${mark}|${model}|${onlyModel}|${generation}|${years}`;
          const r = insertApp.run(id, pid, mark, model, onlyModel, generation, years);
          if (r.changes) appCount += 1;
        }

        const add = Array.isArray(row.additional_products) ? row.additional_products : [];
        for (const a of add) {
          const rid =
            typeof a === 'string'
              ? a.trim()
              : String((a as { guid?: string; id?: string }).guid || (a as { id?: string }).id || '').trim();
          if (rid && UUID_RE.test(rid) && rid !== pid) {
            const r = insertRelated.run(pid, rid);
            if (r.changes) relatedCount += 1;
          }
        }
      }

      for (const row of props) {
        const pid = productGuid(row);
        if (!pid || !get(`SELECT 1 AS ok FROM products WHERE id = ?`, [pid])) continue;
        const list = Array.isArray(row.array_property) ? row.array_property : [];
        let brandFromProp = '';
        let pw: number | null = null;
        let ph: number | null = null;
        let pl: number | null = null;
        let pwg: number | null = null;
        for (const p of list) {
          const property = String(p.property || '').trim();
          const value = String(p.value ?? '').trim();
          if (!property) continue;
          const id = `${pid}|${property}|${value}`;
          const r = insertProp.run(id, pid, property, value);
          if (r.changes) propCount += 1;
          const plower = property.toLowerCase();
          if (plower === 'бренд' || plower.startsWith('бренд ')) brandFromProp = value;
          if (property === 'Ширина упаковки') pw = numOrNull(value);
          if (property === 'Высота упаковки') ph = numOrNull(value);
          if (property === 'Глубина упаковки') pl = numOrNull(value);
          if (property === 'Вес упаковки') pwg = numOrNull(value);
        }
        if (brandFromProp) updateBrand.run(brandFromProp, pid);
        if (pw != null || ph != null || pl != null || pwg != null) {
          updatePkg.run(pw, ph, pl, pwg, pid);
        }
      }

      for (const row of prices) {
        const pid = productGuid(row);
        if (!pid || !get(`SELECT 1 AS ok FROM products WHERE id = ?`, [pid])) continue;
        const list = Array.isArray(row.array) ? row.array : [];
        for (const p of list) {
          const priceType = String(p.typeprice || '').trim();
          if (!priceType) continue;
          const price = Number(p.price);
          if (!Number.isFinite(price)) continue;
          insertPrice.run(`${pid}|${priceType}`, pid, priceType, price);
          priceCount += 1;
        }
      }
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

  const rests = await syncRestsInternal(catIds);

  run('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)', [
    'hs_synced_at',
    new Date().toISOString(),
  ]);
  run('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)', [
    'prices_synced_at',
    new Date().toISOString(),
  ]);
  run('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)', [
    'rests_synced_at',
    new Date().toISOString(),
  ]);

  const dictionaries = rebuildDictionaries();

  return {
    categories,
    stores,
    employees,
    productsUpserted,
    applicability: appCount,
    properties: propCount,
    prices: priceCount,
    related: relatedCount,
    rests: rests.warehouses,
    restRows: rests.rows,
    dictionaries,
    seconds: Math.round((Date.now() - t0) / 1000),
  };
}

async function syncRestsInternal(
  catIds: string[]
): Promise<{ warehouses: number; rows: number }> {
  // Get/Rests принимает только GUID складов из HS Get/Stores (не коды OData)
  const whs = all<{ id: string }>(`SELECT id FROM warehouses WHERE is_active = 1`).filter((w) =>
    UUID_RE.test(w.id)
  );
  if (!whs.length || !catIds.length) return { warehouses: 0, rows: 0 };

  run('DELETE FROM product_store_rests');
  // Обнуляем остатки из 1С перед перезаливкой (локальные документы не трогаем отдельно —
  // stock_balances пересобираем из rests)
  run('DELETE FROM stock_balances');

  const insertRest = db.prepare(`
    INSERT INTO product_store_rests (product_id, warehouse_id, qty) VALUES (?, ?, ?)
    ON CONFLICT(product_id, warehouse_id) DO UPDATE SET qty = excluded.qty
  `);
  const insertBal = db.prepare(`
    INSERT INTO stock_balances (warehouse_id, product_id, qty) VALUES (?, ?, ?)
    ON CONFLICT(warehouse_id, product_id) DO UPDATE SET qty = excluded.qty
  `);
  const productExists = db.prepare(`SELECT 1 AS ok FROM products WHERE id = ?`);

  let rows = 0;
  for (const wh of whs) {
    console.log('HS Get/Rests warehouse', wh.id);
    // amo1c: один склад + все категории
    let rests: HsRestItem[] = [];
    try {
      const raw = await hsGet('Get/Rests', {
        stores: [wh.id],
        categories: catIds,
      });
      rests = Array.isArray(raw) ? (raw as HsRestItem[]) : [];
    } catch (e) {
      console.warn(`HS Rests fail ${wh.id}:`, e instanceof Error ? e.message : e);
      // fallback: по пачкам категорий
      for (const batch of chunk(catIds, 20)) {
        try {
          const raw = await hsGet('Get/Rests', {
            stores: [wh.id],
            categories: batch,
          });
          if (Array.isArray(raw)) rests.push(...(raw as HsRestItem[]));
        } catch (err) {
          console.warn(`HS Rests batch skip:`, err instanceof Error ? err.message : err);
        }
      }
    }

    run('BEGIN');
    try {
      for (const row of rests) {
        const pid = String(row.product || '').trim();
        if (!pid || !productExists.get(pid)) continue;
        const qty = Number(row.quantity);
        if (!Number.isFinite(qty)) continue;
        const warehouseId = String(row.warehouse || wh.id).trim() || wh.id;
        insertRest.run(pid, warehouseId, qty);
        insertBal.run(warehouseId, pid, qty);
        rows += 1;
      }
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
  invalidateStockValuationCache();
  return { warehouses: whs.length, rows };
}

export async function syncRestsOnly(): Promise<{
  warehouses: number;
  restRows: number;
  categories: number;
  seconds: number;
}> {
  assertHsConfigured();
  const t0 = Date.now();
  await syncCategoriesAndStores();
  const catIds = await fetchHsCategoryIds();
  const r = await syncRestsInternal(catIds);
  run('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)', [
    'rests_synced_at',
    new Date().toISOString(),
  ]);
  return {
    warehouses: r.warehouses,
    restRows: r.rows,
    categories: catIds.length,
    seconds: Math.round((Date.now() - t0) / 1000),
  };
}

export async function syncPricesOnly(): Promise<{
  prices: number;
  categories: number;
  dictionaries: ReturnType<typeof rebuildDictionaries>;
  seconds: number;
}> {
  assertHsConfigured();
  const t0 = Date.now();
  const catIds = await fetchHsCategoryIds();
  if (!catIds.length) {
    throw new Error('HS Get/Categories вернул пусто — проверьте HS_*');
  }

  run('DELETE FROM product_prices');
  let priceCount = 0;
  const batches = chunk(catIds, 12);
  const insertPrice = db.prepare(`
    INSERT OR REPLACE INTO product_prices (id, product_id, price_type, price)
    VALUES (?, ?, ?, ?)
  `);
  const productExists = db.prepare(`SELECT 1 AS ok FROM products WHERE id = ?`);

  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i]!;
    let prices: HsPriceItem[] = [];
    try {
      const raw = await hsGet(
        'Get/prices',
        batch.map((guid) => ({ guid }))
      );
      prices = Array.isArray(raw) ? (raw as HsPriceItem[]) : [];
    } catch (e) {
      console.warn(`HS prices batch ${i + 1} failed:`, e instanceof Error ? e.message : e);
      for (const guid of batch) {
        try {
          const raw = await hsGet('Get/prices', [{ guid }]);
          if (Array.isArray(raw)) prices.push(...(raw as HsPriceItem[]));
        } catch {
          /* skip */
        }
      }
    }
    run('BEGIN');
    try {
      for (const row of prices) {
        const pid = productGuid(row);
        if (!pid || !productExists.get(pid)) continue;
        for (const p of Array.isArray(row.array) ? row.array : []) {
          const priceType = String(p.typeprice || '').trim();
          if (!priceType) continue;
          const price = Number(p.price);
          if (!Number.isFinite(price)) continue;
          insertPrice.run(`${pid}|${priceType}`, pid, priceType, price);
          priceCount += 1;
        }
      }
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

  run('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)', [
    'prices_synced_at',
    new Date().toISOString(),
  ]);
  return {
    prices: priceCount,
    categories: catIds.length,
    dictionaries: rebuildDictionaries(),
    seconds: Math.round((Date.now() - t0) / 1000),
  };
}

export function hsSyncMeta() {
  return {
    lastSync:
      all<{ value: string }>('SELECT value FROM meta WHERE key = ?', ['hs_synced_at'])[0]?.value ??
      null,
    pricesSync:
      all<{ value: string }>('SELECT value FROM meta WHERE key = ?', ['prices_synced_at'])[0]
        ?.value ?? null,
    restsSync:
      all<{ value: string }>('SELECT value FROM meta WHERE key = ?', ['rests_synced_at'])[0]
        ?.value ?? null,
    applicability:
      all<{ c: number }>('SELECT COUNT(*) AS c FROM product_applicability')[0]?.c ?? 0,
    properties: all<{ c: number }>('SELECT COUNT(*) AS c FROM product_properties')[0]?.c ?? 0,
    prices: all<{ c: number }>('SELECT COUNT(*) AS c FROM product_prices')[0]?.c ?? 0,
    rests: all<{ c: number }>('SELECT COUNT(*) AS c FROM product_store_rests')[0]?.c ?? 0,
    employees: all<{ c: number }>('SELECT COUNT(*) AS c FROM employees')[0]?.c ?? 0,
    related: all<{ c: number }>('SELECT COUNT(*) AS c FROM product_related')[0]?.c ?? 0,
    configured: hsConfigured(),
  };
}
