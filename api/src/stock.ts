import { all, get, run } from './db.js';
import { outNumberFromDeal } from './doc-numbering.js';
import { newGuid, nextCode } from './ids.js';
import { resolveOrganizationId } from './organizations.js';
import { productIsService } from './product-kind.js';
import {
  normalizeSerials,
  parseSerialsJson,
  productRequiresSerials,
  receiveUnits,
  shipUnits,
  transferUnits,
} from './product-units.js';
import { nextBarcode } from './barcodes.js';
import { invalidateStockValuationCache } from './stock-valuation.js';
import { appsToJson, parseAppsJson } from './applicability-party.js';
import { createMoneyRefundFromReturn, getLastSalePrice } from './return-money.js';

export type DocType = 'in' | 'out' | 'transfer' | 'return';

export type DocLineInput = {
  product_id: string;
  qty: number;
  /** Цена закупки / прихода (для приходных). */
  price?: number;
  serials?: string[] | string;
  /** Склад строки (для расхода с разных складов). Пусто = склад шапки. */
  warehouse_id?: string | null;
  /** Применимость партии (марки авто) для создаваемых экземпляров. */
  apps?: Array<{ mark?: string; model?: string; generation?: string; years?: string }> | string;
};

export function isServiceProduct(productId: string): boolean {
  return productIsService(productId);
}

export function nextDocNumber(docType: DocType): string {
  const prefix =
    docType === 'in' ? 'IN' : docType === 'out' ? 'OUT' : docType === 'return' ? 'RET' : 'TR';
  return nextCode(prefix, 5);
}

export function applyStockDelta(warehouseId: string, productId: string, delta: number): void {
  const existing = get<{ qty: number }>(
    'SELECT qty FROM stock_balances WHERE warehouse_id = ? AND product_id = ?',
    [warehouseId, productId]
  );
  if (!existing) {
    if (delta < 0) {
      throw new Error('Недостаточно остатка');
    }
    run(
      'INSERT INTO stock_balances (warehouse_id, product_id, qty) VALUES (?, ?, ?)',
      [warehouseId, productId, delta]
    );
    return;
  }
  const next = Number(existing.qty) + delta;
  if (next < -0.0001) {
    throw new Error('Недостаточно остатка');
  }
  run(
    'UPDATE stock_balances SET qty = ? WHERE warehouse_id = ? AND product_id = ?',
    [next, warehouseId, productId]
  );
}

function applyDelta(warehouseId: string, productId: string, delta: number): void {
  applyStockDelta(warehouseId, productId, delta);
}

function validateLineSerials(
  productId: string,
  qty: number,
  serials: string[],
  mode: 'in' | 'out' | 'transfer',
  opts?: { serialsOptional?: boolean }
): void {
  const tracked = productRequiresSerials(productId);
  if (tracked && !serials.length && !opts?.serialsOptional) {
    throw new Error('Для товара с серийным учётом укажите серийные номера (по одному на штуку)');
  }
  if (!serials.length) return;
  const qtyInt = Math.round(qty);
  if (Math.abs(qty - qtyInt) > 0.0001 || qtyInt !== serials.length) {
    throw new Error(
      `Число серийников (${serials.length}) должно совпадать с количеством (${qty})`
    );
  }
  if (mode === 'out' || mode === 'transfer') {
    /* uniqueness checked when shipping */
  }
}

function lineWarehouse(
  lineWh: string | null | undefined,
  docWh: string
): string {
  const w = String(lineWh || '').trim();
  return w || docWh;
}

