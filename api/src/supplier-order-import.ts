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

function num(v: unknown): number {
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  const s = String(v ?? '')
    .trim()
    .replace(/\s+/g, '')
    .replace(',', '.');
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
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
    const qty = num(cells[map.qty]);
    let price = num(cells[map.price]);
    const amountIdx = map.amount;
    if (!(price > 0) && amountIdx != null && amountIdx >= 0) {
      const amount = num(cells[amountIdx]);
      if (amount > 0 && qty > 0) price = Math.round((amount / qty) * 100) / 100;
    }
    const oldIdx = map.old_sku;
    const old_sku =
      oldIdx != null && oldIdx >= 0 ? String(cells[oldIdx] ?? '').trim() : '';
    out.push({ article, qty, price, old_sku });
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
    /^(арт|артикул|sku|article|код|code|part|pn|p\/n)$/i.test(h) ||
    /артикул|article|sku|part\s*no|part\s*number/.test(h)
  ) {
    return 'article';
  }
  if (
    /^(qty|кол|колич|количество|кол-во|шт|pcs|qnt|quantity)$/i.test(h) ||
    /количеств|quantity|^qty\b/.test(h)
  ) {
    return 'qty';
  }
  if (
    /^(цена|price|cost|закуп|закупочн)/i.test(h) ||
    /цена|price|unit\s*cost|закуп/.test(h)
  ) {
    if (/сумм|amount|total|итого/.test(h)) return 'amount';
    return 'price';
  }
  if (
    /^(сумма|amount|total|итого|сумма\s*ндс)$/i.test(h) ||
    /сумма|amount|total|итого/.test(h)
  ) {
    return 'amount';
  }
  if (/стар(ый|ые).*арт|old.*sku|кросс|cross|предыдущ/.test(h)) {
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
  const aoa = XLSX.utils.sheet_to_json<string[]>(wb.Sheets[sheet]!, {
    header: 1,
    defval: '',
    raw: false,
    blankrows: false,
  }) as unknown as string[][];
  const rows = (aoa || [])
    .map((r) => (Array.isArray(r) ? r : []).map((c) => String(c ?? '').trim()))
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
  const hasHeader = mode === 'headers' ? true : !!body.has_header;
  let map = body.map || DEFAULT_PACKING_MAP;
  if (mode === 'headers' && (!body.map || body.map.article == null)) {
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
} {
  const createMissing = opts?.create_missing !== false;
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
} {
  const orderId = String(input.order_id || '').trim();
  if (!orderId) throw new Error('order_id обязателен');
  const existing = getThinJournalDoc('supplier_orders', orderId);
  if (!existing) throw new Error('Заказ поставщику не найден');

  const preview = matchImportRows(input.rows, {
    create_missing: input.create_missing !== false,
    minimal_cards: !!input.minimal_cards,
  });
  if (preview.errors) {
    throw new Error(
      `Нельзя загрузить: ${preview.errors} строк с ошибками. Исправьте сопоставление.`
    );
  }

  const created_products: Array<{ sku: string; id: string; created: boolean }> = [];
  const lines: ThinOrderLineInput[] = [];

  for (const row of preview.rows) {
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

  const order = replaceThinSupplierOrderLines(orderId, lines, {
    append: !!input.append,
    allocate_marks: !!input.allocate_marks,
  });
  if (!order) throw new Error('Не удалось сохранить строки заказа');
  return { order, preview, created_products };
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
      const headers = (parsed.rows[0] || []).map((h, i) => h || `Кол. ${i + 1}`);
      const suggested = suggestMapFromHeaders(headers);
      const suggested_roles = headers.map((h) => guessHeaderRole(h));
      return c.json({
        ok: true,
        filename: fileName,
        sheets: parsed.sheets,
        sheet: parsed.sheet,
        headers,
        suggested_map: suggested,
        suggested_roles,
        row_count: Math.max(0, parsed.rows.length - 1),
        sample: parsed.rows.slice(0, 8),
        table: parsed.rows,
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
        create_missing: body.create_missing !== false,
        minimal_cards: !!body.minimal_cards,
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
        create_missing: body.create_missing !== false,
        minimal_cards: !!body.minimal_cards,
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
      });
    } catch (e) {
      return c.json({ error: e instanceof Error ? e.message : 'error' }, 400);
    }
  });
}
