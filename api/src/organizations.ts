/**
 * Справочник организаций (мультиорг как в УНФ).
 * Локальная таблица + sync из OData / Точка Банк (customers).
 */
import { fetchTochkaOverview, type TochkaAccountRow, type TochkaCustomerRow } from './bank-tochka.js';
import { ensureCompaniesSchema, resolveCompanyId } from './companies.js';
import { all, get, run } from './db.js';
import { organizationLinkInfo } from './entity-delete.js';
import { newGuid } from './ids.js';
import type { OdataConfig } from './odata.js';

export type OrgProfile = {
  name: string;
  short_name: string;
  inn: string;
  kpp: string;
  ogrnip: string;
  address: string;
  phone: string;
  bank: string;
  bik: string;
  rs: string;
  ks: string;
  director: string;
  accountant: string;
  master_title: string;
  vat_rate: number;
};

/** Реквизиты ИП Безматерных (как в бланках 1С). */
export const DEFAULT_ORG: OrgProfile = {
  name: 'Индивидуальный предприниматель Безматерных Роман Павлович',
  short_name: 'Безматерных Р.П.',
  inn: '231215603728',
  kpp: '',
  ogrnip: '322237500133521',
  address: '350000, Краснодарский край, Селезнева, д. 84, кв. 73',
  phone: '',
  bank: 'ООО "Банк Точка" г. Москва',
  bik: '044525104',
  rs: '40802810109500030587',
  ks: '30101810745374525104',
  director: 'Безматерных Р.П.',
  accountant: '',
  master_title: 'Мастер-приемщик Пневмоподвеска №1',
  vat_rate: 5,
};

export type OrganizationRow = OrgProfile & {
  id: string;
  code: string;
  company_id: string;
  is_default: number;
  is_active: number;
  source: string;
  created_at: string;
  updated_at: string;
};

const PROFILE_KEYS: (keyof OrgProfile)[] = [
  'name',
  'short_name',
  'inn',
  'kpp',
  'ogrnip',
  'address',
  'phone',
  'bank',
  'bik',
  'rs',
  'ks',
  'director',
  'accountant',
  'master_title',
  'vat_rate',
];

export function orgToProfile(row: Partial<OrganizationRow> | null | undefined): OrgProfile {
  const base = { ...DEFAULT_ORG };
  if (!row) return base;
  for (const k of PROFILE_KEYS) {
    if (k === 'vat_rate') {
      const n = Number(row.vat_rate);
      base.vat_rate = Number.isFinite(n) && n >= 0 ? n : DEFAULT_ORG.vat_rate;
    } else if (row[k] != null && row[k] !== '') {
      (base as Record<string, unknown>)[k] = String(row[k]);
    }
  }
  return base;
}

function profileFromMeta(): OrgProfile | null {
  const row = get<{ value: string }>('SELECT value FROM meta WHERE key = ?', ['org_profile']);
  if (!row?.value) return null;
  try {
    return { ...DEFAULT_ORG, ...(JSON.parse(row.value) as Partial<OrgProfile>) };
  } catch {
    return null;
  }
}

function syncMetaFromOrg(org: OrganizationRow): void {
  run('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)', [
    'org_profile',
    JSON.stringify(orgToProfile(org)),
  ]);
}

export function ensureOrganizationsSeeded(): void {
  ensureCompaniesSchema();
  const count = get<{ c: number }>('SELECT COUNT(*) AS c FROM organizations')?.c ?? 0;
  if (count > 0) {
    // Не вызывать getDefaultOrganization() — там снова ensure → бесконечная рекурсия.
    const def =
      (get(
        `SELECT * FROM organizations WHERE is_default = 1 AND is_active = 1 LIMIT 1`
      ) as OrganizationRow | undefined) ||
      (get(
        `SELECT * FROM organizations WHERE is_active = 1 ORDER BY name LIMIT 1`
      ) as OrganizationRow | undefined);
    if (def) syncMetaFromOrg(def);
    return;
  }
  const fromMeta = profileFromMeta();
  const seed = fromMeta || DEFAULT_ORG;
  const id = newGuid();
  const companyId = resolveCompanyId(null);
  run(
    `INSERT INTO organizations (
       id, code, company_id, name, short_name, inn, kpp, ogrnip, address, phone,
       bank, bik, rs, ks, director, accountant, master_title, vat_rate,
       is_default, is_active, source
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 1, 'seed')`,
    [
      id,
      'MAIN',
      companyId,
      seed.name,
      seed.short_name,
      seed.inn,
      seed.kpp,
      seed.ogrnip,
      seed.address,
      seed.phone,
      seed.bank,
      seed.bik,
      seed.rs,
      seed.ks,
      seed.director,
      seed.accountant,
      seed.master_title,
      seed.vat_rate,
    ]
  );
  const created = getOrganization(id);
  if (created) syncMetaFromOrg(created);
}

