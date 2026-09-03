/**
 * Внутренние уведомления сотрудникам (колокольчик в шапке).
 */
import { all, get, run } from './db.js';
import { newGuid } from './ids.js';

export function ensureStaffNotificationsSchema() {
  run(`
    CREATE TABLE IF NOT EXISTS staff_notifications (
      id TEXT PRIMARY KEY,
      staff_id TEXT NOT NULL DEFAULT '',
      kind TEXT NOT NULL DEFAULT '',
      title TEXT NOT NULL DEFAULT '',
      body TEXT NOT NULL DEFAULT '',
      deal_id TEXT NOT NULL DEFAULT '',
      href TEXT NOT NULL DEFAULT '',
      meta_json TEXT NOT NULL DEFAULT '{}',
      read_at TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_staff_notif_staff
      ON staff_notifications(staff_id, read_at, created_at);
  `);
}

export function createStaffNotification(input: {
  staff_id: string;
  kind: string;
  title: string;
  body?: string;
  deal_id?: string;
  href?: string;
  meta?: Record<string, unknown>;
}) {
  ensureStaffNotificationsSchema();
  const staffId = String(input.staff_id || '').trim();
  if (!staffId) return null;
  const id = newGuid();
  run(
    `INSERT INTO staff_notifications
      (id, staff_id, kind, title, body, deal_id, href, meta_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
    [
      id,
      staffId,
      String(input.kind || '').slice(0, 64),
      String(input.title || '').slice(0, 200),
      String(input.body || '').slice(0, 1000),
      String(input.deal_id || ''),
      String(input.href || ''),
      JSON.stringify(input.meta || {}),
    ]
  );
  return get(`SELECT * FROM staff_notifications WHERE id = ?`, [id]);
}

/** Уведомить ответственного по сделке (amo_id → staff). Fallback — админы. */
export function notifyDealResponsible(input: {
  deal_id: string;
  kind: string;
  title: string;
  body?: string;
  href?: string;
  meta?: Record<string, unknown>;
}) {
  ensureStaffNotificationsSchema();
  const dealId = String(input.deal_id || '').trim();
  if (!dealId) return { created: 0, staff_ids: [] as string[] };

  const deal = get<{ responsible_user_id?: string; name?: string }>(
    `SELECT responsible_user_id, name FROM crm_deals WHERE id = ?`,
    [dealId]
  );
  const amoId = String(deal?.responsible_user_id || '').trim();
  let staffIds: string[] = [];
  if (amoId) {
    staffIds = all<{ id: string }>(
      `SELECT id FROM staff
       WHERE IFNULL(is_active,1)=1 AND IFNULL(amo_id,'') = ?
       LIMIT 5`,
      [amoId]
    ).map((r) => r.id);
  }
  if (!staffIds.length) {
    staffIds = all<{ id: string }>(
      `SELECT id FROM staff
       WHERE IFNULL(is_active,1)=1 AND role IN ('admin','owner','director','manager')
       LIMIT 8`
    ).map((r) => r.id);
  }

  const href =
    String(input.href || '').trim() || `/deals/${encodeURIComponent(dealId)}/sto-pack`;
  const created: string[] = [];
  for (const sid of staffIds) {
    const row = createStaffNotification({
      staff_id: sid,
      kind: input.kind,
      title: input.title,
      body: input.body,
      deal_id: dealId,
      href,
      meta: input.meta,
    });
    if (row) created.push(sid);
  }
  return { created: created.length, staff_ids: created };
}

export function listStaffNotifications(staffId: string, opts?: { limit?: number; unread_only?: boolean }) {
  ensureStaffNotificationsSchema();
  const id = String(staffId || '').trim();
  if (!id) return { items: [], unread: 0 };
  const limit = Math.min(50, Math.max(1, Number(opts?.limit) || 20));
  const unreadOnly = !!opts?.unread_only;
  const items = all(
    `SELECT * FROM staff_notifications
     WHERE staff_id = ?
       ${unreadOnly ? `AND IFNULL(read_at,'') = ''` : ''}
     ORDER BY datetime(created_at) DESC
     LIMIT ?`,
    [id, limit]
  );
  const unread =
    Number(
      get<{ c: number }>(
        `SELECT COUNT(*) AS c FROM staff_notifications
         WHERE staff_id = ? AND IFNULL(read_at,'') = ''`,
        [id]
      )?.c
    ) || 0;
  return { items, unread };
}

export function markStaffNotificationsRead(staffId: string, ids?: string[]) {
  ensureStaffNotificationsSchema();
  const sid = String(staffId || '').trim();
  if (!sid) return { updated: 0 };
  if (Array.isArray(ids) && ids.length) {
    const clean = ids.map((x) => String(x || '').trim()).filter(Boolean).slice(0, 100);
    if (!clean.length) return { updated: 0 };
    const q = clean.map(() => '?').join(',');
    run(
      `UPDATE staff_notifications SET read_at = datetime('now')
       WHERE staff_id = ? AND id IN (${q}) AND IFNULL(read_at,'') = ''`,
      [sid, ...clean]
    );
  } else {
    run(
      `UPDATE staff_notifications SET read_at = datetime('now')
       WHERE staff_id = ? AND IFNULL(read_at,'') = ''`,
      [sid]
    );
  }
  return { updated: 1 };
}
