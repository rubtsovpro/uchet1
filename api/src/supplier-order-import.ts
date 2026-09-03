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
  api.post('/purchases/supplier-orders/:id/import/preview', async (c) => {
    try {
      const body = (await c.req.json()) as {
        rows?: ImportSourceRow[];
        paste?: string;
        map?: ColumnMap;
        has_header?: boolean;
        create_missing?: boolean;
        minimal_cards?: boolean;
      };
      let rows = Array.isArray(body.rows) ? body.rows : [];
      if (!rows.length && body.paste) {
        const table = parsePasteTable(body.paste);
        rows = rowsFromTable(table, body.map || DEFAULT_PACKING_MAP, {
          has_header: !!body.has_header,
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
        map?: ColumnMap;
        has_header?: boolean;
        create_missing?: boolean;
        minimal_cards?: boolean;
        append?: boolean;
        allocate_marks?: boolean;
      };
      let rows = Array.isArray(body.rows) ? body.rows : [];
      if (!rows.length && body.paste) {
        const table = parsePasteTable(body.paste);
        rows = rowsFromTable(table, body.map || DEFAULT_PACKING_MAP, {
          has_header: !!body.has_header,
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
