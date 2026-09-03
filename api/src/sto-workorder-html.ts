/**
 * Вёрстка заказ-наряда 03ф / 03ю: таблицы и сетка полей (не «столбик» из TXT).
 */
import type { OrgProfile } from './organizations.js';
import { orgFacsimileCss, orgFacsimileSignBlockHtml } from './org-stamp.js';
import { duplicateStoHtmlForPrint } from './sto-doc-style.js';
import { formatWarrantyWorksTerm, warrantyTableHtml } from './warranty-settings.js';
import { INTAKE_COMPLETENESS_ITEMS } from './intake-act.js';

/** Без строк работ в §4 — вместо пустой таблицы. */
const WORKS_NONE_TEXT =
  'Работы (услуги) по настоящему заказ-наряду не заказывались и не оказывались.';

export type StoWorkorderMeta = {
  id: string;
  code: string;
  title: string;
  when: string;
  printCopies?: number;
};

export type StoWorkorderFillCtx = {
  number?: string;
  docDate?: string;
  org?: OrgProfile;
  buyerName?: string;
  buyerInn?: string;
  buyerAddress?: string;
  buyerPhone?: string;
  buyerEmail?: string;
  buyerPassport?: string;
  buyerKpp?: string;
  buyerOgrn?: string;
  buyerDirector?: string;
  carBrand?: string;
  carModel?: string;
  carPlate?: string;
  carVin?: string;
  carYear?: string;
  carColor?: string;
  carMileage?: string;
  carFuelLevel?: string;
  completenessChecked?: string[];
  completenessOther?: string;
  keysCount?: string;
  docsLeft?: string;
  docsNote?: string;
  damageNotes?: string;
  city?: string;
  workLines?: Array<{ name: string; sku?: string; qty: number; price: number; amount: number }>;
  partLines?: Array<{ name: string; sku?: string; qty: number; price: number; amount: number }>;
  /** §6 — ЗЧ заказчика; если пусто — в ЗН фраза «не предоставлялись» */
  clientPartLines?: Array<{ name: string; sku?: string; qty: number; price?: number; amount?: number }>;
  /** П. 7.2 из сделки (уже с ☑/☐) */
  paymentOrder?: string;
  paymentForm?: string;
  paymentOrderLegal?: string;
  paymentFormLegal?: string;
  payment103?: string;
  payment103Legal?: string;
  handover104?: string;
  handover104Legal?: string;
  intakePhotoCount?: number;
  /** П. 9.4 */
  contact94?: string;
  contact94Legal?: string;
  staffName?: string;
  /** Кто пригнал ТС (представитель при приёме) */
  carBroughtBy?: string;
  carAuthorityBasis?: string;
  carAuthorityDetails?: string;
  carAuthorityLine?: string;
  /** № СТС — только для п. «Право на АМТС», не для паспорта */
  carStsNumber?: string;
};

function esc(s: unknown): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function cell(v: unknown, dash = '________'): string {
  const t = String(v ?? '').trim();
  return esc(t || dash);
}

function formatRuLongDate(iso: string): string {
  const d = new Date(String(iso).slice(0, 10) + 'T12:00:00');
  if (Number.isNaN(d.getTime())) return '«____» ______________ 20____ г.';
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
  return `«${d.getDate()}» ${months[d.getMonth()]} ${d.getFullYear()} г.`;
}

function emptyRows(n: number, cols: number): string {
  return Array.from({ length: n }, (_, i) => {
    const tds = Array.from({ length: cols }, (_, j) =>
      j === 0 ? `<td class="c">${i + 1}</td>` : `<td>&nbsp;</td>`
    ).join('');
    return `<tr>${tds}</tr>`;
  }).join('\n');
}

function moneyCell(n: number): string {
  const v = Math.round(Number(n) || 0);
  if (!v) return '&nbsp;';
  return esc(v.toLocaleString('ru-RU', { maximumFractionDigits: 0 }));
}

function qtyCell(n: number): string {
  const v = Number(n) || 0;
  if (!v) return '&nbsp;';
  if (Number.isInteger(v)) return esc(String(v));
  return esc(v.toLocaleString('ru-RU', { maximumFractionDigits: 3 }));
}

function worksRowsHtml(
  lines: StoWorkorderFillCtx['workLines'],
  minRows = 4
): string {
  const rows = [...(lines || [])];
  while (rows.length < minRows) {
    rows.push({ name: '', qty: 0, price: 0, amount: 0 });
  }
  return rows
    .map((l, i) => {
      const name = String(l.name || '').trim();
      if (!name) {
        return `<tr><td class="c">${i + 1}</td><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td></tr>`;
      }
      return `<tr>
        <td class="c">${i + 1}</td>
        <td>${esc(name)}</td>
        <td class="r">${qtyCell(l.qty)}</td>
        <td class="r">${moneyCell(l.price)}</td>
        <td class="r">${moneyCell(l.amount)}</td>
      </tr>`;
    })
    .join('\n');
}

function partsRowsHtml(
  lines: StoWorkorderFillCtx['partLines'],
  minRows = 3,
  cols = 5
): string {
  const rows = [...(lines || [])];
  while (rows.length < minRows) {
    rows.push({ name: '', qty: 0, price: 0, amount: 0 });
  }
  return rows
    .map((l, i) => {
      const name = String(l.name || '').trim();
      if (!name) {
        const empty = Array.from({ length: cols - 1 }, () => '<td>&nbsp;</td>').join('');
        return `<tr><td class="c">${i + 1}</td>${empty}</tr>`;
      }
      const title = l.sku ? `${name}, арт. ${l.sku}` : name;
      if (cols === 5) {
        return `<tr>
          <td class="c">${i + 1}</td>
          <td>${esc(title)}</td>
          <td class="r">${qtyCell(l.qty)}</td>
          <td class="r">${moneyCell(l.price)}</td>
          <td class="r">${moneyCell(l.amount)}</td>
        </tr>`;
      }
      return `<tr>
        <td class="c">${i + 1}</td>
        <td>${esc(title)}</td>
        <td class="r">${qtyCell(l.qty)}</td>
        <td class="r">${moneyCell(l.amount)}</td>
      </tr>`;
    })
    .join('\n');
}

function sumLines(lines: StoWorkorderFillCtx['workLines']): number {
  return (lines || []).reduce((s, l) => s + (Number(l.amount) || 0), 0);
}

