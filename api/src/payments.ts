/**
 * СБП QR через bank.pnevmopodveska1.ru (Точка).
 */
import { all, get, run } from './db.js';
import { newGuid } from './ids.js';
import { getDeal } from './deals.js';
import { getOrgProfile } from './sales-docs.js';

function bankSbpUrl(): string {
  return (
    process.env.BANK_SBP_CREATE_URL ||
    'https://bank.pnevmopodveska1.ru/api/sbp_create_qr.php'
  ).trim();
}

function bankSbpKey(): string {
  return (process.env.BANK_SBP_KEY || process.env.WMS_BANK_API_KEY || '').trim();
}

/** Назначение СБП под regex Точки (без · / ё / «» и пр.). */
function sanitizeSbpPurpose(raw: string): string {
  let s = String(raw || '')
    .replace(/[·•]/g, '-')
    .replace(/[–—]/g, '-')
    .replace(/[«»“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/Ё/g, 'Е')
    .replace(/ё/g, 'е')
    .replace(/[\r\n\t]+/g, ' ');
  s = s.replace(/[^A-Za-zА-Яа-я0-9 !"#$%&'()*+,\-./:;<=>?@^_`{|}~#№[\]\\]/gu, '');
  s = s.replace(/\s+/g, ' ').trim();
  return s.slice(0, 140);
}

function humanizeBankError(err: string): string {
  const s = String(err || '');
  const jsonStart = s.indexOf('{');
  if (jsonStart >= 0) {
    try {
      const j = JSON.parse(s.slice(jsonStart)) as {
        message?: string;
        Errors?: Array<{ message?: string }>;
      };
      const detail = j.Errors?.[0]?.message || j.message || '';
      if (detail && /match pattern/i.test(detail)) {
        return 'Точка: недопустимые символы в назначении платежа';
      }
      if (detail) return 'Точка: ' + detail;
    } catch {
      /* keep raw */
    }
  }
  return s;
}

export function listDealPayments(dealId: string) {
  return all(
    `SELECT id, kind, amount, status, qrc_id, payload, account, purpose, created_at,
            CASE WHEN length(image_png_base64)>0 THEN 1 ELSE 0 END AS has_image
     FROM deal_payments WHERE deal_id = ? ORDER BY datetime(created_at) DESC`,
    [dealId]
  );
}

export function getDealPayment(id: string) {
  return get('SELECT * FROM deal_payments WHERE id = ?', [id]) || null;
}

/** Удалить запись QR/оплаты со сделки (локальная история; QR в банке не отменяется). */
export function deleteDealPayment(id: string) {
  const row = getDealPayment(id);
  if (!row) return null;
  run('DELETE FROM deal_payments WHERE id = ?', [id]);
  return row;
}

export async function createDealSbpQr(input: {
  dealId: string;
  amount?: number;
  purpose?: string;
  account?: string;
  ttlSec?: number;
}) {
  const deal = getDeal(input.dealId) as Record<string, unknown> | null;
  if (!deal) throw new Error('Сделка не найдена');

  const amount =
    input.amount != null && Number(input.amount) > 0
      ? Number(input.amount)
      : Number(deal.price) || 0;
  if (!(amount > 0)) {
    throw new Error('Сумма заказа 0 — укажите сумму или добавьте позиции');
  }

  const org = getOrgProfile();
  const account =
    (input.account || '').replace(/\D/g, '') ||
    String(org.rs || '').replace(/\D/g, '') ||
    '40802810109500030587';

  const purpose = sanitizeSbpPurpose(
    (input.purpose || '').trim() ||
      `Оплата заказа ${deal.id}` +
        (deal.name ? ` - ${String(deal.name).slice(0, 80)}` : '')
  );

  const key = bankSbpKey();
  if (!key) {
    throw new Error('Не задан BANK_SBP_KEY на сервере Учёт №1');
  }

  const res = await fetch(bankSbpUrl(), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Wms-Key': key,
    },
    body: JSON.stringify({
      deal_id: String(deal.id),
      amount,
      purpose,
      account,
      ttl_sec: input.ttlSec ?? 86400,
    }),
  });
  const raw = await res.text();
  let data: Record<string, unknown> = {};
  try {
    data = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    throw new Error(`Банк: не JSON (${res.status}): ${raw.slice(0, 200)}`);
  }
  if (!res.ok || !data.ok) {
    throw new Error(humanizeBankError(String(data.error || `Банк HTTP ${res.status}`)));
  }

  const id = newGuid();
  run(
    `INSERT INTO deal_payments (
       id, deal_id, kind, amount, status, qrc_id, payload, image_png_base64, account, purpose, meta_json
     ) VALUES (?, ?, 'sbp_qr', ?, 'created', ?, ?, ?, ?, ?, ?)`,
    [
      id,
      String(deal.id),
      amount,
      String(data.qrc_id || ''),
      String(data.payload || ''),
      String(data.image_png_base64 || ''),
      String(data.account || account),
      String(data.purpose || purpose),
      JSON.stringify({ merchant_id: data.merchant_id || '', ttl_sec: data.ttl_sec || null }),
    ]
  );

  return getDealPayment(id);
}
