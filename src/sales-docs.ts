/**
 * Журналы: Счёт, УПД, Заказ-наряд (и СФ).
 * Бланки по образцам 1С ПневмоПро / ИП Безматерных Р.П.
 */
import { all, get, run, type Row } from './db.js';
import { newGuid, nextCode } from './ids.js';
import { getDeal } from './deals.js';

export type SalesDocType = 'invoice' | 'upd' | 'sf' | 'workorder';

export type OrgProfile = {
  name: string;
  short_name: string;
  inn: string;
  kpp: string;
  ogrnip: string;
  address: string;
  phone: string;
  bank: string;
  bik: string;
  rs: string;
  ks: string;
  director: string;
  accountant: string;
  master_title: string;
  vat_rate: number;
};

/** Реквизиты из рабочих бланков 1С (счёт / УПД / заказ-наряд). */
export const DEFAULT_ORG: OrgProfile = {
  name: 'Индивидуальный предприниматель Безматерных Роман Павлович',
  short_name: 'Безматерных Р.П.',
  inn: '231215603728',
  kpp: '',
  ogrnip: '322237500133521',
  address: '350000, Краснодарский край, Селезнева, д. 84, кв. 73',
  phone: '',
  bank: 'ООО "Банк Точка" г. Москва',
  bik: '044525104',
  rs: '40802810109500030587',
  ks: '30101810745374525104',
  director: 'Безматерных Р.П.',
  accountant: '',
  master_title: 'Мастер-приемщик Пневмоподвеска №1',
  vat_rate: 5,
};

const TYPE_LABEL: Record<SalesDocType, string> = {
  invoice: 'Счёт на оплату',
  upd: 'УПД',
  sf: 'Счёт-фактура',
  workorder: 'Заказ-наряд',
};

const TYPE_PREFIX: Record<SalesDocType, string> = {
  invoice: '',
  upd: 'НФ',
  sf: 'НФ',
  workorder: 'НФ',
};

const WORK_RE =
  /(снять\/установить|проверить\/исправить|осмотр|диагностик|ремонт|регулир|замен[аы].*работ|н\/ч|нормочас)/i;

export function salesDocTypeLabel(t: string): string {
  return TYPE_LABEL[t as SalesDocType] || t;
}

export function ensureOrgProfileSeeded(): void {
  const row = get<{ value: string }>('SELECT value FROM meta WHERE key = ?', ['org_profile']);
  if (row?.value) {
    try {
      const cur = JSON.parse(row.value) as Partial<OrgProfile>;
      const placeholder =
        !cur.inn ||
        /М\.П\.\s*\(Пневмоподвеска\)/i.test(String(cur.name || '')) ||
        String(cur.name || '').includes('Пневмоподвеска)');
      if (placeholder) {
        run('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)', [
          'org_profile',
          JSON.stringify({ ...DEFAULT_ORG, ...cur, ...pickFilled(cur), inn: cur.inn || DEFAULT_ORG.inn }),
        ]);
        // если это старый плейсхолдер — полностью заменить на рабочие реквизиты
        if (!cur.inn || /М\.П\.\s*\(Пневмоподвеска\)/i.test(String(cur.name || ''))) {
          run('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)', [
            'org_profile',
            JSON.stringify(DEFAULT_ORG),
          ]);
        }
      }
    } catch {
      /* ignore */
    }
    return;
  }
  run('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)', [
    'org_profile',
    JSON.stringify(DEFAULT_ORG),
  ]);
}

function pickFilled(cur: Partial<OrgProfile>): Partial<OrgProfile> {
  const out: Partial<OrgProfile> = {};
  for (const [k, v] of Object.entries(cur)) {
    if (v !== '' && v !== undefined && v !== null) (out as Record<string, unknown>)[k] = v;
  }
  return out;
}

export function getOrgProfile(): OrgProfile {
  ensureOrgProfileSeeded();
  const row = get<{ value: string }>('SELECT value FROM meta WHERE key = ?', ['org_profile']);
  if (!row?.value) return { ...DEFAULT_ORG };
  try {
    return { ...DEFAULT_ORG, ...(JSON.parse(row.value) as Partial<OrgProfile>) };
  } catch {
    return { ...DEFAULT_ORG };
  }
}

export function saveOrgProfile(patch: Partial<OrgProfile> & Record<string, unknown>): OrgProfile {
  const next: OrgProfile = { ...getOrgProfile() };
  for (const [k, v] of Object.entries(patch)) {
    if (k === 'vat_rate') {
      next.vat_rate = Number(v) || 5;
    } else if (k in DEFAULT_ORG && typeof v === 'string') {
      (next as Record<string, unknown>)[k] = v;
    }
  }
  run('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)', [
    'org_profile',
    JSON.stringify(next),
  ]);
  return next;
}

