/**
 * Стандартизация телефонов (RU business + best-effort для прочего).
 * Хранится в meta.ui_settings.phone_format.
 */
import { get, run } from './db.js';

export const PHONE_FORMATS = [
  'plus7_spaced',
  'eight_spaced',
  'digits7',
  'plus7_digits',
  'off',
] as const;

export type PhoneFormat = (typeof PHONE_FORMATS)[number];

export const PHONE_FORMAT_LABELS: Record<PhoneFormat, string> = {
  plus7_spaced: '+7 со скобками',
  eight_spaced: '8 со скобками',
  digits7: '7 без пробелов',
  plus7_digits: '+7 без пробелов',
  off: 'Как введено',
};

export const DEFAULT_PHONE_FORMAT: PhoneFormat = 'plus7_spaced';

export type UiSettings = {
  phone_format: PhoneFormat;
  /** Минуты до снятия резерва / истечения ссылки на оплату (по умолчанию 120). */
  payment_link_timer_minutes: number;
  /** Перемещать товар на склад «Ожидание оплаты» при создании ссылки. */
  payment_link_reserve_enabled: boolean;
  /** Предпочтительный склад-источник для резерва (пусто = авто). */
  payment_link_default_warehouse_id: string;
  /** Организация по умолчанию для ссылки на оплату / резерва. */
  payment_link_default_organization_id: string;
};

const META_KEY = 'ui_settings';
const DEFAULT_PAYMENT_LINK_TIMER_MINUTES = 120;

function asPhoneFormat(v: unknown): PhoneFormat {
  const s = String(v || '').trim();
  return (PHONE_FORMATS as readonly string[]).includes(s)
    ? (s as PhoneFormat)
    : DEFAULT_PHONE_FORMAT;
}

function asTimerMinutes(v: unknown): number {
  const n = Math.floor(Number(v));
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_PAYMENT_LINK_TIMER_MINUTES;
  return Math.min(n, 24 * 60);
}

function defaultsUi(): UiSettings {
  return {
    phone_format: DEFAULT_PHONE_FORMAT,
    payment_link_timer_minutes: DEFAULT_PAYMENT_LINK_TIMER_MINUTES,
    payment_link_reserve_enabled: false,
    payment_link_default_warehouse_id: '',
    payment_link_default_organization_id: '',
  };
}

export function getUiSettings(): UiSettings {
  const base = defaultsUi();
  const row = get<{ value: string }>('SELECT value FROM meta WHERE key = ?', [META_KEY]);
  if (!row?.value) return base;
  try {
    const parsed = JSON.parse(row.value) as Partial<UiSettings>;
    return {
      phone_format: asPhoneFormat(parsed.phone_format),
      payment_link_timer_minutes: asTimerMinutes(parsed.payment_link_timer_minutes),
      payment_link_reserve_enabled: false,
      payment_link_default_warehouse_id: String(
        parsed.payment_link_default_warehouse_id || ''
      ),
      payment_link_default_organization_id: String(
        parsed.payment_link_default_organization_id || ''
      ),
    };
  } catch {
    return base;
  }
}

export function saveUiSettings(patch: Partial<UiSettings>): UiSettings {
  const next: UiSettings = { ...getUiSettings() };
  if (patch.phone_format != null) {
    next.phone_format = asPhoneFormat(patch.phone_format);
  }
  if (patch.payment_link_timer_minutes != null) {
    next.payment_link_timer_minutes = asTimerMinutes(patch.payment_link_timer_minutes);
  }
  if (patch.payment_link_reserve_enabled != null) {
    // WAIT-PAY резерв отключён навсегда
    next.payment_link_reserve_enabled = false;
  }
  if (patch.payment_link_default_warehouse_id != null) {
    next.payment_link_default_warehouse_id = String(
      patch.payment_link_default_warehouse_id || ''
    );
  }
  if (patch.payment_link_default_organization_id != null) {
    next.payment_link_default_organization_id = String(
      patch.payment_link_default_organization_id || ''
    );
  }
  run('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)', [META_KEY, JSON.stringify(next)]);
  return next;
}

export function getPhoneFormat(): PhoneFormat {
  return getUiSettings().phone_format;
}

/** Только цифры. */
export function digitsOnly(raw: unknown): string {
  return String(raw ?? '').replace(/\D/g, '');
}

/**
 * Разобрать RU мобильный/городской: 10 цифр абонента (без кода страны).
 * 11 с 7/8 → 10; 10 → как есть. Иначе null (короткий / иностранный / мусор).
 */
export function parseRuSubscriber(raw: unknown): string | null {
  const d = digitsOnly(raw);
  if (!d) return null;
  if (d.length === 11 && (d[0] === '7' || d[0] === '8')) return d.slice(1);
  if (d.length === 10) return d;
  return null;
}

function formatRuSubscriber(sub: string, style: PhoneFormat): string {
  const a = sub.slice(0, 3);
  const b = sub.slice(3, 6);
  const c = sub.slice(6, 8);
  const e = sub.slice(8, 10);
  switch (style) {
    case 'eight_spaced':
      return `8 (${a}) ${b}-${c}-${e}`;
    case 'digits7':
      return `7${sub}`;
    case 'plus7_digits':
      return `+7${sub}`;
    case 'plus7_spaced':
    default:
      return `+7 (${a}) ${b}-${c}-${e}`;
  }
}

/**
 * Один номер → формат style. Если не RU 10/11 — вернуть исходную строку (trim).
 * style=off → trim без изменений.
 */
export function formatPhone(raw: unknown, style: PhoneFormat = DEFAULT_PHONE_FORMAT): string {
  const s = String(raw ?? '').trim();
  if (!s) return '';
  if (style === 'off') return s;
  const sub = parseRuSubscriber(s);
  if (!sub) return s;
  return formatRuSubscriber(sub, style);
}

/**
 * Строка с несколькими телефонами (запятая / ; / / / перевод строки).
 * Каждый кусок форматируется отдельно; нераспознанное оставляем.
 */
export function formatPhoneField(
  raw: unknown,
  style: PhoneFormat = DEFAULT_PHONE_FORMAT
): string {
  const s = String(raw ?? '').trim();
  if (!s) return '';
  if (style === 'off') return s;
  const parts = s
    .split(/[,;/\n\r]+/)
    .map((p) => p.trim())
    .filter(Boolean);
  if (!parts.length) return '';
  return parts.map((p) => formatPhone(p, style)).join(', ');
}

/** Нормализация при сохранении (тот же format, если style ≠ off). */
export function normalizePhoneForStorage(
  raw: unknown,
  style?: PhoneFormat
): string {
  return formatPhoneField(raw, style ?? getPhoneFormat());
}
