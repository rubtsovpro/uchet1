/**
 * Передача на склад для Автосервис / Самовывоз → резерв (не списание).
 */
import { get } from './db.js';
import {
  courierWarehouseId,
  ensureWarehouseByCode,
  mainWarehouseId,
  stoWarehouseId,
} from './supply-chain.js';

export type PickSiteId = 'strela' | 'fogel' | 'msk';

function norm(s: unknown): string {
  return String(s ?? '')
    .trim()
    .toLowerCase()
    .replace(/ё/g, 'е');
}

export function pickSiteLabel(site: PickSiteId | string): string {
  if (site === 'msk') return 'МСК';
  if (site === 'fogel') return 'Фогель';
  return 'Стрела';
}

export function amoBranchToPickSite(branch: string): PickSiteId | null {
  const b = norm(branch);
  if (!b) return null;
  if (/фогель|fogel/.test(b)) return 'fogel';
  if (/стрела|strela|фадеева\s*124/.test(b)) return 'strela';
  if (/москва|можай|msk|пневмо/.test(b)) return 'msk';
  return null;
}

function amoStoToPickSite(sto: string): PickSiteId | null {
  const s = norm(sto);
  if (!s) return null;
  if (/фогель|fogel/.test(s)) return 'fogel';
  if (/стрела|strela|фадеева/.test(s) && !/подвеск|можай|моск/.test(s)) return 'strela';
  if (/можай|моск|подвеск/.test(s)) return 'msk';
  return null;
}

function resolvePickSiteForWarehouse(warehouseId: string): PickSiteId {
  const id = String(warehouseId || '').trim();
  if (!id) return 'strela';
  const wh = get<{ code: string; name: string }>(
    `SELECT IFNULL(code,'') AS code, IFNULL(name,'') AS name FROM warehouses WHERE id = ?`,
    [id]
  );
  const blob = `${wh?.code || ''} ${wh?.name || ''}`.toLowerCase();
  if (/фогель|fogel|54291ec9/.test(blob)) return 'fogel';
  if (/москва|msk|филиал|можай|00-000001|нф-000032|sto-res-msk|sto-rsv-msk/.test(blob)) return 'msk';
  if (/стрела|strela|6f66468a|нф-000047|фадеева|sto-res-strela/.test(blob)) return 'strela';
  return 'strela';
}

export function resolvePickSiteForDeal(dealId: string, warehouseId?: string): PickSiteId {
  const id = String(dealId || '').trim();
  if (id) {
    const d = get<{
      department: string;
      amo_branch: string;
      amo_sto: string;
    }>(
      `SELECT IFNULL(department,'') AS department,
              IFNULL(amo_branch,'') AS amo_branch,
              IFNULL(amo_sto,'') AS amo_sto
       FROM crm_deals WHERE id = ?`,
      [id]
    );
    const byBranch = amoBranchToPickSite(String(d?.amo_branch || ''));
    if (byBranch) return byBranch;
    const bySto = amoStoToPickSite(String(d?.amo_sto || ''));
    if (bySto) return bySto;
    const dep = norm(d?.department);
    if (/fogel|фогель/.test(dep)) return 'fogel';
    if (/moscow|mosk|москва|msk|pnevmopodveska/.test(dep)) return 'msk';
  }
  const whId = String(warehouseId || '').trim();
  if (whId) return resolvePickSiteForWarehouse(whId);
  return 'strela';
}

/** Канал реализации → резервирование на отдельный склад (не WAIT-PAY). */
export function isReserveChannelDeal(input: {
  amo_channel?: string;
  amo_shipment?: string;
  ship_channel?: string;
} | null | undefined): boolean {
  if (!input) return false;
  const ch = norm(input.amo_channel);
  const ship = norm(input.amo_shipment || input.ship_channel);
  if (/автосервис/.test(ch)) return true;
  if (/самовывоз/.test(ch) || ship === 'pickup' || /самовывоз/.test(ship)) return true;
  return false;
}

