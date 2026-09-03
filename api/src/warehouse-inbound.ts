/**
 * Приход на Основной с обязательным размещением по ячейкам (ручной ввод).
 */
import type { Hono } from 'hono';
import { all, get, run } from './db.js';
import { newGuid } from './ids.js';
import { catalogArticleOf } from './product-display-name.js';
import {
  ensureDiscrepancyAct,
  ensureInboundBaseline,
  getDiscrepancyAct,
  listDiscrepancyActs,
  previewDiscrepancyForInbound,
  type BaselineLine,
} from './purchase-discrepancy.js';
import { createDocument, postDocument } from './stock.js';
import { resolveOrganizationId } from './organizations.js';
import { getThinJournalDoc } from './parity-batch-a.js';
import { refreshThinSupplierOrderStatus } from './supplier-order-analysis.js';
import {
  getPlacementSummariesForDocs,
  getPlacementsForDoc,
  insertLinePlacements,
  listCellCodes,
  listProductInboundHints,
  listWarehousesWithCells,
  replaceLinePlacement,
  replaceLinePlacements,
  resolveMainInboundWarehouseId,
  warehouseHasActiveCells,
} from './warehouse-cells.js';

export type InboundPlacementInput = { cell_code: string; qty: number };
export type InboundLineInput = {
  product_id: string;
  qty: number;
  price?: number;
  placements: InboundPlacementInput[];
};

function qtyEqual(a: number, b: number): boolean {
  return Math.abs(Number(a) - Number(b)) < 0.0001;
}

export function validateInboundLines(lines: InboundLineInput[]): void {
  if (!Array.isArray(lines) || !lines.length) throw new Error('Добавьте хотя бы одну строку');
  lines.forEach((line, idx) => {
    const productId = String(line.product_id || '').trim();
    const qty = Number(line.qty);
    if (!productId) throw new Error(`Строка ${idx + 1}: не выбран товар`);
    if (!(qty > 0)) throw new Error(`Строка ${idx + 1}: количество должно быть > 0`);
    const placements = Array.isArray(line.placements) ? line.placements : [];
    if (!placements.length) throw new Error(`Строка ${idx + 1}: укажите размещение (склад)`);
    let sum = 0;
    placements.forEach((p, pIdx) => {
      const pq = Number(p.qty);
      if (!(pq > 0)) throw new Error(`Строка ${idx + 1}, размещение ${pIdx + 1}: количество > 0`);
      sum += pq;
    });
    if (!qtyEqual(sum, qty)) {
      throw new Error(
        `Строка ${idx + 1}: сумма по ячейкам (${sum}) не совпадает с количеством (${qty})`
      );
    }
  });
}

export type DraftLineInput = {
  id?: string;
  product_id: string;
  qty: number;
  price?: number;
  warehouse_id?: string;
};

/**
 * Сохранить строки черновика приходной (только posted=0).
 * Эталон (baseline) пишется при первом сохранении.
 */
