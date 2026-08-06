/**
 * Сессии сотрудников + пароли (scrypt). Системный admin из env — запасной вход.
 */
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import type { Context } from 'hono';
import { getCookie } from 'hono/cookie';
import { all, get, run } from './db.js';
import { newGuid } from './ids.js';
import {
  canAccessSection,
  effectiveRightsForStaff,
  parseRights,
  rightsForRole,
  type StaffRights,
} from './staff.js';

export { canAccessSection };

export const COOKIE_SID = 'wms_sid';
const SESSION_DAYS = 14;

export type Actor = {
  id: string;
  name: string;
  email: string;
  login: string;
  role: string;
  rights: StaffRights;
  isSystemAdmin: boolean;
};

const ENV_USER = () => (process.env.WMS_USER || 'admin').trim();
const ENV_PASS = () => process.env.WMS_PASS || 'password';

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 64);
  return `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  if (!stored) return false;
  const parts = stored.split('$');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
  try {
    const salt = Buffer.from(parts[1]!, 'base64');
    const expected = Buffer.from(parts[2]!, 'base64');
    const actual = scryptSync(password, salt, expected.length);
    return timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

function systemActor(): Actor {
  return {
    id: '__admin__',
    name: 'Админ (системный)',
    email: '',
    login: ENV_USER(),
    role: 'admin',
    rights: rightsForRole('admin'),
    isSystemAdmin: true,
  };
}

/** Админ / системный — всё; иначе флаг из rights. */
export function canDo(
  actor: Actor | null,
  right: 'can_sync' | 'can_edit_products' | 'can_edit_prices' | 'can_edit_docs'
): boolean {
  if (!actor) return true; // legacy cookie
  if (actor.isSystemAdmin || actor.role === 'admin') return true;
  return Boolean(actor.rights?.[right]);
}

function staffToActor(row: Record<string, unknown>): Actor {
  return {
    id: String(row.id),
    name: String(row.name || ''),
    email: String(row.email || ''),
    login: String(row.login || row.email || ''),
    role: String(row.role || 'none'),
    rights: effectiveRightsForStaff(row),
    isSystemAdmin: false,
  };
}

export function createSession(
  actorId: string,
  meta?: { ip?: string; ua?: string }
): string {
  const id = newGuid();
  const expires = new Date(Date.now() + SESSION_DAYS * 86400_000).toISOString();
  run(
    `INSERT INTO sessions (id, actor_id, expires_at, ip, user_agent)
     VALUES (?, ?, ?, ?, ?)`,
    [id, actorId, expires, meta?.ip || '', (meta?.ua || '').slice(0, 300)]
  );
  return id;
}

export function destroySession(sid: string | undefined): void {
  if (!sid) return;
  run('DELETE FROM sessions WHERE id = ?', [sid]);
}

export function actorFromSession(sid: string | undefined): Actor | null {
  if (!sid) return null;
  const sess = get<{ actor_id: string; expires_at: string }>(
    'SELECT actor_id, expires_at FROM sessions WHERE id = ?',
    [sid]
  );
  if (!sess) return null;
  if (new Date(sess.expires_at).getTime() < Date.now()) {
    run('DELETE FROM sessions WHERE id = ?', [sid]);
    return null;
  }
  if (sess.actor_id === '__admin__') return systemActor();
  const row = get<Record<string, unknown>>(
    `SELECT * FROM staff WHERE id = ? AND can_login = 1 AND is_active = 1`,
    [sess.actor_id]
  );
  if (!row) return null;
  if (!String(row.password_hash || '')) return null;
  return staffToActor(row);
}

export function actorFromContext(c: Context): Actor | null {
  return actorFromSession(getCookie(c, COOKIE_SID));
}

export function requireActor(c: Context): Actor {
  const a = actorFromContext(c);
  if (!a) throw new Error('unauthorized');
  return a;
}

export type AuthPasswordResult =
  | { ok: true; actor: Actor }
  | { ok: false; error: string };

export type LoginResult =
  | { ok: true; actor: Actor; sid: string }
  | { ok: false; error: string };

/** Проверка логина/пароля без создания сессии (для 2FA). */
export function authenticatePassword(username: string, password: string): AuthPasswordResult {
  const u = username.trim();
  const p = password;
  if (!u || !p) return { ok: false, error: 'Укажите логин и пароль' };

  if (u === ENV_USER() && p === ENV_PASS()) {
    return { ok: true, actor: systemActor() };
  }

  const row = get<Record<string, unknown>>(
    `SELECT * FROM staff
     WHERE (lower(login) = lower(?) OR lower(email) = lower(?) OR lower(auth_login) = lower(?))
       AND can_login = 1 AND is_active = 1
     LIMIT 1`,
    [u, u, u]
  );
  if (!row) return { ok: false, error: 'Неверный логин или пароль' };
  const hash = String(row.password_hash || '');
  if (!hash) {
    return { ok: false, error: 'Пароль не задан — зарегистрируйтесь или попросите админа' };
  }
  if (!verifyPassword(p, hash)) {
    return { ok: false, error: 'Неверный логин или пароль' };
  }
  return { ok: true, actor: staffToActor(row) };
}

export function loginWithPassword(
  username: string,
  password: string,
  meta?: { ip?: string; ua?: string }
): LoginResult {
  const auth = authenticatePassword(username, password);
  if (!auth.ok) return auth;
  const sid = createSession(auth.actor.id, meta);
  return { ok: true, actor: auth.actor, sid };
}

/** Быстрый вход по логину + PIN смены (для планшетов на ролевых экранах). */
export function authenticatePin(username: string, pin: string): AuthPasswordResult {
  const u = username.trim();
  const p = String(pin || '').replace(/\D/g, '');
  if (!u || !p) return { ok: false, error: 'Укажите логин и PIN' };
  if (p.length < 4 || p.length > 6) return { ok: false, error: 'PIN — от 4 до 6 цифр' };

  const row = get<Record<string, unknown>>(
    `SELECT * FROM staff
     WHERE (lower(login) = lower(?) OR lower(email) = lower(?) OR lower(auth_login) = lower(?))
       AND can_login = 1 AND is_active = 1
     LIMIT 1`,
    [u, u, u]
  );
  if (!row) return { ok: false, error: 'Неверный логин или PIN' };
  const pinHash = String(row.pin_hash || '');
  if (!pinHash) {
    return { ok: false, error: 'PIN не задан — войдите паролем или попросите админа задать PIN' };
  }
  if (!verifyPassword(p, pinHash)) {
    return { ok: false, error: 'Неверный логин или PIN' };
  }
  return { ok: true, actor: staffToActor(row) };
}

export function loginWithPin(
  username: string,
  pin: string,
  meta?: { ip?: string; ua?: string }
): LoginResult {
  const auth = authenticatePin(username, pin);
  if (!auth.ok) return auth;
  const sid = createSession(auth.actor.id, meta);
  return { ok: true, actor: auth.actor, sid };
}

export function staffHasPinPublic(actorId: string): boolean {
  if (!actorId || actorId === '__admin__') return false;
  const row = get<{ pin_hash: string }>('SELECT pin_hash FROM staff WHERE id = ?', [actorId]);
  return Boolean(row?.pin_hash);
}

export function setStaffPassword(staffId: string, password: string): void {
  if (password.length < 6) throw new Error('Пароль не короче 6 символов');
  run(
    `UPDATE staff SET password_hash = ?, password_set_at = datetime('now') WHERE id = ?`,
    [hashPassword(password), staffId]
  );
}

export function changeOwnPassword(actorId: string, oldPass: string, newPass: string): void {
  if (actorId === '__admin__') {
    throw new Error('Системный admin меняет пароль через WMS_PASS на сервере');
  }
  const row = get<{ password_hash: string }>('SELECT password_hash FROM staff WHERE id = ?', [actorId]);
  if (!row) throw new Error('Не найден');
  if (!verifyPassword(oldPass, String(row.password_hash || ''))) {
    throw new Error('Неверный текущий пароль');
  }
  setStaffPassword(actorId, newPass);
}

export function publicStaffRow(row: Record<string, unknown>): Record<string, unknown> {
  const { password_hash: _, pin_hash: __, ...rest } = row;
  const role = String(row.role || 'none');
  const rights = parseRights(String(row.rights_json || ''), role);
  const isAdmin = role === 'admin';
  return {
    ...rest,
    has_password: Boolean(row.password_hash),
    has_pin: Boolean(row.pin_hash),
    company_ids: isAdmin ? [] : rights.company_ids || [],
    company_access_all: isAdmin || !(rights.company_ids && rights.company_ids.length),
  };
}

export function listStaffPublic(sql: string, params: Array<string | number> = []) {
  return all<Record<string, unknown>>(sql, params).map(publicStaffRow);
}

export function cleanupExpiredSessions(): void {
  run(`DELETE FROM sessions WHERE datetime(expires_at) < datetime('now')`);
}
