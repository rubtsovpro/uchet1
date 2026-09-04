/**
 * Импорт строк в заказ поставщику (копипаст / Excel-таблица).
 */
import type { Hono } from 'hono';
import {
  cloneProductFrom,
  ensureOldSkuOnCard,
  findProductByAnySku,
  normalizeImportSku,
} from './product-clone.js';
import {
  getThinJournalDoc,
  replaceThinSupplierOrderLines,
  type ThinOrderLineInput,
} from './parity-batch-a.js';

export type ImportSourceRow = {
  article?: string;
  sku?: string;
  qty?: number | string;
  price?: number | string;
  amount?: number | string;
  old_sku?: string;
  old?: string;
  name?: string;
};

export type MatchedImportRow = {
  row: number;
  source_article: string;
  article: string;
  normalized_from?: string;
  qty: number;
  price: number;
  old_sku: string;
  name: string;
  product_id: string | null;
  product_name: string | null;
  status: 'matched' | 'will_create' | 'error';
  error?: string;
  create_from_sku?: string;
};

/**
 * Числа из Excel/пакинга: пробелы/NBSP как тысячи, `1.250` / `1,250` = 1250,
 * `1.250,50` / `1,250.50` = 1250.5. Раньше `1.250` → 1.25 и сумма заказа «схлопывалась».
 */
export function parseImportNumber(v: unknown): number {
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  let s = String(v ?? '')
    .trim()
    .replace(/[\u00A0\u202F\u2009\u2007]/g, ' ')
    .replace(/\s+/g, '')
    .replace(/[₽$€]/g, '')
    .replace(/руб\.?/gi, '');
  if (!s) return 0;
  const neg = s.startsWith('-') || s.startsWith('(');
  s = s.replace(/^[-(]+|[)]+$/g, '');
  if (!s) return 0;

  const lastComma = s.lastIndexOf(',');
  const lastDot = s.lastIndexOf('.');
  if (lastComma >= 0 && lastDot >= 0) {
    // Последний разделитель — десятичный, остальные тысячи.
    if (lastComma > lastDot) {
      s = s.replace(/\./g, '').replace(',', '.');
    } else {
      s = s.replace(/,/g, '');
    }
  } else if (lastComma >= 0) {
    const frac = s.slice(lastComma + 1);
    if (/^\d{3}$/.test(frac) && s.indexOf(',') === lastComma) {
      s = s.replace(/,/g, ''); // 1,250 → 1250
    } else {
      s = s.replace(/,/g, '.');
    }
  } else if (lastDot >= 0) {
    const frac = s.slice(lastDot + 1);
    const dots = (s.match(/\./g) || []).length;
    if (dots > 1) {
      s = s.replace(/\./g, ''); // 1.250.000
    } else if (/^\d{3}$/.test(frac)) {
      s = s.replace(/\./g, ''); // 1.250 → 1250 (разрядность, не копейки)
    }
  }

  const n = Number(s);
  if (!Number.isFinite(n)) return 0;
  return neg ? -Math.abs(n) : n;
}

function num(v: unknown): number {
  return parseImportNumber(v);
}

/** Парсинг TSV/CSV из буфера (вставка из Excel). */
export function parsePasteTable(text: string): string[][] {
  const raw = String(text || '').replace(/^\uFEFF/, '');
  if (!raw.trim()) return [];
  const lines = raw.split(/\r?\n/).filter((l) => l.trim().length);
  return lines.map((line) => {
    if (line.includes('\t')) return line.split('\t').map((c) => c.trim());
    const cells: string[] = [];
    let cur = '';
    let inQ = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQ && line[i + 1] === '"') {
          cur += '"';
          i++;
        } else inQ = !inQ;
        continue;
      }
      if (ch === ',' && !inQ) {
        cells.push(cur.trim());
        cur = '';
        continue;
      }
      cur += ch;
    }
    cells.push(cur.trim());
    return cells;
  });
}

