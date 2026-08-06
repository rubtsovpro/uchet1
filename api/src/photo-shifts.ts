/**
 * Смены фотографа (/photo): фиксация начала дня + счётчики товаров/фото/файлов.
 * Отдельная таблица photo_shifts — не пересекается с pick_shifts.
 */
import { all, get, run } from './db.js';
import { newGuid } from './ids.js';
import type { Actor } from './auth.js';
import { localParts } from './pick-shifts.js';
import { canAccessPhotoScreen as canAccessPhotoByRights } from './staff.js';

const TZ = 'Europe/Moscow';

/** Пока смены фотографа отключены: без обязательного старта/закрытия. */
const PHOTO_SHIFTS_UI_DISABLED = true;

export type PhotoShiftRow = {
  id: string;
  staff_id: string;
  staff_name: string;
  staff_login: string;
  day: string;
  started_at: string;
  ended_at: string;
  products_done: number;
  photos_uploaded: number;
  files_uploaded: number;
  created_at: string;
};

function mapShift(row: Record<string, unknown>): PhotoShiftRow {
  return {
    id: String(row.id || ''),
    staff_id: String(row.staff_id || ''),
    staff_name: String(row.staff_name || ''),
    staff_login: String(row.staff_login || ''),
    day: String(row.day || ''),
    started_at: String(row.started_at || ''),
    ended_at: String(row.ended_at || ''),
    products_done: Number(row.products_done) || 0,
    photos_uploaded: Number(row.photos_uploaded) || 0,
    files_uploaded: Number(row.files_uploaded) || 0,
    created_at: String(row.created_at || ''),
  };
}

/** Доступ к /photo — по разделу photo/media в матрице (админ — всегда). */
export function canAccessPhotoScreen(
  actor: Actor | null | undefined
): boolean {
  return canAccessPhotoByRights(actor);
}

export function canManagePhotoReport(
  actor: Actor | null | undefined
): boolean {
  if (!actor) return true;
  if (actor.isSystemAdmin || actor.role === 'admin' || actor.role === 'manager') {
    return true;
  }
  return actor.role === 'photographer';
}

export function getOpenPhotoShift(staffId: string): PhotoShiftRow | null {
  const row = get<Record<string, unknown>>(
    `SELECT * FROM photo_shifts
     WHERE staff_id = ? AND ended_at = ''
     ORDER BY started_at DESC LIMIT 1`,
    [staffId]
  );
  return row ? mapShift(row) : null;
}

export function startPhotoShift(actor: Actor): PhotoShiftRow {
  if (PHOTO_SHIFTS_UI_DISABLED) {
    throw new Error('Смены фотографа временно отключены');
  }
  const open = getOpenPhotoShift(actor.id);
  if (open) {
    throw new Error('Смена уже открыта — сначала завершите текущую');
  }
  const { day } = localParts(TZ);
  const now = new Date().toISOString();
  const id = newGuid();
  run(
    `INSERT INTO photo_shifts (
      id, staff_id, staff_name, staff_login, day,
      started_at, ended_at, products_done, photos_uploaded, files_uploaded
    ) VALUES (?, ?, ?, ?, ?, ?, '', 0, 0, 0)`,
    [id, actor.id, actor.name, actor.login, day, now]
  );
  return getOpenPhotoShift(actor.id)!;
}

export function endPhotoShift(actor: Actor): PhotoShiftRow | null {
  const open = getOpenPhotoShift(actor.id);
  if (!open) return null;
  const now = new Date().toISOString();
  run(`UPDATE photo_shifts SET ended_at = ? WHERE id = ?`, [now, open.id]);
  return mapShift({ ...open, ended_at: now });
}

/** Учитывать загрузку в открытой смене. newFile=true — реально новый файл в S3. */
export function recordPhotoShiftUpload(
  staffId: string,
  opts?: { newFile?: boolean; productCounted?: boolean }
): PhotoShiftRow | null {
  const open = getOpenPhotoShift(staffId);
  if (!open) return null;
  const products = opts?.productCounted === false ? 0 : 1;
  const photos = 1;
  const files = opts?.newFile === false ? 0 : 1;
  run(
    `UPDATE photo_shifts SET
       products_done = products_done + ?,
       photos_uploaded = photos_uploaded + ?,
       files_uploaded = files_uploaded + ?
     WHERE id = ?`,
    [products, photos, files, open.id]
  );
  return getOpenPhotoShift(staffId);
}