export function saveInboundDraft(input: {
  docId: string;
  lines: DraftLineInput[];
  comment?: string;
}): { id: string; number: string; lines: Array<Record<string, unknown>> } {
  const id = String(input.docId || '').trim();
  if (!id) throw new Error('Не указан документ');
  const doc = get<{
    id: string;
    doc_type: string;
    posted: number;
    number: string;
    warehouse_id: string;
    comment: string;
  }>(
    `SELECT id, IFNULL(doc_type,'') AS doc_type, posted, IFNULL(number,'') AS number,
            IFNULL(warehouse_id,'') AS warehouse_id, IFNULL(comment,'') AS comment
     FROM stock_docs WHERE id = ?`,
    [id]
  );
  if (!doc) throw new Error('Документ не найден');
  if (String(doc.doc_type) !== 'in') throw new Error('Только для приходных');
  if (Number(doc.posted) === 1) throw new Error('Документ уже проведён — строки не меняются');

  const lines = Array.isArray(input.lines) ? input.lines : [];
  if (!lines.length) throw new Error('Добавьте хотя бы одну строку');

  const normalized: DraftLineInput[] = lines.map((l, idx) => {
    const productId = String(l.product_id || '').trim();
    const qty = Math.round(Number(l.qty) || 0);
    if (!productId) throw new Error(`Строка ${idx + 1}: не выбран товар`);
    if (!(qty > 0)) throw new Error(`Строка ${idx + 1}: количество должно быть > 0`);
    const prod = get<{ id: string }>(`SELECT id FROM products WHERE id = ?`, [productId]);
    if (!prod) throw new Error(`Строка ${idx + 1}: товар не найден`);
    return {
      id: String(l.id || '').trim() || undefined,
      product_id: productId,
      qty,
      price: Math.max(0, Number(l.price) || 0),
      warehouse_id: String(l.warehouse_id || '').trim() || String(doc.warehouse_id || ''),
    };
  });

  const existingBefore = all<{ product_id: string; qty: number; price: number }>(
    `SELECT IFNULL(product_id,'') AS product_id, qty, IFNULL(price,0) AS price
     FROM stock_doc_lines WHERE doc_id = ?`,
    [id]
  ).map(
    (r): BaselineLine => ({
      product_id: String(r.product_id),
      qty: Number(r.qty) || 0,
      price: Number(r.price) || 0,
    })
  );
  ensureInboundBaseline(id, existingBefore.length ? existingBefore : normalized);

  const keepIds = new Set(
    normalized.map((l) => l.id).filter((x): x is string => !!x && x.length > 0)
  );
  const oldLines = all<{ id: string }>(`SELECT id FROM stock_doc_lines WHERE doc_id = ?`, [id]);
  for (const old of oldLines) {
    if (!keepIds.has(String(old.id))) {
      run(`DELETE FROM stock_doc_line_placements WHERE doc_id = ? AND line_id = ?`, [
        id,
        old.id,
      ]);
      run(`DELETE FROM stock_doc_lines WHERE id = ? AND doc_id = ?`, [old.id, id]);
    }
  }

  let docAmount = 0;
  for (const line of normalized) {
    const amount = Math.round((Number(line.price) || 0) * line.qty);
    docAmount += amount;
    const lineWh = String(line.warehouse_id || doc.warehouse_id || '').trim();
    if (line.id) {
      const exists = get<{ id: string }>(
        `SELECT id FROM stock_doc_lines WHERE id = ? AND doc_id = ?`,
        [line.id, id]
      );
      if (exists) {
        run(
          `UPDATE stock_doc_lines
           SET product_id = ?, qty = ?, price = ?, amount = ?, warehouse_id = ?
           WHERE id = ? AND doc_id = ?`,
          [line.product_id, line.qty, line.price || 0, amount, lineWh, line.id, id]
        );
        const pls = all<{ id: string; qty: number }>(
          `SELECT id, qty FROM stock_doc_line_placements WHERE doc_id = ? AND line_id = ?`,
          [id, line.id]
        );
        if (pls.length === 1 && !qtyEqual(Number(pls[0].qty), line.qty)) {
          run(`UPDATE stock_doc_line_placements SET qty = ? WHERE id = ?`, [
            line.qty,
            pls[0].id,
          ]);
        }
        continue;
      }
    }
    const newId = newGuid();
    run(
      `INSERT INTO stock_doc_lines (id, doc_id, product_id, qty, price, amount, serials_json, warehouse_id, apps_json)
       VALUES (?, ?, ?, ?, ?, ?, '[]', ?, '')`,
      [newId, id, line.product_id, line.qty, line.price || 0, amount, lineWh]
    );
  }

  if (input.comment != null) {
    run(`UPDATE stock_docs SET comment = ?, amount = ? WHERE id = ?`, [
      String(input.comment),
      docAmount,
      id,
    ]);
  } else {
    run(`UPDATE stock_docs SET amount = ? WHERE id = ?`, [docAmount, id]);
  }

  const saved = all<Record<string, unknown>>(
    `SELECT l.*, IFNULL(p.name,'') AS product_name, IFNULL(p.sku,'') AS sku, IFNULL(p.code,'') AS code
     FROM stock_doc_lines l
     LEFT JOIN products p ON p.id = l.product_id
     WHERE l.doc_id = ?
     ORDER BY l.rowid`,
    [id]
  );
  return { id, number: String(doc.number || id), lines: saved };
}

