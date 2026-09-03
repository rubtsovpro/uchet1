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

/** Контакт Amo вида «Павел Москва» / «Сергей Москва СТО» / «Павел Зеленоград». */
export function looksLikeAmoNameCityLabel(name: string): boolean {
  const parts = String(name || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length < 2 || parts.length > 4) return false;
  if (/^(ооо|ао|пао|зао|ип|общество)\b/i.test(parts[0])) return false;
  const tags = parts.map(normTag);
  const last = tags[tags.length - 1];
  const penult = tags.length >= 2 ? tags[tags.length - 2] : '';
  if (last === 'сто' && AMO_CITY_TAGS.has(penult)) return true;
  if (AMO_CITY_TAGS.has(last)) return true;
  return false;
}

/** Заглушка Amo / тестовая компания — не подставлять в печатные формы как покупателя. */
export function isWeakBuyerDocName(name: string): boolean {
  const n = String(name || '').trim();
  if (!n) return true;
  if (looksLikeAmoNameCityLabel(n)) return true;
  if (/^тестов/i.test(n)) return true;
  if (/^(клиент|заказчик|покупатель|контрагент|компания)$/i.test(n)) return true;
  return false;
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
