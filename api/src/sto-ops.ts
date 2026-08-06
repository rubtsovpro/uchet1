/**
 * СТО: подъёмник (/lift) + приёмщик (/reception).
 * Смена мастера (PIN), занятость подъёмников, материалы ЗН, работы слесарей (sto_work_logs).
 */
import { all, get, run } from './db.js';
import { newGuid, nextCode } from './ids.js';
import { createDocument } from './stock.js';
import { stoWarehouseId } from './supply-chain.js';
import type { Actor } from './auth.js';
import {
  localParts,
  staffHasPin,
  verifyShiftIdentity,
} from './pick-shifts.js';
import { canAccessSection, type StaffRights } from './staff.js';

const TZ = 'Europe/Moscow';

export type StoLiftShiftRow = {
  id: string;
  staff_id: string;
  staff_name: string;
  staff_login: string;
  day: string;
  started_at: string;
  ended_at: string;
  pin_verified_at: string;
  last_activity_at: string;
  created_at: string;
};

function today(): string {
  return localParts(TZ).day;
}

function mapShift(row: Record<string, unknown>): StoLiftShiftRow {
  return {
    id: String(row.id),
    staff_id: String(row.staff_id),
    staff_name: String(row.staff_name || ''),
    staff_login: String(row.staff_login || ''),
    day: String(row.day || ''),
    started_at: String(row.started_at || ''),
    ended_at: String(row.ended_at || ''),
    pin_verified_at: String(row.pin_verified_at || ''),
    last_activity_at: String(row.last_activity_at || ''),
    created_at: String(row.created_at || ''),
  };
}

export function canAccessLiftScreen(
  actor: { role?: string; isSystemAdmin?: boolean; rights?: StaffRights } | null | undefined
): boolean {
  if (!actor) return true;
  if (actor.isSystemAdmin || actor.role === 'admin' || actor.role === 'manager') return true;
  if (actor.role === 'sto') return true;
  return canAccessSection(actor, 'lift') || canAccessSection(actor, 'works');
}

export function canAccessReceptionScreen(
  actor: { role?: string; isSystemAdmin?: boolean; rights?: StaffRights } | null | undefined
): boolean {
  if (!actor) return true;
  if (actor.isSystemAdmin || actor.role === 'admin' || actor.role === 'manager') return true;
  if (actor.role === 'sto') return true;
  return canAccessSection(actor, 'reception') || canAccessSection(actor, 'works');
}

export function getOpenLiftShift(staffId: string): StoLiftShiftRow | null {
  const row = get<Record<string, unknown>>(
    `SELECT * FROM sto_lift_shifts
     WHERE staff_id = ? AND ended_at = ''
     ORDER BY started_at DESC LIMIT 1`,
    [staffId]
  );
  return row ? mapShift(row) : null;
}

export function startLiftShift(
  actor: Actor,
  opts: { pin?: string; password?: string }
): StoLiftShiftRow {
  const open = getOpenLiftShift(actor.id);
  if (open) throw new Error('Смена уже открыта — сначала завершите текущую');
  verifyShiftIdentity(actor, opts);
  const day = today();
  const now = new Date().toISOString();
  const id = newGuid();
  run(
    `INSERT INTO sto_lift_shifts (
      id, staff_id, staff_name, staff_login, day,
      started_at, ended_at, pin_verified_at, last_activity_at
    ) VALUES (?, ?, ?, ?, ?, ?, '', ?, ?)`,
    [id, actor.id, actor.name, actor.login, day, now, now, now]
  );
  return getOpenLiftShift(actor.id)!;
}

export function endLiftShift(actor: Actor): StoLiftShiftRow | null {
  const open = getOpenLiftShift(actor.id);
  if (!open) return null;
  const now = new Date().toISOString();
  run(`UPDATE sto_lift_shifts SET ended_at = ?, last_activity_at = ? WHERE id = ?`, [
    now,
    now,
    open.id,
  ]);
  return mapShift({ ...open, ended_at: now, last_activity_at: now });
}

export function touchLiftShift(staffId: string): void {
  const open = getOpenLiftShift(staffId);
  if (!open) return;
  run(`UPDATE sto_lift_shifts SET last_activity_at = ? WHERE id = ?`, [
    new Date().toISOString(),
    open.id,
  ]);
}

