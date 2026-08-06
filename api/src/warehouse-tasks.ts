/**
 * Э1 — задания склада (собрать / упаковать / отдать курьеру).
 */
import { all, get, run } from './db.js';
import { newGuid } from './ids.js';
import { getDeal } from './deals.js';
import { paymentRequiredForShip } from './deal-sale-rules.js';
import { cdekWidgetUrl } from './ops.js';
import { cdekConfigured } from './cdek.js';

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
  'dellin',
  'pek',
  'bus',
  'pickup',
  'own_courier',
  'ozon',
  'transfer',
  'inbound',
  'other',
] as const;

const CHANNEL_LABELS: Record<string, string> = {
  cdek_prepaid: 'СДЭК предоплата',
  cdek_cod: 'СДЭК наложка',
  dellin: 'Деловые Линии',
  pek: 'ПЭК',
  bus: 'Автобус',
  pickup: 'Самовывоз',
  own_courier: 'Свой курьер',
  ozon: 'Ozon',
  transfer: 'Перемещение',
  inbound: 'Оприходование',
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

function logTask(taskId: string, event: string, actorId?: string, payload?: Record<string, unknown>) {
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
  const lines = all(
    `SELECT * FROM warehouse_task_lines WHERE task_id = ? ORDER BY line_no, name`,
    [id]
  );
  const events = all(
    `SELECT * FROM warehouse_task_events WHERE task_id = ? ORDER BY datetime(created_at) DESC LIMIT 30`,
    [id]
  );
  const dealId = String(task.deal_id || '');
  const paid = dealId ? dealIsPaid(dealId) : true;
  return {
    ...task,
    lines,
    events,
    channel_label: channelLabel(String(task.channel)),
    status_label: statusLabel(String(task.status)),
    is_paid: paid,
    can_hand: canHandToCourier({
      channel: String(task.channel),
      deal_id: dealId,
      payment_required: Number(task.payment_required),
    }),
    cdek_widget_url: dealId ? cdekWidgetUrl(dealId) : '',
    cdek_native: cdekConfigured(),
  };
}

function nextTaskNumber(): string {
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
  const number = nextTaskNumber();
  const barcode = number.replace(/-/g, '');
  const channel = String(
    input.channel || deal.ship_channel || 'cdek_prepaid'
  ).trim() || 'cdek_prepaid';
  const amount = Number(deal.price || deal.amount || 0) || 0;
  const paymentRequired =
    input.payment_required !== undefined
      ? input.payment_required
      : paymentRequiredForShip(deal as Record<string, unknown>);

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

  logTask(id, 'task.created', input.actor_id, { deal_id: input.deal_id, number });
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
  const number = nextTaskNumber();
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
  const number = nextTaskNumber();
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
    Math.round(amountLocked * 100) / 100,
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
    // Доход / Sheets / income_mirror — не пишем: в таблицы льёт 1С, дубли не нужны.
  }
  logTask(input.id, `status.${input.status}`, input.actor_id, { track, block_reason: reason || undefined });
  return getTask(input.id);
}

/** Тип работы для группировки на /pick (из status + channel, отдельной колонки нет). */
export type PickType =
  | 'pick'
  | 'pack'
  | 'hand'
  | 'cdek'
  | 'pickup'
  | 'courier'
  | 'return'
  | 'transfer'
  | 'inbound'
  | 'other';

export const PICK_TYPE_ORDER: PickType[] = [
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
    pick: 'Сборка',
    pack: 'Упаковка',
    hand: 'Выдача',
    cdek: 'СДЭК',
    pickup: 'Самовывоз',
    courier: 'Свой курьер',
    return: 'Возврат',
    transfer: 'Перемещение',
    inbound: 'Оприходование',
    other: 'Прочее',
  };
  return map[t] || t;
}

export function derivePickType(task: {
  status?: string;
  channel?: string;
  comment?: string;
}): PickType {
  const ch = String(task.channel || '');
  const st = String(task.status || '');
  const comment = String(task.comment || '').toLowerCase();
  if (comment.includes('возврат') || ch === 'return' || comment.includes('return')) {
    return 'return';
  }
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
  return {
    ...t,
    channel_label: channelLabel(String(t.channel || '')),
    status_label: statusLabel(String(t.status || '')),
    pick_type,
    pick_type_label: pickTypeLabel(pick_type),
    urgency: urg.urgency,
    urgency_label: urgencyLabel(urg.urgency),
    urgency_rank: urg.urgency_rank,
    age_hours: urg.age_hours,
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

/** Экран сборщика «без Ани»: сегодня — очередь / сделано / не сделано+почему / следующее. */
export function pickerBoard(day?: string) {
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

  const groups = groupOpenByType(open);
  const next = open[0] || null;
  const urgency_counts = {
    overdue: open.filter((t) => t.urgency === 'overdue').length,
    hot: open.filter((t) => t.urgency === 'hot').length,
    normal: open.filter((t) => t.urgency === 'normal').length,
    wait: open.filter((t) => t.urgency === 'wait').length,
  };
  return {
    day: d,
    title: 'Задачи на сегодня',
    note: 'Список по типам · срочность · сделал / не сделал + почему.',
    counts: {
      open: open.length,
      done: done.length,
      blocked: blocked.length,
    },
    urgency_counts,
    next,
    open,
    groups,
    done,
    blocked,
  };
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
  const status: TaskStatus = canHandToCourier(task) ? 'handed' : 'ready';
  return setTaskStatus({ id: input.id, status, actor_id: input.actor_id });
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
