/**
 * Сделки / воронки AmoCRM → Анти1С (через amo1c export).
 */
import { execFile, execFileSync } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';
import { all, get, run } from './db.js';
import { newGuid } from './ids.js';

import { customerOrderLineDisplayName, warehouseCatalogName } from './product-display-name.js';
import { buildOrderDocTree } from './order-doc-tree.js';
import { findUnitBySerial, parseSerialsJson, productRequiresSerials, findNextInStockUnitForProduct } from './product-units.js';
import { appsHumanLabel, unitAppsMatchVehicle, type AppVehicle } from './applicability-party.js';
import { loadRetailPrices } from './stock-valuation.js';
import {
  buildDealSaleRules,
  buildDealNextHints,
  dealIsLegalBuyerForm,
  dealIsPartner,
  inferBuyerFormFromInn,
  resolveBuyerForm,
  resolveClientRole,
  sanitizeBuyerInn,
  resolveIsSto,
  resolveDocPack,
  type ClientRole,
} from './deal-sale-rules.js';
import { getDealWorkorderGate } from './deal-workorder-gate.js';
import { getDealPaymentSplit, syncDealPaidStatus } from './deal-payment-split.js';
import { enqueueSyncDealFromAmo1c } from './sync-deal-queue.js';
import { looksLikeAmoNameCityLabel, looksLikePersonFio } from './person-fio.js';
import { amoSaleFieldOptions, checkAmoSaleConfigDrift, syncAmoUnmappedStaffAlerts } from './amo-sale-config.js';
import { persistAmoClientComplaint } from './amo-client-complaint.js';
import { getOrganization, resolveOrganizationForCompany, resolveOrganizationId } from './organizations.js';
import { stsMediaInfo } from './sts-media.js';
import { resolveCounterpartyIdForDeal } from './counterparty-vehicles.js';
import { pdnScansSummary } from './pdn-media.js';
import { pdnSmsSummary } from './pdn-sms-sign.js';
import { clientPartsSummary } from './client-parts.js';
import { dealCarPhotosSummary } from './deal-car-photos.js';
import { normalizePlate as normalizeRuPlate } from './sts-ocr.js';
import {
  applySuggestedServicesForDealItem,
  listPendingServiceSuggestionsForDeal,
  suggestLinkedServicesForDealItem,
  type ServiceSuggestion,
} from './product-service-links.js';

function softEnsureClientStockReserve(_dealId: string): void {
  // СТО / наложка больше не кладут товар на WAIT-PAY — только перемещения.
}

const execFileAsync = promisify(execFile);

const DEFAULT_EXPORT =
  process.env.AMO1C_DEALS_EXPORT
  || '/root/amo1c_pnevmopodveska1_ru/public_html/bin/export_deals_for_wms.php';

const DEFAULT_STAGE_PUSH =
  process.env.AMO1C_DEAL_STAGE_PUSH
  || '/root/amo1c_pnevmopodveska1_ru/public_html/bin/update_deal_stage_for_wms.php';

/**
 * Юрлицо / B2B: есть компания в Amo, флаг legal, или ИНН из 10 цифр.
 * Для таких сделок — только счёт на оплату, без QR СБП и ссылки «карта».
 */
/** Угадать СТО по полям Amo / воронке (пока менеджер не зафиксировал вручную). */
export function guessDealIsSto(deal: Record<string, unknown> | null | undefined): boolean {
  return resolveIsSto({ ...(deal || {}), is_sto_manual: 0, is_sto: 0 });
}

export function dealIsSto(deal: Record<string, unknown> | null | undefined): boolean {
  return resolveIsSto(deal);
}

/**
 * Какие документы печатать из заказа — по роли покупателя и СТО (см. deal-sale-rules).
 */
export function dealSalesDocPackTypes(
  deal: Record<string, unknown> | null | undefined
): Array<'invoice' | 'workorder' | 'upd'> {
  return resolveDocPack(deal);
}

export function setDealIsSto(dealId: string, isSto: boolean): void {
  const id = String(dealId || '').trim();
  if (!id) throw new Error('deal_id required');
  const row = get('SELECT id FROM crm_deals WHERE id = ?', [id]);
  if (!row) throw new Error('Заказ покупателя не найден');
  run(
    `UPDATE crm_deals
     SET is_sto = ?, is_sto_manual = 1, updated_at = datetime('now')
     WHERE id = ?`,
    [isSto ? 1 : 0, id]
  );
  if (isSto) softEnsureClientStockReserve(id);
}

/** Канал реализации / СТО из Учёта (локально; пуш в Amo — отдельно). */
export function setDealAmoSaleFields(
  dealId: string,
  patch: {
    amo_channel?: string;
    amo_sto?: string;
    amo_shipment?: string;
    amo_branch?: string;
    amo_payment_type?: string;
    amo_pay_method?: string;
  }
): void {
  const id = String(dealId || '').trim();
  if (!id) throw new Error('deal_id required');
  const row = get<Record<string, unknown>>('SELECT * FROM crm_deals WHERE id = ?', [id]);
  if (!row) throw new Error('Заказ покупателя не найден');

  const amoChannel =
    patch.amo_channel !== undefined
      ? String(patch.amo_channel ?? '').trim()
      : String(row.amo_channel || '').trim();
  if (patch.amo_channel !== undefined && !amoChannel) {
    throw new Error('Канал реализации обязателен');
  }
  const amoSto =
    patch.amo_sto !== undefined
      ? String(patch.amo_sto ?? '').trim()
      : String(row.amo_sto || '').trim();
  let amoShipment =
    patch.amo_shipment !== undefined
      ? String(patch.amo_shipment ?? '').trim()
      : String(row.amo_shipment || '').trim();
  const amoBranch =
    patch.amo_branch !== undefined
      ? String(patch.amo_branch ?? '').trim()
      : String(row.amo_branch || '').trim();
  let amoPaymentType =
    patch.amo_payment_type !== undefined
      ? String(patch.amo_payment_type ?? '').trim()
      : String(row.amo_payment_type || '').trim();
  const amoPayMethod =
    patch.amo_pay_method !== undefined
      ? String(patch.amo_pay_method ?? '').trim()
      : String(row.amo_pay_method || '').trim();

  const isShipChannel = /отправк/i.test(amoChannel);
  if (isShipChannel) {
    if (patch.amo_shipment !== undefined && !amoShipment) {
      throw new Error('При канале «Отправка» способ отправки обязателен');
    }
    if (patch.amo_payment_type !== undefined && !amoPaymentType) {
      throw new Error('При канале «Отправка» тип оплаты обязателен');
    }
  } else {
    // Самовывоз / Автосервис — способа отправки нет (чистим мусор вроде «Автобус»)
    const cleaned = sanitizeAmoShipFields({
      amo_channel: amoChannel,
      amo_shipment: amoShipment,
      amo_payment_type: amoPaymentType,
    });
    amoShipment = cleaned.amo_shipment;
    amoPaymentType = cleaned.amo_payment_type;
  }

  // Канал / способ отправки меняют складской канал; СТО / филиал — нет
  const forceRemap =
    patch.amo_channel !== undefined || patch.amo_shipment !== undefined;
  const shipChannel = mapAmoShipChannel({
    amo_channel: amoChannel,
    amo_shipment: amoShipment,
    ship_channel: forceRemap ? '' : String(row.ship_channel || ''),
    name: String(row.name || ''),
    department: String(row.department || ''),
  });

  let orgCompanyId = String(row.org_company_id || '').trim();
  if (patch.amo_branch !== undefined) {
    const fromBranch = orgCompanyIdForBranch(amoBranch);
    if (fromBranch) orgCompanyId = fromBranch;
  }

  const dealForRules = {
    ...row,
    amo_channel: amoChannel,
    amo_sto: amoSto,
    amo_shipment: amoShipment,
    amo_branch: amoBranch,
    amo_payment_type: amoPaymentType,
    amo_pay_method: amoPayMethod,
    ship_channel: shipChannel,
    org_company_id: orgCompanyId,
    is_sto_manual: 0,
    is_sto: 0,
  };
  const guessedSto = guessDealIsSto(dealForRules as Record<string, unknown>);

  // Смена канала/СТО сбрасывает ручной override галочки — снова из Amo-полей
  run(
    `UPDATE crm_deals
     SET amo_channel = ?, amo_sto = ?, amo_shipment = ?, amo_branch = ?,
         amo_payment_type = ?, amo_pay_method = ?,
         ship_channel = ?, org_company_id = ?,
         is_sto = ?, is_sto_manual = 0, updated_at = datetime('now')
     WHERE id = ?`,
    [
      amoChannel,
      amoSto,
      amoShipment,
      amoBranch,
      amoPaymentType,
      amoPayMethod,
      shipChannel,
      orgCompanyId,
      guessedSto ? 1 : 0,
      id,
    ]
  );
  if (guessedSto) softEnsureClientStockReserve(id);
}

/** Проверка: для «Отправка» заполнены способ отправки и тип оплаты. */
export function dealShipFieldsReady(deal: Record<string, unknown> | null | undefined): {
  ok: boolean;
  missing: string[];
} {
  const channel = String(deal?.amo_channel || '').trim();
  if (!/отправк/i.test(channel)) return { ok: true, missing: [] };
  const missing: string[] = [];
  if (!String(deal?.amo_shipment || '').trim()) missing.push('Способ отправки');
  if (!String(deal?.amo_payment_type || '').trim()) missing.push('Тип оплаты');
  return { ok: missing.length === 0, missing };
}

export type DealVehicleFields = {
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
  /** ФИО/должность кто пригнал на СТО */
  car_brought_by?: string;
  /** power_of_attorney | order | waybill | representatives_list | other */
  car_authority_basis?: string;
  /** № / дата / иное */
  car_authority_details?: string;
  /** Приёмка с телефона */
  car_fuel_level?: string;
  car_keys_count?: string;
  car_docs_left?: string;
  car_docs_note?: string;
  car_damage_notes?: string;
  /** JSON-массив id комплектности */
  car_completeness?: string;
  car_completeness_other?: string;
};

const CAR_AUTHORITY_BASIS = new Set([
  'power_of_attorney',
  'order',
  'waybill',
  'representatives_list',
  'other',
  '',
]);

export function formatCarAuthorityBasisLabel(basis: string): string {
  const b = String(basis || '').trim();
  if (b === 'power_of_attorney') return 'доверенность';
  if (b === 'order') return 'приказ';
  if (b === 'waybill') return 'путевой лист';
  if (b === 'representatives_list') return 'перечень представителей (приложение к договору)';
  if (b === 'other') return 'иное';
  return '';
}

/** Текст для бланка ЗН §1.5 */
export function formatCarAuthorityLine(basis: string, details: string): string {
  const label = formatCarAuthorityBasisLabel(basis);
  const det = String(details || '').trim();
  if (!label && !det) return '';
  if (label && det) return `${label}: ${det}`;
  return label || det;
}

function normPlate(v: unknown): string {
  return normalizeRuPlate(String(v ?? ''));
}

