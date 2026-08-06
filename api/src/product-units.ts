/**
 * Серийный / экземплярный учёт: одна физическая единица = один serial.
 * qty-учёт (stock_balances) сохраняется; serials — уточнение экземпляров.
 */
import { all, get, run } from './db.js';
import { newGuid } from './ids.js';
import {
  appsHumanLabel,
  appsShortLabel,
  appsToJson,
  parseAppsJson,
  resolveAppsForReceive,
  type AppVehicle,
} from './applicability-party.js';

export type UnitStatus = 'in_stock' | 'reserved' | 'sold' | 'written_off' | 'in_transit' | 'at_client';

export type ProductUnit = {
  id: string;
  product_id: string;
  serial: string;
  warehouse_id: string;
  status: UnitStatus;
  in_doc_id: string;
  in_line_id: string;
  out_doc_id: string;
  out_line_id: string;
  comment: string;
  apps_json?: string;
  created_at: string;
  updated_at: string;
  sku?: string;
  product_name?: string;
  warehouse_name?: string;
  supplier_id?: string;
  supplier_name?: string;
  in_doc_number?: string;
  in_doc_date?: string;
  in_price?: number;
  out_doc_number?: string;
  out_doc_date?: string;
  apps?: AppVehicle[];
  apps_label?: string;
  apps_short?: string;
};

function enrichUnitApps<T extends ProductUnit>(unit: T | undefined): T | undefined {
  if (!unit) return unit;
  const apps = parseAppsJson(unit.apps_json);
  return {
    ...unit,
    apps,
    apps_label: apps.length ? appsHumanLabel(apps) : 'как в каталоге',
    apps_short: appsShortLabel(apps),
  };
}

export function normalizeSerials(raw: unknown): string[] {
  const list: string[] = [];
  if (Array.isArray(raw)) {
    for (const x of raw) {
      const s = String(x || '').trim();
      if (s) list.push(s);
    }
  } else if (typeof raw === 'string') {
    for (const line of raw.split(/[\n,;]+/)) {
      const s = line.trim();
      if (s) list.push(s);
    }
  }
  const seen = new Set<string>();
  const out: string[] = [];
  for (const s of list) {
    const key = s.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
  }
  return out;
}

export function parseSerialsJson(json: string | null | undefined): string[] {
  if (!json) return [];
  try {
    return normalizeSerials(JSON.parse(json));
  } catch {
    return normalizeSerials(json);
  }
}

export function productRequiresSerials(productId: string): boolean {
  const row = get<{ serial_tracked: number }>(
    'SELECT IFNULL(serial_tracked, 0) AS serial_tracked FROM products WHERE id = ?',
    [productId]
  );
  return Number(row?.serial_tracked) === 1;
}

function assertSerialFree(productId: string, serial: string, excludeId?: string): void {
  const clash = get<{ id: string; status: string }>(
    `SELECT id, status FROM product_units
     WHERE product_id = ? AND lower(serial) = lower(?) ${excludeId ? 'AND id != ?' : ''}
     LIMIT 1`,
    excludeId ? [productId, serial, excludeId] : [productId, serial]
  );
  if (clash) {
    throw new Error(`Серийный номер «${serial}» уже есть у этого товара (${clash.status})`);
  }
}

/** Глобально уникальный код Data Matrix (префикс поставщика + номер). */
export function assertSerialGloballyFree(serial: string, excludeId?: string): void {
  const clash = get<{ id: string; product_id: string; status: string }>(
    `SELECT id, product_id, status FROM product_units
     WHERE lower(serial) = lower(?) ${excludeId ? 'AND id != ?' : ''}
     LIMIT 1`,
    excludeId ? [serial, excludeId] : [serial]
  );
  if (clash) {
    throw new Error(`Data Matrix «${serial}» уже занят (${clash.status})`);
  }
}

/** Создать экземпляры «в пути» (ещё не на остатке основного склада). */
export function createInTransitUnits(input: {
  productId: string;
  warehouseId: string;
  serials: string[];
  comment?: string;
}): string[] {
  const serials = normalizeSerials(input.serials);
  if (!serials.length) return [];
  const now = new Date().toISOString();
  const ids: string[] = [];
  for (const serial of serials) {
    assertSerialGloballyFree(serial);
    const id = newGuid();
    run(
      `INSERT INTO product_units
        (id, product_id, serial, warehouse_id, status, in_doc_id, in_line_id, out_doc_id, out_line_id, comment, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'in_transit', '', '', '', '', ?, ?, ?)`,
      [id, input.productId, serial, input.warehouseId, input.comment || 'в пути', now, now]
    );
    ids.push(id);
  }
  return ids;
}