/** Черновик приходной на основании заказа поставщику (thin journal). */
export function createInboundFromSupplierOrder(input: {
  supplier_order_id: string;
  warehouse_id?: string;
  copy_prices?: boolean;
  comment?: string;
  organization_id?: string;
}): {
  id: string;
  number: string;
  posted: false;
  lines_count: number;
  source_supplier_order_id: string;
} {
  const orderId = String(input.supplier_order_id || '').trim();
  if (!orderId) throw new Error('Укажите заказ поставщику');
  const order = getThinJournalDoc('supplier_orders', orderId);
  if (!order) throw new Error('Заказ поставщику не найден');
  const lines = Array.isArray(order.lines) ? order.lines : [];
  if (!lines.length) throw new Error('В заказе нет строк номенклатуры');

  const warehouseId =
    String(input.warehouse_id || order.warehouse_id || '').trim() ||
    resolveMainInboundWarehouseId();
  const copyPrices = !!input.copy_prices;
  const supplyNumber = String(
    order.supply_number || order.invoice_number || order.number || ''
  ).trim();
  const orgId = resolveOrganizationId(
    input.organization_id || order.organization_id || null
  );
  const cpId = String(order.counterparty_id || '').trim() || null;
  const comment =
    String(input.comment || '').trim() ||
    `Основание: заказ ${order.number}${order.counterparty_name ? ' · ' + order.counterparty_name : ''}`;

  const docLines = lines.map((l) => {
    const pid = String(l.product_id || '').trim();
    if (!pid) throw new Error('В заказе есть строка без product_id');
    const qty = Number(l.qty) || 0;
    if (!(qty > 0)) throw new Error(`Строка ${l.article || pid}: количество должно быть > 0`);
    return {
      product_id: pid,
      qty,
      price: copyPrices ? Math.max(0, Number(l.price) || 0) : 0,
      warehouse_id: warehouseId,
    };
  });

  const docId = createDocument({
    doc_type: 'in',
    warehouse_id: warehouseId,
    counterparty_id: cpId,
    organization_id: orgId,
    source_supplier_order_id: orderId,
    supply_number: supplyNumber,
    comment,
    serials_optional: true,
    post: false,
    lines: docLines,
  });

  ensureInboundBaseline(
    docId,
    docLines.map((l) => ({
      product_id: l.product_id,
      qty: l.qty,
      price: copyPrices ? l.price : Number(
        lines.find((x) => String(x.product_id) === l.product_id)?.price
      ) || 0,
    }))
  );

  // зафиксировать baseline именно по строкам заказа (с ценами заказа для анализа)
  run(`UPDATE stock_docs SET inbound_baseline_json = ? WHERE id = ?`, [
    JSON.stringify({
      lines: lines.map((l) => ({
        product_id: String(l.product_id),
        qty: Number(l.qty) || 0,
        price: Number(l.price) || 0,
      })),
      saved_at: new Date().toISOString(),
      source: 'supplier_order',
      supplier_order_id: orderId,
    }),
    docId,
  ]);

  const doc = get<{ number: string }>(`SELECT number FROM stock_docs WHERE id = ?`, [docId]);
  return {
    id: docId,
    number: String(doc?.number || docId),
    posted: false,
    lines_count: docLines.length,
    source_supplier_order_id: orderId,
  };
}

export function createInboundWithPlacements(input: {
  warehouse_id?: string;
  counterparty_id?: string | null;
  comment?: string;
  lines: InboundLineInput[];
}): { id: string; number: string } {
  const warehouseId = String(input.warehouse_id || '').trim() || resolveMainInboundWarehouseId();
  if (!warehouseHasActiveCells(warehouseId)) {
    throw new Error(
      'На выбранном складе нет активных ячеек — выберите другой склад или импортируйте сетку'
    );
  }
  validateInboundLines(input.lines || []);
  const comment = String(input.comment || '').trim();
  const docId = createDocument({
    doc_type: 'in',
    warehouse_id: warehouseId,
    counterparty_id: input.counterparty_id ?? null,
    comment: comment ? `${comment} · размещение по ячейкам` : 'Размещение по ячейкам',
    serials_optional: true,
    post: false,
    lines: (input.lines || []).map((l) => ({
      product_id: String(l.product_id),
      qty: Number(l.qty),
      price: Number(l.price) || 0,
      warehouse_id: warehouseId,
    })),
  });
  const dbLines = all<{ id: string; product_id: string; qty: number }>(
    `SELECT id, product_id, qty FROM stock_doc_lines WHERE doc_id = ? ORDER BY rowid`,
    [docId]
  );
  if (dbLines.length !== input.lines.length) {
    throw new Error('Не удалось сохранить строки прихода');
  }
  dbLines.forEach((dbLine, idx) => {
    const src = input.lines[idx];
    insertLinePlacements({
      doc_id: docId,
      line_id: String(dbLine.id),
      warehouse_id: warehouseId,
      product_id: String(dbLine.product_id),
      placements: src.placements,
    });
  });
  ensureInboundBaseline(
    docId,
    input.lines.map((l) => ({
      product_id: String(l.product_id),
      qty: Number(l.qty),
      price: Number(l.price) || 0,
    }))
  );
  postDocument(docId, { serialsOptional: true });
  const doc = get<{ number: string }>(`SELECT number FROM stock_docs WHERE id = ?`, [docId]);
  return { id: docId, number: String(doc?.number || docId) };
}

/**
 * Оприходовать черновик приходной: остатки по складам строк + ячейки из placements.
 */
