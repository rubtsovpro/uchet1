/**
 * Персонал Анти1С: слияние AmoCRM users + связей 1С + HS employees + права.
 * Роли задают разделы меню и флаги can_* (RBAC).
 */
import { execFileSync } from 'node:child_process';
import { all, get, run } from './db.js';
import { newGuid } from './ids.js';

const DEFAULT_EXPORT =
  process.env.AMO1C_STAFF_EXPORT
  || '/root/amo1c_pnevmopodveska1_ru/public_html/bin/export_staff_for_wms.php';

const META_AMO_USERS = 'amo_user_directory';

/** Справочник Amo user id → ФИО (чтобы в селекте были имена даже без привязки staff). */
export function getAmoUserDirectory(): Record<string, { name: string; email?: string; is_active?: boolean }> {
  const row = get<{ value: string }>('SELECT value FROM meta WHERE key = ?', [META_AMO_USERS]);
  if (!row?.value) return {};
  try {
    const parsed = JSON.parse(row.value) as Record<string, { name: string; email?: string; is_active?: boolean }>;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

export function saveAmoUserDirectory(
  users: Array<{ id?: unknown; name?: unknown; email?: unknown; is_active?: unknown }>
): number {
  const cur = getAmoUserDirectory();
  let n = 0;
  for (const u of users || []) {
    const id = String(u.id || '').trim();
    if (!id) continue;
    const name = String(u.name || '').trim();
    if (!name) continue;
    cur[id] = {
      name,
      email: String(u.email || '').trim() || undefined,
      is_active: Number(u.is_active) !== 0 && u.is_active !== false,
    };
    n += 1;
  }
  run('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)', [
    META_AMO_USERS,
    JSON.stringify(cur),
  ]);
  return n;
}

export function amoUserDisplayName(amoId: string): string {
  const id = String(amoId || '').trim();
  if (!id) return '';
  const dir = getAmoUserDirectory()[id];
  if (dir?.name) return dir.name;
  const st = get<{ name: string }>(
    `SELECT name FROM staff WHERE amo_id = ? AND IFNULL(name,'') != '' LIMIT 1`,
    [id]
  );
  return String(st?.name || '').trim();
}

/** Практичные роли Учёт №1 (код → UI на русском через ROLE_META). */
export const STAFF_ROLES = [
  'admin',
  'manager',
  'warehouse',
  'photographer',
  'sto',
  'courier',
  'sales',
  'accountant',
  'purchaser',
  'readonly',
  'none',
] as const;
export type StaffRole = (typeof STAFF_ROLES)[number];

/** Разделы меню + рабочие экраны (/pick, /photo, /lift, /reception) + служебные блоки. */
export const STAFF_SECTIONS = [
  'home',
  'crm',
  'sales',
  'purchases',
  'warehouse',
  'pick',
  'photo',
  'lift',
  'reception',
  'delivery',
  'media',
  'works',
  'production',
  'money',
  'kassa',
  'tax',
  'reports',
  'staff',
  'chats',
  'company',
  'settings',
  'integrations',
  'ideas',
  'help',
] as const;

export type StaffSection = (typeof STAFF_SECTIONS)[number];

/** Подписи для API / матрицы (UI на русском). */
export const SECTION_LABELS: Record<StaffSection, string> = {
  home: 'Главное',
  crm: 'CRM',
  sales: 'Продажи',
  purchases: 'Закупки',
  warehouse: 'Склад',
  pick: 'Сборка (/pick)',
  photo: 'Фото / медиа',
  lift: 'Подъёмник (/lift)',
  reception: 'Приёмщик (/reception)',
  delivery: 'Доставка / СДЭК',
  media: 'Медиа / фото',
  works: 'Работы',
  production: 'Производство',
  money: 'Деньги',
  kassa: 'Касса',
  tax: 'Налоги и зарплата',
  reports: 'Отчёты',
  staff: 'Персонал',
  chats: 'Чаты',
  company: 'Компания',
  settings: 'Настройки',
  integrations: 'Интеграции',
  ideas: 'Идеи',
  help: 'Помощь',
};

export type StaffRights = {
  sections: string[];
  can_sync: boolean;
  can_edit_products: boolean;
  can_edit_prices: boolean;
  can_edit_docs: boolean;
  can_tax: boolean;
  can_payroll: boolean;
  /**
   * Контуры (companies.id), к которым есть доступ.
   * Пустой массив / отсутствует — все организации (как раньше).
   * Админ / системный — всегда все, поле игнорируется.
   */
  company_ids: string[];
  /** Фиксированный склад /pick: strela | fogel | msk (пусто — все вкладки). */
  pick_site_lock?: '' | 'strela' | 'fogel' | 'msk';
};

export type RoleMeta = {
  id: StaffRole;
  label: string;
  description: string;
  rights: StaffRights;
};

const ALL_SECTIONS = [...STAFF_SECTIONS];

function withCompanyIds(
  r: Omit<StaffRights, 'company_ids' | 'pick_site_lock'>,
  extras?: Partial<Pick<StaffRights, 'pick_site_lock' | 'company_ids'>>
): StaffRights {
  return { ...r, company_ids: extras?.company_ids ?? [], pick_site_lock: extras?.pick_site_lock ?? '' };
}

function normPickSiteLock(raw: unknown): '' | 'strela' | 'fogel' | 'msk' {
  const s = String(raw || '')
    .trim()
    .toLowerCase();
  if (s === 'msk' || s === 'moscow' || s === 'москва') return 'msk';
  if (s === 'fogel' || s === 'фогель') return 'fogel';
  if (s === 'strela' || s === 'стрела') return 'strela';
  return '';
}

const ROLE_DEFAULTS: Record<StaffRole, StaffRights> = {
  admin: withCompanyIds({
    sections: ALL_SECTIONS,
    can_sync: true,
    can_edit_products: true,
    can_edit_prices: true,
    can_edit_docs: true,
    can_tax: true,
    can_payroll: true,
  }),
  manager: withCompanyIds({
    sections: [
      'home',
      'crm',
      'sales',
      'purchases',
      'warehouse',
      'pick',
      'photo',
      'lift',
      'reception',
      'delivery',
      'media',
      'works',
      'money',
      'kassa',
      'tax',
      'reports',
      'chats',
      'company',
      'integrations',
      'ideas',
      'help',
    ],
    can_sync: false,
    can_edit_products: true,
    can_edit_prices: true,
    can_edit_docs: true,
    can_tax: true,
    can_payroll: true,
  }),
  warehouse: withCompanyIds(
    {
      sections: ['home', 'warehouse', 'pick', 'photo', 'chats', 'help'],
      can_sync: false,
      can_edit_products: false,
      can_edit_prices: false,
      can_edit_docs: true,
      can_tax: false,
      can_payroll: false,
    },
    { pick_site_lock: 'msk' }
  ),
  photographer: withCompanyIds({
    sections: ['home', 'warehouse', 'photo', 'media', 'chats', 'help'],
    can_sync: false,
    can_edit_products: false,
    can_edit_prices: false,
    can_edit_docs: false,
    can_tax: false,
    can_payroll: false,
  }),
  sto: withCompanyIds({
    sections: [
      'home',
      'crm',
      'sales',
      'warehouse',
      'lift',
      'reception',
      'works',
      'chats',
      'ideas',
      'help',
    ],
    can_sync: false,
    can_edit_products: false,
    can_edit_prices: false,
    can_edit_docs: true,
    can_tax: false,
    can_payroll: false,
  }),
  courier: withCompanyIds({
    sections: ['home', 'warehouse', 'pick', 'delivery', 'chats', 'help'],
    can_sync: false,
    can_edit_products: false,
    can_edit_prices: false,
    can_edit_docs: false,
    can_tax: false,
    can_payroll: false,
  }),
  sales: withCompanyIds({
    sections: ['home', 'crm', 'sales', 'warehouse', 'delivery', 'money', 'kassa', 'chats', 'ideas', 'help'],
    can_sync: false,
    can_edit_products: false,
    can_edit_prices: false,
    can_edit_docs: true,
    can_tax: false,
    can_payroll: false,
  }),
  accountant: withCompanyIds({
    sections: [
      'home',
      'sales',
      'money',
      'kassa',
      'tax',
      'reports',
      'chats',
      'company',
      'help',
    ],
    can_sync: false,
    can_edit_products: false,
    can_edit_prices: false,
    can_edit_docs: true,
    can_tax: true,
    can_payroll: true,
  }),
  purchaser: withCompanyIds({
    sections: ['home', 'purchases', 'help'],
    can_sync: false,
    can_edit_products: true,
    can_edit_prices: true,
    can_edit_docs: true,
    can_tax: false,
    can_payroll: false,
  }),
  readonly: withCompanyIds({
    sections: [
      'home',
      'crm',
      'sales',
      'warehouse',
      'money',
      'kassa',
      'reports',
      'chats',
      'company',
      'help',
    ],
    can_sync: false,
    can_edit_products: false,
    can_edit_prices: false,
    can_edit_docs: false,
    can_tax: false,
    can_payroll: false,
  }),
  none: withCompanyIds({
    sections: [],
    can_sync: false,
    can_edit_products: false,
    can_edit_prices: false,
    can_edit_docs: false,
    can_tax: false,
    can_payroll: false,
  }),
};

export const ROLE_META: Record<StaffRole, Omit<RoleMeta, 'id' | 'rights'>> = {
  admin: {
    label: 'Админ',
    description: 'Полный доступ: все разделы, синхронизация 1С, персонал, настройки.',
  },
  manager: {
    label: 'Руководитель / менеджер',
    description: 'CRM, продажи, склад, деньги, компания. Без персонала и синхронизации.',
  },
  warehouse: {
    label: 'Кладовщик',
    description: 'Склад: остатки, документы, задания. Без CRM и денег.',
  },
  photographer: {
    label: 'Фотограф',
    description: 'Главная, номенклатура и медиа / фото.',
  },
  sto: {
    label: 'СТО / мастер-приёмщик',
    description: 'Экраны /lift и /reception: подъёмник, приёмка, работы слесаря, материалы.',
  },
  courier: {
    label: 'Курьер',
    description: 'Экран /courier: принято → забрал → сдал на склад. Задания из «Задание на СТО».',
  },
  sales: {
    label: 'Продажи',
    description: 'CRM, счета и документы продаж, просмотр склада.',
  },
  accountant: {
    label: 'Бухгалтер',
    description: 'Продажи, деньги (Точка), касса, налоги / зарплата, реквизиты компании. Без закупок.',
  },
  purchaser: {
    label: 'Закупщик',
    description:
      'Только закупки: заказы поставщику, копипаст/Excel, приходные (черновики для склада), номенклатура в закупках. Без склада/CRM/компании.',
  },
  readonly: {
    label: 'Наблюдатель',
    description: 'Только просмотр ключевых разделов, без правок.',
  },
  none: {
    label: 'Без доступа',
    description: 'Учётная запись без входа в разделы (справочник / связь с 1С).',
  },
};

export function rightsForRole(role: StaffRole): StaffRights {
  return structuredClone(ROLE_DEFAULTS[role] || ROLE_DEFAULTS.none);
}

export function isStaffRole(role: string | null | undefined): role is StaffRole {
  return !!role && (STAFF_ROLES as readonly string[]).includes(role);
}

export function rolesCatalog(): RoleMeta[] {
  return STAFF_ROLES.map((id) => ({
    id,
    label: ROLE_META[id].label,
    description: ROLE_META[id].description,
    rights: rightsForRole(id),
  }));
}

export function roleSortRank(role: string): number {
  const i = (STAFF_ROLES as readonly string[]).indexOf(role);
  return i >= 0 ? i : 99;
}

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
  if (opts.authRole === 1) return 'sto'; // приёмщик СТО в amo1c auth
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

function normCompanyIds(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return [...new Set(raw.map((x) => String(x || '').trim()).filter(Boolean))];
}

export function parseRights(
  raw: string | null | undefined,
  role?: string | null
): StaffRights {
  const base =
    role && isStaffRole(role) ? ROLE_DEFAULTS[role] : ROLE_DEFAULTS.none;
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
      can_tax: j.can_tax !== undefined ? Boolean(j.can_tax) : base.can_tax,
      can_payroll: j.can_payroll !== undefined ? Boolean(j.can_payroll) : base.can_payroll,
      company_ids:
        j.company_ids !== undefined ? normCompanyIds(j.company_ids) : [...base.company_ids],
      pick_site_lock:
        j.pick_site_lock !== undefined ? normPickSiteLock(j.pick_site_lock) : base.pick_site_lock || '',
    };
  } catch {
    return structuredClone(base);
  }
}

