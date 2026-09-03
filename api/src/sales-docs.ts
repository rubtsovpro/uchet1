/**
 * Журналы: Счёт, УПД, Заказ-наряд (и СФ).
 * Бланки по образцам 1С ПневмоПро / ИП Безматерных Р.П.
 * Организация документа — из справочника organizations (мультиорг).
 */
import { all, get, run, type Row } from './db.js';
import { newGuid } from './ids.js';
import { dealIsLegalEntity, dealSalesDocPackTypes, getDeal, organizationIdForDealRecord } from './deals.js';
import { dealCarPhotosFirstAt } from './deal-car-photos.js';
import {
  nextContractNumber,
  nextInvoiceNumber,
  nextOutNfNumber,
  salesNumberFromDeal,
  nextOrdinalUpdNumber,
  workorderPrintNumber,
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
import { catalogArticleOf, mergeSalesDocLines, salesDocLineDisplayName } from './product-display-name.js';
import { orgSignHtml, orgStampHtml } from './org-stamp.js';
import { orgLogoHtml } from './org-logo.js';
import {
  isWeakBuyerDocName,
  looksLikeAmoNameCityLabel,
  looksLikePersonFio,
  resolvePersonDocFio,
} from './person-fio.js';
import { getLatestPdnSignForDeal } from './pdn-sms-sign.js';
import { warrantyObligationsHtml } from './warranty-settings.js';
import {
  CONTRACT_TEMPLATE_ID,
  renderSaleContractHtml,
  type ContractBuyer,
} from './sale-contract.js';
import {
  getStoDocTemplate,
  isSaleContractTemplateId,
  isStoContractTemplateId,
  isStoWorkorderTemplateId,
  renderStoTemplateHtml,
  suggestContractTemplateId,
  suggestStoContractTemplateId,
  suggestStoWorkorderTemplateId,
  splitStoWorkPartLines,
  STO_CONTRACT_PERSON,
  isStoLegalContractTemplateId,
  STO_WORKORDER_LEGAL,
  STO_WORKORDER_PERSON,
  paymentFieldsFromDeal,
  contactFieldsFromDeal,
  staffFieldsFromDeal,
  handoverFieldsFromDeal,
} from './sto-doc-templates.js';
import { parseStoChecklistJson } from './sto-intake-checklist.js';
import { createDocument, isServiceProduct } from './stock.js';
import { linkOutToOrderChain } from './order-doc-tree.js';
import { buildInvoicePaymentPurpose } from './payment-qr.js';
import { garageForDeal } from './counterparty-vehicles.js';
import { stsMediaInfo, stsMediaInfoForVehicle } from './sts-media.js';

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

/** На одну сделку — один счёт, один УПД, один договор; повтор = перегенерация. */
const SINGLE_DEAL_DOC_TYPES: SalesDocType[] = ['invoice', 'upd', 'contract'];

function latestDealSalesDoc(
  dealId: string,
  docType: SalesDocType
): { id: string; number: string } | null {
  const row = get<{ id: string; number: string }>(
    `SELECT id, number FROM sales_docs
     WHERE deal_id = ? AND doc_type = ?
     ORDER BY datetime(created_at) DESC, number DESC LIMIT 1`,
    [dealId, docType]
  );
  return row?.id ? row : null;
}

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
 * «Списание № Р… к заказ-наряду № {сделка} от … г.»
 */
export function formatWorkorderOutHeading(
  doc: Record<string, unknown> | null | undefined,
  dateShort: string
): string {
  const d = doc || {};
  const dealId = String(d.deal_id || '').trim();
  const wo =
    workorderPrintNumber(dealId, String(d.number || '').trim()) ||
    String(d.number || '').trim() ||
    '—';
  const out =
    findDealOutStockNumber(String(d.deal_id || '')) ||
    // если расходная ещё не создана — ожидаемый номер Р{сделка}
    (() => {
      const deal = String(d.deal_id || '').trim();
      return deal ? `Р${deal}` : '';
    })();
  const datePart = String(dateShort || '').trim();
  if (out) {
    return `Списание № ${out} к заказ-наряду № ${wo}${
      datePart ? ` от ${datePart} г.` : ''
    }`;
  }
  return `Списание к заказ-наряду № ${wo}${datePart ? ` от ${datePart} г.` : ''}`;
}

export function updateSalesDocStoChecklist(
  docId: string,
  patch: {
    checks?: Record<string, boolean>;
    master_name?: string;
    admin_name?: string;
  }
): ReturnType<typeof getSalesDoc> {
  const id = String(docId || '').trim();
  if (!id) throw new Error('doc_id required');
  const row = get<{ id: string; doc_type: string; checklist_json?: string }>(
    `SELECT id, doc_type, IFNULL(checklist_json,'') AS checklist_json FROM sales_docs WHERE id = ?`,
    [id]
  );
  if (!row) throw new Error('Документ не найден');
  if (String(row.doc_type) !== 'workorder') {
    throw new Error('Чек-лист СТО хранится на заказ-наряде');
  }
  const prev = parseStoChecklistJson(row.checklist_json);
  const nextChecks = { ...prev.checks };
  if (patch.checks && typeof patch.checks === 'object') {
    for (const [k, v] of Object.entries(patch.checks)) {
      if (!k) continue;
      if (v) nextChecks[k] = true;
      else delete nextChecks[k];
    }
  }
  const state = {
    checks: nextChecks,
    master_name:
      patch.master_name !== undefined
        ? String(patch.master_name || '').trim()
        : prev.master_name,
    admin_name:
      patch.admin_name !== undefined
        ? String(patch.admin_name || '').trim()
        : prev.admin_name,
    updated_at: new Date().toISOString(),
  };
  run(`UPDATE sales_docs SET checklist_json = ? WHERE id = ?`, [
    JSON.stringify(state),
    id,
  ]);
  return getSalesDoc(id);
}

/** Последний заказ-наряд сделки (для чек-листа приёма/выдачи). */
export function findDealWorkorderForChecklist(
  dealId: string
): { id: string; number: string; checklist_json: string } | null {
  const id = String(dealId || '').trim();
  if (!id) return null;
  return (
    get<{ id: string; number: string; checklist_json: string }>(
      `SELECT id, IFNULL(number,'') AS number, IFNULL(checklist_json,'') AS checklist_json
       FROM sales_docs
       WHERE deal_id = ? AND doc_type = 'workorder'
       ORDER BY datetime(IFNULL(NULLIF(doc_date,''), created_at)) DESC, id DESC
       LIMIT 1`,
      [id]
    ) || null
  );
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

/** Госномер/СТС со сделки → все заказ-наряды этой сделки (после OCR / вкладки Документы). */
export function syncDealVehicleOntoWorkorders(dealId: string): number {
  const id = String(dealId || '').trim();
  if (!id) return 0;
  const deal = getDeal(id) as Record<string, unknown> | null;
  if (!deal) return 0;
  const plate = String(deal.car_plate || '')
    .trim()
    .toUpperCase();
  const vin = String(deal.car_vin || '')
    .trim()
    .toUpperCase();
  run(
    `UPDATE sales_docs
     SET car_plate = ?, car_vin = ?, car_year = ?, car_mileage = ?,
         car_brand = ?, car_model = ?, car_color = ?, car_category = ?, car_pts = ?,
         car_owner = ?, car_owner_street = ?, car_owner_house = ?, car_owner_flat = ?,
         car_sts_date = ?, car_sts_number = ?
     WHERE deal_id = ? AND doc_type = 'workorder'`,
    [
      plate,
      vin,
      String(deal.car_year || '').trim(),
      String(deal.car_mileage || '').trim(),
      String(deal.car_brand || '').trim(),
      String(deal.car_model || '').trim(),
      String(deal.car_color || '').trim(),
      String(deal.car_category || '').trim(),
      String(deal.car_pts || '').trim(),
      String(deal.car_owner || '').trim(),
      String(deal.car_owner_street || '').trim(),
      String(deal.car_owner_house || '').trim(),
      String(deal.car_owner_flat || '').trim(),
      String(deal.car_sts_date || '').trim(),
      String(deal.car_sts_number || '').trim(),
      id,
    ]
  );
  const n = get(
    `SELECT COUNT(*) AS n FROM sales_docs WHERE deal_id = ? AND doc_type = 'workorder'`,
    [id]
  ) as { n?: number } | null;
  return Number(n?.n || 0);
}

/**
 * Перед PDF ЗН: если на документе нет госномера, подтянуть со сделки.
 * @returns true если госномер есть (на ЗН или после sync со сделки)
 */
export function ensureWorkorderCarPlate(docId: string): boolean {
  const doc = getSalesDoc(docId) as Record<string, unknown> | null;
  if (!doc) return false;
  if (String(doc.doc_type || '') !== 'workorder') return true;
  if (String(doc.car_plate || '').trim()) return true;
  const dealId = String(doc.deal_id || '').trim();
  if (!dealId) return false;
  const deal = getDeal(dealId) as Record<string, unknown> | null;
  if (!String(deal?.car_plate || '').trim()) return false;
  syncDealVehicleOntoWorkorders(dealId);
  const again = getSalesDoc(docId) as Record<string, unknown> | null;
  return Boolean(String(again?.car_plate || '').trim());
}

/**
 * Подогнать template_id ЗН под тип покупателя (03ф / 03ю).
 * Если заказ стал юр, а ЗН ещё со старым физ-бланком — печатаем уже 03ю.
 */
export function ensureWorkorderTemplateId(docId: string): string {
  const id = String(docId || '').trim();
  if (!id) return '';
  const row = get<{ doc_type?: string; template_id?: string; deal_id?: string }>(
    `SELECT doc_type, IFNULL(template_id,'') AS template_id, IFNULL(deal_id,'') AS deal_id
     FROM sales_docs WHERE id = ?`,
    [id]
  );
  if (!row || String(row.doc_type || '') !== 'workorder') {
    return String(row?.template_id || '').trim();
  }
  const dealId = String(row.deal_id || '').trim();
  const deal = dealId ? (getDeal(dealId) as Record<string, unknown> | null) : null;
  const want = suggestStoWorkorderTemplateId(deal);
  const cur = String(row.template_id || '').trim();
  if (want && want !== cur) {
    run(`UPDATE sales_docs SET template_id = ? WHERE id = ?`, [want, id]);
    return want;
  }
  return cur || want || STO_WORKORDER_PERSON;
}

export type ContractBuyerFields = {
  name?: string;
  inn?: string;
  kpp?: string;
  ogrn?: string;
  address?: string;
  phone?: string;
  email?: string;
  passport?: string;
  director?: string;
  bank?: string;
  bik?: string;
  rs?: string;
  ks?: string;
};

function contractTemplateOpts(
  deal: Record<string, unknown> | null | undefined,
  buyer: ContractBuyerFields,
  organizationId?: string
) {
  const cp = findCounterpartyForDeal(deal as Row | null);
  const inn = String(buyer.inn || '').replace(/\D/g, '');
  let partyKind = String((cp as { party_kind?: string } | null)?.party_kind || '').toLowerCase();
  if (partyKind !== 'ip' && partyKind !== 'legal') {
    if (inn.length === 10) partyKind = 'legal';
    else if (inn.length === 12) partyKind = 'ip';
    else partyKind = '';
  }
  const companyId = String(deal?.company_id || deal?.amo_company_id || '').trim();
  return {
    organizationId,
    buyerInn: inn,
    ...(partyKind ? { partyKind } : {}),
    ...(companyId ? { companyId } : {}),
  };
}

function findCounterpartyByInn(inn: string): Row | null {
  const digits = String(inn || '').replace(/\D/g, '');
  if (digits.length !== 10 && digits.length !== 12) return null;
  return (
    get(
      `SELECT * FROM counterparties
       WHERE replace(replace(replace(IFNULL(inn,''),' ',''),'-',''), char(9), '') = ?
       ORDER BY CASE WHEN IFNULL(ogrn,'') != '' THEN 0 ELSE 1 END,
                CASE WHEN kind = 'buyer' THEN 0 ELSE 1 END,
                length(IFNULL(name,'')) DESC
       LIMIT 1`,
      [digits]
    ) || null
  );
}

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
    return findCounterpartyByInn(inn);
  }
  return null;
}