export function postInboundDocument(docId: string): {
  id: string;
  number: string;
  posted: true;
  discrepancy?: ReturnType<typeof ensureDiscrepancyAct>;
} {
  const id = String(docId || '').trim();
  if (!id) throw new Error('Не указан документ');
  const doc = get<{ id: string; doc_type: string; posted: number; number: string }>(
    `SELECT id, IFNULL(doc_type,'') AS doc_type, posted, IFNULL(number,'') AS number
     FROM stock_docs WHERE id = ?`,
    [id]
  );
  if (!doc) throw new Error('Документ не найден');
  if (String(doc.doc_type) !== 'in') throw new Error('Оприходование только для приходных');
  if (Number(doc.posted) === 1) throw new Error('Документ уже проведён');

  const lines = all<{ id: string; product_id: string; qty: number; warehouse_id: string }>(
    `SELECT id, IFNULL(product_id,'') AS product_id, qty, IFNULL(warehouse_id,'') AS warehouse_id
     FROM stock_doc_lines WHERE doc_id = ? ORDER BY rowid`,
    [id]
  );
  if (!lines.length) throw new Error('Нет строк для оприходования');

  ensureInboundBaseline(
    id,
    lines.map((l) => ({
      product_id: String(l.product_id),
      qty: Number(l.qty) || 0,
    }))
  );

  const placements = getPlacementsForDoc(id).lines as Array<{
    line_id: string;
    cell_code: string;
    qty: number;
    warehouse_id?: string;
  }>;
  const byLine = new Map<
    string,
    Array<{ cell_code: string; qty: number; warehouse_id: string }>
  >();
  for (const p of placements) {
    const lid = String(p.line_id || '');
    if (!lid) continue;
    if (!byLine.has(lid)) byLine.set(lid, []);
    byLine.get(lid)!.push({
      cell_code: String(p.cell_code || '').trim(),
      qty: Number(p.qty) || 0,
      warehouse_id: String(p.warehouse_id || '').trim(),
    });
  }

  lines.forEach((line, idx) => {
    const n = idx + 1;
    const pls = byLine.get(String(line.id)) || [];
    if (!pls.length) {
      // Без частей — ок, если у строки есть склад (остаток без адреса)
      if (!String(line.warehouse_id || '').trim()) {
        throw new Error(`Строка ${n}: выберите склад размещения`);
      }
      return;
    }
    const sum = pls.reduce((s, p) => s + (Number(p.qty) || 0), 0);
    if (!qtyEqual(sum, Number(line.qty))) {
      throw new Error(
        `Строка ${n}: сумма частей (${sum}) ≠ количеству (${Number(line.qty)})`
      );
    }
    for (const p of pls) {
      if (!p.warehouse_id && !String(line.warehouse_id || '').trim()) {
        throw new Error(`Строка ${n}: выберите склад`);
      }
    }
  });

  postDocument(id, { serialsOptional: true });
  let discrepancy: ReturnType<typeof ensureDiscrepancyAct> | undefined;
  try {
    discrepancy = ensureDiscrepancyAct(id);
  } catch (e) {
    console.warn('[inbound] discrepancy act failed', e instanceof Error ? e.message : e);
  }
  try {
    const orderId = get<{ source_supplier_order_id: string }>(
      `SELECT IFNULL(source_supplier_order_id,'') AS source_supplier_order_id
       FROM stock_docs WHERE id = ?`,
      [id]
    )?.source_supplier_order_id;
    if (orderId) refreshThinSupplierOrderStatus(String(orderId));
  } catch (e) {
    console.warn('[inbound] order status refresh failed', e instanceof Error ? e.message : e);
  }
  const after = get<{ number: string }>(
    `SELECT IFNULL(number,'') AS number FROM stock_docs WHERE id = ?`,
    [id]
  );
  return {
    id,
    number: String(after?.number || doc.number || id),
    posted: true,
    discrepancy,
  };
}

function escPrint(s: unknown): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function fmtQty(n: number): string {
  const x = Number(n) || 0;
  return Number.isInteger(x) ? String(x) : String(Math.round(x * 1000) / 1000);
}

