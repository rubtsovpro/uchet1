/**
 * Э1 — задания склада (собрать / упаковать / отдать курьеру).
 */
import { all, get, run } from './db.js';
import { newGuid } from './ids.js';
import { getDeal } from './deals.js';
import { cdekWidgetUrl } from './ops.js';

export const TASK_STATUSES = [
  'new', // новое
  'picking', // собирают
  'packed', // упаковано
  'ready', // к выдаче
  'handed', // передано курьеру
  'cancelled',
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
    handed: 'Передано',
    cancelled: 'Отменено',
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
  // постоплата / самовывоз — можно без предоплаты
  if (ch === 'cdek_cod' || ch === 'pickup' || ch === 'bus') return true;
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
      `(t.number LIKE ? OR t.deal_id LIKE ? OR IFNULL(t.city,'') LIKE ? OR IFNULL(t.buyer_name,'') LIKE ? OR IFNULL(t.barcode,'') LIKE ?)`
    );
    params.push(like, like, like, like, like);
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
  const paid = dealIsPaid(String(task.deal_id));
  const dealId = String(task.deal_id || '');
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
  const channel = String(input.channel || 'cdek_prepaid').trim() || 'cdek_prepaid';
  const amount = Number(deal.price || deal.amount || 0) || 0;
  const paymentRequired =
    input.payment_required !== undefined
      ? input.payment_required
      : channel !== 'cdek_cod' && channel !== 'pickup' && channel !== 'bus';

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

export function setTaskStatus(input: {
  id: string;
  status: TaskStatus;
  actor_id?: string;
  track_number?: string;
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
  run(`UPDATE warehouse_tasks SET status = ?, updated_at = datetime('now') WHERE id = ?`, [
    input.status,
    input.id,
  ]);
  if (input.status === 'handed') {
    run(
      `UPDATE warehouse_tasks SET handed_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`,
      [input.id]
    );
    // Доход / Sheets / income_mirror — не пишем: в таблицы льёт 1С, дубли не нужны.
  }
  logTask(input.id, `status.${input.status}`, input.actor_id, { track });
  return getTask(input.id);
}

export function scanHandOver(input: { barcode: string; actor_id?: string }) {
  const code = String(input.barcode || '').trim();
  if (!code) throw new Error('Штрихкод пуст');
  const task = get(
    `SELECT * FROM warehouse_tasks WHERE barcode = ? OR number = ? LIMIT 1`,
    [code, code]
  ) as { id: string } | undefined;
  if (!task) throw new Error('Задание по штрихкоду не найдено');
  return setTaskStatus({
    id: task.id,
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
