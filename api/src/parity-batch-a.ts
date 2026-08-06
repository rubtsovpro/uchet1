/**
 * Batch A: Закупки + Продажи + отчёты склада — тонкие журналы паритета меню УНФ.
 * Пустые состояния OK; не трогают учёт 1С.
 */
import { all, get, run } from './db.js';
import { newGuid, nextCode } from './ids.js';
import { MONEY_WAVE_THIN_JOURNALS } from './parity-money-wave.js';
import { WAVE_B_THIN_JOURNALS } from './parity-wave-b.js';
import { purchasesReportsLive, warehouseReportsLive } from './reports-hub.js';
import { nextBarcode } from './barcodes.js';
import {
  appsHumanLabel,
  appsShortLabel,
  parseAppsJson,
  type AppVehicle,
} from './applicability-party.js';

export type ThinJournalMeta = {
  key: string;
  title: string;
  prefix: string;
  note: string;
  section:
    | 'purchases'
    | 'sales'
    | 'warehouse'
    | 'money'
    | 'staff'
    | 'company'
    | 'settings'
    | 'home'
    | 'crm'
    | 'works'
    | 'production';
  /** MAP ids for DONE tracking */
  map_ids: string[];
};

/** Реестр тонких журналов (один CRUD на все). */
export const THIN_JOURNALS: ThinJournalMeta[] = [
  // ——— Закупки ———
  {
    key: 'supplier_orders',
    title: 'Заказы поставщикам',
    prefix: 'ЗП',
    note: 'Заказы из 1С (дамп PG) + ручной ввод. Связь с приходными — в комментарии.',
    section: 'purchases',
    map_ids: ['purchases.supplier_orders'],
  },
  {
    key: 'supplier_bills',
    title: 'Счета на оплату (полученные)',
    prefix: 'СЧП',
    note: 'Полученные счета от поставщиков. Локально до публикации OData.',
    section: 'purchases',
    map_ids: ['purchases.supplier_bills'],
  },
  {
    key: 'supplier_returns',
    title: 'Возвраты поставщикам',
    prefix: 'ВП',
    note: 'Журнал возвратов поставщикам (черновики). Проведение в 1С не дублируется.',
    section: 'purchases',
    map_ids: ['purchases.supplier_returns'],
  },
  {
    key: 'purchase_sf',
    title: 'Счета-фактуры (полученные)',
    prefix: 'СФП',
    note: 'Полученные СФ. УПД-path продаж — отдельно.',
    section: 'purchases',
    map_ids: ['purchases.purchase_sf'],
  },
  {
    key: 'extra_costs',
    title: 'Дополнительные расходы',
    prefix: 'ДР',
    note: 'Landed cost / доп. расходы на поставку. Тонкий журнал.',
    section: 'purchases',
    map_ids: ['purchases.extra_costs'],
  },
  {
    key: 'receipt_adjustments',
    title: 'Корректировки поступлений',
    prefix: 'КП',
    note: 'Корректировки приходных. Локальный учёт факта.',
    section: 'purchases',
    map_ids: ['purchases.receipt_adjustments'],
  },
  {
    key: 'purchase_discrepancy',
    title: 'Акты о расхождениях (закупки)',
    prefix: 'АРЗ',
    note: 'Акты расхождений при приёмке.',
    section: 'purchases',
    map_ids: ['purchases.discrepancy'],
  },
  {
    key: 'import_costs',
    title: 'Расходы при импорте',
    prefix: 'РИ',
    note: 'Таможня / логистика импорта. Скоро данные из 1С при публикации.',
    section: 'purchases',
    map_ids: ['purchases.import_costs'],
  },
  {
    key: 'supplier_price_lists',
    title: 'Прайс-листы поставщиков',
    prefix: 'ППЛ',
    note: 'Справочник прайсов поставщиков (метаданные). Цены — в карточке/матрице.',
    section: 'purchases',
    map_ids: ['purchases.supplier_price_lists'],
  },
  {
    key: 'supplier_price_types',
    title: 'Виды цен поставщиков',
    prefix: 'ВПЦ',
    note: 'Виды цен закупки.',
    section: 'purchases',
    map_ids: ['purchases.supplier_price_types'],
  },
  {
    key: 'purchase_reconcile',
    title: 'Сверки взаиморасчётов (закупки)',
    prefix: 'СВЗ',
    note: 'Акты сверки с поставщиками.',
    section: 'purchases',
    map_ids: ['purchases.reconcile'],
  },
  {
    key: 'purchase_debt_adj',
    title: 'Корректировки долга (закупки)',
    prefix: 'КДЗ',
    note: 'Корректировки кредиторки.',
    section: 'purchases',
    map_ids: ['purchases.debt_adj'],
  },
  // ——— Продажи ———
  {
    key: 'work_acts',
    title: 'Акты выполненных работ',
    prefix: 'АВР',
    note: 'Акты работ (не полный СТО). Связь с заказ-нарядами — позже.',
    section: 'sales',
    map_ids: ['sales.work_acts'],
  },
  {
    key: 'customer_returns',
    title: 'Возвраты от покупателей',
    prefix: 'ВК',
    note: 'Возвраты покупателей. Складское оприходование — отдельно при необходимости.',
    section: 'sales',
    map_ids: ['sales.customer_returns'],
  },
  {
    key: 'sales_adjustments',
    title: 'Корректировки реализаций',
    prefix: 'КР',
    note: 'Корректировки расходных / реализаций.',
    section: 'sales',
    map_ids: ['sales.adjustments'],
  },
  {
    key: 'return_sf',
    title: 'Счета-фактуры на возврат',
    prefix: 'СФВ',
    note: 'СФ на возврат.',
    section: 'sales',
    map_ids: ['sales.return_sf'],
  },
  {
    key: 'retail_reports',
    title: 'Отчёты о розничных продажах',
    prefix: 'ОРП',
    note: 'Сводки розницы. Чеки АТОЛ — отдельный контур.',
    section: 'sales',
    map_ids: ['sales.retail_reports'],
  },
  {
    key: 'kkm_cash',
    title: 'Кассы ККМ',
    prefix: 'ККМ',
    note: 'Справочник касс ККМ (локально). Live ОФД — по решению.',
    section: 'sales',
    map_ids: ['sales.kkm_cash'],
  },
  {
    key: 'sales_control',
    title: 'Контроль продаж',
    prefix: 'КПД',
    note: 'Контрольные точки продаж (журнал замечаний).',
    section: 'sales',
    map_ids: ['sales.control'],
  },
  {
    key: 'sales_reconcile',
    title: 'Сверки взаиморасчётов (продажи)',
    prefix: 'СВП',
    note: 'Акты сверки с покупателями.',
    section: 'sales',
    map_ids: ['sales.reconcile'],
  },
  {
    key: 'sales_debt_adj',
    title: 'Корректировки долга (продажи)',
    prefix: 'КДП',
    note: 'Корректировки дебиторки.',
    section: 'sales',
    map_ids: ['sales.debt_adj'],
  },
  {
    key: 'order_states',
    title: 'Виды и состояния заказов',
    prefix: 'ВСО',
    note: 'Справочник статусов заказов покупателей (локально; Amo — отдельно).',
    section: 'sales',
    map_ids: ['sales.order_states'],
  },
  {
    key: 'route_sheets',
    title: 'Маршрутные листы',
    prefix: 'МЛ',
    note: 'Маршруты доставки / курьеров.',
    section: 'sales',
    map_ids: ['sales.route_sheets'],
  },
  {
    key: 'kkm_receipts',
    title: 'Чеки ККМ',
    prefix: 'ЧК',
    note: 'Журнал чеков. Live АТОЛ — когда будет касса; сейчас список / подготовка.',
    section: 'sales',
    map_ids: ['sales.kkm_receipts'],
  },
  {
    key: 'rmk',
    title: 'Рабочее место кассира (РМК)',
    prefix: 'РМК',
    note: 'Заготовка РМК. Розничный поток Э1 ≠ полный РМК 1С.',
    section: 'sales',
    map_ids: ['sales.rmk'],
  },
  {
    key: 'repair_accept',
    title: 'Приём и передача в ремонт',
    prefix: 'ПР',
    note: 'Приём в ремонт (тонкий журнал до полного СТО).',
    section: 'sales',
    map_ids: ['sales.repair_accept'],
  },
  {
    key: 'pneumopro_price',
    title: 'Прайс-лист (ПневмоПро)',
    prefix: 'ППР',
    note: 'Прайс для сайта ПневмоПро (метаданные выгрузки).',
    section: 'sales',
    map_ids: ['sales.pneumopro_price'],
  },
  {
    key: 'labels_print',
    title: 'Печать этикеток и ценников',
    prefix: 'ЭЦ',
    note: 'Задания на печать этикеток. Драйвер ТСД/принтера — отдельно.',
    section: 'sales',
    map_ids: ['sales.labels', 'warehouse.labels'],
  },
  // ——— Склад ———
  {
    key: 'transfer_orders',
    title: 'Заказы на перемещение',
    prefix: 'ЗПМ',
    note: 'Заказы на перемещение между складами (очередь кладовщикам).',
    section: 'warehouse',
    map_ids: ['warehouse.transfer_orders'],
  },
  {
    key: 'assemblies',
    title: 'Комплектации',
    prefix: 'КМП',
    note: 'Комплектация/разукомплектация (журнал).',
    section: 'warehouse',
    map_ids: ['warehouse.assemblies'],
  },
  {
    key: 'regrading',
    title: 'Пересортица',
    prefix: 'ПС',
    note: 'Пересортица номенклатуры.',
    section: 'warehouse',
    map_ids: ['warehouse.regrading'],
  },
  {
    key: 'warehouse_acts',
    title: 'Складские акты',
    prefix: 'СА',
    note: 'Прочие складские акты.',
    section: 'warehouse',
    map_ids: ['warehouse.acts'],
  },
  {
    key: 'stock_receipts_local',
    title: 'Оприходования',
    prefix: 'ОП',
    note: 'Оприходование излишков (локально). Инвентаризация создаёт документы отдельно.',
    section: 'warehouse',
    map_ids: ['warehouse.receipts'],
  },
  // ——— Остаток «нет» Закупки / Продажи / Склад (тонкие экраны) ———
  {
    key: 'commission_purchases',
    title: 'Комиссионные закупки',
    prefix: 'КЗ',
    note: 'Комиссионные закупки. Полный учёт комиссии 1С не переносится.',
    section: 'purchases',
    map_ids: ['purchases.commission'],
  },
  {
    key: 'powers_of_attorney',
    title: 'Доверенности',
    prefix: 'ДВ',
    note: 'Журнал доверенностей на получение ТМЦ.',
    section: 'purchases',
    map_ids: ['purchases.poa'],
  },
  {
    key: 'purchase_return_sf',
    title: 'Счета-фактуры на возврат (закупки)',
    prefix: 'СФВЗ',
    note: 'СФ на возврат поставщику.',
    section: 'purchases',
    map_ids: ['purchases.return_sf'],
  },
  {
    key: 'processor_docs',
    title: 'Документы переработчиков',
    prefix: 'ДП',
    note: 'Давальческое сырьё / переработчики. Скоро данные.',
    section: 'purchases',
    map_ids: ['purchases.processors'],
  },
  {
    key: 'business_network',
    title: 'Торговые предложения 1С:Бизнес-сеть',
    prefix: 'БС',
    note: 'Заготовка под 1С:Бизнес-сеть. Без live API.',
    section: 'purchases',
    map_ids: ['purchases.business_network'],
  },
  {
    key: 'purchase_request_analysis',
    title: 'Анализ заявок на закупку',
    prefix: 'АЗЗ',
    note: 'Сводка заявок/потребностей. Не MRP 1С.',
    section: 'purchases',
    map_ids: ['purchases.request_analysis'],
  },
  {
    key: 'scan_docs_purchases',
    title: 'Загрузить документы из сканов (закупки)',
    prefix: 'СКЗ',
    note: 'Очередь распознавания сканов. OCR — отдельно.',
    section: 'purchases',
    map_ids: ['purchases.scan_docs'],
  },
  {
    key: 'tsd_export_purchases',
    title: 'Выгрузка товаров в ТСД (закупки)',
    prefix: 'ТСДЗ',
    note: 'Задания выгрузки в ТСД. Драйвер железа — отдельно.',
    section: 'purchases',
    map_ids: ['purchases.tsd'],
  },
  {
    key: 'extra_processors_purchases',
    title: 'Дополнительные обработки (закупки)',
    prefix: 'ДОЗ',
    note: 'Реестр доп. обработок раздела Закупки.',
    section: 'purchases',
    map_ids: ['purchases.extra'],
  },
  {
    key: 'commission_sales',
    title: 'Комиссионные продажи',
    prefix: 'КПР',
    note: 'Комиссионные продажи. Тонкий журнал.',
    section: 'sales',
    map_ids: ['sales.commission'],
  },
  {
    key: 'sales_discrepancy_recv',
    title: 'Акты о расхождениях (полученные)',
    prefix: 'АРП',
    note: 'Полученные акты расхождений по реализациям.',
    section: 'sales',
    map_ids: ['sales.discrepancy_recv'],
  },
  {
    key: 'projects',
    title: 'Проекты',
    prefix: 'ПРЖ',
    note: 'Справочник/журнал проектов продаж.',
    section: 'sales',
    map_ids: ['sales.projects'],
  },
  {
    key: 'deposit_settle',
    title: 'Погашение залоговых обязательств',
    prefix: 'ПЗО',
    note: 'Залоги / погашение. Скоро данные.',
    section: 'sales',
    map_ids: ['sales.deposit'],
  },
  {
    key: 'offline_equipment',
    title: 'Обмен с оборудованием Offline',
    prefix: 'ОФО',
    note: 'Офлайн-обмен с ККМ/весами. Без драйвера — журнал заданий.',
    section: 'sales',
    map_ids: ['sales.offline_eq'],
  },
  {
    key: 'product_palette',
    title: 'Палитра товаров',
    prefix: 'ПЛТ',
    note: 'Палитра избранных позиций для РМК (кассы). Сейчас заготовка — не влияет на склад и продажи.',
    section: 'sales',
    map_ids: ['sales.palette'],
  },
  {
    key: 'offer_publish',
    title: 'Публикация предложений',
    prefix: 'ППУ',
    note: 'Публикация торговых предложений.',
    section: 'sales',
    map_ids: ['sales.offer_publish'],
  },
  {
    key: 'external_price_source',
    title: 'Установка цен с внешним источником',
    prefix: 'ВЦ',
    note: 'Импорт цен из внешнего файла/API. Скоро данные.',
    section: 'sales',
    map_ids: ['sales.ext_prices'],
  },
  {
    key: 'mass_mailings',
    title: 'Массовые рассылки',
    prefix: 'МР',
    note: 'Очередь E-mail/SMS рассылок. Без провайдера — журнал.',
    section: 'sales',
    map_ids: ['sales.mailings'],
  },
  {
    key: 'counterparty_segments',
    title: 'Сегменты контрагентов',
    prefix: 'СК',
    note: 'Сегменты покупателей для акций/рассылок.',
    section: 'sales',
    map_ids: ['sales.segments'],
  },
  {
    key: 'extra_processors_sales',
    title: 'Дополнительные обработки (продажи)',
    prefix: 'ДОП',
    note: 'Реестр доп. обработок раздела Продажи.',
    section: 'sales',
    map_ids: ['sales.extra'],
  },
  {
    key: 'scan_docs_sales',
    title: 'Загрузить документы из сканов (продажи)',
    prefix: 'СКП',
    note: 'Очередь сканов. OCR — отдельно.',
    section: 'sales',
    map_ids: ['sales.scan_docs'],
  },
  {
    key: 'etrn_sales',
    title: 'Электронные перевозочные документы',
    prefix: 'ЭПД',
    note: 'ЭПД / транспортные. Без ЭДО live.',
    section: 'sales',
    map_ids: ['sales.etrn'],
  },
  {
    key: 'cell_transfers',
    title: 'Перемещения по ячейкам',
    prefix: 'ПЯ',
    note: 'Адресный склад / ячейки. Э4 — журнал заявок.',
    section: 'warehouse',
    map_ids: ['warehouse.cell_transfers'],
  },
  {
    key: 'pneumopro_demand',
    title: 'Обеспечение потребностей склада (ПневмоПро)',
    prefix: 'ОПС',
    note: 'Кастом ПневмоПро: обеспечение склада. Скоро данные.',
    section: 'warehouse',
    map_ids: ['warehouse.pneumopro_demand'],
  },
  {
    key: 'tsd_export_warehouse',
    title: 'Выгрузка товаров в ТСД (склад)',
    prefix: 'ТСДС',
    note: 'Задания выгрузки в ТСД. Драйвер — отдельно.',
    section: 'warehouse',
    map_ids: ['warehouse.tsd'],
  },
  {
    key: 'extra_processors_warehouse',
    title: 'Дополнительные обработки (склад)',
    prefix: 'ДОС',
    note: 'Реестр доп. обработок раздела Склад.',
    section: 'warehouse',
    map_ids: ['warehouse.extra'],
  },
];

