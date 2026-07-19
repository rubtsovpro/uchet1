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
  formatRuMoney,
  getSalesDoc,
  salesDocTypeLabel,
  type OrgProfile,
} from './sales-docs.js';
import type { Row } from './db.js';

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

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 36, info: { Title: `Счёт ${docData.number}` } });
    const chunks: Buffer[] = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.registerFont('DejaVu', findFont('DejaVuSans.ttf'));
    doc.registerFont('DejaVuBold', findFont('DejaVuSans-Bold.ttf'));

    drawInvoiceBankHeader(doc, org);

    const left = doc.page.margins.left;
    const contentW = doc.page.width - doc.page.margins.left - doc.page.margins.right;

    doc
      .font('DejaVuBold')
      .fontSize(13)
      .fillColor('#000')
      .text(
        `Счет на оплату № ${docData.number} от ${formatDocDateRu(String(docData.doc_date))}`,
        left,
        doc.y,
        { width: contentW, align: 'left' }
      );
    doc.moveDown(0.6);
    writeParty(
      doc,
      'Поставщик (исполнитель):',
      `${org.name}, ИНН ${org.inn}, ${org.address}`
    );
    writeParty(
      doc,
      'Покупатель (заказчик):',
      `${docData.counterparty_name || '—'}${docData.buyer_address ? `, ${docData.buyer_address}` : ''}${
        docData.counterparty_inn ? `, ИНН ${docData.counterparty_inn}` : ''
      }`
    );
    doc.moveDown(0.4);

    const rows = lines.map((l, i) => [
      String(i + 1),
      String(l.name || ''),
      String(l.sku || ''),
      String(l.qty ?? ''),
      String(l.unit || 'шт'),
      formatRuMoney(Number(l.price) || 0),
      formatRuMoney((Number(l.amount) || 0) + (Number(l.vat_amount) || 0)),
    ]);
    drawTable(
      doc,
      ['№', 'Товар (Услуга)', 'Код', 'Кол-во', 'Ед.', 'Цена', 'Сумма'],
      [22, 210, 68, 38, 28, 58, 65],
      rows
    );

    writeRightLine(doc, `Итого: ${formatRuMoney(Number(docData.total) || 0)}`);
    writeRightLine(
      doc,
      `В том числе НДС ${vatRate}%: ${formatRuMoney(Number(docData.vat_amount) || 0)}`
    );
    writeRightLine(doc, `Всего к оплате: ${formatRuMoney(Number(docData.total) || 0)}`, {
      bold: true,
    });
    doc.moveDown(0.4);
    resetLeft(doc);
    doc
      .font('DejaVu')
      .fontSize(9)
      .text(
        `Всего наименований ${lines.length}, на сумму ${formatRuMoney(Number(docData.total) || 0)} RUB`,
        left,
        doc.y,
        { width: contentW }
      );
    doc.font('DejaVuBold').text(amountInWordsRu(Number(docData.total) || 0), {
      width: contentW,
    });
    doc.moveDown(1.4);
    resetLeft(doc);
    const signY = doc.y;
    doc.font('DejaVu').fontSize(10);
    doc.text('Предприниматель', left, signY);
    doc.moveTo(left + 110, signY + 12).lineTo(left + 260, signY + 12).stroke('#000');
    doc.text(`/ ${org.short_name || org.director} /`, left + 268, signY);
    doc.text('М.П.', left, signY + 28);

    doc.end();
  });
}