function gridTable(headers: string[], rowsHtml: string, footer?: string, footerAmount?: string): string {
  const th = headers.map((h) => `<th>${esc(h)}</th>`).join('');
  const foot = footer
    ? `<tr class="total"><td colspan="${Math.max(1, headers.length - 1)}">${esc(
        footer
      )}</td><td class="r">${footerAmount != null && footerAmount !== '' ? esc(footerAmount) : '&nbsp;'}</td></tr>`
    : '';
  return `<table class="grid">
  <thead><tr>${th}</tr></thead>
  <tbody>
  ${rowsHtml}
  ${foot}
  </tbody>
</table>`;
}

function fieldsTable(pairs: Array<[string, string]>): string {
  const rows: string[] = [];
  for (let i = 0; i < pairs.length; i += 2) {
    const a = pairs[i]!;
    const b = pairs[i + 1];
    if (b) {
      rows.push(
        `<tr><th>${esc(a[0])}</th><td>${cell(a[1])}</td><th>${esc(b[0])}</th><td>${cell(
          b[1]
        )}</td></tr>`
      );
    } else {
      rows.push(
        `<tr><th>${esc(a[0])}</th><td colspan="3">${cell(a[1])}</td></tr>`
      );
    }
  }
  return `<table class="fields">${rows.join('\n')}</table>`;
}

function checks(items: string[], checkedLabels?: Set<string>): string {
  const set = checkedLabels || new Set<string>();
  return `<p class="checks">${items
    .map((x) => {
      const base = x.replace(/:.*/, '').trim();
      const on = [...set].some((c) => base.startsWith(c) || c.startsWith(base) || x.includes(c));
      return `${on ? '☑' : '☐'} ${esc(x)}`;
    })
    .join(' &nbsp; ')}</p>`;
}

function woCss(): string {
  return `
    @page { size: A4; margin: 10mm 12mm; }
    body { font-family: "Times New Roman", Times, serif; font-size: 11pt; line-height: 1.25; color: #111; max-width: 190mm; margin: 0 auto; }
    .toolbar { position: sticky; top: 0; background: #f5f5f5; padding: 8px 12px; margin: 0 0 10px; display: flex; gap: 8px; flex-wrap: wrap; }
    .toolbar button, .toolbar a { font: 13px system-ui, sans-serif; padding: 6px 12px; cursor: pointer; text-decoration: none; color: #111; border: 1px solid #bbb; background: #fff; border-radius: 4px; }
    .meta { font-size: 11pt; color: #444; margin: 0 0 8px; border-bottom: 1px solid #ccc; padding-bottom: 6px; }
    h1.doc { font-size: 13pt; text-align: center; margin: 0 0 4px; }
    .sub { text-align: center; font-size: 11pt; margin: 0 0 8px; }
    .lead { margin: 0 0 6px; text-align: justify; }
    h2.sec { font-size: 11pt; margin: 10px 0 4px; font-weight: 700; }
    h3.subsec { font-size: 11pt; margin: 6px 0 3px; font-weight: 700; }
    p { margin: 0 0 4px; text-align: justify; }
    p.note { font-size: 11pt; color: #333; margin: 4px 0 6px; }
    p.checks { margin: 2px 0 6px; text-align: left; }
    table.fields { width: 100%; border-collapse: collapse; margin: 0 0 8px; table-layout: fixed; }
    table.fields th, table.fields td { border: 1px solid #333; padding: 3px 5px; vertical-align: top; font-size: 11pt; }
    table.fields th { width: 18%; background: #f3f3f3; font-weight: 600; text-align: left; }
    table.fields td { width: 32%; }
    table.grid { width: 100%; border-collapse: collapse; margin: 0 0 8px; table-layout: fixed; }
    table.grid th, table.grid td { border: 1px solid #333; padding: 3px 4px; vertical-align: top; font-size: 11pt; text-align: left; }
    table.grid th { background: #f3f3f3; font-weight: 700; text-align: left; }
    table.grid td.c { text-align: center; width: 28px; }
    table.grid td.r { text-align: right; }
    table.grid.warranty th, table.grid.warranty td { text-align: left; }
    table.grid tr.total td { font-weight: 700; background: #fafafa; }
    table.sign { width: 100%; border-collapse: collapse; margin: 10px 0; page-break-inside: avoid; border: none; }
    table.sign td { width: 50%; vertical-align: top; padding: 4px 10px 4px 0; font-size: 11pt; position: relative; border: none; }
    table.sign .org-facsimile { margin-top: 2px; min-height: 26mm; }
    .sign-phase { font-weight: 700; margin: 0 0 4px; }
    .sign-title { font-weight: 700; margin-bottom: 4px; }
    .fill { border-bottom: 1px solid #333; min-height: 1.1em; display: inline-block; min-width: 8em; }
    ${orgFacsimileCss()}
    .sto-copy-label { font-size: 11pt; color: #555; margin: 0 0 6px; font-style: italic; }
    .sto-print-copy + .sto-print-copy { page-break-before: always; break-before: page; }
    @media print { .toolbar { display: none; } body { max-width: none; } }
  `;
}

/** Подписи в 2 колонки без рамок: «Приём» / «Выдача». */
function signPhaseBlockHtml(opts: {
  phase: 'Приём' | 'Выдача';
  signerName: string;
  org?: StoWorkorderFillCtx['org'];
  staffName?: string;
  executorLabel?: string;
}): string {
  const staff = String(opts.staffName || '').trim() || '____________________';
  const job = opts.executorLabel || 'Должность, Ф. И. О.:';
  const signer = cell(opts.signerName, '____________________');
  const execInner = opts.org?.inn
    ? `<div class="sign-title">Исполнитель</div>
    <div style="font-size:11pt;margin-bottom:2px">${esc(job)}</div>
    <div style="margin-bottom:4px">${esc(staff)}</div>
    ${orgFacsimileSignBlockHtml(opts.org.inn, {
      name: String(staff),
      mpLabel: 'М. П. (при наличии)',
    })}`
    : `<div class="sign-title">Исполнитель</div>
    <div style="font-size:11pt">${esc(job)}</div>
    <div>${esc(staff)}</div>
    <div>____________________ (подпись) &nbsp; М. П. (при наличии)</div>`;
  return `<table class="sign">
    <tr>
      <td>
        <div class="sign-phase">${esc(opts.phase)}</div>
        <div class="sign-title">Заказчик</div>
        ________________________ / ${signer}<br/>
        <span style="font-size:11pt;color:#555">(подпись) &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; (Ф. И. О.)</span>
      </td>
      <td>${execInner}</td>
    </tr>
  </table>`;
}