/** Печатная форма приходной: факт qty + размещения по складам/ячейкам. */
export function inboundReceiptPrintHtml(
  docId: string,
  opts?: { autoprint?: boolean }
): string {
  const id = String(docId || '').trim();
  if (!id) throw new Error('Не указан документ');
  const doc = get<{
    id: string;
    number: string;
    doc_type: string;
    posted: number;
    doc_date: string;
    comment: string;
    supply_number: string;
    warehouse_id: string;
    counterparty_id: string;
    warehouse_name: string;
    counterparty_name: string;
  }>(
    `SELECT d.id, IFNULL(d.number,'') AS number, IFNULL(d.doc_type,'') AS doc_type,
            IFNULL(d.posted,0) AS posted, IFNULL(d.doc_date,'') AS doc_date,
            IFNULL(d.comment,'') AS comment, IFNULL(d.supply_number,'') AS supply_number,
            IFNULL(d.warehouse_id,'') AS warehouse_id,
            IFNULL(d.counterparty_id,'') AS counterparty_id,
            IFNULL(w.name,'') AS warehouse_name,
            IFNULL(c.name,'') AS counterparty_name
     FROM stock_docs d
     LEFT JOIN warehouses w ON w.id = d.warehouse_id
     LEFT JOIN counterparties c ON c.id = d.counterparty_id
     WHERE d.id = ?`,
    [id]
  );
  if (!doc) throw new Error('Документ не найден');
  if (String(doc.doc_type) !== 'in') throw new Error('Печать только для приходных');

  const lines = all<{
    id: string;
    product_id: string;
    qty: number;
    price: number;
    amount: number;
    warehouse_id: string;
    sku: string;
    code: string;
    barcode: string;
    array_sku: string;
    product_name: string;
    wh_name: string;
  }>(
    `SELECT l.id, IFNULL(l.product_id,'') AS product_id, l.qty, IFNULL(l.price,0) AS price,
            IFNULL(l.amount,0) AS amount, IFNULL(l.warehouse_id,'') AS warehouse_id,
            IFNULL(p.sku,'') AS sku, IFNULL(p.code,'') AS code,
            IFNULL(p.barcode,'') AS barcode, IFNULL(p.array_sku,'') AS array_sku,
            IFNULL(p.name,'') AS product_name,
            IFNULL(lw.name, IFNULL(w.name, '')) AS wh_name
     FROM stock_doc_lines l
     LEFT JOIN products p ON p.id = l.product_id
     LEFT JOIN warehouses lw ON lw.id = NULLIF(TRIM(IFNULL(l.warehouse_id,'')), '')
     LEFT JOIN warehouses w ON w.id = ?
     WHERE l.doc_id = ?
     ORDER BY
       CASE WHEN IFNULL(l.line_no, 0) = 0 THEN 1 ELSE 0 END,
       l.line_no,
       IFNULL(p.sku, '') COLLATE NOCASE,
       IFNULL(p.code, '') COLLATE NOCASE,
       IFNULL(p.name, '') COLLATE NOCASE`,
    [String(doc.warehouse_id || ''), id]
  );

  const placements = getPlacementsForDoc(id).lines as Array<{
    line_id: string;
    cell_code: string;
    qty: number;
    warehouse_id: string;
  }>;
  const plByLine = new Map<string, typeof placements>();
  for (const p of placements) {
    const lid = String(p.line_id || '');
    if (!lid) continue;
    if (!plByLine.has(lid)) plByLine.set(lid, []);
    plByLine.get(lid)!.push(p);
  }

  const whNameCache = new Map<string, string>();
  const whName = (wid: string): string => {
    const w = String(wid || '').trim();
    if (!w) return '';
    if (whNameCache.has(w)) return whNameCache.get(w)!;
    const row = get<{ name: string; code: string }>(
      `SELECT IFNULL(name,'') AS name, IFNULL(code,'') AS code FROM warehouses WHERE id = ?`,
      [w]
    );
    const label = String(row?.name || row?.code || '').trim() || w.slice(0, 8);
    whNameCache.set(w, label);
    return label;
  };

  /** Печать: одинаковый артикул — одна строка (qty суммируем). В документе строки как есть. */
  type PrintRow = (typeof lines)[number] & {
    line_ids: string[];
    qty_sum: number;
  };
  const collapsed: PrintRow[] = [];
  const byKey = new Map<string, PrintRow>();
  for (const l of lines) {
    const pid = String(l.product_id || '').trim();
    const skuKey = String(l.sku || l.code || '').trim().toUpperCase();
    const key = pid || skuKey || String(l.id);
    const existing = byKey.get(key);
    if (existing) {
      existing.qty_sum += Number(l.qty) || 0;
      existing.line_ids.push(String(l.id));
      continue;
    }
    const row: PrintRow = {
      ...l,
      line_ids: [String(l.id)],
      qty_sum: Number(l.qty) || 0,
    };
    byKey.set(key, row);
    collapsed.push(row);
  }

  let qtySum = 0;
  const rowsHtml = collapsed
    .map((l, idx) => {
      const qty = Number(l.qty_sum) || 0;
      qtySum += qty;
      const art = catalogArticleOf({
        sku: l.sku,
        code: l.code,
        barcode: l.barcode,
        array_sku: l.array_sku,
      });
      const pls = l.line_ids.flatMap((lid) => plByLine.get(lid) || []);
      let placeHtml: string;
      if (pls.length) {
        const placeMerge = new Map<string, { warehouse_id: string; cell_code: string; qty: number }>();
        for (const p of pls) {
          const cell = String(p.cell_code || '').trim();
          const wid = String(p.warehouse_id || l.warehouse_id || doc.warehouse_id || '').trim();
          const mk = `${wid}::${cell}`;
          const prev = placeMerge.get(mk);
          if (prev) prev.qty += Number(p.qty) || 0;
          else placeMerge.set(mk, { warehouse_id: wid, cell_code: cell, qty: Number(p.qty) || 0 });
        }
        placeHtml = [...placeMerge.values()]
          .map((p) => {
            const wh = whName(p.warehouse_id);
            const cell = p.cell_code;
            const pq = fmtQty(p.qty);
            return `${escPrint(wh)}${wh && cell ? ' · ' : ''}<b>${escPrint(cell)}</b> × ${escPrint(pq)}`;
          })
          .join('<br/>');
      } else {
        const wh = String(l.wh_name || '').trim() || whName(String(l.warehouse_id || doc.warehouse_id));
        placeHtml = wh
          ? `<span class="muted">${escPrint(wh)}</span> <span class="warn">ячейка не указана</span>`
          : '<span class="warn">нет размещения</span>';
      }
      return `<tr>
        <td class="c">${idx + 1}</td>
        <td class="mono">${escPrint(art.article || l.sku || '')}</td>
        <td class="mono muted">${escPrint(art.code || l.code || '')}</td>
        <td class="l">${escPrint(l.product_name || l.product_id || '—')}</td>
        <td class="c mono">${escPrint(fmtQty(qty))}</td>
        <td class="l place">${placeHtml}</td>
      </tr>`;
    })
    .join('');

  let discHtml = '';
  try {
    const preview = previewDiscrepancyForInbound(id);
    if (preview.lines.length) {
      const actNum = preview.act ? String((preview.act as { number?: string }).number || '') : '';
      discHtml = `<div class="disc">
        <div class="disc-h">Акт о расхождениях${actNum ? ' · ' + escPrint(actNum) : ''} (${preview.lines.length})</div>
        <table class="grid disc-t">
          <thead><tr><th>Артикул</th><th>В поставке</th><th>В приходе</th><th>Δ</th><th>Тип</th></tr></thead>
          <tbody>
            ${preview.lines
              .map((r) => {
                const kind =
                  r.kind === 'missing'
                    ? 'Недостача'
                    : r.kind === 'extra'
                      ? 'Излишек'
                      : 'Расхождение qty';
                return `<tr>
                  <td class="mono">${escPrint(r.sku || r.code || '')}</td>
                  <td class="c">${escPrint(fmtQty(r.qty_supply))}</td>
                  <td class="c">${escPrint(fmtQty(r.qty_inbound))}</td>
                  <td class="c">${escPrint(fmtQty(r.qty_diff))}</td>
                  <td>${escPrint(kind)}</td>
                </tr>`;
              })
              .join('')}
          </tbody>
        </table>
      </div>`;
    }
  } catch {
    /* ignore */
  }

  const num = String(doc.number || '').trim() || id.slice(0, 8);
  const status = Number(doc.posted) === 1 ? 'Проведён' : 'Черновик';
  const printedAt = new Date().toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const docDate = String(doc.doc_date || '').slice(0, 10);
  const title = `Приходная накладная № ${num}`;

  const metaBits = [
    doc.warehouse_name ? `Склад: <b>${escPrint(doc.warehouse_name)}</b>` : '',
    doc.counterparty_name ? `Поставщик: <b>${escPrint(doc.counterparty_name)}</b>` : '',
    doc.supply_number ? `Поставка: <b class="mono">${escPrint(doc.supply_number)}</b>` : '',
    docDate ? `Дата: <b>${escPrint(docDate)}</b>` : '',
    `Статус: <b>${escPrint(status)}</b>`,
    `Печать: ${escPrint(printedAt)}`,
  ].filter(Boolean);

  const autoprintScript = opts?.autoprint
    ? `<script>window.addEventListener('load',function(){setTimeout(function(){window.print()},200)});</script>`
    : '';

  return `<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="UTF-8" />
  <title>${escPrint(title)}</title>
  <style>
    @page { size: A4; margin: 10mm; }
    * { box-sizing: border-box; }
    body { font-family: "Segoe UI", Tahoma, sans-serif; font-size: 11px; color: #111; margin: 14px; }
    h1 { font-size: 16px; margin: 0 0 8px; font-weight: 700; }
    .meta { line-height: 1.55; margin: 0 0 12px; color: #333; }
    .meta b { color: #111; font-weight: 650; }
    .mono { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
    .muted { color: #64748b; }
    .warn { color: #b45309; font-size: 10px; }
    table.grid { width: 100%; border-collapse: collapse; margin: 0 0 10px; }
    table.grid th, table.grid td { border: 1px solid #94a3b8; padding: 4px 6px; vertical-align: top; }
    table.grid th { background: #f1f5f9; font-weight: 650; text-align: center; font-size: 10px; }
    .c { text-align: center; }
    .l { text-align: left; }
    .place { font-size: 10.5px; line-height: 1.35; }
    .foot { margin-top: 6px; display: flex; justify-content: space-between; gap: 12px; font-size: 12px; }
    .disc { margin-top: 16px; padding-top: 10px; border-top: 1px dashed #cbd5e1; }
    .disc-h { font-weight: 700; margin-bottom: 6px; color: #9a3412; }
    .disc-t th { background: #fff7ed; }
    .comment { margin: 8px 0 0; font-size: 10px; color: #475569; }
    .toolbar { margin-bottom: 12px; }
    .toolbar button { font: inherit; font-weight: 650; padding: 7px 14px; cursor: pointer;
      background: #0f766e; color: #fff; border: 0; border-radius: 8px; }
    @media print { .toolbar { display: none !important; } body { margin: 0; } }
  </style>
</head>
<body>
  <div class="toolbar"><button type="button" onclick="window.print()">Печать / PDF</button></div>
  <h1>${escPrint(title)}</h1>
  <div class="meta">${metaBits.join(' · ')}</div>
  <table class="grid">
    <thead>
      <tr>
        <th style="width:28px">№</th>
        <th style="width:110px">Артикул</th>
        <th style="width:100px">Код</th>
        <th>Номенклатура</th>
        <th style="width:52px">Кол-во</th>
        <th style="width:220px">Размещение</th>
      </tr>
    </thead>
    <tbody>
      ${
        rowsHtml ||
        '<tr><td colspan="6" class="c muted">Нет строк</td></tr>'
      }
    </tbody>
  </table>
  <div class="foot">
    <div>Позиций: <b>${collapsed.length}</b>${
      collapsed.length !== lines.length
        ? ` <span class="muted">(в документе ${lines.length} стр.)</span>`
        : ''
    }</div>
    <div>Всего шт: <b class="mono">${escPrint(fmtQty(qtySum))}</b></div>
  </div>
  ${
    doc.comment
      ? `<p class="comment">Комментарий: ${escPrint(doc.comment)}</p>`
      : ''
  }
  ${discHtml}
  ${autoprintScript}
</body>
</html>`;
}

