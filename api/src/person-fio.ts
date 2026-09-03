/**
 * ФИО для бланков (договор / ЗН / ПДн): как в паспорте заказчика.
 * В Amo контакт часто «Имя Город» (Павел Москва) — это не ФИО.
 * Собственник по СТС сюда не подставляем (может быть другой человек).
 */

const AMO_CITY_TAGS = new Set(
  [
    'москва',
    'питер',
    'спб',
    'санкт-петербург',
    'петербург',
    'краснодар',
    'зеленоград',
    'туапсе',
    'сочи',
    'ростов',
    'воронеж',
    'казань',
    'екатеринбург',
    'новосибирск',
    'самара',
    'уфа',
    'пермь',
    'тюмень',
    'челябинск',
    'омск',
    'красноярск',
    'волгоград',
    'саратов',
    'иркутск',
    'хабаровск',
    'владивосток',
    'калининград',
    'ставрополь',
    'рязань',
    'тула',
    'ярославль',
    'барнаул',
    'ижевск',
    'ульяновск',
    'махачкала',
    'томск',
    'оренбург',
    'кемерово',
    'новокузнецк',
    'астрахань',
    'пенза',
    'липецк',
    'киров',
    'чебоксары',
    'брянск',
    'курск',
    'иваново',
    'магнитогорск',
    'тверь',
    'белгород',
    'нн',
    'нижний',
    'новгород',
  ].map((s) => s.replace(/ё/g, 'е'))
);

function normTag(s: string): string {
  return String(s || '')
    .trim()
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[^a-zа-я\-]/gi, '');
}

/** Контакт Amo вида «Павел Москва» / «Сергей Москва СТО» / «Андрей … Краснодар …». */
export function looksLikeAmoNameCityLabel(name: string): boolean {
  const parts = String(name || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length < 2) return false;
  if (/^(ооо|ао|пао|зао|ип|общество|индивидуальный)\b/i.test(parts[0])) return false;
  const tags = parts.map(normTag);
  // Город в любом токене после первого (и длинные ярлыки с улицей)
  for (let i = 1; i < tags.length; i++) {
    if (AMO_CITY_TAGS.has(tags[i])) return true;
    if (tags[i] === 'сто' && AMO_CITY_TAGS.has(tags[i - 1] || '')) return true;
  }
  return false;
}

/** В наименовании уже есть ОПФ (ООО / ИП / …) — можно печатать в счёте / УПД. */
export function buyerDocNameHasOpf(name: string): boolean {
  const n = String(name || '').trim();
  if (!n) return false;
  return /^(ооо|ооо\s|ао\b|пао\b|зао\b|ип\b|общество\b|индивидуальный\s+предприниматель\b)/i.test(
    n
  );
}

/** Заглушка Amo / тестовая компания — не подставлять в печатные формы как покупателя. */
export function isWeakBuyerDocName(name: string): boolean {
  const n = String(name || '').trim();
  if (!n) return true;
  if (looksLikeAmoNameCityLabel(n)) return true;
  if (/^тестов/i.test(n)) return true;
  if (/^(клиент|заказчик|покупатель|контрагент|компания)$/i.test(n)) return true;
  // «Андрей АВД Моторс…» без ОПФ — не юрлицо для бланка
  if (!buyerDocNameHasOpf(n) && /\b(авд|сто|моторс)\b/i.test(n) && /\s/.test(n)) return true;
  return false;
}

/**
 * Юр. наименование для счёта / УПД: с ОПФ.
 * ИП → «Индивидуальный предприниматель …» или «ИП …»; ООО и т.п. — как есть с ОПФ.
 */
export function formatBuyerLegalDocName(input: {
  name?: string;
  inn?: string;
  party_kind?: string;
}): string {
  const raw = String(input.name || '').trim();
  if (!raw || isWeakBuyerDocName(raw)) return '';
  const inn = String(input.inn || '').replace(/\D/g, '');
  const pk = String(input.party_kind || '').toLowerCase();
  const isIp =
    pk === 'ip' ||
    inn.length === 12 ||
    /^ип\b/i.test(raw) ||
    /^индивидуальный\s+предприниматель\b/i.test(raw);
  if (isIp) {
    if (/^индивидуальный\s+предприниматель\b/i.test(raw)) return raw;
    if (/^ип\b/i.test(raw)) {
      const fio = raw.replace(/^ип\s+/i, '').trim();
      return fio ? `Индивидуальный предприниматель ${fio}` : raw;
    }
    if (looksLikePersonFio(raw)) return `Индивидуальный предприниматель ${raw}`;
    return raw;
  }
  return raw;
}

/** Похоже на настоящее ФИО (не ярлык «Имя Город»). */
export function looksLikePersonFio(name: string): boolean {
  const raw = String(name || '').trim();
  if (!raw || looksLikeAmoNameCityLabel(raw)) return false;
  if (isWeakBuyerDocName(raw)) return false;
  if (/^(ооо|ао|пао|зао|ип|общество)\b/i.test(raw)) return false;
  if (/\bкомпан/i.test(raw)) return false;
  // Служебные подписи полей, не ФИО
  if (/^(клиент|заказчик|покупатель|контрагент)$/i.test(raw)) return false;
  const parts = raw.split(/\s+/).filter(Boolean);
  const cyr = parts.filter((p) => /[А-Яа-яЁё]{2,}/.test(p));
  // Минимум фамилия + имя (отчество желательно, но не обязательно)
  return cyr.length >= 2;
}

/**
 * ФИО заказчика для бланков — только из поля покупателя (как в паспорте).
 * Ярлык Amo «Имя Город» и ФИО со СТС не используем.
 * ПДн-fallback — в dealFillCtx / resolvePersonDocFioWithPdn.
 */
export function resolvePersonDocFio(
  deal: Record<string, unknown> | null | undefined,
  _garageVehicles?: Array<Record<string, unknown>> | null
): string {
  const contact = String(deal?.buyer_name || '').trim();
  if (looksLikePersonFio(contact)) return contact;
  return '';
}
