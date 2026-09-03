/**
 * API-ключи сотрудников: у каждого пользователя свой ключ.
 * Права — галочки разделов (nomen / balances / warehouses / storage) или all.
 * Env WMS_INGEST_KEY / WMS_JSON_KEY / BANK_* — fallback для вебхуков.
 */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { all, get, run } from './db.js';
import { newGuid } from './ids.js';

export type ApiKeyScope =
  | 'all'
  | 'nomen'
  | 'balances'
  | 'warehouses'
  | 'storage'
  | 'stock'
  | 'public'
  | 'ingest'
  | 'webhook'
  | 'payment';

export type IntegrationApiKey = {
  id: string;
  staff_id: string;
  staff_name: string;
  staff_login: string;
  name: string;
  key_prefix: string;
  key_hint: string;
  scopes: ApiKeyScope[];
  is_active: number;
  created_by: string;
  created_at: string;
  last_used_at: string;
  revoked_at: string;
  note: string;
};

export type VerifiedApiKey =
  | {
      source: 'db';
      id: string;
      name: string;
      staff_id: string;
      scopes: ApiKeyScope[];
    }
  | { source: 'env'; name: string; scopes: ApiKeyScope[]; staff_id?: string };

const SCOPE_SET = new Set<ApiKeyScope>([
  'all',
  'nomen',
  'balances',
  'warehouses',
  'storage',
  'stock',
  'public',
  'ingest',
  'webhook',
  'payment',
]);

/** Галочки в UI. */
export const API_KEY_SECTION_CHECKS: Array<{ id: ApiKeyScope; label: string; hint: string }> = [
  { id: 'nomen', label: 'Номенклатура', hint: 'товары, категории, цены, бренды' },
  { id: 'balances', label: 'Остатки', hint: '/api/balances, оценка склада' },
  { id: 'warehouses', label: 'Склады', hint: 'склады, документы, задания' },
  { id: 'storage', label: 'Хранение', hint: 'адресные ячейки /api/warehouse/cells' },
];

export const API_KEY_SCOPE_OPTIONS = [
  { id: 'all', label: 'Все разделы' },
  ...API_KEY_SECTION_CHECKS.map((x) => ({ id: x.id, label: x.label })),
];

function hashKey(raw: string): string {
  return createHash('sha256').update(String(raw || '').trim(), 'utf8').digest('hex');
}

function safeEqualStr(a: string, b: string): boolean {
  const ba = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ba.length !== bb.length) return false;
  try {
    return timingSafeEqual(ba, bb);
  } catch {
    return false;
  }
}

export function normalizeScopes(input: unknown): ApiKeyScope[] {
  const list = Array.isArray(input)
    ? input.map((x) => String(x || '').trim().toLowerCase())
    : String(input || '')
        .split(/[,\s|]+/)
        .map((x) => x.trim().toLowerCase())
        .filter(Boolean);
  const out: ApiKeyScope[] = [];
  for (const s of list) {
    if (SCOPE_SET.has(s as ApiKeyScope) && !out.includes(s as ApiKeyScope)) {
      out.push(s as ApiKeyScope);
    }
  }
  if (!out.length) out.push('nomen', 'balances', 'warehouses', 'storage');
  if (out.includes('all')) return ['all'];
  return out;
}

export function scopesAllow(scopes: ApiKeyScope[], need: ApiKeyScope): boolean {
  if (!need) return true;
  if (scopes.includes('all')) return true;
  if (need === 'public' && (scopes.includes('public') || scopes.includes('nomen'))) {
    return true;
  }
  // legacy stock = любой складской раздел
  if (need === 'stock') {
    return (
      scopes.includes('stock') ||
      scopes.includes('balances') ||
      scopes.includes('warehouses') ||
      scopes.includes('storage')
    );
  }
  if (need === 'balances' && scopes.includes('stock')) return true;
  if (need === 'warehouses' && scopes.includes('stock')) return true;
  if (need === 'storage' && scopes.includes('stock')) return true;
  return scopes.includes(need);
}

function parseScopesCol(raw: string): ApiKeyScope[] {
  return normalizeScopes(raw);
}

function rowToKey(row: Record<string, unknown>): IntegrationApiKey {
  return {
    id: String(row.id || ''),
    staff_id: String(row.staff_id || ''),
    staff_name: String(row.staff_name || ''),
    staff_login: String(row.staff_login || ''),
    name: String(row.name || ''),
    key_prefix: String(row.key_prefix || ''),
    key_hint: String(row.key_hint || ''),
    scopes: parseScopesCol(String(row.scopes || 'all')),
    is_active: Number(row.is_active) ? 1 : 0,
    created_by: String(row.created_by || ''),
    created_at: String(row.created_at || ''),
    last_used_at: String(row.last_used_at || ''),
    revoked_at: String(row.revoked_at || ''),
    note: String(row.note || ''),
  };
}

