/**
 * Задания курьеру после перемещения на «Склад курьера» (отправка / СДЭК).
 */
import { all, get, run } from './db.js';
import { newGuid } from './ids.js';
import { logStoTransferEvent } from './deal-doc-numbers.js';

function ensureCourierRunsTable() {
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

/** Маршрут для курьера: Курьер → способ отправки из сделки. */
export function courierDeliveryRouteLabel(dealId: string): string {
  const ship = String(
    get<{ amo_shipment: string }>(
      `SELECT IFNULL(amo_shipment,'') AS amo_shipment FROM crm_deals WHERE id = ?`,
      [String(dealId || '').trim()]
    )?.amo_shipment || ''
  ).trim();
  return ship ? `Курьер → ${ship}` : 'Курьер → отправка';
}

/** @deprecated старый маршрут «Основной → Склад курьера»; для новых заголовков — courierDeliveryRouteLabel. */
function shipRouteLabel1c(dealId: string, fromWarehouseId?: string): string {
  void fromWarehouseId;
  return courierDeliveryRouteLabel(dealId);
}

/** Создать (или вернуть) задание курьеру: товар уже на складе курьера. */
export function ensureCourierHandoffRun(input: {
  sto_request_id: string;
  warehouse_task_id: string;
  actor_id?: string;
}): { id: string; created: boolean } {
  ensureCourierRunsTable();
  const reqId = String(input.sto_request_id || '').trim();
  const taskId = String(input.warehouse_task_id || '').trim();
  if (!reqId) throw new Error('Нет sto_request_id');

  const existing = get<{ id: string }>(
    `SELECT id FROM courier_runs
     WHERE sto_request_id = ?
       AND IFNULL(kind,'pickup') = 'handoff'
       AND status NOT IN ('cancelled')
     ORDER BY datetime(created_at) DESC
     LIMIT 1`,
    [reqId]
  );
  if (existing?.id) {
    if (taskId) {
      run(
        `UPDATE courier_runs
         SET warehouse_task_id = CASE WHEN IFNULL(warehouse_task_id,'') = '' THEN ? ELSE warehouse_task_id END,
             updated_at = datetime('now')
         WHERE id = ?`,
        [taskId, existing.id]
      );
    }
    return { id: existing.id, created: false };
  }

  const req = get<{
    number: string;
    deal_id: string;
    comment: string;
  }>(
    `SELECT IFNULL(number,'') AS number, IFNULL(deal_id,'') AS deal_id, IFNULL(comment,'') AS comment
     FROM sto_transfer_requests WHERE id = ?`,
    [reqId]
  );
  const dealId = String(req?.deal_id || '').trim();
  let buyer = '';
  let ship = '';
  if (dealId) {
    const d = get<{ buyer_name: string; amo_shipment: string }>(
      `SELECT IFNULL(buyer_name,'') AS buyer_name, IFNULL(amo_shipment,'') AS amo_shipment
       FROM crm_deals WHERE id = ?`,
      [dealId]
    );
    buyer = String(d?.buyer_name || '').trim();
    ship = String(d?.amo_shipment || '').trim();
  }
  const pNum = String(req?.number || '').trim();
  const taskNum =
    String(
      get<{ number: string }>(`SELECT IFNULL(number,'') AS number FROM warehouse_tasks WHERE id = ?`, [
        taskId,
      ])?.number || ''
    ).trim() || '';

  const route = dealId ? courierDeliveryRouteLabel(dealId) : 'Курьер → отправка';
  const title = [pNum || (dealId ? `С${dealId}` : 'Перемещение'), route].filter(Boolean).join(' · ');

  const comment = [
    dealId ? `заказ ${dealId}` : '',
    buyer ? buyer : '',
    ship ? `отправка: ${ship}` : '',
    taskNum ? `склад ${taskNum}` : '',
    String(req?.comment || '').trim(),
  ]
    .filter(Boolean)
    .join(' · ');

  const id = newGuid();
  run(
    `INSERT INTO courier_runs
      (id, sto_request_id, warehouse_task_id, status, kind, title, comment, created_by, deal_id, created_at, updated_at)
     VALUES (?, ?, ?, 'new', 'handoff', ?, ?, ?, ?, datetime('now'), datetime('now'))`,
    [id, reqId, taskId, title, comment, String(input.actor_id || ''), dealId]
  );
  run(
    `UPDATE sto_transfer_requests
     SET courier_status = 'new', updated_at = datetime('now')
     WHERE id = ?`,
    [reqId]
  );
  logStoTransferEvent({
    request_id: reqId,
    event: 'courier_handoff',
    summary: `${pNum || 'С'} · задание курьеру`,
    actor_id: input.actor_id,
    payload: { courier_run_id: id, task_id: taskId, status: 'new' },
  });
  return { id, created: true };
}

/**
 * СДЭК / Отправка: после «Готово» на /pick товар на «Склад курьера» → задача на courier.html.
 * Не требует sto_transfer_requests (обычная передача из виджета / Учёта).
 */
export function ensureCourierShipRun(input: {
  deal_id: string;
  stock_doc_id?: string;
  stock_doc_number?: string;
  route_label?: string;
  from_warehouse_id?: string;
  actor_id?: string;
}): { id: string; created: boolean } {
  ensureCourierRunsTable();
  const dealId = String(input.deal_id || '').trim();
  if (!dealId) throw new Error('Нет deal_id');

  const existing = get<{ id: string }>(
    `SELECT id FROM courier_runs
     WHERE deal_id = ?
       AND IFNULL(kind,'pickup') = 'handoff'
       AND status NOT IN ('cancelled', 'delivered')
     ORDER BY datetime(created_at) DESC
     LIMIT 1`,
    [dealId]
  );
  const docId = String(input.stock_doc_id || '').trim();
  if (existing?.id) {
    if (docId) {
      run(
        `UPDATE courier_runs
         SET stock_doc_id = CASE WHEN IFNULL(stock_doc_id,'') = '' THEN ? ELSE stock_doc_id END,
             updated_at = datetime('now')
         WHERE id = ?`,
        [docId, existing.id]
      );
    }
    return { id: existing.id, created: false };
  }

  const d = get<{
    buyer_name: string;
    amo_shipment: string;
    amo_channel: string;
    name: string;
  }>(
    `SELECT IFNULL(buyer_name,'') AS buyer_name,
            IFNULL(amo_shipment,'') AS amo_shipment,
            IFNULL(amo_channel,'') AS amo_channel,
            IFNULL(name,'') AS name
     FROM crm_deals WHERE id = ?`,
    [dealId]
  );
  const buyer = String(d?.buyer_name || '').trim();
  const ship = String(d?.amo_shipment || '').trim();
  const channel = String(d?.amo_channel || '').trim();
  const dealName = String(d?.name || '').trim();
  const docNum = String(input.stock_doc_number || '').trim();

  let fromWhId = String(input.from_warehouse_id || '').trim();
  if (!fromWhId && docId) {
    fromWhId = String(
      get<{ warehouse_id: string }>(
        `SELECT IFNULL(warehouse_id,'') AS warehouse_id FROM stock_docs WHERE id = ?`,
        [docId]
      )?.warehouse_id || ''
    ).trim();
  }
  const route = courierDeliveryRouteLabel(dealId);
  void input.route_label;
  void fromWhId;

  const title = [`С${dealId}`, route].filter(Boolean).join(' · ');
  const comment = [
    `заказ ${dealId}`,
    buyer || dealName,
    ship ? `отправка: ${ship}` : channel ? `канал: ${channel}` : '',
    docNum ? `док ${docNum}` : '',
  ]
    .filter(Boolean)
    .join(' · ');

  const id = newGuid();
  run(
    `INSERT INTO courier_runs
      (id, sto_request_id, warehouse_task_id, status, kind, title, comment, created_by,
       deal_id, stock_doc_id, created_at, updated_at)
     VALUES (?, '', '', 'new', 'handoff', ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
    [id, title, comment, String(input.actor_id || ''), dealId, docId]
  );
  return { id, created: true };
}

/** Обновить заголовки активных handoff: Курьер → способ отправки. */
export function relabelActiveCourierShipRuns(): { updated: number } {
  ensureCourierRunsTable();
  const rows = all<{ id: string; deal_id: string; title: string }>(
    `SELECT id,
            IFNULL(deal_id,'') AS deal_id,
            IFNULL(title,'') AS title
     FROM courier_runs
     WHERE IFNULL(kind,'pickup') = 'handoff'
       AND status NOT IN ('cancelled','delivered')`
  );
  let updated = 0;
  for (const r of rows) {
    const dealId = String(r.deal_id || '').trim();
    if (!dealId) continue;
    const route = courierDeliveryRouteLabel(dealId);
    const title = [`С${dealId}`, route].filter(Boolean).join(' · ');
    if (title === String(r.title || '')) continue;
    run(`UPDATE courier_runs SET title = ?, updated_at = datetime('now') WHERE id = ?`, [
      title,
      r.id,
    ]);
    updated += 1;
  }
  return { updated };
}
