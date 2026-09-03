/**
 * TargetSMS (sms.targetsms.ru) — HTTPS GET шлюз.
 * Отправители в кабинете регистрозависимы: Fogel / Pnevmo1.
 */
import { INN_BMP } from './sto-sites.js';

const SEND_URL = 'https://sms.targetsms.ru/sendsms.php';

export type TargetSmsSender = 'Fogel' | 'Pnevmo1';

export function targetsmsConfigured(): boolean {
  return !!(
    String(process.env.TARGETSMS_USER || '').trim() &&
    String(process.env.TARGETSMS_PASSWORD || '').trim()
  );
}

export function smsSenderForOrg(opts: {
  inn?: string | null;
  companyCode?: string | null;
  companyName?: string | null;
}): TargetSmsSender {
  const inn = String(opts.inn || '').replace(/\D/g, '');
  if (inn === INN_BMP) return 'Fogel';
  const code = String(opts.companyCode || opts.companyName || '')
    .toLowerCase()
    .replace(/ё/g, 'е');
  if (/fogel|фогел/.test(code)) return 'Fogel';
  return 'Pnevmo1';
}

export type SendSmsResult = {
  ok: true;
  sms_id: string;
  sender: TargetSmsSender;
  phone: string;
};

export type SendSmsError = {
  ok: false;
  error: string;
  raw?: string;
};

/**
 * Отправка одной SMS. phone — 79001234567.
 */
export async function sendTargetSms(input: {
  phone: string;
  text: string;
  sender: TargetSmsSender;
  nameDelivery?: string;
}): Promise<SendSmsResult | SendSmsError> {
  const user = String(process.env.TARGETSMS_USER || '').trim();
  const pwd = String(process.env.TARGETSMS_PASSWORD || '').trim();
  if (!user || !pwd) {
    return { ok: false, error: 'TargetSMS не настроен (TARGETSMS_USER / TARGETSMS_PASSWORD)' };
  }
  const phone = String(input.phone || '').replace(/\D/g, '');
  if (!/^7\d{10}$/.test(phone)) {
    return { ok: false, error: 'Телефон должен быть в формате 7XXXXXXXXXX' };
  }
  const text = String(input.text || '').trim();
  if (!text) return { ok: false, error: 'Пустой текст SMS' };
  const sender = input.sender;
  const qs = new URLSearchParams({
    user,
    pwd,
    sadr: sender,
    dadr: phone,
    text,
    name_delivery: String(input.nameDelivery || 'pdn-uchetn1').slice(0, 64),
  });
  try {
    const res = await fetch(`${SEND_URL}?${qs.toString()}`, {
      method: 'GET',
      headers: { Accept: 'text/plain' },
      signal: AbortSignal.timeout(20000),
    });
    const raw = (await res.text()).trim();
    if (!res.ok) {
      return { ok: false, error: `HTTP ${res.status}`, raw: raw.slice(0, 400) };
    }
    // Успех: числовой ID; ошибка: текст на русском
    if (/^\d+(,\d+)*$/.test(raw)) {
      return { ok: true, sms_id: raw.split(',')[0]!, sender, phone };
    }
    return { ok: false, error: raw || 'Ошибка отправки SMS', raw: raw.slice(0, 400) };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : 'network error',
    };
  }
}
