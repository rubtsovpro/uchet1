/**
 * Нумерация:
 *   новые из заказа (Amo): СФ{сделка}, УПД{сделка}, Р{сделка}, Д{сделка},
 *     Сч{сделка}, ЗН = номер сделки (= заказ покупателя);
 *   синк/старое из 1С УНФ: 00НФ-… / счета meta.
 */
import { all, get, run } from './db.js';
import { odataConfigFromEnv, type OdataConfig } from './odata.js';

/** Префикс + номер сделки; при коллизии — «-2», «-3»… */
export function numberFromDeal(
  prefix: string,
  dealId: string,
  isTaken: (number: string) => boolean
): string {
  const deal = String(dealId || '')
    .trim()
    .replace(/\s+/g, '');
  if (!deal) throw new Error('Нет номера сделки для нумерации документа');
  const base = `${prefix}${deal}`;
  if (!isTaken(base)) return base;
  for (let i = 2; i < 1000; i++) {
    const n = `${base}-${i}`;
    if (!isTaken(n)) return n;
  }
  throw new Error(`Не удалось выделить номер ${prefix}${deal}`);
}

/** Префиксы документов продажи, привязанных к заказу. */
export const DEAL_SALES_PREFIX: Record<string, string> = {
  sf: 'СФ',
  upd: 'УПД',
  contract: 'Д',
  invoice: 'Сч',
  /** Как заказ покупателя — сам номер сделки (без «ЗН»). */
  workorder: '',
};

export function salesNumberFromDeal(docType: string, dealId: string): string {
  if (!(docType in DEAL_SALES_PREFIX)) throw new Error(`Нет префикса для типа ${docType}`);
  const prefix = DEAL_SALES_PREFIX[docType] ?? '';
  return numberFromDeal(prefix, dealId, (n) =>
    Boolean(get('SELECT id FROM sales_docs WHERE number = ? LIMIT 1', [n]))
  );
}

/** Номер заказа покупателя / печати ЗН — id сделки (без префикса «ЗН»). */
export function customerOrderNumberFromDeal(dealId: string): string {
  return String(dealId || '')
    .trim()
    .replace(/\s+/g, '');
}

/** Для печати: «ЗН25527663» → «25527663»; иначе как есть. */
export function workorderPrintNumber(
  dealId: string | null | undefined,
  salesNumber?: string | null
): string {
  const deal = customerOrderNumberFromDeal(String(dealId || ''));
  if (deal) return deal;
  const raw = String(salesNumber || '').trim();
  const m = raw.match(/^ЗН(.+)$/i);
  return m ? m[1] : raw;
}

/** Расходная по заказу: Р{сделка}. */
export function outNumberFromDeal(dealId: string): string {
  return numberFromDeal('Р', dealId, (n) =>
    Boolean(get('SELECT id FROM stock_docs WHERE number = ? LIMIT 1', [n]))
  );
}

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

const KEY_CONTRACT = 'doc_seq_contract';

/** ИНН Безматерных М.П. — Стрела + Фогель одна серия УПД. */
const UPD_INN_KRD = '231295963240';
/** ИНН Безматерных Р.П. — Пневмоподвеска · Москва. */
const UPD_INN_MSK = '231215603728';
/** Последний занятый № до WMS: следующий УПД = +1 (Москва → 255, Краснодар → 90). */
const UPD_LAST_BEFORE_SERIES: Record<string, number> = {
  [UPD_INN_MSK]: 254,
  [UPD_INN_KRD]: 89,
};

function updSeqKeyForInn(inn: string): string {
  const d = String(inn || '').replace(/\D/g, '');
  return d ? `doc_seq_upd_inn_${d}` : 'doc_seq_upd_default';
}

function updFallbackLast(inn: string): number {
  return UPD_LAST_BEFORE_SERIES[inn] ?? 0;
}

/** Максимальный чисто числовой № УПД по ИНН продавца (на случай рассинхрона meta). */
function maxOrdinalUpdNumberForInn(inn: string): number {
  const digits = String(inn || '').replace(/\D/g, '');
  if (!digits) return 0;
  const rows = all<{ number: string }>(
    `SELECT s.number FROM sales_docs s
     JOIN organizations o ON o.id = s.organization_id
     WHERE s.doc_type = 'upd' AND REPLACE(IFNULL(o.inn,''),' ','') = ?`,
    [digits]
  );
  let max = 0;
  for (const row of rows) {
    const n = String(row.number || '').trim();
    if (/^\d+$/.test(n)) max = Math.max(max, Number(n));
  }
  return max;
}

/** Установить «последний занятый» порядковый № УПД по ИНН (не следующий). */
export function setLastOccupiedUpd(inn: string, lastOccupied: number): void {
  const digits = String(inn || '').replace(/\D/g, '');
  if (!digits) throw new Error('Некорректный ИНН для УПД');
  const n = Math.max(0, Math.floor(lastOccupied));
  metaSet(updSeqKeyForInn(digits), String(n));
}