export type ColumnMap = {
  article: number;
  qty: number;
  price: number;
  amount?: number | null;
  old_sku?: number | null;
};

export const DEFAULT_PACKING_MAP: ColumnMap = {
  article: 0,
  qty: 1,
  price: 2,
  amount: 3,
  old_sku: null,
};

/** Первая строка похожа на заголовок (Артикул/Кол-во/Цена), а не на данные. */
export function tableLooksLikeHeader(row: string[] | undefined): boolean {
  if (!row?.length) return false;
  let hits = 0;
  for (const cell of row) {
    const role = guessHeaderRole(String(cell ?? ''));
    if (role === 'article' || role === 'qty' || role === 'price' || role === 'amount') {
      hits++;
    }
  }
  return hits >= 1;
}

export function rowsFromTable(
  table: string[][],
  map: ColumnMap,
  opts?: { has_header?: boolean }
): ImportSourceRow[] {
  const start = opts?.has_header ? 1 : 0;
  const out: ImportSourceRow[] = [];
  for (let i = start; i < table.length; i++) {
    const cells = table[i] || [];
    const article = String(cells[map.article] ?? '').trim();
    if (!article) continue;
    // Строка-заголовок внутри данных (повтор шапки) — пропуск
    if (guessHeaderRole(article) === 'article' && /^(арт|артикул|sku|article)$/i.test(article)) {
      continue;
    }
    const qty = num(cells[map.qty]);
    let price = num(cells[map.price]);
    const amountIdx = map.amount;
    if (amountIdx != null && amountIdx >= 0) {
      const amount = num(cells[amountIdx]);
      if (amount > 0 && qty > 0) {
        const fromAmount = Math.round((amount / qty) * 100) / 100;
        // Если цена пустая/нулевая — берём из суммы; если цена есть, но сумма
        // сильно больше (часто цена битая из-за разрядности) — доверяем сумме.
        if (!(price > 0)) {
          price = fromAmount;
        } else if (amount > price * qty * 1.5 + 1) {
          price = fromAmount;
        }
      }
    }
    const oldIdx = map.old_sku;
    const old_sku =
      oldIdx != null && oldIdx >= 0 ? String(cells[oldIdx] ?? '').trim() : '';
    out.push({ article, qty, price, amount: amountIdx != null ? num(cells[amountIdx]) : undefined, old_sku });
  }
  return out;
}

