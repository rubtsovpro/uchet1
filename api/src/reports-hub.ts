/**
 * Хабы отчётов УНФ → Учёт №1.
 * Live = SQLite (stock_docs / rests / crm_deals / sales_docs).
 * Stub = тонкий журнал или ссылка без движка отчёта 1С.
 * Веб-клиент РАРУС сломан (.vrd) — не ждём.
 */
import { all, get } from './db.js';

export type ReportStatus = 'live' | 'partial' | 'stub';

export type ReportCatalogItem = {
  id: string;
  section: string;
  title: string;
  path: string;
  view?: string;
  status: ReportStatus;
  note: string;
};

/** Инвентарь пунктов «Отчёты» из MAP (по разделам меню УНФ). */
export function reportsCatalog(): { note: string; items: ReportCatalogItem[]; summary: Record<ReportStatus, number> } {
  const items: ReportCatalogItem[] = [
    {
      id: 'crm.reports',
      section: 'crm',
      title: 'Отчёты CRM',
      path: '/crm/reports',
      view: 'parity-crm-reports',
      status: 'live',
      note: 'Сделки по воронкам/статусам (Amo → WMS)',
    },
    {
      id: 'sales.reports',
      section: 'sales',
      title: 'Отчёты продаж',
      path: '/sales/reports',
      view: 'parity-sales-reports',
      status: 'live',
      note: 'Расходные stock_docs + локальные sales_docs',
    },
    {
      id: 'sales.analysis',
      section: 'sales',
      title: 'Анализ продаж',
      path: '/sales/analysis',
      view: 'parity-sales-analysis',
      status: 'live',
      note: 'По месяцам / типам / топ покупателей и SKU',
    },
    {
      id: 'sales.retail_reports',
      section: 'sales',
      title: 'Отчёты о розничных продажах',
      path: '/sales/retail-reports',
      view: 'parity-retail-reports',
      status: 'partial',
      note: 'По дням из расходных; чеки АТОЛ — отдельно',
    },
    {
      id: 'purchases.reports',
      section: 'purchases',
      title: 'Отчёты закупок',
      path: '/purchases/reports',
      view: 'parity-purchases-reports',
      status: 'live',
      note: 'Приходы, ГТД, топ поставщиков',
    },
    {
      id: 'purchases.inbound_gtd',
      section: 'purchases',
      title: 'Приходы с ГТД',
      path: '/purchases/inbound-report',
      view: 'parity-purchases-inbound',
      status: 'live',
      note: 'Строки приходных с кодами ГТД',
    },
    {
      id: 'warehouse.reports',
      section: 'warehouse',
      title: 'Отчёты склада',
      path: '/warehouse/reports',
      view: 'parity-warehouse-reports',
      status: 'live',
      note: 'Остатки по складам, движения, списания',
    },
    {
      id: 'warehouse.low_stock',
      section: 'warehouse',
      title: 'Остатки ниже минимума',
      path: '/stock/low',
      view: 'parity-stock-low',
      status: 'live',
      note: 'min_stock − остаток',
    },
    {
      id: 'warehouse.valuation',
      section: 'warehouse',
      title: 'Стоимость склада',
      path: '/stock-valuation',
      view: 'stock-valuation',
      status: 'live',
      note: 'Оценка остатков',
    },
    {
      id: 'works.executor_report',
      section: 'works',
      title: 'Отчёт по работам исполнителей',
      path: '/works/executor-report',
      view: 'wb-sto-exec-rep',
      status: 'stub',
      note: 'Тонкий журнал до полного СТО',
    },
    {
      id: 'works.reports',
      section: 'works',
      title: 'Отчёты СТО',
      path: '/works/reports',
      view: 'wb-sto-reports',
      status: 'partial',
      note: 'Хаб: счётчик заказ-нарядов + ссылки',
    },
    {
      id: 'production.ops_docs_report',
      section: 'production',
      title: 'Отчёт по документам пр-ва и продаж',
      path: '/production/ops-docs-report',
      view: 'wb-prod-ops-rep',
      status: 'stub',
      note: 'Тонкий журнал',
    },
    {
      id: 'production.extra',
      section: 'production',
      title: 'Отчёты / доп. обработки (производство)',
      path: '/production/extra',
      view: 'wb-prod-extra',
      status: 'stub',
      note: 'Тонкий журнал',
    },
    {
      id: 'money.advance_reports',
      section: 'money',
      title: 'Авансовые отчёты',
      path: '/money/advance-reports',
      view: 'mw-advance',
      status: 'stub',
      note: 'Тонкий журнал; касса WMS пустая',
    },
    {
      id: 'money.reports',
      section: 'money',
      title: 'Отчёты денег',
      path: '/money/reports',
      view: 'parity-money-reports',
      status: 'partial',
      note: 'Касса/банк локально; СБП Точка отдельно',
    },
    {
      id: 'staff.daily_reports',
      section: 'staff',
      title: 'Ежедневные отчёты',
      path: '/staff/daily-reports',
      view: 'mw-daily',
      status: 'stub',
      note: 'Тонкий журнал',
    },
    {
      id: 'staff.extra',
      section: 'staff',
      title: 'Отчёты / доп. обработки (персонал)',
      path: '/staff/extra',
      view: 'mw-staff-extra',
      status: 'stub',
      note: 'Тонкий журнал',
    },
    {
      id: 'company.analytics',
      section: 'company',
      title: 'Анализ бизнеса',
      path: '/company-analytics',
      view: 'company-analytics',
      status: 'live',
      note: 'KPI + динамика продаж из расходных',
    },
    {
      id: 'settings.reports',
      section: 'settings',
      title: 'Отчёты (настройки / каталог)',
      path: '/settings/reports',
      view: 'settings-reports',
      status: 'live',
      note: 'Каталог всех отчётов: в работе / заглушка',
    },
    {
      id: 'marking.reports',
      section: 'marking',
      title: 'Отчёты маркировки',
      path: '/marking',
      view: 'marking',
      status: 'partial',
      note: 'Счётчики партий / кодов на /marking',
    },
  ];
  const summary: Record<ReportStatus, number> = { live: 0, partial: 0, stub: 0 };
  for (const it of items) summary[it.status]++;
  return {
    note: 'Каталог отчётов MAP → Учёт №1. «В работе» = таблицы из SQLite; «заглушка» = экран без движка УНФ. Веб-клиент 1С РАРУС недоступен (.vrd).',
    items,
    summary,
  };
}

