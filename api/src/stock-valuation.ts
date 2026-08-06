/**
 * Оценка остатков по ценам приходных (FIFO-слои).
 * Остаток покрывается с последних приходов назад: старые закупки считаются списанными первыми.
 * Не себестоимость 1С; нет привязки партии к конкретной УПД/расходной.
 */
import { all, get } from './db.js';

export const VALUATION_METHOD = 'fifo_inbound' as const;

export const VALUATION_METHOD_NOTE =
  'FIFO по приходам: остаток оценён по ценам приходных накладных (сначала последние закупки — старые ушли в расход). Не себестоимость 1С.';

export type InboundLayerRow = {
  doc_id: string;
  doc_number: string;
  doc_date: string;
  counterparty: string | null;
  counterparty_id: string | null;
  warehouse: string | null;
  warehouse_id: string | null;
  line_id: string;
  line_qty: number;
  price: number;
  line_amount: number;
};

export type FifoLayer = {
  doc_id: string;
  doc_number: string;
  doc_date: string;
  counterparty: string | null;
  counterparty_id: string | null;
  warehouse: string | null;
  warehouse_id: string | null;
  price: number;
  qty: number;
  amount: number;
  line_qty: number;
};

export type FifoCoverResult = {
  qty: number;
  value: number;
  unit_cost: number | null;
  last_price: number | null;
  last_doc_date: string | null;
  last_doc_number: string | null;
  qty_priced: number;
  qty_unpriced: number;
  has_price: boolean;
  layers: FifoLayer[];
  /** qty × последняя цена прихода (для сравнения со старым методом) */
  last_purchase_value: number;
};

