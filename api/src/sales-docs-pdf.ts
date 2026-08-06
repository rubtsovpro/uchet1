/**
 * Генерация PDF (счёт / УПД / заказ-наряд / СФ) через PDFKit.
 * Шрифты: DejaVu (кириллица) с сервера или из assets/.
 */
import PDFDocument from 'pdfkit';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  amountInWordsRu,
  fillContractBuyerFromDeal,
  formatRuMoney,
  formatWorkorderOutHeading,
  formatWorkorderVehicleLine,
  getSalesDoc,
  salesDocTypeLabel,
  type OrgProfile,
} from './sales-docs.js';
import type { Row } from './db.js';
import { drawOrgLogoPdf } from './org-logo.js';
import {
  drawOrgSignPdf,
  drawOrgStampPdf,
  runWithOrgFacsimileAsync,
} from './org-stamp.js';
import { buildInvoicePaymentPurpose, renderPaymentQrPng } from './payment-qr.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

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
  throw new Error(
    `Не найден шрифт ${file}. Установите fonts-dejavu-core или положите TTF в assets/fonts/`
  );
}

function formatDocDateRu(iso: string): string {
  const d = new Date(String(iso).slice(0, 10) + 'T12:00:00');
  if (Number.isNaN(d.getTime())) return String(iso).slice(0, 10);
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

function formatDocDateShort(iso: string): string {
  const s = String(iso).slice(0, 10);
  const [y, m, d] = s.split('-');
  if (!y || !m || !d) return s;
  return `${d}.${m}.${y}`;
}

type DocFull = Row & { lines: Row[]; org: OrgProfile };

function drawTable(
  doc: PDFKit.PDFDocument,
  headers: string[],
  widths: number[],
  rows: string[][],
  startY?: number
): number {
  const x0 = doc.page.margins.left;
  let y = startY ?? doc.y;
  const rowH = 16;
  const font = 'DejaVu';
  const fontBold = 'DejaVuBold';

  const drawRow = (cells: string[], bold: boolean, fill?: string) => {
    const needed = rowH + 4;
    if (y + needed > doc.page.height - doc.page.margins.bottom) {
      doc.addPage();
      y = doc.page.margins.top;
    }
    let x = x0;
    if (fill) {
      doc.save();
      doc.rect(x0, y, widths.reduce((a, b) => a + b, 0), rowH).fill(fill);
      doc.restore();
    }
    doc.font(bold ? fontBold : font).fontSize(8);
    for (let i = 0; i < cells.length; i++) {
      doc.rect(x, y, widths[i], rowH).stroke('#333');
      doc.fillColor('#000').text(cells[i] || '', x + 2, y + 4, {
        width: widths[i] - 4,
        height: rowH - 4,
        ellipsis: true,
        lineBreak: false,
      });
      x += widths[i];
    }
    y += rowH;
  };

  drawRow(headers, true, '#f1f5f9');
  for (const r of rows) drawRow(r, false);
  doc.y = y + 6;
  resetLeft(doc);
  return y + 6;
}

function writeParty(doc: PDFKit.PDFDocument, label: string, text: string): void {
  const left = doc.page.margins.left;
  const width = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  doc.x = left;
  doc.font('DejaVuBold').fontSize(9).fillColor('#000').text(label, left, doc.y, {
    continued: true,
    width,
  });
  doc.font('DejaVu').text(' ' + text, { width });
}

/** После align:'right' PDFKit оставляет x справа — без сброса текст уезжает в узкую колонку. */
function resetLeft(doc: PDFKit.PDFDocument): void {
  doc.x = doc.page.margins.left;
}

function writeRightLine(
  doc: PDFKit.PDFDocument,
  text: string,
  opts?: { bold?: boolean; size?: number }
): void {
  const left = doc.page.margins.left;
  const width = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  doc.font(opts?.bold ? 'DejaVuBold' : 'DejaVu').fontSize(opts?.size ?? 10).fillColor('#000');
  doc.text(text, left, doc.y, { width, align: 'right' });
  resetLeft(doc);
}

function drawInvoiceBankHeader(doc: PDFKit.PDFDocument, org: OrgProfile): void {
  const x0 = doc.page.margins.left;
  const y0 = doc.y;
  const totalW = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const leftW = Math.floor(totalW * 0.58);
  const midW = 48;
  const rightW = totalW - leftW - midW;
  const row1 = 36;
  const row2 = 52;
  const h = row1 + row2;

  doc.rect(x0, y0, totalW, h).stroke('#000');
  doc.moveTo(x0 + leftW, y0).lineTo(x0 + leftW, y0 + h).stroke('#000');
  doc.moveTo(x0 + leftW + midW, y0).lineTo(x0 + leftW + midW, y0 + h).stroke('#000');
  doc.moveTo(x0 + leftW, y0 + row1).lineTo(x0 + totalW, y0 + row1).stroke('#000');
  doc.moveTo(x0, y0 + row1).lineTo(x0 + leftW, y0 + row1).stroke('#000');

  doc.font('DejaVu').fontSize(9).fillColor('#000');
  doc.text(org.bank || '—', x0 + 4, y0 + 4, { width: leftW - 8 });
  doc.fontSize(8).fillColor('#444').text('Банк получателя', x0 + 4, y0 + 22, { width: leftW - 8 });

  doc.fillColor('#000').fontSize(9);
  doc.text('БИК', x0 + leftW + 4, y0 + 6, { width: midW - 6 });
  doc.text(org.bik || '—', x0 + leftW + midW + 4, y0 + 6, { width: rightW - 8 });
  doc.text('Сч. №', x0 + leftW + 4, y0 + row1 / 2 + 8, { width: midW - 6 });
  doc.text(org.ks || '—', x0 + leftW + midW + 4, y0 + row1 / 2 + 8, { width: rightW - 8 });

  doc.text(
    `ИНН ${org.inn || '—'}${org.kpp ? `   КПП ${org.kpp}` : ''}`,
    x0 + 4,
    y0 + row1 + 4,
    { width: leftW - 8 }
  );
  doc.font('DejaVuBold').text('Получатель', x0 + 4, y0 + row1 + 18, { width: leftW - 8 });
  doc.font('DejaVu').text(org.name || '—', x0 + 4, y0 + row1 + 30, { width: leftW - 8 });

  doc.text('Сч. №', x0 + leftW + 4, y0 + row1 + 18, { width: midW - 6 });
  doc.text(org.rs || '—', x0 + leftW + midW + 4, y0 + row1 + 18, { width: rightW - 8 });

  doc.x = x0;
  doc.y = y0 + h + 12;
}

async function buildInvoicePdf(docData: DocFull): Promise<Buffer> {
  const org = docData.org;
  const lines = docData.lines || [];
  const vatRate = Number(docData.vat_rate) || 0;
  const dateRu = formatDocDateRu(String(docData.doc_date));
  const amountNoVat = Number(docData.amount) || 0;
  const vatAmt = Number(docData.vat_amount) || 0;
  const total = Number(docData.total) || 0;
  const purpose = buildInvoicePaymentPurpose({
    number: String(docData.number || ''),
    docDate: String(docData.doc_date || ''),
    amountNoVat,
    vatAmount: vatAmt,
    vatRate,
    total,
  });
  let qrPng: Buffer | null = null;
  try {
    if (org.rs && org.bik) {
      qrPng = await renderPaymentQrPng(org, { sum: total, purpose, scale: 3 });
    }
  } catch {
    qrPng = null;
  }

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 36, info: { Title: `Счёт ${docData.number}` } });
    const chunks: Buffer[] = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.registerFont('DejaVu', findFont('DejaVuSans.ttf'));
    doc.registerFont('DejaVuBold', findFont('DejaVuSans-Bold.ttf'));

    drawOrgLogoPdf(doc, { width: 160, height: 23, gapBelow: 10 });
    drawInvoiceBankHeader(doc, org);

    const left = doc.page.margins.left;
    const contentW = doc.page.width - doc.page.margins.left - doc.page.margins.right;

    doc
      .font('DejaVuBold')
      .fontSize(14)
      .fillColor('#000')
      .text(`Счет на оплату № ${docData.number} от ${dateRu}`, left, doc.y, {
        width: contentW,
        align: 'left',
      });
    doc.moveDown(0.5);
    writeParty(
      doc,
      'Поставщик (исполнитель):',
      `${org.name}, ИНН ${org.inn}${org.kpp ? `, КПП ${org.kpp}` : ''}, ${org.address}${
        org.ogrnip ? `, ОГРНИП ${org.ogrnip}` : ''
      }`
    );
    writeParty(
      doc,
      'Покупатель (заказчик):',
      `${docData.counterparty_name || '—'}${
        docData.counterparty_inn ? `, ИНН ${docData.counterparty_inn}` : ''
      }${docData.buyer_address ? `, ${docData.buyer_address}` : ''}`
    );
    writeParty(
      doc,
      'Основание:',
      docData.deal_id ? `Заказ покупателя № ${docData.deal_id}` : '—'
    );
    doc.moveDown(0.35);

    const rows = lines.map((l, i) => {
      const lineTotal = (Number(l.amount) || 0) + (Number(l.vat_amount) || 0);
      return [
        String(i + 1),
        String(l.name || ''),
        String(l.sku || ''),
        String(l.qty ?? ''),
        String(l.unit || 'шт'),
        formatRuMoney(Number(l.price) || lineTotal),
        formatRuMoney(lineTotal),
      ];
    });
    // На всю ширину области печати (раньше сумма колонок была ~489 при contentW ~523).
    const colBase = [22, 210, 68, 38, 28, 58, 65];
    const colSum = colBase.reduce((a, b) => a + b, 0);
    const colWidths = colBase.map((w) => (w / colSum) * contentW);
    drawTable(
      doc,
      ['№', 'Товары (работы, услуги)', 'Артикул', 'Кол-во', 'Ед.', 'Цена', 'Сумма'],
      colWidths,
      rows
    );

    writeRightLine(doc, `Итого: ${formatRuMoney(total)}`);
    writeRightLine(
      doc,
      vatRate > 0
        ? `В том числе НДС ${vatRate}%: ${formatRuMoney(vatAmt)}`
        : `Без налога (НДС): ${formatRuMoney(0)}`
    );
    writeRightLine(doc, `Всего к оплате: ${formatRuMoney(total)}`, { bold: true });
    doc.moveDown(0.35);
    resetLeft(doc);
    doc
      .font('DejaVu')
      .fontSize(9)
      .text(
        `Всего наименований ${lines.length}, на сумму ${formatRuMoney(total)} руб.`,
        left,
        doc.y,
        { width: contentW }
      );
    doc.font('DejaVuBold').text(amountInWordsRu(total), { width: contentW });
    doc.moveDown(0.5);
    resetLeft(doc);
    doc
      .font('DejaVu')
      .fontSize(8)
      .fillColor('#333')
      .text(
        `Оплата данного счета означает согласие с условиями поставки. Уведомление об оплате обязательно. ` +
          `Назначение платежа: «${purpose}»`,
        left,
        doc.y,
        { width: contentW, align: 'justify' }
      );
    doc.fillColor('#000');

    if (qrPng) {
      doc.moveDown(0.6);
      resetLeft(doc);
      const qrSize = 108;
      const qrY = doc.y;
      if (qrY + qrSize > doc.page.height - doc.page.margins.bottom - 70) {
        doc.addPage();
      }
      const yQr = doc.y;
      doc.image(qrPng, left, yQr, { width: qrSize, height: qrSize });
      doc
        .font('DejaVu')
        .fontSize(8)
        .fillColor('#333')
        .text(
          'QR для оплаты в банковском приложении — реквизиты и назначение подставятся автоматически.',
          left + qrSize + 12,
          yQr + 28,
          { width: contentW - qrSize - 12 }
        );
      doc.fillColor('#000');
      doc.y = Math.max(doc.y, yQr + qrSize);
    }

    doc.moveDown(1.0);
    resetLeft(doc);
    const signY = doc.y;
    doc.font('DejaVu').fontSize(10);
    doc.text('Руководитель', left, signY);
    doc.moveTo(left + 90, signY + 12).lineTo(left + 240, signY + 12).stroke('#000');
    doc.text(`/ ${org.short_name || org.director} /`, left + 248, signY);
    doc.text('М.П.', left, signY + 28);
    drawOrgSignPdf(doc, org.inn, { x: left + 95, y: signY - 18, width: 120, height: 36 });
    drawOrgStampPdf(doc, org.inn, { x: left + 36, y: signY - 8, size: 72 });

    doc.end();
  });
}