function outByMonth(limit = 24) {
  return all<{ ym: string; docs: number; amount: number }>(
    `SELECT substr(doc_date,1,7) AS ym, COUNT(*) AS docs, IFNULL(SUM(amount),0) AS amount
     FROM stock_docs WHERE doc_type='out' AND IFNULL(doc_date,'') != ''
     GROUP BY substr(doc_date,1,7) ORDER BY ym DESC LIMIT ?`,
    [limit]
  );
}

function inByMonth(limit = 24) {
  return all<{ ym: string; docs: number; amount: number }>(
    `SELECT substr(doc_date,1,7) AS ym, COUNT(*) AS docs, IFNULL(SUM(amount),0) AS amount
     FROM stock_docs WHERE doc_type='in' AND IFNULL(doc_date,'') != ''
     GROUP BY substr(doc_date,1,7) ORDER BY ym DESC LIMIT ?`,
    [limit]
  );
}

function topBuyers(limit = 20) {
  return all<{ name: string; docs: number; amount: number }>(
    `SELECT IFNULL(c.name,'—') AS name, COUNT(*) AS docs, IFNULL(SUM(d.amount),0) AS amount
     FROM stock_docs d
     LEFT JOIN counterparties c ON c.id = d.counterparty_id
     WHERE d.doc_type='out'
     GROUP BY d.counterparty_id
     ORDER BY amount DESC LIMIT ?`,
    [limit]
  );
}

function topSuppliers(limit = 20) {
  return all<{ name: string; docs: number; amount: number }>(
    `SELECT IFNULL(c.name,'—') AS name, COUNT(*) AS docs, IFNULL(SUM(d.amount),0) AS amount
     FROM stock_docs d
     LEFT JOIN counterparties c ON c.id = d.counterparty_id
     WHERE d.doc_type='in'
     GROUP BY d.counterparty_id
     ORDER BY amount DESC LIMIT ?`,
    [limit]
  );
}