export function assertPhotoShiftForUpload(actor: Actor | null): void {
  if (PHOTO_SHIFTS_UI_DISABLED) return;
  if (!actor) return;
  if (actor.isSystemAdmin || actor.role === 'admin' || actor.role === 'manager') {
    return;
  }
  if (actor.role !== 'photographer') return;
  const open = getOpenPhotoShift(actor.id);
  if (!open) {
    throw new Error('Начните смену фотографа, чтобы загружать фото');
  }
}

export function photoShiftStatusPayload(actor: Actor) {
  const shift = getOpenPhotoShift(actor.id);
  const { day, hm } = localParts(TZ);
  return {
    shifts_disabled: PHOTO_SHIFTS_UI_DISABLED,
    shift: PHOTO_SHIFTS_UI_DISABLED ? null : shift,
    staff: {
      id: actor.id,
      name: actor.name,
      login: actor.login,
      role: actor.role,
    },
    local: { day, time: hm, tz: TZ },
  };
}

export type PhotoShiftReportRow = {
  staff_id: string;
  staff_name: string;
  staff_login: string;
  day: string;
  shifts_count: number;
  products_done: number;
  photos_uploaded: number;
  files_uploaded: number;
};

export function photoShiftsReport(opts?: {
  from?: string;
  to?: string;
  staff_id?: string;
  limit?: number;
}): {
  items: PhotoShiftReportRow[];
  totals: {
    shifts_count: number;
    products_done: number;
    photos_uploaded: number;
    files_uploaded: number;
  };
  local: { day: string; tz: string };
} {
  const limit = Math.min(500, Math.max(1, Number(opts?.limit) || 200));
  const where: string[] = [];
  const params: Array<string | number> = [];
  if (opts?.from) {
    where.push('day >= ?');
    params.push(opts.from);
  }
  if (opts?.to) {
    where.push('day <= ?');
    params.push(opts.to);
  }
  if (opts?.staff_id) {
    where.push('staff_id = ?');
    params.push(opts.staff_id);
  }
  const sql = `SELECT
      staff_id,
      MAX(staff_name) AS staff_name,
      MAX(staff_login) AS staff_login,
      day,
      COUNT(*) AS shifts_count,
      COALESCE(SUM(products_done), 0) AS products_done,
      COALESCE(SUM(photos_uploaded), 0) AS photos_uploaded,
      COALESCE(SUM(files_uploaded), 0) AS files_uploaded
    FROM photo_shifts
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    GROUP BY staff_id, day
    ORDER BY day DESC, staff_name COLLATE NOCASE
    LIMIT ?`;
  params.push(limit);
  const items = all<Record<string, unknown>>(sql, params).map((r) => ({
    staff_id: String(r.staff_id || ''),
    staff_name: String(r.staff_name || ''),
    staff_login: String(r.staff_login || ''),
    day: String(r.day || ''),
    shifts_count: Number(r.shifts_count) || 0,
    products_done: Number(r.products_done) || 0,
    photos_uploaded: Number(r.photos_uploaded) || 0,
    files_uploaded: Number(r.files_uploaded) || 0,
  }));
  const totals = items.reduce(
    (acc, it) => {
      acc.shifts_count += it.shifts_count;
      acc.products_done += it.products_done;
      acc.photos_uploaded += it.photos_uploaded;
      acc.files_uploaded += it.files_uploaded;
      return acc;
    },
    { shifts_count: 0, products_done: 0, photos_uploaded: 0, files_uploaded: 0 }
  );
  const { day } = localParts(TZ);
  return { items, totals, local: { day, tz: TZ } };
}

export function listPhotoShifts(opts?: {
  day?: string;
  staff_id?: string;
  limit?: number;
}): PhotoShiftRow[] {
  const limit = Math.min(500, Math.max(1, Number(opts?.limit) || 100));
  const where: string[] = [];
  const params: Array<string | number> = [];
  if (opts?.day) {
    where.push('day = ?');
    params.push(opts.day);
  }
  if (opts?.staff_id) {
    where.push('staff_id = ?');
    params.push(opts.staff_id);
  }
  const sql = `SELECT * FROM photo_shifts
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY started_at DESC LIMIT ?`;
  params.push(limit);
  return all<Record<string, unknown>>(sql, params).map(mapShift);
}