/**
 * Виртуальные склады Москвы / филиалов:
 * — STO-RSV-* «Резерв СТО» — куда кладёт Amo «Основной → Резерв» (сделки самовывоз / автосервис);
 * — STO-RES-* «Отложено под СТО» — отдельная зона на тех же стеллажах (не путать с резервом и с полом СТО).
 */
export function ensureStoReserveWarehouses(): {
  msk: string;
  mskHold: string;
  strela: string;
} {
  const mskRsv = ensureWarehouseByCode('STO-RSV-MSK', 'Резерв СТО');
  const mskHold = ensureWarehouseByCode('STO-RES-MSK', 'Отложено под СТО');
  const strelaId = ensureWarehouseByCode('STO-RES-STRELA', 'Отложено под СТО · Стрела');
  return { msk: mskRsv, mskHold, strela: strelaId };
}

/** Куда класть новый резерв по сделке (не «Отложено» — это другой виртуальный склад на тех же стеллажах). */
const RESERVE_WH_CODES: Record<PickSiteId, string[]> = {
  msk: ['STO-RSV-MSK'],
  // Стрела/Фогель: 1С «Резерв!!! …», не STO-RES (Отложено).
  strela: ['НФ-000047'],
  fogel: ['НФ-000047'],
};

function warehouseByCode(codes: string[]): { id: string; code: string; name: string } | null {
  for (const code of codes) {
    const row = get<{ id: string; code: string; name: string }>(
      `SELECT id, IFNULL(code,'') AS code, IFNULL(name,'') AS name
       FROM warehouses WHERE code = ? AND IFNULL(is_active,1) = 1 LIMIT 1`,
      [code]
    );
    if (row?.id) return row;
  }
  return null;
}

/** Основные склады 1С по контуру (не синтетика MAIN/MSK/KRD). */
const SITE_1C_WH_CODES: Record<PickSiteId, string[]> = {
  msk: ['НФ-000032'],
  strela: ['НФ-000045', 'НФ-000047'],
  fogel: ['НФ-000041', 'НФ-000042'],
};

/**
 * Подпись склада как в 1С.
 * Синтетику Учёта (Основной / MSK / KRD) подменяем на реальный склад 1С контура.
 */
export function warehouseNameAs1c(warehouseId: string, dealId?: string): string {
  const id = String(warehouseId || '').trim();
  if (!id) return '';
  const row = get<{ code: string; name: string }>(
    `SELECT IFNULL(code,'') AS code, IFNULL(name,'') AS name FROM warehouses WHERE id = ?`,
    [id]
  );
  if (!row) return '';
  const code = String(row.code || '').trim();
  const name = String(row.name || '').trim();
  // Уже склад 1С (НФ-… / 00-…) — как в Get/Stores
  if (/^(НФ-|00-)/i.test(code)) return name || code;
  // Синтетика остатков Учёта → основной склад 1С контура
  if (code === 'MAIN' || code === 'KRD') {
    const site = dealId
      ? resolvePickSiteForDeal(dealId, id)
      : resolvePickSiteForWarehouse(id);
    const oneC = warehouseByCode(SITE_1C_WH_CODES[site] || SITE_1C_WH_CODES.msk);
    if (oneC?.name) return oneC.name;
  }
  return name || code;
}

function warehouseByNameLike(pattern: string): { id: string; code: string; name: string } | null {
  const row = get<{ id: string; code: string; name: string }>(
    `SELECT id, IFNULL(code,'') AS code, IFNULL(name,'') AS name
     FROM warehouses
     WHERE IFNULL(is_active,1) = 1 AND name LIKE ?
     ORDER BY name LIMIT 1`,
    [`%${pattern}%`]
  );
  return row?.id ? row : null;
}