function topSkuOut(limit = 30) {
  return all<{ sku: string; name: string; qty: number; amount: number }>(
    `SELECT IFNULL(p.sku,'') AS sku, IFNULL(p.name,'?') AS name,
            IFNULL(SUM(l.qty),0) AS qty, IFNULL(SUM(l.amount),0) AS amount
     FROM stock_doc_lines l
     JOIN stock_docs d ON d.id = l.doc_id
     LEFT JOIN products p ON p.id = l.product_id
     WHERE d.doc_type='out'
     GROUP BY l.product_id
     ORDER BY amount DESC LIMIT ?`,
    [limit]
  );
}

function restsByWarehouse() {
  return all<{ warehouse: string; rows: number; qty: number }>(
    `SELECT IFNULL(w.name,'—') AS warehouse, COUNT(*) AS rows, IFNULL(SUM(r.qty),0) AS qty
     FROM product_store_rests r
     LEFT JOIN warehouses w ON w.id = r.warehouse_id
     WHERE r.qty > 0
     GROUP BY r.warehouse_id
     ORDER BY qty DESC`
  );
}

function dealsByPipeline() {
  return all<{ pipeline: string; deals: number; amount: number }>(
    `SELECT IFNULL(pipeline_name,'—') AS pipeline, COUNT(*) AS deals,
            IFNULL(SUM(price),0) AS amount
     FROM crm_deals
     GROUP BY pipeline_id
     ORDER BY deals DESC`
  );
}

function dealsByStatus(limit = 20) {
  return all<{ status: string; deals: number }>(
    `SELECT IFNULL(status_name,'—') AS status, COUNT(*) AS deals
     FROM crm_deals
     GROUP BY status_id
     ORDER BY deals DESC LIMIT ?`,
    [limit]
  );
}

/** Хаб продаж: расходные + локальные документы. */
export function salesReportsHub() {
  const out =
    get<{ c: number; amount: number }>(
      `SELECT COUNT(*) AS c, IFNULL(SUM(amount),0) AS amount FROM stock_docs WHERE doc_type='out'`
    ) || { c: 0, amount: 0 };
  const salesLocal =
    get<{ c: number; amount: number }>(
      `SELECT COUNT(*) AS c, IFNULL(SUM(amount),0) AS amount FROM sales_docs`
    ) || { c: 0, amount: 0 };
  return {
    status: 'live' as const,
    note: 'Отчёты продаж из расходных 1С (sync) и локальных счетов/УПД. Не полный СКД УНФ.',
    outbound_docs: out.c,
    outbound_amount: out.amount,
    local_sales_docs: salesLocal.c,
    local_sales_amount: salesLocal.amount,
    by_month: outByMonth(18),
    top_buyers: topBuyers(15),
    top_sku: topSkuOut(20),
    links: [
      { view: 'parity-sales-analysis', label: 'Анализ продаж' },
      { view: 'parity-retail-reports', label: 'Розничные продажи (по дням)' },
      { view: 'docs', label: 'Расходные накладные' },
      { view: 'invoices', label: 'Счета' },
      { view: 'deals', label: 'Сделки CRM' },
    ],
  };
}

/** Розница: по дням из расходных (прокси до АТОЛ). */
export function retailSalesReport(limitDays = 60) {
  const lim = Math.min(180, Math.max(7, Math.floor(Number(limitDays) || 60)));
  const byDay = all<{ day: string; docs: number; amount: number }>(
    `SELECT substr(doc_date,1,10) AS day, COUNT(*) AS docs, IFNULL(SUM(amount),0) AS amount
     FROM stock_docs
     WHERE doc_type='out' AND IFNULL(doc_date,'') != ''
     GROUP BY substr(doc_date,1,10)
     ORDER BY day DESC LIMIT ?`,
    [lim]
  );
  const today = new Date().toISOString().slice(0, 10);
  const todayRow = byDay.find((r) => r.day === today);
  return {
    status: 'partial' as const,
    note: 'Прокси розницы: расходные по дням. Чеки ККМ/АТОЛ — когда касса live.',
    days: byDay,
    today: todayRow || { day: today, docs: 0, amount: 0 },
    month: outByMonth(6),
    links: [
      { view: 'parity-kkm-receipts', label: 'Чеки ККМ (журнал)' },
      { view: 'parity-sales-reports', label: 'Хаб отчётов продаж' },
      { view: 'parity-rmk', label: 'РМК' },
    ],
  };
}

