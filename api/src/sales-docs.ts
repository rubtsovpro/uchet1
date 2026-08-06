/**
 * Журналы: Счёт, УПД, Заказ-наряд (и СФ).
 * Бланки по образцам 1С ПневмоПро / ИП Безматерных Р.П.
 * Организация документа — из справочника organizations (мультиорг).
 */
import { all, get, run, type Row } from './db.js';
import { newGuid } from './ids.js';
import { dealInvoiceOrganizationId, dealSalesDocPackTypes, getDeal } from './deals.js';
import {
  nextContractNumber,
  nextInvoiceNumber,
  nextOutNfNumber,
  salesNumberFromDeal,
} from './doc-numbering.js';
import { getCompany } from './companies.js';
import {
  DEFAULT_ORG,
  ensureOrganizationsSeeded,
  getDefaultOrganization,
  getOrganization,
  getOrgProfile,
  orgToProfile,
  resolveOrganizationId,
  saveOrgProfile,
  type OrgProfile,
} from './organizations.js';
import { assertDealStockAvailable, planDealStockNeeds } from './payment-links.js';
import { customerOrderLineDisplayName } from './product-display-name.js';
import { orgSignHtml, orgStampHtml } from './org-stamp.js';
import { renderSaleContractHtml, type ContractBuyer } from './sale-contract.js';
import { createDocument, isServiceProduct } from './stock.js';
import { linkOutToOrderChain } from './order-doc-tree.js';
import { buildInvoicePaymentPurpose } from './payment-qr.js';
import { stsMediaInfo } from './sts-media.js';

export type SalesDocType = 'invoice' | 'upd' | 'sf' | 'workorder' | 'contract';

export type { OrgProfile };
export { DEFAULT_ORG, getOrgProfile, saveOrgProfile, ensureOrganizationsSeeded };

/** @deprecated use ensureOrganizationsSeeded — оставлено для server.ts */
export function ensureOrgProfileSeeded(): void {
  ensureOrganizationsSeeded();
}

const TYPE_LABEL: Record<SalesDocType, string> = {
  invoice: 'Счёт на оплату',
  upd: 'УПД',
  sf: 'Счёт-фактура',
  workorder: 'Заказ-наряд',
  contract: 'Договор',
};

const WORK_RE =
  /(снять\/установить|проверить\/исправить|осмотр|диагностик|ремонт|регулир|замен[аы].*работ|н\/ч|нормочас)/i;

export function salesDocTypeLabel(t: string): string {
  return TYPE_LABEL[t as SalesDocType] || t;
}

/** Строка «Автомобиль: …» для ЗН (пустые поля — подчёркивания). */
export function formatWorkorderVehicleLine(doc: Record<string, unknown> | null | undefined): string {
  const blank = (v: unknown, n: number) => {
    const s = String(v ?? '').trim();
    return s || '_'.repeat(n);
  };
  const d = doc || {};
  const brandModel = [d.car_brand, d.car_model].map((x) => String(x ?? '').trim()).filter(Boolean).join(' ');
  return (
    `Автомобиль: ${blank(brandModel || '', 12)}  гос. номер ${blank(d.car_plate, 8)}  VIN ${blank(d.car_vin, 8)}  ` +
    `год вып. ${blank(d.car_year, 4)}  цвет ${blank(d.car_color, 6)}  пробег ${blank(d.car_mileage, 6)}`
  );
}

/** Номер расходной (out) по заказу покупателя — для печати ЗН. */
export function findDealOutStockNumber(dealId: string | null | undefined): string {
  const id = String(dealId || '').trim();
  if (!id) return '';
  const row = get<{ number: string }>(
    `SELECT number FROM stock_docs
     WHERE doc_type = 'out'
       AND (IFNULL(deal_id,'') = ? OR IFNULL(basis_order_id,'') = ?)
     ORDER BY datetime(IFNULL(doc_date,'')) DESC, number DESC
     LIMIT 1`,
    [id, id]
  );
  return String(row?.number || '').trim();
}

/**
 * Заголовок блока товаров в ЗН:
 * «Расходная накладная № Р… к заказ-наряду № ЗН… от … г.»
 */
export function formatWorkorderOutHeading(
  doc: Record<string, unknown> | null | undefined,
  dateShort: string
): string {
  const d = doc || {};
  const wo = String(d.number || '').trim() || '—';
  const out =
    findDealOutStockNumber(String(d.deal_id || '')) ||
    // если расходная ещё не создана — ожидаемый номер Р{сделка}
    (() => {
      const deal = String(d.deal_id || '').trim();
      return deal ? `Р${deal}` : '';
    })();
  const datePart = String(dateShort || '').trim();
  if (out) {
    return `Расходная накладная № ${out} к заказ-наряду № ${wo}${
      datePart ? ` от ${datePart} г.` : ''
    }`;
  }
  return `Расходная накладная к заказ-наряду № ${wo}${datePart ? ` от ${datePart} г.` : ''}`;
}

export function updateSalesDocVehicle(
  docId: string,
  vehicle: {
    car_plate?: string;
    car_vin?: string;
    car_year?: string;
    car_mileage?: string;
    car_brand?: string;
    car_model?: string;
    car_color?: string;
    car_category?: string;
    car_pts?: string;
    car_owner?: string;
    car_owner_street?: string;
    car_owner_house?: string;
    car_owner_flat?: string;
    car_sts_date?: string;
    car_sts_number?: string;
  }
): void {
  const id = String(docId || '').trim();
  if (!id) throw new Error('doc_id required');
  const row = get('SELECT id, doc_type FROM sales_docs WHERE id = ?', [id]);
  if (!row) throw new Error('Документ не найден');
  run(
    `UPDATE sales_docs
     SET car_plate = ?, car_vin = ?, car_year = ?, car_mileage = ?,
         car_brand = ?, car_model = ?, car_color = ?, car_category = ?, car_pts = ?,
         car_owner = ?, car_owner_street = ?, car_owner_house = ?, car_owner_flat = ?,
         car_sts_date = ?, car_sts_number = ?
     WHERE id = ?`,
    [
      String(vehicle.car_plate ?? '').trim().toUpperCase(),
      String(vehicle.car_vin ?? '').trim().toUpperCase(),
      String(vehicle.car_year ?? '').trim(),
      String(vehicle.car_mileage ?? '').trim(),
      String(vehicle.car_brand ?? '').trim(),
      String(vehicle.car_model ?? '').trim(),
      String(vehicle.car_color ?? '').trim(),
      String(vehicle.car_category ?? '').trim(),
      String(vehicle.car_pts ?? '').trim(),
      String(vehicle.car_owner ?? '').trim(),
      String(vehicle.car_owner_street ?? '').trim(),
      String(vehicle.car_owner_house ?? '').trim(),
      String(vehicle.car_owner_flat ?? '').trim(),
      String(vehicle.car_sts_date ?? '').trim(),
      String(vehicle.car_sts_number ?? '').trim(),
      id,
    ]
  );
}

export type ContractBuyerFields = {
  name?: string;
  inn?: string;
  kpp?: string;
  ogrn?: string;
  address?: string;
  phone?: string;
  email?: string;
  director?: string;
  bank?: string;
  bik?: string;
  rs?: string;
  ks?: string;
};

function findCounterpartyForDeal(deal: Row | null | undefined): Row | null {
  if (!deal) return null;
  const companyId = String(deal.company_id || '').trim();
  if (companyId) {
    const byId = get('SELECT * FROM counterparties WHERE id = ?', [companyId]);
    if (byId) return byId;
    const byAmo = get(
      `SELECT * FROM counterparties WHERE amo_company_id = ? ORDER BY name LIMIT 1`,
      [companyId]
    );
    if (byAmo) return byAmo;
  }
  const inn = String(deal.buyer_inn || '').replace(/\D/g, '');
  if (inn.length === 10 || inn.length === 12) {
    return (
      get(
        `SELECT * FROM counterparties
         WHERE replace(IFNULL(inn,''),' ','') = ?
         ORDER BY CASE WHEN kind = 'buyer' THEN 0 ELSE 1 END, name
         LIMIT 1`,
        [inn]
      ) || null
    );
  }
  return null;
}