export function mountWarehouseInboundRoutes(api: Hono): void {
  api.get('/warehouse/inbound/meta', (c) => {
    try {
      const warehouses = listWarehousesWithCells();
      const requested = String(c.req.query('warehouse_id') || '').trim();
      let wid = resolveMainInboundWarehouseId();
      if (requested) {
        const hit = warehouses.find((w) => w.id === requested);
        if (hit) wid = hit.id;
        else {
          const whRow = get<{ id: string }>(`SELECT id FROM warehouses WHERE id = ?`, [requested]);
          if (whRow?.id && warehouseHasActiveCells(String(whRow.id))) wid = String(whRow.id);
        }
      } else if (warehouses.length) {
        const mainHit = warehouses.find((w) => w.id === wid);
        if (!mainHit) wid = warehouses[0].id;
      }
      const wh = get<{ id: string; name: string; code: string }>(
        `SELECT id, name, code FROM warehouses WHERE id = ?`,
        [wid]
      );
      return c.json({
        warehouses,
        warehouse: wh,
        cell_codes: listCellCodes(wid),
      });
    } catch (e) {
      return c.json({ error: e instanceof Error ? e.message : 'error' }, 400);
    }
  });

  api.get('/warehouse/inbound/product-hints', (c) => {
    try {
      const productId = String(c.req.query('product_id') || '').trim();
      if (!productId) return c.json({ error: 'product_id обязателен' }, 400);
      const wid =
        String(c.req.query('warehouse_id') || '').trim() || resolveMainInboundWarehouseId();
      return c.json(listProductInboundHints(productId, wid));
    } catch (e) {
      return c.json({ error: e instanceof Error ? e.message : 'error' }, 400);
    }
  });

  api.post('/warehouse/inbound', async (c) => {
    let body: {
      warehouse_id?: string;
      counterparty_id?: string | null;
      comment?: string;
      lines?: InboundLineInput[];
    } = {};
    try {
      body = (await c.req.json()) as typeof body;
    } catch {
      return c.json({ error: 'Некорректный JSON' }, 400);
    }
    try {
      const lines = Array.isArray(body.lines) ? body.lines : [];
      if (!lines.length) return c.json({ error: 'Добавьте хотя бы одну строку прихода' }, 400);
      const r = createInboundWithPlacements({
        warehouse_id: body.warehouse_id,
        counterparty_id: body.counterparty_id ?? null,
        comment: body.comment,
        lines,
      });
      const doc = get(`SELECT * FROM stock_docs WHERE id = ?`, [r.id]);
      return c.json(doc, 201);
    } catch (e) {
      return c.json({ error: e instanceof Error ? e.message : 'error' }, 400);
    }
  });

  api.post('/warehouse/inbound/from-order', async (c) => {
    let body: {
      supplier_order_id?: string;
      warehouse_id?: string;
      copy_prices?: boolean;
      comment?: string;
      organization_id?: string;
    } = {};
    try {
      body = (await c.req.json()) as typeof body;
    } catch {
      return c.json({ error: 'Некорректный JSON' }, 400);
    }
    try {
      const r = createInboundFromSupplierOrder({
        supplier_order_id: String(body.supplier_order_id || ''),
        warehouse_id: body.warehouse_id,
        copy_prices: !!body.copy_prices,
        comment: body.comment,
        organization_id: body.organization_id,
      });
      const doc = get(`SELECT * FROM stock_docs WHERE id = ?`, [r.id]);
      return c.json({ ok: true, ...r, doc }, 201);
    } catch (e) {
      return c.json({ error: e instanceof Error ? e.message : 'error' }, 400);
    }
  });

  api.put('/warehouse/inbound/:id/draft', async (c) => {
    let body: { lines?: DraftLineInput[]; comment?: string } = {};
    try {
      body = (await c.req.json()) as typeof body;
    } catch {
      return c.json({ error: 'Некорректный JSON' }, 400);
    }
    try {
      const r = saveInboundDraft({
        docId: c.req.param('id'),
        lines: Array.isArray(body.lines) ? body.lines : [],
        comment: body.comment,
      });
      return c.json({ ok: true, ...r });
    } catch (e) {
      return c.json({ error: e instanceof Error ? e.message : 'error' }, 400);
    }
  });

  api.get('/warehouse/inbound/:id/discrepancy', (c) => {
    try {
      return c.json(previewDiscrepancyForInbound(c.req.param('id')));
    } catch (e) {
      return c.json({ error: e instanceof Error ? e.message : 'error' }, 400);
    }
  });

  api.get('/warehouse/inbound/:id/print', (c) => {
    try {
      const autoprint =
        c.req.query('autoprint') === '1' || c.req.query('autoprint') === 'true';
      const html = inboundReceiptPrintHtml(c.req.param('id'), { autoprint });
      return c.html(html);
    } catch (e) {
      return c.html(
        `<p>${escPrint(e instanceof Error ? e.message : 'error')}</p>`,
        400
      );
    }
  });

  api.get('/purchases/discrepancy', (c) => {
    try {
      const limit = Number(c.req.query('limit') || 50) || 50;
      return c.json({ items: listDiscrepancyActs(limit) });
    } catch (e) {
      return c.json({ error: e instanceof Error ? e.message : 'error' }, 400);
    }
  });

  api.get('/purchases/discrepancy/:id', (c) => {
    try {
      const r = getDiscrepancyAct(c.req.param('id'));
      if (!r) return c.json({ error: 'not found' }, 404);
      return c.json(r);
    } catch (e) {
      return c.json({ error: e instanceof Error ? e.message : 'error' }, 400);
    }
  });

  api.get('/warehouse/inbound/placements', (c) => {
    try {
      const docId = String(c.req.query('doc_id') || '').trim();
      if (!docId) return c.json({ error: 'doc_id обязателен' }, 400);
      return c.json(getPlacementsForDoc(docId));
    } catch (e) {
      return c.json({ error: e instanceof Error ? e.message : 'error' }, 400);
    }
  });

  api.post('/warehouse/inbound/line-placement', async (c) => {
    let body: {
      doc_id?: string;
      line_id?: string;
      warehouse_id?: string;
      cell_code?: string;
      placements?: Array<{ warehouse_id?: string; cell_code?: string; qty?: number }>;
    } = {};
    try {
      body = (await c.req.json()) as typeof body;
    } catch {
      return c.json({ error: 'Некорректный JSON' }, 400);
    }
    try {
      if (Array.isArray(body.placements) && body.placements.length) {
        const r = replaceLinePlacements({
          doc_id: String(body.doc_id || ''),
          line_id: String(body.line_id || ''),
          placements: body.placements.map((p) => ({
            warehouse_id: String(p.warehouse_id || ''),
            cell_code: String(p.cell_code || ''),
            qty: Number(p.qty) || 0,
          })),
        });
        return c.json(r);
      }
      const r = replaceLinePlacement({
        doc_id: String(body.doc_id || ''),
        line_id: String(body.line_id || ''),
        warehouse_id: String(body.warehouse_id || ''),
        cell_code: String(body.cell_code || ''),
      });
      return c.json(r);
    } catch (e) {
      return c.json({ error: e instanceof Error ? e.message : 'error' }, 400);
    }
  });

  api.post('/warehouse/inbound/post', async (c) => {
    let body: { doc_id?: string } = {};
    try {
      body = (await c.req.json()) as typeof body;
    } catch {
      return c.json({ error: 'Некорректный JSON' }, 400);
    }
    try {
      const r = postInboundDocument(String(body.doc_id || ''));
      const doc = get(`SELECT * FROM stock_docs WHERE id = ?`, [r.id]);
      return c.json({ ok: true, ...r, doc });
    } catch (e) {
      return c.json({ error: e instanceof Error ? e.message : 'error' }, 400);
    }
  });
}

export { getPlacementSummariesForDocs, getPlacementsForDoc };
