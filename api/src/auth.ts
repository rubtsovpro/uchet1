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
import {
  extractMachineApiKey,
  scopesAllow,
  verifyAnyMachineApiKey,
  type ApiKeyScope,
} from './api-keys.js';

export { canAccessSection };

export const COOKIE_SID = 'wms_sid';
const SESSION_DAYS = 14;

export type Actor = {
  id: string;
  name: string;
  email: string;
  login: string;
  role: string;
  department: string;
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
    name: (process.env.WMS_ADMIN_NAME || 'Рубцов Сергей').trim() || 'Рубцов Сергей',
    email: '',
    login: ENV_USER(),
    role: 'admin',
    department: '',
    rights: rightsForRole('admin'),
    isSystemAdmin: true,
  };
}

/** Админ / системный — всё; иначе флаг из rights. */
export function canDo(
  actor: Actor | null,
  right:
    | 'can_sync'
    | 'can_edit_products'
    | 'can_edit_prices'
    | 'can_edit_docs'
    | 'can_tax'
    | 'can_payroll'
): boolean {
  if (!actor) return true; // legacy cookie
  if (actor.isSystemAdmin || actor.role === 'admin') return true;
  return Boolean(actor.rights?.[right]);
}

async function staffToActor(row: Record<string, unknown>): Promise<Actor> {
  return {
    id: String(row.id),
    name: String(row.name || ''),
    email: String(row.email || ''),
    login: String(row.login || row.email || ''),
    role: String(row.role || 'none'),
    department: String(row.department || ''),
    rights: await effectiveRightsForStaff(row),
    isSystemAdmin: false,
  };
}

export async function createSession(
  actorId: string,
  meta?: { ip?: string; ua?: string }
): Promise<string> {
  const id = newGuid();
  const expires = new Date(Date.now() + SESSION_DAYS * 86400_000).toISOString();
  await run(
    `INSERT INTO sessions (id, actor_id, expires_at, ip, user_agent)
     VALUES (?, ?, ?, ?, ?)`,
    [id, actorId, expires, meta?.ip || '', (meta?.ua || '').slice(0, 300)]
  );
  return id;
}

export async function destroySession(sid: string | undefined): Promise<void> {
  if (!sid) return;
  await run('DELETE FROM sessions WHERE id = ?', [sid]);
}

/** Сбросить все сессии сотрудника (кик из системы). */
export async function destroySessionsForActor(actorId: string): Promise<number> {
  const id = String(actorId || '').trim();
  if (!id) return 0;
  const n =
    (await get<{ c: number }>('SELECT COUNT(*) AS c FROM sessions WHERE actor_id = ?', [id]))?.c ?? 0;
  await run('DELETE FROM sessions WHERE actor_id = ?', [id]);
  return Number(n) || 0;
}

export async function actorFromSession(sid: string | undefined): Promise<Actor | null> {
  if (!sid) return null;
  const sess = await get<{ actor_id: string; expires_at: string }>(
    'SELECT actor_id, expires_at FROM sessions WHERE id = ?',
    [sid]
  );
  if (!sess) return null;
  if (new Date(sess.expires_at).getTime() < Date.now()) {
    await run('DELETE FROM sessions WHERE id = ?', [sid]);
    return null;
  }
  if (sess.actor_id === '__admin__') return systemActor();
  const row = await get<Record<string, unknown>>(
    `SELECT * FROM staff WHERE id = ? AND can_login = 1 AND is_active = 1`,
    [sess.actor_id]
  );
  if (!row) return null;
  if (!String(row.password_hash || '')) return null;
  return await staffToActor(row);
}

async function actorFromMachineKey(c: Context): Promise<Actor | null> {
  const raw = extractMachineApiKey(c);
  if (!raw) return null;
  const v = await verifyAnyMachineApiKey(raw);
  if (!v) return null;
  const scopes = v.scopes as ApiKeyScope[];
  const has = (s: ApiKeyScope) => scopesAllow(scopes, s);
  const full = has('all');
  const sections: string[] = [];
  if (has('nomen') || has('public') || full) sections.push('home');
  if (
    has('balances') ||
    has('warehouses') ||
    has('storage') ||
    has('stock') ||
    full
  ) {
    sections.push('warehouse');
  }
  if (has('ingest') || has('webhook') || full) sections.push('crm');

  const staffId = String((v as { staff_id?: string }).staff_id || '').trim();
  if (staffId && v.source === 'db') {
    const row = await get<Record<string, unknown>>(
      `SELECT * FROM staff WHERE id = ? AND can_login = 1 AND is_active = 1`,
      [staffId]
    );
    if (row) {
      const base = await staffToActor(row);
      return {
        ...base,
        rights: {
          ...base.rights,
          sections: [...new Set([...(base.rights.sections || []), ...sections])],
          can_edit_products: base.rights.can_edit_products || has('nomen') || full,
          can_edit_prices: base.rights.can_edit_prices || has('nomen') || full,
          can_edit_docs:
            base.rights.can_edit_docs ||
            has('warehouses') ||
            has('balances') ||
            has('storage') ||
            has('stock') ||
            full,
        },
      };
    }
  }

  return {
    id: v.source === 'db' ? `apikey:${v.id}` : `apikey:${v.name}`,
    name: `API · ${v.name}`,
    email: '',
    login: `api:${v.name}`,
    role: full ? 'admin' : 'integration',
    department: '',
    rights: {
      sections,
      can_sync: false,
      can_edit_products: has('nomen') || full,
      can_edit_prices: has('nomen') || full,
      can_edit_docs:
        has('warehouses') || has('balances') || has('storage') || has('stock') || full,
      can_tax: false,
      can_payroll: false,
      company_ids: [],
    },
    isSystemAdmin: false,
  };
}

