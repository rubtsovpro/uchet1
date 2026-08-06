const view = document.getElementById('view');
const sectionPanel = document.getElementById('section-panel');
const tabsEl = document.getElementById('tabs');

const state = {
  warehouses: [],
  units: [],
  categories: [],
  productsPage: 1,
  productsQ: '',
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
  deals: 'Сделки Amo',
  pipelines: 'Воронки Amo',
  invoices: 'Счета на оплату',
  upd: 'УПД',
  sf: 'Счета-фактуры',
  workorders: 'Заказ-наряды',
  org: 'Реквизиты организации',
};

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
          links: [{ label: 'СДЭК', disabled: true }],
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
            { view: 'warehouses', label: 'Склады' },
            { view: 'balances', label: 'Остатки' },
            { view: 'docs', label: 'Документы' },
            { view: 'in', label: 'Приход' },
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
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
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

function productTitle(p) {
  const name = String(p?.name || '').trim();
  const sku = String(p?.sku || '').trim();
  if (name && !looksLikeGuid(name)) return name;
  if (sku) return sku;
  return name || p?.id || '—';
}

/** Mount real row-action buttons via DOM (avoid bare «Переименовать» text cells). */
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
                  if (l.disabled || !l.view) {
                    return `<button type="button" class="section-link disabled" disabled>${esc(l.label)}</button>`;
                  }
                  return `<button type="button" class="section-link" data-view="${esc(l.view)}">${esc(l.label)}</button>`;
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
    btn.onclick = () => openTab(btn.dataset.view);
  });
}

function showSection(section) {
  state.section = section;
  document.querySelectorAll('.taxi-sections .sec').forEach((b) => {
    b.classList.toggle('active', b.dataset.section === section);
  });
  if (section === 'home') {
    openTab('dashboard');
    return;
  }
  if (section === 'ideas') {
    openTab('ideas');
    return;
  }
  showSectionPanel();
  renderSectionMenu(section);
}

/* —— Views —— */

