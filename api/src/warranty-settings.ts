/**
 * Гарантийные сроки (товары / услуги) — правятся в Настройки → Гарантии.
 * Подставляются в ЗН, оферту, HTML-печать и макросы {{Гарантия*}}.
 * Рулевые рейки — только ИП Безматерных М.П. (у Р.П. реек нет).
 */
import { get, run } from './db.js';
import { ORG_INN_FOGEL, orgLogoBrandByInn } from './org-logo.js';

const META_KEY = 'warranty_terms';

/** ИНН ИП Безматерных Михаил Павлович — рейки только у него. */
export const WARRANTY_SELLER_INN_MIKHAIL = ORG_INN_FOGEL;
/** ИНН ИП Безматерных Роман Павлович — без реек. */
export const WARRANTY_SELLER_INN_ROMAN = '231215603728';

export type WarrantyLine = {
  id: string;
  /** Подпись в таблице / списке */
  label: string;
  /** Срок как текст: «1 год», «7 календарных дней», «____» */
  term: string;
  group: 'goods' | 'services' | 'special' | 'exclusion';
  /** Пояснение под строкой (стойка, чужие ЗЧ…) */
  note?: string;
  /**
   * Если задано — строка попадает в документы только у этих ИНН продавца.
   * Пусто = все организации.
   */
  sellerInns?: string[];
};

export type WarrantySettings = {
  lines: WarrantyLine[];
  updated_at?: string;
};

export const WARRANTY_DEFAULTS: WarrantySettings = {
  lines: [
    {
      id: 'services',
      label: 'Выполненные работы (услуги)',
      term: '7 календарных дней',
      group: 'services',
    },
    {
      id: 'shock',
      label: 'Амортизаторы',
      term: '1 год',
      group: 'goods',
    },
    {
      id: 'compressor',
      label: 'Компрессоры',
      term: '1 год',
      group: 'goods',
    },
    {
      id: 'valve_block',
      label: 'Блоки клапанов',
      term: '1 год',
      group: 'goods',
    },
    {
      id: 'height_sensor',
      label: 'Датчики уровня кузова',
      term: '1 год',
      group: 'goods',
    },
    {
      id: 'air_spring',
      label: 'Пневмобаллоны',
      term: '2 года',
      group: 'goods',
    },
    {
      id: 'strut',
      label: 'Стойка в сборе (амортизатор + пневмобаллон)',
      term: 'на каждую составную часть отдельно',
      group: 'special',
      note: 'Гарантия на амортизатор и на пневмобаллон — по срокам соответствующих позиций выше.',
    },
    {
      id: 'steering_rack',
      label: 'Рулевые рейки',
      term: 'такси — 1 год; не такси — 2 года',
      group: 'goods',
      note:
        'В индивидуальных случаях гарантия не предоставляется либо устанавливается сокращённый срок — указывается в заказ-наряде / УПД. Только ИП Безматерных М.П.',
      sellerInns: [WARRANTY_SELLER_INN_MIKHAIL],
    },
    {
      id: 'client_parts',
      label: 'Запчасти и материалы Заказчика / стороннего поставщика (не Исполнителя)',
      term: 'гарантия производителя запчасти',
      group: 'exclusion',
      note: 'Исполнитель гарантию на такие запчасти не предоставляет и ответственности по ней не несёт.',
    },
  ],
};