/**
 * null — доступ ко всем контурам.
 * string[] — только эти companies.id.
 */
export function actorAllowedCompanyIds(
  actor:
    | { role?: string; isSystemAdmin?: boolean; rights?: StaffRights | null }
    | null
    | undefined
): string[] | null {
  if (!actor) return null;
  if (actor.isSystemAdmin || actor.role === 'admin') return null;
  const ids = normCompanyIds(actor.rights?.company_ids);
  return ids.length ? ids : null;
}

/** Эффективный фильтр company_id для list-запросов (null = без ограничения). */
export function resolveListCompanyFilter(
  actor:
    | { role?: string; isSystemAdmin?: boolean; rights?: StaffRights | null }
    | null
    | undefined,
  requestedCompanyId?: string | null
): { mode: 'all' } | { mode: 'one'; id: string } | { mode: 'in'; ids: string[] } | { mode: 'none' } {
  const allowed = actorAllowedCompanyIds(actor);
  const req = String(requestedCompanyId || '').trim();
  if (!allowed) {
    return req ? { mode: 'one', id: req } : { mode: 'all' };
  }
  if (req) {
    return allowed.includes(req) ? { mode: 'one', id: req } : { mode: 'none' };
  }
  return { mode: 'in', ids: allowed };
}

/** Overlay отдела: дать / забрать разделы и can_* поверх роли и личных прав. */
export type DeptRightsOverlay = {
  grant_sections: string[];
  revoke_sections: string[];
  grant: Partial<
    Pick<
      StaffRights,
      'can_sync' | 'can_edit_products' | 'can_edit_prices' | 'can_edit_docs' | 'can_tax' | 'can_payroll'
    >
  >;
  revoke: Partial<
    Pick<
      StaffRights,
      'can_sync' | 'can_edit_products' | 'can_edit_prices' | 'can_edit_docs' | 'can_tax' | 'can_payroll'
    >
  >;
};

