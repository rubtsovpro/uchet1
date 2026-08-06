/**
 * Сделки / воронки AmoCRM → Анти1С (через amo1c export).
 */
import { execFile, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';
import { all, get, run } from './db.js';
import { newGuid } from './ids.js';
import { customerOrderLineDisplayName } from './product-display-name.js';
import { buildOrderDocTree } from './order-doc-tree.js';
import { findUnitBySerial, normalizeSerials, parseSerialsJson } from './product-units.js';
import { appsHumanLabel, unitAppsMatchVehicle, type AppVehicle } from './applicability-party.js';
import { loadRetailPrices } from './stock-valuation.js';
import {
  buildDealSaleRules,
  buildDealNextHints,
  dealIsPartner,
  resolveIsSto,
  resolveDocPack,
} from './deal-sale-rules.js';
import { getDealPaymentSplit, syncDealPaidStatus } from './deal-payment-split.js';
import { checkAmoSaleConfigDrift } from './amo-sale-config.js';
import { stsMediaInfo } from './sts-media.js';

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
};

function normPlate(v: unknown): string {
  return String(v ?? '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '');
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
  run(
    `UPDATE crm_deals
     SET car_plate = ?, car_vin = ?, car_year = ?, car_mileage = ?,
         car_brand = ?, car_model = ?, car_color = ?, car_category = ?, car_pts = ?,
         car_owner = ?, car_owner_street = ?, car_owner_house = ?, car_owner_flat = ?,
         car_sts_date = ?, car_sts_number = ?,
         updated_at = datetime('now')
     WHERE id = ?`,
    [
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
      id,
    ]
  );
}

/** Покупатель заказа: ФИО/название, ИНН, признак юрлица — для УПД и документов. */
export function updateDealBuyer(
  dealId: string,
  fields: {
    buyer_name?: string;
    buyer_inn?: string;
    company_name?: string;
    is_legal_entity?: boolean | number;
    buyer_kind?: string;
  }
): void {
  const id = String(dealId || '').trim();
  if (!id) throw new Error('deal_id required');
  const row = get('SELECT id FROM crm_deals WHERE id = ?', [id]);
  if (!row) throw new Error('Заказ покупателя не найден');

  const name = fields.buyer_name != null ? String(fields.buyer_name).trim() : null;
  const inn =
    fields.buyer_inn != null ? String(fields.buyer_inn).replace(/\D/g, '') : null;
  const company =
    fields.company_name != null ? String(fields.company_name).trim() : null;
  const legal =
    fields.is_legal_entity != null
      ? Number(fields.is_legal_entity) ? 1 : 0
      : null;
  let kind =
    fields.buyer_kind != null ? String(fields.buyer_kind).trim().toLowerCase() : null;
  if (legal === 1 && !kind) kind = 'legal';
  if (legal === 0 && !kind) kind = 'person';

  const sets: string[] = [];
  const params: Array<string | number> = [];
  if (name != null) {
    sets.push('buyer_name = ?');
    params.push(name);
  }
  if (inn != null) {
    sets.push('buyer_inn = ?');
    params.push(inn);
  }
  if (company != null) {
    sets.push('company_name = ?');
    params.push(company);
  }
  if (legal != null) {
    sets.push('is_legal_entity = ?');
    params.push(legal);
  }
  if (kind != null) {
    sets.push('buyer_kind = ?');
    params.push(kind);
  }
  if (!sets.length) return;
  sets.push(`updated_at = datetime('now')`);
  params.push(id);
  run(`UPDATE crm_deals SET ${sets.join(', ')} WHERE id = ?`, params);

  // подтянуть в документы сделки
  const docSets: string[] = [];
  const docParams: string[] = [];
  if (name != null) {
    docSets.push('counterparty_name = ?');
    docParams.push(name);
  }
  if (inn != null) {
    docSets.push('counterparty_inn = ?');
    docParams.push(inn);
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

/** Контур (организация) на заказе — только до выписки счёта. */
export function setDealOrgCompany(dealId: string, orgCompanyId: string): void {
  const id = String(dealId || '').trim();
  if (!id) throw new Error('deal_id required');
  const row = get('SELECT id FROM crm_deals WHERE id = ?', [id]);
  if (!row) throw new Error('Заказ покупателя не найден');
  if (dealInvoiceOrganizationId(id)) {
    throw new Error('После выписки счёта организацию и юрлицо менять нельзя');
  }
  const co = String(orgCompanyId || '').trim();
  run(
    `UPDATE crm_deals
     SET org_company_id = ?, updated_at = datetime('now')
     WHERE id = ?`,
    [co, id]
  );
}

export function dealIsLegalEntity(deal: Record<string, unknown> | null | undefined): boolean {
  if (!deal) return false;
  if (dealIsPartner(deal)) return true;
  if (Number(deal.is_legal_entity) === 1) return true;
  const kind = String(deal.buyer_kind || '').toLowerCase();
  if (kind === 'person' || kind === 'individual' || kind === 'физлицо') return false;
  if (['legal', 'ip', 'partner'].includes(kind)) return true;
  // company_id — id карточки (в т.ч. у физлица), не признак юрлица
  const inn = String(deal.buyer_inn || '').replace(/\D/g, '');
  if (inn.length === 10) return true;
  if (inn.length === 12 && kind === 'ip') return true;
  return false;
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
  const existing = String(input.ship_channel || '').trim();
  if (
    existing &&
    ['cdek_prepaid', 'cdek_cod', 'pickup', 'bus', 'own_courier'].includes(existing)
  ) {
    return existing;
  }
  const channel = String(input.amo_channel || '').trim().toLowerCase();
  const shipment = String(input.amo_shipment || '').trim().toLowerCase();
  if (/самовывоз/.test(channel) || /автосервис/.test(channel)) return 'pickup';
  if (/налож/.test(shipment)) return 'cdek_cod';  if (/автобус/.test(shipment)) return 'bus';  if (/курьер/.test(shipment)) return 'own_courier';  if (/сдэк|cdek|тк\s*сдэк/.test(shipment)) return 'cdek_prepaid';  if (/отправ/.test(channel)) {
    if (/налож/.test(shipment)) return 'cdek_cod';
    return 'cdek_prepaid';
  }
  const hint = `${input.department || ''} ${input.name || ''}`.toLowerCase();
  if (/самовывоз|pickup/.test(hint)) return 'pickup';
  if (/налож/.test(hint)) return 'cdek_cod';
  return 'cdek_prepaid';
}

/** Имя ответственного из staff по amo_id. */
function responsibleNameMap(amoIds: string[]): Map<string, string> {
  const ids = [...new Set(amoIds.map(String).filter(Boolean))];
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

/** Контур из маппинга воронки (meta integration_amo.pipeline_company). */
function orgCompanyIdForPipeline(pipelineId: string): string {
  const pipe = String(pipelineId || '').trim();
  if (!pipe) return '';
  const row = get<{ value: string }>('SELECT value FROM meta WHERE key = ?', ['integration_amo']);
  if (!row?.value) return '';
  try {
    const parsed = JSON.parse(row.value) as { pipeline_company?: Record<string, string> };
    const m = parsed?.pipeline_company;
    if (!m || typeof m !== 'object') return '';
    return String(m[pipe] || '').trim();
  } catch {
    return '';
  }
}

export function upsertDealRecord(d: Record<string, unknown>): void {
  const id = String(d.id || '').trim();
  if (!id) return;
  const items = Array.isArray(d.items) ? d.items : [];
  const amoChannel = String(d.amo_channel || '').trim();
  const amoShipment = String(d.amo_shipment || '').trim();
  const shipChannel = mapAmoShipChannel({
    amo_channel: amoChannel,
    amo_shipment: amoShipment,
    ship_channel: String(d.ship_channel || ''),
    name: String(d.name || ''),
    department: String(d.department || ''),
  });
  const amoPaymentType = String(d.amo_payment_type || '').trim();
  const amoPayMethod = String(d.amo_pay_method || '').trim();
  const amoSto = String(d.amo_sto || '').trim();
  const isPartnerFlag = Number(d.is_partner) === 1 || String(d.buyer_kind || '').toLowerCase() === 'partner';
  const buyerKindRaw = String(d.buyer_kind || 'person').trim() || 'person';
  const buyerKind = isPartnerFlag ? 'partner' : buyerKindRaw;
  const dealForRules = {
    ...d,
    amo_channel: amoChannel,
    amo_shipment: amoShipment,
    amo_payment_type: amoPaymentType,
    amo_pay_method: amoPayMethod,
    amo_sto: amoSto,
    is_partner: isPartnerFlag ? 1 : 0,
    buyer_kind: buyerKind,
    ship_channel: shipChannel,
  };
  const guessedSto = guessDealIsSto(dealForRules as Record<string, unknown>);
  const pipelineId = String(d.pipeline_id || '');
  const orgCompanyId =
    String(d.org_company_id || '').trim() || orgCompanyIdForPipeline(pipelineId);
  run(
    `INSERT INTO crm_deals (
       id, name, price, pipeline_id, pipeline_name, status_id, status_name,
       responsible_user_id, department, queued_to_1c, queue_status, queued_by, queued_at,
       amo_url, print_url, items_count,
       company_id, company_name, buyer_name, buyer_inn, buyer_phone, buyer_kind, is_legal_entity,
       is_partner, ship_channel, amo_channel, amo_shipment,
       amo_payment_type, amo_pay_method, amo_sto,
       is_sto, is_sto_manual, org_company_id,
       created_at, updated_at, synced_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, datetime('now'))
     ON CONFLICT(id) DO UPDATE SET
       name=excluded.name, price=excluded.price,
       pipeline_id=excluded.pipeline_id, pipeline_name=excluded.pipeline_name,
       status_id=excluded.status_id, status_name=excluded.status_name,
       responsible_user_id=excluded.responsible_user_id, department=excluded.department,
       queued_to_1c=excluded.queued_to_1c, queue_status=excluded.queue_status,
       queued_by=excluded.queued_by, queued_at=excluded.queued_at,
       amo_url=excluded.amo_url, print_url=excluded.print_url,
       items_count=excluded.items_count,
       company_id=excluded.company_id, company_name=excluded.company_name,
       buyer_name=excluded.buyer_name, buyer_inn=excluded.buyer_inn,
       buyer_phone=excluded.buyer_phone, buyer_kind=excluded.buyer_kind,
       is_legal_entity=excluded.is_legal_entity,
       is_partner=excluded.is_partner,
       ship_channel=excluded.ship_channel,
       amo_channel=excluded.amo_channel,
       amo_shipment=excluded.amo_shipment,
       amo_payment_type=excluded.amo_payment_type,
       amo_pay_method=excluded.amo_pay_method,
       amo_sto=excluded.amo_sto,
       is_sto=CASE WHEN crm_deals.is_sto_manual = 1 THEN crm_deals.is_sto ELSE excluded.is_sto END,
       org_company_id=CASE
         WHEN IFNULL(excluded.org_company_id,'') != '' THEN excluded.org_company_id
         ELSE crm_deals.org_company_id
       END,
       created_at=COALESCE(excluded.created_at, crm_deals.created_at),
       updated_at=excluded.updated_at, synced_at=datetime('now')`,
    [
      id,
      String(d.name || ''),
      Number(d.price) || 0,
      pipelineId,
      String(d.pipeline_name || ''),
      String(d.status_id || ''),
      String(d.status_name || ''),
      String(d.responsible_user_id || ''),
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
      String(d.buyer_name || ''),
      String(d.buyer_inn || ''),
      String(d.buyer_phone || ''),
      buyerKind,
      dealIsLegalEntity(dealForRules as Record<string, unknown>) ? 1 : 0,
      isPartnerFlag ? 1 : 0,
      shipChannel,
      amoChannel,
      amoShipment,
      amoPaymentType,
      amoPayMethod,
      amoSto,
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
    run(
      `INSERT INTO crm_deal_items (
         id, deal_id, product_guid, sku, code, name, brand, price, qty, amount, unit, department, note, line_no
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        itemId,
        id,
        String(it.product_guid || ''),
        String(it.sku || ''),
        String(it.code || ''),
        String(it.name || ''),
        String(it.brand || ''),
        Number(it.price) || 0,
        Number(it.qty) || 0,
        Number(it.amount) || 0,
        String(it.unit || ''),
        String(it.department || ''),
        String(it.note || ''),
        lineNo,
      ]
    );
  }
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
  return pipes.map((p) => ({
    id: String(p.id),
    name: String(p.name),
    sort: Number(p.sort) || 0,
    is_archive: Number(p.is_archive) || 0,
    statuses: byPipe.get(String(p.id)) || [],
    deals_count:
      get<{ c: number }>('SELECT COUNT(*) AS c FROM crm_deals WHERE pipeline_id = ?', [
        String(p.id),
      ])?.c ?? 0,
    queued_count:
      get<{ c: number }>(
        `SELECT COUNT(*) AS c FROM crm_deals WHERE pipeline_id = ? AND queued_to_1c = 1`,
        [String(p.id)]
      )?.c ?? 0,
  }));
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
  if (opts.q) {
    where.push(
      `(name LIKE ? OR id LIKE ? OR IFNULL(buyer_name,'') LIKE ? OR IFNULL(company_name,'') LIKE ? OR IFNULL(department,'') LIKE ?)`
    );
    const like = `%${opts.q}%`;
    params.push(like, like, like, like, like);
  }
  const dealRows = all(
    `SELECT id, name, price, pipeline_id, pipeline_name, status_id, status_name,
            responsible_user_id, department,
            buyer_name, company_name, buyer_phone, buyer_kind, is_legal_entity,
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
}): Promise<{ ok: true; http: number } | { ok: false; error: string; http?: number }> {
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

/** Фильтр «Канал реализации» (Автосервис / Самовывоз / Отправка). */
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
  if (ch === 'автосервис' || ch === 'autoservice' || ch === 'sto') {
    where.push(`lower(IFNULL(amo_channel,'')) LIKE ?`);
    params.push('%автосервис%');
    return;
  }
  if (ch === 'самовывоз' || ch === 'pickup') {
    where.push(`lower(IFNULL(amo_channel,'')) LIKE ?`);
    params.push('%самовывоз%');
    return;
  }
  if (ch === 'отправка' || ch === 'shipping' || ch === 'ship') {
    where.push(`lower(IFNULL(amo_channel,'')) LIKE ?`);
    params.push('%отправ%');
    return;
  }
  where.push(`lower(IFNULL(amo_channel,'')) LIKE ?`);
  params.push(`%${ch}%`);
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
  page?: number;
  limit?: number;
  /** Только сделки из очереди amo1c «Отправить в 1С» (таблица deals). */
  queuedTo1c?: boolean;
  queueStatus?: string;
  /** queued_at | created_at | updated_at | price | name | status_name | pipeline_name | responsible_user_id */
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
  if (opts.q) {
    const qRaw = String(opts.q).trim();
    const digits = qRaw.replace(/\D+/g, '');
    where.push(
      `(name LIKE ? OR id LIKE ? OR IFNULL(department,'') LIKE ?
        OR IFNULL(buyer_name,'') LIKE ? OR IFNULL(company_name,'') LIKE ?
        OR IFNULL(buyer_phone,'') LIKE ? OR IFNULL(status_name,'') LIKE ?
        OR IFNULL(pipeline_name,'') LIKE ?
        OR IFNULL(responsible_user_id,'') IN (
          SELECT amo_id FROM staff WHERE name LIKE ?
        )
        OR IFNULL(queued_by,'') LIKE ?
        OR (? != '' AND REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(IFNULL(buyer_phone,''),' ',''),'-',''),'+',''),'(',''),')','') LIKE ?))`
    );
    const like = `%${qRaw}%`;
    const phoneLike = digits ? `%${digits}%` : '';
    params.push(like, like, like, like, like, like, like, like, like, like, digits, phoneLike);
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
    pipeline_name: 'IFNULL(pipeline_name,"") COLLATE NOCASE',
    company_name: 'IFNULL(company_name,"") COLLATE NOCASE',
    buyer_name: 'IFNULL(buyer_name, IFNULL(buyer_phone,"")) COLLATE NOCASE',
    responsible_user_id:
      `(SELECT IFNULL(MAX(name),'') FROM staff WHERE amo_id = crm_deals.responsible_user_id) COLLATE NOCASE`,
    queue_status: 'IFNULL(queue_status,"") COLLATE NOCASE',
    id: 'CAST(id AS INTEGER)',
  };
  const orderExpr = sortMap[sortKey] || sortMap.queued_at;
  const dir = opts.dir === 'asc' ? 'ASC' : 'DESC';
  const total =
    get<{ c: number }>(`SELECT COUNT(*) AS c FROM crm_deals ${whereSql}`, params)?.c ?? 0;
  const items = attachResponsibleNames(
    all(
      `SELECT * FROM crm_deals ${whereSql}
     ORDER BY ${orderExpr} ${dir}
     LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    ) as Array<Record<string, unknown>>
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

export function getDeal(id: string) {
  const deal = get('SELECT * FROM crm_deals WHERE id = ?', [id]);
  if (!deal) return null;
  const withName = withResponsibleName(
    deal as Record<string, unknown>,
    responsibleNameMap([String((deal as { responsible_user_id?: string }).responsible_user_id || '')])
  );
  const items = all(
    `SELECT i.*,
            IFNULL(p.name,'') AS product_name_1c,
            IFNULL(c.name,'') AS category_name,
            IFNULL(w.name,'') AS warehouse_name,
            IFNULL(cp.name,'') AS supplier_name,
            IFNULL(d.number,'') AS in_doc_number,
            IFNULL(substr(d.doc_date,1,10),'') AS in_doc_date,
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
    const name1c =
      String(row.product_name_1c || '').trim() || String(row.name || '').trim();
    const disp = customerOrderLineDisplayName({
      product_guid: String(row.product_guid || ''),
      name: name1c,
      product_name: name1c,
      mark: String(row.mark || ''),
      model: String(row.model || ''),
      generation: String(row.generation || ''),
      category: String(row.category_name || ''),
    });
    return {
      ...row,
      product_id: String(row.product_guid || ''),
      name_1c: disp.name_1c,
      display_name: disp.display_name,
      has_applicability: disp.has_applicability,
      name_display: disp.display_name,
      serials: parseSerialsJson(String(row.serials_json || '[]')),
    } as Record<string, unknown>;
  });
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
    sale_rules: buildDealSaleRules({
      ...(withName as Record<string, unknown>),
      payments: all(
        `SELECT id, kind, amount, status FROM deal_payments WHERE deal_id = ? ORDER BY datetime(created_at) DESC LIMIT 20`,
        [id]
      ),
    }),
    next_hints: (() => {
      const payments = all(
        `SELECT id, kind, amount, status FROM deal_payments WHERE deal_id = ? ORDER BY datetime(created_at) DESC LIMIT 20`,
        [id]
      );
      const salesDocs = all(
        `SELECT id, doc_type, number FROM sales_docs WHERE deal_id = ?`,
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
    doc_tree: buildOrderDocTree(id),
    sts_photos: stsMediaInfo(id),
  };
}

function roundMoney(n: number): number {
  return Math.round((Number(n) || 0) * 100) / 100;
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
  const agg = get<{ c: number; total: number }>(
    `SELECT COUNT(*) AS c, COALESCE(SUM(amount), 0) AS total
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
): { ok: true; item: Record<string, unknown>; deal: ReturnType<typeof getDeal> } | { ok: false; error: string } {
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

  const qty = Math.max(0.001, Number(opts.qty) || 1);
  const retail = loadRetailPrices([String(product.id)]);
  const price =
    opts.price != null && Number.isFinite(Number(opts.price))
      ? Math.max(0, Number(opts.price))
      : retail.get(String(product.id)) ?? 0;
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
  recalcDealTotals(dealId);
  const item = get('SELECT * FROM crm_deal_items WHERE id = ?', [itemId]) as Record<
    string,
    unknown
  >;
  return { ok: true, item, deal: getDeal(dealId) };
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
      ? Math.max(0.001, Number(opts.qty))
      : Number(item.qty) || 1;
  const price =
    opts.price != null && Number.isFinite(Number(opts.price))
      ? Math.max(0, Number(opts.price))
      : Number(item.price) || 0;
  const amount = roundMoney(qty * price);
  run(`UPDATE crm_deal_items SET qty = ?, price = ?, amount = ? WHERE id = ? AND deal_id = ?`, [
    qty,
    price,
    amount,
    itemId,
    dealId,
  ]);
  recalcDealTotals(dealId);
  const updated = get('SELECT * FROM crm_deal_items WHERE id = ?', [itemId]) as Record<
    string,
    unknown
  >;
  return { ok: true, item: updated, deal: getDeal(dealId) };
}

export function deleteDealItem(
  dealId: string,
  itemId: string
): { ok: true; deal: ReturnType<typeof getDeal> } | { ok: false; error: string } {
  const lock = dealCompositionLocked(dealId);
  if (lock.locked) return { ok: false, error: lock.reason };
  const item = get('SELECT id FROM crm_deal_items WHERE id = ? AND deal_id = ?', [
    itemId,
    dealId,
  ]);
  if (!item) return { ok: false, error: 'not found' };
  run('DELETE FROM crm_deal_items WHERE id = ? AND deal_id = ?', [itemId, dealId]);
  recalcDealTotals(dealId);
  return { ok: true, deal: getDeal(dealId) };
}

/**
 * Скан марки на сборке: найти экземпляр, сверить артикул с незакрытой позицией заказа,
 * записать марку + склад + поставщик/приход в строку. Потом расходная возьмёт эту марку.
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
} {
  const dealIdSafe = String(dealId || '').trim();
  if (!dealIdSafe) throw new Error('deal_id required');
  const dealRow = get('SELECT id FROM crm_deals WHERE id = ?', [dealIdSafe]);
  if (!dealRow) throw new Error('Заказ покупателя не найден');

  const serial = String(serialRaw || '').trim();
  if (!serial) throw new Error('Укажите марку (скан Data Matrix)');

  const unit = findUnitBySerial(serial);
  if (!unit) throw new Error(`Марка «${serial}» не найдена в экземплярах`);
  if (String(unit.status || '') !== 'in_stock') {
    throw new Error(
      `Марка «${serial}» не на остатке (статус: ${unit.status || '—'}) — нужна единица in_stock`
    );
  }
  const productId = String(unit.product_id || '').trim();
  const sku = String((unit as { sku?: string }).sku || '').trim();
  const productName = String((unit as { product_name?: string }).product_name || '').trim();
  const warehouseId = String(unit.warehouse_id || '').trim();
  const warehouseName = String((unit as { warehouse_name?: string }).warehouse_name || '').trim();
  const inDocId = String(unit.in_doc_id || '').trim();

  let supplierId = '';
  let supplierName = '';
  if (inDocId) {
    const doc = get<{ counterparty_id: string | null; number: string }>(
      `SELECT counterparty_id, number FROM stock_docs WHERE id = ?`,
      [inDocId]
    );
    supplierId = String(doc?.counterparty_id || '').trim();
    if (supplierId) {
      supplierName =
        get<{ name: string }>('SELECT name FROM counterparties WHERE id = ?', [supplierId])
          ?.name || '';
    }
  }

  const preferItemId = String(opts?.item_id || '').trim();
  const lines = all<{
    id: string;
    product_guid: string;
    sku: string;
    name: string;
    qty: number;
    serials_json: string;
    item_kind: string;
    mark: string;
    model: string;
    generation: string;
  }>(
    `SELECT i.id, IFNULL(i.product_guid,'') AS product_guid, IFNULL(i.sku,'') AS sku,
            IFNULL(i.name,'') AS name, i.qty, IFNULL(i.serials_json,'[]') AS serials_json,
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

  const serialLower = serial.toLowerCase();
  for (const l of lines) {
    const already = parseSerialsJson(l.serials_json);
    if (already.some((s) => s.toLowerCase() === serialLower)) {
      throw new Error(`Марка «${serial}» уже привязана к позиции заказа`);
    }
  }

  const need = (l: (typeof lines)[0]) => {
    const have = parseSerialsJson(l.serials_json).length;
    const qty = Math.max(1, Math.round(Number(l.qty) || 1));
    return Math.max(0, qty - have);
  };

  let target = preferItemId ? lines.find((l) => l.id === preferItemId) : undefined;
  let matchedBy = 'item_id';
  if (target) {
    if (String(target.product_guid || '') !== productId) {
      throw new Error(
        `Артикул марки (${sku || productId}) не совпадает с позицией заказа (${target.sku || target.product_guid})`
      );
    }
    if (need(target) <= 0) {
      throw new Error('По этой позиции уже набрано нужное число марок');
    }
  } else {
    // Сначала строки с тем же product_id, где ещё не хватает марок
    target = lines.find((l) => String(l.product_guid || '') === productId && need(l) > 0);
    matchedBy = 'product_id';
    if (!target && sku) {
      target = lines.find(
        (l) =>
          String(l.sku || '').trim().toLowerCase() === sku.toLowerCase() && need(l) > 0
      );
      matchedBy = 'sku';
    }
  }
  if (!target) {
    const anySame = lines.find((l) => String(l.product_guid || '') === productId);
    if (anySame) {
      throw new Error(
        `Для артикула ${sku || productId} марки уже набраны (${parseSerialsJson(anySame.serials_json).length}/${Math.round(Number(anySame.qty) || 1)})`
      );
    }
    throw new Error(
      `В заказе нет позиции с артикулом «${sku || productName || productId}» — скан не подходит`
    );
  }

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

  const nextSerials = [...parseSerialsJson(target.serials_json), serial];
  run(
    `UPDATE crm_deal_items
     SET serials_json = ?,
         warehouse_id = CASE WHEN ? != '' THEN ? ELSE warehouse_id END,
         supplier_id = CASE WHEN ? != '' THEN ? ELSE supplier_id END,
         in_doc_id = CASE WHEN ? != '' THEN ? ELSE in_doc_id END
     WHERE id = ? AND deal_id = ?`,
    [
      JSON.stringify(nextSerials),
      warehouseId,
      warehouseId,
      supplierId,
      supplierId,
      inDocId,
      inDocId,
      target.id,
      dealIdSafe,
    ]
  );

  const item = get('SELECT * FROM crm_deal_items WHERE id = ?', [target.id]) as Record<
    string,
    unknown
  >;
  const appsLabel = String((unit as { apps_label?: string }).apps_label || appsHumanLabel(unitApps));
  return {
    ok: true,
    serial,
    sku: sku || String(item.sku || ''),
    product_name: productName || String(item.name || ''),
    warehouse_name: warehouseName,
    supplier_name: supplierName,
    apps_label: appsLabel,
    apps_short: String((unit as { apps_short?: string }).apps_short || ''),
    item: { ...item, serials: nextSerials },
    deal: getDeal(dealIdSafe),
    matched_by: matchedBy,
  };
}
