/**
 * Контур «приход детали на СТО» (решения 07.08.2026):
 * — документ «Задание на СТО» → очередь складу (warehouse_tasks.channel=sto_parts);
 * — исполнение: перемещение / расходная;
 * — Telegram-дубль через бота (уведомление + ссылка);
 * — нал на рынке: приход + касса + контрагент «Рынок»;
 * — курьер: статусы accepted → picked_up → delivered.
 */
import { all, get, run } from './db.js';
import { newGuid, nextCode } from './ids.js';
import { createDocument } from './stock.js';
import { createCashDoc } from './menu-parity.js';
import { telegramSendMessage } from './telegram.js';
import {
  createStoTransferRequest,
  getStoTransferRequest,
  listStoTransferRequests,
  mainWarehouseId,
  stoWarehouseId,
  courierWarehouseId,
  transferSerialToSto,
  archiveObsoleteLogisticsWarehouses,
} from './supply-chain.js';
import { createTaskFromStoParts, getTask, setTaskStatus, dealIsPaid } from './warehouse-tasks.js';
import { executeStoPartsFromTask } from './sto-parts-execute.js';
import { logStoTransferEvent } from './deal-doc-numbers.js';
import { writeOffCourierOnDelivered } from './deal-stock-flow.js';

export type StoPartsSource = 'warehouse' | 'market' | 'courier' | 'nonpneumo' | 'pneumo';

export type StoXferDestCode = 'STO' | 'CDEK' | 'BUS' | 'COURIER' | 'MAIN';

function normalizeSource(s?: string): StoPartsSource {
  const v = String(s || '').trim();
  if (v === 'market' || v === 'courier' || v === 'nonpneumo' || v === 'pneumo') return v;
  return 'warehouse';
}

