/**
 * Admin 2FA через Telegram (код в личку бота).
 * Max/SMS не используем — в стеке клиента уже живой Telegram + worker gateway.
 */
import { createHash, randomInt, timingSafeEqual } from 'node:crypto';
import type { Actor } from './auth.js';
import { createSession } from './auth.js';
import { get, run } from './db.js';
import { newGuid } from './ids.js';
import {
  admin2faMode,
  telegram2faConfigStatus,
  telegramDefault2faChatId,
  telegramSendMessage,
} from './telegram.js';

const CODE_TTL_MS = 5 * 60_000;
const MAX_ATTEMPTS = 5;

function hashCode(challengeId: string, code: string): string {
  return createHash('sha256')
    .update(`${challengeId}:${code}:${process.env.WMS_PASS || 'wms'}`)
    .digest('hex');
}

function safeEqualHex(a: string, b: string): boolean {
  try {
    const ba = Buffer.from(a, 'hex');
    const bb = Buffer.from(b, 'hex');
    if (ba.length !== bb.length) return false;
    return timingSafeEqual(ba, bb);
  } catch {
    return false;
  }
}

export function isAdminFor2fa(actor: Actor): boolean {
  return actor.isSystemAdmin || actor.role === 'admin';
}

export function resolve2faChatId(actor: Actor): string | null {
  if (actor.id !== '__admin__') {
    const row = get<{ telegram_chat_id?: string }>(
      'SELECT telegram_chat_id FROM staff WHERE id = ?',
      [actor.id]
    );
    const personal = String(row?.telegram_chat_id || '').trim();
    if (personal) return personal;
  }
  const def = telegramDefault2faChatId();
  return def || null;
}

/** Нужен ли 2FA шаг для этого актора при текущем конфиге. */
export function admin2faRequired(actor: Actor): boolean {
  if (!isAdminFor2fa(actor)) return false;
  const mode = admin2faMode();
  if (mode === 'off') return false;
  const st = telegram2faConfigStatus();
  if (mode === 'on') return true;
  // auto
  return st.ready && Boolean(resolve2faChatId(actor));
}

export type ChallengeStartResult =
  | {
      ok: true;
      challenge_id: string;
      channel: 'telegram';
      expires_in_sec: number;
      hint: string;
    }
  | { ok: false; error: string; ask?: string };

export async function startAdmin2faChallenge(
  actor: Actor,
  meta?: { ip?: string; ua?: string }
): Promise<ChallengeStartResult> {
  const st = telegram2faConfigStatus();
  if (admin2faMode() === 'on' && !st.token_set) {
    return {
      ok: false,
      error: '2FA обязателен, но Telegram-бот не настроен',
      ask: st.ask,
    };
  }
  const chatId = resolve2faChatId(actor);
  if (!st.token_set || !chatId) {
    return {
      ok: false,
      error: 'Telegram 2FA не настроен (нет токена или chat_id)',
      ask: st.ask,
    };
  }

  const challengeId = newGuid();
  const code = String(randomInt(100_000, 1_000_000));
  const expires = new Date(Date.now() + CODE_TTL_MS).toISOString();
  run(
    `INSERT INTO auth_2fa_challenges (id, actor_id, code_hash, expires_at, ip, user_agent)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      challengeId,
      actor.id,
      hashCode(challengeId, code),
      expires,
      meta?.ip || '',
      (meta?.ua || '').slice(0, 300),
    ]
  );

  const send = await telegramSendMessage(
    chatId,
    `<b>Учёт №1 — код входа</b>\n<code>${code}</code>\n\nДействует 5 мин. Если это не вы — смените пароль.`,
    { parse_mode: 'HTML' }
  );
  if (!send.ok) {
    run('DELETE FROM auth_2fa_challenges WHERE id = ?', [challengeId]);
    return {
      ok: false,
      error: `Не удалось отправить код в Telegram: ${send.error}`,
      ask:
        'Проверьте TELEGRAM_BOT_TOKEN / TELEGRAM_WORKER_* и что админ написал боту /start. Chat id: ' +
        chatId,
    };
  }

  return {
    ok: true,
    challenge_id: challengeId,
    channel: 'telegram',
    expires_in_sec: Math.floor(CODE_TTL_MS / 1000),
    hint: 'Код отправлен в Telegram',
  };
}

export type ChallengeVerifyResult =
  | { ok: true; actor_id: string; sid: string }
  | { ok: false; error: string };

export function verifyAdmin2faChallenge(
  challengeId: string,
  code: string,
  meta?: { ip?: string; ua?: string }
): ChallengeVerifyResult {
  const id = String(challengeId || '').trim();
  const raw = String(code || '').replace(/\s+/g, '');
  if (!id || !/^\d{6}$/.test(raw)) {
    return { ok: false, error: 'Укажите 6-значный код из Telegram' };
  }

  const row = get<{
    actor_id: string;
    code_hash: string;
    expires_at: string;
    attempts: number;
  }>('SELECT actor_id, code_hash, expires_at, attempts FROM auth_2fa_challenges WHERE id = ?', [
    id,
  ]);
  if (!row) return { ok: false, error: 'Код устарел — войдите снова' };
  if (Number(row.attempts) >= MAX_ATTEMPTS) {
    run('DELETE FROM auth_2fa_challenges WHERE id = ?', [id]);
    return { ok: false, error: 'Слишком много попыток — войдите снова' };
  }
  if (new Date(row.expires_at).getTime() < Date.now()) {
    run('DELETE FROM auth_2fa_challenges WHERE id = ?', [id]);
    return { ok: false, error: 'Код истёк — войдите снова' };
  }

  const expected = String(row.code_hash);
  const actual = hashCode(id, raw);
  if (!safeEqualHex(expected, actual)) {
    run('UPDATE auth_2fa_challenges SET attempts = attempts + 1 WHERE id = ?', [id]);
    return { ok: false, error: 'Неверный код' };
  }

  run('DELETE FROM auth_2fa_challenges WHERE id = ?', [id]);
  // подчистить просроченные
  run(`DELETE FROM auth_2fa_challenges WHERE datetime(expires_at) < datetime('now')`);

  const sid = createSession(row.actor_id, meta);
  return { ok: true, actor_id: row.actor_id, sid };
}

export function actorSnapshotForChallenge(actor: Actor): {
  id: string;
  name: string;
  login: string;
  role: string;
} {
  return {
    id: actor.id,
    name: actor.name,
    login: actor.login,
    role: actor.role,
  };
}