const LIST_SQL = `
  SELECT k.*,
         IFNULL(s.name,'') AS staff_name,
         IFNULL(s.login,'') AS staff_login
  FROM integration_api_keys k
  LEFT JOIN staff s ON s.id = k.staff_id
`;

export function listIntegrationApiKeys(opts?: {
  staffId?: string;
  activeOnly?: boolean;
}): IntegrationApiKey[] {
  const where: string[] = [];
  const params: string[] = [];
  if (opts?.staffId) {
    where.push('k.staff_id = ?');
    params.push(String(opts.staffId));
  }
  if (opts?.activeOnly) {
    where.push('k.is_active = 1');
  }
  const sql =
    LIST_SQL +
    (where.length ? ` WHERE ${where.join(' AND ')}` : '') +
    ` ORDER BY CASE WHEN k.is_active = 1 THEN 0 ELSE 1 END, datetime(k.created_at) DESC`;
  return all<Record<string, unknown>>(sql, params).map(rowToKey);
}

export function countActiveIntegrationApiKeys(): number {
  return (
    get<{ c: number }>(
      `SELECT COUNT(*) AS c FROM integration_api_keys WHERE is_active = 1`
    )?.c ?? 0
  );
}

export function hasAnyMachineApiKey(): boolean {
  if (countActiveIntegrationApiKeys() > 0) return true;
  return Boolean(
    String(process.env.WMS_INGEST_KEY || process.env.WMS_JSON_KEY || '').trim()
  );
}