/** Волна Деньги/Компания/Персонал/Настройки/Главное — append only. */
THIN_JOURNALS.push(...MONEY_WAVE_THIN_JOURNALS);
/** Волна B: CRM / СТО / Производство / боковое — append only. */
THIN_JOURNALS.push(...(WAVE_B_THIN_JOURNALS as ThinJournalMeta[]));

const JOURNAL_BY_KEY = new Map(THIN_JOURNALS.map((j) => [j.key, j]));

export function listThinJournalKeys() {
  return THIN_JOURNALS.map((j) => ({
    key: j.key,
    title: j.title,
    section: j.section,
    note: j.note,
    map_ids: j.map_ids,
  }));
}

export function getThinJournalMeta(key: string): ThinJournalMeta | null {
  return JOURNAL_BY_KEY.get(String(key || '').trim()) || null;
}

export function listThinJournalDocs(journalKey: string, limit = 200, q = '') {
  const meta = getThinJournalMeta(journalKey);
  if (!meta) throw new Error('unknown journal');
  const lim = Math.min(500, Math.max(1, Math.floor(Number(limit) || 200)));
  const like = `%${(q || '').trim()}%`;
  const items = all<{
    id: string;
    journal_key: string;
    number: string;
    doc_date: string;
    status: string;
    counterparty_name: string;
    amount: number;
    comment: string;
    created_at: string;
    payload_json: string;
  }>(
    `SELECT id, journal_key, number, doc_date, status,
            counterparty_name, amount, comment, created_at,
            IFNULL(payload_json,'') AS payload_json
     FROM thin_journal_docs
     WHERE journal_key = ?
       AND (? = '%%' OR number LIKE ? OR counterparty_name LIKE ? OR comment LIKE ? OR status LIKE ?)
     ORDER BY doc_date DESC, number DESC
     LIMIT ?`,
    [journalKey, like, like, like, like, like, lim]
  ).map((r) => {
    const lines = parsePayloadLines(r.payload_json);
    const payload = readPayloadObject(r.payload_json);
    const linesCount =
      lines.length ||
      (Array.isArray(payload.line_details) ? payload.line_details.length : 0) ||
      (Number.isFinite(Number(payload.lines)) ? Number(payload.lines) : 0);
    const fromLabel = String(payload.from_label || '').trim();
    const toLabel = String(payload.to_label || '').trim();
    const route =
      fromLabel && toLabel
        ? `${fromLabel} → ${toLabel}`
        : String(r.counterparty_name || '').trim();
    return {
      id: r.id,
      journal_key: r.journal_key,
      number: r.number,
      doc_date: r.doc_date,
      status: r.status,
      counterparty_name: route || r.counterparty_name,
      amount: r.amount,
      comment: String(payload.user_comment || r.comment || '').trim(),
      created_at: r.created_at,
      lines_count: linesCount,
      from_label: fromLabel,
      to_label: toLabel,
      stock_doc_id: String(payload.stock_doc_id || ''),
      stock_doc_number: String(payload.stock_doc_number || ''),
      warehouse_task_id: String(payload.warehouse_task_id || ''),
      warehouse_task_number: String(payload.warehouse_task_number || ''),
    };
  });
  return {
    journal: meta.key,
    title: meta.title,
    note: meta.note,
    map_ids: meta.map_ids,
    total: items.length,
    items,
  };
}