function ordinalUpdLastForOrg(organizationId: string): { inn: string; last: number } {
  const orgId = String(organizationId || '').trim();
  let inn = '';
  if (orgId) {
    inn = String(
      get<{ inn: string }>(`SELECT IFNULL(inn,'') AS inn FROM organizations WHERE id = ?`, [orgId])
        ?.inn || ''
    ).replace(/\D/g, '');
  }
  if (!inn) inn = UPD_INN_MSK;
  const key = updSeqKeyForInn(inn);
  const cur = readSeq(key, updFallbackLast(inn));
  const maxDoc = maxOrdinalUpdNumberForInn(inn);
  return { inn, last: Math.max(cur, maxDoc) };
}

/** Следующий № УПД без резервирования (для подсказки в форме). */
export function peekNextOrdinalUpdNumber(organizationId: string): string {
  const { last } = ordinalUpdLastForOrg(organizationId);
  return String(last + 1);
}

/** Последний занятый порядковый № УПД по ИНН продавца (не привязка к сделке). */
export function nextOrdinalUpdNumber(organizationId: string): string {
  const { inn, last } = ordinalUpdLastForOrg(organizationId);
  const key = updSeqKeyForInn(inn);
  run('BEGIN');
  try {
    const next = last + 1;
    metaSet(key, String(next));
    run('COMMIT');
    return String(next);
  } catch (e) {
    try {
      run('ROLLBACK');
    } catch {
      /* ignore */
    }
    throw e;
  }
}

/** Договоры с контрагентами: ДГ-00001 */
export function nextContractNumber(): string {
  const next = bumpSeq(KEY_CONTRACT, 0);
  return `ДГ-${String(next).padStart(5, '0')}`;
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
  const lastInv1c = metaGet('doc_numbering_last_invoice_1c');
  const invNote = metaGet('doc_numbering_invoice_note');
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
      invNote ||
      (lastInv1c
        ? `Последний счёт из 1С: ${lastInv1c}. УПД/СФ/ЗН — серия расходных 00НФ-.`
        : 'Счета в OData 1С не опубликованы — укажите последний № счёта из 1С вручную (или опубликуйте Document_СчетНаОплату). УПД/СФ/ЗН — серия 00НФ-.'),
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
 * Подтянуть последние номера из 1С (расходная / приходная / счёт на оплату, если опубликован).
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

  // Счёт на оплату часто не опубликован в OData — пробуем типовые имена УНФ.
  const invoiceCandidates = [
    'Document_СчетНаОплату',
    'Document_СчётНаОплату',
    'Document_СчетНаОплатуПокупателю',
  ];
  let lastInv: string | null = null;
  let invoiceErr = '';
  for (const entity of invoiceCandidates) {
    try {
      lastInv = await fetchLatestNumber(cfg, entity);
      if (lastInv) {
        metaSet('doc_numbering_last_invoice_1c', lastInv);
        metaSet('doc_numbering_invoice_entity', entity);
        const n = parseTrailingNumber(lastInv);
        if (n != null) setLastOccupied('invoice', n);
        break;
      }
    } catch (e) {
      invoiceErr = e instanceof Error ? e.message : String(e);
    }
  }
  if (!lastInv) {
    metaSet(
      'doc_numbering_invoice_note',
      invoiceErr
        ? `Счёт в OData недоступен (${invoiceErr.slice(0, 120)}). Задайте last_invoice вручную или опубликуйте Document_СчетНаОплату.`
        : 'Счёт в OData не опубликован. Задайте последний № счёта из 1С вручную или опубликуйте Document_СчетНаОплату.'
    );
  } else {
    metaSet('doc_numbering_invoice_note', `Счёт подтянут из ${metaGet('doc_numbering_invoice_entity') || '1С'}: ${lastInv}`);
  }

  metaSet(KEY_SYNCED, new Date().toISOString());
  return getDocNumberingState();
}

export function applyDocNumberingPatch(patch: {
  last_out?: string | number;
  last_in?: string | number;
  last_invoice?: string | number;
  last_upd_msk?: string | number;
  last_upd_krd?: string | number;
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
    const raw = String(patch.last_invoice).trim();
    const n =
      typeof patch.last_invoice === 'number'
        ? patch.last_invoice
        : parseTrailingNumber(raw);
    if (n == null) throw new Error('Некорректный last_invoice');
    setLastOccupied('invoice', n);
    metaSet('doc_numbering_last_invoice_1c', raw || String(n));
    metaSet('doc_numbering_invoice_note', `Последний счёт задан вручную: ${raw || n}`);
  }
  if (patch.last_upd_msk != null && patch.last_upd_msk !== '') {
    const n =
      typeof patch.last_upd_msk === 'number'
        ? patch.last_upd_msk
        : parseTrailingNumber(String(patch.last_upd_msk));
    if (n == null) throw new Error('Некорректный last_upd_msk');
    setLastOccupiedUpd(UPD_INN_MSK, n);
  }
  if (patch.last_upd_krd != null && patch.last_upd_krd !== '') {
    const n =
      typeof patch.last_upd_krd === 'number'
        ? patch.last_upd_krd
        : parseTrailingNumber(String(patch.last_upd_krd));
    if (n == null) throw new Error('Некорректный last_upd_krd');
    setLastOccupiedUpd(UPD_INN_KRD, n);
  }
  return getDocNumberingState();
}
