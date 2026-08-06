import type { Hono } from 'hono';
import type { Actor } from './auth.js';
import { all, get, run } from './db.js';
import { newGuid, nextCode } from './ids.js';
import {
  createInTransitUnits,
  findUnitBySerial,
  promoteInTransitUnit,
  receiveUnits,
  returnUnitFromClient,
  transferUnits,
  shipUnits,
} from './product-units.js';
import {
  applyStockDelta,
  createDocument,
  nextDocNumber,
} from './stock.js';
import { createUpdAndWriteOffFromDeal } from './sales-docs.js';
import { invalidateStockValuationCache } from './stock-valuation.js';
import { getDeal } from './deals.js';
import { nextBarcode } from './barcodes.js';
import { createMoneyRefundFromReturn, getLastSalePrice } from './return-money.js';
import {
  parseAppsJson,
  setUnitApps,
  type AppVehicle,
} from './applicability-party.js';

export { nextBarcode };

/** Применимость партии, заданная при «Передать на склад» (payload заказа / dims задания). */
function resolveInboundPartyApps(opts: {
  orderId: string;
  productId: string;
  serial: string;
}): AppVehicle[] {
  const orderId = String(opts.orderId || '').trim();
  const productId = String(opts.productId || '').trim();
  const serial = String(opts.serial || '').trim();
  if (!orderId || !serial) return [];

  // 1) payload тонкого журнала
  try {
    const row = get<{ payload_json: string }>(
      `SELECT IFNULL(payload_json,'') AS payload_json FROM thin_journal_docs WHERE id = ?`,
      [orderId]
    );
    if (row?.payload_json) {
      const payload = JSON.parse(row.payload_json) as Record<string, unknown>;
      const bySerial = payload.inbound_serial_apps as Record<string, unknown> | undefined;
      if (bySerial && typeof bySerial === 'object') {
        const hit =
          bySerial[serial] ??
          Object.entries(bySerial).find(([k]) => k.toLowerCase() === serial.toLowerCase())?.[1];
        const apps = parseAppsJson(hit);
        if (apps.length) return apps;
      }
      const byLine = payload.inbound_line_apps as Record<string, unknown> | undefined;
      if (productId && byLine && typeof byLine === 'object' && byLine[productId] != null) {
        const apps = parseAppsJson(byLine[productId]);
        if (apps.length) return apps;
      }
    }
  } catch {
    /* ignore */
  }

  // 2) активное inbound-задание
  try {
    const task = get<{ id: string }>(
      `SELECT id FROM warehouse_tasks
       WHERE stock_doc_id = ? AND channel = 'inbound'
         AND status NOT IN ('cancelled')
       ORDER BY datetime(created_at) DESC LIMIT 1`,
      [orderId]
    );
    if (!task) return [];
    const lines = all<{ product_id: string; dims_json: string }>(
      `SELECT product_id, IFNULL(dims_json,'{}') AS dims_json
       FROM warehouse_task_lines WHERE task_id = ?`,
      [task.id]
    );
    for (const l of lines) {
      let dims: {
        serials?: string[];
        apps?: unknown;
        serial_apps?: Record<string, unknown>;
      } = {};
      try {
        dims = l.dims_json ? JSON.parse(l.dims_json) : {};
      } catch {
        dims = {};
      }
      const serials = Array.isArray(dims.serials) ? dims.serials.map(String) : [];
      const onLine =
        serials.some((s) => s.toLowerCase() === serial.toLowerCase()) ||
        (productId && l.product_id === productId);
      if (!onLine) continue;
      if (dims.serial_apps && typeof dims.serial_apps === 'object') {
        const hit =
          dims.serial_apps[serial] ??
          Object.entries(dims.serial_apps).find(
            ([k]) => k.toLowerCase() === serial.toLowerCase()
          )?.[1];
        const apps = parseAppsJson(hit);
        if (apps.length) return apps;
      }
      const lineApps = parseAppsJson(dims.apps);
      if (lineApps.length) return lineApps;
    }
  } catch {
    /* ignore */
  }
  return [];
}

/**
 * Цепочка: заказ поставщику → Data Matrix → в пути → приёмка → СТО → УПД → возврат.
 */

export type SupplierOrderStatus =
  | 'draft'
  | 'to_pay'
  | 'paid'
  | 'in_transit'
  | 'partial'
  | 'received'
  | 'closed';

function warehouseByCode(code: string, nameFallback: string): string {
  const row = get<{ id: string }>(
    `SELECT id FROM warehouses WHERE code = ? OR name = ? LIMIT 1`,
    [code, nameFallback]
  );
  if (!row?.id) throw new Error(`Склад «${nameFallback}» не найден`);
  return row.id;
}

export function mainWarehouseId(): string {
  return warehouseByCode('MAIN', 'Основной');
}

export function stoWarehouseId(): string {
  return warehouseByCode('STO', 'СТО');
}

export function transitWarehouseId(): string {
  return warehouseByCode('IN-TRANSIT', 'В пути');
}

function refreshOrderStatus(orderId: string): void {
  const units = all<{ status: string; is_extra: number }>(
    `SELECT status, is_extra FROM supplier_order_units WHERE order_id = ?`,
    [orderId]
  );
  if (!units.length) return;
  const expected = units.filter((u) => !u.is_extra);
  const received = expected.filter((u) => u.status === 'received').length;
  const pending = expected.filter((u) => u.status === 'in_transit' || u.status === 'expected').length;
  const hasExtra = units.some((u) => u.is_extra);
  let status: SupplierOrderStatus = 'in_transit';
  if (pending === 0 && received > 0) status = 'received';
  else if (received > 0 && pending > 0) status = 'partial';
  else if (received === 0) status = 'in_transit';
  run(
    `UPDATE supplier_orders SET status = ?, mismatch = CASE WHEN ? THEN 1 ELSE mismatch END, updated_at = datetime('now')
     WHERE id = ?`,
    [status, hasExtra ? 1 : 0, orderId]
  );
}

export function listSupplierOrders(opts: { status?: string; q?: string; limit?: number }) {
  const where: string[] = ['1=1'];
  const params: Array<string | number> = [];
  if (opts.status) {
    where.push('o.status = ?');
    params.push(opts.status);
  }
  if (opts.q) {
    const q = `%${opts.q.trim()}%`;
    where.push(`(o.number LIKE ? OR IFNULL(c.name,'') LIKE ? OR IFNULL(o.comment,'') LIKE ?)`);
    params.push(q, q, q);
  }
  const limit = Math.min(200, Math.max(1, Number(opts.limit) || 50));
  return all(
    `SELECT o.*, c.name AS supplier_name, c.barcode_prefix AS supplier_prefix,
            (SELECT COUNT(*) FROM supplier_order_units u WHERE u.order_id = o.id) AS units_total,
            (SELECT COUNT(*) FROM supplier_order_units u WHERE u.order_id = o.id AND u.status = 'received') AS units_received,
            (SELECT COUNT(*) FROM supplier_order_units u WHERE u.order_id = o.id AND u.status IN ('in_transit','expected')) AS units_pending
     FROM supplier_orders o
     LEFT JOIN counterparties c ON c.id = o.counterparty_id
     WHERE ${where.join(' AND ')}
     ORDER BY datetime(o.updated_at) DESC
     LIMIT ?`,
    [...params, limit]
  );
}

export function getSupplierOrder(id: string): Record<string, unknown> | null {
  const order = get<Record<string, unknown>>(
    `SELECT o.*, c.name AS supplier_name, c.barcode_prefix AS supplier_prefix, c.inn AS supplier_inn
     FROM supplier_orders o
     LEFT JOIN counterparties c ON c.id = o.counterparty_id
     WHERE o.id = ?`,
    [id]
  );
  if (!order) return null;
  const lines = all(
    `SELECT l.*, p.sku, p.name AS product_name
     FROM supplier_order_lines l
     LEFT JOIN products p ON p.id = l.product_id
     WHERE l.order_id = ?
     ORDER BY l.sort_order, l.id`,
    [id]
  );
  const units = all(
    `SELECT u.*, p.sku, p.name AS product_name
     FROM supplier_order_units u
     LEFT JOIN products p ON p.id = u.product_id
     WHERE u.order_id = ?
     ORDER BY u.serial`,
    [id]
  );
  return { ...order, lines, units };
}