const EMPTY_OVERLAY: DeptRightsOverlay = {
  grant_sections: [],
  revoke_sections: [],
  grant: {},
  revoke: {},
};

const CAN_FLAGS = [
  'can_sync',
  'can_edit_products',
  'can_edit_prices',
  'can_edit_docs',
  'can_tax',
  'can_payroll',
] as const;

function filterSections(list: unknown): string[] {
  if (!Array.isArray(list)) return [];
  return [...new Set(list.map(String).filter((s) => (STAFF_SECTIONS as readonly string[]).includes(s)))];
}

export function parseDeptOverlay(raw: string | null | undefined): DeptRightsOverlay {
  try {
    const j = JSON.parse(raw || '{}') as Partial<DeptRightsOverlay> & {
      grant_flags?: DeptRightsOverlay['grant'];
      revoke_flags?: DeptRightsOverlay['revoke'];
    };
    const grant = { ...(j.grant || j.grant_flags || {}) };
    const revoke = { ...(j.revoke || j.revoke_flags || {}) };
    const outGrant: DeptRightsOverlay['grant'] = {};
    const outRevoke: DeptRightsOverlay['revoke'] = {};
    for (const f of CAN_FLAGS) {
      if (grant[f] === true) outGrant[f] = true;
      if (revoke[f] === true) outRevoke[f] = true;
    }
    return {
      grant_sections: filterSections(j.grant_sections),
      revoke_sections: filterSections(j.revoke_sections),
      grant: outGrant,
      revoke: outRevoke,
    };
  } catch {
    return structuredClone(EMPTY_OVERLAY);
  }
}