/** Реквизиты покупателя для договора: сделка + карточка контрагента. */
export function resolveContractBuyerFromDeal(
  deal: Row | null | undefined,
  overrides: ContractBuyerFields = {}
): ContractBuyerFields {
  const cp = findCounterpartyForDeal(deal);
  const companyName = String(deal?.company_name || '').trim();
  const contactName = String(deal?.buyer_name || '').trim();
  const isLegal =
    Number(deal?.is_legal_entity) === 1 ||
    String(deal?.buyer_kind || '').toLowerCase() === 'legal' ||
    Boolean(companyName) ||
    String(deal?.buyer_inn || '').replace(/\D/g, '').length === 10;
  const nameFromCp = String(cp?.name_full || cp?.name || '').trim();
  const name =
    String(overrides.name || '').trim() ||
    nameFromCp ||
    (isLegal ? companyName || contactName : contactName || companyName) ||
    '';
  const inn =
    String(overrides.inn || '').replace(/\D/g, '') ||
    String(cp?.inn || '').replace(/\D/g, '') ||
    String(deal?.buyer_inn || '').replace(/\D/g, '');
  const phone =
    String(overrides.phone || '').trim() ||
    String(cp?.phone || '').trim() ||
    String(deal?.buyer_phone || '').trim();
  const email =
    String(overrides.email || '').trim() || String(cp?.email || '').trim();
  const address =
    String(overrides.address || '').trim() || String(cp?.address || '').trim();
  const kpp =
    String(overrides.kpp || '').replace(/\D/g, '') ||
    String(cp?.kpp || '').replace(/\D/g, '');
  const ogrn =
    String(overrides.ogrn || '').replace(/\D/g, '') ||
    String(cp?.ogrn || '').replace(/\D/g, '');
  let director = String(overrides.director || '').trim() || String(cp?.director || '').trim();
  if (!director && inn.length === 12) {
    // ИП: в лице самого ИП
    director = name || contactName || 'индивидуального предпринимателя';
  }
  return {
    name,
    inn,
    kpp,
    ogrn,
    address,
    phone,
    email,
    director,
    bank: String(overrides.bank || '').trim() || String(cp?.bank || '').trim(),
    bik: String(overrides.bik || '').replace(/\D/g, '') || String(cp?.bik || '').replace(/\D/g, ''),
    rs: String(overrides.rs || '').replace(/\D/g, '') || String(cp?.rs || '').replace(/\D/g, ''),
    ks: String(overrides.ks || '').replace(/\D/g, '') || String(cp?.ks || '').replace(/\D/g, ''),
  };
}

/**
 * Переименовать покупателя: текущий документ + все docs сделки + сделка + карточка контрагента.
 * Возвращает deal_id / counterparty_id для пуша в Amo.
 */
export function renameSalesDocBuyerName(
  docId: string,
  nameRaw: string
): {
  name: string;
  deal_id: string;
  counterparty_id: string;
  docs_updated: number;
} {
  const id = String(docId || '').trim();
  if (!id) throw new Error('doc_id required');
  const name = String(nameRaw || '').trim();
  if (!name) throw new Error('Укажите наименование покупателя');
  const doc = get<{ id: string; deal_id?: string; counterparty_name?: string }>(
    'SELECT id, deal_id, counterparty_name FROM sales_docs WHERE id = ?',
    [id]
  );
  if (!doc) throw new Error('Документ не найден');

  const dealId = String(doc.deal_id || '').trim();
  let docsUpdated = 0;
  if (dealId) {
    const before = all<{ id: string }>('SELECT id FROM sales_docs WHERE deal_id = ?', [dealId]);
    run(`UPDATE sales_docs SET counterparty_name = ? WHERE deal_id = ?`, [name, dealId]);
    docsUpdated = before.length;
  } else {
    run(`UPDATE sales_docs SET counterparty_name = ? WHERE id = ?`, [name, id]);
    docsUpdated = 1;
  }

  let counterpartyId = '';
  if (dealId) {
    const deal = getDeal(dealId) as Row | null;
    if (deal) {
      const isLegal =
        Number(deal.is_legal_entity) === 1 ||
        String(deal.buyer_kind || '').toLowerCase() === 'legal' ||
        String(deal.buyer_inn || '').replace(/\D/g, '').length === 10 ||
        Boolean(String(deal.company_name || '').trim());
      if (isLegal) {
        run(
          `UPDATE crm_deals
           SET company_name = ?, buyer_name = CASE WHEN IFNULL(buyer_name,'') = '' THEN ? ELSE buyer_name END,
               updated_at = datetime('now')
           WHERE id = ?`,
          [name, name, dealId]
        );
      } else {
        run(
          `UPDATE crm_deals
           SET buyer_name = ?, updated_at = datetime('now')
           WHERE id = ?`,
          [name, dealId]
        );
      }
      const cp = findCounterpartyForDeal(deal);
      if (cp?.id) {
        counterpartyId = String(cp.id);
        run(
          `UPDATE counterparties SET name = ? WHERE id = ?`,
          [name, counterpartyId]
        );
      }
    }
  }

  return { name, deal_id: dealId, counterparty_id: counterpartyId, docs_updated: docsUpdated };
}

export function updateSalesDocBuyer(docId: string, buyer: ContractBuyerFields): void {
  const id = String(docId || '').trim();
  if (!id) throw new Error('doc_id required');
  const row = get<{ doc_type?: string }>('SELECT id, doc_type FROM sales_docs WHERE id = ?', [id]);
  if (!row) throw new Error('Документ не найден');
  if (String(row.doc_type) !== 'contract') {
    throw new Error('Реквизиты покупателя правятся в договоре');
  }
  run(
    `UPDATE sales_docs SET
       counterparty_name = ?,
       counterparty_inn = ?,
       buyer_address = ?,
       buyer_phone = ?,
       buyer_email = ?,
       buyer_kpp = ?,
       buyer_ogrn = ?,
       buyer_director = ?,
       buyer_bank = ?,
       buyer_bik = ?,
       buyer_rs = ?,
       buyer_ks = ?
     WHERE id = ?`,
    [
      String(buyer.name ?? '').trim(),
      String(buyer.inn ?? '').replace(/\D/g, ''),
      String(buyer.address ?? '').trim(),
      String(buyer.phone ?? '').trim(),
      String(buyer.email ?? '').trim(),
      String(buyer.kpp ?? '').replace(/\D/g, ''),
      String(buyer.ogrn ?? '').replace(/\D/g, ''),
      String(buyer.director ?? '').trim(),
      String(buyer.bank ?? '').trim(),
      String(buyer.bik ?? '').replace(/\D/g, ''),
      String(buyer.rs ?? '').replace(/\D/g, ''),
      String(buyer.ks ?? '').replace(/\D/g, ''),
      id,
    ]
  );
}

/** Дозаполнить пустые поля договора из сделки/контрагента. */
export function fillContractBuyerFromDeal(docId: string): ReturnType<typeof getSalesDoc> {
  const id = String(docId || '').trim();
  const doc = get('SELECT * FROM sales_docs WHERE id = ?', [id]) as Row | undefined;
  if (!doc || String(doc.doc_type) !== 'contract') return getSalesDoc(id);
  const dealId = String(doc.deal_id || '').trim();
  if (!dealId) return getSalesDoc(id);
  const deal = getDeal(dealId) as Row | null;
  const resolved = resolveContractBuyerFromDeal(deal, {
    name: String(doc.counterparty_name || ''),
    inn: String(doc.counterparty_inn || ''),
    address: String(doc.buyer_address || ''),
    phone: String(doc.buyer_phone || ''),
    email: String(doc.buyer_email || ''),
    kpp: String(doc.buyer_kpp || ''),
    ogrn: String(doc.buyer_ogrn || ''),
    director: String(doc.buyer_director || ''),
    bank: String(doc.buyer_bank || ''),
    bik: String(doc.buyer_bik || ''),
    rs: String(doc.buyer_rs || ''),
    ks: String(doc.buyer_ks || ''),
  });
  // Не затираем уже заполненное вручную — только пустые
  const pick = (cur: unknown, next: string | undefined) => {
    const c = String(cur || '').trim();
    return c || String(next || '').trim();
  };
  const merged: ContractBuyerFields = {
    name: pick(doc.counterparty_name, resolved.name),
    inn: pick(doc.counterparty_inn, resolved.inn),
    address: pick(doc.buyer_address, resolved.address),
    phone: pick(doc.buyer_phone, resolved.phone),
    email: pick(doc.buyer_email, resolved.email),
    kpp: pick(doc.buyer_kpp, resolved.kpp),
    ogrn: pick(doc.buyer_ogrn, resolved.ogrn),
    director: pick(doc.buyer_director, resolved.director),
    bank: pick(doc.buyer_bank, resolved.bank),
    bik: pick(doc.buyer_bik, resolved.bik),
    rs: pick(doc.buyer_rs, resolved.rs),
    ks: pick(doc.buyer_ks, resolved.ks),
  };
  const changed =
    merged.name !== String(doc.counterparty_name || '') ||
    merged.inn !== String(doc.counterparty_inn || '') ||
    merged.address !== String(doc.buyer_address || '') ||
    merged.phone !== String(doc.buyer_phone || '') ||
    merged.email !== String(doc.buyer_email || '') ||
    merged.kpp !== String(doc.buyer_kpp || '') ||
    merged.ogrn !== String(doc.buyer_ogrn || '') ||
    merged.director !== String(doc.buyer_director || '') ||
    merged.bank !== String(doc.buyer_bank || '') ||
    merged.bik !== String(doc.buyer_bik || '') ||
    merged.rs !== String(doc.buyer_rs || '') ||
    merged.ks !== String(doc.buyer_ks || '');
  if (changed) updateSalesDocBuyer(id, merged);
  return getSalesDoc(id);
}

function money(n: number): string {
  return (Math.round(n * 100) / 100).toFixed(2);
}

/** 87900.5 → «87 900,50» */
export function formatRuMoney(n: number): string {
  const [r, k] = money(n).split('.');
  return `${r.replace(/\B(?=(\d{3})+(?!\d))/g, ' ')},${k}`;
}

function splitVat(totalIncl: number, vatRate: number): { amount: number; vat: number; total: number } {
  const total = Math.round(totalIncl * 100) / 100;
  if (!(vatRate > 0)) return { amount: total, vat: 0, total };
  const amount = Math.round((total / (1 + vatRate / 100)) * 100) / 100;
  const vat = Math.round((total - amount) * 100) / 100;
  return { amount, vat, total };
}