function shell(opts: {
  id: string;
  meta: StoWorkorderMeta;
  title: string;
  body: string;
  printCopies?: number;
}): string {
  const copies = Math.max(1, Math.min(10, Math.floor(Number(opts.printCopies) || 1)));
  const docInner = `<div class="meta"><b>${esc(opts.meta.code)}. ${esc(opts.meta.title)}</b><br/>${esc(
    opts.meta.when
  )}<br/><i>Ключевое правило: нет подписанного документа — нет работ.</i></div>
  ${opts.body}`;
  return `<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="utf-8"/>
  <title>${esc(opts.title)}</title>
  <style>${woCss()}</style>
</head>
<body>
  <div class="toolbar">
    <button type="button" onclick="window.print()">Печать / PDF</button>
    <a href="/api/sto-doc-templates/${encodeURIComponent(opts.id)}/source">Скачать DOCX</a>
  </div>
  ${duplicateStoHtmlForPrint(docInner, copies)}
</body>
</html>`;
}

function ctxVals(ctx: StoWorkorderFillCtx) {
  const org = ctx.org;
  const name = org ? String(org.name || org.short_name || '').trim() : '';
  const nameBare = name.replace(/^Индивидуальный\s+предприниматель\s+/i, '').trim() || name;
  const dateLine = ctx.docDate ? formatRuLongDate(ctx.docDate) : '«____» ______________ 20____ г.';
  const city = (ctx.city || 'Краснодар').trim();
  const brandModel = [ctx.carBrand, ctx.carModel]
    .map((x) => String(x || '').trim())
    .filter(Boolean)
    .join(' ');
  return {
    org,
    nameBare,
    inn: org ? String(org.inn || '').trim() : '',
    ogrnip: org ? String(org.ogrnip || '').trim() : '',
    addr: org ? String(org.address || '').trim() : '',
    phone: org ? String(org.phone || '').trim() : '',
    dateLine,
    city,
    number: String(ctx.number || '').trim(),
    buyerName: String(ctx.buyerName || '').trim(),
    buyerPhone: String(ctx.buyerPhone || '').trim(),
    buyerEmail: String(ctx.buyerEmail || '').trim(),
    buyerPassport: String(ctx.buyerPassport || '').trim(),
    brandModel,
    carYear: String(ctx.carYear || '').trim(),
    carVin: String(ctx.carVin || '').trim(),
    carPlate: String(ctx.carPlate || '').trim(),
    carColor: String(ctx.carColor || '').trim(),
    carMileage: String(ctx.carMileage || '').trim(),
    carFuelLevel: String(ctx.carFuelLevel || '').trim(),
    keysCount: String(ctx.keysCount || '').trim(),
    docsLeft: String(ctx.docsLeft || '').trim(),
    docsNote: String(ctx.docsNote || '').trim(),
    damageNotes: String(ctx.damageNotes || '').trim(),
    completenessOther: String(ctx.completenessOther || '').trim(),
    completenessChecked: Array.isArray(ctx.completenessChecked) ? ctx.completenessChecked : [],
  };
}

function completenessCheckedLabels(ctx: StoWorkorderFillCtx): Set<string> {
  const ids = new Set(ctx.completenessChecked || []);
  const labels = new Set<string>();
  for (const it of INTAKE_COMPLETENESS_ITEMS) {
    if (ids.has(it.id)) labels.add(it.label);
  }
  if (ctx.completenessOther) labels.add('иное');
  return labels;
}

