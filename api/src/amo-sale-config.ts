/**
 * Конфиг полей/селектов AmoCRM и сценариев чеков/доков
 * (структура как на листе «Правила чеки/доки Amo»).
 *
 * Значения селектов зафиксированы здесь — изменение в Amo
 * детектится и пишется уведомление в Учёт №1.
 */
import { all, get, run } from './db.js';
import { newGuid } from './ids.js';

const META_CFG = 'amo_sale_rules_config';
const META_ALERTS = 'amo_integration_alerts';

export type AmoFieldEntity = 'company' | 'lead' | 'uchet';

export type AmoFieldDef = {
  id: string;
  entity: AmoFieldEntity;
  name: string;
  type: string;
  /** Ожидаемые значения селекта/чекбокса (как в Amo). Пусто = не проверяем enum. */
  values: string[];
  effect: string;
  /** Колонка crm_deals / counterparties для сверки */
  deal_column?: string;
};

export type AmoBuyerRoleDef = {
  role: string;
  how: string;
  note: string;
};

export type AmoScenarioDef = {
  n: number;
  who: string;
  channel: string;
  pay_type: string;
  pay_method: string;
  shipment: string;
  fiscal: string;
  when: string;
  docs: string;
  stock: string;
  enabled: boolean;
};

export type AmoSaleRulesConfig = {
  updated_at: string;
  /** Запрет «тихих» изменений: при дрейфе — уведомление */
  lock_fields: boolean;
  fields: AmoFieldDef[];
  buyer_roles: AmoBuyerRoleDef[];
  scenarios: AmoScenarioDef[];
};

export type AmoIntegrationAlert = {
  id: string;
  at: string;
  severity: 'warn' | 'error';
  title: string;
  detail: string;
  field_id?: string;
  field_name?: string;
  seen: boolean;
};

function defaults(): AmoSaleRulesConfig {
  return {
    updated_at: '',
    lock_fields: true,
    fields: [
      {
        id: '820517',
        entity: 'company',
        name: 'ИНН',
        type: 'text',
        values: [],
        effect: 'Юр / ИП; реквизиты; УПД',
        deal_column: 'buyer_inn',
      },
      {
        id: '862897',
        entity: 'company',
        name: 'Партнёр',
        type: 'checkbox',
        values: ['да', 'нет'],
        effect: 'Партнёр=да → кредит/отсрочка; нет → обычный клиент',
        deal_column: 'is_partner',
      },
      {
        id: '—',
        entity: 'uchet',
        name: 'Партнёр (Учёт №1)',
        type: 'да / нет',
        values: ['Нет', 'Да'],
        effect: 'Тот же признак в контрагенте',
        deal_column: 'is_partner',
      },
      {
        id: '858983',
        entity: 'lead',
        name: 'Канал реализации',
        type: 'select',
        values: ['Автосервис', 'Самовывоз', 'Отправка'],
        effect: 'СТО/выдача/отправка; 1 или 2 чека у физ',
        deal_column: 'amo_channel',
      },
      {
        id: '860300',
        entity: 'lead',
        name: 'Тип оплаты',
        type: 'select',
        values: ['Предоплата', 'Постоплата'],
        effect: 'prepay / postpay; момент чека',
        deal_column: 'amo_payment_type',
      },
      {
        id: '816975',
        entity: 'lead',
        name: 'Способ оплаты',
        type: 'select',
        values: [
          'Отсрочка',
          'Наличка',
          'Карта',
          'Р/с',
          'Расчётный счёт',
          'Терминал',
          'СДЭК Наложка',
          'QR',
          'СБП',
        ],
        effect: 'р/с·отсрочка=без АТОЛ; карта/QR=чек; наложка=оплата при получении',
        deal_column: 'amo_pay_method',
      },
      {
        id: '860492',
        entity: 'lead',
        name: 'Способ отправки',
        type: 'select',
        values: [
          'СДЭК наложка',
          'ТК СДЭК',
          'Автобус',
          'Курьер',
          'Прочие ТК',
          'Самовывоз',
        ],
        effect: 'канал склада; наложка без предоплаты',
        deal_column: 'amo_shipment',
      },
      {
        id: '853005',
        entity: 'lead',
        name: 'СТО',
        type: 'select',
        values: [
          'Стрела Фогель',
          'Стрела Подвеска',
          'Фадеева',
          'Можайское',
          'Научный',
        ],
        effect: 'признак СТО → заказ-наряд',
        deal_column: 'amo_sto',
      },
    ],
    buyer_roles: [
      {
        role: 'Партнёр',
        how: 'Галочка «Партнёр» (862897) или воронка «Партнеры…»',
        note: 'Может брать в кредит / отсрочку',
      },
      {
        role: 'Юрлицо',
        how: 'Компания в сделке или ИНН 10 цифр',
        note: 'Обычно счёт + УПД',
      },
      {
        role: 'ИП',
        how: 'ИНН 12 цифр',
        note: 'Как юр по документам; чек — если карта/QR',
      },
      {
        role: 'Физлицо',
        how: 'Нет компании, нет ИНН юр/ИП',
        note: 'Касса АТОЛ по каналу и типу оплаты',
      },
    ],
    scenarios: [
      {
        n: 1,
        who: 'Партнёр',
        channel: 'любой',
        pay_type: 'Постоплата / —',
        pay_method: 'Отсрочка / р/с',
        shipment: 'любой',
        fiscal: '0 — без чека',
        when: '—',
        docs: 'Счёт + УПД (+ ЗН если СТО)',
        stock: 'ДА (кредит)',
        enabled: true,
      },
      {
        n: 12,
        who: 'Физлицо',
        channel: 'Отправка',
        pay_type: 'Предоплата',
        pay_method: 'Карта / QR / СБП',
        shipment: 'ТК СДЭК',
        fiscal: '2 чека',
        when: '1 — после оплаты; 2 — при отгрузке',
        docs: 'Счёт (физлицо)',
        stock: 'НЕТ — нужна оплата',
        enabled: true,
      },
      {
        n: 17,
        who: 'Физлицо',
        channel: 'Автосервис',
        pay_type: '—',
        pay_method: 'Карта / нал / QR',
        shipment: '—',
        fiscal: '1 чек',
        when: 'При выдаче на СТО',
        docs: 'Заказ-наряд',
        stock: 'ДА · «Принято налом»',
        enabled: true,
      },
      {
        n: 14,
        who: 'Физлицо',
        channel: 'Отправка',
        pay_type: 'Постоплата',
        pay_method: 'СДЭК Наложка',
        shipment: 'СДЭК наложка',
        fiscal: '1 чек',
        when: 'При получен/вручен (статус СДЭК)',
        docs: 'Счёт',
        stock: 'ДА (оплата при получении)',
        enabled: true,
      },
    ],
  };
}