/** Расширенный анализ продаж. */
export function salesAnalysisLive() {
  const byMonthSales = all<{ ym: string; docs: number; amount: number }>(
    `SELECT substr(doc_date,1,7) AS ym, COUNT(*) AS docs, IFNULL(SUM(amount),0) AS amount
     FROM sales_docs WHERE IFNULL(doc_date,'') != ''
     GROUP BY substr(doc_date,1,7) ORDER BY ym DESC LIMIT 24`
  );
  const byType = all<{ doc_type: string; docs: number; amount: number }>(
    `SELECT doc_type, COUNT(*) AS docs, IFNULL(SUM(amount),0) AS amount
     FROM sales_docs GROUP BY doc_type ORDER BY amount DESC`
  );
  const outDocs =
    get<{ c: number; amount: number }>(
      `SELECT COUNT(*) AS c, IFNULL(SUM(amount),0) AS amount
       FROM stock_docs WHERE doc_type='out'`
    ) || { c: 0, amount: 0 };
  return {
    note: 'Анализ: расходные 1С (основной объём) + локальные sales_docs. Не полный отчёт УНФ.',
    sales_by_month: outByMonth(24),
    sales_docs_by_month: byMonthSales,
    sales_by_type: byType,
    outbound_1c: { docs: outDocs.c, amount: outDocs.amount },
    top_buyers: topBuyers(15),
    top_sku: topSkuOut(15),
  };
}

/** Хаб закупок с топом поставщиков. */
export function purchasesReportsLive() {
  const inbound =
    get<{ c: number; amount: number }>(
      `SELECT COUNT(*) AS c, IFNULL(SUM(amount),0) AS amount FROM stock_docs WHERE doc_type='in'`
    ) || { c: 0, amount: 0 };
  const withGtd =
    get<{ c: number }>(
      `SELECT COUNT(DISTINCT d.id) AS c FROM stock_docs d
       JOIN stock_doc_lines l ON l.doc_id = d.id
       WHERE d.doc_type='in' AND IFNULL(l.gtd_key,'') != ''
         AND l.gtd_key != '00000000-0000-0000-0000-000000000000'`
    )?.c ?? 0;
  const suppliers =
    get<{ c: number }>(
      `SELECT COUNT(*) AS c FROM counterparties WHERE kind IN ('supplier','both')`
    )?.c ?? 0;
  return {
    status: 'live' as const,
    note: 'Сводка закупок из приходных sync. Заказы поставщикам — блокер OData.',
    inbound_docs: inbound.c,
    inbound_amount: inbound.amount,
    inbound_with_gtd: withGtd,
    suppliers_touch: suppliers,
    by_month: inByMonth(18),
    top_suppliers: topSuppliers(15),
    links: [
      { view: 'parity-purchases-inbound', label: 'Приходы с ГТД' },
      { view: 'parity-demand', label: 'Расчёт потребностей' },
      { view: 'parity-stock-low', label: 'Остатки ниже минимума' },
      { view: 'in', label: 'Приходные накладные' },
      { view: 'suppliers', label: 'Поставщики' },
    ],
  };
}

/** Хаб склада: остатки + движения. */
export function warehouseReportsLive() {
  const rests =
    get<{ c: number }>(`SELECT COUNT(*) AS c FROM product_store_rests WHERE qty > 0`)?.c ?? 0;
  const docs = get<{ c: number }>(`SELECT COUNT(*) AS c FROM stock_docs`)?.c ?? 0;
  const transfers =
    get<{ c: number }>(`SELECT COUNT(*) AS c FROM stock_docs WHERE doc_type='transfer'`)?.c ?? 0;
  const outs = get<{ c: number }>(`SELECT COUNT(*) AS c FROM stock_docs WHERE doc_type='out'`)?.c ?? 0;
  const ins = get<{ c: number }>(`SELECT COUNT(*) AS c FROM stock_docs WHERE doc_type='in'`)?.c ?? 0;
  return {
    status: 'live' as const,
    note: 'Складские отчёты Учёт №1 по sync остаткам и документам.',
    positive_rest_rows: rests,
    stock_docs: docs,
    transfers,
    write_offs: outs,
    inbound: ins,
    by_warehouse: restsByWarehouse(),
    outbound_by_month: outByMonth(12),
    inbound_by_month: inByMonth(12),
    links: [
      { view: 'balances', label: 'Остатки' },
      { view: 'stock-valuation', label: 'Стоимость склада' },
      { view: 'parity-stock-low', label: 'Ниже минимума' },
      { view: 'parity-transfers', label: 'Перемещения' },
      { view: 'parity-writeoffs', label: 'Списания' },
      { view: 'parity-inventory', label: 'Инвентаризации' },
      { view: 'parity-demand', label: 'Потребности' },
      { view: 'wh-kpd', label: 'КПД склада' },
    ],
  };
}

