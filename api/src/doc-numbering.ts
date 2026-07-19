/**
 * Нумерация документов в формате 1С УНФ:
 *   расход / УПД / СФ / заказ-наряд → 00НФ-003845
 *   приход → 00НФ-000314
 *   счёт на оплату → простое число (в OData счетов нет — задаётся вручную или из meta)
 */
import { get, run } from './db.js';
import { odataConfigFromEnv, type OdataConfig } from './odata.js';

const KEY_OUT = 'seq_00nf_out';
const KEY_IN = 'seq_00nf_in';
const KEY_INV = 'seq_invoice_num';
const KEY_SYNCED = 'doc_numbering_synced_at';

export type DocNumberingState = {
  last_out_1c: string | null;
  last_in_1c: string | null;
  next_out: string;
  next_in: string;
  next_invoice: string;
  seq_out: number;
  seq_in: number;
  seq_invoice: number;
  synced_at: string | null;
  note: string;
};

function metaGet(key: string): string | null {
  return get<{ value: string }>('SELECT value FROM meta WHERE key = ?', [key])?.value ?? null;
}

function metaSet(key: string, value: string): void {
  run('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)', [key, value]);
}

/** Извлекает хвост цифр: «00НФ-003845» → 3845, «90001» → 90001 */
export function parseTrailingNumber(raw: string): number | null {
  const s = String(raw || '').trim();
  if (!s) return null;
  const m = s.match(/(\d+)\s*$/);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

export function formatNfNumber(n: number, pad = 6): string {
  const num = Math.max(0, Math.floor(n));
  return `00НФ-${String(num).padStart(pad, '0')}`;
}

function readSeq(key: string, fallback: number): number {
  const raw = metaGet(key);
  if (raw == null || raw === '') return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

/** Последний занятый номер; следующий документ = +1. */
function bumpSeq(key: string, fallbackLast: number): number {
  run('BEGIN');
  try {
    const cur = readSeq(key, fallbackLast);
    const next = cur + 1;
    metaSet(key, String(next));
    run('COMMIT');
    return next;
  } catch (e) {
    try {
      run('ROLLBACK');
    } catch {
      /* ignore */
    }
    throw e;
  }
}

/**
 * Установить «последний занятый» номер (не следующий).
 * Например last=3845 → следующий будет 00НФ-003846.
 */
export function setLastOccupied(kind: 'out' | 'in' | 'invoice', lastOccupied: number): void {
  const n = Math.max(0, Math.floor(lastOccupied));
  if (kind === 'out') metaSet(KEY_OUT, String(n));
  else if (kind === 'in') metaSet(KEY_IN, String(n));
  else metaSet(KEY_INV, String(n));
}

export function nextInvoiceNumber(): string {
  // если ещё не синхронизировали — не стартуем с 90000
  const next = bumpSeq(KEY_INV, 0);
  return String(next);
}

export function nextOutNfNumber(): string {
  const next = bumpSeq(KEY_OUT, 0);
  return formatNfNumber(next);
}

export function nextInNfNumber(): string {
  const next = bumpSeq(KEY_IN, 0);
  return formatNfNumber(next);
}

export function getDocNumberingState(): DocNumberingState {
  const seqOut = readSeq(KEY_OUT, 0);
  const seqIn = readSeq(KEY_IN, 0);
  const seqInv = readSeq(KEY_INV, 0);
  const lastOut = metaGet('doc_numbering_last_out_1c');
  const lastIn = metaGet('doc_numbering_last_in_1c');
  return {
    last_out_1c: lastOut,
    last_in_1c: lastIn,
    seq_out: seqOut,
    seq_in: seqIn,
    seq_invoice: seqInv,
    next_out: formatNfNumber(seqOut + 1),
    next_in: formatNfNumber(seqIn + 1),
    next_invoice: String(seqInv + 1),
    synced_at: metaGet(KEY_SYNCED),
    note:
      'Счета в OData 1С не опубликованы — last_invoice задаётся вручную. УПД/СФ/ЗН — серия расходных 00НФ-.',
  };
}

async function odataGet(cfg: OdataConfig, pathAndQuery: string): Promise<unknown> {
  const url = cfg.baseUrl + pathAndQuery.replace(/^\//, '');
  const auth = Buffer.from(`${cfg.user}:${cfg.password}`).toString('base64');
  const res = await fetch(url, {
    headers: { Accept: 'application/json', Authorization: `Basic ${auth}` },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`OData HTTP ${res.status}: ${text.slice(0, 240)}`);
  }
  return res.json();
}

async function fetchLatestNumber(cfg: OdataConfig, entity: string): Promise<string | null> {
  const q =
    `${encodeURIComponent(entity)}?$format=json&$top=1` +
    `&$orderby=${encodeURIComponent('Date desc')}` +
    `&$select=${encodeURIComponent('Number,Date')}` +
    `&$filter=${encodeURIComponent('DeletionMark eq false')}`;
  const data = (await odataGet(cfg, q)) as { value?: Array<{ Number?: string }> };
  const num = data.value?.[0]?.Number;
  return num != null ? String(num) : null;
}

/**
 * Подтянуть последние номера из 1С (расходная / приходная накладная).
 * Счёт в публикации OData отсутствует.
 */
export async function syncDocNumberingFrom1c(): Promise<DocNumberingState> {
  const cfg = odataConfigFromEnv();
  if (!cfg) throw new Error('ODATA_* не заданы');

  const lastOut = await fetchLatestNumber(cfg, 'Document_РасходнаяНакладная');
  const lastIn = await fetchLatestNumber(cfg, 'Document_ПриходнаяНакладная');

  if (lastOut) {
    metaSet('doc_numbering_last_out_1c', lastOut);
    const n = parseTrailingNumber(lastOut);
    if (n != null) setLastOccupied('out', n);
  }
  if (lastIn) {
    metaSet('doc_numbering_last_in_1c', lastIn);
    const n = parseTrailingNumber(lastIn);
    if (n != null) setLastOccupied('in', n);
  }

  metaSet(KEY_SYNCED, new Date().toISOString());
  return getDocNumberingState();
}

export function applyDocNumberingPatch(patch: {
  last_out?: string | number;
  last_in?: string | number;
  last_invoice?: string | number;
}): DocNumberingState {
  if (patch.last_out != null && patch.last_out !== '') {
    const n =
      typeof patch.last_out === 'number'
        ? patch.last_out
        : parseTrailingNumber(String(patch.last_out));
    if (n == null) throw new Error('Некорректный last_out');
    setLastOccupied('out', n);
    metaSet('doc_numbering_last_out_1c', formatNfNumber(n));
  }
  if (patch.last_in != null && patch.last_in !== '') {
    const n =
      typeof patch.last_in === 'number'
        ? patch.last_in
        : parseTrailingNumber(String(patch.last_in));
    if (n == null) throw new Error('Некорректный last_in');
    setLastOccupied('in', n);
    metaSet('doc_numbering_last_in_1c', formatNfNumber(n));
  }
  if (patch.last_invoice != null && patch.last_invoice !== '') {
    const n =
      typeof patch.last_invoice === 'number'
        ? patch.last_invoice
        : parseTrailingNumber(String(patch.last_invoice));
    if (n == null) throw new Error('Некорректный last_invoice');
    setLastOccupied('invoice', n);
  }
  return getDocNumberingState();
}