async function buildUpdPdf(docData: DocFull, titlePrefix = 'УПД'): Promise<Buffer> {
  const org = docData.org;
  const lines = docData.lines || [];
  const vatRate = Number(docData.vat_rate) || 0;
  const dateRu = formatDocDateRu(String(docData.doc_date));

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      layout: 'landscape',
      margin: 24,
      info: { Title: `${titlePrefix} ${docData.number}` },
    });
    const chunks: Buffer[] = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.registerFont('DejaVu', findFont('DejaVuSans.ttf'));
    doc.registerFont('DejaVuBold', findFont('DejaVuSans-Bold.ttf'));

    doc.font('DejaVu').fontSize(8).fillColor('#555');
    doc.text('Приложение № 1 к постановлению Правительства РФ от 26.12.2011 № 1137');
    doc.fillColor('#000').font('DejaVuBold').fontSize(12);
    doc.text(
      titlePrefix === 'УПД'
        ? 'Универсальный передаточный документ'
        : 'Счёт-фактура'
    );
    doc.font('DejaVuBold').fontSize(10);
    doc.text(`Счет-фактура № ${docData.number} от ${dateRu}`);
    doc.font('DejaVu').fontSize(9);
    doc.text(`Статус: 1 — счет-фактура и передаточный документ (акт)`);
    doc.text(`Продавец: ${org.name}`);
    doc.text(`Адрес: ${org.address}`);
    doc.text(`ИНН/КПП продавца: ${org.inn}${org.kpp ? ` / ${org.kpp}` : ''}`);
    doc.text(`Покупатель: ${docData.counterparty_name || '—'}`);
    doc.text(`Валюта: Российский рубль, 643`);
    doc.moveDown(0.3);

    const rows = lines.map((l, i) => {
      const total = (Number(l.amount) || 0) + (Number(l.vat_amount) || 0);
      return [
        String(l.sku || ''),
        String(i + 1),
        String(l.name || '').slice(0, 48),
        String(l.unit || 'шт'),
        String(Number(l.qty) || ''),
        formatRuMoney(Number(l.amount) || 0),
        `${vatRate}%`,
        formatRuMoney(Number(l.vat_amount) || 0),
        formatRuMoney(total),
      ];
    });
    drawTable(
      doc,
      ['Код', '№', 'Наименование', 'Ед.', 'Кол-во', 'Без НДС', 'НДС', 'Сумма НДС', 'С НДС'],
      [70, 22, 220, 30, 40, 60, 30, 55, 60],
      rows
    );

    writeRightLine(
      doc,
      `Всего к оплате: ${formatRuMoney(Number(docData.total) || 0)}  (НДС ${formatRuMoney(Number(docData.vat_amount) || 0)})`,
      { bold: true }
    );
    resetLeft(doc);
    doc.font('DejaVu').fontSize(9).text(amountInWordsRu(Number(docData.total) || 0));
    doc.moveDown(0.6);
    doc.text(
      `ИП / уполномоченное лицо ____________________ / ${org.short_name || org.director} /`
    );
    if (org.ogrnip) doc.text(`ОГРНИП ${org.ogrnip}`);
    doc.text(`Основание: сделка Amo #${docData.deal_id || '—'}`);

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

    doc.font('DejaVuBold').fontSize(9).text('ПОСТАВЩИК:');
    doc.font('DejaVu').fontSize(9).text(`${org.name},`);
    doc.text(`ИНН ${org.inn}, ${org.address}`);
    doc.moveDown(0.5);
    doc
      .font('DejaVuBold')
      .fontSize(13)
      .text(`Заказ-наряд № ${docData.number} от ${dateRu}`);
    doc.font('DejaVu').fontSize(9);
    doc.text(`Заказчик: ${docData.counterparty_name || '—'}${docData.buyer_address ? `  ${docData.buyer_address}` : ''}`);
    doc.text('Автомобиль : гос. номер:     VIN:     год вып.     пробег 0');
    doc.text(`Плательщик: ${docData.counterparty_name || '—'}`);
    doc.fillColor('#555').text('в валюте RUB').fillColor('#000');
    doc.moveDown(0.4);

    if (workLines.length) {
      doc
        .font('DejaVuBold')
        .fontSize(10)
        .text(`Выполненные работы по заказ-наряду № ${docData.number} от ${dateShort} г.`);
      drawTable(
        doc,
        ['№', 'Наименование работ', 'Кол.', 'Н/ч', 'Цена', 'Сумма'],
        [22, 250, 40, 40, 60, 65],
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
      .text(`Расходная накладная к заказ-наряду № ${docData.number} от ${dateShort} г.`);
    drawTable(
      doc,
      ['№', 'Наименование, артикул товаров', 'Кол-во', 'Ед.', 'Цена', 'Сумма'],
      [22, 250, 45, 30, 60, 65],
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

/** Бинарный PDF документа продаж. */
export async function renderSalesDocPdf(id: string): Promise<{
  buffer: Buffer;
  filename: string;
  title: string;
} | null> {
  const doc = getSalesDoc(id);
  if (!doc) return null;
  const type = String(doc.doc_type);
  const label = salesDocTypeLabel(type);
  const filename = `${label.replace(/\s+/g, '_')}_${doc.number}.pdf`.replace(/[^\w.\-№а-яА-ЯёЁ]+/gi, '_');

  let buffer: Buffer;
  if (type === 'invoice') buffer = await buildInvoicePdf(doc);
  else if (type === 'workorder') buffer = await buildWorkorderPdf(doc);
  else if (type === 'sf') buffer = await buildUpdPdf(doc, 'Счёт-фактура');
  else buffer = await buildUpdPdf(doc, 'УПД');

  return { buffer, filename, title: `${label} ${doc.number}` };
}