export async function actorFromContext(c: Context): Promise<Actor | null> {
  return await actorFromSession(getCookie(c, COOKIE_SID)) || await actorFromMachineKey(c);
}

export async function requireActor(c: Context): Promise<Actor> {
  const a = await actorFromContext(c);
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
export async function authenticatePassword(username: string, password: string): Promise<AuthPasswordResult> {
  const u = username.trim();
  const p = password;
  if (!u || !p) return { ok: false, error: 'Укажите логин и пароль' };

  // Сначала сотрудник из Персонала (чтобы PIN/пароль Рубцова работали), потом системный ENV.
  const row = await get<Record<string, unknown>>(
    `SELECT * FROM staff
     WHERE (lower(login) = lower(?) OR lower(email) = lower(?) OR lower(auth_login) = lower(?))
       AND can_login = 1 AND is_active = 1
     LIMIT 1`,
    [u, u, u]
  );
  if (row) {
    const hash = String(row.password_hash || '');
    if (!hash) {
      return { ok: false, error: 'Пароль не задан — зарегистрируйтесь или попросите админа' };
    }
    if (!verifyPassword(p, hash)) {
      return { ok: false, error: 'Неверный логин или пароль' };
    }
    return { ok: true, actor: await staffToActor(row) };
  }

  if (u === ENV_USER() && p === ENV_PASS()) {
    return { ok: true, actor: systemActor() };
  }

  return { ok: false, error: 'Неверный логин или пароль' };
}

export async function loginWithPassword(
  username: string,
  password: string,
  meta?: { ip?: string; ua?: string }
): Promise<LoginResult> {
  const auth = await authenticatePassword(username, password);
  if (!auth.ok) return auth;
  const sid = await createSession(auth.actor.id, meta);
  return { ok: true, actor: auth.actor, sid };
}

/** Быстрый вход по логину + PIN смены (для планшетов на ролевых экранах). */
export async function authenticatePin(username: string, pin: string): Promise<AuthPasswordResult> {
  const u = username.trim();
  const p = String(pin || '').replace(/\D/g, '');
  if (!u || !p) return { ok: false, error: 'Укажите логин и PIN' };
  if (p.length < 1 || p.length > 6) return { ok: false, error: 'PIN — от 1 до 6 цифр' };

  const row = await get<Record<string, unknown>>(
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
  return { ok: true, actor: await staffToActor(row) };
}

export async function loginWithPin(
  username: string,
  pin: string,
  meta?: { ip?: string; ua?: string }
): Promise<LoginResult> {
  const auth = await authenticatePin(username, pin);
  if (!auth.ok) return auth;
  const sid = await createSession(auth.actor.id, meta);
  return { ok: true, actor: auth.actor, sid };
}

export async function staffHasPinPublic(actorId: string): Promise<boolean> {
  if (!actorId || actorId === '__admin__') return false;
  const row = await get<{ pin_hash: string }>('SELECT pin_hash FROM staff WHERE id = ?', [actorId]);
  return Boolean(row?.pin_hash);
}

export async function setStaffPassword(staffId: string, password: string): Promise<void> {
  if (!String(password || '').length) throw new Error('Укажите пароль');
  await run(
    `UPDATE staff SET password_hash = ?, password_set_at = datetime('now') WHERE id = ?`,
    [hashPassword(password), staffId]
  );
}

export async function changeOwnPassword(actorId: string, oldPass: string, newPass: string): Promise<void> {
  if (actorId === '__admin__') {
    throw new Error('Системный admin меняет пароль через WMS_PASS на сервере');
  }
  const row = await get<{ password_hash: string }>('SELECT password_hash FROM staff WHERE id = ?', [actorId]);
  if (!row) throw new Error('Не найден');
  if (!verifyPassword(oldPass, String(row.password_hash || ''))) {
    throw new Error('Неверный текущий пароль');
  }
  await setStaffPassword(actorId, newPass);
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

export async function listStaffPublic(sql: string, params: Array<string | number> = []) {
  return (await all<Record<string, unknown>>(sql, params)).map(publicStaffRow);
}

export async function cleanupExpiredSessions(): Promise<void> {
  await run(`DELETE FROM sessions WHERE datetime(expires_at) < datetime('now')`);
}
