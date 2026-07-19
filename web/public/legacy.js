const view = document.getElementById('view');
const sectionPanel = document.getElementById('section-panel');
const tabsEl = document.getElementById('tabs');

const state = {
  warehouses: [],
  units: [],
  categories: [],
  productsPage: 1,
  productsQ: '',
  productsCategoryId: '',
  productsCategoryName: '',
  cpPage: 1,
  cpQ: '',
  balPage: 1,
  balQ: '',
  balWh: '',
  whShowArchived: false,
  staffQ: '',
  auditQ: '',
  auditPage: 1,
  docsType: '',
  docsQ: '',
  docsSort: 'date',
  docsDir: 'desc',
  dealsQ: '',
  dealsPage: 1,
  dealsPipeline: '',
  dealsStatus: '',
  me: null,
  section: 'home',
  tabs: [{ id: 'dashboard', title: 'Начальная страница', closable: false }],
  activeTab: 'dashboard',
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
  counterparties: 'Контрагенты',
  suppliers: 'Поставщики',
  buyers: 'Покупатели',
  balances: 'Остатки',
  docs: 'Документы',
  in: 'Приходные накладные',
  ideas: 'Идеи и ошибки',
  staff: 'Сотрудники',
  audit: 'История / логи',
  presence: 'Кто в системе',
  deals: 'Сделки Amo',
  pipelines: 'Воронки Amo',
  invoices: 'Счета на оплату',
  upd: 'УПД',
  sf: 'Счета-фактуры',
  workorders: 'Заказ-наряды',
  org: 'Реквизиты организации',
  marking: 'Маркировка / партии',
  'wh-tasks': 'Задания склада',
  'ops-dash': 'Дашборд склада',
  income: 'Доход (зеркало)',
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
  counterparties: '/counterparties',
  suppliers: '/suppliers',
  buyers: '/buyers',
  balances: '/balances',
  docs: '/docs',
  in: '/in',
  'in-new': '/in/new',
  invoices: '/invoices',
  upd: '/upd',
  sf: '/sf',
  workorders: '/workorders',
  org: '/org',
  ideas: '/ideas',
  staff: '/staff',
  audit: '/audit',
  presence: '/presence',
  deals: '/deals',
  pipelines: '/pipelines',
  marking: '/marking',
  'wh-tasks': '/warehouse/tasks',
  'ops-dash': '/ops',
  income: '/income',
};

const SECTION_PATHS = {
  home: '/',
  crm: '/crm',
  sales: '/sales',
  purchases: '/purchases',
  warehouse: '/warehouse',
  works: '/works',
  production: '/production',
  money: '/money/tochka',
  staff: '/staff',
  company: '/company',
  settings: '/settings',
  ideas: '/ideas',
  help: '/help',
};

/** Раздел сразу открывает журнал (а не только меню) */
const SECTION_LANDING = {
  home: 'dashboard',
  staff: 'staff',
  ideas: 'ideas',
};

const PATH_TO_SECTION = Object.fromEntries(
  Object.entries(SECTION_PATHS)
    .filter(([, path]) => path !== '/' && !path.includes('/tochka'))
    .map(([section, path]) => [path, section])
);
// алиасы
PATH_TO_SECTION['/personnel'] = 'staff';
PATH_TO_SECTION['/money'] = 'money';

let suppressUrlSync = false;

function pathForTab(id) {
  if (id.startsWith('product:')) return '/products/' + encodeURIComponent(id.slice('product:'.length));
  if (id.startsWith('company:')) return '/counterparties/' + encodeURIComponent(id.slice('company:'.length));
  if (id.startsWith('doc:')) return '/docs/' + encodeURIComponent(id.slice('doc:'.length));
  if (id.startsWith('deal:')) return '/deals/' + encodeURIComponent(id.slice('deal:'.length));
  if (id.startsWith('sales:')) return '/sales-docs/' + encodeURIComponent(id.slice('sales:'.length));
  return TAB_PATHS[id] || '/' + encodeURIComponent(id);
}

function pathForSection(section) {
  if (SECTION_LANDING[section]) return pathForTab(SECTION_LANDING[section]);
  return SECTION_PATHS[section] || '/' + section;
}

function setUrl(path, replace) {
  if (suppressUrlSync) return;
  const next = path || '/';
  if (location.pathname === next) return;
  try {
    history[replace ? 'replaceState' : 'pushState']({ wms: true }, '', next);
  } catch {
    /* ignore */
  }
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
  const deal = path.match(/^\/deals\/([^/]+)$/);
  if (deal) return { type: 'tab', id: 'deal:' + decodeURIComponent(deal[1]) };
  const sales = path.match(/^\/sales-docs\/([^/]+)$/);
  if (sales) return { type: 'tab', id: 'sales:' + decodeURIComponent(sales[1]) };
  for (const [tab, p] of Object.entries(TAB_PATHS)) {
    if (p === path) return { type: 'tab', id: tab };
  }
  if (PATH_TO_SECTION[path]) return { type: 'section', id: PATH_TO_SECTION[path] };
  if (path === '/money/tochka' || path === '/money') return { type: 'section', id: 'money' };
  return { type: 'section', id: 'home' };
}

function highlightSection(section) {
  state.section = section;
  document.querySelectorAll('.taxi-sections .sec').forEach((b) => {
    b.classList.toggle('active', b.dataset.section === section);
  });
}

function sectionForTab(tabId) {
  const base = String(tabId || '').split(':')[0];
  const map = {
    dashboard: 'home',
    products: 'warehouse',
    'cat-tree': 'warehouse',
    'media-photos': 'warehouse',
    props: 'warehouse',
    marks: 'warehouse',
    brands: 'warehouse',
    prices: 'sales',
    warehouses: 'warehouse',
    balances: 'warehouse',
    docs: 'warehouse',
    in: 'purchases',
    counterparties: 'crm',
    suppliers: 'purchases',
    buyers: 'sales',
    deals: 'crm',
    pipelines: 'crm',
    invoices: 'sales',
    upd: 'sales',
    sf: 'sales',
    workorders: 'sales',
    org: 'company',
    staff: 'staff',
    audit: 'settings',
    ideas: 'ideas',
    marking: 'warehouse',
    'wh-tasks': 'warehouse',
    'ops-dash': 'home',
    income: 'money',
  };
  return map[base] || state.section || 'home';
}

