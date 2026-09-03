/**
 * Telegram Bot API для WMS (2FA / алерты).
 * Для РФ предпочитаем Cloudflare worker-gateway (как bank) — прямой api.telegram.org
 * с VPS часто недоступен.
 */
export type TelegramSendResult =
  | { ok: true }
  | { ok: false; error: string };

function env(name: string): string {
  return (process.env[name] || '').trim();
}

/** Токен бота Учёта (@RubtsovHelpBot). Env: TELEGRAM_BOT_TOKEN / WMS_TELEGRAM_BOT_TOKEN */
export function telegramBotToken(): string {
  return env('TELEGRAM_BOT_TOKEN') || env('WMS_TELEGRAM_BOT_TOKEN');
}

export function telegramWorkerUrl(): string {
  return env('TELEGRAM_WORKER_URL').replace(/\/$/, '');
}

export function telegramWorkerSecret(): string {
  return env('TELEGRAM_WORKER_SECRET');
}

export function telegramDefault2faChatId(): string {
  return env('TELEGRAM_2FA_CHAT_ID') || env('WMS_TELEGRAM_2FA_CHAT_ID');
}

/** auto | 1 | 0 — auto: включать 2FA только если токен+chat настроены */
export function admin2faMode(): 'auto' | 'on' | 'off' {
  const v = (env('WMS_ADMIN_2FA') || 'auto').toLowerCase();
  if (v === '0' || v === 'off' || v === 'false' || v === 'no') return 'off';
  if (v === '1' || v === 'on' || v === 'true' || v === 'yes' || v === 'required') return 'on';
  return 'auto';
}

export function telegram2faConfigStatus(): {
  channel: 'telegram';
  mode: 'auto' | 'on' | 'off';
  token_set: boolean;
  default_chat_set: boolean;
  worker_set: boolean;
  ready: boolean;
  ask?: string;
} {
  const mode = admin2faMode();
  const token_set = Boolean(telegramBotToken());
  const default_chat_set = Boolean(telegramDefault2faChatId());
  const worker_set = Boolean(telegramWorkerUrl());
  // mode=off → 2FA выключен (пароль-only); ready=false даже если токены в env остались
  const ready = mode !== 'off' && token_set && default_chat_set;
  let ask: string | undefined;
  if (mode === 'off') {
    ask = undefined;
  } else if (!token_set) {
    ask =
      'ASK: задайте TELEGRAM_BOT_TOKEN в /etc/warehouse-wms.env (можно notify-бот bank) + TELEGRAM_2FA_CHAT_ID (личный chat_id админа, бот должен получить /start).';
  } else if (!default_chat_set) {
    ask =
      'ASK: задайте TELEGRAM_2FA_CHAT_ID — числовой chat_id админа (написать боту /start, узнать id через @userinfobot или getUpdates).';
  }
  return {
    channel: 'telegram',
    mode,
    token_set,
    default_chat_set,
    worker_set,
    ready,
    ask,
  };
}

async function callViaWorker(
  token: string,
  method: string,
  params: Record<string, unknown>
): Promise<TelegramSendResult> {
  const url = telegramWorkerUrl();
  if (!url) return { ok: false, error: 'TELEGRAM_WORKER_URL пуст' };
  const payload: Record<string, unknown> = { token, method, params };
  const secret = telegramWorkerSecret();
  if (secret) payload.secret = secret;
  const res = await fetch(`${url}/tg-api`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(15_000),
  });
  const data = (await res.json().catch(() => null)) as
    | { ok?: boolean; description?: string }
    | null;
  if (!res.ok || !data?.ok) {
    return { ok: false, error: data?.description || `worker HTTP ${res.status}` };
  }
  return { ok: true };
}

async function callDirect(
  token: string,
  method: string,
  params: Record<string, unknown>
): Promise<TelegramSendResult> {
  const body = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null) continue;
    body.set(k, typeof v === 'string' ? v : String(v));
  }
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
    signal: AbortSignal.timeout(12_000),
  });
  const data = (await res.json().catch(() => null)) as
    | { ok?: boolean; description?: string }
    | null;
  if (!data?.ok) {
    return { ok: false, error: data?.description || `telegram HTTP ${res.status}` };
  }
  return { ok: true };
}

export async function telegramSendMessage(
  chatId: string,
  text: string,
  opts?: { parse_mode?: 'HTML' | 'Markdown' }
): Promise<TelegramSendResult> {
  const token = telegramBotToken();
  if (!token) return { ok: false, error: 'TELEGRAM_BOT_TOKEN не задан' };
  if (!chatId) return { ok: false, error: 'chat_id пуст' };
  const params: Record<string, unknown> = {
    chat_id: chatId,
    text,
    disable_web_page_preview: true,
  };
  if (opts?.parse_mode) params.parse_mode = opts.parse_mode;

  const worker = telegramWorkerUrl();
  if (worker) {
    const viaWorker = await callViaWorker(token, 'sendMessage', params);
    if (viaWorker.ok) return viaWorker;
    // fallback на прямой API (если worker упал, а VPS видит TG)
    const direct = await callDirect(token, 'sendMessage', params);
    if (direct.ok) return direct;
    return {
      ok: false,
      error: `worker: ${viaWorker.error}; direct: ${direct.error}`,
    };
  }
  return callDirect(token, 'sendMessage', params);
}
