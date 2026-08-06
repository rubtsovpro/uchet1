/**
 * MAP wave B: CRM / Работы(СТО) / Производство / боковое.
 * Merge-only меню — НЕ перезаписывает sections-crm-ops / parity-a / money.
 * Тонкие журналы через /api/parity/journals/:key (пусто OK).
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

  function money(n) {
    if (L() && L().formatMoney) return L().formatMoney(n);
    const x = Number(n) || 0;
    return x.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' ₽';
  }

  /** @type {Array<{id:string,key:string,title:string,section:string,path:string}>} */
  const THIN = [
    // CRM
    { id: 'wb-leads', key: 'crm_leads', title: 'Лиды', section: 'crm', path: '/crm/leads' },
    { id: 'wb-contracts', key: 'crm_contracts', title: 'Договоры', section: 'crm', path: '/crm/contracts' },
    { id: 'wb-mail', key: 'crm_mail', title: 'Почта', section: 'crm', path: '/crm/mail' },
    { id: 'wb-calls', key: 'crm_calls', title: 'Звонки', section: 'crm', path: '/crm/calls' },
    { id: 'wb-sms', key: 'crm_sms', title: 'SMS', section: 'crm', path: '/crm/sms' },
    { id: 'wb-cc', key: 'crm_contact_center', title: 'Контакт-центр', section: 'crm', path: '/crm/contact-center' },
    { id: 'wb-pp-export', key: 'crm_pnevmopro_export', title: 'Настройки выгрузки ПневмоПро', section: 'crm', path: '/crm/pnevmopro-export' },
    { id: 'wb-income-users', key: 'crm_income_users', title: 'Пользователи для дохода', section: 'crm', path: '/crm/income-users' },
    { id: 'wb-webshop', key: 'crm_webshop', title: 'Интернет-магазин', section: 'crm', path: '/crm/webshop' },
    { id: 'wb-forms', key: 'crm_contact_forms', title: 'Контактные формы', section: 'crm', path: '/crm/contact-forms' },
    { id: 'wb-mag1c', key: 'crm_mag1c', title: 'Веб-витрина mag1c', section: 'crm', path: '/crm/mag1c' },
    { id: 'wb-mailings', key: 'crm_mass_mailings', title: 'Массовые рассылки', section: 'crm', path: '/crm/mass-mailings' },
    { id: 'wb-sources', key: 'crm_lead_sources', title: 'Источники привлечения', section: 'crm', path: '/crm/lead-sources' },
    { id: 'wb-assistant', key: 'crm_unf_assistant', title: 'Ассистент УНФ', section: 'crm', path: '/crm/assistant' },
    { id: 'wb-workflow', key: 'crm_workflow_rules', title: 'Правила рабочего процесса', section: 'crm', path: '/crm/workflow-rules' },
    { id: 'wb-tpl-kp', key: 'crm_templates_kp', title: 'Шаблоны КП и договоров', section: 'crm', path: '/crm/templates-kp' },
    { id: 'wb-tpl-mail', key: 'crm_templates_mail', title: 'Шаблоны писем, SMS', section: 'crm', path: '/crm/templates-mail' },
    { id: 'wb-spark', key: 'crm_spark', title: '1СПАРК Риски', section: 'crm', path: '/crm/spark' },
    // СТО
    { id: 'wb-sto-time', key: 'works_time', title: 'Учет времени', section: 'works', path: '/works/time' },
    { id: 'wb-sto-planner', key: 'works_resource_planner', title: 'Планировщик ресурсов', section: 'works', path: '/works/planner' },
    { id: 'wb-sto-sched', key: 'works_schedules', title: 'Графики работы', section: 'works', path: '/works/schedules' },
    { id: 'wb-sto-brig', key: 'works_brigades', title: 'Бригады', section: 'works', path: '/works/brigades' },
    { id: 'wb-sto-exec', key: 'works_executors', title: 'Исполнители работ', section: 'works', path: '/works/executors' },
    { id: 'wb-sto-pct', key: 'works_executor_pct', title: 'Процент работ исполнителя', section: 'works', path: '/works/executor-pct' },
    { id: 'wb-sto-jobs', key: 'works_executor_jobs', title: 'Работы исполнителей', section: 'works', path: '/works/executor-jobs' },
    { id: 'wb-sto-exec-rep', key: 'works_executor_report', title: 'Отчет по работам исполнителей', section: 'works', path: '/works/executor-report' },
    { id: 'wb-sto-reports', key: 'works_reports', title: 'Отчеты', section: 'works', path: '/works/reports' },
    { id: 'wb-sto-extra', key: 'works_extra', title: 'Дополнительные обработки', section: 'works', path: '/works/extra' },
    // Производство
    { id: 'wb-prod-cost', key: 'prod_cost_alloc', title: 'Распределения затрат', section: 'production', path: '/production/cost-alloc' },
    { id: 'wb-prod-tr', key: 'prod_transfers', title: 'Перемещения', section: 'production', path: '/production/transfers' },
    { id: 'wb-prod-rework', key: 'prod_rework', title: 'Документы переработки', section: 'production', path: '/production/rework' },
    { id: 'wb-prod-piece', key: 'prod_piecework', title: 'Сдельные наряды', section: 'production', path: '/production/piecework' },
    { id: 'wb-prod-time', key: 'prod_time', title: 'Учет времени', section: 'production', path: '/production/time' },
    { id: 'wb-prod-planner', key: 'prod_resource_planner', title: 'Планировщик ресурсов', section: 'production', path: '/production/planner' },
    { id: 'wb-prod-mrp', key: 'prod_mrp', title: 'Расчет потребностей', section: 'production', path: '/production/mrp' },
    { id: 'wb-prod-specs', key: 'prod_specs', title: 'Спецификации', section: 'production', path: '/production/specs' },
    { id: 'wb-prod-sched', key: 'prod_schedules', title: 'Графики работы', section: 'production', path: '/production/schedules' },
    { id: 'wb-prod-res', key: 'prod_resources', title: 'Ресурсы', section: 'production', path: '/production/resources' },
    { id: 'wb-prod-brig', key: 'prod_brigades', title: 'Бригады', section: 'production', path: '/production/brigades' },
    { id: 'wb-prod-pa', key: 'prod_purchase_analysis', title: 'Анализ заявок на закупку', section: 'production', path: '/production/purchase-analysis' },
    { id: 'wb-prod-ops-rep', key: 'prod_ops_docs_report', title: 'Отчет по документам пр-ва и продаж', section: 'production', path: '/production/ops-docs-report' },
    { id: 'wb-prod-extra', key: 'prod_extra', title: 'Отчеты / Доп. обработки', section: 'production', path: '/production/extra' },
    // Боковое
    { id: 'wb-diadoc', key: 'sidebar_diadoc', title: 'Контур.Диадок', section: 'home', path: '/home/diadoc' },
  ];

  async function renderTemplatesKp() {
    const leg = L();
    if (!leg) return;
    let tpls = [];
    let orgs = [];
    try {
      const [t, o] = await Promise.all([
        leg.api('/contract-templates'),
        leg.api('/company/organizations?limit=200'),
      ]);
      tpls = t.items || [];
      orgs = (o.items || o.organizations || []).filter((x) => x.is_active !== false && x.is_active !== 0);
    } catch (e) {
      leg.view.innerHTML = leg.formChrome('Шаблоны КП и договоров', `<p class="error">${esc(e.message)}</p>`);
      leg.bindFormChrome(() => leg.showSection('crm'));
      return;
    }
    const orgOpts = orgs
      .map((o) => {
        const rs = (o.profile && o.profile.rs) || o.rs || '—';
        return `<option value="${esc(o.id)}">${esc(o.name || o.short_name)} · р/с ${esc(rs)}</option>`;
      })
      .join('');
    const rows = tpls
      .map(
        (t) => `<tr>
          <td><b>${esc(t.title)}</b><div class="muted" style="font-size:11px">${esc(t.note || '')}</div></td>
          <td class="mono">${esc(t.code || t.id)}</td>
          <td>
            <button type="button" class="linkish tpl-preview" data-id="${esc(t.id)}">Бланк</button>
            ·
            <button type="button" class="linkish tpl-create" data-id="${esc(t.id)}">Создать договор</button>
          </td>
        </tr>`
      )
      .join('');
    leg.view.innerHTML = leg.formChrome(
      'Шаблоны КП и договоров',
      `
      <p class="muted" style="margin:0 0 10px">Встроенный шаблон БМП (купля-продажа + услуги). Продавец — юрлицо ниже; покупатель подставится из сделки или останется с прочерками.</p>
      <label style="display:grid;gap:4px;max-width:520px;margin-bottom:12px;font-size:12px">Юрлицо продавца
        <select id="tpl-org">${orgOpts || '<option value="">— нет юрлиц —</option>'}</select>
      </label>
      <div class="table-scroll"><table class="data-table is-dense" data-no-col-filter="1">
        <thead><tr><th>Шаблон</th><th>Код</th><th></th></tr></thead>
        <tbody>${rows || '<tr><td colspan="3" class="muted">Нет шаблонов</td></tr>'}</tbody>
      </table></div>`
    );
    leg.bindFormChrome(() => leg.showSection('crm'));
    leg.view.querySelectorAll('.tpl-preview').forEach((btn) => {
      btn.onclick = () => {
        const org = document.getElementById('tpl-org')?.value || '';
        const url =
          '/api/contract-templates/' +
          encodeURIComponent(btn.getAttribute('data-id')) +
          '/preview?organization_id=' +
          encodeURIComponent(org);
        window.open(url, '_blank');
      };
    });
    leg.view.querySelectorAll('.tpl-create').forEach((btn) => {
      btn.onclick = async () => {
        try {
          const organization_id = document.getElementById('tpl-org')?.value || '';
          const r = await leg.api('/contracts', {
            method: 'POST',
            body: JSON.stringify({ organization_id }),
          });
          const doc = r.doc;
          if (doc?.id) {
            window.open('/api/sales-docs/' + encodeURIComponent(doc.id) + '/print', '_blank');
            if (typeof leg.openTab === 'function') {
              leg.openTab('sales:' + doc.id, (doc.number || 'Договор').slice(0, 40));
            }
          }
        } catch (e) {
          alert(e.message || String(e));
        }
      };
    });
  }

  async function renderThin(viewId) {
    const leg = L();
    if (!leg) return;
    if (viewId === 'wb-tpl-kp') {
      return renderTemplatesKp();
    }
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
          <button type="button" class="primary" id="wb-add">Добавить</button>
          <div class="grow"></div>
          <div class="find">
            <input id="wb-q" placeholder="Поиск" value="${esc(q)}" />
            <button type="button" class="find-go" id="wb-search">Найти</button>
          </div>`,
      }
    );
    leg.bindFormChrome(() => leg.showSection(cfg.section));
    const search = document.getElementById('wb-search');
    if (search) {
      search.onclick = () => {
        leg.state.parityQ = leg.state.parityQ || {};
        leg.state.parityQ[viewId] = (document.getElementById('wb-q').value || '').trim();
        renderThin(viewId);
      };
    }
    const add = document.getElementById('wb-add');
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

  function mergeLinks(sectionId, groupTitles, links) {
    const leg = L();
    if (!leg || !leg.SECTIONS) return;
    const titles = Array.isArray(groupTitles) ? groupTitles : [groupTitles];
    let sec = leg.SECTIONS[sectionId];
    if (!sec || !sec.cols) {
      leg.SECTIONS[sectionId] = { cols: [[{ title: titles[0], links: [] }]] };
      sec = leg.SECTIONS[sectionId];
    }
    let group = null;
    for (const want of titles) {
      for (const col of sec.cols) {
        for (const g of col) {
          if (g.title === want) {
            group = g;
            break;
          }
        }
        if (group) break;
      }
      if (group) break;
    }
    if (!group) {
      if (!sec.cols[0]) sec.cols[0] = [];
      group = { title: titles[0], links: [] };
      sec.cols[0].push(group);
    }
    const have = new Set((group.links || []).map((l) => l.view || l.label || l.href));
    for (const link of links) {
      const key = link.view || link.label || link.href;
      if (have.has(key)) continue;
      // skip if same label already present (disabled stub)
      if (link.label && (group.links || []).some((l) => l.label === link.label && (l.view || l.href))) continue;
      // replace disabled stub with same label
      const stubIdx = (group.links || []).findIndex((l) => l.label === link.label && !l.view && !l.href);
      if (stubIdx >= 0) {
        group.links[stubIdx] = link;
        have.add(key);
        continue;
      }
      group.links.push(link);
      have.add(key);
    }
  }

  function patchMenusWaveB() {
    mergeLinks('crm', ['CRM', 'Основное'], [
      { view: 'wb-leads', label: 'Лиды' },
      { view: 'wb-contracts', label: 'Договоры' },
    ]);
    mergeLinks('crm', 'Коммуникации', [
      { view: 'wb-mail', label: 'Почта' },
      { view: 'wb-calls', label: 'Звонки' },
      { view: 'wb-sms', label: 'SMS' },
    ]);
    mergeLinks('crm', 'Задачи', [
      { view: 'wb-cc', label: 'Контакт-центр' },
    ]);
    mergeLinks('crm', ['ПневмоПро', 'Товары и услуги'], [
      { view: 'wb-pp-export', label: 'Настройки выгрузки для сайта ПневмоПро' },
      { view: 'wb-income-users', label: 'Пользователи для дохода' },
    ]);
    mergeLinks('crm', ['Прочее', 'Аналитика', 'CRM'], [
      { view: 'wb-webshop', label: 'Интернет-магазин' },
      { view: 'wb-forms', label: 'Контактные формы' },
      { view: 'wb-mag1c', label: 'Веб-витрина mag1c' },
      { view: 'wb-mailings', label: 'Массовые рассылки (E-mail, SMS)' },
      { view: 'wb-sources', label: 'Источники привлечения' },
      { view: 'wb-assistant', label: 'Ассистент управления нашей фирмой' },
      { view: 'wb-workflow', label: 'Правила рабочего процесса' },
      { view: 'wb-tpl-kp', label: 'Шаблоны КП и договоров' },
      { view: 'wb-tpl-mail', label: 'Шаблоны писем, SMS' },
      { view: 'wb-spark', label: '1СПАРК Риски' },
    ]);

    mergeLinks('works', ['Работы / СТО', 'Работы'], [
      { view: 'wb-sto-time', label: 'Учет времени' },
      { view: 'wb-sto-planner', label: 'Планировщик ресурсов' },
      { view: 'wb-sto-sched', label: 'Графики работы' },
      { view: 'wb-sto-brig', label: 'Бригады' },
      { view: 'wb-sto-exec', label: 'Исполнители работ' },
      { view: 'wb-sto-pct', label: 'Процент работ исполнителя' },
      { view: 'wb-sto-jobs', label: 'Работы исполнителей' },
      { view: 'wb-sto-exec-rep', label: 'Отчет по работам исполнителей' },
      { view: 'wb-sto-reports', label: 'Отчеты' },
      { view: 'wb-sto-extra', label: 'Дополнительные обработки' },
    ]);

    mergeLinks('production', 'Производство', [
      { view: 'wb-prod-cost', label: 'Распределения затрат' },
      { view: 'wb-prod-tr', label: 'Перемещения' },
      { view: 'wb-prod-rework', label: 'Документы переработки' },
      { view: 'wb-prod-piece', label: 'Сдельные наряды' },
      { view: 'wb-prod-time', label: 'Учет времени' },
      { view: 'wb-prod-planner', label: 'Планировщик ресурсов' },
      { view: 'wb-prod-mrp', label: 'Расчет потребностей' },
      { view: 'wb-prod-specs', label: 'Спецификации' },
      { view: 'wb-prod-sched', label: 'Графики работы' },
      { view: 'wb-prod-res', label: 'Ресурсы' },
      { view: 'wb-prod-brig', label: 'Бригады' },
      { view: 'wb-prod-pa', label: 'Анализ заявок на закупку' },
      { view: 'wb-prod-ops-rep', label: 'Отчет по документам заказов, производства и продаж' },
      { view: 'wb-prod-extra', label: 'Отчеты / Доп. обработки' },
    ]);

    mergeLinks('home', 'Текущие дела', [
      { view: 'wb-diadoc', label: 'Контур.Диадок' },
    ]);
  }

  async function renderWorksReports() {
    const leg = L();
    if (!leg) return;
    const data = await leg.api('/works/reports');
    leg.view.innerHTML = leg.formChrome(
      'Отчёты СТО',
      `
      <p class="muted">${esc(data.note || '')}</p>
      <div class="home-stats"><span>Заказ-нарядов<b>${esc(data.work_orders)}</b></span></div>
      <ul>${(data.links || [])
        .map((l) =>
          l.view
            ? `<li><a href="#" data-view="${esc(l.view)}">${esc(l.label)}</a></li>`
            : `<li>${esc(l.label)}</li>`
        )
        .join('')}</ul>`
    );
    leg.bindFormChrome(() => leg.showSection('works'));
    leg.view.querySelectorAll('[data-view]').forEach((a) => {
      a.onclick = (e) => {
        e.preventDefault();
        leg.openTab(a.dataset.view);
      };
    });
  }

  function install() {
    const leg = L();
    if (!leg || !leg.routes) {
      console.warn('[parity-wave-b] WmsLegacy not ready');
      return;
    }

    THIN.forEach((cfg) => {
      leg.VIEW_TITLES[cfg.id] = cfg.title;
      leg.TAB_PATHS[cfg.id] = cfg.path;
      if (leg.TAB_SECTION_MAP) leg.TAB_SECTION_MAP[cfg.id] = cfg.section;
      if (cfg.id === 'wb-sto-reports') {
        leg.routes[cfg.id] = () => renderWorksReports();
      } else {
        leg.routes[cfg.id] = () => renderThin(cfg.id);
      }
    });

    patchMenusWaveB();

    console.info('[parity-wave-b] installed thin:', THIN.length);
  }

  window.WmsParityWaveB = { install, THIN };
})();