/** Оприходовать экземпляр из «в пути» на склад. */
export function promoteInTransitUnit(input: {
  serial: string;
  warehouseId: string;
  docId: string;
  lineId: string;
}): ProductUnit {
  const unit = get<ProductUnit>(
    `SELECT * FROM product_units WHERE lower(serial) = lower(?) LIMIT 1`,
    [input.serial]
  );
  if (!unit) throw new Error(`Data Matrix «${input.serial}» не найден`);
  if (unit.status !== 'in_transit' && unit.status !== 'in_stock') {
    throw new Error(`Data Matrix «${input.serial}» в статусе ${unit.status} — нельзя оприходовать`);
  }
  const now = new Date().toISOString();
  run(
    `UPDATE product_units
     SET status = 'in_stock', warehouse_id = ?, in_doc_id = ?, in_line_id = ?, updated_at = ?
     WHERE id = ?`,
    [input.warehouseId, input.docId, input.lineId, now, unit.id]
  );
  return { ...unit, status: 'in_stock', warehouse_id: input.warehouseId, in_doc_id: input.docId, in_line_id: input.lineId };
}

/** Возврат от клиента на основной склад. */
export function returnUnitFromClient(input: {
  serial: string;
  warehouseId: string;
  docId: string;
  lineId: string;
  comment?: string;
}): ProductUnit {
  const unit = get<ProductUnit>(
    `SELECT * FROM product_units WHERE lower(serial) = lower(?) LIMIT 1`,
    [input.serial]
  );
  if (!unit) throw new Error(`Data Matrix «${input.serial}» не найден`);
  if (unit.status !== 'sold' && unit.status !== 'at_client' && unit.status !== 'written_off') {
    throw new Error(`Data Matrix «${input.serial}» не у клиента (статус ${unit.status})`);
  }
  const now = new Date().toISOString();
  const note = String(input.comment || '').trim();
  run(
    `UPDATE product_units
     SET status = 'in_stock', warehouse_id = ?, in_doc_id = ?, in_line_id = ?,
         out_doc_id = '', out_line_id = '',
         comment = CASE WHEN ? = '' THEN comment WHEN comment = '' THEN ? ELSE comment || '; ' || ? END,
         updated_at = ?
     WHERE id = ?`,
    [input.warehouseId, input.docId, input.lineId, note, note, note, now, unit.id]
  );
  return {
    ...unit,
    status: 'in_stock',
    warehouse_id: input.warehouseId,
    in_doc_id: input.docId,
    in_line_id: input.lineId,
  };
}

export function findUnitBySerial(serial: string): ProductUnit | undefined {
  const code = String(serial || '').trim();
  if (!code) return undefined;
  const row = get<ProductUnit>(
    `SELECT u.*, p.sku AS sku, p.name AS product_name, w.name AS warehouse_name
     FROM product_units u
     LEFT JOIN products p ON p.id = u.product_id
     LEFT JOIN warehouses w ON w.id = u.warehouse_id
     WHERE lower(u.serial) = lower(?)
     LIMIT 1`,
    [code]
  );
  return enrichUnitApps(row);
}

/** Приход / возврат: создать экземпляры на складе. */
export function receiveUnits(input: {
  productId: string;
  warehouseId: string;
  serials: string[];
  docId: string;
  lineId: string;
  /** Применимость партии; иначе дефолт поставщика / пусто (= каталог). */
  apps?: AppVehicle[] | string | null;
  supplierId?: string;
}): void {
  const serials = normalizeSerials(input.serials);
  if (!serials.length) return;
  const now = new Date().toISOString();
  const apps = resolveAppsForReceive({
    productId: input.productId,
    supplierId: input.supplierId,
    lineApps: input.apps,
  });
  const appsJson = appsToJson(apps);
  for (const serial of serials) {
    assertSerialFree(input.productId, serial);
    run(
      `INSERT INTO product_units
        (id, product_id, serial, warehouse_id, status, in_doc_id, in_line_id, out_doc_id, out_line_id, comment, apps_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'in_stock', ?, ?, '', '', '', ?, ?, ?)`,
      [
        newGuid(),
        input.productId,
        serial,
        input.warehouseId,
        input.docId,
        input.lineId,
        appsJson,
        now,
        now,
      ]
    );
  }
}

/** Расход: списать экземпляры со склада. */
export function shipUnits(input: {
  productId: string;
  warehouseId: string;
  serials: string[];
  docId: string;
  lineId: string;
}): void {
  const serials = normalizeSerials(input.serials);
  if (!serials.length) return;
  const now = new Date().toISOString();
  for (const serial of serials) {
    const unit = get<ProductUnit>(
      `SELECT * FROM product_units
       WHERE product_id = ? AND lower(serial) = lower(?) AND status = 'in_stock'
       LIMIT 1`,
      [input.productId, serial]
    );
    if (!unit) {
      throw new Error(`Экземпляр «${serial}» не найден на остатке (товар)`);
    }
    if (unit.warehouse_id && unit.warehouse_id !== input.warehouseId) {
      throw new Error(
        `Экземпляр «${serial}» на другом складе — сначала переместите`
      );
    }
    run(
      `UPDATE product_units
       SET status = 'sold', out_doc_id = ?, out_line_id = ?, warehouse_id = '', updated_at = ?
       WHERE id = ?`,
      [input.docId, input.lineId, now, unit.id]
    );
  }
}

