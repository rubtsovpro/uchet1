/**
 * Справочник валют RUB/USD/CNY (RMB) + курсы (manual / ЦБ РФ / linked / formula).
 * Документы и оценка склада пока остаются в RUB.
 */
import { all, get, run } from './db.js';
import { newGuid } from './ids.js';

const CBR_DAILY_URL = 'https://www.cbr-xml-daily.ru/daily_json.js';
const RATE_MODES = new Set(['manual', 'internet', 'linked', 'formula']);

export type RateMode = 'manual' | 'internet' | 'linked' | 'formula';

export type CurrencyRow = {
  code: string;
  name: string;
  symbol: string;
  numeric_code: string;
  alt_code: string;
  rate_mode: RateMode;
  linked_code: string;
  linked_markup_pct: number;
  formula: string;
  spell_unit_1: string;
  spell_unit_2: string;
  spell_unit_5: string;
  spell_frac_1: string;
  spell_frac_2: string;
  spell_frac_5: string;
  is_active: number;
  sort_order: number;
  updated_at: string;
};

export type CurrencyRateRow = {
  id: string;
  base_code: string;
  quote_code: string;
  rate: number;
  rate_date: string;
  source: string;
  updated_at: string;
};

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function normCode(v: unknown): string {
  return String(v || '')
    .trim()
    .toUpperCase()
    .slice(0, 8);
}

function asMode(v: unknown, fallback: RateMode = 'manual'): RateMode {
  const m = String(v || '').trim().toLowerCase();
  return RATE_MODES.has(m) ? (m as RateMode) : fallback;
}

export function listCurrencies(activeOnly = true): CurrencyRow[] {
  if (activeOnly) {
    return all(
      `SELECT * FROM currencies WHERE is_active = 1 ORDER BY sort_order, code`
    ) as CurrencyRow[];
  }
  return all(`SELECT * FROM currencies ORDER BY sort_order, code`) as CurrencyRow[];
}

export function getCurrency(code: string): CurrencyRow | undefined {
  const c = normCode(code);
  if (!c) return undefined;
  return get(`SELECT * FROM currencies WHERE code = ? LIMIT 1`, [c]) as CurrencyRow | undefined;
}

export function listCurrencyRates(opts: {
  base?: string;
  quote?: string;
  limit?: number;
} = {}): CurrencyRateRow[] {
  const base = normCode(opts.base);
  const quote = normCode(opts.quote);
  const limit = Math.min(500, Math.max(1, opts.limit || 50));
  const order = `ORDER BY CASE WHEN source = 'stub' THEN 1 ELSE 0 END,
       rate_date DESC, datetime(updated_at) DESC LIMIT ?`;
  if (base && quote) {
    return all(
      `SELECT * FROM currency_rates WHERE base_code = ? AND quote_code = ? ${order}`,
      [base, quote, limit]
    ) as CurrencyRateRow[];
  }
  if (base) {
    return all(
      `SELECT * FROM currency_rates WHERE base_code = ? OR quote_code = ? ${order}`,
      [base, base, limit]
    ) as CurrencyRateRow[];
  }
  return all(`SELECT * FROM currency_rates ${order}`, [limit]) as CurrencyRateRow[];
}

/** Последний курс «1 CODE = N RUB» (как в шапке 1С). Stub-сиды не перекрывают ЦБ/manual. */
export function latestRateToRub(code: string): CurrencyRateRow | undefined {
  const c = normCode(code);
  if (!c || c === 'RUB') return undefined;
  const order = `ORDER BY CASE WHEN source = 'stub' THEN 1 ELSE 0 END,
     rate_date DESC, datetime(updated_at) DESC LIMIT 1`;
  const direct = get(
    `SELECT * FROM currency_rates WHERE base_code = ? AND quote_code = 'RUB' ${order}`,
    [c]
  ) as CurrencyRateRow | undefined;
  if (direct) return direct;
  const inv = get(
    `SELECT * FROM currency_rates WHERE base_code = 'RUB' AND quote_code = ? ${order}`,
    [c]
  ) as CurrencyRateRow | undefined;
  if (!inv || !(inv.rate > 0)) return undefined;
  return {
    ...inv,
    base_code: c,
    quote_code: 'RUB',
    rate: 1 / Number(inv.rate),
  };
}