/** Код ОКИ по краткому обозначению (минимальный набор для печати УПД). */
function okeiCode(unit: string): string {
  const u = String(unit || '').trim().toLowerCase();
  if (!u || u === 'шт' || u === 'шт.' || u === 'штук') return '796';
  if (u === 'кг') return '166';
  if (u === 'м' || u === 'пог. м' || u === 'п.м') return '006';
  if (u === 'компл' || u === 'комплект') return '839';
  if (u === 'усл' || u === 'усл.' || u === 'услуга') return '876';
  return '—';
}

function cellText(
  doc: PDFKit.PDFDocument,
  text: string,
  x: number,
  y: number,
  w: number,
  h: number,
  opts?: { size?: number; align?: 'left' | 'center' | 'right'; bold?: boolean; pad?: number }
): void {
  const pad = opts?.pad ?? 1.5;
  doc
    .font(opts?.bold ? 'DejaVuBold' : 'DejaVu')
    .fontSize(opts?.size ?? 6.5)
    .fillColor('#000')
    .text(String(text ?? ''), x + pad, y + pad, {
      width: Math.max(4, w - pad * 2),
      height: Math.max(4, h - pad * 2),
      align: opts?.align || 'left',
      ellipsis: true,
      lineBreak: true,
    });
}

function strokeRect(doc: PDFKit.PDFDocument, x: number, y: number, w: number, h: number): void {
  doc.rect(x, y, w, h).stroke('#000');
}

