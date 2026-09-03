/**
 * Web Push для мобильного экрана «Фото авто при приёме».
 * VAPID: из env или автогенерация в data/vapid.json.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import webpush from 'web-push';
import { all, get, run } from './db.js';
import { newGuid } from './ids.js';
import {
  canAccessSection,
  effectiveRightsForStaff,
  type StaffRights,
} from './staff.js';
import { createStaffNotification } from './staff-notifications.js';
import { dealCarPhotosSummary } from './deal-car-photos.js';
import { stsMediaInfo } from './sts-media.js';
import { looksLikeAmoNameCityLabel, resolvePersonDocFio } from './person-fio.js';

export type ReceptionPhotoKind = 'car' | 'sts' | 'both';

function mergePhotoKinds(a: string, b: string): ReceptionPhotoKind {
  const set = new Set([a, b].flatMap((k) => (k === 'both' ? ['car', 'sts'] : [k])));
  if (set.has('car') && set.has('sts')) return 'both';
  if (set.has('sts')) return 'sts';
  return 'car';
}

function kindTitle(kind: string): string {
  if (kind === 'sts') return 'Сфотографировать СТС';
  if (kind === 'both') return 'Сфотографировать СТС и авто';
  return 'Сфотографировать авто';
}

function kindTag(kind: string, dealId: string): string {
  return `reception-photo-${kind}-${dealId}`;
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function dataDir(): string {
  return process.env.WMS_DATA_DIR || path.resolve(__dirname, '..', '..', 'data');
}

type VapidKeys = { publicKey: string; privateKey: string; subject: string };

let cachedVapid: VapidKeys | null = null;
let webPushReady = false;

export function ensureWebPushSchema() {
  run(`
    CREATE TABLE IF NOT EXISTS web_push_subscriptions (
      id TEXT PRIMARY KEY,
      staff_id TEXT NOT NULL,
      endpoint TEXT NOT NULL UNIQUE,
      p256dh TEXT NOT NULL DEFAULT '',
      auth TEXT NOT NULL DEFAULT '',
      user_agent TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_web_push_staff
      ON web_push_subscriptions(staff_id);
  `);
  run(`
    CREATE TABLE IF NOT EXISTS car_photo_tasks (
      id TEXT PRIMARY KEY,
      deal_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'open',
      kind TEXT NOT NULL DEFAULT 'car',
      note TEXT NOT NULL DEFAULT '',
      created_by TEXT NOT NULL DEFAULT '',
      created_by_name TEXT NOT NULL DEFAULT '',
      claimed_by TEXT NOT NULL DEFAULT '',
      completed_at TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_car_photo_tasks_deal
      ON car_photo_tasks(deal_id, status, created_at);
    CREATE INDEX IF NOT EXISTS idx_car_photo_tasks_open
      ON car_photo_tasks(status, created_at);
  `);
  try {
    const cols = all<{ name: string }>(`PRAGMA table_info(car_photo_tasks)`).map((c) => c.name);
    if (!cols.includes('kind')) {
      run(`ALTER TABLE car_photo_tasks ADD COLUMN kind TEXT NOT NULL DEFAULT 'car'`);
    }
  } catch {
    /* ignore */
  }
}

function vapidFilePath() {
  return path.join(dataDir(), 'vapid.json');
}

export function getVapidKeys(): VapidKeys {
  if (cachedVapid) return cachedVapid;
  const envPub = String(process.env.VAPID_PUBLIC_KEY || '').trim();
  const envPriv = String(process.env.VAPID_PRIVATE_KEY || '').trim();
  const subject = String(process.env.VAPID_SUBJECT || 'mailto:admin@uchetn1.ru').trim();
  if (envPub && envPriv) {
    cachedVapid = { publicKey: envPub, privateKey: envPriv, subject };
    return cachedVapid;
  }
  const fp = vapidFilePath();
  try {
    if (fs.existsSync(fp)) {
      const j = JSON.parse(fs.readFileSync(fp, 'utf8')) as VapidKeys;
      if (j.publicKey && j.privateKey) {
        cachedVapid = {
          publicKey: j.publicKey,
          privateKey: j.privateKey,
          subject: j.subject || subject,
        };
        return cachedVapid;
      }
    }
  } catch {
    /* regenerate */
  }
  const generated = webpush.generateVAPIDKeys();
  cachedVapid = {
    publicKey: generated.publicKey,
    privateKey: generated.privateKey,
    subject,
  };
  try {
    fs.mkdirSync(path.dirname(fp), { recursive: true });
    fs.writeFileSync(fp, JSON.stringify(cachedVapid, null, 2), 'utf8');
  } catch (e) {
    console.warn('[web-push] cannot persist vapid.json:', e instanceof Error ? e.message : e);
  }
  return cachedVapid;
}