/** Перемещение: сменить склад у экземпляров. */
export function transferUnits(input: {
  productId: string;
  warehouseFrom: string;
  warehouseTo: string;
  serials: string[];
  docId: string;
  lineId: string;
}): void {
  const serials = normalizeSerials(input.serials);
  if (!serials.length) return;
  const now = new Date().toISOString();
  for (const serial of serials) {
    const unit = get<ProductUnit>(
      `SELECT * FROM product_units
       WHERE product_id = ? AND lower(serial) = lower(?) AND status = 'in_stock'
         AND warehouse_id = ?
       LIMIT 1`,
      [input.productId, serial, input.warehouseFrom]
    );
    if (!unit) {
      throw new Error(`Экземпляр «${serial}» не найден на складе-источнике`);
    }
    run(
      `UPDATE product_units
       SET warehouse_id = ?, updated_at = ?, comment = CASE
         WHEN comment = '' THEN ?
         ELSE comment || '; ' || ?
       END
       WHERE id = ?`,
      [
        input.warehouseTo,
        now,
        `перем. ${input.docId.slice(0, 8)}`,
        `перем. ${input.docId.slice(0, 8)}`,
        unit.id,
      ]
    );
  }
}

export function listProductUnits(opts: {
  productId?: string;
  warehouseId?: string;
  status?: string;
  supplierId?: string;
  inDocId?: string;
  q?: string;
  limit?: number;
  offset?: number;
}): { items: ProductUnit[]; total: number } {
  const where: string[] = ['1=1'];
  const params: Array<string | number> = [];
  if (opts.productId) {
    where.push('u.product_id = ?');
    params.push(opts.productId);
  }
  if (opts.warehouseId) {
    where.push('u.warehouse_id = ?');
    params.push(opts.warehouseId);
  }
  if (opts.status) {
    where.push('u.status = ?');
    params.push(opts.status);
  }
  if (opts.supplierId) {
    where.push('IFNULL(d.counterparty_id, "") = ?');
    params.push(opts.supplierId);
  }
  if (opts.inDocId) {
    where.push('u.in_doc_id = ?');
    params.push(opts.inDocId);
  }
  if (opts.q) {
    const like = `%${opts.q}%`;
    where.push(
      `(u.serial LIKE ? OR IFNULL(p.sku,'') LIKE ? OR IFNULL(p.name,'') LIKE ? OR IFNULL(cp.name,'') LIKE ? OR IFNULL(d.number,'') LIKE ?)`
    );
    params.push(like, like, like, like, like);
  }
  const whereSql = where.join(' AND ');
  const fromSql = `
     FROM product_units u
     LEFT JOIN products p ON p.id = u.product_id
     LEFT JOIN warehouses w ON w.id = u.warehouse_id
     LEFT JOIN stock_docs d ON d.id = u.in_doc_id
     LEFT JOIN counterparties cp ON cp.id = d.counterparty_id
     LEFT JOIN stock_doc_lines inl ON inl.id = u.in_line_id
     LEFT JOIN stock_docs dout ON dout.id = u.out_doc_id`;
  const total =
    get<{ c: number }>(`SELECT COUNT(*) AS c ${fromSql} WHERE ${whereSql}`, params)?.c ?? 0;
  const limit = Math.min(Math.max(Number(opts.limit) || 50, 1), 500);
  const offset = Math.max(Number(opts.offset) || 0, 0);
  const items = all<ProductUnit>(
    `SELECT u.*, p.sku, p.name AS product_name, IFNULL(w.name,'') AS warehouse_name,
            IFNULL(d.counterparty_id,'') AS supplier_id,
            IFNULL(cp.name,'') AS supplier_name,
            IFNULL(d.number,'') AS in_doc_number,
            IFNULL(substr(d.doc_date,1,10),'') AS in_doc_date,
            IFNULL(
              NULLIF(inl.price, 0),
              IFNULL((
                SELECT l2.price FROM stock_doc_lines l2
                WHERE l2.doc_id = u.in_doc_id AND l2.product_id = u.product_id
                ORDER BY l2.line_no LIMIT 1
              ), 0)
            ) AS in_price,
            IFNULL(dout.number,'') AS out_doc_number,
            IFNULL(substr(dout.doc_date,1,10),'') AS out_doc_date
     ${fromSql}
     WHERE ${whereSql}
     ORDER BY datetime(u.created_at) DESC, u.serial
     LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  ).map((u) => enrichUnitApps(u)!);
  return { items, total };
}

/** Поставщики и приходы, с которых ещё есть экземпляры на складе. */
export function listUnitSources(opts: {
  productId: string;
  warehouseId?: string;
}): {
  suppliers: Array<{ id: string; name: string; units: number }>;
  deliveries: Array<{
    id: string;
    number: string;
    doc_date: string;
    supplier_id: string;
    supplier_name: string;
    units: number;
  }>;
} {
  const where: string[] = [`u.status = 'in_stock'`, 'u.product_id = ?'];
  const params: Array<string | number> = [opts.productId];
  if (opts.warehouseId) {
    where.push('u.warehouse_id = ?');
    params.push(opts.warehouseId);
  }
  const whereSql = where.join(' AND ');
  const suppliers = all<{ id: string; name: string; units: number }>(
    `SELECT IFNULL(d.counterparty_id,'') AS id,
            CASE
              WHEN IFNULL(d.counterparty_id,'') = '' THEN 'Без поставщика'
              ELSE IFNULL(NULLIF(cp.name,''), d.counterparty_id)
            END AS name,
            COUNT(*) AS units
     FROM product_units u
     LEFT JOIN stock_docs d ON d.id = u.in_doc_id
     LEFT JOIN counterparties cp ON cp.id = d.counterparty_id
     WHERE ${whereSql}
     GROUP BY IFNULL(d.counterparty_id,''), name
     ORDER BY name`,
    params
  );
  const deliveries = all<{
    id: string;
    number: string;
    doc_date: string;
    supplier_id: string;
    supplier_name: string;
    units: number;
  }>(
    `SELECT u.in_doc_id AS id,
            IFNULL(d.number, CASE WHEN u.in_doc_id = '' THEN 'Без документа' ELSE substr(u.in_doc_id,1,8) END) AS number,
            IFNULL(substr(d.doc_date,1,10),'') AS doc_date,
            IFNULL(d.counterparty_id,'') AS supplier_id,
            CASE
              WHEN IFNULL(d.counterparty_id,'') = '' THEN 'Без поставщика'
              ELSE IFNULL(NULLIF(cp.name,''), d.counterparty_id)
            END AS supplier_name,
            COUNT(*) AS units
     FROM product_units u
     LEFT JOIN stock_docs d ON d.id = u.in_doc_id
     LEFT JOIN counterparties cp ON cp.id = d.counterparty_id
     WHERE ${whereSql}
     GROUP BY u.in_doc_id, d.number, d.doc_date, d.counterparty_id, supplier_name
     ORDER BY d.doc_date DESC, d.number DESC`,
    params
  ).map((d) => {
    const appsRows = all<{ apps_json: string }>(
      `SELECT DISTINCT IFNULL(apps_json,'[]') AS apps_json FROM product_units
       WHERE product_id = ? AND status = 'in_stock' AND IFNULL(in_doc_id,'') = ?
         ${opts.warehouseId ? 'AND warehouse_id = ?' : ''}`,
      opts.warehouseId
        ? [opts.productId, d.id, opts.warehouseId]
        : [opts.productId, d.id]
    );
    const apps = appsRows.flatMap((r) => parseAppsJson(r.apps_json));
    const uniq = parseAppsJson(apps);
    return {
      ...d,
      apps: uniq,
      apps_short: appsShortLabel(uniq),
      apps_label: uniq.length ? appsHumanLabel(uniq) : '',
    };
  });
  return { suppliers, deliveries };
}

/**
 * Источники для строки сделки: сначала экземпляры (серийники),
 * иначе — приходные накладные по артикулу (партия = документ прихода).
 */
export function listDealLineSources(opts: {
  productId: string;
  warehouseId?: string;
}): {
  mode: 'units' | 'purchases';
  suppliers: Array<{ id: string; name: string; units: number }>;
  deliveries: Array<{
    id: string;
    number: string;
    doc_date: string;
    supplier_id: string;
    supplier_name: string;
    units: number;
    warehouse_id?: string;
    warehouse_name?: string;
  }>;
  warehouses: Array<{ id: string; name: string; qty: number }>;
} {
  const unitSrc = listUnitSources(opts);
  const warehouses = all<{ id: string; name: string; qty: number }>(
    `SELECT w.id, w.name, IFNULL(r.qty, 0) AS qty
     FROM product_store_rests r
     JOIN warehouses w ON w.id = r.warehouse_id
     WHERE r.product_id = ? AND IFNULL(r.qty,0) > 0 AND IFNULL(w.is_active,1) = 1
     ORDER BY w.name`,
    [opts.productId]
  );
  if (unitSrc.suppliers.length || unitSrc.deliveries.length) {
    return { mode: 'units', ...unitSrc, warehouses };
  }

  const whFilter = opts.warehouseId
    ? 'AND (d.warehouse_id = ? OR IFNULL(l.warehouse_id,\'\') = ?)'
    : '';
  const params: Array<string | number> = [opts.productId];
  if (opts.warehouseId) params.push(opts.warehouseId, opts.warehouseId);

  const deliveries = all<{
    id: string;
    number: string;
    doc_date: string;
    supplier_id: string;
    supplier_name: string;
    units: number;
    warehouse_id: string;
    warehouse_name: string;
  }>(
    `SELECT d.id,
            IFNULL(d.number,'') AS number,
            IFNULL(substr(d.doc_date,1,10),'') AS doc_date,
            IFNULL(d.counterparty_id,'') AS supplier_id,
            CASE
              WHEN IFNULL(d.counterparty_id,'') = '' THEN 'Без поставщика'
              ELSE IFNULL(NULLIF(cp.name,''), d.counterparty_id)
            END AS supplier_name,
            SUM(IFNULL(l.qty,0)) AS units,
            IFNULL(d.warehouse_id,'') AS warehouse_id,
            IFNULL(w.name,'') AS warehouse_name
     FROM stock_doc_lines l
     JOIN stock_docs d ON d.id = l.doc_id
     LEFT JOIN counterparties cp ON cp.id = d.counterparty_id
     LEFT JOIN warehouses w ON w.id = d.warehouse_id
     WHERE d.doc_type = 'in'
       AND l.product_id = ?
       AND IFNULL(l.qty,0) > 0
       AND instr(IFNULL(d.comment,''), 'тип:складской приход') = 0
       ${whFilter}
     GROUP BY d.id
     ORDER BY d.doc_date DESC, d.number DESC
     LIMIT 40`,
    params
  );

  const bySup = new Map<string, { id: string; name: string; units: number }>();
  for (const d of deliveries) {
    const cur = bySup.get(d.supplier_id) || { id: d.supplier_id, name: d.supplier_name, units: 0 };
    cur.units += Number(d.units) || 0;
    bySup.set(d.supplier_id, cur);
  }

  return {
    mode: 'purchases',
    suppliers: [...bySup.values()].sort((a, b) => a.name.localeCompare(b.name, 'ru')),
    deliveries,
    warehouses,
  };
}

export function unitsForDoc(docId: string): ProductUnit[] {
  return all<ProductUnit>(
    `SELECT u.*, p.sku, p.name AS product_name, IFNULL(w.name,'') AS warehouse_name,
            IFNULL(d.counterparty_id,'') AS supplier_id,
            IFNULL(cp.name,'') AS supplier_name,
            IFNULL(d.number,'') AS in_doc_number,
            IFNULL(substr(d.doc_date,1,10),'') AS in_doc_date
     FROM product_units u
     LEFT JOIN products p ON p.id = u.product_id
     LEFT JOIN warehouses w ON w.id = u.warehouse_id
     LEFT JOIN stock_docs d ON d.id = u.in_doc_id
     LEFT JOIN counterparties cp ON cp.id = d.counterparty_id
     WHERE u.in_doc_id = ? OR u.out_doc_id = ?
     ORDER BY u.serial`,
    [docId, docId]
  ).map((u) => enrichUnitApps(u)!);
}

export const UNIT_STATUS_RU: Record<string, string> = {
  in_stock: 'На складе',
  reserved: 'Резерв',
  sold: 'Списан / отгружен',
  written_off: 'Списан',
  in_transit: 'В пути',
  at_client: 'У клиента',
};

const DOC_TYPE_RU: Record<string, string> = {
  in: 'Приходная',
  out: 'Расходная',
  transfer: 'Перемещение',
  return: 'Возврат',
};

function serialLikePattern(serial: string): string {
  // экранируем % и _ для LIKE; ищем как JSON-строку в массиве
  const safe = String(serial || '')
    .replace(/\\/g, '\\\\')
    .replace(/%/g, '\\%')
    .replace(/_/g, '\\_')
    .replace(/"/g, '');
  return `%"${safe}"%`;
}

export type SerialTraceEvent = {
  at: string;
  kind: string;
  title: string;
  detail: string;
  doc_id?: string;
  deal_id?: string;
  order_id?: string;
  warehouse?: string;
  counterparty?: string;
};

/** Полная история экземпляра по коду Data Matrix / серийнику. */
export function traceSerial(serialRaw: string): {
  serial: string;
  found: boolean;
  unit: ProductUnit | null;
  status_label: string;
  deal: { deal_id: string; deal_name: string; buyer_name: string; source: string } | null;
  events: SerialTraceEvent[];
} {
  const serial = String(serialRaw || '').trim();
  if (!serial) {
    return { serial: '', found: false, unit: null, status_label: '', deal: null, events: [] };
  }
  const unit = findUnitBySerial(serial) || null;
  const events: SerialTraceEvent[] = [];
  const like = serialLikePattern(serial);

  // 1) Заказ поставщику / выделение кода
  const sou = get<{
    id: string;
    order_id: string;
    product_id: string;
    status: string;
    created_at: string;
    received_at: string;
    stock_doc_id: string;
    is_extra: number;
    order_number: string;
    counterparty_name: string;
    product_name: string;
  }>(
    `SELECT u.*, IFNULL(o.number,'') AS order_number,
            IFNULL(c.name,'') AS counterparty_name,
            IFNULL(p.name,'') AS product_name
     FROM supplier_order_units u
     LEFT JOIN supplier_orders o ON o.id = u.order_id
     LEFT JOIN counterparties c ON c.id = o.counterparty_id
     LEFT JOIN products p ON p.id = u.product_id
     WHERE lower(u.serial) = lower(?)
     LIMIT 1`,
    [serial]
  );
  if (sou) {
    events.push({
      at: sou.created_at || '',
      kind: 'supplier_order',
      title: 'Код выделен в заказе поставщику',
      detail: [
        sou.order_number ? `заказ ${sou.order_number}` : '',
        sou.counterparty_name || '',
        sou.product_name || '',
        sou.status ? `статус: ${sou.status}` : '',
        Number(sou.is_extra) === 1 ? 'лишний / вне заказа' : '',
      ]
        .filter(Boolean)
        .join(' · '),
      order_id: sou.order_id,
      counterparty: sou.counterparty_name || '',
    });
    if (sou.received_at) {
      events.push({
        at: sou.received_at,
        kind: 'supplier_receive',
        title: 'Принят по скану из поставки',
        detail: sou.stock_doc_id ? `документ ${sou.stock_doc_id.slice(0, 8)}…` : '',
        doc_id: sou.stock_doc_id || undefined,
        order_id: sou.order_id,
      });
    }
  }

  // 2) Тонкий журнал (заказ поставщику в parity) — код в payload
  try {
    const thinHits = all<{
      id: string;
      journal_key: string;
      number: string;
      doc_date: string;
      counterparty_name: string;
      created_at: string;
      status: string;
      payload_json: string;
    }>(
      `SELECT id, journal_key, number, doc_date, counterparty_name, created_at, status,
              IFNULL(payload_json,'') AS payload_json
       FROM thin_journal_docs
       WHERE IFNULL(payload_json,'') LIKE ? ESCAPE '\\'
       ORDER BY datetime(IFNULL(doc_date, created_at)) ASC
       LIMIT 20`,
      [like]
    );
    const serialLower = serial.toLowerCase();
    for (const t of thinHits) {
      let lineDetail = '';
      try {
        const payload = t.payload_json ? (JSON.parse(t.payload_json) as { lines?: unknown }) : null;
        const lines = Array.isArray(payload?.lines) ? payload!.lines! : [];
        for (const raw of lines) {
          const l = raw as { article?: string; name?: string; qty?: number; serials?: unknown };
          const serials = Array.isArray(l.serials)
            ? l.serials.map((s) => String(s || '').trim()).filter(Boolean)
            : [];
          if (!serials.some((s) => s.toLowerCase() === serialLower)) continue;
          lineDetail = [l.article, l.name, l.qty != null ? `×${l.qty}` : '']
            .filter(Boolean)
            .join(' · ');
          break;
        }
      } catch {
        /* ignore payload parse */
      }
      const isSupply = t.journal_key === 'supplier_orders';
      events.push({
        at: t.doc_date || t.created_at || '',
        kind: isSupply ? 'thin_supplier_order' : 'thin_journal',
        title: isSupply ? 'Марка создана в заказе поставщику' : `Журнал · ${t.journal_key}`,
        detail: [t.number, t.counterparty_name, lineDetail, t.status ? `статус: ${t.status}` : '']
          .filter(Boolean)
          .join(' · '),
        order_id: t.id,
        counterparty: t.counterparty_name || '',
      });
    }
  } catch {
    /* таблица может отсутствовать на старых БД */
  }

  // 3) Все складские документы, где код в serials_json
  const docHits = all<{
    id: string;
    doc_type: string;
    number: string;
    doc_date: string;
    created_at: string;
    warehouse_id: string;
    warehouse_name: string;
    warehouse_to_id: string;
    warehouse_to_name: string;
    counterparty_id: string;
    counterparty_name: string;
    deal_id: string;
    comment: string;
  }>(
    `SELECT d.id, d.doc_type, IFNULL(d.number,'') AS number,
            IFNULL(substr(d.doc_date,1,10),'') AS doc_date,
            IFNULL(d.created_at,'') AS created_at,
            IFNULL(l.warehouse_id, d.warehouse_id) AS warehouse_id,
            IFNULL(w.name,'') AS warehouse_name,
            IFNULL(d.warehouse_to_id,'') AS warehouse_to_id,
            IFNULL(wt.name,'') AS warehouse_to_name,
            IFNULL(d.counterparty_id,'') AS counterparty_id,
            IFNULL(cp.name,'') AS counterparty_name,
            IFNULL(d.deal_id,'') AS deal_id,
            IFNULL(d.comment,'') AS comment
     FROM stock_doc_lines l
     JOIN stock_docs d ON d.id = l.doc_id
     LEFT JOIN warehouses w ON w.id = IFNULL(NULLIF(l.warehouse_id,''), d.warehouse_id)
     LEFT JOIN warehouses wt ON wt.id = d.warehouse_to_id
     LEFT JOIN counterparties cp ON cp.id = d.counterparty_id
     WHERE IFNULL(l.serials_json,'') LIKE ? ESCAPE '\\'
     ORDER BY datetime(IFNULL(d.doc_date, d.created_at)) ASC, d.number ASC
     LIMIT 50`,
    [like]
  );
  for (const d of docHits) {
    const typeRu = DOC_TYPE_RU[d.doc_type] || d.doc_type;
    let title = `${typeRu}${d.number ? ' №' + d.number : ''}`;
    let detail = '';
    if (d.doc_type === 'transfer') {
      title = `Перемещение${d.number ? ' №' + d.number : ''}`;
      detail = [d.warehouse_name && `из «${d.warehouse_name}»`, d.warehouse_to_name && `в «${d.warehouse_to_name}»`]
        .filter(Boolean)
        .join(' → ');
    } else if (d.doc_type === 'in' || d.doc_type === 'return') {
      detail = [d.counterparty_name && `от ${d.counterparty_name}`, d.warehouse_name && `на «${d.warehouse_name}»`]
        .filter(Boolean)
        .join(' · ');
    } else if (d.doc_type === 'out') {
      detail = [d.counterparty_name && `кому: ${d.counterparty_name}`, d.warehouse_name && `со склада «${d.warehouse_name}»`]
        .filter(Boolean)
        .join(' · ');
    }
    if (d.comment) detail = [detail, d.comment.slice(0, 80)].filter(Boolean).join(' · ');
    events.push({
      at: d.doc_date || d.created_at || '',
      kind: 'stock_doc_' + d.doc_type,
      title,
      detail,
      doc_id: d.id,
      deal_id: d.deal_id || undefined,
      warehouse: d.warehouse_to_name || d.warehouse_name || '',
      counterparty: d.counterparty_name || '',
    });
  }

  // 4) Текущее состояние экземпляра (если есть, но документов не нашли — покажем in/out ссылки)
  if (unit) {
    if (unit.in_doc_id && !events.some((e) => e.doc_id === unit.in_doc_id)) {
      const din = get<{
        number: string;
        doc_date: string;
        created_at: string;
        counterparty_name: string;
        warehouse_name: string;
      }>(
        `SELECT IFNULL(d.number,'') AS number, IFNULL(substr(d.doc_date,1,10),'') AS doc_date,
                IFNULL(d.created_at,'') AS created_at,
                IFNULL(cp.name,'') AS counterparty_name,
                IFNULL(w.name,'') AS warehouse_name
         FROM stock_docs d
         LEFT JOIN counterparties cp ON cp.id = d.counterparty_id
         LEFT JOIN warehouses w ON w.id = d.warehouse_id
         WHERE d.id = ?`,
        [unit.in_doc_id]
      );
      events.push({
        at: din?.doc_date || din?.created_at || unit.created_at || '',
        kind: 'unit_in',
        title: `Приход на склад${din?.number ? ' №' + din.number : ''}`,
        detail: [din?.counterparty_name && `от ${din.counterparty_name}`, din?.warehouse_name && `на «${din.warehouse_name}»`]
          .filter(Boolean)
          .join(' · '),
        doc_id: unit.in_doc_id,
        warehouse: din?.warehouse_name || unit.warehouse_name || '',
        counterparty: din?.counterparty_name || '',
      });
    }
    if (unit.out_doc_id && !events.some((e) => e.doc_id === unit.out_doc_id)) {
      const dout = get<{
        number: string;
        doc_date: string;
        created_at: string;
        counterparty_name: string;
        deal_id: string;
      }>(
        `SELECT IFNULL(d.number,'') AS number, IFNULL(substr(d.doc_date,1,10),'') AS doc_date,
                IFNULL(d.created_at,'') AS created_at,
                IFNULL(cp.name,'') AS counterparty_name,
                IFNULL(d.deal_id,'') AS deal_id
         FROM stock_docs d
         LEFT JOIN counterparties cp ON cp.id = d.counterparty_id
         WHERE d.id = ?`,
        [unit.out_doc_id]
      );
      events.push({
        at: dout?.doc_date || dout?.created_at || unit.updated_at || '',
        kind: 'unit_out',
        title: `Отгрузка / списание${dout?.number ? ' №' + dout.number : ''}`,
        detail: dout?.counterparty_name ? `кому: ${dout.counterparty_name}` : '',
        doc_id: unit.out_doc_id,
        deal_id: dout?.deal_id || undefined,
        counterparty: dout?.counterparty_name || '',
      });
    }
    if (unit.comment) {
      events.push({
        at: unit.updated_at || unit.created_at || '',
        kind: 'unit_comment',
        title: 'Примечание по экземпляру',
        detail: String(unit.comment),
      });
    }
  }

  // 5) СТО-заявки
  try {
    const sto = all<{
      request_id: string;
      number: string;
      deal_id: string;
      status: string;
      created_at: string;
      transferred_at: string;
      stock_doc_id: string;
    }>(
      `SELECT r.id AS request_id, r.number, IFNULL(r.deal_id,'') AS deal_id, r.status,
              r.created_at, IFNULL(l.transferred_at,'') AS transferred_at,
              IFNULL(l.stock_doc_id,'') AS stock_doc_id
       FROM sto_transfer_request_lines l
       JOIN sto_transfer_requests r ON r.id = l.request_id
       WHERE lower(IFNULL(l.serial,'')) = lower(?)
       ORDER BY datetime(r.created_at) ASC
       LIMIT 20`,
      [serial]
    );
    for (const s of sto) {
      events.push({
        at: s.created_at || '',
        kind: 'sto_request',
        title: `Заявка на СТО №${s.number || s.request_id.slice(0, 8)}`,
        detail: s.status ? `статус: ${s.status}` : '',
        deal_id: s.deal_id || undefined,
        doc_id: s.stock_doc_id || undefined,
      });
      if (s.transferred_at) {
        events.push({
          at: s.transferred_at,
          kind: 'sto_transfer',
          title: 'Перемещён на СТО',
          detail: s.stock_doc_id ? `документ ${s.stock_doc_id.slice(0, 8)}…` : '',
          doc_id: s.stock_doc_id || undefined,
          deal_id: s.deal_id || undefined,
        });
      }
    }
  } catch {
    /* ignore */
  }

  // 6) datamatrix_codes (маркировка ЦРПТ)
  try {
    const dm = get<{
      code: string;
      status: string;
      warehouse_id: string;
      deal_id: string;
      stock_doc_id: string;
      scanned_at: string;
      withdrawn_at: string;
      created_at: string;
      warehouse_name: string;
    }>(
      `SELECT c.*, IFNULL(w.name,'') AS warehouse_name
       FROM datamatrix_codes c
       LEFT JOIN warehouses w ON w.id = c.warehouse_id
       WHERE lower(c.code) = lower(?) OR lower(IFNULL(c.serial,'')) = lower(?)
       LIMIT 1`,
      [serial, serial]
    );
    if (dm) {
      events.push({
        at: dm.created_at || dm.scanned_at || '',
        kind: 'marking',
        title: 'Код маркировки (ЦРПТ / реестр)',
        detail: [`статус: ${dm.status}`, dm.warehouse_name && `склад «${dm.warehouse_name}»`]
          .filter(Boolean)
          .join(' · '),
        deal_id: dm.deal_id || undefined,
        doc_id: dm.stock_doc_id || undefined,
        warehouse: dm.warehouse_name || '',
      });
      if (dm.withdrawn_at) {
        events.push({
          at: dm.withdrawn_at,
          kind: 'marking_out',
          title: 'Вывод из оборота',
          detail: '',
          deal_id: dm.deal_id || undefined,
        });
      }
    }
  } catch {
    /* ignore */
  }

  // Сделка (последняя известная)
  let deal: { deal_id: string; deal_name: string; buyer_name: string; source: string } | null = null;
  const dealFromEvent = events.map((e) => e.deal_id).find(Boolean);
  if (dealFromEvent) {
    const d = get<{ id: string; name: string }>(
      `SELECT id, IFNULL(name,'') AS name FROM crm_deals WHERE id = ?`,
      [dealFromEvent]
    );
    if (d) {
      deal = {
        deal_id: d.id,
        deal_name: d.name || d.id,
        buyer_name: '',
        source: 'trace',
      };
    }
  }

  events.sort((a, b) => String(a.at || '').localeCompare(String(b.at || ''), 'ru'));

  // дедуп одинаковых doc_id+kind подряд
  const dedup: SerialTraceEvent[] = [];
  for (const e of events) {
    const prev = dedup[dedup.length - 1];
    if (prev && prev.doc_id && e.doc_id && prev.doc_id === e.doc_id && prev.kind === e.kind) continue;
    dedup.push(e);
  }

  return {
    serial,
    found: !!(unit || sou || dedup.length),
    unit,
    status_label: unit
      ? UNIT_STATUS_RU[unit.status] || unit.status
      : sou
        ? 'В поставке'
        : dedup.some((e) => e.kind === 'thin_supplier_order' || e.kind === 'thin_journal')
          ? 'В заказе поставщику'
          : dedup.length
            ? 'Есть в истории'
            : '',
    deal,
    events: dedup,
  };
}

/** Data Matrix коды на остатке (product × warehouse) для страницы балансов. */
export function dmCodesForBalanceRows(
  rows: Array<{ product_id: string; warehouse_id: string }>
): Map<string, { codes: string[]; total: number }> {
  const out = new Map<string, { codes: string[]; total: number }>();
  if (!rows.length) return out;
  const productIds = [...new Set(rows.map((r) => String(r.product_id || '')).filter(Boolean))];
  if (!productIds.length) return out;
  const placeholders = productIds.map(() => '?').join(',');
  const units = all<{ product_id: string; warehouse_id: string; serial: string }>(
    `SELECT product_id, warehouse_id, serial
     FROM product_units
     WHERE status IN ('in_stock', 'reserved')
       AND product_id IN (${placeholders})
     ORDER BY serial COLLATE NOCASE`,
    productIds
  );
  const wanted = new Set(rows.map((r) => `${r.product_id}\0${r.warehouse_id}`));
  for (const u of units) {
    const key = `${u.product_id}\0${u.warehouse_id}`;
    if (!wanted.has(key)) continue;
    let bucket = out.get(key);
    if (!bucket) {
      bucket = { codes: [], total: 0 };
      out.set(key, bucket);
    }
    bucket.total += 1;
    if (bucket.codes.length < 15) bucket.codes.push(u.serial);
  }
  return out;
}