/**
 * УПД / СФ по форме приложения №1 к ПП РФ от 26.12.2011 № 1137 (ландшафт A4).
 */
async function buildUpdPdf(docData: DocFull, titlePrefix = 'УПД'): Promise<Buffer> {
  const org = docData.org;
  const lines = docData.lines || [];
  const vatRate = Number(docData.vat_rate) || 0;
  const dateRu = formatDocDateRu(String(docData.doc_date));
  const dateShort = formatDocDateShort(String(docData.doc_date));
  const isUpd = titlePrefix === 'УПД';
  const buyerName = String(docData.counterparty_name || '—');
  const buyerInn = String(docData.counterparty_inn || '');
  const buyerAddr = String(docData.buyer_address || '');
  const sellerInnKpp = `${org.inn || '—'}${org.kpp ? ` / ${org.kpp}` : ''}`;
  const buyerInnKpp = buyerInn || '—';

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      layout: 'landscape',
      margin: 14,
      info: { Title: `${titlePrefix} ${docData.number}` },
    });
    const chunks: Buffer[] = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.registerFont('DejaVu', findFont('DejaVuSans.ttf'));
    doc.registerFont('DejaVuBold', findFont('DejaVuSans-Bold.ttf'));
    doc.lineWidth(0.6);

    const x0 = doc.page.margins.left;
    const logoBottom = drawOrgLogoPdf(doc, {
      y: doc.page.margins.top,
      width: 140,
      height: 18,
      align: 'right',
      gapBelow: 4,
    });
    const y0 = logoBottom;
    const pageW = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    const pageH = doc.page.height - doc.page.margins.top - doc.page.margins.bottom;
    let y = y0;

    // —— шапка: (статус УПД) | заголовок | ссылка на приложение ——
    const statusW = isUpd ? 118 : 0;
    const appW = 168;
    const midW = pageW - statusW - appW - (isUpd ? 8 : 4);
    const statusH = 46;

    if (isUpd) {
      strokeRect(doc, x0, y, statusW, statusH);
      cellText(doc, 'Статус:', x0, y + 2, statusW, 10, { size: 7, bold: true, align: 'center' });
      cellText(doc, '1', x0, y + 12, statusW, 14, { size: 14, bold: true, align: 'center' });
      cellText(
        doc,
        '1 – счет-фактура и передаточный документ (акт)\n2 – передаточный документ (акт)',
        x0,
        y + 26,
        statusW,
        18,
        { size: 5.5, align: 'left', pad: 3 }
      );
    }

    const midX = x0 + (isUpd ? statusW + 4 : 0);
    cellText(
      doc,
      isUpd ? 'Универсальный передаточный документ' : 'Счет-фактура',
      midX,
      y,
      midW,
      14,
      { size: 11, bold: true }
    );
    cellText(doc, `Счет-фактура № ${docData.number} от ${dateRu}`, midX, y + 14, midW, 12, {
      size: 9,
      bold: true,
    });
    cellText(doc, 'Исправление № —— от ——', midX, y + 26, midW, 10, { size: 7 });
    cellText(doc, '(1)', midX + midW - 24, y + 14, 22, 10, { size: 6, align: 'right' });
    cellText(doc, '(1а)', midX + midW - 24, y + 26, 22, 10, { size: 6, align: 'right' });

    const appX = x0 + pageW - appW;
    cellText(
      doc,
      'Приложение № 1\nк постановлению Правительства\nРоссийской Федерации\nот 26 декабря 2011 г. № 1137\n(в ред. от 23.01.2026 № 26)',
      appX,
      y,
      appW,
      statusH,
      { size: 6, align: 'right' }
    );

    y += statusH + 4;

    // —— реквизиты сторон ——
    const partyLine = (label: string, value: string, mark: string) => {
      const h = 11;
      if (y + h > y0 + pageH - 8) {
        doc.addPage();
        y = y0;
      }
      cellText(doc, label, x0, y, 168, h, { size: 7, bold: true });
      doc
        .moveTo(x0 + 168, y + h - 2)
        .lineTo(x0 + pageW - 28, y + h - 2)
        .stroke('#333');
      cellText(doc, value || '—', x0 + 170, y, pageW - 200, h, { size: 7 });
      cellText(doc, mark, x0 + pageW - 26, y, 26, h, { size: 6, align: 'right' });
      y += h;
    };

    partyLine('Продавец', org.name || '—', '(2)');
    partyLine('Адрес', org.address || '—', '(2а)');
    partyLine('ИНН/КПП продавца', sellerInnKpp, '(2б)');
    partyLine('Грузоотправитель и его адрес', 'он же', '(3)');
    partyLine(
      'Грузополучатель и его адрес',
      [buyerName, buyerAddr].filter(Boolean).join(', ') || '—',
      '(4)'
    );
    partyLine('К платежно-расчетному документу', '—', '(5)');
    if (isUpd) {
      partyLine(
        'Документ об отгрузке',
        `Универсальный передаточный документ № ${docData.number} от ${dateRu}`,
        '(5а)'
      );
    } else {
      partyLine('Документ об отгрузке', '—', '(5а)');
      partyLine('К платежно-расчетному документу (аванс)', '—', '(5б)');
    }
    partyLine('Покупатель', buyerName, '(6)');
    partyLine('Адрес', buyerAddr || '—', '(6а)');
    partyLine('ИНН/КПП покупателя', buyerInnKpp, '(6б)');
    partyLine('Валюта: наименование, код', 'Российский рубль, 643', '(7)');
    y += 3;

    // —— табличная часть (колонки А–11) ——
    // Ширины подобраны под ландшафт A4 (~810 pt).
    const cols: { key: string; w: number; head: string; sub?: string }[] = [
      { key: 'a', w: 22, head: '№\nп/п', sub: 'А' },
      { key: 'b', w: 58, head: 'Код товара/\nработ, услуг', sub: 'Б' },
      { key: '1', w: 168, head: 'Наименование товара (описание\nвыполненных работ, оказанных услуг),\nимущественного права', sub: '1' },
      { key: '1a', w: 28, head: 'Код вида\nтовара', sub: '1а' },
      { key: '2', w: 24, head: 'код', sub: '2' },
      { key: '2a', w: 28, head: 'условное\nобозна-\nчение', sub: '2а' },
      { key: '3', w: 36, head: 'Коли-\nчество\n(объем)', sub: '3' },
      { key: '4', w: 48, head: 'Цена (тариф)\nза единицу\nизмерения', sub: '4' },
      { key: '5', w: 52, head: 'Стоимость\nтоваров без\nналога — всего', sub: '5' },
      { key: '6', w: 36, head: 'В том\nчисле\nсумма\nакциза', sub: '6' },
      { key: '7', w: 30, head: 'Нало-\nговая\nставка', sub: '7' },
      { key: '8', w: 48, head: 'Сумма налога,\nпредъявляемая\nпокупателю', sub: '8' },
      { key: '9', w: 52, head: 'Стоимость\nтоваров с\nналогом —\nвсего', sub: '9' },
      { key: '10', w: 24, head: 'циф-\nровой\nкод', sub: '10' },
      { key: '10a', w: 40, head: 'краткое\nнаимено-\nвание', sub: '10а' },
      { key: '11', w: 48, head: 'Регистрационный\nномер декларации\nна товары', sub: '11' },
    ];
    const tableW = cols.reduce((s, c) => s + c.w, 0);
    const scale = pageW / tableW;
    const widths = cols.map((c) => Math.floor(c.w * scale));
    widths[widths.length - 1] += pageW - widths.reduce((s, w) => s + w, 0);

    const headH = 38;
    const numH = 10;
    const rowH = 18;

    const drawHeader = (yy: number): number => {
      let x = x0;
      for (let i = 0; i < cols.length; i++) {
        strokeRect(doc, x, yy, widths[i], headH);
        cellText(doc, cols[i].head, x, yy, widths[i], headH - numH, {
          size: 5.5,
          align: 'center',
        });
        cellText(doc, cols[i].sub || '', x, yy + headH - numH, widths[i], numH, {
          size: 6,
          bold: true,
          align: 'center',
        });
        x += widths[i];
      }
      return yy + headH;
    };

    y += 2;
    y = drawHeader(y);

    const ensureRowSpace = (need: number) => {
      if (y + need > y0 + pageH - 4) {
        doc.addPage();
        y = y0;
        y = drawHeader(y);
      }
    };

    const amountSum = Number(docData.amount) || 0;
    const vatSum = Number(docData.vat_amount) || 0;
    const totalSum = Number(docData.total) || 0;

    for (let i = 0; i < lines.length; i++) {
      ensureRowSpace(rowH);
      const l = lines[i];
      const amount = Number(l.amount) || 0;
      const vat = Number(l.vat_amount) || 0;
      const total = amount + vat;
      const unit = String(l.unit || 'шт');
      const qty = Number(l.qty) || 0;
      const priceNoVat = qty > 0 ? amount / qty : amount;
      const values = [
        String(i + 1),
        String(l.sku || ''),
        String(l.name || ''),
        '—',
        okeiCode(unit),
        unit,
        qty ? String(qty) : '',
        formatRuMoney(priceNoVat),
        formatRuMoney(amount),
        'без акциза',
        vatRate > 0 ? `${vatRate}%` : 'без НДС',
        formatRuMoney(vat),
        formatRuMoney(total),
        '—',
        '—',
        '—',
      ];
      const aligns: Array<'left' | 'center' | 'right'> = [
        'center',
        'center',
        'left',
        'center',
        'center',
        'center',
        'right',
        'right',
        'right',
        'center',
        'center',
        'right',
        'right',
        'center',
        'center',
        'center',
      ];
      let x = x0;
      for (let c = 0; c < widths.length; c++) {
        strokeRect(doc, x, y, widths[c], rowH);
        cellText(doc, values[c], x, y, widths[c], rowH, {
          size: c === 2 ? 6 : 6.5,
          align: aligns[c],
        });
        x += widths[c];
      }
      y += rowH;
    }

    // пустые строки до минимума визуала бланка
    const minRows = Math.max(0, 3 - lines.length);
    for (let i = 0; i < minRows; i++) {
      ensureRowSpace(rowH);
      let x = x0;
      for (const w of widths) {
        strokeRect(doc, x, y, w, rowH);
        x += w;
      }
      y += rowH;
    }

    // Всего к оплате
    ensureRowSpace(rowH + 2);
    const totalLabelW = widths.slice(0, 8).reduce((s, w) => s + w, 0);
    strokeRect(doc, x0, y, totalLabelW, rowH);
    cellText(doc, 'Всего к оплате', x0, y, totalLabelW, rowH, {
      size: 7,
      bold: true,
      align: 'right',
      pad: 3,
    });
    let tx = x0 + totalLabelW;
    const totVals = [
      formatRuMoney(amountSum),
      'X',
      '',
      formatRuMoney(vatSum),
      formatRuMoney(totalSum),
      '',
      '',
      '',
    ];
    for (let c = 8; c < widths.length; c++) {
      strokeRect(doc, tx, y, widths[c], rowH);
      cellText(doc, totVals[c - 8] || '', tx, y, widths[c], rowH, {
        size: 7,
        bold: true,
        align: 'center',
      });
      tx += widths[c];
    }
    y += rowH + 6;

    // —— подписи руководителя / бухгалтера / ИП ——
    const sigBlockH = 52;
    ensureRowSpace(sigBlockH + 90);
    const leftSigW = Math.floor(pageW * 0.52);
    const rightSigW = pageW - leftSigW - 6;

    const drawSignLine = (x: number, yy: number, w: number, caption: string, name: string) => {
      if (caption) {
        cellText(doc, caption, x, yy, w, 9, { size: 6.5, bold: true });
      }
      const lineY = caption ? yy + 22 : yy + 12;
      doc
        .moveTo(x, lineY)
        .lineTo(x + w * 0.42, lineY)
        .stroke('#000');
      cellText(doc, '(подпись)', x, lineY + 1, w * 0.42, 8, { size: 5, align: 'center' });
      doc
        .moveTo(x + w * 0.46, lineY)
        .lineTo(x + w, lineY)
        .stroke('#000');
      cellText(doc, name || ' ', x + w * 0.46, lineY - 10, w * 0.54, 10, {
        size: 7,
        align: 'center',
      });
      cellText(doc, '(ф.и.о.)', x + w * 0.46, lineY + 1, w * 0.54, 8, { size: 5, align: 'center' });
    };

    drawSignLine(x0, y, leftSigW * 0.48, 'Руководитель организации\nили иное уполномоченное лицо', org.director || '');
    drawSignLine(
      x0 + leftSigW * 0.52,
      y,
      leftSigW * 0.48,
      'Главный бухгалтер\nили иное уполномоченное лицо',
      org.director || ''
    );
    drawSignLine(
      x0 + leftSigW + 6,
      y,
      rightSigW,
      'Индивидуальный предприниматель\nили иное уполномоченное лицо',
      org.short_name || org.director || ''
    );
    drawOrgStampPdf(doc, org.inn, {
      x: x0 + leftSigW + 6 + rightSigW * 0.08,
      y: y - 4,
      size: 70,
    });
    drawOrgSignPdf(doc, org.inn, {
      x: x0 + leftSigW + 6,
      y: y + 8,
      width: 100,
      height: 36,
    });
    y += 36;
    if (org.ogrnip) {
      cellText(
        doc,
        `Реквизиты свидетельства о государственной регистрации ИП: ОГРНИП ${org.ogrnip}`,
        x0 + leftSigW + 6,
        y,
        rightSigW,
        10,
        { size: 6 }
      );
    }
    y += 12;

    // Блок передачи — только для УПД (статус 1). СФ — только подписи продавца.
    if (isUpd) {
      // [8] основание / [9] транспорт
      cellText(doc, 'Основание передачи (сдачи) / получения (приемки)', x0, y, pageW - 40, 9, {
        size: 6.5,
        bold: true,
      });
      cellText(doc, '[8]', x0 + pageW - 24, y, 24, 9, { size: 6, align: 'right' });
      y += 9;
      doc
        .moveTo(x0, y + 10)
        .lineTo(x0 + pageW, y + 10)
        .stroke('#000');
      cellText(
        doc,
        docData.deal_id ? `Сделка / заказ Amo #${docData.deal_id}` : '—',
        x0,
        y,
        pageW,
        10,
        { size: 7 }
      );
      y += 14;
      cellText(doc, 'Данные о транспортировке и грузе', x0, y, pageW - 40, 9, {
        size: 6.5,
        bold: true,
      });
      cellText(doc, '[9]', x0 + pageW - 24, y, 24, 9, { size: 6, align: 'right' });
      y += 9;
      doc
        .moveTo(x0, y + 10)
        .lineTo(x0 + pageW, y + 10)
        .stroke('#000');
      y += 16;

      // передача / приёмка
      const half = Math.floor(pageW / 2) - 4;
      const boxH = 78;
      ensureRowSpace(boxH);
      strokeRect(doc, x0, y, half, boxH);
      strokeRect(doc, x0 + half + 8, y, half, boxH);

      cellText(
        doc,
        'Товар (груз) передал / услуги, результаты\nработ, права сдал',
        x0 + 2,
        y + 2,
        half - 4,
        16,
        { size: 6.5, bold: true }
      );
      cellText(doc, '[10]', x0 + half - 22, y + 2, 20, 8, { size: 6, align: 'right' });
      drawSignLine(x0 + 4, y + 20, half - 8, '', org.short_name || org.director || '');
      cellText(doc, `Дата отгрузки, передачи (сдачи)  ${dateShort}`, x0 + 4, y + 48, half - 8, 10, {
        size: 6.5,
      });
      cellText(doc, '[11]', x0 + half - 22, y + 48, 20, 8, { size: 6, align: 'right' });
      cellText(doc, 'М.П.', x0 + 4, y + 62, 40, 10, { size: 7, bold: true });
      cellText(doc, '[14]', x0 + half - 22, y + 62, 20, 8, { size: 6, align: 'right' });
      drawOrgStampPdf(doc, org.inn, { x: x0 + half * 0.28, y: y + 8, size: 64 });

      const rx = x0 + half + 8;
      cellText(
        doc,
        'Товар (груз) получил / услуги, результаты\nработ, права принял',
        rx + 2,
        y + 2,
        half - 4,
        16,
        { size: 6.5, bold: true }
      );
      cellText(doc, '[15]', rx + half - 22, y + 2, 20, 8, { size: 6, align: 'right' });
      drawSignLine(rx + 4, y + 20, half - 8, '', '');
      cellText(doc, 'Дата получения (приемки)', rx + 4, y + 48, half - 8, 10, { size: 6.5 });
      cellText(doc, '[16]', rx + half - 22, y + 48, 20, 8, { size: 6, align: 'right' });
      cellText(doc, 'М.П.', rx + 4, y + 62, 40, 10, { size: 7, bold: true });
      cellText(doc, '[19]', rx + half - 22, y + 62, 20, 8, { size: 6, align: 'right' });

      y += boxH + 6;
    }

    cellText(doc, amountInWordsRu(totalSum), x0, y, pageW, 10, { size: 7, bold: true });

    doc.end();
  });
}

