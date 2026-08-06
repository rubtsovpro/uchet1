/**
 * CRM extras · СТО · Производство · МП — экраны паритета меню.
 * Подключается до legacy.js; регистрируется через WmsCrmOps.install().
 */
(function () {
  const STO_STATUS_RU = {
    draft: 'Черновик',
    booked: 'Записан',
    in_progress: 'В работе',
    waiting_parts: 'Ожидает запчасть',
    ready: 'Готов',
    handed: 'Выдан',
    cancelled: 'Отменён',
  };
  const PROD_STATUS_RU = {
    draft: 'Черновик',
    in_progress: 'В работе',
    done: 'Готово',
    cancelled: 'Отменён',
  };
  const EVENT_KIND_RU = {
    note: 'Заметка',
    call: 'Звонок',
    meeting: 'Встреча',
    email: 'Письмо',
    sms: 'SMS',
  };

  function L() {
    return window.WmsLegacy || {};
  }

  function emptyNote(text) {
    return `<p class="muted" style="margin:8px 0">${L().esc(text)}</p>`;
  }

  async function renderCrmEvents() {
    const { api, esc, formChrome, bindFormChrome, showSection, formatMoney } = L();
    let data;
    try {
      data = await api('/crm/events?limit=200');
    } catch (e) {
      L().view.innerHTML = formChrome('События CRM', `<p class="error">${esc(e.message)}</p>`);
      bindFormChrome(() => showSection('crm'));
      return;
    }
    const items = data.items || [];
    L().view.innerHTML = formChrome(
      'События CRM',
      `
      <div class="panel">
        <p class="muted" style="margin:0 0 10px">${esc(data.note || '')}</p>
        <div class="form-grid">
          <label>Тип
            <select id="ev-kind">
              ${Object.entries(EVENT_KIND_RU)
                .map(([k, v]) => `<option value="${esc(k)}">${esc(v)}</option>`)
                .join('')}
            </select>
          </label>
          <label>Заголовок<input id="ev-title" placeholder="Кратко" /></label>
          <label style="grid-column:1/-1">Комментарий<input id="ev-comment" /></label>
        </div>
        <div class="toolbar">
          <button class="primary" type="button" id="ev-add">Добавить</button>
          <button type="button" id="ev-reload">Обновить</button>
          <span class="muted" id="ev-msg"></span>
        </div>
      </div>
      <table>
        <thead><tr><th>Когда</th><th>Тип</th><th>Заголовок</th><th>Комментарий</th></tr></thead>
        <tbody>
          ${
            items.length
              ? items
                  .map(
                    (r) => `<tr>
                    <td class="mono">${esc(String(r.event_at || '').replace('T', ' ').slice(0, 19))}</td>
                    <td>${esc(EVENT_KIND_RU[r.kind] || r.kind)}</td>
                    <td>${esc(r.title)}</td>
                    <td class="muted">${esc(r.comment || '')}</td>
                  </tr>`
                  )
                  .join('')
              : '<tr><td colspan="4" class="muted">Событий пока нет — добавьте вручную. Звонки МегаФон — в Amo.</td></tr>'
          }
        </tbody>
      </table>`
    );
    bindFormChrome(() => showSection('crm'));
    document.getElementById('ev-reload').onclick = () => renderCrmEvents();
    document.getElementById('ev-add').onclick = async () => {
      const msg = document.getElementById('ev-msg');
      msg.textContent = '…';
      try {
        await api('/crm/events', {
          method: 'POST',
          body: JSON.stringify({
            kind: document.getElementById('ev-kind').value,
            title: document.getElementById('ev-title').value,
            comment: document.getElementById('ev-comment').value,
          }),
        });
        renderCrmEvents();
      } catch (e) {
        msg.textContent = e.message;
      }
    };
    void formatMoney;
  }

  async function renderCrmTasks() {
    const { api, esc, formChrome, bindFormChrome, showSection } = L();
    let data;
    try {
      data = await api('/crm/tasks?limit=200');
    } catch (e) {
      L().view.innerHTML = formChrome('Задания CRM', `<p class="error">${esc(e.message)}</p>`);
      bindFormChrome(() => showSection('crm'));
      return;
    }
    const items = data.items || [];
    L().view.innerHTML = formChrome(
      'Задания CRM',
      `
      <div class="panel">
        <p class="muted" style="margin:0 0 10px">${esc(data.note || '')}</p>
        <div class="form-grid">
          <label>Задание<input id="tk-title" placeholder="Что сделать" /></label>
          <label>Срок<input id="tk-due" type="datetime-local" /></label>
          <label style="grid-column:1/-1">Комментарий<input id="tk-comment" /></label>
        </div>
        <div class="toolbar">
          <button class="primary" type="button" id="tk-add">Добавить</button>
          <button type="button" id="tk-reload">Обновить</button>
          <span class="muted" id="tk-msg"></span>
        </div>
      </div>
      <table>
        <thead><tr><th>Статус</th><th>Задание</th><th>Срок</th><th>Комментарий</th></tr></thead>
        <tbody>
          ${
            items.length
              ? items
                  .map(
                    (r) => `<tr>
                    <td>${esc(r.status)}</td>
                    <td>${esc(r.title)}</td>
                    <td class="mono">${esc(String(r.due_at || '—').replace('T', ' ').slice(0, 16))}</td>
                    <td class="muted">${esc(r.comment || '')}</td>
                  </tr>`
                  )
                  .join('')
              : '<tr><td colspan="4" class="muted">Заданий пока нет.</td></tr>'
          }
        </tbody>
      </table>`
    );
    bindFormChrome(() => showSection('crm'));
    document.getElementById('tk-reload').onclick = () => renderCrmTasks();
    document.getElementById('tk-add').onclick = async () => {
      const msg = document.getElementById('tk-msg');
      msg.textContent = '…';
      try {
        const due = document.getElementById('tk-due').value;
        await api('/crm/tasks', {
          method: 'POST',
          body: JSON.stringify({
            title: document.getElementById('tk-title').value,
            due_at: due ? new Date(due).toISOString() : undefined,
            comment: document.getElementById('tk-comment').value,
          }),
        });
        renderCrmTasks();
      } catch (e) {
        msg.textContent = e.message;
      }
    };
  }

  async function renderCrmCalendar() {
    const { api, esc, formChrome, bindFormChrome, showSection } = L();
    let data;
    try {
      data = await api('/crm/calendar?limit=120');
    } catch (e) {
      L().view.innerHTML = formChrome('Календарь', `<p class="error">${esc(e.message)}</p>`);
      bindFormChrome(() => showSection('crm'));
      return;
    }
    const items = data.items || [];
    L().view.innerHTML = formChrome(
      'Календарь CRM / СТО',
      `
      <div class="panel"><p class="muted" style="margin:0">${esc(data.note || '')}</p>
      <div class="toolbar"><button type="button" id="cal-reload">Обновить</button></div></div>
      <table>
        <thead><tr><th>Дата</th><th>Источник</th><th>Тип</th><th>Событие</th></tr></thead>
        <tbody>
          ${
            items.length
              ? items
                  .map(
                    (r) => `<tr>
                    <td class="mono">${esc(String(r.at || '').replace('T', ' ').slice(0, 16))}</td>
                    <td>${esc(r.source)}</td>
                    <td>${esc(r.kind)}</td>
                    <td>${esc(r.title)}</td>
                  </tr>`
                  )
                  .join('')
              : '<tr><td colspan="4" class="muted">Пока пусто — появятся события, задания и заказ-наряды.</td></tr>'
          }
        </tbody>
      </table>`
    );
    bindFormChrome(() => showSection('crm'));
    document.getElementById('cal-reload').onclick = () => renderCrmCalendar();
  }

  async function renderOrderStatuses(kind) {
    const { api, esc, formChrome, bindFormChrome, showSection } = L();
    const title =
      kind === 'sto' ? 'Виды и состояния заказ-нарядов' : 'Виды и состояния заказов покупателей';
    const back = kind === 'sto' ? 'works' : 'crm';
    let data;
    try {
      data = await api('/crm/order-statuses?kind=' + encodeURIComponent(kind || ''));
    } catch (e) {
      L().view.innerHTML = formChrome(title, `<p class="error">${esc(e.message)}</p>`);
      bindFormChrome(() => showSection(back));
      return;
    }
    const items = (data.items || []).filter((r) => !kind || r.kind === kind);
    L().view.innerHTML = formChrome(
      title,
      `
      <div class="panel"><p class="muted" style="margin:0 0 8px">${esc(data.note || '')}</p></div>
      <table>
        <thead><tr><th>Порядок</th><th>Вид</th><th>Название</th><th>Активен</th></tr></thead>
        <tbody>
          ${
            items.length
              ? items
                  .map(
                    (r) => `<tr>
                    <td class="mono">${esc(r.sort_order)}</td>
                    <td>${esc(r.kind === 'sto' ? 'СТО' : 'Продажи')}</td>
                    <td>${esc(r.name)}</td>
                    <td>${r.is_active ? 'да' : 'нет'}</td>
                  </tr>`
                  )
                  .join('')
              : '<tr><td colspan="4" class="muted">Справочник пуст.</td></tr>'
          }
        </tbody>
      </table>`
    );
    bindFormChrome(() => showSection(back));
  }

  async function renderStoWorkOrders() {
    const { api, esc, formChrome, bindFormChrome, showSection, formatMoney } = L();
    let data;
    try {
      data = await api('/works/orders?limit=200');
    } catch (e) {
      L().view.innerHTML = formChrome('Заказ-наряды СТО', `<p class="error">${esc(e.message)}</p>`);
      bindFormChrome(() => showSection('works'));
      return;
    }
    const items = data.items || [];
    const stOpts = Object.entries(STO_STATUS_RU)
      .map(([k, v]) => `<option value="${esc(k)}">${esc(v)}</option>`)
      .join('');
    L().view.innerHTML = formChrome(
      'Заказ-наряды СТО',
      `
      <div class="panel">
        <p class="muted" style="margin:0 0 10px">${esc(data.note || '')}</p>
        <div class="form-grid">
          <label>Клиент<input id="wo-customer" /></label>
          <label>Авто / VIN<input id="wo-vehicle" /></label>
          <label>Статус<select id="wo-status">${stOpts}</select></label>
          <label>Сумма<input id="wo-total" type="number" step="0.01" value="0" /></label>
          <label style="grid-column:1/-1">Комментарий<input id="wo-comment" placeholder="работы / приёмка в ремонт" /></label>
        </div>
        <div class="toolbar">
          <button class="primary" type="button" id="wo-add">Создать заказ-наряд</button>
          <button type="button" id="wo-reload">Обновить</button>
          <span class="muted" id="wo-msg"></span>
        </div>
      </div>
      <table>
        <thead><tr><th>Номер</th><th>Дата</th><th>Клиент</th><th>Авто</th><th>Статус</th><th>Сумма</th><th>Комментарий</th></tr></thead>
        <tbody>
          ${
            items.length
              ? items
                  .map(
                    (r) => `<tr>
                    <td class="mono">${esc(r.number)}</td>
                    <td class="mono">${esc(r.doc_date)}</td>
                    <td>${esc(r.customer_name || '—')}</td>
                    <td>${esc(r.vehicle || '—')}</td>
                    <td>${esc(STO_STATUS_RU[r.status] || r.status)}</td>
                    <td class="mono">${formatMoney(r.total)}</td>
                    <td class="muted">${esc(r.comment || '')}</td>
                  </tr>`
                  )
                  .join('')
              : '<tr><td colspan="7" class="muted">Заказ-нарядов пока нет — создайте первый. Полный экран мастера Э2 (касса/ЗП) — позже.</td></tr>'
          }
        </tbody>
      </table>`
    );
    bindFormChrome(() => showSection('works'));
    document.getElementById('wo-reload').onclick = () => renderStoWorkOrders();
    document.getElementById('wo-add').onclick = async () => {
      const msg = document.getElementById('wo-msg');
      msg.textContent = '…';
      try {
        await api('/works/orders', {
          method: 'POST',
          body: JSON.stringify({
            customer_name: document.getElementById('wo-customer').value,
            vehicle: document.getElementById('wo-vehicle').value,
            status: document.getElementById('wo-status').value,
            total: Number(document.getElementById('wo-total').value) || 0,
            comment: document.getElementById('wo-comment').value,
          }),
        });
        renderStoWorkOrders();
      } catch (e) {
        msg.textContent = e.message;
      }
    };
  }

  async function renderStoResources() {
    const { api, esc, formChrome, bindFormChrome, showSection } = L();
    let data;
    try {
      data = await api('/works/resources');
    } catch (e) {
      L().view.innerHTML = formChrome('Ресурсы СТО', `<p class="error">${esc(e.message)}</p>`);
      bindFormChrome(() => showSection('works'));
      return;
    }
    const items = data.items || [];
    L().view.innerHTML = formChrome(
      'Ресурсы СТО',
      `
      <div class="panel"><p class="muted" style="margin:0">${esc(data.note || '')}</p></div>
      <table>
        <thead><tr><th>Название</th><th>Тип</th><th>Активен</th></tr></thead>
        <tbody>
          ${
            items.length
              ? items
                  .map(
                    (r) => `<tr>
                    <td>${esc(r.name)}</td>
                    <td>${esc(r.kind === 'lift' ? 'Подъёмник' : r.kind === 'bay' ? 'Пост' : r.kind)}</td>
                    <td>${r.is_active ? 'да' : 'нет'}</td>
                  </tr>`
                  )
                  .join('')
              : '<tr><td colspan="3" class="muted">Ресурсов нет.</td></tr>'
          }
        </tbody>
      </table>`
    );
    bindFormChrome(() => showSection('works'));
  }

  async function renderProductionOrders() {
    const { api, esc, formChrome, bindFormChrome, showSection } = L();
    let data;
    try {
      data = await api('/production/orders?limit=200');
    } catch (e) {
      L().view.innerHTML = formChrome('Заказы на производство', `<p class="error">${esc(e.message)}</p>`);
      bindFormChrome(() => showSection('production'));
      return;
    }
    const items = data.items || [];
    const stOpts = Object.entries(PROD_STATUS_RU)
      .map(([k, v]) => `<option value="${esc(k)}">${esc(v)}</option>`)
      .join('');
    L().view.innerHTML = formChrome(
      'Заказы на производство',
      `
      <div class="panel">
        <p class="muted" style="margin:0 0 10px">${esc(data.note || '')}</p>
        <div class="form-grid">
          <label>Изделие / номенклатура<input id="po-name" /></label>
          <label>Кол-во<input id="po-qty" type="number" step="0.001" value="1" /></label>
          <label>Статус<select id="po-status">${stOpts}</select></label>
          <label style="grid-column:1/-1">Комментарий<input id="po-comment" /></label>
        </div>
        <div class="toolbar">
          <button class="primary" type="button" id="po-add">Создать заказ</button>
          <button type="button" id="po-reload">Обновить</button>
          <span class="muted" id="po-msg"></span>
        </div>
      </div>
      <table>
        <thead><tr><th>Номер</th><th>Дата</th><th>Изделие</th><th>Кол-во</th><th>Статус</th><th>Комментарий</th></tr></thead>
        <tbody>
          ${
            items.length
              ? items
                  .map(
                    (r) => `<tr>
                    <td class="mono">${esc(r.number)}</td>
                    <td class="mono">${esc(r.doc_date)}</td>
                    <td>${esc(r.product_name || '—')}</td>
                    <td class="mono">${esc(r.qty)}</td>
                    <td>${esc(PROD_STATUS_RU[r.status] || r.status)}</td>
                    <td class="muted">${esc(r.comment || '')}</td>
                  </tr>`
                  )
                  .join('')
              : '<tr><td colspan="6" class="muted">Заказов на производство пока нет. Списание материалов не выполняется — журнал операционный.</td></tr>'
          }
        </tbody>
      </table>`
    );
    bindFormChrome(() => showSection('production'));
    document.getElementById('po-reload').onclick = () => renderProductionOrders();
    document.getElementById('po-add').onclick = async () => {
      const msg = document.getElementById('po-msg');
      msg.textContent = '…';
      try {
        await api('/production/orders', {
          method: 'POST',
          body: JSON.stringify({
            product_name: document.getElementById('po-name').value,
            qty: Number(document.getElementById('po-qty').value) || 0,
            status: document.getElementById('po-status').value,
            comment: document.getElementById('po-comment').value,
          }),
        });
        renderProductionOrders();
      } catch (e) {
        msg.textContent = e.message;
      }
    };
  }

  async function renderMarketplaceOrders(channel) {
    const { api, esc, formChrome, bindFormChrome, showSection, formatMoney, openTab } = L();
    const ch = String(channel || '').trim();
    const titles = { ozon: 'Ozon', ym: 'Яндекс Маркет', vk: 'ВКонтакте', '': 'Заказы маркетплейсов' };
    const title = titles[ch] || 'Заказы МП';
    let data;
    try {
      const qs = new URLSearchParams({ limit: '200' });
      if (ch) qs.set('channel', ch);
      data = await api('/marketplaces/orders?' + qs.toString());
    } catch (e) {
      L().view.innerHTML = formChrome(title, `<p class="error">${esc(e.message)}</p>`);
      bindFormChrome(() => showSection('crm'));
      return;
    }
    const items = data.items || [];
    const channels = data.channels || {};
    const meta = ch ? channels[ch] : null;
    const channelNote = meta
      ? meta.note
      : Object.values(channels)
          .map((c) => `${c.label}: ${c.configured ? 'ключи есть (sync stub)' : 'ключей нет'}`)
          .join(' · ');
    L().view.innerHTML = formChrome(
      title,
      `
      <div class="panel">
        <p class="muted" style="margin:0 0 8px">${esc(data.note || '')}</p>
        <p class="muted" style="margin:0 0 10px">${esc(channelNote || '')}</p>
        <div class="toolbar">
          <button type="button" data-mp="">Все каналы</button>
          <button type="button" data-mp="ozon">Ozon</button>
          <button type="button" data-mp="ym">Я.Маркет</button>
          <button type="button" data-mp="vk">VK</button>
          <button type="button" id="mp-reload">Обновить</button>
        </div>
        ${
          ch
            ? `<div class="form-grid" style="margin-top:10px">
          <label>№ заказа<input id="mp-num" class="mono" /></label>
          <label>External ID<input id="mp-ext" class="mono" /></label>
          <label>Сумма<input id="mp-amt" type="number" step="0.01" value="0" /></label>
          <label>Статус<input id="mp-st" value="new" /></label>
          <label style="grid-column:1/-1">Комментарий<input id="mp-cmt" placeholder="ручной ввод — не live sync" /></label>
        </div>
        <div class="toolbar">
          <button class="primary" type="button" id="mp-add">Добавить вручную</button>
          <span class="muted" id="mp-msg"></span>
        </div>`
            : emptyNote('Выберите канал (Ozon / Я.Маркет / VK), чтобы добавить заказ вручную.')
        }
      </div>
      <table>
        <thead><tr><th>Канал</th><th>Номер</th><th>External</th><th>Статус</th><th>Сумма</th><th>Дата</th><th>Комментарий</th></tr></thead>
        <tbody>
          ${
            items.length
              ? items
                  .map(
                    (r) => `<tr>
                    <td>${esc((channels[r.channel] && channels[r.channel].label) || r.channel)}</td>
                    <td class="mono">${esc(r.number)}</td>
                    <td class="mono">${esc(r.external_id || '—')}</td>
                    <td>${esc(r.status)}</td>
                    <td class="mono">${formatMoney(r.amount)}</td>
                    <td class="mono">${esc(String(r.ordered_at || '').replace('T', ' ').slice(0, 16) || '—')}</td>
                    <td class="muted">${esc(r.comment || '')}</td>
                  </tr>`
                  )
                  .join('')
              : `<tr><td colspan="7" class="muted">Заказов нет. Live sync с кабинетом МП не подключён${
                  meta && !meta.configured ? ' (нет API-ключей)' : ''
                }. Можно добавить вручную.</td></tr>`
          }
        </tbody>
      </table>`
    );
    bindFormChrome(() => showSection('crm'));
    document.getElementById('mp-reload').onclick = () => renderMarketplaceOrders(ch);
    L().view.querySelectorAll('[data-mp]').forEach((btn) => {
      btn.onclick = () => {
        const v = btn.getAttribute('data-mp') || '';
        if (!v) openTab('mp-orders');
        else if (v === 'ozon') openTab('mp-ozon');
        else if (v === 'ym') openTab('mp-ym');
        else if (v === 'vk') openTab('mp-vk');
      };
    });
    const add = document.getElementById('mp-add');
    if (add) {
      add.onclick = async () => {
        const msg = document.getElementById('mp-msg');
        msg.textContent = '…';
        try {
          await api('/marketplaces/orders', {
            method: 'POST',
            body: JSON.stringify({
              channel: ch,
              number: document.getElementById('mp-num').value,
              external_id: document.getElementById('mp-ext').value,
              amount: Number(document.getElementById('mp-amt').value) || 0,
              status: document.getElementById('mp-st').value,
              comment: document.getElementById('mp-cmt').value,
            }),
          });
          renderMarketplaceOrders(ch);
        } catch (e) {
          msg.textContent = e.message;
        }
      };
    }
  }

  const VIEWS = {
    'crm-events': { title: 'События CRM', path: '/crm/events', section: 'crm', render: renderCrmEvents },
    'crm-tasks': { title: 'Задания CRM', path: '/crm/tasks', section: 'crm', render: renderCrmTasks },
    'crm-calendar': {
      title: 'Календарь',
      path: '/crm/calendar',
      section: 'crm',
      render: renderCrmCalendar,
    },
    'order-statuses': {
      title: 'Виды заказов покупателей',
      path: '/crm/order-statuses',
      section: 'crm',
      render: () => renderOrderStatuses('sales'),
    },
    'sto-workorders': {
      title: 'Заказ-наряды СТО',
      path: '/works/orders',
      section: 'works',
      render: renderStoWorkOrders,
    },
    'sto-repair': {
      title: 'Приём и передача в ремонт',
      path: '/works/repair',
      section: 'works',
      render: renderStoWorkOrders,
    },
    'sto-resources': {
      title: 'Ресурсы СТО',
      path: '/works/resources',
      section: 'works',
      render: renderStoResources,
    },
    'sto-statuses': {
      title: 'Виды заказ-нарядов',
      path: '/works/order-statuses',
      section: 'works',
      render: () => renderOrderStatuses('sto'),
    },
    'prod-orders': {
      title: 'Заказы на производство',
      path: '/production/orders',
      section: 'production',
      render: renderProductionOrders,
    },
    'mp-orders': {
      title: 'Заказы МП',
      path: '/marketplaces',
      section: 'crm',
      render: () => renderMarketplaceOrders(''),
    },
    'mp-ozon': { title: 'Ozon', path: '/marketplaces/ozon', section: 'crm', render: () => renderMarketplaceOrders('ozon') },
    'mp-ym': {
      title: 'Яндекс Маркет',
      path: '/marketplaces/ym',
      section: 'crm',
      render: () => renderMarketplaceOrders('ym'),
    },
    'mp-vk': { title: 'ВКонтакте', path: '/marketplaces/vk', section: 'crm', render: () => renderMarketplaceOrders('vk') },
  };

  function install() {
    const legacy = L();
    if (!legacy || !legacy.routes) {
      console.warn('[crm-ops] WmsLegacy not ready');
      return;
    }
    const { VIEW_TITLES, TAB_PATHS, routes, TAB_SECTION_MAP, SECTIONS } = legacy;
    for (const [id, cfg] of Object.entries(VIEWS)) {
      VIEW_TITLES[id] = cfg.title;
      TAB_PATHS[id] = cfg.path;
      routes[id] = cfg.render;
      if (TAB_SECTION_MAP) TAB_SECTION_MAP[id] = cfg.section;
    }
    // Меню CRM
    try {
      const crmLinks = SECTIONS.crm.cols[0][0].links;
      for (const link of [
        { view: 'crm-events', label: 'События' },
        { view: 'crm-tasks', label: 'Задания' },
        { view: 'crm-calendar', label: 'Календарь' },
        { view: 'order-statuses', label: 'Виды и состояния заказов' },
      ]) {
        const i = crmLinks.findIndex((l) => l.label === link.label || l.view === link.view);
        if (i >= 0) crmLinks[i] = link;
        else crmLinks.push(link);
      }
      // колонка МП
      if (!SECTIONS.crm.cols[2]) SECTIONS.crm.cols[2] = [];
      let mpGroup = SECTIONS.crm.cols[2].find((g) => g.title === 'Маркетплейсы');
      if (!mpGroup) {
        mpGroup = { title: 'Маркетплейсы', links: [] };
        SECTIONS.crm.cols[2].push(mpGroup);
      }
      mpGroup.links = [
        { view: 'mp-orders', label: 'Заказы МП' },
        { view: 'mp-ozon', label: 'Ozon' },
        { view: 'mp-ym', label: 'Яндекс Маркет' },
        { view: 'mp-vk', label: 'Магазин ВКонтакте' },
      ];
    } catch (_) {
      /* ignore structure drift */
    }
    try {
      SECTIONS.works.cols = [
        [
          {
            title: 'Работы / СТО',
            links: [
              { view: 'sto-workorders', label: 'Заказ-наряды' },
              { view: 'sto-repair', label: 'Приём и передача в ремонт' },
              { view: 'sto-resources', label: 'Ресурсы' },
              { view: 'sto-statuses', label: 'Виды и состояния заказ-нарядов' },
              { view: 'crm-calendar', label: 'Календарь' },
              { view: 'counterparties', label: 'Заказчики' },
              { view: 'products', label: 'Номенклатура (работы)' },
              { view: 'workorders', label: 'Заказ-наряды (продажи)' },
            ],
          },
        ],
      ];
    } catch (_) {
      /* ignore */
    }
    try {
      SECTIONS.production.cols = [
        [
          {
            title: 'Производство',
            links: [
              { view: 'prod-orders', label: 'Заказы на производство' },
              { view: 'prod-orders', label: 'Производство' },
              { view: 'products', label: 'Номенклатура' },
            ],
          },
        ],
      ];
    } catch (_) {
      /* ignore */
    }
    console.info('[crm-ops] installed screens:', Object.keys(VIEWS).length);
  }

  window.WmsCrmOps = { install, VIEWS };
})();