export function emptyDeptOverlay(): DeptRightsOverlay {
  return structuredClone(EMPTY_OVERLAY);
}

export function applyDeptOverlay(base: StaffRights, overlay: DeptRightsOverlay | null | undefined): StaffRights {
  if (!overlay) return structuredClone(base);
  const secs = new Set(base.sections);
  for (const s of overlay.grant_sections || []) secs.add(s);
  for (const s of overlay.revoke_sections || []) secs.delete(s);
  const result: StaffRights = {
    sections: [...secs].filter((s) => (STAFF_SECTIONS as readonly string[]).includes(s)),
    can_sync: base.can_sync,
    can_edit_products: base.can_edit_products,
    can_edit_prices: base.can_edit_prices,
    can_edit_docs: base.can_edit_docs,
    can_tax: base.can_tax,
    can_payroll: base.can_payroll,
    company_ids: [...(base.company_ids || [])],
  };
  for (const f of CAN_FLAGS) {
    if (overlay.revoke?.[f]) result[f] = false;
    else if (overlay.grant?.[f]) result[f] = true;
  }
  return result;
}

/** Канонические подразделения бизнеса (вместо сырых имён Amo вроде fogel_2025). */
export const DEFAULT_DEPARTMENTS = ['Подвеска', 'Фогель'] as const;

const DEPARTMENT_ALIASES: Record<string, string> = {
  fogel_2025: 'Фогель',
  fogel: 'Фогель',
  фогель: 'Фогель',
  подвеска: 'Подвеска',
  пневмоподвеска: 'Подвеска',
  'пневмоподвеска №1': 'Подвеска',
  'пневмоподвеска 1': 'Подвеска',
};

