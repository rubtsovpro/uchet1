/**
 * Гарантийные сроки (товары / услуги) — правятся в Настройки → Гарантии.
 * Подставляются в ЗН, оферту, HTML-печать и макросы {{Гарантия*}}.
 * Рулевые рейки — только ИП Безматерных М.П. (у Р.П. реек нет).
 */
import { get, run } from './db.js';

const META_KEY = 'warranty_terms';

/** ИНН ИП Безматерных Михаил Павлович — рейки только у него. */
export const WARRANTY_SELLER_INN_MIKHAIL = '231295963240';
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

/** Блок для старой печати sales-docs (список). */
export function warrantyObligationsHtml(
  escHtml: (s: string) => string,
  sellerInn?: string | null
): string {
  const lines = warrantyLinesForSeller(sellerInn);
  const items: string[] = [];
  for (const l of lines) {
    if (l.group === 'exclusion') continue;
    const term = String(l.term || '').trim();
    if (!term) continue;
    items.push(
      `<li>${escHtml(l.label)} — <b>${escHtml(term)}</b>${
        l.note ? `. ${escHtml(l.note)}` : ''
      }</li>`
    );
  }
  const excl = lines.find((l) => l.id === 'client_parts');
  if (excl) {
    items.push(
      `<li>${escHtml(excl.label)}: ${escHtml(String(excl.term || '').trim() || 'гарантия производителя')}. ${escHtml(
        excl.note ||
          'Исполнитель гарантию не предоставляет и ответственности по ней не несёт.'
      )}</li>`
    );
  }
  items.push(
    '<li>Гарантийный ремонт — при предъявлении заказ-наряда / гарантийного талона. Доставка оборудования на СТО — силами и за счёт клиента, если иное не согласовано.</li>'
  );
  return `<b>Гарантийные обязательства:</b><ol>${items.join('')}</ol>`;
}
