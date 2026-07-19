import { all, get, run } from './db.js';

const EMPTY_GUID = '00000000-0000-0000-0000-000000000000';

export type OdataConfig = {
  baseUrl: string;
  user: string;
  password: string;
};

export function odataConfigFromEnv(): OdataConfig | null {
  const baseUrl = (process.env.ODATA_BASE_URL || '').trim();
  const user = (process.env.ODATA_USER || '').trim();
  const password = (process.env.ODATA_PASSWORD || '').trim();
  if (!baseUrl || !user || !password) return null;
  return { baseUrl: baseUrl.replace(/\/?$/, '/'), user, password };
}

function encEntity(_name: string): string {
  return '';
}
void encEntity;

async function odataGetJson(cfg: OdataConfig, pathAndQuery: string): Promise<unknown> {
  const url = cfg.baseUrl + pathAndQuery.replace(/^\//, '');
  const auth = Buffer.from(`${cfg.user}:${cfg.password}`).toString('base64');
  const res = await fetch(url, {
    headers: {
      Accept: 'application/json',
      Authorization: `Basic ${auth}`,
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`OData HTTP ${res.status}: ${text.slice(0, 300)}`);
  }
  return res.json();
}

async function fetchAllPages(
  cfg: OdataConfig,
  entity: string,
  select: string,
  baseFilter: string,
  pageSize = 500
): Promise<Record<string, unknown>[]> {
  // У 1С $skip с $filter даёт дубли — пагинация курсором по Code
  const out: Record<string, unknown>[] = [];
  const seen = new Set<string>();
  let lastCode = '';
  const enc = encodeURIComponent(entity);
  let guard = 0;
  for (;;) {
    guard += 1;
    if (guard > 500) break;
    const filter = lastCode
      ? `(${baseFilter}) and Code gt '${lastCode.replace(/'/g, "''")}'`
      : baseFilter;
    const q =
      `${enc}?$format=json&$top=${pageSize}&$orderby=Code` +
      `&$select=${encodeURIComponent(select)}` +
      `&$filter=${encodeURIComponent(filter)}`;
    const data = (await odataGetJson(cfg, q)) as { value?: Record<string, unknown>[] };
    const batch = data.value || [];
    if (!batch.length) break;
    for (const row of batch) {
      const id = String(row.Ref_Key || '');
      if (!id || seen.has(id)) continue;
      seen.add(id);
      out.push(row);
    }
    const nextCode = String(batch[batch.length - 1]?.Code || '');
    if (!nextCode || nextCode === lastCode) break;
    lastCode = nextCode;
    if (batch.length < pageSize) break;
    if (guard % 10 === 0) {
      console.log(entity, 'pages', guard, 'unique', out.length, 'lastCode', lastCode);
    }
  }
  return out;
}

function ensureDefaultUnit(): string {
  const existing = get<{ id: string }>('SELECT id FROM units WHERE short_name = ? LIMIT 1', ['шт']);
  if (existing) return existing.id;
  const id = 'unit-pcs';
  run('INSERT OR IGNORE INTO units (id, name, short_name) VALUES (?, ?, ?)', [id, 'Штука', 'шт']);
  return id;
}

function upsertWarehouse(row: Record<string, unknown>): void {
  const id = String(row.Ref_Key || '');
  if (!id || id === EMPTY_GUID) return;
  const name = String(row.Description || '').trim() || id;
  let code = String(row.Code || id).trim() || id;
  const clash = get<{ id: string }>('SELECT id FROM warehouses WHERE code = ? AND id != ?', [code, id]);
  if (clash) code = `${code}:${id.slice(0, 8)}`;
  const active = row.DeletionMark ? 0 : 1;
  run(
    `INSERT INTO warehouses (id, name, code, is_active)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET name=excluded.name, code=excluded.code, is_active=excluded.is_active`,
    [id, name, code, active]
  );
}

function upsertCategory(row: Record<string, unknown>): void {
  const id = String(row.Ref_Key || '');
  if (!id || id === EMPTY_GUID) return;
  const name = String(row.Description || '').trim() || id;
  const parent = String(row.Parent_Key || '');
  const parentId = parent && parent !== EMPTY_GUID ? parent : null;
  run(
    `INSERT INTO categories (id, name, parent_id)
     VALUES (?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET name=excluded.name, parent_id=excluded.parent_id`,
    [id, name, parentId]
  );
}

function looksLikeGuid(s: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
}

function upsertProduct(row: Record<string, unknown>, unitId: string): void {
  const id = String(row.Ref_Key || '');
  if (!id || id === EMPTY_GUID) return;
  const article = String(row['Артикул'] || '').trim();
  const code = String(row.Code || '').trim();
  // В 1С иногда Description пустой — тогда показываем номер УНФ (Code), не GUID
  let name = String(row.Description || '').trim();
  if (!name || looksLikeGuid(name)) {
    name = code || article || id;
  }
  let sku = code || article || id;
  const clash = get<{ id: string }>('SELECT id FROM products WHERE sku = ? AND id != ?', [sku, id]);
  if (clash) sku = `${sku}:${id.slice(0, 8)}`;
  const parent = String(row.Parent_Key || '');
  let categoryId: string | null = parent && parent !== EMPTY_GUID ? parent : null;
  if (categoryId && !get('SELECT id FROM categories WHERE id = ?', [categoryId])) {
    categoryId = null;
  }
  const inactive = !!(row.DeletionMark || row['Недействителен']);
  run(
    `INSERT INTO products (id, sku, name, category_id, unit_id, barcode, is_active)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       sku=excluded.sku,
       name=excluded.name,
       category_id=excluded.category_id,
       unit_id=excluded.unit_id,
       barcode=excluded.barcode,
       is_active=excluded.is_active`,
    [id, sku, name, categoryId, unitId, article, inactive ? 0 : 1]
  );
}

function upsertCounterparty(row: Record<string, unknown>): void {
  const id = String(row.Ref_Key || '');
  if (!id || id === EMPTY_GUID) return;
  const name = String(row.Description || '').trim() || id;
  const inn = String(row['ИНН'] || '').trim();
  const phone = String(row['НомерТелефонаДляПоиска'] || row['УдалитьНомерТелефона'] || '').trim();
  let kind = 'supplier';
  if (row['Покупатель'] && !row['Поставщик']) kind = 'buyer';
  else if (row['Поставщик'] && row['Покупатель']) kind = 'both';
  else if (row['Поставщик']) kind = 'supplier';
  else if (row['Покупатель']) kind = 'buyer';
  run(
    `INSERT INTO counterparties (id, name, inn, phone, kind)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       name=excluded.name, inn=excluded.inn, phone=excluded.phone, kind=excluded.kind`,
    [id, name, inn, phone, kind]
  );
}

export type SyncResult = {
  warehouses: number;
  categories: number;
  products: number;
  counterparties: number;
  seconds: number;
};

export async function syncCatalogsFromOdata(cfg: OdataConfig): Promise<SyncResult> {
  const t0 = Date.now();
  const unitId = ensureDefaultUnit();
  run('PRAGMA foreign_keys = OFF');

  const units = await fetchAllPages(
    cfg,
    'Catalog_СтруктурныеЕдиницы',
    'Ref_Key,Code,Description,DeletionMark,ТипСтруктурнойЕдиницы',
    'DeletionMark eq false'
  );
  console.log('fetched warehouses/units', units.length);

  let warehouses = 0;
  run('BEGIN');
  try {
    for (const row of units) {
      if (String(row['ТипСтруктурнойЕдиницы'] || '') !== 'Склад') continue;
      upsertWarehouse(row);
      warehouses += 1;
    }
    run('COMMIT');
  } catch (e) {
    run('ROLLBACK');
    throw e;
  }

  const folders = await fetchAllPages(
    cfg,
    'Catalog_Номенклатура',
    'Ref_Key,Description,Parent_Key,DeletionMark,IsFolder',
    'IsFolder eq true and DeletionMark eq false'
  );
  console.log('fetched categories', folders.length);
  let categories = 0;
  run('BEGIN');
  try {
    for (const row of folders) {
      upsertCategory(row);
      categories += 1;
    }
    run('COMMIT');
  } catch (e) {
    run('ROLLBACK');
    throw e;
  }

  const products = await fetchAllPages(
    cfg,
    'Catalog_Номенклатура',
    'Ref_Key,Description,Code,Артикул,Parent_Key,DeletionMark,IsFolder,Недействителен',
    'IsFolder eq false and DeletionMark eq false'
  );
  console.log('fetched products', products.length);
  let productCount = 0;
  run('BEGIN');
  try {
    for (const row of products) {
      upsertProduct(row, unitId);
      productCount += 1;
      if (productCount % 2000 === 0) {
        run('COMMIT');
        run('BEGIN');
        console.log('products upserted', productCount);
      }
    }
    run('COMMIT');
  } catch (e) {
    run('ROLLBACK');
    throw e;
  }

  const counterparties = await fetchAllPages(
    cfg,
    'Catalog_Контрагенты',
    'Ref_Key,Code,Description,ИНН,НомерТелефонаДляПоиска,УдалитьНомерТелефона,Покупатель,Поставщик,DeletionMark,IsFolder,Недействителен',
    'IsFolder eq false and DeletionMark eq false'
  );
  console.log('fetched counterparties', counterparties.length);
  let cpCount = 0;
  run('BEGIN');
  try {
    for (const row of counterparties) {
      if (row['Недействителен']) continue;
      upsertCounterparty(row);
      cpCount += 1;
      if (cpCount % 3000 === 0) {
        run('COMMIT');
        run('BEGIN');
        console.log('counterparties upserted', cpCount);
      }
    }
    run('COMMIT');
  } catch (e) {
    run('ROLLBACK');
    throw e;
  }

  run('PRAGMA foreign_keys = ON');
  run('PRAGMA wal_checkpoint(TRUNCATE)');
  run(
    'INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)',
    ['odata_synced_at', new Date().toISOString()]
  );

  const dbProducts = get<{ c: number }>('SELECT COUNT(*) AS c FROM products')?.c ?? 0;
  const dbCp = get<{ c: number }>('SELECT COUNT(*) AS c FROM counterparties')?.c ?? 0;
  console.log('db counts products/counterparties', dbProducts, dbCp);

  return {
    warehouses,
    categories,
    products: productCount,
    counterparties: cpCount,
    seconds: Math.round((Date.now() - t0) / 1000),
  };
}

export function lastOdataSync(): string | null {
  return get<{ value: string }>('SELECT value FROM meta WHERE key = ?', ['odata_synced_at'])?.value ?? null;
}

export function catalogCounts() {
  return {
    products: get<{ c: number }>('SELECT COUNT(*) AS c FROM products WHERE is_active = 1')?.c ?? 0,
    warehouses: get<{ c: number }>('SELECT COUNT(*) AS c FROM warehouses WHERE is_active = 1')?.c ?? 0,
    counterparties: get<{ c: number }>('SELECT COUNT(*) AS c FROM counterparties')?.c ?? 0,
    categories: get<{ c: number }>('SELECT COUNT(*) AS c FROM categories')?.c ?? 0,
    lastSync: lastOdataSync(),
  };
}
