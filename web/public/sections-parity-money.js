/**
 * MAP wave: Деньги / Компания / Персонал / Настройки / Главное KPI.
 * Отдельный модуль — меньше конфликтов с legacy.js и Batch A.
 * Банк/касса, валюты, СБП. Экран /money/tochka временно скрыт из меню.
 */
(function () {
  'use strict';

  function L() {
    return window.WmsLegacy || null;
  }

  function esc(s) {
    return (L() && L().esc ? L().esc(s) : String(s ?? ''))
      .replaceAll?.('&', '&amp;')
      .replaceAll?.('<', '&lt;') ||
      String(s ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
  }

  /** Превью печати/подписи на белом фоне по клику */
  function openOrgAssetPreview(src, title) {
    if (!src) return;
    let root = document.getElementById('org-asset-lightbox');
    if (!root) {
      root = document.createElement('div');
      root.id = 'org-asset-lightbox';
      document.body.appendChild(root);
    }
    root.className = 'org-asset-lightbox';
    root.innerHTML = `
      <div class="org-asset-lightbox-card" role="dialog" aria-modal="true" aria-label="${esc(title || 'Превью')}">
        <button type="button" class="org-asset-lightbox-x" aria-label="Закрыть">✕</button>
        <div class="org-asset-lightbox-stage">
          <img src="${esc(src)}" alt="${esc(title || '')}" />
        </div>
      </div>`;
    const close = () => {
      root.classList.add('hidden');
      root.innerHTML = '';
      document.removeEventListener('keydown', onKey);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') close();
    };
    root.onclick = (e) => {
      if (e.target === root || e.target.closest('.org-asset-lightbox-x')) close();
    };
    document.addEventListener('keydown', onKey);
  }

  function money(n) {
    if (L() && L().formatMoney) return L().formatMoney(n);
    const x = Number(n) || 0;
    return (
      x.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).replace(/\s/g, '\u00a0') +
      '\u00a0₽'
    );
  }

  /** @type {Array<{id:string,title:string,section:string,path:string,api:string,cols?:string[],create?:object,filterType?:string}>} */
  const JOURNALS = [
    {
      id: 'bank-docs',
      title: 'Документы по банку',
      section: 'money',
      path: '/bank-docs',
      api: '/money/bank-docs',
      cols: ['doc_date', 'number', 'doc_type', 'amount', 'counterparty', 'purpose'],
      create: { amount: true, doc_type: true, counterparty: true, purpose: true },
    },
    {
      id: 'payment-orders',
      title: 'Платежные поручения',
      section: 'money',
      path: '/payment-orders',
      api: '/money/payment-orders',
      cols: ['doc_date', 'number', 'amount', 'payee', 'purpose', 'status'],
      create: { amount: true, payee: true, purpose: true },
    },
    {
      id: 'money-transfers',
      title: 'Перемещения денег',
      section: 'money',
      path: '/money-transfers',
      api: '/money/transfers',
      cols: ['doc_date', 'number', 'amount', 'from_name', 'to_name', 'comment'],
      create: { amount: true, from_name: true, to_name: true, comment: true },
    },
    {
      id: 'cash',
      title: 'Документы по кассе',
      section: 'kassa',
      path: '/cash',
      api: '/money/cash',
      cols: ['doc_date', 'number', 'doc_type', 'amount', 'article_name', 'comment'],
      create: { amount: true, doc_type: true, comment: true },
    },
    {
      id: 'cash-in',
      title: 'Поступления в кассу',
      section: 'kassa',
      path: '/cash/in',
      api: '/money/cash',
      filterType: 'in',
      cols: ['doc_date', 'number', 'amount', 'article_name', 'comment'],
      create: { amount: true, comment: true, forceType: 'in' },
    },
    {
      id: 'cash-out',
      title: 'Расходы из кассы',
      section: 'kassa',
      path: '/cash/out',
      api: '/money/cash',
      filterType: 'out',
      cols: ['doc_date', 'number', 'amount', 'article_name', 'comment'],
      create: { amount: true, comment: true, forceType: 'out' },
    },
    {
      id: 'card-ops',
      title: 'Операции по платёжным картам',
      section: 'money',
      path: '/card-ops',
      api: '/money/card-ops',
      cols: ['doc_date', 'number', 'amount', 'card_mask', 'status', 'comment'],
      create: { amount: true, card_mask: true, comment: true },
    },
    {
      id: 'hr-docs',
      title: 'Документы по кадрам',
      section: 'staff',
      path: '/hr-docs',
      api: '/staff/hr-docs',
      cols: ['doc_date', 'number', 'doc_type', 'person_name', 'comment'],
      create: { doc_type: true, person_name: true, comment: true },
    },
  ];

  const DICTS = [
    {
      id: 'cash-articles',
      title: 'Статьи движения денег',
      section: 'kassa',
      path: '/cash-articles',
      api: '/money/cash-articles',
      post: '/money/cash-articles',
      nameField: 'name',
      extra: { kind: 'both' },
    },
    {
      id: 'cash-registers',
      title: 'Кассы',
      section: 'kassa',
      path: '/cash-registers',
      api: '/money/cash-registers',
      post: '/money/cash-registers',
      nameField: 'name',
      extra: { kind: 'cash' },
    },
    {
      id: 'job-titles',
      title: 'Должности',
      section: 'staff',
      path: '/job-titles',
      api: '/staff/job-titles',
      post: '/staff/job-titles',
      nameField: 'name',
    },
    {
      id: 'work-schedules',
      title: 'Графики работы',
      section: 'staff',
      path: '/work-schedules',
      api: '/staff/schedules',
      post: '/staff/schedules',
      nameField: 'name',
    },
    {
      id: 'work-shifts',
      title: 'Рабочие смены',
      section: 'staff',
      path: '/work-shifts',
      api: '/staff/shifts',
      post: '/staff/shifts',
      nameField: 'name',
    },
    {
      id: 'time-kinds',
      title: 'Виды рабочего времени',
      section: 'staff',
      path: '/time-kinds',
      api: '/staff/time-kinds',
      post: '/staff/time-kinds',
      nameField: 'name',
      codeField: 'code',
    },
    {
      id: 'bank-accounts',
      title: 'Банковские счета',
      section: 'company',
      path: '/bank-accounts',
      api: '/company/bank-accounts',
      post: '/company/bank-accounts',
      nameField: 'name',
      extra: { currency: 'RUB' },
    },
  ];

  async function renderJournal(cfg) {
    const leg = L();
    if (!leg) return;
    let data;
    try {
      data = await leg.api(cfg.api + (cfg.api.includes('?') ? '&' : '?') + 'limit=200');
    } catch (e) {
      leg.view.innerHTML = leg.formChrome(cfg.title, `<p class="error">${esc(e.message)}</p>`);
      leg.bindFormChrome(() => leg.showSection(cfg.section));
      return;
    }
    let items = data.items || data || [];
    if (!Array.isArray(items)) items = [];
    if (cfg.filterType) items = items.filter((r) => r.doc_type === cfg.filterType);
    const cols = cfg.cols || Object.keys(items[0] || { number: 1, amount: 1 });
    leg.view.innerHTML = leg.formChrome(
      cfg.title,
      `
      <p class="muted" style="margin:0 0 10px">${esc(data.note || 'Локальный журнал Учёт №1. Пусто — нормально.')}</p>
      <div class="toolbar" style="margin-bottom:10px">
        ${cfg.create ? `<button type="button" class="primary" id="mj-add">Добавить</button>` : ''}
        <button type="button" id="mj-reload">Обновить</button>
      </div>
      <table>
        <thead><tr>${cols.map((c) => `<th>${esc(c)}</th>`).join('')}</tr></thead>
        <tbody>
          ${
            items
              .map(
                (r) =>
                  `<tr>${cols
                    .map((c) => {
                      let v = r[c];
                      if (c === 'amount' || c === 'balance') v = money(v);
                      return `<td class="${c === 'number' || c === 'amount' ? 'mono' : ''}">${esc(v ?? '—')}</td>`;
                    })
                    .join('')}</tr>`
              )
              .join('') ||
            `<tr><td colspan="${cols.length}" class="muted">Нет записей — добавьте или дождитесь синка.</td></tr>`
          }
        </tbody>
      </table>`
    );
    leg.bindFormChrome(() => leg.showSection(cfg.section));
    const reload = document.getElementById('mj-reload');
    if (reload) reload.onclick = () => renderJournal(cfg);
    const add = document.getElementById('mj-add');
    if (add && cfg.create) {
      add.onclick = async () => {
        const body = {};
        if (cfg.create.forceType) body.doc_type = cfg.create.forceType;
        else if (cfg.create.doc_type) {
          body.doc_type = window.prompt('Тип (in/out)', 'in') || 'in';
        }
        if (cfg.create.amount) {
          body.amount = Number(window.prompt('Сумма', '0') || 0);
        }
        if (cfg.create.payee) body.payee = window.prompt('Получатель', '') || '';
        if (cfg.create.counterparty) body.counterparty = window.prompt('Контрагент', '') || '';
        if (cfg.create.purpose) body.purpose = window.prompt('Назначение', '') || '';
        if (cfg.create.from_name) body.from_name = window.prompt('Откуда', '') || '';
        if (cfg.create.to_name) body.to_name = window.prompt('Куда', '') || '';
        if (cfg.create.card_mask) body.card_mask = window.prompt('Карта (маска)', '') || '';
        if (cfg.create.person_name) body.person_name = window.prompt('ФИО', '') || '';
        if (cfg.create.doc_type && cfg.id === 'hr-docs') {
          body.doc_type = window.prompt('Тип (hire/transfer/dismiss/other)', 'hire') || 'hire';
        }
        if (cfg.create.comment) body.comment = window.prompt('Комментарий', '') || '';
        try {
          await leg.api(cfg.api, { method: 'POST', body: JSON.stringify(body) });
          renderJournal(cfg);
        } catch (e) {
          alert(e.message || String(e));
        }
      };
    }
  }

  async function renderDict(cfg) {
    const leg = L();
    if (!leg) return;
    let data;
    try {
      const apiPath =
        cfg.id === 'cash-registers' && leg.withCompanyId
          ? leg.withCompanyId(cfg.api)
          : cfg.api;
      data = await leg.api(apiPath);
    } catch (e) {
      leg.view.innerHTML = leg.formChrome(cfg.title, `<p class="error">${esc(e.message)}</p>`);
      leg.bindFormChrome(() => leg.showSection(cfg.section));
      return;
    }
    const items = Array.isArray(data) ? data : data.items || [];
    const isBank = cfg.id === 'bank-accounts';
    const isCashReg = cfg.id === 'cash-registers';
    if (isCashReg && L()?.refreshRefs) {
      try {
        await L().refreshRefs();
      } catch (_) {
        /* ignore */
      }
    }
    const orgOpts = L()?.orgOptionsHtml ? L().orgOptionsHtml('') : '<option value="">—</option>';
    leg.view.innerHTML = leg.formChrome(
      cfg.title,
      `
      <p class="muted" style="margin:0 0 10px">${esc(data.note || 'Справочник Учёт №1')}</p>
      <div class="toolbar" style="margin-bottom:10px">
        <button type="button" class="primary" id="md-add">Добавить</button>
        <button type="button" id="md-reload">Обновить</button>
      </div>
      <table>
        <thead><tr><th>Название</th><th>${isCashReg ? 'Юрлицо' : 'Код / вид'}</th><th>${isCashReg ? 'Вид' : 'Активен'}</th>${isCashReg ? '<th>Активен</th><th></th>' : ''}${isBank ? '<th></th>' : ''}</tr></thead>
        <tbody>
          ${
            items
              .map(
                (r) => `<tr>
              <td>${esc(r.name || r.title || '—')}</td>
              <td>${
                isCashReg
                  ? `${esc(r.organization_short || r.organization_name || '—')}${r.organization_inn ? `<div class="muted mono" style="font-size:11px">ИНН ${esc(r.organization_inn)}</div>` : ''}`
                  : `<span class="mono">${esc(r.code || r.kind || r.currency || r.account || '')}</span>`
              }</td>
              <td>${isCashReg ? esc(r.kind === 'operating' ? 'Операционная' : r.kind === 'cash' ? 'Наличная' : r.kind || '') : r.is_active == null || r.is_active ? 'да' : 'архив'}</td>
              ${
                isCashReg
                  ? `<td>${r.is_active == null || r.is_active ? 'да' : 'архив'}</td>
                     <td style="white-space:nowrap">
                       <button type="button" data-cr-edit="${esc(r.id)}">Изменить</button>
                       ${
                         r.can_delete
                           ? `<button type="button" data-cr-del="${esc(r.id)}" data-name="${esc(r.name || '')}">Удалить</button>`
                           : `<button type="button" disabled title="Есть документы — только архив">Удалить</button>`
                       }
                     </td>`
                  : ''
              }
              ${
                isBank
                  ? `<td style="white-space:nowrap">
                ${
                  r.is_active == null || r.is_active
                    ? `<button type="button" data-ba-arch="${esc(r.id)}">В архив</button>`
                    : `<button type="button" data-ba-on="${esc(r.id)}">Вернуть</button>`
                }
                ${
                  r.can_delete
                    ? `<button type="button" data-ba-del="${esc(r.id)}" data-name="${esc(r.name || '')}">Удалить</button>`
                    : `<button type="button" disabled title="Есть связи — только архив">Удалить</button>`
                }
              </td>`
                  : ''
              }
            </tr>`
              )
              .join('') ||
            `<tr><td colspan="${isBank || isCashReg ? 5 : 3}" class="muted">Пусто</td></tr>`
          }
        </tbody>
      </table>`
    );
    leg.bindFormChrome(() => leg.showSection(cfg.section));
    document.getElementById('md-reload').onclick = () => renderDict(cfg);
    document.getElementById('md-add').onclick = async () => {
      if (isCashReg && leg.openCreateLightbox) {
        leg.openCreateLightbox({
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
              <div class="field"><span>Юрлицо</span><select id="kr-org">${orgOpts}</select></div>
            </div>`,
          onSubmit: async (root, setMsg) => {
            const name = root.querySelector('#kr-name')?.value?.trim();
            if (!name) throw new Error('Укажите название');
            const organization_id = root.querySelector('#kr-org')?.value || '';
            if (!organization_id) throw new Error('Выберите юрлицо (организацию)');
            setMsg('Создание…');
            await leg.api(cfg.post || cfg.api, {
              method: 'POST',
              body: JSON.stringify({
                name,
                kind: root.querySelector('#kr-kind')?.value || 'cash',
                organization_id,
              }),
            });
            leg.closeCreateLightbox();
            renderDict(cfg);
          },
        });
        return;
      }
      const body = { ...(cfg.extra || {}) };
      if (cfg.codeField) body[cfg.codeField] = window.prompt('Код', '') || '';
      body[cfg.nameField || 'name'] = window.prompt('Название', '') || '';
      if (!body[cfg.nameField || 'name']) return;
      try {
        await leg.api(cfg.post || cfg.api, { method: 'POST', body: JSON.stringify(body) });
        renderDict(cfg);
      } catch (e) {
        alert(e.message || String(e));
      }
    };
    if (isCashReg) {
      leg.view.querySelectorAll('[data-cr-edit]').forEach((btn) => {
        btn.onclick = () => {
          const row = items.find((x) => String(x.id) === String(btn.dataset.crEdit));
          if (!row || !leg.openCreateLightbox) return;
          const opts = L()?.orgOptionsHtml
            ? L().orgOptionsHtml(row.organization_id || '')
            : orgOpts;
          leg.openCreateLightbox({
            title: 'Касса',
            submitLabel: 'Сохранить',
            bodyHtml: `
              <div class="form-fields">
                <div class="field span-2"><span>Название</span><input id="kr-name" value="${esc(row.name || '')}" /></div>
                <div class="field"><span>Вид</span>
                  <select id="kr-kind">
                    <option value="cash" ${row.kind === 'cash' ? 'selected' : ''}>Наличная</option>
                    <option value="operating" ${row.kind === 'operating' ? 'selected' : ''}>Операционная</option>
                  </select>
                </div>
                <div class="field"><span>Юрлицо</span><select id="kr-org">${opts}</select></div>
                <div class="field span-2"><label><input type="checkbox" id="kr-active" ${row.is_active == null || row.is_active ? 'checked' : ''}/> Активна</label></div>
              </div>`,
            onSubmit: async (root, setMsg) => {
              const name = root.querySelector('#kr-name')?.value?.trim();
              if (!name) throw new Error('Укажите название');
              const organization_id = root.querySelector('#kr-org')?.value || '';
              if (!organization_id) throw new Error('Выберите юрлицо (организацию)');
              setMsg('Сохранение…');
              await leg.api(cfg.post || cfg.api, {
                method: 'POST',
                body: JSON.stringify({
                  id: row.id,
                  name,
                  kind: root.querySelector('#kr-kind')?.value || 'cash',
                  organization_id,
                  is_active: root.querySelector('#kr-active')?.checked ? 1 : 0,
                }),
              });
              leg.closeCreateLightbox();
              renderDict(cfg);
            },
          });
        };
      });
      leg.view.querySelectorAll('[data-cr-del]').forEach((btn) => {
        btn.onclick = async () => {
          const name = btn.dataset.name || 'кассу';
          if (!confirm('Удалить «' + name + '» безвозвратно?')) return;
          try {
            await leg.api('/money/cash-registers/' + encodeURIComponent(btn.dataset.crDel), {
              method: 'DELETE',
            });
            renderDict(cfg);
          } catch (e) {
            alert(e.message || String(e));
          }
        };
      });
    }
    if (isBank) {
      leg.view.querySelectorAll('[data-ba-arch]').forEach((btn) => {
        btn.onclick = async () => {
          if (!confirm('Перенести счёт в архив?')) return;
          try {
            await leg.api('/company/bank-accounts/' + encodeURIComponent(btn.dataset.baArch) + '/archive', {
              method: 'POST',
              body: '{}',
            });
            renderDict(cfg);
          } catch (e) {
            alert(e.message || String(e));
          }
        };
      });
      leg.view.querySelectorAll('[data-ba-on]').forEach((btn) => {
        btn.onclick = async () => {
          try {
            const full = items.find((x) => String(x.id) === String(btn.dataset.baOn));
            if (!full) return;
            await leg.api('/company/bank-accounts', {
              method: 'POST',
              body: JSON.stringify({
                id: full.id,
                name: full.name,
                bank_name: full.bank_name,
                bik: full.bik,
                account: full.account,
                currency: full.currency,
                is_active: 1,
              }),
            });
            renderDict(cfg);
          } catch (e) {
            alert(e.message || String(e));
          }
        };
      });
      leg.view.querySelectorAll('[data-ba-del]').forEach((btn) => {
        btn.onclick = async () => {
          if (!confirm('Удалить счёт «' + (btn.dataset.name || '') + '»?')) return;
          try {
            await leg.api('/company/bank-accounts/' + encodeURIComponent(btn.dataset.baDel), {
              method: 'DELETE',
            });
            renderDict(cfg);
          } catch (e) {
            alert(e.message || 'Нельзя удалить: есть связи. Перенесите в архив.');
          }
        };
      });
    }
  }

  async function renderCashBook() {
    const leg = L();
    if (!leg) return;
    let data;
    try {
      data = await leg.api('/money/cash-book?limit=300');
    } catch (e) {
      leg.view.innerHTML = leg.formChrome('Кассовая книга', `<p class="error">${esc(e.message)}</p>`);
      leg.bindFormChrome(() => leg.showSection('kassa'));
      return;
    }
    const items = data.items || [];
    leg.view.innerHTML = leg.formChrome(
      'Кассовая книга',
      `
      <p class="muted">${esc(data.note || '')}</p>
      <div class="home-stats"><span>Остаток<b>${money(data.balance)}</b></span></div>
      <table>
        <thead><tr><th>Дата</th><th>№</th><th>Тип</th><th>Статья</th><th>Сумма</th><th>Остаток</th></tr></thead>
        <tbody>
          ${
            items
              .map(
                (r) => `<tr>
              <td>${esc(r.doc_date)}</td>
              <td class="mono">${esc(r.number)}</td>
              <td>${esc(r.doc_type)}</td>
              <td>${esc(r.article_name || '')}</td>
              <td class="mono">${money(r.amount)}</td>
              <td class="mono">${money(r.balance)}</td>
            </tr>`
              )
              .join('') || `<tr><td colspan="6" class="muted">Нет движений кассы</td></tr>`
          }
        </tbody>
      </table>`
    );
    leg.bindFormChrome(() => leg.showSection('kassa'));
  }

  async function renderPaymentCalendar() {
    const leg = L();
    if (!leg) return;
    let data;
    try {
      data = await leg.api('/money/payment-calendar');
    } catch (e) {
      leg.view.innerHTML = leg.formChrome('Платёжный календарь', `<p class="error">${esc(e.message)}</p>`);
      leg.bindFormChrome(() => leg.showSection('money'));
      return;
    }
    const items = data.items || [];
    leg.view.innerHTML = leg.formChrome(
      'Платёжный календарь',
      `
      <p class="muted">${esc(data.note || '')} · ${esc(data.from)} — ${esc(data.to)}</p>
      <div class="toolbar" style="margin-bottom:10px">
        <button type="button" class="primary" id="pc-add">План оплаты</button>
        <button type="button" id="pc-reload">Обновить</button>
      </div>
      <table>
        <thead><tr><th>Дата</th><th>Вид</th><th>Сумма</th><th>Контрагент</th><th>Статус</th><th>Источник</th></tr></thead>
        <tbody>
          ${
            items
              .map(
                (r) => `<tr>
              <td>${esc(r.day || r.plan_date)}</td>
              <td>${esc(r.kind)}</td>
              <td class="mono">${money(r.amount)}</td>
              <td>${esc(r.counterparty || '')}</td>
              <td>${esc(r.status || '')}</td>
              <td>${esc(r.source || '')}</td>
            </tr>`
              )
              .join('') || `<tr><td colspan="6" class="muted">Нет плановых оплат за период</td></tr>`
          }
        </tbody>
      </table>`
    );
    leg.bindFormChrome(() => leg.showSection('money'));
    document.getElementById('pc-reload').onclick = () => renderPaymentCalendar();
    document.getElementById('pc-add').onclick = async () => {
      const plan_date = window.prompt('Дата (YYYY-MM-DD)', new Date().toISOString().slice(0, 10));
      if (!plan_date) return;
      const amount = Number(window.prompt('Сумма', '0') || 0);
      const counterparty = window.prompt('Контрагент', '') || '';
      const comment = window.prompt('Комментарий', '') || '';
      try {
        await leg.api('/money/payment-calendar', {
          method: 'POST',
          body: JSON.stringify({ plan_date, amount, counterparty, comment, kind: 'out' }),
        });
        renderPaymentCalendar();
      } catch (e) {
        alert(e.message || String(e));
      }
    };
  }

  async function renderMoneyBank() {
    const leg = L();
    if (!leg) return;
    leg.view.innerHTML = leg.formChrome(
      'Банк и касса',
      `
      <p class="muted">Обзор контура денег.</p>
      <div class="panel" style="display:flex;flex-wrap:wrap;gap:10px">
        <a class="section-link" href="/bank-docs" data-view="bank-docs">Документы по банку</a>
        <a class="section-link" href="/cash" data-view="cash">Документы по кассе</a>
        <a class="section-link" href="/cash-book" data-view="cash-book">Кассовая книга</a>
        <a class="section-link" href="/payment-calendar" data-view="payment-calendar">Платёжный календарь</a>
        <a class="section-link" href="/payment-orders" data-view="payment-orders">Платёжные поручения</a>
        <a class="section-link" href="/currencies" data-view="currencies">Валюты</a>
        <a class="section-link" href="/income" data-view="income">Доход</a>
      </div>`
    );
    leg.bindFormChrome(() => leg.showSection('money'));
    leg.view.querySelectorAll('[data-view]').forEach((a) => {
      a.onclick = (e) => {
        e.preventDefault();
        leg.openTab(a.dataset.view);
      };
    });
  }

  async function renderKpi(kind) {
    const leg = L();
    if (!leg) return;
    let data;
    try {
      data = await leg.api('/home/kpi');
    } catch (e) {
      leg.view.innerHTML = leg.formChrome('KPI', `<p class="error">${esc(e.message)}</p>`);
      leg.bindFormChrome(() => leg.showSection('home'));
      return;
    }
    const titles = {
      'kpi-debts-in': 'Долги нам',
      'kpi-debts-out': 'Долги наши',
      'kpi-net-assets': 'Чистые активы',
      'kpi-leads': 'Лиды',
      'kpi-sales-ytd': 'Продажи (с начала года)',
      'kpi-conversion': 'Конверсия заказов',
      'kpi-sales-dyn': 'Динамика продаж',
      'kpi-spend': 'Структура списания денег',
      'home-todos': 'Текущие дела',
    };
    const title = titles[kind] || 'KPI';
    let body = `<p class="muted">${esc(data.note || '')}</p>`;
    if (kind === 'kpi-debts-in') {
      body += `<div class="home-stats"><span>Дебиторка<b>${money(data.debts_receivable.amount)}</b></span></div>
        <p class="muted">${esc(data.debts_receivable.note)}</p>`;
    } else if (kind === 'kpi-debts-out') {
      body += `<div class="home-stats"><span>Кредиторка<b>${money(data.debts_payable.amount)}</b></span></div>
        <p class="muted">${esc(data.debts_payable.note)}</p>`;
    } else if (kind === 'kpi-net-assets') {
      body += `<div class="home-stats"><span>Чистые активы (черновик)<b>${money(data.net_assets.amount)}</b></span>
        <span>Касса<b>${money(data.money_balance)}</b></span>
        <span>Склад оценка<b>${money(data.stock_value_retail_est)}</b></span></div>
        <p class="muted">${esc(data.net_assets.note)}</p>`;
    } else if (kind === 'kpi-leads') {
      body += `<div class="home-stats"><span>Лиды в Учёте<b>${esc(data.leads.count)}</b></span></div>
        <p class="muted">${esc(data.leads.note)}</p>
        <p><a href="/deals" data-view="deals">Сделки Amo</a></p>`;
    } else if (kind === 'kpi-sales-ytd') {
      body += `<div class="home-stats"><span>Продажи ${esc(data.sales_ytd.year)}<b>${money(data.sales_ytd.amount)}</b></span>
        <span>Документов<b>${esc(data.sales_ytd.docs)}</b></span></div>`;
    } else if (kind === 'kpi-conversion') {
      body += `<div class="home-stats"><span>Конверсия заказов<b>${esc(data.order_conversion_pct)}%</b></span></div>
        <p class="muted">По статусам сделок Amo (эвристика).</p>`;
    } else if (kind === 'kpi-sales-dyn') {
      const rows = data.sales_dynamics || [];
      body += `<table><thead><tr><th>Месяц</th><th>Сумма</th></tr></thead><tbody>
        ${
          rows.map((r) => `<tr><td>${esc(r.ym)}</td><td class="mono">${money(r.amount)}</td></tr>`).join('') ||
          '<tr><td colspan="2" class="muted">Нет данных</td></tr>'
        }
      </tbody></table>`;
    } else if (kind === 'kpi-spend') {
      const rows = data.money_spend_structure || [];
      body += `<table><thead><tr><th>Статья</th><th>Сумма</th></tr></thead><tbody>
        ${
          rows.map((r) => `<tr><td>${esc(r.name)}</td><td class="mono">${money(r.amount)}</td></tr>`).join('') ||
          '<tr><td colspan="2" class="muted">Нет расходов кассы</td></tr>'
        }
      </tbody></table>`;
    } else if (kind === 'home-todos') {
      body += `<ul>${(data.todos || [])
        .map(
          (t) =>
            `<li>${esc(t.label)} — <span class="muted">${esc(t.status)}</span>
            ${t.href ? ` · <a href="${esc(t.href)}">${esc(t.href)}</a>` : ' (остаётся в 1С)'}</li>`
        )
        .join('')}</ul>`;
    }
    leg.view.innerHTML = leg.formChrome(title, body);
    leg.bindFormChrome(() => leg.showSection('home'));
    leg.view.querySelectorAll('[data-view]').forEach((a) => {
      a.onclick = (e) => {
        e.preventDefault();
        leg.openTab(a.dataset.view);
      };
    });
  }

  async function renderCompanyAnalytics(kind) {
    const leg = L();
    if (!leg) return;
    let data;
    try {
      data = await leg.api('/company/analytics');
    } catch (e) {
      leg.view.innerHTML = leg.formChrome('Аналитика', `<p class="error">${esc(e.message)}</p>`);
      leg.bindFormChrome(() => leg.showSection('company'));
      return;
    }
    const title = 'Анализ бизнеса';
    const st = data.state || {};
    leg.view.innerHTML = leg.formChrome(
      title,
      `
      <p class="muted">${esc(data.note || '')}</p>
      <div class="home-stats">
        <span>Номенклатура<b>${esc(st.products)}</b></span>
        <span>Контрагенты<b>${esc(st.counterparties)}</b></span>
        <span>Сделки<b>${esc(st.deals_open)}</b></span>
        <span>Задания склада<b>${esc(st.warehouse_tasks_open)}</b></span>
        <span>Продажи с начала года<b>${money((data.sales_ytd && data.sales_ytd.amount) || 0)}</b></span>
        <span>Касса<b>${money(data.money_balance)}</b></span>
      </div>
      <h3 style="font-size:13px;margin:16px 0 8px">Динамика продаж</h3>
      <table><thead><tr><th>Месяц</th><th>Сумма</th></tr></thead><tbody>
        ${
          (data.sales_dynamics || [])
            .map((r) => `<tr><td>${esc(r.ym)}</td><td class="mono">${money(r.amount)}</td></tr>`)
            .join('') || '<tr><td colspan="2" class="muted">Нет данных</td></tr>'
        }
      </tbody></table>`
    );
    leg.bindFormChrome(() => leg.showSection('company'));
  }

  /** Вкладка карточки: data | legal | warehouses */
  let companyCardTab = 'data';

  function orgCompanyId(leg) {
    return String((leg && leg.state && leg.state.orgCompanyId) || '');
  }

  function setOrgCompanyId(leg, id) {
    if (!leg || !leg.state) return;
    leg.state.orgCompanyId = id ? String(id) : '';
    if (typeof leg.setUrl === 'function' && typeof leg.pathForTab === 'function') {
      leg.setUrl(leg.pathForTab('organizations'));
    }
  }

  async function renderOrganizations() {
    const leg = L();
    if (!leg) return;
    const focusId = orgCompanyId(leg);
    if (focusId) {
      await renderCompanyCard(focusId);
      return;
    }
    const data = await leg.api('/company/companies');
    const items = data.items || [];
    leg.view.innerHTML = leg.formChrome(
      'Организации',
      `
      <div class="toolbar" style="margin-bottom:10px">
        <button type="button" class="primary" id="co-add">Добавить организацию</button>
        <div class="grow"></div>
      </div>
      <div class="table-scroll"><table class="data-table is-dense" data-table-key="companies-v2" data-no-col-filter="1">
        <thead><tr>
          <th data-col-id="name">Организация</th>
          <th data-col-id="code">Код</th>
          <th data-col-id="legal">Юрлица</th>
          <th data-col-id="wh">Склады</th>
          <th data-col-id="status">Статус</th>
        </tr></thead>
        <tbody>
          ${
            items
              .map((c) => {
                const status = c.is_active
                  ? '<span class="badge">Активен</span>'
                  : '<span class="muted">Архив</span>';
                return `<tr class="clickable" data-co-open="${esc(c.id)}">
            <td>${esc(c.name)}</td>
            <td class="mono">${esc(c.code || '')}</td>
            <td class="mono">${esc(String(c.active_legal_entities ?? c.legal_entities ?? 0))}</td>
            <td class="mono">${esc(String(c.active_warehouses ?? c.warehouses ?? 0))}</td>
            <td>${status}</td>
          </tr>`;
              })
              .join('') || `<tr><td colspan="5" class="muted">Нет организаций — добавьте контур</td></tr>`
          }
        </tbody>
      </table></div>`
    );
    leg.bindFormChrome(() => leg.showSection('company'));
    document.getElementById('co-add').onclick = async () => {
      const name = prompt(
        'Название организации (контура бизнеса).\nНапример: Фогель.\nВнутри потом добавите юрлица и склады.',
        'Фогель'
      );
      if (!name || !name.trim()) return;
      try {
        const row = await leg.api('/company/companies', {
          method: 'POST',
          body: JSON.stringify({ name: name.trim() }),
        });
        setOrgCompanyId(leg, row.id);
        renderOrganizations();
      } catch (e) {
        alert(e.message || String(e));
      }
    };
    leg.view.querySelectorAll('[data-co-open]').forEach((el) => {
      el.onclick = (e) => {
        e.stopPropagation();
        setOrgCompanyId(leg, el.getAttribute('data-co-open') || '');
        renderOrganizations();
      };
    });
  }

  async function renderCompanyCard(companyId) {
    const leg = L();
    if (!leg) return;
    const co = await leg.api('/company/companies/' + encodeURIComponent(companyId));
    const legal = co.legal_entities || [];
    const whs = co.warehouses || [];
    const activeWh = whs.filter((w) => Number(w.is_active) !== 0);
    const archWh = whs.filter((w) => Number(w.is_active) === 0);
    if (companyCardTab !== 'data' && companyCardTab !== 'legal' && companyCardTab !== 'warehouses') {
      companyCardTab = 'data';
    }
    const tabData = companyCardTab === 'data';
    const tabLegal = companyCardTab === 'legal';
    const tabWh = companyCardTab === 'warehouses';

    const dataPanel = `
      <div class="form-grid">
        <label class="span-2">Название организации
          <input id="co-name" value="${esc(co.name || '')}" />
        </label>
        <label>Код<input id="co-code" class="mono" value="${esc(co.code || '')}" /></label>
      </div>
      <div class="form-actions">
        <button type="button" class="primary" id="co-save">Записать</button>
        <span class="muted" id="co-msg"></span>
      </div>`;

    const legalPanel = `
      <div class="toolbar" style="margin-bottom:8px">
        <button type="button" class="primary" id="le-add">Добавить юрлицо</button>
      </div>
      <div class="table-scroll"><table class="data-table is-dense" data-table-key="company-legal-v2" data-no-col-filter="1">
        <thead><tr>
          <th data-col-id="name">Название</th>
          <th data-col-id="inn">ИНН</th>
          <th data-col-id="kpp">КПП</th>
          <th data-col-id="status">Статус</th>
        </tr></thead>
        <tbody>
          ${
            legal
              .map((r) => {
                const status = r.is_active
                  ? '<span class="badge">Активен</span>'
                  : '<span class="muted">Архив</span>';
                return `<tr class="clickable" data-le-open="${esc(r.id)}">
            <td>${esc(r.name)}</td>
            <td class="mono">${esc(r.inn || '')}</td>
            <td class="mono">${esc(r.kpp || '—')}</td>
            <td>${status}</td>
          </tr>`;
              })
              .join('') || `<tr><td colspan="4" class="muted">Нет юрлиц — добавьте</td></tr>`
          }
        </tbody>
      </table></div>
      <div id="org-editor" style="display:none;margin-top:16px"></div>`;

    const whPanel = `
      <div class="toolbar" style="margin-bottom:8px">
        <button type="button" class="primary" id="wh-add">Добавить склад</button>
      </div>
      <div class="table-scroll"><table class="data-table is-dense" data-table-key="company-wh-v2" data-no-col-filter="1">
        <thead><tr>
          <th data-col-id="code">Код</th>
          <th data-col-id="name">Название</th>
          <th data-col-id="status">Статус</th>
        </tr></thead>
        <tbody>
          ${
            activeWh
              .map(
                (w) => `<tr class="clickable" data-wh-open="${esc(w.id)}">
            <td class="mono">${esc(w.code)}</td>
            <td>${esc(w.name)}</td>
            <td><span class="badge">Активен</span></td>
          </tr>`
              )
              .join('') || `<tr><td colspan="3" class="muted">Нет складов</td></tr>`
          }
        </tbody>
      </table></div>
      ${
        archWh.length
          ? `<p class="muted" style="margin:10px 0 4px;font-size:12px">Архивные склады (${archWh.length})</p>
        <ul class="muted" style="font-size:12px">${archWh
          .map((w) => `<li><span class="mono">${esc(w.code)}</span> ${esc(w.name)}</li>`)
          .join('')}</ul>`
          : ''
      }`;

    const panel = tabData ? dataPanel : tabLegal ? legalPanel : whPanel;

    leg.view.innerHTML = leg.formChrome(
      co.name || 'Организация',
      `
      <div class="auth-tabs" style="margin:0 0 12px" role="tablist">
        <button type="button" class="auth-tab${tabData ? ' active' : ''}" data-co-tab="data" role="tab" aria-selected="${
        tabData ? 'true' : 'false'
      }">Данные</button>
        <button type="button" class="auth-tab${tabLegal ? ' active' : ''}" data-co-tab="legal" role="tab" aria-selected="${
        tabLegal ? 'true' : 'false'
      }">Юрлица</button>
        <button type="button" class="auth-tab${tabWh ? ' active' : ''}" data-co-tab="warehouses" role="tab" aria-selected="${
        tabWh ? 'true' : 'false'
      }">Склады</button>
      </div>
      ${panel}`,
      {
        entityKind: 'organization',
      }
    );
    leg.bindFormChrome(() => {
      companyCardTab = 'data';
      setOrgCompanyId(leg, '');
      renderOrganizations();
    });

    leg.view.querySelectorAll('[data-co-tab]').forEach((btn) => {
      btn.onclick = () => {
        const t = btn.getAttribute('data-co-tab') || 'data';
        companyCardTab = t === 'legal' || t === 'warehouses' ? t : 'data';
        renderOrganizations();
      };
    });

    const coSave = document.getElementById('co-save');
    if (coSave) {
      coSave.onclick = async () => {
        const msg = document.getElementById('co-msg');
        const btn = document.getElementById('co-save');
        if (btn) btn.disabled = true;
        if (msg) msg.textContent = 'Сохранение…';
        try {
          await leg.api('/company/companies/' + encodeURIComponent(companyId), {
            method: 'PUT',
            body: JSON.stringify({
              name: document.getElementById('co-name').value,
              code: document.getElementById('co-code').value,
            }),
          });
          if (msg) msg.textContent = 'Сохранено';
          renderOrganizations();
        } catch (e) {
          if (msg) msg.textContent = e.message || String(e);
          if (btn) btn.disabled = false;
        }
      };
    }

    const showEditor = (row) => {
      const ed = document.getElementById('org-editor');
      const p = row?.profile || row || {};
      const stampUrl = row?.stamp_url || p.stamp_url || '';
      const signUrl = row?.signature_url || p.signature_url || '';
      const stampSrc = row?.stamp_source || p.stamp_source || null;
      const hasSign = !!(row?.has_signature || p.has_signature || signUrl);
      const stampPreview = stampUrl
        ? `<button type="button" class="org-asset-thumb" data-asset-preview="${esc(stampUrl)}" data-asset-title="Печать" title="Увеличить">
            <img src="${esc(stampUrl)}" alt="Печать" />
          </button>`
        : `<div class="muted org-asset-empty">Нет печати</div>`;
      const signPreview = signUrl
        ? `<button type="button" class="org-asset-thumb org-asset-thumb-sign" data-asset-preview="${esc(signUrl)}" data-asset-title="Подпись" title="Увеличить">
            <img src="${esc(signUrl)}" alt="Подпись" />
          </button>`
        : `<div class="muted org-asset-empty org-asset-empty-sign">Нет подписи</div>`;
      ed.style.display = 'block';
      ed.innerHTML = `
        <h3 class="form-section-title">${row?.id ? 'Юрлицо' : 'Новое юрлицо'}</h3>
        <div class="form-grid">
          <label class="span-2">Наименование<input id="oe-name" value="${esc(p.name || '')}" /></label>
          <label>Кратко<input id="oe-short" value="${esc(p.short_name || '')}" /></label>
          <label>Код<input id="oe-code" class="mono" value="${esc(row?.code || '')}" /></label>
          <label>ИНН<input id="oe-inn" class="mono" value="${esc(p.inn || '')}" /></label>
          <label>КПП<input id="oe-kpp" class="mono" value="${esc(p.kpp || '')}" /></label>
          <label>ОГРН/ОГРНИП<input id="oe-ogrnip" class="mono" value="${esc(p.ogrnip || '')}" /></label>
          <label>НДС %<input id="oe-vat" class="mono" value="${esc(p.vat_rate ?? 5)}" /></label>
          <label class="span-2">Адрес<input id="oe-address" value="${esc(p.address || '')}" /></label>
          <label>Телефон<input id="oe-phone" value="${esc(p.phone || '')}" /></label>
          <label>Руководитель<input id="oe-director" value="${esc(p.director || '')}" /></label>
          <label class="span-2">Банк<input id="oe-bank" value="${esc(p.bank || '')}" /></label>
          <label>БИК<input id="oe-bik" class="mono" value="${esc(p.bik || '')}" /></label>
          <label>Р/с<input id="oe-rs" class="mono" value="${esc(p.rs || '')}" /></label>
          <label>К/с<input id="oe-ks" class="mono" value="${esc(p.ks || '')}" /></label>
          <label style="display:flex;align-items:center;gap:8px;margin-top:8px">
            <input type="checkbox" id="oe-default" ${row?.is_default || !row?.id ? 'checked' : ''} />
            Юрлицо по умолчанию
          </label>
        </div>
        <h3 class="form-section-title" style="margin-top:16px">Печать и подпись на бланках</h3>
        <p class="muted" style="margin:0 0 10px;font-size:12px">Сканы для этого юрлица (по ИНН) — счёт, УПД, СФ. Сначала сохраните ИНН.</p>
        <div class="form-grid">
          <div class="span-2" style="display:flex;flex-wrap:wrap;gap:20px;align-items:flex-start">
            <div>
              <div style="font-size:12px;font-weight:600;margin-bottom:6px">Печать (М.П.)</div>
              <div id="oe-stamp-preview">${stampPreview}</div>
              <div style="display:flex;gap:8px;margin-top:8px;flex-wrap:wrap">
                <label class="btn ghost" style="margin:0;padding:6px 10px;cursor:pointer;font-size:12px">
                  Загрузить
                  <input id="oe-stamp-file" type="file" accept="image/png,image/jpeg,image/webp,image/*" hidden ${row?.id ? '' : 'disabled'} />
                </label>
                <button type="button" id="oe-stamp-clear" ${row?.id && stampSrc === 'upload' ? '' : 'disabled'} style="font-size:12px">Убрать скан</button>
              </div>
              <p class="muted" id="oe-stamp-msg" style="margin:6px 0 0;font-size:11px">${
                stampSrc === 'bundled'
                  ? 'Встроенная печать по ИНН'
                  : stampSrc === 'upload'
                    ? 'Загруженный скан'
                    : row?.id
                      ? ''
                      : 'Сначала запишите юрлицо'
              }</p>
            </div>
            <div>
              <div style="font-size:12px;font-weight:600;margin-bottom:6px">Подпись (факсимиле)</div>
              <div id="oe-sign-preview">${signPreview}</div>
              <div style="display:flex;gap:8px;margin-top:8px;flex-wrap:wrap">
                <label class="btn ghost" style="margin:0;padding:6px 10px;cursor:pointer;font-size:12px">
                  Загрузить
                  <input id="oe-sign-file" type="file" accept="image/png,image/jpeg,image/webp,image/*" hidden ${row?.id ? '' : 'disabled'} />
                </label>
                <button type="button" id="oe-sign-clear" ${row?.id && hasSign ? '' : 'disabled'} style="font-size:12px">Убрать</button>
              </div>
              <p class="muted" id="oe-sign-msg" style="margin:6px 0 0;font-size:11px"></p>
            </div>
          </div>
        </div>
        <p class="muted" id="oe-msg" style="margin-top:8px"></p>
        <div class="toolbar" style="margin-top:8px">
          <button type="button" class="primary" id="oe-save">Записать</button>
          <button type="button" id="oe-cancel">Отмена</button>
          ${
            row?.id && row.is_active && !row.is_default
              ? `<button type="button" id="oe-archive">В архив</button>`
              : ''
          }
          ${
            row?.id && !row.is_active
              ? `<button type="button" id="oe-restore">Вернуть из архива</button>`
              : ''
          }
        </div>`;
      document.getElementById('oe-cancel').onclick = () => {
        ed.style.display = 'none';
        ed.innerHTML = '';
      };

      ed.querySelectorAll('[data-asset-preview]').forEach((btn) => {
        btn.onclick = (e) => {
          e.preventDefault();
          openOrgAssetPreview(btn.getAttribute('data-asset-preview'), btn.getAttribute('data-asset-title'));
        };
      });

      const collectBody = () => ({
        id: row?.id,
        company_id: companyId,
        name: document.getElementById('oe-name').value,
        short_name: document.getElementById('oe-short').value,
        code: document.getElementById('oe-code').value,
        inn: document.getElementById('oe-inn').value,
        kpp: document.getElementById('oe-kpp').value,
        ogrnip: document.getElementById('oe-ogrnip').value,
        vat_rate: Number(document.getElementById('oe-vat').value) || 0,
        address: document.getElementById('oe-address').value,
        phone: document.getElementById('oe-phone').value,
        director: document.getElementById('oe-director').value,
        bank: document.getElementById('oe-bank').value,
        bik: document.getElementById('oe-bik').value,
        rs: document.getElementById('oe-rs').value,
        ks: document.getElementById('oe-ks').value,
        is_default: document.getElementById('oe-default').checked,
        is_active: row?.id && !row.is_active ? 0 : 1,
      });

      const reloadEditor = async (id) => {
        const full = await leg.api('/company/organizations/' + encodeURIComponent(id));
        showEditor(full);
      };

      const uploadPrint = async (kind, fileInput, msgEl) => {
        if (!row?.id) return;
        const file = fileInput.files && fileInput.files[0];
        if (!file) return;
        msgEl.textContent = 'Загрузка…';
        try {
          await leg.api('/company/organizations/' + encodeURIComponent(row.id), {
            method: 'PUT',
            body: JSON.stringify(collectBody()),
          });
          const fd = new FormData();
          fd.append('file', file);
          await leg.api(
            '/company/organizations/' +
              encodeURIComponent(row.id) +
              '/' +
              (kind === 'stamp' ? 'stamp' : 'signature'),
            { method: 'POST', body: fd }
          );
          await reloadEditor(row.id);
        } catch (e) {
          msgEl.textContent = e.message || 'ошибка';
        } finally {
          fileInput.value = '';
        }
      };

      document.getElementById('oe-stamp-file')?.addEventListener('change', () =>
        uploadPrint('stamp', document.getElementById('oe-stamp-file'), document.getElementById('oe-stamp-msg'))
      );
      document.getElementById('oe-sign-file')?.addEventListener('change', () =>
        uploadPrint('sign', document.getElementById('oe-sign-file'), document.getElementById('oe-sign-msg'))
      );
      document.getElementById('oe-stamp-clear')?.addEventListener('click', async () => {
        if (!row?.id) return;
        try {
          await leg.api('/company/organizations/' + encodeURIComponent(row.id) + '/stamp', {
            method: 'DELETE',
          });
          await reloadEditor(row.id);
        } catch (e) {
          document.getElementById('oe-stamp-msg').textContent = e.message;
        }
      });
      document.getElementById('oe-sign-clear')?.addEventListener('click', async () => {
        if (!row?.id) return;
        try {
          await leg.api('/company/organizations/' + encodeURIComponent(row.id) + '/signature', {
            method: 'DELETE',
          });
          await reloadEditor(row.id);
        } catch (e) {
          document.getElementById('oe-sign-msg').textContent = e.message;
        }
      });

      document.getElementById('oe-archive')?.addEventListener('click', async () => {
        if (!row?.id) return;
        if (!confirm('Перенести юрлицо в архив?')) return;
        const msg = document.getElementById('oe-msg');
        try {
          await leg.api('/company/organizations/' + encodeURIComponent(row.id), {
            method: 'DELETE',
          });
          renderOrganizations();
        } catch (e) {
          if (msg) msg.textContent = e.message || String(e);
        }
      });
      document.getElementById('oe-restore')?.addEventListener('click', async () => {
        if (!row?.id) return;
        const msg = document.getElementById('oe-msg');
        try {
          await leg.api('/company/organizations/' + encodeURIComponent(row.id), {
            method: 'PUT',
            body: JSON.stringify({ ...row, company_id: companyId, is_active: 1 }),
          });
          renderOrganizations();
        } catch (e) {
          if (msg) msg.textContent = e.message || String(e);
        }
      });
      document.getElementById('oe-save').onclick = async () => {
        const msg = document.getElementById('oe-msg');
        const btn = document.getElementById('oe-save');
        btn.disabled = true;
        msg.textContent = 'Сохранение…';
        const body = collectBody();
        try {
          if (row?.id) {
            const saved = await leg.api('/company/organizations/' + encodeURIComponent(row.id), {
              method: 'PUT',
              body: JSON.stringify(body),
            });
            showEditor(saved);
          } else {
            const created = await leg.api('/company/organizations', {
              method: 'POST',
              body: JSON.stringify(body),
            });
            showEditor(created);
          }
        } catch (e) {
          msg.textContent = e.message;
          btn.disabled = false;
        }
      };
      ed.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    };

    const leAdd = document.getElementById('le-add');
    if (leAdd) leAdd.onclick = () => showEditor(null);
    leg.view.querySelectorAll('[data-le-open]').forEach((el) => {
      el.onclick = async (e) => {
        e.stopPropagation();
        const id = el.getAttribute('data-le-open');
        const full = await leg.api('/company/organizations/' + encodeURIComponent(id));
        showEditor(full);
      };
    });
    const whAdd = document.getElementById('wh-add');
    if (whAdd) {
      whAdd.onclick = async () => {
        const name = prompt('Название склада');
        if (!name || !name.trim()) return;
        try {
          await leg.api('/warehouses', {
            method: 'POST',
            body: JSON.stringify({ name: name.trim(), company_id: companyId }),
          });
          renderOrganizations();
        } catch (e) {
          alert(e.message || String(e));
        }
      };
    }
    leg.view.querySelectorAll('[data-wh-open]').forEach((tr) => {
      tr.onclick = () => {
        if (leg.state) leg.state.balWh = tr.getAttribute('data-wh-open') || '';
        leg.openTab('balances', 'Остатки');
      };
    });
  }

  async function renderPersons() {
    const leg = L();
    if (!leg) return;
    const data = await leg.api('/staff/persons');
    const items = data.items || [];
    leg.view.innerHTML = leg.formChrome(
      'Физические лица',
      `
      <p class="muted">${esc(data.note || '')}</p>
      <table>
        <thead><tr><th>ФИО</th><th>Email</th><th>Роль</th></tr></thead>
        <tbody>
          ${
            items
              .map(
                (r) => `<tr>
              <td>${esc(r.name)}</td>
              <td>${esc(r.email)}</td>
              <td>${esc(r.role)}</td>
            </tr>`
              )
              .join('') || `<tr><td colspan="3" class="muted">Нет сотрудников</td></tr>`
          }
        </tbody>
      </table>
      <p style="margin-top:12px"><button type="button" id="go-staff">Открыть сотрудников</button></p>`
    );
    leg.bindFormChrome(() => leg.showSection('staff'));
    document.getElementById('go-staff').onclick = () => leg.openTab('staff');
  }

  async function renderDepartments() {
    const leg = L();
    if (!leg) return;
    const data = await leg.api('/staff/departments');
    const items = data.items || data.departments || data || [];
    const list = Array.isArray(items) ? items : [];
    leg.view.innerHTML = leg.formChrome(
      'Подразделения',
      `
      <p class="muted">Бизнес-линии: Подвеска и Фогель. Назначение сотрудникам — в «Персонал».</p>
      <table>
        <thead><tr><th>Название</th><th>Сотрудников</th><th>Заметки</th></tr></thead>
        <tbody>
          ${
            list
              .map(
                (r) =>
                  `<tr>
                    <td><b>${esc(r.name || r)}</b></td>
                    <td>${esc(String(r.members ?? '—'))}</td>
                    <td class="muted">${esc(r.notes || '—')}</td>
                  </tr>`
              )
              .join('') || `<tr><td colspan="3" class="muted">Нет подразделений</td></tr>`
          }
        </tbody>
      </table>
      <p style="margin-top:12px"><button type="button" id="go-staff2">Сотрудники / права</button></p>`
    );
    leg.bindFormChrome(() => leg.showSection('company'));
    document.getElementById('go-staff2').onclick = () => leg.openTab('staff');
  }

  async function renderAllDicts() {
    const leg = L();
    if (!leg) return;
    const data = await leg.api('/company/dicts');
    leg.view.innerHTML = leg.formChrome(
      'Все справочники',
      `
      <p class="muted">${esc(data.note || '')}</p>
      ${(data.groups || [])
        .map(
          (g) => `
        <h3 style="font-size:13px;margin:14px 0 6px">${esc(g.title)}</h3>
        <div class="panel" style="display:flex;flex-wrap:wrap;gap:8px">
          ${(g.items || [])
            .map((it) => `<a class="section-link" href="${esc(it.path)}">${esc(it.label)}</a>`)
            .join('')}
        </div>`
        )
        .join('')}`
    );
    leg.bindFormChrome(() => leg.showSection('company'));
  }

  const REPORT_STATUS_RU = {
    live: 'в работе',
    partial: 'частично',
    stub: 'заглушка',
  };
  const SETTINGS_STATUS_RU = {
    ...REPORT_STATUS_RU,
    ok: 'работает',
    prepared: 'подготовлено',
    planned: 'планируется',
    active: 'активен',
    production: 'производство',
    staff: 'персонал',
  };
  const SETTINGS_SECTION_RU = {
    home: 'Главное',
    crm: 'CRM',
    sales: 'Продажи',
    purchases: 'Закупки',
    warehouse: 'Склад',
    works: 'Работы',
    production: 'Производство',
    money: 'Точка',
    staff: 'Персонал',
    company: 'Компания',
    settings: 'Настройки',
    marking: 'Маркировка',
    ideas: 'Идеи',
    help: 'Помощь',
  };
  function settingsStatusRu(v) {
    const k = String(v || '').toLowerCase();
    return SETTINGS_STATUS_RU[k] || v || '—';
  }
  function settingsSectionRu(v) {
    const k = String(v || '').toLowerCase();
    return SETTINGS_SECTION_RU[k] || v || '—';
  }

  async function renderSettingsPage(kind) {
    const leg = L();
    if (!leg) return;
    const map = {
      'my-settings': '/settings/my',
      'settings-calendars': '/settings/calendars',
      'settings-equipment': '/settings/equipment',
      'settings-channels': '/settings/sales-channels',
      'settings-reports': '/settings/reports',
    };
    const titles = {
      'my-settings': 'Мои настройки',
      'settings-calendars': 'Календари',
      'settings-equipment': 'Поддержка оборудования',
      'settings-channels': 'Каналы продаж',
      'settings-reports': 'Отчеты',
    };
    const data = await leg.api(map[kind]);
    let body = `<p class="muted">${esc(data.note || '')}</p>`;
    if (kind === 'my-settings') {
      const p = data.profile || {};
      body += `<div class="panel"><div>Имя: <b>${esc(p.name || '—')}</b></div>
        <div>Email: <b>${esc(p.email || '—')}</b></div></div>
        <ul>${(data.links || []).map((l) => `<li><a href="${esc(l.path)}">${esc(l.label)}</a></li>`).join('')}</ul>`;
    } else if (kind === 'settings-reports') {
      const sum = data.summary || {};
      body += `<p>В работе: <b>${esc(sum.live || 0)}</b> · Частично: <b>${esc(sum.partial || 0)}</b> · Заглушка: <b>${esc(sum.stub || 0)}</b></p>
        <table><thead><tr><th>Раздел</th><th>Отчёт</th><th>Статус</th><th></th></tr></thead><tbody>
        ${(data.items || [])
          .map(
            (r) => `<tr>
              <td>${esc(settingsSectionRu(r.section))}</td>
              <td>${esc(r.label)}</td>
              <td class="mono">${esc(settingsStatusRu(r.status))}</td>
              <td>${
                r.view
                  ? `<a href="#" data-rep-view="${esc(r.view)}">открыть</a>`
                  : r.path
                    ? `<a href="${esc(r.path)}">${esc(r.path)}</a>`
                    : ''
              }</td>
            </tr>`
          )
          .join('')}
      </tbody></table>`;
    } else {
      const items = data.items || [];
      body += `<table><thead><tr><th>Название</th><th>Статус</th></tr></thead><tbody>
        ${items
          .map(
            (r) =>
              `<tr><td>${esc(r.name || r.label || r.path)}</td><td>${esc(settingsStatusRu(r.status || r.kind || ''))}</td></tr>`
          )
          .join('')}
      </tbody></table>`;
    }
    leg.view.innerHTML = leg.formChrome(titles[kind] || kind, body);
    leg.bindFormChrome(() => leg.showSection('settings'));
    leg.view.querySelectorAll('[data-rep-view]').forEach((a) => {
      a.onclick = (e) => {
        e.preventDefault();
        leg.openTab(a.getAttribute('data-rep-view'));
      };
    });
  }

  async function renderMoneyReports() {
    const leg = L();
    if (!leg) return;
    const data = await leg.api('/money/reports');
    leg.view.innerHTML = leg.formChrome(
      'Отчёты денег',
      `
      <p class="muted">${esc(data.note || '')}</p>
      <div class="home-stats">
        <span>Кассовых док.<b>${esc(data.cash_docs)}</b></span>
        <span>Сумма кассы<b>${money(data.cash_amount)}</b></span>
        <span>Плат. поручения<b>${esc(data.payment_orders)}</b></span>
        <span>Платежи сделок<b>${esc(data.deal_payments)}</b></span>
      </div>
      <ul>${(data.links || [])
        .map((l) =>
          l.view
            ? `<li><a href="#" data-view="${esc(l.view)}">${esc(l.label)}</a></li>`
            : l.href
              ? `<li><a href="${esc(l.href)}">${esc(l.label)}</a></li>`
              : `<li>${esc(l.label)}</li>`
        )
        .join('')}</ul>`
    );
    leg.bindFormChrome(() => leg.showSection('money'));
    leg.view.querySelectorAll('[data-view]').forEach((a) => {
      a.onclick = (e) => {
        e.preventDefault();
        leg.openTab(a.dataset.view);
      };
    });
  }

  async function enhanceDashboard() {
    /* Главная пока пустая — KPI / касса не показываем. */
    return;
  }

  const THIN = [
    { id: 'mw-month-close', key: 'home_month_close', title: 'Закрытие месяца', section: 'home', path: '/home/month-close' },
    { id: 'mw-edo', key: 'home_edo', title: 'ЭДО', section: 'home', path: '/home/edo' },
    { id: 'mw-advance', key: 'money_advance_reports', title: 'Авансовые отчеты', section: 'money', path: '/money/advance-reports' },
    { id: 'mw-loans', key: 'money_loan_contracts', title: 'Договоры кредитов и займов', section: 'money', path: '/money/loan-contracts' },
    { id: 'mw-loan-acc', key: 'money_loan_accruals', title: 'Начисления по кредитам и займам', section: 'money', path: '/money/loan-accruals' },
    { id: 'mw-plan-docs', key: 'money_plan_docs', title: 'Документы планирования денег', section: 'money', path: '/money/plan-docs' },
    { id: 'mw-plan-in', key: 'money_plan_in', title: 'Поступления денег (план)', section: 'money', path: '/money/plan-in' },
    { id: 'mw-plan-tr', key: 'money_plan_transfer', title: 'Перемещения денег (план)', section: 'money', path: '/money/plan-transfer' },
    { id: 'mw-spend-req', key: 'money_spend_requests', title: 'Заявки на расход денег', section: 'money', path: '/money/spend-requests' },
    { id: 'mw-refund-req', key: 'money_refund_requests', title: 'Требования возврата денег', section: 'money', path: '/money/refund-requests' },
    { id: 'mw-close-plan', key: 'money_close_planned', title: 'Закрытие планируемых оплат', section: 'money', path: '/money/close-planned' },
    { id: 'mw-sf-adv', key: 'money_sf_advance', title: 'Регистрация СФ на аванс', section: 'money', path: '/money/sf-advance' },
    { id: 'mw-extra', key: 'money_extra', title: 'Дополнительные обработки', section: 'money', path: '/money/extra' },
    { id: 'mw-bonus-pol', key: 'staff_bonus_policy', title: 'Положения о премировании', section: 'staff', path: '/staff/bonus-policy' },
    { id: 'mw-time-plan', key: 'staff_time_plan', title: 'Планирование времени сотрудников', section: 'staff', path: '/staff/time-plan' },
    { id: 'mw-daily', key: 'staff_daily_reports', title: 'Ежедневные отчеты', section: 'staff', path: '/staff/daily-reports' },
    { id: 'mw-pdn', key: 'staff_pdn_consent', title: 'Согласия на обработку ПДн', section: 'staff', path: '/staff/pdn-consent' },
    { id: 'mw-pay-docs', key: 'staff_payroll_docs', title: 'Документы по зарплате', section: 'staff', path: '/staff/payroll-docs' },
    { id: 'mw-pay-acc', key: 'staff_payroll_accrual', title: 'Начисления зарплаты', section: 'staff', path: '/staff/payroll-accrual' },
    { id: 'mw-pay-sheets', key: 'staff_pay_sheets', title: 'Платежные ведомости', section: 'staff', path: '/staff/pay-sheets' },
    { id: 'mw-timesheets', key: 'staff_timesheets', title: 'Табели', section: 'staff', path: '/staff/timesheets' },
    { id: 'mw-staff-loans', key: 'staff_loans', title: 'Договоры кредитов и займов', section: 'staff', path: '/staff/loans' },
    { id: 'mw-accrual-kinds', key: 'staff_accrual_kinds', title: 'Виды начислений и удержаний', section: 'staff', path: '/staff/accrual-kinds' },
    { id: 'mw-calc-ind', key: 'staff_calc_indicators', title: 'Показатели расчетов', section: 'staff', path: '/staff/calc-indicators' },
    { id: 'mw-bonus-rules', key: 'staff_bonus_rules', title: 'Правила расчета премий', section: 'staff', path: '/staff/bonus-rules' },
    { id: 'mw-bonus-terms', key: 'staff_bonus_terms', title: 'Условия начисления премий', section: 'staff', path: '/staff/bonus-terms' },
    { id: 'mw-staff-extra', key: 'staff_extra', title: 'Отчеты / Доп. обработки', section: 'staff', path: '/staff/extra' },
    { id: 'mw-mail', key: 'settings_mail_sms', title: 'Почта и SMS', section: 'settings', path: '/settings/mail-sms' },
    { id: 'mw-maint', key: 'settings_maintenance', title: 'Обслуживание', section: 'settings', path: '/settings/maintenance' },
    { id: 'mw-inet', key: 'settings_internet_support', title: 'Интернет-поддержка и сервисы', section: 'settings', path: '/settings/internet-support' },
    { id: 'mw-datafix', key: 'settings_data_fix', title: 'Корректировка данных', section: 'settings', path: '/settings/data-fix' },
    { id: 'mw-cloud', key: 'settings_cloud', title: 'Работа в облаке', section: 'settings', path: '/settings/cloud' },
    { id: 'mw-edo-ex', key: 'settings_edo_exchange', title: 'Обмен электронными документами', section: 'settings', path: '/settings/edo-exchange' },
    { id: 'mw-ocr', key: 'settings_ocr', title: 'Распознавание документов', section: 'settings', path: '/settings/ocr' },
    { id: 'mw-biznet', key: 'settings_business_network', title: '1С:Бизнес-сеть', section: 'settings', path: '/settings/business-network' },
    { id: 'mw-reconcile', key: 'settings_reconcile_1c', title: '1С:Сверка 2.0', section: 'settings', path: '/settings/reconcile-1c' },
    { id: 'mw-1cnom', key: 'settings_1c_nomenclature', title: '1С:Номенклатура', section: 'settings', path: '/settings/1c-nomenclature' },
    { id: 'mw-rmk', key: 'settings_rmk', title: '1С:РМК / Касса', section: 'settings', path: '/settings/rmk' },
    { id: 'mw-mobapps', key: 'settings_mobile_apps', title: 'Каталог мобильных приложений', section: 'settings', path: '/settings/mobile-apps' },
    { id: 'mw-tel', key: 'settings_telephony', title: 'Облачная телефония', section: 'settings', path: '/settings/telephony' },
    { id: 'mw-mailings', key: 'settings_mailings', title: 'Почта, рассылки и SMS', section: 'settings', path: '/settings/mailings' },
    { id: 'mw-chats', key: 'settings_chats', title: 'Чаты и видеозвонки', section: 'settings', path: '/settings/chats' },
    { id: 'mw-vetis', key: 'settings_vetis', title: 'Интеграция с ВетИС', section: 'settings', path: '/settings/vetis' },
    { id: 'mw-gism', key: 'settings_gism', title: 'Интеграция с ГИСМ', section: 'settings', path: '/settings/gism' },
    { id: 'mw-egais', key: 'settings_egais', title: 'Интеграция с ЕГАИС', section: 'settings', path: '/settings/egais' },
    { id: 'mw-delete', key: 'settings_delete_objects', title: 'Удаление объектов', section: 'settings', path: '/settings/delete-objects' },
    { id: 'mw-collapse', key: 'settings_ib_collapse', title: 'Свертка ИБ', section: 'settings', path: '/settings/ib-collapse' },
    { id: 'mw-set-extra', key: 'settings_extra', title: 'Дополнительные обработки', section: 'settings', path: '/settings/extra' },
  ];

  async function renderThin(viewId) {
    const leg = L();
    if (!leg) return;
    const cfg = THIN.find((t) => t.id === viewId);
    if (!cfg) return;
    const q = (leg.state.parityQ && leg.state.parityQ[viewId]) || '';
    let data;
    try {
      data = await leg.api(
        '/parity/journals/' + encodeURIComponent(cfg.key) + '?limit=200' + (q ? '&q=' + encodeURIComponent(q) : '')
      );
    } catch (e) {
      leg.view.innerHTML = leg.formChrome(cfg.title, `<p class="error">${esc(e.message)}</p>`);
      leg.bindFormChrome(() => leg.showSection(cfg.section));
      return;
    }
    const items = data.items || [];
    leg.view.innerHTML = leg.formChrome(
      cfg.title,
      `
      <p class="muted" style="margin:0 0 10px">${esc(data.note || '')}</p>
      <table>
        <thead><tr><th>№</th><th>Дата</th><th>Контрагент</th><th>Сумма</th><th>Статус</th><th>Комментарий</th></tr></thead>
        <tbody>
          ${
            items
              .map(
                (r) => `<tr>
              <td class="mono">${esc(r.number)}</td>
              <td>${esc(String(r.doc_date || '').slice(0, 10))}</td>
              <td>${esc(r.counterparty_name || '—')}</td>
              <td class="mono">${r.amount ? money(r.amount) : '—'}</td>
              <td>${esc(r.status || 'draft')}</td>
              <td>${esc(r.comment || '')}</td>
            </tr>`
              )
              .join('') ||
            `<tr><td colspan="6" class="muted">Пока нет записей — пусто OK.</td></tr>`
          }
        </tbody>
      </table>`,
      {
        toolbar: `
          <button type="button" class="primary" id="mw-add">Добавить</button>
          <div class="grow"></div>
          <div class="find">
            <input id="mw-q" placeholder="Поиск" value="${esc(q)}" />
            <button type="button" class="find-go" id="mw-search">Найти</button>
          </div>`,
      }
    );
    leg.bindFormChrome(() => leg.showSection(cfg.section));
    const search = document.getElementById('mw-search');
    if (search) {
      search.onclick = () => {
        leg.state.parityQ = leg.state.parityQ || {};
        leg.state.parityQ[viewId] = (document.getElementById('mw-q').value || '').trim();
        renderThin(viewId);
      };
    }
    const add = document.getElementById('mw-add');
    if (add) {
      add.onclick = () => {
        if (typeof leg.openCreateLightbox !== 'function') return;
        const cpKind = cfg.section === 'purchases' ? 'supplier' : cfg.section === 'sales' ? 'buyer' : '';
        const cpLabel = cpKind === 'supplier' ? 'Поставщик' : cpKind === 'buyer' ? 'Покупатель' : 'Контрагент';
        const today = new Date().toISOString().slice(0, 10);
        leg.openCreateLightbox({
          title: 'Добавить: ' + (cfg.title || cfg.key),
          wide: true,
          bodyHtml: `
            <div class="form-grid full">
              <label class="span-2">${esc(cpLabel)}
                <span class="suggest-anchor">
                  <input id="parity-cp" autocomplete="off" placeholder="Начните вводить название или ИНН" />
                  <input type="hidden" id="parity-cp-id" value="" />
                  <div id="parity-cp-suggest" class="suggest hidden"></div>
                </span>
              </label>
              <label>Дата<input id="parity-date" type="date" value="${esc(today)}" /></label>
            </div>`,
          onMount: (root) => {
            const input = root.querySelector('#parity-cp');
            const suggest = root.querySelector('#parity-cp-suggest');
            const hid = root.querySelector('#parity-cp-id');
            if (typeof leg.bindDadataSuggest === 'function' && input && suggest) {
              leg.bindDadataSuggest(
                input,
                suggest,
                async (q) => {
                  const qs = new URLSearchParams({ q, page: '1', limit: '12', sort: 'name', dir: 'asc' });
                  if (cpKind) qs.set('kind', cpKind);
                  const r = await leg.api('/counterparties?' + qs.toString());
                  return (r.items || []).map((c) => ({
                    value: c.name || '',
                    hint: [c.inn ? 'ИНН ' + c.inn : '', c.phone || ''].filter(Boolean).join(' · '),
                    id: c.id,
                  }));
                },
                {
                  minLen: 1,
                  onPick: (it) => {
                    if (hid) hid.value = it.id || '';
                  },
                }
              );
            }
            input?.addEventListener('input', () => {
              if (hid) hid.value = '';
            });
          },
          onSubmit: async (root) => {
            const name = (root.querySelector('#parity-cp')?.value || '').trim();
            if (!name) throw new Error('Выберите контрагента из списка');
            const cpId = (root.querySelector('#parity-cp-id')?.value || '').trim();
            await leg.api('/parity/journals/' + encodeURIComponent(cfg.key), {
              method: 'POST',
              body: JSON.stringify({
                counterparty_name: name,
                amount: 0,
                comment: '',
                doc_date: (root.querySelector('#parity-date')?.value || today).slice(0, 10),
                status: 'draft',
                payload_json: cpId ? JSON.stringify({ counterparty_id: cpId }) : '',
              }),
            });
            leg.closeCreateLightbox();
            renderThin(viewId);
          },
        });
      };
    }
  }

  function mergeLinks(sectionId, groupTitle, links) {
    const leg = L();
    if (!leg || !leg.SECTIONS) return;
    let sec = leg.SECTIONS[sectionId];
    if (!sec || !sec.cols) {
      leg.SECTIONS[sectionId] = { cols: [[{ title: groupTitle, links: [] }]] };
      sec = leg.SECTIONS[sectionId];
    }
    let group = null;
    for (const col of sec.cols) {
      for (const g of col) {
        if (g.title === groupTitle) {
          group = g;
          break;
        }
      }
      if (group) break;
    }
    if (!group) {
      if (!sec.cols[0]) sec.cols[0] = [];
      group = { title: groupTitle, links: [] };
      sec.cols[0].push(group);
    }
    const have = new Set((group.links || []).map((l) => l.view || l.label || l.href));
    for (const link of links) {
      const key = link.view || link.label || link.href;
      if (have.has(key)) continue;
      group.links.push(link);
      have.add(key);
    }
  }

  function patchMenusWave() {
    // Убрать заглушки УНФ из Компании (Аналитика / Учёт), если остались в кэше или от старых патчей
    const co = L()?.SECTIONS?.company;
    if (co && Array.isArray(co.cols)) {
      for (const col of co.cols) {
        if (!Array.isArray(col)) continue;
        for (let i = col.length - 1; i >= 0; i--) {
          const t = String(col[i]?.title || '');
          if (t === 'Аналитика' || t === 'Учёт') col.splice(i, 1);
        }
      }
    }
    mergeLinks('home', 'Текущие дела', [
      { view: 'mw-month-close', label: 'Закрытие месяца' },
      { view: 'mw-edo', label: 'ЭДО' },
      { view: 'home-todos', label: 'Прочие дела' },
    ]);
    mergeLinks('home', 'KPI', [
      { view: 'kpi-debts-in', label: 'Долги нам' },
      { view: 'kpi-debts-out', label: 'Долги наши' },
      { view: 'kpi-sales-ytd', label: 'Продажи (с начала года)' },
      { view: 'kpi-sales-dyn', label: 'Динамика продаж' },
      { view: 'kpi-spend', label: 'Структура списания денег' },
      { view: 'kpi-leads', label: 'Лиды' },
    ]);
    // Деньги: меню Э0–Э1 (не раздувать паритетом УНФ). Журналы остаются по URL.
    const moneySec = L()?.SECTIONS?.money;
    if (moneySec) {
      moneySec.cols = [
        [
          {
            title: 'Оплаты',
            links: [
              { view: 'invoices', label: 'Счета на оплату' },
              { view: 'payment-link-settings', label: 'Ссылка на оплату' },
              { view: 'payment-orders', label: 'Платежные поручения' },
              { view: 'mw-refund-req', label: 'Требования возврата денег' },
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
      ];
    }
    mergeLinks('staff', 'Кадры и ЗП', [
      { view: 'mw-bonus-pol', label: 'Положения о премировании' },
      { view: 'mw-time-plan', label: 'Планирование времени сотрудников' },
      { view: 'mw-daily', label: 'Ежедневные отчеты' },
      { view: 'mw-pdn', label: 'Согласия на обработку ПДн' },
      { view: 'mw-pay-docs', label: 'Документы по зарплате' },
      { view: 'mw-pay-acc', label: 'Начисления зарплаты' },
      { view: 'mw-pay-sheets', label: 'Платежные ведомости' },
      { view: 'mw-timesheets', label: 'Табели' },
      { view: 'mw-staff-loans', label: 'Договоры кредитов и займов' },
      { view: 'mw-accrual-kinds', label: 'Виды начислений и удержаний' },
      { view: 'mw-calc-ind', label: 'Показатели расчетов' },
      { view: 'mw-bonus-rules', label: 'Правила расчета премий' },
      { view: 'mw-bonus-terms', label: 'Условия начисления премий' },
      { view: 'mw-staff-extra', label: 'Отчеты / Доп. обработки' },
    ]);
  }

  function install() {
    const leg = L();
    if (!leg || !leg.routes) {
      console.warn('[parity-money] WmsLegacy not ready');
      return;
    }

    JOURNALS.forEach((cfg) => {
      leg.VIEW_TITLES[cfg.id] = cfg.title;
      leg.TAB_PATHS[cfg.id] = cfg.path;
      if (leg.TAB_SECTION_MAP) leg.TAB_SECTION_MAP[cfg.id] = cfg.section;
      leg.routes[cfg.id] = () => renderJournal(cfg);
    });
    DICTS.forEach((cfg) => {
      leg.VIEW_TITLES[cfg.id] = cfg.title;
      leg.TAB_PATHS[cfg.id] = cfg.path;
      if (leg.TAB_SECTION_MAP) leg.TAB_SECTION_MAP[cfg.id] = cfg.section;
      leg.routes[cfg.id] = () => renderDict(cfg);
    });

    const extras = {
      'cash-book': renderCashBook,
      'payment-calendar': renderPaymentCalendar,
      'money-bank': renderMoneyBank,
      organizations: renderOrganizations,
      persons: renderPersons,
      departments: () => {
        // Подразделения не используем — только организации (контуры)
        if (typeof leg.openTab === 'function') leg.openTab('organizations');
        else return renderOrganizations();
      },
      'all-dicts': renderAllDicts,
      'company-analytics': () => renderCompanyAnalytics('company-analytics'),
      'kpi-debts-in': () => renderKpi('kpi-debts-in'),
      'kpi-debts-out': () => renderKpi('kpi-debts-out'),
      'kpi-net-assets': () => renderKpi('kpi-net-assets'),
      'kpi-leads': () => renderKpi('kpi-leads'),
      'kpi-sales-ytd': () => renderKpi('kpi-sales-ytd'),
      'kpi-conversion': () => renderKpi('kpi-conversion'),
      'kpi-sales-dyn': () => renderKpi('kpi-sales-dyn'),
      'kpi-spend': () => renderKpi('kpi-spend'),
      'home-todos': () => renderKpi('home-todos'),
      'my-settings': () => renderSettingsPage('my-settings'),
      'settings-calendars': () => renderSettingsPage('settings-calendars'),
      'settings-equipment': () => renderSettingsPage('settings-equipment'),
      'settings-channels': () => renderSettingsPage('settings-channels'),
      'settings-reports': () => renderSettingsPage('settings-reports'),
      'parity-money-reports': renderMoneyReports,
      'sales-analysis': async () => {
        // делегируем в parity-a если есть, иначе JSON
        if (leg.routes['parity-sales-analysis']) return leg.routes['parity-sales-analysis']();
        const data = await leg.api('/sales/analysis');
        leg.view.innerHTML = leg.formChrome(
          'Анализ продаж',
          `<p class="muted">${esc(data.note || '')}</p>
           <pre style="white-space:pre-wrap;font-size:12px">${esc(JSON.stringify(data, null, 2))}</pre>`
        );
        leg.bindFormChrome(() => leg.showSection('sales'));
      },
    };
    Object.entries(extras).forEach(([id, fn]) => {
      leg.routes[id] = fn;
      if (id === 'parity-money-reports') {
        leg.VIEW_TITLES[id] = 'Отчёты денег';
        leg.TAB_PATHS[id] = '/money/reports';
      }
      if (leg.TAB_SECTION_MAP) {
        if (id.startsWith('kpi-') || id === 'home-todos') leg.TAB_SECTION_MAP[id] = 'home';
        else if (id.startsWith('settings') || id === 'my-settings') leg.TAB_SECTION_MAP[id] = 'settings';
        else if (id === 'parity-money-reports') leg.TAB_SECTION_MAP[id] = 'money';
        else if (
          id.startsWith('company') ||
          id === 'organizations' ||
          id === 'all-dicts' ||
          id === 'departments'
        )
          leg.TAB_SECTION_MAP[id] = 'company';
        else if (id === 'persons') leg.TAB_SECTION_MAP[id] = 'staff';
        else if (id === 'sales-analysis') leg.TAB_SECTION_MAP[id] = 'sales';
        else leg.TAB_SECTION_MAP[id] = 'money';
      }
    });

    THIN.forEach((cfg) => {
      leg.VIEW_TITLES[cfg.id] = cfg.title;
      leg.TAB_PATHS[cfg.id] = cfg.path;
      if (leg.TAB_SECTION_MAP) leg.TAB_SECTION_MAP[cfg.id] = cfg.section;
      leg.routes[cfg.id] = () => renderThin(cfg.id);
    });

    patchMenusWave();

    const prevDash = leg.routes.dashboard;
    if (typeof prevDash === 'function' && !leg.routes.dashboard.__mwWrapped) {
      const wrapped = async () => {
        await prevDash();
        await enhanceDashboard();
      };
      wrapped.__mwWrapped = true;
      leg.routes.dashboard = wrapped;
    }

    console.info(
      '[parity-money] installed journals:',
      JOURNALS.length,
      'dicts:',
      DICTS.length,
      'thin:',
      THIN.length,
      'extras:',
      Object.keys(extras).length
    );
  }

  window.WmsParityMoney = { install, JOURNALS, DICTS, THIN };
})();
