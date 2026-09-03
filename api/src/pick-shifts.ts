/**
 * Смены сборщика (/pick): привязка к сотруднику + PIN + утренний автостарт дневной.
 */
import { get, run, all } from './db.js';
import { newGuid } from './ids.js';
import {
  hashPassword,
  verifyPassword,
  type Actor,
} from './auth.js';

const META_KEY = 'pick_shift_settings';

/** Пока смены сборщика отключены: без обязательной смены и без утреннего автостарта. */
const PICK_SHIFTS_UI_DISABLED = true;

export type PickShiftKind = 'day' | 'evening';

export type PickShiftSettings = {
  /** Часовой пояс склада (IANA). */
  tz: string;
  /** Начало окна утреннего автостарта, HH:MM. */
  morning_from: string;
  /** Конец окна утреннего автостарта, HH:MM. */
  morning_to: string;
  /** Предлагать / начинать дневную смену в утреннем окне. */
  auto_morning: boolean;
  /** Требовать открытую смену для операций «Сделал» / «Не сделал». */
  require_shift_for_ops: boolean;
  /** После простоя (мин) снова спросить PIN при продолжении смены. 0 = выкл. */
  idle_reauth_minutes: number;
};

const DEFAULT_SETTINGS: PickShiftSettings = {
  tz: 'Europe/Moscow',
  morning_from: '06:00',
  morning_to: '10:00',
  auto_morning: false,
  require_shift_for_ops: false,
  idle_reauth_minutes: 0,
};

export type PickShiftRow = {
  id: string;
  staff_id: string;
  staff_name: string;
  staff_login: string;
  kind: PickShiftKind;
  day: string;
  started_at: string;
  ended_at: string;
  pin_verified_at: string;
  last_activity_at: string;
  auto_started: number;
  created_at: string;
};

function parseHm(hm: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hm || '').trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (!Number.isFinite(h) || !Number.isFinite(min) || h > 23 || min > 59) return null;
  return h * 60 + min;
}

/** Локальные дата/время в заданном TZ. */
export function localParts(tz: string, at = new Date()): {
  day: string;
  hm: string;
  minutes: number;
} {
  const safeTz = tz || 'Europe/Moscow';
  let day = '';
  let hm = '';
  try {
    const dtf = new Intl.DateTimeFormat('en-CA', {
      timeZone: safeTz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    });
    const parts = Object.fromEntries(
      dtf.formatToParts(at).filter((p) => p.type !== 'literal').map((p) => [p.type, p.value])
    );
    day = `${parts.year}-${parts.month}-${parts.day}`;
    hm = `${parts.hour}:${parts.minute}`;
  } catch {
    const iso = at.toISOString();
    day = iso.slice(0, 10);
    hm = iso.slice(11, 16);
  }
  const minutes = parseHm(hm) ?? 0;
  return { day, hm, minutes };
}

export function getPickShiftSettings(): PickShiftSettings {
  const row = get<{ value: string }>('SELECT value FROM meta WHERE key = ?', [META_KEY]);
  let base: PickShiftSettings = { ...DEFAULT_SETTINGS };
  if (row?.value) {
    try {
      const j = JSON.parse(row.value) as Partial<PickShiftSettings>;
      const morning_from =
        parseHm(String(j.morning_from || '')) != null
          ? String(j.morning_from)
          : DEFAULT_SETTINGS.morning_from;
      const morning_to =
        parseHm(String(j.morning_to || '')) != null
          ? String(j.morning_to)
          : DEFAULT_SETTINGS.morning_to;
      base = {
        tz: String(j.tz || DEFAULT_SETTINGS.tz).slice(0, 64) || DEFAULT_SETTINGS.tz,
        morning_from,
        morning_to,
        auto_morning: j.auto_morning !== undefined ? Boolean(j.auto_morning) : false,
        require_shift_for_ops:
          j.require_shift_for_ops !== undefined ? Boolean(j.require_shift_for_ops) : false,
        idle_reauth_minutes: Math.max(
          0,
          Math.min(24 * 60, Number(j.idle_reauth_minutes) || 0)
        ),
      };
    } catch {
      base = { ...DEFAULT_SETTINGS };
    }
  }
  if (PICK_SHIFTS_UI_DISABLED) {
    return {
      ...base,
      auto_morning: false,
      require_shift_for_ops: false,
      idle_reauth_minutes: 0,
    };
  }
  return base;
}

