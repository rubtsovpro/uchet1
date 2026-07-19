/**
 * Персонал Анти1С: слияние AmoCRM users + связей 1С + HS employees + права.
 */
import { execFileSync } from 'node:child_process';
import { all, get, run } from './db.js';
import { newGuid } from './ids.js';

const DEFAULT_EXPORT =
  process.env.AMO1C_STAFF_EXPORT
  || '/root/amo1c_pnevmopodveska1_ru/public_html/bin/export_staff_for_wms.php';

export const STAFF_ROLES = ['admin', 'manager', 'warehouse', 'sales', 'readonly', 'none'] as const;
export type StaffRole = (typeof STAFF_ROLES)[number];

export const STAFF_SECTIONS = [
  'home',
  'crm',
  'sales',
  'purchases',
  'warehouse',
  'works',
  'production',
  'money',
  'staff',
  'company',
  'settings',
  'ideas',
  'help',
] as const;

export type StaffRights = {
  sections: string[];
  can_sync: boolean;
  can_edit_products: boolean;
  can_edit_prices: boolean;
  can_edit_docs: boolean;
};

const ROLE_DEFAULTS: Record<StaffRole, StaffRights> = {
  admin: {
    sections: [...STAFF_SECTIONS],
    can_sync: true,
    can_edit_products: true,
    can_edit_prices: true,
    can_edit_docs: true,
  },
  manager: {
    sections: [
      'home',
      'crm',
      'sales',
      'purchases',
      'warehouse',
      'works',
      'money',
      'company',
      'ideas',
      'help',
    ],
    can_sync: false,
    can_edit_products: true,
    can_edit_prices: true,
    can_edit_docs: true,
  },
  warehouse: {
    sections: ['home', 'warehouse', 'help'],
    can_sync: false,
    can_edit_products: false,
    can_edit_prices: false,
    can_edit_docs: true,
  },
  sales: {
    sections: ['home', 'crm', 'sales', 'warehouse', 'ideas', 'help'],
    can_sync: false,
    can_edit_products: false,
    can_edit_prices: false,
    can_edit_docs: true,
  },
  readonly: {
    sections: ['home', 'crm', 'sales', 'warehouse', 'help'],
    can_sync: false,
    can_edit_products: false,
    can_edit_prices: false,
    can_edit_docs: false,
  },
  none: {
    sections: [],
    can_sync: false,
    can_edit_products: false,
    can_edit_prices: false,
    can_edit_docs: false,
  },
};

function normName(s: string): string {
  return s
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/ё/g, 'е')
    .trim();
}

function guessRole(opts: {
  isAdmin: boolean;
  authRole: number;
  groupId: string;
  hasAmo: boolean;
}): StaffRole {
  if (opts.isAdmin) return 'admin';
  if (opts.authRole === 1) return 'warehouse'; // приёмщик СТО
  // группы Amo (эмпирика аккаунта)
  if (opts.groupId === '607246') return 'admin';
  if (opts.groupId === '607254') return 'manager';
  if (opts.groupId === '607250') return 'sales';
  if (opts.hasAmo) return 'readonly';
  return 'none';
}

type AmoExport = {
  users?: Array<Record<string, unknown>>;
  relations?: Array<Record<string, unknown>>;
  auth?: Array<Record<string, unknown>>;
};

function loadAmoExport(scriptPath = DEFAULT_EXPORT): AmoExport {
  const out = execFileSync('php', [scriptPath], {
    encoding: 'utf8',
    maxBuffer: 8 * 1024 * 1024,
    timeout: 60_000,
  });
  const data = JSON.parse(out) as AmoExport & { ok?: boolean };
  return data;
}

export function parseRights(
  raw: string | null | undefined,
  role?: string | null
): StaffRights {
  const base =
    role && STAFF_ROLES.includes(role as StaffRole)
      ? ROLE_DEFAULTS[role as StaffRole]
      : ROLE_DEFAULTS.none;
  try {
    const j = JSON.parse(raw || '{}') as Partial<StaffRights>;
    return {
      sections: Array.isArray(j.sections) ? j.sections.map(String) : [...base.sections],
      can_sync: j.can_sync !== undefined ? Boolean(j.can_sync) : base.can_sync,
      can_edit_products:
        j.can_edit_products !== undefined
          ? Boolean(j.can_edit_products)
          : base.can_edit_products,
      can_edit_prices:
        j.can_edit_prices !== undefined ? Boolean(j.can_edit_prices) : base.can_edit_prices,
      can_edit_docs:
        j.can_edit_docs !== undefined ? Boolean(j.can_edit_docs) : base.can_edit_docs,
    };
  } catch {
    return structuredClone(base);
  }
}