export function postDocument(docId: string, opts?: { serialsOptional?: boolean }): void {
  const doc = get<{
    id: string;
    doc_type: DocType;
    posted: number;
    warehouse_id: string;
    warehouse_to_id: string | null;
  }>('SELECT * FROM stock_docs WHERE id = ?', [docId]);
  if (!doc) throw new Error('Документ не найден');
  if (doc.posted) throw new Error('Уже проведён');

  const lines = all<{
    id: string;
    product_id: string;
    qty: number;
    serials_json: string;
    warehouse_id: string;
    apps_json: string;
  }>(
    `SELECT id, product_id, qty,
            IFNULL(serials_json, '[]') AS serials_json,
            IFNULL(warehouse_id, '') AS warehouse_id,
            IFNULL(apps_json, '[]') AS apps_json
     FROM stock_doc_lines WHERE doc_id = ?`,
    [docId]
  );
  if (!lines.length) throw new Error('Нет строк');
  const serialsOptional = !!opts?.serialsOptional;
  const supplierId = String(
    get<{ counterparty_id: string | null }>(
      `SELECT counterparty_id FROM stock_docs WHERE id = ?`,
      [docId]
    )?.counterparty_id || ''
  ).trim();

  run('BEGIN');
  try {
    for (const line of lines) {
      const qty = Number(line.qty);
      if (!(qty > 0)) throw new Error('Количество должно быть > 0');
      const serials = parseSerialsJson(line.serials_json);
      const wh = lineWarehouse(line.warehouse_id, doc.warehouse_id);
      if (!wh) throw new Error('Не указан склад строки');
      if (doc.doc_type === 'in' || doc.doc_type === 'return') {
        validateLineSerials(line.product_id, qty, serials, 'in', { serialsOptional });
        applyDelta(wh, line.product_id, qty);
        receiveUnits({
          productId: line.product_id,
          warehouseId: wh,
          serials,
          docId,
          lineId: line.id,
          apps: line.apps_json,
          supplierId,
        });
      } else if (doc.doc_type === 'out') {
        // Услуги в УПД есть, на складе не списываем
        if (isServiceProduct(line.product_id)) continue;
        validateLineSerials(line.product_id, qty, serials, 'out');
        applyDelta(wh, line.product_id, -qty);
        shipUnits({
          productId: line.product_id,
          warehouseId: wh,
          serials,
          docId,
          lineId: line.id,
        });
      } else {
        if (!doc.warehouse_to_id) throw new Error('Не указан склад-получатель');
        validateLineSerials(line.product_id, qty, serials, 'transfer');
        applyDelta(wh, line.product_id, -qty);
        applyDelta(doc.warehouse_to_id, line.product_id, qty);
        transferUnits({
          productId: line.product_id,
          warehouseFrom: wh,
          warehouseTo: doc.warehouse_to_id,
          serials,
          docId,
          lineId: line.id,
        });
      }
    }
    run('UPDATE stock_docs SET posted = 1 WHERE id = ?', [docId]);
    run('COMMIT');
  } catch (e) {
    run('ROLLBACK');
    throw e;
  }
  invalidateStockValuationCache();
}