export function savePickShiftSettings(
  patch: Partial<PickShiftSettings>
): PickShiftSettings {
  const cur = getPickShiftSettings();
  const next: PickShiftSettings = {
    tz: patch.tz !== undefined ? String(patch.tz).trim().slice(0, 64) || cur.tz : cur.tz,
    morning_from:
      patch.morning_from !== undefined && parseHm(String(patch.morning_from)) != null
        ? String(patch.morning_from).trim()
        : cur.morning_from,
    morning_to:
      patch.morning_to !== undefined && parseHm(String(patch.morning_to)) != null
        ? String(patch.morning_to).trim()
        : cur.morning_to,
    auto_morning:
      patch.auto_morning !== undefined ? Boolean(patch.auto_morning) : cur.auto_morning,
    require_shift_for_ops:
      patch.require_shift_for_ops !== undefined
        ? Boolean(patch.require_shift_for_ops)
        : cur.require_shift_for_ops,
    idle_reauth_minutes:
      patch.idle_reauth_minutes !== undefined
        ? Math.max(0, Math.min(24 * 60, Number(patch.idle_reauth_minutes) || 0))
        : cur.idle_reauth_minutes,
  };
  run('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)', [
    META_KEY,
    JSON.stringify(next),
  ]);
  return next;
}

export function normalizePin(raw: string): string {
  return String(raw || '').replace(/\D/g, '');
}

export function validatePinFormat(pin: string): void {
  const p = normalizePin(pin);
  if (p.length < 1 || p.length > 6) {
    throw new Error('PIN — от 1 до 6 цифр');
  }
}

export function setStaffPin(staffId: string, pin: string): void {
  if (staffId === '__admin__') {
    throw new Error('Системному admin PIN не задаётся');
  }
  validatePinFormat(pin);
  run(
    `UPDATE staff SET pin_hash = ?, pin_set_at = datetime('now') WHERE id = ?`,
    [hashPassword(normalizePin(pin)), staffId]
  );
}

export function clearStaffPin(staffId: string): void {
  run(`UPDATE staff SET pin_hash = '', pin_set_at = '' WHERE id = ?`, [staffId]);
}

export function staffHasPin(staffId: string): boolean {
  if (staffId === '__admin__') return false;
  const row = get<{ pin_hash: string }>('SELECT pin_hash FROM staff WHERE id = ?', [staffId]);
  return Boolean(row?.pin_hash);
}

function staffPinHash(staffId: string): string {
  if (staffId === '__admin__') return '';
  return (
    get<{ pin_hash: string }>('SELECT pin_hash FROM staff WHERE id = ?', [staffId])?.pin_hash ||
    ''
  );
}

function staffPasswordHash(staffId: string): string {
  if (staffId === '__admin__') return '';
  return (
    get<{ password_hash: string }>('SELECT password_hash FROM staff WHERE id = ?', [
      staffId,
    ])?.password_hash || ''
  );
}

/**
 * Проверка личности при старте смены:
 * 1) PIN (если задан админом)
 * 2) иначе пароль сотрудника
 * Системный admin — без PIN (сессия достаточна).
 */
export function verifyShiftIdentity(
  actor: Actor,
  opts: { pin?: string; password?: string }
): void {
  if (actor.isSystemAdmin || actor.id === '__admin__') return;

  const pinHash = staffPinHash(actor.id);
  if (pinHash) {
    const pin = normalizePin(String(opts.pin || ''));
    if (!pin) throw new Error('Введите PIN смены');
    if (!verifyPassword(pin, pinHash)) throw new Error('Неверный PIN');
    return;
  }

  const passHash = staffPasswordHash(actor.id);
  if (!passHash) {
    throw new Error('Задайте PIN в «Персонал» или пароль для подтверждения смены');
  }
  const password = String(opts.password || '');
  if (!password) throw new Error('Введите пароль для подтверждения смены');
  if (!verifyPassword(password, passHash)) throw new Error('Неверный пароль');
}

