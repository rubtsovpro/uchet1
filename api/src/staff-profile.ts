/**
 * Профиль сотрудника: телефон, аватар, смена своего PIN.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { get, run } from './db.js';
import { hashPassword, verifyPassword } from './auth.js';
import { normalizePhoneForStorage } from './phone.js';
import { clearStaffPin, setStaffPin, staffHasPin, validatePinFormat } from './pick-shifts.js';
import { s3ConfigFromEnv, s3PutObject } from './s3.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const META_ADMIN = 'system_admin_profile';
const MAX_AVATAR_BYTES = 2.5 * 1024 * 1024;

function dataDir(): string {
  return process.env.WMS_DATA_DIR || path.resolve(__dirname, '..', '..', 'data');
}

function avatarsDir(): string {
  const dir = path.join(dataDir(), 'staff-avatars');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

async function metaGet(key: string): Promise<string> {
  return String((await get<{ v: string }>('SELECT value AS v FROM meta WHERE key = ?', [key]))?.v || '');
}

async function metaSet(key: string, value: string): Promise<void> {
  await run(
    `INSERT INTO meta (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    [key, value]
  );
}

type AdminProfile = { phone?: string; avatar_url?: string; avatar_path?: string };

async function readAdminProfile(): Promise<AdminProfile> {
  try {
    return JSON.parse(await metaGet(META_ADMIN) || '{}') as AdminProfile;
  } catch {
    return {};
  }
}

async function writeAdminProfile(p: AdminProfile): Promise<void> {
  await metaSet(META_ADMIN, JSON.stringify(p));
}

export type MeProfile = {
  phone: string;
  avatar_url: string;
  has_password: boolean;
  has_pin: boolean;
  can_change_password: boolean;
  can_set_pin: boolean;
};

export async function meProfileExtras(actorId: string): Promise<MeProfile> {
  if (actorId === '__admin__') {
    const p = await readAdminProfile();
    return {
      phone: String(p.phone || ''),
      avatar_url: String(p.avatar_url || ''),
      has_password: true,
      has_pin: false,
      can_change_password: false,
      can_set_pin: false,
    };
  }
  const row = await get<{
    phone: string;
    avatar_url: string;
    password_hash: string;
    pin_hash: string;
  }>(
    `SELECT IFNULL(phone,'') AS phone, IFNULL(avatar_url,'') AS avatar_url,
            IFNULL(password_hash,'') AS password_hash, IFNULL(pin_hash,'') AS pin_hash
     FROM staff WHERE id = ?`,
    [actorId]
  );
  return {
    phone: String(row?.phone || ''),
    avatar_url: String(row?.avatar_url || ''),
    has_password: Boolean(row?.password_hash),
    has_pin: Boolean(row?.pin_hash),
    can_change_password: true,
    can_set_pin: true,
  };
}

export async function updateOwnPhone(actorId: string, phoneRaw: string): Promise<string> {
  const phone = await normalizePhoneForStorage(phoneRaw);
  if (actorId === '__admin__') {
    const p = await readAdminProfile();
    p.phone = phone;
    await writeAdminProfile(p);
    return phone;
  }
  const row = await get('SELECT id FROM staff WHERE id = ?', [actorId]);
  if (!row) throw new Error('Сотрудник не найден');
  await run(`UPDATE staff SET phone = ? WHERE id = ?`, [phone, actorId]);
  return phone;
}

function sniffImage(buf: Buffer): { mime: string; ext: string } | null {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return { mime: 'image/jpeg', ext: 'jpg' };
  }
  if (
    buf.length >= 8 &&
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47
  ) {
    return { mime: 'image/png', ext: 'png' };
  }
  if (
    buf.length >= 12 &&
    buf.toString('ascii', 0, 4) === 'RIFF' &&
    buf.toString('ascii', 8, 12) === 'WEBP'
  ) {
    return { mime: 'image/webp', ext: 'webp' };
  }
  return null;
}

export async function saveOwnAvatar(
  actorId: string,
  buf: Buffer
): Promise<{ avatar_url: string }> {
  if (!buf.length) throw new Error('Пустой файл');
  if (buf.length > MAX_AVATAR_BYTES) throw new Error('Аватар больше 2.5 МБ');
  const kind = sniffImage(buf);
  if (!kind) throw new Error('Нужен JPEG, PNG или WebP');

  const sha = createHash('sha256').update(buf).digest('hex').slice(0, 12);
  let url = '';
  let localPath = '';

  const cfg = s3ConfigFromEnv();
  if (cfg) {
    const key = `wms/staff-avatars/${actorId}_${sha}.${kind.ext}`;
    url = await s3PutObject(cfg, key, buf, kind.mime, true);
  } else {
    const file = `${actorId}.${kind.ext}`;
    localPath = path.join(avatarsDir(), file);
    // убрать старые расширения
    for (const ext of ['jpg', 'jpeg', 'png', 'webp']) {
      const prev = path.join(avatarsDir(), `${actorId}.${ext}`);
      if (prev !== localPath && fs.existsSync(prev)) fs.unlinkSync(prev);
    }
    fs.writeFileSync(localPath, buf);
    url = `/api/staff/${encodeURIComponent(actorId)}/avatar?v=${sha}`;
  }

  if (actorId === '__admin__') {
    const p = await readAdminProfile();
    p.avatar_url = url;
    p.avatar_path = localPath || p.avatar_path;
    await writeAdminProfile(p);
    return { avatar_url: url };
  }

  await run(`UPDATE staff SET avatar_url = ? WHERE id = ?`, [url, actorId]);
  if (localPath) {
    // путь не светим наружу — достаточен avatar_url
  }
  return { avatar_url: url };
}

export async function clearOwnAvatar(actorId: string): Promise<void> {
  if (actorId === '__admin__') {
    const p = await readAdminProfile();
    if (p.avatar_path && fs.existsSync(p.avatar_path)) {
      try {
        fs.unlinkSync(p.avatar_path);
      } catch {
        /* ignore */
      }
    }
    p.avatar_url = '';
    p.avatar_path = '';
    await writeAdminProfile(p);
    return;
  }
  for (const ext of ['jpg', 'jpeg', 'png', 'webp']) {
    const prev = path.join(avatarsDir(), `${actorId}.${ext}`);
    if (fs.existsSync(prev)) {
      try {
        fs.unlinkSync(prev);
      } catch {
        /* ignore */
      }
    }
  }
  await run(`UPDATE staff SET avatar_url = '' WHERE id = ?`, [actorId]);
}