/** Склад резерва по контуру /pick (МСК · Стрела · Фогель). */
export function reserveWarehouseForPickSite(site: PickSiteId): { id: string; code: string; name: string } {
  ensureStoReserveWarehouses();
  const codes = RESERVE_WH_CODES[site] || RESERVE_WH_CODES.strela;
  const row = warehouseByCode(codes);
  if (row) return row;
  const nameRow =
    site === 'msk'
      ? warehouseByNameLike('Резерв СТО') ||
        warehouseByNameLike('Резерв СТО · Москва')
      : site === 'fogel'
        ? warehouseByNameLike('Резерв!!! Стрела') ||
          warehouseByNameLike('Резерв!!! Фогель')
        : warehouseByNameLike('Резерв!!! Стрела') ||
          warehouseByNameLike('Резерв!!! Фадеева');
  if (nameRow) return nameRow;
  throw new Error(`Склад «Резерв СТО» не найден для контура «${pickSiteLabel(site)}»`);
}

export function resolveReserveWarehouseForDeal(
  dealId: string,
  sourceWarehouseId?: string
): { id: string; code: string; name: string; pick_site: PickSiteId } {
  const site = resolvePickSiteForDeal(dealId, sourceWarehouseId);
  const wh = reserveWarehouseForPickSite(site);
  return { ...wh, pick_site: site };
}

export type HandoffReserveMeta = {
  is_reserve: boolean;
  purpose_label: string;
  from_warehouse_id: string;
  from_warehouse_code: string;
  from_warehouse_name: string;
  dest_warehouse_id: string;
  dest_warehouse_code: string;
  dest_warehouse_name: string;
  route_label: string;
  pick_site: PickSiteId;
  pick_site_label: string;
};

export function buildHandoffReserveMeta(
  dealId: string,
  sourceWarehouseId?: string,
  destWarehouseId?: string
): HandoffReserveMeta | null {
  const id = String(dealId || '').trim();
  if (!id) return null;
  const d = get<{ amo_channel: string; amo_shipment: string; ship_channel: string }>(
    `SELECT IFNULL(amo_channel,'') AS amo_channel,
            IFNULL(amo_shipment,'') AS amo_shipment,
            IFNULL(ship_channel,'') AS ship_channel
     FROM crm_deals WHERE id = ?`,
    [id]
  );
  if (!isReserveChannelDeal(d)) return null;

  const fromId = String(sourceWarehouseId || mainWarehouseId()).trim();
  const from = get<{ code: string; name: string }>(
    `SELECT IFNULL(code,'') AS code, IFNULL(name,'') AS name FROM warehouses WHERE id = ?`,
    [fromId]
  );
  const fromName = String(from?.name || 'Основной').trim() || 'Основной';
  const fromCode = String(from?.code || 'MAIN').trim() || 'MAIN';

  let destId = String(destWarehouseId || '').trim();
  let destCode = '';
  let destName = '';
  let pickSite: PickSiteId = resolvePickSiteForDeal(id, fromId);
  const expected = resolveReserveWarehouseForDeal(id, fromId);

  if (destId) {
    const dest = get<{ code: string; name: string }>(
      `SELECT IFNULL(code,'') AS code, IFNULL(name,'') AS name FROM warehouses WHERE id = ?`,
      [destId]
    );
    destCode = String(dest?.code || '').trim();
    destName = String(dest?.name || '').trim();
    const stoId = stoWarehouseId();
    const isStoDest =
      destId === stoId || destCode === 'STO' || /^сто$/i.test(destName);
    const isHoldDest =
      /^STO-RES-/i.test(destCode) || /отложен/i.test(destName);
    // «Отложено» ≠ «Резерв СТО»: передача на склад всегда на expected (МСК → STO-RSV).
    // Старые черновики / UI могли подставить STO-RES.
    if (!isStoDest && (destId !== expected.id || isHoldDest)) {
      destId = expected.id;
      destCode = expected.code;
      destName = expected.name;
      pickSite = expected.pick_site;
    }
  } else {
    destId = expected.id;
    destCode = expected.code;
    destName = expected.name;
    pickSite = expected.pick_site;
  }

  if (!destName) return null;

  return {
    is_reserve: true,
    purpose_label: 'Резервирование · Автосервис / Самовывоз',
    from_warehouse_id: fromId,
    from_warehouse_code: fromCode,
    from_warehouse_name: fromName,
    dest_warehouse_id: destId,
    dest_warehouse_code: destCode,
    dest_warehouse_name: destName,
    route_label: `${fromName} → ${destName}`,
    pick_site: pickSite,
    pick_site_label: pickSiteLabel(pickSite),
  };
}