/** Для операций на подъёмнике нужна открытая смена (кроме admin/manager). */
export function assertLiftShiftForOps(actor: Actor | null): void {
  if (!actor) throw new Error('Нужна авторизация');
  if (actor.isSystemAdmin || actor.role === 'admin' || actor.role === 'manager') return;
  const open = getOpenLiftShift(actor.id);
  if (!open) {
    throw new Error('Начните смену мастера (PIN), чтобы работать на подъёмнике');
  }
}

export function liftShiftStatusPayload(actor: Actor) {
  const shift = getOpenLiftShift(actor.id);
  const has_pin = staffHasPin(actor.id);
  const { day, hm } = localParts(TZ);
  return {
    shift,
    staff: {
      id: actor.id,
      name: actor.name,
      login: actor.login,
      role: actor.role,
      has_pin,
      identity: has_pin ? 'pin' : actor.isSystemAdmin ? 'session' : 'password',
    },
    local: { day, time: hm },
    require_shift: !(actor.isSystemAdmin || actor.role === 'admin' || actor.role === 'manager'),
  };
}

const APPT_STATUSES = ['expected', 'arrived', 'on_lift', 'done', 'cancelled'] as const;

function normalizePlate(p: string): string {
  return String(p || '')
    .toUpperCase()
    .replace(/\s+/g, '')
    .replace(/[^\p{L}\p{N}]/gu, '');
}

export function listAppointments(day?: string) {
  const d = (day || today()).slice(0, 10);
  const items = all<Record<string, unknown>>(
    `SELECT * FROM sto_appointments WHERE day = ? ORDER BY time_hm, created_at`,
    [d]
  );
  return { day: d, items };
}