function normHeaderKey(s: string): string {
  return String(s || '')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/["']/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Угадать роль колонки по тексту заголовка Excel/CSV. */
export function guessHeaderRole(
  header: string
): 'article' | 'qty' | 'price' | 'amount' | 'old_sku' | 'skip' {
  const h = normHeaderKey(header);
  if (!h) return 'skip';
  if (
    /^(арт|артикул|sku|article|код|code|part|pn|p\/n|oem|арт\.|art)$/i.test(h) ||
    /артикул|article|part\s*no|part\s*number|part\s*#|номер\s*дет|номенклатур/.test(h) ||
    (/\bsku\b/.test(h) && !/old|стар/.test(h))
  ) {
    return 'article';
  }
  if (
    /^(qty|кол|колич|количество|кол-во|колво|шт|pcs|qnt|quantity|qty\.)$/i.test(h) ||
    /количеств|quantity|^qty\b|число\s*шт/.test(h)
  ) {
    return 'qty';
  }
  if (
    /^(сумма|amount|total|итого|сумма\s*ндс|line\s*total|сумма\s*строк)/i.test(h) ||
    /сумма|amount|total|итого|line\s*total/.test(h)
  ) {
    return 'amount';
  }
  if (
    /^(цена|price|cost|закуп|закупочн|цена\s*ед|unit\s*price|unit\s*cost)/i.test(h) ||
    /цена|price|unit\s*cost|закуп|cost/.test(h)
  ) {
    return 'price';
  }
  if (/стар(ый|ые).*арт|old.*sku|кросс|cross|предыдущ|oem\s*старый/.test(h)) {
    return 'old_sku';
  }
  return 'skip';
}

export function suggestMapFromHeaders(headers: string[]): ColumnMap {
  const map: ColumnMap = { ...DEFAULT_PACKING_MAP, amount: null, old_sku: null };
  const seen = new Set<string>();
  headers.forEach((h, i) => {
    const role = guessHeaderRole(h);
    if (role === 'skip' || seen.has(role)) return;
    seen.add(role);
    if (role === 'article') map.article = i;
    else if (role === 'qty') map.qty = i;
    else if (role === 'price') map.price = i;
    else if (role === 'amount') map.amount = i;
    else if (role === 'old_sku') map.old_sku = i;
  });
  return map;
}

/** Разобрать .xlsx / .xls / .csv / .txt в таблицу строк. */
export async function parseImportSpreadsheet(
  buf: Buffer,
  fileName: string,
  sheetName?: string
): Promise<{ sheets: string[]; sheet: string; rows: string[][] }> {
  const lower = String(fileName || '').toLowerCase();
  if (lower.endsWith('.csv') || lower.endsWith('.txt')) {
    const text = buf.toString('utf8').replace(/^\uFEFF/, '');
    const rows = parsePasteTable(text.includes('\t') ? text : text.replace(/;/g, '\t'));
    // CSV с запятыми — если нет табов, разберём через xlsx/csv fallback
    if (!text.includes('\t') && text.includes(',')) {
      const XLSX = await import('xlsx');
      const wb = XLSX.read(buf, { type: 'buffer', raw: false });
      const sheet = (wb.SheetNames || [])[0] || 'CSV';
      const aoa = XLSX.utils.sheet_to_json<string[]>(wb.Sheets[sheet]!, {
        header: 1,
        defval: '',
        raw: false,
      }) as unknown as string[][];
      const csvRows = (aoa || []).map((r) =>
        (Array.isArray(r) ? r : []).map((c) => String(c ?? '').trim())
      );
      return { sheets: [sheet], sheet, rows: csvRows };
    }
    return { sheets: ['CSV'], sheet: 'CSV', rows };
  }
  const XLSX = await import('xlsx');
  const wb = XLSX.read(buf, { type: 'buffer', cellDates: true, raw: false });
  const sheets = wb.SheetNames || [];
  if (!sheets.length) throw new Error('В файле нет листов');
  const sheet = sheetName && sheets.includes(sheetName) ? sheetName : sheets[0]!;
  const aoa = XLSX.utils.sheet_to_json<(string | number | boolean | null)[]>(wb.Sheets[sheet]!, {
    header: 1,
    defval: '',
    raw: true,
    blankrows: false,
  }) as unknown as (string | number | boolean | null)[][];
  const rows = (aoa || [])
    .map((r) =>
      (Array.isArray(r) ? r : []).map((c) => {
        if (typeof c === 'number' && Number.isFinite(c)) return String(c);
        return String(c ?? '').trim();
      })
    )
    .filter((r) => r.some((c) => c));
  return { sheets, sheet, rows };
}

function resolveImportRows(body: {
  rows?: ImportSourceRow[];
  paste?: string;
  table?: string[][];
  map?: ColumnMap;
  has_header?: boolean;
  map_mode?: 'columns' | 'headers';
}): ImportSourceRow[] {
  if (Array.isArray(body.rows) && body.rows.length) return body.rows;
  let table: string[][] = Array.isArray(body.table) ? body.table : [];
  if (!table.length && body.paste) table = parsePasteTable(body.paste);
  if (!table.length) return [];
  const mode = body.map_mode === 'headers' ? 'headers' : 'columns';
  let hasHeader: boolean;
  if (mode === 'headers') {
    // Жёлтый диапазон без шапки: не выкидываем первую строку данных.
    hasHeader = tableLooksLikeHeader(table[0]);
  } else if (body.has_header == null) {
    hasHeader = tableLooksLikeHeader(table[0]);
  } else {
    hasHeader = !!body.has_header;
  }
  let map = body.map || DEFAULT_PACKING_MAP;
  if (mode === 'headers' && hasHeader && (!body.map || body.map.article == null)) {
    map = suggestMapFromHeaders(table[0] || []);
  }
  return rowsFromTable(table, map, { has_header: hasHeader });
}

export function matchImportRows(
  rows: ImportSourceRow[],
  opts?: { create_missing?: boolean; minimal_cards?: boolean }
): {
  rows: MatchedImportRow[];
  received: number;
  matched: number;
  will_create: number;
  errors: number;
  total_sum: number;
} {
  const createMissing = !!opts?.create_missing;
  const matchedRows: MatchedImportRow[] = [];
  let matched = 0;
  let willCreate = 0;
  let errors = 0;

  rows.forEach((src, idx) => {
    const rawArt = String(src.article || src.sku || '').trim();
    const { sku, normalized_from } = normalizeImportSku(rawArt);
    const qty = num(src.qty);
    let price = num(src.price);
    const amount = num(src.amount);
    if (!(price > 0) && amount > 0 && qty > 0) {
      price = Math.round((amount / qty) * 100) / 100;
    } else if (price > 0 && amount > 0 && qty > 0 && amount > price * qty * 1.5 + 1) {
      price = Math.round((amount / qty) * 100) / 100;
    }
    const oldRaw = String(src.old_sku || src.old || '').trim();
    const oldNorm = oldRaw ? normalizeImportSku(oldRaw).sku : '';

    const base: MatchedImportRow = {
      row: idx + 1,
      source_article: rawArt,
      article: sku,
      normalized_from,
      qty,
      price,
      old_sku: oldNorm,
      name: String(src.name || '').trim(),
      product_id: null,
      product_name: null,
      status: 'error',
    };

    if (!sku) {
      errors++;
      matchedRows.push({ ...base, error: 'Пустой артикул' });
      return;
    }
    if (!(qty > 0)) {
      errors++;
      matchedRows.push({ ...base, error: 'Количество должно быть > 0' });
      return;
    }

    let hit = findProductByAnySku(sku);
    if (!hit && normalized_from) hit = findProductByAnySku(normalized_from);
    if (hit) {
      matched++;
      matchedRows.push({
        ...base,
        product_id: hit.id,
        product_name: hit.name,
        name: hit.name,
        status: 'matched',
      });
      return;
    }

    if (!createMissing) {
      errors++;
      matchedRows.push({ ...base, error: 'Не найден в номенклатуре' });
      return;
    }

    const fromSku = oldNorm || undefined;
    willCreate++;
    matchedRows.push({
      ...base,
      status: 'will_create',
      create_from_sku: fromSku,
      name:
        base.name ||
        (fromSku ? findProductByAnySku(fromSku)?.name || sku : sku),
    });
  });

  return {
    rows: matchedRows,
    received: matchedRows.length,
    matched,
    will_create: willCreate,
    errors,
    total_sum: matchedRows.reduce((s, r) => s + (r.qty > 0 && r.price > 0 ? r.qty * r.price : 0), 0),
  };
}

export function applyImportToSupplierOrder(input: {
  order_id: string;
  rows: ImportSourceRow[];
  create_missing?: boolean;
  minimal_cards?: boolean;
  append?: boolean;
  allocate_marks?: boolean;
}): {
  order: NonNullable<ReturnType<typeof getThinJournalDoc>>;
  preview: ReturnType<typeof matchImportRows>;
  created_products: Array<{ sku: string; id: string; created: boolean }>;
  skipped_unmatched: Array<{ article: string; error?: string }>;
} {
  const orderId = String(input.order_id || '').trim();
  if (!orderId) throw new Error('order_id обязателен');
  const existing = getThinJournalDoc('supplier_orders', orderId);
  if (!existing) throw new Error('Заказ поставщику не найден');

  const preview = matchImportRows(input.rows, {
    create_missing: !!input.create_missing,
    minimal_cards: !!input.minimal_cards,
  });

  const usable = preview.rows.filter((r) => r.status === 'matched' || r.status === 'will_create');
  const skipped = preview.rows.filter((r) => r.status === 'error');

  const created_products: Array<{ sku: string; id: string; created: boolean }> = [];
  const lines: ThinOrderLineInput[] = [];

  for (const row of usable) {
    let productId = row.product_id;
    let name = row.product_name || row.name || row.article;
    if (!productId && row.status === 'will_create') {
      const r = cloneProductFrom({
        new_sku: row.article,
        from_sku: row.create_from_sku,
        old_sku: row.old_sku || row.create_from_sku,
        minimal: !!input.minimal_cards || !row.create_from_sku,
      });
      productId = r.product.id;
      name = r.product.name;
      created_products.push({ sku: r.product.sku, id: r.product.id, created: r.created });
    } else if (productId && row.old_sku) {
      ensureOldSkuOnCard(productId, row.old_sku);
    }
    if (!productId) throw new Error(`Нет product_id для ${row.article}`);
    lines.push({
      product_id: productId,
      qty: row.qty,
      price: row.price,
      article: row.article,
      name,
      old_sku: row.old_sku || undefined,
    });
  }

  // Не найденные артикулы — тоже в черновик (без product_id), чтобы видеть и блокировать проведение
  for (const row of skipped) {
    if (!(row.qty > 0) || !String(row.article || '').trim()) continue;
    lines.push({
      product_id: '',
      qty: row.qty,
      price: row.price,
      article: row.article || row.source_article,
      name: `Не найден: ${row.article || row.source_article}`,
      old_sku: row.old_sku || undefined,
    });
  }

  if (!lines.length) {
    throw new Error(
      skipped.length
        ? `Ни одного артикула не удалось разобрать (${skipped.length} стр.). Заказ остаётся черновиком.`
        : 'Нет строк для загрузки'
    );
  }

  const order = replaceThinSupplierOrderLines(orderId, lines, {
    append: !!input.append,
    allocate_marks: !!input.allocate_marks,
  });
  if (!order) throw new Error('Не удалось сохранить строки заказа');
  return {
    order,
    preview,
    created_products,
    skipped_unmatched: skipped.map((r) => ({
      article: r.article || r.source_article || '',
      error: r.error,
    })),
  };
}

export function mountSupplierOrderImportRoutes(api: Hono): void {
  /** Разобрать Excel/CSV → заголовки + превью + предложенный map. */
  api.post('/purchases/supplier-orders/:id/import/parse-file', async (c) => {
    try {
      const body = (await c.req.json()) as {
        filename?: string;
        content_base64?: string;
        sheet?: string;
      };
      const b64 = String(body.content_base64 || '').trim();
      if (!b64) return c.json({ error: 'Нужен content_base64' }, 400);
      const fileName = String(body.filename || 'packing.xlsx').slice(0, 180);
      const buf = Buffer.from(b64, 'base64');
      if (!buf.length) return c.json({ error: 'Пустой файл' }, 400);
      if (buf.length > 15 * 1024 * 1024) {
        return c.json({ error: 'Файл больше 15 МБ' }, 400);
      }
      const parsed = await parseImportSpreadsheet(buf, fileName, body.sheet);
      const hasHdr = tableLooksLikeHeader(parsed.rows[0]);
      const headers = hasHdr
        ? (parsed.rows[0] || []).map((h, i) => h || `Кол. ${i + 1}`)
        : (parsed.rows[0] || []).map((_, i) => `Кол. ${i + 1}`);
      const suggested = hasHdr
        ? suggestMapFromHeaders(parsed.rows[0] || [])
        : { ...DEFAULT_PACKING_MAP };
      const suggested_roles = hasHdr
        ? headers.map((h) => guessHeaderRole(h))
        : headers.map(() => 'skip' as const);
      return c.json({
        ok: true,
        filename: fileName,
        sheets: parsed.sheets,
        sheet: parsed.sheet,
        headers,
        suggested_map: suggested,
        suggested_roles,
        has_header: hasHdr,
        table: parsed.rows,
        row_count: parsed.rows.length,
        preview_rows: parsed.rows.slice(0, 8),
        sample: parsed.rows.slice(0, 8),
      });
    } catch (e) {
      return c.json({ error: e instanceof Error ? e.message : 'parse error' }, 400);
    }
  });

  api.post('/purchases/supplier-orders/:id/import/preview', async (c) => {
    try {
      const body = (await c.req.json()) as {
        rows?: ImportSourceRow[];
        paste?: string;
        table?: string[][];
        map?: ColumnMap;
        has_header?: boolean;
        map_mode?: 'columns' | 'headers';
        create_missing?: boolean;
        minimal_cards?: boolean;
        filename?: string;
        content_base64?: string;
        sheet?: string;
      };
      let rows = resolveImportRows(body);
      if (!rows.length && body.content_base64) {
        const parsed = await parseImportSpreadsheet(
          Buffer.from(body.content_base64, 'base64'),
          String(body.filename || 'packing.xlsx'),
          body.sheet
        );
        rows = resolveImportRows({
          ...body,
          table: parsed.rows,
          has_header: body.map_mode === 'headers' ? true : !!body.has_header,
        });
      }
      const preview = matchImportRows(rows, {
        create_missing: false,
        minimal_cards: false,
      });
      return c.json({
        ok: true,
        ...preview,
        will_create_count: preview.will_create,
        impossible_count: preview.errors,
      });
    } catch (e) {
      return c.json({ error: e instanceof Error ? e.message : 'error' }, 400);
    }
  });

  api.post('/purchases/supplier-orders/:id/import/apply', async (c) => {
    try {
      const id = c.req.param('id');
      const body = (await c.req.json()) as {
        rows?: ImportSourceRow[];
        paste?: string;
        table?: string[][];
        map?: ColumnMap;
        has_header?: boolean;
        map_mode?: 'columns' | 'headers';
        create_missing?: boolean;
        minimal_cards?: boolean;
        append?: boolean;
        allocate_marks?: boolean;
        filename?: string;
        content_base64?: string;
        sheet?: string;
      };
      let rows = resolveImportRows(body);
      if (!rows.length && body.content_base64) {
        const parsed = await parseImportSpreadsheet(
          Buffer.from(body.content_base64, 'base64'),
          String(body.filename || 'packing.xlsx'),
          body.sheet
        );
        rows = resolveImportRows({
          ...body,
          table: parsed.rows,
          has_header: body.map_mode === 'headers' ? true : !!body.has_header,
        });
      }
      if (!rows.length) return c.json({ error: 'Нет строк для загрузки' }, 400);
      const r = applyImportToSupplierOrder({
        order_id: id,
        rows,
        // Из заказа поставщику номенклатуру не создаём — только существующие артикулы.
        create_missing: false,
        minimal_cards: false,
        append: !!body.append,
        allocate_marks: !!body.allocate_marks,
      });
      return c.json({
        ok: true,
        order: r.order,
        created_products: r.created_products,
        received: r.preview.received,
        matched: r.preview.matched,
        created: r.created_products.filter((x) => x.created).length,
        skipped_unmatched: r.skipped_unmatched,
        skipped_count: r.skipped_unmatched.length,
        status: 'draft',
      });
    } catch (e) {
      return c.json({ error: e instanceof Error ? e.message : 'error' }, 400);
    }
  });
}