async function buildWorkorderPdf(docData: DocFull): Promise<Buffer> {
  const org = docData.org;
  const allLines = docData.lines || [];
  const works = allLines.filter((l) => String(l.line_kind) === 'work');
  const goods = allLines.filter((l) => String(l.line_kind) !== 'work');
  const workLines = works.length ? works : [];
  const goodsLines = goods.length ? goods : allLines;
  const vatRate = Number(docData.vat_rate) || 0;
  const dateRu = formatDocDateRu(String(docData.doc_date));
  const dateShort = formatDocDateShort(String(docData.doc_date));
  const sumLines = (arr: Row[]) =>
    arr.reduce((s, l) => s + (Number(l.amount) || 0) + (Number(l.vat_amount) || 0), 0);
  const vatLines = (arr: Row[]) => arr.reduce((s, l) => s + (Number(l.vat_amount) || 0), 0);

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      margin: 36,
      info: { Title: `Заказ-наряд ${docData.number}` },
    });
    const chunks: Buffer[] = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.registerFont('DejaVu', findFont('DejaVuSans.ttf'));
    doc.registerFont('DejaVuBold', findFont('DejaVuSans-Bold.ttf'));

    drawOrgLogoPdf(doc, { width: 160, height: 23, gapBelow: 10 });
    doc.font('DejaVuBold').fontSize(9).text('ИСПОЛНИТЕЛЬ (ПОСТАВЩИК):');
    doc.font('DejaVu').fontSize(9).text(`${org.name}`);
    doc.text(
      `ИНН ${org.inn}${org.kpp ? `, КПП ${org.kpp}` : ''}${org.ogrnip ? `, ОГРНИП ${org.ogrnip}` : ''}`
    );
    doc.text(org.address || '');
    if (org.phone) {
      doc.text(`тел. ${org.phone}`);
    }
    doc.moveDown(0.45);
    doc
      .font('DejaVuBold')
      .fontSize(13)
      .text(`Заказ-наряд № ${docData.number} от ${dateRu}`);
    doc.font('DejaVu').fontSize(9);
    doc.text(
      `Заказчик: ${docData.counterparty_name || '—'}${
        docData.counterparty_inn ? `, ИНН ${docData.counterparty_inn}` : ''
      }${docData.buyer_address ? `, ${docData.buyer_address}` : ''}`
    );
    doc.text(formatWorkorderVehicleLine(docData as Record<string, unknown>));
    doc.text(`Плательщик: ${docData.counterparty_name || '—'}`);
    if (docData.deal_id) {
      doc.text(`Основание: Заказ покупателя № ${docData.deal_id}`);
    }
    doc.fillColor('#555').text('Валюта: российский рубль (RUB)').fillColor('#000');
    doc.moveDown(0.4);

    const contentW = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    const scaleCols = (base: number[]) => {
      const sum = base.reduce((a, b) => a + b, 0) || 1;
      return base.map((w) => (w / sum) * contentW);
    };

    if (workLines.length) {
      doc
        .font('DejaVuBold')
        .fontSize(10)
        .text(`Выполненные работы по заказ-наряду № ${docData.number} от ${dateShort} г.`);
      drawTable(
        doc,
        ['№', 'Наименование работ', 'Кол.', 'Н/ч', 'Цена', 'Сумма'],
        scaleCols([22, 250, 40, 40, 60, 65]),
        workLines.map((l, i) => [
          String(i + 1),
          String(l.name || ''),
          String(l.qty ?? ''),
          String(l.qty ?? ''),
          formatRuMoney(Number(l.price) || 0),
          formatRuMoney((Number(l.amount) || 0) + (Number(l.vat_amount) || 0)),
        ])
      );
      const wt = sumLines(workLines);
      writeRightLine(doc, `Итого работ: ${formatRuMoney(wt)}`, { size: 9 });
      writeRightLine(
        doc,
        `В том числе НДС ${vatRate}%: ${formatRuMoney(vatLines(workLines))}`,
        { size: 9 }
      );
      resetLeft(doc);
      doc.font('DejaVuBold').fontSize(9).text(amountInWordsRu(wt));
      doc.moveDown(0.4);
    }

    doc
      .font('DejaVuBold')
      .fontSize(10)
      .text(formatWorkorderOutHeading(docData as Record<string, unknown>, dateShort));
    drawTable(
      doc,
      ['№', 'Наименование, артикул товаров', 'Кол-во', 'Ед.', 'Цена', 'Сумма'],
      scaleCols([22, 250, 45, 30, 60, 65]),
      goodsLines.map((l, i) => [
        String(i + 1),
        `${l.name || ''}${l.sku ? ` (${l.sku})` : ''}`,
        String(l.qty ?? ''),
        String(l.unit || 'шт'),
        formatRuMoney(Number(l.price) || 0),
        formatRuMoney((Number(l.amount) || 0) + (Number(l.vat_amount) || 0)),
      ])
    );
    const gt = sumLines(goodsLines);
    writeRightLine(doc, `Итого: ${formatRuMoney(gt)}`, { size: 9 });
    writeRightLine(
      doc,
      `В том числе НДС ${vatRate}%: ${formatRuMoney(vatLines(goodsLines))}`,
      { size: 9 }
    );
    doc.moveDown(0.3);
    writeRightLine(
      doc,
      `Итого по заказ-наряду: ${formatRuMoney(Number(docData.total) || 0)}`,
      { bold: true, size: 11 }
    );
    writeRightLine(
      doc,
      `В том числе НДС: ${formatRuMoney(Number(docData.vat_amount) || 0)}`,
      { size: 9 }
    );
    resetLeft(doc);
    doc.font('DejaVuBold').fontSize(9).text(amountInWordsRu(Number(docData.total) || 0));
    doc.moveDown(0.8);
    doc
      .font('DejaVu')
      .fontSize(10)
      .text(`Мастер ____________________ / ${org.master_title || 'Мастер-приемщик'} /`);
    doc.moveDown(0.5);
    doc.font('DejaVuBold').fontSize(9).text('Гарантийные обязательства сторон:');
    doc.font('DejaVu').fontSize(7.5);
    doc.text(
      '1. Гарантийный ремонт при предъявлении талона MRAER. 2. Доставка в сервис — силами клиента. 3. Расходные материалы не гарантируются. 4. Устранение неисправности до 5 рабочих дней. 5. Пневмоэлемент 24 мес., амортизатор/компрессор/рейка 12 мес., электрорейка 6 мес.'
    );
    doc.moveDown(0.6);
    doc.fontSize(9).text(`Заказчик ____________________ / ${docData.counterparty_name || ''} /`);
    doc.text(`Дата: ${dateShort} г.`);

    doc.end();
  });
}