export function createAppointment(input: {
  day?: string;
  time_hm?: string;
  plate?: string;
  vin?: string;
  model?: string;
  client_name?: string;
  phone?: string;
  note?: string;
  status?: string;
}) {
  const id = newGuid();
  const day = (input.day || today()).slice(0, 10);
  const status = APPT_STATUSES.includes(input.status as (typeof APPT_STATUSES)[number])
    ? String(input.status)
    : 'expected';
  const now = new Date().toISOString();
  run(
    `INSERT INTO sto_appointments (
      id, day, time_hm, plate, vin, model, client_name, phone, status, note, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      day,
      String(input.time_hm || '').trim().slice(0, 5),
      normalizePlate(String(input.plate || '')),
      String(input.vin || '').trim().toUpperCase(),
      String(input.model || '').trim(),
      String(input.client_name || '').trim(),
      String(input.phone || '').trim(),
      status,
      String(input.note || '').trim(),
      now,
      now,
    ]
  );
  return get('SELECT * FROM sto_appointments WHERE id = ?', [id]);
}

export function patchAppointment(
  id: string,
  patch: {
    status?: string;
    time_hm?: string;
    plate?: string;
    vin?: string;
    model?: string;
    client_name?: string;
    phone?: string;
    note?: string;
    work_order_id?: string;
  }
) {
  const row = get('SELECT * FROM sto_appointments WHERE id = ?', [id]);
  if (!row) return null;
  const sets: string[] = [`updated_at = datetime('now')`];
  const params: Array<string | number> = [];
  if (patch.status != null) {
    if (!APPT_STATUSES.includes(patch.status as (typeof APPT_STATUSES)[number])) {
      throw new Error('Неверный статус записи');
    }
    sets.push('status = ?');
    params.push(String(patch.status));
  }
  for (const key of ['time_hm', 'vin', 'model', 'client_name', 'phone', 'note', 'work_order_id'] as const) {
    if (patch[key] != null) {
      sets.push(`${key} = ?`);
      params.push(String(patch[key]).trim());
    }
  }
  if (patch.plate != null) {
    sets.push('plate = ?');
    params.push(normalizePlate(patch.plate));
  }
  params.push(id);
  run(`UPDATE sto_appointments SET ${sets.join(', ')} WHERE id = ?`, params);
  return get('SELECT * FROM sto_appointments WHERE id = ?', [id]);
}

/** Прибытие → создать ЗН если ещё нет. */
export function markAppointmentArrived(id: string) {
  const row = get<Record<string, unknown>>('SELECT * FROM sto_appointments WHERE id = ?', [id]);
  if (!row) throw new Error('Запись не найдена');
  let woId = String(row.work_order_id || '');
  if (!woId) {
    const wo = ensureWorkOrder({
      customer_name: String(row.client_name || ''),
      plate: String(row.plate || ''),
      vin: String(row.vin || ''),
      model: String(row.model || ''),
      vehicle: [String(row.model || ''), String(row.plate || '')].filter(Boolean).join(' · '),
      status: 'booked',
      comment: `Запись ${row.day} ${row.time_hm || ''}`.trim(),
    });
    woId = String(wo.id);
  }
  run(
    `UPDATE sto_appointments SET status = 'arrived', work_order_id = ?, updated_at = datetime('now')
     WHERE id = ?`,
    [woId, id]
  );
  return get('SELECT * FROM sto_appointments WHERE id = ?', [id]);
}

function ensureWorkOrder(input: {
  customer_name?: string;
  plate?: string;
  vin?: string;
  model?: string;
  vehicle?: string;
  status?: string;
  comment?: string;
  doc_date?: string;
}) {
  const id = newGuid();
  const number = nextCode('ЗН', 5);
  const docDate = (input.doc_date || today()).slice(0, 10);
  const status = String(input.status || 'booked');
  run(
    `INSERT INTO sto_work_orders
      (id, number, doc_date, customer_name, vehicle, status, total, comment, plate, vin, model)
     VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?)`,
    [
      id,
      number,
      docDate,
      String(input.customer_name || '').trim(),
      String(input.vehicle || '').trim(),
      status,
      String(input.comment || ''),
      normalizePlate(String(input.plate || '')),
      String(input.vin || '').trim().toUpperCase(),
      String(input.model || '').trim(),
    ]
  );
  return get<Record<string, unknown>>('SELECT * FROM sto_work_orders WHERE id = ?', [id])!;
}

export function searchStoVehicles(q: string, limit = 20) {
  const query = String(q || '').trim();
  if (!query) return { items: [] as Record<string, unknown>[] };
  const like = `%${query}%`;
  const plateQ = normalizePlate(query);
  const plateLike = plateQ ? `%${plateQ}%` : like;
  const lim = Math.min(50, Math.max(1, limit));
  const appts = all<Record<string, unknown>>(
    `SELECT id, day, time_hm, plate, vin, model, client_name, status, work_order_id, 'appointment' AS source
     FROM sto_appointments
     WHERE day = ? AND (
       plate LIKE ? OR vin LIKE ? OR client_name LIKE ? OR model LIKE ?
     )
     ORDER BY time_hm LIMIT ?`,
    [today(), plateLike, like, like, like, lim]
  );
  const orders = all<Record<string, unknown>>(
    `SELECT id AS work_order_id, number, doc_date, customer_name AS client_name,
            plate, vin, model, vehicle, status, lift_id, 'work_order' AS source
     FROM sto_work_orders
     WHERE plate LIKE ? OR vin LIKE ? OR customer_name LIKE ? OR model LIKE ?
        OR vehicle LIKE ? OR number LIKE ?
     ORDER BY doc_date DESC LIMIT ?`,
    [plateLike, like, like, like, like, like, lim]
  );
  return { items: [...appts, ...orders] };
}

function enrichWorkOrder(wo: Record<string, unknown>) {
  const id = String(wo.id);
  const works = all(`SELECT * FROM sto_wo_works WHERE work_order_id = ? ORDER BY sort_order, created_at`, [
    id,
  ]);
  const materials = all(
    `SELECT * FROM sto_wo_materials WHERE work_order_id = ? ORDER BY created_at DESC`,
    [id]
  );
  const work_logs = all(
    `SELECT * FROM sto_work_logs WHERE work_order_id = ? ORDER BY created_at DESC`,
    [id]
  );
  let lift_name = '';
  const liftId = String(wo.lift_id || '');
  if (liftId) {
    lift_name = String(
      get<{ name: string }>('SELECT name FROM sto_resources WHERE id = ?', [liftId])?.name || ''
    );
  }
  const started = String(wo.lift_started_at || '');
  let minutes_on_lift: number | null = null;
  if (started) {
    const t = Date.parse(started);
    if (Number.isFinite(t)) minutes_on_lift = Math.max(0, Math.round((Date.now() - t) / 60_000));
  }
  return {
    ...wo,
    lift_name,
    minutes_on_lift,
    works,
    materials,
    work_logs,
  };
}

export function getWorkOrderDetail(id: string) {
  const wo = get<Record<string, unknown>>('SELECT * FROM sto_work_orders WHERE id = ?', [id]);
  if (!wo) return null;
  return enrichWorkOrder(wo);
}

export function listLiftsBoard() {
  const lifts = all<Record<string, unknown>>(
    `SELECT * FROM sto_resources WHERE kind = 'lift' AND is_active = 1 ORDER BY name`
  );
  const items = lifts.map((lift) => {
    const liftId = String(lift.id);
    const wo = get<Record<string, unknown>>(
      `SELECT * FROM sto_work_orders
       WHERE lift_id = ? AND IFNULL(lift_started_at,'') != ''
         AND status NOT IN ('handed', 'cancelled', 'done')
       ORDER BY lift_started_at DESC LIMIT 1`,
      [liftId]
    );
    return {
      id: liftId,
      name: String(lift.name),
      kind: 'lift',
      busy: !!wo,
      work_order: wo ? enrichWorkOrder(wo) : null,
    };
  });
  return { items, day: today() };
}

export function assignToLift(
  actor: Actor,
  opts: {
    lift_id: string;
    work_order_id?: string;
    appointment_id?: string;
    plate?: string;
    vin?: string;
    model?: string;
    client_name?: string;
    works?: Array<{ name: string; qty?: number }>;
  }
) {
  assertLiftShiftForOps(actor);
  const lift = get<{ id: string; name: string; kind: string; is_active: number }>(
    `SELECT * FROM sto_resources WHERE id = ? AND kind = 'lift'`,
    [opts.lift_id]
  );
  if (!lift || !lift.is_active) throw new Error('Подъёмник не найден');

  const occupied = get<{ id: string }>(
    `SELECT id FROM sto_work_orders
     WHERE lift_id = ? AND IFNULL(lift_started_at,'') != ''
       AND status NOT IN ('handed', 'cancelled', 'done')
     LIMIT 1`,
    [opts.lift_id]
  );
  if (occupied) throw new Error('Подъёмник занят — сначала освободите');

  let woId = String(opts.work_order_id || '').trim();
  if (!woId && opts.appointment_id) {
    const ap = markAppointmentArrived(opts.appointment_id) as Record<string, unknown>;
    woId = String(ap.work_order_id || '');
  }
  if (!woId) {
    if (!opts.plate && !opts.client_name) {
      throw new Error('Укажите госномер или выберите запись / заказ-наряд');
    }
    const wo = ensureWorkOrder({
      customer_name: opts.client_name,
      plate: opts.plate,
      vin: opts.vin,
      model: opts.model,
      vehicle: [opts.model, opts.plate].filter(Boolean).join(' · '),
      status: 'in_progress',
    });
    woId = String(wo.id);
  }

  const now = new Date().toISOString();
  run(
    `UPDATE sto_work_orders SET
       lift_id = ?, lift_started_at = ?, master_staff_id = ?, master_staff_name = ?,
       status = CASE WHEN status IN ('draft','booked') THEN 'in_progress' ELSE status END,
       plate = CASE WHEN ? != '' THEN ? ELSE plate END,
       vin = CASE WHEN ? != '' THEN ? ELSE vin END,
       model = CASE WHEN ? != '' THEN ? ELSE model END,
       customer_name = CASE WHEN ? != '' THEN ? ELSE customer_name END
     WHERE id = ?`,
    [
      opts.lift_id,
      now,
      actor.id,
      actor.name,
      normalizePlate(String(opts.plate || '')),
      normalizePlate(String(opts.plate || '')),
      String(opts.vin || '').trim().toUpperCase(),
      String(opts.vin || '').trim().toUpperCase(),
      String(opts.model || '').trim(),
      String(opts.model || '').trim(),
      String(opts.client_name || '').trim(),
      String(opts.client_name || '').trim(),
      woId,
    ]
  );

  if (opts.appointment_id) {
    run(
      `UPDATE sto_appointments SET status = 'on_lift', work_order_id = ?, updated_at = datetime('now')
       WHERE id = ?`,
      [woId, opts.appointment_id]
    );
  }

  if (Array.isArray(opts.works)) {
    for (const [i, w] of opts.works.entries()) {
      const name = String(w.name || '').trim();
      if (!name) continue;
      run(
        `INSERT INTO sto_wo_works (id, work_order_id, name, qty, sort_order) VALUES (?, ?, ?, ?, ?)`,
        [newGuid(), woId, name, Number(w.qty) > 0 ? Number(w.qty) : 1, i + 1]
      );
    }
  }

  touchLiftShift(actor.id);
  return getWorkOrderDetail(woId);
}

export function freeLift(actor: Actor, liftId: string, markDone = false) {
  assertLiftShiftForOps(actor);
  const wo = get<Record<string, unknown>>(
    `SELECT * FROM sto_work_orders
     WHERE lift_id = ? AND IFNULL(lift_started_at,'') != ''
       AND status NOT IN ('handed', 'cancelled')
     ORDER BY lift_started_at DESC LIMIT 1`,
    [liftId]
  );
  if (!wo) throw new Error('На подъёмнике нет авто');
  const nextStatus = markDone ? 'ready' : String(wo.status || 'in_progress');
  run(
    `UPDATE sto_work_orders SET lift_id = '', lift_started_at = '', status = ? WHERE id = ?`,
    [nextStatus, String(wo.id)]
  );
  run(
    `UPDATE sto_appointments SET status = CASE WHEN status = 'on_lift' THEN 'arrived' ELSE status END,
       updated_at = datetime('now')
     WHERE work_order_id = ?`,
    [String(wo.id)]
  );
  touchLiftShift(actor.id);
  return { ok: true, work_order_id: String(wo.id), status: nextStatus };
}

export function addWoWork(actor: Actor, workOrderId: string, name: string, qty = 1) {
  assertLiftShiftForOps(actor);
  const wo = get('SELECT id FROM sto_work_orders WHERE id = ?', [workOrderId]);
  if (!wo) throw new Error('Заказ-наряд не найден');
  const n = String(name || '').trim();
  if (!n) throw new Error('Укажите название работы');
  const id = newGuid();
  run(`INSERT INTO sto_wo_works (id, work_order_id, name, qty, sort_order) VALUES (?, ?, ?, ?, 0)`, [
    id,
    workOrderId,
    n,
    Number(qty) > 0 ? Number(qty) : 1,
  ]);
  touchLiftShift(actor.id);
  return get('SELECT * FROM sto_wo_works WHERE id = ?', [id]);
}

function defaultWarehouseId(): string | null {
  return (
    get<{ id: string }>(
      `SELECT id FROM warehouses WHERE is_active = 1 ORDER BY name LIMIT 1`
    )?.id || null
  );
}

export function addMaterial(
  actor: Actor,
  opts: {
    work_order_id: string;
    product_id: string;
    qty: number;
    work_log_id?: string;
    write_off?: boolean;
  }
) {
  assertLiftShiftForOps(actor);
  const wo = get('SELECT id, number FROM sto_work_orders WHERE id = ?', [opts.work_order_id]);
  if (!wo) throw new Error('Заказ-наряд не найден');
  const qty = Number(opts.qty);
  if (!(qty > 0)) throw new Error('Количество должно быть > 0');
  const product = get<{
    id: string;
    sku: string;
    name: string;
    unit_id: string;
  }>('SELECT id, sku, name, unit_id FROM products WHERE id = ?', [opts.product_id]);
  if (!product) throw new Error('Товар не найден');
  const unit =
    get<{ short_name: string }>('SELECT short_name FROM units WHERE id = ?', [product.unit_id])
      ?.short_name || '';

  let stockDocId = '';
  let wroteOff = 0;
  let stockNote = '';
  const doWriteOff = opts.write_off !== false;
  if (doWriteOff) {
    let wh = '';
    try {
      wh = stoWarehouseId();
    } catch {
      wh = defaultWarehouseId() || '';
    }
    if (!wh) {
      stockNote = 'Нет активного склада — только привязка к наряду';
    } else {
      try {
        stockDocId = createDocument({
          doc_type: 'out',
          warehouse_id: wh,
          comment: `СТО ЗН ${String((wo as { number?: string }).number || '')} · ${actor.name}`,
          lines: [{ product_id: product.id, qty }],
          post: true,
        });
        wroteOff = 1;
        stockNote = 'Списано со склада СТО';
      } catch (e) {
        stockNote = e instanceof Error ? e.message : 'Ошибка списания';
      }
    }
  } else {
    stockNote = 'Без списания — только учёт на наряде';
  }

  const id = newGuid();
  run(
    `INSERT INTO sto_wo_materials (
      id, work_order_id, product_id, sku, name, qty, unit,
      staff_id, staff_name, work_log_id, stock_doc_id, wrote_off, stock_note
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      opts.work_order_id,
      product.id,
      product.sku,
      product.name,
      qty,
      unit,
      actor.id,
      actor.name,
      String(opts.work_log_id || ''),
      stockDocId,
      wroteOff,
      stockNote,
    ]
  );
  touchLiftShift(actor.id);
  return get('SELECT * FROM sto_wo_materials WHERE id = ?', [id]);
}