function mapShift(row: Record<string, unknown>): PickShiftRow {
  return {
    id: String(row.id),
    staff_id: String(row.staff_id),
    staff_name: String(row.staff_name || ''),
    staff_login: String(row.staff_login || ''),
    kind: row.kind === 'evening' ? 'evening' : 'day',
    day: String(row.day || ''),
    started_at: String(row.started_at || ''),
    ended_at: String(row.ended_at || ''),
    pin_verified_at: String(row.pin_verified_at || ''),
    last_activity_at: String(row.last_activity_at || ''),
    auto_started: Number(row.auto_started) ? 1 : 0,
    created_at: String(row.created_at || ''),
  };
}

export function getOpenPickShift(staffId: string): PickShiftRow | null {
  const row = get<Record<string, unknown>>(
    `SELECT * FROM pick_shifts
     WHERE staff_id = ? AND ended_at = ''
     ORDER BY started_at DESC LIMIT 1`,
    [staffId]
  );
  return row ? mapShift(row) : null;
}

function hadDayShiftToday(staffId: string, day: string): boolean {
  const row = get<{ c: number }>(
    `SELECT COUNT(*) AS c FROM pick_shifts
     WHERE staff_id = ? AND day = ? AND kind = 'day'`,
    [staffId, day]
  );
  return (row?.c ?? 0) > 0;
}

export function isInMorningWindow(settings = getPickShiftSettings(), at = new Date()): boolean {
  const { minutes } = localParts(settings.tz, at);
  const from = parseHm(settings.morning_from) ?? 6 * 60;
  const to = parseHm(settings.morning_to) ?? 10 * 60;
  if (from <= to) return minutes >= from && minutes < to;
  // через полночь — не используем для утреннего окна
  return minutes >= from || minutes < to;
}

export type MorningAutoOffer = {
  offer: boolean;
  kind: PickShiftKind;
  reason: string;
};

export function morningAutoOffer(
  actor: Actor,
  settings = getPickShiftSettings()
): MorningAutoOffer {
  if (!settings.auto_morning) {
    return { offer: false, kind: 'day', reason: 'Автостарт выключен' };
  }
  if (actor.isSystemAdmin) {
    return { offer: false, kind: 'day', reason: 'Системный admin' };
  }
  const open = getOpenPickShift(actor.id);
  if (open) {
    return { offer: false, kind: open.kind, reason: 'Смена уже открыта' };
  }
  if (!isInMorningWindow(settings)) {
    return { offer: false, kind: 'day', reason: 'Вне утреннего окна' };
  }
  const { day } = localParts(settings.tz);
  if (hadDayShiftToday(actor.id, day)) {
    return { offer: false, kind: 'day', reason: 'Дневная смена сегодня уже была' };
  }
  return {
    offer: true,
    kind: 'day',
    reason: `Утреннее окно ${settings.morning_from}–${settings.morning_to}`,
  };
}

export function startPickShift(
  actor: Actor,
  opts: {
    kind?: string;
    pin?: string;
    password?: string;
    auto?: boolean;
  }
): PickShiftRow {
  const settings = getPickShiftSettings();
  const kind: PickShiftKind = opts.kind === 'evening' ? 'evening' : 'day';
  const open = getOpenPickShift(actor.id);
  if (open) {
    throw new Error('Смена уже открыта — сначала завершите текущую');
  }

  if (opts.auto) {
    if (kind !== 'day') throw new Error('Автостарт только для дневной смены');
    const offer = morningAutoOffer(actor, settings);
    if (!offer.offer) throw new Error(offer.reason || 'Автостарт недоступен');
  }

  verifyShiftIdentity(actor, { pin: opts.pin, password: opts.password });

  const { day } = localParts(settings.tz);
  const now = new Date().toISOString();
  const id = newGuid();
  run(
    `INSERT INTO pick_shifts (
      id, staff_id, staff_name, staff_login, kind, day,
      started_at, ended_at, pin_verified_at, last_activity_at, auto_started
    ) VALUES (?, ?, ?, ?, ?, ?, ?, '', ?, ?, ?)`,
    [
      id,
      actor.id,
      actor.name,
      actor.login,
      kind,
      day,
      now,
      now,
      now,
      opts.auto ? 1 : 0,
    ]
  );
  return getOpenPickShift(actor.id)!;
}