function money(n: number): string {
  return (Math.round(n * 100) / 100).toFixed(2);
}

/** 87900.5 → «87 900,50» */
export function formatRuMoney(n: number): string {
  const [r, k] = money(n).split('.');
  return `${r.replace(/\B(?=(\d{3})+(?!\d))/g, ' ')},${k}`;
}

function splitVat(totalIncl: number, vatRate: number): { amount: number; vat: number; total: number } {
  const total = Math.round(totalIncl * 100) / 100;
  if (!(vatRate > 0)) return { amount: total, vat: 0, total };
  const amount = Math.round((total / (1 + vatRate / 100)) * 100) / 100;
  const vat = Math.round((total - amount) * 100) / 100;
  return { amount, vat, total };
}

function guessLineKind(sku: string, name: string, productGuid: string): 'work' | 'goods' {
  if (WORK_RE.test(name) && !sku) return 'work';
  if (WORK_RE.test(name) && !productGuid) return 'work';
  if (WORK_RE.test(name) && sku.length < 4) return 'work';
  return 'goods';
}

/** Сумма прописью (рубли и копейки). */
export function amountInWordsRu(sum: number): string {
  const n = Math.round(Math.abs(sum) * 100);
  const rub = Math.floor(n / 100);
  const kop = n % 100;
  const ones = [
    '',
    'один',
    'два',
    'три',
    'четыре',
    'пять',
    'шесть',
    'семь',
    'восемь',
    'девять',
  ];
  const onesF = [
    '',
    'одна',
    'две',
    'три',
    'четыре',
    'пять',
    'шесть',
    'семь',
    'восемь',
    'девять',
  ];
  const teens = [
    'десять',
    'одиннадцать',
    'двенадцать',
    'тринадцать',
    'четырнадцать',
    'пятнадцать',
    'шестнадцать',
    'семнадцать',
    'восемнадцать',
    'девятнадцать',
  ];
  const tens = [
    '',
    '',
    'двадцать',
    'тридцать',
    'сорок',
    'пятьдесят',
    'шестьдесят',
    'семьдесят',
    'восемьдесят',
    'девяносто',
  ];
  const hundreds = [
    '',
    'сто',
    'двести',
    'триста',
    'четыреста',
    'пятьсот',
    'шестьсот',
    'семьсот',
    'восемьсот',
    'девятьсот',
  ];

  function triad(num: number, female: boolean): string {
    const h = Math.floor(num / 100);
    const t = Math.floor((num % 100) / 10);
    const o = num % 10;
    const parts: string[] = [];
    if (h) parts.push(hundreds[h]);
    if (t === 1) {
      parts.push(teens[o]);
    } else {
      if (t) parts.push(tens[t]);
      if (o) parts.push(female ? onesF[o] : ones[o]);
    }
    return parts.join(' ');
  }

  function morph(n: number, a: string, b: string, c: string): string {
    const n10 = n % 10;
    const n100 = n % 100;
    if (n10 === 1 && n100 !== 11) return a;
    if (n10 >= 2 && n10 <= 4 && (n100 < 10 || n100 >= 20)) return b;
    return c;
  }

  if (rub === 0) {
    return `Ноль рублей ${String(kop).padStart(2, '0')} копеек`;
  }

  const millions = Math.floor(rub / 1_000_000);
  const thousands = Math.floor((rub % 1_000_000) / 1000);
  const rest = rub % 1000;
  const parts: string[] = [];
  if (millions) {
    parts.push(
      triad(millions, false),
      morph(millions, 'миллион', 'миллиона', 'миллионов')
    );
  }
  if (thousands) {
    parts.push(
      triad(thousands, true),
      morph(thousands, 'тысяча', 'тысячи', 'тысяч')
    );
  }
  if (rest || (!millions && !thousands)) {
    parts.push(triad(rest, false));
  }
  parts.push(morph(rub, 'рубль', 'рубля', 'рублей'));
  const words = parts.filter(Boolean).join(' ');
  const capitalized = words.charAt(0).toUpperCase() + words.slice(1);
  return `${capitalized} ${String(kop).padStart(2, '0')} копеек`;
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

function nextSalesNumber(docType: SalesDocType): string {
  const prefix = TYPE_PREFIX[docType];
  if (!prefix) {
    // счёт: просто число, как в 1С (22640)
    const key = 'seq_invoice_num';
    run('BEGIN');
    try {
      const row = get<{ value: string }>('SELECT value FROM meta WHERE key = ?', [key]);
      // стартуем с «логического» диапазона, чтобы не путать с 1С, но выглядело так же
      const n = (row ? Number(row.value) : 90000) + 1;
      run('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)', [key, String(n)]);
      run('COMMIT');
      return String(n);
    } catch (e) {
      try {
        run('ROLLBACK');
      } catch {
        /* ignore */
      }
      throw e;
    }
  }
  return nextCode(prefix, 5);
}

export function listSalesDocs(opts: {
  type?: SalesDocType | '';
  q?: string;
  limit?: number;
}) {
  const type = opts.type || '';
  const q = (opts.q || '').trim();
  const limit = Math.min(500, Math.max(1, opts.limit ?? 200));
  const where: string[] = [];
  const params: Array<string | number> = [];
  if (type) {
    where.push('doc_type = ?');
    params.push(type);
  }
  if (q) {
    where.push(
      `(number LIKE ? OR counterparty_name LIKE ? OR deal_id LIKE ? OR comment LIKE ?)`
    );
    const like = `%${q}%`;
    params.push(like, like, like, like);
  }
  const sqlWhere = where.length ? `WHERE ${where.join(' AND ')}` : '';
  params.push(limit);
  return all(
    `SELECT id, doc_type, number, doc_date, deal_id, counterparty_name, counterparty_inn,
            amount, vat_rate, vat_amount, total, status, comment, created_at
     FROM sales_docs
     ${sqlWhere}
     ORDER BY datetime(doc_date) DESC, number DESC
     LIMIT ?`,
    params
  );
}

export function getSalesDoc(id: string): (Row & { lines: Row[]; org: OrgProfile }) | null {
  const doc = get('SELECT * FROM sales_docs WHERE id = ?', [id]);
  if (!doc) return null;
  const lines = all(
    `SELECT * FROM sales_doc_lines WHERE doc_id = ? ORDER BY line_no, name`,
    [id]
  );
  return { ...doc, lines, org: getOrgProfile() };
}

export function createSalesDocFromDeal(input: {
  dealId: string;
  docType: SalesDocType;
  vatRate?: number;
  buyerName?: string;
  buyerInn?: string;
  buyerPhone?: string;
  comment?: string;
  createdBy?: string;
}) {
  const deal = getDeal(input.dealId) as
    | (Row & { items: Array<Record<string, unknown>>; documents: unknown[] })
    | null;
  if (!deal) throw new Error('Сделка не найдена');
  const items = deal.items || [];
  if (!items.length) {
    throw new Error('В сделке нет позиций — сначала добавьте товары в виджете amo1c');
  }

  const org = getOrgProfile();
  const vatRate = input.vatRate ?? (Number(org.vat_rate) || 5);
  const id = newGuid();
  const number = nextSalesNumber(input.docType);
  const docDate = new Date().toISOString().slice(0, 10);
  const dealIdStr = String(deal.id || input.dealId);
  const buyerName =
    (input.buyerName || '').trim() ||
    String(deal.name || '').replace(/\s+mraer$/i, '').trim() ||
    `Покупатель (сделка ${dealIdStr})`;
  const buyerInn = (input.buyerInn || '').trim();
  const buyerPhone = (input.buyerPhone || '').trim();

  let sumTotal = 0;
  const lines: Array<{
    id: string;
    product_guid: string;
    sku: string;
    name: string;
    unit: string;
    qty: number;
    price: number;
    amount: number;
    vat_amount: number;
    line_no: number;
    line_kind: string;
  }> = [];

  items.forEach((it, idx) => {
    const qty = Number(it.qty) || 0;
    const price = Number(it.price) || 0;
    const lineTotal = Number(it.amount) || qty * price;
    const split = splitVat(lineTotal, vatRate);
    sumTotal += split.total;
    const sku = String(it.sku || it.code || '');
    const name = String(it.name || 'Товар');
    const productGuid = String(it.product_guid || '');
    lines.push({
      id: newGuid(),
      product_guid: productGuid,
      sku,
      name,
      unit: String(it.unit || 'шт'),
      qty,
      price,
      amount: split.amount,
      vat_amount: split.vat,
      line_no: idx + 1,
      line_kind: guessLineKind(sku, name, productGuid),
    });
  });

  const head = splitVat(sumTotal, vatRate);
  const buyerAddress = buyerPhone ? `тел.: ${buyerPhone}` : '';

  run('BEGIN');
  try {
    run(
      `INSERT INTO sales_docs (
         id, doc_type, number, doc_date, deal_id,
         counterparty_name, counterparty_inn, buyer_address,
         amount, vat_rate, vat_amount, total, status, comment, created_by
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'issued', ?, ?)`,
      [
        id,
        input.docType,
        number,
        docDate,
        dealIdStr,
        buyerName,
        buyerInn,
        buyerAddress,
        head.amount,
        vatRate,
        head.vat,
        head.total,
        (input.comment || '').trim() || `Из сделки Amo #${dealIdStr}`,
        input.createdBy || '',
      ]
    );
    for (const line of lines) {
      run(
        `INSERT INTO sales_doc_lines (
           id, doc_id, line_no, product_guid, sku, name, unit, qty, price, amount, vat_amount, line_kind
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          line.id,
          id,
          line.line_no,
          line.product_guid,
          line.sku,
          line.name,
          line.unit,
          line.qty,
          line.price,
          line.amount,
          line.vat_amount,
          line.line_kind,
        ]
      );
    }
    run('COMMIT');
  } catch (e) {
    try {
      run('ROLLBACK');
    } catch {
      /* ignore */
    }
    throw e;
  }

  return getSalesDoc(id);
}

function escHtml(s: unknown): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function printShell(title: string, body: string): string {
  return `<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="UTF-8" />
  <title>${escHtml(title)}</title>
  <style>
    @page { size: A4; margin: 10mm; }
    * { box-sizing: border-box; }
    body { font-family: "Times New Roman", Times, serif; font-size: 11px; color: #000; margin: 12px; }
    h1 { font-size: 14px; margin: 10px 0 8px; font-weight: 700; }
    h2 { font-size: 12px; margin: 14px 0 6px; }
    .muted { color: #444; font-size: 10px; }
    table.grid { width: 100%; border-collapse: collapse; margin: 6px 0; }
    table.grid th, table.grid td { border: 1px solid #000; padding: 3px 5px; vertical-align: top; }
    table.grid th { font-weight: 700; text-align: center; background: #f7f7f7; }
    .c { text-align: center; }
    .r { text-align: right; white-space: nowrap; }
    .l { text-align: left; }
    .bank { width: 100%; border-collapse: collapse; margin-bottom: 8px; }
    .bank td { border: 1px solid #000; padding: 4px 6px; vertical-align: top; }
    .party { margin: 4px 0; line-height: 1.35; }
    .totals { margin-top: 6px; text-align: right; line-height: 1.45; }
    .words { margin: 6px 0; font-weight: 700; }
    .sign { display: flex; gap: 24px; margin-top: 18px; }
    .sign > div { flex: 1; }
    .sign .line { border-bottom: 1px solid #000; height: 18px; margin: 8px 0 2px; }
    .warranty { font-size: 10px; line-height: 1.35; margin-top: 10px; }
    .warranty ol { margin: 4px 0 4px 18px; padding: 0; }
    .toolbar { margin-bottom: 10px; }
    .toolbar button { font-family: Tahoma, sans-serif; padding: 6px 14px; cursor: pointer; background: #ffd54f; border: 1px solid #b89600; font-weight: 600; }
    .status-box { float: right; border: 1px solid #000; padding: 4px 8px; font-size: 10px; width: 160px; text-align: left; }
    .clear { clear: both; }
    @media print { .toolbar { display: none !important; } body { margin: 0; } }
  </style>
</head>
<body>
  <div class="toolbar"><button type="button" onclick="window.print()">Печать / сохранить PDF</button></div>
  ${body}
</body>
</html>`;
}

function renderInvoiceHtml(doc: Row & { lines: Row[]; org: OrgProfile }): string {
  const org = doc.org;
  const lines = doc.lines || [];
  const vatRate = Number(doc.vat_rate) || 0;
  const rows = lines
    .map(
      (l, i) => `
      <tr>
        <td class="c">${i + 1}</td>
        <td class="l">${escHtml(l.name)}</td>
        <td class="c">${escHtml(l.sku || '')}</td>
        <td class="r">${escHtml(Number(l.qty).toFixed(0) === String(Number(l.qty)) ? Number(l.qty) : Number(l.qty).toFixed(3))}</td>
        <td class="c">${escHtml(l.unit || 'шт')}</td>
        <td class="r">${formatRuMoney(Number(l.price) || 0)}</td>
        <td class="r">${formatRuMoney((Number(l.amount) || 0) + (Number(l.vat_amount) || 0))}</td>
      </tr>`
    )
    .join('');

  const body = `
  <table class="bank">
    <tr>
      <td rowspan="2" style="width:58%">
        <div>${escHtml(org.bank)}</div>
        <div class="muted">Банк получателя</div>
      </td>
      <td style="width:12%">БИК</td>
      <td>${escHtml(org.bik)}</td>
    </tr>
    <tr>
      <td>Сч. №</td>
      <td>${escHtml(org.ks)}</td>
    </tr>
    <tr>
      <td>
        ИНН ${escHtml(org.inn)}${org.kpp ? ` &nbsp; КПП ${escHtml(org.kpp)}` : ''}<br/>
        <b>Получатель</b><br/>
        ${escHtml(org.name)}
      </td>
      <td>Сч. №</td>
      <td>${escHtml(org.rs)}</td>
    </tr>
  </table>
  <h1>Счет на оплату № ${escHtml(doc.number)} от ${escHtml(formatDocDateRu(String(doc.doc_date)))}</h1>
  <div class="party"><b>Поставщик (исполнитель):</b> ${escHtml(org.name)}, ИНН ${escHtml(org.inn)}, ${escHtml(org.address)}</div>
  <div class="party"><b>Покупатель (заказчик):</b> ${escHtml(doc.counterparty_name || '—')}${
    doc.buyer_address ? `, ${escHtml(doc.buyer_address)}` : ''
  }${doc.counterparty_inn ? `, ИНН ${escHtml(doc.counterparty_inn)}` : ''}</div>
  <table class="grid">
    <thead>
      <tr>
        <th>№</th><th>Товар (Услуга)</th><th>Код</th><th>Кол-во</th><th>Ед.</th><th>Цена</th><th>Сумма</th>
      </tr>
      <tr class="muted"><th>1</th><th>2</th><th>3</th><th>4</th><th>5</th><th>6</th><th>7</th></tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>
  <div class="totals">
    <div>Итого: <b>${formatRuMoney(Number(doc.total) || 0)}</b></div>
    <div>В том числе НДС ${vatRate}%: <b>${formatRuMoney(Number(doc.vat_amount) || 0)}</b></div>
    <div>Всего к оплате: <b>${formatRuMoney(Number(doc.total) || 0)}</b></div>
  </div>
  <div>Всего наименований ${lines.length}, на сумму ${formatRuMoney(Number(doc.total) || 0)} RUB</div>
  <div class="words">${escHtml(amountInWordsRu(Number(doc.total) || 0))}</div>
  <div class="sign">
    <div>
      Предприниматель
      <div class="line"></div>
      <div class="muted">подпись</div>
    </div>
    <div>
      <div style="margin-top:22px">${escHtml(org.short_name || org.director)}</div>
      <div class="muted">расшифровка подписи</div>
      <div style="margin-top:8px">М.П.</div>
    </div>
  </div>`;
  return printShell(`Счет на оплату № ${doc.number}`, body);
}

function renderUpdHtml(doc: Row & { lines: Row[]; org: OrgProfile }): string {
  const org = doc.org;
  const lines = doc.lines || [];
  const vatRate = Number(doc.vat_rate) || 0;
  const dateRu = formatDocDateRu(String(doc.doc_date));
  const rows = lines
    .map((l, i) => {
      const total = (Number(l.amount) || 0) + (Number(l.vat_amount) || 0);
      return `
      <tr>
        <td class="c">${escHtml(l.sku || '')}</td>
        <td class="c">${i + 1}</td>
        <td class="l">${escHtml(l.name)}</td>
        <td class="c">--</td>
        <td class="c">796</td>
        <td class="c">${escHtml(l.unit || 'шт')}</td>
        <td class="r">${Number(l.qty).toFixed(3)}</td>
        <td class="r">${formatRuMoney(Number(l.amount) || 0)}</td>
        <td class="r">${formatRuMoney(Number(l.amount) || 0)}</td>
        <td class="c">Без акциза</td>
        <td class="c">${vatRate}%</td>
        <td class="r">${formatRuMoney(Number(l.vat_amount) || 0)}</td>
        <td class="r">${formatRuMoney(total)}</td>
        <td class="c">--</td>
        <td class="c">--</td>
      </tr>`;
    })
    .join('');

  const body = `
  <div class="status-box">
    <b>Статус: 1</b><br/>
    1 – счет-фактура и передаточный документ (акт)<br/>
    2 – передаточный документ (акт)
  </div>
  <div class="muted">Приложение № 1 к постановлению Правительства РФ от 26.12.2011 № 1137</div>
  <h1 style="margin-top:4px">Универсальный передаточный документ</h1>
  <div><b>Счет-фактура № ${escHtml(doc.number)} от ${escHtml(dateRu)}</b> (1)</div>
  <div class="muted">Исправление № -- от -- (1а)</div>
  <div class="clear"></div>
  <div class="party"><b>Продавец:</b> ${escHtml(org.name)} (2)</div>
  <div class="party"><b>Адрес:</b> ${escHtml(org.address)} (2а)</div>
  <div class="party"><b>ИНН/КПП продавца:</b> ${escHtml(org.inn)}${org.kpp ? ` / ${escHtml(org.kpp)}` : ''} (2б)</div>
  <div class="party"><b>Грузоотправитель и его адрес:</b> он же (3)</div>
  <div class="party"><b>Грузополучатель и его адрес:</b> ${escHtml(doc.counterparty_name || '—')} (4)</div>
  <div class="party"><b>Покупатель:</b> ${escHtml(doc.counterparty_name || '—')} (6)
    ${doc.counterparty_inn ? `<br/><b>ИНН/КПП покупателя:</b> ${escHtml(doc.counterparty_inn)} (6б)` : ''}
  </div>
  <div class="party"><b>Валюта:</b> Российский рубль, 643 (7)</div>
  <div class="party"><b>Документ об отгрузке:</b> Универсальный передаточный документ, №${escHtml(doc.number)} от ${escHtml(dateRu)} (5а)</div>
  <table class="grid" style="font-size:10px">
    <thead>
      <tr>
        <th>Код товара/<br/>работ, услуг</th>
        <th>№<br/>п/п</th>
        <th>Наименование товара (описание работ, услуг)</th>
        <th>Код вида<br/>товара</th>
        <th>код</th>
        <th>Ед.</th>
        <th>Кол-во</th>
        <th>Цена без<br/>НДС</th>
        <th>Стоимость<br/>без НДС</th>
        <th>Акциз</th>
        <th>Ставка<br/>НДС</th>
        <th>Сумма<br/>НДС</th>
        <th>Стоимость<br/>с НДС</th>
        <th>Страна</th>
        <th>ГТД</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
    <tfoot>
      <tr>
        <td colspan="8" class="r"><b>Всего к оплате (9)</b></td>
        <td class="r"><b>${formatRuMoney(Number(doc.amount) || 0)}</b></td>
        <td class="c">X</td>
        <td></td>
        <td class="r"><b>${formatRuMoney(Number(doc.vat_amount) || 0)}</b></td>
        <td class="r"><b>${formatRuMoney(Number(doc.total) || 0)}</b></td>
        <td colspan="2"></td>
      </tr>
    </tfoot>
  </table>
  <div class="words">${escHtml(amountInWordsRu(Number(doc.total) || 0))}</div>
  <div class="party" style="margin-top:10px">
    Индивидуальный предприниматель / иное уполномоченное лицо
    &nbsp;&nbsp;____________________ / ${escHtml(org.short_name || org.director)} /
    ${org.ogrnip ? `<br/>ОГРНИП ${escHtml(org.ogrnip)}` : ''}
  </div>
  <div class="party"><b>Основание передачи:</b> Основной договор / сделка Amo #${escHtml(doc.deal_id)}</div>
  <div class="party">Дата отгрузки, передачи (сдачи) « ${escHtml(formatDocDateShort(String(doc.doc_date)).slice(0, 2))} » ${escHtml(formatDocDateRu(String(doc.doc_date)).replace(/^\d+\s/, ''))} [11]</div>
  <div class="sign">
    <div>
      Товар (груз) передал / услуги сдал
      <div class="line"></div>
      ${escHtml(org.short_name || org.director)}
    </div>
    <div>
      Товар (груз) получил / услуги принял
      <div class="line"></div>
      ${escHtml(doc.counterparty_name || '')}
    </div>
  </div>
  <div class="sign">
    <div>М.П.<br/><span class="muted">${escHtml(org.name)}, ИНН ${escHtml(org.inn)}</span></div>
    <div>М.П.<br/><span class="muted">${escHtml(doc.counterparty_name || '')}</span></div>
  </div>`;
  return printShell(`УПД № ${doc.number}`, body);
}

function renderWorkorderHtml(doc: Row & { lines: Row[]; org: OrgProfile }): string {
  const org = doc.org;
  const allLines = doc.lines || [];
  const works = allLines.filter((l) => String(l.line_kind) === 'work');
  const goods = allLines.filter((l) => String(l.line_kind) !== 'work');
  // если классификация не сработала — всё в товары
  const workLines = works.length ? works : [];
  const goodsLines = goods.length ? goods : allLines;
  const vatRate = Number(doc.vat_rate) || 0;
  const dateRu = formatDocDateRu(String(doc.doc_date));
  const dateShort = formatDocDateShort(String(doc.doc_date));

  const sumLines = (arr: Row[]) =>
    arr.reduce((s, l) => s + (Number(l.amount) || 0) + (Number(l.vat_amount) || 0), 0);
  const vatLines = (arr: Row[]) => arr.reduce((s, l) => s + (Number(l.vat_amount) || 0), 0);

  const worksTotal = sumLines(workLines);
  const worksVat = vatLines(workLines);
  const goodsTotal = sumLines(goodsLines);
  const goodsVat = vatLines(goodsLines);

  const workRows = workLines
    .map(
      (l, i) => `
      <tr>
        <td class="c">${i + 1}</td>
        <td class="l">${escHtml(l.name)}${l.sku ? `<div class="muted">${escHtml(l.sku)}</div>` : ''}</td>
        <td class="r">${Number(l.qty).toFixed(3)}</td>
        <td class="r">${Number(l.qty).toFixed(3)}</td>
        <td class="r">${formatRuMoney(Number(l.price) || 0)}</td>
        <td class="r">${formatRuMoney((Number(l.amount) || 0) + (Number(l.vat_amount) || 0))}</td>
      </tr>`
    )
    .join('');

  const goodsRows = goodsLines
    .map(
      (l, i) => `
      <tr>
        <td class="c">${i + 1}</td>
        <td class="l">${escHtml(l.name)}${l.sku ? `<div class="muted">арт. ${escHtml(l.sku)}</div>` : ''}</td>
        <td class="r">${Number(l.qty).toFixed(3)}</td>
        <td class="c">${escHtml(l.unit || 'шт')}</td>
        <td class="r">${formatRuMoney(Number(l.price) || 0)}</td>
        <td class="r">${formatRuMoney((Number(l.amount) || 0) + (Number(l.vat_amount) || 0))}</td>
      </tr>`
    )
    .join('');

  const body = `
  <div class="party"><b>ПОСТАВЩИК:</b><br/>
    ${escHtml(org.name)},<br/>
    ИНН ${escHtml(org.inn)}, ${escHtml(org.address)}
  </div>
  <h1>Заказ-наряд № ${escHtml(doc.number)} от ${escHtml(dateRu)}</h1>
  <div class="party"><b>Заказчик:</b> ${escHtml(doc.counterparty_name || '—')}
    ${doc.buyer_address ? ` &nbsp; ${escHtml(doc.buyer_address)}` : ''}
  </div>
  <div class="party">Автомобиль : гос. номер: &nbsp;&nbsp;&nbsp; VIN: &nbsp;&nbsp;&nbsp; год вып. &nbsp;&nbsp;&nbsp; пробег 0</div>
  <div class="party"><b>Плательщик:</b> ${escHtml(doc.counterparty_name || '—')}${
    doc.buyer_address ? `, ${escHtml(doc.buyer_address)}` : ''
  }</div>
  <div class="muted">в валюте RUB</div>

  ${
    workLines.length
      ? `
  <h2>Выполненные работы по заказ-наряду № ${escHtml(doc.number)} от ${escHtml(dateShort)} г.</h2>
  <table class="grid">
    <thead>
      <tr>
        <th>№</th><th>Наименование, артикул работ</th><th>Кол. оп.</th><th>Норма н/ч</th><th>Цена н/ч</th><th>Сумма</th>
      </tr>
    </thead>
    <tbody>${workRows}</tbody>
  </table>
  <div class="totals">
    Итого работ: <b>${formatRuMoney(worksTotal)}</b><br/>
    В том числе НДС${vatRate ? ` ${vatRate}%` : ''}: <b>${formatRuMoney(worksVat)}</b>
  </div>
  <div>Всего оказано Работ ${workLines.length}, на сумму ${formatRuMoney(worksTotal)} RUB</div>
  <div class="words">${escHtml(amountInWordsRu(worksTotal))}</div>`
      : ''
  }

  <h2>Расходная накладная к заказ-наряду № ${escHtml(doc.number)} от ${escHtml(dateShort)} г.</h2>
  <table class="grid">
    <thead>
      <tr>
        <th>№</th><th>Наименование, характеристика, артикул товаров</th><th>Кол-во</th><th>Ед.изм.</th><th>Цена</th><th>Сумма</th>
      </tr>
    </thead>
    <tbody>${goodsRows || '<tr><td colspan="6">Нет товаров</td></tr>'}</tbody>
  </table>
  <div class="totals">
    Итого: <b>${formatRuMoney(goodsTotal)}</b><br/>
    В том числе НДС${vatRate ? ` ${vatRate}%` : ''}: <b>${formatRuMoney(goodsVat)}</b>
  </div>
  <div>Всего деталей ${goodsLines.length}, на сумму ${formatRuMoney(goodsTotal)} RUB</div>
  <div class="words">${escHtml(amountInWordsRu(goodsTotal))}</div>

  <div class="totals" style="margin-top:12px;font-size:12px">
    <b>Итого по заказ-наряду : ${formatRuMoney(Number(doc.total) || 0)}</b><br/>
    В том числе НДС: ${formatRuMoney(Number(doc.vat_amount) || 0)}
  </div>
  <div class="words">Всего по заказ-наряду: ${escHtml(amountInWordsRu(Number(doc.total) || 0))} в т.ч. НДС ${formatRuMoney(Number(doc.vat_amount) || 0)} RUB</div>

  <div class="party" style="margin-top:14px">
    Мастер _____________________ /${escHtml(org.master_title || 'Мастер-приемщик')}/
  </div>

  <div class="warranty">
    <b>Гарантийные обязательства сторон:</b>
    <ol>
      <li>Гарантийный ремонт проводится при предъявлении гарантийного талона MRAER</li>
      <li>Доставка оборудования, подлежащего гарантийному ремонту, в сервисную службу осуществляется клиентом самостоятельно и за свой счет, если иное не оговорено</li>
      <li>Гарантийные обязательства не распространяются на материалы и детали, считающиеся расходуемыми в процессе эксплуатации.</li>
      <li>Исполнитель при наступлении гарантийного случая в срок не более 5-ти рабочих дней устраняет неисправности.</li>
      <li>Гарантийный срок на пневмоэлемент составляет 24 месяца, амортизатор 12 месяцев.</li>
      <li>Гарантийный срок на компрессор составляет 12 месяцев.</li>
      <li>Гарантийный срок на рулевую рейку составляет 12 месяцев.</li>
      <li>Гарантийный срок на электрическую рулевую рейку составляет 6 месяцев. Гарантия распространяется исключительно на проделанные работы.</li>
    </ol>
    <b>Условия прерывания гарантийных обязательств:</b>
    <ol>
      <li>Несоответствие серийного номера предъявляемого на гарантийное обслуживание оборудования серийному номеру, указанному в товарном счете или других письменных соглашениях.</li>
      <li>Наличие явных или скрытых механических повреждений оборудования, вызванных нарушением правил транспортировки, хранения или эксплуатации.</li>
      <li>Выявленное в процессе ремонта несоответствие Правилам и условиям эксплуатации.</li>
      <li>Повреждение контрольных этикеток и пломб (если таковые имеются).</li>
      <li>Наличие внутри корпуса оборудования посторонних предметов.</li>
      <li>Отказ оборудования, вызванный воздействием факторов непреодолимой силы или действиями третьих лиц.</li>
      <li>На пневмоэлемент не распространяются гарантийные обязательства, если на нём есть следы масла либо других агрессивных жидкостей.</li>
      <li>Отказ оборудования, вызванный неисправностью автомобиля (утечка пневмосистемы, замыкание реле и т.п.).</li>
      <li>Обнаружение в системе рулевого управления посторонних примесей, воды, металлической стружки и т.п.</li>
    </ol>
  </div>
  <div class="sign">
    <div>
      Принят: ${escHtml(dateShort)}<br/>
      Заказчик ______________________ /${escHtml(doc.counterparty_name || '')}/
    </div>
    <div>
      Дата: ${escHtml(dateShort)} г.<br/>
      Заказ-наряд № ${escHtml(doc.number)} от ${escHtml(dateShort)} г.
    </div>
  </div>`;
  return printShell(`Заказ-наряд № ${doc.number}`, body);
}

function renderSfHtml(doc: Row & { lines: Row[]; org: OrgProfile }): string {
  // СФ — та же табличная часть, что УПД, без передаточного блока
  const html = renderUpdHtml(doc);
  return html
    .replace('Универсальный передаточный документ', 'Счёт-фактура')
    .replace(`УПД № ${doc.number}`, `Счёт-фактура № ${doc.number}`);
}

/** HTML-бланк для печати / «Сохранить как PDF». */
export function renderSalesDocPrintHtml(id: string): string | null {
  const doc = getSalesDoc(id);
  if (!doc) return null;
  const type = String(doc.doc_type) as SalesDocType;
  if (type === 'invoice') return renderInvoiceHtml(doc);
  if (type === 'workorder') return renderWorkorderHtml(doc);
  if (type === 'sf') return renderSfHtml(doc);
  return renderUpdHtml(doc);
}