export function createDocument(input: {
  doc_type: DocType;
  warehouse_id?: string | null;
  warehouse_to_id?: string | null;
  counterparty_id?: string | null;
  comment?: string;
  organization_id?: string | null;
  deal_id?: string | null;
  basis_order_id?: string | null;
  /** Заказ поставщику (thin journal / supply), если приход по заказу. */
  source_supplier_order_id?: string | null;
  /** Приход «для себя» — марки не обязательны. */
  serials_optional?: boolean;
  lines: DocLineInput[];
  post?: boolean;
}): string {
  const id = newGuid();
  const docDate = new Date().toISOString().slice(0, 10);
  const organizationId = resolveOrganizationId(input.organization_id);
  // Расходная = списание со склада: услуги в документ не кладём (они в УПД)
  const lines =
    input.doc_type === 'out'
      ? input.lines.filter((l) => !isServiceProduct(String(l.product_id || '')))
      : input.lines;
  if (input.doc_type === 'out' && !lines.length) {
    throw new Error('Нет товаров для списания (услуги в расходную не входят — только в УПД)');
  }
  const headerWh =
    String(input.warehouse_id || '').trim() ||
    String(lines.find((l) => l.warehouse_id)?.warehouse_id || '').trim();
  if (!headerWh && input.doc_type !== 'out') {
    throw new Error('Укажите склад');
  }
  if (!headerWh && input.doc_type === 'out' && !lines.some((l) => l.warehouse_id)) {
    throw new Error('Укажите склад в строках');
  }
  const resolvedHeader =
    headerWh ||
    String(lines[0]?.warehouse_id || '').trim() ||
    '00000000-0000-0000-0000-000000000001';
  const dealId = String(input.deal_id || '').trim();
  const basisOrderId = String(input.basis_order_id || '').trim();
  const sourceSupplierOrderId = String(input.source_supplier_order_id || '').trim();
  // Расходная по заказу: Р{номер сделки Amo}; иначе старая серия OUT…
  const number =
    input.doc_type === 'out' && dealId
      ? outNumberFromDeal(dealId)
      : nextDocNumber(input.doc_type);

  run(
    `INSERT INTO stock_docs
      (id, doc_type, number, doc_date, warehouse_id, warehouse_to_id, counterparty_id, comment, posted, organization_id, deal_id, basis_order_id, source_supplier_order_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?)`,
    [
      id,
      input.doc_type,
      number,
      docDate,
      resolvedHeader,
      input.warehouse_to_id ?? null,
      input.counterparty_id ?? null,
      input.comment ?? '',
      organizationId,
      dealId,
      basisOrderId,
      sourceSupplierOrderId,
    ]
  );
  let docAmount = 0;
  const returnSerials: string[] = [];
  for (const line of lines) {
    const serials = normalizeSerials(line.serials);
    let qty = Number(line.qty);
    if (serials.length && !(qty > 0)) qty = serials.length;
    let price = Math.max(0, Number(line.price) || 0);
    // Возврат: если цена не передана — берём цену последней продажи
    if (input.doc_type === 'return' && !(price > 0)) {
      const sale = getLastSalePrice({
        productId: String(line.product_id || ''),
        serial: serials[0] || '',
        dealId,
      });
      price = Math.max(0, Number(sale.price) || 0);
    }
    const amount = Math.round(price * qty * 100) / 100;
    docAmount += amount;
    if (input.doc_type === 'return') returnSerials.push(...serials);
    const lineWh = String(line.warehouse_id || '').trim() || resolvedHeader;
    const appsJson = appsToJson(parseAppsJson(line.apps));
    run(
      `INSERT INTO stock_doc_lines (id, doc_id, product_id, qty, price, amount, serials_json, warehouse_id, apps_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [newGuid(), id, line.product_id, qty, price, amount, JSON.stringify(serials), lineWh, appsJson]
    );
  }
  if (docAmount > 0) {
    run(`UPDATE stock_docs SET amount = ? WHERE id = ?`, [docAmount, id]);
  }
  if (input.post !== false) {
    postDocument(id, { serialsOptional: !!input.serials_optional });
  }
  if (input.doc_type === 'return' && docAmount > 0) {
    let buyerName = '';
    if (dealId) {
      const d = get<{ buyer_name: string; company_name: string; name: string }>(
        `SELECT IFNULL(buyer_name,'') AS buyer_name, IFNULL(company_name,'') AS company_name,
                IFNULL(name,'') AS name
         FROM crm_deals WHERE id = ?`,
        [dealId]
      );
      buyerName = String(d?.buyer_name || d?.company_name || d?.name || '').trim();
    }
    if (!buyerName && input.counterparty_id) {
      buyerName =
        get<{ name: string }>(`SELECT name FROM counterparties WHERE id = ?`, [
          input.counterparty_id,
        ])?.name || '';
    }
    createMoneyRefundFromReturn({
      stockDocId: id,
      stockDocNumber: number,
      amount: docAmount,
      dealId,
      counterpartyName: buyerName,
      counterpartyId: String(input.counterparty_id || ''),
      serials: returnSerials,
      comment: `основание:возврат ${number}${buyerName ? ' · ' + buyerName : ''}`,
    });
  }
  return id;
}

/** --- Марки (Data Matrix) для складских приходов без заказа поставщику --- */

function stockSerialTaken(serial: string, excludeDocId?: string): boolean {
  const s = String(serial || '').trim();
  if (!s) return true;
  if (get<{ id: string }>(`SELECT id FROM product_units WHERE lower(serial) = lower(?) LIMIT 1`, [s])) {
    return true;
  }
  try {
    if (
      get<{ id: string }>(
        `SELECT id FROM supplier_order_units WHERE lower(serial) = lower(?) LIMIT 1`,
        [s]
      )
    ) {
      return true;
    }
  } catch {
    /* optional table */
  }
  try {
    const safe = s
      .replace(/\\/g, '\\\\')
      .replace(/%/g, '\\%')
      .replace(/_/g, '\\_')
      .replace(/"/g, '');
    const like = `%"${safe}"%`;
    const hit = excludeDocId
      ? get<{ id: string }>(
          `SELECT l.doc_id AS id FROM stock_doc_lines l
           WHERE l.doc_id != ? AND IFNULL(l.serials_json,'') LIKE ? ESCAPE '\\' LIMIT 1`,
          [excludeDocId, like]
        )
      : get<{ id: string }>(
          `SELECT l.doc_id AS id FROM stock_doc_lines l
           WHERE IFNULL(l.serials_json,'') LIKE ? ESCAPE '\\' LIMIT 1`,
          [like]
        );
    if (hit) return true;
  } catch {
    /* ignore */
  }
  try {
    const safe = s
      .replace(/\\/g, '\\\\')
      .replace(/%/g, '\\%')
      .replace(/_/g, '\\_')
      .replace(/"/g, '');
    const like = `%"${safe}"%`;
    if (
      get<{ id: string }>(
        `SELECT id FROM thin_journal_docs WHERE IFNULL(payload_json,'') LIKE ? ESCAPE '\\' LIMIT 1`,
        [like]
      )
    ) {
      return true;
    }
  } catch {
    /* ignore */
  }
  return false;
}

function stockNextUniqueBarcode(
  prefixRaw: string,
  usedInDoc: Set<string>,
  excludeDocId?: string
): string {
  for (let attempt = 0; attempt < 80; attempt++) {
    const code = nextBarcode(prefixRaw);
    const key = code.toLowerCase();
    if (usedInDoc.has(key)) continue;
    if (stockSerialTaken(code, excludeDocId)) continue;
    usedInDoc.add(key);
    return code;
  }
  throw new Error('Не удалось выделить уникальную марку');
}

/** Выдать N новых марок без привязки к документу (для формы «Новый приход»). */
export function previewStockMarks(opts?: { count?: number; prefix?: string }): {
  serials: string[];
  prefix: string;
} {
  const count = Math.min(500, Math.max(1, Math.round(Number(opts?.count) || 1)));
  const prefix = String(opts?.prefix || 'DM').trim() || 'DM';
  const used = new Set<string>();
  const serials: string[] = [];
  for (let i = 0; i < count; i++) {
    serials.push(stockNextUniqueBarcode(prefix, used));
  }
  return { serials, prefix };
}

export type StockDocDmLabel = {
  serial: string;
  article: string;
  name: string;
  line_no: number;
};

export function stockDocDmLabels(docId: string): {
  number: string;
  counterparty_name: string;
  doc_type: string;
  labels: StockDocDmLabel[];
} | null {
  const doc = get<{
    id: string;
    number: string;
    doc_type: string;
    counterparty_id: string | null;
  }>('SELECT id, number, doc_type, counterparty_id FROM stock_docs WHERE id = ?', [docId]);
  if (!doc) return null;
  const cp = doc.counterparty_id
    ? get<{ name: string }>('SELECT name FROM counterparties WHERE id = ?', [doc.counterparty_id])
    : null;
  const lines = all<{
    id: string;
    product_id: string;
    qty: number;
    serials_json: string;
    sku: string;
    product_name: string;
    line_no: number;
  }>(
    `SELECT l.id, l.product_id, l.qty, IFNULL(l.serials_json,'[]') AS serials_json,
            IFNULL(l.line_no, 0) AS line_no,
            IFNULL(p.sku,'') AS sku, IFNULL(p.name,'') AS product_name
     FROM stock_doc_lines l
     LEFT JOIN products p ON p.id = l.product_id
     WHERE l.doc_id = ?
     ORDER BY l.line_no, l.rowid`,
    [docId]
  );
  const labels: StockDocDmLabel[] = [];
  for (const line of lines) {
    let serials = parseSerialsJson(line.serials_json);
    if (!serials.length) {
      const fromUnits = all<{ serial: string }>(
        `SELECT serial FROM product_units
         WHERE in_doc_id = ? AND (in_line_id = ? OR in_line_id = '' OR in_line_id IS NULL)
           AND product_id = ?
         ORDER BY created_at`,
        [docId, line.id, line.product_id]
      );
      serials = fromUnits.map((u) => u.serial);
    }
    let i = 0;
    for (const serial of serials) {
      i += 1;
      labels.push({
        serial,
        article: line.sku,
        name: line.product_name,
        line_no: line.line_no || i,
      });
    }
  }
  return {
    number: String(doc.number || ''),
    counterparty_name: String(cp?.name || ''),
    doc_type: String(doc.doc_type || ''),
    labels,
  };
}

function escapeHtmlMark(s: string): string {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function stockDocDmLabelsHtml(docId: string): string {
  const data = stockDocDmLabels(docId);
  if (!data) throw new Error('not found');
  const rows = data.labels
    .map((l) => {
      const dmSrc = `/api/datamatrix.png?text=${encodeURIComponent(l.serial)}&scale=3`;
      return `<div class="lbl">
      <img class="dm" src="${dmSrc}" alt="DataMatrix ${escapeHtmlMark(l.serial)}" width="96" height="96" />
      <div class="txt">
        <div class="code">${escapeHtmlMark(l.serial)}</div>
        <div class="meta">${escapeHtmlMark(l.article)} · ${escapeHtmlMark(l.name)}</div>
        <div class="ord">${escapeHtmlMark(data.number)} · ${escapeHtmlMark(data.counterparty_name)}</div>
      </div>
    </div>`;
    })
    .join('\n');
  return `<!DOCTYPE html><html lang="ru"><head><meta charset="utf-8"/><title>Марки ${escapeHtmlMark(data.number)}</title>
<style>
  body{font-family:system-ui,sans-serif;margin:12px}
  .lbl{display:flex;gap:12px;align-items:center;border:1px solid #333;border-radius:8px;padding:10px 12px;margin:0 0 10px;page-break-inside:avoid;width:380px}
  .dm{width:96px;height:96px;image-rendering:pixelated;flex-shrink:0}
  .code{font-size:16px;font-weight:800;letter-spacing:.04em;font-family:ui-monospace,monospace;word-break:break-all}
  .meta,.ord{font-size:12px;color:#444;margin-top:4px}
  @media print{.lbl{box-shadow:none}}
</style></head><body onload="window.print()">${rows || '<p>Нет марок — сначала сгенерируйте или укажите в приходе</p>'}</body></html>`;
}

export function stockDocDmExcelCsv(docId: string): string {
  const data = stockDocDmLabels(docId);
  if (!data) throw new Error('not found');
  const esc = (s: string) => `"${String(s || '').replace(/"/g, '""')}"`;
  const lines = [
    ['Документ', 'Поставщик', '№ строки', 'Артикул', 'Номенклатура', 'Марка'].map(esc).join(';'),
  ];
  for (const l of data.labels) {
    lines.push(
      [data.number, data.counterparty_name, String(l.line_no), l.article, l.name, l.serial]
        .map(esc)
        .join(';')
    );
  }
  if (!data.labels.length) {
    lines.push([data.number, data.counterparty_name, '', '', '', ''].map(esc).join(';'));
  }
  return '\uFEFF' + lines.join('\r\n');
}

export async function stockDocDmLabelsPdf(docId: string): Promise<Buffer> {
  const data = stockDocDmLabels(docId);
  if (!data) throw new Error('not found');
  const PDFDocument = (await import('pdfkit')).default;
  const { renderDataMatrixPng } = await import('./datamatrix.js');
  const { drawOrgLogoPdf } = await import('./org-logo.js');
  const doc = new PDFDocument({ size: 'A4', margin: 36, info: { Title: `Марки ${data.number}` } });
  const chunks: Buffer[] = [];
  doc.on('data', (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });
  drawOrgLogoPdf(doc, { width: 150, height: 22, gapBelow: 8 });
  doc.fontSize(14).text(`Марки · ${data.number}`, { continued: false });
  doc.fontSize(10).fillColor('#555').text(data.counterparty_name || '—');
  doc.moveDown(0.6);
  if (!data.labels.length) {
    doc.fillColor('#000').text('Нет марок — сначала сгенерируйте.');
    doc.end();
    return done;
  }
  let x = 36;
  let y = doc.y;
  const cellW = 170;
  const cellH = 130;
  const gap = 12;
  for (const l of data.labels) {
    if (y + cellH > doc.page.height - 36) {
      doc.addPage();
      y = 36;
      x = 36;
    }
    if (x + cellW > doc.page.width - 36) {
      x = 36;
      y += cellH + gap;
      if (y + cellH > doc.page.height - 36) {
        doc.addPage();
        y = 36;
      }
    }
    doc.rect(x, y, cellW, cellH).stroke('#333');
    try {
      const png = await renderDataMatrixPng(l.serial, { scale: 3 });
      doc.image(png, x + 10, y + 10, { width: 72, height: 72 });
    } catch {
      doc.fontSize(8).text('DM', x + 30, y + 40);
    }
    doc.fontSize(8).fillColor('#000').text(l.serial, x + 90, y + 14, { width: 70 });
    doc
      .fontSize(7)
      .fillColor('#444')
      .text(`${l.article}\n${l.name}`.slice(0, 80), x + 10, y + 90, { width: cellW - 20 });
    x += cellW + gap;
  }
  doc.end();
  return done;
}

/**
 * Догенерировать марки по строкам прихода.
 * Если документ уже проведён — новые марки сразу ставятся на остаток (product_units).
 */
export function allocateStockDocDatamatrix(
  docId: string,
  opts?: { prefix?: string; force?: boolean }
): {
  id: string;
  number: string;
  dm_created: number;
  dm_replaced: number;
  dm_prefix: string;
  labels_count: number;
} {
  const doc = get<{
    id: string;
    number: string;
    doc_type: string;
    posted: number;
    warehouse_id: string;
  }>('SELECT id, number, doc_type, posted, warehouse_id FROM stock_docs WHERE id = ?', [docId]);
  if (!doc) throw new Error('Документ не найден');
  if (doc.doc_type !== 'in' && doc.doc_type !== 'return') {
    throw new Error('Марки выдаются только для прихода / возврата');
  }
  const prefix = String(opts?.prefix || 'DM').trim() || 'DM';
  const force = !!opts?.force;
  const lines = all<{
    id: string;
    product_id: string;
    qty: number;
    serials_json: string;
    warehouse_id: string;
  }>(
    `SELECT id, product_id, qty, IFNULL(serials_json,'[]') AS serials_json,
            IFNULL(warehouse_id,'') AS warehouse_id
     FROM stock_doc_lines WHERE doc_id = ?`,
    [docId]
  );
  if (!lines.length) throw new Error('Нет строк');

  const usedInDoc = new Set<string>();
  let created = 0;
  let replaced = 0;

  run('BEGIN');
  try {
    for (const line of lines) {
      const qtyNum = Number(line.qty);
      const need = Math.max(1, Math.round(Number.isFinite(qtyNum) && qtyNum > 0 ? qtyNum : 1));
      const existing = force ? [] : parseSerialsJson(line.serials_json);
      const serials: string[] = [];
      for (const s of existing) {
        if (serials.length >= need) break;
        const key = s.toLowerCase();
        if (!key || usedInDoc.has(key)) {
          replaced += 1;
          continue;
        }
        if (stockSerialTaken(s, docId)) {
          // уже наша единица этого документа — ок
          const ours = get<{ id: string }>(
            `SELECT id FROM product_units WHERE lower(serial) = lower(?) AND in_doc_id = ? LIMIT 1`,
            [s, docId]
          );
          if (!ours) {
            replaced += 1;
            continue;
          }
        }
        usedInDoc.add(key);
        serials.push(s);
      }
      while (serials.length < need) {
        serials.push(stockNextUniqueBarcode(prefix, usedInDoc, docId));
        created += 1;
      }
      run(`UPDATE stock_doc_lines SET serials_json = ? WHERE id = ?`, [
        JSON.stringify(serials),
        line.id,
      ]);

      if (doc.posted) {
        const already = new Set(
          all<{ serial: string }>(
            `SELECT serial FROM product_units WHERE in_doc_id = ? AND in_line_id = ?`,
            [docId, line.id]
          ).map((u) => u.serial.toLowerCase())
        );
        const toReceive = serials.filter((s) => !already.has(s.toLowerCase()));
        if (toReceive.length) {
          const wh = String(line.warehouse_id || '').trim() || doc.warehouse_id;
          receiveUnits({
            productId: line.product_id,
            warehouseId: wh,
            serials: toReceive,
            docId,
            lineId: line.id,
          });
        }
      }
    }
    run('COMMIT');
  } catch (e) {
    run('ROLLBACK');
    throw e;
  }

  const labels = stockDocDmLabels(docId);
  return {
    id: doc.id,
    number: doc.number,
    dm_created: created,
    dm_replaced: replaced,
    dm_prefix: prefix,
    labels_count: labels?.labels.length || 0,
  };
}

/**
 * Требование / перемещение: все остатки склада-источника → склад-получатель.
 * По умолчанию черновик (требование). Комментарий часто «ЭДО документ».
 */
/** Авто/системные склады — ручных требований перемещения нет. */
function isAutoSysWarehouse(w: { code?: string; name?: string } | null | undefined): boolean {
  if (!w) return false;
  const code = String(w.code || '')
    .trim()
    .toUpperCase();
  if (code === 'WAIT-PAY' || code === 'IN-TRANSIT') return true;
  const name = String(w.name || '').trim();
  if (/^в\s*пути$/i.test(name)) return true;
  if (/не\s*найден/i.test(name)) return true;
  if (/недопоставк/i.test(name)) return true;
  if (/доукомплект/i.test(name)) return true;
  if (/ожидание\s*оплат/i.test(name)) return true;
  return false;
}

export function createTransferRequestFromBalances(input: {
  warehouseFromId: string;
  warehouseToId: string;
  comment?: string;
  /** true — сразу провести; false — черновик-требование */
  post?: boolean;
  /** Сделка (= заказ покупателя) — для структуры подчинения */
  deal_id?: string;
  /** Явные строки: product_id + qty. Без списка — ошибка (нельзя «всё молча»). */
  lines?: Array<{ product_id?: string; qty?: number }>;
}): {
  id: string;
  number: string;
  lines: number;
  line_details: Array<{ product_id: string; qty: number; sku: string; name: string }>;
  posted: boolean;
  missing_serials: string[];
  comment: string;
  user_comment: string;
  from_label: string;
  to_label: string;
  deal_id: string;
} {
  const fromId = String(input.warehouseFromId || '').trim();
  const toId = String(input.warehouseToId || '').trim();
  if (!fromId) throw new Error('Укажите склад-источник');
  if (!toId) throw new Error('Укажите склад-получатель');
  if (fromId === toId) throw new Error('Склад-получатель должен отличаться от источника');

  const fromWh = get<{ id: string; code: string; name: string }>(
    `SELECT id, IFNULL(code,'') AS code, IFNULL(name,'') AS name FROM warehouses WHERE id = ?`,
    [fromId]
  );
  const toWh = get<{ id: string; code: string; name: string }>(
    `SELECT id, IFNULL(code,'') AS code, IFNULL(name,'') AS name FROM warehouses WHERE id = ?`,
    [toId]
  );
  if (!toWh) throw new Error('Склад-получатель не найден в справочнике');
  if (isAutoSysWarehouse(fromWh)) {
    throw new Error('С этого автосклада нельзя создать заказ на перемещение — перемещения только автоматически');
  }
  if (isAutoSysWarehouse(toWh)) {
    throw new Error('На автосклад нельзя оформить ручной заказ на перемещение — перемещения только автоматически');
  }

  const balances = all<{ product_id: string; qty: number; sku: string; name: string }>(
    `SELECT x.product_id, SUM(x.qty) AS qty,
            IFNULL(MAX(p.sku),'') AS sku, IFNULL(MAX(p.name),'') AS name
     FROM (
       SELECT b.product_id AS product_id, b.qty AS qty
       FROM stock_balances b
       WHERE b.warehouse_id = ? AND b.qty > 0
       UNION ALL
       SELECT r.product_id, r.qty
       FROM product_store_rests r
       WHERE r.warehouse_id = ? AND r.qty > 0
         AND NOT EXISTS (
           SELECT 1 FROM stock_balances b2
           WHERE b2.product_id = r.product_id AND b2.warehouse_id = r.warehouse_id AND b2.qty != 0
         )
     ) x
     JOIN products p ON p.id = x.product_id
     WHERE IFNULL(p.item_kind,'product') != 'service'
     GROUP BY x.product_id
     HAVING SUM(x.qty) > 0
     ORDER BY p.name
     LIMIT 500`,
    [fromId, fromId]
  );
  if (!balances.length) throw new Error('На складе-источнике нет остатков для перемещения');
  const balByProduct = new Map(balances.map((b) => [b.product_id, b]));

  const requested = Array.isArray(input.lines) ? input.lines : [];
  if (!requested.length) {
    throw new Error('Укажите позиции и количество для перемещения');
  }

  const missingSerials: string[] = [];
  const lines: DocLineInput[] = [];
  for (const req of requested) {
    const productId = String(req.product_id || '').trim();
    const wantQty = Number(req.qty);
    if (!productId) continue;
    if (!(wantQty > 0)) throw new Error('Количество должно быть больше нуля');
    const row = balByProduct.get(productId);
    if (!row) {
      throw new Error(`Нет остатка на складе-источнике: ${productId.slice(0, 8)}…`);
    }
    const avail = Number(row.qty) || 0;
    if (wantQty > avail + 1e-9) {
      throw new Error(
        `${row.sku || row.name}: нельзя ${wantQty}, на складе ${avail}`
      );
    }
    const units = all<{ serial: string }>(
      `SELECT serial FROM product_units
       WHERE product_id = ? AND warehouse_id = ? AND status = 'in_stock'
         AND IFNULL(serial,'') != ''
       ORDER BY serial
       LIMIT ?`,
      [productId, fromId, Math.min(500, Math.ceil(wantQty) + 5)]
    );
    const serials = units.map((u) => u.serial).slice(0, Math.round(wantQty));
    const tracked = productRequiresSerials(productId);
    if (tracked && serials.length < Math.round(wantQty)) {
      missingSerials.push(
        `${row.sku || row.name || productId}: марок ${serials.length}/${Math.round(wantQty)}`
      );
    }
    lines.push({
      product_id: productId,
      qty: serials.length && tracked ? serials.length : wantQty,
      serials: serials.length ? serials : [],
      warehouse_id: fromId,
    });
  }
  if (!lines.length) throw new Error('Нет строк для перемещения');

  const wantPost = !!input.post;
  if (wantPost && missingSerials.length) {
    throw new Error(
      `Нельзя провести: нет марок на складе — ${missingSerials.slice(0, 5).join('; ')}`
    );
  }

  const fromLabel =
    [fromWh?.code, fromWh?.name].filter(Boolean).join(' · ') || fromId.slice(0, 8);
  const toLabel = [toWh.code, toWh.name].filter(Boolean).join(' · ') || toId.slice(0, 8);
  const userComment = String(input.comment || '').trim();
  if (!userComment) throw new Error('Укажите комментарий к заказу на перемещение');
  const qtySum = lines.reduce((s, l) => s + (Number(l.qty) || 0), 0);
  const dealId = String(input.deal_id || '').trim();
  const comment = `${userComment} · заказ на перемещение · ${fromLabel} → ${toLabel} · ${lines.length} поз. / ${qtySum} шт.${
    dealId ? ` · сделка ${dealId}` : ''
  }`;

  const id = createDocument({
    doc_type: 'transfer',
    warehouse_id: fromId,
    warehouse_to_id: toId,
    comment,
    deal_id: dealId || undefined,
    basis_order_id: dealId || undefined,
    lines,
    post: wantPost,
    serials_optional: !wantPost,
  });
  const doc = get<{ number: string; posted: number }>(
    `SELECT number, posted FROM stock_docs WHERE id = ?`,
    [id]
  );
  const lineDetails = lines.map((l) => {
    const bal = balByProduct.get(l.product_id);
    return {
      product_id: l.product_id,
      qty: Number(l.qty) || 0,
      sku: bal?.sku || '',
      name: bal?.name || '',
    };
  });
  return {
    id,
    number: String(doc?.number || ''),
    lines: lines.length,
    line_details: lineDetails,
    posted: Boolean(doc?.posted),
    missing_serials: missingSerials,
    comment,
    user_comment: userComment,
    from_label: fromLabel,
    to_label: toLabel,
    deal_id: dealId,
  };
}
