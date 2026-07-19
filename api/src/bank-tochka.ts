/**
 * Обзор Точка банк (балансы / операции / на подпись) через bank API.
 */
function bankOverviewUrl(): string {
  return (
    process.env.BANK_TOCHKA_OVERVIEW_URL ||
    'https://bank.pnevmopodveska1.ru/api/tochka_overview.php'
  ).trim();
}

function bankApiKey(): string {
  return (process.env.BANK_SBP_KEY || process.env.WMS_BANK_API_KEY || '').trim();
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

export type TochkaOverview = {
  ok: boolean;
  at?: string;
  totals?: { own: number; available: number; reserve: number; accounts: number };
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
    throw new Error('Не задан BANK_SBP_KEY / WMS_BANK_API_KEY');
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