function parsePayloadLines(payloadJson: string): Array<{
  product_id: string;
  name: string;
  article: string;
  qty: number;
  price: number;
  amount: number;
  line_no: number;
  category: string;
  category_id: string;
  serials: string[];
}> {
  if (!payloadJson) return [];
  try {
    const payload = JSON.parse(payloadJson) as { lines?: unknown };
    const raw = Array.isArray(payload.lines) ? payload.lines : [];
    return raw
      .map((x) => {
        const row = x as Record<string, unknown>;
        const serialsRaw = row.serials;
        const serials = Array.isArray(serialsRaw)
          ? serialsRaw.map((s) => String(s || '').trim()).filter(Boolean)
          : String(row.serial || row.datamatrix || '')
              .trim()
              ? [String(row.serial || row.datamatrix).trim()]
              : [];
        return {
          product_id: String(row.product_id || ''),
          name: String(row.name || ''),
          article: String(row.article || ''),
          qty: Number(row.qty) || 0,
          price: Number(row.price) || 0,
          amount: Number(row.amount) || 0,
          line_no: Number(row.line_no) || 0,
          category: String(row.category || ''),
          category_id: String(row.category_id || ''),
          serials,
        };
      })
      .filter((l) => l.name || l.product_id || l.qty);
  } catch {
    return [];
  }
}