/** CRM отчёты по сделкам. */
export function crmReportsHub() {
  const total =
    get<{ c: number; amount: number }>(
      `SELECT COUNT(*) AS c, IFNULL(SUM(price),0) AS amount FROM crm_deals`
    ) || { c: 0, amount: 0 };
  return {
    status: 'live' as const,
    note: 'Отчёты CRM: сделки Amo в WMS. Воронка 1С УНФ не клонируется.',
    deals: total.c,
    amount: total.amount,
    by_pipeline: dealsByPipeline(),
    by_status: dealsByStatus(20),
    links: [
      { view: 'deals', label: 'Сделки' },
      { view: 'pipelines', label: 'Воронки' },
      { view: 'parity-sales-reports', label: 'Отчёты продаж' },
    ],
  };
}

/** Деньги: счётчики локальной кассы + ссылки. */
export function moneyReportsHub() {
  const cash =
    get<{ c: number; amount: number }>(
      `SELECT COUNT(*) AS c, IFNULL(SUM(amount),0) AS amount FROM cash_docs`
    ) || { c: 0, amount: 0 };
  const orders =
    get<{ c: number }>(`SELECT COUNT(*) AS c FROM payment_orders`)?.c ?? 0;
  const dealPay =
    get<{ c: number; amount: number }>(
      `SELECT COUNT(*) AS c, IFNULL(SUM(amount),0) AS amount FROM deal_payments`
    ) || { c: 0, amount: 0 };
  return {
    status: 'partial' as const,
    note: 'Касса/банк в WMS пока тонкие. Платежи сделок / СБП Точка — рабочие контуры.',
    cash_docs: cash.c,
    cash_amount: cash.amount,
    payment_orders: orders,
    deal_payments: dealPay.c,
    deal_payments_amount: dealPay.amount,
    links: [
      { view: 'cash', label: 'Кассовые документы' },
      { view: 'mw-advance', label: 'Авансовые отчёты' },
    ],
  };
}

/** Компания: KPI + ссылки на live-отчёты. */
export function companyReportsHub() {
  const products =
    get<{ c: number }>(`SELECT COUNT(*) AS c FROM products WHERE IFNULL(is_active,1)=1`)?.c ?? 0;
  const counterparties = get<{ c: number }>(`SELECT COUNT(*) AS c FROM counterparties`)?.c ?? 0;
  const deals = get<{ c: number }>(`SELECT COUNT(*) AS c FROM crm_deals`)?.c ?? 0;
  const outYtd =
    get<{ amount: number }>(
      `SELECT IFNULL(SUM(amount),0) AS amount FROM stock_docs
       WHERE doc_type='out' AND substr(doc_date,1,4)=strftime('%Y','now')`
    )?.amount ?? 0;
  return {
    status: 'live' as const,
    note: 'Управленческий срез компании. Полные бухгалтерские отчёты УНФ — не в этой волне.',
    products,
    counterparties,
    deals,
    sales_ytd: outYtd,
    sales_dynamics: outByMonth(12),
    links: [
      { view: 'company-analytics', label: 'Анализ бизнеса' },
      { view: 'parity-sales-reports', label: 'Отчёты продаж' },
      { view: 'parity-warehouse-reports', label: 'Отчёты склада' },
      { view: 'parity-crm-reports', label: 'Отчёты CRM' },
      { view: 'settings-reports', label: 'Каталог отчётов' },
    ],
  };
}

/** СТО: хаб поверх тонкого журнала. */
export function worksReportsHub() {
  const orders = get<{ c: number }>(`SELECT COUNT(*) AS c FROM sto_work_orders`)?.c ?? 0;
  return {
    status: 'partial' as const,
    note: 'Отчёты СТО. Заказ-наряды локальные; полный отчёт исполнителей УНФ — stub.',
    work_orders: orders,
    links: [
      { view: 'workorders', label: 'Заказ-наряды' },
      { view: 'wb-sto-exec-rep', label: 'Отчёт по работам исполнителей' },
      { view: 'parity-crm-reports', label: 'Отчёты CRM' },
    ],
  };
}