export function createIntegrationApiKey(opts: {
  staffId: string;
  name?: string;
  scopes?: unknown;
  note?: string;
  createdBy?: string;
}): { key: IntegrationApiKey; secret: string } {
  const staffId = String(opts.staffId || '').trim();
  if (!staffId) throw new Error('Укажите сотрудника');
  const staff = get<{ id: string; name: string; login: string }>(
    `SELECT id, IFNULL(name,'') AS name, IFNULL(login,'') AS login
     FROM staff WHERE id = ? AND is_active = 1 LIMIT 1`,
    [staffId]
  );
  if (!staff) throw new Error('Сотрудник не найден или неактивен');

  const scopes = normalizeScopes(opts.scopes);
  const name =
    String(opts.name || '').trim() ||
    `API · ${staff.name || staff.login || staffId}`;
  const secret = `wms_${randomBytes(24).toString('base64url')}`;
  const id = newGuid();
  const keyHash = hashKey(secret);
  const keyPrefix = secret.slice(0, 8);
  const keyHint = '••••' + secret.slice(-4);

  run(
    `INSERT INTO integration_api_keys
     (id, staff_id, name, key_hash, key_prefix, key_hint, scopes, is_active, created_by, note)
     VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
    [
      id,
      staffId,
      name,
      keyHash,
      keyPrefix,
      keyHint,
      scopes.join(','),
      String(opts.createdBy || '').trim(),
      String(opts.note || '').trim(),
    ]
  );
  const row = get<Record<string, unknown>>(
    `${LIST_SQL} WHERE k.id = ?`,
    [id]
  );
  if (!row) throw new Error('Не удалось создать ключ');
  return { key: rowToKey(row), secret };
}

export function revokeIntegrationApiKey(id: string): IntegrationApiKey | null {
  const kid = String(id || '').trim();
  if (!kid) return null;
  const before = get<Record<string, unknown>>(`${LIST_SQL} WHERE k.id = ?`, [kid]);
  if (!before) return null;
  run(
    `UPDATE integration_api_keys
     SET is_active = 0, revoked_at = datetime('now')
     WHERE id = ?`,
    [kid]
  );
  const after = get<Record<string, unknown>>(`${LIST_SQL} WHERE k.id = ?`, [kid]);
  return after ? rowToKey(after) : rowToKey(before);
}

function touchLastUsed(id: string): void {
  try {
    run(
      `UPDATE integration_api_keys SET last_used_at = datetime('now') WHERE id = ?`,
      [id]
    );
  } catch {
    /* ignore */
  }
}

function matchEnvKey(raw: string, need: ApiKeyScope): VerifiedApiKey | null {
  const key = String(raw || '').trim();
  if (!key) return null;

  const ingest = String(process.env.WMS_INGEST_KEY || '').trim();
  const json = String(process.env.WMS_JSON_KEY || '').trim();
  const bank = String(
    process.env.BANK_SBP_KEY || process.env.WMS_BANK_API_KEY || process.env.INGEST_KEY || ''
  ).trim();

  const warehouseNeeds: ApiKeyScope[] = [
    'public',
    'nomen',
    'balances',
    'warehouses',
    'storage',
    'stock',
  ];
  if (warehouseNeeds.includes(need)) {
    const expect = need === 'public' ? json || ingest : ingest || json;
    if (expect && safeEqualStr(key, expect)) {
      return {
        source: 'env',
        name: expect === json && json ? 'env:WMS_JSON_KEY' : 'env:WMS_INGEST_KEY',
        scopes: ['all'],
      };
    }
  }
  if (need === 'ingest' || need === 'webhook') {
    if (ingest && safeEqualStr(key, ingest)) {
      return { source: 'env', name: 'env:WMS_INGEST_KEY', scopes: ['all'] };
    }
  }
  if (need === 'payment') {
    if (bank && safeEqualStr(key, bank)) {
      return { source: 'env', name: 'env:BANK_SBP_KEY', scopes: ['payment', 'all'] };
    }
    if (ingest && safeEqualStr(key, ingest)) {
      return { source: 'env', name: 'env:WMS_INGEST_KEY', scopes: ['all'] };
    }
  }
  if (need === 'all') {
    for (const [label, expect] of [
      ['env:WMS_INGEST_KEY', ingest],
      ['env:WMS_JSON_KEY', json],
      ['env:BANK_SBP_KEY', bank],
    ] as const) {
      if (expect && safeEqualStr(key, expect)) {
        return { source: 'env', name: label, scopes: ['all'] };
      }
    }
  }
  return null;
}

export function verifyMachineApiKey(
  raw: string,
  need: ApiKeyScope = 'all'
): VerifiedApiKey | null {
  const key = String(raw || '').trim();
  if (!key) return null;

  const keyHash = hashKey(key);
  const row = get<Record<string, unknown>>(
    `SELECT * FROM integration_api_keys WHERE key_hash = ? AND is_active = 1 LIMIT 1`,
    [keyHash]
  );
  if (row) {
    const scopes = parseScopesCol(String(row.scopes || 'all'));
    if (!scopesAllow(scopes, need)) return null;
    touchLastUsed(String(row.id));
    return {
      source: 'db',
      id: String(row.id),
      name: String(row.name || ''),
      staff_id: String(row.staff_id || ''),
      scopes,
    };
  }

  return matchEnvKey(key, need);
}

export function verifyAnyMachineApiKey(raw: string): VerifiedApiKey | null {
  const key = String(raw || '').trim();
  if (!key) return null;
  const keyHash = hashKey(key);
  const row = get<Record<string, unknown>>(
    `SELECT * FROM integration_api_keys WHERE key_hash = ? AND is_active = 1 LIMIT 1`,
    [keyHash]
  );
  if (row) {
    touchLastUsed(String(row.id));
    return {
      source: 'db',
      id: String(row.id),
      name: String(row.name || ''),
      staff_id: String(row.staff_id || ''),
      scopes: parseScopesCol(String(row.scopes || 'all')),
    };
  }
  return matchEnvKey(key, 'all');
}

export function extractMachineApiKey(c: {
  req: {
    query: (k: string) => string | undefined;
    header: (n: string) => string | undefined;
  };
}): string {
  const auth = (c.req.header('authorization') || '').trim();
  const bearer =
    /^Bearer\s+(.+)$/i.test(auth) ? auth.replace(/^Bearer\s+/i, '').trim() : '';
  return (
    (c.req.query('key') || '').trim() ||
    (c.req.header('x-wms-ingest-key') || '').trim() ||
    (c.req.header('x-wms-json-key') || '').trim() ||
    (c.req.header('X-Wms-Key') || '').trim() ||
    (c.req.header('x-wms-key') || '').trim() ||
    (c.req.header('x-api-key') || '').trim() ||
    (c.req.header('X-Api-Key') || '').trim() ||
    bearer ||
    ''
  );
}

export function machineApiKeyOk(
  c: {
    req: {
      query: (k: string) => string | undefined;
      header: (n: string) => string | undefined;
    };
  },
  need: ApiKeyScope = 'all'
): VerifiedApiKey | null {
  return verifyMachineApiKey(extractMachineApiKey(c), need);
}

/**
 * Scope для пути /api/... (без или с /api).
 * null — только сессия.
 */
export function machineScopeForApiPath(pathRaw: string): ApiKeyScope | null {
  let p = String(pathRaw || '');
  if (p.startsWith('/api/')) p = p.slice(4);
  else if (p === '/api') p = '/';
  if (!p.startsWith('/')) p = `/${p}`;

  if (p === '/health') return null;
  if (p.startsWith('/public/product')) return 'public';
  if (p.startsWith('/public/')) return null;
  if (p.startsWith('/crm/deals/ingest')) return 'ingest';
  if (p.startsWith('/crm/production/jobs')) return 'ingest';
  // Виджет Amo: поток склада / черновик «Передача на склад» / «В производство»
  // (тот же ключ, что /docs).
  if (/^\/crm\/deals\/[^/]+\/(stock-flow|handoff-pick|production)(\/|$)/.test(p)) {
    return 'warehouses';
  }
  // Виджет «Полный возврат»: карточка заказа + отметка «деньги возвращены».
  if (/^\/crm\/deals\/[^/]+$/.test(p)) return 'warehouses';
  if (/^\/crm\/deals\/[^/]+\/money-refunded$/.test(p)) return 'payment';
  if (/^\/crm\/deals\/[^/]+\/fiscal(\/|$)/.test(p)) return 'payment';
  if (/^\/crm\/deals\/[^/]+\/payment-link(s)?(\/|$)/.test(p)) return 'payment';
  if (p.startsWith('/sales-docs')) return 'payment';
  if (p.startsWith('/counterparties')) return 'payment';
  if (p.startsWith('/webhooks/amo')) return 'webhook';
  if (p.startsWith('/webhooks/payment') || p.startsWith('/webhooks/tbank-forma')) return 'payment';
  if (p.startsWith('/cron/')) return 'payment';

  // Хранение (ячейки) — до общего /warehouse/
  if (p.startsWith('/warehouse/cells') || p.startsWith('/warehouse/pick')) {
    return 'storage';
  }

  // Контуры (company_id) — read-only список для интеграций
  if (p === '/companies' || p.startsWith('/companies/')) {
    return 'nomen';
  }
  if (p === '/company/companies' || /^\/company\/companies\/[^/]+$/.test(p)) {
    return 'nomen';
  }

  // Номенклатура + снимки каталога (merge / dry_run)
  if (
    p.startsWith('/products') ||
    p.startsWith('/categories') ||
    p.startsWith('/units') ||
    p.startsWith('/prices') ||
    p.startsWith('/brands') ||
    p.startsWith('/props') ||
    p.startsWith('/marks') ||
    p.startsWith('/dict/') ||
    p.startsWith('/dicts/') ||
    p.startsWith('/snapshots')
  ) {
    return 'nomen';
  }

  // Журнал действий (снимки/merge audit) — полный ключ
  if (p.startsWith('/audit')) {
    return 'all';
  }

  // Остатки
  if (
    p.startsWith('/balances') ||
    p.startsWith('/stock/valuation') ||
    p.startsWith('/stock/low')
  ) {
    return 'balances';
  }

  // Склады + складские docs / задания / перемещения
  if (
    p.startsWith('/warehouses') ||
    p.startsWith('/docs') ||
    p.startsWith('/stock/') ||
    p.startsWith('/warehouse/') ||
    p.startsWith('/lots') ||
    p.startsWith('/marking') ||
    p.startsWith('/datamatrix')
  ) {
    return 'warehouses';
  }

  return null;
}

export function machineApiKeyOkForPath(c: {
  req: {
    query: (k: string) => string | undefined;
    header: (n: string) => string | undefined;
    method: string;
    path: string;
  };
}): VerifiedApiKey | null {
  const need = machineScopeForApiPath(c.req.path);
  if (!need) return null;
  return machineApiKeyOk(c, need);
}

/** Каталог методов для справки (Swagger-ориентир). */
export function apiMethodsCatalog(): Array<{
  group: string;
  scope: ApiKeyScope;
  method: string;
  path: string;
  title: string;
}> {
  return [
    {
      group: 'Контуры',
      scope: 'nomen',
      method: 'GET',
      path: '/api/companies',
      title: 'Список company_id (контуры)',
    },
    { group: 'Номенклатура', scope: 'nomen', method: 'GET', path: '/api/products', title: 'Список товаров' },
    { group: 'Номенклатура', scope: 'nomen', method: 'GET', path: '/api/products/{id}', title: 'Карточка товара' },
    { group: 'Номенклатура', scope: 'nomen', method: 'POST', path: '/api/products', title: 'Создать товар' },
    { group: 'Номенклатура', scope: 'nomen', method: 'PATCH', path: '/api/products/{id}', title: 'Изменить товар' },
    { group: 'Номенклатура', scope: 'nomen', method: 'POST', path: '/api/products/{id}/archive', title: 'В архив' },
    { group: 'Номенклатура', scope: 'nomen', method: 'DELETE', path: '/api/products/{id}', title: 'Удалить' },
    { group: 'Номенклатура', scope: 'nomen', method: 'PUT', path: '/api/products/{id}/prices', title: 'Цены' },
    { group: 'Номенклатура', scope: 'nomen', method: 'PUT', path: '/api/products/{id}/properties', title: 'Свойства' },
    { group: 'Номенклатура', scope: 'nomen', method: 'PUT', path: '/api/products/{id}/applicability', title: 'Применимость' },
    { group: 'Номенклатура', scope: 'nomen', method: 'GET', path: '/api/products/{id}/units', title: 'Ед. изм. / упаковки' },
    { group: 'Номенклатура', scope: 'nomen', method: 'GET', path: '/api/products/{id}/purchase-history', title: 'История закупок' },
    { group: 'Номенклатура', scope: 'nomen', method: 'GET', path: '/api/public/product/{sku}.json', title: 'Публичный JSON товара' },
    { group: 'Номенклатура', scope: 'nomen', method: 'GET', path: '/api/categories', title: 'Категории' },
    { group: 'Номенклатура', scope: 'nomen', method: 'GET', path: '/api/categories/tree', title: 'Дерево категорий' },
    { group: 'Номенклатура', scope: 'nomen', method: 'POST', path: '/api/categories', title: 'Создать категорию' },
    { group: 'Номенклатура', scope: 'nomen', method: 'GET', path: '/api/units', title: 'Единицы измерения' },
    { group: 'Номенклатура', scope: 'nomen', method: 'GET', path: '/api/dicts/brands', title: 'Бренды' },
    { group: 'Номенклатура', scope: 'nomen', method: 'GET', path: '/api/dicts/marks', title: 'Марки авто' },
    { group: 'Номенклатура', scope: 'nomen', method: 'GET', path: '/api/prices/matrix', title: 'Матрица цен' },

    { group: 'Остатки', scope: 'balances', method: 'GET', path: '/api/balances', title: 'Остатки по складам' },
    { group: 'Остатки', scope: 'balances', method: 'GET', path: '/api/stock/low', title: 'Низкие остатки' },

    { group: 'Склады', scope: 'warehouses', method: 'GET', path: '/api/warehouses', title: 'Список складов' },
    { group: 'Склады', scope: 'warehouses', method: 'GET', path: '/api/warehouses/stock-totals', title: 'Итоги по складам' },
    { group: 'Склады', scope: 'warehouses', method: 'GET', path: '/api/warehouses/{id}', title: 'Склад' },
    { group: 'Склады', scope: 'warehouses', method: 'GET', path: '/api/warehouses/{id}/movements', title: 'Движения' },
    { group: 'Склады', scope: 'warehouses', method: 'POST', path: '/api/warehouses', title: 'Создать склад' },
    { group: 'Склады', scope: 'warehouses', method: 'PATCH', path: '/api/warehouses/{id}', title: 'Изменить склад' },
    { group: 'Склады', scope: 'warehouses', method: 'GET', path: '/api/docs', title: 'Складские документы' },
    { group: 'Склады', scope: 'warehouses', method: 'GET', path: '/api/docs/{id}', title: 'Документ' },
    { group: 'Склады', scope: 'warehouses', method: 'POST', path: '/api/docs', title: 'Создать документ' },
    { group: 'Склады', scope: 'warehouses', method: 'GET', path: '/api/stock/writeoffs', title: 'Списания' },
    { group: 'Склады', scope: 'warehouses', method: 'GET', path: '/api/stock/transfers', title: 'Перемещения' },
    { group: 'Склады', scope: 'warehouses', method: 'POST', path: '/api/stock/transfer-request', title: 'Заявка на перемещение' },
    { group: 'Склады', scope: 'warehouses', method: 'GET', path: '/api/warehouse/tasks', title: 'Задания склада' },

    { group: 'Хранение', scope: 'storage', method: 'GET', path: '/api/warehouse/cells/meta', title: 'Мета ячеек' },
    { group: 'Хранение', scope: 'storage', method: 'GET', path: '/api/warehouse/cells/map', title: 'Карта ячеек' },
    { group: 'Хранение', scope: 'storage', method: 'GET', path: '/api/warehouse/cells/balances', title: 'Остатки по ячейкам' },
    { group: 'Хранение', scope: 'storage', method: 'GET', path: '/api/warehouse/cells/{code}', title: 'Ячейка' },
    { group: 'Хранение', scope: 'storage', method: 'POST', path: '/api/warehouse/cells/import', title: 'Импорт ячеек' },
  ];
}