function enrichLinesWithCategories<
  T extends {
    product_id: string;
    category: string;
    category_id: string;
    name?: string;
    article?: string;
  },
>(lines: T[], supplierId = ''): Array<
  T & {
    sku: string;
    code: string;
    apps: AppVehicle[];
    apps_label: string;
    apps_short: string;
    apps_source: 'supplier' | 'catalog' | '';
  }
> {
  const ids = [...new Set(lines.map((l) => l.product_id).filter(Boolean))];
  if (!ids.length) {
    return lines.map((l) => ({
      ...l,
      sku: String(l.article || ''),
      code: '',
      apps: [],
      apps_label: '',
      apps_short: '',
      apps_source: '' as const,
    }));
  }
  const placeholders = ids.map(() => '?').join(',');
  const rows = all<{
    id: string;
    category: string;
    category_id: string;
    sku: string;
    code: string;
    name: string;
  }>(
    `SELECT p.id AS id,
            IFNULL(c.name, '') AS category,
            IFNULL(p.category_id, '') AS category_id,
            IFNULL(p.sku, '') AS sku,
            IFNULL(p.code, '') AS code,
            IFNULL(p.name, '') AS name
     FROM products p
     LEFT JOIN categories c ON c.id = p.category_id
     WHERE p.id IN (${placeholders})`,
    ids
  );
  const byId = new Map(rows.map((r) => [r.id, r]));
  const sid = String(supplierId || '').trim();
  const catalogByPid = new Map<string, AppVehicle[]>();
  const appRows = all<{
    product_id: string;
    mark: string;
    model: string;
    only_model: string;
    generation: string;
    years: string;
  }>(
    `SELECT product_id,
            IFNULL(mark,'') AS mark, IFNULL(model,'') AS model,
            IFNULL(only_model,'') AS only_model, IFNULL(generation,'') AS generation,
            IFNULL(years,'') AS years
     FROM product_applicability
     WHERE product_id IN (${placeholders})`,
    ids
  );
  for (const r of appRows) {
    const list = catalogByPid.get(r.product_id) || [];
    list.push({
      mark: r.mark,
      model: r.model || r.only_model,
      generation: r.generation,
      years: r.years,
    });
    catalogByPid.set(r.product_id, list);
  }
  const supplierByPid = new Map<string, AppVehicle[]>();
  if (sid) {
    try {
      const supRows = all<{ product_id: string; apps_json: string }>(
        `SELECT product_id, IFNULL(apps_json,'[]') AS apps_json
         FROM supplier_product_apps
         WHERE supplier_id = ? AND product_id IN (${placeholders})`,
        [sid, ...ids]
      );
      for (const r of supRows) {
        const apps = parseAppsJson(r.apps_json);
        if (apps.length) supplierByPid.set(r.product_id, apps);
      }
    } catch {
      /* table may be missing */
    }
  }
  return lines.map((l) => {
    const hit = l.product_id ? byId.get(l.product_id) : undefined;
    const fromSupplier = l.product_id ? supplierByPid.get(l.product_id) : undefined;
    const fromCatalog = l.product_id ? catalogByPid.get(l.product_id) : undefined;
    const apps = fromSupplier || fromCatalog || [];
    const apps_source: 'supplier' | 'catalog' | '' = fromSupplier?.length
      ? 'supplier'
      : fromCatalog?.length
        ? 'catalog'
        : '';
    return {
      ...l,
      name: String(l.name || hit?.name || ''),
      article: String(l.article || hit?.sku || hit?.code || ''),
      category: hit?.category || l.category || '',
      category_id: hit?.category_id || l.category_id || '',
      sku: String(hit?.sku || l.article || ''),
      code: String(hit?.code || ''),
      apps,
      apps_label: apps.length ? appsHumanLabel(apps) : '',
      apps_short: apps.length ? appsShortLabel(apps) : '',
      apps_source,
    };
  });
}