function productItemKind(productGuid: string): 'service' | 'product' | null {
  const id = String(productGuid || '').trim();
  if (!id) return null;
  if (isServiceProduct(id)) return 'service';
  const row = get<{ id: string }>('SELECT id FROM products WHERE id = ?', [id]);
  return row ? 'product' : null;
}

function guessLineKind(sku: string, name: string, productGuid: string): 'work' | 'goods' {
  const kind = productItemKind(productGuid);
  if (kind === 'service') return 'work';
  if (kind === 'product') return 'goods';
  if (WORK_RE.test(name) && !sku) return 'work';
  if (WORK_RE.test(name) && !productGuid) return 'work';
  if (WORK_RE.test(name) && sku.length < 4) return 'work';
  return 'goods';
}

/** Сумма прописью (рубли и копейки). */
export function amountInWordsRu(sum: number): string {
  const n = Math.round(Math.abs(sum) * 100);
  const rub = Math.floor(n / 100);
  const kop = n % 100;
  const ones = [
    '',
    'один',
    'два',
    'три',
    'четыре',
    'пять',
    'шесть',
    'семь',
    'восемь',
    'девять',
  ];
  const onesF = [
    '',
    'одна',
    'две',
    'три',
    'четыре',
    'пять',
    'шесть',
    'семь',
    'восемь',
    'девять',
  ];
  const teens = [
    'десять',
    'одиннадцать',
    'двенадцать',
    'тринадцать',
    'четырнадцать',
    'пятнадцать',
    'шестнадцать',
    'семнадцать',
    'восемнадцать',
    'девятнадцать',
  ];
  const tens = [
    '',
    '',
    'двадцать',
    'тридцать',
    'сорок',
    'пятьдесят',
    'шестьдесят',
    'семьдесят',
    'восемьдесят',
    'девяносто',
  ];
  const hundreds = [
    '',
    'сто',
    'двести',
    'триста',
    'четыреста',
    'пятьсот',
    'шестьсот',
    'семьсот',
    'восемьсот',
    'девятьсот',
  ];

  function triad(num: number, female: boolean): string {
    const h = Math.floor(num / 100);
    const t = Math.floor((num % 100) / 10);
    const o = num % 10;
    const parts: string[] = [];
    if (h) parts.push(hundreds[h]);
    if (t === 1) {
      parts.push(teens[o]);
    } else {
      if (t) parts.push(tens[t]);
      if (o) parts.push(female ? onesF[o] : ones[o]);
    }
    return parts.join(' ');
  }

  function morph(n: number, a: string, b: string, c: string): string {
    const n10 = n % 10;
    const n100 = n % 100;
    if (n10 === 1 && n100 !== 11) return a;
    if (n10 >= 2 && n10 <= 4 && (n100 < 10 || n100 >= 20)) return b;
    return c;
  }

  if (rub === 0) {
    return `Ноль рублей ${String(kop).padStart(2, '0')} копеек`;
  }

  const millions = Math.floor(rub / 1_000_000);
  const thousands = Math.floor((rub % 1_000_000) / 1000);
  const rest = rub % 1000;
  const parts: string[] = [];
  if (millions) {
    parts.push(
      triad(millions, false),
      morph(millions, 'миллион', 'миллиона', 'миллионов')
    );
  }
  if (thousands) {
    parts.push(
      triad(thousands, true),
      morph(thousands, 'тысяча', 'тысячи', 'тысяч')
    );
  }
  if (rest || (!millions && !thousands)) {
    parts.push(triad(rest, false));
  }
  parts.push(morph(rub, 'рубль', 'рубля', 'рублей'));
  const words = parts.filter(Boolean).join(' ');
  const capitalized = words.charAt(0).toUpperCase() + words.slice(1);
  return `${capitalized} ${String(kop).padStart(2, '0')} копеек`;
}

function formatDocDateRu(iso: string): string {
  const d = new Date(String(iso).slice(0, 10) + 'T12:00:00');
  if (Number.isNaN(d.getTime())) return String(iso).slice(0, 10);
  const months = [
    'января',
    'февраля',
    'марта',
    'апреля',
    'мая',
    'июня',
    'июля',
    'августа',
    'сентября',
    'октября',
    'ноября',
    'декабря',
  ];
  return `${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()} г.`;
}

function formatDocDateShort(iso: string): string {
  const s = String(iso).slice(0, 10);
  const [y, m, d] = s.split('-');
  if (!y || !m || !d) return s;
  return `${d}.${m}.${y}`;
}

function nextSalesNumber(docType: SalesDocType, dealId?: string): string {
  const deal = String(dealId || '').trim();
  if (deal) return salesNumberFromDeal(docType, deal);
  if (docType === 'invoice') return nextInvoiceNumber();
  if (docType === 'contract') return nextContractNumber();
  // Без сделки — серия 1С 00НФ-
  return nextOutNfNumber();
}