/** Бинарный PDF. facsimile: false | { stamp?, sign? } — без сканов печати/подписи. */
export async function renderSalesDocPdf(
  id: string,
  opts?: { facsimile?: boolean | { stamp?: boolean; sign?: boolean } }
): Promise<{
  buffer: Buffer;
  filename: string;
  title: string;
} | null> {
  const facsimile = opts?.facsimile === undefined ? true : opts.facsimile;
  return runWithOrgFacsimileAsync(facsimile, async () => {
    let doc = getSalesDoc(id);
    if (!doc) return null;
    if (String(doc.doc_type) === 'contract') {
      doc = fillContractBuyerFromDeal(id) || doc;
    }
    const type = String(doc.doc_type);
    const label = salesDocTypeLabel(type);
    const filename = `${label.replace(/\s+/g, '_')}_${doc.number}.pdf`.replace(
      /[^\w.\-№а-яА-ЯёЁ]+/gi,
      '_'
    );

    let buffer: Buffer;
    if (type === 'contract') buffer = await buildContractCoverPdf(doc);
    else if (type === 'invoice') buffer = await buildInvoicePdf(doc);
    else if (type === 'workorder') buffer = await buildWorkorderPdf(doc);
    else if (type === 'sf') buffer = await buildUpdPdf(doc, 'Счёт-фактура');
    else buffer = await buildUpdPdf(doc, 'УПД');

    return { buffer, filename, title: `${label} ${doc.number}` };
  });
}