export function getThinJournalDoc(journalKey: string, id: string) {
  const meta = getThinJournalMeta(journalKey);
  if (!meta) throw new Error('unknown journal');
  const row = get<{
    id: string;
    journal_key: string;
    number: string;
    doc_date: string;
    status: string;
    counterparty_name: string;
    amount: number;
    comment: string;
    payload_json: string;
    created_at: string;
    updated_at: string;
  }>(
    `SELECT id, journal_key, number, doc_date, status, counterparty_name, amount, comment,
            IFNULL(payload_json,'') AS payload_json, created_at, updated_at
     FROM thin_journal_docs
     WHERE id = ? AND journal_key = ?`,
    [id, journalKey]
  );
  if (!row) return null;
  let payload: Record<string, unknown> = {};
  try {
    payload = row.payload_json ? (JSON.parse(row.payload_json) as Record<string, unknown>) : {};
  } catch {
    payload = {};
  }
  const counterpartyId = String(payload.counterparty_id || '').trim();
  let lines = enrichLinesWithCategories(parsePayloadLines(row.payload_json), counterpartyId);
  if (!lines.length && Array.isArray(payload.line_details)) {
    lines = enrichLinesWithCategories(
      parsePayloadLines(
        JSON.stringify({
          lines: (payload.line_details as Array<Record<string, unknown>>).map((l, i) => ({
            product_id: l.product_id,
            name: l.name,
            article: l.sku || l.article,
            qty: l.qty,
            line_no: i + 1,
          })),
        })
      ),
      counterpartyId
    );
  }
  return {
    id: row.id,
    journal_key: row.journal_key,
    journal_title: meta.title,
    number: row.number,
    doc_date: row.doc_date,
    status: row.status,
    counterparty_name: row.counterparty_name,
    amount: row.amount,
    comment: String(payload.user_comment || row.comment || '').trim(),
    created_at: row.created_at,
    updated_at: row.updated_at,
    receipt_numbers: String(payload.receipt_numbers || ''),
    source: String(payload.source || ''),
    warehouse: String(payload.warehouse || payload.warehouse_name || ''),
    warehouse_name: String(payload.warehouse_name || payload.warehouse || ''),
    counterparty_id: counterpartyId,
    from_label: String(payload.from_label || ''),
    to_label: String(payload.to_label || ''),
    user_comment: String(payload.user_comment || ''),
    stock_doc_id: String(payload.stock_doc_id || ''),
    stock_doc_number: String(payload.stock_doc_number || ''),
    warehouse_task_id: String(payload.warehouse_task_id || ''),
    warehouse_task_number: String(payload.warehouse_task_number || ''),
    lines,
    lines_count: lines.length,
  };
}

