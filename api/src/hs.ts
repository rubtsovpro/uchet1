/**
 * HTTP-сервис 1С hs/AmoCRM — полный синк как в amo1c 1в1:
 *   Get/Categories, Get/Stores, Get/employees,
 *   Get/products (+ применимости, package, array_sku),
 *   Get/property_products, Get/prices, Get/Rests.
 * Get/image — отдельно в media.ts.
 */
import { all, db, get, run } from './db.js';
import { rebuildDictionaries } from './dicts.js';
import { classifyProductKind, deactivateLegacyServices, productIsService } from './product-kind.js';
import { invalidateStockValuationCache } from './stock-valuation.js';
import { DEFAULT_COMPANY_ID } from './companies.js';
import { newGuid } from './ids.js';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type HsStoreRef = { wmsId: string; hsGuid: string };

const PODBveska_STORE_CODES = ['НФ-000032', 'НФ-000034', 'НФ-000037', '00-000001'] as const;

function loadPodveskaStoreIds(): Set<string> {
  const ids = new Set<string>();
  try {
    const raw = get<{ value: string }>(`SELECT value FROM meta WHERE key = 'hs_podveska_store_ids'`)?.value;
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    if (Array.isArray(parsed)) {
      for (const x of parsed) {
        const id = String(x || '').trim();
        if (UUID_RE.test(id)) ids.add(id);
      }
    }
  } catch {
    /* ignore */
  }
  return ids;
}

/** GUID склада из pnevmopodveska_2025 — fogel-синк не перезаписывает строку, создаёт alias. */
function isProtectedPodveskaHsGuid(hsGuid: string): boolean {
  if (loadPodveskaStoreIds().has(hsGuid)) return true;
  const wh = get<{ company_id: string; code: string }>(
    `SELECT IFNULL(company_id,'') AS company_id, IFNULL(code,'') AS code FROM warehouses WHERE id = ?`,
    [hsGuid]
  );
  if (wh?.company_id === DEFAULT_COMPANY_ID) return true;
  if (wh && PODBveska_STORE_CODES.some((c) => wh.code === c || wh.code.startsWith(`${c}:`))) return true;
  return false;
}

function fogelAliasMetaKey(hsGuid: string): string {
  return `fogel_wh_alias:${hsGuid}`;
}

/** Отдельный WMS-склад Фогеля при общем GUID с Подвеской в 1С. */
function ensureFogelWarehouseAlias(
  row: { guid?: string; name?: string; code?: string },
  companyId: string
): string {
  const hsGuid = String(row.guid || '').trim();
  if (!UUID_RE.test(hsGuid)) return hsGuid;

  let wmsId = '';
  const metaRow = get<{ value: string }>(`SELECT value FROM meta WHERE key = ?`, [
    fogelAliasMetaKey(hsGuid),
  ]);
  if (metaRow?.value) {
    try {
      const parsed = JSON.parse(metaRow.value) as { wms_id?: string };
      wmsId = String(parsed.wms_id || '').trim();
    } catch {
      wmsId = '';
    }
  }
  if (!wmsId || !UUID_RE.test(wmsId)) wmsId = newGuid();

  const rawCode = String(row.code || hsGuid.slice(0, 8)).trim() || hsGuid.slice(0, 8);
  const fogelCode = rawCode.includes(':fogel') ? rawCode : `${rawCode}:fogel`;
  const name = String(row.name || rawCode || hsGuid).trim() || rawCode;

  run(
    `INSERT INTO warehouses (id, name, code, is_active, company_id) VALUES (?, ?, ?, 1, ?)
     ON CONFLICT(id) DO UPDATE SET
       name = excluded.name,
       code = excluded.code,
       is_active = 1,
       company_id = excluded.company_id`,
    [wmsId, name, fogelCode, companyId || null]
  );
  run('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)', [
    fogelAliasMetaKey(hsGuid),
    JSON.stringify({ wms_id: wmsId, hs_guid: hsGuid, code: rawCode, name }),
  ]);
  return wmsId;
}