/** 03ф — заказ-наряд для физлица. */
export function renderStoWorkorderPersonHtml(
  meta: StoWorkorderMeta,
  ctx: StoWorkorderFillCtx,
  opts?: { title?: string }
): string {
  const v = ctxVals(ctx);
  const num = v.number || '______';
  const title = opts?.title || meta.title;

  const vehicle = fieldsTable([
    ['Марка, модель', v.brandModel],
    ['Год выпуска', v.carYear],
    ['VIN (номер кузова / шасси)', v.carVin],
    ['Гос. рег. знак', v.carPlate],
    ['№ двигателя', ''],
    ['Цвет', v.carColor],
    ['Пробег по одометру, км', v.carMileage],
    ['Уровень топлива', v.carFuelLevel],
  ]);

  const worksSum = sumLines(ctx.workLines);
  const partsSum = sumLines(ctx.partLines);
  const worksSumStr =
    worksSum > 0
      ? worksSum.toLocaleString('ru-RU', { maximumFractionDigits: 0 })
      : '';
  const partsSumStr =
    partsSum > 0
      ? partsSum.toLocaleString('ru-RU', { maximumFractionDigits: 0 })
      : '';
  const totalSum = worksSum + partsSum;
  const totalSumStr =
    totalSum > 0
      ? totalSum.toLocaleString('ru-RU', { maximumFractionDigits: 0 })
      : '';

  const worksFilled = (ctx.workLines || []).filter((l) => String(l.name || '').trim());
  const works = worksFilled.length
    ? gridTable(
        ['№', 'Наименование работы (услуги)', 'Кол-во', 'Цена, руб.', 'Стоимость, руб.'],
        worksRowsHtml(worksFilled, Math.max(4, worksFilled.length)),
        'Итого работы:',
        worksSumStr
      )
    : `<p>${esc(WORKS_NONE_TEXT)}</p>`;
  const partsExec = gridTable(
    ['№', 'Наименование, артикул, производитель', 'Кол-во', 'Цена, руб.', 'Сумма, руб.'],
    partsRowsHtml(ctx.partLines, Math.max(3, ctx.partLines?.length || 0), 5),
    'Итого запасные части Исполнителя:',
    partsSumStr
  );
  const clientPartLines = (ctx.clientPartLines || []).filter((l) => String(l.name || '').trim());
  const partsClientBlock = clientPartLines.length
    ? `<ol style="margin:0 0 10px;padding-left:22px">
        ${clientPartLines
          .map((l) => {
            const name = String(l.name || '').trim();
            const title = l.sku ? `${name}, арт. ${l.sku}` : name;
            return `<li>${esc(title)}</li>`;
          })
          .join('\n')}
      </ol>
  <p>Состояние и пригодность запасных частей и материалов Заказчика проверены при приёме:
    ☐ пригодны &nbsp; ☐ имеются замечания: ________________________</p>`
    : `<p>Запасные части и материалы Заказчиком не предоставлялись.</p>`;
  const defects = gridTable(
    ['№', 'Узел / система', 'Выявленный дефект, причина', 'Влияет на безопасность (да / нет)'],
    emptyRows(3, 4)
  );
  const extra = gridTable(
    ['№', 'Наименование работы / запасной части', 'Стоимость, руб.', 'Увеличение срока'],
    emptyRows(3, 4),
    'Итого дополнительно:'
  );
  const doneLines = [...(ctx.workLines || []), ...(ctx.partLines || [])];
  const done = gridTable(
    ['№', 'Наименование работы (услуги) / запасной части', 'Кол-во', 'Стоимость, руб.'],
    partsRowsHtml(doneLines, Math.max(3, doneLines.length), 4),
    'Всего к оплате:',
    totalSumStr
  );
  const warranty = warrantyTableHtml({
    startWorks: 'с даты выдачи АМТС',
    startGoods: 'с даты выдачи АМТС',
    sellerInn: ctx.org?.inn,
    esc,
  });

  const body = `
  <p class="lead">ИП ${cell(v.nameBare)}, адрес регистрации по месту жительства ${cell(v.addr)},
  ОГРНИП ${cell(v.ogrnip)}, дата государственной регистрации «____» _______ 20____ г., ИНН ${cell(v.inn)},
  адрес места оказания услуг: ${cell(v.addr)}, тел. ${cell(v.phone)}</p>
  <h1 class="doc">Заказ-наряд № ${esc(num)}</h1>
  <p class="sub">договор на оказание услуг (выполнение работ) по техническому обслуживанию и ремонту
  автомототранспортного средства, заключённый путём акцепта Договора-оферты
  (включает приёмо-сдаточный акт, лист осмотра и согласования дополнительных работ,
  акт сдачи-приёмки выполненных работ и гарантийный талон)</p>
  <p>Дата и время приёма: ${esc(v.dateLine)}, ____ ч ____ мин. &nbsp; Место: ${cell(v.addr, v.addr || v.city || '____________________')}</p>
  <p>Основание: акцепт Договора-оферты, редакция от «____» __________ 20____ г., размещённой в уголке потребителя и на сайте Исполнителя.</p>

  <h2 class="sec">1. Заказчик и его документы</h2>
  <p>1.1. Заказчик (Ф. И. О.): ${cell(v.buyerName)}</p>
  <p>1.2. Телефон: ${cell(v.buyerPhone)}.</p>
  <p>1.3. Документ, удостоверяющий личность (предъявлен, не изымается):
    ${v.buyerPassport ? '☑' : '☐'} паспорт гражданина РФ &nbsp; ☐ иной: ________________;
    серия и номер ${cell(v.buyerPassport)}.</p>
  <p>1.4. Право на АМТС: ${ctx.carStsNumber ? '☑' : '☐'} собственник (свидетельство о регистрации / ПТС)
    ☐ право пользования: ☐ доверенность ☐ договор аренды (лизинга) ☐ путевой лист
    ☐ полис с допуском к управлению ☐ иное; реквизиты документа: ${
      ctx.carStsNumber
        ? cell(`СТС ${String(ctx.carStsNumber).trim()}`)
        : '______________________________'
    }.</p>
<h2 class="sec">2. Сведения об автомототранспортном средстве</h2>
  ${vehicle}

  <h2 class="sec">3. Приёмо-сдаточный акт: комплектность и состояние АМТС при приёме</h2>
  <p>3.1. Заказчик оставляет АМТС Исполнителю для оказания услуг (выполнения работ) на срок, указанный в разделе 7.</p>
  <p>3.2. Комплектность:</p>
  ${checks(
    [
      'запасное колесо',
      'домкрат',
      'набор инструмента',
      'аптечка',
      'огнетушитель',
      'знак аварийной остановки',
      'коврики',
      'автомагнитола',
      'видеорегистратор',
      v.completenessOther ? `иное: ${v.completenessOther}` : 'иное: ______________________',
    ],
    completenessCheckedLabels(ctx)
  )}
  <p>3.3. Ключи и брелоки переданы: ${
    v.keysCount || '____'
  } шт. Документы, оставленные в салоне: ${
    v.docsLeft === 'no' ? '☑' : '☐'
  } нет &nbsp; ${v.docsLeft === 'yes' ? '☑' : '☐'} да: ${
    v.docsLeft === 'yes' && v.docsNote ? esc(v.docsNote) : '__________________________'
  }</p>
  <p>3.4. Видимые наружные повреждения и дефекты (кузов, стёкла, оптика, диски, салон):</p>
  <p>${
    v.damageNotes
      ? esc(v.damageNotes)
      : '______________________________________________________________________________________'
  }</p>
  ${v.damageNotes ? '' : '<p>______________________________________________________________________________________</p>'}
  <p>3.5. Фотофиксация состояния при приёме выполнена: ${
    ctx.intakePhotoCount && ctx.intakePhotoCount > 0 ? esc(String(ctx.intakePhotoCount)) : '____'
  } снимков. Фотоматериалы являются приложением к настоящему заказ-наряду и хранятся у Исполнителя.</p>
  <p>3.6. Заявленные Заказчиком неисправности, цель обращения:</p>
  <p>______________________________________________________________________________________</p>
  <p class="note">Раздел 3 заменяет отдельный приёмо-сдаточный акт: в силу абзаца четвёртого пункта 12 Правил, утверждённых постановлением Правительства РФ от 29.05.2025 № 780, Исполнитель вправе не составлять приёмо-сдаточный акт, если договор содержит информацию о том, что Заказчик оставляет АМТС Исполнителю, а сведения о комплектности, внешнем виде (в том числе цифровые фотографии) и о запасных частях Заказчика содержатся в договоре либо в приложении к нему.</p>

  <h2 class="sec">4. Перечень оказываемых услуг (выполняемых работ)</h2>
  ${works}

  <h2 class="sec">5. Запасные части и материалы Исполнителя</h2>
  ${partsExec}

  <h2 class="sec">6. Запасные части и материалы Заказчика</h2>
  ${partsClientBlock}

  <h2 class="sec">7. Цена, порядок оплаты, сроки и гарантия</h2>
  <p>7.1. Итого к оплате (работы и запасные части Исполнителя): ${
    totalSumStr ? esc(totalSumStr) : '________________'
  } руб. НДС не облагается (УСН / ПСН).</p>
  <p>7.2. Порядок оплаты: ${
    ctx.paymentOrder
      ? esc(ctx.paymentOrder)
      : '☐ после приёмки результата работ &nbsp; ☐ предварительная оплата __________ руб. &nbsp; ☐ иное: __________________'
  }.
    Форма оплаты: ${
      ctx.paymentForm
        ? esc(ctx.paymentForm)
        : '☐ наличными &nbsp; ☐ по карте &nbsp; ☐ безналичный расчёт'
    }.</p>
  <p>7.3. Срок начала работ: «____» __________ 20____ г. Срок окончания работ: «____» __________ 20____ г., ____ ч.</p>
  <p>7.4. Гарантийные сроки: на работы (услуги) — ${esc(formatWarrantyWorksTerm())}; на товары Исполнителя — по таблице п. 10.7. На запчасти и материалы Заказчика гарантия Исполнителем не предоставляется.</p>
  <p>7.5. Срок явки за АМТС после извещения о готовности — 1 (одни) сутки. По истечении этого срока плата за хранение составляет 1 000 (одну тысячу) руб. за сутки, начиная со дня, следующего за днём истечения указанного срока. Если по истечении 1 (одного) месяца с даты начала начисления платы за хранение Заказчик не забрал АМТС, Исполнитель вправе, дважды письменно предупредив Заказчика, реализовать АМТС в порядке пункта 6 статьи 720 ГК РФ.</p>

  <h2 class="sec">8. Согласованные условия и подтверждения Заказчика при приёме АМТС</h2>
  <p>8.1. Извещение о готовности АМТС направляется: ☐ телефонным звонком &nbsp; ☐ СМС-сообщением &nbsp; ☐ сообщением в мессенджере &nbsp; ☐ по электронной почте — по контактам, указанным в разделе 1.</p>
  <p>8.2. Дополнительные работы выполняются только после согласования с Заказчиком. Заказчик подтверждает, что согласование по телефону (с записью разговора), СМС-сообщением, сообщением в мессенджере или по электронной почте с указанных им контактов имеет силу письменного согласования.</p>
  <p>8.3. Заменённые (неисправные) запасные части: ☐ вернуть Заказчику &nbsp; ☐ утилизировать Исполнителем.</p>
  <p>8.4. Предупреждение об особых свойствах АМТС, узлов, запасных частей или материалов, которые могут повлечь их повреждение или утрату при выполнении работ: ☐ не требуется &nbsp; ☐ сделано: __________________________; Заказчик настаивает на выполнении работ: ☐ да &nbsp; ☐ нет.</p>
  <p>8.5. Заказчик с офертой и прейскурантом ознакомлен.</p>
  <p>8.6. Заказчик подтверждает достоверность сообщённых сведений об АМТС и о праве владения им, согласен с составом и стоимостью работ, оставляет АМТС Исполнителю и получил свой экземпляр настоящего заказ-наряда.</p>

  ${signPhaseBlockHtml({
    phase: 'Приём',
    signerName: v.buyerName,
    org: ctx.org,
    staffName: ctx.staffName,
    executorLabel: 'Должность, Ф. И. О. лица, оформившего договор:',
  })}

  <h2 class="sec">9. Лист осмотра (дефектовки) и согласования дополнительных работ</h2>
  <p>9.1. Осмотр проведён: ☐ в присутствии Заказчика &nbsp; ☐ без Заказчика (результаты сообщены дистанционно). Дата осмотра: «____» __________ 20____ г.</p>
  ${defects}
  <p>9.2. Методы:</p>
  ${checks([
    'визуальный осмотр',
    'компьютерная диагностика',
    'измерение',
    'разборка узла',
    'иное: ____________________',
  ])}
  <p>9.3. Дополнительные работы и запасные части, требующие согласования:</p>
  ${extra}
  <p>9.4. Обращение к Заказчику: ${
    ctx.contact94
      ? esc(ctx.contact94)
      : 'дата «____» _______ 20____ г., время ____ ч ____ мин; способ: ☐ лично &nbsp; ☐ телефонный звонок (запись разговора сохранена) &nbsp; ☐ СМС &nbsp; ☐ мессенджер &nbsp; ☐ электронная почта'
  }.</p>
  <p>9.5. Ответ Заказчика: дата «____» _______ 20____ г., время ____ ч ____ мин; решение: ☐ согласовано полностью &nbsp; ☐ согласовано частично (пункты __________) &nbsp; ☐ отказано &nbsp; ☐ ответ не получен.</p>
  <p>9.6. Подтверждающие материалы приобщены к делу заказ-наряда: ☐ аудиозапись &nbsp; ☐ скриншот сообщения &nbsp; ☐ письмо электронной почты &nbsp; ☐ подпись Заказчика ниже.</p>
  <p>9.7. Работы приостановлены с «____» _______ 20____ г. ____ ч по «____» _______ 20____ г. ____ ч; срок оказания услуг продлевается на ______ дней (часов).</p>
  <p>Подпись Заказчика при личном присутствии: ______________________ / ____________________ / (заполняется только при личном согласовании)</p>
  <p>Мастер-приёмщик: ______________________ / ${
    ctx.staffName ? esc(ctx.staffName) : '____________________'
  } /</p>
  <p class="note">Дополнительные работы, не согласованные в порядке пунктов 9.4–9.6, Заказчиком не оплачиваются. При дистанционном согласовании подпись Заказчика в разделе 9 не требуется — достаточно отметок и приобщённых материалов.</p>

  <h2 class="sec">10. Акт сдачи-приёмки выполненных работ и гарантийный талон</h2>
  <p>10.1. Дата и время выдачи АМТС: «____» __________ 20____ г., ____ ч ____ мин. Пробег при выдаче: ${cell(v.carMileage, '______')} км.</p>
  <p>10.2. Фактически выполненные работы и использованные запасные части:</p>
  ${done}
  <p>10.3. ${
    ctx.payment103
      ? esc(ctx.payment103)
      : 'Оплата произведена: ☐ полностью &nbsp; ☐ частично (__________ руб.). Форма: ☐ наличными &nbsp; ☐ по карте &nbsp; ☐ безналичный расчёт. Кассовый чек: ☐ выдан &nbsp; ☐ направлен в электронной форме.'
  }</p>
  <p>10.4. ${
    ctx.handover104
      ? esc(ctx.handover104)
      : 'Комплектность и внешнее состояние АМТС при выдаче соответствуют зафиксированным при приёме: ☐ да &nbsp; ☐ нет (замечания ниже). Фотофиксация при выдаче: ____ снимков.'
  }</p>
  <p>10.5. Замечания Заказчика по явным недостаткам работ и состоянию АМТС: ☐ нет &nbsp; ☐ есть:</p>
  <p>______________________________________________________________________________________</p>
  <p>10.6. Неисправности, угрожающие безопасности дорожного движения: ☐ не обнаружены &nbsp; ☐ обнаружены, Заказчик предупреждён:</p>
  <p>______________________________________________________________________________________</p>
  <p>10.7. Гарантийные сроки (гарантийный талон):</p>
  ${warranty}
  <p>10.8. Гарантия не распространяется на недостатки, вызванные запасными частями и материалами Заказчика, нарушением правил эксплуатации, дорожно-транспортными происшествиями, вмешательством третьих лиц в отремонтированный узел, а также на естественный износ. Обращение по гарантии — к Исполнителю по адресу или телефону, указанным в настоящем заказ-наряде. При споре о причинах недостатков, выявленных в течение гарантийного срока, экспертиза проводится за счёт Исполнителя.</p>
  <p>10.9. Заказчик подтверждает: результат работ проверен с участием Исполнителя и принят; АМТС, документы и заполненный экземпляр настоящего заказ-наряда получены; гарантийные сроки разъяснены; иных претензий по явным недостаткам нет.</p>

  ${signPhaseBlockHtml({
    phase: 'Выдача',
    signerName: v.buyerName,
    org: ctx.org,
    staffName: ctx.staffName,
  })}

  `;

  return shell({ id: meta.id, meta, title, body, printCopies: meta.printCopies ?? 2 });
}