function readRaw(): Partial<WarrantySettings> {
  const row = get<{ value: string }>('SELECT value FROM meta WHERE key = ?', [META_KEY]);
  if (!row?.value) return {};
  try {
    const parsed = JSON.parse(row.value) as Partial<WarrantySettings>;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function mergeLines(saved?: WarrantyLine[] | null): WarrantyLine[] {
  const byId = new Map((saved || []).filter((l) => l?.id).map((l) => [String(l.id), l]));
  return WARRANTY_DEFAULTS.lines.map((def) => {
    const s = byId.get(def.id);
    if (!s) {
      return { ...def, sellerInns: def.sellerInns ? [...def.sellerInns] : undefined };
    }
    return {
      ...def,
      label: String(s.label || def.label).trim() || def.label,
      term: s.term != null ? String(s.term).trim() : def.term,
      note: s.note != null ? String(s.note).trim() : def.note,
      group: s.group || def.group,
      // sellerInns всегда из defaults (не даём случайно «включить рейки» у Романа через UI)
      sellerInns: def.sellerInns ? [...def.sellerInns] : undefined,
    };
  });
}

export function normalizeSellerInn(inn?: string | null): string {
  return String(inn || '').replace(/\D/g, '');
}

/** Строка гарантии видна для данного ИНН продавца? */
export function warrantyLineAppliesToSeller(line: WarrantyLine, sellerInn?: string | null): boolean {
  const inns = line.sellerInns;
  if (!inns || !inns.length) return true;
  const dig = normalizeSellerInn(sellerInn);
  if (!dig) return false; // без продавца — узкие позиции (рейки) не подставляем
  return inns.some((i) => normalizeSellerInn(i) === dig);
}

export function warrantyLinesForSeller(sellerInn?: string | null): WarrantyLine[] {
  return getWarrantySettings().lines.filter((l) => warrantyLineAppliesToSeller(l, sellerInn));
}

/** Юр. формулировка по рейкам для оферты / договора (только М.П.). */
export function formatSteeringRackLegalClause(sellerInn?: string | null): string {
  const dig = normalizeSellerInn(sellerInn);
  if (dig && dig !== WARRANTY_SELLER_INN_MIKHAIL) return '';
  if (!dig) return '';
  return (
    'На рулевые рейки: для транспортных средств, используемых в качестве легкового такси, — 1 (один) год; ' +
    'для иных транспортных средств — 2 (два) года со дня передачи / выдачи АМТС, если иной срок не указан в заказ-наряде / УПД. ' +
    'В индивидуальных случаях по соглашению сторон гарантия на рулевые рейки не предоставляется либо устанавливается сокращённый срок — ' +
    'такой срок (или отсутствие гарантии) указывается в заказ-наряде / УПД.'
  );
}

/** Блок строк таблицы 10.7 по рейкам (или пусто у Романа). */
export function formatSteeringRackTableBlock(
  sellerInn?: string | null,
  startGoods = 'с даты выдачи АМТС'
): string {
  const line = warrantyLinesForSeller(sellerInn).find((l) => l.id === 'steering_rack');
  if (!line) return '';
  const term = String(line.term || '').trim() || '____';
  const note = line.note ? ` (${line.note})` : '';
  return `Рулевые рейки\n${term}${note}\n${startGoods}`;
}

export function getWarrantySettings(): WarrantySettings {
  const raw = readRaw();
  return {
    lines: mergeLines(raw.lines),
    updated_at: raw.updated_at,
  };
}

export function saveWarrantySettings(patch: { lines?: WarrantyLine[] }): WarrantySettings {
  const cur = getWarrantySettings();
  const next: WarrantySettings = {
    lines: mergeLines(patch.lines != null ? patch.lines : cur.lines),
    updated_at: new Date().toISOString(),
  };
  run('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)', [META_KEY, JSON.stringify(next)]);
  return next;
}

export function warrantyLineTerm(id: string, fallback = '____', sellerInn?: string | null): string {
  const line = warrantyLinesForSeller(sellerInn).find((l) => l.id === id);
  const t = String(line?.term || '').trim();
  return t || fallback;
}

/** Текст для {{ГарантияРаботы}} — услуги. */
export function formatWarrantyWorksTerm(): string {
  return warrantyLineTerm('services', '7 календарных дней');
}

/** Краткая сводка по основным товарам. */
export function formatWarrantyGoodsSummary(sellerInn?: string | null): string {
  const goods = warrantyLinesForSeller(sellerInn).filter(
    (l) => l.group === 'goods' && String(l.term || '').trim()
  );
  if (!goods.length) return '';
  return goods.map((l) => `${l.label} — ${l.term}`).join('; ');
}

/** Таблица 10.7 / гарантийный талон (текст). */
export function formatWarrantyTableText(opts?: {
  startWorks?: string;
  startGoods?: string;
  sellerInn?: string | null;
}): string {
  const startWorks = opts?.startWorks || 'с даты выдачи АМТС';
  const startGoods = opts?.startGoods || 'с даты выдачи АМТС';
  const lines = warrantyLinesForSeller(opts?.sellerInn).filter((l) => l.group !== 'exclusion');
  const rows = lines.map((l) => {
    const term = String(l.term || '').trim() || '____';
    const start = l.group === 'services' ? startWorks : startGoods;
    const note = l.note ? ` (${l.note})` : '';
    return `${l.label}\t${term}${note}\t${start}`;
  });
  const excl = warrantyLinesForSeller(opts?.sellerInn).find((l) => l.id === 'client_parts');
  if (excl) {
    const term = String(excl.term || '').trim() || 'гарантия производителя запчасти';
    const note = excl.note ? ` ${excl.note}` : '';
    rows.push(`${excl.label}\t${term}.${note}\t—`);
  }
  return [
    'Объект гарантии\tГарантийный срок\tНачало исчисления',
    ...rows,
  ].join('\n');
}

/** HTML-таблица для печати ЗН. */
export function warrantyTableHtml(opts?: {
  startWorks?: string;
  startGoods?: string;
  sellerInn?: string | null;
  esc?: (s: string) => string;
}): string {
  const esc = opts?.esc || ((s: string) =>
    String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;'));
  const startWorks = opts?.startWorks || 'с даты выдачи АМТС';
  const startGoods = opts?.startGoods || 'с даты выдачи АМТС';
  const lines = warrantyLinesForSeller(opts?.sellerInn);
  const bodyRows = lines
    .filter((l) => l.group !== 'exclusion')
    .map((l) => {
      const term = String(l.term || '').trim() || '____';
      const start = l.group === 'services' ? startWorks : startGoods;
      const note = l.note
        ? `<div style="font-size:8.5pt;color:#444;margin-top:2px">${esc(l.note)}</div>`
        : '';
      return `<tr><td>${esc(l.label)}${note}</td><td>${esc(term)}</td><td>${esc(start)}</td></tr>`;
    })
    .join('');
  const excl = lines.find((l) => l.id === 'client_parts');
  const exclRow = excl
    ? `<tr><td>${esc(excl.label)}${
        excl.note
          ? `<div style="font-size:8.5pt;color:#444;margin-top:2px">${esc(excl.note)}</div>`
          : ''
      }</td><td>${esc(String(excl.term || '').trim() || 'гарантия производителя запчасти')}</td><td>—</td></tr>`
    : '';
  return `<table class="grid warranty">
  <thead><tr><th>Объект гарантии</th><th>Гарантийный срок</th><th>Начало исчисления</th></tr></thead>
  <tbody>${bodyRows}${exclRow}</tbody>
</table>`;
}

/** Блок для старой печати sales-docs (список сроков). */
export function warrantyObligationsHtml(
  escHtml: (s: string) => string,
  sellerInn?: string | null
): string {
  const items = workorderWarrantyObligationLines(sellerInn).map(
    (t) => `<li>${escHtml(t)}</li>`
  );
  return `<b>Гарантийные обязательства:</b><ol>${items.join('')}</ol>`;
}

/** Fogel / Краснодар (ИП М.П.) — восстановление оборудования. */
function fogelWarrantyObligationLines(): string[] {
  return [
    'Гарантийный ремонт проводится при предъявлении оборудования в восстановленное Fogel.',
    'Доставка оборудования, подлежащего гарантийному ремонту, в сервисную службу осуществляется клиентом самостоятельно и за свой счет, если иное не оговорено.',
    'Гарантийные обязательства не распространяются на материалы и детали, считающиеся расходуемыми в процессе эксплуатации.',
    'Исполнитель при наступлении гарантийного случая в срок не более 5-ти рабочих дней устраняет неисправности.',
    'Гарантийный срок на пневмоэлемент составляет 24 месяца, амортизатор 12 месяцев.',
    'Гарантийный срок на компрессор составляет 12 месяцев.',
    'Гарантийный срок на рулевую рейку составляет 24 месяца.',
    'Гарантийный срок на электрическую рулевую рейку составляет 6 месяцев. Гарантия распространяется исключительно на проделанные работы.',
  ];
}

function fogelWarrantyBreakLines(): string[] {
  return [
    'Несоответствие серийного номера предъявляемого на гарантийное обслуживание оборудования серийному номеру, указанному в товарном счете или других письменных соглашениях.',
    'Наличие явных или скрытых механических повреждений оборудования, вызванных нарушением правил транспортировки, хранения или эксплуатации.',
    'Выявленное в процессе ремонта несоответствие Правилам и условиям эксплуатации, предъявляемым к оборудованию данного типа.',
    'Повреждение контрольных этикеток и пломб (если таковые имеются).',
    'Наличие внутри корпуса оборудования посторонних предметов, независимо от их природы, если возможность подобного не оговорена в технической документации и Инструкциях по эксплуатации.',
    'Отказ оборудования, вызванный воздействием факторов непреодолимой силы или действиями третьих лиц.',
    'На пневмоэлемент не распространяются гарантийные обязательства, если на нём есть следы масла либо других агрессивных жидкостей.',
    'Отказ оборудования, вызванный неисправностью автомобиля (утечка пневмосистемы, замыкание реле и т.п.).',
    'Обнаружение в системе рулевого управления посторонних примесей, воды, металлической стружки и т.п. Механические и другие воздействия на рулевую рейку вследствие неправильной эксплуатации. Повреждение, нарушение герметичности пыльников рулевых тяг.',
  ];
}

/** Пневмоподвеска / Москва (ИП Р.П.) — Mraer: аморт 1г, баллон 2г, стойка раздельно, компрессор 1г. */
function pnevmoWarrantyObligationLines(): string[] {
  return [
    'Гарантийный ремонт — при предъявлении заказ-наряда (гарантийного талона) и АМТС. Доставка АМТС на сервис — силами и за счёт Заказчика, если иное не согласовано.',
    'Устанавливаемые детали Mraer — новые.',
    'Гарантийный срок на амортизатор — 1 год.',
    'Гарантийный срок на пневмобаллон — 2 года.',
    'На стойку в сборе гарантия действует отдельно на амортизатор и отдельно на пневмобаллон (по срокам выше).',
    'Гарантийный срок на компрессор — 1 год.',
    'При наступлении гарантийного случая Исполнитель устраняет недостатки в срок не более 5 рабочих дней с даты предоставления АМТС, если иной срок не согласован сторонами.',
    'Гарантийные обязательства не распространяются на расходные материалы и детали, считающиеся расходуемыми в процессе эксплуатации.',
  ];
}

function pnevmoWarrantyBreakLines(): string[] {
  return [
    'Механические повреждения узлов вследствие ДТП, ударов, нарушения правил транспортировки, хранения или эксплуатации АМТС.',
    'Нарушение правил эксплуатации и обслуживания (перегрузка, соревнования, условия, не предусмотренные изготовителем).',
    'Разборка, ремонт или вмешательство в узел лицами, не уполномоченными Исполнителем; повреждение пломб и маркировки.',
    'Отказ узла вследствие непреодолимой силы либо действий третьих лиц.',
    'На пневмобаллон гарантия не распространяется при наличии следов масла или других агрессивных жидкостей.',
    'Отказ узла, вызванный неисправностью АМТС (утечка пневмосистемы, замыкание реле, неисправность сопряжённых систем и т.п.), не входившей в объём работ по заказ-наряду.',
  ];
}

/** Текст гарантий бланка ЗН: Fogel или Пневмоподвеска — по ИНН продавца. */
export function workorderWarrantyObligationLines(sellerInn?: string | null): string[] {
  return orgLogoBrandByInn(sellerInn || '') === 'fogel'
    ? fogelWarrantyObligationLines()
    : pnevmoWarrantyObligationLines();
}

/** Случаи прерывания гарантии для бланка ЗН. */
export function workorderWarrantyBreakLines(sellerInn?: string | null): string[] {
  return orgLogoBrandByInn(sellerInn || '') === 'fogel'
    ? fogelWarrantyBreakLines()
    : pnevmoWarrantyBreakLines();
}

/** HTML-блок «Гарантии» для бланка заказ-наряда. */
export function workorderWarrantyBlockHtml(
  escHtml: (s: string) => string,
  sellerInn?: string | null
): string {
  const obl = workorderWarrantyObligationLines(sellerInn)
    .map((t) => `<li>${escHtml(t)}</li>`)
    .join('');
  const brk = workorderWarrantyBreakLines(sellerInn)
    .map((t) => `<li>${escHtml(t)}</li>`)
    .join('');
  return `<div class="warranty">
    <b>Гарантии:</b><br/>
    <b>Гарантийные обязательства сторон:</b>
    <ol>${obl}</ol>
    <b>Условия прерывания гарантийных обязательств:</b>
    <div>Гарантийные обязательства могут быть прерваны в следующих случаях:</div>
    <ol>${brk}</ol>
    <b>Рекомендации:</b>
    <div style="min-height:12mm;border-bottom:1px solid #ccc;margin:4px 0 10px"></div>
  </div>`;
}