function companyIdForHsDepartment(sourceDepartment: string): string {
  const sd = String(sourceDepartment || '').toLowerCase();
  if (sd.includes('fogel')) {
    const fogel = get<{ id: string }>(
      `SELECT id FROM companies WHERE UPPER(IFNULL(code,'')) IN ('ФОГЕЛЬ','FOGEL') LIMIT 1`
    );
    if (fogel?.id) return fogel.id;
  }
  if (sd.includes('strela') || sd.includes('стрела')) {
    const strela = get<{ id: string }>(
      `SELECT id FROM companies WHERE UPPER(IFNULL(code,'')) IN ('STRELA','СТРЕЛА') LIMIT 1`
    );
    if (strela?.id) return strela.id;
  }
  return DEFAULT_COMPANY_ID;
}

function normalizeHsBase(raw: string): string {
  return String(raw || '').replace(/\/?$/, '/');
}

function defaultHsBase(): string {
  return normalizeHsBase(process.env.HS_BASE_URL || '');
}

export function fogelHsBase(): string {
  return normalizeHsBase(
    process.env.FOGEL_HS_BASE_URL ||
      'https://bezmat.corp.rarus-cloud.ru/fogel_2025/hs/AmoCRM/'
  );
}

const HS_USER = process.env.HS_USER || '';
const HS_PASS = process.env.HS_PASS || '';

function authHeader(): string {
  return 'Basic ' + Buffer.from(`${HS_USER}:${HS_PASS}`).toString('base64');
}

export function hsConfigured(baseUrl?: string): boolean {
  const base = baseUrl ? normalizeHsBase(baseUrl) : defaultHsBase();
  return Boolean(base && HS_USER && HS_PASS);
}

export function fogelHsConfigured(): boolean {
  return hsConfigured(fogelHsBase());
}

function assertHsConfigured(baseUrl?: string): void {
  if (!hsConfigured(baseUrl)) {
    throw new Error('HS_* не заданы (HS_BASE_URL, HS_USER, HS_PASS)');
  }
}