export function headerRates() {
  const usd = latestRateToRub('USD');
  const cny = latestRateToRub('CNY');
  return {
    as_of: usd?.rate_date || cny?.rate_date || null,
    items: [
      {
        code: 'USD',
        display: 'USD',
        symbol: '$',
        rate: usd?.rate ?? null,
        rate_date: usd?.rate_date ?? null,
        source: usd?.source ?? null,
      },
      {
        code: 'CNY',
        display: 'RMB',
        symbol: '¥',
        rate: cny?.rate ?? null,
        rate_date: cny?.rate_date ?? null,
        source: cny?.source ?? null,
      },
    ],
  };
}

export function currenciesCatalog() {
  const currencies = listCurrencies(true);
  const rates = listCurrencyRates({ limit: 80 });
  const header = headerRates();
  return {
    currencies,
    rates,
    header,
    rate_modes: [
      { id: 'manual', label: 'Вводится вручную' },
      { id: 'internet', label: 'Загружается из Интернета (ЦБ РФ)' },
      { id: 'linked', label: 'Связан с курсом другой валюты' },
      { id: 'formula', label: 'Рассчитывается по формуле' },
    ],
    note: 'Справочник валют + курсы ЦБ РФ. Документы / оценка склада пока в RUB.',
  };
}

export function upsertCurrencyRate(input: {
  base_code?: string;
  quote_code: string;
  rate: number;
  rate_date?: string;
  source?: string;
}): CurrencyRateRow {
  const base = normCode(input.base_code || 'RUB') || 'RUB';
  const quote = normCode(input.quote_code);
  const rate = Number(input.rate);
  if (!quote || quote.length < 3) throw new Error('quote_code required');
  if (!(rate > 0)) throw new Error('rate must be > 0');
  const rateDate = String(input.rate_date || todayIso()).slice(0, 10);
  const source = String(input.source || 'manual').slice(0, 40);

  const existing = get<{ id: string }>(
    `SELECT id FROM currency_rates WHERE base_code = ? AND quote_code = ? AND rate_date = ? LIMIT 1`,
    [base, quote, rateDate]
  );
  if (existing) {
    run(
      `UPDATE currency_rates SET rate = ?, source = ?, updated_at = datetime('now') WHERE id = ?`,
      [rate, source, existing.id]
    );
    return get(`SELECT * FROM currency_rates WHERE id = ?`, [existing.id]) as CurrencyRateRow;
  }
  const id = newGuid();
  run(
    `INSERT INTO currency_rates (id, base_code, quote_code, rate, rate_date, source, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, datetime('now'))`,
    [id, base, quote, rate, rateDate, source]
  );
  return get(`SELECT * FROM currency_rates WHERE id = ?`, [id]) as CurrencyRateRow;
}

/** Сохранить пару CODE↔RUB (1 CODE = rate RUB + обратный). */
export function upsertRubPair(opts: {
  code: string;
  rateToRub: number;
  rate_date?: string;
  source?: string;
}) {
  const code = normCode(opts.code);
  const rateToRub = Number(opts.rateToRub);
  if (!code) throw new Error('code required');
  if (!(rateToRub > 0)) throw new Error('rate must be > 0');
  const rateDate = String(opts.rate_date || todayIso()).slice(0, 10);
  const source = String(opts.source || 'manual').slice(0, 40);
  const forward = upsertCurrencyRate({
    base_code: code,
    quote_code: 'RUB',
    rate: rateToRub,
    rate_date: rateDate,
    source,
  });
  upsertCurrencyRate({
    base_code: 'RUB',
    quote_code: code,
    rate: 1 / rateToRub,
    rate_date: rateDate,
    source,
  });
  return forward;
}