/** Иголка поиска госномера: пробелы убрать, латиницу→кириллицу (как на бланке). */
function plateSearchNeedle(q: string): string {
  return String(q || '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '')
    .replace(/A/g, 'А')
    .replace(/B/g, 'В')
    .replace(/E/g, 'Е')
    .replace(/K/g, 'К')
    .replace(/M/g, 'М')
    .replace(/H/g, 'Н')
    .replace(/O/g, 'О')
    .replace(/P/g, 'Р')
    .replace(/C/g, 'С')
    .replace(/T/g, 'Т')
    .replace(/Y/g, 'У')
    .replace(/X/g, 'Х');
}

/** Паспорт: только цифры серии/номера (45 10 123456 → 4510123456). */
function passportDigitsNeedle(q: string): string {
  return String(q || '').replace(/\D+/g, '');
}

/**
 * Текстовый поиск по сделке: название, контакт, этап, телефон,
 * госномер (цифры или буквы+цифры), паспорт (серия/номер).
 */
function pushDealTextSearch(
  where: string[],
  params: Array<string | number>,
  qRawIn: string
): void {
  const qRaw = String(qRawIn || '').trim();
  if (!qRaw) return;
  const like = `%${qRaw}%`;
  const digits = qRaw.replace(/\D+/g, '');
  const plateNeedle = plateSearchNeedle(qRaw);
  const plateLike = plateNeedle ? `%${plateNeedle}%` : '';
  const passDigits = passportDigitsNeedle(qRaw);
  const passLike = passDigits.length >= 4 ? `%${passDigits}%` : '';
  const phoneLike = digits ? `%${digits}%` : '';
  where.push(
    `(name LIKE ? OR id LIKE ? OR IFNULL(department,'') LIKE ?
      OR IFNULL(buyer_name,'') LIKE ? OR IFNULL(company_name,'') LIKE ?
      OR IFNULL(buyer_phone,'') LIKE ? OR IFNULL(status_name,'') LIKE ?
      OR IFNULL(pipeline_name,'') LIKE ?
      OR IFNULL(responsible_user_id,'') IN (
        SELECT amo_id FROM staff WHERE name LIKE ?
      )
      OR IFNULL(queued_by,'') LIKE ?
      OR (? != '' AND REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(IFNULL(buyer_phone,''),' ',''),'-',''),'+',''),'(',''),')','') LIKE ?)
      OR IFNULL(car_plate,'') LIKE ?
      OR IFNULL(car_vin,'') LIKE ?
      OR (? != '' AND REPLACE(IFNULL(car_plate,''),' ','') LIKE ?)
      OR (? != '' AND IFNULL(car_plate,'') LIKE ?)
      OR IFNULL(buyer_passport,'') LIKE ?
      OR (? != '' AND REPLACE(REPLACE(REPLACE(IFNULL(buyer_passport,''),' ',''),'-',''),'№','') LIKE ?))`
  );
  params.push(
    like,
    like,
    like,
    like,
    like,
    like,
    like,
    like,
    like,
    like,
    digits,
    phoneLike,
    like,
    like,
    plateNeedle,
    plateLike,
    digits,
    digits ? `%${digits}%` : '',
    like,
    passDigits,
    passLike
  );
}

export function setDealVehicle(dealId: string, vehicle: DealVehicleFields): void {
  const id = String(dealId || '').trim();
  if (!id) throw new Error('deal_id required');
  const row = get('SELECT id FROM crm_deals WHERE id = ?', [id]);
  if (!row) throw new Error('Заказ покупателя не найден');
  const plate = normPlate(vehicle.car_plate);
  const vin = String(vehicle.car_vin ?? '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '');
  const year = String(vehicle.car_year ?? '').trim();
  const mileage = String(vehicle.car_mileage ?? '').trim();
  const brand = String(vehicle.car_brand ?? '').trim();
  const model = String(vehicle.car_model ?? '').trim();
  const color = String(vehicle.car_color ?? '').trim();
  const category = String(vehicle.car_category ?? '').trim();
  const pts = String(vehicle.car_pts ?? '').trim();
  const owner = String(vehicle.car_owner ?? '').trim();
  const street = String(vehicle.car_owner_street ?? '').trim();
  const house = String(vehicle.car_owner_house ?? '').trim();
  const flat = String(vehicle.car_owner_flat ?? '').trim();
  const stsDate = String(vehicle.car_sts_date ?? '').trim();
  const stsNumber = String(vehicle.car_sts_number ?? '').trim();
  const broughtBy =
    vehicle.car_brought_by != null ? String(vehicle.car_brought_by).trim() : null;
  let authorityBasis: string | null = null;
  if (vehicle.car_authority_basis != null) {
    const raw = String(vehicle.car_authority_basis).trim();
    // пусто = не заполняли / очистили; невалидное непустое — ошибка
    if (raw && !CAR_AUTHORITY_BASIS.has(raw)) {
      throw new Error(
        'Основание: доверенность / приказ / путевой / перечень / иное'
      );
    }
    authorityBasis = raw;
  }
  const authorityDetails =
    vehicle.car_authority_details != null
      ? String(vehicle.car_authority_details).trim()
      : null;
  const sets = [
    'car_plate = ?',
    'car_vin = ?',
    'car_year = ?',
    'car_mileage = ?',
    'car_brand = ?',
    'car_model = ?',
    'car_color = ?',
    'car_category = ?',
    'car_pts = ?',
    'car_owner = ?',
    'car_owner_street = ?',
    'car_owner_house = ?',
    'car_owner_flat = ?',
    'car_sts_date = ?',
    'car_sts_number = ?',
  ];
  const params: Array<string | number> = [
    plate,
    vin,
    year,
    mileage,
    brand,
    model,
    color,
    category,
    pts,
    owner,
    street,
    house,
    flat,
    stsDate,
    stsNumber,
  ];
  if (broughtBy != null) {
    sets.push('car_brought_by = ?');
    params.push(broughtBy);
  }
  if (authorityBasis != null) {
    sets.push('car_authority_basis = ?');
    params.push(authorityBasis);
  }
  if (authorityDetails != null) {
    sets.push('car_authority_details = ?');
    params.push(authorityDetails);
  }
  const intakeKeys = [
    'car_fuel_level',
    'car_keys_count',
    'car_docs_left',
    'car_docs_note',
    'car_damage_notes',
    'car_completeness',
    'car_completeness_other',
  ] as const;
  for (const k of intakeKeys) {
    if (vehicle[k] != null) {
      sets.push(`${k} = ?`);
      params.push(String(vehicle[k] ?? '').trim());
    }
  }
  sets.push(`updated_at = datetime('now')`);
  params.push(id);
  run(`UPDATE crm_deals SET ${sets.join(', ')} WHERE id = ?`, params);
}

/** Покупатель заказа: ФИО/название, ИНН, признак юрлица — для УПД и документов. */
export function updateDealBuyer(
  dealId: string,
  fields: {
    buyer_name?: string;
    buyer_inn?: string;
    buyer_phone?: string;
    buyer_email?: string;
    buyer_address?: string;
    buyer_passport?: string;
    buyer_kpp?: string;
    buyer_ogrn?: string;
    buyer_director?: string;
    buyer_bank?: string;
    buyer_bik?: string;
    buyer_rs?: string;
    buyer_ks?: string;
    /** '' | no | yes — НДС в счёте/УПД/СФ для юр/ИП */
    buyer_vat?: string;
    buyer_vat_rate?: number | string;
    company_name?: string;
    company_id?: string;
    is_legal_entity?: boolean | number;
    buyer_kind?: string;
    is_partner?: boolean | number;
    client_role?: string;
  }
): void {
  const id = String(dealId || '').trim();
  if (!id) throw new Error('deal_id required');
  const row = get('SELECT id FROM crm_deals WHERE id = ?', [id]);
  if (!row) throw new Error('Заказ покупателя не найден');

  const name = fields.buyer_name != null ? String(fields.buyer_name).trim() : null;
  const inn =
    fields.buyer_inn != null ? String(fields.buyer_inn).replace(/\D/g, '') : null;
  const phone = fields.buyer_phone != null ? String(fields.buyer_phone).trim() : null;
  const email = fields.buyer_email != null ? String(fields.buyer_email).trim() : null;
  const address = fields.buyer_address != null ? String(fields.buyer_address).trim() : null;
  const passport =
    fields.buyer_passport != null ? String(fields.buyer_passport).trim() : null;
  const kpp = fields.buyer_kpp != null ? String(fields.buyer_kpp).replace(/\D/g, '') : null;
  const ogrn = fields.buyer_ogrn != null ? String(fields.buyer_ogrn).replace(/\D/g, '') : null;
  const director =
    fields.buyer_director != null ? String(fields.buyer_director).trim() : null;
  const bank = fields.buyer_bank != null ? String(fields.buyer_bank).trim() : null;
  const bik = fields.buyer_bik != null ? String(fields.buyer_bik).replace(/\D/g, '') : null;
  const rs = fields.buyer_rs != null ? String(fields.buyer_rs).replace(/\D/g, '') : null;
  const ks = fields.buyer_ks != null ? String(fields.buyer_ks).replace(/\D/g, '') : null;
  let buyerVat: string | null = null;
  if (fields.buyer_vat != null) {
    const raw = String(fields.buyer_vat).trim().toLowerCase();
    if (raw === '' || raw === 'no' || raw === 'none' || raw === '0') {
      buyerVat = raw === '' ? '' : 'no';
    } else if (raw === 'yes' || raw === '1' || raw === 'true') {
      buyerVat = 'yes';
    } else {
      throw new Error('НДС: укажите «нет» или «да»');
    }
  }
  let buyerVatRate: number | null = null;
  if (fields.buyer_vat_rate != null) {
    const n = Number(String(fields.buyer_vat_rate).replace(',', '.'));
    if (!Number.isFinite(n) || n < 0 || n > 100) {
      throw new Error('Ставка НДС: число от 0 до 100');
    }
    buyerVatRate = Math.round(n * 100) / 100;
  }
  const company =
    fields.company_name != null ? String(fields.company_name).trim() : null;
  const companyId =
    fields.company_id != null ? String(fields.company_id).trim() : null;

  let kind =
    fields.buyer_kind != null ? String(fields.buyer_kind).trim().toLowerCase() : null;
  if (kind === 'физлицо' || kind === 'individual') kind = 'person';
  if (kind === 'юрлицо' || kind === 'ooo') kind = 'legal';
  if (kind === 'партнёр' || kind === 'партнер') kind = 'partner';
  if (kind === 'partner_delay' || kind === 'partner-delay') kind = 'partner_delay';

  let clientRole: ClientRole | null = null;
  if (fields.client_role != null) {
    const raw = String(fields.client_role)
      .trim()
      .toLowerCase()
      .replace(/ё/g, 'е');
    if (raw === 'partner_delay' || raw === 'partner-delay' || raw.includes('отсроч')) {
      clientRole = 'partner_delay';
    } else if (raw === 'partner' || raw.includes('партн')) {
      clientRole = 'partner';
    } else if (raw === 'client' || raw === 'клиент' || raw === '') {
      clientRole = 'client';
    } else {
      throw new Error('Роль: client | partner | partner_delay');
    }
  }

  if (kind === 'partner' || kind === 'partner_delay') {
    if (!clientRole) clientRole = kind === 'partner_delay' ? 'partner_delay' : 'partner';
    const existing = get<Record<string, unknown>>(
      `SELECT buyer_inn, buyer_kind, is_legal_entity, company_name FROM crm_deals WHERE id = ?`,
      [id]
    );
    kind = resolveBuyerForm({
      buyer_inn: inn != null ? inn : existing?.buyer_inn,
      is_legal_entity: existing?.is_legal_entity,
      company_name: existing?.company_name,
    });
  }
  if (kind && !['person', 'ip', 'legal'].includes(kind)) {
    throw new Error('Тип покупателя: person | ip | legal');
  }

  let partner: number | null =
    fields.is_partner != null ? (Number(fields.is_partner) ? 1 : 0) : null;
  if (clientRole === 'partner' || clientRole === 'partner_delay') partner = 1;
  if (clientRole === 'client') partner = 0;
  if (partner == null && kind && fields.is_partner === undefined && fields.client_role === undefined) {
    partner = 0;
  }
  if (partner === 1 && !clientRole) clientRole = 'partner';
  if (partner === 0 && !clientRole) clientRole = 'client';

  let legal: number | null =
    fields.is_legal_entity != null
      ? Number(fields.is_legal_entity)
        ? 1
        : 0
      : null;
  if (kind === 'person') legal = 0;
  if (kind === 'ip' || kind === 'legal') legal = 1;
  if (legal === 1 && !kind) kind = 'legal';
  if (legal === 0 && !kind) kind = 'person';

  const sets: string[] = [];
  const params: Array<string | number> = [];
  if (name != null) {
    sets.push('buyer_name = ?');
    params.push(name);
    // для физлица company_name не дублируем; для юр/ИП/партнёра — имя в company_name
    if (kind === 'person') {
      sets.push('company_name = ?');
      params.push('');
    } else if (kind === 'legal' || kind === 'ip') {
      sets.push('company_name = ?');
      params.push(company != null ? company : name);
    }
  } else if (company != null) {
    sets.push('company_name = ?');
    params.push(company);
  }
  if (inn != null) {
    sets.push('buyer_inn = ?');
    params.push(inn);
  }
  if (phone != null) {
    sets.push('buyer_phone = ?');
    params.push(phone);
  }
  if (email != null) {
    sets.push('buyer_email = ?');
    params.push(email);
  }
  if (address != null) {
    sets.push('buyer_address = ?');
    params.push(address);
  }
  if (passport != null) {
    sets.push('buyer_passport = ?');
    params.push(passport);
  }
  if (kpp != null) {
    sets.push('buyer_kpp = ?');
    params.push(kpp);
  }
  if (ogrn != null) {
    sets.push('buyer_ogrn = ?');
    params.push(ogrn);
  }
  if (director != null) {
    sets.push('buyer_director = ?');
    params.push(director);
  }
  if (bank != null) {
    sets.push('buyer_bank = ?');
    params.push(bank);
  }
  if (bik != null) {
    sets.push('buyer_bik = ?');
    params.push(bik);
  }
  if (rs != null) {
    sets.push('buyer_rs = ?');
    params.push(rs);
  }
  if (ks != null) {
    sets.push('buyer_ks = ?');
    params.push(ks);
  }
  if (buyerVat != null) {
    sets.push('buyer_vat = ?');
    params.push(buyerVat);
    if (buyerVat === 'no') {
      sets.push('buyer_vat_rate = ?');
      params.push(0);
      buyerVatRate = null; // уже записали 0
    }
  }
  if (buyerVatRate != null) {
    sets.push('buyer_vat_rate = ?');
    params.push(buyerVatRate);
  }
  if (companyId != null) {
    sets.push('company_id = ?');
    params.push(companyId);
  }
  if (legal != null) {
    sets.push('is_legal_entity = ?');
    params.push(legal);
  }
  if (kind != null) {
    sets.push('buyer_kind = ?');
    params.push(kind);
  }
  if (partner != null) {
    sets.push('is_partner = ?');
    params.push(partner);
  }
  if (clientRole != null) {
    sets.push('client_role = ?');
    params.push(clientRole);
  }
  if (!sets.length) return;
  sets.push(`updated_at = datetime('now')`);
  params.push(id);
  run(`UPDATE crm_deals SET ${sets.join(', ')} WHERE id = ?`, params);

  // подтянуть в документы сделки
  const docSets: string[] = [];
  const docParams: string[] = [];
  const docName =
    name != null
      ? kind === 'person'
        ? name
        : company != null
          ? company
          : name
      : company;
  if (docName != null) {
    docSets.push('counterparty_name = ?');
    docParams.push(docName);
  }
  if (inn != null) {
    docSets.push('counterparty_inn = ?');
    docParams.push(inn);
  }
  if (phone != null) {
    docSets.push('buyer_phone = ?');
    docParams.push(phone);
  }
  if (email != null) {
    docSets.push('buyer_email = ?');
    docParams.push(email);
  }
  if (address != null) {
    docSets.push('buyer_address = ?');
    docParams.push(address);
  }
  if (passport != null) {
    docSets.push('buyer_passport = ?');
    docParams.push(passport);
  }
  if (kpp != null) {
    docSets.push('buyer_kpp = ?');
    docParams.push(kpp);
  }
  if (ogrn != null) {
    docSets.push('buyer_ogrn = ?');
    docParams.push(ogrn);
  }
  if (director != null) {
    docSets.push('buyer_director = ?');
    docParams.push(director);
  }
  if (bank != null) {
    docSets.push('buyer_bank = ?');
    docParams.push(bank);
  }
  if (bik != null) {
    docSets.push('buyer_bik = ?');
    docParams.push(bik);
  }
  if (rs != null) {
    docSets.push('buyer_rs = ?');
    docParams.push(rs);
  }
  if (ks != null) {
    docSets.push('buyer_ks = ?');
    docParams.push(ks);
  }
  if (docSets.length) {
    docParams.push(id);
    run(`UPDATE sales_docs SET ${docSets.join(', ')} WHERE deal_id = ?`, docParams);
  }
}

/** Юрлицо с первого счёта по заказу — после выписки менять организацию нельзя. */
export function dealInvoiceOrganizationId(dealId: string): string {
  const id = String(dealId || '').trim();
  if (!id) return '';
  const row = get<{ organization_id: string }>(
    `SELECT IFNULL(organization_id,'') AS organization_id
     FROM sales_docs
     WHERE deal_id = ? AND doc_type = 'invoice'
     ORDER BY datetime(created_at) ASC, number ASC
     LIMIT 1`,
    [id]
  );
  return String(row?.organization_id || '').trim();
}

/** Организация для нового документа: счёт фиксирует; иначе контур заказа (филиал Amo). */
export function organizationIdForDealRecord(
  deal: Record<string, unknown>,
  inputOrganizationId?: string
): string {
  const dealIdStr = String(deal.id || '').trim();
  const lockedOrg = dealIdStr ? dealInvoiceOrganizationId(dealIdStr) : '';
  const orgFromContour = resolveOrganizationForCompany(String(deal.org_company_id || ''));
  let orgId = lockedOrg || String(inputOrganizationId || '').trim() || orgFromContour;
  if (lockedOrg && orgFromContour && lockedOrg !== orgFromContour) {
    const lockedRow = getOrganization(lockedOrg);
    const dealCo = String(deal.org_company_id || '').trim();
    if (
      lockedRow &&
      dealCo &&
      String(lockedRow.company_id || '').trim() !== dealCo
    ) {
      orgId = orgFromContour;
    }
  }
  return resolveOrganizationId(orgId);
}

/** Контур (филиал) на заказе — только до выписки счёта. Синхронизирует amo_branch по маппингу. */
export function setDealOrgCompany(
  dealId: string,
  orgCompanyId: string
): { org_company_id: string; amo_branch: string } {
  const id = String(dealId || '').trim();
  if (!id) throw new Error('deal_id required');
  const row = get<{ amo_branch?: string }>('SELECT id, amo_branch FROM crm_deals WHERE id = ?', [
    id,
  ]);
  if (!row) throw new Error('Заказ покупателя не найден');
  if (dealInvoiceOrganizationId(id)) {
    throw new Error('После выписки счёта организацию и юрлицо менять нельзя');
  }
  const co = String(orgCompanyId || '').trim();
  const branch = co
    ? amoBranchForOrgCompany(co, String(row.amo_branch || ''))
    : '';
  if (co && !branch) {
    throw new Error(
      'Для этого филиала нет маппинга в Amo (Настройки → Amo → Филиалы). Сначала сопоставьте филиал с контуром.'
    );
  }
  run(
    `UPDATE crm_deals
     SET org_company_id = ?, amo_branch = ?, updated_at = datetime('now')
     WHERE id = ?`,
    [co, branch, id]
  );
  return { org_company_id: co, amo_branch: branch };
}

export function dealIsLegalEntity(deal: Record<string, unknown> | null | undefined): boolean {
  return dealIsLegalBuyerForm(deal);
}

/**
 * Канал склада из полей Amo:
 * 858983 «Канал реализации» + 860492 «Способ отправки».
 */
export function mapAmoShipChannel(input: {
  amo_channel?: string;
  amo_shipment?: string;
  ship_channel?: string;
  name?: string;
  department?: string;
}): string {
  const channel = String(input.amo_channel || '').trim().toLowerCase();
  const shipment = String(input.amo_shipment || '').trim().toLowerCase();
  // Канал важнее сохранённого ship_channel: «Самовывоз» + старое «Автобус» → pickup
  if (/самовывоз/.test(channel) || /автосервис/.test(channel)) return 'pickup';
  // Явный способ отправки из Amo важнее старого ship_channel (СДЭК → Авито / Прочие ТК)
  if (shipment) {
    if (/налож/.test(shipment)) return 'cdek_cod';
    // Авито доставка = постоплата у агента (как наложка): без предоплаты / WAIT-PAY
    if (/авито/.test(shipment) && /доставк/.test(shipment)) return 'avito_cod';
    if (/автобус/.test(shipment)) return 'bus';
    if (/курьер/.test(shipment)) return 'own_courier';
    if (/озон|ozon/.test(shipment)) return 'ozon';
    if (/дел.?лин|dellin/.test(shipment)) return 'dellin';
    if (/пэк|pek/.test(shipment)) return 'pek';
    // «ТК СДЭК» / СДЭК — да; «Прочие ТК» — нет (не подменять на СДЭК)
    if (/сдэк|cdek/.test(shipment)) return 'cdek_prepaid';
    if (/проч/.test(shipment)) return 'other';
    // Любой другой явный способ из Amo — не дефолтить в СДЭК
    return 'other';
  }
  const existing = String(input.ship_channel || '').trim();
  const trustedExisting = [
    'cdek_prepaid',
    'cdek_cod',
    'avito_cod',
    'pickup',
    'bus',
    'ozon',
    'dellin',
    'pek',
  ];
  if (existing && trustedExisting.includes(existing)) {
    return existing;
  }
  // Отправка без способа — неизвестно, не СДЭК по умолчанию
  if (/отправ/.test(channel)) return 'other';
  const hint = `${input.department || ''} ${input.name || ''}`.toLowerCase();
  if (/самовывоз|pickup/.test(hint)) return 'pickup';
  if (/налож/.test(hint)) return 'cdek_cod';
  return '';
}

/** Способ отправки только при канале «Отправка»; тип оплаты — для всех каналов. */
export function sanitizeAmoShipFields(input: {
  amo_channel?: string;
  amo_shipment?: string;
  amo_payment_type?: string;
}): { amo_shipment: string; amo_payment_type: string } {
  const channel = String(input.amo_channel || '').trim();
  const payment = String(input.amo_payment_type || '').trim();
  if (/отправк/i.test(channel)) {
    return {
      amo_shipment: String(input.amo_shipment || '').trim(),
      amo_payment_type: payment,
    };
  }
  // Самовывоз / Автосервис — способа отправки нет; предоплату/постоплату не затираем
  return { amo_shipment: '', amo_payment_type: payment };
}

/** Имя ответственного из staff / справочника Amo по amo_id. */
function responsibleNameMap(amoIds: string[]): Map<string, string> {
  const ids = [...new Set(amoIds.map(String).filter((id) => id && id !== '0'))];
  const map = new Map<string, string>();
  if (!ids.length) return map;
  const ph = ids.map(() => '?').join(',');
  const rows = all<{ amo_id: string; name: string }>(
    `SELECT amo_id, name FROM staff WHERE amo_id IN (${ph})`,
    ids
  );
  for (const r of rows) {
    const id = String(r.amo_id || '');
    const name = String(r.name || '').trim();
    if (id && name) map.set(id, name);
  }
  // fallback: meta.amo_user_directory (даже без строки в staff)
  try {
    const { amoUserDisplayName } = require('./staff.js') as {
      amoUserDisplayName: (id: string) => string;
    };
    for (const id of ids) {
      if (map.has(id)) continue;
      const n = String(amoUserDisplayName(id) || '').trim();
      if (n) map.set(id, n);
    }
  } catch {
    /* staff module optional at boot edge */
  }
  return map;
}

function withResponsibleName<T extends Record<string, unknown>>(row: T, names: Map<string, string>): T & {
  responsible_name: string;
} {
  const rid = String(row.responsible_user_id || '');
  return {
    ...row,
    responsible_name: (rid && names.get(rid)) || '',
  };
}

function attachResponsibleNames<T extends Record<string, unknown>>(
  items: T[]
): Array<T & { responsible_name: string }> {
  const names = responsibleNameMap(items.map((d) => String(d.responsible_user_id || '')));
  return items.map((d) => withResponsibleName(d, names));
}

function attachOrgCompanyNames<T extends Record<string, unknown>>(
  items: T[]
): Array<T & { org_company_name: string }> {
  const rows = all<{ id: string; name: string }>(`SELECT id, name FROM companies`);
  const map = new Map(rows.map((r) => [String(r.id), String(r.name || '')]));
  return items.map((d) => ({
    ...d,
    org_company_name: map.get(String(d.org_company_id || '').trim()) || '',
  }));
}

export type DealExport = {
  ok?: boolean;
  pipelines?: Array<{
    id: string;
    name: string;
    sort?: number;
    is_archive?: boolean;
    statuses?: Array<{
      id: string;
      name: string;
      sort?: number;
      color?: string;
    }>;
  }>;
  deals?: Array<Record<string, unknown>>;
};

function loadExport(scriptPath = DEFAULT_EXPORT, extraArgs: string[] = []): DealExport {
  const out = execFileSync('php', [scriptPath, ...extraArgs], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    timeout: 180_000,
  });
  return JSON.parse(out) as DealExport;
}

export function dealsMeta() {
  return {
    pipelines: get<{ c: number }>('SELECT COUNT(*) AS c FROM crm_pipelines')?.c ?? 0,
    statuses: get<{ c: number }>('SELECT COUNT(*) AS c FROM crm_pipeline_statuses')?.c ?? 0,
    deals: get<{ c: number }>('SELECT COUNT(*) AS c FROM crm_deals')?.c ?? 0,
    withItems:
      get<{ c: number }>(
        `SELECT COUNT(DISTINCT deal_id) AS c FROM crm_deal_items`
      )?.c ?? 0,
    queued:
      get<{ c: number }>('SELECT COUNT(*) AS c FROM crm_deals WHERE queued_to_1c = 1')?.c ?? 0,
    lastSync:
      get<{ value: string }>('SELECT value FROM meta WHERE key = ?', ['deals_synced_at'])?.value
      ?? null,
  };
}

/** Ответственные по сделкам — для фильтра в журнале / канбане. */
export function listDealResponsibles(opts?: {
  pipelineId?: string;
  queuedTo1c?: boolean;
  orgCompanyId?: string;
}): { items: Array<{ amo_id: string; name: string; deals: number }>; none: number } {
  const where: string[] = [];
  const params: Array<string | number> = [];
  if (opts?.pipelineId) {
    where.push('pipeline_id = ?');
    params.push(opts.pipelineId);
  }
  if (opts?.queuedTo1c) {
    where.push('queued_to_1c = 1');
  }
  if (opts?.orgCompanyId) {
    where.push(`IFNULL(org_company_id,'') = ?`);
    params.push(opts.orgCompanyId);
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const andSql = where.length ? `AND ${where.join(' AND ')}` : '';
  const rows = all<{ amo_id: string; c: number }>(
    `SELECT responsible_user_id AS amo_id, COUNT(*) AS c
     FROM crm_deals
     ${whereSql}${whereSql ? ' AND' : ' WHERE'} IFNULL(responsible_user_id,'') != ''
     GROUP BY responsible_user_id
     ORDER BY c DESC
     LIMIT 500`,
    params
  );
  const none =
    get<{ c: number }>(
      `SELECT COUNT(*) AS c FROM crm_deals
       WHERE IFNULL(responsible_user_id,'') = '' ${andSql}`,
      params
    )?.c ?? 0;
  const names = responsibleNameMap(rows.map((r) => String(r.amo_id)));
  const items = rows
    .map((r) => {
      const id = String(r.amo_id || '').trim();
      return {
        amo_id: id,
        name: (id && names.get(id)) || '',
        deals: Number(r.c) || 0,
      };
    })
    .filter((r) => r.amo_id)
    .sort((a, b) => {
      if (b.deals !== a.deals) return b.deals - a.deals;
      return (a.name || a.amo_id).localeCompare(b.name || b.amo_id, 'ru');
    });
  return { items, none: Number(none) || 0 };
}

function upsertPipeline(pl: {
  id: string;
  name: string;
  sort?: number;
  is_archive?: boolean;
  statuses?: Array<{ id: string; name: string; sort?: number; color?: string }>;
}): void {
  run(
    `INSERT INTO crm_pipelines (id, name, sort, is_archive)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       name=excluded.name, sort=excluded.sort, is_archive=excluded.is_archive`,
    [pl.id, pl.name || pl.id, pl.sort ?? 0, pl.is_archive ? 1 : 0]
  );
  for (const st of pl.statuses || []) {
    run(
      `INSERT INTO crm_pipeline_statuses (id, pipeline_id, name, sort, color)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         pipeline_id=excluded.pipeline_id, name=excluded.name,
         sort=excluded.sort, color=excluded.color`,
      [
        `${pl.id}:${st.id}`,
        pl.id,
        st.name || st.id,
        st.sort ?? 0,
        st.color || '',
      ]
    );
  }
}

/** Контур из маппинга филиала (meta integration_amo.branch_company). */
function orgCompanyIdForBranch(branch: string): string {
  const b = String(branch || '').trim();
  if (!b) return '';
  const row = get<{ value: string }>('SELECT value FROM meta WHERE key = ?', ['integration_amo']);
  if (!row?.value) return '';
  try {
    const parsed = JSON.parse(row.value) as { branch_company?: Record<string, string> };
    const m = parsed?.branch_company;
    if (!m || typeof m !== 'object') return '';
    if (m[b]) return String(m[b] || '').trim();
    const hit = Object.entries(m).find(([k]) => k.trim().toLowerCase() === b.toLowerCase());
    return hit ? String(hit[1] || '').trim() : '';
  } catch {
    return '';
  }
}

/** Обратный маппинг: контур → значение CF «Филиал» в Amo. */
function amoBranchForOrgCompany(orgCompanyId: string, preferBranch = ''): string {
  const co = String(orgCompanyId || '').trim();
  if (!co) return '';
  const row = get<{ value: string }>('SELECT value FROM meta WHERE key = ?', ['integration_amo']);
  let map: Record<string, string> = {};
  if (row?.value) {
    try {
      const parsed = JSON.parse(row.value) as { branch_company?: Record<string, string> };
      if (parsed?.branch_company && typeof parsed.branch_company === 'object') {
        map = parsed.branch_company;
      }
    } catch {
      map = {};
    }
  }
  const labels = Object.entries(map)
    .filter(([, id]) => String(id || '').trim() === co)
    .map(([k]) => String(k || '').trim())
    .filter(Boolean);
  if (!labels.length) {
    // fallback: опции Amo + угадывание по имени контура
    const coName = String(
      get<{ name: string }>('SELECT name FROM companies WHERE id = ?', [co])?.name || ''
    )
      .toLowerCase()
      .replace(/ё/g, 'е');
    for (const label of amoSaleFieldOptions('amo_branch')) {
      const n = label.toLowerCase().replace(/ё/g, 'е');
      if (coName && /стрела/.test(coName) && /стрела/.test(n)) return label;
      if (coName && /фогель|fogel/.test(coName) && /фогель|fogel/.test(n)) return label;
      if (
        coName &&
        /пневмо|можай|москва/.test(coName) &&
        /можайск|москва|пневмо/.test(n)
      ) {
        return label;
      }
    }
    return '';
  }
  const prefer = String(preferBranch || '').trim();
  if (prefer && labels.includes(prefer)) return prefer;
  return labels[0];
}

/** Список Amo contact id с экспорта сделки (главный + остальные после склейки). */
function parseAmoContactIdsFromExport(d: Record<string, unknown>): string[] {
  const raw = d.amo_contact_ids;
  const fromArray = Array.isArray(raw)
    ? raw.map((x) => String(x || '').replace(/\D/g, '')).filter(Boolean)
    : String(raw || '')
        .split(/[,;\s]+/)
        .map((x) => x.replace(/\D/g, ''))
        .filter(Boolean);
  const main = String(d.amo_contact_id || '').replace(/\D/g, '');
  const out: string[] = [];
  const seen = new Set<string>();
  for (const id of main ? [main, ...fromArray] : fromArray) {
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

/** Дозаполнить реквизиты покупателя из Amo (контакты сделки), не затирая ручные правки. */
function mergeAmoBuyerRequisitesFromSync(dealId: string, d: Record<string, unknown>): void {
  const id = String(dealId || '').trim();
  if (!id) return;
  const digitCols = new Set(['buyer_kpp', 'buyer_ogrn', 'buyer_bik', 'buyer_rs', 'buyer_ks']);
  const textCols = [
    'buyer_email',
    'buyer_address',
    'buyer_kpp',
    'buyer_ogrn',
    'buyer_director',
    'buyer_bank',
    'buyer_bik',
    'buyer_rs',
    'buyer_ks',
  ] as const;
  const sets: string[] = [];
  const params: Array<string | number> = [];
  const phoneFromExport = String(d.buyer_phone ?? '').trim();
  if (phoneFromExport) {
    sets.push(`buyer_phone = CASE WHEN IFNULL(buyer_phone,'') = '' THEN ? ELSE buyer_phone END`);
    params.push(phoneFromExport);
  }
  for (const col of textCols) {
    let v = String(d[col] ?? '').trim();
    if (!v) continue;
    if (digitCols.has(col)) v = v.replace(/\D/g, '');
    sets.push(`${col} = CASE WHEN IFNULL(${col},'') = '' THEN ? ELSE ${col} END`);
    params.push(v);
  }
  const contactIds = parseAmoContactIdsFromExport(d);
  const amoContactId = contactIds[0] || '';
  if (amoContactId) {
    sets.push(`amo_contact_id = CASE WHEN IFNULL(amo_contact_id,'') = '' THEN ? ELSE amo_contact_id END`);
    params.push(amoContactId);
  }
  if (contactIds.length) {
    sets.push(`amo_contact_ids = CASE WHEN IFNULL(amo_contact_ids,'') = '' THEN ? ELSE amo_contact_ids END`);
    params.push(contactIds.join(','));
  }
  if (sets.length) {
    params.push(id);
    run(
      `UPDATE crm_deals SET ${sets.join(', ')}, updated_at = datetime('now') WHERE id = ?`,
      params
    );
  }
  if (!contactIds.length) return;
  const deal = getDeal(id) as Record<string, unknown> | null;
  const cpId = resolveCounterpartyIdForDeal(deal);
  if (!cpId) return;
  run(
    `UPDATE counterparties
     SET amo_contact_id = CASE WHEN IFNULL(amo_contact_id,'') = '' THEN ? ELSE amo_contact_id END
     WHERE id = ?`,
    [amoContactId, cpId]
  );
}

export function upsertDealRecord(d: Record<string, unknown>): void {
  const id = String(d.id || '').trim();
  if (!id) return;
  const items = Array.isArray(d.items) ? d.items : [];
  const prevStatusId = String(
    get<{ status_id: string }>(
      `SELECT IFNULL(status_id,'') AS status_id FROM crm_deals WHERE id = ?`,
      [id]
    )?.status_id || ''
  );
  const nextStatusId = String(d.status_id || '');
  const existingDealRow = get<{
    buyer_name: string;
    buyer_inn: string;
    is_partner: number;
    name: string;
  }>(
    `SELECT IFNULL(buyer_name,'') AS buyer_name,
            IFNULL(buyer_inn,'') AS buyer_inn,
            IFNULL(is_partner,0) AS is_partner,
            IFNULL(name,'') AS name
     FROM crm_deals WHERE id = ?`,
    [id]
  );
  const existingBuyer = existingDealRow;
  const existingBuyerName = String(existingBuyer?.buyer_name || '').trim();
  const existingInn = sanitizeBuyerInn(existingBuyer?.buyer_inn);
  const existingDealName = String(existingDealRow?.name || '').trim();
  const isGenericDealName = (n: string): boolean => {
    const raw = String(n || '').replace(/\s+/g, ' ').trim();
    if (!raw) return true;
    const bare = raw
      .replace(/^сделка\s*#?\s*/i, '')
      .replace(/^заказ\s*(№|#)?\s*/i, '')
      .trim();
    return bare === id;
  };
  let dealName = String(d.name || '').trim();
  // Виджет часто шлёт «Сделка #id» при синке позиций — не затираем нормальное имя из Amo.
  if (isGenericDealName(dealName) && existingDealName && !isGenericDealName(existingDealName)) {
    dealName = existingDealName;
  }
  let incomingBuyerName = String(d.buyer_name || '').trim();
  // Паспортное ФИО вручную не затираем ярлыком Amo «Имя Город» при синке.
  if (
    looksLikePersonFio(existingBuyerName) &&
    (!incomingBuyerName || looksLikeAmoNameCityLabel(incomingBuyerName))
  ) {
    incomingBuyerName = existingBuyerName;
  } else if (!incomingBuyerName && existingBuyerName) {
    incomingBuyerName = existingBuyerName;
  }
  const amoChannel = String(d.amo_channel || '').trim();
  const cleanedShip = sanitizeAmoShipFields({
    amo_channel: amoChannel,
    amo_shipment: String(d.amo_shipment || '').trim(),
    amo_payment_type: String(d.amo_payment_type || '').trim(),
  });
  const amoShipment = cleanedShip.amo_shipment;
  const amoPaymentType = cleanedShip.amo_payment_type;
  const shipChannel = mapAmoShipChannel({
    amo_channel: amoChannel,
    amo_shipment: amoShipment,
    // при явном канале самовывоз/автосервис не тащим старый bus из ship_channel
    ship_channel: /самовывоз|автосервис/i.test(amoChannel)
      ? ''
      : String(d.ship_channel || ''),
    name: String(d.name || ''),
    department: String(d.department || ''),
  });
  const amoPayMethod = String(d.amo_pay_method || '').trim();
  const amoSto = String(d.amo_sto || '').trim();
  const amoBranch = String(d.amo_branch || '').trim();
  const buyerInn = sanitizeBuyerInn(d.buyer_inn) || existingInn;
  const buyerKindRaw = String(d.buyer_kind || '').trim().toLowerCase() || 'person';
  const companyId = String(d.company_id || '').trim();
  const partnerFromAmo = d.is_partner != null && String(d.is_partner) !== '';
  let isPartnerFlag =
    Number(d.is_partner) === 1 ||
    buyerKindRaw === 'partner' ||
    buyerKindRaw === 'partner_delay' ||
    String(d.client_role || '').toLowerCase() === 'partner' ||
    String(d.client_role || '').toLowerCase() === 'partner_delay';
  if (!partnerFromAmo && !isPartnerFlag && companyId) {
    const cpPartner = get<{ is_partner: number }>(
      `SELECT IFNULL(is_partner,0) AS is_partner FROM counterparties
       WHERE amo_company_id = ? LIMIT 1`,
      [companyId]
    );
    if (Number(cpPartner?.is_partner) === 1) isPartnerFlag = true;
  }
  if (!partnerFromAmo && !isPartnerFlag && Number(existingBuyer?.is_partner) === 1) {
    isPartnerFlag = true;
  }
  const payIsDelay = /отсроч/i.test(amoPayMethod);
  const incomingRole = String(d.client_role || '')
    .trim()
    .toLowerCase();
  const clientRole =
    incomingRole === 'partner_delay' || incomingRole === 'partner-delay'
      ? 'partner_delay'
      : incomingRole === 'partner'
        ? payIsDelay
          ? 'partner_delay'
          : 'partner'
        : incomingRole === 'client'
          ? isPartnerFlag
            ? payIsDelay
              ? 'partner_delay'
              : 'partner'
            : 'client'
          : isPartnerFlag
            ? payIsDelay
              ? 'partner_delay'
              : 'partner'
            : 'client';
  const buyerKind = inferBuyerFormFromInn({ buyer_inn: buyerInn });
  const dealForRules = {
    ...d,
    amo_channel: amoChannel,
    amo_shipment: amoShipment,
    amo_payment_type: amoPaymentType,
    amo_pay_method: amoPayMethod,
    amo_sto: amoSto,
    amo_branch: amoBranch,
    is_partner: isPartnerFlag ? 1 : 0,
    client_role: clientRole,
    buyer_kind: buyerKind,
    buyer_inn: buyerInn,
    ship_channel: shipChannel,
  };
  const guessedSto = guessDealIsSto(dealForRules as Record<string, unknown>);
  const pipelineId = String(d.pipeline_id || '');
  // Контур организации — только из «Филиал», не из воронки
  const fromBranch = orgCompanyIdForBranch(amoBranch);
  const orgCompanyId = fromBranch || String(d.org_company_id || '').trim();
  run(
    `INSERT INTO crm_deals (
       id, name, price, pipeline_id, pipeline_name, status_id, status_name,
       responsible_user_id, department, queued_to_1c, queue_status, queued_by, queued_at,
       amo_url, print_url, items_count,
       company_id, company_name, buyer_name, buyer_inn, buyer_phone, buyer_kind, is_legal_entity,
       is_partner, client_role, ship_channel, amo_channel, amo_shipment,
       amo_payment_type, amo_pay_method, amo_sto, amo_branch,
       is_sto, is_sto_manual, org_company_id,
       created_at, updated_at, synced_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, datetime('now'))
     ON CONFLICT(id) DO UPDATE SET
       name=excluded.name, price=excluded.price,
       pipeline_id=excluded.pipeline_id, pipeline_name=excluded.pipeline_name,
       status_id=excluded.status_id, status_name=excluded.status_name,
       responsible_user_id=CASE
         WHEN IFNULL(excluded.responsible_user_id,'') NOT IN ('', '0')
           THEN excluded.responsible_user_id
         ELSE crm_deals.responsible_user_id
       END,
       department=CASE
         WHEN IFNULL(excluded.department,'') != '' THEN excluded.department
         ELSE crm_deals.department
       END,
       queued_to_1c=excluded.queued_to_1c, queue_status=excluded.queue_status,
       queued_by=excluded.queued_by, queued_at=excluded.queued_at,
       amo_url=excluded.amo_url, print_url=excluded.print_url,
       items_count=excluded.items_count,
       company_id=excluded.company_id, company_name=excluded.company_name,
       buyer_name=excluded.buyer_name,
       buyer_inn=CASE
         WHEN length(excluded.buyer_inn) IN (10, 12) THEN excluded.buyer_inn
         ELSE crm_deals.buyer_inn
       END,
       buyer_phone=CASE
         WHEN IFNULL(excluded.buyer_phone,'') != '' THEN excluded.buyer_phone
         ELSE crm_deals.buyer_phone
       END, buyer_kind=excluded.buyer_kind,
       is_legal_entity=excluded.is_legal_entity,
       is_partner=excluded.is_partner,
       client_role=excluded.client_role,
       ship_channel=CASE
         WHEN IFNULL(excluded.amo_channel,'') != '' THEN excluded.ship_channel
         WHEN IFNULL(excluded.ship_channel,'') != '' THEN excluded.ship_channel
         ELSE crm_deals.ship_channel
       END,
       amo_channel=CASE
         WHEN IFNULL(excluded.amo_channel,'') != '' THEN excluded.amo_channel
         ELSE crm_deals.amo_channel
       END,
       /* При известном канале из Amo доверяем sanitize (пустой shipment = Самовывоз/СТО) */
       amo_shipment=CASE
         WHEN IFNULL(excluded.amo_channel,'') != '' THEN excluded.amo_shipment
         WHEN IFNULL(excluded.amo_shipment,'') != '' THEN excluded.amo_shipment
         ELSE crm_deals.amo_shipment
       END,
       amo_payment_type=CASE
         WHEN IFNULL(excluded.amo_channel,'') != '' THEN excluded.amo_payment_type
         WHEN IFNULL(excluded.amo_payment_type,'') != '' THEN excluded.amo_payment_type
         ELSE crm_deals.amo_payment_type
       END,
       amo_pay_method=CASE
         WHEN IFNULL(excluded.amo_pay_method,'') != '' THEN excluded.amo_pay_method
         ELSE crm_deals.amo_pay_method
       END,
       amo_sto=CASE
         WHEN IFNULL(excluded.amo_sto,'') != '' THEN excluded.amo_sto
         ELSE crm_deals.amo_sto
       END,
       amo_branch=CASE
         WHEN IFNULL(excluded.amo_branch,'') != '' THEN excluded.amo_branch
         ELSE crm_deals.amo_branch
       END,
       is_sto=CASE WHEN crm_deals.is_sto_manual = 1 THEN crm_deals.is_sto ELSE excluded.is_sto END,
       org_company_id=CASE
         WHEN IFNULL(excluded.org_company_id,'') != '' THEN excluded.org_company_id
         ELSE crm_deals.org_company_id
       END,
       created_at=COALESCE(excluded.created_at, crm_deals.created_at),
       updated_at=excluded.updated_at, synced_at=datetime('now')`,
    [
      id,
      dealName,
      Number(d.price) || 0,
      pipelineId,
      String(d.pipeline_name || ''),
      String(d.status_id || ''),
      String(d.status_name || ''),
      (() => {
        const rid = String(d.responsible_user_id || '').trim();
        return rid && rid !== '0' ? rid : '';
      })(),
      String(d.department || ''),
      d.queued_to_1c ? 1 : 0,
      String(d.queue_status || ''),
      String(d.queued_by || ''),
      d.queued_at ? String(d.queued_at) : null,
      String(d.amo_url || ''),
      String(d.print_url || ''),
      items.length || Number(d.items_count) || 0,
      String(d.company_id || ''),
      String(d.company_name || ''),
      incomingBuyerName,
      buyerInn,
      String(d.buyer_phone || ''),
      buyerKind,
      dealIsLegalEntity(dealForRules as Record<string, unknown>) ? 1 : 0,
      isPartnerFlag ? 1 : 0,
      clientRole,
      shipChannel,
      amoChannel,
      amoShipment,
      amoPaymentType,
      amoPayMethod,
      amoSto,
      amoBranch,
      guessedSto ? 1 : 0,
      orgCompanyId,
      d.created_at ? String(d.created_at) : null,
      d.updated_at ? String(d.updated_at) : new Date().toISOString(),
    ]
  );

  run('DELETE FROM crm_deal_items WHERE deal_id = ?', [id]);
  let lineNo = 0;
  for (const raw of items) {
    const it = raw as Record<string, unknown>;
    lineNo += 1;
    const itemId = String(it.id || `${id}:${lineNo}`);
    const qty = Math.max(0, Math.round(Number(it.qty) || 0));
    const price = Math.max(0, Math.round(Number(it.price) || 0));
    const amountRaw = Number(it.amount);
    const amount =
      Number.isFinite(amountRaw) && amountRaw > 0
        ? roundMoney(amountRaw)
        : roundMoney(qty * price);
    run(
      `INSERT INTO crm_deal_items (
         id, deal_id, product_guid, sku, code, name, brand, price, qty, amount, unit, department, note, line_no,
         name_1c, applicability_key
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        itemId,
        id,
        String(it.product_guid || ''),
        String(it.sku || ''),
        String(it.code || ''),
        String(it.name || ''),
        String(it.brand || ''),
        price,
        qty,
        amount,
        String(it.unit || ''),
        String(it.department || ''),
        String(it.note || ''),
        lineNo,
        String(it.name_1c || ''),
        String(it.applicability_key || ''),
      ]
    );
  }
  persistAmoClientComplaint(id, d);
  mergeAmoBuyerRequisitesFromSync(id, d);
  // Бюджет Amo часто 0 при amount=0 в строках — сумма из qty×price
  recalcDealTotals(id);

  if (rawStatusId(prevStatusId) !== rawStatusId(nextStatusId)) {
    void import('./deal-stock-flow.js')
      .then(({ maybeWriteOffStoAfterAmoStatusSync }) => {
        maybeWriteOffStoAfterAmoStatusSync(id, prevStatusId, nextStatusId);
      })
      .catch(() => {});
  }
}

function normalizeDealPhoneDigits(raw: string): string {
  let digits = String(raw || '').replace(/\D/g, '');
  // Часто приходит +7793… (лишняя 7 после ошибочного «+7» к номеру уже с 7)
  if (digits.startsWith('77') && digits.length === 12) {
    digits = digits.slice(1);
  }
  if (digits.startsWith('8') && digits.length === 11) {
    digits = '7' + digits.slice(1);
  }
  if (digits.length === 10) {
    digits = '7' + digits;
  }
  if (digits.length < 11) return '';
  return digits.slice(0, 11);
}

/** Телефон покупателя для чека/СМС: 11 цифр, с 7. Берёт первый валидный из списка через запятую. */
export function normalizeDealPhone(raw: string): string {
  const text = String(raw || '').trim();
  if (!text) return '';
  const chunks = text
    .split(/[,;\/\n\r]+/)
    .map((part) => part.trim())
    .filter(Boolean);
  if (chunks.length <= 1) {
    return normalizeDealPhoneDigits(text);
  }
  for (const chunk of chunks) {
    const phone = normalizeDealPhoneDigits(chunk);
    if (phone) return phone;
  }
  return normalizeDealPhoneDigits(text);
}

/**
 * Перед чеком: телефон/email из Amo → WMS.
 * Сначала синк сделки, если пусто — повторный export и запись в crm_deals.
 */
export function ensureDealBuyerContactFromAmo(dealId: string): {
  deal: Record<string, unknown> | null;
  phone: string;
  email: string;
} {
  const id = String(dealId || '').trim();
  if (!id) return { deal: null, phone: '', email: '' };

  try {
    syncDealsFromAmo1c({ dealId: id, limit: 1 });
  } catch {
    /* сделка могла уже быть в WMS */
  }

  let deal = getDeal(id) as Record<string, unknown> | null;
  let phone = normalizeDealPhone(String(deal?.buyer_phone || ''));
  let email = String(deal?.buyer_email || '').trim();

  if (!phone) {
    try {
      const exp = loadExport(DEFAULT_EXPORT, [`--deal=${id}`]);
      const row = (exp.deals || []).find((d) => String((d as { id?: string }).id || '') === id) as
        | { buyer_phone?: string; buyer_email?: string }
        | undefined;
      const rawPhone = String(row?.buyer_phone || '').trim();
      const rawEmail = String(row?.buyer_email || '').trim();
      if (rawPhone) {
        run(
          `UPDATE crm_deals SET buyer_phone = ?,
             buyer_email = CASE WHEN ? != '' THEN ? ELSE IFNULL(buyer_email,'') END,
             synced_at = datetime('now')
           WHERE id = ?`,
          [rawPhone, rawEmail, rawEmail, id]
        );
        phone = normalizeDealPhone(rawPhone);
        if (rawEmail) email = rawEmail;
        deal = getDeal(id) as Record<string, unknown> | null;
      }
    } catch {
      /* export недоступен */
    }
  }

  return { deal, phone, email };
}

/**
 * Синк сделки в отдельном Node-процессе — webhook / HTTP не блокируются на PHP export.
 */
export function syncDealFromAmo1cBackground(dealId: string): void {
  enqueueSyncDealFromAmo1c(dealId);
}

export function syncDealsFromAmo1c(opts: {
  days?: number;
  limit?: number;
  dealId?: string;
  scriptPath?: string;
} = {}): {
  pipelines: number;
  deals: number;
  withAmo: number;
  seconds: number;
} {
  const t0 = Date.now();
  const args: string[] = [];
  if (opts.days) args.push(`--days=${opts.days}`);
  if (opts.limit) args.push(`--limit=${opts.limit}`);
  if (opts.dealId) args.push(`--deal=${opts.dealId}`);
  const exp = loadExport(opts.scriptPath || DEFAULT_EXPORT, args);

  for (const pl of exp.pipelines || []) {
    upsertPipeline(pl);
  }
  for (const d of exp.deals || []) {
    upsertDealRecord(d);
    const did = String((d as { id?: string }).id || '').trim();
    if (did) softEnsureClientStockReserve(did);
  }

  run('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)', [
    'deals_synced_at',
    new Date().toISOString(),
  ]);

  try {
    checkAmoSaleConfigDrift();
  } catch {
    /* не блокируем синк */
  }
  try {
    syncAmoUnmappedStaffAlerts();
  } catch {
    /* не блокируем синк */
  }

  return {
    pipelines: (exp.pipelines || []).length,
    deals: (exp.deals || []).length,
    withAmo: Number((exp as { counts?: { with_amo?: number } }).counts?.with_amo || 0),
    seconds: Math.round((Date.now() - t0) / 1000),
  };
}

/** Amo status PK в зеркале: `pipelineId:statusId`; на сделке хранится сырой status_id. */
export function rawStatusId(id: string): string {
  const s = String(id || '');
  if (!s.includes(':')) return s;
  return s.slice(s.lastIndexOf(':') + 1);
}

/** Локальная воронка, если ещё не было синка Amo. */
export function ensureDefaultLocalFunnels(): void {
  const n = get<{ c: number }>('SELECT COUNT(*) AS c FROM crm_pipelines')?.c ?? 0;
  if (n > 0) return;
  const pipeId = 'local';
  upsertPipeline({
    id: pipeId,
    name: 'Продажи',
    sort: 0,
    statuses: [
      { id: 'new', name: 'Неразобранное', sort: 10, color: '#cfcfcf' },
      { id: 'contact', name: 'Первичный контакт', sort: 20, color: '#99ccff' },
      { id: 'talk', name: 'Переговоры', sort: 30, color: '#ffff99' },
      { id: 'decision', name: 'Принятие решения', sort: 40, color: '#ffcc66' },
      { id: 'won', name: 'Успешно реализовано', sort: 50, color: '#ccff66' },
      { id: 'lost', name: 'Закрыто и не реализовано', sort: 60, color: '#ff8080' },
    ],
  });
}

export function listPipelines() {
  ensureDefaultLocalFunnels();
  const pipes = all<{ id: string; name: string; sort: number; is_archive: number }>(
    `SELECT id, name, sort, is_archive FROM crm_pipelines ORDER BY sort, name`
  );
  const statuses = all<{
    id: string;
    pipeline_id: string;
    name: string;
    sort: number;
    color: string;
  }>(`SELECT id, pipeline_id, name, sort, color FROM crm_pipeline_statuses ORDER BY sort, name`);
  const byPipe = new Map<string, typeof statuses>();
  for (const st of statuses) {
    const pid = String(st.pipeline_id);
    const list = byPipe.get(pid) || [];
    list.push(st);
    byPipe.set(pid, list);
  }
  const dealCounts = all<{ pipeline_id: string; c: number; q: number }>(
    `SELECT pipeline_id,
            COUNT(*) AS c,
            SUM(CASE WHEN queued_to_1c = 1 THEN 1 ELSE 0 END) AS q
     FROM crm_deals
     GROUP BY pipeline_id`
  );
  const countByPipe = new Map(
    dealCounts.map((r) => [String(r.pipeline_id), { c: Number(r.c) || 0, q: Number(r.q) || 0 }])
  );
  return pipes.map((p) => {
    const cnt = countByPipe.get(String(p.id)) || { c: 0, q: 0 };
    return {
      id: String(p.id),
      name: String(p.name),
      sort: Number(p.sort) || 0,
      is_archive: Number(p.is_archive) || 0,
      statuses: byPipe.get(String(p.id)) || [],
      deals_count: cnt.c,
      queued_count: cnt.q,
    };
  });
}

export type BoardColumn = {
  id: string;
  status_id: string;
  name: string;
  sort: number;
  color: string;
  deals: Array<Record<string, unknown>>;
  total_amount: number;
};

/** Канбан: колонки = этапы выбранной воронки, карточки = сделки. */
export function listDealsBoard(opts: {
  pipelineId: string;
  q?: string;
  orgCompanyId?: string;
  /** Amo user id ответственного; `__none__` — без ответственного. */
  responsibleUserId?: string;
  /** Канал реализации: Автосервис | Самовывоз | Отправка */
  amoChannel?: string;
  /** Клиент: person | legal */
  buyerKind?: string;
  /** Роль: client | partner | partner_delay */
  clientRole?: string;
  /** Только сделки из очереди amo1c «Отправить в 1С» (таблица deals). */
  queuedTo1c?: boolean;
  /** Уточнение: '0' = в очереди, '1' = успешно ушло в 1С. */
  queueStatus?: string;
}) {
  ensureDefaultLocalFunnels();
  const pipelineId = String(opts.pipelineId || '').trim();
  if (!pipelineId) {
    return { pipeline: null, columns: [] as BoardColumn[], total: 0, unmatched: 0 };
  }
  const pipe = get<{ id: string; name: string; sort: number; is_archive: number }>(
    `SELECT id, name, sort, is_archive FROM crm_pipelines WHERE id = ?`,
    [pipelineId]
  );
  if (!pipe) {
    return { pipeline: null, columns: [] as BoardColumn[], total: 0, unmatched: 0 };
  }
  const statuses = all<{
    id: string;
    pipeline_id: string;
    name: string;
    sort: number;
    color: string;
  }>(
    `SELECT id, pipeline_id, name, sort, color FROM crm_pipeline_statuses
     WHERE pipeline_id = ? ORDER BY sort, name`,
    [pipelineId]
  );
  const where: string[] = ['pipeline_id = ?'];
  const params: Array<string | number> = [pipelineId];
  if (opts.orgCompanyId) {
    where.push(`IFNULL(org_company_id,'') = ?`);
    params.push(opts.orgCompanyId);
  }
  const respId = String(opts.responsibleUserId || '').trim();
  if (respId === '__none__') {
    where.push(`IFNULL(responsible_user_id,'') = ''`);
  } else if (respId) {
    where.push(`IFNULL(responsible_user_id,'') = ?`);
    params.push(respId);
  }
  if (opts.queuedTo1c) {
    where.push('queued_to_1c = 1');
  }
  if (opts.queueStatus != null && opts.queueStatus !== '') {
    where.push('queue_status = ?');
    params.push(String(opts.queueStatus));
  }
  pushAmoChannelFilter(where, params, opts.amoChannel);
  pushBuyerKindFilter(where, params, opts.buyerKind);
  pushClientRoleFilter(where, params, opts.clientRole);
  if (opts.q) {
    pushDealTextSearch(where, params, String(opts.q));
  }
  const dealRows = all(
    `SELECT id, name, price, pipeline_id, pipeline_name, status_id, status_name,
            responsible_user_id, department,
            buyer_name, company_name, buyer_phone, buyer_kind, is_legal_entity,
            is_partner, client_role,
            items_count, queued_to_1c, queue_status, updated_at, created_at, org_company_id
     FROM crm_deals WHERE ${where.join(' AND ')}
     ORDER BY datetime(COALESCE(queued_at, updated_at, created_at)) DESC
     LIMIT 1000`,
    params
  );

  const deals = attachResponsibleNames(dealRows as Array<Record<string, unknown>>);

  const byStatus = new Map<string, Array<Record<string, unknown>>>();
  for (const d of deals) {
    const sid = rawStatusId(String(d.status_id || ''));
    const list = byStatus.get(sid) || [];
    list.push(d);
    byStatus.set(sid, list);
  }

  const used = new Set<string>();
  const columns: BoardColumn[] = statuses.map((st) => {
    const sid = rawStatusId(String(st.id));
    used.add(sid);
    const colDeals = byStatus.get(sid) || [];
    return {
      id: String(st.id),
      status_id: sid,
      name: String(st.name),
      sort: Number(st.sort) || 0,
      color: String(st.color || ''),
      deals: colDeals,
      total_amount: colDeals.reduce((s, d) => s + (Number(d.price) || 0), 0),
    };
  });

  const unmatched: Array<Record<string, unknown>> = [];
  for (const [sid, list] of byStatus) {
    if (!used.has(sid)) unmatched.push(...list);
  }
  if (unmatched.length) {
    columns.push({
      id: '_other',
      status_id: '',
      name: 'Без этапа / другой',
      sort: 9999,
      color: '#94a3b8',
      deals: unmatched,
      total_amount: unmatched.reduce((s, d) => s + (Number(d.price) || 0), 0),
    });
  }

  return {
    pipeline: pipe,
    columns,
    total: deals.length,
    unmatched: unmatched.length,
  };
}

/** PATCH этапа сделки в AmoCRM (через amo1c CLI). */
export async function pushDealStageToAmo(opts: {
  dealId: string;
  statusId: string;
  pipelineId?: string;
}): Promise<
  | { ok: true; http: number; skipped?: boolean }
  | { ok: false; error: string; http?: number }
> {
  const { amoPushToAmoEnabled } = await import('./amo-settings.js');
  if (!amoPushToAmoEnabled()) {
    return { ok: true, http: 0, skipped: true };
  }
  const dealId = String(opts.dealId || '').replace(/\D/g, '');
  const statusId = rawStatusId(String(opts.statusId || '')).replace(/\D/g, '');
  if (!dealId || !statusId) {
    return { ok: false, error: 'deal_id and status_id required for Amo' };
  }
  const args = [`--deal=${dealId}`, `--status=${statusId}`];
  const pipelineId = String(opts.pipelineId || '').replace(/\D/g, '');
  if (pipelineId) args.push(`--pipeline=${pipelineId}`);
  try {
    const { stdout } = await execFileAsync('php', [DEFAULT_STAGE_PUSH, ...args], {
      encoding: 'utf8',
      maxBuffer: 2 * 1024 * 1024,
      timeout: 45_000,
    });
    const parsed = JSON.parse(String(stdout || '{}')) as {
      ok?: boolean;
      http?: number;
      error?: string;
    };
    if (!parsed.ok) {
      return {
        ok: false,
        error: String(parsed.error || 'Amo stage update failed'),
        http: parsed.http,
      };
    }
    return { ok: true, http: Number(parsed.http || 200) };
  } catch (e) {
    const err = e as { stdout?: string; message?: string };
    let detail = String(err.message || e);
    try {
      const parsed = JSON.parse(String(err.stdout || '{}')) as { error?: string };
      if (parsed.error) detail = String(parsed.error);
    } catch {
      /* keep */
    }
    return { ok: false, error: detail };
  }
}

export function updateDealStage(
  dealId: string,
  opts: { statusId: string; statusName?: string; pipelineId?: string }
): { ok: true; deal: Record<string, unknown> } | { ok: false; error: string } {
  const deal = get('SELECT * FROM crm_deals WHERE id = ?', [dealId]);
  if (!deal) return { ok: false, error: 'not found' };

  const pipelineId = String(opts.pipelineId || deal.pipeline_id || '').trim();
  const statusIdRaw = rawStatusId(opts.statusId);
  if (!statusIdRaw) return { ok: false, error: 'status_id required' };

  let statusName = String(opts.statusName || '').trim();
  let pipelineName = String(deal.pipeline_name || '');

  if (pipelineId) {
    const pipe = get<{ name: string }>('SELECT name FROM crm_pipelines WHERE id = ?', [
      pipelineId,
    ]);
    if (pipe) pipelineName = String(pipe.name);
    const st =
      get<{ name: string }>(
        `SELECT name FROM crm_pipeline_statuses
         WHERE pipeline_id = ? AND (id = ? OR id = ?)`,
        [pipelineId, statusIdRaw, `${pipelineId}:${statusIdRaw}`]
      ) ||
      get<{ name: string }>(
        `SELECT name FROM crm_pipeline_statuses WHERE id = ?`,
        [`${pipelineId}:${statusIdRaw}`]
      );
    if (st && !statusName) statusName = String(st.name);
  }
  if (!statusName) statusName = statusIdRaw;

  run(
    `UPDATE crm_deals SET
       status_id = ?, status_name = ?,
       pipeline_id = ?, pipeline_name = ?,
       updated_at = datetime('now')
     WHERE id = ?`,
    [statusIdRaw, statusName, pipelineId, pipelineName, dealId]
  );
  const updated = get('SELECT * FROM crm_deals WHERE id = ?', [dealId]);
  return { ok: true, deal: updated || {} };
}

/** Фильтр «Канал реализации» (Автосервис / Самовывоз / Отправка).
 * Важно: SQLite lower() не меняет кириллицу — нельзя искать через lower(...)= 'автосервис'.
 */
function pushAmoChannelFilter(
  where: string[],
  params: Array<string | number>,
  raw?: string
): void {
  const ch = String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
  if (!ch) return;
  if (ch === '__empty__' || ch === 'empty' || ch === 'none' || ch === 'без канала') {
    where.push(`trim(IFNULL(amo_channel,'')) = ''`);
    return;
  }
  if (ch === 'автосервис' || ch === 'autoservice' || ch === 'sto') {
    // Канал «Автосервис» + СТО без канала (часто is_sto=1 при пустом amo_channel)
    where.push(`(
      IFNULL(amo_channel,'') LIKE '%Автосервис%'
      OR IFNULL(amo_channel,'') LIKE '%автосервис%'
      OR (IFNULL(is_sto,0) = 1 AND trim(IFNULL(amo_channel,'')) = '')
    )`);
    return;
  }
  if (ch === 'самовывоз' || ch === 'pickup') {
    where.push(`(IFNULL(amo_channel,'') LIKE '%Самовывоз%' OR IFNULL(amo_channel,'') LIKE '%самовывоз%')`);
    return;
  }
  if (
    ch === 'отправка' ||
    ch === 'доставка' ||
    ch === 'shipping' ||
    ch === 'ship' ||
    ch === 'delivery'
  ) {
    where.push(
      `(IFNULL(amo_channel,'') LIKE '%Отправк%' OR IFNULL(amo_channel,'') LIKE '%отправк%' OR IFNULL(amo_channel,'') LIKE '%Доставк%' OR IFNULL(amo_channel,'') LIKE '%доставк%')`
    );
    return;
  }
  where.push(`IFNULL(amo_channel,'') LIKE ?`);
  params.push(`%${String(raw || '').trim()}%`);
}

/** Фильтр клиент: физ / юр (buyer_kind + is_legal_entity). */
function pushBuyerKindFilter(
  where: string[],
  params: Array<string | number>,
  raw?: string
): void {
  const k = String(raw || '')
    .trim()
    .toLowerCase();
  if (!k) return;
  if (k === 'person' || k === 'fiz' || k === 'физ' || k === 'физлицо') {
    where.push(`(
      lower(IFNULL(buyer_kind,'')) = 'person'
      OR (
        IFNULL(buyer_kind,'') = ''
        AND IFNULL(is_legal_entity,0) = 0
        AND length(replace(IFNULL(buyer_inn,''), ' ', '')) NOT IN (10, 12)
      )
    )`);
    return;
  }
  if (
    k === 'legal' ||
    k === 'yur' ||
    k === 'юр' ||
    k === 'юрлицо' ||
    k === 'ip'
  ) {
    where.push(`(
      lower(IFNULL(buyer_kind,'')) IN ('legal','ip')
      OR (
        lower(IFNULL(buyer_kind,'')) NOT IN ('person','individual')
        AND (
          IFNULL(is_legal_entity,0) = 1
          OR length(replace(IFNULL(buyer_inn,''), ' ', '')) IN (10, 12)
        )
      )
    )`);
  }
}

/** Фильтр роли: client | partner | partner_delay */
function pushClientRoleFilter(
  where: string[],
  params: Array<string | number>,
  raw?: string
): void {
  const k = String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/ё/g, 'е');
  if (!k) return;
  if (k === 'client' || k === 'клиент') {
    where.push(`(
      IFNULL(client_role,'client') = 'client'
      AND IFNULL(is_partner,0) = 0
      AND lower(IFNULL(buyer_kind,'')) NOT IN ('partner','partner_delay')
    )`);
    return;
  }
  if (k === 'partner_delay' || k === 'partner-delay' || k.includes('отсроч')) {
    where.push(`(
      IFNULL(client_role,'') = 'partner_delay'
      OR (
        (IFNULL(is_partner,0) = 1 OR lower(IFNULL(buyer_kind,'')) IN ('partner','partner_delay'))
        AND lower(IFNULL(amo_pay_method,'')) LIKE '%отсроч%'
      )
    )`);
    return;
  }
  if (k === 'partner' || k.includes('партн')) {
    where.push(`(
      IFNULL(client_role,'') IN ('partner','partner_delay')
      OR IFNULL(is_partner,0) = 1
      OR lower(IFNULL(buyer_kind,'')) IN ('partner','partner_delay')
    )`);
  }
}

export function listDeals(opts: {
  q?: string;
  pipelineId?: string;
  statusId?: string;
  /** Контур (companies.id) — маппинг воронки */
  orgCompanyId?: string;
  /** Amo user id ответственного; `__none__` — без ответственного. */
  responsibleUserId?: string;
  /** Канал реализации: Автосервис | Самовывоз | Отправка */
  amoChannel?: string;
  /** Клиент: person | legal */
  buyerKind?: string;
  /** Роль: client | partner | partner_delay */
  clientRole?: string;
  page?: number;
  limit?: number;
  /** Только сделки из очереди amo1c «Отправить в 1С» (таблица deals). */
  queuedTo1c?: boolean;
  queueStatus?: string;
  /** queued_at | created_at | updated_at | price | name | status_name | org_company_id | responsible_user_id */
  sort?: string;
  dir?: 'asc' | 'desc';
}) {
  const page = Math.max(1, opts.page || 1);
  const limit = Math.min(500, Math.max(1, opts.limit || 50));
  const offset = (page - 1) * limit;
  const where: string[] = [];
  const params: Array<string | number> = [];
  if (opts.pipelineId) {
    where.push('pipeline_id = ?');
    params.push(opts.pipelineId);
  }
  if (opts.statusId) {
    where.push('status_id = ?');
    params.push(opts.statusId);
  }
  if (opts.orgCompanyId) {
    where.push(`IFNULL(org_company_id,'') = ?`);
    params.push(opts.orgCompanyId);
  }
  const respId = String(opts.responsibleUserId || '').trim();
  if (respId === '__none__') {
    where.push(`IFNULL(responsible_user_id,'') = ''`);
  } else if (respId) {
    where.push(`IFNULL(responsible_user_id,'') = ?`);
    params.push(respId);
  }
  if (opts.queuedTo1c) {
    where.push('queued_to_1c = 1');
  }
  if (opts.queueStatus != null && opts.queueStatus !== '') {
    where.push('queue_status = ?');
    params.push(String(opts.queueStatus));
  }
  pushAmoChannelFilter(where, params, opts.amoChannel);
  pushBuyerKindFilter(where, params, opts.buyerKind);
  pushClientRoleFilter(where, params, opts.clientRole);
  if (opts.q) {
    pushDealTextSearch(where, params, String(opts.q));
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const sortKey = String(opts.sort || 'queued_at');
  const sortMap: Record<string, string> = {
    queued_at: 'datetime(COALESCE(queued_at, updated_at, created_at))',
    created_at: 'datetime(COALESCE(created_at, updated_at))',
    updated_at: 'datetime(COALESCE(updated_at, queued_at, created_at))',
    price: 'price',
    name: 'name COLLATE NOCASE',
    status_name: 'IFNULL(status_name,"") COLLATE NOCASE',
    org_company_id:
      `(SELECT IFNULL(MAX(name),'') FROM companies WHERE id = crm_deals.org_company_id) COLLATE NOCASE`,
    company_name: 'IFNULL(company_name,"") COLLATE NOCASE',
    buyer_name: 'IFNULL(buyer_name, IFNULL(buyer_phone,"")) COLLATE NOCASE',
    buyer_kind: `CASE
      WHEN IFNULL(client_role,'') = 'partner_delay' THEN 'Партнёр · отсрочка'
      WHEN IFNULL(client_role,'') = 'partner' OR IFNULL(is_partner,0)=1 THEN 'Партнёр'
      WHEN lower(IFNULL(buyer_kind,'')) = 'ip' THEN 'ИП'
      WHEN lower(IFNULL(buyer_kind,'')) = 'legal' OR IFNULL(is_legal_entity,0)=1 THEN 'Юр'
      WHEN length(replace(IFNULL(buyer_inn,''),' ',''))=10 THEN 'Юр'
      WHEN length(replace(IFNULL(buyer_inn,''),' ',''))=12 THEN 'ИП'
      ELSE 'Физ'
    END`,
    amo_channel: 'IFNULL(amo_channel,"") COLLATE NOCASE',
    amo_shipment: 'IFNULL(amo_shipment,"") COLLATE NOCASE',
    amo_payment_type: 'IFNULL(amo_payment_type,"") COLLATE NOCASE',
    responsible_user_id:
      `(SELECT IFNULL(MAX(name),'') FROM staff WHERE amo_id = crm_deals.responsible_user_id) COLLATE NOCASE`,
    queue_status: 'IFNULL(queue_status,"") COLLATE NOCASE',
    id: 'CAST(id AS INTEGER)',
  };
  const orderExpr = sortMap[sortKey] || sortMap.queued_at;
  const dir = opts.dir === 'asc' ? 'ASC' : 'DESC';
  const total =
    get<{ c: number }>(`SELECT COUNT(*) AS c FROM crm_deals ${whereSql}`, params)?.c ?? 0;
  const items = attachOrgCompanyNames(
    attachResponsibleNames(
      all(
        `SELECT * FROM crm_deals ${whereSql}
     ORDER BY ${orderExpr} ${dir}
     LIMIT ? OFFSET ?`,
        [...params, limit, offset]
      ) as Array<Record<string, unknown>>
    )
  );
  return {
    items,
    total,
    page,
    limit,
    pages: Math.max(1, Math.ceil(total / limit)),
    sort: sortKey,
    dir: dir.toLowerCase(),
  };
}

/** Склад, с которого реально можно переместить на СТО «со склада» (не курьер / не СТО / не в пути). */
function isPickableStockWarehouse(code: string, name: string): boolean {
  const c = String(code || '')
    .trim()
    .toUpperCase();
  const n = String(name || '')
    .trim()
    .toLowerCase();
  if (!c && !n) return false;
  if (['COURIER', 'STO', 'CDEK', 'BUS', '1C-NONE'].includes(c)) return false;
  if (c.startsWith('IN-TRANSIT') || c.startsWith('WAIT-PAY')) return false;
  if (
    /курьер|сдэк|автобус|в пути|ожидан|брак|недопостав|не найден|сто\b|автосервис/i.test(n)
  ) {
    return false;
  }
  return true;
}

/** Остатки по складам для позиций заказа (для колонки «Остаток»). */
function attachDealItemsStock(
  items: Array<Record<string, unknown>>
): Array<Record<string, unknown>> {
  const productIds = [
    ...new Set(
      items
        .filter((it) => String(itItemKind(it)) !== 'service')
        .map((it) => String(it.product_guid || '').trim())
        .filter(Boolean)
    ),
  ];
  if (!productIds.length) {
    return items.map((it) => ({
      ...it,
      stock_qty: String(itItemKind(it)) === 'service' ? null : 0,
      stock_qty_main: String(itItemKind(it)) === 'service' ? null : 0,
      stock_qty_pickable: String(itItemKind(it)) === 'service' ? null : 0,
      stock_qty_warehouse: null,
      stock_warehouses: [] as Array<Record<string, unknown>>,
    }));
  }
  const ph = productIds.map(() => '?').join(',');
  const rows = all<{
    product_id: string;
    warehouse_id: string;
    qty: number;
    wh_name: string;
    wh_code: string;
  }>(
    `SELECT b.product_id, b.warehouse_id, b.qty,
            IFNULL(w.name,'') AS wh_name,
            IFNULL(w.code,'') AS wh_code
     FROM stock_balances b
     LEFT JOIN warehouses w ON w.id = b.warehouse_id
     WHERE b.product_id IN (${ph})
       AND IFNULL(b.qty, 0) != 0
       AND IFNULL(w.is_active, 1) = 1
     ORDER BY ABS(b.qty) DESC, w.name`,
    productIds
  );
  const byProduct = new Map<
    string,
    Array<{ warehouse_id: string; name: string; code: string; qty: number }>
  >();
  for (const r of rows) {
    const pid = String(r.product_id || '');
    if (!pid) continue;
    const list = byProduct.get(pid) || [];
    list.push({
      warehouse_id: String(r.warehouse_id || ''),
      name: String(r.wh_name || ''),
      code: String(r.wh_code || ''),
      qty: Number(r.qty) || 0,
    });
    byProduct.set(pid, list);
  }
  return items.map((it) => {
    if (String(itItemKind(it)) === 'service') {
      return {
        ...it,
        stock_qty: null,
        stock_qty_main: null,
        stock_qty_pickable: null,
        stock_qty_warehouse: null,
        stock_warehouses: [],
      };
    }
    const pid = String(it.product_guid || '').trim();
    const list = pid ? byProduct.get(pid) || [] : [];
    const total = list.reduce((s, x) => s + (Number(x.qty) || 0), 0);
    const mainQty = list
      .filter((x) => String(x.code || '').toUpperCase() === 'MAIN' || /^основн/i.test(x.name))
      .reduce((s, x) => s + (Number(x.qty) || 0), 0);
    const pickableQty = list
      .filter((x) => isPickableStockWarehouse(x.code, x.name))
      .reduce((s, x) => s + Math.max(0, Number(x.qty) || 0), 0);
    const lineWh = String(it.warehouse_id || '').trim();
    const onLine = lineWh ? list.find((x) => x.warehouse_id === lineWh) : undefined;
    return {
      ...it,
      stock_qty: total,
      stock_qty_main: mainQty,
      stock_qty_pickable: pickableQty,
      stock_qty_warehouse: onLine ? onLine.qty : lineWh ? 0 : null,
      stock_warehouses: list,
    };
  });
}

function itItemKind(it: Record<string, unknown>): string {
  return String(it.item_kind || '').toLowerCase();
}

export function getDeal(id: string) {
  const deal = get('SELECT * FROM crm_deals WHERE id = ?', [id]);
  if (!deal) return null;
  normalizeDealItemIntegers(id);
  const withName = withResponsibleName(
    deal as Record<string, unknown>,
    responsibleNameMap([String((deal as { responsible_user_id?: string }).responsible_user_id || '')])
  );
  const items = attachDealItemsStock(
    all(
      `SELECT i.*,
            IFNULL(p.id,'') AS catalog_product_id,
            IFNULL(p.is_active,0) AS product_is_active,
            IFNULL(p.name,'') AS product_name_1c,
            IFNULL(c.name,'') AS category_name,
            IFNULL(w.name,'') AS warehouse_name,
            IFNULL(cp.name,'') AS supplier_name,
            IFNULL(d.number,'') AS in_doc_number,
            IFNULL(substr(d.doc_date,1,10),'') AS in_doc_date,
            IFNULL(p.is_main,0) AS is_main_product,
            IFNULL(p.brand,'') AS brand,
            CASE
              WHEN IFNULL(p.item_kind,'product') = 'service' THEN 'service'
              WHEN lower(replace(IFNULL(u.short_name,''), '.', '')) IN ('усл','услуга','услуг') THEN 'service'
              ELSE 'product'
            END AS item_kind
     FROM crm_deal_items i
     LEFT JOIN products p ON p.id = NULLIF(TRIM(IFNULL(i.product_guid,'')), '')
     LEFT JOIN categories c ON c.id = p.category_id
     LEFT JOIN units u ON u.id = p.unit_id
     LEFT JOIN warehouses w ON w.id = NULLIF(TRIM(IFNULL(i.warehouse_id,'')), '')
     LEFT JOIN counterparties cp ON cp.id = NULLIF(TRIM(IFNULL(i.supplier_id,'')), '')
     LEFT JOIN stock_docs d ON d.id = NULLIF(TRIM(IFNULL(i.in_doc_id,'')), '')
     WHERE i.deal_id = ?
     ORDER BY i.line_no, i.name`,
      [id]
    ).map((it) => {
      const row = it as Record<string, unknown>;
      const widgetName = String(row.name || '').trim();
      const catalogName = warehouseCatalogName({
        name_1c: String(row.name_1c || ''),
        product_name_1c: String(row.product_name_1c || ''),
      });
      const lineSku = String(row.sku || '').trim();
      const lineName = widgetName || catalogName;
      const inCatalog =
        Boolean(String(row.catalog_product_id || '').trim()) &&
        Number(row.product_is_active) === 1;
      const product_missing = !inCatalog;
      const disp = product_missing
        ? {
            display_name: `Не найдено: ${[lineSku, lineName].filter(Boolean).join(' — ') || 'позиция'}`,
            name_1c: catalogName || lineName,
            has_applicability: false,
          }
        : customerOrderLineDisplayName({
            applicability_name: widgetName,
            name_1c: String(row.name_1c || ''),
            product_name_1c: String(row.product_name_1c || ''),
            product_guid: String(row.product_guid || ''),
            mark: String(row.mark || ''),
            model: String(row.model || ''),
            generation: String(row.generation || ''),
            category: String(row.category_name || ''),
          });
      const qty = Math.max(0, Math.round(Number(row.qty) || 0));
      const price = Math.max(0, Math.round(Number(row.price) || 0));
      const amountRaw = Number(row.amount);
      const amount =
        Number.isFinite(amountRaw) && Math.abs(amountRaw) > 0.0001
          ? roundMoney(amountRaw)
          : roundMoney(qty * price);
      return {
        ...row,
        product_id: String(row.product_guid || ''),
        product_missing,
        name_1c: disp.name_1c,
        display_name: disp.display_name,
        has_applicability: disp.has_applicability,
        name_display: disp.display_name,
        qty,
        price,
        amount,
        serials: parseSerialsJson(String(row.serials_json || '[]')),
      } as Record<string, unknown>;
    })
  );
  // PDF / docs from product_media for line products
  const docs: Array<Record<string, unknown>> = [];
  for (const it of items) {
    const guid = String(it.product_guid || '');
    if (!guid) continue;
    const media = all(
      `SELECT id, kind, mime, ext, url, size, orientation, width, height
       FROM product_media WHERE product_id = ? AND kind = 'document'
       ORDER BY sort_order`,
      [guid]
    );
    for (const m of media) {
      docs.push({
        ...m,
        product_guid: guid,
        sku: it.sku,
        product_name: it.display_name || it.name,
      });
    }
  }
  const isSto = dealIsSto(withName as Record<string, unknown>);
  const packTypes = dealSalesDocPackTypes({
    ...(withName as Record<string, unknown>),
    is_sto: isSto ? 1 : 0,
    is_sto_manual: Number((withName as { is_sto_manual?: number }).is_sto_manual) || 0,
    items,
  });
  return {
    ...withName,
    is_sto: isSto ? 1 : 0,
    is_sto_manual: Number((withName as { is_sto_manual?: number }).is_sto_manual) || 0,
    doc_pack_types: packTypes,
    ship_channel: mapAmoShipChannel(withName as Record<string, unknown>),
    items,
    documents: docs,
    sales_docs: all(
      `SELECT s.id, s.doc_type, s.number, s.doc_date, s.total, s.status, s.created_at,
              IFNULL(s.organization_id,'') AS organization_id,
              IFNULL(o.short_name,'') AS organization_short,
              IFNULL(o.name,'') AS organization_name,
              IFNULL(o.company_id,'') AS organization_company_id
       FROM sales_docs s
       LEFT JOIN organizations o ON o.id = s.organization_id
       WHERE s.deal_id = ?
       ORDER BY datetime(s.created_at) DESC`,
      [id]
    ),
    payments: all(
      `SELECT id, kind, amount, status, qrc_id, payload, account, purpose, created_at,
              IFNULL(meta_json,'{}') AS meta_json,
              CASE WHEN length(image_png_base64)>0 THEN 1 ELSE 0 END AS has_image
       FROM deal_payments WHERE deal_id = ? ORDER BY datetime(created_at) DESC LIMIT 20`,
      [id]
    ),
    payment_split: getDealPaymentSplit(id),
    fiscal_receipts: all(
      `SELECT id, kind, status, amount, atol_uuid, external_id, error, created_at, updated_at
       FROM fiscal_receipts WHERE deal_id = ? ORDER BY datetime(created_at) DESC LIMIT 20`,
      [id]
    ),
    pay_questions: all(
      `SELECT * FROM crm_events WHERE deal_id = ? AND kind = 'pay_question'
       ORDER BY datetime(event_at) DESC LIMIT 30`,
      [id]
    ),
    crm_tasks: all(
      `SELECT * FROM crm_tasks WHERE deal_id = ?
       ORDER BY CASE status WHEN 'open' THEN 0 ELSE 1 END, datetime(created_at) DESC
       LIMIT 50`,
      [id]
    ),
    is_legal_entity: dealIsLegalEntity(withName as Record<string, unknown>),
    is_partner: dealIsPartner(withName as Record<string, unknown>),
    client_role: resolveClientRole(withName as Record<string, unknown>),
    buyer_form: resolveBuyerForm(withName as Record<string, unknown>),
    amo_field_options: {
      amo_channel: amoSaleFieldOptions('amo_channel'),
      amo_sto: amoSaleFieldOptions('amo_sto'),
      amo_shipment: amoSaleFieldOptions('amo_shipment'),
      amo_branch: amoSaleFieldOptions('amo_branch'),
      amo_payment_type: amoSaleFieldOptions('amo_payment_type'),
      amo_pay_method: amoSaleFieldOptions('amo_pay_method'),
    },
    sale_rules: (() => {
      const payments = all(
        `SELECT id, kind, amount, status FROM deal_payments WHERE deal_id = ? ORDER BY datetime(created_at) DESC LIMIT 20`,
        [id]
      );
      const dealForRules = {
        ...(withName as Record<string, unknown>),
        id,
        payments,
        items,
      };
      return {
        ...buildDealSaleRules(dealForRules),
        workorder_gate: getDealWorkorderGate(dealForRules),
      };
    })(),
    next_hints: (() => {
      const payments = all(
        `SELECT id, kind, amount, status FROM deal_payments WHERE deal_id = ? ORDER BY datetime(created_at) DESC LIMIT 20`,
        [id]
      );
      const salesDocs = all(
        `SELECT id, doc_type, number, total, car_plate, printed_at FROM sales_docs WHERE deal_id = ?`,
        [id]
      ) as Array<Record<string, unknown>>;
      const fiscal = all(
        `SELECT id, kind, status FROM fiscal_receipts WHERE deal_id = ? ORDER BY datetime(created_at) DESC LIMIT 20`,
        [id]
      ) as Array<Record<string, unknown>>;
      const stockOuts = all(
        `SELECT id, number FROM stock_docs
         WHERE doc_type = 'out' AND (IFNULL(deal_id,'') = ? OR IFNULL(basis_order_id,'') = ?)
         LIMIT 20`,
        [id, id]
      ) as Array<Record<string, unknown>>;
      const split = getDealPaymentSplit(id);
      const tree = buildOrderDocTree(id);
      const hasTransferOrder = !!(
        tree &&
        Array.isArray(tree.root?.children) &&
        tree.root.children.some(
          (n) =>
            (n.kind === 'transfer_order' || n.kind === 'sto_transfer') &&
            n.present
        )
      );
      return buildDealNextHints(
        {
          ...(withName as Record<string, unknown>),
          payments,
          sales_docs: salesDocs,
          fiscal_receipts: fiscal,
        },
        {
          sales_docs: salesDocs,
          fiscal_receipts: fiscal,
          stock_outs: stockOuts,
          paid:
            Number((withName as { paid?: number }).paid) === 1 ||
            String((withName as { payment_status?: string }).payment_status || '').toLowerCase() ===
              'paid',
          due_total: Number(split?.due_total) || 0,
          need_stock_out: tree?.need_stock_out,
          has_goods: tree?.has_goods,
          has_transfer_order: hasTransferOrder,
        }
      );
    })(),
    ...(() => {
      const lock = dealCompositionLocked(id);
      return {
        composition_locked: lock.locked,
        composition_locked_reason: lock.reason,
      };
    })(),
    doc_tree: (() => {
      const tree = buildOrderDocTree(id);
      return tree;
    })(),
    sts_photos: stsMediaInfo(id),
    pdn_scans: (() => {
      try {
        return pdnScansSummary(id);
      } catch {
        return { items: [], count: 0, scans_ok: false };
      }
    })(),
    pdn_sms: (() => {
      try {
        return pdnSmsSummary(id);
      } catch {
        return { signed: false, status: '', signed_at: '', phone_masked: '', link_url: '', sender: '' };
      }
    })(),
    client_parts: (() => {
      try {
        return clientPartsSummary(id);
      } catch {
        return { items: [], count: 0, has_parts: false, photos: [] };
      }
    })(),
    car_photos: (() => {
      try {
        return dealCarPhotosSummary(id);
      } catch {
        return { items: [], count: 0, min_required: 12, photos_ok: false, sides: [], first_at: '' };
      }
    })(),
    pending_service_suggestions: (() => {
      try {
        if (!isSto) return [];
        return listPendingServiceSuggestionsForDeal(id);
      } catch (e) {
        console.warn('[deal] pending services:', e instanceof Error ? e.message : e);
        return [];
      }
    })(),
  };
}

/** Кол-во / цена / сумма позиций сделки — только целые рубли и штуки. */
function roundMoney(n: number): number {
  return Math.round(Number(n) || 0);
}

/** Подтянуть дробные qty/price/amount в целые (Amo мог отдать 1.001 / 0.01). */
function normalizeDealItemIntegers(dealId: string): void {
  const id = String(dealId || '').trim();
  if (!id) return;
  run(
    `UPDATE crm_deal_items
     SET qty = ROUND(IFNULL(qty, 0)),
         price = ROUND(IFNULL(price, 0)),
         amount = ROUND(ROUND(IFNULL(qty, 0)) * ROUND(IFNULL(price, 0)))
     WHERE deal_id = ?`,
    [id]
  );
}

/** После полной оплаты состав заказа нельзя менять. Частичная (товар предоплачен, услуги/доп. товар ещё нет) — можно добавлять. */
export function dealCompositionLocked(dealId: string): { locked: boolean; reason: string } {
  const id = String(dealId || '').trim();
  if (!id) return { locked: false, reason: '' };
  const deal = get<{ paid?: number; payment_status?: string; amount_locked?: number }>(
    `SELECT IFNULL(paid,0) AS paid, IFNULL(payment_status,'') AS payment_status,
            IFNULL(amount_locked,0) AS amount_locked
     FROM crm_deals WHERE id = ?`,
    [id]
  );
  if (!deal) return { locked: false, reason: '' };
  const split = getDealPaymentSplit(id);
  if (split.due_total > 0.009) {
    return { locked: false, reason: '' };
  }
  if (split.fully_paid && split.total > 0) {
    return { locked: true, reason: 'Заказ оплачен — добавлять и удалять позиции нельзя' };
  }
  if (Number(deal.amount_locked) === 1) {
    return {
      locked: true,
      reason: 'Сумма заказа зафиксирована — добавлять и удалять позиции нельзя',
    };
  }
  const paidPay = get<{ c: number }>(
    `SELECT COUNT(*) AS c FROM deal_payments
     WHERE deal_id = ?
       AND lower(IFNULL(status,'')) IN ('paid','confirmed','success','accepted')`,
    [id]
  );
  if (Number(paidPay?.c) > 0) {
    return { locked: true, reason: 'Заказ оплачен — добавлять и удалять позиции нельзя' };
  }
  try {
    const paidLink = get<{ c: number }>(
      `SELECT COUNT(*) AS c FROM payment_links
       WHERE deal_id = ? AND lower(IFNULL(status,'')) = 'paid'`,
      [id]
    );
    if (Number(paidLink?.c) > 0) {
      return { locked: true, reason: 'Заказ оплачен — добавлять и удалять позиции нельзя' };
    }
  } catch {
    /* table may be absent in old DBs */
  }
  const paidInv = get<{ c: number }>(
    `SELECT COUNT(*) AS c FROM sales_docs
     WHERE deal_id = ? AND doc_type = 'invoice'
       AND lower(IFNULL(status,'')) IN ('paid','оплачен','оплачено')`,
    [id]
  );
  if (Number(paidInv?.c) > 0) {
    return { locked: true, reason: 'Счёт оплачен — добавлять и удалять позиции нельзя' };
  }
  return { locked: false, reason: '' };
}

/** Пересчитать сумму сделки по строкам позиций. */
export function recalcDealTotals(dealId: string): { items_count: number; price: number } {
  normalizeDealItemIntegers(dealId);
  // amount мог остаться 0 при синке из Amo — берём qty×price
  run(
    `UPDATE crm_deal_items
     SET amount = ROUND(IFNULL(qty,0) * IFNULL(price,0))
     WHERE deal_id = ?
       AND IFNULL(amount,0) = 0
       AND IFNULL(price,0) != 0`,
    [dealId]
  );
  const agg = get<{ c: number; total: number }>(
    `SELECT COUNT(*) AS c,
            COALESCE(SUM(CASE
              WHEN IFNULL(amount,0) != 0 THEN amount
              ELSE ROUND(IFNULL(qty,0) * IFNULL(price,0))
            END), 0) AS total
     FROM crm_deal_items WHERE deal_id = ?`,
    [dealId]
  );
  const itemsCount = Number(agg?.c) || 0;
  const price = roundMoney(Number(agg?.total) || 0);
  run(
    `UPDATE crm_deals SET items_count = ?, price = ?, updated_at = ? WHERE id = ?`,
    [itemsCount, price, new Date().toISOString(), dealId]
  );
  try {
    syncDealPaidStatus(dealId);
  } catch {
    /* ignore */
  }
  return { items_count: itemsCount, price };
}

function productUnitName(unitId: string | null | undefined): string {
  const id = String(unitId || '').trim();
  if (!id) return '';
  return (
    get<{ short_name: string }>('SELECT short_name FROM units WHERE id = ?', [id])?.short_name ||
    ''
  );
}

/**
 * Добавить позицию в сделку из номенклатуры (по product_id / sku / code).
 * Цена: из body.price, иначе розничная из product_prices.
 */
export function addDealItem(
  dealId: string,
  opts: {
    product_id?: string;
    sku?: string;
    code?: string;
    qty?: number;
    price?: number;
    warehouse_id?: string;
    supplier_id?: string;
    in_doc_id?: string;
    mark?: string;
    model?: string;
    generation?: string;
  }
):
  | {
      ok: true;
      item: Record<string, unknown>;
      deal: ReturnType<typeof getDeal>;
      service_suggestions?: ServiceSuggestion[];
      /** @deprecated пусто — услуги не добавляются сами, только предлагаются */
      auto_services?: Record<string, unknown>[];
    }
  | { ok: false; error: string } {
  const lock = dealCompositionLocked(dealId);
  if (lock.locked) return { ok: false, error: lock.reason };
  const deal = get('SELECT id FROM crm_deals WHERE id = ?', [dealId]);
  if (!deal) return { ok: false, error: 'not found' };

  const productId = String(opts.product_id || '').trim();
  const skuQ = String(opts.sku || '').trim();
  const codeQ = String(opts.code || '').trim();

  let product = productId
    ? get<Record<string, unknown>>('SELECT * FROM products WHERE id = ?', [productId])
    : null;
  if (!product && skuQ) {
    product = get<Record<string, unknown>>(
      `SELECT * FROM products WHERE sku = ? OR code = ? LIMIT 1`,
      [skuQ, skuQ]
    );
  }
  if (!product && codeQ) {
    product = get<Record<string, unknown>>(
      `SELECT * FROM products WHERE code = ? OR sku = ? LIMIT 1`,
      [codeQ, codeQ]
    );
  }
  if (!product) return { ok: false, error: 'Товар не найден (укажите product_id, sku или code)' };

  const qty = Math.max(1, Math.round(Number(opts.qty) || 1));
  const retail = loadRetailPrices([String(product.id)]);
  const price =
    opts.price != null && Number.isFinite(Number(opts.price))
      ? Math.max(0, Math.round(Number(opts.price)))
      : Math.round(retail.get(String(product.id)) ?? 0);
  const amount = roundMoney(qty * price);

  const maxLine =
    get<{ m: number }>(
      'SELECT COALESCE(MAX(line_no), 0) AS m FROM crm_deal_items WHERE deal_id = ?',
      [dealId]
    )?.m ?? 0;
  const lineNo = Number(maxLine) + 1;
  const itemId = newGuid();
  const warehouseId = String(opts.warehouse_id || '').trim();
  const supplierId = String(opts.supplier_id || '').trim();
  const inDocId = String(opts.in_doc_id || '').trim();
  const mark = String(opts.mark || '').trim();
  const model = String(opts.model || '').trim();
  const generation = String(opts.generation || '').trim();

  run(
    `INSERT INTO crm_deal_items (
       id, deal_id, product_guid, sku, code, name, brand, price, qty, amount, unit, department, note, line_no,
       warehouse_id, supplier_id, in_doc_id, mark, model, generation
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      itemId,
      dealId,
      String(product.id),
      String(product.sku || ''),
      String(product.code || ''),
      String(product.name || ''),
      String(product.brand || ''),
      price,
      qty,
      amount,
      productUnitName(product.unit_id as string),
      '',
      '',
      lineNo,
      warehouseId,
      supplierId,
      inDocId,
      mark,
      model,
      generation,
    ]
  );

  let suggestions: ServiceSuggestion[] = [];
  try {
    if (String(product.item_kind || 'product') !== 'service') {
      suggestions = suggestLinkedServicesForDealItem({
        dealId,
        parentItemId: itemId,
        productId: String(product.id),
        qty,
      });
    }
  } catch (e) {
    console.warn('[deal] service suggestions:', e instanceof Error ? e.message : e);
  }

  recalcDealTotals(dealId);
  const item = get('SELECT * FROM crm_deal_items WHERE id = ?', [itemId]) as Record<
    string,
    unknown
  >;
  softEnsureClientStockReserve(dealId);
  return {
    ok: true,
    item,
    deal: getDeal(dealId),
    service_suggestions: suggestions,
    auto_services: [],
  };
}

/** Применить выбранные пользователем услуги к позиции товара. */
export function acceptDealItemServiceSuggestions(
  dealId: string,
  parentItemId: string,
  services: Array<{ service_product_id: string; qty?: number; price?: number }>,
  opts?: { mark?: string; model?: string; generation?: string }
):
  | { ok: true; items: Record<string, unknown>[]; deal: ReturnType<typeof getDeal> }
  | { ok: false; error: string } {
  const lock = dealCompositionLocked(dealId);
  if (lock.locked) return { ok: false, error: lock.reason };
  try {
    const items = applySuggestedServicesForDealItem({
      dealId,
      parentItemId,
      services,
      mark: opts?.mark,
      model: opts?.model,
      generation: opts?.generation,
    });
    recalcDealTotals(dealId);
    return { ok: true, items, deal: getDeal(dealId) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'error' };
  }
}

export function updateDealItem(
  dealId: string,
  itemId: string,
  opts: { qty?: number; price?: number }
): { ok: true; item: Record<string, unknown>; deal: ReturnType<typeof getDeal> } | { ok: false; error: string } {
  const lock = dealCompositionLocked(dealId);
  if (lock.locked) return { ok: false, error: lock.reason };
  const item = get<Record<string, unknown>>(
    'SELECT * FROM crm_deal_items WHERE id = ? AND deal_id = ?',
    [itemId, dealId]
  );
  if (!item) return { ok: false, error: 'not found' };

  const qty =
    opts.qty != null && Number.isFinite(Number(opts.qty))
      ? Math.max(1, Math.round(Number(opts.qty)))
      : Math.max(1, Math.round(Number(item.qty) || 1));
  const price =
    opts.price != null && Number.isFinite(Number(opts.price))
      ? Math.max(0, Math.round(Number(opts.price)))
      : Math.max(0, Math.round(Number(item.price) || 0));
  const amount = roundMoney(qty * price);
  run(`UPDATE crm_deal_items SET qty = ?, price = ?, amount = ? WHERE id = ? AND deal_id = ?`, [
    qty,
    price,
    amount,
    itemId,
    dealId,
  ]);
  recalcDealTotals(dealId);
  softEnsureClientStockReserve(dealId);
  const updated = get('SELECT * FROM crm_deal_items WHERE id = ?', [itemId]) as Record<
    string,
    unknown
  >;
  return { ok: true, item: updated, deal: getDeal(dealId) };
}

export function deleteDealItem(
  dealId: string,
  itemId: string
):
  | { ok: true; deal: ReturnType<typeof getDeal>; deleted: Record<string, unknown> }
  | { ok: false; error: string } {
  const lock = dealCompositionLocked(dealId);
  if (lock.locked) return { ok: false, error: lock.reason };
  const item = get<Record<string, unknown>>(
    'SELECT * FROM crm_deal_items WHERE id = ? AND deal_id = ?',
    [itemId, dealId]
  );
  if (!item) return { ok: false, error: 'not found' };
  /* С авто-услугами: удаляем дочерние строки */
  try {
    run(`DELETE FROM crm_deal_items WHERE deal_id = ? AND parent_item_id = ?`, [dealId, itemId]);
  } catch {
    /* колонки может не быть на старой БД до migrate */
  }
  run('DELETE FROM crm_deal_items WHERE id = ? AND deal_id = ?', [itemId, dealId]);
  recalcDealTotals(dealId);
  return { ok: true, deal: getDeal(dealId), deleted: item };
}

/**
 * Скан марки (Data Matrix) или штрихкода на сборке:
 * — марка → экземпляр in_stock → сверка с позицией заказа;
 * — штрихкод товара с серийным учётом → FIFO следующего экземпляра;
 * — штрихкод товара без марок → токен bc:… (подтверждение штуки, расходная без серийников).
 */
export function assignDealUnitByScan(
  dealId: string,
  serialRaw: string,
  opts?: { item_id?: string }
): {
  ok: true;
  serial: string;
  sku: string;
  product_name: string;
  warehouse_name: string;
  supplier_name: string;
  apps_label: string;
  apps_short: string;
  item: Record<string, unknown>;
  deal: ReturnType<typeof getDeal>;
  matched_by: string;
  scan_kind: 'mark' | 'barcode' | 'barcode_unit';
} {
  const dealIdSafe = String(dealId || '').trim();
  if (!dealIdSafe) throw new Error('deal_id required');
  const dealRow = get('SELECT id FROM crm_deals WHERE id = ?', [dealIdSafe]);
  if (!dealRow) throw new Error('Заказ покупателя не найден');

  const code = String(serialRaw || '').trim();
  if (!code) throw new Error('Укажите марку (Data Matrix) или штрихкод товара');

  const preferItemId = String(opts?.item_id || '').trim();
  const lines = all<{
    id: string;
    product_guid: string;
    sku: string;
    name: string;
    qty: number;
    serials_json: string;
    item_kind: string;
    warehouse_id: string;
    mark: string;
    model: string;
    generation: string;
  }>(
    `SELECT i.id, IFNULL(i.product_guid,'') AS product_guid, IFNULL(i.sku,'') AS sku,
            IFNULL(i.name,'') AS name, i.qty, IFNULL(i.serials_json,'[]') AS serials_json,
            IFNULL(i.warehouse_id,'') AS warehouse_id,
            IFNULL(i.mark,'') AS mark, IFNULL(i.model,'') AS model, IFNULL(i.generation,'') AS generation,
            CASE
              WHEN IFNULL(p.item_kind,'product') = 'service' THEN 'service'
              ELSE 'product'
            END AS item_kind
     FROM crm_deal_items i
     LEFT JOIN products p ON p.id = NULLIF(TRIM(IFNULL(i.product_guid,'')), '')
     WHERE i.deal_id = ?
     ORDER BY i.line_no, i.name`,
    [dealIdSafe]
  ).filter((l) => l.item_kind !== 'service');

  const need = (l: (typeof lines)[0]) => {
    const have = parseSerialsJson(l.serials_json).length;
    const qty = Math.max(1, Math.round(Number(l.qty) || 1));
    return Math.max(0, qty - have);
  };

  const pickTarget = (productId: string, sku: string) => {
    let target = preferItemId ? lines.find((l) => l.id === preferItemId) : undefined;
    let matchedBy = 'item_id';
    if (target) {
      if (String(target.product_guid || '') !== productId) {
        throw new Error(
          `Артикул скана (${sku || productId}) не совпадает с позицией заказа (${target.sku || target.product_guid})`
        );
      }
      if (need(target) <= 0) {
        throw new Error('По этой позиции уже набрано нужное число');
      }
      return { target, matchedBy };
    }
    target = lines.find((l) => String(l.product_guid || '') === productId && need(l) > 0);
    matchedBy = 'product_id';
    if (!target && sku) {
      target = lines.find(
        (l) =>
          String(l.sku || '').trim().toLowerCase() === sku.toLowerCase() && need(l) > 0
      );
      matchedBy = 'sku';
    }
    if (!target) {
      const anySame = lines.find((l) => String(l.product_guid || '') === productId);
      if (anySame) {
        throw new Error(
          `Для артикула ${sku || productId} уже набрано (${parseSerialsJson(anySame.serials_json).length}/${Math.round(Number(anySame.qty) || 1)})`
        );
      }
      throw new Error(
        `В заказе нет позиции с артикулом «${sku || productId}» — скан не подходит`
      );
    }
    return { target, matchedBy };
  };

  const writeLinePick = (input: {
    target: (typeof lines)[0];
    token: string;
    warehouseId: string;
    supplierId: string;
    inDocId: string;
    matchedBy: string;
    sku: string;
    productName: string;
    warehouseName: string;
    supplierName: string;
    appsLabel: string;
    appsShort: string;
    scanKind: 'mark' | 'barcode' | 'barcode_unit';
  }) => {
    const nextSerials = [...parseSerialsJson(input.target.serials_json), input.token];
    run(
      `UPDATE crm_deal_items
       SET serials_json = ?,
           warehouse_id = CASE WHEN ? != '' THEN ? ELSE warehouse_id END,
           supplier_id = CASE WHEN ? != '' THEN ? ELSE supplier_id END,
           in_doc_id = CASE WHEN ? != '' THEN ? ELSE in_doc_id END
       WHERE id = ? AND deal_id = ?`,
      [
        JSON.stringify(nextSerials),
        input.warehouseId,
        input.warehouseId,
        input.supplierId,
        input.supplierId,
        input.inDocId,
        input.inDocId,
        input.target.id,
        dealIdSafe,
      ]
    );
    const item = get('SELECT * FROM crm_deal_items WHERE id = ?', [input.target.id]) as Record<
      string,
      unknown
    >;
    return {
      ok: true as const,
      serial: input.token,
      sku: input.sku || String(item.sku || ''),
      product_name: input.productName || String(item.name || ''),
      warehouse_name: input.warehouseName,
      supplier_name: input.supplierName,
      apps_label: input.appsLabel,
      apps_short: input.appsShort,
      item: { ...item, serials: nextSerials },
      deal: getDeal(dealIdSafe),
      matched_by: input.matchedBy,
      scan_kind: input.scanKind,
    };
  };

  const assignFromUnit = (
    unit: NonNullable<ReturnType<typeof findUnitBySerial>>,
    scanKind: 'mark' | 'barcode_unit',
    matchedByOverride?: string
  ) => {
    if (String(unit.status || '') !== 'in_stock') {
      throw new Error(
        `Марка «${unit.serial}» не на остатке (статус: ${unit.status || '—'}) — нужна единица in_stock`
      );
    }
    const productId = String(unit.product_id || '').trim();
    const sku = String((unit as { sku?: string }).sku || '').trim();
    const productName = String((unit as { product_name?: string }).product_name || '').trim();
    const warehouseId = String(unit.warehouse_id || '').trim();
    const warehouseName = String((unit as { warehouse_name?: string }).warehouse_name || '').trim();
    const inDocId = String(unit.in_doc_id || '').trim();
    const serial = String(unit.serial || '').trim();

    let supplierId = '';
    let supplierName = '';
    if (inDocId) {
      const doc = get<{ counterparty_id: string | null }>(
        `SELECT counterparty_id FROM stock_docs WHERE id = ?`,
        [inDocId]
      );
      supplierId = String(doc?.counterparty_id || '').trim();
      if (supplierId) {
        supplierName =
          get<{ name: string }>('SELECT name FROM counterparties WHERE id = ?', [supplierId])
            ?.name || '';
      }
    }

    const serialLower = serial.toLowerCase();
    for (const l of lines) {
      const already = parseSerialsJson(l.serials_json);
      if (already.some((s) => s.toLowerCase() === serialLower)) {
        throw new Error(`Марка «${serial}» уже привязана к позиции заказа`);
      }
    }

    const { target, matchedBy } = pickTarget(productId, sku);
    const unitApps = Array.isArray((unit as { apps?: AppVehicle[] }).apps)
      ? ((unit as { apps: AppVehicle[] }).apps)
      : [];
    const vehicleCheck = unitAppsMatchVehicle(unitApps, {
      mark: target.mark,
      model: target.model,
      generation: target.generation,
    });
    if (!vehicleCheck.ok) {
      throw new Error(vehicleCheck.reason);
    }

    return writeLinePick({
      target,
      token: serial,
      warehouseId,
      supplierId,
      inDocId,
      matchedBy: matchedByOverride || matchedBy,
      sku,
      productName,
      warehouseName,
      supplierName,
      appsLabel: String((unit as { apps_label?: string }).apps_label || appsHumanLabel(unitApps)),
      appsShort: String((unit as { apps_short?: string }).apps_short || ''),
      scanKind,
    });
  };

  // 1) Прямой скан Data Matrix / серийника
  const unitDirect = findUnitBySerial(code);
  if (unitDirect) {
    return assignFromUnit(unitDirect, 'mark');
  }

  // 2) Штрихкод / артикул / код товара
  const product = get<{
    id: string;
    sku: string;
    name: string;
    barcode: string;
  }>(
    `SELECT id, IFNULL(sku,'') AS sku, IFNULL(name,'') AS name, IFNULL(barcode,'') AS barcode
     FROM products
     WHERE lower(IFNULL(barcode,'')) = lower(?)
        OR lower(IFNULL(sku,'')) = lower(?)
        OR lower(IFNULL(code,'')) = lower(?)
        OR replace(IFNULL(gtin,''), ' ', '') = replace(?, ' ', '')
     LIMIT 1`,
    [code, code, code, code]
  );
  if (!product) {
    throw new Error(`Марка / штрихкод «${code}» не найден`);
  }

  const productId = String(product.id || '').trim();
  const sku = String(product.sku || '').trim();
  const { target, matchedBy } = pickTarget(productId, sku);

  // Товар с экземплярами: штрихкод → взять следующий in_stock
  if (productRequiresSerials(productId)) {
    const exclude = lines.flatMap((l) => parseSerialsJson(l.serials_json));
    const unit = findNextInStockUnitForProduct(productId, {
      warehouseId: String(target.warehouse_id || '').trim(),
      excludeSerials: exclude,
    });
    if (!unit) {
      throw new Error(
        `Товар «${sku || product.name}» учёт по маркам — на остатке нет свободного экземпляра. Отсканируйте Data Matrix.`
      );
    }
    return assignFromUnit(unit, 'barcode_unit', matchedBy);
  }

  // Товар без марок: подтверждаем штуку токеном штрихкода
  const have = parseSerialsJson(target.serials_json);
  const token = `bc:${code}:${have.length + 1}`;
  if (have.some((s) => s.toLowerCase() === token.toLowerCase())) {
    throw new Error(`Штрихкод «${code}» уже учтён в этой позиции`);
  }

  const bal = get<{ warehouse_id: string; warehouse_name: string }>(
    `SELECT b.warehouse_id AS warehouse_id, IFNULL(w.name,'') AS warehouse_name
     FROM stock_balances b
     LEFT JOIN warehouses w ON w.id = b.warehouse_id
     WHERE b.product_id = ? AND b.qty > 0.0001
     ORDER BY
       CASE WHEN b.warehouse_id = ? THEN 0 ELSE 1 END,
       b.qty DESC
     LIMIT 1`,
    [productId, String(target.warehouse_id || '').trim()]
  );
  const warehouseId = String(bal?.warehouse_id || target.warehouse_id || '').trim();
  const warehouseName = String(bal?.warehouse_name || '').trim();
  if (!warehouseId) {
    throw new Error(`Нет остатка по «${sku || product.name}» — сначала оприходуйте товар`);
  }

  return writeLinePick({
    target,
    token,
    warehouseId,
    supplierId: '',
    inDocId: '',
    matchedBy: matchedBy === 'product_id' ? 'barcode' : matchedBy,
    sku,
    productName: String(product.name || ''),
    warehouseName,
    supplierName: '',
    appsLabel: 'без марки · штрихкод',
    appsShort: 'штрих',
    scanKind: 'barcode',
  });
}