function readJson<T>(key: string): T | null {
  const row = get<{ value: string }>('SELECT value FROM meta WHERE key = ?', [key]);
  if (!row?.value) return null;
  try {
    return JSON.parse(row.value) as T;
  } catch {
    return null;
  }
}

function writeJson(key: string, value: unknown): void {
  run('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)', [key, JSON.stringify(value)]);
}

function normVal(v: unknown): string {
  return String(v ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

export function getAmoSaleRulesConfig(): AmoSaleRulesConfig {
  const stored = readJson<Partial<AmoSaleRulesConfig>>(META_CFG);
  const base = defaults();
  if (!stored || typeof stored !== 'object') return base;
  return {
    updated_at: String(stored.updated_at || ''),
    lock_fields: stored.lock_fields !== false,
    fields: Array.isArray(stored.fields) && stored.fields.length ? stored.fields : base.fields,
    buyer_roles:
      Array.isArray(stored.buyer_roles) && stored.buyer_roles.length
        ? stored.buyer_roles
        : base.buyer_roles,
    scenarios:
      Array.isArray(stored.scenarios) && stored.scenarios.length
        ? stored.scenarios
        : base.scenarios,
  };
}

export function saveAmoSaleRulesConfig(
  patch: Partial<AmoSaleRulesConfig>
): AmoSaleRulesConfig {
  const cur = getAmoSaleRulesConfig();
  const next: AmoSaleRulesConfig = {
    updated_at: new Date().toISOString(),
    lock_fields: patch.lock_fields !== undefined ? Boolean(patch.lock_fields) : cur.lock_fields,
    fields: Array.isArray(patch.fields) ? patch.fields : cur.fields,
    buyer_roles: Array.isArray(patch.buyer_roles) ? patch.buyer_roles : cur.buyer_roles,
    scenarios: Array.isArray(patch.scenarios) ? patch.scenarios : cur.scenarios,
  };
  writeJson(META_CFG, next);
  return next;
}

export function listAmoIntegrationAlerts(opts?: { includeSeen?: boolean }): AmoIntegrationAlert[] {
  const allAlerts = readJson<AmoIntegrationAlert[]>(META_ALERTS) || [];
  if (opts?.includeSeen) return allAlerts;
  return allAlerts.filter((a) => !a.seen);
}

function pushAlert(alert: Omit<AmoIntegrationAlert, 'id' | 'at' | 'seen'>): AmoIntegrationAlert {
  const list = readJson<AmoIntegrationAlert[]>(META_ALERTS) || [];
  // дедуп по title+detail за сутки
  const dayAgo = Date.now() - 24 * 3600 * 1000;
  const dup = list.find(
    (a) =>
      a.title === alert.title &&
      a.detail === alert.detail &&
      Date.parse(a.at) > dayAgo &&
      !a.seen
  );
  if (dup) return dup;
  const row: AmoIntegrationAlert = {
    id: newGuid(),
    at: new Date().toISOString(),
    seen: false,
    ...alert,
  };
  list.unshift(row);
  writeJson(META_ALERTS, list.slice(0, 200));
  try {
    run(
      `INSERT INTO crm_events (id, kind, title, deal_id, counterparty_id, event_at, comment)
       VALUES (?, 'amo_integration', ?, NULL, NULL, ?, ?)`,
      [row.id, row.title, row.at, row.detail]
    );
  } catch {
    /* ignore if table missing */
  }
  return row;
}

export function markAmoIntegrationAlertSeen(id: string): void {
  const list = readJson<AmoIntegrationAlert[]>(META_ALERTS) || [];
  const next = list.map((a) => (a.id === id ? { ...a, seen: true } : a));
  writeJson(META_ALERTS, next);
}

export function markAllAmoIntegrationAlertsSeen(): void {
  const list = readJson<AmoIntegrationAlert[]>(META_ALERTS) || [];
  writeJson(
    META_ALERTS,
    list.map((a) => ({ ...a, seen: true }))
  );
}

/** Сверка фактических значений в сделках с зафиксированными селектами. */
export function checkAmoSaleConfigDrift(): {
  ok: boolean;
  checked_at: string;
  issues: Array<{
    field_id: string;
    field_name: string;
    column: string;
    unexpected: string[];
  }>;
  alerts: AmoIntegrationAlert[];
} {
  const cfg = getAmoSaleRulesConfig();
  const issues: Array<{
    field_id: string;
    field_name: string;
    column: string;
    unexpected: string[];
  }> = [];
  const newAlerts: AmoIntegrationAlert[] = [];

  if (!cfg.lock_fields) {
    return { ok: true, checked_at: new Date().toISOString(), issues: [], alerts: [] };
  }

  for (const f of cfg.fields) {
    if (!f.deal_column || !f.values?.length) continue;
    if (f.entity === 'uchet') continue;
    const col = String(f.deal_column).replace(/[^a-z0-9_]/gi, '');
    if (!col) continue;
    let rows: Array<{ v: string }> = [];
    try {
      rows = all<{ v: string }>(
        `SELECT DISTINCT TRIM(IFNULL(${col},'')) AS v FROM crm_deals
         WHERE TRIM(IFNULL(${col},'')) != ''
         LIMIT 200`
      );
    } catch {
      continue;
    }
    const expected = new Set(f.values.map(normVal));
    // допускаем подстрочные совпадения для «Р/с» ≈ «Расчётный счёт» и т.п. —
    // строгое: значение должно совпасть с одним из expected после norm,
    // либо expected содержит короткое слово внутри значения
    const unexpected: string[] = [];
    for (const r of rows) {
      const raw = String(r.v || '').trim();
      if (!raw) continue;
      const n = normVal(raw);
      let ok = expected.has(n);
      if (!ok) {
        for (const exp of expected) {
          if (n.includes(exp) || exp.includes(n)) {
            ok = true;
            break;
          }
        }
      }
      // числовые/id без текста — не считаем дрейфом enum
      if (!ok && /^[\d.]+$/.test(raw)) ok = true;
      if (!ok) unexpected.push(raw);
    }
    if (unexpected.length) {
      const uniq = [...new Set(unexpected)].slice(0, 20);
      issues.push({
        field_id: f.id,
        field_name: f.name,
        column: col,
        unexpected: uniq,
      });
      if (cfg.lock_fields) {
        const alert = pushAlert({
          severity: 'warn',
          title: `Изменилась интеграция AmoCRM: поле «${f.name}»`,
          detail:
            `В сделках появились значения вне зафиксированного списка (${f.id}): ` +
            uniq.join(', ') +
            `. Не меняйте селекты в Amo — поправьте значение сделки или обновите список в Настройки → AmoCRM → Правила.`,
          field_id: f.id,
          field_name: f.name,
        });
        newAlerts.push(alert);
      }
    }
  }

  return {
    ok: issues.length === 0,
    checked_at: new Date().toISOString(),
    issues,
    alerts: newAlerts,
  };
}

export function amoSaleRulesPublic() {
  const cfg = getAmoSaleRulesConfig();
  const alerts = listAmoIntegrationAlerts({ includeSeen: false });
  return {
    config: cfg,
    alerts,
    alerts_count: alerts.length,
    sheet_url:
      'https://docs.google.com/spreadsheets/d/1T2FEXnWBeFhfKI-Y7_8tVfWFxFDRwTdZtPHH_NeCfn4/edit#gid=678893116',
    note:
      'Структура как на листе «Правила чеки/доки Amo». Селекты зафиксированы: правки в Amo → уведомление в Учёте №1.',
  };
}

/** Field id map for exporters / sync (lead/company CF). */
export function amoFieldIdMap(): Record<string, string> {
  const cfg = getAmoSaleRulesConfig();
  const byName: Record<string, string> = {};
  for (const f of cfg.fields) {
    if (!f.id || f.id === '—') continue;
    const key = normVal(f.name)
      .replace(/ё/g, 'е')
      .replace(/[^a-zа-я0-9]+/gi, '_');
    byName[key] = f.id;
    if (/инн/.test(key)) byName.inn = f.id;
    if (/партнер/.test(key)) byName.partner = f.id;
    if (/канал/.test(key)) byName.channel = f.id;
    if (/тип_оплат/.test(key)) byName.payment_type = f.id;
    if (/способ_оплат/.test(key)) byName.pay_method = f.id;
    if (/способ_отправ/.test(key)) byName.shipment = f.id;
    if (key === 'сто' || /^сто_/.test(key)) byName.sto = f.id;
  }
  return byName;
}