/** Обложка договора (полный текст — HTML /print). */
async function buildContractCoverPdf(doc: Row & { lines: Row[]; org: OrgProfile }): Promise<Buffer> {
  const font = findFont('DejaVuSans.ttf');
  const fontBold = findFont('DejaVuSans-Bold.ttf');
  const org = doc.org;
  return new Promise((resolve, reject) => {
    const pdf = new PDFDocument({ size: 'A4', margin: 48 });
    const chunks: Buffer[] = [];
    pdf.on('data', (c) => chunks.push(c as Buffer));
    pdf.on('end', () => resolve(Buffer.concat(chunks)));
    pdf.on('error', reject);
    pdf.font(fontBold).fontSize(14).text(`ДОГОВОР № ${doc.number}`, { align: 'center' });
    pdf.moveDown(0.4);
    pdf.font(font).fontSize(11).text('купли-продажи товара и возмездного оказания услуг', {
      align: 'center',
    });
    pdf.moveDown(1);
    pdf.font(fontBold).fontSize(11).text('Исполнитель / Продавец');
    pdf.font(font).fontSize(10);
    pdf.text(String(org.name || ''));
    pdf.text(`ИНН ${org.inn || '—'}  ОГРНИП ${org.ogrnip || '—'}`);
    pdf.text(`Адрес: ${org.address || '—'}`);
    pdf.text(`Р/с ${org.rs || '—'} в ${org.bank || '—'}`);
    pdf.text(`БИК ${org.bik || '—'}  к/с ${org.ks || '—'}`);
    pdf.moveDown(1);
    pdf.font(fontBold).fontSize(11).text('Заказчик / Покупатель');
    pdf.font(font).fontSize(10);
    pdf.text(String(doc.counterparty_name || '—'));
    if (doc.buyer_director) pdf.text(`в лице ${doc.buyer_director}`);
    if (doc.counterparty_inn || doc.buyer_kpp) {
      pdf.text(
        `ИНН ${doc.counterparty_inn || '—'}  КПП ${doc.buyer_kpp || '—'}`
      );
    }
    if (doc.buyer_ogrn) pdf.text(`ОГРН ${doc.buyer_ogrn}`);
    if (doc.buyer_address) pdf.text(`Адрес: ${doc.buyer_address}`);
    if (doc.buyer_rs || doc.buyer_bank) {
      pdf.text(`Р/с ${doc.buyer_rs || '—'} в ${doc.buyer_bank || '—'}`);
    }
    if (doc.buyer_bik || doc.buyer_ks) {
      pdf.text(`БИК ${doc.buyer_bik || '—'}  к/с ${doc.buyer_ks || '—'}`);
    }
    if (doc.buyer_phone) pdf.text(`Тел.: ${doc.buyer_phone}`);
    if (doc.buyer_email) pdf.text(`E-mail: ${doc.buyer_email}`);
    pdf.moveDown(1.2);
    pdf.font(font).fontSize(10).fillColor('#333').text(
      'Полный текст договора (статьи 1–9 и приложения) открывается кнопкой «Печать» / HTML-бланк. Этот PDF — краткая обложка с реквизитами сторон.',
      { align: 'left' }
    );
    drawOrgStampPdf(pdf, org.inn, { x: 72, y: pdf.y + 24, size: 96 });
    pdf.end();
  });
}