/** Локальный файл аватара (если не S3). */
export async function resolveLocalAvatarPath(actorId: string): Promise<{ path: string; mime: string } | null> {
  if (actorId === '__admin__') {
    const p = await readAdminProfile();
    if (p.avatar_path && fs.existsSync(p.avatar_path)) {
      const ext = path.extname(p.avatar_path).toLowerCase();
      const mime =
        ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';
      return { path: p.avatar_path, mime };
    }
  }
  for (const [ext, mime] of [
    ['jpg', 'image/jpeg'],
    ['jpeg', 'image/jpeg'],
    ['png', 'image/png'],
    ['webp', 'image/webp'],
  ] as const) {
    const p = path.join(avatarsDir(), `${actorId}.${ext}`);
    if (fs.existsSync(p)) return { path: p, mime };
  }
  return null;
}

export async function publicAvatarUrl(actorId: string): Promise<string> {
  if (actorId === '__admin__') return String((await readAdminProfile()).avatar_url || '');
  return String(
    (await get<{ u: string }>('SELECT IFNULL(avatar_url,\'\') AS u FROM staff WHERE id = ?', [actorId]))
      ?.u || ''
  );
}

async function staffPasswordHash(actorId: string): Promise<string> {
  return (
    (await get<{ password_hash: string }>('SELECT password_hash FROM staff WHERE id = ?', [actorId]))
      ?.password_hash || ''
  );
}

async function staffPinHash(actorId: string): Promise<string> {
  return (
    (await get<{ pin_hash: string }>('SELECT pin_hash FROM staff WHERE id = ?', [actorId]))?.pin_hash ||
    ''
  );
}

/** Смена / установка своего PIN. Нужен текущий пароль или текущий PIN. */
export async function changeOwnPin(
  actorId: string,
  opts: { pin?: string | null; current_password?: string; current_pin?: string }
): Promise<void> {
  if (actorId === '__admin__') {
    throw new Error('Системному admin PIN не задаётся');
  }
  const passHash = await staffPasswordHash(actorId);
  const pinHash = await staffPinHash(actorId);
  const curPass = String(opts.current_password || '');
  const curPin = String(opts.current_pin || '').replace(/\D/g, '');
  let ok = false;
  if (curPass && passHash && verifyPassword(curPass, passHash)) ok = true;
  if (curPin && pinHash && verifyPassword(curPin, pinHash)) ok = true;
  if (!ok) {
    if (pinHash) throw new Error('Укажите текущий PIN или пароль');
    throw new Error('Укажите текущий пароль');
  }
  if (opts.pin === null || String(opts.pin || '').trim() === '') {
    await clearStaffPin(actorId);
    return;
  }
  validatePinFormat(String(opts.pin));
  await setStaffPin(actorId, String(opts.pin));
}

export { staffHasPin, hashPassword };