export function rightsForRole(role: StaffRole): StaffRights {
  return structuredClone(ROLE_DEFAULTS[role] || ROLE_DEFAULTS.none);
}

export function staffMeta() {
  const total = get<{ c: number }>('SELECT COUNT(*) AS c FROM staff')?.c ?? 0;
  const amo = get<{ c: number }>(`SELECT COUNT(*) AS c FROM staff WHERE source LIKE '%amo%'`)?.c ?? 0;
  const oneC = get<{ c: number }>(`SELECT COUNT(*) AS c FROM staff WHERE source LIKE '%1c%'`)?.c ?? 0;
  const withLogin = get<{ c: number }>(`SELECT COUNT(*) AS c FROM staff WHERE can_login = 1`)?.c ?? 0;
  const last = get<{ value: string }>('SELECT value FROM meta WHERE key = ?', ['staff_synced_at'])?.value ?? null;
  return { total, amo, oneC, withLogin, lastSync: last };
}

export type StaffSyncResult = {
  amoUsers: number;
  hsEmployees: number;
  upserted: number;
  linked: number;
  seconds: number;
};

/** Слияние Amo + связей + HS employees → staff. Сохраняет вручную выставленные role/rights. */
export function syncStaffFromAmoAnd1c(scriptPath = DEFAULT_EXPORT): StaffSyncResult {
  const t0 = Date.now();
  const exp = loadAmoExport(scriptPath);
  const users = exp.users || [];
  const relations = exp.relations || [];
  const authRows = exp.auth || [];

  const relByAmo = new Map<string, Array<Record<string, unknown>>>();
  for (const r of relations) {
    const id = String(r.id || '').trim();
    if (!id) continue;
    const list = relByAmo.get(id) || [];
    list.push(r);
    relByAmo.set(id, list);
  }

  const authByName = new Map<string, Record<string, unknown>>();
  for (const a of authRows) {
    const name = normName(String(a.username || ''));
    if (name) authByName.set(name, a);
  }

  const hsEmployees = all<{ id: string; code: string; name: string }>(
    'SELECT id, code, name FROM employees ORDER BY name'
  );
  const hsByGuid = new Map(hsEmployees.map((e) => [e.id, e]));
  const usedHs = new Set<string>();

  const existing = all<{
    id: string;
    name: string;
    amo_id: string;
    one_c_guid: string;
    role: string;
    rights_json: string;
    can_login: number;
    notes: string;
  }>('SELECT id, name, amo_id, one_c_guid, role, rights_json, can_login, notes FROM staff');

  const byAmo = new Map(existing.filter((e) => e.amo_id).map((e) => [e.amo_id, e]));
  const byGuid = new Map(existing.filter((e) => e.one_c_guid).map((e) => [e.one_c_guid, e]));
  const byName = new Map(
    existing
      .map((e) => [normName(e.name || ''), e] as const)
      .filter(([n]) => n)
  );

  let upserted = 0;
  let linked = 0;

  run('BEGIN');
  try {
    for (const u of users) {
      const amoId = String(u.id || '').trim();
      if (!amoId) continue;
      const name = String(u.name || '').trim() || amoId;
      const email = String(u.email || '').trim();
      const isActive = Number(u.is_active) ? 1 : 0;
      const groupId = String(u.group_id || '').trim();
      const dept = String(u.department || '').trim();

      const rels = relByAmo.get(amoId) || [];
      const primaryRel = rels[0];
      let oneCGuid = String(primaryRel?.['1c_guid'] || u['1c_guid'] || '').trim();
      let oneCCode = String(primaryRel?.['1c_code'] || u['1c_code'] || '').trim();
      let oneCName = String(primaryRel?.['1c_name'] || u['1c_name'] || '').trim();
      let department = String(primaryRel?.department || dept || '').trim();

      if (oneCGuid && hsByGuid.has(oneCGuid)) {
        usedHs.add(oneCGuid);
        const hs = hsByGuid.get(oneCGuid)!;
        if (!oneCCode) oneCCode = hs.code;
        if (!oneCName) oneCName = hs.name;
        linked += 1;
      }

      const auth = authByName.get(normName(name));
      const isAdmin = Number(auth?.is_admin || 0) === 1;
      const authRole = Number(auth?.role || 0);
      const sto = String(auth?.sto_location || '').trim();
      const authLogin = String(auth?.username || '').trim();

      const prev = byAmo.get(amoId) || (oneCGuid ? byGuid.get(oneCGuid) : undefined);
      const id = prev?.id || newGuid();

      const sources = ['amo'];
      if (oneCGuid) sources.push('1c');
      if (auth) sources.push('auth');

      let role = (prev?.role || '') as StaffRole;
      let rightsJson = prev?.rights_json || '';
      let canLogin = prev?.can_login;
      const notes = prev?.notes || '';

      const isNew = !prev;
      if (isNew || !STAFF_ROLES.includes(role as StaffRole)) {
        role = guessRole({ isAdmin, authRole, groupId, hasAmo: true });
        rightsJson = JSON.stringify(rightsForRole(role));
        canLogin = role !== 'none' && isActive ? 1 : 0;
      } else if (!rightsJson) {
        rightsJson = JSON.stringify(rightsForRole(role));
      }
      if (canLogin === undefined || canLogin === null) {
        canLogin = role !== 'none' && isActive ? 1 : 0;
      }

      run(
        `INSERT INTO staff (
          id, amo_id, email, name, is_active, group_id,
          one_c_guid, one_c_code, one_c_name, department,
          auth_login, sto_location, is_admin_amo,
          role, rights_json, can_login, source, notes, synced_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
        ON CONFLICT(id) DO UPDATE SET
          amo_id = excluded.amo_id,
          email = excluded.email,
          name = excluded.name,
          is_active = excluded.is_active,
          group_id = excluded.group_id,
          one_c_guid = excluded.one_c_guid,
          one_c_code = excluded.one_c_code,
          one_c_name = excluded.one_c_name,
          department = excluded.department,
          auth_login = excluded.auth_login,
          sto_location = excluded.sto_location,
          is_admin_amo = excluded.is_admin_amo,
          role = excluded.role,
          rights_json = excluded.rights_json,
          can_login = excluded.can_login,
          source = excluded.source,
          notes = excluded.notes,
          synced_at = datetime('now')`,
        [
          id,
          amoId,
          email,
          name,
          isActive,
          groupId,
          oneCGuid,
          oneCCode,
          oneCName,
          department,
          authLogin,
          sto,
          isAdmin ? 1 : 0,
          role,
          rightsJson,
          canLogin,
          sources.join('+'),
          notes,
        ]
      );
      upserted += 1;
    }

    // Сотрудники 1С без привязки к Amo
    for (const hs of hsEmployees) {
      if (usedHs.has(hs.id)) continue;
      if (byGuid.has(hs.id)) {
        // уже есть запись — обновим имя/код, не трогая права
        const prev = byGuid.get(hs.id)!;
        run(
          `UPDATE staff SET one_c_code = ?, one_c_name = ?, name = COALESCE(NULLIF(name,''), ?),
            source = CASE WHEN source LIKE '%1c%' THEN source ELSE source || '+1c' END,
            synced_at = datetime('now')
           WHERE id = ?`,
          [hs.code, hs.name, hs.name, prev.id]
        );
        upserted += 1;
        continue;
      }
      const byN = byName.get(normName(hs.name));
      if (byN && !byN.one_c_guid) {
        run(
          `UPDATE staff SET one_c_guid = ?, one_c_code = ?, one_c_name = ?,
            source = CASE WHEN source LIKE '%1c%' THEN source ELSE source || '+1c' END,
            synced_at = datetime('now')
           WHERE id = ?`,
          [hs.id, hs.code, hs.name, byN.id]
        );
        usedHs.add(hs.id);
        linked += 1;
        upserted += 1;
        continue;
      }

      const role: StaffRole = 'none';
      const id = newGuid();
      run(
        `INSERT INTO staff (
          id, amo_id, email, name, is_active, group_id,
          one_c_guid, one_c_code, one_c_name, department,
          auth_login, sto_location, is_admin_amo,
          role, rights_json, can_login, source, notes, synced_at
        ) VALUES (?, '', '', ?, 1, '', ?, ?, ?, '', '', '', 0, ?, ?, 0, '1c', '', datetime('now'))`,
        [id, hs.name, hs.id, hs.code, hs.name, role, JSON.stringify(rightsForRole(role))]
      );
      upserted += 1;
    }

    run(
      `INSERT INTO meta (key, value) VALUES ('staff_synced_at', ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      [new Date().toISOString()]
    );
    run('COMMIT');
  } catch (e) {
    try {
      run('ROLLBACK');
    } catch {
      /* ignore */
    }
    throw e;
  }

  return {
    amoUsers: users.length,
    hsEmployees: hsEmployees.length,
    upserted,
    linked,
    seconds: Math.round((Date.now() - t0) / 1000),
  };
}