function roundMoney(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Краткий FIFO (дашборд / суммы складов) — тяжёлый проход по остаткам+приходам; кэш 45с. */
const SUMMARY_CACHE_MS = 45_000;
let summaryCache: { at: number; key: string; value: unknown } | null = null;

export function invalidateStockValuationCache(): void {
  summaryCache = null;
}

function summaryCacheKey(opts: {
  warehouseId?: string;
  q?: string;
  page?: number;
  limit?: number;
  includeItems?: boolean;
}): string | null {
  const includeItems = opts.includeItems !== false;
  if (includeItems) return null;
  if (opts.warehouseId || opts.q?.trim()) return null;
  return `summary|p${opts.page || 1}|l${opts.limit || 1}`;
}

/** Покрыть needQty слоями приходов (newest first = FIFO остаток). */
export function fifoCover(needQty: number, inboundNewestFirst: InboundLayerRow[]): FifoCoverResult {
  const need = Number(needQty) || 0;
  if (!(need > 0)) {
    return {
      qty: need,
      value: 0,
      unit_cost: null,
      last_price: null,
      last_doc_date: null,
      last_doc_number: null,
      qty_priced: 0,
      qty_unpriced: 0,
      has_price: false,
      layers: [],
      last_purchase_value: 0,
    };
  }

  const last = inboundNewestFirst[0] || null;
  const lastPrice = last && last.price > 0 ? Number(last.price) : null;

  let remaining = need;
  let value = 0;
  const layers: FifoLayer[] = [];

  for (const row of inboundNewestFirst) {
    if (remaining <= 0) break;
    const price = Number(row.price) || 0;
    const avail = Number(row.line_qty) || 0;
    if (!(price > 0) || !(avail > 0)) continue;
    const take = Math.min(remaining, avail);
    const amount = roundMoney(take * price);
    layers.push({
      doc_id: row.doc_id,
      doc_number: row.doc_number,
      doc_date: row.doc_date,
      counterparty: row.counterparty,
      counterparty_id: row.counterparty_id,
      warehouse: row.warehouse,
      warehouse_id: row.warehouse_id,
      price,
      qty: take,
      amount,
      line_qty: avail,
    });
    value += amount;
    remaining -= take;
  }

  value = roundMoney(value);
  const qtyPriced = roundMoney(need - Math.max(0, remaining));
  const qtyUnpriced = roundMoney(Math.max(0, remaining));
  const unitCost = qtyPriced > 0 ? roundMoney(value / qtyPriced) : null;

  return {
    qty: need,
    value,
    unit_cost: unitCost,
    last_price: lastPrice,
    last_doc_date: last?.doc_date ?? null,
    last_doc_number: last?.doc_number ?? null,
    qty_priced: qtyPriced,
    qty_unpriced: qtyUnpriced,
    has_price: qtyPriced > 0,
    layers,
    last_purchase_value: lastPrice != null ? roundMoney(need * lastPrice) : 0,
  };
}

export function loadInboundLayers(productIds: string[]): Map<string, InboundLayerRow[]> {
  const map = new Map<string, InboundLayerRow[]>();
  if (!productIds.length) return map;

  const chunkSize = 400;
  for (let i = 0; i < productIds.length; i += chunkSize) {
    const chunk = productIds.slice(i, i + chunkSize);
    const placeholders = chunk.map(() => '?').join(',');
    const rows = all<{
      product_id: string;
      doc_id: string;
      doc_number: string;
      doc_date: string;
      counterparty: string | null;
      counterparty_id: string | null;
      warehouse: string | null;
      warehouse_id: string | null;
      line_id: string;
      line_qty: number;
      price: number;
      line_amount: number;
    }>(
      `SELECT
         l.product_id,
         d.id AS doc_id,
         d.number AS doc_number,
         d.doc_date,
         c.name AS counterparty,
         d.counterparty_id,
         w.name AS warehouse,
         d.warehouse_id,
         l.id AS line_id,
         l.qty AS line_qty,
         l.price,
         IFNULL(l.amount, 0) AS line_amount
       FROM stock_doc_lines l
       INNER JOIN stock_docs d ON d.id = l.doc_id
       LEFT JOIN counterparties c ON c.id = d.counterparty_id
       LEFT JOIN warehouses w ON w.id = d.warehouse_id
       WHERE d.doc_type = 'in'
         AND IFNULL(l.price, 0) > 0
         AND IFNULL(l.qty, 0) > 0
         AND l.product_id IN (${placeholders})
       ORDER BY l.product_id, d.doc_date DESC, d.number DESC, l.line_no DESC`,
      chunk
    );
    for (const row of rows) {
      const list = map.get(row.product_id) || [];
      list.push({
        doc_id: row.doc_id,
        doc_number: row.doc_number,
        doc_date: row.doc_date,
        counterparty: row.counterparty,
        counterparty_id: row.counterparty_id,
        warehouse: row.warehouse,
        warehouse_id: row.warehouse_id,
        line_id: row.line_id,
        line_qty: Number(row.line_qty) || 0,
        price: Number(row.price) || 0,
        line_amount: Number(row.line_amount) || 0,
      });
      map.set(row.product_id, list);
    }
  }
  return map;
}

/**
 * Розничная цена: «Розничная цена», иначе тип с «рознич», иначе первая цена > 0.
 */
export function loadRetailPrices(productIds: string[]): Map<string, number> {
  const map = new Map<string, number>();
  if (!productIds.length) return map;

  const chunkSize = 400;
  for (let i = 0; i < productIds.length; i += chunkSize) {
    const chunk = productIds.slice(i, i + chunkSize);
    const placeholders = chunk.map(() => '?').join(',');
    const rows = all<{ product_id: string; price_type: string; price: number }>(
      `SELECT product_id, price_type, price
       FROM product_prices
       WHERE product_id IN (${placeholders}) AND IFNULL(price, 0) > 0
       ORDER BY product_id,
         CASE
           WHEN price_type = 'Розничная цена' THEN 0
           WHEN lower(price_type) LIKE '%рознич%' THEN 1
           ELSE 10
         END,
         price_type`,
      chunk
    );
    for (const row of rows) {
      if (map.has(row.product_id)) continue;
      map.set(row.product_id, Number(row.price) || 0);
    }
  }
  return map;
}

/** Остаток товара: stock_balances, иначе product_store_rests. */
export function productStockQty(productId: string): {
  qty: number;
  source: 'stock_balances' | 'product_store_rests' | 'none';
  by_warehouse: Array<{ warehouse_id: string; warehouse: string; qty: number }>;
} {
  const fromBalances = all<{ warehouse_id: string; warehouse: string; qty: number }>(
    `SELECT b.warehouse_id, w.name AS warehouse, b.qty
     FROM stock_balances b
     JOIN warehouses w ON w.id = b.warehouse_id
     WHERE b.product_id = ? AND b.qty != 0
     ORDER BY w.name`,
    [productId]
  );
  const balTotal = fromBalances.reduce((s, r) => s + (Number(r.qty) || 0), 0);
  if (fromBalances.length && balTotal !== 0) {
    return {
      qty: Math.max(0, balTotal),
      source: 'stock_balances',
      by_warehouse: fromBalances.map((r) => ({
        warehouse_id: r.warehouse_id,
        warehouse: r.warehouse,
        qty: Number(r.qty) || 0,
      })),
    };
  }

  const fromRests = all<{ warehouse_id: string; warehouse: string; qty: number }>(
    `SELECT r.warehouse_id, IFNULL(w.name, r.warehouse_id) AS warehouse, r.qty
     FROM product_store_rests r
     LEFT JOIN warehouses w ON w.id = r.warehouse_id
     WHERE r.product_id = ? AND r.qty != 0
     ORDER BY warehouse`,
    [productId]
  );
  const restTotal = fromRests.reduce((s, r) => s + (Number(r.qty) || 0), 0);
  if (fromRests.length && restTotal !== 0) {
    return {
      qty: Math.max(0, restTotal),
      source: 'product_store_rests',
      by_warehouse: fromRests.map((r) => ({
        warehouse_id: r.warehouse_id,
        warehouse: r.warehouse,
        qty: Number(r.qty) || 0,
      })),
    };
  }

  return { qty: 0, source: 'none', by_warehouse: [] };
}

/** Слои приходов, покрывающие текущий остаток номенклатуры. */
export function productInboundLayers(productId: string) {
  const stock = productStockQty(productId);
  const layersMap = loadInboundLayers([productId]);
  const cover = fifoCover(stock.qty, layersMap.get(productId) || []);
  return {
    method: VALUATION_METHOD,
    method_note: VALUATION_METHOD_NOTE,
    product_id: productId,
    qty: stock.qty,
    qty_source: stock.source,
    by_warehouse: stock.by_warehouse,
    value: cover.value,
    unit_cost: cover.unit_cost,
    last_price: cover.last_price,
    last_doc_date: cover.last_doc_date,
    last_doc_number: cover.last_doc_number,
    qty_priced: cover.qty_priced,
    qty_unpriced: cover.qty_unpriced,
    has_price: cover.has_price,
    layers: cover.layers,
    gap_note:
      'Партия прихода → конкретная УПД/расходная в БД не хранится: при списании показывается состав документа, без привязки к слою FIFO.',
  };
}

export type PurchaseHistoryItem = {
  doc_id: string;
  doc_number: string;
  doc_date: string;
  counterparty: string | null;
  counterparty_id: string | null;
  warehouse: string | null;
  warehouse_id: string | null;
  line_id: string;
  qty: number;
  price: number;
  amount: number;
  posted: number;
  gtd_code: string;
  gtd_key: string;
  lead_time_days: number;
};

/**
 * Полная история закупок номенклатуры по строкам приходных (не только FIFO-остаток).
 * Новые сверху. limit — сколько строк вернуть (1…200).
 */
export function productPurchaseHistory(productId: string, limit = 50) {
  const lim = Math.min(200, Math.max(1, Math.floor(Number(limit) || 50)));
  const totalRow = get<{ c: number }>(
    `SELECT COUNT(*) AS c
     FROM stock_doc_lines l
     INNER JOIN stock_docs d ON d.id = l.doc_id
     WHERE d.doc_type = 'in' AND l.product_id = ? AND IFNULL(l.qty, 0) != 0`,
    [productId]
  );
  const total = Number(totalRow?.c) || 0;
  const items = all<{
    doc_id: string;
    doc_number: string;
    doc_date: string;
    counterparty: string | null;
    counterparty_id: string | null;
    warehouse: string | null;
    warehouse_id: string | null;
    line_id: string;
    qty: number;
    price: number;
    amount: number;
    posted: number;
    gtd_code: string;
    gtd_key: string;
    lead_time_days: number;
  }>(
    `SELECT
       d.id AS doc_id,
       d.number AS doc_number,
       d.doc_date,
       c.name AS counterparty,
       d.counterparty_id,
       w.name AS warehouse,
       d.warehouse_id,
       l.id AS line_id,
       l.qty,
       IFNULL(l.price, 0) AS price,
       IFNULL(l.amount, 0) AS amount,
       IFNULL(d.posted, 0) AS posted,
       IFNULL(NULLIF(l.gtd_code, ''), IFNULL(g.code, '')) AS gtd_code,
       IFNULL(l.gtd_key, '') AS gtd_key,
       IFNULL(c.lead_time_days, 0) AS lead_time_days
     FROM stock_doc_lines l
     INNER JOIN stock_docs d ON d.id = l.doc_id
     LEFT JOIN counterparties c ON c.id = d.counterparty_id
     LEFT JOIN warehouses w ON w.id = d.warehouse_id
     LEFT JOIN gtd_numbers g ON g.id = l.gtd_key
     WHERE d.doc_type = 'in'
       AND l.product_id = ?
       AND IFNULL(l.qty, 0) != 0
     ORDER BY d.doc_date DESC, d.number DESC, l.line_no DESC
     LIMIT ?`,
    [productId, lim]
  ).map((r) => ({
    doc_id: r.doc_id,
    doc_number: r.doc_number,
    doc_date: r.doc_date,
    counterparty: r.counterparty,
    counterparty_id: r.counterparty_id,
    warehouse: r.warehouse,
    warehouse_id: r.warehouse_id,
    line_id: r.line_id,
    qty: Number(r.qty) || 0,
    price: Number(r.price) || 0,
    amount: Number(r.amount) || 0,
    posted: Number(r.posted) || 0,
    gtd_code: r.gtd_code || '',
    gtd_key: r.gtd_key || '',
    lead_time_days: Number(r.lead_time_days) || 0,
  }));
  return {
    product_id: productId,
    note: 'Все приходные накладные с этой номенклатурой (кто / когда / сколько / цена / ГТД / срок ожидания поставщика). Не только остаток FIFO.',
    total,
    limit: lim,
    items,
  };
}

export type StockValuationOpts = {
  warehouseId?: string;
  q?: string;
  page?: number;
  limit?: number;
  includeItems?: boolean;
};

/**
 * Оценка склада FIFO по приходам.
 * Цена на уровне номенклатуры (пул приходов), разнесение по складам пропорционально qty.
 */
export function stockValuation(opts: StockValuationOpts = {}) {
  const cacheKey = summaryCacheKey(opts);
  if (cacheKey && summaryCache && summaryCache.key === cacheKey) {
    if (Date.now() - summaryCache.at < SUMMARY_CACHE_MS) {
      return summaryCache.value as ReturnType<typeof stockValuationCompute>;
    }
  }
  const result = stockValuationCompute(opts);
  if (cacheKey) {
    summaryCache = { at: Date.now(), key: cacheKey, value: result };
  }
  return result;
}

function stockValuationCompute(opts: StockValuationOpts = {}) {
  const where: string[] = ['b.qty != 0'];
  const params: Array<string | number> = [];
  if (opts.warehouseId) {
    where.push('b.warehouse_id = ?');
    params.push(opts.warehouseId);
  }
  if (opts.q?.trim()) {
    const like = `%${opts.q.trim()}%`;
    where.push('(p.name LIKE ? OR p.sku LIKE ?)');
    params.push(like, like);
  }
  const whereSql = `WHERE ${where.join(' AND ')}`;

  const balanceRows = all<{
    warehouse_id: string;
    warehouse: string;
    product_id: string;
    sku: string;
    name: string;
    qty: number;
  }>(
    `SELECT
       b.warehouse_id,
       w.name AS warehouse,
       b.product_id,
       p.sku,
       p.name,
       b.qty
     FROM stock_balances b
     JOIN products p ON p.id = b.product_id
     JOIN warehouses w ON w.id = b.warehouse_id
     ${whereSql}
     ORDER BY p.name, w.name`,
    params
  );

  const productQty = new Map<string, number>();
  for (const row of balanceRows) {
    const q = Number(row.qty) || 0;
    if (q > 0) {
      productQty.set(row.product_id, (productQty.get(row.product_id) || 0) + q);
    }
  }

  const productIds = [...productQty.keys()];
  const layersMap = loadInboundLayers(productIds);
  const retailPrices = loadRetailPrices(productIds);
  const coverByProduct = new Map<string, FifoCoverResult>();
  for (const [pid, qty] of productQty) {
    coverByProduct.set(pid, fifoCover(qty, layersMap.get(pid) || []));
  }

  type ValuedRow = {
    warehouse_id: string;
    warehouse: string;
    product_id: string;
    sku: string;
    name: string;
    qty: number;
    unit_cost: number | null;
    last_price: number | null;
    last_doc_date: string | null;
    last_doc_number: string | null;
    line_value: number;
    last_purchase_line_value: number;
    retail_price: number | null;
    retail_line_value: number;
    qty_unpriced: number;
    has_price: boolean;
    layers: FifoLayer[];
  };

  const valued: ValuedRow[] = [];
  for (const row of balanceRows) {
    const qty = Number(row.qty) || 0;
    const retailPrice = retailPrices.get(row.product_id) ?? null;
    const retailLine = retailPrice != null && qty > 0 ? roundMoney(qty * retailPrice) : 0;
    if (!(qty > 0)) {
      valued.push({
        warehouse_id: row.warehouse_id,
        warehouse: row.warehouse,
        product_id: row.product_id,
        sku: row.sku,
        name: row.name,
        qty,
        unit_cost: null,
        last_price: null,
        last_doc_date: null,
        last_doc_number: null,
        line_value: 0,
        last_purchase_line_value: 0,
        retail_price: retailPrice,
        retail_line_value: 0,
        qty_unpriced: 0,
        has_price: false,
        layers: [],
      });
      continue;
    }

    const cover = coverByProduct.get(row.product_id)!;
    const productTotal = productQty.get(row.product_id) || qty;
    const share = productTotal > 0 ? qty / productTotal : 0;
    const lineValue = roundMoney(cover.value * share);
    const lastPurchaseLine = roundMoney(cover.last_purchase_value * share);
    const qtyUnpriced = roundMoney(cover.qty_unpriced * share);

    valued.push({
      warehouse_id: row.warehouse_id,
      warehouse: row.warehouse,
      product_id: row.product_id,
      sku: row.sku,
      name: row.name,
      qty,
      unit_cost: cover.unit_cost,
      last_price: cover.last_price,
      last_doc_date: cover.last_doc_date,
      last_doc_number: cover.last_doc_number,
      line_value: lineValue,
      last_purchase_line_value: lastPurchaseLine,
      retail_price: retailPrice,
      retail_line_value: retailLine,
      qty_unpriced: qtyUnpriced,
      has_price: cover.has_price,
      layers: cover.layers,
    });
  }

  valued.sort((a, b) => b.line_value - a.line_value || a.name.localeCompare(b.name, 'ru'));

  const totalValue = roundMoney(valued.reduce((s, r) => s + r.line_value, 0));
  const totalLastPurchase = roundMoney(valued.reduce((s, r) => s + r.last_purchase_line_value, 0));
  const totalRetail = roundMoney(valued.reduce((s, r) => s + r.retail_line_value, 0));
  const qtyTotal = valued.reduce((s, r) => s + r.qty, 0);
  const linesCount = valued.length;
  const linesWithPrice = valued.filter((r) => r.has_price).length;
  const linesWithoutPrice = valued.filter((r) => !r.has_price).length;
  const qtyUnpricedTotal = roundMoney(valued.reduce((s, r) => s + r.qty_unpriced, 0));

  const whMap = new Map<
    string,
    {
      warehouse_id: string;
      warehouse: string;
      /** FIFO закуп */
      value: number;
      value_purchase: number;
      value_retail: number;
      value_last_purchase: number;
      qty: number;
      lines: number;
      lines_without_price: number;
    }
  >();
  for (const r of valued) {
    const cur = whMap.get(r.warehouse_id) || {
      warehouse_id: r.warehouse_id,
      warehouse: r.warehouse,
      value: 0,
      value_purchase: 0,
      value_retail: 0,
      value_last_purchase: 0,
      qty: 0,
      lines: 0,
      lines_without_price: 0,
    };
    cur.value = roundMoney(cur.value + r.line_value);
    cur.value_purchase = cur.value;
    cur.value_retail = roundMoney(cur.value_retail + r.retail_line_value);
    cur.value_last_purchase = roundMoney(cur.value_last_purchase + r.last_purchase_line_value);
    cur.qty += r.qty;
    cur.lines += 1;
    if (!r.has_price) cur.lines_without_price += 1;
    whMap.set(r.warehouse_id, cur);
  }
  const byWarehouse = [...whMap.values()].sort(
    (a, b) => b.value - a.value || a.warehouse.localeCompare(b.warehouse, 'ru')
  );

  const page = Math.max(1, Number(opts.page) || 1);
  const limit = Math.min(200, Math.max(1, Number(opts.limit) || 50));
  const includeItems = opts.includeItems !== false;
  const pages = Math.max(1, Math.ceil(linesCount / limit));

  let items: Array<{
    warehouse_id: string;
    warehouse: string;
    product_id: string;
    sku: string;
    name: string;
    qty: number;
    unit_cost: number | null;
    last_price: number | null;
    last_doc_date: string | null;
    last_doc_number: string | null;
    line_value: number;
    retail_price: number | null;
    retail_line_value: number;
    qty_unpriced: number;
    layers: FifoLayer[];
  }> = [];

  if (includeItems) {
    const offset = (page - 1) * limit;
    items = valued.slice(offset, offset + limit).map((r) => ({
      warehouse_id: r.warehouse_id,
      warehouse: r.warehouse,
      product_id: r.product_id,
      sku: r.sku,
      name: r.name,
      qty: r.qty,
      unit_cost: r.unit_cost,
      last_price: r.last_price,
      last_doc_date: r.last_doc_date,
      last_doc_number: r.last_doc_number,
      line_value: r.line_value,
      retail_price: r.retail_price,
      retail_line_value: r.retail_line_value,
      qty_unpriced: r.qty_unpriced,
      layers: r.layers,
    }));
  }

  // Топ приходов, внёсших вклад в стоимость (по сумме слоёв на странице / всех товаров)
  const purchaseAgg = new Map<
    string,
    {
      doc_id: string;
      doc_number: string;
      doc_date: string;
      counterparty: string | null;
      value: number;
      qty: number;
    }
  >();
  for (const [, cover] of coverByProduct) {
    for (const layer of cover.layers) {
      const cur = purchaseAgg.get(layer.doc_id) || {
        doc_id: layer.doc_id,
        doc_number: layer.doc_number,
        doc_date: layer.doc_date,
        counterparty: layer.counterparty,
        value: 0,
        qty: 0,
      };
      cur.value = roundMoney(cur.value + layer.amount);
      cur.qty = roundMoney(cur.qty + layer.qty);
      purchaseAgg.set(layer.doc_id, cur);
    }
  }
  const by_purchase = [...purchaseAgg.values()]
    .sort((a, b) => b.value - a.value)
    .slice(0, 20);

  return {
    method: VALUATION_METHOD,
    method_note: VALUATION_METHOD_NOTE,
    currency: 'RUB',
    total_value: totalValue,
    total_value_purchase: totalValue,
    total_value_last_purchase: totalLastPurchase,
    total_value_retail: totalRetail,
    qty_total: qtyTotal,
    qty_unpriced: qtyUnpricedTotal,
    lines_count: linesCount,
    lines_with_price: linesWithPrice,
    lines_without_price: linesWithoutPrice,
    by_warehouse: byWarehouse,
    by_purchase,
    items,
    total: linesCount,
    page,
    limit,
    pages,
  };
}

/** Краткая оценка для дашборда (без строк). */
export function stockValuationSummary(warehouseId?: string) {
  const full = stockValuation({
    warehouseId,
    includeItems: false,
    page: 1,
    limit: 1,
  });
  return {
    method: full.method,
    method_note: full.method_note,
    currency: full.currency,
    total_value: full.total_value,
    total_value_purchase: full.total_value_purchase,
    total_value_last_purchase: full.total_value_last_purchase,
    total_value_retail: full.total_value_retail,
    lines_count: full.lines_count,
    lines_without_price: full.lines_without_price,
    qty_unpriced: full.qty_unpriced,
  };
}

/**
 * Суммы по каждому складу: закуп (FIFO) + розница.
 * Для списка складов и карточки склада.
 */
export function warehouseStockMoneyTotals(): Array<{
  warehouse_id: string;
  warehouse: string;
  value_purchase: number;
  value_retail: number;
  value_last_purchase: number;
  qty: number;
  lines: number;
  lines_without_price: number;
}> {
  const full = stockValuation({ includeItems: false, page: 1, limit: 1 });
  return (full.by_warehouse || []).map((w) => ({
    warehouse_id: w.warehouse_id,
    warehouse: w.warehouse,
    value_purchase: Number(w.value_purchase ?? w.value) || 0,
    value_retail: Number(w.value_retail) || 0,
    value_last_purchase: Number(w.value_last_purchase) || 0,
    qty: Number(w.qty) || 0,
    lines: Number(w.lines) || 0,
    lines_without_price: Number(w.lines_without_price) || 0,
  }));
}

/** Проверка что get доступен (для тестов / smoke). */
export function valuationHealthProbe(): { ok: boolean; in_lines: number } {
  const row = get<{ c: number }>(
    `SELECT COUNT(*) AS c
     FROM stock_doc_lines l
     JOIN stock_docs d ON d.id = l.doc_id
     WHERE d.doc_type = 'in' AND IFNULL(l.price, 0) > 0`
  );
  return { ok: true, in_lines: Number(row?.c) || 0 };
}