export function listOrganizations(
  opts: { activeOnly?: boolean; companyId?: string } = {}
): OrganizationRow[] {
  ensureOrganizationsSeeded();
  const companyId = String(opts.companyId || '').trim();
  const where: string[] = [];
  const params: string[] = [];
  if (opts.activeOnly !== false) where.push('is_active = 1');
  if (companyId) {
    where.push('company_id = ?');
    params.push(companyId);
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  return all(
    `SELECT * FROM organizations ${whereSql} ORDER BY is_default DESC, name COLLATE NOCASE`,
    params
  ) as OrganizationRow[];
}

export function getOrganization(id: string): OrganizationRow | undefined {
  if (!id) return undefined;
  return get(`SELECT * FROM organizations WHERE id = ?`, [id]) as OrganizationRow | undefined;
}

export function getDefaultOrganization(): OrganizationRow | undefined {
  ensureOrganizationsSeeded();
  return (
    (get(
      `SELECT * FROM organizations WHERE is_default = 1 AND is_active = 1 LIMIT 1`
    ) as OrganizationRow | undefined) ||
    (get(
      `SELECT * FROM organizations WHERE is_active = 1 ORDER BY name LIMIT 1`
    ) as OrganizationRow | undefined)
  );
}

export function resolveOrganizationId(organizationId?: string | null): string {
  const id = String(organizationId || '').trim();
  if (id) {
    const row = getOrganization(id);
    if (row && row.is_active) return row.id;
  }
  const def = getDefaultOrganization();
  if (!def) throw new Error('Нет активной организации — создайте в Компания → Организации');
  return def.id;
}

export function getOrgProfile(organizationId?: string | null): OrgProfile {
  ensureOrganizationsSeeded();
  const id = String(organizationId || '').trim();
  if (id) {
    const row = getOrganization(id);
    if (row) return orgToProfile(row);
  }
  const def = getDefaultOrganization();
  return orgToProfile(def);
}

export function saveOrgProfile(patch: Partial<OrgProfile> & Record<string, unknown>): OrgProfile {
  ensureOrganizationsSeeded();
  const def = getDefaultOrganization();
  if (!def) throw new Error('Нет организации по умолчанию');
  const next = upsertOrganization({ id: def.id, ...patch, is_default: 1 });
  return orgToProfile(next);
}

export function upsertOrganization(input: {
  id?: string;
  code?: string;
  company_id?: string;
  name?: string;
  short_name?: string;
  inn?: string;
  kpp?: string;
  ogrnip?: string;
  address?: string;
  phone?: string;
  bank?: string;
  bik?: string;
  rs?: string;
  ks?: string;
  director?: string;
  accountant?: string;
  master_title?: string;
  vat_rate?: number;
  is_default?: number | boolean;
  is_active?: number | boolean;
  source?: string;
}): OrganizationRow {
  ensureOrganizationsSeeded();
  const existing = input.id ? getOrganization(input.id) : undefined;
  const id = existing?.id || input.id || newGuid();
  const cur = existing ? orgToProfile(existing) : { ...DEFAULT_ORG };
  const companyId = resolveCompanyId(
    input.company_id != null ? input.company_id : existing?.company_id
  );
  const name = String(input.name != null ? input.name : cur.name).trim();
  if (!name) throw new Error('name required');

  const next: OrgProfile = {
    name,
    short_name: String(input.short_name != null ? input.short_name : cur.short_name).trim(),
    inn: String(input.inn != null ? input.inn : cur.inn).trim(),
    kpp: String(input.kpp != null ? input.kpp : cur.kpp).trim(),
    ogrnip: String(input.ogrnip != null ? input.ogrnip : cur.ogrnip).trim(),
    address: String(input.address != null ? input.address : cur.address).trim(),
    phone: String(input.phone != null ? input.phone : cur.phone).trim(),
    bank: String(input.bank != null ? input.bank : cur.bank).trim(),
    bik: String(input.bik != null ? input.bik : cur.bik).trim(),
    rs: String(input.rs != null ? input.rs : cur.rs).trim(),
    ks: String(input.ks != null ? input.ks : cur.ks).trim(),
    director: String(input.director != null ? input.director : cur.director).trim(),
    accountant: String(input.accountant != null ? input.accountant : cur.accountant).trim(),
    master_title: String(
      input.master_title != null ? input.master_title : cur.master_title
    ).trim(),
    vat_rate:
      input.vat_rate != null
        ? Number(input.vat_rate) || 0
        : Number(cur.vat_rate) || DEFAULT_ORG.vat_rate,
  };

  const makeDefault =
    input.is_default == null
      ? existing
        ? !!existing.is_default
        : !(get<{ c: number }>('SELECT COUNT(*) AS c FROM organizations')?.c)
      : Boolean(input.is_default);
  const active =
    input.is_active == null
      ? existing
        ? !!existing.is_active
        : true
      : Boolean(input.is_active);
  const code =
    String(input.code != null ? input.code : existing?.code || '')
      .trim()
      .slice(0, 64) || (makeDefault ? 'MAIN' : id.slice(0, 8).toUpperCase());
  const source = String(input.source || existing?.source || 'local').trim() || 'local';

  if (makeDefault) {
    run(`UPDATE organizations SET is_default = 0 WHERE id != ?`, [id]);
  }

  run(
    `INSERT INTO organizations (
       id, code, company_id, name, short_name, inn, kpp, ogrnip, address, phone,
       bank, bik, rs, ks, director, accountant, master_title, vat_rate,
       is_default, is_active, source, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(id) DO UPDATE SET
       code=excluded.code, company_id=excluded.company_id, name=excluded.name, short_name=excluded.short_name,
       inn=excluded.inn, kpp=excluded.kpp, ogrnip=excluded.ogrnip,
       address=excluded.address, phone=excluded.phone,
       bank=excluded.bank, bik=excluded.bik, rs=excluded.rs, ks=excluded.ks,
       director=excluded.director, accountant=excluded.accountant,
       master_title=excluded.master_title, vat_rate=excluded.vat_rate,
       is_default=excluded.is_default, is_active=excluded.is_active,
       source=excluded.source, updated_at=datetime('now')`,
    [
      id,
      code,
      companyId,
      next.name,
      next.short_name,
      next.inn,
      next.kpp,
      next.ogrnip,
      next.address,
      next.phone,
      next.bank,
      next.bik,
      next.rs,
      next.ks,
      next.director,
      next.accountant,
      next.master_title,
      next.vat_rate,
      makeDefault ? 1 : 0,
      active ? 1 : 0,
      source,
    ]
  );

  const row = getOrganization(id);
  if (!row) throw new Error('organization save failed');
  if (row.is_default) syncMetaFromOrg(row);
  return row;
}

export function deactivateOrganization(id: string): OrganizationRow {
  const row = getOrganization(id);
  if (!row) throw new Error('Организация не найдена');
  if (row.is_default) throw new Error('Нельзя деактивировать организацию по умолчанию');
  run(
    `UPDATE organizations SET is_active = 0, updated_at = datetime('now') WHERE id = ?`,
    [id]
  );
  const next = getOrganization(id);
  if (!next) throw new Error('Организация не найдена');
  return next;
}

export function setDefaultOrganization(id: string): OrganizationRow {
  const row = getOrganization(id);
  if (!row) throw new Error('Организация не найдена');
  if (!row.is_active) throw new Error('Организация неактивна');
  run(`UPDATE organizations SET is_default = 0`);
  run(
    `UPDATE organizations SET is_default = 1, updated_at = datetime('now') WHERE id = ?`,
    [id]
  );
  const next = getOrganization(id);
  if (!next) throw new Error('Организация не найдена');
  syncMetaFromOrg(next);
  return next;
}

export function companyOrganizationsPayload() {
  ensureCompaniesSchema();
  const items = listOrganizations({ activeOnly: false });
  return {
    note: 'Юрлица / ИП. Принадлежат организации (контуру). Документы хранят organization_id. Удаление при связях — только архив.',
    items: items.map((r) => {
      const links = organizationLinkInfo(r.id);
      return {
        id: r.id,
        code: r.code,
        company_id: r.company_id || '',
        name: r.name,
        short_name: r.short_name,
        inn: r.inn,
        kpp: r.kpp,
        is_default: !!r.is_default,
        is_active: !!r.is_active,
        source: r.source,
        profile: orgToProfile(r),
        has_links: links.linked,
        can_delete: !links.linked && !r.is_default,
        link_counts: links.counts,
      };
    }),
    default_id: getDefaultOrganization()?.id || '',
  };
}

const TOCHKA_BANK = {
  bank: 'ООО "Банк Точка" г. Москва',
  bik: '044525104',
  ks: '30101810745374525104',
};

function fioShortFromFullName(full: string): string {
  const cleaned = full
    .replace(/^Индивидуальный предприниматель\s+/iu, '')
    .replace(/^ИП\s+/iu, '')
    .trim();
  const parts = cleaned.split(/\s+/).filter(Boolean);
  if (parts.length >= 3) {
    return `${parts[0]} ${parts[1].charAt(0)}.${parts[2].charAt(0)}.`;
  }
  if (parts.length === 2) return `${parts[0]} ${parts[1].charAt(0)}.`;
  return cleaned || full;
}

function pickPrimaryRs(
  accounts: TochkaAccountRow[],
  preferRs?: string
): string {
  const prefer = String(preferRs || '').replace(/\D/g, '');
  const settlement = accounts.filter((a) => !Number(a.is_funds || 0));
  const pool = settlement.length ? settlement : accounts;
  if (prefer && pool.some((a) => a.rs === prefer)) return prefer;
  return pool[0]?.rs || accounts[0]?.rs || '';
}

function findOrgForTochkaCustomer(c: TochkaCustomerRow): OrganizationRow | undefined {
  const cc = String(c.customer_code || '').trim();
  const inn = String(c.inn || '').replace(/\D/g, '');
  if (cc) {
    const byCode = get(
      `SELECT * FROM organizations WHERE code = ? LIMIT 1`,
      [cc]
    ) as OrganizationRow | undefined;
    if (byCode) return byCode;
  }
  if (inn) {
    const byInn = get(
      `SELECT * FROM organizations WHERE inn = ? ORDER BY is_default DESC, is_active DESC LIMIT 1`,
      [inn]
    ) as OrganizationRow | undefined;
    if (byInn) return byInn;
  }
  return undefined;
}

export type TochkaOrgSyncResult = {
  ok: true;
  customers_in_tochka: number;
  created: number;
  updated: number;
  skipped: number;
  organizations: Array<{
    id: string;
    name: string;
    inn: string;
    code: string;
    rs: string;
    action: 'created' | 'updated' | 'skipped';
  }>;
};

/** Импорт юрлиц / ИП из Точка Банк (Open Banking /customers + счета). */
export async function syncOrganizationsFromTochka(): Promise<TochkaOrgSyncResult> {
  const overview = await fetchTochkaOverview();
  const customers = Array.isArray(overview.customers) ? overview.customers : [];
  const accounts = Array.isArray(overview.accounts) ? overview.accounts : [];
  if (!customers.length) {
    throw new Error(
      overview.accounts_error
        ? `Точка: нет организаций (${overview.accounts_error})`
        : 'Точка: список customers пуст'
    );
  }

  ensureOrganizationsSeeded();
  const byCustomer = new Map<string, TochkaAccountRow[]>();
  for (const a of accounts) {
    const cc = String(a.customer_code || '').trim();
    if (!cc) continue;
    const list = byCustomer.get(cc) || [];
    list.push(a);
    byCustomer.set(cc, list);
  }

  let created = 0;
  let updated = 0;
  let skipped = 0;
  const organizations: TochkaOrgSyncResult['organizations'] = [];

  for (const c of customers) {
    const cc = String(c.customer_code || '').trim();
    if (!cc) {
      skipped += 1;
      continue;
    }
    const fullName = String(c.full_name || c.label || c.short_name || '').trim();
    if (!fullName) {
      skipped += 1;
      continue;
    }
    const inn = String(c.inn || '').replace(/\D/g, '');
    const ogrnip = String(c.ogrn || '').replace(/\D/g, '');
    const label = String(c.label || fullName).trim();
    const shortName =
      label.replace(/^Индивидуальный предприниматель\s+/iu, 'ИП ').slice(0, 80) ||
      fioShortFromFullName(fullName);
    const director = fioShortFromFullName(fullName);
    const custAccounts = byCustomer.get(cc) || [];
    const existing = findOrgForTochkaCustomer(c);
    const rs = pickPrimaryRs(custAccounts, existing?.rs);

    const row = upsertOrganization({
      id: existing?.id,
      code: cc,
      name: fullName,
      short_name: existing?.short_name && existing.source !== 'tochka' ? existing.short_name : shortName,
      inn: inn || existing?.inn || '',
      kpp: existing?.kpp || '',
      ogrnip: ogrnip || existing?.ogrnip || '',
      address: existing?.address || '',
      phone: existing?.phone || '',
      bank: TOCHKA_BANK.bank,
      bik: TOCHKA_BANK.bik,
      ks: TOCHKA_BANK.ks,
      rs: rs || existing?.rs || '',
      director: existing?.director && existing.source !== 'tochka' ? existing.director : director,
      accountant: existing?.accountant || '',
      master_title: existing?.master_title || DEFAULT_ORG.master_title,
      vat_rate: existing?.vat_rate ?? DEFAULT_ORG.vat_rate,
      is_default: existing ? !!existing.is_default : false,
      is_active: 1,
      source: 'tochka',
    });

    const action = existing ? 'updated' : 'created';
    if (existing) updated += 1;
    else created += 1;
    organizations.push({
      id: row.id,
      name: row.name,
      inn: row.inn,
      code: row.code,
      rs: row.rs,
      action,
    });
  }

  return {
    ok: true,
    customers_in_tochka: customers.length,
    created,
    updated,
    skipped,
    organizations,
  };
}

/** Soft sync Catalog_Организации — если сущность не опубликована, вернёт 0 без ошибки. */
export async function syncOrganizationsFromOdata(cfg: OdataConfig): Promise<number> {
  const auth = Buffer.from(`${cfg.user}:${cfg.password}`).toString('base64');
  const entity = encodeURIComponent('Catalog_Организации');
  const select = encodeURIComponent(
    'Ref_Key,Code,Description,ИНН,КПП,DeletionMark,Префикс'
  );
  const url =
    cfg.baseUrl.replace(/\/?$/, '/') +
    `${entity}?$format=json&$top=200&$select=${select}&$filter=${encodeURIComponent('DeletionMark eq false')}`;
  let data: { value?: Record<string, unknown>[] };
  try {
    const res = await fetch(url, {
      headers: { Accept: 'application/json', Authorization: `Basic ${auth}` },
    });
    if (!res.ok) {
      const text = await res.text();
      if (res.status === 404 || /не найден|not found|does not exist/i.test(text)) {
        console.log('Catalog_Организации not published in OData — local orgs only');
        return 0;
      }
      throw new Error(`OData orgs HTTP ${res.status}: ${text.slice(0, 200)}`);
    }
    data = (await res.json()) as { value?: Record<string, unknown>[] };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/404|не найден|not found|ENOTFOUND|ECONNREFUSED/i.test(msg)) {
      console.log('Catalog_Организации sync skipped:', msg.slice(0, 120));
      return 0;
    }
    throw e;
  }

  ensureOrganizationsSeeded();
  let n = 0;
  for (const row of data.value || []) {
    const id = String(row.Ref_Key || '').trim();
    if (!id) continue;
    const name = String(row.Description || '').trim();
    if (!name) continue;
    const existing = getOrganization(id);
    const byInn = String(row['ИНН'] || '').trim();
    // не затирать локальные реквизиты печати у совпадающего по ИНН сида
    const localSameInn =
      !existing &&
      byInn &&
      (get(
        `SELECT id FROM organizations WHERE inn = ? AND source != '1c' LIMIT 1`,
        [byInn]
      ) as { id: string } | undefined);
    if (localSameInn) {
      // привяжем 1С-GUID как отдельную запись только если имя другое
      continue;
    }
    upsertOrganization({
      id,
      code: String(row.Code || row['Префикс'] || '').trim(),
      name,
      inn: byInn || existing?.inn || '',
      kpp: String(row['КПП'] || existing?.kpp || '').trim(),
      is_active: row.DeletionMark ? 0 : 1,
      is_default: existing ? !!existing.is_default : false,
      source: '1c',
      short_name: existing?.short_name || name.slice(0, 40),
      address: existing?.address,
      phone: existing?.phone,
      bank: existing?.bank,
      bik: existing?.bik,
      rs: existing?.rs,
      ks: existing?.ks,
      director: existing?.director,
      accountant: existing?.accountant,
      master_title: existing?.master_title,
      vat_rate: existing?.vat_rate,
      ogrnip: existing?.ogrnip,
    });
    n += 1;
  }
  return n;
}