export function createThinJournalDoc(
  journalKey: string,
  input: {
    counterparty_name?: string;
    amount?: number;
    comment?: string;
    doc_date?: string;
    status?: string;
    payload_json?: string;
  }
) {
  const meta = getThinJournalMeta(journalKey);
  if (!meta) throw new Error('unknown journal');
  const id = newGuid();
  const number = nextCode(meta.prefix.replace(/[^A-Za-zА-Яа-я0-9]/g, '').slice(0, 4) || 'TJ', 5);
  const docDate = (input.doc_date || new Date().toISOString().slice(0, 10)).slice(0, 10);
  const status = String(input.status || 'draft').trim() || 'draft';
  run(
    `INSERT INTO thin_journal_docs
      (id, journal_key, number, doc_date, status, counterparty_name, amount, comment, payload_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      journalKey,
      number,
      docDate,
      status,
      String(input.counterparty_name || '').trim(),
      Number(input.amount) || 0,
      String(input.comment || '').trim(),
      String(input.payload_json || ''),
    ]
  );
  return get('SELECT * FROM thin_journal_docs WHERE id = ?', [id]);
}

function readPayloadObject(payloadJson: string): Record<string, unknown> {
  if (!payloadJson) return {};
  try {
    const p = JSON.parse(payloadJson) as Record<string, unknown>;
    return p && typeof p === 'object' && !Array.isArray(p) ? p : {};
  } catch {
    return {};
  }
}

function linesAmount(
  lines: Array<{ qty: number; price: number; amount: number }>
): number {
  return lines.reduce((s, l) => {
    const a = Number(l.amount);
    if (Number.isFinite(a) && a !== 0) return s + a;
    return s + (Number(l.qty) || 0) * (Number(l.price) || 0);
  }, 0);
}

function saveThinPayload(
  id: string,
  payload: Record<string, unknown>,
  lines: Array<{ qty: number; price: number; amount: number }>
) {
  const next = { ...payload, lines };
  const amount = Math.round(linesAmount(lines) * 100) / 100;
  run(
    `UPDATE thin_journal_docs
     SET payload_json = ?, amount = ?, updated_at = datetime('now')
     WHERE id = ?`,
    [JSON.stringify(next), amount, id]
  );
}

export function addThinJournalLine(
  journalKey: string,
  id: string,
  input: { product_id: string; qty?: number; price?: number }
) {
  const meta = getThinJournalMeta(journalKey);
  if (!meta) throw new Error('unknown journal');
  const row = get<{ id: string; payload_json: string }>(
    `SELECT id, IFNULL(payload_json,'') AS payload_json
     FROM thin_journal_docs WHERE id = ? AND journal_key = ?`,
    [id, journalKey]
  );
  if (!row) return null;
  const productId = String(input.product_id || '').trim();
  if (!productId) throw new Error('product_id required');
  const product = get<{
    id: string;
    sku: string;
    name: string;
    code: string;
  }>(
    `SELECT id, IFNULL(sku,'') AS sku, IFNULL(name,'') AS name, IFNULL(code,'') AS code
     FROM products WHERE id = ?`,
    [productId]
  );
  if (!product) throw new Error('product not found');
  const payload = readPayloadObject(row.payload_json);
  const lines = parsePayloadLines(row.payload_json);
  const qty = Number(input.qty);
  const qtySafe = Number.isFinite(qty) && qty > 0 ? qty : 1;
  const priceIn = Number(input.price);
  const price = Number.isFinite(priceIn) && priceIn >= 0 ? priceIn : 0;
  const amount = Math.round(qtySafe * price * 100) / 100;
  const maxNo = lines.reduce((m, l) => Math.max(m, Number(l.line_no) || 0), 0);
  lines.push({
    product_id: product.id,
    name: product.name || product.sku || product.code || 'Товар',
    article: product.sku || product.code || '',
    qty: qtySafe,
    price,
    amount,
    line_no: maxNo + 1,
    category: '',
    category_id: '',
    serials: [],
  });
  saveThinPayload(id, payload, lines);
  // Заказ поставщику: марки сразу на qty
  if (journalKey === 'supplier_orders') {
    const allocated = allocateThinJournalDatamatrix(journalKey, id, { force: false });
    if (allocated) return allocated;
  }
  return getThinJournalDoc(journalKey, id);
}

/** Нужны ли догенерированные марки (не хватает qty или есть дубли внутри заказа). */
export function thinJournalNeedsMarks(doc: {
  id?: string;
  lines?: Array<{ qty?: number; serials?: string[] }>;
} | null): boolean {
  if (!doc || !Array.isArray(doc.lines) || !doc.lines.length) return false;
  const seen = new Set<string>();
  for (const line of doc.lines) {
    const qtyNum = Number(line.qty);
    const need = Math.max(1, Math.round(Number.isFinite(qtyNum) && qtyNum > 0 ? qtyNum : 1));
    const serials = Array.isArray(line.serials)
      ? line.serials.map((s) => String(s || '').trim()).filter(Boolean)
      : [];
    if (serials.length < need) return true;
    for (const s of serials) {
      const key = s.toLowerCase();
      if (seen.has(key)) return true;
      seen.add(key);
    }
  }
  return false;
}

/**
 * Для заказа поставщику: догенерировать марки, если их нет.
 * Вызывается при открытии карточки и после добавления строк.
 */
export function ensureThinJournalMarks(journalKey: string, id: string) {
  if (journalKey !== 'supplier_orders') {
    return getThinJournalDoc(journalKey, id);
  }
  const doc = getThinJournalDoc(journalKey, id);
  if (!doc) return null;
  if (!thinJournalNeedsMarks(doc)) return doc;
  try {
    return allocateThinJournalDatamatrix(journalKey, id, { force: false }) || doc;
  } catch {
    // Открытие карточки важнее выдачи марок — не роняем GET
    return doc;
  }
}

/** Марка уже занята в экземплярах / старых заказах / других тонких журналах. */
function thinSerialTakenElsewhere(serial: string, excludeDocId?: string): boolean {
  const s = String(serial || '').trim();
  if (!s) return true;
  if (
    get<{ id: string }>(`SELECT id FROM product_units WHERE lower(serial) = lower(?) LIMIT 1`, [s])
  ) {
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
    /* table may be missing */
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
          `SELECT id FROM thin_journal_docs
           WHERE id != ? AND IFNULL(payload_json,'') LIKE ? ESCAPE '\\' LIMIT 1`,
          [excludeDocId, like]
        )
      : get<{ id: string }>(
          `SELECT id FROM thin_journal_docs
           WHERE IFNULL(payload_json,'') LIKE ? ESCAPE '\\' LIMIT 1`,
          [like]
        );
    if (hit) return true;
  } catch {
    /* ignore */
  }
  return false;
}

/** Уникальная марка: счётчик + проверка занятости. */
function thinNextUniqueBarcode(
  prefixRaw: string,
  usedInDoc: Set<string>,
  excludeDocId?: string
): string {
  for (let attempt = 0; attempt < 80; attempt++) {
    const code = nextBarcode(prefixRaw);
    const key = code.toLowerCase();
    if (usedInDoc.has(key)) continue;
    if (thinSerialTakenElsewhere(code, excludeDocId)) continue;
    usedInDoc.add(key);
    return code;
  }
  throw new Error('Не удалось выделить уникальную марку');
}

/** Уникальные марки (Data Matrix): по одной на каждую единицу qty в строке. */
export function allocateThinJournalDatamatrix(
  journalKey: string,
  id: string,
  opts?: { prefix?: string; force?: boolean }
) {
  const meta = getThinJournalMeta(journalKey);
  if (!meta) throw new Error('unknown journal');
  const row = get<{ id: string; payload_json: string; number: string; counterparty_name: string }>(
    `SELECT id, IFNULL(payload_json,'') AS payload_json, IFNULL(number,'') AS number,
            IFNULL(counterparty_name,'') AS counterparty_name
     FROM thin_journal_docs WHERE id = ? AND journal_key = ?`,
    [id, journalKey]
  );
  if (!row) return null;
  let prefix = String(opts?.prefix || '').trim();
  if (!prefix) {
    const cpName = String(row.counterparty_name || '').trim();
    if (cpName) {
      const cp = get<{ barcode_prefix: string }>(
        `SELECT IFNULL(barcode_prefix,'') AS barcode_prefix FROM counterparties
         WHERE name = ? OR IFNULL(name_full,'') = ? LIMIT 1`,
        [cpName, cpName]
      );
      prefix = String(cp?.barcode_prefix || '').trim();
    }
  }
  if (!prefix) prefix = 'DM';
  const force = !!opts?.force;
  const payload = readPayloadObject(row.payload_json);
  const lines = parsePayloadLines(row.payload_json);
  if (!lines.length) {
    const doc = getThinJournalDoc(journalKey, id);
    if (!doc) return null;
    return { ...doc, dm_created: 0, dm_prefix: prefix };
  }

  const usedInDoc = new Set<string>();
  let created = 0;
  let replaced = 0;

  for (const line of lines) {
    const qtyNum = Number(line.qty);
    const need = Math.max(1, Math.round(Number.isFinite(qtyNum) && qtyNum > 0 ? qtyNum : 1));
    const existing = force
      ? []
      : Array.isArray(line.serials)
        ? line.serials.map((s) => String(s || '').trim()).filter(Boolean)
        : [];

    const serials: string[] = [];
    for (const s of existing) {
      if (serials.length >= need) break;
      const key = s.toLowerCase();
      if (!key || usedInDoc.has(key)) {
        replaced += 1;
        continue;
      }
      // чужой/занятый код — не оставляем, выдадим новый
      if (thinSerialTakenElsewhere(s, id)) {
        replaced += 1;
        continue;
      }
      usedInDoc.add(key);
      serials.push(s);
    }
    while (serials.length < need) {
      serials.push(thinNextUniqueBarcode(prefix, usedInDoc, id));
      created += 1;
    }
    line.serials = serials;
  }

  saveThinPayload(
    id,
    {
      ...payload,
      dm_prefix: prefix,
      dm_allocated_at: new Date().toISOString(),
      dm_unique: true,
    },
    lines
  );
  const doc = getThinJournalDoc(journalKey, id);
  if (!doc) return null;
  return { ...doc, dm_created: created, dm_replaced: replaced, dm_prefix: prefix };
}

export function thinJournalDmLabels(journalKey: string, id: string) {
  const doc = getThinJournalDoc(journalKey, id);
  if (!doc) return null;
  const labels: Array<{
    serial: string;
    article: string;
    name: string;
    line_no: number;
  }> = [];
  for (const l of (doc.lines || []) as Array<Record<string, unknown>>) {
    const serials = Array.isArray(l.serials) ? l.serials.map((s) => String(s)) : [];
    for (const serial of serials) {
      labels.push({
        serial,
        article: String(l.article || ''),
        name: String(l.name || ''),
        line_no: Number(l.line_no) || 0,
      });
    }
  }
  return {
    number: String(doc.number || ''),
    counterparty_name: String(doc.counterparty_name || ''),
    labels,
  };
}

function escapeHtml(s: string): string {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function thinJournalDmLabelsHtml(journalKey: string, id: string): string {
  const data = thinJournalDmLabels(journalKey, id);
  if (!data) throw new Error('not found');
  const rows = data.labels
    .map((l) => {
      const dmSrc = `/api/datamatrix.png?text=${encodeURIComponent(l.serial)}&scale=3`;
      return `<div class="lbl">
      <img class="dm" src="${dmSrc}" alt="DataMatrix ${escapeHtml(l.serial)}" width="96" height="96" />
      <div class="txt">
        <div class="code">${escapeHtml(l.serial)}</div>
        <div class="meta">${escapeHtml(l.article)} · ${escapeHtml(l.name)}</div>
        <div class="ord">${escapeHtml(data.number)} · ${escapeHtml(data.counterparty_name)}</div>
      </div>
    </div>`;
    })
    .join('\n');
  return `<!DOCTYPE html><html lang="ru"><head><meta charset="utf-8"/><title>Data Matrix ${escapeHtml(data.number)}</title>
<style>
  body{font-family:system-ui,sans-serif;margin:12px}
  .lbl{display:flex;gap:12px;align-items:center;border:1px solid #333;border-radius:8px;padding:10px 12px;margin:0 0 10px;page-break-inside:avoid;width:380px}
  .dm{width:96px;height:96px;image-rendering:pixelated;flex-shrink:0}
  .code{font-size:16px;font-weight:800;letter-spacing:.04em;font-family:ui-monospace,monospace;word-break:break-all}
  .meta,.ord{font-size:12px;color:#444;margin-top:4px}
  @media print{.lbl{box-shadow:none}}
</style></head><body onload="window.print()">${rows || '<p>Нет кодов Data Matrix — сначала сгенерируйте</p>'}</body></html>`;
}

export function thinJournalDmExcelCsv(journalKey: string, id: string): string {
  const data = thinJournalDmLabels(journalKey, id);
  if (!data) throw new Error('not found');
  const esc = (s: string) => `"${String(s || '').replace(/"/g, '""')}"`;
  const lines = [
    ['Заказ', 'Поставщик', '№ строки', 'Артикул', 'Номенклатура', 'Data Matrix'].map(esc).join(';'),
  ];
  for (const l of data.labels) {
    lines.push(
      [data.number, data.counterparty_name, String(l.line_no), l.article, l.name, l.serial]
        .map(esc)
        .join(';')
    );
  }
  if (data.labels.length === 0) {
    lines.push([data.number, data.counterparty_name, '', '', '', ''].map(esc).join(';'));
  }
  return '\uFEFF' + lines.join('\r\n');
}

export async function thinJournalDmLabelsPdf(journalKey: string, id: string): Promise<Buffer> {
  const data = thinJournalDmLabels(journalKey, id);
  if (!data) throw new Error('not found');
  const PDFDocument = (await import('pdfkit')).default;
  const { renderDataMatrixPng } = await import('./datamatrix.js');
  const doc = new PDFDocument({ size: 'A4', margin: 36, info: { Title: `DM ${data.number}` } });
  const chunks: Buffer[] = [];
  doc.on('data', (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });
  doc.fontSize(14).text(`Data Matrix · ${data.number}`, { continued: false });
  doc.fontSize(10).fillColor('#555').text(data.counterparty_name || '—');
  doc.moveDown(0.6);
  if (!data.labels.length) {
    doc.fillColor('#000').text('Нет кодов — сначала сгенерируйте Data Matrix.');
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
    doc
      .fontSize(8)
      .fillColor('#000')
      .text(l.serial, x + 90, y + 14, { width: 70 });
    doc
      .fontSize(7)
      .fillColor('#444')
      .text(`${l.article}\n${l.name}`.slice(0, 80), x + 10, y + 90, { width: cellW - 20 });
    x += cellW + gap;
  }
  doc.end();
  return done;
}

export function removeThinJournalLine(journalKey: string, id: string, lineIndex: number) {
  const meta = getThinJournalMeta(journalKey);
  if (!meta) throw new Error('unknown journal');
  const row = get<{ id: string; payload_json: string }>(
    `SELECT id, IFNULL(payload_json,'') AS payload_json
     FROM thin_journal_docs WHERE id = ? AND journal_key = ?`,
    [id, journalKey]
  );
  if (!row) return null;
  const idx = Math.floor(Number(lineIndex));
  const payload = readPayloadObject(row.payload_json);
  const lines = parsePayloadLines(row.payload_json);
  if (idx < 0 || idx >= lines.length) throw new Error('line not found');
  lines.splice(idx, 1);
  lines.forEach((l, i) => {
    l.line_no = i + 1;
  });
  saveThinPayload(id, payload, lines);
  return getThinJournalDoc(journalKey, id);
}

export function patchThinJournalDoc(
  id: string,
  patch: {
    status?: string;
    counterparty_name?: string;
    amount?: number;
    comment?: string;
    doc_date?: string;
    payload_json?: string;
  }
) {
  const row = get<{ id: string }>('SELECT id FROM thin_journal_docs WHERE id = ?', [id]);
  if (!row) return null;
  if (patch.status != null) {
    run(`UPDATE thin_journal_docs SET status = ?, updated_at = datetime('now') WHERE id = ?`, [
      String(patch.status).trim(),
      id,
    ]);
  }
  if (patch.counterparty_name != null) {
    run(
      `UPDATE thin_journal_docs SET counterparty_name = ?, updated_at = datetime('now') WHERE id = ?`,
      [String(patch.counterparty_name).trim(), id]
    );
  }
  if (patch.amount != null) {
    run(`UPDATE thin_journal_docs SET amount = ?, updated_at = datetime('now') WHERE id = ?`, [
      Number(patch.amount) || 0,
      id,
    ]);
  }
  if (patch.comment != null) {
    run(`UPDATE thin_journal_docs SET comment = ?, updated_at = datetime('now') WHERE id = ?`, [
      String(patch.comment).trim(),
      id,
    ]);
  }
  if (patch.doc_date != null) {
    run(`UPDATE thin_journal_docs SET doc_date = ?, updated_at = datetime('now') WHERE id = ?`, [
      String(patch.doc_date).slice(0, 10),
      id,
    ]);
  }
  if (patch.payload_json != null) {
    run(`UPDATE thin_journal_docs SET payload_json = ?, updated_at = datetime('now') WHERE id = ?`, [
      String(patch.payload_json),
      id,
    ]);
  }
  return get('SELECT * FROM thin_journal_docs WHERE id = ?', [id]);
}

export function deleteThinJournalDoc(journalKey: string, id: string): boolean {
  const meta = getThinJournalMeta(journalKey);
  if (!meta) throw new Error('unknown journal');
  const row = get<{ id: string }>(
    `SELECT id FROM thin_journal_docs WHERE id = ? AND journal_key = ?`,
    [id, journalKey]
  );
  if (!row) return false;
  run(`DELETE FROM thin_journal_docs WHERE id = ? AND journal_key = ?`, [id, journalKey]);
  return true;
}

/** Отчёт закупок: последние приходы + ГТД в строках. */
export function purchasesInboundReport(limit = 100, gtdOnly = false) {
  const lim = Math.min(300, Math.max(1, Math.floor(Number(limit) || 100)));
  const items = all<{
    id: string;
    number: string;
    doc_date: string;
    counterparty: string;
    warehouse: string;
    amount: number;
    lines_with_gtd: number;
    gtd_codes: string;
  }>(
    `SELECT d.id, d.number, d.doc_date, d.amount,
            IFNULL(c.name,'') AS counterparty,
            IFNULL(w.name,'') AS warehouse,
            (SELECT COUNT(*) FROM stock_doc_lines l
              WHERE l.doc_id = d.id AND IFNULL(l.gtd_key,'') != '' AND l.gtd_key != '00000000-0000-0000-0000-000000000000'
            ) AS lines_with_gtd,
            (SELECT GROUP_CONCAT(DISTINCT IFNULL(NULLIF(l.gtd_code,''), g.code))
              FROM stock_doc_lines l
              LEFT JOIN gtd_numbers g ON g.id = l.gtd_key
              WHERE l.doc_id = d.id AND IFNULL(l.gtd_key,'') != ''
            ) AS gtd_codes
     FROM stock_docs d
     LEFT JOIN counterparties c ON c.id = d.counterparty_id
     LEFT JOIN warehouses w ON w.id = d.warehouse_id
     WHERE d.doc_type = 'in'
       AND (? = 0 OR EXISTS (
         SELECT 1 FROM stock_doc_lines l
         WHERE l.doc_id = d.id AND IFNULL(l.gtd_key,'') != ''
           AND l.gtd_key != '00000000-0000-0000-0000-000000000000'
       ))
     ORDER BY d.doc_date DESC, d.number DESC
     LIMIT ?`,
    [gtdOnly ? 1 : 0, lim]
  );
  return {
    note: 'Приходные накладные с признаком ГТД в строках. Полный отчёт УНФ — позже.',
    filter_gtd_only: !!gtdOnly,
    items,
  };
}

/** Расчёт потребностей: ниже минимума + без min_stock (топ по нулевым). */
export function demandCalculation(limit = 200) {
  const low = all(
    `SELECT p.id, p.sku, p.name, IFNULL(p.brand,'') AS brand,
            IFNULL(p.min_stock,0) AS min_stock,
            IFNULL((SELECT SUM(r.qty) FROM product_store_rests r WHERE r.product_id=p.id),0) AS qty,
            (IFNULL(p.min_stock,0) - IFNULL((SELECT SUM(r.qty) FROM product_store_rests r WHERE r.product_id=p.id),0)) AS need
     FROM products p
     WHERE IFNULL(p.is_active,1)=1 AND IFNULL(p.min_stock,0) > 0
       AND IFNULL((SELECT SUM(r.qty) FROM product_store_rests r WHERE r.product_id=p.id),0) < IFNULL(p.min_stock,0)
     ORDER BY need DESC
     LIMIT ?`,
    [Math.min(500, Math.max(1, limit))]
  );
  return {
    note: 'Потребность = min_stock − остаток. Задайте минимум в карточке товара. Не MRP 1С.',
    items: low,
    soon_data: 'Заказы поставщикам по потребности — следующий шаг после OData.',
  };
}

/** Хаб отчётов закупок (live SQLite). */
export function purchasesReportsHub() {
  return purchasesReportsLive();
}

/** Хаб отчётов склада (live SQLite). */
export function warehouseReportsHub() {
  return warehouseReportsLive();
}

/** Списания = stock_docs out (журнал). */
export function listWriteOffs(limit = 200) {
  const lim = Math.min(500, Math.max(1, limit));
  return {
    note: 'Списания / расходные со склада (doc_type=out). Данные из 1С sync + локальные.',
    items: all(
      `SELECT d.id, d.number, d.doc_date, d.amount, d.posted, d.source, d.comment,
              IFNULL(c.name,'') AS counterparty, IFNULL(w.name,'') AS warehouse
       FROM stock_docs d
       LEFT JOIN counterparties c ON c.id = d.counterparty_id
       LEFT JOIN warehouses w ON w.id = d.warehouse_id
       WHERE d.doc_type = 'out'
       ORDER BY d.doc_date DESC, d.number DESC
       LIMIT ?`,
      [lim]
    ),
  };
}

export function listTransfers(limit = 200) {
  const lim = Math.min(500, Math.max(1, limit));
  return {
    note: 'Перемещения между складами (doc_type=transfer).',
    items: all(
      `SELECT d.id, d.number, d.doc_date, d.posted, d.source, d.comment,
              IFNULL(w.name,'') AS warehouse_from,
              IFNULL(w2.name,'') AS warehouse_to
       FROM stock_docs d
       LEFT JOIN warehouses w ON w.id = d.warehouse_id
       LEFT JOIN warehouses w2 ON w2.id = d.warehouse_to_id
       WHERE d.doc_type = 'transfer'
       ORDER BY d.doc_date DESC, d.number DESC
       LIMIT ?`,
      [lim]
    ),
  };
}