async function renderDashboard() {
  const s = await api('/stats');
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
  view.innerHTML = formChrome(
    'Начальная страница',
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
  const p = await api('/products/' + id);
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
  if (!state.tabs.find((t) => t.id === 'product:' + id)) {
    state.tabs.push({ id: 'product:' + id, title, closable: true });
  }
  state.activeTab = 'product:' + id;
  renderTabs();
  showForm();
  const editBlock = editable
    ? `
    <h3 style="margin:0 0 8px;font-size:13px;color:var(--taxi-green)">Карточка товара</h3>
    <div class="form-grid">
      <label>Название<input id="pe-name" value="${esc(p.name || '')}" /></label>
      <label>SKU / артикул<input id="pe-sku" class="mono" value="${esc(p.sku || '')}" /></label>
      <label>Код 1С<input id="pe-code" class="mono" value="${esc(p.code || '')}" /></label>
      <label>Бренд<input id="pe-brand" value="${esc(p.brand || '')}" /></label>
      <label>Штрихкод<input id="pe-barcode" class="mono" value="${esc(p.barcode || '')}" /></label>
      <label>Категория<select id="pe-cat">${catOpts}</select></label>
      <label>Аналоги SKU<input id="pe-array" value="${esc(p.array_sku || '')}" /></label>
      <label>Активен<select id="pe-active"><option value="1" ${p.is_active ? 'selected' : ''}>Да</option><option value="0" ${!p.is_active ? 'selected' : ''}>Нет</option></select></label>
      <label>Упак. ширина, см<input id="pe-pw" type="number" step="any" value="${p.package_width_cm != null ? esc(p.package_width_cm) : ''}" /></label>
      <label>Упак. высота, см<input id="pe-ph" type="number" step="any" value="${p.package_height_cm != null ? esc(p.package_height_cm) : ''}" /></label>
      <label>Упак. длина, см<input id="pe-pl" type="number" step="any" value="${p.package_length_cm != null ? esc(p.package_length_cm) : ''}" /></label>
      <label>Вес, г<input id="pe-pwg" type="number" step="any" value="${p.package_weight_g != null ? esc(p.package_weight_g) : ''}" /></label>
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
    <h3 style="margin:16px 0 8px;font-size:13px;color:var(--taxi-green)">Применимости</h3>
    ${
      apps.length
        ? `<table><thead><tr><th>Марка</th><th>Модель</th><th>Поколение</th><th>Годы</th></tr></thead><tbody>
        ${apps
          .map((a) => {
            if (!editable) {
              return `<tr><td>${esc(a.mark)}</td><td>${esc(a.model || a.only_model)}</td><td>${esc(a.generation)}</td><td>${esc(a.years)}</td></tr>`;
            }
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
            const opt = (list, cur) =>
              list
                .map((v) => `<option value="${esc(v)}" ${v === cur ? 'selected' : ''}>${esc(v)}</option>`)
                .join('');
            return `<tr data-app-row="${esc(a.id)}">
              <td><select class="pe-app" data-field="mark" data-id="${esc(a.id)}" style="width:100%">${opt(markList, mark)}</select></td>
              <td><select class="pe-app" data-field="model" data-id="${esc(a.id)}" style="width:100%">${opt(modelList, model)}</select></td>
              <td><select class="pe-app" data-field="generation" data-id="${esc(a.id)}" style="width:100%">${opt(genList, generation)}</select></td>
              <td><select class="pe-app" data-field="years" data-id="${esc(a.id)}" style="width:100%">${opt(yearList, years)}</select></td>
            </tr>`;
          })
          .join('')}
      </tbody></table>
      ${
        editable
          ? `<div class="toolbar"><button type="button" id="pe-apps-save">Сохранить применимости</button><span class="muted" id="pe-apps-msg"></span></div>`
          : ''
      }`
        : '<p class="muted">Нет применимостей.</p>'
    }
    ${
      related.length
        ? `<h3 style="margin:16px 0 8px;font-size:13px;color:var(--taxi-green)">Сопутствующие</h3>
      <table><thead><tr><th>SKU</th><th>Название</th></tr></thead><tbody>
        ${related.map((r) => `<tr class="clickable" data-rel="${esc(r.id)}"><td class="mono">${esc(r.sku)}</td><td>${esc(r.name)}</td></tr>`).join('')}
      </tbody></table>`
        : ''
    }`
  );
  view.querySelectorAll('[data-rel]').forEach((tr) => {
    tr.onclick = () => renderProductDetail(tr.dataset.rel);
  });
  bindFormChrome(() => openTab('products'));
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
  if (editable && apps.length) {
    const cascadeAppRow = (rowId) => {
      const tr = view.querySelector(`[data-app-row="${rowId}"]`);
      if (!tr) return;
      const markSel = tr.querySelector('.pe-app[data-field="mark"]');
      const modelSel = tr.querySelector('.pe-app[data-field="model"]');
      const genSel = tr.querySelector('.pe-app[data-field="generation"]');
      const yearsSel = tr.querySelector('.pe-app[data-field="years"]');
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
    view.querySelectorAll('.pe-app').forEach((sel) => {
      sel.onchange = () => {
        if (sel.dataset.field === 'mark' || sel.dataset.field === 'model' || sel.dataset.field === 'generation') {
          cascadeAppRow(sel.dataset.id);
        }
      };
    });
  }
  const appsSave = document.getElementById('pe-apps-save');
  if (appsSave) {
    appsSave.onclick = async () => {
      const msg = document.getElementById('pe-apps-msg');
      const byId = new Map();
      view.querySelectorAll('.pe-app').forEach((sel) => {
        const rowId = sel.dataset.id;
        if (!byId.has(rowId)) byId.set(rowId, { id: rowId });
        byId.get(rowId)[sel.dataset.field] = sel.value;
      });
      appsSave.disabled = true;
      msg.textContent = 'Сохранение…';
      try {
        await api('/products/' + id + '/applicability', {
          method: 'PUT',
          body: JSON.stringify({ applicability: [...byId.values()] }),
        });
        msg.textContent = 'Применимости сохранены';
        appsSave.disabled = false;
      } catch (e) {
        msg.textContent = e.message;
        appsSave.disabled = false;
      }
    };
  }
}

async function renderProducts(opts = {}) {
  if (opts.resetPage) state.productsPage = 1;
  await refreshRefs();
  const q = opts.q != null ? opts.q : state.productsQ;
  state.productsQ = q;
  const page = state.productsPage;
  const data = await api(
    `/products?page=${page}&limit=50` + (q ? '&q=' + encodeURIComponent(q) : '')
  );
  const list = data.items || [];
  const unitOpts = state.units.map((u) => `<option value="${esc(u.id)}">${esc(u.short_name)}</option>`).join('');
  const catOpts =
    '<option value="">—</option>' +
    state.categories.map((c) => `<option value="${esc(c.id)}">${esc(c.name)}</option>`).join('');

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
      <thead><tr><th>SKU</th><th>Название</th><th>Бренд</th><th>Ед.</th><th>Категория</th>${canEdit ? '<th class="col-actions"></th>' : ''}</tr></thead>
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
            ${canEdit ? '<td class="col-actions"></td>' : ''}
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
        <div class="grow"></div>
        <div class="find">
          <input id="pq" placeholder="Поиск (Ctrl+F)" value="${esc(q)}" autocomplete="off" />
          <button type="button" id="psearch">Найти</button>
        </div>
        <button type="button">Ещё ▾</button>`,
    }
  );
  bindFormChrome(() => showSection('warehouse'));

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
    mountRowActionButtons(view, list, {
      label: 'Переименовать',
      nameOf: (p) => productTitle(p),
      rowSelector: '.form-body tbody tr.clickable',
    });
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
      btn.onclick = async (e) => {
        e.stopPropagation();
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
      renderProductDetail(a.dataset.open);
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
  const cur = String(selected || 'supplier');
  return `<label>Тип<select id="${id}">
    <option value="supplier" ${cur === 'supplier' ? 'selected' : ''}>Поставщик</option>
    <option value="buyer" ${cur === 'buyer' ? 'selected' : ''}>Покупатель</option>
    <option value="both" ${cur === 'both' ? 'selected' : ''}>Поставщик и покупатель</option>
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
  const docs = c.docs || [];
  const docsTotal = c.docs_total ?? docs.length;
  const backList =
    state.cpMode === 'supplier'
      ? 'suppliers'
      : state.cpMode === 'buyer'
        ? 'buyers'
        : 'counterparties';
  const isBuyer = c.kind === 'buyer' || c.kind === 'both';
  const isSupplier = c.kind === 'supplier' || c.kind === 'both';

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
        <span>Телефон</span>
        <input id="ce-phone" value="${esc(c.phone || '')}" placeholder="не указан" />
      </div>
    </div>
    <h3 class="form-section-title">Классификация</h3>
    <div class="form-fields">
      <div class="field span-2">
        <span>Вид</span>
        <div class="checks">
          <label><input type="checkbox" id="ce-buyer" ${isBuyer ? 'checked' : ''} /> Покупатель</label>
          <label><input type="checkbox" id="ce-supplier" ${isSupplier ? 'checked' : ''} /> Поставщик</label>
          <select id="ce-kind" class="hidden">${['buyer', 'supplier', 'both']
            .map((k) => `<option value="${k}" ${c.kind === k ? 'selected' : ''}>${k}</option>`)
            .join('')}</select>
        </div>
      </div>
    </div>
    <h3 class="form-section-title">Адреса, телефоны</h3>
    <div class="form-fields">
      <div class="field span-2">
        <span>Телефон</span>
        <input value="${esc(c.phone || '')}" readonly placeholder="не указан" />
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

  const syncKindFromChecks = () => {
    const b = document.getElementById('ce-buyer')?.checked;
    const s = document.getElementById('ce-supplier')?.checked;
    const sel = document.getElementById('ce-kind');
    if (!sel) return;
    if (b && s) sel.value = 'both';
    else if (b) sel.value = 'buyer';
    else if (s) sel.value = 'supplier';
    else {
      // API: только buyer|supplier|both — снять оба нельзя
      document.getElementById('ce-buyer').checked = true;
      sel.value = 'buyer';
    }
  };
  document.getElementById('ce-buyer')?.addEventListener('change', syncKindFromChecks);
  document.getElementById('ce-supplier')?.addEventListener('change', syncKindFromChecks);

  const saveCp = async (andClose) => {
    syncKindFromChecks();
    const msg = document.getElementById('ce-msg') || document.getElementById('ce-toolbar-msg');
    const btn = document.getElementById('ce-save');
    const btn2 = document.getElementById('ce-save-close');
    if (btn) btn.disabled = true;
    if (btn2) btn2.disabled = true;
    if (msg) msg.textContent = 'Сохранение…';
    try {
      await api('/counterparties/' + id, {
        method: 'PATCH',
        body: JSON.stringify({
          name: document.getElementById('ce-name')?.value ?? c.name,
          inn: document.getElementById('ce-inn')?.value ?? c.inn,
          phone: document.getElementById('ce-phone')?.value ?? c.phone,
          kind: document.getElementById('ce-kind')?.value ?? c.kind,
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
    tr.onclick = () => renderDocDetail(tr.dataset.doc);
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
      <label>Телефон<input id="cphone" /></label>
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
    const created = await api('/counterparties', {
      method: 'POST',
      body: JSON.stringify({
        name: document.getElementById('cname').value,
        inn: document.getElementById('cinn').value,
        phone: document.getElementById('cphone').value,
        kind: document.getElementById('ckind').value || filterKind || 'supplier',
      }),
    });
    if (created && created.id) {
      renderCounterpartyDetail(created.id);
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
    tr.onclick = () => renderCounterpartyDetail(tr.dataset.open);
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
  const mark = (key) => {
    if (sort !== key) return '';
    return dir === 'asc' ? ' ▲' : ' ▼';
  };
  const th = (key, label) =>
    `<th class="sortable ${sort === key ? 'sorted' : ''}" data-sort="${key}" title="Сортировка">${esc(label)}${mark(key)}</th>`;
  view.innerHTML = formChrome(
    'Документы',
    `
    <p class="muted" style="margin:0 0 8px">Журнал из 1С (приход/расход) и локальные. Клик по строке — открыть документ. Клик по заголовку — сортировка.</p>
    <table>
      <thead><tr>
        ${th('number', 'Номер')}
        ${th('type', 'Тип')}
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
            <td>${esc(typeMap[d.doc_type] || d.doc_type)}</td>
            <td>${esc(String(d.doc_date || '').slice(0, 10))}</td>
            <td>${esc(d.counterparty || '—')}</td>
            <td>${esc(d.warehouse || '—')}${d.warehouse_to ? ' → ' + esc(d.warehouse_to) : ''}</td>
            <td class="mono">${d.amount != null ? formatMoney(d.amount) : '—'}</td>
            <td><span class="badge ${d.posted ? '' : 'draft'}">${d.posted ? 'Проведён' : 'Черновик'}${d.source === '1c' ? ' · 1С' : ''}</span></td>
          </tr>`
            )
            .join('') || '<tr><td colspan="7" class="muted">Документов пока нет — кнопка «Документы 1С» на главной</td></tr>'
        }
      </tbody>
    </table>`,
    {
      toolbar: `
        <button class="primary" type="button" id="goto-in">Создать приход</button>
        <button type="button" id="docs-in">Приходные</button>
        <button type="button" id="docs-out">Расходные</button>
        <button type="button" id="docs-all">Все</button>
        <div class="grow"></div>
        <div class="find">
          <input id="docs-q" placeholder="Номер / контрагент" value="${esc(q)}" />
          <button type="button" id="docs-search">Найти</button>
        </div>`,
    }
  );
  bindFormChrome(() => showSection('warehouse'));
  document.getElementById('goto-in').onclick = () => openTab('in');
  document.getElementById('docs-in').onclick = () => {
    state.docsType = 'in';
    renderDocs();
  };
  document.getElementById('docs-out').onclick = () => {
    state.docsType = 'out';
    renderDocs();
  };
  document.getElementById('docs-all').onclick = () => {
    state.docsType = '';
    renderDocs();
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
    tr.onclick = () => renderDocDetail(tr.dataset.doc);
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
    cpBtn.onclick = () => renderCounterpartyDetail(d.counterparty_id);
  }
  view.querySelectorAll('[data-product]').forEach((tr) => {
    tr.onclick = () => renderProductDetail(tr.dataset.product);
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
    tr.onclick = () => renderDealDetail(tr.dataset.deal);
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
    </div>`
  );
  bindFormChrome(() => openTab('deals'));
  view.querySelectorAll('[data-product]').forEach((tr) => {
    tr.onclick = () => renderProductDetail(tr.dataset.product);
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
  await refreshRefs();
  const whOpts = state.warehouses
    .map((w) => `<option value="${esc(w.id)}">${esc(w.name)}</option>`)
    .join('');
  view.innerHTML = formChrome(
    'Приходные накладные',
    `
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
      <span class="muted" id="imsg"></span>
    </div>`
  );
  bindFormChrome(() => showSection('purchases'));
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
            <td class="col-actions">
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
  mountRowActionButtons(view, list, {
    label: 'Изменить',
    nameOf: (p) => String(p.name || ''),
    rowSelector: '.form-body tbody tr',
    keepSelectors: '[data-del]',
  });
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
    btn.onclick = async (e) => {
      e.stopPropagation();
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

  view.querySelectorAll('.staff-pass').forEach((btn) => {
    btn.onclick = () => {
      const modal = document.getElementById('staff-pass-modal');
      const name = btn.dataset.name || 'сотрудник';
      const id = btn.dataset.id;
      const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%';
      const gen = (len = 12) => {
        const bytes = new Uint8Array(len);
        crypto.getRandomValues(bytes);
        let out = '';
        for (let i = 0; i < len; i++) out += alphabet[bytes[i] % alphabet.length];
        if (!/[A-Za-z]/.test(out)) out = 'A' + out.slice(1);
        if (!/[0-9]/.test(out)) out = out.slice(0, -1) + '7';
        return out;
      };
      const pass = gen();
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
        passInput.value = gen();
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
  docs: renderDocs,
  in: renderIn,
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
  deals: () => {
    state.dealsPage = 1;
    renderDeals();
  },
  pipelines: renderPipelines,
};

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
                    <td><span class="badge source">${esc(it.action)}</span></td>
                    <td>
                      <div>${esc(it.summary || '')}</div>
                      ${
                        it.entity
                          ? `<div class="muted" style="font-size:11px">${esc(it.entity)}${it.entity_id ? ': ' + esc(it.entity_id) : ''}</div>`
                          : ''
                      }
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
  } catch {
    /* ignore */
  }
}

document.querySelectorAll('.taxi-sections .sec').forEach((btn) => {
  btn.addEventListener('click', () => showSection(btn.dataset.section));
});

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
loadMe().finally(() => {
  renderDashboard().catch((e) => {
    view.innerHTML = `<p class="error">${esc(e.message)}</p>`;
  });
});