function normText(s: unknown): string {
  return String(s || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

/** Куда в итоге уходит товар по каналу / способу отправки.
 * СДЭК / автобус / прочие ТК — это точки сдачи курьером;
 * на остатках товар сидит на «Складе курьера», пока курьер не отвёз. */
export function resolveDealXferDestination(deal: Record<string, unknown> | null | undefined): {
  code: StoXferDestCode;
  label: string;
  warehouse_id: string;
  hint: string;
} {
  const channel = normText(deal?.amo_channel);
  const ship = normText(deal?.amo_shipment || deal?.ship_channel);
  // Самовывоз / Автосервис → склад автосервиса (СТО), без склада курьера
  if (/самовывоз/.test(channel) || ship === 'pickup' || /самовывоз/.test(ship)) {
    return {
      code: 'STO',
      label: 'Автосервис (СТО)',
      warehouse_id: stoWarehouseId(),
      hint: 'Самовывоз — товар на складе автосервиса',
    };
  }
  if (/автосервис/.test(channel)) {
    return {
      code: 'STO',
      label: 'Автосервис (СТО)',
      warehouse_id: stoWarehouseId(),
      hint: 'Канал автосервис — товар на СТО',
    };
  }
  // Отправка: СДЭК / автобус / прочие ТК / свой курьер → остатки на складе курьера
  if (/сдэк|cdek/.test(ship)) {
    return {
      code: 'COURIER',
      label: 'Склад курьера',
      warehouse_id: courierWarehouseId(),
      hint: 'СДЭК: товар на складе курьера → курьер везёт в СДЭК',
    };
  }
  if (/автобус|bus/.test(ship)) {
    return {
      code: 'COURIER',
      label: 'Склад курьера',
      warehouse_id: courierWarehouseId(),
      hint: 'Автобус: товар на складе курьера → курьер везёт на автобус',
    };
  }
  if (
    /отправк/.test(channel) ||
    /курьер|прочие|озон|авито|тк\b|courier|own_courier/.test(ship)
  ) {
    return {
      code: 'COURIER',
      label: 'Склад курьера',
      warehouse_id: courierWarehouseId(),
      hint: 'Отправка: товар на складе курьера; списание — когда отвёз',
    };
  }
  return {
    code: 'STO',
    label: 'Автосервис (СТО)',
    warehouse_id: stoWarehouseId(),
    hint: 'По умолчанию — склад автосервиса',
  };
}

export function listStoXferDestOptions(): Array<{ code: StoXferDestCode; label: string; warehouse_id: string }> {
  return [
    { code: 'STO', label: 'Автосервис (СТО)', warehouse_id: stoWarehouseId() },
    { code: 'COURIER', label: 'Склад курьера', warehouse_id: courierWarehouseId() },
  ];
}

function resolveDestWarehouseId(
  deal: Record<string, unknown> | null | undefined,
  destCodeOrId?: string
): { warehouse_id: string; code: string; label: string } {
  const raw = String(destCodeOrId || '').trim();
  const opts = listStoXferDestOptions();
  const byCode = opts.find((o) => o.code === raw || o.warehouse_id === raw);
  if (byCode) return { warehouse_id: byCode.warehouse_id, code: byCode.code, label: byCode.label };
  if (raw) {
    const row = get<{ id: string; code: string; name: string }>(
      `SELECT id, code, name FROM warehouses WHERE id = ? OR code = ? LIMIT 1`,
      [raw, raw]
    );
    if (row?.id) {
      return {
        warehouse_id: row.id,
        code: String(row.code || ''),
        label: String(row.name || row.code || raw),
      };
    }
  }
  const auto = resolveDealXferDestination(deal);
  return { warehouse_id: auto.warehouse_id, code: auto.code, label: auto.label };
}

/** Куда курьер сдаёт привоз: ребрендинг → Основной, иначе → Автосервис. */
export function resolveCourierDropWarehouse(needsRebrand: boolean): {
  warehouse_id: string;
  label: string;
} {
  if (needsRebrand) {
    return { warehouse_id: mainWarehouseId(), label: 'Основной склад (ребрендинг)' };
  }
  return { warehouse_id: stoWarehouseId(), label: 'Автосервис (СТО)' };
}

function publicBaseUrl(): string {
  return (
    (process.env.UCHET_PUBLIC_URL || process.env.WMS_PUBLIC_URL || 'https://uchetn1.ru').replace(
      /\/$/,
      ''
    )
  );
}

function warehouseTgChatIds(): string[] {
  const envChat = (
    process.env.TELEGRAM_WAREHOUSE_CHAT_ID ||
    process.env.WMS_TELEGRAM_WAREHOUSE_CHAT_ID ||
    ''
  ).trim();
  const ids = new Set<string>();
  if (envChat) ids.add(envChat);
  const staffRows = all<{ telegram_chat_id: string }>(
    `SELECT DISTINCT telegram_chat_id FROM staff
     WHERE IFNULL(is_active,1)=1
       AND IFNULL(telegram_chat_id,'') != ''
       AND role IN ('warehouse','admin','courier')`
  );
  for (const r of staffRows) {
    const id = String(r.telegram_chat_id || '').trim();
    if (id) ids.add(id);
  }
  return [...ids];
}

export function ensureStoPartsSchema() {
  const cols = all<{ name: string }>('PRAGMA table_info(sto_transfer_requests)').map((c) => c.name);
  const add = (name: string, ddl: string) => {
    if (!cols.includes(name)) run(`ALTER TABLE sto_transfer_requests ADD COLUMN ${ddl}`);
  };
  add('source', `source TEXT NOT NULL DEFAULT 'warehouse'`);
  add('needs_rebrand', `needs_rebrand INTEGER NOT NULL DEFAULT 0`);
  add('telegram_notified_at', `telegram_notified_at TEXT NOT NULL DEFAULT ''`);
  add('courier_status', `courier_status TEXT NOT NULL DEFAULT ''`);
  add('courier_staff_id', `courier_staff_id TEXT NOT NULL DEFAULT ''`);
  add('market_cash_doc_id', `market_cash_doc_id TEXT NOT NULL DEFAULT ''`);
  add('market_stock_doc_id', `market_stock_doc_id TEXT NOT NULL DEFAULT ''`);
  add('amount', `amount REAL NOT NULL DEFAULT 0`);
  add('transfer_doc_id', `transfer_doc_id TEXT NOT NULL DEFAULT ''`);
  add('out_doc_id', `out_doc_id TEXT NOT NULL DEFAULT ''`);
  add('rebrand_done', `rebrand_done INTEGER NOT NULL DEFAULT 0`);
  add('approve_status', `approve_status TEXT NOT NULL DEFAULT ''`);
  add('approve_mgr_at', `approve_mgr_at TEXT NOT NULL DEFAULT ''`);
  add('approve_dir_at', `approve_dir_at TEXT NOT NULL DEFAULT ''`);
  add('approve_by', `approve_by TEXT NOT NULL DEFAULT ''`);
  add('dest_warehouse_id', `dest_warehouse_id TEXT NOT NULL DEFAULT ''`);
  add('courier_drop_warehouse_id', `courier_drop_warehouse_id TEXT NOT NULL DEFAULT ''`);
  // Склад курьера — единственная точка для отправки; BUS/CDEK не используем
  try {
    courierWarehouseId();
    archiveObsoleteLogisticsWarehouses();
  } catch {
    /* ignore */
  }

  run(`
    CREATE TABLE IF NOT EXISTS courier_runs (
      id TEXT PRIMARY KEY,
      sto_request_id TEXT NOT NULL DEFAULT '',
      warehouse_task_id TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'new',
      title TEXT NOT NULL DEFAULT '',
      comment TEXT NOT NULL DEFAULT '',
      courier_staff_id TEXT NOT NULL DEFAULT '',
      created_by TEXT NOT NULL DEFAULT '',
      accepted_at TEXT NOT NULL DEFAULT '',
      picked_up_at TEXT NOT NULL DEFAULT '',
      delivered_at TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_courier_runs_status ON courier_runs(status);
    CREATE INDEX IF NOT EXISTS idx_courier_runs_courier ON courier_runs(courier_staff_id);
  `);
  try {
    run(`ALTER TABLE courier_runs ADD COLUMN kind TEXT NOT NULL DEFAULT 'pickup'`);
  } catch {
    /* already */
  }
  try {
    run(`ALTER TABLE courier_runs ADD COLUMN deal_id TEXT NOT NULL DEFAULT ''`);
  } catch {
    /* already */
  }
  try {
    run(`ALTER TABLE courier_runs ADD COLUMN stock_doc_id TEXT NOT NULL DEFAULT ''`);
  } catch {
    /* already */
  }
  try {
    run(`CREATE INDEX IF NOT EXISTS idx_courier_runs_deal ON courier_runs(deal_id)`);
  } catch {
    /* already */
  }
}

function ensureMarketCounterparty(): string {
  const existing = get<{ id: string }>(
    `SELECT id FROM counterparties
     WHERE lower(name) IN ('рынок', 'рынок (нал)', 'market')
        OR IFNULL(source,'') = 'market'
     LIMIT 1`
  );
  if (existing?.id) return existing.id;
  const id = newGuid();
  run(
    `INSERT INTO counterparties (id, name, kind, is_active, source)
     VALUES (?, 'Рынок', 'supplier', 1, 'market')`,
    [id]
  );
  return id;
}

async function notifyStoPartsBot(_input: {
  number: string;
  requestId: string;
  taskId?: string;
  source: StoPartsSource;
  needsRebrand: boolean;
  comment?: string;
  linesCount: number;
}) {
  // Отключено по запросу: не слать TG при создании задания на СТО / перемещении.
  return { sent: 0, skipped: 'disabled' as const };
}

/** Создать «Задание на СТО» + очередь складу + дубль в Telegram-бот. */
export async function createStoPartsAssignment(input: {
  deal_id?: string;
  comment?: string;
  created_by?: string;
  actor_id?: string;
  source?: StoPartsSource;
  needs_rebrand?: boolean;
  amount?: number;
  /** Код (STO/CDEK/BUS/COURIER/MAIN) или id склада «Куда». */
  dest_warehouse_id?: string;
  lines: Array<{ product_id: string; qty?: number; serial?: string; name?: string; sku?: string }>;
}) {
  ensureStoPartsSchema();
  const source = normalizeSource(input.source);
  const needsRebrand = !!input.needs_rebrand || source === 'pneumo';
  const lines = (input.lines || []).filter((l) => l.product_id);
  if (!lines.length) throw new Error('Укажите хотя бы одну позицию');

  let dealSnap: Record<string, unknown> | null = null;
  if (input.deal_id) {
    try {
      const { getDeal } = await import('./deals.js');
      dealSnap = getDeal(String(input.deal_id)) as Record<string, unknown> | null;
    } catch {
      dealSnap = null;
    }
  }
  const dest = resolveDestWarehouseId(dealSnap, input.dest_warehouse_id);
  const courierDrop =
    source === 'courier' || source === 'market' || source === 'nonpneumo' || source === 'pneumo'
      ? resolveCourierDropWarehouse(needsRebrand)
      : null;

  const reqRaw = createStoTransferRequest({
    deal_id: input.deal_id,
    comment: input.comment,
    created_by: input.created_by,
    lines: lines.map((l) => ({
      product_id: l.product_id,
      qty: l.qty,
      serial: l.serial,
    })),
  }) as Record<string, unknown> | null;
  if (!reqRaw || !reqRaw.id) throw new Error('Не удалось создать задание');
  const req = reqRaw;

  const approveStatus = source === 'pneumo' ? 'pending' : '';
  run(
    `UPDATE sto_transfer_requests
     SET source = ?, needs_rebrand = ?, amount = ?, approve_status = ?,
         dest_warehouse_id = ?, courier_drop_warehouse_id = ?,
         updated_at = datetime('now')
     WHERE id = ?`,
    [
      source,
      needsRebrand ? 1 : 0,
      Math.max(0, Number(input.amount) || 0),
      approveStatus,
      dest.warehouse_id,
      courierDrop?.warehouse_id || '',
      String(req.id),
    ]
  );

  // Пневма: сначала согласование менеджер → управляющий; курьер/склад — после dir_ok
  if (source === 'pneumo') {
    const tg = await notifyStoPartsBot({
      number: String(req.number),
      requestId: String(req.id),
      source,
      needsRebrand: true,
      comment: `⏳ Согласование пневмы · ${input.comment || ''}`,
      linesCount: lines.length,
    });
    return {
      ...(getStoTransferRequest(String(req.id)) as Record<string, unknown>),
      warehouse_task: null,
      courier_run: null,
      market_cash: null,
      telegram: tg,
      approve_status: 'pending',
      dest,
      courier_drop: courierDrop,
    };
  }

  let warehouse_task: Record<string, unknown> | null = null;
  if (
    source === 'warehouse' ||
    source === 'courier' ||
    source === 'market' ||
    source === 'nonpneumo'
  ) {
    warehouse_task = createTaskFromStoParts({
      sto_request_id: String(req.id),
      sto_request_number: String(req.number || ''),
      deal_id: input.deal_id,
      comment: [
        `Перемещение ${req.number}`,
        `· Основной → ${dest.label}`,
        source === 'warehouse' ? '' : source === 'market' ? '· рынок' : '',
        source === 'courier' ? '· курьер' : '',
        source === 'nonpneumo' ? '· непневмо' : '',
        needsRebrand ? '· ребрендинг' : '',
        input.comment ? `· ${input.comment}` : '',
      ]
        .filter(Boolean)
        .join(' '),
      actor_id: input.actor_id,
      needs_rebrand: needsRebrand,
      dest_label: String(dest.label || ''),
      dest_code: String(dest.code || ''),
      lines: lines.map((l) => ({
        product_id: l.product_id,
        qty: l.qty,
        sku: l.sku,
        name: l.name,
      })),
    }) as Record<string, unknown> | null;
    if (warehouse_task?.id) {
      run(
        `UPDATE sto_transfer_requests
         SET warehouse_task_id = ?, updated_at = datetime('now')
         WHERE id = ?`,
        [String(warehouse_task.id), String(req.id)]
      );
    }
  }

  // Рынок: сразу расход из кассы (сумма ≈). Приход — когда курьер/приёмщик нажал «Сдал».
  let market_cash: Record<string, unknown> | null = null;
  if (source === 'market' || (source === 'nonpneumo' && Number(input.amount) > 0)) {
    const amount = Math.max(0, Number(input.amount) || 0);
    if (source === 'market' && !(amount > 0)) throw new Error('Укажите ориентировочную сумму нал');
    if (amount > 0) {
      const marketId = ensureMarketCounterparty();
      const cashDoc = createCashDoc({
        doc_type: 'out',
        amount,
        counterparty_id: marketId,
        comment: `${source === 'market' ? 'Рынок' : 'Непневмо'} · ${req.number}${
          input.comment ? ' · ' + input.comment : ''
        }`,
      });
      market_cash =
        cashDoc && typeof cashDoc === 'object'
          ? (cashDoc as Record<string, unknown>)
          : null;
      run(
        `UPDATE sto_transfer_requests
         SET market_cash_doc_id = ?, updated_at = datetime('now')
         WHERE id = ?`,
        [market_cash && market_cash.id ? String(market_cash.id) : '', String(req.id)]
      );
    }
  }

  // Курьер / рынок / непневмо — окно статусов; номенклатуру забивает приёмщик.
  let courier_run: Record<string, unknown> | null = null;
  if (source === 'courier' || source === 'market' || source === 'nonpneumo') {
    const runId = newGuid();
    const title =
      source === 'market'
        ? `Рынок · ${req.number}`
        : source === 'nonpneumo'
          ? `Непневмо · ${req.number}`
          : `Курьер · ${req.number}`;
    run(
      `INSERT INTO courier_runs
        (id, sto_request_id, warehouse_task_id, status, kind, title, comment, created_by, created_at, updated_at)
       VALUES (?, ?, ?, 'new', 'pickup', ?, ?, ?, datetime('now'), datetime('now'))`,
      [
        runId,
        String(req.id),
        warehouse_task?.id ? String(warehouse_task.id) : '',
        title,
        String(input.comment || ''),
        String(input.created_by || ''),
      ]
    );
    courier_run = (get(`SELECT * FROM courier_runs WHERE id = ?`, [runId]) || null) as Record<
      string,
      unknown
    > | null;
  }

  const tg = await notifyStoPartsBot({
    number: String(req.number),
    requestId: String(req.id),
    taskId: warehouse_task?.id ? String(warehouse_task.id) : undefined,
    source,
    needsRebrand,
    comment: input.comment,
    linesCount: lines.length,
  });

  return {
    ...(getStoTransferRequest(String(req.id)) as Record<string, unknown>),
    warehouse_task,
    courier_run,
    market_cash,
    telegram: tg,
    dest,
    courier_drop: courierDrop,
  };
}

/** Статус заданий на СТО по заказу: что уже переместили, что в очереди, что досоздать. */
export function getDealStoPartsStatus(dealIdRaw: string) {
  ensureStoPartsSchema();
  const dealId = String(dealIdRaw || '').trim();
  if (!dealId) throw new Error('Не указан заказ');

  const deal = get<{ id: string; name?: string }>(
    `SELECT id, name FROM crm_deals WHERE id = ?`,
    [dealId]
  );
  if (!deal) throw new Error('Заказ покупателя не найден');

  const goods = all<{
    product_id: string;
    qty: number;
    sku: string;
    name: string;
    item_kind: string;
  }>(
    `SELECT
        TRIM(IFNULL(i.product_guid,'')) AS product_id,
        IFNULL(i.qty,0) AS qty,
        IFNULL(p.sku,'') AS sku,
        IFNULL(NULLIF(TRIM(i.name),''), IFNULL(p.name,'')) AS name,
        CASE
          WHEN IFNULL(p.item_kind,'product') = 'service' THEN 'service'
          ELSE 'product'
        END AS item_kind
     FROM crm_deal_items i
     LEFT JOIN products p ON p.id = NULLIF(TRIM(IFNULL(i.product_guid,'')), '')
     WHERE i.deal_id = ?
     ORDER BY i.line_no, i.name`,
    [dealId]
  )
    .filter((g) => g.product_id && g.item_kind !== 'service' && Number(g.qty) > 0)
    .map((g) => ({
      product_id: g.product_id,
      qty: Math.max(1, Math.round(Number(g.qty) || 1)),
      sku: String(g.sku || ''),
      name: String(g.name || ''),
    }));

  const reqRows = listStoTransferRequests({ deal_id: dealId, limit: 40 }) as Array<
    Record<string, unknown>
  >;
  const requests: Array<Record<string, unknown>> = reqRows.map((r) => {
    const detail = getStoTransferRequest(String(r.id)) as Record<string, unknown> | null;
    const base = (detail || r) as Record<string, unknown>;
    const taskId = String(base.warehouse_task_id || '').trim();
    const task = taskId
      ? (get<{ id: string; number: string; status: string }>(
          `SELECT id, number, status FROM warehouse_tasks WHERE id = ?`,
          [taskId]
        ) as { id: string; number: string; status: string } | null)
      : null;
    return {
      ...base,
      warehouse_task: task,
    };
  });

  const doneBy = new Map<string, number>();
  const pendingBy = new Map<string, number>();
  const add = (map: Map<string, number>, pid: string, qty: number) => {
    map.set(pid, (map.get(pid) || 0) + Math.max(0, qty));
  };
  for (const req of requests) {
    const reqLines = (Array.isArray(req.lines) ? req.lines : []) as Array<
      Record<string, unknown>
    >;
    const reqDone = String(req.status || '').toLowerCase() === 'done';
    for (const l of reqLines) {
      const pid = String(l.product_id || '').trim();
      if (!pid) continue;
      const qty = Math.max(1, Math.round(Number(l.qty) || 1));
      const st = String(l.status || 'new').toLowerCase();
      if (reqDone || st === 'done' || st === 'transferred' || st === 'closed') {
        add(doneBy, pid, qty);
      } else {
        add(pendingBy, pid, qty);
      }
    }
  }

  const lines = goods.map((g) => {
    const doneQty = doneBy.get(g.product_id) || 0;
    const pendingQty = pendingBy.get(g.product_id) || 0;
    const remaining = Math.max(0, g.qty - doneQty);
    const to_create = Math.max(0, remaining - pendingQty);
    return {
      ...g,
      done_qty: doneQty,
      pending_qty: pendingQty,
      remaining_qty: remaining,
      to_create_qty: to_create,
    };
  });

  const need = lines.reduce((s, l) => s + l.qty, 0);
  const done = lines.reduce((s, l) => s + l.done_qty, 0);
  const pending = lines.reduce((s, l) => s + l.pending_qty, 0);
  const remaining = lines.reduce((s, l) => s + l.remaining_qty, 0);
  const to_create = lines.reduce((s, l) => s + l.to_create_qty, 0);
  const latest = requests[0] || null;
  const latestTask = (latest?.warehouse_task || null) as {
    id?: string;
    number?: string;
    status?: string;
  } | null;
  const all_moved = goods.length > 0 && remaining <= 1e-9;
  const has_task = requests.length > 0;
  const items_changed = to_create > 1e-9 && has_task;

  let dest = resolveDealXferDestination(null);
  try {
    const full = get<{
      id: string;
      name?: string;
      amo_channel?: string;
      amo_shipment?: string;
      ship_channel?: string;
    }>(
      `SELECT id, name, amo_channel, amo_shipment, ship_channel FROM crm_deals WHERE id = ?`,
      [dealId]
    );
    dest = resolveDealXferDestination(full || null);
  } catch {
    /* keep default */
  }

  const taskStatus = latestTask ? String(latestTask.status || '').trim() : '';
  const courierStatus = latest ? String(latest.courier_status || '').trim() : '';
  const courierRun = latest
    ? (get<{
        id: string;
        status: string;
        kind: string;
        title: string;
        updated_at: string;
      }>(
        `SELECT id, status, IFNULL(kind,'pickup') AS kind, IFNULL(title,'') AS title, updated_at
         FROM courier_runs
         WHERE sto_request_id = ?
         ORDER BY datetime(created_at) DESC LIMIT 1`,
        [String(latest.id || '')]
      ) as
        | {
            id: string;
            status: string;
            kind: string;
            title: string;
            updated_at: string;
          }
        | null)
    : null;

  const courierSt = String(courierRun?.status || courierStatus || '').trim();
  const isHandoff = String(courierRun?.kind || '') === 'handoff' || String(dest.code || '') === 'COURIER';
  const warehouseLabelMap: Record<string, string> = {
    new: 'Новое',
    picking: 'Сборка',
    packed: 'Упаковано',
    ready: 'К выдаче',
    handed: 'Сделано · перемещено',
    cancelled: 'Не сделано',
  };
  const courierLabelMap: Record<string, string> = isHandoff
    ? {
        new: 'Ждёт курьера',
        accepted: 'Принял задание',
        picked_up: 'К выполнению',
        delivered: 'Доставил',
        cancelled: 'Отмена',
      }
    : {
        new: 'Ждёт курьера',
        accepted: 'Принял',
        picked_up: 'Забрал',
        delivered: 'Сдал на склад',
        cancelled: 'Отмена',
      };

  const flow = {
    number: latest ? String(latest.number || '') : '',
    route: dest?.label
      ? `Основной → ${String(dest.label)}`
      : '',
    dest_code: String(dest?.code || ''),
    dest_hint: String(dest?.hint || ''),
    warehouse: {
      task_id: latestTask ? String(latestTask.id || '') : '',
      number: latestTask ? String(latestTask.number || '') : '',
      status: taskStatus,
      label: taskStatus
        ? warehouseLabelMap[taskStatus] || taskStatus
        : has_task
          ? 'нет задания складу'
          : 'ещё нет',
      done: taskStatus === 'handed',
    },
    courier: {
      run_id: courierRun ? String(courierRun.id) : '',
      kind: courierRun ? String(courierRun.kind || '') : isHandoff ? 'handoff' : '',
      status: courierSt,
      label: !isHandoff && String(dest.code || '') === 'STO'
        ? 'не нужен · на СТО'
        : courierSt
          ? courierLabelMap[courierSt] || courierSt
          : taskStatus === 'handed' && isHandoff
            ? 'ожидает курьера'
            : has_task
              ? 'ещё нет'
              : '—',
      done: courierSt === 'delivered',
      needed: isHandoff || String(dest.code || '') === 'COURIER',
    },
  };

  return {
    deal_id: dealId,
    deal_name: String(deal.name || dealId),
    requests,
    lines,
    dest,
    dest_options: listStoXferDestOptions().map((o) => ({
      code: o.code,
      label: o.label,
      warehouse_id: o.warehouse_id,
    })),
    flow,
    summary: {
      need_qty: need,
      done_qty: done,
      pending_qty: pending,
      remaining_qty: remaining,
      to_create_qty: to_create,
      has_task,
      all_moved,
      items_changed,
      can_create: to_create > 1e-9,
      latest_number: latest ? String(latest.number || '') : '',
      latest_status: latest ? String(latest.status || '') : '',
      latest_task_number: latestTask ? String(latestTask.number || '') : '',
      latest_task_status: latestTask ? String(latestTask.status || '') : '',
      latest_courier_status: courierSt,
    },
  };
}

/** Из заказа покупателя: товарные строки → задание на СТО / курьер / рынок. */
export async function createStoPartsFromDeal(input: {
  deal_id: string;
  source?: StoPartsSource;
  needs_rebrand?: boolean;
  comment?: string;
  amount?: number;
  dest_warehouse_id?: string;
  created_by?: string;
  actor_id?: string;
  /** Если true — досоздать только недостающее (по умолчанию тоже delta). */
  recreate?: boolean;
}) {
  const dealId = String(input.deal_id || '').trim();
  if (!dealId) throw new Error('Не указан заказ');
  const { getDeal } = await import('./deals.js');
  const deal = getDeal(dealId) as Record<string, unknown> | null;
  if (!deal) throw new Error('Заказ покупателя не найден');

  const status = getDealStoPartsStatus(dealId);
  if (status.summary.all_moved) {
    throw new Error('Все товары уже перемещены — новое задание не нужно');
  }
  if (!status.summary.can_create) {
    const num = status.summary.latest_number || status.summary.latest_task_number;
    throw new Error(
      num
        ? `Задание уже создано${num ? ' · ' + num : ''}. Часть позиций в очереди складе — дождитесь перемещения или измените состав заказа.`
        : 'Нечего создавать: нет товарных позиций'
    );
  }

  const deltaMap = new Map(
    status.lines.filter((l) => l.to_create_qty > 1e-9).map((l) => [l.product_id, l])
  );
  const items = (Array.isArray(deal.items) ? deal.items : []) as Array<Record<string, unknown>>;
  const lines = items
    .filter((it) => String(it.item_kind || '') !== 'service')
    .map((it) => {
      const product_id = String(it.product_guid || it.product_id || '').trim();
      const d = deltaMap.get(product_id);
      if (!d) return null;
      return {
        product_id,
        qty: d.to_create_qty,
        sku: String(it.sku || d.sku || ''),
        name: String(it.display_name || it.name || d.name || ''),
        price: Number(it.price || 0) || 0,
      };
    })
    .filter((l): l is NonNullable<typeof l> => !!l && !!l.product_id);
  if (!lines.length) {
    throw new Error('В заказе нет товарных позиций — добавьте товары, затем создайте задание');
  }
  const source: StoPartsSource = normalizeSource(input.source);
  const suffix = status.summary.has_task
    ? status.summary.items_changed
      ? ' · досоздание (состав изменился)'
      : ' · досоздание'
    : '';
  const comment =
    String(input.comment || '').trim() ||
    `Из заказа №${String(deal.number || deal.amo_id || dealId).trim()}${suffix}`;
  return createStoPartsAssignment({
    deal_id: dealId,
    source,
    needs_rebrand: input.needs_rebrand,
    dest_warehouse_id: input.dest_warehouse_id || status.dest?.warehouse_id,
    comment,
    amount: input.amount,
    created_by: input.created_by,
    actor_id: input.actor_id,
    lines,
  });
}

/** Оприходовать после «Сдал»: приход на основной, поставщик «Рынок». */
export function postInboundOnCourierDelivered(stoRequestId: string) {
  ensureStoPartsSchema();
  const reqId = String(stoRequestId || '').trim();
  if (!reqId) throw new Error('Нет задания на СТО');
  const req = getStoTransferRequest(reqId) as Record<string, unknown> | null;
  if (!req) throw new Error('Задание на СТО не найдено');
  const existingDoc = String(req.market_stock_doc_id || '').trim();
  if (existingDoc) {
    return { stock_doc_id: existingDoc, already: true as const };
  }
  const lines = (Array.isArray(req.lines) ? req.lines : []) as Array<Record<string, unknown>>;
  const stockLines = lines
    .map((l) => ({
      product_id: String(l.product_id || '').trim(),
      qty: Number(l.qty) || 1,
      price: 0,
    }))
    .filter((l) => l.product_id && l.qty > 0);
  if (!stockLines.length) throw new Error('Нет позиций для прихода');

  const marketId = ensureMarketCounterparty();
  const source = String(req.source || 'warehouse');
  // Непневмо остаётся на СТО; остальное — приход на основной (потом перемещение при закрытии задания)
  const whId = source === 'nonpneumo' ? stoWarehouseId() : mainWarehouseId();
  const number = String(req.number || reqId);
  const dealId = String(req.deal_id || '').trim();
  const stockDocId = createDocument({
    doc_type: 'in',
    warehouse_id: whId,
    counterparty_id: marketId,
    comment:
      source === 'nonpneumo'
        ? `Непневмо сдал на СТО · ${number}`
        : `Курьер/рынок сдал · ${number}`,
    deal_id: dealId,
    serials_optional: true,
    lines: stockLines,
    post: true,
  });
  run(
    `UPDATE sto_transfer_requests
     SET market_stock_doc_id = ?,
         status = 'done',
         updated_at = datetime('now')
     WHERE id = ?`,
    [stockDocId, reqId]
  );
  run(
    `UPDATE sto_transfer_request_lines
     SET status = 'done'
     WHERE request_id = ? AND status = 'new'`,
    [reqId]
  );
  return { stock_doc_id: stockDocId, already: false as const, counterparty_id: marketId };
}

/** Нал на рынке: касса сразу, курьерское окно, приход при «Сдал». */
export async function createMarketCashPurchase(input: {
  amount: number;
  comment?: string;
  created_by?: string;
  actor_id?: string;
  deal_id?: string;
  cash_register_id?: string;
  lines: Array<{ product_id: string; qty?: number; price?: number; name?: string; sku?: string }>;
  needs_rebrand?: boolean;
}) {
  return createStoPartsAssignment({
    deal_id: input.deal_id,
    source: 'market',
    needs_rebrand: input.needs_rebrand,
    comment: input.comment,
    amount: input.amount,
    created_by: input.created_by,
    actor_id: input.actor_id,
    lines: (input.lines || []).map((l) => ({
      product_id: l.product_id,
      qty: l.qty,
      sku: l.sku,
      name: l.name,
      price: l.price,
    })),
  });
}

export function listCourierRuns(opts?: {
  status?: string;
  scope?: 'active' | 'closed' | 'all';
  q?: string;
  courier_staff_id?: string;
  limit?: number;
}) {
  ensureStoPartsSchema();
  const where: string[] = ['1=1'];
  const params: Array<string | number> = [];
  if (opts?.status) {
    where.push('cr.status = ?');
    params.push(opts.status);
  } else if (opts?.scope === 'closed') {
    where.push(`cr.status IN ('delivered','cancelled')`);
  } else if (opts?.scope !== 'all') {
    where.push(`cr.status IN ('new','accepted','picked_up')`);
  }
  if (opts?.courier_staff_id) {
    where.push('(cr.courier_staff_id = ? OR cr.courier_staff_id = \'\')');
    params.push(opts.courier_staff_id);
  }
  const q = String(opts?.q || '').trim();
  if (q) {
    const like = `%${q.replace(/%/g, '')}%`;
    where.push(
      `(IFNULL(cr.deal_id,'') LIKE ? OR IFNULL(cr.title,'') LIKE ? OR IFNULL(cr.comment,'') LIKE ?
        OR IFNULL(d.buyer_name,'') LIKE ? OR IFNULL(d.buyer_phone,'') LIKE ?
        OR IFNULL(d.amo_shipment,'') LIKE ? OR IFNULL(d.name,'') LIKE ?
        OR IFNULL(sd.number,'') LIKE ? OR IFNULL(wt.number,'') LIKE ?)`
    );
    for (let i = 0; i < 9; i++) params.push(like);
  }
  const limit = Math.min(200, Math.max(1, Number(opts?.limit) || (opts?.scope === 'closed' ? 80 : 50)));
  const rows = all(
    `SELECT cr.*,
       IFNULL(cr.kind,'pickup') AS kind,
       IFNULL(NULLIF(TRIM(cr.deal_id),''), IFNULL(r.deal_id,'')) AS deal_id,
       IFNULL(r.number,'') AS sto_number,
       IFNULL(r.source,'') AS source,
       IFNULL(r.needs_rebrand,0) AS needs_rebrand,
       IFNULL(r.rebrand_done,0) AS rebrand_done,
       IFNULL(r.comment,'') AS req_comment,
       IFNULL(r.status,'') AS req_status,
       IFNULL(wt.number,'') AS task_number,
       IFNULL(wt.comment,'') AS task_comment,
       IFNULL(sd.number,'') AS ship_doc_number,
       IFNULL(d.buyer_name,'') AS buyer_name,
       IFNULL(d.buyer_phone,'') AS buyer_phone,
       IFNULL(d.amo_shipment,'') AS amo_shipment,
       IFNULL(d.amo_channel,'') AS amo_channel,
       IFNULL(d.amo_payment_type,'') AS amo_payment_type,
       IFNULL(d.responsible_user_id,'') AS responsible_user_id,
       IFNULL(d.name,'') AS deal_name,
       IFNULL(d.paid,0) AS deal_paid,
       IFNULL(d.payment_status,'') AS payment_status,
       IFNULL(d.price,0) AS deal_price,
       (SELECT COUNT(*) FROM sto_transfer_request_lines l WHERE l.request_id = cr.sto_request_id) AS lines_count
     FROM courier_runs cr
     LEFT JOIN sto_transfer_requests r ON r.id = cr.sto_request_id
     LEFT JOIN warehouse_tasks wt ON wt.id = cr.warehouse_task_id
     LEFT JOIN stock_docs sd ON sd.id = cr.stock_doc_id
     LEFT JOIN crm_deals d ON d.id = IFNULL(NULLIF(TRIM(cr.deal_id),''), IFNULL(r.deal_id,''))
     WHERE ${where.join(' AND ')}
     ORDER BY datetime(cr.created_at) DESC
     LIMIT ?`,
    [...params, limit]
  ) as Array<Record<string, unknown>>;

  const respIds = [
    ...new Set(
      rows
        .map((r) => String(r.responsible_user_id || '').trim())
        .filter(Boolean)
    ),
  ];
  const respNames = new Map<string, string>();
  if (respIds.length) {
    const placeholders = respIds.map(() => '?').join(',');
    const staffRows = all<{ amo_id: string; name: string }>(
      `SELECT IFNULL(amo_id,'') AS amo_id, IFNULL(name,'') AS name
       FROM staff
       WHERE IFNULL(amo_id,'') IN (${placeholders})`,
      respIds
    );
    for (const s of staffRows) {
      const id = String(s.amo_id || '').trim();
      if (id && s.name) respNames.set(id, String(s.name).trim());
    }
  }

  const activeCount = Number(
    get<{ n: number }>(
      `SELECT COUNT(*) AS n FROM courier_runs WHERE status IN ('new','accepted','picked_up')`
    )?.n || 0
  );
  const closedCount = Number(
    get<{ n: number }>(
      `SELECT COUNT(*) AS n FROM courier_runs WHERE status IN ('delivered','cancelled')`
    )?.n || 0
  );

  const items = rows.map((r) => {
    const kind = String(r.kind || 'pickup');
    const ship = String(r.amo_shipment || '').trim();
    const dealId = String(r.deal_id || '').trim();
    const pNum =
      (dealId ? `С${dealId}` : '') ||
      String(r.sto_number || '').trim() ||
      String(r.ship_doc_number || '').trim();
    const sNum = String(r.task_number || '').trim();
    const paid = dealId ? dealIsPaid(dealId) : false;
    const respId = String(r.responsible_user_id || '').trim();
    const humanizeComment = (raw: string) => {
      let s = String(raw || '').trim();
      if (!s) return '';
      if (pNum) {
        s = s.replace(/СТО-\d+/gi, pNum);
        s = s.replace(/(^|[^\p{L}\p{N}])П(\d[\w-]*)/gu, '$1С$2');
      }
      s = s
        .replace(/\bwarehouse\b/gi, 'со склада')
        .replace(/\bmarket\b/gi, 'рынок')
        .replace(/\bcourier\b/gi, 'курьер')
        .replace(/\bnonpneumo\b/gi, 'непневмо')
        .replace(/\bpneumo\b/gi, 'пневма');
      if (/forma|webhook|notified_|approved|NotStarted/i.test(s)) return '';
      if (/^Задание на СТО из заказа/i.test(s)) {
        s = s.replace(/^Задание на СТО из заказа\s*·\s*/i, 'Перемещение · ');
      }
      return s.trim();
    };

    const comments = [
      humanizeComment(String(r.req_comment || '')),
      humanizeComment(String(r.task_comment || '')),
      humanizeComment(String(r.comment || '')),
    ]
      .filter(Boolean)
      .filter((c, i, arr) => arr.indexOf(c) === i);

    const route_label =
      kind === 'handoff'
        ? ship
          ? `Курьер → ${ship}`
          : 'Курьер → отправка'
        : '';
    const storedTitle = String(r.title || '').trim();
    const title =
      kind === 'handoff'
        ? [pNum || (dealId ? `С${dealId}` : 'Перемещение'), route_label]
            .filter(Boolean)
            .join(' · ') ||
          storedTitle ||
          'Курьер'
        : storedTitle || pNum || 'Задание';
    const docId = String(r.stock_doc_id || '').trim();
    const print_href = docId
      ? `/api/warehouse/pick/handoffs/${encodeURIComponent(docId)}/print`
      : '';
    return {
      ...r,
      kind,
      is_handoff: kind === 'handoff',
      transfer_number: pNum,
      warehouse_number: sNum,
      shipment_label: ship,
      route_label,
      title,
      print_href,
      is_paid: paid,
      payment_label: paid ? 'Оплачено' : 'Не оплачено',
      responsible_name: (respId && respNames.get(respId)) || '',
      comments,
      deal_comments: [] as string[],
      hint:
        kind === 'handoff'
          ? 'Доставил = списание по продаже со склада «Курьер» + примечание в сделку'
          : '«Сдал» = приход «Рынок». Номенклатуру забивает приёмщик.',
    };
  });

  return { items, counts: { active: activeCount, closed: closedCount } };
}

export function setCourierRunStatus(input: {
  id: string;
  status: 'accepted' | 'picked_up' | 'delivered' | 'cancelled';
  courier_staff_id?: string;
  actor_name?: string;
}) {
  ensureStoPartsSchema();
  const row = get<{
    id: string;
    status: string;
    warehouse_task_id: string;
    sto_request_id: string;
    deal_id: string;
    kind: string;
  }>(
    `SELECT id, status, warehouse_task_id, sto_request_id,
            IFNULL(deal_id,'') AS deal_id,
            IFNULL(kind,'pickup') AS kind
     FROM courier_runs WHERE id = ?`,
    [input.id]
  );
  if (!row) throw new Error('Задание курьера не найдено');
  const status = input.status;
  const staffId = String(input.courier_staff_id || '').trim();
  const isHandoff = String(row.kind || '') === 'handoff';

  // Сначала приход — потом статус «сдал», чтобы не залипнуть без оприходования
  // (только для рынка / привоза; handoff — товар уже на складе курьера)
  let inbound: { stock_doc_id: string; already: boolean } | null = null;
  if (status === 'delivered' && row.sto_request_id && !isHandoff) {
    inbound = postInboundOnCourierDelivered(row.sto_request_id);
  }

  const stampCol =
    status === 'accepted'
      ? 'accepted_at'
      : status === 'picked_up'
        ? 'picked_up_at'
        : status === 'delivered'
          ? 'delivered_at'
          : '';
  run(
    `UPDATE courier_runs
     SET status = ?,
         courier_staff_id = CASE WHEN ? != '' THEN ? ELSE courier_staff_id END,
         ${stampCol ? `${stampCol} = datetime('now'),` : ''}
         updated_at = datetime('now')
     WHERE id = ?`,
    [status, staffId, staffId, input.id]
  );
  if (row.sto_request_id) {
    run(
      `UPDATE sto_transfer_requests
       SET courier_status = ?, courier_staff_id = ?, updated_at = datetime('now')
       WHERE id = ?`,
      [status, staffId || '', row.sto_request_id]
    );
  }
  if (status === 'delivered' && row.warehouse_task_id) {
    try {
      // handoff: склад уже переместил → «Сделано»; не возвращать в «К выдаче»
      // рынок/привоз: после сдачи курьером задание ждёт приёмку склада
      setTaskStatus({
        id: row.warehouse_task_id,
        status: isHandoff ? 'handed' : 'ready',
        actor_id: staffId || undefined,
      });
    } catch {
      /* task may already be advanced */
    }
  }

  let writeoff: ReturnType<typeof writeOffCourierOnDelivered> | null = null;
  if (status === 'delivered' && isHandoff) {
    let dealId = String(row.deal_id || '').trim();
    if (!dealId && row.sto_request_id) {
      dealId = String(
        get<{ deal_id: string }>(
          `SELECT IFNULL(deal_id,'') AS deal_id FROM sto_transfer_requests WHERE id = ?`,
          [row.sto_request_id]
        )?.deal_id || ''
      ).trim();
    }
    if (dealId) {
      try {
        writeoff = writeOffCourierOnDelivered(dealId, {
          createdBy: staffId,
          actor_name: String(input.actor_name || ''),
        });
      } catch (e) {
        writeoff = {
          ok: false,
          reason: e instanceof Error ? e.message : 'writeoff failed',
        };
      }
    }
  }

  const out = get(`SELECT * FROM courier_runs WHERE id = ?`, [input.id]) as Record<string, unknown>;
  if (inbound) out.stock_doc_id = inbound.stock_doc_id;
  if (writeoff) out.writeoff = writeoff;
  if (row.sto_request_id) {
    const num = String(
      (
        get<{ number: string }>(`SELECT IFNULL(number,'') AS number FROM sto_transfer_requests WHERE id = ?`, [
          row.sto_request_id,
        ]) as { number?: string } | undefined
      )?.number || ''
    ).trim();
    const n = num || 'С';
    // handoff: товар уже на складе курьера — статусы = работа курьера по заказу, не «сдал на склад»
    const labels: Record<string, string> = isHandoff
      ? {
          accepted: `${n} · курьер принял задание`,
          picked_up: `${n} · курьер к выполнению`,
          delivered: `${n} · курьер отвёз${writeoff?.written_off ? ' · списание' : ''}`,
          cancelled: `${n} · отмена у курьера`,
        }
      : {
          accepted: `${n} · курьер принял`,
          picked_up: `${n} · курьер забрал`,
          delivered: `${n} · курьер сдал на склад (приход)`,
          cancelled: `${n} · отмена у курьера`,
        };
    logStoTransferEvent({
      request_id: row.sto_request_id,
      event: `courier_${status}`,
      summary: labels[status] || status,
      actor_id: staffId,
      actor_name: String(input.actor_name || ''),
      payload: { courier_run_id: input.id, status, kind: isHandoff ? 'handoff' : 'pickup' },
    });
  }
  return out;
}

export function listStoPartsAssignments(opts?: { status?: string; source?: string; limit?: number }) {
  ensureStoPartsSchema();
  const items = listStoTransferRequests({ status: opts?.status, limit: opts?.limit });
  if (!opts?.source) return items;
  return items.filter((r) => String((r as { source?: string }).source || 'warehouse') === opts.source);
}

export function completeStoPartsBySerial(input: {
  serial: string;
  request_id?: string;
  deal_id?: string;
  actor_name?: string;
}) {
  return transferSerialToSto(input);
}

/** Согласование пневмы: mgr → dir; после dir_ok — курьер + задание складу. */
export async function approvePneumoAssignment(input: {
  id: string;
  step: 'mgr' | 'dir';
  ok?: boolean;
  actor_name?: string;
  actor_id?: string;
}) {
  ensureStoPartsSchema();
  const id = String(input.id || '').trim();
  const req = getStoTransferRequest(id) as Record<string, unknown> | null;
  if (!req) throw new Error('Задание не найдено');
  if (String(req.source) !== 'pneumo') throw new Error('Согласование только для ветки «пневма»');
  const st = String(req.approve_status || 'pending');
  const ok = input.ok !== false;
  if (!ok) {
    run(
      `UPDATE sto_transfer_requests
       SET approve_status = 'rejected', approve_by = ?, updated_at = datetime('now')
       WHERE id = ?`,
      [String(input.actor_name || ''), id]
    );
    return getStoTransferRequest(id);
  }
  if (input.step === 'mgr') {
    if (st !== 'pending' && st !== '') throw new Error(`Уже согласовано менеджером (${st})`);
    run(
      `UPDATE sto_transfer_requests
       SET approve_status = 'mgr_ok',
           approve_mgr_at = datetime('now'),
           approve_by = ?,
           updated_at = datetime('now')
       WHERE id = ?`,
      [String(input.actor_name || ''), id]
    );
    return getStoTransferRequest(id);
  }
  if (st !== 'mgr_ok') throw new Error('Сначала согласование менеджера');
  run(
    `UPDATE sto_transfer_requests
     SET approve_status = 'dir_ok',
         approve_dir_at = datetime('now'),
         approve_by = ?,
         updated_at = datetime('now')
     WHERE id = ?`,
    [String(input.actor_name || ''), id]
  );
  // После управляющего — как курьер (покупка у конкурентов)
  const lines = (Array.isArray(req.lines) ? req.lines : []) as Array<Record<string, unknown>>;
  const spawned = await createStoPartsAssignment({
    deal_id: String(req.deal_id || '') || undefined,
    comment: `Пневма согласована · ${req.number || id}`,
    created_by: input.actor_name,
    actor_id: input.actor_id,
    source: 'courier',
    needs_rebrand: true,
    lines: lines.map((l) => ({
      product_id: String(l.product_id || ''),
      qty: Number(l.qty) || 1,
      sku: String(l.sku || ''),
      name: String(l.product_name || l.name || ''),
    })),
  });
  run(
    `UPDATE sto_transfer_requests
     SET status = 'done', updated_at = datetime('now')
     WHERE id = ?`,
    [id]
  );
  return { approved: getStoTransferRequest(id), spawned };
}

export function markStoRebrandDone(input: { id: string; actor_name?: string }) {
  ensureStoPartsSchema();
  const id = String(input.id || '').trim();
  const req = get(`SELECT id FROM sto_transfer_requests WHERE id = ?`, [id]);
  if (!req) throw new Error('Задание не найдено');
  run(
    `UPDATE sto_transfer_requests
     SET rebrand_done = 1, updated_at = datetime('now')
     WHERE id = ?`,
    [id]
  );
  return getStoTransferRequest(id);
}

export function getStoPartsBoard() {
  ensureStoPartsSchema();
  const open = listStoTransferRequests({ limit: 60 }).filter((r) => {
    const st = String((r as { status?: string }).status || '');
    return st === 'new' || st === 'picking';
  });
  const courier = listCourierRuns({ scope: 'active', limit: 40 }).items;
  return {
    open_assignments: open,
    courier_active: courier,
    public_url: publicBaseUrl(),
  };
}

function escHtml(s: unknown): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function fmtMoney(n: unknown): string {
  const v = Number(n);
  if (!Number.isFinite(v) || v === 0) return '—';
  return new Intl.NumberFormat('ru-RU', {
    maximumFractionDigits: 0,
  }).format(v);
}

/** Подпись «откуда» для строки реестра курьера. */
function courierRegistryFromLabel(row: Record<string, unknown>): string {
  const kind = String(row.kind || 'pickup');
  if (kind === 'handoff') return 'Курьер';
  const src = String(row.source || '').trim().toLowerCase();
  if (src === 'market') return 'Рынок';
  if (src === 'courier') return 'Курьер';
  if (src === 'warehouse') return 'Склад';
  const title = String(row.title || '').trim();
  if (/курьер/i.test(title)) return 'Курьер';
  return 'Склад';
}

/** «Куда» = способ отправки из сделки (СДЭК, Автобус…). */
function courierRegistryToLabel(row: Record<string, unknown>): string {
  return String(row.shipment_label || row.amo_shipment || '').trim() || '—';
}

/** Строки заказа для реестра курьера (без ячеек). */
function courierDealItemLines(dealId: string): Array<{ sku: string; name: string; qty: number }> {
  const id = String(dealId || '').trim();
  if (!id) return [];
  return all<{ sku: string; name: string; qty: number }>(
    `SELECT
       IFNULL(NULLIF(TRIM(i.sku),''), IFNULL(p.sku,'')) AS sku,
       IFNULL(NULLIF(TRIM(i.name),''), IFNULL(p.name,'')) AS name,
       IFNULL(i.qty,0) AS qty
     FROM crm_deal_items i
     LEFT JOIN products p ON p.id = i.product_guid
     WHERE i.deal_id = ?
       AND IFNULL(p.item_kind,'product') != 'service'
     ORDER BY i.line_no ASC`,
    [id]
  ).map((r) => ({
    sku: String(r.sku || '').trim(),
    name: String(r.name || '').trim(),
    qty: Number(r.qty) || 0,
  }));
}

/** HTML-реестр курьера: группа по маршруту «куда», строки заказа по сделкам. */
export function renderCourierRunsRegistryHtml(opts?: {
  actor_name?: string;
  autoprint?: boolean;
  /** id заданий courier_runs; пусто = все активные */
  run_ids?: string[];
}): string {
  let items = listCourierRuns({ scope: 'active', limit: 200 }).items;
  const want = (opts?.run_ids || []).map((x) => String(x || '').trim()).filter(Boolean);
  if (want.length) {
    const set = new Set(want);
    items = items.filter((r) => set.has(String((r as { id?: string }).id || '')));
  }

  const now = new Date();
  const when = now.toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
  const actor = String(opts?.actor_name || '').trim();

  type RegistryRow = {
    deal_id: string;
    from: string;
    to: string;
    buyer: string;
    phone: string;
    pay: string;
    sku: string;
    name: string;
    qty: number;
  };
  const groups = new Map<string, RegistryRow[]>();

  for (const r of items) {
    const row = r as Record<string, unknown>;
    const to = courierRegistryToLabel(row);
    const from = courierRegistryFromLabel(row);
    const dealId = String(row.deal_id || '').trim();
    const buyer = String(row.buyer_name || '').trim() || '—';
    const phone = String(row.buyer_phone || '').trim() || '—';
    const pay = String(row.payment_label || '').trim() || '—';
    const lines = courierDealItemLines(dealId);
    const base = { deal_id: dealId, from, to, buyer, phone, pay };
    const rows: RegistryRow[] = lines.length
      ? lines.map((l) => ({
          ...base,
          sku: l.sku,
          name: l.name,
          qty: l.qty,
        }))
      : [{ ...base, sku: '—', name: '—', qty: 0 }];
    if (!groups.has(to)) groups.set(to, []);
    groups.get(to)!.push(...rows);
  }

  const groupKeys = [...groups.keys()].sort((a, b) => a.localeCompare(b, 'ru'));
  let lineNo = 0;
  const bodyHtml = groupKeys.length
    ? groupKeys
        .map((dest) => {
          const rows = groups.get(dest) || [];
          const dealIds = new Set(rows.map((r) => r.deal_id).filter(Boolean));
          const tbody = rows
            .map((r) => {
              lineNo += 1;
              return `<tr>
                <td class="chk">☐</td>
                <td class="n">${lineNo}</td>
                <td class="deal">${escHtml(r.deal_id ? `С${r.deal_id}` : '—')}</td>
                <td>${escHtml(r.from)}</td>
                <td>${escHtml(r.to)}</td>
                <td class="sku">${escHtml(r.sku || '—')}</td>
                <td>${escHtml(r.name || '—')}</td>
                <td class="q">${escHtml(String(r.qty || 0))}</td>
                <td>${escHtml(r.buyer)}</td>
                <td class="tel">${escHtml(r.phone)}</td>
                <td class="pay">${escHtml(r.pay)}</td>
              </tr>`;
            })
            .join('');
          return `<section class="group">
            <h2>Способ отправки: ${escHtml(dest)}</h2>
            <div class="group-meta">${dealIds.size} ${
              dealIds.size === 1 ? 'сделка' : dealIds.size < 5 ? 'сделки' : 'сделок'
            } · ${rows.length} ${rows.length === 1 ? 'строка' : rows.length < 5 ? 'строки' : 'строк'}</div>
            <table class="reg">
              <thead><tr>
                <th class="chk" title="Отметить">✓</th>
                <th class="n">№</th>
                <th>Сделка</th>
                <th>Откуда</th>
                <th>Куда</th>
                <th>Артикул</th>
                <th>Наименование</th>
                <th class="q">Кол-во</th>
                <th>Клиент</th>
                <th>Телефон</th>
                <th>Оплата</th>
              </tr></thead>
              <tbody>${tbody}</tbody>
            </table>
          </section>`;
        })
        .join('')
    : `<p class="empty">Нет активных заданий для печати</p>`;

  const autoprint = opts?.autoprint
    ? `<script>window.addEventListener('load',function(){setTimeout(function(){window.print()},150)});</script>`
    : '';

  return `<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="utf-8" />
  <title>Реестр курьера · ${escHtml(when)}</title>
  <style>
    :root { color-scheme: light; }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      padding: 16px 18px 28px;
      font: 13px/1.35 system-ui, -apple-system, "Segoe UI", sans-serif;
      color: #111;
    }
    .toolbar {
      display: flex;
      gap: 8px;
      align-items: center;
      margin-bottom: 14px;
    }
    .toolbar button {
      appearance: none;
      border: 1px solid #bbb;
      background: #fff;
      border-radius: 8px;
      padding: 8px 14px;
      font: inherit;
      font-weight: 650;
      cursor: pointer;
    }
    h1 { margin: 0 0 4px; font-size: 18px; font-weight: 750; }
    .meta { color: #555; font-size: 12px; margin-bottom: 14px; }
    .group { margin: 0 0 18px; page-break-inside: avoid; }
    .group h2 {
      margin: 0 0 4px;
      font-size: 15px;
      font-weight: 800;
      color: #0d7377;
      border-bottom: 2px solid #0d7377;
      padding-bottom: 4px;
    }
    .group-meta { color: #6b7280; font-size: 11px; margin-bottom: 8px; }
    table.reg {
      width: 100%;
      border-collapse: collapse;
      font-size: 11px;
    }
    table.reg th, table.reg td {
      border: 1px solid #d1d5db;
      padding: 4px 5px;
      text-align: left;
      vertical-align: top;
    }
    table.reg th {
      background: #f3f4f6;
      font-size: 9px;
      text-transform: uppercase;
      letter-spacing: 0.03em;
      color: #4b5563;
    }
    table.reg td.chk, table.reg th.chk {
      width: 22px;
      text-align: center;
      font-size: 14px;
      line-height: 1;
    }
    table.reg td.n, table.reg th.n { width: 28px; text-align: right; color: #6b7280; }
    table.reg td.deal { white-space: nowrap; font-weight: 700; }
    table.reg td.sku { white-space: nowrap; font-family: ui-monospace, monospace; font-size: 10px; }
    table.reg td.q, table.reg th.q { width: 48px; text-align: right; }
    table.reg td.tel { white-space: nowrap; font-size: 10px; }
    table.reg td.pay { white-space: nowrap; font-size: 10px; color: #b91c1c; font-weight: 650; }
    .sub { color: #6b7280; font-size: 11px; }
    .empty { color: #6b7280; padding: 24px 0; }
    .foot {
      margin-top: 14px;
      display: flex;
      justify-content: space-between;
      gap: 16px;
      font-size: 12px;
      color: #444;
    }
    .sign { margin-top: 28px; display: grid; grid-template-columns: 1fr 1fr; gap: 24px; font-size: 12px; }
    .sign div { border-top: 1px solid #999; padding-top: 6px; }
    @media print {
      body { padding: 0; }
      .toolbar { display: none; }
      @page { size: A4 portrait; margin: 10mm; }
    }
  </style>
</head>
<body>
  <div class="toolbar">
    <button type="button" onclick="window.print()">Печать / PDF</button>
    <button type="button" onclick="window.close()">Закрыть</button>
  </div>
  <h1>Реестр курьера</h1>
  <div class="meta">
    Учёт №1 · ${escHtml(when)}
    · заказов: <b>${items.length}</b>
    · направлений: <b>${groupKeys.length}</b>
    ${want.length ? ' · выбор галочками' : ' · все активные'}
    ${actor ? ` · печатал: ${escHtml(actor)}` : ''}
  </div>
  ${bodyHtml}
  <div class="foot">
    <div>Группы по полю «Способ отправки» (СДЭК, Автобус…). Откуда → Куда · все строки заказа.</div>
    <div>Колонка ☐ — отметка курьера · без ячеек</div>
  </div>
  <div class="sign">
    <div>Сдал (склад)</div>
    <div>Принял (курьер)</div>
  </div>
  ${autoprint}
</body>
</html>`;
}

export { getStoTransferRequest, getTask };
