/**
 * Касса: остатки по кассам, статусы АТОЛ/ОФД/Точка, журнал чеков/оплат.
 */
import { all, get } from './db.js';
import { atolConfigured, atolStatusInfo, testAtolConnection } from './atol.js';
import { getAtolSettings, tochkaBridgePublic } from './integration-settings.js';
import { fetchTochkaOverview } from './bank-tochka.js';
import { listCashRegistersWithBalances } from './menu-parity.js';

export type KassaSource = 'fiscal' | 'payment' | 'pay_link' | 'all';

export type KassaJournalItem = {
  source: 'fiscal' | 'payment' | 'pay_link';
  id: string;
  deal_id: string;
  deal_name: string;
  subtype: string;
  status: string;
  amount: number;
  created_at: string;
  detail: string;
  extra: string;
};

function tableExists(name: string): boolean {
  return Boolean(
    get<{ name: string }>(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`, [name])
  );
}

function journalTotals(): {
  fiscal: number;
  payment: number;
  pay_link: number;
  amount_paid: number;
} {
  const countFiscal = tableExists('fiscal_receipts')
    ? Number(get<{ c: number }>(`SELECT COUNT(*) AS c FROM fiscal_receipts`)?.c) || 0
    : 0;
  const countPay = tableExists('deal_payments')
    ? Number(get<{ c: number }>(`SELECT COUNT(*) AS c FROM deal_payments`)?.c) || 0
    : 0;
  const countLink = tableExists('payment_links')
    ? Number(get<{ c: number }>(`SELECT COUNT(*) AS c FROM payment_links`)?.c) || 0
    : 0;
  const paidAmt = tableExists('deal_payments')
    ? Number(
        get<{ a: number }>(
          `SELECT IFNULL(SUM(amount),0) AS a FROM deal_payments
           WHERE lower(status) IN ('paid','confirmed','success','accepted')`
        )?.a
      ) || 0
    : 0;
  return {
    fiscal: countFiscal,
    payment: countPay,
    pay_link: countLink,
    amount_paid: paidAmt,
  };
}

type ProbeCache = {
  at: number;
  ok: boolean;
  message: string;
};

let atolTokenCache: ProbeCache | null = null;
let tochkaProbeCache: ProbeCache | null = null;
const PROBE_CACHE_MS = 60_000;

async function cachedAtolTokenTest(force = false): Promise<ProbeCache> {
  if (!force && atolTokenCache && Date.now() - atolTokenCache.at < PROBE_CACHE_MS) {
    return atolTokenCache;
  }
  if (!atolConfigured()) {
    atolTokenCache = {
      at: Date.now(),
      ok: false,
      message: 'Не заданы login / pass / group_code',
    };
    return atolTokenCache;
  }
  try {
    const result = await Promise.race([
      testAtolConnection(),
      new Promise<{ ok: false; message: string }>((resolve) =>
        setTimeout(() => resolve({ ok: false, message: 'Таймаут проверки АТОЛ' }), 8000)
      ),
    ]);
    atolTokenCache = {
      at: Date.now(),
      ok: Boolean(result.ok),
      message: String(result.message || ''),
    };
  } catch (e) {
    atolTokenCache = {
      at: Date.now(),
      ok: false,
      message: e instanceof Error ? e.message : String(e),
    };
  }
  return atolTokenCache;
}

async function cachedTochkaProbe(force = false): Promise<ProbeCache> {
  if (!force && tochkaProbeCache && Date.now() - tochkaProbeCache.at < PROBE_CACHE_MS) {
    return tochkaProbeCache;
  }
  const bridge = tochkaBridgePublic();
  if (!bridge.configured) {
    tochkaProbeCache = {
      at: Date.now(),
      ok: false,
      message: 'ключ моста не задан',
    };
    return tochkaProbeCache;
  }
  try {
    const data = await Promise.race([
      fetchTochkaOverview(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Таймаут проверки Точки')), 8000)
      ),
    ]);
    const accounts =
      Number(data.totals?.accounts ?? data.accounts?.length ?? 0) || 0;
    tochkaProbeCache = {
      at: Date.now(),
      ok: true,
      message: `отвечает · счетов ${accounts}`,
    };
  } catch (e) {
    tochkaProbeCache = {
      at: Date.now(),
      ok: false,
      message: e instanceof Error ? e.message : String(e),
    };
  }
  return tochkaProbeCache;
}

function fiscalHealth7d(): {
  days: number;
  done: number;
  wait: number;
  error: number;
  total: number;
} {
  if (!tableExists('fiscal_receipts')) {
    return { days: 7, done: 0, wait: 0, error: 0, total: 0 };
  }
  const rows = all<{ status: string; c: number }>(
    `SELECT lower(IFNULL(status,'')) AS status, COUNT(*) AS c
     FROM fiscal_receipts
     WHERE datetime(created_at) >= datetime('now', '-7 days')
     GROUP BY lower(IFNULL(status,''))`
  );
  let done = 0;
  let wait = 0;
  let error = 0;
  let total = 0;
  for (const r of rows) {
    const n = Number(r.c) || 0;
    total += n;
    const st = String(r.status || '');
    if (['done', 'ready', 'ok', 'success'].includes(st)) done += n;
    else if (st === 'error' || st === 'fail' || st === 'failed') error += n;
    else wait += n;
  }
  return { days: 7, done, wait, error, total };
}

/** Дашборд раздела Касса: плашки + статусы. */
export async function getKassaOverview(opts?: {
  probe_atol?: boolean;
  force_atol?: boolean;
  probe_tochka?: boolean;
  force_tochka?: boolean;
  organization_id?: string;
  company_id?: string;
}): Promise<{
  registers: ReturnType<typeof listCashRegistersWithBalances>;
  balance_total: number;
  health: {
    atol: {
      configured: boolean;
      token_ok: boolean | null;
      message: string;
      group_code: string;
      inn: string;
      settings_path: string;
    };
    fiscal: ReturnType<typeof fiscalHealth7d>;
    ofd: { mode: string; note: string };
    tochka: {
      configured: boolean;
      bridge_ok: boolean | null;
      message: string;
      balances_path: string;
    };
  };
  totals: ReturnType<typeof journalTotals>;
  organization_id: string;
  company_id: string;
}> {
  const orgId = String(opts?.organization_id || '').trim();
  const companyId = String(opts?.company_id || '').trim();
  const registers = listCashRegistersWithBalances({
    ...(orgId ? { organization_id: orgId } : {}),
    ...(!orgId && companyId ? { company_id: companyId } : {}),
  });
  const balance_total =
    Math.round(registers.reduce((s, r) => s + (Number(r.balance) || 0), 0));
  const atolInfo = atolStatusInfo();
  const s = getAtolSettings();
  const probeAtol = opts?.probe_atol !== false;
  let tokenOk: boolean | null = null;
  let tokenMsg = '';
  if (probeAtol) {
    const t = await cachedAtolTokenTest(Boolean(opts?.force_atol));
    tokenOk = t.ok;
    tokenMsg = t.message;
  }
  const bridge = tochkaBridgePublic();
  const probeTochka = opts?.probe_tochka !== false;
  let bridgeOk: boolean | null = null;
  let tochkaMsg = bridge.configured ? '' : 'ключ моста не задан';
  if (probeTochka) {
    const t = await cachedTochkaProbe(Boolean(opts?.force_tochka));
    bridgeOk = t.ok;
    tochkaMsg = t.message;
  }
  return {
    registers,
    balance_total,
    organization_id: orgId,
    company_id: companyId,
    health: {
      atol: {
        configured: Boolean(atolInfo.configured),
        token_ok: tokenOk,
        message: tokenMsg || (atolInfo.configured ? '' : 'Нет credentials АТОЛ'),
        group_code: String(s.group_code || ''),
        inn: String(atolInfo.inn || ''),
        settings_path: '/settings/atol',
      },
      fiscal: fiscalHealth7d(),
      ofd: {
        mode: 'via_atol',
        note: 'Прямого баланса ОФД нет — чеки уходят через АТОЛ. Баланс/сверка — в кабинете АТОЛ или ОФД.',
      },
      tochka: {
        configured: Boolean(bridge.configured),
        bridge_ok: bridgeOk,
        message: tochkaMsg,
        balances_path: String(bridge.balances_path || '/money/tochka'),
      },
    },
    totals: journalTotals(),
  };
}

export function listKassaJournal(opts?: {
  q?: string;
  source?: string;
  day?: string;
  page?: number;
  limit?: number;
}): {
  items: KassaJournalItem[];
  total: number;
  page: number;
  limit: number;
  totals: { fiscal: number; payment: number; pay_link: number; amount_paid: number };
} {
  const page = Math.max(1, Number(opts?.page) || 1);
  const limit = Math.min(Math.max(Number(opts?.limit) || 50, 1), 200);
  const offset = (page - 1) * limit;
  const q = String(opts?.q || '').trim();
  const source = String(opts?.source || 'all').toLowerCase();
  const day = String(opts?.day || '').trim();

  const parts: string[] = [];
  const params: Array<string | number> = [];

  if (tableExists('fiscal_receipts') && (source === 'all' || source === 'fiscal')) {
    parts.push(`
      SELECT 'fiscal' AS source, f.id AS id, f.deal_id AS deal_id,
             IFNULL(d.name,'') AS deal_name,
             f.kind AS subtype, f.status AS status, f.amount AS amount,
             f.created_at AS created_at,
             IFNULL(NULLIF(f.error,''), IFNULL(f.atol_uuid,'')) AS detail,
             IFNULL(f.parent_receipt_id,'') AS extra
      FROM fiscal_receipts f
      LEFT JOIN crm_deals d ON d.id = f.deal_id
    `);
  }
  if (tableExists('deal_payments') && (source === 'all' || source === 'payment')) {
    parts.push(`
      SELECT 'payment' AS source, p.id AS id, p.deal_id AS deal_id,
             IFNULL(d.name,'') AS deal_name,
             p.kind AS subtype, p.status AS status, p.amount AS amount,
             p.created_at AS created_at,
             IFNULL(NULLIF(p.qrc_id,''), IFNULL(p.purpose,'')) AS detail,
             '' AS extra
      FROM deal_payments p
      LEFT JOIN crm_deals d ON d.id = p.deal_id
    `);
  }
  if (tableExists('payment_links') && (source === 'all' || source === 'pay_link')) {
    parts.push(`
      SELECT 'pay_link' AS source, l.id AS id, l.deal_id AS deal_id,
             IFNULL(d.name,'') AS deal_name,
             l.status AS subtype, l.status AS status, l.amount AS amount,
             IFNULL(l.created_at, '') AS created_at,
             IFNULL(l.token,'') AS detail,
             IFNULL(l.paid_at,'') AS extra
      FROM payment_links l
      LEFT JOIN crm_deals d ON d.id = l.deal_id
    `);
  }

  if (!parts.length) {
    return {
      items: [],
      total: 0,
      page,
      limit,
      totals: { fiscal: 0, payment: 0, pay_link: 0, amount_paid: 0 },
    };
  }

  const union = parts.join('\nUNION ALL\n');
  const where: string[] = [];
  if (day) {
    where.push(`date(created_at) = date(?)`);
    params.push(day);
  }
  if (q) {
    where.push(
      `(deal_id LIKE ? OR deal_name LIKE ? OR subtype LIKE ? OR status LIKE ? OR detail LIKE ? OR id LIKE ?)`
    );
    const like = `%${q}%`;
    params.push(like, like, like, like, like, like);
  }
  const whereSql = where.length ? ` WHERE ${where.join(' AND ')}` : '';

  const totalRow = get<{ c: number }>(
    `SELECT COUNT(*) AS c FROM (${union}) AS j${whereSql}`,
    params
  );
  const total = Number(totalRow?.c) || 0;

  const items = all(
    `SELECT * FROM (${union}) AS j${whereSql}
     ORDER BY datetime(created_at) DESC
     LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  ) as KassaJournalItem[];

  return {
    items: items.map((r) => ({
      source: r.source,
      id: String(r.id || ''),
      deal_id: String(r.deal_id || ''),
      deal_name: String(r.deal_name || ''),
      subtype: String(r.subtype || ''),
      status: String(r.status || ''),
      amount: Number(r.amount) || 0,
      created_at: String(r.created_at || ''),
      detail: String(r.detail || ''),
      extra: String(r.extra || ''),
    })),
    total,
    page,
    limit,
    totals: journalTotals(),
  };
}
