const view = document.getElementById('view');
const sectionPanel = document.getElementById('section-panel');
const tabsEl = document.getElementById('tabs');
const favsEl = document.getElementById('favs');

/** Маркер для сторожка в legacy.html (const state на window не попадает). */
window.__WMS_LEGACY_BOOT__ = 1;
if (view && !view.innerHTML) {
  view.innerHTML = '<p class="muted" style="padding:16px">Загрузка…</p>';
}

const state = {
  warehouses: [],
  units: [],
  categories: [],
  productsPage: 1,
  productsQ: '',
  productsSort: 'name',
  productsDir: 'asc',
  productsCategoryId: '',
  productsCategoryName: '',
  histPos: 0,
  histLen: 1,
  _onBackFallback: null,
  cpPage: 1,
  cpQ: '',
  cpPartyKind: '',
  cpPartner: '',
  cpSort: 'created',
  cpSortDir: 'desc',
  balPage: 1,
  balQ: '',
  balWh: '',
  /** Вкладка карточки склада: data | stock | history */
  balWhTab: 'stock',
  balHistPage: 1,
  balHistType: '',
  /**
   * Контур в шапке: id companies или '' = все организации.
   * Не путать с orgCompanyId (открытая карточка в списке Организации).
   */
  filterCompanyId: '',
  filterCompanyName: '',
  /** Карточка организации (контура) в /organizations/:id */
  orgCompanyId: '',
  balSort: '',
  balDir: 'desc',
  balXferOpen: false,
  /** После «В архив» при остатках — отметить все позиции в панели заказа на перемещение */
  balXferSelectAll: false,
  unitsProductId: '',
  unitsWarehouseId: '',
  unitsQ: '',
  unitsStatus: 'in_stock',
  unitsPage: 1,
  valPage: 1,
  valQ: '',
  valWh: '',
  whShowArchived: false,
  /** Хаб раздела Склад: warehouses | requests */
  whHubTab: 'warehouses',
  warehousesCreateOpen: false,
  staffQ: '',
  /** Карточка сотрудника: id или '' */
  staffFocusId: '',
  /** Вкладка карточки: sections | role | history */
  staffCardTab: 'role',
  amoSettingsTab: 'bridge',
  /** Страница документов в карточке контрагента */
  cpDocsPage: 1,
  cpDocsFocusId: '',
  auditQ: '',
  auditPage: 1,
  auditDay: '',
  auditAction: '',
  auditActorId: '',
  auditActorName: '',
  salesQ: '',
  salesPage: 1,
  docsType: '',
  /** Предвыбор основания при открытии «Новый приход»: supplier_order | return | none | '' */
  inCreateBasis: '',
  docsQ: '',
  docsPage: 1,
  docsSort: 'date',
  docsDir: 'desc',
  dealsQ: '',
  dealsPage: 1,
  dealsPipeline: '',
  dealsStatus: '',
  dealsResponsible: '',
  /** Канал: '' | Автосервис | Самовывоз | Отправка */
  dealsChannel: '',
  dealsSort: 'queued_at',
  dealsDir: 'desc',
  /** table = список; board = канбан одной воронки */
  dealsView: 'table',
  me: null,
  bookmarks: [],
  phoneFormat: 'plus7_spaced',
  curFocus: '',
  section: 'home',
  tabs: [],
  activeTab: '',
  /** Активная закладка секции в карточке товара (card/prices/…) */
  productSectionTab: 'card',
  /** Закладка карточки складского документа */
  docSectionTab: 'main',
};

const VIEW_TITLES = {
  dashboard: 'Начальная страница',
  products: 'Номенклатура',
  'cat-tree': 'Дерево категорий',
  'media-photos': 'Фото номенклатуры',
  props: 'Характеристики',
  marks: 'Марки / модели',
  brands: 'Бренды',
  prices: 'Типы цен',
  warehouses: 'Склады',
  'product-units': 'Экземпляры / серийники',
  'out-new': 'Новый расход',
  'in-new': 'Новый приход',
  counterparties: 'Контрагенты',
  suppliers: 'Поставщики',
  buyers: 'Покупатели',
  balances: 'Остатки',
  'stock-valuation': 'Стоимость склада',
  docs: 'Документы',
  in: 'Приходные накладные',
  ideas: 'Идеи и ошибки',
  staff: 'Сотрудники',
  audit: 'История / логи',
  presence: 'Кто в системе',
  deals: 'Заказы покупателей',
  pipelines: 'Воронки Amo',
  invoices: 'Счета на оплату',
  upd: 'УПД',
  sf: 'Счета-фактуры',
  workorders: 'Заказ-наряды',
  contracts: 'Договоры',
  'contract-new': 'Создать договор',
  org: 'Реквизиты организации',
  'phone-settings': 'Формат телефонов',
  'payment-link-settings': 'Ссылка на оплату',
  'settings-cdek': 'СДЭК',
  'settings-atol': 'АТОЛ',
  'settings-yandex-pay': 'Яндекс Сплит',
  'settings-tochka': 'Точка Банк',
  'settings-dadata': 'DaData',
  'settings-deepseek': 'DeepSeek / СТС',
  'settings-amo': 'AmoCRM',
  marking: 'Маркировка / партии',
  'wh-tasks': 'Задания склада',
  'wh-kpd': 'КПД склада',
  'ops-dash': 'Дашборд склада',
  income: 'Доход (зеркало)',
  currencies: 'Валюты',
  'money-bank': 'Банк и касса',
  'bank-docs': 'Документы по банку',
  'payment-orders': 'Платежные поручения',
  'money-transfers': 'Перемещения денег',
  cash: 'Документы по кассе',
  'cash-in': 'Поступления в кассу',
  'cash-out': 'Расходы из кассы',
  'cash-book': 'Кассовая книга',
  'cash-articles': 'Статьи движения денег',
  'cash-registers': 'Кассы',
  kassa: 'Касса',
  'card-ops': 'Операции по платёжным картам',
  'payment-calendar': 'Платёжный календарь',
  'job-titles': 'Должности',
  'work-schedules': 'Графики работы',
  'work-shifts': 'Рабочие смены',
  'time-kinds': 'Виды рабочего времени',
  'hr-docs': 'Документы по кадрам',
  persons: 'Физические лица',
  departments: 'Подразделения',
  organizations: 'Организации',
  'bank-accounts': 'Банковские счета',
  'all-dicts': 'Все справочники',
  'company-analytics': 'Анализ бизнеса',
  'kpi-debts-in': 'Долги нам',
  'kpi-debts-out': 'Долги наши',
  'kpi-net-assets': 'Чистые активы',
  'kpi-leads': 'Лиды',
  'kpi-sales-ytd': 'Продажи (с начала года)',
  'kpi-conversion': 'Конверсия заказов',
  'kpi-sales-dyn': 'Динамика продаж',
  'kpi-spend': 'Структура списания денег',
  'home-todos': 'Текущие дела',
  'my-settings': 'Мои настройки',
  'settings-stats': 'Состояние и синк',
  'settings-calendars': 'Календари',
  'settings-equipment': 'Поддержка оборудования',
  'settings-channels': 'Каналы продаж',
  'settings-reports': 'Отчеты',
  'sales-analysis': 'Анализ продаж',
};

/** Чистые URL вместо /legacy.html#… */
const TAB_PATHS = {
  dashboard: '/',
  products: '/products',
  'cat-tree': '/categories/tree',
  'media-photos': '/media/photos',
  props: '/props',
  marks: '/marks',
  brands: '/brands',
  prices: '/prices',
  warehouses: '/warehouses',
  'product-units': '/product-units',
  counterparties: '/counterparties',
  suppliers: '/suppliers',
  buyers: '/buyers',
  balances: '/balances',
  'stock-valuation': '/stock/valuation',
  docs: '/docs',
  in: '/in',
  'in-new': '/in/new',
  'out-new': '/out/new',
  invoices: '/invoices',
  upd: '/upd',
  sf: '/sf',
  workorders: '/workorders',
  contracts: '/contracts',
  'contract-new': '/contracts/new',
  org: '/org',
  'phone-settings': '/settings/phones',
  'payment-link-settings': '/settings/payment-link',
  'settings-cdek': '/settings/cdek',
  'settings-atol': '/settings/atol',
  'settings-yandex-pay': '/settings/yandex-pay',
  'settings-tochka': '/settings/tochka',
  'settings-dadata': '/settings/dadata',
  'settings-deepseek': '/settings/deepseek',
  'settings-amo': '/settings/amo',
  ideas: '/ideas',
  staff: '/staff',
  audit: '/audit',
  presence: '/presence',
  deals: '/deals',
  pipelines: '/pipelines',
  marking: '/marking',
  'wh-tasks': '/warehouse/tasks',
  'wh-kpd': '/warehouse/kpd',
  'ops-dash': '/ops',
  income: '/income',
  currencies: '/currencies',
  'money-bank': '/money/bank',
  'bank-docs': '/bank-docs',
  'payment-orders': '/payment-orders',
  'money-transfers': '/money-transfers',
  cash: '/cash',
  'cash-in': '/cash/in',
  'cash-out': '/cash/out',
  'cash-book': '/cash-book',
  'cash-articles': '/cash-articles',
  'cash-registers': '/cash-registers',
  kassa: '/kassa',
  'card-ops': '/card-ops',
  'payment-calendar': '/payment-calendar',
  'job-titles': '/job-titles',
  'work-schedules': '/work-schedules',
  'work-shifts': '/work-shifts',
  'time-kinds': '/time-kinds',
  'hr-docs': '/hr-docs',
  persons: '/persons',
  departments: '/departments',
  organizations: '/organizations',
  'bank-accounts': '/bank-accounts',
  'all-dicts': '/dicts',
  'company-analytics': '/company-analytics',
  'kpi-debts-in': '/kpi/debts-in',
  'kpi-debts-out': '/kpi/debts-out',
  'kpi-net-assets': '/kpi/net-assets',
  'kpi-leads': '/kpi/leads',
  'kpi-sales-ytd': '/kpi/sales-ytd',
  'kpi-conversion': '/kpi/conversion',
  'kpi-sales-dyn': '/kpi/sales-dynamics',
  'kpi-spend': '/kpi/spend',
  'home-todos': '/home-todos',
  'my-settings': '/settings/my',
  'settings-stats': '/settings/stats',
  'settings-calendars': '/settings/calendars',
  'settings-equipment': '/settings/equipment',
  'settings-channels': '/settings/sales-channels',
  'settings-reports': '/settings/reports',
  'sales-analysis': '/sales-analysis',
};

const SECTION_PATHS = {
  home: '/',
  crm: '/crm',
  sales: '/sales',
  documents: '/documents',
  purchases: '/purchases',
  warehouse: '/warehouse',
  works: '/works',
  production: '/production',
  money: '/money',
  kassa: '/kassa',
  staff: '/staff',
  company: '/company',
  settings: '/settings',
  ideas: '/ideas',
  help: '/help',
};

/** Раздел сразу открывает журнал (а не только меню). Склад — как Закупки: промежуточное меню. */
const SECTION_LANDING = {
  home: 'dashboard',
  staff: 'staff',
  ideas: 'ideas',
  kassa: 'kassa',
};

const PATH_TO_SECTION = Object.fromEntries(
  Object.entries(SECTION_PATHS)
    .filter(([, path]) => path !== '/' && !path.includes('/tochka'))
    .map(([section, path]) => [path, section])
);
// алиасы
PATH_TO_SECTION['/personnel'] = 'staff';
PATH_TO_SECTION['/money'] = 'money';
PATH_TO_SECTION['/money/bank'] = 'money';
PATH_TO_SECTION['/warehouse'] = 'warehouse';
PATH_TO_SECTION['/warehouses'] = 'warehouse';
PATH_TO_SECTION['/product-units'] = 'warehouse';
PATH_TO_SECTION['/out/new'] = 'documents';

let suppressUrlSync = false;

/** Позиция в истории SPA: для кнопок Назад/Вперёд в titlebar. */
function syncNavButtons() {
  const back = document.getElementById('tb-back');
  const fwd = document.getElementById('tb-fwd');
  const pos = Number(state.histPos) || 0;
  const len = Math.max(1, Number(state.histLen) || 1);
  const canBack = pos > 0;
  const canFwd = pos < len - 1;
  if (back) {
    back.disabled = !canBack && typeof state._onBackFallback !== 'function';
    back.setAttribute('aria-disabled', back.disabled ? 'true' : 'false');
  }
  if (fwd) {
    fwd.disabled = !canFwd;
    fwd.setAttribute('aria-disabled', canFwd ? 'false' : 'true');
  }
}

function goAppBack() {
  const pos = Number(state.histPos) || 0;
  if (pos > 0) {
    history.back();
    return;
  }
  if (typeof state._onBackFallback === 'function') {
    state._onBackFallback();
    return;
  }
  showSection(state.section || 'home');
}

function goAppForward() {
  const pos = Number(state.histPos) || 0;
  const len = Math.max(1, Number(state.histLen) || 1);
  if (pos < len - 1) history.forward();
}

function pathForTab(id) {
  if (id.startsWith('product:')) return '/products/' + encodeURIComponent(id.slice('product:'.length));
  if (id.startsWith('company:')) return '/counterparties/' + encodeURIComponent(id.slice('company:'.length));
  if (id.startsWith('doc:')) return '/docs/' + encodeURIComponent(id.slice('doc:'.length));
  if (id.startsWith('deal:')) return '/deals/' + encodeURIComponent(id.slice('deal:'.length));
  if (id.startsWith('sales:')) return '/sales-docs/' + encodeURIComponent(id.slice('sales:'.length));
  if (id.startsWith('history:'))
    return '/deals/' + encodeURIComponent(id.slice('history:'.length)) + '/history';
  if (id.startsWith('structure:'))
    return '/deals/' + encodeURIComponent(id.slice('structure:'.length)) + '/structure';
  if (id.startsWith('xfer:'))
    return '/transfer-orders/' + encodeURIComponent(id.slice('xfer:'.length));
  if (id.startsWith('serial:')) return '/serials/' + encodeURIComponent(id.slice('serial:'.length));
  // Остатки конкретного склада — шарибельный URL
  if (id === 'balances' && state.balWh) {
    return '/warehouses/' + encodeURIComponent(state.balWh);
  }
  // Карточка организации (контура) — /organizations/:id
  if (id === 'organizations' && state.orgCompanyId) {
    return '/organizations/' + encodeURIComponent(state.orgCompanyId);
  }
  return TAB_PATHS[id] || '/' + encodeURIComponent(id);
}

function pathForSection(section) {
  if (SECTION_LANDING[section]) return pathForTab(SECTION_LANDING[section]);
  return SECTION_PATHS[section] || '/' + section;
}

function setUrl(path, replace) {
  if (suppressUrlSync) return;
  const next = path || '/';
  const same = location.pathname === next;
  if (same && !replace) return;
  try {
    if (replace) {
      const pos = Number(state.histPos) || 0;
      history.replaceState({ wms: true, pos }, '', next);
    } else {
      const pos = (Number(state.histPos) || 0) + 1;
      state.histPos = pos;
      state.histLen = pos + 1;
      history.pushState({ wms: true, pos }, '', next);
    }
  } catch {
    /* ignore */
  }
  syncNavButtons();
  if (state.me) {
    clearTimeout(state._presenceUrlTimer);
    state._presenceUrlTimer = setTimeout(() => {
      sendPresenceHeartbeat().then(() => refreshPresenceChip());
    }, 250);
  }
}

function parseAppPath(pathname) {
  const path = (pathname || '/').replace(/\/+$/, '') || '/';
  const product = path.match(/^\/products\/([^/]+)$/);
  if (product) return { type: 'tab', id: 'product:' + decodeURIComponent(product[1]) };
  const company = path.match(/^\/counterparties\/([^/]+)$/);
  if (company) return { type: 'tab', id: 'company:' + decodeURIComponent(company[1]) };
  const doc = path.match(/^\/docs\/([^/]+)$/);
  if (doc) return { type: 'tab', id: 'doc:' + decodeURIComponent(doc[1]) };
  const dealHist = path.match(/^\/deals\/([^/]+)\/history$/);
  if (dealHist) return { type: 'tab', id: 'history:' + decodeURIComponent(dealHist[1]) };
  const dealStruct = path.match(/^\/deals\/([^/]+)\/structure$/);
  if (dealStruct) return { type: 'tab', id: 'structure:' + decodeURIComponent(dealStruct[1]) };
  const deal = path.match(/^\/deals\/([^/]+)$/);
  if (deal) return { type: 'tab', id: 'deal:' + decodeURIComponent(deal[1]) };
  const sales = path.match(/^\/sales-docs\/([^/]+)$/);
  if (sales) return { type: 'tab', id: 'sales:' + decodeURIComponent(sales[1]) };
  const xfer = path.match(/^\/transfer-orders\/([^/]+)$/);
  if (xfer) return { type: 'tab', id: 'xfer:' + decodeURIComponent(xfer[1]) };
  const serialPath = path.match(/^\/serials\/(.+)$/);
  if (serialPath) {
    try {
      return { type: 'tab', id: 'serial:' + decodeURIComponent(serialPath[1]) };
    } catch {
      return { type: 'tab', id: 'serial:' + serialPath[1] };
    }
  }
  // /organizations/:id — карточка контура (список = ровно /organizations)
  const orgCo = path.match(/^\/organizations\/([^/]+)$/);
  if (orgCo) {
    const cid = decodeURIComponent(orgCo[1]);
    if (cid) return { type: 'tab', id: 'organizations', companyId: cid };
  }
  // /warehouses/:id — остатки этого склада (список складов = ровно /warehouses)
  const whStock = path.match(/^\/warehouses\/([^/]+)$/);
  if (whStock) {
    const wid = decodeURIComponent(whStock[1]);
    if (wid) return { type: 'tab', id: 'balances', warehouseId: wid };
  }
  // алиас /balances/:id
  const balOne = path.match(/^\/balances\/([^/]+)$/);
  if (balOne) {
    const wid = decodeURIComponent(balOne[1]);
    if (wid) return { type: 'tab', id: 'balances', warehouseId: wid };
  }
  // /balances?warehouse_id=… / ?warehouse=…
  if (path === '/balances') {
    try {
      const qs = new URLSearchParams(location.search || '');
      const wid = (qs.get('warehouse_id') || qs.get('warehouse') || '').trim();
      if (wid) return { type: 'tab', id: 'balances', warehouseId: wid };
    } catch {
      /* ignore */
    }
  }
  // алиасы: /warehouse/suppliers, /counterparties?kind=supplier
  if (path === '/warehouse/suppliers' || path === '/purchases/suppliers') {
    return { type: 'tab', id: 'suppliers' };
  }
  if (path === '/warehouse/buyers' || path === '/sales/buyers') {
    return { type: 'tab', id: 'buyers' };
  }
  if (path === '/settings/yookassa') {
    return { type: 'tab', id: 'settings-tochka' };
  }
  if (path === '/counterparties') {
    try {
      const kind = new URLSearchParams(location.search || '').get('kind') || '';
      if (kind === 'supplier') return { type: 'tab', id: 'suppliers' };
      if (kind === 'buyer') return { type: 'tab', id: 'buyers' };
    } catch {
      /* ignore */
    }
  }
  for (const [tab, p] of Object.entries(TAB_PATHS)) {
    if (p === path) return { type: 'tab', id: tab };
  }
  if (PATH_TO_SECTION[path]) return { type: 'section', id: PATH_TO_SECTION[path] };
  if (path === '/money/tochka') return { type: 'external', id: 'tochka' };
  return { type: 'section', id: 'home' };
}

function highlightSection(section) {
  state.section = section;
  document.querySelectorAll('.taxi-sections .sec').forEach((b) => {
    b.classList.toggle('active', b.dataset.section === section);
  });
}

/** Расширяется Batch A / другими секциями (parity modules). */
const TAB_SECTION_MAP = {
  dashboard: 'home',
  products: 'warehouse',
  'cat-tree': 'warehouse',
  'media-photos': 'warehouse',
  props: 'warehouse',
  marks: 'warehouse',
  brands: 'warehouse',
  prices: 'sales',
  warehouses: 'warehouse',
  'product-units': 'warehouse',
  'out-new': 'documents',
  'in-new': 'documents',
  balances: 'warehouse',
  'stock-valuation': 'warehouse',
  docs: 'documents',
  in: 'documents',
  counterparties: 'crm',
  deals: 'crm',
  pipelines: 'crm',
  invoices: 'documents',
  upd: 'documents',
  sf: 'documents',
  workorders: 'documents',
  contracts: 'documents',
  'contract-new': 'documents',
  org: 'company',
  'phone-settings': 'settings',
  'payment-link-settings': 'settings',
  'settings-stats': 'settings',
  'settings-cdek': 'settings',
  'settings-atol': 'settings',
  'settings-yandex-pay': 'settings',
  'settings-tochka': 'settings',
  'settings-dadata': 'settings',
  'settings-deepseek': 'settings',
  'settings-amo': 'settings',
  staff: 'staff',
  audit: 'settings',
  presence: 'settings',
  ideas: 'ideas',
  marking: 'warehouse',
  'wh-tasks': 'warehouse',
  'wh-kpd': 'warehouse',
  'ops-dash': 'home',
  income: 'money',
  currencies: 'money',
  kassa: 'kassa',
  cash: 'kassa',
  'cash-book': 'kassa',
  'cash-articles': 'kassa',
  'cash-registers': 'kassa',
};

function sectionForTab(tabId) {
  const base = String(tabId || '').split(':')[0];
  if (base === 'suppliers') {
    if (canAccessSectionMe('purchases')) return 'purchases';
    if (canAccessSectionMe('warehouse')) return 'warehouse';
    if (canAccessSectionMe('company')) return 'company';
    return 'crm';
  }
  if (base === 'buyers') {
    if (canAccessSectionMe('sales')) return 'sales';
    if (canAccessSectionMe('company')) return 'company';
    return 'crm';
  }
  if (base === 'in' && !canAccessSectionMe('purchases') && canAccessSectionMe('warehouse')) {
    return 'warehouse';
  }
  if (base === 'sales' || base === 'doc') return 'documents';
  if (base === 'history' || base === 'deal' || base === 'structure' || base === 'prep')
    return 'crm';
  if (base === 'xfer') return 'warehouse';
  if (base === 'serial') return 'warehouse';
  return TAB_SECTION_MAP[base] || state.section || 'home';
}

function applyAppPath(pathname, replace) {
  const parsed = parseAppPath(pathname);
  suppressUrlSync = true;
  try {
    if (parsed.type === 'tab') {
      const tab = parsed.id;
      if (tab === 'balances') {
        if (parsed.warehouseId) {
          state.balWh = String(parsed.warehouseId);
          state.balPage = 1;
        } else {
          state.balWh = '';
        }
      }
      if (tab === 'warehouses') {
        state.balWh = '';
      }
      if (tab === 'organizations') {
        state.orgCompanyId = parsed.companyId ? String(parsed.companyId) : '';
      }
      highlightSection(sectionForTab(tab));
      if (tab === 'dashboard') {
        showForm();
        openTab('dashboard');
      } else {
        openTab(tab);
      }
    } else if (parsed.type === 'external' && parsed.id === 'tochka') {
      location.href = '/money/tochka';
    } else {
      showSection(parsed.id);
    }
  } finally {
    suppressUrlSync = false;
  }
  if (replace) setUrl(pathname.replace(/\/+$/, '') || '/', true);
}

const SECTIONS = {
  home: null,
  crm: {
    cols: [
      [
        {
          title: 'CRM',
          links: [
            { view: 'counterparties', label: 'Контрагенты' },
            { view: 'deals', label: 'Заказы покупателей' },
            { view: 'pipelines', label: 'Воронки Amo' },
            { label: 'События', disabled: true },
            { label: 'Задания', disabled: true },
          ],
        },
      ],
      [
        {
          title: 'Аналитика',
          links: [
            { view: 'pipelines', label: 'Воронка продаж' },
            { label: 'Отчеты', disabled: true },
          ],
        },
      ],
    ],
  },
  sales: {
    /** Э0–Э1: юр/розн. конвейер. Документы продаж — в разделе «Документы». */
    cols: [
      [
        {
          title: 'Продажи',
          links: [
            { view: 'buyers', label: 'Покупатели' },
            { view: 'deals', label: 'Заказы покупателей' },
          ],
        },
      ],
      [
        {
          title: 'Товары',
          links: [
            { view: 'products', label: 'Номенклатура' },
            { view: 'prices', label: 'Типы цен' },
          ],
        },
      ],
    ],
  },
  documents: {
    cols: [
      [
        {
          title: 'Документы',
          links: [
            { view: 'docs', label: 'Расходные накладные' },
            { view: 'in', label: 'Приходные накладные' },
            { view: 'in-new', label: 'Создать приходную' },
            { view: 'invoices', label: 'Счета на оплату' },
            { view: 'workorders', label: 'Заказ-наряды' },
            { view: 'upd', label: 'УПД' },
            { view: 'sf', label: 'Счета-фактуры' },
            { view: 'contracts', label: 'Договоры' },
            { view: 'contract-new', label: 'Создать договор' },
          ],
        },
      ],
    ],
  },
  purchases: {
    /** Э0–Э1: приход + поставщики. ГТД/паритет УНФ — по URL, не в меню. */
    cols: [
      [
        {
          title: 'Закупки',
          links: [
            { view: 'suppliers', label: 'Поставщики' },
            { view: 'in', label: 'Приходные накладные' },
            { view: 'in-new', label: 'Создать приходную' },
          ],
        },
      ],
    ],
  },
  warehouse: {
    /** Как Закупки: клик по разделу → промежуточное меню (паритет дописывает пункты). */
    cols: [
      [
        {
          title: 'Склад',
          links: [
            { view: 'warehouses', label: 'Склады', whHubTab: 'warehouses' },
            { view: 'warehouses', label: 'Заказы на перемещение', whHubTab: 'requests' },
            { view: 'balances', label: 'Остатки' },
            { view: 'wh-tasks', label: 'Задания склада' },
          ],
        },
      ],
    ],
  },
  works: {
    cols: [
      [
        {
          title: 'СТО',
          links: [
            { label: 'Подъёмник', href: '/lift' },
            { label: 'Приёмщик', href: '/reception' },
          ],
        },
        {
          title: 'Работы',
          links: [
            { view: 'docs', label: 'Заказ-наряды' },
            { view: 'counterparties', label: 'Заказчики' },
            { view: 'products', label: 'Номенклатура (работы)' },
          ],
        },
      ],
    ],
  },
  production: {
    cols: [
      [
        {
          title: 'Производство',
          links: [
            { label: 'Заказы на производство', disabled: true },
            { view: 'products', label: 'Номенклатура' },
          ],
        },
      ],
    ],
  },
  money: {
    /** Э0–Э1: Точка/СБП, ссылка оплаты, Доход. Полный банк/касса УНФ — по URL. */
    cols: [
      [
        {
          title: 'Оплаты',
          links: [
            { view: 'invoices', label: 'Счета на оплату' },
            { view: 'payment-link-settings', label: 'Ссылка на оплату' },
            { view: 'payment-orders', label: 'Платежные поручения' },
          ],
        },
        {
          title: 'Касса',
          links: [
            { view: 'kassa', label: 'Кассы и статусы', kassaTab: 'registers' },
            { view: 'cash', label: 'Документы по кассе' },
            { view: 'cash-book', label: 'Кассовая книга' },
          ],
        },
      ],
      [
        {
          title: 'Учёт дня',
          links: [
            { view: 'income', label: 'Доход (зеркало)' },
            { view: 'currencies', label: 'Валюты и курсы' },
            { view: 'parity-money-reports', label: 'Отчёты по деньгам' },
          ],
        },
      ],
    ],
  },
  kassa: {
    cols: [
      [
        {
          title: 'Кассы',
          links: [
            { view: 'kassa', label: 'Кассы (остатки)', kassaTab: 'registers' },
            { view: 'kassa', label: 'Журнал чеков и оплат', kassaTab: 'journal' },
            { view: 'cash-registers', label: 'Справочник касс' },
            { view: 'cash', label: 'Документы по кассе' },
            { view: 'cash-book', label: 'Кассовая книга' },
            { view: 'cash-articles', label: 'Статьи движения денег' },
          ],
        },
        {
          title: 'Интеграции',
          links: [
            { view: 'settings-atol', label: 'Настройки АТОЛ' },
            { view: 'settings-yandex-pay', label: 'Яндекс Сплит' },
            { view: 'payment-link-settings', label: 'Ссылка на оплату' },
          ],
        },
      ],
    ],
  },
  staff: {
    cols: [
      [
        {
          title: 'Персонал',
          links: [
            { view: 'staff', label: 'Сотрудники' },
            { view: 'persons', label: 'Физические лица' },
            { view: 'hr-docs', label: 'Документы по кадрам' },
            { view: 'job-titles', label: 'Должности' },
            { view: 'work-schedules', label: 'Графики работы' },
            { view: 'work-shifts', label: 'Рабочие смены' },
            { view: 'time-kinds', label: 'Виды рабочего времени' },
          ],
        },
      ],
    ],
  },
  company: {
    cols: [
      [
        {
          title: 'Компания',
          links: [
            { view: 'organizations', label: 'Организации' },
            { view: 'bank-accounts', label: 'Банковские счета' },
            { view: 'warehouses', label: 'Склады и магазины' },
            { view: 'staff', label: 'Сотрудники' },
            { view: 'counterparties', label: 'Контрагенты' },
            { view: 'suppliers', label: 'Поставщики' },
            { view: 'buyers', label: 'Покупатели' },
            { view: 'currencies', label: 'Валюты' },
            { view: 'all-dicts', label: 'Все справочники' },
          ],
        },
      ],
    ],
  },
  settings: {
    cols: [
      [
        {
          title: 'Настройки',
          links: [
            { view: 'my-settings', label: 'Мои настройки' },
            { view: 'settings-stats', label: 'Состояние и синк' },
            { view: 'phone-settings', label: 'Формат телефонов' },
            { view: 'payment-link-settings', label: 'Ссылка на оплату' },
            { view: 'prices', label: 'Типы цен' },
            { view: 'staff', label: 'Настройки пользователей и прав' },
            { view: 'all-dicts', label: 'Все справочники' },
            { view: 'settings-calendars', label: 'Календари' },
            { view: 'presence', label: 'Кто в системе' },
            { view: 'audit', label: 'История / логи' },
          ],
        },
        {
          title: 'Интеграции',
          links: [
            { view: 'settings-amo', label: 'AmoCRM' },
            { view: 'cdek-settings', label: 'СДЭК' },
            { view: 'settings-atol', label: 'АТОЛ' },
            { view: 'settings-yandex-pay', label: 'Яндекс Сплит' },
            { view: 'settings-tochka', label: 'Точка Банк' },
            { view: 'settings-dadata', label: 'DaData' },
            { view: 'settings-deepseek', label: 'DeepSeek / СТС' },
            { view: 'settings-channels', label: 'Каналы продаж' },
            { view: 'settings-equipment', label: 'Поддержка оборудования' },
            { view: 'settings-reports', label: 'Отчеты' },
          ],
        },
        {
          title: 'Ссылки',
          links: [{ label: 'Помощь', href: '/help' }],
        },
      ],
    ],
  },
  help: {
    cols: [],
  },
};

let _apiPending = 0;
let _bootLoading = true;
let _apiBarShowTimer = 0;
let _apiBarFailsafeTimer = 0;

function syncTopLoading(immediate) {
  const top = document.querySelector('.taxi-top');
  if (!top) return;
  const on = _bootLoading || _apiPending > 0;
  window.clearTimeout(_apiBarFailsafeTimer);
  if (!on) {
    window.clearTimeout(_apiBarShowTimer);
    top.classList.remove('is-loading');
    return;
  }
  const show = () => {
    top.classList.add('is-loading');
    // Не крутить вечно, если запрос завис
    window.clearTimeout(_apiBarFailsafeTimer);
    _apiBarFailsafeTimer = window.setTimeout(() => {
      _bootLoading = false;
      _apiPending = 0;
      top.classList.remove('is-loading');
    }, 6000);
  };
  if (immediate || _bootLoading || top.classList.contains('is-loading')) {
    window.clearTimeout(_apiBarShowTimer);
    show();
    return;
  }
  window.clearTimeout(_apiBarShowTimer);
  _apiBarShowTimer = window.setTimeout(show, 60);
}

function setTopLoading(on) {
  if (on) {
    document.querySelector('.taxi-top')?.classList.add('is-loading');
  } else {
    syncTopLoading();
  }
}

function finishBootLoading() {
  _bootLoading = false;
  syncTopLoading();
}

function apiShowsLoadingBar(path, opts) {
  if (opts && opts.quiet) return false;
  const p = String(path || '').split('?')[0];
  if (p === '/presence/heartbeat') return false;
  if (p === '/presence/online') return false;
  if (p === '/chats/unread') return false;
  if (p === '/chats') return false;
  if (p === '/currencies/header') return false;
  if (p === '/bookmarks' || p.startsWith('/bookmarks/')) return false;
  if (p === '/me/bookmarks' || p.startsWith('/me/bookmarks/')) return false;
  if (p === '/settings/phones' || p === '/ui/phone-settings' || p === '/me/phone-settings' || p === '/ui-settings') return false;
  return true;
}

async function api(path, opts = {}) {
  const showBar = apiShowsLoadingBar(path, opts);
  const { quiet: _quiet, ...fetchOpts } = opts;
  if (showBar) {
    _apiPending += 1;
    syncTopLoading();
  }
  try {
    const isForm =
      typeof FormData !== 'undefined' && fetchOpts.body instanceof FormData;
    const headers = { ...(fetchOpts.headers || {}) };
    if (!isForm && headers['Content-Type'] == null) {
      headers['Content-Type'] = 'application/json';
    }
    if (isForm) delete headers['Content-Type'];
    const res = await fetch('/api' + path, {
      ...fetchOpts,
      headers,
    });
    if (res.status === 401) {
      location.href = '/login';
      throw new Error('unauthorized');
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(formatApiError(data.error || res.statusText));
    return data;
  } finally {
    if (showBar) {
      _apiPending = Math.max(0, _apiPending - 1);
      syncTopLoading();
    }
  }
}

/** Человекочитаемый текст ошибки API (без сырого JSON Точки). */
function formatApiError(msg) {
  const s = String(msg || '');
  const jsonStart = s.indexOf('{');
  if (jsonStart >= 0) {
    try {
      const j = JSON.parse(s.slice(jsonStart));
      const detail = (j.Errors && j.Errors[0] && j.Errors[0].message) || j.message || '';
      if (detail && /match pattern/i.test(detail)) {
        return 'Точка: недопустимые символы в назначении платежа';
      }
      if (detail) return (s.slice(0, jsonStart).trim() || 'Точка') + ': ' + detail;
    } catch (_) {
      /* keep */
    }
  }
  return s;
}

function esc(s) {
  return String(s ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

/** ФИО из 1С часто ВСЕ КАПСОМ — для UI приводим к «Как В Заголовке». */
function formatPersonName(name) {
  const s = String(name ?? '').trim();
  if (!s) return s;
  const letters = s.replace(/[^a-zA-Zа-яА-ЯёЁ]/g, '');
  if (!letters) return s;
  const upper = (letters.match(/[A-ZА-ЯЁ]/g) || []).length;
  if (upper < letters.length * 0.7) return s;
  return s
    .toLocaleLowerCase('ru-RU')
    .replace(/(^|[\s\-])(\S)/g, (_, sep, ch) => sep + ch.toLocaleUpperCase('ru-RU'));
}

function looksLikeGuid(s) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(s || ''));
}

/** Название для списка: если в 1С пусто и лежит GUID — показываем номер УНФ (sku). */
function meRights() {
  return (state.me && state.me.rights) || {};
}

function isAdminMe() {
  return !!(state.me && (state.me.isSystemAdmin || state.me.role === 'admin'));
}

function canEditProducts() {
  return isAdminMe() || !!meRights().can_edit_products;
}

function canEditPrices() {
  return isAdminMe() || !!meRights().can_edit_prices;
}

function canSync1c() {
  return isAdminMe() || !!meRights().can_sync;
}

function canAccessSectionMe(section) {
  if (isAdminMe()) return true;
  const secs = meRights().sections;
  if (!Array.isArray(secs)) return true; // пока /me не загрузился — не прячем всё
  if (section === 'documents') {
    return secs.includes('documents') || secs.includes('sales');
  }
  return secs.includes(section);
}

/** Меню «сейчас» (Э0–Э1 по ТЗ/VISION). Остальное скрыто в сайдбаре, URL работают. */
const NAV_SECTIONS_NOW = new Set([
  'home',
  'sales',
  'documents',
  'purchases',
  'warehouse',
  'money',
  'kassa',
  'staff',
  'chats',
  'company',
  'settings',
  'help',
]);

function applyNavRights() {
  document.querySelectorAll('.taxi-sections .sec').forEach((btn) => {
    const sec = btn.dataset.section;
    if (!sec) return;
    const ok = canAccessSectionMe(sec) && NAV_SECTIONS_NOW.has(sec);
    btn.hidden = !ok;
    btn.setAttribute('aria-hidden', ok ? 'false' : 'true');
    if (!ok) btn.classList.remove('active');
  });
}

function presenceSnapshot() {
  const tabId = state.activeTab || '';
  const tab = state.tabs.find((t) => t.id === tabId);
  const section = sectionForTab(tabId) || state.section || 'home';
  let title = (tab && tab.title) || VIEW_TITLES[tabId] || '';
  if (!title && tabId.startsWith('product:')) title = 'Товар';
  if (!title && tabId.startsWith('deal:')) title = 'Заказ покупателя';
  return {
    path: location.pathname || '/',
    title: String(title || SECTION_LABELS[section] || section).slice(0, 120),
    section: String(section || ''),
  };
}

async function sendPresenceHeartbeat() {
  try {
    await api('/presence/heartbeat', {
      method: 'POST',
      body: JSON.stringify(presenceSnapshot()),
    });
  } catch {
    /* ignore */
  }
}

function formatPresenceAgo(sec) {
  const n = Number(sec) || 0;
  if (n < 15) return 'сейчас';
  if (n < 60) return n + ' с назад';
  return Math.floor(n / 60) + ' мин назад';
}

function presenceSectionRu(section) {
  return SECTION_LABELS[section] || section || '—';
}

function presenceClientLine(u) {
  const osBrowser = [u.os, u.browser].filter((x) => x && x !== '—').join(' · ');
  const bits = [u.client_ip, osBrowser || '', u.region, u.device && u.device !== 'ПК' ? u.device : '']
    .map((x) => String(x || '').trim())
    .filter(Boolean);
  return bits.join(' · ') || '';
}

function fillPresencePanel(panel, items, onlineSec) {
  if (!panel) return;
  panel.innerHTML = items.length
    ? `<div class="presence-panel-head">Сейчас в системе (${items.length})</div>
      <ul class="presence-list">
        ${items
          .map((u) => {
            const meta = presenceClientLine(u);
            return `<li>
              <b>${esc(u.actor_name || '—')}</b>
              <span class="muted">${esc(presenceSectionRu(u.section))}${u.title ? ' · ' + esc(u.title) : ''}</span>
              ${meta ? `<span class="muted presence-meta">${esc(meta)}</span>` : ''}
              <span class="mono presence-ago">${esc(formatPresenceAgo(u.seconds_ago))}</span>
            </li>`;
          })
          .join('')}
      </ul>
      <button type="button" class="presence-open-full" id="presence-open-full">Открыть список</button>`
    : `<div class="presence-panel-head">Никого онлайн</div>
      <p class="muted" style="margin:0;font-size:11px">Активность за последние ${esc(String(onlineSec || 120))} сек</p>`;
  const openFull = document.getElementById('presence-open-full');
  if (openFull) openFull.onclick = () => openTab('presence');
}

function showPresencePanel() {
  const panel = document.getElementById('presence-panel');
  if (!panel || !isAdminMe()) return;
  clearTimeout(state._presenceHideTimer);
  fillPresencePanel(panel, state._presenceLastItems || [], state._presenceOnlineSec);
  panel.hidden = false;
  refreshPresenceChip();
}

function hidePresencePanel(delayMs) {
  clearTimeout(state._presenceHideTimer);
  state._presenceHideTimer = setTimeout(() => {
    const panel = document.getElementById('presence-panel');
    if (panel && !state._presencePinned) panel.hidden = true;
  }, delayMs == null ? 180 : delayMs);
}

async function refreshPresenceChip() {
  const btn = document.getElementById('presence-btn');
  const panel = document.getElementById('presence-panel');
  if (!btn || !isAdminMe()) {
    if (btn) btn.hidden = true;
    if (panel) panel.hidden = true;
    return;
  }
  btn.hidden = false;
  try {
    const data = await api('/presence/online');
    const items = data.items || [];
    const countEl = document.getElementById('presence-count');
    if (countEl) countEl.textContent = String(items.length);
    // Короткий native title; детали IP/OS — в панели по hover/клику
    btn.title = items.length ? `${items.length} онлайн — наведите для IP/OS` : 'Никого онлайн';
    btn.setAttribute('aria-label', btn.title);
    if (panel && !panel.hidden) {
      fillPresencePanel(panel, items, data.online_sec);
    }
    state._presenceLastItems = items;
    state._presenceOnlineSec = data.online_sec;
  } catch {
    /* ignore */
  }
}

function startPresenceTracking() {
  sendPresenceHeartbeat().then(() => refreshPresenceChip());
  if (state._presenceTimer) clearInterval(state._presenceTimer);
  state._presenceTimer = setInterval(() => {
    sendPresenceHeartbeat().then(() => refreshPresenceChip());
  }, 40000);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      sendPresenceHeartbeat().then(() => refreshPresenceChip());
    }
  });
}

/** Открыть чат с привязкой сущности (товар / сделка / …). */
function openEntityInChat(ref) {
  if (!ref || !ref.type || !ref.id) return;
  const payload = {
    type: String(ref.type),
    id: String(ref.id),
    label: String(ref.label || ''),
    href: String(ref.href || ''),
  };
  try {
    sessionStorage.setItem('uchet1-chat-pending-ref', JSON.stringify(payload));
  } catch (_) {
    /* ignore */
  }
  try {
    window.dispatchEvent(
      new CustomEvent('uchet1-chat-open', {
        detail: { open: true, ref: payload },
      })
    );
  } catch (_) {
    /* ignore */
  }
  const root = document.getElementById('chat-fab-root');
  if (!root || root.hidden) {
    window.location.href = '/chats';
  }
}

function chatEntityTypeLabel(type) {
  switch (String(type || '')) {
    case 'deal':
      return 'Заказ покупателя';
    case 'sales_doc':
      return 'Документ';
    case 'stock_doc':
      return 'Склад';
    case 'warehouse_task':
      return 'Задание';
    case 'product':
      return 'Товар';
    case 'thin_doc':
      return 'Заказ';
    case 'supply_order':
      return 'Поставка';
    default:
      return 'Учёт';
  }
}

function chatPickRecorderMime() {
  if (typeof MediaRecorder === 'undefined') return '';
  const candidates = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/ogg;codecs=opus',
    'audio/mp4',
  ];
  return candidates.find((t) => MediaRecorder.isTypeSupported(t)) || '';
}

function chatVoiceExt(mime) {
  const m = String(mime || '');
  if (m.includes('ogg')) return 'ogg';
  if (m.includes('mp4') || m.includes('m4a') || m.includes('aac')) return 'm4a';
  return 'webm';
}

function chatFileSize(n) {
  const b = Number(n) || 0;
  if (b < 1024) return b + ' Б';
  if (b < 1024 * 1024) return Math.round(b / 1024) + ' КБ';
  return (b / (1024 * 1024)).toFixed(1) + ' МБ';
}

function chatAttachmentsHtml(atts) {
  if (!Array.isArray(atts) || !atts.length) return '';
  return atts
    .map((a) => {
      const url = String(a.url || '/api/chats/attachments/' + encodeURIComponent(a.id));
      const name = String(a.name || 'файл');
      const kind = String(a.kind || '');
      const mime = String(a.mime || '');
      if (kind === 'audio' || mime.startsWith('audio/')) {
        return `<div class="chat-pop-att chat-pop-att-voice"><audio controls preload="metadata" src="${esc(
          url
        )}"></audio></div>`;
      }
      if (kind === 'image' || mime.startsWith('image/')) {
        return `<a class="chat-pop-att chat-pop-att-img" href="${esc(
          url
        )}" target="_blank" rel="noopener" title="${esc(name)}"><img src="${esc(
          url
        )}" alt="${esc(name)}" loading="lazy" /></a>`;
      }
      return `<a class="chat-pop-att chat-pop-att-file" href="${esc(
        url
      )}" target="_blank" rel="noopener"><span class="chat-pop-att-ico">${
        kind === 'document' ? 'PDF' : '▤'
      }</span><span><strong>${esc(name)}</strong><small>${esc(
        chatFileSize(a.size)
      )}</small></span></a>`;
    })
    .join('');
}

const CHAT_POP_ICO = {
  plus: '<svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true"><path d="M10 4v12M4 10h12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
  photo:
    '<svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true"><rect x="2.5" y="4.5" width="15" height="11" rx="2.2" fill="none" stroke="currentColor" stroke-width="1.6"/><circle cx="10" cy="10" r="2.6" fill="none" stroke="currentColor" stroke-width="1.6"/><circle cx="14.2" cy="7.2" r="0.9" fill="currentColor"/></svg>',
  file: '<svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true"><path d="M7 10.5V7.2A3.2 3.2 0 0110.2 4 3.2 3.2 0 0113.4 7.2v6.1a2.4 2.4 0 01-4.8 0V8" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
  page: '<svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true"><path d="M4.5 4.5h7.2L15.5 8.3v7.2H4.5z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M11.5 4.5V8.3h3.8" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>',
  mic: '<svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true"><path d="M10 2.8a2.4 2.4 0 00-2.4 2.4v4.2a2.4 2.4 0 004.8 0V5.2A2.4 2.4 0 0010 2.8z" fill="currentColor"/><path d="M5.5 9.2a4.5 4.5 0 009 0M10 13.7v3.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
};

function takePendingChatEntityRef() {
  try {
    const raw = sessionStorage.getItem('uchet1-chat-pending-ref');
    if (!raw) return null;
    sessionStorage.removeItem('uchet1-chat-pending-ref');
    const o = JSON.parse(raw);
    if (!o || !o.type || !o.id) return null;
    return {
      type: String(o.type),
      id: String(o.id),
      label: String(o.label || ''),
      href: String(o.href || ''),
    };
  } catch (_) {
    return null;
  }
}

/** Плавающая кнопка чатов + всплывающая панель и бейдж непрочитанных. */
function startChatWidget() {
  const root = document.getElementById('chat-fab-root');
  const fab = document.getElementById('chat-fab');
  const badge = document.getElementById('chat-fab-badge');
  const pop = document.getElementById('chat-pop');
  const body = document.getElementById('chat-pop-body');
  const closeBtn = document.getElementById('chat-pop-close');
  const unreadLabel = document.getElementById('chat-pop-unread');
  const navChat = document.querySelector('a.sec[data-section="chats"]');
  if (!root || !fab || !pop || !body) return;

  const canChat =
    canAccessSectionMe('chats') ||
    (state.me && (state.me.isSystemAdmin || state.me.role === 'admin'));
  if (!canChat) {
    root.hidden = true;
    return;
  }
  root.hidden = false;

  state._chatPopOpen = false;
  state._chatActiveId = '';
  state._chatLastUnread = 0;
  state._chatEntityRef = state._chatEntityRef || null;

  const setEntityRef = (ref) => {
    state._chatEntityRef =
      ref && ref.type && ref.id
        ? {
            type: String(ref.type),
            id: String(ref.id),
            label: String(ref.label || ''),
            href: String(ref.href || ''),
          }
        : null;
  };

  const setBadge = (n) => {
    const count = Math.max(0, Number(n) || 0);
    if (badge) {
      if (count > 0) {
        badge.hidden = false;
        badge.textContent = count > 99 ? '99+' : String(count);
      } else {
        badge.hidden = true;
      }
    }
    fab.classList.toggle('has-unread', count > 0);
    if (navChat) {
      let nb = navChat.querySelector('.sec-badge');
      if (count > 0) {
        if (!nb) {
          nb = document.createElement('span');
          nb.className = 'sec-badge';
          navChat.appendChild(nb);
        }
        nb.textContent = count > 99 ? '99+' : String(count);
      } else if (nb) {
        nb.remove();
      }
    }
    if (unreadLabel) {
      unreadLabel.textContent = count > 0 ? `${count} непрочит.` : '';
    }
    // Браузерное уведомление при росте непрочитанных
    if (count > state._chatLastUnread && state._chatLastUnread >= 0 && document.hidden) {
      try {
        if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
          new Notification('Учёт №1 · Чаты', {
            body: `Новых сообщений: ${count}`,
            tag: 'wms-chats-unread',
          });
        }
      } catch (_) {
        /* ignore */
      }
    }
    state._chatLastUnread = count;
  };

  const formatChatTime = (iso) => {
    if (!iso) return '';
    try {
      const d = new Date(String(iso).includes('T') ? iso : String(iso).replace(' ', 'T') + 'Z');
      if (Number.isNaN(d.getTime())) return String(iso).slice(11, 16);
      return d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
    } catch (_) {
      return '';
    }
  };

  /** Квитанция прочтения для своих сообщений. */
  const formatChatReadReceipt = (m) => {
    if (!m || m.deleted) return '';
    const status = String(m.read_status || '');
    const reads = Array.isArray(m.reads) ? m.reads : [];
    const total = Number(m.readers_total) || 0;
    if (!status && !reads.length && !total) return '';
    if (status === 'unread' || (!reads.length && total > 0)) {
      return `<span class="chat-pop-msg-read is-unread" title="Ещё не прочитано">не прочитано</span>`;
    }
    if (total <= 1 || reads.length === 1) {
      const r = reads[0];
      const who = r ? esc(r.name || '—') : '';
      const when = r ? esc(formatChatTime(r.read_at)) : '';
      const tip = r ? `${r.name || ''} · ${formatChatTime(r.read_at)}` : 'Прочитано';
      return `<span class="chat-pop-msg-read is-read" title="${esc(tip)}">прочитано${
        who ? ` · ${who}` : ''
      }${when ? ` · ${when}` : ''}</span>`;
    }
    const tip = reads
      .map((r) => `${r.name || '—'} · ${formatChatTime(r.read_at)}`)
      .join('\n');
    const short = reads
      .slice(0, 3)
      .map((r) => `${esc(r.name || '—')} ${esc(formatChatTime(r.read_at))}`)
      .join(', ');
    const more = reads.length > 3 ? ` +${reads.length - 3}` : '';
    return `<span class="chat-pop-msg-read is-read" title="${esc(tip)}">прочитано ${reads.length}/${total}: ${short}${more}</span>`;
  };

  const entityBannerHtml = () => {
    const ref = state._chatEntityRef;
    if (!ref) return '';
    return `<div class="chat-pop-pending" id="chat-pop-pending">
      <div class="chat-pop-entity">
        <div>
          <span class="chat-pop-entity-kind">${esc(chatEntityTypeLabel(ref.type))} · вставится в сообщение</span>
          <span>${esc(ref.label || ref.id)}</span>
        </div>
        <button type="button" class="chat-pop-entity-x" id="chat-pop-pending-x" title="Убрать" aria-label="Убрать">×</button>
      </div>
      <p class="muted" style="margin:6px 8px 0;font-size:11px">Выберите чат — допишите текст и отправьте.</p>
    </div>`;
  };

  const bindPendingClear = () => {
    const btn = document.getElementById('chat-pop-pending-x');
    if (!btn) return;
    btn.onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      setEntityRef(null);
      if (state._chatActiveId) openThread(state._chatActiveId);
      else refresh(true);
    };
  };

  const renderList = (items) => {
    if (!items.length) {
      body.innerHTML =
        entityBannerHtml() +
        '<p class="muted" style="margin:16px">Пока нет чатов. Откройте <a href="/chats">полный экран</a>, чтобы написать коллеге.</p>';
      bindPendingClear();
      return;
    }
    body.innerHTML =
      entityBannerHtml() +
      `<div class="chat-pop-list">${items
        .map((c) => {
          const preview = c.last_message
            ? esc(
                (c.last_message.sender_name ? c.last_message.sender_name + ': ' : '') +
                  (c.last_message.body || (c.last_message.has_attachment ? 'Вложение' : ''))
              )
            : '<span class="muted">Нет сообщений</span>';
          return `<button type="button" class="chat-pop-item ${c.unread ? 'has-unread' : ''}" data-chat-id="${esc(c.id)}">
          <div class="chat-pop-item-top">
            <span class="chat-pop-item-title">${esc(c.title || (c.type === 'group' ? 'Группа' : 'Чат'))}</span>
            <span class="chat-pop-item-time mono">${esc(formatChatTime((c.last_message && c.last_message.created_at) || c.updated_at))}</span>
          </div>
          <div class="chat-pop-item-bottom">
            <span class="chat-pop-item-preview">${preview}</span>
            ${c.unread ? `<span class="chat-pop-item-badge">${esc(c.unread > 99 ? '99+' : c.unread)}</span>` : ''}
          </div>
        </button>`;
        })
        .join('')}</div>`;
    bindPendingClear();
    body.querySelectorAll('[data-chat-id]').forEach((btn) => {
      btn.onclick = () => openThread(btn.dataset.chatId);
    });
  };

  const openWithEntity = async () => {
    state._chatPopOpen = true;
    pop.classList.remove('hidden');
    fab.classList.add('is-open');
    const pending = takePendingChatEntityRef();
    if (pending) setEntityRef(pending);
    try {
      const data = await api('/chats');
      setBadge(data.unread_total || 0);
      const items = data.items || [];
      let preferId = '';
      try {
        preferId = String(localStorage.getItem('uchet1-chat-last-id') || '');
      } catch (_) {
        /* ignore */
      }
      const pick =
        (preferId && items.find((c) => c.id === preferId)) ||
        items[0] ||
        null;
      if (pick) {
        await openThread(pick.id);
      } else {
        state._chatActiveId = '';
        renderList(items);
      }
    } catch (e) {
      body.innerHTML = `<p class="error" style="margin:16px">${esc(e.message || 'Чаты недоступны')}</p>`;
    }
  };

  const openThread = async (chatId) => {
    state._chatActiveId = chatId;
    try {
      localStorage.setItem('uchet1-chat-last-id', String(chatId));
    } catch (_) {
      /* ignore */
    }
    body.innerHTML = '<p class="muted" style="margin:16px">Загрузка…</p>';
    try {
      const [chatsData, msgsData] = await Promise.all([
        api('/chats'),
        api('/chats/' + encodeURIComponent(chatId) + '/messages?limit=40'),
      ]);
      const chat = (chatsData.items || []).find((c) => c.id === chatId);
      const title = (chat && chat.title) || 'Чат';
      const msgs = msgsData.items || [];
      await api('/chats/' + encodeURIComponent(chatId) + '/read', {
        method: 'POST',
        body: '{}',
      }).catch(() => null);
      const pageRef = state._pageChatRef;
      const pageTip = pageRef
        ? `Прикрепить открытое: ${chatEntityTypeLabel(pageRef.type)} · ${pageRef.label || pageRef.id}`
        : 'Нет открытой карточки — сначала откройте документ или заказ покупателя';
      body.innerHTML = `
        <div class="chat-pop-thread">
          <div class="chat-pop-thread-head">
            <button type="button" class="chat-pop-back" id="chat-pop-back">←</button>
            <strong>${esc(title)}</strong>
            <a class="chat-pop-link" href="/chats">Полный</a>
          </div>
          <div class="chat-pop-msgs" id="chat-pop-msgs">
            ${
              msgs
                .map((m) => {
                  const mine = state.me && m.sender_id === state.me.id;
                  const ref = m.ref && m.ref.id ? m.ref : null;
                  const refHtml = ref
                    ? ref.href
                      ? `<a class="chat-pop-msg-entity" href="${esc(ref.href)}">${esc(chatEntityTypeLabel(ref.type))} · ${esc(ref.label || ref.id)}</a>`
                      : `<span class="chat-pop-msg-entity">${esc(chatEntityTypeLabel(ref.type))} · ${esc(ref.label || ref.id)}</span>`
                    : '';
                  const atts = Array.isArray(m.attachments) ? m.attachments : [];
                  const attHtml = chatAttachmentsHtml(atts);
                  const showBody = String(m.body || '').trim();
                  return `<div class="chat-pop-msg ${mine ? 'mine' : ''}">
                    ${mine ? '' : `<div class="chat-pop-msg-who">${esc(m.sender_name || '')}</div>`}
                    ${refHtml}
                    ${attHtml}
                    ${showBody ? `<div class="chat-pop-msg-body">${esc(showBody)}</div>` : ''}
                    <div class="chat-pop-msg-time mono">${esc(formatChatTime(m.created_at))}${
                      mine ? ' · ' + formatChatReadReceipt(m) : ''
                    }</div>
                  </div>`;
                })
                .join('') || '<p class="muted" style="margin:8px">Напишите первое сообщение</p>'
            }
          </div>
          <form class="chat-pop-compose" id="chat-pop-form">
            ${
              state._chatEntityRef
                ? `<div class="chat-pop-entity" id="chat-pop-entity">
              <div>
                <span class="chat-pop-entity-kind">${esc(chatEntityTypeLabel(state._chatEntityRef.type))} · ссылка</span>
                <span>${esc(state._chatEntityRef.label || state._chatEntityRef.id)}</span>
              </div>
              <button type="button" class="chat-pop-entity-x" id="chat-pop-entity-x" title="Убрать" aria-label="Убрать">×</button>
            </div>`
                : ''
            }
            <div class="chat-pop-rec hidden" id="chat-pop-rec">
              <span class="chat-pop-rec-dot" aria-hidden="true"></span>
              <span class="mono" id="chat-pop-rec-time">0:00</span>
              <button type="button" id="chat-pop-rec-cancel">Отмена</button>
              <button type="button" class="primary" id="chat-pop-rec-send">Отправить</button>
            </div>
            <div class="chat-pop-compose-row" id="chat-pop-compose-row">
              <input type="file" id="chat-pop-photo" accept="image/*,image/jpeg,image/png,image/webp,image/gif" multiple hidden />
              <input type="file" id="chat-pop-file" accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.zip,.rar,.7z,application/pdf,image/*" multiple hidden />
              <div class="chat-pop-attach" id="chat-pop-attach">
                <button type="button" class="chat-pop-ico" id="chat-pop-plus-btn" title="Вложение" aria-label="Вложение" aria-expanded="false" aria-haspopup="menu">${CHAT_POP_ICO.plus}</button>
                <div class="chat-pop-attach-menu hidden" id="chat-pop-attach-menu" role="menu">
                  <button type="button" role="menuitem" id="chat-pop-photo-btn">${CHAT_POP_ICO.photo}<span>Фото</span></button>
                  <button type="button" role="menuitem" id="chat-pop-file-btn">${CHAT_POP_ICO.file}<span>Файл</span></button>
                  <button type="button" role="menuitem" id="chat-pop-page-btn" ${pageRef ? '' : 'disabled'} title="${esc(pageTip)}">${CHAT_POP_ICO.page}<span>Карточка</span></button>
                </div>
              </div>
              <input id="chat-pop-input" placeholder="${
                state._chatEntityRef ? 'Сообщение…' : 'Сообщение…'
              }" autocomplete="off" />
              <button type="button" class="chat-pop-ico" id="chat-pop-mic-btn" title="Голосовое" aria-label="Голосовое">${CHAT_POP_ICO.mic}</button>
              <button type="submit" class="primary" aria-label="Отправить">➤</button>
            </div>
          </form>
        </div>`;
      const msgsEl = document.getElementById('chat-pop-msgs');
      if (msgsEl) msgsEl.scrollTop = msgsEl.scrollHeight;
      document.getElementById('chat-pop-back').onclick = () => {
        stopChatVoice(true);
        state._chatActiveId = '';
        refresh(true);
      };
      const clearEntityBtn = document.getElementById('chat-pop-entity-x');
      if (clearEntityBtn) {
        clearEntityBtn.onclick = () => {
          setEntityRef(null);
          openThread(chatId);
        };
      }
      const form = document.getElementById('chat-pop-form');
      const input = document.getElementById('chat-pop-input');
      const photoInp = document.getElementById('chat-pop-photo');
      const fileInp = document.getElementById('chat-pop-file');
      const plusBtn = document.getElementById('chat-pop-plus-btn');
      const attachMenu = document.getElementById('chat-pop-attach-menu');
      const photoBtn = document.getElementById('chat-pop-photo-btn');
      const fileBtn = document.getElementById('chat-pop-file-btn');
      const pageBtn = document.getElementById('chat-pop-page-btn');
      const micBtn = document.getElementById('chat-pop-mic-btn');
      const recBox = document.getElementById('chat-pop-rec');
      const composeRow = document.getElementById('chat-pop-compose-row');
      const closeAttachMenu = () => {
        if (attachMenu) attachMenu.classList.add('hidden');
        if (plusBtn) plusBtn.setAttribute('aria-expanded', 'false');
        document.removeEventListener('click', closeAttachMenu);
      };
      if (plusBtn && attachMenu) {
        plusBtn.onclick = (e) => {
          e.preventDefault();
          e.stopPropagation();
          const willOpen = attachMenu.classList.contains('hidden');
          if (willOpen) {
            attachMenu.classList.remove('hidden');
            plusBtn.setAttribute('aria-expanded', 'true');
            setTimeout(() => document.addEventListener('click', closeAttachMenu), 0);
          } else {
            closeAttachMenu();
          }
        };
        attachMenu.onclick = (e) => e.stopPropagation();
      }

      const stopChatVoice = (cancel) => {
        const v = state._chatVoice;
        if (!v) return;
        v.cancel = !!cancel;
        if (v.timer) {
          clearInterval(v.timer);
          v.timer = null;
        }
        try {
          if (v.rec && v.rec.state !== 'inactive') v.rec.stop();
        } catch (_) {
          /* ignore */
        }
        try {
          (v.stream || { getTracks: () => [] }).getTracks().forEach((t) => t.stop());
        } catch (_) {
          /* ignore */
        }
        if (recBox) recBox.classList.add('hidden');
        if (composeRow) composeRow.classList.remove('hidden');
        state._chatVoice = null;
      };

      const uploadChatFiles = async (fileList) => {
        const files = Array.from(fileList || []).filter((f) => f && f.size > 0);
        if (!files.length) return;
        const caption = String(input?.value || '').trim();
        const ref = state._chatEntityRef;
        if (input) input.disabled = true;
        try {
          for (let i = 0; i < files.length; i++) {
            const fd = new FormData();
            fd.append('file', files[i]);
            if (i === 0 && caption) fd.append('body', caption);
            if (i === 0 && ref) fd.append('ref', JSON.stringify(ref));
            await api('/chats/' + encodeURIComponent(chatId) + '/attachments', {
              method: 'POST',
              body: fd,
            });
          }
          if (input) input.value = '';
          setEntityRef(null);
          openThread(chatId);
          pollUnread();
        } catch (err) {
          alert(err.message || 'Загрузка не удалась');
        } finally {
          if (input) {
            input.disabled = false;
            input.focus();
          }
        }
      };

      if (photoBtn && photoInp) {
        photoBtn.onclick = () => {
          closeAttachMenu();
          photoInp.click();
        };
        photoInp.onchange = () => {
          uploadChatFiles(photoInp.files);
          photoInp.value = '';
        };
      }
      if (fileBtn && fileInp) {
        fileBtn.onclick = () => {
          closeAttachMenu();
          fileInp.click();
        };
        fileInp.onchange = () => {
          uploadChatFiles(fileInp.files);
          fileInp.value = '';
        };
      }
      if (pageBtn) {
        pageBtn.onclick = () => {
          closeAttachMenu();
          const ref = state._pageChatRef;
          if (!ref || !ref.type || !ref.id) {
            alert('Откройте карточку (заказ, расходную, товар…) — затем нажмите снова');
            return;
          }
          setEntityRef(ref);
          openThread(chatId);
        };
      }
      if (micBtn) {
        micBtn.onclick = async () => {
          if (state._chatVoice) return;
          if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
            alert('Запись голоса не поддерживается в этом браузере');
            return;
          }
          try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            const mime = chatPickRecorderMime();
            const rec = mime
              ? new MediaRecorder(stream, { mimeType: mime })
              : new MediaRecorder(stream);
            const chunks = [];
            const voice = {
              rec,
              stream,
              chunks,
              mime: mime || '',
              cancel: false,
              secs: 0,
              timer: null,
            };
            rec.ondataavailable = (e) => {
              if (e.data && e.data.size) chunks.push(e.data);
            };
            rec.onstop = async () => {
              const cancelled = voice.cancel;
              const parts = voice.chunks.slice();
              const type = voice.mime || (parts[0] && parts[0].type) || 'audio/webm';
              try {
                stream.getTracks().forEach((t) => t.stop());
              } catch (_) {
                /* ignore */
              }
              if (voice.timer) clearInterval(voice.timer);
              state._chatVoice = null;
              if (recBox) recBox.classList.add('hidden');
              if (composeRow) composeRow.classList.remove('hidden');
              if (cancelled || !parts.length) return;
              const blob = new Blob(parts, { type });
              const file = new File([blob], `voice-${Date.now()}.${chatVoiceExt(type)}`, {
                type,
              });
              await uploadChatFiles([file]);
            };
            state._chatVoice = voice;
            rec.start(250);
            if (composeRow) composeRow.classList.add('hidden');
            if (recBox) {
              recBox.classList.remove('hidden');
              const timeEl = document.getElementById('chat-pop-rec-time');
              if (timeEl) timeEl.textContent = '0:00';
            }
            voice.timer = setInterval(() => {
              voice.secs += 1;
              const t = document.getElementById('chat-pop-rec-time');
              if (t) {
                const m = Math.floor(voice.secs / 60);
                const s = voice.secs % 60;
                t.textContent = m + ':' + String(s).padStart(2, '0');
              }
              if (voice.secs >= 120) {
                voice.cancel = false;
                try {
                  rec.stop();
                } catch (_) {
                  /* ignore */
                }
              }
            }, 1000);
          } catch (_) {
            alert('Нет доступа к микрофону — разрешите в браузере');
          }
        };
      }
      document.getElementById('chat-pop-rec-cancel')?.addEventListener('click', () => {
        const v = state._chatVoice;
        if (!v) return;
        v.cancel = true;
        try {
          if (v.rec && v.rec.state !== 'inactive') v.rec.stop();
        } catch (_) {
          stopChatVoice(true);
        }
      });
      document.getElementById('chat-pop-rec-send')?.addEventListener('click', () => {
        const v = state._chatVoice;
        if (!v) return;
        v.cancel = false;
        try {
          if (v.rec && v.rec.state !== 'inactive') v.rec.stop();
        } catch (_) {
          stopChatVoice(false);
        }
      });

      form.onsubmit = async (e) => {
        e.preventDefault();
        const text = (input.value || '').trim();
        const ref = state._chatEntityRef;
        if (!text && !ref) return;
        input.disabled = true;
        try {
          await api('/chats/' + encodeURIComponent(chatId) + '/messages', {
            method: 'POST',
            body: JSON.stringify({ body: text, ref: ref || undefined }),
          });
          input.value = '';
          setEntityRef(null);
          openThread(chatId);
          pollUnread();
        } catch (err) {
          alert(err.message || 'Не отправлено');
        } finally {
          input.disabled = false;
          input.focus();
        }
      };
      input?.addEventListener('paste', (e) => {
        const items = e.clipboardData && e.clipboardData.items;
        if (!items) return;
        const files = [];
        for (const item of items) {
          if (item.kind === 'file') {
            const f = item.getAsFile();
            if (f) files.push(f);
          }
        }
        if (files.length) {
          e.preventDefault();
          uploadChatFiles(files);
        }
      });
      form.addEventListener('dragover', (e) => {
        e.preventDefault();
      });
      form.addEventListener('drop', (e) => {
        e.preventDefault();
        if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length) {
          uploadChatFiles(e.dataTransfer.files);
        }
      });
      input.focus();
      pollUnread();
    } catch (e) {
      body.innerHTML = `<p class="error" style="margin:16px">${esc(e.message)}</p>`;
    }
  };

  const refresh = async (forceList) => {
    try {
      const data = await api('/chats');
      setBadge(data.unread_total || 0);
      if (forceList || (state._chatPopOpen && !state._chatActiveId)) {
        renderList(data.items || []);
      }
    } catch (_) {
      /* нет прав / сеть */
    }
  };

  const pollUnread = async () => {
    try {
      const data = await api('/chats/unread');
      setBadge(data.unread_total || 0);
    } catch (_) {
      /* ignore */
    }
  };

  const openPop = () => {
    state._chatPopOpen = true;
    pop.classList.remove('hidden');
    fab.classList.add('is-open');
    const pending = takePendingChatEntityRef();
    if (pending) {
      setEntityRef(pending);
      openWithEntity();
      return;
    }
    state._chatActiveId = '';
    refresh(true);
    if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
      Notification.requestPermission().catch(() => null);
    }
  };
  const closePop = () => {
    state._chatPopOpen = false;
    state._chatActiveId = '';
    pop.classList.add('hidden');
    fab.classList.remove('is-open');
  };

  fab.onclick = (e) => {
    e.stopPropagation();
    if (state._chatPopOpen) closePop();
    else openPop();
  };
  if (closeBtn) closeBtn.onclick = (e) => {
    e.stopPropagation();
    closePop();
  };
  // pointerdown + capture: не закрывать при выборе чата (click приходит уже после
  // замены DOM, и detached target даёт false в contains → ложное закрытие).
  if (!state._chatOutsideCloseBound) {
    state._chatOutsideCloseBound = true;
    document.addEventListener(
      'pointerdown',
      (e) => {
        if (!state._chatPopOpen) return;
        const rootEl = document.getElementById('chat-fab-root');
        if (!rootEl) return;
        const path = typeof e.composedPath === 'function' ? e.composedPath() : [];
        if (path.includes(rootEl)) return;
        if (e.target && rootEl.contains(/** @type {Node} */ (e.target))) return;
        closePop();
      },
      true
    );
  }
  if (navChat) {
    navChat.addEventListener('click', (e) => {
      // Быстрый клик по меню — открыть попап, Ctrl/Cmd — полный экран
      if (e.metaKey || e.ctrlKey || e.shiftKey) return;
      e.preventDefault();
      if (state._chatPopOpen) closePop();
      else openPop();
    });
  }

  refresh(false);
  if (state._chatPollTimer) clearInterval(state._chatPollTimer);
  state._chatPollTimer = setInterval(() => {
    if (document.visibilityState === 'hidden' && !state._chatPopOpen) {
      pollUnread();
      return;
    }
    if (state._chatPopOpen && state._chatActiveId) {
      // в треде — мягко обновим бейдж
      pollUnread();
      return;
    }
    refresh(state._chatPopOpen && !state._chatActiveId);
  }, 8000);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') pollUnread();
  });
  if (!state._chatOpenEventBound) {
    state._chatOpenEventBound = true;
    window.addEventListener('uchet1-chat-open', (ev) => {
      const detail = (ev && ev.detail) || {};
      if (detail.ref && detail.ref.type && detail.ref.id) {
        setEntityRef(detail.ref);
      }
      if (detail.open === false) return;
      if (state._chatEntityRef) openWithEntity();
      else openPop();
    });
  }
}

/** Человекочитаемые подписи audit action / entity (код остаётся в title). */
const AUDIT_ACTION_LABELS = {
  'auth.login': 'Вход в систему',
  'auth.login_failed': 'Неудачный вход',
  'auth.logout': 'Выход',
  'auth.register': 'Регистрация пароля',
  'auth.password_change': 'Смена пароля',
  'auth.password_set': 'Пароль задан админом',
  'crm.deal_ingest': 'Из Amo → Учёт №1',
  'crm.deals_sync': 'Синхронизация сделок',
  'crm.deal_item_add': 'Позиция: добавление',
  'crm.deal_item_update': 'Позиция: изменение',
  'crm.deal_item_delete': 'Позиция: удаление',
  'crm.deal_stage': 'Смена этапа заказа',
  'crm.deal_stage_auto': 'Автосмена этапа',
  'crm.counterparties_sync': 'Синхронизация компаний/контактов Amo',
  'deal.sbp_qr': 'QR СБП по заказу',
  'deal.payment_delete': 'Удаление оплаты / QR',
  'deal.accept_cash': 'Приём наличных',
  'deal.mark_paid': 'Сделка оплачена',
  'deal.payment_paid': 'Оплата помечена paid',
  'deal.warehouse_task': 'Задание складу из заказа',
  'fiscal.receipt': 'Фискальный чек',
  'org.profile_save': 'Сохранение реквизитов',
  'doc.numbering_sync': 'Нумерация из 1С',
  'doc.numbering_set': 'Нумерация (ручная)',
  'doc.create': 'Складской документ',
  'sales_doc.create': 'Документ продажи',
  'sync.docs': 'Синхронизация документов 1С',
  'sync.odata': 'Синхронизация каталогов',
  'sync.hs': 'Синхронизация HS',
  'sync.prices': 'Синхронизация цен',
  'sync.rests': 'Синхронизация остатков',
  'staff.sync': 'Синхронизация персонала',
  'staff.update': 'Изменение сотрудника',
  'price_type.create': 'Тип цены: создание',
  'price_type.rename': 'Тип цены: переименование',
  'price_type.delete': 'Тип цены: удаление',
  'price.change': 'Изменение цены',
  'media.sync': 'Синхронизация фото',
  'counterparty.create': 'Контрагент: создание',
  'counterparty.update': 'Контрагент: изменение',
  'product.create': 'Товар: создание',
  'product.update': 'Товар: изменение',
  'product.properties.update': 'Характеристики товара',
  'product.applicability.update': 'Применимость товара',
  'feedback.create': 'Идея / ошибка: создание',
  'feedback.status': 'Идея / ошибка: статус',
  'lot.create': 'Создание партии',
  'marking.scan.receive': 'Скан маркировки: приёмка',
  'marking.scan.sale': 'Скан маркировки: продажа',
  'marking.scan.withdraw': 'Скан маркировки: вывод',
  'marking.scan.return': 'Скан маркировки: возврат',
  'marking.scan.defect': 'Скан маркировки: брак',
  'warehouse_task.create': 'Задание складу: создание',
  'warehouse_task.status': 'Задание складу: статус',
  'warehouse.create': 'Склад: создание',
  'warehouse.update': 'Склад: изменение',
  'warehouse.archive': 'Склад: в архив',
  'warehouse.restore': 'Склад: возврат',
  'warehouse.delete': 'Склад: удаление',
  'photo_shift.start': 'Смена фотографа: старт',
  'photo_shift.end': 'Смена фотографа: конец',
  'pick_shift.start': 'Смена сборщика: старт',
  'pick_shift.end': 'Смена сборщика: конец',
  'pick_shift.settings': 'Настройки смен сборщика',
  'sto_lift_shift.start': 'Смена СТО: старт',
  'sto_lift_shift.end': 'Смена СТО: конец',
  'sto_lift.assign': 'СТО: на подъёмник',
  'sto_work_log.create': 'СТО: работа слесаря',
  'sto_work_log.update': 'СТО: правка работы',
  'sto_appointment.create': 'СТО: запись',
};

const AUDIT_ENTITY_LABELS = {
  session: 'сессия',
  staff: 'сотрудник',
  crm_deal: 'заказ покупателя',
  deal_payment: 'оплата',
  org_profile: 'организация',
  doc_numbering: 'нумерация',
  sales_doc: 'документ продажи',
  stock_doc: 'складской документ',
  sync: 'синхронизация',
  price: 'цена',
  stock: 'остатки',
  price_type: 'тип цены',
  media: 'медиа',
  product: 'товар',
  counterparty: 'контрагент',
  feedback: 'идея / ошибка',
  product_lot: 'партия',
  datamatrix: 'Data Matrix',
  warehouse_task: 'задание склада',
  warehouse: 'склад',
  photo_shift: 'смена фотографа',
  pick_shift: 'смена сборщика',
  sto_lift_shift: 'смена СТО',
  sto_work_order: 'заказ-наряд СТО',
  sto_work_log: 'работа слесаря',
  sto_appointment: 'запись СТО',
};

const AUDIT_ACTOR_ID_LABELS = {
  __admin__: 'Админ (системный)',
};

function auditActionLabel(action) {
  if (!action) return '—';
  if (AUDIT_ACTION_LABELS[action]) return AUDIT_ACTION_LABELS[action];
  const m = /^marking\.scan\.(.+)$/.exec(action);
  if (m) {
    const sub =
      ({ receive: 'приёмка', sale: 'продажа', withdraw: 'вывод', return: 'возврат', defect: 'брак' })[
        m[1]
      ] || m[1];
    return `Скан маркировки: ${sub}`;
  }
  return action;
}

function auditActionBadgeHtml(action) {
  const code = String(action || '');
  const label = auditActionLabel(code);
  const titleAttr = code && label !== code ? ` title="${esc(code)}"` : '';
  return `<span class="badge source"${titleAttr}>${esc(label)}</span>`;
}

function auditEntityIdLabel(entityId) {
  if (!entityId) return '';
  if (AUDIT_ACTOR_ID_LABELS[entityId]) return AUDIT_ACTOR_ID_LABELS[entityId];
  // Не светим сырые GUID/UUID в UI — только в title
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(entityId)) {
    return '';
  }
  return entityId;
}

function auditEntityRefHtml(entity, entityId) {
  if (!entity) return '';
  const entLabel = AUDIT_ENTITY_LABELS[entity] || entity;
  const idLabel = auditEntityIdLabel(entityId);
  const display = idLabel ? `${entLabel}: ${idLabel}` : entLabel;
  const tech = entityId ? `${entity}: ${entityId}` : entity;
  const titleAttr = tech ? ` title="${esc(tech)}"` : '';
  return `<div class="muted" style="font-size:11px"${titleAttr}>${esc(display)}</div>`;
}

function entityHistoryHtml(items, opts = {}) {
  const showActor = opts.showActor !== false;
  const showIp = opts.showIp !== false;
  // На карточке сущности объект и так известен — колонку не дублируем
  const showEntity = opts.showEntity === true;
  if (!items.length) {
    return '<p class="muted" style="margin:0">Пока нет записей — появятся после изменений.</p>';
  }
  return `<table class="entity-history-table">
    <thead><tr>
      <th style="width:130px">Когда</th>
      ${showActor ? '<th style="width:140px">Кто</th>' : ''}
      ${showIp ? '<th style="width:110px">IP</th>' : ''}
      <th>Что сделали</th>
      ${showEntity ? '<th style="width:160px">Объект</th>' : ''}
    </tr></thead>
    <tbody>
      ${items
        .map((it) => {
          const when = esc(String(it.created_at || '').replace('T', ' ').slice(0, 19));
          const who = esc(
            [it.actor_name, it.actor_login ? '(' + it.actor_login + ')' : '']
              .filter(Boolean)
              .join(' ') || '—'
          );
          const ip = esc(it.ip || '—');
          const what = `
            <div>${esc(it.summary || auditActionLabel(it.action) || '')}</div>
            ${it.action ? `<div class="muted" style="font-size:11px" title="${esc(it.action)}">${esc(auditActionLabel(it.action))}</div>` : ''}
          `;
          const obj = it.entity
            ? auditEntityRefHtml(it.entity, it.entity_id)
            : '<span class="muted">—</span>';
          return `<tr>
            <td class="mono">${when}</td>
            ${showActor ? `<td>${who}</td>` : ''}
            ${showIp ? `<td class="mono" style="font-size:11px">${ip}</td>` : ''}
            <td>${what}</td>
            ${showEntity ? `<td>${obj}</td>` : ''}
          </tr>`;
        })
        .join('')}
    </tbody>
  </table>`;
}

async function fillEntityHistory(mountId, entity, entityId, opts = {}) {
  const el = document.getElementById(mountId);
  if (!el || !entityId) return;
  try {
    const data = await api(
      `/audit?entity=${encodeURIComponent(entity)}&entity_id=${encodeURIComponent(entityId)}&limit=40&page=1`
    );
    el.innerHTML = entityHistoryHtml(data.items || [], opts);
  } catch (e) {
    el.innerHTML = `<p class="error" style="margin:0">${esc(e.message)}</p>`;
  }
}

/**
 * История по всей цепочке заказа (сделка + документы продаж + расходные).
 * seed: опционально «создал / создана» из карточки, если ещё нет в audit.
 */
async function fillDealChainHistory(mountId, dealId, opts = {}) {
  const el = document.getElementById(mountId);
  const id = String(dealId || '').trim();
  if (!el || !id) return;
  try {
    const data = await api(
      '/audit?deal_id=' + encodeURIComponent(id) + '&limit=80&page=1'
    );
    let items = Array.isArray(data.items) ? data.items.slice() : [];
    const seed = opts.seed;
    if (seed && seed.created_at) {
      const hasCreate = items.some(
        (it) =>
          String(it.entity || '') === 'crm_deal' &&
          /созда|sync|amo/i.test(String(it.action || '') + ' ' + String(it.summary || ''))
      );
      if (!hasCreate) {
        items.push({
          created_at: seed.created_at,
          actor_name: seed.actor_name || '',
          actor_login: '',
          action: 'crm_deal.create',
          summary: seed.summary || 'Заказ создан / получен из Amo',
          entity: 'crm_deal',
          entity_id: id,
          ip: '',
        });
        items.sort((a, b) =>
          String(b.created_at || '').localeCompare(String(a.created_at || ''))
        );
      }
    }
    el.innerHTML = entityHistoryHtml(items, {
      showEntity: true,
      showIp: opts.showIp !== false,
      ...opts,
    });
  } catch (e) {
    el.innerHTML = `<p class="error" style="margin:0">${esc(e.message)}</p>`;
  }
}

/** История действий сотрудника (для карточки персонала). */
async function fillStaffHistory(mountId, staffId) {
  const el = document.getElementById(mountId);
  if (!el || !staffId) return;
  try {
    const data = await api(
      `/audit?actor_id=${encodeURIComponent(staffId)}&limit=50&page=1`
    );
    el.innerHTML = entityHistoryHtml(data.items || [], { showActor: false });
  } catch (e) {
    el.innerHTML = `<p class="error" style="margin:0">${esc(e.message)}</p>`;
  }
}

function openStaffHistory(staffId, staffName) {
  state.auditActorId = staffId || '';
  state.auditActorName = staffName || '';
  state.auditPage = 1;
  state.auditQ = '';
  openTab('audit');
}

function productTitle(p) {
  const name = String(p?.name || '').trim();
  const sku = String(p?.sku || '').trim();
  if (name && !looksLikeGuid(name)) return name;
  if (sku) return sku;
  return name || p?.id || '—';
}

/** Pill-радио как в тулбаре (form-pagetabs). options: [{value,label}] */
function radioPillsHtml(name, options, selected) {
  const cur = String(selected || (options[0] && options[0].value) || '');
  return `<div class="form-pagetabs radio-pills" role="radiogroup" aria-label="${esc(name)}" data-radio="${esc(name)}">
    ${options
      .map(
        (o) =>
          `<button type="button" class="form-pagetab ${String(o.value) === cur ? 'active' : ''}" role="radio" aria-checked="${String(o.value) === cur ? 'true' : 'false'}" data-value="${esc(o.value)}">${esc(o.label)}</button>`
      )
      .join('')}
    <input type="hidden" id="${esc(name)}" name="${esc(name)}" value="${esc(cur)}" />
  </div>`;
}

function bindRadioPills(root, onChange) {
  const scope = root || document;
  scope.querySelectorAll('.radio-pills[data-radio]').forEach((group) => {
    if (group.dataset.bound === '1') return;
    group.dataset.bound = '1';
    const hidden = group.querySelector('input[type="hidden"]');
    group.querySelectorAll('.form-pagetab').forEach((btn) => {
      btn.addEventListener('click', () => {
        const val = btn.dataset.value || '';
        group.querySelectorAll('.form-pagetab').forEach((b) => {
          const on = b === btn;
          b.classList.toggle('active', on);
          b.setAttribute('aria-checked', on ? 'true' : 'false');
        });
        if (hidden) hidden.value = val;
        if (typeof onChange === 'function') onChange(group.dataset.radio, val, group);
      });
    });
  });
}

function radioPillsValue(name, root) {
  const scope = root || document;
  const group = scope.querySelector(`.radio-pills[data-radio="${name}"]`);
  if (!group) return '';
  const hidden = group.querySelector('input[type="hidden"]');
  if (hidden) return String(hidden.value || '');
  const active = group.querySelector('.form-pagetab.active');
  return active ? String(active.dataset.value || '') : '';
}

function setRadioPillsValue(name, val, root) {
  const scope = root || document;
  const group = scope.querySelector(`.radio-pills[data-radio="${name}"]`);
  if (!group) return;
  const hidden = group.querySelector('input[type="hidden"]');
  if (hidden) hidden.value = String(val || '');
  group.querySelectorAll('.form-pagetab').forEach((b) => {
    const on = String(b.dataset.value) === String(val);
    b.classList.toggle('active', on);
    b.setAttribute('aria-checked', on ? 'true' : 'false');
  });
}

/**
 * Mount real <button class="row-action"> into td.col-actions via DOM
 * (not innerHTML) so names with quotes/`>` never produce bare «Переименовать» text.
 */
function mountRowActionButtons(root, items, opts = {}) {
  const label = opts.label || 'Переименовать';
  const nameOf = opts.nameOf || ((item) => String(item?.name || ''));
  const rows = [...(root.querySelectorAll(opts.rowSelector || 'tbody tr') || [])].filter(
    (tr) => !tr.querySelector('td.muted')
  );
  items.forEach((item, i) => {
    const tr = rows[i];
    if (!tr || !item?.id) return;
    let td = tr.querySelector('td.col-actions');
    if (!td) {
      td = document.createElement('td');
      td.className = 'col-actions';
      tr.appendChild(td);
    }
    const keep = opts.keepSelectors
      ? [...td.querySelectorAll(opts.keepSelectors)].map((el) => el.cloneNode(true))
      : [];
    td.replaceChildren();
    td.classList.add('col-actions');
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'row-action';
    btn.dataset.rename = String(item.id);
    btn.dataset.name = nameOf(item);
    btn.textContent = label;
    td.appendChild(btn);
    keep.forEach((el) => td.appendChild(el));
    if (typeof opts.after === 'function') opts.after(td, item);
  });
}

const CONTOUR_LS_KEY = 'wms.contour-company.v1';

function getFilterCompanyId() {
  return String(state.filterCompanyId || '').trim();
}

/** Добавить company_id в query (URLSearchParams или путь со ?). */
function withCompanyId(pathOrQs) {
  const id = getFilterCompanyId();
  if (!id) return pathOrQs;
  if (pathOrQs instanceof URLSearchParams) {
    pathOrQs.set('company_id', id);
    return pathOrQs;
  }
  const path = String(pathOrQs || '');
  const sep = path.includes('?') ? '&' : '?';
  return path + sep + 'company_id=' + encodeURIComponent(id);
}

function loadContourFromStorage() {
  try {
    const v = String(localStorage.getItem(CONTOUR_LS_KEY) || '').trim();
    state.filterCompanyId = v;
  } catch {
    state.filterCompanyId = '';
  }
}

async function refreshRefs() {
  const whPath = withCompanyId('/warehouses');
  const orgPath = withCompanyId('/organizations');
  const [warehouses, units, categories, organizations] = await Promise.all([
    api(whPath),
    api('/units'),
    api('/categories'),
    api(orgPath).catch(() => []),
  ]);
  state.warehouses = warehouses;
  state.units = units;
  state.categories = categories;
  state.organizations = Array.isArray(organizations) ? organizations : organizations.items || [];
}

async function initHeaderCompanySwitcher() {
  const sel = document.getElementById('header-company');
  if (!sel || sel.dataset.bound === '1') return;
  sel.dataset.bound = '1';
  loadContourFromStorage();
  try {
    const data = await api('/company/companies');
    let items = (data.items || []).filter((c) => Number(c.is_active) !== 0);
    state.companies = items;
    const me = state.me;
    const meCos =
      me &&
      !me.isSystemAdmin &&
      me.role !== 'admin' &&
      Array.isArray(me.rights?.company_ids) &&
      me.rights.company_ids.length
        ? me.rights.company_ids.map(String)
        : null;
    if (meCos) items = items.filter((c) => meCos.includes(c.id));
    const cur = getFilterCompanyId();
    const allLabel = meCos ? (items.length > 1 ? 'Все доступные' : '') : 'Все организации';
    sel.innerHTML =
      (allLabel ? `<option value="">${esc(allLabel)}</option>` : '') +
      items
        .map(
          (c) =>
            `<option value="${esc(c.id)}" ${c.id === cur ? 'selected' : ''}>${esc(c.name)}</option>`
        )
        .join('');
    if (meCos && items.length === 1) {
      state.filterCompanyId = items[0].id;
      sel.value = items[0].id;
    } else if (cur && !items.some((c) => c.id === cur)) {
      state.filterCompanyId = meCos && items[0] ? items[0].id : '';
      sel.value = state.filterCompanyId;
      try {
        localStorage.setItem(CONTOUR_LS_KEY, state.filterCompanyId);
      } catch {
        /* ignore */
      }
    } else {
      sel.value = cur;
    }
    const picked = items.find((c) => c.id === sel.value);
    state.filterCompanyName = picked
      ? picked.name
      : sel.value
        ? ''
        : allLabel || 'Все организации';
  } catch {
    sel.innerHTML = `<option value="">Все организации</option>`;
  }
  sel.onchange = async () => {
    state.filterCompanyId = sel.value || '';
    const opt = sel.options[sel.selectedIndex];
    state.filterCompanyName = opt ? opt.textContent || '' : '';
    try {
      localStorage.setItem(CONTOUR_LS_KEY, state.filterCompanyId);
    } catch {
      /* ignore */
    }
    sel.disabled = true;
    try {
      await refreshRefs();
      if (state.balWh && getFilterCompanyId()) {
        const ok = (state.warehouses || []).some((w) => w.id === state.balWh);
        if (!ok) {
          state.balWh = '';
          state.balWhTab = 'stock';
        }
      }
      const tab = String(state.activeTab || '');
      if (!tab || tab === 'dashboard') {
        if (routes.dashboard) await routes.dashboard();
      } else if (typeof routes[tab] === 'function') {
        await routes[tab]();
      } else {
        applyAppPath(location.pathname, true);
      }
    } finally {
      sel.disabled = false;
    }
  };
}

function orgOptionsHtml(selectedId, companyId) {
  const co = String(companyId || '').trim();
  let list = state.organizations || [];
  if (co) list = list.filter((o) => String(o.company_id || '') === co);
  const sel = String(selectedId || '');
  if (!list.length) return '<option value="">—</option>';
  return list
    .map((o) => {
      const id = o.id;
      const mark = o.is_default ? ' ★' : '';
      const pick = sel ? id === sel : !!o.is_default;
      return `<option value="${esc(id)}" ${pick ? 'selected' : ''}>${esc(o.short_name || o.name)}${mark}</option>`;
    })
    .join('');
}

function companyOptionsHtml(selectedId) {
  const list = Array.isArray(state.companies) ? state.companies : [];
  const sel = String(selectedId || '');
  if (!list.length) {
    return `<option value="${esc(sel)}">${esc(companyContourName(sel))}</option>`;
  }
  return list
    .map((c) => {
      const id = String(c.id || '');
      return `<option value="${esc(id)}" ${id === sel ? 'selected' : ''}>${esc(c.name || id)}</option>`;
    })
    .join('');
}

function selectedOrgId(elId) {
  const el = document.getElementById(elId || 'deal-org');
  return el ? String(el.value || '').trim() : '';
}

/** Юрлицо для документов заказа: select или зафиксированное после счёта. */
function dealSelectedOrgId() {
  const fromSel = selectedOrgId('deal-org');
  if (fromSel) return fromSel;
  return String(state.dealOrgId || '').trim();
}

function orgById(organizationId) {
  const id = String(organizationId || '').trim();
  if (!id) return null;
  return (state.organizations || []).find((o) => String(o.id) === id) || null;
}

const PAGE_SIZE_STORE_KEY = 'wms.page-size.v1';
const PAGE_SIZE_OPTS = [25, 50, 100, 200];

function getPageSize(listKey, fallback = 50) {
  try {
    const raw = localStorage.getItem(PAGE_SIZE_STORE_KEY);
    const all = raw ? JSON.parse(raw) : {};
    const n = Number(all && all[listKey]);
    if (PAGE_SIZE_OPTS.includes(n)) return n;
  } catch (_) {
    /* ignore */
  }
  return fallback;
}

function setPageSize(listKey, n) {
  const v = Number(n);
  if (!PAGE_SIZE_OPTS.includes(v) || !listKey) return v;
  try {
    const raw = localStorage.getItem(PAGE_SIZE_STORE_KEY);
    const all = raw ? JSON.parse(raw) : {};
    all[listKey] = v;
    localStorage.setItem(PAGE_SIZE_STORE_KEY, JSON.stringify(all));
  } catch (_) {
    /* ignore */
  }
  return v;
}

/**
 * @param {string} id
 * @param {number} page
 * @param {number} pages
 * @param {number} total
 * @param {{ limit?: number, listKey?: string }} [opts]
 */
function pagerHtml(id, page, pages, total, opts = {}) {
  const prevDisabled = page <= 1 ? 'disabled' : '';
  const nextDisabled = page >= pages ? 'disabled' : '';
  const limit = Number(opts.limit) || 50;
  const listKey = opts.listKey || '';
  const sizeHtml = listKey
    ? `<label class="pager-size">На стр.
        <select data-pager-limit aria-label="Элементов на странице">
          ${PAGE_SIZE_OPTS.map(
            (n) => `<option value="${n}" ${n === limit ? 'selected' : ''}>${n}</option>`
          ).join('')}
        </select>
      </label>`
    : '';
  return `
    <div class="pager" id="${id}">
      <button type="button" data-dir="-1" ${prevDisabled} title="Назад">◀</button>
      <span class="muted">${page} / ${pages} · ${total}</span>
      <button type="button" data-dir="1" ${nextDisabled} title="Вперёд">▶</button>
      ${sizeHtml}
    </div>`;
}

/**
 * @param {string} id
 * @param {((dir: number) => void) | { onPage?: (dir: number) => void, onLimit?: (limit: number) => void }} handlers
 */
function bindPager(id, handlers) {
  const el = document.getElementById(id);
  if (!el) return;
  const onPage = typeof handlers === 'function' ? handlers : handlers && handlers.onPage;
  const onLimit = typeof handlers === 'function' ? null : handlers && handlers.onLimit;
  el.querySelectorAll('button[data-dir]').forEach((btn) => {
    btn.onclick = () => {
      if (btn.disabled) return;
      if (onPage) onPage(Number(btn.dataset.dir));
    };
  });
  const sel = el.querySelector('[data-pager-limit]');
  if (sel && onLimit) {
    sel.onchange = () => onLimit(Number(sel.value));
  }
}

/** Пейджер списка: страница в state[pageKey], размер в localStorage[listKey]. */
function bindListPager(pagerIds, listKey, pageKey, renderFn) {
  const ids = Array.isArray(pagerIds) ? pagerIds : [pagerIds];
  const handlers = {
    onPage: (d) => {
      state[pageKey] = Math.max(1, (Number(state[pageKey]) || 1) + d);
      renderFn();
    },
    onLimit: (limit) => {
      setPageSize(listKey, limit);
      state[pageKey] = 1;
      renderFn();
    },
  };
  ids.forEach((id) => bindPager(id, handlers));
}

function debounce(fn, ms) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

function formatMoney(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return '—';
  return (
    v.toLocaleString('ru-RU', { maximumFractionDigits: 2 }).replace(/\s/g, '\u00a0') + '\u00a0₽'
  );
}

function showForm() {
  sectionPanel.classList.add('hidden');
  view.classList.remove('hidden');
}

function showSectionPanel() {
  view.classList.add('hidden');
  sectionPanel.classList.remove('hidden');
}

function currentBookmarkPath() {
  const p = (location.pathname || '/').replace(/\/+$/, '') || '/';
  return p === '/legacy.html' ? '/' : p;
}

function bookmarkForPath(path) {
  const p = path || currentBookmarkPath();
  return (state.bookmarks || []).find((b) => b.path === p) || null;
}

function renderFavs() {
  if (!favsEl) return;
  const items = state.bookmarks || [];
  if (!items.length) {
    favsEl.hidden = true;
    favsEl.innerHTML = '';
    return;
  }
  const cur = currentBookmarkPath();
  favsEl.hidden = false;
  favsEl.innerHTML =
    `<div class="taxi-favs-inner">` +
    `<span class="taxi-favs-label" title="Закладки">★</span>` +
    items
      .map((b) => {
        const active = b.path === cur ? ' is-active' : '';
        return `
      <button type="button" class="fav${active}" data-fav-id="${esc(b.id)}" data-fav-path="${esc(b.path)}" data-fav-tab="${esc(b.tab_id || '')}" title="${esc(b.title)}" data-tip="${esc(b.title)}">
        <span class="fav-title">${esc(b.title)}</span>
        <span class="fav-del" data-fav-del="${esc(b.id)}" title="Убрать из закладок" data-tip="Убрать" role="button">✕</span>
      </button>`;
      })
      .join('') +
    `</div>`;
  favsEl.querySelectorAll('.fav').forEach((btn) => {
    btn.onclick = (e) => {
      const del = e.target && e.target.closest && e.target.closest('[data-fav-del]');
      if (del) {
        e.preventDefault();
        e.stopPropagation();
        removeBookmark(del.getAttribute('data-fav-del'));
        return;
      }
      const tabId = btn.getAttribute('data-fav-tab') || '';
      const path = btn.getAttribute('data-fav-path') || '/';
      if (tabId && (routes[tabId] || tabId === 'dashboard' || tabId.includes(':'))) {
        openTab(tabId);
      } else {
        applyAppPath(path, false);
      }
      // подсветить активную после перехода (форма перерисуется через route)
      setTimeout(renderFavs, 0);
    };
  });
}

async function loadBookmarks() {
  try {
    const data = await api('/me/bookmarks');
    state.bookmarks = Array.isArray(data.items) ? data.items : [];
  } catch {
    state.bookmarks = [];
  }
  renderFavs();
  syncFavButton();
}

function syncFavButton() {
  renderFavs();
  const fav = document.getElementById('tb-fav');
  if (!fav) return;
  const hit = bookmarkForPath();
  fav.classList.toggle('is-fav', !!hit);
  const tip = hit ? 'Убрать из закладок' : 'Закрепить в закладках';
  fav.setAttribute('data-tip', tip);
  fav.setAttribute('aria-label', tip);
  fav.title = tip;
  fav.setAttribute('aria-pressed', hit ? 'true' : 'false');
}

async function toggleBookmark() {
  const path = currentBookmarkPath();
  const titleEl = document.querySelector('.form-titlebar h1');
  const title =
    (titleEl && titleEl.textContent.trim()) ||
    VIEW_TITLES[state.activeTab] ||
    state.tabs.find((t) => t.id === state.activeTab)?.title ||
    path;
  const existing = bookmarkForPath(path);
  try {
    if (existing) {
      await api('/me/bookmarks/' + encodeURIComponent(existing.id), { method: 'DELETE' });
      state.bookmarks = (state.bookmarks || []).filter((b) => b.id !== existing.id);
    } else {
      const data = await api('/me/bookmarks', {
        method: 'POST',
        body: JSON.stringify({
          title,
          path,
          tab_id: state.activeTab || '',
        }),
      });
      if (data.item) {
        state.bookmarks = [...(state.bookmarks || []).filter((b) => b.path !== path), data.item];
      } else {
        await loadBookmarks();
        return;
      }
    }
  } catch (e) {
    console.warn('[bookmarks]', e);
  }
  renderFavs();
  syncFavButton();
}

async function removeBookmark(id) {
  if (!id) return;
  try {
    await api('/me/bookmarks/' + encodeURIComponent(id), { method: 'DELETE' });
    state.bookmarks = (state.bookmarks || []).filter((b) => b.id !== id);
  } catch (e) {
    console.warn('[bookmarks]', e);
  }
  renderFavs();
  syncFavButton();
}

function renderTabs() {
  if (!tabsEl) return;
  // Начальная страница — не вкладка
  if (state.tabs.some((t) => t.id === 'dashboard')) {
    state.tabs = state.tabs.filter((t) => t.id !== 'dashboard');
  }
  const visible = state.tabs;
  tabsEl.hidden = false;
  const tabsHtml = visible
    .map((t) => {
      const active = t.id === state.activeTab ? ' active' : '';
      return `<button type="button" class="tab${active}" data-tab="${esc(t.id)}" title="${esc(t.title)}">
        <span class="tab-label">${esc(t.title)}</span>
        <span class="tab-close" data-tab-close="${esc(t.id)}" title="Закрыть" aria-label="Закрыть">×</span>
      </button>`;
    })
    .join('');
  tabsEl.innerHTML =
    tabsHtml +
    `<button type="button" class="tab-add" id="tab-add" title="Новая вкладка" aria-label="Новая вкладка">
      <svg class="tab-add-ico" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false">
        <path d="M2.2 4.2h4.1l1.2 1.4h6.3v7.2H2.2z" fill="none" stroke="currentColor" stroke-width="1.35" stroke-linejoin="round"/>
        <path d="M8 8.1v3.8M6.1 10h3.8" fill="none" stroke="currentColor" stroke-width="1.45" stroke-linecap="round"/>
      </svg>
    </button>`;
  tabsEl.querySelectorAll('[data-tab]').forEach((btn) => {
    btn.onclick = (e) => {
      if (e.target.closest('[data-tab-close]')) return;
      openTab(btn.dataset.tab);
    };
  });
  tabsEl.querySelectorAll('[data-tab-close]').forEach((x) => {
    x.onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      closeTab(x.getAttribute('data-tab-close'));
    };
  });
  const addBtn = document.getElementById('tab-add');
  if (addBtn) addBtn.onclick = () => addNewTab();
}

/** Явно новая вкладка (кнопка +). Навигация по меню — без новой вкладки. */
function addNewTab() {
  const sec = state.section || sectionForTab(state.activeTab) || 'home';
  const landing = SECTION_LANDING[sec];
  if (landing) {
    openTab(landing, VIEW_TITLES[landing] || landing, { newTab: true });
    return;
  }
  const id = 'scratch:' + Date.now();
  state.tabs.push({ id, title: 'Новая', closable: true });
  state.activeTab = id;
  renderTabs();
  highlightSection(sec);
  showSectionPanel();
  renderSectionMenu(sec);
}

function closeCreateLightbox() {
  const el = document.getElementById('create-lightbox');
  if (!el) return;
  el.classList.add('hidden');
  el.innerHTML = '';
  if (state._createLbEsc) {
    document.removeEventListener('keydown', state._createLbEsc);
    state._createLbEsc = null;
  }
}

/**
 * Лайтбокс создания. onSubmit может закрыть сам (closeCreateLightbox) и открыть карточку.
 * @param {{ title: string, bodyHtml: string, submitLabel?: string, wide?: boolean, onMount?: (root: HTMLElement) => void, onSubmit: (root: HTMLElement, setMsg: (t: string) => void) => Promise<void> }} opts
 */
function openCreateLightbox(opts) {
  let root = document.getElementById('create-lightbox');
  if (!root) {
    root = document.createElement('div');
    root.id = 'create-lightbox';
    document.body.appendChild(root);
  }
  root.className = 'create-lightbox';
  root.classList.remove('hidden');
  const hideSubmit = !!opts.hideSubmit;
  root.innerHTML = `
    <div class="create-lightbox-card ${opts.wide ? 'wide' : ''}" role="dialog" aria-modal="true" aria-labelledby="create-lb-title">
      <div class="create-lightbox-head">
        <h3 id="create-lb-title">${esc(opts.title || 'Создать')}</h3>
        <button type="button" class="create-lightbox-x" id="create-lb-x" aria-label="Закрыть">✕</button>
      </div>
      <div class="create-lightbox-body">${opts.bodyHtml || ''}</div>
      <div class="create-lightbox-actions">
        ${
          hideSubmit
            ? ''
            : `<button type="button" class="primary" id="create-lb-submit"${
                opts.submitDisabled ? ' disabled' : ''
              }>${esc(opts.submitLabel || 'Создать')}</button>`
        }
        <button type="button" id="create-lb-cancel">${esc(opts.cancelLabel || 'Отмена')}</button>
        <span class="muted" id="create-lb-msg"></span>
      </div>
    </div>`;
  const close = () => closeCreateLightbox();
  root.querySelector('#create-lb-x').onclick = close;
  root.querySelector('#create-lb-cancel').onclick = close;
  root.onclick = (e) => {
    if (e.target === root) close();
  };
  if (state._createLbEsc) document.removeEventListener('keydown', state._createLbEsc);
  const setMsg = (t) => {
    const m = root.querySelector('#create-lb-msg');
    if (m) m.textContent = t || '';
  };
  if (typeof opts.onMount === 'function') opts.onMount(root);
  const submitBtn = root.querySelector('#create-lb-submit');
  state._createLbEsc = (e) => {
    if (e.key === 'Escape') close();
    if (
      e.key === 'Enter' &&
      !e.shiftKey &&
      e.target &&
      root.contains(e.target) &&
      e.target.tagName === 'INPUT' &&
      submitBtn &&
      !submitBtn.disabled
    ) {
      e.preventDefault();
      submitBtn.click();
    }
  };
  document.addEventListener('keydown', state._createLbEsc);
  if (submitBtn) {
    submitBtn.onclick = async () => {
      if (submitBtn.disabled) return;
      submitBtn.disabled = true;
      setMsg('');
      try {
        await opts.onSubmit(root, setMsg);
      } catch (e) {
        setMsg(e.message || String(e));
      } finally {
        if (root.isConnected && !root.classList.contains('hidden') && !opts.submitDisabled) {
          submitBtn.disabled = false;
        }
      }
    };
  }
  setTimeout(() => {
    const focusEl = root.querySelector(
      '.create-lightbox-body input:not([type="hidden"]):not([disabled]), .create-lightbox-body select, .create-lightbox-body textarea'
    );
    focusEl?.focus();
  }, 0);
  return root;
}

/**
 * UI library: иконки тулбара (.ui-ico-bar + .toolbar-ico).
 * Стили — styles.css «UI library: icon toolbar».
 * Использование: uiIcoBar([uiIcoLink({…}), uiIcoBtn({…})])
 */
const UI_ICO = {
  pdf: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.2 1.8h6.1L13 5.5v8.7c0 .6-.5 1-1 1H3.2c-.6 0-1-.4-1-1V2.8c0-.6.4-1 1-1z" fill="none" stroke="currentColor" stroke-width="1.3"/><path d="M9.1 1.9V5.4H12.7" fill="none" stroke="currentColor" stroke-width="1.3"/><path d="M4.4 9.2h2.1c.9 0 1.5.5 1.5 1.3S7.4 11.8 6.5 11.8H5.3V13H4.4V9.2zm.9.8v1.1h.9c.4 0 .7-.2.7-.55s-.3-.55-.7-.55H5.3zM8.6 13V9.2h1.5c1.15 0 1.9.7 1.9 1.9S11.25 13 10.1 13H8.6zm.9-.8h.55c.55 0 1-.35 1-1.1s-.45-1.1-1-1.1H9.5V12.2z" fill="currentColor"/></svg>',
  download:
    '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 2.2v7.2" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/><path d="M5.2 6.8L8 9.6l2.8-2.8" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/><path d="M3 12.2h10" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>',
  doc: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.2 2.4h6.2L12.8 5.8v7.4c0 .6-.5 1.1-1.1 1.1H3.2c-.6 0-1.1-.5-1.1-1.1V3.5c0-.6.5-1.1 1.1-1.1z" fill="none" stroke="currentColor" stroke-width="1.3"/><path d="M9.2 2.5V5.6h3.4" fill="none" stroke="currentColor" stroke-width="1.3"/><path d="M4.6 8.2h6.2M4.6 10.4h6.2M4.6 12.4h4" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round"/></svg>',
  print:
    '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4.2 2.2h7.6v3.2H4.2zM3 6.2h10c.9 0 1.6.7 1.6 1.6v3.4H12V9.4H4v1.8H1.4V7.8c0-.9.7-1.6 1.6-1.6zM4 10.8h8v3h-8z" fill="currentColor"/><path d="M11.2 7.4h1.4M5.2 12.2h5.6" fill="none" stroke="#fff" stroke-width="1.1" stroke-linecap="round"/></svg>',
  deal: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2.8 4.2h10.4v8.2c0 .6-.5 1.1-1.1 1.1H3.9c-.6 0-1.1-.5-1.1-1.1V4.2z" fill="none" stroke="currentColor" stroke-width="1.3"/><path d="M5.2 4.2V3.3c0-.5.4-.9.9-.9h3.8c.5 0 .9.4.9.9v.9M5.4 7.6h5.2M5.4 10h3.6" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round"/></svg>',
  archive:
    '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2.5 4.5h11M3.5 4.5v8.2c0 .7.5 1.3 1.2 1.3h6.6c.7 0 1.2-.6 1.2-1.3V4.5M6 7.2h4M6 9.8h4" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M2 2.8h12v1.7H2z" fill="currentColor" opacity=".9"/></svg>',
  restore:
    '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2.5 4.5h11M3.5 4.5v8.2c0 .7.5 1.3 1.2 1.3h6.6c.7 0 1.2-.6 1.2-1.3V4.5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M2 2.8h12v1.7H2z" fill="currentColor" opacity=".85"/><path d="M8 12.2V7.6M8 7.6l-1.8 1.8M8 7.6l1.8 1.8" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  excel:
    '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.2 2.2h6.2L13 5.8v8c0 .6-.5 1-1 1H3.2c-.6 0-1-.4-1-1V3.2c0-.6.4-1 1-1z" fill="none" stroke="currentColor" stroke-width="1.3"/><path d="M9.2 2.3V5.6H12.8" fill="none" stroke="currentColor" stroke-width="1.3"/><path d="M4.6 8.2h2.2M4.6 10.2h2.2M4.6 12.2h2.2M8.4 8.2h3M8.4 10.2h3M8.4 12.2h3" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>',
  qr: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2.2 2.2h4.2v4.2H2.2zM9.6 2.2h4.2v4.2H9.6zM2.2 9.6h4.2v4.2H2.2z" fill="none" stroke="currentColor" stroke-width="1.35"/><path d="M3.4 3.4h1.8v1.8H3.4zM10.8 3.4h1.8v1.8h-1.8zM3.4 10.8h1.8v1.8H3.4z" fill="currentColor"/><path d="M9.6 9.6h1.4v1.4H9.6zM12.4 9.6h1.4v1.4h-1.4zM9.6 12.4h1.4v1.4H9.6zM11.4 11.4h1v1h-1zM13.2 11.4h.6v.6h-.6zM11.4 13.2h.6v.6h-.6zM12.8 12.8h1.2v1.2h-1.2z" fill="currentColor"/></svg>',
  camera:
    '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2.4 4.6h2.1l.9-1.4h5.2l.9 1.4h2.1c.7 0 1.2.5 1.2 1.2v6c0 .7-.5 1.2-1.2 1.2H2.4c-.7 0-1.2-.5-1.2-1.2v-6c0-.7.5-1.2 1.2-1.2z" fill="none" stroke="currentColor" stroke-width="1.3"/><circle cx="8" cy="8.4" r="2.4" fill="none" stroke="currentColor" stroke-width="1.3"/></svg>',
};

let _camScanScanner = null;
let _camScanBusy = false;

function loadScriptOnce(src) {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector('script[data-scan-lib="' + src + '"]');
    if (existing) {
      if (existing.dataset.ready === '1') return resolve();
      existing.addEventListener('load', () => resolve());
      existing.addEventListener('error', () => reject(new Error('load failed')));
      return;
    }
    const s = document.createElement('script');
    s.src = src;
    s.async = true;
    s.dataset.scanLib = src;
    s.onload = () => {
      s.dataset.ready = '1';
      resolve();
    };
    s.onerror = () => reject(new Error('Не удалось загрузить сканер'));
    document.head.appendChild(s);
  });
}

async function ensureHtml5QrLib() {
  await loadScriptOnce('https://cdn.jsdelivr.net/npm/html5-qrcode@2.3.8/html5-qrcode.min.js');
  if (!window.Html5Qrcode) throw new Error('Сканер камеры недоступен');
}

function ensureCameraScanOverlay() {
  let overlay = document.getElementById('wms-cam-scan-overlay');
  if (overlay) return overlay;
  overlay = document.createElement('div');
  overlay.id = 'wms-cam-scan-overlay';
  overlay.className = 'wms-cam-scan-overlay';
  overlay.hidden = true;
  overlay.innerHTML = `
    <div class="wms-cam-scan-card" role="dialog" aria-modal="true" aria-labelledby="wms-cam-scan-title">
      <h3 id="wms-cam-scan-title">Скан камерой</h3>
      <div id="wms-cam-scan-reader" class="wms-cam-scan-reader"></div>
      <p class="wms-cam-scan-hint muted" id="wms-cam-scan-hint">Наведите на Data Matrix или штрихкод</p>
      <div class="wms-cam-scan-actions">
        <button type="button" id="wms-cam-scan-close">Закрыть</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) closeCameraBarcodeScan();
  });
  overlay.querySelector('#wms-cam-scan-close')?.addEventListener('click', () =>
    closeCameraBarcodeScan()
  );
  return overlay;
}

async function closeCameraBarcodeScan() {
  const overlay = document.getElementById('wms-cam-scan-overlay');
  if (_camScanScanner) {
    try {
      await _camScanScanner.stop();
    } catch (_) {
      /* ignore */
    }
    try {
      await _camScanScanner.clear();
    } catch (_) {
      /* ignore */
    }
    _camScanScanner = null;
  }
  if (overlay) overlay.hidden = true;
  _camScanBusy = false;
}

/**
 * Открыть камеру для скана Data Matrix / штрихкода.
 * opts.onCode(code) — вызывается один раз при успехе.
 */
async function openCameraBarcodeScan(opts = {}) {
  if (_camScanBusy) return;
  _camScanBusy = true;
  const overlay = ensureCameraScanOverlay();
  const hint = document.getElementById('wms-cam-scan-hint');
  const title = document.getElementById('wms-cam-scan-title');
  if (title) title.textContent = opts.title || 'Скан камерой';
  if (hint) hint.textContent = opts.hint || 'Наведите на Data Matrix или штрихкод';
  overlay.hidden = false;
  let applied = false;
  const apply = async (raw) => {
    const code = String(raw || '').trim();
    if (!code || applied) return;
    applied = true;
    await closeCameraBarcodeScan();
    if (typeof opts.onCode === 'function') opts.onCode(code);
  };
  try {
    await ensureHtml5QrLib();
    if (_camScanScanner) {
      try {
        await _camScanScanner.stop();
      } catch (_) {
        /* ignore */
      }
      try {
        await _camScanScanner.clear();
      } catch (_) {
        /* ignore */
      }
      _camScanScanner = null;
    }
    const formats = window.Html5QrcodeSupportedFormats;
    const config = {
      fps: 10,
      qrbox: { width: 240, height: 240 },
      formatsToSupport: formats
        ? [
            formats.DATA_MATRIX,
            formats.QR_CODE,
            formats.CODE_128,
            formats.CODE_39,
            formats.EAN_13,
            formats.EAN_8,
          ].filter(Boolean)
        : undefined,
    };
    _camScanScanner = new window.Html5Qrcode('wms-cam-scan-reader');
    await _camScanScanner.start(
      { facingMode: 'environment' },
      config,
      (decoded) => {
        apply(decoded);
      },
      () => {}
    );
    _camScanBusy = false;
  } catch (e) {
    if (hint) hint.textContent = e.message || String(e);
    _camScanBusy = false;
    throw e;
  }
}

function uiIcoSvg(nameOrSvg) {
  if (!nameOrSvg) return '';
  if (UI_ICO[nameOrSvg]) return UI_ICO[nameOrSvg];
  return String(nameOrSvg);
}

function uiIcoBtn(opts = {}) {
  const tip = String(opts.tip || opts.title || opts.label || '');
  const id = opts.id ? ` id="${esc(opts.id)}"` : '';
  const cls = ['toolbar-ico', opts.className || opts.mod || ''].filter(Boolean).join(' ');
  const dis = opts.disabled ? ' disabled' : '';
  const extra = opts.attrs ? ' ' + String(opts.attrs).trim() : '';
  return `<button type="button" class="${esc(cls)}"${id} data-tip="${esc(tip)}" title="${esc(tip)}" aria-label="${esc(tip)}"${dis}${extra}>${uiIcoSvg(opts.icon)}</button>`;
}

function uiIcoLink(opts = {}) {
  const tip = String(opts.tip || opts.title || opts.label || '');
  const id = opts.id ? ` id="${esc(opts.id)}"` : '';
  const cls = ['toolbar-ico', opts.className || opts.mod || ''].filter(Boolean).join(' ');
  const href = String(opts.href || '#');
  const target = opts.target ? ` target="${esc(opts.target)}"` : '';
  const rel = opts.rel || (opts.target === '_blank' ? 'noopener' : '');
  const relAttr = rel ? ` rel="${esc(rel)}"` : '';
  const download = opts.download ? ' download' : '';
  const extra = opts.attrs ? ' ' + String(opts.attrs).trim() : '';
  return `<a class="${esc(cls)}"${id} href="${esc(href)}"${target}${relAttr}${download} data-tip="${esc(tip)}" title="${esc(tip)}" aria-label="${esc(tip)}"${extra}>${uiIcoSvg(opts.icon)}</a>`;
}

/** Группа иконок справа в form-toolbar (класс .ui-ico-bar). */
function uiIcoBar(items, opts = {}) {
  const list = (Array.isArray(items) ? items : [items]).filter(Boolean);
  if (!list.length) return '';
  const align = opts.align || 'end';
  const mod = align === 'start' ? ' ui-ico-bar--start' : align === 'inline' ? ' ui-ico-bar--inline' : '';
  const extra = opts.className ? ' ' + String(opts.className) : '';
  return `<div class="ui-ico-bar${mod}${extra}">${list.join('')}</div>`;
}

/**
 * Единый UX PDF на карточках документов: Печать / Подпись + открыть / скачать.
 * opts: {
 *   id, prefix?: 'sd'|'prep',
 *   disabled?: boolean, disabledTip?: string,
 *   showDeal?: boolean, dealId?: string,
 *   showPrintHtml?: boolean,  // полный HTML (договор)
 *   showOpenDoc?: boolean, docTabLabel?: string
 * }
 */
function salesDocPdfBarHtml(opts = {}) {
  const docId = String(opts.id || '').trim();
  if (!docId) return '';
  const prefix = String(opts.prefix || 'sd');
  const disabled = !!opts.disabled;
  const disabledTip = String(opts.disabledTip || 'Сначала заполните обязательные поля');
  const base = '/api/sales-docs/' + encodeURIComponent(docId);
  const openHref = disabled ? '#' : base + '/pdf';
  const dlHref = disabled ? '#' : base + '/pdf?download=1';
  const printHref = base + '/print';
  return `<div class="ui-ico-bar" id="${esc(prefix)}-pdf-bar">
    <label class="ui-ico-check" title="Печать на PDF">
      <input type="checkbox" id="${esc(prefix)}-pdf-stamp" checked ${disabled ? 'disabled' : ''} />
      <span>Печать</span>
    </label>
    <label class="ui-ico-check" title="Подпись на PDF">
      <input type="checkbox" id="${esc(prefix)}-pdf-sign" checked ${disabled ? 'disabled' : ''} />
      <span>Подпись</span>
    </label>
    ${uiIcoLink({
      id: prefix + '-pdf-open',
      href: openHref,
      tip: disabled ? disabledTip : 'Открыть PDF',
      icon: 'pdf',
      target: disabled ? undefined : '_blank',
      attrs: disabled ? 'aria-disabled="true" tabindex="-1"' : '',
      className: disabled ? 'is-disabled' : '',
    })}
    ${uiIcoLink({
      id: prefix + '-pdf-dl',
      href: dlHref,
      tip: disabled ? disabledTip : 'Скачать PDF',
      icon: 'download',
      attrs: disabled ? 'aria-disabled="true" tabindex="-1"' : '',
      className: disabled ? 'is-disabled' : '',
    })}
    ${
      opts.showPrintHtml
        ? uiIcoLink({
            id: prefix + '-pdf-print',
            href: printHref,
            tip: 'Печать полного текста',
            icon: 'print',
            target: '_blank',
          })
        : ''
    }
    ${
      opts.showOpenDoc
        ? uiIcoBtn({
            id: prefix + '-open-doc',
            tip: opts.docTabLabel ? 'Открыть «' + opts.docTabLabel + '»' : 'Открыть документ',
            icon: 'doc',
            mod: 'is-deal',
          })
        : ''
    }
    ${
      opts.showDeal && opts.dealId
        ? uiIcoBtn({
            id: prefix + '-deal',
            tip: 'Открыть заказ покупателя',
            icon: 'deal',
            mod: 'is-deal',
          })
        : ''
    }
  </div>`;
}

function bindSalesDocPdfBar(opts = {}) {
  const docId = String(opts.id || '').trim();
  if (!docId) return;
  const prefix = String(opts.prefix || 'sd');
  const disabled = !!opts.disabled;
  const sync = () => {
    if (disabled) return;
    const stampOn = !!document.getElementById(prefix + '-pdf-stamp')?.checked;
    const signOn = !!document.getElementById(prefix + '-pdf-sign')?.checked;
    const qs = new URLSearchParams();
    if (!stampOn) qs.set('stamps', '0');
    if (!signOn) qs.set('signs', '0');
    const q = qs.toString();
    const base = '/api/sales-docs/' + encodeURIComponent(docId) + '/pdf';
    const open = document.getElementById(prefix + '-pdf-open');
    const dl = document.getElementById(prefix + '-pdf-dl');
    if (open) open.setAttribute('href', q ? base + '?' + q : base);
    if (dl) {
      const dlQs = new URLSearchParams(qs);
      dlQs.set('download', '1');
      dl.setAttribute('href', base + '?' + dlQs.toString());
    }
  };
  document.getElementById(prefix + '-pdf-stamp')?.addEventListener('change', sync);
  document.getElementById(prefix + '-pdf-sign')?.addEventListener('change', sync);
  sync();
  if (disabled) {
    const block = (e) => {
      e.preventDefault();
      e.stopPropagation();
    };
    document.getElementById(prefix + '-pdf-open')?.addEventListener('click', block);
    document.getElementById(prefix + '-pdf-dl')?.addEventListener('click', block);
  }
  const dealBtn = document.getElementById(prefix + '-deal');
  if (dealBtn && opts.dealId) {
    dealBtn.onclick = () => openTab('deal:' + opts.dealId);
  }
  const openDoc = document.getElementById(prefix + '-open-doc');
  if (openDoc) {
    openDoc.onclick = () => openTab('sales:' + docId, opts.docTabLabel || 'Документ');
  }
}

/**
 * Единый поиск для тулбаров и панелей (.find / .ui-find).
 * opts: inputId, btnId, placeholder, value, buttonLabel, type, inputClass, className, style, extraHtml
 */
function uiFind(opts = {}) {
  const inputId = String(opts.inputId || opts.id || 'q');
  const btnId = String(opts.btnId || inputId + '-go');
  const ph = opts.placeholder != null ? String(opts.placeholder) : 'Поиск';
  const val = opts.value != null ? String(opts.value) : '';
  const btnLabel = opts.buttonLabel != null ? String(opts.buttonLabel) : 'Найти';
  const cls = ['find', 'ui-find', opts.className || ''].filter(Boolean).join(' ');
  const wrapId = opts.wrapId ? ` id="${esc(opts.wrapId)}"` : '';
  const style = opts.style ? ` style="${esc(opts.style)}"` : '';
  const inputType = opts.type || 'search';
  const inputCls = opts.inputClass ? ` class="${esc(opts.inputClass)}"` : '';
  const extra = opts.extraHtml || '';
  const attrs = opts.inputAttrs ? ' ' + String(opts.inputAttrs).trim() : '';
  return `<div class="${esc(cls)}"${wrapId}${style} role="search">
  <input${inputCls} id="${esc(inputId)}" type="${esc(inputType)}" placeholder="${esc(ph)}" value="${esc(val)}" autocomplete="off"${attrs} />
  <button type="button" class="find-go" id="${esc(btnId)}">${esc(btnLabel)}</button>
  ${extra}
</div>`;
}

function archiveIconBtn(prefix, archived) {
  if (archived) {
    return uiIcoBtn({
      id: String(prefix || 'ce') + '-restore',
      tip: 'Вернуть из архива',
      icon: 'restore',
      mod: 'is-restore',
    });
  }
  return uiIcoBtn({
    id: String(prefix || 'ce') + '-archive',
    tip: 'В архив',
    icon: 'archive',
    mod: 'is-archive',
  });
}

/** Подписи типа сущности в заголовках карточек (kicker / «Склад · …»). */
const ENTITY_KIND_LABELS = {
  warehouse: 'Склад',
  product: 'Номенклатура',
  service: 'Услуга',
  deal: 'Заказ покупателя',
  counterparty: 'Контрагент',
  stock_doc: 'Складской документ',
  sales_doc: 'Документ продажи',
  thin_doc: 'Документ',
  supply_order: 'Заказ поставщику',
  organization: 'Организация',
  staff: 'Сотрудник',
  balances: 'Остатки',
};

function entityKindLabel(kind) {
  const k = String(kind || '').trim();
  if (!k) return '';
  return ENTITY_KIND_LABELS[k] || k;
}

/** Заголовок: «код · название» (пустые части отбрасываются). */
function entityTitle(...parts) {
  return parts
    .map((p) => String(p == null ? '' : p).trim())
    .filter(Boolean)
    .join(' · ');
}

async function resolveWarehouseRow(id) {
  if (!id) return null;
  const fromState = (state.warehouses || []).find((w) => w.id === id);
  if (fromState) return fromState;
  try {
    const allWh = await api(withCompanyId('/warehouses?archived=all'));
    const list = Array.isArray(allWh) ? allWh : [];
    return list.find((w) => w.id === id) || null;
  } catch (_) {
    return null;
  }
}

/** Хлебные крошки: раздел → журнал → текущий экран (последний — заголовок). */
function buildBreadcrumbs(title, opts = {}) {
  const titleStr = String(title || '').trim() || '…';
  if (Array.isArray(opts.crumbs) && opts.crumbs.length) {
    const list = opts.crumbs
      .map((c) => ({
        label: String(c.label || '').trim(),
        type: c.current ? '' : c.type || '',
        id: c.current ? '' : c.id || '',
        current: !!c.current,
      }))
      .filter((c) => c.label);
    if (!list.some((c) => c.current)) {
      list.push({ label: titleStr, current: true });
    }
    return list;
  }
  const crumbs = [];
  const tab = String(state.activeTab || '');
  const secId = opts.sectionId || sectionForTab(tab) || state.section || '';
  if (secId && typeof SECTION_LABELS !== 'undefined' && SECTION_LABELS[secId]) {
    // Раздел всегда кликабелен → меню раздела (даже если заголовок тот же)
    crumbs.push({ label: SECTION_LABELS[secId], type: 'section', id: secId });
  }
  const detailParents = [
    { re: /^product:/, id: 'products', label: 'Номенклатура' },
    { re: /^deal:/, id: 'deals', label: 'Заказы покупателей' },
    { re: /^history:/, id: 'deals', label: 'Заказы покупателей' },
    { re: /^structure:/, id: 'deals', label: 'Заказы покупателей' },
    { re: /^doc:/, id: 'docs', label: 'Документы' },
    { re: /^company:/, id: 'counterparties', label: 'Контрагенты' },
    { re: /^sales:/, id: 'invoices', label: 'Счета на оплату' },
    { re: /^xfer:/, id: 'parity-transfer-orders', label: 'Заказы на перемещение' },
    { re: /^serial:/, id: 'product-units', label: 'Экземпляры' },
  ];
  for (const p of detailParents) {
    if (p.re.test(tab)) {
      crumbs.push({ label: p.label, type: 'tab', id: p.id });
      break;
    }
  }
  if (tab === 'balances') {
    crumbs.push({ label: 'Склады', type: 'tab', id: 'warehouses' });
  }
  if (opts.parentTab) {
    const lab = opts.parentLabel || VIEW_TITLES[opts.parentTab] || opts.parentTab;
    if (!crumbs.some((c) => c.type === 'tab' && c.id === opts.parentTab)) {
      crumbs.push({ label: String(lab), type: 'tab', id: String(opts.parentTab) });
    }
  }
  // Убрать дубль родителя с тем же текстом, что у текущего заголовка
  const parents = crumbs.filter((c) => c.label && c.label !== titleStr);
  // Если заголовок = имя раздела — оставляем раздел ссылкой + текущий
  if (!parents.length && crumbs.length === 1 && crumbs[0].type === 'section') {
    return [
      { label: crumbs[0].label, type: 'section', id: crumbs[0].id },
      { label: titleStr, current: true },
    ];
  }
  parents.push({ label: titleStr, current: true });
  return parents;
}

function crumbsHtml(crumbs) {
  if (!crumbs || crumbs.length < 1) return '';
  const parts = [];
  crumbs.forEach((c, i) => {
    if (i) parts.push('<span class="crumb-sep" aria-hidden="true">/</span>');
    if (c.current || !c.type) {
      const cls = c.current ? 'crumb-current crumb-title' : 'crumb-current';
      parts.push(`<span class="${cls}" title="${esc(c.label)}">${esc(c.label)}</span>`);
    } else {
      const href =
        c.type === 'section'
          ? pathForSection(c.id)
          : c.type === 'tab'
            ? pathForTab(c.id)
            : c.type === 'path'
              ? c.id
              : '#';
      parts.push(
        `<a class="crumb-link" href="${esc(href)}" data-crumb-type="${esc(c.type)}" data-crumb-id="${esc(
          c.id
        )}" title="${esc(c.label)}">${esc(c.label)}</a>`
      );
    }
  });
  return `<nav class="form-crumbs form-crumbs--bar" aria-label="Путь">${parts.join('')}</nav>`;
}

function formChrome(title, bodyHtml, opts = {}) {
  const closable = opts.closable !== false && state.activeTab && state.activeTab !== 'dashboard';
  const pageTabs = Array.isArray(opts.pageTabs) ? opts.pageTabs : null;
  const activePageTab = opts.activePageTab || (pageTabs && pageTabs[0] && pageTabs[0].id) || '';
  const pageTabsHtml = pageTabs
    ? `<div class="form-pagetabs">${pageTabs
        .map((t) => {
          const tip =
            t.tip ||
            (t.create ? 'Создать: ' : '') + t.label + (t.count != null ? ` · ${t.count}` : '');
          const n = t.count != null ? Number(t.count) : 0;
          const showCount = Number.isFinite(n) && n > 0 && (n > 1 || t.alert);
          const countHtml = showCount
            ? `<sup class="pagetab-count${t.alert ? ' is-alert' : ''}" aria-label="${esc(
                t.alert
                  ? 'Нужен чек: ' + String(n)
                  : String(n)
              )}">${esc(String(n))}</sup>`
            : t.alert
              ? `<span class="pagetab-dot" title="${esc(tip)}" aria-label="${esc(tip || 'Внимание')}"></span>`
              : '';
          const createCls = t.create ? ' is-create' : '';
          const alertCls = t.alert ? ' has-alert' : '';
          return `<button type="button" class="form-pagetab ${t.id === activePageTab ? 'active' : ''}${createCls}${alertCls}" data-pagetab="${esc(t.id)}" ${t.create ? 'data-create="1"' : ''} ${t.alert ? 'data-alert="1"' : ''} title="${esc(tip)}" data-tip="${esc(tip)}"><span class="pagetab-label">${esc(t.label)}</span>${countHtml}</button>`;
        })
        .join('')}</div>`
    : '';
  const crumbs = buildBreadcrumbs(title, opts);
  // Путь = крошки (последняя — заголовок экрана), без дубля h1
  const titleStack = `<div class="form-title-stack">
        ${crumbsHtml(crumbs)}
        <h1 class="form-title-sr" data-tip="${esc(title)}">${esc(title)}</h1>
      </div>`;
  const isFav = !!bookmarkForPath();
  const favTip = isFav ? 'Убрать из закладок' : 'Закрепить в закладках';
  const icoBack =
    '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M10 3L5 8l5 5" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  const icoFwd =
    '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M6 3l5 5-5 5" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  const icoStar =
    '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 2.2l1.7 3.4 3.8.6-2.7 2.7.6 3.8L8 11.2 4.6 12.7l.6-3.8L2.5 6.2l3.8-.6L8 2.2z" fill="currentColor"/></svg>';
  const icoPrint =
    '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4.2 2.2h7.6v3.2H4.2zM3 6.2h10c.9 0 1.6.7 1.6 1.6v3.4H12V9.4H4v1.8H1.4V7.8c0-.9.7-1.6 1.6-1.6zM4 10.8h8v3h-8z" fill="currentColor"/><path d="M11.2 7.4h1.4M5.2 12.2h5.6" fill="none" stroke="#fff" stroke-width="1.1" stroke-linecap="round"/></svg>';
  const icoChat =
    '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2.5 3.2h11a1.3 1.3 0 011.3 1.3v5.2a1.3 1.3 0 01-1.3 1.3H7.2L4 13.6v-2.6H2.5A1.3 1.3 0 011.2 9.7V4.5a1.3 1.3 0 011.3-1.3z" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/><path d="M4.8 6.2h6.4M4.8 8.4h4.2" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>';
  const printId = opts.printId ? String(opts.printId) : '';
  const printBtn = printId
    ? `<button type="button" class="titlebar-ico" id="${esc(printId)}" data-tip="Печать" title="Печать" aria-label="Печать">${icoPrint}</button>`
    : '';
  state._pageChatRef =
    opts.chatRef && opts.chatRef.type && opts.chatRef.id
      ? {
          type: String(opts.chatRef.type),
          id: String(opts.chatRef.id),
          label: String(opts.chatRef.label || ''),
          href: String(opts.chatRef.href || ''),
        }
      : null;
  const chatBtn = state._pageChatRef
    ? `<button type="button" class="titlebar-ico" id="tb-to-chat" data-tip="В чат" title="Вставить эту карточку в чат и дописать обсуждение" aria-label="В чат">${icoChat}</button>`
    : '';
  const titlebarActions = String(opts.titlebarActions || '').trim();
  const rightBtns =
    titlebarActions || chatBtn || printBtn || closable
      ? `<div class="form-titlebar-right">${titlebarActions}${chatBtn}${printBtn}${
          closable
            ? '<button type="button" class="close-tab" id="tb-close" data-tip="Закрыть" aria-label="Закрыть">✕</button>'
            : ''
        }</div>`
      : '';
  return `
    <div class="form-chrome">
      <div class="form-titlebar">
        <div class="nav-btns">
          <button type="button" id="tb-back" data-tip="Назад" aria-label="Назад">${icoBack}</button>
          <button type="button" id="tb-fwd" data-tip="Вперёд" aria-label="Вперёд" disabled>${icoFwd}</button>
          <button type="button" id="tb-fav" class="${isFav ? 'is-fav' : ''}" data-tip="${esc(favTip)}" aria-label="${esc(favTip)}" aria-pressed="${isFav ? 'true' : 'false'}">${icoStar}</button>
        </div>
        ${titleStack}
        ${rightBtns}
      </div>
      ${opts.hintBar ? `<div class="form-hintbar-slot">${opts.hintBar}</div>` : ''}
      ${pageTabsHtml}
      ${opts.toolbar ? `<div class="form-toolbar">${opts.toolbar}</div>` : ''}
      ${opts.metrics ? `<div class="form-metrics">${opts.metrics}</div>` : ''}
      <div class="form-body">${bodyHtml}</div>
    </div>`;
}


/** Закладки секций: панели в DOM, переключение без перерисовки. */
function bindEntitySectionTabs(root, activeId, stateKey, paneSel) {
  const key = stateKey || 'productSectionTab';
  const panes = [...root.querySelectorAll(paneSel || '.product-pane')];
  const tabs = [...root.querySelectorAll('[data-pagetab]')];
  if (!panes.length || !tabs.length) return;
  const show = (id) => {
    const ok = panes.some((p) => p.dataset.pane === id);
    const next = ok ? id : panes[0].dataset.pane;
    state[key] = next;
    panes.forEach((p) => p.classList.toggle('hidden', p.dataset.pane !== next));
    tabs.forEach((t) => t.classList.toggle('active', t.dataset.pagetab === next));
  };
  tabs.forEach((btn) => {
    btn.onclick = () => show(btn.dataset.pagetab);
  });
  show(activeId || state[key] || panes[0].dataset.pane);
}

/** Закладки секций карточки товара: все панели в DOM, переключение без перерисовки. */
function bindProductSectionTabs(root, activeId) {
  bindEntitySectionTabs(root, activeId, 'productSectionTab', '.product-pane');
}

/** Плавающая панель «Сохранить» — выносим в body, чтобы не клипало overflow form-chrome. */
function clearFloatFormDock() {
  document.querySelectorAll('#form-float-dock').forEach((el) => el.remove());
}

function bindFloatFormActions() {
  clearFloatFormDock();
  const src = view.querySelector('.form-actions.is-float');
  const main = document.querySelector('.taxi-main');
  if (!src || !main) return;

  const dock = document.createElement('div');
  dock.id = 'form-float-dock';
  dock.className = 'form-float-dock';
  dock.setAttribute('role', 'toolbar');
  while (src.firstChild) dock.appendChild(src.firstChild);
  src.remove();
  document.body.appendChild(dock);

  const place = () => {
    const el = document.getElementById('form-float-dock');
    const m = document.querySelector('.taxi-main');
    if (!el || !m) return;
    const r = m.getBoundingClientRect();
    const pad = 14;
    el.style.left = Math.round(r.left + pad) + 'px';
    el.style.width = Math.max(200, Math.round(r.width - pad * 2)) + 'px';
    el.style.bottom = '16px';
  };
  place();
  requestAnimationFrame(place);

  if (!state._floatActionsBound) {
    state._floatActionsBound = true;
    window.addEventListener('resize', place);
    // при смене вкладки/экрана старый dock сносит clearFloatFormDock
  }
  const body = view.querySelector('.form-body');
  if (body) body.classList.add('has-float-actions');
}

function bindFormChrome(onBack) {
  state._onBackFallback = typeof onBack === 'function' ? onBack : null;
  const back = document.getElementById('tb-back');
  if (back) {
    back.onclick = (e) => {
      e.preventDefault();
      goAppBack();
    };
  }
  const fwd = document.getElementById('tb-fwd');
  if (fwd) {
    fwd.onclick = (e) => {
      e.preventDefault();
      goAppForward();
    };
  }
  syncNavButtons();
  view.querySelectorAll('.crumb-link[data-crumb-type]').forEach((btn) => {
    btn.onclick = (e) => {
      e.preventDefault();
      const type = btn.getAttribute('data-crumb-type') || '';
      const id = btn.getAttribute('data-crumb-id') || '';
      if (!id) return;
      if (type === 'section') showSection(id);
      else if (type === 'tab') openTab(id);
      else if (type === 'path') applyAppPath(id, false);
    };
  });
  const fav = document.getElementById('tb-fav');
  if (fav) {
    fav.onclick = () => {
      toggleBookmark();
    };
  }
  syncFavButton();
  const toChat = document.getElementById('tb-to-chat');
  if (toChat) {
    toChat.onclick = () => {
      if (state._pageChatRef) openEntityInChat(state._pageChatRef);
    };
  }
  const close = document.getElementById('tb-close');
  if (close) {
    close.onclick = () => closeTab(state.activeTab);
  }
  view.querySelectorAll('tbody tr').forEach((tr) => {
    tr.addEventListener('click', () => {
      view.querySelectorAll('tbody tr.selected').forEach((r) => r.classList.remove('selected'));
      tr.classList.add('selected');
    });
  });
  // Галочки-фильтры по столбцам отключены: везде сортировка + порядок столбцов.
  enhanceListTables(view);
  bindFloatFormActions();
}

const TABLE_COLS_STORE_KEY = 'wms.table-cols.v1';
/** v2: стабильные id по подписи + «Дата» всегда первая (сброс старых порядков). */
const TABLE_COL_ORDER_STORE_KEY = 'wms.table-cols.order.v2';
const TABLE_LAYOUT_STORE_KEY = 'wms.table-layout.v1';

function loadTableColPrefs(storeKey) {
  try {
    const all = JSON.parse(localStorage.getItem(TABLE_COLS_STORE_KEY) || '{}');
    const bucket = all && typeof all === 'object' ? all[storeKey] : null;
    return bucket && typeof bucket === 'object' ? bucket : {};
  } catch (_) {
    return {};
  }
}

function saveTableColPrefs(storeKey, prefs) {
  try {
    const all = JSON.parse(localStorage.getItem(TABLE_COLS_STORE_KEY) || '{}');
    const next = all && typeof all === 'object' ? all : {};
    next[storeKey] = prefs;
    localStorage.setItem(TABLE_COLS_STORE_KEY, JSON.stringify(next));
  } catch (_) {
    /* ignore */
  }
}

function loadTableColOrder(storeKey) {
  try {
    const all = JSON.parse(localStorage.getItem(TABLE_COL_ORDER_STORE_KEY) || '{}');
    const bucket = all && typeof all === 'object' ? all[storeKey] : null;
    return Array.isArray(bucket) ? bucket.map(String) : [];
  } catch (_) {
    return [];
  }
}

function saveTableColOrder(storeKey, order) {
  try {
    const all = JSON.parse(localStorage.getItem(TABLE_COL_ORDER_STORE_KEY) || '{}');
    const next = all && typeof all === 'object' ? all : {};
    next[storeKey] = order;
    localStorage.setItem(TABLE_COL_ORDER_STORE_KEY, JSON.stringify(next));
  } catch (_) {
    /* ignore */
  }
}

function loadTableLayout(storeKey) {
  try {
    const all = JSON.parse(localStorage.getItem(TABLE_LAYOUT_STORE_KEY) || '{}');
    const bucket = all && typeof all === 'object' ? all[storeKey] : null;
    if (bucket && typeof bucket === 'object') {
      return { dense: bucket.dense !== false };
    }
  } catch (_) {
    /* ignore */
  }
  return { dense: true };
}

function saveTableLayout(storeKey, layout) {
  try {
    const all = JSON.parse(localStorage.getItem(TABLE_LAYOUT_STORE_KEY) || '{}');
    const next = all && typeof all === 'object' ? all : {};
    next[storeKey] = layout;
    localStorage.setItem(TABLE_LAYOUT_STORE_KEY, JSON.stringify(next));
  } catch (_) {
    /* ignore */
  }
}

function isDateColumn(th) {
  if (!th) return false;
  if (
    th.dataset.thinSort === 'doc_date' ||
    th.dataset.thinSort === 'created_at' ||
    th.dataset.sort === 'date' ||
    th.dataset.sort === 'created_at' ||
    th.dataset.dealsSort === 'created_at' ||
    th.dataset.dealsSort === 'queued_at' ||
    th.dataset.cpSort === 'created_at' ||
    th.dataset.cpSort === 'created' ||
    th.dataset.cpSort === 'added_at'
  ) {
    return true;
  }
  const label = String(th.dataset.filterLabel || th.textContent || '')
    .replace(/[▾✕▲▼]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
  if (!label) return false;
  if (label === 'дата' || label.startsWith('дата ')) return true;
  if (label === 'добавлен' || label.startsWith('добавлен ')) return true;
  if (label === 'создан' || label.startsWith('создан ')) return true;
  if (label === 'создана' || label.startsWith('создана ')) return true;
  if (label.includes('дата добав') || label.includes('дата создан')) return true;
  return false;
}

function thCleanLabel(th) {
  return String(th?.dataset?.filterLabel || th?.textContent || '')
    .replace(/[▾✕▲▼]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function slugColId(label, i) {
  const s = String(label || '')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[^a-z0-9а-я]+/gi, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 40);
  return s || `c${i}`;
}

function ensureTableColIds(table) {
  const head = table.tHead?.rows?.[0];
  if (!head) return;
  const used = new Set();
  [...head.cells].forEach((th, i) => {
    if (th.dataset.colId) {
      used.add(th.dataset.colId);
      return;
    }
    let id = slugColId(thCleanLabel(th), i);
    if (used.has(id)) id = `${id}_${i}`;
    used.add(id);
    th.dataset.colId = id;
  });
}

function tableColMeta(table) {
  ensureTableColIds(table);
  const cells = table.tHead?.rows?.[0]?.cells;
  if (!cells) return [];
  return [...cells].map((th, i) => {
    const isActions =
      th.classList.contains('col-actions') ||
      th.dataset.colId === 'actions' ||
      th.dataset.colRole === 'actions';
    let label = thCleanLabel(th);
    if (!label && isActions) label = 'Действия';
    if (!label) label = String(th.dataset.filterLabel || '').trim();
    if (!label) label = `Колонка ${i + 1}`;
    const isDate = isDateColumn(th);
    const locked =
      isDate ||
      isActions ||
      th.dataset.colLocked === '1' ||
      th.classList.contains('th-deal-name');
    // Кнопки в строке — не показывают в настройках столбцов
    const hideInSettings = isActions || th.dataset.colSettings === '0';
    return { i, id: th.dataset.colId || `c${i}`, label, locked, isDate, hideInSettings };
  });
}

/** «Дата» / «Добавлен» / «Создан» — всегда в начале (сначала точные «Дата*»). */
function pinDateColsFirst(orderIds, meta) {
  const byId = new Map(meta.map((c) => [c.id, c]));
  const dates = orderIds.map((id) => byId.get(id)).filter((c) => c && c.isDate);
  if (!dates.length) return orderIds;
  const exact = dates.filter((c) => /^дата\b/i.test(c.label));
  const restDates = dates.filter((c) => !/^дата\b/i.test(c.label));
  const pinned = [...exact, ...restDates].map((c) => c.id);
  const pinnedSet = new Set(pinned);
  return [...pinned, ...orderIds.filter((id) => !pinnedSet.has(id))];
}

function orderedTableColMeta(table, storeKey) {
  const meta = tableColMeta(table);
  const byId = new Map(meta.map((c) => [c.id, c]));
  let order = loadTableColOrder(storeKey).filter((id) => byId.has(id));
  meta.forEach((c) => {
    if (!order.includes(c.id)) order.push(c.id);
  });
  order = pinDateColsFirst(order, meta);
  return order.map((id) => byId.get(id)).filter(Boolean);
}

function applyTableColOrder(table, storeKey) {
  const head = table.tHead?.rows?.[0];
  if (!head) return;
  ensureTableColIds(table);
  const ordered = orderedTableColMeta(table, storeKey);
  const orderIds = ordered.map((c) => c.id);
  saveTableColOrder(storeKey, orderIds);
  const curIds = [...head.cells].map((th) => th.dataset.colId);
  if (curIds.join('|') === orderIds.join('|')) return;

  const idToIdx = new Map(curIds.map((id, i) => [id, i]));
  const rows = [head, ...[...(table.tBodies[0]?.rows || [])]];
  const snapshot = new Map();
  orderIds.forEach((id) => {
    const idx = idToIdx.get(id);
    if (idx == null) return;
    snapshot.set(
      id,
      rows.map((row) => row.cells[idx])
    );
  });
  rows.forEach((row, rIdx) => {
    orderIds.forEach((id) => {
      const cell = snapshot.get(id)?.[rIdx];
      if (cell) row.appendChild(cell);
    });
  });
}

function applyTableColPrefs(table, storeKey) {
  const prefs = loadTableColPrefs(storeKey);
  const meta = tableColMeta(table);
  meta.forEach((col) => {
    const show = col.locked || col.isDate ? true : prefs[col.id] !== false;
    const th = table.tHead?.rows?.[0]?.cells?.[col.i];
    if (th) th.hidden = !show;
    [...(table.tBodies[0]?.rows || [])].forEach((tr) => {
      const td = tr.cells[col.i];
      if (td) td.hidden = !show;
    });
  });
}

function applyTableDense(table, storeKey) {
  const layout = loadTableLayout(storeKey);
  table.classList.toggle('is-dense', layout.dense !== false);
  table.classList.toggle('is-wrap', layout.dense === false);
}

function tableCellSortValue(cell) {
  if (!cell) return { kind: 'str', v: '' };
  const raw =
    cell.dataset && cell.dataset.filterText != null && cell.dataset.filterText !== ''
      ? String(cell.dataset.filterText)
      : String(cell.textContent || '');
  const t = raw.replace(/\s+/g, ' ').trim();
  if (!t || t === '—' || t === '…') return { kind: 'str', v: '' };
  // дата YYYY-MM-DD / DD.MM.YYYY
  const iso = t.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return { kind: 'num', v: Date.parse(iso[0]) || 0 };
  const dmy = t.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})/);
  if (dmy) {
    return { kind: 'num', v: Date.parse(`${dmy[3]}-${dmy[2].padStart(2, '0')}-${dmy[1].padStart(2, '0')}`) || 0 };
  }
  const money = t.replace(/\s/g, '').replace(',', '.').replace(/[^\d.-]/g, '');
  if (money && /^-?\d+(\.\d+)?$/.test(money) && /[\d]/.test(t)) {
    return { kind: 'num', v: Number(money) };
  }
  return { kind: 'str', v: t.toLowerCase() };
}

function sortTableBodyByCol(table, colId, dir) {
  const head = table.tHead?.rows?.[0];
  const tbody = table.tBodies?.[0];
  if (!head || !tbody) return;
  const colIdx = [...head.cells].findIndex((th) => th.dataset.colId === colId);
  if (colIdx < 0) return;
  const mul = dir === 'asc' ? 1 : -1;
  const rows = [...tbody.rows].filter((tr) => !tr.classList.contains('wh-arch-sep'));
  rows.sort((a, b) => {
    const av = tableCellSortValue(a.cells[colIdx]);
    const bv = tableCellSortValue(b.cells[colIdx]);
    if (av.kind === 'num' && bv.kind === 'num') {
      if (av.v !== bv.v) return (av.v - bv.v) * mul;
    } else {
      const cmp = String(av.v).localeCompare(String(bv.v), 'ru', { numeric: true });
      if (cmp) return cmp * mul;
    }
    return 0;
  });
  rows.forEach((tr) => tbody.appendChild(tr));
}

function updateClientSortMarks(table, colId, dir) {
  const head = table.tHead?.rows?.[0];
  if (!head) return;
  [...head.cells].forEach((th) => {
    th.classList.remove('sorted');
    const label = String(th.dataset.sortLabel || '')
      .replace(/[▲▼]/g, '')
      .trim();
    if (label) {
      th.childNodes.forEach((n) => {
        if (n.nodeType === 3) n.textContent = '';
      });
      // keep structure; rewrite text content carefully
      const mark = th.dataset.colId === colId ? (dir === 'asc' ? ' ▲' : ' ▼') : '';
      if (th.dataset.sortLabel) {
        // find primary text
        let textNode = [...th.childNodes].find((n) => n.nodeType === 3);
        if (!textNode) {
          textNode = document.createTextNode('');
          th.insertBefore(textNode, th.firstChild);
        }
        textNode.textContent = th.dataset.sortLabel + mark;
      }
    }
    if (th.dataset.colId === colId) th.classList.add('sorted');
  });
}

function tableHasServerSort(table) {
  const head = table.tHead?.rows?.[0];
  if (!head) return false;
  return [...head.cells].some(
    (th) => th.dataset.sort || th.dataset.cpSort || th.dataset.dealsSort || th.dataset.thinSort
  );
}

function bindClientColumnSort(table) {
  if (!table || table.dataset.clientSortBound === '1') return;
  if (table.classList.contains('deals-table')) return;
  if (tableHasServerSort(table)) {
    table.dataset.serverSort = '1';
    return;
  }
  const head = table.tHead?.rows?.[0];
  if (!head) return;
  ensureTableColIds(table);
  [...head.cells].forEach((th) => {
    const label = String(th.textContent || '')
      .replace(/[▾✕▲▼]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (!label || th.dataset.noSort === '1') return;
    th.dataset.sortLabel = label;
    th.classList.add('sortable');
    th.title = 'Сортировка';
    th.style.cursor = 'pointer';
  });
  table.dataset.clientSortBound = '1';
  head.addEventListener('click', (e) => {
    const th = e.target && e.target.closest && e.target.closest('th');
    if (!th || !head.contains(th)) return;
    if (th.dataset.noSort === '1' || !th.dataset.colId) return;
    if (e.target.closest && e.target.closest('input,button,a,.col-filter-pop,.col-settings')) return;
    e.preventDefault();
    e.stopPropagation();
    const colId = th.dataset.colId;
    const curCol = table.dataset.clientSortCol || '';
    const curDir = table.dataset.clientSortDir || 'asc';
    const nextDir = curCol === colId && curDir === 'asc' ? 'desc' : 'asc';
    // для дат по умолчанию сначала новые
    const firstDir = isDateColumn(th) ? 'desc' : 'asc';
    const dir = curCol === colId ? nextDir : firstDir;
    table.dataset.clientSortCol = colId;
    table.dataset.clientSortDir = dir;
    sortTableBodyByCol(table, colId, dir);
    // marks
    [...head.cells].forEach((h) => {
      h.classList.toggle('sorted', h.dataset.colId === colId);
      if (!h.dataset.sortLabel) return;
      const mark = h.dataset.colId === colId ? (dir === 'asc' ? ' ▲' : ' ▼') : '';
      // replace leading text node
      let textNode = [...h.childNodes].find((n) => n.nodeType === 3 && String(n.textContent || '').trim());
      if (!textNode) {
        textNode = document.createTextNode('');
        h.insertBefore(textNode, h.firstChild);
      }
      textNode.textContent = h.dataset.sortLabel + mark;
    });
  });
}

/** Скролл таблицы + иконки столбцов/вида на всех списках. */
function enhanceListTables(root = view) {
  if (!root) return;
  const body = root.querySelector('.form-body') || root;
  const tables = [...body.querySelectorAll('table')].filter((table) => {
    if (table.dataset.tableEnhanced === '1') return false;
    if (table.closest('.staff-modal, .create-lightbox, .col-settings-pop, .col-filter-pop, .suggest')) {
      return false;
    }
    const ths = table.tHead?.rows?.[0]?.cells;
    return !!(ths && ths.length >= 2);
  });

  tables.forEach((table, idx) => {
    table.dataset.tableEnhanced = '1';
    table.dataset.noColFilter = '1';

    let scrollWrap = table.parentElement;
    if (!scrollWrap?.classList.contains('table-scroll')) {
      scrollWrap = document.createElement('div');
      scrollWrap.className = 'table-scroll';
      table.parentNode.insertBefore(scrollWrap, table);
      scrollWrap.appendChild(table);
    }

    // сделки — своя панель столбцов
    if (table.classList.contains('deals-table')) return;

    table.classList.add('data-table');
    // снять устаревшие галочки-фильтры (кэш / старая сессия)
    [...(table.tHead?.rows?.[0]?.cells || [])].forEach((th) => {
      th.classList.remove('col-filter', 'filtered');
      if (th.dataset.filterBound) delete th.dataset.filterBound;
      th.querySelectorAll('.col-filter-pop').forEach((p) => p.remove());
    });
    const storeKey = table.dataset.tableKey || `${state.activeTab || 'list'}:t${idx}`;
    const { right } = ensureTableToolsBar(scrollWrap, storeKey);
    bindGenericTableTools(table, storeKey, right);
    applyTableColOrder(table, storeKey);
    applyTableColPrefs(table, storeKey);
    applyTableDense(table, storeKey);
    bindClientColumnSort(table);
  });
}

function ensureTableToolsBar(scrollWrap, storeKey) {
  let tools = scrollWrap.previousElementSibling;
  while (tools && tools.nodeType === 1 && !tools.classList?.contains('table-tools') && !tools.classList?.contains('pager')) {
    // products-cat-bar уже table-tools
    if (tools.classList?.contains('products-cat-bar')) break;
    tools = tools.previousElementSibling;
  }
  if (tools?.classList?.contains('pager')) {
    const bar = document.createElement('div');
    bar.className = 'table-tools';
    tools.parentNode.insertBefore(bar, tools);
    bar.appendChild(tools);
    tools = bar;
  }
  if (!tools?.classList?.contains('table-tools') && !tools?.classList?.contains('products-cat-bar')) {
    tools = document.createElement('div');
    tools.className = 'table-tools';
    scrollWrap.parentNode.insertBefore(tools, scrollWrap);
  }
  let right = tools.querySelector('.table-tools-right');
  if (!right) {
    right = document.createElement('div');
    right.className = 'table-tools-right';
    tools.appendChild(right);
  }
  if (right.dataset.tableToolsBound === storeKey) return { tools, right };
  right.dataset.tableToolsBound = storeKey;
  right.innerHTML = `
    <button type="button" class="table-tool-ico tbl-dense" data-tip="Сжатый вид · одна строка" aria-label="Сжатый вид">
      <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
        <path d="M2 4.5h12M2 8h12M2 11.5h12" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
      </svg>
    </button>
    <button type="button" class="table-tool-ico tbl-wrap" data-tip="Полный вид · с переносами" aria-label="Полный вид">
      <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
        <path d="M2 3.5h12M2 7h8M2 10.5h10M2 14h6" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
      </svg>
    </button>
    <div class="col-settings">
      <button type="button" class="table-tool-ico tbl-cols" data-tip="Столбцы" aria-label="Столбцы">
        <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
          <path d="M2.5 2.5h4v11h-4zM9.5 2.5h4v11h-4z" fill="none" stroke="currentColor" stroke-width="1.4"/>
        </svg>
      </button>
      <div class="col-settings-pop hidden"></div>
    </div>`;
  return { tools, right };
}

function bindGenericTableTools(table, storeKey, right) {
  const denseBtn = right.querySelector('.tbl-dense');
  const wrapBtn = right.querySelector('.tbl-wrap');
  const colsBtn = right.querySelector('.tbl-cols');
  const pop = right.querySelector('.col-settings-pop');
  const syncDenseBtns = () => {
    const dense = loadTableLayout(storeKey).dense !== false;
    denseBtn?.classList.toggle('active', dense);
    wrapBtn?.classList.toggle('active', !dense);
    if (denseBtn) denseBtn.setAttribute('aria-pressed', dense ? 'true' : 'false');
    if (wrapBtn) wrapBtn.setAttribute('aria-pressed', dense ? 'false' : 'true');
  };
  syncDenseBtns();
  if (denseBtn) {
    denseBtn.onclick = () => {
      saveTableLayout(storeKey, { dense: true });
      applyTableDense(table, storeKey);
      syncDenseBtns();
    };
  }
  if (wrapBtn) {
    wrapBtn.onclick = () => {
      saveTableLayout(storeKey, { dense: false });
      applyTableDense(table, storeKey);
      syncDenseBtns();
    };
  }
  if (colsBtn && pop) {
    colsBtn.onclick = (e) => {
      e.stopPropagation();
      if (!pop.classList.contains('hidden')) {
        pop.classList.add('hidden');
        return;
      }
      const prefs = loadTableColPrefs(storeKey);
      const meta = orderedTableColMeta(table, storeKey).filter((c) => !c.hideInSettings);
      pop.innerHTML =
        `<div class="col-settings-hint muted">Перетащите строки — порядок столбцов. «Дата» всегда первая.</div>` +
        meta
          .map(
            (c) => `<label class="col-settings-item ${c.locked ? 'locked' : ''}" ${
              c.isDate ? '' : 'draggable="true"'
            } data-col-id="${esc(c.id)}">
              <span class="col-drag" title="${c.isDate ? 'Дата закреплена первой' : 'Перетащить'}" aria-hidden="true">⋮⋮</span>
              <input type="checkbox" data-col-id="${esc(c.id)}" ${
              c.locked || prefs[c.id] !== false ? 'checked' : ''
            } ${c.locked ? 'disabled' : ''} />
              <span class="col-settings-label">${esc(c.label)}</span>
            </label>`
          )
          .join('');
      pop.querySelectorAll('input[data-col-id]').forEach((inp) => {
        inp.onchange = () => {
          const next = { ...loadTableColPrefs(storeKey) };
          next[inp.dataset.colId] = !!inp.checked;
          saveTableColPrefs(storeKey, next);
          applyTableColPrefs(table, storeKey);
        };
      });
      let dragColId = '';
      pop.querySelectorAll('.col-settings-item[data-col-id]').forEach((row) => {
        if (row.classList.contains('locked')) return;
        row.addEventListener('dragstart', (ev) => {
          dragColId = row.dataset.colId || '';
          row.classList.add('is-dragging');
          try {
            ev.dataTransfer.setData('text/plain', dragColId);
            ev.dataTransfer.effectAllowed = 'move';
          } catch (_) {
            /* ignore */
          }
        });
        row.addEventListener('dragend', () => {
          row.classList.remove('is-dragging');
          pop.querySelectorAll('.col-settings-item').forEach((el) => el.classList.remove('drag-over'));
          dragColId = '';
        });
        row.addEventListener('dragover', (ev) => {
          ev.preventDefault();
          ev.dataTransfer.dropEffect = 'move';
          const over = ev.currentTarget;
          if (!(over instanceof HTMLElement)) return;
          if (over.classList.contains('locked')) return;
          if (!dragColId || over.dataset.colId === dragColId) return;
          pop.querySelectorAll('.col-settings-item').forEach((el) => el.classList.remove('drag-over'));
          over.classList.add('drag-over');
        });
        row.addEventListener('dragleave', (ev) => {
          const over = ev.currentTarget;
          if (over instanceof HTMLElement) over.classList.remove('drag-over');
        });
        row.addEventListener('drop', (ev) => {
          ev.preventDefault();
          const target = ev.currentTarget;
          if (!(target instanceof HTMLElement) || target.classList.contains('locked')) return;
          target.classList.remove('drag-over');
          const fromId = dragColId || (ev.dataTransfer && ev.dataTransfer.getData('text/plain')) || '';
          const toId = target.dataset.colId || '';
          if (!fromId || !toId || fromId === toId) return;
          const metaNow = orderedTableColMeta(table, storeKey);
          const order = metaNow.map((c) => c.id);
          const from = order.indexOf(fromId);
          const to = order.indexOf(toId);
          if (from < 0 || to < 0) return;
          order.splice(from, 1);
          order.splice(to, 0, fromId);
          const pinned = pinDateColsFirst(order, metaNow);
          saveTableColOrder(storeKey, pinned);
          applyTableColOrder(table, storeKey);
          applyTableColPrefs(table, storeKey);
          // перерисовать попап с новым порядком
          pop.classList.add('hidden');
          colsBtn.click();
        });
      });
      pop.classList.remove('hidden');
    };
    if (!state._tableColsDocBound) {
      state._tableColsDocBound = true;
      document.addEventListener('click', (e) => {
        if (e.target?.closest?.('.col-settings')) return;
        document.querySelectorAll('.col-settings-pop').forEach((p) => p.classList.add('hidden'));
      });
    }
  }
}

/** Клиентские фильтры по клику на th — отключены (сортировка вместо галочек). */
const COL_FILTERS_STORE_KEY = 'wms.col-filters.v1';

function loadColFiltersStore() {
  try {
    const raw = localStorage.getItem(COL_FILTERS_STORE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (_) {
    return {};
  }
}

function saveColFilterValues(storeKey, label, values) {
  if (!storeKey || !label) return;
  const all = loadColFiltersStore();
  const bucket = all[storeKey] && typeof all[storeKey] === 'object' ? { ...all[storeKey] } : {};
  const list = Array.isArray(values) ? values.map(String).filter(Boolean) : [];
  if (!list.length) delete bucket[label];
  else bucket[label] = list;
  if (Object.keys(bucket).length) all[storeKey] = bucket;
  else delete all[storeKey];
  try {
    localStorage.setItem(COL_FILTERS_STORE_KEY, JSON.stringify(all));
  } catch (_) {
    /* ignore */
  }
}

function readColFilterValues(storeKey, label) {
  if (!storeKey || !label) return null;
  const bucket = loadColFiltersStore()[storeKey];
  if (!bucket || typeof bucket !== 'object') return null;
  const vals = bucket[label];
  return Array.isArray(vals) && vals.length ? vals.map(String) : null;
}

function bindColumnFilters(root = view) {
  // Отключено: на всех списках сортировка по клику на th + drag-and-drop столбцов.
  return;
  if (!root) return;

  const cellFilterText = (cell) => {
    if (!cell) return '';
    if (cell.dataset && cell.dataset.filterText != null && cell.dataset.filterText !== '') {
      return String(cell.dataset.filterText).replace(/\s+/g, ' ').trim();
    }
    // первая текстовая нода / без вложенных muted
    const first = cell.childNodes && cell.childNodes[0];
    if (first && first.nodeType === 3) {
      return String(first.textContent || '').replace(/\s+/g, ' ').trim();
    }
    if (first && first.nodeType === 1 && first.tagName !== 'DIV') {
      return String(first.textContent || '').replace(/\s+/g, ' ').trim();
    }
    return String(cell.textContent || '')
      .replace(/\s+/g, ' ')
      .trim();
  };

  const parseSelected = (raw) => {
    const s = String(raw || '').trim();
    if (!s) return null;
    try {
      const a = JSON.parse(s);
      if (Array.isArray(a)) return a.map(String);
    } catch (_) {
      /* single legacy value */
    }
    return [s];
  };

  root.querySelectorAll('.form-body table, table').forEach((table) => {
    if (!root.contains(table)) return;
    // только сортировка / свои фильтры — без галочек по значениям
    if (table.dataset.noColFilter === '1') return;
    const thead = table.tHead;
    const tbody = table.tBodies[0];
    if (!thead || !tbody || !thead.rows[0]) return;
    const headerRow = thead.rows[0];
    const storeKey =
      table.dataset.filterStore ||
      (state.activeTab === 'deals' || String(state.activeTab || '').startsWith('deal')
        ? 'deals'
        : state.activeTab || '');

    [...headerRow.cells].forEach((th, colIdx) => {
      if (th.dataset.filterBound === '1') return;
      // уже свой фильтр (категория и т.п.)
      if (th.querySelector('.col-filter-pop')) {
        th.dataset.filterBound = '1';
        return;
      }
      // сортируемые даты сделок — без фильтра-галочек, только sort
      if (th.classList.contains('sortable') || th.dataset.dealsSort) {
        th.dataset.filterBound = '1';
        return;
      }
      // заголовок «Сделка» с иконкой столбцов
      if (th.classList.contains('th-deal-name')) {
        th.dataset.filterBound = '1';
        return;
      }
      const raw = (th.textContent || '').replace(/[▾✕▲▼]/g, '').trim();
      if (!raw || raw === '—' || raw.length > 48) return;
      // пустая колонка действий
      if (/^[\s]*$/.test(raw)) return;

      th.dataset.filterBound = '1';
      th.dataset.filterLabel = raw;
      th.dataset.filterValue = '';
      th.classList.add('col-filter');
      th.title = 'Фильтр: ' + raw + ' — отметьте галочками, что показать';
      th.innerHTML = '';
      const labelNode = document.createTextNode(raw + ' ▾');
      th.appendChild(labelNode);
      const pop = document.createElement('div');
      pop.className = 'col-filter-pop hidden';
      th.appendChild(pop);

      const applyTableFilters = () => {
        const filters = [...headerRow.cells]
          .map((cell, i) => ({
            i,
            selected: parseSelected(cell.dataset.filterValue),
          }))
          .filter((f) => f.selected && f.selected.length);
        [...tbody.rows].forEach((tr) => {
          let ok = true;
          for (const f of filters) {
            const text = cellFilterText(tr.cells[f.i]).toLowerCase();
            const hit = f.selected.some((v) => text === String(v).toLowerCase());
            if (!hit) {
              ok = false;
              break;
            }
          }
          tr.hidden = !ok;
        });
      };

      const setFilter = (values, persist = true) => {
        const list = Array.isArray(values) ? values.map(String).filter(Boolean) : [];
        if (!list.length) {
          th.dataset.filterValue = '';
          th.classList.remove('filtered');
          labelNode.textContent = raw + ' ▾';
        } else {
          th.dataset.filterValue = JSON.stringify(list);
          th.classList.add('filtered');
          labelNode.textContent =
            list.length === 1 ? raw + ': ' + list[0] + ' ✕' : raw + ' (' + list.length + ') ✕';
        }
        if (persist) saveColFilterValues(storeKey, raw, list);
        applyTableFilters();
      };

      const openPop = () => {
        root.querySelectorAll('.col-filter-pop').forEach((p) => {
          if (p !== pop) p.classList.add('hidden');
        });
        const selected = parseSelected(th.dataset.filterValue);
        const uniq = new Map();
        [...tbody.rows].forEach((tr) => {
          const t = cellFilterText(tr.cells[colIdx]);
          if (!t || t === '—') return;
          uniq.set(t, (uniq.get(t) || 0) + 1);
        });
        const values = [...uniq.entries()]
          .sort((a, b) => a[0].localeCompare(b[0], 'ru'))
          .slice(0, 120);

        pop.innerHTML = '';
        pop.onclick = (e) => e.stopPropagation();

        const input = document.createElement('input');
        input.type = 'search';
        input.placeholder = 'Найти в списке…';
        input.autocomplete = 'off';
        input.onclick = (e) => e.stopPropagation();

        const actions = document.createElement('div');
        actions.className = 'col-filter-actions';

        const mkAction = (text, fn) => {
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'col-filter-item';
          btn.textContent = text;
          btn.onclick = (e) => {
            e.stopPropagation();
            fn();
          };
          return btn;
        };

        const list = document.createElement('div');
        list.className = 'col-filter-list';

        const syncLabel = () => {
          const boxes = [...list.querySelectorAll('input[type="checkbox"]')];
          const checked = boxes.filter((b) => b.checked).map((b) => b.value);
          if (!checked.length || checked.length === boxes.length) setFilter([]);
          else setFilter(checked);
        };

        values.forEach(([val, cnt]) => {
          const lab = document.createElement('label');
          lab.className = 'col-filter-check';
          const cb = document.createElement('input');
          cb.type = 'checkbox';
          cb.value = val;
          cb.checked = !selected || selected.some((s) => s.toLowerCase() === val.toLowerCase());
          cb.onclick = (e) => e.stopPropagation();
          cb.onchange = (e) => {
            e.stopPropagation();
            syncLabel();
          };
          const span = document.createElement('span');
          span.textContent = val + (cnt > 1 ? ' (' + cnt + ')' : '');
          span.title = val;
          lab.appendChild(cb);
          lab.appendChild(span);
          list.appendChild(lab);
        });

        actions.appendChild(
          mkAction('Все', () => {
            list.querySelectorAll('input[type="checkbox"]').forEach((b) => {
              b.checked = true;
            });
            setFilter([]);
          })
        );
        actions.appendChild(
          mkAction('Сбросить', () => {
            list.querySelectorAll('input[type="checkbox"]').forEach((b) => {
              b.checked = true;
            });
            setFilter([]);
            pop.classList.add('hidden');
          })
        );

        input.oninput = () => {
          const q = input.value.trim().toLowerCase();
          list.querySelectorAll('.col-filter-check').forEach((lab) => {
            const t = (lab.textContent || '').toLowerCase();
            lab.hidden = !!q && !t.includes(q);
          });
        };
        input.onkeydown = (e) => {
          e.stopPropagation();
          if (e.key === 'Escape') pop.classList.add('hidden');
        };

        pop.appendChild(input);
        pop.appendChild(actions);
        pop.appendChild(list);
        pop.classList.remove('hidden');
        setTimeout(() => input.focus(), 0);
      };

      th.addEventListener('click', (e) => {
        e.stopPropagation();
        if (e.target && e.target.closest && e.target.closest('.col-filter-pop')) return;
        if (!pop.classList.contains('hidden')) {
          pop.classList.add('hidden');
          return;
        }
        openPop();
      });

      const restored = readColFilterValues(storeKey, raw);
      if (restored && restored.length) setFilter(restored, false);
    });
  });

  if (!state._colFilterDocBound) {
    state._colFilterDocBound = true;
    document.addEventListener('click', (e) => {
      const t = e.target;
      if (t && t.closest && t.closest('th.col-filter')) return;
      document.querySelectorAll('.col-filter-pop').forEach((p) => p.classList.add('hidden'));
    });
  }
}


function openTab(id, title, opts) {
  clearFloatFormDock();
  const rawId = String(id || '');
  const forceNew = !!(opts && opts.newTab);
  let t = title != null && String(title).trim() ? String(title).trim() : '';
  // Не оставлять сырой id вкладки (deal:123 / product:uuid) как подпись
  if (!t || t === rawId || /^(product|deal|history|structure|doc|company|sales|serial|xfer):/i.test(t)) {
    t = '';
  }
  if (!t) t = VIEW_TITLES[rawId] || '';
  if (!t) {
    if (rawId.startsWith('product:')) t = 'Товар…';
    else if (rawId.startsWith('deal:')) t = 'Заказ №' + rawId.slice(5);
    else if (rawId.startsWith('history:')) t = 'История · ' + rawId.slice('history:'.length);
    else if (rawId.startsWith('structure:')) t = 'Структура · ' + rawId.slice('structure:'.length);
    else if (rawId.startsWith('doc:')) t = 'Документ…';
    else if (rawId.startsWith('company:')) t = 'Контрагент…';
    else if (rawId.startsWith('sales:')) t = 'Продажа…';
    else if (rawId.startsWith('prep:')) {
      const act = rawId.split(':')[1] || '';
      t =
        act === 'upd-ship'
          ? 'Расходные · подготовка'
          : (SALES_TYPE_TAB[act] || act) + ' · подготовка';
    }
    else if (rawId.startsWith('xfer:')) t = 'Заказ на перемещение…';
    else if (rawId.startsWith('serial:')) t = 'Марка…';
    else if (rawId.startsWith('scratch:')) t = 'Новая';
    else t = rawId;
  }
  t = String(t).slice(0, 48);
  // Меню «Организации» без deep-link — список, не карточка
  if (rawId === 'organizations' && !suppressUrlSync) {
    state.orgCompanyId = '';
  }
  if (rawId === 'staff' && !suppressUrlSync) {
    state.staffFocusId = '';
    state.staffCardTab = 'role';
  }
  // Начальная — экран раздела, не вкладка
  if (rawId === 'dashboard') {
    state.tabs = state.tabs.filter((x) => x.id !== 'dashboard');
    state.activeTab = 'dashboard';
    renderTabs();
    showForm();
    highlightSection(sectionForTab(rawId));
    setUrl(pathForTab(rawId));
    const runHome = routes.dashboard;
    if (runHome) runHome();
    return;
  }
  const existing = state.tabs.find((x) => x.id === rawId);
  if (existing) {
    // Уже открыта — просто переключаемся (без дубля)
    const prev = String(existing.title || '');
    if (
      title ||
      !prev ||
      prev === rawId ||
      /^(product|deal|history|doc|company|sales|serial):/i.test(prev) ||
      /…$/.test(prev)
    ) {
      existing.title = t;
    }
    state.activeTab = rawId;
  } else if (
    forceNew ||
    !state.tabs.length ||
    !state.activeTab ||
    state.activeTab === 'dashboard' ||
    String(state.activeTab).startsWith('scratch:')
  ) {
    state.tabs.push({ id: rawId, title: t, closable: true });
    state.activeTab = rawId;
  } else {
    // Обычный переход по меню: меняем содержимое текущей вкладки, не плодим новые
    const cur = state.tabs.find((x) => x.id === state.activeTab);
    if (cur) {
      cur.id = rawId;
      cur.title = t;
      state.activeTab = rawId;
    } else {
      state.tabs.push({ id: rawId, title: t, closable: true });
      state.activeTab = rawId;
    }
  }
  renderTabs();
  showForm();
  highlightSection(sectionForTab(rawId));
  setUrl(pathForTab(rawId));
  if (rawId.startsWith('scratch:')) {
    const sec = state.section || 'home';
    showSectionPanel();
    renderSectionMenu(sec);
    return;
  }
  if (rawId.startsWith('product:')) {
    renderProductDetail(rawId.slice('product:'.length));
    return;
  }
  if (rawId.startsWith('company:')) {
    const pageTab = state.cpDetailTab || 'main';
    state.cpDetailTab = 'main';
    renderCounterpartyDetail(rawId.slice('company:'.length), pageTab);
    return;
  }
  if (rawId.startsWith('doc:')) {
    renderDocDetail(rawId.slice('doc:'.length));
    return;
  }
  if (rawId.startsWith('deal:')) {
    renderDealDetail(rawId.slice('deal:'.length));
    return;
  }
  if (rawId.startsWith('history:')) {
    renderDealOrderHistory(rawId.slice('history:'.length));
    return;
  }
  if (rawId.startsWith('structure:')) {
    renderDealOrderStructure(rawId.slice('structure:'.length));
    return;
  }
  if (rawId.startsWith('sales:')) {
    renderSalesDocDetail(rawId.slice('sales:'.length));
    return;
  }
  if (rawId.startsWith('prep:')) {
    // prep:upd:DEALID | prep:upd-ship:DEALID
    const parts = rawId.split(':');
    const action = parts[1] || '';
    const dealId = parts.slice(2).join(':');
    renderSalesDocCreatePrep(dealId, action);
    return;
  }
  if (rawId.startsWith('xfer:')) {
    renderTransferOrderDetail(rawId.slice('xfer:'.length));
    return;
  }
  if (rawId.startsWith('serial:')) {
    renderSerialTrace(rawId.slice('serial:'.length));
    return;
  }
  const run = routes[rawId];
  if (run) run();
}

function closeTab(id) {
  if (id === 'dashboard') {
    state.activeTab = '';
    renderTabs();
    showSection('home');
    return;
  }
  const idx = state.tabs.findIndex((t) => t.id === id);
  if (idx < 0) return;
  state.tabs.splice(idx, 1);
  if (state.activeTab === id) {
    const next = state.tabs[Math.max(0, idx - 1)] || state.tabs[0];
    if (next) {
      openTab(next.id, next.title);
      return;
    }
    openTab('dashboard');
    return;
  }
  renderTabs();
}

/** Раздел по пути экрана (если нет TAB_SECTION_MAP). */
function sectionFromPath(path) {
  const p = String(path || '');
  if (p === '/' || p === '/home-todos' || p === '/ops' || p.startsWith('/kpi/')) return 'home';
  if (p.startsWith('/crm') || p.startsWith('/deals') || p.startsWith('/pipelines') || p.startsWith('/counterparties'))
    return 'crm';
  if (p.startsWith('/sales') || p.startsWith('/buyers')) return 'sales';
  if (
    p.startsWith('/documents') ||
    p.startsWith('/docs') ||
    p.startsWith('/invoices') ||
    p.startsWith('/upd') ||
    p.startsWith('/sf') ||
    p.startsWith('/workorders') ||
    p.startsWith('/contracts') ||
    p.startsWith('/sales-docs')
  )
    return 'documents';
  if (p.startsWith('/purchases') || p === '/in' || p.startsWith('/in/') || p.startsWith('/suppliers')) return 'purchases';
  if (
    p.startsWith('/warehouse') ||
    p.startsWith('/stock') ||
    p.startsWith('/media') ||
    p.startsWith('/products') ||
    p.startsWith('/categories') ||
    p.startsWith('/props') ||
    p.startsWith('/marks') ||
    p.startsWith('/brands') ||
    p.startsWith('/balances') ||
    p.startsWith('/warehouses') ||
    p.startsWith('/marking') ||
    p === '/pick' ||
    p.startsWith('/pick') ||
    p === '/photo' ||
    p.startsWith('/photo')
  )
    return 'warehouse';
  if (
    p === '/lift' ||
    p.startsWith('/lift') ||
    p === '/reception' ||
    p.startsWith('/reception') ||
    p.startsWith('/sto/') ||
    p.startsWith('/works')
  )
    return 'works';
  if (p.startsWith('/production')) return 'production';
  if (p.startsWith('/kassa')) return 'kassa';
  if (
    p.startsWith('/cash') ||
    p === '/cash-registers' ||
    p.startsWith('/cash-registers') ||
    p === '/cash-book' ||
    p.startsWith('/cash-book') ||
    p === '/cash-articles' ||
    p.startsWith('/cash-articles')
  )
    return 'kassa';
  if (
    p.startsWith('/money') ||
    p.startsWith('/bank') ||
    p.startsWith('/payment') ||
    p.startsWith('/card-ops') ||
    p.startsWith('/currencies') ||
    p.startsWith('/income')
  )
    return 'money';
  if (
    p.startsWith('/staff') ||
    p.startsWith('/persons') ||
    p.startsWith('/job-titles') ||
    p.startsWith('/work-schedules') ||
    p.startsWith('/work-shifts') ||
    p.startsWith('/time-kinds') ||
    p.startsWith('/hr-docs') ||
    p.startsWith('/personnel')
  )
    return 'staff';
  if (p.startsWith('/chats')) return 'chats';
  if (
    p.startsWith('/company') ||
    p.startsWith('/organizations') ||
    p.startsWith('/org') ||
    p.startsWith('/departments') ||
    p.startsWith('/dicts') ||
    p.startsWith('/bank-accounts')
  )
    return 'company';
  if (p.startsWith('/settings') || p.startsWith('/audit') || p.startsWith('/presence') || p === '/pay' || p.startsWith('/pay'))
    return 'settings';
  if (p.startsWith('/ideas')) return 'ideas';
  if (p.startsWith('/help') || p.startsWith('/login') || p.startsWith('/brandbook')) return 'help';
  return 'help';
}

function renderSectionMenu(section) {
  const cfg = SECTIONS[section];
  if (!cfg && section !== 'help') return;

  if (section === 'help') {
    sectionPanel.innerHTML = `
      <div class="help-role-cards help-role-cards--solo" aria-label="Рабочие экраны">
        <a class="help-role-card" href="/pick" target="_blank" rel="noopener">
          <span class="help-role-ico" aria-hidden="true">Сб</span>
          <span class="help-role-title">Экран кладовщика</span>
          <span class="help-role-desc">Сборка заказов и задачи на сегодня</span>
          <span class="help-role-go">uchetn1.ru/pick →</span>
        </a>
        <a class="help-role-card" href="/photo" target="_blank" rel="noopener">
          <span class="help-role-ico" aria-hidden="true">Фо</span>
          <span class="help-role-title">Экран фотографа</span>
          <span class="help-role-desc">Очередь номенклатуры без фото</span>
          <span class="help-role-go">uchetn1.ru/photo →</span>
        </a>
      </div>`;
    return;
  }

  const pickerOnly = !!(state.me && state.me.picker_only);
  const cols =
    pickerOnly && section === 'warehouse'
      ? [
          [
            {
              title: 'Склад',
              links: [{ label: 'Задачи на сегодня', href: '/pick' }],
            },
          ],
        ]
      : (cfg && cfg.cols) || [];
  const secLabel =
    (typeof SECTION_LABELS !== 'undefined' && SECTION_LABELS[section]) || section;
  sectionPanel.innerHTML = `
    <div class="section-panel-head">
      <nav class="form-crumbs section-crumbs" aria-label="Путь">
        <span class="crumb-current">${esc(secLabel)}</span>
      </nav>
      <div class="section-search">
        <input type="search" placeholder="Поиск по экранам" id="sec-q" />
      </div>
    </div>
    <div class="section-cols">
      ${cols
        .map(
          (col) => `
        <div>
          ${col
            .map(
              (g) => `
            <div class="section-group">
              <h3>${esc(g.title)}</h3>
              ${g.links
                .filter((l) => menuLinkAllowed(l))
                .map((l) => {
                  if (l.href) {
                    return `<a class="section-link" href="${esc(l.href)}">${esc(l.label)}</a>`;
                  }
                  if (l.external) {
                    return `<a class="section-link" href="${esc(l.external)}" target="_blank" rel="noopener">${esc(l.label)}</a>`;
                  }
                  if (l.disabled || !l.view) {
                    return `<span class="section-link disabled">${esc(l.label)}</span>`;
                  }
                  const href = pathForTab(l.view);
                  const extras = [];
                  if (l.kassaTab) extras.push(`data-kassa-tab="${esc(l.kassaTab)}"`);
                  if (l.whHubTab) extras.push(`data-wh-hub-tab="${esc(l.whHubTab)}"`);
                  const extra = extras.length ? ' ' + extras.join(' ') : '';
                  return `<a class="section-link" href="${esc(href)}" data-view="${esc(l.view)}"${extra}>${esc(l.label)}</a>`;
                })
                .join('')}
            </div>`
            )
            .join('')}
        </div>`
        )
        .join('')}
    </div>`;
  sectionPanel.querySelectorAll('[data-view]').forEach((btn) => {
    btn.onclick = (e) => {
      if (e.metaKey || e.ctrlKey) {
        e.preventDefault();
        if (btn.dataset.kassaTab) state.kassaTab = btn.dataset.kassaTab;
        if (btn.dataset.whHubTab) state.whHubTab = btn.dataset.whHubTab;
        openTab(btn.dataset.view, undefined, { newTab: true });
        return;
      }
      if (e.shiftKey || e.altKey) return;
      e.preventDefault();
      if (btn.dataset.kassaTab) state.kassaTab = btn.dataset.kassaTab;
      if (btn.dataset.whHubTab) state.whHubTab = btn.dataset.whHubTab;
      openTab(btn.dataset.view);
    };
  });
  const qEl = document.getElementById('sec-q');
  if (qEl) {
    qEl.oninput = () => {
      const q = (qEl.value || '').trim().toLowerCase();
      sectionPanel.querySelectorAll('.section-group').forEach((g) => {
        let any = false;
        g.querySelectorAll('.section-link').forEach((a) => {
          const ok = !q || (a.textContent || '').toLowerCase().includes(q);
          a.style.display = ok ? '' : 'none';
          if (ok) any = true;
        });
        g.style.display = any ? '' : 'none';
      });
    };
  }
}

function showSection(section) {
  if (!canAccessSectionMe(section)) {
    const fallback = ['home', 'warehouse', 'crm', 'sales', 'help'].find((s) => canAccessSectionMe(s)) || 'home';
    if (section !== fallback) {
      showSection(fallback);
      return;
    }
  }
  highlightSection(section);
  if (section === 'warehouse' && state.me && state.me.picker_only) {
    location.href = '/pick';
    return;
  }
  if (section === 'money') {
    showSectionPanel();
    renderSectionMenu(section);
    return;
  }
  const landing = SECTION_LANDING[section];
  if (landing) {
    openTab(landing);
    return;
  }
  setUrl(pathForSection(section));
  showSectionPanel();
  renderSectionMenu(section);
}

/* —— Views —— */

async function renderDashboard() {
  state.activeTab = 'dashboard';
  state.tabs = state.tabs.filter((t) => t.id !== 'dashboard');
  renderTabs();
  showForm();
  view.innerHTML = formChrome(
    'Начальная страница',
    `<p class="muted" style="margin:0;padding:8px 0">Пока пусто.</p>`,
    { closable: true }
  );
  bindFormChrome(() => showSection('home'));
}

/** Техстаты каталога / S3 / диска + кнопки синка — раздел Настройки. */
async function renderSettingsStats() {
  showForm();
  view.innerHTML = '<p class="muted" style="padding:16px">Загрузка состояния…</p>';
  const s = await api('/stats');
  const hs = s.hs || {};
  const media = s.media || {};
  const disk = s.disk || {};
  const diskTitle = disk.total_human
    ? `Сервер ${disk.path || '/'}: свободно ${disk.free_human} из ${disk.total_human} (${disk.free_pct}% free)`
    : '';
  const s3Title = disk.s3_quota_human
    ? `S3 квота ${disk.s3_quota_human}, фото заняли ${disk.media_human}, свободно ~${disk.s3_free_human}`
    : `Объём фото в S3 (по БД): ${disk.media_human || '—'}`;
  view.innerHTML = formChrome(
    'Состояние и синк',
    `
    <div class="home-stats">
      <span>Номенклатура<b>${s.products}</b></span>
      <span>Применимости<b>${hs.applicability ?? 0}</b></span>
      <span>Характеристики<b>${hs.properties ?? 0}</b></span>
      <span>Цены<b>${hs.prices ?? 0}</b></span>
      <span>Остатки 1С<b>${hs.rests ?? 0}</b></span>
      <span title="${esc(s3Title)}">Фото S3<b>${media.images ?? 0}</b></span>
      <span title="${esc(s3Title)}">S3 фото<b>${esc(disk.media_human || '—')}</b></span>
      <span title="${esc(diskTitle)}">Диск свободно<b>${esc(disk.free_human || '—')}</b></span>
      ${
        disk.s3_quota_human
          ? `<span title="${esc(s3Title)}">S3 свободно<b>${esc(disk.s3_free_human || '—')}</b></span>`
          : ''
      }
      <span>Ориентация фото<b>${media.withOrientation ?? 0}</b></span>
      <span>Документы 1С<b>${(s.docs1c && s.docs1c.docs) || 0}</b></span>
      <span>Сделки Amo<b>${(s.crm && s.crm.deals) || 0}</b></span>
    </div>
    <div class="panel" style="margin-top:12px">
      <div class="toolbar">
        <button class="primary" type="button" id="sync-odata">Справочники (OData)</button>
        <button type="button" id="sync-hs" ${hs.configured ? '' : 'disabled'}>Полный HS (1в1)</button>
        <button type="button" id="sync-prices" ${hs.configured ? '' : 'disabled'}>Только цены</button>
        <button type="button" id="sync-rests" ${hs.configured ? '' : 'disabled'}>Только остатки</button>
        <button type="button" id="sync-docs">Документы 1С (приход+расход)</button>
        <button type="button" id="sync-dicts">Словари</button>
        <button type="button" id="sync-media" ${media.configured ? '' : 'disabled'}>Фото S3 (+100)</button>
        <button type="button" id="sync-orient" ${media.configured ? '' : 'disabled'}>Ориентация фото (+300)</button>
        <button type="button" id="sync-deals">Сделки Amo (+800)</button>
      </div>
      <p class="muted" id="sync-msg" style="margin:10px 0 0">
        Применимостей: ${hs.applicability ?? 0} · свойств: ${hs.properties ?? 0} ·
        цен: ${hs.prices ?? 0} · остатков: ${hs.rests ?? 0} · сотрудников: ${hs.employees ?? 0}
        ${hs.lastSync ? ' · HS: ' + esc(hs.lastSync) : ''}
        ${hs.restsSync ? ' · rests: ' + esc(hs.restsSync) : ''}
      </p>
    </div>`,
    { closable: true }
  );
  bindFormChrome(() => showSection('settings'));
  bindSettingsSyncButtons();
}

function bindSettingsSyncButtons() {
  const reload = () => setTimeout(() => renderSettingsStats(), 600);
  const wire = (id, run) => {
    const btn = document.getElementById(id);
    if (!btn) return;
    btn.onclick = async () => {
      const msg = document.getElementById('sync-msg');
      btn.disabled = true;
      try {
        await run(msg, btn);
      } catch (e) {
        if (msg) msg.textContent = e.message;
      } finally {
        btn.disabled = false;
      }
    };
  };
  wire('sync-odata', async (msg) => {
    msg.textContent = 'Загрузка из 1С…';
    const r = await api('/sync/odata', { method: 'POST' });
    let text =
      `OData ${r.seconds}с: складов ${r.warehouses}, категорий ${r.categories}, ` +
      `номенклатура ${r.products}, контрагенты ${r.counterparties}`;
    if (r.hs) {
      text += ` · HS ${r.hs.seconds}с: применимостей ${r.hs.applicability}, характеристик ${r.hs.properties}`;
    }
    if (r.hsError) text += ` · HS ошибка: ${r.hsError}`;
    msg.textContent = text;
    reload();
  });
  wire('sync-hs', async (msg) => {
    msg.textContent = 'Полный HS 1в1: товары, применимости, свойства, цены, остатки… это может занять несколько минут';
    const r = await api('/sync/hs', { method: 'POST' });
    msg.textContent =
      `HS ${r.seconds}с: товаров ${r.productsUpserted}, применимостей ${r.applicability}, ` +
      `свойств ${r.properties}, цен ${r.prices}, остатков ${r.restRows}, ` +
      `складов ${r.stores}, категорий ${r.categories}, сотрудников ${r.employees}`;
    reload();
  });
  wire('sync-prices', async (msg) => {
    msg.textContent = 'Загрузка цен…';
    const r = await api('/sync/prices', { method: 'POST' });
    msg.textContent =
      `Цены за ${r.seconds}с: строк ${r.prices}, типов ${(r.dictionaries || {}).priceTypes ?? '—'}`;
    reload();
  });
  wire('sync-rests', async (msg) => {
    msg.textContent = 'Get/Rests по складам…';
    const r = await api('/sync/rests', { method: 'POST' });
    msg.textContent = `Остатки за ${r.seconds}с: строк ${r.restRows}, складов ${r.warehouses}`;
    reload();
  });
  wire('sync-docs', async (msg) => {
    msg.textContent =
      'Загрузка приходных и расходных из 1С… это может занять 30–60 мин, остатки не пересчитываются';
    const r = await api('/sync/docs', {
      method: 'POST',
      body: JSON.stringify({ kinds: ['in', 'out'] }),
    });
    let text =
      `Документы ${r.seconds}с: приход ${r.inHeaders} (${r.inLines} стр.), ` +
      `расход ${r.outHeaders} (${r.outLines} стр.), пропуск строк ${r.skippedLines}`;
    if (r.order_chain_odata?.missing?.length > 1) {
      text += ' · заказ/перемещения/карты в OData не опубликованы — цепочка в Учёте №1';
    }
    msg.textContent = text;
    reload();
  });
  wire('sync-dicts', async (msg) => {
    msg.textContent = 'Сборка словарей…';
    const r = await api('/sync/dicts', { method: 'POST' });
    msg.textContent =
      `Словари: свойств ${r.properties}, значений ${r.propertyValues}, ` +
      `марок ${r.marks}, моделей ${r.models}, брендов ${r.brands}`;
    reload();
  });
  wire('sync-media', async (msg) => {
    msg.textContent = 'Загрузка фото в S3…';
    const r = await api('/sync/media', { method: 'POST', body: JSON.stringify({ limit: 100 }) });
    msg.textContent = `Фото: загружено ${r.uploaded}, пропуск ${r.skipped}, ошибок ${r.failed} (${r.seconds}с)`;
    reload();
  });
  wire('sync-orient', async (msg) => {
    msg.textContent = 'Ориентация фото…';
    const r = await api('/sync/media-orient', {
      method: 'POST',
      body: JSON.stringify({ limit: 300 }),
    });
    msg.textContent =
      `Ориентация: проверено ${r.checked}, обновлено ${r.updated}, ошибок ${r.failed}, осталось ${r.left} (${r.seconds}с)`;
    reload();
  });
  wire('sync-deals', async (msg) => {
    msg.textContent = 'Загрузка воронок и сделок из AmoCRM (через amo1c)… 1–3 мин';
    const r = await api('/crm/deals/sync', {
      method: 'POST',
      body: JSON.stringify({ days: 60, limit: 800 }),
    });
    msg.textContent =
      `Сделки Amo за ${r.seconds}с: воронок ${r.pipelines}, сделок ${r.deals}, с данными Amo ${r.withAmo}`;
    reload();
  });
}

function renderAppRowHtml(a, idx, appMarks, appCombos) {
  const mark = a.mark || '';
  const model = a.model || a.only_model || '';
  const generation = a.generation || '';
  const years = a.years || '';
  const markList = appMarks.includes(mark) ? appMarks : mark ? [mark, ...appMarks] : appMarks;
  const modelList = uniqueAppField(appCombos, 'model', { mark });
  if (model && !modelList.includes(model)) modelList.unshift(model);
  const genList = uniqueAppField(appCombos, 'generation', { mark, model });
  if (generation && !genList.includes(generation)) genList.unshift(generation);
  const yearList = uniqueAppField(appCombos, 'years', { mark, model, generation });
  if (years && !yearList.includes(years)) yearList.unshift(years);
  const blank = (list, cur, placeholder) => {
    const opts = list.length ? list : cur ? [cur] : [];
    const head = `<option value="">${esc(placeholder || '—')}</option>`;
    return (
      head +
      opts
        .map((v) => `<option value="${esc(v)}" ${v === cur ? 'selected' : ''}>${esc(v)}</option>`)
        .join('')
    );
  };
  return `<tr data-app-idx="${esc(idx)}" data-app-id="${esc(a.id || '')}">
    <td><select class="pe-app" data-field="mark" style="width:100%">${blank(markList, mark, 'Марка…')}</select></td>
    <td><select class="pe-app" data-field="model" style="width:100%">${blank(modelList, model, 'Модель…')}</select></td>
    <td><select class="pe-app" data-field="generation" style="width:100%">${blank(genList, generation, 'Поколение…')}</select></td>
    <td><select class="pe-app" data-field="years" style="width:100%">${blank(yearList, years, 'Годы…')}</select></td>
    <td class="col-actions"><button type="button" class="table-tool-ico pe-app-del" title="Удалить строку" data-tip="Удалить" aria-label="Удалить строку"><svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M3.5 4.5h9M6.2 4.5V3.2c0-.4.3-.7.7-.7h2.2c.4 0 .7.3.7.7v1.3M5 4.5l.5 8.2c0 .4.4.8.8.8h3.4c.4 0 .8-.4.8-.8L11 4.5M7 7v4.5M9 7v4.5" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg></button></td>
  </tr>`;
}

function uniqueAppField(combos, field, filter = {}) {
  const out = [];
  const seen = new Set();
  for (const row of combos) {
    if (filter.mark != null && filter.mark !== '' && row.mark !== filter.mark) continue;
    if (filter.model != null && filter.model !== '' && row.model !== filter.model) continue;
    if (filter.generation != null && filter.generation !== '' && row.generation !== filter.generation) {
      continue;
    }
    const v = row[field] || '';
    if (!v || seen.has(v)) continue;
    seen.add(v);
    out.push(v);
  }
  return out;
}

function fillSelectOptions(sel, values, current) {
  const list = Array.isArray(values) ? [...values] : [];
  if (current && !list.includes(current)) list.unshift(current);
  sel.innerHTML = list
    .map((v) => `<option value="${esc(v)}" ${v === current ? 'selected' : ''}>${esc(v)}</option>`)
    .join('');
  if (current) sel.value = current;
}

async function renderProductDetail(id) {
  await refreshRefs();
  const [p, brands, unitsData, catTree] = await Promise.all([
    api('/products/' + id),
    api('/dicts/brands').catch(() => []),
    api('/products/' + id + '/units').catch(() => ({ items: [], total: 0, status_labels: {} })),
    state.productsCatTree
      ? Promise.resolve(state.productsCatTree)
      : api('/categories/tree').catch(() => ({ roots: [], uncategorized: 0 })),
  ]);
  state.productsCatTree = catTree;
  const catRoots = catTree.roots || [];
  const props = p.properties || [];
  const apps = p.applicability || [];
  const unitItems = unitsData.items || [];
  const unitStatusRu = unitsData.status_labels || {
    in_stock: 'На складе',
    reserved: 'Резерв',
    sold: 'Списан / отгружен',
    written_off: 'Списан',
  };
  const appOpts = p.applicability_options || { marks: [], combos: [] };
  const appCombos = Array.isArray(appOpts.combos) ? appOpts.combos : [];
  const appMarks = Array.isArray(appOpts.marks) ? appOpts.marks : [];
  const prices = p.prices || [];
  const rests = p.rests || [];
  const related = p.related || [];
  const media = p.media || [];
  const images = media.filter((m) => m.kind === 'image');
  const docs = media.filter((m) => m.kind !== 'image');
  const title = String(productTitle(p) || p.sku || 'Товар').slice(0, 48);
  const editable = canEditProducts();
  const priceEdit = canEditPrices();
  const syncOk = canSync1c();
  if (p.category_id && !state.categories.some((c) => c.id === p.category_id)) {
    state.categories = [
      { id: p.category_id, name: p.category || p.category_id },
      ...state.categories,
    ];
  }
  const catPickHtml = categoryPickHtml(catRoots, p.category_id || '', {
    root: 'pe-cat-root',
    sub: 'pe-cat-sub',
  });
  const brandNames = (Array.isArray(brands) ? brands : [])
    .map((b) => String(b.name || '').trim())
    .filter(Boolean);
  const curBrand = String(p.brand || '').trim();
  if (curBrand && !brandNames.includes(curBrand)) brandNames.unshift(curBrand);
  const brandOpts =
    '<option value="">—</option>' +
    brandNames
      .map(
        (name) =>
          `<option value="${esc(name)}" ${name === curBrand ? 'selected' : ''}>${esc(name)}</option>`
      )
      .join('');
  const tabId = 'product:' + id;
  let tab = state.tabs.find((t) => t.id === tabId);
  if (!tab) {
    tab = { id: tabId, title, closable: true };
    state.tabs.push(tab);
  } else {
    tab.title = title;
  }
  state.activeTab = tabId;
  renderTabs();
  showForm();
  highlightSection(sectionForTab(tabId));
  setUrl(pathForTab(tabId));
  const h3 = (label) =>
    `<h3 class="product-pane-title">${label}</h3>`;
  const editBlock = editable
    ? `
    ${h3(String(p.item_kind) === 'service' ? 'Карточка услуги' : 'Карточка товара')}
    <div class="form-grid" id="pe-card-grid">
      <label>Вид<select id="pe-kind"><option value="product" ${String(p.item_kind || 'product') !== 'service' ? 'selected' : ''}>Товар</option><option value="service" ${String(p.item_kind) === 'service' ? 'selected' : ''}>Услуга</option></select></label>
      <label class="pe-check"><input type="checkbox" id="pe-onsite" ${!Number(p.notupload) ? 'checked' : ''} /> Грузить на сайт</label>
      <label>Название<input id="pe-name" value="${esc(p.name || '')}" /></label>
      <label data-product-only>Артикул<input id="pe-sku" class="mono" value="${esc(p.sku || '')}" /></label>
      <label>Код<input id="pe-code" class="mono" value="${esc(p.code || '')}" /></label>
      <label data-product-only>Бренд<select id="pe-brand">${brandOpts}</select></label>
      ${catPickHtml}
      <label data-product-only>Аналоги SKU<input id="pe-array" value="${esc(p.array_sku || '')}" /></label>
      <label>Статус<span class="muted" style="display:block;margin-top:6px">${
        p.is_active
          ? '<span class="badge">Активен</span>'
          : '<span class="badge draft">Архив</span>'
      }</span></label>
      <label data-product-only>Упак. ширина, см<input id="pe-pw" type="number" step="any" value="${p.package_width_cm != null ? esc(p.package_width_cm) : ''}" /></label>
      <label data-product-only>Упак. высота, см<input id="pe-ph" type="number" step="any" value="${p.package_height_cm != null ? esc(p.package_height_cm) : ''}" /></label>
      <label data-product-only>Упак. длина, см<input id="pe-pl" type="number" step="any" value="${p.package_length_cm != null ? esc(p.package_length_cm) : ''}" /></label>
      <label data-product-only>Вес, г<input id="pe-pwg" type="number" step="any" value="${p.package_weight_g != null ? esc(p.package_weight_g) : ''}" /></label>
      <label data-product-only>GTIN<input id="pe-gtin" class="mono" value="${esc(p.gtin || '')}" placeholder="01…" /></label>
      <label data-product-only>Честный знак<select id="pe-marking"><option value="0" ${!p.requires_marking ? 'selected' : ''}>Нет</option><option value="1" ${p.requires_marking ? 'selected' : ''}>Да, маркировка</option></select></label>
      <label data-product-only>Серийный учёт<select id="pe-serial"><option value="0" ${!p.serial_tracked ? 'selected' : ''}>Нет (только количество)</option><option value="1" ${p.serial_tracked ? 'selected' : ''}>Да — уникальный номер на штуку</option></select></label>
    </div>
    <div class="toolbar">
      <button class="primary" type="button" id="pe-save">Сохранить</button>
      ${
        p.can_delete
          ? `<button type="button" id="pe-delete">Удалить</button>`
          : `<button type="button" disabled title="Есть связи — только архив">Удалить</button>`
      }
      <span class="muted" id="pe-msg"></span>
      <div class="grow"></div>
      ${archiveIconBtn('pe', !p.is_active)}
    </div>`
    : `
    ${h3(String(p.item_kind) === 'service' ? 'Карточка услуги' : 'Карточка товара')}
    <p class="muted mono" style="margin:0 0 12px">
      ${
        String(p.item_kind) === 'service'
          ? `Услуга${p.code ? ' · код ' + esc(p.code) : ''}${p.category ? ' · ' + esc(p.category) : ''}`
          : `${esc(p.sku)}${p.code ? ' · код ' + esc(p.code) : ''}${p.brand ? ' · ' + esc(p.brand) : ''}${p.category ? ' · ' + esc(p.category) : ''}`
      }${Number(p.notupload) ? ' · <span class="badge draft">не на сайт</span>' : ''}
      ${
        String(p.item_kind) === 'service'
          ? ''
          : `${p.array_sku ? '<br>Аналоги SKU: ' + esc(p.array_sku) : ''}${
              p.package_width_cm || p.package_height_cm
                ? '<br>Упаковка: ' +
                  [p.package_width_cm, p.package_height_cm, p.package_length_cm]
                    .filter((x) => x != null)
                    .join('×') +
                  ' см' +
                  (p.package_weight_g ? ', ' + p.package_weight_g + ' г' : '')
                : ''
            }`
      }
      <br><span style="color:var(--taxi-muted)">Только просмотр — нет права «Редактировать номенклатуру»</span>
    </p>`;
  const pricesBlock = `
    ${h3('Цены')}
    <p class="muted" style="margin:0 0 8px;font-size:12px">
      Все типы цен из справочника. Пустые — ещё не заданы для этого товара (можно ввести и сохранить).
    </p>
    ${
      prices.length
        ? `<div class="table-scroll"><table class="data-table is-dense" data-no-col-filter="1">
        <thead><tr><th>Тип цены</th><th>Сумма</th></tr></thead>
        <tbody>
        ${prices
          .map((x) => {
            const val = x.price != null && x.price !== '' ? x.price : 0;
            if (priceEdit) {
              return `<tr>
                <td>${esc(x.price_type)}${
                  x.has_value === false ? ' <span class="muted" style="font-size:11px">не задана</span>' : ''
                }</td>
                <td><input class="mono pe-price" data-type="${esc(x.price_type)}" type="number" step="0.01" min="0" value="${esc(val)}" style="width:140px" /></td>
              </tr>`;
            }
            return `<tr>
              <td>${esc(x.price_type)}</td>
              <td class="mono">${
                x.has_value === false && !(Number(val) > 0) ? '—' : formatMoney(val)
              }</td>
            </tr>`;
          })
          .join('')}
        </tbody></table></div>
        ${
          priceEdit
            ? `<div class="toolbar"><button type="button" class="primary" id="pe-prices-save">Сохранить цены</button><span class="muted" id="pe-prices-msg"></span></div>`
            : ''
        }`
        : '<p class="muted">Справочник типов цен пуст — синхронизируйте цены с 1С («Только цены» на начальной).</p>'
    }`;
  const ph = p.purchase_history || null;
  const phItems = (ph && ph.items) || [];
  const phTotal = ph ? Number(ph.total) || phItems.length : 0;
  const phShown = phItems.length;
  const purchaseBlock = `
    ${h3('История приходов')}
    <p class="muted" style="margin:0 0 8px;font-size:12px">
      Приходные накладные по этой номенклатуре. Клик по строке — карточка прихода.
      ${phTotal ? ` · записей: <b class="mono">${esc(phTotal)}</b>${phShown < phTotal ? ` (показаны последние ${esc(phShown)})` : ''}` : ''}
    </p>
    ${
      phItems.length
        ? `<table>
        <thead><tr><th>Дата</th><th>Приход</th><th>Поставщик</th><th>Склад</th><th>Кол-во</th><th>Цена</th><th>Сумма</th></tr></thead>
        <tbody>
          ${phItems
            .map(
              (l) => `<tr class="clickable" data-in-doc="${esc(l.doc_id)}">
                <td>${esc(String(l.doc_date || '').slice(0, 10))}</td>
                <td class="mono">${esc(l.doc_number)}</td>
                <td>${esc(l.counterparty || '—')}</td>
                <td>${esc(l.warehouse || '—')}</td>
                <td class="mono">${esc(l.qty)}</td>
                <td class="mono">${formatMoney(l.price)}</td>
                <td class="mono"><strong>${formatMoney(l.amount || (Number(l.qty) || 0) * (Number(l.price) || 0))}</strong></td>
              </tr>`
            )
            .join('')}
        </tbody>
      </table>`
        : '<p class="muted">Приходных с этой номенклатурой пока нет — синхронизируйте документы 1С.</p>'
    }`;
  const mediaBlock = `
    ${h3('Фото и документы')}
    <div class="toolbar">
      ${syncOk ? '<button type="button" id="psync-media">Подтянуть фото из 1С</button><button type="button" id="psync-orient">Ориентация фото</button>' : '<span class="muted">Подтянуть фото — только с правом синхронизации</span>'}
      <button type="button" id="pe-json">JSON-ссылка</button>
      <span class="muted" id="pe-json-msg"></span>
    </div>
    ${
      images.length
        ? `<div class="media-grid">${images
            .map((m) => {
              const ol = orientLabel(m.orientation);
              const dims =
                m.width && m.height ? `${m.width}×${m.height}` : '';
              const tip = [ol, dims].filter(Boolean).join(' · ') || 'ориентация не определена';
              return `<a class="media-item orient-${esc(m.orientation || 'unknown')}" href="${esc(m.url)}" target="_blank" rel="noopener" title="${esc(tip)}">
                <img src="${esc(m.url)}" alt="" loading="lazy" />
                <span class="media-orient">${esc(ol || '—')}${dims ? ' · ' + esc(dims) : ''}</span>
              </a>`;
            })
            .join('')}</div>`
        : '<p class="muted">Фото ещё нет.</p>'
    }
    ${
      docs.length
        ? `<ul class="doc-list">${docs.map((m) => `<li><a href="${esc(m.url)}" target="_blank" rel="noopener">${esc(m.ext.toUpperCase())} · ${Math.round(m.size / 1024)} КБ</a></li>`).join('')}</ul>`
        : ''
    }
    <p class="muted" id="pmedia-msg" style="margin-top:10px"></p>
    ${
      related.length
        ? `${h3('Сопутствующие')}
      <table><thead><tr><th>SKU</th><th>Название</th></tr></thead><tbody>
        ${related.map((r) => `<tr class="clickable" data-rel="${esc(r.id)}"><td class="mono">${esc(r.sku)}</td><td>${esc(r.name)}</td></tr>`).join('')}
      </tbody></table>`
        : ''
    }`;
  const propsBlock = `
    ${h3('Характеристики')}
    ${
      props.length
        ? `<table><thead><tr><th>Свойство</th><th>Значение</th></tr></thead><tbody>
        ${props
          .map((x) => {
            if (!editable) {
              return `<tr><td>${esc(x.property)}</td><td>${esc(x.value)}</td></tr>`;
            }
            const opts = Array.isArray(x.options) ? x.options : [];
            const hasCurrent = opts.includes(x.value);
            const optionHtml =
              (!hasCurrent && x.value
                ? `<option value="${esc(x.value)}" selected>${esc(x.value)}</option>`
                : '') +
              opts
                .map(
                  (o) =>
                    `<option value="${esc(o)}" ${o === x.value ? 'selected' : ''}>${esc(o)}</option>`
                )
                .join('');
            return `<tr>
              <td>${esc(x.property)}</td>
              <td><select class="pe-prop" data-prop="${esc(x.property)}" style="width:100%;max-width:420px">${optionHtml}</select></td>
            </tr>`;
          })
          .join('')}
      </tbody></table>
      ${
        editable
          ? `<div class="toolbar"><button type="button" id="pe-props-save">Сохранить характеристики</button><span class="muted" id="pe-props-msg"></span></div>`
          : ''
      }`
        : '<p class="muted">Нет данных.</p>'
    }`;
  const appsBlock = `
    ${h3(`Применимости <span class="muted" id="pe-apps-count">(${apps.length})</span>`)}
    <p class="muted" style="margin:0 0 8px">У товара может быть несколько строк (марка → модель → поколение → годы). Каждая строка независима.</p>
    <table id="pe-apps-table">
      <thead><tr><th>Марка</th><th>Модель</th><th>Поколение</th><th>Годы</th>${editable ? '<th></th>' : ''}</tr></thead>
      <tbody id="pe-apps-body">
        ${
          apps.length
            ? apps
                .map((a, idx) => {
                  if (!editable) {
                    return `<tr><td>${esc(a.mark)}</td><td>${esc(a.model || a.only_model)}</td><td>${esc(a.generation)}</td><td>${esc(a.years)}</td></tr>`;
                  }
                  return renderAppRowHtml(a, idx, appMarks, appCombos);
                })
                .join('')
            : editable
              ? ''
              : '<tr><td colspan="4" class="muted">Нет применимостей.</td></tr>'
        }
      </tbody>
    </table>
    ${
      editable
        ? `<div class="toolbar">
            <button type="button" id="pe-apps-add">Добавить применимость</button>
            <button class="primary" type="button" id="pe-apps-save">Сохранить применимости</button>
            <span class="muted" id="pe-apps-msg"></span>
          </div>`
        : ''
    }`;
  const unitsBlock = `
    ${h3(`Экземпляры <span class="muted">(${unitsData.total || unitItems.length})</span>`)}
    <p class="muted" style="margin:0 0 8px">
      История штук по марке: поставщик, закупка, цена, склад, куда ушла.
      Марки появляются из <b>заказа поставщику</b> / <b>приходной</b> — здесь только просмотр.
    </p>
    ${
      unitItems.length
        ? `<div class="table-scroll"><table class="data-table is-dense" data-table-key="product-units" data-no-col-filter="1">
        <thead><tr>
          <th>Марка</th><th>Статус</th><th>Склад</th>
          <th>Поставщик</th><th>Приход</th><th>Дата</th><th>Цена закупки</th>
          <th>Расход</th>
        </tr></thead>
        <tbody>
        ${unitItems
          .map((u) => {
            const inLabel = u.in_doc_number || (u.in_doc_id ? 'док' : '—');
            const outLabel = u.out_doc_number || (u.out_doc_id ? 'док' : '—');
            const price =
              u.in_price != null && Number(u.in_price) > 0 ? formatMoney(u.in_price) : '—';
            return `<tr>
              <td class="mono"><button type="button" class="linkish mono" data-serial="${esc(u.serial)}">${esc(u.serial)}</button></td>
              <td>${esc(unitStatusRu[u.status] || u.status)}</td>
              <td>${esc(u.warehouse_name || '—')}</td>
              <td>${esc(u.supplier_name || '—')}</td>
              <td class="mono">${
                u.in_doc_id
                  ? `<button type="button" class="linkish" data-unit-doc="${esc(u.in_doc_id)}">${esc(inLabel)}</button>`
                  : '—'
              }</td>
              <td class="mono">${esc(u.in_doc_date || String(u.created_at || '').slice(0, 10) || '—')}</td>
              <td class="mono">${esc(price)}</td>
              <td class="mono">${
                u.out_doc_id
                  ? `<button type="button" class="linkish" data-unit-doc="${esc(u.out_doc_id)}" title="${esc(u.out_doc_date || '')}">${esc(outLabel)}</button>`
                  : '—'
              }</td>
            </tr>`;
          })
          .join('')}
        </tbody></table></div>
        ${
          unitsData.total > unitItems.length
            ? `<p class="muted" style="margin:8px 0 0;font-size:12px">Показаны последние ${unitItems.length} из ${unitsData.total}. Полный журнал — «Экземпляры / серийники».</p>
               <div class="toolbar"><button type="button" id="pe-units-all">Открыть журнал экземпляров</button></div>`
            : ''
        }`
        : '<p class="muted">Экземпляров пока нет — появятся после прихода с марками (заказ поставщику / приходная).</p>'
    }`;
  const isService = String(p.item_kind) === 'service';
  const productOnlyTabs = new Set(['rests', 'units', 'purchases']);
  const productPageTabs = [
    { id: 'card', label: 'Карточка' },
    { id: 'prices', label: 'Цены' },
    ...(isService
      ? []
      : [
          { id: 'rests', label: 'Остатки' },
          { id: 'units', label: 'Экземпляры' },
          { id: 'purchases', label: 'Приходы' },
        ]),
    { id: 'props', label: 'Характеристики' },
    { id: 'apps', label: 'Применимости' },
    { id: 'history', label: 'История' },
  ];
  if (state.productSectionTab === 'fifo') state.productSectionTab = 'purchases';
  if (state.productSectionTab === 'marking') state.productSectionTab = 'units';
  if (isService && productOnlyTabs.has(state.productSectionTab)) state.productSectionTab = 'card';
  const activeSection = productPageTabs.some((t) => t.id === state.productSectionTab)
    ? state.productSectionTab
    : 'card';
  view.innerHTML = formChrome(
    title,
    `
    <div class="product-pane" data-pane="card">${editBlock}${mediaBlock}</div>
    <div class="product-pane hidden" data-pane="prices">${pricesBlock}</div>
    ${
      isService
        ? ''
        : `<div class="product-pane hidden" data-pane="rests">
      ${h3('Остатки по складам')}
      ${
        rests.length
          ? `<div class="table-scroll"><table class="data-table is-dense" data-no-col-filter="1">
          <thead><tr><th>Склад</th><th>Кол-во</th><th>Резерв</th><th>Свободно</th></tr></thead>
          <tbody>
          ${rests
            .map((x) => {
              const qty = Number(x.qty) || 0;
              const reserved = Number(x.reserved_qty) || 0;
              const free = qty - reserved;
              return `<tr class="clickable" data-wh-rest="${esc(x.warehouse_id || '')}" title="Открыть остатки склада">
                <td>${esc(x.warehouse || x.warehouse_id || '—')}${
                  Number(x.is_reserve) ? ' <span class="badge draft">резерв</span>' : ''
                }</td>
                <td class="mono">${esc(qty)}</td>
                <td class="mono">${reserved ? esc(reserved) : '—'}</td>
                <td class="mono">${esc(free)}</td>
              </tr>`;
            })
            .join('')}
          </tbody>
          <tfoot>
            <tr>
              <td><strong>Итого</strong></td>
              <td class="mono"><strong>${esc(
                rests.reduce((s, x) => s + (Number(x.qty) || 0), 0)
              )}</strong></td>
              <td class="mono"><strong>${esc(
                rests.reduce((s, x) => s + (Number(x.reserved_qty) || 0), 0) || '—'
              )}</strong></td>
              <td class="mono"><strong>${esc(
                rests.reduce(
                  (s, x) => s + ((Number(x.qty) || 0) - (Number(x.reserved_qty) || 0)),
                  0
                )
              )}</strong></td>
            </tr>
          </tfoot>
        </table></div>`
          : '<p class="muted">Нет остатков по складам.</p>'
      }
    </div>
    <div class="product-pane hidden" data-pane="units">${unitsBlock}</div>
    <div class="product-pane hidden" data-pane="purchases">${purchaseBlock}</div>`
    }
    <div class="product-pane hidden" data-pane="props">${propsBlock}</div>
    <div class="product-pane hidden" data-pane="apps">${appsBlock}</div>
    <div class="product-pane hidden" data-pane="history">
      ${h3('История изменений')}
      <p class="muted" style="margin:0 0 8px">Название, цены, фото, характеристики и прочие правки по этой карточке.</p>
      <div id="product-history" class="entity-history"><p class="muted" style="margin:0">Загрузка…</p></div>
    </div>`,
    {
      section: isService ? 'Услуга' : 'Номенклатура',
      entityKind: isService ? 'service' : 'product',
      pageTabs: productPageTabs,
      activePageTab: activeSection,
      chatRef: {
        type: 'product',
        id: String(id),
        label: (() => {
          const sku = String(p.sku || p.code || '').trim();
          const name = String(productTitle(p) || p.name || sku || 'Товар').trim();
          return sku ? sku + ' · ' + name : name;
        })(),
        href: '/products/' + id,
      },
    }
  );
  view.querySelectorAll('[data-rel]').forEach((tr) => {
    tr.onclick = () => openTab('product:' + tr.dataset.rel);
  });
  view.querySelectorAll('[data-in-doc]').forEach((tr) => {
    tr.onclick = () => openTab('doc:' + tr.dataset.inDoc);
  });
  view.querySelectorAll('[data-wh-rest]').forEach((tr) => {
    tr.onclick = () => {
      const wid = tr.getAttribute('data-wh-rest');
      if (!wid) return;
      state.balWh = wid;
      state.balPage = 1;
      state.balQ = '';
      const w = (state.warehouses || []).find((x) => x.id === wid);
      openTab('balances', w ? entityTitle(w.code, w.name) || 'Склад' : 'Склад');
    };
  });
  fillEntityHistory('product-history', 'product', id);
  bindFormChrome(() => openTab('products'));
  bindProductSectionTabs(view, activeSection);
  view.querySelectorAll('[data-unit-doc]').forEach((btn) => {
    btn.onclick = () => openTab('doc:' + btn.getAttribute('data-unit-doc'));
  });
  view.querySelectorAll('[data-serial]').forEach((btn) => {
    btn.onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      const code = String(btn.getAttribute('data-serial') || '').trim();
      if (code) openTab('serial:' + code, code.slice(0, 40));
    };
  });
  document.getElementById('pe-units-all')?.addEventListener('click', () => {
    state.unitsProductId = id;
    openTab('product-units', 'Экземпляры');
  });
  const syncBtn = document.getElementById('psync-media');
  if (syncBtn) {
    syncBtn.onclick = async () => {
      const msg = document.getElementById('pmedia-msg');
      syncBtn.disabled = true;
      msg.textContent = 'Загрузка…';
      try {
        const r = await api('/sync/media', {
          method: 'POST',
          body: JSON.stringify({ product_id: id, limit: 1, onlyMissing: false, replace: false }),
        });
        try {
          await api('/sync/media-orient', {
            method: 'POST',
            body: JSON.stringify({ product_id: id, limit: 50 }),
          });
        } catch {
          /* orient optional */
        }
        msg.textContent = `Готово: загружено ${r.uploaded}, без фото ${r.empty}, пропущено ${r.skipped}`;
        setTimeout(() => renderProductDetail(id), 400);
      } catch (e) {
        msg.textContent = e.message;
        syncBtn.disabled = false;
      }
    };
  }
  const orientBtn = document.getElementById('psync-orient');
  if (orientBtn) {
    orientBtn.onclick = async () => {
      const msg = document.getElementById('pmedia-msg');
      orientBtn.disabled = true;
      msg.textContent = 'Определение ориентации…';
      try {
        const r = await api('/sync/media-orient', {
          method: 'POST',
          body: JSON.stringify({ product_id: id, limit: 50 }),
        });
        msg.textContent = `Ориентация: обновлено ${r.updated}, ошибок ${r.failed}`;
        setTimeout(() => renderProductDetail(id), 300);
      } catch (e) {
        msg.textContent = e.message;
        orientBtn.disabled = false;
      }
    };
  }
  const jsonBtn = document.getElementById('pe-json');
  if (jsonBtn) {
    jsonBtn.onclick = async () => {
      const msg = document.getElementById('pe-json-msg');
      jsonBtn.disabled = true;
      try {
        const r = await api('/products/' + id + '/json-link');
        const url = r.url || r.url_query;
        try {
          await navigator.clipboard.writeText(url);
          msg.textContent = 'JSON-ссылка скопирована';
        } catch {
          msg.textContent = url;
          window.prompt('JSON-ссылка', url);
        }
      } catch (e) {
        msg.textContent = e.message;
      }
      jsonBtn.disabled = false;
    };
  }
  const syncProductOnlyFields = () => {
    const kind = document.getElementById('pe-kind')?.value || 'product';
    const svc = kind === 'service';
    view.querySelectorAll('[data-product-only]').forEach((el) => {
      el.hidden = svc;
    });
    const titleEl = view.querySelector('.product-pane[data-pane="card"] .product-pane-title');
    if (titleEl) titleEl.textContent = svc ? 'Карточка услуги' : 'Карточка товара';
  };
  const kindSel = document.getElementById('pe-kind');
  if (kindSel) {
    syncProductOnlyFields();
    kindSel.onchange = syncProductOnlyFields;
  }
  bindCategoryPick(view, catRoots, { root: 'pe-cat-root', sub: 'pe-cat-sub' });
  const saveBtn = document.getElementById('pe-save');
  if (saveBtn) {
    saveBtn.onclick = async () => {
      const msg = document.getElementById('pe-msg');
      const num = (el) => {
        if (!el) return null;
        const v = el.value.trim();
        if (!v) return null;
        const n = Number(v);
        return Number.isFinite(n) ? n : null;
      };
      const kind = document.getElementById('pe-kind')?.value || 'product';
      const asService = kind === 'service';
      saveBtn.disabled = true;
      msg.textContent = 'Сохранение…';
      try {
        await api('/products/' + id, {
          method: 'PATCH',
          body: JSON.stringify({
            name: document.getElementById('pe-name').value,
            sku: asService ? p.sku || '' : document.getElementById('pe-sku')?.value || '',
            code: document.getElementById('pe-code').value,
            brand: asService ? '' : document.getElementById('pe-brand')?.value || '',
            array_sku: asService ? '' : document.getElementById('pe-array')?.value || '',
            category_id: selectedCategoryIdFromPick(view, { root: 'pe-cat-root', sub: 'pe-cat-sub' }) || null,
            package_width_cm: asService ? null : num(document.getElementById('pe-pw')),
            package_height_cm: asService ? null : num(document.getElementById('pe-ph')),
            package_length_cm: asService ? null : num(document.getElementById('pe-pl')),
            package_weight_g: asService ? null : num(document.getElementById('pe-pwg')),
            gtin: asService ? '' : document.getElementById('pe-gtin')?.value || '',
            requires_marking: asService ? false : document.getElementById('pe-marking')?.value === '1',
            serial_tracked: asService ? false : document.getElementById('pe-serial')?.value === '1',
            item_kind: kind,
            notupload: !document.getElementById('pe-onsite')?.checked,
          }),
        });
        msg.textContent = 'Сохранено';
        setTimeout(() => renderProductDetail(id), 300);
      } catch (e) {
        msg.textContent = e.message;
        saveBtn.disabled = false;
      }
    };
  }
  const archBtn = document.getElementById('pe-archive');
  if (archBtn) {
    archBtn.onclick = async () => {
      if (!confirm('Перенести товар в архив?')) return;
      const msg = document.getElementById('pe-msg');
      try {
        await api('/products/' + id + '/archive', { method: 'POST', body: '{}' });
        msg.textContent = 'В архиве';
        setTimeout(() => renderProductDetail(id), 250);
      } catch (e) {
        msg.textContent = e.message;
      }
    };
  }
  const restoreBtn = document.getElementById('pe-restore');
  if (restoreBtn) {
    restoreBtn.onclick = async () => {
      const msg = document.getElementById('pe-msg');
      try {
        await api('/products/' + id, {
          method: 'PATCH',
          body: JSON.stringify({ is_active: true }),
        });
        msg.textContent = 'Возвращён';
        setTimeout(() => renderProductDetail(id), 250);
      } catch (e) {
        msg.textContent = e.message;
      }
    };
  }
  const delBtn = document.getElementById('pe-delete');
  if (delBtn) {
    delBtn.onclick = async () => {
      if (!confirm('Удалить товар без возможности восстановления?')) return;
      const msg = document.getElementById('pe-msg');
      try {
        await api('/products/' + id, { method: 'DELETE' });
        closeTab('product:' + id);
        openTab('products');
      } catch (e) {
        msg.textContent = e.message || 'Нельзя удалить: есть связи. Перенесите в архив.';
        alert(msg.textContent);
      }
    };
  }
  const pricesSave = document.getElementById('pe-prices-save');
  if (pricesSave) {
    pricesSave.onclick = async () => {
      const msg = document.getElementById('pe-prices-msg');
      const list = [...view.querySelectorAll('.pe-price')].map((inp) => ({
        price_type: inp.dataset.type,
        price: Number(inp.value),
      }));
      pricesSave.disabled = true;
      msg.textContent = 'Сохранение…';
      try {
        await api('/products/' + id + '/prices', {
          method: 'PUT',
          body: JSON.stringify({ prices: list }),
        });
        msg.textContent = 'Цены сохранены';
        pricesSave.disabled = false;
      } catch (e) {
        msg.textContent = e.message;
        pricesSave.disabled = false;
      }
    };
  }
  const propsSave = document.getElementById('pe-props-save');
  if (propsSave) {
    propsSave.onclick = async () => {
      const msg = document.getElementById('pe-props-msg');
      const list = [...view.querySelectorAll('.pe-prop')].map((sel) => ({
        property: sel.dataset.prop,
        value: sel.value,
      }));
      propsSave.disabled = true;
      msg.textContent = 'Сохранение…';
      try {
        await api('/products/' + id + '/properties', {
          method: 'PUT',
          body: JSON.stringify({ properties: list }),
        });
        msg.textContent = 'Характеристики сохранены';
        propsSave.disabled = false;
      } catch (e) {
        msg.textContent = e.message;
        propsSave.disabled = false;
      }
    };
  }
  if (editable) {
    const updateAppsCount = () => {
      const el = document.getElementById('pe-apps-count');
      const n = view.querySelectorAll('#pe-apps-body tr[data-app-idx]').length;
      if (el) el.textContent = '(' + n + ')';
    };
    const cascadeAppRow = (tr) => {
      if (!tr) return;
      const markSel = tr.querySelector('.pe-app[data-field="mark"]');
      const modelSel = tr.querySelector('.pe-app[data-field="model"]');
      const genSel = tr.querySelector('.pe-app[data-field="generation"]');
      const yearsSel = tr.querySelector('.pe-app[data-field="years"]');
      if (!markSel || !modelSel || !genSel || !yearsSel) return;
      const mark = markSel.value;
      const models = uniqueAppField(appCombos, 'model', { mark });
      fillSelectOptions(modelSel, models, modelSel.value);
      const model = modelSel.value;
      const gens = uniqueAppField(appCombos, 'generation', { mark, model });
      fillSelectOptions(genSel, gens, genSel.value);
      const generation = genSel.value;
      const years = uniqueAppField(appCombos, 'years', { mark, model, generation });
      fillSelectOptions(yearsSel, years, yearsSel.value);
    };
    const bindAppRow = (tr) => {
      tr.querySelectorAll('.pe-app').forEach((sel) => {
        sel.onchange = () => {
          if (sel.dataset.field === 'mark' || sel.dataset.field === 'model' || sel.dataset.field === 'generation') {
            cascadeAppRow(tr);
          }
        };
      });
      const del = tr.querySelector('.pe-app-del');
      if (del) {
        del.onclick = () => {
          tr.remove();
          updateAppsCount();
        };
      }
    };
    view.querySelectorAll('#pe-apps-body tr[data-app-idx]').forEach(bindAppRow);
    const addBtn = document.getElementById('pe-apps-add');
    if (addBtn) {
      addBtn.onclick = () => {
        const body = document.getElementById('pe-apps-body');
        if (!body) return;
        const idx = Date.now();
        const wrap = document.createElement('tbody');
        wrap.innerHTML = renderAppRowHtml(
          { mark: '', model: '', generation: '', years: '' },
          idx,
          appMarks,
          appCombos
        );
        const tr = wrap.firstElementChild;
        body.appendChild(tr);
        bindAppRow(tr);
        cascadeAppRow(tr);
        updateAppsCount();
      };
    }
    const appsSave = document.getElementById('pe-apps-save');
    if (appsSave) {
      appsSave.onclick = async () => {
        const msg = document.getElementById('pe-apps-msg');
        const list = [];
        view.querySelectorAll('#pe-apps-body tr[data-app-idx]').forEach((tr) => {
          const row = {};
          tr.querySelectorAll('.pe-app').forEach((sel) => {
            row[sel.dataset.field] = sel.value;
          });
          list.push(row);
        });
        appsSave.disabled = true;
        msg.textContent = 'Сохранение…';
        try {
          const r = await api('/products/' + id + '/applicability', {
            method: 'PUT',
            body: JSON.stringify({ applicability: list }),
          });
          msg.textContent = 'Сохранено: ' + (r.applicability || list).length + ' строк';
          setTimeout(() => renderProductDetail(id), 350);
        } catch (e) {
          msg.textContent = e.message;
          appsSave.disabled = false;
        }
      };
    }
  }
}

function findCategoryPath(roots, id) {
  const want = String(id || '');
  if (!want) return { root: null, sub: null };
  const walk = (nodes, root) => {
    for (const n of nodes || []) {
      const ids = n.ids || [n.id];
      if (n.id === want || ids.includes(want)) {
        return root ? { root, sub: n } : { root: n, sub: null };
      }
      const hit = walk(n.children || [], root || n);
      if (hit) return hit;
    }
    return null;
  };
  return walk(roots, null) || { root: null, sub: null };
}

function flattenCatChildren(nodes, depth = 1) {
  const out = [];
  for (const n of nodes || []) {
    const pad = depth > 1 ? `${'— '.repeat(depth - 1)}` : '';
    out.push({
      id: n.id,
      name: pad + (n.name || ''),
      products_total: n.products_total,
      children: n.children || [],
    });
    out.push(...flattenCatChildren(n.children || [], depth + 1));
  }
  return out;
}

/** Два select: категория (корень) + подкатегория. Сохраняем id подкатегории, иначе корня. */
function categoryPickHtml(roots, selectedId, ids = {}) {
  const rootId = ids.root || 'cat-root';
  const subId = ids.sub || 'cat-sub';
  const path = findCategoryPath(roots || [], selectedId);
  const selectedRootId = path.root?.id || '';
  const selectedSubId = path.sub?.id || '';
  const subOptions = path.root ? flattenCatChildren(path.root.children || []) : [];
  const orphan =
    selectedId && !path.root
      ? `<option value="${esc(selectedId)}" selected>${esc(
          (state.categories.find((c) => c.id === selectedId) || {}).name || selectedId
        )} (вне дерева)</option>`
      : '';
  const rootOpts =
    `<option value="">—</option>` +
    orphan +
    (roots || [])
      .map(
        (r) =>
          `<option value="${esc(r.id)}" ${r.id === selectedRootId ? 'selected' : ''}>${esc(r.name)}</option>`
      )
      .join('');
  const subOpts =
    `<option value="">${subOptions.length ? 'Вся категория' : '—'}</option>` +
    subOptions
      .map(
        (c) =>
          `<option value="${esc(c.id)}" ${c.id === selectedSubId ? 'selected' : ''}>${esc(c.name)}</option>`
      )
      .join('');
  return `
    <label>Категория
      <select id="${esc(rootId)}">${rootOpts}</select>
    </label>
    <label ${subOptions.length ? '' : 'hidden'} data-cat-sub-wrap>
      Подкатегория
      <select id="${esc(subId)}" ${subOptions.length ? '' : 'disabled'}>${subOpts}</select>
    </label>`;
}

function bindCategoryPick(scope, roots, ids = {}) {
  const rootId = ids.root || 'cat-root';
  const subId = ids.sub || 'cat-sub';
  const rootSel = scope.querySelector('#' + rootId);
  const subSel = scope.querySelector('#' + subId);
  const subWrap = subSel?.closest('[data-cat-sub-wrap]') || subSel?.closest('label');
  if (!rootSel) return;
  rootSel.onchange = () => {
    const root = (roots || []).find((r) => r.id === rootSel.value);
    const subs = root ? flattenCatChildren(root.children || []) : [];
    if (subSel) {
      subSel.innerHTML =
        `<option value="">${subs.length ? 'Вся категория' : '—'}</option>` +
        subs.map((c) => `<option value="${esc(c.id)}">${esc(c.name)}</option>`).join('');
      subSel.disabled = !subs.length;
      subSel.value = '';
    }
    if (subWrap) subWrap.hidden = !subs.length;
  };
}

function selectedCategoryIdFromPick(scope, ids = {}) {
  const rootId = ids.root || 'cat-root';
  const subId = ids.sub || 'cat-sub';
  const sub = scope.querySelector('#' + subId)?.value || '';
  if (sub) return sub;
  return scope.querySelector('#' + rootId)?.value || '';
}

async function renderProducts(opts = {}) {
  if (opts.resetPage) state.productsPage = 1;
  await refreshRefs();
  const q = opts.q != null ? opts.q : state.productsQ;
  state.productsQ = q;
  const catId = state.productsCategoryId || '';
  const catName = state.productsCategoryName || '';
  const page = state.productsPage;
  const sort = state.productsSort || 'name';
  const dir = state.productsDir || 'asc';
  const limit = getPageSize('products', 50);
  let url = `/products?page=${page}&limit=${limit}&sort=${encodeURIComponent(sort)}&dir=${encodeURIComponent(dir)}`;
  if (q) url += '&q=' + encodeURIComponent(q);
  if (catId) url += '&category_id=' + encodeURIComponent(catId);
  else if (catName) url += '&category=' + encodeURIComponent(catName);
  const kindFilter = state.productsItemKind || '';
  if (kindFilter) url += '&item_kind=' + encodeURIComponent(kindFilter);
  const [data, catTree] = await Promise.all([
    api(url),
    state.productsCatTree
      ? Promise.resolve(state.productsCatTree)
      : api('/categories/tree').catch(() => ({ roots: [], uncategorized: 0 })),
  ]);
  state.productsCatTree = catTree;
  const roots = catTree.roots || [];
  const path = findCategoryPath(roots, catId);
  const selectedRootId = path.root?.id || (catId === '__none__' ? '__none__' : '');
  const selectedSubId = path.sub?.id || '';
  const subOptions = path.root ? flattenCatChildren(path.root.children || []) : [];
  const list = data.items || [];
  const unitOpts = state.units.map((u) => `<option value="${esc(u.id)}">${esc(u.short_name)}</option>`).join('');
  const catFilterLabel =
    catId === '__none__' || catName === '__none__'
      ? 'Без категории'
      : path.sub?.name || path.root?.name || catName || (state.categories.find((c) => c.id === catId) || {}).name || 'Категория';
  const catFiltered = !!(catId || catName);
  const rootOpts =
    `<option value="">Все категории</option>` +
    `<option value="__none__" ${selectedRootId === '__none__' ? 'selected' : ''}>Без категории (${esc(catTree.uncategorized || 0)})</option>` +
    roots
      .map(
        (r) =>
          `<option value="${esc(r.id)}" ${r.id === selectedRootId ? 'selected' : ''}>${esc(r.name)} (${esc(r.products_total || 0)})</option>`
      )
      .join('');
  const subOpts =
    `<option value="">${subOptions.length ? 'Все подкатегории' : '—'}</option>` +
    subOptions
      .map(
        (c) =>
          `<option value="${esc(c.id)}" ${c.id === selectedSubId ? 'selected' : ''}>${esc(c.name)} (${esc(c.products_total || 0)})</option>`
      )
      .join('');

  const canEdit = canEditProducts();
  const prefCat = catId && catId !== '__none__' ? catId : '';
  const createCatPickHtml = categoryPickHtml(roots, prefCat, {
    root: 'pcreate-cat-root',
    sub: 'pcreate-cat-sub',
  });
  const createPanelOpen = canEdit && !!state.productsCreateOpen;
  view.innerHTML = formChrome(
    'Номенклатура',
    `
    <p class="muted" style="margin:0 0 10px;font-size:12px">
      Номенклатура единая для всех организаций — переключатель контура в шапке на список не влияет.
    </p>
    ${
      canEdit
        ? `<div id="prod-create-panel" class="thin-add-panel prod-create-panel"${createPanelOpen ? '' : ' hidden'}>
        <div class="thin-add-panel-head">
          <strong>Новая номенклатура</strong>
          <button type="button" class="linkish" id="prod-create-close" title="Свернуть">Свернуть</button>
        </div>
        <div class="form-grid">
          <label>Вид<select id="pkind"><option value="product">Товар</option><option value="service">Услуга</option></select></label>
          <label data-product-only>Артикул<input id="psku" placeholder="Пусто = авто (НФ-… / УСЛ-…)" autocomplete="off" /></label>
          <label>Название<input id="pname" placeholder="Наименование" autocomplete="off" /></label>
          <label>Ед.изм.<select id="punit">${unitOpts}</select></label>
          ${createCatPickHtml}
        </div>
        <div class="thin-add-panel-actions">
          <button type="button" class="primary" id="prod-create-submit">Создать</button>
          <button type="button" id="prod-create-cancel">Отмена</button>
          <span class="muted" id="prod-create-msg"></span>
        </div>
      </div>`
        : '<p class="muted" style="margin:0 0 10px">Просмотр номенклатуры. Создание и правка — по праву «Редактировать номенклатуру».</p>'
    }
    <div class="table-tools products-cat-bar">
      ${pagerHtml('ppager', data.page, data.pages, data.total, { limit, listKey: 'products' })}
      <div class="products-cat-filters">
        <label>Категория
          <select id="pcat-root">${rootOpts}</select>
        </label>
        <label ${subOptions.length ? '' : 'hidden'}>Подкатегория
          <select id="pcat-sub" ${subOptions.length ? '' : 'disabled'}>${subOpts}</select>
        </label>
        <div class="field" style="margin:0">
          <span class="muted" style="font-size:11px;display:block;margin-bottom:4px">Вид</span>
          ${radioPillsHtml(
            'pkind-filter',
            [
              { value: '', label: 'Все' },
              { value: 'product', label: 'Товар' },
              { value: 'service', label: 'Услуга' },
            ],
            kindFilter
          )}
        </div>
        ${
          catFiltered
            ? `<button type="button" id="pcat-clear" title="Сбросить фильтр">Сбросить</button>`
            : ''
        }
      </div>
    </div>
    <table data-table-key="products">
      <thead><tr>
        ${(() => {
          const mark = (key) => (sort !== key ? '' : dir === 'asc' ? ' ▲' : ' ▼');
          const th = (key, label, tip) =>
            `<th data-col-id="${esc(key)}" data-sort="${esc(key)}" class="sortable ${
              sort === key ? 'sorted' : ''
            }" title="${esc(tip || 'Сортировка')}">${esc(label)}${mark(key)}</th>`;
          return (
            th('kind', 'Вид') +
            th('site', 'Сайт') +
            th('sku', 'Артикул') +
            th('code', 'Код') +
            th('name', 'Название') +
            th('category', 'Категория') +
            th('brand', 'Бренд') +
            th('stock', 'На складах', 'Сумма остатков по всем складам · сортировка') +
            th('unit', 'Ед.')
          );
        })()}
      </tr></thead>
      <tbody>
        ${
          list
            .map(
              (p) => `
          <tr class="clickable">
            <td>${String(p.item_kind) === 'service' ? 'Услуга' : 'Товар'}</td>
            <td>${Number(p.notupload) ? '<span class="badge draft">нет</span>' : 'да'}</td>
            <td class="mono"><a href="#" data-open="${esc(p.id)}">${esc(p.sku)}</a></td>
            <td class="mono">${esc(p.code || '')}</td>
            <td><a href="#" data-open="${esc(p.id)}">${esc(productTitle(p))}</a></td>
            <td>${p.category ? esc(p.category) : '<span class="muted">—</span>'}</td>
            <td>${esc(p.brand || '')}</td>
            <td class="mono">${
              Number(p.stock_qty) > 0
                ? `<strong>${esc(p.stock_qty)}</strong>`
                : '<span class="muted">0</span>'
            }</td>
            <td>${esc(p.unit || '')}</td>
          </tr>`
            )
            .join('') || '<tr><td colspan="9" class="muted">Ничего не найдено</td></tr>'
        }
      </tbody>
    </table>
    ${pagerHtml('ppager2', data.page, data.pages, data.total, { limit, listKey: 'products' })}`,
    {
      toolbar: `
        ${
          canEdit
            ? `<button class="primary" type="button" id="padd2" aria-expanded="${createPanelOpen ? 'true' : 'false'}">${
                createPanelOpen ? 'Свернуть' : 'Создать'
              }</button>`
            : ''
        }
        ${
          catFiltered
            ? `<button type="button" id="pcat-clear-top" title="Сбросить фильтр категории">Категория: ${esc(catFilterLabel)} ✕</button>`
            : ''
        }
        <div class="grow"></div>
        <div class="find">
          <input id="pq" placeholder="Артикул / код / марка / название" value="${esc(q)}" autocomplete="off" />
          <button type="button" class="find-go" id="psearch">Найти</button>
        </div>
        <button type="button">Ещё ▾</button>`,
    }
  );
  bindFormChrome(() => showSection('warehouse'));

  const applyCategoryFilter = (id, name) => {
    state.productsCategoryId = id || '';
    state.productsCategoryName = name || '';
    state.productsPage = 1;
    renderProducts();
  };

  const rootSel = document.getElementById('pcat-root');
  const subSel = document.getElementById('pcat-sub');
  bindRadioPills(view, (name, val) => {
    if (name !== 'pkind-filter') return;
    state.productsItemKind = val || '';
    state.productsPage = 1;
    renderProducts();
  });
  if (rootSel) {
    rootSel.onchange = () => {
      const id = rootSel.value || '';
      if (!id) return applyCategoryFilter('', '');
      if (id === '__none__') return applyCategoryFilter('__none__', '__none__');
      const root = roots.find((r) => r.id === id);
      applyCategoryFilter(id, root?.name || '');
    };
  }
  if (subSel) {
    subSel.onchange = () => {
      const id = subSel.value || '';
      if (!id) {
        const root = path.root;
        return applyCategoryFilter(root?.id || rootSel?.value || '', root?.name || '');
      }
      const flat = flattenCatChildren(path.root?.children || []);
      const node = flat.find((c) => c.id === id);
      applyCategoryFilter(id, String(node?.name || '').replace(/^(— )+/, ''));
    };
  }

  const clearBtn = document.getElementById('pcat-clear');
  if (clearBtn) clearBtn.onclick = () => applyCategoryFilter('', '');
  const clearTop = document.getElementById('pcat-clear-top');
  if (clearTop) clearTop.onclick = () => applyCategoryFilter('', '');

  const goSearch = () => {
    state.productsQ = document.getElementById('pq').value.trim();
    state.productsPage = 1;
    renderProducts();
  };
  document.getElementById('psearch').onclick = goSearch;
  document.getElementById('pq').onkeydown = (e) => {
    if (e.key === 'Enter') goSearch();
  };
  view.querySelectorAll('th[data-sort]').forEach((thEl) => {
    thEl.onclick = (e) => {
      e.stopPropagation();
      const key = thEl.getAttribute('data-sort') || 'name';
      if (state.productsSort === key) {
        state.productsDir = state.productsDir === 'asc' ? 'desc' : 'asc';
      } else {
        state.productsSort = key;
        state.productsDir = key === 'stock' || key === 'site' ? 'desc' : 'asc';
      }
      state.productsPage = 1;
      renderProducts();
    };
  });
  if (canEdit) {
    const panel = document.getElementById('prod-create-panel');
    const padd2 = document.getElementById('padd2');
    const setCreateMsg = (t) => {
      const m = document.getElementById('prod-create-msg');
      if (m) m.textContent = t || '';
    };
    const closeProductCreate = () => {
      state.productsCreateOpen = false;
      if (panel) panel.classList.add('hidden');
      if (padd2) {
        padd2.textContent = 'Создать';
        padd2.setAttribute('aria-expanded', 'false');
      }
      setCreateMsg('');
    };
    const syncCreateProductOnly = () => {
      if (!panel) return;
      const svc = (panel.querySelector('#pkind')?.value || 'product') === 'service';
      panel.querySelectorAll('[data-product-only]').forEach((el) => {
        el.hidden = svc;
      });
    };
    const openProductCreate = () => {
      state.productsCreateOpen = true;
      if (!panel) return;
      panel.classList.remove('hidden');
      if (padd2) {
        padd2.textContent = 'Свернуть';
        padd2.setAttribute('aria-expanded', 'true');
      }
      setCreateMsg('');
      syncCreateProductOnly();
      setTimeout(() => panel.querySelector('#pname')?.focus(), 0);
    };
    panel?.querySelector('#pkind')?.addEventListener('change', syncCreateProductOnly);
    if (panel) bindCategoryPick(panel, roots, { root: 'pcreate-cat-root', sub: 'pcreate-cat-sub' });
    const toggleProductCreate = () => {
      if (state.productsCreateOpen) closeProductCreate();
      else openProductCreate();
    };
    if (padd2) padd2.onclick = toggleProductCreate;
    document.getElementById('prod-create-close')?.addEventListener('click', closeProductCreate);
    document.getElementById('prod-create-cancel')?.addEventListener('click', closeProductCreate);
    const submitBtn = document.getElementById('prod-create-submit');
    if (submitBtn && panel) {
      const doSubmit = async () => {
        submitBtn.disabled = true;
        setCreateMsg('');
        try {
          const name = (panel.querySelector('#pname')?.value || '').trim();
          if (!name) {
            panel.querySelector('#pname')?.focus();
            throw new Error('Укажите название');
          }
          const created = await api('/products', {
            method: 'POST',
            body: JSON.stringify({
              sku: panel.querySelector('#psku')?.value,
              name,
              unit_id: panel.querySelector('#punit')?.value,
              category_id:
                selectedCategoryIdFromPick(panel, {
                  root: 'pcreate-cat-root',
                  sub: 'pcreate-cat-sub',
                }) || undefined,
              item_kind: panel.querySelector('#pkind')?.value || 'product',
            }),
          });
          state.productsCreateOpen = false;
          if (created?.id) {
            openTab('product:' + created.id, (created.sku || name).slice(0, 40));
            return;
          }
          state.productsPage = 1;
          renderProducts();
        } catch (e) {
          setCreateMsg(e.message || String(e));
        } finally {
          if (submitBtn.isConnected) submitBtn.disabled = false;
        }
      };
      submitBtn.onclick = doSubmit;
      panel.querySelectorAll('input').forEach((inp) => {
        inp.onkeydown = (e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            doSubmit();
          }
          if (e.key === 'Escape') {
            e.preventDefault();
            closeProductCreate();
          }
        };
      });
    }
  }
  bindListPager(['ppager', 'ppager2'], 'products', 'productsPage', () => renderProducts());
  view.querySelectorAll('[data-open]').forEach((a) => {
    a.onclick = (e) => {
      e.preventDefault();
      openTab('product:' + a.dataset.open);
    };
  });

}

function whIsActive(w) {
  return Number(w && w.is_active) === 1 || w?.is_active === true;
}

function whIsWaitPay(w) {
  return String(w?.code || '') === 'WAIT-PAY' || String(w?.name || '') === 'Ожидание оплаты';
}

/** Авто/системные склады: перемещения только системой, ручных заказов на перемещение нет. */
function whIsAutoSys(w) {
  if (!w) return false;
  if (whIsWaitPay(w)) return true;
  const code = String(w.code || '').trim().toUpperCase();
  if (code === 'IN-TRANSIT' || code === 'WAIT-PAY') return true;
  const name = String(w.name || '').trim();
  if (/^в\s*пути$/i.test(name)) return true;
  if (/не\s*найден/i.test(name)) return true;
  if (/недопоставк/i.test(name)) return true;
  if (/доукомплект/i.test(name)) return true;
  if (/ожидание\s*оплат/i.test(name)) return true;
  return false;
}

/** Подпись «Авто» для системных складов (tip зависит от типа). */
function whAutoSysTip(w) {
  if (whIsWaitPay(w)) {
    return 'Системный склад: создаётся автоматически для резерва по ссылкам на оплату';
  }
  const code = String(w?.code || '').trim().toUpperCase();
  const name = String(w?.name || '').trim();
  if (code === 'IN-TRANSIT' || /^в\s*пути$/i.test(name)) {
    return 'Системный склад «В пути»: товар от заказа до оприходования, перемещения только системой';
  }
  if (/не\s*найден/i.test(name)) {
    return 'Системный склад для позиций ЭДО / «не найден» — перемещения только системой';
  }
  return 'Системный автосклад: перемещения только системой, ручных заказов на перемещение нет';
}

function whAutoSysMark(w, compact) {
  const tip = whAutoSysTip(w);
  if (compact) {
    return `<span class="muted" title="${esc(tip)}" style="font-size:12px">Авто</span>`;
  }
  if (whIsWaitPay(w)) {
    return `<span class="muted" title="${esc(tip)}" style="font-size:12px">Авто · резерв оплаты</span>`;
  }
  const code = String(w?.code || '').trim().toUpperCase();
  if (code === 'IN-TRANSIT' || /^в\s*пути$/i.test(String(w?.name || ''))) {
    return `<span class="muted" title="${esc(tip)}" style="font-size:12px">Авто · в пути</span>`;
  }
  return `<span class="muted" title="${esc(tip)}" style="font-size:12px">Авто</span>`;
}

/** @deprecated используйте whAutoSysMark */
function whWaitPayMark(compact) {
  return whAutoSysMark({ code: 'WAIT-PAY', name: 'Ожидание оплаты' }, compact);
}

/** Активные сверху, архивные внизу (внутри группы — по имени). */
function sortWarehousesActiveFirst(list) {
  return [...list].sort((a, b) => {
    const aa = whIsActive(a) ? 1 : 0;
    const ba = whIsActive(b) ? 1 : 0;
    if (aa !== ba) return ba - aa;
    return String(a.name || '').localeCompare(String(b.name || ''), 'ru');
  });
}

const WH_VIEW_KEY = 'wms.warehouses.view.v1';

function loadWhView() {
  try {
    const v = localStorage.getItem(WH_VIEW_KEY);
    if (v === 'cards' || v === 'table') return v;
  } catch (_) {
    /* ignore */
  }
  return state.whView === 'cards' ? 'cards' : 'table';
}

function saveWhView(mode) {
  const next = mode === 'cards' ? 'cards' : 'table';
  state.whView = next;
  try {
    localStorage.setItem(WH_VIEW_KEY, next);
  } catch (_) {
    /* ignore */
  }
  return next;
}

async function renderWarehouseRequestsHub() {
  state.balWh = '';
  let items = [];
  let err = '';
  try {
    const data = await api('/parity/journals/transfer_orders?limit=200');
    items = data.items || [];
  } catch (e) {
    err = e.message || String(e);
  }
  const statusRu = (s) => {
    const m = {
      new: 'Новое',
      draft: 'Черновик',
      done: 'Выполнен',
      posted: 'Проведён',
      cancelled: 'Отменён',
    };
    return m[String(s || '').toLowerCase()] || s || '—';
  };
  view.innerHTML = formChrome(
    'Заказы на перемещение',
    err
      ? `<p class="error">${esc(err)}</p>`
      : `
    <p class="muted" style="margin:0 0 10px;font-size:12px">
      История заказов на перемещение. Создать — из остатков склада или из заказа покупателя (вкладка «Перемещение»).
    </p>
    <div class="table-scroll">
      <table class="data-table is-dense" data-table-key="xfer-requests" data-no-col-filter="1">
        <thead><tr>
          <th>Дата</th><th>Номер</th><th>Откуда → Куда</th><th>Позиций</th><th>Задание</th><th>Статус</th><th>Зачем</th>
        </tr></thead>
        <tbody>
          ${
            items.length
              ? items
                  .map(
                    (r) => `<tr class="clickable" data-xfer-hist="${esc(r.id)}" title="Открыть">
              <td>${esc(String(r.doc_date || '').slice(0, 10))}</td>
              <td class="mono">${esc(r.number || '')}</td>
              <td>${esc(r.counterparty_name || '—')}</td>
              <td class="mono">${esc(r.lines_count != null ? r.lines_count : '—')}</td>
              <td class="mono">${esc(r.warehouse_task_number || '—')}</td>
              <td>${esc(statusRu(r.status))}</td>
              <td title="${esc(r.comment || '')}">${esc(
                      String(r.comment || '').length > 60
                        ? String(r.comment).slice(0, 60) + '…'
                        : r.comment || '—'
                    )}</td>
            </tr>`
                  )
                  .join('')
              : '<tr><td colspan="7" class="muted">Пока нет заказов на перемещение. Откройте склад → остатки → «Создать заказ на перемещение».</td></tr>'
          }
        </tbody>
      </table>
    </div>`,
    {
      sectionId: 'warehouse',
      entityKind: 'warehouse',
      parentTab: 'warehouses',
      parentLabel: 'Склады',
      toolbar: `
        <button type="button" class="primary" id="xfer-hub-balances">Создать с остатков</button>
        <div class="grow"></div>
        <button type="button" id="xfer-hub-reload">Обновить</button>`,
    }
  );
  bindFormChrome(() => showSection('warehouse'));
  document.getElementById('xfer-hub-balances')?.addEventListener('click', () => {
    state.whHubTab = 'warehouses';
    openTab('balances');
  });
  document.getElementById('xfer-hub-reload')?.addEventListener('click', () => renderWarehouseRequestsHub());
  view.querySelectorAll('[data-xfer-hist]').forEach((row) => {
    row.onclick = () => {
      const id = row.getAttribute('data-xfer-hist');
      if (!id) return;
      openTab('xfer:' + id, 'Заказ на перемещение');
    };
  });
}

async function renderWarehouses() {
  if (state.whHubTab === 'requests') {
    await renderWarehouseRequestsHub();
    return;
  }
  state.whHubTab = 'warehouses';
  state.balWh = '';
  const viewMode = loadWhView();
  const list = await api(withCompanyId('/warehouses?archived=all'));
  const all = Array.isArray(list) ? list : [];
  const productFilter = state.whProductFilter || null; // { id, label }
  /** @type {Map<string, number>} */
  let qtyByWh = new Map();
  if (productFilter?.id) {
    try {
      const bal = await api(
        withCompanyId(
          '/balances?product_id=' +
            encodeURIComponent(productFilter.id) +
            '&limit=500'
        )
      );
      for (const r of bal.items || []) {
        const wid = String(r.warehouse_id || '');
        if (!wid) continue;
        qtyByWh.set(wid, (qtyByWh.get(wid) || 0) + (Number(r.qty) || 0));
      }
    } catch (_) {
      qtyByWh = new Map();
    }
  }
  const activeAll = sortWarehousesActiveFirst(all.filter((w) => whIsActive(w)));
  const activeList = productFilter?.id
    ? activeAll.filter((w) => qtyByWh.has(w.id) && Number(qtyByWh.get(w.id)) !== 0)
    : activeAll;
  const archivedList = productFilter?.id
    ? []
    : all.filter((w) => !whIsActive(w));
  const moneyCell = (id) =>
    `<td class="mono wh-purchase" data-wh="${esc(id)}">…</td><td class="mono wh-retail" data-wh="${esc(id)}">…</td><td class="mono wh-lines" data-wh="${esc(id)}">…</td>`;
  const qtyBadge = (id) => {
    if (!productFilter?.id) return '';
    const q = qtyByWh.get(id);
    return q != null
      ? `<span class="badge" title="Остаток выбранного товара">остаток ${esc(String(q))}</span>`
      : '';
  };

  let listHtml = '';
  if (!activeList.length) {
    listHtml =
      viewMode === 'cards'
        ? `<p class="muted">${
            productFilter?.id
              ? 'На складах нет остатка этого товара.'
              : 'Нет активных складов'
          }</p>`
        : `<table><tbody><tr><td colspan="6" class="muted">${
            productFilter?.id
              ? 'На складах нет остатка этого товара.'
              : 'Нет активных складов'
          }</td></tr></tbody></table>`;
  } else if (viewMode === 'cards') {
    listHtml = `<div class="wh-cards">${activeList
      .map((w) => {
        const autoSys = whIsAutoSys(w);
        return `
        <article class="wh-card clickable${autoSys ? ' is-sys' : ''}" data-wh-open="${esc(w.id)}" title="Открыть товары на складе" style="cursor:pointer">
          <div class="wh-card-top">
            <span class="mono wh-card-code">${esc(w.code)}</span>
            ${autoSys ? whAutoSysMark(w) : '<span class="badge">Активен</span>'}
            ${qtyBadge(w.id)}
          </div>
          <h3 class="wh-card-title">${esc(w.name)}</h3>
          ${
            autoSys
              ? `<div class="wh-card-note muted" style="font-size:12px">${esc(whAutoSysTip(w))}</div>`
              : ''
          }
          <div class="wh-card-metrics">
            <div><span class="muted">Закуп</span><strong class="mono wh-purchase" data-wh="${esc(w.id)}">…</strong></div>
            <div><span class="muted">Розница</span><strong class="mono wh-retail" data-wh="${esc(w.id)}">…</strong></div>
            <div><span class="muted">Поз.</span><strong class="mono wh-lines" data-wh="${esc(w.id)}">…</strong></div>
          </div>
        </article>`;
      })
      .join('')}</div>`;
  } else {
    listHtml = `<div class="table-scroll"><table class="data-table is-dense" data-table-key="warehouses" data-no-col-filter="1">
      <thead><tr>
        <th>Код</th><th>Название</th>
        ${productFilter?.id ? '<th>Остаток товара</th>' : ''}
        <th>Сумма по закупу</th><th>Сумма по рознице</th>
        <th>Кол-во поз.</th><th>Статус</th>
      </tr></thead>
      <tbody>
        ${activeList
          .map((w) => {
            const autoSys = whIsAutoSys(w);
            const qtyCell = productFilter?.id
              ? `<td class="mono"><strong>${esc(String(qtyByWh.get(w.id) ?? 0))}</strong></td>`
              : '';
            return `
          <tr class="clickable ${autoSys ? 'wh-sys-row' : ''}" data-wh-open="${esc(w.id)}" title="${
              autoSys ? esc(whAutoSysTip(w)) : 'Открыть товары на складе'
            }">
            <td class="mono">${esc(w.code)}</td>
            <td>${esc(w.name)}${autoSys ? ` <span class="wh-name-mark">${whAutoSysMark(w)}</span>` : ''}</td>
            ${qtyCell}
            ${moneyCell(w.id)}
            <td>${autoSys ? whAutoSysMark(w, true) : '<span class="badge">Активен</span>'}</td>
          </tr>`;
          })
          .join('')}
      </tbody>
    </table></div>`;
  }

  if (archivedList.length) {
    listHtml += `
      <div class="wh-archived-block">
        <div class="wh-cards-sep">Архивные (${archivedList.length})</div>
        <ul class="wh-archived-list">
          ${archivedList
            .map(
              (w) => `
            <li>
              <span class="mono muted">${esc(w.code)}</span>
              <span class="wh-arch-name">${esc(w.name)}</span>
              <button type="button" class="linkish" data-wh-restore="${esc(w.id)}">Разархивировать</button>
              <button type="button" class="linkish danger" data-wh-purge="${esc(w.id)}" data-wh-purge-name="${esc(
                w.name
              )}">Удалить</button>
            </li>`
            )
            .join('')}
        </ul>
      </div>`;
  }

  const createPanelOpen = !!state.warehousesCreateOpen;
  const toolbar = `
    <button class="primary" type="button" id="wadd2" aria-expanded="${createPanelOpen ? 'true' : 'false'}">${
      createPanelOpen ? 'Свернуть' : 'Создать'
    }</button>
    <div class="form-pagetabs" style="display:inline-flex;margin:0" id="w-view-tabs">
      <button type="button" class="form-pagetab ${viewMode === 'table' ? 'active' : ''}" data-wh-view="table" data-tip="Таблица">
        <svg class="form-pagetab-ico" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
          <rect x="2" y="3" width="12" height="10" rx="1" fill="none" stroke="currentColor" stroke-width="1.4"/>
          <path d="M2 6.5h12M2 10h12M6.5 3v10M10 3v10" fill="none" stroke="currentColor" stroke-width="1.25"/>
        </svg>
        Таблица
      </button>
      <button type="button" class="form-pagetab ${viewMode === 'cards' ? 'active' : ''}" data-wh-view="cards" data-tip="Плашки">
        <svg class="form-pagetab-ico" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
          <rect x="2" y="2.5" width="5.5" height="5.5" rx="1" fill="none" stroke="currentColor" stroke-width="1.35"/>
          <rect x="8.5" y="2.5" width="5.5" height="5.5" rx="1" fill="none" stroke="currentColor" stroke-width="1.35"/>
          <rect x="2" y="8.5" width="5.5" height="5.5" rx="1" fill="none" stroke="currentColor" stroke-width="1.35"/>
          <rect x="8.5" y="8.5" width="5.5" height="5.5" rx="1" fill="none" stroke="currentColor" stroke-width="1.35"/>
        </svg>
        Плашки
      </button>
    </div>
    <div class="grow"></div>
    <div class="find" style="position:relative;min-width:260px">
      <input id="wh-pq" placeholder="Товар → где есть остаток" value="${esc(
        productFilter?.label || ''
      )}" autocomplete="off" />
      <button type="button" class="find-go" id="wh-pq-go">Найти</button>
      ${
        productFilter?.id
          ? '<button type="button" id="wh-pq-clear" title="Сбросить">✕</button>'
          : ''
      }
      <div id="wh-pq-suggest" class="suggest hidden" style="left:0;right:0;top:100%"></div>
    </div>`;

  view.innerHTML = formChrome(
    'Склады',
    `
    <div id="wh-create-panel" class="thin-add-panel"${createPanelOpen ? '' : ' hidden'}>
      <div class="thin-add-panel-head">
        <strong>Новый склад</strong>
        <button type="button" class="linkish" id="wh-create-close" title="Свернуть">Свернуть</button>
      </div>
      <div class="form-grid">
        <label class="span-2">Название
          <input id="wname" placeholder="Например: Склад Москва" autocomplete="off" />
        </label>
        <p class="muted span-2" style="margin:0;font-size:12px">Код и GUID создаются автоматически (как в 1С): WH-000001</p>
      </div>
      <div class="thin-add-panel-actions">
        <button type="button" class="primary" id="wh-create-submit">Создать</button>
        <button type="button" id="wh-create-cancel">Отмена</button>
        <span class="muted" id="wh-create-msg"></span>
      </div>
    </div>
    <p class="muted" style="margin:0 0 8px;font-size:12px">
      ${
        productFilter?.id
          ? `Показаны склады с остатком: <b>${esc(productFilter.label)}</b> · складов: <b>${activeList.length}</b>. Клик — открыть остатки склада.`
          : 'Клик по складу — товары на остатке. Вкладка «Заказы на перемещение» — история заявок между складами.'
      }
    </p>
    ${listHtml}`,
    { sectionId: 'warehouse', entityKind: 'warehouse', toolbar }
  );
  bindFormChrome(() => showSection('warehouse'));
  const openWarehouseStock = (id) => {
    if (!id) return;
    state.balWh = id;
    state.balWhTab = 'stock';
    state.balHistPage = 1;
    state.balPage = 1;
    state.balQ = productFilter?.label
      ? String(productFilter.label).split('—')[0].trim() || ''
      : '';
    const w = (Array.isArray(list) ? list : []).find((x) => x.id === id);
    const tip = w ? entityTitle(w.code, w.name) || 'Склад' : 'Склад';
    openTab('balances', tip);
  };
  view.querySelectorAll('[data-wh-open]').forEach((el) => {
    el.onclick = (e) => {
      if (e.target && e.target.closest && e.target.closest('[data-wh-restore]')) return;
      openWarehouseStock(el.getAttribute('data-wh-open'));
    };
  });
  // Суммы FIFO — отдельно (тяжёлый запрос); список складов не ждёт
  api('/warehouses/stock-totals')
    .then((data) => {
      const items = data.items || [];
      const byId = new Map(items.map((t) => [t.warehouse_id, t]));
      activeList.forEach((w) => {
        const t = byId.get(w.id);
        const purchase = t ? Number(t.value_purchase) || 0 : 0;
        const retail = t ? Number(t.value_retail) || 0 : 0;
        const lines = t && t.lines != null ? t.lines : '—';
        view.querySelectorAll(`.wh-purchase[data-wh="${CSS.escape(w.id)}"]`).forEach((pEl) => {
          pEl.textContent = formatMoney(purchase);
        });
        view.querySelectorAll(`.wh-retail[data-wh="${CSS.escape(w.id)}"]`).forEach((rEl) => {
          rEl.textContent = formatMoney(retail);
        });
        view.querySelectorAll(`.wh-lines[data-wh="${CSS.escape(w.id)}"]`).forEach((lEl) => {
          lEl.textContent = String(lines);
        });
      });
    })
    .catch(() => {
      view.querySelectorAll('.wh-purchase,.wh-retail,.wh-lines').forEach((el) => {
        el.textContent = '—';
      });
    });
  const whCreatePanel = document.getElementById('wh-create-panel');
  const wadd2 = document.getElementById('wadd2');
  const setWhCreateMsg = (t) => {
    const m = document.getElementById('wh-create-msg');
    if (m) m.textContent = t || '';
  };
  const closeWarehouseCreate = () => {
    state.warehousesCreateOpen = false;
    whCreatePanel?.classList.add('hidden');
    if (wadd2) {
      wadd2.textContent = 'Создать';
      wadd2.setAttribute('aria-expanded', 'false');
    }
    setWhCreateMsg('');
  };
  const openWarehouseCreate = () => {
    state.warehousesCreateOpen = true;
    whCreatePanel?.classList.remove('hidden');
    if (wadd2) {
      wadd2.textContent = 'Свернуть';
      wadd2.setAttribute('aria-expanded', 'true');
    }
    setWhCreateMsg('');
    setTimeout(() => document.getElementById('wname')?.focus(), 0);
  };
  if (wadd2) {
    wadd2.onclick = () => {
      if (state.warehousesCreateOpen) closeWarehouseCreate();
      else openWarehouseCreate();
    };
  }
  document.getElementById('wh-create-close')?.addEventListener('click', closeWarehouseCreate);
  document.getElementById('wh-create-cancel')?.addEventListener('click', closeWarehouseCreate);
  const whCreateSubmit = document.getElementById('wh-create-submit');
  if (whCreateSubmit) {
    whCreateSubmit.onclick = async () => {
      whCreateSubmit.disabled = true;
      setWhCreateMsg('');
      try {
        const name = String(document.getElementById('wname')?.value || '').trim();
        if (!name) {
          document.getElementById('wname')?.focus();
          throw new Error('Укажите название');
        }
        await api('/warehouses', {
          method: 'POST',
          body: JSON.stringify({
            name,
            company_id: getFilterCompanyId() || undefined,
          }),
        });
        state.warehousesCreateOpen = false;
        await renderWarehouses();
      } catch (e) {
        setWhCreateMsg(e.message || String(e));
        whCreateSubmit.disabled = false;
      }
    };
    document.getElementById('wname')?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        whCreateSubmit.click();
      }
    });
  }
  view.querySelectorAll('[data-wh-view]').forEach((btn) => {
    btn.onclick = () => {
      saveWhView(btn.dataset.whView);
      renderWarehouses();
    };
  });
  view.querySelectorAll('[data-wh-restore]').forEach((btn) => {
    btn.onclick = async () => {
      const id = btn.getAttribute('data-wh-restore');
      if (!id) return;
      btn.disabled = true;
      try {
        await api('/warehouses/' + encodeURIComponent(id), {
          method: 'PATCH',
          body: JSON.stringify({ is_active: true }),
        });
        await renderWarehouses();
      } catch (e) {
        btn.disabled = false;
        alert(e.message || 'Не удалось вернуть из архива');
      }
    };
  });
  view.querySelectorAll('[data-wh-purge]').forEach((btn) => {
    btn.onclick = async () => {
      const id = btn.getAttribute('data-wh-purge');
      const name = btn.getAttribute('data-wh-purge-name') || id;
      if (!id) return;
      if (!confirm(`Удалить склад «${name}» безвозвратно?\nМожно только если нет документов и остатков.`)) {
        return;
      }
      btn.disabled = true;
      try {
        await api('/warehouses/' + encodeURIComponent(id), { method: 'DELETE' });
        await renderWarehouses();
      } catch (e) {
        btn.disabled = false;
        alert(e.message || 'Не удалось удалить');
      }
    };
  });

  const pq = document.getElementById('wh-pq');
  const pqSuggest = document.getElementById('wh-pq-suggest');
  const applyProductFilter = (id, label) => {
    state.whProductFilter = id ? { id, label: label || id } : null;
    renderWarehouses();
  };
  document.getElementById('wh-pq-clear')?.addEventListener('click', () => {
    applyProductFilter('', '');
  });
  const runPqSuggest = debounce(async () => {
    const q = String(pq?.value || '').trim();
    if (q.length < 2) {
      pqSuggest.classList.add('hidden');
      pqSuggest.innerHTML = '';
      return;
    }
    const data = await api('/products?limit=20&q=' + encodeURIComponent(q));
    const items = data.items || [];
    pqSuggest.innerHTML = items.length
      ? items
          .map(
            (p) =>
              `<button type="button" class="suggest-item" data-id="${esc(p.id)}" data-label="${esc(
                p.sku + ' — ' + productTitle(p)
              )}">
                <span class="mono">${esc(p.sku)}</span> ${esc(productTitle(p))}
              </button>`
          )
          .join('')
      : '<div class="suggest-empty muted">Нет совпадений</div>';
    pqSuggest.classList.remove('hidden');
    pqSuggest.querySelectorAll('.suggest-item').forEach((btn) => {
      btn.onclick = () => applyProductFilter(btn.dataset.id, btn.dataset.label);
    });
  }, 250);
  if (pq) {
    pq.oninput = () => {
      if (!String(pq.value || '').trim() && productFilter?.id) {
        applyProductFilter('', '');
        return;
      }
      runPqSuggest();
    };
    pq.onkeydown = (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        const first = pqSuggest.querySelector('.suggest-item');
        if (first) first.click();
      }
    };
  }
  document.getElementById('wh-pq-go')?.addEventListener('click', () => {
    const first = pqSuggest.querySelector('.suggest-item');
    if (first) first.click();
    else runPqSuggest();
  });
  view.addEventListener('click', (e) => {
    if (!pqSuggest.contains(e.target) && e.target !== pq) pqSuggest.classList.add('hidden');
  });
}

const KIND_RU = {
  supplier: 'Поставщик',
  buyer: 'Покупатель',
  both: 'Поставщик и покупатель',
};

function kindLabel(kind) {
  const k = String(kind || '')
    .trim()
    .toLowerCase();
  return KIND_RU[k] || (k ? String(kind) : '—');
}

function partyKindOf(c) {
  const pk = String(c?.party_kind_effective || c?.party_kind || '')
    .trim()
    .toLowerCase();
  if (pk === 'legal' || pk === 'ip' || pk === 'person') return pk;
  const inn = String(c?.inn || '').replace(/\D/g, '');
  if (inn.length === 10) return 'legal';
  if (inn.length === 12) return 'ip';
  return 'person';
}

function partyKindLabel(c) {
  const pk = typeof c === 'string' ? c : partyKindOf(c);
  const base = pk === 'legal' ? 'Юрлицо' : pk === 'ip' ? 'ИП' : pk === 'person' ? 'Физлицо' : '—';
  if (typeof c === 'object' && c && Number(c.is_partner) === 1) {
    return base === '—' ? 'Партнёр' : base + ' · партнёр';
  }
  return base;
}

/** Подтянуть реквизиты из карточки контрагента в поля документа (для вкладки «Контрагент»). */
function mergeCounterpartyIntoDoc(d, cp) {
  if (!d || !cp) return d;
  const pick = (fromCp, fromDoc) => {
    const a = String(fromCp ?? '').trim();
    if (a) return a;
    return String(fromDoc ?? '').trim();
  };
  return {
    ...d,
    counterparty: pick(cp.name, d.counterparty) || d.counterparty,
    counterparty_inn: pick(cp.inn, d.counterparty_inn),
    counterparty_party_kind: pick(cp.party_kind, d.counterparty_party_kind),
    counterparty_phone: pick(cp.phone, d.counterparty_phone),
    counterparty_kpp: pick(cp.kpp, d.counterparty_kpp),
    counterparty_ogrn: pick(cp.ogrn, d.counterparty_ogrn),
    counterparty_address: pick(cp.address, d.counterparty_address),
    counterparty_name_full: pick(cp.name_full, d.counterparty_name_full),
    counterparty_email: pick(cp.email, d.counterparty_email),
    counterparty_kind: pick(cp.kind, d.counterparty_kind),
  };
}

/** Данные контрагента документа → строки реквизитов. */
function docCounterpartyRows(d, opts = {}) {
  const role = opts.role || 'Контрагент';
  const cpLike = {
    party_kind: d.counterparty_party_kind,
    inn: d.counterparty_inn,
    name: d.counterparty,
  };
  const pk = partyKindOf(cpLike);
  const pkLabel = partyKindLabel(pk);
  const phones = splitPhonesList(d.counterparty_phone || '').map((p) => formatPhone(p) || p);
  const shortName = String(d.counterparty || '').trim() || '—';
  const fullName = String(d.counterparty_name_full || '').trim();
  const roleFromKind = kindLabel(d.counterparty_kind);
  const roleShow =
    roleFromKind && roleFromKind !== '—'
      ? roleFromKind
      : role && role !== 'Контрагент'
        ? role
        : '—';
  return {
    role,
    pk,
    pkLabel,
    name: fullName || shortName,
    rows: [
      ['Имя', shortName],
      fullName && fullName !== shortName ? ['Полное имя', fullName] : null,
      ['Роль', roleShow],
      ['Тип', pkLabel],
      pk !== 'person' || d.counterparty_inn ? ['ИНН', d.counterparty_inn || '—'] : null,
      pk === 'legal' ? ['КПП', d.counterparty_kpp || '—'] : null,
      pk === 'legal' || pk === 'ip'
        ? [pk === 'ip' ? 'ОГРНИП' : 'ОГРН', d.counterparty_ogrn || '—']
        : null,
      ['Телефон', phones.length ? phones.join(', ') : '—'],
      ['Email', d.counterparty_email || '—'],
      ['Адрес', d.counterparty_address || '—'],
    ].filter(Boolean),
  };
}

/** Короткая строка контрагента на вкладке «Документ». */
function renderDocCounterpartyBrief(d, opts = {}) {
  const role = opts.role || 'Контрагент';
  if (!d.counterparty_id && !d.counterparty) {
    return `<label>${esc(role)}<input value="—" readonly /></label>`;
  }
  const { pkLabel, name } = docCounterpartyRows(d, opts);
  return `<label class="span-2">${esc(role)}
    <input value="${esc(pkLabel + ' · ' + name)}" readonly />
  </label>`;
}

/** Вкладка «Контрагент» — реквизиты связанного контрагента. */
function renderDocCounterpartyPane(d, opts = {}) {
  if (!d.counterparty_id && !d.counterparty) {
    return `<p class="muted" style="margin:0">Контрагент в документе не указан.</p>`;
  }
  const { pk, pkLabel, name, rows } = docCounterpartyRows(d, opts);
  return `
    <h3 class="form-section-title" style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
      <span class="badge ${pk === 'person' ? 'muted' : pk === 'ip' ? 'draft' : ''}">${esc(pkLabel)}</span>
      <span>${esc(name)}</span>
    </h3>
    <div class="cp-doc-body" style="margin:0">
      <dl class="cp-doc-dl">
        ${rows
          .map(
            ([k, v]) =>
              `<div><dt>${esc(k)}</dt><dd class="${
                k === 'ИНН' || k === 'КПП' || k === 'ОГРН' || k === 'ОГРНИП' ? 'mono' : ''
              }">${esc(v)}</dd></div>`
          )
          .join('')}
      </dl>
      ${
        d.counterparty_id
          ? `<div class="toolbar" style="margin:12px 0 0;padding:0">
              <button type="button" id="doc-open-cp" title="Открыть в новой вкладке">Открыть карточку</button>
            </div>`
          : ''
      }
    </div>`;
}

/** Раскрывающийся блок нашей организации на карточке документа. */
function renderDocOrganizationBlock(d) {
  const hasOrg =
    d.organization_id ||
    String(d.organization_name || '').trim() ||
    String(d.organization_inn || '').trim();
  if (!hasOrg) {
    return `<label>Юрлицо<input value="—" readonly /></label>`;
  }
  const name =
    String(d.organization_short_name || '').trim() ||
    String(d.organization_name || '').trim() ||
    '—';
  const fullName = String(d.organization_name || '').trim();
  const inn = String(d.organization_inn || '').replace(/\D/g, '');
  const pk =
    inn.length === 10 ? 'legal' : inn.length === 12 ? 'ip' : 'legal';
  const pkLabel = partyKindLabel(pk);
  const rows = [
    ['Тип', pkLabel + (Number(d.organization_is_default) === 1 ? ' · по умолчанию' : '')],
    fullName && fullName !== name ? ['Полное название', fullName] : null,
    d.organization_inn ? ['ИНН', d.organization_inn] : null,
    pk === 'legal' && d.organization_kpp ? ['КПП', d.organization_kpp] : null,
    d.organization_ogrnip
      ? [pk === 'ip' ? 'ОГРНИП' : 'ОГРН', d.organization_ogrnip]
      : null,
    d.organization_phone ? ['Телефон', d.organization_phone] : null,
    d.organization_address ? ['Адрес', d.organization_address] : null,
    d.organization_director ? ['Руководитель', d.organization_director] : null,
    d.organization_bank ? ['Банк', d.organization_bank] : null,
    d.organization_bik ? ['БИК', d.organization_bik] : null,
    d.organization_rs ? ['Р/с', d.organization_rs] : null,
    d.organization_ks ? ['К/с', d.organization_ks] : null,
    d.organization_vat_rate != null && d.organization_vat_rate !== ''
      ? ['НДС, %', String(d.organization_vat_rate)]
      : null,
  ].filter(Boolean);
  return `
    <div class="cp-doc-block span-2">
      <details class="cp-doc-details">
        <summary>
          <span class="badge">${esc(pkLabel)}</span>
          <span class="cp-doc-name">${esc(name)}</span>
          <span class="muted cp-doc-hint">юрлицо · реквизиты</span>
        </summary>
        <div class="cp-doc-body">
          <dl class="cp-doc-dl">
            ${rows
              .map(
                ([k, v]) =>
                  `<div><dt>${esc(k)}</dt><dd class="${
                    ['ИНН', 'КПП', 'ОГРН', 'ОГРНИП', 'БИК', 'Р/с', 'К/с'].includes(k) ? 'mono' : ''
                  }">${esc(v)}</dd></div>`
              )
              .join('')}
          </dl>
          <div class="toolbar" style="margin:10px 0 0;padding:0">
            <button type="button" id="doc-open-org">Справочник организаций</button>
          </div>
        </div>
      </details>
    </div>`;
}

/** Разбор склейки телефонов → [тел1, тел2]. Лишнее остаётся во втором через запятую. */
function splitPhones(raw) {
  const s = String(raw || '').trim();
  if (!s) return ['', ''];
  const parts = s
    .split(/[,;/\n\r]+/)
    .map((p) => p.trim())
    .filter(Boolean);
  if (!parts.length) return ['', ''];
  if (parts.length === 1) return [parts[0], ''];
  return [parts[0], parts.slice(1).join(', ')];
}

/** Все номера из склейки по отдельности. */
function splitPhonesList(raw) {
  return String(raw || '')
    .split(/[,;/\n\r]+/)
    .map((p) => p.trim())
    .filter(Boolean);
}

function joinPhones(...phones) {
  const list =
    phones.length === 1 && Array.isArray(phones[0]) ? phones[0] : phones;
  return list
    .map((p) => String(p || '').trim())
    .filter(Boolean)
    .join(', ');
}

/**
 * Подсказки DaData под input (ФИО / адрес / party).
 * fetchItems(q) → Promise<{ value: string, hint?: string }[]>
 */
function bindDadataSuggest(input, suggestEl, fetchItems, opts = {}) {
  if (!input || !suggestEl) return () => {};
  let timer = 0;
  let seq = 0;
  let items = [];
  const minLen = opts.minLen ?? 2;
  const hide = () => {
    suggestEl.classList.add('hidden');
    suggestEl.innerHTML = '';
  };
  const render = (list) => {
    items = list || [];
    if (!items.length) {
      hide();
      return;
    }
    suggestEl.classList.remove('hidden');
    suggestEl.innerHTML = items
      .map(
        (it, i) =>
          `<button type="button" class="suggest-item" data-i="${i}">${esc(it.value)}${
            it.hint ? ` <span class="muted">${esc(it.hint)}</span>` : ''
          }</button>`
      )
      .join('');
    suggestEl.querySelectorAll('[data-i]').forEach((btn) => {
      btn.onmousedown = (e) => e.preventDefault();
      btn.onclick = () => {
        const it = items[Number(btn.dataset.i)];
        if (!it) return;
        input.value = it.value;
        hide();
        if (typeof opts.onPick === 'function') opts.onPick(it);
        input.dispatchEvent(new Event('change', { bubbles: true }));
      };
    });
  };
  const run = async () => {
    const q = String(input.value || '').trim();
    if (q.length < minLen) {
      hide();
      return;
    }
    if (typeof opts.enabled === 'function' && !opts.enabled()) {
      hide();
      return;
    }
    const my = ++seq;
    try {
      const list = await fetchItems(q);
      if (my !== seq) return;
      render(list);
    } catch (_) {
      if (my === seq) hide();
    }
  };
  input.addEventListener('input', () => {
    window.clearTimeout(timer);
    timer = window.setTimeout(run, 280);
  });
  input.addEventListener('focus', () => {
    if (String(input.value || '').trim().length >= minLen) run();
  });
  input.addEventListener('blur', () => {
    window.setTimeout(hide, 150);
  });
  return hide;
}

const PHONE_FORMAT_DEFAULT = 'plus7_spaced';

/** RU 10 цифр абонента; иначе null (короткий / иностранный). */
function parseRuSubscriber(raw) {
  const d = String(raw ?? '').replace(/\D/g, '');
  if (!d) return null;
  if (d.length === 11 && (d[0] === '7' || d[0] === '8')) return d.slice(1);
  if (d.length === 10) return d;
  return null;
}

function formatRuSubscriber(sub, style) {
  const a = sub.slice(0, 3);
  const b = sub.slice(3, 6);
  const c = sub.slice(6, 8);
  const e = sub.slice(8, 10);
  if (style === 'eight_spaced') return `8 (${a}) ${b}-${c}-${e}`;
  if (style === 'digits7') return `7${sub}`;
  if (style === 'plus7_digits') return `+7${sub}`;
  return `+7 (${a}) ${b}-${c}-${e}`;
}

/** Один номер → выбранный стандарт. Нераспознанное оставляем. */
function formatPhone(raw, style) {
  const s = String(raw ?? '').trim();
  if (!s) return '';
  const st = style || state.phoneFormat || PHONE_FORMAT_DEFAULT;
  if (st === 'off') return s;
  const sub = parseRuSubscriber(s);
  if (!sub) return s;
  return formatRuSubscriber(sub, st);
}

/** Поле с несколькими телефонами (запятая/;/). */
function formatPhoneField(raw, style) {
  const s = String(raw ?? '').trim();
  if (!s) return '';
  const st = style || state.phoneFormat || PHONE_FORMAT_DEFAULT;
  if (st === 'off') return s;
  return s
    .split(/[,;/\n\r]+/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => formatPhone(p, st))
    .join(', ');
}

function bindPhoneNormalize(el) {
  if (!el) return;
  el.addEventListener('blur', () => {
    const next = formatPhone(el.value);
    if (next !== el.value) el.value = next;
  });
}

async function loadPhoneSettings() {
  try {
    const s = await api('/ui-settings');
    if (s && s.phone_format) state.phoneFormat = s.phone_format;
  } catch {
    /* keep default */
  }
}

function docTypeLabel(t) {
  if (t === 'in') return 'Приходная';
  if (t === 'out') return 'Расходная';
  if (t === 'transfer') return 'Перемещение';
  if (t === 'return') return 'Возврат от клиента';
  return t || '—';
}

function orientLabel(o) {
  if (o === 'portrait') return 'Вертикальное';
  if (o === 'landscape') return 'Горизонтальное';
  if (o === 'square') return 'Квадрат';
  return '';
}

function kindSelectHtml(selected, id) {
  const cur = String(selected || 'supplier') === 'buyer' ? 'buyer' : 'supplier';
  return `<label>Тип<select id="${id}">
    <option value="supplier" ${cur === 'supplier' ? 'selected' : ''}>Поставщик</option>
    <option value="buyer" ${cur === 'buyer' ? 'selected' : ''}>Покупатель</option>
  </select></label>`;
}

async function renderCounterpartyDetail(id, pageTab = 'main') {
  if (state.cpDocsFocusId !== id) {
    state.cpDocsFocusId = id;
    state.cpDocsPage = 1;
  }
  const docsLimit = getPageSize('cp-docs', 50);
  const docsPageReq = Math.max(1, Number(state.cpDocsPage) || 1);
  const c = await api(
    '/counterparties/' +
      encodeURIComponent(id) +
      '?docs_page=' +
      docsPageReq +
      '&docs_limit=' +
      docsLimit
  );
  const kindLabelRu =
    c.kind === 'buyer'
      ? 'Покупатель'
      : c.kind === 'supplier'
        ? 'Поставщик'
        : c.kind === 'both'
          ? 'Покупатель и поставщик'
          : 'Контрагент';
  const title = String(c.name || '').trim() || 'Контрагент';
  const sectionLabel = `Контрагент · ${kindLabelRu}`;
  const tabId = 'company:' + id;
  if (!state.tabs.find((t) => t.id === tabId)) {
    state.tabs.push({ id: tabId, title: (c.name || 'Контрагент').slice(0, 40), closable: true });
  } else {
    const t = state.tabs.find((x) => x.id === tabId);
    if (t) t.title = (c.name || 'Контрагент').slice(0, 40);
  }
  state.activeTab = tabId;
  renderTabs();
  showForm();
  highlightSection(sectionForTab(tabId));
  setUrl(pathForTab(tabId));
  // kind=both из 1С/БД → в форме роли показываем покупателя (не оба сразу)
  const kindUi = c.kind === 'supplier' ? 'supplier' : 'buyer';
  const docs = Array.isArray(c.docs) ? c.docs : [];
  const docsTotal = Number(c.docs_total) || 0;
  const docsPage = Number(c.docs_page) || 1;
  const docsPages = Number(c.docs_pages) || 1;
  state.cpDocsPage = docsPage;
  const docsKindTitle = 'Складские документы';
  const backList =
    state.cpMode === 'supplier'
      ? 'suppliers'
      : state.cpMode === 'buyer'
        ? 'buyers'
        : 'counterparties';
  const phonesList = splitPhonesList(c.phone).map((p) => formatPhone(p));
  const phone1 = phonesList[0] || '';
  const phonesRest = phonesList.slice(1);
  const partyUi = (() => {
    const pk = String(c.party_kind || '');
    if (pk === 'legal' || pk === 'ip' || pk === 'person') return pk;
    const inn = String(c.inn || '').replace(/\D/g, '');
    if (inn.length === 10) return 'legal';
    if (inn.length === 12) return 'ip';
    return 'person';
  })();

  const mainBody = `
    <h3 class="form-section-title">Классификация</h3>
    <div class="form-fields">
      <div class="field span-2">
        <span>Роль</span>
        ${radioPillsHtml('ce-kind', [
          { value: 'buyer', label: 'Покупатель' },
          { value: 'supplier', label: 'Поставщик' },
        ], kindUi)}
      </div>
      <div class="field span-2">
        <span>Кто</span>
        ${radioPillsHtml('ce-party', [
          { value: 'person', label: 'Физлицо' },
          { value: 'ip', label: 'ИП' },
          { value: 'legal', label: 'Юрлицо' },
        ], partyUi)}
      </div>
      <div class="field span-2">
        <span>Партнёр</span>
        ${radioPillsHtml('ce-partner', [
          { value: '0', label: 'Нет' },
          { value: '1', label: 'Да' },
        ], Number(c.is_partner) === 1 ? '1' : '0')}
      </div>
    </div>
    <h3 class="form-section-title">О контрагенте</h3>
    <div class="form-fields">
      <div class="field span-2">
        <span id="ce-name-label">Имя / наименование</span>
        <input id="ce-name" value="${esc(c.name || '')}" autocomplete="off" />
        <div id="ce-name-suggest" class="suggest hidden"></div>
      </div>
      <div class="field span-2" id="ce-field-name-full" ${partyUi === 'legal' ? '' : 'hidden'}>
        <span id="ce-name-full-label">Полное наименование</span>
        <input id="ce-name-full" value="${esc(c.name_full || '')}" placeholder="как в учредительных документах" />
      </div>
      <div class="field" id="ce-field-inn" ${partyUi === 'person' ? 'hidden' : ''}>
        <span>ИНН</span>
        <input id="ce-inn" class="mono" value="${esc(c.inn || '')}" placeholder="10 или 12 цифр — реквизиты подтянутся сами" />
      </div>
      <div class="field" id="ce-field-kpp" ${partyUi === 'legal' ? '' : 'hidden'}>
        <span>КПП</span>
        <input id="ce-kpp" class="mono" value="${esc(c.kpp || '')}" placeholder="9 цифр" />
      </div>
      <div class="field" id="ce-field-ogrn" ${partyUi === 'person' ? 'hidden' : ''}>
        <span id="ce-ogrn-label">${partyUi === 'ip' ? 'ОГРНИП' : 'ОГРН'}</span>
        <input id="ce-ogrn" class="mono" value="${esc(c.ogrn || '')}" placeholder="${partyUi === 'ip' ? 'ОГРНИП' : 'не указан'}" />
      </div>
      <div class="field">
        <span>Email</span>
        <input id="ce-email" type="email" value="${esc(c.email || '')}" placeholder="не указан" />
      </div>
    </div>
    <h3 class="form-section-title">Адреса, телефоны</h3>
    <div class="form-fields">
      <div class="field span-2">
        <span>Адрес</span>
        <input id="ce-address" value="${esc(c.address || '')}" placeholder="юридический адрес" autocomplete="off" />
        <div id="ce-address-suggest" class="suggest hidden"></div>
      </div>
      <div class="field">
        <span>Телефон 1</span>
        <div class="field-control">
          <input id="ce-phone1" class="ce-phone" value="${esc(phone1)}" placeholder="не указан" />
          <button type="button" id="ce-phone-add" title="Добавить ещё телефон" aria-label="Добавить телефон">+</button>
        </div>
      </div>
      <div id="ce-phones-extra" class="span-2 cphones-extra">
        ${phonesRest
          .map(
            (p, i) => `
          <div class="field ce-phone-row">
            <span class="ce-phone-label">Телефон ${i + 2}</span>
            <div class="field-control">
              <input class="ce-phone" value="${esc(p)}" placeholder="не указан" />
              <button type="button" class="ce-phone-del" title="Убрать">×</button>
            </div>
          </div>`
          )
          .join('')}
      </div>
    </div>
    ${(() => {
      const amoContacts = Array.isArray(c.amo_contacts) ? c.amo_contacts : [];
      const amoCompanies = Array.isArray(c.amo_companies) ? c.amo_companies : [];
      if (!amoContacts.length && !amoCompanies.length && !c.amo_company_id && !c.amo_contact_id) {
        return '';
      }
      return `
    <h3 class="form-section-title">AmoCRM</h3>
    <div class="form-fields">
      ${
        c.amo_url
          ? `<div class="field span-2"><span>Карточка в Amo</span><div><a href="${esc(c.amo_url)}" target="_blank" rel="noopener">Открыть в Amo</a></div></div>`
          : ''
      }
      ${
        c.amo_company_id
          ? `<div class="field"><span>Amo company id</span><input class="mono" value="${esc(c.amo_company_id)}" readonly /></div>`
          : ''
      }
      ${
        c.amo_contact_id
          ? `<div class="field"><span>Amo contact id</span><input class="mono" value="${esc(c.amo_contact_id)}" readonly /></div>`
          : ''
      }
      ${
        c.email
          ? `<div class="field"><span>Email</span><input value="${esc(c.email)}" readonly /></div>`
          : ''
      }
    </div>
    ${
      amoCompanies.length
        ? `<p class="muted" style="margin:8px 0 4px">Связанные компании</p>
           <table><thead><tr><th>Название</th><th>ИНН</th><th>Телефон</th></tr></thead><tbody>
           ${amoCompanies
             .map(
               (x) =>
                 `<tr class="clickable" data-open-cp="${esc(x.id)}"><td>${esc(x.name || '')}</td><td class="mono">${esc(x.inn || '')}</td><td>${esc(formatPhoneField(x.phone || ''))}</td></tr>`
             )
             .join('')}
           </tbody></table>`
        : ''
    }
    ${
      amoContacts.length
        ? `<p class="muted" style="margin:8px 0 4px">Связанные контакты</p>
           <table><thead><tr><th>Имя</th><th>ИНН</th><th>Телефон</th></tr></thead><tbody>
           ${amoContacts
             .map(
               (x) =>
                 `<tr class="clickable" data-open-cp="${esc(x.id)}"><td>${esc(x.name || '')}</td><td class="mono">${esc(x.inn || '')}</td><td>${esc(formatPhoneField(x.phone || ''))}</td></tr>`
             )
             .join('')}
           </tbody></table>`
        : ''
    }`;
    })()}
    <div class="form-actions">
      <button class="primary" type="button" id="ce-save">Записать</button>
      <span class="muted" id="ce-msg"></span>
    </div>`;

  const docsPager =
    docsTotal > 0
      ? pagerHtml('cp-docs-pager', docsPage, docsPages, docsTotal, {
          limit: docsLimit,
          listKey: 'cp-docs',
        })
      : '';
  const docsBody = `
    <h3 class="form-section-title">${esc(docsKindTitle)} <span class="muted">(${docsTotal})</span></h3>
    <p class="muted" style="margin:0 0 8px;font-size:12px">Приходы, расходы и возвраты, где контрагент в шапке. Число совпадает с колонкой «Документы» в списке.</p>
    ${docsPager}
    ${
      docs.length
        ? `<div class="table-scroll"><table class="data-table is-dense" data-no-col-filter="1" data-table-key="cp-docs">
        <thead><tr><th>Дата</th><th>Тип</th><th>Номер</th><th>Склад</th><th>Сумма</th><th>Статус</th></tr></thead>
        <tbody>
          ${docs
            .map(
              (d) =>
                `<tr class="clickable" data-doc="${esc(d.id)}">
                  <td>${esc(String(d.doc_date || '').slice(0, 10))}</td>
                  <td>${esc(docTypeLabel(d.doc_type))}</td>
                  <td class="mono">${esc(d.number || '')}</td>
                  <td>${esc(d.warehouse || '—')}</td>
                  <td class="mono">${d.amount != null ? formatMoney(d.amount) : '—'}</td>
                  <td><span class="badge ${d.posted ? '' : 'draft'}">${d.posted ? 'Проведён' : 'Черновик'}${d.source === '1c' ? ' · 1С' : ''}</span></td>
                </tr>`
            )
            .join('')}
        </tbody>
      </table></div>
      ${docsPager ? docsPager.replace('id="cp-docs-pager"', 'id="cp-docs-pager2"') : ''}`
        : '<p class="muted">Складских документов по этой компании пока нет.</p>'
    }`;

  const historyBody = `
    <h3 class="form-section-title">История изменений</h3>
    <p class="muted" style="margin:0 0 8px">Кто менял карточку контрагента, с какого IP и когда.</p>
    <div id="cp-history" class="entity-history"><p class="muted" style="margin:0">Загрузка…</p></div>`;

  const pageBodies = { main: mainBody, docs: docsBody, history: historyBody };
  const activePage =
    pageTab === 'docs' ? 'docs' : pageTab === 'history' ? 'history' : 'main';

  const showBankTab = partyUi === 'legal' || partyUi === 'ip';
  view.innerHTML = formChrome(title, pageBodies[activePage] || mainBody, {
    section: sectionLabel,
    pageTabs: [
      { id: 'main', label: 'Основное' },
      { id: 'docs', label: 'Документы', count: docsTotal },
      { id: 'history', label: 'История' },
      ...(showBankTab ? [{ id: 'bank', label: 'Банковские счета' }] : []),
    ],
    activePageTab: activePage,
    printId: 'ce-print',
    toolbar: `
      <div class="grow"></div>
      ${archiveIconBtn('ce', Number(c.is_active) === 0)}`,
    metrics:
      Number(c.is_active) === 0
        ? '<span class="badge draft">Архив</span>'
        : '<span class="badge">Активен</span>',
  });
  bindFormChrome(() => openTab(backList));

  view.querySelectorAll('[data-pagetab]').forEach((btn) => {
    btn.onclick = () => {
      const pid = btn.dataset.pagetab;
      if (pid === 'main' || pid === 'docs' || pid === 'history') {
        renderCounterpartyDetail(id, pid);
        return;
      }
      alert('Раздел «' + btn.textContent + '» — в разработке');
    };
  });
  if (activePage === 'history') {
    fillEntityHistory('cp-history', 'counterparty', id);
  }

  const getCePartyKind = () => radioPillsValue('ce-party') || partyUi || 'person';
  const setCePartyKind = (val) => setRadioPillsValue('ce-party', val);
  const syncCePartyFields = (opts = {}) => {
    const clearHidden = !!opts.clearHidden;
    const pk = getCePartyKind();
    const nameLab = document.getElementById('ce-name-label');
    const fullField = document.getElementById('ce-field-name-full');
    const fullLab = document.getElementById('ce-name-full-label');
    const fullInp = document.getElementById('ce-name-full');
    const nameInp = document.getElementById('ce-name');
    const innField = document.getElementById('ce-field-inn');
    const kppField = document.getElementById('ce-field-kpp');
    const ogrnField = document.getElementById('ce-field-ogrn');
    const ogrnLab = document.getElementById('ce-ogrn-label');
    const ogrnInp = document.getElementById('ce-ogrn');
    const innInp = document.getElementById('ce-inn');
    const kppInp = document.getElementById('ce-kpp');
    const addr = document.getElementById('ce-address');
    if (pk === 'legal') {
      if (nameLab) nameLab.textContent = 'Наименование';
      if (fullLab) fullLab.textContent = 'Полное наименование';
      if (fullInp) fullInp.placeholder = 'как в учредительных документах';
      if (nameInp) nameInp.placeholder = 'ООО «…»';
      if (fullField) fullField.hidden = false;
      if (innField) innField.hidden = false;
      if (kppField) kppField.hidden = false;
      if (ogrnField) ogrnField.hidden = false;
      if (ogrnLab) ogrnLab.textContent = 'ОГРН';
      if (ogrnInp) ogrnInp.placeholder = 'ОГРН';
      if (innInp) innInp.placeholder = '10 цифр — реквизиты подтянутся сами';
      if (addr) addr.placeholder = 'юридический адрес';
    } else if (pk === 'ip') {
      if (nameLab) nameLab.textContent = 'ФИО ИП';
      if (nameInp) nameInp.placeholder = 'Иванов Иван Иванович';
      // одно ФИО достаточно — полное дублирует
      if (fullField) fullField.hidden = true;
      if (innField) innField.hidden = false;
      if (kppField) kppField.hidden = true;
      if (ogrnField) ogrnField.hidden = false;
      if (ogrnLab) ogrnLab.textContent = 'ОГРНИП';
      if (ogrnInp) ogrnInp.placeholder = 'ОГРНИП';
      if (innInp) innInp.placeholder = '12 цифр — реквизиты подтянутся сами';
      if (addr) addr.placeholder = 'адрес регистрации';
      if (clearHidden && kppInp) kppInp.value = '';
    } else {
      if (nameLab) nameLab.textContent = 'ФИО';
      if (nameInp) nameInp.placeholder = 'Иванов Иван Иванович';
      // физлицо: только ФИО / телефон / адрес — без ИНН КПП ОГРН
      if (fullField) fullField.hidden = true;
      if (innField) innField.hidden = true;
      if (kppField) kppField.hidden = true;
      if (ogrnField) ogrnField.hidden = true;
      if (addr) addr.placeholder = 'адрес';
      if (clearHidden) {
        if (innInp) innInp.value = '';
        if (kppInp) kppInp.value = '';
        if (ogrnInp) ogrnInp.value = '';
      }
    }
  };
  bindRadioPills(document.getElementById('view'), (name) => {
    if (name === 'ce-party') syncCePartyFields({ clearHidden: true });
  });
  syncCePartyFields();

  const phonesExtraEl = document.getElementById('ce-phones-extra');
  const renumberCePhones = () => {
    [...(phonesExtraEl?.querySelectorAll('.ce-phone-row') || [])].forEach((row, i) => {
      const title = row.querySelector('.ce-phone-label');
      if (title) title.textContent = 'Телефон ' + (i + 2);
    });
  };
  const bindCePhoneRow = (row) => {
    const inp = row.querySelector('input.ce-phone');
    bindPhoneNormalize(inp);
    row.querySelector('.ce-phone-del')?.addEventListener('click', () => {
      row.remove();
      renumberCePhones();
    });
  };
  phonesExtraEl?.querySelectorAll('.ce-phone-row').forEach((row) => bindCePhoneRow(row));
  bindPhoneNormalize(document.getElementById('ce-phone1'));
  document.getElementById('ce-phone-add')?.addEventListener('click', () => {
    if (!phonesExtraEl) return;
    const n = 2 + phonesExtraEl.querySelectorAll('.ce-phone').length;
    const row = document.createElement('div');
    row.className = 'field ce-phone-row';
    row.innerHTML = `<span class="ce-phone-label">Телефон ${n}</span>
      <div class="field-control">
        <input class="ce-phone" placeholder="не указан" />
        <button type="button" class="ce-phone-del" title="Убрать">×</button>
      </div>`;
    phonesExtraEl.appendChild(row);
    bindCePhoneRow(row);
    row.querySelector('input.ce-phone')?.focus();
  });

  const saveCp = async () => {
    const msg = document.getElementById('ce-msg');
    const btn = document.getElementById('ce-save');
    if (btn) btn.disabled = true;
    if (msg) msg.textContent = 'Сохранение…';
    const kindVal = radioPillsValue('ce-kind') || kindUi;
    const phoneVal = joinPhones(
      [...document.querySelectorAll('#view .ce-phone')].map((el) => formatPhone(el.value))
    );
    const pk = getCePartyKind();
    const nameVal = document.getElementById('ce-name')?.value ?? c.name;
    // физлицо / ИП: одно ФИО; полное копируем из основного
    const nameFullVal =
      pk === 'legal'
        ? document.getElementById('ce-name-full')?.value ?? c.name_full ?? ''
        : String(nameVal || '').trim();
    const innVal =
      pk === 'person' ? '' : document.getElementById('ce-inn')?.value ?? c.inn ?? '';
    const kppVal =
      pk === 'legal' ? document.getElementById('ce-kpp')?.value ?? c.kpp ?? '' : '';
    const ogrnVal =
      pk === 'person' ? '' : document.getElementById('ce-ogrn')?.value ?? c.ogrn ?? '';
    try {
      const r = await api('/counterparties/' + id, {
        method: 'PATCH',
        body: JSON.stringify({
          name: nameVal,
          name_full: nameFullVal,
          inn: innVal,
          kpp: kppVal,
          ogrn: ogrnVal,
          address: document.getElementById('ce-address')?.value ?? c.address ?? '',
          email: document.getElementById('ce-email')?.value ?? c.email ?? '',
          phone: phoneVal,
          kind: kindVal === 'supplier' ? 'supplier' : 'buyer',
          party_kind: pk,
          is_partner: radioPillsValue('ce-partner') === '1' ? 1 : 0,
        }),
      });
      const amo = r.amo || {};
      let amoMsg = '';
      if (amo.error === 'no_amo_link') {
        amoMsg = '';
      } else if (amo.ok === false) {
        amoMsg = ' · Amo: ' + (amo.error || 'ошибка');
      } else if (Array.isArray(amo.results)) {
        const filled = amo.results
          .filter((x) => x && x.ok && Array.isArray(x.filled))
          .flatMap((x) => x.filled);
        if (filled.length) amoMsg = ' · Amo: дозаполнены ' + [...new Set(filled)].join(', ');
        else amoMsg = ' · Amo: без перезаписи (пустые поля проверены)';
      }
      if (msg) msg.textContent = 'Сохранено' + amoMsg;
      setTimeout(() => renderCounterpartyDetail(id, pageTab), 250);
    } catch (e) {
      if (msg) msg.textContent = e.message;
      if (btn) btn.disabled = false;
    }
  };
  const saveBtn = document.getElementById('ce-save');
  if (saveBtn) saveBtn.onclick = () => saveCp();

  const applyDadataParty = (party) => {
    if (!party) return;
    const set = (elId, val) => {
      const el = document.getElementById(elId);
      if (el && val != null) el.value = String(val);
    };
    set('ce-name', party.name || party.value || '');
    set('ce-name-full', party.name_full || party.name || '');
    set('ce-inn', party.inn || '');
    set('ce-kpp', party.kpp || '');
    set('ce-ogrn', party.ogrn || '');
    set('ce-address', party.address || '');
    const innDigits = String(party.inn || '').replace(/\D/g, '');
    if (party.type === 'LEGAL' || innDigits.length === 10) setCePartyKind('legal');
    else if (party.type === 'INDIVIDUAL' || innDigits.length === 12) setCePartyKind('ip');
    syncCePartyFields();
  };

  bindDadataSuggest(
    document.getElementById('ce-name'),
    document.getElementById('ce-name-suggest'),
    async (q) => {
      const pk = getCePartyKind();
      if (pk === 'legal') {
        const r = await api('/dadata/party?q=' + encodeURIComponent(q) + '&count=8');
        return (r.items || []).map((p) => ({
          value: p.name || p.value || '',
          hint: p.inn ? 'ИНН ' + p.inn : '',
          party: p,
        }));
      }
      const r = await api('/dadata/fio?q=' + encodeURIComponent(q) + '&count=8');
      return (r.items || []).map((p) => ({
        value: p.value || p.unrestricted_value || '',
        fio: p,
      }));
    },
    {
      minLen: 2,
      onPick: (it) => {
        if (it.party) applyDadataParty(it.party);
        else if (it.fio) {
          const full = document.getElementById('ce-name-full');
          if (full && !String(full.value || '').trim()) full.value = it.value;
        }
      },
    }
  );
  bindDadataSuggest(
    document.getElementById('ce-address'),
    document.getElementById('ce-address-suggest'),
    async (q) => {
      const r = await api('/dadata/address?q=' + encodeURIComponent(q) + '&count=8');
      return (r.items || []).map((p) => ({
        value: p.unrestricted_value || p.value || '',
        hint: p.postal_code || '',
      }));
    },
    { minLen: 3 }
  );

  let ceDadataTimer = null;
  let ceDadataLastInn = '';
  const fillEditFromInn = async (innDigits) => {
    const msg = document.getElementById('ce-msg') || document.getElementById('ce-toolbar-msg');
    if (!(innDigits.length === 10 || innDigits.length === 12)) return;
    if (innDigits === ceDadataLastInn) return;
    ceDadataLastInn = innDigits;
    if (msg) msg.textContent = 'Ищем реквизиты…';
    try {
      const r = await api('/dadata/party/find', {
        method: 'POST',
        body: JSON.stringify({ inn: innDigits }),
      });
      applyDadataParty(r.party);
      await api('/counterparties/' + encodeURIComponent(id) + '/dadata-fill', {
        method: 'POST',
        body: JSON.stringify({ party: r.party }),
      });
      if (msg) {
        const name = r.party?.name || r.party?.value || '';
        msg.textContent = name
          ? 'Реквизиты подтянуты: ' + name + (r.party?.kpp ? ' · КПП ' + r.party.kpp : '')
          : 'По ИНН ничего не найдено';
      }
    } catch (e) {
      if (msg) msg.textContent = e.message || 'Не удалось подтянуть реквизиты';
      ceDadataLastInn = '';
    }
  };
  const ceInn = document.getElementById('ce-inn');
  if (ceInn) {
    const onCeInn = () => {
      const digits = String(ceInn.value || '').replace(/\D/g, '');
      if (digits.length === 10 || digits.length === 12) {
        clearTimeout(ceDadataTimer);
        ceDadataTimer = setTimeout(() => fillEditFromInn(digits), 350);
      } else {
        ceDadataLastInn = '';
      }
    };
    ceInn.addEventListener('input', onCeInn);
    ceInn.addEventListener('blur', onCeInn);
  }

  const printBtn = document.getElementById('ce-print');
  if (printBtn) {
    printBtn.onclick = () => {
      const get = (elId) => String(document.getElementById(elId)?.value || '').trim();
      const pk = getCePartyKind();
      const partyLabel = pk === 'legal' ? 'Юрлицо' : pk === 'ip' ? 'ИП' : 'Физлицо';
      const kindVal = radioPillsValue('ce-kind');
      const kindLabel =
        kindVal === 'supplier' ? 'Поставщик' : kindVal === 'buyer' ? 'Покупатель' : '';
      const phoneVals = [...document.querySelectorAll('#view .ce-phone')]
        .map((el) => String(el.value || '').trim())
        .filter(Boolean);
      const rows = [
        ['Наименование', get('ce-name')],
        ['Полное наименование', get('ce-name-full')],
        ['ИНН', get('ce-inn')],
        ['КПП', get('ce-kpp')],
        [pk === 'ip' ? 'ОГРНИП' : 'ОГРН', get('ce-ogrn')],
        ['Адрес', get('ce-address')],
        ...phoneVals.map((p, i) => [`Телефон ${i + 1}`, p]),
        ['Email', get('ce-email')],
        ['Роль', kindLabel],
        ['Кто', partyLabel],
      ].filter(([, v]) => v);
      const table = rows
        .map(
          ([k, v]) =>
            `<tr><th style="text-align:left;padding:4px 10px 4px 0;color:#64748b;font-weight:500;vertical-align:top;white-space:nowrap">${esc(k)}</th><td style="padding:4px 0">${esc(v)}</td></tr>`
        )
        .join('');
      const w = window.open('', '_blank');
      if (!w) {
        alert('Разрешите всплывающие окна, чтобы открыть карточку для печати');
        return;
      }
      w.document.write(`<!doctype html><html lang="ru"><head><meta charset="utf-8"/><title>${esc(get('ce-name') || 'Контрагент')}</title>
<style>
  body{font:14px/1.45 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#0f172a;margin:24px;max-width:720px}
  h1{font-size:18px;margin:0 0 16px;font-weight:650}
  table{border-collapse:collapse;width:100%}
  .bar{display:flex;gap:8px;margin-bottom:18px}
  .bar button{padding:8px 14px;border:1px solid #cbd5e1;border-radius:8px;background:#0f766e;color:#fff;font-weight:600;cursor:pointer}
  .bar button.sec{background:#fff;color:#0f172a}
  @media print{.bar{display:none} body{margin:0}}
</style></head><body>
  <div class="bar">
    <button type="button" onclick="window.print()">Печать</button>
    <button type="button" class="sec" onclick="window.close()">Закрыть</button>
  </div>
  <h1>Контрагент</h1>
  <table>${table || '<tr><td class="muted">Нет данных</td></tr>'}</table>
</body></html>`);
      w.document.close();
      w.focus();
    };
  }

  const ceArch = document.getElementById('ce-archive');
  if (ceArch) {
    ceArch.onclick = async () => {
      if (!confirm('Перенести контрагента в архив?')) return;
      const msg = document.getElementById('ce-toolbar-msg') || document.getElementById('ce-msg');
      try {
        await api('/counterparties/' + id + '/archive', { method: 'POST', body: '{}' });
        if (msg) msg.textContent = 'В архиве';
        setTimeout(() => renderCounterpartyDetail(id, pageTab), 250);
      } catch (e) {
        if (msg) msg.textContent = e.message;
        alert(e.message || 'Ошибка');
      }
    };
  }
  const ceRestore = document.getElementById('ce-restore');
  if (ceRestore) {
    ceRestore.onclick = async () => {
      const msg = document.getElementById('ce-toolbar-msg') || document.getElementById('ce-msg');
      try {
        await api('/counterparties/' + id, {
          method: 'PATCH',
          body: JSON.stringify({ is_active: true }),
        });
        if (msg) msg.textContent = 'Возвращён';
        setTimeout(() => renderCounterpartyDetail(id, pageTab), 250);
      } catch (e) {
        if (msg) msg.textContent = e.message;
      }
    };
  }

  if (activePage === 'docs') {
    bindListPager(['cp-docs-pager', 'cp-docs-pager2'], 'cp-docs', 'cpDocsPage', () =>
      renderCounterpartyDetail(id, 'docs')
    );
  }
  view.querySelectorAll('[data-doc]').forEach((tr) => {
    tr.onclick = () => openTab('doc:' + tr.dataset.doc);
  });
  view.querySelectorAll('[data-open-cp]').forEach((tr) => {
    tr.onclick = () => openTab('company:' + tr.dataset.openCp);
  });
}

function counterpartiesBackSection(filterKind) {
  if (filterKind === 'supplier') {
    if (canAccessSectionMe('purchases')) return 'purchases';
    if (canAccessSectionMe('warehouse')) return 'warehouse';
    if (canAccessSectionMe('company')) return 'company';
    return 'crm';
  }
  if (filterKind === 'buyer') {
    if (canAccessSectionMe('sales')) return 'sales';
    if (canAccessSectionMe('company')) return 'company';
    return 'crm';
  }
  if (canAccessSectionMe('crm')) return 'crm';
  if (canAccessSectionMe('company')) return 'company';
  return 'warehouse';
}

async function renderCounterparties(mode) {
  // mode: '' | 'supplier' | 'buyer'
  const filterKind = mode === 'supplier' || mode === 'buyer' ? mode : '';
  state.cpMode = filterKind;
  if (state.cpPartyKind === 'partner') {
    state.cpPartyKind = '';
    if (!state.cpPartner) state.cpPartner = '1';
  }
  const q = state.cpQ;
  const page = state.cpPage;
  const partyKind = state.cpPartyKind || '';
  const partnerFilter = state.cpPartner || '';
  const sort = state.cpSort || 'created';
  const dir = state.cpSortDir === 'asc' ? 'asc' : 'desc';
  const limit = getPageSize('counterparties', 50);
  const title =
    filterKind === 'supplier' ? 'Поставщики' : filterKind === 'buyer' ? 'Покупатели' : 'Контрагенты';
  const backSection = counterpartiesBackSection(filterKind);
  const data = await api(
    `/counterparties?page=${page}&limit=${limit}` +
      (q ? '&q=' + encodeURIComponent(q) : '') +
      (filterKind ? '&kind=' + encodeURIComponent(filterKind) : '') +
      (partyKind && partyKind !== 'partner' ? '&party_kind=' + encodeURIComponent(partyKind) : '') +
      (partnerFilter === '1' || partnerFilter === '0'
        ? '&is_partner=' + encodeURIComponent(partnerFilter)
        : '') +
      `&sort=${encodeURIComponent(sort)}&dir=${encodeURIComponent(dir)}`
  );
  const list = data.items || [];
  const partyKindDefault = filterKind === 'buyer' ? 'person' : 'legal';
  const createLabel =
    filterKind === 'supplier'
      ? 'Создать поставщика'
      : filterKind === 'buyer'
        ? 'Создать покупателя'
        : 'Создать';
  const mark = (key) => (sort !== key ? '' : dir === 'asc' ? ' ▲' : ' ▼');
  const th = (key, label) =>
    `<th class="sortable ${sort === key ? 'sorted' : ''}" data-cp-sort="${key}" title="Сортировка">${esc(label)}${mark(key)}</th>`;
  view.innerHTML = formChrome(
    title,
    `
    <p class="muted" style="margin:0 0 8px">Клик по строке — карточка. «Документы» — число складских накладных (приход/расход/возврат). Заголовок колонки — сортировка.</p>
    ${pagerHtml('cpager', data.page, data.pages, data.total, { limit, listKey: 'counterparties' })}
    <table data-no-col-filter="1">
      <thead><tr>
        ${th('created', 'Создан')}
        ${th('name', 'Представление')}
        ${th('inn', 'ИНН')}
        ${th('phone', 'Телефон')}
        ${th('party', 'Кто')}
        ${th('kind', 'Роль')}
        ${th('docs', 'Документы')}
      </tr></thead>
      <tbody>
        ${
          list
            .map((x) => {
              const created = String(x.created_at || '').trim();
              const createdShow = created ? created.slice(0, 10) : '—';
              const docsN = Number(x.docs_count) || 0;
              return `<tr class="clickable" data-open="${esc(x.id)}">
                <td class="mono">${esc(createdShow)}</td>
                <td>${esc(x.name)}</td>
                <td class="mono">${esc(x.inn || '')}</td>
                <td>${esc(formatPhoneField(x.phone || ''))}</td>
                <td>${esc(partyKindLabel(x))}</td>
                <td title="${esc(
                  x.kind_effective && x.kind_effective !== x.kind
                    ? `В карточке: ${kindLabel(x.kind)} · по документам: ${kindLabel(x.kind_effective)}`
                    : kindLabel(x.kind_effective || x.kind)
                )}">${esc(kindLabel(x.kind_effective || x.kind))}</td>
                <td class="mono"><a href="#" class="linkish cp-docs" data-open-docs="${esc(x.id)}" title="Открыть документы">${docsN}</a></td>
              </tr>`;
            })
            .join('') || '<tr><td colspan="7" class="muted">Ничего не найдено</td></tr>'
        }
      </tbody>
    </table>
    ${pagerHtml('cpager2', data.page, data.pages, data.total, { limit, listKey: 'counterparties' })}`,
    {
      toolbar: `
        <div class="cp-toolbar-main">
          <button type="button" class="primary" id="cadd2">${esc(createLabel)}</button>
          <div class="toolbar-filter" role="group" aria-label="Роль">
            <span class="toolbar-filter-label">Роль</span>
            <div class="form-pagetabs" id="cp-kind-tabs" role="tablist">
              <button type="button" class="form-pagetab ${!filterKind ? 'active' : ''}" data-cp-mode="" role="tab" aria-selected="${!filterKind ? 'true' : 'false'}">Все</button>
              <button type="button" class="form-pagetab ${filterKind === 'buyer' ? 'active' : ''}" data-cp-mode="buyer" role="tab" aria-selected="${filterKind === 'buyer' ? 'true' : 'false'}">Покупатели</button>
              <button type="button" class="form-pagetab ${filterKind === 'supplier' ? 'active' : ''}" data-cp-mode="supplier" role="tab" aria-selected="${filterKind === 'supplier' ? 'true' : 'false'}">Поставщики</button>
            </div>
          </div>
          <div class="grow"></div>
          ${uiFind({
            inputId: 'cq',
            btnId: 'csearch',
            placeholder: 'Имя / ИНН / телефон',
            value: q,
          })}
        </div>
        <div class="cp-toolbar-filters">
          <div class="toolbar-filter" role="group" aria-label="Кто">
            <span class="toolbar-filter-label">Кто</span>
            <div class="form-pagetabs" id="cp-party-tabs" role="tablist">
              <button type="button" class="form-pagetab ${!partyKind || partyKind === 'partner' ? 'active' : ''}" data-cp-party="" role="tab" aria-selected="${!partyKind || partyKind === 'partner' ? 'true' : 'false'}">Все</button>
              <button type="button" class="form-pagetab ${partyKind === 'legal' ? 'active' : ''}" data-cp-party="legal" role="tab" aria-selected="${partyKind === 'legal' ? 'true' : 'false'}">Юрлица</button>
              <button type="button" class="form-pagetab ${partyKind === 'ip' ? 'active' : ''}" data-cp-party="ip" role="tab" aria-selected="${partyKind === 'ip' ? 'true' : 'false'}">ИП</button>
              <button type="button" class="form-pagetab ${partyKind === 'person' ? 'active' : ''}" data-cp-party="person" role="tab" aria-selected="${partyKind === 'person' ? 'true' : 'false'}">Физлица</button>
            </div>
          </div>
          <div class="toolbar-filter" role="group" aria-label="Партнёр">
            <span class="toolbar-filter-label">Партнёр</span>
            <div class="form-pagetabs" id="cp-partner-tabs" role="tablist">
              <button type="button" class="form-pagetab ${partnerFilter !== '1' && partnerFilter !== '0' ? 'active' : ''}" data-cp-partner="" role="tab" aria-selected="${partnerFilter !== '1' && partnerFilter !== '0' ? 'true' : 'false'}">Все</button>
              <button type="button" class="form-pagetab ${partnerFilter === '1' ? 'active' : ''}" data-cp-partner="1" role="tab" aria-selected="${partnerFilter === '1' ? 'true' : 'false'}">Да</button>
              <button type="button" class="form-pagetab ${partnerFilter === '0' ? 'active' : ''}" data-cp-partner="0" role="tab" aria-selected="${partnerFilter === '0' ? 'true' : 'false'}">Нет</button>
            </div>
          </div>
        </div>`,
    }
  );
  bindFormChrome(() => showSection(backSection));

  document.querySelectorAll('#cp-kind-tabs [data-cp-mode]').forEach((btn) => {
    btn.onclick = () => {
      const m = btn.dataset.cpMode || '';
      state.cpPage = 1;
      state.cpQ = '';
      state.cpPartyKind = '';
      if (m === 'supplier') openTab('suppliers');
      else if (m === 'buyer') openTab('buyers');
      else openTab('counterparties');
    };
  });
  document.querySelectorAll('#cp-party-tabs [data-cp-party]').forEach((btn) => {
    btn.onclick = () => {
      state.cpPartyKind = btn.dataset.cpParty || '';
      state.cpPage = 1;
      renderCounterparties(filterKind);
    };
  });
  document.querySelectorAll('#cp-partner-tabs [data-cp-partner]').forEach((btn) => {
    btn.onclick = () => {
      state.cpPartner = btn.dataset.cpPartner || '';
      state.cpPage = 1;
      renderCounterparties(filterKind);
    };
  });
  view.querySelectorAll('[data-cp-sort]').forEach((thEl) => {
    thEl.onclick = () => {
      const key = thEl.getAttribute('data-cp-sort') || 'created';
      if (state.cpSort === key) {
        state.cpSortDir = state.cpSortDir === 'asc' ? 'desc' : 'asc';
      } else {
        state.cpSort = key;
        state.cpSortDir = key === 'name' || key === 'inn' || key === 'phone' ? 'asc' : 'desc';
      }
      state.cpPage = 1;
      renderCounterparties(filterKind);
    };
  });
  const reload = () => renderCounterparties(filterKind);
  const goSearch = () => {
    state.cpQ = document.getElementById('cq').value.trim();
    state.cpPage = 1;
    reload();
  };
  document.getElementById('csearch').onclick = goSearch;
  document.getElementById('cq').onkeydown = (e) => {
    if (e.key === 'Enter') goSearch();
  };

  const openCounterpartyCreate = () => {
    // На экране покупателей/поставщиков роль фиксируем; иначе даём выбрать.
    const kindSelect =
      filterKind === 'buyer' || filterKind === 'supplier'
        ? `<input type="hidden" id="ckind" value="${esc(filterKind)}" />`
        : kindSelectHtml('supplier', 'ckind');
    openCreateLightbox({
      title:
        filterKind === 'supplier'
          ? 'Новый поставщик'
          : filterKind === 'buyer'
            ? 'Новый покупатель'
            : 'Новый контрагент',
      wide: true,
      bodyHtml: `
        <div class="form-grid" id="cp-create-grid">
          <div class="span-2" id="cparty-wrap">
            <span class="form-grid-label">Кто</span>
            ${radioPillsHtml('cparty', [
              { value: 'person', label: 'Физлицо' },
              { value: 'ip', label: 'ИП' },
              { value: 'legal', label: 'Юрлицо' },
            ], partyKindDefault)}
          </div>
          <label id="clabel-inn" ${partyKindDefault === 'person' ? 'hidden' : ''}>ИНН
            <input id="cinn" class="mono" placeholder="10 или 12 цифр" autocomplete="off" />
          </label>
          <label class="span-2" id="clabel-name"><span id="cname-title">ФИО</span>
            <input id="cname" placeholder="ФИО" autocomplete="off" />
            <div id="cname-suggest" class="suggest hidden"></div>
          </label>
          <label id="clabel-kpp" ${partyKindDefault === 'legal' ? '' : 'hidden'}>КПП
            <input id="ckpp" class="mono" placeholder="9 цифр" />
          </label>
          <label id="clabel-ogrn" ${partyKindDefault === 'person' ? 'hidden' : ''}>
            <span class="ogrn-title">${partyKindDefault === 'ip' ? 'ОГРНИП' : 'ОГРН'}</span>
            <input id="cogrn" class="mono" placeholder="" />
          </label>
          <label class="span-2">Адрес
            <input id="caddress" placeholder="адрес" autocomplete="off" />
            <div id="caddress-suggest" class="suggest hidden"></div>
          </label>
          <label>Телефон 1
            <div class="field-control">
              <input id="cphone1" class="cphone" />
              <button type="button" id="cphone-add" title="Добавить ещё телефон" aria-label="Добавить телефон">+</button>
            </div>
          </label>
          <div id="cphones-extra" class="span-2 cphones-extra"></div>
          <label>Email
            <input id="cemail" type="email" placeholder="name@company.ru" autocomplete="off" />
          </label>
          ${kindSelect}
          <input type="hidden" id="cname-full" value="" />
        </div>`,
      onMount: (root) => {
        const getCpartyKind = () => radioPillsValue('cparty', root) || 'person';
        const setCpartyKind = (val) => setRadioPillsValue('cparty', val, root);
        const syncPartyFields = () => {
          const pk = getCpartyKind();
          const nameTitle = root.querySelector('#cname-title');
          const nameInp = root.querySelector('#cname');
          const innLab = root.querySelector('#clabel-inn');
          const kppLab = root.querySelector('#clabel-kpp');
          const ogrnLab = root.querySelector('#clabel-ogrn');
          const ogrnInp = root.querySelector('#cogrn');
          const addr = root.querySelector('#caddress');
          const inn = root.querySelector('#cinn');
          if (pk === 'legal') {
            if (nameTitle) nameTitle.textContent = 'Название';
            if (nameInp) nameInp.placeholder = 'ООО «…»';
            if (innLab) innLab.hidden = false;
            if (kppLab) kppLab.hidden = false;
            if (ogrnLab) ogrnLab.hidden = false;
            const ogrnTitle = ogrnLab?.querySelector('.ogrn-title');
            if (ogrnTitle) ogrnTitle.textContent = 'ОГРН';
            if (ogrnInp) ogrnInp.placeholder = 'ОГРН';
            if (addr) addr.placeholder = 'юридический адрес';
            if (inn) inn.placeholder = '10 цифр';
          } else if (pk === 'ip') {
            if (nameTitle) nameTitle.textContent = 'ФИО ИП';
            if (nameInp) nameInp.placeholder = 'Иванов Иван Иванович';
            if (innLab) innLab.hidden = false;
            if (kppLab) kppLab.hidden = true;
            if (ogrnLab) ogrnLab.hidden = false;
            const ogrnTitle = ogrnLab?.querySelector('.ogrn-title');
            if (ogrnTitle) ogrnTitle.textContent = 'ОГРНИП';
            if (ogrnInp) ogrnInp.placeholder = 'ОГРНИП';
            if (addr) addr.placeholder = 'адрес регистрации';
            if (inn) inn.placeholder = '12 цифр';
            const kpp = root.querySelector('#ckpp');
            if (kpp) kpp.value = '';
          } else {
            if (nameTitle) nameTitle.textContent = 'ФИО';
            if (nameInp) nameInp.placeholder = 'Иванов Иван Иванович';
            if (innLab) innLab.hidden = true;
            if (kppLab) kppLab.hidden = true;
            if (ogrnLab) ogrnLab.hidden = true;
            if (addr) addr.placeholder = 'адрес';
            if (inn) inn.value = '';
            const kpp = root.querySelector('#ckpp');
            if (kpp) kpp.value = '';
            const ogrn = root.querySelector('#cogrn');
            if (ogrn) ogrn.value = '';
          }
        };
        bindRadioPills(root, (name) => {
          if (name === 'cparty') syncPartyFields();
        });
        syncPartyFields();
        root._cpGetKind = getCpartyKind;
        root._cpSetKind = setCpartyKind;

        bindDadataSuggest(
          root.querySelector('#cname'),
          root.querySelector('#cname-suggest'),
          async (q) => {
            const pk = getCpartyKind();
            if (pk === 'legal') {
              const r = await api('/dadata/party?q=' + encodeURIComponent(q) + '&count=8');
              return (r.items || []).map((p) => ({
                value: p.name || p.value || '',
                hint: p.inn ? 'ИНН ' + p.inn : '',
                party: p,
              }));
            }
            const r = await api('/dadata/fio?q=' + encodeURIComponent(q) + '&count=8');
            return (r.items || []).map((p) => ({
              value: p.value || p.unrestricted_value || '',
              fio: p,
            }));
          },
          {
            minLen: 2,
            onPick: (it) => {
              if (it.party) {
                const p = it.party;
                const set = (id, val) => {
                  const el = root.querySelector('#' + id);
                  if (el && val != null) el.value = String(val);
                };
                set('cname-full', p.name_full || p.name || '');
                if (p.inn) set('cinn', p.inn);
                if (p.kpp) set('ckpp', p.kpp);
                if (p.ogrn) set('cogrn', p.ogrn);
                if (p.address) set('caddress', p.address);
                if (p.type === 'LEGAL') setCpartyKind('legal');
                else if (p.type === 'INDIVIDUAL') setCpartyKind('ip');
                syncPartyFields();
              } else if (it.fio) {
                const full = root.querySelector('#cname-full');
                if (full) full.value = it.value;
              }
            },
          }
        );
        bindDadataSuggest(
          root.querySelector('#caddress'),
          root.querySelector('#caddress-suggest'),
          async (q) => {
            const r = await api('/dadata/address?q=' + encodeURIComponent(q) + '&count=8');
            return (r.items || []).map((p) => ({
              value: p.unrestricted_value || p.value || '',
              hint: p.postal_code || '',
            }));
          },
          { minLen: 3 }
        );

        const phonesExtra = root.querySelector('#cphones-extra');
        const phoneAddBtn = root.querySelector('#cphone-add');
        const renumberExtraPhones = () => {
          [...(phonesExtra?.querySelectorAll('label') || [])].forEach((lab, i) => {
            const t = lab.querySelector('.cphone-label');
            if (t) t.textContent = 'Телефон ' + (i + 2);
          });
        };
        const addPhoneRow = (focus) => {
          if (!phonesExtra) return;
          const n = 2 + phonesExtra.querySelectorAll('.cphone').length;
          const row = document.createElement('label');
          row.innerHTML = `<span class="cphone-label">Телефон ${n}</span>
            <div class="field-control">
              <input class="cphone" />
              <button type="button" class="cphone-del" title="Убрать">×</button>
            </div>`;
          phonesExtra.appendChild(row);
          const inp = row.querySelector('input.cphone');
          bindPhoneNormalize(inp);
          if (focus) inp?.focus();
          row.querySelector('.cphone-del')?.addEventListener('click', () => {
            row.remove();
            renumberExtraPhones();
          });
          return inp;
        };
        if (phoneAddBtn) phoneAddBtn.onclick = () => addPhoneRow(true);
        bindPhoneNormalize(root.querySelector('#cphone1'));

        let dadataTimer = null;
        let dadataLastInn = '';
        const fillFromDadata = async (innDigits) => {
          const msg = document.getElementById('create-lb-msg');
          if (!(innDigits.length === 10 || innDigits.length === 12)) return;
          if (innDigits === dadataLastInn) return;
          dadataLastInn = innDigits;
          if (msg) msg.textContent = 'Ищем реквизиты…';
          try {
            const r = await api('/dadata/party/find', {
              method: 'POST',
              body: JSON.stringify({ inn: innDigits }),
            });
            const p = r.party || {};
            const set = (id, val) => {
              const el = root.querySelector('#' + id);
              if (el) el.value = val != null ? String(val) : '';
            };
            set('cname', p.name || p.value || '');
            set('cname-full', p.name_full || p.name || '');
            set('ckpp', p.kpp || '');
            set('cogrn', p.ogrn || '');
            set('caddress', p.address || '');
            set('cinn', p.inn || innDigits);
            const nextKind = innDigits.length === 10 ? 'legal' : 'ip';
            setCpartyKind(nextKind);
            syncPartyFields();
            if (msg) {
              msg.textContent = p.name
                ? 'Подтянуто: ' + p.name + (p.kpp ? ' · КПП ' + p.kpp : '')
                : 'Не найдено';
            }
          } catch (e) {
            if (msg) msg.textContent = e.message || 'Не удалось подтянуть реквизиты';
          }
        };
        const innInput = root.querySelector('#cinn');
        if (innInput) {
          const onInn = () => {
            if (getCpartyKind() === 'person') return;
            const digits = String(innInput.value || '').replace(/\D/g, '');
            if (digits.length === 10 || digits.length === 12) {
              clearTimeout(dadataTimer);
              dadataTimer = setTimeout(() => fillFromDadata(digits), 350);
            } else {
              dadataLastInn = '';
            }
          };
          innInput.addEventListener('input', onInn);
          innInput.addEventListener('blur', onInn);
        }
      },
      onSubmit: async (root) => {
        const kindRaw = root.querySelector('#ckind')?.value || filterKind || 'supplier';
        const partyKind = root._cpGetKind ? root._cpGetKind() : 'person';
        const name = (root.querySelector('#cname')?.value || '').trim();
        const inn = partyKind === 'person' ? '' : (root.querySelector('#cinn')?.value || '').trim();
        if (!name) {
          root.querySelector('#cname')?.focus();
          throw new Error(partyKind === 'legal' ? 'Укажите название' : 'Укажите ФИО');
        }
        const created = await api('/counterparties', {
          method: 'POST',
          body: JSON.stringify({
            name,
            inn,
            party_kind: partyKind,
            kpp: partyKind === 'legal' ? root.querySelector('#ckpp')?.value || '' : '',
            ogrn: partyKind === 'person' ? '' : root.querySelector('#cogrn')?.value || '',
            address: root.querySelector('#caddress')?.value || '',
            name_full: root.querySelector('#cname-full')?.value || '',
            email: (root.querySelector('#cemail')?.value || '').trim(),
            phone: joinPhones(
              [...root.querySelectorAll('.cphone')].map((el) => formatPhone(el.value))
            ),
            kind: kindRaw === 'buyer' ? 'buyer' : kindRaw === 'both' ? 'both' : 'supplier',
          }),
        });
        closeCreateLightbox();
        if (created?.id) {
          openTab('company:' + created.id, (created.name || name || 'Контрагент').slice(0, 40));
          return;
        }
        state.cpPage = 1;
        reload();
      },
    });
  };
  document.getElementById('cadd2').onclick = openCounterpartyCreate;

  bindListPager(['cpager', 'cpager2'], 'counterparties', 'cpPage', () => reload());
  view.querySelectorAll('[data-open]').forEach((tr) => {
    tr.onclick = () => openTab('company:' + tr.dataset.open);
  });
  view.querySelectorAll('[data-open-docs]').forEach((el) => {
    el.onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      const id = el.getAttribute('data-open-docs');
      if (!id) return;
      state.cpDetailTab = 'docs';
      openTab('company:' + id);
    };
  });
}

async function renderBalances() {
  await refreshRefs();
  const wh = state.balWh;
  if (!wh) state.balWhTab = 'stock';
  else if (state.balWhTab !== 'data' && state.balWhTab !== 'stock' && state.balWhTab !== 'history') {
    state.balWhTab = 'stock';
  }
  const whCardTab = state.balWhTab || 'stock';
  const q = state.balQ;
  const page = state.balPage;
  const sort = state.balSort || '';
  const dir = state.balDir || 'desc';
  const limit = getPageSize('balances', 50);

  const fmtWhWhen = (s) => {
    const t = String(s || '').trim();
    if (!t) return '—';
    // SQLite datetime('now') — как есть (YYYY-MM-DD HH:MM)
    const m = t.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})/);
    if (m) {
      const [, d, hm] = m;
      const [y, mo, day] = d.split('-');
      return `${day}.${mo}.${y} ${hm}`;
    }
    if (/^\d{4}-\d{2}-\d{2}$/.test(t)) {
      const [y, mo, day] = t.split('-');
      return `${day}.${mo}.${y}`;
    }
    return t.slice(0, 16).replace('T', ' ');
  };
  const whCardTabs = (active) => {
    if (!wh) return '';
    const tab = (id, label) =>
      `<button type="button" class="auth-tab${active === id ? ' active' : ''}" data-bal-tab="${id}" role="tab" aria-selected="${
        active === id ? 'true' : 'false'
      }">${label}</button>`;
    return `<div class="auth-tabs" style="margin:0 0 12px" role="tablist">
      ${tab('data', 'Данные')}
      ${tab('stock', 'Остатки')}
      ${tab('history', 'История')}
    </div>`;
  };
  const bindWhCardTabs = () => {
    view.querySelectorAll('[data-bal-tab]').forEach((btn) => {
      btn.onclick = () => {
        state.balWhTab = btn.getAttribute('data-bal-tab') || 'stock';
        if (state.balWhTab === 'history') state.balHistPage = 1;
        renderBalances();
      };
    });
  };

  // Вкладки «Данные» / «История» — без полной таблицы остатков
  if (wh && (whCardTab === 'data' || whCardTab === 'history')) {
    const [allWh, detail] = await Promise.all([
      api(withCompanyId('/warehouses?archived=all')).catch(() => state.warehouses || []),
      api('/warehouses/' + encodeURIComponent(wh)).catch(() => null),
    ]);
    const whCatalog = Array.isArray(allWh) ? allWh : state.warehouses || [];
    let whRow = detail || whCatalog.find((w) => w.id === wh) || (await resolveWarehouseRow(wh));
    const whLabel =
      entityTitle(whRow?.code, whRow?.name) || entityTitle('id', String(wh).slice(0, 8) + '…');
    const title = whLabel;
    const isAutoWh = !!whIsAutoSys(whRow || { id: wh, name: whLabel, code: '' });
    const whOpts =
      '<option value="">Все склады</option>' +
      whCatalog
        .map((w) => {
          const archived = Number(w.is_active) === 0 ? ' (архив)' : '';
          return `<option value="${esc(w.id)}" ${w.id === wh ? 'selected' : ''}>${esc(
            entityTitle(w.code, w.name) || w.id
          )}${archived}</option>`;
        })
        .join('');
    const toolbarCommon = `
        <select id="bwh">${whOpts}</select>
        ${
          wh && !isAutoWh && Number(whRow?.is_active) !== 0
            ? archiveIconBtn('bal-wh', false)
            : ''
        }
        <div class="grow"></div>`;

    if (whCardTab === 'data') {
      const createdWhen = fmtWhWhen(whRow?.created_at);
      const createdWho = esc(whRow?.created_by_name || '—');
      view.innerHTML = formChrome(
        title,
        `${whCardTabs('data')}
        <div class="form-grid">
          <label class="span-2">Название склада
            <input id="wh-card-name" value="${esc(whRow?.name || '')}" ${isAutoWh ? 'readonly' : ''} />
          </label>
          <label>Код<input class="mono" id="wh-card-code" value="${esc(whRow?.code || '')}" readonly /></label>
          <label>Организация<input value="${esc(whRow?.company_name || '')}" readonly /></label>
          <label>Статус<input value="${Number(whRow?.is_active) === 0 ? 'Архив' : 'Активен'}" readonly /></label>
          <label>Создан<input value="${esc(createdWhen)}" readonly /></label>
          <label>Кто создал<input value="${createdWho}" readonly /></label>
        </div>
        ${
          isAutoWh
            ? `<p class="muted" style="margin-top:12px">${esc(whAutoSysTip(whRow || { id: wh, name: whLabel, code: '' }))}</p>`
            : `<div class="form-actions">
          <button type="button" class="primary" id="wh-card-save">Записать</button>
          <span class="muted" id="wh-card-msg"></span>
        </div>`
        }`,
        {
          sectionId: 'warehouse',
          entityKind: 'warehouse',
          toolbar: toolbarCommon,
        }
      );
      setUrl(pathForTab('balances'));
      const tabRec = state.tabs.find((t) => t.id === state.activeTab);
      if (tabRec && state.activeTab === 'balances') {
        tabRec.title = String(title).slice(0, 48);
        renderTabs();
      }
      bindFormChrome(() => showSection('warehouse'));
      bindWhCardTabs();
      document.getElementById('bwh').onchange = () => {
        const nextWh = document.getElementById('bwh').value;
        state.balWh = nextWh;
        state.balPage = 1;
        state.balHistPage = 1;
        if (!nextWh) state.balWhTab = 'stock';
        renderBalances();
      };
      document.getElementById('bal-wh-archive')?.addEventListener('click', async () => {
        if (!wh || isAutoWh) return;
        const tot = await api(
          '/balances?' + new URLSearchParams({ warehouse_id: String(wh), page: '1', limit: '1' })
        ).catch(() => ({ totals: {} }));
        const totalQty = Number(tot.totals?.qty) || 0;
        if (totalQty > 0) {
          alert(`Сначала переместите остатки (кол-во: ${totalQty}).`);
          state.balWhTab = 'stock';
          state.balXferOpen = true;
          state.balXferSelectAll = true;
          renderBalances();
          return;
        }
        if (!confirm(`Перенести склад «${whLabel}» в архив?`)) return;
        try {
          await api(`/warehouses/${encodeURIComponent(wh)}/archive`, { method: 'POST', body: '{}' });
          state.balWh = '';
          state.balWhTab = 'stock';
          openTab('warehouses', 'Склады');
        } catch (e) {
          alert(String(e?.message || e));
        }
      });
      document.getElementById('wh-card-save')?.addEventListener('click', async () => {
        const msg = document.getElementById('wh-card-msg');
        const btn = document.getElementById('wh-card-save');
        if (btn) btn.disabled = true;
        if (msg) msg.textContent = 'Сохранение…';
        try {
          await api(`/warehouses/${encodeURIComponent(wh)}`, {
            method: 'PATCH',
            body: JSON.stringify({ name: document.getElementById('wh-card-name').value }),
          });
          if (msg) msg.textContent = 'Сохранено';
          renderBalances();
        } catch (e) {
          if (msg) msg.textContent = e.message || String(e);
          if (btn) btn.disabled = false;
        }
      });
      return;
    }

    // history
    const histPage = state.balHistPage || 1;
    const histType = state.balHistType || '';
    const histLimit = getPageSize('balances', 50);
    const mqs = new URLSearchParams({ page: String(histPage), limit: String(histLimit) });
    if (histType) mqs.set('type', histType);
    const mov = await api('/warehouses/' + encodeURIComponent(wh) + '/movements?' + mqs.toString()).catch(
      () => ({ items: [], total: 0, page: 1, pages: 1 })
    );
    const typeLabel = (t) =>
      ({ in: 'Приход', out: 'Расход', transfer: 'Перемещение', return: 'Возврат' })[t] || t || '—';
    view.innerHTML = formChrome(
      title,
      `${whCardTabs('history')}
      <div class="toolbar" style="margin-bottom:10px">
        <label style="display:inline-flex;align-items:center;gap:6px;font-size:13px">Тип
          <select id="bal-hist-type">
            <option value="" ${!histType ? 'selected' : ''}>Все</option>
            <option value="transfer" ${histType === 'transfer' ? 'selected' : ''}>Перемещения</option>
            <option value="in" ${histType === 'in' ? 'selected' : ''}>Приходы</option>
            <option value="out" ${histType === 'out' ? 'selected' : ''}>Расходы</option>
            <option value="return" ${histType === 'return' ? 'selected' : ''}>Возвраты</option>
          </select>
        </label>
        <div class="grow"></div>
      </div>
      ${pagerHtml('bhpager', mov.page, mov.pages, mov.total, { limit: histLimit, listKey: 'balances' })}
      <div class="table-scroll"><table class="data-table is-dense" data-table-key="wh-movements-v1" data-no-col-filter="1">
        <thead><tr>
          <th data-col-id="date">Дата</th>
          <th data-col-id="type">Тип</th>
          <th data-col-id="number">Номер</th>
          <th data-col-id="from">Откуда</th>
          <th data-col-id="to">Куда</th>
          <th data-col-id="qty">Кол-во</th>
          <th data-col-id="status">Статус</th>
          <th data-col-id="comment">Комментарий</th>
        </tr></thead>
        <tbody>
          ${
            (mov.items || [])
              .map((r) => {
                const from = r.doc_type === 'transfer' ? r.warehouse || '—' : r.warehouse || '—';
                const to =
                  r.doc_type === 'transfer'
                    ? r.warehouse_to || '—'
                    : r.counterparty
                      ? r.counterparty
                      : '—';
                return `<tr class="clickable" data-open-doc="${esc(r.id)}">
              <td class="mono">${esc(String(r.doc_date || '').slice(0, 10))}</td>
              <td>${esc(typeLabel(r.doc_type))}</td>
              <td class="mono">${esc(r.number || '')}</td>
              <td>${esc(from)}</td>
              <td>${esc(to)}</td>
              <td class="mono">${esc(String(r.qty_sum ?? r.lines_count ?? '—'))}</td>
              <td>${Number(r.posted) === 1 ? '<span class="badge">Проведён</span>' : '<span class="muted">Черновик</span>'}</td>
              <td>${esc(r.comment || '')}</td>
            </tr>`;
              })
              .join('') ||
            `<tr><td colspan="8" class="muted">Нет документов по этому складу</td></tr>`
          }
        </tbody>
      </table></div>
      ${pagerHtml('bhpager2', mov.page, mov.pages, mov.total, { limit: histLimit, listKey: 'balances' })}`,
      {
        sectionId: 'warehouse',
        entityKind: 'warehouse',
        toolbar: toolbarCommon,
      }
    );
    setUrl(pathForTab('balances'));
    const tabRec2 = state.tabs.find((t) => t.id === state.activeTab);
    if (tabRec2 && state.activeTab === 'balances') {
      tabRec2.title = String(title).slice(0, 48);
      renderTabs();
    }
    bindFormChrome(() => showSection('warehouse'));
    bindWhCardTabs();
    document.getElementById('bwh').onchange = () => {
      const nextWh = document.getElementById('bwh').value;
      state.balWh = nextWh;
      state.balPage = 1;
      state.balHistPage = 1;
      if (!nextWh) state.balWhTab = 'stock';
      renderBalances();
    };
    document.getElementById('bal-hist-type').onchange = () => {
      state.balHistType = document.getElementById('bal-hist-type').value || '';
      state.balHistPage = 1;
      renderBalances();
    };
    bindListPager(['bhpager', 'bhpager2'], 'balances', 'balHistPage', () => renderBalances());
    view.querySelectorAll('[data-open-doc]').forEach((tr) => {
      tr.onclick = () => {
        const id = tr.getAttribute('data-open-doc');
        if (id) openTab('doc:' + id);
      };
    });
    document.getElementById('bal-wh-archive')?.addEventListener('click', async () => {
      if (!wh || isAutoWh) return;
      const tot = await api(
        '/balances?' + new URLSearchParams({ warehouse_id: String(wh), page: '1', limit: '1' })
      ).catch(() => ({ totals: {} }));
      const totalQty = Number(tot.totals?.qty) || 0;
      if (totalQty > 0) {
        alert(`Сначала переместите остатки (кол-во: ${totalQty}).`);
        state.balWhTab = 'stock';
        state.balXferOpen = true;
        state.balXferSelectAll = true;
        renderBalances();
        return;
      }
      if (!confirm(`Перенести склад «${whLabel}» в архив?`)) return;
      try {
        await api(`/warehouses/${encodeURIComponent(wh)}/archive`, { method: 'POST', body: '{}' });
        state.balWh = '';
        state.balWhTab = 'stock';
        openTab('warehouses', 'Склады');
      } catch (e) {
        alert(String(e?.message || e));
      }
    });
    return;
  }

  const qs = new URLSearchParams({ page: String(page), limit: String(limit) });
  if (wh) qs.set('warehouse_id', wh);
  if (q) qs.set('q', q);
  if (sort) {
    qs.set('sort', sort);
    qs.set('dir', dir);
  }
  withCompanyId(qs);
  const [data, allWh] = await Promise.all([
    api('/balances?' + qs.toString()),
    api(withCompanyId('/warehouses?archived=all')).catch(() => state.warehouses || []),
  ]);
  const list = data.items || [];
  const totals = data.totals || {};
  const totalQty = Number(totals.qty) || 0;
  const totalReserved = Number(totals.reserved_qty) || 0;
  const totalPurchase = Number(totals.value_purchase) || 0;
  const totalRetail = Number(totals.value_retail) || 0;
  const totalLines = Number(totals.lines != null ? totals.lines : data.total) || 0;
  const whCatalog = Array.isArray(allWh) ? allWh : state.warehouses || [];
  let whRow = wh ? whCatalog.find((w) => w.id === wh) || null : null;
  if (wh && !whRow) whRow = await resolveWarehouseRow(wh);
  // Имя из строк остатков, если склад не в справочнике (битая ссылка / удалён)
  if (wh && whRow && !String(whRow.name || '').trim() && list[0]?.warehouse) {
    whRow = { ...whRow, name: list[0].warehouse, code: whRow.code || list[0].warehouse_code || '' };
  }
  if (wh && !whRow && list[0]) {
    whRow = {
      id: wh,
      name: list[0].warehouse || '',
      code: list[0].warehouse_code || '',
    };
  }
  const whLabel = wh
    ? entityTitle(whRow?.code, whRow?.name) || entityTitle('id', String(wh).slice(0, 8) + '…')
    : 'По всем складам';
  const title = whLabel;
  const sectionLabel = wh ? 'Склад · остатки' : 'Остатки';
  const isAutoWh = !!wh && whIsAutoSys(whRow || { id: wh, name: whLabel, code: '' });
  if (isAutoWh) state.balXferOpen = false;
  const xferAllowed = !!(wh && !isAutoWh);
  const xferOpen = !!(xferAllowed && state.balXferOpen);
  const xferData = xferOpen
    ? await api(
        '/balances?' +
          new URLSearchParams({
            warehouse_id: String(wh),
            page: '1',
            limit: '500',
          }).toString()
      ).catch(() => ({ items: [] }))
    : { items: [] };
  const xferRows = (xferData.items || []).filter((r) => Number(r.qty) > 0);
  const whOpts =
    '<option value="">Все склады</option>' +
    whCatalog
      .map((w) => {
        const archived = Number(w.is_active) === 0 ? ' (архив)' : '';
        return `<option value="${esc(w.id)}" ${w.id === wh ? 'selected' : ''}>${esc(
          entityTitle(w.code, w.name) || w.id
        )}${archived}</option>`;
      })
      .join('');
  const footerHtml = `
    <div class="bal-totals" role="status">
      <div class="bal-totals-row">
        <span>Позиций: <b>${esc(String(totalLines))}</b></span>
        <span>Кол-во: <b class="mono">${esc(String(totalQty))}</b></span>
        <span>Резерв: <b class="mono">${esc(String(totalReserved))}</b></span>
        <span title="FIFO по приходным (не себестоимость 1С)">Сумма закуп: <b class="mono">${esc(
          formatMoney(totalPurchase)
        )}</b></span>
        <span class="muted" title="По розничной цене из карточки">Розница: <b class="mono">${esc(
          formatMoney(totalRetail)
        )}</b></span>
      </div>
    </div>`;
  const isGhostWh =
    !!wh &&
    (/не\s*найден/i.test(String(whRow?.name || '')) ||
      /не\s*найден/i.test(whLabel) ||
      !whRow ||
      (!String(whRow.name || '').trim() && !String(whRow.code || '').trim()));
  const toWhOpts = whCatalog
    .filter((w) => w.id !== wh && Number(w.is_active) !== 0 && !whIsAutoSys(w))
    .map(
      (w) =>
        `<option value="${esc(w.id)}">${esc(entityTitle(w.code, w.name) || w.id)}</option>`
    )
    .join('');
  const xferLinesHtml = xferRows.length
    ? `<div class="table-scroll bal-xfer-lines"><table class="data-table is-dense" data-no-col-filter="1">
        <thead><tr>
          <th style="width:36px"><input type="checkbox" id="bal-xfer-all" title="Выбрать все"${
            state.balXferSelectAll ? ' checked' : ''
          } /></th>
          <th>Артикул</th>
          <th>Номенклатура</th>
          <th>На складе</th>
          <th style="width:110px">Перенести</th>
        </tr></thead>
        <tbody>
          ${xferRows
            .map((r) => {
              const avail = Number(r.qty) || 0;
              const pre = !!state.balXferSelectAll;
              return `<tr data-xfer-product="${esc(r.product_id)}">
                <td><input type="checkbox" class="bal-xfer-pick" data-product="${esc(r.product_id)}" data-avail="${esc(avail)}"${
                pre ? ' checked' : ''
              } /></td>
                <td class="mono">${esc(r.sku || '')}</td>
                <td>${esc(r.name || '')}</td>
                <td class="mono">${esc(avail)}</td>
                <td><input type="number" class="bal-xfer-qty mono" min="0" step="any" max="${esc(avail)}" value="${esc(avail)}"${
                pre ? '' : ' disabled'
              } data-product="${esc(r.product_id)}" data-avail="${esc(avail)}" /></td>
              </tr>`;
            })
            .join('')}
        </tbody>
      </table></div>
      <div class="muted bal-xfer-sum" id="bal-xfer-sum" style="margin-top:6px;font-size:12px">${
        state.balXferSelectAll && xferRows.length
          ? `Выбрано: ${xferRows.length} поз. · ${xferRows.reduce((s, r) => s + (Number(r.qty) || 0), 0)} шт.`
          : 'Выбрано: 0 поз. · 0 шт.'
      }</div>`
    : '<p class="muted" style="margin:0">На складе нет остатков для перемещения.</p>';
  const transferPanel =
    wh && xferOpen && xferAllowed
      ? `<div class="panel bal-xfer-panel" style="margin-bottom:12px">
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px">
        <div style="font-size:13px;font-weight:600;flex:1">Заказ на перемещение</div>
        <button type="button" class="linkish" id="bal-xfer-close">Свернуть</button>
      </div>
      <div class="form-grid" style="margin:0;align-items:end">
        <label>Откуда
          <input type="text" readonly value="${esc(whLabel)}" title="${esc(wh)}" />
        </label>
        <label>Куда
          <select id="bal-xfer-to"><option value="">Выберите склад…</option>${toWhOpts}</select>
        </label>
        <label class="span-2">Зачем перемещаем <span class="muted">(обязательно · увидят кладовщики)</span>
          <textarea id="bal-xfer-comment" rows="2" placeholder="Например: под заказ Иванова, в СТО на подъёмник, ЭДО-документ…" autocomplete="off"></textarea>
        </label>
        <div class="span-2">
          <div class="muted" style="font-size:12px;margin-bottom:6px">Что переносим (отметьте позиции и количество)</div>
          ${xferLinesHtml}
        </div>
        <div class="toolbar" style="margin:0;grid-column:1 / -1">
          <button type="button" class="primary" id="bal-xfer-go" ${xferRows.length ? '' : 'disabled'}>Создать заказ на перемещение</button>
          <button type="button" id="bal-xfer-hist">История заказов</button>
          <span class="muted" id="bal-xfer-msg" style="margin-left:8px"></span>
        </div>
      </div>
      <p class="muted" style="margin:8px 0 0;font-size:11px">
        Создаётся <b>черновик</b>${isGhostWh ? ' (склад «Не найден» / ЭДО)' : ''}.
        Провести — отдельно из карточки заказа на перемещение.
      </p>
    </div>`
      : '';
  view.innerHTML = formChrome(
    title,
    `
    ${whCardTabs('stock')}
    ${transferPanel}
    ${pagerHtml('bpager', data.page, data.pages, data.total, { limit, listKey: 'balances' })}
    <div class="table-scroll"><table class="data-table is-dense" data-table-key="balances" data-no-col-filter="1">
      <thead><tr>
        ${(() => {
          const mark = (key) => (sort !== key ? '' : dir === 'asc' ? ' ▲' : ' ▼');
          const th = (key, label) =>
            `<th data-col-id="${esc(key)}" data-sort="${esc(key)}" class="sortable ${
              sort === key ? 'sorted' : ''
            }" title="Сортировка по всем строкам">${esc(label)}${mark(key)}</th>`;
          return (
            th('warehouse', 'Склад') +
            th('kind', 'Вид') +
            th('category', 'Категория') +
            th('sku', 'Артикул') +
            th('name', 'Номенклатура') +
            th('qty', 'Кол-во') +
            th('marks', 'Марки') +
            th('reserved', 'Резерв') +
            th('unit', 'Ед.')
          );
        })()}
      </tr></thead>
      <tbody>
        ${
          list
            .map((r) => {
              const codes = Array.isArray(r.dm_codes) ? r.dm_codes : [];
              const dmCount = Number(r.dm_count) || codes.length;
              const dmMore = Number(r.dm_more) || Math.max(0, dmCount - codes.length);
              const dmHtml = codes.length
                ? `<div class="bal-dm-list">${codes
                    .map(
                      (code) =>
                        `                        <button type="button" class="bal-dm-code mono" data-serial="${esc(
                          code
                        )}" title="История марки">${esc(code)}</button>`
                    )
                    .join('')}${
                    dmMore > 0
                      ? `<button type="button" class="bal-dm-more muted" data-product-units="${esc(
                          r.product_id
                        )}" data-wh="${esc(r.warehouse_id)}" title="Все коды на складе">+${dmMore}</button>`
                      : ''
                  }</div>`
                : dmCount > 0
                  ? `<button type="button" class="linkish bal-dm-more" data-product-units="${esc(
                      r.product_id
                    )}" data-wh="${esc(r.warehouse_id)}">${dmCount} код.</button>`
                  : '<span class="muted">—</span>';
              return `
          <tr class="${r.product_id ? 'clickable' : ''}" ${
            r.product_id ? `data-product="${esc(r.product_id)}"` : ''
          }>
            <td>${esc(r.warehouse)}${
              Number(r.is_reserve) === 1
                ? ' <span class="muted" title="Склад ожидания оплаты">· резерв</span>'
                : ''
            }</td>
            <td>${String(r.item_kind) === 'service' ? 'Услуга' : 'Товар'}</td>
            <td>${r.category ? esc(r.category) : '<span class="muted">—</span>'}</td>
            <td class="mono">${esc(r.sku)}</td>
            <td>${esc(r.name)}</td>
            <td><strong>${esc(r.qty)}</strong></td>
            <td class="bal-dm-cell" onclick="event.stopPropagation()">${dmHtml}</td>
            <td class="mono">${
              Number(r.is_reserve) === 1 || Number(r.reserved_qty) > 0
                ? `<span title="Активный резерв">${esc(r.reserved_qty || r.qty)}</span>`
                : '<span class="muted">—</span>'
            }</td>
            <td>${esc(r.unit)}</td>
          </tr>`;
            })
            .join('') || '<tr><td colspan="9" class="muted">Пусто — на этом складе нет остатков</td></tr>'
        }
      </tbody>
    </table></div>
    ${footerHtml}
    ${pagerHtml('bpager2', data.page, data.pages, data.total, { limit, listKey: 'balances' })}`,
    {
      sectionId: 'warehouse',
      entityKind: 'warehouse',
      toolbar: `
        <select id="bwh">${whOpts}</select>
        ${
          wh && xferAllowed
            ? `<button type="button" class="${xferOpen ? '' : 'primary'}" id="bal-xfer-toggle" aria-expanded="${
                xferOpen ? 'true' : 'false'
              }">${xferOpen ? 'Свернуть заказ' : 'Создать заказ на перемещение'}</button>
               <button type="button" id="bal-xfer-hist-top">История заказов</button>`
            : wh && isAutoWh
              ? `<span class="muted" title="${esc(whAutoSysTip(whRow || { id: wh, name: whLabel, code: '' }))}" style="font-size:12px">Автосклад</span>`
              : ''
        }
        ${
          wh && !isAutoWh && Number(whRow?.is_active) !== 0
            ? archiveIconBtn('bal-wh', false)
            : ''
        }
        <div class="grow"></div>
        <div class="find">
          <input id="bq" placeholder="Товар / артикул" value="${esc(q)}" autocomplete="off" />
          <button type="button" class="find-go" id="bgo">Найти</button>
        </div>`,
    }
  );
  // URL всегда отражает выбранный склад: /warehouses/:id или /balances
  setUrl(pathForTab('balances'));
  const balTab = state.tabs.find((t) => t.id === state.activeTab);
  if (balTab && state.activeTab === 'balances') {
    balTab.title = String(wh ? title : 'Остатки').slice(0, 48);
    renderTabs();
  }
  bindFormChrome(() => showSection('warehouse'));
  bindWhCardTabs();
  const openXferHist = () => {
    state.whHubTab = 'requests';
    openTab('warehouses', 'Склады');
  };
  document.getElementById('bal-xfer-hist-top')?.addEventListener('click', openXferHist);
  document.getElementById('bal-xfer-toggle')?.addEventListener('click', () => {
    state.balXferOpen = !state.balXferOpen;
    if (!state.balXferOpen) state.balXferSelectAll = false;
    renderBalances();
  });
  document.getElementById('bal-xfer-close')?.addEventListener('click', () => {
    state.balXferOpen = false;
    state.balXferSelectAll = false;
    renderBalances();
  });
  document.getElementById('bal-wh-archive')?.addEventListener('click', async () => {
    if (!wh || isAutoWh) return;
    if (totalQty > 0) {
      alert(
        `Сначала переместите остатки (кол-во: ${totalQty}).\nОткроется заказ на перемещение — выберите склад «Куда» и укажите комментарий.`
      );
      state.balXferOpen = true;
      state.balXferSelectAll = true;
      renderBalances();
      return;
    }
    if (!confirm(`Перенести склад «${whLabel}» в архив?\nОстатков нет — архив сразу.`)) return;
    try {
      await api(`/warehouses/${encodeURIComponent(wh)}/archive`, { method: 'POST', body: '{}' });
      state.balWh = '';
      state.balXferOpen = false;
      state.balXferSelectAll = false;
      openTab('warehouses', 'Склады');
    } catch (e) {
      const msg = String(e?.message || e);
      if (/остатк/i.test(msg)) {
        alert(msg + '\nОткроется заказ на перемещение.');
        state.balXferOpen = true;
        state.balXferSelectAll = true;
        renderBalances();
        return;
      }
      alert(msg);
    }
  });
  const xferGo = document.getElementById('bal-xfer-go');
  if (xferGo && wh && xferOpen) {
    if (state.balXferSelectAll) state.balXferSelectAll = false;
    const syncXferSum = () => {
      const picks = [...view.querySelectorAll('.bal-xfer-pick:checked')];
      let qtySum = 0;
      for (const cb of picks) {
        const inp = view.querySelector(`.bal-xfer-qty[data-product="${CSS.escape(cb.dataset.product || '')}"]`);
        qtySum += Number(inp?.value) || 0;
      }
      const el = document.getElementById('bal-xfer-sum');
      if (el) el.textContent = `Выбрано: ${picks.length} поз. · ${qtySum} шт.`;
    };
    const toggleRow = (cb) => {
      const inp = view.querySelector(
        `.bal-xfer-qty[data-product="${CSS.escape(cb.dataset.product || '')}"]`
      );
      if (inp) {
        inp.disabled = !cb.checked;
        if (cb.checked && !(Number(inp.value) > 0)) {
          inp.value = String(cb.dataset.avail || inp.getAttribute('max') || '');
        }
      }
      syncXferSum();
    };
    view.querySelectorAll('.bal-xfer-pick').forEach((cb) => {
      cb.onchange = () => toggleRow(cb);
    });
    view.querySelectorAll('.bal-xfer-qty').forEach((inp) => {
      inp.oninput = syncXferSum;
    });
    const allCb = document.getElementById('bal-xfer-all');
    if (allCb) {
      allCb.onchange = () => {
        view.querySelectorAll('.bal-xfer-pick').forEach((cb) => {
          cb.checked = allCb.checked;
          toggleRow(cb);
        });
      };
    }
    document.getElementById('bal-xfer-hist')?.addEventListener('click', openXferHist);
    xferGo.onclick = async () => {
      const toId = String(document.getElementById('bal-xfer-to')?.value || '').trim();
      const comment = String(document.getElementById('bal-xfer-comment')?.value || '').trim();
      const msg = document.getElementById('bal-xfer-msg');
      const toLabel =
        document.getElementById('bal-xfer-to')?.selectedOptions?.[0]?.textContent?.trim() || toId;
      if (!toId) {
        if (msg) msg.textContent = 'Укажите склад «Куда»';
        return;
      }
      if (!comment) {
        if (msg) msg.textContent = 'Укажите комментарий к заказу на перемещение';
        document.getElementById('bal-xfer-comment')?.focus();
        return;
      }
      const lines = [];
      for (const cb of view.querySelectorAll('.bal-xfer-pick:checked')) {
        const productId = String(cb.dataset.product || '');
        const inp = view.querySelector(
          `.bal-xfer-qty[data-product="${CSS.escape(productId)}"]`
        );
        const qty = Number(inp?.value);
        const avail = Number(cb.dataset.avail) || 0;
        if (!(qty > 0)) {
          if (msg) msg.textContent = 'У выбранных позиций количество должно быть больше 0';
          return;
        }
        if (qty > avail + 1e-9) {
          if (msg) msg.textContent = `Количество больше остатка (${avail})`;
          return;
        }
        lines.push({ product_id: productId, qty });
      }
      if (!lines.length) {
        if (msg) msg.textContent = 'Отметьте позиции и количество';
        return;
      }
      const qtySum = lines.reduce((s, l) => s + l.qty, 0);
      if (
        !confirm(
          `Создать заказ на перемещение?\n\nОткуда: ${whLabel}\nКуда: ${toLabel}\nПозиций: ${lines.length}\nКоличество: ${qtySum}\nКомментарий: ${comment}\n\nСразу уйдёт в очередь кладовщикам (/pick и Задания склада).`
        )
      ) {
        return;
      }
      xferGo.disabled = true;
      if (msg) msg.textContent = 'Создание…';
      try {
        const r = await api('/stock/transfer-request', {
          method: 'POST',
          body: JSON.stringify({
            warehouse_from_id: wh,
            warehouse_to_id: toId,
            comment,
            post: false,
            lines,
          }),
        });
        const taskNum = r.warehouse_task?.number || '';
        const histNum = r.history?.number || '';
        if (msg) {
          msg.textContent =
            `Заказ на перемещение ${histNum || r.number || ''} · ${r.from_label || whLabel} → ${r.to_label || toLabel} · ${r.lines || 0} поз.` +
            (taskNum ? ` · задание ${taskNum}` : '') +
            (r.missing_serials && r.missing_serials.length
              ? ` · без марок: ${r.missing_serials.length}`
              : '');
        }
        if (r.history?.id) {
          try {
            const u = new URL(location.href);
            u.searchParams.set('doc', r.history.id);
            history.replaceState(null, '', u.pathname + u.search + u.hash);
          } catch {
            /* ignore */
          }
          openTab('xfer:' + r.history.id, histNum || 'Заказ на перемещение');
        } else if (taskNum) {
          state.whTaskFocus = r.warehouse_task.id;
          openTab('wh-tasks', taskNum);
        } else if (r.id) {
          openTab('doc:' + r.id, (r.number || 'TR').slice(0, 40));
        }
        state.balXferOpen = false;
        setTimeout(() => renderBalances(), 400);
      } catch (err) {
        if (msg) msg.textContent = err.message || String(err);
        alert(err.message || String(err));
        xferGo.disabled = false;
      }
    };
  }
  const apply = () => {
    const nextWh = document.getElementById('bwh').value;
    if (nextWh !== state.balWh) {
      state.balXferOpen = false;
      state.balXferSelectAll = false;
      state.balHistPage = 1;
      if (!nextWh) state.balWhTab = 'stock';
    }
    state.balWh = nextWh;
    state.balQ = document.getElementById('bq').value.trim();
    state.balPage = 1;
    renderBalances();
  };
  document.getElementById('bgo').onclick = apply;
  document.getElementById('bq').onkeydown = (e) => {
    if (e.key === 'Enter') apply();
  };
  document.getElementById('bwh').onchange = apply;
  view.querySelectorAll('th[data-sort]').forEach((thEl) => {
    thEl.onclick = (e) => {
      e.stopPropagation();
      const key = thEl.getAttribute('data-sort') || '';
      if (!key) return;
      if (state.balSort === key) {
        state.balDir = state.balDir === 'asc' ? 'desc' : 'asc';
      } else {
        state.balSort = key;
        state.balDir = key === 'qty' || key === 'reserved' || key === 'marks' ? 'desc' : 'asc';
      }
      state.balPage = 1;
      renderBalances();
    };
  });
  bindListPager(['bpager', 'bpager2'], 'balances', 'balPage', () => renderBalances());
  view.querySelectorAll('tr[data-product]').forEach((tr) => {
    tr.onclick = () => openTab('product:' + tr.dataset.product);
  });
  view.querySelectorAll('[data-serial]').forEach((btn) => {
    btn.onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      const code = btn.getAttribute('data-serial');
      if (code) openTab('serial:' + code, String(code).slice(0, 40));
    };
  });
  view.querySelectorAll('[data-product-units]').forEach((btn) => {
    btn.onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      const pid = btn.getAttribute('data-product-units');
      if (!pid) return;
      state.unitsQ = '';
      state.unitsStatus = 'in_stock';
      state.unitsPage = 1;
      state.unitsProductId = pid;
      state.unitsWarehouseId = btn.getAttribute('data-wh') || '';
      openTab('product-units');
    };
  });
}

async function renderStockValuation() {
  await refreshRefs();
  const wh = state.valWh || '';
  const q = state.valQ || '';
  const page = state.valPage || 1;
  const limit = getPageSize('valuation', 50);
  const qs = new URLSearchParams({ page: String(page), limit: String(limit) });
  if (wh) qs.set('warehouse_id', wh);
  if (q) qs.set('q', q);
  let data;
  try {
    data = await api('/stock/valuation?' + qs.toString());
  } catch (e) {
    view.innerHTML = formChrome('Стоимость склада', `<p class="error">${esc(e.message)}</p>`);
    bindFormChrome(() => showSection('warehouse'));
    return;
  }
  const list = data.items || [];
  const byWh = data.by_warehouse || [];
  const byPurchase = data.by_purchase || [];
  const whOpts =
    '<option value="">Все склады</option>' +
    state.warehouses
      .map((w) => `<option value="${esc(w.id)}" ${w.id === wh ? 'selected' : ''}>${esc(w.name)}</option>`)
      .join('');
  const methodLabel =
    data.method === 'fifo_inbound' ? 'FIFO по приходам' : data.method || 'оценка';
  view.innerHTML = formChrome(
    'Стоимость склада',
    `
    <div class="panel" style="margin-bottom:12px">
      <div style="font-size:12px;color:var(--muted,#888)">Итого · ${esc(methodLabel)} (закуп)</div>
      <div style="font-size:26px;font-weight:700;margin-top:4px">${formatMoney(data.total_value)}</div>
      <p class="muted" style="margin:8px 0 0;font-size:12px">
        ${esc(data.method_note || 'Не себестоимость 1С.')}
        · позиций: ${esc(data.lines_count || 0)}
        · с ценой: ${esc(data.lines_with_price || 0)}
        ${
          data.lines_without_price
            ? ` · без цены закупа: ${esc(data.lines_without_price)}`
            : ''
        }
        ${
          data.qty_unpriced
            ? ` · qty без цены: ${esc(data.qty_unpriced)}`
            : ''
        }
      </p>
      <p style="margin:8px 0 0;font-size:14px">
        Сумма по рознице: <b>${formatMoney(data.total_value_retail || 0)}</b>
        <span class="muted" style="font-size:12px"> · qty × «Розничная цена»</span>
      </p>
      ${
        data.total_value_last_purchase != null &&
        Math.abs(Number(data.total_value_last_purchase) - Number(data.total_value)) > 0.01
          ? `<p class="muted" style="margin:6px 0 0;font-size:12px">
              Для сравнения · по последнему закупу: <b>${formatMoney(data.total_value_last_purchase)}</b>
            </p>`
          : ''
      }
    </div>
    ${
      byWh.length > 1
        ? `<div class="panel" style="margin-bottom:12px">
            <h3 style="margin:0 0 8px;font-size:13px">По складам</h3>
            <table>
              <thead><tr><th>Склад</th><th>Кол-во</th><th>Позиций</th><th>По закупу</th><th>По рознице</th></tr></thead>
              <tbody>
                ${byWh
                  .map(
                    (r) => `<tr class="clickable" data-wh="${esc(r.warehouse_id)}">
                      <td>${esc(r.warehouse)}</td>
                      <td class="mono">${esc(r.qty)}</td>
                      <td class="mono">${esc(r.lines)}</td>
                      <td class="mono"><strong>${formatMoney(r.value_purchase != null ? r.value_purchase : r.value)}</strong></td>
                      <td class="mono">${formatMoney(r.value_retail || 0)}</td>
                    </tr>`
                  )
                  .join('')}
              </tbody>
            </table>
          </div>`
        : ''
    }
    ${
      byPurchase.length
        ? `<div class="panel" style="margin-bottom:12px">
            <h3 style="margin:0 0 8px;font-size:13px">Приходы, формирующие стоимость (топ)</h3>
            <table>
              <thead><tr><th>Дата</th><th>Номер</th><th>Поставщик</th><th>Кол-во в остатке</th><th>Сумма</th></tr></thead>
              <tbody>
                ${byPurchase
                  .map(
                    (r) => `<tr class="clickable" data-doc="${esc(r.doc_id)}">
                      <td>${esc(String(r.doc_date || '').slice(0, 10))}</td>
                      <td class="mono">${esc(r.doc_number)}</td>
                      <td>${esc(r.counterparty || '—')}</td>
                      <td class="mono">${esc(r.qty)}</td>
                      <td class="mono"><strong>${formatMoney(r.value)}</strong></td>
                    </tr>`
                  )
                  .join('')}
              </tbody>
            </table>
          </div>`
        : ''
    }
    ${pagerHtml('vpager', data.page, data.pages, data.total, { limit, listKey: 'valuation' })}
    <table>
      <thead>
        <tr>
          <th>Склад</th><th>SKU</th><th>Номенклатура</th>
          <th>Кол-во</th><th>Цена FIFO</th><th>Закуп</th><th>Розница</th><th>Приходы</th>
        </tr>
      </thead>
      <tbody>
        ${
          list
            .map((r) => {
              const layers = r.layers || [];
              const layerTip = layers.length
                ? layers
                    .slice(0, 3)
                    .map(
                      (l) =>
                        `${l.doc_number} · ${String(l.doc_date || '').slice(0, 10)} · ${l.qty}×${formatMoney(l.price)}`
                    )
                    .join('; ') + (layers.length > 3 ? ` +${layers.length - 3}` : '')
                : r.qty_unpriced
                  ? 'нет цены в приходах'
                  : '—';
              return `
          <tr class="clickable" data-product="${esc(r.product_id)}">
            <td>${esc(r.warehouse)}</td>
            <td class="mono">${esc(r.sku)}</td>
            <td>${esc(r.name)}</td>
            <td class="mono">${esc(r.qty)}${
              r.qty_unpriced
                ? ` <span class="muted" title="без цены">(${esc(r.qty_unpriced)} без цены)</span>`
                : ''
            }</td>
            <td class="mono">${r.unit_cost != null ? formatMoney(r.unit_cost) : r.last_price != null ? formatMoney(r.last_price) : '<span class="muted">нет</span>'}</td>
            <td class="mono"><strong>${formatMoney(r.line_value)}</strong></td>
            <td class="mono">${formatMoney(r.retail_line_value || 0)}</td>
            <td class="muted" style="font-size:11px;max-width:280px">${esc(layerTip)}</td>
          </tr>`;
            })
            .join('') || '<tr><td colspan="8" class="muted">Нет остатков</td></tr>'
        }
      </tbody>
    </table>
    ${pagerHtml('vpager2', data.page, data.pages, data.total, { limit, listKey: 'valuation' })}`,
    {
      toolbar: `
        <select id="vwh">${whOpts}</select>
        <button type="button" id="v-balances">Остатки</button>
        <div class="grow"></div>
        <div class="find">
          <input id="vq" placeholder="Поиск (Ctrl+F)" value="${esc(q)}" autocomplete="off" />
          <button type="button" class="find-go" id="vgo">Найти</button>
        </div>`,
    }
  );
  bindFormChrome(() => showSection('warehouse'));
  const apply = () => {
    state.valWh = document.getElementById('vwh').value;
    state.valQ = document.getElementById('vq').value.trim();
    state.valPage = 1;
    renderStockValuation();
  };
  document.getElementById('vgo').onclick = apply;
  document.getElementById('vq').onkeydown = (e) => {
    if (e.key === 'Enter') apply();
  };
  document.getElementById('vwh').onchange = apply;
  document.getElementById('v-balances').onclick = () => openTab('balances');
  view.querySelectorAll('[data-wh]').forEach((tr) => {
    tr.onclick = () => {
      state.valWh = tr.dataset.wh;
      state.valPage = 1;
      renderStockValuation();
    };
  });
  view.querySelectorAll('[data-doc]').forEach((tr) => {
    tr.onclick = () => openTab('doc:' + tr.dataset.doc);
  });
  view.querySelectorAll('[data-product]').forEach((tr) => {
    tr.onclick = () => openTab('product:' + tr.dataset.product);
  });
  bindListPager(['vpager', 'vpager2'], 'valuation', 'valPage', () => renderStockValuation());
}

async function renderDocs() {
  const type = state.docsType || '';
  const q = state.docsQ || '';
  const sort = state.docsSort || 'date';
  const dir = state.docsDir || 'desc';
  const page = Math.max(1, Number(state.docsPage) || 1);
  const limit = getPageSize('docs', 50);
  const qs = new URLSearchParams();
  if (type) qs.set('type', type);
  if (q) qs.set('q', q);
  qs.set('sort', sort);
  qs.set('dir', dir);
  qs.set('page', String(page));
  qs.set('limit', String(limit));
  withCompanyId(qs);
  const data = await api('/docs?' + qs.toString());
  const list = Array.isArray(data) ? data : data.items || [];
  const total = Array.isArray(data) ? list.length : Number(data.total) || list.length;
  const pages = Array.isArray(data) ? 1 : Math.max(1, Number(data.pages) || 1);
  const typeLabel = (d) => {
    const c = String(d.comment || '');
    if (d.doc_type === 'return' || c.includes('возврат от покупателя') || c.includes('возврат от клиента'))
      return 'Возврат от клиента';
    if (c.includes('тип:складской приход')) return 'Складской приход';
    if (c.includes('тип:складской')) {
      return d.doc_type === 'in' ? 'Складской приход' : 'Расход';
    }
    if (d.doc_type === 'in') {
      if (c.includes('основание:док.501')) return 'От поставщика · по заказу';
      return 'От поставщика';
    }
    if (d.doc_type === 'out') return 'Расход';
    if (d.doc_type === 'transfer') return 'Перемещение';
    return d.doc_type || '—';
  };
  const title =
    type === 'in'
      ? 'Приходные накладные'
      : type === 'out'
        ? 'Расходные накладные'
        : type === 'return'
          ? 'Возвраты от покупателей'
          : 'Документы';
  const backSection = 'documents';
  const mark = (key) => {
    if (sort !== key) return '';
    return dir === 'asc' ? ' ▲' : ' ▼';
  };
  const th = (key, label) =>
    `<th class="sortable ${sort === key ? 'sorted' : ''}" data-sort="${key}" title="Сортировка">${esc(label)}${mark(key)}</th>`;
  const amountCol =
    type === 'in' ? 'Сумма закупки' : type === 'return' ? 'Сумма возврата' : type === 'out' ? 'Сумма' : 'Сумма';
  const cpCol =
    type === 'in' ? 'Поставщик' : type === 'return' ? 'Покупатель' : 'Контрагент';
  const listHint =
    type === 'in'
      ? 'Приходные: колонка «Тип» — от поставщика / складской / по заказу. Клик — карточка.'
      : type === 'return'
        ? 'Возвраты от покупателей (приходная на основании расходной). В комментарии — номер расходной.'
        : type === 'out'
          ? 'Расходные накладные. Клик — состав списанных товаров.'
          : 'Журнал из 1С (приход/расход/возврат) и локальные. Колонка «Тип» — вид документа.';
  const showTypeCol = !type;
  view.innerHTML = formChrome(
    title,
    `
    <p class="muted" style="margin:0 0 8px">${esc(listHint)}</p>
    ${pagerHtml('docspager', page, pages, total, { limit, listKey: 'docs' })}
    <table data-no-col-filter="1" data-table-key="docs-${esc(type || 'all')}">
      <thead><tr>
        ${th('date', 'Дата')}
        ${th('number', 'Номер')}
        ${showTypeCol ? th('type', 'Тип') : ''}
        ${th('counterparty', cpCol)}
        ${th('warehouse', 'Склад')}
        ${th('amount', amountCol)}
        ${th('status', 'Статус')}
      </tr></thead>
      <tbody>
        ${
          list
            .map(
              (d) => `
          <tr class="clickable" data-doc="${esc(d.id)}">
            <td>${esc(String(d.doc_date || '').slice(0, 10))}</td>
            <td class="mono">${esc(d.number)}</td>
            ${
              showTypeCol
                ? `<td><span class="badge ${
                    d.doc_type === 'return' ? 'draft' : ''
                  }" title="${esc(d.comment || '')}">${esc(typeLabel(d))}</span></td>`
                : ''
            }
            <td>${esc(d.counterparty || '—')}</td>
            <td>${esc(d.warehouse || '—')}${d.warehouse_to ? ' → ' + esc(d.warehouse_to) : ''}</td>
            <td class="mono">${d.amount != null ? formatMoney(d.amount) : '—'}</td>
            <td><span class="badge ${d.posted ? '' : 'draft'}">${d.posted ? 'Проведён' : 'Черновик'}${d.source === '1c' ? ' · 1С' : ''}</span></td>
          </tr>`
            )
            .join('') ||
            `<tr><td colspan="${showTypeCol ? 7 : 6}" class="muted">Документов пока нет — кнопка «Документы 1С» на главной</td></tr>`
        }
      </tbody>
    </table>
    ${pagerHtml('docspager2', page, pages, total, { limit, listKey: 'docs' })}`,
    {
      toolbar: `
        ${
          type === 'out'
            ? ''
            : '<button type="button" class="primary" id="goto-in" title="Создать приходную — выбрать основание">Создать приход</button>'
        }
        ${
          type === 'out' || !type
            ? '<button type="button" id="goto-out">Создать расход</button>'
            : ''
        }
        <div class="form-pagetabs" style="display:inline-flex;margin:0" id="docs-type-tabs" role="tablist" aria-label="Тип документов">
          <button type="button" class="form-pagetab ${type === 'in' ? 'active' : ''}" data-docs-type="in" role="tab" aria-selected="${type === 'in' ? 'true' : 'false'}">Приходные</button>
          <button type="button" class="form-pagetab ${type === 'return' ? 'active' : ''}" data-docs-type="return" role="tab" aria-selected="${type === 'return' ? 'true' : 'false'}">Возвраты</button>
          <button type="button" class="form-pagetab ${type === 'out' ? 'active' : ''}" data-docs-type="out" role="tab" aria-selected="${type === 'out' ? 'true' : 'false'}">Расходные</button>
          <button type="button" class="form-pagetab ${!type ? 'active' : ''}" data-docs-type="" role="tab" aria-selected="${!type ? 'true' : 'false'}">Все</button>
        </div>
        <div class="grow"></div>
        <div class="find">
          <input id="docs-q" placeholder="Номер / контрагент" value="${esc(q)}" />
          <button type="button" class="find-go" id="docs-search">Найти</button>
        </div>`,
    }
  );
  bindFormChrome(() => showSection(backSection));
  const gotoIn = document.getElementById('goto-in');
  if (gotoIn) {
    gotoIn.onclick = () => {
      state.inCreateBasis = '';
      openTab('in-new');
    };
  }
  const gotoOut = document.getElementById('goto-out');
  if (gotoOut) gotoOut.onclick = () => openTab('out-new');
  view.querySelectorAll('#docs-type-tabs [data-docs-type]').forEach((btn) => {
    btn.onclick = () => {
      const next = btn.getAttribute('data-docs-type') || '';
      state.docsType = next;
      state.docsPage = 1;
      if (next === 'in') openTab('in');
      else if (!next) openTab('docs');
      else renderDocs();
    };
  });
  document.getElementById('docs-search').onclick = () => {
    state.docsQ = document.getElementById('docs-q').value.trim();
    state.docsPage = 1;
    renderDocs();
  };
  document.getElementById('docs-q').onkeydown = (e) => {
    if (e.key === 'Enter') {
      state.docsQ = document.getElementById('docs-q').value.trim();
      state.docsPage = 1;
      renderDocs();
    }
  };
  view.querySelectorAll('th.sortable').forEach((thEl) => {
    thEl.onclick = (e) => {
      e.stopPropagation();
      const key = thEl.dataset.sort;
      if (state.docsSort === key) {
        state.docsDir = state.docsDir === 'asc' ? 'desc' : 'asc';
      } else {
        state.docsSort = key;
        state.docsDir = key === 'date' || key === 'amount' ? 'desc' : 'asc';
      }
      state.docsPage = 1;
      renderDocs();
    };
  });
  view.querySelectorAll('[data-doc]').forEach((tr) => {
    tr.onclick = () => openTab('doc:' + tr.dataset.doc);
  });
  bindListPager(['docspager', 'docspager2'], 'docs', 'docsPage', () => renderDocs());
}

function renderDocLinksPanel(links, note, opts = {}) {
  const list = Array.isArray(links) ? links : [];
  if (!list.length) {
    return `<h3 style="margin:16px 0 8px;font-size:13px;color:var(--taxi-green)">Связи</h3>
      <p class="muted" style="margin:0 0 12px">Связанных документов не найдено.</p>`;
  }

  const groups = [
    {
      title: 'Основания и парные документы',
      kinds: ['customer_order', 'sale', 'warehouse', 'return_basis', 'inbound_basis'],
    },
    {
      title: 'Откуда товар раньше приходил (не основание документа)',
      kinds: ['purchase'],
    },
    {
      title: 'Заказы поставщикам',
      kinds: ['supplier_order'],
    },
    {
      title: 'Прочее',
      kinds: ['related'],
    },
  ];

  const rowHtml = (L) => {
    const isDeal =
      L.doc_type === 'deal' || (L.kind === 'customer_order' && L.doc_type !== 'basis_order');
    const isSales = L.doc_type === 'sales_doc';
    const isBasisOnly = L.doc_type === 'basis_order';
    const openable =
      !isBasisOnly && L.doc_type !== 'payment' && L.doc_type !== 'supplier_order';
    const isPurchase = L.kind === 'purchase';
    const details = isPurchase
      ? [
          L.counterparty ? `поставщик: ${L.counterparty}` : '',
          L.product_name ? `товар: ${L.product_name}` : '',
          L.qty != null && Number(L.price) > 0 ? `${L.qty} × ${formatMoney(L.price)}` : '',
        ]
          .filter(Boolean)
          .join(' · ')
      : [L.counterparty || '', L.product_name ? `товар: ${L.product_name}` : '', L.comment ? L.comment.slice(0, 80) : '']
          .filter(Boolean)
          .join(' · ');
    const openAttr = isDeal
      ? `data-deal-link="${esc(L.doc_id)}"`
      : isSales
        ? `data-sales-link="${esc(L.doc_id)}"`
        : openable
          ? `data-doc-link="${esc(L.doc_id)}"`
          : '';
    return `<tr class="${openable ? 'clickable' : ''}" ${openAttr} ${
      L.doc_type === 'supplier_order' ? 'data-supplier-order="1"' : ''
    }>
      <td>${esc(String(L.doc_date || '').slice(0, 10))}</td>
      <td>${esc(L.label)}</td>
      <td class="mono">${esc(L.number)}</td>
      <td>${esc(details || '—')}</td>
      <td class="mono">${formatMoney(L.amount)}</td>
    </tr>`;
  };

  const used = new Set();
  let body = '';
  for (const g of groups) {
    const items = list.filter((L) => g.kinds.includes(L.kind));
    items.forEach((L) => used.add(L));
    if (!items.length) continue;
    body += `<h4 style="margin:14px 0 6px;font-size:12px;color:var(--muted,#888)">${esc(g.title)} · ${items.length}</h4>
      <table>
        <thead><tr><th>Дата</th><th>Тип</th><th>Номер</th><th>Поставщик / детали</th><th>Сумма</th></tr></thead>
        <tbody>${items.map(rowHtml).join('')}</tbody>
      </table>`;
  }
  const rest = list.filter((L) => !used.has(L));
  if (rest.length) {
    body += `<h4 style="margin:14px 0 6px;font-size:12px;color:var(--muted,#888)">Ещё</h4>
      <table><tbody>${rest.map(rowHtml).join('')}</tbody></table>`;
  }

  const purchases = list.filter((L) => L.kind === 'purchase' && L.counterparty);
  const suppliers = [...new Set(purchases.map((L) => L.counterparty).filter(Boolean))];
  const supplierSummary =
    opts.highlightSuppliers && suppliers.length
      ? `<div class="panel" style="margin:0 0 12px;padding:10px 12px">
          <div style="font-size:12px;color:var(--muted,#888);margin-bottom:4px">Поставщики по этим товарам (из приходных)</div>
          <div style="font-size:14px"><b>${esc(suppliers.join(', '))}</b></div>
          <p class="muted" style="margin:6px 0 0;font-size:11px">Это история поступлений того же товара, а не «основание» текущей расходной. Жёсткая партия «эта штука = этот приход» в 1С обычно не хранится. Если есть заказ поставщику — он в блоке ниже.</p>
        </div>`
      : '';

  return `${supplierSummary}
    <h3 style="margin:16px 0 8px;font-size:13px;color:var(--taxi-green)">Связи (${list.length})</h3>
    <p class="muted" style="margin:0 0 8px">${esc(note || 'Клик по строке — открыть документ.')}</p>
    ${body}`;
}

async function renderDocDetail(id) {
  let d = await api('/docs/' + id);
  // Полные реквизиты — из карточки контрагента (на документе часто только id/имя)
  const cpId = String(d.counterparty_id || '').trim();
  if (cpId) {
    try {
      const cp = await api('/counterparties/' + encodeURIComponent(cpId) + '?docs_limit=1');
      d = mergeCounterpartyIntoDoc(d, cp);
    } catch (_) {
      /* карточка недоступна — оставляем поля из JOIN документа */
    }
  }
  const lines = d.lines || [];
  const goodsCount = Number(d.goods_lines_count);
  const serviceCount = Number(d.service_lines_count);
  const hasService =
    (Number.isFinite(serviceCount) ? serviceCount : lines.filter((l) => String(l.item_kind) === 'service').length) > 0;
  const hasGoods =
    (Number.isFinite(goodsCount)
      ? goodsCount
      : lines.filter((l) => String(l.item_kind) !== 'service').length) > 0;
  const writesOff = d.writes_off_stock != null ? Boolean(d.writes_off_stock) : hasGoods;
  const serviceOnly = !hasGoods && (hasService || Number(d.services_omitted) > 0);
  const omittedSvc = Number(d.services_omitted) || 0;

  const typeMap = {
    in: 'Приходная накладная',
    out: serviceOnly
      ? 'Расходная · нет товаров (услуги в заказе/УПД)'
      : 'Расходная накладная',
    transfer: 'Перемещение',
    return: 'Возврат от клиента',
  };
  const typeShort = {
    in: 'Приходная',
    out: serviceOnly ? 'Расходная' : 'Расходная',
    transfer: 'Перемещение',
    return: 'Возврат',
  };
  const title = `${typeShort[d.doc_type] || d.doc_type} ${d.number || ''}`.trim();
  const tabId = 'doc:' + id;
  if (!state.tabs.find((t) => t.id === tabId)) {
    state.tabs.push({ id: tabId, title, closable: true });
  } else {
    const t = state.tabs.find((x) => x.id === tabId);
    if (t) t.title = title;
  }
  state.activeTab = tabId;
  renderTabs();
  showForm();
  highlightSection(sectionForTab(tabId));
  setUrl(pathForTab(tabId));
  const linesSum = lines.reduce((s, l) => s + (Number(l.amount) || Number(l.price) * Number(l.qty) || 0), 0);
  const docAmount = d.amount != null && Number(d.amount) !== 0 ? Number(d.amount) : linesSum;
  const isReturn = d.doc_type === 'return';
  // Возврат ≠ приход: это возврат от клиента, не закупка у поставщика
  const isIn = d.doc_type === 'in';
  const isOut = d.doc_type === 'out';
  const goodsN = lines.filter((l) => String(l.item_kind) !== 'service').length;
  const serviceN = lines.filter((l) => String(l.item_kind) === 'service').length;
  // Расходная = списание со склада (товары). Услуги — в УПД, остатки не трогают.
  const linesTitle = isOut
    ? serviceOnly
      ? `Нет товаров для списания`
      : `Списанные товары (${goodsN || lines.length})`
    : isReturn
      ? `Строки возврата (${lines.length})`
      : isIn
        ? `Строки закупки (${lines.length})`
        : `Строки (${lines.length})`;
  const linesTabLabel = isOut
    ? `Списанные${goodsN || lines.length ? ' (' + (goodsN || lines.length) + ')' : ''}`
    : isReturn
      ? `Возврат${lines.length ? ' (' + lines.length + ')' : ''}`
      : `Товары${lines.length ? ' (' + lines.length + ')' : ''}`;
  const dealId = String(d.deal_id || '').trim();
  const dealName = String(d.deal_name || '').trim();
  const dealStatus = String(d.deal_status_name || '').trim();
  const basisOrderId = String(d.basis_order_id || '').trim();
  const docComment = String(d.comment || '');
  const docLinks = Array.isArray(d.links) ? d.links : [];
  const inBasisPurchase =
    docLinks.find((L) => L.kind === 'inbound_basis') ||
    (() => {
      const num = docComment.match(/на основании складского:([^\s·]+)/)?.[1];
      return num ? { kind: 'inbound_basis', number: num, doc_id: '', label: 'Основание — закупка' } : null;
    })();
  const inBasisSupplierOrder =
    docLinks.find((L) => L.kind === 'supplier_order') ||
    (docComment.includes('основание:док.501') || String(d.source_supplier_order_id || '').trim()
      ? {
          kind: 'supplier_order',
          number: '',
          doc_id: String(d.source_supplier_order_id || '').trim(),
          label: 'Основание — заказ поставщика',
        }
      : null);
  const inBasisBanner = isIn
    ? inBasisPurchase
      ? `<div class="panel doc-basis-banner" style="margin-bottom:12px">
          <div style="font-size:12px;color:var(--muted,#888);margin-bottom:4px">Основание · закупка</div>
          <div style="display:flex;flex-wrap:wrap;gap:8px 14px;align-items:baseline">
            ${
              inBasisPurchase.doc_id
                ? `<button type="button" class="linkish" id="doc-open-basis-purchase" data-doc="${esc(
                    inBasisPurchase.doc_id
                  )}" style="font-size:15px;font-weight:600;padding:0;border:0;background:none;color:var(--taxi-green);cursor:pointer">№${esc(
                    inBasisPurchase.number || ''
                  )}</button>`
                : `<span style="font-size:15px;font-weight:600" class="mono">№${esc(
                    inBasisPurchase.number || '—'
                  )}</span>`
            }
            ${
              inBasisPurchase.counterparty
                ? `<span class="muted">${esc(inBasisPurchase.counterparty)}</span>`
                : ''
            }
            ${
              inBasisPurchase.doc_date
                ? `<span class="muted">${esc(String(inBasisPurchase.doc_date).slice(0, 10))}</span>`
                : ''
            }
          </div>
          <p class="muted" style="margin:6px 0 0;font-size:11px">Приход оформлен на основании складского / закупки.</p>
        </div>`
      : inBasisSupplierOrder
        ? `<div class="panel doc-basis-banner" style="margin-bottom:12px">
          <div style="font-size:12px;color:var(--muted,#888);margin-bottom:4px">Основание · заказ поставщика</div>
          <div style="display:flex;flex-wrap:wrap;gap:8px 14px;align-items:baseline">
            ${
              inBasisSupplierOrder.doc_id
                ? `<button type="button" class="linkish" id="doc-open-basis-so" data-so="${esc(
                    inBasisSupplierOrder.doc_id
                  )}" style="font-size:15px;font-weight:600;padding:0;border:0;background:none;color:var(--taxi-green);cursor:pointer">${
                    inBasisSupplierOrder.number
                      ? '№' + esc(inBasisSupplierOrder.number)
                      : 'Открыть заказ'
                  }</button>`
                : inBasisSupplierOrder.number
                  ? `<span style="font-size:15px;font-weight:600" class="mono">№${esc(
                      inBasisSupplierOrder.number
                    )}</span>`
                  : `<span style="font-size:14px;font-weight:600">Заказ поставщику (1С)</span>`
            }
            ${
              inBasisSupplierOrder.counterparty
                ? `<span class="muted">${esc(inBasisSupplierOrder.counterparty)}</span>`
                : d.counterparty
                  ? `<span class="muted">${esc(d.counterparty)}</span>`
                  : ''
            }
          </div>
          <p class="muted" style="margin:6px 0 0;font-size:11px">В 1С: основание док.501 — заказ поставщику.</p>
        </div>`
        : ''
    : '';
  const basisBanner =
    inBasisBanner ||
    (isOut && dealId
      ? `<div class="panel doc-basis-banner" style="margin-bottom:12px">
          <div style="font-size:12px;color:var(--muted,#888);margin-bottom:4px">Основание · заказ покупателя</div>
          <div style="display:flex;flex-wrap:wrap;gap:8px 14px;align-items:baseline">
            <button type="button" class="linkish" id="doc-open-deal" style="font-size:15px;font-weight:600;padding:0;border:0;background:none;color:var(--taxi-green);cursor:pointer">
              №${esc(dealId)}${dealName ? ` · ${esc(dealName)}` : ''}
            </button>
            ${dealStatus ? `<span class="badge">${esc(dealStatus)}</span>` : ''}
            ${
              d.deal_price != null && Number(d.deal_price) > 0
                ? `<span class="mono muted">${formatMoney(d.deal_price)}</span>`
                : ''
            }
            ${
              d.deal_amo_url
                ? `<a href="${esc(d.deal_amo_url)}" target="_blank" rel="noopener" style="font-size:12px">в Amo</a>`
                : ''
            }
          </div>
          <p class="muted" style="margin:6px 0 0;font-size:11px">
            Клик по номеру — открыть заказ покупателя.
          </p>
        </div>`
      : isOut && basisOrderId
        ? `<div class="panel doc-basis-banner" style="margin-bottom:12px">
            <div style="font-size:12px;color:var(--muted,#888)">Основание · заказ 1С</div>
            <p style="margin:6px 0 0;font-size:13px">GUID: <span class="mono">${esc(basisOrderId)}</span></p>
            <p class="muted" style="margin:6px 0 0;font-size:12px">
              Номер заказа в 1С пустой. Укажите заказ покупателя вручную:
            </p>
            <div class="find" style="margin:8px 0 0;max-width:420px">
              <input id="doc-link-deal" class="mono" placeholder="№ заказа покупателя…" autocomplete="off" />
              <button type="button" id="doc-link-deal-go">Привязать</button>
              <span class="muted" id="doc-link-deal-msg" style="margin-left:8px"></span>
            </div>
          </div>`
        : isOut
          ? `<div class="panel doc-basis-banner" style="margin-bottom:12px">
            <div style="font-size:12px;color:var(--muted,#888)">Основание · заказ покупателя</div>
            <p class="muted" style="margin:6px 0 8px;font-size:12px">
              ${
                String(d.comment || '').includes('продажа:')
                  ? 'Складской расход — заказ обычно на парной расходной (продажа). Можно привязать вручную:'
                  : 'В шапке 1С не было заказа покупателя. Укажите номер заказа (из Amo):'
              }
            </p>
            <div class="find" style="margin:0;max-width:420px">
              <input id="doc-link-deal" class="mono" placeholder="№ заказа покупателя…" autocomplete="off" />
              <button type="button" id="doc-link-deal-go">Привязать</button>
              <span class="muted" id="doc-link-deal-msg" style="margin-left:8px"></span>
            </div>
          </div>`
          : '');
  const linesPreview =
    lines.length > 0
      ? `<ul class="doc-lines-preview">${lines
          .slice(0, 8)
          .map(
            (l) =>
              `<li><span class="mono">${esc(l.sku || '')}</span> ${esc(l.product_name || l.product_id || '—')} <span class="muted">× ${esc(l.qty)}</span></li>`
          )
          .join('')}${
          lines.length > 8
            ? `<li class="muted">… и ещё ${lines.length - 8}</li>`
            : ''
        }</ul>`
      : '<p class="muted" style="margin:8px 0 0">Позиций в документе нет.</p>';
  const summaryPanel = isReturn
    ? `<div class="panel" style="margin-bottom:12px">
            <div style="font-size:12px;color:var(--muted,#888)">Возврат от клиента (не приход от поставщика)</div>
            <p class="muted" style="margin:6px 0 0;font-size:12px">
              Клиент: <b>${esc(d.counterparty || '—')}</b>${
                d.counterparty_id
                  ? ` · <span class="badge" style="vertical-align:middle">${esc(
                      partyKindLabel({
                        party_kind: d.counterparty_party_kind,
                        inn: d.counterparty_inn,
                      })
                    )}</span>`
                  : ''
              }
              · дата: <b>${esc(String(d.doc_date || '').slice(0, 10))}</b>
              · строк: <b>${lines.length}</b>
            </p>
            ${d.comment ? `<p class="muted" style="margin:4px 0 0;font-size:11px">${esc(d.comment)}</p>` : ''}
          </div>`
    : isIn
      ? inBasisBanner
        ? `<div class="panel" style="margin-bottom:12px">
            <div style="font-size:12px;color:var(--muted,#888)">Приходная накладная</div>
            <p class="muted" style="margin:6px 0 0;font-size:12px">
              Поставщик: <b>${esc(d.counterparty || '—')}</b>
              · дата: <b>${esc(String(d.doc_date || '').slice(0, 10))}</b>
              · строк: <b>${lines.length}</b>
            </p>
          </div>`
        : `<div class="panel" style="margin-bottom:12px">
            <div style="font-size:12px;color:var(--muted,#888)">Закупка</div>
            <p class="muted" style="margin:6px 0 0;font-size:12px">
              Поставщик: <b>${esc(d.counterparty || '—')}</b>
              · дата: <b>${esc(String(d.doc_date || '').slice(0, 10))}</b>
              · строк: <b>${lines.length}</b>
            </p>
          </div>`
      : isOut
        ? `<div class="panel" style="margin-bottom:12px">
            <div style="font-size:12px;color:var(--muted,#888)">${
              serviceOnly
                ? 'Расходная без товаров — услуги только в заказе покупателя и УПД'
                : 'Расходная · списание товаров со склада'
            }</div>
            <p class="muted" style="margin:6px 0 0;font-size:12px">
              Покупатель: <b>${esc(d.counterparty || '—')}</b>${
                d.counterparty_id
                  ? ` · <span class="badge" style="vertical-align:middle">${esc(
                      partyKindLabel({
                        party_kind: d.counterparty_party_kind,
                        inn: d.counterparty_inn,
                      })
                    )}</span>`
                  : ''
              }
              · дата: <b>${esc(String(d.doc_date || '').slice(0, 10))}</b>
              · ${
                serviceOnly
                  ? `товаров: <b>0</b>${omittedSvc ? ` · услуг в 1С опущено: <b>${omittedSvc}</b>` : ''}`
                  : `товаров к списанию: <b>${goodsN || lines.length}</b>${
                      omittedSvc ? ` · услуг не в расходной: <b>${omittedSvc}</b>` : ''
                    }`
              }
            </p>
            ${linesPreview}
          </div>`
        : '';
  const statusText =
    (d.posted ? 'Проведён' : 'Черновик') +
    (d.source === '1c' ? ' · 1С' : '') +
    (isOut && serviceOnly ? ' · без списания' : '');
  const linesTableHtml = lines.length
    ? `<table>
        <thead><tr><th>SKU</th><th>Номенклатура</th><th>Склад</th><th>Кол-во</th><th>Марки</th></tr></thead>
        <tbody>
          ${lines
            .map((l) => {
              const serials = Array.isArray(l.serials)
                ? l.serials
                : String(l.serials_json || '')
                    .replace(/^\[|\]$/g, '')
                    .split(',')
                    .map((s) => s.replace(/"/g, '').trim())
                    .filter(Boolean);
              const fromUnits = (d.units || []).filter(
                (u) =>
                  u.product_id === l.product_id &&
                  (u.in_line_id === l.id || u.out_line_id === l.id || !l.id)
              );
              const ser = serials.length ? serials : fromUnits.map((u) => u.serial);
              const whName =
                l.warehouse ||
                fromUnits.find((u) => u.warehouse_name)?.warehouse_name ||
                d.warehouse ||
                '—';
              const serHtml = ser.length
                ? `<div class="thin-dm-list">${ser
                    .map(
                      (s) =>
                        `<button type="button" class="linkish mono thin-dm-code" data-serial="${esc(
                          s
                        )}" title="История марки ${esc(s)}">${esc(s)}</button>`
                    )
                    .join('')}</div>`
                : '<span class="muted">—</span>';
              return `<tr class="${l.product_id ? 'clickable' : ''}" ${l.product_id ? `data-product="${esc(l.product_id)}"` : ''}>
                  <td class="mono">${esc(l.sku || '')}</td>
                  <td>${esc(l.product_name || l.product_id || '—')}</td>
                  <td>${esc(whName)}</td>
                  <td class="mono">${esc(l.qty)}</td>
                  <td class="thin-dm-cell" onclick="event.stopPropagation()">${serHtml}</td>
                </tr>`;
            })
            .join('')}
        </tbody>
      </table>`
    : serviceOnly
      ? `<p class="muted">В расходной нет товаров. Услуги из 1С сюда не попадают — они в заказе покупателя и УПД.${
          omittedSvc ? ` (опущено услуг: ${omittedSvc})` : ''
        }</p>`
      : '<p class="muted">Строк нет.</p>';
  const allSerialsCount = lines.reduce((n, l) => {
    const serials = Array.isArray(l.serials)
      ? l.serials
      : String(l.serials_json || '')
          .replace(/^\[|\]$/g, '')
          .split(',')
          .map((s) => s.replace(/"/g, '').trim())
          .filter(Boolean);
    if (serials.length) return n + serials.length;
    return (
      n +
      (d.units || []).filter(
        (u) => u.product_id === l.product_id && (u.in_line_id === l.id || u.out_line_id === l.id)
      ).length
    );
  }, 0);
  const inMarksToolbar = isIn
    ? `<span class="muted" id="doc-dm-msg"></span>${uiIcoBar([
        uiIcoBtn({
          id: 'doc-dm-gen',
          tip: 'Сгенерировать марки',
          icon: 'qr',
          disabled: !lines.length,
        }),
        uiIcoBtn({
          id: 'doc-dm-excel',
          tip: 'Excel · марки (CSV)',
          icon: 'excel',
          disabled: !allSerialsCount,
        }),
        uiIcoBtn({
          id: 'doc-dm-print',
          tip: 'Печать марок',
          icon: 'print',
          disabled: !allSerialsCount,
        }),
        uiIcoBtn({
          id: 'doc-dm-pdf',
          tip: 'PDF · марки',
          icon: 'pdf',
          disabled: !allSerialsCount,
        }),
      ])}`
    : '';
  const cpRole = isReturn || isOut ? 'Клиент' : isIn ? 'Поставщик' : 'Контрагент';
  const hasCounterparty = !!(d.counterparty_id || d.counterparty);
  const mainPane = `
    ${summaryPanel}
    <div class="form-grid">
      <label>Тип<input value="${esc(typeMap[d.doc_type] || d.doc_type)}" readonly /></label>
      <label>Номер<input class="mono" value="${esc(d.number || '')}" readonly /></label>
      <label>Дата<input value="${esc(String(d.doc_date || '').slice(0, 10))}" readonly /></label>
      <label>Статус<input value="${esc(statusText)}" readonly /></label>
      ${renderDocCounterpartyBrief(d, { role: cpRole })}
      <label class="span-2">Комментарий<input value="${esc(d.comment || '')}" readonly /></label>
    </div>`;
  const counterpartyPane = renderDocCounterpartyPane(d, { role: cpRole });
  const linesPane = `
    <h3 style="margin:0 0 8px;font-size:13px;color:var(--taxi-green)">${esc(linesTitle)}</h3>
    <p class="muted" style="margin:0 0 10px">${
      isOut
        ? serviceOnly
          ? 'Правило: услуги — в заказе и УПД; расходная только по товарам (списание со склада).'
          : 'Названия — как в приходе на склад (оригинал из 1С). Услуги в расходную не входят.'
        : isReturn
          ? 'Товар вернулся от клиента на склад. Это не закупка и не приход от поставщика.'
          : isIn
            ? 'Позиции прихода. Без заказа поставщику — сгенерируйте и печатайте марки кнопками справа вверху.'
            : 'Позиции документа. Склад — у каждой строки. Клик по строке — карточка номенклатуры.'
    }</p>
    ${linesTableHtml}`;
  const historyPane = dealId
    ? ''
    : `
    <h3 style="margin:0 0 8px;font-size:13px;color:var(--taxi-green)">История</h3>
    <p class="muted" style="margin:0 0 8px">Кто создал и что меняли по документу.</p>
    <div id="doc-history" class="entity-history"><p class="muted" style="margin:0">Загрузка…</p></div>`;
  const historyTab = dealId ? [] : [{ id: 'history', label: 'История' }];
  const docPageTabs = isOut
    ? [
        { id: 'lines', label: linesTabLabel },
        { id: 'main', label: 'Документ' },
        ...(hasCounterparty ? [{ id: 'counterparty', label: 'Контрагент' }] : []),
        ...historyTab,
      ]
    : [
        { id: 'main', label: 'Документ' },
        { id: 'lines', label: linesTabLabel },
        ...(hasCounterparty ? [{ id: 'counterparty', label: 'Контрагент' }] : []),
        ...historyTab,
      ];
  const defaultDocTab = isOut ? 'lines' : 'main';
  // Расход по умолчанию — строки; выбранную вкладку (Контрагент / История) сохраняем
  const activeDocTab = docPageTabs.some((t) => t.id === state.docSectionTab)
    ? state.docSectionTab
    : defaultDocTab;
  let dealSalesDocs = [];
  let dealStockOuts = [];
  let stockDocTree = null;
  if (dealId) {
    try {
      const rel = await api(
        withCompanyId('/sales-docs?deal_id=' + encodeURIComponent(dealId) + '&limit=100')
      );
      dealSalesDocs = rel.items || [];
    } catch (_) {
      dealSalesDocs = [];
    }
    dealStockOuts = await loadDealStockOuts(dealId);
    stockDocTree = await loadDealDocTree(dealId);
  }
  const dealXfers = dealId ? await loadDealTransferOrders(dealId) : [];
  const docNeedContract = dealId ? await fetchDealNeedsContract(dealId) : true;
  const docFiscalAlert =
    dealId && isOut ? await fetchDealFiscalAlert(dealId) : { alert: false, tip: '' };
  const orderLinkTabs =
    dealId && isOut
      ? buildOrderLinkTabs({
          dealId,
          current: { kind: 'doc', id },
          siblings: dealSalesDocs,
          stockOuts: dealStockOuts,
          transferOrders: dealXfers,
          allowCreate: true,
          needContract: docNeedContract,
          invoiceAlert: docFiscalAlert.alert,
          invoiceAlertTip: docFiscalAlert.tip,
          ...chainIncompleteOpts(stockDocTree),
        })
      : [];
  const useOrderTabs = orderLinkTabs.length > 0;
  const hintDeal = useOrderTabs ? await loadDealForHintBar(dealId) : null;
  const sectionTabsHtml = useOrderTabs
    ? `<div class="form-pagetabs radio-pills" id="doc-section-tabs" style="margin:0 0 12px" role="tablist" aria-label="Разделы документа">
        ${docPageTabs
          .map(
            (t) =>
              `<button type="button" class="form-pagetab ${t.id === activeDocTab ? 'active' : ''}" data-doc-section="${esc(t.id)}" role="tab">${esc(t.label)}</button>`
          )
          .join('')}
      </div>`
    : '';
  const chainBarHtml = '';
  view.innerHTML = formChrome(
    title,
    `
    ${basisBanner}
    ${chainBarHtml}
    ${sectionTabsHtml}
    <div class="product-pane" data-pane="main">${mainPane}</div>
    <div class="product-pane hidden" data-pane="lines">${linesPane}</div>
    ${
      hasCounterparty
        ? `<div class="product-pane hidden" data-pane="counterparty">${counterpartyPane}</div>`
        : ''
    }
    ${historyPane ? `<div class="product-pane hidden" data-pane="history">${historyPane}</div>` : ''}`,
    {
      section: typeMap[d.doc_type] || 'Складской документ',
      entityKind: 'stock_doc',
      pageTabs: useOrderTabs ? orderLinkTabs : docPageTabs,
      activePageTab: useOrderTabs ? 'doc:' + id : activeDocTab,
      hintBar: dealHintBarHtml(hintDeal),
      toolbar:
        [
          isReturn && dealId
            ? `<span class="toolbar-group" role="group" aria-label="Чеки АТОЛ">
          <span class="toolbar-group-label">Чеки</span>
          <button type="button" id="doc-fiscal-refund" title="Чек возврата в ОФД (АТОЛ). Деньги в банке — отдельно">Возврат</button>
        </span>
        <span class="muted" id="doc-fiscal-msg" style="font-size:12px"></span>`
            : '',
          inMarksToolbar || '',
        ]
          .filter(Boolean)
          .join(' ') || undefined,
      chatRef: {
        type: 'stock_doc',
        id: String(id),
        label: title,
        href: '/docs/' + id,
      },
    }
  );
  bindFormChrome(() => openTab('docs'));
  if (useOrderTabs && dealId) bindDealHintBar(dealId);
  if (isReturn && dealId) {
    const refundBtn = document.getElementById('doc-fiscal-refund');
    if (refundBtn) {
      refundBtn.onclick = async () => {
        if (
          !confirm(
            'Пробить чек возврата в ОФД (АТОЛ)?\nДеньги покупателю на карту/СБП нужно вернуть отдельно в Точке.'
          )
        ) {
          return;
        }
        const msg = document.getElementById('doc-fiscal-msg');
        refundBtn.disabled = true;
        if (msg) msg.textContent = 'Чек возврата…';
        try {
          const r = await api(
            '/crm/deals/' + encodeURIComponent(dealId) + '/fiscal/refund',
            { method: 'POST', body: JSON.stringify({ send: true }) }
          );
          const st = r.receipt?.status || '';
          if (msg) {
            msg.textContent =
              'Чек: ' +
              st +
              (r.atol && !r.atol.configured ? ' (черновик — задайте АТОЛ в Настройках)' : '');
          }
        } catch (e) {
          if (msg) msg.textContent = e.message || String(e);
          alert(e.message || String(e));
          refundBtn.disabled = false;
        }
      };
    }
  }
  if (useOrderTabs) {
    bindOrderLinkTabs(view, {
      dealId,
      onCreate: async (action, btn) => {
        if (!dealId) return;
        if (btn) btn.disabled = true;
        try {
          if (action === 'transfer') {
            await createDealTransferOrder(dealId, null);
            return;
          }
          await createLinkedSalesDoc(
            dealId,
            action,
            String(d.organization_id || '').trim(),
            null
          );
          setTimeout(() => {
            if (state.activeTab === 'doc:' + id) renderDocDetail(id);
          }, 400);
        } catch (e) {
          alert(e.message || String(e));
          if (btn) btn.disabled = false;
        }
      },
    });
    const showDocSection = (secId) => {
      const panes = [...view.querySelectorAll('.product-pane')];
      const ok = panes.some((p) => p.dataset.pane === secId);
      const next = ok ? secId : panes[0]?.dataset.pane;
      state.docSectionTab = next;
      panes.forEach((p) => p.classList.toggle('hidden', p.dataset.pane !== next));
      view.querySelectorAll('[data-doc-section]').forEach((t) => {
        t.classList.toggle('active', t.getAttribute('data-doc-section') === next);
      });
    };
    view.querySelectorAll('[data-doc-section]').forEach((btn) => {
      btn.onclick = () => showDocSection(btn.getAttribute('data-doc-section'));
    });
    showDocSection(activeDocTab);
  } else {
    bindEntitySectionTabs(view, activeDocTab, 'docSectionTab', '.product-pane');
  }
  if (dealId) {
    /* структура документов — вкладка structure: */
  } else {
    fillEntityHistory('doc-history', 'stock_doc', id);
  }
  const cpBtn = document.getElementById('doc-open-cp');
  if (cpBtn && d.counterparty_id) {
    const cpName = String(d.counterparty || d.buyer_name || d.supplier_name || '').trim();
    cpBtn.onclick = () =>
      openTab('company:' + d.counterparty_id, cpName.slice(0, 40) || undefined, { newTab: true });
  }
  const orgBtn = document.getElementById('doc-open-org');
  if (orgBtn) {
    orgBtn.onclick = () => openTab('organizations');
  }
  const dealBtn = document.getElementById('doc-open-deal');
  if (dealBtn && dealId) {
    dealBtn.onclick = () => openTab('deal:' + dealId);
  }
  const basisPurchaseBtn = document.getElementById('doc-open-basis-purchase');
  if (basisPurchaseBtn && basisPurchaseBtn.dataset.doc) {
    basisPurchaseBtn.onclick = () => openTab('doc:' + basisPurchaseBtn.dataset.doc);
  }
  const basisSoBtn = document.getElementById('doc-open-basis-so');
  if (basisSoBtn && basisSoBtn.dataset.so) {
    basisSoBtn.onclick = () => {
      const soId = basisSoBtn.dataset.so;
      const base = TAB_PATHS['parity-supplier-orders'] || '/purchases/supplier-orders';
      try {
        history.pushState(null, '', base + '?doc=' + encodeURIComponent(soId));
      } catch (_) {
        /* ignore */
      }
      openTab('parity-supplier-orders');
    };
  }
  const linkDeal = async () => {
    const inp = document.getElementById('doc-link-deal');
    const msg = document.getElementById('doc-link-deal-msg');
    const raw = String(inp?.value || '').trim();
    if (!raw) {
      if (msg) msg.textContent = 'Введите номер заказа покупателя';
      return;
    }
    if (msg) msg.textContent = 'Сохранение…';
    try {
      await api('/docs/' + encodeURIComponent(id) + '/deal', {
        method: 'PATCH',
        body: JSON.stringify({ deal_id: raw }),
      });
      await renderDocDetail(id);
    } catch (err) {
      if (msg) msg.textContent = err.message || String(err);
    }
  };
  document.getElementById('doc-link-deal-go')?.addEventListener('click', () => linkDeal());
  document.getElementById('doc-link-deal')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      linkDeal();
    }
  });
  view.querySelectorAll('[data-product]').forEach((tr) => {
    tr.onclick = (e) => {
      if (e.target && e.target.closest && e.target.closest('[data-serial]')) return;
      openTab('product:' + tr.dataset.product);
    };
  });
  view.querySelectorAll('[data-serial]').forEach((btn) => {
    btn.onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      const code = String(btn.getAttribute('data-serial') || '').trim();
      if (code) openTab('serial:' + code, code.slice(0, 40));
    };
  });
  const dmBase = '/api/docs/' + encodeURIComponent(id) + '/datamatrix';
  document.getElementById('doc-dm-gen')?.addEventListener('click', async () => {
    const msg = document.getElementById('doc-dm-msg');
    const btn = document.getElementById('doc-dm-gen');
    if (btn) btn.disabled = true;
    try {
      if (msg) msg.textContent = 'Генерация марок…';
      const res = await api('/docs/' + encodeURIComponent(id) + '/datamatrix/allocate', {
        method: 'POST',
        body: JSON.stringify({ force: false }),
      });
      if (msg) {
        msg.textContent =
          Number(res.dm_created) > 0
            ? `Создано марок: ${res.dm_created} (префикс ${res.dm_prefix || 'DM'})`
            : 'Все марки уже выданы';
      }
      await renderDocDetail(id);
    } catch (err) {
      if (msg) msg.textContent = err.message || String(err);
      if (btn) btn.disabled = false;
    }
  });
  document.getElementById('doc-dm-excel')?.addEventListener('click', () => {
    window.location.href = dmBase + '/excel.csv';
  });
  document.getElementById('doc-dm-print')?.addEventListener('click', () => {
    window.open(dmBase + '/labels.html', '_blank', 'noopener');
  });
  document.getElementById('doc-dm-pdf')?.addEventListener('click', () => {
    window.open(dmBase + '/labels.pdf', '_blank', 'noopener');
  });
  view.querySelectorAll('[data-doc-link]').forEach((tr) => {
    tr.onclick = () => openTab('doc:' + tr.dataset.docLink);
  });
  view.querySelectorAll('[data-deal-link]').forEach((tr) => {
    tr.onclick = () => openTab('deal:' + tr.dataset.dealLink);
  });
  view.querySelectorAll('[data-sales-link]').forEach((tr) => {
    tr.onclick = () => openTab('sales:' + tr.dataset.salesLink);
  });
  view.querySelectorAll('[data-supplier-order]').forEach((tr) => {
    tr.onclick = () => openTab('parity-supplier-orders');
  });
}

async function renderPipelines() {
  const data = await api('/crm/pipelines');
  const items = data.items || [];
  const meta = data.meta || {};
  view.innerHTML = formChrome(
    'Воронки AmoCRM',
    `
    <p class="muted" style="margin:0 0 10px">
      Воронок: <b>${meta.pipelines ?? items.length}</b> · статусов: <b>${meta.statuses ?? '—'}</b> ·
      сделок в Учёт №1: <b>${meta.deals ?? 0}</b>
      ${meta.lastSync ? ' · синк: ' + esc(meta.lastSync) : ''}
    </p>
    <div class="toolbar">
      <button type="button" class="primary" id="pipe-sync">Обновить из Amo</button>
      <button type="button" id="pipe-goto-deals">Все заказы</button>
      <span class="muted" id="pipe-msg"></span>
    </div>
    ${
      items
        .map(
          (p) => `
      <div style="margin:14px 0 8px;padding:8px 0;border-bottom:1px solid var(--taxi-line-soft)">
        <div style="display:flex;justify-content:space-between;gap:12px;align-items:baseline">
          <strong>${esc(p.name)}</strong>
          <span class="muted">${p.deals_count || 0} сделок · id ${esc(p.id)}</span>
        </div>
        <div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:8px">
          ${(p.statuses || [])
            .map(
              (st) =>
                `<button type="button" class="badge" data-pipe="${esc(p.id)}" data-status="${esc(String(st.id).includes(':') ? String(st.id).split(':').pop() : st.id)}"
                  style="border:1px solid ${esc(st.color || '#ccc')};background:${esc(st.color ? st.color + '22' : '#f5f5f5')};cursor:pointer">
                  ${esc(st.name)}
                </button>`
            )
            .join('') || '<span class="muted">Нет статусов — сначала синк</span>'}
        </div>
      </div>`
        )
        .join('') || '<p class="muted">Воронок пока нет — нажмите «Обновить из Amo».</p>'
    }`
  );
  bindFormChrome(() => showSection('crm'));
  document.getElementById('pipe-goto-deals').onclick = () => openTab('deals');
  document.getElementById('pipe-sync').onclick = async () => {
    const msg = document.getElementById('pipe-msg');
    const btn = document.getElementById('pipe-sync');
    btn.disabled = true;
    msg.textContent = 'Синхронизация…';
    try {
      const r = await api('/crm/deals/sync', {
        method: 'POST',
        body: JSON.stringify({ days: 60, limit: 800 }),
      });
      msg.textContent = `Готово: воронок ${r.pipelines}, сделок ${r.deals}`;
      setTimeout(() => renderPipelines(), 400);
    } catch (e) {
      msg.textContent = e.message;
      btn.disabled = false;
    }
  };
  view.querySelectorAll('[data-pipe]').forEach((btn) => {
    btn.onclick = () => {
      state.dealsPipeline = btn.dataset.pipe;
      state.dealsStatus = btn.dataset.status || '';
      state.dealsPage = 1;
      openTab('deals');
    };
  });
}

/** Фоновый синк Amo отключён: полный sync даёт Proxy Timeout; сделки приходят через ingest в Учёт. */
function kickDealsBackgroundSync() {}

const DEALS_COL_DEFS = [
  { id: 'added_at', label: 'Добавлен', locked: true, sort: 'created_at' },
  { id: 'id', label: 'ID', locked: true, sort: 'id' },
  { id: 'name', label: 'Заказ', locked: true, sort: 'name' },
  { id: 'pipeline', label: 'Воронка', sort: 'pipeline_name' },
  { id: 'status', label: 'Этап', sort: 'status_name' },
  { id: 'price', label: 'Сумма', sort: 'price' },
  { id: 'company', label: 'Компания', sort: 'company_name' },
  { id: 'contact', label: 'Контакт', sort: 'buyer_name' },
  { id: 'responsible', label: 'Ответственный', sort: 'responsible_user_id' },
  { id: 'created_at', label: 'Создал / когда', sort: 'created_at' },
  { id: 'queued_at', label: 'В Учёт (дата)', sort: 'queued_at' },
  { id: 'one_c', label: 'Статус в Учёте', sort: 'queue_status' },
];
const DEALS_COLS_KEY = 'wms.deals.cols.v4';
const DEALS_COL_ORDER_KEY = 'wms.deals.cols.order.v3';
const DEALS_LAYOUT_KEY = 'wms.deals.layout.v1';

/** Дата/время сделки для таблицы (МСК, без TZ в хвосте). */
function formatDealDate(v) {
  if (!v) return '';
  const raw = String(v).trim();
  const d = new Date(raw);
  if (!Number.isNaN(d.getTime())) {
    try {
      const fmt = new Intl.DateTimeFormat('sv-SE', {
        timeZone: 'Europe/Moscow',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
      });
      return fmt.format(d).replace('T', ' ');
    } catch (_) {
      /* fall through */
    }
  }
  return raw.replace('T', ' ').replace(/\.\d+/, '').replace(/[+-]\d{2}:\d{2}$/, '').replace(/Z$/, '').trim().slice(0, 19);
}

/** Кто создал / отправил в Учёт: queued_by, иначе ответственный. */
function dealCreatorName(d) {
  const queued = String(d.queued_by || '').replace(/\u00a0/g, ' ').trim();
  if (queued) return queued;
  const resp = String(d.responsible_name || '').trim();
  if (resp) return resp;
  if (d.responsible_user_id) return '#' + d.responsible_user_id;
  return '';
}

function defaultDealsColOrder() {
  return DEALS_COL_DEFS.map((c) => c.id);
}

function loadDealsColOrder() {
  const fallback = defaultDealsColOrder();
  try {
    const raw = localStorage.getItem(DEALS_COL_ORDER_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return fallback;
    const known = new Set(DEALS_COL_DEFS.map((c) => c.id));
    const out = [];
    const seen = new Set();
    parsed.forEach((id) => {
      const key = String(id || '');
      if (!known.has(key) || seen.has(key)) return;
      out.push(key);
      seen.add(key);
    });
    DEALS_COL_DEFS.forEach((c) => {
      if (!seen.has(c.id)) out.push(c.id);
    });
    // «Добавлен» всегда первый столбец
    if (out.includes('added_at')) {
      return ['added_at', ...out.filter((id) => id !== 'added_at')];
    }
    return out.length ? out : fallback;
  } catch (_) {
    return fallback;
  }
}

function saveDealsColOrder(order) {
  try {
    localStorage.setItem(DEALS_COL_ORDER_KEY, JSON.stringify(order));
  } catch (_) {
    /* ignore */
  }
}

function orderedDealsColDefs() {
  const byId = Object.fromEntries(DEALS_COL_DEFS.map((c) => [c.id, c]));
  return loadDealsColOrder()
    .map((id) => byId[id])
    .filter(Boolean);
}

function loadDealsColPrefs() {
  const defaults = {};
  DEALS_COL_DEFS.forEach((c) => {
    defaults[c.id] = true;
  });
  try {
    const raw = localStorage.getItem(DEALS_COLS_KEY);
    if (!raw) return defaults;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return defaults;
    DEALS_COL_DEFS.forEach((c) => {
      if (c.locked) defaults[c.id] = true;
      else if (typeof parsed[c.id] === 'boolean') defaults[c.id] = parsed[c.id];
    });
    return defaults;
  } catch (_) {
    return defaults;
  }
}

function saveDealsColPrefs(prefs) {
  try {
    localStorage.setItem(DEALS_COLS_KEY, JSON.stringify(prefs));
  } catch (_) {
    /* ignore */
  }
}

function loadDealsLayout() {
  const defaults = { nameWidth: 240, nameLines: 3, dense: true };
  try {
    const raw = localStorage.getItem(DEALS_LAYOUT_KEY);
    if (!raw) return defaults;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return defaults;
    const w = Number(parsed.nameWidth);
    const lines = Number(parsed.nameLines);
    return {
      nameWidth: w >= 140 && w <= 480 ? w : defaults.nameWidth,
      nameLines: lines >= 1 && lines <= 6 ? lines : defaults.nameLines,
      dense: typeof parsed.dense === 'boolean' ? parsed.dense : defaults.dense,
    };
  } catch (_) {
    return defaults;
  }
}

function saveDealsLayout(layout) {
  try {
    localStorage.setItem(DEALS_LAYOUT_KEY, JSON.stringify(layout));
  } catch (_) {
    /* ignore */
  }
}

function visibleDealsCols() {
  const prefs = loadDealsColPrefs();
  return orderedDealsColDefs().filter((c) => prefs[c.id] !== false);
}

function colsSettingsIconHtml() {
  return `<div class="col-settings" id="d-cols-wrap">
    <button type="button" id="d-cols-btn" class="table-tool-ico" data-tip="Столбцы и порядок" aria-label="Столбцы и порядок">
      <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
        <path d="M2.5 2.5h4v11h-4zM9.5 2.5h4v11h-4z" fill="none" stroke="currentColor" stroke-width="1.4"/>
      </svg>
    </button>
    <div class="col-settings-pop hidden" id="d-cols-pop"></div>
  </div>`;
}

function dealsTableToolsHtml(pagerHtmlStr, layout) {
  const dense = layout.dense !== false;
  return `<div class="table-tools">
    ${pagerHtmlStr}
    <div class="table-tools-right">
      <button type="button" id="d-view-dense" class="table-tool-ico ${dense ? 'active' : ''}" data-tip="Сжатый вид · одна строка" aria-label="Сжатый вид" aria-pressed="${dense ? 'true' : 'false'}">
      <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
        <path d="M2 4.5h12M2 8h12M2 11.5h12" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
      </svg>
      </button>
      <button type="button" id="d-view-wrap" class="table-tool-ico ${dense ? '' : 'active'}" data-tip="Полный вид · с переносами" aria-label="Полный вид" aria-pressed="${dense ? 'false' : 'true'}">
      <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
        <path d="M2 3.5h12M2 7h8M2 10.5h10M2 14h6" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
      </svg>
      </button>
      ${colsSettingsIconHtml()}
    </div>
  </div>`;
}

async function renderDeals() {
  const q = state.dealsQ || '';
  const viewMode = state.dealsView === 'board' ? 'board' : 'table';
  const page = Math.max(1, Number(state.dealsPage) || 1);
  const responsibleId = String(state.dealsResponsible || '').trim();
  const channelFilter = String(state.dealsChannel || '').trim();
  const pipesData = await api('/crm/pipelines');
  const pipes = (pipesData.items || []).slice().sort((a, b) => {
    const aq = Number(a.deals_count) || 0;
    const bq = Number(b.deals_count) || 0;
    if (bq !== aq) return bq - aq;
    return String(a.name || '').localeCompare(String(b.name || ''), 'ru');
  });
  const meta = pipesData.meta || {};
  let pipelineId = state.dealsPipeline || '';

  // Канбан — только одна воронка; таблица — все (пустой pipeline).
  if (viewMode === 'board' && !pipelineId && pipes.length) {
    const withDeals = pipes.find((p) => Number(p.deals_count) > 0);
    pipelineId = String((withDeals || pipes[0]).id);
    state.dealsPipeline = pipelineId;
  }

  const pipeOpts =
    (viewMode === 'table'
      ? `<option value="" ${!pipelineId ? 'selected' : ''}>Все воронки (${meta.deals ?? pipes.reduce((s, p) => s + (Number(p.deals_count) || 0), 0)})</option>`
      : '') +
    (pipes
      .map(
        (p) =>
          `<option value="${esc(p.id)}" ${String(p.id) === String(pipelineId) ? 'selected' : ''}>${esc(p.name)} (${p.deals_count || 0}${Number(p.queued_count) ? ', в Учёте: ' + p.queued_count : ''})</option>`
      )
      .join('') || (viewMode === 'board' ? '<option value="">Нет воронок</option>' : ''));

  const respQs = new URLSearchParams();
  if (pipelineId) respQs.set('pipeline_id', pipelineId);
  respQs.set('queued_to_1c', '1');
  withCompanyId(respQs);
  const respData = await api('/crm/deals/responsibles?' + respQs.toString());
  const respItems = respData.items || [];
  const respNone = Number(respData.none) || 0;
  const respTotal =
    respItems.reduce((s, r) => s + (Number(r.deals) || 0), 0) + respNone;
  const respOpts =
    `<option value="" ${!responsibleId ? 'selected' : ''}>Все ответственные (${respTotal})</option>` +
    (respNone
      ? `<option value="__none__" ${responsibleId === '__none__' ? 'selected' : ''}>Без ответственного (${respNone})</option>`
      : '') +
    respItems
      .map((r) => {
        const id = String(r.amo_id || '');
        const label = (r.name || '').trim() || '#' + id;
        return `<option value="${esc(id)}" ${responsibleId === id ? 'selected' : ''}>${esc(label)} (${r.deals || 0})</option>`;
      })
      .join('');

  const oneCLabel = (d) => {
    const queued = Number(d.queued_to_1c) === 1;
    const qStat = String(d.queue_status || '');
    if (!queued) return '<span class="badge muted">Не в Учёте</span>';
    if (qStat === '1') return '<span class="badge">В Учёте</span>';
    return '<span class="badge draft">Очередь</span>';
  };

  const toolbar = `
    <div class="form-pagetabs" style="display:inline-flex;margin:0 8px 0 0" id="d-view-tabs">
      <button type="button" class="form-pagetab ${viewMode === 'table' ? 'active' : ''}" data-deals-view="table" data-tip="Таблица">
        <svg class="form-pagetab-ico" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
          <rect x="2" y="3" width="12" height="10" rx="1" fill="none" stroke="currentColor" stroke-width="1.4"/>
          <path d="M2 6.5h12M2 10h12M6.5 3v10M10 3v10" fill="none" stroke="currentColor" stroke-width="1.25"/>
        </svg>
        Таблица
      </button>
      <button type="button" class="form-pagetab ${viewMode === 'board' ? 'active' : ''}" data-deals-view="board" data-tip="Канбан">
        <svg class="form-pagetab-ico" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
          <rect x="2" y="2.5" width="3.5" height="11" rx="0.8" fill="none" stroke="currentColor" stroke-width="1.35"/>
          <rect x="6.25" y="2.5" width="3.5" height="7.5" rx="0.8" fill="none" stroke="currentColor" stroke-width="1.35"/>
          <rect x="10.5" y="2.5" width="3.5" height="9.5" rx="0.8" fill="none" stroke="currentColor" stroke-width="1.35"/>
        </svg>
        Канбан
      </button>
    </div>
    <label class="inline-label">Воронка
      <select id="d-pipe">${pipeOpts}</select>
    </label>
    <label class="inline-label">Ответственный
      <select id="d-resp">${respOpts}</select>
    </label>
    <div class="toolbar-filter" role="group" aria-label="Канал">
      <span class="toolbar-filter-label">Канал</span>
      <div class="form-pagetabs" id="d-channel-tabs" role="tablist">
        <button type="button" class="form-pagetab ${!channelFilter ? 'active' : ''}" data-d-channel="" role="tab" aria-selected="${!channelFilter ? 'true' : 'false'}">Все</button>
        <button type="button" class="form-pagetab ${channelFilter === 'Автосервис' ? 'active' : ''}" data-d-channel="Автосервис" role="tab" aria-selected="${channelFilter === 'Автосервис' ? 'true' : 'false'}">Автосервис</button>
        <button type="button" class="form-pagetab ${channelFilter === 'Самовывоз' ? 'active' : ''}" data-d-channel="Самовывоз" role="tab" aria-selected="${channelFilter === 'Самовывоз' ? 'true' : 'false'}">Самовывоз</button>
        <button type="button" class="form-pagetab ${channelFilter === 'Отправка' ? 'active' : ''}" data-d-channel="Отправка" role="tab" aria-selected="${channelFilter === 'Отправка' ? 'true' : 'false'}">Отправка</button>
      </div>
    </div>
    <div class="grow"></div>
    <div class="find">
      <input id="d-q" placeholder="Поиск id / название / контакт / этап" value="${esc(q)}" />
      <button type="button" class="find-go" id="d-search">Найти</button>
    </div>`;

  const reload = () => renderDeals();

  function bindDealsChrome() {
    bindFormChrome(() => showSection('crm'));
    document.querySelectorAll('[data-deals-view]').forEach((btn) => {
      btn.onclick = () => {
        const next = btn.dataset.dealsView === 'board' ? 'board' : 'table';
        state.dealsView = next;
        state.dealsPage = 1;
        if (next === 'table') state.dealsPipeline = '';
        reload();
      };
    });
    document.getElementById('d-pipe').onchange = () => {
      state.dealsPipeline = document.getElementById('d-pipe').value;
      state.dealsStatus = '';
      state.dealsPage = 1;
      reload();
    };
    document.getElementById('d-resp').onchange = () => {
      state.dealsResponsible = document.getElementById('d-resp').value;
      state.dealsPage = 1;
      reload();
    };
    document.querySelectorAll('#d-channel-tabs [data-d-channel]').forEach((btn) => {
      btn.onclick = () => {
        state.dealsChannel = btn.getAttribute('data-d-channel') || '';
        state.dealsPage = 1;
        reload();
      };
    });
    document.getElementById('d-search').onclick = () => {
      state.dealsQ = document.getElementById('d-q').value.trim();
      state.dealsPage = 1;
      reload();
    };
    document.getElementById('d-q').onkeydown = (e) => {
      if (e.key === 'Enter') {
        state.dealsQ = document.getElementById('d-q').value.trim();
        state.dealsPage = 1;
        reload();
      }
    };
    const colsBtn = document.getElementById('d-cols-btn');
    const colsPop = document.getElementById('d-cols-pop');
    if (colsBtn && colsPop) {
      colsBtn.onclick = (e) => {
        e.stopPropagation();
        if (!colsPop.classList.contains('hidden')) {
          colsPop.classList.add('hidden');
          return;
        }
        const prefs = loadDealsColPrefs();
        const layout = loadDealsLayout();
        const colsOrdered = orderedDealsColDefs();
        colsPop.innerHTML =
          `<div class="col-settings-hint muted">Перетащите строки — порядок. «Добавлен» всегда первый.</div>` +
          colsOrdered
            .map((c) => {
              const checked = prefs[c.id] !== false;
              const canDrag = c.id !== 'added_at';
              return `<label class="col-settings-item ${c.locked ? 'locked' : ''}" ${
                canDrag ? 'draggable="true"' : ''
              } data-col-id="${esc(c.id)}">
            <span class="col-drag" title="${c.id === 'added_at' ? 'Дата закреплена первой' : 'Перетащить'}" aria-hidden="true">⋮⋮</span>
            <input type="checkbox" data-col="${esc(c.id)}" ${checked ? 'checked' : ''} ${c.locked ? 'disabled' : ''} />
            <span class="col-settings-label">${esc(c.label)}</span>
          </label>`;
            })
            .join('') +
          `<div class="col-settings-width">
            <label>Ширина «Заказ»
              <input type="range" id="d-name-w" min="140" max="480" step="20" value="${layout.nameWidth}" />
              <span id="d-name-w-val">${layout.nameWidth}px</span>
            </label>
          </div>`;
        colsPop.classList.remove('hidden');
        colsPop.querySelectorAll('input[data-col]').forEach((inp) => {
          inp.onchange = () => {
            const next = loadDealsColPrefs();
            next[inp.dataset.col] = !!inp.checked;
            DEALS_COL_DEFS.forEach((c) => {
              if (c.locked) next[c.id] = true;
            });
            if (!DEALS_COL_DEFS.some((c) => !c.locked && next[c.id])) {
              inp.checked = true;
              next[inp.dataset.col] = true;
            }
            saveDealsColPrefs(next);
            reload();
          };
        });
        let dragColId = '';
        colsPop.querySelectorAll('.col-settings-item[data-col-id]').forEach((row) => {
          if (row.dataset.colId === 'added_at') return;
          row.addEventListener('dragstart', (ev) => {
            dragColId = row.dataset.colId || '';
            row.classList.add('is-dragging');
            try {
              ev.dataTransfer.setData('text/plain', dragColId);
              ev.dataTransfer.effectAllowed = 'move';
            } catch (_) {
              /* ignore */
            }
          });
          row.addEventListener('dragend', () => {
            row.classList.remove('is-dragging');
            colsPop.querySelectorAll('.col-settings-item').forEach((el) => el.classList.remove('drag-over'));
            dragColId = '';
          });
          row.addEventListener('dragover', (ev) => {
            ev.preventDefault();
            ev.dataTransfer.dropEffect = 'move';
            const over = ev.currentTarget;
            if (!(over instanceof HTMLElement)) return;
            if (!dragColId || over.dataset.colId === dragColId) return;
            colsPop.querySelectorAll('.col-settings-item').forEach((el) => el.classList.remove('drag-over'));
            over.classList.add('drag-over');
          });
          row.addEventListener('dragleave', (ev) => {
            const over = ev.currentTarget;
            if (over instanceof HTMLElement) over.classList.remove('drag-over');
          });
          row.addEventListener('drop', (ev) => {
            ev.preventDefault();
            const target = ev.currentTarget;
            if (!(target instanceof HTMLElement)) return;
            target.classList.remove('drag-over');
            if (target.dataset.colId === 'added_at') return;
            const fromId = dragColId || (ev.dataTransfer && ev.dataTransfer.getData('text/plain')) || '';
            const toId = target.dataset.colId || '';
            if (!fromId || !toId || fromId === toId || fromId === 'added_at') return;
            const order = loadDealsColOrder().slice();
            const from = order.indexOf(fromId);
            const to = order.indexOf(toId);
            if (from < 0 || to < 0) return;
            order.splice(from, 1);
            order.splice(to, 0, fromId);
            const pinned = order.includes('added_at')
              ? ['added_at', ...order.filter((id) => id !== 'added_at')]
              : order;
            saveDealsColOrder(pinned);
            reload();
          });
        });
        const range = document.getElementById('d-name-w');
        const valEl = document.getElementById('d-name-w-val');
        if (range) {
          range.oninput = (ev) => {
            ev.stopPropagation();
            const w = Number(range.value) || 280;
            if (valEl) valEl.textContent = w + 'px';
            const table = view.querySelector('table.deals-table');
            if (table) table.style.setProperty('--deal-name-w', w + 'px');
          };
          range.onchange = (ev) => {
            ev.stopPropagation();
            const next = loadDealsLayout();
            next.nameWidth = Number(range.value) || 280;
            saveDealsLayout(next);
          };
        }
      };
      if (!state._dealsColsDocBound) {
        state._dealsColsDocBound = true;
        document.addEventListener('click', (e) => {
          const t = e.target;
          if (t && t.closest && t.closest('#d-cols-wrap')) return;
          const pop = document.getElementById('d-cols-pop');
          if (pop) pop.classList.add('hidden');
        });
      }
    }
  }

  if (viewMode === 'table') {
    const sort = state.dealsSort || 'queued_at';
    const dir = state.dealsDir === 'asc' ? 'asc' : 'desc';
    const limit = getPageSize('deals', 100);
    const qs = new URLSearchParams();
    qs.set('page', String(page));
    qs.set('limit', String(limit));
    if (pipelineId) qs.set('pipeline_id', pipelineId);
    if (responsibleId) qs.set('responsible_user_id', responsibleId);
    if (channelFilter) qs.set('amo_channel', channelFilter);
    if (q) qs.set('q', q);
    qs.set('queued_to_1c', '1');
    qs.set('sort', sort);
    qs.set('dir', dir);
    withCompanyId(qs);
    const data = await api('/crm/deals?' + qs.toString());
    const list = data.items || [];
    const cols = visibleDealsCols();
    const colCount = cols.length;

    const layout = loadDealsLayout();
    const dense = layout.dense !== false;
    const nameLines = dense ? 1 : layout.nameLines || 3;
    const cellHtml = (col, d) => {
      if (col.id === 'id') return `<td class="mono">#${esc(d.id)}</td>`;
      if (col.id === 'added_at') {
        const v = formatDealDate(d.created_at || d.queued_at || d.synced_at);
        return `<td class="mono" data-filter-text="${esc(v)}">${v || '—'}</td>`;
      }
      if (col.id === 'name') {
        const title = d.name || 'Заказ';
        return `<td class="td-deal-name" data-filter-text="${esc(title)}"><span class="deal-name-clamp">${esc(title)}</span></td>`;
      }
      if (col.id === 'pipeline') {
        const v = d.pipeline_name || d.pipeline_id || '—';
        return `<td data-filter-text="${esc(v)}">${esc(v)}</td>`;
      }
      if (col.id === 'status') {
        const v = d.status_name || d.status_id || '—';
        return `<td data-filter-text="${esc(v)}">${esc(v)}</td>`;
      }
      if (col.id === 'price') return `<td class="mono">${formatMoney(d.price)}</td>`;
      if (col.id === 'company') {
        const company = d.company_name || '';
        return `<td data-filter-text="${esc(company)}">${company ? esc(company) : '—'}</td>`;
      }
      if (col.id === 'contact') {
        const contact = d.buyer_name || d.buyer_phone || '';
        return `<td data-filter-text="${esc(contact)}">${contact ? esc(contact) : '—'}</td>`;
      }
      if (col.id === 'responsible') {
        const responsible =
          d.responsible_name ||
          (d.responsible_user_id ? '#' + d.responsible_user_id : '');
        return `<td data-filter-text="${esc(responsible)}">${responsible ? esc(responsible) : '—'}</td>`;
      }
      if (col.id === 'created_at') {
        const who = dealCreatorName(d);
        const when = formatDealDate(d.created_at || d.queued_at || d.synced_at);
        const filter = [who, when].filter(Boolean).join(' ');
        if (!who && !when) return '<td data-filter-text="">—</td>';
        return `<td class="td-deal-created" data-filter-text="${esc(filter)}">
          ${who ? `<div class="deal-created-who">${esc(who)}</div>` : '<div class="muted">—</div>'}
          ${when ? `<div class="mono muted deal-created-when">${esc(when)}</div>` : ''}
        </td>`;
      }
      if (col.id === 'queued_at') {
        const v = formatDealDate(d.queued_at || d.synced_at);
        return `<td class="mono" data-filter-text="${esc(v)}">${v || '—'}</td>`;
      }
      if (col.id === 'one_c') return `<td>${oneCLabel(d)}</td>`;
      return '<td>—</td>';
    };

    const sortMark = (key) => {
      if (sort !== key) return '';
      return dir === 'asc' ? ' ▲' : ' ▼';
    };

    const headHtml = cols
      .map((col) => {
        const key = col.sort || '';
        const sorted = key && sort === key ? 'sorted' : '';
        const mark = key ? sortMark(key) : '';
        if (col.id === 'name') {
          return `<th class="th-deal-name sortable ${sorted}" data-deals-sort="name" title="Сортировка"><span class="th-deal-label">Заказ${mark}</span></th>`;
        }
        if (key) {
          return `<th class="sortable ${sorted}" data-deals-sort="${esc(key)}" title="Сортировка">${esc(col.label)}${mark}</th>`;
        }
        return `<th>${esc(col.label)}</th>`;
      })
      .join('');

    const rows =
      list
        .map(
          (d) =>
            `<tr class="clickable" data-open-deal="${esc(d.id)}">${cols.map((c) => cellHtml(c, d)).join('')}</tr>`
        )
        .join('') ||
      `<tr><td colspan="${colCount}" class="muted">Нет заказов в Учёте №1</td></tr>`;

    view.innerHTML = formChrome(
      'Заказы покупателей',
      `
      ${dealsTableToolsHtml(pagerHtml('dpager', data.page, data.pages, data.total, { limit, listKey: 'deals' }), layout)}
      <div class="table-scroll">
      <table class="data-table deals-table ${dense ? 'is-dense' : 'is-wrap'}" data-no-col-filter="1" data-table-key="deals" style="--deal-name-w:${layout.nameWidth}px;--deal-name-lines:${nameLines}">
        <thead>
          <tr>${headHtml}</tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
      </div>
      ${pagerHtml('dpager2', data.page, data.pages, data.total, { limit, listKey: 'deals' })}`,
      {
        toolbar,
        metrics: `
          <span>${data.total ?? 0} сделок</span>
          ${channelFilter ? `<span>${esc(channelFilter)}</span>` : ''}
        `,
      }
    );
    bindDealsChrome();
    saveDealsLayout(layout);
    const denseBtn = document.getElementById('d-view-dense');
    const wrapBtn = document.getElementById('d-view-wrap');
    if (denseBtn) {
      denseBtn.onclick = (e) => {
        e.stopPropagation();
        const next = loadDealsLayout();
        next.dense = true;
        next.nameLines = 1;
        saveDealsLayout(next);
        reload();
      };
    }
    if (wrapBtn) {
      wrapBtn.onclick = (e) => {
        e.stopPropagation();
        const next = loadDealsLayout();
        next.dense = false;
        next.nameLines = Math.max(3, Number(next.nameLines) || 3);
        saveDealsLayout(next);
        reload();
      };
    }
    view.querySelectorAll('[data-deals-sort]').forEach((th) => {
      th.onclick = (e) => {
        e.stopPropagation();
        const key = th.dataset.dealsSort;
        if (!key) return;
        if (state.dealsSort === key) {
          state.dealsDir = state.dealsDir === 'asc' ? 'desc' : 'asc';
        } else {
          state.dealsSort = key;
          state.dealsDir = [
            'name',
            'status_name',
            'pipeline_name',
            'company_name',
            'buyer_name',
            'responsible_user_id',
            'id',
            'queue_status',
          ].includes(key)
            ? 'asc'
            : 'desc';
        }
        state.dealsPage = 1;
        reload();
      };
    });
    bindListPager(['dpager', 'dpager2'], 'deals', 'dealsPage', () => reload());
    view.querySelectorAll('[data-open-deal]').forEach((row) => {
      row.onclick = () => openTab('deal:' + row.dataset.openDeal);
    });
    return;
  }

  // ——— Канбан одной воронки ———
  const qs = new URLSearchParams();
  if (pipelineId) qs.set('pipeline_id', pipelineId);
  if (responsibleId) qs.set('responsible_user_id', responsibleId);
  if (channelFilter) qs.set('amo_channel', channelFilter);
  if (q) qs.set('q', q);
  qs.set('queued_to_1c', '1');
  withCompanyId(qs);
  const board = await api('/crm/deals/board?' + qs.toString());
  // Пустые этапы не показываем.
  const columns = (board.columns || []).filter((col) => (col.deals || []).length > 0);

  const cardHtml = (d, col) => {
    const party = d.company_name
      ? d.company_name
      : d.buyer_name || d.buyer_phone || '';
    const responsible =
      d.responsible_name ||
      (d.responsible_user_id ? '#' + d.responsible_user_id : '');
    const sid = String(d.status_id || col.status_id || '');
    return `
      <article class="kanban-card" draggable="true" data-deal="${esc(d.id)}" data-status="${esc(sid)}">
        <div class="kanban-card-top">
          <a class="kanban-card-title" href="#" data-open-deal="${esc(d.id)}">${esc(d.name || 'Заказ ' + d.id)}</a>
          <span class="kanban-card-id mono">#${esc(d.id)}</span>
        </div>
        <div class="kanban-card-amount mono">${formatMoney(d.price)}</div>
        ${party ? `<div class="kanban-card-contact">${esc(party)}</div>` : ''}
        ${responsible ? `<div class="kanban-card-contact muted">${esc(responsible)}</div>` : ''}
        ${oneCLabel(d)}
      </article>`;
  };

  const colsHtml =
    columns
      .map((col) => {
        const color = col.color || '#94a3b8';
        const deals = col.deals || [];
        return `
      <section class="kanban-col" data-status="${esc(col.status_id || '')}" data-col-id="${esc(col.id)}" data-status-name="${esc(col.name)}">
        <header class="kanban-col-head" style="border-top-color:${esc(color)}">
          <div class="kanban-col-title">
            <span class="kanban-dot" style="background:${esc(color)}"></span>
            <strong>${esc(col.name)}</strong>
          </div>
          <div class="kanban-col-meta muted">
            <span>${deals.length}</span>
            <span class="mono">${formatMoney(col.total_amount || 0)}</span>
          </div>
        </header>
        <div class="kanban-col-body" data-drop-status="${esc(col.status_id || '')}" data-drop-name="${esc(col.name)}">
          ${deals.map((d) => cardHtml(d, col)).join('') || '<p class="kanban-empty muted">Пусто</p>'}
        </div>
      </section>`;
      })
      .join('') ||
    '<p class="muted" style="padding:16px">Нет заказов в Учёте №1 для этой воронки.</p>';

    view.innerHTML = formChrome(
    'Заказы покупателей',
    `
    <div class="kanban-board" id="deals-kanban">${colsHtml}</div>`,
    {
      toolbar,
      metrics: `
        <span>${board.total ?? 0} на доске</span>
        ${board.pipeline ? `<span>${esc(board.pipeline.name)}</span>` : ''}
        ${channelFilter ? `<span>${esc(channelFilter)}</span>` : ''}
      `,
    }
  );
  bindDealsChrome();

  view.querySelectorAll('[data-open-deal]').forEach((a) => {
    a.onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      openTab('deal:' + a.dataset.openDeal);
    };
  });

  async function moveDeal(dealId, statusId, statusName) {
    if (!dealId || !statusId) return;
    try {
      await api('/crm/deals/' + encodeURIComponent(dealId) + '/stage', {
        method: 'PATCH',
        body: JSON.stringify({
          status_id: statusId,
          status_name: statusName || undefined,
          pipeline_id: state.dealsPipeline || undefined,
        }),
      });
      reload();
    } catch (e) {
      alert(e.message);
      reload();
    }
  }

  let dragDealId = '';
  view.querySelectorAll('.kanban-card').forEach((card) => {
    card.addEventListener('dragstart', (e) => {
      dragDealId = card.dataset.deal || '';
      card.classList.add('dragging');
      try {
        e.dataTransfer.setData('text/plain', dragDealId);
        e.dataTransfer.effectAllowed = 'move';
      } catch (_) {}
    });
    card.addEventListener('dragend', () => {
      card.classList.remove('dragging');
      view.querySelectorAll('.kanban-col-body.drag-over').forEach((x) => x.classList.remove('drag-over'));
      dragDealId = '';
    });
    card.addEventListener('dblclick', () => openTab('deal:' + card.dataset.deal));
  });

  view.querySelectorAll('.kanban-col-body').forEach((zone) => {
    zone.addEventListener('dragover', (e) => {
      e.preventDefault();
      zone.classList.add('drag-over');
    });
    zone.addEventListener('dragleave', () => zone.classList.remove('drag-over'));
    zone.addEventListener('drop', (e) => {
      e.preventDefault();
      zone.classList.remove('drag-over');
      const statusId = zone.dataset.dropStatus || '';
      if (!statusId) {
        msg().textContent = 'В эту колонку переносить нельзя';
        return;
      }
      let id = dragDealId;
      try {
        id = e.dataTransfer.getData('text/plain') || id;
      } catch (_) {}
      if (!id) return;
      const from = document.querySelector(`.kanban-card[data-deal="${CSS.escape(id)}"]`);
      if (from && String(from.dataset.status || '') === String(statusId)) return;
      moveDeal(id, statusId, zone.dataset.dropName || '');
    });
  });
}

function openSalesPdf(docId) {
  const url = '/api/sales-docs/' + encodeURIComponent(docId) + '/pdf';
  const w = window.open(url, '_blank');
  if (!w) {
    const a = document.createElement('a');
    a.href = url;
    a.target = '_blank';
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    a.remove();
  }
}

/** HTML-бланк с автозапуском печати. */
function openSalesPrint(docId) {
  const url =
    '/api/sales-docs/' + encodeURIComponent(docId) + '/print?autoprint=1';
  const w = window.open(url, '_blank');
  if (!w) {
    const a = document.createElement('a');
    a.href = url;
    a.target = '_blank';
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    a.remove();
  }
}

const SALES_TYPE_LABEL = {
  invoice: 'Счёт на оплату',
  upd: 'УПД',
  sf: 'Счёт-фактура',
  workorder: 'Заказ-наряд',
  contract: 'Договор',
};

/** Подписи вкладок связанных документов (без номеров). */
const SALES_TYPE_TAB = {
  contract: 'Договоры',
  invoice: 'Счета',
  workorder: 'Заказ-наряд',
  upd: 'УПД',
  sf: 'Счёт-фактура',
};

/** Подсказки для вкладок «создать» в шапке заказа. */
const SALES_TYPE_CREATE_TIP = {
  contract: 'Создать договор купли-продажи (для юрлица / ИП)',
  invoice: 'Создать счёт на оплату. Физлицу — для чеков АТОЛ; юрлицу — для перевода',
  workorder: 'Создать заказ-наряд. Сначала заполните авто на карточке ЗН — потом PDF',
  upd: 'Создать УПД — универсальный передаточный документ',
  sf: 'Создать счёт-фактуру',
};

/** Подсказка при переходе на уже созданный документ. */
function salesDocOpenTip(docType, doc, count) {
  const label = SALES_TYPE_TAB[docType] || SALES_TYPE_LABEL[docType] || docType;
  const num = String(doc?.number || '').trim();
  const date = String(doc?.doc_date || '').slice(0, 10);
  let tip = 'Открыть: ' + label;
  if (num) tip += ' №' + num;
  if (date) tip += ' от ' + date;
  const n = Number(count) || 0;
  if (n > 1) tip += ' · ещё ' + (n - 1) + ' — в «Структура»';
  return tip;
}

/** Кэш next_hints, чтобы сквозной hint-bar не дергал API на каждой вкладке цепочки. */
function rememberDealHint(deal) {
  const id = String(deal?.id || deal?.deal_id || '').trim();
  if (!id || !deal) return;
  state._dealHintCache = { dealId: id, deal, at: Date.now() };
}

async function loadDealForHintBar(dealId) {
  const id = String(dealId || '').trim();
  if (!id) return null;
  const cached = state._dealHintCache;
  if (cached && cached.dealId === id && cached.deal && Date.now() - (cached.at || 0) < 20000) {
    return cached.deal;
  }
  try {
    const d = await api('/crm/deals/' + encodeURIComponent(id));
    rememberDealHint(d);
    return d;
  } catch (_) {
    return cached && cached.dealId === id ? cached.deal : null;
  }
}

function dealHintBarHtml(deal) {
  if (!deal) return '';
  return buildDealHintBarHtml(deal.next_hints, deal);
}

/** Действие шага hint-bar: ЗН / авто / оплата / склад / чеки. Работает со всех вкладок цепочки. */
function runDealHintAction(act) {
  const action = String(act || '').trim();
  if (!action) return false;
  const bar = document.getElementById('deal-next-hints');
  const dealId = String(
    bar?.getAttribute('data-deal-id') || state.dealId || state._dealHintCache?.dealId || ''
  ).trim();
  const onDealPage = !!view?.querySelector?.('[data-deal-section]');
  const goDealThen = () => {
    if (!dealId || onDealPage) return false;
    state._pendingDealHintAction = action;
    openTab('deal:' + dealId);
    return true;
  };
  const findWoTab = () =>
    [...document.querySelectorAll('.form-pagetabs [data-pagetab]')].find((b) => {
      if (!/заказ-наряд/i.test(b.textContent || '')) return false;
      // уже созданный ЗН (не вкладка «создать»)
      return b.getAttribute('data-create') !== '1';
    });
  if (action === 'sto_auto') {
    const woTab = findWoTab();
    if (woTab) {
      woTab.click();
      return true;
    }
    const createBtn = document.querySelector('[data-pagetab="create:workorder"]');
    if (createBtn) {
      createBtn.click();
      return true;
    }
    return goDealThen();
  }
  if (action === 'create:workorder') {
    const createBtn = document.querySelector('[data-pagetab="create:workorder"]');
    if (createBtn) {
      createBtn.click();
      return true;
    }
    const woTab = findWoTab();
    if (woTab) {
      woTab.click();
      return true;
    }
    return goDealThen();
  }
  if (action === 'create:invoice' || action === 'create:upd') {
    const createBtn = document.querySelector('[data-pagetab="' + action + '"]');
    if (createBtn) {
      createBtn.click();
      return true;
    }
    document.querySelector('.form-pagetabs')?.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
    return !!createBtn;
  }
  if (action === 'pay_link' || action === 'accept_cash') {
    if (goDealThen()) return true;
    activateDealTab('qr');
    if (action === 'accept_cash') document.getElementById('deal-accept-cash')?.click();
    else {
      document.getElementById('deal-pay-link')?.focus();
      document.getElementById('deal-pay-link')?.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
    }
    return true;
  }
  if (action === 'warehouse') {
    if (goDealThen()) return true;
    activateDealTab('items');
    document.getElementById('deal-wh-task')?.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
    return true;
  }
  if (action.startsWith('fiscal:')) {
    if (goDealThen()) return true;
    activateDealTab('fiscal');
    return true;
  }
  return false;
}

function buildDealHintBarHtml(nh, deal) {
  if (!nh || !nh.next) return '';
  const dealId = String(deal?.id || deal?.deal_id || state.dealId || '').trim();
  const steps = Array.isArray(nh.steps) ? nh.steps : [];
  const active =
    steps.find((s) => String(s.status) === 'active') ||
    steps.find((s) => String(s.status) === 'todo') ||
    null;
  let firstTitle = String((active && active.title) || nh.next || '').trim();
  let firstDetail = String((active && active.detail) || nh.next_detail || '').trim();
  // старые тексты API про вкладку «СТО · авто» на заказе больше неактуальны
  firstDetail = firstDetail
    .replace(/заполните блок «СТО · авто» или распознайте СТС/gi, 'откройте заказ-наряд — авто или фото СТС')
    .replace(/вкладк[аие]\s*«СТО · авто»/gi, 'заказ-наряд')
    .replace(/блок «СТО · авто»/gi, 'заказ-наряд');
  const nextAction = String((active && active.action) || nh.next_action || '').trim();
  const stepsHtml = steps
    .map((s) => {
      const st = String(s.status || 'todo');
      const mark =
        st === 'done' ? '✓' : st === 'active' ? '→' : st === 'skip' ? '·' : '○';
      const cls =
        st === 'done'
          ? 'is-done'
          : st === 'active'
            ? 'is-active'
            : st === 'skip'
              ? 'is-skip'
              : '';
      let detail = String(s.detail || '');
      detail = detail
        .replace(/заполните блок «СТО · авто» или распознайте СТС/gi, 'откройте заказ-наряд — авто или фото СТС')
        .replace(/блок «СТО · авто»/gi, 'заказ-наряд');
      const clickable = s.action && (st === 'active' || st === 'todo') ? ' is-clickable' : '';
      return `<li class="deal-hint-step ${cls}${clickable}" data-hint-action="${esc(s.action || '')}"${
        clickable ? ' role="button" tabindex="0"' : ''
      }>
        <span class="deal-hint-mark">${mark}</span>
        <span><b>${esc(s.title || '')}</b>
        <span class="muted"> — ${esc(detail)}</span></span>
      </li>`;
    })
    .join('');
  return `<div class="deal-hint-bar" id="deal-next-hints" data-expanded="0" data-deal-id="${esc(
    dealId
  )}" data-next-action="${esc(nextAction)}">
    <div class="deal-hint-bar-row">
      <button type="button" class="deal-hint-bar-main" id="deal-hint-go" data-tip="${esc(
        nextAction ? 'Перейти к шагу' : 'Следующий шаг'
      )}">
        <span class="deal-hint-bar-label">След. шаг</span>
        <span class="deal-hint-bar-next">${esc(firstTitle)}</span>
        ${firstDetail ? `<span class="deal-hint-bar-detail">${esc(firstDetail)}</span>` : ''}
      </button>
      <button type="button" class="deal-hint-bar-expand" id="deal-hint-toggle" aria-expanded="false" aria-label="Все шаги" data-tip="Все шаги">
        <span class="deal-hint-bar-chev" aria-hidden="true">▾</span>
      </button>
    </div>
    <div class="deal-hint-bar-panel" id="deal-hint-panel" hidden>
      ${nh.scenario ? `<div class="muted deal-hint-bar-scenario">${esc(nh.scenario)}</div>` : ''}
      <ol class="deal-hint-steps">${stepsHtml}</ol>
    </div>
  </div>`;
}

function bindDealHintBar(dealId) {
  const id = String(dealId || '').trim();
  const bar = document.getElementById('deal-next-hints');
  const go = document.getElementById('deal-hint-go');
  const toggle = document.getElementById('deal-hint-toggle');
  const panel = document.getElementById('deal-hint-panel');
  if (bar && id && !bar.getAttribute('data-deal-id')) bar.setAttribute('data-deal-id', id);
  if (go) {
    go.onclick = () => {
      const act = bar?.getAttribute('data-next-action') || '';
      if (!runDealHintAction(act)) {
        toggle?.click();
      }
    };
  }
  if (toggle && panel && bar) {
    toggle.onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      const open = bar.getAttribute('data-expanded') === '1';
      const next = !open;
      bar.setAttribute('data-expanded', next ? '1' : '0');
      toggle.setAttribute('aria-expanded', next ? 'true' : 'false');
      if (next) panel.removeAttribute('hidden');
      else panel.setAttribute('hidden', '');
    };
  }
  bar?.querySelectorAll('.deal-hint-step.is-clickable[data-hint-action]').forEach((el) => {
    const run = () => {
      const act = String(el.getAttribute('data-hint-action') || '');
      runDealHintAction(act);
    };
    el.onclick = run;
    el.onkeydown = (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        run();
      }
    };
  });
  const pending = state._pendingDealHintAction;
  if (pending && id) {
    state._pendingDealHintAction = null;
    setTimeout(() => runDealHintAction(pending), 100);
  }
}

/** Фиксированный порядок вкладок цепочки заказа. */
/** Порядок вкладок цепочки. СФ — только если уже создана (create не предлагаем). */
const SALES_TYPE_TAB_ORDER = ['contract', 'invoice', 'workorder', 'upd', 'sf'];
const SALES_TYPE_NO_CREATE = new Set(['sf']);

/** Договор нужен юрлицу / ИП / партнёру; физлицу — нет. */
function dealNeedsContract(d) {
  if (!d || typeof d !== 'object') return true;
  if (d.sale_rules && d.sale_rules.is_partner) return true;
  if (d.sale_rules && d.sale_rules.is_legal) return true;
  if (Number(d.is_partner) === 1) return true;
  if (Number(d.is_legal_entity) === 1 || d.is_legal_entity === true) return true;
  const kind = String(d.buyer_kind || '').toLowerCase();
  if (kind === 'legal' || kind === 'ip' || kind === 'partner') return true;
  if (kind === 'person' || kind === 'individual' || kind === 'физлицо') return false;
  // company_id — внутренний id карточки (в т.ч. у физлица), не признак юрлица
  if (String(d.company_name || '').trim()) return true;
  const inn = String(d.buyer_inn || '').replace(/\D/g, '');
  if (inn.length === 10 || inn.length === 12) return true;
  return false;
}

/** Юрлицо / ИП / партнёр — оплата по счёту (или кредит); физлицо — ссылка. */
function dealPaysByInvoice(d) {
  if (d && d.sale_rules && d.sale_rules.credit_allowed) return true;
  return dealNeedsContract(d);
}

function dealPaysByPaymentLink(d) {
  return !dealPaysByInvoice(d);
}

async function fetchDealNeedsContract(dealId) {
  const id = String(dealId || '').trim();
  if (!id) return true;
  try {
    const d = await api('/crm/deals/' + encodeURIComponent(id));
    return dealNeedsContract(d);
  } catch (_) {
    return true;
  }
}

function salesDocTabLabel(d) {
  return SALES_TYPE_TAB[d.doc_type] || SALES_TYPE_LABEL[d.doc_type] || 'Документ';
}

/** Контур (организация) по id компании — как в шапке. */
function companyContourName(companyId) {
  const id = String(companyId || '').trim();
  if (!id) {
    return String(state.filterCompanyName || '').trim() || '—';
  }
  const fromState = (state.companies || []).find((c) => String(c.id) === id);
  if (fromState && fromState.name) return String(fromState.name);
  const sel = document.getElementById('header-company');
  if (sel) {
    const opt = [...sel.options].find((o) => o.value === id);
    if (opt && opt.textContent) return String(opt.textContent).trim();
  }
  if (String(state.filterCompanyId || '') === id && state.filterCompanyName) {
    return String(state.filterCompanyName);
  }
  return '—';
}

/** Контур по юрлицу (organizations.company_id). */
function orgContourName(organizationId) {
  const oid = String(organizationId || '').trim();
  const org = (state.organizations || []).find((o) => String(o.id) === oid);
  if (org && org.company_id) return companyContourName(org.company_id);
  return companyContourName(getFilterCompanyId());
}

/**
 * Блок «Организация / Юрлицо» — на карточке заказа покупателя.
 * opts: {
 *   companyName, companySelectId?, companySelectedId?,
 *   legalName?, legalTip?, legalSelectId?, legalSelectedId?, legalCompanyId?,
 *   locked?, lockedHint?
 * }
 */
function renderOrgLegalBar(opts = {}) {
  const locked = !!opts.locked;
  const hint = String(opts.lockedHint || '').trim();
  const company = String(opts.companyName || '—').trim() || '—';
  const companyInner =
    !locked && opts.companySelectId
      ? `<select id="${esc(opts.companySelectId)}" title="${esc(hint || 'Контур организации')}">${companyOptionsHtml(opts.companySelectedId || '')}</select>`
      : `<input value="${esc(company)}" readonly title="${esc(hint || 'Контур (как в шапке)')}" />`;
  const legalInner =
    !locked && opts.legalSelectId
      ? `<select id="${esc(opts.legalSelectId)}" title="${esc(hint || 'Юрлицо для документов')}">${orgOptionsHtml(
          opts.legalSelectedId || '',
          opts.legalCompanyId || opts.companySelectedId || ''
        )}</select>`
      : `<input value="${esc(opts.legalName || '—')}" readonly title="${esc(opts.legalTip || hint || '')}" />`;
  return `<div class="form-grid form-org-legal${locked ? ' is-locked' : ''}">
    <label>Организация${companyInner}</label>
    <label>Юрлицо${legalInner}</label>
    ${
      locked && hint
        ? `<p class="muted span-2" style="margin:0;font-size:11px">${esc(hint)}</p>`
        : !locked && hint
          ? `<p class="muted span-2" style="margin:0;font-size:11px">${esc(hint)}</p>`
          : ''
    }
  </div>`;
}

/**
 * Привязка селектов организации/юрлица на заказе (до выписки счёта).
 * После счёта блок readonly — handler не вешаем.
 */
function bindDealOrgLegalBar(dealId, opts = {}) {
  const coSel = document.getElementById('deal-company');
  const orgSel = document.getElementById('deal-org');
  if (!coSel && !orgSel) return;

  const reloadOrgs = async (companyId) => {
    const co = String(companyId || '').trim();
    try {
      const path = co
        ? '/organizations?company_id=' + encodeURIComponent(co)
        : withCompanyId('/organizations');
      const data = await api(path);
      state.organizations = Array.isArray(data) ? data : data.items || [];
    } catch (_) {
      /* keep previous */
    }
  };

  const fillLegal = (preferredId) => {
    if (!orgSel) return;
    const co = coSel ? String(coSel.value || '').trim() : String(opts.companyId || '').trim();
    const prefer = String(preferredId || state.dealOrgId || '').trim();
    orgSel.innerHTML = orgOptionsHtml(prefer, co);
    state.dealOrgId = String(orgSel.value || '').trim();
  };

  if (coSel) {
    coSel.onchange = async () => {
      const co = String(coSel.value || '').trim();
      coSel.disabled = true;
      try {
        await api('/crm/deals/' + encodeURIComponent(dealId) + '/org-company', {
          method: 'PATCH',
          body: JSON.stringify({ org_company_id: co }),
        });
        await reloadOrgs(co);
        fillLegal('');
      } catch (e) {
        alert(e.message || String(e));
      } finally {
        coSel.disabled = false;
      }
    };
  }
  if (orgSel) {
    orgSel.onchange = () => {
      state.dealOrgId = String(orgSel.value || '').trim();
    };
  }
}

/**
 * Нужно подсветить «Счета», если по правилам нужен чек АТОЛ и он не выбит:
 * — физлицо + предоплата: чек 1 после оплаты, чек 2 после расходной;
 * — физлицо + полный / оплата при получении: 1 чек при получен/вручен или выдаче;
 * — юрлицо / партнёр / кредит: чеки АТОЛ не требуются;
 * — есть приход-возврат, а чек возврата не выбит.
 * @returns {{ alert: boolean, tip: string }}
 */
function dealFiscalAlertInfo(dealLike, returnDocs, stockOuts) {
  const empty = { alert: false, tip: '' };
  if (!dealLike || typeof dealLike !== 'object') return empty;

  const rules = dealLike.sale_rules || null;
  const fiscalNeed = rules && rules.fiscal_need ? String(rules.fiscal_need) : '';
  const skipFiscal =
    fiscalNeed === 'none' ||
    (!fiscalNeed &&
      (Number(dealLike.is_partner) === 1 ||
        String(dealLike.buyer_kind || '').toLowerCase() === 'partner'));

  const fiscal = Array.isArray(dealLike.fiscal_receipts) ? dealLike.fiscal_receipts : [];
  const bad = new Set(['error', 'cancelled', 'canceled']);
  const okFiscal = (kinds) =>
    fiscal.some((f) => kinds.has(String(f.kind || '')) && !bad.has(String(f.status || '').toLowerCase()));

  const hasAdvance = okFiscal(new Set(['advance']));
  const hasFull = okFiscal(new Set(['full']));
  const hasSell = hasAdvance || hasFull;

  const reasons = [];
  const paidFlag =
    Number(dealLike.paid) === 1 ||
    String(dealLike.payment_status || '').toLowerCase() === 'paid';
  const payments = Array.isArray(dealLike.payments) ? dealLike.payments : [];
  const hasPaidPayment = payments.some((p) =>
    ['paid', 'confirmed', 'success', 'accepted'].includes(String(p.status || '').toLowerCase())
  );

  if (!skipFiscal) {
    const needAdvanceThenFull = fiscalNeed === 'advance_then_full' || !fiscalNeed;
    const needFullOnly = fiscalNeed === 'full_only';
    if ((paidFlag || hasPaidPayment) && !hasSell) {
      reasons.push('sell');
    }
    const outs = Array.isArray(stockOuts)
      ? stockOuts
      : Array.isArray(dealLike.stock_outs)
        ? dealLike.stock_outs
        : [];
    const hasOut = outs.some((o) => o && o.id);
    if (needAdvanceThenFull && hasAdvance && hasOut && !hasFull) {
      reasons.push('full');
    }
    if (needFullOnly && (paidFlag || hasPaidPayment || hasOut) && !hasFull) {
      reasons.push('full');
    }
  }

  const returns = Array.isArray(returnDocs)
    ? returnDocs
    : Array.isArray(dealLike.return_docs)
      ? dealLike.return_docs
      : [];
  const hasReturn = returns.some((r) => r && r.id);
  if (hasReturn && !okFiscal(new Set(['refund', 'refund_advance']))) {
    reasons.push('refund');
  }

  if (!reasons.length) return empty;
  const tips = [];
  if (reasons.includes('sell')) {
    tips.push(
      fiscalNeed === 'full_only'
        ? 'Оплачено — нужно выбить полный чек'
        : 'Пришла предоплата (QR) — выбейте чек 1 (аванс). Полный — когда клиент приедет / при выдаче'
    );
  }
  if (reasons.includes('full')) {
    tips.push(
      'Есть аванс — при выдаче на СТО выбейте чек 2 (полный расчёт, зачёт предоплаты + доплата налом)'
    );
  }
  if (reasons.includes('refund')) {
    tips.push('Есть возврат — нужно выбить чек возврата');
  }
  return { alert: true, tip: tips.join('. ') };
}

function dealNeedsFiscalReceiptAlert(dealLike, returnDocs, stockOuts) {
  return dealFiscalAlertInfo(dealLike, returnDocs, stockOuts).alert;
}

async function loadDealStockReturns(dealId) {
  const id = String(dealId || '').trim();
  if (!id) return [];
  try {
    const r = await api(
      withCompanyId('/docs?type=return&deal_id=' + encodeURIComponent(id) + '&limit=50')
    );
    return Array.isArray(r) ? r : r.items || [];
  } catch (_) {
    return [];
  }
}

async function fetchDealFiscalAlert(dealId) {
  const id = String(dealId || '').trim();
  if (!id) return { alert: false, tip: '' };
  try {
    const [d, returns, outs] = await Promise.all([
      api('/crm/deals/' + encodeURIComponent(id)),
      loadDealStockReturns(id),
      loadDealStockOuts(id),
    ]);
    return dealFiscalAlertInfo(d, returns, outs);
  } catch (_) {
    return { alert: false, tip: '' };
  }
}

/**
 * Вкладки цепочки заказа — один и тот же порядок везде:
 * Заказ · Договоры · Счета · … · Перемещение · Расходные · Структура · История
 */
function buildOrderLinkTabs(opts = {}) {
  const dealId = String(opts.dealId || '').trim();
  const cur = opts.current || {};
  const curKind =
    cur.kind === 'deal'
      ? 'deal'
      : cur.kind === 'doc'
        ? 'doc'
        : cur.kind === 'history'
          ? 'history'
          : cur.kind === 'structure'
            ? 'structure'
            : cur.kind === 'xfer'
              ? 'xfer'
              : 'sales';
  const curId = String(cur.id || '').trim();
  const effectiveDealId =
    dealId ||
    ((curKind === 'deal' || curKind === 'history' || curKind === 'structure') && curId
      ? curId
      : '');
  if (!effectiveDealId) return [];

  const byType = {};
  for (const d of Array.isArray(opts.siblings) ? opts.siblings : []) {
    if (!d || !d.id) continue;
    const t = String(d.doc_type || '');
    if (!t) continue;
    if (!byType[t]) byType[t] = [];
    byType[t].push(d);
  }
  for (const t of Object.keys(byType)) {
    byType[t].sort((a, b) => String(b.doc_date || '').localeCompare(String(a.doc_date || '')));
  }
  if (curKind === 'sales' && curId && cur.docType) {
    const t = String(cur.docType);
    if (!byType[t]) byType[t] = [];
    if (!byType[t].some((x) => String(x.id) === curId)) {
      byType[t].unshift({ id: curId, doc_type: t, doc_date: '' });
    }
  }
  const outs = (Array.isArray(opts.stockOuts) ? opts.stockOuts : []).filter((d) => d && d.id);
  if (curKind === 'doc' && curId && !outs.some((o) => String(o.id) === curId)) {
    outs.unshift({ id: curId });
  }
  const xfers = (Array.isArray(opts.transferOrders) ? opts.transferOrders : []).filter(
    (d) => d && d.id
  );
  if (curKind === 'xfer' && curId && !xfers.some((x) => String(x.id) === curId)) {
    xfers.unshift({ id: curId });
  }

  const tabs = [{ id: 'deal:' + effectiveDealId, label: 'Заказ' }];

  const invoiceAlert = !!opts.invoiceAlert;
  const invoiceAlertTip = String(opts.invoiceAlertTip || '').trim();
  const needContract = opts.needContract !== false;
  /** Пакет из sale_rules.doc_pack / doc_pack_types — что можно создавать по сценарию. */
  const packRaw = Array.isArray(opts.docPack)
    ? opts.docPack
    : Array.isArray(opts.saleRules && opts.saleRules.doc_pack)
      ? opts.saleRules.doc_pack
      : null;
  const docPack = packRaw
    ? new Set(packRaw.map((x) => String(x || '').trim()).filter(Boolean))
    : null;
  const scenarioTip = String(
    (opts.saleRules && opts.saleRules.labels &&
      [opts.saleRules.labels.buyer, opts.saleRules.labels.payment, opts.saleRules.labels.fiscal]
        .filter(Boolean)
        .join(' · ')) ||
      opts.scenarioTip ||
      ''
  ).trim();
  const canCreateType = (t) => {
    if (!opts.allowCreate) return false;
    if (SALES_TYPE_NO_CREATE.has(t)) return false;
    if (t === 'sf') return false;
    // Шапки «Договоры» / «УПД» всегда в цепочке; API сам откажет, если нельзя
    return true;
  };
  const packHint = (t) => {
    if (t === 'contract' && !needContract) {
      return ' · обычно не нужен физлицу — создайте только при необходимости';
    }
    if (t === 'upd' && opts.personNoUpd) {
      return ' · для физлица без ИНН УПД обычно не оформляют';
    }
    if (!docPack) return scenarioTip ? ' · ' + scenarioTip : '';
    if (docPack.has(t)) return scenarioTip ? ' · по сценарию: ' + scenarioTip : ' · в пакете сценария';
    return ' · вне основного пакета сценария';
  };
  for (const t of SALES_TYPE_TAB_ORDER) {
    const list = byType[t] || [];
    // СФ: только открыть существующее, create не показываем
    if (SALES_TYPE_NO_CREATE.has(t) && !list.length) continue;
    if (list.length) {
      const prefer =
        curKind === 'sales' && String(cur.docType || '') === t ? curId : '';
      const pick =
        (prefer && list.find((x) => String(x.id) === prefer)) || list[0];
      const isInvoice = t === 'invoice';
      const alert = isInvoice && invoiceAlert;
      tabs.push({
        id: 'sales:' + pick.id,
        label: SALES_TYPE_TAB[t],
        // При алерте показываем цифру даже для одного счёта — «горит».
        count: list.length > 1 || alert ? list.length : undefined,
        alert: alert || undefined,
        tip: alert
          ? invoiceAlertTip ||
            'Нужно выбить чек (предоплата / полный / возврат)'
          : salesDocOpenTip(t, pick, list.length),
      });
    } else if (canCreateType(t)) {
      const baseTip = SALES_TYPE_CREATE_TIP[t] || 'Создать: ' + SALES_TYPE_TAB[t];
      const blocked = t === 'upd' && opts.personNoUpd;
      tabs.push({
        id: 'create:' + t,
        label: SALES_TYPE_TAB[t],
        create: true,
        alert: blocked || undefined,
        tip:
          baseTip +
          packHint(t) +
          (blocked
            ? ''
            : t === 'upd'
              ? ' · экран подготовки: ИНН, оплата, создать'
              : ' · откроет список, чего не хватает для оформления'),
      });
    }
  }

  const canCreateShip = opts.allowCreate && !opts.personNoUpd;

  if (xfers.length) {
    const prefer = curKind === 'xfer' ? curId : '';
    const pick = (prefer && xfers.find((x) => String(x.id) === prefer)) || xfers[0];
    const num = String(pick.number || '').trim();
    tabs.push({
      id: 'xfer:' + pick.id,
      label: 'Заказ на перемещение',
      tip:
        'Открыть заказ на перемещение' +
        (num ? ' №' + num : '') +
        ' · откуда / куда · кладовщик' +
        (xfers.length > 1 ? ' · ещё ' + (xfers.length - 1) : ''),
      count: xfers.length > 1 ? xfers.length : undefined,
    });
  } else if (opts.allowCreate) {
    tabs.push({
      id: 'create:transfer',
      label: 'Заказ на перемещение',
      create: true,
      tip: 'Создать заказ на перемещение · откуда / куда · кладовщик',
    });
  }

  if (outs.length) {
    const prefer = curKind === 'doc' ? curId : '';
    const pick = (prefer && outs.find((x) => String(x.id) === prefer)) || outs[0];
    const num = String(pick.number || '').trim();
    tabs.push({
      id: 'doc:' + pick.id,
      label: 'Расходные',
      tip:
        'Открыть расходную' +
        (num ? ' №' + num : '') +
        ' · списание со склада' +
        (outs.length > 1 ? ' · ещё ' + (outs.length - 1) : ''),
      count: outs.length > 1 ? outs.length : undefined,
    });
  } else if (canCreateShip) {
    tabs.push({
      id: 'create:upd-ship',
      label: 'Расходные',
      create: true,
      alert: opts.chainIncomplete || undefined,
      tip:
        'УПД + расходная · списание товаров со склада' +
        (opts.chainIncompleteTip ? ' · ' + opts.chainIncompleteTip : '') +
        ' · экран подготовки: структура, остатки, создать',
    });
  } else if (opts.allowCreate && opts.personNoUpd) {
    // физлицо: шапка «Расходные» видна, create через склад / без УПД-пакета
    tabs.push({
      id: 'create:upd-ship',
      label: 'Расходные',
      create: true,
      alert: opts.chainIncomplete || opts.personNoUpd || undefined,
      tip:
        'Списание со склада (для физлица УПД может быть недоступен — укажите ИНН на экране подготовки)' +
        (opts.chainIncompleteTip ? ' · ' + opts.chainIncompleteTip : ''),
    });
  }
  tabs.push({
    id: 'structure:' + effectiveDealId,
    label: 'Структура',
    tip:
      opts.chainIncompleteTip ||
      (opts.chainIncomplete
        ? 'Не хватает документов в цепочке — откройте структуру'
        : 'Структура документов по заказу'),
    alert: opts.chainIncomplete || undefined,
  });

  tabs.push({
    id: 'history:' + effectiveDealId,
    label: 'История',
    tip: 'История по заказу и всем связанным документам',
  });

  return tabs;
}

async function loadDealTransferOrders(dealId) {
  const id = String(dealId || '').trim();
  if (!id) return [];
  try {
    const r = await api('/crm/deals/' + encodeURIComponent(id) + '/transfer-orders');
    return Array.isArray(r) ? r : r.items || [];
  } catch (_) {
    return [];
  }
}

/** Создать заказ на перемещение из позиций заказа покупателя. */
async function createDealTransferOrder(dealId, msgEl) {
  const id = String(dealId || '').trim();
  if (!id) throw new Error('Нет заказа покупателя');
  const setMsg = (t) => {
    if (msgEl) msgEl.textContent = t;
  };
  await refreshRefs();
  const deal = await api('/crm/deals/' + encodeURIComponent(id));
  const items = (deal.items || []).filter(
    (it) => String(it.product_guid || it.product_id || '').trim() && Number(it.qty) > 0
  );
  if (!items.length) throw new Error('В заказе нет товарных позиций для перемещения');

  let warehouses = state.warehouses || [];
  try {
    warehouses = await api(withCompanyId('/warehouses'));
    if (Array.isArray(warehouses)) state.warehouses = warehouses;
    else warehouses = warehouses.items || state.warehouses || [];
  } catch (_) {
    /* keep */
  }
  const manual = (warehouses || []).filter((w) => {
    const code = String(w.code || '').toUpperCase();
    return !w.archived && !code.startsWith('WAIT') && !code.startsWith('SYS') && !Number(w.is_system);
  });
  if (manual.length < 2) {
    throw new Error('Нужны минимум два обычных склада (не системных)');
  }
  const opts = manual
    .map((w) => `${w.code || ''} · ${w.name || w.id}`)
    .join('\n');
  const fromHint = window.prompt(
    `Откуда (номер в списке 1…${manual.length}):\n\n` +
      manual.map((w, i) => `${i + 1}. ${w.code || ''} · ${w.name || ''}`).join('\n'),
    '1'
  );
  if (fromHint == null) return null;
  const fromIdx = Math.max(0, Number(fromHint) - 1);
  const fromWh = manual[fromIdx];
  if (!fromWh) throw new Error('Неверный склад «Откуда»');

  const toHint = window.prompt(
    `Куда (номер в списке 1…${manual.length}, не ${fromIdx + 1}):\n\n` +
      manual.map((w, i) => `${i + 1}. ${w.code || ''} · ${w.name || ''}`).join('\n'),
    String(fromIdx === 0 ? 2 : 1)
  );
  if (toHint == null) return null;
  const toIdx = Math.max(0, Number(toHint) - 1);
  const toWh = manual[toIdx];
  if (!toWh) throw new Error('Неверный склад «Куда»');
  if (String(toWh.id) === String(fromWh.id)) throw new Error('Склады «Откуда» и «Куда» должны отличаться');

  const comment =
    window.prompt(
      'Комментарий к заказу на перемещение (обязательно):',
      `По заказу покупателя ${id}`
    ) || '';
  if (!String(comment).trim()) throw new Error('Укажите комментарий');

  const lines = items.map((it) => ({
    product_id: String(it.product_guid || it.product_id || '').trim(),
    qty: Number(it.qty) || 0,
  }));
  const qtySum = lines.reduce((s, l) => s + l.qty, 0);
  if (
    !confirm(
      `Создать заказ на перемещение?\n\nОткуда: ${fromWh.name}\nКуда: ${toWh.name}\nПозиций: ${lines.length}\nКол-во: ${qtySum}\n\nВ заказе — артикулы; конкретные марки укажет кладовщик при переносе.`
    )
  ) {
    return null;
  }
  setMsg('Создание заказа на перемещение…');
  const r = await api('/stock/transfer-request', {
    method: 'POST',
    body: JSON.stringify({
      warehouse_from_id: fromWh.id,
      warehouse_to_id: toWh.id,
      comment: String(comment).trim(),
      post: false,
      deal_id: id,
      lines,
    }),
  });
  const xferId = r.history?.id;
  setMsg(
    `Заказ на перемещение ${r.history?.number || r.number || ''} · ${r.from_label || ''} → ${r.to_label || ''}` +
      (r.warehouse_task?.number ? ` · задание ${r.warehouse_task.number}` : '')
  );
  if (xferId) {
    openTab('xfer:' + xferId, String(r.history?.number || 'Заказ на перемещение').slice(0, 40));
  } else if (r.warehouse_task?.id) {
    state.whTaskFocus = r.warehouse_task.id;
    openTab('wh-tasks', r.warehouse_task.number || 'Задание');
  }
  return r;
}

/** Карточка заказа на перемещение в цепочке заказа покупателя. */
async function renderTransferOrderDetail(xferIdRaw) {
  const xferId = String(xferIdRaw || '').trim();
  if (!xferId) return;
  await refreshRefs();
  const d = await api('/transfer-orders/' + encodeURIComponent(xferId));
  const dealId = String(d.deal_id || '').trim();
  const tabId = 'xfer:' + xferId;
  const title = ['Заказ на перемещение', d.number].filter(Boolean).join(' · ');
  let tab = state.tabs.find((t) => t.id === tabId);
  if (!tab) {
    tab = { id: tabId, title: title.slice(0, 48), closable: true };
    state.tabs.push(tab);
  } else {
    tab.title = title.slice(0, 48);
  }
  state.activeTab = tabId;
  renderTabs();
  showForm();
  highlightSection(sectionForTab(tabId) || 'warehouse');
  setUrl(pathForTab(tabId));

  let salesDocs = [];
  let stockOuts = [];
  let transferOrders = [d];
  let fiscalAlert = { alert: false, tip: '' };
  let xferNeedContract = true;
  if (dealId) {
    try {
      const rel = await api(
        withCompanyId('/sales-docs?deal_id=' + encodeURIComponent(dealId) + '&limit=100')
      );
      salesDocs = rel.items || [];
    } catch (_) {
      salesDocs = [];
    }
    stockOuts = await loadDealStockOuts(dealId);
    transferOrders = await loadDealTransferOrders(dealId);
    if (!transferOrders.some((x) => String(x.id) === xferId)) transferOrders.unshift(d);
    fiscalAlert = await fetchDealFiscalAlert(dealId);
    xferNeedContract = await fetchDealNeedsContract(dealId);
  }
  const xferTree = dealId ? await loadDealDocTree(dealId) : null;
  const hintDeal = dealId ? await loadDealForHintBar(dealId) : null;
  const linkTabs = dealId
    ? buildOrderLinkTabs({
        dealId,
        current: { kind: 'xfer', id: xferId },
        siblings: salesDocs,
        stockOuts,
        transferOrders,
        allowCreate: true,
        needContract: xferNeedContract,
        invoiceAlert: fiscalAlert.alert,
        invoiceAlertTip: fiscalAlert.tip,
        ...chainIncompleteOpts(xferTree),
      })
    : undefined;

  const pickers = Array.isArray(d.pickers) ? d.pickers : [];
  const activity = Array.isArray(d.activity) ? d.activity : [];
  const fmtAt = (raw) => {
    const s = String(raw || '').trim();
    if (!s) return '—';
    return s.slice(0, 19).replace('T', ' ');
  };
  const mover =
    activity.find((a) => a.event === 'status.handed') ||
    pickers.find((p) => String(p.event || '') === 'status.handed') ||
    pickers[0] ||
    null;
  const arrived =
    activity.find((a) => a.event === 'task.created') ||
    activity.find((a) => a.event === 'transfer_order.created') ||
    null;

  const activityHtml = activity.length
    ? `<table class="data-table is-dense xfer-activity">
        <thead><tr><th>Когда</th><th>Кто</th><th>Что сделал</th><th>Детали</th></tr></thead>
        <tbody>
          ${activity
            .map(
              (a) => `<tr>
              <td class="mono" style="white-space:nowrap">${esc(fmtAt(a.at))}</td>
              <td>${esc(a.who || '—')}</td>
              <td><b>${esc(a.action || a.event || '—')}</b></td>
              <td class="muted" style="font-size:12px">${esc(a.detail || '')}</td>
            </tr>`
            )
            .join('')}
        </tbody>
      </table>`
    : '<p class="muted">Пока нет событий по заказу на перемещение.</p>';

  const lines = Array.isArray(d.lines) ? d.lines : [];
  const linesHtml = lines.length
    ? `<table class="data-table is-dense">
        <thead><tr><th>Артикул</th><th>Номенклатура</th><th>Кол-во</th><th>Марки (экземпляры)</th></tr></thead>
        <tbody>
          ${lines
            .map((l) => {
              const serials = Array.isArray(l.serials) ? l.serials : [];
              return `<tr>
                <td class="mono">${esc(l.sku || '—')}</td>
                <td>${esc(l.name || '—')}</td>
                <td class="mono">${esc(String(l.qty ?? ''))}</td>
                <td class="mono" style="font-size:11px">${
                  serials.length
                    ? serials.map((s) => esc(s)).join('<br/>')
                    : '<span class="muted">кладовщик укажет при переносе</span>'
                }</td>
              </tr>`;
            })
            .join('')}
        </tbody>
      </table>`
    : '<p class="muted">Нет строк.</p>';

  view.innerHTML = formChrome(
    title,
    `
    <p class="muted" style="margin:0 0 12px;font-size:12px">
      ${esc(d.note || 'В заказе покупателя — артикул и количество. Конкретные марки указывает кладовщик при переносе.')}
    </p>
    <div class="panel" style="margin-bottom:12px;padding:12px 14px">
      <div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px 16px;font-size:13px">
        <div>
          <div class="muted" style="font-size:11px;margin-bottom:2px">Поступил</div>
          <div><b>${esc(fmtAt(arrived?.at || d.warehouse_task_created_at || d.created_at))}</b></div>
          <div class="muted" style="font-size:12px">${esc(arrived?.who || d.created_by_name || '—')}</div>
        </div>
        <div>
          <div class="muted" style="font-size:11px;margin-bottom:2px">Кто переместил</div>
          <div><b>${esc(mover?.name || mover?.who || 'Ещё не перемещал')}</b></div>
          <div class="muted" style="font-size:12px">${esc(
            mover ? fmtAt(mover.at || d.warehouse_task_handed_at) : 'ожидает кладовщика'
          )}</div>
        </div>
        <div>
          <div class="muted" style="font-size:11px;margin-bottom:2px">Статус</div>
          <div><b>${esc(d.warehouse_task_status_label || d.status || '—')}</b></div>
          <div class="muted" style="font-size:12px">${esc(
            d.from_label || '—'
          )} → ${esc(d.to_label || '—')}</div>
        </div>
      </div>
    </div>
    <div class="form-grid">
      <label>Номер<input class="mono" value="${esc(d.number || '')}" readonly /></label>
      <label>Дата<input class="mono" value="${esc(String(d.doc_date || '').slice(0, 10))}" readonly /></label>
      <label>Откуда<input value="${esc(d.from_label || '—')}" readonly /></label>
      <label>Куда<input value="${esc(d.to_label || '—')}" readonly /></label>
      <label>Создал<input value="${esc(d.created_by_name || '—')}" readonly /></label>
      <label>Задание складу<input class="mono" value="${esc(d.warehouse_task_number || '—')}" readonly /></label>
      <label>Документ перемещения<input class="mono" value="${esc(d.stock_doc_number || '—')}" readonly /></label>
      <label>Проведено<input value="${esc(d.stock_posted ? 'Да' : 'Нет')}" readonly /></label>
      <label class="span-2">Комментарий<textarea rows="2" readonly>${esc(d.comment || d.user_comment || '')}</textarea></label>
      <label>Позиций<input class="mono" value="${esc(String(d.lines_count ?? lines.length))}" readonly /></label>
      <label>Кол-во / марок<input class="mono" value="${esc(String(d.qty_sum ?? 0))} / ${esc(String(d.serials_count ?? 0))}" readonly /></label>
    </div>
    <h3 class="form-section-title">Ход выполнения</h3>
    <p class="muted" style="margin:0 0 8px;font-size:12px">Кто взял заказ, когда поступил на склад и что сделал.</p>
    ${activityHtml}
    <h3 class="form-section-title">Состав</h3>
    ${linesHtml}
    <div class="toolbar" style="margin-top:12px">
      ${
        d.warehouse_task_id
          ? `<button type="button" id="xfer-open-task">Открыть задание кладовщику</button>`
          : ''
      }
      ${
        d.stock_doc_id
          ? `<button type="button" id="xfer-open-doc">Открыть перемещение запасов</button>`
          : ''
      }
      ${dealId ? `<button type="button" id="xfer-open-deal">К заказу покупателя</button>` : ''}
      <span class="muted" id="xfer-msg" style="font-size:12px"></span>
    </div>`,
    {
      section: 'Заказ покупателя',
      entityKind: 'transfer_order',
      pageTabs: linkTabs,
      activePageTab: tabId,
      hintBar: dealHintBarHtml(hintDeal),
    }
  );
  bindFormChrome(() => openTab(dealId ? 'deal:' + dealId : 'parity-transfer-orders'));
  if (dealId) {
    bindDealHintBar(dealId);
    bindOrderLinkTabs(view, {
      dealId,
      onCreate: async (action, btn) => {
        if (btn) btn.disabled = true;
        try {
          if (action === 'transfer') {
            await createDealTransferOrder(dealId, document.getElementById('xfer-msg'));
            return;
          }
          await createLinkedSalesDoc(dealId, action, '', document.getElementById('xfer-msg'));
        } catch (e) {
          alert(e.message || String(e));
          if (btn) btn.disabled = false;
        }
      },
    });
  }
  document.getElementById('xfer-open-task')?.addEventListener('click', () => {
    if (!d.warehouse_task_id) return;
    state.whTaskFocus = d.warehouse_task_id;
    openTab('wh-tasks', d.warehouse_task_number || 'Задание');
  });
  document.getElementById('xfer-open-doc')?.addEventListener('click', () => {
    if (d.stock_doc_id) openTab('doc:' + d.stock_doc_id);
  });
  document.getElementById('xfer-open-deal')?.addEventListener('click', () => {
    if (dealId) openTab('deal:' + dealId);
  });
}

/**
 * Гос. номер с экрана заказа (подсказка / вкладка СТО · авто).
 * При необходимости сразу сохраняет на сделку.
 */
async function ensureDealCarPlateForWorkorder(dealId, msgEl) {
  const id = String(dealId || '').trim();
  if (!id) throw new Error('Нет заказа покупателя');
  const setMsg = (t) => {
    if (msgEl) msgEl.textContent = t;
  };
  const plateFromDom = () =>
    String(
      document.getElementById('deal-hint-plate')?.value ||
        document.getElementById('deal-car-plate')?.value ||
        ''
    ).trim();

  let plate = plateFromDom();
  let dealRow = null;
  try {
    dealRow = await api('/crm/deals/' + encodeURIComponent(id));
  } catch (_) {
    dealRow = null;
  }
  const savedPlate = String(dealRow?.car_plate || '').trim();
  if (!plate) plate = savedPlate;

  if (plate && plate.toUpperCase() !== savedPlate.toUpperCase()) {
    setMsg('Сохраняем гос. номер…');
    const body = {
      car_plate: plate,
      car_vin: document.getElementById('deal-car-vin')?.value || dealRow?.car_vin || '',
      car_year: document.getElementById('deal-car-year')?.value || dealRow?.car_year || '',
      car_mileage:
        document.getElementById('deal-car-mileage')?.value || dealRow?.car_mileage || '',
      car_brand: document.getElementById('deal-car-brand')?.value || dealRow?.car_brand || '',
      car_model: document.getElementById('deal-car-model')?.value || dealRow?.car_model || '',
      car_color: document.getElementById('deal-car-color')?.value || dealRow?.car_color || '',
      car_category:
        document.getElementById('deal-car-category')?.value || dealRow?.car_category || '',
      car_pts: document.getElementById('deal-car-pts')?.value || dealRow?.car_pts || '',
      car_owner: document.getElementById('deal-car-owner')?.value || dealRow?.car_owner || '',
      car_owner_street:
        document.getElementById('deal-car-owner-street')?.value ||
        dealRow?.car_owner_street ||
        '',
      car_owner_house:
        document.getElementById('deal-car-owner-house')?.value ||
        dealRow?.car_owner_house ||
        '',
      car_owner_flat:
        document.getElementById('deal-car-owner-flat')?.value || dealRow?.car_owner_flat || '',
      car_sts_date:
        document.getElementById('deal-car-sts-date')?.value || dealRow?.car_sts_date || '',
      car_sts_number:
        document.getElementById('deal-car-sts-number')?.value ||
        dealRow?.car_sts_number ||
        '',
    };
    await api('/crm/deals/' + encodeURIComponent(id) + '/vehicle', {
      method: 'PATCH',
      body: JSON.stringify(body),
    });
    return plate;
  }

  if (!plate) {
    const createBtn = document.querySelector('[data-pagetab="create:workorder"]');
    const woTab = [...document.querySelectorAll('.form-pagetabs [data-pagetab]')].find((b) =>
      /заказ-наряд/i.test(b.textContent || '')
    );
    (createBtn || woTab)?.click();
    throw new Error(
      'Укажите гос. номер в заказ-наряде (блок «Автомобиль» / фото СТС) — без него PDF ЗН не скачается'
    );
  }
  return plate;
}

/**
 * Чеклист готовности к созданию документа продажи.
 * blockers — без этого создать нельзя; warnings — можно, но лучше дозаполнить; ok — уже есть.
 * extra: { structureMissing, structureComplete, stockMissing, stockOk, stockNeeds }
 */
function buildSalesDocCreateChecklist(deal, action, extra = {}) {
  const d = deal || {};
  const act = String(action || '').trim();
  const items = Array.isArray(d.items) ? d.items : [];
  const inn = String(d.buyer_inn || '').replace(/\D/g, '');
  // только название — company_id это UUID карточки, не показывать в UI
  const company = String(d.company_name || '').trim();
  const contact = String(d.buyer_name || '').trim();
  const isLegal =
    Number(d.is_legal_entity) === 1 ||
    String(d.buyer_kind || '').toLowerCase() === 'legal' ||
    String(d.buyer_kind || '').toLowerCase() === 'partner' ||
    Number(d.is_partner) === 1 ||
    !!company ||
    inn.length === 10;
  const plate = String(d.car_plate || '').trim();
  const paid =
    Number(d.paid) === 1 || String(d.payment_status || '').toLowerCase() === 'paid';
  const rules = d.sale_rules || {};
  const blockers = [];
  const warnings = [];
  const ok = [];

  if (['invoice', 'workorder', 'upd', 'upd-ship', 'sf'].includes(act)) {
    if (items.length) {
      ok.push({ id: 'items', title: 'Позиции заказа', detail: items.length + ' шт.' });
    } else {
      blockers.push({
        id: 'items',
        title: 'Нет позиций в заказе',
        detail: 'Добавьте товары или услуги в заказ покупателя',
        goto: 'deal:items',
      });
    }
  }

  if (act === 'upd' || act === 'upd-ship' || act === 'sf') {
    if (isLegal || inn) {
      ok.push({
        id: 'buyer',
        title: 'Покупатель для УПД',
        detail: isLegal
          ? company || contact || 'юрлицо / ИП'
          : 'ИНН ' + inn,
      });
    } else {
      blockers.push({
        id: 'buyer',
        title: 'Нужен ИНН или юрлицо',
        detail:
          'УПД для физлица без ИНН не оформляют. Укажите ИНН в карточке покупателя / привяжите компанию',
        goto: 'deal:buyer',
      });
    }
    if (!paid && String(rules.payment_scheme || '') === 'prepay') {
      warnings.push({
        id: 'pay',
        title: 'Оплата ещё не отмечена',
        detail: 'По сценарию предоплата — обычно УПД после оплаты / отгрузки',
        goto: 'deal:qr',
      });
    }
  }

  if (act === 'upd-ship') {
    warnings.push({
      id: 'ship',
      title: 'Списание со склада',
      detail: 'Будет создана расходная только по товарам; услуги останутся в УПД',
    });

    // Ошибки / пробелы структуры цепочки — показать, но не блокировать клик «создать»
    const structMiss = Array.isArray(extra.structureMissing)
      ? extra.structureMissing.map(String).filter(Boolean)
      : [];
    if (extra.structureComplete) {
      ok.push({
        id: 'structure',
        title: 'Структура цепочки',
        detail: 'полная — обязательные документы на месте',
      });
    } else if (structMiss.length) {
      structMiss.forEach((label, i) => {
        warnings.push({
          id: 'structure_' + i,
          title: 'Структура: не хватает',
          detail: label,
          goto: 'structure',
        });
      });
    } else if (extra.structureChecked) {
      warnings.push({
        id: 'structure',
        title: 'Цепочка неполная',
        detail: 'Откройте «Структура» — что ещё нужно досоздать',
        goto: 'structure',
      });
    }

    const stockMiss = Array.isArray(extra.stockMissing)
      ? extra.stockMissing.map(String).filter(Boolean)
      : [];
    if (stockMiss.length) {
      stockMiss.slice(0, 8).forEach((line, i) => {
        blockers.push({
          id: 'stock_' + i,
          title: 'Нет на складе',
          detail: line,
          goto: 'deal:items',
        });
      });
    } else if (extra.stockChecked) {
      const n = Number(extra.stockNeeds) || 0;
      ok.push({
        id: 'stock',
        title: 'Остатки для списания',
        detail: n > 0 ? 'товары найдены на складе (' + n + ')' : 'товаров для списания нет (только услуги?)',
      });
    }
  }

  if (act === 'workorder') {
    if (plate) {
      ok.push({ id: 'plate', title: 'Гос. номер', detail: plate });
    } else {
      warnings.push({
        id: 'plate',
        title: 'Авто ещё не заполнено',
        detail: 'ЗН можно создать — затем заполните авто / распознайте СТС на карточке',
        goto: 'create:workorder',
      });
    }
  }

  if (act === 'contract') {
    if (contact || company) {
      ok.push({
        id: 'buyer_name',
        title: 'Покупатель',
        detail: contact || company,
      });
    } else {
      warnings.push({
        id: 'buyer_name',
        title: 'ФИО / название покупателя пустое',
        detail: 'Проверьте карточку заказа — в договор подтянется покупатель',
        goto: 'deal:buyer',
      });
    }
    if (!isLegal && !inn) {
      warnings.push({
        id: 'person_contract',
        title: 'Физлицо',
        detail: 'Договор физлицу обычно не нужен — создавайте только при необходимости',
      });
    }
  }

  if (act === 'invoice') {
    ok.push({
      id: 'invoice_ok',
      title: 'Счёт',
      detail: isLegal ? 'Для юрлица / ИП' : 'Для физлица (оплата по ссылке / QR)',
    });
  }

  return {
    ready: blockers.length === 0,
    blockers,
    warnings,
    ok,
    label:
      act === 'upd-ship'
        ? 'Расходные'
        : SALES_TYPE_TAB[act] || SALES_TYPE_LABEL[act] || act,
  };
}

function runSalesDocCreateGoto(dealId, goto) {
  const g = String(goto || '').trim();
  const id = String(dealId || '').trim();
  if (!g || !id) return;
  closeCreateLightbox();
  const afterDeal = (fn) => {
    openTab('deal:' + id);
    let tries = 0;
    const tick = () => {
      tries += 1;
      if (fn() || tries >= 25) return;
      setTimeout(tick, 120);
    };
    setTimeout(tick, 80);
  };
  if (g === 'deal:items') {
    afterDeal(() => {
      const ok = activateDealTab('items');
      if (ok) {
        document.getElementById('deal-scan-unit')?.focus?.();
        document.getElementById('deal-item-add-open')?.scrollIntoView?.({
          block: 'center',
          behavior: 'smooth',
        });
      }
      return ok;
    });
    return;
  }
  if (g === 'deal:buyer') {
    afterDeal(() => {
      activateDealTab('main') || activateDealTab('buyer');
      const inn = document.getElementById('deal-buyer-inn') || document.getElementById('prep-buyer-inn');
      if (inn) {
        inn.focus?.();
        inn.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
        return true;
      }
      return !!document.querySelector('[data-deal-section="items"], .form-org-legal');
    });
    return;
  }
  if (g === 'deal:qr') {
    afterDeal(() => activateDealTab('qr') || activateDealTab('legal-pay'));
    return;
  }
  if (g === 'structure') {
    openTab('structure:' + id, 'Структура');
    return;
  }
  if (g === 'create:workorder') {
    openTab('deal:' + id);
  }
}

function docCreateCheckRowHtml(item, kind, opts = {}) {
  const mark = kind === 'ok' ? '✓' : kind === 'block' ? '○' : '!';
  const cls = kind === 'ok' ? 'is-ok' : kind === 'block' ? 'is-block' : 'is-warn';
  const showGoto = opts.showGoto !== false && item.goto && kind !== 'ok';
  const btn = showGoto
    ? `<button type="button" class="doc-create-goto" data-goto="${esc(item.goto)}">Перейти</button>`
    : '';
  return `<li class="doc-create-check ${cls}">
    <span class="doc-create-check-mark" aria-hidden="true">${mark}</span>
    <span class="doc-create-check-text"><b>${esc(item.title)}</b>
      <span class="muted"> — ${esc(item.detail || '')}</span></span>
    ${btn}
  </li>`;
}

function docCreateChecklistHtml(check, opts = {}) {
  const row = (item, kind) => docCreateCheckRowHtml(item, kind, opts);
  return (
    (check.blockers.length
      ? `<p class="doc-create-gate-lead"><b>Не хватает для оформления</b></p>
         <ul class="doc-create-checks">${check.blockers.map((x) => row(x, 'block')).join('')}</ul>`
      : '') +
    (check.warnings.length
      ? `<p class="doc-create-gate-lead muted">${
          check.ready ? 'Имейте в виду' : 'Дополнительно'
        }</p>
         <ul class="doc-create-checks">${check.warnings.map((x) => row(x, 'warn')).join('')}</ul>`
      : '') +
    (check.ok.length
      ? `<p class="doc-create-gate-lead muted">Уже есть</p>
         <ul class="doc-create-checks">${check.ok.map((x) => row(x, 'ok')).join('')}</ul>`
      : '')
  );
}

async function loadSalesDocCreateExtra(dealId, action) {
  let shipExtra = {};
  if (action !== 'upd-ship') return shipExtra;
  try {
    const ready = await api(
      '/crm/deals/' + encodeURIComponent(dealId) + '/ship-readiness'
    );
    const st = ready.structure || {};
    const stock = ready.stock || {};
    shipExtra = {
      structureChecked: true,
      structureComplete: !!st.complete,
      structureMissing: Array.isArray(st.missing) ? st.missing : [],
      stockChecked: true,
      stockOk: !!stock.ok,
      stockMissing: Array.isArray(stock.missing) ? stock.missing : [],
      stockNeeds: Number(stock.needs_count) || 0,
    };
  } catch (_) {
    try {
      const tree = await loadDealDocTree(dealId);
      shipExtra = {
        structureChecked: true,
        structureComplete: !!(tree && tree.complete),
        structureMissing: Array.isArray(tree?.missing) ? tree.missing : [],
      };
    } catch (_) {
      /* ignore */
    }
  }
  return shipExtra;
}

/**
 * Экран подготовки УПД / Расходных внутри вкладки: чеклист + ИНН + оплата + создать.
 */
async function renderSalesDocCreatePrep(dealIdRaw, actionRaw) {
  const dealId = String(dealIdRaw || '').trim();
  const action = String(actionRaw || '').trim();
  if (!dealId || !action) {
    alert('Нет заказа или типа документа');
    return;
  }
  const tabId = 'prep:' + action + ':' + dealId;
  const titleLabel =
    action === 'upd-ship'
      ? 'Расходные'
      : SALES_TYPE_TAB[action] || SALES_TYPE_LABEL[action] || action;

  showForm();
  if (!state.tabs.find((t) => t.id === tabId)) {
    state.tabs.push({
      id: tabId,
      title: (titleLabel + ' · подготовка').slice(0, 40),
      closable: true,
    });
  }
  state.activeTab = tabId;
  renderTabs();
  highlightSection(sectionForTab('deal:' + dealId));
  setUrl(pathForTab('deal:' + dealId));

  view.innerHTML = formChrome(titleLabel + ' · подготовка', `<p class="muted">Загрузка…</p>`, {
    section: 'Заказ покупателя',
    entityKind: 'deal',
  });

  let deal = null;
  let shipExtra = {};
  let salesDocs = [];
  let stockOuts = [];
  let docTree = null;
  try {
    deal = await api('/crm/deals/' + encodeURIComponent(dealId));
    rememberDealHint(deal);
    salesDocs = deal.sales_docs || [];
    shipExtra = await loadSalesDocCreateExtra(dealId, action);
    stockOuts = await loadDealStockOuts(dealId);
    docTree = await loadDealDocTree(dealId);
  } catch (e) {
    view.innerHTML = formChrome(
      titleLabel + ' · подготовка',
      `<p class="muted">${esc(e.message || String(e))}</p>`,
      { section: 'Заказ покупателя' }
    );
    return;
  }

  const check = buildSalesDocCreateChecklist(deal, action, shipExtra);
  const listHtml = docCreateChecklistHtml(check, { showGoto: true });
  const inn = String(deal.buyer_inn || '').replace(/\D/g, '');
  const buyerName =
    String(deal.company_name || '').trim() ||
    String(deal.buyer_name || '').trim() ||
    '';
  const isLegal =
    Number(deal.is_legal_entity) === 1 ||
    String(deal.buyer_kind || '').toLowerCase() === 'legal' ||
    !!String(deal.company_name || '').trim() ||
    inn.length === 10;
  const paid =
    Number(deal.paid) === 1 ||
    String(deal.payment_status || '').toLowerCase() === 'paid';
  const xfers = await loadDealTransferOrders(dealId);
  const linkTabs = buildOrderLinkTabs({
    dealId,
    current: { kind: 'create', id: action },
    siblings: salesDocs,
    stockOuts,
    transferOrders: xfers,
    allowCreate: true,
    needContract: dealNeedsContract(deal),
    personNoUpd: !isLegal && !inn,
    ...chainIncompleteOpts(docTree),
  });
  // подсветить вкладку create:upd / create:upd-ship
  const activeCreateTab = 'create:' + action;

  const existingUpd = (salesDocs || []).find((d) => d && d.doc_type === 'upd' && d.id);
  const prepDocBar = existingUpd
    ? salesDocPdfBarHtml({
        id: existingUpd.id,
        prefix: 'prep',
        showOpenDoc: true,
        docTabLabel: 'УПД',
        showDeal: true,
        dealId,
      })
    : '';


  view.innerHTML = formChrome(
    titleLabel + ' · подготовка',
    `
    <div class="doc-prep-layout">
      <div class="doc-create-gate doc-prep-gate">
        ${
          check.ready
            ? existingUpd
              ? `<p class="muted" style="margin:0 0 10px">УПД готов — откройте или скачайте PDF сверху.</p>`
              : `<p class="muted" style="margin:0 0 10px">Данных достаточно — создаём УПД и открываем PDF…</p>`
            : `<p style="margin:0 0 10px">Закройте пункты ниже — заполните поля покупателя (ИНН, оплату) и сохраните. Когда всё готово, УПД создастся сам.</p>`
        }
        ${listHtml || '<p class="muted">Нет специальных требований.</p>'}
      </div>
      <div class="doc-prep-form panel">
        <h3 class="form-section-title" style="margin-top:0">Покупатель для ${esc(titleLabel)}</h3>
        <div class="form-grid">
          <label class="span-2">Наименование
            <input id="prep-buyer-name" value="${esc(buyerName)}" autocomplete="organization" />
          </label>
          <label>ИНН
            <input id="prep-buyer-inn" class="mono" value="${esc(inn)}" inputmode="numeric" maxlength="12" placeholder="10 или 12 цифр" />
          </label>
          <label style="display:flex;align-items:center;gap:8px;padding-top:22px">
            <input type="checkbox" id="prep-buyer-legal" ${isLegal ? 'checked' : ''} />
            Юрлицо / ИП
          </label>
        </div>
        <div class="doc-prep-actions">
          <span class="toolbar-group" role="group" aria-label="Покупатель">
            <span class="toolbar-group-label">Покупатель</span>
            <button type="button" id="prep-buyer-save">Сохранить</button>
          </span>
          <span class="toolbar-group" role="group" aria-label="Оплата">
            <span class="toolbar-group-label">Оплата</span>
            ${
              paid
                ? `<span class="badge">Отмечена</span>`
                : `<button type="button" id="prep-mark-paid">Отметить</button>`
            }
          </span>
          <span class="muted" id="prep-msg" style="font-size:12px"></span>
        </div>
        <p class="muted" style="margin:10px 0 0;font-size:12px;line-height:1.4">
          Сохранение обновляет заказ, документы и наименование в AmoCRM.
          ${
            existingUpd
              ? ' УПД уже есть — PDF в тулбаре сверху.'
              : !check.ready
                ? ' После закрытия блокирующих пунктов УПД создастся автоматически.'
                : ''
          }
        </p>
      </div>
    </div>`,
    {
      section: 'Заказ покупателя',
      entityKind: 'deal',
      pageTabs: linkTabs,
      activePageTab: activeCreateTab,
      hintBar: dealHintBarHtml(deal),
      toolbar: `
        <span class="muted" id="prep-toolbar-msg" style="font-size:12px">${
          existingUpd
            ? 'УПД ' + esc(existingUpd.number || '') + ' — открыть / скачать'
            : check.ready
              ? 'Создаём и открываем PDF…'
              : 'Сначала закройте пункты чеклиста'
        }</span>
        <div class="grow"></div>
        ${prepDocBar}
      `,
    }
  );
  bindFormChrome(() => openTab('deal:' + dealId));
  bindDealHintBar(dealId);
  bindOrderLinkTabs(view, {
    dealId,
    onCreate: async (act, btn) => {
      if (act === 'upd' || act === 'upd-ship') {
        openTab('prep:' + act + ':' + dealId);
        return;
      }
      if (btn) btn.disabled = true;
      try {
        if (act === 'transfer') {
          await createDealTransferOrder(dealId, null);
          return;
        }
        await createLinkedSalesDoc(dealId, act, '', null);
      } catch (e) {
        alert(e.message || String(e));
        if (btn) btn.disabled = false;
      }
    },
  });

  view.querySelectorAll('.doc-create-goto[data-goto]').forEach((btn) => {
    btn.onclick = (e) => {
      e.preventDefault();
      const g = btn.getAttribute('data-goto');
      if (g === 'deal:buyer' || g === 'deal:qr' || g === 'deal:items') {
        // остаёмся на экране подготовки — фокус на поля
        if (g === 'deal:buyer') document.getElementById('prep-buyer-inn')?.focus();
        if (g === 'deal:qr') document.getElementById('prep-mark-paid')?.focus();
        return;
      }
      runSalesDocCreateGoto(dealId, g);
    };
  });

  const setMsg = (t) => {
    const el = document.getElementById('prep-msg');
    if (el) el.textContent = t || '';
  };

  document.getElementById('prep-buyer-save')?.addEventListener('click', async () => {
    const name = String(document.getElementById('prep-buyer-name')?.value || '').trim();
    const innVal = String(document.getElementById('prep-buyer-inn')?.value || '').replace(/\D/g, '');
    const legal = !!document.getElementById('prep-buyer-legal')?.checked;
    if (!name) {
      setMsg('Укажите наименование');
      return;
    }
    if (!legal && !innVal) {
      setMsg('Для УПД нужен ИНН или галка «Юрлицо / ИП»');
      return;
    }
    if (innVal && innVal.length !== 10 && innVal.length !== 12) {
      setMsg('ИНН: 10 (юрлицо) или 12 (ИП/физлицо) цифр');
      return;
    }
    setMsg('Сохраняем…');
    try {
      await api('/crm/deals/' + encodeURIComponent(dealId) + '/buyer', {
        method: 'PATCH',
        body: JSON.stringify({
          buyer_name: name,
          company_name: legal ? name : '',
          buyer_inn: innVal,
          is_legal_entity: legal || innVal.length === 10 ? 1 : 0,
          buyer_kind: legal || innVal.length === 10 ? 'legal' : 'person',
        }),
      });
      setMsg('Сохранено');
      setTimeout(() => renderSalesDocCreatePrep(dealId, action), 250);
    } catch (e) {
      setMsg(e.message || String(e));
      alert(e.message || String(e));
    }
  });

  document.getElementById('prep-mark-paid')?.addEventListener('click', async () => {
    if (!confirm('Отметить заказ как оплаченный?')) return;
    setMsg('Отмечаем оплату…');
    try {
      await api('/crm/deals/' + encodeURIComponent(dealId) + '/mark-paid', {
        method: 'POST',
        body: '{}',
      });
      setMsg('Оплата отмечена');
      setTimeout(() => renderSalesDocCreatePrep(dealId, action), 250);
    } catch (e) {
      setMsg(e.message || String(e));
      alert(e.message || String(e));
    }
  });

  if (existingUpd?.id) {
    bindSalesDocPdfBar({
      id: existingUpd.id,
      prefix: 'prep',
      dealId,
      docTabLabel: 'УПД',
    });
    const openKey = 'prep-pdf:' + existingUpd.id;
    if (state._prepAutoKey !== openKey) {
      state._prepAutoKey = openKey;
      setTimeout(() => openSalesPdf(existingUpd.id), 120);
    }
  } else if (check.ready) {
    const autoKey = 'prep-create:' + dealId + ':' + action;
    if (state._prepAutoKey !== autoKey) {
      state._prepAutoKey = autoKey;
      setTimeout(async () => {
        const tMsg = document.getElementById('prep-toolbar-msg');
        setMsg('Создание…');
        if (tMsg) tMsg.textContent = 'Создаём и открываем PDF…';
        try {
          const name = String(document.getElementById('prep-buyer-name')?.value || '').trim();
          const innVal = String(document.getElementById('prep-buyer-inn')?.value || '').replace(/\D/g, '');
          const legal = !!document.getElementById('prep-buyer-legal')?.checked;
          if (name) {
            await api('/crm/deals/' + encodeURIComponent(dealId) + '/buyer', {
              method: 'PATCH',
              body: JSON.stringify({
                buyer_name: name,
                company_name: legal ? name : String(deal.company_name || ''),
                buyer_inn: innVal,
                is_legal_entity: legal || innVal.length === 10 ? 1 : 0,
                buyer_kind: legal || innVal.length === 10 ? 'legal' : 'person',
              }),
            });
          }
          const r = await createLinkedSalesDoc(dealId, action, '', null);
          // upd-ship: createLinkedSalesDoc может уйти на расходную — PDF УПД откроем явно
          const updId = r?.upd?.id || r?.doc?.id;
          if (updId && action === 'upd-ship') {
            setTimeout(() => openSalesPdf(updId), 150);
          }
        } catch (e) {
          state._prepAutoKey = '';
          setMsg(e.message || String(e));
          if (tMsg) tMsg.textContent = e.message || String(e);
          alert(e.message || String(e));
        }
      }, 80);
    }
  }
}

/**
 * Лайтбокс: чего не хватает для УПД/счёта/ЗН… → дозаполнить или создать.
 */
async function openSalesDocCreateGate(opts = {}) {
  const dealId = String(opts.dealId || '').trim();
  const action = String(opts.action || '').trim();
  if (!dealId || !action) throw new Error('Нет заказа или типа документа');
  let deal = null;
  let shipExtra = {};
  try {
    deal = await api('/crm/deals/' + encodeURIComponent(dealId));
    rememberDealHint(deal);
  } catch (e) {
    throw new Error(e.message || 'Не удалось загрузить заказ');
  }
  shipExtra = await loadSalesDocCreateExtra(dealId, action);
  const check = buildSalesDocCreateChecklist(deal, action, shipExtra);
  const list = docCreateChecklistHtml(check);

  return new Promise((resolve) => {
    openCreateLightbox({
      title: check.label + ' — готовность',
      wide: true,
      bodyHtml: `<div class="doc-create-gate">${
        check.ready
          ? `<p class="muted" style="margin:0 0 10px">${
              action === 'upd-ship' && check.warnings.some((w) => String(w.id || '').startsWith('structure'))
                ? 'Создать можно, но в структуре есть замечания — лучше закрыть их или открыть «Структура».'
                : 'Можно создавать. Проверьте пункты ниже и подтвердите.'
            }</p>`
          : `<p style="margin:0 0 10px">Создать пока нельзя — закройте пункты ниже (кнопка «Перейти»).</p>`
      }${list || '<p class="muted">Нет специальных требований.</p>'}</div>`,
      submitLabel: check.ready
        ? action === 'upd-ship'
          ? 'Создать УПД + расходную'
          : 'Создать «' + check.label + '»'
        : 'Создать нельзя',
      submitDisabled: !check.ready,
      cancelLabel: check.ready ? 'Отмена' : 'Закрыть',
      onMount: (root) => {
        root.querySelectorAll('.doc-create-goto[data-goto]').forEach((btn) => {
          btn.onclick = (e) => {
            e.preventDefault();
            runSalesDocCreateGoto(dealId, btn.getAttribute('data-goto'));
            resolve({ created: false, navigated: true });
          };
        });
      },
      onSubmit: async (_root, setMsg) => {
        if (!check.ready) {
          setMsg('Сначала закройте пункты «Не хватает»');
          return;
        }
        setMsg('Создание…');
        closeCreateLightbox();
        if (typeof opts.onCreate === 'function') {
          await opts.onCreate(action);
        } else {
          await createLinkedSalesDoc(
            dealId,
            action,
            opts.organizationId || '',
            opts.msgEl || null
          );
        }
        resolve({ created: true });
      },
    });
    const lb = document.getElementById('create-lightbox');
    const cancel = lb?.querySelector('#create-lb-cancel');
    const x = lb?.querySelector('#create-lb-x');
    const onClose = () => resolve({ created: false });
    if (cancel) {
      const prev = cancel.onclick;
      cancel.onclick = () => {
        if (typeof prev === 'function') prev();
        else closeCreateLightbox();
        onClose();
      };
    }
    if (x) {
      const prev = x.onclick;
      x.onclick = () => {
        if (typeof prev === 'function') prev();
        else closeCreateLightbox();
        onClose();
      };
    }
  });
}

/**
 * Создать документ продажи из заказа (счёт / ЗН / УПД / СФ / договор / УПД+расход).
 * action: invoice|workorder|upd|sf|contract|upd-ship
 * Сначала API, потом карточка; PDF — отложенно (без about:blank — из‑за него UI «зависал»).
 */
async function createLinkedSalesDoc(dealId, action, organizationId, msgEl) {
  const deal = String(dealId || '').trim();
  if (!deal) throw new Error('Нет заказа покупателя');
  const act = String(action || '').trim();
  const setMsg = (t) => {
    if (msgEl) msgEl.textContent = t;
  };
  const goDoc = (doc, fallbackLabel) => {
    if (!doc?.id) return;
    const label =
      SALES_TYPE_TAB[doc.doc_type] ||
      SALES_TYPE_LABEL[doc.doc_type] ||
      fallbackLabel ||
      'Документ';
    openTab('sales:' + doc.id, String(label).slice(0, 40));
  };
  if (act === 'upd-ship') {
    setMsg('УПД + списание…');
    const r = await api('/sales-docs/upd-and-writeoff-from-deal', {
      method: 'POST',
      body: JSON.stringify({
        deal_id: deal,
        organization_id: organizationId || undefined,
      }),
    });
    const doc = r.upd;
    setMsg(
      (doc?.number ? 'УПД ' + doc.number : 'УПД') +
        (r.stock_doc_number ? ' · расходная ' + r.stock_doc_number : '') +
        (r.stock_note ? ' — ' + r.stock_note : '')
    );
    // Вкладка «Расходные» — открываем расходную, если списание прошло; иначе УПД.
    if (r.stock_doc_id) {
      openTab('doc:' + r.stock_doc_id, 'Расходные');
    } else {
      goDoc(doc, 'УПД');
    }
    return r;
  }
  const docType = act;
  if (!['invoice', 'workorder', 'upd', 'sf', 'contract'].includes(docType)) {
    throw new Error('Неизвестный тип документа');
  }
  setMsg('Создание…');
  const r = await api('/sales-docs/from-deal', {
    method: 'POST',
    body: JSON.stringify({
      deal_id: deal,
      doc_type: docType,
      organization_id: organizationId || undefined,
    }),
  });
  const doc = r.doc;
  setMsg('Создано: ' + (doc?.number || SALES_TYPE_TAB[docType] || ''));
  goDoc(doc, SALES_TYPE_TAB[docType] || docType);
  // ЗН: PDF только когда уже есть гос. номер; иначе сначала экран «Авто»
  if (doc?.id && docType === 'workorder' && String(doc.car_plate || '').trim()) {
    setTimeout(() => openSalesPdf(doc.id), 150);
  }
  if (doc?.id && docType === 'upd') {
    setTimeout(() => openSalesPdf(doc.id), 150);
  }
  return r;
}

let _orderLinkCreating = false;

/** Клики по вкладкам sales:/deal:/create: — переход или создание. */
function bindOrderLinkTabs(root, opts = {}) {
  const scope = root || view;
  if (!scope) return;
  const onCreate = typeof opts.onCreate === 'function' ? opts.onCreate : null;
  // Только верхняя полоса form-chrome, не radio-pills внутри тела
  const bar = scope.querySelector('.form-chrome > .form-pagetabs');
  if (!bar) return;
  bar.querySelectorAll('[data-pagetab]').forEach((btn) => {
    const tid = String(btn.dataset.pagetab || '');
    if (tid.startsWith('create:')) {
      btn.onclick = async () => {
        if (!onCreate || _orderLinkCreating || btn.disabled) return;
        const action = tid.slice('create:'.length);
        const dealId = String(opts.dealId || '').trim();
        // УПД / Расходные — экран подготовки внутри вкладки (ИНН, оплата, чеклист)
        if ((action === 'upd' || action === 'upd-ship') && dealId) {
          const label =
            action === 'upd-ship'
              ? 'Расходные · подготовка'
              : (SALES_TYPE_TAB.upd || 'УПД') + ' · подготовка';
          openTab('prep:' + action + ':' + dealId, label);
          return;
        }
        const gated = ['invoice', 'workorder', 'contract', 'sf'].includes(action);
        // счёт / ЗН / договор — лайтбокс «чего не хватает»
        if (gated && dealId) {
          _orderLinkCreating = true;
          btn.disabled = true;
          try {
            await openSalesDocCreateGate({
              dealId,
              action,
              organizationId: opts.organizationId || '',
              msgEl: opts.msgEl || null,
              onCreate: async (act) => onCreate(act, btn),
            });
          } catch (e) {
            alert(e.message || String(e));
          } finally {
            _orderLinkCreating = false;
            if (btn.isConnected) btn.disabled = false;
          }
          return;
        }
        const label = String(
          (btn.querySelector('.pagetab-label') || btn).textContent || ''
        )
          .replace(/\s+/g, ' ')
          .trim();
        // Confirm до disable — иначе после «Отмена» вкладка остаётся мёртвой.
        if (action === 'upd-ship') {
          if (
            !confirm(
              'Создать УПД (товары и услуги) и провести расходную — списание товаров со склада?\nУслуги в расходную не входят.'
            )
          ) {
            return;
          }
        } else if (action === 'workorder') {
          if (
            !confirm(
              'Создать заказ-наряд?\nСначала заполните автомобиль на карточке ЗН — затем можно скачать PDF.'
            )
          ) {
            return;
          }
        } else if (action === 'contract') {
          if (!confirm('Создать договор купли-продажи по этому заказу?')) return;
        } else if (action !== 'transfer') {
          if (!confirm('Создать документ «' + (label || 'Документ') + '»?')) return;
        }
        _orderLinkCreating = true;
        btn.disabled = true;
        const lab = btn.querySelector('.pagetab-label');
        const prevLabel = lab ? lab.textContent : '';
        if (lab) lab.textContent = '…';
        try {
          await onCreate(action, btn);
        } finally {
          _orderLinkCreating = false;
          // после успеха openTab уничтожит кнопку; при отмене/ошибке — вернуть
          if (btn.isConnected) {
            btn.disabled = false;
            if (lab) lab.textContent = prevLabel;
          }
        }
      };
      return;
    }
    if (
      !tid.startsWith('sales:') &&
      !tid.startsWith('deal:') &&
      !tid.startsWith('doc:') &&
      !tid.startsWith('history:') &&
      !tid.startsWith('structure:') &&
      !tid.startsWith('xfer:')
    ) {
      return;
    }
    btn.onclick = () => {
      if (tid === state.activeTab) return;
      const label = (btn.querySelector('.pagetab-label') || btn).textContent || '';
      openTab(tid, String(label).trim().slice(0, 40));
    };
  });
}

/** Общая история заказа покупателя — отдельная вкладка цепочки. */
async function renderDealOrderHistory(dealIdRaw) {
  const dealId = String(dealIdRaw || '').trim();
  if (!dealId) return;
  await refreshRefs();
  const tabId = 'history:' + dealId;
  let tab = state.tabs.find((t) => t.id === tabId);
  if (!tab) {
    tab = { id: tabId, title: ('История · ' + dealId).slice(0, 48), closable: true };
    state.tabs.push(tab);
  } else {
    tab.title = ('История · ' + dealId).slice(0, 48);
  }
  state.activeTab = tabId;
  renderTabs();
  showForm();
  highlightSection(sectionForTab(tabId));
  setUrl(pathForTab(tabId));

  let salesDocs = [];
  let stockOuts = [];
  let docTree = null;
  let seed = null;
  let histFiscalAlert = { alert: false, tip: '' };
  let histNeedContract = true;
  let hintDeal = null;
  try {
    const d = await api('/crm/deals/' + encodeURIComponent(dealId));
    hintDeal = d;
    rememberDealHint(d);
    salesDocs = d.sales_docs || [];
    histNeedContract = dealNeedsContract(d);
    const [returns, outs] = await Promise.all([
      loadDealStockReturns(dealId),
      loadDealStockOuts(dealId),
    ]);
    stockOuts = outs;
    histFiscalAlert = dealFiscalAlertInfo(d, returns, outs);
    seed = {
      created_at: d.created_at,
      actor_name: dealCreatorName(d),
      summary:
        'Заказ создан / из Amo' +
        (dealCreatorName(d) ? ' · ' + dealCreatorName(d) : ''),
    };
  } catch (_) {
    /* ignore */
  }
  if (!stockOuts.length) stockOuts = await loadDealStockOuts(dealId);
  const histXfers = await loadDealTransferOrders(dealId);
  docTree = await loadDealDocTree(dealId);
  if (!hintDeal) hintDeal = await loadDealForHintBar(dealId);
  const linkTabs = buildOrderLinkTabs({
    dealId,
    current: { kind: 'history', id: dealId },
    siblings: salesDocs,
    stockOuts,
    transferOrders: histXfers,
    allowCreate: true,
    needContract: histNeedContract,
    invoiceAlert: histFiscalAlert.alert,
    invoiceAlertTip: histFiscalAlert.tip,
    ...chainIncompleteOpts(docTree),
  });

  view.innerHTML = formChrome(
    'История · заказ ' + dealId,
    `
    <p class="muted" style="margin:0 0 12px">
      Все действия по заказу покупателя и связанным документам: счета, УПД, СФ, договоры, расходные, оплаты, чеки.
    </p>
    <div id="order-history" class="entity-history"><p class="muted" style="margin:0">Загрузка…</p></div>`,
    {
      section: 'Заказ покупателя',
      entityKind: 'deal',
      pageTabs: linkTabs,
      activePageTab: tabId,
      hintBar: dealHintBarHtml(hintDeal),
    }
  );
  bindFormChrome(() => openTab('deal:' + dealId));
  bindDealHintBar(dealId);
  bindOrderLinkTabs(view, {
    dealId,
    onCreate: async (action, btn) => {
      if (btn) btn.disabled = true;
      try {
        if (action === 'transfer') {
          await createDealTransferOrder(dealId, null);
          return;
        }
        await createLinkedSalesDoc(dealId, action, '', null);
        setTimeout(() => renderDealOrderHistory(dealId), 400);
      } catch (e) {
        alert(e.message || String(e));
        if (btn) btn.disabled = false;
      }
    },
  });
  fillDealChainHistory('order-history', dealId, { seed });
}

/** Расходные накладные по заказу покупателя. */
async function loadDealStockOuts(dealId) {
  const id = String(dealId || '').trim();
  if (!id) return [];
  try {
    const r = await api(
      withCompanyId('/docs?type=out&deal_id=' + encodeURIComponent(id) + '&limit=50')
    );
    return Array.isArray(r) ? r : r.items || [];
  } catch (_) {
    return [];
  }
}

const DEAL_TAB_KEY = 'wms.deal.tab.v1';

function loadDealTabId() {
  try {
    return String(localStorage.getItem(DEAL_TAB_KEY) || '').trim();
  } catch (_) {
    return '';
  }
}

function saveDealTabId(id) {
  try {
    localStorage.setItem(DEAL_TAB_KEY, String(id || ''));
  } catch (_) {
    /* ignore */
  }
}

function orderChainStatusBadge(tree) {
  if (!tree || !tree.root) {
    return '<span class="badge order-chain-badge is-na">Цепочка недоступна</span>';
  }
  const missing = Array.isArray(tree.missing) ? tree.missing : [];
  if (tree.complete) {
    return '<span class="badge order-chain-badge is-ok">Цепочка полная</span>';
  }
  return `<span class="badge order-chain-badge is-miss">Не хватает: ${esc(
    missing.join(', ') || '—'
  )}</span>`;
}

function renderOrderDocTreeBody(tree, opts = {}) {
  if (!tree || !tree.root) {
    return '<p class="muted" style="margin:0">Дерево документов недоступно.</p>';
  }
  const dealId = String(opts.dealId || '').trim();
  const createActionFor = (kind) => {
    if (kind === 'transfer_order') return 'transfer';
    if (kind === 'out') return 'upd-ship';
    return '';
  };
  const walk = (node, depth) => {
    if (!node) return '';
    const pad = Math.min(depth, 6) * 16;
    const mark = node.present
      ? node.posted
        ? '<span class="doc-tree-mark is-ok" title="Проведён">✓</span>'
        : '<span class="doc-tree-mark is-draft" title="Есть">●</span>'
      : '<span class="doc-tree-mark is-miss" title="Нет">○</span>';
    const openAttr =
      node.open && node.open.type && node.open.id
        ? `data-tree-open="${esc(node.open.type)}" data-tree-id="${esc(node.open.id)}"`
        : '';
    const createAct = !node.present && dealId ? createActionFor(String(node.kind || '')) : '';
    const createAttr = createAct
      ? `data-tree-create="${esc(createAct)}" data-tree-deal="${esc(dealId)}"`
      : '';
    const clickable = openAttr ? 'clickable' : '';
    const missCls = node.required && !node.present ? ' is-required-miss' : '';
    const amt =
      Number(node.amount) > 0
        ? `<span class="mono muted">${formatMoney(node.amount)}</span>`
        : '';
    const numHtml = createAct
      ? `<button type="button" class="doc-tree-add" ${createAttr} title="Создать: ${esc(
          node.label || ''
        )}" data-tip="Создать" aria-label="Создать ${esc(node.label || '')}">+</button>`
      : `<span class="mono">${esc(node.number || '—')}</span>`;
    const row = `<div class="doc-tree-row ${clickable}${missCls}" style="padding-left:${pad}px" ${openAttr}>
      ${mark}
      <span class="doc-tree-label">${esc(node.label)}</span>
      ${numHtml}
      <span class="muted">${esc(String(node.doc_date || '').slice(0, 10))}</span>
      ${amt}
    </div>`;
    const kids = Array.isArray(node.children)
      ? node.children.map((c) => walk(c, depth + 1)).join('')
      : '';
    return row + kids;
  };
  return `
    <div class="doc-tree">${walk(tree.root, 0)}</div>
    <p class="muted" style="margin:10px 0 0;font-size:11px">${esc(
      tree.note ||
        'Обязательные: заказ → перемещение → расходная → операция по карте (при оплате). Клик — открыть. «+» — создать недостающее.'
    )}</p>`;
}

/**
 * Сверху карточки больше не показываем — структура на отдельной вкладке.
 * Функция оставлена для совместимости (пустой вывод).
 */
function renderOrderChainBar(_tree, _opts = {}) {
  return '';
}

/** Вкладка «Структура» — дерево документов заказа. */
async function renderDealOrderStructure(dealIdRaw) {
  const dealId = String(dealIdRaw || '').trim();
  if (!dealId) return;
  await refreshRefs();
  const tabId = 'structure:' + dealId;
  let tab = state.tabs.find((t) => t.id === tabId);
  if (!tab) {
    tab = { id: tabId, title: ('Структура · ' + dealId).slice(0, 48), closable: true };
    state.tabs.push(tab);
  } else {
    tab.title = ('Структура · ' + dealId).slice(0, 48);
  }
  state.activeTab = tabId;
  renderTabs();
  showForm();
  highlightSection(sectionForTab(tabId));
  setUrl(pathForTab(tabId));

  let salesDocs = [];
  let stockOuts = [];
  let transferOrders = [];
  let docTree = null;
  let needContract = true;
  let fiscalAlert = { alert: false, tip: '' };
  let hintDeal = null;
  try {
    const d = await api('/crm/deals/' + encodeURIComponent(dealId));
    hintDeal = d;
    rememberDealHint(d);
    salesDocs = d.sales_docs || [];
    needContract = dealNeedsContract(d);
    fiscalAlert = dealFiscalAlertInfo(
      d,
      await loadDealStockReturns(dealId),
      await loadDealStockOuts(dealId)
    );
  } catch (_) {
    /* ignore */
  }
  stockOuts = await loadDealStockOuts(dealId);
  transferOrders = await loadDealTransferOrders(dealId);
  docTree = await loadDealDocTree(dealId);
  if (!hintDeal) hintDeal = await loadDealForHintBar(dealId);
  const incomplete = !!(docTree && docTree.root && !docTree.complete);
  const missingTip =
    incomplete && Array.isArray(docTree.missing) && docTree.missing.length
      ? 'Не хватает: ' + docTree.missing.join(', ')
      : '';
  const linkTabs = buildOrderLinkTabs({
    dealId,
    current: { kind: 'structure', id: dealId },
    siblings: salesDocs,
    stockOuts,
    transferOrders,
    allowCreate: true,
    needContract,
    invoiceAlert: fiscalAlert.alert,
    invoiceAlertTip: fiscalAlert.tip,
    chainIncomplete: incomplete,
    chainIncompleteTip: missingTip,
  });

  view.innerHTML = formChrome(
    'Структура · заказ ' + dealId,
    `
    <div class="order-chain-page">
      <div class="order-chain-page-head">
        ${orderChainStatusBadge(docTree)}
        <span class="muted" style="font-size:12px">${
          incomplete
            ? esc(missingTip || 'Цепочка неполная')
            : docTree && docTree.complete
              ? 'Цепочка полная'
              : '—'
        }</span>
      </div>
      <div class="doc-tree-toolbar" style="margin:10px 0">
        <button type="button" class="order-chain-ensure" data-deal="${esc(
          dealId
        )}" title="Создать недостающие: заказ на перемещение, операция по карте">Досоздать цепочку</button>
        <span class="muted order-chain-msg" style="font-size:12px"></span>
      </div>
      ${renderOrderDocTreeBody(docTree, { dealId })}
    </div>`,
    {
      section: 'Заказ покупателя',
      entityKind: 'deal',
      pageTabs: linkTabs,
      activePageTab: tabId,
      hintBar: dealHintBarHtml(hintDeal),
    }
  );
  bindFormChrome(() => openTab('deal:' + dealId));
  bindDealHintBar(dealId);
  bindOrderLinkTabs(view, {
    dealId,
    onCreate: async (action, btn) => {
      if (btn) btn.disabled = true;
      try {
        if (action === 'transfer') {
          await createDealTransferOrder(dealId, null);
          return;
        }
        await createLinkedSalesDoc(dealId, action, '', null);
        setTimeout(() => renderDealOrderStructure(dealId), 400);
      } catch (e) {
        alert(e.message || String(e));
        if (btn) btn.disabled = false;
      }
    },
  });
  bindOrderChainBar(view, dealId, () => renderDealOrderStructure(dealId));
}

function bindOrderChainBar(root, dealId, onRefresh) {
  const scope = root || view;
  const id = String(dealId || '').trim();
  if (!scope || !id) return;
  scope.querySelectorAll('[data-tree-open]').forEach((el) => {
    if (el.dataset.chainBound === '1') return;
    el.dataset.chainBound = '1';
    el.onclick = () => {
      const typ = el.getAttribute('data-tree-open') || '';
      const oid = el.getAttribute('data-tree-id') || '';
      if (!oid) return;
      if (typ === 'deal') openTab('deal:' + oid);
      else if (typ === 'doc') openTab('doc:' + oid);
      else if (typ === 'sales_doc') openTab('sales:' + oid);
      else if (typ === 'warehouse_task') openTab('wh-tasks');
      else if (typ === 'transfer_order') openTab('xfer:' + oid, 'Заказ на перемещение');
      else if (typ === 'card_op') openTab('card-ops');
      else if (typ === 'sto_transfer') openTab('deal:' + id);
    };
  });
  scope.querySelectorAll('[data-tree-create]').forEach((btn) => {
    if (btn.dataset.chainBound === '1') return;
    btn.dataset.chainBound = '1';
    btn.onclick = async (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (btn.disabled) return;
      const action = String(btn.getAttribute('data-tree-create') || '').trim();
      const deal = String(btn.getAttribute('data-tree-deal') || id).trim();
      if (!action || !deal) return;
      const wrap =
        btn.closest('.order-chain-page') ||
        btn.closest('.order-chain-bar') ||
        btn.parentElement;
      const msg = wrap ? wrap.querySelector('.order-chain-msg') : null;
      btn.disabled = true;
      if (msg) msg.textContent = 'Создаём…';
      try {
        if (action === 'transfer') {
          await createDealTransferOrder(deal, msg);
        } else {
          await createLinkedSalesDoc(deal, action, '', msg);
        }
        if (typeof onRefresh === 'function') onRefresh();
        else setTimeout(() => renderDealOrderStructure(deal), 300);
      } catch (err) {
        const text = err && err.message ? err.message : String(err || 'Ошибка');
        if (msg) msg.textContent = text;
        else alert(text);
        btn.disabled = false;
      }
    };
  });
  scope.querySelectorAll('.order-chain-ensure').forEach((btn) => {
    if (btn.dataset.chainBound === '1') return;
    btn.dataset.chainBound = '1';
    btn.onclick = async () => {
      const wrap =
        btn.closest('.order-chain-bar') ||
        btn.closest('.order-chain-page') ||
        btn.parentElement;
      const msg = wrap ? wrap.querySelector('.order-chain-msg') : null;
      btn.disabled = true;
      if (msg) msg.textContent = 'Создаём…';
      try {
        const r = await api('/crm/deals/' + encodeURIComponent(id) + '/doc-chain/ensure', {
          method: 'POST',
          body: JSON.stringify({}),
        });
        const created = Array.isArray(r.created) ? r.created : [];
        if (msg) {
          msg.textContent = created.length
            ? 'Создано: ' + created.join(', ')
            : r.tree?.complete
              ? 'Уже полная'
              : 'Ещё не хватает: ' + ((r.tree?.missing || []).join(', ') || '—');
        }
        if (typeof onRefresh === 'function') onRefresh(r.tree);
      } catch (e) {
        if (msg) msg.textContent = e.message || 'Ошибка';
      } finally {
        btn.disabled = false;
      }
    };
  });
}

async function loadDealDocTree(dealId) {
  const id = String(dealId || '').trim();
  if (!id) return null;
  try {
    return await api('/crm/deals/' + encodeURIComponent(id) + '/doc-tree');
  } catch (_) {
    return null;
  }
}

function chainIncompleteOpts(tree) {
  const incomplete = !!(tree && tree.root && !tree.complete);
  const tip =
    incomplete && Array.isArray(tree.missing) && tree.missing.length
      ? 'Не хватает: ' + tree.missing.join(', ')
      : '';
  return {
    chainIncomplete: incomplete || undefined,
    chainIncompleteTip: tip || undefined,
  };
}

/** Собрать закладку (во время сборки HTML карточки сделки). */
function dealFold(id, title, bodyHtml, prefer = false) {
  if (!state._dealTabCollect) state._dealTabCollect = [];
  state._dealTabCollect.push({
    id: String(id || ''),
    title: String(title || ''),
    bodyHtml: String(bodyHtml || ''),
    prefer: !!prefer,
  });
  return '';
}

/**
 * Секции карточки сделки (без ряда вкладок deal-tabs-nav).
 * tabs: [{ id, title, bodyHtml, prefer? }]
 */
function dealTabs(tabs) {
  const order = [
    'items',
    'sales-docs',
    'qr',
    'legal-pay',
    'fiscal',
    'pay-questions',
    'item-pdfs',
  ];
  const list = (Array.isArray(tabs) ? tabs : [])
    .filter((t) => t && t.id && t.id !== 'sto')
    .slice()
    .sort((a, b) => {
      const ia = order.indexOf(a.id);
      const ib = order.indexOf(b.id);
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
    });
  if (!list.length) return '';
  const panels = list
    .map(
      (t) =>
        `<section class="deal-section" data-deal-section="${esc(t.id)}" id="deal-section-${esc(t.id)}">
          <h3 class="deal-section-title">${esc(t.title)}</h3>
          <div class="deal-section-body">${t.bodyHtml}</div>
        </section>`
    )
    .join('');
  return `<div class="deal-sections">${panels}</div>`;
}

function bindDealTabs(root) {
  /* вкладки убраны — секции всегда видны */
  void root;
}

/** Прокрутить к секции заказа (позиции / оплата / …). */
function activateDealTab(tabId) {
  const id = String(tabId || '').trim();
  if (!id || id === 'sto') return false;
  const el =
    view?.querySelector?.('[data-deal-section="' + id + '"]') ||
    document.getElementById('deal-section-' + id);
  if (!el) return false;
  el.scrollIntoView({ block: 'start', behavior: 'smooth' });
  el.classList.add('is-flash');
  setTimeout(() => el.classList.remove('is-flash'), 1200);
  return true;
}

async function renderDealDetail(id) {
  if (state._dealPayPollTimer) {
    clearTimeout(state._dealPayPollTimer);
    state._dealPayPollTimer = null;
  }
  state.dealId = id;
  await refreshRefs();
  const d = await api('/crm/deals/' + id);
  rememberDealHint(d);
  const title = String(d.name || '').trim() || 'Заказ №' + id;
  const tabId = 'deal:' + id;
  let tab = state.tabs.find((t) => t.id === tabId);
  if (!tab) {
    tab = { id: tabId, title: title.slice(0, 48), closable: true };
    state.tabs.push(tab);
  } else {
    tab.title = title.slice(0, 48);
  }
  state.activeTab = tabId;
  renderTabs();
  showForm();
  highlightSection(sectionForTab(tabId));
  setUrl(pathForTab(tabId));
  const items = d.items || [];
  const docs = d.documents || [];
  const salesDocs = d.sales_docs || [];
  const docTree = d.doc_tree || null;
  state._dealStockOuts = await loadDealStockOuts(id);
  const dealReturnDocs = await loadDealStockReturns(id);
  const dealXferDocs = await loadDealTransferOrders(id);
  const dealFiscalAlert = dealFiscalAlertInfo(d, dealReturnDocs, state._dealStockOuts);
  const payments = d.payments || [];
  const fiscal = d.fiscal_receipts || [];
  const payQuestions = d.pay_questions || [];
  const crmTasks = d.crm_tasks || [];
  const openCrmTasks = crmTasks.filter((t) => String(t.status || '') === 'open');
  const hasCompany = !!(String(d.company_id || '').trim() || String(d.company_name || '').trim());
  const innDigits = String(d.buyer_inn || '').replace(/\D/g, '');
  const rules = d.sale_rules || null;
  const isLegal = !!(
    (rules && rules.is_legal) ||
    d.is_legal_entity ||
    d.buyer_kind === 'legal' ||
    d.buyer_kind === 'partner' ||
    Number(d.is_partner) === 1 ||
    hasCompany ||
    innDigits.length === 10 ||
    innDigits.length === 12
  );
  const payByInvoice = dealPaysByInvoice(d);
  const payByLink = dealPaysByPaymentLink(d);
  const dealPaid =
    Number(d.paid) === 1 || String(d.payment_status || '').toLowerCase() === 'paid';
  const paySplit = d.payment_split || {};
  const dueTotal = Number(paySplit.due_total) || 0;
  const dueGoods = Number(paySplit.due_goods) || 0;
  const dueServices = Number(paySplit.due_services) || 0;
  const cashReceived =
    !!(rules && rules.cash_received) ||
    payments.some(
      (p) =>
        String(p.kind || '').toLowerCase() === 'cash' &&
        ['paid', 'confirmed', 'success', 'accepted'].includes(String(p.status || '').toLowerCase())
    );
  const cashOnSite =
    !!(rules && rules.cash_on_site) ||
    Number(d.is_sto) === 1 ||
    /автосервис|самовывоз/i.test(String(d.amo_channel || '')) ||
    String(d.ship_channel || '') === 'pickup' ||
    /налич/i.test(String(d.amo_pay_method || ''));
  const showAcceptCash = cashOnSite && dueTotal > 0.009;
  const itemsLocked = !!d.composition_locked;
  const itemsLockedReason =
    String(d.composition_locked_reason || '').trim() ||
    'Заказ оплачен — добавлять и удалять позиции нельзя';
  const roleLabel =
    (rules && rules.labels && rules.labels.buyer) ||
    (Number(d.is_partner) === 1 || d.buyer_kind === 'partner'
      ? 'партнёр'
      : isLegal
        ? d.buyer_kind === 'ip'
          ? 'ИП'
          : 'юрлицо'
        : 'физлицо');
  const payLabel = (rules && rules.labels && rules.labels.payment) || '';
  const fiscalLabel = (rules && rules.labels && rules.labels.fiscal) || '';
  const buyerLabel = [
    d.company_name || d.buyer_name,
    d.buyer_inn ? 'ИНН ' + d.buyer_inn : '',
    roleLabel,
    payLabel,
    fiscalLabel,
    rules && rules.credit_allowed ? 'кредит/отсрочка' : '',
    Number(paySplit.goods) > 0 || Number(paySplit.services) > 0
      ? 'товар ' +
        formatMoney(paySplit.paid_goods || 0) +
        '/' +
        formatMoney(paySplit.goods || 0) +
        (Number(paySplit.services) > 0
          ? ' · услуги ' +
            formatMoney(paySplit.paid_services || 0) +
            '/' +
            formatMoney(paySplit.services || 0)
          : '') +
        (dueTotal > 0.009 ? ' · доплата ' + formatMoney(dueTotal) : ' · оплачено')
      : '',
  ]
    .filter(Boolean)
    .join(' · ');
  state._dealTabCollect = [];
  const invoiceDoc = (salesDocs || []).find((s) => String(s.doc_type) === 'invoice');
  const orgLocked = !!invoiceDoc;
  const lockedOrgId = String(
    (invoiceDoc && invoiceDoc.organization_id) || state.dealOrgId || ''
  ).trim();
  if (orgLocked && lockedOrgId) state.dealOrgId = lockedOrgId;
  const dealCompanyId = String(
    (invoiceDoc && invoiceDoc.organization_company_id) ||
      d.org_company_id ||
      getFilterCompanyId() ||
      ''
  ).trim();
  const dealOrgContour = companyContourName(dealCompanyId);
  const lockedOrg =
    orgById(lockedOrgId) ||
    (invoiceDoc
      ? {
          short_name: invoiceDoc.organization_short,
          name: invoiceDoc.organization_name,
        }
      : null);
  const lockedLegalName =
    (lockedOrg && (lockedOrg.short_name || lockedOrg.name)) ||
    String((invoiceDoc && (invoiceDoc.organization_short || invoiceDoc.organization_name)) || '') ||
    '—';
  if (!state.companies || !state.companies.length) {
    try {
      const coData = await api('/company/companies');
      state.companies = (coData.items || []).filter((c) => Number(c.is_active) !== 0);
    } catch (_) {
      /* ignore */
    }
  }
  if (!orgLocked && dealCompanyId) {
    try {
      const orgData = await api(
        '/organizations?company_id=' + encodeURIComponent(dealCompanyId)
      );
      state.organizations = Array.isArray(orgData) ? orgData : orgData.items || [];
    } catch (_) {
      /* keep refreshRefs list */
    }
    const prefer = String(state.dealOrgId || '').trim();
    const inList = (state.organizations || []).some(
      (o) => String(o.id) === prefer && String(o.company_id || '') === dealCompanyId
    );
    if (!inList) state.dealOrgId = '';
  }
  view.innerHTML = formChrome(
    title,
    `
    ${renderOrgLegalBar(
      orgLocked
        ? {
            companyName: dealOrgContour,
            legalName: lockedLegalName,
            legalTip: String((lockedOrg && lockedOrg.name) || invoiceDoc.organization_name || ''),
            locked: true,
            lockedHint: 'После выписки счёта организацию и юрлицо менять нельзя',
          }
        : {
            companyName: dealOrgContour,
            companySelectId: 'deal-company',
            companySelectedId: dealCompanyId,
            legalSelectId: 'deal-org',
            legalSelectedId: state.dealOrgId || '',
            legalCompanyId: dealCompanyId,
            lockedHint: 'До выписки счёта можно сменить организацию и юрлицо',
          }
    )}
    <div class="form-grid">
      <label>ID<input class="mono" value="${esc(d.id)}" readonly /></label>
      <label>Сумма<input class="mono" value="${esc(formatMoney(d.price))}" readonly /></label>
      <label>Воронка<input value="${esc(d.pipeline_name || '—')}" readonly /></label>
      <label>Тип услуги<input value="${esc(
        [d.amo_channel, d.amo_sto].filter(Boolean).join(' · ') ||
          (Number(d.is_sto) === 1 ? 'СТО' : '') ||
          '—'
      )}" readonly title="Канал реализации / СТО из Amo" /></label>
      <label>Статус<input value="${esc(d.status_name || '—')}" readonly /></label>
      <label>Ответственный<input value="${esc(d.responsible_name || (d.responsible_user_id ? '#' + d.responsible_user_id : '—'))}" readonly /></label>
      <label>Покупатель<input value="${esc(buyerLabel || '—')}" readonly /></label>
      <label>Телефон<input value="${esc(formatPhoneField(d.buyer_phone || ''))}" readonly /></label>
      <label>В Учёте<input value="${esc(d.queued_to_1c ? 'Да · ' + (d.queue_status || '') + (d.queued_by ? ' · ' + d.queued_by : '') : 'Нет')}" readonly /></label>
      <label class="span-2" style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding-top:4px">
        <span style="display:inline-flex;align-items:center;gap:8px;font-weight:650">
          <input type="checkbox" id="deal-is-sto" ${Number(d.is_sto) === 1 ? 'checked' : ''} />
          СТО (заказ-наряд)
        </span>
        <span class="muted" style="font-size:11px" id="deal-sto-hint">${esc(
          (() => {
            const pack = Array.isArray(d.doc_pack_types) ? d.doc_pack_types : [];
            const labels = { invoice: 'счёт', workorder: 'заказ-наряд', upd: 'УПД' };
            const list = pack.map((t) => labels[t] || t).join(' + ') || '—';
            return 'Пакет: ' + list + ' · авто и СТС — в заказ-наряде';
          })()
        )}</span>
      </label>
    </div>
    <p class="muted" id="deal-msg" style="margin:0 0 8px;font-size:12px;min-height:1.2em"></p>
    ${
      payByInvoice
        ? dealFold(
            'legal-pay',
            isLegal ? 'Оплата · юрлицо' : 'Оплата · ИП',
            `<p class="muted" style="margin:0 0 10px">По счёту (PDF) — перевод на р/с, либо по ссылке: QR СБП, Сплит и карта.</p>
            <div class="toolbar" style="margin:0;flex-wrap:wrap;align-items:center">
              <button class="primary" type="button" id="deal-pay-link" ${
                Number(d.price) > 0 ? '' : 'disabled'
              } title="Страница оплаты: QR СБП + карта" data-tip="Ссылка на оплату (СБП + карта)">Ссылка · карта / СБП</button>
              ${
                payments.some(
                  (p) =>
                    p.qrc_id &&
                    !['paid', 'confirmed', 'success', 'accepted', 'cancelled', 'canceled'].includes(
                      String(p.status || '').toLowerCase()
                    )
                )
                  ? '<button type="button" id="deal-poll-pay" title="Опросить Точку по QR" data-tip="Проверить оплату в Точке">Проверить оплату</button>'
                  : ''
              }
            </div>`,
            true
          )
        : dealFold(
            'qr',
            `Оплата · физлицо · СБП (${payments.length})`,
            `<div class="toolbar" style="margin:0 0 10px;flex-wrap:wrap;align-items:center">
      ${
        payByLink
          ? `<button class="primary" type="button" id="deal-pay-link" ${Number(d.price) > 0 ? '' : 'disabled'} title="Страница оплаты: QR СБП Точка + карта Яндекс" data-tip="Ссылка на оплату (СБП + карта)">Ссылка на оплату</button>
      ${
        payments.some(
          (p) =>
            p.qrc_id &&
            !['paid', 'confirmed', 'success', 'accepted', 'cancelled', 'canceled'].includes(
              String(p.status || '').toLowerCase()
            )
        )
          ? '<button type="button" id="deal-poll-pay" title="Опросить Точку по QR" data-tip="Проверить оплату в Точке">Проверить оплату</button>'
          : ''
      }`
          : ''
      }
      ${
        showAcceptCash
          ? `<button type="button" id="deal-accept-cash" class="primary" title="Принять наличные" data-tip="Принято наличными">Принято налом</button>`
          : cashReceived && dealPaid
            ? '<span class="muted" style="font-size:12px;font-weight:600;color:var(--ok,#047857)">✓ Принято налом</span>'
            : cashReceived && !dealPaid
              ? '<span class="muted" style="font-size:12px">Частично налом · есть доплата</span>'
              : ''
      }
    </div>
    ${
      payments.length
        ? `<table class="data-table is-dense">
        <thead><tr><th>Дата</th><th>Способ</th><th>Сумма</th><th>Статус</th><th>QR</th></tr></thead>
        <tbody>
          ${payments
            .map((p) => {
              const st = String(p.status || '').toLowerCase();
              const paid = ['paid', 'confirmed', 'success', 'accepted'].includes(st);
              const cancelled = ['cancelled', 'canceled', 'superseded'].includes(st);
              const kind = String(p.kind || '').toLowerCase();
              let covers = '';
              try {
                const meta = typeof p.meta_json === 'string' ? JSON.parse(p.meta_json || '{}') : p.meta_json || {};
                covers = String(meta.covers || '').toLowerCase();
              } catch (_) {
                covers = '';
              }
              const coversLabel =
                covers === 'goods' || covers === 'product'
                  ? 'товар'
                  : covers === 'services' || covers === 'service'
                    ? 'услуги'
                    : covers === 'all'
                      ? 'всё'
                      : '';
              const kindLabel =
                kind === 'cash'
                  ? 'Нал' + (coversLabel ? ' · ' + coversLabel : '')
                  : kind === 'sbp_qr'
                    ? 'СБП' + (coversLabel ? ' · ' + coversLabel : '')
                    : kind === 'yandex' || kind === 'yandex_pay'
                      ? 'Карта'
                      : kind || '—';
              const statusLabel = paid
                ? 'Оплачен'
                : cancelled
                  ? 'Отменён'
                  : st === 'notstarted' || st === 'created' || !st
                    ? 'Ожидает'
                    : String(p.status || '—');
              return `
            <tr data-payment="${esc(p.id)}">
              <td>${esc(formatDealDate(p.created_at) || String(p.created_at || '').slice(0, 16))}</td>
              <td>${esc(kindLabel)}</td>
              <td class="mono">${formatMoney(p.amount)}</td>
              <td>${paid ? '<span class="badge">' + esc(statusLabel) + '</span>' : esc(statusLabel)}</td>
              <td>${
                p.has_image
                  ? `<img src="/api/payments/${esc(p.id)}/image.png" alt="QR" width="96" height="96" style="background:#fff;border:1px solid #ddd;border-radius:8px" />`
                  : esc(p.qrc_id || (kind === 'cash' ? '—' : '—'))
              }</td>
            </tr>`;
            })
            .join('')}
        </tbody>
      </table>`
        : '<p class="muted" style="margin:0">Оплат ещё нет — создайте ссылку или на СТО отметьте наличные.</p>'
    }`,
            payments.length > 0
          )
    }
    ${
      payByLink
        ? dealFold(
            'fiscal',
            `Чеки (${fiscal.length})`,
            fiscal.length
              ? `<table>
        <thead><tr><th>Дата</th><th>Тип</th><th>Статус</th><th>Сумма</th><th></th></tr></thead>
        <tbody>
          ${fiscal
            .map((f) => {
              const kindLabel =
                f.kind === 'advance'
                  ? 'Предоплата'
                  : f.kind === 'full'
                    ? 'Полный'
                    : f.kind === 'refund_advance'
                      ? 'Возврат предоплаты'
                      : f.kind === 'refund'
                        ? 'Возврат'
                        : f.kind;
              const canRefund =
                (f.kind === 'advance' || f.kind === 'full') &&
                !['error', 'cancelled'].includes(String(f.status || ''));
              return `
            <tr>
              <td>${esc(String(f.created_at || '').slice(0, 19))}</td>
              <td>${esc(kindLabel)}${
                f.parent_receipt_id
                  ? `<div class="muted mono" style="font-size:11px">← ${esc(String(f.parent_receipt_id).slice(0, 8))}…</div>`
                  : ''
              }</td>
              <td>${esc(f.status)}${f.error ? ' · ' + esc(String(f.error).slice(0, 80)) : ''}</td>
              <td class="mono">${formatMoney(f.amount)}</td>
              <td>${
                canRefund
                  ? `<button type="button" class="deal-fiscal-refund-one" data-receipt="${esc(f.id)}" data-kind="${esc(
                      f.kind === 'advance' ? 'refund_advance' : 'refund'
                    )}">Вернуть</button>`
                  : ''
              }</td>
            </tr>`;
            })
            .join('')}
        </tbody>
      </table>
      <p class="muted" style="margin:8px 0 0;font-size:12px">Возврат — фискальный чек в ОФД через АТОЛ. Возврат денег на карту/СБП делается в банке Точка отдельно.</p>`
              : '<p class="muted" style="margin:0">Чеков ещё нет. Предоплата / полный — на счёте; возврат — на возвратной (приходной от клиента). Нужны настройки АТОЛ.</p>',
            fiscal.length > 0
          )
        : ''
    }
    ${dealFold(
      'sales-docs',
      `Документы (${salesDocs.length})`,
      `${
        salesDocs.length
          ? `<table>
        <thead><tr><th>Дата</th><th>Тип</th><th>Номер</th><th>Сумма</th><th>Открыть</th></tr></thead>
        <tbody>
          ${salesDocs
            .map((sd) => {
              const openHref =
                sd.doc_type === 'contract'
                  ? `/api/sales-docs/${esc(sd.id)}/print`
                  : `/api/sales-docs/${esc(sd.id)}/pdf`;
              return `
            <tr class="clickable" data-sales="${esc(sd.id)}">
              <td>${esc(String(sd.doc_date || '').slice(0, 10))}</td>
              <td>${esc(SALES_TYPE_LABEL[sd.doc_type] || sd.doc_type)}</td>
              <td class="mono">${esc(sd.number)}</td>
              <td class="mono">${sd.doc_type === 'contract' ? '—' : formatMoney(sd.total)}</td>
              <td>
                <a href="${openHref}" target="_blank" rel="noopener" onclick="event.stopPropagation()">открыть</a>
              </td>
            </tr>`;
            })
            .join('')}
        </tbody>
      </table>`
          : '<p class="muted" style="margin:0">Документов ещё нет — создайте во вкладках сверху (Счёт, Заказ-наряд, УПД…).</p>'
      }`,
      true
    )}
    ${dealFold(
      'pay-questions',
      `Вопросы (${payQuestions.length}/${openCrmTasks.length})`,
      (() => {
        const qRows = payQuestions.length
          ? `<table>
        <thead><tr><th>Когда</th><th>Вопрос</th></tr></thead>
        <tbody>
          ${payQuestions
            .map(
              (q) => `
            <tr>
              <td class="mono" style="white-space:nowrap">${esc(String(q.event_at || q.created_at || '').replace('T', ' ').slice(0, 16))}</td>
              <td>
                <div style="font-weight:600">${esc(q.title || 'Вопрос')}</div>
                <div class="muted" style="white-space:pre-wrap;margin-top:4px">${esc(q.comment || '')}</div>
              </td>
            </tr>`
            )
            .join('')}
        </tbody>
      </table>`
          : '<p class="muted" style="margin:0 0 10px">Пока нет вопросов со страницы оплаты.</p>';
        const tRows = crmTasks.length
          ? `<table style="margin-top:10px">
        <thead><tr><th>Статус</th><th>Задача</th><th></th></tr></thead>
        <tbody>
          ${crmTasks
            .map((t) => {
              const open = String(t.status || '') === 'open';
              return `
            <tr>
              <td>${open ? '<span class="muted" style="color:#c47a12;font-weight:700">открыта</span>' : '<span class="muted">готово</span>'}</td>
              <td>
                <div style="font-weight:600">${esc(t.title || '')}</div>
                <div class="muted" style="white-space:pre-wrap;margin-top:4px">${esc(t.comment || '')}</div>
                ${t.due_at ? `<div class="muted mono" style="margin-top:4px">до ${esc(String(t.due_at).replace('T', ' ').slice(0, 16))}</div>` : ''}
              </td>
              <td>
                ${
                  open
                    ? `<button type="button" class="deal-task-done" data-task="${esc(t.id)}">Ответил</button>`
                    : ''
                }
              </td>
            </tr>`;
            })
            .join('')}
        </tbody>
      </table>`
          : '';
        return (
          qRows +
          tRows +
          '<p class="muted" style="margin:10px 0 0;font-size:12px">Клиент пишет со страницы оплаты — вопрос сохраняется в заказ, ответственному ставится задача.</p>'
        );
      })(),
      payQuestions.length > 0 || openCrmTasks.length > 0
    )}
    ${dealFold(
      'items',
      `Позиции (${items.length})`,
      `<p class="muted" style="margin:0 0 8px;font-size:12px">
        В заказе — артикул. Какой именно экземпляр уйдёт, решает склад: <b>скан марки</b> → сверка артикула и применимости партии к авто строки → в расходную попадёт эта марка, склад и поставщик.
      </p>
      ${
        itemsLocked
          ? `<p class="muted" style="margin:0 0 10px;font-size:12px;color:#b45309">${esc(itemsLockedReason)}</p>`
          : ''
      }
      <div class="toolbar" style="margin:0 0 12px;flex-wrap:wrap;align-items:center">
        <div class="deal-scan-field find" style="margin:0;max-width:520px;position:relative;flex:1 1 280px">
          <input id="deal-scan-unit" class="mono" placeholder="Скан марки (Data Matrix)…" autocomplete="off" />
          ${uiIcoBtn({
            id: 'deal-scan-cam',
            tip: 'Камера · Data Matrix / штрихкод',
            icon: 'camera',
            mod: 'deal-scan-cam',
          })}
          <button type="button" id="deal-scan-go">Привязать</button>
          <span class="muted" id="deal-scan-msg" style="margin-left:8px"></span>
        </div>
        ${
          itemsLocked
            ? ''
            : `<button type="button" class="primary" id="deal-item-add-open" aria-expanded="${items.length ? 'false' : 'true'}">Добавить товар</button>`
        }
        <button type="button" id="deal-resync" data-tip="Подтянуть заказ из Amo">Обновить из Amo</button>
        <button class="primary" type="button" id="deal-wh-task" ${items.length ? '' : 'disabled'} data-tip="Создать складское задание">На склад</button>
        <label class="inline-label" style="margin:0" title="${esc(
          [d.amo_channel, d.amo_shipment].filter(Boolean).join(' · ') || 'Канал из Amo'
        )}">Канал
          <select id="deal-wh-channel" ${items.length ? '' : 'disabled'}>
            ${['cdek_prepaid', 'cdek_cod', 'pickup', 'bus', 'own_courier']
              .map((ch) => {
                const labels = {
                  cdek_prepaid: 'СДЭК предоплата',
                  cdek_cod: 'СДЭК наложка',
                  pickup: 'Самовывоз',
                  bus: 'Автобус',
                  own_courier: 'Свой курьер',
                };
                const sel = String(d.ship_channel || 'cdek_prepaid') === ch ? 'selected' : '';
                return `<option value="${ch}" ${sel}>${labels[ch]}</option>`;
              })
              .join('')}
          </select>
        </label>
      </div>
      ${
        itemsLocked
          ? ''
          : `<div class="deal-items-add form-grid${items.length ? ' hidden' : ''}" id="deal-items-add" style="margin:0 0 10px;align-items:end">
        <label>Марка
          <select id="deal-item-mark"><option value="">Все марки</option></select>
        </label>
        <label>Модель
          <select id="deal-item-model" disabled><option value="">Сначала марка</option></select>
        </label>
        <label>Поколение
          <select id="deal-item-gen" disabled><option value="">Не обязательно</option></select>
        </label>
        <label style="grid-column:1 / -1">Товар
          <input id="deal-item-q" placeholder="Артикул / код / название…" autocomplete="off" />
          <input type="hidden" id="deal-item-pid" />
          <div id="deal-item-suggest" class="suggest hidden"></div>
        </label>
        <label>Склад
          <select id="deal-item-wh"><option value="">Не выбран</option></select>
        </label>
        <label>Поставщик
          <select id="deal-item-sup" disabled><option value="">Сначала товар</option></select>
        </label>
        <label style="grid-column:1 / span 2">Партия (приход)
          <select id="deal-item-party" disabled><option value="">Сначала товар</option></select>
        </label>
        <label>Кол-во<input id="deal-item-qty" type="number" step="0.001" min="0.001" value="1" /></label>
        <label>Цена<input id="deal-item-price" type="number" step="0.01" min="0" placeholder="розничная" /></label>
        <div class="toolbar" style="margin:0;grid-column:1 / -1">
          <button type="button" class="primary" id="deal-item-add">Добавить в заказ</button>
          <button type="button" id="deal-item-add-cancel">Скрыть</button>
          <span class="muted" id="deal-item-msg"></span>
        </div>
      </div>`
      }
      ${
        items.length
          ? `<table>
        <thead><tr><th>Вид</th><th>Артикул</th><th>Код</th><th>Название</th><th>Марки</th><th>Склад</th><th>Поставщик</th><th>Партия</th><th>Кол-во</th><th>Цена</th><th>Сумма</th>${itemsLocked ? '' : '<th></th>'}</tr></thead>
        <tbody>
          ${items
            .map((l) => {
              const shown = String(l.display_name || l.name_display || l.name || '—');
              const name1c = String(l.name_1c || l.product_name_1c || l.name || '');
              const tip =
                l.has_applicability && name1c && name1c !== shown
                  ? ` title="1С: ${esc(name1c)}"`
                  : '';
              const appHint = [l.mark, l.model, l.generation].filter(Boolean).join(' · ');
              const serials = Array.isArray(l.serials)
                ? l.serials
                : [];
              const needN = Math.max(1, Math.round(Number(l.qty) || 1));
              const marksHtml =
                String(l.item_kind) === 'service'
                  ? '—'
                  : serials.length
                    ? `<div class="thin-dm-list">${serials
                        .map(
                          (s) =>
                            `<button type="button" class="linkish mono thin-dm-code" data-serial="${esc(
                              s
                            )}">${esc(s)}</button>`
                        )
                        .join('')}</div>
                       <div class="muted" style="font-size:11px">${serials.length}/${needN}</div>`
                    : `<span class="muted">нет · нужно ${needN}</span>`;
              return `<tr class="${l.product_guid ? 'clickable' : ''}" ${l.product_guid ? `data-product="${esc(l.product_guid)}"` : ''} data-item-id="${esc(l.id)}">
                  <td>${String(l.item_kind) === 'service' ? 'Услуга' : 'Товар'}</td>
                  <td class="mono">${esc(l.sku || '')}</td>
                  <td class="mono">${esc(l.code || '')}</td>
                  <td${tip}>${esc(shown)}${
                    appHint
                      ? `<div class="muted" style="font-size:11px">${esc(appHint)}</div>`
                      : ''
                  }${
                    l.has_applicability && name1c && name1c !== shown
                      ? `<div class="muted" style="font-size:10px">1С: ${esc(name1c)}</div>`
                      : ''
                  }</td>
                  <td class="thin-dm-cell" onclick="event.stopPropagation()">${marksHtml}</td>
                  <td>${String(l.item_kind) === 'service' ? '—' : esc(l.warehouse_name || '—')}</td>
                  <td>${String(l.item_kind) === 'service' ? '—' : esc(l.supplier_name || '—')}</td>
                  <td class="mono">${
                    String(l.item_kind) === 'service'
                      ? '—'
                      : esc(l.in_doc_number || '—') +
                        (l.in_doc_date ? `<div class="muted" style="font-size:11px">${esc(l.in_doc_date)}</div>` : '')
                  }</td>
                  <td class="mono">${esc(l.qty)}</td>
                  <td class="mono">${formatMoney(l.price)}</td>
                  <td class="mono">${formatMoney(l.amount)}</td>
                  ${
                    itemsLocked
                      ? ''
                      : `<td class="col-actions"><button type="button" class="table-tool-ico pe-app-del deal-item-del" data-item-id="${esc(l.id)}" title="Удалить позицию" aria-label="Удалить"><svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M3.5 4.5h9M6.2 4.5V3.2c0-.4.3-.7.7-.7h2.2c.4 0 .7.3.7.7v1.3M5 4.5l.5 8.2c0 .4.4.8.8.8h3.4c.4 0 .8-.4.8-.8L11 4.5M7 7v4.5M9 7v4.5" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg></button></td>`
                  }
                </tr>`;
            })
            .join('')}
        </tbody>
      </table>`
          : itemsLocked
            ? '<p class="muted" style="margin:0">Позиций нет.</p>'
            : '<p class="muted" style="margin:0">Позиций пока нет — выберите марку/модель или найдите товар/услугу, укажите склад и партию (для товаров).</p>'
      }`,
      true
    )}
    ${dealFold(
      'item-pdfs',
      `PDF (${docs.length})`,
      docs.length
        ? `<ul class="doc-list">${docs
            .map(
              (m) =>
                `<li><a href="${esc(m.url)}" target="_blank" rel="noopener">${esc((m.ext || 'pdf').toUpperCase())} · ${esc(m.sku || '')} · ${esc(m.product_name || '')} · ${Math.round((m.size || 0) / 1024)} КБ</a></li>`
            )
            .join('')}</ul>`
        : '<p class="muted" style="margin:0">PDF по товарам заказа ещё нет — подтяните фото/документы номенклатуры из 1С (кнопка на карточке товара).</p>',
      docs.length > 0
    )}
    ${dealTabs(state._dealTabCollect)}`,
    {
      section: 'Заказ покупателя',
      entityKind: 'deal',
      hintBar: dealHintBarHtml(d),
      pageTabs: buildOrderLinkTabs({
        dealId: id,
        current: { kind: 'deal', id },
        siblings: salesDocs,
        stockOuts: state._dealStockOuts || [],
        transferOrders: dealXferDocs,
        allowCreate: true,
        needContract: dealNeedsContract(d),
        docPack: Array.isArray(d.doc_pack_types)
          ? d.doc_pack_types
          : rules && Array.isArray(rules.doc_pack)
            ? rules.doc_pack
            : null,
        saleRules: rules,
        personNoUpd: !isLegal && !String(d.buyer_inn || '').replace(/\D/g, ''),
        needTransfer: Number(d.is_sto) === 1 || !!(rules && rules.is_sto),
        invoiceAlert: dealFiscalAlert.alert,
        invoiceAlertTip: dealFiscalAlert.tip,
        ...chainIncompleteOpts(docTree),
      }),
      activePageTab: 'deal:' + id,
      chatRef: {
        type: 'deal',
        id: String(id),
        label:
          (String(d.name || '').trim() || 'Заказ ' + id) +
          (d.price ? ' · ' + Math.round(Number(d.price)).toLocaleString('ru-RU') + ' ₽' : ''),
        href: '/crm/deals/' + id,
      },
    }
  );
  bindFormChrome(() => openTab('deals'));
  if (!orgLocked) bindDealOrgLegalBar(id, { companyId: dealCompanyId });
  bindDealHintBar(id);
  bindOrderLinkTabs(view, {
    dealId: id,
    onCreate: async (action, btn) => {
      const msg = document.getElementById('deal-msg');
      if (btn) btn.disabled = true;
      try {
        if (action === 'transfer') {
          await createDealTransferOrder(id, msg);
          return;
        }
        await createLinkedSalesDoc(id, action, dealSelectedOrgId(), msg);
        setTimeout(() => {
          if (state.activeTab === 'deal:' + id) renderDealDetail(id);
        }, 400);
      } catch (e) {
        if (msg) msg.textContent = e.message || String(e);
        alert(e.message || String(e));
        if (btn) btn.disabled = false;
      }
    },
  });
  bindDealTabs(view);

  view.querySelectorAll('[data-product]').forEach((tr) => {
    tr.onclick = (e) => {
      if (e.target && e.target.closest && e.target.closest('.deal-item-del,[data-serial]')) return;
      openTab('product:' + tr.dataset.product);
    };
  });
  view.querySelectorAll('.deal-item-del').forEach((btn) => {
    btn.onclick = async (e) => {
      e.preventDefault();
      e.stopPropagation();
      const itemId = btn.dataset.itemId || btn.getAttribute('data-item-id');
      if (!itemId) return;
      const msg = document.getElementById('deal-item-msg');
      try {
        if (msg) msg.textContent = 'Удаление…';
        await api('/crm/deals/' + encodeURIComponent(id) + '/items/' + encodeURIComponent(itemId), {
          method: 'DELETE',
        });
        renderDealDetail(id);
      } catch (err) {
        if (msg) msg.textContent = err.message;
      }
    };
  });
  view.querySelectorAll('[data-serial]').forEach((btn) => {
    btn.onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      const code = String(btn.getAttribute('data-serial') || '').trim();
      if (code) openTab('serial:' + code, code.slice(0, 40));
    };
  });
  const scanUnit = async () => {
    const inp = document.getElementById('deal-scan-unit');
    const msg = document.getElementById('deal-scan-msg');
    const code = String(inp?.value || '').trim();
    if (!code) {
      if (msg) msg.textContent = 'Введите или отсканируйте марку';
      return;
    }
    if (msg) msg.textContent = 'Проверка…';
    try {
      const res = await api('/crm/deals/' + encodeURIComponent(id) + '/scan-unit', {
        method: 'POST',
        body: JSON.stringify({ serial: code }),
      });
      if (msg) {
        msg.textContent =
          '✓ ' +
          (res.sku || '') +
          (res.warehouse_name ? ' · ' + res.warehouse_name : '') +
          (res.supplier_name ? ' · ' + res.supplier_name : '') +
          (res.apps_label && res.apps_label !== 'как в каталоге'
            ? ' · партия: ' + res.apps_label
            : '');
      }
      if (inp) inp.value = '';
      await renderDealDetail(id);
    } catch (err) {
      if (msg) msg.textContent = err.message || String(err);
    }
  };
  document.getElementById('deal-scan-go')?.addEventListener('click', () => scanUnit());
  document.getElementById('deal-scan-unit')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      scanUnit();
    }
  });
  document.getElementById('deal-scan-cam')?.addEventListener('click', async () => {
    const msg = document.getElementById('deal-scan-msg');
    const inp = document.getElementById('deal-scan-unit');
    try {
      if (msg) msg.textContent = 'Камера…';
      await openCameraBarcodeScan({
        title: 'Скан марки',
        hint: 'Наведите на Data Matrix или штрихкод',
        onCode: (code) => {
          if (inp) inp.value = code;
          if (msg) msg.textContent = 'Считано · привязка…';
          scanUnit();
        },
      });
    } catch (e) {
      if (msg) {
        msg.textContent =
          e.message ||
          'Камера недоступна — введите код вручную или USB-сканером';
      }
    }
  });
  {
    const addPanel = document.getElementById('deal-items-add');
    const openAddBtn = document.getElementById('deal-item-add-open');
    const cancelAddBtn = document.getElementById('deal-item-add-cancel');
    const setAddPanelOpen = (open) => {
      if (!addPanel) return;
      addPanel.classList.toggle('hidden', !open);
      if (openAddBtn) {
        openAddBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
        openAddBtn.classList.toggle('hidden', open);
      }
      if (open) {
        const focusEl = document.getElementById('deal-item-q') || document.getElementById('deal-item-mark');
        setTimeout(() => focusEl?.focus(), 0);
      }
    };
    openAddBtn?.addEventListener('click', () => setAddPanelOpen(true));
    cancelAddBtn?.addEventListener('click', () => setAddPanelOpen(false));
    if (addPanel && !addPanel.classList.contains('hidden')) setAddPanelOpen(true);

    const qInput = document.getElementById('deal-item-q');
    const idInput = document.getElementById('deal-item-pid');
    const suggest = document.getElementById('deal-item-suggest');
    const priceInput = document.getElementById('deal-item-price');
    const qtyInput = document.getElementById('deal-item-qty');
    const addBtn = document.getElementById('deal-item-add');
    const msg = document.getElementById('deal-item-msg');
    const markSel = document.getElementById('deal-item-mark');
    const modelSel = document.getElementById('deal-item-model');
    const genSel = document.getElementById('deal-item-gen');
    const whSel = document.getElementById('deal-item-wh');
    const supSel = document.getElementById('deal-item-sup');
    const partySel = document.getElementById('deal-item-party');
    let sourcesCache = null;
    let allWarehouses = [];

    const fillSelect = (sel, opts, placeholder) => {
      if (!sel) return;
      const cur = sel.value;
      sel.innerHTML =
        `<option value="">${esc(placeholder)}</option>` +
        opts
          .map(
            (o) =>
              `<option value="${esc(o.value)}" ${o.value === cur ? 'selected' : ''}>${esc(o.label)}</option>`
          )
          .join('');
    };

    const selectedMarkName = () => {
      if (!markSel || !markSel.value) return '';
      const opt = markSel.options[markSel.selectedIndex];
      return (opt && opt.dataset.name) || opt?.textContent || '';
    };
    const selectedModelName = () => {
      if (!modelSel || !modelSel.value) return '';
      const opt = modelSel.options[modelSel.selectedIndex];
      return (opt && opt.dataset.name) || opt?.textContent || '';
    };
    const selectedGenName = () => (genSel && genSel.value) || '';

    const productFilterQs = () => {
      const qs = new URLSearchParams();
      qs.set('limit', '20');
      const markName = selectedMarkName();
      const modelName = selectedModelName();
      const genName = selectedGenName();
      if (markName) qs.set('mark', markName);
      if (modelName) qs.set('model', modelName);
      if (genName) qs.set('generation', genName);
      return qs;
    };

    const refillParties = () => {
      if (!partySel || !sourcesCache) return;
      const sid = (supSel && supSel.value) || '';
      let list = sourcesCache.deliveries || [];
      if (sid) list = list.filter((d) => String(d.supplier_id || '') === sid);
      fillSelect(
        partySel,
        list.map((d) => ({
          value: d.id,
          label: [
            d.number || d.id.slice(0, 8),
            d.doc_date,
            d.supplier_name,
            d.apps_short || d.apps_label || '',
            d.units != null ? '×' + d.units : '',
          ]
            .filter(Boolean)
            .join(' · '),
        })),
        list.length ? 'Выберите партию' : 'Нет приходов'
      );
      partySel.disabled = !list.length;
    };

    const loadSources = async (productId) => {
      if (!productId || !supSel || !partySel || !whSel) return;
      try {
        const qs = new URLSearchParams({ product_id: productId, for_deal: '1' });
        if (whSel.value) qs.set('warehouse_id', whSel.value);
        sourcesCache = await api('/product-units/sources?' + qs.toString());
        const whFromStock = sourcesCache.warehouses || [];
        const whOpts =
          whFromStock.length > 0
            ? whFromStock.map((w) => ({
                value: w.id,
                label: `${w.name} (${w.qty})`,
              }))
            : allWarehouses.map((w) => ({ value: w.id, label: w.name }));
        fillSelect(whSel, whOpts, 'Не выбран');
        fillSelect(
          supSel,
          (sourcesCache.suppliers || []).map((s) => ({
            value: s.id,
            label: `${s.name}${s.units != null ? ' · ' + s.units : ''}`,
          })),
          (sourcesCache.suppliers || []).length ? 'Все / не выбран' : 'Нет поставщиков'
        );
        supSel.disabled = !(sourcesCache.suppliers || []).length;
        refillParties();
      } catch (err) {
        if (msg) msg.textContent = err.message;
      }
    };

    const loadMarks = async () => {
      if (!markSel) return;
      try {
        const marks = await api('/dicts/marks');
        const list = Array.isArray(marks) ? marks : marks.items || [];
        markSel.innerHTML =
          '<option value="">Все марки</option>' +
          list
            .map(
              (m) =>
                `<option value="${esc(m.id)}" data-name="${esc(m.name)}">${esc(m.name)}</option>`
            )
            .join('');
      } catch (_) {
        /* ignore */
      }
    };

    const loadModels = async () => {
      if (!modelSel || !genSel) return;
      const markId = markSel && markSel.value;
      genSel.innerHTML = '<option value="">Не обязательно</option>';
      genSel.disabled = true;
      if (!markId) {
        modelSel.innerHTML = '<option value="">Сначала марка</option>';
        modelSel.disabled = true;
        return;
      }
      try {
        const models = await api('/dicts/marks/' + encodeURIComponent(markId) + '/models');
        const list = Array.isArray(models) ? models : models.items || [];
        modelSel.innerHTML =
          '<option value="">Все модели</option>' +
          list
            .map(
              (m) =>
                `<option value="${esc(m.id)}" data-name="${esc(m.name)}">${esc(m.name)}</option>`
            )
            .join('');
        modelSel.disabled = false;
      } catch (err) {
        if (msg) msg.textContent = err.message;
      }
    };

    const loadGens = async () => {
      if (!genSel) return;
      const markName = selectedMarkName();
      const modelName = selectedModelName();
      if (!markName) {
        genSel.innerHTML = '<option value="">Не обязательно</option>';
        genSel.disabled = true;
        return;
      }
      try {
        const qs = new URLSearchParams({ mark: markName });
        if (modelName) qs.set('model', modelName);
        const gens = await api('/dicts/applicability/generations?' + qs.toString());
        const list = Array.isArray(gens) ? gens : [];
        genSel.innerHTML =
          '<option value="">Не обязательно</option>' +
          list
            .map((g) => `<option value="${esc(g.name)}">${esc(g.name)}</option>`)
            .join('');
        genSel.disabled = !list.length;
      } catch (_) {
        genSel.disabled = true;
      }
    };

    const loadWarehouses = async () => {
      if (!whSel) return;
      try {
        const data = await api(withCompanyId('/warehouses'));
        allWarehouses = (Array.isArray(data) ? data : data.items || []).filter(
          (w) => Number(w.is_active) !== 0
        );
        fillSelect(
          whSel,
          allWarehouses.map((w) => ({ value: w.id, label: w.name })),
          'Не выбран'
        );
      } catch (_) {
        /* ignore */
      }
    };

    loadMarks();
    loadWarehouses();

    if (markSel) {
      markSel.onchange = async () => {
        await loadModels();
        await loadGens();
        if (idInput) idInput.value = '';
      };
    }
    if (modelSel) {
      modelSel.onchange = async () => {
        await loadGens();
        if (idInput) idInput.value = '';
      };
    }
    if (supSel) supSel.onchange = () => refillParties();
    if (whSel) {
      whSel.onchange = () => {
        const pid = idInput && idInput.value.trim();
        if (pid) loadSources(pid);
      };
    }

    if (qInput && idInput && suggest && addBtn) {
      const runSuggest = debounce(async () => {
        const q = qInput.value.trim();
        idInput.value = '';
        sourcesCache = null;
        if (supSel) {
          supSel.innerHTML = '<option value="">Сначала товар</option>';
          supSel.disabled = true;
        }
        if (partySel) {
          partySel.innerHTML = '<option value="">Сначала товар</option>';
          partySel.disabled = true;
        }
        const qs = productFilterQs();
        if (q.length >= 2) qs.set('q', q);
        else if (!qs.get('mark') && !qs.get('model')) {
          suggest.classList.add('hidden');
          suggest.innerHTML = '';
          return;
        }
        try {
          const data = await api('/products?' + qs.toString());
          const list = data.items || [];
          if (!list.length) {
            suggest.innerHTML = '<div class="suggest-empty muted">Нет совпадений</div>';
            suggest.classList.remove('hidden');
            return;
          }
          suggest.innerHTML = list
            .map((p) => {
              const label = [p.sku, p.code ? 'код ' + p.code : '', productTitle(p)]
                .filter(Boolean)
                .join(' · ');
              return `<button type="button" class="suggest-item" data-id="${esc(p.id)}" data-label="${esc(label)}" data-sku="${esc(p.sku || '')}">
                <span class="mono">${esc(p.sku || '—')}</span>
                ${p.code ? '<span class="muted mono"> · ' + esc(p.code) + '</span>' : ''}
                ${esc(productTitle(p))}
              </button>`;
            })
            .join('');
          suggest.classList.remove('hidden');
          suggest.querySelectorAll('.suggest-item').forEach((btn) => {
            btn.onclick = () => {
              idInput.value = btn.dataset.id;
              qInput.value = btn.dataset.label || btn.dataset.sku || '';
              suggest.classList.add('hidden');
              loadSources(btn.dataset.id);
            };
          });
        } catch (err) {
          if (msg) msg.textContent = err.message;
        }
      }, 250);
      qInput.oninput = runSuggest;
      qInput.onfocus = () => {
        if (suggest.innerHTML) suggest.classList.remove('hidden');
      };
      qInput.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') suggest.classList.add('hidden');
      });
      addBtn.onclick = async () => {
        const productId = idInput.value.trim();
        const q = qInput.value.trim();
        if (!productId && !q) {
          if (msg) msg.textContent = 'Выберите товар из списка или введите артикул/код';
          return;
        }
        addBtn.disabled = true;
        if (msg) msg.textContent = 'Добавление…';
        try {
          const body = {
            qty: Number(qtyInput && qtyInput.value) || 1,
          };
          if (productId) body.product_id = productId;
          else if (q) {
            body.sku = q;
            body.code = q;
          }
          const priceVal = priceInput && priceInput.value !== '' ? Number(priceInput.value) : null;
          if (priceVal != null && Number.isFinite(priceVal)) body.price = priceVal;
          if (whSel && whSel.value) body.warehouse_id = whSel.value;
          if (supSel && supSel.value) body.supplier_id = supSel.value;
          if (partySel && partySel.value) body.in_doc_id = partySel.value;
          const markName = selectedMarkName();
          const modelName = selectedModelName();
          const genName = selectedGenName();
          if (markName) body.mark = markName;
          if (modelName) body.model = modelName;
          if (genName) body.generation = genName;
          await api('/crm/deals/' + encodeURIComponent(id) + '/items', {
            method: 'POST',
            body: JSON.stringify(body),
          });
          renderDealDetail(id);
        } catch (err) {
          if (msg) msg.textContent = err.message;
          addBtn.disabled = false;
        }
      };
    }
  }
  view.querySelectorAll('[data-sales]').forEach((tr) => {
    tr.onclick = () => openTab('sales:' + tr.dataset.sales);
  });
  const resyncBtn = document.getElementById('deal-resync');
  if (resyncBtn) {
    resyncBtn.onclick = async () => {
      const msg = document.getElementById('deal-msg');
      try {
        if (msg) msg.textContent = 'Обновление…';
        await api('/crm/deals/sync', {
          method: 'POST',
          body: JSON.stringify({ deal_id: id }),
        });
        renderDealDetail(id);
      } catch (e) {
        if (msg) msg.textContent = e.message;
      }
    };
  }
  const whTaskBtn = document.getElementById('deal-wh-task');
  if (whTaskBtn) {
    whTaskBtn.onclick = async () => {
      const msg = document.getElementById('deal-msg');
      const chEl = document.getElementById('deal-wh-channel');
      const channel = (chEl && chEl.value) || 'cdek_prepaid';
      whTaskBtn.disabled = true;
      msg.textContent = 'Создание задания…';
      try {
        const task = await api('/crm/deals/' + id + '/warehouse-task', {
          method: 'POST',
          body: JSON.stringify({ channel }),
        });
        msg.textContent =
          'Задание ' +
          (task.number || '') +
          (channel === 'pickup' ? ' · самовывоз' : '');
        state.whTaskFocus = task.id;
        openTab('wh-tasks');
      } catch (e) {
        msg.textContent = e.message;
        whTaskBtn.disabled = false;
      }
    };
  }
  const readDealVehicleForm = () => ({
    car_plate: document.getElementById('deal-car-plate')?.value || '',
    car_vin: document.getElementById('deal-car-vin')?.value || '',
    car_year: document.getElementById('deal-car-year')?.value || '',
    car_mileage: document.getElementById('deal-car-mileage')?.value || '',
    car_brand: document.getElementById('deal-car-brand')?.value || '',
    car_model: document.getElementById('deal-car-model')?.value || '',
    car_color: document.getElementById('deal-car-color')?.value || '',
    car_category: document.getElementById('deal-car-category')?.value || '',
    car_pts: document.getElementById('deal-car-pts')?.value || '',
    car_owner: document.getElementById('deal-car-owner')?.value || '',
    car_owner_street: document.getElementById('deal-car-owner-street')?.value || '',
    car_owner_house: document.getElementById('deal-car-owner-house')?.value || '',
    car_owner_flat: document.getElementById('deal-car-owner-flat')?.value || '',
    car_sts_date: document.getElementById('deal-car-sts-date')?.value || '',
    car_sts_number: document.getElementById('deal-car-sts-number')?.value || '',
  });
  const makeSalesDoc = async (docType) => {
    const msg = document.getElementById('deal-msg');
    msg.textContent = 'Создание…';
    try {
      const organization_id = dealSelectedOrgId();
      state.dealOrgId = organization_id;
      const r = await api('/sales-docs/from-deal', {
        method: 'POST',
        body: JSON.stringify({ deal_id: id, doc_type: docType, organization_id }),
      });
      const doc = r.doc;
      msg.textContent = 'Создано: ' + (doc.number || '');
      if (doc?.id) {
        openTab('sales:' + doc.id, (doc.number || docType).slice(0, 40));
        if (docType === 'workorder' && String(doc.car_plate || '').trim()) {
          openSalesPdf(doc.id);
        }
        setTimeout(() => {
          if (state.activeTab === 'deal:' + id) renderDealDetail(id);
        }, 400);
      }
    } catch (e) {
      msg.textContent = e.message;
      alert(e.message);
    }
  };
  const stoCb = document.getElementById('deal-is-sto');
  if (stoCb) {
    stoCb.onchange = async () => {
      const msg = document.getElementById('deal-msg');
      const on = !!stoCb.checked;
      try {
        if (msg) msg.textContent = 'Сохраняем признак СТО…';
        await api('/crm/deals/' + encodeURIComponent(id) + '/sto', {
          method: 'PATCH',
          body: JSON.stringify({ is_sto: on }),
        });
        renderDealDetail(id);
      } catch (e) {
        stoCb.checked = !on;
        if (msg) msg.textContent = e.message;
        alert(e.message);
      }
    };
  }
  const carSave = document.getElementById('deal-car-save');
  const fileToB64 = (file) =>
    new Promise((resolve, reject) => {
      if (!file) return resolve(null);
      const reader = new FileReader();
      reader.onload = () => {
        const s = String(reader.result || '');
        const i = s.indexOf(',');
        resolve({
          mime: file.type || 'image/jpeg',
          data_base64: i >= 0 ? s.slice(i + 1) : s,
        });
      };
      reader.onerror = () => reject(new Error('Не удалось прочитать файл'));
      reader.readAsDataURL(file);
    });
  if (carSave) {
    carSave.onclick = async () => {
      const msg = document.getElementById('deal-car-msg');
      carSave.disabled = true;
      if (msg) msg.textContent = 'Сохранение…';
      try {
        await api('/crm/deals/' + encodeURIComponent(id) + '/vehicle', {
          method: 'PATCH',
          body: JSON.stringify(readDealVehicleForm()),
        });
        if (msg) msg.textContent = 'Сохранено';
        setTimeout(() => renderDealDetail(id), 250);
      } catch (e) {
        if (msg) msg.textContent = e.message || String(e);
        alert(e.message || String(e));
        carSave.disabled = false;
      }
    };
  }
  const stsOcrBtn = document.getElementById('deal-sts-ocr');
  if (stsOcrBtn) {
    stsOcrBtn.onclick = async () => {
      const msg = document.getElementById('deal-sts-ocr-msg');
      const files = [...(document.getElementById('deal-sts-photos')?.files || [])].slice(0, 4);
      const hasSaved =
        !!(document.querySelector('.sts-thumb img') || document.querySelector('a.sts-thumb'));
      if (!files.length && !hasSaved) {
        const err = 'Выберите 1–2 фото СТС — сторону определим сами и сохраним';
        if (msg) msg.textContent = err;
        alert(err);
        return;
      }
      stsOcrBtn.disabled = true;
      if (msg) {
        msg.textContent = files.length
          ? 'Сохраняем фото и распознаём… (~20 сек)'
          : 'Распознаём сохранённые фото… (~20 сек)';
      }
      try {
        const images = [];
        for (const f of files) {
          const b = await fileToB64(f);
          if (b) images.push(b);
        }
        const r = await api('/crm/deals/' + encodeURIComponent(id) + '/vehicle/ocr', {
          method: 'POST',
          body: JSON.stringify({
            images,
            apply: true,
            recognize: true,
            from_saved: !images.length,
          }),
        });
        const v = r.vehicle || {};
        const set = (elId, val) => {
          const el = document.getElementById(elId);
          if (el) el.value = val || '';
        };
        set('deal-car-plate', v.car_plate);
        set('deal-car-vin', v.car_vin);
        set('deal-car-brand', v.car_brand);
        set('deal-car-model', v.car_model);
        set('deal-car-year', v.car_year);
        set('deal-car-color', v.car_color);
        set('deal-car-category', v.car_category);
        set('deal-car-pts', v.car_pts);
        set('deal-car-owner', v.car_owner);
        set('deal-car-owner-street', v.car_owner_street);
        set('deal-car-owner-house', v.car_owner_house);
        set('deal-car-owner-flat', v.car_owner_flat);
        set('deal-car-sts-date', v.car_sts_date);
        set('deal-car-sts-number', v.car_sts_number);
        const sideLabels = (r.sides || [])
          .map((s) => (s.side === 'front' ? 'лицевая' : s.side === 'back' ? 'оборот' : s.side))
          .join(' + ');
        if (msg) {
          msg.textContent =
            'Распознано: ' +
            (v.car_plate || v.car_vin || 'поля') +
            (sideLabels ? ' · ' + sideLabels : '') +
            (r.saved ? ' · сохранено' : '');
        }
        setTimeout(() => renderDealDetail(id), 400);
      } catch (e) {
        if (msg) msg.textContent = e.message || String(e);
        alert(e.message || String(e));
        stsOcrBtn.disabled = false;
      }
    };
  }
  const packBtn = document.getElementById('deal-pack');
  if (packBtn) {
    packBtn.onclick = async () => {
      const msg = document.getElementById('deal-msg');
      msg.textContent = 'Создание документов…';
      try {
        const r = await api('/sales-docs/pack-from-deal', {
          method: 'POST',
          body: JSON.stringify({
            deal_id: id,
            organization_id: dealSelectedOrgId(),
          }),
        });
        const docsCreated = r.docs || [];
        const typeLabels = { invoice: 'счёт', workorder: 'ЗН', upd: 'УПД', sf: 'СФ' };
        const packHint = (r.types || [])
          .map((t) => typeLabels[t] || t)
          .join(' + ');
        msg.textContent =
          (packHint ? packHint + ' · ' : '') +
          'создано: ' +
          docsCreated.map((x) => x.number).filter(Boolean).join(', ');
        for (const doc of docsCreated) {
          if (!doc?.id) continue;
          openTab('sales:' + doc.id, (doc.number || '').slice(0, 40));
          if (doc.doc_type === 'workorder' && String(doc.car_plate || '').trim()) {
            openSalesPdf(doc.id);
          }
        }
        // ЗН без авто — открыть его первым (заполнить номер)
        const wo = docsCreated.find((x) => x.doc_type === 'workorder');
        const first = wo || docsCreated[0];
        if (first?.id) {
          openTab('sales:' + first.id, (first.number || '').slice(0, 40));
        }
        setTimeout(() => renderDealDetail(id), 300);
      } catch (e) {
        msg.textContent = e.message;
        alert(e.message);
      }
    };
  }
  const payLinkBtn = document.getElementById('deal-pay-link');
  if (payLinkBtn) {
    payLinkBtn.onclick = async () => {
      const msg = document.getElementById('deal-msg');
      msg.textContent = 'Создание ссылки на оплату…';
      try {
        const r = await api('/crm/deals/' + encodeURIComponent(id) + '/payment-link', {
          method: 'POST',
          body: JSON.stringify({ organization_id: dealSelectedOrgId() }),
        });
        const url = r.url || '';
        if (url && navigator.clipboard && navigator.clipboard.writeText) {
          try {
            await navigator.clipboard.writeText(url);
          } catch {
            /* ignore */
          }
        }
        if (url) window.open(url, '_blank', 'noopener');
        msg.textContent = url ? 'Ссылка создана и скопирована' : 'Ссылка создана';
        renderDealDetail(id);
      } catch (e) {
        msg.textContent = e.message;
        alert(e.message);
      }
    };
  }
  const pollPayBtn = document.getElementById('deal-poll-pay');
  if (pollPayBtn) {
    pollPayBtn.onclick = async () => {
      const msg = document.getElementById('deal-msg');
      msg.textContent = 'Проверка в Точке…';
      try {
        const r = await api('/payments/poll-tochka', {
          method: 'POST',
          body: JSON.stringify({ deal_id: id }),
        });
        if (r.marked > 0) {
          const wt = r.warehouse_task || (r.items || []).find((x) => x.warehouse_task)?.warehouse_task;
          msg.textContent =
            'Оплата подтверждена' +
            (wt && wt.created && wt.task
              ? ' · задание складу ' + (wt.task.number || '')
              : ' · задание складу при отсутствии создаётся автоматически');
        } else if (r.checked > 0) {
          const st = (r.items || []).map((x) => x.bank_status).filter(Boolean).join(', ');
          msg.textContent = 'Пока не оплачено' + (st ? ' (' + st + ')' : '');
        } else {
          msg.textContent = 'Нет незакрытых QR для проверки';
        }
        renderDealDetail(id);
      } catch (e) {
        msg.textContent = e.message;
        alert(e.message);
      }
    };
  }
  const acceptCashBtn = document.getElementById('deal-accept-cash');
  if (acceptCashBtn) {
    acceptCashBtn.onclick = async () => {
      const msg = document.getElementById('deal-msg');
      const opts = [];
      if (dueServices > 0.009) opts.push({ covers: 'services', label: 'Услуги', amount: dueServices });
      if (dueGoods > 0.009) opts.push({ covers: 'goods', label: 'Товар', amount: dueGoods });
      if (dueTotal > 0.009) opts.push({ covers: 'all', label: 'Всё оставшееся', amount: dueTotal });
      if (!opts.length) {
        alert('Доплачивать нечего');
        return;
      }
      let pick = opts[opts.length - 1];
      if (opts.length > 1) {
        const lines = opts
          .map((o, i) => i + 1 + ') ' + o.label + ' — ' + formatMoney(o.amount))
          .join('\n');
        const ans = prompt(
          'Что принимаем налом?\n' +
            lines +
            '\n\nВведите номер (например 1).\nПример: предоплата за баллон уже есть — берите «Услуги» или «Товар» за второй баллон.',
          String(opts.length > 1 && dueServices > 0.009 ? 1 : opts.length)
        );
        if (ans == null) return;
        const n = parseInt(String(ans).trim(), 10);
        if (!(n >= 1 && n <= opts.length)) {
          alert('Нужен номер от 1 до ' + opts.length);
          return;
        }
        pick = opts[n - 1];
      } else {
        const ok = confirm(
          'Принять наличные · ' + pick.label + ' · ' + formatMoney(pick.amount) + '?'
        );
        if (!ok) return;
      }
      msg.textContent = 'Приём наличных…';
      try {
        const r = await api('/crm/deals/' + encodeURIComponent(id) + '/accept-cash', {
          method: 'POST',
          body: JSON.stringify({ covers: pick.covers, amount: pick.amount }),
        });
        const split = r.payment_split || {};
        msg.textContent =
          'Принято налом · ' +
          pick.label +
          ' · ' +
          formatMoney(r.payment && r.payment.amount) +
          (r.fully_paid
            ? ' · заказ закрыт'
            : split.due_total > 0
              ? ' · ещё доплата ' + formatMoney(split.due_total)
              : '') +
          (r.cash_doc && r.cash_doc.number ? ' · касса ' + r.cash_doc.number : '') +
          (r.cash_doc_error ? ' · касса: ' + r.cash_doc_error : '');
        renderDealDetail(id);
      } catch (e) {
        msg.textContent = e.message;
        alert(e.message);
      }
    };
  }
  // Авто-poll раз в 20с, пока на карточке есть незакрытый QR (только физлица)
  if (
    payByLink &&
    payments.some(
      (p) =>
        p.qrc_id &&
        !['paid', 'confirmed', 'success', 'accepted'].includes(String(p.status || '').toLowerCase())
    )
  ) {
    if (state._dealPayPollTimer) clearTimeout(state._dealPayPollTimer);
    state._dealPayPollTimer = setTimeout(async () => {
      if (state.dealId !== id) return;
      try {
        const r = await api('/payments/poll-tochka', {
          method: 'POST',
          body: JSON.stringify({ deal_id: id }),
        });
        if (r.marked > 0) renderDealDetail(id);
        else if (state.dealId === id) {
          state._dealPayPollTimer = setTimeout(() => {
            if (state.dealId === id) renderDealDetail(id);
          }, 20000);
        }
      } catch {
        /* silent */
      }
    }, 20000);
  }
  view.querySelectorAll('.deal-task-done').forEach((btn) => {
    btn.onclick = async () => {
      const msg = document.getElementById('deal-msg');
      btn.disabled = true;
      try {
        await api('/crm/tasks/' + encodeURIComponent(btn.dataset.task), {
          method: 'PATCH',
          body: JSON.stringify({ status: 'done' }),
        });
        if (msg) msg.textContent = 'Задача закрыта';
        renderDealDetail(id);
      } catch (e) {
        btn.disabled = false;
        if (msg) msg.textContent = e.message;
        alert(e.message);
      }
    };
  });
  const makeFiscal = async (kind, parentReceiptId) => {
    const msg = document.getElementById('deal-msg');
    const labels = {
      advance: 'Чек предоплаты…',
      full: 'Чек полного расчёта…',
      refund: 'Чек возврата…',
      refund_advance: 'Чек возврата предоплаты…',
    };
    msg.textContent = labels[kind] || 'Чек…';
    try {
      const body = { send: true };
      if (parentReceiptId) body.parent_receipt_id = parentReceiptId;
      const r = await api('/crm/deals/' + encodeURIComponent(id) + '/fiscal/' + kind, {
        method: 'POST',
        body: JSON.stringify(body),
      });
      const st = r.receipt?.status || '';
      msg.textContent =
        'Чек: ' +
        st +
        (r.atol && !r.atol.configured ? ' (черновик — задайте АТОЛ в Настройках)' : '');
      renderDealDetail(id);
    } catch (e) {
      msg.textContent = e.message;
      alert(e.message);
    }
  };
  view.querySelectorAll('.deal-fiscal-refund-one').forEach((btn) => {
    btn.onclick = () => {
      if (
        !confirm(
          'Пробить чек возврата по этому чеку?\nДеньги на карту/СБП — отдельно в банке.'
        )
      ) {
        return;
      }
      makeFiscal(btn.dataset.kind || 'refund', btn.dataset.receipt);
    };
  });
  const invBtn = document.getElementById('deal-invoice');
  const woBtn = document.getElementById('deal-workorder');
  const updBtn = document.getElementById('deal-upd');
  const sfBtn = document.getElementById('deal-sf');
  const contractBtn = document.getElementById('deal-contract');
  if (invBtn) invBtn.onclick = () => makeSalesDoc('invoice');
  if (woBtn) woBtn.onclick = () => makeSalesDoc('workorder');
  if (updBtn) updBtn.onclick = () => makeSalesDoc('upd');
  if (sfBtn) sfBtn.onclick = () => makeSalesDoc('sf');
  if (contractBtn) contractBtn.onclick = () => makeSalesDoc('contract');
  view.querySelectorAll('.deal-doc-make').forEach((btn) => {
    btn.onclick = () => makeSalesDoc(btn.getAttribute('data-dtype') || 'invoice');
  });
  const updShipBtn = document.getElementById('deal-upd-ship');
  const docsUpdShip = document.getElementById('deal-docs-upd-ship');
  const runUpdShip = async (btn) => {
    const msg = document.getElementById('deal-msg');
    if (
      !confirm(
        'Создать УПД (товары и услуги) и провести расходную — списание товаров со склада?\nУслуги в расходную не входят.'
      )
    ) {
      return;
    }
    if (msg) msg.textContent = 'УПД + списание…';
    if (btn) btn.disabled = true;
    if (updShipBtn) updShipBtn.disabled = true;
    try {
      const organization_id = dealSelectedOrgId();
      state.dealOrgId = organization_id;
      const r = await api('/sales-docs/upd-and-writeoff-from-deal', {
        method: 'POST',
        body: JSON.stringify({ deal_id: id, organization_id }),
      });
      const doc = r.upd;
      if (msg) {
        msg.textContent =
          (doc?.number ? 'УПД ' + doc.number : 'УПД') +
          (r.stock_doc_number ? ' · расходная ' + r.stock_doc_number : '') +
          (r.stock_note ? ' — ' + r.stock_note : '');
      }
      if (doc?.id) {
        openTab('sales:' + doc.id, (doc.number || 'УПД').slice(0, 40));
      }
      if (r.stock_doc_id) {
        setTimeout(() => openTab('doc:' + r.stock_doc_id), 500);
      }
      setTimeout(() => {
        if (state.activeTab === 'deal:' + id) renderDealDetail(id);
      }, 600);
    } catch (e) {
      if (msg) msg.textContent = e.message;
      alert(e.message);
      if (btn) btn.disabled = false;
      if (updShipBtn) updShipBtn.disabled = false;
    }
  };
  if (updShipBtn) {
    updShipBtn.onclick = () => runUpdShip(updShipBtn);
  }
  if (docsUpdShip) {
    docsUpdShip.onclick = () => runUpdShip(docsUpdShip);
  }
}

async function renderSalesDocs(docType) {
  const type = String(docType || state.salesType || '').trim();
  state.salesType = type;
  const title = type ? SALES_TYPE_LABEL[type] || 'Документы продаж' : 'Документы продаж';
  const q = state.salesQ || '';
  const page = Math.max(1, Number(state.salesPage) || 1);
  const limit = getPageSize('sales', 50);
  const data = await api(
    withCompanyId(
      '/sales-docs?page=' +
        page +
        '&limit=' +
        limit +
        (type ? '&type=' + encodeURIComponent(type) : '') +
        (q ? '&q=' + encodeURIComponent(q) : '')
    )
  );
  const list = data.items || [];
  const total = Number(data.total) || list.length;
  const pages = Math.max(1, Number(data.pages) || 1);
  const typeTabs = [
    { id: '', label: 'Все' },
    { id: 'invoice', label: 'Счета' },
    { id: 'workorder', label: 'ЗН' },
    { id: 'upd', label: 'УПД' },
    { id: 'sf', label: 'СФ' },
    { id: 'contract', label: 'Договоры' },
  ];
  const showTypeCol = !type;
  const colSpan = showTypeCol ? 8 : 7;
  view.innerHTML = formChrome(
    title,
    `
    <p class="muted" style="margin:0 0 8px">
      ${
        type === 'contract'
          ? 'Журнал договоров. Создание: Документы → «Создать договор» или кнопка «Договор» в заказе покупателя. Клик по строке — карточка.'
          : `Журнал документов продаж${type ? ' · ' + esc(title) : ''}. Клик по строке — карточка. Организация — контур (Фогель…), юрлицо — кратко.`
      }
    </p>
    ${pagerHtml('salespager', page, pages, total, { limit, listKey: 'sales' })}
    <div class="table-scroll">
    <table class="data-table is-dense">
      <thead><tr>
        ${showTypeCol ? '<th>Тип</th>' : ''}
        <th>Дата</th><th>Номер</th><th>Организация</th><th>Юрлицо</th><th>Покупатель</th><th>Заказ</th><th>Сумма</th>
      </tr></thead>
      <tbody>
        ${
          list
            .map((d) => {
              const dt = String(d.doc_type || type || '');
              const isContract = dt === 'contract';
              const dealLabel = d.deal_id
                ? esc(d.deal_name ? `${d.deal_id} · ${d.deal_name}` : d.deal_id)
                : '—';
              const company = String(d.company_name || '').trim();
              const legalShort = String(d.organization_short || d.organization_name || '').trim();
              const legalTip = String(d.organization_name || '').trim();
              return `
          <tr class="clickable" data-sales="${esc(d.id)}">
            ${
              showTypeCol
                ? `<td>${esc(SALES_TYPE_LABEL[dt] || dt || '—')}</td>`
                : ''
            }
            <td>${esc(String(d.doc_date || '').slice(0, 10))}</td>
            <td class="mono">${esc(d.number)}</td>
            <td>${esc(company || '—')}</td>
            <td title="${esc(legalTip || legalShort)}">${esc(legalShort || '—')}${
              d.organization_inn
                ? `<div class="muted mono" style="font-size:11px">ИНН ${esc(d.organization_inn)}</div>`
                : ''
            }</td>
            <td>${esc(d.counterparty_name || '—')}</td>
            <td class="mono">${
              d.deal_id
                ? `<a href="#deal" data-deal-link="${esc(d.deal_id)}" onclick="event.stopPropagation()" title="${dealLabel}">${esc(d.deal_id)}</a>`
                : '—'
            }</td>
            <td class="mono">${isContract ? '—' : formatMoney(d.total)}</td>
          </tr>`;
            })
            .join('') ||
          `<tr><td colspan="${colSpan}" class="muted">${
            type === 'contract'
              ? 'Пока пусто — Документы → «Создать договор» по заказу покупателя'
              : type
                ? `Пока пусто — откройте заказ покупателя и создайте «${esc(title)}»`
                : 'Документов пока нет'
          }</td></tr>`
        }
      </tbody>
    </table>
    </div>
    ${pagerHtml('salespager2', page, pages, total, { limit, listKey: 'sales' })}`,
    {
      toolbar: `
        <div class="form-pagetabs" style="display:inline-flex;margin:0" id="sales-type-tabs" role="tablist" aria-label="Тип документа">
          ${typeTabs
            .map(
              (t) =>
                `<button type="button" class="form-pagetab ${t.id === type ? 'active' : ''}" data-sales-type="${esc(
                  t.id
                )}" role="tab" aria-selected="${t.id === type ? 'true' : 'false'}">${esc(t.label)}</button>`
            )
            .join('')}
        </div>
        <div class="grow"></div>
        <div class="find">
          <input id="sales-q" placeholder="Номер док. / № заказа / покупатель" value="${esc(q)}" />
          <button type="button" class="find-go" id="sales-search">Найти</button>
        </div>`,
    }
  );
  bindFormChrome(() => showSection('documents'));
  view.querySelectorAll('[data-sales-type]').forEach((btn) => {
    btn.onclick = () => {
      state.salesType = btn.getAttribute('data-sales-type') || '';
      state.salesPage = 1;
      const map = {
        invoice: 'invoices',
        workorder: 'workorders',
        upd: 'upd',
        sf: 'sf',
        contract: 'contracts',
      };
      const tab = map[state.salesType];
      if (tab) openTab(tab);
      else renderSalesDocs(state.salesType);
    };
  });
  document.getElementById('sales-search').onclick = () => {
    state.salesQ = document.getElementById('sales-q').value.trim();
    state.salesPage = 1;
    renderSalesDocs(type);
  };
  document.getElementById('sales-q').onkeydown = (e) => {
    if (e.key === 'Enter') {
      state.salesQ = document.getElementById('sales-q').value.trim();
      state.salesPage = 1;
      renderSalesDocs(type);
    }
  };
  view.querySelectorAll('[data-sales]').forEach((tr) => {
    tr.onclick = () => openTab('sales:' + tr.dataset.sales);
  });
  view.querySelectorAll('[data-deal-link]').forEach((a) => {
    a.onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      openTab('deal:' + a.dataset.dealLink);
    };
  });
  bindListPager(['salespager', 'salespager2'], 'sales', 'salesPage', () => renderSalesDocs(type));
}

/** Создать договор по заказу покупателя (сделке). */
async function renderContractCreate() {
  await refreshRefs();
  view.innerHTML = formChrome(
    'Создать договор',
    `
    <p class="muted" style="margin:0 0 12px">
      Договор купли-продажи и услуг (шаблон БМП) на основании <b>заказа покупателя</b>.
      Реквизиты продавца — выбранное юрлицо; покупатель подставится из заказа.
    </p>
    <div class="form-grid">
      <label class="span-2">Заказ покупателя
        <span class="suggest-anchor">
          <input id="ct-deal-q" autocomplete="off" placeholder="Номер / ФИО / компания / id заказа" />
          <input type="hidden" id="ct-deal-id" value="" />
          <div id="ct-deal-suggest" class="suggest hidden"></div>
        </span>
      </label>
      <label class="span-2">Выбрано
        <input id="ct-deal-picked" readonly placeholder="ещё не выбран" />
      </label>
      <label class="span-2">Юрлицо продавца
        <select id="ct-org">${orgOptionsHtml('')}</select>
      </label>
    </div>
    <p class="muted" id="ct-msg" style="margin-top:10px"></p>`,
    {
      toolbar: `
        <button type="button" class="primary" id="ct-create" disabled>Создать договор</button>
        <button type="button" id="ct-cancel">К журналу</button>
        <div class="grow"></div>`,
    }
  );
  bindFormChrome(() => showSection('documents'));
  document.getElementById('ct-cancel').onclick = () => openTab('contracts');

  const qInput = document.getElementById('ct-deal-q');
  const hid = document.getElementById('ct-deal-id');
  const suggest = document.getElementById('ct-deal-suggest');
  const picked = document.getElementById('ct-deal-picked');
  const createBtn = document.getElementById('ct-create');
  const msg = document.getElementById('ct-msg');

  const dealLabel = (d) => {
    const num = String(d.number || d.id || '').trim();
    const fio = String(d.buyer_name || d.contact_name || '').trim();
    const company = String(d.company_name || '').trim();
    const name = String(d.name || '').trim();
    return [num ? '№ ' + num : '', fio || company || name].filter(Boolean).join(' · ') || num || d.id;
  };

  const pickDeal = (id, label) => {
    hid.value = id;
    picked.value = label || id;
    qInput.value = label || id;
    suggest.classList.add('hidden');
    createBtn.disabled = !id;
  };

  let suggestTimer = 0;
  const runSuggest = async () => {
    const q = qInput.value.trim();
    if (q.length < 1) {
      suggest.classList.add('hidden');
      suggest.innerHTML = '';
      return;
    }
    try {
      const data = await api(
        '/crm/deals?limit=20&sort=updated_at&dir=desc&q=' + encodeURIComponent(q)
      );
      const items = data.items || [];
      if (!items.length) {
        suggest.innerHTML = '<div class="suggest-item muted">Ничего не найдено</div>';
        suggest.classList.remove('hidden');
        return;
      }
      suggest.innerHTML = items
        .map(
          (d) =>
            `<button type="button" class="suggest-item" data-id="${esc(d.id)}" data-label="${esc(dealLabel(d))}">
              <b>${esc(dealLabel(d))}</b>
              <span class="muted" style="display:block;font-size:11px">${esc(d.id)}</span>
            </button>`
        )
        .join('');
      suggest.classList.remove('hidden');
      suggest.querySelectorAll('[data-id]').forEach((btn) => {
        btn.onclick = () => pickDeal(btn.dataset.id, btn.dataset.label);
      });
    } catch (e) {
      suggest.innerHTML = `<div class="suggest-item error">${esc(e.message)}</div>`;
      suggest.classList.remove('hidden');
    }
  };

  qInput.oninput = () => {
    hid.value = '';
    picked.value = '';
    createBtn.disabled = true;
    clearTimeout(suggestTimer);
    suggestTimer = setTimeout(runSuggest, 220);
  };
  qInput.onkeydown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      clearTimeout(suggestTimer);
      runSuggest();
    }
  };
  document.addEventListener(
    'click',
    (e) => {
      if (!suggest.contains(e.target) && e.target !== qInput) suggest.classList.add('hidden');
    },
    { once: false }
  );

  createBtn.onclick = async () => {
    const deal_id = hid.value.trim();
    if (!deal_id) {
      msg.textContent = 'Выберите заказ покупателя';
      return;
    }
    createBtn.disabled = true;
    msg.textContent = 'Создание…';
    try {
      const organization_id = selectedOrgId('ct-org');
      const r = await api('/contracts', {
        method: 'POST',
        body: JSON.stringify({ deal_id, organization_id }),
      });
      const doc = r.doc;
      msg.textContent = 'Создано: ' + (doc?.number || '');
      if (doc?.id) {
        window.open('/api/sales-docs/' + encodeURIComponent(doc.id) + '/print', '_blank');
        openTab('sales:' + doc.id, (doc.number || 'Договор').slice(0, 40));
      }
    } catch (e) {
      msg.textContent = e.message || String(e);
      createBtn.disabled = false;
    }
  };
}

async function renderSalesDocDetail(id) {
  const d = await api('/sales-docs/' + id);
  const typeLabel = SALES_TYPE_LABEL[d.doc_type] || d.doc_type;
  const title = `${typeLabel} ${d.number || ''}`.trim();
  const tabId = 'sales:' + id;
  if (!state.tabs.find((t) => t.id === tabId)) {
    state.tabs.push({ id: tabId, title: title.slice(0, 40), closable: true });
  } else {
    const t = state.tabs.find((x) => x.id === tabId);
    if (t) t.title = title.slice(0, 40);
  }
  state.activeTab = tabId;
  renderTabs();
  showForm();
  highlightSection(sectionForTab(tabId));
  setUrl(pathForTab(tabId));
  const lines = d.lines || [];
  const linesSum = lines.reduce((s, l) => s + (Number(l.amount) || 0), 0);
  const isUpd = d.doc_type === 'upd';
  const linesTitle = isUpd
    ? `Реализованные / списанные позиции (${lines.length})`
    : `Строки документа (${lines.length})`;
  const backView =
    d.doc_type === 'upd'
      ? 'upd'
      : d.doc_type === 'sf'
        ? 'sf'
        : d.doc_type === 'workorder'
          ? 'workorders'
          : d.doc_type === 'contract'
            ? 'contracts'
            : 'invoices';
  let dealDocs = [];
  const dealId = String(d.deal_id || '').trim();
  if (dealId) {
    try {
      const rel = await api(
        withCompanyId('/sales-docs?deal_id=' + encodeURIComponent(dealId) + '&limit=100')
      );
      dealDocs = rel.items || [];
    } catch (_) {
      dealDocs = [];
    }
  }
  const stockOuts = dealId ? await loadDealStockOuts(dealId) : [];
  const salesXfers = dealId ? await loadDealTransferOrders(dealId) : [];
  const salesNeedContract = dealId ? await fetchDealNeedsContract(dealId) : true;
  const salesDocTree = dealId ? await loadDealDocTree(dealId) : null;
  const salesFiscalAlert = dealId
    ? await fetchDealFiscalAlert(dealId)
    : { alert: false, tip: '' };
  let dealPayHint = '';
  let dealPayPanelHtml = '';
  let salesDealRow = null;
  if (dealId) {
    try {
      salesDealRow = await api('/crm/deals/' + encodeURIComponent(dealId));
      rememberDealHint(salesDealRow);
    } catch (_) {
      salesDealRow = null;
    }
  }
  if (dealId && d.doc_type === 'invoice' && salesDealRow) {
    try {
      const dealRow = salesDealRow;
      const byInvoice = dealPaysByInvoice(dealRow);
      const split = dealRow.payment_split || {};
      const payments = Array.isArray(dealRow.payments) ? dealRow.payments : [];
      const paidOk = (p) =>
        ['paid', 'confirmed', 'success', 'accepted'].includes(
          String(p.status || '').toLowerCase()
        );
      const paidList = payments.filter(paidOk);
      const paidTotal =
        Number(split.paid_total) ||
        paidList.reduce((s, p) => s + (Number(p.amount) || 0), 0) ||
        0;
      const orderTotal =
        Number(split.total) || Number(dealRow.price) || Number(d.total) || Number(d.amount) || 0;
      const dueTotal =
        split.due_total != null && split.due_total !== ''
          ? Number(split.due_total)
          : Math.max(0, orderTotal - paidTotal);
      const fmtWhen = (raw) => {
        const s = String(raw || '').replace('T', ' ');
        return s.length >= 16 ? s.slice(0, 16) : s.slice(0, 10);
      };
      const kindRu = (k) => {
        const x = String(k || '').toLowerCase();
        if (x === 'cash') return 'нал';
        if (x === 'sbp_qr') return 'СБП';
        if (x === 'yandex' || x === 'yandex_pay') return 'карта';
        if (x === 'bank' || x === 'rs') return 'р/с';
        return k || 'оплата';
      };
      let payStatusHtml = '';
      if (paidTotal > 0.009 || paidList.length) {
        const last = paidList[0];
        const lastLine = last
          ? `${fmtWhen(last.created_at)} · ${kindRu(last.kind)} · ${formatMoney(last.amount)}`
          : '';
        payStatusHtml = `<div class="sd-pay-balance${dueTotal > 0.009 ? ' is-due' : ' is-paid'}">
          <div><b>Оплачено ${esc(formatMoney(paidTotal))}</b>${
            orderTotal > 0.009 ? ` из ${esc(formatMoney(orderTotal))}` : ''
          }${
            dueTotal > 0.009
              ? ` · остаток <b class="mono">${esc(formatMoney(dueTotal))}</b>`
              : ' · полностью'
          }</div>
          ${
            lastLine
              ? `<div class="muted" style="font-size:11px;margin-top:2px">Последняя: ${esc(lastLine)}</div>`
              : ''
          }
          ${
            paidList.length > 1
              ? `<ul class="sd-pay-history">${paidList
                  .slice(0, 5)
                  .map(
                    (p) =>
                      `<li>${esc(fmtWhen(p.created_at))} · ${esc(kindRu(p.kind))} · <span class="mono">${esc(
                        formatMoney(p.amount)
                      )}</span></li>`
                  )
                  .join('')}</ul>`
              : ''
          }
        </div>`;
        dealPayHint = '';
      } else if (orderTotal > 0.009) {
        payStatusHtml = `<div class="sd-pay-balance is-due">К оплате: <b class="mono">${esc(
          formatMoney(dueTotal > 0.009 ? dueTotal : orderTotal)
        )}</b></div>`;
      }
      let payLinks = [];
      try {
        const pl = await api('/crm/deals/' + encodeURIComponent(dealId) + '/payment-links');
        payLinks = Array.isArray(pl.items) ? pl.items : [];
      } catch (_) {
        payLinks = [];
      }
      const activeLink =
        payLinks.find((x) => String(x.status || '') === 'pending') || payLinks[0] || null;
      const linkUrl = activeLink
        ? String(activeLink.url || '').trim() ||
          (activeLink.token ? '/pay/' + encodeURIComponent(String(activeLink.token)) : '')
        : '';
      const token = activeLink ? String(activeLink.token || '').trim() : '';
      const acqUrl = activeLink ? String(activeLink.acquiring_url || '').trim() : '';
      const st = activeLink ? String(activeLink.status || '') : '';
      const stLabel =
        st === 'pending'
          ? 'ожидает оплаты'
          : st === 'paid'
            ? 'оплачено'
            : st === 'expired'
              ? 'истекла'
              : st || '';
      const qrSrc = token
        ? '/api/public/pay/' +
          encodeURIComponent(token) +
          '/qr.png?v=' +
          encodeURIComponent(String(activeLink.payment_id || token))
        : '';
      const payTitle = byInvoice ? 'Оплата · счёт или карта / СБП' : 'Оплата · физлицо';
      const payLead = byInvoice
        ? 'Можно переводом по счёту (PDF) или по ссылке: QR СБП, Сплит и карта.'
        : 'Счёт — для чеков АТОЛ. Клиенту отдайте ссылку: на странице QR СБП, Сплит и карта.';
      dealPayPanelHtml = `<div class="sd-pay-panel" style="margin:0 0 12px;padding:12px 14px;border:1px solid #e2e8f0;border-radius:10px;background:#f8fafc">
          ${payStatusHtml}
          <div style="display:flex;flex-wrap:wrap;gap:14px;align-items:flex-start">
            ${
              qrSrc && st === 'pending'
                ? `<div style="flex:0 0 auto;text-align:center">
              <img src="${esc(qrSrc)}" alt="QR СБП" width="128" height="128" style="display:block;background:#fff;border:1px solid #ddd;border-radius:10px;padding:6px" />
              <div class="muted" style="font-size:11px;margin-top:4px">QR СБП</div>
            </div>`
                : ''
            }
            <div style="flex:1 1 240px;min-width:0">
              <div style="font-weight:700;margin:0 0 4px">${esc(payTitle)}</div>
              <p class="muted" style="margin:0 0 8px;font-size:12px;line-height:1.4">${esc(payLead)}</p>
              ${
                linkUrl
                  ? `<div class="toolbar" style="margin:0 0 8px;padding:0;flex-wrap:wrap;align-items:center">
                <input class="mono" id="sd-pay-url" readonly value="${esc(linkUrl)}" style="flex:1 1 220px;min-width:180px;font-size:12px" />
                <button type="button" id="sd-pay-copy" data-tip="Копировать ссылку">Копировать</button>
                <a href="${esc(linkUrl)}" target="_blank" rel="noopener" id="sd-pay-open">Открыть · QR · Сплит · карта</a>
                ${
                  acqUrl
                    ? `<a href="${esc(acqUrl)}" target="_blank" rel="noopener" title="Прямой эквайринг">Только карта</a>`
                    : ''
                }
              </div>
              <div class="muted" style="font-size:11px;margin:0 0 8px">
                ${esc(stLabel)}${activeLink.amount != null ? ' · ' + formatMoney(activeLink.amount) : ''}${
                    activeLink.expires_at
                      ? ' · до ' + esc(String(activeLink.expires_at).replace('T', ' ').slice(0, 16))
                      : ''
                  }
              </div>`
                  : `<p class="muted" style="margin:0 0 8px;font-size:12px">Ссылки ещё нет — создайте, чтобы клиент оплатил QR / Сплит / картой.</p>`
              }
              <div class="toolbar" style="margin:0;padding:0;flex-wrap:wrap;align-items:center">
                <button class="primary" type="button" id="sd-pay-link" ${
                  Number(dealRow.price) > 0 || Number(d.amount) > 0 ? '' : 'disabled'
                } data-tip="Создать или обновить ссылку на оплату">Ссылка на оплату · QR · Сплит · карта</button>
                <span class="muted" id="sd-pay-msg" style="font-size:12px"></span>
              </div>
            </div>
          </div>
        </div>`;
    } catch (_) {
      /* ignore */
    }
  }
  const salesRules = (salesDealRow && salesDealRow.sale_rules) || null;
  const linkTabs = buildOrderLinkTabs({
    dealId,
    current: {
      kind: 'sales',
      id,
      docType: d.doc_type,
    },
    siblings: dealDocs,
    stockOuts,
    transferOrders: salesXfers,
    allowCreate: !!dealId,
    needContract: salesNeedContract,
    docPack: Array.isArray(salesDealRow && salesDealRow.doc_pack_types)
      ? salesDealRow.doc_pack_types
      : salesRules && Array.isArray(salesRules.doc_pack)
        ? salesRules.doc_pack
        : null,
    saleRules: salesRules,
    personNoUpd:
      salesDealRow &&
      !dealNeedsContract(salesDealRow) &&
      !String(salesDealRow.buyer_inn || '').replace(/\D/g, ''),
    needTransfer:
      Number(salesDealRow && salesDealRow.is_sto) === 1 ||
      !!(salesRules && salesRules.is_sto),
    invoiceAlert: salesFiscalAlert.alert,
    invoiceAlertTip: salesFiscalAlert.tip,
    ...chainIncompleteOpts(salesDocTree),
  });
  const legalFull = (d.org && d.org.name) || d.organization_name || '—';
  const legalShort =
    (d.org && d.org.short_name) || d.organization_short || '';
  const isContract = d.doc_type === 'contract';
  const isWorkorder = d.doc_type === 'workorder';
  const woHasPlate = isWorkorder && !!String(d.car_plate || '').trim();
  const stsPh = d.sts_photos || {};
  const woAutoSummary = [
    d.car_plate,
    [d.car_brand, d.car_model].filter(Boolean).join(' '),
    d.car_year,
    d.car_color,
  ]
    .filter(Boolean)
    .join(' · ');
  const garageVehicles = Array.isArray(d.garage_vehicles) ? d.garage_vehicles : [];
  const buyerCpId = String(d.buyer_counterparty_id || '').trim();
  const curPlateNorm = String(d.car_plate || '')
    .toUpperCase()
    .replace(/\s+/g, '');
  const garageCardsHtml = (() => {
    const cards = garageVehicles
      .map((v) => {
        const plate = String(v.car_plate || '').trim();
        const plateN = plate.toUpperCase().replace(/\s+/g, '');
        const title = [v.car_brand, v.car_model].filter(Boolean).join(' ') || 'Авто';
        const active = curPlateNorm && plateN === curPlateNorm;
        return `<button type="button" class="wo-garage-card${active ? ' is-active' : ''}" data-garage-id="${esc(
          v.id || ''
        )}" title="Выбрать для этого ЗН">
          <span class="wo-garage-plate mono">${esc(plate || 'без номера')}</span>
          <span class="wo-garage-title">${esc(title)}</span>
          <span class="wo-garage-sub muted">${esc(
            [v.car_year, v.car_color].filter(Boolean).join(' · ') || '—'
          )}</span>
        </button>`;
      })
      .join('');
    return `
      <div class="span-2 wo-garage" id="wo-garage">
        <div class="wo-garage-head">
          <span class="wo-garage-label">Авто клиента</span>
          ${
            buyerCpId
              ? `<span class="muted" style="font-size:11px">сохраняются за контрагентом · можно несколько</span>`
              : `<span class="muted" style="font-size:11px">контрагент не привязан — только в ЗН</span>`
          }
        </div>
        <div class="wo-garage-list">
          ${cards || `<span class="muted wo-garage-empty">Пока нет сохранённых авто</span>`}
          <button type="button" class="wo-garage-card wo-garage-new" id="wo-garage-new" title="Новое авто">
            <span class="wo-garage-plate">+</span>
            <span class="wo-garage-title">Другое авто</span>
            <span class="wo-garage-sub muted">СТС / вручную</span>
          </button>
        </div>
      </div>`;
  })();
  const workorderVehicleHtml = isWorkorder
    ? `
    <details class="wo-auto-panel${woHasPlate ? ' is-ready' : ''}" id="wo-auto-panel"${
        woHasPlate ? '' : ' open'
      }>
      <summary class="wo-auto-summary">
        <span class="wo-auto-summary-title">1. Автомобиль</span>
        <span class="wo-auto-summary-meta muted">${esc(
          woHasPlate
            ? woAutoSummary || 'заполнено'
            : 'выберите авто или заполните — иначе нет бланка и PDF'
        )}</span>
        <span class="wo-auto-chevron" aria-hidden="true"></span>
      </summary>
      <div class="form-grid wo-auto-grid" id="sd-vehicle"
           data-cp-id="${esc(buyerCpId)}"
           data-garage-id="">
        ${garageCardsHtml}
        <div class="span-2 sts-photos-row">
          <div class="sts-thumbs">
          ${
            stsPh.front && stsPh.front_url
              ? `<a class="sts-thumb" href="${esc(stsPh.front_url)}" target="_blank" rel="noopener" title="Лицевая"><img src="${esc(stsPh.front_url)}?t=${Date.now()}" alt="Лицевая" /><span>Лицевая</span></a>`
              : ''
          }
          ${
            stsPh.back && stsPh.back_url
              ? `<a class="sts-thumb" href="${esc(stsPh.back_url)}" target="_blank" rel="noopener" title="Оборот"><img src="${esc(stsPh.back_url)}?t=${Date.now()}" alt="Оборот" /><span>Оборот</span></a>`
              : ''
          }
          </div>
          <label class="sts-upload-label" style="margin:0">Фото СТС
            <input type="file" id="sd-sts-photos" accept="image/*" capture="environment" multiple />
          </label>
          <button type="button" class="primary" id="sd-sts-ocr" ${dealId ? '' : 'disabled'}>${
            stsPh.front || stsPh.back ? 'Распознать СТС' : 'Загрузить и распознать'
          }</button>
          <span class="muted" id="sd-sts-ocr-msg" style="font-size:12px"></span>
        </div>
        <label>Гос. номер<input id="sd-car-plate" value="${esc(d.car_plate || '')}" placeholder="А123ВС777" autocomplete="off" /></label>
        <label>VIN<input id="sd-car-vin" class="mono" value="${esc(d.car_vin || '')}" autocomplete="off" /></label>
        <label>Марка<input id="sd-car-brand" value="${esc(d.car_brand || '')}" autocomplete="off" /></label>
        <label>Модель<input id="sd-car-model" value="${esc(d.car_model || '')}" autocomplete="off" /></label>
        <label>Год<input id="sd-car-year" value="${esc(d.car_year || '')}" inputmode="numeric" autocomplete="off" /></label>
        <label>Цвет<input id="sd-car-color" value="${esc(d.car_color || '')}" autocomplete="off" /></label>
        <label>Паспорт ТС<input id="sd-car-pts" value="${esc(d.car_pts || '')}" autocomplete="off" /></label>
        <label>Пробег<input id="sd-car-mileage" value="${esc(d.car_mileage || '')}" inputmode="numeric" autocomplete="off" /></label>
        <label>№ СТС<input id="sd-car-sts-number" value="${esc(d.car_sts_number || '')}" autocomplete="off" /></label>
        <div class="toolbar span-2 wo-auto-actions" style="margin:0;padding:0">
          <button type="button" class="primary" id="sd-vehicle-save">Сохранить авто</button>
          <span class="muted" id="sd-vehicle-msg" style="font-size:12px"></span>
        </div>
      </div>
    </details>`
    : '';
  const contractBuyerHtml = isContract
    ? `
    <h3 class="form-section-title">Покупатель (заказчик)</h3>
    <p class="muted" style="margin:0 0 10px;font-size:12px">
      Реквизиты для договора: наименование, «в лице», ИНН/КПП/ОГРН, адрес, банк, контакты.
      Подставляются из карточки контрагента / заказа; можно поправить перед печатью.
    </p>
    <div class="form-grid" id="sd-contract-buyer">
      <label class="span-2">Наименование
        <input id="sd-buyer-name" value="${esc(d.counterparty_name || '')}" autocomplete="organization" />
      </label>
      <label class="span-2">В лице
        <input id="sd-buyer-director" value="${esc(d.buyer_director || '')}" placeholder="Генерального директора Иванова И.И." autocomplete="off" />
      </label>
      <label>ИНН<input id="sd-buyer-inn" class="mono" value="${esc(d.counterparty_inn || '')}" inputmode="numeric" /></label>
      <label>КПП<input id="sd-buyer-kpp" class="mono" value="${esc(d.buyer_kpp || '')}" inputmode="numeric" /></label>
      <label>ОГРН / ОГРНИП<input id="sd-buyer-ogrn" class="mono" value="${esc(d.buyer_ogrn || '')}" inputmode="numeric" /></label>
      <label>Телефон<input id="sd-buyer-phone" value="${esc(d.buyer_phone || '')}" autocomplete="tel" /></label>
      <label class="span-2">Адрес
        <input id="sd-buyer-address" value="${esc(d.buyer_address || '')}" autocomplete="street-address" />
      </label>
      <label class="span-2">E-mail
        <input id="sd-buyer-email" value="${esc(d.buyer_email || '')}" autocomplete="email" />
      </label>
      <label class="span-2">Банк
        <input id="sd-buyer-bank" value="${esc(d.buyer_bank || '')}" />
      </label>
      <label>БИК<input id="sd-buyer-bik" class="mono" value="${esc(d.buyer_bik || '')}" inputmode="numeric" /></label>
      <label>Р/с<input id="sd-buyer-rs" class="mono" value="${esc(d.buyer_rs || '')}" inputmode="numeric" /></label>
      <label class="span-2">К/с
        <input id="sd-buyer-ks" class="mono" value="${esc(d.buyer_ks || '')}" inputmode="numeric" />
      </label>
      <div class="toolbar span-2" style="margin:0;padding:0">
        <button type="button" class="primary" id="sd-buyer-save">Сохранить реквизиты</button>
        <span class="muted" id="sd-buyer-msg" style="font-size:12px"></span>
      </div>
    </div>`
    : '';
  const showWoDoc = !isWorkorder || woHasPlate;
  const docHeadHtml =
    isUpd
      ? `<p class="muted" style="margin:0 0 10px;font-size:11px">Ниже — товары, отгруженные/списанные по этой УПД. Связь строки УПД с конкретным приходом (FIFO-партия) в БД не хранится.</p>`
      : '';
  const docMetaHtml = showWoDoc
    ? `<div class="form-grid">
      <label>Тип<input value="${esc(typeLabel)}" readonly /></label>
      <label>Номер<input class="mono" value="${esc(d.number || '')}" readonly /></label>
      <label>Дата<input value="${esc(String(d.doc_date || '').slice(0, 10))}" readonly /></label>
      <label>Заказ покупателя<input class="mono" value="${esc(d.deal_id || '')}" readonly /></label>
      ${
        isContract
          ? `<label class="span-2">Комментарий<input value="${esc(d.comment || '')}" readonly /></label>`
          : `
      <label>Покупатель
        <input id="sd-cp-name" value="${esc(d.counterparty_name || '')}" autocomplete="name" />
        <span class="muted" id="sd-cp-name-msg" style="font-size:11px;display:block;margin-top:2px"></span>
      </label>
      <label>ИНН покупателя<input class="mono" value="${esc(d.counterparty_inn || '—')}" readonly /></label>
      <div class="span-2 sd-money-strip" aria-label="Суммы">
        <div class="sd-money-cell">
          <span class="sd-money-k">Без НДС</span>
          <span class="sd-money-v mono">${esc(formatMoney(d.amount))}</span>
        </div>
        <div class="sd-money-cell">
          <span class="sd-money-k">НДС ${esc(d.vat_rate || 0)}%</span>
          <span class="sd-money-v mono">${esc(formatMoney(d.vat_amount))}</span>
        </div>
        <div class="sd-money-cell sd-money-total">
          <span class="sd-money-k">Всего</span>
          <span class="sd-money-v mono">${esc(formatMoney(d.total))}</span>
        </div>
      </div>`
      }
    </div>`
    : isWorkorder
      ? `<div class="form-grid" style="margin-bottom:8px">
          <label>Номер ЗН<input class="mono" value="${esc(d.number || '')}" readonly /></label>
          <label>Заказ<input class="mono" value="${esc(d.deal_id || '')}" readonly /></label>
        </div>`
      : '';
  const linesHtml =
    isContract || !showWoDoc
      ? ''
      : `
    <h3 class="form-section-title">${isWorkorder ? '2. ' : ''}${esc(linesTitle)}</h3>
    ${
      lines.length
        ? `<table>
        <thead><tr><th>№</th><th>SKU</th><th>Название</th><th>Кол-во</th><th>Цена</th><th>Без НДС</th><th>НДС</th></tr></thead>
        <tbody>
          ${lines
            .map((l) => {
              const pid = l.product_id || l.product_guid || '';
              return `
            <tr class="${pid ? 'clickable' : ''}" ${pid ? `data-product="${esc(pid)}"` : ''}>
              <td class="mono">${esc(l.line_no)}</td>
              <td class="mono">${esc(l.sku || '')}</td>
              <td>${esc(l.name || '')}</td>
              <td class="mono">${esc(l.qty)}</td>
              <td class="mono">${formatMoney(l.price)}</td>
              <td class="mono">${formatMoney(l.amount)}</td>
              <td class="mono">${formatMoney(l.vat_amount)}</td>
            </tr>`;
            })
            .join('')}
        </tbody>
        <tfoot>
          <tr>
            <td colspan="5" style="text-align:right"><strong>Итого без НДС</strong></td>
            <td class="mono"><strong>${formatMoney(d.amount != null ? d.amount : linesSum)}</strong></td>
            <td class="mono"><strong>${formatMoney(d.vat_amount)}</strong></td>
          </tr>
        </tfoot>
      </table>`
        : '<p class="muted">Нет строк — документ без состава (проверьте синк / формирование из заказа).</p>'
    }`;
  view.innerHTML = formChrome(
    title,
    `
    ${dealPayPanelHtml}
    ${
      dealPayHint
        ? `<p class="muted" style="margin:0 0 10px;font-size:12px;padding:8px 10px;border:1px solid #e2e8f0;border-radius:8px;background:#f8fafc">${esc(
            dealPayHint
          )}</p>`
        : ''
    }
    ${workorderVehicleHtml}
    ${showWoDoc ? docHeadHtml : ''}
    ${docMetaHtml}
    ${contractBuyerHtml}
    ${linesHtml}
    `,
    {
      toolbar: `
        <span class="muted" id="sd-link-msg" style="font-size:12px">${
          isWorkorder && !woHasPlate
            ? 'Сначала сохраните гос. номер — затем можно скачать PDF'
            : ''
        }</span>
        ${
          d.doc_type === 'invoice' && dealId
            ? `<span class="toolbar-group" role="group" aria-label="Чеки АТОЛ">
          <span class="toolbar-group-label">Чеки</span>
          <button type="button" id="sd-fiscal-advance" title="Чек предоплаты (АТОЛ)">1 · предоплата</button>
          <button type="button" id="sd-fiscal-full" title="Чек полного расчёта (АТОЛ)">2 · полный</button>
        </span>`
            : ''
        }
        <div class="grow"></div>
        ${salesDocPdfBarHtml({
          id,
          prefix: 'sd',
          disabled: isWorkorder && !woHasPlate,
          disabledTip: 'Сначала сохраните гос. номер — затем можно открыть PDF',
          showDeal: !!d.deal_id,
          dealId: d.deal_id || '',
          showPrintHtml: isContract,
        })}`,
      pageTabs: linkTabs.length ? linkTabs : undefined,
      activePageTab: 'sales:' + id,
      hintBar: dealHintBarHtml(salesDealRow),
    }
  );
  bindFormChrome(() => openTab(backView));
  if (dealId) bindDealHintBar(dealId);
  bindOrderLinkTabs(view, {
    dealId,
    onCreate: async (action, btn) => {
      if (!dealId) return;
      const msg = document.getElementById('sd-link-msg');
      if (btn) btn.disabled = true;
      try {
        if (action === 'transfer') {
          await createDealTransferOrder(dealId, msg);
          return;
        }
        await createLinkedSalesDoc(dealId, action, d.organization_id || '', msg);
      } catch (e) {
        if (msg) msg.textContent = e.message || String(e);
        alert(e.message || String(e));
        if (btn) btn.disabled = false;
      }
    },
  });
  document.getElementById('sd-pay-copy')?.addEventListener('click', async () => {
    const input = document.getElementById('sd-pay-url');
    const url = String(input?.value || '').trim();
    const msg = document.getElementById('sd-pay-msg');
    if (!url) return;
    try {
      if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(url);
      else {
        input?.select?.();
        document.execCommand('copy');
      }
      if (msg) msg.textContent = 'Ссылка скопирована';
    } catch (e) {
      if (msg) msg.textContent = e.message || 'Не удалось скопировать';
    }
  });
  document.getElementById('sd-pay-link')?.addEventListener('click', async () => {
    if (!dealId) return;
    const btn = document.getElementById('sd-pay-link');
    const msg = document.getElementById('sd-pay-msg');
    if (btn) btn.disabled = true;
    if (msg) msg.textContent = 'Создание ссылки…';
    try {
      const r = await api('/crm/deals/' + encodeURIComponent(dealId) + '/payment-link', {
        method: 'POST',
        body: JSON.stringify({ organization_id: d.organization_id || undefined }),
      });
      const url = String(r.url || '').trim();
      if (url && navigator.clipboard?.writeText) {
        try {
          await navigator.clipboard.writeText(url);
        } catch (_) {
          /* ignore */
        }
      }
      if (url) window.open(url, '_blank', 'noopener');
      if (msg) msg.textContent = url ? 'Ссылка создана и скопирована' : 'Ссылка создана';
      setTimeout(() => renderSalesDocDetail(id), 300);
    } catch (e) {
      if (msg) msg.textContent = e.message || String(e);
      alert(e.message || String(e));
      if (btn) btn.disabled = false;
    }
  });
  const fillWoVehicleFields = (v) => {
    const set = (elId, val) => {
      const el = document.getElementById(elId);
      if (el) el.value = val != null ? String(val) : '';
    };
    set('sd-car-plate', v.car_plate || '');
    set('sd-car-vin', v.car_vin || '');
    set('sd-car-brand', v.car_brand || '');
    set('sd-car-model', v.car_model || '');
    set('sd-car-year', v.car_year || '');
    set('sd-car-color', v.car_color || '');
    set('sd-car-pts', v.car_pts || '');
    set('sd-car-sts-number', v.car_sts_number || '');
    // пробег — на визит, при выборе из гаража не затираем текущий
  };
  const markGarageActive = (garageId) => {
    const root = document.getElementById('sd-vehicle');
    if (root) root.dataset.garageId = garageId || '';
    document.querySelectorAll('.wo-garage-card[data-garage-id]').forEach((el) => {
      el.classList.toggle('is-active', garageId && el.getAttribute('data-garage-id') === garageId);
    });
    document.getElementById('wo-garage-new')?.classList.toggle('is-active', !garageId);
  };
  // подсветить карточку текущего номера
  {
    const match = (Array.isArray(d.garage_vehicles) ? d.garage_vehicles : []).find(
      (v) =>
        String(v.car_plate || '')
          .toUpperCase()
          .replace(/\s+/g, '') ===
        String(d.car_plate || '')
          .toUpperCase()
          .replace(/\s+/g, '')
    );
    if (match) markGarageActive(match.id);
  }
  document.getElementById('wo-garage')?.addEventListener('click', async (ev) => {
    const btn = ev.target.closest('.wo-garage-card');
    if (!btn) return;
    if (btn.id === 'wo-garage-new') {
      fillWoVehicleFields({});
      const mil = document.getElementById('sd-car-mileage');
      if (mil) mil.value = '';
      markGarageActive('');
      document.getElementById('wo-auto-panel')?.setAttribute('open', '');
      document.getElementById('sd-car-plate')?.focus();
      const msg = document.getElementById('sd-vehicle-msg');
      if (msg) msg.textContent = 'Новое авто — заполните и сохраните';
      return;
    }
    const gid = btn.getAttribute('data-garage-id') || '';
    const v = (Array.isArray(d.garage_vehicles) ? d.garage_vehicles : []).find((x) => x.id === gid);
    if (!v) return;
    fillWoVehicleFields(v);
    markGarageActive(gid);
    document.getElementById('wo-auto-panel')?.setAttribute('open', '');
    const msg = document.getElementById('sd-vehicle-msg');
    const saveBtn = document.getElementById('sd-vehicle-save');
    if (msg) msg.textContent = 'Подставили — сохраняем в ЗН…';
    if (saveBtn) saveBtn.click();
  });
  document.getElementById('sd-vehicle-save')?.addEventListener('click', async () => {
    const msg = document.getElementById('sd-vehicle-msg');
    const btn = document.getElementById('sd-vehicle-save');
    const val = (elId) => String(document.getElementById(elId)?.value || '').trim();
    if (btn) btn.disabled = true;
    if (msg) msg.textContent = 'Сохранение…';
    try {
      const garageId = document.getElementById('sd-vehicle')?.dataset?.garageId || '';
      const body = {
        car_plate: val('sd-car-plate'),
        car_vin: val('sd-car-vin'),
        car_brand: val('sd-car-brand'),
        car_model: val('sd-car-model'),
        car_year: val('sd-car-year'),
        car_color: val('sd-car-color'),
        car_category: d.car_category || '',
        car_pts: val('sd-car-pts'),
        car_mileage: val('sd-car-mileage'),
        car_owner: d.car_owner || '',
        car_owner_street: d.car_owner_street || '',
        car_owner_house: d.car_owner_house || '',
        car_owner_flat: d.car_owner_flat || '',
        car_sts_date: d.car_sts_date || '',
        car_sts_number: val('sd-car-sts-number'),
        save_garage: true,
        garage_vehicle_id: garageId,
      };
      const r = await api('/sales-docs/' + encodeURIComponent(id) + '/vehicle', {
        method: 'PATCH',
        body: JSON.stringify(body),
      });
      if (dealId) {
        try {
          await api('/crm/deals/' + encodeURIComponent(dealId) + '/vehicle', {
            method: 'PATCH',
            body: JSON.stringify(body),
          });
        } catch (_) {
          /* ЗН сохранён — сделку обновим по возможности */
        }
      }
      if (msg) {
        msg.textContent = r.buyer_counterparty_id
          ? 'Сохранено в ЗН и у контрагента'
          : 'Сохранено в ЗН';
      }
      setTimeout(() => renderSalesDocDetail(id), 300);
    } catch (e) {
      if (msg) msg.textContent = e.message || String(e);
      alert(e.message || String(e));
      if (btn) btn.disabled = false;
    }
  });
  document.getElementById('sd-sts-ocr')?.addEventListener('click', async () => {
    if (!dealId) {
      alert('Нет связанного заказа покупателя');
      return;
    }
    const msg = document.getElementById('sd-sts-ocr-msg');
    const btn = document.getElementById('sd-sts-ocr');
    const files = [...(document.getElementById('sd-sts-photos')?.files || [])].slice(0, 4);
    const hasSaved = !!(stsPh.front || stsPh.back);
    if (!files.length && !hasSaved) {
      const err = 'Выберите 1–2 фото СТС';
      if (msg) msg.textContent = err;
      alert(err);
      return;
    }
    if (btn) btn.disabled = true;
    if (msg) {
      msg.textContent = files.length
        ? 'Сохраняем и распознаём… (~20 сек)'
        : 'Распознаём сохранённые фото… (~20 сек)';
    }
    try {
      const fileToB64 = (file) =>
        new Promise((resolve, reject) => {
          if (!file) return resolve(null);
          const reader = new FileReader();
          reader.onload = () => {
            const s = String(reader.result || '');
            const i = s.indexOf(',');
            resolve({
              mime: file.type || 'image/jpeg',
              data_base64: i >= 0 ? s.slice(i + 1) : s,
            });
          };
          reader.onerror = () => reject(new Error('Не удалось прочитать файл'));
          reader.readAsDataURL(file);
        });
      const images = [];
      for (const f of files) {
        const b = await fileToB64(f);
        if (b) images.push(b);
      }
      const r = await api('/crm/deals/' + encodeURIComponent(dealId) + '/vehicle/ocr', {
        method: 'POST',
        body: JSON.stringify({
          images,
          apply: true,
          recognize: true,
          from_saved: !images.length,
        }),
      });
      const v = r.vehicle || {};
      const filled = [
        v.car_plate && 'номер ' + v.car_plate,
        v.car_vin && 'VIN',
        v.car_brand && v.car_brand,
        v.car_sts_number && '№ СТС',
      ].filter(Boolean);
      if (Object.values(v).some(Boolean)) {
        // OCR побеждает; пустое поле OCR затирает старый мусор (не || d.car_*)
        await api('/sales-docs/' + encodeURIComponent(id) + '/vehicle', {
          method: 'PATCH',
          body: JSON.stringify({
            car_plate: v.car_plate || '',
            car_vin: v.car_vin || '',
            car_brand: v.car_brand || '',
            car_model: v.car_model || '',
            car_year: v.car_year || '',
            car_color: v.car_color || '',
            car_category: v.car_category || '',
            car_pts: v.car_pts || '',
            car_mileage: d.car_mileage || '',
            car_owner: v.car_owner || '',
            car_owner_street: v.car_owner_street || '',
            car_owner_house: v.car_owner_house || '',
            car_owner_flat: v.car_owner_flat || '',
            car_sts_date: v.car_sts_date || '',
            car_sts_number: v.car_sts_number || '',
          }),
        });
      }
      if (msg) {
        msg.textContent = filled.length
          ? 'Распознано: ' + filled.join(', ')
          : r.warn || 'Vision ответил, но поля пустые — переснимите ближе';
      }
      setTimeout(() => renderSalesDocDetail(id), 400);
    } catch (e) {
      if (msg) msg.textContent = e.message || String(e);
      alert(e.message || String(e));
      if (btn) btn.disabled = false;
    }
  });
  {
    const cpNameEl = document.getElementById('sd-cp-name');
    const saveCpName = async () => {
      if (!cpNameEl) return;
      const msg = document.getElementById('sd-cp-name-msg');
      const name = String(cpNameEl.value || '').trim();
      const prev = String(d.counterparty_name || '').trim();
      if (!name) {
        if (msg) msg.textContent = 'Укажите наименование';
        return;
      }
      if (name === prev) {
        if (msg) msg.textContent = '';
        return;
      }
      cpNameEl.disabled = true;
      if (msg) msg.textContent = 'Сохраняем и в Amo…';
      try {
        const r = await api('/sales-docs/' + encodeURIComponent(id) + '/counterparty-name', {
          method: 'PATCH',
          body: JSON.stringify({ name }),
        });
        d.counterparty_name = r.name || name;
        const amo = r.amo || {};
        let amoMsg = '';
        if (amo.ok === false) amoMsg = ' · Amo: ' + (amo.error || 'ошибка');
        else if (amo.filled && amo.filled.includes('name')) amoMsg = ' · Amo обновлён';
        else if (amo.ok) amoMsg = ' · Amo ок';
        if (msg) {
          msg.textContent =
            'Сохранено в ' +
            (r.docs_updated || 1) +
            ' док.' +
            (r.counterparty_id ? ' · контрагент' : '') +
            amoMsg;
        }
        // обновить шапку «Покупатель: …»
        setTimeout(() => renderSalesDocDetail(id), 500);
      } catch (e) {
        if (msg) msg.textContent = e.message || String(e);
        alert(e.message || String(e));
      } finally {
        cpNameEl.disabled = false;
      }
    };
    cpNameEl?.addEventListener('blur', () => {
      saveCpName();
    });
    cpNameEl?.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') {
        ev.preventDefault();
        cpNameEl.blur();
      }
    });
  }
  document.getElementById('sd-buyer-save')?.addEventListener('click', async () => {
    const msg = document.getElementById('sd-buyer-msg');
    const btn = document.getElementById('sd-buyer-save');
    const val = (elId) => String(document.getElementById(elId)?.value || '').trim();
    if (btn) btn.disabled = true;
    if (msg) msg.textContent = 'Сохранение…';
    try {
      const r = await api('/sales-docs/' + encodeURIComponent(id) + '/buyer', {
        method: 'PATCH',
        body: JSON.stringify({
          name: val('sd-buyer-name'),
          director: val('sd-buyer-director'),
          inn: val('sd-buyer-inn'),
          kpp: val('sd-buyer-kpp'),
          ogrn: val('sd-buyer-ogrn'),
          phone: val('sd-buyer-phone'),
          address: val('sd-buyer-address'),
          email: val('sd-buyer-email'),
          bank: val('sd-buyer-bank'),
          bik: val('sd-buyer-bik'),
          rs: val('sd-buyer-rs'),
          ks: val('sd-buyer-ks'),
        }),
      });
      const amo = r.amo || {};
      let amoMsg = '';
      if (amo.ok === false) {
        amoMsg = ' · Amo: ' + (amo.error || 'ошибка');
      } else if (amo.ok) {
        if (amo.changed === false) {
          amoMsg = ' · Amo: без изменений (поля уже заполнены)';
        } else if (Array.isArray(amo.filled) && amo.filled.length) {
          amoMsg = ' · Amo: дозаполнены ' + amo.filled.join(', ');
        } else {
          amoMsg = ' · Amo: ок';
        }
        if (amo.name_differs) {
          amoMsg += ' · имя в Amo не трогали';
        }
      }
      if (msg) msg.textContent = 'Сохранено' + amoMsg;
      setTimeout(() => renderSalesDocDetail(id), 300);
    } catch (e) {
      if (msg) msg.textContent = e.message || String(e);
      alert(e.message || String(e));
      if (btn) btn.disabled = false;
    }
  });
  if (d.doc_type === 'invoice' && dealId) {
    const makeSdFiscal = async (kind, parentReceiptId) => {
      const msg = document.getElementById('sd-link-msg');
      const labels = {
        advance: 'Чек предоплаты…',
        full: 'Чек полного расчёта…',
        refund: 'Чек возврата…',
      };
      if (msg) msg.textContent = labels[kind] || 'Чек…';
      try {
        const body = { send: true };
        if (parentReceiptId) body.parent_receipt_id = parentReceiptId;
        const r = await api(
          '/crm/deals/' + encodeURIComponent(dealId) + '/fiscal/' + kind,
          { method: 'POST', body: JSON.stringify(body) }
        );
        const st = r.receipt?.status || '';
        if (msg) {
          msg.textContent =
            'Чек: ' +
            st +
            (r.atol && !r.atol.configured ? ' (черновик — задайте АТОЛ в Настройках)' : '');
        }
      } catch (e) {
        if (msg) msg.textContent = e.message || String(e);
        alert(e.message || String(e));
      }
    };
    const sdAdv = document.getElementById('sd-fiscal-advance');
    const sdFull = document.getElementById('sd-fiscal-full');
    if (sdAdv) sdAdv.onclick = () => makeSdFiscal('advance');
    if (sdFull) sdFull.onclick = () => makeSdFiscal('full');
  }
  {
    bindSalesDocPdfBar({
      id,
      prefix: 'sd',
      disabled: isWorkorder && !woHasPlate,
      dealId: d.deal_id || '',
    });
  }
  view.querySelectorAll('[data-product]').forEach((tr) => {
    tr.onclick = () => openTab('product:' + tr.dataset.product);
  });
}

async function renderOrgProfile() {
  view.innerHTML = formChrome(
    'Реквизиты юрлиц',
    `
    <p style="margin:0 0 12px;line-height:1.45">
      Общие «реквизиты организации» больше не используются: у каждого контура свои юрлица
      (Пневмоподвеска, Фогель и т.д.). Реквизиты, печать и подпись — в карточке юрлица.
    </p>
    <p class="muted" style="margin:0 0 16px">Компания → Организации → контур → вкладка «Юрлица».</p>
    <button type="button" class="primary" id="org-go-orgs">Открыть организации</button>`,
    { toolbar: `<div class="grow"></div>` }
  );
  bindFormChrome(() => showSection('company'));
  document.getElementById('org-go-orgs').onclick = () => {
    openTab('organizations');
  };
}

async function renderPhoneSettings() {
  let data;
  try {
    data = await api('/ui-settings');
  } catch (e) {
    view.innerHTML = formChrome(
      'Формат телефонов',
      `<p class="error">${esc(e.message)}</p>`
    );
    bindFormChrome(() => showSection('settings'));
    return;
  }
  const cur = data.phone_format || PHONE_FORMAT_DEFAULT;
  const formats = data.phone_formats || [
    { id: 'plus7_spaced', label: '+7 со скобками' },
    { id: 'eight_spaced', label: '8 со скобками' },
    { id: 'digits7', label: '7 без пробелов' },
    { id: 'plus7_digits', label: '+7 без пробелов' },
    { id: 'off', label: 'Как введено' },
  ];
  const radios = formats
    .map(
      (f) =>
        `<label><input type="radio" name="phone-fmt" value="${esc(f.id)}" ${
          f.id === cur ? 'checked' : ''
        } /><span>${esc(f.label)}</span></label>`
    )
    .join('');
  view.innerHTML = formChrome(
    'Формат телефонов',
    `
    <p class="muted" style="margin:0 0 10px">
      Единый вид номеров в списках контрагентов / поставщиков / покупателей, карточках и реквизитах.
      При записи RU 10/11 цифр приводятся к выбранному стандарту; короткие и иностранные не ломаем.
    </p>
    <h3 class="form-section-title">Стандарт</h3>
    <div class="form-fields">
      <div class="field span-2">
        <span>Вариант отображения и сохранения</span>
        <div class="checks checks-col">
          ${radios}
        </div>
      </div>
    </div>
    <p class="muted" id="phone-fmt-msg" style="margin-top:10px"></p>`,
    {
      toolbar: `
        <button class="primary" type="button" id="phone-fmt-save">Сохранить</button>
        <div class="grow"></div>`,
    }
  );
  bindFormChrome(() => showSection('settings'));
  document.getElementById('phone-fmt-save').onclick = async () => {
    const msg = document.getElementById('phone-fmt-msg');
    const btn = document.getElementById('phone-fmt-save');
    const sel = document.querySelector('input[name="phone-fmt"]:checked');
    if (!sel) {
      msg.textContent = 'Выберите стандарт';
      return;
    }
    btn.disabled = true;
    msg.textContent = 'Сохранение…';
    try {
      const saved = await api('/ui-settings', {
        method: 'PUT',
        body: JSON.stringify({ phone_format: sel.value }),
      });
      state.phoneFormat = saved.phone_format || sel.value;
      msg.textContent = 'Сохранено · новый формат применяется в списках и при записи';
      btn.disabled = false;
      setTimeout(() => renderPhoneSettings(), 400);
    } catch (e) {
      msg.textContent = e.message;
      btn.disabled = false;
    }
  };
}

async function renderPaymentLinkSettings() {
  await refreshRefs();
  let data;
  try {
    data = await api('/payment-link-settings');
  } catch (e) {
    view.innerHTML = formChrome(
      'Ссылка на оплату',
      `<p class="error">${esc(e.message)}</p>`
    );
    bindFormChrome(() => showSection('settings'));
    return;
  }
  const mins = Number(data.payment_link_timer_minutes) || 120;
  const reserveOn = data.payment_link_reserve_enabled !== false;
  const defWh = String(data.payment_link_default_warehouse_id || '');
  const defOrg = String(data.payment_link_default_organization_id || '');
  const wait = data.waiting_payment_warehouse || {};
  const whOpts =
    '<option value="">Авто (склад с достаточным остатком)</option>' +
    (state.warehouses || [])
      .filter((w) => whIsActive(w) && !whIsAutoSys(w))
      .map(
        (w) =>
          `<option value="${esc(w.id)}" ${w.id === defWh ? 'selected' : ''}>${esc(w.name)}</option>`
      )
      .join('');
  const orgOpts =
    '<option value="">Организация по умолчанию из справочника</option>' +
    (state.organizations || [])
      .map(
        (o) =>
          `<option value="${esc(o.id)}" ${o.id === defOrg ? 'selected' : ''}>${esc(o.short_name || o.name)}</option>`
      )
      .join('');
  view.innerHTML = formChrome(
    'Ссылка на оплату',
    `
    <p class="muted" style="margin:0 0 10px">
      Публичная страница <span class="mono">/pay/…</span>: позиции, QR СБП, оплата картой, таймер резерва.
      При создании ссылки товар уходит на склад «Ожидание оплаты»; по истечении таймера — возврат.
    </p>
    <h3 class="form-section-title">Таймер и резерв</h3>
    <div class="form-grid">
      <label>Минут до снятия резерва
        <input type="number" id="pl-timer" min="1" max="1440" step="1" value="${esc(mins)}" />
        <span class="muted" style="font-weight:400">По умолчанию 120 (2 часа). Можно подстроить после обратной связи продаж.</span>
      </label>
      <label>Склад-источник по умолчанию
        <select id="pl-wh">${whOpts}</select>
      </label>
      <label class="span-2">Организация по умолчанию
        <select id="pl-org">${orgOpts}</select>
      </label>
      <label class="span-2" style="display:flex;align-items:center;gap:8px;margin-top:8px">
        <input type="checkbox" id="pl-reserve" ${reserveOn ? 'checked' : ''} />
        Резервировать товар на складе «Ожидание оплаты»
      </label>
    </div>
    <h3 class="form-section-title">Склад резерва</h3>
    <p class="muted" style="margin:0">
      ${esc(wait.name || 'Ожидание оплаты')}
      ${wait.code ? ` · <span class="mono">${esc(wait.code)}</span>` : ''}
      ${wait.id ? ` · <span class="mono">${esc(wait.id)}</span>` : ''}
      — создаётся автоматически, если его ещё нет.
    </p>
    <p class="muted" id="pl-msg" style="margin-top:12px"></p>`,
    {
      toolbar: `
        <button class="primary" type="button" id="pl-save">Сохранить</button>
        <div class="grow"></div>`,
    }
  );
  bindFormChrome(() => showSection('settings'));
  document.getElementById('pl-save').onclick = async () => {
    const msg = document.getElementById('pl-msg');
    const btn = document.getElementById('pl-save');
    btn.disabled = true;
    msg.textContent = 'Сохранение…';
    try {
      const saved = await api('/payment-link-settings', {
        method: 'PUT',
        body: JSON.stringify({
          payment_link_timer_minutes: Number(document.getElementById('pl-timer').value) || 120,
          payment_link_reserve_enabled: document.getElementById('pl-reserve').checked,
          payment_link_default_warehouse_id: document.getElementById('pl-wh').value,
          payment_link_default_organization_id: document.getElementById('pl-org')?.value || '',
        }),
      });
      msg.textContent =
        'Сохранено · таймер ' +
        (saved.payment_link_timer_minutes || mins) +
        ' мин · резерв ' +
        (saved.payment_link_reserve_enabled !== false ? 'вкл' : 'выкл');
      btn.disabled = false;
      setTimeout(() => renderPaymentLinkSettings(), 400);
    } catch (e) {
      msg.textContent = e.message;
      btn.disabled = false;
    }
  };
}


async function renderAmoSettings() {
  let data;
  try {
    data = await api('/settings/integrations/amo');
  } catch (e) {
    view.innerHTML = formChrome('AmoCRM', `<p class="error">${esc(e.message)}</p>`);
    bindFormChrome(() => showSection('settings'));
    return;
  }
  if (
    state.amoSettingsTab !== 'bridge' &&
    state.amoSettingsTab !== 'stages' &&
    state.amoSettingsTab !== 'users' &&
    state.amoSettingsTab !== 'rules'
  ) {
    state.amoSettingsTab = 'bridge';
  }
  const bridge = data.bridge || {};
  const integrationActive = String(bridge.status || '') === 'ok';
  // Воронки / Пользователи — только при активной интеграции
  if (
    !integrationActive &&
    (state.amoSettingsTab === 'stages' || state.amoSettingsTab === 'users')
  ) {
    state.amoSettingsTab = 'bridge';
  }
  const tab = state.amoSettingsTab;
  const meta = data.meta || {};
  const dealsMeta = meta.deals || {};
  const flag = (ok) =>
    ok
      ? '<span style="color:var(--taxi-green)">ок</span>'
      : '<span class="muted">нет</span>';
  const stageMap = (data.stages && data.stages.success_after_handed) || {};
  const pipes = data.pipelines || [];
  const staff = data.staff || [];
  const unmapped = data.unmapped_amo_users || [];

  let body = '';
  let toolbar = '';
  let amoUserCatalog = [];
  let amoUserLabelFor = (staffId, amoId) => (amoId ? 'Amo ' + amoId : '— не привязан —');

  if (tab === 'bridge') {
    const shareUrl = String(bridge.oauth_share_url || '').trim();
    const st = String(bridge.status || 'waiting');
    const stLabel = String(bridge.status_label || '—');
    const lastAt = String(bridge.last_received_at || '').trim();
    let lastHuman = 'ещё не было';
    if (lastAt) {
      const ms = Date.parse(lastAt);
      lastHuman = Number.isFinite(ms)
        ? new Date(ms).toLocaleString('ru-RU', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
          })
        : lastAt;
    }
    const hookHint = String(bridge.webhook_hint || 'Сделки · контакты');
    const hookOn = !!bridge.webhook_enabled;
    const stClass =
      st === 'ok' ? 'is-ok' : st === 'no_key' ? 'is-warn' : 'is-muted';
    const showIntegrate = st !== 'ok' && Boolean(shareUrl);
    body = `
      ${
        showIntegrate
          ? `<div class="amo-bridge-top">
          <a class="amo-share-cta" href="${esc(shareUrl)}" target="_blank" rel="noopener noreferrer" title="${esc(shareUrl)}">Интегрировать</a>
        </div>`
          : ''
      }
      <div class="form-grid amo-bridge-status"${showIntegrate ? ' style="margin-top:14px"' : ''}>
        <div class="field">
          <span>Статус интеграции</span>
          <div><span class="amo-status-pill ${stClass}">${esc(stLabel)}</span></div>
        </div>
        <div class="field">
          <span>Последнее получение</span>
          <div class="mono" style="font-size:13px">${esc(lastHuman)}</div>
        </div>
        <div class="field span-2">
          <span>Хук · ${esc(hookHint)}</span>
          <label class="amo-hook-switch${bridge.webhook_key_set ? '' : ' is-disabled'}">
            <input type="checkbox" id="amo-webhook-enabled" role="switch"
              ${hookOn ? 'checked' : ''} ${bridge.webhook_key_set ? '' : 'disabled'} />
            <span class="amo-hook-switch-ui" aria-hidden="true"></span>
            <span class="amo-hook-switch-label">${hookOn ? 'Включён' : 'Выключен'}</span>
          </label>
          <div class="muted" style="font-size:12px;margin-top:6px" id="amo-webhook-msg">
            ${
              bridge.webhook_key_set
                ? 'При включении подписываем Amo на сделки и контакты. Товары — из БД amo1c.'
                : 'Нет ключа на сервере — переключатель недоступен.'
            }
          </div>
        </div>
      </div>`;
    toolbar = '';
  } else if (tab === 'stages') {
    const companies = data.companies || [];
    const pipeCo = data.pipeline_company || {};
    const coOpts = (selected) => {
      const cur = String(selected || '').trim();
      return (
        '<option value="">— не задано —</option>' +
        companies
          .map((c) => {
            const sel = cur && cur === String(c.id) ? 'selected' : '';
            const mark = c.is_default ? ' · по умолч.' : '';
            return `<option value="${esc(c.id)}" ${sel}>${esc(c.name)}${esc(mark)}</option>`;
          })
          .join('')
      );
    };
    const stageRows = pipes.length
      ? pipes
          .map((p) => {
            const orgId = pipeCo[p.id] || p.org_company_id || '';
            return `<tr>
            <td>
              <div class="fb-title">${esc(p.name)}</div>
              <div class="muted" style="font-size:11px">id ${esc(p.id)} · сделок ${esc(p.deals_count || 0)}</div>
            </td>
            <td>
              <select data-amo-pipe-org="${esc(p.id)}" style="min-width:220px;width:100%">
                ${coOpts(orgId)}
              </select>
            </td>
          </tr>`;
          })
          .join('')
      : '<tr><td colspan="2" class="muted">Воронок нет — сначала обновите зеркало сделок в amo1c.</td></tr>';
    body = `
    <p class="muted" style="margin:0 0 8px;font-size:12px">
      Укажите организацию (контур) для каждой воронки Amo — сделки попадут в неё (фильтр в шапке).
    </p>
    <div class="table-scroll">
      <table class="data-table is-dense" data-no-col-filter="1">
        <thead><tr><th>Воронка</th><th>Организация</th></tr></thead>
        <tbody>${stageRows}</tbody>
      </table>
    </div>
    <div class="form-actions is-float">
      <button class="primary" type="button" id="amo-save">Сохранить</button>
      <span class="muted" id="amo-msg"></span>
    </div>`;
    toolbar = '';
  } else if (tab === 'rules') {
    const sr = data.sale_rules || {};
    const cfg = sr.config || {};
    const fields = Array.isArray(cfg.fields) ? cfg.fields : [];
    const roles = Array.isArray(cfg.buyer_roles) ? cfg.buyer_roles : [];
    const scenarios = Array.isArray(cfg.scenarios) ? cfg.scenarios : [];
    const alerts = Array.isArray(sr.alerts) ? sr.alerts : [];
    const lockOn = cfg.lock_fields !== false;
    const alertBox = alerts.length
      ? `<div class="amo-rules-alerts" style="margin:0 0 14px;padding:10px 12px;border:1px solid #f0c36d;background:#fff8e6;border-radius:8px">
          <div style="font-weight:650;margin-bottom:6px">⚠ Изменилась интеграция с AmoCRM (${alerts.length})</div>
          ${alerts
            .slice(0, 8)
            .map(
              (a) =>
                `<div style="font-size:12px;margin:4px 0">
                  <b>${esc(a.title || '')}</b>
                  <div class="muted">${esc(a.detail || '')}</div>
                </div>`
            )
            .join('')}
          <div class="toolbar" style="margin-top:8px;padding:0">
            <button type="button" id="amo-rules-ack">Отметить прочитанным</button>
          </div>
        </div>`
      : '';
    const fieldRows = fields
      .map((f, i) => {
        return `<tr data-amo-field-i="${i}">
          <td><input class="mono" data-f="id" value="${esc(f.id || '')}" style="width:88px" /></td>
          <td>
            <select data-f="entity">
              ${['company', 'lead', 'uchet']
                .map(
                  (e) =>
                    `<option value="${e}" ${f.entity === e ? 'selected' : ''}>${e === 'company' ? 'Компания' : e === 'lead' ? 'Сделка' : 'Учёт'}</option>`
                )
                .join('')}
            </select>
          </td>
          <td><input data-f="name" value="${esc(f.name || '')}" /></td>
          <td><input data-f="type" value="${esc(f.type || '')}" style="width:90px" /></td>
          <td><input data-f="values" value="${esc((f.values || []).join(' · '))}" title="Значения через ·" style="min-width:220px" /></td>
          <td><input data-f="effect" value="${esc(f.effect || '')}" style="min-width:180px" /></td>
          <td><input class="mono" data-f="deal_column" value="${esc(f.deal_column || '')}" style="width:120px" /></td>
        </tr>`;
      })
      .join('');
    const roleRows = roles
      .map(
        (r) =>
          `<tr><td><b>${esc(r.role || '')}</b></td><td>${esc(r.how || '')}</td><td class="muted">${esc(r.note || '')}</td></tr>`
      )
      .join('');
    const scenRows = scenarios
      .map((s, i) => {
        return `<tr data-amo-scen-i="${i}">
          <td class="mono">${esc(s.n)}</td>
          <td><input data-s="who" value="${esc(s.who || '')}" /></td>
          <td><input data-s="channel" value="${esc(s.channel || '')}" /></td>
          <td><input data-s="pay_type" value="${esc(s.pay_type || '')}" /></td>
          <td><input data-s="pay_method" value="${esc(s.pay_method || '')}" /></td>
          <td><input data-s="fiscal" value="${esc(s.fiscal || '')}" /></td>
          <td><input data-s="docs" value="${esc(s.docs || '')}" /></td>
          <td style="text-align:center"><input type="checkbox" data-s="enabled" ${s.enabled !== false ? 'checked' : ''} /></td>
        </tr>`;
      })
      .join('');
    body = `
      ${alertBox}
      <p class="muted" style="margin:0 0 10px;font-size:12px">
        Структура как на листе
        <a href="${esc(sr.sheet_url || '#')}" target="_blank" rel="noopener">«Правила чеки/доки Amo»</a>.
        Селекты и поля в Amo <b>нельзя менять молча</b>: при новых значениях в сделках Учёт №1 пишет уведомление.
        ${cfg.updated_at ? ` · сохранено ${esc(String(cfg.updated_at).slice(0, 19).replace('T', ' '))}` : ''}
      </p>
      <label style="display:flex;align-items:center;gap:8px;margin:0 0 12px;font-weight:650">
        <input type="checkbox" id="amo-rules-lock" ${lockOn ? 'checked' : ''} />
        Запрет тихих изменений в Amo (уведомлять при дрейфе селектов)
      </label>
      <h3 class="form-section-title">1. Поля Amo</h3>
      <div class="table-scroll">
        <table class="data-table is-dense" id="amo-rules-fields" data-no-col-filter="1">
          <thead><tr>
            <th>ID</th><th>Где</th><th>Название</th><th>Тип</th><th>Значения</th><th>На что влияет</th><th>Колонка</th>
          </tr></thead>
          <tbody>${fieldRows || '<tr><td colspan="7" class="muted">Нет полей</td></tr>'}</tbody>
        </table>
      </div>
      <h3 class="form-section-title">2. Роли покупателя</h3>
      <div class="table-scroll">
        <table class="data-table is-dense" data-no-col-filter="1">
          <thead><tr><th>Роль</th><th>Как узнаём</th><th>Примечание</th></tr></thead>
          <tbody>${roleRows || '<tr><td colspan="3" class="muted">—</td></tr>'}</tbody>
        </table>
      </div>
      <h3 class="form-section-title">3. Сценарии (ключевые)</h3>
      <div class="table-scroll">
        <table class="data-table is-dense" id="amo-rules-scen" data-no-col-filter="1">
          <thead><tr>
            <th>№</th><th>Кто</th><th>Канал</th><th>Тип оплаты</th><th>Способ</th><th>Чеки</th><th>Документы</th><th>Вкл</th>
          </tr></thead>
          <tbody>${scenRows || '<tr><td colspan="8" class="muted">—</td></tr>'}</tbody>
        </table>
      </div>
      <div class="form-actions is-float">
        <button class="primary" type="button" id="amo-rules-save">Сохранить</button>
        <button type="button" id="amo-rules-check">Проверить сейчас</button>
        <span class="muted" id="amo-rules-msg"></span>
      </div>`;
    toolbar = '';
  } else {
    const amoUsers = data.amo_users || [];
    amoUserCatalog = [];
    const seen = new Set();
    for (const u of amoUsers) {
      const id = String(u.amo_id || '').trim();
      if (!id || seen.has(id)) continue;
      seen.add(id);
      amoUserCatalog.push({
        id,
        name: String(u.name || u.staff_name || '').trim() || 'Amo ' + id,
        deals: Number(u.deals) || 0,
        staff_id: String(u.staff_id || ''),
        staff_name: String(u.staff_name || ''),
      });
    }
    amoUserCatalog.sort((a, b) => {
      const af = a.staff_id ? 1 : 0;
      const bf = b.staff_id ? 1 : 0;
      if (af !== bf) return af - bf;
      if (b.deals !== a.deals) return b.deals - a.deals;
      return a.name.localeCompare(b.name, 'ru');
    });
    amoUserLabelFor = (staffId, amoId) => {
      const id = String(amoId || '').trim();
      if (!id) return '— не привязан —';
      const u = amoUserCatalog.find((x) => x.id === id);
      if (!u) return 'Amo ' + id;
      const deals = u.deals ? ' · ' + u.deals + ' сделок' : '';
      return u.name + deals + ' · ' + id;
    };
    const staffRows = staff
      .map((s) => {
        const inactive = s.is_active ? '' : ' <span class="badge draft">Архив</span>';
        const cur = String(s.amo_id || '').trim();
        return `<tr>
        <td>
          <div class="fb-title">${esc(formatPersonName(s.name))}${inactive}</div>
          <div class="muted" style="font-size:11px">${esc(s.email || s.login || '—')} · ${esc(ROLE_LABELS[s.role] || s.role || '—')}</div>
        </td>
        <td>
          <div class="amo-user-pick suggest-anchor" data-amo-staff="${esc(s.id)}">
            <input type="hidden" data-amo-staff-val value="${esc(cur)}" />
            <button type="button" class="amo-user-pick-btn" title="Выбрать пользователя Amo">
              <span class="amo-user-pick-label">${esc(amoUserLabelFor(s.id, cur))}</span>
              <span class="muted" aria-hidden="true">▾</span>
            </button>
          </div>
        </td>
      </tr>`;
      })
      .join('');
    const freeN = unmapped.length;
    body = `
    <p class="muted" style="margin:0 0 8px;font-size:12px">
      Нажмите поле и выберите пользователя Amo (поиск по имени или id).
      Свободные — сверху.${freeN ? ` Без привязки: <b>${freeN}</b>.` : ''}
    </p>
    <div class="table-scroll">
      <table class="data-table is-dense" data-no-col-filter="1">
        <thead><tr><th>Сотрудник</th><th>Пользователь Amo</th></tr></thead>
        <tbody>${staffRows || '<tr><td colspan="2" class="muted">Нет сотрудников</td></tr>'}</tbody>
      </table>
    </div>
    <div class="form-actions is-float">
      <button class="primary" type="button" id="amo-save">Сохранить</button>
      <span class="muted" id="amo-msg"></span>
    </div>`;
    toolbar = '';
  }

  clearFloatFormDock();
  const alertsN = Number((data.sale_rules && data.sale_rules.alerts_count) || 0);
  const amoPageTabs = [
    { id: 'bridge', label: 'Мост' },
    {
      id: 'rules',
      label: alertsN ? `Правила · ${alertsN}` : 'Правила / поля',
      alert: alertsN > 0,
    },
  ];
  if (integrationActive) {
    amoPageTabs.push(
      { id: 'stages', label: 'Воронки' },
      { id: 'users', label: 'Пользователи' }
    );
  }
  view.innerHTML = formChrome('AmoCRM', body, {
    pageTabs: amoPageTabs,
    activePageTab: tab,
  });
  bindFormChrome(() => {
    clearFloatFormDock();
    showSection('settings');
  });
  view.querySelectorAll('[data-pagetab]').forEach((btn) => {
    btn.onclick = () => {
      const next = btn.dataset.pagetab || 'bridge';
      if (
        !integrationActive &&
        (next === 'stages' || next === 'users')
      ) {
        return;
      }
      state.amoSettingsTab = next;
      renderAmoSettings();
    };
  });

  if (tab === 'rules') {
    const msg = () => document.getElementById('amo-rules-msg');
    const readFields = () => {
      const rows = [...view.querySelectorAll('#amo-rules-fields tbody tr[data-amo-field-i]')];
      const prev = ((data.sale_rules || {}).config || {}).fields || [];
      return rows.map((tr, i) => {
        const g = (k) => tr.querySelector(`[data-f="${k}"]`);
        const vals = String(g('values')?.value || '')
          .split(/[·|]/)
          .map((x) => x.trim())
          .filter(Boolean);
        const base = prev[i] || {};
        return {
          ...base,
          id: String(g('id')?.value || '').trim(),
          entity: String(g('entity')?.value || 'lead').trim(),
          name: String(g('name')?.value || '').trim(),
          type: String(g('type')?.value || '').trim(),
          values: vals,
          effect: String(g('effect')?.value || '').trim(),
          deal_column: String(g('deal_column')?.value || '').trim(),
        };
      });
    };
    const readScenarios = () => {
      const rows = [...view.querySelectorAll('#amo-rules-scen tbody tr[data-amo-scen-i]')];
      const prev = ((data.sale_rules || {}).config || {}).scenarios || [];
      return rows.map((tr, i) => {
        const g = (k) => tr.querySelector(`[data-s="${k}"]`);
        const base = prev[i] || {};
        return {
          ...base,
          n: Number(base.n) || i + 1,
          who: String(g('who')?.value || '').trim(),
          channel: String(g('channel')?.value || '').trim(),
          pay_type: String(g('pay_type')?.value || '').trim(),
          pay_method: String(g('pay_method')?.value || '').trim(),
          fiscal: String(g('fiscal')?.value || '').trim(),
          docs: String(g('docs')?.value || '').trim(),
          enabled: !!g('enabled')?.checked,
        };
      });
    };
    const saveBtn = document.getElementById('amo-rules-save');
    if (saveBtn) {
      saveBtn.onclick = async () => {
        saveBtn.disabled = true;
        if (msg()) msg().textContent = 'Сохранение…';
        try {
          const cfg = (data.sale_rules || {}).config || {};
          await api('/settings/integrations/amo/sale-rules', {
            method: 'PUT',
            body: JSON.stringify({
              lock_fields: !!document.getElementById('amo-rules-lock')?.checked,
              fields: readFields(),
              buyer_roles: cfg.buyer_roles || [],
              scenarios: readScenarios(),
            }),
          });
          if (msg()) msg().textContent = 'Сохранено';
          setTimeout(() => renderAmoSettings(), 350);
        } catch (e) {
          if (msg()) msg().textContent = e.message || String(e);
          saveBtn.disabled = false;
        }
      };
    }
    const checkBtn = document.getElementById('amo-rules-check');
    if (checkBtn) {
      checkBtn.onclick = async () => {
        checkBtn.disabled = true;
        if (msg()) msg().textContent = 'Проверка…';
        try {
          const r = await api('/settings/integrations/amo/sale-rules/check', {
            method: 'POST',
            body: '{}',
          });
          if (msg()) {
            msg().textContent = r.ok
              ? 'OK · дрейфа нет'
              : `Найдено расхождений: ${(r.issues || []).length}`;
          }
          setTimeout(() => renderAmoSettings(), 400);
        } catch (e) {
          if (msg()) msg().textContent = e.message || String(e);
          checkBtn.disabled = false;
        }
      };
    }
    const ackBtn = document.getElementById('amo-rules-ack');
    if (ackBtn) {
      ackBtn.onclick = async () => {
        try {
          await api('/settings/integrations/amo/sale-rules/alerts/seen', {
            method: 'POST',
            body: JSON.stringify({ all: true }),
          });
          renderAmoSettings();
        } catch (e) {
          alert(e.message || String(e));
        }
      };
    }
  }

  if (tab === 'users') {
    const closeAllAmoPick = () => {
      document.querySelectorAll('.amo-user-suggest-float').forEach((el) => el.remove());
      view.querySelectorAll('.amo-user-pick.is-open').forEach((el) => el.classList.remove('is-open'));
    };
    const placeFloat = (box, anchorBtn) => {
      const r = anchorBtn.getBoundingClientRect();
      const width = Math.max(r.width, 280);
      let left = r.left;
      if (left + width > window.innerWidth - 8) left = Math.max(8, window.innerWidth - width - 8);
      let top = r.bottom + 4;
      const maxH = Math.min(320, window.innerHeight - 24);
      if (top + 160 > window.innerHeight && r.top > maxH) {
        top = Math.max(8, r.top - maxH - 4);
      }
      box.style.left = left + 'px';
      box.style.top = top + 'px';
      box.style.width = width + 'px';
      box.style.maxHeight = maxH + 'px';
    };
    const renderAmoSuggest = (wrap, q) => {
      const staffId = wrap.getAttribute('data-amo-staff');
      const hid = wrap.querySelector('[data-amo-staff-val]');
      const btn = wrap.querySelector('.amo-user-pick-btn');
      const cur = String((hid && hid.value) || '').trim();
      const qq = String(q || '').trim().toLowerCase();
      const items = [
        { id: '', name: '— не привязан —', deals: 0, staff_id: '', staff_name: '' },
        ...amoUserCatalog,
      ].filter((u) => {
        if (!qq) return true;
        if (!u.id) return 'не привязан'.includes(qq);
        return (
          u.id.includes(qq) ||
          String(u.name || '').toLowerCase().includes(qq) ||
          String(u.staff_name || '').toLowerCase().includes(qq)
        );
      });
      let box = document.querySelector('.amo-user-suggest-float');
      if (!box) {
        box = document.createElement('div');
        box.className = 'suggest amo-user-suggest-float';
        document.body.appendChild(box);
      }
      wrap.classList.add('is-open');
      if (!items.length) {
        box.innerHTML = '<div class="suggest-empty muted">Нет совпадений</div>';
      } else {
        box.innerHTML =
          `<div class="amo-user-suggest-search"><input type="search" class="amo-user-suggest-q" placeholder="Поиск…" value="${esc(
            q || ''
          )}" autocomplete="off" /></div>` +
          `<div class="amo-user-suggest-list">` +
          items
            .slice(0, 80)
            .map((u) => {
              const taken =
                u.id && u.staff_id && String(u.staff_id) !== String(staffId)
                  ? `<span class="muted"> · занят: ${esc(u.staff_name || u.staff_id)}</span>`
                  : '';
              const deals = u.deals ? `<span class="muted"> · ${esc(u.deals)} сделок</span>` : '';
              const idBit = u.id ? `<span class="mono muted"> ${esc(u.id)}</span>` : '';
              const on = (u.id || '') === cur ? ' is-on' : '';
              return `<button type="button" class="suggest-item${on}" data-amo-pick="${esc(u.id)}">
                <span>${esc(u.name)}</span>${deals}${taken}${idBit}
              </button>`;
            })
            .join('') +
          `</div>`;
      }
      placeFloat(box, btn);
      const qInp = box.querySelector('.amo-user-suggest-q');
      if (qInp) {
        qInp.oninput = () => renderAmoSuggest(wrap, qInp.value);
        qInp.onkeydown = (e) => {
          if (e.key === 'Escape') {
            closeAllAmoPick();
            e.stopPropagation();
          }
        };
        if (document.activeElement !== qInp) {
          qInp.focus();
          const len = qInp.value.length;
          try {
            qInp.setSelectionRange(len, len);
          } catch (_) {}
        }
      }
      box.querySelectorAll('[data-amo-pick]').forEach((pickBtn) => {
        pickBtn.onclick = (e) => {
          e.preventDefault();
          e.stopPropagation();
          const id = pickBtn.getAttribute('data-amo-pick') || '';
          if (hid) hid.value = id;
          const lab = wrap.querySelector('.amo-user-pick-label');
          if (lab) lab.textContent = amoUserLabelFor(staffId, id);
          closeAllAmoPick();
        };
      });
    };
    view.querySelectorAll('.amo-user-pick').forEach((wrap) => {
      const btn = wrap.querySelector('.amo-user-pick-btn');
      if (!btn) return;
      btn.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        const was = wrap.classList.contains('is-open');
        closeAllAmoPick();
        if (!was) renderAmoSuggest(wrap, '');
      };
    });
    if (!state._amoUserPickDocBound) {
      state._amoUserPickDocBound = true;
      document.addEventListener('click', (e) => {
        const t = e.target;
        if (t && t.closest && (t.closest('.amo-user-pick') || t.closest('.amo-user-suggest-float'))) {
          return;
        }
        document.querySelectorAll('.amo-user-suggest-float').forEach((el) => el.remove());
        document.querySelectorAll('.amo-user-pick.is-open').forEach((el) => el.classList.remove('is-open'));
      });
      window.addEventListener(
        'scroll',
        () => {
          const box = document.querySelector('.amo-user-suggest-float');
          const open = document.querySelector('.amo-user-pick.is-open .amo-user-pick-btn');
          if (box && open) {
            const r = open.getBoundingClientRect();
            const width = Math.max(r.width, 280);
            let left = r.left;
            if (left + width > window.innerWidth - 8) left = Math.max(8, window.innerWidth - width - 8);
            box.style.left = left + 'px';
            box.style.top = r.bottom + 4 + 'px';
            box.style.width = width + 'px';
          }
        },
        true
      );
      window.addEventListener('resize', () => {
        document.querySelectorAll('.amo-user-suggest-float').forEach((el) => el.remove());
        document.querySelectorAll('.amo-user-pick.is-open').forEach((el) => el.classList.remove('is-open'));
      });
    }
  }

  const hookToggle = document.getElementById('amo-webhook-enabled');
  if (hookToggle) {
    hookToggle.onchange = async () => {
      const on = !!hookToggle.checked;
      const msg = document.getElementById('amo-webhook-msg');
      const label = document.querySelector('.amo-hook-switch-label');
      hookToggle.disabled = true;
      if (msg) msg.textContent = on ? 'Включаем хук в Amo…' : 'Выключаем хук…';
      try {
        const r = await api('/settings/integrations/amo/webhook', {
          method: 'PUT',
          body: JSON.stringify({ enabled: on }),
        });
        if (label) label.textContent = r.enabled ? 'Включён' : 'Выключен';
        hookToggle.checked = !!r.enabled;
        if (msg) {
          if (r.amo_ok) {
            msg.textContent = r.enabled
              ? 'Хук включён — сделки и контакты. Товары из БД amo1c.'
              : 'Хук выключен.';
          } else {
            msg.textContent = r.enabled
              ? `Приём включён, подписка Amo: ${r.error || 'ошибка'}`
              : `Выключен локально. Amo: ${r.error || 'ошибка отписки'}`;
          }
        }
      } catch (e) {
        hookToggle.checked = !on;
        if (label) label.textContent = hookToggle.checked ? 'Включён' : 'Выключен';
        if (msg) msg.textContent = e.message || String(e);
      }
      hookToggle.disabled = !bridge.webhook_key_set;
    };
  }

  const saveBtn = document.getElementById('amo-save');
  if (saveBtn) {
    saveBtn.onclick = async () => {
      const msg = document.getElementById('amo-msg');
      saveBtn.disabled = true;
      if (msg) msg.textContent = 'Сохранение…';
      const payload = {};
      if (tab === 'stages') {
        const pipeline_company = {};
        view.querySelectorAll('[data-amo-pipe-org]').forEach((sel) => {
          const pipe = sel.getAttribute('data-amo-pipe-org');
          const val = String(sel.value || '').trim();
          if (pipe && val) pipeline_company[pipe] = val;
        });
        payload.pipeline_company = pipeline_company;
      } else if (tab === 'users') {
        payload.staff_mappings = [...view.querySelectorAll('.amo-user-pick[data-amo-staff]')].map((wrap) => {
          const hid = wrap.querySelector('[data-amo-staff-val]');
          return {
            staff_id: wrap.getAttribute('data-amo-staff'),
            amo_id: String((hid && hid.value) || '').trim(),
          };
        });
      }
      try {
        await api('/settings/integrations/amo', {
          method: 'PUT',
          body: JSON.stringify(payload),
        });
        if (msg) msg.textContent = 'Сохранено';
        saveBtn.disabled = false;
        setTimeout(() => renderAmoSettings(), 400);
      } catch (e) {
        if (msg) msg.textContent = e.message || String(e);
        saveBtn.disabled = false;
      }
    };
  }
}

async function renderYandexPaySettings() {
  let data;
  try {
    data = await api('/settings/integrations/yandex-pay');
  } catch (e) {
    view.innerHTML = formChrome('Яндекс Сплит', `<p class="error">${esc(e.message)}</p>`);
    bindFormChrome(() => showSection('settings'));
    return;
  }
  const orgs = Array.isArray(data.organizations) ? data.organizations : [];
  const profiles = Array.isArray(data.profiles) ? data.profiles : [];
  const orgById = Object.fromEntries(orgs.map((o) => [o.id, o]));
  const editId = String(state._ypEditOrgId || '');
  const editing = editId ? profiles.find((p) => p.organization_id === editId) : null;
  const usedIds = new Set(profiles.map((p) => p.organization_id));
  const orgOptsForNew =
    '<option value="">— выберите юрлицо —</option>' +
    orgs
      .filter((o) => !usedIds.has(o.id) || o.id === editId)
      .map((o) => {
        const label = [o.short_name || o.name, o.inn ? 'ИНН ' + o.inn : '']
          .filter(Boolean)
          .join(' · ');
        return `<option value="${esc(o.id)}" ${o.id === editId ? 'selected' : ''}>${esc(label)}${
          o.is_default ? ' ★' : ''
        }</option>`;
      })
      .join('');

  const rows =
    profiles
      .map((p) => {
        const o = orgById[p.organization_id];
        const orgName = o
          ? o.short_name || o.name || '—'
          : p.organization_id.slice(0, 8) + '…';
        const inn = o?.inn || '';
        const st = p.enabled && p.configured
          ? '<span class="badge">Активен</span>'
          : p.configured
            ? '<span class="badge draft">Выкл</span>'
            : '<span class="badge draft">Нет ключа</span>';
        return `<tr>
          <td>${esc(orgName)}</td>
          <td class="mono">${esc(inn || '—')}</td>
          <td class="mono">${esc(p.env || 'sandbox')}</td>
          <td class="mono">${esc((p.merchant_id || '').slice(0, 13))}${p.merchant_id ? '…' : '—'}</td>
          <td>${st}</td>
          <td class="col-actions">
            <button type="button" class="linkish yp-edit" data-org="${esc(p.organization_id)}">Изменить</button>
            ·
            <button type="button" class="linkish yp-del" data-org="${esc(p.organization_id)}">Удалить</button>
          </td>
        </tr>`;
      })
      .join('') ||
    '<tr><td colspan="6" class="muted">Пока нет интеграций — добавьте профиль для юрлица ниже.</td></tr>';

  const formTitle = editing ? 'Изменить интеграцию' : 'Новая интеграция для юрлица';
  const showForm = state._ypShowForm || !!editing;

  view.innerHTML = formChrome(
    'Яндекс Сплит',
    `
    <p class="muted" style="margin:0 0 10px">
      У каждого юрлица — свой Merchant ID и ключ из
      <a href="${esc(data.console_url || 'https://pay.yandex.ru/')}" target="_blank" rel="noopener">pay.yandex.ru</a>
      (организация
      <a href="${esc(data.org_url || 'https://id.yandex.ru/org')}" target="_blank" rel="noopener">id.yandex.ru/org</a>).
      На <span class="mono">/pay/…</span> Сплит берётся по юрлицу заказа.
      Callback URL (один на все): <span class="mono">${esc(data.callback_url_hint || '')}</span>
    </p>
    <h3 class="form-section-title">Интеграции по юрлицам (${profiles.length})</h3>
    <div class="table-scroll">
      <table class="data-table is-dense">
        <thead><tr><th>Юрлицо</th><th>ИНН</th><th>Среда</th><th>Merchant</th><th>Статус</th><th></th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    ${
      showForm
        ? `
    <h3 class="form-section-title" style="margin-top:18px">${esc(formTitle)}</h3>
    <div class="form-grid">
      <label class="span-2">Юрлицо в Учёте №1
        <select id="yp-organization" ${editing ? 'disabled' : ''}>${orgOptsForNew}</select>
      </label>
      <label>Merchant ID
        <input id="yp-merchant" class="mono" value="${esc(editing?.merchant_id || '')}" autocomplete="off" />
      </label>
      <label>API-ключ ${editing?.api_key_set ? `<span class="muted">(${esc(editing.api_key_hint || 'задан')})</span>` : ''}
        <input id="yp-api-key" type="password" value="" placeholder="${editing?.api_key_set ? '•••• оставьте пустым' : 'в sandbox = Merchant ID'}" autocomplete="new-password" />
      </label>
      <label>Среда
        <select id="yp-env">
          <option value="sandbox" ${(editing?.env || 'sandbox') !== 'production' ? 'selected' : ''}>Sandbox (тест)</option>
          <option value="production" ${editing?.env === 'production' ? 'selected' : ''}>Production</option>
        </select>
      </label>
      <div class="span-2">
        <span class="form-grid-label">Способы оплаты на форме</span>
        <div style="display:flex;flex-wrap:wrap;gap:14px 20px;margin-top:6px">
          <label style="display:inline-flex;align-items:center;gap:8px;font-weight:500;margin:0">
            <input type="checkbox" id="yp-method-card" ${
              editing && String(editing.payment_methods || '').toUpperCase().includes('CARD')
                ? 'checked'
                : ''
            } />
            Карта (полная оплата Яндекс&nbsp;Пэй)
          </label>
          <label style="display:inline-flex;align-items:center;gap:8px;font-weight:500;margin:0">
            <input type="checkbox" id="yp-method-split" ${
              !editing || String(editing.payment_methods || 'SPLIT').toUpperCase().includes('SPLIT')
                ? 'checked'
                : ''
            } />
            Сплит (только частями)
          </label>
        </div>
        <span class="muted" style="font-weight:400;display:block;margin-top:4px">По умолчанию только Сплит. Карту включайте отдельно, если нужна полная оплата через Яндекс.</span>
      </div>
      <label>Название в Яндекс ID
        <input id="yp-org-name" value="${esc(editing?.org_name || '')}" />
      </label>
      <label>ID Яндекс
        <input id="yp-org-id" class="mono" value="${esc(editing?.org_id || '')}" />
      </label>
      <label class="span-2" style="display:flex;align-items:center;gap:8px">
        <input type="checkbox" id="yp-enabled" ${!editing || editing.enabled ? 'checked' : ''} />
        Включить Сплит для этого юрлица
      </label>
    </div>
    <p class="muted" id="yp-msg" style="margin-top:12px"></p>`
        : '<p class="muted" id="yp-msg" style="margin-top:12px"></p>'
    }`,
    {
      crumbs: [
        { label: 'Настройки', type: 'section', id: 'settings' },
        { label: 'Яндекс Сплит', current: true },
      ],
      toolbar: showForm
        ? `
        <button class="primary" type="button" id="yp-save">Сохранить</button>
        <button type="button" id="yp-cancel">Отмена</button>
        <div class="grow"></div>`
        : `
        <button class="primary" type="button" id="yp-add">Добавить для юрлица</button>
        <div class="grow"></div>`,
    }
  );
  bindFormChrome(() => showSection('settings'));

  const addBtn = document.getElementById('yp-add');
  if (addBtn) {
    addBtn.onclick = () => {
      state._ypShowForm = true;
      state._ypEditOrgId = '';
      renderYandexPaySettings();
    };
  }
  const cancelBtn = document.getElementById('yp-cancel');
  if (cancelBtn) {
    cancelBtn.onclick = () => {
      state._ypShowForm = false;
      state._ypEditOrgId = '';
      renderYandexPaySettings();
    };
  }
  view.querySelectorAll('.yp-edit').forEach((btn) => {
    btn.onclick = () => {
      state._ypEditOrgId = btn.getAttribute('data-org') || '';
      state._ypShowForm = true;
      renderYandexPaySettings();
    };
  });
  view.querySelectorAll('.yp-del').forEach((btn) => {
    btn.onclick = async () => {
      const orgId = btn.getAttribute('data-org') || '';
      const o = orgById[orgId];
      const label = o ? o.short_name || o.name : orgId;
      if (!confirm('Удалить Яндекс Сплит для «' + label + '»?')) return;
      const msg = document.getElementById('yp-msg');
      try {
        if (msg) msg.textContent = 'Удаление…';
        await api('/settings/integrations/yandex-pay/' + encodeURIComponent(orgId), {
          method: 'DELETE',
        });
        state._ypEditOrgId = '';
        state._ypShowForm = false;
        renderYandexPaySettings();
      } catch (e) {
        if (msg) msg.textContent = e.message;
      }
    };
  });

  const saveBtn = document.getElementById('yp-save');
  if (saveBtn) {
    saveBtn.onclick = async () => {
      const msg = document.getElementById('yp-msg');
      const orgSelect = document.getElementById('yp-organization');
      const organization_id = editing
        ? editId
        : String(orgSelect?.value || '').trim();
      if (!organization_id) {
        if (msg) msg.textContent = 'Выберите юрлицо';
        return;
      }
      const methods = [];
      if (document.getElementById('yp-method-card')?.checked) methods.push('CARD');
      if (document.getElementById('yp-method-split')?.checked) methods.push('SPLIT');
      if (!methods.length) {
        if (msg) msg.textContent = 'Отметьте хотя бы один способ: карта или Сплит';
        return;
      }
      const body = {
        organization_id,
        org_name: document.getElementById('yp-org-name').value.trim(),
        org_id: document.getElementById('yp-org-id').value.trim(),
        merchant_id: document.getElementById('yp-merchant').value.trim(),
        env: document.getElementById('yp-env').value,
        payment_methods: methods.join(','),
        enabled: document.getElementById('yp-enabled').checked,
      };
      const key = document.getElementById('yp-api-key').value;
      if (key) body.api_key = key;
      try {
        if (msg) msg.textContent = 'Сохранение…';
        await api('/settings/integrations/yandex-pay', {
          method: 'PUT',
          body: JSON.stringify(body),
        });
        state._ypShowForm = false;
        state._ypEditOrgId = '';
        if (msg) msg.textContent = 'Сохранено';
        setTimeout(() => renderYandexPaySettings(), 300);
      } catch (e) {
        if (msg) msg.textContent = e.message;
      }
    };
  }
}

async function renderAtolSettings() {
  let data;
  try {
    data = await api('/settings/integrations/atol');
  } catch (e) {
    view.innerHTML = formChrome('АТОЛ', `<p class="error">${esc(e.message)}</p>`);
    bindFormChrome(() => showSection('settings'));
    return;
  }
  const snoOpts = (data.sno_options || [])
    .map(
      (o) =>
        `<option value="${esc(o.id)}" ${o.id === data.sno ? 'selected' : ''}>${esc(o.label)}</option>`
    )
    .join('');
  const status = data.configured
    ? '<span class="mono" style="color:var(--taxi-green)">подключено</span>'
    : '<span class="muted">черновик (нет login/pass/группы)</span>';
  view.innerHTML = formChrome(
    'АТОЛ',
    `
    <p class="muted" style="margin:0 0 10px">
      Онлайн-касса АТОЛ Online (протокол <span class="mono">v5</span> для новых групп). Статус: ${status}.
      Секрет пароля не показывается — оставьте поле пустым, чтобы не менять.
      Источник: <span class="mono">${esc(data.source || 'env')}</span>.
      Параметры из XML интегратора: login / password / group_code / INN.
    </p>
    <h3 class="form-section-title">Доступ к API</h3>
    <div class="form-grid">
      <label class="span-2">API URL
        <input id="atol-api-url" value="${esc(data.api_url || '')}" />
      </label>
      <label>Логин
        <input id="atol-login" value="${esc(data.login || '')}" autocomplete="off" />
      </label>
      <label>Пароль ${data.pass_set ? `<span class="muted">(${esc(data.pass_hint || 'задан')})</span>` : ''}
        <input id="atol-pass" type="password" value="" placeholder="${data.pass_set ? '•••• оставьте пустым' : ''}" autocomplete="new-password" />
      </label>
      <label>Код группы
        <input id="atol-group" value="${esc(data.group_code || '')}" />
      </label>
      <label>ИНН
        <input id="atol-inn" value="${esc(data.inn || '')}" />
      </label>
      <label>СНО
        <select id="atol-sno">${snoOpts}</select>
      </label>
      <label>Email компании
        <input id="atol-company-email" value="${esc(data.company_email || '')}" />
      </label>
      <label>Адрес расчётов (URL)
        <input id="atol-pay-addr" value="${esc(data.payment_address || '')}" />
      </label>
      <label class="span-2">Email клиента (если нет телефона в заказе)
        <input id="atol-client-email" value="${esc(data.client_email || '')}" />
      </label>
    </div>
    <p class="muted" id="atol-msg" style="margin-top:12px"></p>`,
    {
      toolbar: `
        <button class="primary" type="button" id="atol-save">Сохранить</button>
        <button type="button" id="atol-test">Проверить токен</button>
        <div class="grow"></div>`,
    }
  );
  bindFormChrome(() => showSection('settings'));
  document.getElementById('atol-save').onclick = async () => {
    const msg = document.getElementById('atol-msg');
    const btn = document.getElementById('atol-save');
    btn.disabled = true;
    msg.textContent = 'Сохранение…';
    try {
      const body = {
        api_url: document.getElementById('atol-api-url').value.trim(),
        login: document.getElementById('atol-login').value.trim(),
        group_code: document.getElementById('atol-group').value.trim(),
        inn: document.getElementById('atol-inn').value.trim(),
        sno: document.getElementById('atol-sno').value,
        company_email: document.getElementById('atol-company-email').value.trim(),
        payment_address: document.getElementById('atol-pay-addr').value.trim(),
        client_email: document.getElementById('atol-client-email').value.trim(),
      };
      const pass = document.getElementById('atol-pass').value;
      if (pass) body.pass = pass;
      await api('/settings/integrations/atol', { method: 'PUT', body: JSON.stringify(body) });
      msg.textContent = 'Сохранено';
      btn.disabled = false;
      setTimeout(() => renderAtolSettings(), 400);
    } catch (e) {
      msg.textContent = e.message;
      btn.disabled = false;
    }
  };
  document.getElementById('atol-test').onclick = async () => {
    const msg = document.getElementById('atol-msg');
    msg.textContent = 'Проверка…';
    try {
      const r = await api('/settings/integrations/atol/test', { method: 'POST', body: '{}' });
      msg.textContent = r.message || (r.ok ? 'OK' : 'Ошибка');
    } catch (e) {
      msg.textContent = e.message;
    }
  };
}

async function renderTochkaSettings() {
  let data;
  try {
    data = await api('/settings/integrations/tochka');
  } catch (e) {
    view.innerHTML = formChrome('Точка Банк', `<p class="error">${esc(e.message)}</p>`);
    bindFormChrome(() => showSection('settings'));
    return;
  }
  const bridge = data.bridge || {};
  const bank = data.bank || {};
  const bridgeOk = bridge.configured
    ? '<span style="color:var(--taxi-green)">ключ моста задан</span>'
    : '<span class="muted">ключ моста не задан</span>';
  const bankOk = bank.configured
    ? '<span style="color:var(--taxi-green)">приложение настроено</span>'
    : `<span class="muted">${esc(bank.error || 'client_id/secret не заданы на bank')}</span>`;
  view.innerHTML = formChrome(
    'Точка Банк',
    `
    <p class="muted" style="margin:0 0 10px">
      Мост Учёт №1 → bank.pnevmopodveska1.ru и OAuth-приложение Точки.
      Экран балансов временно скрыт; СБП на сделках работает через мост.
      Секреты маскируются — пустое поле = не менять.
    </p>
    <h3 class="form-section-title">Мост Учёт №1 → bank · ${bridgeOk}</h3>
    <div class="form-grid">
      <label class="span-2">X-Wms-Key ${bridge.bank_sbp_key_set ? `<span class="muted">(${esc(bridge.bank_sbp_key_hint || 'задан')})</span>` : ''}
        <input id="tk-key" type="password" value="" placeholder="${bridge.bank_sbp_key_set ? '•••• оставьте пустым' : 'ключ из wms_api_key.txt'}" autocomplete="new-password" />
      </label>
      <label class="span-2">URL обзора (балансы)
        <input id="tk-overview" value="${esc(bridge.overview_url || '')}" />
      </label>
      <label class="span-2">URL создания СБП QR
        <input id="tk-sbp-create" value="${esc(bridge.sbp_create_url || '')}" />
      </label>
      <label class="span-2">URL статуса СБП
        <input id="tk-sbp-status" value="${esc(bridge.sbp_status_url || '')}" />
      </label>
    </div>
    <h3 class="form-section-title">Приложение Точка (bank) · ${bankOk}</h3>
    <div class="form-grid">
      <label class="span-2">Client ID
        <input id="tk-client-id" value="${esc(bank.client_id || '')}" autocomplete="off" />
      </label>
      <label class="span-2">Client Secret ${bank.client_secret_set ? `<span class="muted">(${esc(bank.client_secret_hint || 'задан')})</span>` : ''}
        <input id="tk-client-secret" type="password" value="" placeholder="${bank.client_secret_set ? '•••• оставьте пустым' : ''}" autocomplete="new-password" />
      </label>
    </div>
    <p class="muted" style="margin:8px 0 0">
      Токен: access ${bank.token_access_set ? 'есть' : 'нет'} · refresh ${bank.token_refresh_set ? 'есть' : 'нет'}
      ${bank.token_expires_at ? ` · expires ${esc(bank.token_expires_at)}` : ''}
      · источник app: <span class="mono">${esc(bank.source || '—')}</span>
    </p>
    <p class="muted" id="tk-msg" style="margin-top:12px"></p>`,
    {
      toolbar: `
        <button class="primary" type="button" id="tk-save">Сохранить</button>
        <button type="button" id="tk-test">Проверить обзор</button>
        <div class="grow"></div>`,
    }
  );
  bindFormChrome(() => showSection('settings'));
  document.getElementById('tk-save').onclick = async () => {
    const msg = document.getElementById('tk-msg');
    const btn = document.getElementById('tk-save');
    btn.disabled = true;
    msg.textContent = 'Сохранение…';
    try {
      const bridgeBody = {
        overview_url: document.getElementById('tk-overview').value.trim(),
        sbp_create_url: document.getElementById('tk-sbp-create').value.trim(),
        sbp_status_url: document.getElementById('tk-sbp-status').value.trim(),
      };
      const key = document.getElementById('tk-key').value;
      if (key) bridgeBody.bank_sbp_key = key;
      const bankBody = {
        client_id: document.getElementById('tk-client-id').value.trim(),
      };
      const secret = document.getElementById('tk-client-secret').value;
      if (secret) bankBody.client_secret = secret;
      await api('/settings/integrations/tochka', {
        method: 'PUT',
        body: JSON.stringify({ bridge: bridgeBody, bank: bankBody }),
      });
      msg.textContent = 'Сохранено';
      btn.disabled = false;
      setTimeout(() => renderTochkaSettings(), 400);
    } catch (e) {
      msg.textContent = e.message;
      btn.disabled = false;
    }
  };
  document.getElementById('tk-test').onclick = async () => {
    const msg = document.getElementById('tk-msg');
    msg.textContent = 'Проверка…';
    try {
      const r = await api('/settings/integrations/tochka/test', { method: 'POST', body: '{}' });
      msg.textContent = r.message || (r.ok ? 'OK' : 'Ошибка');
    } catch (e) {
      msg.textContent = e.message;
    }
  };
}

async function renderDadataSettings() {
  let data;
  try {
    data = await api('/settings/integrations/dadata');
  } catch (e) {
    view.innerHTML = formChrome('DaData', `<p class="error">${esc(e.message)}</p>`);
    bindFormChrome(() => showSection('settings'));
    return;
  }
  const status = data.configured
    ? '<span class="mono" style="color:var(--taxi-green)">подключено</span>'
    : '<span class="muted">нет API-ключа</span>';
  view.innerHTML = formChrome(
    'DaData',
    `
    <p class="muted" style="margin:0 0 10px">
      Реквизиты юрлиц/ИП по ИНН и названию для контрагентов и счетов. Статус: ${status}.
      Ключи — в <a href="${esc(data.profile_url || 'https://dadata.ru/profile/#info')}" target="_blank" rel="noopener">личном кабинете DaData</a>
      (API-ключ и секретный ключ). Логин/пароль сайта сюда не вставлять.
      Источник: <span class="mono">${esc(data.source || 'env')}</span>.
    </p>
    <h3 class="form-section-title">Ключи API</h3>
    <div class="form-grid">
      <label class="span-2">API-ключ ${data.api_key_set ? `<span class="muted">(${esc(data.api_key_hint || 'задан')})</span>` : ''}
        <input id="dd-api-key" type="password" value="" placeholder="${data.api_key_set ? '•••• оставьте пустым' : 'из профиля DaData'}" autocomplete="new-password" />
      </label>
      <label class="span-2">Секретный ключ ${data.secret_set ? `<span class="muted">(${esc(data.secret_hint || 'задан')})</span>` : ''}
        <input id="dd-secret" type="password" value="" placeholder="${data.secret_set ? '•••• оставьте пустым' : 'опционально для suggest'}" autocomplete="new-password" />
      </label>
    </div>
    <p class="muted" id="dd-msg" style="margin-top:12px"></p>`,
    {
      toolbar: `
        <button class="primary" type="button" id="dd-save">Сохранить</button>
        <button type="button" id="dd-test">Проверить</button>
        <div class="grow"></div>`,
    }
  );
  bindFormChrome(() => showSection('settings'));
  document.getElementById('dd-save').onclick = async () => {
    const msg = document.getElementById('dd-msg');
    const btn = document.getElementById('dd-save');
    btn.disabled = true;
    msg.textContent = 'Сохранение…';
    try {
      const body = {};
      const key = document.getElementById('dd-api-key').value.trim();
      const secret = document.getElementById('dd-secret').value.trim();
      if (key) body.api_key = key;
      if (secret) body.secret = secret;
      await api('/settings/integrations/dadata', {
        method: 'PUT',
        body: JSON.stringify(body),
      });
      msg.textContent = 'Сохранено';
      btn.disabled = false;
      setTimeout(() => renderDadataSettings(), 400);
    } catch (e) {
      msg.textContent = e.message;
      btn.disabled = false;
    }
  };
  document.getElementById('dd-test').onclick = async () => {
    const msg = document.getElementById('dd-msg');
    msg.textContent = 'Проверка…';
    try {
      const r = await api('/settings/integrations/dadata/test', { method: 'POST', body: '{}' });
      msg.textContent = r.ok ? 'OK · ' + (r.sample || '') : r.error || 'Ошибка';
    } catch (e) {
      msg.textContent = e.message;
    }
  };
}

async function renderDeepseekSettings() {
  let data;
  try {
    data = await api('/settings/integrations/deepseek');
  } catch (e) {
    view.innerHTML = formChrome('DeepSeek / СТС', `<p class="error">${esc(e.message)}</p>`);
    bindFormChrome(() => showSection('settings'));
    return;
  }
  const status = data.configured
    ? data.vision_ok
      ? '<span class="mono" style="color:var(--taxi-green)">ключ + vision OK</span>'
      : '<span class="mono" style="color:#b45309">ключ есть, но endpoint без фото</span>'
    : '<span class="muted">нет API-ключа</span>';
  view.innerHTML = formChrome(
    'DeepSeek / СТС',
    `
    <p class="muted" style="margin:0 0 10px">
      Распознавание СТС по фото в заказе (СТО). Статус: ${status}.
      <b>api.deepseek.com фото не принимает</b> — нужен vision-шлюз
      <a href="https://openrouter.ai/" target="_blank" rel="noopener">OpenRouter</a>
      + модель <code>deepseek/deepseek-vl2</code>.
    </p>
    <p class="error" style="margin:0 0 10px;padding:8px 10px;border-radius:8px;background:#fff7ed">
      Если OCR пишет <b>Access denied by security policy</b> — OpenRouter режет IP VPS (Cloudflare),
      ключ при этом может быть верным. Нужен исходящий прокси в другой стране или другой vision-шлюз.
    </p>
    ${
      data.hint
        ? `<p class="error" style="margin:0 0 10px;padding:8px 10px;border-radius:8px;background:#fff7ed">${esc(
            data.hint
          )}</p>`
        : ''
    }
    <div class="toolbar" style="margin:0 0 12px;flex-wrap:wrap">
      <button type="button" id="ds-preset-or">Подставить OpenRouter VL</button>
      <button type="button" id="ds-test">Проверить доступ</button>
      <span class="muted" style="font-size:12px">ключ с openrouter.ai · затем «Сохранить»</span>
    </div>
    <div class="form-grid">
      <label class="span-2">API-ключ ${data.api_key_set ? `<span class="muted">(${esc(data.api_key_hint || 'задан')})</span>` : ''}
        <input id="ds-api-key" type="password" value="" placeholder="${data.api_key_set ? '•••• оставьте пустым' : 'sk-or-v1-…'}" autocomplete="new-password" />
      </label>
      <label class="span-2">Base URL
        <input id="ds-base" value="${esc(data.base_url || 'https://openrouter.ai/api/v1')}" autocomplete="off" />
      </label>
      <label class="span-2">Модель (vision)
        <input id="ds-model" value="${esc(data.vision_model || 'deepseek/deepseek-vl2')}" placeholder="deepseek/deepseek-vl2" autocomplete="off" />
      </label>
    </div>
    <p class="muted" id="ds-msg" style="margin-top:12px"></p>`,
    {
      toolbar: `
        <button class="primary" type="button" id="ds-save">Сохранить</button>
        <div class="grow"></div>`,
    }
  );
  bindFormChrome(() => showSection('settings'));
  document.getElementById('ds-preset-or')?.addEventListener('click', () => {
    const base = document.getElementById('ds-base');
    const model = document.getElementById('ds-model');
    if (base) base.value = 'https://openrouter.ai/api/v1';
    if (model) model.value = 'deepseek/deepseek-vl2';
    const msg = document.getElementById('ds-msg');
    if (msg) msg.textContent = 'Подставлено OpenRouter. Вставьте ключ и нажмите «Сохранить».';
  });
  document.getElementById('ds-test')?.addEventListener('click', async () => {
    const msg = document.getElementById('ds-msg');
    if (msg) msg.textContent = 'Проверка шлюза с сервера…';
    try {
      const r = await api('/settings/integrations/deepseek/test', { method: 'POST', body: '{}' });
      if (msg) {
        msg.textContent = r.ok
          ? 'OK · шлюз доступен с VPS'
          : 'Нет доступа: ' + (r.error || 'ошибка');
      }
    } catch (e) {
      if (msg) msg.textContent = e.message || String(e);
    }
  });
  document.getElementById('ds-save').onclick = async () => {
    const msg = document.getElementById('ds-msg');
    const btn = document.getElementById('ds-save');
    btn.disabled = true;
    msg.textContent = 'Сохранение…';
    try {
      const body = {
        base_url: document.getElementById('ds-base').value.trim(),
        vision_model: document.getElementById('ds-model').value.trim(),
      };
      const key = document.getElementById('ds-api-key').value.trim();
      if (key) body.api_key = key;
      await api('/settings/integrations/deepseek', {
        method: 'PUT',
        body: JSON.stringify(body),
      });
      msg.textContent = 'Сохранено';
      btn.disabled = false;
      setTimeout(() => renderDeepseekSettings(), 400);
    } catch (e) {
      msg.textContent = e.message;
      btn.disabled = false;
    }
  };
}

async function renderCdekSettings() {
  // Настройки кабинетов — в sections-cdek.js (cdek-settings); отсюда из меню Интеграции.
  if (typeof openTab === 'function') {
    openTab('cdek-settings');
    return;
  }
  view.innerHTML = formChrome(
    'СДЭК',
    `<p class="muted">Откройте <button type="button" class="linkish" id="cdek-open">СДЭК · настройки</button> в разделе Склад → Доставка.</p>`
  );
  bindFormChrome(() => showSection('settings'));
  const b = document.getElementById('cdek-open');
  if (b) b.onclick = () => openTab('cdek-settings');
}

async function renderIn() {
  state.docsType = 'in';
  await renderDocs();
}

async function renderInCreate() {
  await refreshRefs();
  const whOpts = state.warehouses
    .map((w) => `<option value="${esc(w.id)}">${esc(w.name)}</option>`)
    .join('');
  /** @type {{ product_id: string, name: string, article: string, sku: string, code: string, qty: number, price: number, amount: number, serials: string[], apps_label: string, apps_short: string, apps_source: string, catalog_apps: Array<{mark?:string,model?:string,generation?:string,years?:string}>, apps_text: string, apps_override: boolean, serial_apps: Record<string,string>, apps_open: boolean, category: string }[]} */
  let orderLines = [];
  let orderAppsOpenIdx = -1;

  const appsTextFromList = (apps) => {
    if (!Array.isArray(apps) || !apps.length) return '';
    const marks = [...new Set(apps.map((a) => String(a.mark || '').trim()).filter(Boolean))];
    return marks.join(', ');
  };
  const appsLabelFromText = (text) => {
    const marks = String(text || '')
      .split(/[,;\n]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    return marks.length ? marks.join(', ') : '';
  };
  /** @type {{ product_id: string, qty: number, serials: string[], name: string, sku: string, price: number, selected: boolean }[]} */
  let outLines = [];
  /** @type {{ product_id: string, sku: string, code: string, name: string, category: string, qty: number, price: number }[]} */
  let freeLines = [];
  view.innerHTML = formChrome(
    'Новый приход',
    `
    <input type="hidden" id="ibasis" value="" />
    <div id="in-basis-step" class="in-basis-pick">
      <p class="in-basis-pick-title">Выберите основание прихода</p>
      <div class="in-basis-pick-grid">
        <button type="button" class="in-basis-card" data-basis="supplier_order" title="Передать на склад требование на оприходование по заказу">
          <span class="in-basis-card-ico" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="22" height="22"><path d="M7 3.5h7.2L18.5 7.8V20a1.5 1.5 0 01-1.5 1.5H7A1.5 1.5 0 015.5 20V5A1.5 1.5 0 017 3.5z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M14 3.6V8h4.4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M12 11v6.5M9.2 14.8L12 17.5l2.8-2.7" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </span>
          <span class="in-basis-card-text">
            <span class="in-basis-card-eyebrow">На основании</span>
            <span class="in-basis-card-title">заказа поставщику</span>
          </span>
        </button>
        <button type="button" class="in-basis-card" data-basis="return" title="Выбрать расходную — товар вернётся на склад">
          <span class="in-basis-card-ico" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="22" height="22"><path d="M8.5 7H18a3 3 0 013 3v2.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><path d="M8.5 7L5 10.5 8.5 14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/><path d="M15.5 17H6a3 3 0 01-3-3v-2.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><path d="M15.5 17L19 13.5 15.5 10" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </span>
          <span class="in-basis-card-text">
            <span class="in-basis-card-eyebrow">На основании</span>
            <span class="in-basis-card-title">расходной накладной</span>
          </span>
        </button>
        <button type="button" class="in-basis-card" data-basis="none" title="Свободный приход: склад, товар и количество">
          <span class="in-basis-card-ico" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="22" height="22"><path d="M4.5 8.2L12 4l7.5 4.2v7.6L12 20l-7.5-4.2V8.2z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M12 12v5.2M9.4 14.2H14.6" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>
          </span>
          <span class="in-basis-card-text">
            <span class="in-basis-card-eyebrow">Приход</span>
            <span class="in-basis-card-title">без основания</span>
          </span>
        </button>
        <a class="in-basis-card" href="/in/scan?v=dm11" target="_blank" rel="noopener" title="Скан марки или штрихкода — система сама определит: приход, возврат, СТО">
          <span class="in-basis-card-ico in-basis-card-ico-scan" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="22" height="22"><path d="M4 7V5.5A1.5 1.5 0 015.5 4H7M17 4h1.5A1.5 1.5 0 0120 5.5V7M20 17v1.5a1.5 1.5 0 01-1.5 1.5H17M7 20H5.5A1.5 1.5 0 014 18.5V17" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><path d="M7 9h2v6H7zm4 0h1.5v6H11zm3.5 0H17v6h-2.5z" fill="currentColor"/></svg>
          </span>
          <span class="in-basis-card-text">
            <span class="in-basis-card-eyebrow">Авто</span>
            <span class="in-basis-card-title">определить через скан</span>
          </span>
        </a>
      </div>
    </div>
    <div id="in-form-body" hidden>
      <div class="in-basis-chosen" id="in-basis-chosen">
        <div class="in-basis-chosen-main">
          <span class="in-basis-chosen-eyebrow">На основании</span>
          <span class="in-basis-chosen-title" id="in-basis-label"></span>
          <span class="in-basis-chosen-doc" id="in-basis-doc"></span>
        </div>
        <button type="button" class="in-basis-change-ico" id="in-basis-change" title="Изменить основание" aria-label="Изменить основание" data-tip="Изменить">
          <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M4.5 16.9V19.5h2.6l7.7-7.7-2.6-2.6-7.7 7.7z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><path d="M14.4 7l2.6 2.6 1.5-1.5a1.4 1.4 0 000-2l-.6-.6a1.4 1.4 0 00-2 0L14.4 7z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/></svg>
        </button>
      </div>
      <div class="form-grid">
        <label>Склад прихода<select id="iwh">${whOpts}</select></label>
        <label id="ihint-wrap" class="span-2"><span class="muted" id="ihint"></span></label>

        <div class="span-2" id="iorder-wrap" hidden>
          <label>
            Заказ поставщику
            <input id="iso-q" placeholder="Номер, поставщик, комментарий…" autocomplete="off" />
            <input type="hidden" id="iso-id" />
            <div id="iso-suggest" class="suggest hidden"></div>
            <p class="muted" id="iso-label"></p>
          </label>
          <div id="iso-lines" class="iso-lines"></div>
        </div>

        <div class="span-2" id="iout-wrap" hidden>
          <label>
            Расходная накладная
            <input id="iout-q" placeholder="Номер, покупатель, дата… или скан марки" autocomplete="off" />
            <input type="hidden" id="iout-id" />
            <input type="hidden" id="iout-deal-id" />
            <div id="iout-suggest" class="suggest hidden"></div>
            <p class="muted" id="iout-label"></p>
          </label>
          <div id="iout-lines" class="iso-lines"></div>
        </div>

        <div id="icp-wrap">
          <label>
            <span id="icp-role">Контрагент</span>
            <div style="display:flex;gap:8px;align-items:stretch">
              <input id="icp-q" placeholder="Название / ИНН…" autocomplete="off" style="flex:1" />
              <button type="button" id="icp-create" title="Создать контрагента, если нет в списке">Создать</button>
            </div>
            <input type="hidden" id="icp-id" />
            <div id="icp-suggest" class="suggest hidden"></div>
            <p class="muted" id="icp-label"></p>
          </label>
        </div>
        <label class="span-2">Комментарий<input id="icomment" /></label>

        <div id="in-free-block" class="span-2" hidden>
          <div class="thin-add-panel in-free-picker" id="ifree-picker">
            <div class="thin-add-panel-head">
              <strong>Добавить номенклатуру</strong>
              <span class="muted" style="font-size:12px">по одной: категория → поиск по коду / артикулу → цена закупки</span>
            </div>
            <div class="thin-prod-picker">
              <div class="form-grid thin-prod-filters">
                <label>Категория
                  <select id="ifree-cat-root"><option value="">Загрузка…</option></select>
                </label>
                <label id="ifree-cat-sub-wrap" hidden>Подкатегория
                  <select id="ifree-cat-sub" disabled><option value="">—</option></select>
                </label>
                <label class="span-2">Поиск (код / артикул / название)
                  <input id="ifree-q" autocomplete="off" placeholder="Код, артикул или название…" />
                </label>
              </div>
              <div class="thin-prod-list-wrap">
                <table class="data-table is-dense thin-prod-list" data-no-col-filter="1">
                  <thead><tr>
                    <th>Код</th>
                    <th>Артикул</th>
                    <th>Название</th>
                    <th>Категория</th>
                    <th class="thin-prod-num">Кол-во</th>
                    <th class="thin-prod-money">Цена закупки</th>
                    <th></th>
                  </tr></thead>
                  <tbody id="ifree-prod-tbody">
                    <tr><td colspan="7" class="muted">Выберите категорию или введите поиск</td></tr>
                  </tbody>
                </table>
              </div>
              <p class="muted" id="ifree-prod-meta"></p>
            </div>
          </div>
          <table class="in-free-table" id="ifree-table" style="margin-top:12px">
            <thead>
              <tr>
                <th>Код</th>
                <th>Артикул</th>
                <th>Номенклатура</th>
                <th>Категория</th>
                <th class="num">Кол-во</th>
                <th class="num">Цена закупки</th>
                <th class="num">Сумма</th>
                <th></th>
              </tr>
            </thead>
            <tbody id="ifree-tbody">
              <tr class="muted"><td colspan="8">Добавьте позиции — приходная пока пустая</td></tr>
            </tbody>
          </table>
          <p class="muted" id="ifree-sum" style="margin:8px 0 0;text-align:right"></p>
        </div>

        <div id="imanual-lines" style="display:none">
          <label>Номенклатура
            <input id="iq" placeholder="SKU или название…" autocomplete="off" />
            <input type="hidden" id="ipid" />
            <div id="isuggest" class="suggest hidden"></div>
            <p class="muted" id="ilabel"></p>
          </label>
          <label>Количество<input id="iqty" type="number" step="1" min="1" value="1" /></label>
          <label id="iprice-wrap" hidden>Цена закупки<input id="iprice" type="number" step="0.01" min="0" value="0" /></label>
          <label class="span-2" id="iserials-wrap">Марки <span class="muted" id="iserials-hint"></span>
            <textarea id="iserials" rows="4" placeholder="DM5157429853"></textarea>
          </label>
          <label class="span-2" id="iapps-wrap">Применимость партии
            <input id="iapps" placeholder="Audi, Bentley — или пусто = как в каталоге / дефолт поставщика" autocomplete="off" />
            <span class="muted" style="font-size:11px">Куда годится именно эта партия (не весь каталог). Через запятую — марки авто.</span>
          </label>
        </div>
      </div>
      <div class="form-actions is-float">
        <button class="primary" type="button" id="ipost">Провести</button>
        <button type="button" id="igen-marks" hidden>Сгенерировать марки</button>
        <span class="muted" id="imsg"></span>
      </div>
    </div>`,
    { parentTab: 'in', parentLabel: 'Приходные накладные' }
  );
  bindFormChrome(() => {
    clearFloatFormDock();
    openTab('in');
  });

  const basisEl = document.getElementById('ibasis');
  const basisStep = document.getElementById('in-basis-step');
  const formBody = document.getElementById('in-form-body');
  const basisLabel = document.getElementById('in-basis-label');
  const basisDoc = document.getElementById('in-basis-doc');
  const hint = document.getElementById('ihint');
  const orderWrap = document.getElementById('iorder-wrap');
  const outWrap = document.getElementById('iout-wrap');
  const freeBlock = document.getElementById('in-free-block');
  const manualWrap = document.getElementById('imanual-lines');
  const cpWrap = document.getElementById('icp-wrap');
  const cpRole = document.getElementById('icp-role');
  const priceWrap = document.getElementById('iprice-wrap');
  const serialsWrap = document.getElementById('iserials-wrap');
  const serialsHint = document.getElementById('iserials-hint');
  const appsWrap = document.getElementById('iapps-wrap');
  const appsEl = document.getElementById('iapps');
  const genBtn = document.getElementById('igen-marks');
  const postBtn = document.getElementById('ipost');
  const qInput = document.getElementById('iq');
  const idInput = document.getElementById('ipid');
  const suggest = document.getElementById('isuggest');
  const label = document.getElementById('ilabel');
  const cpQ = document.getElementById('icp-q');
  const cpId = document.getElementById('icp-id');
  const cpSuggest = document.getElementById('icp-suggest');
  const cpLabel = document.getElementById('icp-label');
  const serialsEl = document.getElementById('iserials');
  const qtyEl = document.getElementById('iqty');
  const priceEl = document.getElementById('iprice');
  const lineApps = () => String(appsEl?.value || '').trim();
  const soQ = document.getElementById('iso-q');
  const soId = document.getElementById('iso-id');
  const soSuggest = document.getElementById('iso-suggest');
  const soLabel = document.getElementById('iso-label');
  const soLines = document.getElementById('iso-lines');
  const outQ = document.getElementById('iout-q');
  const outId = document.getElementById('iout-id');
  const outDealId = document.getElementById('iout-deal-id');
  const outSuggest = document.getElementById('iout-suggest');
  const outLabel = document.getElementById('iout-label');
  const outLinesEl = document.getElementById('iout-lines');
  const freeQ = document.getElementById('ifree-q');
  const freeCatRoot = document.getElementById('ifree-cat-root');
  const freeCatSub = document.getElementById('ifree-cat-sub');
  const freeCatSubWrap = document.getElementById('ifree-cat-sub-wrap');
  const freeProdTbody = document.getElementById('ifree-prod-tbody');
  const freeProdMeta = document.getElementById('ifree-prod-meta');
  const freeTbody = document.getElementById('ifree-tbody');
  const freeSum = document.getElementById('ifree-sum');
  const cpCreateBtn = document.getElementById('icp-create');
  let freeCatTree = { roots: [], uncategorized: 0 };
  let freeProdLoadSeq = 0;
  let freePickerReady = false;

  const renderFreeLines = () => {
    if (!freeTbody) return;
    if (!freeLines.length) {
      freeTbody.innerHTML =
        '<tr class="muted"><td colspan="8">Добавьте позиции — приходная пока пустая</td></tr>';
      if (freeSum) freeSum.textContent = '';
      return;
    }
    let total = 0;
    freeTbody.innerHTML = freeLines
      .map((l, idx) => {
        const sum = (Number(l.qty) || 0) * (Number(l.price) || 0);
        total += sum;
        return `<tr>
          <td class="mono">${esc(l.code || '—')}</td>
          <td class="mono">${esc(l.sku || '—')}</td>
          <td>${esc(l.name || l.sku || '')}</td>
          <td class="muted">${esc(l.category || '—')}</td>
          <td class="num mono">${esc(String(l.qty))}</td>
          <td class="num mono">${formatMoney(l.price)}</td>
          <td class="num mono">${formatMoney(sum)}</td>
          <td><button type="button" class="linkish ifree-del" data-idx="${idx}">удалить</button></td>
        </tr>`;
      })
      .join('');
    if (freeSum) freeSum.textContent = 'Итого закупка: ' + formatMoney(total);
    freeTbody.querySelectorAll('.ifree-del').forEach((btn) => {
      btn.onclick = () => {
        const i = Number(btn.getAttribute('data-idx'));
        if (Number.isFinite(i)) {
          freeLines.splice(i, 1);
          renderFreeLines();
        }
      };
    });
  };

  const addFreeLine = (row) => {
    const msg = document.getElementById('imsg');
    const productId = String(row?.product_id || '').trim();
    if (!productId) {
      if (msg) msg.textContent = 'Выберите номенклатуру';
      return false;
    }
    const qty = Math.max(0.001, Number(row.qty) || 1);
    const price = Number(row.price);
    if (!(price > 0)) {
      if (msg) msg.textContent = 'Укажите цену закупки больше 0';
      return false;
    }
    const existing = freeLines.find((l) => l.product_id === productId);
    if (existing) {
      existing.qty = Math.round((Number(existing.qty) + qty) * 1000) / 1000;
      existing.price = price;
    } else {
      freeLines.push({
        product_id: productId,
        sku: String(row.sku || ''),
        code: String(row.code || ''),
        name: String(row.name || ''),
        category: String(row.category || ''),
        qty,
        price,
      });
    }
    renderFreeLines();
    if (msg) msg.textContent = '';
    return true;
  };

  const freeSelectedCategoryId = () => {
    const sub = (freeCatSub?.value || '').trim();
    if (sub) return sub;
    return (freeCatRoot?.value || '').trim();
  };

  const fillFreeSubOptions = (rootId) => {
    const rootCat = (freeCatTree.roots || []).find((r) => r.id === rootId);
    const subs = rootCat ? flattenCatChildren(rootCat.children || []) : [];
    if (!subs.length) {
      if (freeCatSubWrap) freeCatSubWrap.hidden = true;
      if (freeCatSub) {
        freeCatSub.disabled = true;
        freeCatSub.innerHTML = '<option value="">—</option>';
      }
      return;
    }
    if (freeCatSubWrap) freeCatSubWrap.hidden = false;
    if (freeCatSub) {
      freeCatSub.disabled = false;
      freeCatSub.innerHTML =
        '<option value="">Все подкатегории</option>' +
        subs
          .map(
            (c) =>
              `<option value="${esc(c.id)}">${esc(c.name)} (${esc(c.products_total || 0)})</option>`
          )
          .join('');
    }
  };

  const reloadFreeProducts = async () => {
    if (!freeProdTbody) return;
    const seq = ++freeProdLoadSeq;
    freeProdTbody.innerHTML = '<tr><td colspan="7" class="muted">Загрузка…</td></tr>';
    try {
      const q = (freeQ?.value || '').trim();
      const catId = freeSelectedCategoryId();
      let url = '/products?limit=80&page=1&item_kind=product';
      if (q) url += '&q=' + encodeURIComponent(q);
      if (catId) url += '&category_id=' + encodeURIComponent(catId);
      const data = await api(url);
      if (seq !== freeProdLoadSeq) return;
      const items = data.items || [];
      if (!items.length) {
        freeProdTbody.innerHTML =
          '<tr><td colspan="7" class="muted">Ничего не найдено — смените категорию или поиск</td></tr>';
        if (freeProdMeta) freeProdMeta.textContent = '0 товаров';
        return;
      }
      freeProdTbody.innerHTML = items
        .map((p) => {
          const title = productTitle(p);
          const code = String(p.code || '').trim();
          const sku = String(p.sku || '').trim();
          const cat = String(p.category || '').trim();
          return `<tr data-product-id="${esc(p.id)}" data-sku="${esc(sku)}" data-code="${esc(code)}"
            data-name="${esc(title)}" data-category="${esc(cat)}">
            <td class="mono">${esc(code || '—')}</td>
            <td class="mono">${esc(sku || '—')}</td>
            <td title="${esc(title)}">${esc(title)}</td>
            <td class="muted">${esc(cat || '—')}</td>
            <td class="thin-prod-num"><input class="ifree-row-qty mono" type="number" inputmode="decimal" step="0.001" min="0.001" value="1" aria-label="Количество" /></td>
            <td class="thin-prod-money"><input class="ifree-row-price mono" type="number" inputmode="decimal" step="0.01" min="0" value="" placeholder="закупка" aria-label="Цена закупки" /></td>
            <td><button type="button" class="primary ifree-row-add">Добавить</button></td>
          </tr>`;
        })
        .join('');
      if (freeProdMeta) {
        const total = Number(data.total) || items.length;
        freeProdMeta.textContent =
          total > items.length
            ? `Показано ${items.length} из ${total} — уточните поиск или категорию`
            : `${items.length} товар${items.length === 1 ? '' : items.length < 5 ? 'а' : 'ов'}`;
      }
    } catch (e) {
      if (seq !== freeProdLoadSeq) return;
      freeProdTbody.innerHTML = `<tr><td colspan="7" class="error">${esc(e.message || String(e))}</td></tr>`;
      if (freeProdMeta) freeProdMeta.textContent = '';
    }
  };

  const mountFreePicker = () => {
    if (freePickerReady || !freeCatRoot) return;
    freePickerReady = true;
    freeProdTbody?.addEventListener('click', (e) => {
      const btn = e.target?.closest?.('.ifree-row-add');
      if (!btn) return;
      const tr = btn.closest('tr[data-product-id]');
      if (!tr) return;
      const qtyEl = tr.querySelector('.ifree-row-qty');
      const priceEl = tr.querySelector('.ifree-row-price');
      const ok = addFreeLine({
        product_id: tr.dataset.productId,
        sku: tr.dataset.sku,
        code: tr.dataset.code,
        name: tr.dataset.name,
        category: tr.dataset.category,
        qty: qtyEl?.value,
        price: priceEl?.value,
      });
      if (ok) {
        if (qtyEl) qtyEl.value = '1';
        if (priceEl) {
          priceEl.value = '';
          priceEl.focus();
        }
      } else {
        priceEl?.focus();
      }
    });
    freeCatRoot.addEventListener('change', () => {
      fillFreeSubOptions(freeCatRoot.value || '');
      reloadFreeProducts();
    });
    freeCatSub?.addEventListener('change', () => reloadFreeProducts());
    let qTimer = 0;
    freeQ?.addEventListener('input', () => {
      clearTimeout(qTimer);
      qTimer = setTimeout(() => reloadFreeProducts(), 280);
    });
    freeQ?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        clearTimeout(qTimer);
        reloadFreeProducts();
      }
    });
    (async () => {
      try {
        freeCatTree = await api('/categories/tree').catch(() => ({
          roots: [],
          uncategorized: 0,
        }));
      } catch (_) {
        freeCatTree = { roots: [], uncategorized: 0 };
      }
      freeCatRoot.innerHTML =
        '<option value="">Все категории</option>' +
        `<option value="__none__">Без категории (${esc(freeCatTree.uncategorized || 0)})</option>` +
        (freeCatTree.roots || [])
          .map(
            (r) =>
              `<option value="${esc(r.id)}">${esc(r.name)} (${esc(r.products_total || 0)})</option>`
          )
          .join('');
      fillFreeSubOptions('');
      await reloadFreeProducts();
    })();
  };

  const openInboundCpCreate = () => {
    const partyKindDefault = 'legal';
    openCreateLightbox({
      title: 'Новый контрагент',
      wide: true,
      bodyHtml: `
        <div class="form-grid" id="cp-create-grid">
          <div class="span-2" id="cparty-wrap">
            <span class="form-grid-label">Кто</span>
            ${radioPillsHtml(
              'cparty',
              [
                { value: 'person', label: 'Физлицо' },
                { value: 'ip', label: 'ИП' },
                { value: 'legal', label: 'Юрлицо' },
              ],
              partyKindDefault
            )}
          </div>
          <label id="clabel-inn">ИНН
            <input id="cinn" class="mono" placeholder="10 или 12 цифр" autocomplete="off" />
          </label>
          <label class="span-2" id="clabel-name"><span id="cname-title">Название</span>
            <input id="cname" placeholder="ООО «…»" autocomplete="off" />
            <div id="cname-suggest" class="suggest hidden"></div>
          </label>
          <label id="clabel-kpp">КПП
            <input id="ckpp" class="mono" placeholder="9 цифр" />
          </label>
          <label id="clabel-ogrn">
            <span class="ogrn-title">ОГРН</span>
            <input id="cogrn" class="mono" placeholder="ОГРН" />
          </label>
          <label class="span-2">Адрес
            <input id="caddress" placeholder="юридический адрес" autocomplete="off" />
            <div id="caddress-suggest" class="suggest hidden"></div>
          </label>
          <label>Телефон
            <input id="cphone1" class="cphone" />
          </label>
          <label>Email
            <input id="cemail" type="email" placeholder="name@company.ru" autocomplete="off" />
          </label>
          <input type="hidden" id="ckind" value="supplier" />
          <input type="hidden" id="cname-full" value="" />
        </div>`,
      onMount: (root) => {
        const getCpartyKind = () => radioPillsValue('cparty', root) || 'person';
        const syncPartyFields = () => {
          const pk = getCpartyKind();
          const nameTitle = root.querySelector('#cname-title');
          const nameInp = root.querySelector('#cname');
          const innLab = root.querySelector('#clabel-inn');
          const kppLab = root.querySelector('#clabel-kpp');
          const ogrnLab = root.querySelector('#clabel-ogrn');
          const ogrnInp = root.querySelector('#cogrn');
          const addr = root.querySelector('#caddress');
          const inn = root.querySelector('#cinn');
          if (pk === 'legal') {
            if (nameTitle) nameTitle.textContent = 'Название';
            if (nameInp) nameInp.placeholder = 'ООО «…»';
            if (innLab) innLab.hidden = false;
            if (kppLab) kppLab.hidden = false;
            if (ogrnLab) ogrnLab.hidden = false;
            const ogrnTitle = ogrnLab?.querySelector('.ogrn-title');
            if (ogrnTitle) ogrnTitle.textContent = 'ОГРН';
            if (ogrnInp) ogrnInp.placeholder = 'ОГРН';
            if (addr) addr.placeholder = 'юридический адрес';
            if (inn) inn.placeholder = '10 цифр';
          } else if (pk === 'ip') {
            if (nameTitle) nameTitle.textContent = 'ФИО ИП';
            if (nameInp) nameInp.placeholder = 'Иванов Иван Иванович';
            if (innLab) innLab.hidden = false;
            if (kppLab) kppLab.hidden = true;
            if (ogrnLab) ogrnLab.hidden = false;
            const ogrnTitle = ogrnLab?.querySelector('.ogrn-title');
            if (ogrnTitle) ogrnTitle.textContent = 'ОГРНИП';
            if (ogrnInp) ogrnInp.placeholder = 'ОГРНИП';
            if (addr) addr.placeholder = 'адрес регистрации';
            if (inn) inn.placeholder = '12 цифр';
            const kpp = root.querySelector('#ckpp');
            if (kpp) kpp.value = '';
          } else {
            if (nameTitle) nameTitle.textContent = 'ФИО';
            if (nameInp) nameInp.placeholder = 'Иванов Иван Иванович';
            if (innLab) innLab.hidden = true;
            if (kppLab) kppLab.hidden = true;
            if (ogrnLab) ogrnLab.hidden = true;
            if (addr) addr.placeholder = 'адрес';
            if (inn) inn.value = '';
            const kpp = root.querySelector('#ckpp');
            if (kpp) kpp.value = '';
            const ogrn = root.querySelector('#cogrn');
            if (ogrn) ogrn.value = '';
          }
        };
        bindRadioPills(root, (name) => {
          if (name === 'cparty') syncPartyFields();
        });
        syncPartyFields();
        root._cpGetKind = getCpartyKind;
        const preset = (cpQ.value || '').trim();
        if (preset) {
          const nameInp = root.querySelector('#cname');
          if (nameInp && !nameInp.value) nameInp.value = preset;
        }
        bindDadataSuggest(
          root.querySelector('#cname'),
          root.querySelector('#cname-suggest'),
          async (q) => {
            const pk = getCpartyKind();
            if (pk === 'legal' || pk === 'ip') {
              const r = await api('/dadata/party?q=' + encodeURIComponent(q) + '&count=8');
              return (r.items || []).map((p) => ({
                value: p.name || p.value || '',
                hint: p.inn ? 'ИНН ' + p.inn : '',
                party: p,
              }));
            }
            const r = await api('/dadata/fio?q=' + encodeURIComponent(q) + '&count=8');
            return (r.items || []).map((p) => ({
              value: p.value || p.unrestricted_value || '',
              fio: p,
            }));
          },
          {
            minLen: 2,
            onPick: (it) => {
              if (it.party) {
                const p = it.party;
                const set = (id, val) => {
                  const el = root.querySelector('#' + id);
                  if (el && val != null) el.value = String(val);
                };
                set('cname-full', p.name_full || p.name || '');
                if (p.inn) set('cinn', p.inn);
                if (p.kpp) set('ckpp', p.kpp);
                if (p.ogrn) set('cogrn', p.ogrn);
                if (p.address) set('caddress', p.address);
                if (p.type === 'LEGAL') setRadioPillsValue('cparty', 'legal', root);
                else if (p.type === 'INDIVIDUAL') setRadioPillsValue('cparty', 'ip', root);
                syncPartyFields();
              } else if (it.fio) {
                const full = root.querySelector('#cname-full');
                if (full) full.value = it.value;
              }
            },
          }
        );
        bindDadataSuggest(
          root.querySelector('#caddress'),
          root.querySelector('#caddress-suggest'),
          async (q) => {
            const r = await api('/dadata/address?q=' + encodeURIComponent(q) + '&count=8');
            return (r.items || []).map((p) => ({
              value: p.unrestricted_value || p.value || '',
              hint: p.postal_code || '',
            }));
          },
          { minLen: 3 }
        );
      },
      onSubmit: async (root) => {
        const partyKind = root._cpGetKind ? root._cpGetKind() : 'legal';
        const name = (root.querySelector('#cname')?.value || '').trim();
        const inn = partyKind === 'person' ? '' : (root.querySelector('#cinn')?.value || '').trim();
        if (!name) {
          root.querySelector('#cname')?.focus();
          throw new Error(partyKind === 'legal' ? 'Укажите название' : 'Укажите ФИО');
        }
        const created = await api('/counterparties', {
          method: 'POST',
          body: JSON.stringify({
            name,
            inn,
            party_kind: partyKind,
            kpp: partyKind === 'legal' ? root.querySelector('#ckpp')?.value || '' : '',
            ogrn: partyKind === 'person' ? '' : root.querySelector('#cogrn')?.value || '',
            address: root.querySelector('#caddress')?.value || '',
            name_full: root.querySelector('#cname-full')?.value || '',
            email: (root.querySelector('#cemail')?.value || '').trim(),
            phone: joinPhones(
              [...root.querySelectorAll('.cphone')].map((el) => formatPhone(el.value))
            ),
            kind: 'supplier',
          }),
        });
        closeCreateLightbox();
        if (created?.id) {
          cpId.value = created.id;
          cpQ.value = created.name || name;
          cpLabel.textContent = 'Контрагент: ' + (created.name || name);
          cpSuggest.classList.add('hidden');
        }
      },
    });
  };

  const clearBasisFields = () => {
    soId.value = '';
    soQ.value = '';
    soLabel.textContent = '';
    soLines.innerHTML = '';
    orderLines = [];
    orderAppsOpenIdx = -1;
    outId.value = '';
    outQ.value = '';
    outLabel.textContent = '';
    if (outDealId) outDealId.value = '';
    outLinesEl.innerHTML = '';
    outLines = [];
    freeLines = [];
    if (freeQ) freeQ.value = '';
    renderFreeLines();
    cpId.value = '';
    cpQ.value = '';
    cpLabel.textContent = '';
    cpQ.readOnly = false;
    idInput.value = '';
    qInput.value = '';
    label.textContent = '';
    serialsEl.value = '';
    if (basisDoc) basisDoc.textContent = '';
    if (document.getElementById('imsg')) document.getElementById('imsg').textContent = '';
  };

  const setBasisDoc = (text) => {
    if (basisDoc) basisDoc.textContent = text || '';
  };

  const syncBasis = () => {
    const basis = basisEl.value;
    const isSo = basis === 'supplier_order';
    const isReturn = basis === 'return';
    const isNone = basis === 'none';
    const picked = isSo || isReturn || isNone;
    basisStep.hidden = picked;
    formBody.hidden = !picked;
    const floatDock = document.getElementById('form-float-dock');
    if (floatDock) floatDock.style.display = picked ? '' : 'none';
    orderWrap.hidden = !isSo;
    if (outWrap) outWrap.hidden = !isReturn;
    if (freeBlock) freeBlock.hidden = !isNone;
    if (isReturn && outId.value && !outLines.length) {
      manualWrap.style.display = 'contents';
    } else {
      manualWrap.style.display = 'none';
    }
    priceWrap.hidden = true;
    serialsWrap.hidden = isSo || isNone || (isReturn && outLines.length > 0);
    if (appsWrap) appsWrap.hidden = isNone || !isReturn || !outId.value || !!outLines.length;
    genBtn.hidden = true;
    if (isNone) {
      cpWrap.hidden = false;
      cpRole.textContent = 'Контрагент';
      cpQ.placeholder = 'Название / ИНН…';
      cpQ.readOnly = false;
    } else {
      // Поставщик/покупатель — из заказа или расходной
      cpWrap.hidden = true;
      cpRole.textContent = isReturn ? 'Покупатель' : 'Поставщик';
      cpQ.readOnly = true;
    }
    if (isSo) {
      basisLabel.textContent = 'заказа поставщику';
      if (!soId.value) setBasisDoc('выберите заказ — передадим требование на склад');
      hint.textContent =
        'Выберите заказ — при необходимости раскройте применимость и урежьте её для марок (не как у номенклатуры). Затем передайте на склад.';
      postBtn.textContent = 'Передать на склад';
    } else if (isReturn) {
      basisLabel.textContent = 'расходной накладной';
      if (!outId.value) setBasisDoc('выберите расходную — отметьте товары к возврату');
      hint.textContent =
        'Выберите расходную и отметьте товары/марки к возврату (можно частично). Создадим требование на склад и ТВД в Деньгах.';
      postBtn.textContent = 'Передать на склад · возврат';
    } else if (isNone) {
      basisLabel.textContent = 'без документа-основания';
      setBasisDoc('контрагент → номенклатура по категориям → цена закупки');
      hint.textContent =
        'Укажите склад и контрагента (или создайте), добавьте позиции по одной с ценой закупки. Марки не обязательны.';
      postBtn.textContent = 'Провести приход';
      mountFreePicker();
    } else {
      basisLabel.textContent = '';
      setBasisDoc('');
      hint.textContent = '';
      postBtn.textContent = 'Провести';
    }
    serialsHint.textContent = '(по одной в строке)';
  };

  const setBasis = (basis) => {
    basisEl.value = basis || '';
    clearBasisFields();
    syncBasis();
    if (basis === 'supplier_order') setTimeout(() => soQ.focus(), 30);
    if (basis === 'return') setTimeout(() => outQ.focus(), 30);
    if (basis === 'none') setTimeout(() => cpQ.focus(), 30);
  };

  basisStep.querySelectorAll('[data-basis]').forEach((btn) => {
    btn.onclick = () => setBasis(btn.getAttribute('data-basis') || '');
  });
  document.getElementById('in-basis-change').onclick = () => setBasis('');
  const preBasis = String(state.inCreateBasis || '').trim();
  state.inCreateBasis = '';
  if (preBasis === 'supplier_order' || preBasis === 'return' || preBasis === 'none') {
    setBasis(preBasis);
  } else {
    syncBasis();
  }

  const syncQtyFromSerials = () => {
    const n = String(serialsEl.value || '')
      .split(/[\n,;]+/)
      .map((s) => s.trim())
      .filter(Boolean).length;
    if (n > 0) qtyEl.value = String(n);
  };
  serialsEl.oninput = syncQtyFromSerials;
  genBtn.onclick = async () => {
    const msg = document.getElementById('imsg');
    const n = Math.max(1, Math.round(Number(qtyEl.value) || 1));
    try {
      msg.textContent = 'Генерация марок…';
      const res = await api('/docs/marks/preview', {
        method: 'POST',
        body: JSON.stringify({ count: n, prefix: 'DM' }),
      });
      serialsEl.value = (res.serials || []).join('\n');
      syncQtyFromSerials();
      msg.textContent = `Сгенерировано: ${(res.serials || []).length}`;
    } catch (e) {
      msg.textContent = e.message || String(e);
    }
  };

  const resolveSupplierId = async (name, knownId) => {
    if (knownId) return knownId;
    if (!name) return '';
    try {
      const cps = await api(
        '/counterparties?kind=supplier&limit=5&q=' + encodeURIComponent(name)
      );
      const items = cps.items || cps || [];
      return Array.isArray(items) && items[0]?.id ? items[0].id : '';
    } catch (_) {
      return '';
    }
  };

  const renderOrderLinesTable = (party) => {
    if (!soLines) return;
    if (!orderLines.length) {
      soLines.innerHTML = '<span class="error">Нет строк в заказе</span>';
      return;
    }
    const marks = orderLines.reduce((n, l) => n + l.serials.length, 0);
    const sum = orderLines.reduce(
      (n, l) => n + (Number(l.amount) || Number(l.price) * Number(l.qty) || 0),
      0
    );
    const meta =
      (party ? `Поставщик: <b>${esc(party)}</b> · ` : '') +
      `строк: <b>${orderLines.length}</b> · марок: <b>${marks}</b>` +
      (sum > 0 ? ` · сумма: <b>${esc(formatMoney(sum))}</b>` : '');
    const rows = orderLines
      .map((l, idx) => {
        const serials = l.serials || [];
        const showN = 4;
        const shown = serials.slice(0, showN).map((s) => esc(s)).join('<br>');
        const more =
          serials.length > showN
            ? `<button type="button" class="linkish iso-marks-more" data-idx="${idx}">ещё ${
                serials.length - showN
              }</button>`
            : '';
        const marksHtml = serials.length
          ? `<div class="iso-marks mono">${shown}${more ? '<br>' + more : ''}</div>`
          : '<span class="muted">—</span>';
        const effective =
          l.apps_override && l.apps_text
            ? appsLabelFromText(l.apps_text)
            : l.apps_label || l.apps_short || '';
        const short =
          l.apps_override && l.apps_text
            ? appsLabelFromText(l.apps_text)
            : l.apps_short || l.apps_label || 'как в каталоге';
        const srcHint =
          l.apps_override
            ? 'вручную для партии'
            : l.apps_source === 'supplier'
              ? 'дефолт поставщика'
              : l.apps_source === 'catalog'
                ? 'из номенклатуры'
                : 'как в каталоге';
        const hasSerialOverride =
          l.serial_apps && Object.keys(l.serial_apps).some((k) => String(l.serial_apps[k] || '').trim());
        const appsBtn = `<button type="button" class="linkish iso-apps-toggle" data-idx="${idx}" title="${esc(
          (effective || 'как в каталоге') + ' · ' + srcHint + ' — нажмите, чтобы изменить для марок'
        )}">${esc(short)}${
          l.apps_override || hasSerialOverride
            ? ' <span class="iso-apps-badge">партия</span>'
            : ''
        } ▾</button>`;
        const lineSum = Number(l.amount) || Number(l.price) * Number(l.qty) || 0;
        const open = orderAppsOpenIdx === idx;
        const catalogText = appsTextFromList(l.catalog_apps) || (l.apps_label || '');
        const serialRows = serials.length
          ? serials
              .map((s) => {
                const val =
                  l.serial_apps && l.serial_apps[s] != null
                    ? l.serial_apps[s]
                    : l.apps_override
                      ? l.apps_text || ''
                      : '';
                return `<div class="iso-apps-serial-row">
                  <code class="mono">${esc(s)}</code>
                  <input class="iso-apps-serial-inp" data-idx="${idx}" data-serial="${esc(s)}"
                    value="${esc(val)}" placeholder="марки авто через запятую…" autocomplete="off" />
                </div>`;
              })
              .join('')
          : '<p class="muted" style="margin:6px 0 0;font-size:12px">Марок в строке нет — задайте применимость на всю строку.</p>';
        const editor = open
          ? `<tr class="iso-apps-editor-row" data-idx="${idx}">
              <td colspan="9">
                <div class="iso-apps-editor">
                  <div class="iso-apps-editor-head">
                    <strong>Применимость партии (не номенклатура)</strong>
                    <span class="muted">Каталог: ${esc(catalogText || 'не задан')} · сейчас: ${esc(srcHint)}</span>
                  </div>
                  <label>Для всей строки (марки авто через запятую)
                    <input class="iso-apps-line-inp" data-idx="${idx}" value="${esc(
                      l.apps_text || ''
                    )}" placeholder="${esc(
                      catalogText || 'Audi, Porsche — пусто = как в каталоге/дефолт поставщика'
                    )}" autocomplete="off" />
                  </label>
                  <div class="iso-apps-serials">
                    <div class="muted" style="font-size:12px;margin:8px 0 4px">По марке — можно урезать иначе, чем у номенклатуры:</div>
                    ${serialRows}
                  </div>
                  <div class="toolbar" style="margin-top:8px;gap:8px">
                    <button type="button" class="primary iso-apps-apply" data-idx="${idx}">Применить к строке</button>
                    <button type="button" class="iso-apps-fill-all" data-idx="${idx}">Скопировать во все марки</button>
                    <button type="button" class="iso-apps-reset" data-idx="${idx}">Сбросить к каталогу</button>
                    <button type="button" class="iso-apps-close" data-idx="${idx}">Свернуть</button>
                  </div>
                </div>
              </td>
            </tr>`
          : '';
        return `<tr>
          <td class="num muted">${idx + 1}</td>
          <td>${esc(l.name || '—')}</td>
          <td class="mono">${esc(l.article || l.sku || '—')}</td>
          <td class="mono">${esc(l.code || '—')}</td>
          <td class="num mono">${esc(String(l.qty || 0))}</td>
          <td class="num mono">${formatMoney(l.price)}</td>
          <td class="num mono">${formatMoney(lineSum)}</td>
          <td class="iso-apps">${appsBtn}</td>
          <td>${marksHtml}<div class="muted" style="font-size:11px;margin-top:2px">${
            serials.length
          } шт.</div></td>
        </tr>${editor}`;
      })
      .join('');
    soLines.innerHTML = `
      <div class="iso-lines-meta muted">${meta}</div>
      <div class="table-scroll iso-lines-scroll">
        <table class="in-free-table iso-lines-table">
          <thead>
            <tr>
              <th class="num">№</th>
              <th>Товар</th>
              <th>Артикул</th>
              <th>Код</th>
              <th class="num">Кол-во</th>
              <th class="num">Цена закупки</th>
              <th class="num">Сумма</th>
              <th>Применимость</th>
              <th>Марки</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>`;
    soLines.querySelectorAll('.iso-marks-more').forEach((btn) => {
      btn.onclick = () => {
        const i = Number(btn.getAttribute('data-idx'));
        const l = orderLines[i];
        if (!l) return;
        const box = btn.closest('.iso-marks');
        if (!box) return;
        box.innerHTML = l.serials.map((s) => esc(s)).join('<br>');
      };
    });
    soLines.querySelectorAll('.iso-apps-toggle').forEach((btn) => {
      btn.onclick = () => {
        const i = Number(btn.getAttribute('data-idx'));
        orderAppsOpenIdx = orderAppsOpenIdx === i ? -1 : i;
        renderOrderLinesTable(party);
      };
    });
    soLines.querySelectorAll('.iso-apps-close').forEach((btn) => {
      btn.onclick = () => {
        orderAppsOpenIdx = -1;
        renderOrderLinesTable(party);
      };
    });
    soLines.querySelectorAll('.iso-apps-apply').forEach((btn) => {
      btn.onclick = () => {
        const i = Number(btn.getAttribute('data-idx'));
        const l = orderLines[i];
        if (!l) return;
        const inp = soLines.querySelector(`.iso-apps-line-inp[data-idx="${i}"]`);
        const text = String(inp?.value || '').trim();
        l.apps_text = text;
        l.apps_override = !!text;
        if (text) {
          l.apps_label = appsLabelFromText(text);
          l.apps_short = appsLabelFromText(text);
        } else {
          l.apps_label = appsTextFromList(l.catalog_apps) || '';
          l.apps_short = l.apps_label;
          l.apps_override = false;
        }
        // подтянуть serial inputs
        soLines.querySelectorAll(`.iso-apps-serial-inp[data-idx="${i}"]`).forEach((el) => {
          const ser = el.getAttribute('data-serial') || '';
          if (!l.serial_apps) l.serial_apps = {};
          const v = String(el.value || '').trim();
          if (v) l.serial_apps[ser] = v;
          else delete l.serial_apps[ser];
        });
        renderOrderLinesTable(party);
      };
    });
    soLines.querySelectorAll('.iso-apps-fill-all').forEach((btn) => {
      btn.onclick = () => {
        const i = Number(btn.getAttribute('data-idx'));
        const l = orderLines[i];
        if (!l) return;
        const inp = soLines.querySelector(`.iso-apps-line-inp[data-idx="${i}"]`);
        const text = String(inp?.value || '').trim();
        l.apps_text = text;
        l.apps_override = !!text;
        if (!l.serial_apps) l.serial_apps = {};
        (l.serials || []).forEach((s) => {
          if (text) l.serial_apps[s] = text;
          else delete l.serial_apps[s];
        });
        renderOrderLinesTable(party);
      };
    });
    soLines.querySelectorAll('.iso-apps-reset').forEach((btn) => {
      btn.onclick = () => {
        const i = Number(btn.getAttribute('data-idx'));
        const l = orderLines[i];
        if (!l) return;
        l.apps_text = '';
        l.apps_override = false;
        l.serial_apps = {};
        l.apps_label = appsTextFromList(l.catalog_apps) || '';
        l.apps_short = l.apps_label;
        renderOrderLinesTable(party);
      };
    });
  };

  const pickSupplierOrder = async (id, number, partyName) => {
    soId.value = id;
    soQ.value = number || id;
    soLabel.textContent = (number || id) + (partyName ? ' · ' + partyName : '');
    soSuggest.classList.add('hidden');
    soLines.innerHTML = '<div class="muted">Загрузка позиций заказа…</div>';
    try {
      const d = await api('/parity/journals/supplier_orders/' + encodeURIComponent(id));
      orderAppsOpenIdx = -1;
      orderLines = (d.lines || [])
        .map((l) => {
          const catalog = Array.isArray(l.apps) ? l.apps : [];
          return {
            product_id: String(l.product_id || ''),
            name: String(l.name || ''),
            article: String(l.article || l.sku || ''),
            sku: String(l.sku || l.article || ''),
            code: String(l.code || ''),
            qty: Number(l.qty) || 0,
            price: Number(l.price) || 0,
            amount: Number(l.amount) || 0,
            category: String(l.category || ''),
            catalog_apps: catalog,
            apps_label: String(l.apps_label || ''),
            apps_short: String(l.apps_short || ''),
            apps_source: String(l.apps_source || ''),
            apps_text: '',
            apps_override: false,
            serial_apps: {},
            apps_open: false,
            serials: Array.isArray(l.serials)
              ? l.serials.map((s) => String(s || '').trim()).filter(Boolean)
              : [],
          };
        })
        .filter((l) => l.product_id && l.qty > 0);
      cpQ.value = String(d.counterparty_name || partyName || '');
      cpId.value = String(d.counterparty_id || '');
      if (!cpId.value) cpId.value = await resolveSupplierId(cpQ.value, '');
      cpLabel.textContent = cpQ.value ? 'Поставщик: ' + cpQ.value : '';
      const num = String(d.number || number || id);
      const date = String(d.doc_date || '').slice(0, 10);
      const party = cpQ.value || partyName || '';
      setBasisDoc(
        [num ? '№ ' + num : '', date, party].filter(Boolean).join(' · ')
      );
      renderOrderLinesTable(party);
    } catch (e) {
      orderLines = [];
      soLines.innerHTML = `<span class="error">${esc(e.message || String(e))}</span>`;
    }
    syncBasis();
  };

  const soStatusRu = (status) => {
    const map = {
      draft: 'Черновик',
      posted: 'Проведён',
      sent: 'Отправлен',
      paid: 'Оплачен',
      cancelled: 'Отменён',
      canceled: 'Отменён',
      in_progress: 'В работе',
      done: 'Выполнен',
      closed: 'Закрыт',
      received: 'Получен',
      partial: 'Частично',
      new: 'Новое',
      open: 'Открыто',
    };
    const raw = String(status || '').trim();
    return map[raw.toLowerCase()] || raw || '—';
  };

  const renderSoSuggest = async (opts = {}) => {
    const clearPick = opts.clearPick !== false;
    const q = soQ.value.trim();
    if (clearPick) {
      soId.value = '';
      orderLines = [];
      soLabel.textContent = '';
      soLines.innerHTML = '';
      setBasisDoc('выберите заказ — передадим требование на склад');
    }
    soSuggest.innerHTML = '<div class="suggest-empty muted">Загрузка…</div>';
    soSuggest.classList.remove('hidden');
    soSuggest.classList.add('so-suggest');
    try {
      const data = await api(
        '/parity/journals/supplier_orders?limit=20&q=' + encodeURIComponent(q)
      );
      const items = data.items || [];
      const head =
        (q.length < 1
          ? '<div class="suggest-empty muted">Последние заказы</div>'
          : '') +
        `<div class="so-suggest-head" aria-hidden="true">
          <span>Дата</span><span>Код</span><span>Поставщик</span><span>Статус</span>
        </div>`;
      soSuggest.innerHTML = items.length
        ? head +
          items
            .map((o) => {
              const date = String(o.doc_date || '').slice(0, 10) || '—';
              const code = o.number || String(o.id || '').slice(0, 8);
              const party = o.counterparty_name || '—';
              const st = soStatusRu(o.status);
              const stClass = String(o.status || '')
                .toLowerCase()
                .replace(/[^a-z0-9_-]/g, '');
              return `<button type="button" class="suggest-item so-suggest-row" data-id="${esc(
                o.id
              )}" data-number="${esc(o.number || '')}" data-party="${esc(o.counterparty_name || '')}">
                <span class="so-col-date muted">${esc(date)}</span>
                <span class="so-col-code mono">${esc(code)}</span>
                <span class="so-col-party" title="${esc(party)}">${esc(party)}</span>
                <span class="so-col-status badge ${
                  stClass === 'draft' || stClass === 'cancelled' || stClass === 'canceled'
                    ? 'draft'
                    : ''
                }">${esc(st)}</span>
              </button>`;
            })
            .join('')
        : '<div class="suggest-empty muted">Нет заказов</div>';
      soSuggest.querySelectorAll('.suggest-item').forEach((btn) => {
        btn.onclick = () =>
          pickSupplierOrder(btn.dataset.id, btn.dataset.number, btn.dataset.party);
      });
    } catch (e) {
      soSuggest.innerHTML = `<div class="suggest-empty error">${esc(e.message || String(e))}</div>`;
    }
  };
  const runSoSuggest = debounce(() => renderSoSuggest({ clearPick: true }), 250);
  soQ.oninput = runSoSuggest;
  soQ.onfocus = () => {
    if (soId.value) return;
    renderSoSuggest({ clearPick: false });
  };
  const renderOutReturnTable = () => {
    if (!outLinesEl) return;
    if (!outLines.length) {
      outLinesEl.innerHTML =
        '<div class="muted">В расходной нет товарных позиций — укажите товар вручную ниже.</div>';
      return;
    }
    const selected = outLines.filter((l) => l.selected);
    const sum = selected.reduce(
      (n, l) => n + (Number(l.price) || 0) * (l.serials.length || Number(l.qty) || 0),
      0
    );
    const marks = selected.reduce((n, l) => n + (l.serials.length || Number(l.qty) || 0), 0);
    outLinesEl.innerHTML = `
      <div class="iso-lines-meta muted">
        Возврат · выбрано <b>${selected.length}</b> поз. · <b>${marks}</b> шт.
        ${sum > 0 ? ' · компенсация ≈ <b>' + esc(formatMoney(sum)) + '</b>' : ''}
        · <button type="button" class="linkish" id="iout-sel-all">все</button>
        · <button type="button" class="linkish" id="iout-sel-none">снять</button>
      </div>
      <div class="table-scroll iso-lines-scroll">
        <table class="in-free-table iso-lines-table">
          <thead>
            <tr>
              <th></th>
              <th>Товар</th>
              <th>Артикул</th>
              <th class="num">Кол-во</th>
              <th class="num">Цена продажи</th>
              <th>Марки</th>
            </tr>
          </thead>
          <tbody>
            ${outLines
              .map((l, idx) => {
                const qty = l.serials.length || Number(l.qty) || 0;
                const marksHtml = l.serials.length
                  ? `<span class="mono" style="font-size:11px">${l.serials
                      .map((s) => esc(s))
                      .join('<br>')}</span>`
                  : '<span class="muted">—</span>';
                return `<tr>
                  <td><input type="checkbox" class="iout-chk" data-idx="${idx}" ${
                    l.selected ? 'checked' : ''
                  } /></td>
                  <td>${esc(l.name || '—')}</td>
                  <td class="mono">${esc(l.sku || '—')}</td>
                  <td class="num mono">${esc(String(qty))}</td>
                  <td class="num mono">${formatMoney(l.price)}</td>
                  <td>${marksHtml}</td>
                </tr>`;
              })
              .join('')}
          </tbody>
        </table>
      </div>
      <p class="muted" style="margin:8px 0 0;font-size:12px">
        Можно вернуть одну марку, несколько или часть расходной. На склад уйдёт требование «Возврат»;
        в Деньгах создастся требование компенсации (ТВД).
      </p>`;
    outLinesEl.querySelectorAll('.iout-chk').forEach((chk) => {
      chk.onchange = () => {
        const i = Number(chk.getAttribute('data-idx'));
        if (Number.isFinite(i) && outLines[i]) {
          outLines[i].selected = !!chk.checked;
          renderOutReturnTable();
        }
      };
    });
    const allBtn = document.getElementById('iout-sel-all');
    const noneBtn = document.getElementById('iout-sel-none');
    if (allBtn) {
      allBtn.onclick = () => {
        outLines.forEach((l) => {
          l.selected = true;
        });
        renderOutReturnTable();
      };
    }
    if (noneBtn) {
      noneBtn.onclick = () => {
        outLines.forEach((l) => {
          l.selected = false;
        });
        renderOutReturnTable();
      };
    }
  };

  const pickOutDoc = async (id, title) => {
    outId.value = id;
    outQ.value = title || id;
    outLabel.textContent = title || id;
    outSuggest.classList.add('hidden');
    outLinesEl.innerHTML = '<div class="muted">Загрузка позиций расходной…</div>';
    try {
      const d = await api('/docs/' + encodeURIComponent(id));
      if (String(d.doc_type || '') !== 'out') {
        throw new Error('Нужна расходная накладная');
      }
      const items = d.lines || [];
      outLines = (Array.isArray(items) ? items : [])
        .map((l) => {
          const serials = Array.isArray(l.serials)
            ? l.serials.map((s) => String(s || '').trim()).filter(Boolean)
            : [];
          return {
            product_id: String(l.product_id || ''),
            qty: Number(l.qty) || serials.length || 1,
            serials,
            name: String(l.product_name || l.name || l.sku || ''),
            sku: String(l.sku || ''),
            price: Number(l.price) || Number(l.amount) / (Number(l.qty) || 1) || 0,
            selected: true,
            item_kind: String(l.item_kind || 'product'),
          };
        })
        .filter((l) => l.product_id && l.item_kind !== 'service');
      cpQ.value = String(d.counterparty || d.counterparty_name || '');
      cpId.value = String(d.counterparty_id || '');
      if (outDealId) outDealId.value = String(d.deal_id || '');
      cpLabel.textContent = cpQ.value ? 'Покупатель: ' + cpQ.value : '';
      const num = String(d.number || '').trim();
      const date = String(d.doc_date || '').slice(0, 10);
      const party = cpQ.value || '';
      setBasisDoc(
        ['Расходная', num ? '№ ' + num : '', date, party].filter(Boolean).join(' · ') ||
          title ||
          id
      );
      outLabel.textContent = [num ? '№ ' + num : '', date, party].filter(Boolean).join(' · ');
      renderOutReturnTable();
      if (!outLines.length) {
        manualWrap.style.display = 'contents';
        serialsWrap.hidden = false;
      }
    } catch (e) {
      outLines = [];
      outLinesEl.innerHTML = `<div class="error">${esc(e.message || String(e))}</div>`;
    }
    syncBasis();
  };

  const tryResolveOutFromScan = async (raw) => {
    const code = String(raw || '').trim();
    if (!code) return false;
    try {
      const tr = await api('/product-units/trace?serial=' + encodeURIComponent(code));
      const unit = tr.unit || {};
      const outDocId = String(unit.out_doc_id || '').trim();
      if (outDocId) {
        await pickOutDoc(outDocId, code);
        return true;
      }
      const ev = (tr.events || []).find(
        (e) =>
          e.doc_id &&
          (e.kind === 'out' ||
            e.doc_type === 'out' ||
            String(e.title || '').toLowerCase().includes('расход'))
      );
      if (ev?.doc_id) {
        await pickOutDoc(ev.doc_id, code);
        return true;
      }
    } catch (_) {}
    try {
      const scan = await api('/supply/scan/' + encodeURIComponent(code));
      const unit = scan.product_unit || {};
      if (unit.out_doc_id) {
        await pickOutDoc(unit.out_doc_id, code);
        return true;
      }
    } catch (_) {}
    return false;
  };

  const outSuggestLabel = (d) => {
    const num = String(d.number || '').trim();
    const date = String(d.doc_date || '').slice(0, 10);
    const party = String(d.counterparty || '').trim();
    return [num ? '№ ' + num : '', date, party].filter(Boolean).join(' · ') || d.id;
  };

  const renderOutSuggest = async (opts = {}) => {
    const clearPick = opts.clearPick !== false;
    const q = outQ.value.trim();
    if (clearPick) {
      outId.value = '';
      if (outDealId) outDealId.value = '';
      outLines = [];
      outLabel.textContent = '';
      outLinesEl.innerHTML = '';
      setBasisDoc('выберите расходную — отметьте товары к возврату');
    }
    outSuggest.innerHTML = '<div class="suggest-empty muted">Загрузка…</div>';
    outSuggest.classList.remove('hidden');
    try {
      const looksPhone = /^\+?[\d\s\-()]{6,}$/.test(q);
      const looksMark = q.length >= 8 && !looksPhone && !/\s/.test(q) && /\d/.test(q);
      if (looksMark && (await tryResolveOutFromScan(q))) {
        outSuggest.classList.add('hidden');
        return;
      }
      const data = await api(
        '/docs?type=out&limit=20&sort=date&dir=desc&q=' + encodeURIComponent(q)
      );
      const items = data.items || [];
      const head =
        q.length < 1 ? '<div class="suggest-empty muted">Последние расходные</div>' : '';
      outSuggest.innerHTML = items.length
        ? head +
          items
            .map((d) => {
              const num = String(d.number || '');
              const date = String(d.doc_date || '').slice(0, 10);
              const party = String(d.counterparty || '').trim();
              const amount = Number(d.amount) || 0;
              return `<button type="button" class="suggest-item" data-id="${esc(d.id)}" data-label="${esc(
                outSuggestLabel(d)
              )}">
                <span class="mono">${esc(num)}</span>
                <span class="muted">${esc(date)}</span>
                ${esc(party || '—')}
                ${amount > 0 ? `<span class="muted">${esc(formatMoney(amount))}</span>` : ''}
              </button>`;
            })
            .join('')
        : '<div class="suggest-empty muted">Нет расходных — попробуйте номер, покупателя или скан марки</div>';
      outSuggest.querySelectorAll('.suggest-item').forEach((btn) => {
        btn.onclick = () => pickOutDoc(btn.dataset.id, btn.dataset.label);
      });
    } catch (e) {
      outSuggest.innerHTML = `<div class="suggest-empty error">${esc(e.message || String(e))}</div>`;
    }
  };
  const runOutSuggest = debounce(() => renderOutSuggest({ clearPick: true }), 250);
  outQ.oninput = runOutSuggest;
  outQ.onfocus = () => {
    if (outId.value) return;
    renderOutSuggest({ clearPick: false });
  };
  outQ.onkeydown = async (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const q = outQ.value.trim();
      if (q && !/^\+?[\d\s\-()]{6,}$/.test(q) && (await tryResolveOutFromScan(q))) return;
      renderOutSuggest({ clearPick: true });
    }
  };

  const runCpSuggest = debounce(async () => {
    if (cpQ.readOnly || cpWrap.hidden) return;
    const q = cpQ.value.trim();
    cpId.value = '';
    cpLabel.textContent = '';
    if (q.length < 2) {
      cpSuggest.classList.add('hidden');
      return;
    }
    const kind =
      basisEl.value === 'return' ? 'buyer' : basisEl.value === 'none' ? '' : 'supplier';
    const data = await api(
      '/counterparties?' +
        (kind ? 'kind=' + kind + '&' : '') +
        'limit=20&q=' +
        encodeURIComponent(q)
    );
    const items = data.items || data || [];
    const list = Array.isArray(items) ? items : [];
    cpSuggest.innerHTML = list.length
      ? list
          .map(
            (c) =>
              `<button type="button" class="suggest-item" data-id="${esc(c.id)}" data-label="${esc(c.name || '')}">
                ${esc(c.name || '')}${c.inn ? ` · ИНН <span class="mono">${esc(c.inn)}</span>` : ''}
              </button>`
          )
          .join('')
      : `<div class="suggest-empty muted">Нет совпадений${
          basisEl.value === 'none'
            ? ' — <button type="button" class="linkish icp-create-hint">создать контрагента</button>'
            : ''
        }</div>`;
    cpSuggest.classList.remove('hidden');
    cpSuggest.querySelectorAll('.suggest-item').forEach((btn) => {
      btn.onclick = () => {
        cpId.value = btn.dataset.id;
        cpQ.value = btn.dataset.label;
        cpLabel.textContent = cpRole.textContent + ': ' + btn.dataset.label;
        cpSuggest.classList.add('hidden');
      };
    });
    cpSuggest.querySelector('.icp-create-hint')?.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      cpSuggest.classList.add('hidden');
      openInboundCpCreate();
    });
  }, 250);
  cpQ.oninput = runCpSuggest;

  const runSuggest = debounce(async () => {
    const q = qInput.value.trim();
    idInput.value = '';
    label.textContent = '';
    if (q.length < 2) {
      suggest.classList.add('hidden');
      return;
    }
    const data = await api('/products?limit=20&q=' + encodeURIComponent(q));
    const items = data.items || [];
    suggest.innerHTML = items.length
      ? items
          .map(
            (p) =>
              `<button type="button" class="suggest-item" data-id="${esc(p.id)}" data-label="${esc(
                p.sku + ' — ' + productTitle(p)
              )}">
                <span class="mono">${esc(p.sku)}</span> ${esc(productTitle(p))}
              </button>`
          )
          .join('')
      : '<div class="suggest-empty muted">Нет совпадений</div>';
    suggest.classList.remove('hidden');
    suggest.querySelectorAll('.suggest-item').forEach((btn) => {
      btn.onclick = () => {
        idInput.value = btn.dataset.id;
        qInput.value = btn.dataset.label;
        label.textContent = 'Выбрано: ' + btn.dataset.label;
        suggest.classList.add('hidden');
      };
    });
  }, 250);
  qInput.oninput = runSuggest;

  if (cpCreateBtn) cpCreateBtn.onclick = openInboundCpCreate;

  view.onclick = (e) => {
    if (!suggest.contains(e.target) && e.target !== qInput) suggest.classList.add('hidden');
    if (!cpSuggest.contains(e.target) && e.target !== cpQ) cpSuggest.classList.add('hidden');
    if (!soSuggest.contains(e.target) && e.target !== soQ) soSuggest.classList.add('hidden');
    if (outSuggest && !outSuggest.contains(e.target) && e.target !== outQ) {
      outSuggest.classList.add('hidden');
    }
  };

  postBtn.onclick = async () => {
    const msg = document.getElementById('imsg');
    const basis = basisEl.value;
    const wh = document.getElementById('iwh').value;
    const comment = (document.getElementById('icomment').value || '').trim();
    if (basis !== 'supplier_order' && basis !== 'return' && basis !== 'none') {
      msg.textContent = 'Сначала выберите основание прихода';
      return;
    }
    if (!wh) {
      msg.textContent = 'Укажите склад прихода';
      return;
    }

    try {
      if (basis === 'none') {
        if (!cpId.value) {
          msg.textContent = 'Укажите или создайте контрагента';
          cpQ.focus();
          return;
        }
        if (!freeLines.length) {
          msg.textContent = 'Добавьте хотя бы одну номенклатуру с ценой закупки';
          return;
        }
        if (freeLines.some((l) => !(Number(l.price) > 0))) {
          msg.textContent = 'У всех позиций должна быть цена закупки больше 0';
          return;
        }
        const doc = await api('/docs', {
          method: 'POST',
          body: JSON.stringify({
            doc_type: 'in',
            warehouse_id: wh,
            counterparty_id: cpId.value,
            comment: comment || 'основание:без основания',
            serials_optional: true,
            lines: freeLines.map((l) => ({
              product_id: l.product_id,
              qty: l.qty,
              price: l.price,
              serials: [],
              warehouse_id: wh,
            })),
            post: true,
          }),
        });
        msg.textContent = 'Проведено: ' + doc.number;
        if (doc.id) setTimeout(() => openTab('doc:' + doc.id), 400);
        return;
      }

      if (basis === 'supplier_order') {
        if (!soId.value || !orderLines.length) {
          msg.textContent = 'Выберите заказ поставщику со строками';
          return;
        }
        if (!cpId.value) {
          msg.textContent = 'Не определён поставщик заказа';
          return;
        }
        // подхватить незакрытый редактор применимости
        if (orderAppsOpenIdx >= 0 && soLines) {
          const i = orderAppsOpenIdx;
          const l = orderLines[i];
          if (l) {
            const lineInp = soLines.querySelector(`.iso-apps-line-inp[data-idx="${i}"]`);
            if (lineInp) {
              const text = String(lineInp.value || '').trim();
              l.apps_text = text;
              l.apps_override = !!text;
            }
            if (!l.serial_apps) l.serial_apps = {};
            soLines.querySelectorAll(`.iso-apps-serial-inp[data-idx="${i}"]`).forEach((el) => {
              const ser = el.getAttribute('data-serial') || '';
              const v = String(el.value || '').trim();
              if (v) l.serial_apps[ser] = v;
              else delete l.serial_apps[ser];
            });
          }
        }
        const res = await api('/supply/inbound-request', {
          method: 'POST',
          body: JSON.stringify({
            supplier_order_id: soId.value,
            supplier_order_number: soQ.value || soLabel.textContent || '',
            supplier_name: cpQ.value || '',
            warehouse_id: wh,
            comment:
              comment ||
              'Оприходование по заказу ' + (soQ.value || soId.value) + (cpQ.value ? ' · ' + cpQ.value : ''),
            lines: orderLines.map((l) => {
              const serialApps = {};
              if (l.serial_apps && typeof l.serial_apps === 'object') {
                for (const [ser, raw] of Object.entries(l.serial_apps)) {
                  const t = String(raw || '').trim();
                  if (t) serialApps[ser] = t;
                }
              }
              const lineAppsText = String(l.apps_text || '').trim();
              return {
                product_id: l.product_id,
                qty: l.serials.length || l.qty,
                sku: l.sku || l.article || '',
                name: l.name || '',
                price: l.price || 0,
                serials: l.serials,
                ...(l.apps_override && lineAppsText ? { apps: lineAppsText } : {}),
                ...(Object.keys(serialApps).length ? { serial_apps: serialApps } : {}),
              };
            }),
          }),
        });
        const task = res.warehouse_task || {};
        msg.textContent =
          res.message ||
          'Требование на склад: ' + (task.number || 'создано') + ' — сканируйте марки';
        const scanUrl =
          '/in/scan?v=dm12' +
          (task.id
            ? '&task=' + encodeURIComponent(task.id)
            : soId.value
              ? '&order=' + encodeURIComponent(soId.value)
              : '');
        setTimeout(() => {
          window.open(scanUrl, '_blank', 'noopener');
        }, 300);
        return;
      }

      if (basis === 'return') {
        if (!outId.value) {
          msg.textContent = 'Выберите расходную накладную (поиск или скан марки)';
          return;
        }
        let lines = outLines
          .filter((l) => l.selected)
          .map((l) => ({
            product_id: l.product_id,
            qty: l.serials.length || l.qty,
            sku: l.sku || '',
            name: l.name || '',
            price: l.price || 0,
            serials: l.serials,
          }));
        if (!lines.length) {
          if (!idInput.value) {
            msg.textContent = 'Отметьте товары к возврату или укажите номенклатуру вручную';
            return;
          }
          const serials = String(serialsEl.value || '')
            .split(/[\n,;]+/)
            .map((s) => s.trim())
            .filter(Boolean);
          lines = [
            {
              product_id: idInput.value,
              qty: serials.length || Number(qtyEl.value) || 1,
              sku: '',
              name: label.textContent || '',
              price: 0,
              serials,
            },
          ];
        }
        const res = await api('/supply/return-request', {
          method: 'POST',
          body: JSON.stringify({
            out_doc_id: outId.value,
            out_doc_number: (outQ.value || '').replace(/^№\s*/, '').split('·')[0].trim(),
            deal_id: outDealId?.value || '',
            buyer_name: cpQ.value || '',
            warehouse_id: wh,
            comment:
              comment ||
              'Возврат от клиента · расходная ' + (outLabel.textContent || outQ.value || outId.value),
            lines,
          }),
        });
        const task = res.warehouse_task || {};
        const money = res.money_refund || {};
        msg.textContent =
          res.message ||
          'Возврат · задание ' +
            (task.number || '') +
            (money.number ? ' · ТВД ' + money.number : '');
        if (task.id) {
          setTimeout(() => {
            window.open(
              '/in/scan?v=dm12&task=' + encodeURIComponent(task.id),
              '_blank',
              'noopener'
            );
          }, 300);
        }
        return;
      }
    } catch (e) {
      msg.textContent = e.message || String(e);
    }
  };
}

async function renderOutCreate() {
  await refreshRefs();
  view.innerHTML = formChrome(
    'Новый расход',
    `
    <div class="out-create-steps">
      <section class="out-step" id="out-step-deal">
        <div class="out-step-head">
          <span class="out-step-num">1</span>
          <div>
            <h3 class="out-step-title">Заказ покупателя</h3>
            <p class="muted" style="margin:0">Укажите номер заказа или найдите по ФИО / телефону</p>
          </div>
        </div>
        <div class="form-grid" style="margin-top:12px">
          <label class="span-2">
            Номер заказа
            <div class="find out-deal-find">
              <input id="odeal-q" class="mono" placeholder="номер заказа, ФИО, телефон…" autocomplete="off" />
              <button type="button" class="find-go" id="odeal-search">Найти</button>
            </div>
            <input type="hidden" id="odeal-id" />
            <div id="odeal-suggest" class="suggest hidden"></div>
          </label>
        </div>
        <div class="out-deal-picked muted" id="odeal-picked" hidden></div>
      </section>

      <section class="out-step" id="out-step-lines" hidden>
        <div class="out-step-head">
          <span class="out-step-num">2</span>
          <div class="grow">
            <h3 class="out-step-title">Товары</h3>
            <p class="muted" style="margin:0" id="out-basis-doc">Номенклатура по применимости из заказа</p>
          </div>
          <button type="button" class="btn-tool" id="odeal-change">Другой заказ</button>
        </div>
        <div class="form-grid" style="margin-top:10px">
          <label class="span-2">Комментарий<input id="ocomment-deal" placeholder="необязательно" /></label>
        </div>
        <div id="odeal-lines" class="iso-lines" style="margin-top:10px"></div>
        <div class="form-actions is-float" style="margin-top:12px">
          <button class="primary" type="button" id="opost-deal">Создать расходную</button>
          <span class="muted" id="omsg-deal"></span>
        </div>
      </section>
    </div>`,
    { parentTab: 'docs', parentLabel: 'Расходные' }
  );
  bindFormChrome(() => {
    state.docsType = 'out';
    openTab('docs');
  });

  const stepDeal = document.getElementById('out-step-deal');
  const stepLines = document.getElementById('out-step-lines');
  const basisDoc = document.getElementById('out-basis-doc');
  const dealPicked = document.getElementById('odeal-picked');
  const dealQ = document.getElementById('odeal-q');
  const dealId = document.getElementById('odeal-id');
  const dealSuggest = document.getElementById('odeal-suggest');
  const dealLinesEl = document.getElementById('odeal-lines');
  /** @type {{ product_id: string, qty: number, serials: string[], name: string, sku: string, price: number, warehouse_id: string, warehouse_name: string, appLabel: string, mark: string, model: string, generation: string, selected: boolean }[]} */
  let dealLines = [];

  const setBasisDoc = (t) => {
    if (basisDoc) basisDoc.textContent = t || '';
  };

  const syncCreateBtn = () => {
    const btn = document.getElementById('opost-deal');
    if (!btn) return;
    const selected = dealLines.filter((l) => l.selected);
    const allMarked =
      selected.length > 0 && selected.every((l) => (l.serials || []).length > 0);
    btn.textContent = allMarked ? 'Провести расходную' : 'Создать расходную';
  };

  const showStep = (which) => {
    const lines = which === 'lines';
    if (stepDeal) stepDeal.hidden = lines;
    if (stepLines) stepLines.hidden = !lines;
    if (!lines) {
      dealId.value = '';
      dealLines = [];
      if (dealLinesEl) dealLinesEl.innerHTML = '';
      if (dealPicked) {
        dealPicked.hidden = true;
        dealPicked.textContent = '';
      }
      setBasisDoc('Отметьте товары к расходной');
      const msg = document.getElementById('omsg-deal');
      if (msg) msg.textContent = '';
      syncCreateBtn();
      setTimeout(() => dealQ?.focus(), 30);
    }
  };

  const renderDealOutTable = () => {
    if (!dealLinesEl) return;
    if (!dealLines.length) {
      dealLinesEl.innerHTML =
        '<div class="muted">В заказе нет товарных позиций. Добавьте номенклатуру (по применимости).</div>';
      syncCreateBtn();
      return;
    }
    const selected = dealLines.filter((l) => l.selected);
    const withMarks = selected.filter((l) => (l.serials || []).length > 0).length;
    const sum = selected.reduce(
      (n, l) => n + (Number(l.price) || 0) * (Number(l.qty) || (l.serials || []).length || 0),
      0
    );
    dealLinesEl.innerHTML = `
      <div class="iso-lines-meta muted">
        В расходную · <b>${selected.length}</b> поз.
        ${withMarks ? ' · с марками <b>' + withMarks + '</b>' : ''}
        ${sum > 0 ? ' · ≈ <b>' + esc(formatMoney(sum)) + '</b>' : ''}
        · <button type="button" class="linkish" id="odeal-sel-all">все</button>
        · <button type="button" class="linkish" id="odeal-sel-none">снять</button>
      </div>
      <div class="table-scroll iso-lines-scroll">
        <table class="in-free-table iso-lines-table">
          <thead>
            <tr>
              <th></th>
              <th>Товар</th>
              <th>Артикул</th>
              <th>Применимость</th>
              <th class="num">Кол-во</th>
              <th class="num">Цена</th>
              <th>Склад</th>
              <th>Марки (экз.)</th>
            </tr>
          </thead>
          <tbody>
            ${dealLines
              .map((l, idx) => {
                const qty = Number(l.qty) || (l.serials || []).length || 0;
                const marksHtml = (l.serials || []).length
                  ? `<span class="mono" style="font-size:11px">${l.serials
                      .map((s) => esc(s))
                      .join('<br>')}</span>`
                  : '<span class="muted">на складе</span>';
                return `<tr>
                  <td><input type="checkbox" class="odeal-chk" data-idx="${idx}" ${
                    l.selected ? 'checked' : ''
                  } /></td>
                  <td>${esc(l.name || '—')}</td>
                  <td class="mono">${esc(l.sku || '—')}</td>
                  <td>${esc(l.appLabel || '—')}</td>
                  <td class="num mono">${esc(String(qty))}</td>
                  <td class="num mono">${formatMoney(l.price)}</td>
                  <td>${esc(l.warehouse_name || '—')}</td>
                  <td>${marksHtml}</td>
                </tr>`;
              })
              .join('')}
          </tbody>
        </table>
      </div>
      <p class="muted" style="margin:8px 0 0;font-size:12px">
        В заказе — номенклатура по применимости. Конкретные экземпляры (марки) склад привяжет при сборке / скане.
        Без марок создаётся черновик расходной; если марки уже есть — можно провести сразу.
      </p>`;
    dealLinesEl.querySelectorAll('.odeal-chk').forEach((chk) => {
      chk.onchange = () => {
        const i = Number(chk.getAttribute('data-idx'));
        if (Number.isFinite(i) && dealLines[i]) {
          dealLines[i].selected = !!chk.checked;
          renderDealOutTable();
        }
      };
    });
    document.getElementById('odeal-sel-all')?.addEventListener('click', () => {
      dealLines.forEach((l) => {
        l.selected = true;
      });
      renderDealOutTable();
    });
    document.getElementById('odeal-sel-none')?.addEventListener('click', () => {
      dealLines.forEach((l) => {
        l.selected = false;
      });
      renderDealOutTable();
    });
    syncCreateBtn();
  };

  const dealSuggestLabel = (d) => {
    const num = String(d.number || d.id || '').trim();
    const fio = String(d.buyer_name || d.contact_name || '').trim();
    const company = String(d.company_name || '').trim();
    const name = String(d.name || '').trim();
    return [num ? '№ ' + num : '', fio || company || name].filter(Boolean).join(' · ') || num || d.id;
  };

  const pickDealForOut = async (id, title) => {
    dealId.value = id;
    dealSuggest.classList.add('hidden');
    showStep('lines');
    if (dealPicked) {
      dealPicked.hidden = false;
      dealPicked.textContent = 'Заказ: ' + (title || id);
    }
    dealLinesEl.innerHTML = '<div class="muted">Загрузка товаров заказа…</div>';
    try {
      const d = await api('/crm/deals/' + encodeURIComponent(id));
      const items = d.items || d.lines || [];
      dealLines = (Array.isArray(items) ? items : [])
        .map((l) => {
          const serials = Array.isArray(l.serials)
            ? l.serials.map((s) => String(s || '').trim()).filter(Boolean)
            : [];
          const mark = String(l.mark || '').trim();
          const model = String(l.model || '').trim();
          const generation = String(l.generation || '').trim();
          const appLabel = [mark, model, generation].filter(Boolean).join(' · ');
          return {
            product_id: String(l.product_id || l.product_guid || ''),
            qty: Number(l.qty) || serials.length || 1,
            serials,
            name: String(
              l.display_name || l.name_display || l.product_name || l.name || l.sku || ''
            ),
            sku: String(l.sku || l.article || ''),
            price: Number(l.price) || 0,
            warehouse_id: String(l.warehouse_id || ''),
            warehouse_name: String(l.warehouse_name || ''),
            mark,
            model,
            generation,
            appLabel,
            selected: true,
            item_kind: String(l.item_kind || 'product'),
          };
        })
        .filter((l) => l.product_id && l.item_kind !== 'service');
      const num = String(d.number || d.id || '').trim();
      const party = String(d.buyer_name || d.contact_name || d.company_name || d.name || '').trim();
      const label = [num ? '№ ' + num : '', party].filter(Boolean).join(' · ') || title || id;
      dealQ.value = num || id;
      if (dealPicked) dealPicked.textContent = 'Заказ: ' + label;
      setBasisDoc(label + ' — номенклатура по применимости');
      renderDealOutTable();
    } catch (e) {
      dealLines = [];
      dealLinesEl.innerHTML = `<div class="error">${esc(e.message || String(e))}</div>`;
    }
  };

  const renderDealSuggest = async (opts = {}) => {
    const q = dealQ.value.trim();
    const autoPickExact = !!opts.autoPickExact;
    dealSuggest.innerHTML = '<div class="suggest-empty muted">Поиск…</div>';
    dealSuggest.classList.remove('hidden');
    try {
      // Точное совпадение по id сделки — сразу берём
      if (autoPickExact && q) {
        try {
          const exact = await api('/crm/deals/' + encodeURIComponent(q));
          if (exact && exact.id) {
            await pickDealForOut(String(exact.id), dealSuggestLabel(exact));
            return;
          }
        } catch (_) {
          /* не точный id — обычный поиск */
        }
      }
      const data = await api(
        '/crm/deals?limit=25&sort=updated_at&dir=desc&q=' + encodeURIComponent(q)
      );
      const items = data.items || [];
      if (autoPickExact && items.length === 1) {
        await pickDealForOut(String(items[0].id), dealSuggestLabel(items[0]));
        return;
      }
      if (autoPickExact && q) {
        const exactId = items.find((d) => String(d.id) === q || String(d.number || '') === q);
        if (exactId) {
          await pickDealForOut(String(exactId.id), dealSuggestLabel(exactId));
          return;
        }
      }
      const head =
        q.length < 1
          ? '<div class="suggest-empty muted">Последние заказы — выберите или введите номер</div>'
          : '';
      dealSuggest.innerHTML = items.length
        ? head +
          items
            .map((d) => {
              const num = String(d.number || d.id || '');
              const fio = String(d.buyer_name || d.contact_name || '').trim();
              const phone = String(d.buyer_phone || '').trim();
              const company = String(d.company_name || '').trim();
              const meta = [fio, phone, company].filter(Boolean).join(' · ');
              return `<button type="button" class="suggest-item" data-id="${esc(d.id)}" data-label="${esc(
                dealSuggestLabel(d)
              )}">
                <span class="mono">${esc(num)}</span>
                ${esc(meta || d.name || '—')}
                <span class="muted">${esc(d.status_name || '')}</span>
              </button>`;
            })
            .join('')
        : '<div class="suggest-empty muted">Сделок не найдено</div>';
      dealSuggest.querySelectorAll('.suggest-item').forEach((btn) => {
        btn.onclick = () => pickDealForOut(btn.dataset.id, btn.dataset.label);
      });
    } catch (e) {
      dealSuggest.innerHTML = `<div class="suggest-empty error">${esc(e.message || String(e))}</div>`;
    }
  };
  const runDealSuggest = debounce(() => renderDealSuggest({ autoPickExact: false }), 250);
  dealQ.oninput = () => {
    dealId.value = '';
    runDealSuggest();
  };
  dealQ.onfocus = () => {
    if (stepLines && !stepLines.hidden) return;
    renderDealSuggest({ autoPickExact: false });
  };
  const runSearch = () => renderDealSuggest({ autoPickExact: true });
  document.getElementById('odeal-search').onclick = runSearch;
  dealQ.onkeydown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      runSearch();
    }
  };
  document.getElementById('odeal-change').onclick = () => {
    showStep('deal');
    dealQ.value = '';
    renderDealSuggest({ autoPickExact: false });
  };

  const resolveWhForSerial = async (serial, fallback) => {
    if (fallback) return fallback;
    try {
      const tr = await api('/product-units/trace?serial=' + encodeURIComponent(serial));
      const wh = String(tr.unit?.warehouse_id || '').trim();
      if (wh) return wh;
    } catch (_) {}
    return '';
  };

  document.getElementById('opost-deal').onclick = async () => {
    const msg = document.getElementById('omsg-deal');
    if (!dealId.value) {
      if (msg) msg.textContent = 'Сначала укажите заказ покупателя';
      showStep('deal');
      return;
    }
    const selected = dealLines.filter((l) => l.selected && l.product_id);
    if (!selected.length) {
      if (msg) msg.textContent = 'Отметьте товары для расходной';
      return;
    }
    const defaultWh =
      String(selected.find((l) => l.warehouse_id)?.warehouse_id || '').trim() ||
      String((state.warehouses || []).find((w) => w.is_default)?.id || '').trim() ||
      String((state.warehouses || [])[0]?.id || '').trim();
    if (msg) msg.textContent = 'Создание…';
    try {
      /** @type {Array<{ product_id: string, warehouse_id: string, qty: number, price: number, serials: string[], apps: Array<{ mark: string, model: string, generation: string }> }>} */
      const lines = [];
      for (const l of selected) {
        const serials = Array.isArray(l.serials) ? l.serials.filter(Boolean) : [];
        let warehouse_id = String(l.warehouse_id || '').trim();
        if (serials.length) {
          // С марками — склад с экземпляра (или строки)
          /** @type {Map<string, string[]>} */
          const byWh = new Map();
          for (const s of serials) {
            const wh = (await resolveWhForSerial(s, warehouse_id)) || defaultWh;
            if (!wh) throw new Error('У марки «' + s + '» не найден склад');
            if (!byWh.has(wh)) byWh.set(wh, []);
            byWh.get(wh).push(s);
          }
          for (const [wh, ser] of byWh) {
            lines.push({
              product_id: l.product_id,
              warehouse_id: wh,
              qty: ser.length,
              price: Number(l.price) || 0,
              serials: ser,
              apps:
                l.mark || l.model
                  ? [{ mark: l.mark || '', model: l.model || '', generation: l.generation || '' }]
                  : [],
            });
          }
        } else {
          // Без марок — номенклатура по применимости (черновик)
          warehouse_id = warehouse_id || defaultWh;
          if (!warehouse_id) throw new Error('Укажите склад в позициях заказа или в справочнике складов');
          const qty = Math.max(1, Number(l.qty) || 1);
          lines.push({
            product_id: l.product_id,
            warehouse_id,
            qty,
            price: Number(l.price) || 0,
            serials: [],
            apps:
              l.mark || l.model
                ? [{ mark: l.mark || '', model: l.model || '', generation: l.generation || '' }]
                : [],
          });
        }
      }
      const allMarked = lines.every((x) => (x.serials || []).length > 0);
      const comment = (document.getElementById('ocomment-deal')?.value || '').trim();
      const dealTitle =
        (dealPicked && dealPicked.textContent.replace(/^(Заказ|Сделка):\s*/i, '')) ||
        dealQ.value ||
        dealId.value;
      const doc = await api('/docs', {
        method: 'POST',
        body: JSON.stringify({
          doc_type: 'out',
          deal_id: dealId.value,
          warehouse_id: defaultWh || lines[0]?.warehouse_id,
          comment: comment || 'основание:заказ ' + dealTitle,
          lines,
          // Без экземпляров — только черновик; марки подставит склад
          post: allMarked,
        }),
      });
      if (msg) {
        msg.textContent = allMarked
          ? 'Проведено: ' + doc.number
          : 'Создан черновик: ' + doc.number + ' (марки — на складе)';
      }
      if (doc.id) setTimeout(() => openTab('doc:' + doc.id), 400);
    } catch (e) {
      if (msg) msg.textContent = e.message || String(e);
    }
  };

  view.addEventListener('click', (e) => {
    const searchBtn = document.getElementById('odeal-search');
    if (
      dealSuggest &&
      !dealSuggest.contains(e.target) &&
      e.target !== dealQ &&
      e.target !== searchBtn
    ) {
      dealSuggest.classList.add('hidden');
    }
  });

  showStep('deal');
}

async function renderSerialTrace(codeRaw) {
  const code = String(codeRaw || '').trim();
  if (!code) {
    view.innerHTML = formChrome('Марка', '<p class="error">Не указан код</p>', {
      section: 'Марка',
    });
    bindFormChrome(() => openTab('balances'));
    return;
  }
  let data;
  try {
    data = await api('/product-units/trace?serial=' + encodeURIComponent(code));
  } catch (e) {
    view.innerHTML = formChrome(
      code.slice(0, 48),
      `<p class="error">${esc(e.message || 'Код не найден')}</p>
       <p class="muted">Проверьте код или найдите экземпляр в разделе «Экземпляры / серийники».</p>`,
      { section: 'Марка · история' }
    );
    bindFormChrome(() => openTab('product-units'));
    return;
  }
  const u = data.unit || null;
  const events = Array.isArray(data.events) ? data.events : [];
  const tab = state.tabs.find((t) => t.id === state.activeTab);
  if (tab) {
    tab.title = String(code).slice(0, 40);
    renderTabs();
  }
  const nowBlock = u
    ? `<div class="panel" style="margin-bottom:12px">
        <div style="font-size:12px;color:var(--muted,#888);margin-bottom:4px">Сейчас</div>
        <div style="display:flex;flex-wrap:wrap;gap:8px 16px;align-items:baseline">
          <span><b>${esc(data.status_label || u.status || '—')}</b></span>
          ${u.warehouse_name ? `<span>склад: <b>${esc(u.warehouse_name)}</b></span>` : ''}
          ${u.sku ? `<span class="mono muted">${esc(u.sku)}</span>` : ''}
          ${
            u.product_name
              ? `<button type="button" class="linkish" id="dm-open-product">${esc(u.product_name)}</button>`
              : ''
          }
        </div>
      </div>`
    : `<div class="panel" style="margin-bottom:12px">
        <div style="font-size:12px;color:var(--muted,#888);margin-bottom:4px">Сейчас</div>
        <div><b>${esc(data.status_label || 'Код найден в документах')}</b></div>
        <p class="muted" style="margin:6px 0 0">Экземпляр на складе ещё не оприходован — ниже вся известная история по марке.</p>
      </div>`;
  const appsMarks = Array.isArray(u?.apps)
    ? u.apps.map((a) => a.mark).filter(Boolean).join(', ')
    : '';
  const appsBlock = u
    ? `<div class="panel" style="margin-bottom:12px">
        <div style="font-size:12px;color:var(--muted,#888);margin-bottom:4px">Применимость партии</div>
        <p style="margin:0 0 8px"><b>${esc(u.apps_label || 'как в каталоге')}</b>
          ${u.apps_short ? ` <span class="muted mono">(${esc(u.apps_short)})</span>` : ''}
        </p>
        <p class="muted" style="margin:0 0 8px;font-size:12px">
          Каталог товара = максимум. Здесь — куда годится именно эта штука. Пусто = без урезания (каталог).
        </p>
        <label style="display:block;max-width:480px">Марки авто (через запятую)
          <input id="dm-apps" value="${esc(appsMarks)}" placeholder="Audi, Porsche" autocomplete="off" />
        </label>
        <div class="toolbar" style="margin-top:8px">
          <button type="button" class="primary" id="dm-apps-save">Сохранить применимость</button>
          <span class="muted" id="dm-apps-msg"></span>
        </div>
      </div>`
    : '';
  const dealBlock =
    data.deal && data.deal.deal_id
      ? `<div class="panel" style="margin-bottom:12px">
          <div style="font-size:12px;color:var(--muted,#888);margin-bottom:4px">Сделка</div>
          <button type="button" class="linkish" id="dm-open-deal" style="font-size:15px;font-weight:600">
            ${esc(data.deal.deal_name || data.deal.deal_id)}
          </button>
          ${data.deal.buyer_name ? `<span class="muted"> · ${esc(data.deal.buyer_name)}</span>` : ''}
        </div>`
      : '';
  const timeline = events.length
    ? `<ol class="dm-trace-timeline">
        ${events
          .map((ev) => {
            const links = [];
            if (ev.doc_id) {
              links.push(
                `<button type="button" class="linkish dm-open-doc" data-doc="${esc(ev.doc_id)}">документ</button>`
              );
            }
            if (ev.order_id) {
              links.push(
                `<button type="button" class="linkish dm-open-thin-order" data-order="${esc(
                  ev.order_id
                )}" data-journal="${esc(
                  ev.kind === 'thin_supplier_order' || ev.kind === 'supplier_order'
                    ? 'parity-supplier-orders'
                    : ''
                )}">заказ поставщику</button>`
              );
            }
            if (ev.deal_id) {
              links.push(
                `<button type="button" class="linkish dm-open-deal-ev" data-deal="${esc(ev.deal_id)}">сделка</button>`
              );
            }
            return `<li>
              <div class="dm-trace-at mono muted">${esc(String(ev.at || '').replace('T', ' ').slice(0, 16) || '—')}</div>
              <div class="dm-trace-body">
                <div class="dm-trace-title">${esc(ev.title || ev.kind)}</div>
                ${ev.detail ? `<div class="muted" style="margin-top:2px">${esc(ev.detail)}</div>` : ''}
                ${links.length ? `<div class="dm-trace-links">${links.join(' · ')}</div>` : ''}
              </div>
            </li>`;
          })
          .join('')}
      </ol>`
    : '<p class="muted">Пока нет событий по этому коду.</p>';

  view.innerHTML = formChrome(
    code,
    `
    ${nowBlock}
    ${appsBlock}
    ${dealBlock}
    <h3 style="margin:0 0 8px;font-size:13px;color:var(--taxi-green)">История марки</h3>
    <p class="muted" style="margin:0 0 10px;font-size:12px">Где создана, в каких заказах и документах участвовала, склады и отгрузки.</p>
    ${timeline}
    <div style="margin-top:16px">
      <img alt="Марка" style="width:120px;height:120px;image-rendering:pixelated;background:#fff;border:1px solid var(--line,#ddd);border-radius:8px;padding:6px"
        src="/api/datamatrix.png?text=${encodeURIComponent(code)}&scale=4" />
    </div>`,
    {
      section: 'Марка · история',
      ...(u?.product_id
        ? {
            chatRef: {
              type: 'product',
              id: String(u.product_id),
              label: 'DM ' + code + (u.product_name ? ' · ' + u.product_name : ''),
              href: '/serials/' + encodeURIComponent(code),
            },
          }
        : {}),
      toolbar: `
        <div class="find">
          <input id="dm-trace-q" class="mono" placeholder="Другой код…" value="${esc(code)}" />
          <button type="button" class="find-go" id="dm-trace-go">Найти</button>
        </div>
        <div class="grow"></div>
        ${u?.product_id ? `<button type="button" id="dm-to-product">Карточка товара</button>` : ''}
        <button type="button" id="dm-to-units">Все экземпляры</button>`,
    }
  );
  const thinOrderFromEvents = events.find((e) => e.order_id)?.order_id || '';
  bindFormChrome(() => {
    if (thinOrderFromEvents) {
      try {
        const path = TAB_PATHS['parity-supplier-orders'] || '/purchases/supplier-orders';
        history.replaceState({ wms: true }, '', path + '?doc=' + encodeURIComponent(thinOrderFromEvents));
      } catch (_) {
        /* ignore */
      }
      openTab('parity-supplier-orders');
      return;
    }
    openTab(u?.product_id ? 'product:' + u.product_id : 'balances');
  });
  const goFind = () => {
    const next = String(document.getElementById('dm-trace-q')?.value || '').trim();
    if (next) openTab('serial:' + next, next.slice(0, 40));
  };
  document.getElementById('dm-trace-go')?.addEventListener('click', goFind);
  document.getElementById('dm-trace-q')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') goFind();
  });
  document.getElementById('dm-open-product')?.addEventListener('click', () => {
    if (u?.product_id) openTab('product:' + u.product_id);
  });
  document.getElementById('dm-to-product')?.addEventListener('click', () => {
    if (u?.product_id) openTab('product:' + u.product_id);
  });
  document.getElementById('dm-to-units')?.addEventListener('click', () => openTab('product-units'));
  document.getElementById('dm-apps-save')?.addEventListener('click', async () => {
    const msg = document.getElementById('dm-apps-msg');
    const raw = String(document.getElementById('dm-apps')?.value || '').trim();
    try {
      if (msg) msg.textContent = 'Сохранение…';
      const res = await api('/product-units/apps', {
        method: 'PATCH',
        body: JSON.stringify({ serial: code, apps: raw }),
      });
      if (msg) msg.textContent = '✓ ' + (res.apps_label || 'сохранено');
      renderSerialTrace(code);
    } catch (e) {
      if (msg) msg.textContent = e.message || String(e);
    }
  });
  document.getElementById('dm-open-deal')?.addEventListener('click', () => {
    if (data.deal?.deal_id) openTab('deal:' + data.deal.deal_id);
  });
  view.querySelectorAll('.dm-open-doc').forEach((btn) => {
    btn.onclick = () => openTab('doc:' + btn.getAttribute('data-doc'));
  });
  view.querySelectorAll('.dm-open-deal-ev').forEach((btn) => {
    btn.onclick = () => openTab('deal:' + btn.getAttribute('data-deal'));
  });
  view.querySelectorAll('.dm-open-thin-order').forEach((btn) => {
    btn.onclick = () => {
      const oid = btn.getAttribute('data-order') || '';
      if (!oid) return;
      try {
        const path = TAB_PATHS['parity-supplier-orders'] || '/purchases/supplier-orders';
        history.replaceState({ wms: true }, '', path + '?doc=' + encodeURIComponent(oid));
      } catch (_) {
        /* ignore */
      }
      openTab('parity-supplier-orders');
    };
  });
}

async function renderProductUnits() {
  await refreshRefs();
  const q = state.unitsQ || '';
  const status = state.unitsStatus || 'in_stock';
  const page = Math.max(1, Number(state.unitsPage) || 1);
  const productId = state.unitsProductId || '';
  const warehouseId = state.unitsWarehouseId || '';
  const qs = new URLSearchParams({
    page: String(page),
    limit: '50',
    status,
  });
  if (q) qs.set('q', q);
  if (productId) qs.set('product_id', productId);
  if (warehouseId) qs.set('warehouse_id', warehouseId);
  const data = await api('/product-units?' + qs.toString());
  const items = data.items || [];
  const labels = data.status_labels || {};
  const statusTabs = [
    ['in_stock', 'На складе'],
    ['sold', 'Отгружены'],
    ['', 'Все'],
  ];
  const filterNote =
    productId || warehouseId
      ? `<p class="muted" style="margin:0 0 8px">Фильтр: ${
          productId ? 'товар' : ''
        }${productId && warehouseId ? ' · ' : ''}${warehouseId ? 'склад' : ''}
        · <button type="button" class="linkish" id="units-clear-filter">сбросить</button></p>`
      : '';
  view.innerHTML = formChrome(
    'Экземпляры / марки',
    `
    <p class="muted" style="margin:0 0 8px">Уникальные марки (коды штук). Клик по марке — полная история: откуда пришёл, где был, куда ушёл.</p>
    ${filterNote}
    <div class="form-pagetabs" style="margin:0 0 10px" id="units-status-tabs">
      ${statusTabs
        .map(
          ([id, label]) =>
            `<button type="button" class="form-pagetab ${status === id ? 'active' : ''}" data-units-status="${esc(id)}">${esc(label)}</button>`
        )
        .join('')}
    </div>
    ${pagerHtml('unitspager', page, data.pages || 1, data.total || 0, { limit: 50, listKey: 'units' })}
    <table data-no-col-filter="1">
      <thead><tr><th>Марка</th><th>Артикул</th><th>Товар</th><th>Склад</th><th>Статус</th><th>Приход</th></tr></thead>
      <tbody>
        ${
          items
            .map(
              (u) => `<tr class="clickable" data-serial-row="${esc(u.serial)}">
                <td class="mono"><button type="button" class="linkish mono" data-serial="${esc(u.serial)}">${esc(u.serial)}</button></td>
                <td class="mono">${esc(u.sku || '')}</td>
                <td>${esc(u.product_name || '')}</td>
                <td>${esc(u.warehouse_name || '—')}</td>
                <td>${esc(labels[u.status] || u.status)}</td>
                <td class="muted" style="font-size:12px">${esc(
                  [u.in_doc_number, u.supplier_name, u.in_doc_date].filter(Boolean).join(' · ') || '—'
                )}</td>
              </tr>`
            )
            .join('') || '<tr><td colspan="6" class="muted">Пока нет экземпляров — набейте в приходе, заказе поставщику или в карточке товара.</td></tr>'
        }
      </tbody>
    </table>`,
    {
      section: 'Марки',
      toolbar: `
        <div class="find">
          <input id="units-q" class="mono" placeholder="Код / артикул / название" value="${esc(q)}" />
          <button type="button" class="find-go" id="units-search">Найти</button>
        </div>
        <div class="grow"></div>
        <button type="button" id="units-in">Приход с серийниками</button>
        <button type="button" id="units-out">Расход с серийниками</button>`,
    }
  );
  bindFormChrome(() => showSection('warehouse'));
  document.getElementById('units-clear-filter')?.addEventListener('click', () => {
    state.unitsProductId = '';
    state.unitsWarehouseId = '';
    state.unitsPage = 1;
    renderProductUnits();
  });
  document.getElementById('units-search').onclick = () => {
    const val = document.getElementById('units-q').value.trim();
    state.unitsQ = val;
    state.unitsPage = 1;
    // если ввели похоже на полный код — сразу история
    if (val && !/\s/.test(val) && val.length >= 6) {
      openTab('serial:' + val, val.slice(0, 40));
      return;
    }
    renderProductUnits();
  };
  document.getElementById('units-q').onkeydown = (e) => {
    if (e.key === 'Enter') document.getElementById('units-search').click();
  };
  view.querySelectorAll('[data-units-status]').forEach((btn) => {
    btn.onclick = () => {
      state.unitsStatus = btn.getAttribute('data-units-status') || '';
      state.unitsPage = 1;
      renderProductUnits();
    };
  });
  document.getElementById('units-in').onclick = () => openTab('in-new');
  document.getElementById('units-out').onclick = () => openTab('out-new');
  view.querySelectorAll('[data-serial]').forEach((btn) => {
    btn.onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      const code = btn.getAttribute('data-serial');
      if (code) openTab('serial:' + code, String(code).slice(0, 40));
    };
  });
  view.querySelectorAll('[data-serial-row]').forEach((tr) => {
    tr.onclick = () => {
      const code = tr.getAttribute('data-serial-row');
      if (code) openTab('serial:' + code, String(code).slice(0, 40));
    };
  });
  bindListPager(['unitspager'], 'units', 'unitsPage', () => renderProductUnits());
}

async function renderProps() {
  const list = await api('/dicts/properties');
  view.innerHTML = formChrome(
    'Характеристики',
    `
    <p class="muted" style="margin:0 0 10px">Свойства из HS Get/property_products. Всего: ${list.length}.</p>
    <table>
      <thead><tr><th>Свойство</th><th>Товаров</th><th></th></tr></thead>
      <tbody>
        ${
          list.length
            ? list
                .map(
                  (p) => `
          <tr>
            <td>${esc(p.name)}</td>
            <td class="mono">${p.products_count}</td>
            <td><button type="button" class="linkish" data-prop="${esc(p.id)}" data-name="${esc(p.name)}">Значения</button></td>
          </tr>`
                )
                .join('')
            : '<tr><td colspan="3" class="muted">Пусто — синхронизируйте HS.</td></tr>'
        }
      </tbody>
    </table>
    <div class="panel hidden" id="prop-vals" style="margin-top:14px"></div>`
  );
  bindFormChrome(() => showSection('warehouse'));
  view.querySelectorAll('[data-prop]').forEach((btn) => {
    btn.onclick = async () => {
      const box = document.getElementById('prop-vals');
      box.classList.remove('hidden');
      box.innerHTML = '<p class="muted">Загрузка…</p>';
      try {
        const vals = await api('/dicts/properties/' + btn.dataset.prop + '/values');
        box.innerHTML = `
          <h3 style="margin:0 0 8px;font-size:13px;color:var(--taxi-green)">${esc(btn.dataset.name)} — значения (${vals.length})</h3>
          <table>
            <thead><tr><th>Значение</th><th>Товаров</th></tr></thead>
            <tbody>
              ${
                vals
                  .map((v) => `<tr><td>${esc(v.value)}</td><td class="mono">${v.products_count}</td></tr>`)
                  .join('') || '<tr><td colspan="2" class="muted">Нет значений</td></tr>'
              }
            </tbody>
          </table>`;
      } catch (e) {
        box.innerHTML = `<p class="error">${esc(e.message)}</p>`;
      }
    };
  });
}

async function renderMarks() {
  const [marks, gens] = await Promise.all([api('/dicts/marks'), api('/dicts/generations')]);
  view.innerHTML = formChrome(
    'Марки / модели',
    `
    <p class="muted" style="margin:0 0 10px">Марок: ${marks.length}, поколений: ${gens.length}.</p>
    <table>
      <thead><tr><th>Марка</th><th>Товаров</th><th></th></tr></thead>
      <tbody>
        ${
          marks.length
            ? marks
                .map(
                  (m) => `
          <tr>
            <td>${esc(m.name)}</td>
            <td class="mono">${m.products_count}</td>
            <td><button type="button" class="linkish" data-mark="${esc(m.id)}" data-name="${esc(m.name)}">Модели</button></td>
          </tr>`
                )
                .join('')
            : '<tr><td colspan="3" class="muted">Пусто.</td></tr>'
        }
      </tbody>
    </table>
    <div class="panel hidden" id="mark-models" style="margin-top:14px"></div>
    <h3 style="margin:16px 0 8px;font-size:13px;color:var(--taxi-green)">Поколения</h3>
    <table>
      <thead><tr><th>Поколение</th><th>Товаров</th></tr></thead>
      <tbody>
        ${
          gens.length
            ? gens
                .map((g) => `<tr><td>${esc(g.name)}</td><td class="mono">${g.products_count}</td></tr>`)
                .join('')
            : '<tr><td colspan="2" class="muted">Нет данных</td></tr>'
        }
      </tbody>
    </table>`
  );
  bindFormChrome(() => showSection('warehouse'));
  view.querySelectorAll('[data-mark]').forEach((btn) => {
    btn.onclick = async () => {
      const box = document.getElementById('mark-models');
      box.classList.remove('hidden');
      box.innerHTML = '<p class="muted">Загрузка…</p>';
      try {
        const models = await api('/dicts/marks/' + btn.dataset.mark + '/models');
        box.innerHTML = `
          <h3 style="margin:0 0 8px;font-size:13px;color:var(--taxi-green)">${esc(btn.dataset.name)} — модели (${models.length})</h3>
          <table>
            <thead><tr><th>Модель</th><th>Товаров</th></tr></thead>
            <tbody>
              ${
                models
                  .map((m) => `<tr><td>${esc(m.name)}</td><td class="mono">${m.products_count}</td></tr>`)
                  .join('') || '<tr><td colspan="2" class="muted">Нет моделей</td></tr>'
              }
            </tbody>
          </table>`;
      } catch (e) {
        box.innerHTML = `<p class="error">${esc(e.message)}</p>`;
      }
    };
  });
}

function bindMediaProductHoverPreview(root) {
  let tip = document.getElementById('mp-hover-preview');
  if (!tip) {
    tip = document.createElement('div');
    tip.id = 'mp-hover-preview';
    tip.className = 'mp-hover-preview';
    tip.setAttribute('role', 'tooltip');
    tip.hidden = true;
    document.body.appendChild(tip);
  } else {
    tip.hidden = true;
    tip.classList.remove('is-visible');
    tip.innerHTML = '';
  }
  let hideTimer = 0;
  const hide = () => {
    tip.classList.remove('is-visible');
    hideTimer = window.setTimeout(() => {
      tip.hidden = true;
      tip.innerHTML = '';
    }, 80);
  };
  const place = (el) => {
    const r = el.getBoundingClientRect();
    const pad = 12;
    const w = 220;
    const h = tip.offsetHeight || 220;
    let left = r.right + pad;
    if (left + w > window.innerWidth - 8) left = Math.max(8, r.left - w - pad);
    let top = r.top;
    if (top + h > window.innerHeight - 8) top = Math.max(8, window.innerHeight - h - 8);
    tip.style.left = `${Math.round(left)}px`;
    tip.style.top = `${Math.round(top)}px`;
  };
  const show = (el) => {
    window.clearTimeout(hideTimer);
    const url = (el.getAttribute('data-preview') || '').trim();
    const title = (el.getAttribute('data-preview-title') || '').trim();
    if (url) {
      tip.innerHTML =
        `<img src="${esc(url)}" alt="" />` +
        (title ? `<div class="mp-hover-caption">${esc(title)}</div>` : '');
    } else {
      tip.innerHTML =
        `<div class="mp-hover-empty">Нет фото</div>` +
        (title ? `<div class="mp-hover-caption">${esc(title)}</div>` : '');
    }
    tip.hidden = false;
    tip.classList.add('is-visible');
    place(el);
  };
  root.querySelectorAll('tr[data-open][data-preview-row]').forEach((tr) => {
    tr.addEventListener('mouseenter', () => show(tr));
    tr.addEventListener('mouseleave', hide);
    tr.addEventListener('mousemove', () => place(tr));
  });
}

async function renderMediaPhotos() {
  const q = state.mediaPhotosQ || '';
  const status = state.mediaPhotosStatus || 'stock_without';
  const catId = state.mediaPhotosCat || '';
  const page = state.mediaPhotosPage || 1;
  const limit = getPageSize('media', 50);
  let coverage;
  let list;
  try {
    const qs = new URLSearchParams({ page: String(page), limit: String(limit), status });
    if (q) qs.set('q', q);
    if (catId) qs.set('category_id', catId);
    [coverage, list] = await Promise.all([
      api('/media/coverage'),
      api('/media/products?' + qs.toString()),
    ]);
  } catch (e) {
    view.innerHTML = formChrome('Фото номенклатуры', `<p class="error">${esc(e.message)}</p>`);
    bindFormChrome(() => showSection('warehouse'));
    return;
  }
  const t = coverage.totals || {};
  const cats = coverage.categories || [];
  const items = list.items || [];
  const syncOk = canSync1c();

  const catOpts =
    '<option value="">Все категории</option>' +
    '<option value="__none__"' +
    (catId === '__none__' ? ' selected' : '') +
    '>Без категории</option>' +
    cats
      .map(
        (c) =>
          `<option value="${esc(c.category_id || '')}" ${
            c.category_id === catId ? 'selected' : ''
          }>${esc(c.category_name)} — фото ${c.with_photo}/${c.products} (${c.pct}%)</option>`
      )
      .join('');

  view.innerHTML = formChrome(
    'Фото номенклатуры',
    `
    <div class="panel" style="margin-bottom:12px">
      <p class="muted" style="margin:0 0 8px">
        По умолчанию — товары <b>на складе без фото</b> (как у
        <a href="/photo">Фотографа</a>). Наведите на строку — превью фото.
        Поиск — по артикулу (SKU), коду 1С, штрихкоду, названию.
      </p>
      <div class="home-stats">
        <span>Товаров<b>${esc(t.products || 0)}</b></span>
        <span>С фото<b>${esc(t.with_photo || 0)}</b></span>
        <span>Без фото<b>${esc(t.without_photo || 0)}</b></span>
        <span>Склад без фото<b>${esc(t.stock_without_photo || 0)}</b></span>
        <span>Покрытие<b>${esc(t.pct || 0)}%</b></span>
        <span>Файлов S3<b>${esc(t.images || 0)}</b></span>
      </div>
      <div class="toolbar" style="margin-top:10px;flex-wrap:wrap">
        <input type="search" id="mp-q" placeholder="Артикул / код / штрихкод / название" value="${esc(q)}" style="min-width:240px" />
        <select id="mp-status">
          <option value="stock_without" ${status === 'stock_without' ? 'selected' : ''}>На складе без фото</option>
          <option value="without" ${status === 'without' ? 'selected' : ''}>Все без фото</option>
          <option value="with" ${status === 'with' ? 'selected' : ''}>Только с фото</option>
          <option value="all" ${status === 'all' ? 'selected' : ''}>Все</option>
        </select>
        <select id="mp-cat" style="min-width:220px">${catOpts}</select>
        <button class="primary" type="button" id="mp-search">Найти</button>
        <button type="button" id="mp-reload">Обновить</button>
        ${
          syncOk
            ? '<button type="button" id="mp-sync">Подтянуть фото из 1С (+50 без фото)</button>'
            : ''
        }
        <span class="muted" id="mp-msg"></span>
      </div>
    </div>

    <h3 style="margin:0 0 8px;font-size:13px;color:var(--taxi-green)">По категориям</h3>
    <table style="margin-bottom:16px">
      <thead><tr><th>Категория</th><th>Товаров</th><th>С фото</th><th>Без фото</th><th>%</th></tr></thead>
      <tbody>
        ${
          cats.length
            ? cats
                .slice(0, 80)
                .map(
                  (c) => `<tr class="clickable" data-pick-cat="${esc(c.category_id == null ? '__none__' : c.category_id)}">
                    <td>${esc(c.category_name)}</td>
                    <td class="mono">${esc(c.products)}</td>
                    <td class="mono">${esc(c.with_photo)}</td>
                    <td class="mono">${esc(c.without_photo)}</td>
                    <td class="mono">${esc(c.pct)}%</td>
                  </tr>`
                )
                .join('')
            : '<tr><td colspan="5" class="muted">Нет данных</td></tr>'
        }
      </tbody>
    </table>

    <h3 style="margin:0 0 8px;font-size:13px;color:var(--taxi-green)">Товары</h3>
    ${pagerHtml('mpager', list.page, list.pages, list.total, { limit, listKey: 'media' })}
    <table class="mp-products">
      <thead><tr><th></th><th>SKU</th><th>Код</th><th>Название</th><th>Категория</th><th>Остаток</th><th>Склад</th><th>Фото</th></tr></thead>
      <tbody>
        ${
          items.length
            ? items
                .map((p) => {
                  const n = Number(p.images_count) || 0;
                  const qty = Number(p.stock_qty) || 0;
                  const wh = String(p.stock_warehouses || '').trim();
                  const title = productTitle(p);
                  const thumb = p.thumb_url
                    ? `<img class="mp-thumb" src="${esc(p.thumb_url)}" alt="" />`
                    : '<span class="mp-thumb-empty muted">нет</span>';
                  return `<tr class="clickable" data-open="${esc(p.id)}" data-preview-row="1" data-preview="${esc(
                    p.thumb_url || ''
                  )}" data-preview-title="${esc(title)}">
                    <td>${thumb}</td>
                    <td class="mono">${esc(p.sku)}</td>
                    <td class="mono">${esc(p.code || '—')}</td>
                    <td>${esc(title)}</td>
                    <td>${esc(p.category || '—')}</td>
                    <td class="mono">${qty > 0 ? esc(qty) : '<span class="muted">0</span>'}</td>
                    <td style="max-width:220px;font-size:12px">${wh ? esc(wh) : '<span class="muted">—</span>'}</td>
                    <td class="mono" style="color:${n ? 'var(--taxi-green)' : 'var(--danger, #c33)'}">${n ? n + ' шт' : 'нет'}</td>
                  </tr>`;
                })
                .join('')
            : `<tr><td colspan="8" class="muted">${
                status === 'stock_without'
                  ? 'Нет товаров на складе без фото'
                  : 'Ничего не найдено'
              }</td></tr>`
        }
      </tbody>
    </table>
    ${pagerHtml('mpager2', list.page, list.pages, list.total, { limit, listKey: 'media' })}`
  );
  bindFormChrome(() => showSection('warehouse'));
  bindMediaProductHoverPreview(view);

  const reload = () => renderMediaPhotos();
  const applySearch = () => {
    state.mediaPhotosQ = document.getElementById('mp-q').value.trim();
    state.mediaPhotosStatus = document.getElementById('mp-status').value;
    state.mediaPhotosCat = document.getElementById('mp-cat').value;
    state.mediaPhotosPage = 1;
    reload();
  };
  document.getElementById('mp-search').onclick = applySearch;
  document.getElementById('mp-reload').onclick = reload;
  document.getElementById('mp-q').onkeydown = (e) => {
    if (e.key === 'Enter') applySearch();
  };
  document.getElementById('mp-status').onchange = applySearch;
  document.getElementById('mp-cat').onchange = applySearch;

  const syncBtn = document.getElementById('mp-sync');
  if (syncBtn) {
    syncBtn.onclick = async () => {
      const msg = document.getElementById('mp-msg');
      syncBtn.disabled = true;
      msg.textContent = 'Загрузка фото из 1С…';
      try {
        const r = await api('/sync/media', {
          method: 'POST',
          body: JSON.stringify({ limit: 50, onlyMissing: true }),
        });
        msg.textContent = `Загружено ${r.uploaded}, без фото в 1С ${r.empty}, пропущено ${r.skipped}`;
        setTimeout(reload, 600);
      } catch (e) {
        msg.textContent = e.message;
      } finally {
        syncBtn.disabled = false;
      }
    };
  }

  bindListPager(['mpager', 'mpager2'], 'media', 'mediaPhotosPage', () => reload());

  view.querySelectorAll('[data-pick-cat]').forEach((tr) => {
    tr.onclick = () => {
      state.mediaPhotosCat = tr.dataset.pickCat || '';
      state.mediaPhotosPage = 1;
      reload();
    };
  });
  view.querySelectorAll('[data-open]').forEach((tr) => {
    tr.onclick = () => openTab('product:' + tr.dataset.open);
  });
}

function catNameKey(name) {
  return String(name || '')
    .trim()
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/\s+/g, ' ');
}

/** Клиентская склейка дублей 1С + скрытие пустых оболочек. */
function normalizeCategoryTree(nodes) {
  const merge = (list) => {
    const map = new Map();
    for (const n of list || []) {
      const kids = merge(n.children || []);
      const key = catNameKey(n.name) || n.id;
      const own = Number(n.products_own) || 0;
      const prev = map.get(key);
      if (!prev) {
        map.set(key, {
          ...n,
          products_own: own,
          ids: [...(n.ids && n.ids.length ? n.ids : [n.id])],
          children: kids,
        });
        continue;
      }
      if (own > prev.products_own) prev.id = n.id;
      prev.products_own += own;
      prev.ids.push(...(n.ids && n.ids.length ? n.ids : [n.id]));
      prev.children = merge([...(prev.children || []), ...kids]);
    }
    const out = [...map.values()];
    for (const n of out) {
      let sum = n.products_own;
      for (const ch of n.children) sum += Number(ch.products_total) || 0;
      n.products_total = sum;
    }
    out.sort((a, b) => String(a.name).localeCompare(String(b.name), 'ru', { sensitivity: 'base' }));
    return out;
  };
  const prune = (list) =>
    (list || [])
      .map((n) => ({ ...n, children: prune(n.children || []) }))
      .filter((n) => {
        const name = String(n.name || '');
        if (/^удалить\b/i.test(name) || name.startsWith('<')) return false;
        const tot = Number(n.products_total) || 0;
        const kids = (n.children || []).length;
        // пустая оболочка без детей — не показываем
        if (tot === 0 && kids === 0) return false;
        return true;
      });
  return prune(merge(nodes || []));
}

async function renderCategoryTree() {
  let data;
  try {
    data = await api('/categories/tree');
  } catch (e) {
    view.innerHTML = formChrome('Дерево категорий', `<p class="error">${esc(e.message)}</p>`);
    bindFormChrome(() => showSection('warehouse'));
    return;
  }
  const roots = normalizeCategoryTree(data.roots || []);
  const openSet = state.catTreeOpen instanceof Set ? state.catTreeOpen : new Set();
  state.catTreeOpen = openSet;

  const rowHtml = (node, depth) => {
    const hasKids = (node.children || []).length > 0;
    const open = openSet.has(node.id);
    const pad = 8 + depth * 18;
    const toggle = hasKids
      ? `<button type="button" class="cat-toggle" data-toggle="${esc(node.id)}" title="${open ? 'Свернуть' : 'Развернуть'}">${open ? '▼' : '▶'}</button>`
      : `<span class="muted" style="display:inline-block;width:22px;text-align:center">·</span>`;
    const kids =
      hasKids && open
        ? node.children.map((ch) => rowHtml(ch, depth + 1)).join('')
        : '';
    return `
      <tr>
        <td style="padding-left:${pad}px">
          ${toggle}
          <a href="#" data-cat="${esc(node.id)}" data-name="${esc(node.name)}">${esc(node.name)}</a>
          ${hasKids ? `<span class="muted" style="margin-left:6px">(${node.children.length})</span>` : ''}
        </td>
        <td class="mono" title="Прямо в этой категории">${esc(node.products_own || 0)}</td>
        <td class="mono" title="Свои + все вложенные"><b>${esc(node.products_total || 0)}</b></td>
      </tr>
      ${kids}`;
  };

  view.innerHTML = formChrome(
    'Дерево категорий',
    `
    <div class="panel" style="margin-bottom:12px">
      <p class="muted" style="margin:0 0 8px">
        База подвески (Фогель не грузим). Одноимённые папки 1С склеены в одну категорию.
        Клик — номенклатура категории.
      </p>
      <div class="home-stats">
        <span>Строк в дереве<b>${roots.length}</b></span>
        <span title="До склейки">GUID 1С<b>${esc(data.raw_categories || 0)}</b></span>
        <span>Товаров в дереве<b>${esc(data.total_products_in_tree || 0)}</b></span>
        <span>Без категории<b>${esc(data.uncategorized || 0)}</b></span>
      </div>
      <div class="toolbar" style="margin-top:10px">
        <button type="button" id="ct-expand">Развернуть всё</button>
        <button type="button" id="ct-collapse">Свернуть всё</button>
        <button type="button" id="ct-reload">Обновить</button>
        <button type="button" id="ct-none">Без категории →</button>
      </div>
    </div>
    <table>
      <thead><tr><th>Категория</th><th title="Только эта">Свои</th><th title="Свои + потомки">Вниз</th></tr></thead>
      <tbody>
        ${
          roots.length
            ? roots.map((r) => rowHtml(r, 0)).join('')
            : '<tr><td colspan="3" class="muted">Категорий нет — синхронизируйте 1С</td></tr>'
        }
      </tbody>
    </table>`
  );
  bindFormChrome(() => showSection('warehouse'));

  const collectIds = (nodes, out = []) => {
    for (const n of nodes || []) {
      if ((n.children || []).length) {
        out.push(n.id);
        collectIds(n.children, out);
      }
    }
    return out;
  };

  document.getElementById('ct-reload').onclick = () => renderCategoryTree();
  document.getElementById('ct-expand').onclick = () => {
    state.catTreeOpen = new Set(collectIds(roots));
    renderCategoryTree();
  };
  document.getElementById('ct-collapse').onclick = () => {
    state.catTreeOpen = new Set();
    renderCategoryTree();
  };
  document.getElementById('ct-none').onclick = () => {
    state.productsCategoryId = '__none__';
    state.productsCategoryName = '__none__';
    state.productsPage = 1;
    openTab('products');
  };
  view.querySelectorAll('[data-toggle]').forEach((btn) => {
    btn.onclick = (e) => {
      e.preventDefault();
      const id = btn.dataset.toggle;
      if (openSet.has(id)) openSet.delete(id);
      else openSet.add(id);
      renderCategoryTree();
    };
  });
  view.querySelectorAll('[data-cat]').forEach((a) => {
    a.onclick = (e) => {
      e.preventDefault();
      // id + имя: API по GUID подтянет все товары с тем же именем (две базы 1С)
      state.productsCategoryId = a.dataset.cat || '';
      state.productsCategoryName = a.dataset.name || '';
      state.productsPage = 1;
      openTab('products');
    };
  });
}

async function renderBrands() {
  const list = await api('/dicts/brands');
  view.innerHTML = formChrome(
    'Бренды',
    `
    <p class="muted" style="margin:0 0 10px">Всего: ${list.length}.</p>
    <table>
      <thead><tr><th>Бренд</th><th>Товаров</th></tr></thead>
      <tbody>
        ${
          list.length
            ? list
                .map(
                  (b) =>
                    `<tr><td>${esc(b.name)}</td><td class="mono">${b.products_count}</td></tr>`
                )
                .join('')
            : '<tr><td colspan="2" class="muted">Пусто.</td></tr>'
        }
      </tbody>
    </table>`
  );
  bindFormChrome(() => showSection('warehouse'));
}

async function renderPriceTypes() {
  const list = await api('/dicts/price-types');
  view.innerHTML = formChrome(
    'Типы цен',
    `
    <p class="muted" style="margin:0 0 12px;font-size:12px">
      Типы цен общие для всех организаций — переключатель контура в шапке на них не влияет.
    </p>
    <div class="form-grid">
      <label>Название<input id="pt-name" placeholder="Например: ОПТ3" autocomplete="off" /></label>
    </div>
    <div class="toolbar">
      <button class="primary" type="button" id="pt-add">Добавить</button>
      <span class="muted" id="pt-msg"></span>
    </div>
    <table>
      <thead><tr><th>Тип цены</th><th>Товаров</th></tr></thead>
      <tbody>
        ${
          list.length
            ? list
                .map(
                  (p) => `
          <tr class="clickable" data-pt-rename="${esc(p.id)}" data-name="${esc(p.name)}" title="Клик — переименовать">
            <td>${esc(p.name)}</td>
            <td class="mono">${p.products_count}</td>
          </tr>`
                )
                .join('')
            : '<tr><td colspan="2" class="muted">Пусто — добавьте тип или загрузите цены.</td></tr>'
        }
      </tbody>
    </table>`,
    {
      toolbar: `<button class="primary" type="button" id="pt-add2">Добавить</button><div class="grow"></div>`,
    }
  );
  bindFormChrome(() => showSection('sales'));
  const add = async () => {
    const msg = document.getElementById('pt-msg');
    const name = document.getElementById('pt-name').value.trim();
    if (!name) {
      msg.textContent = 'Укажите название';
      return;
    }
    try {
      await api('/dicts/price-types', { method: 'POST', body: JSON.stringify({ name }) });
      renderPriceTypes();
    } catch (e) {
      msg.textContent = e.message;
    }
  };
  document.getElementById('pt-add').onclick = add;
  document.getElementById('pt-add2').onclick = add;
  view.querySelectorAll('[data-pt-rename]').forEach((tr) => {
    tr.onclick = async () => {
      const name = prompt('Новое название типа цены', tr.dataset.name || '');
      if (name == null || !name.trim() || name.trim() === tr.dataset.name) return;
      try {
        await api('/dicts/price-types/' + tr.getAttribute('data-pt-rename'), {
          method: 'PATCH',
          body: JSON.stringify({ name: name.trim() }),
        });
        renderPriceTypes();
      } catch (e) {
        alert(e.message);
      }
    };
  });
}

async function renderIdeas() {
  const KIND_LABEL = { idea: 'Идея', bug: 'Ошибка' };
  const STATUS_LABEL = {
    new: 'Новая',
    planned: 'В планах',
    done: 'Сделано',
    rejected: 'Отклонено',
  };
  let items = [];
  try {
    items = await api('/feedback');
  } catch (e) {
    view.innerHTML = formChrome('Идеи и ошибки', `<p class="error">${esc(e.message)}</p>`);
    bindFormChrome(() => showSection('home'));
    return;
  }
  const listHtml =
    items.length === 0
      ? '<p class="muted">Пока пусто — напишите первую идею или ошибку.</p>'
      : `<table>
          <thead>
            <tr>
              <th style="width:90px">Тип</th>
              <th>Тема</th>
              <th style="width:110px">Статус</th>
              <th style="width:140px">Когда</th>
              <th style="width:160px">Действие</th>
            </tr>
          </thead>
          <tbody>
            ${items
              .map(
                (it) => `
              <tr data-id="${esc(it.id)}">
                <td><span class="badge kind-${esc(it.kind)}">${esc(KIND_LABEL[it.kind] || it.kind)}</span></td>
                <td>
                  <div class="fb-title">${esc(it.title)}</div>
                  ${it.body ? `<div class="fb-body muted">${esc(it.body)}</div>` : ''}
                  ${it.author ? `<div class="muted" style="margin-top:4px">от ${esc(it.author)}</div>` : ''}
                </td>
                <td><span class="badge status-${esc(it.status)}">${esc(STATUS_LABEL[it.status] || it.status)}</span></td>
                <td class="mono">${esc(String(it.created_at || '').replace('T', ' ').slice(0, 19))}</td>
                <td>
                  <select class="fb-status" data-id="${esc(it.id)}" title="Статус">
                    ${['new', 'planned', 'done', 'rejected']
                      .map(
                        (s) =>
                          `<option value="${s}" ${it.status === s ? 'selected' : ''}>${STATUS_LABEL[s]}</option>`
                      )
                      .join('')}
                  </select>
                </td>
              </tr>`
              )
              .join('')}
          </tbody>
        </table>`;

  view.innerHTML = formChrome(
    'Идеи и ошибки',
    `
    <div class="panel">
      <p class="muted" style="margin:0 0 10px">Пишите идеи и найденные ошибки — будем брать в работу по очереди.</p>
      <form id="fb-form" class="fb-form">
        <div class="form-grid">
          <label>Тип
            <select name="kind">
              <option value="idea">Идея</option>
              <option value="bug">Ошибка</option>
            </select>
          </label>
          <label>Кто пишет
            <input name="author" type="text" maxlength="120" placeholder="Имя (необязательно)" />
          </label>
          <label class="span-2">Заголовок
            <input name="title" type="text" maxlength="200" required placeholder="Кратко: что не так или что добавить" />
          </label>
          <label class="span-2">Описание
            <textarea name="body" rows="4" maxlength="5000" placeholder="Шаги воспроизведения, ожидаемое поведение, скрин — что угодно"></textarea>
          </label>
        </div>
        <div class="toolbar">
          <button class="primary" type="submit">Отправить</button>
          <span class="muted" id="fb-msg"></span>
        </div>
      </form>
    </div>
    <div class="panel">
      <h3 style="margin:0 0 8px;font-size:13px;font-weight:600">Очередь</h3>
      ${listHtml}
    </div>`,
    { closable: true }
  );
  bindFormChrome(() => showSection('home'));

  const form = document.getElementById('fb-form');
  form.onsubmit = async (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const msg = document.getElementById('fb-msg');
    const btn = form.querySelector('button[type="submit"]');
    btn.disabled = true;
    msg.textContent = 'Сохраняем…';
    try {
      await api('/feedback', {
        method: 'POST',
        body: JSON.stringify({
          kind: fd.get('kind'),
          title: fd.get('title'),
          body: fd.get('body'),
          author: fd.get('author'),
        }),
      });
      msg.textContent = 'Сохранено';
      renderIdeas();
    } catch (err) {
      msg.textContent = err.message;
      btn.disabled = false;
    }
  };

  view.querySelectorAll('.fb-status').forEach((sel) => {
    sel.onchange = async () => {
      try {
        await api('/feedback/' + sel.dataset.id, {
          method: 'PATCH',
          body: JSON.stringify({ status: sel.value }),
        });
        renderIdeas();
      } catch (err) {
        alert(err.message);
      }
    };
  });
}

const ROLE_LABELS = {
  admin: 'Админ',
  manager: 'Руководитель / менеджер',
  warehouse: 'Кладовщик',
  photographer: 'Фотограф',
  sto: 'СТО / мастер-приёмщик',
  courier: 'Курьер',
  sales: 'Продажи',
  accountant: 'Бухгалтер',
  readonly: 'Наблюдатель',
  none: 'Без доступа',
};

const FLAG_LABELS = {
  can_sync: 'Синхронизация 1С',
  can_edit_products: 'Номенклатура',
  can_edit_prices: 'Цены',
  can_edit_docs: 'Документы склада',
};

const SECTION_LABELS = {
  home: 'Главное',
  crm: 'CRM',
  sales: 'Продажи',
  documents: 'Документы',
  purchases: 'Закупки',
  warehouse: 'Склад',
  pick: 'Сборка (/pick)',
  photo: 'Фотограф (/photo)',
  lift: 'Подъёмник (/lift)',
  reception: 'Приёмщик (/reception)',
  delivery: 'Доставка / СДЭК',
  media: 'Медиа / фото',
  works: 'Работы',
  production: 'Производство',
  money: 'Деньги',
  kassa: 'Касса',
  reports: 'Отчёты',
  staff: 'Персонал',
  chats: 'Чаты',
  company: 'Компания',
  settings: 'Настройки',
  integrations: 'Интеграции',
  ideas: 'Идеи',
  help: 'Помощь',
};

/** Короткие заголовки колонок матрицы. */
const SECTION_LABELS_SHORT = {
  home: 'Главное',
  crm: 'CRM',
  sales: 'Продажи',
  documents: 'Документы',
  purchases: 'Закупки',
  warehouse: 'Склад',
  pick: 'Сборка',
  photo: 'Фото',
  lift: 'Подъёмник',
  reception: 'Приёмка',
  delivery: 'СДЭК',
  media: 'Медиа',
  works: 'Работы',
  production: 'Произв.',
  money: 'Деньги',
  kassa: 'Касса',
  reports: 'Отчёты',
  staff: 'Персонал',
  chats: 'Чаты',
  company: 'Компания',
  settings: 'Настр.',
  integrations: 'Интегр.',
  ideas: 'Идеи',
  help: 'Помощь',
};

const SCREEN_SECTIONS = new Set(['pick', 'photo', 'lift', 'reception']);

const AM_SCREEN_ICO =
  '<svg class="am-screen-ico" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><rect x="1.5" y="2.5" width="13" height="9" rx="1.2" fill="none" stroke="currentColor" stroke-width="1.3"/><path d="M5 13.5h6M8 11.5v2" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>';

function accessMatrixHeadCell(section, labels) {
  const tip = labels[section] || SECTION_LABELS[section] || section;
  const short = SECTION_LABELS_SHORT[section] || labels[section] || section;
  if (SCREEN_SECTIONS.has(section)) {
    return `<th class="am-col am-screen" title="${esc(tip)}">${AM_SCREEN_ICO}<span class="am-col-label">${esc(short)}</span></th>`;
  }
  return `<th class="am-col" title="${esc(tip)}">${esc(short)}</th>`;
}

function menuLinkAllowed(link) {
  if (!link) return false;
  const href = String(link.href || '');
  const label = String(link.label || '');
  // Балансы Точки временно скрыты из меню
  if (href === '/money/tochka' || href.startsWith('/money/tochka?') || /Точка:\s*балансы/i.test(label)) {
    return false;
  }
  if (href === '/pick' || href.startsWith('/pick')) return canAccessSectionMe('pick');
  if (href === '/photo' || href.startsWith('/photo') || href.startsWith('/media/photo')) {
    return canAccessSectionMe('photo') || canAccessSectionMe('media');
  }
  if (href === '/lift' || href.startsWith('/lift') || href.startsWith('/sto/lift')) {
    return canAccessSectionMe('lift') || canAccessSectionMe('works');
  }
  if (href === '/reception' || href.startsWith('/reception') || href.startsWith('/sto/reception')) {
    return canAccessSectionMe('reception') || canAccessSectionMe('works');
  }
  if (link.view === 'media-photos') {
    return canAccessSectionMe('media') || canAccessSectionMe('warehouse') || canAccessSectionMe('photo');
  }
  if (link.view === 'cdek-deals' || link.view === 'cdek-settings' || link.view === 'settings-cdek') {
    return (
      canAccessSectionMe('delivery') ||
      canAccessSectionMe('warehouse') ||
      canAccessSectionMe('settings') ||
      canAccessSectionMe('integrations')
    );
  }
  if (
    link.view === 'settings-amo' ||
    link.view === 'settings-atol' ||
    link.view === 'settings-yandex-pay' ||
    link.view === 'settings-tochka' ||
    link.view === 'settings-dadata' ||
    link.view === 'settings-deepseek' ||
    link.view === 'settings-channels'
  ) {
    return canAccessSectionMe('integrations') || canAccessSectionMe('settings') || canAccessSectionMe('crm');
  }
  return true;
}

function roleOptionsHtml(selected, catalog) {
  const ids =
    catalog && catalog.length
      ? catalog.map((r) => r.id)
      : Object.keys(ROLE_LABELS);
  return ids
    .map((r) => {
      const label =
        (catalog && catalog.find((x) => x.id === r) && catalog.find((x) => x.id === r).label)
        || ROLE_LABELS[r]
        || r;
      return `<option value="${esc(r)}" ${selected === r ? 'selected' : ''}>${esc(label)}</option>`;
    })
    .join('');
}

function rightsPreviewHtml(rights, sections) {
  if (!rights) return '<span class="muted">—</span>';
  const secList = (rights.sections || [])
    .map((s) => SECTION_LABELS[s] || s)
    .filter(Boolean);
  const flags = [];
  if (rights.can_sync) flags.push(FLAG_LABELS.can_sync);
  if (rights.can_edit_products) flags.push(FLAG_LABELS.can_edit_products);
  if (rights.can_edit_prices) flags.push(FLAG_LABELS.can_edit_prices);
  if (rights.can_edit_docs) flags.push(FLAG_LABELS.can_edit_docs);
  const secChecks = (sections || Object.keys(SECTION_LABELS))
    .map((s) => {
      const on = (rights.sections || []).includes(s);
      return `<label class="role-check ${on ? 'on' : 'off'}"><input type="checkbox" disabled ${on ? 'checked' : ''} /> ${esc(SECTION_LABELS[s] || s)}</label>`;
    })
    .join('');
  return `
    <div class="role-preview">
      <div class="role-preview-secs">${secChecks || esc(secList.join(', ') || 'нет разделов')}</div>
      <div class="muted" style="font-size:11px;margin-top:6px">${esc(flags.join(' · ') || 'только просмотр')}</div>
    </div>`;
}

async function renderStaffCard(staffId, ctx) {
  const { items, sections, companies, catalog, catalogById } = ctx;
  const it = items.find((x) => x.id === staffId);
  if (!it) {
    state.staffFocusId = '';
    return renderStaff();
  }
  if (state.staffCardTab !== 'sections' && state.staffCardTab !== 'role' && state.staffCardTab !== 'history') {
    state.staffCardTab = 'role';
  }
  const tab = state.staffCardTab;
  const isAdmin = it.role === 'admin';
  let rights = {};
  try {
    rights = JSON.parse(it.rights_json || '{}');
  } catch {
    rights = {};
  }
  const roleDef = catalogById[it.role] && catalogById[it.role].rights;
  if (rights.can_edit_products === undefined) {
    rights.can_edit_products = !!(roleDef && roleDef.can_edit_products);
  }
  if (rights.can_edit_prices === undefined) {
    rights.can_edit_prices = !!(roleDef && roleDef.can_edit_prices);
  }
  if (rights.can_sync === undefined) rights.can_sync = !!(roleDef && roleDef.can_sync);
  if (rights.can_edit_docs === undefined) {
    rights.can_edit_docs = !!(roleDef && roleDef.can_edit_docs);
  }
  const selected = new Set(rights.sections || []);
  const accessAll = !!it.company_access_all || isAdmin;
  const cos = Array.isArray(it.company_ids) ? it.company_ids : [];

  let panel = '';
  if (tab === 'role') {
    panel = `
      <div class="form-grid">
        <label class="span-2">ФИО<input id="sc-name" value="${esc(it.name || '')}" /></label>
        <label>Email<input id="sc-email" value="${esc(it.email || '')}" /></label>
        <label>Логин<input id="sc-login" class="mono" value="${esc(it.login || '')}" /></label>
        <label>Роль
          <select id="sc-role" title="${esc((catalogById[it.role] && catalogById[it.role].description) || '')}">
            ${roleOptionsHtml(it.role, catalog)}
          </select>
        </label>
        <label style="display:flex;align-items:center;gap:8px;margin-top:22px">
          <input type="checkbox" id="sc-login-ok" ${it.can_login ? 'checked' : ''} />
          Вход в систему разрешён
        </label>
      </div>
      <p class="muted" id="sc-role-desc" style="margin:8px 0 0;font-size:12px">${esc(
        (catalogById[it.role] && catalogById[it.role].description) || ''
      )}</p>
      <div class="form-actions is-float">
        <button type="button" class="primary" id="sc-role-save">Записать</button>
        <button type="button" id="sc-pass">Задать пароль</button>
        <button type="button" id="sc-pin">PIN смены</button>
        <button type="button" id="sc-reset-role">Сбросить разделы к роли</button>
        <span class="muted" id="sc-role-msg"></span>
      </div>`;
  } else if (tab === 'sections') {
    panel = `
      <p class="muted" style="margin:0 0 10px;font-size:12px">
        Разделы меню и флаги. Админ всегда со всеми разделами.
      </p>
      <div class="staff-sec-grid" id="sc-secs">
        ${sections
          .map(
            (s) => `
          <label>
            <input type="checkbox" value="${esc(s)}" ${selected.has(s) || isAdmin ? 'checked' : ''} ${
              isAdmin ? 'disabled' : ''
            } />
            ${esc(SECTION_LABELS[s] || s)}
          </label>`
          )
          .join('')}
      </div>
      <div class="staff-sec-grid" style="margin-top:12px">
        <label><input type="checkbox" id="sc-sync" ${rights.can_sync || isAdmin ? 'checked' : ''} ${
          isAdmin ? 'disabled' : ''
        } /> Синхронизация 1С</label>
        <label><input type="checkbox" id="sc-products" ${
          rights.can_edit_products || isAdmin ? 'checked' : ''
        } ${isAdmin ? 'disabled' : ''} /> Редактировать номенклатуру</label>
        <label><input type="checkbox" id="sc-prices" ${rights.can_edit_prices || isAdmin ? 'checked' : ''} ${
          isAdmin ? 'disabled' : ''
        } /> Редактировать цены</label>
        <label><input type="checkbox" id="sc-docs" ${rights.can_edit_docs || isAdmin ? 'checked' : ''} ${
          isAdmin ? 'disabled' : ''
        } /> Документы склада</label>
      </div>
      <p class="muted" style="margin:14px 0 6px;font-size:12px">Организации (контуры)${
        isAdmin ? ' — админ всегда все' : ''
      }</p>
      <div class="staff-sec-grid" id="sc-companies">
        ${
          companies
            .map((c) => {
              const on = accessAll || cos.includes(c.id);
              return `<label><input type="checkbox" data-co="${esc(c.id)}" ${on ? 'checked' : ''} ${
                isAdmin ? 'disabled' : ''
              } /> ${esc(c.name)}</label>`;
            })
            .join('') || '<span class="muted">нет организаций</span>'
        }
      </div>
      <div class="form-actions is-float">
        <button type="button" class="primary" id="sc-sec-save" ${isAdmin ? 'disabled' : ''}>Записать</button>
        <span class="muted" id="sc-sec-msg">${isAdmin ? 'Админ — все разделы и организации' : ''}</span>
      </div>`;
  } else {
    panel = `
      <p class="muted" style="margin:0 0 10px;font-size:12px">Действия сотрудника в системе (кто / что / когда / IP).</p>
      <div id="sc-history" class="entity-history"><p class="muted" style="margin:0">Загрузка…</p></div>
      <div class="form-actions is-float">
        <button type="button" id="sc-hist-full">Полный журнал</button>
      </div>`;
  }

  clearFloatFormDock();
  view.innerHTML = formChrome(formatPersonName(it.name) || 'Сотрудник', panel, {
    entityKind: 'staff',
    parentTab: 'staff',
    parentLabel: 'Сотрудники',
    pageTabs: [
      { id: 'sections', label: 'Разделы' },
      { id: 'role', label: 'Роли' },
      { id: 'history', label: 'История' },
    ],
    activePageTab: tab,
  });
  bindFormChrome(() => {
    clearFloatFormDock();
    state.staffFocusId = '';
    state.staffCardTab = 'sections';
    renderStaff();
  });
  view.querySelectorAll('[data-pagetab]').forEach((btn) => {
    btn.onclick = () => {
      state.staffCardTab = btn.dataset.pagetab || 'sections';
      renderStaff();
    };
  });

  if (tab === 'role') {
    document.getElementById('sc-role').onchange = () => {
      const role = document.getElementById('sc-role').value;
      const desc = document.getElementById('sc-role-desc');
      if (desc) desc.textContent = (catalogById[role] && catalogById[role].description) || '';
    };
    document.getElementById('sc-role-save').onclick = async () => {
      const msg = document.getElementById('sc-role-msg');
      const btn = document.getElementById('sc-role-save');
      btn.disabled = true;
      if (msg) msg.textContent = 'Сохранение…';
      try {
        await api('/staff/' + it.id, {
          method: 'PATCH',
          body: JSON.stringify({
            name: document.getElementById('sc-name').value,
            email: document.getElementById('sc-email').value,
            login: document.getElementById('sc-login').value,
            role: document.getElementById('sc-role').value,
            can_login: document.getElementById('sc-login-ok').checked,
            apply_role_defaults: document.getElementById('sc-role').value !== it.role,
          }),
        });
        if (msg) msg.textContent = 'Сохранено';
        renderStaff();
      } catch (e) {
        if (msg) msg.textContent = e.message || String(e);
        btn.disabled = false;
      }
    };
    document.getElementById('sc-reset-role').onclick = async () => {
      if (!confirm('Сбросить разделы и флаги к значениям роли? Организации сохранятся.')) return;
      try {
        await api('/staff/' + it.id, {
          method: 'PATCH',
          body: JSON.stringify({ apply_role_defaults: true }),
        });
        state.staffCardTab = 'sections';
        renderStaff();
      } catch (e) {
        alert(e.message);
      }
    };
    document.getElementById('sc-pass').onclick = () => {
      const modal = document.getElementById('staff-pass-modal');
      if (!modal) {
        alert('Перезагрузите страницу');
        return;
      }
      const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%';
      const bytes = new Uint8Array(12);
      crypto.getRandomValues(bytes);
      const pass = [...bytes].map((b) => alphabet[b % alphabet.length]).join('');
      modal.classList.remove('hidden');
      modal.innerHTML = `
        <div class="staff-modal-card">
          <h3>Пароль: ${esc(it.name)}</h3>
          <p class="muted" style="margin:0 0 10px;font-size:12px">Покажите сотруднику один раз.</p>
          <label style="display:grid;gap:4px;margin-bottom:10px">
            Пароль
            <input id="sp-pass" class="mono" value="${esc(pass)}" autocomplete="new-password" style="font-size:15px" />
          </label>
          <div class="toolbar" style="margin:0;justify-content:flex-end;gap:8px">
            <button type="button" id="sp-cancel">Отмена</button>
            <button type="button" class="primary" id="sp-save">Сохранить пароль</button>
          </div>
          <p class="error hidden" id="sp-err" style="margin:8px 0 0"></p>
        </div>`;
      document.getElementById('sp-cancel').onclick = () => modal.classList.add('hidden');
      document.getElementById('sp-save').onclick = async () => {
        const err = document.getElementById('sp-err');
        try {
          await api('/staff/' + it.id, {
            method: 'PATCH',
            body: JSON.stringify({ password: document.getElementById('sp-pass').value }),
          });
          modal.classList.add('hidden');
          renderStaff();
        } catch (e) {
          err.textContent = e.message;
          err.classList.remove('hidden');
        }
      };
    };
    document.getElementById('sc-pin').onclick = () => {
      const modal = document.getElementById('staff-pass-modal');
      if (!modal) {
        alert('Перезагрузите страницу');
        return;
      }
      const pin = String(1000 + Math.floor(Math.random() * 9000));
      modal.classList.remove('hidden');
      modal.innerHTML = `
        <div class="staff-modal-card">
          <h3>PIN смены: ${esc(it.name)}</h3>
          <p class="muted" style="margin:0 0 10px;font-size:12px">
            PIN (4–6 цифр) для экрана сборщика (/pick). Покажите один раз.
          </p>
          <label style="display:grid;gap:4px;margin-bottom:10px">
            PIN
            <input id="sp-pin" class="mono" value="${esc(pin)}" inputmode="numeric" maxlength="6" autocomplete="off" style="font-size:18px;letter-spacing:.2em" />
          </label>
          <div class="toolbar" style="margin:0 0 8px;flex-wrap:wrap;gap:8px">
            <button type="button" id="sp-pin-gen">Сгенерировать</button>
            <button type="button" id="sp-pin-clear">Сбросить PIN</button>
          </div>
          <div class="toolbar" style="margin:0;justify-content:flex-end;gap:8px">
            <button type="button" id="sp-pin-cancel">Отмена</button>
            <button type="button" class="primary" id="sp-pin-save">Сохранить PIN</button>
          </div>
          <p class="error hidden" id="sp-pin-err" style="margin:8px 0 0"></p>
        </div>`;
      const pinInput = document.getElementById('sp-pin');
      const err = document.getElementById('sp-pin-err');
      document.getElementById('sp-pin-cancel').onclick = () => modal.classList.add('hidden');
      document.getElementById('sp-pin-gen').onclick = () => {
        pinInput.value = String(1000 + Math.floor(Math.random() * 9000));
        err.classList.add('hidden');
      };
      document.getElementById('sp-pin-clear').onclick = async () => {
        if (!confirm('Сбросить PIN?')) return;
        try {
          await api('/staff/' + it.id, { method: 'PATCH', body: JSON.stringify({ pin: null }) });
          modal.classList.add('hidden');
          renderStaff();
        } catch (e) {
          err.textContent = e.message;
          err.classList.remove('hidden');
        }
      };
      document.getElementById('sp-pin-save').onclick = async () => {
        const value = String(pinInput.value || '').replace(/\D/g, '');
        err.classList.add('hidden');
        if (value.length < 4 || value.length > 6) {
          err.textContent = 'PIN — от 4 до 6 цифр';
          err.classList.remove('hidden');
          return;
        }
        const saveBtn = document.getElementById('sp-pin-save');
        saveBtn.disabled = true;
        try {
          await api('/staff/' + it.id, { method: 'PATCH', body: JSON.stringify({ pin: value }) });
          modal.classList.add('hidden');
          renderStaff();
        } catch (e) {
          err.textContent = e.message;
          err.classList.remove('hidden');
          saveBtn.disabled = false;
        }
      };
      pinInput.focus();
      pinInput.select();
    };
  }

  if (tab === 'sections' && !isAdmin) {
    document.getElementById('sc-sec-save').onclick = async () => {
      const msg = document.getElementById('sc-sec-msg');
      const btn = document.getElementById('sc-sec-save');
      const secs = [...view.querySelectorAll('#sc-secs input[type=checkbox][value]')]
        .filter((x) => x.checked)
        .map((x) => x.value);
      const coBoxes = [...view.querySelectorAll('#sc-companies input[data-co]')];
      const coChecked = coBoxes.filter((x) => x.checked).map((x) => x.dataset.co);
      if (coBoxes.length && !coChecked.length) {
        alert('Отметьте хотя бы одну организацию');
        return;
      }
      const company_ids = coChecked.length === coBoxes.length ? [] : coChecked;
      btn.disabled = true;
      if (msg) msg.textContent = 'Сохранение…';
      try {
        await api('/staff/' + it.id, {
          method: 'PATCH',
          body: JSON.stringify({
            rights: {
              sections: secs,
              can_sync: document.getElementById('sc-sync').checked,
              can_edit_products: document.getElementById('sc-products').checked,
              can_edit_prices: document.getElementById('sc-prices').checked,
              can_edit_docs: document.getElementById('sc-docs').checked,
              company_ids,
            },
          }),
        });
        if (msg) msg.textContent = 'Сохранено';
        renderStaff();
      } catch (e) {
        if (msg) msg.textContent = e.message || String(e);
        btn.disabled = false;
      }
    };
  }

  if (tab === 'history') {
    fillStaffHistory('sc-history', it.id);
    document.getElementById('sc-hist-full').onclick = () => openStaffHistory(it.id, it.name);
  }
}

async function renderStaff() {
  if (!isAdminMe() && !canAccessSectionMe('staff')) {
    view.innerHTML = formChrome('Сотрудники', '<p class="error">Нет доступа к разделу «Персонал»</p>');
    bindFormChrome(() => showSection('home'));
    return;
  }
  const q = state.staffQ || '';
  let data;
  try {
    data = await api('/staff' + (q ? '?q=' + encodeURIComponent(q) : ''));
  } catch (e) {
    view.innerHTML = formChrome('Сотрудники', `<p class="error">${esc(e.message)}</p>`);
    bindFormChrome(() => showSection('staff'));
    return;
  }
  const items = data.items || [];
  const meta = data.meta || {};
  const sections = data.sections || [];
  const companies = data.companies || [];
  const catalog = data.role_catalog || [];
  catalog.forEach((r) => {
    if (r.id && r.label) ROLE_LABELS[r.id] = r.label;
  });
  const catalogById = Object.fromEntries(catalog.map((r) => [r.id, r]));
  const staffCtx = { items, sections, companies, catalog, catalogById };

  if (state.staffFocusId) {
    await renderStaffCard(state.staffFocusId, staffCtx);
    // модалки пароля живут в разметке списка — добавим пустышку
    if (!document.getElementById('staff-pass-modal')) {
      const wrap = document.createElement('div');
      wrap.innerHTML = '<div id="staff-pass-modal" class="staff-modal hidden"></div>';
      view.appendChild(wrap.firstElementChild);
    }
    return;
  }

  const rows = items
    .map((it) => {
      const isAdmin = it.role === 'admin';
      const accessAll = !!it.company_access_all || isAdmin;
      const cos = Array.isArray(it.company_ids) ? it.company_ids : [];
      const coLabel = accessAll
        ? 'все'
        : cos.length
          ? cos
              .map((id) => {
                const c = companies.find((x) => x.id === id);
                return c ? c.name : id.slice(0, 6);
              })
              .join(', ')
          : 'все';
      const roleLabel = (catalogById[it.role] && catalogById[it.role].label) || ROLE_LABELS[it.role] || it.role || '—';
      return `
        <tr class="clickable" data-staff-open="${esc(it.id)}">
          <td>
            <button type="button" class="linkish" data-staff-open="${esc(it.id)}">${esc(formatPersonName(it.name))}</button>
            <div class="muted staff-sub">${esc(it.email || '—')}${it.login ? ' · ' + esc(it.login) : ''}</div>
            ${it.has_password ? '' : '<span class="badge draft">нет пароля</span>'}
            ${it.can_login ? '' : '<span class="muted" style="font-size:11px"> · без входа</span>'}
          </td>
          <td>${esc(roleLabel)}</td>
          <td class="muted" style="font-size:12px">${esc(coLabel)}</td>
          <td>${
            Number(it.is_active) === 0
              ? '<span class="badge draft">Архив</span>'
              : '<span class="badge">Активен</span>'
          }</td>
        </tr>`;
    })
    .join('');

  const roleLegend = catalog
    .filter((r) => r.id !== 'none')
    .map(
      (r) =>
        `<div class="role-legend-item"><b>${esc(r.label)}</b> — ${esc(r.description || '')}</div>`
    )
    .join('');

  view.innerHTML = formChrome(
    'Сотрудники',
    `
    <p class="muted" style="margin:0 0 8px">Клик по строке — карточка (Разделы / Роли / История).</p>
    <div class="table-scroll">
      <table class="data-table is-dense" data-table-key="staff" data-no-col-filter="1">
        <thead>
          <tr>
            <th>Сотрудник</th>
            <th>Роль</th>
            <th>Организации</th>
            <th>Статус</th>
          </tr>
        </thead>
        <tbody>
          ${
            rows ||
            '<tr><td colspan="4" class="muted">Список пуст — нажмите «Добавить сотрудника».</td></tr>'
          }
        </tbody>
      </table>
    </div>
    <details class="staff-advanced">
      <summary>Матрица доступов</summary>
      <div class="role-legend" style="margin-top:4px">
        <div class="muted" style="margin-bottom:6px;font-size:12px">Что даёт роль (по умолчанию):</div>
        ${roleLegend || '<span class="muted">—</span>'}
      </div>
      <div id="staff-access-matrix-panel" style="margin-top:14px">
        <div style="display:flex;flex-wrap:wrap;gap:10px;align-items:baseline;justify-content:space-between;margin-bottom:8px">
          <div>
            <div style="font-weight:700;font-size:13px">Матрица доступов</div>
            <div class="muted" style="font-size:12px;margin-top:2px">
              Галочка — раздел открыт. Админ всегда со всеми разделами.
            </div>
          </div>
          <span class="muted" id="matrix-msg" style="font-size:12px"></span>
        </div>
        <div class="access-matrix-wrap" id="staff-access-matrix">
          <p class="muted" style="margin:0">Загрузка матрицы…</p>
        </div>
      </div>
    </details>
    <div id="staff-add-modal" class="staff-modal hidden"></div>
    <div id="staff-pass-modal" class="staff-modal hidden"></div>`,
    {
      closable: true,
      toolbar: `
        <button class="primary" type="button" id="staff-add">Добавить сотрудника</button>
        <span class="muted" id="staff-msg"></span>
        <div class="grow"></div>
        <div class="find">
          <input id="staff-q" type="search" placeholder="ФИО / email / логин" value="${esc(q)}" autocomplete="off" />
          <button type="button" class="find-go" id="staff-search">Найти</button>
        </div>`,
    }
  );
  bindFormChrome(() => showSection('staff'));

  async function loadAccessMatrix() {
    const box = document.getElementById('staff-access-matrix');
    const msg = document.getElementById('matrix-msg');
    if (!box) return;
    try {
      const mx = await api('/staff/access-matrix');
      const cols = mx.sections || sections || Object.keys(SECTION_LABELS);
      const labels = mx.section_labels || SECTION_LABELS;
      const mrows = mx.rows || [];
      if (!mrows.length) {
        box.innerHTML = '<p class="muted" style="margin:0">Нет сотрудников для матрицы.</p>';
        return;
      }
      const head = cols.map((s) => accessMatrixHeadCell(s, labels)).join('');
      const body = mrows
        .map((r) => {
          const set = new Set(r.sections || []);
          const cells = cols
            .map((s) => {
              const on = r.is_admin || set.has(s);
              const dis = r.is_admin ? 'disabled' : '';
              return `<td class="am-cell">
                <input type="checkbox" class="am-check" data-staff="${esc(r.id)}" data-section="${esc(s)}"
                  ${on ? 'checked' : ''} ${dis} title="${esc(labels[s] || s)}" />
              </td>`;
            })
            .join('');
          return `<tr>
            <th scope="row" class="am-name">
              <div class="fb-title">${esc(formatPersonName(r.name))}</div>
              <div class="muted" style="font-size:11px">${esc(ROLE_LABELS[r.role] || r.role)}${
                r.can_login ? '' : ' · без входа'
              }</div>
            </th>
            ${cells}
          </tr>`;
        })
        .join('');
      box.innerHTML = `
        <table class="access-matrix">
          <thead><tr><th class="am-name">Сотрудник</th>${head}</tr></thead>
          <tbody>${body}</tbody>
        </table>`;
      box.querySelectorAll('.am-check').forEach((cb) => {
        cb.onchange = async () => {
          if (cb.disabled) return;
          cb.disabled = true;
          if (msg) msg.textContent = 'Сохранение…';
          try {
            await api('/staff/access-matrix', {
              method: 'PATCH',
              body: JSON.stringify({
                staff_id: cb.dataset.staff,
                section: cb.dataset.section,
                allowed: cb.checked,
              }),
            });
            if (msg) msg.textContent = 'сохранено';
            // обновить краткий список разделов в таблице сотрудников
            setTimeout(() => {
              if (msg) msg.textContent = '';
            }, 1200);
          } catch (e) {
            cb.checked = !cb.checked;
            if (msg) msg.textContent = e.message;
            alert(e.message);
          } finally {
            cb.disabled = false;
          }
        };
      });
    } catch (e) {
      box.innerHTML = `<p class="error" style="margin:0">${esc(e.message)}</p>`;
    }
  }
  loadAccessMatrix();

  function refreshAddRolePreview() {
    const roleEl = document.getElementById('sa-role');
    if (!roleEl) return;
    const role = roleEl.value;
    const metaR = catalogById[role];
    const desc = document.getElementById('sa-role-desc');
    const prev = document.getElementById('sa-role-preview');
    if (desc) desc.textContent = (metaR && metaR.description) || '';
    if (prev) prev.innerHTML = rightsPreviewHtml((metaR && metaR.rights) || {}, sections);
  }

  function generateStaffPassword(len = 12) {
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%';
    const bytes = new Uint8Array(len);
    crypto.getRandomValues(bytes);
    let out = '';
    for (let i = 0; i < len; i++) out += alphabet[bytes[i] % alphabet.length];
    if (!/[A-Za-z]/.test(out)) out = 'A' + out.slice(1);
    if (!/[0-9]/.test(out)) out = out.slice(0, -1) + '7';
    return out;
  }

  function openStaffAddModal() {
    const modal = document.getElementById('staff-add-modal');
    if (!modal) return;
    modal.classList.remove('hidden');
    modal.innerHTML = `
      <div class="staff-modal-card staff-add-card" role="dialog" aria-labelledby="sa-title">
        <h3 id="sa-title">Новый сотрудник</h3>
        <p class="muted staff-add-lead">Заполните ФИО и роль. Пароль можно сгенерировать — покажите его сотруднику один раз.</p>
        <div class="staff-add-grid">
          <label class="staff-add-wide">ФИО
            <input id="sa-name" required placeholder="Иванов Иван" autocomplete="name" />
          </label>
          <label>Email
            <input id="sa-email" type="email" placeholder="ivan@company.ru" autocomplete="email" />
          </label>
          <label>Логин
            <input id="sa-login" placeholder="необязательно" autocomplete="username" />
          </label>
          <label>Роль
            <select id="sa-role">${roleOptionsHtml('readonly', catalog)}</select>
          </label>
          <label class="staff-add-wide">Пароль
            <div class="staff-pass-row">
              <input id="sa-pass" type="text" placeholder="сгенерировать или ввести" autocomplete="new-password" />
              <button type="button" id="sa-gen">Сгенерировать</button>
            </div>
          </label>
          <label class="staff-check staff-add-wide">
            <input type="checkbox" id="sa-login-ok" checked />
            Разрешить вход в систему
          </label>
        </div>
        <p class="muted" id="sa-role-desc"></p>
        <div id="sa-role-preview"></div>
        <p class="error hidden" id="sa-err"></p>
        <div class="staff-add-actions">
          <button type="button" id="sa-cancel">Отмена</button>
          <button type="button" class="primary" id="sa-save">Создать сотрудника</button>
        </div>
      </div>`;
    refreshAddRolePreview();
    document.getElementById('sa-role').onchange = refreshAddRolePreview;
    document.getElementById('sa-gen').onclick = () => {
      document.getElementById('sa-pass').value = generateStaffPassword();
    };
    document.getElementById('sa-cancel').onclick = () => modal.classList.add('hidden');
    modal.onclick = (e) => {
      if (e.target === modal) modal.classList.add('hidden');
    };
    document.getElementById('sa-save').onclick = async () => {
      const err = document.getElementById('sa-err');
      err.classList.add('hidden');
      const name = document.getElementById('sa-name').value.trim();
      if (!name) {
        err.textContent = 'Укажите ФИО';
        err.classList.remove('hidden');
        return;
      }
      const body = {
        name,
        email: document.getElementById('sa-email').value.trim(),
        login: document.getElementById('sa-login').value.trim(),
        role: document.getElementById('sa-role').value,
        can_login: document.getElementById('sa-login-ok').checked,
        password: document.getElementById('sa-pass').value.trim() || undefined,
      };
      const saveBtn = document.getElementById('sa-save');
      saveBtn.disabled = true;
      try {
        await api('/staff', { method: 'POST', body: JSON.stringify(body) });
        modal.classList.add('hidden');
        renderStaff();
      } catch (e) {
        err.textContent = e.message;
        err.classList.remove('hidden');
        saveBtn.disabled = false;
      }
    };
    document.getElementById('sa-name').focus();
  }

  document.getElementById('staff-add').onclick = () => openStaffAddModal();

  const qInput = document.getElementById('staff-q');
  const runStaffSearch = () => {
    state.staffQ = (qInput && qInput.value.trim()) || '';
    renderStaff();
  };
  document.getElementById('staff-search').onclick = runStaffSearch;
  if (qInput) {
    qInput.onkeydown = (e) => {
      if (e.key === 'Enter') runStaffSearch();
    };
  }

  view.querySelectorAll('[data-staff-open]').forEach((el) => {
    el.onclick = (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      const id = el.getAttribute('data-staff-open');
      if (!id) return;
      state.staffFocusId = id;
      state.staffCardTab = 'sections';
      renderStaff();
    };
  });
}

const routes = {
  dashboard: renderDashboard,
  'settings-stats': renderSettingsStats,
  products: () => {
    state.productsPage = 1;
    renderProducts();
  },
  'cat-tree': renderCategoryTree,
  'media-photos': renderMediaPhotos,
  props: renderProps,
  marks: renderMarks,
  brands: renderBrands,
  prices: renderPriceTypes,
  warehouses: renderWarehouses,
  'product-units': () => {
    state.unitsPage = 1;
    renderProductUnits();
  },
  counterparties: () => {
    state.cpPage = 1;
    state.cpQ = state.cpMode === '' ? state.cpQ : '';
    renderCounterparties('');
  },
  suppliers: () => {
    state.cpPage = 1;
    state.cpQ = '';
    renderCounterparties('supplier');
  },
  buyers: () => {
    state.cpPage = 1;
    state.cpQ = '';
    renderCounterparties('buyer');
  },
  balances: () => {
    // Не сбрасываем balWh — его задаёт URL / клик по складу
    state.balPage = 1;
    renderBalances();
  },
  'stock-valuation': () => {
    state.valPage = 1;
    renderStockValuation();
  },
  docs: () => {
    state.docsType = 'out';
    state.docsPage = 1;
    renderDocs();
  },
  in: renderIn,
  'in-new': renderInCreate,
  'out-new': renderOutCreate,
  invoices: () => {
    state.salesPage = 1;
    renderSalesDocs('invoice');
  },
  workorders: () => {
    state.salesPage = 1;
    renderSalesDocs('workorder');
  },
  upd: () => {
    state.salesPage = 1;
    renderSalesDocs('upd');
  },
  sf: () => {
    state.salesPage = 1;
    renderSalesDocs('sf');
  },
  contracts: () => {
    state.salesPage = 1;
    renderSalesDocs('contract');
  },
  'contract-new': renderContractCreate,
  org: renderOrgProfile,
  'phone-settings': renderPhoneSettings,
  'payment-link-settings': renderPaymentLinkSettings,
  'settings-cdek': renderCdekSettings,
  'settings-atol': renderAtolSettings,
  'settings-yandex-pay': renderYandexPaySettings,
  'settings-tochka': renderTochkaSettings,
  'settings-dadata': renderDadataSettings,
  'settings-deepseek': renderDeepseekSettings,
  'settings-amo': renderAmoSettings,
  ideas: renderIdeas,
  staff: renderStaff,
  audit: renderAudit,
  presence: renderPresence,
  kassa: renderKassa,
  marking: renderMarking,
  'wh-tasks': renderWarehouseTasks,
  'wh-kpd': renderWarehouseKpd,
  'ops-dash': renderOpsDash,
  income: renderIncomeMirror,
  currencies: renderCurrencies,
  deals: () => {
    state.dealsPage = 1;
    renderDeals();
  },
  pipelines: renderPipelines,
};

async function renderOpsDash() {
  let ops;
  try {
    ops = await api('/ops/dashboard');
  } catch (e) {
    view.innerHTML = formChrome('Дашборд склада', `<p class="error">${esc(e.message)}</p>`);
    bindFormChrome(() => showSection('warehouse'));
    return;
  }
  const wh = ops.warehouse || {};
  const queue = ops.queue || [];
  const blocked = ops.blocked || [];
  const stockVal = ops.stock_value || {};
  view.innerHTML = formChrome(
    'Дашборд склада',
    `
    <div class="home-stats">
      <span>Новые<b>${wh.new || 0}</b></span>
      <span>Сборка<b>${wh.picking || 0}</b></span>
      <span>Упаковано<b>${wh.packed || 0}</b></span>
      <span>К выдаче<b>${wh.ready || 0}</b></span>
      <span>Выдано сегодня<b>${wh.handed_today || 0}</b></span>
      <span>Блок оплаты<b>${wh.blocked_unpaid || 0}</b></span>
      <span>Доход сегодня<b>${formatMoney((ops.income_today && ops.income_today.sum) || 0)}</b></span>
      <span title="${esc(stockVal.method_note || 'FIFO по приходам')}">Закуп FIFO<b>${formatMoney(stockVal.total_value || 0)}</b></span>
      <span title="qty × Розничная цена">Розница склад<b>${formatMoney(stockVal.total_value_retail || 0)}</b></span>
    </div>
    <div class="panel" style="margin:12px 0">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap">
        <div>
          <div style="font-size:12px;color:var(--muted,#888)">Стоимость склада · FIFO закуп / розница</div>
          <div style="font-size:22px;font-weight:700;margin-top:4px">
            ${formatMoney(stockVal.total_value || 0)}
            <span class="muted" style="font-size:16px;font-weight:500"> / ${formatMoney(stockVal.total_value_retail || 0)}</span>
          </div>
          <div class="muted" style="margin-top:4px;font-size:12px">
            ${esc(stockVal.method_note || 'Не себестоимость 1С')}
            ${
              stockVal.lines_without_price
                ? ` · без цены: ${esc(stockVal.lines_without_price)} поз.`
                : ''
            }
            ${
              stockVal.total_value_last_purchase != null &&
              Math.abs(Number(stockVal.total_value_last_purchase) - Number(stockVal.total_value || 0)) > 0.01
                ? ` · было (посл. закуп): ${formatMoney(stockVal.total_value_last_purchase)}`
                : ''
            }
          </div>
        </div>
        <button class="primary" type="button" id="od-valuation">Открыть отчёт</button>
      </div>
    </div>
    <div class="toolbar" style="margin:12px 0">
      <button class="primary" type="button" id="od-tasks">Задания склада</button>
      <button type="button" id="od-kpd">КПД / тайминги</button>
      <button type="button" id="od-income">Доход</button>
      <button type="button" id="od-reload">Обновить</button>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
      <div class="panel">
        <h3 style="margin:0 0 8px;font-size:13px">Очередь</h3>
        <table>
          <thead><tr><th>№</th><th>Город</th><th>Канал</th><th>Статус</th><th>Сумма</th></tr></thead>
          <tbody>
            ${
              queue.length
                ? queue
                    .map(
                      (t) => `<tr class="clickable" data-task="${esc(t.id)}">
                      <td class="mono">${esc(t.number)}</td>
                      <td>${esc(t.city || '—')}</td>
                      <td>${esc(t.channel_label || t.channel)}</td>
                      <td>${esc(t.status_label || t.status)}</td>
                      <td class="mono">${formatMoney(t.amount_locked)}</td>
                    </tr>`
                    )
                    .join('')
                : '<tr><td colspan="5" class="muted">Очередь пуста</td></tr>'
            }
          </tbody>
        </table>
      </div>
      <div class="panel">
        <h3 style="margin:0 0 8px;font-size:13px">Блок оплаты → отгрузка</h3>
        <table>
          <thead><tr><th>№</th><th>Сделка</th><th>Город</th><th>Сумма</th></tr></thead>
          <tbody>
            ${
              blocked.length
                ? blocked
                    .map(
                      (t) => `<tr class="clickable" data-task="${esc(t.id)}">
                      <td class="mono">${esc(t.number)}</td>
                      <td class="mono">${esc(t.deal_id)}</td>
                      <td>${esc(t.city || '—')}</td>
                      <td class="mono">${formatMoney(t.amount_locked)}</td>
                    </tr>`
                    )
                    .join('')
                : '<tr><td colspan="4" class="muted">Нет заблокированных</td></tr>'
            }
          </tbody>
        </table>
      </div>
    </div>`
  );
  bindFormChrome(() => showSection('warehouse'));
  document.getElementById('od-tasks').onclick = () => openTab('wh-tasks');
  const odKpd = document.getElementById('od-kpd');
  if (odKpd) odKpd.onclick = () => openTab('wh-kpd');
  document.getElementById('od-income').onclick = () => openTab('income');
  document.getElementById('od-valuation').onclick = () => openTab('stock-valuation');
  document.getElementById('od-reload').onclick = () => renderOpsDash();
  view.querySelectorAll('[data-task]').forEach((tr) => {
    tr.onclick = () => {
      state.whTaskFocus = tr.dataset.task;
      openTab('wh-tasks');
    };
  });
}

async function renderIncomeMirror() {
  const q = state.incomeQ || '';
  let rows = [];
  try {
    const qs = new URLSearchParams({ limit: '100' });
    if (q) qs.set('q', q);
    rows = await api('/ops/income?' + qs.toString());
  } catch (e) {
    view.innerHTML = formChrome('Доход (зеркало)', `<p class="error">${esc(e.message)}</p>`);
    bindFormChrome(() => showSection('money'));
    return;
  }
  view.innerHTML = formChrome(
    'Доход (зеркало)',
    `
    <div class="panel">
      <p class="muted" style="margin:0 0 10px">
        Локальное зеркало «Доход» — запись отключена (в таблицы льёт 1С, Учёт ничего не пишет).
      </p>
      <div class="toolbar">
        <input type="search" id="inc-q" placeholder="Сделка / клиент / трек" value="${esc(q)}" style="min-width:220px" />
        <button type="button" class="find-go" id="inc-search">Найти</button>
        <button type="button" id="inc-reload">Обновить</button>
      </div>
    </div>
    <table>
      <thead><tr><th>Дата</th><th>Сделка</th><th>Клиент</th><th>Город</th><th>Канал</th><th>Сумма</th><th>Трек</th><th>Заметка</th></tr></thead>
      <tbody>
        ${
          rows.length
            ? rows
                .map(
                  (r) => `<tr>
                  <td class="mono">${esc(r.created_at || '')}</td>
                  <td class="mono">${esc(r.deal_id)}</td>
                  <td>${esc(r.buyer_name || '—')}</td>
                  <td>${esc(r.city || '—')}</td>
                  <td>${esc(r.channel || '—')}</td>
                  <td class="mono">${formatMoney(r.amount)}</td>
                  <td class="mono">${esc(r.track_number || '—')}</td>
                  <td>${esc(r.note || '')}</td>
                </tr>`
                )
                .join('')
            : '<tr><td colspan="8" class="muted">Пусто: запись в зеркало отключена (доход пишут 1С / Google Sheets «Доход», Учёт сюда не дублирует). Смотрите живые книги в Sheets или банк.</td></tr>'
        }
      </tbody>
    </table>`
  );
  bindFormChrome(() => showSection('money'));
  const reload = () => renderIncomeMirror();
  document.getElementById('inc-reload').onclick = reload;
  document.getElementById('inc-search').onclick = () => {
    state.incomeQ = document.getElementById('inc-q').value.trim();
    reload();
  };
  document.getElementById('inc-q').onkeydown = (e) => {
    if (e.key === 'Enter') document.getElementById('inc-search').click();
  };
}

function fmtMin(n) {
  if (n == null || n === '') return '—';
  const v = Number(n);
  if (!Number.isFinite(v)) return '—';
  if (v < 60) return v + ' мин';
  const h = Math.floor(v / 60);
  const m = Math.round(v % 60);
  return h + ' ч ' + m + ' мин';
}

async function renderWarehouseKpd() {
  const days = state.whKpdDays || 14;
  let data;
  try {
    data = await api('/warehouse/tasks/kpd?days=' + encodeURIComponent(days) + '&limit=200');
  } catch (e) {
    view.innerHTML = formChrome('КПД склада', `<p class="error">${esc(e.message)}</p>`);
    bindFormChrome(() => showSection('warehouse'));
    return;
  }
  const st = data.stages || {};
  const stageRow = (label, s) => {
    const x = s || {};
    return `<tr>
      <td>${esc(label)}</td>
      <td class="mono">${esc(x.count || 0)}</td>
      <td class="mono">${esc(fmtMin(x.avg_min))}</td>
      <td class="mono">${esc(fmtMin(x.p50_min))}</td>
      <td class="mono">${esc(fmtMin(x.p90_min))}</td>
    </tr>`;
  };
  view.innerHTML = formChrome(
    'КПД склада',
    `
    <div class="panel">
      <div class="toolbar">
        <label>Дней<select id="kpd-days">
          ${[7, 14, 30, 60]
            .map((d) => `<option value="${d}" ${d === Number(days) ? 'selected' : ''}>${d}</option>`)
            .join('')}
        </select></label>
        <button type="button" id="kpd-reload">Обновить</button>
        <button type="button" id="kpd-tasks">Задания</button>
        <span class="muted">Выдано за период: <b>${esc(data.sample_size || 0)}</b></span>
      </div>
    </div>
    <table>
      <thead><tr><th>Этап</th><th>N</th><th>Среднее</th><th>P50</th><th>P90</th></tr></thead>
      <tbody>
        ${stageRow('Создание → сборка', st.created_to_picked)}
        ${stageRow('Сборка → упаковка', st.picked_to_packed)}
        ${stageRow('Упаковка → выдача', st.packed_to_handed)}
        ${stageRow('Полный цикл', st.created_to_handed)}
      </tbody>
    </table>
    <h3 style="margin:16px 0 8px;font-size:13px;color:var(--taxi-green)">По дням</h3>
    <table>
      <thead><tr><th>День</th><th>Выдано</th><th>Средний цикл</th></tr></thead>
      <tbody>
        ${
          (data.by_day || []).length
            ? (data.by_day || [])
                .map(
                  (d) => `<tr>
                  <td class="mono">${esc(d.day)}</td>
                  <td class="mono">${esc(d.handed)}</td>
                  <td class="mono">${esc(fmtMin(d.avg_cycle_min))}</td>
                </tr>`
                )
                .join('')
            : '<tr><td colspan="3" class="muted">Пока нет выданных заданий с метками — прогоните статусы на заданиях.</td></tr>'
        }
      </tbody>
    </table>
    <h3 style="margin:16px 0 8px;font-size:13px;color:var(--taxi-green)">Последние выдачи</h3>
    <table>
      <thead><tr><th>№</th><th>Город</th><th>Создано</th><th>Сборка</th><th>Упаковка</th><th>Выдача</th><th>Цикл</th></tr></thead>
      <tbody>
        ${
          (data.items || []).length
            ? (data.items || [])
                .slice(0, 40)
                .map(
                  (t) => `<tr class="clickable" data-task="${esc(t.id)}">
                  <td class="mono">${esc(t.number)}</td>
                  <td>${esc(t.city || '—')}</td>
                  <td class="mono">${esc(String(t.created_at || '').slice(0, 16))}</td>
                  <td class="mono">${esc(String(t.picked_at || '').slice(0, 16) || '—')}</td>
                  <td class="mono">${esc(String(t.packed_at || '').slice(0, 16) || '—')}</td>
                  <td class="mono">${esc(String(t.handed_at || '').slice(0, 16) || '—')}</td>
                  <td class="mono">${esc(fmtMin(t.min_full_cycle))}</td>
                </tr>`
                )
                .join('')
            : '<tr><td colspan="7" class="muted">Нет данных</td></tr>'
        }
      </tbody>
    </table>`
  );
  bindFormChrome(() => showSection('warehouse'));
  document.getElementById('kpd-reload').onclick = () => {
    state.whKpdDays = Number(document.getElementById('kpd-days').value) || 14;
    renderWarehouseKpd();
  };
  document.getElementById('kpd-days').onchange = () => document.getElementById('kpd-reload').click();
  document.getElementById('kpd-tasks').onclick = () => openTab('wh-tasks');
  view.querySelectorAll('[data-task]').forEach((tr) => {
    tr.onclick = () => {
      state.whTaskFocus = tr.dataset.task;
      openTab('wh-tasks');
    };
  });
}

async function renderCurrencies() {
  let data;
  try {
    data = await api('/currencies/catalog');
  } catch (e) {
    view.innerHTML = formChrome('Валюты', `<p class="error">${esc(e.message)}</p>`);
    bindFormChrome(() => showSection('money'));
    return;
  }
  const curs = data.currencies || [];
  const rates = data.rates || [];
  const modes = data.rate_modes || [];
  const modeLabel = (id) => (modes.find((m) => m.id === id) || {}).label || id || '—';
  const focus = state.curFocus || '';
  const focusCur = curs.find((c) => c.code === focus) || null;
  const history = focus
    ? rates.filter((r) => r.base_code === focus || r.quote_code === focus)
    : rates.filter((r) => r.quote_code === 'RUB');
  const fmtRate = (n) => {
    const x = Number(n);
    if (!(x > 0)) return '—';
    return x.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 4 });
  };
  const latestRub = (code) => {
    const row = rates.find((r) => r.base_code === code && r.quote_code === 'RUB');
    return row ? fmtRate(row.rate) : '—';
  };

  view.innerHTML = formChrome(
    'Валюты',
    `
    <div class="panel">
      <p class="muted" style="margin:0 0 10px">${esc(data.note || '')}</p>
      <div class="toolbar">
        <button class="primary" type="button" id="cur-cbr">Обновить курсы ЦБ</button>
        <span class="muted" id="cur-msg"></span>
      </div>
    </div>
    <h3 style="margin:12px 0 8px;font-size:13px;color:var(--taxi-green)">Справочник</h3>
    <table>
      <thead><tr><th>Код</th><th>Название</th><th>Символ</th><th>ISO</th><th>Режим курса</th><th>Курс к ₽</th></tr></thead>
      <tbody>
        ${
          curs.length
            ? curs
                .map((c) => {
                  const disp = c.alt_code ? `${c.code} / ${c.alt_code}` : c.code;
                  return `<tr class="clickable ${c.code === focus ? 'active' : ''}" data-cur="${esc(c.code)}">
                  <td class="mono"><b>${esc(disp)}</b></td>
                  <td>${esc(c.name)}</td>
                  <td>${esc(c.symbol)}</td>
                  <td class="mono">${esc(c.numeric_code)}</td>
                  <td>${esc(modeLabel(c.rate_mode))}</td>
                  <td class="mono">${c.code === 'RUB' ? '1' : latestRub(c.code)}</td>
                </tr>`;
                })
                .join('')
            : '<tr><td colspan="6" class="muted">Пусто</td></tr>'
        }
      </tbody>
    </table>

    ${
      focusCur
        ? `<div class="panel" style="margin-top:16px" id="cur-card">
      <h3 style="margin:0 0 8px;font-size:13px">Карточка ${esc(focusCur.code)}${focusCur.alt_code ? ' / ' + esc(focusCur.alt_code) : ''}</h3>
      <div class="form-grid">
        <label>Наименование<input id="cur-name" value="${esc(focusCur.name)}" /></label>
        <label>Символ<input id="cur-symbol" class="mono" value="${esc(focusCur.symbol)}" /></label>
        <label>Цифровой код<input id="cur-num" class="mono" value="${esc(focusCur.numeric_code)}" /></label>
        <label>Альт. код (RMB)<input id="cur-alt" class="mono" value="${esc(focusCur.alt_code || '')}" /></label>
        <label>Режим курса
          <select id="cur-mode">
            ${modes
              .map(
                (m) =>
                  `<option value="${esc(m.id)}" ${m.id === focusCur.rate_mode ? 'selected' : ''}>${esc(m.label)}</option>`
              )
              .join('')}
          </select>
        </label>
        <label>Связь с валютой<input id="cur-linked" class="mono" placeholder="USD" value="${esc(focusCur.linked_code || '')}" /></label>
        <label>Наценка %<input id="cur-markup" class="mono" type="number" step="0.01" value="${esc(focusCur.linked_markup_pct || 0)}" /></label>
        <label>Формула<input id="cur-formula" class="mono" placeholder="USD * 1.02" value="${esc(focusCur.formula || '')}" /></label>
      </div>
      <h4 style="margin:12px 0 6px;font-size:12px;color:var(--muted)">Параметры прописи</h4>
      <div class="form-grid">
        <label>1 / 2 / 5 (целое)
          <div style="display:flex;gap:6px">
            <input id="cur-su1" value="${esc(focusCur.spell_unit_1 || '')}" placeholder="рубль" />
            <input id="cur-su2" value="${esc(focusCur.spell_unit_2 || '')}" placeholder="рубля" />
            <input id="cur-su5" value="${esc(focusCur.spell_unit_5 || '')}" placeholder="рублей" />
          </div>
        </label>
        <label>1 / 2 / 5 (дробная)
          <div style="display:flex;gap:6px">
            <input id="cur-sf1" value="${esc(focusCur.spell_frac_1 || '')}" placeholder="копейка" />
            <input id="cur-sf2" value="${esc(focusCur.spell_frac_2 || '')}" placeholder="копейки" />
            <input id="cur-sf5" value="${esc(focusCur.spell_frac_5 || '')}" placeholder="копеек" />
          </div>
        </label>
      </div>
      <div class="toolbar" style="margin-top:10px">
        <button class="primary" type="button" id="cur-save-card">Сохранить карточку</button>
        <button type="button" id="cur-close-card">Закрыть</button>
      </div>
    </div>`
        : ''
    }

    <h3 style="margin:16px 0 8px;font-size:13px;color:var(--taxi-green)">История курсов${focus ? ' · ' + esc(focus) : ' · к ₽'}</h3>
    <p class="muted" style="margin:0 0 8px;font-size:12px">Курсы ЦБ подтягиваются автоматически. Кнопка — обновить сейчас.</p>
    <table>
      <thead><tr><th>Дата</th><th>База</th><th>Котировка</th><th>Курс</th><th>Источник</th></tr></thead>
      <tbody>
        ${
          history.length
            ? history
                .map(
                  (r) => `<tr>
                  <td class="mono">${esc(r.rate_date)}</td>
                  <td class="mono">${esc(r.base_code)}</td>
                  <td class="mono">${esc(r.quote_code)}</td>
                  <td class="mono">${esc(fmtRate(r.rate))}</td>
                  <td>${esc(r.source)}</td>
                </tr>`
                )
                .join('')
            : '<tr><td colspan="5" class="muted">Нет курсов</td></tr>'
        }
      </tbody>
    </table>`
  );
  bindFormChrome(() => showSection('money'));
  refreshHeaderRates(data.header);

  const setMsg = (t) => {
    const el = document.getElementById('cur-msg');
    if (el) el.textContent = t || '';
  };

  view.querySelectorAll('[data-cur]').forEach((tr) => {
    tr.onclick = () => {
      state.curFocus = tr.dataset.cur;
      renderCurrencies();
    };
  });
  const closeCard = document.getElementById('cur-close-card');
  if (closeCard) {
    closeCard.onclick = () => {
      state.curFocus = '';
      renderCurrencies();
    };
  }
  const saveCard = document.getElementById('cur-save-card');
  if (saveCard && focusCur) {
    saveCard.onclick = async () => {
      try {
        await api('/currencies/' + encodeURIComponent(focusCur.code), {
          method: 'PUT',
          body: JSON.stringify({
            name: document.getElementById('cur-name').value.trim(),
            symbol: document.getElementById('cur-symbol').value.trim(),
            numeric_code: document.getElementById('cur-num').value.trim(),
            alt_code: document.getElementById('cur-alt').value.trim(),
            rate_mode: document.getElementById('cur-mode').value,
            linked_code: document.getElementById('cur-linked').value.trim(),
            linked_markup_pct: Number(document.getElementById('cur-markup').value) || 0,
            formula: document.getElementById('cur-formula').value.trim(),
            spell_unit_1: document.getElementById('cur-su1').value.trim(),
            spell_unit_2: document.getElementById('cur-su2').value.trim(),
            spell_unit_5: document.getElementById('cur-su5').value.trim(),
            spell_frac_1: document.getElementById('cur-sf1').value.trim(),
            spell_frac_2: document.getElementById('cur-sf2').value.trim(),
            spell_frac_5: document.getElementById('cur-sf5').value.trim(),
          }),
        });
        setMsg('Карточка сохранена');
        renderCurrencies();
      } catch (e) {
        setMsg(e.message);
      }
    };
  }

  const syncCbr = async () => {
    setMsg('Обновление курсов ЦБ…');
    try {
      const r = await api('/currencies/rates/sync-cbr', {
        method: 'POST',
        body: JSON.stringify({}),
      });
      setMsg(r.message || 'OK');
      refreshHeaderRates(r.header);
      renderCurrencies();
    } catch (e) {
      setMsg(e.message);
    }
  };
  document.getElementById('cur-cbr').onclick = () => syncCbr();
}

function refreshHeaderRates(header) {
  const el = document.getElementById('header-rates');
  if (!el) return;
  const items = (header && header.items) || [];
  const parts = items
    .filter((i) => i.rate != null)
    .map((i) => {
      const n = Number(i.rate).toLocaleString('ru-RU', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      });
      const sym = i.symbol || i.display || i.code;
      return `<span class="header-rate"><b>${esc(sym)}</b> ${n}</span>`;
    });
  el.innerHTML = parts.length ? parts.join('<span class="header-rate-sep">·</span>') : '';
  el.hidden = !parts.length;
}

async function loadHeaderRatesOnce() {
  try {
    const h = await api('/currencies/header');
    refreshHeaderRates(h);
  } catch (_) {
    /* ignore */
  }
}

async function renderWarehouseTasks() {
  const q = state.whTasksQ || '';
  const status = state.whTasksStatus || '';
  let meta = { status_labels: {}, channel_labels: {} };
  let tasks = [];
  try {
    const qs = new URLSearchParams({ limit: '100' });
    if (q) qs.set('q', q);
    if (status) qs.set('status', status);
    [meta, tasks] = await Promise.all([
      api('/warehouse/tasks/meta'),
      api('/warehouse/tasks?' + qs.toString()),
    ]);
  } catch (e) {
    view.innerHTML = formChrome('Задания склада', `<p class="error">${esc(e.message)}</p>`);
    bindFormChrome(() => showSection('warehouse'));
    return;
  }

  const statusOpts =
    '<option value="">Все активные</option>' +
    (meta.statuses || ['new', 'picking', 'packed', 'ready', 'handed'])
      .map(
        (s) =>
          `<option value="${esc(s)}" ${s === status ? 'selected' : ''}>${esc(
            (meta.status_labels && meta.status_labels[s]) || s
          )}</option>`
      )
      .join('');

  const focusId = state.whTaskFocus || '';
  let detail = null;
  if (focusId) {
    try {
      detail = await api('/warehouse/tasks/' + focusId);
    } catch {
      detail = null;
    }
  }

  view.innerHTML = formChrome(
    'Задания склада',
    `
    <div class="panel">
      <p class="muted" style="margin:0 0 10px">
        Очередь сборки / упаковки / выдачи курьеру. Шлюз: «Передано» только после оплаты (кроме наложки/самовывоза).
      </p>
      <div class="toolbar">
        <input type="search" id="wt-q" placeholder="Номер / город / клиент / штрихкод" value="${esc(q)}" style="min-width:220px" />
        <select id="wt-status">${statusOpts}</select>
        <button type="button" class="find-go" id="wt-search">Найти</button>
        <button type="button" id="wt-reload">Обновить</button>
        <button type="button" id="wt-kpd">КПД</button>
        <input id="wt-scan" class="mono" placeholder="Скан выдачи (штрихкод)" style="min-width:180px" />
        <button class="primary" type="button" id="wt-scan-go">Передано курьеру</button>
        <span class="muted" id="wt-msg"></span>
      </div>
    </div>

    <div style="display:grid;grid-template-columns:1fr ${detail ? 'minmax(280px,380px)' : '0fr'};gap:16px">
      <div>
        <table>
          <thead><tr><th>№</th><th>Клиент / маршрут</th><th>Город</th><th>Канал</th><th>Коммент</th><th>Сумма</th><th>Оплата</th><th>Статус</th><th>Позиций</th></tr></thead>
          <tbody>
            ${
              tasks.length
                ? tasks
                    .map((t) => {
                      const stLabel =
                        (meta.status_labels && meta.status_labels[t.status]) || t.status;
                      const chLabel =
                        (meta.channel_labels && meta.channel_labels[t.channel]) || t.channel;
                      const who =
                        t.channel === 'transfer'
                          ? t.buyer_name || 'Перемещение'
                          : t.deal_id || t.buyer_name || '—';
                      const cmt = String(t.comment || '').trim();
                      return `<tr class="clickable ${t.id === focusId ? 'active' : ''}" data-task="${esc(t.id)}">
                        <td class="mono">${esc(t.number)}</td>
                        <td>${esc(who)}</td>
                        <td>${esc(t.city || '—')}</td>
                        <td>${esc(chLabel)}</td>
                        <td title="${esc(cmt)}">${esc(cmt ? (cmt.length > 48 ? cmt.slice(0, 48) + '…' : cmt) : '—')}</td>
                        <td class="mono">${formatMoney(t.amount_locked)}</td>
                        <td>${t.payment_required ? 'нужна' : 'нет'}</td>
                        <td>${esc(stLabel)}</td>
                        <td class="mono">${esc(t.lines_count || 0)}</td>
                      </tr>`;
                    })
                    .join('')
                : '<tr><td colspan="9" class="muted">Нет заданий — из заказа («На склад») или заказ на перемещение с остатков.</td></tr>'
            }
          </tbody>
        </table>
      </div>
      ${
        detail
          ? `<div class="panel" style="align-self:start">
        <h3 style="margin:0 0 8px;font-size:13px;color:var(--taxi-green)">${esc(detail.number)}</h3>
        <p class="muted" style="margin:0 0 8px">
          ${esc(detail.status_label)} · ${esc(detail.channel_label)}<br>
          ${esc(detail.buyer_name || '')} · ${esc(detail.city || '')}<br>
          ${
            detail.channel === 'inbound'
              ? `Заказ <span class="mono">${esc(detail.stock_doc_id || '—')}</span> · склад ${esc(detail.city || '—')}<br>`
              : detail.channel === 'return'
                ? `<b>Возврат</b> · сделка <span class="mono">${esc(detail.deal_id || '—')}</span> · склад ${esc(detail.city || '—')}${
                    detail.amount_locked
                      ? ' · компенсация ' + esc(formatMoney(detail.amount_locked))
                      : ''
                  }<br>`
                : detail.channel === 'transfer'
                  ? `Документ <span class="mono">${esc(detail.stock_doc_id || '—')}</span><br>`
                  : `Сделка <span class="mono">${esc(detail.deal_id)}</span><br>`
          }
          ${detail.comment ? `Коммент: ${esc(detail.comment)}<br>` : ''}
          Штрихкод <span class="mono">${esc(detail.barcode)}</span><br>
          ${
            detail.channel === 'inbound'
              ? ''
              : `Оплата: ${detail.is_paid ? 'да' : detail.payment_required ? 'нет' : 'не требуется'}
          ${detail.can_hand ? '' : ' · <b>выдача заблокирована</b>'}<br>`
          }
          <span class="muted" style="font-size:11px">
            создано ${esc(String(detail.created_at || '').slice(0, 16) || '—')}
            · сборка ${esc(String(detail.picked_at || '').slice(0, 16) || '—')}
            · упак. ${esc(String(detail.packed_at || '').slice(0, 16) || '—')}
            · выдача ${esc(String(detail.handed_at || '').slice(0, 16) || '—')}
          </span>
        </p>
        <table><thead><tr><th>SKU</th><th>Название</th><th>Кол-во</th></tr></thead><tbody>
          ${(detail.lines || [])
            .map(
              (l) =>
                `<tr><td class="mono">${esc(l.sku)}</td><td>${esc(l.name)}</td><td class="mono">${esc(l.qty)}</td></tr>`
            )
            .join('')}
        </tbody></table>
        <div class="toolbar" style="flex-wrap:wrap;margin-top:10px">
          ${
            detail.channel === 'inbound' || detail.channel === 'return'
              ? `<a class="primary" id="wt-inbound-scan" href="/in/scan?v=dm11&task=${encodeURIComponent(
                  detail.id
                )}" target="_blank" rel="noopener">${
                  detail.channel === 'return' ? 'Скан · принять возврат' : 'Скан · оприходовать'
                }</a>`
              : ''
          }
          <button type="button" data-st="picking">Сборка</button>
          <button type="button" data-st="packed">Упаковано</button>
          <button type="button" data-st="ready">К выдаче</button>
          <button class="primary" type="button" data-st="handed" ${detail.can_hand ? '' : 'disabled'}>Передано</button>
          <button type="button" id="wt-slip">Лист упаковки</button>
          ${
            detail.cdek_widget_url
              ? `<button type="button" id="wt-cdek">СДЭК оформить</button>`
              : ''
          }
          ${
            detail.cdek_native
              ? `<button type="button" id="wt-cdek-sync">Подтянуть трек</button>`
              : ''
          }
          <button type="button" id="wt-close-detail">Закрыть</button>
        </div>
        <label style="display:block;margin-top:8px">Трек СДЭК
          <input id="wt-track" class="mono" value="${esc(detail.track_number || '')}" placeholder="из виджета или вручную" />
        </label>
        <div id="wt-cdek-meta" class="muted" style="font-size:12px;margin-top:4px"></div>
        <span class="muted" id="wt-detail-msg"></span>
      </div>`
          : ''
      }
    </div>`
  );

  bindFormChrome(() => showSection('warehouse'));
  const reload = () => renderWarehouseTasks();
  document.getElementById('wt-reload').onclick = reload;
  const wtKpd = document.getElementById('wt-kpd');
  if (wtKpd) wtKpd.onclick = () => openTab('wh-kpd');
  document.getElementById('wt-search').onclick = () => {
    state.whTasksQ = document.getElementById('wt-q').value.trim();
    state.whTasksStatus = document.getElementById('wt-status').value;
    reload();
  };
  document.getElementById('wt-q').onkeydown = (e) => {
    if (e.key === 'Enter') document.getElementById('wt-search').click();
  };
  view.querySelectorAll('[data-task]').forEach((tr) => {
    tr.onclick = () => {
      state.whTaskFocus = tr.dataset.task;
      reload();
    };
  });
  document.getElementById('wt-scan-go').onclick = async () => {
    const msg = document.getElementById('wt-msg');
    try {
      const r = await api('/warehouse/tasks/scan-hand', {
        method: 'POST',
        body: JSON.stringify({ barcode: document.getElementById('wt-scan').value }),
      });
      msg.textContent = 'Передано: ' + (r.number || '');
      document.getElementById('wt-scan').value = '';
      state.whTaskFocus = r.id;
      setTimeout(reload, 300);
    } catch (e) {
      msg.textContent = e.message;
    }
  };
  if (detail) {
    const dmsg = document.getElementById('wt-detail-msg');
    view.querySelectorAll('[data-st]').forEach((btn) => {
      btn.onclick = async () => {
        try {
          await api('/warehouse/tasks/' + detail.id + '/status', {
            method: 'PATCH',
            body: JSON.stringify({
              status: btn.dataset.st,
              track_number: document.getElementById('wt-track')?.value || undefined,
            }),
          });
          reload();
        } catch (e) {
          dmsg.textContent = e.message;
        }
      };
    });
    document.getElementById('wt-close-detail').onclick = () => {
      state.whTaskFocus = '';
      reload();
    };
    const cdekBtn = document.getElementById('wt-cdek');
    if (cdekBtn && detail.cdek_widget_url) {
      cdekBtn.onclick = () => window.open(detail.cdek_widget_url, '_blank', 'noopener');
    }
    const cdekSync = document.getElementById('wt-cdek-sync');
    const cdekMeta = document.getElementById('wt-cdek-meta');
    const fillCdekMeta = (cdek) => {
      if (!cdekMeta || !cdek) return;
      const parts = [];
      if (cdek.cdek_number) parts.push('трек ' + cdek.cdek_number);
      if (cdek.cdek_status_name) parts.push(cdek.cdek_status_name);
      if (cdek.cdek_barcode_url) {
        parts.push(
          `<a href="${esc(cdek.cdek_barcode_url)}" target="_blank" rel="noopener">ярлык PDF</a>`
        );
      }
      if (!cdek.has_order) parts.push('заказ ещё не оформлен — откройте «СДЭК оформить»');
      if (cdek.error) parts.push(cdek.error);
      cdekMeta.innerHTML = parts.join(' · ') || '';
      if (cdek.cdek_number) {
        const inp = document.getElementById('wt-track');
        if (inp && !inp.value) inp.value = cdek.cdek_number;
      }
    };
    if (detail.cdek_native && detail.deal_id) {
      api('/warehouse/tasks/' + detail.id + '/cdek')
        .then((r) => fillCdekMeta(r.cdek))
        .catch((e) => {
          if (cdekMeta) cdekMeta.textContent = e.message || 'СДЭК недоступен';
        });
    }
    if (cdekSync) {
      cdekSync.onclick = async () => {
        const dmsg = document.getElementById('wt-detail-msg');
        try {
          cdekSync.disabled = true;
          const r = await api('/warehouse/tasks/' + detail.id + '/cdek/sync', {
            method: 'POST',
            body: JSON.stringify({ refresh: true }),
          });
          fillCdekMeta(r.cdek);
          if (r.cdek?.cdek_number) {
            const inp = document.getElementById('wt-track');
            if (inp) inp.value = r.cdek.cdek_number;
          }
          if (dmsg) {
            dmsg.textContent = r.cdek?.cdek_number
              ? 'Трек подтянут: ' + r.cdek.cdek_number
              : r.cdek?.error || 'Нет оформленного заказа СДЭК';
          }
          if (r.cdek?.cdek_number) setTimeout(reload, 400);
        } catch (e) {
          if (dmsg) dmsg.textContent = e.message;
        } finally {
          cdekSync.disabled = false;
        }
      };
    }
    document.getElementById('wt-slip').onclick = async () => {
      try {
        const slip = await api('/warehouse/tasks/' + detail.id + '/slip');
        const w = window.open('', '_blank');
        if (!w) return;
        w.document.write(
          `<html><head><title>${esc(slip.number)}</title>
          <style>body{font-family:sans-serif;padding:24px} table{border-collapse:collapse;width:100%} td,th{border:1px solid #ccc;padding:6px;text-align:left} .mono{font-family:monospace}</style>
          </head><body>
          <h1>Лист упаковки ${esc(slip.number)}</h1>
          <p>Штрихкод: <b class="mono">${esc(slip.barcode)}</b></p>
          <p>Заказ: ${esc(slip.deal_id)} · ${esc(slip.city)} · ${esc(slip.buyer_name)}</p>
          <p>Канал: ${esc(slip.channel)} · Трек: ${esc(slip.track_number || '—')}</p>
          <table><thead><tr><th>SKU</th><th>Название</th><th>Кол-во</th></tr></thead><tbody>
          ${(slip.lines || [])
            .map(
              (l) =>
                `<tr><td class="mono">${esc(l.sku)}</td><td>${esc(l.name)}</td><td>${esc(l.qty)}</td></tr>`
            )
            .join('')}
          </tbody></table>
          <p class="muted">${esc(slip.printed_at || '')}</p>
          <script>window.print()</script>
          </body></html>`
        );
        w.document.close();
      } catch (e) {
        dmsg.textContent = e.message;
      }
    };
  }
}

const MARKING_STAGE_RU = {
  foundation: 'Фундамент',
  stage4_lots: 'Этап 4 · партии',
  stage5_crpt: 'Этап 5 · ЦРПТ',
};
const MARKING_LOT_STATUS_RU = {
  draft: 'Черновик',
  in_transit: 'В пути',
  received: 'Принята',
  closed: 'Закрыта',
};
const MARKING_DM_STATUS_RU = {
  ordered: 'Заказан',
  emitted: 'Эмитирован',
  received: 'Принят',
  aggregated: 'В агрегате',
  in_stock: 'На остатке',
  reserved: 'Резерв',
  sold: 'Продан',
  withdrawn: 'Выведен',
  returned: 'Возврат',
  defect: 'Брак',
};
const MARKING_SCAN_ACTION_RU = {
  receive: 'Приёмка',
  sale: 'Продажа',
  withdraw: 'Вывод',
  return: 'Возврат',
  defect: 'Брак',
};
function markingStageRu(v) {
  return MARKING_STAGE_RU[v] || v || 'Фундамент';
}
function markingLotStatusRu(v) {
  return MARKING_LOT_STATUS_RU[v] || v || '—';
}
function markingDmStatusRu(v) {
  return MARKING_DM_STATUS_RU[v] || v || '—';
}
function markingScanActionRu(v) {
  return MARKING_SCAN_ACTION_RU[v] || v || '';
}

async function renderMarking() {
  await refreshRefs();
  const editable = canEditProducts();
  const q = state.markingQ || '';
  const productFilter = state.markingProductId || '';
  let meta = { counts: {}, crpt: {}, stage: 'foundation' };
  let lots = [];
  let codes = [];
  try {
    const qs = new URLSearchParams({ limit: '80' });
    if (q) qs.set('q', q);
    if (productFilter) qs.set('product_id', productFilter);
    [meta, lots, codes] = await Promise.all([
      api('/marking/meta'),
      api('/lots?' + qs.toString()),
      api('/marking/codes?' + qs.toString()),
    ]);
  } catch (e) {
    view.innerHTML = formChrome('Маркировка / партии', `<p class="error">${esc(e.message)}</p>`);
    bindFormChrome(() => showSection('warehouse'));
    return;
  }

  const whOpts =
    '<option value="">— склад —</option>' +
    state.warehouses
      .map((w) => `<option value="${esc(w.id)}">${esc(w.name)}</option>`)
      .join('');

  const counts = meta.counts || {};
  view.innerHTML = formChrome(
    'Маркировка / партии',
    `
    <div class="panel">
      <p class="muted" style="margin:0 0 10px">
        <b>Откуда марки:</b> из <button type="button" class="linkish" id="mk-goto-so">заказа поставщику</button>
        (закупка) — или из <button type="button" class="linkish" id="mk-goto-in">приходной накладной</button>,
        если приходуете без заказа (там генерация и печать).
      </p>
      <p class="muted" style="margin:0 0 10px">
        Этап: <b>${esc(markingStageRu(meta.stage))}</b>
        · партий <b>${counts.lots ?? 0}</b>
        · кодов <b>${counts.codes ?? 0}</b>
        · на остатке <b>${counts.in_stock ?? 0}</b>
        · выведено <b>${counts.withdrawn ?? 0}</b>
        · ЦРПТ: ${meta.crpt && meta.crpt.configured ? 'настроен' : 'локальный учёт (Этап 5 позже)'}
      </p>
      <p class="muted" style="margin:0 0 10px">
        Наклейка партии: <span class="mono">артикул;завод;партия;дата</span>
        · DataMatrix сканируется в поле ниже.
      </p>
      <div class="toolbar">
        <input type="search" id="mk-q" placeholder="Поиск: партия / артикул / код" value="${esc(q)}" style="min-width:220px" />
        <button type="button" class="find-go" id="mk-search">Найти</button>
        ${productFilter ? `<button type="button" id="mk-clear-prod">Сбросить фильтр товара</button>` : ''}
        <button type="button" id="mk-reload">Обновить</button>
      </div>
    </div>

    ${
      editable
        ? `
    <h3 style="margin:16px 0 8px;font-size:13px;color:var(--taxi-green)">Новая партия</h3>
    <div class="form-grid">
      <label>Артикул товара<input id="mk-lot-sku" class="mono" placeholder="артикул" autocomplete="off" /></label>
      <label>Номер партии<input id="mk-lot-num" class="mono" placeholder="номер партии" autocomplete="off" /></label>
      <label>Завод<input id="mk-lot-factory" autocomplete="off" /></label>
      <label>Дата произв.<input id="mk-lot-date" type="date" /></label>
      <label>Склад<select id="mk-lot-wh">${whOpts}</select></label>
      <label>План, шт<input id="mk-lot-qty" type="number" min="0" step="1" value="0" /></label>
      <label>GTIN<input id="mk-lot-gtin" class="mono" placeholder="необязательно" /></label>
    </div>
    <div class="toolbar">
      <button class="primary" type="button" id="mk-lot-add">Создать партию</button>
      <span class="muted" id="mk-lot-msg"></span>
    </div>

    <h3 style="margin:16px 0 8px;font-size:13px;color:var(--taxi-green)">Скан DataMatrix</h3>
    <div class="form-grid">
      <label style="grid-column:1/-1">Код / наклейка<textarea id="mk-scan-code" rows="2" class="mono" placeholder="скан или артикул;завод;партия;дата"></textarea></label>
      <label>Действие
        <select id="mk-scan-action">
          <option value="receive">Приёмка</option>
          <option value="sale">Продажа</option>
          <option value="withdraw">Вывод</option>
          <option value="return">Возврат</option>
          <option value="defect">Брак</option>
        </select>
      </label>
      <label>Артикул (для первой приёмки)<input id="mk-scan-sku" class="mono" placeholder="если код новый" /></label>
      <label>ID партии<input id="mk-scan-lot" class="mono" placeholder="необязательно" /></label>
      <label>Склад<select id="mk-scan-wh">${whOpts}</select></label>
      <label>Сделка Amo<input id="mk-scan-deal" class="mono" placeholder="для продажи" /></label>
    </div>
    <div class="toolbar">
      <button class="primary" type="button" id="mk-scan-go">Сканировать</button>
      <button type="button" id="mk-parse-label">Разобрать наклейку</button>
      <span class="muted" id="mk-scan-msg"></span>
    </div>`
        : '<p class="muted">Создание партий и скан — нужны права «Редактировать номенклатуру».</p>'
    }

    <h3 style="margin:16px 0 8px;font-size:13px;color:var(--taxi-green)">Партии (${lots.length})</h3>
    <table>
      <thead><tr><th>Дата</th><th>Партия</th><th>Товар</th><th>Завод</th><th>Склад</th><th>Статус</th><th>План</th><th>Принято</th></tr></thead>
      <tbody>
        ${
          lots.length
            ? lots
                .map(
                  (l) => `<tr class="clickable" data-product="${esc(l.product_id)}">
                    <td class="mono">${esc(l.production_date || l.arrived_at || '—')}</td>
                    <td class="mono" title="${esc(l.id)}">${esc(l.lot_number)}</td>
                    <td>${esc(l.product_sku || '')} ${esc(l.product_name || '')}</td>
                    <td>${esc(l.factory || '—')}</td>
                    <td>${esc(l.warehouse_name || '—')}</td>
                    <td>${esc(markingLotStatusRu(l.status))}</td>
                    <td class="mono">${esc(l.qty_planned)}</td>
                    <td class="mono">${esc(l.qty_received)}</td>
                  </tr>`
                )
                .join('')
            : '<tr><td colspan="8" class="muted">Партий пока нет.</td></tr>'
        }
      </tbody>
    </table>

    <h3 style="margin:16px 0 8px;font-size:13px;color:var(--taxi-green)">Коды DataMatrix (${codes.length})</h3>
    <table>
      <thead><tr><th>Код</th><th>Товар</th><th>Статус</th><th>GTIN</th><th>Партия</th><th>Сделка</th><th>Скан</th></tr></thead>
      <tbody>
        ${
          codes.length
            ? codes
                .map(
                  (c) => `<tr>
                    <td class="mono" style="max-width:220px;overflow:hidden;text-overflow:ellipsis" title="${esc(c.code)}">${esc(String(c.code || '').slice(0, 36))}</td>
                    <td class="mono">${esc(c.product_sku || c.product_id || '')}</td>
                    <td>${esc(markingDmStatusRu(c.status))}</td>
                    <td class="mono">${esc(c.gtin || '—')}</td>
                    <td class="mono">${esc((c.lot_id || '').slice(0, 8) || '—')}</td>
                    <td class="mono">${esc(c.deal_id || '—')}</td>
                    <td class="mono">${esc(String(c.scanned_at || '').replace('T', ' ').slice(0, 19) || '—')}</td>
                  </tr>`
                )
                .join('')
            : '<tr><td colspan="7" class="muted">Кодов пока нет — сделайте скан приёмки.</td></tr>'
        }
      </tbody>
    </table>`
  );

  bindFormChrome(() => showSection('warehouse'));
  document.getElementById('mk-goto-so')?.addEventListener('click', () => openTab('parity-supplier-orders'));
  document.getElementById('mk-goto-in')?.addEventListener('click', () => openTab('in-new'));

  const reload = () => renderMarking();
  document.getElementById('mk-reload').onclick = reload;
  document.getElementById('mk-search').onclick = () => {
    state.markingQ = document.getElementById('mk-q').value.trim();
    reload();
  };
  document.getElementById('mk-q').onkeydown = (e) => {
    if (e.key === 'Enter') document.getElementById('mk-search').click();
  };
  const clearProd = document.getElementById('mk-clear-prod');
  if (clearProd) {
    clearProd.onclick = () => {
      state.markingProductId = '';
      reload();
    };
  }
  view.querySelectorAll('[data-product]').forEach((tr) => {
    tr.onclick = () => openTab('product:' + tr.dataset.product);
  });

  async function resolveProductIdBySku(sku) {
    const s = String(sku || '').trim();
    if (!s) return '';
    const data = await api('/products?q=' + encodeURIComponent(s) + '&limit=20');
    const items = data.items || data || [];
    const list = Array.isArray(items) ? items : [];
    const exact = list.find((p) => String(p.sku || '').toLowerCase() === s.toLowerCase());
    return (exact || list[0] || {}).id || '';
  }

  const lotAdd = document.getElementById('mk-lot-add');
  if (lotAdd) {
    lotAdd.onclick = async () => {
      const msg = document.getElementById('mk-lot-msg');
      lotAdd.disabled = true;
      msg.textContent = '…';
      try {
        const productId = await resolveProductIdBySku(document.getElementById('mk-lot-sku').value);
        if (!productId) throw new Error('Товар по SKU не найден');
        await api('/lots', {
          method: 'POST',
          body: JSON.stringify({
            product_id: productId,
            lot_number: document.getElementById('mk-lot-num').value,
            factory: document.getElementById('mk-lot-factory').value,
            production_date: document.getElementById('mk-lot-date').value,
            warehouse_id: document.getElementById('mk-lot-wh').value,
            qty_planned: Number(document.getElementById('mk-lot-qty').value) || 0,
            gtin: document.getElementById('mk-lot-gtin').value,
            status: 'draft',
          }),
        });
        msg.textContent = 'Создано';
        setTimeout(reload, 300);
      } catch (e) {
        msg.textContent = e.message;
        lotAdd.disabled = false;
      }
    };
  }

  const parseBtn = document.getElementById('mk-parse-label');
  if (parseBtn) {
    parseBtn.onclick = async () => {
      const raw = document.getElementById('mk-scan-code').value.trim();
      const msg = document.getElementById('mk-scan-msg');
      try {
        const parsed = await api('/marking/parse-label?raw=' + encodeURIComponent(raw));
        if (parsed.sku) document.getElementById('mk-scan-sku').value = parsed.sku;
        msg.textContent = `Наклейка: ${parsed.sku || '—'} / ${parsed.factory || '—'} / ${parsed.lot || '—'} / ${parsed.date || '—'}`;
        if (parsed.sku && document.getElementById('mk-lot-sku')) {
          document.getElementById('mk-lot-sku').value = parsed.sku;
          if (parsed.lot) document.getElementById('mk-lot-num').value = parsed.lot;
          if (parsed.factory) document.getElementById('mk-lot-factory').value = parsed.factory;
          if (parsed.date) document.getElementById('mk-lot-date').value = parsed.date;
        }
      } catch (e) {
        msg.textContent = e.message;
      }
    };
  }

  const scanGo = document.getElementById('mk-scan-go');
  if (scanGo) {
    scanGo.onclick = async () => {
      const msg = document.getElementById('mk-scan-msg');
      const code = document.getElementById('mk-scan-code').value.trim();
      const action = document.getElementById('mk-scan-action').value;
      scanGo.disabled = true;
      msg.textContent = '…';
      try {
        let productId = '';
        const sku = document.getElementById('mk-scan-sku').value.trim();
        if (sku) productId = await resolveProductIdBySku(sku);
        const body = {
          code,
          action,
          product_id: productId || undefined,
          lot_id: document.getElementById('mk-scan-lot').value.trim() || undefined,
          warehouse_id: document.getElementById('mk-scan-wh').value || undefined,
          deal_id: document.getElementById('mk-scan-deal').value.trim() || undefined,
        };
        const r = await api('/marking/scan', { method: 'POST', body: JSON.stringify(body) });
        msg.textContent = `${markingScanActionRu(action)}: ${r.created ? 'новый код' : 'обновлён'} → ${markingDmStatusRu(r.code?.status)}`;
        document.getElementById('mk-scan-code').value = '';
        setTimeout(reload, 400);
      } catch (e) {
        msg.textContent = e.message;
        scanGo.disabled = false;
      }
    };
  }
}

async function renderPresence() {
  if (!isAdminMe()) {
    view.innerHTML = formChrome(
      'Кто в системе',
      '<p class="error">Доступно только администраторам.</p>'
    );
    bindFormChrome(() => showSection('settings'));
    return;
  }
  let data;
  try {
    data = await api('/presence/online');
  } catch (e) {
    view.innerHTML = formChrome('Кто в системе', `<p class="error">${esc(e.message)}</p>`);
    bindFormChrome(() => showSection('settings'));
    return;
  }
  const items = data.items || [];
  view.innerHTML = formChrome(
    'Кто в системе',
    `
    <div class="panel">
      <div class="toolbar">
        <button type="button" id="presence-reload">Обновить</button>
      </div>
    </div>
    <div class="panel presence-table-wrap">
      ${
        items.length
          ? `<table class="presence-table">
              <thead>
                <tr>
                  <th>Кто</th>
                  <th>Роль</th>
                  <th>Раздел</th>
                  <th>Экран</th>
                  <th>IP</th>
                  <th>ОС / браузер</th>
                  <th>Регион</th>
                  <th>Устройство</th>
                  <th>Активность</th>
                </tr>
              </thead>
              <tbody>
                ${items
                  .map(
                    (u) => `<tr>
                      <td>${esc(u.actor_name || '—')}</td>
                      <td class="muted">${esc(u.role || '—')}</td>
                      <td>${esc(presenceSectionRu(u.section))}</td>
                      <td>${esc(u.title || '—')}</td>
                      <td class="mono">${esc(u.client_ip || '—')}</td>
                      <td class="muted">${esc([u.os, u.browser].filter((x) => x && x !== '—').join(' · ') || '—')}</td>
                      <td class="muted">${esc(u.region || '—')}</td>
                      <td class="muted">${esc(u.device || '—')}</td>
                      <td class="mono">${esc(formatPresenceAgo(u.seconds_ago))}</td>
                    </tr>`
                  )
                  .join('')}
              </tbody>
            </table>`
          : '<p class="muted">Сейчас никого нет (или heartbeat ещё не успел прийти).</p>'
      }
    </div>`,
    { closable: true }
  );
  bindFormChrome(() => showSection('settings'));
  document.getElementById('presence-reload').onclick = () => renderPresence();
}

async function renderKassa() {
  if (!(state.organizations || []).length) {
    try { await refreshRefs(); } catch (_) { /* ignore */ }
  }
  const tab = state.kassaTab === 'journal' ? 'journal' : 'registers';
  const q = state.kassaQ || '';
  const page = state.kassaPage || 1;
  const day = state.kassaDay || '';
  const source = state.kassaSource || 'all';
  const limit = getPageSize('kassa', 50);
  const selectedReg = state.kassaRegisterId || '';
  const orgFilter = String(state.kassaOrgId || '').trim();

  let overview;
  try {
    const qs = new URLSearchParams();
    withCompanyId(qs);
    if (orgFilter) qs.set('organization_id', orgFilter);
    overview = await api('/kassa/overview?' + qs.toString());
  } catch (e) {
    view.innerHTML = formChrome('Касса', `<p class="error">${esc(e.message)}</p>`);
    bindFormChrome(() => showSection('kassa'));
    return;
  }

  const health = overview.health || {};
  const atolH = health.atol || {};
  const fiscalH = health.fiscal || {};
  const ofdH = health.ofd || {};
  const tochkaH = health.tochka || {};
  const registers = overview.registers || [];
  const totals = overview.totals || {};

  const healthChip = (ok, label, detail, opts) => {
    const cls = ok === true ? 'ok' : ok === false ? 'bad' : 'warn';
    const action = opts && opts.action ? String(opts.action) : '';
    const hint = opts && opts.hint ? String(opts.hint) : '';
    const title = [detail, hint].filter(Boolean).join(' · ');
    const hintHtml = hint
      ? `<span class="kassa-health-hint">${esc(hint)}</span>`
      : '';
    const inner = `
      <span class="kassa-health-dot"></span>
      <div>
        <div class="kassa-health-label">${esc(label)}</div>
        <div class="kassa-health-detail">${esc(detail || '')}</div>
        ${hintHtml}
      </div>`;
    if (action) {
      return `<button type="button" class="kassa-health-chip ${cls}" data-health-action="${esc(action)}" title="${esc(title)}">${inner}</button>`;
    }
    return `<div class="kassa-health-chip ${cls}" title="${esc(detail || '')}">${inner}</div>`;
  };

  let atolDetail = 'не проверено';
  let atolOk = null;
  if (!atolH.configured) {
    atolOk = false;
    atolDetail = 'нет login / pass / группы';
  } else if (atolH.token_ok === true) {
    atolOk = true;
    atolDetail = atolH.message || 'токен OK';
  } else if (atolH.token_ok === false) {
    atolOk = false;
    atolDetail = atolH.message || 'ошибка токена';
  }

  const fiscalDetail = `7д: ${fiscalH.done || 0} ок · ${fiscalH.wait || 0} в очереди · ${fiscalH.error || 0} ошибок`;
  const fiscalOk =
    Number(fiscalH.error || 0) > 0 ? false : Number(fiscalH.total || 0) > 0 ? true : null;

  let tochkaOk = null;
  let tochkaDetail = 'не проверено';
  if (!tochkaH.configured) {
    tochkaOk = false;
    tochkaDetail = 'ключ моста не задан';
  } else if (tochkaH.bridge_ok === true) {
    tochkaOk = true;
    tochkaDetail = tochkaH.message || 'мост OK';
  } else if (tochkaH.bridge_ok === false) {
    tochkaOk = false;
    tochkaDetail = tochkaH.message || 'ошибка моста';
  } else {
    tochkaDetail = 'ключ моста задан';
  }

  const kindLabelReg = (k) =>
    k === 'operating' ? 'Операционная' : k === 'cash' ? 'Наличная' : k || 'Касса';

  const healthHtml = `
    <div class="kassa-health">
      ${healthChip(atolOk, 'АТОЛ', atolDetail, {
        action: 'probe-atol',
        hint: 'нажмите — проверить',
      })}
      ${healthChip(fiscalOk, 'Чеки', fiscalDetail)}
      ${healthChip(null, 'ОФД', ofdH.note || 'через АТОЛ, без прямого баланса')}
      ${healthChip(tochkaOk, 'Точка / СБП', tochkaDetail, {
        action: 'probe-tochka',
        hint: 'нажмите — проверить',
      })}
    </div>`;

  let bodyHtml = '';

  if (tab === 'registers') {
    const selected = registers.find((r) => r.id === selectedReg);
    const orgSelect =
      `<label class="muted" style="display:flex;align-items:center;gap:6px">Юрлицо
        <select id="kassa-org-filter">
          <option value="">Все юрлица${getFilterCompanyId() ? ' контура' : ''}</option>
          ${(state.organizations || [])
            .map(
              (o) =>
                `<option value="${esc(o.id)}" ${o.id === orgFilter ? 'selected' : ''}>${esc(
                  o.short_name || o.name
                )}</option>`
            )
            .join('')}
        </select>
      </label>`;
    bodyHtml = `
      ${healthHtml}
      <div class="toolbar" style="margin:0 0 12px;flex-wrap:wrap;gap:8px">
        ${orgSelect}
        <button type="button" class="primary" id="kassa-add-reg">Новая касса</button>
        <button type="button" id="kassa-open-dict">Справочник касс</button>
      </div>
      <div class="kassa-reg-grid">
        ${
          registers.length
            ? registers
                .map((r) => {
                  const active = r.id === selectedReg ? 'active' : '';
                  const muted = Number(r.is_active) === 0 ? 'is-archive' : '';
                  const hasOrg = !!String(r.organization_id || '').trim();
                  const orgLine = hasOrg
                    ? `${esc(r.organization_short || r.organization_name || '')}${
                        r.organization_inn ? ' · ИНН ' + esc(r.organization_inn) : ''
                      }`
                    : '<span class="error">без юрлица</span>';
                  return `<button type="button" class="kassa-reg-card ${active} ${muted}${
                    hasOrg ? '' : ' needs-org'
                  }" data-reg="${esc(r.id)}">
                    <div class="kassa-reg-name">${esc(r.name)}</div>
                    <div class="kassa-reg-kind muted">${esc(kindLabelReg(r.kind))}${Number(r.is_active) === 0 ? ' · архив' : ''}</div>
                    <div class="kassa-reg-org muted" title="${esc(r.organization_name || '')}">${orgLine}</div>
                    <div class="kassa-reg-bal mono">${esc(formatMoney(r.balance))}</div>
                    <div class="kassa-reg-meta muted">Документов: ${esc(r.docs_count || 0)}</div>
                  </button>`;
                })
                .join('')
            : '<p class="muted">Касс пока нет — создайте с привязкой к юрлицу.</p>'
        }
      </div>
      <p class="muted" style="margin:10px 0 0">Всего по кассам: <b>${esc(formatMoney(overview.balance_total || 0))}</b>
        · чеков: ${esc(totals.fiscal || 0)} · оплат СБП: ${esc(totals.payment || 0)} · ссылок: ${esc(totals.pay_link || 0)}</p>
      <p class="muted" style="margin:8px 0 0">Каждая касса привязана к организации (юрлицу). Контур в шапке фильтрует список. Приходы/расходы денег — в банке (Точка / СБП).</p>
      ${
        selected
          ? `<div class="panel" style="margin-top:14px">
              <strong>${esc(selected.name)}</strong>
              <div class="muted" style="margin-top:4px">${
                selected.organization_id
                  ? esc(selected.organization_short || selected.organization_name || '') +
                    (selected.organization_inn ? ' · ИНН ' + esc(selected.organization_inn) : '')
                  : 'Юрлицо не указано'
              }</div>
              <div class="toolbar" style="margin-top:10px;gap:8px">
                <label class="muted" style="display:flex;align-items:center;gap:6px">Юрлицо
                  <select id="kassa-bind-org">${orgOptionsHtml(selected.organization_id || '')}</select>
                </label>
                <button type="button" class="primary" id="kassa-bind-save">Сохранить привязку</button>
              </div>
              <span class="muted" id="kassa-bind-msg" style="margin-left:8px"></span>
            </div>`
          : ''
      }`;
  } else {
    const qs = new URLSearchParams();
    qs.set('page', String(page));
    qs.set('limit', String(limit));
    if (q) qs.set('q', q);
    if (day) qs.set('day', day);
    if (source && source !== 'all') qs.set('source', source);
    let data;
    try {
      data = await api('/kassa/journal?' + qs.toString());
    } catch (e) {
      view.innerHTML = formChrome('Касса', `<p class="error">${esc(e.message)}</p>`);
      bindFormChrome(() => showSection('kassa'));
      return;
    }
    const items = data.items || [];
    const jTotals = data.totals || totals;
    const sourceLabel = (s) =>
      s === 'fiscal'
        ? 'Чек АТОЛ'
        : s === 'payment'
          ? 'Оплата СБП'
          : s === 'pay_link'
            ? 'Ссылка оплаты'
            : s;
    const kindLabel = (src, subtype) => {
      if (src === 'fiscal') {
        const m = {
          advance: 'Предоплата',
          full: 'Полный',
          refund: 'Возврат',
          refund_advance: 'Возврат предоплаты',
        };
        return m[subtype] || subtype;
      }
      if (src === 'payment') {
        if (subtype === 'sbp_qr') return 'QR СБП';
        return subtype || '—';
      }
      if (src === 'pay_link') {
        const m = { pending: 'Ожидает', paid: 'Оплачена', expired: 'Истекла', cancelled: 'Отменена' };
        return m[subtype] || subtype;
      }
      return subtype || '—';
    };
    const statusLabel = (_src, status) => {
      const st = String(status || '').toLowerCase();
      if (['paid', 'confirmed', 'success', 'accepted'].includes(st)) return 'Оплачен';
      if (st === 'notstarted' || st === 'created') return 'Ожидает';
      if (st === 'cancelled' || st === 'canceled') return 'Отменён';
      if (st === 'expired') return 'Истёк';
      if (st === 'error') return 'Ошибка';
      if (st === 'done' || st === 'ready' || st === 'ok') return 'Готово';
      if (st === 'wait' || st === 'sent' || st === 'prepared') return 'В обработке';
      return status || '—';
    };
    const pages = Math.max(1, Math.ceil((Number(data.total) || 0) / limit));
    bodyHtml = `
      ${healthHtml}
      <div class="panel">
        <p class="muted" style="margin:0 0 10px">
          История чеков АТОЛ, оплат СБП и ссылок на оплату.
          Чеков: <b>${esc(jTotals.fiscal || 0)}</b>
          · оплат: <b>${esc(jTotals.payment || 0)}</b>
          · ссылок: <b>${esc(jTotals.pay_link || 0)}</b>
          · сумма оплаченных СБП: <b>${esc(formatMoney(jTotals.amount_paid || 0))}</b>
        </p>
        <div class="toolbar" style="flex-wrap:wrap;gap:8px">
          <input type="search" id="kassa-q" placeholder="Сделка / статус / QR / токен" value="${esc(q)}" style="min-width:220px" />
          <label class="muted" style="display:flex;align-items:center;gap:6px">
            День
            <input type="date" id="kassa-day" value="${esc(day)}" />
          </label>
          <label class="muted" style="display:flex;align-items:center;gap:6px">
            Тип
            <select id="kassa-source">
              <option value="all" ${source === 'all' ? 'selected' : ''}>Все</option>
              <option value="fiscal" ${source === 'fiscal' ? 'selected' : ''}>Чеки АТОЛ</option>
              <option value="payment" ${source === 'payment' ? 'selected' : ''}>Оплаты СБП</option>
              <option value="pay_link" ${source === 'pay_link' ? 'selected' : ''}>Ссылки на оплату</option>
            </select>
          </label>
          <button type="button" id="kassa-reload">Обновить</button>
        </div>
      </div>
      ${pagerHtml('kassapager', page, pages, data.total || 0, { limit, listKey: 'kassa' })}
      <div class="table-scroll">
        <table class="data-table is-dense">
          <thead>
            <tr>
              <th>Дата</th>
              <th>Источник</th>
              <th>Вид</th>
              <th>Статус</th>
              <th>Сумма</th>
              <th>Сделка</th>
              <th>Детали</th>
            </tr>
          </thead>
          <tbody>
            ${
              items.length
                ? items
                    .map((r) => {
                      const dealTitle = r.deal_name || r.deal_id || '—';
                      return `<tr class="${r.deal_id ? 'kassa-row' : ''}" data-deal="${esc(r.deal_id || '')}" style="${r.deal_id ? 'cursor:pointer' : ''}">
                <td class="mono">${esc(formatDealDate(r.created_at) || String(r.created_at || '').slice(0, 16))}</td>
                <td>${esc(sourceLabel(r.source))}</td>
                <td>${esc(kindLabel(r.source, r.subtype))}</td>
                <td>${esc(statusLabel(r.source, r.status))}</td>
                <td class="mono">${formatMoney(r.amount)}</td>
                <td>${r.deal_id ? `<a href="#" class="kassa-deal" data-deal="${esc(r.deal_id)}">${esc(dealTitle)}</a>` : esc(dealTitle)}</td>
                <td class="mono" style="max-width:220px;overflow:hidden;text-overflow:ellipsis" title="${esc(r.detail)}">${esc(String(r.detail || '').slice(0, 48))}</td>
              </tr>`;
                    })
                    .join('')
                : '<tr><td colspan="7" class="muted">Пока пусто — пробьёте чек или создадите ссылку на оплату, записи появятся здесь.</td></tr>'
            }
          </tbody>
        </table>
      </div>
      ${pagerHtml('kassapager2', page, pages, data.total || 0, { limit, listKey: 'kassa' })}`;
  }

  view.innerHTML = formChrome('Касса', bodyHtml, {
    pageTabs: [
      { id: 'registers', label: 'Кассы' },
      { id: 'journal', label: 'Журнал' },
    ],
    activePageTab: tab,
  });
  bindFormChrome(() => showSection('kassa'));

  view.querySelectorAll('[data-pagetab]').forEach((btn) => {
    btn.onclick = () => {
      state.kassaTab = btn.dataset.pagetab === 'journal' ? 'journal' : 'registers';
      renderKassa();
    };
  });

  async function probeAtolNow(triggerEl) {
    const chip = view.querySelector('[data-health-action="probe-atol"]');
    const targets = [chip, triggerEl].filter(Boolean);
    targets.forEach((el) => {
      el.disabled = true;
      el.classList.add('is-busy');
    });
    if (chip) {
      const detail = chip.querySelector('.kassa-health-detail');
      const hint = chip.querySelector('.kassa-health-hint');
      if (detail) detail.textContent = 'проверка…';
      if (hint) hint.textContent = 'ждём ответ АТОЛ';
    }
    try {
      await api('/settings/integrations/atol/test', { method: 'POST', body: '{}' });
    } catch {
      /* overview after reload shows status */
    }
    try {
      const qs = new URLSearchParams({ force_atol: '1' });
      withCompanyId(qs);
      if (orgFilter) qs.set('organization_id', orgFilter);
      await api('/kassa/overview?' + qs.toString());
    } catch {
      /* ignore — render reloads */
    }
    renderKassa();
  }

  async function probeTochkaNow(triggerEl) {
    const chip = view.querySelector('[data-health-action="probe-tochka"]');
    const targets = [chip, triggerEl].filter(Boolean);
    targets.forEach((el) => {
      el.disabled = true;
      el.classList.add('is-busy');
    });
    if (chip) {
      const detail = chip.querySelector('.kassa-health-detail');
      const hint = chip.querySelector('.kassa-health-hint');
      if (detail) detail.textContent = 'проверка…';
      if (hint) hint.textContent = 'ждём ответ Точки';
    }
    try {
      const qs = new URLSearchParams({ force_tochka: '1' });
      withCompanyId(qs);
      if (orgFilter) qs.set('organization_id', orgFilter);
      await api('/kassa/overview?' + qs.toString());
    } catch {
      /* ignore — render reloads */
    }
    renderKassa();
  }

  view.querySelectorAll('[data-health-action="probe-atol"]').forEach((el) => {
    el.addEventListener('click', () => probeAtolNow(el));
  });
  view.querySelectorAll('[data-health-action="probe-tochka"]').forEach((el) => {
    el.addEventListener('click', () => probeTochkaNow(el));
  });

  view.querySelectorAll('.kassa-reg-card').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-reg') || '';
      state.kassaRegisterId = state.kassaRegisterId === id ? '' : id;
      state.kassaTab = 'registers';
      renderKassa();
    });
  });

  document.getElementById('kassa-org-filter')?.addEventListener('change', (e) => {
    state.kassaOrgId = String(e.target?.value || '').trim();
    state.kassaRegisterId = '';
    renderKassa();
  });
  document.getElementById('kassa-open-dict')?.addEventListener('click', () => {
    openTab('cash-registers');
  });
  document.getElementById('kassa-add-reg')?.addEventListener('click', () => {
    openCreateLightbox({
      title: 'Новая касса',
      submitLabel: 'Создать',
      bodyHtml: `
        <div class="form-fields">
          <div class="field span-2"><span>Название</span><input id="kr-name" /></div>
          <div class="field"><span>Вид</span>
            <select id="kr-kind">
              <option value="cash">Наличная</option>
              <option value="operating">Операционная</option>
            </select>
          </div>
          <div class="field"><span>Юрлицо</span><select id="kr-org">${orgOptionsHtml(
            orgFilter || ''
          )}</select></div>
        </div>`,
      onSubmit: async (root, setMsg) => {
        const name = root.querySelector('#kr-name')?.value?.trim();
        if (!name) throw new Error('Укажите название');
        const organization_id = root.querySelector('#kr-org')?.value || '';
        if (!organization_id) throw new Error('Выберите юрлицо (организацию)');
        setMsg('Создание…');
        await api('/money/cash-registers', {
          method: 'POST',
          body: JSON.stringify({
            name,
            kind: root.querySelector('#kr-kind')?.value || 'cash',
            organization_id,
          }),
        });
        closeCreateLightbox();
        renderKassa();
      },
    });
  });
  document.getElementById('kassa-bind-save')?.addEventListener('click', async () => {
    const reg = registers.find((r) => r.id === selectedReg);
    const msg = document.getElementById('kassa-bind-msg');
    const organization_id = String(document.getElementById('kassa-bind-org')?.value || '').trim();
    if (!reg) return;
    if (!organization_id) {
      if (msg) msg.textContent = 'Выберите юрлицо';
      return;
    }
    try {
      if (msg) msg.textContent = 'Сохранение…';
      await api('/money/cash-registers', {
        method: 'POST',
        body: JSON.stringify({
          id: reg.id,
          name: reg.name,
          kind: reg.kind,
          organization_id,
          is_active: reg.is_active,
        }),
      });
      if (msg) msg.textContent = 'Сохранено';
      renderKassa();
    } catch (e) {
      if (msg) msg.textContent = e.message || String(e);
    }
  });

  if (tab === 'journal') {
    const reload = () => renderKassa();
    document.getElementById('kassa-reload')?.addEventListener('click', reload);
    const qEl = document.getElementById('kassa-q');
    if (qEl) {
      qEl.onkeydown = (ev) => {
        if (ev.key === 'Enter') {
          state.kassaQ = qEl.value.trim();
          state.kassaPage = 1;
          reload();
        }
      };
    }
    const dayEl = document.getElementById('kassa-day');
    if (dayEl) {
      dayEl.onchange = () => {
        state.kassaDay = dayEl.value;
        state.kassaPage = 1;
        reload();
      };
    }
    const srcEl = document.getElementById('kassa-source');
    if (srcEl) {
      srcEl.onchange = () => {
        state.kassaSource = srcEl.value;
        state.kassaPage = 1;
        reload();
      };
    }
    view.querySelectorAll('.kassa-deal').forEach((el) => {
      el.addEventListener('click', (ev) => {
        const id = el.getAttribute('data-deal');
        if (!id) return;
        ev.preventDefault();
        ev.stopPropagation();
        openTab('deal:' + id);
      });
    });
    view.querySelectorAll('tr.kassa-row').forEach((tr) => {
      tr.addEventListener('click', () => {
        const id = tr.getAttribute('data-deal');
        if (id) openTab('deal:' + id);
      });
    });
    bindListPager(['kassapager', 'kassapager2'], 'kassa', 'kassaPage', () => renderKassa());
  }
}

async function renderAudit() {
  const q = state.auditQ || '';
  const page = state.auditPage || 1;
  const day = state.auditDay || '';
  const action = state.auditAction || '';
  const actorId = state.auditActorId || '';
  const actorName = state.auditActorName || '';
  const limit = getPageSize('audit', 50);
  const qs = new URLSearchParams();
  qs.set('page', String(page));
  qs.set('limit', String(limit));
  if (q) qs.set('q', q);
  if (day) qs.set('day', day);
  if (action) qs.set('action', action);
  if (actorId) qs.set('actor_id', actorId);
  let data;
  let kpi = null;
  try {
    data = await api('/audit?' + qs.toString());
    try {
      const kpiQs = new URLSearchParams();
      kpiQs.set('days', '14');
      if (actorId) kpiQs.set('actor_id', actorId);
      kpi = await api('/audit/kpi?' + kpiQs.toString());
    } catch {
      kpi = null;
    }
  } catch (e) {
    view.innerHTML = formChrome('История / логи', `<p class="error">${esc(e.message)}</p>`);
    bindFormChrome(() => showSection('settings'));
    return;
  }
  const items = data.items || [];
  const titleExtra = actorName
    ? ` · ${actorName}`
    : actorId
      ? ` · сотрудник`
      : '';
  const kpiRows = (kpi?.by_staff_day || []).slice(0, 12);
  const actionOpts = [
    '',
    'auth.login',
    'auth.logout',
    'auth.login_failed',
    'product.update',
    'product.create',
    'price.change',
    'counterparty.update',
    'warehouse.create',
    'warehouse.archive',
    'staff.update',
    'pick_shift.start',
    'pick_shift.end',
    'photo_shift.start',
    'photo_shift.end',
    'sto_lift_shift.start',
    'sto_lift_shift.end',
    'sto_work_log.create',
    'sync.odata',
  ];
  view.innerHTML = formChrome(
    'История / логи' + titleExtra,
    `
    <div class="panel">
      <p class="muted" style="margin:0 0 10px">
        Полный журнал: кто, что, с какого IP, когда. Это KPI активности сотрудников.
        Всего по фильтру: <b>${data.total ?? 0}</b>
        ${
          kpi
            ? ` · за 14 дн.: <b>${kpi.totals?.actions || 0}</b> действий, <b>${kpi.totals?.people || 0}</b> чел.`
            : ''
        }
      </p>
      <div class="toolbar" style="flex-wrap:wrap;gap:8px">
        <input type="search" id="audit-q" placeholder="Поиск: кто / действие / IP / текст" value="${esc(q)}" style="min-width:220px" />
        <label class="muted" style="display:flex;align-items:center;gap:6px">
          День
          <input type="date" id="audit-day" value="${esc(day)}" />
        </label>
        <label class="muted" style="display:flex;align-items:center;gap:6px">
          Тип
          <select id="audit-action">
            ${actionOpts
              .map(
                (a) =>
                  `<option value="${esc(a)}" ${action === a ? 'selected' : ''}>${esc(
                    a ? auditActionLabel(a) : 'Все действия'
                  )}</option>`
              )
              .join('')}
          </select>
        </label>
        ${
          actorId
            ? `<button type="button" id="audit-clear-staff">Сбросить сотрудника${
                actorName ? ': ' + esc(actorName) : ''
              }</button>`
            : '<span class="muted" style="font-size:12px">Сотрудник: кнопка «история…» в Персонале</span>'
        }
        <button type="button" id="audit-reload">Обновить</button>
      </div>
    </div>
    ${
      kpiRows.length
        ? `<div class="panel">
      <h3 style="margin:0 0 8px;font-size:13px;color:var(--taxi-green)">KPI: действия по сотруднику / дню</h3>
      <table>
        <thead><tr><th>День</th><th>Сотрудник</th><th>Логин</th><th>Действий</th></tr></thead>
        <tbody>
          ${kpiRows
            .map(
              (r) => `<tr class="clickable" data-kpi-staff="${esc(r.actor_id)}" data-name="${esc(r.actor_name || '')}">
                <td class="mono">${esc(r.day)}</td>
                <td>${esc(r.actor_name || '—')}</td>
                <td class="mono muted">${esc(r.actor_login || '—')}</td>
                <td class="mono"><b>${esc(r.actions)}</b></td>
              </tr>`
            )
            .join('')}
        </tbody>
      </table>
    </div>`
        : ''
    }
    <div class="panel">
      ${
        items.length
          ? `<table>
              <thead>
                <tr>
                  <th style="width:140px">Когда</th>
                  <th style="width:160px">Кто</th>
                  <th style="width:110px">IP</th>
                  <th style="width:150px">Действие</th>
                  <th>Что / объект</th>
                </tr>
              </thead>
              <tbody>
                ${items
                  .map(
                    (it) => `
                  <tr>
                    <td class="mono">${esc(String(it.created_at || '').replace('T', ' ').slice(0, 19))}</td>
                    <td>
                      <div>${esc(it.actor_name || '—')}</div>
                      ${it.actor_login ? `<div class="muted mono" style="font-size:11px">${esc(it.actor_login)}</div>` : ''}
                    </td>
                    <td class="mono" style="font-size:11px" title="${esc(it.user_agent || '')}">${esc(it.ip || '—')}</td>
                    <td>${auditActionBadgeHtml(it.action)}</td>
                    <td>
                      <div>${esc(it.summary || '')}</div>
                      ${it.entity ? auditEntityRefHtml(it.entity, it.entity_id) : ''}
                      ${it.path ? `<div class="muted" style="font-size:10px">${esc(it.path)}</div>` : ''}
                    </td>
                  </tr>`
                  )
                  .join('')}
              </tbody>
            </table>
            <div class="pager" id="auditpager">
              <button type="button" data-dir="-1" ${page <= 1 ? 'disabled' : ''} title="Назад">◀</button>
              <span class="muted">${page} / ${data.pages || 1} · ${data.total || 0}</span>
              <button type="button" data-dir="1" ${page >= (data.pages || 1) ? 'disabled' : ''} title="Вперёд">▶</button>
              <label class="pager-size">На стр.
                <select data-pager-limit aria-label="Элементов на странице">
                  ${PAGE_SIZE_OPTS.map(
                    (n) => `<option value="${n}" ${n === limit ? 'selected' : ''}>${n}</option>`
                  ).join('')}
                </select>
              </label>
            </div>`
          : '<p class="muted">Пока пусто — действия появятся после входов и изменений.</p>'
      }
    </div>`,
    { closable: true }
  );
  bindFormChrome(() => showSection('settings'));
  document.getElementById('audit-reload').onclick = () => renderAudit();
  const clearStaff = document.getElementById('audit-clear-staff');
  if (clearStaff) {
    clearStaff.onclick = () => {
      state.auditActorId = '';
      state.auditActorName = '';
      state.auditPage = 1;
      renderAudit();
    };
  }
  view.querySelectorAll('[data-kpi-staff]').forEach((tr) => {
    tr.onclick = () => {
      state.auditActorId = tr.dataset.kpiStaff || '';
      state.auditActorName = tr.dataset.name || '';
      state.auditPage = 1;
      renderAudit();
    };
  });
  const dayEl = document.getElementById('audit-day');
  if (dayEl) {
    dayEl.onchange = () => {
      state.auditDay = dayEl.value || '';
      state.auditPage = 1;
      renderAudit();
    };
  }
  const actEl = document.getElementById('audit-action');
  if (actEl) {
    actEl.onchange = () => {
      state.auditAction = actEl.value || '';
      state.auditPage = 1;
      renderAudit();
    };
  }
  const qEl = document.getElementById('audit-q');
  let t;
  qEl.oninput = () => {
    clearTimeout(t);
    t = setTimeout(() => {
      state.auditQ = qEl.value.trim();
      state.auditPage = 1;
      renderAudit();
    }, 300);
  };
  bindListPager('auditpager', 'audit', 'auditPage', () => renderAudit());
}

async function loadMe() {
  try {
    state.me = await api('/me');
    const el = document.getElementById('taxi-user');
    if (el && state.me) {
      el.textContent = (state.me.name || state.me.login || 'Пользователь') + ' ▾';
      el.title = [state.me.role, state.me.email || state.me.login].filter(Boolean).join(' · ');
    }
    applyNavRights();
    // Кладовщик / курьер — только примитив «задачи на сегодня»
    if (state.me && state.me.picker_only) {
      const p = location.pathname.replace(/\/+$/, '') || '/';
      if (p !== '/pick' && p !== '/pick.html' && !p.startsWith('/warehouse/ops') && !p.startsWith('/warehouse/today') && !p.startsWith('/warehouse/pick') && p !== '/login') {
        location.replace(state.me.home_path || '/pick');
        return;
      }
    }
    // Фотограф — экран /photo и отчёт
    if (state.me && state.me.photographer_only) {
      const p = location.pathname.replace(/\/+$/, '') || '/';
      if (
        p !== '/photo' &&
        p !== '/photo.html' &&
        !p.startsWith('/photo/') &&
        p !== '/media/photo' &&
        p !== '/login'
      ) {
        location.replace(state.me.home_path || '/photo');
        return;
      }
    }
    await loadPhoneSettings();
    await loadBookmarks();
    startPresenceTracking();
    startChatWidget();
    const pBtn = document.getElementById('presence-btn');
    const pPanel = document.getElementById('presence-panel');
    const pWrap = document.getElementById('presence-wrap');
    if (pBtn && pWrap && isAdminMe()) {
      pBtn.hidden = false;
      state._presencePinned = false;
      // Hover = тултип с IP/OS/region; клик = закрепить панель
      pWrap.addEventListener('mouseenter', () => {
        clearTimeout(state._presenceHideTimer);
        showPresencePanel();
      });
      pWrap.addEventListener('mouseleave', () => hidePresencePanel(220));
      pBtn.onclick = (e) => {
        e.stopPropagation();
        if (!pPanel) return;
        if (pPanel.hidden) {
          state._presencePinned = true;
          showPresencePanel();
        } else if (state._presencePinned) {
          state._presencePinned = false;
          pPanel.hidden = true;
        } else {
          state._presencePinned = true;
        }
      };
      document.addEventListener('click', (e) => {
        if (pPanel && !pPanel.hidden && pWrap && !pWrap.contains(e.target)) {
          state._presencePinned = false;
          pPanel.hidden = true;
        }
      });
    }
  } catch {
    /* ignore */
  }
}

document.querySelectorAll('.taxi-sections .sec').forEach((btn) => {
  btn.addEventListener('click', (e) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button === 1) return;
    const sec = btn.dataset.section;
    // React-экраны: не перехватывать — полный переход на SPA
    if (sec === 'chats') {
      location.href = btn.getAttribute('href') || '/chats';
      return;
    }
    e.preventDefault();
    showSection(sec);
  });
});

/** Visible section-name tips for #sections .sec (esp. collapsed 51px rail). Fixed — escapes sidebar overflow. */
(function bindSecRailTips() {
  const nav = document.getElementById('sections');
  if (!nav) return;
  let tip = document.getElementById('sec-rail-tip');
  if (!tip) {
    tip = document.createElement('div');
    tip.id = 'sec-rail-tip';
    tip.className = 'sec-rail-tip';
    tip.setAttribute('role', 'tooltip');
    tip.hidden = true;
    document.body.appendChild(tip);
  }
  let hideTimer = 0;
  let active = null;
  const labelOf = (el) => {
    const lab = el.querySelector('.sec-label');
    const t = (lab && lab.textContent.trim()) || el.getAttribute('data-tip') || el.getAttribute('title') || '';
    return t;
  };
  const place = (el) => {
    const r = el.getBoundingClientRect();
    tip.style.left = `${Math.round(r.right + 8)}px`;
    tip.style.top = `${Math.round(r.top + r.height / 2)}px`;
  };
  const show = (el) => {
    const text = labelOf(el);
    if (!text) return;
    window.clearTimeout(hideTimer);
    if (el.hasAttribute('title')) {
      el.dataset.secTitle = el.getAttribute('title') || '';
      el.removeAttribute('title');
    }
    if (!el.getAttribute('aria-label')) el.setAttribute('aria-label', text);
    tip.textContent = text;
    tip.hidden = false;
    place(el);
    tip.classList.add('is-visible');
    active = el;
  };
  const hide = () => {
    tip.classList.remove('is-visible');
    const el = active;
    active = null;
    hideTimer = window.setTimeout(() => {
      tip.hidden = true;
    }, 80);
    if (el && el.dataset.secTitle != null) {
      el.setAttribute('title', el.dataset.secTitle);
      delete el.dataset.secTitle;
    }
  };
  nav.querySelectorAll('a.sec').forEach((el) => {
    const text = labelOf(el);
    if (text && !el.getAttribute('aria-label')) el.setAttribute('aria-label', text);
    el.addEventListener('mouseenter', () => show(el));
    el.addEventListener('mouseleave', hide);
    el.addEventListener('focus', () => show(el));
    el.addEventListener('blur', hide);
  });
  window.addEventListener(
    'scroll',
    () => {
      if (active) place(active);
    },
    true,
  );
})();

document.getElementById('logout').onclick = () => {
  const go = () => {
    location.replace('/login');
  };
  api('/logout', { method: 'POST' })
    .catch(() => {})
    .finally(go);
  setTimeout(go, 800);
};

(function bindSideCollapse() {
  const KEY = 'uchet1_side_collapsed';
  const burger = document.getElementById('btn-burger');
  const collapseBtn = document.getElementById('btn-side-collapse');
  const setCollapsed = (collapsed) => {
    document.body.classList.toggle('side-collapsed', collapsed);
    try {
      localStorage.setItem(KEY, collapsed ? '1' : '0');
    } catch {
      /* ignore */
    }
    if (burger) {
      burger.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
      burger.title = collapsed ? 'Показать меню' : 'Скрыть меню';
    }
    if (collapseBtn) {
      collapseBtn.title = collapsed ? 'Показать меню' : 'Скрыть меню';
      collapseBtn.setAttribute('aria-label', collapsed ? 'Показать меню' : 'Скрыть меню');
    }
  };
  const toggle = () => setCollapsed(!document.body.classList.contains('side-collapsed'));
  let saved = false;
  try {
    saved = localStorage.getItem(KEY) === '1';
  } catch {
    /* ignore */
  }
  setCollapsed(saved);
  if (burger) burger.addEventListener('click', toggle);
  if (collapseBtn) collapseBtn.addEventListener('click', toggle);
  document.addEventListener('keydown', (e) => {
    if (e.key === '[' && !e.metaKey && !e.ctrlKey && !e.altKey) {
      const t = e.target;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      e.preventDefault();
      toggle();
    }
  });
})();

/** Хук для sections-parity-*.js (Batch A и далее). */
window.WmsLegacy = {
  api,
  openTab,
  openEntityInChat,
  routes,
  VIEW_TITLES,
  TAB_PATHS,
  TAB_SECTION_MAP,
  SECTIONS,
  ENTITY_KIND_LABELS,
  entityKindLabel,
  entityTitle,
  formChrome,
  bindFormChrome,
  bindEntitySectionTabs,
  openCreateLightbox,
  closeCreateLightbox,
  UI_ICO,
  uiIcoSvg,
  uiIcoBtn,
  uiIcoLink,
  uiIcoBar,
  uiFind,
  archiveIconBtn,
  refreshRefs,
  orgOptionsHtml,
  esc,
  formatMoney,
  state,
  showSection,
  renderTabs,
  setUrl,
  pathForTab,
  withCompanyId,
  getFilterCompanyId,
  getPageSize,
  setPageSize,
  pagerHtml,
  bindPager,
  bindListPager,
  bindDadataSuggest,
  get view() {
    return view;
  },
};

if (window.WmsParityA && typeof window.WmsParityA.install === 'function') {
  try {
    window.WmsParityA.install();
  } catch (e) {
    console.error('[parity-a] install failed', e);
  }
}
if (window.WmsCrmOps && typeof window.WmsCrmOps.install === 'function') {
  try {
    window.WmsCrmOps.install();
  } catch (e) {
    console.error('[crm-ops] install failed', e);
  }
}
if (window.WmsParityMoney && typeof window.WmsParityMoney.install === 'function') {
  try {
    window.WmsParityMoney.install();
  } catch (e) {
    console.error('[parity-money] install failed', e);
  }
}
if (window.WmsParityWaveB && typeof window.WmsParityWaveB.install === 'function') {
  try {
    window.WmsParityWaveB.install();
  } catch (e) {
    console.error('[parity-wave-b] install failed', e);
  }
}
if (window.WmsCdek && typeof window.WmsCdek.install === 'function') {
  try {
    window.WmsCdek.install();
  } catch (e) {
    console.error('[cdek] install failed', e);
  }
}

/** Финальный срез меню Э0–Э1: после всех parity-* чтобы никто не раздул паритетом УНФ. */
(function applyNowMenus() {
  if (!SECTIONS.purchases) SECTIONS.purchases = { cols: [] };
  SECTIONS.purchases.cols = [
    [
      {
        title: 'Закупки',
        links: [
          { view: 'suppliers', label: 'Поставщики' },
          { view: 'in', label: 'Приходные накладные' },
          { view: 'parity-supplier-orders', label: 'Заказы поставщикам' },
        ],
      },
    ],
  ];
})();

renderTabs();
showForm();
window.addEventListener('popstate', (e) => {
  if (e.state && typeof e.state.pos === 'number') {
    state.histPos = e.state.pos;
  } else {
    state.histPos = Math.max(0, (Number(state.histPos) || 1) - 1);
  }
  applyAppPath(location.pathname, true);
  syncNavButtons();
});
loadContourFromStorage();
loadMe()
  .finally(async () => {
    loadHeaderRatesOnce();
    await initHeaderCompanySwitcher().catch(() => {});
    const path = location.pathname.replace(/\/+$/, '') || '/';
    try {
      if (path !== '/' && path !== '/legacy.html') {
        applyAppPath(path, true);
      } else {
        setUrl('/', true);
        view.innerHTML = '<p class="muted" style="padding:16px">Загрузка начальной страницы…</p>';
        await renderDashboard().catch((e) => {
          view.innerHTML = `<p class="error">${esc(e.message)}</p>`;
        });
      }
    } finally {
      finishBootLoading();
    }
  });
