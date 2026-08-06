/**
 * Обзор Точка банк (балансы / операции / на подпись) через bank API.
 */
import { getTochkaBridgeSettings } from './integration-settings.js';

function bankOverviewUrl(): string {
  return getTochkaBridgeSettings().overview_url;
}

function bankApiKey(): string {
  return getTochkaBridgeSettings().bank_sbp_key;
}

export function bankSettingsApiUrl(): string {
  const overview = bankOverviewUrl();
  try {
    const u = new URL(overview);
    u.pathname = u.pathname.replace(/tochka_overview\.php$/i, 'tochka_settings.php');
    if (!/tochka_settings\.php$/i.test(u.pathname)) {
      u.pathname = '/api/tochka_settings.php';
    }
    return u.toString();
  } catch {
    return 'https://bank.pnevmopodveska1.ru/api/tochka_settings.php';
  }
}

export type TochkaAccountRow = {
  rs: string;
  rs_masked: string;
  name: string;
  customer_code: string;
  status: string;
  currency: string;
  own: number | null;
  available: number | null;
  reserve: number | null;
  is_funds?: number;
  owner_label?: string;
  owner_inn?: string;
};

export type TochkaOperationRow = {
  id: number;
  date: string;
  amount: number | null;
  purpose: string;
  payer: string;
  account: string;
  document_number: string;
  payment_id: string;
  type: string;
  status: unknown;
};

export type TochkaCustomerRow = {
  customer_code: string;
  inn: string;
  ogrn?: string;
  full_name?: string;
  short_name?: string;
  label: string;
};

export type TochkaOverview = {
  ok: boolean;
  at?: string;
  totals?: { own: number; available: number; reserve: number; accounts: number };
  customers?: TochkaCustomerRow[];
  accounts?: TochkaAccountRow[];
  operations?: TochkaOperationRow[];
  for_sign?: {
    ok: boolean;
    items: Array<Record<string, unknown>>;
    error?: string | null;
    hint?: string | null;
  };
  accounts_error?: string | null;
  error?: string;
};

export async function fetchTochkaOverview(): Promise<TochkaOverview> {
  const key = bankApiKey();
  if (!key) {
    throw new Error('Не задан ключ Точка (Настройки → Интеграции → Точка Банк)');
  }
  const res = await fetch(bankOverviewUrl(), {
    headers: { Accept: 'application/json', 'X-Wms-Key': key },
    signal: AbortSignal.timeout(90_000),
  });
  const raw = await res.text();
  let data: TochkaOverview;
  try {
    data = JSON.parse(raw) as TochkaOverview;
  } catch {
    throw new Error(`Банк: не JSON (${res.status}): ${raw.slice(0, 200)}`);
  }
  if (!res.ok || !data.ok) {
    throw new Error(String(data.error || `Банк HTTP ${res.status}`));
  }
  return data;
}

export type TochkaBankAppSettings = {
  ok: boolean;
  configured?: boolean;
  client_id?: string;
  client_id_set?: boolean;
  client_secret_set?: boolean;
  client_secret_hint?: string;
  token_access_set?: boolean;
  token_refresh_set?: boolean;
  token_expires_at?: string | null;
  source?: string;
  message?: string;
  error?: string;
  saved?: boolean;
};

async function callBankSettings(
  method: 'GET' | 'POST',
  body?: Record<string, unknown>
): Promise<TochkaBankAppSettings> {
  const key = bankApiKey();
  if (!key) {
    return {
      ok: false,
      error: 'Не задан ключ X-Wms-Key (мост Учёт №1 → bank)',
    };
  }
  const res = await fetch(bankSettingsApiUrl(), {
    method,
    headers: {
      Accept: 'application/json',
      'X-Wms-Key': key,
      ...(method === 'POST' ? { 'Content-Type': 'application/json' } : {}),
    },
    body: method === 'POST' ? JSON.stringify(body || {}) : undefined,
    signal: AbortSignal.timeout(30_000),
  });
  const raw = await res.text();
  let data: TochkaBankAppSettings;
  try {
    data = JSON.parse(raw) as TochkaBankAppSettings;
  } catch {
    return {
      ok: false,
      error: `Банк settings: не JSON (${res.status})`,
    };
  }
  if (!res.ok && data.ok !== true) {
    return {
      ...data,
      ok: false,
      error: String(data.error || data.message || `HTTP ${res.status}`),
    };
  }
  return data;
}

export async function fetchTochkaBankAppSettings(): Promise<TochkaBankAppSettings> {
  return callBankSettings('GET');
}

export async function saveTochkaBankAppSettings(
  body: Record<string, unknown>
): Promise<TochkaBankAppSettings> {
  return callBankSettings('POST', body);
}