function applyAppPath(pathname, replace) {
  const parsed = parseAppPath(pathname);
  suppressUrlSync = true;
  try {
    if (parsed.type === 'tab') {
      const tab = parsed.id;
      highlightSection(sectionForTab(tab));
      if (tab === 'dashboard') {
        showForm();
        openTab('dashboard');
      } else {
        openTab(tab);
      }
    } else if (parsed.id === 'money') {
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
            { view: 'deals', label: 'Сделки Amo' },
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
    cols: [
      [
        {
          title: 'Продажи',
          links: [
            { view: 'buyers', label: 'Покупатели' },
            { view: 'deals', label: 'Заказы покупателей (сделки)' },
            { view: 'docs', label: 'Расходные накладные' },
            { view: 'invoices', label: 'Счета на оплату' },
            { view: 'workorders', label: 'Заказ-наряды' },
            { view: 'upd', label: 'УПД' },
            { view: 'sf', label: 'Счета-фактуры' },
          ],
        },
        {
          title: 'Розничные продажи',
          links: [
            { label: 'Чеки ККМ', disabled: true },
            { label: 'Кассовые смены', disabled: true },
          ],
        },
      ],
      [
        {
          title: 'Товары и услуги',
          links: [
            { view: 'products', label: 'Номенклатура' },
            { view: 'brands', label: 'Бренды' },
          ],
        },
        {
          title: 'Цены и скидки',
          links: [
            { view: 'prices', label: 'Типы цен' },
            { label: 'Прайс-листы', disabled: true },
          ],
        },
      ],
      [
        {
          title: 'Отчеты',
          links: [
            { view: 'balances', label: 'Остатки' },
            { label: 'Анализ продаж', disabled: true },
          ],
        },
        {
          title: 'Сервис',
          links: [{ view: 'dashboard', label: 'Синхронизация с 1С' }],
        },
      ],
    ],
  },
  purchases: {
    cols: [
      [
        {
          title: 'Закупки',
          links: [
            { view: 'suppliers', label: 'Поставщики' },
            { label: 'Заказы поставщикам', disabled: true },
            { view: 'in', label: 'Приходные накладные' },
            { label: 'Счета на оплату (полученные)', disabled: true },
            { view: 'docs', label: 'Документы' },
          ],
        },
        {
          title: 'Переработка',
          links: [{ label: 'Документы переработчиков', disabled: true }],
        },
        {
          title: 'Расчеты с поставщиками',
          links: [
            { label: 'Сверки взаиморасчетов', disabled: true },
            { label: 'Корректировки долга', disabled: true },
          ],
        },
      ],
      [
        {
          title: 'Торговые предложения',
          links: [{ label: 'Торговые предложения', disabled: true }],
        },
        {
          title: 'Товары и услуги',
          links: [
            { view: 'products', label: 'Номенклатура' },
            { label: 'Номера ГТД', disabled: true },
          ],
        },
        {
          title: 'Цены',
          links: [
            { label: 'Прайс-листы поставщиков', disabled: true },
            { view: 'prices', label: 'Виды цен' },
          ],
        },
        {
          title: 'Планирование',
          links: [{ label: 'Расчет потребностей', disabled: true }],
        },
        {
          title: 'Доставка',
          links: [{ label: 'СДЭК (виджет)', external: 'https://widget.pnevmopodveska1.ru/cdek/' }],
        },
      ],
      [
        {
          title: 'Отчеты',
          links: [{ label: 'Анализ заявок на закупку', disabled: true }],
        },
        {
          title: 'Аналитика',
          links: [{ label: 'Отчеты', disabled: true }],
        },
        {
          title: 'Сервис',
          links: [
            { label: 'Загрузить документы из сканов', disabled: true },
            { label: 'Выгрузка товаров в ТСД', disabled: true },
            { view: 'dashboard', label: 'Синхронизация с 1С' },
          ],
        },
      ],
    ],
  },
  warehouse: {
    cols: [
      [
        {
          title: 'Склад',
          links: [
            { view: 'wh-tasks', label: 'Задания склада' },
            { view: 'ops-dash', label: 'Дашборд склада' },
            { view: 'warehouses', label: 'Склады' },
            { view: 'balances', label: 'Остатки' },
            { view: 'docs', label: 'Документы' },
            { view: 'in', label: 'Приход' },
            { view: 'marking', label: 'Маркировка / партии' },
            { label: 'Перемещения', disabled: true },
            { label: 'Инвентаризации', disabled: true },
          ],
        },
      ],
      [
        {
          title: 'Номенклатура',
          links: [
            { view: 'products', label: 'Номенклатура' },
            { view: 'cat-tree', label: 'Дерево категорий' },
            { view: 'media-photos', label: 'Фото номенклатуры' },
            { view: 'brands', label: 'Бренды' },
            { view: 'prices', label: 'Типы цен' },
          ],
        },
      ],
      [
        {
          title: 'Характеристики',
          links: [
            { view: 'props', label: 'Характеристики' },
            { view: 'marks', label: 'Марки / модели' },
          ],
        },
      ],
    ],
  },
  works: {
    cols: [
      [
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
    cols: [
      [
        {
          title: 'Деньги',
          links: [
            { view: 'income', label: 'Доход (зеркало)' },
            { view: 'docs', label: 'Документы' },
            { view: 'prices', label: 'Типы цен' },
            { label: 'Платежные поручения', disabled: true },
            { label: 'Касса', disabled: true },
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
            { label: 'Графики работы', disabled: true },
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
            { view: 'counterparties', label: 'Контрагенты' },
            { view: 'warehouses', label: 'Склады' },
            { view: 'org', label: 'Реквизиты для печати (счёт / УПД)' },
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
            { view: 'dashboard', label: 'Синхронизация с 1С' },
            { view: 'org', label: 'Реквизиты организации' },
            { view: 'prices', label: 'Типы цен' },
            { view: 'staff', label: 'Пользователи' },
            { view: 'presence', label: 'Кто в системе' },
            { view: 'audit', label: 'История / логи' },
          ],
        },
      ],
    ],
  },
  help: {
    cols: [
      [
        {
          title: 'Помощь',
          links: [
            { view: 'dashboard', label: 'Начальная страница' },
            { label: 'О программе Учёт №1', disabled: true },
          ],
        },
      ],
    ],
  },
};

async function api(path, opts = {}) {
  const res = await fetch('/api' + path, {
    headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
    ...opts,
  });
  if (res.status === 401) {
    location.href = '/login';
    throw new Error('unauthorized');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(formatApiError(data.error || res.statusText));
  return data;
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

function presenceSnapshot() {
  const tabId = state.activeTab || '';
  const tab = state.tabs.find((t) => t.id === tabId);
  const section = sectionForTab(tabId) || state.section || 'home';
  let title = (tab && tab.title) || VIEW_TITLES[tabId] || '';
  if (!title && tabId.startsWith('product:')) title = 'Товар';
  if (!title && tabId.startsWith('deal:')) title = 'Сделка';
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
    btn.title = items.length
      ? items
          .map((u) => {
            const meta = presenceClientLine(u);
            return (
              (u.actor_name || '—') +
              ' · ' +
              (u.title || presenceSectionRu(u.section)) +
              (meta ? ' · ' + meta : '')
            );
          })
          .join('\n')
      : 'Никого онлайн';
    if (panel && !panel.hidden) {
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
        : '<div class="presence-panel-head">Никого онлайн</div>';
      const openFull = document.getElementById('presence-open-full');
      if (openFull) openFull.onclick = () => openTab('presence');
    }
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

/** Человекочитаемые подписи audit action / entity (код остаётся в title). */
const AUDIT_ACTION_LABELS = {
  'auth.login': 'Вход в систему',
  'auth.login_failed': 'Неудачный вход',
  'auth.logout': 'Выход',
  'auth.register': 'Регистрация пароля',
  'auth.password_change': 'Смена пароля',
  'auth.password_set': 'Пароль задан админом',
  'crm.deal_ingest': 'Сделка из amoCRM',
  'crm.deals_sync': 'Синхронизация сделок',
  'deal.sbp_qr': 'QR СБП по сделке',
  'deal.payment_delete': 'Удаление оплаты / QR',
  'deal.warehouse_task': 'Задание складу из сделки',
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
};

const AUDIT_ENTITY_LABELS = {
  session: 'сессия',
  staff: 'сотрудник',
  crm_deal: 'сделка',
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
  return AUDIT_ACTOR_ID_LABELS[entityId] || entityId;
}

function auditEntityRefHtml(entity, entityId) {
  if (!entity) return '';
  const entLabel = AUDIT_ENTITY_LABELS[entity] || entity;
  const idLabel = auditEntityIdLabel(entityId);
  const display = idLabel ? `${entLabel}: ${idLabel}` : entLabel;
  const tech = entityId ? `${entity}: ${entityId}` : entity;
  const titleAttr = display !== tech ? ` title="${esc(tech)}"` : '';
  return `<div class="muted" style="font-size:11px"${titleAttr}>${esc(display)}</div>`;
}

function entityHistoryHtml(items) {
  if (!items.length) {
    return '<p class="muted" style="margin:0">Пока нет записей — появятся после изменений названия, цен, фото и т.д.</p>';
  }
  return `<table class="entity-history-table">
    <thead><tr><th style="width:130px">Когда</th><th style="width:140px">Кто</th><th>Что изменили</th></tr></thead>
    <tbody>
      ${items
        .map(
          (it) => `<tr>
            <td class="mono">${esc(String(it.created_at || '').replace('T', ' ').slice(0, 19))}</td>
            <td>${esc(it.actor_name || '—')}</td>
            <td>
              <div>${esc(it.summary || auditActionLabel(it.action) || '')}</div>
              ${it.action ? `<div class="muted" style="font-size:11px" title="${esc(it.action)}">${esc(auditActionLabel(it.action))}</div>` : ''}
            </td>
          </tr>`
        )
        .join('')}
    </tbody>
  </table>`;
}

async function fillEntityHistory(mountId, entity, entityId) {
  const el = document.getElementById(mountId);
  if (!el || !entityId) return;
  try {
    const data = await api(
      `/audit?entity=${encodeURIComponent(entity)}&entity_id=${encodeURIComponent(entityId)}&limit=40&page=1`
    );
    el.innerHTML = entityHistoryHtml(data.items || []);
  } catch (e) {
    el.innerHTML = `<p class="error" style="margin:0">${esc(e.message)}</p>`;
  }
}

function productTitle(p) {
  const name = String(p?.name || '').trim();
  const sku = String(p?.sku || '').trim();
  if (name && !looksLikeGuid(name)) return name;
  if (sku) return sku;
  return name || p?.id || '—';
}

async function refreshRefs() {
  const [warehouses, units, categories] = await Promise.all([
    api('/warehouses'),
    api('/units'),
    api('/categories'),
  ]);
  state.warehouses = warehouses;
  state.units = units;
  state.categories = categories;
}

function pagerHtml(id, page, pages, total) {
  const prevDisabled = page <= 1 ? 'disabled' : '';
  const nextDisabled = page >= pages ? 'disabled' : '';
  return `
    <div class="pager" id="${id}">
      <button type="button" data-dir="-1" ${prevDisabled}>◀</button>
      <span class="muted">${page} / ${pages} · ${total}</span>
      <button type="button" data-dir="1" ${nextDisabled}>▶</button>
    </div>`;
}

function bindPager(id, onPage) {
  const el = document.getElementById(id);
  if (!el) return;
  el.querySelectorAll('button[data-dir]').forEach((btn) => {
    btn.onclick = () => {
      if (btn.disabled) return;
      onPage(Number(btn.dataset.dir));
    };
  });
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
  return v.toLocaleString('ru-RU', { maximumFractionDigits: 2 }) + ' ₽';
}

function showForm() {
  sectionPanel.classList.add('hidden');
  view.classList.remove('hidden');
}

function showSectionPanel() {
  view.classList.add('hidden');
  sectionPanel.classList.remove('hidden');
}

function renderTabs() {
  tabsEl.innerHTML = state.tabs
    .map(
      (t) =>
        `<button type="button" class="tab ${t.id === state.activeTab ? 'active' : ''}" data-tab="${esc(t.id)}" title="${esc(t.title)}">${esc(t.title)}</button>`
    )
    .join('');
  tabsEl.querySelectorAll('[data-tab]').forEach((btn) => {
    btn.onclick = () => openTab(btn.dataset.tab);
  });
}

function formChrome(title, bodyHtml, opts = {}) {
  const closable = opts.closable !== false && state.activeTab !== 'dashboard';
  const pageTabs = Array.isArray(opts.pageTabs) ? opts.pageTabs : null;
  const activePageTab = opts.activePageTab || (pageTabs && pageTabs[0] && pageTabs[0].id) || '';
  const pageTabsHtml = pageTabs
    ? `<div class="form-pagetabs">${pageTabs
        .map(
          (t) =>
            `<button type="button" class="form-pagetab ${t.id === activePageTab ? 'active' : ''}" data-pagetab="${esc(t.id)}">${esc(t.label)}</button>`
        )
        .join('')}</div>`
    : '';
  return `
    <div class="form-chrome">
      <div class="form-titlebar">
        <div class="nav-btns">
          <button type="button" id="tb-back" title="Назад">◀</button>
          <button type="button" id="tb-fwd" title="Вперёд" disabled>▶</button>
          <button type="button" id="tb-fav" title="В избранное">★</button>
        </div>
        <h1>${esc(title)}</h1>
        ${closable ? '<button type="button" class="close-tab" id="tb-close" title="Закрыть">✕</button>' : ''}
      </div>
      ${pageTabsHtml}
      ${opts.toolbar ? `<div class="form-toolbar">${opts.toolbar}</div>` : ''}
      ${opts.metrics ? `<div class="form-metrics">${opts.metrics}</div>` : ''}
      <div class="form-body">${bodyHtml}</div>
    </div>`;
}

function bindFormChrome(onBack) {
  const back = document.getElementById('tb-back');
  if (back) {
    back.onclick = () => {
      if (onBack) onBack();
      else showSection(state.section || 'home');
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
  bindColumnFilters(view);
}

/** Клиентские фильтры по клику на th — во всех таблицах формы */
function bindColumnFilters(root = view) {
  if (!root) return;
  root.querySelectorAll('.form-body table, table').forEach((table) => {
    if (!root.contains(table)) return;
    const thead = table.tHead;
    const tbody = table.tBodies[0];
    if (!thead || !tbody || !thead.rows[0]) return;
    const headerRow = thead.rows[0];
    [...headerRow.cells].forEach((th, colIdx) => {
      if (th.dataset.filterBound === '1') return;
      // уже свой фильтр (категория и т.п.)
      if (th.querySelector('.col-filter-pop')) {
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
      th.title = 'Фильтр: ' + raw;
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
            q: String(cell.dataset.filterValue || '')
              .trim()
              .toLowerCase(),
          }))
          .filter((f) => f.q);
        [...tbody.rows].forEach((tr) => {
          let ok = true;
          for (const f of filters) {
            const cell = tr.cells[f.i];
            const text = (cell ? cell.textContent : '').toLowerCase().replace(/\s+/g, ' ').trim();
            if (!text.includes(f.q)) {
              ok = false;
              break;
            }
          }
          tr.hidden = !ok;
        });
      };

      const setFilter = (value) => {
        const v = String(value || '').trim();
        th.dataset.filterValue = v;
        th.classList.toggle('filtered', !!v);
        labelNode.textContent = v ? raw + ': ' + v + ' ✕' : raw + ' ▾';
        applyTableFilters();
      };

      const openPop = () => {
        root.querySelectorAll('.col-filter-pop').forEach((p) => {
          if (p !== pop) p.classList.add('hidden');
        });
        const current = th.dataset.filterValue || '';
        const uniq = new Map();
        [...tbody.rows].forEach((tr) => {
          const cell = tr.cells[colIdx];
          const t = (cell ? cell.textContent : '').replace(/\s+/g, ' ').trim();
          if (!t || t === '—') return;
          uniq.set(t, (uniq.get(t) || 0) + 1);
        });
        const values = [...uniq.entries()]
          .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'ru'))
          .slice(0, 80);

        pop.innerHTML = '';
        const input = document.createElement('input');
        input.type = 'search';
        input.placeholder = 'Фильтр: ' + raw + '…';
        input.value = current;
        input.autocomplete = 'off';
        input.onclick = (e) => e.stopPropagation();
        input.onkeydown = (e) => {
          e.stopPropagation();
          if (e.key === 'Enter') {
            e.preventDefault();
            setFilter(input.value);
            pop.classList.add('hidden');
          }
          if (e.key === 'Escape') pop.classList.add('hidden');
        };
        const applyBtn = document.createElement('button');
        applyBtn.type = 'button';
        applyBtn.className = 'col-filter-item';
        applyBtn.textContent = 'Применить';
        applyBtn.onclick = (e) => {
          e.stopPropagation();
          setFilter(input.value);
          pop.classList.add('hidden');
        };
        const clearBtn = document.createElement('button');
        clearBtn.type = 'button';
        clearBtn.className = 'col-filter-item';
        clearBtn.textContent = 'Все / сбросить';
        clearBtn.onclick = (e) => {
          e.stopPropagation();
          setFilter('');
          pop.classList.add('hidden');
        };
        const list = document.createElement('div');
        list.className = 'col-filter-list';
        values.forEach(([val, cnt]) => {
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'col-filter-item' + (val === current ? ' active' : '');
          btn.textContent = val + (cnt > 1 ? ' (' + cnt + ')' : '');
          btn.title = val;
          btn.onclick = (e) => {
            e.stopPropagation();
            setFilter(val);
            pop.classList.add('hidden');
          };
          list.appendChild(btn);
        });
        pop.appendChild(input);
        pop.appendChild(applyBtn);
        pop.appendChild(clearBtn);
        pop.appendChild(list);
        pop.classList.remove('hidden');
        setTimeout(() => input.focus(), 0);
      };

      th.addEventListener('click', (e) => {
        e.stopPropagation();
        if (!pop.classList.contains('hidden')) {
          pop.classList.add('hidden');
          return;
        }
        openPop();
      });
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


function openTab(id, title) {
  const t = title || VIEW_TITLES[id] || id;
  if (!state.tabs.find((x) => x.id === id)) {
    state.tabs.push({ id, title: t, closable: id !== 'dashboard' });
  } else if (title) {
    const existing = state.tabs.find((x) => x.id === id);
    if (existing) existing.title = t;
  }
  state.activeTab = id;
  renderTabs();
  showForm();
  highlightSection(sectionForTab(id));
  setUrl(pathForTab(id));
  if (id.startsWith('product:')) {
    renderProductDetail(id.slice('product:'.length));
    return;
  }
  if (id.startsWith('company:')) {
    renderCounterpartyDetail(id.slice('company:'.length));
    return;
  }
  if (id.startsWith('doc:')) {
    renderDocDetail(id.slice('doc:'.length));
    return;
  }
  if (id.startsWith('deal:')) {
    renderDealDetail(id.slice('deal:'.length));
    return;
  }
  if (id.startsWith('sales:')) {
    renderSalesDocDetail(id.slice('sales:'.length));
    return;
  }
  const run = routes[id];
  if (run) run();
}

function closeTab(id) {
  if (id === 'dashboard') return;
  const idx = state.tabs.findIndex((t) => t.id === id);
  if (idx < 0) return;
  state.tabs.splice(idx, 1);
  if (state.activeTab === id) {
    const next = state.tabs[Math.max(0, idx - 1)] || state.tabs[0];
    openTab(next.id, next.title);
  } else {
    renderTabs();
  }
}

function renderSectionMenu(section) {
  const cfg = SECTIONS[section];
  if (!cfg) return;
  sectionPanel.innerHTML = `
    <div class="section-panel-head">
      <div class="section-search">
        <input type="search" placeholder="Поиск (Ctrl+F)" id="sec-q" />
      </div>
    </div>
    <div class="section-cols">
      ${cfg.cols
        .map(
          (col) => `
        <div>
          ${col
            .map(
              (g) => `
            <div class="section-group">
              <h3>${esc(g.title)}</h3>
              ${g.links
                .map((l) => {
                  if (l.external) {
                    return `<a class="section-link" href="${esc(l.external)}" target="_blank" rel="noopener">${esc(l.label)}</a>`;
                  }
                  if (l.disabled || !l.view) {
                    return `<span class="section-link disabled">${esc(l.label)}</span>`;
                  }
                  const href = pathForTab(l.view);
                  return `<a class="section-link" href="${esc(href)}" data-view="${esc(l.view)}">${esc(l.label)}</a>`;
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
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      e.preventDefault();
      openTab(btn.dataset.view);
    };
  });
}

function showSection(section) {
  highlightSection(section);
  if (section === 'money') {
    location.href = '/money/tochka';
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
  const s = await api('/stats');
  let ops = null;
  try {
    ops = await api('/ops/dashboard');
  } catch {
    ops = null;
  }
  const hs = s.hs || {};
  const media = s.media || {};
  const dicts = s.dicts || {};
  const disk = s.disk || {};
  const diskTitle = disk.total_human
    ? `Сервер ${disk.path || '/'}: свободно ${disk.free_human} из ${disk.total_human} (${disk.free_pct}% free)`
    : '';
  const s3Title = disk.s3_quota_human
    ? `S3 квота ${disk.s3_quota_human}, фото заняли ${disk.media_human}, свободно ~${disk.s3_free_human}`
    : `Объём фото в S3 (по БД): ${disk.media_human || '—'}`;
  const wh = (ops && ops.warehouse) || {};
  const income = (ops && ops.income_today) || {};
  view.innerHTML = formChrome(
    'Начальная страница',
    `
    ${
      ops
        ? `<div class="panel" style="margin-bottom:12px">
      <div class="toolbar" style="margin-bottom:8px">
        <strong>Склад сегодня</strong>
        <button type="button" id="goto-ops">Дашборд склада</button>
        <button type="button" id="goto-wh-tasks">Задания</button>
        <button type="button" id="goto-income">Доход</button>
      </div>
      <div class="home-stats">
        <span>Новые<b>${wh.new || 0}</b></span>
        <span>Сборка<b>${wh.picking || 0}</b></span>
        <span>Упаковано<b>${wh.packed || 0}</b></span>
        <span>К выдаче<b>${wh.ready || 0}</b></span>
        <span>Выдано сегодня<b>${wh.handed_today || 0}</b></span>
        <span title="Ожидают оплату">Блок оплаты<b>${wh.blocked_unpaid || 0}</b></span>
        <span>Доход строк<b>${income.count || 0}</b></span>
        <span>Доход сумма<b>${formatMoney(income.sum || 0)}</b></span>
      </div>
    </div>`
        : ''
    }
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
      <span>Ориент.<b>${media.withOrientation ?? 0}</b></span>
      <span>Док. 1С<b>${(s.docs1c && s.docs1c.docs) || 0}</b></span>
      <span>Сделки Amo<b>${(s.crm && s.crm.deals) || 0}</b></span>
    </div>
    <div class="panel">
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
    { closable: false }
  );
  bindFormChrome(() => showSection('home'));
  const goOps = document.getElementById('goto-ops');
  if (goOps) goOps.onclick = () => openTab('ops-dash');
  const goWh = document.getElementById('goto-wh-tasks');
  if (goWh) goWh.onclick = () => openTab('wh-tasks');
  const goInc = document.getElementById('goto-income');
  if (goInc) goInc.onclick = () => openTab('income');
  document.getElementById('sync-odata').onclick = async () => {
    const msg = document.getElementById('sync-msg');
    const btn = document.getElementById('sync-odata');
    btn.disabled = true;
    msg.textContent = 'Загрузка из 1С…';
    try {
      const r = await api('/sync/odata', { method: 'POST' });
      let text =
        `OData ${r.seconds}с: складов ${r.warehouses}, категорий ${r.categories}, ` +
        `номенклатура ${r.products}, контрагенты ${r.counterparties}`;
      if (r.hs) {
        text += ` · HS ${r.hs.seconds}с: применимостей ${r.hs.applicability}, характеристик ${r.hs.properties}`;
      }
      if (r.hsError) text += ` · HS ошибка: ${r.hsError}`;
      msg.textContent = text;
      setTimeout(() => renderDashboard(), 800);
    } catch (e) {
      msg.textContent = e.message;
    } finally {
      btn.disabled = false;
    }
  };
  document.getElementById('sync-hs').onclick = async () => {
    const msg = document.getElementById('sync-msg');
    const btn = document.getElementById('sync-hs');
    btn.disabled = true;
    msg.textContent = 'Полный HS 1в1: товары, применимости, свойства, цены, остатки… это может занять несколько минут';
    try {
      const r = await api('/sync/hs', { method: 'POST' });
      msg.textContent =
        `HS ${r.seconds}с: товаров ${r.productsUpserted}, применимостей ${r.applicability}, ` +
        `свойств ${r.properties}, цен ${r.prices}, остатков ${r.restRows}, ` +
        `складов ${r.stores}, категорий ${r.categories}, сотрудников ${r.employees}`;
      setTimeout(() => renderDashboard(), 800);
    } catch (e) {
      msg.textContent = e.message;
    } finally {
      btn.disabled = false;
    }
  };
  document.getElementById('sync-prices').onclick = async () => {
    const msg = document.getElementById('sync-msg');
    const btn = document.getElementById('sync-prices');
    btn.disabled = true;
    msg.textContent = 'Загрузка цен…';
    try {
      const r = await api('/sync/prices', { method: 'POST' });
      msg.textContent =
        `Цены за ${r.seconds}с: строк ${r.prices}, типов ${(r.dictionaries || {}).priceTypes ?? '—'}`;
      setTimeout(() => renderDashboard(), 600);
    } catch (e) {
      msg.textContent = e.message;
    } finally {
      btn.disabled = false;
    }
  };
  document.getElementById('sync-rests').onclick = async () => {
    const msg = document.getElementById('sync-msg');
    const btn = document.getElementById('sync-rests');
    btn.disabled = true;
    msg.textContent = 'Get/Rests по складам…';
    try {
      const r = await api('/sync/rests', { method: 'POST' });
      msg.textContent = `Остатки за ${r.seconds}с: строк ${r.restRows}, складов ${r.warehouses}`;
      setTimeout(() => renderDashboard(), 600);
    } catch (e) {
      msg.textContent = e.message;
    } finally {
      btn.disabled = false;
    }
  };
  document.getElementById('sync-docs').onclick = async () => {
    const msg = document.getElementById('sync-msg');
    const btn = document.getElementById('sync-docs');
    btn.disabled = true;
    msg.textContent =
      'Загрузка приходных и расходных из 1С… это может занять 30–60 мин, остатки не пересчитываются';
    try {
      const r = await api('/sync/docs', {
        method: 'POST',
        body: JSON.stringify({ kinds: ['in', 'out'] }),
      });
      msg.textContent =
        `Документы ${r.seconds}с: приход ${r.inHeaders} (${r.inLines} стр.), ` +
        `расход ${r.outHeaders} (${r.outLines} стр.), пропуск строк ${r.skippedLines}`;
      setTimeout(() => renderDashboard(), 800);
    } catch (e) {
      msg.textContent = e.message;
    } finally {
      btn.disabled = false;
    }
  };
  document.getElementById('sync-dicts').onclick = async () => {
    const msg = document.getElementById('sync-msg');
    const btn = document.getElementById('sync-dicts');
    btn.disabled = true;
    msg.textContent = 'Сборка словарей…';
    try {
      const r = await api('/sync/dicts', { method: 'POST' });
      msg.textContent =
        `Словари: свойств ${r.properties}, значений ${r.propertyValues}, ` +
        `марок ${r.marks}, моделей ${r.models}, брендов ${r.brands}`;
      setTimeout(() => renderDashboard(), 600);
    } catch (e) {
      msg.textContent = e.message;
    } finally {
      btn.disabled = false;
    }
  };
  document.getElementById('sync-media').onclick = async () => {
    const msg = document.getElementById('sync-msg');
    const btn = document.getElementById('sync-media');
    btn.disabled = true;
    msg.textContent = 'Загрузка фото на S3…';
    try {
      const r = await api('/sync/media', {
        method: 'POST',
        body: JSON.stringify({ limit: 100, onlyMissing: true }),
      });
      msg.textContent =
        `S3 за ${r.seconds}с: товаров ${r.products}, загружено ${r.uploaded}, ` +
        `без фото ${r.empty}, пропущено ${r.skipped}, ошибок ${r.errors}`;
      setTimeout(() => renderDashboard(), 800);
    } catch (e) {
      msg.textContent = e.message;
    } finally {
      btn.disabled = false;
    }
  };
  document.getElementById('sync-orient').onclick = async () => {
    const msg = document.getElementById('sync-msg');
    const btn = document.getElementById('sync-orient');
    btn.disabled = true;
    msg.textContent = 'Определение ориентации фото (вертикаль/горизонталь)…';
    try {
      const r = await api('/sync/media-orient', {
        method: 'POST',
        body: JSON.stringify({ limit: 300 }),
      });
      msg.textContent =
        `Ориентация: проверено ${r.checked}, обновлено ${r.updated}, ошибок ${r.failed}, осталось ${r.left} (${r.seconds}с)`;
      setTimeout(() => renderDashboard(), 600);
    } catch (e) {
      msg.textContent = e.message;
    } finally {
      btn.disabled = false;
    }
  };
  document.getElementById('sync-deals').onclick = async () => {
    const msg = document.getElementById('sync-msg');
    const btn = document.getElementById('sync-deals');
    btn.disabled = true;
    msg.textContent = 'Загрузка воронок и сделок из AmoCRM (через amo1c)… 1–3 мин';
    try {
      const r = await api('/crm/deals/sync', {
        method: 'POST',
        body: JSON.stringify({ days: 60, limit: 800 }),
      });
      msg.textContent =
        `Сделки Amo за ${r.seconds}с: воронок ${r.pipelines}, сделок ${r.deals}, с данными Amo ${r.withAmo}`;
      setTimeout(() => renderDashboard(), 600);
    } catch (e) {
      msg.textContent = e.message;
    } finally {
      btn.disabled = false;
    }
  };
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
    <td><button type="button" class="linkish pe-app-del" title="Удалить строку">✕</button></td>
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
  const [p, marking, brands] = await Promise.all([
    api('/products/' + id),
    api('/products/' + id + '/marking').catch(() => null),
    api('/dicts/brands').catch(() => []),
  ]);
  const props = p.properties || [];
  const apps = p.applicability || [];
  const appOpts = p.applicability_options || { marks: [], combos: [] };
  const appCombos = Array.isArray(appOpts.combos) ? appOpts.combos : [];
  const appMarks = Array.isArray(appOpts.marks) ? appOpts.marks : [];
  const prices = p.prices || [];
  const rests = p.rests || [];
  const related = p.related || [];
  const media = p.media || [];
  const images = media.filter((m) => m.kind === 'image');
  const docs = media.filter((m) => m.kind !== 'image');
  const lots = (marking && marking.lots) || [];
  const dmRows = (marking && marking.by_status) || [];
  const dmTotal = dmRows.reduce((s, r) => s + Number(r.c || 0), 0);
  const dmStatusText = dmRows.length
    ? dmRows.map((r) => `${markingDmStatusRu(r.status)}: ${r.c}`).join(' · ')
    : 'кодов пока нет';
  const title = productTitle(p);
  const editable = canEditProducts();
  const priceEdit = canEditPrices();
  const syncOk = canSync1c();
  const catList = [...state.categories];
  if (p.category_id && !catList.some((c) => c.id === p.category_id)) {
    catList.unshift({
      id: p.category_id,
      name: p.category || p.category_id,
    });
  }
  const catOpts =
    '<option value="">—</option>' +
    catList
      .map(
        (c) =>
          `<option value="${esc(c.id)}" ${c.id === p.category_id ? 'selected' : ''}>${esc(c.name)}</option>`
      )
      .join('');
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
  const editBlock = editable
    ? `
    <h3 style="margin:0 0 8px;font-size:13px;color:var(--taxi-green)">Карточка товара</h3>
    <div class="form-grid">
      <label>Название<input id="pe-name" value="${esc(p.name || '')}" /></label>
      <label>SKU / артикул<input id="pe-sku" class="mono" value="${esc(p.sku || '')}" /></label>
      <label>Код 1С<input id="pe-code" class="mono" value="${esc(p.code || '')}" /></label>
      <label>Бренд<select id="pe-brand">${brandOpts}</select></label>
      <label>Штрихкод<input id="pe-barcode" class="mono" value="${esc(p.barcode || '')}" /></label>
      <label>Категория<select id="pe-cat">${catOpts}</select></label>
      <label>Аналоги SKU<input id="pe-array" value="${esc(p.array_sku || '')}" /></label>
      <label>Активен<select id="pe-active"><option value="1" ${p.is_active ? 'selected' : ''}>Да</option><option value="0" ${!p.is_active ? 'selected' : ''}>Нет</option></select></label>
      <label>Упак. ширина, см<input id="pe-pw" type="number" step="any" value="${p.package_width_cm != null ? esc(p.package_width_cm) : ''}" /></label>
      <label>Упак. высота, см<input id="pe-ph" type="number" step="any" value="${p.package_height_cm != null ? esc(p.package_height_cm) : ''}" /></label>
      <label>Упак. длина, см<input id="pe-pl" type="number" step="any" value="${p.package_length_cm != null ? esc(p.package_length_cm) : ''}" /></label>
      <label>Вес, г<input id="pe-pwg" type="number" step="any" value="${p.package_weight_g != null ? esc(p.package_weight_g) : ''}" /></label>
      <label>GTIN<input id="pe-gtin" class="mono" value="${esc(p.gtin || '')}" placeholder="01…" /></label>
      <label>Честный знак<select id="pe-marking"><option value="0" ${!p.requires_marking ? 'selected' : ''}>Нет</option><option value="1" ${p.requires_marking ? 'selected' : ''}>Да, маркировка</option></select></label>
    </div>
    <div class="toolbar">
      <button class="primary" type="button" id="pe-save">Сохранить</button>
      <span class="muted" id="pe-msg"></span>
    </div>`
    : `
    <p class="muted mono" style="margin:0 0 12px">
      ${esc(p.sku)}${p.code ? ' · код ' + esc(p.code) : ''}${p.brand ? ' · ' + esc(p.brand) : ''}${p.category ? ' · ' + esc(p.category) : ''}
      ${p.array_sku ? '<br>Аналоги SKU: ' + esc(p.array_sku) : ''}
      ${p.package_width_cm || p.package_height_cm ? '<br>Упаковка: ' + [p.package_width_cm, p.package_height_cm, p.package_length_cm].filter((x) => x != null).join('×') + ' см' + (p.package_weight_g ? ', ' + p.package_weight_g + ' г' : '') : ''}
      <br><span style="color:var(--taxi-muted)">Только просмотр — нет права «Редактировать номенклатуру»</span>
    </p>`;
  const pricesBlock = priceEdit
    ? `
    <h3 style="margin:16px 0 8px;font-size:13px;color:var(--taxi-green)">Цены</h3>
    ${
      prices.length
        ? `<table><thead><tr><th>Тип цены</th><th>Сумма</th></tr></thead><tbody>
        ${prices
          .map(
            (x) =>
              `<tr><td>${esc(x.price_type)}</td>
              <td><input class="mono pe-price" data-type="${esc(x.price_type)}" type="number" step="0.01" value="${esc(x.price)}" style="width:120px" /></td></tr>`
          )
          .join('')}
      </tbody></table>
      <div class="toolbar"><button type="button" id="pe-prices-save">Сохранить цены</button><span class="muted" id="pe-prices-msg"></span></div>`
        : '<p class="muted">Нет цен — «Только цены» на начальной странице.</p>'
    }`
    : `
    <h3 style="margin:16px 0 8px;font-size:13px;color:var(--taxi-green)">Цены</h3>
    ${
      prices.length
        ? `<table><thead><tr><th>Тип цены</th><th>Сумма</th></tr></thead><tbody>
        ${prices.map((x) => `<tr><td>${esc(x.price_type)}</td><td class="mono">${formatMoney(x.price)}</td></tr>`).join('')}
      </tbody></table>`
        : '<p class="muted">Нет цен — «Только цены» на начальной странице.</p>'
    }`;
  view.innerHTML = formChrome(
    title,
    `
    ${editBlock}
    <div class="toolbar">
      ${syncOk ? '<button type="button" id="psync-media">Подтянуть фото из 1С</button><button type="button" id="psync-orient">Ориентация фото</button>' : '<span class="muted">Подтянуть фото — только с правом синхронизации</span>'}
      <button type="button" id="pe-json">JSON-ссылка</button>
      <span class="muted" id="pe-json-msg"></span>
    </div>
    <h3 style="margin:0 0 8px;font-size:13px;color:var(--taxi-green)">Остатки (Get/Rests)</h3>
    ${
      rests.length
        ? `<table><thead><tr><th>Склад</th><th>Кол-во</th></tr></thead><tbody>
        ${rests.map((x) => `<tr><td>${esc(x.warehouse || x.warehouse_id)}</td><td class="mono">${esc(x.qty)}</td></tr>`).join('')}
      </tbody></table>`
        : '<p class="muted">Нет остатков — «Полный HS» или «Только остатки».</p>'
    }
    ${pricesBlock}
    <h3 style="margin:16px 0 8px;font-size:13px;color:var(--taxi-green)">Фото и документы</h3>
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
    <h3 style="margin:16px 0 8px;font-size:13px;color:var(--taxi-green)">Характеристики</h3>
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
    }
    <h3 style="margin:16px 0 8px;font-size:13px;color:var(--taxi-green)">Применимости <span class="muted" id="pe-apps-count">(${apps.length})</span></h3>
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
    }
    <h3 style="margin:16px 0 8px;font-size:13px;color:var(--taxi-green)">Маркировка / партии</h3>
    <p class="muted" style="margin:0 0 8px">
      DataMatrix: <b>${dmTotal}</b> · ${esc(dmStatusText)}
      ${p.requires_marking ? ' · <span style="color:var(--taxi-green)">требуется Честный знак</span>' : ''}
      ${p.gtin ? ' · GTIN <span class="mono">' + esc(p.gtin) + '</span>' : ''}
    </p>
    ${
      lots.length
        ? `<table><thead><tr><th>Партия</th><th>Завод</th><th>Статус</th><th>План</th><th>Принято</th><th>Дата</th></tr></thead><tbody>
        ${lots
          .map(
            (l) =>
              `<tr>
                <td class="mono">${esc(l.lot_number)}</td>
                <td>${esc(l.factory || '—')}</td>
                <td>${esc(markingLotStatusRu(l.status))}</td>
                <td class="mono">${esc(l.qty_planned)}</td>
                <td class="mono">${esc(l.qty_received)}</td>
                <td class="mono">${esc(l.production_date || l.arrived_at || '—')}</td>
              </tr>`
          )
          .join('')}
      </tbody></table>`
        : '<p class="muted">Партий нет — создайте в разделе «Маркировка / партии».</p>'
    }
    <div class="toolbar">
      <button type="button" id="pe-open-marking">Открыть маркировку</button>
    </div>
    ${
      related.length
        ? `<h3 style="margin:16px 0 8px;font-size:13px;color:var(--taxi-green)">Сопутствующие</h3>
      <table><thead><tr><th>SKU</th><th>Название</th></tr></thead><tbody>
        ${related.map((r) => `<tr class="clickable" data-rel="${esc(r.id)}"><td class="mono">${esc(r.sku)}</td><td>${esc(r.name)}</td></tr>`).join('')}
      </tbody></table>`
        : ''
    }
    <h3 style="margin:20px 0 8px;font-size:13px;color:var(--taxi-green)">История изменений</h3>
    <p class="muted" style="margin:0 0 8px">Название, цены, фото, характеристики и прочие правки по этой карточке.</p>
    <div id="product-history" class="entity-history"><p class="muted" style="margin:0">Загрузка…</p></div>`
  );
  view.querySelectorAll('[data-rel]').forEach((tr) => {
    tr.onclick = () => openTab('product:' + tr.dataset.rel);
  });
  fillEntityHistory('product-history', 'product', id);
  bindFormChrome(() => openTab('products'));
  const openMarking = document.getElementById('pe-open-marking');
  if (openMarking) {
    openMarking.onclick = () => {
      state.markingProductId = id;
      openTab('marking');
    };
  }
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
  const saveBtn = document.getElementById('pe-save');
  if (saveBtn) {
    saveBtn.onclick = async () => {
      const msg = document.getElementById('pe-msg');
      const num = (el) => {
        const v = el.value.trim();
        if (!v) return null;
        const n = Number(v);
        return Number.isFinite(n) ? n : null;
      };
      saveBtn.disabled = true;
      msg.textContent = 'Сохранение…';
      try {
        await api('/products/' + id, {
          method: 'PATCH',
          body: JSON.stringify({
            name: document.getElementById('pe-name').value,
            sku: document.getElementById('pe-sku').value,
            code: document.getElementById('pe-code').value,
            brand: document.getElementById('pe-brand').value,
            barcode: document.getElementById('pe-barcode').value,
            array_sku: document.getElementById('pe-array').value,
            category_id: document.getElementById('pe-cat').value || null,
            is_active: document.getElementById('pe-active').value === '1',
            package_width_cm: num(document.getElementById('pe-pw')),
            package_height_cm: num(document.getElementById('pe-ph')),
            package_length_cm: num(document.getElementById('pe-pl')),
            package_weight_g: num(document.getElementById('pe-pwg')),
            gtin: document.getElementById('pe-gtin')?.value || '',
            requires_marking: document.getElementById('pe-marking')?.value === '1',
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

async function renderProducts(opts = {}) {
  if (opts.resetPage) state.productsPage = 1;
  await refreshRefs();
  const q = opts.q != null ? opts.q : state.productsQ;
  state.productsQ = q;
  const catId = state.productsCategoryId || '';
  const catName = state.productsCategoryName || '';
  const page = state.productsPage;
  let url = `/products?page=${page}&limit=50`;
  if (q) url += '&q=' + encodeURIComponent(q);
  if (catId) url += '&category_id=' + encodeURIComponent(catId);
  else if (catName) url += '&category=' + encodeURIComponent(catName);
  const data = await api(url);
  const list = data.items || [];
  const unitOpts = state.units.map((u) => `<option value="${esc(u.id)}">${esc(u.short_name)}</option>`).join('');
  const catOpts =
    '<option value="">—</option>' +
    state.categories.map((c) => `<option value="${esc(c.id)}">${esc(c.name)}</option>`).join('');
  const catFilterLabel =
    catId === '__none__' || catName === '__none__'
      ? 'Без категории'
      : catName || (state.categories.find((c) => c.id === catId) || {}).name || 'Категория';
  const catFiltered = !!(catId || catName);

  const canEdit = canEditProducts();
  view.innerHTML = formChrome(
    'Номенклатура',
    `
    ${
      canEdit
        ? `<div class="form-grid">
      <label>Артикул<input id="psku" placeholder="AIR-001" /></label>
      <label>Название<input id="pname" placeholder="Наименование" /></label>
      <label>Ед.изм.<select id="punit">${unitOpts}</select></label>
      <label>Категория<select id="pcat">${catOpts}</select></label>
    </div>
    <div class="toolbar">
      <button class="primary" type="button" id="padd">Создать</button>
    </div>`
        : '<p class="muted" style="margin:0 0 10px">Просмотр номенклатуры. Создание и правка — по праву «Редактировать номенклатуру».</p>'
    }
    ${pagerHtml('ppager', data.page, data.pages, data.total)}
    <table>
      <thead><tr>
        <th>SKU</th><th>Название</th><th>Бренд</th><th>Ед.</th>
        <th class="col-filter ${catFiltered ? 'filtered' : ''}" id="th-category" title="Фильтр по категории">
          ${esc(catFilterLabel)}${catFiltered ? ' ✕' : ' ▾'}
          <div id="cat-filter-pop" class="col-filter-pop hidden"></div>
        </th>
        ${canEdit ? '<th></th>' : ''}
      </tr></thead>
      <tbody>
        ${
          list
            .map(
              (p) => `
          <tr class="clickable">
            <td class="mono"><a href="#" data-open="${esc(p.id)}">${esc(p.sku)}</a></td>
            <td><a href="#" data-open="${esc(p.id)}">${esc(productTitle(p))}</a></td>
            <td>${esc(p.brand || '')}</td>
            <td>${esc(p.unit || '')}</td>
            <td>${esc(p.category || '')}</td>
            ${canEdit ? `<td><button type="button" class="row-action" data-rename="${esc(p.id)}" data-name="${esc(productTitle(p))}">Переименовать</button></td>` : ''}
          </tr>`
            )
            .join('') || `<tr><td colspan="${canEdit ? 6 : 5}" class="muted">Ничего не найдено</td></tr>`
        }
      </tbody>
    </table>
    ${pagerHtml('ppager2', data.page, data.pages, data.total)}`,
    {
      toolbar: `
        ${canEdit ? '<button class="primary" type="button" id="padd2">Создать</button>' : ''}
        ${
          catFiltered
            ? `<button type="button" id="pcat-clear" title="Сбросить фильтр категории">Категория: ${esc(catFilterLabel)} ✕</button>`
            : ''
        }
        <div class="grow"></div>
        <div class="find">
          <input id="pq" placeholder="Поиск (Ctrl+F)" value="${esc(q)}" autocomplete="off" />
          <button type="button" id="psearch">Найти</button>
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

  const thCat = document.getElementById('th-category');
  const pop = document.getElementById('cat-filter-pop');
  if (thCat && pop) {
    const bindCatItems = () => {
      pop.querySelectorAll('[data-cat]').forEach((btn) => {
        btn.onclick = (e) => {
          e.stopPropagation();
          applyCategoryFilter(btn.dataset.cat, btn.dataset.name);
        };
      });
    };
    const fillCatList = (filterQ = '') => {
      const fq = filterQ.trim().toLowerCase();
      const cats = state.categories.filter((c) => !fq || String(c.name || '').toLowerCase().includes(fq));
      const listEl = pop.querySelector('.col-filter-list');
      if (!listEl) return;
      listEl.innerHTML =
        cats
          .map(
            (c) =>
              `<button type="button" class="col-filter-item ${c.id === catId || c.name === catName ? 'active' : ''}" data-cat="${esc(c.id)}" data-name="${esc(c.name)}">${esc(c.name)}</button>`
          )
          .join('') || '<div class="muted" style="padding:8px">Нет категорий</div>';
      bindCatItems();
    };
    const openCatPop = () => {
      pop.innerHTML = `
        <input type="search" id="cat-filter-q" placeholder="Поиск категории…" autocomplete="off" />
        <button type="button" class="col-filter-item" data-cat="" data-name="">Все категории</button>
        <button type="button" class="col-filter-item" data-cat="__none__" data-name="__none__">Без категории</button>
        <div class="col-filter-list"></div>`;
      fillCatList('');
      const qEl = document.getElementById('cat-filter-q');
      if (qEl) {
        qEl.oninput = () => fillCatList(qEl.value);
        qEl.onclick = (e) => e.stopPropagation();
        qEl.onkeydown = (e) => e.stopPropagation();
        setTimeout(() => qEl.focus(), 0);
      }
      pop.classList.remove('hidden');
    };
    thCat.onclick = (e) => {
      e.stopPropagation();
      if (!pop.classList.contains('hidden')) {
        pop.classList.add('hidden');
        return;
      }
      openCatPop();
    };
    if (!state._catFilterDocBound) {
      state._catFilterDocBound = true;
      document.addEventListener('click', (e) => {
        const th = document.getElementById('th-category');
        const p = document.getElementById('cat-filter-pop');
        if (th && p && !th.contains(e.target)) p.classList.add('hidden');
      });
    }
  }
  const clearBtn = document.getElementById('pcat-clear');
  if (clearBtn) clearBtn.onclick = () => applyCategoryFilter('', '');

  const goSearch = () => {
    state.productsQ = document.getElementById('pq').value.trim();
    state.productsPage = 1;
    renderProducts();
  };
  document.getElementById('psearch').onclick = goSearch;
  document.getElementById('pq').onkeydown = (e) => {
    if (e.key === 'Enter') goSearch();
  };
  if (canEdit) {
    const add = async () => {
      await api('/products', {
        method: 'POST',
        body: JSON.stringify({
          sku: document.getElementById('psku').value,
          name: document.getElementById('pname').value,
          unit_id: document.getElementById('punit').value,
          category_id: document.getElementById('pcat').value || undefined,
        }),
      });
      state.productsPage = 1;
      renderProducts();
    };
    document.getElementById('padd').onclick = add;
    document.getElementById('padd2').onclick = add;
    view.querySelectorAll('[data-rename]').forEach((btn) => {
      btn.onclick = async () => {
        const name = prompt('Новое название', btn.dataset.name);
        if (!name) return;
        await api('/products/' + btn.dataset.rename, {
          method: 'PATCH',
          body: JSON.stringify({ name }),
        });
        renderProducts();
      };
    });
  }
  bindPager('ppager', (d) => {
    state.productsPage = Math.max(1, state.productsPage + d);
    renderProducts();
  });
  bindPager('ppager2', (d) => {
    state.productsPage = Math.max(1, state.productsPage + d);
    renderProducts();
  });
  view.querySelectorAll('[data-open]').forEach((a) => {
    a.onclick = (e) => {
      e.preventDefault();
      openTab('product:' + a.dataset.open);
    };
  });
}

async function renderWarehouses() {
  const showArchived = !!state.whShowArchived;
  const list = await api('/warehouses?archived=all');
  const visible = list.filter((w) => (showArchived ? true : w.is_active));
  view.innerHTML = formChrome(
    'Склады',
    `
    <div class="form-grid">
      <label>Название<input id="wname" placeholder="Например: Склад Москва" autocomplete="off" /></label>
      <label class="muted" style="align-self:end">Код и GUID создаются автоматически (как в 1С): WH-000001</label>
    </div>
    <div class="toolbar">
      <button class="primary" id="wadd" type="button">Создать</button>
      <label style="display:flex;align-items:center;gap:6px;margin:0;color:var(--taxi-muted);font-size:12px">
        <input type="checkbox" id="warch" ${showArchived ? 'checked' : ''} /> Показать архивные
      </label>
      <span class="muted" id="wmsg"></span>
    </div>
    <table>
      <thead><tr><th>Код</th><th>Название</th><th>Статус</th><th></th></tr></thead>
      <tbody>
        ${
          visible.length
            ? visible
                .map(
                  (w) => `
          <tr class="${w.is_active ? '' : 'muted'}">
            <td class="mono">${esc(w.code)}</td>
            <td>${esc(w.name)}</td>
            <td>${w.is_active ? '<span class="badge">Активен</span>' : '<span class="badge draft">Архив</span>'}</td>
            <td>
              ${
                w.is_active
                  ? `<button type="button" data-archive="${esc(w.id)}" data-name="${esc(w.name)}">В архив</button>`
                  : `<button type="button" data-restore="${esc(w.id)}">Вернуть</button>`
              }
            </td>
          </tr>`
                )
                .join('')
            : '<tr><td colspan="4" class="muted">Нет складов</td></tr>'
        }
      </tbody>
    </table>`,
    {
      toolbar: `<button class="primary" type="button" id="wadd2">Создать</button><div class="grow"></div>`,
    }
  );
  bindFormChrome(() => showSection('warehouse'));
  const create = async () => {
    const msg = document.getElementById('wmsg');
    const name = document.getElementById('wname').value.trim();
    if (!name) {
      msg.textContent = 'Укажите название';
      return;
    }
    try {
      const r = await api('/warehouses', {
        method: 'POST',
        body: JSON.stringify({ name }),
      });
      msg.textContent = `Создан: ${r.code}`;
      state.whShowArchived = false;
      renderWarehouses();
    } catch (e) {
      msg.textContent = e.message;
    }
  };
  document.getElementById('wadd').onclick = create;
  document.getElementById('wadd2').onclick = create;
  document.getElementById('warch').onchange = (e) => {
    state.whShowArchived = e.target.checked;
    renderWarehouses();
  };
  view.querySelectorAll('[data-archive]').forEach((btn) => {
    btn.onclick = async () => {
      if (!confirm(`Архивировать склад «${btn.dataset.name}»?`)) return;
      await api('/warehouses/' + btn.dataset.archive, {
        method: 'PATCH',
        body: JSON.stringify({ is_active: false }),
      });
      renderWarehouses();
    };
  });
  view.querySelectorAll('[data-restore]').forEach((btn) => {
    btn.onclick = async () => {
      await api('/warehouses/' + btn.dataset.restore, {
        method: 'PATCH',
        body: JSON.stringify({ is_active: true }),
      });
      renderWarehouses();
    };
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

function joinPhones(phone1, phone2) {
  return [phone1, phone2]
    .map((p) => String(p || '').trim())
    .filter(Boolean)
    .join(', ');
}

function docTypeLabel(t) {
  if (t === 'in') return 'Приходная';
  if (t === 'out') return 'Расходная';
  if (t === 'transfer') return 'Перемещение';
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
  const c = await api('/counterparties/' + id);
  const kindLabelRu =
    c.kind === 'buyer'
      ? 'Покупатель'
      : c.kind === 'supplier'
        ? 'Поставщик'
        : c.kind === 'both'
          ? 'Покупатель и поставщик'
          : 'Контрагент';
  const title = `${c.name || 'Контрагент'} (Контрагент: ${kindLabelRu})`;
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
  const docs = c.docs || [];
  const docsTotal = c.docs_total ?? docs.length;
  const backList =
    state.cpMode === 'supplier'
      ? 'suppliers'
      : state.cpMode === 'buyer'
        ? 'buyers'
        : 'counterparties';
  // kind=both из 1С/БД → в UI выбираем покупателя (не оба сразу)
  const kindUi = c.kind === 'supplier' ? 'supplier' : 'buyer';
  const [phone1, phone2] = splitPhones(c.phone);

  const mainBody = `
    <h3 class="form-section-title">О контрагенте</h3>
    <div class="form-fields">
      <div class="field span-2">
        <span>Наименование</span>
        <input id="ce-name" value="${esc(c.name || '')}" />
      </div>
      <div class="field">
        <span>ИНН</span>
        <input id="ce-inn" class="mono" value="${esc(c.inn || '')}" placeholder="не указан" />
      </div>
      <div class="field">
        <span>Тел 1</span>
        <div class="field-control">
          <input id="ce-phone1" value="${esc(phone1)}" placeholder="не указан" />
          <button type="button" id="ce-phone-split" title="Разнести склейку из Тел 1">Раскидать</button>
        </div>
      </div>
      <div class="field">
        <span>Тел 2</span>
        <input id="ce-phone2" value="${esc(phone2)}" placeholder="не указан" />
      </div>
    </div>
    <h3 class="form-section-title">Классификация</h3>
    <div class="form-fields">
      <div class="field span-2">
        <span>Вид</span>
        <div class="checks">
          <label><input type="radio" name="ce-kind-radio" value="buyer" ${kindUi === 'buyer' ? 'checked' : ''} /> Покупатель</label>
          <label><input type="radio" name="ce-kind-radio" value="supplier" ${kindUi === 'supplier' ? 'checked' : ''} /> Поставщик</label>
        </div>
      </div>
    </div>
    <h3 class="form-section-title">Адреса, телефоны</h3>
    <div class="form-fields">
      <div class="field">
        <span>Тел 1</span>
        <input id="ce-phone1-ro" value="${esc(phone1)}" readonly placeholder="не указан" />
      </div>
      <div class="field">
        <span>Тел 2</span>
        <input id="ce-phone2-ro" value="${esc(phone2)}" readonly placeholder="не указан" />
      </div>
    </div>
    <p class="muted" id="ce-msg" style="margin-top:8px"></p>`;

  const docsBody = `
    <h3 class="form-section-title">Документы <span class="muted">(${docsTotal})</span></h3>
    ${
      docs.length
        ? `<table>
        <thead><tr><th>Тип</th><th>Номер</th><th>Дата</th><th>Склад</th><th>Сумма</th></tr></thead>
        <tbody>
          ${docs
            .map(
              (d) =>
                `<tr class="clickable" data-doc="${esc(d.id)}">
                  <td>${esc(docTypeLabel(d.doc_type))}</td>
                  <td class="mono">${esc(d.number || '')}</td>
                  <td>${esc(String(d.doc_date || '').slice(0, 10))}</td>
                  <td>${esc(d.warehouse || '—')}</td>
                  <td class="mono">${d.amount != null ? formatMoney(d.amount) : '—'}</td>
                </tr>`
            )
            .join('')}
        </tbody>
      </table>`
        : '<p class="muted">Документов по этой компании пока нет.</p>'
    }`;

  view.innerHTML = formChrome(title, pageTab === 'docs' ? docsBody : mainBody, {
    pageTabs: [
      { id: 'main', label: 'Основное' },
      { id: 'docs', label: 'Документы' },
      { id: 'contracts', label: 'Договоры' },
      { id: 'bank', label: 'Банковские счета' },
    ],
    activePageTab: pageTab === 'docs' ? 'docs' : 'main',
    toolbar: `
      <button class="primary" type="button" id="ce-save-close">Записать и закрыть</button>
      <button class="primary" type="button" id="ce-save">Записать</button>
      <button type="button" id="ce-print" title="Печать">🖨</button>
      <div class="grow"></div>
      <span class="muted" id="ce-toolbar-msg"></span>`,
    metrics: `
      <span>Документов: <b>${docsTotal}</b></span>
      <span>Вид: <b>${esc(kindLabelRu)}</b></span>
      <span class="metric-link" id="ce-goto-docs">Перейти к документам →</span>`,
  });
  bindFormChrome(() => openTab(backList));

  view.querySelectorAll('[data-pagetab]').forEach((btn) => {
    btn.onclick = () => {
      const pid = btn.dataset.pagetab;
      if (pid === 'main' || pid === 'docs') {
        renderCounterpartyDetail(id, pid);
        return;
      }
      alert('Раздел «' + btn.textContent + '» — в разработке');
    };
  });
  const gotoDocs = document.getElementById('ce-goto-docs');
  if (gotoDocs) gotoDocs.onclick = () => renderCounterpartyDetail(id, 'docs');

  document.getElementById('ce-phone-split')?.addEventListener('click', () => {
    const p1 = document.getElementById('ce-phone1');
    const p2 = document.getElementById('ce-phone2');
    if (!p1 || !p2) return;
    const [a, b] = splitPhones(p1.value);
    p1.value = a;
    p2.value = b;
    const r1 = document.getElementById('ce-phone1-ro');
    const r2 = document.getElementById('ce-phone2-ro');
    if (r1) r1.value = a;
    if (r2) r2.value = b;
  });

  const saveCp = async (andClose) => {
    const msg = document.getElementById('ce-msg') || document.getElementById('ce-toolbar-msg');
    const btn = document.getElementById('ce-save');
    const btn2 = document.getElementById('ce-save-close');
    if (btn) btn.disabled = true;
    if (btn2) btn2.disabled = true;
    if (msg) msg.textContent = 'Сохранение…';
    const kindVal =
      document.querySelector('input[name="ce-kind-radio"]:checked')?.value || kindUi;
    const phoneVal = joinPhones(
      document.getElementById('ce-phone1')?.value,
      document.getElementById('ce-phone2')?.value
    );
    try {
      await api('/counterparties/' + id, {
        method: 'PATCH',
        body: JSON.stringify({
          name: document.getElementById('ce-name')?.value ?? c.name,
          inn: document.getElementById('ce-inn')?.value ?? c.inn,
          phone: phoneVal,
          kind: kindVal === 'supplier' ? 'supplier' : 'buyer',
        }),
      });
      if (msg) msg.textContent = 'Сохранено';
      if (andClose) {
        closeTab(tabId);
        openTab(backList);
        return;
      }
      setTimeout(() => renderCounterpartyDetail(id, pageTab), 250);
    } catch (e) {
      if (msg) msg.textContent = e.message;
      if (btn) btn.disabled = false;
      if (btn2) btn2.disabled = false;
    }
  };
  const saveBtn = document.getElementById('ce-save');
  const saveCloseBtn = document.getElementById('ce-save-close');
  if (saveBtn) saveBtn.onclick = () => saveCp(false);
  if (saveCloseBtn) saveCloseBtn.onclick = () => saveCp(true);
  const printBtn = document.getElementById('ce-print');
  if (printBtn) printBtn.onclick = () => window.print();

  view.querySelectorAll('[data-doc]').forEach((tr) => {
    tr.onclick = () => openTab('doc:' + tr.dataset.doc);
  });
}

async function renderCounterparties(mode) {
  // mode: '' | 'supplier' | 'buyer'
  const filterKind = mode === 'supplier' || mode === 'buyer' ? mode : '';
  state.cpMode = filterKind;
  const q = state.cpQ;
  const page = state.cpPage;
  const title =
    filterKind === 'supplier' ? 'Поставщики' : filterKind === 'buyer' ? 'Покупатели' : 'Контрагенты';
  const backSection =
    filterKind === 'supplier' ? 'purchases' : filterKind === 'buyer' ? 'sales' : 'crm';
  const data = await api(
    `/counterparties?page=${page}&limit=50` +
      (q ? '&q=' + encodeURIComponent(q) : '') +
      (filterKind ? '&kind=' + encodeURIComponent(filterKind) : '')
  );
  const list = data.items || [];
  const kindSelect =
    filterKind === 'supplier'
      ? `<label>Тип<select id="ckind" disabled><option value="supplier" selected>Поставщик</option></select></label>`
      : filterKind === 'buyer'
        ? `<label>Тип<select id="ckind" disabled><option value="buyer" selected>Покупатель</option></select></label>`
        : kindSelectHtml('supplier', 'ckind');

  view.innerHTML = formChrome(
    title,
    `
    <div class="form-grid">
      <label>Название<input id="cname" /></label>
      <label>ИНН<input id="cinn" /></label>
      <label>Тел 1<input id="cphone1" /></label>
      <label>Тел 2<input id="cphone2" /></label>
      ${kindSelect}
    </div>
    <div class="toolbar"><button class="primary" id="cadd" type="button">Создать</button></div>
    <p class="muted" style="margin:0 0 8px">Всего: <b>${data.total ?? 0}</b>${filterKind ? ' · фильтр: ' + esc(title) : ''}</p>
    ${pagerHtml('cpager', data.page, data.pages, data.total)}
    <table>
      <thead><tr><th>Представление</th><th>ИНН</th><th>Телефон</th><th>Тип</th></tr></thead>
      <tbody>
        ${
          list
            .map(
              (x) =>
                `<tr class="clickable" data-open="${esc(x.id)}"><td>${esc(x.name)}</td><td class="mono">${esc(x.inn || '')}</td><td>${esc(x.phone || '')}</td><td>${esc(kindLabel(x.kind))}</td></tr>`
            )
            .join('') || '<tr><td colspan="4" class="muted">Ничего не найдено</td></tr>'
        }
      </tbody>
    </table>
    ${pagerHtml('cpager2', data.page, data.pages, data.total)}`,
    {
      toolbar: `
        <button class="primary" type="button" id="cadd2">Создать</button>
        <div class="grow"></div>
        <div class="find">
          <input id="cq" placeholder="Поиск (Ctrl+F)" value="${esc(q)}" autocomplete="off" />
          <button type="button" id="csearch">Найти</button>
        </div>`,
    }
  );
  bindFormChrome(() => showSection(backSection));
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
  const add = async () => {
    const kindRaw = document.getElementById('ckind').value || filterKind || 'supplier';
    const created = await api('/counterparties', {
      method: 'POST',
      body: JSON.stringify({
        name: document.getElementById('cname').value,
        inn: document.getElementById('cinn').value,
        phone: joinPhones(
          document.getElementById('cphone1')?.value,
          document.getElementById('cphone2')?.value
        ),
        kind: kindRaw === 'buyer' ? 'buyer' : 'supplier',
      }),
    });
    if (created && created.id) {
      openTab('company:' + created.id, (created.name || 'Контрагент').slice(0, 40));
      return;
    }
    state.cpPage = 1;
    reload();
  };
  document.getElementById('cadd').onclick = add;
  document.getElementById('cadd2').onclick = add;
  bindPager('cpager', (d) => {
    state.cpPage = Math.max(1, state.cpPage + d);
    reload();
  });
  bindPager('cpager2', (d) => {
    state.cpPage = Math.max(1, state.cpPage + d);
    reload();
  });
  view.querySelectorAll('[data-open]').forEach((tr) => {
    tr.onclick = () => openTab('company:' + tr.dataset.open);
  });
}

async function renderBalances() {
  await refreshRefs();
  const wh = state.balWh;
  const q = state.balQ;
  const page = state.balPage;
  const qs = new URLSearchParams({ page: String(page), limit: '50' });
  if (wh) qs.set('warehouse_id', wh);
  if (q) qs.set('q', q);
  const data = await api('/balances?' + qs.toString());
  const list = data.items || [];
  const whOpts =
    '<option value="">Все склады</option>' +
    state.warehouses
      .map((w) => `<option value="${esc(w.id)}" ${w.id === wh ? 'selected' : ''}>${esc(w.name)}</option>`)
      .join('');
  view.innerHTML = formChrome(
    'Остатки',
    `
    ${pagerHtml('bpager', data.page, data.pages, data.total)}
    <table>
      <thead><tr><th>Склад</th><th>SKU</th><th>Номенклатура</th><th>Кол-во</th><th>Ед.</th></tr></thead>
      <tbody>
        ${
          list
            .map(
              (r) => `
          <tr>
            <td>${esc(r.warehouse)}</td>
            <td class="mono">${esc(r.sku)}</td>
            <td>${esc(r.name)}</td>
            <td><strong>${esc(r.qty)}</strong></td>
            <td>${esc(r.unit)}</td>
          </tr>`
            )
            .join('') || '<tr><td colspan="5" class="muted">Пусто — оформите приход</td></tr>'
        }
      </tbody>
    </table>
    ${pagerHtml('bpager2', data.page, data.pages, data.total)}`,
    {
      toolbar: `
        <select id="bwh">${whOpts}</select>
        <div class="grow"></div>
        <div class="find">
          <input id="bq" placeholder="Поиск (Ctrl+F)" value="${esc(q)}" autocomplete="off" />
          <button type="button" id="bgo">Найти</button>
        </div>`,
    }
  );
  bindFormChrome(() => showSection('warehouse'));
  const apply = () => {
    state.balWh = document.getElementById('bwh').value;
    state.balQ = document.getElementById('bq').value.trim();
    state.balPage = 1;
    renderBalances();
  };
  document.getElementById('bgo').onclick = apply;
  document.getElementById('bq').onkeydown = (e) => {
    if (e.key === 'Enter') apply();
  };
  document.getElementById('bwh').onchange = apply;
  bindPager('bpager', (d) => {
    state.balPage = Math.max(1, state.balPage + d);
    renderBalances();
  });
  bindPager('bpager2', (d) => {
    state.balPage = Math.max(1, state.balPage + d);
    renderBalances();
  });
}

async function renderDocs() {
  const type = state.docsType || '';
  const q = state.docsQ || '';
  const sort = state.docsSort || 'date';
  const dir = state.docsDir || 'desc';
  const qs = new URLSearchParams();
  if (type) qs.set('type', type);
  if (q) qs.set('q', q);
  qs.set('sort', sort);
  qs.set('dir', dir);
  const list = await api('/docs?' + qs.toString());
  const typeMap = { in: 'Приход', out: 'Расход', transfer: 'Перемещение' };
  const title =
    type === 'in' ? 'Приходные накладные' : type === 'out' ? 'Расходные накладные' : 'Документы';
  const backSection = type === 'in' ? 'purchases' : type === 'out' ? 'sales' : 'warehouse';
  const mark = (key) => {
    if (sort !== key) return '';
    return dir === 'asc' ? ' ▲' : ' ▼';
  };
  const th = (key, label) =>
    `<th class="sortable ${sort === key ? 'sorted' : ''}" data-sort="${key}" title="Сортировка">${esc(label)}${mark(key)}</th>`;
  view.innerHTML = formChrome(
    title,
    `
    <p class="muted" style="margin:0 0 8px">Журнал из 1С (приход/расход) и локальные. Клик по строке — открыть документ. Клик по заголовку — сортировка.</p>
    <table>
      <thead><tr>
        ${th('number', 'Номер')}
        ${type ? '' : th('type', 'Тип')}
        ${th('date', 'Дата')}
        ${th('counterparty', 'Контрагент')}
        ${th('warehouse', 'Склад')}
        ${th('amount', 'Сумма')}
        ${th('status', 'Статус')}
      </tr></thead>
      <tbody>
        ${
          list
            .map(
              (d) => `
          <tr class="clickable" data-doc="${esc(d.id)}">
            <td class="mono">${esc(d.number)}</td>
            ${type ? '' : `<td>${esc(typeMap[d.doc_type] || d.doc_type)}</td>`}
            <td>${esc(String(d.doc_date || '').slice(0, 10))}</td>
            <td>${esc(d.counterparty || '—')}</td>
            <td>${esc(d.warehouse || '—')}${d.warehouse_to ? ' → ' + esc(d.warehouse_to) : ''}</td>
            <td class="mono">${d.amount != null ? formatMoney(d.amount) : '—'}</td>
            <td><span class="badge ${d.posted ? '' : 'draft'}">${d.posted ? 'Проведён' : 'Черновик'}${d.source === '1c' ? ' · 1С' : ''}</span></td>
          </tr>`
            )
            .join('') ||
            `<tr><td colspan="${type ? 6 : 7}" class="muted">Документов пока нет — кнопка «Документы 1С» на главной</td></tr>`
        }
      </tbody>
    </table>`,
    {
      toolbar: `
        <button class="primary" type="button" id="goto-in">Создать приход</button>
        <button type="button" id="docs-in" ${type === 'in' ? 'class="primary"' : ''}>Приходные</button>
        <button type="button" id="docs-out" ${type === 'out' ? 'class="primary"' : ''}>Расходные</button>
        <button type="button" id="docs-all" ${!type ? 'class="primary"' : ''}>Все</button>
        <div class="grow"></div>
        <div class="find">
          <input id="docs-q" placeholder="Номер / контрагент" value="${esc(q)}" />
          <button type="button" id="docs-search">Найти</button>
        </div>`,
    }
  );
  bindFormChrome(() => showSection(backSection));
  document.getElementById('goto-in').onclick = () => openTab('in-new');
  document.getElementById('docs-in').onclick = () => {
    state.docsType = 'in';
    openTab('in');
  };
  document.getElementById('docs-out').onclick = () => {
    state.docsType = 'out';
    renderDocs();
  };
  document.getElementById('docs-all').onclick = () => {
    state.docsType = '';
    openTab('docs');
  };
  document.getElementById('docs-search').onclick = () => {
    state.docsQ = document.getElementById('docs-q').value.trim();
    renderDocs();
  };
  document.getElementById('docs-q').onkeydown = (e) => {
    if (e.key === 'Enter') {
      state.docsQ = document.getElementById('docs-q').value.trim();
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
      renderDocs();
    };
  });
  view.querySelectorAll('[data-doc]').forEach((tr) => {
    tr.onclick = () => openTab('doc:' + tr.dataset.doc);
  });
}

async function renderDocDetail(id) {
  const d = await api('/docs/' + id);
  const typeMap = { in: 'Приходная накладная', out: 'Расходная накладная', transfer: 'Перемещение' };
  const typeShort = { in: 'Приход', out: 'Расход', transfer: 'Перемещение' };
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
  const lines = d.lines || [];
  const linesSum = lines.reduce((s, l) => s + (Number(l.amount) || 0), 0);
  view.innerHTML = formChrome(
    title,
    `
    <div class="form-grid">
      <label>Тип<input value="${esc(typeMap[d.doc_type] || d.doc_type)}" readonly /></label>
      <label>Номер<input class="mono" value="${esc(d.number || '')}" readonly /></label>
      <label>Дата<input value="${esc(String(d.doc_date || '').slice(0, 10))}" readonly /></label>
      <label>Статус<input value="${esc((d.posted ? 'Проведён' : 'Черновик') + (d.source === '1c' ? ' · 1С' : ''))}" readonly /></label>
      <label>Контрагент<input value="${esc(d.counterparty || '—')}" readonly ${d.counterparty_id ? `data-company="${esc(d.counterparty_id)}"` : ''} /></label>
      <label>Склад<input value="${esc(d.warehouse || '—')}${d.warehouse_to ? ' → ' + esc(d.warehouse_to) : ''}" readonly /></label>
      <label>Сумма<input class="mono" value="${esc(formatMoney(d.amount != null ? d.amount : linesSum))}" readonly /></label>
      <label>Комментарий<input value="${esc(d.comment || '')}" readonly /></label>
    </div>
    ${
      d.counterparty_id
        ? `<div class="toolbar"><button type="button" id="doc-open-cp">Открыть контрагента</button></div>`
        : ''
    }
    <h3 style="margin:16px 0 8px;font-size:13px;color:var(--taxi-green)">Строки (${lines.length})</h3>
    ${
      lines.length
        ? `<table>
        <thead><tr><th>SKU</th><th>Номенклатура</th><th>Кол-во</th><th>Цена</th><th>Сумма</th></tr></thead>
        <tbody>
          ${lines
            .map(
              (l) =>
                `<tr class="${l.product_id ? 'clickable' : ''}" ${l.product_id ? `data-product="${esc(l.product_id)}"` : ''}>
                  <td class="mono">${esc(l.sku || '')}</td>
                  <td>${esc(l.product_name || l.product_id || '—')}</td>
                  <td class="mono">${esc(l.qty)}</td>
                  <td class="mono">${formatMoney(l.price)}</td>
                  <td class="mono">${formatMoney(l.amount)}</td>
                </tr>`
            )
            .join('')}
        </tbody>
      </table>`
        : '<p class="muted">Строк нет.</p>'
    }`
  );
  bindFormChrome(() => openTab('docs'));
  const cpBtn = document.getElementById('doc-open-cp');
  if (cpBtn && d.counterparty_id) {
    cpBtn.onclick = () => openTab('company:' + d.counterparty_id);
  }
  view.querySelectorAll('[data-product]').forEach((tr) => {
    tr.onclick = () => openTab('product:' + tr.dataset.product);
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
      <button type="button" id="pipe-goto-deals">Все сделки</button>
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

async function renderDeals() {
  const q = state.dealsQ || '';
  const page = state.dealsPage || 1;
  const pipelineId = state.dealsPipeline || '';
  const statusId = state.dealsStatus || '';
  const pipes = (await api('/crm/pipelines')).items || [];
  const qs = new URLSearchParams({ page: String(page), limit: '50' });
  if (q) qs.set('q', q);
  if (pipelineId) qs.set('pipeline_id', pipelineId);
  if (statusId) qs.set('status_id', statusId);
  const data = await api('/crm/deals?' + qs.toString());
  const list = data.items || [];
  const pipeOpts =
    '<option value="">Все воронки</option>' +
    pipes
      .map(
        (p) =>
          `<option value="${esc(p.id)}" ${p.id === pipelineId ? 'selected' : ''}>${esc(p.name)} (${p.deals_count || 0})</option>`
      )
      .join('');
  const curPipe = pipes.find((p) => p.id === pipelineId);
  const statusOpts =
    '<option value="">Все статусы</option>' +
    (curPipe?.statuses || [])
      .map((st) => {
        const sid = String(st.id).includes(':') ? String(st.id).split(':').pop() : st.id;
        return `<option value="${esc(sid)}" ${sid === statusId ? 'selected' : ''}>${esc(st.name)}</option>`;
      })
      .join('');

  view.innerHTML = formChrome(
    'Сделки AmoCRM',
    `
    <p class="muted" style="margin:0 0 8px">
      Зеркало Amo + позиции заказа из amo1c. При «Отправить в 1С» сделка дублируется сюда.
      Всего: <b>${data.total ?? 0}</b>
    </p>
    ${pagerHtml('dpager', data.page, data.pages, data.total)}
    <table>
      <thead><tr><th>ID</th><th>Сделка</th><th>Воронка</th><th>Статус</th><th>Сумма</th><th>1С</th><th>Поз.</th></tr></thead>
      <tbody>
        ${
          list
            .map(
              (d) => `
          <tr class="clickable" data-deal="${esc(d.id)}">
            <td class="mono">${esc(d.id)}</td>
            <td>${esc(d.name || '—')}</td>
            <td>${esc(d.pipeline_name || '—')}</td>
            <td>${esc(d.status_name || '—')}</td>
            <td class="mono">${formatMoney(d.price)}</td>
            <td>${d.queued_to_1c ? '<span class="badge">В очереди/отправл.</span>' : '—'}</td>
            <td class="mono">${esc(d.items_count || 0)}</td>
          </tr>`
            )
            .join('') || '<tr><td colspan="7" class="muted">Нет сделок — кнопка «Сделки Amo» на главной или «Обновить» в воронках</td></tr>'
        }
      </tbody>
    </table>
    ${pagerHtml('dpager2', data.page, data.pages, data.total)}`,
    {
      toolbar: `
        <select id="d-pipe">${pipeOpts}</select>
        <select id="d-status">${statusOpts}</select>
        <button type="button" id="d-sync">Синк Amo</button>
        <div class="grow"></div>
        <div class="find">
          <input id="d-q" placeholder="Поиск id / название" value="${esc(q)}" />
          <button type="button" id="d-search">Найти</button>
        </div>`,
    }
  );
  bindFormChrome(() => showSection('crm'));
  const reload = () => renderDeals();
  document.getElementById('d-pipe').onchange = () => {
    state.dealsPipeline = document.getElementById('d-pipe').value;
    state.dealsStatus = '';
    state.dealsPage = 1;
    reload();
  };
  document.getElementById('d-status').onchange = () => {
    state.dealsStatus = document.getElementById('d-status').value;
    state.dealsPage = 1;
    reload();
  };
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
  document.getElementById('d-sync').onclick = async () => {
    try {
      await api('/crm/deals/sync', {
        method: 'POST',
        body: JSON.stringify({ days: 60, limit: 800 }),
      });
      reload();
    } catch (e) {
      alert(e.message);
    }
  };
  bindPager('dpager', (d) => {
    state.dealsPage = Math.max(1, state.dealsPage + d);
    reload();
  });
  bindPager('dpager2', (d) => {
    state.dealsPage = Math.max(1, state.dealsPage + d);
    reload();
  });
  view.querySelectorAll('[data-deal]').forEach((tr) => {
    tr.onclick = () => openTab('deal:' + tr.dataset.deal);
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

const SALES_TYPE_LABEL = {
  invoice: 'Счёт на оплату',
  upd: 'УПД',
  sf: 'Счёт-фактура',
  workorder: 'Заказ-наряд',
};

async function renderDealDetail(id) {
  const d = await api('/crm/deals/' + id);
  const title = d.name || 'Сделка ' + id;
  const tabId = 'deal:' + id;
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
  const items = d.items || [];
  const docs = d.documents || [];
  const salesDocs = d.sales_docs || [];
  const payments = d.payments || [];
  const fiscal = d.fiscal_receipts || [];
  const isLegal = !!(d.is_legal_entity || d.buyer_kind === 'legal' || String(d.buyer_inn || '').replace(/\D/g, '').length === 10);
  const buyerLabel = [d.buyer_name || d.company_name, d.buyer_inn ? 'ИНН ' + d.buyer_inn : '', isLegal ? 'юрлицо' : d.buyer_kind === 'ip' ? 'ИП' : 'физлицо']
    .filter(Boolean)
    .join(' · ');
  view.innerHTML = formChrome(
    title,
    `
    <div class="form-grid">
      <label>ID<input class="mono" value="${esc(d.id)}" readonly /></label>
      <label>Сумма<input class="mono" value="${esc(formatMoney(d.price))}" readonly /></label>
      <label>Воронка<input value="${esc(d.pipeline_name || '—')}" readonly /></label>
      <label>Статус<input value="${esc(d.status_name || '—')}" readonly /></label>
      <label>Отдел / база<input value="${esc(d.department || '—')}" readonly /></label>
      <label>Покупатель<input value="${esc(buyerLabel || '—')}" readonly /></label>
      <label>В 1С<input value="${esc(d.queued_to_1c ? 'Да · ' + (d.queue_status || '') + (d.queued_by ? ' · ' + d.queued_by : '') : 'Нет')}" readonly /></label>
    </div>
    <div class="toolbar">
      ${d.amo_url ? `<a class="primary" href="${esc(d.amo_url)}" target="_blank" rel="noopener">Открыть в Amo</a>` : ''}
      ${d.print_url ? `<a href="${esc(d.print_url)}" target="_blank" rel="noopener">Печать / PDF (виджет)</a>` : ''}
      <button type="button" id="deal-print">Печать в Учёт №1</button>
      <button class="primary" type="button" id="deal-qr" ${Number(d.price) > 0 ? '' : 'disabled'}>QR оплата</button>
      ${
        isLegal
          ? `<button class="primary" type="button" id="deal-invoice" ${items.length ? '' : 'disabled'}>Счёт для юрлица</button>`
          : ''
      }
      <button type="button" id="deal-pack" ${items.length ? '' : 'disabled'} title="Счёт + заказ-наряд + УПД">Создать все документы</button>
      ${
        isLegal
          ? ''
          : `<button type="button" id="deal-invoice" ${items.length ? '' : 'disabled'}>Создать счёт</button>`
      }
      <button type="button" id="deal-workorder" ${items.length ? '' : 'disabled'}>Создать заказ-наряд</button>
      <button type="button" id="deal-upd" ${items.length ? '' : 'disabled'}>Создать УПД</button>
      <button type="button" id="deal-sf" ${items.length ? '' : 'disabled'}>Создать СФ</button>
      <button type="button" id="deal-fiscal-advance">Чек 1 (предоплата)</button>
      <button type="button" id="deal-fiscal-full">Чек 2 (полный)</button>
      <button type="button" id="deal-resync">Обновить сделку</button>
      <button class="primary" type="button" id="deal-wh-task" ${items.length ? '' : 'disabled'}>На склад</button>
      <span class="muted" id="deal-msg"></span>
    </div>
    ${
      items.length
        ? ''
        : '<p class="muted" style="margin:8px 0">Чтобы создать счёт / заказ-наряд / УПД, в сделке нужны позиции (товары из виджета amo1c).</p>'
    }
    <h3 style="margin:16px 0 8px;font-size:13px;color:var(--taxi-green)">Оплата QR (${payments.length})</h3>
    ${
      payments.length
        ? `<table>
        <thead><tr><th>Дата</th><th>Сумма</th><th>QR</th><th>Ссылка</th><th></th></tr></thead>
        <tbody>
          ${payments
            .map(
              (p) => `
            <tr data-payment="${esc(p.id)}">
              <td>${esc(String(p.created_at || '').slice(0, 19))}</td>
              <td class="mono">${formatMoney(p.amount)}</td>
              <td>${
                p.has_image
                  ? `<img src="/api/payments/${esc(p.id)}/image.png" alt="QR" width="120" height="120" style="background:#fff;border:1px solid #ddd" />`
                  : esc(p.qrc_id || '—')
              }</td>
              <td class="mono" style="max-width:280px;word-break:break-all">${
                p.payload
                  ? `<a href="${esc(p.payload)}" target="_blank" rel="noopener">${esc(p.payload)}</a>`
                  : '—'
              }</td>
              <td>
                <button type="button" class="linkish deal-pay-del" data-pay="${esc(p.id)}" data-amount="${esc(formatMoney(p.amount))}" data-qrc="${esc(p.qrc_id || '')}" title="Удалить запись QR">Удалить</button>
              </td>
            </tr>`
            )
            .join('')}
        </tbody>
      </table>`
        : '<p class="muted">QR ещё нет — нажмите «QR оплата» (СБП Точка, сумма заказа).</p>'
    }
    <h3 style="margin:16px 0 8px;font-size:13px;color:var(--taxi-green)">Чеки АТОЛ (${fiscal.length})</h3>
    ${
      fiscal.length
        ? `<table>
        <thead><tr><th>Тип</th><th>Статус</th><th>Сумма</th><th>Дата</th></tr></thead>
        <tbody>
          ${fiscal
            .map(
              (f) => `
            <tr>
              <td>${esc(f.kind === 'advance' ? 'Предоплата' : f.kind === 'full' ? 'Полный' : f.kind)}</td>
              <td>${esc(f.status)}${f.error ? ' · ' + esc(f.error) : ''}</td>
              <td class="mono">${formatMoney(f.amount)}</td>
              <td>${esc(String(f.created_at || '').slice(0, 19))}</td>
            </tr>`
            )
            .join('')}
        </tbody>
      </table>`
        : '<p class="muted">Чеки пока черновики/не пробиты. Сначала заполните ATOL_* в .env — кнопки «Чек 1/2» готовят payload (без кассы — только prepared).</p>'
    }
    <h3 style="margin:16px 0 8px;font-size:13px;color:var(--taxi-green)">Счета, заказ-наряды, УПД (${salesDocs.length})</h3>
    ${
      salesDocs.length
        ? `<table>
        <thead><tr><th>Тип</th><th>Номер</th><th>Дата</th><th>Сумма</th><th>PDF</th></tr></thead>
        <tbody>
          ${salesDocs
            .map(
              (sd) => `
            <tr class="clickable" data-sales="${esc(sd.id)}">
              <td>${esc(SALES_TYPE_LABEL[sd.doc_type] || sd.doc_type)}</td>
              <td class="mono">${esc(sd.number)}</td>
              <td>${esc(String(sd.doc_date || '').slice(0, 10))}</td>
              <td class="mono">${formatMoney(sd.total)}</td>
              <td>
                <a href="/api/sales-docs/${esc(sd.id)}/pdf" target="_blank" rel="noopener" onclick="event.stopPropagation()">открыть</a>
                ·
                <a href="/api/sales-docs/${esc(sd.id)}/pdf?download=1" rel="noopener" onclick="event.stopPropagation()">скачать</a>
              </td>
            </tr>`
            )
            .join('')}
        </tbody>
      </table>`
        : '<p class="muted">Документов ещё нет — нажмите «Создать все документы» или отдельно счёт / заказ-наряд / УПД.</p>'
    }
    <h3 style="margin:16px 0 8px;font-size:13px;color:var(--taxi-green)">Позиции заказа (${items.length})</h3>
    ${
      items.length
        ? `<table>
        <thead><tr><th>SKU</th><th>Название</th><th>Кол-во</th><th>Цена</th><th>Сумма</th></tr></thead>
        <tbody>
          ${items
            .map(
              (l) =>
                `<tr class="${l.product_guid ? 'clickable' : ''}" ${l.product_guid ? `data-product="${esc(l.product_guid)}"` : ''}>
                  <td class="mono">${esc(l.sku || l.code || '')}</td>
                  <td>${esc(l.name || '—')}</td>
                  <td class="mono">${esc(l.qty)}</td>
                  <td class="mono">${formatMoney(l.price)}</td>
                  <td class="mono">${formatMoney(l.amount)}</td>
                </tr>`
            )
            .join('')}
        </tbody>
      </table>`
        : '<p class="muted">Позиций пока нет.</p>'
    }
    <h3 style="margin:16px 0 8px;font-size:13px;color:var(--taxi-green)">PDF по товарам (номенклатура)</h3>
    ${
      docs.length
        ? `<ul class="doc-list">${docs
            .map(
              (m) =>
                `<li><a href="${esc(m.url)}" target="_blank" rel="noopener">${esc((m.ext || 'pdf').toUpperCase())} · ${esc(m.sku || '')} · ${esc(m.product_name || '')} · ${Math.round((m.size || 0) / 1024)} КБ</a></li>`
            )
            .join('')}</ul>`
        : '<p class="muted">PDF по товарам сделки ещё нет — подтяните фото/документы номенклатуры из 1С (кнопка на карточке товара) или откройте печать виджета.</p>'
    }
    <div id="deal-print-area" class="hidden" style="margin-top:20px;padding:16px;border:1px solid #ccc;background:#fff">
      <h2 style="margin:0 0 8px">Сделка ${esc(d.id)} — ${esc(d.name || '')}</h2>
      <p>${esc(d.pipeline_name || '')} / ${esc(d.status_name || '')} · ${esc(formatMoney(d.price))}</p>
      <table style="width:100%;border-collapse:collapse">
        <thead><tr><th style="border:1px solid #ccc;text-align:left;padding:4px">SKU</th><th style="border:1px solid #ccc;text-align:left;padding:4px">Название</th><th style="border:1px solid #ccc;padding:4px">Кол-во</th><th style="border:1px solid #ccc;padding:4px">Сумма</th></tr></thead>
        <tbody>
          ${items
            .map(
              (l) =>
                `<tr><td style="border:1px solid #ccc;padding:4px">${esc(l.sku || '')}</td><td style="border:1px solid #ccc;padding:4px">${esc(l.name || '')}</td><td style="border:1px solid #ccc;padding:4px;text-align:right">${esc(l.qty)}</td><td style="border:1px solid #ccc;padding:4px;text-align:right">${formatMoney(l.amount)}</td></tr>`
            )
            .join('')}
        </tbody>
      </table>
      <p class="muted">Для PDF: Печать → «Сохранить как PDF» в браузере.</p>
    </div>
    <h3 style="margin:20px 0 8px;font-size:13px;color:var(--taxi-green)">История изменений</h3>
    <p class="muted" style="margin:0 0 8px">QR, чеки, задания склада, синк из Amo и другие действия по этой сделке.</p>
    <div id="deal-history" class="entity-history"><p class="muted" style="margin:0">Загрузка…</p></div>`
  );
  bindFormChrome(() => openTab('deals'));
  fillEntityHistory('deal-history', 'crm_deal', id);
  view.querySelectorAll('[data-product]').forEach((tr) => {
    tr.onclick = () => openTab('product:' + tr.dataset.product);
  });
  view.querySelectorAll('[data-sales]').forEach((tr) => {
    tr.onclick = () => openTab('sales:' + tr.dataset.sales);
  });
  document.getElementById('deal-print').onclick = () => {
    const area = document.getElementById('deal-print-area');
    area.classList.remove('hidden');
    const w = window.open('', '_blank');
    w.document.write(
      '<html><head><title>Сделка ' +
        esc(d.id) +
        '</title><style>body{font:13px Arial} table{border-collapse:collapse;width:100%} td,th{border:1px solid #999;padding:4px}</style></head><body>' +
        area.innerHTML +
        '</body></html>'
    );
    w.document.close();
    w.focus();
    w.print();
  };
  document.getElementById('deal-resync').onclick = async () => {
    const msg = document.getElementById('deal-msg');
    try {
      msg.textContent = 'Обновление…';
      await api('/crm/deals/sync', {
        method: 'POST',
        body: JSON.stringify({ deal_id: id }),
      });
      renderDealDetail(id);
    } catch (e) {
      msg.textContent = e.message;
    }
  };
  const whTaskBtn = document.getElementById('deal-wh-task');
  if (whTaskBtn) {
    whTaskBtn.onclick = async () => {
      const msg = document.getElementById('deal-msg');
      whTaskBtn.disabled = true;
      msg.textContent = 'Создание задания…';
      try {
        const task = await api('/crm/deals/' + id + '/warehouse-task', {
          method: 'POST',
          body: JSON.stringify({ channel: 'cdek_prepaid' }),
        });
        msg.textContent = 'Задание ' + (task.number || '');
        state.whTaskFocus = task.id;
        openTab('wh-tasks');
      } catch (e) {
        msg.textContent = e.message;
        whTaskBtn.disabled = false;
      }
    };
  }
  const makeSalesDoc = async (docType) => {
    const msg = document.getElementById('deal-msg');
    // open blank tab immediately to avoid popup blockers after await
    const pdfWin = window.open('about:blank', '_blank');
    msg.textContent = 'Создание…';
    try {
      const r = await api('/sales-docs/from-deal', {
        method: 'POST',
        body: JSON.stringify({ deal_id: id, doc_type: docType }),
      });
      const doc = r.doc;
      msg.textContent = 'Создано: ' + (doc.number || '');
      if (doc?.id) {
        const pdfUrl = '/api/sales-docs/' + encodeURIComponent(doc.id) + '/pdf';
        if (pdfWin) pdfWin.location = pdfUrl;
        else openSalesPdf(doc.id);
        openTab('sales:' + doc.id, (doc.number || docType).slice(0, 40));
        // refresh deal card in background so journal list updates when user returns
        setTimeout(() => {
          if (state.activeTab === 'deal:' + id) renderDealDetail(id);
        }, 400);
      } else if (pdfWin) pdfWin.close();
    } catch (e) {
      if (pdfWin) pdfWin.close();
      msg.textContent = e.message;
      alert(e.message);
    }
  };
  document.getElementById('deal-pack').onclick = async () => {
    const msg = document.getElementById('deal-msg');
    msg.textContent = 'Создание пакета…';
    try {
      const r = await api('/sales-docs/pack-from-deal', {
        method: 'POST',
        body: JSON.stringify({
          deal_id: id,
          types: ['invoice', 'workorder', 'upd'],
        }),
      });
      const docsCreated = r.docs || [];
      msg.textContent =
        'Создано: ' + docsCreated.map((x) => x.number).filter(Boolean).join(', ');
      for (const doc of docsCreated) {
        if (doc?.id) openSalesPdf(doc.id);
      }
      if (docsCreated[0]?.id) {
        openTab('sales:' + docsCreated[0].id, (docsCreated[0].number || '').slice(0, 40));
      }
      setTimeout(() => renderDealDetail(id), 300);
    } catch (e) {
      msg.textContent = e.message;
      alert(e.message);
    }
  };
  document.getElementById('deal-qr').onclick = async () => {
    const msg = document.getElementById('deal-msg');
    msg.textContent = 'Создание QR…';
    try {
      const r = await api('/crm/deals/' + encodeURIComponent(id) + '/sbp-qr', {
        method: 'POST',
        body: JSON.stringify({}),
      });
      msg.textContent = 'QR создан: ' + (r.payment?.qrc_id || '');
      renderDealDetail(id);
    } catch (e) {
      msg.textContent = e.message;
      alert(e.message);
    }
  };
  view.querySelectorAll('.deal-pay-del').forEach((btn) => {
    btn.onclick = async () => {
      const payId = btn.dataset.pay;
      const amount = btn.dataset.amount || '';
      const qrc = btn.dataset.qrc || '';
      if (
        !confirm(
          'Удалить запись QR ' +
            (qrc || payId) +
            (amount ? ' на ' + amount : '') +
            '?\nСама ссылка в банке не отменяется — только строка в сделке.'
        )
      ) {
        return;
      }
      const msg = document.getElementById('deal-msg');
      msg.textContent = 'Удаление QR…';
      try {
        await api('/payments/' + encodeURIComponent(payId), { method: 'DELETE' });
        msg.textContent = 'QR удалён';
        renderDealDetail(id);
      } catch (e) {
        msg.textContent = e.message;
        alert(e.message);
      }
    };
  });
  const makeFiscal = async (kind) => {
    const msg = document.getElementById('deal-msg');
    msg.textContent = kind === 'advance' ? 'Чек предоплаты…' : 'Чек полного расчёта…';
    try {
      const r = await api('/crm/deals/' + encodeURIComponent(id) + '/fiscal/' + kind, {
        method: 'POST',
        body: JSON.stringify({ send: true }),
      });
      const st = r.receipt?.status || '';
      msg.textContent =
        'Чек: ' +
        st +
        (r.atol && !r.atol.configured ? ' (черновик — задайте ATOL_* в .env)' : '');
      renderDealDetail(id);
    } catch (e) {
      msg.textContent = e.message;
      alert(e.message);
    }
  };
  document.getElementById('deal-fiscal-advance').onclick = () => makeFiscal('advance');
  document.getElementById('deal-fiscal-full').onclick = () => makeFiscal('full');
  document.getElementById('deal-invoice').onclick = () => makeSalesDoc('invoice');
  document.getElementById('deal-workorder').onclick = () => makeSalesDoc('workorder');
  document.getElementById('deal-upd').onclick = () => makeSalesDoc('upd');
  document.getElementById('deal-sf').onclick = () => makeSalesDoc('sf');
}

async function renderSalesDocs(docType) {
  const title = SALES_TYPE_LABEL[docType] || 'Документы продаж';
  const q = state.salesQ || '';
  const data = await api(
    '/sales-docs?type=' + encodeURIComponent(docType) + (q ? '&q=' + encodeURIComponent(q) : '')
  );
  const list = data.items || [];
  view.innerHTML = formChrome(
    title,
    `
    <p class="muted" style="margin:0 0 8px">
      Журнал «${esc(title)}». Создание: CRM → Сделки → открыть сделку с позициями →
      «Создать ${esc(title)}» или «Создать все документы». PDF открывается и скачивается с сервера.
    </p>
    <table>
      <thead><tr><th>Номер</th><th>Дата</th><th>Покупатель</th><th>Сделка</th><th>Сумма</th><th>PDF</th></tr></thead>
      <tbody>
        ${
          list
            .map(
              (d) => `
          <tr class="clickable" data-sales="${esc(d.id)}">
            <td class="mono">${esc(d.number)}</td>
            <td>${esc(String(d.doc_date || '').slice(0, 10))}</td>
            <td>${esc(d.counterparty_name || '—')}</td>
            <td class="mono">${
              d.deal_id
                ? `<a href="#deal" data-deal-link="${esc(d.deal_id)}" onclick="event.stopPropagation()">${esc(d.deal_id)}</a>`
                : '—'
            }</td>
            <td class="mono">${formatMoney(d.total)}</td>
            <td>
              <a href="/api/sales-docs/${esc(d.id)}/pdf" target="_blank" rel="noopener" onclick="event.stopPropagation()">открыть</a>
              ·
              <a href="/api/sales-docs/${esc(d.id)}/pdf?download=1" rel="noopener" onclick="event.stopPropagation()">скачать</a>
            </td>
          </tr>`
            )
            .join('') ||
          `<tr><td colspan="6" class="muted">Пока пусто — откройте сделку с позициями и создайте «${esc(title)}»</td></tr>`
        }
      </tbody>
    </table>`,
    {
      toolbar: `
        <button type="button" id="sales-goto-deals">Сделки Amo</button>
        <button type="button" id="sales-refresh">Обновить</button>
        <button type="button" id="sales-org">Реквизиты организации</button>
        <div class="grow"></div>
        <div class="find">
          <input id="sales-q" placeholder="Номер / покупатель / сделка" value="${esc(q)}" />
          <button type="button" id="sales-search">Найти</button>
        </div>`,
    }
  );
  bindFormChrome(() => showSection('sales'));
  document.getElementById('sales-goto-deals').onclick = () => openTab('deals');
  document.getElementById('sales-refresh').onclick = () => renderSalesDocs(docType);
  document.getElementById('sales-org').onclick = () => openTab('org');
  document.getElementById('sales-search').onclick = () => {
    state.salesQ = document.getElementById('sales-q').value.trim();
    renderSalesDocs(docType);
  };
  document.getElementById('sales-q').onkeydown = (e) => {
    if (e.key === 'Enter') {
      state.salesQ = document.getElementById('sales-q').value.trim();
      renderSalesDocs(docType);
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
  const backView =
    d.doc_type === 'upd'
      ? 'upd'
      : d.doc_type === 'sf'
        ? 'sf'
        : d.doc_type === 'workorder'
          ? 'workorders'
          : 'invoices';
  view.innerHTML = formChrome(
    title,
    `
    <div class="form-grid">
      <label>Тип<input value="${esc(typeLabel)}" readonly /></label>
      <label>Номер<input class="mono" value="${esc(d.number || '')}" readonly /></label>
      <label>Дата<input value="${esc(String(d.doc_date || '').slice(0, 10))}" readonly /></label>
      <label>Сделка<input class="mono" value="${esc(d.deal_id || '')}" readonly /></label>
      <label>Покупатель<input value="${esc(d.counterparty_name || '')}" readonly /></label>
      <label>ИНН покупателя<input class="mono" value="${esc(d.counterparty_inn || '—')}" readonly /></label>
      <label>Сумма без НДС<input class="mono" value="${esc(formatMoney(d.amount))}" readonly /></label>
      <label>НДС ${esc(d.vat_rate || 0)}%<input class="mono" value="${esc(formatMoney(d.vat_amount))}" readonly /></label>
      <label>Всего<input class="mono" value="${esc(formatMoney(d.total))}" readonly /></label>
      <label>Комментарий<input value="${esc(d.comment || '')}" readonly /></label>
    </div>
    <h3 class="form-section-title">Строки (${lines.length})</h3>
    ${
      lines.length
        ? `<table>
        <thead><tr><th>№</th><th>SKU</th><th>Название</th><th>Кол-во</th><th>Цена</th><th>Без НДС</th><th>НДС</th></tr></thead>
        <tbody>
          ${lines
            .map(
              (l) => `
            <tr>
              <td class="mono">${esc(l.line_no)}</td>
              <td class="mono">${esc(l.sku || '')}</td>
              <td>${esc(l.name || '')}</td>
              <td class="mono">${esc(l.qty)}</td>
              <td class="mono">${formatMoney(l.price)}</td>
              <td class="mono">${formatMoney(l.amount)}</td>
              <td class="mono">${formatMoney(l.vat_amount)}</td>
            </tr>`
            )
            .join('')}
        </tbody>
      </table>`
        : '<p class="muted">Нет строк</p>'
    }`,
    {
      toolbar: `
        <a class="primary" href="/api/sales-docs/${esc(id)}/pdf" target="_blank" rel="noopener">Открыть PDF</a>
        <a class="primary" href="/api/sales-docs/${esc(id)}/pdf?download=1" rel="noopener">Скачать PDF</a>
        <a href="/api/sales-docs/${esc(id)}/print" target="_blank" rel="noopener">HTML-бланк</a>
        ${d.deal_id ? `<button type="button" id="sd-deal">Открыть сделку</button>` : ''}
        <div class="grow"></div>
        <span class="muted">PDF формируется на сервере</span>`,
    }
  );
  bindFormChrome(() => openTab(backView));
  const dealBtn = document.getElementById('sd-deal');
  if (dealBtn) dealBtn.onclick = () => openTab('deal:' + d.deal_id);
}

async function renderOrgProfile() {
  const [org, num] = await Promise.all([api('/org-profile'), api('/doc-numbering')]);
  view.innerHTML = formChrome(
    'Реквизиты организации',
    `
    <p class="muted" style="margin:0 0 10px">Используются в бланках счёта, УПД и счёт-фактуры. Заполните ИНН, банк и р/с.</p>
    <h3 class="form-section-title">О продавце</h3>
    <div class="form-grid">
      <label class="span-2">Наименование<input id="org-name" value="${esc(org.name || '')}" /></label>
      <label>Кратко (подпись)<input id="org-short" value="${esc(org.short_name || '')}" /></label>
      <label>ОГРНИП<input id="org-ogrnip" class="mono" value="${esc(org.ogrnip || '')}" /></label>
      <label>ИНН<input id="org-inn" class="mono" value="${esc(org.inn || '')}" /></label>
      <label>КПП<input id="org-kpp" class="mono" value="${esc(org.kpp || '')}" /></label>
      <label class="span-2">Адрес<input id="org-address" value="${esc(org.address || '')}" /></label>
      <label>Телефон<input id="org-phone" value="${esc(org.phone || '')}" /></label>
      <label>НДС %<input id="org-vat" class="mono" value="${esc(org.vat_rate ?? 5)}" /></label>
      <label>Руководитель<input id="org-director" value="${esc(org.director || '')}" /></label>
      <label>Мастер (заказ-наряд)<input id="org-master" value="${esc(org.master_title || '')}" /></label>
    </div>
    <h3 class="form-section-title">Банковские реквизиты</h3>
    <div class="form-grid">
      <label class="span-2">Банк<input id="org-bank" value="${esc(org.bank || '')}" /></label>
      <label>БИК<input id="org-bik" class="mono" value="${esc(org.bik || '')}" /></label>
      <label>К/с<input id="org-ks" class="mono" value="${esc(org.ks || '')}" /></label>
      <label class="span-2">Р/с<input id="org-rs" class="mono" value="${esc(org.rs || '')}" /></label>
    </div>
    <h3 class="form-section-title">Нумерация документов (продолжить с 1С)</h3>
    <p class="muted" style="margin:0 0 10px">${esc(num.note || '')}</p>
    <div class="form-grid">
      <label>Последний № расход / УПД / СФ / ЗН из 1С
        <input id="num-last-out" class="mono" value="${esc(num.last_out_1c || '')}" placeholder="00НФ-003845" />
      </label>
      <label>Следующий будет
        <input class="mono" value="${esc(num.next_out || '')}" readonly />
      </label>
      <label>Последний № прихода из 1С
        <input id="num-last-in" class="mono" value="${esc(num.last_in_1c || '')}" placeholder="00НФ-000314" />
      </label>
      <label>Следующий приход
        <input class="mono" value="${esc(num.next_in || '')}" readonly />
      </label>
      <label>Последний № счёта из 1С (число)
        <input id="num-last-inv" class="mono" value="${esc(num.seq_invoice || '')}" placeholder="22640" />
      </label>
      <label>Следующий счёт
        <input class="mono" value="${esc(num.next_invoice || '')}" readonly />
      </label>
    </div>
    <p class="muted" id="org-msg"></p>
    <p class="muted" id="num-msg" style="margin-top:4px">${num.synced_at ? 'Синк 1С: ' + esc(num.synced_at) : ''}</p>`,
    {
      toolbar: `
        <button class="primary" type="button" id="org-save">Записать реквизиты</button>
        <button type="button" id="num-sync">Подтянуть номера из 1С</button>
        <button type="button" id="num-save">Сохранить нумерацию</button>
        <div class="grow"></div>`,
    }
  );
  bindFormChrome(() => showSection('company'));
  document.getElementById('org-save').onclick = async () => {
    const msg = document.getElementById('org-msg');
    const btn = document.getElementById('org-save');
    btn.disabled = true;
    msg.textContent = 'Сохранение…';
    try {
      await api('/org-profile', {
        method: 'PUT',
        body: JSON.stringify({
          name: document.getElementById('org-name').value,
          short_name: document.getElementById('org-short').value,
          ogrnip: document.getElementById('org-ogrnip').value,
          inn: document.getElementById('org-inn').value,
          kpp: document.getElementById('org-kpp').value,
          address: document.getElementById('org-address').value,
          phone: document.getElementById('org-phone').value,
          vat_rate: Number(document.getElementById('org-vat').value) || 5,
          director: document.getElementById('org-director').value,
          master_title: document.getElementById('org-master').value,
          accountant: document.getElementById('org-accountant')?.value || '',
          bank: document.getElementById('org-bank').value,
          bik: document.getElementById('org-bik').value,
          ks: document.getElementById('org-ks').value,
          rs: document.getElementById('org-rs').value,
        }),
      });
      msg.textContent = 'Сохранено';
      btn.disabled = false;
    } catch (e) {
      msg.textContent = e.message;
      btn.disabled = false;
    }
  };
  document.getElementById('num-sync').onclick = async () => {
    const msg = document.getElementById('num-msg');
    const btn = document.getElementById('num-sync');
    btn.disabled = true;
    msg.textContent = 'Запрос в 1С…';
    try {
      const r = await api('/doc-numbering/sync-from-1c', { method: 'POST', body: '{}' });
      msg.textContent =
        'Из 1С: расход ' +
        (r.last_out_1c || '—') +
        ', приход ' +
        (r.last_in_1c || '—') +
        '. След. УПД: ' +
        (r.next_out || '');
      openTab('org');
    } catch (e) {
      msg.textContent = e.message || 'Ошибка синка';
      btn.disabled = false;
    }
  };
  document.getElementById('num-save').onclick = async () => {
    const msg = document.getElementById('num-msg');
    const btn = document.getElementById('num-save');
    btn.disabled = true;
    msg.textContent = 'Сохранение нумерации…';
    try {
      const r = await api('/doc-numbering', {
        method: 'PUT',
        body: JSON.stringify({
          last_out: document.getElementById('num-last-out').value.trim(),
          last_in: document.getElementById('num-last-in').value.trim(),
          last_invoice: document.getElementById('num-last-inv').value.trim(),
        }),
      });
      msg.textContent =
        'Нумерация сохранена. След.: УПД ' + r.next_out + ', счёт ' + r.next_invoice;
      openTab('org');
    } catch (e) {
      msg.textContent = e.message || 'Ошибка';
      btn.disabled = false;
    }
  };
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
  view.innerHTML = formChrome(
    'Новый приход',
    `
    <p class="muted" style="margin:0 0 10px">Локальный приход в Учёт №1. Журнал приходных из 1С — <button type="button" class="linkish" id="in-back-list">Приходные накладные</button>.</p>
    <div class="form-grid">
      <label>Склад<select id="iwh">${whOpts}</select></label>
      <label>Комментарий<input id="icomment" /></label>
      <label>Номенклатура
        <input id="iq" placeholder="Начните вводить SKU или название…" autocomplete="off" />
        <input type="hidden" id="ipid" />
        <div id="isuggest" class="suggest hidden"></div>
        <p class="muted" id="ilabel"></p>
      </label>
      <label>Количество<input id="iqty" type="number" step="0.001" value="1" /></label>
    </div>
    <div class="toolbar">
      <button class="primary" type="button" id="ipost">Провести приход</button>
      <button type="button" id="in-cancel">К журналу</button>
      <span class="muted" id="imsg"></span>
    </div>`
  );
  bindFormChrome(() => openTab('in'));
  document.getElementById('in-back-list').onclick = () => openTab('in');
  document.getElementById('in-cancel').onclick = () => openTab('in');
  const qInput = document.getElementById('iq');
  const idInput = document.getElementById('ipid');
  const suggest = document.getElementById('isuggest');
  const label = document.getElementById('ilabel');
  const runSuggest = debounce(async () => {
    const q = qInput.value.trim();
    idInput.value = '';
    label.textContent = '';
    if (q.length < 2) {
      suggest.classList.add('hidden');
      suggest.innerHTML = '';
      return;
    }
    const data = await api('/products?limit=20&q=' + encodeURIComponent(q));
    const items = data.items || [];
    if (!items.length) {
      suggest.innerHTML = '<div class="suggest-empty muted">Нет совпадений</div>';
      suggest.classList.remove('hidden');
      return;
    }
    suggest.innerHTML = items
      .map(
        (p) =>
          `<button type="button" class="suggest-item" data-id="${esc(p.id)}" data-label="${esc(p.sku + ' — ' + productTitle(p))}">
            <span class="mono">${esc(p.sku)}</span> ${esc(productTitle(p))}
          </button>`
      )
      .join('');
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
  qInput.onfocus = () => {
    if (suggest.innerHTML) suggest.classList.remove('hidden');
  };
  view.onclick = (e) => {
    if (!suggest.contains(e.target) && e.target !== qInput) suggest.classList.add('hidden');
  };
  document.getElementById('ipost').onclick = async () => {
    const msg = document.getElementById('imsg');
    if (!idInput.value) {
      msg.textContent = 'Выберите номенклатуру из подсказки';
      return;
    }
    try {
      const doc = await api('/docs', {
        method: 'POST',
        body: JSON.stringify({
          doc_type: 'in',
          warehouse_id: document.getElementById('iwh').value,
          comment: document.getElementById('icomment').value,
          lines: [{ product_id: idInput.value, qty: Number(document.getElementById('iqty').value) }],
          post: true,
        }),
      });
      msg.textContent = 'Проведено: ' + doc.number;
      if (doc.id) setTimeout(() => openTab('doc:' + doc.id), 400);
    } catch (e) {
      msg.textContent = e.message;
    }
  };
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

async function renderMediaPhotos() {
  const q = state.mediaPhotosQ || '';
  const status = state.mediaPhotosStatus || 'all';
  const catId = state.mediaPhotosCat || '';
  const page = state.mediaPhotosPage || 1;
  let coverage;
  let list;
  try {
    const qs = new URLSearchParams({ page: String(page), limit: '50', status });
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
        По категориям видно, у кого есть фото. Поиск — по артикулу (SKU), коду 1С, штрихкоду, названию.
      </p>
      <div class="home-stats">
        <span>Товаров<b>${esc(t.products || 0)}</b></span>
        <span>С фото<b>${esc(t.with_photo || 0)}</b></span>
        <span>Без фото<b>${esc(t.without_photo || 0)}</b></span>
        <span>Покрытие<b>${esc(t.pct || 0)}%</b></span>
        <span>Файлов S3<b>${esc(t.images || 0)}</b></span>
      </div>
      <div class="toolbar" style="margin-top:10px;flex-wrap:wrap">
        <input type="search" id="mp-q" placeholder="Артикул / код / штрихкод / название" value="${esc(q)}" style="min-width:240px" />
        <select id="mp-status">
          <option value="all" ${status === 'all' ? 'selected' : ''}>Все</option>
          <option value="with" ${status === 'with' ? 'selected' : ''}>Только с фото</option>
          <option value="without" ${status === 'without' ? 'selected' : ''}>Только без фото</option>
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
    ${pagerHtml('mpager', list.page, list.pages, list.total)}
    <table>
      <thead><tr><th></th><th>SKU</th><th>Код</th><th>Название</th><th>Категория</th><th>Фото</th></tr></thead>
      <tbody>
        ${
          items.length
            ? items
                .map((p) => {
                  const n = Number(p.images_count) || 0;
                  const thumb = p.thumb_url
                    ? `<img src="${esc(p.thumb_url)}" alt="" style="width:40px;height:40px;object-fit:cover;border-radius:3px;background:#eee" />`
                    : '<span class="muted">—</span>';
                  return `<tr class="clickable" data-open="${esc(p.id)}">
                    <td>${thumb}</td>
                    <td class="mono">${esc(p.sku)}</td>
                    <td class="mono">${esc(p.code || '—')}</td>
                    <td>${esc(productTitle(p))}</td>
                    <td>${esc(p.category || '—')}</td>
                    <td class="mono" style="color:${n ? 'var(--taxi-green)' : 'var(--danger, #c33)'}">${n ? n + ' шт' : 'нет'}</td>
                  </tr>`;
                })
                .join('')
            : '<tr><td colspan="6" class="muted">Ничего не найдено</td></tr>'
        }
      </tbody>
    </table>
    ${pagerHtml('mpager2', list.page, list.pages, list.total)}`
  );
  bindFormChrome(() => showSection('warehouse'));

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

  bindPager('mpager', (dir) => {
    state.mediaPhotosPage = Math.max(1, (state.mediaPhotosPage || 1) + dir);
    reload();
  });
  bindPager('mpager2', (dir) => {
    state.mediaPhotosPage = Math.max(1, (state.mediaPhotosPage || 1) + dir);
    reload();
  });

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
    const idCount = (node.ids || []).length;
    return `
      <tr>
        <td style="padding-left:${pad}px">
          ${toggle}
          <a href="#" data-cat="${esc(node.id)}" data-name="${esc(node.name)}">${esc(node.name)}</a>
          ${
            idCount > 1
              ? `<span class="muted" style="margin-left:6px" title="Склеены одноимённые папки (пустая + с товарами)">×${idCount}</span>`
              : ''
          }
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
        База подвески (Фогель не грузим). Одноимённые пустые папки склеены с рабочими (×2).
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
    <div class="form-grid">
      <label>Название<input id="pt-name" placeholder="Например: ОПТ3" autocomplete="off" /></label>
    </div>
    <div class="toolbar">
      <button class="primary" type="button" id="pt-add">Добавить</button>
      <span class="muted" id="pt-msg"></span>
    </div>
    <table>
      <thead><tr><th>Тип цены</th><th>Товаров</th><th></th></tr></thead>
      <tbody>
        ${
          list.length
            ? list
                .map(
                  (p) => `
          <tr>
            <td>${esc(p.name)}</td>
            <td class="mono">${p.products_count}</td>
            <td>
              <button type="button" class="row-action" data-rename="${esc(p.id)}" data-name="${esc(p.name)}">Изменить</button>
              <button type="button" data-del="${esc(p.id)}" data-name="${esc(p.name)}">Удалить</button>
            </td>
          </tr>`
                )
                .join('')
            : '<tr><td colspan="3" class="muted">Пусто — добавьте тип или загрузите цены.</td></tr>'
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
  view.querySelectorAll('[data-rename]').forEach((btn) => {
    btn.onclick = async () => {
      const name = prompt('Новое название типа цены', btn.dataset.name);
      if (name == null || !name.trim() || name.trim() === btn.dataset.name) return;
      try {
        await api('/dicts/price-types/' + btn.dataset.rename, {
          method: 'PATCH',
          body: JSON.stringify({ name: name.trim() }),
        });
        renderPriceTypes();
      } catch (e) {
        alert(e.message);
      }
    };
  });
  view.querySelectorAll('[data-del]').forEach((btn) => {
    btn.onclick = async () => {
      if (
        !confirm(
          `Удалить тип «${btn.dataset.name}»? Цены этого типа у товаров тоже будут удалены.`
        )
      )
        return;
      try {
        await api('/dicts/price-types/' + btn.dataset.del, { method: 'DELETE' });
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
  manager: 'Менеджер',
  warehouse: 'Склад / СТО',
  sales: 'Продажи',
  readonly: 'Только чтение',
  none: 'Без доступа',
};

const SECTION_LABELS = {
  home: 'Главное',
  crm: 'CRM',
  sales: 'Продажи',
  purchases: 'Закупки',
  warehouse: 'Склад',
  works: 'Работы',
  production: 'Производство',
  money: 'Деньги',
  staff: 'Персонал',
  company: 'Компания',
  settings: 'Настройки',
  ideas: 'Идеи',
  help: 'Помощь',
};

async function renderStaff() {
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

  const rows = items
    .map((it) => {
      let rights = {};
      try {
        rights = JSON.parse(it.rights_json || '{}');
      } catch {
        rights = {};
      }
      const sec = (rights.sections || [])
        .map((s) => SECTION_LABELS[s] || s)
        .slice(0, 6)
        .join(', ');
      const more = (rights.sections || []).length > 6 ? '…' : '';
      return `
        <tr data-id="${esc(it.id)}">
          <td>
            <div class="fb-title">${esc(it.name)}</div>
            <div class="muted" style="font-size:12px">${esc(it.email || '—')}</div>
            ${it.is_active ? '' : '<span class="badge status-rejected">неактивен в Amo</span>'}
            ${it.has_password ? '<span class="badge status-done">пароль есть</span>' : '<span class="badge status-new">нет пароля</span>'}
            ${it.login ? `<div class="muted mono" style="font-size:11px">login: ${esc(it.login)}</div>` : ''}
          </td>
          <td class="mono" style="font-size:11px">${esc(it.amo_id || '—')}</td>
          <td>
            <div>${esc(it.one_c_name || '—')}</div>
            <div class="muted mono" style="font-size:11px">${esc(it.one_c_code || it.one_c_guid || '')}</div>
            <div class="muted" style="font-size:11px">${esc(it.department || '')}</div>
          </td>
          <td><span class="badge source">${esc(it.source || '—')}</span></td>
          <td>
            <select class="staff-role" data-id="${esc(it.id)}">
              ${Object.keys(ROLE_LABELS)
                .map(
                  (r) =>
                    `<option value="${r}" ${it.role === r ? 'selected' : ''}>${ROLE_LABELS[r]}</option>`
                )
                .join('')}
            </select>
          </td>
          <td>
            <label class="staff-check">
              <input type="checkbox" class="staff-login" data-id="${esc(it.id)}" ${it.can_login ? 'checked' : ''} />
              вход
            </label>
            <div class="muted" style="font-size:11px;margin-top:4px" title="${esc(sec + more)}">${esc(sec + more) || '—'}</div>
            <button type="button" class="linkish staff-rights" data-id="${esc(it.id)}">разделы…</button>
            <button type="button" class="linkish staff-pass" data-id="${esc(it.id)}" data-name="${esc(it.name)}">пароль…</button>
          </td>
        </tr>`;
    })
    .join('');

  view.innerHTML = formChrome(
    'Сотрудники',
    `
    <div class="panel">
      <p class="muted" style="margin:0 0 10px">
        Amo + 1С. Регистрация на /login по email. Всего: <b>${meta.total ?? items.length}</b>
        · с Amo: ${meta.amo ?? '—'} · с 1С: ${meta.oneC ?? '—'} · вход разрешён: ${meta.withLogin ?? '—'}
        ${meta.lastSync ? ' · синк: ' + esc(String(meta.lastSync).replace('T', ' ').slice(0, 19)) : ''}
      </p>
      <div class="toolbar">
        <button class="primary" type="button" id="staff-sync">Загрузить из Amo и 1С</button>
        <input type="search" id="staff-q" placeholder="Поиск…" value="${esc(q)}" style="min-width:200px" />
        <span class="muted" id="staff-msg"></span>
      </div>
    </div>
    <div class="panel">
      ${
        items.length
          ? `<table>
              <thead>
                <tr>
                  <th>ФИО / email</th>
                  <th>Amo id</th>
                  <th>1С</th>
                  <th>Источник</th>
                  <th>Роль</th>
                  <th>Права</th>
                </tr>
              </thead>
              <tbody>${rows}</tbody>
            </table>`
          : '<p class="muted">Список пуст — нажмите «Загрузить из Amo и 1С».</p>'
      }
    </div>
    <div id="staff-rights-modal" class="staff-modal hidden"></div>
    <div id="staff-pass-modal" class="staff-modal hidden"></div>`,
    { closable: true }
  );
  bindFormChrome(() => showSection('staff'));

  document.getElementById('staff-sync').onclick = async () => {
    const msg = document.getElementById('staff-msg');
    const btn = document.getElementById('staff-sync');
    btn.disabled = true;
    msg.textContent = 'Загрузка…';
    try {
      const r = await api('/staff/sync', { method: 'POST' });
      msg.textContent =
        `Готово за ${r.seconds}с: Amo ${r.amoUsers}, 1С ${r.hsEmployees}, записей ${r.upserted}, связей ${r.linked}`;
      setTimeout(() => renderStaff(), 400);
    } catch (e) {
      msg.textContent = e.message;
      btn.disabled = false;
    }
  };

  const qInput = document.getElementById('staff-q');
  let t;
  qInput.oninput = () => {
    clearTimeout(t);
    t = setTimeout(() => {
      state.staffQ = qInput.value.trim();
      renderStaff();
    }, 300);
  };

  view.querySelectorAll('.staff-role').forEach((sel) => {
    sel.onchange = async () => {
      try {
        await api('/staff/' + sel.dataset.id, {
          method: 'PATCH',
          body: JSON.stringify({ role: sel.value, apply_role_defaults: true }),
        });
        renderStaff();
      } catch (e) {
        alert(e.message);
      }
    };
  });

  view.querySelectorAll('.staff-login').forEach((cb) => {
    cb.onchange = async () => {
      try {
        await api('/staff/' + cb.dataset.id, {
          method: 'PATCH',
          body: JSON.stringify({ can_login: cb.checked }),
        });
      } catch (e) {
        alert(e.message);
        cb.checked = !cb.checked;
      }
    };
  });

  function generateStaffPassword(len = 12) {
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%';
    const bytes = new Uint8Array(len);
    crypto.getRandomValues(bytes);
    let out = '';
    for (let i = 0; i < len; i++) out += alphabet[bytes[i] % alphabet.length];
    // гарантируем букву + цифру
    if (!/[A-Za-z]/.test(out)) out = 'A' + out.slice(1);
    if (!/[0-9]/.test(out)) out = out.slice(0, -1) + '7';
    return out;
  }

  view.querySelectorAll('.staff-pass').forEach((btn) => {
    btn.onclick = () => {
      const modal = document.getElementById('staff-pass-modal');
      const name = btn.dataset.name || 'сотрудник';
      const id = btn.dataset.id;
      const pass = generateStaffPassword();
      modal.classList.remove('hidden');
      modal.innerHTML = `
        <div class="staff-modal-card">
          <h3>Пароль: ${esc(name)}</h3>
          <p class="muted" style="margin:0 0 10px;font-size:12px">
            Сгенерированный пароль покажите сотруднику один раз — потом его не увидеть.
          </p>
          <label style="display:grid;gap:4px;margin-bottom:10px">
            Пароль
            <input id="sp-pass" class="mono" value="${esc(pass)}" autocomplete="new-password" style="font-size:15px;letter-spacing:.04em" />
          </label>
          <div class="toolbar" style="margin:0 0 8px;flex-wrap:wrap;gap:8px">
            <button type="button" id="sp-gen">Сгенерировать</button>
            <button type="button" id="sp-copy">Копировать</button>
            <span class="muted" id="sp-hint"></span>
          </div>
          <div class="toolbar" style="margin:0;justify-content:flex-end;gap:8px">
            <button type="button" id="sp-cancel">Отмена</button>
            <button type="button" class="primary" id="sp-save">Сохранить пароль</button>
          </div>
          <p class="error hidden" id="sp-err" style="margin:8px 0 0"></p>
        </div>`;
      const passInput = document.getElementById('sp-pass');
      const hint = document.getElementById('sp-hint');
      const err = document.getElementById('sp-err');
      document.getElementById('sp-cancel').onclick = () => modal.classList.add('hidden');
      document.getElementById('sp-gen').onclick = () => {
        passInput.value = generateStaffPassword();
        hint.textContent = 'новый пароль';
        err.classList.add('hidden');
      };
      document.getElementById('sp-copy').onclick = async () => {
        try {
          await navigator.clipboard.writeText(passInput.value);
          hint.textContent = 'скопировано';
        } catch {
          passInput.select();
          hint.textContent = 'Ctrl+C';
        }
      };
      document.getElementById('sp-save').onclick = async () => {
        const value = passInput.value.trim();
        err.classList.add('hidden');
        if (value.length < 6) {
          err.textContent = 'Пароль не короче 6 символов';
          err.classList.remove('hidden');
          return;
        }
        const saveBtn = document.getElementById('sp-save');
        saveBtn.disabled = true;
        try {
          await api('/staff/' + id, {
            method: 'PATCH',
            body: JSON.stringify({ password: value, can_login: true }),
          });
          modal.classList.add('hidden');
          renderStaff();
        } catch (e) {
          err.textContent = e.message;
          err.classList.remove('hidden');
          saveBtn.disabled = false;
        }
      };
      passInput.focus();
      passInput.select();
    };
  });

  view.querySelectorAll('.staff-rights').forEach((btn) => {
    btn.onclick = () => {
      const it = items.find((x) => x.id === btn.dataset.id);
      if (!it) return;
      let rights = {};
      try {
        rights = JSON.parse(it.rights_json || '{}');
      } catch {
        rights = {};
      }
      const roleProdDefault = ['admin', 'manager', 'warehouse'].includes(it.role);
      const rolePriceDefault = ['admin', 'manager'].includes(it.role);
      const roleSyncDefault = it.role === 'admin';
      const roleDocsDefault = !['readonly', 'none'].includes(it.role);
      if (rights.can_edit_products === undefined) rights.can_edit_products = roleProdDefault;
      if (rights.can_edit_prices === undefined) rights.can_edit_prices = rolePriceDefault;
      if (rights.can_sync === undefined) rights.can_sync = roleSyncDefault;
      if (rights.can_edit_docs === undefined) rights.can_edit_docs = roleDocsDefault;
      const selected = new Set(rights.sections || []);
      const modal = document.getElementById('staff-rights-modal');
      modal.classList.remove('hidden');
      modal.innerHTML = `
        <div class="staff-modal-card">
          <h3>Разделы: ${esc(it.name)}</h3>
          <div class="staff-sec-grid">
            ${sections
              .map(
                (s) => `
              <label>
                <input type="checkbox" value="${esc(s)}" ${selected.has(s) ? 'checked' : ''} />
                ${esc(SECTION_LABELS[s] || s)}
              </label>`
              )
              .join('')}
          </div>
          <div class="staff-sec-grid" style="margin-top:10px">
            <label><input type="checkbox" id="r-sync" ${rights.can_sync ? 'checked' : ''} /> Синхронизация 1С</label>
            <label><input type="checkbox" id="r-products" ${rights.can_edit_products ? 'checked' : ''} /> Редактировать номенклатуру</label>
            <label><input type="checkbox" id="r-prices" ${rights.can_edit_prices ? 'checked' : ''} /> Редактировать цены</label>
            <label><input type="checkbox" id="r-docs" ${rights.can_edit_docs ? 'checked' : ''} /> Документы склада</label>
          </div>
          <div class="toolbar" style="margin-top:12px">
            <button class="primary" type="button" id="r-save">Сохранить</button>
            <button type="button" id="r-cancel">Отмена</button>
          </div>
        </div>`;
      document.getElementById('r-cancel').onclick = () => modal.classList.add('hidden');
      document.getElementById('r-save').onclick = async () => {
        const secs = [...modal.querySelectorAll('.staff-sec-grid input[type=checkbox][value]')]
          .filter((x) => x.checked)
          .map((x) => x.value);
        try {
          await api('/staff/' + it.id, {
            method: 'PATCH',
            body: JSON.stringify({
              rights: {
                sections: secs,
                can_sync: document.getElementById('r-sync').checked,
                can_edit_products: document.getElementById('r-products').checked,
                can_edit_prices: document.getElementById('r-prices').checked,
                can_edit_docs: document.getElementById('r-docs').checked,
              },
            }),
          });
          modal.classList.add('hidden');
          renderStaff();
        } catch (e) {
          alert(e.message);
        }
      };
    };
  });
}

const routes = {
  dashboard: renderDashboard,
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
    state.balPage = 1;
    renderBalances();
  },
  docs: () => {
    state.docsType = '';
    renderDocs();
  },
  in: renderIn,
  'in-new': renderInCreate,
  invoices: () => {
    state.salesQ = '';
    renderSalesDocs('invoice');
  },
  workorders: () => {
    state.salesQ = '';
    renderSalesDocs('workorder');
  },
  upd: () => {
    state.salesQ = '';
    renderSalesDocs('upd');
  },
  sf: () => {
    state.salesQ = '';
    renderSalesDocs('sf');
  },
  org: renderOrgProfile,
  ideas: renderIdeas,
  staff: renderStaff,
  audit: renderAudit,
  presence: renderPresence,
  marking: renderMarking,
  'wh-tasks': renderWarehouseTasks,
  'ops-dash': renderOpsDash,
  income: renderIncomeMirror,
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
    </div>
    <div class="toolbar" style="margin:12px 0">
      <button class="primary" type="button" id="od-tasks">Задания склада</button>
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
  document.getElementById('od-income').onclick = () => openTab('income');
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
        <button type="button" id="inc-search">Найти</button>
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
            : '<tr><td colspan="8" class="muted">Пока пусто — строки появятся после статуса «Передано»</td></tr>'
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
        <button type="button" id="wt-search">Найти</button>
        <button type="button" id="wt-reload">Обновить</button>
        <input id="wt-scan" class="mono" placeholder="Скан выдачи (штрихкод)" style="min-width:180px" />
        <button class="primary" type="button" id="wt-scan-go">Передано курьеру</button>
        <span class="muted" id="wt-msg"></span>
      </div>
    </div>

    <div style="display:grid;grid-template-columns:1fr ${detail ? 'minmax(280px,380px)' : '0fr'};gap:16px">
      <div>
        <table>
          <thead><tr><th>№</th><th>Сделка</th><th>Город</th><th>Канал</th><th>Сумма</th><th>Оплата</th><th>Статус</th><th>Позиций</th></tr></thead>
          <tbody>
            ${
              tasks.length
                ? tasks
                    .map((t) => {
                      const stLabel =
                        (meta.status_labels && meta.status_labels[t.status]) || t.status;
                      const chLabel =
                        (meta.channel_labels && meta.channel_labels[t.channel]) || t.channel;
                      return `<tr class="clickable ${t.id === focusId ? 'active' : ''}" data-task="${esc(t.id)}">
                        <td class="mono">${esc(t.number)}</td>
                        <td class="mono">${esc(t.deal_id)}</td>
                        <td>${esc(t.city || '—')}</td>
                        <td>${esc(chLabel)}</td>
                        <td class="mono">${formatMoney(t.amount_locked)}</td>
                        <td>${t.payment_required ? 'нужна' : 'нет'}</td>
                        <td>${esc(stLabel)}</td>
                        <td class="mono">${esc(t.lines_count || 0)}</td>
                      </tr>`;
                    })
                    .join('')
                : '<tr><td colspan="8" class="muted">Нет заданий — создайте кнопкой «На склад» в сделке Amo.</td></tr>'
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
          Сделка <span class="mono">${esc(detail.deal_id)}</span><br>
          Штрихкод <span class="mono">${esc(detail.barcode)}</span><br>
          Оплата: ${detail.is_paid ? 'да' : detail.payment_required ? 'нет' : 'не требуется'}
          ${detail.can_hand ? '' : ' · <b>выдача заблокирована</b>'}
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
          <button type="button" data-st="picking">Сборка</button>
          <button type="button" data-st="packed">Упаковано</button>
          <button type="button" data-st="ready">К выдаче</button>
          <button class="primary" type="button" data-st="handed" ${detail.can_hand ? '' : 'disabled'}>Передано</button>
          <button type="button" id="wt-slip">Лист упаковки</button>
          ${
            detail.cdek_widget_url
              ? `<button type="button" id="wt-cdek">СДЭК виджет</button>`
              : ''
          }
          <button type="button" id="wt-close-detail">Закрыть</button>
        </div>
        <label style="display:block;margin-top:8px">Трек СДЭК
          <input id="wt-track" class="mono" value="${esc(detail.track_number || '')}" placeholder="введите трек" />
        </label>
        <span class="muted" id="wt-detail-msg"></span>
      </div>`
          : ''
      }
    </div>`
  );

  bindFormChrome(() => showSection('warehouse'));
  const reload = () => renderWarehouseTasks();
  document.getElementById('wt-reload').onclick = reload;
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
          <p>Сделка: ${esc(slip.deal_id)} · ${esc(slip.city)} · ${esc(slip.buyer_name)}</p>
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
        Этап: <b>${esc(markingStageRu(meta.stage))}</b>
        · партий <b>${counts.lots ?? 0}</b>
        · кодов <b>${counts.codes ?? 0}</b>
        · на остатке <b>${counts.in_stock ?? 0}</b>
        · выведено <b>${counts.withdrawn ?? 0}</b>
        · ЦРПТ: ${meta.crpt && meta.crpt.configured ? 'настроен' : 'локальный учёт (Этап 5 позже)'}
      </p>
      <p class="muted" style="margin:0 0 10px">
        Наклейка: <span class="mono">артикул;завод;партия;дата</span>
        · DataMatrix сканируется в поле ниже.
      </p>
      <div class="toolbar">
        <input type="search" id="mk-q" placeholder="Поиск: партия / артикул / код" value="${esc(q)}" style="min-width:220px" />
        <button type="button" id="mk-search">Найти</button>
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
      <thead><tr><th>Партия</th><th>Товар</th><th>Завод</th><th>Склад</th><th>Статус</th><th>План</th><th>Принято</th><th>Дата</th></tr></thead>
      <tbody>
        ${
          lots.length
            ? lots
                .map(
                  (l) => `<tr class="clickable" data-product="${esc(l.product_id)}">
                    <td class="mono" title="${esc(l.id)}">${esc(l.lot_number)}</td>
                    <td>${esc(l.product_sku || '')} ${esc(l.product_name || '')}</td>
                    <td>${esc(l.factory || '—')}</td>
                    <td>${esc(l.warehouse_name || '—')}</td>
                    <td>${esc(markingLotStatusRu(l.status))}</td>
                    <td class="mono">${esc(l.qty_planned)}</td>
                    <td class="mono">${esc(l.qty_received)}</td>
                    <td class="mono">${esc(l.production_date || l.arrived_at || '—')}</td>
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
      <p class="muted" style="margin:0 0 10px">
        Онлайн = активность за последние ${data.online_sec || 120} сек. Раздел и экран обновляются при переходах.
        IP / ОС / браузер / регион — с heartbeat (регион через GeoIP-кэш).
        Сейчас: <b>${items.length}</b>
      </p>
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

async function renderAudit() {
  const q = state.auditQ || '';
  const page = state.auditPage || 1;
  let data;
  try {
    data = await api(
      `/audit?page=${page}&limit=50` + (q ? '&q=' + encodeURIComponent(q) : '')
    );
  } catch (e) {
    view.innerHTML = formChrome('История / логи', `<p class="error">${esc(e.message)}</p>`);
    bindFormChrome(() => showSection('settings'));
    return;
  }
  const items = data.items || [];
  view.innerHTML = formChrome(
    'История / логи',
    `
    <div class="panel">
      <p class="muted" style="margin:0 0 10px">
        Кто вошёл, зарегистрировался, изменил цену, добавил товар, синхронизировал 1С и т.д.
        Всего записей: <b>${data.total ?? 0}</b>
      </p>
      <div class="toolbar">
        <input type="search" id="audit-q" placeholder="Поиск по тексту / кто / действие" value="${esc(q)}" style="min-width:240px" />
        <button type="button" id="audit-reload">Обновить</button>
      </div>
    </div>
    <div class="panel">
      ${
        items.length
          ? `<table>
              <thead>
                <tr>
                  <th style="width:140px">Когда</th>
                  <th style="width:160px">Кто</th>
                  <th style="width:140px">Действие</th>
                  <th>Что</th>
                </tr>
              </thead>
              <tbody>
                ${items
                  .map(
                    (it) => `
                  <tr>
                    <td class="mono">${esc(String(it.created_at || '').replace('T', ' ').slice(0, 19))}</td>
                    <td>${esc(it.actor_name || '—')}</td>
                    <td>${auditActionBadgeHtml(it.action)}</td>
                    <td>
                      <div>${esc(it.summary || '')}</div>
                      ${it.entity ? auditEntityRefHtml(it.entity, it.entity_id) : ''}
                    </td>
                  </tr>`
                  )
                  .join('')}
              </tbody>
            </table>
            <div class="pager">
              <button type="button" id="audit-prev" ${page <= 1 ? 'disabled' : ''}>◀</button>
              <span>${page} / ${data.pages || 1}</span>
              <button type="button" id="audit-next" ${page >= (data.pages || 1) ? 'disabled' : ''}>▶</button>
            </div>`
          : '<p class="muted">Пока пусто — действия появятся после входов и изменений.</p>'
      }
    </div>`,
    { closable: true }
  );
  bindFormChrome(() => showSection('settings'));
  document.getElementById('audit-reload').onclick = () => renderAudit();
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
  const prev = document.getElementById('audit-prev');
  const next = document.getElementById('audit-next');
  if (prev) {
    prev.onclick = () => {
      state.auditPage = Math.max(1, page - 1);
      renderAudit();
    };
  }
  if (next) {
    next.onclick = () => {
      state.auditPage = page + 1;
      renderAudit();
    };
  }
}

async function loadMe() {
  try {
    state.me = await api('/me');
    const el = document.getElementById('taxi-user');
    if (el && state.me) {
      el.textContent = (state.me.name || state.me.login || 'Пользователь') + ' ▾';
      el.title = [state.me.role, state.me.email || state.me.login].filter(Boolean).join(' · ');
    }
    startPresenceTracking();
    const pBtn = document.getElementById('presence-btn');
    const pPanel = document.getElementById('presence-panel');
    const pWrap = document.getElementById('presence-wrap');
    if (pBtn && pWrap && isAdminMe()) {
      pBtn.hidden = false;
      pBtn.onclick = (e) => {
        e.stopPropagation();
        if (!pPanel) return;
        const open = pPanel.hidden;
        pPanel.hidden = !open;
        if (open) refreshPresenceChip();
      };
      document.addEventListener('click', (e) => {
        if (pPanel && !pPanel.hidden && pWrap && !pWrap.contains(e.target)) {
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
    e.preventDefault();
    showSection(btn.dataset.section);
  });
});

document.getElementById('logout').onclick = async () => {
  await api('/logout', { method: 'POST' });
  location.href = '/login';
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

(function bindRubtsovAd() {
  const wrap = document.getElementById('rb-ad');
  const btn = document.getElementById('rb-ad-toggle');
  const panel = document.getElementById('rb-ad-panel');
  if (!wrap || !btn || !panel) return;
  const setOpen = (open) => {
    wrap.classList.toggle('open', open);
    btn.setAttribute('aria-expanded', open ? 'true' : 'false');
    panel.hidden = !open;
  };
  btn.addEventListener('click', () => setOpen(panel.hidden));
  document.addEventListener('click', (e) => {
    if (!wrap.contains(e.target)) setOpen(false);
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') setOpen(false);
  });
})();

document.getElementById('global-search').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    const q = e.target.value.trim();
    if (!q) return;
    state.productsQ = q;
    state.productsPage = 1;
    openTab('products');
  }
});

document.addEventListener('keydown', (e) => {
  if (e.ctrlKey && e.shiftKey && (e.key === 'f' || e.key === 'F')) {
    e.preventDefault();
    document.getElementById('global-search').focus();
  }
});

renderTabs();
showForm();
window.addEventListener('popstate', () => {
  applyAppPath(location.pathname, true);
});
loadMe().finally(() => {
  const path = location.pathname.replace(/\/+$/, '') || '/';
  if (path !== '/' && path !== '/legacy.html') {
    applyAppPath(path, true);
    return;
  }
  setUrl('/', true);
  renderDashboard().catch((e) => {
    view.innerHTML = `<p class="error">${esc(e.message)}</p>`;
  });
});