export function endPickShift(actor: Actor): PickShiftRow | null {
  const open = getOpenPickShift(actor.id);
  if (!open) return null;
  const now = new Date().toISOString();
  run(
    `UPDATE pick_shifts SET ended_at = ?, last_activity_at = ? WHERE id = ?`,
    [now, now, open.id]
  );
  return mapShift({ ...open, ended_at: now, last_activity_at: now });
}

export function touchPickShiftActivity(staffId: string): void {
  const open = getOpenPickShift(staffId);
  if (!open) return;
  run(`UPDATE pick_shifts SET last_activity_at = ? WHERE id = ?`, [
    new Date().toISOString(),
    open.id,
  ]);
}

export function needsIdleReauth(staffId: string, settings = getPickShiftSettings()): boolean {
  if (!settings.idle_reauth_minutes) return false;
  const open = getOpenPickShift(staffId);
  if (!open) return false;
  const last = Date.parse(open.last_activity_at || open.pin_verified_at || open.started_at);
  if (!Number.isFinite(last)) return false;
  return Date.now() - last > settings.idle_reauth_minutes * 60_000;
}

export function reauthPickShift(
  actor: Actor,
  opts: { pin?: string; password?: string }
): PickShiftRow {
  const open = getOpenPickShift(actor.id);
  if (!open) throw new Error('Нет открытой смены');
  verifyShiftIdentity(actor, opts);
  const now = new Date().toISOString();
  run(
    `UPDATE pick_shifts SET pin_verified_at = ?, last_activity_at = ? WHERE id = ?`,
    [now, now, open.id]
  );
  return getOpenPickShift(actor.id)!;
}

export function assertPickShiftForOps(actor: Actor | null): void {
  if (!actor) return;
  if (actor.isSystemAdmin || actor.role === 'admin' || actor.role === 'manager') return;
  const settings = getPickShiftSettings();
  if (!settings.require_shift_for_ops) return;
  if (!['warehouse', 'courier'].includes(actor.role)) return;
  const open = getOpenPickShift(actor.id);
  if (!open) {
    throw new Error('Начните смену (и подтвердите PIN), чтобы работать с очередью');
  }
  if (needsIdleReauth(actor.id, settings)) {
    throw new Error('Смена простаивала — подтвердите PIN ещё раз');
  }
}

export function pickShiftStatusPayload(actor: Actor) {
  const settings = getPickShiftSettings();
  const shift = getOpenPickShift(actor.id);
  const has_pin = staffHasPin(actor.id);
  const morning = morningAutoOffer(actor, settings);
  const { day, hm } = localParts(settings.tz);
  return {
    shifts_disabled: PICK_SHIFTS_UI_DISABLED,
    shift,
    staff: {
      id: actor.id,
      name: actor.name,
      login: actor.login,
      role: actor.role,
      has_pin,
      identity: has_pin ? 'pin' : actor.isSystemAdmin ? 'session' : 'password',
    },
    settings: {
      tz: settings.tz,
      morning_from: settings.morning_from,
      morning_to: settings.morning_to,
      auto_morning: settings.auto_morning,
      require_shift_for_ops: settings.require_shift_for_ops,
      idle_reauth_minutes: settings.idle_reauth_minutes,
    },
    local: { day, time: hm },
    morning_auto: morning,
    needs_reauth: shift ? needsIdleReauth(actor.id, settings) : false,
  };
}

export function listPickShifts(opts?: { day?: string; staff_id?: string; limit?: number }) {
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
  const sql = `SELECT * FROM pick_shifts
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY started_at DESC LIMIT ?`;
  params.push(limit);
  return all<Record<string, unknown>>(sql, params).map(mapShift);
}