/** 03ю — заказ-наряд для юрлица / партнёра (структура как у 03ф, блок заказчика — юр.). */
export function renderStoWorkorderLegalHtml(
  meta: StoWorkorderMeta,
  ctx: StoWorkorderFillCtx,
  opts?: { title?: string }
): string {
  const v = ctxVals(ctx);
  const num = v.number || '______';
  const title = opts?.title || meta.title;
  const buyerInn = String(ctx.buyerInn || '').trim();
  const buyerKpp = String(ctx.buyerKpp || '').trim();
  const buyerOgrn = String(ctx.buyerOgrn || '').trim();
  const buyerAddr = String(ctx.buyerAddress || '').trim();
  const buyerDir = String(ctx.buyerDirector || '').trim();
  const broughtBy = String(ctx.carBroughtBy || '').trim() || buyerDir;
  const authorityLine =
    String(ctx.carAuthorityLine || '').trim() ||
    (() => {
      const label = String(ctx.carAuthorityBasis || '').trim();
      const det = String(ctx.carAuthorityDetails || '').trim();
      if (!label && !det) return '';
      return det ? `${label}: ${det}` : label;
    })();
  const authorityHtml = authorityLine
    ? cell(authorityLine)
    : '☐ доверенность № ______ от «____» _______ 20____ г. &nbsp; ☐ приказ &nbsp; ☐ путевой лист № ______ &nbsp; ☐ перечень представителей &nbsp; ☐ иное: ________________.';
  const signer = broughtBy || v.buyerName;

  const vehicle = fieldsTable([
    ['Марка, модель', v.brandModel],
    ['Год выпуска', v.carYear],
    ['VIN (номер кузова / шасси)', v.carVin],
    ['Гос. рег. знак', v.carPlate],
    ['№ двигателя', ''],
    ['Цвет', v.carColor],
    ['Пробег по одометру, км', v.carMileage],
    ['Уровень топлива', v.carFuelLevel],
  ]);

  const worksSum = sumLines(ctx.workLines);
  const partsSum = sumLines(ctx.partLines);
  const worksSumStr =
    worksSum > 0 ? worksSum.toLocaleString('ru-RU', { maximumFractionDigits: 0 }) : '';
  const partsSumStr =
    partsSum > 0 ? partsSum.toLocaleString('ru-RU', { maximumFractionDigits: 0 }) : '';
  const totalSum = worksSum + partsSum;
  const totalSumStr =
    totalSum > 0 ? totalSum.toLocaleString('ru-RU', { maximumFractionDigits: 0 }) : '';

  const worksFilled = (ctx.workLines || []).filter((l) => String(l.name || '').trim());
  const works = worksFilled.length
    ? gridTable(
        ['№', 'Наименование работы (услуги)', 'Кол-во', 'Цена, руб.', 'Стоимость, руб.'],
        worksRowsHtml(worksFilled, Math.max(4, worksFilled.length)),
        'Итого работы:',
        worksSumStr
      )
    : `<p>${esc(WORKS_NONE_TEXT)}</p>`;
  const partsExec = gridTable(
    ['№', 'Наименование, артикул, производитель', 'Кол-во', 'Цена, руб.', 'Сумма, руб.'],
    partsRowsHtml(ctx.partLines, Math.max(3, ctx.partLines?.length || 0), 5),
    'Итого запасные части Исполнителя:',
    partsSumStr
  );
  const clientPartLines = (ctx.clientPartLines || []).filter((l) => String(l.name || '').trim());
  const partsClientBlock = clientPartLines.length
    ? `<ol style="margin:0 0 10px;padding-left:22px">
        ${clientPartLines
          .map((l) => {
            const name = String(l.name || '').trim();
            const t = l.sku ? `${name}, арт. ${l.sku}` : name;
            return `<li>${esc(t)}</li>`;
          })
          .join('\n')}
      </ol>
  <p>Состояние и пригодность запасных частей и материалов Заказчика проверены при приёме:
    ☐ пригодны &nbsp; ☐ имеются замечания: ________________________</p>`
    : `<p>Запасные части и материалы Заказчиком не предоставлялись.</p>`;
  const defects = gridTable(
    ['№', 'Узел / система', 'Выявленный дефект, причина', 'Влияет на безопасность (да / нет)'],
    emptyRows(3, 4)
  );
  const extra = gridTable(
    ['№', 'Наименование работы / запасной части', 'Стоимость, руб.', 'Увеличение срока'],
    emptyRows(3, 4),
    'Итого дополнительно:'
  );
  const doneLines = [...(ctx.workLines || []), ...(ctx.partLines || [])];
  const done = gridTable(
    ['№', 'Наименование работы (услуги) / запасной части', 'Кол-во', 'Стоимость, руб.'],
    partsRowsHtml(doneLines, Math.max(3, doneLines.length), 4),
    'Всего к оплате:',
    totalSumStr
  );
  const warranty = warrantyTableHtml({
    startWorks: 'с даты выдачи АМТС',
    startGoods: 'с даты выдачи АМТС',
    sellerInn: ctx.org?.inn,
    esc,
  });

  const body = `
  <p class="lead">ИП ${cell(v.nameBare)}, адрес регистрации по месту жительства ${cell(v.addr)},
  ОГРНИП ${cell(v.ogrnip)}, дата государственной регистрации «____» _______ 20____ г., ИНН ${cell(v.inn)},
  адрес места оказания услуг: ${cell(v.addr)}, тел. ${cell(v.phone)}</p>
  <h1 class="doc">Заказ-наряд № ${esc(num)}</h1>
  <p class="sub">Приложение № 1 к Договору № ${esc(num)} от ${esc(v.dateLine)}
  (включает акт приёма-передачи транспортного средства, лист осмотра и согласования дополнительных работ,
  акт сдачи-приёмки выполненных работ и гарантийный талон)</p>
  <p>Дата и время приёма: ${esc(v.dateLine)}, ____ ч ____ мин. &nbsp; Место: ${cell(v.addr, v.addr || v.city || '____________________')}</p>
  <p>Основание: рамочный Договор с Заказчиком — юридическим лицом / индивидуальным предпринимателем.</p>

  <h2 class="sec">1. Заказчик и его представитель</h2>
  <p>1.1. Заказчик: ${cell(v.buyerName)}</p>
  <p>1.2. ОГРН (ОГРНИП) ${cell(buyerOgrn)}, ИНН ${cell(buyerInn)}, КПП ${cell(buyerKpp)}.</p>
  <p>1.3. Адрес: ${cell(buyerAddr)}</p>
  <p>1.4. Представитель, сдающий транспортное средство (Ф. И. О., должность): ${cell(broughtBy)}</p>
  <p>1.5. Основание полномочий: ${authorityHtml}</p>
  <p>1.6. Контакты для согласований: тел. ${cell(v.buyerPhone)}, e-mail ${cell(v.buyerEmail)}.</p>
  <p>1.7. Право Заказчика на АМТС: ${ctx.carStsNumber ? '☑' : '☐'} собственность
    ☐ аренда (лизинг) ☐ иное: ________________; реквизиты документа: ${
      ctx.carStsNumber
        ? cell(`СТС ${String(ctx.carStsNumber).trim()}`)
        : '______________________________'
    }.</p>

  <h2 class="sec">2. Сведения об автомототранспортном средстве</h2>
  ${vehicle}

  <h2 class="sec">3. Приёмо-сдаточный акт: комплектность и состояние АМТС при приёме</h2>
  <p>3.1. Заказчик оставляет АМТС Исполнителю для оказания услуг (выполнения работ) на срок, указанный в разделе 7.</p>
  <p>3.2. Комплектность:</p>
  ${checks(
    [
      'запасное колесо',
      'домкрат',
      'набор инструмента',
      'аптечка',
      'огнетушитель',
      'знак аварийной остановки',
      'коврики',
      'автомагнитола',
      'видеорегистратор',
      v.completenessOther ? `иное: ${v.completenessOther}` : 'иное: ______________________',
    ],
    completenessCheckedLabels(ctx)
  )}
  <p>3.3. Ключи и брелоки переданы: ${
    v.keysCount || '____'
  } шт. Документы, оставленные в салоне: ${
    v.docsLeft === 'no' ? '☑' : '☐'
  } нет &nbsp; ${v.docsLeft === 'yes' ? '☑' : '☐'} да: ${
    v.docsLeft === 'yes' && v.docsNote ? esc(v.docsNote) : '__________________________'
  }</p>
  <p>3.4. Видимые наружные повреждения и дефекты (кузов, стёкла, оптика, диски, салон):</p>
  <p>${
    v.damageNotes
      ? esc(v.damageNotes)
      : '______________________________________________________________________________________'
  }</p>
  ${v.damageNotes ? '' : '<p>______________________________________________________________________________________</p>'}
  <p>3.5. Фотофиксация состояния при приёме выполнена: ${
    ctx.intakePhotoCount && ctx.intakePhotoCount > 0 ? esc(String(ctx.intakePhotoCount)) : '____'
  } снимков. Фотоматериалы хранятся у Исполнителя.</p>
  <p>3.6. Заявленные Заказчиком неисправности, цель обращения:</p>
  <p>______________________________________________________________________________________</p>

  <h2 class="sec">4. Перечень оказываемых услуг (выполняемых работ)</h2>
  ${works}

  <h2 class="sec">5. Запасные части и материалы Исполнителя</h2>
  ${partsExec}

  <h2 class="sec">6. Запасные части и материалы Заказчика</h2>
  ${partsClientBlock}

  <h2 class="sec">7. Цена, порядок оплаты, сроки и гарантия</h2>
  <p>7.1. Итого к оплате (работы и запасные части Исполнителя): ${
    totalSumStr ? esc(totalSumStr) : '________________'
  } руб. НДС не облагается (УСН / ПСН).</p>
  <p>7.2. Порядок оплаты: ${
    ctx.paymentOrderLegal
      ? esc(ctx.paymentOrderLegal)
      : '☐ предварительная оплата ________ % &nbsp; ☐ по факту приёмки работ &nbsp; ☐ с отсрочкой ______ рабочих дней'
  }.
    Форма: ${
      ctx.paymentFormLegal
        ? esc(ctx.paymentFormLegal)
        : '☐ безналичный расчёт &nbsp; ☐ наличными (в пределах 100 000 руб. по одному договору)'
    }.</p>
  <p>7.3. Срок начала работ: «____» __________ 20____ г. Срок окончания работ: «____» __________ 20____ г., ____ ч.</p>
  <p>7.4. Гарантийные сроки: на работы (услуги) — ${esc(formatWarrantyWorksTerm())}; на товары Исполнителя — по таблице п. 10.7 и Гарантийной политике (приложение к Договору). На запчасти и материалы Заказчика гарантия Исполнителем не предоставляется.</p>
  <p>7.5. Срок явки за АМТС после извещения о готовности — 1 (одни) сутки. По истечении этого срока плата за хранение составляет 1 000 (одну тысячу) руб. за сутки, начиная со дня, следующего за днём истечения указанного срока. Если по истечении 1 (одного) месяца с даты начала начисления платы за хранение Заказчик не забрал АМТС, Исполнитель вправе, дважды письменно предупредив Заказчика, реализовать АМТС в порядке пункта 6 статьи 720 ГК РФ.</p>

  <h2 class="sec">8. Согласованные условия и подтверждения Заказчика при приёме АМТС</h2>
  <p>8.1. Извещение о готовности АМТС направляется: ☐ телефонным звонком &nbsp; ☐ СМС-сообщением &nbsp; ☐ сообщением в мессенджере &nbsp; ☐ по электронной почте — по контактам, указанным в разделе 1.</p>
  <p>8.2. Дополнительные работы выполняются только после согласования с Заказчиком. Заказчик подтверждает, что согласование по телефону (с записью разговора), СМС-сообщением, сообщением в мессенджере или по электронной почте с указанных им контактов имеет силу письменного согласования.</p>
  <p>8.3. Заменённые (неисправные) запасные части: ☐ вернуть Заказчику &nbsp; ☐ утилизировать Исполнителем.</p>
  <p>8.4. Предупреждение об особых свойствах АМТС, узлов, запасных частей или материалов: ☐ не требуется &nbsp; ☐ сделано: __________________________; Заказчик настаивает на выполнении работ: ☐ да &nbsp; ☐ нет.</p>
  <p>8.5. Представитель Заказчика с Договором и прейскурантом ознакомлен.</p>
  <p>8.6. Представитель Заказчика подтверждает достоверность сведений о транспортном средстве и своих полномочий, согласен с составом и стоимостью работ, оставляет АМТС Исполнителю и получил экземпляр настоящего заказ-наряда.</p>

  ${signPhaseBlockHtml({
    phase: 'Приём',
    signerName: signer,
    org: ctx.org,
    staffName: ctx.staffName,
    executorLabel: 'Должность, Ф. И. О. лица, оформившего договор:',
  })}

  <h2 class="sec">9. Лист осмотра (дефектовки) и согласования дополнительных работ</h2>
  <p>9.1. Осмотр проведён: ☐ в присутствии представителя Заказчика &nbsp; ☐ без представителя. Дата осмотра: «____» __________ 20____ г.</p>
  ${defects}
  <p>9.2. Методы:</p>
  ${checks([
    'визуальный осмотр',
    'компьютерная диагностика',
    'измерение',
    'разборка узла',
    'иное: ____________________',
  ])}
  <p>9.3. Дополнительные работы и запасные части, требующие согласования:</p>
  ${extra}
  <p>9.4. Обращение к Заказчику: ${
    ctx.contact94Legal
      ? esc(ctx.contact94Legal)
      : 'дата «____» _______ 20____ г., время ____ ч ____ мин; способ: ☐ лично &nbsp; ☐ телефон &nbsp; ☐ СМС &nbsp; ☐ мессенджер &nbsp; ☐ e-mail'
  }.</p>
  <p>9.5. Ответ Заказчика: дата «____» _______ 20____ г., время ____ ч ____ мин; решение: ☐ согласовано полностью &nbsp; ☐ согласовано частично &nbsp; ☐ отказано &nbsp; ☐ ответ не получен.</p>
  <p>9.6. Подтверждающие материалы: ☐ письмо e-mail &nbsp; ☐ скриншот &nbsp; ☐ аудиозапись &nbsp; ☐ подпись представителя ниже.</p>
  <p class="note">Дополнительные работы, не согласованные в порядке пунктов 9.4–9.6, Заказчиком не оплачиваются.</p>

  <h2 class="sec">10. Акт сдачи-приёмки выполненных работ и гарантийный талон</h2>
  <p>10.1. Дата и время выдачи АМТС: «____» __________ 20____ г., ____ ч ____ мин. Пробег при выдаче: ${cell(v.carMileage, '______')} км.</p>
  <p>10.2. Фактически выполненные работы и использованные запасные части:</p>
  ${done}
  <p>10.3. ${
    ctx.payment103Legal
      ? esc(ctx.payment103Legal)
      : 'Оплата произведена: ☐ полностью &nbsp; ☐ частично (__________ руб.). Форма: ☐ безналичный расчёт &nbsp; ☐ наличными. УПД / счёт-фактура: ☐ выдан &nbsp; ☐ направлен.'
  }</p>
  <p>10.4. ${
    ctx.handover104Legal
      ? esc(ctx.handover104Legal)
      : 'Комплектность и внешнее состояние АМТС при выдаче соответствуют зафиксированным при приёме: ☐ да &nbsp; ☐ нет (замечания ниже). Фотофиксация при выдаче: ____ снимков.'
  }</p>
  <p>10.5. Замечания Заказчика по явным недостаткам работ и состоянию АМТС: ☐ нет &nbsp; ☐ есть:</p>
  <p>______________________________________________________________________________________</p>
  <p>10.6. Неисправности, угрожающие безопасности дорожного движения: ☐ не обнаружены &nbsp; ☐ обнаружены, Заказчик предупреждён:</p>
  <p>______________________________________________________________________________________</p>
  <p>10.7. Гарантийные сроки (гарантийный талон):</p>
  ${warranty}
  <p>10.8. Гарантия не распространяется на недостатки, вызванные запасными частями и материалами Заказчика, нарушением правил эксплуатации, дорожно-транспортными происшествиями, вмешательством третьих лиц в отремонтированный узел, а также на естественный износ.</p>
  <p>10.9. Заказчик подтверждает: результат работ проверен и принят; АМТС, документы и заполненный экземпляр заказ-наряда получены; гарантийные сроки разъяснены; иных претензий по явным недостаткам нет.</p>

  ${signPhaseBlockHtml({
    phase: 'Выдача',
    signerName: signer,
    org: ctx.org,
    staffName: ctx.staffName,
  })}
  `;

  return shell({ id: meta.id, meta, title, body, printCopies: meta.printCopies ?? 2 });
}