/** Реквизиты покупателя для договора: сделка + карточка контрагента. */
export function resolveContractBuyerFromDeal(
  deal: Row | null | undefined,
  overrides: ContractBuyerFields = {}
): ContractBuyerFields {
  let cp = findCounterpartyForDeal(deal);
  const overrideInn = String(overrides.inn || '').replace(/\D/g, '');
  if (!cp && (overrideInn.length === 10 || overrideInn.length === 12)) {
    cp = findCounterpartyByInn(overrideInn);
  } else if (cp && !String(cp.ogrn || '').trim() && (overrideInn.length === 10 || overrideInn.length === 12)) {
    const richer = findCounterpartyByInn(overrideInn);
    if (richer && String(richer.ogrn || '').trim()) cp = richer;
  }
  const companyName = String(deal?.company_name || '').trim();
  const contactName = String(deal?.buyer_name || '').trim();
  const isLegal = dealIsLegalEntity(deal as Record<string, unknown> | null | undefined);
  const nameFromCp = String(cp?.name_full || cp?.name || '').trim();
  // Физлицо: не подставлять ярлык Amo «Имя Город» — ФИО из поля / ПДн.
  const dealId = String(deal?.id || '').trim();
  let pdnFio = '';
  if (!isLegal && dealId) {
    try {
      const s = getLatestPdnSignForDeal(dealId);
      const a = String(s?.identity?.fio || '').trim();
      const b = String(s?.buyer_name || '').trim();
      if (looksLikePersonFio(a)) pdnFio = a;
      else if (looksLikePersonFio(b)) pdnFio = b;
    } catch {
      /* ignore */
    }
  }
  const personFio = !isLegal
    ? resolvePersonDocFio(deal as Record<string, unknown> | null | undefined) ||
      pdnFio ||
      (looksLikePersonFio(nameFromCp) && !looksLikeAmoNameCityLabel(nameFromCp) ? nameFromCp : '')
    : '';
  const inn =
    String(overrides.inn || '').replace(/\D/g, '') ||
    String(cp?.inn || '').replace(/\D/g, '') ||
    String(deal?.buyer_inn || '').replace(/\D/g, '');
  const officialBuyerName = nameFromCp && !isWeakBuyerDocName(nameFromCp) ? nameFromCp : '';
  const overrideName = String(overrides.name || '').trim();
  const legalDealName = (raw: string) => {
    const v = String(raw || '').trim();
    return v && !isWeakBuyerDocName(v) ? v : '';
  };
  const name =
    (!isWeakBuyerDocName(overrideName) ? overrideName : '') ||
    ((inn.length === 10 || inn.length === 12) && officialBuyerName ? officialBuyerName : '') ||
    (isLegal
      ? officialBuyerName || legalDealName(companyName) || legalDealName(contactName)
      : personFio) ||
    officialBuyerName ||
    '';
  const phone =
    String(overrides.phone || '').trim() ||
    String(cp?.phone || '').trim() ||
    String(deal?.buyer_phone || '').trim();
  const email =
    String(overrides.email || '').trim() ||
    String(deal?.buyer_email || '').trim() ||
    String(cp?.email || '').trim();
  const address =
    String(overrides.address || '').trim() ||
    String(cp?.address || '').trim() ||
    String(deal?.buyer_address || '').trim();
  const passport =
    String(overrides.passport || '').trim() ||
    String(deal?.buyer_passport || '').trim();
  const kpp =
    String(overrides.kpp || '').replace(/\D/g, '') ||
    String((deal as { buyer_kpp?: string } | null | undefined)?.buyer_kpp || '').replace(/\D/g, '') ||
    String(cp?.kpp || '').replace(/\D/g, '');
  const ogrn =
    String(overrides.ogrn || '').replace(/\D/g, '') ||
    String((deal as { buyer_ogrn?: string } | null | undefined)?.buyer_ogrn || '').replace(/\D/g, '') ||
    String(cp?.ogrn || '').replace(/\D/g, '');
  let director =
    String(overrides.director || '').trim() ||
    String((deal as { buyer_director?: string } | null | undefined)?.buyer_director || '').trim() ||
    String(cp?.director || '').trim();
  const partyKind = String(
    (cp as { party_kind?: string } | null)?.party_kind ||
      (inn.length === 12 ? 'ip' : inn.length === 10 ? 'legal' : '')
  ).toLowerCase();
  if (partyKind === 'ip' || inn.length === 12) {
    director = '';
  } else if (!director && inn.length === 12) {
    director = name || contactName || '';
  }
  return {
    name,
    inn,
    kpp,
    ogrn,
    address,
    passport,
    phone,
    email,
    director,
    bank:
      String(overrides.bank || '').trim() ||
      String((deal as { buyer_bank?: string } | null | undefined)?.buyer_bank || '').trim() ||
      String(cp?.bank || '').trim(),
    bik:
      String(overrides.bik || '').replace(/\D/g, '') ||
      String((deal as { buyer_bik?: string } | null | undefined)?.buyer_bik || '').replace(
        /\D/g,
        ''
      ) ||
      String(cp?.bik || '').replace(/\D/g, ''),
    rs:
      String(overrides.rs || '').replace(/\D/g, '') ||
      String((deal as { buyer_rs?: string } | null | undefined)?.buyer_rs || '').replace(/\D/g, '') ||
      String(cp?.rs || '').replace(/\D/g, ''),
    ks:
      String(overrides.ks || '').replace(/\D/g, '') ||
      String((deal as { buyer_ks?: string } | null | undefined)?.buyer_ks || '').replace(/\D/g, '') ||
      String(cp?.ks || '').replace(/\D/g, ''),
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
      const isLegal = dealIsLegalEntity(deal as Record<string, unknown>);
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

function mergeSalesDocBuyerName(cur: unknown, next: string | undefined): string {
  const stored = String(cur || '').trim();
  const resolved = String(next || '').trim();
  if (!resolved) return stored;
  if (!stored || isWeakBuyerDocName(stored)) return resolved;
  return stored;
}

function pickSalesDocBuyerField(cur: unknown, next: string | undefined): string {
  const stored = String(cur || '').trim();
  return stored || String(next || '').trim();
}

/** Записать реквизиты покупателя в sales_docs (любой тип). */
function writeSalesDocBuyerFields(docId: string, buyer: ContractBuyerFields): void {
  const id = String(docId || '').trim();
  if (!id) throw new Error('doc_id required');
  const passport = String(buyer.passport ?? '').trim();
  run(
    `UPDATE sales_docs SET
       counterparty_name = ?,
       counterparty_inn = ?,
       buyer_address = ?,
       buyer_phone = ?,
       buyer_email = ?,
       buyer_passport = ?,
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
      passport,
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

export function updateSalesDocBuyer(docId: string, buyer: ContractBuyerFields): void {
  const id = String(docId || '').trim();
  if (!id) throw new Error('doc_id required');
  const row = get<{ doc_type?: string; template_id?: string; deal_id?: string }>(
    'SELECT id, doc_type, IFNULL(template_id,\'\') AS template_id, IFNULL(deal_id,\'\') AS deal_id FROM sales_docs WHERE id = ?',
    [id]
  );
  if (!row) throw new Error('Документ не найден');
  if (String(row.doc_type) !== 'contract') {
    throw new Error('Реквизиты покупателя правятся в договоре');
  }
  writeSalesDocBuyerFields(id, buyer);
  const passport = String(buyer.passport ?? '').trim();
  const dealId = String(row.deal_id || '').trim();
  if (dealId) {
    run(
      `UPDATE crm_deals SET
         buyer_email = ?, buyer_address = ?, buyer_passport = ?,
         updated_at = datetime('now')
       WHERE id = ?`,
      [
        String(buyer.email ?? '').trim(),
        String(buyer.address ?? '').trim(),
        passport,
        dealId,
      ]
    );
  }
  // подобрать шаблон по ИНН покупателя / каналу сделки
  const curTpl = String(row.template_id || '').trim();
  const inn = String(buyer.inn ?? '').replace(/\D/g, '');
  const dealRow = dealId ? (getDeal(dealId) as Record<string, unknown> | null) : null;
  const orgId = String(
    (get<{ organization_id?: string }>(
      `SELECT IFNULL(organization_id,'') AS organization_id FROM sales_docs WHERE id = ?`,
      [id]
    )?.organization_id || '')
  );
  const next = suggestContractTemplateId(
    dealRow || { buyer_inn: inn },
    contractTemplateOpts(dealRow, { inn }, orgId)
  );
  if (curTpl !== next) {
    updateSalesDocContractTemplate(id, next);
  }
}

/** Сменить шаблон договора (01 физ / 02 юр·ИП). */
export function updateSalesDocContractTemplate(docId: string, templateId: string): void {
  const id = String(docId || '').trim();
  const tpl = String(templateId || '').trim();
  if (!id) throw new Error('doc_id required');
  if (!isSaleContractTemplateId(tpl)) {
    throw new Error('Тип договора: физлицо (01), юрлицо СТО (02) или рамочный БМП');
  }
  const row = get<{ doc_type?: string }>('SELECT id, doc_type FROM sales_docs WHERE id = ?', [id]);
  if (!row) throw new Error('Документ не найден');
  if (String(row.doc_type) !== 'contract') {
    throw new Error('Тип меняется только у договора');
  }
  const meta = getStoDocTemplate(tpl);
  const tplTitle =
    meta?.title ||
    (tpl === CONTRACT_TEMPLATE_ID ? 'Договор поставки и услуг (БМП)' : tpl);
  run(
    `UPDATE sales_docs SET template_id = ?, comment = CASE
       WHEN IFNULL(comment,'') = '' OR comment LIKE 'Шаблон договора БМП%'
         OR comment LIKE 'Договор купли-продажи%'
         OR comment LIKE 'Договор ТО%'
         OR comment LIKE 'Договор поставки%'
       THEN ?
       ELSE comment
     END WHERE id = ?`,
    [tpl, tplTitle, id]
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
    passport: String(doc.buyer_passport || ''),
    kpp: String(doc.buyer_kpp || ''),
    ogrn: String(doc.buyer_ogrn || ''),
    director: String(doc.buyer_director || ''),
    bank: String(doc.buyer_bank || ''),
    bik: String(doc.buyer_bik || ''),
    rs: String(doc.buyer_rs || ''),
    ks: String(doc.buyer_ks || ''),
  });
  // Не затираем уже заполненное вручную — только пустые / заглушки Amo
  const merged: ContractBuyerFields = {
    name: mergeSalesDocBuyerName(doc.counterparty_name, resolved.name),
    inn: pickSalesDocBuyerField(doc.counterparty_inn, resolved.inn),
    address: pickSalesDocBuyerField(doc.buyer_address, resolved.address),
    phone: pickSalesDocBuyerField(doc.buyer_phone, resolved.phone),
    email: pickSalesDocBuyerField(doc.buyer_email, resolved.email),
    passport: pickSalesDocBuyerField(doc.buyer_passport, resolved.passport),
    kpp: pickSalesDocBuyerField(doc.buyer_kpp, resolved.kpp),
    ogrn: pickSalesDocBuyerField(doc.buyer_ogrn, resolved.ogrn),
    director: pickSalesDocBuyerField(doc.buyer_director, resolved.director),
    bank: pickSalesDocBuyerField(doc.buyer_bank, resolved.bank),
    bik: pickSalesDocBuyerField(doc.buyer_bik, resolved.bik),
    rs: pickSalesDocBuyerField(doc.buyer_rs, resolved.rs),
    ks: pickSalesDocBuyerField(doc.buyer_ks, resolved.ks),
  };
  const changed =
    merged.name !== String(doc.counterparty_name || '') ||
    merged.inn !== String(doc.counterparty_inn || '') ||
    merged.address !== String(doc.buyer_address || '') ||
    merged.phone !== String(doc.buyer_phone || '') ||
    merged.email !== String(doc.buyer_email || '') ||
    merged.passport !== String(doc.buyer_passport || '') ||
    merged.kpp !== String(doc.buyer_kpp || '') ||
    merged.ogrn !== String(doc.buyer_ogrn || '') ||
    merged.director !== String(doc.buyer_director || '') ||
    merged.bank !== String(doc.buyer_bank || '') ||
    merged.bik !== String(doc.buyer_bik || '') ||
    merged.rs !== String(doc.buyer_rs || '') ||
    merged.ks !== String(doc.buyer_ks || '');
  if (changed) updateSalesDocBuyer(id, merged);
  const curTpl = String(doc.template_id || '').trim();
  const wantTpl = suggestContractTemplateId(
    deal as Record<string, unknown>,
    contractTemplateOpts(deal as Record<string, unknown>, merged, String(doc.organization_id || ''))
  );
  if (curTpl !== wantTpl) {
    updateSalesDocContractTemplate(id, wantTpl);
  }
  return getSalesDoc(id);
}

/** Дозаполнить покупателя в счёте / УПД / СФ из карточки контрагента (виджет «Документы»). */
export function fillSalesDocBuyerFromDeal(docId: string): ReturnType<typeof getSalesDoc> {
  const id = String(docId || '').trim();
  const doc = get('SELECT * FROM sales_docs WHERE id = ?', [id]) as Row | undefined;
  if (!doc) return getSalesDoc(id);
  const type = String(doc.doc_type || '');
  if (!['invoice', 'upd', 'sf'].includes(type)) return getSalesDoc(id);
  const dealId = String(doc.deal_id || '').trim();
  if (!dealId) return getSalesDoc(id);
  const deal = getDeal(dealId) as Row | null;
  const resolved = resolveContractBuyerFromDeal(deal, {
    name: String(doc.counterparty_name || ''),
    inn: String(doc.counterparty_inn || ''),
    address: String(doc.buyer_address || ''),
    phone: String(doc.buyer_phone || ''),
    email: String(doc.buyer_email || ''),
  });
  const merged: ContractBuyerFields = {
    name: mergeSalesDocBuyerName(doc.counterparty_name, resolved.name),
    inn: pickSalesDocBuyerField(doc.counterparty_inn, resolved.inn),
    address: pickSalesDocBuyerField(doc.buyer_address, resolved.address),
    phone: pickSalesDocBuyerField(doc.buyer_phone, resolved.phone),
    email: pickSalesDocBuyerField(doc.buyer_email, resolved.email),
    passport: '',
    kpp: '',
    ogrn: '',
    director: '',
    bank: '',
    bik: '',
    rs: '',
    ks: '',
  };
  const changed =
    merged.name !== String(doc.counterparty_name || '') ||
    merged.inn !== String(doc.counterparty_inn || '') ||
    merged.address !== String(doc.buyer_address || '') ||
    merged.phone !== String(doc.buyer_phone || '') ||
    merged.email !== String(doc.buyer_email || '');
  if (changed) writeSalesDocBuyerFields(id, merged);
  return getSalesDoc(id);
}

function salesDocConsigneeLine(doc: Row): string {
  const name = String(doc.counterparty_name || '—').trim();
  const addr = String(doc.buyer_address || '').trim();
  return addr ? `${name}, ${addr}` : name;
}

function money(n: number): string {
  return String(Math.round(Number(n) || 0));
}

/** 87900 → «87 900» (целые рубли) */
export function formatRuMoney(n: number): string {
  const r = money(n);
  return r.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
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

function nextSalesNumber(
  docType: SalesDocType,
  dealId?: string,
  organizationId?: string
): string {
  const deal = String(dealId || '').trim();
  if (docType === 'upd') {
    const orgId = String(organizationId || '').trim();
    if (orgId) return nextOrdinalUpdNumber(orgId);
  }
  if (deal) return salesNumberFromDeal(docType, deal);
  if (docType === 'invoice') return nextInvoiceNumber();
  if (docType === 'contract') return nextContractNumber();
  // Без сделки — серия 1С 00НФ-
  return nextOutNfNumber();
}

/** УПД24792021 → порядковый № по ИНН продавца (старый формат привязки к сделке). */
function fixOrdinalUpdNumberIfLegacy(existingNumber: string, organizationId: string): string {
  const n = String(existingNumber || '').trim();
  if (/^\d+$/.test(n)) return n;
  if (/^УПД/i.test(n)) return nextOrdinalUpdNumber(organizationId);
  return n;
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
    if (type === 'upd') {
      where.push(`s.doc_type IN ('upd', 'sf')`);
    } else {
      where.push('s.doc_type = ?');
      params.push(type);
    }
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
      `(s.number LIKE ? OR s.counterparty_name LIKE ? OR IFNULL(s.counterparty_inn,'') LIKE ? OR s.deal_id LIKE ? OR s.comment LIKE ?
        OR IFNULL(o.name,'') LIKE ? OR IFNULL(o.short_name,'') LIKE ? OR IFNULL(o.inn,'') LIKE ?
        OR IFNULL(co.name,'') LIKE ? OR IFNULL(d.name,'') LIKE ?)`
    );
    const like = `%${q}%`;
    params.push(like, like, like, like, like, like, like, like, like, like);
  }
  const sqlWhere = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const orderBy =
    type === 'upd' || type === 'sf'
      ? `ORDER BY CAST(s.number AS INTEGER) DESC, datetime(s.doc_date) DESC`
      : type
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
            IFNULL(d.name,'') AS deal_name,
            ${DEAL_PAYMENT_LABEL_SQL} AS payment_label
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

export type UpdRegistryRow = {
  doc_id: string;
  number: string;
  doc_date: string;
  deal_id: string;
  counterparty_name: string;
  counterparty_inn: string;
  line_no: number;
  name: string;
  sku: string;
  qty: number;
  amount: number;
  organization_id: string;
  organization_short: string;
  organization_name: string;
  organization_inn: string;
  company_name: string;
};

/** Статус оплаты заказа для реестра УПД / списка документов. */
const DEAL_PAYMENT_LABEL_SQL = `CASE
  WHEN IFNULL(TRIM(s.deal_id), '') = '' THEN ''
  WHEN EXISTS (
    SELECT 1 FROM deal_payments dp
    WHERE dp.deal_id = s.deal_id
      AND dp.status IN ('paid','confirmed','success','active')
  ) OR IFNULL(d.paid, 0) = 1
    OR LOWER(IFNULL(d.payment_status, '')) IN ('paid','оплачен','оплачено','success')
  THEN 'Оплачено'
  ELSE 'Не оплачено'
END`;

function buildUpdRegistryWhere(opts: {
  q?: string;
  companyId?: string;
  companyIds?: string[];
}): { sqlWhere: string; params: Array<string | number> } {
  const q = (opts.q || '').trim();
  const companyId = (opts.companyId || '').trim();
  const companyIds = Array.isArray(opts.companyIds)
    ? [...new Set(opts.companyIds.map((x) => String(x || '').trim()).filter(Boolean))]
    : [];
  const where: string[] = [`s.doc_type IN ('upd', 'sf')`];
  const params: Array<string | number> = [];
  if (companyId) {
    where.push(`IFNULL(o.company_id,'') = ?`);
    params.push(companyId);
  } else if (companyIds.length) {
    where.push(`IFNULL(o.company_id,'') IN (${companyIds.map(() => '?').join(',')})`);
    params.push(...companyIds);
  }
  if (q) {
    where.push(
      `(s.number LIKE ? OR s.counterparty_name LIKE ? OR IFNULL(s.counterparty_inn,'') LIKE ? OR s.deal_id LIKE ? OR s.comment LIKE ?
        OR IFNULL(o.name,'') LIKE ? OR IFNULL(o.short_name,'') LIKE ? OR IFNULL(o.inn,'') LIKE ?
        OR IFNULL(co.name,'') LIKE ? OR IFNULL(d.name,'') LIKE ?)`
    );
    const like = `%${q}%`;
    params.push(like, like, like, like, like, like, like, like, like, like);
  }
  return { sqlWhere: `WHERE ${where.join(' AND ')}`, params };
}

/** Строки реестра УПД (все позиции) для PDF — без пагинации списка. */
export function listUpdRegistryRows(opts: {
  q?: string;
  companyId?: string;
  companyIds?: string[];
  limit?: number;
}): { rows: UpdRegistryRow[]; truncated: boolean } {
  const limit = Math.min(10000, Math.max(1, opts.limit ?? 10000));
  const { sqlWhere, params } = buildUpdRegistryWhere(opts);
  const fromJoins = `FROM sales_docs s
       JOIN sales_doc_lines l ON l.doc_id = s.id
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
  const rows = all(
    `SELECT s.id AS doc_id, s.number, s.doc_date, IFNULL(s.deal_id,'') AS deal_id,
            IFNULL(s.counterparty_name,'') AS counterparty_name,
            IFNULL(s.counterparty_inn,'') AS counterparty_inn,
            l.line_no, IFNULL(l.name,'') AS name, IFNULL(l.sku,'') AS sku,
            IFNULL(l.qty,0) AS qty, IFNULL(l.amount,0) AS amount,
            IFNULL(s.organization_id,'') AS organization_id,
            IFNULL(co.name,'') AS company_name,
            IFNULL(NULLIF(TRIM(o.short_name), ''), o.name) AS organization_short,
            IFNULL(o.name,'') AS organization_name,
            IFNULL(o.inn,'') AS organization_inn
     ${fromJoins}
     ${sqlWhere}
     ORDER BY IFNULL(co.name,''), IFNULL(o.inn,''), IFNULL(o.name,''),
              datetime(s.doc_date) DESC, CAST(s.number AS INTEGER) DESC, l.line_no
     LIMIT ?`,
    [...params, limit + 1]
  ) as UpdRegistryRow[];
  const truncated = total > limit || rows.length > limit;
  return { rows: rows.slice(0, limit), truncated };
}

/** Документы УПД (1 строка = 1 УПД) для PDF бухгалтеру: дата / покупатель / ИНН / сумма. */
export type UpdRegistryDoc = {
  doc_id: string;
  number: string;
  doc_date: string;
  deal_id: string;
  counterparty_name: string;
  counterparty_inn: string;
  amount: number;
  payment_label: string;
  organization_id: string;
  organization_short: string;
  organization_name: string;
  organization_inn: string;
  company_name: string;
  /** Строка пропуска в PDF-реестре (номер не использовался). */
  registry_gap?: boolean;
  registry_gap_note?: string;
};

function updRegistryOrdinal(number: string): number {
  return parseInt(String(number || '').replace(/\D/g, ''), 10) || 0;
}

function inferUpdGapDocDate(gapNum: number, docs: UpdRegistryDoc[]): string {
  let bestNum = -1;
  let bestDate = '';
  for (const d of docs) {
    const n = updRegistryOrdinal(d.number);
    if (n > 0 && n < gapNum && n > bestNum) {
      bestNum = n;
      bestDate = String(d.doc_date || '').slice(0, 10);
    }
  }
  if (bestDate) return bestDate;
  for (const d of docs) {
    const n = updRegistryOrdinal(d.number);
    if (n > gapNum) return String(d.doc_date || '').slice(0, 10);
  }
  return String(docs[0]?.doc_date || '').slice(0, 10);
}

function buildUpdRegistryGapNote(gapNum: number, docs: UpdRegistryDoc[]): string {
  let refNum = 0;
  let refDate = '';
  for (const d of docs) {
    if (d.registry_gap) continue;
    const n = updRegistryOrdinal(d.number);
    if (n > 0 && n < gapNum && n > refNum) {
      refNum = n;
      refDate = String(d.doc_date || '').slice(0, 10);
    }
  }
  const refDateRu = refDate
    ? `${refDate.slice(8, 10)}.${refDate.slice(5, 7)}.${refDate.slice(0, 4)}`
    : '';
  if (refNum > 0) {
    return `Номер не использовался: технический пропуск при пересоздании УПД №${refNum}${refDateRu ? ` от ${refDateRu}` : ''}. Первичный документ не формировался, контрагенту не передавался.`;
  }
  return 'Номер не использовался: технический пропуск. Первичный документ не формировался, контрагенту не передавался.';
}

/** Добавить в реестр строки пропущенных номеров (дыры в серии внутри min…max). */
export function injectUpdRegistryGaps(docs: UpdRegistryDoc[]): UpdRegistryDoc[] {
  const real = docs.filter((d) => !d.registry_gap);
  if (!real.length) return docs;
  const ordinals = real.map((d) => updRegistryOrdinal(d.number)).filter((n) => n > 0);
  if (!ordinals.length) return docs;
  const min = Math.min(...ordinals);
  const max = Math.max(...ordinals);
  const existing = new Set(ordinals);
  const template = real[0];
  const gaps: UpdRegistryDoc[] = [];
  for (let n = min; n <= max; n++) {
    if (existing.has(n)) continue;
    const note = buildUpdRegistryGapNote(n, real);
    gaps.push({
      doc_id: `registry-gap:${template.organization_id}:${n}`,
      number: String(n),
      doc_date: inferUpdGapDocDate(n, real),
      deal_id: '',
      counterparty_name: note,
      counterparty_inn: '',
      amount: 0,
      payment_label: '—',
      organization_id: template.organization_id,
      organization_short: template.organization_short,
      organization_name: template.organization_name,
      organization_inn: template.organization_inn,
      company_name: template.company_name,
      registry_gap: true,
      registry_gap_note: note,
    });
  }
  if (!gaps.length) return docs;
  return sortUpdRegistryDocsByNumber([...real, ...gaps]);
}

function sortUpdRegistryDocsByNumber(docs: UpdRegistryDoc[]): UpdRegistryDoc[] {
  return [...docs].sort((a, b) => {
    const na = parseInt(String(a.number || '').replace(/\D/g, ''), 10) || 0;
    const nb = parseInt(String(b.number || '').replace(/\D/g, ''), 10) || 0;
    if (nb !== na) return nb - na;
    return String(b.doc_date || '').localeCompare(String(a.doc_date || ''));
  });
}

export function listUpdRegistryDocs(opts: {
  q?: string;
  companyId?: string;
  companyIds?: string[];
  limit?: number;
}): { docs: UpdRegistryDoc[]; truncated: boolean } {
  const limit = Math.min(10000, Math.max(1, opts.limit ?? 10000));
  const { sqlWhere, params } = buildUpdRegistryWhere(opts);
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
  const docs = all(
    `SELECT s.id AS doc_id, s.number, s.doc_date, IFNULL(s.deal_id,'') AS deal_id,
            IFNULL(s.counterparty_name,'') AS counterparty_name,
            IFNULL(s.counterparty_inn,'') AS counterparty_inn,
            IFNULL(NULLIF(s.total, 0), IFNULL(s.amount, 0)) AS amount,
            ${DEAL_PAYMENT_LABEL_SQL} AS payment_label,
            IFNULL(s.organization_id,'') AS organization_id,
            IFNULL(co.name,'') AS company_name,
            IFNULL(NULLIF(TRIM(o.short_name), ''), o.name) AS organization_short,
            IFNULL(o.name,'') AS organization_name,
            IFNULL(o.inn,'') AS organization_inn
     ${fromJoins}
     ${sqlWhere}
     ORDER BY IFNULL(co.name,''), IFNULL(o.inn,''), IFNULL(o.name,''),
              CAST(s.number AS INTEGER) DESC, datetime(s.doc_date) DESC
     LIMIT ?`,
    [...params, limit + 1]
  ) as UpdRegistryDoc[];
  const truncated = total > limit || docs.length > limit;
  return { docs: sortUpdRegistryDocsByNumber(docs.slice(0, limit)), truncated };
}

/** Создать пакет: счёт + заказ-наряд + УПД (и опционально СФ). */
export function createSalesDocPackFromDeal(input: {
  dealId: string;
  types?: SalesDocType[];
  vatRate?: number;
  buyerName?: string;
  buyerInn?: string;
  buyerAddress?: string;
  createdBy?: string;
  organizationId?: string;
}) {
  const deal = getDeal(input.dealId) as Record<string, unknown> | null;
  if (!deal) throw new Error('Сделка не найдена');
  let types = input.types?.length
    ? [...input.types]
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
        buyerAddress: input.buyerAddress,
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
          ? 'УПД создан. В заказе только услуги — списание не нужно.'
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
    // bc:… — скан штрихкода без экземпляра; в расходную как qty без серийников
    const realSerials = serials.filter((s) => !/^bc:/i.test(s));
    const barcodePicks = serials.length - realSerials.length;
    if (realSerials.length) {
      list.push({
        product_id: productId,
        qty: realSerials.length,
        serials: realSerials,
      });
      if (barcodePicks > 0) {
        const existing = list.find((r) => r.product_id === productId && !r.serials.length);
        if (existing) existing.qty += barcodePicks;
        else list.push({ product_id: productId, qty: barcodePicks, serials: [] });
      }
    } else if (barcodePicks > 0) {
      list.push({
        product_id: productId,
        qty: barcodePicks,
        serials: [],
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
    stock_note: `Списание ${stockDoc?.number || ''} проведено`,
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
    `SELECT l.*,
            IFNULL(p.code,'') AS product_code,
            IFNULL(p.barcode,'') AS product_barcode,
            IFNULL(p.array_sku,'') AS product_array_sku,
            IFNULL(p.sku,'') AS product_sku
     FROM sales_doc_lines l
     LEFT JOIN products p ON p.id = NULLIF(TRIM(IFNULL(l.product_guid,'')), '')
     WHERE l.doc_id = ?
     ORDER BY l.line_no, l.name`,
    [id]
  ).map((raw) => {
    const row = raw as Row;
    const lineSku = String(row.sku || '').trim();
    const art = catalogArticleOf({
      sku: String(row.product_sku || lineSku || ''),
      code: String(row.product_code || ''),
      barcode: String(row.product_barcode || ''),
      array_sku: String(row.product_array_sku || ''),
    });
    // В строке продажи sku часто уже каталожный (из заказа); не затираем его НФ-кодом.
    const article =
      lineSku && !/^(00)?НФ-|УСЛ-/i.test(lineSku) ? lineSku : art.article || lineSku;
    const code = art.code || String(row.product_code || '').trim();
    const {
      product_code: _pc,
      product_barcode: _pb,
      product_array_sku: _pa,
      product_sku: _ps,
      ...rest
    } = row as Row & Record<string, unknown>;
    return {
      ...rest,
      article,
      code: code || undefined,
      name: salesDocLineDisplayName({
        ...(rest as Record<string, unknown>),
        name: String(row.name || ''),
        product_guid: String(row.product_guid || ''),
      }),
    };
  });
  const orgId = String((doc as { organization_id?: string }).organization_id || '');
  const orgRow = (orgId ? getOrganization(orgId) : undefined) || getDefaultOrganization();
  const org = orgToProfile(orgRow);
  const companyId = String(orgRow?.company_id || '');
  const companyName = companyId ? String(getCompany(companyId)?.name || '').trim() : '';
  const dealId = String((doc as { deal_id?: string }).deal_id || '').trim();
  let sts_photos = dealId ? stsMediaInfo(dealId) : undefined;
  // предпочитаем СТС выбранного авто гаража (не общие фото сделки)
  if (dealId) {
    const plateN = String((doc as { car_plate?: string }).car_plate || '')
      .trim()
      .toUpperCase()
      .replace(/\s+/g, '');
    if (plateN) {
      const match = garageForDeal(dealId).vehicles.find(
        (v) =>
          String(v.car_plate || '')
            .trim()
            .toUpperCase()
            .replace(/\s+/g, '') === plateN
      );
      if (match) {
        const vp = stsMediaInfoForVehicle(match.id);
        if (vp.front || vp.back) sts_photos = vp;
      }
    }
  }
  return {
    ...doc,
    lines,
    org,
    company_id: companyId,
    company_name: companyName,
    organization_name: org.name,
    organization_short: org.short_name || org.name,
    sts_photos,
  };
}

/**
 * НДС для счёта / УПД / СФ: явный input → ответ по юр/ИП на заказе → ставка организации.
 * buyer_vat: '' | no | yes; buyer_vat_rate — % при yes.
 */
export function resolveVatRateForDeal(
  deal: Record<string, unknown> | null | undefined,
  orgVatRate: number,
  explicit?: number
): number {
  if (explicit != null && Number.isFinite(Number(explicit))) {
    return Math.max(0, Number(explicit));
  }
  const kind = String(deal?.buyer_kind || '').toLowerCase();
  const isLegalish =
    kind === 'legal' ||
    kind === 'ip' ||
    Number(deal?.is_legal_entity) === 1;
  if (isLegalish) {
    const mode = String(deal?.buyer_vat || '')
      .trim()
      .toLowerCase();
    if (mode === 'no' || mode === 'none' || mode === '0') return 0;
    if (mode === 'yes' || mode === '1') {
      const r = Number(deal?.buyer_vat_rate);
      if (Number.isFinite(r) && r >= 0) return r;
    }
  }
  return Number(orgVatRate) || 0;
}

export function createSalesDocFromDeal(input: {
  dealId: string;
  docType: SalesDocType;
  vatRate?: number;
  buyerName?: string;
  buyerInn?: string;
  buyerAddress?: string;
  buyerPhone?: string;
  comment?: string;
  createdBy?: string;
  organizationId?: string;
}): Row & { lines: Row[]; org: OrgProfile; regenerated?: boolean } {
  const deal = getDeal(input.dealId) as
    | (Row & { items: Array<Record<string, unknown>>; documents: unknown[] })
    | null;
  if (!deal) throw new Error('Сделка не найдена');
  const items = deal.items || [];
  if (!items.length && input.docType !== 'contract') {
    throw new Error('В заказе покупателя нет позиций — сначала добавьте товары');
  }

  const dealIdStr = String(deal.id || input.dealId);
  // После первого счёта юрлицо заказа фиксируется; иначе — контур из филиала Amo.
  const organizationId = organizationIdForDealRecord(deal as Record<string, unknown>, input.organizationId);
  const org = getOrgProfile(organizationId);
  const vatRate = resolveVatRateForDeal(
    deal as Record<string, unknown>,
    Number(org.vat_rate) || 0,
    input.vatRate
  );
  let id = newGuid();
  let number = '';
  let regenerated = false;
  if (SINGLE_DEAL_DOC_TYPES.includes(input.docType)) {
    const existing = latestDealSalesDoc(dealIdStr, input.docType);
    if (existing) {
      id = existing.id;
      number = String(existing.number || '');
      regenerated = true;
      if (input.docType === 'upd' && organizationId) {
        number = fixOrdinalUpdNumberIfLegacy(number, organizationId);
      }
    }
  }
  if (!number) {
    number = nextSalesNumber(input.docType, dealIdStr, organizationId);
  }
  const docDate = new Date().toISOString().slice(0, 10);
  const buyerResolved = resolveContractBuyerFromDeal(deal as Row, {
    name: (input.buyerName || '').trim(),
    inn: (input.buyerInn || '').trim(),
    address: (input.buyerAddress || '').trim(),
    phone: (input.buyerPhone || '').trim(),
  });
  const companyName = String(deal.company_name || '').trim();
  const contactName = String(deal.buyer_name || '').trim();
  const isLegalDeal = dealIsLegalEntity(deal as Record<string, unknown>);
  const buyerName =
    buyerResolved.name ||
    (input.buyerName || '').trim() ||
    (isLegalDeal ? companyName || contactName : contactName || companyName) ||
    String(deal.name || '')
      .replace(/\s+mraer$/i, '')
      .trim() ||
    `Покупатель (заказ ${dealIdStr})`;
  const buyerInn =
    buyerResolved.inn ||
    (input.buyerInn || '').trim() ||
    String(deal.buyer_inn || '').trim();
  const buyerPhone =
    buyerResolved.phone ||
    (input.buyerPhone || '').trim() ||
    String(deal.buyer_phone || '').trim();
  const buyerEmail = buyerResolved.email || String(deal.buyer_email || '').trim();
  const buyerPassport = String(deal.buyer_passport || '').trim();
  const buyerAddress = buyerResolved.address || String(deal.buyer_address || '').trim();
  const buyerKpp = buyerResolved.kpp || String(deal.buyer_kpp || '').replace(/\D/g, '');
  const buyerOgrn = buyerResolved.ogrn || String(deal.buyer_ogrn || '').replace(/\D/g, '');
  const buyerDirector = buyerResolved.director || String(deal.buyer_director || '').trim();
  const buyerBank = buyerResolved.bank || String(deal.buyer_bank || '').trim();
  const buyerBik = buyerResolved.bik || String(deal.buyer_bik || '').replace(/\D/g, '');
  const buyerRs = buyerResolved.rs || String(deal.buyer_rs || '').replace(/\D/g, '');
  const buyerKs = buyerResolved.ks || String(deal.buyer_ks || '').replace(/\D/g, '');

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
    const sku = String(it.sku || it.code || '');
    const productGuid = String(it.product_guid || '');
    const name = salesDocLineDisplayName(it);
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
      line_kind: guessLineKind(sku, name, productGuid),
    });
  });

  const mergedLines = mergeSalesDocLines(lines);
  sumTotal = mergedLines.reduce((s, l) => s + l.amount + l.vat_amount, 0);
  const head = splitVat(sumTotal, vatRate);

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
  const workorderTemplateId =
    input.docType === 'workorder'
      ? suggestStoWorkorderTemplateId(deal as Record<string, unknown>)
      : '';

  run('BEGIN');
  try {
    const comment = (input.comment || '').trim() || `Из заказа покупателя №${dealIdStr}`;
    const headParams = [
      number,
      docDate,
      dealIdStr,
      buyerName,
      buyerInn,
      buyerAddress,
      buyerPhone,
      buyerEmail,
      buyerPassport,
      buyerKpp,
      buyerOgrn,
      buyerDirector,
      buyerBank,
      buyerBik,
      buyerRs,
      buyerKs,
      head.amount,
      vatRate,
      head.vat,
      head.total,
      comment,
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
      workorderTemplateId,
    ];
    if (regenerated) {
      run(
        `UPDATE sales_docs SET
           number = ?, doc_date = ?, deal_id = ?,
           counterparty_name = ?, counterparty_inn = ?, buyer_address = ?,
           buyer_phone = ?, buyer_email = ?, buyer_passport = ?,
           buyer_kpp = ?, buyer_ogrn = ?, buyer_director = ?,
           buyer_bank = ?, buyer_bik = ?, buyer_rs = ?, buyer_ks = ?,
           amount = ?, vat_rate = ?, vat_amount = ?, total = ?, status = 'issued', comment = ?,
           created_by = ?, organization_id = ?,
           car_plate = ?, car_vin = ?, car_year = ?, car_mileage = ?,
           car_brand = ?, car_model = ?, car_color = ?, car_category = ?, car_pts = ?,
           car_owner = ?, car_owner_street = ?, car_owner_house = ?, car_owner_flat = ?,
           car_sts_date = ?, car_sts_number = ?, template_id = ?
         WHERE id = ?`,
        [...headParams, id]
      );
      run(`DELETE FROM sales_doc_lines WHERE doc_id = ?`, [id]);
    } else {
      run(
        `INSERT INTO sales_docs (
           id, doc_type, number, doc_date, deal_id,
           counterparty_name, counterparty_inn, buyer_address,
           buyer_phone, buyer_email, buyer_passport,
           buyer_kpp, buyer_ogrn, buyer_director,
           buyer_bank, buyer_bik, buyer_rs, buyer_ks,
           amount, vat_rate, vat_amount, total, status, comment, created_by, organization_id,
           car_plate, car_vin, car_year, car_mileage,
           car_brand, car_model, car_color, car_category, car_pts,
           car_owner, car_owner_street, car_owner_house, car_owner_flat,
           car_sts_date, car_sts_number, template_id
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'issued', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id,
          input.docType,
          ...headParams,
        ]
      );
    }
    for (const line of mergedLines) {
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

  const saved = getSalesDoc(id);
  if (!saved) throw new Error('Документ не найден после сохранения');
  if (SINGLE_DEAL_DOC_TYPES.includes(input.docType)) {
    purgeDuplicateDealSalesDocs(dealIdStr, input.docType, id);
  }
  return Object.assign(saved, { regenerated });
}

function purgeDuplicateDealSalesDocs(dealId: string, docType: SalesDocType, keepId: string): void {
  const dupes = all<{ id: string }>(
    `SELECT id FROM sales_docs WHERE deal_id = ? AND doc_type = ? AND id != ?`,
    [dealId, docType, keepId]
  );
  if (!dupes.length) return;
  for (const row of dupes) {
    const did = String(row.id || '').trim();
    if (!did) continue;
    run(`DELETE FROM sales_doc_lines WHERE doc_id = ?`, [did]);
    run(`DELETE FROM sales_docs WHERE id = ?`, [did]);
  }
}

function escHtml(s: unknown): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function printShell(title: string, body: string, orgInn?: string): string {
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
    .l { text-align: left; word-wrap: break-word; overflow-wrap: break-word; }
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
    .sign-with-stamp { position: relative; min-height: 42mm; }
    .sign-with-stamp .org-sign { position: absolute; left: 2mm; top: 6mm; height: 12mm; width: auto; max-width: 50mm; pointer-events: none; }
    .sign-with-stamp .org-stamp { position: absolute; left: 14mm; top: 10mm; width: 38mm; height: 38mm; pointer-events: none; opacity: 0.9; }
    .pay-note { margin: 8px 0; font-size: 10px; line-height: 1.4; color: #333; }
    .pay-qr { display: flex; gap: 14px; align-items: flex-start; margin: 10px 0 4px; }
    .pay-qr img { width: 120px; height: 120px; border: 1px solid #ccc; }
    .pay-qr .hint { font-size: 10px; color: #444; max-width: 280px; margin-top: 28px; }
    @media print { .toolbar { display: none !important; } body { margin: 0; } }
  </style>
</head>
<body>
  <div class="toolbar"><button type="button" onclick="window.print()">Печать / сохранить PDF</button></div>
  ${orgLogoHtml({ height: 28, orgInn })}
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
      ${orgSignHtml(org.inn, { heightMm: 12 })}
      ${orgStampHtml(org.inn, { sizeMm: 38 })}
    </div>
    <div>
      <div style="margin-top:22px">${escHtml(org.short_name || org.director)}</div>
      <div class="muted">расшифровка подписи</div>
      <div style="margin-top:8px">М.П.</div>
    </div>
  </div>`;
  return printShell(`Счет на оплату № ${doc.number}`, body, org.inn);
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
  <div class="party"><b>Грузополучатель и его адрес:</b> ${escHtml(salesDocConsigneeLine(doc))} (4)</div>
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
    <div class="sign-with-stamp">
      Товар (груз) передал / услуги сдал
      <div class="line"></div>
      ${orgSignHtml(org.inn, { height: 40 })}
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
      ${orgStampHtml(org.inn, { sizeMm: 38 })}
    </div>
    <div>М.П.<br/><span class="muted">${escHtml(doc.counterparty_name || '')}</span></div>
  </div>`;
  return printShell(`УПД № ${doc.number}`, body, org.inn);
}

function renderWorkorderHtml(
  doc: Row & { lines: Row[]; org: OrgProfile },
  opts?: { staffName?: string }
): string {
  const templateId = String((doc as { template_id?: string }).template_id || '').trim();
  if (isStoWorkorderTemplateId(templateId)) {
    const allLines = (doc.lines || []) as Array<Record<string, unknown>>;
    const { workLines, partLines } = splitStoWorkPartLines(
      allLines.map((l) => ({
        ...l,
        item_kind: String(l.line_kind) === 'work' ? 'service' : 'product',
        line_kind: l.line_kind,
      }))
    );
    const dealId = String((doc as { deal_id?: string }).deal_id || '').trim();
    const dealRow = dealId ? (getDeal(dealId) as Record<string, unknown> | null) : null;
    const issuer =
      String(opts?.staffName || '').trim() ||
      String((doc as { created_by?: string }).created_by || '').trim();
    const html = renderStoTemplateHtml(templateId, {
      number: String(doc.number || ''),
      docDate: String(doc.doc_date || new Date().toISOString().slice(0, 10)),
      org: doc.org,
      buyerName: String(doc.counterparty_name || ''),
      buyerInn: String(doc.counterparty_inn || ''),
      buyerAddress: String(doc.buyer_address || ''),
      buyerPhone: String(doc.buyer_phone || ''),
      buyerEmail: String(doc.buyer_email || ''),
      buyerPassport: String((doc as { buyer_passport?: string }).buyer_passport || ''),
      buyerKpp: String(doc.buyer_kpp || ''),
      buyerOgrn: String(doc.buyer_ogrn || ''),
      buyerDirector: String(doc.buyer_director || ''),
      carBrand: String((doc as { car_brand?: string }).car_brand || ''),
      carModel: String((doc as { car_model?: string }).car_model || ''),
      carPlate: String((doc as { car_plate?: string }).car_plate || ''),
      carVin: String((doc as { car_vin?: string }).car_vin || ''),
      carYear: String((doc as { car_year?: string }).car_year || ''),
      carColor: String((doc as { car_color?: string }).car_color || ''),
      carMileage: String((doc as { car_mileage?: string }).car_mileage || ''),
      carStsNumber: String((doc as { car_sts_number?: string }).car_sts_number || ''),
      intakeAt: dealId ? dealCarPhotosFirstAt(dealId) || undefined : undefined,
      city:
        String(doc.org?.inn || '').replace(/\D/g, '') === '231215603728' ? 'Москва' : 'Краснодар',
      workLines,
      partLines,
      ...paymentFieldsFromDeal(dealRow),
      ...contactFieldsFromDeal(dealRow, {
        docDate: String(doc.doc_date || new Date().toISOString().slice(0, 10)),
      }),
      ...staffFieldsFromDeal(dealRow, {
        staffName: issuer,
        actorOnly: true,
      }),
      ...handoverFieldsFromDeal(dealRow, {
        workorderId: String(doc.id || ''),
      }),
    });
    if (html) return html;
  }
  const org = doc.org;
  const allLines = doc.lines || [];
  const works = allLines.filter((l) => String(l.line_kind) === 'work');
  // Только товары. Нельзя подставлять allLines в «Списание» — услуга туда не входит.
  const goods = allLines.filter((l) => String(l.line_kind) !== 'work');
  const workLines = works.length ? works : goods.length ? [] : allLines;
  const goodsLines = works.length || goods.length ? goods : [];
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

  ${
    goodsLines.length
      ? `
  <h2>${escHtml(formatWorkorderOutHeading(doc, dateShort))}</h2>
  <table class="grid">
    <thead>
      <tr>
        <th>№</th><th>Наименование, характеристика, артикул товаров</th><th>Кол-во</th><th>Ед.изм.</th><th>Цена</th><th>Сумма</th>
      </tr>
    </thead>
    <tbody>${goodsRows}</tbody>
  </table>
  <div class="totals">
    Итого товаров: <b>${formatRuMoney(goodsTotal)}</b><br/>
    В том числе НДС${vatRate ? ` ${vatRate}%` : ''}: <b>${formatRuMoney(goodsVat)}</b>
  </div>
  <div>Всего деталей ${goodsLines.length}, на сумму ${formatRuMoney(goodsTotal)} RUB</div>
  <div class="words">${escHtml(amountInWordsRu(goodsTotal))}</div>`
      : ''
  }

  <div class="totals" style="margin-top:12px;font-size:12px">
    <b>Итого по заказ-наряду : ${formatRuMoney(Number(doc.total) || 0)}</b><br/>
    В том числе НДС: ${formatRuMoney(Number(doc.vat_amount) || 0)}
  </div>
  <div class="words">Всего по заказ-наряду: ${escHtml(amountInWordsRu(Number(doc.total) || 0))} в т.ч. НДС ${formatRuMoney(Number(doc.vat_amount) || 0)} RUB</div>

  <div class="party" style="margin-top:14px;position:relative;min-height:14mm">
    Мастер _____________________ /${escHtml(org.master_title || 'Мастер-приемщик')}/
    ${orgSignHtml(org.inn, { heightMm: 12 })}
  </div>

  <div class="warranty">
    ${warrantyObligationsHtml(escHtml, org.inn)}
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
    <div class="sign-with-stamp">
      Принят: ${escHtml(dateShort)}<br/>
      Исполнитель ______________________ /${escHtml(org.short_name || org.director || '')}/
      ${orgSignHtml(org.inn, { heightMm: 12 })}
      ${orgStampHtml(org.inn, { sizeMm: 38 })}
      <div class="muted" style="margin-top:4px">М.П. (при наличии)</div>
    </div>
    <div>
      Дата: ${escHtml(dateShort)} г.<br/>
      Заказчик ______________________ /${escHtml(doc.counterparty_name || '')}/<br/>
      Заказ-наряд № ${escHtml(doc.number)} от ${escHtml(dateShort)} г.
      ${
        isStoWorkorderTemplateId(String((doc as { template_id?: string }).template_id || ''))
          ? `<div class="muted" style="margin-top:8px">Форма: ${
              String((doc as { template_id?: string }).template_id) === STO_WORKORDER_LEGAL
                ? 'заказ-наряд для юрлица / ИП'
                : 'заказ-наряд для физлица'
            }. Полный бланк — Документы → Шаблоны СТО.</div>`
          : ''
      }
    </div>
  </div>`;
  return printShell(`Заказ-наряд № ${doc.number}`, body, org.inn);
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
      ${orgStampHtml(org.inn, { sizeMm: 38 })}
    </div>
  </div>`;
  return printShell(`Счёт-фактура № ${doc.number}`, body, org.inn);
}

/** HTML-бланк для печати / «Сохранить как PDF». */
export function renderSalesDocPrintHtml(
  id: string,
  opts?: { staffName?: string }
): string | null {
  const typePeek = get<{ doc_type?: string }>(
    `SELECT doc_type FROM sales_docs WHERE id = ?`,
    [id]
  );
  if (String(typePeek?.doc_type || '') === 'workorder') {
    ensureWorkorderTemplateId(id);
  }
  let doc = getSalesDoc(id);
  if (!doc) return null;
  const type = String(doc.doc_type) as SalesDocType;
  if (type === 'contract') {
    doc = fillContractBuyerFromDeal(id) || doc;
  } else if (['invoice', 'upd', 'sf'].includes(type)) {
    doc = fillSalesDocBuyerFromDeal(id) || doc;
  }
  if (type === 'contract') return renderContractDocHtml(doc);
  if (type === 'invoice') return renderInvoiceHtml(doc);
  if (type === 'workorder') return renderWorkorderHtml(doc, opts);
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
  const dealId = String(doc.deal_id || '').trim();
  const deal = dealId ? (getDeal(dealId) as Row | null) : null;
  const innFromDoc = String(doc.counterparty_inn || '').replace(/\D/g, '');
  const cp = findCounterpartyForDeal(deal) || findCounterpartyByInn(innFromDoc);
  const inn = innFromDoc || String(cp?.inn || '').replace(/\D/g, '');
  let partyKind = String((cp as { party_kind?: string } | null)?.party_kind || '').toLowerCase();
  if (!partyKind && inn.length === 12) partyKind = 'ip';
  if (!partyKind && inn.length === 10) partyKind = 'legal';
  const name = String(doc.counterparty_name || cp?.name || cp?.name_full || '').trim();
  let director = String(doc.buyer_director || cp?.director || '').trim();
  if (partyKind === 'ip') {
    director = '';
  }
  return {
    name,
    inn,
    kpp: String(doc.buyer_kpp || cp?.kpp || ''),
    ogrn: String(doc.buyer_ogrn || cp?.ogrn || ''),
    address: address || String(cp?.address || '').trim(),
    phone: phoneStored || phoneFromAddr || String(cp?.phone || '').trim() || undefined,
    email: String(doc.buyer_email || cp?.email || '') || undefined,
    director: director || undefined,
    sign_basis: String(doc.buyer_passport || cp?.sign_basis || '').trim() || undefined,
    party_kind: partyKind || undefined,
    bank: String(doc.buyer_bank || cp?.bank || '') || undefined,
    bik: String(doc.buyer_bik || cp?.bik || '') || undefined,
    rs: String(doc.buyer_rs || cp?.rs || '') || undefined,
    ks: String(doc.buyer_ks || cp?.ks || '') || undefined,
  };
}

function renderContractDocHtml(doc: Row & { lines: Row[]; org: OrgProfile }): string {
  const templateId = String((doc as { template_id?: string }).template_id || '').trim() || CONTRACT_TEMPLATE_ID;
  const number = String(doc.number || '');
  const docDate = String(doc.doc_date || new Date().toISOString().slice(0, 10));
  if (isStoContractTemplateId(templateId)) {
    const buyer = contractBuyerFromDoc(doc);
    const html = renderStoTemplateHtml(templateId, {
      number,
      docDate,
      org: doc.org,
      buyerName: buyer.name,
      buyerInn: buyer.inn,
      buyerAddress: buyer.address,
      buyerPhone: buyer.phone,
      buyerEmail: buyer.email,
      buyerKpp: buyer.kpp,
      buyerOgrn: buyer.ogrn,
      buyerDirector: buyer.director,
      buyerBank: buyer.bank,
      buyerBik: buyer.bik,
      buyerRs: buyer.rs,
      buyerKs: buyer.ks,
      carBrand: String((doc as { car_brand?: string }).car_brand || ''),
      carModel: String((doc as { car_model?: string }).car_model || ''),
      carPlate: String((doc as { car_plate?: string }).car_plate || ''),
      carVin: String((doc as { car_vin?: string }).car_vin || ''),
      carYear: String((doc as { car_year?: string }).car_year || ''),
      carColor: String((doc as { car_color?: string }).car_color || ''),
      carMileage: String((doc as { car_mileage?: string }).car_mileage || ''),
      city: templateId === 'sto-contract-legal-msk' ? 'Москва' : 'Краснодар',
    });
    if (html) return html;
  }
  return renderSaleContractHtml({
    number,
    docDate,
    org: doc.org,
    buyer: contractBuyerFromDoc(doc),
    city: 'Краснодар',
  });
}

/** Договор без позиций сделки (из шаблонов / вручную). */
export function createContractDoc(input: {
  dealId?: string;
  organizationId?: string;
  templateId?: string;
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
  let dealRow: Row | null = null;
  if (dealIdStr) {
    dealRow = getDeal(dealIdStr) as Row | null;
    if (!dealRow) throw new Error('Сделка не найдена');
  }
  const organizationId = dealRow
    ? organizationIdForDealRecord(dealRow as Record<string, unknown>, input.organizationId)
    : resolveOrganizationId(input.organizationId);
  const org = getOrgProfile(organizationId);
  let id = newGuid();
  let number = dealIdStr
    ? salesNumberFromDeal('contract', dealIdStr)
    : nextContractNumber();
  let regenerated = false;
  if (dealIdStr) {
    const existing = latestDealSalesDoc(dealIdStr, 'contract');
    if (existing) {
      id = existing.id;
      number = String(existing.number || number);
      regenerated = true;
    }
  }
  const docDate = new Date().toISOString().slice(0, 10);
  let carPlate = '';
  let carVin = '';
  let carYear = '';
  let carMileage = '';
  let carBrand = '';
  let carModel = '';
  let carColor = '';
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

  let templateId = String(input.templateId || '').trim();
  if (dealIdStr && dealRow) {
    buyer = resolveContractBuyerFromDeal(dealRow, buyer);
    carPlate = String(dealRow.car_plate || '').trim().toUpperCase();
    carVin = String(dealRow.car_vin || '').trim().toUpperCase();
    carYear = String(dealRow.car_year || '').trim();
    carMileage = String(dealRow.car_mileage || '').trim();
    carBrand = String(dealRow.car_brand || '').trim();
    carModel = String(dealRow.car_model || '').trim();
    carColor = String(dealRow.car_color || '').trim();
    if (!templateId) {
      templateId = suggestContractTemplateId(
        dealRow as Record<string, unknown>,
        contractTemplateOpts(dealRow as Record<string, unknown>, buyer, organizationId)
      );
    }
  }
  if (!templateId) {
    templateId = suggestContractTemplateId(
      null,
      contractTemplateOpts(dealRow as Record<string, unknown> | null, buyer, organizationId)
    );
  }
  if (!isSaleContractTemplateId(templateId)) {
    throw new Error('Неизвестный шаблон договора');
  }
  const stoMeta = getStoDocTemplate(templateId);

  if (!buyer.name) {
    buyer.name =
      isStoLegalContractTemplateId(templateId) ? 'ООО «____________________»' : '____________________';
  }

  const defaultComment = stoMeta
    ? `${stoMeta.title}${dealIdStr ? ` · заказ ${dealIdStr}` : ''}`
    : templateId === CONTRACT_TEMPLATE_ID
      ? `Договор поставки и услуг${dealIdStr ? ` · заказ ${dealIdStr}` : ''}`
      : dealIdStr
        ? `Договор по заказу покупателя №${dealIdStr}`
        : 'Договор ТО и ремонт';

  const contractParams = [
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
    (input.comment || '').trim() || defaultComment,
    input.createdBy || '',
    organizationId,
    carPlate,
    carVin,
    carYear,
    carMileage,
    carBrand,
    carModel,
    carColor,
    templateId,
  ];

  if (regenerated) {
    run(
      `UPDATE sales_docs SET
         number = ?, doc_date = ?, deal_id = ?,
         counterparty_name = ?, counterparty_inn = ?, buyer_address = ?,
         buyer_phone = ?, buyer_email = ?, buyer_kpp = ?, buyer_ogrn = ?, buyer_director = ?,
         buyer_bank = ?, buyer_bik = ?, buyer_rs = ?, buyer_ks = ?,
         amount = 0, vat_rate = ?, vat_amount = 0, total = 0, status = 'issued', comment = ?,
         created_by = ?, organization_id = ?,
         car_plate = ?, car_vin = ?, car_year = ?, car_mileage = ?,
         car_brand = ?, car_model = ?, car_color = ?, template_id = ?
       WHERE id = ?`,
      [...contractParams, id]
    );
  } else {
    run(
      `INSERT INTO sales_docs (
         id, doc_type, number, doc_date, deal_id,
         counterparty_name, counterparty_inn, buyer_address,
         buyer_phone, buyer_email, buyer_kpp, buyer_ogrn, buyer_director,
         buyer_bank, buyer_bik, buyer_rs, buyer_ks,
         amount, vat_rate, vat_amount, total, status, comment, created_by, organization_id,
         car_plate, car_vin, car_year, car_mileage, car_brand, car_model, car_color, template_id
       ) VALUES (?, 'contract', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, 0, 0, 'issued', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, ...contractParams]
    );
  }
  const saved = getSalesDoc(id);
  if (!saved) throw new Error('Документ не найден после сохранения');
  return Object.assign(saved, { regenerated });
}
