/**
 * Э1 — задания склада (собрать / упаковать / отдать курьеру).
 */
import { all, get, run } from './db.js';
import { newGuid } from './ids.js';
import { getDeal, mapAmoShipChannel } from './deals.js';
import { paymentRequiredForShip, resolvePaymentScheme } from './deal-sale-rules.js';
import { cdekBarcodePublicUrl, cdekConfigured, loadCdekDealFromWidgetCache } from './cdek.js';
import { cdekWidgetUrl } from './ops.js';
import { nextDealDocNumber, logStoTransferEvent } from './deal-doc-numbers.js';
import {
  markDealStockReservesSold,
  releaseDealStockReserves,
} from './stock-reserve.js';
import {
  findNextInStockUnitForProduct,
  findUnitBySerial,
  productRequiresSerials,
} from './product-units.js';
import { mainWarehouseId, stoWarehouseId } from './supply-chain.js';
import { createDocument, isServiceProduct, postDocument } from './stock.js';
import {
  buildHandoffReserveMeta,
  buildHandoffShipMeta,
  ensureReserveHandoffComment,
} from './handoff-reserve.js';
import { catalogArticleOf } from './product-display-name.js';
import { ensureWarehouseCellsSchema } from './warehouse-cells.js';
import {
  getDealAlreadyMovedLines,
  buildHandoffRouteBrief,
  dealSkipLinesOnRoute,
  handoffRouteKindFromDoc,
  handoffLineDoneCell,
  runWithDealFlowCache,
  getPendingStockReturn,
  listPendingStockReturns,
  parseCellFromDocComment,
  handoffMainWarehouseIdForSite,
  handoffHoldWarehouseIdForSite,
  resolveHandoffSourceWarehouseId,
  isToStoHandoffComment,
  type HandoffRouteKind,
} from './deal-stock-flow.js';
import { actorAllowedCompanyIds, type StaffRights } from './staff.js';

function isCodChannel(deal: Record<string, unknown>, channel: string): boolean {
  const ch = String(channel || '').trim();
  if (ch === 'cdek_cod' || ch === 'avito_cod') return true;
  return resolvePaymentScheme(deal) === 'cod';
}

export const TASK_STATUSES = [
  'new', // новое
  'picking', // собирают
  'packed', // упаковано
  'ready', // к выдаче
  'handed', // передано / сделано
  'cancelled', // не сделано (с block_reason)
] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const SHIP_CHANNELS = [
  'cdek_prepaid',
  'cdek_cod',
  'avito_cod',
  'dellin',
  'pek',
  'bus',
  'pickup',
  'own_courier',
  'ozon',
  'transfer',
  'inbound',
  'sto_parts',
  'production_send',
  'production_receive',
  'other',
] as const;

const CHANNEL_LABELS: Record<string, string> = {
  cdek_prepaid: 'СДЭК предоплата',
  cdek_cod: 'СДЭК наложка',
  avito_cod: 'Авито доставка',
  dellin: 'Деловые Линии',
  pek: 'ПЭК',
  bus: 'Автобус',
  pickup: 'Самовывоз',
  own_courier: 'Свой курьер',
  ozon: 'Ozon',
  transfer: 'Перемещение',
  inbound: 'Оприходование',
  sto_parts: 'Перемещение деталей',
  production_send: 'На производство',
  production_receive: 'Приём с производства',
  other: 'Прочее',
};

export function channelLabel(ch: string): string {
  return CHANNEL_LABELS[ch] || ch || '—';
}

export function statusLabel(st: string): string {
  const map: Record<string, string> = {
    new: 'Новое',
    picking: 'Сборка',
    packed: 'Упаковано',
    ready: 'К выдаче',
    handed: 'Сделано',
    cancelled: 'Не сделано',
  };
  return map[st] || st;
}

export function logTask(taskId: string, event: string, actorId?: string, payload?: Record<string, unknown>) {
  run(
    `INSERT INTO warehouse_task_events (id, task_id, event, actor_id, payload_json, created_at)
     VALUES (?, ?, ?, ?, ?, datetime('now'))`,
    [newGuid(), taskId, event, actorId || '', JSON.stringify(payload || {})]
  );
}

export function dealIsPaid(dealId: string): boolean {
  const paid = get<{ c: number }>(
    `SELECT COUNT(*) AS c FROM deal_payments
     WHERE deal_id = ? AND status IN ('paid','confirmed','success','active')`,
    [dealId]
  )?.c;
  if (paid && paid > 0) return true;
  // fallback: deal field if synced
  const d = get<{ payment_status?: string; paid?: number }>(
    `SELECT payment_status, paid FROM crm_deals WHERE id = ?`,
    [dealId]
  ) as { payment_status?: string; paid?: number } | undefined;
  if (!d) return false;
  if (Number(d.paid) === 1) return true;
  const ps = String(d.payment_status || '').toLowerCase();
  return ['paid', 'оплачен', 'оплачено', 'success'].includes(ps);
}

export function canHandToCourier(task: { channel: string; deal_id: string; payment_required: number }): boolean {
  const ch = String(task.channel || '');
  // постоплата / самовывоз / внутреннее перемещение / оприходование — можно без предоплаты
  if (
    ch === 'cdek_cod' ||
    ch === 'pickup' ||
    ch === 'bus' ||
    ch === 'transfer' ||
    ch === 'inbound'
  )
    return true;
  if (!Number(task.payment_required)) return true;
  return dealIsPaid(task.deal_id);
}

export function listTasks(opts: {
  status?: string;
  q?: string;
  limit?: number;
}) {
  const where: string[] = [];
  const params: Array<string | number> = [];
  if (opts.status) {
    where.push('t.status = ?');
    params.push(opts.status);
  } else {
    where.push(`t.status != 'cancelled'`);
  }
  if (opts.q?.trim()) {
    const like = `%${opts.q.trim()}%`;
    where.push(
      `(t.number LIKE ? OR t.deal_id LIKE ? OR IFNULL(t.city,'') LIKE ? OR IFNULL(t.buyer_name,'') LIKE ? OR IFNULL(t.barcode,'') LIKE ? OR IFNULL(t.comment,'') LIKE ? OR IFNULL(t.stock_doc_id,'') LIKE ?)`
    );
    params.push(like, like, like, like, like, like, like);
  }
  const limit = Math.min(200, Math.max(1, opts.limit || 50));
  params.push(limit);
  return all(
    `SELECT t.*,
       (SELECT COUNT(*) FROM warehouse_task_lines l WHERE l.task_id = t.id) AS lines_count
     FROM warehouse_tasks t
     ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
     ORDER BY
       CASE t.status
         WHEN 'ready' THEN 0 WHEN 'packed' THEN 1 WHEN 'picking' THEN 2 WHEN 'new' THEN 3
         WHEN 'handed' THEN 8 ELSE 9 END,
       datetime(t.created_at) ASC
     LIMIT ?`,
    params
  );
}

export function getTask(id: string): Record<string, unknown> | null {
  const task = get('SELECT * FROM warehouse_tasks WHERE id = ?', [id]) as
    | Record<string, unknown>
    | undefined;
  if (!task) return null;
  const rawLines = all(
    `SELECT * FROM warehouse_task_lines WHERE task_id = ? ORDER BY line_no, name`,
    [id]
  ) as Array<Record<string, unknown>>;
  const lines = enrichTaskLines(rawLines);
  const events = all(
    `SELECT * FROM warehouse_task_events WHERE task_id = ? ORDER BY datetime(created_at) DESC LIMIT 30`,
    [id]
  );
  const dealId = String(task.deal_id || '');
  const paid = dealId ? dealIsPaid(dealId) : true;
  const dealCtx = dealId ? dealPickContext(dealId) : null;
  const deal: Record<string, unknown> | null =
    dealCtx && !dealCtx.missing
      ? {
          ...dealCtx,
          paid,
          payment_label: paid ? 'Оплачено' : 'Не оплачено',
          is_paid: paid,
        }
      : null;
  let sto_request: Record<string, unknown> | null = null;
  if (String(task.channel) === 'sto_parts') {
    const reqId = String(task.stock_doc_id || task.track_number || '').trim();
    if (reqId) {
      sto_request =
        (get(
          `SELECT id, number, source, status, needs_rebrand, rebrand_done, approve_status,
                  deal_id, comment, amount, courier_status, warehouse_task_id,
                  IFNULL(dest_warehouse_id,'') AS dest_warehouse_id,
                  IFNULL(courier_drop_warehouse_id,'') AS courier_drop_warehouse_id
           FROM sto_transfer_requests WHERE id = ?`,
          [reqId]
        ) as Record<string, unknown> | undefined) || null;
    }
  }
  const rawBuyer = String(task.buyer_name || '').trim();
  const buyerLooksLikeRoute =
    /→|⇒/.test(rawBuyer) ||
    /производство/i.test(rawBuyer) ||
    rawBuyer === 'СТО' ||
    rawBuyer === 'Разбор' ||
    rawBuyer === 'Сборка';
  const dealBuyer = deal ? String(deal.buyer_name || '').trim() : '';
  const dealTitle = deal
    ? String(deal.title || deal.name || '').trim()
    : '';
  return {
    ...task,
    lines,
    events,
    channel_label:
      String(task.channel) === 'sto_parts'
        ? stoPartsChannelLabel({
            comment: String(task.comment || ''),
            city: String(task.city || ''),
            sto_request,
          })
        : channelLabel(String(task.channel)),
    status_label: statusLabel(String(task.status)),
    is_paid: paid,
    can_hand: canHandToCourier({
      channel: String(task.channel),
      deal_id: dealId,
      payment_required: Number(task.payment_required),
    }),
    cdek_widget_url: dealId ? cdekWidgetUrl(dealId) : '',
    cdek_native: cdekConfigured(),
    sto_request,
    deal,
    title: dealTitle,
    name: deal ? String(deal.name || '').trim() : '',
    ...buildPickRouteInfo({
      channel: String(task.channel || ''),
      comment: String(task.comment || ''),
      deal_id: dealId,
      track_number: String(task.track_number || ''),
      stock_doc_id: String(task.stock_doc_id || ''),
      sto_request,
    }),
    buyer_name: dealBuyer || (!buyerLooksLikeRoute ? rawBuyer : '') || dealTitle || rawBuyer,
    responsible_name: deal ? String(deal.responsible_name || '') : '',
    buyer_phone: deal ? String(deal.buyer_phone || '') : '',
    buyer_email: deal ? String(deal.buyer_email || '') : '',
    amo_channel: deal
      ? String(deal.amo_channel || '')
      : String((task as { amo_channel?: string }).amo_channel || ''),
    amo_shipment: deal
      ? String(deal.amo_shipment || '')
      : String((task as { amo_shipment?: string }).amo_shipment || ''),
    amo_payment_type: deal ? String(deal.amo_payment_type || '') : '',
    payment_label: deal ? String(deal.payment_label || '') : paid ? 'Оплачено' : 'Не оплачено',
  };
}

/** Штрихкод / артикул / номер (марка) на строках задания — для экрана сборки. */
function enrichTaskLines(lines: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
  return lines.map((l) => {
    const productId = String(l.product_id || '').trim();
    let barcode = '';
    let code = '';
    let sku = String(l.sku || '').trim();
    let name = String(l.name || '').trim();
    let serialTracked = false;
    if (productId) {
      const p = get<{
        sku: string;
        name: string;
        barcode: string;
        code: string;
        gtin: string;
        serial_tracked: number;
      }>(
        `SELECT IFNULL(sku,'') AS sku, IFNULL(name,'') AS name,
                IFNULL(barcode,'') AS barcode, IFNULL(code,'') AS code,
                IFNULL(gtin,'') AS gtin, IFNULL(serial_tracked,0) AS serial_tracked
         FROM products WHERE id = ?`,
        [productId]
      );
      if (p) {
        if (!sku) sku = String(p.sku || '').trim();
        if (!name) name = String(p.name || '').trim();
        barcode = String(p.barcode || p.gtin || '').trim();
        code = String(p.code || '').trim();
        serialTracked = Number(p.serial_tracked) === 1;
      }
    }
    let serials: string[] = [];
    try {
      const dims =
        typeof l.dims_json === 'string'
          ? JSON.parse(String(l.dims_json || '{}') || '{}')
          : l.dims_json && typeof l.dims_json === 'object'
            ? l.dims_json
            : {};
      if (Array.isArray((dims as { serials?: unknown }).serials)) {
        serials = (dims as { serials: unknown[] }).serials
          .map((s) => String(s || '').trim())
          .filter(Boolean);
      }
    } catch {
      /* ignore */
    }
    const numberOnItem = serials.length ? serials.join(', ') : '';
    const unitMeta: Array<{
      serial: string;
      supplier_name: string;
      in_doc_number: string;
      in_doc_id: string;
      in_doc_date: string;
    }> = [];
    for (const serial of serials) {
      const u = get<{
        supplier_name: string;
        in_doc_number: string;
        in_doc_id: string;
        in_doc_date: string;
      }>(
        `SELECT IFNULL(cp.name,'') AS supplier_name,
                IFNULL(d.number,'') AS in_doc_number,
                IFNULL(u.in_doc_id,'') AS in_doc_id,
                IFNULL(substr(d.doc_date,1,10),'') AS in_doc_date
         FROM product_units u
         LEFT JOIN stock_docs d ON d.id = u.in_doc_id
         LEFT JOIN counterparties cp ON cp.id = d.counterparty_id
         WHERE lower(u.serial) = lower(?)
         LIMIT 1`,
        [serial]
      );
      unitMeta.push({
        serial,
        supplier_name: String(u?.supplier_name || '').trim() || '—',
        in_doc_number: String(u?.in_doc_number || '').trim() || '—',
        in_doc_id: String(u?.in_doc_id || '').trim(),
        in_doc_date: String(u?.in_doc_date || '').trim(),
      });
    }
    return {
      ...l,
      sku,
      name,
      barcode,
      code,
      serials,
      serial_tracked: serialTracked ? 1 : 0,
      item_number: numberOnItem,
      scan_code: barcode || sku || code || '',
      units: unitMeta,
      picked: serials.length,
      need: Math.max(0, Math.ceil(Number(l.qty) || 0)),
    };
  });
}

function nextTaskNumber(dealId?: string): string {
  const byDeal = nextDealDocNumber('S', String(dealId || ''));
  if (byDeal) return byDeal;
  const n =
    get<{ c: number }>(`SELECT COUNT(*) AS c FROM warehouse_tasks`)?.c ?? 0;
  return `WS-${String(n + 1).padStart(6, '0')}`;
}