/** GET+JSON body как в amo1c sendCurlRequest. */
export async function hsGet(path: string, body: unknown, baseUrl?: string): Promise<unknown> {
  const base = normalizeHsBase(baseUrl || defaultHsBase());
  if (!base || !HS_USER || !HS_PASS) {
    throw new Error('HS_* не заданы (HS_BASE_URL, HS_USER, HS_PASS)');
  }
  const { request } = await import('node:https');
  const { URL } = await import('node:url');
  const full = new URL(base + path.replace(/^\//, ''));
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

const HS_DEPT_SEP = '::';

function hsCatalogGuid(row: { guid?: string; id?: string; product?: string }): string {
  return productGuid(row).toLowerCase();
}

/** Внутренний id строки WMS: отдел + GUID 1С — каталоги Москвы и Фогеля не перетирают друг друга. */
function hsScopedProductId(catalogGuid: string, sourceDepartment: string): string {
  const g = hsCatalogGuid({ guid: catalogGuid });
  const sd = String(sourceDepartment || '').trim();
  if (!sd || !UUID_RE.test(g)) return g;
  return `${sd}${HS_DEPT_SEP}${g}`;
}

function hsProductIdForDepartment(catalogGuid: string, sourceDepartment: string): string {
  const g = hsCatalogGuid({ guid: catalogGuid });
  const sd = String(sourceDepartment || '').trim();
  const scoped = hsScopedProductId(g, sd);
  if (get(`SELECT 1 AS ok FROM products WHERE id = ?`, [scoped])) return scoped;
  const byCatalog = get<{ id: string }>(
    `SELECT id FROM products WHERE catalog_guid = ? AND source_department = ? LIMIT 1`,
    [g, sd]
  );
  if (byCatalog?.id) return byCatalog.id;
  if (sd && get(`SELECT 1 AS ok FROM products WHERE id = ? AND source_department = ?`, [g, sd])) {
    return g;
  }
  return scoped;
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

function upsertHsStore(
  row: { guid?: string; name?: string; code?: string },
  opts?: { companyId?: string; sourceDepartment?: string }
): void {
  const id = String(row.guid || '').trim();
  if (!UUID_RE.test(id)) return;
  let name = String(row.name || row.code || id).trim() || id;
  const code = String(row.code || id.slice(0, 8)).trim() || id.slice(0, 8);
  const sd = String(opts?.sourceDepartment || '').trim();
  // Имена контуров Подвески — только при синке pnevmopodveska_2025
  if (sd === 'pnevmopodveska_2025') {
    if (code === 'НФ-000032' || /^филиал\s*москва$/i.test(name)) name = 'Основной';
    if (code === '00-000001' || /склад\s*сто\s*москва/i.test(name)) name = 'Склад СТО Москва';
  }
  // Неиспользуемые техсклады 1С — не создаём / не поднимаем в активные
  const unusedTech =
    code === 'НФ-000033' ||
    code === 'НФ-000035' ||
    code === 'НФ-000036' ||
    code === 'НФ-000043' ||
    /доукомплект/i.test(name) ||
    /недопоставк/i.test(name) ||
    /не\s*найден/i.test(name) ||
    /малярк/i.test(name);
  if (unusedTech) {
    const exists = get<{ id: string }>(`SELECT id FROM warehouses WHERE id = ?`, [id]);
    if (!exists) return;
    run(`UPDATE warehouses SET is_active = 0, name = ? WHERE id = ?`, [name, id]);
    return;
  }
  const clash = get<{ id: string }>(
    `SELECT id FROM warehouses WHERE code = ? AND id != ?`,
    [code, id]
  );
  const safeCode = clash ? `${code}:${id.slice(0, 6)}` : code;
  const companyId =
    sd === 'pnevmopodveska_2025'
      ? DEFAULT_COMPANY_ID
      : String(opts?.companyId || '').trim();
  if (companyId) {
    run(
      `INSERT INTO warehouses (id, name, code, is_active, company_id) VALUES (?, ?, ?, 1, ?)
       ON CONFLICT(id) DO UPDATE SET name = excluded.name, is_active = 1, company_id = excluded.company_id`,
      [id, name, safeCode, companyId]
    );
  } else {
    run(
      `INSERT INTO warehouses (id, name, code, is_active) VALUES (?, ?, ?, 1)
       ON CONFLICT(id) DO UPDATE SET name = excluded.name, is_active = 1`,
      [id, name, safeCode]
    );
  }
}

/** Склады pnevmopodveska_2025: не даём fogel_2025 перезаписать имя/контур (общие GUID в 1С). */
export function repairPodveskaMskWarehouses(): { fixed: number } {
  const namesByCode: Record<string, string> = {
    'НФ-000032': 'Основной',
    '00-000001': 'Склад СТО Москва',
  };
  let fixed = 0;
  let ids: string[] = [];
  try {
    const raw = get<{ value: string }>(`SELECT value FROM meta WHERE key = 'hs_podveska_store_ids'`)?.value;
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    if (Array.isArray(parsed)) ids = parsed.map((x) => String(x || '').trim()).filter(Boolean);
  } catch {
    ids = [];
  }
  const targetIds = new Set<string>(ids);
  for (const code of Object.keys(namesByCode)) {
    const row = get<{ id: string }>(`SELECT id FROM warehouses WHERE code = ? LIMIT 1`, [code]);
    if (row?.id) targetIds.add(String(row.id));
  }
  for (const id of targetIds) {
    const row = get<{ code: string; name: string; company_id: string }>(
      `SELECT IFNULL(code,'') AS code, IFNULL(name,'') AS name, IFNULL(company_id,'') AS company_id
       FROM warehouses WHERE id = ?`,
      [id]
    );
    if (!row) continue;
    const code = String(row.code || '').trim();
    const wantName = namesByCode[code];
    if (!wantName) continue;
    if (row.company_id === DEFAULT_COMPANY_ID && row.name === wantName) continue;
    run(`UPDATE warehouses SET name = ?, company_id = ?, is_active = 1 WHERE id = ?`, [
      wantName,
      DEFAULT_COMPANY_ID,
      id,
    ]);
    fixed += 1;
  }
  return { fixed };
}

function upsertHsProduct(row: HsProduct, unitId: string, sourceDepartment: string): string | null {
  const catalogGuid = hsCatalogGuid(row);
  if (!UUID_RE.test(catalogGuid)) return null;
  const internalId = hsScopedProductId(catalogGuid, sourceDepartment);

  const code = String(row.code || '').trim();
  const baseSku = String(row.sku || row.code || catalogGuid).trim() || catalogGuid;
  const deptKey = sourceDepartment.includes('fogel') ? 'fogel' : 'podveska';
  // Уже существующая карточка: не менять sku на новый хвост при каждом синке
  // (иначе база зарастает @podveska / :hex при коллизиях).
  const existingSku = get<{ sku: string }>(
    `SELECT IFNULL(sku,'') AS sku FROM products WHERE id = ?`,
    [internalId]
  )?.sku;
  let sku = baseSku;
  const skuTaken = (candidate: string) =>
    !!get<{ id: string }>(`SELECT id FROM products WHERE sku = ? AND id != ? LIMIT 1`, [
      candidate,
      internalId,
    ]);
  if (skuTaken(sku)) {
    if (existingSku && existingSku !== sku && !skuTaken(existingSku)) {
      sku = existingSku;
    } else if (existingSku && !skuTaken(existingSku)) {
      sku = existingSku;
    } else {
      const namespaced = `${baseSku}@${deptKey}`;
      const withGuid = `${baseSku}:${catalogGuid.slice(0, 8)}`;
      const withId = `${baseSku}:${internalId.slice(0, 18)}`;
      if (!skuTaken(namespaced)) sku = namespaced;
      else if (!skuTaken(withGuid)) sku = withGuid;
      else if (!skuTaken(withId)) sku = withId;
      else if (existingSku) sku = existingSku;
      else sku = withId;
    }
  }
  let name = String(row.name || '').trim();
  if (!name || UUID_RE.test(name)) {
    name = code || sku || catalogGuid;
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
  const unitShort =
    get<{ short_name: string }>(`SELECT IFNULL(short_name,'') AS short_name FROM units WHERE id = ?`, [
      unitId,
    ])?.short_name || mUnit;
  const itemKind = classifyProductKind({
    name,
    unit_short: unitShort,
    category_id: catId && UUID_RE.test(catId) ? catId : '',
  });
  // Услуги из 1С/HS не синкаем — только 23 общих se-* (apply_obshchie_uslugi). Остатки по услугам не ведём.
  if (itemKind === 'service') return null;

  run(
    `INSERT INTO products (
       id, sku, name, category_id, unit_id, barcode, brand, is_active,
       code, array_sku, notupload, package_width_cm, package_height_cm,
       package_length_cm, package_weight_g, hs_category_id, measurement_unit,
       source_department, catalog_guid, item_kind
     ) VALUES (?, ?, ?, ?, ?, '', ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
       array_sku = '',
       notupload = excluded.notupload,
       package_width_cm = COALESCE(excluded.package_width_cm, products.package_width_cm),
       package_height_cm = COALESCE(excluded.package_height_cm, products.package_height_cm),
       package_length_cm = COALESCE(excluded.package_length_cm, products.package_length_cm),
       package_weight_g = COALESCE(excluded.package_weight_g, products.package_weight_g),
       hs_category_id = excluded.hs_category_id,
       measurement_unit = CASE WHEN excluded.measurement_unit != '' THEN excluded.measurement_unit ELSE products.measurement_unit END,
       source_department = excluded.source_department,
       catalog_guid = excluded.catalog_guid,
       item_kind = excluded.item_kind,
       is_active = 1`,
    [
      internalId,
      sku,
      name,
      catId && UUID_RE.test(catId) ? catId : null,
      unitId,
      brand,
      code,
      '',
      notupload,
      w,
      h,
      l,
      wg,
      catId,
      mUnit,
      sourceDepartment,
      catalogGuid,
      itemKind,
    ]
  );
  return internalId;
}

async function syncCategoriesAndStores(
  baseUrl: string,
  opts?: { companyId?: string; sourceDepartment?: string }
): Promise<{ categories: number; stores: number; storeIds: string[]; storeRefs: HsStoreRef[] }> {
  const catsRaw = await hsGet('Get/Categories', '', baseUrl);
  const storesRaw = await hsGet('Get/Stores', '', baseUrl);
  let categories = 0;
  let stores = 0;
  const storeIds: string[] = [];
  const storeRefs: HsStoreRef[] = [];
  const sd = String(opts?.sourceDepartment || '').trim();
  const fogelCompanyId = String(opts?.companyId || '').trim();
  if (Array.isArray(catsRaw)) {
    for (const row of catsRaw as Array<{ guid?: string; name?: string; code?: string }>) {
      upsertHsCategory(row);
      if (UUID_RE.test(String(row.guid || ''))) categories += 1;
    }
  }
  if (Array.isArray(storesRaw)) {
    for (const row of storesRaw as Array<{ guid?: string; name?: string; code?: string }>) {
      const hsGuid = String(row.guid || '').trim();
      if (!UUID_RE.test(hsGuid)) continue;

      if (sd === 'fogel_2025' && isProtectedPodveskaHsGuid(hsGuid)) {
        const wmsId = ensureFogelWarehouseAlias(row, fogelCompanyId);
        storeRefs.push({ wmsId, hsGuid });
        storeIds.push(wmsId);
        stores += 1;
        continue;
      }

      upsertHsStore(row, { companyId: opts?.companyId, sourceDepartment: sd });
      storeRefs.push({ wmsId: hsGuid, hsGuid });
      storeIds.push(hsGuid);
      stores += 1;
    }
  }
  return { categories, stores, storeIds, storeRefs };
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

async function fetchHsCategoryIds(baseUrl: string): Promise<string[]> {
  const raw = await hsGet('Get/Categories', '', baseUrl);
  if (!Array.isArray(raw)) return [];
  const ids: string[] = [];
  for (const row of raw as Array<{ guid?: string }>) {
    const id = String(row.guid || '').trim();
    if (UUID_RE.test(id)) ids.push(id);
  }
  return ids;
}

export type HsSyncProfile = {
  baseUrl: string;
  label: string;
  /** amo1c department / база 1С: pnevmopodveska_2025 | fogel_2025 */
  sourceDepartment: string;
  metaSyncedKey: string;
  /** Перед загрузкой очистить derived только у номенклатуры этого контура. */
  clearGlobalDerived: boolean;
  /** Полный сброс всех остатков WMS (не использовать при двух базах). */
  clearAllRests: boolean;
  /** Сбросить остатки только по складам из Get/Stores этого HS. */
  scopeRestsToHsStores: boolean;
  skipEmployees: boolean;
};

function hsScopedProductIdsSql(sourceDepartment: string): string {
  const sd = String(sourceDepartment || '').trim().replace(/'/g, "''");
  if (!sd) return `SELECT id FROM products WHERE 0`;
  return `SELECT id FROM products WHERE source_department = '${sd}'`;
}

export const HS_SYNC_PODVESKA: HsSyncProfile = {
  baseUrl: defaultHsBase(),
  label: 'Подвеска · Москва',
  sourceDepartment: 'pnevmopodveska_2025',
  metaSyncedKey: 'hs_synced_at',
  clearGlobalDerived: true,
  clearAllRests: false,
  scopeRestsToHsStores: true,
  skipEmployees: false,
};

export const HS_SYNC_FOGEL: HsSyncProfile = {
  baseUrl: fogelHsBase(),
  label: 'Фогель · Краснодар',
  sourceDepartment: 'fogel_2025',
  metaSyncedKey: 'fogel_hs_synced_at',
  clearGlobalDerived: true,
  clearAllRests: false,
  scopeRestsToHsStores: true,
  skipEmployees: true,
};

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
export async function syncApplicabilityAndProperties(
  profile: HsSyncProfile = HS_SYNC_PODVESKA
): Promise<HsSyncResult> {
  assertHsConfigured(profile.baseUrl);
  const t0 = Date.now();
  const unitId = ensureDefaultUnit();

  const { categories, stores, storeIds, storeRefs } = await syncCategoriesAndStores(profile.baseUrl, {
    companyId: companyIdForHsDepartment(profile.sourceDepartment),
    sourceDepartment: profile.sourceDepartment,
  });
  console.log(`HS [${profile.label}] categories`, categories, 'stores', stores);
  let employees = 0;
  if (!profile.skipEmployees) {
    try {
      employees = await syncEmployees();
    } catch (e) {
      console.warn('HS employees skip:', e instanceof Error ? e.message : e);
    }
  }

  const catIds = await fetchHsCategoryIds(profile.baseUrl);
  if (!catIds.length) {
    throw new Error(`HS Get/Categories вернул пусто — ${profile.label}`);
  }

  if (profile.clearGlobalDerived) {
    const scope = hsScopedProductIdsSql(profile.sourceDepartment);
    run(`DELETE FROM product_applicability WHERE product_id IN (${scope})`);
    run(`DELETE FROM product_properties WHERE product_id IN (${scope})`);
    run(`DELETE FROM product_prices WHERE product_id IN (${scope})`);
    run(`DELETE FROM product_related WHERE product_id IN (${scope})`);
  }

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
        hsGet('Get/products', body, profile.baseUrl),
        hsGet('Get/property_products', body, profile.baseUrl),
        hsGet('Get/prices', body, profile.baseUrl),
      ]);
      products = Array.isArray(prodRaw) ? (prodRaw as HsProduct[]) : [];
      props = Array.isArray(propRaw) ? (propRaw as HsPropItem[]) : [];
      prices = Array.isArray(priceRaw) ? (priceRaw as HsPriceItem[]) : [];
    } catch (e) {
      console.warn(`HS batch ${i + 1} failed, retry one-by-one:`, e instanceof Error ? e.message : e);
      for (const guid of batch) {
        try {
          const prodRaw = await hsGet('Get/products', [{ guid }], profile.baseUrl);
          if (Array.isArray(prodRaw)) products.push(...(prodRaw as HsProduct[]));
        } catch (err) {
          console.warn(`HS products skip ${guid}:`, err instanceof Error ? err.message : err);
        }
        try {
          const propRaw = await hsGet('Get/property_products', [{ guid }], profile.baseUrl);
          if (Array.isArray(propRaw)) props.push(...(propRaw as HsPropItem[]));
        } catch (err) {
          console.warn(`HS props skip ${guid}:`, err instanceof Error ? err.message : err);
        }
        try {
          const priceRaw = await hsGet('Get/prices', [{ guid }], profile.baseUrl);
          if (Array.isArray(priceRaw)) prices.push(...(priceRaw as HsPriceItem[]));
        } catch (err) {
          console.warn(`HS prices skip ${guid}:`, err instanceof Error ? err.message : err);
        }
      }
    }

    run('BEGIN');
    try {
      for (const row of products) {
        const pid = upsertHsProduct(row, unitId, profile.sourceDepartment);
        if (!pid) continue;
        productsUpserted += 1;

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
          const relatedId = hsProductIdForDepartment(rid, profile.sourceDepartment);
          if (rid && UUID_RE.test(rid) && relatedId !== pid) {
            const r = insertRelated.run(pid, relatedId);
            if (r.changes) relatedCount += 1;
          }
        }
      }

      for (const row of props) {
        const pid = hsProductIdForDepartment(productGuid(row), profile.sourceDepartment);
        if (!pid || !get(`SELECT 1 AS ok FROM products WHERE id = ?`, [pid])) continue;
        if (productIsService(pid)) continue;
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
        const pid = hsProductIdForDepartment(productGuid(row), profile.sourceDepartment);
        if (!pid || !get(`SELECT 1 AS ok FROM products WHERE id = ?`, [pid])) continue;
        if (productIsService(pid)) continue;
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

  const rests = await syncRestsInternal(catIds, profile, storeRefs);

  const legacyServicesHidden = deactivateLegacyServices();
  if (legacyServicesHidden > 0) {
    console.log(`HS: скрыто legacy-услуг (не se-*): ${legacyServicesHidden}`);
  }

  run(
    `UPDATE products SET is_active = 0
     WHERE source_department = ?
       AND instr(id, ?) = 0`,
    [profile.sourceDepartment, HS_DEPT_SEP]
  );

  run('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)', [
    profile.metaSyncedKey,
    new Date().toISOString(),
  ]);
  if (profile.sourceDepartment === 'pnevmopodveska_2025') {
    const podveskaGuids = storeRefs.map((r) => r.hsGuid);
    run('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)', [
      'hs_podveska_store_ids',
      JSON.stringify(podveskaGuids),
    ]);
  }
  if (profile.sourceDepartment === 'fogel_2025') {
    run('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)', [
      'fogel_hs_store_refs',
      JSON.stringify(storeRefs),
    ]);
  }
  if (profile.clearGlobalDerived || profile.metaSyncedKey === 'hs_synced_at') {
    run('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)', [
      'prices_synced_at',
      new Date().toISOString(),
    ]);
    run('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)', [
      'rests_synced_at',
      new Date().toISOString(),
    ]);
  }

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
  catIds: string[],
  profile: Pick<
    HsSyncProfile,
    'baseUrl' | 'clearAllRests' | 'scopeRestsToHsStores' | 'sourceDepartment'
  >,
  restStores: HsStoreRef[] = []
): Promise<{ warehouses: number; rows: number }> {
  let whs: HsStoreRef[] = [];
  if (profile.scopeRestsToHsStores && restStores.length) {
    whs = restStores;
  } else {
    whs = all<{ id: string }>(`SELECT id FROM warehouses WHERE is_active = 1`)
      .filter((w) => UUID_RE.test(w.id))
      .map((w) => ({ wmsId: w.id, hsGuid: w.id }));
  }
  if (!whs.length || !catIds.length) return { warehouses: 0, rows: 0 };

  if (profile.clearAllRests) {
    run('DELETE FROM product_store_rests');
    run('DELETE FROM stock_balances');
  } else if (profile.scopeRestsToHsStores && restStores.length) {
    const sd = String(profile.sourceDepartment || '').trim();
    for (const ref of restStores) {
      if (sd) {
        run(
          `DELETE FROM product_store_rests
           WHERE warehouse_id = ?
             AND product_id IN (SELECT id FROM products WHERE source_department = ?)`,
          [ref.wmsId, sd]
        );
        run(
          `DELETE FROM stock_balances
           WHERE warehouse_id = ?
             AND product_id IN (SELECT id FROM products WHERE source_department = ?)`,
          [ref.wmsId, sd]
        );
      } else {
        run('DELETE FROM product_store_rests WHERE warehouse_id = ?', [ref.wmsId]);
        run('DELETE FROM stock_balances WHERE warehouse_id = ?', [ref.wmsId]);
      }
    }
  }

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
    console.log('HS Get/Rests warehouse', wh.wmsId, wh.hsGuid !== wh.wmsId ? `(1C ${wh.hsGuid})` : '');
    let rests: HsRestItem[] = [];
    try {
      const raw = await hsGet(
        'Get/Rests',
        {
          stores: [wh.hsGuid],
          categories: catIds,
        },
        profile.baseUrl
      );
      rests = Array.isArray(raw) ? (raw as HsRestItem[]) : [];
    } catch (e) {
      console.warn(`HS Rests fail ${wh.hsGuid}:`, e instanceof Error ? e.message : e);
      for (const batch of chunk(catIds, 20)) {
        try {
          const raw = await hsGet(
            'Get/Rests',
            {
              stores: [wh.hsGuid],
              categories: batch,
            },
            profile.baseUrl
          );
          if (Array.isArray(raw)) rests.push(...(raw as HsRestItem[]));
        } catch (err) {
          console.warn(`HS Rests batch skip:`, err instanceof Error ? err.message : err);
        }
      }
    }

    run('BEGIN');
    try {
      for (const row of rests) {
        const catalogGuid = String(row.product || '').trim();
        const pid = hsProductIdForDepartment(catalogGuid, profile.sourceDepartment);
        if (!pid || !productExists.get(pid)) continue;
        if (productIsService(pid)) continue;
        const qty = Number(row.quantity);
        if (!Number.isFinite(qty)) continue;
        insertRest.run(pid, wh.wmsId, qty);
        insertBal.run(wh.wmsId, pid, qty);
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

export async function syncFogelFromHs(): Promise<HsSyncResult> {
  return syncApplicabilityAndProperties(HS_SYNC_FOGEL);
}

/** Подвеска + Фогель: полный синк номенклатуры/цен/остатков в WMS из 1С HS. */
export async function syncFullCatalogFrom1cHs(): Promise<{
  podveska: HsSyncResult;
  fogel: HsSyncResult;
  seconds: number;
}> {
  const t0 = Date.now();
  const podveska = await syncApplicabilityAndProperties(HS_SYNC_PODVESKA);
  const fogel = await syncFogelFromHs();
  rebuildDictionaries();
  return {
    podveska,
    fogel,
    seconds: Math.round((Date.now() - t0) / 1000),
  };
}

export async function syncRestsOnly(): Promise<{
  warehouses: number;
  restRows: number;
  categories: number;
  seconds: number;
  source: string;
  baseUrl: string;
  storeIds: number;
}> {
  assertHsConfigured();
  const t0 = Date.now();
  const profile = HS_SYNC_PODVESKA;
  const base = profile.baseUrl || defaultHsBase();
  // Только склады и категории базы pnevmopodveska_2025 (не Фогель).
  const { storeIds, storeRefs } = await syncCategoriesAndStores(base, {
    companyId: companyIdForHsDepartment(profile.sourceDepartment),
    sourceDepartment: profile.sourceDepartment,
  });
  const catIds = await fetchHsCategoryIds(base);
  if (!storeIds.length) {
    throw new Error('HS Get/Stores пусто для pnevmopodveska_2025 — остатки не загружены');
  }
  const r = await syncRestsInternal(catIds, profile, storeRefs);
  // Чужие остатки (Фогель и т.п.) — убрать: в Учёте сейчас только Подвеска.
  run(
    `DELETE FROM product_store_rests
     WHERE product_id IN (
       SELECT id FROM products
       WHERE IFNULL(source_department,'') != ?
         AND IFNULL(source_department,'') != ''
     )`,
    [profile.sourceDepartment]
  );
  run(
    `DELETE FROM stock_balances
     WHERE product_id IN (
       SELECT id FROM products
       WHERE IFNULL(source_department,'') != ?
         AND IFNULL(source_department,'') != ''
     )`,
    [profile.sourceDepartment]
  );
  run('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)', [
    'rests_synced_at',
    new Date().toISOString(),
  ]);
  run('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)', [
    'rests_source_department',
    profile.sourceDepartment,
  ]);
  run('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)', [
    'hs_podveska_store_ids',
    JSON.stringify(storeRefs.map((r) => r.hsGuid)),
  ]);
  return {
    warehouses: r.warehouses,
    restRows: r.rows,
    categories: catIds.length,
    seconds: Math.round((Date.now() - t0) / 1000),
    source: profile.sourceDepartment,
    baseUrl: base,
    storeIds: storeIds.length,
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
  const base = defaultHsBase();
  const catIds = await fetchHsCategoryIds(base);
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
        batch.map((guid) => ({ guid })),
        base
      );
      prices = Array.isArray(raw) ? (raw as HsPriceItem[]) : [];
    } catch (e) {
      console.warn(`HS prices batch ${i + 1} failed:`, e instanceof Error ? e.message : e);
      for (const guid of batch) {
        try {
          const raw = await hsGet('Get/prices', [{ guid }], base);
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