export function upsertCurrency(input: Partial<CurrencyRow> & { code: string }): CurrencyRow {
  const code = normCode(input.code);
  if (!code || code.length < 3) throw new Error('code required (ISO 4217)');
  const existing = getCurrency(code);
  const name = String(input.name ?? existing?.name ?? code).trim().slice(0, 120) || code;
  const symbol = String(input.symbol ?? existing?.symbol ?? '').trim().slice(0, 8);
  const numeric = String(input.numeric_code ?? existing?.numeric_code ?? '')
    .replace(/\D/g, '')
    .slice(0, 3);
  const alt = normCode(input.alt_code ?? existing?.alt_code ?? '') || '';
  const rateMode = asMode(input.rate_mode ?? existing?.rate_mode, code === 'RUB' ? 'manual' : 'manual');
  const linked = normCode(input.linked_code ?? existing?.linked_code ?? '');
  const markup = Number(input.linked_markup_pct ?? existing?.linked_markup_pct ?? 0) || 0;
  const formula = String(input.formula ?? existing?.formula ?? '').trim().slice(0, 200);
  const spell = {
    spell_unit_1: String(input.spell_unit_1 ?? existing?.spell_unit_1 ?? '').slice(0, 40),
    spell_unit_2: String(input.spell_unit_2 ?? existing?.spell_unit_2 ?? '').slice(0, 40),
    spell_unit_5: String(input.spell_unit_5 ?? existing?.spell_unit_5 ?? '').slice(0, 40),
    spell_frac_1: String(input.spell_frac_1 ?? existing?.spell_frac_1 ?? '').slice(0, 40),
    spell_frac_2: String(input.spell_frac_2 ?? existing?.spell_frac_2 ?? '').slice(0, 40),
    spell_frac_5: String(input.spell_frac_5 ?? existing?.spell_frac_5 ?? '').slice(0, 40),
  };
  const isActive =
    input.is_active != null
      ? Number(input.is_active) ? 1 : 0
      : existing
        ? Number(existing.is_active)
        : 1;
  const sortOrder =
    input.sort_order != null
      ? Number(input.sort_order) || 100
      : existing
        ? Number(existing.sort_order)
        : 100;

  if (existing) {
    run(
      `UPDATE currencies SET
        name = ?, symbol = ?, numeric_code = ?, alt_code = ?,
        rate_mode = ?, linked_code = ?, linked_markup_pct = ?, formula = ?,
        spell_unit_1 = ?, spell_unit_2 = ?, spell_unit_5 = ?,
        spell_frac_1 = ?, spell_frac_2 = ?, spell_frac_5 = ?,
        is_active = ?, sort_order = ?, updated_at = datetime('now')
       WHERE code = ?`,
      [
        name,
        symbol,
        numeric,
        alt,
        rateMode,
        linked,
        markup,
        formula,
        spell.spell_unit_1,
        spell.spell_unit_2,
        spell.spell_unit_5,
        spell.spell_frac_1,
        spell.spell_frac_2,
        spell.spell_frac_5,
        isActive,
        sortOrder,
        code,
      ]
    );
  } else {
    run(
      `INSERT INTO currencies (
        code, name, symbol, numeric_code, alt_code,
        rate_mode, linked_code, linked_markup_pct, formula,
        spell_unit_1, spell_unit_2, spell_unit_5,
        spell_frac_1, spell_frac_2, spell_frac_5,
        is_active, sort_order, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
      [
        code,
        name,
        symbol,
        numeric,
        alt,
        rateMode,
        linked,
        markup,
        formula,
        spell.spell_unit_1,
        spell.spell_unit_2,
        spell.spell_unit_5,
        spell.spell_frac_1,
        spell.spell_frac_2,
        spell.spell_frac_5,
        isActive,
        sortOrder,
      ]
    );
  }
  return getCurrency(code)!;
}

type CbrPayload = {
  Date?: string;
  Valute?: Record<
    string,
    { CharCode?: string; Nominal?: number; Value?: number; Name?: string; NumCode?: string }
  >;
};

async function fetchCbrDaily(): Promise<{ date: string; valute: NonNullable<CbrPayload['Valute']> }> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 20_000);
  try {
    const res = await fetch(CBR_DAILY_URL, {
      signal: ctrl.signal,
      headers: { Accept: 'application/json', 'User-Agent': 'uchet1-wms/currencies' },
    });
    if (!res.ok) throw new Error(`CBR HTTP ${res.status}`);
    const data = (await res.json()) as CbrPayload;
    const dateRaw = String(data.Date || '').trim();
    // "2026-07-31T11:30:00+03:00" или "31.07.2026"
    let date = todayIso();
    if (/^\d{4}-\d{2}-\d{2}/.test(dateRaw)) date = dateRaw.slice(0, 10);
    else {
      const m = dateRaw.match(/^(\d{2})\.(\d{2})\.(\d{4})/);
      if (m) date = `${m[3]}-${m[2]}-${m[1]}`;
    }
    if (!data.Valute || typeof data.Valute !== 'object') throw new Error('CBR: empty Valute');
    return { date, valute: data.Valute };
  } finally {
    clearTimeout(timer);
  }
}

/** Безопасный разбор простой формулы: USD, CNY, числа, + - * / ( ). */
export function evalRateFormula(formula: string, ratesToRub: Record<string, number>): number {
  const src = String(formula || '').trim();
  if (!src) throw new Error('formula empty');
  let expr = src.toUpperCase();
  for (const [code, rate] of Object.entries(ratesToRub)) {
    expr = expr.replace(new RegExp(`\\b${code}\\b`, 'g'), String(rate));
  }
  // Safe arithmetic: only digits / operators after code substitution
  if (!/^[\d.\s+\-*/()]+$/.test(expr)) {
    throw new Error('formula: только коды валют, числа и + - * / ( )');
  }
  const val = new Function(`"use strict"; return (${expr});`)() as number;
  if (!(Number.isFinite(val) && val > 0)) throw new Error('formula result invalid');
  return val;
}

function rebuildDerivedRates(rateDate: string, sourceTag: string) {
  const ratesMap: Record<string, number> = { RUB: 1 };
  for (const row of listCurrencies(false)) {
    if (row.code === 'RUB') continue;
    const latest = latestRateToRub(row.code);
    if (latest?.rate) ratesMap[row.code] = Number(latest.rate);
  }

  for (const row of listCurrencies(false)) {
    if (row.code === 'RUB') continue;
    if (row.rate_mode === 'linked') {
      const base = normCode(row.linked_code);
      const baseRate = ratesMap[base];
      if (!(baseRate > 0)) continue;
      const markup = Number(row.linked_markup_pct) || 0;
      const rate = baseRate * (1 + markup / 100);
      upsertRubPair({ code: row.code, rateToRub: rate, rate_date: rateDate, source: sourceTag });
      ratesMap[row.code] = rate;
    } else if (row.rate_mode === 'formula' && row.formula) {
      try {
        const rate = evalRateFormula(row.formula, ratesMap);
        upsertRubPair({
          code: row.code,
          rateToRub: rate,
          rate_date: rateDate,
          source: sourceTag,
        });
        ratesMap[row.code] = rate;
      } catch {
        /* skip bad formula */
      }
    }
  }
}

export async function syncRatesFromCbr(opts: { force?: boolean } = {}) {
  const { date, valute } = await fetchCbrDaily();
  if (!opts.force) {
    const already = get<{ c: number }>(
      `SELECT COUNT(*) AS c FROM currency_rates
       WHERE source = 'cbr' AND rate_date = ? AND quote_code = 'RUB'`,
      [date]
    )?.c;
    if (already && already > 0) {
      return {
        ok: true,
        cached: true,
        rate_date: date,
        updated: [] as string[],
        header: headerRates(),
        message: `Курсы ЦБ на ${date} уже загружены`,
      };
    }
  }

  // Убрать старые stub-сиды — иначе «сегодняшний» stub перекрывает ЦБ в шапке
  run(`DELETE FROM currency_rates WHERE source = 'stub'`);

  const internetCodes = listCurrencies(false)
    .filter((c) => c.rate_mode === 'internet' || c.code === 'USD' || c.code === 'CNY')
    .map((c) => c.code);
  const want = new Set(internetCodes.length ? internetCodes : ['USD', 'CNY']);
  // Always pull USD/CNY for header even if mode changed
  want.add('USD');
  want.add('CNY');

  const updated: { code: string; rate: number; name?: string }[] = [];
  for (const code of want) {
    if (code === 'RUB') continue;
    const v = valute[code];
    if (!v) continue;
    const nominal = Number(v.Nominal) || 1;
    const value = Number(v.Value);
    if (!(value > 0) || !(nominal > 0)) continue;
    const rateToRub = value / nominal;
    upsertRubPair({ code, rateToRub, rate_date: date, source: 'cbr' });
    updated.push({ code, rate: rateToRub, name: v.Name });
    // Keep numeric/name in sync for known CBR currencies
    const cur = getCurrency(code);
    if (cur) {
      run(
        `UPDATE currencies SET
          name = COALESCE(NULLIF(?, ''), name),
          numeric_code = COALESCE(NULLIF(?, ''), numeric_code),
          updated_at = datetime('now')
         WHERE code = ?`,
        [String(v.Name || ''), String(v.NumCode || ''), code]
      );
    }
  }

  rebuildDerivedRates(date, 'derived');

  return {
    ok: true,
    cached: false,
    rate_date: date,
    updated,
    header: headerRates(),
    source: CBR_DAILY_URL,
    message: `Загружено из ЦБ РФ: ${updated.map((u) => `${u.code}=${u.rate.toFixed(4)}`).join(', ') || 'нет совпадений'}`,
  };
}