function ensureWebPushConfigured() {
  if (webPushReady) return;
  const keys = getVapidKeys();
  webpush.setVapidDetails(keys.subject, keys.publicKey, keys.privateKey);
  webPushReady = true;
}

export function getVapidPublicKey(): string {
  return getVapidKeys().publicKey;
}

export function upsertPushSubscription(input: {
  staffId: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  userAgent?: string;
}) {
  ensureWebPushSchema();
  const staffId = String(input.staffId || '').trim();
  const endpoint = String(input.endpoint || '').trim();
  const p256dh = String(input.p256dh || '').trim();
  const auth = String(input.auth || '').trim();
  if (!staffId || !endpoint || !p256dh || !auth) {
    throw new Error('Нужны endpoint, keys.p256dh, keys.auth');
  }
  const existing = get<{ id: string }>(
    `SELECT id FROM web_push_subscriptions WHERE endpoint = ?`,
    [endpoint]
  );
  const now = new Date().toISOString();
  if (existing?.id) {
    run(
      `UPDATE web_push_subscriptions
       SET staff_id = ?, p256dh = ?, auth = ?, user_agent = ?, updated_at = ?
       WHERE id = ?`,
      [staffId, p256dh, auth, String(input.userAgent || '').slice(0, 300), now, existing.id]
    );
    return existing.id;
  }
  const id = newGuid();
  run(
    `INSERT INTO web_push_subscriptions
      (id, staff_id, endpoint, p256dh, auth, user_agent, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, staffId, endpoint, p256dh, auth, String(input.userAgent || '').slice(0, 300), now, now]
  );
  return id;
}

export function deletePushSubscription(endpoint: string, staffId?: string) {
  ensureWebPushSchema();
  const ep = String(endpoint || '').trim();
  if (!ep) return 0;
  if (staffId) {
    run(`DELETE FROM web_push_subscriptions WHERE endpoint = ? AND staff_id = ?`, [
      ep,
      staffId,
    ]);
  } else {
    run(`DELETE FROM web_push_subscriptions WHERE endpoint = ?`, [ep]);
  }
  return 1;
}

/** Сотрудники с разделом reception (и админы) — получатели пуша «сфотать авто». */
export function listReceptionStaffIds(): string[] {
  const rows = all<{
    id: string;
    role: string;
    rights_json: string;
    department: string;
  }>(
    `SELECT id, role, IFNULL(rights_json,'') AS rights_json, IFNULL(department,'') AS department
     FROM staff WHERE IFNULL(is_active,1)=1`
  );
  const out: string[] = [];
  for (const r of rows) {
    if (String(r.role) === 'admin') {
      out.push(r.id);
      continue;
    }
    const rights = effectiveRightsForStaff(r);
    const actor = { role: r.role, rights };
    if (canAccessSection(actor, 'reception') || canAccessSection(actor, 'works')) {
      out.push(r.id);
    }
  }
  return [...new Set(out)];
}

export async function sendWebPushToStaff(
  staffIds: string[],
  payload: { title: string; body: string; url?: string; tag?: string; dealId?: string }
): Promise<{ sent: number; failed: number }> {
  ensureWebPushSchema();
  ensureWebPushConfigured();
  const ids = [...new Set(staffIds.map(String).filter(Boolean))];
  if (!ids.length) return { sent: 0, failed: 0 };
  const placeholders = ids.map(() => '?').join(',');
  const subs = all<{
    id: string;
    endpoint: string;
    p256dh: string;
    auth: string;
  }>(
    `SELECT id, endpoint, p256dh, auth FROM web_push_subscriptions
     WHERE staff_id IN (${placeholders})`,
    ids
  );
  let sent = 0;
  let failed = 0;
  const body = JSON.stringify({
    title: payload.title,
    body: payload.body,
    url: payload.url || '/reception-photo?v=rp7',
    tag: payload.tag || 'car-photo',
    dealId: payload.dealId || '',
  });
  for (const sub of subs) {
    try {
      await webpush.sendNotification(
        {
          endpoint: sub.endpoint,
          keys: { p256dh: sub.p256dh, auth: sub.auth },
        },
        body,
        { TTL: 60 * 60 * 6, urgency: 'high' }
      );
      sent += 1;
    } catch (e) {
      failed += 1;
      const status = Number((e as { statusCode?: number })?.statusCode || 0);
      if (status === 404 || status === 410) {
        run(`DELETE FROM web_push_subscriptions WHERE id = ?`, [sub.id]);
      }
    }
  }
  return { sent, failed };
}

export type CarPhotoTask = {
  id: string;
  deal_id: string;
  status: string;
  /** car | sts | both */
  kind: string;
  note: string;
  created_by: string;
  created_by_name: string;
  claimed_by: string;
  completed_at: string;
  created_at: string;
  buyer_name?: string;
  car_plate?: string;
  car_brand?: string;
  car_model?: string;
  photo_count?: number;
  sts_front?: boolean;
  sts_back?: boolean;
};

export function createCarPhotoTask(input: {
  dealId: string;
  kind?: ReceptionPhotoKind | 'car' | 'sts';
  note?: string;
  createdBy?: string;
  createdByName?: string;
}): CarPhotoTask {
  ensureWebPushSchema();
  const dealId = String(input.dealId || '').trim();
  if (!dealId) throw new Error('deal_id required');
  const want = (input.kind === 'sts' ? 'sts' : input.kind === 'both' ? 'both' : 'car') as ReceptionPhotoKind;
  const deal = get<{ id: string }>(`SELECT id FROM crm_deals WHERE id = ?`, [dealId]);
  if (!deal) throw new Error('Заказ не найден');
  const open = get<CarPhotoTask>(
    `SELECT * FROM car_photo_tasks WHERE deal_id = ? AND status = 'open' ORDER BY created_at DESC LIMIT 1`,
    [dealId]
  );
  if (open) {
    const merged = mergePhotoKinds(String(open.kind || 'car'), want);
    if (merged !== String(open.kind || 'car')) {
      run(`UPDATE car_photo_tasks SET kind = ? WHERE id = ?`, [merged, open.id]);
      open.kind = merged;
    }
    if (input.note) {
      run(`UPDATE car_photo_tasks SET note = ? WHERE id = ?`, [
        String(input.note).slice(0, 500),
        open.id,
      ]);
      open.note = String(input.note).slice(0, 500);
    }
    return enrichCarPhotoTask(open);
  }
  const id = newGuid();
  run(
    `INSERT INTO car_photo_tasks
      (id, deal_id, status, kind, note, created_by, created_by_name, created_at)
     VALUES (?, ?, 'open', ?, ?, ?, ?, datetime('now'))`,
    [
      id,
      dealId,
      want,
      String(input.note || '').slice(0, 500),
      String(input.createdBy || ''),
      String(input.createdByName || '').slice(0, 120),
    ]
  );
  const row = get<CarPhotoTask>(`SELECT * FROM car_photo_tasks WHERE id = ?`, [id]);
  return enrichCarPhotoTask(row!);
}

function enrichCarPhotoTask(row: CarPhotoTask): CarPhotoTask {
  const deal = get<{
    buyer_name?: string;
    company_name?: string;
    car_plate?: string;
    car_brand?: string;
    car_model?: string;
  }>(
    `SELECT buyer_name, company_name, car_plate, car_brand, car_model
     FROM crm_deals WHERE id = ?`,
    [row.deal_id]
  );
  const summary = dealCarPhotosSummary(row.deal_id);
  const sts = stsMediaInfo(row.deal_id);
  /** ФИО как в паспорте / после ПДн; ярлык Amo «Павел Москва» не показываем. */
  const fio = resolvePersonDocFio(deal as Record<string, unknown>);
  const company = String(deal?.company_name || '').trim();
  const buyerDisplay =
    fio ||
    (company && !looksLikeAmoNameCityLabel(company) ? company : '') ||
    '';
  return {
    ...row,
    kind: String(row.kind || 'car'),
    buyer_name: buyerDisplay,
    car_plate: String(deal?.car_plate || '').trim(),
    car_brand: String(deal?.car_brand || '').trim(),
    car_model: String(deal?.car_model || '').trim(),
    photo_count: Number(summary.count) || 0,
    sts_front: !!sts.front,
    sts_back: !!sts.back,
  };
}

export function listOpenCarPhotoTasks(limit = 40): CarPhotoTask[] {
  ensureWebPushSchema();
  const rows = all<CarPhotoTask>(
    `SELECT * FROM car_photo_tasks WHERE status = 'open'
     ORDER BY created_at DESC LIMIT ?`,
    [Math.min(100, Math.max(1, limit))]
  );
  return rows.map(enrichCarPhotoTask);
}

export function getCarPhotoTask(id: string): CarPhotoTask | null {
  ensureWebPushSchema();
  const row = get<CarPhotoTask>(`SELECT * FROM car_photo_tasks WHERE id = ?`, [
    String(id || '').trim(),
  ]);
  return row ? enrichCarPhotoTask(row) : null;
}

export function getOpenCarPhotoTaskForDeal(dealId: string): CarPhotoTask | null {
  ensureWebPushSchema();
  const row = get<CarPhotoTask>(
    `SELECT * FROM car_photo_tasks WHERE deal_id = ? AND status = 'open'
     ORDER BY created_at DESC LIMIT 1`,
    [String(dealId || '').trim()]
  );
  return row ? enrichCarPhotoTask(row) : null;
}

export function completeCarPhotoTaskForDeal(dealId: string, doneKind: 'car' | 'sts' = 'car') {
  ensureWebPushSchema();
  const id = String(dealId || '').trim();
  if (!id) return;
  const open = get<{ id: string; kind: string }>(
    `SELECT id, kind FROM car_photo_tasks WHERE deal_id = ? AND status = 'open'
     ORDER BY created_at DESC LIMIT 1`,
    [id]
  );
  if (!open) return;
  const kind = String(open.kind || 'car');
  if (kind === 'both') {
    const carOk = dealCarPhotosSummary(id).photos_ok;
    const sts = stsMediaInfo(id);
    const stsOk = !!(sts.front && sts.back);
    if (carOk && stsOk) {
      run(
        `UPDATE car_photo_tasks SET status = 'done', completed_at = datetime('now') WHERE id = ?`,
        [open.id]
      );
    }
    return;
  }
  if (kind === 'sts' && doneKind !== 'sts') return;
  if (kind === 'car' && doneKind !== 'car') return;
  if (kind === 'sts') {
    const sts = stsMediaInfo(id);
    if (!(sts.front && sts.back)) return;
  }
  if (kind === 'car') {
    if (!dealCarPhotosSummary(id).photos_ok) return;
  }
  run(
    `UPDATE car_photo_tasks SET status = 'done', completed_at = datetime('now') WHERE id = ?`,
    [open.id]
  );
}

/** Закрыть задачу вручную («Готово» на телефоне) — без проверки нормы фото. */
export function closeCarPhotoTask(taskId: string): CarPhotoTask | null {
  ensureWebPushSchema();
  const id = String(taskId || '').trim();
  if (!id) return null;
  const row = get<CarPhotoTask>(`SELECT * FROM car_photo_tasks WHERE id = ?`, [id]);
  if (!row) return null;
  if (String(row.status) === 'open') {
    run(
      `UPDATE car_photo_tasks SET status = 'done', completed_at = datetime('now') WHERE id = ?`,
      [id]
    );
  }
  return getCarPhotoTask(id);
}

/** Закрыть открытую задачу по сделке (если нет task id). */
export function closeOpenCarPhotoTaskForDeal(dealId: string): CarPhotoTask | null {
  ensureWebPushSchema();
  const id = String(dealId || '').trim();
  if (!id) return null;
  const open = get<{ id: string }>(
    `SELECT id FROM car_photo_tasks WHERE deal_id = ? AND status = 'open'
     ORDER BY created_at DESC LIMIT 1`,
    [id]
  );
  if (!open?.id) return null;
  return closeCarPhotoTask(open.id);
}

/** Создать задачу + колокольчик + Web Push приёмщикам. */
export async function requestCarPhotoShoot(input: {
  dealId: string;
  kind?: ReceptionPhotoKind | 'car' | 'sts';
  note?: string;
  createdBy?: string;
  createdByName?: string;
  actorRights?: StaffRights;
  actorRole?: string;
}): Promise<{
  task: CarPhotoTask;
  notified: number;
  push: { sent: number; failed: number };
  href: string;
}> {
  const task = createCarPhotoTask(input);
  const plate = task.car_plate || 'без номера';
  const buyer = task.buyer_name || 'клиент';
  const title = kindTitle(task.kind);
  const href = `/reception-photo?v=rp7&deal=${encodeURIComponent(task.deal_id)}&task=${encodeURIComponent(task.id)}&kind=${encodeURIComponent(task.kind)}`;
  const staffIds = listReceptionStaffIds();
  let notified = 0;
  for (const sid of staffIds) {
    createStaffNotification({
      staff_id: sid,
      kind: task.kind === 'sts' ? 'sts_photo_request' : 'car_photo_request',
      title,
      body: `${buyer} · ${plate}${input.note ? ' · ' + input.note : ''}`,
      deal_id: task.deal_id,
      href,
      meta: { task_id: task.id, kind: task.kind },
    });
    notified += 1;
  }
  const push = await sendWebPushToStaff(staffIds, {
    title,
    body: `${buyer} · ${plate}`,
    url: href,
    tag: kindTag(task.kind, task.deal_id),
    dealId: task.deal_id,
  });
  return { task, notified, push, href };
}

export function canUseCarPhotoReception(actor: {
  role?: string;
  isSystemAdmin?: boolean;
  rights?: StaffRights;
} | null): boolean {
  if (!actor) return false;
  if (actor.isSystemAdmin || actor.role === 'admin') return true;
  return (
    canAccessSection(actor, 'reception') ||
    canAccessSection(actor, 'works') ||
    canAccessSection(actor, 'crm')
  );
}

/** Сотрудники с разделом pick (и админы) — получатели пуша «пикинг / перемещение». */
export function listPickStaffIds(): string[] {
  const rows = all<{
    id: string;
    role: string;
    rights_json: string;
    department: string;
  }>(
    `SELECT id, role, IFNULL(rights_json,'') AS rights_json, IFNULL(department,'') AS department
     FROM staff WHERE IFNULL(is_active,1)=1`
  );
  const out: string[] = [];
  for (const r of rows) {
    if (String(r.role) === 'admin') {
      out.push(r.id);
      continue;
    }
    const rights = effectiveRightsForStaff(r);
    const actor = { role: r.role, rights };
    if (canAccessSection(actor, 'pick')) {
      out.push(r.id);
    }
  }
  return [...new Set(out)];
}

/** Колокольчик + Web Push кладовщикам: открыть /pick?task=… */
export async function requestWarehousePickPush(input: {
  taskId: string;
  taskNumber?: string;
  fromLabel?: string;
  toLabel?: string;
  dealId?: string;
  transferOrderId?: string;
  comment?: string;
}): Promise<{
  notified: number;
  push: { sent: number; failed: number };
  href: string;
  staff_ids: string[];
}> {
  const taskId = String(input.taskId || '').trim();
  if (!taskId) throw new Error('Нет задания склада');
  const num = String(input.taskNumber || '').trim() || taskId.slice(0, 8);
  const route = [String(input.fromLabel || '').trim(), String(input.toLabel || '').trim()]
    .filter(Boolean)
    .join(' → ');
  const href = `/pick?task=${encodeURIComponent(taskId)}`;
  const title = 'Пикинг · перемещение';
  const body = [num, route, String(input.comment || '').trim()].filter(Boolean).join(' · ');
  const staffIds = listPickStaffIds();
  let notified = 0;
  for (const sid of staffIds) {
    createStaffNotification({
      staff_id: sid,
      kind: 'warehouse_pick_request',
      title,
      body,
      deal_id: String(input.dealId || ''),
      href,
      meta: {
        task_id: taskId,
        transfer_order_id: String(input.transferOrderId || ''),
      },
    });
    notified += 1;
  }
  const push = await sendWebPushToStaff(staffIds, {
    title,
    body: body || num,
    url: href,
    tag: `pick-${taskId}`,
    dealId: String(input.dealId || ''),
  });
  return { notified, push, href, staff_ids: staffIds };
}