export function normDepartmentName(name: string | null | undefined): string {
  const raw = String(name || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
  if (!raw) return '';
  const key = raw.toLowerCase().replace(/ё/g, 'е');
  return DEPARTMENT_ALIASES[key] || raw;
}

/** Отделы для подписей в чек-листе СТО. */
export const STO_CHECKLIST_STAFF_DEPTS = {
  /** Мастер-приёмщик */
  master: 'Мастера-приёмщики',
  /** Слесарь / установщик (поле admin_name в JSON — историческое имя) */
  admin: 'Механики',
} as const;

export const STO_CHECKLIST_STAFF_LABELS = {
  master: 'Мастер-приёмщик',
  admin: 'Слесарь / установщик',
} as const;

export type StoChecklistStaffPick = {
  id: string;
  name: string;
  department: string;
  role: string;
};

/** Активные сотрудники отдела для select в чек-листе ЗН. */
export function listStoChecklistStaffPicks(): {
  masters: StoChecklistStaffPick[];
  admins: StoChecklistStaffPick[];
  departments: { master: string; admin: string };
  labels: { master: string; admin: string };
} {
  const rows = all<{
    id: string;
    name: string;
    department: string;
    role: string;
  }>(
    `SELECT id, name, COALESCE(department, '') AS department, role
     FROM staff
     WHERE can_login = 1
       AND is_active = 1
       AND role != 'none'
       AND trim(COALESCE(name, '')) != ''
     ORDER BY name COLLATE NOCASE`
  );
  const masterDept = STO_CHECKLIST_STAFF_DEPTS.master;
  const adminDept = STO_CHECKLIST_STAFF_DEPTS.admin;
  const masterKey = normDepartmentName(masterDept).toLowerCase();
  const adminKey = normDepartmentName(adminDept).toLowerCase();
  const mapPick = (r: (typeof rows)[number]): StoChecklistStaffPick => ({
    id: r.id,
    name: String(r.name || '').trim(),
    department: normDepartmentName(r.department) || String(r.department || '').trim(),
    role: String(r.role || ''),
  });
  const masters = rows
    .filter((r) => normDepartmentName(r.department).toLowerCase() === masterKey)
    .map(mapPick);
  const admins = rows
    .filter((r) => normDepartmentName(r.department).toLowerCase() === adminKey)
    .map(mapPick);
  return {
    masters,
    admins,
    departments: { master: masterDept, admin: adminDept },
    labels: {
      master: STO_CHECKLIST_STAFF_LABELS.master,
      admin: STO_CHECKLIST_STAFF_LABELS.admin,
    },
  };
}

/** Создать канонические отделы, если ещё нет; переименовать известные алиасы у сотрудников. */
export function ensureCanonicalDepartments(): void {
  for (const name of DEFAULT_DEPARTMENTS) {
    const exists = get<{ name: string }>('SELECT name FROM staff_departments WHERE name = ?', [name]);
    if (!exists) {
      run(
        `INSERT INTO staff_departments (name, rights_json, notes, updated_at)
         VALUES (?, '{}', '', datetime('now'))`,
        [name]
      );
    }
  }
  for (const [alias, canon] of Object.entries(DEPARTMENT_ALIASES)) {
    if (alias === canon.toLowerCase().replace(/ё/g, 'е')) continue;
    run(`UPDATE staff SET department = ? WHERE lower(trim(department)) = ?`, [canon, alias]);
    run(`DELETE FROM staff_departments WHERE lower(name) = ? AND name != ?`, [alias, canon]);
  }
}

export type DeptRow = {
  name: string;
  members: number;
  overlay: DeptRightsOverlay;
  notes: string;
  from_staff: boolean;
  configured: boolean;
};

/** Справочник отделов: из staff.department + сохранённые overlays. */
export function listDepartments(): DeptRow[] {
  ensureCanonicalDepartments();
  const counts = all<{ name: string; c: number }>(
    `SELECT trim(department) AS name, COUNT(*) AS c FROM staff
     WHERE trim(department) != '' GROUP BY trim(department)`
  );
  const mergedCounts = new Map<string, number>();
  for (const r of counts) {
    const canon = normDepartmentName(r.name) || r.name;
    if (!canon) continue;
    mergedCounts.set(canon, (mergedCounts.get(canon) || 0) + (Number(r.c) || 0));
  }
  const saved = all<{ name: string; rights_json: string; notes: string }>(
    'SELECT name, rights_json, notes FROM staff_departments ORDER BY name'
  );
  const names = new Set<string>([
    ...DEFAULT_DEPARTMENTS,
    ...mergedCounts.keys(),
    ...saved.map((s) => normDepartmentName(s.name) || s.name),
  ]);
  const savedMap = new Map(saved.map((s) => [normDepartmentName(s.name) || s.name, s]));
  return [...names]
    .filter(Boolean)
    .sort((a, b) => {
      const ia = (DEFAULT_DEPARTMENTS as readonly string[]).indexOf(a);
      const ib = (DEFAULT_DEPARTMENTS as readonly string[]).indexOf(b);
      if (ia >= 0 || ib >= 0) {
        if (ia < 0) return 1;
        if (ib < 0) return -1;
        return ia - ib;
      }
      return a.localeCompare(b, 'ru');
    })
    .map((name) => {
      const row = savedMap.get(name);
      const overlay = row ? parseDeptOverlay(row.rights_json) : emptyDeptOverlay();
      const configured = !!(
        row &&
        (overlay.grant_sections.length ||
          overlay.revoke_sections.length ||
          Object.keys(overlay.grant).length ||
          Object.keys(overlay.revoke).length ||
          String(row.notes || '').trim())
      );
      return {
        name,
        members: mergedCounts.get(name) || 0,
        overlay,
        notes: row ? String(row.notes || '') : '',
        from_staff: mergedCounts.has(name),
        configured,
      };
    });
}

export function getDeptOverlay(name: string): DeptRightsOverlay {
  const n = normDepartmentName(name);
  if (!n) return emptyDeptOverlay();
  const row = get<{ rights_json: string }>(
    'SELECT rights_json FROM staff_departments WHERE name = ?',
    [n]
  );
  return row ? parseDeptOverlay(row.rights_json) : emptyDeptOverlay();
}

export function upsertDepartment(
  name: string,
  opts: { overlay?: DeptRightsOverlay; notes?: string }
): DeptRow {
  const n = normDepartmentName(name);
  if (!n) throw new Error('Укажите название отдела');
  const prev = get<{ rights_json: string; notes: string }>(
    'SELECT rights_json, notes FROM staff_departments WHERE name = ?',
    [n]
  );
  const overlay = opts.overlay !== undefined ? opts.overlay : prev
    ? parseDeptOverlay(prev.rights_json)
    : emptyDeptOverlay();
  // нормализуем
  const clean = parseDeptOverlay(JSON.stringify(overlay));
  const notes =
    opts.notes !== undefined ? String(opts.notes).slice(0, 500) : String(prev?.notes || '');
  run(
    `INSERT INTO staff_departments (name, rights_json, notes, updated_at)
     VALUES (?, ?, ?, datetime('now'))
     ON CONFLICT(name) DO UPDATE SET
       rights_json = excluded.rights_json,
       notes = excluded.notes,
       updated_at = datetime('now')`,
    [n, JSON.stringify(clean), notes]
  );
  return listDepartments().find((d) => d.name === n)!;
}

export function deleteDepartmentConfig(name: string): boolean {
  const n = normDepartmentName(name);
  if (!n) return false;
  const before = get('SELECT name FROM staff_departments WHERE name = ?', [n]);
  if (!before) return false;
  run('DELETE FROM staff_departments WHERE name = ?', [n]);
  return true;
}

/** Права сотрудника с учётом overlay отдела (админ — без overlay). */
export function effectiveRightsForStaff(row: {
  role?: unknown;
  rights_json?: unknown;
  department?: unknown;
}): StaffRights {
  const role = String(row.role || 'none');
  const base = parseRights(String(row.rights_json || ''), role);
  if (role === 'admin') return base;
  const dept = normDepartmentName(String(row.department || ''));
  if (!dept) return base;
  return applyDeptOverlay(base, getDeptOverlay(dept));
}

/** Админ / системный — любой раздел; иначе sections из rights. */
export function canAccessSection(
  actor: { role?: string; isSystemAdmin?: boolean; rights?: StaffRights } | null | undefined,
  section: string
): boolean {
  if (!actor) return true; // legacy cookie
  if (actor.isSystemAdmin || actor.role === 'admin') return true;
  const secs = actor.rights?.sections;
  if (!Array.isArray(secs) || secs.length === 0) return false;
  return secs.includes(section);
}

/** Экран сборщика /pick — отдельный флаг раздела pick. */
export function canAccessPickScreen(
  actor: { role?: string; isSystemAdmin?: boolean; rights?: StaffRights } | null | undefined
): boolean {
  return canAccessSection(actor, 'pick');
}

/**
 * Налоги / отчётность — админ, бухгалтер, либо can_tax + раздел tax.
 */
export function canUseTax(
  actor: {
    role?: string;
    isSystemAdmin?: boolean;
    rights?: StaffRights;
  } | null | undefined
): boolean {
  if (!actor) return false;
  if (actor.isSystemAdmin || actor.role === 'admin') return true;
  if (actor.role === 'accountant') return true;
  if (actor.rights?.can_tax) return true;
  return canAccessSection(actor, 'tax');
}

/** Зарплата и взносы — как can_tax, либо явное can_payroll. */
export function canUsePayroll(
  actor: {
    role?: string;
    isSystemAdmin?: boolean;
    rights?: StaffRights;
  } | null | undefined
): boolean {
  if (!actor) return false;
  if (actor.isSystemAdmin || actor.role === 'admin') return true;
  if (actor.role === 'accountant') return true;
  if (actor.rights?.can_payroll) return true;
  return canUseTax(actor);
}

/**
 * Инструмент прайсов/корзин закупок — строго админ, роль purchaser
 * или отдел с «закуп» в названии (+ раздел purchases).
 */
export function canUsePurchaseIntake(
  actor: {
    role?: string;
    isSystemAdmin?: boolean;
    department?: string;
    rights?: StaffRights;
  } | null | undefined
): boolean {
  if (!actor) return false;
  if (actor.isSystemAdmin || actor.role === 'admin') return true;
  if (actor.role === 'purchaser') return true;
  const dept = String(actor.department || '').toLowerCase();
  if (dept.includes('закуп') && canAccessSection(actor, 'purchases')) return true;
  return false;
}

/** Экран фотографа /photo — роль photographer/admin + раздел photo/media; warehouse/sto — совместимость. */
export function canAccessPhotoScreen(
  actor: { role?: string; isSystemAdmin?: boolean; rights?: StaffRights } | null | undefined
): boolean {
  if (!actor) return true;
  if (actor.isSystemAdmin || actor.role === 'admin' || actor.role === 'manager') {
    return true;
  }
  if (['photographer', 'warehouse', 'sto'].includes(String(actor.role || ''))) {
    return true;
  }
  return canAccessSection(actor, 'photo') || canAccessSection(actor, 'media');
}

export function staffMeta() {
  const total = get<{ c: number }>('SELECT COUNT(*) AS c FROM staff')?.c ?? 0;
  const amo = get<{ c: number }>(`SELECT COUNT(*) AS c FROM staff WHERE source LIKE '%amo%'`)?.c ?? 0;
  const oneC = get<{ c: number }>(`SELECT COUNT(*) AS c FROM staff WHERE source LIKE '%1c%'`)?.c ?? 0;
  const withLogin = get<{ c: number }>(`SELECT COUNT(*) AS c FROM staff WHERE can_login = 1`)?.c ?? 0;
  const last = get<{ value: string }>('SELECT value FROM meta WHERE key = ?', ['staff_synced_at'])?.value ?? null;
  return { total, amo, oneC, withLogin, lastSync: last };
}

/** Новые разделы матрицы (v4): добавляем по умолчанию роли, не забирая уже выданные. */
const SECTIONS_ADDED_V4: StaffSection[] = [
  'pick',
  'photo',
  'delivery',
  'media',
  'reports',
  'integrations',
];

/**
 * Идемпотентно: заполняет пустой rights_json по роли; аддитивно дописывает новые разделы v4.
 */
export function ensureStaffRoleDefaults(): { filled: number; migrated: number } {
  const rows = all<{ id: string; role: string; rights_json: string }>(
    'SELECT id, role, rights_json FROM staff'
  );
  let filled = 0;
  let migrated = 0;
  const ver = get<{ value: string }>('SELECT value FROM meta WHERE key = ?', [
    'staff_roles_version',
  ])?.value;
  const needV4 = !ver || Number(ver) < 4;
  const needV5 = !ver || Number(ver) < 5;
  const needV6 = !ver || Number(ver) < 6;
  const needV7 = !ver || Number(ver) < 7;
  const needV8 = !ver || Number(ver) < 8;
  const needV9 = !ver || Number(ver) < 9;

  for (const row of rows) {
    const role = isStaffRole(row.role) ? row.role : 'none';
    const raw = String(row.rights_json || '').trim();
    if (!raw || raw === '{}' || raw === 'null') {
      run('UPDATE staff SET role = ?, rights_json = ? WHERE id = ?', [
        role,
        JSON.stringify(rightsForRole(role)),
        row.id,
      ]);
      filled += 1;
      continue;
    }
    if (!needV4 && !needV5 && !needV6 && !needV7 && !needV8 && !needV9) continue;
    if (role === 'admin' && (needV4 || needV6 || needV7 || needV8)) {
      run('UPDATE staff SET rights_json = ? WHERE id = ?', [
        JSON.stringify(rightsForRole('admin')),
        row.id,
      ]);
      migrated += 1;
      continue;
    }
    // v9: закупщик — только home / purchases / help (без склада/CRM/компании)
    if (needV9 && role === 'purchaser') {
      run('UPDATE staff SET rights_json = ? WHERE id = ?', [
        JSON.stringify(rightsForRole('purchaser')),
        row.id,
      ]);
      migrated += 1;
      continue;
    }
    if (!needV4 && !needV5 && !needV6 && !needV7 && !needV8) continue;
    const rights = parseRights(raw, role);
    const roleSecs = new Set(rightsForRole(role).sections);
    const have = new Set(rights.sections);
    let changed = false;
    if (needV4) {
      for (const s of SECTIONS_ADDED_V4) {
        if (roleSecs.has(s) && !have.has(s)) {
          have.add(s);
          changed = true;
        }
      }
    }
    // v5: роль photographer + photo у кладовщика (совместимость /photo)
    if (needV5) {
      if (role === 'photographer') {
        for (const s of ['photo', 'media'] as const) {
          if (!have.has(s)) {
            have.add(s);
            changed = true;
          }
        }
      }
      if (role === 'warehouse' && !have.has('photo')) {
        have.add('photo');
        changed = true;
      }
    }
    // v6: экраны СТО /lift и /reception
    if (needV6) {
      if (role === 'sto' || role === 'manager') {
        for (const s of ['lift', 'reception', 'works'] as const) {
          if (roleSecs.has(s) && !have.has(s)) {
            have.add(s);
            changed = true;
          }
        }
      }
    }
    // v7: внутренние чаты сотрудников
    if (needV7 && roleSecs.has('chats') && !have.has('chats')) {
      have.add('chats');
      changed = true;
    }
    // v8: налоги и зарплата
    if (needV8) {
      if (roleSecs.has('tax') && !have.has('tax')) {
        have.add('tax');
        changed = true;
      }
      if (rights.can_tax === undefined && roleSecs.has('tax')) {
        rights.can_tax = true;
        changed = true;
      }
      if (rights.can_payroll === undefined && roleSecs.has('tax')) {
        rights.can_payroll = true;
        changed = true;
      }
    }
    if (changed) {
      rights.sections = [...have].filter((s) =>
        (STAFF_SECTIONS as readonly string[]).includes(s)
      );
      run('UPDATE staff SET rights_json = ? WHERE id = ?', [
        JSON.stringify(rights),
        row.id,
      ]);
      migrated += 1;
    }
  }
  run(
    `INSERT INTO meta (key, value) VALUES ('staff_roles_version', '9')
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`
  );
  return { filled, migrated };
}

export type AccessMatrixRow = {
  id: string;
  name: string;
  role: string;
  can_login: boolean;
  is_admin: boolean;
  sections: string[];
};

/** Снимок матрицы доступов для UI. */
export function accessMatrixSnapshot(): {
  sections: StaffSection[];
  section_labels: Record<string, string>;
  rows: AccessMatrixRow[];
} {
  const rows = all<Record<string, unknown>>(
    `SELECT id, name, role, rights_json, department, can_login
     FROM staff
     WHERE IFNULL(is_active,1) = 1
     ORDER BY name COLLATE NOCASE`
  );
  const mapped: AccessMatrixRow[] = rows.map((row) => {
    const role = String(row.role || 'none');
    const rights = effectiveRightsForStaff(row);
    const isAdmin = role === 'admin';
    return {
      id: String(row.id),
      name: String(row.name || ''),
      role,
      can_login: !!Number(row.can_login),
      is_admin: isAdmin,
      sections: isAdmin ? [...STAFF_SECTIONS] : [...rights.sections],
    };
  });
  mapped.sort((a, b) => {
    const ra = roleSortRank(a.role);
    const rb = roleSortRank(b.role);
    if (ra !== rb) return ra - rb;
    return a.name.localeCompare(b.name, 'ru');
  });
  return {
    sections: [...STAFF_SECTIONS],
    section_labels: { ...SECTION_LABELS },
    rows: mapped,
  };
}

/** Точечное изменение галочки раздела (админ всегда полный доступ). */
export function setStaffSectionAccess(
  staffId: string,
  section: string,
  allowed: boolean
): AccessMatrixRow {
  if (!(STAFF_SECTIONS as readonly string[]).includes(section)) {
    throw new Error('Неизвестный раздел');
  }
  const row = get<Record<string, unknown>>('SELECT * FROM staff WHERE id = ?', [staffId]);
  if (!row) throw new Error('Сотрудник не найден');
  const role = String(row.role || 'none');
  if (role === 'admin') {
    return {
      id: String(row.id),
      name: String(row.name || ''),
      role,
      can_login: !!Number(row.can_login),
      is_admin: true,
      sections: [...STAFF_SECTIONS],
    };
  }
  const rights = parseRights(String(row.rights_json || ''), role);
  const set = new Set(rights.sections);
  if (allowed) set.add(section);
  else set.delete(section);
  rights.sections = [...set].filter((s) => (STAFF_SECTIONS as readonly string[]).includes(s));
  run('UPDATE staff SET rights_json = ? WHERE id = ?', [JSON.stringify(rights), staffId]);
  const after = get<Record<string, unknown>>('SELECT * FROM staff WHERE id = ?', [staffId])!;
  const eff = effectiveRightsForStaff(after);
  return {
    id: String(after.id),
    name: String(after.name || ''),
    role: String(after.role || 'none'),
    can_login: !!Number(after.can_login),
    is_admin: false,
    sections: [...eff.sections],
  };
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

  try {
    saveAmoUserDirectory(users);
  } catch {
    /* справочник имён — не блокируем синк */
  }

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
      let department = normDepartmentName(
        String(primaryRel?.department || dept || '').trim()
      );

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
      if (isNew || !isStaffRole(role)) {
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

      // Не плодим в персонале «мёртвых» из 1С без Amo / роли — только линк к существующим.
      // Новые записи: Amo-ветка выше или ручное «Добавить сотрудника».
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

export type CreateStaffInput = {
  name: string;
  email?: string;
  login?: string;
  role?: string;
  can_login?: boolean;
  notes?: string;
  department?: string;
};

/** Ручное добавление сотрудника (не из Amo). */
export function createStaffManual(input: CreateStaffInput): Record<string, unknown> {
  const name = String(input.name || '').trim();
  if (!name) throw new Error('Укажите ФИО');
  const role: StaffRole = isStaffRole(input.role) ? input.role : 'readonly';
  const email = String(input.email || '').trim().toLowerCase();
  const login = String(input.login || '').trim() || (email ? email.split('@')[0]! : '');
  const department = normDepartmentName(input.department).slice(0, 120);
  const notes = String(input.notes || '').trim().slice(0, 500);
  const canLogin = input.can_login === false ? 0 : role === 'none' ? 0 : 1;
  const rights = rightsForRole(role);
  const id = newGuid();

  if (email) {
    const clash = get('SELECT id FROM staff WHERE lower(email) = ?', [email]);
    if (clash) throw new Error('Email уже есть в персонале');
  }
  if (login) {
    const clash = get('SELECT id FROM staff WHERE lower(login) = lower(?)', [login]);
    if (clash) throw new Error('Логин занят');
  }

  run(
    `INSERT INTO staff (
      id, amo_id, email, name, is_active, group_id,
      one_c_guid, one_c_code, one_c_name, department,
      auth_login, sto_location, is_admin_amo,
      role, rights_json, can_login, source, notes, login, synced_at
    ) VALUES (?, '', ?, ?, 1, '', '', '', '', ?, '', '', 0, ?, ?, ?, 'manual', ?, ?, datetime('now'))`,
    [id, email, name, department, role, JSON.stringify(rights), canLogin, notes, login]
  );

  return get<Record<string, unknown>>('SELECT * FROM staff WHERE id = ?', [id])!;
}
