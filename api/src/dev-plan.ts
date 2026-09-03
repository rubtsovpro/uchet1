/**
 * План разработки: работы, даты, ответственный из staff, ограничения, Гант, комментарии.
 */
import { all, get, run } from './db.js';
import { newGuid } from './ids.js';

export type DevPlanComment = {
  id: string;
  item_id: string;
  kind: string;
  body: string;
  old_start: string;
  old_end: string;
  new_start: string;
  new_end: string;
  author_staff_id: string;
  author_name: string;
  created_at: string;
};

export type DevPlanItem = {
  id: string;
  block_key: string;
  block_title: string;
  block_sort: number;
  title: string;
  description: string;
  result_plan: string;
  result_fact: string;
  constraint_text: string;
  start_date: string;
  end_date: string;
  responsible_staff_id: string;
  responsible_name: string;
  status: string;
  sort_order: number;
  comments: DevPlanComment[];
  created_at: string;
  updated_at: string;
};

const SEED_VER_KEY = 'dev_plan_seed_ver';
const SEED_VER = 'sales-v1';
const BLOCK_SALES = { key: 'sales', title: 'Продажи', sort: 10 };

export function ensureDevPlanSchema(): void {
  run(`
    CREATE TABLE IF NOT EXISTS dev_plan_items (
      id TEXT PRIMARY KEY,
      block_key TEXT NOT NULL DEFAULT 'sales',
      block_title TEXT NOT NULL DEFAULT 'Продажи',
      block_sort INTEGER NOT NULL DEFAULT 10,
      title TEXT NOT NULL DEFAULT '',
      description TEXT NOT NULL DEFAULT '',
      result_plan TEXT NOT NULL DEFAULT '',
      result_fact TEXT NOT NULL DEFAULT '',
      constraint_text TEXT NOT NULL DEFAULT '',
      start_date TEXT NOT NULL DEFAULT '',
      end_date TEXT NOT NULL DEFAULT '',
      responsible_staff_id TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'planned',
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  const cols = all<{ name: string }>(`PRAGMA table_info(dev_plan_items)`).map((c) => c.name);
  if (!cols.includes('block_key')) {
    run(`ALTER TABLE dev_plan_items ADD COLUMN block_key TEXT NOT NULL DEFAULT 'sales'`);
  }
  if (!cols.includes('block_title')) {
    run(`ALTER TABLE dev_plan_items ADD COLUMN block_title TEXT NOT NULL DEFAULT 'Продажи'`);
  }
  if (!cols.includes('block_sort')) {
    run(`ALTER TABLE dev_plan_items ADD COLUMN block_sort INTEGER NOT NULL DEFAULT 10`);
  }
  run(`CREATE INDEX IF NOT EXISTS idx_dev_plan_dates ON dev_plan_items(start_date, end_date)`);
  run(`CREATE INDEX IF NOT EXISTS idx_dev_plan_staff ON dev_plan_items(responsible_staff_id)`);
  run(`CREATE INDEX IF NOT EXISTS idx_dev_plan_block ON dev_plan_items(block_sort, sort_order)`);
  run(`
    CREATE TABLE IF NOT EXISTS dev_plan_comments (
      id TEXT PRIMARY KEY,
      item_id TEXT NOT NULL,
      kind TEXT NOT NULL DEFAULT 'note',
      body TEXT NOT NULL DEFAULT '',
      old_start TEXT NOT NULL DEFAULT '',
      old_end TEXT NOT NULL DEFAULT '',
      new_start TEXT NOT NULL DEFAULT '',
      new_end TEXT NOT NULL DEFAULT '',
      author_staff_id TEXT NOT NULL DEFAULT '',
      author_name TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  run(`CREATE INDEX IF NOT EXISTS idx_dev_plan_comments_item ON dev_plan_comments(item_id, created_at)`);
  run(`
    CREATE TABLE IF NOT EXISTS dev_plan_deps (
      id TEXT PRIMARY KEY,
      item_id TEXT NOT NULL,
      depends_on_id TEXT NOT NULL,
      note TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(item_id, depends_on_id)
    )
  `);
  run(`CREATE INDEX IF NOT EXISTS idx_dev_plan_deps_item ON dev_plan_deps(item_id)`);
  run(`CREATE INDEX IF NOT EXISTS idx_dev_plan_deps_on ON dev_plan_deps(depends_on_id)`);
  seedDevPlanSalesBlock();
  seedDevPlanSalesDeps();
}

function defaultResponsibleStaffId(): string {
  return (
    get<{ id: string }>(
      `SELECT id FROM staff
       WHERE IFNULL(is_active,1)=1
         AND (
           lower(IFNULL(name,'')) LIKE '%рубцов%'
           OR lower(IFNULL(auth_login,'')) LIKE '%rubtsov%'
           OR role = 'admin'
         )
       ORDER BY CASE WHEN role = 'admin' THEN 0 ELSE 1 END, name
       LIMIT 1`
    )?.id || ''
  );
}

/** Полная замена старого сида: первый блок — Продажи. */
function seedDevPlanSalesBlock(): void {
  const ver = get<{ value: string }>('SELECT value FROM meta WHERE key = ?', [SEED_VER_KEY])?.value;
  if (ver === SEED_VER) return;

  run(`DELETE FROM dev_plan_comments`);
  run(`DELETE FROM dev_plan_items`);

  const rubtsov = defaultResponsibleStaffId();
  const B = BLOCK_SALES;

  const rows: Array<{
    title: string;
    description: string;
    result_plan: string;
    constraint_text: string;
    start_date: string;
    end_date: string;
    sort_order: number;
  }> = [
    {
      title: 'Чеки АТОЛ (физлицо)',
      description:
        'Предоплата и полный расчёт; сценарий двух чеков; контроль ОФД; без чека при юрлице.',
      result_plan: 'На прогоне физлица уходят корректные чеки; юрлицо без лишних чеков.',
      constraint_text: 'Ключи АТОЛ/ОФД; тестовая касса.',
      start_date: '2026-08-07',
      end_date: '2026-08-14',
      sort_order: 10,
    },
    {
      title: 'Обучение менеджеров продажам',
      description:
        'Сценарии в Учёте №1: сделка → счёт → оплата → документы / чеки / выдача / СДЭК / СТО.',
      result_plan: 'Менеджеры проходят чек-лист самостоятельно на тестовых заказах.',
      constraint_text: 'Доступы менеджеров; тестовые сделки и остаток.',
      start_date: '2026-08-07',
      end_date: '2026-08-18',
      sort_order: 20,
    },
    {
      title: 'Документы продажи (юрлицо)',
      description: 'Счёт, УПД, счёт-фактура, расходная; печать PDF; когда документ не выдаётся.',
      result_plan: 'Комплект документов печатается и понятен менеджеру.',
      constraint_text: 'Реквизиты организации; тестовое юрлицо.',
      start_date: '2026-08-07',
      end_date: '2026-08-14',
      sort_order: 30,
    },
    {
      title: 'СТО: заказ-наряд и договор ТО',
      description:
        'ЗН как документ продаж: авто, работы, запчасти, статусы; связка с договором ТО.',
      result_plan: 'Прогон ЗН от приёмки до закрытия с документами.',
      constraint_text: 'Справочник работ СТО; тестовое авто.',
      start_date: '2026-08-11',
      end_date: '2026-08-20',
      sort_order: 40,
    },
    {
      title: 'Перемещения под продажу',
      description:
        'Перемещение между складами/филиалами под отгрузку и самовывоз; остатки после перемещения.',
      result_plan: 'Товар оказывается на нужном складе до выдачи/отправки.',
      constraint_text: 'Два склада/филиала; права на перемещения.',
      start_date: '2026-08-11',
      end_date: '2026-08-18',
      sort_order: 50,
    },
    {
      title: 'СДЭК из заказа',
      description:
        'Оформление отправки из продажи: адрес, вес/габариты, трек, статусы доставки.',
      result_plan: 'Заказ уходит в СДЭК без ручного дубля в личном кабинете.',
      constraint_text: 'Ключи СДЭК; тестовый ПВЗ/адрес.',
      start_date: '2026-08-14',
      end_date: '2026-08-22',
      sort_order: 60,
    },
    {
      title: 'Оплата по ссылке / СБП',
      description: 'Ссылка из счёта; поступление → статус оплаты → дальше склад/документы/чеки.',
      result_plan: 'Оплата по ссылке закрывает счёт и запускает следующий шаг.',
      constraint_text: 'Ключи Точка/СБП; тестовые платежи.',
      start_date: '2026-08-14',
      end_date: '2026-08-21',
      sort_order: 70,
    },
    {
      title: 'Канал реализации',
      description: 'Самовывоз / отправка / СТО — единый канал без дубля в UI; влияние на склад.',
      result_plan: 'Канал выбирается один раз и доходит до склада/СДЭК/СТО.',
      constraint_text: 'Маппинг каналов; тестовые сделки по каждому каналу.',
      start_date: '2026-08-18',
      end_date: '2026-08-25',
      sort_order: 80,
    },
    {
      title: 'Резерв остатков под счёт',
      description: 'Резерв при выставлении счёта; снятие при оплате/отмене/истечении.',
      result_plan: 'Остаток и резерв сходятся на прогонах.',
      constraint_text: 'Товар с остатком; сценарии отмены счёта.',
      start_date: '2026-08-18',
      end_date: '2026-08-25',
      sort_order: 90,
    },
    {
      title: 'Сквозной прогон продаж',
      description:
        'CRM → счёт → оплата → документы/чеки → перемещение при необходимости → выдача или СДЭК или СТО.',
      result_plan: '3–5 живых/тестовых заказов по каналам без офисного «костыля».',
      constraint_text: 'Готовые подсистемы выше; остаток и доступы.',
      start_date: '2026-08-25',
      end_date: '2026-08-31',
      sort_order: 100,
    },
    {
      title: 'Возвраты продаж',
      description: 'Возврат товара; чек возврата для физлица; корректирующие документы для юрлица.',
      result_plan: 'Возврат отражается в остатках и документах/чеках.',
      constraint_text: 'Закрытые тестовые продажи для возврата.',
      start_date: '2026-08-25',
      end_date: '2026-08-31',
      sort_order: 110,
    },
  ];

  for (const r of rows) {
    run(
      `INSERT INTO dev_plan_items (
         id, block_key, block_title, block_sort,
         title, description, result_plan, result_fact, constraint_text,
         start_date, end_date, responsible_staff_id, status, sort_order
       ) VALUES (?, ?, ?, ?, ?, ?, ?, '', ?, ?, ?, ?, 'planned', ?)`,
      [
        newGuid(),
        B.key,
        B.title,
        B.sort,
        r.title,
        r.description,
        r.result_plan,
        r.constraint_text,
        r.start_date,
        r.end_date,
        rubtsov,
        r.sort_order,
      ]
    );
  }

  run(`INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)`, [SEED_VER_KEY, SEED_VER]);
}

const DEPS_SEED_VER_KEY = 'dev_plan_deps_seed_ver';
const DEPS_SEED_VER = 'sales-deps-v1';

/**
 * Стартовые связи «работа зависит от …» (1:1 / 1:N / N:1).
 * item зависит от depends_on (стрелка: prerequisite → dependent).
 */
function seedDevPlanSalesDeps(): void {
  const ver = get<{ value: string }>('SELECT value FROM meta WHERE key = ?', [DEPS_SEED_VER_KEY])
    ?.value;
  if (ver === DEPS_SEED_VER) return;

  const byTitle = new Map<string, string>();
  for (const r of all<{ id: string; title: string }>(
    `SELECT id, title FROM dev_plan_items WHERE block_key = 'sales'`
  )) {
    byTitle.set(String(r.title || '').trim(), String(r.id));
  }
  const idOf = (title: string) => byTitle.get(title) || '';

  /** [работа, зависит_от] */
  const pairs: Array<[string, string]> = [
    ['Обучение менеджеров продажам', 'Чеки АТОЛ (физлицо)'],
    ['Обучение менеджеров продажам', 'Документы продажи (юрлицо)'],
    ['СДЭК из заказа', 'Канал реализации'],
    ['СДЭК из заказа', 'Перемещения под продажу'],
    ['Перемещения под продажу', 'Канал реализации'],
    ['Резерв остатков под счёт', 'Документы продажи (юрлицо)'],
    ['Оплата по ссылке / СБП', 'Резерв остатков под счёт'],
    ['СТО: заказ-наряд и договор ТО', 'Документы продажи (юрлицо)'],
    ['Сквозной прогон продаж', 'Чеки АТОЛ (физлицо)'],
    ['Сквозной прогон продаж', 'Оплата по ссылке / СБП'],
    ['Сквозной прогон продаж', 'СДЭК из заказа'],
    ['Сквозной прогон продаж', 'СТО: заказ-наряд и договор ТО'],
    ['Сквозной прогон продаж', 'Перемещения под продажу'],
    ['Возвраты продаж', 'Сквозной прогон продаж'],
    ['Возвраты продаж', 'Чеки АТОЛ (физлицо)'],
  ];

  for (const [itemTitle, depTitle] of pairs) {
    const itemId = idOf(itemTitle);
    const dependsOnId = idOf(depTitle);
    if (!itemId || !dependsOnId || itemId === dependsOnId) continue;
    const exists = get(
      `SELECT id FROM dev_plan_deps WHERE item_id = ? AND depends_on_id = ?`,
      [itemId, dependsOnId]
    );
    if (exists) continue;
    run(
      `INSERT INTO dev_plan_deps (id, item_id, depends_on_id, note) VALUES (?, ?, ?, '')`,
      [newGuid(), itemId, dependsOnId]
    );
  }

  run(`INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)`, [
    DEPS_SEED_VER_KEY,
    DEPS_SEED_VER,
  ]);
}

export type DevPlanDep = {
  id: string;
  item_id: string;
  depends_on_id: string;
  note: string;
  item_title: string;
  depends_on_title: string;
  created_at: string;
};

export function listDevPlanDeps(): DevPlanDep[] {
  ensureDevPlanSchema();
  return all<{
    id: string;
    item_id: string;
    depends_on_id: string;
    note: string;
    item_title: string;
    depends_on_title: string;
    created_at: string;
  }>(
    `SELECT d.id, d.item_id, d.depends_on_id, IFNULL(d.note,'') AS note,
            IFNULL(a.title,'') AS item_title,
            IFNULL(b.title,'') AS depends_on_title,
            IFNULL(d.created_at,'') AS created_at
     FROM dev_plan_deps d
     LEFT JOIN dev_plan_items a ON a.id = d.item_id
     LEFT JOIN dev_plan_items b ON b.id = d.depends_on_id
     ORDER BY datetime(d.created_at) ASC, d.rowid ASC`
  ).map((r) => ({
    id: String(r.id || ''),
    item_id: String(r.item_id || ''),
    depends_on_id: String(r.depends_on_id || ''),
    note: String(r.note || ''),
    item_title: String(r.item_title || ''),
    depends_on_title: String(r.depends_on_title || ''),
    created_at: String(r.created_at || ''),
  }));
}

function wouldCreateCycle(itemId: string, dependsOnId: string): boolean {
  // item зависит от dependsOn — цикл, если dependsOn уже зависит (транзитивно) от item
  const kids = new Map<string, string[]>();
  for (const d of all<{ item_id: string; depends_on_id: string }>(
    `SELECT item_id, depends_on_id FROM dev_plan_deps`
  )) {
    const from = String(d.depends_on_id);
    const to = String(d.item_id);
    const list = kids.get(from) || [];
    list.push(to);
    kids.set(from, list);
  }
  const stack = [itemId];
  const seen = new Set<string>();
  while (stack.length) {
    const cur = stack.pop()!;
    if (cur === dependsOnId) return true;
    if (seen.has(cur)) continue;
    seen.add(cur);
    for (const n of kids.get(cur) || []) stack.push(n);
  }
  return false;
}

export function addDevPlanDep(input: {
  item_id: string;
  depends_on_id: string;
  note?: string;
}): DevPlanDep {
  ensureDevPlanSchema();
  const itemId = String(input.item_id || '').trim();
  const dependsOnId = String(input.depends_on_id || '').trim();
  const note = String(input.note || '').trim();
  if (!itemId || !dependsOnId) throw new Error('Укажите обе работы');
  if (itemId === dependsOnId) throw new Error('Работа не может зависеть от себя');
  const a = get('SELECT id FROM dev_plan_items WHERE id = ?', [itemId]);
  const b = get('SELECT id FROM dev_plan_items WHERE id = ?', [dependsOnId]);
  if (!a || !b) throw new Error('Работа не найдена');
  if (wouldCreateCycle(itemId, dependsOnId)) {
    throw new Error('Так получится цикл зависимостей');
  }
  const existing = get<{ id: string }>(
    `SELECT id FROM dev_plan_deps WHERE item_id = ? AND depends_on_id = ?`,
    [itemId, dependsOnId]
  );
  if (existing?.id) {
    const allDeps = listDevPlanDeps();
    const found = allDeps.find((d) => d.id === existing.id);
    if (found) return found;
  }
  const id = newGuid();
  run(`INSERT INTO dev_plan_deps (id, item_id, depends_on_id, note) VALUES (?, ?, ?, ?)`, [
    id,
    itemId,
    dependsOnId,
    note,
  ]);
  const row = listDevPlanDeps().find((d) => d.id === id);
  if (!row) throw new Error('Не удалось сохранить связь');
  return row;
}

export function deleteDevPlanDep(idRaw: string): { ok: true; id: string } {
  ensureDevPlanSchema();
  const id = String(idRaw || '').trim();
  const cur = get('SELECT id FROM dev_plan_deps WHERE id = ?', [id]);
  if (!cur) throw new Error('Связь не найдена');
  run(`DELETE FROM dev_plan_deps WHERE id = ?`, [id]);
  return { ok: true, id };
}

function staffNameMap(ids: string[]): Map<string, string> {
  const uniq = [...new Set(ids.map(String).filter(Boolean))];
  const map = new Map<string, string>();
  if (!uniq.length) return map;
  const ph = uniq.map(() => '?').join(',');
  const rows = all<{ id: string; name: string }>(
    `SELECT id, name FROM staff WHERE id IN (${ph})`,
    uniq
  );
  for (const r of rows) map.set(String(r.id), String(r.name || ''));
  return map;
}

function mapComment(r: Record<string, unknown>): DevPlanComment {
  return {
    id: String(r.id || ''),
    item_id: String(r.item_id || ''),
    kind: String(r.kind || 'note'),
    body: String(r.body || ''),
    old_start: String(r.old_start || ''),
    old_end: String(r.old_end || ''),
    new_start: String(r.new_start || ''),
    new_end: String(r.new_end || ''),
    author_staff_id: String(r.author_staff_id || ''),
    author_name: String(r.author_name || ''),
    created_at: String(r.created_at || ''),
  };
}

function listCommentsForItems(itemIds: string[]): Map<string, DevPlanComment[]> {
  const map = new Map<string, DevPlanComment[]>();
  const uniq = [...new Set(itemIds.map(String).filter(Boolean))];
  if (!uniq.length) return map;
  const ph = uniq.map(() => '?').join(',');
  const rows = all<Record<string, unknown>>(
    `SELECT * FROM dev_plan_comments
     WHERE item_id IN (${ph})
     ORDER BY datetime(created_at) ASC, rowid ASC`,
    uniq
  );
  for (const r of rows) {
    const c = mapComment(r);
    const list = map.get(c.item_id) || [];
    list.push(c);
    map.set(c.item_id, list);
  }
  return map;
}

export function listDevPlanStaffOptions(): Array<{ id: string; name: string; role: string }> {
  return all<{ id: string; name: string; role: string }>(
    `SELECT id, name, IFNULL(role,'') AS role FROM staff
     WHERE IFNULL(is_active,1)=1
     ORDER BY name COLLATE NOCASE`
  );
}

/** Сопоставить актора (в т.ч. системного админа) с id в staff. */
export function resolveDevPlanStaffIdForActor(actor: {
  id?: string;
  name?: string;
  login?: string;
} | null): string {
  if (!actor) return '';
  const aid = String(actor.id || '').trim();
  if (aid && aid !== '__admin__') {
    const row = get<{ id: string }>(
      `SELECT id FROM staff WHERE id = ? AND IFNULL(is_active,1)=1`,
      [aid]
    );
    if (row?.id) return String(row.id);
  }
  const name = String(actor.name || '').trim();
  if (name) {
    const byName = get<{ id: string }>(
      `SELECT id FROM staff WHERE name = ? AND IFNULL(is_active,1)=1 LIMIT 1`,
      [name]
    );
    if (byName?.id) return String(byName.id);
    const like = get<{ id: string }>(
      `SELECT id FROM staff WHERE name LIKE ? AND IFNULL(is_active,1)=1 LIMIT 1`,
      [`%${name.split(/\s+/)[0]}%`]
    );
    if (like?.id) return String(like.id);
  }
  const login = String(actor.login || '').trim();
  if (login) {
    const byLogin = get<{ id: string }>(
      `SELECT id FROM staff
       WHERE IFNULL(is_active,1)=1
         AND (lower(login)=lower(?) OR lower(auth_login)=lower(?) OR lower(email)=lower(?))
       LIMIT 1`,
      [login, login, login]
    );
    if (byLogin?.id) return String(byLogin.id);
  }
  return '';
}

/** Назначить одного ответственного на все работы плана. */
export function assignAllDevPlanResponsible(staffIdRaw: string): {
  updated: number;
  staff_id: string;
  staff_name: string;
} {
  ensureDevPlanSchema();
  const staffId = String(staffIdRaw || '').trim();
  if (!staffId) throw new Error('Укажите ответственного');
  const staff = get<{ id: string; name: string }>(
    `SELECT id, name FROM staff WHERE id = ? AND IFNULL(is_active,1)=1`,
    [staffId]
  );
  if (!staff) throw new Error('Сотрудник не найден');
  const before = get<{ c: number }>(`SELECT COUNT(*) AS c FROM dev_plan_items`)?.c || 0;
  run(
    `UPDATE dev_plan_items
     SET responsible_staff_id = ?, updated_at = datetime('now')`,
    [staffId]
  );
  return {
    updated: Number(before) || 0,
    staff_id: String(staff.id),
    staff_name: String(staff.name || ''),
  };
}

export function listDevPlanItems(): DevPlanItem[] {
  ensureDevPlanSchema();
  const rows = all<Record<string, unknown>>(
    `SELECT * FROM dev_plan_items
     ORDER BY block_sort ASC, sort_order ASC, datetime(start_date) ASC, title ASC`
  );
  const names = staffNameMap(rows.map((r) => String(r.responsible_staff_id || '')));
  const comments = listCommentsForItems(rows.map((r) => String(r.id || '')));
  return rows.map((r) => {
    const id = String(r.id || '');
    return {
      id,
      block_key: String(r.block_key || BLOCK_SALES.key),
      block_title: String(r.block_title || BLOCK_SALES.title),
      block_sort: Number(r.block_sort) || BLOCK_SALES.sort,
      title: String(r.title || ''),
      description: String(r.description || ''),
      result_plan: String(r.result_plan || ''),
      result_fact: String(r.result_fact || ''),
      constraint_text: String(r.constraint_text || ''),
      start_date: String(r.start_date || ''),
      end_date: String(r.end_date || ''),
      responsible_staff_id: String(r.responsible_staff_id || ''),
      responsible_name: names.get(String(r.responsible_staff_id || '')) || '',
      status: String(r.status || 'planned'),
      sort_order: Number(r.sort_order) || 0,
      comments: comments.get(id) || [],
      created_at: String(r.created_at || ''),
      updated_at: String(r.updated_at || ''),
    };
  });
}

function getDevPlanItem(id: string): DevPlanItem | null {
  return listDevPlanItems().find((x) => x.id === id) || null;
}

export function createDevPlanItem(input: {
  title: string;
  description?: string;
  result_plan?: string;
  result_fact?: string;
  constraint_text?: string;
  start_date?: string;
  end_date?: string;
  responsible_staff_id?: string;
  status?: string;
  sort_order?: number;
  block_key?: string;
  block_title?: string;
  block_sort?: number;
}): DevPlanItem {
  ensureDevPlanSchema();
  const title = String(input.title || '').trim();
  if (!title) throw new Error('Укажите название работы');
  const id = newGuid();
  const sort =
    input.sort_order != null && Number.isFinite(Number(input.sort_order))
      ? Math.floor(Number(input.sort_order))
      : (get<{ c: number }>('SELECT COALESCE(MAX(sort_order),0)+10 AS c FROM dev_plan_items')?.c ??
        10);
  const blockKey = String(input.block_key || BLOCK_SALES.key).trim() || BLOCK_SALES.key;
  const blockTitle = String(input.block_title || BLOCK_SALES.title).trim() || BLOCK_SALES.title;
  const blockSort =
    input.block_sort != null && Number.isFinite(Number(input.block_sort))
      ? Math.floor(Number(input.block_sort))
      : BLOCK_SALES.sort;
  run(
    `INSERT INTO dev_plan_items (
       id, block_key, block_title, block_sort,
       title, description, result_plan, result_fact, constraint_text,
       start_date, end_date, responsible_staff_id, status, sort_order
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      blockKey,
      blockTitle,
      blockSort,
      title,
      String(input.description || '').trim(),
      String(input.result_plan || '').trim(),
      String(input.result_fact || '').trim(),
      String(input.constraint_text || '').trim(),
      String(input.start_date || '').trim().slice(0, 10),
      String(input.end_date || '').trim().slice(0, 10),
      String(input.responsible_staff_id || '').trim(),
      String(input.status || 'planned').trim() || 'planned',
      sort,
    ]
  );
  const row = getDevPlanItem(id);
  if (!row) throw new Error('Не удалось создать работу');
  return row;
}

function insertComment(input: {
  item_id: string;
  kind: string;
  body: string;
  old_start?: string;
  old_end?: string;
  new_start?: string;
  new_end?: string;
  author_staff_id?: string;
  author_name?: string;
}): DevPlanComment {
  const id = newGuid();
  const body = String(input.body || '').trim();
  if (!body) throw new Error('Укажите текст комментария');
  run(
    `INSERT INTO dev_plan_comments (
       id, item_id, kind, body, old_start, old_end, new_start, new_end,
       author_staff_id, author_name
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      input.item_id,
      String(input.kind || 'note').trim() || 'note',
      body,
      String(input.old_start || '').trim().slice(0, 10),
      String(input.old_end || '').trim().slice(0, 10),
      String(input.new_start || '').trim().slice(0, 10),
      String(input.new_end || '').trim().slice(0, 10),
      String(input.author_staff_id || '').trim(),
      String(input.author_name || '').trim(),
    ]
  );
  const row = get<Record<string, unknown>>(`SELECT * FROM dev_plan_comments WHERE id = ?`, [id]);
  if (!row) throw new Error('Не удалось сохранить комментарий');
  return mapComment(row);
}

export function addDevPlanComment(
  itemIdRaw: string,
  input: {
    body: string;
    kind?: string;
    author_staff_id?: string;
    author_name?: string;
  }
): { item: DevPlanItem; comment: DevPlanComment } {
  ensureDevPlanSchema();
  const itemId = String(itemIdRaw || '').trim();
  const cur = get('SELECT id FROM dev_plan_items WHERE id = ?', [itemId]);
  if (!cur) throw new Error('Работа не найдена');
  const comment = insertComment({
    item_id: itemId,
    kind: input.kind || 'note',
    body: input.body,
    author_staff_id: input.author_staff_id,
    author_name: input.author_name,
  });
  run(`UPDATE dev_plan_items SET updated_at = datetime('now') WHERE id = ?`, [itemId]);
  const item = getDevPlanItem(itemId);
  if (!item) throw new Error('Работа не найдена');
  return { item, comment };
}

export function updateDevPlanItem(
  idRaw: string,
  patch: Partial<{
    title: string;
    description: string;
    result_plan: string;
    result_fact: string;
    constraint_text: string;
    start_date: string;
    end_date: string;
    responsible_staff_id: string;
    status: string;
    sort_order: number;
    block_key: string;
    block_title: string;
    block_sort: number;
    reschedule_reason: string;
  }>,
  author?: { id?: string; name?: string }
): DevPlanItem {
  ensureDevPlanSchema();
  const id = String(idRaw || '').trim();
  const cur = get<{
    id: string;
    start_date: string;
    end_date: string;
  }>('SELECT id, start_date, end_date FROM dev_plan_items WHERE id = ?', [id]);
  if (!cur) throw new Error('Работа не найдена');

  const oldStart = String(cur.start_date || '').trim().slice(0, 10);
  const oldEnd = String(cur.end_date || '').trim().slice(0, 10);
  const nextStart =
    patch.start_date !== undefined
      ? String(patch.start_date || '').trim().slice(0, 10)
      : oldStart;
  const nextEnd =
    patch.end_date !== undefined ? String(patch.end_date || '').trim().slice(0, 10) : oldEnd;
  const datesChanged = nextStart !== oldStart || nextEnd !== oldEnd;
  const reason = String(patch.reschedule_reason || '').trim();
  if (datesChanged && !reason) {
    throw new Error('Укажите причину переноса срока');
  }

  const sets: string[] = [];
  const params: Array<string | number> = [];
  const put = (col: string, val: string | number) => {
    sets.push(`${col} = ?`);
    params.push(val);
  };
  if (patch.title !== undefined) put('title', String(patch.title || '').trim());
  if (patch.description !== undefined) put('description', String(patch.description || '').trim());
  if (patch.result_plan !== undefined) put('result_plan', String(patch.result_plan || '').trim());
  if (patch.result_fact !== undefined) put('result_fact', String(patch.result_fact || '').trim());
  if (patch.constraint_text !== undefined)
    put('constraint_text', String(patch.constraint_text || '').trim());
  if (patch.start_date !== undefined) put('start_date', nextStart);
  if (patch.end_date !== undefined) put('end_date', nextEnd);
  if (patch.responsible_staff_id !== undefined)
    put('responsible_staff_id', String(patch.responsible_staff_id || '').trim());
  if (patch.status !== undefined)
    put('status', String(patch.status || 'planned').trim() || 'planned');
  if (patch.sort_order !== undefined && Number.isFinite(Number(patch.sort_order)))
    put('sort_order', Math.floor(Number(patch.sort_order)));
  if (patch.block_key !== undefined)
    put('block_key', String(patch.block_key || BLOCK_SALES.key).trim() || BLOCK_SALES.key);
  if (patch.block_title !== undefined)
    put('block_title', String(patch.block_title || BLOCK_SALES.title).trim() || BLOCK_SALES.title);
  if (patch.block_sort !== undefined && Number.isFinite(Number(patch.block_sort)))
    put('block_sort', Math.floor(Number(patch.block_sort)));
  if (!sets.length && !datesChanged) throw new Error('Нечего обновлять');
  if (sets.length) {
    sets.push(`updated_at = datetime('now')`);
    params.push(id);
    run(`UPDATE dev_plan_items SET ${sets.join(', ')} WHERE id = ?`, params);
  }

  if (datesChanged) {
    const from = `${oldStart || '—'}${oldEnd && oldEnd !== oldStart ? ' → ' + oldEnd : ''}`;
    const to = `${nextStart || '—'}${nextEnd && nextEnd !== nextStart ? ' → ' + nextEnd : ''}`;
    insertComment({
      item_id: id,
      kind: 'reschedule',
      body: `Перенос срока: ${from} → ${to}. ${reason}`,
      old_start: oldStart,
      old_end: oldEnd,
      new_start: nextStart,
      new_end: nextEnd,
      author_staff_id: author?.id,
      author_name: author?.name,
    });
    if (!sets.length) {
      run(`UPDATE dev_plan_items SET updated_at = datetime('now') WHERE id = ?`, [id]);
    }
  }

  const row = getDevPlanItem(id);
  if (!row) throw new Error('Работа не найдена');
  return row;
}

export function deleteDevPlanItem(idRaw: string): void {
  ensureDevPlanSchema();
  const id = String(idRaw || '').trim();
  if (!id) throw new Error('Не указан id');
  const cur = get('SELECT id FROM dev_plan_items WHERE id = ?', [id]);
  if (!cur) throw new Error('Работа не найдена');
  run(`DELETE FROM dev_plan_deps WHERE item_id = ? OR depends_on_id = ?`, [id, id]);
  run(`DELETE FROM dev_plan_comments WHERE item_id = ?`, [id]);
  run(`DELETE FROM dev_plan_items WHERE id = ?`, [id]);
}

/** Удалить все работы плана (комментарии и связи тоже). Сид не пересоздаёт — версия meta уже стоит. */
export function clearAllDevPlanItems(): { deleted: number } {
  ensureDevPlanSchema();
  const n = get<{ c: number }>(`SELECT COUNT(*) AS c FROM dev_plan_items`)?.c || 0;
  run(`DELETE FROM dev_plan_deps`);
  run(`DELETE FROM dev_plan_comments`);
  run(`DELETE FROM dev_plan_items`);
  return { deleted: n };
}

/** Диапазон дат для Ганта. */
export function devPlanGanttRange(items: DevPlanItem[]): {
  start: string;
  end: string;
  days: number;
} {
  let min = '';
  let max = '';
  for (const it of items) {
    const a = String(it.start_date || '').trim();
    const b = String(it.end_date || it.start_date || '').trim();
    if (a && (!min || a < min)) min = a;
    if (b && (!max || b > max)) max = b;
  }
  if (!min || !max) {
    const today = new Date().toISOString().slice(0, 10);
    return { start: today, end: today, days: 1 };
  }
  const t0 = Date.parse(min + 'T12:00:00Z');
  const t1 = Date.parse(max + 'T12:00:00Z');
  const days = Math.max(1, Math.round((t1 - t0) / 86400000) + 1);
  return { start: min, end: max, days };
}