/** Дописать в комментарий маркер резерва (идемпотентно). */
export function ensureReserveHandoffComment(comment: string): string {
  const c = String(comment || '').trim();
  if (/резерв/i.test(c)) return c;
  if (!c) return 'Резерв · Передача на склад';
  return `Резерв · ${c}`;
}

/** Канал «Отправка» → перемещение на склад курьера после оплаты. */
export function isShipChannelDeal(input: {
  amo_channel?: string;
  amo_shipment?: string;
  ship_channel?: string;
} | null | undefined): boolean {
  if (!input) return false;
  const ch = norm(input.amo_channel);
  if (/автосервис|самовывоз/.test(ch)) return false;
  if (/отправк/i.test(ch)) return true;
  const amoShip = norm(input.amo_shipment);
  if (amoShip && !/самовывоз|автосервис/.test(amoShip)) {
    if (
      /^(cdek|avito|dellin|pek|bus|own_courier|ozon|other|transfer|production)/.test(
        amoShip
      ) ||
      /сдэк|cdek|авито|курьер|автобус|дел\s*лин|пэк|озон|проч/.test(amoShip)
    ) {
      return true;
    }
  }
  const ship = norm(input.ship_channel);
  if (!ship || ship === 'pickup' || /самовывоз|автосервис/.test(ship)) return false;
  // Без «Отправка» в Amo не доверяем stale other / own_courier — только явные ТК-коды.
  return /^(cdek_prepaid|cdek_cod|avito_cod|dellin|pek|bus|ozon|transfer|production)/.test(
    ship
  );
}

export type HandoffShipMeta = {
  is_ship: boolean;
  purpose_label: string;
  from_warehouse_id: string;
  from_warehouse_name: string;
  dest_warehouse_id: string;
  dest_warehouse_name: string;
  route_label: string;
  pick_site: PickSiteId;
  pick_site_label: string;
};

export function buildHandoffShipMeta(
  dealId: string,
  sourceWarehouseId?: string
): HandoffShipMeta | null {
  const id = String(dealId || '').trim();
  if (!id) return null;
  const d = get<{ amo_channel: string; amo_shipment: string; ship_channel: string }>(
    `SELECT IFNULL(amo_channel,'') AS amo_channel,
            IFNULL(amo_shipment,'') AS amo_shipment,
            IFNULL(ship_channel,'') AS ship_channel
     FROM crm_deals WHERE id = ?`,
    [id]
  );
  if (!isShipChannelDeal(d)) return null;
  const fromId = String(sourceWarehouseId || mainWarehouseId()).trim();
  const destId = courierWarehouseId();
  const dest = get<{ name: string }>(
    `SELECT IFNULL(name,'') AS name FROM warehouses WHERE id = ?`,
    [destId]
  );
  const pickSite = resolvePickSiteForDeal(id, fromId);
  const fromName = warehouseNameAs1c(fromId, id) || 'ФИЛИАЛ МОСКВА';
  const destName = String(dest?.name || 'Склад курьера').trim() || 'Склад курьера';
  return {
    is_ship: true,
    purpose_label: 'Отправка · перемещение на склад курьера',
    from_warehouse_id: fromId,
    from_warehouse_name: fromName,
    dest_warehouse_id: destId,
    dest_warehouse_name: destName,
    route_label: `${fromName} → ${destName}`,
    pick_site: pickSite,
    pick_site_label: pickSiteLabel(pickSite),
  };
}