export function listWorkCatalog() {
  return {
    items: all(
      `SELECT * FROM sto_work_catalog WHERE is_active = 1 ORDER BY sort_order, name`
    ),
  };
}

export function createWorkLog(
  actor: Actor,
  opts: {
    work_order_id: string;
    lift_id?: string;
    work_name?: string;
    catalog_id?: string;
    qty?: number;
    hours?: number;
    status?: string;
    note?: string;
  }
) {
  assertLiftShiftForOps(actor);
  const wo = get<Record<string, unknown>>(
    'SELECT * FROM sto_work_orders WHERE id = ?',
    [opts.work_order_id]
  );
  if (!wo) throw new Error('Заказ-наряд не найден');

  let workName = String(opts.work_name || '').trim();
  let catalogId = String(opts.catalog_id || '').trim();
  let hours = Number(opts.hours) || 0;
  if (catalogId) {
    const cat = get<{ name: string; hours_default: number }>(
      'SELECT name, hours_default FROM sto_work_catalog WHERE id = ?',
      [catalogId]
    );
    if (!cat) throw new Error('Работа из справочника не найдена');
    if (!workName) workName = cat.name;
    if (!hours) hours = Number(cat.hours_default) || 0;
  }
  if (!workName) throw new Error('Укажите название работы');

  const status = ['planned', 'in_progress', 'done'].includes(String(opts.status || ''))
    ? String(opts.status)
    : 'done';
  const now = new Date().toISOString();
  const id = newGuid();
  const liftId = String(opts.lift_id || wo.lift_id || '');
  run(
    `INSERT INTO sto_work_logs (
      id, work_order_id, lift_id, appointment_id, staff_id, staff_name,
      work_name, catalog_id, qty, hours, status, note, started_at, finished_at
    ) VALUES (?, ?, ?, '', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      opts.work_order_id,
      liftId,
      actor.id,
      actor.name,
      workName,
      catalogId,
      Number(opts.qty) > 0 ? Number(opts.qty) : 1,
      hours,
      status,
      String(opts.note || '').trim(),
      status === 'planned' ? '' : now,
      status === 'done' ? now : '',
    ]
  );

  // Зеркало в список работ наряда (если ещё нет такой строки)
  const exists = get<{ c: number }>(
    `SELECT COUNT(*) AS c FROM sto_wo_works WHERE work_order_id = ? AND name = ?`,
    [opts.work_order_id, workName]
  )?.c;
  if (!exists) {
    run(
      `INSERT INTO sto_wo_works (id, work_order_id, name, qty, sort_order) VALUES (?, ?, ?, ?, 0)`,
      [newGuid(), opts.work_order_id, workName, Number(opts.qty) > 0 ? Number(opts.qty) : 1]
    );
  }

  touchLiftShift(actor.id);
  return get('SELECT * FROM sto_work_logs WHERE id = ?', [id]);
}

export function patchWorkLog(
  actor: Actor,
  id: string,
  patch: { status?: string; hours?: number; qty?: number; note?: string; work_name?: string }
) {
  assertLiftShiftForOps(actor);
  const row = get<Record<string, unknown>>('SELECT * FROM sto_work_logs WHERE id = ?', [id]);
  if (!row) return null;
  if (
    String(row.staff_id) !== actor.id &&
    !(actor.isSystemAdmin || actor.role === 'admin' || actor.role === 'manager')
  ) {
    throw new Error('Можно менять только свои работы');
  }
  const sets: string[] = [];
  const params: Array<string | number> = [];
  if (patch.work_name != null) {
    sets.push('work_name = ?');
    params.push(String(patch.work_name).trim());
  }
  if (patch.note != null) {
    sets.push('note = ?');
    params.push(String(patch.note).trim());
  }
  if (patch.hours != null) {
    sets.push('hours = ?');
    params.push(Number(patch.hours) || 0);
  }
  if (patch.qty != null) {
    sets.push('qty = ?');
    params.push(Number(patch.qty) > 0 ? Number(patch.qty) : 1);
  }
  if (patch.status != null) {
    const st = String(patch.status);
    if (!['planned', 'in_progress', 'done'].includes(st)) throw new Error('Неверный статус');
    sets.push('status = ?');
    params.push(st);
    if (st === 'done' && !row.finished_at) {
      sets.push(`finished_at = ?`);
      params.push(new Date().toISOString());
    }
    if (st === 'in_progress' && !row.started_at) {
      sets.push(`started_at = ?`);
      params.push(new Date().toISOString());
    }
  }
  if (!sets.length) return row;
  params.push(id);
  run(`UPDATE sto_work_logs SET ${sets.join(', ')} WHERE id = ?`, params);
  touchLiftShift(actor.id);
  return get('SELECT * FROM sto_work_logs WHERE id = ?', [id]);
}

/** Отчёт / список работ слесаря за день или по наряду. */
export function listWorkLogs(opts?: {
  day?: string;
  staff_id?: string;
  work_order_id?: string;
  limit?: number;
}) {
  const limit = Math.min(500, Math.max(1, Number(opts?.limit) || 100));
  const where: string[] = [];
  const params: Array<string | number> = [];
  if (opts?.staff_id) {
    where.push('l.staff_id = ?');
    params.push(opts.staff_id);
  }
  if (opts?.work_order_id) {
    where.push('l.work_order_id = ?');
    params.push(opts.work_order_id);
  }
  if (opts?.day) {
    where.push(`substr(l.created_at, 1, 10) = ?`);
    params.push(opts.day.slice(0, 10));
  }
  params.push(limit);
  const items = all<Record<string, unknown>>(
    `SELECT l.*,
            wo.number AS order_number,
            wo.plate AS order_plate,
            wo.model AS order_model,
            wo.customer_name AS order_client,
            r.name AS lift_name
     FROM sto_work_logs l
     LEFT JOIN sto_work_orders wo ON wo.id = l.work_order_id
     LEFT JOIN sto_resources r ON r.id = l.lift_id
     ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
     ORDER BY l.created_at DESC
     LIMIT ?`,
    params
  );
  const hoursSum = items.reduce((s, r) => s + (Number(r.hours) || 0), 0);
  const doneCount = items.filter((r) => r.status === 'done').length;
  return {
    items,
    summary: {
      count: items.length,
      done: doneCount,
      hours: Math.round(hoursSum * 100) / 100,
    },
  };
}

export function todayArrivedQueue() {
  const d = today();
  return {
    day: d,
    items: all(
      `SELECT a.*, wo.number AS order_number, wo.status AS order_status, wo.lift_id
       FROM sto_appointments a
       LEFT JOIN sto_work_orders wo ON wo.id = a.work_order_id
       WHERE a.day = ? AND a.status IN ('arrived', 'expected', 'on_lift')
       ORDER BY
         CASE a.status WHEN 'arrived' THEN 0 WHEN 'expected' THEN 1 ELSE 2 END,
         a.time_hm, a.created_at`
    ),
  };
}