export function createTaskFromDeal(input: {
  deal_id: string;
  channel?: string;
  payment_required?: boolean;
  comment?: string;
  actor_id?: string;
}) {
  const deal = getDeal(input.deal_id) as Record<string, unknown> | null;
  if (!deal) throw new Error('Сделка не найдена');
  const existing = get(
    `SELECT id FROM warehouse_tasks WHERE deal_id = ? AND status NOT IN ('cancelled','handed') LIMIT 1`,
    [input.deal_id]
  );
  if (existing) throw new Error('По сделке уже есть активное задание склада');

  const items = (deal.items as Array<Record<string, unknown>>) || [];
  const id = newGuid();
  const number = nextTaskNumber(input.deal_id);
  const barcode = number.replace(/-/g, '');
  const channel = String(
    input.channel ||
      deal.ship_channel ||
      mapAmoShipChannel({
        amo_channel: String(deal.amo_channel || ''),
        amo_shipment: String(deal.amo_shipment || ''),
        ship_channel: '',
        name: String(deal.name || ''),
        department: String(deal.department || ''),
      }) ||
      'cdek_prepaid'
  ).trim() || 'cdek_prepaid';
  const amount = Number(deal.price || deal.amount || 0) || 0;
  const paymentRequired =
    input.payment_required !== undefined
      ? input.payment_required
      : paymentRequiredForShip(deal as Record<string, unknown>);

  // СДЭК наложка: без WAIT-PAY — задание складу, потом перемещение основной → доставка
  run(
    `INSERT INTO warehouse_tasks (
      id, number, barcode, deal_id, status, channel, city, buyer_name, amount_locked,
      payment_required, track_number, comment, created_at, updated_at
    ) VALUES (?, ?, ?, ?, 'new', ?, ?, ?, ?, ?, '', ?, datetime('now'), datetime('now'))`,
    [
      id,
      number,
      barcode,
      input.deal_id,
      channel,
      String(deal.city || deal.delivery_city || '').trim(),
      String(deal.contact_name || deal.name || deal.buyer_name || '').trim(),
      amount,
      paymentRequired ? 1 : 0,
      String(input.comment || '').trim(),
    ]
  );

  let lineNo = 1;
  for (const it of items) {
    run(
      `INSERT INTO warehouse_task_lines (
        id, task_id, line_no, product_id, sku, name, qty, weight_g, dims_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        newGuid(),
        id,
        lineNo++,
        String(it.product_guid || it.product_id || ''),
        String(it.sku || ''),
        String(it.name || ''),
        Number(it.quantity || it.qty || 1) || 1,
        Number(it.weight_g || 0) || 0,
        JSON.stringify({
          w: it.width_cm || null,
          h: it.height_cm || null,
          l: it.length_cm || null,
        }),
      ]
    );
  }

  logTask(id, 'task.created', input.actor_id, {
    deal_id: input.deal_id,
    number,
  });
  try {
    run(
      `UPDATE crm_deals SET amount_locked = 1, amount_locked_at = datetime('now') WHERE id = ?`,
      [input.deal_id]
    );
  } catch {
    /* колонка появится в migrate */
  }
  return getTask(id);
}

/** Задание кладовщику по требованию перемещения (остатки → другой склад). */
export function createTaskFromTransfer(input: {
  stock_doc_id: string;
  stock_doc_number?: string;
  from_label: string;
  to_label: string;
  comment: string;
  actor_id?: string;
  deal_id?: string;
  lines: Array<{ product_id?: string; qty?: number; sku?: string; name?: string }>;
}) {
  const stockDocId = String(input.stock_doc_id || '').trim();
  if (!stockDocId) throw new Error('Нет документа перемещения');
  const comment = String(input.comment || '').trim();
  if (!comment) throw new Error('Укажите комментарий к заказу на перемещение');

  const existing = get(
    `SELECT id FROM warehouse_tasks
     WHERE stock_doc_id = ? AND status NOT IN ('cancelled','handed') LIMIT 1`,
    [stockDocId]
  );
  if (existing) return getTask(String((existing as { id: string }).id));

  const fromLabel = String(input.from_label || '').trim() || 'склад';
  const toLabel = String(input.to_label || '').trim() || 'склад';
  const docNum = String(input.stock_doc_number || '').trim();
  const dealId = String(input.deal_id || '').trim();
  const id = newGuid();
  const number = nextTaskNumber(dealId);
  const barcode = number.replace(/-/g, '');
  const route = `${fromLabel} → ${toLabel}`;

  run(
    `INSERT INTO warehouse_tasks (
      id, number, barcode, deal_id, status, channel, city, buyer_name, amount_locked,
      payment_required, track_number, comment, stock_doc_id, created_at, updated_at
    ) VALUES (?, ?, ?, ?, 'new', 'transfer', ?, ?, 0, 0, '', ?, ?, datetime('now'), datetime('now'))`,
    [id, number, barcode, dealId, fromLabel, route, comment, stockDocId]
  );

  let lineNo = 1;
  for (const it of input.lines || []) {
    const productId = String(it.product_id || '').trim();
    const qty = Number(it.qty) || 0;
    if (!productId || !(qty > 0)) continue;
    let sku = String(it.sku || '').trim();
    let name = String(it.name || '').trim();
    if (!sku || !name) {
      const p = get<{ sku: string; name: string }>(
        `SELECT IFNULL(sku,'') AS sku, IFNULL(name,'') AS name FROM products WHERE id = ?`,
        [productId]
      );
      if (p) {
        if (!sku) sku = p.sku;
        if (!name) name = p.name;
      }
    }
    run(
      `INSERT INTO warehouse_task_lines (
        id, task_id, line_no, product_id, sku, name, qty, weight_g, dims_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, '{}')`,
      [newGuid(), id, lineNo++, productId, sku, name || productId, qty]
    );
  }

  logTask(id, 'task.created', input.actor_id, {
    stock_doc_id: stockDocId,
    stock_doc_number: docNum,
    number,
    channel: 'transfer',
  });
  return getTask(id);
}

/** Очередь складу по документу перемещения деталей (СТО / курьер / отправка). */
export function createTaskFromStoParts(input: {
  sto_request_id: string;
  sto_request_number?: string;
  deal_id?: string;
  comment: string;
  actor_id?: string;
  needs_rebrand?: boolean;
  dest_label?: string;
  dest_code?: string;
  lines: Array<{ product_id?: string; qty?: number; sku?: string; name?: string }>;
}) {
  const reqId = String(input.sto_request_id || '').trim();
  if (!reqId) throw new Error('Нет задания на СТО');
  const existing = get(
    `SELECT id FROM warehouse_tasks
     WHERE channel = 'sto_parts' AND comment LIKE ?
       AND status NOT IN ('cancelled','handed')
     LIMIT 1`,
    [`%${String(input.sto_request_number || reqId).slice(0, 24)}%`]
  );
  if (existing) return getTask(String((existing as { id: string }).id));

  const id = newGuid();
  const dealId = String(input.deal_id || '').trim();
  // перемещение = СXXXX; складское задание по нему — тот же номер
  const number =
    String(input.sto_request_number || '').trim() || nextTaskNumber(dealId);
  const barcode = number.replace(/-/g, '');
  const comment = String(input.comment || '').trim() || `Перемещение ${number}`;
  const destCode = String(input.dest_code || '').trim().toUpperCase();
  const destLabel = String(input.dest_label || '').trim();
  let buyerName = '';
  let city = '';
  if (dealId) {
    const d = get<{ buyer_name: string; company_name: string; city: string }>(
      `SELECT IFNULL(buyer_name,'') AS buyer_name,
              IFNULL(company_name,'') AS company_name,
              IFNULL(amo_shipment,'') AS city
       FROM crm_deals WHERE id = ?`,
      [dealId]
    );
    // city колонки может не быть — берём способ отправки как подсказку маршрута
    buyerName = String(d?.buyer_name || d?.company_name || '').trim();
    city = String(d?.city || '').trim();
  }
  if (!buyerName) buyerName = destLabel || 'Перемещение';
  if (input.needs_rebrand) city = 'ребрендинг';
  else if (!city) {
    if (destCode === 'STO' || /сто/i.test(destLabel)) city = 'СТО';
    else if (destCode === 'COURIER' || /курьер/i.test(destLabel)) city = 'Курьер';
    else city = destLabel || 'склад';
  }

  run(
    `INSERT INTO warehouse_tasks (
      id, number, barcode, deal_id, status, channel, city, buyer_name, amount_locked,
      payment_required, track_number, comment, stock_doc_id, created_at, updated_at
    ) VALUES (?, ?, ?, ?, 'new', 'sto_parts', ?, ?, 0, 0, ?, ?, ?, datetime('now'), datetime('now'))`,
    [id, number, barcode, dealId, city, buyerName, reqId, comment, reqId]
  );

  let lineNo = 1;
  for (const it of input.lines || []) {
    const productId = String(it.product_id || '').trim();
    const qty = Number(it.qty) || 0;
    if (!productId || !(qty > 0)) continue;
    let sku = String(it.sku || '').trim();
    let name = String(it.name || '').trim();
    if (!sku || !name) {
      const p = get<{ sku: string; name: string }>(
        `SELECT IFNULL(sku,'') AS sku, IFNULL(name,'') AS name FROM products WHERE id = ?`,
        [productId]
      );
      if (p) {
        if (!sku) sku = p.sku;
        if (!name) name = p.name;
      }
    }
    run(
      `INSERT INTO warehouse_task_lines (
        id, task_id, line_no, product_id, sku, name, qty, weight_g, dims_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, '{}')`,
      [newGuid(), id, lineNo++, productId, sku, name || productId, qty]
    );
  }

  logTask(id, 'task.created', input.actor_id, {
    sto_request_id: reqId,
    number,
    channel: 'sto_parts',
    needs_rebrand: !!input.needs_rebrand,
    dest_code: destCode,
  });
  if (reqId) {
    const dest = String(destLabel || destCode || 'склад').trim() || 'склад';
    logStoTransferEvent({
      request_id: reqId,
      event: 'warehouse_task',
      summary: `${number} · Основной → ${dest}`,
      actor_id: input.actor_id,
      payload: { task_id: id, number, dest_code: destCode, dest_label: destLabel },
    });
  }
  return getTask(id);
}

/** Требование кладовщику: оприходовать заказ поставщику (скан марок на складе). */
export function createTaskFromInboundReceive(input: {
  supplier_order_id: string;
  supplier_order_number?: string;
  supplier_name?: string;
  warehouse_id?: string;
  warehouse_name?: string;
  comment?: string;
  actor_id?: string;
  lines: Array<{
    product_id?: string;
    qty?: number;
    sku?: string;
    name?: string;
    price?: number;
    serials?: string[];
    /** Применимость партии для строки (не каталог номенклатуры). */
    apps?: unknown;
    /** Применимость по конкретной марке: { serial: apps }. */
    serial_apps?: Record<string, unknown>;
  }>;
}) {
  const orderId = String(input.supplier_order_id || '').trim();
  if (!orderId) throw new Error('Нет заказа поставщику');
  const linesIn = Array.isArray(input.lines) ? input.lines : [];
  if (!linesIn.length) throw new Error('Нет строк для оприходования');

  const existing = get(
    `SELECT id FROM warehouse_tasks
     WHERE stock_doc_id = ? AND channel = 'inbound'
       AND status NOT IN ('cancelled','handed')
     LIMIT 1`,
    [orderId]
  );
  if (existing) return getTask(String((existing as { id: string }).id));

  const orderNum = String(input.supplier_order_number || '').trim();
  const supplier = String(input.supplier_name || '').trim() || 'поставщик';
  const whName = String(input.warehouse_name || '').trim() || 'склад';
  const userComment = String(input.comment || '').trim();
  const comment =
    userComment ||
    `Оприходование по заказу ${orderNum || orderId.slice(0, 8)} · ${supplier} → ${whName}`;

  const id = newGuid();
  const number = nextTaskNumber();
  const barcode = number.replace(/-/g, '');

  run(
    `INSERT INTO warehouse_tasks (
      id, number, barcode, deal_id, status, channel, city, buyer_name, amount_locked,
      payment_required, track_number, comment, stock_doc_id, created_at, updated_at
    ) VALUES (?, ?, ?, '', 'new', 'inbound', ?, ?, 0, 0, '', ?, ?, datetime('now'), datetime('now'))`,
    [id, number, barcode, whName, supplier, comment, orderId]
  );

  let lineNo = 1;
  for (const it of linesIn) {
    const productId = String(it.product_id || '').trim();
    const serials = Array.isArray(it.serials)
      ? it.serials.map((s) => String(s || '').trim()).filter(Boolean)
      : [];
    const qty = serials.length || Number(it.qty) || 0;
    if (!productId || !(qty > 0)) continue;
    let sku = String(it.sku || '').trim();
    let name = String(it.name || '').trim();
    if (!sku || !name) {
      const p = get<{ sku: string; name: string }>(
        `SELECT IFNULL(sku,'') AS sku, IFNULL(name,'') AS name FROM products WHERE id = ?`,
        [productId]
      );
      if (p) {
        if (!sku) sku = p.sku;
        if (!name) name = p.name;
      }
    }
    const dims = {
      serials,
      price: Number(it.price) || 0,
      warehouse_id: String(input.warehouse_id || '').trim(),
      supplier_order_id: orderId,
      apps: it.apps ?? null,
      serial_apps:
        it.serial_apps && typeof it.serial_apps === 'object' ? it.serial_apps : null,
    };
    run(
      `INSERT INTO warehouse_task_lines (
        id, task_id, line_no, product_id, sku, name, qty, weight_g, dims_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)`,
      [newGuid(), id, lineNo++, productId, sku, name || productId, qty, JSON.stringify(dims)]
    );
  }
  if (lineNo === 1) {
    run(`DELETE FROM warehouse_tasks WHERE id = ?`, [id]);
    throw new Error('Нет валидных строк для требования');
  }

  logTask(id, 'task.created', input.actor_id, {
    supplier_order_id: orderId,
    supplier_order_number: orderNum,
    warehouse_id: input.warehouse_id || '',
    number,
    channel: 'inbound',
  });
  return getTask(id);
}

/** Требование кладовщику: принять возврат от клиента (частично или полностью по сделке). */
export function createTaskFromReturnReceive(input: {
  /** Основание — расходная накладная. */
  out_doc_id: string;
  out_doc_number?: string;
  /** Сделка из расходной (если была) — для ТВД / Amo. */
  deal_id?: string;
  deal_number?: string;
  buyer_name?: string;
  warehouse_id?: string;
  warehouse_name?: string;
  comment?: string;
  actor_id?: string;
  lines: Array<{
    product_id?: string;
    qty?: number;
    sku?: string;
    name?: string;
    price?: number;
    serials?: string[];
  }>;
}) {
  const outDocId = String(input.out_doc_id || '').trim();
  if (!outDocId) throw new Error('Нет расходной накладной');
  const linesIn = Array.isArray(input.lines) ? input.lines : [];
  if (!linesIn.length) throw new Error('Выберите товары для возврата');

  const existing = get(
    `SELECT id FROM warehouse_tasks
     WHERE stock_doc_id = ? AND channel = 'return'
       AND status NOT IN ('cancelled','handed')
     LIMIT 1`,
    [outDocId]
  );
  if (existing) return getTask(String((existing as { id: string }).id));

  const outNum = String(input.out_doc_number || '').trim();
  const dealId = String(input.deal_id || '').trim();
  const dealNum = String(input.deal_number || '').trim();
  const buyer = String(input.buyer_name || '').trim() || 'покупатель';
  const whName = String(input.warehouse_name || '').trim() || 'склад';
  const userComment = String(input.comment || '').trim();
  const comment =
    userComment ||
    `Возврат от клиента · расходная ${outNum || outDocId.slice(0, 8)} · ${buyer} → ${whName}`;

  const id = newGuid();
  const number = nextTaskNumber(dealId);
  const barcode = number.replace(/-/g, '');

  run(
    `INSERT INTO warehouse_tasks (
      id, number, barcode, deal_id, status, channel, city, buyer_name, amount_locked,
      payment_required, track_number, comment, stock_doc_id, created_at, updated_at
    ) VALUES (?, ?, ?, ?, 'new', 'return', ?, ?, 0, 0, '', ?, ?, datetime('now'), datetime('now'))`,
    [id, number, barcode, dealId, whName, buyer, comment, outDocId]
  );

  let lineNo = 1;
  let amountLocked = 0;
  for (const it of linesIn) {
    const productId = String(it.product_id || '').trim();
    const serials = Array.isArray(it.serials)
      ? it.serials.map((s) => String(s || '').trim()).filter(Boolean)
      : [];
    const qty = serials.length || Number(it.qty) || 0;
    if (!productId || !(qty > 0)) continue;
    let sku = String(it.sku || '').trim();
    let name = String(it.name || '').trim();
    if (!sku || !name) {
      const p = get<{ sku: string; name: string }>(
        `SELECT IFNULL(sku,'') AS sku, IFNULL(name,'') AS name FROM products WHERE id = ?`,
        [productId]
      );
      if (p) {
        if (!sku) sku = p.sku;
        if (!name) name = p.name;
      }
    }
    const price = Math.max(0, Number(it.price) || 0);
    amountLocked += price * qty;
    const dims = {
      kind: 'return',
      serials,
      price,
      warehouse_id: String(input.warehouse_id || '').trim(),
      out_doc_id: outDocId,
      deal_id: dealId,
      received_serials: [] as string[],
    };
    run(
      `INSERT INTO warehouse_task_lines (
        id, task_id, line_no, product_id, sku, name, qty, weight_g, dims_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)`,
      [newGuid(), id, lineNo++, productId, sku, name || productId, qty, JSON.stringify(dims)]
    );
  }
  if (lineNo === 1) {
    run(`DELETE FROM warehouse_tasks WHERE id = ?`, [id]);
    throw new Error('Нет валидных строк для возврата');
  }
  run(`UPDATE warehouse_tasks SET amount_locked = ? WHERE id = ?`, [
    Math.round(amountLocked),
    id,
  ]);

  logTask(id, 'task.created', input.actor_id, {
    out_doc_id: outDocId,
    out_doc_number: outNum,
    deal_id: dealId,
    deal_number: dealNum,
    warehouse_id: input.warehouse_id || '',
    number,
    channel: 'return',
    amount: amountLocked,
  });
  return getTask(id);
}

export function setTaskStatus(input: {
  id: string;
  status: TaskStatus;
  actor_id?: string;
  track_number?: string;
  block_reason?: string;
}) {
  const task = get('SELECT * FROM warehouse_tasks WHERE id = ?', [input.id]) as
    | {
        id: string;
        status: string;
        channel: string;
        deal_id: string;
        payment_required: number;
      }
    | undefined;
  if (!task) throw new Error('Задание не найдено');
  if (!TASK_STATUSES.includes(input.status)) throw new Error('Неверный статус');

  if (input.status === 'handed' || input.status === 'ready') {
    if (!canHandToCourier(task) && input.status === 'handed') {
      throw new Error('Нельзя отдать курьеру: заказ не оплачен (шлюз оплата→отгрузка)');
    }
  }

  const track = String(input.track_number || '').trim();
  if (track) {
    run(`UPDATE warehouse_tasks SET track_number = ?, updated_at = datetime('now') WHERE id = ?`, [
      track,
      input.id,
    ]);
  }

  const reason = String(input.block_reason || '').trim();
  if (input.status === 'cancelled') {
    if (!reason) throw new Error('Укажите причину (почему не сделано)');
    run(
      `UPDATE warehouse_tasks SET status = ?, block_reason = ?, updated_at = datetime('now') WHERE id = ?`,
      [input.status, reason, input.id]
    );
    const dealId = String(task.deal_id || '').trim();
    if (dealId && isCodChannel({ ship_channel: task.channel }, task.channel)) {
      try {
        releaseDealStockReserves(dealId, `задание ${input.id} cancelled`);
      } catch (e) {
        console.warn('[warehouse-tasks] release COD reserve failed', e);
      }
    }
  } else {
    run(`UPDATE warehouse_tasks SET status = ?, updated_at = datetime('now') WHERE id = ?`, [
      input.status,
      input.id,
    ]);
    if (reason) {
      run(`UPDATE warehouse_tasks SET block_reason = ?, updated_at = datetime('now') WHERE id = ?`, [
        reason,
        input.id,
      ]);
    }
  }

  // КПД: метки этапов (не перезаписываем уже проставленные)
  const stampOnce = (col: 'picked_at' | 'packed_at' | 'ready_at' | 'handed_at') => {
    run(
      `UPDATE warehouse_tasks SET ${col} = datetime('now'), updated_at = datetime('now')
       WHERE id = ? AND IFNULL(${col}, '') = ''`,
      [input.id]
    );
  };
  if (input.status === 'picking') stampOnce('picked_at');
  if (input.status === 'packed') {
    stampOnce('picked_at');
    stampOnce('packed_at');
  }
  if (input.status === 'ready') {
    stampOnce('picked_at');
    stampOnce('packed_at');
    stampOnce('ready_at');
  }
  if (input.status === 'handed') {
    stampOnce('picked_at');
    stampOnce('packed_at');
    stampOnce('ready_at');
    stampOnce('handed_at');
    const dealId = String(task.deal_id || '').trim();
    if (dealId) {
      try {
        markDealStockReservesSold(dealId);
      } catch (e) {
        console.warn('[warehouse-tasks] mark COD reserve sold failed', e);
      }
    }
    // Доход / Sheets / income_mirror — не пишем: в таблицы льёт 1С, дубли не нужны.
  }
  logTask(input.id, `status.${input.status}`, input.actor_id, { track, block_reason: reason || undefined });
  return getTask(input.id);
}

/** Тип работы для группировки на /pick (из status + channel, отдельной колонки нет). */
export type PickType =
  | 'production'
  | 'pick'
  | 'pack'
  | 'hand'
  | 'cdek'
  | 'pickup'
  | 'courier'
  | 'return'
  | 'transfer'
  | 'inbound'
  | 'sto'
  | 'other';

export const PICK_TYPE_ORDER: PickType[] = [
  'production',
  'sto',
  'inbound',
  'hand',
  'cdek',
  'transfer',
  'pack',
  'pick',
  'pickup',
  'courier',
  'return',
  'other',
];

export function pickTypeLabel(t: string): string {
  const map: Record<string, string> = {
    production: 'На производство',
    pick: 'Сборка',
    pack: 'Упаковка',
    hand: 'Выдача',
    cdek: 'СДЭК',
    pickup: 'Самовывоз',
    courier: 'Свой курьер',
    return: 'Возврат',
    transfer: 'Перемещение',
    inbound: 'Оприходование',
    sto: 'Перемещение деталей',
    other: 'Прочее',
  };
  return map[t] || t;
}

/** Подпись канала sto_parts с учётом куда едет (СТО / курьер / отправка). */
export function stoPartsChannelLabel(task: {
  comment?: string;
  city?: string;
  sto_request?: { dest_warehouse_id?: string } | null;
}): string {
  const comment = String(task.comment || '').toLowerCase();
  const city = String(task.city || '').toLowerCase();
  if (/куда:\s*склад курьера|курьер→|на отправк/i.test(comment) || city === 'курьер') {
    return 'Перемещение · курьер (отправка)';
  }
  if (/куда:\s*автосервис|куда:\s*сто|\bна сто\b/i.test(comment) || city === 'сто') {
    return 'Перемещение · СТО';
  }
  const destId = String(task.sto_request?.dest_warehouse_id || '').trim();
  if (destId) {
    const wh = get<{ name: string; code: string }>(
      `SELECT IFNULL(name,'') AS name, IFNULL(code,'') AS code FROM warehouses WHERE id = ?`,
      [destId]
    );
    const code = String(wh?.code || '').toUpperCase();
    if (code === 'COURIER' || /курьер/i.test(String(wh?.name || ''))) {
      return 'Перемещение · курьер (отправка)';
    }
    if (code === 'STO' || /сто/i.test(String(wh?.name || ''))) {
      return 'Перемещение · СТО';
    }
    if (wh?.name) return `Перемещение · ${wh.name}`;
  }
  return CHANNEL_LABELS.sto_parts;
}

export function derivePickType(task: {
  status?: string;
  channel?: string;
  comment?: string;
}): PickType {
  const ch = String(task.channel || '');
  const st = String(task.status || '');
  const comment = String(task.comment || '').toLowerCase();
  if (ch === 'production_send' || ch === 'production_receive') return 'production';
  if (comment.includes('возврат') || ch === 'return' || comment.includes('return')) {
    return 'return';
  }
  if (ch === 'sto_parts') return 'sto';
  if (ch === 'inbound') return 'inbound';
  if (ch === 'transfer') return 'transfer';
  if (ch === 'pickup') return 'pickup';
  if (ch === 'own_courier') return 'courier';
  if (ch.startsWith('cdek') && (st === 'ready' || st === 'packed' || st === 'handed')) {
    return 'cdek';
  }
  if (st === 'ready') return 'hand';
  if (st === 'packed') return 'pack';
  if (st === 'new' || st === 'picking') return 'pick';
  if (ch.startsWith('cdek')) return 'cdek';
  return 'other';
}

export type Urgency = 'overdue' | 'hot' | 'normal' | 'wait';

export function urgencyLabel(u: string): string {
  const map: Record<string, string> = {
    overdue: 'Просрочено',
    hot: 'Срочно',
    normal: 'Обычная',
    wait: 'Можно подождать',
  };
  return map[u] || u;
}

function parseSqliteDt(s: string): number | null {
  const raw = String(s || '').trim();
  if (!raw) return null;
  const iso = raw.includes('T') ? raw : raw.replace(' ', 'T') + (raw.endsWith('Z') ? '' : 'Z');
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : null;
}

function ageHours(isoLike: string): number {
  const ms = parseSqliteDt(isoLike);
  if (ms == null) return 0;
  return Math.max(0, (Date.now() - ms) / 3600000);
}

/** Срочность: возраст + этап (готово к выдаче / упаковано — горячее). */
export function deriveUrgency(task: {
  status?: string;
  created_at?: string;
  ready_at?: string;
  packed_at?: string;
}): { urgency: Urgency; urgency_rank: number; age_hours: number } {
  const st = String(task.status || '');
  const createdH = ageHours(String(task.created_at || ''));
  const readyH = String(task.ready_at || '') ? ageHours(String(task.ready_at || '')) : 0;
  const age = createdH;

  let urgency: Urgency = 'wait';
  if (age >= 24 || (st === 'ready' && (readyH >= 4 || age >= 8))) {
    urgency = 'overdue';
  } else if (age >= 4 || st === 'ready' || st === 'packed') {
    urgency = 'hot';
  } else if (age >= 1 || st === 'picking') {
    urgency = 'normal';
  } else {
    urgency = 'wait';
  }

  const urgency_rank = urgency === 'overdue' ? 0 : urgency === 'hot' ? 1 : urgency === 'normal' ? 2 : 3;
  return { urgency, urgency_rank, age_hours: Math.round(age * 10) / 10 };
}

/** Откуда → куда + СДЭК для очереди / карточки /pick. */
export function buildPickRouteInfo(task: {
  channel?: string;
  comment?: string;
  deal_id?: string;
  track_number?: string;
  stock_doc_id?: string;
  sto_request?: Record<string, unknown> | null;
}): {
  route_from: string;
  route_to: string;
  route_label: string;
  amo_shipment: string;
  amo_channel: string;
  is_cdek: boolean;
  cdek_number: string;
  is_transfer: boolean;
} {
  const ch = String(task.channel || '');
  const comment = String(task.comment || '');
  const dealId = String(task.deal_id || '').trim();
  let amo_shipment = '';
  let amo_channel = '';
  let ship_channel = '';
  if (dealId) {
    const d = get<{
      amo_shipment: string;
      amo_channel: string;
      ship_channel: string;
    }>(
      `SELECT IFNULL(amo_shipment,'') AS amo_shipment,
              IFNULL(amo_channel,'') AS amo_channel,
              IFNULL(ship_channel,'') AS ship_channel
       FROM crm_deals WHERE id = ?`,
      [dealId]
    );
    amo_shipment = String(d?.amo_shipment || '').trim();
    amo_channel = String(d?.amo_channel || '').trim();
    ship_channel = String(d?.ship_channel || '').trim();
  }
  const is_cdek =
    /сдэк|cdek/i.test(amo_shipment) ||
    (!amo_shipment && /cdek/i.test(ship_channel)) ||
    (!amo_shipment && /сдэк|cdek/i.test(comment));
  // «Прочие ТК» / Авито в amo_shipment — не СДЭК, даже если ship_channel ещё cdek_*

  if (ch === 'production_send') {
    return {
      route_from: 'Основной',
      route_to: 'Производство',
      route_label: 'Основной → Производство',
      amo_shipment,
      amo_channel,
      is_cdek,
      cdek_number: '',
      is_transfer: true,
    };
  }
  if (ch === 'production_receive') {
    return {
      route_from: 'Производство',
      route_to: 'Основной',
      route_label: 'Производство → Основной',
      amo_shipment,
      amo_channel,
      is_cdek,
      cdek_number: '',
      is_transfer: true,
    };
  }

  const sourceMap: Record<string, string> = {
    warehouse: 'Основной склад',
    courier: 'Курьер',
    market: 'Рынок',
    nonpneumo: 'Непневмо',
    pneumo: 'Пневма',
  };
  let route_from = '';
  let route_to = '';
  const sr = task.sto_request;
  if (sr && typeof sr === 'object') {
    const src = String(sr.source || '').trim();
    route_from = sourceMap[src] || (src ? src : '');
    const destId = String(sr.dest_warehouse_id || '').trim();
    if (destId) {
      const wh = get<{ name: string; code: string }>(
        `SELECT IFNULL(name,'') AS name, IFNULL(code,'') AS code FROM warehouses WHERE id = ?`,
        [destId]
      );
      route_to = String(wh?.name || '').trim() || String(wh?.code || '').trim();
    }
  }
  if (!route_from) {
    if (/со склада/i.test(comment)) route_from = 'Основной склад';
    else if (/· курьер/i.test(comment) && !/куда:\s*склад курьера/i.test(comment))
      route_from = 'Курьер';
    else if (/рынок/i.test(comment)) route_from = 'Рынок';
  }
  if (!route_to) {
    const m = comment.match(/куда:\s*([^·]+)/i);
    if (m) route_to = String(m[1] || '').trim();
  }
  if (ch === 'sto_parts' && !route_from) route_from = 'Склад';
  if (ch === 'sto_parts' && !route_to) route_to = '—';

  const route_label =
    route_from || route_to
      ? `${route_from || '—'} → ${route_to || '—'}`
      : '';

  // track_number у sto_parts часто = id заявки (uuid); номер СДЭК — цифры
  const looksCdekNum = (v: string) =>
    !!v && !/^[0-9a-f-]{36}$/i.test(v) && /\d{6,}/.test(v);
  let cdek_number = '';
  const track = String(task.track_number || '').trim();
  if (is_cdek && looksCdekNum(track)) cdek_number = track;
  if (is_cdek && !cdek_number && dealId) {
    const rows = all<{ track_number: string }>(
      `SELECT IFNULL(track_number,'') AS track_number
       FROM warehouse_tasks
       WHERE deal_id = ? AND IFNULL(track_number,'') != ''
       ORDER BY datetime(updated_at) DESC
       LIMIT 12`,
      [dealId]
    );
    for (const r of rows || []) {
      const tn = String(r.track_number || '').trim();
      if (looksCdekNum(tn)) {
        cdek_number = tn;
        break;
      }
    }
  }

  return {
    route_from,
    route_to,
    route_label,
    amo_shipment,
    amo_channel,
    is_cdek,
    cdek_number,
    is_transfer: ch === 'sto_parts' || ch === 'transfer',
  };
}

function enrichPickRow(t: Record<string, unknown>) {
  const pick_type = derivePickType({
    status: String(t.status || ''),
    channel: String(t.channel || ''),
    comment: String(t.comment || ''),
  });
  const urg = deriveUrgency({
    status: String(t.status || ''),
    created_at: String(t.created_at || ''),
    ready_at: String(t.ready_at || ''),
    packed_at: String(t.packed_at || ''),
  });
  const ch = String(t.channel || '');
  let sto_request: Record<string, unknown> | null = null;
  if (ch === 'sto_parts') {
    const reqId = String(t.stock_doc_id || t.track_number || '').trim();
    if (reqId) {
      sto_request =
        (get(
          `SELECT id, number, source, status,
                  IFNULL(dest_warehouse_id,'') AS dest_warehouse_id,
                  IFNULL(courier_drop_warehouse_id,'') AS courier_drop_warehouse_id
           FROM sto_transfer_requests WHERE id = ?`,
          [reqId]
        ) as Record<string, unknown> | undefined) || null;
    }
  }
  const route = buildPickRouteInfo({
    channel: ch,
    comment: String(t.comment || ''),
    deal_id: String(t.deal_id || ''),
    track_number: String(t.track_number || ''),
    stock_doc_id: String(t.stock_doc_id || ''),
    sto_request,
  });
  const channel_label =
    ch === 'sto_parts'
      ? stoPartsChannelLabel({
          comment: String(t.comment || ''),
          city: String(t.city || ''),
          sto_request,
        })
      : channelLabel(ch);
  // старые задания: buyer_name='СТО' / маршрут производства — подтянуть из сделки
  let buyer_name = String(t.buyer_name || '').trim();
  const dealId = String(t.deal_id || '').trim();
  const buyerLooksLikeRoute =
    /→|⇒/.test(buyer_name) ||
    /производство/i.test(buyer_name) ||
    buyer_name === 'СТО' ||
    buyer_name === 'Разбор' ||
    buyer_name === 'Сборка';
  if (dealId && (!buyer_name || buyerLooksLikeRoute)) {
    const d = get<{ buyer_name: string; company_name: string }>(
      `SELECT IFNULL(buyer_name,'') AS buyer_name, IFNULL(company_name,'') AS company_name
       FROM crm_deals WHERE id = ?`,
      [dealId]
    );
    const real = String(d?.buyer_name || d?.company_name || '').trim();
    if (real) buyer_name = real;
  }
  let city = String(t.city || '').trim();
  if (ch === 'sto_parts' && (city === 'СТО' || !city)) {
    if (route.route_to) city = route.route_to;
    else if (/курьер/i.test(channel_label)) city = 'Курьер';
  }
  const dealCtx = dealId ? dealPickContext(dealId) : null;
  return {
    ...t,
    deal_id: dealId,
    buyer_name,
    city,
    channel_label,
    status_label: statusLabel(String(t.status || '')),
    pick_type,
    pick_type_label:
      pick_type === 'sto' ? channel_label : pickTypeLabel(pick_type),
    urgency: urg.urgency,
    urgency_label: urgencyLabel(urg.urgency),
    urgency_rank: urg.urgency_rank,
    age_hours: urg.age_hours,
    pick_site: resolvePickSiteForTask({ ...t, ...route, city }),
    pick_site_label: pickSiteLabel(resolvePickSiteForTask({ ...t, ...route, city })),
    ...route,
    ...(dealCtx && !dealCtx.missing ? dealCtx : {}),
    deal: dealCtx,
  };
}

function sortOpenPick(a: Record<string, unknown>, b: Record<string, unknown>) {
  const ur = Number(a.urgency_rank) - Number(b.urgency_rank);
  if (ur !== 0) return ur;
  const ta = PICK_TYPE_ORDER.indexOf(a.pick_type as PickType);
  const tb = PICK_TYPE_ORDER.indexOf(b.pick_type as PickType);
  if (ta !== tb) return (ta < 0 ? 99 : ta) - (tb < 0 ? 99 : tb);
  return String(a.created_at || '').localeCompare(String(b.created_at || ''));
}

function groupOpenByType(open: Array<Record<string, unknown>>) {
  const map = new Map<string, Array<Record<string, unknown>>>();
  for (const t of open) {
    const key = String(t.pick_type || 'other');
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(t);
  }
  const groups: Array<{
    type: string;
    label: string;
    count: number;
    items: Array<Record<string, unknown>>;
  }> = [];
  for (const type of PICK_TYPE_ORDER) {
    const items = map.get(type);
    if (!items?.length) continue;
    items.sort(sortOpenPick);
    groups.push({
      type,
      label: pickTypeLabel(type),
      count: items.length,
      items,
    });
    map.delete(type);
  }
  for (const [type, items] of map) {
    items.sort(sortOpenPick);
    groups.push({ type, label: pickTypeLabel(type), count: items.length, items });
  }
  return groups;
}

export type PickSiteId = 'strela' | 'fogel' | 'msk';

type PickSiteRow = {
  id: PickSiteId;
  label: string;
  company_codes: string[];
  warehouse_codes: string[];
  warehouse_ids: string[];
  company_ids: string[];
};

let pickSitesCache: PickSiteRow[] | null = null;

/** Контуры сборки: Стрела / Фогель / МСК (юрлица Учёта №1). */
export function pickSitesCatalog(): PickSiteRow[] {
  if (pickSitesCache) return pickSitesCache;
  const defs: Array<{
    id: PickSiteId;
    label: string;
    company_codes: string[];
    warehouse_codes: string[];
  }> = [
    {
      id: 'strela',
      label: 'Стрела',
      company_codes: ['STRELA', 'СТРЕЛА'],
      warehouse_codes: ['MAIN', 'KRD', '00-000002', 'STO', 'WAIT-PAY.6f66468a', 'IN-TRANSIT.6f66468a'],
    },
    {
      id: 'fogel',
      label: 'Фогель',
      company_codes: ['ФОГЕЛЬ', 'FOGEL'],
      warehouse_codes: ['WAIT-PAY.54291ec9', 'IN-TRANSIT.54291ec9'],
    },
    {
      id: 'msk',
      label: 'МСК',
      company_codes: ['PNEVMO', 'ПНЕВМО'],
      warehouse_codes: ['НФ-000032', '00-000001'],
    },
  ];
  pickSitesCache = defs.map((d) => {
    const warehouse_ids: string[] = [];
    for (const code of d.warehouse_codes) {
      const row = get<{ id: string }>(`SELECT id FROM warehouses WHERE code = ? LIMIT 1`, [code]);
      const id = String(row?.id || '').trim();
      if (id && !warehouse_ids.includes(id)) warehouse_ids.push(id);
    }
    const company_ids: string[] = [];
    for (const code of d.company_codes) {
      const row = get<{ id: string }>(
        `SELECT id FROM companies WHERE UPPER(IFNULL(code,'')) = UPPER(?) OR IFNULL(name,'') LIKE ? LIMIT 1`,
        [code, `%${code}%`]
      );
      const id = String(row?.id || '').trim();
      if (id && !company_ids.includes(id)) company_ids.push(id);
    }
    return { ...d, warehouse_ids, company_ids };
  });
  return pickSitesCache;
}

export function pickSiteLabel(site: PickSiteId | string): string {
  const row = pickSitesCatalog().find((s) => s.id === site);
  return row?.label || 'Стрела';
}

function normalizePickSiteFilter(site?: string): PickSiteId | 'all' {
  const s = String(site || '').trim().toLowerCase();
  if (s === 'msk' || s === 'moscow' || s === 'москва' || s === 'mozhayka' || s === 'можайка') return 'msk';
  if (s === 'fogel' || s === 'фогель') return 'fogel';
  if (
    s === 'strela' ||
    s === 'стрела' ||
    s === 'krd' ||
    s === 'krasnodar' ||
    s === 'краснодар'
  ) {
    return 'strela';
  }
  if (s === 'all' || s === '') return 'all';
  return 'all';
}

function companyBlobToPickSite(code: string, name: string): PickSiteId | null {
  const blob = `${code} ${name}`.toLowerCase();
  if (/фогель|fogel/.test(blob)) return 'fogel';
  if (/стрела|strela/.test(blob)) return 'strela';
  if (/пневмо|pnevmo|москва|можай|msk/.test(blob)) return 'msk';
  return null;
}

export function resolvePickSiteForWarehouse(warehouseId: string): PickSiteId {
  const id = String(warehouseId || '').trim();
  if (!id) return 'strela';
  for (const site of pickSitesCatalog()) {
    if (site.warehouse_ids.includes(id)) return site.id;
  }
  const wh = get<{ code: string; name: string }>(
    `SELECT IFNULL(code,'') AS code, IFNULL(name,'') AS name FROM warehouses WHERE id = ?`,
    [id]
  );
  const blob = `${wh?.code || ''} ${wh?.name || ''}`.toLowerCase();
  if (/фогель|fogel|54291ec9/.test(blob)) return 'fogel';
  if (/москва|msk|филиал|можай|00-000001|нф-000032/.test(blob)) return 'msk';
  if (/стрела|strela|6f66468a/.test(blob)) return 'strela';
  return 'strela';
}

/** Контур по сделке: сначала «Филиал» из Amo, потом юрлицо / склад. */
export function resolvePickSiteForDeal(
  dealId: string,
  warehouseId?: string
): PickSiteId {
  const id = String(dealId || '').trim();
  if (id) {
    const d = get<{
      department: string;
      org_company_id: string;
      amo_branch: string;
      amo_sto: string;
    }>(
      `SELECT IFNULL(department,'') AS department,
              IFNULL(org_company_id,'') AS org_company_id,
              IFNULL(amo_branch,'') AS amo_branch,
              IFNULL(amo_sto,'') AS amo_sto
       FROM crm_deals WHERE id = ?`,
      [id]
    );
    // 1) Amo CF «Филиал» — главный разрез для /pick
    const byBranch = amoBranchToPickSite(String(d?.amo_branch || ''));
    if (byBranch) return byBranch;

    // 2) CF «СТО» (Стрела / Фогель / Можайское)
    const bySto = amoStoToPickSite(String(d?.amo_sto || ''));
    if (bySto) return bySto;

    // 3) Контур юрлица в Учёте
    const orgId = String(d?.org_company_id || '').trim();
    if (orgId) {
      for (const site of pickSitesCatalog()) {
        if (site.company_ids.includes(orgId)) return site.id;
      }
      const org = get<{ code: string; name: string }>(
        `SELECT IFNULL(code,'') AS code, IFNULL(name,'') AS name FROM companies WHERE id = ?`,
        [orgId]
      );
      const byCo = companyBlobToPickSite(String(org?.code || ''), String(org?.name || ''));
      if (byCo) return byCo;
    }

    const dep = String(d?.department || '').toLowerCase();
    if (/fogel|фогель/.test(dep)) return 'fogel';
    if (/strela|стрела/.test(dep)) return 'strela';
    if (/moscow|mosk|москва|msk|pnevmopodveska/.test(dep)) return 'msk';
  }
  const whId = String(warehouseId || '').trim();
  if (whId) return resolvePickSiteForWarehouse(whId);
  return 'strela';
}

/** Значение Amo CF 855167 «Филиал» → контур сборки. */
export function amoBranchToPickSite(branch: string): PickSiteId | null {
  const b = String(branch || '')
    .trim()
    .toLowerCase()
    .replace(/ё/g, 'е');
  if (!b) return null;
  if (/фогель|fogel/.test(b)) return 'fogel';
  if (/стрела|strela|фадеева\s*124/.test(b)) return 'strela';
  if (/москва|можай|msk|пневмо/.test(b)) return 'msk';
  if (/краснодар/.test(b) && !/фогель|fogel|стрела|strela/.test(b)) return 'strela';
  return null;
}

/** Значение Amo CF «СТО» → контур. */
function amoStoToPickSite(sto: string): PickSiteId | null {
  const s = String(sto || '')
    .trim()
    .toLowerCase()
    .replace(/ё/g, 'е');
  if (!s) return null;
  if (/фогель|fogel/.test(s)) return 'fogel';
  if (/стрела|strela|фадеева/.test(s) && !/подвеск|можай|моск/.test(s)) return 'strela';
  if (/можай|моск|подвеск/.test(s)) return 'msk';
  return null;
}

/** Город/склад задания для фильтра /pick. */
export function resolvePickSiteForTask(t: Record<string, unknown>): PickSiteId {
  const dealId = String(t.deal_id || '').trim();
  const whId = String(t.warehouse_id || t.doc_warehouse_id || '').trim();
  if (dealId) return resolvePickSiteForDeal(dealId, whId);

  if (whId) return resolvePickSiteForWarehouse(whId);

  const city = String(t.city || '').toLowerCase();
  if (/москва|msk|можай/.test(city)) return 'msk';
  if (/фогель|fogel/.test(city)) return 'fogel';
  if (/краснодар|krd|стрела/.test(city)) return 'strela';

  const routeTo = String(t.route_to || '').toLowerCase();
  const routeFrom = String(t.route_from || '').toLowerCase();
  const route = routeTo + routeFrom;
  if (/фогель|fogel/.test(route)) return 'fogel';
  if (/москва|msk|филиал|можай/.test(route)) return 'msk';

  const comment = String(t.comment || '').toLowerCase();
  if (/фогель|fogel/.test(comment)) return 'fogel';
  if (/москва|msk|филиал|можай/.test(comment)) return 'msk';
  if (/краснодар|krd|стрела/.test(comment)) return 'strela';

  return 'strela';
}

function taskMatchesPickSite(t: Record<string, unknown>, site: PickSiteId | 'all'): boolean {
  if (site === 'all') return true;
  return resolvePickSiteForTask(t) === site;
}

type PickActor = {
  role?: string;
  isSystemAdmin?: boolean;
  rights?: StaffRights | null;
};

/** Фиксированная вкладка /pick (кладовщик → только МСК). */
export function actorPickSiteLock(actor: PickActor | null | undefined): PickSiteId | null {
  if (!actor || actor.isSystemAdmin || actor.role === 'admin') return null;
  const lock = normPickSiteLock(String(actor.rights?.pick_site_lock || ''));
  if (lock) return lock;
  if (actor.role === 'warehouse') return 'msk';
  return null;
}

function normPickSiteLock(raw: string): PickSiteId | null {
  const s = String(raw || '')
    .trim()
    .toLowerCase();
  if (s === 'msk' || s === 'moscow' || s === 'москва') return 'msk';
  if (s === 'fogel' || s === 'фогель') return 'fogel';
  if (s === 'strela' || s === 'стрела') return 'strela';
  return null;
}

/** Юрлица (companies.id), доступные на /pick: явные company_ids или контур pick_site_lock. */
export function actorPickCompanyIds(actor: PickActor | null | undefined): string[] | null {
  if (!actor || actor.isSystemAdmin || actor.role === 'admin') return null;
  const explicit = actorAllowedCompanyIds(actor);
  if (explicit?.length) return explicit;
  const lock = actorPickSiteLock(actor);
  if (!lock) return null;
  const site = pickSitesCatalog().find((s) => s.id === lock);
  return site?.company_ids?.length ? site.company_ids : null;
}

function dealOrgCompanyId(dealId: string): string {
  const id = String(dealId || '').trim();
  if (!id) return '';
  return String(
    get<{ org_company_id: string }>(
      `SELECT IFNULL(org_company_id,'') AS org_company_id FROM crm_deals WHERE id = ?`,
      [id]
    )?.org_company_id || ''
  ).trim();
}

/** Сделка в контуре актора (Пневмоподвеска / Безматерных Р.П. для МСК). */
export function dealAllowedForPickActor(dealId: string, actor: PickActor | null | undefined): boolean {
  const allowed = actorPickCompanyIds(actor);
  if (!allowed?.length) return true;
  const orgId = dealOrgCompanyId(dealId);
  return orgId ? allowed.includes(orgId) : false;
}

export function resolvePickSiteQuery(
  site: string | undefined,
  actor: PickActor | null | undefined
): PickSiteId | 'all' {
  const lock = actorPickSiteLock(actor);
  if (lock) return lock;
  return normalizePickSiteFilter(site);
}

/** Экран сборщика «без Ани»: сегодня — очередь / сделано / не сделано+почему / следующее. */
export function pickerBoard(day?: string, site?: string, actor?: PickActor | null) {
  const d = (day || new Date().toISOString().slice(0, 10)).slice(0, 10);
  const open = (
    all(
      `SELECT t.*,
         (SELECT COUNT(*) FROM warehouse_task_lines l WHERE l.task_id = t.id) AS lines_count
       FROM warehouse_tasks t
       WHERE t.status IN ('new','picking','packed','ready')
       ORDER BY datetime(t.created_at) ASC
       LIMIT 120`
    ) as Array<Record<string, unknown>>
  )
    .map(enrichPickRow)
    .sort(sortOpenPick);

  const done = (
    all(
      `SELECT t.*,
         (SELECT COUNT(*) FROM warehouse_task_lines l WHERE l.task_id = t.id) AS lines_count
       FROM warehouse_tasks t
       WHERE t.status = 'handed'
         AND (
           substr(IFNULL(t.handed_at, t.updated_at), 1, 10) = ?
           OR substr(t.updated_at, 1, 10) = ?
         )
       ORDER BY datetime(IFNULL(NULLIF(t.handed_at,''), t.updated_at)) DESC
       LIMIT 50`,
      [d, d]
    ) as Array<Record<string, unknown>>
  ).map(enrichPickRow);

  const blocked = (
    all(
      `SELECT t.*,
         (SELECT COUNT(*) FROM warehouse_task_lines l WHERE l.task_id = t.id) AS lines_count
       FROM warehouse_tasks t
       WHERE t.status = 'cancelled'
         AND substr(t.updated_at, 1, 10) = ?
       ORDER BY datetime(t.updated_at) DESC
       LIMIT 50`,
      [d]
    ) as Array<Record<string, unknown>>
  ).map(enrichPickRow);

  const siteFilter = resolvePickSiteQuery(site, actor);
  const taskDealAllowed = (t: { deal_id?: unknown }) => {
    const dealId = String(t.deal_id || '').trim();
    return !dealId || dealAllowedForPickActor(dealId, actor);
  };
  const openFiltered = open.filter(
    (t) => taskMatchesPickSite(t, siteFilter) && taskDealAllowed(t)
  );
  const doneFiltered = done.filter(
    (t) => taskMatchesPickSite(t, siteFilter) && taskDealAllowed(t)
  );
  const blockedFiltered = blocked.filter(
    (t) => taskMatchesPickSite(t, siteFilter) && taskDealAllowed(t)
  );
  const groups = groupOpenByType(openFiltered);
  const next = openFiltered[0] || null;
  const urgency_counts = {
    overdue: openFiltered.filter((t) => t.urgency === 'overdue').length,
    hot: openFiltered.filter((t) => t.urgency === 'hot').length,
    normal: openFiltered.filter((t) => t.urgency === 'normal').length,
    wait: openFiltered.filter((t) => t.urgency === 'wait').length,
  };
  return {
    day: d,
    title: 'Задачи на сегодня',
    note: 'Список по типам · срочность · сделал / не сделал + почему.',
    pick_site: siteFilter,
    pick_sites: pickSitesCatalog().map((s) => ({ id: s.id, label: s.label })),
    counts: {
      open: openFiltered.length,
      done: doneFiltered.length,
      blocked: blockedFiltered.length,
    },
    urgency_counts,
    next,
    open: openFiltered,
    groups,
    done: doneFiltered,
    blocked: blockedFiltered,
  };
}

function parseHandoffTransferLabel(comment: string, createdAt: string): string {
  const c = String(comment || '');
  const m = c.match(/Передача на склад.*?·\s*(\d{2}\.\d{2}\.\d{4}\s+\d{2}:\d{2})/u);
  if (m?.[1]) return m[1].trim();
  const raw = String(createdAt || '').trim();
  if (!raw) return '';
  return formatMoscowLabelFromIso(raw);
}

function formatMoscowLabelFromIso(raw: string): string {
  try {
    const iso = raw.includes('T') ? raw : `${raw.replace(' ', 'T')}Z`;
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return raw.slice(0, 16);
    return d.toLocaleString('ru-RU', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'Europe/Moscow',
    });
  } catch {
    return raw.slice(0, 16);
  }
}

function formatMoscowLabel(d: Date): string {
  return d.toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/Moscow',
  });
}

export function parseWarehouseReadyLabel(comment: string): string {
  const m = String(comment || '').match(/Склад ГОТОВО.*?·\s*(\d{2}\.\d{2}\.\d{4}\s+\d{2}:\d{2})/u);
  return m?.[1]?.trim() || '';
}

function pickEsc(s: unknown): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

import { resolveAmoBranchForDeal } from './amo-deal-branch.js';

/** Заголовок сделки для /pick: осмысленное имя или «Заказ №id · клиент». */
export function isGenericAmoDealName(name: string, dealId: string): boolean {
  const n = String(name || '').replace(/\s+/g, ' ').trim();
  const id = String(dealId || '').trim();
  if (!n) return true;
  if (!id) return false;
  const bare = n
    .replace(/^сделка\s*#?\s*/i, '')
    .replace(/^заказ\s*(№|#)?\s*/i, '')
    .trim();
  return bare === id;
}

export function dealPickTitle(
  dealId: string,
  name?: string | null,
  buyerName?: string | null,
  companyName?: string | null
): string {
  const id = String(dealId || '').trim();
  const n = String(name || '').replace(/\s+/g, ' ').trim();
  if (n && !isGenericAmoDealName(n, id)) return n;
  const buyer = String(buyerName || '').trim();
  const company = String(companyName || '').trim();
  const who = buyer || company;
  if (id && who) return `Заказ №${id} · ${who}`;
  if (who) return who;
  return id ? 'Заказ №' + id : '';
}

/** Контекст сделки для экрана /pick и печатной формы расходной. */
export function dealPickContext(dealId: string): Record<string, unknown> | null {
  const id = String(dealId || '').trim();
  if (!id) return null;
  const d = get<{
    name: string;
    buyer_name: string;
    buyer_phone: string;
    buyer_email: string;
    company_name: string;
    department: string;
    amo_channel: string;
    amo_shipment: string;
    amo_payment_type: string;
    amo_pay_method: string;
    amo_branch: string;
    amo_sto: string;
    amo_client_complaint: string;
    ship_channel: string;
    price: number;
    payment_status: string;
    paid: number;
    responsible_user_id: string;
  }>(
    `SELECT IFNULL(name,'') AS name,
            IFNULL(buyer_name,'') AS buyer_name,
            IFNULL(buyer_phone,'') AS buyer_phone,
            IFNULL(buyer_email,'') AS buyer_email,
            IFNULL(company_name,'') AS company_name,
            IFNULL(department,'') AS department,
            IFNULL(amo_channel,'') AS amo_channel,
            IFNULL(amo_shipment,'') AS amo_shipment,
            IFNULL(amo_payment_type,'') AS amo_payment_type,
            IFNULL(amo_pay_method,'') AS amo_pay_method,
            IFNULL(amo_branch,'') AS amo_branch,
            IFNULL(amo_sto,'') AS amo_sto,
            IFNULL(amo_client_complaint,'') AS amo_client_complaint,
            IFNULL(ship_channel,'') AS ship_channel,
            IFNULL(price,0) AS price,
            IFNULL(payment_status,'') AS payment_status,
            IFNULL(paid,0) AS paid,
            IFNULL(responsible_user_id,'') AS responsible_user_id
     FROM crm_deals WHERE id = ?`,
    [id]
  );
  if (!d) return { deal_id: id, missing: true };
  const paid = dealIsPaid(id);
  const rid = String(d.responsible_user_id || '').trim();
  let responsible_name = '';
  if (rid) {
    responsible_name = String(
      get<{ name: string }>(`SELECT IFNULL(name,'') AS name FROM staff WHERE amo_id = ? LIMIT 1`, [rid])
        ?.name || ''
    ).trim();
  }
  const ship_channel = String(d.ship_channel || '').trim();
  const route = buildPickRouteInfo({
    channel: ship_channel,
    comment: '',
    deal_id: id,
    track_number: '',
    stock_doc_id: '',
    sto_request: null,
  });
  const amo_branch = resolveAmoBranchForDeal({ id, amo_branch: String(d.amo_branch || '').trim() });
  return {
    deal_id: id,
    name: String(d.name || '').trim(),
    title: dealPickTitle(id, d.name, d.buyer_name, d.company_name),
    buyer_name: String(d.buyer_name || d.company_name || '').trim(),
    buyer_phone: String(d.buyer_phone || '').trim(),
    buyer_email: String(d.buyer_email || '').trim(),
    company_name: String(d.company_name || '').trim(),
    city: amo_branch,
    department: String(d.department || '').trim(),
    ...route,
    amo_channel: String(d.amo_channel || '').trim() || String(route.amo_channel || '').trim(),
    amo_shipment: String(d.amo_shipment || '').trim() || String(route.amo_shipment || '').trim(),
    amo_payment_type: String(d.amo_payment_type || '').trim(),
    amo_pay_method: String(d.amo_pay_method || '').trim(),
    amo_branch,
    amo_sto: String(d.amo_sto || '').trim(),
    amo_client_complaint: String(d.amo_client_complaint || '').trim(),
    ship_channel,
    ship_channel_label: channelLabel(ship_channel),
    amount: Number(d.price || 0) || 0,
    is_paid: paid,
    payment_label: paid ? 'Оплачено' : 'Не оплачено',
    payment_status: String(d.payment_status || '').trim(),
    responsible_name,
    cdek_widget_url: cdekWidgetUrl(id),
    cdek_number: (() => {
      let n = String(route.cdek_number || '').trim();
      if (!n && route.is_cdek) {
        n = String(loadCdekDealFromWidgetCache(id)?.cdek_number || '').trim();
      }
      return n;
    })(),
    cdek_barcode_url: (() => {
      let n = String(route.cdek_number || '').trim();
      const cached = !n && route.is_cdek ? loadCdekDealFromWidgetCache(id) : null;
      if (!n) n = String(cached?.cdek_number || '').trim();
      if (!n) return '';
      return (
        String(cached?.cdek_barcode_url || '').trim() || cdekBarcodePublicUrl(id, n)
      );
    })(),
  };
}

export type HandoffPickCell = {
  cell_id: string;
  cell_code: string;
  qty: number;
  rack: string;
  bay: string;
  level: string;
};

export type HandoffPickUnitInput = {
  product_id: string;
  unit_no: number;
  cell_id?: string;
  cell_code?: string;
};

/** Развернуть строку расходной в штуки (у каждой — свой адрес / ячейка). */
export function expandHandoffLineToUnits(line: {
  product_id?: string;
  qty?: number;
  cells?: HandoffPickCell[];
}): Array<{
  unit_no: number;
  unit_total: number;
  product_id: string;
  cells: HandoffPickCell[];
  default_cell_id: string;
  default_cell_code: string;
}> {
  const productId = String(line.product_id || '').trim();
  const qty = Math.max(0, Math.round(Number(line.qty) || 0));
  if (!productId || qty <= 0) return [];
  const cells = (Array.isArray(line.cells) ? line.cells : []).filter(
    (c) => String(c.cell_code || '').trim() && Number(c.qty) > 0
  );
  const pool: HandoffPickCell[] = [];
  for (const c of cells) {
    const n = Math.max(0, Math.round(Number(c.qty) || 0));
    for (let i = 0; i < n; i++) pool.push(c);
  }
  const out: Array<{
    unit_no: number;
    unit_total: number;
    product_id: string;
    cells: HandoffPickCell[];
    default_cell_id: string;
    default_cell_code: string;
  }> = [];
  for (let u = 0; u < qty; u++) {
    const def = pool[u] || cells[0] || null;
    out.push({
      unit_no: u + 1,
      unit_total: qty,
      product_id: productId,
      cells,
      default_cell_id: String(def?.cell_id || '').trim(),
      default_cell_code: String(def?.cell_code || '').trim(),
    });
  }
  return out;
}

/** Ячейки и остатки по товару — для сборки по расходной. */
function productPickLocations(
  productId: string,
  warehouseId?: string
): {
  stock_qty: number;
  cells: HandoffPickCell[];
  cells_label: string;
} {
  const pid = String(productId || '').trim();
  if (!pid) return { stock_qty: 0, cells: [], cells_label: '' };
  const eqIds = stockBalanceProductIds(pid);
  const ph = eqIds.map(() => '?').join(',');
  const wh = String(warehouseId || '').trim();
  const whSql = wh ? ' AND b.warehouse_id = ?' : '';
  const whParams = wh ? [...eqIds, wh] : eqIds;
  const stock_qty =
    Number(
      get<{ q: number }>(
        `SELECT IFNULL(SUM(b.qty),0) AS q FROM stock_balances b
         WHERE b.product_id IN (${ph}) AND b.qty > 0.0001${whSql}`,
        whParams
      )?.q
    ) || 0;

  const cells: HandoffPickCell[] = [];
  try {
    ensureWarehouseCellsSchema();
    const p = get<{ sku: string }>(`SELECT IFNULL(sku,'') AS sku FROM products WHERE id = ?`, [pid]);
    const sku = String(p?.sku || '').trim();
    const skus = [
      ...new Set(
        [
          sku,
          ...all<{ sku: string }>(
            `SELECT IFNULL(sku,'') AS sku FROM products WHERE id IN (${ph})`,
            eqIds
          ).map((r) => String(r.sku || '').trim()),
        ].filter(Boolean)
      ),
    ];
    if (skus.length) {
      const sph = skus.map(() => '?').join(',');
      const cellWhSql = wh ? ' AND b.warehouse_id = ?' : '';
      const cellParams = wh ? [...eqIds, ...skus, wh] : [...eqIds, ...skus];
      const cellRows = all<{
        cell_id: string;
        cell_code: string;
        qty: number;
        rack: string;
        bay: string;
        level: string;
      }>(
        `SELECT c.id AS cell_id, c.code AS cell_code, b.qty AS qty,
                IFNULL(c.rack,'') AS rack, IFNULL(c.bay,'') AS bay, IFNULL(c.level,'') AS level
         FROM stock_cell_balances b
         JOIN warehouse_cells c ON c.id = b.cell_id
         WHERE (b.product_id IN (${ph}) OR b.sku IN (${sph})) AND b.qty > 0${cellWhSql}
         ORDER BY b.qty DESC, c.code ASC`,
        cellParams
      );
      const byCell = new Map<string, HandoffPickCell>();
      for (const row of cellRows) {
        const cellId = String(row.cell_id || '').trim();
        const codeCell = String(row.cell_code || '').trim();
        if (!cellId || !codeCell) continue;
        const cur = byCell.get(cellId);
        if (cur) cur.qty += Number(row.qty) || 0;
        else
          byCell.set(cellId, {
            cell_id: cellId,
            cell_code: codeCell,
            qty: Number(row.qty) || 0,
            rack: String(row.rack || ''),
            bay: String(row.bay || ''),
            level: String(row.level || ''),
          });
      }
      cells.push(...byCell.values());
    }
  } catch {
    /* cells optional */
  }
  const cells_label = cells.length
    ? cells
        .slice(0, 4)
        .map((c) => `${c.cell_code}${c.qty > 1 ? ` (${c.qty})` : ''}`)
        .join(', ')
    : '';
  return { stock_qty, cells, cells_label };
}

/** Склады для колонок «Передано» на /pick (остаток рядом с qty заказа). */
const CATALOG_GUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function catalogGuidFromProductId(productId: string): string {
  const raw = String(productId || '').trim().toLowerCase();
  if (!raw) return '';
  const sep = raw.indexOf('::');
  const guid = sep >= 0 ? raw.slice(sep + 2) : raw;
  return CATALOG_GUID_RE.test(guid) ? guid : '';
}

function pickSiteSourceDepartment(site?: PickSiteId): string {
  if (site === 'fogel') return 'fogel_2025';
  if (site === 'msk') return 'pnevmopodveska_2025';
  return '';
}

/** product_id для остатков: bare GUID из сделки → scoped pnevmopodveska_2025::… (как в виджете). */
function stockBalanceProductIds(productId: string, pickSite?: PickSiteId): string[] {
  const id = String(productId || '').trim();
  if (!id) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  const push = (x: string) => {
    const v = String(x || '').trim();
    if (!v || seen.has(v)) return;
    seen.add(v);
    out.push(v);
  };
  push(id);
  const guid = catalogGuidFromProductId(id);
  if (!guid) return out;
  const dept = pickSiteSourceDepartment(pickSite);
  // Без LIKE по всей номенклатуре — иначе /pick зависает на больших расходных.
  if (dept) {
    push(`${dept}::${guid}`);
    const byCatalog = get<{ id: string }>(
      `SELECT id FROM products WHERE catalog_guid = ? AND source_department = ? LIMIT 1`,
      [guid, dept]
    );
    if (byCatalog?.id) push(byCatalog.id);
    // Фогель: bare GUID часто несёт остаток Подвески (PNEVMO) — только fogel_2025::…
    if (dept === 'fogel_2025') {
      const scoped = out.filter((x) => x.startsWith('fogel_2025::'));
      return scoped.length ? scoped : [];
    }
  } else {
    push(`pnevmopodveska_2025::${guid}`);
    push(`fogel_2025::${guid}`);
    const rows = all<{ id: string }>(
      `SELECT id FROM products WHERE catalog_guid = ? LIMIT 4`,
      [guid]
    );
    for (const row of rows) push(String(row.id || '').trim());
  }
  return out;
}

function handoffDisplayWarehouses(site: PickSiteId): Array<{ id: string; label: string }> {
  const out: Array<{ id: string; label: string }> = [];
  const push = (id: string, label: string) => {
    const wid = String(id || '').trim();
    if (!wid || out.some((x) => x.id === wid)) return;
    out.push({ id: wid, label: String(label || '').trim() || wid });
  };

  // Сначала Основной и «Отложено под СТО» — оси выбора источника на /pick.
  try {
    const mainId = handoffMainWarehouseIdForSite(site);
    const mainName =
      get<{ name: string }>(`SELECT IFNULL(name,'') AS name FROM warehouses WHERE id = ?`, [mainId])
        ?.name || 'Основной';
    push(mainId, mainName);
    const holdId = handoffHoldWarehouseIdForSite(site);
    if (holdId) {
      const holdName =
        get<{ name: string }>(`SELECT IFNULL(name,'') AS name FROM warehouses WHERE id = ?`, [holdId])
          ?.name || 'Отложено под СТО';
      push(holdId, holdName);
    }
  } catch {
    /* склады ещё не заведены */
  }

  const siteRow = pickSitesCatalog().find((s) => s.id === site);
  const companyIds = (siteRow?.company_ids || []).filter(Boolean);
  if (companyIds.length) {
    const ph = companyIds.map(() => '?').join(',');
    const rows = all<{ id: string; name: string; code: string }>(
      `SELECT w.id, w.name, w.code
       FROM warehouses w
       WHERE IFNULL(w.is_active, 1) = 1
         AND IFNULL(w.show_in_widget, 0) = 1
         AND w.company_id IN (${ph})
       ORDER BY w.name ASC`,
      companyIds
    );
    for (const r of rows) {
      const id = String(r.id || '').trim();
      const label = String(r.name || '').trim() || String(r.code || '').trim() || id;
      push(id, label);
    }
  }

  if (out.length) return out;

  const defs: Record<PickSiteId, Array<[string, string]>> = {
    msk: [
      ['НФ-000032', 'Основной'],
      ['STO-RES-MSK', 'Отложено под СТО'],
      ['STO', 'СТО'],
      ['00-000001', 'Склад СТО Москва'],
    ],
    strela: [
      ['MAIN', 'Основной'],
      ['STO-RES-STRELA', 'Отложено под СТО'],
      ['STO', 'СТО'],
    ],
    fogel: [
      ['WAIT-PAY.54291ec9', 'Склад'],
      ['STO-RES-STRELA', 'Отложено под СТО'],
      ['IN-TRANSIT.54291ec9', 'В пути'],
    ],
  };
  for (const [code, label] of defs[site] || defs.msk) {
    const row = get<{ id: string }>(
      `SELECT id FROM warehouses WHERE code = ? AND IFNULL(is_active,1) = 1 LIMIT 1`,
      [code]
    );
    const id = String(row?.id || '').trim();
    if (id) push(id, label);
  }
  return out;
}

function productStockQtyOnWarehouse(
  productId: string,
  warehouseId: string,
  pickSite?: PickSiteId
): number {
  const wh = String(warehouseId || '').trim();
  if (!wh) return 0;
  const eqIds = stockBalanceProductIds(productId, pickSite);
  if (!eqIds.length) return 0;
  const ph = eqIds.map(() => '?').join(',');
  const fromBal =
    Number(
      get<{ q: number }>(
        `SELECT IFNULL(SUM(b.qty),0) AS q FROM stock_balances b
         WHERE b.product_id IN (${ph}) AND b.warehouse_id = ? AND b.qty > 0.0001`,
        [...eqIds, wh]
      )?.q
    ) || 0;
  if (fromBal > 0.0001) return fromBal;
  return (
    Number(
      get<{ q: number }>(
        `SELECT IFNULL(SUM(r.qty),0) AS q FROM product_store_rests r
         WHERE r.product_id IN (${ph}) AND r.warehouse_id = ? AND r.qty > 0.0001
           AND NOT EXISTS (
             SELECT 1 FROM stock_balances b
             WHERE b.product_id = r.product_id AND b.warehouse_id = r.warehouse_id
           )`,
        [...eqIds, wh]
      )?.q
    ) || 0
  );
}

function enrichHandoffLine(
  line: Record<string, unknown>,
  warehouseId: string,
  pickSite?: PickSiteId
): Record<string, unknown> {
  const productId = String(line.product_id || '').trim();
  const p = productId
    ? get<{ sku: string; name: string; barcode: string; code: string; array_sku: string }>(
        `SELECT IFNULL(sku,'') AS sku, IFNULL(name,'') AS name,
                IFNULL(barcode,'') AS barcode, IFNULL(code,'') AS code,
                IFNULL(array_sku,'') AS array_sku
         FROM products WHERE id = ?`,
        [productId]
      )
    : null;
  const site = pickSite || 'msk';
  const lineWh =
    String(line.warehouse_id || '').trim() || String(warehouseId || '').trim();
  const loc = productPickLocations(productId, lineWh);
  const cat = catalogArticleOf(p || {});
  const fromWhName =
    String(line.warehouse_name || '').trim() ||
    String(
      get<{ name: string }>(
        `SELECT IFNULL(name,'') AS name FROM warehouses WHERE id = ?`,
        [lineWh]
      )?.name || ''
    ).trim();
  const stock_wh = handoffDisplayWarehouses(site).map((w) => {
    const wLoc = productPickLocations(productId, w.id);
    return {
      warehouse_id: w.id,
      label: w.label,
      qty: productStockQtyOnWarehouse(productId, w.id, site),
      cells: wLoc.cells,
      cells_label: wLoc.cells_label,
    };
  });
  return {
    ...line,
    sku: String(p?.sku || line.sku || '').trim(),
    code: String(p?.code || cat.code || '').trim(),
    article: String(cat.article || p?.sku || '').trim(),
    name: String(p?.name || line.name || '').trim(),
    barcode: String(p?.barcode || '').trim(),
    warehouse_id: lineWh,
    from_warehouse_id: lineWh,
    from_warehouse_name: fromWhName,
    stock_qty: loc.stock_qty,
    cells: loc.cells,
    cells_label: loc.cells_label,
    stock_wh,
  };
}

/** Короткий блок «уже по маршруту» для печати расходной. */
function buildHandoffAlreadyMovedPrintHtml(
  dealId: string,
  route: HandoffRouteKind | null,
  opts?: {
    routeLabel?: string;
    currentDocNumber?: string;
    excludeProductIds?: string[];
    beforeDocId?: string;
  }
): string {
  if (!dealId || !route) return '';
  const brief = buildHandoffRouteBrief(dealId, route, {
    routeLabel: opts?.routeLabel,
    docNumber: opts?.currentDocNumber,
    excludeProductIds: opts?.excludeProductIds,
    beforeDocId: opts?.beforeDocId,
  });
  if (!brief.length) return '';
  const body = brief
    .slice(1)
    .map((line) => `<div style="font-size:12px;line-height:1.45;margin-top:3px">${pickEsc(line)}</div>`)
    .join('');
  return `<div style="margin:0 0 12px;padding:10px 12px;border:2px solid #b45309;border-radius:8px;background:#fffbeb">
  <div style="font-weight:800;font-size:13px;margin-bottom:6px">${pickEsc(brief[0] || 'Уже по заказу')}</div>
  ${body}
</div>`;
}

/** Печатная форма расходной для сборки (прикрепить к коробке). */
export function handoffPickSlipHtml(docId: string, opts?: { autoprint?: boolean }): string {
  const id = String(docId || '').trim();
  if (!id) throw new Error('Не указан документ');
  const doc = get<{
    id: string;
    number: string;
    deal_id: string;
    comment: string;
    created_at: string;
    warehouse_id: string;
    warehouse_to_id: string;
    doc_type: string;
    warehouse_name: string;
    warehouse_to_name: string;
    warehouse_from_code: string;
    warehouse_to_code: string;
    amount: number;
  }>(
    `SELECT d.id, d.number, IFNULL(d.deal_id,'') AS deal_id, IFNULL(d.comment,'') AS comment,
            d.created_at, IFNULL(d.warehouse_id,'') AS warehouse_id,
            IFNULL(d.warehouse_to_id,'') AS warehouse_to_id,
            IFNULL(d.doc_type,'') AS doc_type,
            IFNULL(w.name,'') AS warehouse_name,
            IFNULL(wt.name,'') AS warehouse_to_name,
            IFNULL(w.code,'') AS warehouse_from_code,
            IFNULL(wt.code,'') AS warehouse_to_code,
            IFNULL(d.amount,0) AS amount
     FROM stock_docs d
     LEFT JOIN warehouses w ON w.id = d.warehouse_id
     LEFT JOIN warehouses wt ON wt.id = d.warehouse_to_id
     WHERE d.id = ?
       AND (
         d.doc_type = 'out'
         OR (d.doc_type = 'transfer' AND IFNULL(d.comment,'') LIKE '%Передача на склад%')
       )`,
    [id]
  );
  if (!doc) throw new Error('Расходная не найдена');

  const dealId = String(doc.deal_id || '').trim();
  const deal = dealId ? dealPickContext(dealId) : null;
  const warehouseId = String(doc.warehouse_id || '').trim();
  const warehouseToId = String(doc.warehouse_to_id || '').trim();
  const commentStr = String(doc.comment || '');
  const isToSto = isToStoHandoffComment(commentStr);
  // Спуск Резерв→СТО: не вызывать buildHandoffReserveMeta (он подставляет dest=резерв → «резерв→резерв»).
  const reserveMeta =
    !isToSto && dealId ? buildHandoffReserveMeta(dealId, warehouseId, warehouseToId || undefined) : null;
  const shipMeta =
    !isToSto && !reserveMeta && dealId ? buildHandoffShipMeta(dealId, warehouseId) : null;
  const fromName = String(doc.warehouse_name || '').trim() || 'Отложено под СТО';
  const toStoName = String(doc.warehouse_to_name || '').trim() || 'СТО';
  const rawLines = all(
    `SELECT l.line_no, l.qty, l.product_id,
            IFNULL(p.sku,'') AS sku, IFNULL(p.name,'') AS name
     FROM stock_doc_lines l
     LEFT JOIN products p ON p.id = l.product_id
     WHERE l.doc_id = ?
     ORDER BY l.line_no ASC, l.id ASC`,
    [id]
  ) as Array<Record<string, unknown>>;
  const lines = rawLines.map((l) => enrichHandoffLine(l, warehouseId));
  const routeKind = handoffRouteKindFromDoc({
    comment: commentStr,
    from_code: String(doc.warehouse_from_code || ''),
    to_code: String(doc.warehouse_to_code || ''),
    is_to_sto: isToSto,
  });
  const routeLabel = isToSto
    ? `${fromName} → ${toStoName}`
    : String(reserveMeta?.route_label || shipMeta?.route_label || '');
  const alreadyMovedHtml = dealId
    ? buildHandoffAlreadyMovedPrintHtml(dealId, routeKind, {
        routeLabel,
        currentDocNumber: String(doc.number || '').trim() || id.slice(0, 8),
        excludeProductIds: lines.map((l) => String(l.product_id || '')).filter(Boolean),
        beforeDocId: id,
      })
    : '';
  const when = parseHandoffTransferLabel(commentStr, String(doc.created_at || ''));
  const num = String(doc.number || '').trim() || id.slice(0, 8);
  const d = deal && !deal.missing ? deal : null;

  const metaRows: Array<[string, string]> = [];
  if (dealId) metaRows.push(['Сделка Amo', dealId]);
  if (d?.name) metaRows.push(['Заказ', String(d.name)]);
  if (d?.buyer_name) metaRows.push(['Покупатель', String(d.buyer_name)]);
  if (d?.buyer_phone) metaRows.push(['Телефон', String(d.buyer_phone)]);
  if (d?.responsible_name) metaRows.push(['Менеджер', String(d.responsible_name)]);
  if (d?.amo_channel) metaRows.push(['Канал реализации', String(d.amo_channel)]);
  if (d?.amo_shipment) metaRows.push(['Способ отправки', String(d.amo_shipment)]);
  else if (d?.ship_channel_label) metaRows.push(['Канал склада', String(d.ship_channel_label)]);
  if (d?.amo_payment_type) metaRows.push(['Тип оплаты', String(d.amo_payment_type)]);
  if (d?.payment_label) metaRows.push(['Оплата', String(d.payment_label)]);
  if (d?.amo_branch) metaRows.push(['Филиал', String(d.amo_branch)]);
  if (d?.city) metaRows.push(['Город', String(d.city)]);
  if (d?.cdek_number) metaRows.push(['СДЭК №', String(d.cdek_number)]);
  if (isToSto) {
    metaRows.push(['Задача', 'Спуск на СТО / самовывоз']);
    metaRows.push(['Откуда', fromName]);
    metaRows.push(['Куда', toStoName]);
    metaRows.push(['Маршрут', `${fromName} → ${toStoName}`]);
  } else if (reserveMeta) {
    metaRows.push(['Задача', reserveMeta.purpose_label]);
    metaRows.push(['Откуда', reserveMeta.from_warehouse_name]);
    metaRows.push(['Склад резерва', reserveMeta.dest_warehouse_name]);
    metaRows.push(['Маршрут', reserveMeta.route_label]);
  } else if (shipMeta) {
    metaRows.push(['Задача', shipMeta.purpose_label]);
    metaRows.push(['Откуда', shipMeta.from_warehouse_name]);
    metaRows.push(['Куда', shipMeta.dest_warehouse_name]);
    metaRows.push(['Маршрут', shipMeta.route_label]);
  } else if (doc.warehouse_name) {
    metaRows.push(['Склад', String(doc.warehouse_name)]);
    if (doc.warehouse_to_name) metaRows.push(['Куда', String(doc.warehouse_to_name)]);
  }

  const channel = String(d?.amo_channel || '').trim();
  const channelBanner = channel
    ? `<div class="channel-banner"><div class="channel-k">Канал реализации</div><div class="channel-v">${pickEsc(channel)}</div></div>`
    : '';

  const metaHtml = metaRows
    .map(([k, v]) => {
      const isCh = k === 'Канал реализации';
      return `<tr class="${isCh ? 'is-channel' : ''}"><th class="l">${pickEsc(k)}</th><td class="l${isCh ? ' channel-td' : ''}">${pickEsc(v)}</td></tr>`;
    })
    .join('');

  const docProductIds = lines.map((l) => String(l.product_id || '')).filter(Boolean);
  const alreadyShipped =
    dealId && routeKind ? dealSkipLinesOnRoute(dealId, routeKind, { beforeDocId: id }) : [];
  const shippedByProduct = new Map(alreadyShipped.map((s) => [s.product_id, s]));
  let rowNo = 0;

  const renderPrintSlipRow = (row: {
    checked: boolean;
    code: string;
    article: string;
    name: string;
    qty: number | string;
    cell: string;
    bc: string;
    note?: string;
  }) => {
    rowNo += 1;
    const chk = row.checked
      ? '<td class="c chk-shipped">✓</td>'
      : '<td class="c">☐</td>';
    const rowClass = row.checked ? ' class="row-done"' : '';
    const noteHtml = row.note ? `<div class="done-note">${pickEsc(row.note)}</div>` : '';
    return `<tr${rowClass}>
        <td class="c">${rowNo}</td>
        ${chk}
        <td class="l mono code-td">${pickEsc(row.code || '—')}</td>
        <td class="l mono">${pickEsc(row.article || '—')}</td>
        <td class="l">${pickEsc(row.name || '—')}${noteHtml}</td>
        <td class="c"><b>${pickEsc(String(row.qty ?? ''))}</b></td>
        <td class="l mono cell-td">${pickEsc(row.cell || '—')}</td>
        <td class="l mono muted">${pickEsc(row.bc || '—')}</td>
      </tr>`;
  };

  const shippedRowsHtml = alreadyShipped
    .map((sr) => {
      const enriched = enrichHandoffLine(
        { product_id: sr.product_id, sku: sr.sku, name: sr.name, qty: sr.qty },
        warehouseId
      );
      const note = [sr.doc_number, sr.current_label, 'уже отгружено'].filter(Boolean).join(' · ');
      return renderPrintSlipRow({
        checked: true,
        code: String(enriched.code || '').trim(),
        article: String(enriched.article || enriched.sku || sr.sku || '').trim(),
        name: String(sr.name || ''),
        qty: sr.qty,
        cell: String(sr.cell_code || '').trim() || '—',
        bc: String(enriched.barcode || '').trim() || String(enriched.article || sr.sku || ''),
        note,
      });
    })
    .join('');

  const pickRowsHtml = lines
    .map((l) => {
      const pid = String(l.product_id || '').trim();
      if (shippedByProduct.has(pid)) return '';
      const code = String(l.code || '').trim();
      const article = String(l.article || l.sku || '').trim();
      const bc = String(l.barcode || '').trim() || article;
      const cells = Array.isArray(l.cells) ? (l.cells as HandoffPickCell[]) : [];
      const cellCode =
        String(l.cells_label || '').trim() ||
        cells.map((c) => String(c.cell_code || '').trim()).filter(Boolean).join(', ') ||
        '—';
      return renderPrintSlipRow({
        checked: false,
        code,
        article,
        name: String(l.name || '—'),
        qty: Number(l.qty) || 0,
        cell: cellCode,
        bc,
        note: 'к сборке',
      });
    })
    .filter(Boolean)
    .join('');

  const tableBodyHtml = shippedRowsHtml + pickRowsHtml;

  const autoprint = opts?.autoprint ? 'window.print();' : '';
  const onload = opts?.autoprint ? ' onload="window.print()"' : '';

  return `<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Расходная ${pickEsc(num)} · сборка</title>
<style>
  @page { size: A4; margin: 8mm; }
  * { box-sizing: border-box; }
  body { font-family: system-ui, -apple-system, Segoe UI, sans-serif; font-size: 12px; color: #111; margin: 10px; }
  h1 { font-size: 20px; margin: 0 0 4px; font-weight: 800; letter-spacing: -0.02em; }
  .deal-title {
    margin: 0 0 8px;
    font-size: 15px;
    font-weight: 800;
    line-height: 1.3;
    color: #111;
  }
  .sub { color: #555; font-size: 13px; margin: 0 0 10px; }
  .badge { display: inline-block; padding: 3px 8px; border-radius: 6px; background: #0d7377; color: #fff; font-weight: 700; font-size: 11px; margin-right: 6px; }
  .channel-banner {
    margin: 8px 0 12px;
    padding: 12px 14px;
    border: 3px solid #0d7377;
    border-radius: 10px;
    background: #e8f6f6;
    box-shadow: inset 0 0 0 1px #7bb8b8;
  }
  .channel-banner .channel-k {
    font-size: 12px;
    font-weight: 800;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: #0f5c5f;
    margin-bottom: 4px;
  }
  .channel-banner .channel-v {
    font-size: 26px;
    font-weight: 900;
    letter-spacing: -0.03em;
    color: #063e40;
    line-height: 1.1;
  }
  .toolbar { margin-bottom: 12px; }
  .toolbar button { padding: 10px 18px; font-size: 14px; font-weight: 700; cursor: pointer; background: #0d7377; color: #fff; border: 0; border-radius: 8px; }
  table.meta { width: 100%; border-collapse: collapse; margin: 0 0 12px; }
  table.meta th, table.meta td { border: 1px solid #ccc; padding: 5px 8px; vertical-align: top; }
  table.meta th { width: 34%; background: #f4f7f7; font-weight: 700; text-align: left; }
  table.meta tr.is-channel th { background: #d8efef; font-size: 13px; border-color: #0d7377; }
  table.meta tr.is-channel td.channel-td {
    font-size: 18px;
    font-weight: 900;
    color: #063e40;
    border: 2px solid #0d7377;
    background: #e8f6f6;
  }
  table.grid { width: 100%; border-collapse: collapse; margin-top: 6px; }
  table.grid th, table.grid td { border: 1px solid #333; padding: 6px 7px; vertical-align: top; }
  table.grid th { background: #eef5f5; font-weight: 800; text-align: center; font-size: 11px; }
  .c { text-align: center; }
  .l { text-align: left; }
  .mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
  .muted { color: #666; font-size: 11px; }
  .code-td { font-size: 13px; font-weight: 700; }
  .cell-td { font-size: 18px; font-weight: 800; letter-spacing: 0.02em; line-height: 1.25; }
  .row-done td { background: #f3f4f6; color: #374151; }
  .row-done .cell-td { color: #047857; }
  .chk-done { color: #047857; font-weight: 900; font-size: 16px; }
  .chk-shipped { color: #047857; font-weight: 900; font-size: 16px; }
  .done-note { font-size: 10px; color: #6b7280; font-weight: 600; margin-top: 2px; }
  .foot { margin-top: 14px; font-size: 11px; color: #666; border-top: 1px dashed #aaa; padding-top: 8px; }
  .sign { margin-top: 18px; display: flex; gap: 24px; }
  .sign div { flex: 1; border-top: 1px solid #333; padding-top: 4px; font-size: 11px; }
  @media print { .toolbar { display: none !important; } body { margin: 0; } }
</style>
</head>
<body${onload}>
<div class="toolbar"><button type="button" onclick="window.print()">Печать · прикрепить к коробке</button></div>
<span class="badge">СБОРКА</span><span class="badge">РАСХОДНАЯ</span>
<h1>${pickEsc(num)}</h1>
${
    dealId || (d && d.name)
      ? `<p class="deal-title">${pickEsc(
          dealPickTitle(
            dealId,
            d?.name ? String(d.name) : '',
            d?.buyer_name ? String(d.buyer_name) : '',
            d?.company_name ? String(d.company_name) : ''
          )
        )}</p>`
      : ''
  }
<p class="sub">Учёт №1 · передано на склад${when ? ' · ' + pickEsc(when) : ''}</p>
${channelBanner}
<table class="meta">${metaHtml || '<tr><td>—</td></tr>'}</table>
${alreadyMovedHtml}
<table class="grid">
  <thead><tr>
    <th style="width:28px">№</th>
    <th style="width:32px">□</th>
    <th style="width:90px">Код</th>
    <th style="width:90px">Артикул</th>
    <th>Наименование</th>
    <th style="width:44px">Кол</th>
    <th style="width:150px">Ячейка · где лежит</th>
    <th style="width:80px">ШК</th>
  </tr></thead>
  <tbody>${tableBodyHtml || '<tr><td colspan="8" class="c">Нет строк</td></tr>'}</tbody>
</table>
<div class="sign">
  <div>Собрал · подпись</div>
  <div>Проверил · подпись</div>
  <div>Дата</div>
</div>
<p class="foot">Распечатано ${pickEsc(new Date().toLocaleString('ru-RU'))} · ${pickEsc(
    String(doc.warehouse_name || ''))
  } · сумма ${Number(doc.amount || 0).toLocaleString('ru-RU')} ₽</p>
<script>${autoprint}</script>
</body></html>`;
}

/** Печатная форма «Вернуть на основной» — приходная (pending и уже проведённые). */
export function stockReturnPickSlipHtml(dealIdRaw: string, opts?: { autoprint?: boolean }): string {
  const dealId = String(dealIdRaw || '').trim();
  if (!dealId) throw new Error('Не указана сделка');
  const pending = getPendingStockReturn(dealId);
  if (!pending || (pending.status !== 'pending' && pending.status !== 'done')) {
    throw new Error('Нет требования на возврат');
  }
  const enriched =
    (pending.status === 'pending'
      ? listPendingStockReturns(80).find((r) => String(r.deal_id) === dealId)
      : null) ||
    ({ ...pending, deal_id: dealId } as Record<string, unknown>);
  const lines = Array.isArray(enriched.lines) ? (enriched.lines as Array<Record<string, unknown>>) : [];
  const deal = dealPickContext(dealId);
  const d = deal && !deal.missing ? deal : null;
  const fromName = String(enriched.from_warehouse_name || 'Резерв/СТО').trim();
  const route = String(enriched.route_label || `${fromName} → Основной`).trim();
  const reason = String(enriched.reason || 'Удалено из заказа после перемещения').trim();
  const when = String(enriched.completed_at || enriched.created_at || '')
    .replace('T', ' ')
    .slice(0, 16);
  const done = pending.status === 'done';

  const metaRows: Array<[string, string]> = [];
  metaRows.push(['Сделка Amo', dealId]);
  if (d?.name) metaRows.push(['Заказ', String(d.name)]);
  if (d?.buyer_name) metaRows.push(['Покупатель', String(d.buyer_name)]);
  if (d?.buyer_phone) metaRows.push(['Телефон', String(d.buyer_phone)]);
  if (d?.responsible_name) metaRows.push(['Менеджер', String(d.responsible_name)]);
  if (d?.amo_channel) metaRows.push(['Канал реализации', String(d.amo_channel)]);
  if (d?.amo_shipment) metaRows.push(['Способ отправки', String(d.amo_shipment)]);
  if (d?.amo_payment_type) metaRows.push(['Тип оплаты', String(d.amo_payment_type)]);
  if (d?.payment_label) metaRows.push(['Оплата', String(d.payment_label)]);
  if (d?.amo_branch) metaRows.push(['Филиал', String(d.amo_branch)]);
  metaRows.push(['Задача', 'Приходная · вернуть на основной']);
  metaRows.push(['Откуда', fromName]);
  metaRows.push(['Куда', 'Основной']);
  metaRows.push(['Маршрут', route]);
  if (reason) metaRows.push(['Причина', reason]);

  const channel = String(d?.amo_channel || '').trim();
  const channelBanner = channel
    ? `<div class="channel-banner"><div class="channel-k">Канал реализации</div><div class="channel-v">${pickEsc(channel)}</div></div>`
    : '';
  const metaHtml = metaRows
    .map(([k, v]) => {
      const isCh = k === 'Канал реализации';
      return `<tr class="${isCh ? 'is-channel' : ''}"><th class="l">${pickEsc(k)}</th><td class="l${isCh ? ' channel-td' : ''}">${pickEsc(v)}</td></tr>`;
    })
    .join('');

  let rowNo = 0;
  const tableBodyHtml = lines
    .map((l) => {
      rowNo += 1;
      const sku = String(l.sku || '').trim();
      const name = String(l.name || '—').trim();
      const qty = Number(l.qty) || 1;
      const fromCell = String(l.from_cell_code || '').trim() || '—';
      const toCell = String(l.to_cell_code || l.origin_cell_code || '').trim() || '—';
      const origin = String(l.origin_label || '').trim();
      return `<tr>
        <td class="c">${rowNo}</td>
        <td class="c">☐</td>
        <td class="mono code-td">${pickEsc(sku || '—')}</td>
        <td class="mono">${pickEsc(sku || '—')}</td>
        <td class="l">${pickEsc(name)}${origin ? `<div class="done-note">Брали: ${pickEsc(origin)}</div>` : ''}</td>
        <td class="c"><b>${qty}</b></td>
        <td class="cell-td c">${pickEsc(fromCell)}<div class="done-note">→ основной ${pickEsc(toCell)}</div></td>
        <td class="c muted">—</td>
      </tr>`;
    })
    .join('');

  const title =
    (d && String(d.title || d.name || '').replace(/\s+/g, ' ').trim()) || `Сделка ${dealId}`;
  const autoprint = opts?.autoprint ? 'window.print();' : '';
  const onload = opts?.autoprint ? ' onload="window.print()"' : '';

  return `<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Приходная · ${pickEsc(dealId)} · на основной</title>
<style>
  @page { size: A4; margin: 8mm; }
  * { box-sizing: border-box; }
  body { font-family: system-ui, -apple-system, Segoe UI, sans-serif; font-size: 12px; color: #111; margin: 10px; }
  h1 { font-size: 20px; margin: 0 0 4px; font-weight: 800; letter-spacing: -0.02em; }
  .deal-title { margin: 0 0 8px; font-size: 15px; font-weight: 800; line-height: 1.3; color: #111; }
  .sub { color: #555; font-size: 13px; margin: 0 0 10px; }
  .badge { display: inline-block; padding: 3px 8px; border-radius: 6px; background: #b45309; color: #fff; font-weight: 700; font-size: 11px; margin-right: 6px; }
  .channel-banner {
    margin: 8px 0 12px; padding: 12px 14px; border: 3px solid #0d7377; border-radius: 10px;
    background: #e8f6f6; box-shadow: inset 0 0 0 1px #7bb8b8;
  }
  .channel-banner .channel-k { font-size: 12px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.05em; color: #0f5c5f; margin-bottom: 4px; }
  .channel-banner .channel-v { font-size: 26px; font-weight: 900; letter-spacing: -0.03em; color: #063e40; line-height: 1.1; }
  .toolbar { margin-bottom: 12px; }
  .toolbar button { padding: 10px 18px; font-size: 14px; font-weight: 700; cursor: pointer; background: #0d7377; color: #fff; border: 0; border-radius: 8px; }
  table.meta { width: 100%; border-collapse: collapse; margin: 0 0 12px; }
  table.meta th, table.meta td { border: 1px solid #ccc; padding: 5px 8px; vertical-align: top; }
  table.meta th { width: 34%; background: #f4f7f7; font-weight: 700; text-align: left; }
  table.meta tr.is-channel th { background: #d8efef; font-size: 13px; border-color: #0d7377; }
  table.meta tr.is-channel td.channel-td { font-size: 18px; font-weight: 900; color: #063e40; border: 2px solid #0d7377; background: #e8f6f6; }
  table.grid { width: 100%; border-collapse: collapse; margin-top: 6px; }
  table.grid th, table.grid td { border: 1px solid #333; padding: 6px 7px; vertical-align: top; }
  table.grid th { background: #eef5f5; font-weight: 800; text-align: center; font-size: 11px; }
  .c { text-align: center; } .l { text-align: left; }
  .mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
  .muted { color: #666; font-size: 11px; }
  .code-td { font-size: 13px; font-weight: 700; }
  .cell-td { font-size: 18px; font-weight: 800; letter-spacing: 0.02em; line-height: 1.25; }
  .done-note { font-size: 10px; color: #6b7280; font-weight: 600; margin-top: 2px; }
  .foot { margin-top: 14px; font-size: 11px; color: #666; border-top: 1px dashed #aaa; padding-top: 8px; }
  .sign { margin-top: 18px; display: flex; gap: 24px; }
  .sign div { flex: 1; border-top: 1px solid #333; padding-top: 4px; font-size: 11px; }
  @media print { .toolbar { display: none !important; } body { margin: 0; } }
</style>
</head>
<body${onload}>
<div class="toolbar"><button type="button" onclick="window.print()">Печать</button></div>
<span class="badge">${done ? 'Приходная · проведено' : 'Приходная · на основной'}</span>
<h1>${pickEsc(route)}</h1>
<p class="deal-title">${pickEsc(title)}</p>
<p class="sub">Учёт №1 · приход на Основной${when ? ' · ' + pickEsc(when) : ''} · сделка ${pickEsc(dealId)}${done ? ' · остатки на Основном увеличены' : ''}</p>
${channelBanner}
<table class="meta">${metaHtml || '<tr><td>—</td></tr>'}</table>
<table class="grid">
  <thead><tr>
    <th style="width:28px">№</th>
    <th style="width:32px">□</th>
    <th style="width:90px">Код</th>
    <th style="width:90px">Артикул</th>
    <th>Наименование</th>
    <th style="width:44px">Кол</th>
    <th style="width:150px">Ячейка · откуда → куда</th>
    <th style="width:80px">ШК</th>
  </tr></thead>
  <tbody>${tableBodyHtml || '<tr><td colspan="8" class="c">Нет строк</td></tr>'}</tbody>
</table>
<div class="sign">
  <div>Снял · подпись</div>
  <div>Положил на основной · подпись</div>
  <div>Дата</div>
</div>
<p class="foot">Распечатано ${pickEsc(new Date().toLocaleString('ru-RU'))} · ${pickEsc(fromName)} → Основной</p>
<script>${autoprint}</script>
</body></html>`;
}

/** Карточки возврата для /pick — тот же дух, что handoffs (deal + print_href). */
export function stockReturnsForPick(limit = 60): Array<Record<string, unknown>> {
  return listPendingStockReturns(limit).map((r) => {
    const dealId = String(r.deal_id || '').trim();
    const deal = dealId ? dealPickContext(dealId) : null;
    const fromName = String(r.from_warehouse_name || 'Резерв/СТО').trim();
    const lines = (Array.isArray(r.lines) ? r.lines : []).map((l) => {
      const row = l as Record<string, unknown>;
      const fromCell = String(row.from_cell_code || '').trim();
      const toCell = String(row.to_cell_code || row.origin_cell_code || '').trim();
      return {
        ...row,
        article: String(row.sku || ''),
        cells_label: fromCell || '—',
        cells: fromCell ? [{ cell_code: fromCell, qty: Number(row.qty) || 1 }] : [],
        needs_pick: true,
        from_cell_code: fromCell,
        to_cell_code: toCell,
        origin_label: String(row.origin_label || ''),
      };
    });
    return {
      ...r,
      id: `return:${dealId}`,
      is_return: true,
      is_reserve: false,
      is_ship: false,
      is_to_sto: false,
      purpose_label: 'Приходная · на основной',
      warehouse_name: fromName,
      warehouse_to_name: 'Основной',
      dest_warehouse_name: 'Основной',
      route_label: String(r.route_label || `${fromName} → Основной`),
      transfer_label: String(r.created_at || '')
        .replace('T', ' ')
        .slice(0, 16),
      number: `П${dealId}`,
      pick_site_label: 'МСК',
      print_href: `/api/warehouse/pick/returns/${encodeURIComponent(dealId)}/print`,
      deal: deal || r.deal || null,
      lines,
      lines_count: lines.length,
      qty_sum: lines.reduce((s, l) => s + (Number((l as { qty?: number }).qty) || 0), 0),
    };
  });
}

type HandoffDealLine = {
  product_id: string;
  qty: number;
  price: number;
  warehouse_id: string;
  name: string;
  sku: string;
};

function handoffLinesSignature(lines: Array<{ product_id: string; qty: number }>): string {
  return lines
    .map((l) => `${String(l.product_id || '').trim()}:${Math.max(0, Math.round(Number(l.qty) || 0))}`)
    .join('|');
}

/** Минимальная карточка товара для строк расходной (FK stock_doc_lines → products). */
function ensureHandoffProductStub(line: {
  product_id: string;
  sku: string;
  name: string;
}): void {
  const id = String(line.product_id || '').trim();
  if (!id) return;
  const exists = get('SELECT id FROM products WHERE id = ? LIMIT 1', [id]);
  if (exists) return;
  let sku = String(line.sku || '').trim();
  if (!sku) sku = id.slice(0, 12);
  const clash = get<{ id: string }>('SELECT id FROM products WHERE sku = ? AND id != ? LIMIT 1', [
    sku,
    id,
  ]);
  if (clash) sku = `${sku.slice(0, 40)}:${id.slice(0, 8)}`;
  const unitId =
    get<{ id: string }>(`SELECT id FROM units WHERE short_name = 'шт' LIMIT 1`)?.id ||
    get<{ id: string }>(`SELECT id FROM units LIMIT 1`)?.id ||
    '';
  if (!unitId) return;
  const name = String(line.name || sku).trim() || sku;
  try {
    run(
      `INSERT INTO products (id, sku, name, unit_id, item_kind, code, is_active)
       VALUES (?, ?, ?, ?, 'product', ?, 1)`,
      [id, sku, name, unitId, sku]
    );
  } catch {
    /* гонка / дубликат SKU */
  }
}

/** Позиции заказа для черновика «Передача на склад» (без услуг). */
function dealHandoffSourceLines(dealId: string, docWarehouseId: string): HandoffDealLine[] {
  const deal = String(dealId || '').trim();
  if (!deal) return [];
  const defaultWh = String(docWarehouseId || '').trim() || mainWarehouseId();
  const site = resolvePickSiteForDeal(deal);
  const rows = all<{
    product_guid: string;
    qty: number;
    price: number;
    warehouse_id: string;
    name: string;
    sku: string;
    item_kind: string;
  }>(
    `SELECT IFNULL(i.product_guid,'') AS product_guid, IFNULL(i.qty,0) AS qty, IFNULL(i.price,0) AS price,
            IFNULL(i.warehouse_id,'') AS warehouse_id, IFNULL(i.name,'') AS name, IFNULL(i.sku,'') AS sku,
            CASE
              WHEN IFNULL(p.item_kind,'product') = 'service' THEN 'service'
              ELSE 'product'
            END AS item_kind
     FROM crm_deal_items i
     LEFT JOIN products p ON p.id = NULLIF(TRIM(IFNULL(i.product_guid,'')), '')
     WHERE i.deal_id = ?
     ORDER BY i.line_no ASC, i.id ASC`,
    [deal]
  );
  const out: HandoffDealLine[] = [];
  for (const row of rows) {
    if (String(row.item_kind || '') === 'service') continue;
    const productId = String(row.product_guid || '').trim();
    if (!productId || isServiceProduct(productId)) continue;
    const qty = Math.max(1, Math.round(Number(row.qty) || 1));
    const resolved = resolveHandoffSourceWarehouseId(productId, qty, site);
    out.push({
      product_id: productId,
      qty,
      price: Math.max(0, Math.round(Number(row.price) || 0)),
      warehouse_id: resolved || String(row.warehouse_id || '').trim() || defaultWh,
      name: String(row.name || '').trim(),
      sku: String(row.sku || '').trim(),
    });
  }
  return out;
}

/** Подтянуть строки непроведённой «Передачи на склад» из актуального состава заказа (виджет → amo1c → WMS). */
function syncUnpostedHandoffDocLines(docId: string): boolean {
  const id = String(docId || '').trim();
  if (!id) return false;
  const doc = get<{
    id: string;
    deal_id: string;
    warehouse_id: string;
    posted: number;
    comment: string;
  }>(
    `SELECT id, IFNULL(deal_id,'') AS deal_id, IFNULL(warehouse_id,'') AS warehouse_id,
            IFNULL(posted,0) AS posted, IFNULL(comment,'') AS comment
     FROM stock_docs
     WHERE id = ? AND doc_type = 'out'`,
    [id]
  );
  if (!doc || Number(doc.posted) === 1) return false;
  if (!String(doc.comment || '').includes('Передача на склад')) return false;
  const dealId = String(doc.deal_id || '').trim();
  if (!dealId) return false;

  const warehouseId = String(doc.warehouse_id || '').trim() || mainWarehouseId();
  const targetLines = dealHandoffSourceLines(dealId, warehouseId);
  if (!targetLines.length) return false;

  const currentLines = all<{ product_id: string; qty: number }>(
    `SELECT IFNULL(product_id,'') AS product_id, IFNULL(qty,0) AS qty
     FROM stock_doc_lines
     WHERE doc_id = ?
     ORDER BY line_no ASC, id ASC`,
    [id]
  );
  if (handoffLinesSignature(currentLines) === handoffLinesSignature(targetLines)) return false;

  run('BEGIN');
  try {
    run('DELETE FROM stock_doc_lines WHERE doc_id = ?', [id]);
    let docAmount = 0;
    let lineNo = 0;
    for (const line of targetLines) {
      lineNo += 1;
      ensureHandoffProductStub({
        product_id: line.product_id,
        sku: line.sku,
        name: line.name,
      });
      const amount = Math.round(line.price * line.qty);
      docAmount += amount;
      run(
        `INSERT INTO stock_doc_lines
          (id, doc_id, product_id, qty, price, amount, serials_json, warehouse_id, apps_json, line_no)
         VALUES (?, ?, ?, ?, ?, ?, '[]', ?, '[]', ?)`,
        [newGuid(), id, line.product_id, line.qty, line.price, amount, line.warehouse_id, lineNo]
      );
    }
    let headerWh = warehouseId;
    const whVotes = new Map<string, number>();
    for (const line of targetLines) {
      const wid = String(line.warehouse_id || warehouseId).trim() || warehouseId;
      whVotes.set(wid, (whVotes.get(wid) || 0) + 1);
    }
    let best = -1;
    for (const [wid, n] of whVotes) {
      if (n > best) {
        best = n;
        headerWh = wid;
      }
    }
    run('UPDATE stock_docs SET amount = ?, warehouse_id = ? WHERE id = ?', [docAmount, headerWh, id]);
    run('COMMIT');
    return true;
  } catch (e) {
    run('ROLLBACK');
    console.warn('handoff sync lines', id, dealId, e instanceof Error ? e.message : e);
    return false;
  }
}

type HandoffPickSearch = { text: string; digits: string };

function escapeHandoffPickLike(raw: string): string {
  return raw.replace(/[%_\\]/g, (ch) => `\\${ch}`);
}

function normalizeHandoffPickSearch(raw?: string | null): HandoffPickSearch | null {
  const text = String(raw || '')
    .trim()
    .replace(/\s+/g, ' ')
    .slice(0, 80);
  if (!text) return null;
  return { text, digits: text.replace(/\D+/g, '').slice(0, 20) };
}

function buildHandoffPickSearchClause(search: HandoffPickSearch | null): {
  joinSql: string;
  whereSql: string;
  params: Array<string | number>;
} {
  if (!search) return { joinSql: '', whereSql: '', params: [] };
  const joinSql = ' LEFT JOIN crm_deals cd ON cd.id = d.deal_id ';
  const parts: string[] = [];
  const params: Array<string | number> = [];
  const textLike = `%${escapeHandoffPickLike(search.text.toLowerCase())}%`;

  parts.push(
    `LOWER(IFNULL(cd.name,'')) LIKE ? ESCAPE '\\'`,
    `LOWER(IFNULL(cd.buyer_name,'')) LIKE ? ESCAPE '\\'`,
    `LOWER(IFNULL(cd.company_name,'')) LIKE ? ESCAPE '\\'`
  );
  params.push(textLike, textLike, textLike);

  if (search.digits) {
    parts.push(`TRIM(IFNULL(d.deal_id,'')) LIKE ? ESCAPE '\\'`);
    params.push(`%${escapeHandoffPickLike(search.digits)}%`);
    if (search.digits.length >= 4) {
      parts.push(
        `REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(IFNULL(cd.buyer_phone,''), '+', ''), ' ', ''), '-', ''), '(', ''), ')', '') LIKE ? ESCAPE '\\'`
      );
      params.push(`%${escapeHandoffPickLike(search.digits)}%`);
    }
    if (search.digits.length >= 5) {
      parts.push(`EXISTS (
        SELECT 1 FROM warehouse_tasks wt
        WHERE wt.deal_id = d.deal_id
          AND REPLACE(REPLACE(IFNULL(wt.track_number,''), ' ', ''), '-', '') LIKE ? ESCAPE '\\'
      )`);
      params.push(`%${escapeHandoffPickLike(search.digits)}%`);
    }
  }

  if (search.text.length >= 4 && /[^\d\s]/.test(search.text)) {
    parts.push(`EXISTS (
      SELECT 1 FROM warehouse_tasks wt
      WHERE wt.deal_id = d.deal_id
        AND LOWER(IFNULL(wt.track_number,'')) LIKE ? ESCAPE '\\'
    )`);
    params.push(textLike);
  }

  return { joinSql, whereSql: ` AND (${parts.join(' OR ')})`, params };
}

export type HandoffPickListFilters = {
  date_from?: string;
  date_to?: string;
  type?: string;
  channel?: string;
  route_from?: string;
  route_to?: string;
};

function parseHandoffIsoDate(raw?: string | null): string {
  const m = String(raw || '')
    .trim()
    .match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : '';
}

export function parseHandoffPickListFilters(input: {
  date_from?: string | null;
  date_to?: string | null;
  type?: string | null;
  channel?: string | null;
  route_from?: string | null;
  route_to?: string | null;
}): HandoffPickListFilters {
  const type = String(input.type || '').trim().toLowerCase();
  return {
    date_from: parseHandoffIsoDate(input.date_from),
    date_to: parseHandoffIsoDate(input.date_to),
    type: type === 'reserve' || type === 'ship' || type === 'sto' ? type : '',
    channel: String(input.channel || '').trim().slice(0, 80),
    route_from: String(input.route_from || '').trim().slice(0, 120),
    route_to: String(input.route_to || '').trim().slice(0, 120),
  };
}

function handoffPickListFiltersActive(f?: HandoffPickListFilters | null): boolean {
  if (!f) return false;
  return !!(
    f.date_from ||
    f.date_to ||
    f.type ||
    f.channel ||
    f.route_from ||
    f.route_to
  );
}

function buildHandoffPickListFilterClause(
  filters: HandoffPickListFilters | undefined,
  hasDealJoin: boolean
): { joinSql: string; whereSql: string; params: Array<string | number> } {
  const f = filters || {};
  if (!handoffPickListFiltersActive(f)) return { joinSql: '', whereSql: '', params: [] };
  const joinSql = hasDealJoin ? '' : ' LEFT JOIN crm_deals cd ON cd.id = d.deal_id ';
  const parts: string[] = [];
  const params: Array<string | number> = [];
  if (f.date_from) {
    parts.push(`date(d.created_at) >= date(?)`);
    params.push(f.date_from);
  }
  if (f.date_to) {
    parts.push(`date(d.created_at) <= date(?)`);
    params.push(f.date_to);
  }
  if (f.channel) {
    parts.push(`TRIM(IFNULL(cd.amo_channel,'')) = ?`);
    params.push(f.channel);
  }
  if (f.route_from) {
    parts.push(`TRIM(IFNULL(w.name,'')) = ?`);
    params.push(f.route_from);
  }
  if (f.route_to) {
    parts.push(`TRIM(IFNULL(wt.name,'')) = ?`);
    params.push(f.route_to);
  }
  if (f.type === 'sto') {
    parts.push(`(IFNULL(d.comment,'') LIKE '%Спуск на СТО%' OR IFNULL(d.comment,'') LIKE '%СРОЧНО на СТО%')`);
  } else if (f.type === 'return') {
    parts.push(`IFNULL(d.comment,'') LIKE '%Возврат на основной%'`);
  } else if (f.type === 'reserve') {
    parts.push(`IFNULL(d.comment,'') NOT LIKE '%Спуск на СТО%' AND IFNULL(d.comment,'') NOT LIKE '%СРОЧНО на СТО%'`);
    parts.push(`IFNULL(d.comment,'') NOT LIKE '%Возврат на основной%'`);
    parts.push(
      `(LOWER(IFNULL(cd.amo_channel,'')) LIKE '%автосервис%'
        OR LOWER(IFNULL(cd.amo_channel,'')) LIKE '%самовывоз%'
        OR LOWER(IFNULL(cd.amo_shipment,'')) LIKE '%самовывоз%'
        OR LOWER(IFNULL(cd.ship_channel,'')) = 'pickup')`
    );
  } else if (f.type === 'ship') {
    parts.push(`IFNULL(d.comment,'') NOT LIKE '%Спуск на СТО%' AND IFNULL(d.comment,'') NOT LIKE '%СРОЧНО на СТО%'`);
    parts.push(`IFNULL(d.comment,'') NOT LIKE '%Возврат на основной%'`);
    parts.push(
      `(LOWER(IFNULL(cd.amo_channel,'')) LIKE '%отправк%'
        OR (TRIM(IFNULL(cd.amo_shipment,'')) != ''
            AND LOWER(IFNULL(cd.amo_shipment,'')) NOT LIKE '%самовывоз%'
            AND LOWER(IFNULL(cd.amo_shipment,'')) NOT LIKE '%автосервис%')
        OR (TRIM(IFNULL(cd.ship_channel,'')) != ''
            AND LOWER(IFNULL(cd.ship_channel,'')) NOT IN ('pickup','')
            AND LOWER(IFNULL(cd.ship_channel,'')) NOT LIKE '%самовывоз%'))`
    );
  }
  return {
    joinSql,
    whereSql: parts.length ? ` AND ${parts.join(' AND ')}` : '',
    params,
  };
}

function matchesHandoffListFilters(
  item: Record<string, unknown>,
  filters?: HandoffPickListFilters
): boolean {
  const f = filters || {};
  if (!handoffPickListFiltersActive(f)) return true;
  if (f.type === 'sto' && !item.is_to_sto) return false;
  if (f.type === 'return' && !item.is_return) return false;
  if (f.type === 'reserve' && !item.is_reserve) return false;
  if (f.type === 'ship' && !item.is_ship) return false;
  const deal = item.deal as Record<string, unknown> | null | undefined;
  if (f.channel && String(deal?.amo_channel || '').trim() !== f.channel) return false;
  if (f.route_from && String(item.warehouse_name || '').trim() !== f.route_from) return false;
  if (f.route_to) {
    const to = String(item.dest_warehouse_name || item.warehouse_to_name || '').trim();
    if (to !== f.route_to) return false;
  }
  if (f.date_from || f.date_to) {
    const dt = String(item.created_at || '').slice(0, 10);
    if (f.date_from && dt < f.date_from) return false;
    if (f.date_to && dt > f.date_to) return false;
  }
  return true;
}

function filterHandoffPickRowsBySite(
  rows: Array<Record<string, unknown>>,
  siteFilter: string,
  actor?: PickActor | null
): Array<Record<string, unknown>> {
  if (siteFilter === 'all') {
    return rows.filter((row) => dealAllowedForPickActor(String(row.deal_id || '').trim(), actor));
  }
  return rows.filter((row) => {
    const dealId = String(row.deal_id || '').trim();
    const whId = String(row.warehouse_id || '').trim();
    if (!dealAllowedForPickActor(dealId, actor)) return false;
    return resolvePickSiteForDeal(dealId, whId) === siteFilter;
  });
}

/**
 * Условие документов для /pick.
 * Активные: черновики «Передача на склад».
 * Завершённые: ГОТОВО + возвраты на основной (иначе возвраты не видны в поиске по сделке).
 */
function handoffPickDocSql(posted: boolean): string {
  if (posted) {
    return `(
         (
           IFNULL(d.comment,'') LIKE '%Передача на склад%'
           AND IFNULL(d.comment,'') LIKE '%Склад ГОТОВО%'
         )
         OR (
           d.doc_type = 'transfer'
           AND IFNULL(d.comment,'') LIKE '%Возврат на основной%'
         )
       )`;
  }
  return `IFNULL(d.comment,'') LIKE '%Передача на склад%'
       AND d.doc_type = 'out'`;
}

/** Справочники для фильтров списка передач на /pick. */
export function warehouseHandoffPickFilterFacets(
  site?: string,
  actor?: PickActor | null,
  posted = true
): Record<string, string[]> {
  const siteFilter = resolvePickSiteQuery(site, actor);
  const rows = all(
    `SELECT d.deal_id, d.warehouse_id, d.comment, d.created_at,
            IFNULL(w.name,'') AS warehouse_name,
            IFNULL(wt.name,'') AS warehouse_to_name,
            IFNULL(cd.amo_channel,'') AS amo_channel
     FROM stock_docs d
     LEFT JOIN warehouses w ON w.id = d.warehouse_id
     LEFT JOIN warehouses wt ON wt.id = d.warehouse_to_id
     LEFT JOIN crm_deals cd ON cd.id = d.deal_id
     WHERE IFNULL(d.posted,0) = ?
       AND TRIM(IFNULL(d.deal_id,'')) != ''
       AND ${handoffPickDocSql(posted)}
     ORDER BY datetime(d.created_at) DESC
     LIMIT 400`,
    [posted ? 1 : 0]
  ) as Array<Record<string, unknown>>;
  const filtered = filterHandoffPickRowsBySite(rows, siteFilter, actor);
  const channels = new Set<string>();
  const routeFrom = new Set<string>();
  const routeTo = new Set<string>();
  for (const row of filtered) {
    const ch = String(row.amo_channel || '').trim();
    if (ch) channels.add(ch);
    const from = String(row.warehouse_name || '').trim();
    if (from) routeFrom.add(from);
    const to = String(row.warehouse_to_name || '').trim();
    if (to) routeTo.add(to);
  }
  const sortRu = (a: string, b: string) => a.localeCompare(b, 'ru');
  return {
    channels: [...channels].sort(sortRu),
    route_from: [...routeFrom].sort(sortRu),
    route_to: [...routeTo].sort(sortRu),
    types: ['reserve', 'ship', 'sto', 'return'],
  };
}

/** Черновики / завершённые расходные «Передача на склад» для экрана /pick. */
export function warehouseHandoffsForPick(
  limit = 60,
  site?: string,
  actor?: PickActor | null,
  opts?: { posted?: boolean; offset?: number; deal_q?: string; filters?: HandoffPickListFilters }
) {
  const cap = Math.max(1, Math.min(120, limit));
  const offset = Math.max(0, Number(opts?.offset) || 0);
  const posted = opts?.posted === true;
  const listFilters = opts?.filters;
  const listActive = handoffPickListFiltersActive(listFilters);
  const search = normalizeHandoffPickSearch(opts?.deal_q);
  const searchClause = buildHandoffPickSearchClause(search);
  const listClause = buildHandoffPickListFilterClause(listFilters, !!searchClause.joinSql);
  const joinSql = searchClause.joinSql || listClause.joinSql;
  const whereSql = searchClause.whereSql + listClause.whereSql;
  const siteFilter = resolvePickSiteQuery(site, actor);
  // Сначала фильтр по филиалу/актору, потом LIMIT — иначе page даёт пустой список при ненулевом total.
  const fetchCap = Math.min(500, Math.max(cap + offset + 80, listActive ? 500 : 120));
  const params: Array<string | number> = [
    posted ? 1 : 0,
    ...searchClause.params,
    ...listClause.params,
    fetchCap,
  ];
  const rows = all(
    `SELECT d.id, d.number, d.deal_id, d.comment, d.created_at, d.doc_date, d.doc_type,
            d.warehouse_id, d.warehouse_to_id,
            IFNULL(w.name,'') AS warehouse_name,
            IFNULL(wt.name,'') AS warehouse_to_name,
            IFNULL(w.code,'') AS warehouse_from_code,
            IFNULL(wt.code,'') AS warehouse_to_code,
            IFNULL(d.amount,0) AS amount,
            (SELECT COUNT(*) FROM stock_doc_lines l WHERE l.doc_id = d.id) AS lines_count,
            (SELECT IFNULL(SUM(l.qty),0) FROM stock_doc_lines l WHERE l.doc_id = d.id) AS qty_sum
     FROM stock_docs d
     LEFT JOIN warehouses w ON w.id = d.warehouse_id
     LEFT JOIN warehouses wt ON wt.id = d.warehouse_to_id
     ${joinSql}
     WHERE IFNULL(d.posted,0) = ?
       AND TRIM(IFNULL(d.deal_id,'')) != ''
       AND ${handoffPickDocSql(posted)}
       ${whereSql}
     ORDER BY datetime(d.created_at) DESC
     LIMIT ?`,
    params
  ) as Array<Record<string, unknown>>;

  const filteredRows = filterHandoffPickRowsBySite(rows, siteFilter, actor);
  if (listActive) {
    return runWithDealFlowCache(() => {
      const mapped = filteredRows
        .map((row) => mapHandoffPickRow(row, siteFilter, posted))
        .filter((item) => matchesHandoffListFilters(item, listFilters));
      return mapped.slice(offset, offset + cap);
    });
  }
  return runWithDealFlowCache(() =>
    filteredRows
      .slice(offset, offset + cap)
      .map((row) => mapHandoffPickRow(row, siteFilter, posted))
  );
}

export function warehouseHandoffsPickTotal(
  site?: string,
  actor?: PickActor | null,
  posted = false,
  dealQRaw?: string,
  listFilters?: HandoffPickListFilters
): number {
  const siteFilter = resolvePickSiteQuery(site, actor);
  const listActive = handoffPickListFiltersActive(listFilters);
  const search = normalizeHandoffPickSearch(dealQRaw);
  const searchClause = buildHandoffPickSearchClause(search);
  const listClause = buildHandoffPickListFilterClause(listFilters, !!searchClause.joinSql);
  const joinSql = searchClause.joinSql || listClause.joinSql;
  const whereSql = searchClause.whereSql + listClause.whereSql;
  const params: Array<string | number> = [posted ? 1 : 0, ...searchClause.params, ...listClause.params];
  const rows = all(
    `SELECT d.id, d.deal_id, d.warehouse_id, d.comment, d.created_at, d.warehouse_to_id,
            IFNULL(w.name,'') AS warehouse_name,
            IFNULL(wt.name,'') AS warehouse_to_name
     FROM stock_docs d
     LEFT JOIN warehouses w ON w.id = d.warehouse_id
     LEFT JOIN warehouses wt ON wt.id = d.warehouse_to_id
     ${joinSql}
     WHERE IFNULL(d.posted,0) = ?
       AND TRIM(IFNULL(d.deal_id,'')) != ''
       AND ${handoffPickDocSql(posted)}
       ${whereSql}
     ORDER BY datetime(d.created_at) DESC
     LIMIT 500`,
    params
  ) as Array<Record<string, unknown>>;
  const filteredRows = filterHandoffPickRowsBySite(rows, siteFilter, actor);
  if (!listActive) return filteredRows.length;
  return runWithDealFlowCache(
    () =>
      filteredRows
        .map((row) => mapHandoffPickRow(row, siteFilter, posted))
        .filter((item) => matchesHandoffListFilters(item, listFilters)).length
  );
}

export function warehouseCompletedHandoffsForPick(
  page = 1,
  limit = 15,
  site?: string,
  actor?: PickActor | null,
  dealQ?: string,
  listFilters?: HandoffPickListFilters
) {
  const pg = Math.max(1, Math.floor(Number(page) || 1));
  const lim = Math.max(1, Math.min(50, Math.floor(Number(limit) || 15)));
  const total = warehouseHandoffsPickTotal(site, actor, true, dealQ, listFilters);
  const pages = Math.max(1, Math.ceil(total / lim));
  const safePage = Math.min(pg, pages);
  const offset = (safePage - 1) * lim;
  const items = warehouseHandoffsForPick(lim, site, actor, {
    posted: true,
    offset,
    deal_q: dealQ,
    filters: listFilters,
  });
  return { items, total, page: safePage, pages, limit: lim };
}

function parseHandoffCompletedLabel(comment: string): string {
  const c = String(comment || '');
  const m = c.match(/Склад ГОТОВО\s*·\s*([^·]+)/i);
  if (m && m[1]) return String(m[1]).trim();
  return '';
}

function mapHandoffPickRow(
  row: Record<string, unknown>,
  _siteFilter: string,
  completed: boolean
): Record<string, unknown> {
  const id = String(row.id || '');
  const dealId = String(row.deal_id || '').trim();
  const warehouseId = String(row.warehouse_id || '').trim();
  const commentStr = String(row.comment || '');
  const isReturn = /Возврат на основной/i.test(commentStr);
  const isToSto = !isReturn && isToStoHandoffComment(commentStr);
  const fromCode = String(row.warehouse_from_code || '').trim().toUpperCase();
  const toCode = String(row.warehouse_to_code || '').trim().toUpperCase();
  const fromName = String(row.warehouse_name || '').trim();
  const toNameRaw = String(row.warehouse_to_name || '').trim();
  const routeKind = handoffRouteKindFromDoc({
    comment: commentStr,
    from_code: fromCode,
    to_code: toCode,
    is_to_sto: isToSto,
  });
  const movedLinesPreload =
    dealId && completed && routeKind ? getDealAlreadyMovedLines(dealId) : undefined;
  const pickSite = resolvePickSiteForDeal(dealId, warehouseId);
  const createdAt = String(row.created_at || '');
  const transferLabel = completed
    ? (isReturn
        ? parseHandoffTransferLabel(commentStr, createdAt) || createdAt
        : parseHandoffCompletedLabel(commentStr) ||
          parseHandoffTransferLabel(commentStr, createdAt))
    : parseHandoffTransferLabel(commentStr, createdAt);
  const lines = all(
    `SELECT l.qty, l.product_id,
            IFNULL(l.warehouse_id,'') AS warehouse_id,
            IFNULL(p.sku,'') AS sku, IFNULL(p.name,'') AS name,
            IFNULL(wl.name,'') AS warehouse_name
     FROM stock_doc_lines l
     LEFT JOIN products p ON p.id = l.product_id
     LEFT JOIN warehouses wl ON wl.id = l.warehouse_id
     WHERE l.doc_id = ?
     ORDER BY l.line_no ASC, l.id ASC`,
    [id]
  ) as Array<Record<string, unknown>>;
  const enrichedLines = lines.map((l) => enrichHandoffLine(l, warehouseId, pickSite));
  const deal = dealId ? dealPickContext(dealId) : null;
  const warehouseToIdRaw = String(row.warehouse_to_id || '').trim();
  const isReserve =
    !isToSto && !isReturn && dealId
      ? buildHandoffReserveMeta(dealId, warehouseId, warehouseToIdRaw || undefined)
      : null;
  const reserve = isReserve;
  const ship =
    !isToSto && !isReturn && !reserve && dealId
      ? buildHandoffShipMeta(dealId, warehouseId)
      : null;
  const flowMeta = reserve || ship;
  let warehouseToId = warehouseToIdRaw;
  if (!completed && !isToSto && !isReturn && flowMeta?.dest_warehouse_id && warehouseToId !== flowMeta.dest_warehouse_id) {
    run(`UPDATE stock_docs SET warehouse_to_id = ? WHERE id = ?`, [
      flowMeta.dest_warehouse_id,
      id,
    ]);
    warehouseToId = flowMeta.dest_warehouse_id;
  }
  const qtySum = enrichedLines.reduce((s, l) => s + (Number(l.qty) || 0), 0);
  const isReorder = /дозаказ/i.test(commentStr);
  const alreadyShipped =
    dealId && routeKind
      ? dealSkipLinesOnRoute(dealId, routeKind, { beforeDocId: id })
      : [];
  const shippedMap = new Map(alreadyShipped.map((s) => [s.product_id, s]));
  const amountFresh =
    get<{ amount: number }>(`SELECT IFNULL(amount,0) AS amount FROM stock_docs WHERE id = ?`, [id])
      ?.amount ?? Number(row.amount) ?? 0;
  const toStoRoute =
    isToSto
      ? [fromName || '—', toNameRaw || 'СТО'].join(' → ')
      : '';
  const docRoute =
    fromName && toNameRaw ? `${fromName} → ${toNameRaw}` : fromName || toNameRaw || '';
  const byCodesReserve =
    !isToSto &&
    !isReturn &&
    (/^STO-RS[VE]/.test(toCode) || /^STO-RS[VE]/.test(fromCode));
  // Маршрут на карточке — склады документа. Meta — только для черновика без warehouse_to.
  const toName =
    toNameRaw ||
    (!completed ? String(flowMeta?.dest_warehouse_name || '').trim() : '') ||
    '';
  const routeLabel = isToSto
    ? toStoRoute || (fromName && toName ? `${fromName} → ${toName}` : docRoute)
    : fromName && toName
      ? `${fromName} → ${toName}`
      : docRoute;
  return {
    id,
    number: String(row.number || ''),
    deal_id: dealId,
    transfer_label: transferLabel,
    completed_label: completed ? transferLabel : '',
    is_completed: completed,
    created_at: createdAt,
    warehouse_id: warehouseId,
    warehouse_name: fromName,
    warehouse_to_id: warehouseToId || '',
    warehouse_to_name: toName,
    is_reserve: !!reserve?.is_reserve || byCodesReserve,
    is_ship: !!ship?.is_ship,
    is_to_sto: isToSto,
    is_return: isReturn,
    is_reorder: isReorder,
    already_moved_lines: [],
    already_moved_brief:
      !completed && dealId && routeKind && alreadyShipped.length
        ? [
            `Сделка ${dealId} · ${routeLabel} · ☐ — к сборке, ✓ — уже отгружено`,
          ]
        : [],
    already_shipped_lines: alreadyShipped,
    skip_lines: alreadyShipped.filter((s) => !enrichedLines.some((l) => String(l.product_id) === s.product_id)),
    purpose_label: isReturn
      ? 'Возврат на основной'
      : isToSto
        ? ( /СРОЧНО на СТО/i.test(commentStr) ? 'СРОЧНО на СТО' : 'Спуск на СТО / самовывоз' )
        : flowMeta?.purpose_label || (byCodesReserve ? 'Резерв' : ''),
    route_label: routeLabel,
    dest_warehouse_name: toName,
    pick_site: pickSite,
    pick_site_label: pickSiteLabel(pickSite),
    amount: Number(amountFresh) || 0,
    lines_count: lines.length,
    qty_sum: qtySum,
    deal,
    lines: enrichedLines.map((l) => {
      const pid = String(l.product_id || '');
      const shipped = shippedMap.get(pid);
      let doneCell = '';
      if (completed) {
        if (dealId && routeKind) {
          doneCell =
            handoffLineDoneCell(dealId, id, pid, routeKind, commentStr, movedLinesPreload) ||
            '';
        }
        if (!doneCell) doneCell = parseCellFromDocComment(commentStr);
        if (!doneCell && isReturn) {
          // meta возврата: куда положили на основной
          try {
            const raw = get<{ value: string }>(
              `SELECT value FROM meta WHERE key = ?`,
              [`stock_return_pending:${dealId}`]
            )?.value;
            if (raw) {
              const meta = JSON.parse(String(raw)) as {
                lines?: Array<{ product_id?: string; to_cell_code?: string; origin_cell_code?: string }>;
              };
              const ml = (meta.lines || []).find((x) => String(x.product_id || '') === pid);
              doneCell = String(ml?.to_cell_code || ml?.origin_cell_code || '').trim();
            }
          } catch {
            /* ignore */
          }
        }
        if (!doneCell) doneCell = String(l.cells_label || '').trim();
      }
      return {
      product_id: pid,
      sku: String(l.sku || ''),
      article: String(l.article || l.sku || ''),
      name: String(l.name || ''),
      qty: Number(l.qty) || 0,
      warehouse_id: String(l.warehouse_id || l.from_warehouse_id || ''),
      warehouse_name: String(l.warehouse_name || l.from_warehouse_name || ''),
      from_warehouse_id: String(l.from_warehouse_id || l.warehouse_id || ''),
      from_warehouse_name: String(l.from_warehouse_name || l.warehouse_name || ''),
      barcode: String(l.barcode || ''),
      code: String(l.code || ''),
      stock_qty: Number(l.stock_qty) || 0,
      stock_wh: Array.isArray(l.stock_wh) ? l.stock_wh : [],
      cells_label: String(l.cells_label || ''),
      cells: l.cells || [],
      is_done: completed,
      already_shipped: !!shipped,
      needs_pick: !shipped,
      shipped_cell: String(shipped?.cell_code || ''),
      done_cell: doneCell,
    };
    }),
    doc_href: `/docs/${encodeURIComponent(id)}`,
    print_href: isReturn
      ? `/api/warehouse/pick/returns/${encodeURIComponent(dealId)}/print`
      : `/api/warehouse/pick/handoffs/${encodeURIComponent(id)}/print`,
    print_label: isReturn ? 'Приходная' : 'Расходная',
    deal_href: dealId ? `/crm/deals/${encodeURIComponent(dealId)}` : '',
  };
}

import { executeStoPartsFromTask } from './sto-parts-execute.js';
import { notifyAmoHandoffReturn, notifyAmoWarehousePacked } from './amo-pick-handoff.js';

const HANDOFF_RETURN_META = (dealId: string) => `handoff_return:${String(dealId || '').trim()}`;

export type HandoffReturnState = {
  at: string;
  at_iso: string;
  comment: string;
  actor_id?: string;
  actor_name?: string;
};

export function getHandoffReturnState(dealId: string): HandoffReturnState | null {
  const id = String(dealId || '').trim();
  if (!id) return null;
  const row = get<{ value: string }>(`SELECT value FROM meta WHERE key = ?`, [
    HANDOFF_RETURN_META(id),
  ]);
  if (!row?.value) return null;
  try {
    const parsed = JSON.parse(String(row.value)) as HandoffReturnState;
    if (!parsed || typeof parsed !== 'object') return null;
    if (!String(parsed.comment || '').trim()) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function clearHandoffReturnState(dealId: string): void {
  const id = String(dealId || '').trim();
  if (!id) return;
  run(`DELETE FROM meta WHERE key = ?`, [HANDOFF_RETURN_META(id)]);
}

/** «Сделал» на iPad: handed, либо ready если шлюз оплаты. */
export function markTaskDone(input: { id: string; actor_id?: string }) {
  const task = get('SELECT * FROM warehouse_tasks WHERE id = ?', [input.id]) as
    | {
        id: string;
        status: string;
        channel: string;
        deal_id: string;
        payment_required: number;
      }
    | undefined;
  if (!task) throw new Error('Задание не найдено');
  if (['handed', 'cancelled'].includes(String(task.status))) {
    throw new Error('Задание уже закрыто');
  }
  const ch = String(task.channel || '');
  // Производство: перемещение на/с PROD-WIP без обязательных марок (serials_optional).
  if (ch !== 'production_send' && ch !== 'production_receive') {
    assertStoTaskSerialsReady(input.id);
  }
  const status: TaskStatus = canHandToCourier(task) ? 'handed' : 'ready';
  // sto_parts: сначала перемещение (иначе handed без остатка на складе курьера)
  let sto_execute: Record<string, unknown> | undefined;
  if (String(task.channel) === 'sto_parts' && status === 'handed') {
    sto_execute = executeStoPartsFromTask({ task_id: input.id, actor_id: input.actor_id }) as Record<
      string,
      unknown
    >;
  }
  const row = setTaskStatus({ id: input.id, status, actor_id: input.actor_id });
  return sto_execute ? { ...row, sto_execute } : row;
}

/** Кладовщик собрал передачу на склад: провести черновик расходной. */

/** Кладовщик на /pick сменил склад-источник строки непроведённой передачи. */
export function setHandoffPickLineSource(input: {
  doc_id: string;
  product_id: string;
  warehouse_id: string;
}): Record<string, unknown> {
  const docId = String(input.doc_id || '').trim();
  const productId = String(input.product_id || '').trim();
  const warehouseId = String(input.warehouse_id || '').trim();
  if (!docId || !productId || !warehouseId) {
    throw new Error('Нужны doc_id, product_id и warehouse_id');
  }

  const doc = get<{
    id: string;
    doc_type: string;
    posted: number;
    deal_id: string;
    comment: string;
    warehouse_id: string;
  }>(
    `SELECT id, doc_type, IFNULL(posted,0) AS posted, IFNULL(deal_id,'') AS deal_id,
            IFNULL(comment,'') AS comment, IFNULL(warehouse_id,'') AS warehouse_id
     FROM stock_docs WHERE id = ?`,
    [docId]
  );
  if (!doc) throw new Error('Документ не найден');
  if (Number(doc.posted) === 1) throw new Error('Уже проведена');
  if (String(doc.doc_type) !== 'out') throw new Error('Не расходная');
  if (!/Передача на склад/i.test(String(doc.comment || ''))) {
    throw new Error('Не передача на склад');
  }

  const whOk = get<{ id: string }>(
    `SELECT id FROM warehouses WHERE id = ? AND IFNULL(is_active,1)=1`,
    [warehouseId]
  );
  if (!whOk?.id) throw new Error('Склад не найден');

  const dealId = String(doc.deal_id || '').trim();
  const site = resolvePickSiteForDeal(dealId, String(doc.warehouse_id || '').trim());
  const allowed = new Set(handoffDisplayWarehouses(site).map((w) => w.id));
  try {
    allowed.add(handoffMainWarehouseIdForSite(site));
    const hold = handoffHoldWarehouseIdForSite(site);
    if (hold) allowed.add(hold);
  } catch {
    /* ignore */
  }
  if (allowed.size && !allowed.has(warehouseId)) {
    throw new Error('Этот склад нельзя выбрать источником для контура');
  }

  const line = get<{ id: string }>(
    `SELECT id FROM stock_doc_lines WHERE doc_id = ? AND product_id = ? LIMIT 1`,
    [docId, productId]
  );
  if (!line) throw new Error('Строка документа не найдена');

  run(
    `UPDATE stock_doc_lines SET warehouse_id = ? WHERE doc_id = ? AND product_id = ?`,
    [warehouseId, docId, productId]
  );

  const lineWhs = all<{ warehouse_id: string }>(
    `SELECT IFNULL(warehouse_id,'') AS warehouse_id FROM stock_doc_lines WHERE doc_id = ?`,
    [docId]
  );
  const votes = new Map<string, number>();
  for (const l of lineWhs) {
    const wid = String(l.warehouse_id || '').trim() || warehouseId;
    votes.set(wid, (votes.get(wid) || 0) + 1);
  }
  let headerWh = warehouseId;
  let best = -1;
  for (const [wid, n] of votes) {
    if (n > best) {
      best = n;
      headerWh = wid;
    }
  }
  run(`UPDATE stock_docs SET warehouse_id = ? WHERE id = ?`, [headerWh, docId]);

  const row = get(
    `SELECT d.*, IFNULL(w.name,'') AS warehouse_name,
            IFNULL(wt.name,'') AS warehouse_to_name,
            IFNULL(w.code,'') AS warehouse_from_code,
            IFNULL(wt.code,'') AS warehouse_to_code,
            IFNULL(d.amount,0) AS amount
     FROM stock_docs d
     LEFT JOIN warehouses w ON w.id = d.warehouse_id
     LEFT JOIN warehouses wt ON wt.id = d.warehouse_to_id
     WHERE d.id = ?`,
    [docId]
  ) as Record<string, unknown>;
  return mapHandoffPickRow(row, '', false);
}

/** Списать ячейки по picks кладовщика (1 pick = 1 шт). */
async function applyHandoffPicksToCells(
  picks: HandoffPickUnitInput[] | undefined,
  fromWarehouseId: string
): Promise<void> {
  const fromWh = String(fromWarehouseId || '').trim();
  if (!fromWh || !Array.isArray(picks) || !picks.length) return;
  const agg = new Map<string, { product_id: string; cell_code: string; qty: number }>();
  for (const p of picks) {
    const pid = String(p.product_id || '').trim();
    const cell = String(p.cell_code || '').trim();
    if (!pid || !cell || cell === '—' || cell === '-' || cell === '–') continue;
    const key = `${pid}::${cell}`;
    const prev = agg.get(key);
    if (prev) prev.qty += 1;
    else agg.set(key, { product_id: pid, cell_code: cell, qty: 1 });
  }
  if (!agg.size) return;
  try {
    const { applyCellIssueDelta } = await import('./warehouse-cells.js');
    for (const row of agg.values()) {
      try {
        applyCellIssueDelta({
          warehouse_id: fromWh,
          cell_code: row.cell_code,
          product_id: row.product_id,
          qty: row.qty,
        });
      } catch {
        /* ячейка необязательна */
      }
    }
  } catch {
    /* cells module optional */
  }
}

export async function completeHandoffPick(
  docId: string,
  actorId?: string,
  picks?: HandoffPickUnitInput[]
): Promise<Record<string, unknown>> {
  const id = String(docId || '').trim();
  if (!id) throw new Error('Нет id расходной');
  const doc = get<{
    id: string;
    doc_type: string;
    posted: number;
    deal_id: string;
    comment: string;
    number: string;
    warehouse_id: string;
    warehouse_to_id: string | null;
  }>(
    `SELECT id, doc_type, IFNULL(posted,0) AS posted, IFNULL(deal_id,'') AS deal_id,
            IFNULL(comment,'') AS comment, IFNULL(number,'') AS number,
            IFNULL(warehouse_id,'') AS warehouse_id, warehouse_to_id
     FROM stock_docs WHERE id = ?`,
    [id]
  );
  if (!doc) throw new Error('Расходная не найдена');
  if (Number(doc.posted) === 1) throw new Error('Уже проведена');
  if (String(doc.doc_type) !== 'out') throw new Error('Не расходная');
  if (!/Передача на склад/i.test(String(doc.comment || ''))) {
    throw new Error('Не передача на склад');
  }
  syncUnpostedHandoffDocLines(id);
  const dealId = String(doc.deal_id || '').trim();
  const packLabel = formatMoscowLabel(new Date());
  let packTag = `Склад ГОТОВО · ${packLabel}`;
  if (Array.isArray(picks) && picks.length) {
    const cellBits = picks
      .map((p) => {
        const code = String(p.cell_code || '').trim();
        return code ? code : '';
      })
      .filter(Boolean);
    if (cellBits.length) {
      packTag += ` · яч: ${[...new Set(cellBits)].slice(0, 8).join(', ')}`;
    }
    run(`INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)`, [
      `handoff_picks:${id}`,
      JSON.stringify({ at: new Date().toISOString(), picks, actor_id: actorId || '' }),
    ]);
  }
  const comment = String(doc.comment || '');
  const isToSto = isToStoHandoffComment(comment);

  // Спуск Резерв → СТО: не путать с обычным резервированием (buildHandoffReserveMeta).
  if (isToSto) {
    const fromWh = String(doc.warehouse_id || '').trim();
    const toWh = String(doc.warehouse_to_id || '').trim() || stoWarehouseId();
    if (!fromWh || !toWh) throw new Error('Нет складов для спуска на СТО');
    const fromName =
      get<{ name: string }>(
        `SELECT IFNULL(name,'') AS name FROM warehouses WHERE id = ?`,
        [fromWh]
      )?.name || 'Отложено под СТО';
    const toName =
      get<{ name: string }>(
        `SELECT IFNULL(name,'') AS name FROM warehouses WHERE id = ?`,
        [toWh]
      )?.name || 'СТО';
    const route = `${fromName} → ${toName}`;
    const rawLines = all<{
      product_id: string;
      qty: number;
      serials_json: string;
    }>(
      `SELECT product_id, qty, IFNULL(serials_json,'[]') AS serials_json
       FROM stock_doc_lines WHERE doc_id = ? ORDER BY line_no ASC, id ASC`,
      [id]
    );
    const lines = rawLines
      .filter((l) => !isServiceProduct(l.product_id))
      .map((l) => ({
        product_id: l.product_id,
        qty: Number(l.qty) || 0,
        warehouse_id: fromWh,
        serials: (JSON.parse(String(l.serials_json || '[]')) as string[]) || [],
      }))
      .filter((l) => l.qty > 0);
    if (!lines.length) throw new Error('Нет строк для спуска на СТО');

    const transferDocId = createDocument({
      doc_type: 'transfer',
      warehouse_id: fromWh,
      warehouse_to_id: toWh,
      deal_id: dealId,
      comment: `${comment} · ${packTag} · ${route}`,
      lines,
      post: true,
      serials_optional: true,
      ignore_stock: true,
    });
    await applyHandoffPicksToCells(picks, fromWh);
    const postedDoc = get('SELECT * FROM stock_docs WHERE id = ?', [transferDocId]) as Record<
      string,
      unknown
    >;
    run('BEGIN');
    try {
      run('DELETE FROM stock_doc_lines WHERE doc_id = ?', [id]);
      run('DELETE FROM stock_docs WHERE id = ?', [id]);
      run('COMMIT');
    } catch (e) {
      run('ROLLBACK');
      throw e instanceof Error ? e : new Error('to-sto transfer failed');
    }
    if (dealId) {
      try {
        const { snapshotDealFlowLines } = await import('./deal-stock-flow.js');
        snapshotDealFlowLines(dealId);
      } catch {
        /* optional */
      }
      let actorName = '';
      if (actorId) {
        actorName = String(
          get<{ name: string }>(
            `SELECT IFNULL(name,'') AS name FROM staff WHERE id = ? OR amo_id = ? LIMIT 1`,
            [actorId, actorId]
          )?.name || ''
        ).trim();
      }
      const ch =
        get<{ amo_channel: string }>(
          `SELECT IFNULL(amo_channel,'') AS amo_channel FROM crm_deals WHERE id = ?`,
          [dealId]
        )?.amo_channel || '';
      const docNum = String(postedDoc?.number || '').trim();
      const noteText = [
        'Склад: перемещение',
        route,
        docNum,
        String(ch || '').trim() || 'Самовывоз',
        packLabel,
        actorName,
      ]
        .filter(Boolean)
        .join(' · ');
      try {
        await notifyAmoWarehousePacked({ dealId, text: noteText });
      } catch {
        /* note → очередь внутри notify */
      }
    }
    return {
      ok: true,
      doc_id: transferDocId,
      is_to_sto: true,
      is_reserve: false,
      is_ship: false,
      reserve_warehouse: toName,
      number: String(postedDoc?.number || ''),
      deal_id: dealId,
      doc: postedDoc,
    };
  }

  const reserveMeta = dealId
    ? buildHandoffReserveMeta(
        dealId,
        String(doc.warehouse_id || '').trim(),
        String(doc.warehouse_to_id || '').trim() || undefined
      )
    : null;
  const shipMeta =
    !reserveMeta && dealId
      ? buildHandoffShipMeta(dealId, String(doc.warehouse_id || '').trim())
      : null;
  const xferMeta = reserveMeta || shipMeta;

  let postedDoc: Record<string, unknown> | null = null;
  let transferDocId = '';

  if (xferMeta) {
    const rawLines = all<{
      product_id: string;
      qty: number;
      warehouse_id: string;
      serials_json: string;
    }>(
      `SELECT product_id, qty, IFNULL(warehouse_id,'') AS warehouse_id, IFNULL(serials_json,'[]') AS serials_json
       FROM stock_doc_lines WHERE doc_id = ? ORDER BY line_no ASC, id ASC`,
      [id]
    );
    const lines = rawLines
      .filter((l) => !isServiceProduct(l.product_id))
      .map((l) => ({
        product_id: l.product_id,
        qty: Number(l.qty) || 0,
        warehouse_id: String(l.warehouse_id || '').trim() || xferMeta.from_warehouse_id,
        serials: (JSON.parse(String(l.serials_json || '[]')) as string[]) || [],
      }))
      .filter((l) => l.qty > 0);
    if (!lines.length) throw new Error('Нет строк для перемещения');

    let transferFromWh = String(xferMeta.from_warehouse_id || '').trim();
    {
      const votes = new Map<string, number>();
      for (const l of lines) {
        const wid = String(l.warehouse_id || transferFromWh).trim() || transferFromWh;
        votes.set(wid, (votes.get(wid) || 0) + 1);
      }
      let best = -1;
      for (const [wid, n] of votes) {
        if (n > best) {
          best = n;
          transferFromWh = wid;
        }
      }
    }

    const prevComment = reserveMeta
      ? ensureReserveHandoffComment(String(doc.comment || '').trim())
      : String(doc.comment || '').trim();
    // На /pick кладовщик уже подтвердил набор: stock_balances часто пуст
    // (остатки в ячейках MSK / ФИЛИАЛ), без ignoreStock — «Недостаточно остатка».
    transferDocId = createDocument({
      doc_type: 'transfer',
      warehouse_id: transferFromWh,
      warehouse_to_id: xferMeta.dest_warehouse_id,
      deal_id: dealId,
      comment: `${prevComment} · ${packTag} · ${xferMeta.route_label}`,
      lines,
      post: true,
      serials_optional: true,
      ignore_stock: true,
    });
    postedDoc = get('SELECT * FROM stock_docs WHERE id = ?', [transferDocId]) as Record<string, unknown>;
    await applyHandoffPicksToCells(picks, transferFromWh);

    run('BEGIN');
    try {
      run('DELETE FROM stock_doc_lines WHERE doc_id = ?', [id]);
      run('DELETE FROM stock_docs WHERE id = ?', [id]);
      run('COMMIT');
    } catch (e) {
      run('ROLLBACK');
      throw e instanceof Error ? e : new Error('handoff transfer failed');
    }
    if (dealId && shipMeta) {
      try {
        const { ensureCourierShipRun } = await import('./sto-parts-courier.js');
        ensureCourierShipRun({
          deal_id: dealId,
          stock_doc_id: transferDocId,
          stock_doc_number: String(postedDoc?.number || ''),
          route_label: shipMeta.route_label,
          from_warehouse_id: shipMeta.from_warehouse_id,
          actor_id: actorId,
        });
      } catch {
        /* задание курьеру — best effort */
      }
    }
    if (dealId) {
      try {
        const { snapshotDealFlowLines } = await import('./deal-stock-flow.js');
        snapshotDealFlowLines(dealId);
      } catch {
        /* snapshot optional */
      }
    }
  } else {
    postDocument(id, { serialsOptional: true, ignoreStock: true });
    const prevComment = String(doc.comment || '').trim();
    if (!/Склад ГОТОВО/i.test(prevComment)) {
      run(`UPDATE stock_docs SET comment = ? WHERE id = ?`, [
        prevComment ? `${prevComment} · ${packTag}` : packTag,
        id,
      ]);
    }
    postedDoc = get('SELECT * FROM stock_docs WHERE id = ?', [id]) as Record<string, unknown>;
    await applyHandoffPicksToCells(picks, String(doc.warehouse_id || '').trim());
  }

  let amoNote: { ok: boolean; error?: string } | undefined;
  if (dealId) {
    let actorName = '';
    if (actorId) {
      actorName = String(
        get<{ name: string }>(
          `SELECT IFNULL(name,'') AS name FROM staff WHERE id = ? OR amo_id = ? LIMIT 1`,
          [actorId, actorId]
        )?.name || ''
      ).trim();
    }
    const routeLabel = String(xferMeta?.route_label || '').trim();
    const destName = String(
      reserveMeta?.dest_warehouse_name || shipMeta?.dest_warehouse_name || ''
    ).trim();
    const docNum = String((postedDoc?.number as string) || doc.number || '').trim();
    const noteText = xferMeta
      ? [
          'Склад: перемещение',
          routeLabel || (destName ? `→ ${destName}` : ''),
          docNum,
          packLabel,
          actorName,
        ]
          .filter(Boolean)
          .join(' · ')
      : ['Склад: упаковка завершена', docNum, packLabel, actorName].filter(Boolean).join(' · ');
    try {
      amoNote = await notifyAmoWarehousePacked({ dealId, text: noteText });
    } catch (e) {
      amoNote = { ok: false, error: e instanceof Error ? e.message : 'amo note failed' };
    }
  }
  const postedDocFinal =
    postedDoc || (get('SELECT * FROM stock_docs WHERE id = ?', [transferDocId || id]) as Record<string, unknown>);
  return {
    ok: true,
    doc_id: transferDocId || id,
    out_doc_id: reserveMeta ? id : undefined,
    transfer_doc_id: transferDocId || undefined,
    is_reserve: !!reserveMeta,
    is_ship: !!shipMeta,
    reserve_warehouse: reserveMeta?.dest_warehouse_name || shipMeta?.dest_warehouse_name || '',
    number: String((postedDocFinal?.number as string) || doc.number || ''),
    deal_id: dealId,
    doc: postedDocFinal,
  };
}

/** Завершить передачу на склад по amo deal_id (если в UI нет id расходной). */
export async function completeHandoffPickByDeal(
  dealId: string,
  actorId?: string,
  picks?: HandoffPickUnitInput[]
): Promise<Record<string, unknown>> {
  const deal = String(dealId || '').trim();
  if (!deal) throw new Error('Нет id сделки');
  const doc = get<{ id: string }>(
    `SELECT id FROM stock_docs
     WHERE doc_type = 'out'
       AND IFNULL(posted,0) = 0
       AND TRIM(IFNULL(deal_id,'')) = ?
       AND IFNULL(comment,'') LIKE '%Передача на склад%'
     ORDER BY datetime(created_at) DESC
     LIMIT 1`,
    [deal]
  );
  if (!doc) throw new Error('Черновик расходной не найден');
  return completeHandoffPick(String(doc.id), actorId, picks);
}

function handoffPickActorName(actorId?: string): string {
  if (!actorId) return '';
  return String(
    get<{ name: string }>(
      `SELECT IFNULL(name,'') AS name FROM staff WHERE id = ? OR amo_id = ? LIMIT 1`,
      [actorId, actorId]
    )?.name || ''
  ).trim();
}

/** Склад не собрал передачу: удалить черновик, задача в Amo, статус «вернулось со склада». */
export async function cancelHandoffPick(
  docId: string,
  comment: string,
  actorId?: string
): Promise<Record<string, unknown>> {
  const id = String(docId || '').trim();
  const commentClean = String(comment || '').trim();
  if (!id) throw new Error('Нет id расходной');
  if (!commentClean) throw new Error('Укажите комментарий');

  const doc = get<{
    id: string;
    doc_type: string;
    posted: number;
    deal_id: string;
    comment: string;
    number: string;
  }>(
    `SELECT id, doc_type, IFNULL(posted,0) AS posted, IFNULL(deal_id,'') AS deal_id,
            IFNULL(comment,'') AS comment, IFNULL(number,'') AS number
     FROM stock_docs WHERE id = ?`,
    [id]
  );
  if (!doc) throw new Error('Расходная не найдена');
  if (Number(doc.posted) === 1) throw new Error('Уже проведена — отменить нельзя');
  if (String(doc.doc_type) !== 'out') throw new Error('Не расходная');
  if (!/Передача на склад/i.test(String(doc.comment || ''))) {
    throw new Error('Не передача на склад');
  }

  const dealId = String(doc.deal_id || '').trim();
  const actorName = handoffPickActorName(actorId);
  const returnLabel = formatMoscowLabel(new Date());
  const returnMeta: HandoffReturnState = {
    at: returnLabel,
    at_iso: new Date().toISOString(),
    comment: commentClean,
    ...(actorId ? { actor_id: actorId } : {}),
    ...(actorName ? { actor_name: actorName } : {}),
  };

  run('BEGIN');
  try {
    run('DELETE FROM stock_doc_lines WHERE doc_id = ?', [id]);
    run('DELETE FROM stock_docs WHERE id = ?', [id]);
    run('COMMIT');
  } catch (e) {
    run('ROLLBACK');
    throw e instanceof Error ? e : new Error('cancel failed');
  }

  if (dealId) {
    run(`INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)`, [
      HANDOFF_RETURN_META(dealId),
      JSON.stringify(returnMeta),
    ]);
  }

  if (dealId) {
    const taskText = `Склад: не собрали · ${commentClean}`;
    const noteText = actorName
      ? `${taskText} · ${returnLabel} · ${actorName}`
      : `${taskText} · ${returnLabel}`;
    // Amo — в фоне: ответ /pick не ждёт CLI (иначе таймаут 25 с на iPad).
    void notifyAmoHandoffReturn({ dealId, text: taskText }).catch(() => {});
    void notifyAmoWarehousePacked({ dealId, text: noteText }).catch(() => {});
  }

  return {
    ok: true,
    doc_id: id,
    number: String(doc.number || ''),
    deal_id: dealId,
    return: returnMeta,
  };
}

/** Отмена передачи по amo deal_id. */
export async function cancelHandoffPickByDeal(
  dealId: string,
  comment: string,
  actorId?: string
): Promise<Record<string, unknown>> {
  const deal = String(dealId || '').trim();
  if (!deal) throw new Error('Нет id сделки');
  const doc = get<{ id: string }>(
    `SELECT id FROM stock_docs
     WHERE doc_type = 'out'
       AND IFNULL(posted,0) = 0
       AND TRIM(IFNULL(deal_id,'')) = ?
       AND IFNULL(comment,'') LIKE '%Передача на склад%'
     ORDER BY datetime(created_at) DESC
     LIMIT 1`,
    [deal]
  );
  if (!doc) throw new Error('Черновик расходной не найден');
  return cancelHandoffPick(String(doc.id), comment, actorId);
}

function findTaskIdByBarcode(barcode: string): string {
  const code = String(barcode || '').trim();
  if (!code) throw new Error('Штрихкод пуст');
  const task = get(
    `SELECT id FROM warehouse_tasks WHERE barcode = ? OR number = ? LIMIT 1`,
    [code, code]
  ) as { id: string } | undefined;
  if (!task) throw new Error('Задание по штрихкоду не найдено');
  return task.id;
}

function parseLineDims(raw: unknown): Record<string, unknown> {
  try {
    if (typeof raw === 'string') return JSON.parse(raw || '{}') || {};
    if (raw && typeof raw === 'object') return { ...(raw as Record<string, unknown>) };
  } catch {
    /* ignore */
  }
  return {};
}

function compactScanCode(s: string): string {
  return String(s || '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '');
}

/** Эквиваленты товара — только сам id (номенклатура из 1С, без дедуп-мастеров). */
function equivalentProductIds(productId: string): string[] {
  const id = String(productId || '').trim();
  return id ? [id] : [];
}

type TaskLineProduct = {
  line_id: string;
  product_id: string;
  name: string;
  sku: string;
  qty: number;
  dims_json: string;
  line_no: number;
};

function loadTaskLineProducts(taskId: string): TaskLineProduct[] {
  return all<TaskLineProduct>(
    `SELECT id AS line_id, product_id, IFNULL(name,'') AS name, IFNULL(sku,'') AS sku,
            qty, IFNULL(dims_json,'{}') AS dims_json, line_no
     FROM warehouse_task_lines WHERE task_id = ? ORDER BY line_no`,
    [taskId]
  );
}

/** Все product_id задания + дедуп-эквиваленты → линия задания. */
function taskProductUniverse(taskId: string): {
  lines: TaskLineProduct[];
  universeIds: string[];
  lineProductByAnyId: Map<string, string>;
  lineByProductId: Map<string, TaskLineProduct>;
} {
  const lines = loadTaskLineProducts(taskId);
  const lineProductByAnyId = new Map<string, string>();
  const lineByProductId = new Map<string, TaskLineProduct>();
  const universeIds: string[] = [];
  for (const l of lines) {
    const pid = String(l.product_id || '').trim();
    if (!pid) continue;
    lineByProductId.set(pid, l);
    for (const eq of equivalentProductIds(pid)) {
      if (!lineProductByAnyId.has(eq)) lineProductByAnyId.set(eq, pid);
      universeIds.push(eq);
    }
  }
  return {
    lines,
    universeIds: [...new Set(universeIds)],
    lineProductByAnyId,
    lineByProductId,
  };
}

/** Найти product_id из вселенной задания по ШК / артикулу / коду / дедупу / номеру детали. */
function matchTaskProductsByAnyCode(
  qRaw: string,
  universeIds: string[],
  lines?: TaskLineProduct[]
): Array<{ product_id: string; how: string; exact: boolean }> {
  const q = String(qRaw || '').trim();
  if (!q) return [];
  if (!universeIds.length && !(lines || []).length) return [];
  const compact = compactScanCode(q);
  const qLower = q.toLowerCase();
  const placeholders = universeIds.map(() => '?').join(',');
  const out: Array<{ product_id: string; how: string; exact: boolean }> = [];
  const seen = new Set<string>();
  const push = (productId: string, how: string, exact: boolean) => {
    const id = String(productId || '').trim();
    if (!id || seen.has(id) || !universeIds.includes(id)) return;
    seen.add(id);
    out.push({ product_id: id, how, exact });
  };
  const pushLine = (productId: string, how: string, exact: boolean) => {
    const id = String(productId || '').trim();
    if (!id || seen.has(id)) return;
    seen.add(id);
    out.push({ product_id: id, how, exact });
  };

  // Совпадение по строкам задания (артикул/название в WS, не только products)
  for (const l of lines || []) {
    const pid = String(l.product_id || '').trim();
    if (!pid) continue;
    const skuC = compactScanCode(l.sku);
    const nameL = String(l.name || '').toLowerCase();
    if (skuC && skuC === compact) pushLine(pid, 'артикул позиции', true);
    else if (skuC && compact.length >= 2 && skuC.includes(compact)) {
      pushLine(pid, 'артикул позиции', false);
    } else if (nameL.includes(qLower) && q.length >= 2) {
      pushLine(pid, 'название позиции', false);
    }
  }

  if (!universeIds.length) return out;

  const rows = all<{
    id: string;
    sku: string;
    code: string;
    barcode: string;
    gtin: string;
    array_sku: string;
    warehouse_sku: string;
    name: string;
  }>(
    `SELECT id,
            IFNULL(sku,'') AS sku,
            IFNULL(code,'') AS code,
            IFNULL(barcode,'') AS barcode,
            IFNULL(gtin,'') AS gtin,
            IFNULL(array_sku,'') AS array_sku,
            IFNULL(warehouse_sku,'') AS warehouse_sku,
            IFNULL(name,'') AS name
     FROM products WHERE id IN (${placeholders})`,
    universeIds
  );
  for (const r of rows) {
    const id = String(r.id || '').trim();
    const skuC = compactScanCode(r.sku);
    const codeC = compactScanCode(r.code);
    const bcC = compactScanCode(r.barcode);
    const gtinC = compactScanCode(r.gtin);
    const nameL = String(r.name || '').toLowerCase();
    if (skuC && skuC === compact) push(id, 'артикул', true);
    else if (codeC && codeC === compact) push(id, 'код', true);
    else if (bcC && bcC === compact) push(id, 'ШК', true);
    else if (gtinC && gtinC === compact) push(id, 'GTIN', true);
    else if (compact.length >= 2 && skuC.includes(compact)) push(id, 'артикул', false);
    else if (compact.length >= 2 && codeC.includes(compact)) push(id, 'код', false);
    else if (compact.length >= 2 && bcC.includes(compact)) push(id, 'ШК', false);
    else if (nameL.includes(qLower) && q.length >= 2) push(id, 'название', false);
    else if (String(r.warehouse_sku || '').toLowerCase().includes(qLower) && q.length >= 2) {
      const parts = String(r.warehouse_sku || '')
        .split(/[,;\n|/]+/)
        .map((x) => compactScanCode(x))
        .filter(Boolean);
      if (parts.some((p) => p === compact)) push(id, 'складской артикул', true);
      else push(id, 'складской артикул', false);
    } else if (String(r.array_sku || '').toLowerCase().includes(qLower) && q.length >= 2) {
      const parts = String(r.array_sku || '')
        .split(/[,;\n|/]+/)
        .map((x) => compactScanCode(x))
        .filter(Boolean);
      if (parts.some((p) => p === compact)) push(id, 'артикулы строкой', true);
      else if (parts.some((p) => p.includes(compact) || compact.includes(p))) {
        push(id, 'артикулы строкой', false);
      } else {
        push(id, 'артикулы строкой', false);
      }
    }
  }

  return out;
}

function findTaskLineForProduct(
  uni: ReturnType<typeof taskProductUniverse>,
  productId: string
): TaskLineProduct | null {
  const linePid = uni.lineProductByAnyId.get(String(productId || '').trim()) || '';
  if (!linePid) return null;
  return uni.lineByProductId.get(linePid) || null;
}

function provenanceForSerial(serial: string): {
  supplier_name: string;
  in_doc_number: string;
  in_doc_date: string;
  in_doc_id: string;
} {
  const provenance = get<{
    supplier_name: string;
    in_doc_number: string;
    in_doc_date: string;
    in_doc_id: string;
  }>(
    `SELECT IFNULL(cp.name,'') AS supplier_name,
            IFNULL(d.number,'') AS in_doc_number,
            IFNULL(substr(d.doc_date,1,10),'') AS in_doc_date,
            IFNULL(u.in_doc_id,'') AS in_doc_id
     FROM product_units u
     LEFT JOIN stock_docs d ON d.id = u.in_doc_id
     LEFT JOIN counterparties cp ON cp.id = d.counterparty_id
     WHERE lower(u.serial) = lower(?)
     LIMIT 1`,
    [serial]
  );
  return {
    supplier_name: String(provenance?.supplier_name || '').trim() || '—',
    in_doc_number: String(provenance?.in_doc_number || '').trim() || '—',
    in_doc_date: String(provenance?.in_doc_date || '').trim(),
    in_doc_id: String(provenance?.in_doc_id || '').trim(),
  };
}

function writeTaskLineSerial(input: {
  taskId: string;
  taskStatus: string;
  line: TaskLineProduct;
  serialCode: string;
  matchedBy: string;
  scannedCode: string;
  actorId?: string;
}): { already: boolean; picked: number; need: number; serials: string[] } {
  const dims = parseLineDims(input.line.dims_json);
  const serials = Array.isArray(dims.serials)
    ? (dims.serials as unknown[]).map((s) => String(s || '').trim()).filter(Boolean)
    : [];
  const need = Math.max(1, Math.ceil(Number(input.line.qty) || 1));
  const serialCode = String(input.serialCode || '').trim();
  const already = serials.some((s) => s.toLowerCase() === serialCode.toLowerCase());
  if (!already) {
    if (serials.length >= need) {
      throw new Error(`По «${input.line.name || input.line.sku}» уже набрано ${need} шт.`);
    }
    serials.push(serialCode);
    dims.serials = serials;
    // обновить dims_json в памяти линии — следующие вызовы в том же запросе видят свежие
    input.line.dims_json = JSON.stringify(dims);
    run(`UPDATE warehouse_task_lines SET dims_json = ? WHERE id = ?`, [
      input.line.dims_json,
      input.line.line_id,
    ]);
    if (String(input.taskStatus) === 'new') {
      run(
        `UPDATE warehouse_tasks SET status = 'picking', updated_at = datetime('now') WHERE id = ?`,
        [input.taskId]
      );
    } else {
      run(`UPDATE warehouse_tasks SET updated_at = datetime('now') WHERE id = ?`, [input.taskId]);
    }
    logTask(input.taskId, 'unit.scanned', input.actorId, {
      serial: serialCode,
      product_id: input.line.product_id,
      line_id: input.line.line_id,
      picked: serials.length,
      need,
      matched_by: input.matchedBy,
      scanned_code: input.scannedCode,
    });
  }
  return { already, picked: serials.length, need, serials };
}

/** Снять выбранный экземпляр со строки задания (удалить / изменить). */
export function clearUnitFromWarehouseTask(
  taskId: string,
  opts: { line_idx?: number | string; serial?: string; actor_id?: string }
): {
  ok: true;
  cleared: string[];
  line_idx: number;
  picked: number;
  need: number;
  task: Record<string, unknown>;
} {
  const taskIdN = String(taskId || '').trim();
  if (!taskIdN) throw new Error('Не указано задание');
  const taskRow = get<{ id: string; status: string }>(
    `SELECT id, status FROM warehouse_tasks WHERE id = ?`,
    [taskIdN]
  );
  if (!taskRow) throw new Error('Задание не найдено');
  if (['handed', 'cancelled'].includes(String(taskRow.status))) {
    throw new Error('Задание уже закрыто — нельзя менять экземпляры');
  }
  const uni = taskProductUniverse(taskIdN);
  const lineIdx = Math.max(0, Math.floor(Number(opts.line_idx) || 0));
  const line = uni.lines[lineIdx];
  if (!line) throw new Error('Строка задания не найдена');

  const dims = parseLineDims(line.dims_json);
  const serials = Array.isArray(dims.serials)
    ? (dims.serials as unknown[]).map((s) => String(s || '').trim()).filter(Boolean)
    : [];
  const want = String(opts.serial || '').trim();
  let cleared: string[] = [];
  let next: string[];
  if (want) {
    next = serials.filter((s) => s.toLowerCase() !== want.toLowerCase());
    cleared = serials.filter((s) => s.toLowerCase() === want.toLowerCase());
    if (!cleared.length) throw new Error(`Экземпляр «${want}» на строке не найден`);
  } else {
    cleared = [...serials];
    next = [];
  }
  dims.serials = next;
  run(`UPDATE warehouse_task_lines SET dims_json = ? WHERE id = ?`, [
    JSON.stringify(dims),
    line.line_id,
  ]);
  run(`UPDATE warehouse_tasks SET updated_at = datetime('now') WHERE id = ?`, [taskIdN]);
  logTask(taskIdN, 'unit.cleared', opts.actor_id, {
    line_id: line.line_id,
    line_idx: lineIdx,
    cleared,
    product_id: line.product_id,
  });
  const need = Math.max(1, Math.ceil(Number(line.qty) || 1));
  const task = getTask(taskIdN);
  if (!task) throw new Error('Задание не найдено');
  return {
    ok: true,
    cleared,
    line_idx: lineIdx,
    picked: next.length,
    need,
    task,
  };
}

/**
 * Вручную указать № экземпляра на строке задания.
 * Если марки ещё нет в учёте — создаём in_stock на основном складе (начинает учитываться).
 */
export function assignManualSerialToWarehouseTask(
  taskId: string,
  opts: { line_idx?: number | string; serial?: string; actor_id?: string }
): {
  ok: true;
  serial: string;
  created_unit: boolean;
  picked: number;
  need: number;
  task: Record<string, unknown>;
} {
  const taskIdN = String(taskId || '').trim();
  const serial = String(opts.serial || '').trim();
  if (!taskIdN) throw new Error('Не указано задание');
  if (!serial || serial.length < 2) throw new Error('Введите номер экземпляра');
  if (/^bc:/i.test(serial)) throw new Error('Это не номер экземпляра');

  const taskRow = get<{ id: string; status: string; number: string; barcode: string }>(
    `SELECT id, status, number, barcode FROM warehouse_tasks WHERE id = ?`,
    [taskIdN]
  );
  if (!taskRow) throw new Error('Задание не найдено');
  if (['handed', 'cancelled'].includes(String(taskRow.status))) {
    throw new Error('Задание уже закрыто');
  }
  if (
    String(taskRow.barcode || '') === serial ||
    String(taskRow.number || '') === serial
  ) {
    throw new Error('Это ШК задания, а не номер экземпляра товара');
  }

  const uni = taskProductUniverse(taskIdN);
  const lineIdx = Math.max(0, Math.floor(Number(opts.line_idx) || 0));
  const line = uni.lines[lineIdx];
  if (!line) throw new Error('Строка задания не найдена');

  const need = Math.max(1, Math.ceil(Number(line.qty) || 1));
  const existing = findUnitBySerial(serial);
  let created_unit = false;
  if (existing) {
    const eq = new Set(equivalentProductIds(line.product_id));
    if (!eq.has(String(existing.product_id || '').trim())) {
      throw new Error(
        `Номер «${serial}» уже учтён за другим товаром (${existing.sku || existing.product_name || existing.product_id})`
      );
    }
    if (String(existing.status) !== 'in_stock') {
      throw new Error(
        `Экземпляр «${serial}» не на складе (статус: ${existing.status})`
      );
    }
  } else {
    // новый экземпляр — начинаем учёт
    const wh = mainWarehouseId() || '';
    const now = new Date().toISOString();
    run(
      `INSERT INTO product_units
        (id, product_id, serial, warehouse_id, status, in_doc_id, in_line_id, out_doc_id, out_line_id, comment, apps_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'in_stock', '', '', '', '', ?, '[]', ?, ?)`,
      [
        newGuid(),
        line.product_id,
        serial,
        wh,
        `добавлен на сборке ${taskRow.number || taskIdN}`,
        now,
        now,
      ]
    );
    created_unit = true;
  }

  // заменить текущие (в т.ч. bc:) на этот номер
  const dims = parseLineDims(line.dims_json);
  dims.serials = [serial];
  line.dims_json = JSON.stringify(dims);
  run(`UPDATE warehouse_task_lines SET dims_json = ? WHERE id = ?`, [
    line.dims_json,
    line.line_id,
  ]);
  if (String(taskRow.status) === 'new') {
    run(
      `UPDATE warehouse_tasks SET status = 'picking', updated_at = datetime('now') WHERE id = ?`,
      [taskIdN]
    );
  } else {
    run(`UPDATE warehouse_tasks SET updated_at = datetime('now') WHERE id = ?`, [taskIdN]);
  }
  logTask(taskIdN, 'unit.manual', opts.actor_id, {
    serial,
    created_unit,
    product_id: line.product_id,
    line_id: line.line_id,
    line_idx: lineIdx,
  });

  const task = getTask(taskIdN);
  if (!task) throw new Error('Задание не найдено');
  return {
    ok: true,
    serial,
    created_unit,
    picked: 1,
    need,
    task,
  };
}

/** Остатки / ячейки / экземпляры по строке задания — выбор «со склада» на /pick. */
export function listStockForWarehouseTaskLine(
  taskId: string,
  lineIdxRaw: number | string
): {
  line_idx: number;
  product_id: string;
  sku: string;
  code: string;
  barcode: string;
  name: string;
  need: number;
  picked: number;
  used_serials: string[];
  balances: Array<{ warehouse_id: string; warehouse_name: string; qty: number }>;
  cells: Array<{
    cell_code: string;
    qty: number;
    rack: string;
    bay: string;
    level: string;
    supplies: Array<{ supply: string; qty: number }>;
    serials: Array<{
      serial: string;
      supplier_name: string;
      in_doc_number: string;
      in_doc_date: string;
      warehouse_name: string;
    }>;
  }>;
  units: Array<{
    serial: string;
    product_id: string;
    sku: string;
    product_name: string;
    warehouse_id: string;
    warehouse_name: string;
    supplier_name: string;
    in_doc_number: string;
    in_doc_date: string;
  }>;
  pick_code: string;
  can_pick_without_mark: boolean;
} {
  const taskIdN = String(taskId || '').trim();
  const lineIdx = Math.max(0, Math.floor(Number(lineIdxRaw) || 0));
  if (!taskIdN) throw new Error('Не указано задание');
  const uni = taskProductUniverse(taskIdN);
  const line = uni.lines[lineIdx];
  if (!line) throw new Error('Строка задания не найдена');

  const pid = String(line.product_id || '').trim();
  const eqIds = equivalentProductIds(pid);
  const p = get<{ sku: string; code: string; barcode: string; name: string; gtin: string }>(
    `SELECT IFNULL(sku,'') AS sku, IFNULL(code,'') AS code,
            IFNULL(barcode,'') AS barcode, IFNULL(name,'') AS name,
            IFNULL(gtin,'') AS gtin
     FROM products WHERE id = ?`,
    [pid]
  );
  const sku = String(line.sku || p?.sku || '').trim();
  const code = String(p?.code || '').trim();
  const barcode = String(p?.barcode || p?.gtin || '').trim();
  const name = String(line.name || p?.name || '').trim();
  const dims = parseLineDims(line.dims_json);
  const used = Array.isArray(dims.serials)
    ? (dims.serials as unknown[]).map((s) => String(s || '').trim()).filter(Boolean)
    : [];
  const need = Math.max(1, Math.ceil(Number(line.qty) || 1));
  const usedLower = new Set(used.map((s) => s.toLowerCase()));

  const ph = eqIds.map(() => '?').join(',');
  const balances = eqIds.length
    ? all<{ warehouse_id: string; warehouse_name: string; qty: number }>(
        `SELECT b.warehouse_id AS warehouse_id,
                IFNULL(w.name,'') AS warehouse_name,
                SUM(b.qty) AS qty
         FROM stock_balances b
         LEFT JOIN warehouses w ON w.id = b.warehouse_id
         WHERE b.product_id IN (${ph}) AND b.qty > 0.0001
         GROUP BY b.warehouse_id
         ORDER BY qty DESC`,
        eqIds
      )
    : [];

  let cells: Array<{
    cell_code: string;
    qty: number;
    rack: string;
    bay: string;
    level: string;
    supplies: Array<{ supply: string; qty: number }>;
    serials: Array<{
      serial: string;
      supplier_name: string;
      in_doc_number: string;
      in_doc_date: string;
      warehouse_name: string;
    }>;
  }> = [];
  try {
    ensureWarehouseCellsSchema();
    const skus = [
      ...new Set(
        [
          sku,
          ...all<{ sku: string }>(
            `SELECT IFNULL(sku,'') AS sku FROM products WHERE id IN (${ph})`,
            eqIds
          ).map((r) => String(r.sku || '').trim()),
        ].filter(Boolean)
      ),
    ];
    if (skus.length) {
      const sph = skus.map(() => '?').join(',');
      const cellRows = all<{
        cell_code: string;
        qty: number;
        rack: string;
        bay: string;
        level: string;
        supply: string;
      }>(
        `SELECT c.code AS cell_code, b.qty AS qty,
                IFNULL(c.rack,'') AS rack, IFNULL(c.bay,'') AS bay, IFNULL(c.level,'') AS level,
                IFNULL(b.supply,'') AS supply
         FROM stock_cell_balances b
         JOIN warehouse_cells c ON c.id = b.cell_id
         WHERE (b.product_id IN (${ph}) OR b.sku IN (${sph})) AND b.qty > 0
         ORDER BY c.code, b.qty DESC`,
        [...eqIds, ...skus]
      );
      const byCode = new Map<string, (typeof cells)[0]>();
      for (const row of cellRows) {
        const codeCell = String(row.cell_code || '').trim();
        if (!codeCell) continue;
        let cur = byCode.get(codeCell);
        if (!cur) {
          cur = {
            cell_code: codeCell,
            qty: 0,
            rack: String(row.rack || ''),
            bay: String(row.bay || ''),
            level: String(row.level || ''),
            supplies: [],
            serials: [],
          };
          byCode.set(codeCell, cur);
        }
        const q = Number(row.qty) || 0;
        cur.qty += q;
        const supply = String(row.supply || '').trim() || 'без поставки';
        const prev = cur.supplies.find((s) => s.supply === supply);
        if (prev) prev.qty += q;
        else cur.supplies.push({ supply, qty: q });
      }
      cells = [...byCode.values()].sort((a, b) => b.qty - a.qty || a.cell_code.localeCompare(b.cell_code));
    }
  } catch {
    cells = [];
  }

  const unitsRaw = eqIds.length
    ? all<{
        serial: string;
        product_id: string;
        sku: string;
        product_name: string;
        warehouse_id: string;
        warehouse_name: string;
        supplier_name: string;
        in_doc_number: string;
        in_doc_date: string;
      }>(
        `SELECT u.serial AS serial, u.product_id AS product_id,
                IFNULL(p.sku,'') AS sku, IFNULL(p.name,'') AS product_name,
                IFNULL(u.warehouse_id,'') AS warehouse_id,
                IFNULL(w.name,'') AS warehouse_name,
                IFNULL(cp.name,'') AS supplier_name,
                IFNULL(d.number,'') AS in_doc_number,
                IFNULL(substr(d.doc_date,1,10),'') AS in_doc_date
         FROM product_units u
         LEFT JOIN products p ON p.id = u.product_id
         LEFT JOIN warehouses w ON w.id = u.warehouse_id
         LEFT JOIN stock_docs d ON d.id = u.in_doc_id
         LEFT JOIN counterparties cp ON cp.id = d.counterparty_id
         WHERE u.product_id IN (${ph}) AND u.status = 'in_stock'
         ORDER BY IFNULL(u.created_at,''), u.serial
         LIMIT 40`,
        eqIds
      )
    : [];
  const units = unitsRaw.filter((u) => !usedLower.has(String(u.serial || '').trim().toLowerCase()));

  // Марки к ячейкам пока не привязаны — показываем список экземпляров у первой/главной ячейки
  if (cells.length && units.length) {
    cells[0].serials = units.slice(0, 20).map((u) => ({
      serial: String(u.serial || '').trim(),
      supplier_name: String(u.supplier_name || '').trim() || '—',
      in_doc_number: String(u.in_doc_number || '').trim() || '—',
      in_doc_date: String(u.in_doc_date || '').trim(),
      warehouse_name: String(u.warehouse_name || '').trim() || '—',
    }));
  }

  const qtyOnHand = balances.reduce((s, b) => s + (Number(b.qty) || 0), 0);
  const requiresMark = productRequiresSerials(pid);
  const pick_code = barcode || sku || code || pid;
  const can_pick_without_mark = !requiresMark && qtyOnHand > 0.0001 && Boolean(pick_code);

  return {
    line_idx: lineIdx,
    product_id: pid,
    sku,
    code,
    barcode,
    name,
    need,
    picked: used.length,
    used_serials: used,
    balances: balances.map((b) => ({
      warehouse_id: String(b.warehouse_id || ''),
      warehouse_name: String(b.warehouse_name || '').trim() || '—',
      qty: Number(b.qty) || 0,
    })),
    cells: cells.slice(0, 30).map((c) => ({
      cell_code: c.cell_code,
      qty: c.qty,
      rack: c.rack,
      bay: c.bay,
      level: c.level,
      supplies: c.supplies,
      serials: c.serials,
    })),
    units: units.map((u) => ({
      serial: String(u.serial || '').trim(),
      product_id: String(u.product_id || '').trim(),
      sku: String(u.sku || '').trim(),
      product_name: String(u.product_name || '').trim(),
      warehouse_id: String(u.warehouse_id || ''),
      warehouse_name: String(u.warehouse_name || '').trim() || '—',
      supplier_name: String(u.supplier_name || '').trim() || '—',
      in_doc_number: String(u.in_doc_number || '').trim() || '—',
      in_doc_date: String(u.in_doc_date || '').trim(),
    })),
    pick_code,
    can_pick_without_mark,
  };
}

/** Скан Data Matrix / серийника / ШК / артикула / дедупа в открытое задание. */
export function scanUnitIntoWarehouseTask(
  taskId: string,
  codeRaw: string,
  opts?: { actor_id?: string }
): {
  kind: 'unit';
  already?: boolean;
  serial: string;
  picked: number;
  need: number;
  product_name: string;
  sku: string;
  code?: string;
  supplier_name: string;
  in_doc_number: string;
  in_doc_date: string;
  in_doc_id: string;
  matched_by?: string;
  task: Record<string, unknown>;
} {
  const taskIdN = String(taskId || '').trim();
  const code = String(codeRaw || '').trim();
  if (!taskIdN) throw new Error('Не указано задание');
  if (!code) throw new Error('Пустой код');

  const taskRow = get<{ id: string; status: string; number: string; barcode: string }>(
    `SELECT id, status, number, barcode FROM warehouse_tasks WHERE id = ?`,
    [taskIdN]
  );
  if (!taskRow) throw new Error('Задание не найдено');
  if (['handed', 'cancelled'].includes(String(taskRow.status))) {
    throw new Error('Задание уже закрыто');
  }
  if (
    String(taskRow.barcode || '') === code ||
    String(taskRow.number || '') === code ||
    String(taskRow.number || '').replace(/-/g, '') === code.replace(/-/g, '')
  ) {
    throw new Error('Это ШК задания — откройте задание, затем сканируйте марку с товара');
  }

  const uni = taskProductUniverse(taskIdN);
  let unit = findUnitBySerial(code) || null;
  let matchedBy = 'номер экземпляра';
  let lineHit: TaskLineProduct | null = null;

  if (!unit) {
    const hits = matchTaskProductsByAnyCode(code, uni.universeIds, uni.lines);
    if (!hits.length) {
      throw new Error(
        'Не найдено: марка / ШК / артикул / код / номер детали в этом задании'
      );
    }
    const hit = hits.find((h) => h.exact) || hits[0];
    lineHit = findTaskLineForProduct(uni, hit.product_id);
    if (!lineHit) {
      throw new Error(`Товар по «${code}» не входит в задание ${taskRow.number}`);
    }
    const dims0 = parseLineDims(lineHit.dims_json);
    const used = Array.isArray(dims0.serials)
      ? (dims0.serials as unknown[]).map((s) => String(s || '').trim()).filter(Boolean)
      : [];
    const mainWh = mainWarehouseId();
    const tryIds = equivalentProductIds(lineHit.product_id);
    for (const pid of tryIds) {
      const next = findNextInStockUnitForProduct(pid, {
        warehouseId: mainWh || undefined,
        excludeSerials: used,
      });
      if (next) {
        unit = next;
        matchedBy = hit.how;
        break;
      }
    }
    if (!unit) {
      // Нет марок на остатке: для товаров без serial_tracked — токен bc: (как в сделках)
      if (productRequiresSerials(lineHit.product_id)) {
        throw new Error(
          `По «${code}» (${hit.how}) нет свободного экземпляра на складе — отсканируйте марку`
        );
      }
      const bal = get<{ c: number }>(
        `SELECT COUNT(*) AS c FROM stock_balances
         WHERE product_id IN (${tryIds.map(() => '?').join(',')}) AND qty > 0.0001`,
        tryIds
      );
      if (!bal || !Number(bal.c)) {
        throw new Error(`Нет остатка по «${lineHit.sku || lineHit.name || code}» на складе`);
      }
      matchedBy = hit.how;
      const dims = parseLineDims(lineHit.dims_json);
      const have = Array.isArray(dims.serials)
        ? (dims.serials as unknown[]).map((s) => String(s || '').trim()).filter(Boolean)
        : [];
      const token = `bc:${code}:${have.length + 1}`;
      const wrote = writeTaskLineSerial({
        taskId: taskIdN,
        taskStatus: String(taskRow.status),
        line: lineHit,
        serialCode: token,
        matchedBy,
        scannedCode: code,
        actorId: opts?.actor_id,
      });
      const pMeta = get<{ code: string }>(
        `SELECT IFNULL(code,'') AS code FROM products WHERE id = ?`,
        [lineHit.product_id]
      );
      const task = getTask(taskIdN);
      if (!task) throw new Error('Задание не найдено');
      return {
        kind: 'unit',
        already: wrote.already,
        serial: token,
        picked: wrote.picked,
        need: wrote.need,
        product_name: String(lineHit.name || ''),
        sku: String(lineHit.sku || ''),
        code: String(pMeta?.code || '').trim(),
        supplier_name: 'со склада',
        in_doc_number: '—',
        in_doc_date: '',
        in_doc_id: '',
        matched_by: matchedBy,
        task,
      };
    }
  }

  if (String(unit.status) !== 'in_stock') {
    throw new Error(
      `Экземпляр «${unit.serial || code}» не на складе (статус: ${unit.status}). Нужен in_stock`
    );
  }
  const mainWh = mainWarehouseId();
  if (mainWh && String(unit.warehouse_id || '') && String(unit.warehouse_id) !== mainWh) {
    throw new Error(
      `Экземпляр «${unit.serial || code}» на другом складе (${unit.warehouse_name || unit.warehouse_id})`
    );
  }

  const line =
    findTaskLineForProduct(uni, String(unit.product_id || '')) ||
    uni.lineByProductId.get(String(unit.product_id || '').trim()) ||
    null;
  if (!line) {
    throw new Error(
      `Товар «${unit.product_name || unit.sku || code}» не входит в задание ${taskRow.number}`
    );
  }

  const serialCode = String(unit.serial || '').trim() || code;
  const wrote = writeTaskLineSerial({
    taskId: taskIdN,
    taskStatus: String(taskRow.status),
    line,
    serialCode,
    matchedBy,
    scannedCode: code,
    actorId: opts?.actor_id,
  });

  const provenance = provenanceForSerial(serialCode);
  const pMeta = get<{ code: string }>(
    `SELECT IFNULL(code,'') AS code FROM products WHERE id = ?`,
    [line.product_id]
  );
  const task = getTask(taskIdN);
  if (!task) throw new Error('Задание не найдено');
  return {
    kind: 'unit',
    already: wrote.already,
    serial: serialCode,
    picked: wrote.picked,
    need: wrote.need,
    product_name: String(unit.product_name || line.name || ''),
    sku: String(unit.sku || line.sku || ''),
    code: String(pMeta?.code || '').trim(),
    supplier_name: provenance.supplier_name,
    in_doc_number: provenance.in_doc_number,
    in_doc_date: provenance.in_doc_date,
    in_doc_id: provenance.in_doc_id,
    matched_by: matchedBy,
    task,
  };
}

/** Поиск экземпляров: марка / ШК / артикул / дедуп / номер детали — в рамках задания. */
export function lookupUnitsForWarehouseTask(
  taskId: string,
  qRaw: string,
  opts?: { limit?: number }
): Array<{
  serial: string;
  product_id: string;
  product_name: string;
  sku: string;
  status: string;
  exact: boolean;
  how: string;
  supplier_name: string;
  in_doc_number: string;
  in_doc_date: string;
  line_idx: number;
}> {
  const taskIdN = String(taskId || '').trim();
  const q = String(qRaw || '').trim();
  if (!taskIdN || q.length < 2) return [];
  const limit = Math.min(20, Math.max(1, Number(opts?.limit) || 8));
  const uni = taskProductUniverse(taskIdN);
  if (!uni.universeIds.length) return [];

  const placeholders = uni.universeIds.map(() => '?').join(',');
  const qLower = q.toLowerCase();
  const seen = new Set<string>();
  const out: Array<{
    serial: string;
    product_id: string;
    product_name: string;
    sku: string;
    status: string;
    exact: boolean;
    how: string;
    supplier_name: string;
    in_doc_number: string;
    in_doc_date: string;
    line_idx: number;
  }> = [];

  const pushUnit = (
    row: {
      serial: string;
      product_id: string;
      status: string;
      product_name: string;
      sku: string;
      supplier_name: string;
      in_doc_number: string;
      in_doc_date: string;
    },
    how: string,
    exact: boolean
  ) => {
    const serial = String(row.serial || '').trim();
    const key = serial.toLowerCase();
    if (!serial || seen.has(key)) return;
    const linePid =
      uni.lineProductByAnyId.get(String(row.product_id || '').trim()) ||
      String(row.product_id || '').trim();
    const line = uni.lineByProductId.get(linePid);
    if (!line) return;
    seen.add(key);
    out.push({
      serial,
      product_id: linePid,
      product_name: String(row.product_name || line.name || ''),
      sku: String(row.sku || line.sku || ''),
      status: String(row.status || ''),
      exact,
      how,
      supplier_name: String(row.supplier_name || '').trim() || '—',
      in_doc_number: String(row.in_doc_number || '').trim() || '—',
      in_doc_date: String(row.in_doc_date || '').trim(),
      line_idx: Math.max(0, (Number(line.line_no) || 1) - 1),
    });
  };

  const unitSelect = `SELECT u.serial AS serial, u.product_id AS product_id, u.status AS status,
            IFNULL(p.name,'') AS product_name, IFNULL(p.sku,'') AS sku,
            IFNULL(cp.name,'') AS supplier_name,
            IFNULL(d.number,'') AS in_doc_number,
            IFNULL(substr(d.doc_date,1,10),'') AS in_doc_date
     FROM product_units u
     LEFT JOIN products p ON p.id = u.product_id
     LEFT JOIN stock_docs d ON d.id = u.in_doc_id
     LEFT JOIN counterparties cp ON cp.id = d.counterparty_id`;

  for (const r of all<{
    serial: string;
    product_id: string;
    status: string;
    product_name: string;
    sku: string;
    supplier_name: string;
    in_doc_number: string;
    in_doc_date: string;
  }>(
    `${unitSelect}
     WHERE u.product_id IN (${placeholders}) AND lower(u.serial) = ?
     LIMIT 5`,
    [...uni.universeIds, qLower]
  )) {
    pushUnit(r, 'номер экземпляра', true);
  }

  for (const r of all<{
    serial: string;
    product_id: string;
    status: string;
    product_name: string;
    sku: string;
    supplier_name: string;
    in_doc_number: string;
    in_doc_date: string;
  }>(
    `${unitSelect}
     WHERE u.product_id IN (${placeholders})
       AND u.status = 'in_stock'
       AND lower(u.serial) LIKE ?
     ORDER BY length(u.serial) ASC, u.serial ASC
     LIMIT ?`,
    [...uni.universeIds, '%' + qLower + '%', limit]
  )) {
    pushUnit(r, 'номер экземпляра', String(r.serial || '').toLowerCase() === qLower);
  }

  // ШК / артикул / дедуп → свободные экземпляры товара линии
  const prodHits = matchTaskProductsByAnyCode(q, uni.universeIds, uni.lines);
  const mainWh = mainWarehouseId();
  for (const hit of prodHits) {
    const line = findTaskLineForProduct(uni, hit.product_id);
    if (!line) continue;
    const dims = parseLineDims(line.dims_json);
    const used = Array.isArray(dims.serials)
      ? (dims.serials as unknown[]).map((s) => String(s || '').trim()).filter(Boolean)
      : [];
    for (const pid of equivalentProductIds(line.product_id)) {
      const next = findNextInStockUnitForProduct(pid, {
        warehouseId: mainWh || undefined,
        excludeSerials: used,
      });
      if (!next) continue;
      const prov = provenanceForSerial(String(next.serial || ''));
      pushUnit(
        {
          serial: String(next.serial || ''),
          product_id: line.product_id,
          status: String(next.status || 'in_stock'),
          product_name: String(next.product_name || line.name || ''),
          sku: String(next.sku || line.sku || ''),
          supplier_name: prov.supplier_name,
          in_doc_number: prov.in_doc_number,
          in_doc_date: prov.in_doc_date,
        },
        hit.how,
        hit.exact
      );
      break;
    }
  }

  return out.slice(0, limit);
}

/** Для СТО: у каждой позиции должны быть отсканированы экземпляры (марки). */
export function assertStoTaskSerialsReady(taskId: string): void {
  const lines = all<{
    name: string;
    sku: string;
    product_id: string;
    qty: number;
    dims_json: string;
  }>(
    `SELECT name, sku, product_id, qty, IFNULL(dims_json,'{}') AS dims_json
     FROM warehouse_task_lines WHERE task_id = ?`,
    [taskId]
  );
  const missing: string[] = [];
  for (const l of lines) {
    const dims = parseLineDims(l.dims_json);
    const serials = Array.isArray(dims.serials)
      ? (dims.serials as unknown[]).map((s) => String(s || '').trim()).filter(Boolean)
      : [];
    const need = Math.max(1, Math.ceil(Number(l.qty) || 1));
    if (serials.length < need) {
      missing.push(
        `${l.sku || l.name || l.product_id}: марок ${serials.length}/${need}`
      );
    }
  }
  if (missing.length) {
    throw new Error(
      'Сначала отсканируйте или введите номера с марок товаров:\n' + missing.join('\n')
    );
  }
}

/** Скан на /pick: то же, что кнопка «Сделал» (handed или ready по оплате). */
export function scanMarkDone(input: { barcode: string; actor_id?: string }) {
  return markTaskDone({ id: findTaskIdByBarcode(input.barcode), actor_id: input.actor_id });
}

export function scanHandOver(input: { barcode: string; actor_id?: string }) {
  return setTaskStatus({
    id: findTaskIdByBarcode(input.barcode),
    status: 'handed',
    actor_id: input.actor_id,
  });
}

export function packingSlip(taskId: string) {
  const t = getTask(taskId);
  if (!t) throw new Error('not found');
  return {
    title: 'Лист упаковки',
    number: t.number,
    barcode: t.barcode,
    deal_id: t.deal_id,
    city: t.city,
    buyer_name: t.buyer_name,
    channel: t.channel_label,
    track_number: t.track_number,
    amount_locked: t.amount_locked,
    lines: t.lines,
    printed_at: new Date().toISOString(),
  };
}

function minutesBetween(a: string, b: string): number | null {
  const t0 = parseSqliteDt(a);
  const t1 = parseSqliteDt(b);
  if (t0 == null || t1 == null) return null;
  const m = (t1 - t0) / 60000;
  return m >= 0 ? Math.round(m * 10) / 10 : null;
}

function percentile(sorted: number[], p: number): number | null {
  if (!sorted.length) return null;
  if (sorted.length === 1) return sorted[0];
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return Math.round((sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo)) * 10) / 10;
}

function stageStats(values: number[]) {
  const sorted = [...values].filter((n) => Number.isFinite(n) && n >= 0).sort((a, b) => a - b);
  if (!sorted.length) {
    return { count: 0, avg_min: null as number | null, p50_min: null as number | null, p90_min: null as number | null };
  }
  const sum = sorted.reduce((s, n) => s + n, 0);
  return {
    count: sorted.length,
    avg_min: Math.round((sum / sorted.length) * 10) / 10,
    p50_min: percentile(sorted, 0.5),
    p90_min: percentile(sorted, 0.9),
  };
}

/**
 * Отчёт КПД склада по таймингам заданий:
 * created → picked → packed → handed (ready опционально).
 */
export function tasksKpdReport(opts: { days?: number; limit?: number } = {}) {
  const days = Math.min(90, Math.max(1, Number(opts.days) || 14));
  const limit = Math.min(500, Math.max(20, Number(opts.limit) || 200));

  const rows = all(
    `SELECT id, number, status, deal_id, buyer_name, city, channel,
            created_at, picked_at, packed_at, ready_at, handed_at,
            (SELECT actor_id FROM warehouse_task_events e
              WHERE e.task_id = t.id AND e.event LIKE 'status.%'
              ORDER BY datetime(e.created_at) DESC LIMIT 1) AS last_actor_id
     FROM warehouse_tasks t
     WHERE IFNULL(handed_at, '') != ''
       AND date(handed_at) >= date('now', ?)
     ORDER BY datetime(handed_at) DESC
     LIMIT ?`,
    [`-${days} days`, limit]
  ) as Array<Record<string, unknown>>;

  const toPick: number[] = [];
  const toPack: number[] = [];
  const toHand: number[] = [];
  const fullCycle: number[] = [];
  const byDayMap = new Map<
    string,
    { day: string; handed: number; cycle_sum: number; cycle_n: number }
  >();

  const items = rows.map((r) => {
    const created = String(r.created_at || '');
    const picked = String(r.picked_at || '');
    const packed = String(r.packed_at || '');
    const handed = String(r.handed_at || '');
    const mCreatedPicked = minutesBetween(created, picked || packed || handed);
    const mPickedPacked = minutesBetween(picked || created, packed || handed);
    const mPackedHanded = minutesBetween(packed || picked || created, handed);
    const mFull = minutesBetween(created, handed);

    if (mCreatedPicked != null) toPick.push(mCreatedPicked);
    if (mPickedPacked != null) toPack.push(mPickedPacked);
    if (mPackedHanded != null) toHand.push(mPackedHanded);
    if (mFull != null) {
      fullCycle.push(mFull);
      const day = handed.slice(0, 10) || '—';
      const agg = byDayMap.get(day) || { day, handed: 0, cycle_sum: 0, cycle_n: 0 };
      agg.handed += 1;
      agg.cycle_sum += mFull;
      agg.cycle_n += 1;
      byDayMap.set(day, agg);
    }

    return {
      id: r.id,
      number: r.number,
      deal_id: r.deal_id,
      city: r.city,
      channel: r.channel,
      channel_label: channelLabel(String(r.channel || '')),
      buyer_name: r.buyer_name,
      created_at: created,
      picked_at: picked,
      packed_at: packed,
      ready_at: String(r.ready_at || ''),
      handed_at: handed,
      min_created_picked: mCreatedPicked,
      min_picked_packed: mPickedPacked,
      min_packed_handed: mPackedHanded,
      min_full_cycle: mFull,
      last_actor_id: r.last_actor_id || '',
    };
  });

  const by_day = [...byDayMap.values()]
    .sort((a, b) => (a.day < b.day ? 1 : -1))
    .map((d) => ({
      day: d.day,
      handed: d.handed,
      avg_cycle_min: d.cycle_n ? Math.round((d.cycle_sum / d.cycle_n) * 10) / 10 : null,
    }));

  return {
    days,
    sample_size: items.length,
    stages: {
      created_to_picked: stageStats(toPick),
      picked_to_packed: stageStats(toPack),
      packed_to_handed: stageStats(toHand),
      created_to_handed: stageStats(fullCycle),
    },
    by_day,
    items,
  };
}
