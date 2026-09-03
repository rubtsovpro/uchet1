/**
 * Контур бизнеса (Пневмоподвеска / Фогель / Стрела): свои юрлица, склады и номенклатура 1С.
 * Категории в таблице общие, но список/дерево режутся по source_department товаров контура.
 * Общие на все контуры: типы цен, ед.изм.
 */
import { all, get, run } from './db.js';
import { newGuid } from './ids.js';
import { organizationLinkInfo } from './entity-delete.js';

export const DEFAULT_COMPANY_ID = '00000000-0000-4000-8000-000000000001';
export const DEFAULT_COMPANY_NAME = 'Пневмоподвеска';

export type CompanyRow = {
  id: string;
  name: string;
  code: string;
  is_default: number;
  is_active: number;
  created_at: string;
  updated_at: string;
};

let companiesReady = false;

export function ensureCompaniesSchema(): void {
  if (companiesReady) return;
  run(`
    CREATE TABLE IF NOT EXISTS companies (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      code TEXT NOT NULL DEFAULT '',
      is_default INTEGER NOT NULL DEFAULT 0,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  run(`CREATE INDEX IF NOT EXISTS idx_companies_active ON companies(is_active, is_default)`);

  const orgCols = all<{ name: string }>('PRAGMA table_info(organizations)').map((c) => c.name);
  if (orgCols.length && !orgCols.includes('company_id')) {
    run(`ALTER TABLE organizations ADD COLUMN company_id TEXT NOT NULL DEFAULT ''`);
  }
  run(`CREATE INDEX IF NOT EXISTS idx_organizations_company ON organizations(company_id)`);

  const whCols = all<{ name: string }>('PRAGMA table_info(warehouses)').map((c) => c.name);
  if (whCols.length && !whCols.includes('company_id')) {
    run(`ALTER TABLE warehouses ADD COLUMN company_id TEXT NOT NULL DEFAULT ''`);
  }
  if (whCols.length && !whCols.includes('created_at')) {
    run(`ALTER TABLE warehouses ADD COLUMN created_at TEXT NOT NULL DEFAULT ''`);
  }
  if (whCols.length && !whCols.includes('created_by')) {
    run(`ALTER TABLE warehouses ADD COLUMN created_by TEXT NOT NULL DEFAULT ''`);
  }
  if (whCols.length && !whCols.includes('updated_at')) {
    run(`ALTER TABLE warehouses ADD COLUMN updated_at TEXT NOT NULL DEFAULT ''`);
  }
  if (whCols.length && !whCols.includes('show_in_widget')) {
    run(`ALTER TABLE warehouses ADD COLUMN show_in_widget INTEGER NOT NULL DEFAULT 0`);
  }
  if (whCols.length && !whCols.includes('allow_inbound')) {
    run(`ALTER TABLE warehouses ADD COLUMN allow_inbound INTEGER NOT NULL DEFAULT 0`);
    run(
      `UPDATE warehouses SET allow_inbound = 1
       WHERE IFNULL(code,'') = 'НФ-000032'
          OR IFNULL(code,'') LIKE 'STO-RES-%'
          OR lower(IFNULL(name,'')) LIKE 'филиал%москва%'
          OR lower(IFNULL(name,'')) LIKE 'отложено%под%сто%'`
    );
  }
  run(`CREATE INDEX IF NOT EXISTS idx_warehouses_company ON warehouses(company_id)`);
  // Бэкап «кто/когда» из audit_log для старых складов
  try {
    run(`
      UPDATE warehouses
      SET created_at = IFNULL((
        SELECT a.created_at FROM audit_log a
        WHERE a.entity = 'warehouse' AND a.entity_id = warehouses.id AND a.action = 'warehouse.create'
        ORDER BY datetime(a.created_at) ASC LIMIT 1
      ), created_at),
      created_by = CASE
        WHEN IFNULL(created_by,'') != '' THEN created_by
        ELSE IFNULL((
          SELECT a.actor_id FROM audit_log a
          WHERE a.entity = 'warehouse' AND a.entity_id = warehouses.id AND a.action = 'warehouse.create'
          ORDER BY datetime(a.created_at) ASC LIMIT 1
        ), '')
      END
      WHERE IFNULL(created_at,'') = '' OR IFNULL(created_by,'') = ''
    `);
  } catch {
    /* audit_log может ещё не быть */
  }

  const count = get<{ c: number }>('SELECT COUNT(*) AS c FROM companies')?.c ?? 0;
  if (count === 0) {
    run(
      `INSERT INTO companies (id, name, code, is_default, is_active) VALUES (?, ?, 'PNEVMO', 1, 1)`,
      [DEFAULT_COMPANY_ID, DEFAULT_COMPANY_NAME]
    );
  }

  const defId =
    (get(
      `SELECT id FROM companies WHERE is_default = 1 AND is_active = 1 LIMIT 1`
    ) as { id: string } | undefined)?.id ||
    (get(`SELECT id FROM companies WHERE is_active = 1 ORDER BY name LIMIT 1`) as
      | { id: string }
      | undefined)?.id ||
    DEFAULT_COMPANY_ID;
  run(`UPDATE organizations SET company_id = ? WHERE IFNULL(company_id,'') = ''`, [defId]);
  run(`UPDATE warehouses SET company_id = ? WHERE IFNULL(company_id,'') = ''`, [defId]);

  companiesReady = true;
}

export function getDefaultCompanyId(): string {
  ensureCompaniesSchema();
  const row =
    (get(
      `SELECT id FROM companies WHERE is_default = 1 AND is_active = 1 LIMIT 1`
    ) as { id: string } | undefined) ||
    (get(`SELECT id FROM companies WHERE is_active = 1 ORDER BY name LIMIT 1`) as
      | { id: string }
      | undefined);
  return row?.id || DEFAULT_COMPANY_ID;
}

export function getCompany(id: string): CompanyRow | undefined {
  ensureCompaniesSchema();
  if (!id) return undefined;
  return get(`SELECT * FROM companies WHERE id = ?`, [id]) as CompanyRow | undefined;
}

export function listCompanies(opts: { activeOnly?: boolean } = {}): CompanyRow[] {
  ensureCompaniesSchema();
  if (opts.activeOnly === false) {
    return all(
      `SELECT * FROM companies ORDER BY is_default DESC, name COLLATE NOCASE`
    ) as CompanyRow[];
  }
  return all(
    `SELECT * FROM companies WHERE is_active = 1 ORDER BY is_default DESC, name COLLATE NOCASE`
  ) as CompanyRow[];
}

export function upsertCompany(input: {
  id?: string;
  name?: string;
  code?: string;
  is_default?: number | boolean;
  is_active?: number | boolean;
}): CompanyRow {
  ensureCompaniesSchema();
  const existing = input.id ? getCompany(input.id) : undefined;
  const id = existing?.id || input.id || newGuid();
  const name = String(input.name != null ? input.name : existing?.name || '')
    .trim();
  if (!name) throw new Error('name required');
  const code =
    String(input.code != null ? input.code : existing?.code || '')
      .trim()
      .slice(0, 64) || name.slice(0, 12).toUpperCase().replace(/\s+/g, '-');
  const makeDefault =
    input.is_default == null
      ? existing
        ? !!existing.is_default
        : !(get<{ c: number }>('SELECT COUNT(*) AS c FROM companies')?.c)
      : Boolean(input.is_default);
  const active =
    input.is_active == null
      ? existing
        ? !!existing.is_active
        : true
      : Boolean(input.is_active);

  if (makeDefault) {
    run(`UPDATE companies SET is_default = 0 WHERE id != ?`, [id]);
  }

  run(
    `INSERT INTO companies (id, name, code, is_default, is_active, updated_at)
     VALUES (?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(id) DO UPDATE SET
       name=excluded.name, code=excluded.code,
       is_default=excluded.is_default, is_active=excluded.is_active,
       updated_at=datetime('now')`,
    [id, name, code, makeDefault ? 1 : 0, active ? 1 : 0]
  );

  if (!existing) {
    ensureCompanySysWarehouses(id);
  }

  const row = getCompany(id);
  if (!row) throw new Error('company save failed');
  return row;
}

export function setDefaultCompany(id: string): CompanyRow {
  const row = getCompany(id);
  if (!row) throw new Error('Организация (контур) не найдена');
  if (!row.is_active) throw new Error('Контур неактивен');
  run(`UPDATE companies SET is_default = 0`);
  run(
    `UPDATE companies SET is_default = 1, updated_at = datetime('now') WHERE id = ?`,
    [id]
  );
  const next = getCompany(id);
  if (!next) throw new Error('Организация (контур) не найдена');
  return next;
}

export function archiveCompany(id: string): CompanyRow {
  const row = getCompany(id);
  if (!row) throw new Error('Организация (контур) не найдена');
  if (row.is_default) throw new Error('Нельзя архивировать контур по умолчанию');
  run(
    `UPDATE companies SET is_active = 0, updated_at = datetime('now') WHERE id = ?`,
    [id]
  );
  const next = getCompany(id);
  if (!next) throw new Error('Организация (контур) не найдена');
  return next;
}

export function restoreCompany(id: string): CompanyRow {
  const row = getCompany(id);
  if (!row) throw new Error('Организация (контур) не найдена');
  run(
    `UPDATE companies SET is_active = 1, updated_at = datetime('now') WHERE id = ?`,
    [id]
  );
  const next = getCompany(id);
  if (!next) throw new Error('Организация (контур) не найдена');
  return next;
}

/** Коды системных складов: для default-контура без суффикса (совместимость). */
export function sysWarehouseCode(base: 'WAIT-PAY' | 'IN-TRANSIT', companyId: string): string {
  const def = getDefaultCompanyId();
  if (companyId === def) return base;
  return `${base}.${companyId.replace(/-/g, '').slice(0, 8)}`;
}

export function ensureCompanySysWarehouses(companyId: string): void {
  ensureCompaniesSchema();
  const company = getCompany(companyId);
  if (!company) return;
  const pairs: Array<['WAIT-PAY' | 'IN-TRANSIT', string]> = [
    ['WAIT-PAY', 'Ожидание оплаты'],
    ['IN-TRANSIT', 'В пути'],
  ];
  for (const [base, name] of pairs) {
    const code = sysWarehouseCode(base, companyId);
    const existing = get<{ id: string; company_id?: string }>(
      `SELECT id, IFNULL(company_id,'') AS company_id FROM warehouses WHERE code = ? LIMIT 1`,
      [code]
    );
    if (existing?.id) {
      if (!existing.company_id) {
        run(`UPDATE warehouses SET company_id = ? WHERE id = ?`, [companyId, existing.id]);
      }
      continue;
    }
    // Имя уникально не требуется; для не-default — суффикс в имени
    const whName =
      companyId === getDefaultCompanyId() ? name : `${name} · ${company.name}`;
    run(
      `INSERT INTO warehouses (id, name, code, is_active, company_id) VALUES (?, ?, ?, 1, ?)`,
      [newGuid(), whName, code, companyId]
    );
  }
}

export function companyStats(companyId: string): {
  legal_entities: number;
  warehouses: number;
  active_legal_entities: number;
  active_warehouses: number;
} {
  ensureCompaniesSchema();
  return {
    legal_entities:
      get<{ c: number }>(
        `SELECT COUNT(*) AS c FROM organizations WHERE company_id = ?`,
        [companyId]
      )?.c ?? 0,
    warehouses:
      get<{ c: number }>(
        `SELECT COUNT(*) AS c FROM warehouses WHERE company_id = ?`,
        [companyId]
      )?.c ?? 0,
    active_legal_entities:
      get<{ c: number }>(
        `SELECT COUNT(*) AS c FROM organizations WHERE company_id = ? AND is_active = 1`,
        [companyId]
      )?.c ?? 0,
    active_warehouses:
      get<{ c: number }>(
        `SELECT COUNT(*) AS c FROM warehouses WHERE company_id = ? AND is_active = 1`,
        [companyId]
      )?.c ?? 0,
  };
}

export function listCompanyLegalEntities(companyId: string) {
  ensureCompaniesSchema();
  const items = all<{
    id: string;
    code: string;
    name: string;
    short_name: string;
    inn: string;
    kpp: string;
    phone?: string;
    email?: string;
    site_address?: string;
    work_hours?: string;
    is_default: number;
    is_active: number;
    source: string;
    company_id?: string;
  }>(
    `SELECT * FROM organizations WHERE company_id = ? ORDER BY is_default DESC, name COLLATE NOCASE`,
    [companyId]
  );
  return items.map((r) => {
    const links = organizationLinkInfo(r.id);
    return {
      id: r.id,
      code: r.code,
      name: r.name,
      short_name: r.short_name,
      inn: r.inn,
      kpp: r.kpp,
      phone: r.phone || '',
      email: r.email || '',
      site_address: r.site_address || '',
      work_hours: r.work_hours || '',
      is_default: !!r.is_default,
      is_active: !!r.is_active,
      source: r.source,
      company_id: r.company_id || companyId,
      has_links: links.linked,
      can_delete: !links.linked && !r.is_default,
      link_counts: links.counts,
    };
  });
}

export function listCompanyWarehouses(companyId: string, opts: { archived?: string } = {}) {
  ensureCompaniesSchema();
  const archived = String(opts.archived || '0');
  let sql = `SELECT * FROM warehouses WHERE company_id = ?`;
  if (archived === '1') sql += ` AND is_active = 0`;
  else if (archived !== 'all') sql += ` AND is_active = 1`;
  sql += ` ORDER BY is_active DESC, name COLLATE NOCASE`;
  return all(sql, [companyId]);
}

export function companiesListPayload() {
  ensureCompaniesSchema();
  const items = listCompanies({ activeOnly: false }).map((c) => {
    const stats = companyStats(c.id);
    return {
      ...c,
      is_default: !!c.is_default,
      is_active: !!c.is_active,
      ...stats,
    };
  });
  return {
    note: 'Организации (контуры): у каждой свои юрлица и склады. Номенклатура общая.',
    items,
    default_id: getDefaultCompanyId(),
  };
}

export function companyDetailPayload(id: string) {
  ensureCompaniesSchema();
  const company = getCompany(id);
  if (!company) return null;
  ensureCompanySysWarehouses(id);
  const stats = companyStats(id);
  return {
    ...company,
    is_default: !!company.is_default,
    is_active: !!company.is_active,
    ...stats,
    legal_entities: listCompanyLegalEntities(id),
    warehouses: listCompanyWarehouses(id, { archived: 'all' }),
  };
}

export function resolveCompanyId(companyId?: string | null): string {
  const id = String(companyId || '').trim();
  if (id) {
    const row = getCompany(id);
    if (row && row.is_active) return row.id;
  }
  return getDefaultCompanyId();
}

/**
 * Непустой company_id должен существовать в companies.
 * Иначе клиент раньше молча получал всю базу (фильтр отключался).
 * `all` / `*` — явная выгрузка по всем контурам (id='').
 */
export function parseRequestedCompanyId(
  companyId?: string | null
): { ok: true; id: string } | { ok: false; error: string } {
  const id = String(companyId || '').trim();
  if (!id) return { ok: true, id: '' };
  if (id === 'all' || id === '*') return { ok: true, id: '' };
  ensureCompaniesSchema();
  if (!getCompany(id)) {
    return { ok: false, error: `Неизвестный company_id: ${id}` };
  }
  return { ok: true, id };
}

/**
 * Для запросов по API-ключу (без сессии UI) пустой company_id опасен:
 * молча отдаётся вся база. Требуем UUID или явное company_id=all.
 */
export function machineCompanyIdRequiredError(
  companyIdRaw: string | null | undefined
): string | null {
  const raw = String(companyIdRaw || '').trim();
  if (raw) return null;
  return (
    'company_id обязателен для API-ключа. Возьмите id из GET /api/companies ' +
    'или передайте company_id=all для всей базы'
  );
}

/** Короткий список контуров для интеграторов (без тяжёлой статистики). */
export function companiesPublicListPayload() {
  ensureCompaniesSchema();
  const items = listCompanies({ activeOnly: true }).map((c) => ({
    id: c.id,
    name: c.name,
    code: c.code,
    is_default: !!c.is_default,
    is_active: !!c.is_active,
  }));
  return {
    items,
    default_id: getDefaultCompanyId(),
    note: 'Контуры (юрлица). Передавайте id как company_id в /api/products и /api/balances.',
  };
}

/**
 * Базы 1С (products.source_department) для выбранного контура.
 * Пустой companyId → без фильтра (все базы).
 * PNEVMO → pnevmopodveska_2025; Фогель/Стрела → fogel_2025.
 * Неизвестный UUID → пустая выборка (__none__), не «вся база».
 */
export function sourceDepartmentsForCompany(companyId?: string | null): string[] | null {
  const id = String(companyId || '').trim();
  if (!id) return null;
  ensureCompaniesSchema();
  const row = getCompany(id);
  if (!row) return ['__none__'];
  const code = String(row.code || '')
    .trim()
    .toUpperCase()
    .replace(/Ё/g, 'Е');
  const name = String(row.name || '')
    .trim()
    .toLowerCase()
    .replace(/ё/g, 'е');
  if (
    code === 'PNEVMO' ||
    code === 'ПНЕВМО' ||
    id === DEFAULT_COMPANY_ID ||
    name.includes('пневмо') ||
    name.includes('москва')
  ) {
    return ['pnevmopodveska_2025'];
  }
  if (
    code === 'ФОГЕЛЬ' ||
    code === 'FOGEL' ||
    code === 'STRELA' ||
    code === 'СТРЕЛА' ||
    name.includes('фогель') ||
    name.includes('стрела') ||
    name.includes('фадеев')
  ) {
    return ['fogel_2025'];
  }
  // известный, но несмапленный контур — не смешиваем с чужой базой
  return ['__none__'];
}

/** SQL-фрагмент: AND IFNULL(alias.source_department,'') IN (…) */
export function sqlSourceDepartmentIn(
  alias: string,
  departments: string[] | null | undefined
): { sql: string; params: string[] } {
  if (!departments || !departments.length) return { sql: '', params: [] };
  const col = `${alias ? alias + '.' : ''}source_department`;
  if (departments.length === 1 && departments[0] === '__none__') {
    return { sql: ` AND 1=0`, params: [] };
  }
  return {
    sql: ` AND IFNULL(${col},'') IN (${departments.map(() => '?').join(',')})`,
    params: departments,
  };
}