export function listSalesDocs(opts: {
  type?: SalesDocType | '';
  q?: string;
  dealId?: string;
  companyId?: string;
  companyIds?: string[];
  limit?: number;
  page?: number;
}) {
  const type = opts.type || '';
  const q = (opts.q || '').trim();
  const dealId = (opts.dealId || '').trim();
  const companyId = (opts.companyId || '').trim();
  const companyIds = Array.isArray(opts.companyIds)
    ? [...new Set(opts.companyIds.map((x) => String(x || '').trim()).filter(Boolean))]
    : [];
  const limit = Math.min(500, Math.max(1, opts.limit ?? 50));
  const page = Math.max(1, opts.page ?? 1);
  const offset = (page - 1) * limit;
  const where: string[] = [];
  const params: Array<string | number> = [];
  if (type) {
    where.push('s.doc_type = ?');
    params.push(type);
  }
  if (dealId) {
    where.push('s.deal_id = ?');
    params.push(dealId);
  }
  if (companyId) {
    where.push(`IFNULL(o.company_id,'') = ?`);
    params.push(companyId);
  } else if (companyIds.length) {
    where.push(`IFNULL(o.company_id,'') IN (${companyIds.map(() => '?').join(',')})`);
    params.push(...companyIds);
  }
  if (q) {
    where.push(
      `(s.number LIKE ? OR s.counterparty_name LIKE ? OR s.deal_id LIKE ? OR s.comment LIKE ?
        OR IFNULL(o.name,'') LIKE ? OR IFNULL(o.short_name,'') LIKE ? OR IFNULL(o.inn,'') LIKE ?
        OR IFNULL(co.name,'') LIKE ? OR IFNULL(d.name,'') LIKE ?)`
    );
    const like = `%${q}%`;
    params.push(like, like, like, like, like, like, like, like, like);
  }
  const sqlWhere = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const orderBy = type
    ? `ORDER BY datetime(s.doc_date) DESC, s.number DESC`
    : `ORDER BY CASE s.doc_type
         WHEN 'invoice' THEN 1
         WHEN 'workorder' THEN 2
         WHEN 'upd' THEN 3
         WHEN 'sf' THEN 4
         WHEN 'contract' THEN 5
         ELSE 9 END,
       datetime(s.doc_date) DESC, s.number DESC`;
  const fromJoins = `FROM sales_docs s
       LEFT JOIN organizations o ON o.id = s.organization_id
       LEFT JOIN companies co ON co.id = o.company_id
       LEFT JOIN crm_deals d ON d.id = s.deal_id`;
  const total =
    get<{ c: number }>(
      `SELECT COUNT(*) AS c
       ${fromJoins}
       ${sqlWhere}`,
      params
    )?.c ?? 0;
  const items = all(
    `SELECT s.id, s.doc_type, s.number, s.doc_date, s.deal_id, s.counterparty_name, s.counterparty_inn,
            s.amount, s.vat_rate, s.vat_amount, s.total, s.status, s.comment, s.created_at,
            s.organization_id,
            IFNULL(co.name,'') AS company_name,
            IFNULL(NULLIF(TRIM(o.short_name), ''), o.name) AS organization_short,
            IFNULL(o.name,'') AS organization_name,
            IFNULL(o.inn,'') AS organization_inn,
            IFNULL(d.name,'') AS deal_name
     ${fromJoins}
     ${sqlWhere}
     ${orderBy}
     LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );
  return {
    items,
    total,
    page,
    limit,
    pages: Math.max(1, Math.ceil(total / limit)),
  };
}

/** Создать пакет: счёт + заказ-наряд + УПД (и опционально СФ). */
export function createSalesDocPackFromDeal(input: {
  dealId: string;
  types?: SalesDocType[];
  vatRate?: number;
  buyerName?: string;
  buyerInn?: string;
  createdBy?: string;
  organizationId?: string;
}) {
  const deal = getDeal(input.dealId) as Record<string, unknown> | null;
  if (!deal) throw new Error('Сделка не найдена');
  const types = input.types?.length
    ? input.types
    : (dealSalesDocPackTypes(deal) as SalesDocType[]);
  if (!types.length) throw new Error('Нет документов для этого типа заказа');
  const docs = [];
  for (const docType of types) {
    docs.push(
      createSalesDocFromDeal({
        dealId: input.dealId,
        docType,
        vatRate: input.vatRate,
        buyerName: input.buyerName,
        buyerInn: input.buyerInn,
        createdBy: input.createdBy,
        organizationId: input.organizationId,
      })
    );
  }
  return docs;
}

/**
 * Юр. отгрузка: УПД (товары + услуги) и проведённая расходная (только товары → склад).
 */
export function createUpdAndWriteOffFromDeal(input: {
  dealId: string;
  vatRate?: number;
  buyerName?: string;
  buyerInn?: string;
  createdBy?: string;
  organizationId?: string;
  preferredWarehouseId?: string;
}): {
  upd: Row & { lines: Row[]; org: OrgProfile };
  stock_doc_id: string | null;
  stock_doc_number: string | null;
  stock_note: string;
  skipped_services: number;
} {
  const dealId = String(input.dealId || '').trim();
  const deal = getDeal(dealId) as Record<string, unknown> | null;
  if (!deal) throw new Error('Сделка не найдена');
  const items = (deal.items as Array<Record<string, unknown>>) || [];
  if (!items.length) throw new Error('В заказе покупателя нет позиций');

  const upd = createSalesDocFromDeal({
    dealId,
    docType: 'upd',
    vatRate: input.vatRate,
    buyerName: input.buyerName,
    buyerInn: input.buyerInn,
    createdBy: input.createdBy,
    organizationId: input.organizationId,
  });
  if (!upd) throw new Error('Не удалось создать УПД');

  const skippedServices = items.filter((it) => {
    const guid = String(it.product_guid || it.product_id || '').trim();
    return (
      productItemKind(guid) === 'service' ||
      guessLineKind(String(it.sku || ''), String(it.name || ''), guid) === 'work'
    );
  }).length;

  const preferred = String(input.preferredWarehouseId || '').trim();
  const { needs, missing } = planDealStockNeeds(deal, preferred);
  if (!needs.length) {
    return {
      upd,
      stock_doc_id: null,
      stock_doc_number: null,
      stock_note:
        skippedServices === items.length
          ? 'УПД создан. В заказе только услуги — расходная/списание не нужны.'
          : 'УПД создан. Товаров для списания нет.',
      skipped_services: skippedServices,
    };
  }
  assertDealStockAvailable(dealId, preferred);

  const byWh = new Map<
    string,
    Array<{ product_id: string; qty: number; serials: string[] }>
  >();
  for (const it of items) {
    const guid = String(it.product_guid || it.product_id || '').trim();
    if (
      productItemKind(guid) === 'service' ||
      guessLineKind(String(it.sku || ''), String(it.name || ''), guid) === 'work'
    ) {
      continue;
    }
    const productId = guid;
    const qty = Number(it.qty || 0) || 0;
    if (!(qty > 0) || !productId) continue;
    const serials = Array.isArray(it.serials)
      ? (it.serials as unknown[]).map((s) => String(s || '').trim()).filter(Boolean)
      : [];
    const fromPlan = needs.find((n) => n.productId === productId && n.sourceWh);
    const wh =
      String(it.warehouse_id || '').trim() ||
      String(fromPlan?.sourceWh || '').trim();
    if (!wh) continue;
    const list = byWh.get(wh) || [];
    // Если на строке есть марки — одна строка расхода на эту позицию (qty = числу марок или qty)
    if (serials.length) {
      list.push({
        product_id: productId,
        qty: serials.length,
        serials,
      });
    } else {
      const existing = list.find((r) => r.product_id === productId && !r.serials.length);
      if (existing) existing.qty += qty;
      else list.push({ product_id: productId, qty, serials: [] });
    }
    byWh.set(wh, list);
  }
  if (!byWh.size) {
    throw new Error(
      missing.length
        ? `Нет на складе: ${missing.slice(0, 5).join('; ')}`
        : 'Не удалось выбрать склад для списания'
    );
  }

  const lines: Array<{
    product_id: string;
    qty: number;
    warehouse_id: string;
    serials?: string[];
  }> = [];
  for (const [wh, rows] of byWh) {
    for (const r of rows) lines.push({ ...r, warehouse_id: wh });
  }
  const stockDocId = createDocument({
    doc_type: 'out',
    comment: `Отгрузка · УПД ${upd.number} · заказ ${dealId}`,
    organization_id: input.organizationId,
    deal_id: dealId,
    basis_order_id: dealId,
    lines,
    post: true,
  });
  const stockDoc = get<{ number: string }>('SELECT number FROM stock_docs WHERE id = ?', [
    stockDocId,
  ]);
  try {
    linkOutToOrderChain(dealId, stockDocId);
  } catch {
    /* цепочка не блокирует отгрузку */
  }

  return {
    upd,
    stock_doc_id: stockDocId,
    stock_doc_number: stockDoc?.number || null,
    stock_note: `Расходная ${stockDoc?.number || ''} проведена — списание со склада`,
    skipped_services: skippedServices,
  };
}

export function getSalesDoc(
  id: string
): (Row & {
  lines: Row[];
  org: OrgProfile;
  company_id: string;
  company_name: string;
  organization_name: string;
  organization_short: string;
  sts_photos?: ReturnType<typeof stsMediaInfo>;
}) | null {
  const doc = get('SELECT * FROM sales_docs WHERE id = ?', [id]);
  if (!doc) return null;
  const lines = all(
    `SELECT * FROM sales_doc_lines WHERE doc_id = ? ORDER BY line_no, name`,
    [id]
  );
  const orgId = String((doc as { organization_id?: string }).organization_id || '');
  const orgRow = (orgId ? getOrganization(orgId) : undefined) || getDefaultOrganization();
  const org = orgToProfile(orgRow);
  const companyId = String(orgRow?.company_id || '');
  const companyName = companyId ? String(getCompany(companyId)?.name || '').trim() : '';
  const dealId = String((doc as { deal_id?: string }).deal_id || '').trim();
  return {
    ...doc,
    lines,
    org,
    company_id: companyId,
    company_name: companyName,
    organization_name: org.name,
    organization_short: org.short_name || org.name,
    sts_photos: dealId ? stsMediaInfo(dealId) : undefined,
  };
}

export function createSalesDocFromDeal(input: {
  dealId: string;
  docType: SalesDocType;
  vatRate?: number;
  buyerName?: string;
  buyerInn?: string;
  buyerPhone?: string;
  comment?: string;
  createdBy?: string;
  organizationId?: string;
}) {
  const deal = getDeal(input.dealId) as
    | (Row & { items: Array<Record<string, unknown>>; documents: unknown[] })
    | null;
  if (!deal) throw new Error('Сделка не найдена');
  const items = deal.items || [];
  if (!items.length && input.docType !== 'contract') {
    throw new Error('В заказе покупателя нет позиций — сначала добавьте товары');
  }

  const dealIdStr = String(deal.id || input.dealId);
  // После первого счёта юрлицо заказа фиксируется
  const lockedOrg = dealInvoiceOrganizationId(dealIdStr);
  const organizationId = resolveOrganizationId(lockedOrg || input.organizationId);
  const org = getOrgProfile(organizationId);
  const vatRate = input.vatRate ?? (Number(org.vat_rate) || 5);
  const id = newGuid();
  const number = nextSalesNumber(input.docType, dealIdStr);
  const docDate = new Date().toISOString().slice(0, 10);
  const companyName = String(deal.company_name || '').trim();
  const contactName = String(deal.buyer_name || '').trim();
  const isLegalDeal =
    Number(deal.is_legal_entity) === 1 ||
    String(deal.buyer_kind || '').toLowerCase() === 'legal' ||
    Boolean(companyName) ||
    String(deal.buyer_inn || '').replace(/\D/g, '').length === 10;
  // Юрлицо: компания; физик: ФИО контакта (не название сделки с городом/артикулом)
  const buyerName =
    (input.buyerName || '').trim() ||
    (isLegalDeal ? companyName || contactName : contactName || companyName) ||
    String(deal.name || '')
      .replace(/\s+mraer$/i, '')
      .trim() ||
    `Покупатель (заказ ${dealIdStr})`;
  const buyerInn =
    (input.buyerInn || '').trim() || String(deal.buyer_inn || '').trim();
  const buyerPhone =
    (input.buyerPhone || '').trim() || String(deal.buyer_phone || '').trim();

  if (
    (input.docType === 'upd' || input.docType === 'sf') &&
    !isLegalDeal &&
    !buyerInn
  ) {
    throw new Error('УПД / счёт-фактура — для юрлица или при наличии ИНН покупателя. Для физлица — QR / ссылка / счёт (физлицо).');
  }

  let sumTotal = 0;
  const lines: Array<{
    id: string;
    product_guid: string;
    sku: string;
    name: string;
    unit: string;
    qty: number;
    price: number;
    amount: number;
    vat_amount: number;
    line_no: number;
    line_kind: string;
  }> = [];

  items.forEach((it, idx) => {
    const qty = Number(it.qty) || 0;
    const price = Number(it.price) || 0;
    const lineTotal = Number(it.amount) || qty * price;
    const split = splitVat(lineTotal, vatRate);
    sumTotal += split.total;
    const sku = String(it.sku || it.code || '');
    const productGuid = String(it.product_guid || '');
    const name1c = String(it.name_1c || it.product_name_1c || it.name || 'Товар');
    // УПД / счёт / ЗН — фрактал как в заказе покупателя (виджет)
    const disp = customerOrderLineDisplayName({
      product_guid: productGuid,
      name: name1c,
      product_name: name1c,
      mark: String(it.mark || ''),
      model: String(it.model || ''),
      generation: String(it.generation || ''),
      category: String(it.category_name || ''),
    });
    const name = String(it.display_name || disp.display_name || name1c);
    lines.push({
      id: newGuid(),
      product_guid: productGuid,
      sku,
      name,
      unit: String(it.unit || 'шт'),
      qty,
      price,
      amount: split.amount,
      vat_amount: split.vat,
      line_no: idx + 1,
      line_kind: guessLineKind(sku, name1c, productGuid),
    });
  });

  const head = splitVat(sumTotal, vatRate);
  const buyerAddress = buyerPhone ? `тел.: ${buyerPhone}` : '';

  const carPlate = String(deal.car_plate || '').trim().toUpperCase();
  const carVin = String(deal.car_vin || '').trim().toUpperCase();
  const carYear = String(deal.car_year || '').trim();
  const carMileage = String(deal.car_mileage || '').trim();
  const carBrand = String(deal.car_brand || '').trim();
  const carModel = String(deal.car_model || '').trim();
  const carColor = String(deal.car_color || '').trim();
  const carCategory = String(deal.car_category || '').trim();
  const carPts = String(deal.car_pts || '').trim();
  const carOwner = String(deal.car_owner || '').trim();
  const carOwnerStreet = String(deal.car_owner_street || '').trim();
  const carOwnerHouse = String(deal.car_owner_house || '').trim();
  const carOwnerFlat = String(deal.car_owner_flat || '').trim();
  const carStsDate = String(deal.car_sts_date || '').trim();
  const carStsNumber = String(deal.car_sts_number || '').trim();

  // ЗН можно создать без гос. номера — сначала заполняют авто на карточке, потом PDF.

  run('BEGIN');
  try {
    run(
      `INSERT INTO sales_docs (
         id, doc_type, number, doc_date, deal_id,
         counterparty_name, counterparty_inn, buyer_address,
         amount, vat_rate, vat_amount, total, status, comment, created_by, organization_id,
         car_plate, car_vin, car_year, car_mileage,
         car_brand, car_model, car_color, car_category, car_pts,
         car_owner, car_owner_street, car_owner_house, car_owner_flat,
         car_sts_date, car_sts_number
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'issued', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        input.docType,
        number,
        docDate,
        dealIdStr,
        buyerName,
        buyerInn,
        buyerAddress,
        head.amount,
        vatRate,
        head.vat,
        head.total,
        (input.comment || '').trim() || `Из заказа покупателя №${dealIdStr}`,
        input.createdBy || '',
        organizationId,
        carPlate,
        carVin,
        carYear,
        carMileage,
        carBrand,
        carModel,
        carColor,
        carCategory,
        carPts,
        carOwner,
        carOwnerStreet,
        carOwnerHouse,
        carOwnerFlat,
        carStsDate,
        carStsNumber,
      ]
    );
    for (const line of lines) {
      run(
        `INSERT INTO sales_doc_lines (
           id, doc_id, line_no, product_guid, sku, name, unit, qty, price, amount, vat_amount, line_kind
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          line.id,
          id,
          line.line_no,
          line.product_guid,
          line.sku,
          line.name,
          line.unit,
          line.qty,
          line.price,
          line.amount,
          line.vat_amount,
          line.line_kind,
        ]
      );
    }
    run('COMMIT');
  } catch (e) {
    try {
      run('ROLLBACK');
    } catch {
      /* ignore */
    }
    throw e;
  }

  return getSalesDoc(id);
}

function escHtml(s: unknown): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function printShell(title: string, body: string): string {
  return `<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="UTF-8" />
  <title>${escHtml(title)}</title>
  <style>
    @page { size: A4; margin: 10mm; }
    * { box-sizing: border-box; }
    body { font-family: "Times New Roman", Times, serif; font-size: 11px; color: #000; margin: 12px; }
    h1 { font-size: 14px; margin: 10px 0 8px; font-weight: 700; }
    h2 { font-size: 12px; margin: 14px 0 6px; }
    .muted { color: #444; font-size: 10px; }
    table.grid { width: 100%; border-collapse: collapse; margin: 6px 0; }
    table.grid th, table.grid td { border: 1px solid #000; padding: 3px 5px; vertical-align: top; }
    table.grid th { font-weight: 700; text-align: center; background: #f7f7f7; }
    .c { text-align: center; }
    .r { text-align: right; white-space: nowrap; }
    .l { text-align: left; }
    .bank { width: 100%; border-collapse: collapse; margin-bottom: 8px; }
    .bank td { border: 1px solid #000; padding: 4px 6px; vertical-align: top; }
    .party { margin: 4px 0; line-height: 1.35; }
    .totals { margin-top: 6px; text-align: right; line-height: 1.45; }
    .words { margin: 6px 0; font-weight: 700; }
    .sign { display: flex; gap: 24px; margin-top: 18px; }
    .sign > div { flex: 1; }
    .sign .line { border-bottom: 1px solid #000; height: 18px; margin: 8px 0 2px; }
    .warranty { font-size: 10px; line-height: 1.35; margin-top: 10px; }
    .warranty ol { margin: 4px 0 4px 18px; padding: 0; }
    .toolbar { margin-bottom: 10px; }
    .toolbar button { font-family: Tahoma, sans-serif; padding: 6px 14px; cursor: pointer; background: #ffd54f; border: 1px solid #b89600; font-weight: 600; }
    .status-box { float: right; border: 1px solid #000; padding: 4px 8px; font-size: 10px; width: 160px; text-align: left; }
    .clear { clear: both; }
    .doc-logo { margin: 0 0 10px; }
    .doc-logo img { height: 28px; width: auto; max-width: 220px; display: block; }
    .org-stamp { display: block; margin-top: 4px; opacity: 0.92; }
    .org-sign { display: block; margin: 2px 0; opacity: 0.95; }
    .sign-with-stamp { position: relative; min-height: 100px; }
    .sign-with-stamp .org-stamp { position: absolute; left: 36px; top: -6px; pointer-events: none; }
    .sign-with-stamp .org-sign { position: absolute; left: 8px; top: 8px; pointer-events: none; }
    .pay-note { margin: 8px 0; font-size: 10px; line-height: 1.4; color: #333; }
    .pay-qr { display: flex; gap: 14px; align-items: flex-start; margin: 10px 0 4px; }
    .pay-qr img { width: 120px; height: 120px; border: 1px solid #ccc; }
    .pay-qr .hint { font-size: 10px; color: #444; max-width: 280px; margin-top: 28px; }
    @media print { .toolbar { display: none !important; } body { margin: 0; } }
  </style>
</head>
<body>
  <div class="toolbar"><button type="button" onclick="window.print()">Печать / сохранить PDF</button></div>
  <div class="doc-logo"><img src="/logo-pnevmopodveska.svg" alt="" height="28" /></div>
  ${body}
</body>
</html>`;
}

function renderInvoiceHtml(doc: Row & { lines: Row[]; org: OrgProfile }): string {
  const org = doc.org;
  const lines = doc.lines || [];
  const vatRate = Number(doc.vat_rate) || 0;
  const amountNoVat = Number(doc.amount) || 0;
  const vatAmt = Number(doc.vat_amount) || 0;
  const total = Number(doc.total) || 0;
  const purpose = buildInvoicePaymentPurpose({
    number: String(doc.number || ''),
    docDate: String(doc.doc_date || ''),
    amountNoVat,
    vatAmount: vatAmt,
    vatRate,
    total,
  });
  const canQr = Boolean(org.rs && org.bik);
  const rows = lines
    .map(
      (l, i) => `
      <tr>
        <td class="c">${i + 1}</td>
        <td class="l">${escHtml(l.name)}</td>
        <td class="c">${escHtml(l.sku || '')}</td>
        <td class="r">${escHtml(Number(l.qty).toFixed(0) === String(Number(l.qty)) ? Number(l.qty) : Number(l.qty).toFixed(3))}</td>
        <td class="c">${escHtml(l.unit || 'шт')}</td>
        <td class="r">${formatRuMoney(Number(l.price) || 0)}</td>
        <td class="r">${formatRuMoney((Number(l.amount) || 0) + (Number(l.vat_amount) || 0))}</td>
      </tr>`
    )
    .join('');

  const body = `
  <table class="bank">
    <tr>
      <td rowspan="2" style="width:58%">
        <div>${escHtml(org.bank)}</div>
        <div class="muted">Банк получателя</div>
      </td>
      <td style="width:12%">БИК</td>
      <td>${escHtml(org.bik)}</td>
    </tr>
    <tr>
      <td>Сч. №</td>
      <td>${escHtml(org.ks)}</td>
    </tr>
    <tr>
      <td>
        ИНН ${escHtml(org.inn)}${org.kpp ? ` &nbsp; КПП ${escHtml(org.kpp)}` : ''}<br/>
        <b>Получатель</b><br/>
        ${escHtml(org.name)}
      </td>
      <td>Сч. №</td>
      <td>${escHtml(org.rs)}</td>
    </tr>
  </table>
  <h1>Счет на оплату № ${escHtml(doc.number)} от ${escHtml(formatDocDateRu(String(doc.doc_date)))}</h1>
  <div class="party"><b>Поставщик (исполнитель):</b> ${escHtml(org.name)}, ИНН ${escHtml(org.inn)}, ${escHtml(org.address)}</div>
  <div class="party"><b>Покупатель (заказчик):</b> ${escHtml(doc.counterparty_name || '—')}${
    doc.counterparty_inn ? `, ИНН ${escHtml(doc.counterparty_inn)}` : ' (физическое лицо)'
  }${doc.buyer_address ? `, ${escHtml(doc.buyer_address)}` : ''}</div>
  <div class="party"><b>Основание:</b> ${
    doc.deal_id ? `Заказ покупателя № ${escHtml(doc.deal_id)}` : '—'
  }</div>
  <table class="grid">
    <thead>
      <tr>
        <th style="width:4%">№</th>
        <th>Товары (работы, услуги)</th>
        <th style="width:12%">Артикул</th>
        <th style="width:8%">Кол-во</th>
        <th style="width:6%">Ед.</th>
        <th style="width:12%">Цена</th>
        <th style="width:12%">Сумма</th>
      </tr>
      <tr class="muted"><th>1</th><th>2</th><th>3</th><th>4</th><th>5</th><th>6</th><th>7</th></tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>
  <div class="totals">
    <div>Итого: <b>${formatRuMoney(total)}</b></div>
    <div>${
      vatRate > 0
        ? `В том числе НДС ${vatRate}%: <b>${formatRuMoney(vatAmt)}</b>`
        : `Без налога (НДС): <b>${formatRuMoney(0)}</b>`
    }</div>
    <div>Всего к оплате: <b>${formatRuMoney(total)}</b></div>
  </div>
  <div>Всего наименований ${lines.length}, на сумму ${formatRuMoney(total)} руб.</div>
  <div class="words">${escHtml(amountInWordsRu(total))}</div>
  <div class="pay-note">Оплата данного счета означает согласие с условиями поставки. Уведомление об оплате обязательно.
    Назначение платежа: «${escHtml(purpose)}»</div>
  ${
    canQr
      ? `<div class="pay-qr">
    <img src="/api/sales-docs/${escHtml(String(doc.id))}/payment-qr.png" alt="QR для оплаты" width="120" height="120" />
    <div class="hint">QR для оплаты в банковском приложении — реквизиты и назначение подставятся автоматически.</div>
  </div>`
      : ''
  }
  <div class="sign">
    <div class="sign-with-stamp">
      Предприниматель
      <div class="line"></div>
      <div class="muted">подпись</div>
      ${orgSignHtml(org.inn, { height: 44 })}
      ${orgStampHtml(org.inn, { size: 92 })}
    </div>
    <div>
      <div style="margin-top:22px">${escHtml(org.short_name || org.director)}</div>
      <div class="muted">расшифровка подписи</div>
      <div style="margin-top:8px">М.П.</div>
    </div>
  </div>`;
  return printShell(`Счет на оплату № ${doc.number}`, body);
}

function renderUpdHtml(doc: Row & { lines: Row[]; org: OrgProfile }): string {
  const org = doc.org;
  const lines = doc.lines || [];
  const vatRate = Number(doc.vat_rate) || 0;
  const dateRu = formatDocDateRu(String(doc.doc_date));
  const rows = lines
    .map((l, i) => {
      const amount = Number(l.amount) || 0;
      const vat = Number(l.vat_amount) || 0;
      const total = amount + vat;
      const qty = Number(l.qty) || 0;
      const priceNoVat = qty > 0 ? amount / qty : amount;
      return `
      <tr>
        <td class="c">${i + 1}</td>
        <td class="c">${escHtml(l.sku || '')}</td>
        <td class="l">${escHtml(l.name)}</td>
        <td class="c">—</td>
        <td class="c">796</td>
        <td class="c">${escHtml(l.unit || 'шт')}</td>
        <td class="r">${qty || ''}</td>
        <td class="r">${formatRuMoney(priceNoVat)}</td>
        <td class="r">${formatRuMoney(amount)}</td>
        <td class="c">Без акциза</td>
        <td class="c">${vatRate > 0 ? `${vatRate}%` : 'без НДС'}</td>
        <td class="r">${formatRuMoney(vat)}</td>
        <td class="r">${formatRuMoney(total)}</td>
        <td class="c">—</td>
        <td class="c">—</td>
      </tr>`;
    })
    .join('');

  const body = `
  <div class="status-box">
    <b>Статус: 1</b><br/>
    1 – счет-фактура и передаточный документ (акт)<br/>
    2 – передаточный документ (акт)
  </div>
  <div class="muted">Приложение № 1 к постановлению Правительства РФ от 26.12.2011 № 1137</div>
  <h1 style="margin-top:4px">Универсальный передаточный документ</h1>
  <div><b>Счет-фактура № ${escHtml(doc.number)} от ${escHtml(dateRu)}</b> (1)</div>
  <div class="muted">Исправление № -- от -- (1а)</div>
  <div class="clear"></div>
  <div class="party"><b>Продавец:</b> ${escHtml(org.name)} (2)</div>
  <div class="party"><b>Адрес:</b> ${escHtml(org.address)} (2а)</div>
  <div class="party"><b>ИНН/КПП продавца:</b> ${escHtml(org.inn)}${org.kpp ? ` / ${escHtml(org.kpp)}` : ''} (2б)</div>
  <div class="party"><b>Грузоотправитель и его адрес:</b> он же (3)</div>
  <div class="party"><b>Грузополучатель и его адрес:</b> ${escHtml(doc.counterparty_name || '—')} (4)</div>
  <div class="party"><b>Покупатель:</b> ${escHtml(doc.counterparty_name || '—')} (6)
    ${doc.counterparty_inn ? `<br/><b>ИНН/КПП покупателя:</b> ${escHtml(doc.counterparty_inn)} (6б)` : ''}
  </div>
  <div class="party"><b>Валюта:</b> Российский рубль, 643 (7)</div>
  <div class="party"><b>Документ об отгрузке:</b> Универсальный передаточный документ, №${escHtml(doc.number)} от ${escHtml(dateRu)} (5а)</div>
  <table class="grid" style="font-size:10px">
    <thead>
      <tr>
        <th>№ п/п<br/>А</th>
        <th>Код товара/<br/>работ, услуг<br/>Б</th>
        <th>Наименование товара (описание работ, услуг)<br/>1</th>
        <th>Код вида<br/>1а</th>
        <th>код<br/>2</th>
        <th>Ед.<br/>2а</th>
        <th>Кол-во<br/>3</th>
        <th>Цена без<br/>НДС<br/>4</th>
        <th>Стоимость<br/>без НДС<br/>5</th>
        <th>Акциз<br/>6</th>
        <th>Ставка<br/>НДС<br/>7</th>
        <th>Сумма<br/>НДС<br/>8</th>
        <th>Стоимость<br/>с НДС<br/>9</th>
        <th>Страна<br/>10</th>
        <th>ГТД<br/>11</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
    <tfoot>
      <tr>
        <td colspan="8" class="r"><b>Всего к оплате (9)</b></td>
        <td class="r"><b>${formatRuMoney(Number(doc.amount) || 0)}</b></td>
        <td class="c">X</td>
        <td></td>
        <td class="r"><b>${formatRuMoney(Number(doc.vat_amount) || 0)}</b></td>
        <td class="r"><b>${formatRuMoney(Number(doc.total) || 0)}</b></td>
        <td colspan="2"></td>
      </tr>
    </tfoot>
  </table>
  <div class="words">${escHtml(amountInWordsRu(Number(doc.total) || 0))}</div>
  <div class="party" style="margin-top:10px">
    Индивидуальный предприниматель / иное уполномоченное лицо
    &nbsp;&nbsp;____________________ / ${escHtml(org.short_name || org.director)} /
    ${org.ogrnip ? `<br/>ОГРНИП ${escHtml(org.ogrnip)}` : ''}
  </div>
  <div class="party"><b>Основание передачи:</b> Заказ покупателя № ${escHtml(doc.deal_id)}</div>
  <div class="party">Дата отгрузки, передачи (сдачи) « ${escHtml(formatDocDateShort(String(doc.doc_date)).slice(0, 2))} » ${escHtml(formatDocDateRu(String(doc.doc_date)).replace(/^\d+\s/, ''))} [11]</div>
  <div class="sign">
    <div>
      Товар (груз) передал / услуги сдал
      <div class="line"></div>
      ${escHtml(org.short_name || org.director)}
    </div>
    <div>
      Товар (груз) получил / услуги принял
      <div class="line"></div>
      ${escHtml(doc.counterparty_name || '')}
    </div>
  </div>
  <div class="sign">
    <div class="sign-with-stamp">М.П.<br/><span class="muted">${escHtml(org.name)}, ИНН ${escHtml(org.inn)}</span>
      ${orgStampHtml(org.inn, { size: 88 })}
    </div>
    <div>М.П.<br/><span class="muted">${escHtml(doc.counterparty_name || '')}</span></div>
  </div>`;
  return printShell(`УПД № ${doc.number}`, body);
}

function renderWorkorderHtml(doc: Row & { lines: Row[]; org: OrgProfile }): string {
  const org = doc.org;
  const allLines = doc.lines || [];
  const works = allLines.filter((l) => String(l.line_kind) === 'work');
  const goods = allLines.filter((l) => String(l.line_kind) !== 'work');
  // если классификация не сработала — всё в товары
  const workLines = works.length ? works : [];
  const goodsLines = goods.length ? goods : allLines;
  const vatRate = Number(doc.vat_rate) || 0;
  const dateRu = formatDocDateRu(String(doc.doc_date));
  const dateShort = formatDocDateShort(String(doc.doc_date));

  const sumLines = (arr: Row[]) =>
    arr.reduce((s, l) => s + (Number(l.amount) || 0) + (Number(l.vat_amount) || 0), 0);
  const vatLines = (arr: Row[]) => arr.reduce((s, l) => s + (Number(l.vat_amount) || 0), 0);

  const worksTotal = sumLines(workLines);
  const worksVat = vatLines(workLines);
  const goodsTotal = sumLines(goodsLines);
  const goodsVat = vatLines(goodsLines);

  const workRows = workLines
    .map(
      (l, i) => `
      <tr>
        <td class="c">${i + 1}</td>
        <td class="l">${escHtml(l.name)}${l.sku ? `<div class="muted">${escHtml(l.sku)}</div>` : ''}</td>
        <td class="r">${Number(l.qty).toFixed(3)}</td>
        <td class="r">${Number(l.qty).toFixed(3)}</td>
        <td class="r">${formatRuMoney(Number(l.price) || 0)}</td>
        <td class="r">${formatRuMoney((Number(l.amount) || 0) + (Number(l.vat_amount) || 0))}</td>
      </tr>`
    )
    .join('');

  const goodsRows = goodsLines
    .map(
      (l, i) => `
      <tr>
        <td class="c">${i + 1}</td>
        <td class="l">${escHtml(l.name)}${l.sku ? `<div class="muted">арт. ${escHtml(l.sku)}</div>` : ''}</td>
        <td class="r">${Number(l.qty).toFixed(3)}</td>
        <td class="c">${escHtml(l.unit || 'шт')}</td>
        <td class="r">${formatRuMoney(Number(l.price) || 0)}</td>
        <td class="r">${formatRuMoney((Number(l.amount) || 0) + (Number(l.vat_amount) || 0))}</td>
      </tr>`
    )
    .join('');

  const body = `
  <div class="party"><b>ПОСТАВЩИК:</b><br/>
    ${escHtml(org.name)},<br/>
    ИНН ${escHtml(org.inn)}, ${escHtml(org.address)}
  </div>
  <h1>Заказ-наряд № ${escHtml(doc.number)} от ${escHtml(dateRu)}</h1>
  <div class="party"><b>Заказчик:</b> ${escHtml(doc.counterparty_name || '—')}
    ${doc.buyer_address ? ` &nbsp; ${escHtml(doc.buyer_address)}` : ''}
  </div>
  <div class="party">${escHtml(formatWorkorderVehicleLine(doc))}</div>
  <div class="party"><b>Плательщик:</b> ${escHtml(doc.counterparty_name || '—')}${
    doc.buyer_address ? `, ${escHtml(doc.buyer_address)}` : ''
  }</div>
  ${
    doc.deal_id
      ? `<div class="party"><b>Основание:</b> Заказ покупателя № ${escHtml(doc.deal_id)}</div>`
      : ''
  }
  <div class="muted">в валюте RUB</div>

  ${
    workLines.length
      ? `
  <h2>Выполненные работы по заказ-наряду № ${escHtml(doc.number)} от ${escHtml(dateShort)} г.</h2>
  <table class="grid">
    <thead>
      <tr>
        <th>№</th><th>Наименование, артикул работ</th><th>Кол. оп.</th><th>Норма н/ч</th><th>Цена н/ч</th><th>Сумма</th>
      </tr>
    </thead>
    <tbody>${workRows}</tbody>
  </table>
  <div class="totals">
    Итого работ: <b>${formatRuMoney(worksTotal)}</b><br/>
    В том числе НДС${vatRate ? ` ${vatRate}%` : ''}: <b>${formatRuMoney(worksVat)}</b>
  </div>
  <div>Всего оказано Работ ${workLines.length}, на сумму ${formatRuMoney(worksTotal)} RUB</div>
  <div class="words">${escHtml(amountInWordsRu(worksTotal))}</div>`
      : ''
  }

  <h2>${escHtml(formatWorkorderOutHeading(doc, dateShort))}</h2>
  <table class="grid">
    <thead>
      <tr>
        <th>№</th><th>Наименование, характеристика, артикул товаров</th><th>Кол-во</th><th>Ед.изм.</th><th>Цена</th><th>Сумма</th>
      </tr>
    </thead>
    <tbody>${goodsRows || '<tr><td colspan="6">Нет товаров</td></tr>'}</tbody>
  </table>
  <div class="totals">
    Итого: <b>${formatRuMoney(goodsTotal)}</b><br/>
    В том числе НДС${vatRate ? ` ${vatRate}%` : ''}: <b>${formatRuMoney(goodsVat)}</b>
  </div>
  <div>Всего деталей ${goodsLines.length}, на сумму ${formatRuMoney(goodsTotal)} RUB</div>
  <div class="words">${escHtml(amountInWordsRu(goodsTotal))}</div>

  <div class="totals" style="margin-top:12px;font-size:12px">
    <b>Итого по заказ-наряду : ${formatRuMoney(Number(doc.total) || 0)}</b><br/>
    В том числе НДС: ${formatRuMoney(Number(doc.vat_amount) || 0)}
  </div>
  <div class="words">Всего по заказ-наряду: ${escHtml(amountInWordsRu(Number(doc.total) || 0))} в т.ч. НДС ${formatRuMoney(Number(doc.vat_amount) || 0)} RUB</div>

  <div class="party" style="margin-top:14px">
    Мастер _____________________ /${escHtml(org.master_title || 'Мастер-приемщик')}/
  </div>

  <div class="warranty">
    <b>Гарантийные обязательства сторон:</b>
    <ol>
      <li>Гарантийный ремонт проводится при предъявлении гарантийного талона MRAER</li>
      <li>Доставка оборудования, подлежащего гарантийному ремонту, в сервисную службу осуществляется клиентом самостоятельно и за свой счет, если иное не оговорено</li>
      <li>Гарантийные обязательства не распространяются на материалы и детали, считающиеся расходуемыми в процессе эксплуатации.</li>
      <li>Исполнитель при наступлении гарантийного случая в срок не более 5-ти рабочих дней устраняет неисправности.</li>
      <li>Гарантийный срок на пневмоэлемент составляет 24 месяца, амортизатор 12 месяцев.</li>
      <li>Гарантийный срок на компрессор составляет 12 месяцев.</li>
      <li>Гарантийный срок на рулевую рейку составляет 12 месяцев.</li>
      <li>Гарантийный срок на электрическую рулевую рейку составляет 6 месяцев. Гарантия распространяется исключительно на проделанные работы.</li>
    </ol>
    <b>Условия прерывания гарантийных обязательств:</b>
    <ol>
      <li>Несоответствие серийного номера предъявляемого на гарантийное обслуживание оборудования серийному номеру, указанному в товарном счете или других письменных соглашениях.</li>
      <li>Наличие явных или скрытых механических повреждений оборудования, вызванных нарушением правил транспортировки, хранения или эксплуатации.</li>
      <li>Выявленное в процессе ремонта несоответствие Правилам и условиям эксплуатации.</li>
      <li>Повреждение контрольных этикеток и пломб (если таковые имеются).</li>
      <li>Наличие внутри корпуса оборудования посторонних предметов.</li>
      <li>Отказ оборудования, вызванный воздействием факторов непреодолимой силы или действиями третьих лиц.</li>
      <li>На пневмоэлемент не распространяются гарантийные обязательства, если на нём есть следы масла либо других агрессивных жидкостей.</li>
      <li>Отказ оборудования, вызванный неисправностью автомобиля (утечка пневмосистемы, замыкание реле и т.п.).</li>
      <li>Обнаружение в системе рулевого управления посторонних примесей, воды, металлической стружки и т.п.</li>
    </ol>
  </div>
  <div class="sign">
    <div>
      Принят: ${escHtml(dateShort)}<br/>
      Заказчик ______________________ /${escHtml(doc.counterparty_name || '')}/
    </div>
    <div>
      Дата: ${escHtml(dateShort)} г.<br/>
      Заказ-наряд № ${escHtml(doc.number)} от ${escHtml(dateShort)} г.
    </div>
  </div>`;
  return printShell(`Заказ-наряд № ${doc.number}`, body);
}

function renderSfHtml(doc: Row & { lines: Row[]; org: OrgProfile }): string {
  const org = doc.org;
  const lines = doc.lines || [];
  const vatRate = Number(doc.vat_rate) || 0;
  const dateRu = formatDocDateRu(String(doc.doc_date));
  const rows = lines
    .map((l, i) => {
      const amount = Number(l.amount) || 0;
      const vat = Number(l.vat_amount) || 0;
      const total = amount + vat;
      const qty = Number(l.qty) || 0;
      const priceNoVat = qty > 0 ? amount / qty : amount;
      const unit = String(l.unit || 'шт');
      return `
      <tr>
        <td class="c">${i + 1}</td>
        <td class="c">${escHtml(l.sku || '')}</td>
        <td class="l">${escHtml(l.name)}</td>
        <td class="c">—</td>
        <td class="c">796</td>
        <td class="c">${escHtml(unit)}</td>
        <td class="r">${qty || ''}</td>
        <td class="r">${formatRuMoney(priceNoVat)}</td>
        <td class="r">${formatRuMoney(amount)}</td>
        <td class="c">без акциза</td>
        <td class="c">${vatRate > 0 ? `${vatRate}%` : 'без НДС'}</td>
        <td class="r">${formatRuMoney(vat)}</td>
        <td class="r">${formatRuMoney(total)}</td>
        <td class="c">—</td>
        <td class="c">—</td>
      </tr>`;
    })
    .join('');

  const body = `
  <div class="muted" style="text-align:right">Приложение № 1 к постановлению Правительства РФ<br/>от 26.12.2011 № 1137 (в ред. от 23.01.2026 № 26)</div>
  <h1>Счет-фактура № ${escHtml(doc.number)} от ${escHtml(dateRu)}</h1>
  <div class="muted">Исправление № —— от —— (1а)</div>
  <div class="party"><b>Продавец:</b> ${escHtml(org.name)} (2)</div>
  <div class="party"><b>Адрес:</b> ${escHtml(org.address)} (2а)</div>
  <div class="party"><b>ИНН/КПП продавца:</b> ${escHtml(org.inn)}${org.kpp ? ` / ${escHtml(org.kpp)}` : ''} (2б)</div>
  <div class="party"><b>Грузоотправитель и его адрес:</b> он же (3)</div>
  <div class="party"><b>Грузополучатель и его адрес:</b> ${escHtml(doc.counterparty_name || '—')}${doc.buyer_address ? `, ${escHtml(doc.buyer_address)}` : ''} (4)</div>
  <div class="party"><b>К платежно-расчетному документу:</b> — (5)</div>
  <div class="party"><b>Документ об отгрузке:</b> — (5а)</div>
  <div class="party"><b>К платежно-расчетному документу (аванс):</b> — (5б)</div>
  <div class="party"><b>Покупатель:</b> ${escHtml(doc.counterparty_name || '—')} (6)
    ${doc.counterparty_inn ? `<br/><b>ИНН/КПП покупателя:</b> ${escHtml(doc.counterparty_inn)} (6б)` : ''}
  </div>
  <div class="party"><b>Валюта:</b> Российский рубль, 643 (7)</div>
  <table class="grid" style="font-size:10px">
    <thead>
      <tr>
        <th>№ п/п<br/>А</th>
        <th>Код<br/>Б</th>
        <th>Наименование<br/>1</th>
        <th>Код вида<br/>1а</th>
        <th>код<br/>2</th>
        <th>Ед.<br/>2а</th>
        <th>Кол-во<br/>3</th>
        <th>Цена<br/>4</th>
        <th>Без НДС<br/>5</th>
        <th>Акциз<br/>6</th>
        <th>Ставка<br/>7</th>
        <th>НДС<br/>8</th>
        <th>С НДС<br/>9</th>
        <th>Страна<br/>10/10а</th>
        <th>ГТД<br/>11</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
    <tfoot>
      <tr>
        <td colspan="8" class="r"><b>Всего к оплате</b></td>
        <td class="r"><b>${formatRuMoney(Number(doc.amount) || 0)}</b></td>
        <td class="c">X</td>
        <td></td>
        <td class="r"><b>${formatRuMoney(Number(doc.vat_amount) || 0)}</b></td>
        <td class="r"><b>${formatRuMoney(Number(doc.total) || 0)}</b></td>
        <td colspan="2"></td>
      </tr>
    </tfoot>
  </table>
  <div class="words">${escHtml(amountInWordsRu(Number(doc.total) || 0))}</div>
  <div class="sign">
    <div>Руководитель<br/><div class="line"></div>${escHtml(org.director || org.short_name)}</div>
    <div>Главный бухгалтер<br/><div class="line"></div>${escHtml(org.accountant || org.director || org.short_name)}</div>
    <div class="sign-with-stamp">ИП / уполномоченное лицо<br/><div class="line"></div>${escHtml(org.short_name || org.director)}
      ${org.ogrnip ? `<br/><span class="muted">ОГРНИП ${escHtml(org.ogrnip)}</span>` : ''}
      ${orgStampHtml(org.inn, { size: 88 })}
    </div>
  </div>`;
  return printShell(`Счёт-фактура № ${doc.number}`, body);
}

/** HTML-бланк для печати / «Сохранить как PDF». */
export function renderSalesDocPrintHtml(id: string): string | null {
  const doc = getSalesDoc(id);
  if (!doc) return null;
  const type = String(doc.doc_type) as SalesDocType;
  if (type === 'contract') return renderContractDocHtml(doc);
  if (type === 'invoice') return renderInvoiceHtml(doc);
  if (type === 'workorder') return renderWorkorderHtml(doc);
  if (type === 'sf') return renderSfHtml(doc);
  return renderUpdHtml(doc);
}

function contractBuyerFromDoc(doc: Row): ContractBuyer {
  const phoneStored = String(doc.buyer_phone || '').trim();
  const addrRaw = String(doc.buyer_address || '').trim();
  const phoneFromAddr = addrRaw.replace(/^тел\.\s*:?\s*/i, '').trim();
  const address =
    phoneStored && addrRaw.toLowerCase().startsWith('тел')
      ? ''
      : addrRaw.toLowerCase().startsWith('тел')
        ? ''
        : addrRaw;
  return {
    name: String(doc.counterparty_name || ''),
    inn: String(doc.counterparty_inn || ''),
    kpp: String(doc.buyer_kpp || ''),
    ogrn: String(doc.buyer_ogrn || ''),
    address,
    phone: phoneStored || phoneFromAddr || undefined,
    email: String(doc.buyer_email || '') || undefined,
    director: String(doc.buyer_director || '') || undefined,
    bank: String(doc.buyer_bank || '') || undefined,
    bik: String(doc.buyer_bik || '') || undefined,
    rs: String(doc.buyer_rs || '') || undefined,
    ks: String(doc.buyer_ks || '') || undefined,
  };
}

function renderContractDocHtml(doc: Row & { lines: Row[]; org: OrgProfile }): string {
  return renderSaleContractHtml({
    number: String(doc.number || ''),
    docDate: String(doc.doc_date || new Date().toISOString().slice(0, 10)),
    org: doc.org,
    buyer: contractBuyerFromDoc(doc),
    city: 'Краснодар',
  });
}

/** Договор без позиций сделки (из шаблонов / вручную). */
export function createContractDoc(input: {
  dealId?: string;
  organizationId?: string;
  buyerName?: string;
  buyerInn?: string;
  buyerAddress?: string;
  buyerPhone?: string;
  buyerEmail?: string;
  buyerKpp?: string;
  buyerOgrn?: string;
  buyerDirector?: string;
  buyerBank?: string;
  buyerBik?: string;
  buyerRs?: string;
  buyerKs?: string;
  comment?: string;
  createdBy?: string;
}) {
  const dealIdStr = String(input.dealId || '').trim();
  const lockedOrg = dealIdStr ? dealInvoiceOrganizationId(dealIdStr) : '';
  const organizationId = resolveOrganizationId(lockedOrg || input.organizationId);
  const org = getOrgProfile(organizationId);
  const id = newGuid();
  const number = dealIdStr
    ? salesNumberFromDeal('contract', dealIdStr)
    : nextContractNumber();
  const docDate = new Date().toISOString().slice(0, 10);
  let carPlate = '';
  let carVin = '';
  let carYear = '';
  let carMileage = '';
  let buyer: ContractBuyerFields = {
    name: (input.buyerName || '').trim(),
    inn: (input.buyerInn || '').trim(),
    address: (input.buyerAddress || '').trim(),
    phone: (input.buyerPhone || '').trim(),
    email: (input.buyerEmail || '').trim(),
    kpp: (input.buyerKpp || '').trim(),
    ogrn: (input.buyerOgrn || '').trim(),
    director: (input.buyerDirector || '').trim(),
    bank: (input.buyerBank || '').trim(),
    bik: (input.buyerBik || '').trim(),
    rs: (input.buyerRs || '').trim(),
    ks: (input.buyerKs || '').trim(),
  };

  if (dealIdStr) {
    const deal = getDeal(dealIdStr) as Row | null;
    if (!deal) throw new Error('Сделка не найдена');
    buyer = resolveContractBuyerFromDeal(deal, buyer);
    carPlate = String(deal.car_plate || '').trim().toUpperCase();
    carVin = String(deal.car_vin || '').trim().toUpperCase();
    carYear = String(deal.car_year || '').trim();
    carMileage = String(deal.car_mileage || '').trim();
  }

  if (!buyer.name) buyer.name = 'ООО «____________________»';

  run(
    `INSERT INTO sales_docs (
       id, doc_type, number, doc_date, deal_id,
       counterparty_name, counterparty_inn, buyer_address,
       buyer_phone, buyer_email, buyer_kpp, buyer_ogrn, buyer_director,
       buyer_bank, buyer_bik, buyer_rs, buyer_ks,
       amount, vat_rate, vat_amount, total, status, comment, created_by, organization_id,
       car_plate, car_vin, car_year, car_mileage
     ) VALUES (?, 'contract', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, 0, 0, 'issued', ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      number,
      docDate,
      dealIdStr || null,
      buyer.name,
      buyer.inn || '',
      buyer.address || '',
      buyer.phone || '',
      buyer.email || '',
      buyer.kpp || '',
      buyer.ogrn || '',
      buyer.director || '',
      buyer.bank || '',
      buyer.bik || '',
      buyer.rs || '',
      buyer.ks || '',
      Number(org.vat_rate) || 5,
      (input.comment || '').trim() ||
        (dealIdStr ? `Договор по заказу покупателя №${dealIdStr}` : 'Шаблон договора БМП'),
      input.createdBy || '',
      organizationId,
      carPlate,
      carVin,
      carYear,
      carMileage,
    ]
  );
  return getSalesDoc(id);
}
