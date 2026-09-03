/**
 * PDF · остатки по складу (для печати / выгрузки из экрана «Остатки»).
 */
import PDFDocument from 'pdfkit';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { all, get } from './db.js';
import { stripDeptSkuSuffix } from './product-display-name.js';
import { sqlExcludeCrossContourProducts, sqlExcludeServices } from './product-kind.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PDF_ROW_LIMIT = 8000;

type CompanyFilter =
  | { mode: 'all' }
  | { mode: 'one'; id: string }
  | { mode: 'in'; ids: string[] }
  | { mode: 'none' };

export type WarehouseBalancePdfRow = {
  code: string;
  sku: string;
  name: string;
  category: string;
  qty: number;
  unit: string;
};

function findFont(file: string): string {
  const candidates = [
    path.resolve(__dirname, '..', 'assets', 'fonts', file),
    `/usr/share/fonts/truetype/dejavu/${file}`,
    `/usr/share/fonts/dejavu/${file}`,
    `/usr/local/share/fonts/${file}`,
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  throw new Error(`Не найден шрифт ${file}`);
}

function formatDateRu(d = new Date()): string {
  const months = [
    'января',
    'февраля',
    'марта',
    'апреля',
    'мая',
    'июня',
    'июля',
    'августа',
    'сентября',
    'октября',
    'ноября',
    'декабря',
  ];
  return `${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()} г.`;
}

function formatQty(qty: number): string {
  const n = Number(qty);
  if (!Number.isFinite(n)) return '0';
  if (Math.abs(n - Math.round(n)) < 0.0001) return String(Math.round(n));
  return n.toFixed(3).replace(/\.?0+$/, '');
}

function measureTextHeight(
  doc: PDFKit.PDFDocument,
  text: string,
  width: number,
  opts?: { bold?: boolean; size?: number; pad?: number; min?: number }
): number {
  const pad = opts?.pad ?? 4;
  const min = opts?.min ?? 16;
  const innerW = Math.max(4, width - pad);
  doc.font(opts?.bold ? 'DejaVuBold' : 'DejaVu').fontSize(opts?.size ?? 8);
  const h = doc.heightOfString(String(text ?? ''), { width: innerW });
  return Math.max(min, h + pad);
}

function drawTable(
  doc: PDFKit.PDFDocument,
  headers: string[],
  widths: number[],
  rows: string[][]
): void {
  const x0 = doc.page.margins.left;
  let y = doc.y;
  const minRowH = 16;
  const fontSize = 8;
  const pad = 4;

  const drawRow = (cells: string[], bold: boolean, fill?: string) => {
    doc.font(bold ? 'DejaVuBold' : 'DejaVu').fontSize(fontSize);
    let rowHeight = minRowH;
    for (let i = 0; i < cells.length; i++) {
      rowHeight = Math.max(
        rowHeight,
        measureTextHeight(doc, cells[i] || '', widths[i], { bold, size: fontSize, pad, min: minRowH })
      );
    }
    if (y + rowHeight + 2 > doc.page.height - doc.page.margins.bottom) {
      doc.addPage();
      y = doc.page.margins.top;
    }
    let x = x0;
    if (fill) {
      doc.save();
      doc.rect(x0, y, widths.reduce((a, b) => a + b, 0), rowHeight).fill(fill);
      doc.restore();
    }
    doc.font(bold ? 'DejaVuBold' : 'DejaVu').fontSize(fontSize);
    for (let i = 0; i < cells.length; i++) {
      doc.rect(x, y, widths[i], rowHeight).stroke('#333');
      doc.fillColor('#000').text(cells[i] || '', x + 2, y + 4, {
        width: widths[i] - pad,
        lineBreak: true,
        ellipsis: false,
      });
      x += widths[i];
    }
    y += rowHeight;
  };

  drawRow(headers, true, '#f1f5f9');
  for (const r of rows) drawRow(r, false);
  doc.y = y + 6;
  doc.x = doc.page.margins.left;
}

function buildBalanceFrom(warehouseId: string, companyFilter: CompanyFilter, q: string): {
  from: string;
  params: Array<string | number>;
} {
  const where: string[] = ['x.qty != 0', 'x.warehouse_id = ?'];
  const params: Array<string | number> = [warehouseId];
  if (companyFilter.mode === 'none') {
    where.push('1 = 0');
  } else if (companyFilter.mode === 'one') {
    where.push("IFNULL(w.company_id,'') = ?");
    params.push(companyFilter.id);
  } else if (companyFilter.mode === 'in') {
    where.push(`IFNULL(w.company_id,'') IN (${companyFilter.ids.map(() => '?').join(',')})`);
    params.push(...companyFilter.ids);
  }
  if (q) {
    const like = `%${q}%`;
    where.push(
      `(p.name LIKE ? OR p.sku LIKE ? OR IFNULL(p.code,'') LIKE ?
        OR IFNULL(p.warehouse_sku,'') LIKE ? OR IFNULL(p.array_sku,'') LIKE ?
        OR IFNULL(c.name,'') LIKE ?)`
    );
    params.push(like, like, like, like, like, like);
  }
  where.push(sqlExcludeServices('p', 'u'));
  where.push(sqlExcludeCrossContourProducts('p', 'co'));
  const whereSql = `WHERE ${where.join(' AND ')}`;
  const from = `
    FROM (
      SELECT b.warehouse_id AS warehouse_id, b.product_id AS product_id, b.qty AS qty
      FROM stock_balances b
      WHERE b.qty != 0 AND b.warehouse_id = ?
      UNION ALL
      SELECT r.warehouse_id, r.product_id, r.qty
      FROM product_store_rests r
      WHERE r.qty != 0 AND r.warehouse_id = ?
        AND NOT EXISTS (
          SELECT 1 FROM stock_balances b2
          WHERE b2.product_id = r.product_id
            AND b2.warehouse_id = r.warehouse_id
            AND b2.qty != 0
        )
    ) x
    JOIN products p ON p.id = x.product_id
    JOIN warehouses w ON w.id = x.warehouse_id
    LEFT JOIN companies co ON co.id = w.company_id
    LEFT JOIN units u ON u.id = p.unit_id
    LEFT JOIN categories c ON c.id = p.category_id
    ${whereSql}`;
  return { from, params: [warehouseId, warehouseId, ...params] };
}

export function listWarehouseBalancePdfRows(opts: {
  warehouseId: string;
  q?: string;
  companyFilter: CompanyFilter;
  limit?: number;
}): {
  rows: WarehouseBalancePdfRow[];
  total: number;
  truncated: boolean;
  warehouse: { id: string; code: string; name: string; company_name: string };
  qtySum: number;
} {
  const warehouseId = String(opts.warehouseId || '').trim();
  const q = String(opts.q || '').trim();
  const limit = Math.min(Math.max(Number(opts.limit) || PDF_ROW_LIMIT, 1), PDF_ROW_LIMIT);
  const wh = get<{ id: string; code: string; name: string; company_name: string }>(
    `SELECT w.id, IFNULL(w.code,'') AS code, IFNULL(w.name,'') AS name,
            IFNULL(co.name,'') AS company_name
     FROM warehouses w
     LEFT JOIN companies co ON co.id = w.company_id
     WHERE w.id = ?`,
    [warehouseId]
  );
  if (!wh) {
    return {
      rows: [],
      total: 0,
      truncated: false,
      warehouse: { id: warehouseId, code: '', name: '', company_name: '' },
      qtySum: 0,
    };
  }
  const { from, params } = buildBalanceFrom(warehouseId, opts.companyFilter, q);
  const total = get<{ c: number }>(`SELECT COUNT(*) AS c ${from}`, params)?.c ?? 0;
  const raw = all<{
    code: string;
    sku: string;
    name: string;
    category: string;
    qty: number;
    unit: string;
  }>(
    `SELECT IFNULL(p.code,'') AS code, IFNULL(p.sku,'') AS sku, IFNULL(p.name,'') AS name,
            IFNULL(c.name,'') AS category, x.qty AS qty, IFNULL(u.short_name,'') AS unit
     ${from}
     ORDER BY p.name COLLATE NOCASE ASC
     LIMIT ?`,
    [...params, limit]
  );
  const qtySum =
    get<{ q: number }>(`SELECT COALESCE(SUM(x.qty),0) AS q ${from}`, params)?.q ?? 0;
  return {
    rows: raw.map((r) => ({
      code: String(r.code || ''),
      sku: stripDeptSkuSuffix(String(r.sku || '')),
      name: String(r.name || ''),
      category: String(r.category || ''),
      qty: Number(r.qty) || 0,
      unit: String(r.unit || ''),
    })),
    total,
    truncated: total > raw.length,
    warehouse: wh,
    qtySum: Number(qtySum) || 0,
  };
}

async function buildPdf(input: {
  warehouse: { code: string; name: string; company_name: string };
  rows: WarehouseBalancePdfRow[];
  total: number;
  truncated: boolean;
  qtySum: number;
  q?: string;
}): Promise<Buffer> {
  const font = findFont('DejaVuSans.ttf');
  const fontBold = findFont('DejaVuSans-Bold.ttf');
  const whLabel = [input.warehouse.code, input.warehouse.name].filter(Boolean).join(' · ') || 'Склад';
  const title = `Остатки · ${whLabel}`;

  return new Promise((resolve, reject) => {
    const pdf = new PDFDocument({
      size: 'A4',
      layout: 'landscape',
      margin: 32,
      info: { Title: title },
    });
    const chunks: Buffer[] = [];
    pdf.on('data', (c) => chunks.push(c as Buffer));
    pdf.on('end', () => resolve(Buffer.concat(chunks)));
    pdf.on('error', reject);
    pdf.registerFont('DejaVu', font);
    pdf.registerFont('DejaVuBold', fontBold);

    const pageW = pdf.page.width - pdf.page.margins.left - pdf.page.margins.right;
    pdf.font('DejaVuBold').fontSize(14).fillColor('#000').text(title, { align: 'left' });
    pdf.moveDown(0.2);
    pdf.font('DejaVu').fontSize(9).fillColor('#444');
    const meta = [
      input.warehouse.company_name ? `Организация: ${input.warehouse.company_name}` : '',
      `Сформировано ${formatDateRu()}`,
      `Позиций: ${input.total}${input.truncated ? ` (в PDF первые ${input.rows.length})` : ''}`,
      `Σ кол-во: ${formatQty(input.qtySum)}`,
      input.q ? `Фильтр: «${input.q}»` : '',
    ]
      .filter(Boolean)
      .join(' · ');
    pdf.text(meta, { width: pageW });
    if (input.truncated) {
      pdf.fillColor('#b45309').text('Показаны не все строки — уточните поиск или выгрузите повторно позже.', {
        width: pageW,
      });
    }
    pdf.moveDown(0.5);
    pdf.fillColor('#000');

    const headers = ['№', 'Код', 'Артикул', 'Номенклатура', 'Категория', 'Кол-во', 'Ед.'];
    const widths = [28, 72, 88, pageW - 28 - 72 - 88 - 110 - 44 - 36, 110, 44, 36];
    const tableRows = input.rows.map((r, i) => [
      String(i + 1),
      r.code || '—',
      r.sku || '—',
      r.name || '—',
      r.category || '—',
      formatQty(r.qty),
      r.unit || '—',
    ]);
    if (!tableRows.length) {
      pdf.font('DejaVu').fontSize(11).text('Нет строк остатков по выбранным условиям.');
    } else {
      drawTable(pdf, headers, widths, tableRows);
    }
    pdf.end();
  });
}

export async function renderWarehouseBalancesPdf(opts: {
  warehouseId: string;
  q?: string;
  companyFilter: CompanyFilter;
}): Promise<{ buffer: Buffer; filename: string; title: string; rowCount: number }> {
  const pack = listWarehouseBalancePdfRows(opts);
  if (!pack.warehouse.id || (!pack.warehouse.code && !pack.warehouse.name)) {
    throw new Error('Склад не найден');
  }
  const whLabel = [pack.warehouse.code, pack.warehouse.name].filter(Boolean).join('_') || 'sklad';
  const safeName = whLabel.replace(/[^\w\u0400-\u04FF.-]+/gi, '_').slice(0, 48);
  const buffer = await buildPdf({
    warehouse: pack.warehouse,
    rows: pack.rows,
    total: pack.total,
    truncated: pack.truncated,
    qtySum: pack.qtySum,
    q: opts.q,
  });
  return {
    buffer,
    filename: `Ostatki_${safeName}.pdf`,
    title: `Остатки · ${pack.warehouse.code || pack.warehouse.name}`,
    rowCount: pack.rows.length,
  };
}
