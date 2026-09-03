/**
 * Контакты постов СТО (режим, телефон приёмки, адрес точки).
 * Юр. адрес ИП — отдельно в organizations.address.
 */
export type StoSiteId = 'fogel' | 'strela' | 'mozhayka';

export type StoSite = {
  id: StoSiteId;
  label: string;
  hours: string;
  phone: string;
  email: string;
  address: string;
  /** Территориальный орган Роспотребнадзора по месту оказания услуг. */
  rospotrebnadzor: string;
  rospotrebnadzor_phone: string;
};

export const STO_SITES: Record<StoSiteId, StoSite> = {
  fogel: {
    id: 'fogel',
    label: 'Фогель',
    hours: 'понедельник — суббота с 9:00 до 19:00',
    phone: '+7 (928) 257-88-30',
    email: 'info@fogel.com.ru',
    address: 'ул. Фадеева, 267, жилой массив Пашковский',
    rospotrebnadzor: 'Управление Роспотребнадзора по Краснодарскому краю',
    rospotrebnadzor_phone: '+7 (861) 226-40-74',
  },
  strela: {
    id: 'strela',
    label: 'Стрела',
    hours: 'понедельник — суббота с 10:00 до 20:00',
    phone: '+7-999-414-91-25',
    email: 'info@fogel.com.ru',
    address: 'г. Краснодар, ул. Фадеева, 124',
    rospotrebnadzor: 'Управление Роспотребнадзора по Краснодарскому краю',
    rospotrebnadzor_phone: '+7 (861) 226-40-74',
  },
  mozhayka: {
    id: 'mozhayka',
    label: 'Можайка',
    hours: 'понедельник — суббота с 10:00 до 19:00',
    phone: '+7 (925) 160-80-31',
    email: 'info@pnevmopodveska1.ru',
    // ККТ/пост: Одинцовский г.о. МО, Можайское ш., д. 167 — надзор по месту оказания услуг
    address: 'г. Москва, Можайское шоссе, вл. 167',
    rospotrebnadzor:
      'Одинцовский территориальный отдел Управления Роспотребнадзора по Московской области',
    rospotrebnadzor_phone: '+7 (495) 593-51-43',
  },
};

/** ИНН М.П. / Р.П. */
export const INN_BMP = '231295963240';
export const INN_BRP = '231215603728';

/** Р/с контура → пост (у М.П. два р/с). */
const RS_TO_SITE: Record<string, StoSiteId> = {
  '40802810420000909020': 'fogel',
  '40802810720000909005': 'strela',
  '40802810109500030587': 'mozhayka',
};

export function resolveStoSiteId(opts: {
  inn?: string;
  rs?: string;
  companyCode?: string;
  masterTitle?: string;
}): StoSiteId | null {
  const rs = String(opts.rs || '').replace(/\s/g, '');
  if (rs && RS_TO_SITE[rs]) return RS_TO_SITE[rs];

  const code = String(opts.companyCode || '')
    .trim()
    .toUpperCase()
    .replace(/Ё/g, 'Е');
  if (/FOGEL|ФОГЕЛЬ/.test(code)) return 'fogel';
  if (/STRELA|СТРЕЛА/.test(code)) return 'strela';
  if (/PNEVMO|ПНЕВМО|MOZH|МОЖА/.test(code)) return 'mozhayka';

  const title = String(opts.masterTitle || '').toLowerCase();
  if (/фогел/.test(title)) return 'fogel';
  if (/стрел/.test(title)) return 'strela';
  if (/москв|пневмо|можай/.test(title)) return 'mozhayka';

  const inn = String(opts.inn || '').replace(/\D/g, '');
  if (inn === INN_BRP) return 'mozhayka';
  if (inn === INN_BMP) return 'fogel';
  return null;
}

export function stoSiteById(id: StoSiteId | null | undefined): StoSite | null {
  if (!id) return null;
  return STO_SITES[id] || null;
}

/** Текст для бланка ИП М.П., когда пост не выбран — оба краснодарских. */
export function mikhailBothSitesBlurb(): {
  address: string;
  phone: string;
  hours: string;
  email: string;
  rospotrebnadzor: string;
  rospotrebnadzor_phone: string;
} {
  const f = STO_SITES.fogel;
  const s = STO_SITES.strela;
  return {
    address: `${f.label}: ${f.address}; ${s.label}: ${s.address}`,
    phone: `${f.label}: ${f.phone}; ${s.label} (приёмка): ${s.phone}`,
    hours: `${f.label}: ${f.hours}; ${s.label}: ${s.hours}`,
    email: f.email,
    rospotrebnadzor: f.rospotrebnadzor,
    rospotrebnadzor_phone: f.rospotrebnadzor_phone,
  };
}