export function createSupplierOrder(input: {
  counterparty_id: string;
  comment?: string;
  eta_date?: string;
  created_by?: string;
  organization_id?: string;
  lines: Array<{ product_id: string; qty: number; price?: number; comment?: string }>;
}) {
  const cpId = String(input.counterparty_id || '').trim();
  if (!cpId) throw new Error('Укажите поставщика');
  const cp = get<{ id: string }>('SELECT id FROM counterparties WHERE id = ?', [cpId]);
  if (!cp) throw new Error('Поставщик не найден');
  const lines = (input.lines || []).filter((l) => l.product_id && Number(l.qty) > 0);
  if (!lines.length) throw new Error('Добавьте строки заказа');
  const id = newGuid();
  const number = nextCode('ЗП', 5);
  const now = new Date().toISOString();
  run(
    `INSERT INTO supplier_orders
      (id, number, counterparty_id, status, eta_date, comment, organization_id, created_by, created_at, updated_at)
     VALUES (?, ?, ?, 'draft', ?, ?, ?, ?, ?, ?)`,
    [
      id,
      number,
      cpId,
      String(input.eta_date || '').trim(),
      String(input.comment || '').trim(),
      String(input.organization_id || '').trim(),
      String(input.created_by || '').trim(),
      now,
      now,
    ]
  );
  lines.forEach((l, i) => {
    run(
      `INSERT INTO supplier_order_lines (id, order_id, product_id, qty, price, comment, sort_order)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        newGuid(),
        id,
        l.product_id,
        Number(l.qty),
        Number(l.price) || 0,
        String(l.comment || ''),
        i,
      ]
    );
  });
  return getSupplierOrder(id);
}

export function setSupplierOrderStatus(
  id: string,
  status: SupplierOrderStatus,
  opts?: { eta_date?: string; comment?: string }
) {
  const order = get<{ id: string; status: string; counterparty_id: string }>(
    `SELECT id, status, counterparty_id FROM supplier_orders WHERE id = ?`,
    [id]
  );
  if (!order) throw new Error('Заказ не найден');
  const allowed: Record<string, SupplierOrderStatus[]> = {
    draft: ['to_pay', 'paid', 'closed'],
    to_pay: ['paid', 'draft', 'closed'],
    paid: ['in_transit', 'closed'],
    in_transit: ['partial', 'received', 'closed'],
    partial: ['received', 'closed'],
    received: ['closed'],
    closed: [],
  };
  if (status === 'paid') {
    return markSupplierOrderPaid(id, opts);
  }
  if (!(allowed[order.status] || []).includes(status) && status !== order.status) {
    throw new Error(`Нельзя сменить статус ${order.status} → ${status}`);
  }
  const sets: string[] = [`status = ?`, `updated_at = datetime('now')`];
  const params: Array<string | number> = [status];
  if (opts?.eta_date != null) {
    sets.push('eta_date = ?');
    params.push(String(opts.eta_date).trim());
  }
  if (opts?.comment != null) {
    sets.push('comment = ?');
    params.push(String(opts.comment).trim());
  }
  params.push(id);
  run(`UPDATE supplier_orders SET ${sets.join(', ')} WHERE id = ?`, params);
  return getSupplierOrder(id);
}

/** Оплачено → генерация уникальных Data Matrix на все qty, статус in_transit. */
export function markSupplierOrderPaid(
  id: string,
  opts?: { eta_date?: string; comment?: string }
) {
  const order = get<{
    id: string;
    status: string;
    counterparty_id: string;
    number: string;
  }>(`SELECT * FROM supplier_orders WHERE id = ?`, [id]);
  if (!order) throw new Error('Заказ не найден');
  if (!['draft', 'to_pay', 'paid'].includes(order.status)) {
    throw new Error(`Заказ уже в статусе ${order.status}`);
  }
  const existingUnits = get<{ c: number }>(
    `SELECT COUNT(*) AS c FROM supplier_order_units WHERE order_id = ?`,
    [id]
  )?.c;
  if (existingUnits && Number(existingUnits) > 0 && order.status === 'paid') {
    // уже сгенерировано
    return getSupplierOrder(id);
  }
  if (existingUnits && Number(existingUnits) > 0) {
    throw new Error('Data Matrix по заказу уже созданы');
  }

  const cp = get<{ barcode_prefix: string }>(
    `SELECT IFNULL(barcode_prefix,'') AS barcode_prefix FROM counterparties WHERE id = ?`,
    [order.counterparty_id]
  );
  const prefix = String(cp?.barcode_prefix || '').trim() || 'DM';
  const lines = all<{ id: string; product_id: string; qty: number }>(
    `SELECT id, product_id, qty FROM supplier_order_lines WHERE order_id = ?`,
    [id]
  );
  if (!lines.length) throw new Error('Нет строк заказа');

  const transitWh = transitWarehouseId();
  const now = new Date().toISOString();

  run('BEGIN');
  try {
    for (const line of lines) {
      const qty = Math.max(1, Math.round(Number(line.qty)));
      const serials: string[] = [];
      for (let i = 0; i < qty; i++) serials.push(nextBarcode(prefix));
      const unitIds = createInTransitUnits({
        productId: line.product_id,
        warehouseId: transitWh,
        serials,
        comment: `заказ ${order.number}`,
      });
      serials.forEach((serial, idx) => {
        run(
          `INSERT INTO supplier_order_units
            (id, order_id, line_id, product_id, serial, status, product_unit_id, is_extra, created_at)
           VALUES (?, ?, ?, ?, ?, 'in_transit', ?, 0, ?)`,
          [newGuid(), id, line.id, line.product_id, serial, unitIds[idx] || '', now]
        );
      });
    }
    run(
      `UPDATE supplier_orders
       SET status = 'in_transit', paid_at = ?, eta_date = COALESCE(NULLIF(?, ''), eta_date),
           comment = CASE WHEN ? = '' THEN comment ELSE ? END, updated_at = ?
       WHERE id = ?`,
      [
        now,
        String(opts?.eta_date || '').trim(),
        String(opts?.comment || '').trim(),
        String(opts?.comment || '').trim() || '',
        now,
        id,
      ]
    );
    run('COMMIT');
  } catch (e) {
    run('ROLLBACK');
    throw e;
  }
  return getSupplierOrder(id);
}

export function orderLabels(orderId: string) {
  const order = getSupplierOrder(orderId);
  if (!order) throw new Error('Заказ не найден');
  return {
    order: {
      id: String(order.id),
      number: String(order.number),
      supplier_name: String(order.supplier_name || ''),
    },
    labels: ((order.units as Array<Record<string, unknown>>) || []).map((u) => ({
      serial: u.serial,
      product_id: u.product_id,
      sku: u.sku,
      product_name: u.product_name,
      status: u.status,
      is_extra: u.is_extra,
    })),
  };
}

export function labelsHtml(orderId: string): string {
  const data = orderLabels(orderId);
  const rows = data.labels
    .map((l) => {
      const serial = String(l.serial || '');
      const dmSrc = `/api/datamatrix.png?text=${encodeURIComponent(serial)}&scale=3`;
      return `<div class="lbl">
      <img class="dm" src="${dmSrc}" alt="DataMatrix ${escapeHtml(serial)}" width="96" height="96" />
      <div class="txt">
        <div class="code">${escapeHtml(serial)}</div>
        <div class="meta">${escapeHtml(String(l.sku || ''))} · ${escapeHtml(String(l.product_name || ''))}</div>
        <div class="ord">${escapeHtml(data.order.number)} · ${escapeHtml(String(data.order.supplier_name || ''))}</div>
      </div>
    </div>`;
    })
    .join('\n');
  return `<!DOCTYPE html><html lang="ru"><head><meta charset="utf-8"/><title>Этикетки ${escapeHtml(data.order.number)}</title>
<style>
  body{font-family:system-ui,sans-serif;margin:12px}
  .lbl{display:flex;gap:12px;align-items:center;border:1px solid #333;border-radius:8px;padding:10px 12px;margin:0 0 10px;page-break-inside:avoid;width:360px}
  .dm{width:96px;height:96px;image-rendering:pixelated;flex-shrink:0}
  .code{font-size:18px;font-weight:800;letter-spacing:.04em;font-family:ui-monospace,monospace;word-break:break-all}
  .meta,.ord{font-size:12px;color:#444;margin-top:4px}
  @media print{.lbl{box-shadow:none}}
</style></head><body onload="window.print()">${rows || '<p>Нет кодов Data Matrix</p>'}</body></html>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function resolveCounterpartyIdByName(nameRaw: string): string {
  const name = String(nameRaw || '').trim();
  if (!name) return '';
  const exact = get<{ id: string }>(
    `SELECT id FROM counterparties
     WHERE name = ? OR IFNULL(name_full,'') = ?
     LIMIT 1`,
    [name, name]
  );
  if (exact?.id) return exact.id;
  const fuzzy = get<{ id: string }>(
    `SELECT id FROM counterparties WHERE name LIKE ? OR IFNULL(name_full,'') LIKE ? LIMIT 1`,
    [`%${name}%`, `%${name}%`]
  );
  return fuzzy?.id || '';
}

/** Марка из заказа поставщику (тонкий журнал parity), ещё не в supplier_order_units. */
function findThinSupplierOrderBySerial(codeRaw: string): {
  order_id: string;
  number: string;
  status: string;
  counterparty_name: string;
  counterparty_id: string;
  product_id: string;
  product_name: string;
  sku: string;
  serial: string;
} | null {
  const code = String(codeRaw || '').trim();
  if (!code) return null;
  const safe = code
    .replace(/\\/g, '\\\\')
    .replace(/%/g, '\\%')
    .replace(/_/g, '\\_')
    .replace(/"/g, '');
  const like = `%"${safe}"%`;
  let hits: Array<{
    id: string;
    number: string;
    status: string;
    counterparty_name: string;
    payload_json: string;
  }> = [];
  try {
    hits = all(
      `SELECT id, IFNULL(number,'') AS number, IFNULL(status,'') AS status,
              IFNULL(counterparty_name,'') AS counterparty_name,
              IFNULL(payload_json,'') AS payload_json
       FROM thin_journal_docs
       WHERE journal_key = 'supplier_orders'
         AND IFNULL(payload_json,'') LIKE ? ESCAPE '\\'
       ORDER BY datetime(IFNULL(doc_date, created_at)) DESC
       LIMIT 30`,
      [like]
    );
  } catch {
    return null;
  }
  const serialLower = code.toLowerCase();
  for (const t of hits) {
    let payload: { lines?: unknown } = {};
    try {
      payload = t.payload_json ? (JSON.parse(t.payload_json) as { lines?: unknown }) : {};
    } catch {
      continue;
    }
    const lines = Array.isArray(payload.lines) ? payload.lines : [];
    for (const raw of lines) {
      const l = raw as {
        product_id?: string;
        name?: string;
        article?: string;
        serials?: unknown;
        serial?: string;
        datamatrix?: string;
      };
      const serials = Array.isArray(l.serials)
        ? l.serials.map((s) => String(s || '').trim()).filter(Boolean)
        : String(l.serial || l.datamatrix || '').trim()
          ? [String(l.serial || l.datamatrix).trim()]
          : [];
      if (!serials.some((s) => s.toLowerCase() === serialLower)) continue;
      const productId = String(l.product_id || '').trim();
      if (!productId) continue;
      const cpName = String(t.counterparty_name || '').trim();
      return {
        order_id: t.id,
        number: t.number || t.id.slice(0, 8),
        status: t.status || '',
        counterparty_name: cpName,
        counterparty_id: resolveCounterpartyIdByName(cpName),
        product_id: productId,
        product_name: String(l.name || ''),
        sku: String(l.article || ''),
        serial: code,
      };
    }
  }
  return null;
}

function thinOrderAsScanOrder(thin: NonNullable<ReturnType<typeof findThinSupplierOrderBySerial>>) {
  return buildInboundBoard(thin.order_id) || {
    id: thin.order_id,
    number: thin.number,
    status: thin.status,
    counterparty_id: thin.counterparty_id,
    supplier_name: thin.counterparty_name,
    counterparty_name: thin.counterparty_name,
    units: [],
    products: [],
    lines: [],
  };
}

function productRollupFromUnits(
  units: Array<{
    product_id?: string;
    sku?: string;
    product_name?: string;
    status?: string;
    is_extra?: number;
  }>
) {
  type Acc = {
    product_id: string;
    sku: string;
    name: string;
    expected: number;
    received: number;
    missing: number;
    line_status: 'ok' | 'partial' | 'wait' | 'extra';
  };
  const map = new Map<string, Acc>();
  for (const u of units) {
    if (u.is_extra) continue;
    const pid = String(u.product_id || '').trim() || '_';
    let row = map.get(pid);
    if (!row) {
      row = {
        product_id: pid === '_' ? '' : pid,
        sku: String(u.sku || ''),
        name: String(u.product_name || ''),
        expected: 0,
        received: 0,
        missing: 0,
        line_status: 'wait',
      };
      map.set(pid, row);
    }
    row.expected += 1;
    if (String(u.status || '') === 'received') row.received += 1;
    else row.missing += 1;
    if (!row.sku && u.sku) row.sku = String(u.sku);
    if (!row.name && u.product_name) row.name = String(u.product_name);
  }
  return [...map.values()].map((r) => ({
    ...r,
    line_status:
      r.missing === 0 && r.received > 0
        ? ('ok' as const)
        : r.received > 0
          ? ('partial' as const)
          : ('wait' as const),
  }));
}

function findInboundWarehouseTask(orderId: string) {
  return (
    get<{ id: string; number: string; status: string; comment: string }>(
      `SELECT id, IFNULL(number,'') AS number, IFNULL(status,'') AS status,
              IFNULL(comment,'') AS comment
       FROM warehouse_tasks
       WHERE stock_doc_id = ? AND channel = 'inbound'
         AND status NOT IN ('cancelled')
       ORDER BY datetime(created_at) DESC
       LIMIT 1`,
      [orderId]
    ) || null
  );
}

function syncInboundWarehouseTask(orderId: string, board: {
  status?: string;
  units_pending?: number;
  units_received?: number;
}) {
  const task = findInboundWarehouseTask(orderId);
  if (!task) return null;
  const pending = Number(board.units_pending) || 0;
  const received = Number(board.units_received) || 0;
  try {
    if (pending === 0 && received > 0 && task.status !== 'handed') {
      run(
        `UPDATE warehouse_tasks
         SET status = 'handed', handed_at = datetime('now'), updated_at = datetime('now')
         WHERE id = ?`,
        [task.id]
      );
      return { ...task, status: 'handed' };
    }
    if (received > 0 && pending > 0 && task.status === 'new') {
      run(
        `UPDATE warehouse_tasks
         SET status = 'picking', picked_at = datetime('now'), updated_at = datetime('now')
         WHERE id = ?`,
        [task.id]
      );
      return { ...task, status: 'picking' };
    }
  } catch {
    /* ignore */
  }
  return task;
}

/** Доска приёмки: товары + марки (классический заказ или тонкий журнал). */
export function buildInboundBoard(orderIdRaw: string): Record<string, unknown> | null {
  const orderId = String(orderIdRaw || '').trim();
  if (!orderId) return null;

  const classic = getSupplierOrder(orderId);
  if (classic) {
    const units = (classic.units as Array<Record<string, unknown>>) || [];
    const products = productRollupFromUnits(
      units.map((u) => ({
        product_id: String(u.product_id || ''),
        sku: String(u.sku || ''),
        product_name: String(u.product_name || ''),
        status: String(u.status || ''),
        is_extra: Number(u.is_extra) || 0,
      }))
    );
    const expected = units.filter((u) => !Number(u.is_extra));
    const received = expected.filter((u) => String(u.status) === 'received').length;
    const pending = expected.filter((u) =>
      ['in_transit', 'expected'].includes(String(u.status))
    ).length;
    const board: Record<string, unknown> = {
      ...classic,
      thin_journal: 0,
      products,
      units_total: expected.length,
      units_received: received,
      units_pending: pending,
      receive_label:
        pending === 0 && received > 0
          ? 'Все оприходованы · на складе'
          : received > 0
            ? `Оприходовано ${received} из ${expected.length} · недостача ${pending}`
            : `Ожидает приёмки · ${expected.length} марок`,
    };
    board.warehouse_task = syncInboundWarehouseTask(orderId, {
      units_pending: pending,
      units_received: received,
    });
    return board;
  }

  const thin = get<{
    id: string;
    number: string;
    status: string;
    counterparty_name: string;
    payload_json: string;
    doc_date: string;
  }>(
    `SELECT id, IFNULL(number,'') AS number, IFNULL(status,'') AS status,
            IFNULL(counterparty_name,'') AS counterparty_name,
            IFNULL(payload_json,'') AS payload_json,
            IFNULL(doc_date,'') AS doc_date
     FROM thin_journal_docs
     WHERE id = ? AND journal_key = 'supplier_orders'`,
    [orderId]
  );
  if (!thin) return null;

  let payload: Record<string, unknown> = {};
  try {
    payload = thin.payload_json ? (JSON.parse(thin.payload_json) as Record<string, unknown>) : {};
  } catch {
    payload = {};
  }
  const receivedList = Array.isArray(payload.received_serials)
    ? (payload.received_serials as unknown[]).map((s) => String(s || '').trim()).filter(Boolean)
    : [];
  const receivedSet = new Set(receivedList.map((s) => s.toLowerCase()));
  const lines = Array.isArray(payload.lines) ? (payload.lines as Array<Record<string, unknown>>) : [];
  const units: Array<{
    serial: string;
    product_id: string;
    sku: string;
    product_name: string;
    status: string;
    is_extra: number;
  }> = [];
  for (const l of lines) {
    const productId = String(l.product_id || '').trim();
    const sku = String(l.article || l.sku || '');
    const name = String(l.name || '');
    const serials = Array.isArray(l.serials)
      ? l.serials.map((s) => String(s || '').trim()).filter(Boolean)
      : String(l.serial || l.datamatrix || '').trim()
        ? [String(l.serial || l.datamatrix).trim()]
        : [];
    for (const serial of serials) {
      let status = receivedSet.has(serial.toLowerCase()) ? 'received' : 'in_transit';
      if (status !== 'received') {
        const pu = findUnitBySerial(serial);
        if (pu && (pu.status === 'in_stock' || String(pu.in_doc_id || '').trim())) {
          status = 'received';
          if (!receivedSet.has(serial.toLowerCase())) {
            receivedList.push(serial);
            receivedSet.add(serial.toLowerCase());
          }
        }
      }
      units.push({
        serial,
        product_id: productId,
        sku,
        product_name: name,
        status,
        is_extra: 0,
      });
    }
  }
  const products = productRollupFromUnits(units);
  const received = units.filter((u) => u.status === 'received').length;
  const pending = units.filter((u) => u.status !== 'received').length;
  let status = String(thin.status || 'in_transit');
  if (pending === 0 && received > 0) status = 'received';
  else if (received > 0 && pending > 0) status = 'partial';
  else if (received === 0) status = 'in_transit';

  const mismatchNote = String(payload.mismatch_note || '').trim();
  const mismatch = pending > 0 && status === 'partial' && !!payload.finish_partial ? 1 : 0;

  const board: Record<string, unknown> = {
    id: thin.id,
    number: thin.number,
    status,
    doc_date: thin.doc_date,
    counterparty_id: resolveCounterpartyIdByName(thin.counterparty_name),
    supplier_name: thin.counterparty_name,
    counterparty_name: thin.counterparty_name,
    thin_journal: 1,
    units,
    products,
    lines,
    units_total: units.length,
    units_received: received,
    units_pending: pending,
    mismatch,
    mismatch_note: mismatchNote,
    receive_label:
      pending === 0 && received > 0
        ? 'Все оприходованы · на складе'
        : received > 0
          ? `Оприходовано ${received} из ${units.length} · не пришло ${pending}`
          : `Ожидает приёмки · ${units.length} марок`,
  };
  board.warehouse_task = syncInboundWarehouseTask(orderId, board);
  return board;
}

/** Доска приёмки возврата по заданию склада (channel=return). */
export function buildReturnTaskBoard(taskIdRaw: string): Record<string, unknown> | null {
  const taskId = String(taskIdRaw || '').trim();
  if (!taskId) return null;
  const task = get<{
    id: string;
    number: string;
    deal_id: string;
    buyer_name: string;
    city: string;
    status: string;
    comment: string;
    amount_locked: number;
  }>(
    `SELECT id, IFNULL(number,'') AS number, IFNULL(deal_id,'') AS deal_id,
            IFNULL(buyer_name,'') AS buyer_name, IFNULL(city,'') AS city,
            IFNULL(status,'') AS status, IFNULL(comment,'') AS comment,
            IFNULL(amount_locked,0) AS amount_locked
     FROM warehouse_tasks WHERE id = ? AND channel = 'return'`,
    [taskId]
  );
  if (!task) return null;
  const lines = all<{
    product_id: string;
    sku: string;
    name: string;
    qty: number;
    dims_json: string;
  }>(
    `SELECT IFNULL(product_id,'') AS product_id, IFNULL(sku,'') AS sku,
            IFNULL(name,'') AS name, qty, IFNULL(dims_json,'{}') AS dims_json
     FROM warehouse_task_lines WHERE task_id = ? ORDER BY line_no`,
    [taskId]
  );
  const units: Array<{
    serial: string;
    product_id: string;
    sku: string;
    product_name: string;
    status: string;
    is_extra: number;
    price: number;
  }> = [];
  for (const l of lines) {
    let dims: { serials?: string[]; received_serials?: string[]; price?: number } = {};
    try {
      dims = l.dims_json ? (JSON.parse(l.dims_json) as typeof dims) : {};
    } catch {
      dims = {};
    }
    const serials = Array.isArray(dims.serials)
      ? dims.serials.map((s) => String(s || '').trim()).filter(Boolean)
      : [];
    const receivedSet = new Set(
      (Array.isArray(dims.received_serials) ? dims.received_serials : []).map((s) =>
        String(s).toLowerCase()
      )
    );
    const price = Math.max(0, Number(dims.price) || 0);
    const qty = Math.max(serials.length, Math.round(Number(l.qty) || 0));
    if (serials.length) {
      for (const serial of serials) {
        let status = receivedSet.has(serial.toLowerCase()) ? 'received' : 'in_transit';
        if (status !== 'received') {
          const pu = findUnitBySerial(serial);
          if (
            pu &&
            (pu.status === 'in_stock' || String(pu.in_doc_id || '').trim()) &&
            !['sold', 'at_client'].includes(String(pu.status || ''))
          ) {
            // вернулся на склад
            if (pu.status === 'in_stock') status = 'received';
          }
        }
        units.push({
          serial,
          product_id: l.product_id,
          sku: l.sku,
          product_name: l.name,
          status,
          is_extra: 0,
          price,
        });
      }
    } else if (qty > 0) {
      // без марок — одна виртуальная строка на qty (прогресс только после сканов не ведём)
      for (let i = 0; i < qty; i++) {
        units.push({
          serial: `·${i + 1}`,
          product_id: l.product_id,
          sku: l.sku,
          product_name: l.name,
          status: 'in_transit',
          is_extra: 0,
          price,
        });
      }
    }
  }
  const products = productRollupFromUnits(units);
  const received = units.filter((u) => u.status === 'received').length;
  const pending = units.filter((u) => u.status !== 'received').length;
  const status =
    pending === 0 && received > 0 ? 'received' : received > 0 ? 'partial' : 'in_transit';
  return {
    id: task.deal_id || task.id,
    number: task.number,
    status,
    deal_id: task.deal_id,
    supplier_name: task.buyer_name,
    counterparty_name: task.buyer_name,
    city: task.city,
    comment: task.comment,
    amount_locked: task.amount_locked,
    thin_journal: 0,
    task_kind: 'return',
    is_return: 1,
    units,
    products,
    units_total: units.length,
    units_received: received,
    units_pending: pending,
    mismatch: pending > 0 && status === 'partial' ? 1 : 0,
    mismatch_note:
      pending > 0 && status === 'partial'
        ? `Не вернулось марок: ${pending} (принято ${received})`
        : '',
    receive_label:
      pending === 0 && received > 0
        ? 'Возврат принят · на складе'
        : received > 0
          ? `Возврат частично · на складе ${received} из ${units.length}`
          : `Возврат · ожидает скана · ${units.length} марок`,
  };
}

function findProductByBarcode(code: string) {
  const c = String(code || '').trim();
  if (!c) return null;
  return (
    get<{ id: string; sku: string; name: string; barcode: string }>(
      `SELECT id, IFNULL(sku,'') AS sku, IFNULL(name,'') AS name, IFNULL(barcode,'') AS barcode
       FROM products
       WHERE lower(IFNULL(barcode,'')) = lower(?)
          OR lower(IFNULL(sku,'')) = lower(?)
          OR lower(IFNULL(code,'')) = lower(?)
       LIMIT 1`,
      [c, c, c]
    ) || null
  );
}

export function scanSupplyCode(codeRaw: string) {
  const code = String(codeRaw || '').trim();
  if (!code) throw new Error('Пустой код');
  const sou = get<Record<string, unknown>>(
    `SELECT u.*, o.number AS order_number, o.status AS order_status, o.mismatch,
            o.counterparty_id, c.name AS supplier_name, p.sku, p.name AS product_name
     FROM supplier_order_units u
     JOIN supplier_orders o ON o.id = u.order_id
     LEFT JOIN counterparties c ON c.id = o.counterparty_id
     LEFT JOIN products p ON p.id = u.product_id
     WHERE lower(u.serial) = lower(?)
     LIMIT 1`,
    [code]
  );
  const unit = findUnitBySerial(code);
  if (sou) {
    const order = getSupplierOrder(String(sou.order_id));
    return {
      kind: 'supplier_unit',
      serial: code,
      supplier_unit: sou,
      order,
      product_unit: unit || null,
      product: null,
    };
  }
  const thin = findThinSupplierOrderBySerial(code);
  if (thin) {
    const alreadyIn =
      !!unit &&
      (unit.status === 'in_stock' ||
        unit.status === 'reserved' ||
        !!String(unit.in_doc_id || '').trim());
    const synthetic = {
      id: `thin:${thin.order_id}:${code}`,
      order_id: thin.order_id,
      product_id: thin.product_id,
      serial: code,
      status: alreadyIn ? 'received' : 'in_transit',
      is_extra: 0,
      counterparty_id: thin.counterparty_id,
      supplier_name: thin.counterparty_name,
      sku: thin.sku,
      product_name: thin.product_name,
      thin_journal: 1,
    };
    return {
      kind: 'thin_supplier_order',
      serial: code,
      supplier_unit: synthetic,
      order: thinOrderAsScanOrder(thin),
      product_unit: unit || null,
      product: null,
    };
  }
  if (unit) {
    return { kind: 'product_unit', serial: code, product_unit: unit, order: null, product: null };
  }
  const product = findProductByBarcode(code);
  if (product) {
    return {
      kind: 'product_barcode',
      serial: code,
      product_unit: null,
      order: null,
      product,
      supplier_unit: null,
    };
  }
  throw new Error('Марка / штрихкод не найден');
}

export type ScanAction =
  | 'receive'
  | 'receive_free'
  | 'return'
  | 'to_sto'
  | 'install'
  | 'on_sto'
  | 'already_received'
  | 'in_stock'
  | 'unknown';

/** По статусу кода: приход / возврат / на СТО / УПД. */
export function classifyScan(codeRaw: string): {
  serial: string;
  action: ScanAction;
  action_label: string;
  kind: string;
  order: ReturnType<typeof getSupplierOrder> | null;
  supplier_unit: Record<string, unknown> | null;
  product_unit: ReturnType<typeof findUnitBySerial> | null;
  product: { id: string; sku: string; name: string; barcode: string } | null;
  deal: ReturnType<typeof resolveBuyerDealFromSerial>;
  sale_price?: number;
  sale_price_source?: string;
} {
  const base = scanSupplyCode(codeRaw);
  const code = base.serial;
  const sou = (base.supplier_unit || null) as Record<string, unknown> | null;
  const unit = base.product_unit || null;
  const product =
    (base as { product?: { id: string; sku: string; name: string; barcode: string } | null }).product ||
    null;
  const unitStatus = String(unit?.status || '');
  const souStatus = String(sou?.status || '');
  let deal = resolveBuyerDealFromSerial(code);
  const mainWh = mainWarehouseId();
  const stoWh = stoWarehouseId();
  const whId = String(unit?.warehouse_id || '');

  const pack = (
    action: ScanAction,
    action_label: string,
    dealOverride?: ReturnType<typeof resolveBuyerDealFromSerial>
  ) => ({
    serial: code,
    action,
    action_label,
    kind: base.kind,
    order: (base.order as ReturnType<typeof getSupplierOrder>) || null,
    supplier_unit: sou,
    product_unit: unit,
    product,
    deal: dealOverride !== undefined ? dealOverride : deal,
  });

  if (base.kind === 'product_barcode' && product) {
    return pack('receive_free', 'Приход по штрихкоду товара (новая марка)');
  }

  // Продан / у клиента / есть расходный — это возврат, не приход от поставщика
  const outDocId = String((unit as { out_doc_id?: string } | null)?.out_doc_id || '').trim();
  const isClientHeld =
    ['sold', 'at_client', 'written_off'].includes(unitStatus) || !!outDocId;

  if (isClientHeld) {
    const sale = unit?.product_id
      ? getLastSalePrice({
          productId: String(unit.product_id),
          serial: code,
          dealId: deal?.deal_id || '',
        })
      : { price: 0, source: '', deal_id: '' };
    const packed = pack('return', 'Возврат от клиента');
    return {
      ...packed,
      sale_price: sale.price,
      sale_price_source: sale.source,
      deal: packed.deal || (sale.deal_id
        ? {
            deal_id: sale.deal_id,
            deal_name: sale.deal_id,
            buyer_name: '',
            source: 'sale_price',
          }
        : packed.deal),
    };
  }

  if (sou && (souStatus === 'in_transit' || souStatus === 'expected')) {
    return pack('receive', 'Приход из поставки');
  }

  if (unitStatus === 'in_transit') {
    return pack('receive', 'Приход (в пути)');
  }

  if (unitStatus === 'in_stock' && whId === mainWh) {
    return pack('to_sto', 'Переместить на СТО');
  }

  if (unitStatus === 'in_stock' && whId === stoWh) {
    if (!deal && unit?.product_id) {
      const fromReq = get<{ deal_id: string }>(
        `SELECT IFNULL(r.deal_id,'') AS deal_id
         FROM sto_transfer_requests r
         JOIN sto_transfer_request_lines l ON l.request_id = r.id
         WHERE IFNULL(r.deal_id,'') != ''
           AND (lower(IFNULL(l.serial,'')) = lower(?) OR l.product_id = ?)
         ORDER BY datetime(r.created_at) DESC
         LIMIT 1`,
        [code, unit.product_id]
      );
      if (fromReq?.deal_id) {
        deal = resolveBuyerDealFromSerial(code);
        const d = getDeal(fromReq.deal_id) as Record<string, unknown> | null;
        if (d) {
          deal = {
            deal_id: fromReq.deal_id,
            deal_name: String(d.name || fromReq.deal_id),
            buyer_name: String(d.buyer_name || d.company_name || '').trim(),
            source: 'sto_request',
          };
        } else {
          deal = {
            deal_id: fromReq.deal_id,
            deal_name: fromReq.deal_id,
            buyer_name: '',
            source: 'sto_request',
          };
        }
      }
    }
    if (deal?.deal_id) {
      return pack('install', 'УПД + списание со СТО', deal);
    }
    return pack('on_sto', 'На СТО — для УПД нужен заказ покупателя', null);
  }

  if (sou && souStatus === 'received') {
    return pack('already_received', 'Уже оприходован из поставки');
  }

  if (unitStatus === 'in_stock') {
    return pack('in_stock', 'Уже на складе');
  }

  // Непонятный кейс → приход без основания
  return pack('receive_free', 'Приход без основания');
}

/** Одно нажатие: приход / возврат / СТО / УПД — по статусу Data Matrix. */
export function applyScan(
  codeRaw: string,
  opts?: { comment?: string; actor_name?: string; deal_id?: string }
): Record<string, unknown> {
  const classified = classifyScan(codeRaw);
  const actor = opts?.actor_name;

  if (classified.action === 'receive') {
    if (classified.supplier_unit) {
      const isThin = classified.kind === 'thin_supplier_order' || !!classified.supplier_unit.thin_journal;
      const row = isThin
        ? receiveThinSupplierOrderUnit(classified.serial, actor)
        : receiveUnit(classified.serial, actor);
      return { ...row, action: 'receive', action_label: classified.action_label, deal: classified.deal };
    }
    const mainWh = mainWarehouseId();
    const docId = newGuid();
    const lineId = newGuid();
    const unit = classified.product_unit;
    if (!unit) throw new Error('Data Matrix не найден');
    run(
      `INSERT INTO stock_docs
        (id, doc_type, number, doc_date, warehouse_id, warehouse_to_id, counterparty_id, comment, posted,
         organization_id, deal_id, basis_order_id, source_supplier_order_id, mismatch)
       VALUES (?, 'in', ?, ?, ?, NULL, NULL, ?, 1, '', '', '', '', 0)`,
      [
        docId,
        nextDocNumber('in'),
        new Date().toISOString().slice(0, 10),
        mainWh,
        `Приход Data Matrix${actor ? ' · ' + actor : ''}`,
      ]
    );
    run(
      `INSERT INTO stock_doc_lines (id, doc_id, product_id, qty, serials_json, warehouse_id)
       VALUES (?, ?, ?, 1, ?, ?)`,
      [lineId, docId, unit.product_id, JSON.stringify([classified.serial]), mainWh]
    );
    applyStockDelta(mainWh, unit.product_id, 1);
    promoteInTransitUnit({
      serial: classified.serial,
      warehouseId: mainWh,
      docId,
      lineId,
    });
    invalidateStockValuationCache();
    return {
      ok: true,
      action: 'receive',
      action_label: classified.action_label,
      serial: classified.serial,
      stock_doc_id: docId,
      order: classified.order,
      deal: classified.deal,
      product_unit: findUnitBySerial(classified.serial),
    };
  }

  if (classified.action === 'receive_free' || classified.action === 'unknown') {
    if (classified.kind === 'product_barcode' && classified.product?.id) {
      const newSerial = nextBarcode('DM');
      const row = receiveFreeNoBasis(newSerial, actor, {
        product_id: classified.product.id,
        status: '',
      });
      return {
        ...row,
        action: 'receive_free',
        action_label: classified.action_label || 'Приход по штрихкоду',
        product: classified.product,
        scanned_barcode: classified.serial,
        order: null,
        deal: classified.deal,
      };
    }
    const row = receiveFreeNoBasis(classified.serial, actor, classified.product_unit || undefined);
    return {
      ...row,
      action: 'receive_free',
      action_label: classified.action_label || 'Приход без основания',
      order: null,
      deal: classified.deal,
    };
  }

  if (classified.action === 'return') {
    const comment =
      String(opts?.comment || '').trim() ||
      `Возврат от клиента · Data Matrix${classified.deal?.deal_name ? ' · ' + classified.deal.deal_name : ''}`;
    const row = clientReturn({
      serial: classified.serial,
      comment,
      deal_id: classified.deal?.deal_id,
      actor_name: actor,
    });
    return {
      ...row,
      action: 'return',
      action_label: classified.action_label,
      order: classified.order,
    };
  }

  if (classified.action === 'to_sto') {
    const row = transferSerialToSto({
      serial: classified.serial,
      deal_id: opts?.deal_id || classified.deal?.deal_id || '',
      actor_name: actor,
    });
    return {
      ...row,
      action: 'to_sto',
      action_label: classified.action_label,
      deal: classified.deal,
      order: classified.order,
    };
  }

  if (classified.action === 'install') {
    const dealId = String(opts?.deal_id || classified.deal?.deal_id || '').trim();
    if (!dealId) throw new Error('Нет заказа покупателя для УПД');
    const row = installAndUpd({
      deal_id: dealId,
      serials: [classified.serial],
      created_by: actor,
    });
    return {
      ...row,
      action: 'install',
      action_label: classified.action_label,
      serial: classified.serial,
      deal: classified.deal,
      order: classified.order,
      product_unit: findUnitBySerial(classified.serial),
    };
  }

  if (classified.action === 'on_sto') {
    throw new Error('Код на СТО — привяжите заказ покупателя (заявка на СТО), затем снова сканируйте для УПД');
  }
  if (classified.action === 'already_received') {
    throw new Error('Уже оприходован из поставки');
  }
  if (classified.action === 'in_stock') {
    throw new Error('Уже на складе');
  }
  // запасной путь — приход без основания
  const row = receiveFreeNoBasis(classified.serial, actor, classified.product_unit || undefined);
  return {
    ...row,
    action: 'receive_free',
    action_label: 'Приход без основания',
    order: null,
    deal: classified.deal,
  };
}

/** Приход без заказа / сделки / поставщика — когда основание не определено. */
export function receiveFreeNoBasis(
  serialRaw: string,
  actorName?: string,
  unitHint?: { product_id?: string; status?: string; id?: string } | null
) {
  const code = String(serialRaw || '').trim();
  if (!code) throw new Error('Пустой код');
  const unit = findUnitBySerial(code);
  const productId = String(unit?.product_id || unitHint?.product_id || '').trim();
  if (!productId) {
    throw new Error('Неизвестный товар — укажите номенклатуру или заказ поставщику');
  }
  if (unit && unit.status === 'in_stock' && String(unit.in_doc_id || '').trim()) {
    throw new Error('Уже на складе');
  }
  if (unit && ['sold', 'at_client', 'written_off'].includes(String(unit.status || ''))) {
    throw new Error('Товар отгружен — оформляйте возврат');
  }
  const mainWh = mainWarehouseId();
  const docId = newGuid();
  const lineId = newGuid();
  const number = nextDocNumber('in');
  const docDate = new Date().toISOString().slice(0, 10);
  const comment =
    `основание:без основания` + (actorName ? ` · ${actorName}` : '') + ` · ${code}`;
  run(
    `INSERT INTO stock_docs
      (id, doc_type, number, doc_date, warehouse_id, warehouse_to_id, counterparty_id, comment, posted,
       organization_id, deal_id, basis_order_id, source_supplier_order_id, mismatch)
     VALUES (?, 'in', ?, ?, ?, NULL, NULL, ?, 1, '', '', '', '', 0)`,
    [docId, number, docDate, mainWh, comment]
  );
  run(
    `INSERT INTO stock_doc_lines (id, doc_id, product_id, qty, serials_json, warehouse_id)
     VALUES (?, ?, ?, 1, ?, ?)`,
    [lineId, docId, productId, JSON.stringify([code]), mainWh]
  );
  applyStockDelta(mainWh, productId, 1);
  if (unit && (unit.status === 'in_transit' || unit.status === 'in_stock')) {
    try {
      promoteInTransitUnit({ serial: code, warehouseId: mainWh, docId, lineId });
    } catch {
      run(
        `UPDATE product_units
         SET status = 'in_stock', warehouse_id = ?, in_doc_id = ?, in_line_id = ?, updated_at = ?
         WHERE lower(serial) = lower(?)`,
        [mainWh, docId, lineId, new Date().toISOString(), code]
      );
    }
  } else if (!unit) {
    receiveUnits({
      productId,
      warehouseId: mainWh,
      serials: [code],
      docId,
      lineId,
    });
  } else {
    run(
      `UPDATE product_units
       SET status = 'in_stock', warehouse_id = ?, in_doc_id = ?, in_line_id = ?,
           out_doc_id = '', out_line_id = '', updated_at = ?
       WHERE id = ?`,
      [mainWh, docId, lineId, new Date().toISOString(), unit.id]
    );
  }
  invalidateStockValuationCache();
  return {
    ok: true,
    serial: code,
    stock_doc_id: docId,
    product_unit: findUnitBySerial(code),
  };
}

function postReceiveOne(opts: {
  productId: string;
  serial: string;
  warehouseId: string;
  counterpartyId?: string;
  orderId?: string;
  comment: string;
  dealId?: string;
}): { doc_id: string; line_id: string } {
  const docId = newGuid();
  const lineId = newGuid();
  const number = nextDocNumber('in');
  const docDate = new Date().toISOString().slice(0, 10);
  run(
    `INSERT INTO stock_docs
      (id, doc_type, number, doc_date, warehouse_id, warehouse_to_id, counterparty_id, comment, posted,
       organization_id, deal_id, basis_order_id, source_supplier_order_id, mismatch)
     VALUES (?, 'in', ?, ?, ?, NULL, ?, ?, 1, '', ?, '', ?, 0)`,
    [
      docId,
      number,
      docDate,
      opts.warehouseId,
      opts.counterpartyId || null,
      opts.comment,
      opts.dealId || '',
      opts.orderId || '',
    ]
  );
  run(
    `INSERT INTO stock_doc_lines (id, doc_id, product_id, qty, serials_json, warehouse_id)
     VALUES (?, ?, ?, 1, ?, ?)`,
    [lineId, docId, opts.productId, JSON.stringify([opts.serial]), opts.warehouseId]
  );
  applyStockDelta(opts.warehouseId, opts.productId, 1);
  promoteInTransitUnit({
    serial: opts.serial,
    warehouseId: opts.warehouseId,
    docId,
    lineId,
  });
  invalidateStockValuationCache();
  return { doc_id: docId, line_id: lineId };
}

/** Оприходовать один Data Matrix из поставки на основной склад. */
export function receiveUnit(serialRaw: string, actorName?: string) {
  const code = String(serialRaw || '').trim();
  const sou = get<{
    id: string;
    order_id: string;
    product_id: string;
    serial: string;
    status: string;
  }>(`SELECT * FROM supplier_order_units WHERE lower(serial) = lower(?)`, [code]);
  if (!sou) throw new Error('Код не из поставки — для излишка используйте receive-extra');
  if (sou.status === 'received') throw new Error('Уже оприходован');
  const order = get<{ counterparty_id: string; number: string }>(
    `SELECT counterparty_id, number FROM supplier_orders WHERE id = ?`,
    [sou.order_id]
  );
  if (!order) throw new Error('Заказ не найден');
  const supplierName =
    get<{ name: string }>(`SELECT name FROM counterparties WHERE id = ?`, [order.counterparty_id])
      ?.name || '';
  const mainWh = mainWarehouseId();
  const posted = postReceiveOne({
    productId: sou.product_id,
    serial: sou.serial,
    warehouseId: mainWh,
    counterpartyId: order.counterparty_id,
    orderId: sou.order_id,
    comment:
      `основание:заказ поставщику ${order.number}` +
      (supplierName ? ` · ${supplierName}` : '') +
      (actorName ? ` · ${actorName}` : ''),
  });
  run(
    `UPDATE supplier_order_units
     SET status = 'received', received_at = datetime('now'), stock_doc_id = ?
     WHERE id = ?`,
    [posted.doc_id, sou.id]
  );
  refreshOrderStatus(sou.order_id);
  return {
    ok: true,
    serial: sou.serial,
    stock_doc_id: posted.doc_id,
    order: buildInboundBoard(sou.order_id) || getSupplierOrder(sou.order_id),
    action: 'receive',
    action_label: 'Оприходован · на складе',
  };
}

/**
 * Приход по марке из заказа поставщику (тонкий журнал): документ-основание + поставщик из заказа.
 */
export function receiveThinSupplierOrderUnit(serialRaw: string, actorName?: string) {
  const code = String(serialRaw || '').trim();
  const thin = findThinSupplierOrderBySerial(code);
  if (!thin) throw new Error('Код не найден в заказе поставщику');
  const existing = findUnitBySerial(code);
  if (existing && (existing.status === 'in_stock' || String(existing.in_doc_id || '').trim())) {
    throw new Error('Уже оприходован');
  }
  if (existing && ['sold', 'at_client', 'written_off'].includes(existing.status)) {
    throw new Error('Товар уже отгружен — оформляйте возврат');
  }
  if (!thin.counterparty_id) {
    throw new Error(
      thin.counterparty_name
        ? `Поставщик «${thin.counterparty_name}» не найден в справочнике — укажите контрагента в заказе`
        : 'В заказе поставщику не указан поставщик'
    );
  }
  const mainWh = mainWarehouseId();
  const docId = newGuid();
  const lineId = newGuid();
  const number = nextDocNumber('in');
  const docDate = new Date().toISOString().slice(0, 10);
  const comment =
    `основание:заказ поставщику ${thin.number}` +
    (thin.counterparty_name ? ` · ${thin.counterparty_name}` : '') +
    (actorName ? ` · ${actorName}` : '');
  run(
    `INSERT INTO stock_docs
      (id, doc_type, number, doc_date, warehouse_id, warehouse_to_id, counterparty_id, comment, posted,
       organization_id, deal_id, basis_order_id, source_supplier_order_id, mismatch)
     VALUES (?, 'in', ?, ?, ?, NULL, ?, ?, 1, '', '', '', ?, 0)`,
    [docId, number, docDate, mainWh, thin.counterparty_id, comment, thin.order_id]
  );
  run(
    `INSERT INTO stock_doc_lines (id, doc_id, product_id, qty, serials_json, warehouse_id)
     VALUES (?, ?, ?, 1, ?, ?)`,
    [lineId, docId, thin.product_id, JSON.stringify([code]), mainWh]
  );
  applyStockDelta(mainWh, thin.product_id, 1);
  const partyApps = resolveInboundPartyApps({
    orderId: thin.order_id,
    productId: thin.product_id,
    serial: code,
  });
  if (existing && (existing.status === 'in_transit' || existing.status === 'in_stock')) {
    promoteInTransitUnit({ serial: code, warehouseId: mainWh, docId, lineId });
    if (partyApps.length) {
      try {
        setUnitApps(code, partyApps);
      } catch {
        /* ignore */
      }
    }
  } else {
    receiveUnits({
      productId: thin.product_id,
      warehouseId: mainWh,
      serials: [code],
      docId,
      lineId,
      supplierId: thin.counterparty_id,
      apps: partyApps.length ? partyApps : undefined,
    });
  }
  invalidateStockValuationCache();
  // пометка в payload заказа, что марка принята
  try {
    const row = get<{ payload_json: string }>(
      `SELECT IFNULL(payload_json,'') AS payload_json FROM thin_journal_docs WHERE id = ?`,
      [thin.order_id]
    );
    if (row) {
      const payload = row.payload_json ? (JSON.parse(row.payload_json) as Record<string, unknown>) : {};
      const received = Array.isArray(payload.received_serials)
        ? (payload.received_serials as unknown[]).map((s) => String(s || '').trim()).filter(Boolean)
        : [];
      if (!received.some((s) => s.toLowerCase() === code.toLowerCase())) {
        received.push(code);
      }
      payload.received_serials = received;
      payload.last_receive_at = new Date().toISOString();
      payload.stock_doc_id = docId;
      run(
        `UPDATE thin_journal_docs SET payload_json = ?, updated_at = datetime('now') WHERE id = ?`,
        [JSON.stringify(payload), thin.order_id]
      );
    }
  } catch {
    /* не блокируем приход */
  }
  // статус заказа: partial / received
  try {
    const board = buildInboundBoard(thin.order_id);
    if (board) {
      const st = String(board.status || 'partial');
      run(
        `UPDATE thin_journal_docs SET status = ?, updated_at = datetime('now') WHERE id = ?`,
        [st === 'received' ? 'received' : 'partial', thin.order_id]
      );
      syncInboundWarehouseTask(thin.order_id, {
        status: st,
        units_pending: Number(board.units_pending) || 0,
        units_received: Number(board.units_received) || 0,
      });
    }
  } catch {
    /* ignore */
  }
  return {
    ok: true,
    serial: code,
    stock_doc_id: docId,
    order: buildInboundBoard(thin.order_id) || thinOrderAsScanOrder(thin),
    product_unit: findUnitBySerial(code),
    action: 'receive',
    action_label: 'Оприходован · на складе',
  };
}

/** Излишек: новый Data Matrix, строка в заказе, оприходование, mismatch. */
export function receiveExtra(input: {
  order_id: string;
  product_id: string;
  actor_name?: string;
  note?: string;
}) {
  const order = get<{ id: string; number: string; counterparty_id: string }>(
    `SELECT id, number, counterparty_id FROM supplier_orders WHERE id = ?`,
    [input.order_id]
  );
  if (!order) throw new Error('Заказ не найден');
  const product = get<{ id: string }>('SELECT id FROM products WHERE id = ?', [input.product_id]);
  if (!product) throw new Error('Товар не найден');
  const cp = get<{ barcode_prefix: string }>(
    `SELECT IFNULL(barcode_prefix,'') AS barcode_prefix FROM counterparties WHERE id = ?`,
    [order.counterparty_id]
  );
  const serial = nextBarcode(String(cp?.barcode_prefix || 'DM'));
  const transitWh = transitWarehouseId();
  const mainWh = mainWarehouseId();
  const unitIds = createInTransitUnits({
    productId: product.id,
    warehouseId: transitWh,
    serials: [serial],
    comment: `излишек ${order.number}`,
  });
  const lineId = newGuid();
  run(
    `INSERT INTO supplier_order_lines (id, order_id, product_id, qty, price, comment, sort_order)
     VALUES (?, ?, ?, 1, 0, ?, 9999)`,
    [lineId, order.id, product.id, String(input.note || 'излишек при приёмке')]
  );
  const souId = newGuid();
  run(
    `INSERT INTO supplier_order_units
      (id, order_id, line_id, product_id, serial, status, product_unit_id, is_extra, created_at)
     VALUES (?, ?, ?, ?, ?, 'in_transit', ?, 1, datetime('now'))`,
    [souId, order.id, lineId, product.id, serial, unitIds[0] || '']
  );
  const posted = postReceiveOne({
    productId: product.id,
    serial,
    warehouseId: mainWh,
    counterpartyId: order.counterparty_id,
    orderId: order.id,
    comment: `Излишек по заказу ${order.number}${input.actor_name ? ' · ' + input.actor_name : ''}`,
  });
  run(
    `UPDATE supplier_order_units SET status = 'received', received_at = datetime('now'), stock_doc_id = ? WHERE id = ?`,
    [posted.doc_id, souId]
  );
  const note = String(input.note || 'Есть позиции вне заказа').trim();
  run(
    `UPDATE supplier_orders
     SET mismatch = 1,
         mismatch_note = CASE WHEN mismatch_note = '' THEN ? ELSE mismatch_note || '; ' || ? END,
         updated_at = datetime('now')
     WHERE id = ?`,
    [note, note, order.id]
  );
  refreshOrderStatus(order.id);
  return {
    ok: true,
    serial,
    stock_doc_id: posted.doc_id,
    order: getSupplierOrder(order.id),
  };
}

export function finishReceipt(orderId: string) {
  const classic = getSupplierOrder(orderId);
  if (classic) {
    refreshOrderStatus(orderId);
    const units = (classic.units as Array<{ status: string; is_extra: number }>) || [];
    const pending = units.filter(
      (u) => !u.is_extra && (u.status === 'in_transit' || u.status === 'expected')
    ).length;
    if (pending > 0) {
      run(
        `UPDATE supplier_orders SET status = 'partial', mismatch = 1,
           mismatch_note = CASE WHEN mismatch_note = '' THEN ? ELSE mismatch_note END,
           updated_at = datetime('now') WHERE id = ?`,
        [`Не оприходовано позиций: ${pending}`, orderId]
      );
    } else {
      run(
        `UPDATE supplier_orders SET status = 'received', updated_at = datetime('now') WHERE id = ?`,
        [orderId]
      );
    }
    const board = buildInboundBoard(orderId);
    if (board) syncInboundWarehouseTask(orderId, board as { units_pending?: number; units_received?: number });
    return board || getSupplierOrder(orderId);
  }

  // тонкий журнал заказа поставщику
  const board = buildInboundBoard(orderId);
  if (!board) throw new Error('Заказ не найден');
  const pending = Number(board.units_pending) || 0;
  const received = Number(board.units_received) || 0;
  const note =
    pending > 0
      ? `Не пришло из заказа: ${pending} марок (оприходовано ${received})`
      : '';
  try {
    const row = get<{ payload_json: string }>(
      `SELECT IFNULL(payload_json,'') AS payload_json FROM thin_journal_docs WHERE id = ?`,
      [orderId]
    );
    const payload = row?.payload_json
      ? (JSON.parse(row.payload_json) as Record<string, unknown>)
      : {};
    if (pending > 0) {
      payload.finish_partial = 1;
      payload.mismatch_note = note;
      payload.missing_count = pending;
    } else {
      payload.finish_partial = 0;
    }
    run(
      `UPDATE thin_journal_docs
       SET status = ?, payload_json = ?, updated_at = datetime('now')
       WHERE id = ?`,
      [pending > 0 ? 'partial' : 'received', JSON.stringify(payload), orderId]
    );
  } catch {
    run(
      `UPDATE thin_journal_docs SET status = ?, updated_at = datetime('now') WHERE id = ?`,
      [pending > 0 ? 'partial' : 'received', orderId]
    );
  }
  const next = buildInboundBoard(orderId);
  if (next) {
    if (pending > 0) {
      // задание остаётся открытым — на складе видят недостачу
      const task = findInboundWarehouseTask(orderId);
      if (task && task.status !== 'handed') {
        run(
          `UPDATE warehouse_tasks
           SET status = 'picking',
               comment = CASE WHEN comment LIKE '%недостача%' THEN comment ELSE comment || ' · недостача ' || ? END,
               updated_at = datetime('now')
           WHERE id = ?`,
          [String(pending), task.id]
        );
      }
    } else {
      syncInboundWarehouseTask(orderId, next as { units_pending?: number; units_received?: number });
    }
  }
  return next;
}

/* ——— СТО transfer requests ——— */

export function createStoTransferRequest(input: {
  deal_id?: string;
  warehouse_task_id?: string;
  comment?: string;
  created_by?: string;
  lines: Array<{ product_id: string; qty?: number; serial?: string }>;
}) {
  const lines = (input.lines || []).filter((l) => l.product_id);
  if (!lines.length) throw new Error('Нет строк заявки');
  const id = newGuid();
  const number = nextCode('СТО', 5);
  const now = new Date().toISOString();
  run(
    `INSERT INTO sto_transfer_requests
      (id, number, deal_id, warehouse_task_id, status, comment, created_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'new', ?, ?, ?, ?)`,
    [
      id,
      number,
      String(input.deal_id || ''),
      String(input.warehouse_task_id || ''),
      String(input.comment || ''),
      String(input.created_by || ''),
      now,
      now,
    ]
  );
  for (const l of lines) {
    run(
      `INSERT INTO sto_transfer_request_lines (id, request_id, product_id, qty, serial, status)
       VALUES (?, ?, ?, ?, ?, 'new')`,
      [
        newGuid(),
        id,
        l.product_id,
        Math.max(1, Number(l.qty) || 1),
        String(l.serial || '').trim(),
      ]
    );
  }
  return getStoTransferRequest(id);
}

export function getStoTransferRequest(id: string) {
  const req = get(`SELECT * FROM sto_transfer_requests WHERE id = ?`, [id]);
  if (!req) return null;
  const lines = all(
    `SELECT l.*, p.sku, p.name AS product_name
     FROM sto_transfer_request_lines l
     LEFT JOIN products p ON p.id = l.product_id
     WHERE l.request_id = ?`,
    [id]
  );
  return { ...req, lines };
}

export function listStoTransferRequests(opts?: { status?: string; limit?: number }) {
  const where: string[] = ['1=1'];
  const params: Array<string | number> = [];
  if (opts?.status) {
    where.push('status = ?');
    params.push(opts.status);
  }
  const limit = Math.min(100, Math.max(1, Number(opts?.limit) || 40));
  return all(
    `SELECT r.*,
       (SELECT COUNT(*) FROM sto_transfer_request_lines l WHERE l.request_id = r.id AND l.status = 'new') AS pending_lines
     FROM sto_transfer_requests r
     WHERE ${where.join(' AND ')}
     ORDER BY datetime(r.created_at) DESC
     LIMIT ?`,
    [...params, limit]
  );
}

/** Скан Data Matrix на основном → перемещение на СТО (по заявке или напрямую). */
export function transferSerialToSto(input: {
  serial: string;
  request_id?: string;
  deal_id?: string;
  actor_name?: string;
}) {
  const code = String(input.serial || '').trim();
  const unit = findUnitBySerial(code);
  if (!unit) throw new Error('Data Matrix не найден');
  if (unit.status !== 'in_stock') throw new Error(`Data Matrix в статусе ${unit.status}`);
  const mainWh = mainWarehouseId();
  const stoWh = stoWarehouseId();
  if (unit.warehouse_id !== mainWh) {
    throw new Error('Код не на основном складе');
  }
  const docId = createDocument({
    doc_type: 'transfer',
    warehouse_id: mainWh,
    warehouse_to_id: stoWh,
    deal_id: input.deal_id || '',
    comment: `На СТО · ${code}${input.actor_name ? ' · ' + input.actor_name : ''}`,
    lines: [{ product_id: unit.product_id, qty: 1, serials: [code] }],
    post: true,
  });
  if (input.request_id) {
    const line = get<{ id: string }>(
      `SELECT id FROM sto_transfer_request_lines
       WHERE request_id = ? AND product_id = ? AND status = 'new'
       ORDER BY id LIMIT 1`,
      [input.request_id, unit.product_id]
    );
    if (line?.id) {
      run(
        `UPDATE sto_transfer_request_lines
         SET status = 'done', transferred_at = datetime('now'), stock_doc_id = ?, serial = ?
         WHERE id = ?`,
        [docId, code, line.id]
      );
    }
    const left = get<{ c: number }>(
      `SELECT COUNT(*) AS c FROM sto_transfer_request_lines WHERE request_id = ? AND status = 'new'`,
      [input.request_id]
    )?.c;
    run(
      `UPDATE sto_transfer_requests
       SET status = ?, updated_at = datetime('now') WHERE id = ?`,
      [Number(left) > 0 ? 'picking' : 'done', input.request_id]
    );
  }
  return { ok: true, stock_doc_id: docId, serial: code, product_unit: findUnitBySerial(code) };
}

/** Установка/выдача: УПД + списание со СТО по списку Data Matrix. */
export function installAndUpd(input: {
  deal_id: string;
  serials: string[];
  created_by?: string;
  organization_id?: string;
}) {
  const dealId = String(input.deal_id || '').trim();
  if (!dealId) throw new Error('Укажите сделку');
  const serials = [...new Set((input.serials || []).map((s) => String(s || '').trim()).filter(Boolean))];
  if (!serials.length) throw new Error('Укажите коды Data Matrix');
  const stoWh = stoWarehouseId();
  for (const s of serials) {
    const u = findUnitBySerial(s);
    if (!u) throw new Error(`Data Matrix ${s} не найден`);
    if (u.status !== 'in_stock' || u.warehouse_id !== stoWh) {
      throw new Error(`Data Matrix ${s} должен быть на складе СТО`);
    }
  }
  const result = createUpdAndWriteOffFromDeal({
    dealId,
    createdBy: input.created_by,
    organizationId: input.organization_id,
    preferredWarehouseId: stoWh,
  });
  // Доп. списание по конкретным DM, если stock_doc создан без serials
  if (result.stock_doc_id) {
    const byProduct = new Map<string, string[]>();
    for (const s of serials) {
      const u = findUnitBySerial(s)!;
      const list = byProduct.get(u.product_id) || [];
      list.push(s);
      byProduct.set(u.product_id, list);
    }
    for (const [productId, codes] of byProduct) {
      try {
        shipUnits({
          productId,
          warehouseId: stoWh,
          serials: codes,
          docId: result.stock_doc_id,
          lineId: '',
        });
      } catch {
        /* уже списаны через postDocument */
      }
    }
  } else {
    // Нет товарных позиций в УПД — списываем вручную
    const byProduct = new Map<string, string[]>();
    for (const s of serials) {
      const u = findUnitBySerial(s)!;
      const list = byProduct.get(u.product_id) || [];
      list.push(s);
      byProduct.set(u.product_id, list);
    }
    const lines = [...byProduct.entries()].map(([product_id, codes]) => ({
      product_id,
      qty: codes.length,
      serials: codes,
    }));
    const outId = createDocument({
      doc_type: 'out',
      warehouse_id: stoWh,
      deal_id: dealId,
      comment: `СТО установка/выдача · сделка ${dealId}`,
      lines,
      post: true,
    });
    result.stock_doc_id = outId;
    result.stock_note = 'Списано со СТО по Data Matrix';
  }
  return result;
}

/** Найти заказ покупателя (сделку) по серийнику / Data Matrix. */
export function resolveBuyerDealFromSerial(serialRaw: string): {
  deal_id: string;
  deal_name: string;
  buyer_name: string;
  source: string;
} | null {
  const code = String(serialRaw || '').trim();
  if (!code) return null;

  const pack = (dealId: string, source: string) => {
    const id = String(dealId || '').trim();
    if (!id) return null;
    const deal = getDeal(id) as Record<string, unknown> | null;
    if (!deal) {
      return {
        deal_id: id,
        deal_name: id,
        buyer_name: '',
        source,
      };
    }
    return {
      deal_id: id,
      deal_name: String(deal.name || deal.id || id),
      buyer_name: String(deal.buyer_name || deal.company_name || '').trim(),
      source,
    };
  };

  const unit = findUnitBySerial(code);
  if (unit?.out_doc_id) {
    const row = get<{ deal_id: string }>(
      `SELECT IFNULL(deal_id,'') AS deal_id FROM stock_docs WHERE id = ?`,
      [unit.out_doc_id]
    );
    const hit = pack(row?.deal_id || '', 'out_doc');
    if (hit) return hit;
  }

  const like = `%"${code.replace(/"/g, '')}"%`;
  const fromLine = get<{ deal_id: string }>(
    `SELECT IFNULL(d.deal_id,'') AS deal_id
     FROM stock_doc_lines l
     JOIN stock_docs d ON d.id = l.doc_id
     WHERE IFNULL(d.deal_id,'') != ''
       AND IFNULL(l.serials_json,'') LIKE ?
     ORDER BY CASE d.doc_type WHEN 'out' THEN 0 WHEN 'upd' THEN 1 ELSE 2 END,
              datetime(IFNULL(d.doc_date, d.created_at)) DESC
     LIMIT 1`,
    [like]
  );
  {
    const hit = pack(fromLine?.deal_id || '', 'stock_line');
    if (hit) return hit;
  }

  const fromTask = get<{ deal_id: string }>(
    `SELECT IFNULL(deal_id,'') AS deal_id FROM warehouse_tasks
     WHERE lower(barcode) = lower(?) AND IFNULL(deal_id,'') != ''
     ORDER BY datetime(updated_at) DESC LIMIT 1`,
    [code]
  );
  {
    const hit = pack(fromTask?.deal_id || '', 'warehouse_task');
    if (hit) return hit;
  }

  const fromDm = get<{ deal_id: string }>(
    `SELECT IFNULL(deal_id,'') AS deal_id FROM datamatrix_codes
     WHERE lower(code) = lower(?) AND IFNULL(deal_id,'') != ''
     LIMIT 1`,
    [code]
  );
  {
    const hit = pack(fromDm?.deal_id || '', 'datamatrix');
    if (hit) return hit;
  }

  // Запасной путь: товар из единицы → последняя сделка с этой номенклатурой
  if (unit?.product_id) {
    const fromItem = get<{ deal_id: string }>(
      `SELECT i.deal_id AS deal_id
       FROM crm_deal_items i
       JOIN crm_deals d ON d.id = i.deal_id
       WHERE i.product_guid = ?
       ORDER BY datetime(IFNULL(d.updated_at, d.created_at)) DESC
       LIMIT 1`,
      [unit.product_id]
    );
    const hit = pack(fromItem?.deal_id || '', 'deal_item');
    if (hit) return hit;
  }

  return null;
}

/** Возврат от клиента: скан на основном складе. */
export function clientReturn(input: {
  serial: string;
  comment: string;
  deal_id?: string;
  actor_name?: string;
}) {
  const code = String(input.serial || '').trim();
  const comment = String(input.comment || '').trim();
  if (!comment) throw new Error('Укажите комментарий к приходу возврата');
  const unit = findUnitBySerial(code);
  if (!unit) throw new Error('Data Matrix не найден');
  const resolved =
    String(input.deal_id || '').trim()
      ? {
          deal_id: String(input.deal_id).trim(),
          deal_name: '',
          buyer_name: '',
          source: 'manual',
        }
      : resolveBuyerDealFromSerial(code);
  let dealId = resolved?.deal_id || '';
  let buyerName = String(resolved?.buyer_name || '').trim();
  if (dealId && !buyerName) {
    const d = getDeal(dealId) as Record<string, unknown> | null;
    if (d) {
      buyerName = String(d.buyer_name || d.company_name || d.name || '').trim();
      if (resolved) {
        resolved.deal_name = String(d.name || resolved.deal_name || dealId);
        resolved.buyer_name = buyerName;
      }
    }
  }
  const sale = getLastSalePrice({
    productId: unit.product_id,
    serial: code,
    dealId,
  });
  if (!dealId && sale.deal_id) dealId = sale.deal_id;
  const price = Math.max(0, Number(sale.price) || 0);
  const amount = price;
  const mainWh = mainWarehouseId();
  const docId = newGuid();
  const lineId = newGuid();
  const number = nextDocNumber('return');
  const docDate = new Date().toISOString().slice(0, 10);
  const dealNote = resolved || dealId
    ? ` · заказ покупателя ${(resolved?.deal_name || dealId)}${buyerName ? ' · ' + buyerName : ''}`
    : '';
  const priceNote = price > 0 ? ` · цена продажи ${price}` : '';
  run(
    `INSERT INTO stock_docs
      (id, doc_type, number, doc_date, warehouse_id, warehouse_to_id, counterparty_id, comment, posted,
       organization_id, deal_id, basis_order_id, source_supplier_order_id, mismatch, amount)
     VALUES (?, 'return', ?, ?, ?, NULL, NULL, ?, 1, '', ?, '', '', 0, ?)`,
    [
      docId,
      number,
      docDate,
      mainWh,
      `${comment}${dealNote}${priceNote}${input.actor_name ? ' · ' + input.actor_name : ''}`,
      dealId,
      amount,
    ]
  );
  run(
    `INSERT INTO stock_doc_lines (id, doc_id, product_id, qty, price, amount, serials_json, warehouse_id)
     VALUES (?, ?, ?, 1, ?, ?, ?, ?)`,
    [lineId, docId, unit.product_id, price, amount, JSON.stringify([code]), mainWh]
  );
  applyStockDelta(mainWh, unit.product_id, 1);
  returnUnitFromClient({
    serial: code,
    warehouseId: mainWh,
    docId,
    lineId,
    comment,
  });
  invalidateStockValuationCache();
  const money = createMoneyRefundFromReturn({
    stockDocId: docId,
    stockDocNumber: number,
    amount,
    dealId,
    counterpartyName: buyerName,
    serials: [code],
    comment: `основание:возврат ${number}${buyerName ? ' · ' + buyerName : ''}`,
  });
  // прогресс по заданию возврата (если было требование на склад)
  try {
    markReturnTaskSerialReceived(code, dealId);
  } catch {
    /* ignore */
  }
  const returnBoard = dealId
    ? (() => {
        const t = get<{ id: string }>(
          `SELECT id FROM warehouse_tasks
           WHERE deal_id = ? AND channel = 'return'
             AND status NOT IN ('cancelled','handed')
           ORDER BY datetime(created_at) DESC LIMIT 1`,
          [dealId]
        );
        return t ? buildReturnTaskBoard(t.id) : null;
      })()
    : null;
  return {
    ok: true,
    stock_doc_id: docId,
    serial: code,
    deal_id: dealId,
    deal: resolved,
    sale_price: price,
    sale_price_source: sale.source,
    amount,
    money_refund: money,
    product_unit: findUnitBySerial(code),
    order: returnBoard || undefined,
    action: 'return',
    action_label: 'Возврат принят · на складе',
  };
}

function markReturnTaskSerialReceived(serialRaw: string, dealIdRaw: string) {
  const code = String(serialRaw || '').trim();
  const dealId = String(dealIdRaw || '').trim();
  if (!code) return;
  const tasks = all<{ id: string }>(
    dealId
      ? `SELECT id FROM warehouse_tasks
         WHERE channel = 'return' AND deal_id = ?
           AND status NOT IN ('cancelled','handed')
         ORDER BY datetime(created_at) DESC LIMIT 5`
      : `SELECT id FROM warehouse_tasks
         WHERE channel = 'return' AND status NOT IN ('cancelled','handed')
         ORDER BY datetime(created_at) DESC LIMIT 10`,
    dealId ? [dealId] : []
  );
  for (const t of tasks) {
    const lines = all<{ id: string; dims_json: string }>(
      `SELECT id, IFNULL(dims_json,'{}') AS dims_json FROM warehouse_task_lines WHERE task_id = ?`,
      [t.id]
    );
    let hit = false;
    for (const l of lines) {
      let dims: { serials?: string[]; received_serials?: string[] } = {};
      try {
        dims = l.dims_json ? (JSON.parse(l.dims_json) as typeof dims) : {};
      } catch {
        continue;
      }
      const serials = (dims.serials || []).map((s) => String(s || '').trim());
      if (!serials.some((s) => s.toLowerCase() === code.toLowerCase())) continue;
      const received = Array.isArray(dims.received_serials)
        ? dims.received_serials.map((s) => String(s || '').trim())
        : [];
      if (!received.some((s) => s.toLowerCase() === code.toLowerCase())) {
        received.push(code);
      }
      dims.received_serials = received;
      run(`UPDATE warehouse_task_lines SET dims_json = ? WHERE id = ?`, [
        JSON.stringify(dims),
        l.id,
      ]);
      hit = true;
    }
    if (hit) {
      const board = buildReturnTaskBoard(t.id);
      if (board) {
        const pending = Number(board.units_pending) || 0;
        const receivedN = Number(board.units_received) || 0;
        if (pending === 0 && receivedN > 0) {
          run(
            `UPDATE warehouse_tasks
             SET status = 'handed', handed_at = datetime('now'), updated_at = datetime('now')
             WHERE id = ?`,
            [t.id]
          );
        } else if (receivedN > 0) {
          run(
            `UPDATE warehouse_tasks
             SET status = 'picking', picked_at = COALESCE(NULLIF(picked_at,''), datetime('now')),
                 updated_at = datetime('now')
             WHERE id = ?`,
            [t.id]
          );
        }
      }
      break;
    }
  }
}

// silence unused
void transferUnits;

function actorName(c: { get: (k: string) => unknown }): string {
  const a = c.get('actor') as Actor | undefined;
  return a?.name || a?.login || '';
}

export function mountSupplyChainRoutes(api: Hono): void {
  api.get('/supply/orders', (c) => {
    const status = c.req.query('status') || undefined;
    const q = c.req.query('q') || undefined;
    return c.json({ items: listSupplierOrders({ status, q }) });
  });

  api.get('/supply/orders/:id', (c) => {
    const row = buildInboundBoard(c.req.param('id')) || getSupplierOrder(c.req.param('id'));
    if (!row) return c.json({ error: 'not found' }, 404);
    return c.json(row);
  });

  api.get('/supply/inbound-board/:id', (c) => {
    const row = buildInboundBoard(c.req.param('id'));
    if (!row) return c.json({ error: 'not found' }, 404);
    return c.json(row);
  });

  api.get('/supply/inbound-task/:taskId', (c) => {
    const task = get<{
      id: string;
      stock_doc_id: string;
      channel: string;
      deal_id: string;
      number: string;
      buyer_name: string;
      city: string;
      status: string;
      comment: string;
      amount_locked: number;
    }>(
      `SELECT id, IFNULL(stock_doc_id,'') AS stock_doc_id, IFNULL(channel,'') AS channel,
              IFNULL(deal_id,'') AS deal_id, IFNULL(number,'') AS number,
              IFNULL(buyer_name,'') AS buyer_name, IFNULL(city,'') AS city,
              IFNULL(status,'') AS status, IFNULL(comment,'') AS comment,
              IFNULL(amount_locked,0) AS amount_locked
       FROM warehouse_tasks WHERE id = ?`,
      [c.req.param('taskId')]
    );
    if (!task) return c.json({ error: 'Задание не найдено' }, 404);
    if (task.channel === 'inbound') {
      if (!task.stock_doc_id) {
        return c.json({ error: 'Задание на оприходование не найдено' }, 404);
      }
      const board = buildInboundBoard(task.stock_doc_id);
      if (!board) return c.json({ error: 'Заказ поставщику не найден' }, 404);
      return c.json({ ...board, warehouse_task_id: task.id, task_kind: 'inbound' });
    }
    if (task.channel === 'return') {
      const board = buildReturnTaskBoard(task.id);
      if (!board) return c.json({ error: 'Не удалось собрать доску возврата' }, 404);
      return c.json({ ...board, warehouse_task_id: task.id, task_kind: 'return' });
    }
    return c.json({ error: 'Это не задание приёмки/возврата' }, 400);
  });

  api.post('/supply/orders', async (c) => {
    try {
      const body = await c.req.json<{
        counterparty_id: string;
        comment?: string;
        eta_date?: string;
        organization_id?: string;
        lines: Array<{ product_id: string; qty: number; price?: number; comment?: string }>;
      }>();
      const row = createSupplierOrder({
        ...body,
        created_by: actorName(c as { get: (k: string) => unknown }),
      });
      return c.json(row, 201);
    } catch (e) {
      return c.json({ error: e instanceof Error ? e.message : 'error' }, 400);
    }
  });

  api.post('/supply/orders/:id/status', async (c) => {
    try {
      const body = await c.req.json<{ status: SupplierOrderStatus; eta_date?: string; comment?: string }>();
      const row = setSupplierOrderStatus(c.req.param('id'), body.status, body);
      return c.json(row);
    } catch (e) {
      return c.json({ error: e instanceof Error ? e.message : 'error' }, 400);
    }
  });

  api.post('/supply/orders/:id/mark-paid', async (c) => {
    try {
      const body = (await c.req.json().catch(() => ({}))) as { eta_date?: string; comment?: string };
      const row = markSupplierOrderPaid(c.req.param('id'), body);
      return c.json(row);
    } catch (e) {
      return c.json({ error: e instanceof Error ? e.message : 'error' }, 400);
    }
  });

  api.get('/supply/orders/:id/labels', (c) => {
    try {
      return c.json(orderLabels(c.req.param('id')));
    } catch (e) {
      return c.json({ error: e instanceof Error ? e.message : 'error' }, 400);
    }
  });

  api.get('/supply/orders/:id/labels.html', (c) => {
    try {
      return c.html(labelsHtml(c.req.param('id')));
    } catch (e) {
      return c.json({ error: e instanceof Error ? e.message : 'error' }, 400);
    }
  });

  api.get('/supply/scan/:code', (c) => {
    try {
      return c.json(classifyScan(decodeURIComponent(c.req.param('code'))));
    } catch (e) {
      return c.json({ error: e instanceof Error ? e.message : 'error' }, 404);
    }
  });

  api.post('/supply/scan', async (c) => {
    try {
      const body = await c.req.json<{ code?: string; barcode?: string }>();
      return c.json(classifyScan(body.code || body.barcode || ''));
    } catch (e) {
      return c.json({ error: e instanceof Error ? e.message : 'error' }, 404);
    }
  });

  api.post('/supply/scan-apply', async (c) => {
    try {
      const body = await c.req.json<{ code?: string; serial?: string; comment?: string }>();
      const row = applyScan(body.code || body.serial || '', {
        comment: body.comment,
        actor_name: actorName(c as { get: (k: string) => unknown }),
      });
      return c.json(row);
    } catch (e) {
      return c.json({ error: e instanceof Error ? e.message : 'error' }, 400);
    }
  });

  api.post('/supply/receive-unit', async (c) => {
    try {
      const body = await c.req.json<{ serial?: string; barcode?: string }>();
      const row = receiveUnit(body.serial || body.barcode || '', actorName(c as { get: (k: string) => unknown }));
      return c.json(row);
    } catch (e) {
      return c.json({ error: e instanceof Error ? e.message : 'error' }, 400);
    }
  });

  api.post('/supply/receive-extra', async (c) => {
    try {
      const body = await c.req.json<{
        order_id: string;
        product_id: string;
        note?: string;
      }>();
      const row = receiveExtra({
        ...body,
        actor_name: actorName(c as { get: (k: string) => unknown }),
      });
      return c.json(row);
    } catch (e) {
      return c.json({ error: e instanceof Error ? e.message : 'error' }, 400);
    }
  });

  api.post('/supply/orders/:id/finish', (c) => {
    try {
      return c.json(finishReceipt(c.req.param('id')));
    } catch (e) {
      return c.json({ error: e instanceof Error ? e.message : 'error' }, 400);
    }
  });

  api.get('/supply/sto-requests', (c) => {
    return c.json({ items: listStoTransferRequests({ status: c.req.query('status') || undefined }) });
  });

  api.get('/supply/sto-requests/:id', (c) => {
    const row = getStoTransferRequest(c.req.param('id'));
    if (!row) return c.json({ error: 'not found' }, 404);
    return c.json(row);
  });

  api.post('/supply/sto-request', async (c) => {
    try {
      const body = await c.req.json<{
        deal_id?: string;
        warehouse_task_id?: string;
        comment?: string;
        lines: Array<{ product_id: string; qty?: number; serial?: string }>;
      }>();
      const row = createStoTransferRequest({
        ...body,
        created_by: actorName(c as { get: (k: string) => unknown }),
      });
      return c.json(row, 201);
    } catch (e) {
      return c.json({ error: e instanceof Error ? e.message : 'error' }, 400);
    }
  });

  api.post('/supply/transfer-to-sto', async (c) => {
    try {
      const body = await c.req.json<{
        serial: string;
        request_id?: string;
        deal_id?: string;
      }>();
      const row = transferSerialToSto({
        ...body,
        actor_name: actorName(c as { get: (k: string) => unknown }),
      });
      return c.json(row);
    } catch (e) {
      return c.json({ error: e instanceof Error ? e.message : 'error' }, 400);
    }
  });

  api.post('/supply/install-upd', async (c) => {
    try {
      const body = await c.req.json<{
        deal_id: string;
        serials: string[];
        organization_id?: string;
      }>();
      const row = installAndUpd({
        ...body,
        created_by: actorName(c as { get: (k: string) => unknown }),
      });
      return c.json(row);
    } catch (e) {
      return c.json({ error: e instanceof Error ? e.message : 'error' }, 400);
    }
  });

  api.post('/supply/client-return', async (c) => {
    try {
      const body = await c.req.json<{
        serial: string;
        comment: string;
        deal_id?: string;
      }>();
      const row = clientReturn({
        ...body,
        actor_name: actorName(c as { get: (k: string) => unknown }),
      });
      return c.json(row);
    } catch (e) {
      return c.json({ error: e instanceof Error ? e.message : 'error' }, 400);
    }
  });

  api.get('/supply/serial-deal', (c) => {
    const serial = (c.req.query('serial') || '').trim();
    if (!serial) return c.json({ error: 'serial required' }, 400);
    const deal = resolveBuyerDealFromSerial(serial);
    const unit = findUnitBySerial(serial) || null;
    return c.json({ serial, deal, product_unit: unit });
  });

  api.get('/supply/warehouses', (c) => {
    return c.json({
      main: mainWarehouseId(),
      sto: stoWarehouseId(),
      transit: transitWarehouseId(),
    });
  });
}
