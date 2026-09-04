/**
 * Batch A UI: Закупки + Продажи + складские отчёты (паритет меню УНФ).
 * Отдельный модуль — меньше merge hell с legacy.js.
 * Не трогает /pick, телефоны, валюты, presence, brand assets.
 */
(function () {
  'use strict';

  /** @type {Record<string, {key?: string, title: string, section: string, kind: string, path: string, api?: string, mapIds: string[]}>} */
  const SCREENS = {
    // Dedicated APIs already on server
    'parity-gtd': {
      title: 'Номера ГТД',
      section: 'purchases',
      kind: 'gtd',
      path: '/gtd',
      mapIds: ['purchases.gtd', 'sales.gtd', 'warehouse.gtd'],
    },
    'parity-stock-low': {
      title: 'Остатки ниже минимума',
      section: 'warehouse',
      kind: 'stock-low',
      path: '/stock/low',
      mapIds: ['warehouse.low_stock'],
    },
    'parity-transfers': {
      title: 'Перемещения',
      section: 'warehouse',
      kind: 'transfers',
      path: '/stock/transfers',
      mapIds: ['warehouse.transfers'],
    },
    'parity-writeoffs': {
      title: 'Списания',
      section: 'warehouse',
      kind: 'writeoffs',
      path: '/stock/writeoffs',
      mapIds: ['warehouse.writeoffs'],
    },
    'parity-inventory': {
      title: 'Инвентаризации',
      section: 'warehouse',
      kind: 'inventory',
      path: '/inventory',
      mapIds: ['warehouse.inventory'],
    },
    'parity-price-lists': {
      title: 'Прайс-листы',
      section: 'sales',
      kind: 'price-matrix',
      path: '/prices/lists',
      mapIds: ['sales.price_lists'],
    },
    'parity-sales-analysis': {
      title: 'Анализ продаж',
      section: 'sales',
      kind: 'sales-analysis',
      path: '/sales/analysis',
      mapIds: ['sales.analysis'],
    },
    'parity-purchases-reports': {
      title: 'Отчёты закупок',
      section: 'purchases',
      kind: 'purchases-reports',
      path: '/purchases/reports',
      mapIds: ['purchases.reports'],
    },
    'parity-purchases-inbound': {
      title: 'Приходы с ГТД',
      section: 'purchases',
      kind: 'purchases-inbound',
      path: '/purchases/inbound-report',
      mapIds: ['purchases.inbound_gtd'],
    },
    'parity-demand': {
      title: 'Расчёт потребностей',
      section: 'warehouse',
      kind: 'demand',
      path: '/purchases/demand',
      mapIds: ['purchases.demand', 'warehouse.demand'],
    },
    'parity-warehouse-reports': {
      title: 'Отчёты склада',
      section: 'warehouse',
      kind: 'warehouse-reports',
      path: '/warehouse/reports',
      mapIds: ['warehouse.reports'],
    },
    // Thin journals
    'parity-supplier-orders': {
      key: 'supplier_orders',
      title: 'Заказы поставщикам',
      section: 'purchases',
      kind: 'thin',
      path: '/purchases/supplier-orders',
      mapIds: ['purchases.supplier_orders'],
    },
    'parity-supplier-bills': {
      key: 'supplier_bills',
      title: 'Счета на оплату (полученные)',
      section: 'purchases',
      kind: 'thin',
      path: '/purchases/supplier-bills',
      mapIds: ['purchases.supplier_bills'],
    },
    'parity-supplier-returns': {
      key: 'supplier_returns',
      title: 'Возвраты поставщикам',
      section: 'purchases',
      kind: 'thin',
      path: '/purchases/supplier-returns',
      mapIds: ['purchases.supplier_returns'],
    },
    'parity-purchase-sf': {
      key: 'purchase_sf',
      title: 'Счета-фактуры (полученные)',
      section: 'purchases',
      kind: 'thin',
      path: '/purchases/sf',
      mapIds: ['purchases.purchase_sf'],
    },
    'parity-extra-costs': {
      key: 'extra_costs',
      title: 'Дополнительные расходы',
      section: 'purchases',
      kind: 'thin',
      path: '/purchases/extra-costs',
      mapIds: ['purchases.extra_costs'],
    },
    'parity-receipt-adj': {
      key: 'receipt_adjustments',
      title: 'Корректировки поступлений',
      section: 'purchases',
      kind: 'thin',
      path: '/purchases/receipt-adjustments',
      mapIds: ['purchases.receipt_adjustments'],
    },
    'parity-purchase-discrepancy': {
      key: 'purchase_discrepancy',
      title: 'Акты о расхождениях',
      section: 'purchases',
      kind: 'thin',
      path: '/purchases/discrepancy',
      mapIds: ['purchases.discrepancy'],
    },
    'parity-import-costs': {
      key: 'import_costs',
      title: 'Расходы при импорте',
      section: 'purchases',
      kind: 'thin',
      path: '/purchases/import-costs',
      mapIds: ['purchases.import_costs'],
    },
    'parity-supplier-price-lists': {
      key: 'supplier_price_lists',
      title: 'Прайс-листы поставщиков',
      section: 'purchases',
      kind: 'thin',
      path: '/purchases/supplier-price-lists',
      mapIds: ['purchases.supplier_price_lists'],
    },
    'parity-supplier-price-types': {
      key: 'supplier_price_types',
      title: 'Виды цен поставщиков',
      section: 'purchases',
      kind: 'thin',
      path: '/purchases/supplier-price-types',
      mapIds: ['purchases.supplier_price_types'],
    },
    'parity-purchase-reconcile': {
      key: 'purchase_reconcile',
      title: 'Сверки взаиморасчётов',
      section: 'purchases',
      kind: 'thin',
      path: '/purchases/reconcile',
      mapIds: ['purchases.reconcile'],
    },
    'parity-purchase-debt-adj': {
      key: 'purchase_debt_adj',
      title: 'Корректировки долга',
      section: 'purchases',
      kind: 'thin',
      path: '/purchases/debt-adj',
      mapIds: ['purchases.debt_adj'],
    },
    'parity-work-acts': {
      key: 'work_acts',
      title: 'Акты выполненных работ',
      section: 'sales',
      kind: 'thin',
      path: '/sales/work-acts',
      mapIds: ['sales.work_acts'],
    },
    'parity-customer-returns': {
      key: 'customer_returns',
      title: 'Возвраты от покупателей',
      section: 'sales',
      kind: 'thin',
      path: '/sales/customer-returns',
      mapIds: ['sales.customer_returns'],
    },
    'parity-sales-adj': {
      key: 'sales_adjustments',
      title: 'Корректировки реализаций',
      section: 'sales',
      kind: 'thin',
      path: '/sales/adjustments',
      mapIds: ['sales.adjustments'],
    },
    'parity-return-sf': {
      key: 'return_sf',
      title: 'Счета-фактуры на возврат',
      section: 'sales',
      kind: 'thin',
      path: '/sales/return-sf',
      mapIds: ['sales.return_sf'],
    },
    'parity-retail-reports': {
      title: 'Отчёты о розничных продажах',
      section: 'sales',
      kind: 'retail-reports',
      path: '/sales/retail-reports',
      mapIds: ['sales.retail_reports'],
    },
    'parity-sales-reports': {
      title: 'Отчёты продаж',
      section: 'sales',
      kind: 'sales-reports',
      path: '/sales/reports',
      mapIds: ['sales.reports'],
    },
    'parity-crm-reports': {
      title: 'Отчёты CRM',
      section: 'crm',
      kind: 'crm-reports',
      path: '/crm/reports',
      mapIds: ['crm.reports'],
    },
    'parity-kkm-cash': {
      key: 'kkm_cash',
      title: 'Кассы ККМ',
      section: 'sales',
      kind: 'thin',
      path: '/sales/kkm-cash',
      mapIds: ['sales.kkm_cash'],
    },
    'parity-sales-control': {
      key: 'sales_control',
      title: 'Контроль продаж',
      section: 'sales',
      kind: 'thin',
      path: '/sales/control',
      mapIds: ['sales.control'],
    },
    'parity-sales-reconcile': {
      key: 'sales_reconcile',
      title: 'Сверки взаиморасчётов',
      section: 'sales',
      kind: 'thin',
      path: '/sales/reconcile',
      mapIds: ['sales.reconcile'],
    },
    'parity-sales-debt-adj': {
      key: 'sales_debt_adj',
      title: 'Корректировки долга',
      section: 'sales',
      kind: 'thin',
      path: '/sales/debt-adj',
      mapIds: ['sales.debt_adj'],
    },
    'parity-order-states': {
      key: 'order_states',
      title: 'Виды и состояния заказов',
      section: 'sales',
      kind: 'thin',
      path: '/sales/order-states',
      mapIds: ['sales.order_states'],
    },
    'parity-route-sheets': {
      key: 'route_sheets',
      title: 'Маршрутные листы',
      section: 'sales',
      kind: 'thin',
      path: '/sales/route-sheets',
      mapIds: ['sales.route_sheets'],
    },
    'parity-kkm-receipts': {
      key: 'kkm_receipts',
      title: 'Чеки ККМ',
      section: 'sales',
      kind: 'thin',
      path: '/sales/kkm-receipts',
      mapIds: ['sales.kkm_receipts'],
    },
    'parity-rmk': {
      key: 'rmk',
      title: 'РМК',
      section: 'sales',
      kind: 'thin',
      path: '/sales/rmk',
      mapIds: ['sales.rmk'],
    },
    'parity-repair-accept': {
      key: 'repair_accept',
      title: 'Приём и передача в ремонт',
      section: 'sales',
      kind: 'thin',
      path: '/sales/repair-accept',
      mapIds: ['sales.repair_accept'],
    },
    'parity-pneumopro-price': {
      key: 'pneumopro_price',
      title: 'Прайс-лист (ПневмоПро)',
      section: 'sales',
      kind: 'thin',
      path: '/sales/pneumopro-price',
      mapIds: ['sales.pneumopro_price'],
    },
    'parity-labels': {
      key: 'labels_print',
      title: 'Печать этикеток и ценников',
      section: 'warehouse',
      kind: 'thin',
      path: '/warehouse/labels',
      mapIds: ['sales.labels', 'warehouse.labels'],
    },
    'parity-transfer-orders': {
      key: 'transfer_orders',
      title: 'Заказы на перемещение',
      section: 'warehouse',
      kind: 'thin',
      path: '/warehouse/transfer-orders',
      mapIds: ['warehouse.transfer_orders'],
    },
    'parity-assemblies': {
      key: 'assemblies',
      title: 'Комплектации',
      section: 'warehouse',
      kind: 'thin',
      path: '/warehouse/assemblies',
      mapIds: ['warehouse.assemblies'],
    },
    'parity-regrading': {
      key: 'regrading',
      title: 'Пересортица',
      section: 'warehouse',
      kind: 'thin',
      path: '/warehouse/regrading',
      mapIds: ['warehouse.regrading'],
    },
    'parity-warehouse-acts': {
      key: 'warehouse_acts',
      title: 'Складские акты',
      section: 'warehouse',
      kind: 'thin',
      path: '/warehouse/acts',
      mapIds: ['warehouse.acts'],
    },
    'parity-stock-receipts': {
      key: 'stock_receipts_local',
      title: 'Оприходования',
      section: 'warehouse',
      kind: 'thin',
      path: '/warehouse/receipts',
      mapIds: ['warehouse.receipts'],
    },

    'parity-commission-purchases': {
      key: 'commission_purchases',
      title: 'Комиссионные закупки',
      section: 'purchases',
      kind: 'thin',
      path: '/purchases/commission',
      mapIds: ['purchases.commission'],
    },
    'parity-poa': {
      key: 'powers_of_attorney',
      title: 'Доверенности',
      section: 'purchases',
      kind: 'thin',
      path: '/purchases/poa',
      mapIds: ['purchases.poa'],
    },
    'parity-purchase-return-sf': {
      key: 'purchase_return_sf',
      title: 'Счета-фактуры на возврат',
      section: 'purchases',
      kind: 'thin',
      path: '/purchases/return-sf',
      mapIds: ['purchases.return_sf'],
    },
    'parity-processors': {
      key: 'processor_docs',
      title: 'Документы переработчиков',
      section: 'purchases',
      kind: 'thin',
      path: '/purchases/processors',
      mapIds: ['purchases.processors'],
    },
    'parity-business-network': {
      key: 'business_network',
      title: '1С:Бизнес-сеть',
      section: 'purchases',
      kind: 'thin',
      path: '/purchases/business-network',
      mapIds: ['purchases.business_network'],
    },
    'parity-purchase-req-analysis': {
      key: 'purchase_request_analysis',
      title: 'Анализ заявок на закупку',
      section: 'purchases',
      kind: 'thin',
      path: '/purchases/request-analysis',
      mapIds: ['purchases.request_analysis'],
    },
    'parity-scan-purchases': {
      key: 'scan_docs_purchases',
      title: 'Загрузить документы из сканов',
      section: 'purchases',
      kind: 'thin',
      path: '/purchases/scan-docs',
      mapIds: ['purchases.scan_docs'],
    },
    'parity-tsd-purchases': {
      key: 'tsd_export_purchases',
      title: 'Выгрузка товаров в ТСД',
      section: 'purchases',
      kind: 'thin',
      path: '/purchases/tsd',
      mapIds: ['purchases.tsd'],
    },
    'parity-extra-purchases': {
      key: 'extra_processors_purchases',
      title: 'Дополнительные обработки',
      section: 'purchases',
      kind: 'thin',
      path: '/purchases/extra',
      mapIds: ['purchases.extra'],
    },
    'parity-commission-sales': {
      key: 'commission_sales',
      title: 'Комиссионные продажи',
      section: 'sales',
      kind: 'thin',
      path: '/sales/commission',
      mapIds: ['sales.commission'],
    },
    'parity-sales-discrepancy': {
      key: 'sales_discrepancy_recv',
      title: 'Акты о расхождениях (полученные)',
      section: 'sales',
      kind: 'thin',
      path: '/sales/discrepancy',
      mapIds: ['sales.discrepancy_recv'],
    },
    'parity-projects': {
      key: 'projects',
      title: 'Проекты',
      section: 'sales',
      kind: 'thin',
      path: '/sales/projects',
      mapIds: ['sales.projects'],
    },
    'parity-deposit': {
      key: 'deposit_settle',
      title: 'Погашение залоговых обязательств',
      section: 'sales',
      kind: 'thin',
      path: '/sales/deposit',
      mapIds: ['sales.deposit'],
    },
    'parity-offline-eq': {
      key: 'offline_equipment',
      title: 'Обмен с оборудованием Offline',
      section: 'sales',
      kind: 'thin',
      path: '/sales/offline-equipment',
      mapIds: ['sales.offline_eq'],
    },
    'parity-palette': {
      key: 'product_palette',
      title: 'Палитра товаров',
      section: 'sales',
      kind: 'thin',
      path: '/sales/palette',
      mapIds: ['sales.palette'],
    },
    'parity-offer-publish': {
      key: 'offer_publish',
      title: 'Публикация предложений',
      section: 'sales',
      kind: 'thin',
      path: '/sales/offer-publish',
      mapIds: ['sales.offer_publish'],
    },
    'parity-ext-prices': {
      key: 'external_price_source',
      title: 'Установка цен с внешним источником',
      section: 'sales',
      kind: 'thin',
      path: '/sales/ext-prices',
      mapIds: ['sales.ext_prices'],
    },
    'parity-mailings': {
      key: 'mass_mailings',
      title: 'Массовые рассылки',
      section: 'sales',
      kind: 'thin',
      path: '/sales/mailings',
      mapIds: ['sales.mailings'],
    },
    'parity-segments': {
      key: 'counterparty_segments',
      title: 'Сегменты контрагентов',
      section: 'sales',
      kind: 'thin',
      path: '/sales/segments',
      mapIds: ['sales.segments'],
    },
    'parity-extra-sales': {
      key: 'extra_processors_sales',
      title: 'Дополнительные обработки',
      section: 'sales',
      kind: 'thin',
      path: '/sales/extra',
      mapIds: ['sales.extra'],
    },
    'parity-scan-sales': {
      key: 'scan_docs_sales',
      title: 'Загрузить документы из сканов',
      section: 'sales',
      kind: 'thin',
      path: '/sales/scan-docs',
      mapIds: ['sales.scan_docs'],
    },
    'parity-cell-transfers': {
      key: 'cell_transfers',
      title: 'Перемещения по ячейкам',
      section: 'warehouse',
      kind: 'thin',
      path: '/warehouse/cell-transfers',
      mapIds: ['warehouse.cell_transfers'],
    },
    'parity-pneumopro-demand': {
      key: 'pneumopro_demand',
      title: 'Обеспечение потребностей склада (ПневмоПро)',
      section: 'warehouse',
      kind: 'thin',
      path: '/warehouse/pneumopro-demand',
      mapIds: ['warehouse.pneumopro_demand'],
    },
    'parity-tsd-warehouse': {
      key: 'tsd_export_warehouse',
      title: 'Выгрузка товаров в ТСД',
      section: 'warehouse',
      kind: 'thin',
      path: '/warehouse/tsd',
      mapIds: ['warehouse.tsd'],
    },
    'parity-extra-warehouse': {
      key: 'extra_processors_warehouse',
      title: 'Дополнительные обработки',
      section: 'warehouse',
      kind: 'thin',
      path: '/warehouse/extra',
      mapIds: ['warehouse.extra'],
    },

  };

  function L() {
    return window.WmsLegacy || null;
  }

  function money(n) {
    const fn = L() && L().formatMoney;
    return fn ? fn(n) : String(n ?? '—');
  }

  function esc(s) {
    const fn = L() && L().esc;
    if (fn) return fn(s);
    return String(s ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;');
  }

  const THIN_STATUS_RU = {
    draft: 'Черновик',
    posted: 'Проведён',
    confirmed: 'Проведён',
    sent: 'Отправлен',
    paid: 'Оплачен',
    cancelled: 'Отменён',
    canceled: 'Отменён',
    in_progress: 'В работе',
    in_transit: 'В пути',
    partial: 'Частично получен',
    done: 'Выполнен',
    closed: 'Завершён',
    received: 'Получен',
    new: 'Новое',
    open: 'Открыто',
  };

  function thinStatusRu(status) {
    const raw = String(status || 'draft').trim();
    const key = raw.toLowerCase();
    return THIN_STATUS_RU[key] || raw;
  }

  function thinStatusBadge(status) {
    const raw = String(status || 'draft').trim().toLowerCase();
    const label = thinStatusRu(raw);
    const draftish = raw === 'draft' || raw === 'cancelled' || raw === 'canceled';
    const transit = raw === 'in_transit' || raw === 'partial';
    return `<span class="badge ${draftish ? 'draft' : ''}${transit ? ' ok' : ''}">${esc(label)}</span>`;
  }

  function thinSortState(leg, viewId) {
    leg.state.paritySort = leg.state.paritySort || {};
    const cur = leg.state.paritySort[viewId] || { sort: 'doc_date', dir: 'desc' };
    return cur;
  }

  function sortThinItems(items, sort, dir) {
    const mul = dir === 'asc' ? 1 : -1;
    const num = (v) => {
      const n = Number(v);
      return Number.isFinite(n) ? n : 0;
    };
    const str = (v) => String(v || '').toLowerCase();
    return [...items].sort((a, b) => {
      let cmp = 0;
      if (sort === 'amount' || sort === 'lines_count') {
        cmp = num(a[sort]) - num(b[sort]);
      } else if (sort === 'doc_date') {
        cmp = str(a.doc_date).localeCompare(str(b.doc_date), 'ru');
      } else if (sort === 'number') {
        cmp = str(a.number).localeCompare(str(b.number), 'ru', { numeric: true });
      } else if (sort === 'counterparty_name') {
        cmp = str(a.counterparty_name).localeCompare(str(b.counterparty_name), 'ru');
      } else if (sort === 'status') {
        cmp = thinStatusRu(a.status).localeCompare(thinStatusRu(b.status), 'ru');
      } else if (sort === 'comment') {
        cmp = str(a.comment).localeCompare(str(b.comment), 'ru');
      } else {
        cmp = str(a.doc_date).localeCompare(str(b.doc_date), 'ru');
      }
      if (cmp !== 0) return cmp * mul;
      return str(a.number).localeCompare(str(b.number), 'ru', { numeric: true }) * mul;
    });
  }

  function thinCpKind(cfg) {
    if (cfg?.section === 'purchases') return 'supplier';
    if (cfg?.section === 'sales') return 'buyer';
    return '';
  }

  function openThinCreateLightbox(leg, viewId, cfg, key, afterCreate) {
    const cpKind = thinCpKind(cfg);
    const cpLabel = cpKind === 'supplier' ? 'Поставщик' : cpKind === 'buyer' ? 'Покупатель' : 'Контрагент';
    const today = new Date().toISOString().slice(0, 10);
    leg.openCreateLightbox({
      title: 'Добавить: ' + (cfg.title || key),
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
          <label>Дата
            <input id="parity-date" type="date" value="${esc(today)}" />
          </label>
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
              const qs = new URLSearchParams({
                q,
                page: '1',
                limit: '12',
                sort: 'name',
                dir: 'asc',
              });
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
        const docDate = (root.querySelector('#parity-date')?.value || today).slice(0, 10);
        const created = await leg.api('/parity/journals/' + encodeURIComponent(key), {
          method: 'POST',
          body: JSON.stringify({
            counterparty_name: name,
            amount: 0,
            comment: '',
            doc_date: docDate,
            status: 'draft',
            payload_json: cpId ? JSON.stringify({ counterparty_id: cpId }) : '',
          }),
        });
        leg.closeCreateLightbox();
        if (typeof afterCreate === 'function') {
          await afterCreate(created);
          return;
        }
        renderThin(viewId);
      },
    });
  }

  function clearThinDocParam() {
    try {
      const u = new URL(location.href);
      if (!u.searchParams.has('doc')) return;
      u.searchParams.delete('doc');
      const q = u.searchParams.toString();
      history.replaceState(null, '', u.pathname + (q ? '?' + q : ''));
    } catch (_) {
      /* ignore */
    }
  }

  function bindThinListOpenOnce(leg) {
    if (!leg || !leg.view || leg.view.dataset.thinListOpenBound === '1') return;
    leg.view.dataset.thinListOpenBound = '1';
    leg.view.addEventListener('click', (e) => {
      const t = e.target;
      if (!t || !t.closest) return;
      if (t.closest('a, button, input, select, textarea, label, .col-filter-pop, .col-settings')) return;
      const tr = t.closest('tbody tr[data-thin-id]');
      if (!tr || !leg.view.contains(tr) || tr.hidden) return;
      const table = tr.closest('table[data-thin-view]');
      const viewId = (table && table.getAttribute('data-thin-view')) || '';
      const id = tr.getAttribute('data-thin-id') || '';
      if (!viewId || !id) return;
      e.preventDefault();
      void renderThinDetail(viewId, id).catch((err) => {
        const msg = err && err.message ? err.message : String(err || 'Ошибка');
        const el = document.getElementById('parity-q');
        if (el && el.parentElement) {
          let hint = document.getElementById('thin-open-err');
          if (!hint) {
            hint = document.createElement('span');
            hint.id = 'thin-open-err';
            hint.className = 'error';
            hint.style.marginLeft = '10px';
            el.parentElement.appendChild(hint);
          }
          hint.textContent = msg;
        } else {
          alert(msg);
        }
      });
    });
  }

  async function renderThin(viewId) {
    const leg = L();
    if (!leg) return;
    const cfg = SCREENS[viewId];
    const key = cfg.key;
    try {
      const docId = new URLSearchParams(location.search || '').get('doc');
      if (docId) {
        await renderThinDetail(viewId, docId);
        return;
      }
    } catch (_) {
      /* ignore */
    }
    const q = (leg.state.parityQ && leg.state.parityQ[viewId]) || '';
    const { sort, dir } = thinSortState(leg, viewId);
    const listKey = 'parity-' + key;
    const limit =
      typeof leg.getPageSize === 'function' ? leg.getPageSize(listKey, 50) : 50;
    leg.state.parityPage = leg.state.parityPage || {};
    const data = await leg.api(
      '/parity/journals/' +
        encodeURIComponent(key) +
        '?limit=500' +
        (q ? '&q=' + encodeURIComponent(q) : '')
    );
    const items = sortThinItems(data.items || [], sort, dir);
    const total = items.length;
    const pages = Math.max(1, Math.ceil(total / limit) || 1);
    let page = Math.max(1, Number(leg.state.parityPage[viewId]) || 1);
    if (page > pages) page = pages;
    leg.state.parityPage[viewId] = page;
    const slice = items.slice((page - 1) * limit, page * limit);
    const showLines = key === 'supplier_orders' || key === 'transfer_orders' || key === 'purchase_discrepancy';
    const isTransferReq = key === 'transfer_orders';
    const sortMark = (col) => {
      if (sort !== col) return '';
      return dir === 'asc' ? ' ▲' : ' ▼';
    };
    const th = (col, label) => {
      const sorted = sort === col ? 'sorted' : '';
      return `<th class="sortable ${sorted}" data-thin-sort="${col}" title="Сортировка">${esc(label)}${sortMark(col)}</th>`;
    };
    const pagerTop =
      typeof leg.pagerHtml === 'function'
        ? leg.pagerHtml('thinpager', page, pages, total, { limit, listKey })
        : '';
    const pagerBottom =
      typeof leg.pagerHtml === 'function'
        ? leg.pagerHtml('thinpager2', page, pages, total, { limit, listKey })
        : '';
    const today = new Date().toISOString().slice(0, 10);
    const createPanelHtml =
      key === 'supplier_orders'
        ? `<div id="thin-create-panel" class="thin-add-panel thin-create-panel" hidden>
        <div class="thin-add-panel-head">
          <strong>Новый заказ поставщику</strong>
          <button type="button" class="linkish" id="thin-create-close" title="Свернуть">Свернуть</button>
        </div>
        <div class="thin-create-grid">
          <div class="thin-create-filter-row">
            <label class="thin-create-filter">Поиск поставщика
              <input id="thin-create-cp-q" autocomplete="off" placeholder="Начните вводить название или ИНН…" />
            </label>
            <div class="form-pagetabs radio-pills thin-create-party" role="radiogroup" aria-label="Тип поставщика" data-radio="thin-cp-party">
              <button type="button" class="form-pagetab active" data-party="" role="radio" aria-checked="true">Все</button>
              <button type="button" class="form-pagetab" data-party="legal" role="radio" aria-checked="false">ООО</button>
              <button type="button" class="form-pagetab" data-party="ip" role="radio" aria-checked="false">ИП</button>
              <button type="button" class="form-pagetab" data-party="person" role="radio" aria-checked="false">Физ</button>
            </div>
          </div>
          <label class="thin-create-list-label">Поставщик
            <select id="thin-create-cp" size="10" class="thin-create-cp-list">
              <option value="">Загрузка списка…</option>
            </select>
          </label>
          <div class="thin-create-meta">
            <label>Дата
              <input id="thin-create-date" type="date" value="${esc(today)}" />
            </label>
            <label>Комментарий
              <input id="thin-create-comment" autocomplete="off" placeholder="Необязательно" />
            </label>
          </div>
        </div>
        <div class="thin-add-panel-actions">
          <button type="button" class="primary" id="thin-create-submit">Создать заказ</button>
          <button type="button" id="thin-create-cancel">Отмена</button>
          <span class="muted" id="thin-create-msg"></span>
        </div>
      </div>`
        : '';
    const colCount = isTransferReq ? 7 : showLines ? 7 : 6;
    leg.view.innerHTML = leg.formChrome(
      cfg.title,
      `
      ${createPanelHtml}
      ${
        isTransferReq
          ? `<p class="muted" style="margin:0 0 10px;font-size:12px">История заказов на перемещение. Новые создаются с остатков склада или из заказа покупателя.</p>`
          : ''
      }
      ${pagerTop}
      <div class="table-scroll">
      <table class="data-table" data-table-key="parity-${esc(key)}" data-thin-view="${esc(viewId)}" data-no-col-filter="1">
        <thead><tr>
          ${th('doc_date', 'Дата')}
          ${th('number', 'Номер')}
          ${th('counterparty_name', isTransferReq ? 'Откуда → Куда' : 'Контрагент')}
          ${isTransferReq ? '' : `${th('amount', 'Сумма')}`}
          ${showLines ? th('lines_count', 'Позиций') : ''}
          ${isTransferReq ? '<th>Задание</th>' : ''}
          ${th('status', 'Статус')}
          ${th('comment', 'Комментарий')}
        </tr></thead>
        <tbody>
          ${
            slice
              .map(
                (r) => `
            <tr class="clickable" data-thin-id="${esc(r.id)}" title="Открыть">
              <td>${esc(String(r.doc_date || '').slice(0, 10))}</td>
              <td class="mono">${esc(r.number)}</td>
              <td>${esc(r.counterparty_name || '—')}</td>
              ${isTransferReq ? '' : `<td class="mono">${r.amount ? money(r.amount) : '—'}</td>`}
              ${showLines ? `<td class="mono">${esc(r.lines_count != null ? r.lines_count : '—')}</td>` : ''}
              ${
                isTransferReq
                  ? `<td class="mono">${esc(r.warehouse_task_number || '—')}</td>`
                  : ''
              }
              <td>${thinStatusBadge(r.status)}</td>
              <td>${esc(r.comment || '')}</td>
            </tr>`
              )
              .join('') ||
            `<tr><td colspan="${colCount}" class="muted">${
              isTransferReq
                ? 'Пока нет заказов на перемещение. Создайте с экрана Остатки → «Создать заказ на перемещение».'
                : 'Пока нет записей.'
            }</td></tr>`
          }
        </tbody>
      </table>
      </div>
      ${pagerBottom}`,
      {
        section: key === 'supplier_orders' ? 'Заказ поставщику' : cfg.title || 'Журнал',
        toolbar: isTransferReq
          ? `
          <button type="button" class="primary" id="xfer-hist-balances">Создать с остатков</button>
          <div class="grow"></div>
          ${
            typeof leg.uiFind === 'function'
              ? leg.uiFind({
                  inputId: 'parity-q',
                  btnId: 'parity-search',
                  placeholder: 'Номер / маршрут / коммент',
                  value: q,
                })
              : `<div class="find ui-find" role="search">
            <input id="parity-q" type="search" placeholder="Номер / маршрут / коммент" value="${esc(q)}" autocomplete="off" />
            <button type="button" class="find-go" id="parity-search">Найти</button>
          </div>`
          }`
          : `
          <button type="button" class="primary" id="parity-add">${
            key === 'supplier_orders' ? 'Создать заказ поставщику' : 'Добавить'
          }</button>
          <div class="grow"></div>
          ${
            typeof leg.uiFind === 'function'
              ? leg.uiFind({
                  inputId: 'parity-q',
                  btnId: 'parity-search',
                  placeholder: 'Поиск',
                  value: q,
                })
              : `<div class="find ui-find" role="search">
            <input id="parity-q" type="search" placeholder="Поиск" value="${esc(q)}" autocomplete="off" />
            <button type="button" class="find-go" id="parity-search">Найти</button>
          </div>`
          }`,
      }
    );
    leg.bindFormChrome(() => leg.showSection(cfg.section));
    bindThinListOpenOnce(leg);
    const bindThinPager = (id) => {
      if (typeof leg.bindPager !== 'function') return;
      leg.bindPager(id, {
        onPage: (d) => {
          leg.state.parityPage[viewId] = Math.max(1, page + d);
          renderThin(viewId);
        },
        onLimit: (lim) => {
          if (typeof leg.setPageSize === 'function') leg.setPageSize(listKey, lim);
          leg.state.parityPage[viewId] = 1;
          renderThin(viewId);
        },
      });
    };
    bindThinPager('thinpager');
    bindThinPager('thinpager2');
    leg.view.querySelectorAll('[data-thin-sort]').forEach((thEl) => {
      thEl.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        const col = thEl.getAttribute('data-thin-sort') || 'doc_date';
        const cur = thinSortState(leg, viewId);
        if (cur.sort === col) {
          cur.dir = cur.dir === 'asc' ? 'desc' : 'asc';
        } else {
          cur.sort = col;
          cur.dir = col === 'doc_date' || col === 'amount' || col === 'lines_count' ? 'desc' : 'asc';
        }
        leg.state.paritySort[viewId] = cur;
        renderThin(viewId);
      };
    });
    const searchBtn = document.getElementById('parity-search');
    if (searchBtn) {
      searchBtn.onclick = () => {
        leg.state.parityQ = leg.state.parityQ || {};
        leg.state.parityQ[viewId] = (document.getElementById('parity-q')?.value || '').trim();
        leg.state.parityPage[viewId] = 1;
        renderThin(viewId);
      };
    }
    const xferBalBtn = document.getElementById('xfer-hist-balances');
    if (xferBalBtn) {
      xferBalBtn.onclick = () => leg.openTab('balances');
    }

    let supplierPartyKind = '';
    let supplierSearchSeq = 0;
    const thinPartyKindOf = (c) => {
      const pk = String(c?.party_kind_effective || c?.party_kind || '')
        .trim()
        .toLowerCase();
      if (pk === 'legal' || pk === 'ip' || pk === 'person') return pk;
      const inn = String(c?.inn || '').replace(/\D/g, '');
      if (inn.length === 10) return 'legal';
      if (inn.length === 12) return 'ip';
      return 'person';
    };
    const thinPartyKindLabel = (pk) =>
      pk === 'legal' ? 'ООО' : pk === 'ip' ? 'ИП' : pk === 'person' ? 'Физ' : '';
    const renderSupplierOptions = (items, meta = {}) => {
      const sel = document.getElementById('thin-create-cp');
      if (!sel) return;
      const prev = sel.value;
      const q = String(meta.q || '').trim();
      const pkFilter = String(meta.party || '').trim();
      const total = Number(meta.total);
      const list = Array.isArray(items) ? items : [];
      if (!list.length) {
        const hint = q
          ? 'Никого не найдено — уточните запрос'
          : pkFilter
            ? 'Нет поставщиков этого типа в первой выдаче — введите название'
            : 'Введите название или ИНН в поле поиска';
        sel.innerHTML = `<option value="">${esc(hint)}</option>`;
        return;
      }
      const more =
        Number.isFinite(total) && total > list.length
          ? `<option value="" disabled>… ещё ${total - list.length}, уточните поиск</option>`
          : '';
      sel.innerHTML =
        list
          .map((c) => {
            const pk = thinPartyKindOf(c);
            const pkMark = thinPartyKindLabel(pk);
            const label = [c.name || c.id, pkMark, c.inn ? 'ИНН ' + c.inn : '']
              .filter(Boolean)
              .join(' · ');
            return `<option value="${esc(c.id)}" data-name="${esc(c.name || '')}" data-party="${esc(pk)}">${esc(label)}</option>`;
          })
          .join('') + more;
      if (prev && [...sel.options].some((o) => o.value === prev)) sel.value = prev;
    };
    const loadSuppliers = async (filterQ) => {
      const sel = document.getElementById('thin-create-cp');
      const q = String(filterQ || '').trim();
      const pkFilter = String(supplierPartyKind || '').trim();
      const seq = ++supplierSearchSeq;
      if (sel) sel.innerHTML = '<option value="">Поиск…</option>';
      try {
        const qs = new URLSearchParams();
        qs.set('kind', 'supplier');
        qs.set('limit', '100');
        qs.set('page', '1');
        qs.set('sort', 'name');
        qs.set('dir', 'asc');
        if (q) qs.set('q', q);
        if (pkFilter) qs.set('party_kind', pkFilter);
        const r = await leg.api('/counterparties?' + qs.toString());
        if (seq !== supplierSearchSeq) return;
        renderSupplierOptions(r.items || [], {
          q,
          party: pkFilter,
          total: r.total != null ? r.total : (r.items || []).length,
        });
      } catch (e) {
        if (seq !== supplierSearchSeq) return;
        if (sel) sel.innerHTML = `<option value="">Ошибка: ${esc(e.message || e)}</option>`;
      }
    };
    let supplierSearchTimer = 0;
    const scheduleSupplierSearch = (filterQ) => {
      clearTimeout(supplierSearchTimer);
      supplierSearchTimer = setTimeout(() => {
        loadSuppliers(filterQ);
      }, 220);
    };

    const closeCreatePanel = () => {
      const panel = document.getElementById('thin-create-panel');
      if (panel) panel.hidden = true;
      const btn = document.getElementById('parity-add');
      if (btn && key === 'supplier_orders') btn.textContent = 'Создать заказ поставщику';
    };

    const openCreatePanel = async () => {
      const panel = document.getElementById('thin-create-panel');
      if (!panel) return;
      panel.hidden = false;
      const btn = document.getElementById('parity-add');
      if (btn) btn.textContent = 'Свернуть форму';
      const msg = document.getElementById('thin-create-msg');
      if (msg) msg.textContent = '';
      await loadSuppliers(document.getElementById('thin-create-cp-q')?.value || '');
      document.getElementById('thin-create-cp-q')?.focus();
    };

    document.getElementById('parity-add')?.addEventListener('click', async () => {
      if (key === 'supplier_orders' && document.getElementById('thin-create-panel')) {
        const panel = document.getElementById('thin-create-panel');
        if (panel.hidden) await openCreatePanel();
        else closeCreatePanel();
        return;
      }
      if (typeof leg.openCreateLightbox !== 'function') {
        alert('Обновите страницу — форма создания недоступна');
        return;
      }
      openThinCreateLightbox(leg, viewId, cfg, key, async (created) => {
        if (created?.id && typeof renderThinDetail === 'function') {
          await renderThinDetail(viewId, created.id);
          return;
        }
        renderThin(viewId);
      });
    });

    if (key === 'supplier_orders') {
      document.getElementById('thin-create-close')?.addEventListener('click', closeCreatePanel);
      document.getElementById('thin-create-cancel')?.addEventListener('click', closeCreatePanel);
      document.getElementById('thin-create-cp-q')?.addEventListener('input', (e) => {
        scheduleSupplierSearch(e.target.value);
      });
      document.querySelectorAll('.thin-create-party [data-party]').forEach((btn) => {
        btn.addEventListener('click', () => {
          supplierPartyKind = btn.getAttribute('data-party') || '';
          document.querySelectorAll('.thin-create-party [data-party]').forEach((b) => {
            const on = b === btn;
            b.classList.toggle('active', on);
            b.setAttribute('aria-checked', on ? 'true' : 'false');
          });
          loadSuppliers(document.getElementById('thin-create-cp-q')?.value || '');
        });
      });
      document.getElementById('thin-create-submit')?.addEventListener('click', async () => {
        const sel = document.getElementById('thin-create-cp');
        const msg = document.getElementById('thin-create-msg');
        const submitBtn = document.getElementById('thin-create-submit');
        const opt = sel?.selectedOptions?.[0];
        const cpId = (sel?.value || '').trim();
        const name = (opt?.getAttribute('data-name') || opt?.textContent || '').trim();
        if (!cpId || !name) {
          if (msg) msg.textContent = 'Выберите поставщика из списка';
          return;
        }
        const docDate = (
          document.getElementById('thin-create-date')?.value || today
        ).slice(0, 10);
        const comment = (document.getElementById('thin-create-comment')?.value || '').trim();
        if (submitBtn) submitBtn.disabled = true;
        if (msg) msg.textContent = 'Создание…';
        try {
          const created = await leg.api('/parity/journals/' + encodeURIComponent(key), {
            method: 'POST',
            body: JSON.stringify({
              counterparty_name: name,
              amount: 0,
              comment,
              doc_date: docDate,
              status: 'draft',
              payload_json: JSON.stringify({ counterparty_id: cpId }),
            }),
          });
          if (created?.id) await renderThinDetail(viewId, created.id);
          else renderThin(viewId);
        } catch (e) {
          if (msg) msg.textContent = e.message || String(e);
          if (submitBtn) submitBtn.disabled = false;
        }
      });
    }
  }

  async function renderThinDetail(viewId, id) {
    const leg = L();
    if (!leg) return;
    const cfg = SCREENS[viewId];
    if (!cfg || !cfg.key) throw new Error('Неизвестный журнал');
    const key = cfg.key;
    if (key === 'purchase_discrepancy') {
      const d = await leg.api(
        '/parity/journals/' + encodeURIComponent(key) + '/' + encodeURIComponent(id)
      );
      if (!d || !d.id) throw new Error('Акт не найден');
      const lines = d.lines || [];
      const kindRu = (k) =>
        k === 'missing' ? 'Недостача' : k === 'extra' ? 'Излишек' : 'Расхождение qty';
      const heading = [d.number, 'Акт о расхождениях'].filter(Boolean).join(' · ');
      const tab = (leg.state.tabs || []).find((t) => t.id === leg.state.activeTab);
      if (tab) {
        tab.title = String(heading).slice(0, 48);
        if (typeof leg.renderTabs === 'function') leg.renderTabs();
      }
      leg.view.innerHTML = leg.formChrome(
        heading,
        `<div class="form-grid">
          <label>Номер<input class="mono" value="${esc(d.number || '')}" readonly /></label>
          <label>Дата<input value="${esc(String(d.doc_date || '').slice(0, 10))}" readonly /></label>
          <label>Статус<input value="${esc(d.status || '')}" readonly /></label>
          <label>Поставка<input class="mono" value="${esc(d.supply_number || '—')}" readonly /></label>
          <label class="span-2">Основание
            <input value="${esc(
              (d.inbound_doc_id ? 'Приходная' : '') +
                (d.supply_number ? ' / поставка ' + d.supply_number : '')
            )}" readonly />
          </label>
        </div>
        <h3 style="margin:16px 0 8px;font-size:13px;color:var(--taxi-green)">Расхождения (${lines.length})</h3>
        <table class="data-table is-dense">
          <thead><tr>
            <th>Артикул</th><th>Номенклатура</th><th>В поставке</th><th>В приходе</th><th>Δ</th><th>Тип</th>
          </tr></thead>
          <tbody>
            ${
              lines
                .map(
                  (l) => `<tr class="${l.product_id ? 'clickable' : ''}" ${
                    l.product_id ? `data-product="${esc(l.product_id)}"` : ''
                  }>
                  <td class="mono">${esc(l.sku || l.code || l.article || '')}</td>
                  <td>${esc(l.product_name || l.name || '—')}</td>
                  <td class="mono">${esc(l.qty_supply)}</td>
                  <td class="mono">${esc(l.qty_inbound)}</td>
                  <td class="mono">${esc(l.qty_diff)}</td>
                  <td>${esc(kindRu(l.kind))}</td>
                </tr>`
                )
                .join('') ||
              '<tr><td colspan="6" class="muted">Нет строк</td></tr>'
            }
          </tbody>
        </table>
        ${
          d.inbound_doc_id
            ? `<p style="margin:12px 0 0"><button type="button" class="linkish" id="disc-open-in">Открыть приходную</button></p>`
            : ''
        }`,
        {
          section: 'Акт о расхождениях',
          entityKind: 'thin_doc',
          toolbar: `<button type="button" id="disc-back">К журналу</button>
            ${
              d.inbound_doc_id
                ? `<button type="button" class="primary" id="disc-open-in-tb">Приходная</button>`
                : ''
            }`,
          chatRef: {
            type: 'thin_doc',
            id: String(id),
            label: 'Акт ' + (d.number || id.slice(0, 8)),
            href: (cfg.path || '/purchases/discrepancy') + '?doc=' + encodeURIComponent(id),
          },
        }
      );
      leg.bindFormChrome(() => {
        clearThinDocParam();
        renderThin(viewId);
      });
      const back = () => {
        clearThinDocParam();
        renderThin(viewId);
      };
      document.getElementById('disc-back')?.addEventListener('click', back);
      const openIn = () => {
        if (d.inbound_doc_id) leg.openTab('doc:' + d.inbound_doc_id);
      };
      document.getElementById('disc-open-in')?.addEventListener('click', openIn);
      document.getElementById('disc-open-in-tb')?.addEventListener('click', openIn);
      leg.view.querySelectorAll('[data-product]').forEach((tr) => {
        tr.onclick = () => leg.openTab('product:' + tr.dataset.product);
      });
      return;
    }
    const d = await leg.api(
      '/parity/journals/' + encodeURIComponent(key) + '/' + encodeURIComponent(id)
    );
    if (!d || !d.id) throw new Error('Документ не найден');
    const lines = d.lines || [];
    const linesSum = lines.reduce((s, l) => s + (Number(l.amount) || Number(l.qty) * Number(l.price) || 0), 0);
    const hasAnyDm = lines.some(
      (l) => Array.isArray(l.serials) && l.serials.some((s) => String(s || '').trim())
    );
    const catNames = [
      ...new Set(lines.map((l) => String(l.category || '').trim()).filter(Boolean)),
    ].sort((a, b) => a.localeCompare(b, 'ru'));
    const noneCatCount = lines.filter((l) => !String(l.category || '').trim()).length;
    const catFilterHtml = catNames.length
      ? `<div class="table-tools" style="margin:0 0 8px">
          <label class="inline-label">Категория
            <select id="thin-cat-filter">
              <option value="">Все (${lines.length})</option>
              ${catNames
                .map((c) => {
                  const n = lines.filter((l) => String(l.category || '').trim() === c).length;
                  if (!n) return '';
                  return `<option value="${esc(c)}">${esc(c)} (${n})</option>`;
                })
                .join('')}
              ${
                noneCatCount > 0
                  ? `<option value="__none__">Без категории (${noneCatCount})</option>`
                  : ''
              }
            </select>
          </label>
        </div>`
      : '';
    const isTransferReq = key === 'transfer_orders';
    const linesEditable =
      key !== 'supplier_orders' || d.lines_editable !== false;
    const linesLockReason = String(d.lines_lock_reason || '').trim();
    const thinEntity =
      key === 'supplier_orders'
        ? 'Заказ поставщику'
        : isTransferReq
          ? 'Заказ на перемещение'
          : String(cfg.title || 'Документ').trim();
    const thinHeading =
      key === 'supplier_orders'
        ? [d.number, d.counterparty_name].filter(Boolean).join(' · ')
        : isTransferReq
          ? [d.number, d.from_label && d.to_label ? `${d.from_label} → ${d.to_label}` : d.counterparty_name]
              .filter(Boolean)
              .join(' · ')
          : leg.entityTitle
            ? leg.entityTitle(d.number, d.counterparty_name)
            : [d.number, d.counterparty_name].filter(Boolean).join(' · ');
    // Вкладка и URL-заголовок тоже с типом сущности
    const tab = (leg.state.tabs || []).find((t) => t.id === leg.state.activeTab);
    if (tab) {
      tab.title = String(
        key === 'supplier_orders'
          ? ['Заказ', d.number, d.counterparty_name].filter(Boolean).join(' · ')
          : isTransferReq
            ? ['Заказ на перемещение', d.number].filter(Boolean).join(' · ')
          : thinHeading || thinEntity
      ).slice(0, 48);
      if (typeof leg.renderTabs === 'function') leg.renderTabs();
    }

    const dataPane = isTransferReq
      ? `
      <div class="product-pane" data-pane="data">
        <h3 class="form-section-title">Заказ на перемещение</h3>
        <div class="form-grid">
          <label>Номер<input class="mono" value="${esc(d.number || '')}" readonly /></label>
          <label>Дата<input class="mono" value="${esc(String(d.doc_date || '').slice(0, 10))}" readonly /></label>
          <label>Откуда<input value="${esc(d.from_label || '')}" readonly /></label>
          <label>Куда<input value="${esc(d.to_label || '')}" readonly /></label>
          <label>Статус<input value="${esc(thinStatusRu(d.status))}" readonly /></label>
          <label>Позиций<input class="mono" id="thin-lines-count" value="${esc(String(lines.length))}" readonly /></label>
          <label>Документ перемещения<input class="mono" value="${esc(d.stock_doc_number || d.stock_doc_id || '—')}" readonly /></label>
          <label>Задание складу<input class="mono" value="${esc(d.warehouse_task_number || '—')}" readonly /></label>
          <label class="span-2">Зачем перемещаем<textarea rows="2" readonly>${esc(d.user_comment || d.comment || '')}</textarea></label>
        </div>
        <div class="toolbar" style="margin-top:10px">
          ${
            d.stock_doc_id
              ? `<button type="button" id="xfer-open-doc">Открыть перемещение</button>`
              : ''
          }
          ${
            d.warehouse_task_id
              ? `<button type="button" id="xfer-open-task">Открыть задание</button>`
              : ''
          }
          <button type="button" id="xfer-back-hist">К истории</button>
        </div>
      </div>`
      : `
      <div class="product-pane" data-pane="data">
        <h3 class="form-section-title">Данные по поставщику</h3>
        <div class="form-grid">
          <label>Поставщик<input value="${esc(d.counterparty_name || '')}" readonly /></label>
          <label>Номер<input class="mono" value="${esc(d.number || '')}" readonly /></label>
          <label>Дата<input id="so-doc-date" type="date" value="${esc(String(d.doc_date || '').slice(0, 10))}" /></label>
          <label>Статус<input value="${esc(thinStatusRu(d.status))}" readonly /></label>
          <label>Вх. номер / инвойс<input id="so-invoice-number" class="mono" value="${esc(d.invoice_number || d.supply_number || '')}" placeholder="K0814-9514-9" autocomplete="off" /></label>
          <label>Дата инвойса<input id="so-invoice-date" type="date" value="${esc(String(d.invoice_date || '').slice(0, 10))}" /></label>
          <label>План. поступление<input id="so-eta" type="date" value="${esc(String(d.expected_arrival_date || '').slice(0, 10))}" /></label>
          <label>Сумма<input class="mono" value="${esc(money(d.amount || linesSum))}" readonly /></label>
          <label>Позиций<input class="mono" id="thin-lines-count" value="${esc(String(lines.length))}" readonly /></label>
          <label class="span-2">Комментарий<input id="so-comment" value="${esc(d.comment || '')}" autocomplete="off" /></label>
          ${
            d.receipt_numbers
              ? `<label class="span-2">Приходные<input class="mono" value="${esc(d.receipt_numbers)}" readonly /></label>`
              : ''
          }
          ${
            d.source
              ? `<label>Источник<input value="${esc(d.source)}" readonly /></label>`
              : ''
          }
          ${
            d.warehouse || d.warehouse_name
              ? `<label>Склад<input value="${esc(d.warehouse_name || d.warehouse || '')}" readonly /></label>`
              : ''
          }
        </div>
        <div class="form-actions" style="margin-top:12px">
          <button type="button" id="so-save-header">Записать</button>
          <button type="button" class="primary" id="so-post-transit" title="Провести заказ и поставить «В пути»">Провести и закрыть</button>
          <span class="muted" id="so-header-msg"></span>
        </div>
      </div>`;

    const linesPane = `
      <div class="product-pane hidden" data-pane="lines">
        <h3 class="form-section-title">Номенклатура (<span id="thin-lines-shown">${lines.length}</span>)</h3>
        ${
          key === 'supplier_orders' && lines.some((l) => !String(l.product_id || '').trim())
            ? `<p class="error" style="margin:0 0 8px;font-size:12px">Есть строки без номенклатуры (⚠) — заказ остаётся черновиком, «Провести» недоступно, пока не найдёте артикулы или не удалите эти строки.</p>`
            : ''
        }
        ${
          key === 'supplier_orders' && !linesEditable && linesLockReason
            ? `<p class="muted" style="margin:0 0 8px;font-size:12px">${esc(linesLockReason)}. Добавление и удаление строк недоступны.</p>`
            : ''
        }
        ${
          key === 'supplier_orders' && linesEditable
            ? `<p class="muted" style="margin:0 0 8px;font-size:12px">Цены закупки обязательны. Дубли артикулов — отдельными строками. Номенклатура уже должна быть в Учёте (из заказа карточки не создаются). В черновике: галочки → удалить позиции; qty/цену правите прямо в таблице; «Добавить номенклатуру» — поиск существующего товара.</p>
        <div id="so-import-panel" class="thin-add-panel" hidden>
          <div class="thin-add-panel-head">
            <strong>Заполнить из Excel / CSV / копипаста</strong>
            <button type="button" class="linkish" id="so-import-close">Свернуть</button>
          </div>
          <p class="muted" style="margin:0 0 8px;font-size:12px">
            Загрузите файл пакинга (.xlsx / .xls / .csv) или вставьте таблицу (Ctrl+V).
            Можно сопоставить <b>по заголовкам</b> Excel или <b>по номерам столбцов</b>.
            Жёлтый диапазон без шапки — можно вставлять как есть (первая строка не срежется, если это артикул).
            Цены с разрядностью вида <code>1.250</code> / <code>1 250</code> читаются как 1250.
            Номенклатура должна уже быть в Учёте — из заказа карточки <b>не создаются</b>; ненайденные артикулы попадут с ⚠, провести заказ нельзя.
          </p>
          <div class="wh-tr-add-row" style="margin-bottom:10px;align-items:center">
            <label class="inline-label" style="margin:0">
              Файл
              <input type="file" id="so-import-file" accept=".xlsx,.xls,.csv,.txt,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv" />
            </label>
            <span class="muted" id="so-import-file-name" style="font-size:12px"></span>
            <button type="button" id="so-import-clear-file" class="linkish" hidden>Убрать файл</button>
          </div>
          <div class="toolbar-filter" style="margin:0 0 10px">
            <span class="toolbar-filter-label">Разбор</span>
            <button type="button" class="form-pagetab active" data-so-map-mode="headers" id="so-mode-headers">По заголовкам</button>
            <button type="button" class="form-pagetab" data-so-map-mode="columns" id="so-mode-columns">По столбцам</button>
          </div>
          <div id="so-map-headers-box" class="so-import-map" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(11rem,1fr));gap:8px;margin:0 0 10px">
            <p class="muted" style="grid-column:1/-1;margin:0;font-size:12px">Загрузите файл или вставьте таблицу с первой строкой-заголовком — появятся поля соответствия.</p>
          </div>
          <div id="so-map-columns-box" class="so-import-map" hidden style="display:none;grid-template-columns:repeat(auto-fit,minmax(9rem,1fr));gap:8px;margin:0 0 10px">
            <label>Кол. 1
              <select id="so-map-c0">
                <option value="article" selected>Артикул</option>
                <option value="qty">Количество</option>
                <option value="price">Цена</option>
                <option value="amount">Сумма</option>
                <option value="old_sku">Старый артикул</option>
                <option value="skip">Не загружать</option>
              </select>
            </label>
            <label>Кол. 2
              <select id="so-map-c1">
                <option value="article">Артикул</option>
                <option value="qty" selected>Количество</option>
                <option value="price">Цена</option>
                <option value="amount">Сумма</option>
                <option value="old_sku">Старый артикул</option>
                <option value="skip">Не загружать</option>
              </select>
            </label>
            <label>Кол. 3
              <select id="so-map-c2">
                <option value="article">Артикул</option>
                <option value="qty">Количество</option>
                <option value="price" selected>Цена</option>
                <option value="amount">Сумма</option>
                <option value="old_sku">Старый артикул</option>
                <option value="skip">Не загружать</option>
              </select>
            </label>
            <label>Кол. 4
              <select id="so-map-c3">
                <option value="article">Артикул</option>
                <option value="qty">Количество</option>
                <option value="price">Цена</option>
                <option value="amount" selected>Сумма</option>
                <option value="old_sku">Старый артикул</option>
                <option value="skip">Не загружать</option>
              </select>
            </label>
            <label>Кол. 5
              <select id="so-map-c4">
                <option value="article">Артикул</option>
                <option value="qty">Количество</option>
                <option value="price">Цена</option>
                <option value="amount">Сумма</option>
                <option value="old_sku">Старый артикул</option>
                <option value="skip" selected>Не загружать</option>
              </select>
            </label>
          </div>
          <label class="span-2">Вставка (если без файла)
            <textarea id="so-import-paste" rows="6" placeholder="MRAE11305&#9;6&#9;6782&#9;40692" style="width:100%;font-family:ui-monospace,monospace;font-size:12px"></textarea>
          </label>
          <div class="form-grid" style="margin-top:8px">
            <label class="inline-label" id="so-import-header-wrap"><input type="checkbox" id="so-import-header" /> Первая строка — заголовок (режим «По столбцам»)</label>
            <label class="inline-label"><input type="checkbox" id="so-import-append" /> Добавить к существующим строкам</label>
          </div>
          <div id="so-import-preview" class="muted" style="margin:8px 0;font-size:12px"></div>
          <div class="thin-add-panel-actions">
            <button type="button" id="so-import-preview-btn">Сопоставить</button>
            <button type="button" class="primary" id="so-import-apply-btn">Загрузить данные</button>
            <span class="muted" id="so-import-msg"></span>
          </div>
        </div>`
            : ''
        }
        <div id="thin-add-panel" class="thin-add-panel" hidden>
          <div class="thin-add-panel-head">
            <strong>Добавить номенклатуру</strong>
            <button type="button" class="linkish" id="thin-add-close" title="Свернуть">Свернуть</button>
          </div>
          <div id="thin-add-body" class="thin-prod-picker">
            <div class="form-grid thin-prod-filters">
              <label>Категория
                <select id="thin-cat-root"><option value="">Загрузка…</option></select>
              </label>
              <label id="thin-cat-sub-wrap" hidden>Подкатегория
                <select id="thin-cat-sub" disabled><option value="">—</option></select>
              </label>
              <label class="span-2">Поиск
                <input id="thin-prod-q" autocomplete="off" placeholder="Артикул / код / название…" />
              </label>
            </div>
            <div class="thin-prod-list-wrap">
              <table class="data-table is-dense thin-prod-list" data-no-col-filter="1">
                <thead><tr>
                  <th class="thin-prod-check"><input type="checkbox" id="thin-prod-check-all" title="Выбрать все" /></th>
                  <th>Артикул</th>
                  <th>Название</th>
                  <th>Категория</th>
                  <th class="thin-prod-num">Кол-во</th>
                  <th class="thin-prod-money">Цена</th>
                </tr></thead>
                <tbody id="thin-prod-tbody">
                  <tr><td colspan="6" class="muted">Откройте панель добавления</td></tr>
                </tbody>
              </table>
            </div>
            <p class="muted" id="thin-prod-meta"></p>
          </div>
          <div class="thin-add-panel-actions">
            <button type="button" class="primary" id="thin-add-submit">Добавить выбранные</button>
            <button type="button" id="thin-add-cancel">Отмена</button>
            <span class="muted" id="thin-add-msg"></span>
          </div>
        </div>
        ${catFilterHtml}
        ${
          lines.length
            ? `${
                key === 'supplier_orders' && linesEditable
                  ? `<div class="table-tools" style="margin:0 0 8px;gap:8px;align-items:center">
              <label class="inline-label" style="margin:0"><input type="checkbox" id="so-lines-check-all" /> Выделить все</label>
              <button type="button" id="so-lines-del-selected" disabled>Удалить выбранные</button>
              <span class="muted" id="so-lines-sel-msg" style="font-size:12px"></span>
            </div>`
                  : ''
              }
            <div class="table-scroll"><table class="data-table is-dense" data-table-key="thin-lines" data-no-col-filter="1">
          <thead><tr>
            ${
              key === 'supplier_orders' && linesEditable
                ? '<th class="thin-prod-check" style="width:2.2rem"></th>'
                : ''
            }
            <th>Артикул</th>
            <th>Номенклатура</th>
            <th>Категория</th>
            <th>Кол-во</th>
            <th>Цена</th>
            <th>Сумма</th>
            <th>Марки</th>
          </tr></thead>
          <tbody>
            ${lines
              .map((l, idx) => {
                const cat = String(l.category || '').trim();
                const serials = Array.isArray(l.serials)
                  ? l.serials.map((s) => String(s || '').trim()).filter(Boolean)
                  : [];
                const dmCell = serials.length
                  ? `<div class="thin-dm-list">${serials
                      .map(
                        (s) =>
                          `<button type="button" class="linkish mono thin-dm-code" data-serial="${esc(
                            s
                          )}" title="История марки ${esc(s)}">${esc(s)}</button>`
                      )
                      .join('')}</div>`
                  : '<span class="muted">—</span>';
                const checkCell =
                  key === 'supplier_orders' && linesEditable
                    ? `<td class="thin-prod-check" onclick="event.stopPropagation()"><input type="checkbox" class="so-line-cb" data-line-idx="${idx}" /></td>`
                    : '';
                return `<tr class="${l.product_id ? 'clickable' : 'thin-line-unmatched'}" ${
                  l.product_id ? `data-product="${esc(l.product_id)}"` : ''
                } data-cat="${esc(cat || '__none__')}" data-line-idx="${idx}" ${
                  !l.product_id ? 'style="background:#fff4f0"' : ''
                }>
                ${checkCell}
                <td class="mono">${esc(l.article || '')}${
                  !l.product_id ? ' <span class="muted" title="Нет в номенклатуре">⚠</span>' : ''
                }</td>
                <td>${esc(l.name || '—')}</td>
                <td>${esc(cat || '—')}</td>
                <td class="mono">${
                  key === 'supplier_orders' && linesEditable
                    ? `<input class="mono so-line-qty" type="number" min="0.001" step="any" value="${esc(String(l.qty ?? ''))}" data-line-idx="${idx}" style="width:5.5rem" aria-label="Количество" onclick="event.stopPropagation()" />`
                    : esc(l.qty)
                }</td>
                <td class="mono">${
                  key === 'supplier_orders' && linesEditable
                    ? `<input class="mono so-line-price" type="number" min="0" step="any" value="${esc(String(l.price ?? ''))}" data-line-idx="${idx}" style="width:7rem" aria-label="Цена" onclick="event.stopPropagation()" />`
                    : money(l.price)
                }</td>
                <td class="mono so-line-amount" data-line-idx="${idx}">${money(l.amount != null ? l.amount : Number(l.qty) * Number(l.price))}</td>
                <td class="thin-dm-cell" onclick="event.stopPropagation()">${dmCell}</td>
              </tr>`;
              })
              .join('')}
          </tbody>
          <tfoot>
            <tr>
              <td colspan="${key === 'supplier_orders' && linesEditable ? 6 : 5}" style="text-align:right"><strong>Итого</strong></td>
              <td class="mono"><strong id="thin-lines-sum">${money(d.amount || linesSum)}</strong></td>
              <td></td>
            </tr>
          </tfoot>
        </table></div>`
            : '<p class="muted" id="thin-lines-empty">В заказе нет строк номенклатуры — нажмите «Добавить номенклатуру» или «Из внешнего источника».</p>'
        }
      </div>`;

    const analysisPane =
      key === 'supplier_orders'
        ? `<div class="product-pane hidden" data-pane="reports">
        <h3 class="form-section-title">Анализ заказа поставщику</h3>
        <p class="muted" style="margin:0 0 10px;font-size:12px">Заказано / получено / осталось. Осталось может быть отрицательным (излишек).</p>
        <div class="table-tools" style="margin:0 0 8px">
          <button type="button" class="primary" id="so-analysis-run">Сформировать</button>
          <label class="inline-label">Вид
            <select id="so-analysis-mode">
              <option value="by_product">По номенклатуре</option>
              <option value="by_line">Как в заказе (строки)</option>
            </select>
          </label>
          <span class="muted" id="so-analysis-msg"></span>
        </div>
        <div id="so-analysis-body"><p class="muted">Нажмите «Сформировать».</p></div>
      </div>`
        : '';

    const activeThinTab =
      (leg.state.thinOrderTab === 'lines' ||
      leg.state.thinOrderTab === 'data' ||
      leg.state.thinOrderTab === 'reports'
        ? leg.state.thinOrderTab
        : 'lines') || 'lines';

    const transferToolbar = `
          <button type="button" class="primary" id="xfer-back-hist-top">К истории</button>
          <span class="muted">${esc(d.user_comment || d.comment || '')}</span>
          <div class="grow"></div>`;
    const supplierToolbar = `
          <button type="button" class="primary" id="thin-add-line" ${
            key === 'supplier_orders' && !linesEditable ? 'disabled title="' + esc(linesLockReason || 'Строки заблокированы') + '"' : ''
          }>Добавить номенклатуру</button>
          <button type="button" id="so-import-open" title="Excel / CSV / копипаст в заказ" ${
            key === 'supplier_orders' && !linesEditable ? 'disabled' : ''
          }>Excel / CSV</button>
          <button type="button" id="so-create-inbound" title="Черновик приходной на основании заказа">Создать приходную</button>
          <span class="muted" id="thin-line-msg">${
            key === 'supplier_orders' && !linesEditable ? esc(linesLockReason) : ''
          }</span>
          <div class="grow"></div>
          <button type="button" class="toolbar-ico" id="thin-dm-gen" ${lines.length ? '' : 'disabled'} title="Сгенерировать марки" data-tip="Сгенерировать марки" aria-label="Сгенерировать марки">
            <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2.2 2.2h4.2v4.2H2.2zM9.6 2.2h4.2v4.2H9.6zM2.2 9.6h4.2v4.2H2.2z" fill="none" stroke="currentColor" stroke-width="1.35"/><path d="M3.4 3.4h1.8v1.8H3.4zM10.8 3.4h1.8v1.8h-1.8zM3.4 10.8h1.8v1.8H3.4z" fill="currentColor"/><path d="M9.6 9.6h1.4v1.4H9.6zM12.4 9.6h1.4v1.4h-1.4zM9.6 12.4h1.4v1.4H9.6zM11.4 11.4h1v1h-1zM13.2 11.4h.6v.6h-.6zM11.4 13.2h.6v.6h-.6zM12.8 12.8h1.2v1.2h-1.2z" fill="currentColor"/></svg>
          </button>
          <button type="button" class="toolbar-ico" id="thin-dm-excel" ${hasAnyDm ? '' : 'disabled'} title="Excel · марки (CSV)" data-tip="Excel · марки (CSV)" aria-label="Excel">
            <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.2 2.2h6.2L13 5.8v8c0 .6-.5 1-1 1H3.2c-.6 0-1-.4-1-1V3.2c0-.6.4-1 1-1z" fill="none" stroke="currentColor" stroke-width="1.3"/><path d="M9.2 2.3V5.6H12.8" fill="none" stroke="currentColor" stroke-width="1.3"/><path d="M4.6 8.2h2.2M4.6 10.2h2.2M4.6 12.2h2.2M8.4 8.2h3M8.4 10.2h3M8.4 12.2h3" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>
          </button>
          <button type="button" class="toolbar-ico" id="thin-dm-print" ${hasAnyDm ? '' : 'disabled'} title="Печать марок" data-tip="Печать марок" aria-label="Печать">
            <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4.2 2.2h7.6v3.2H4.2zM3 6.2h10c.9 0 1.6.7 1.6 1.6v3.4H12V9.4H4v1.8H1.4V7.8c0-.9.7-1.6 1.6-1.6zM4 10.8h8v3h-8z" fill="currentColor"/><path d="M11.2 7.4h1.4M5.2 12.2h5.6" fill="none" stroke="#fff" stroke-width="1.1" stroke-linecap="round"/></svg>
          </button>
          <button type="button" class="toolbar-ico" id="thin-dm-pdf" ${hasAnyDm ? '' : 'disabled'} title="PDF · марки" data-tip="PDF · марки" aria-label="PDF">
            <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.2 1.8h6.1L13 5.5v8.7c0 .6-.5 1-1 1H3.2c-.6 0-1-.4-1-1V2.8c0-.6.4-1 1-1z" fill="none" stroke="currentColor" stroke-width="1.3"/><path d="M9.1 1.9V5.4H12.7" fill="none" stroke="currentColor" stroke-width="1.3"/><path d="M4.4 9.2h2.1c.9 0 1.5.5 1.5 1.3S7.4 11.8 6.5 11.8H5.3V13H4.4V9.2zm.9.8v1.1h.9c.4 0 .7-.2.7-.55s-.3-.55-.7-.55H5.3zM8.6 13V9.2h1.5c1.15 0 1.9.7 1.9 1.9S11.25 13 10.1 13H8.6zm.9-.8h.55c.55 0 1-.35 1-1.1s-.45-1.1-1-1.1H9.5V12.2z" fill="currentColor"/></svg>
          </button>`;
    leg.view.innerHTML = leg.formChrome(
      thinHeading || d.number || id.slice(0, 8),
      `${dataPane}${linesPane}${analysisPane}`,
      {
        section: thinEntity,
        entityKind: key === 'supplier_orders' ? 'supply_order' : 'thin_doc',
        pageTabs: [
          { id: 'data', label: 'Данные' },
          { id: 'lines', label: 'Номенклатура', count: lines.length },
          ...(key === 'supplier_orders'
            ? [{ id: 'reports', label: 'Отчёты', tip: 'Анализ заказа поставщику' }]
            : []),
        ],
        activePageTab: isTransferReq ? 'data' : activeThinTab,
        toolbar: isTransferReq ? transferToolbar : supplierToolbar,
        chatRef: {
          type: 'thin_doc',
          id: String(id),
          label:
            (key === 'supplier_orders' ? 'Заказ поставщику ' : isTransferReq ? 'Заказ на перемещение ' : '') +
            (d.number || id.slice(0, 8)) +
            (d.counterparty_name ? ' · ' + d.counterparty_name : ''),
          href: (cfg.path || '/purchases/supplier-orders') + '?doc=' + encodeURIComponent(id),
        },
      }
    );
    leg.bindFormChrome(() => {
      clearThinDocParam();
      renderThin(viewId);
    });
    if (isTransferReq) {
      const back = () => {
        clearThinDocParam();
        renderThin(viewId);
      };
      document.getElementById('xfer-back-hist')?.addEventListener('click', back);
      document.getElementById('xfer-back-hist-top')?.addEventListener('click', back);
      document.getElementById('xfer-open-doc')?.addEventListener('click', () => {
        if (d.stock_doc_id) leg.openTab('doc:' + d.stock_doc_id, (d.stock_doc_number || 'TR').slice(0, 40));
      });
      document.getElementById('xfer-open-task')?.addEventListener('click', () => {
        if (d.warehouse_task_id) {
          leg.state.whTaskFocus = d.warehouse_task_id;
          leg.openTab('wh-tasks', d.warehouse_task_number || 'Задание');
        }
      });
    }
    if (typeof leg.bindEntitySectionTabs === 'function') {
      leg.bindEntitySectionTabs(leg.view, activeThinTab, 'thinOrderTab', '.product-pane');
    } else {
      // fallback без экспорта
      const panes = [...leg.view.querySelectorAll('.product-pane')];
      const tabs = [...leg.view.querySelectorAll('[data-pagetab]')];
      const show = (pid) => {
        panes.forEach((p) => p.classList.toggle('hidden', p.dataset.pane !== pid));
        tabs.forEach((t) => t.classList.toggle('active', t.dataset.pagetab === pid));
        leg.state.thinOrderTab = pid;
      };
      tabs.forEach((btn) => {
        btn.onclick = () => show(btn.dataset.pagetab);
      });
      show(activeThinTab);
    }

    if (key === 'supplier_orders') {
      const saveHeader = async (opts = {}) => {
        const msg = document.getElementById('so-header-msg');
        const body = {
          doc_date: document.getElementById('so-doc-date')?.value || undefined,
          invoice_number: document.getElementById('so-invoice-number')?.value || '',
          invoice_date: document.getElementById('so-invoice-date')?.value || '',
          expected_arrival_date: document.getElementById('so-eta')?.value || '',
          comment: document.getElementById('so-comment')?.value || '',
        };
        if (opts.status) body.status = opts.status;
        if (msg) msg.textContent = 'Сохранение…';
        try {
          await leg.api('/parity/journals/supplier_orders/' + encodeURIComponent(id), {
            method: 'PATCH',
            body: JSON.stringify(body),
          });
          if (msg) msg.textContent = opts.status === 'in_transit' ? 'В пути' : 'Сохранено';
          if (opts.reload) await renderThinDetail(viewId, id);
          return true;
        } catch (e) {
          if (msg) msg.textContent = e.message || String(e);
          return false;
        }
      };
      document.getElementById('so-save-header')?.addEventListener('click', () => saveHeader());
      document.getElementById('so-post-transit')?.addEventListener('click', async () => {
        if (!lines.length) {
          alert('Добавьте номенклатуру перед проведением');
          return;
        }
        const noProduct = lines.filter((l) => !String(l.product_id || '').trim());
        if (noProduct.length) {
          alert(
            `Нельзя провести: ${noProduct.length} строк без найденной номенклатуры (${noProduct
              .slice(0, 5)
              .map((l) => l.article || '?')
              .join(', ')}${noProduct.length > 5 ? '…' : ''}). Заказ остаётся черновиком.`
          );
          return;
        }
        const bad = lines.find((l) => !(Number(l.price) > 0));
        if (bad) {
          if (
            !confirm(
              'Есть строки без цены закупки. Провести заказ всё равно (статус «В пути»)?'
            )
          ) {
            return;
          }
        }
        const ok = await saveHeader({ status: 'in_transit', reload: true });
        if (ok) {
          /* stay on detail after reload */
        }
      });

      const openImport = () => {
        const panel = document.getElementById('so-import-panel');
        if (panel) panel.hidden = false;
        leg.state.thinOrderTab = 'lines';
        if (typeof leg.bindEntitySectionTabs === 'function') {
          leg.bindEntitySectionTabs(leg.view, 'lines', 'thinOrderTab', '.product-pane');
        }
        document.getElementById('so-import-paste')?.focus();
      };
      document.getElementById('so-import-open')?.addEventListener('click', openImport);
      document.getElementById('so-import-close')?.addEventListener('click', () => {
        const panel = document.getElementById('so-import-panel');
        if (panel) panel.hidden = true;
      });

      let soImportFile = null; // { filename, content_base64, table, headers, sheet }
      let soMapMode = 'headers';

      const roleOptions = (selected) => {
        const opts = [
          ['article', 'Артикул'],
          ['qty', 'Количество'],
          ['price', 'Цена'],
          ['amount', 'Сумма'],
          ['old_sku', 'Старый артикул'],
          ['skip', 'Не загружать'],
        ];
        return opts
          .map(
            ([v, lab]) =>
              `<option value="${v}" ${v === selected ? 'selected' : ''}>${lab}</option>`
          )
          .join('');
      };

      const setMapMode = (mode) => {
        soMapMode = mode === 'columns' ? 'columns' : 'headers';
        document.getElementById('so-mode-headers')?.classList.toggle('active', soMapMode === 'headers');
        document.getElementById('so-mode-columns')?.classList.toggle('active', soMapMode === 'columns');
        const hb = document.getElementById('so-map-headers-box');
        const cb = document.getElementById('so-map-columns-box');
        if (hb) {
          hb.hidden = soMapMode !== 'headers';
          hb.style.display = soMapMode === 'headers' ? 'grid' : 'none';
        }
        if (cb) {
          cb.hidden = soMapMode !== 'columns';
          cb.style.display = soMapMode === 'columns' ? 'grid' : 'none';
        }
        const hw = document.getElementById('so-import-header-wrap');
        if (hw) hw.style.display = soMapMode === 'columns' ? '' : 'none';
      };
      document.querySelectorAll('[data-so-map-mode]').forEach((btn) => {
        btn.addEventListener('click', () => setMapMode(btn.getAttribute('data-so-map-mode')));
      });
      setMapMode('headers');

      const paintHeaderMap = (headers, suggestedRoles) => {
        const box = document.getElementById('so-map-headers-box');
        if (!box) return;
        if (!headers || !headers.length) {
          box.innerHTML =
            '<p class="muted" style="grid-column:1/-1;margin:0;font-size:12px">Загрузите файл или вставьте таблицу с первой строкой-заголовком — появятся поля соответствия.</p>';
          return;
        }
        box.innerHTML = headers
          .map((h, i) => {
            const role = (suggestedRoles && suggestedRoles[i]) || 'skip';
            return `<label title="${esc(h)}">«${esc(String(h).slice(0, 28))}»
              <select id="so-map-h${i}" data-col="${i}">${roleOptions(role)}</select>
            </label>`;
          })
          .join('');
      };

      const buildImportMap = () => {
        const map = { article: 0, qty: 1, price: 2, amount: null, old_sku: null };
        const seen = Object.create(null);
        if (soMapMode === 'headers') {
          const box = document.getElementById('so-map-headers-box');
          const sels = box ? [...box.querySelectorAll('select[data-col]')] : [];
          sels.forEach((sel) => {
            const i = Number(sel.getAttribute('data-col'));
            const role = String(sel.value || 'skip');
            if (role === 'skip' || !Number.isFinite(i) || seen[role] != null) return;
            seen[role] = i;
            if (role === 'article') map.article = i;
            else if (role === 'qty') map.qty = i;
            else if (role === 'price') map.price = i;
            else if (role === 'amount') map.amount = i;
            else if (role === 'old_sku') map.old_sku = i;
          });
          return map;
        }
        for (let i = 0; i < 5; i++) {
          const role = String(document.getElementById('so-map-c' + i)?.value || 'skip');
          if (role === 'skip' || seen[role] != null) continue;
          seen[role] = i;
          if (role === 'article') map.article = i;
          else if (role === 'qty') map.qty = i;
          else if (role === 'price') map.price = i;
          else if (role === 'amount') map.amount = i;
          else if (role === 'old_sku') map.old_sku = i;
        }
        return map;
      };

      const clearImportFile = () => {
        soImportFile = null;
        const inp = document.getElementById('so-import-file');
        if (inp) inp.value = '';
        const nm = document.getElementById('so-import-file-name');
        if (nm) nm.textContent = '';
        const clr = document.getElementById('so-import-clear-file');
        if (clr) clr.hidden = true;
        paintHeaderMap([], []);
      };
      document.getElementById('so-import-clear-file')?.addEventListener('click', clearImportFile);

      document.getElementById('so-import-file')?.addEventListener('change', async (ev) => {
        const file = ev.target?.files?.[0];
        const msg = document.getElementById('so-import-msg');
        if (!file) return;
        if (msg) msg.textContent = 'Читаю файл…';
        try {
          const buf = await file.arrayBuffer();
          const bytes = new Uint8Array(buf);
          let binary = '';
          const chunk = 0x8000;
          for (let i = 0; i < bytes.length; i += chunk) {
            binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
          }
          const content_base64 = btoa(binary);
          const r = await leg.api(
            '/purchases/supplier-orders/' + encodeURIComponent(id) + '/import/parse-file',
            {
              method: 'POST',
              body: JSON.stringify({
                filename: file.name,
                content_base64,
              }),
            }
          );
          soImportFile = {
            filename: file.name,
            content_base64,
            table: r.table || [],
            headers: r.headers || [],
            sheet: r.sheet || '',
          };
          const nm = document.getElementById('so-import-file-name');
          if (nm) {
            nm.textContent = `${file.name} · ${r.row_count || 0} строк · лист «${r.sheet || ''}»`;
          }
          const clr = document.getElementById('so-import-clear-file');
          if (clr) clr.hidden = false;
          paintHeaderMap(r.headers || [], r.suggested_roles || []);
          setMapMode(r.has_header === false ? 'columns' : 'headers');
          if (msg) {
            msg.textContent = r.has_header === false
              ? 'Файл без шапки — режим «По столбцам». Проверьте колонки и сумму после «Сопоставить».'
              : `Файл разобран: заголовки узнали сами (${(r.suggested_roles || []).filter((x) => x && x !== 'skip').length} колонок). Проверьте соответствие и нажмите «Сопоставить».`;
          }
        } catch (e) {
          clearImportFile();
          if (msg) msg.textContent = e.message || String(e);
        }
      });

      const importPayload = () => {
        const paste = document.getElementById('so-import-paste')?.value || '';
        const body = {
          map: buildImportMap(),
          map_mode: soMapMode,
          has_header:
            soMapMode === 'headers' ? true : !!document.getElementById('so-import-header')?.checked,
          create_missing: false,
          minimal_cards: false,
        };
        if (soImportFile?.table?.length) {
          body.table = soImportFile.table;
          body.filename = soImportFile.filename;
        } else if (paste.trim()) {
          body.paste = paste;
        }
        return body;
      };

      document.getElementById('so-import-preview-btn')?.addEventListener('click', async () => {
        const msg = document.getElementById('so-import-msg');
        const box = document.getElementById('so-import-preview');
        const body = importPayload();
        if (!body.table && !body.paste) {
          if (msg) msg.textContent = 'Загрузите файл или вставьте таблицу';
          return;
        }
        if (msg) msg.textContent = 'Сопоставление…';
        try {
          const r = await leg.api(
            '/purchases/supplier-orders/' + encodeURIComponent(id) + '/import/preview',
            { method: 'POST', body: JSON.stringify(body) }
          );
          if (box) {
            const errRows = (r.rows || []).filter((x) => x.status === 'error').slice(0, 8);
            const createRows = (r.rows || [])
              .filter((x) => x.status === 'will_create')
              .slice(0, 8);
            box.innerHTML = `<b>${r.received || 0}</b> строк получено · <b>${r.matched || 0}</b> сопоставлено · <b>${r.will_create || 0}</b> будет создано · <b>${r.errors || 0}</b> невозможно
              · сумма ≈ <b>${Number(r.total_sum || 0).toLocaleString('ru-RU', { maximumFractionDigits: 2 })}</b> ₽
              ${
                createRows.length
                  ? `<div style="margin-top:6px">Создать: ${createRows
                      .map((x) => esc(x.article) + (x.create_from_sku ? ' ← ' + esc(x.create_from_sku) : ''))
                      .join(', ')}</div>`
                  : ''
              }
              ${
                errRows.length
                  ? `<div class="error" style="margin-top:6px">${errRows
                      .map((x) => esc(x.article || '?') + ': ' + esc(x.error || ''))
                      .join('; ')}</div>`
                  : ''
              }`;
          }
          if (msg) msg.textContent = r.errors ? 'Есть ошибки' : 'Готово к загрузке';
        } catch (e) {
          if (msg) msg.textContent = e.message || String(e);
        }
      });
      document.getElementById('so-import-apply-btn')?.addEventListener('click', async () => {
        const msg = document.getElementById('so-import-msg');
        const body = importPayload();
        if (!body.table && !body.paste) {
          if (msg) msg.textContent = 'Загрузите файл или вставьте таблицу';
          return;
        }
        body.append = !!document.getElementById('so-import-append')?.checked;
        body.allocate_marks = false;
        if (msg) msg.textContent = 'Загрузка…';
        try {
          const r = await leg.api(
            '/purchases/supplier-orders/' + encodeURIComponent(id) + '/import/apply',
            { method: 'POST', body: JSON.stringify(body) }
          );
          if (msg) {
            const skipped = Number(r.skipped_count || (r.skipped_unmatched || []).length || 0);
            msg.textContent =
              'Загружено ' +
              (r.received || 0) +
              (r.created ? ', создано карточек: ' + r.created : '') +
              (skipped
                ? `. Не найдено артикулов: ${skipped} — заказ черновик, проведение будет недоступно, пока не исправите`
                : '');
          }
          await renderThinDetail(viewId, id);
        } catch (e) {
          if (msg) msg.textContent = e.message || String(e);
        }
      });

      document.getElementById('so-create-inbound')?.addEventListener('click', async () => {
        const lineMsg = document.getElementById('thin-line-msg');
        if (!lines.length) {
          alert('В заказе нет строк');
          return;
        }
        if (lineMsg) lineMsg.textContent = 'Создание приходной…';
        try {
          const r = await leg.api('/warehouse/inbound/from-order', {
            method: 'POST',
            body: JSON.stringify({
              supplier_order_id: id,
              copy_prices: false,
            }),
          });
          if (lineMsg) lineMsg.textContent = 'Черновик ' + (r.number || '');
          if (r.id) leg.openTab('doc:' + r.id, r.number || 'Приход');
        } catch (e) {
          if (lineMsg) lineMsg.textContent = e.message || String(e);
          else alert(e.message || String(e));
        }
      });

      const runAnalysis = async () => {
        const msg = document.getElementById('so-analysis-msg');
        const body = document.getElementById('so-analysis-body');
        const mode = document.getElementById('so-analysis-mode')?.value || 'by_product';
        if (msg) msg.textContent = 'Формирование…';
        try {
          const r = await leg.api(
            '/purchases/supplier-orders/' +
              encodeURIComponent(id) +
              '/analysis?mode=' +
              encodeURIComponent(mode)
          );
          const tot = r.totals || {};
          const rows = (r.lines || [])
            .map((l) => {
              const rem = Number(l.qty_remaining) || 0;
              const cls = rem !== 0 ? (rem < 0 ? ' style="color:#0a7"' : ' style="color:#c00"') : '';
              return `<tr>
                <td class="mono">${esc(l.sku || '')}</td>
                <td>${esc(l.name || '')}</td>
                <td class="mono num">${esc(l.qty_ordered)}</td>
                <td class="mono num">${esc(l.qty_received)}</td>
                <td class="mono num"${cls}>${esc(l.qty_remaining)}</td>
              </tr>`;
            })
            .join('');
          if (body) {
            body.innerHTML = `<table class="data-table is-dense">
              <thead><tr><th>Артикул</th><th>Номенклатура</th><th>Заказано</th><th>Получено</th><th>Осталось</th></tr></thead>
              <tbody>${rows || '<tr><td colspan="5" class="muted">Нет данных</td></tr>'}</tbody>
              <tfoot><tr>
                <td colspan="2"><strong>Итого</strong></td>
                <td class="mono"><strong>${esc(tot.qty_ordered)}</strong></td>
                <td class="mono"><strong>${esc(tot.qty_received)}</strong></td>
                <td class="mono"><strong>${esc(tot.qty_remaining)}</strong></td>
              </tr></tfoot>
            </table>`;
          }
          if (msg) msg.textContent = 'Готово';
        } catch (e) {
          if (msg) msg.textContent = e.message || String(e);
        }
      };
      document.getElementById('so-analysis-run')?.addEventListener('click', runAnalysis);
      if (activeThinTab === 'reports') setTimeout(runAnalysis, 50);
    }

    try {
      const u = new URL(location.href);
      u.searchParams.set('doc', id);
      history.replaceState(null, '', u.pathname + '?' + u.searchParams.toString());
    } catch (_) {
      /* ignore */
    }
    let addPanelReady = false;
    const flattenCatChildren = (nodes, depth = 1) => {
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
    };
    const closeAddPanel = () => {
      const panel = document.getElementById('thin-add-panel');
      if (panel) panel.hidden = true;
      const btn = document.getElementById('thin-add-line');
      if (btn) btn.textContent = 'Добавить номенклатуру';
    };
    const mountAddPanel = () => {
      if (addPanelReady) return;
      addPanelReady = true;
      const root = document.getElementById('thin-add-body');
      if (!root) return;
      const escFn = leg.esc;
      const rootSel = root.querySelector('#thin-cat-root');
      const subSel = root.querySelector('#thin-cat-sub');
      const subWrap = root.querySelector('#thin-cat-sub-wrap');
      const qInput = root.querySelector('#thin-prod-q');
      const tbody = root.querySelector('#thin-prod-tbody');
      const meta = root.querySelector('#thin-prod-meta');
      const checkAll = root.querySelector('#thin-prod-check-all');
      let catTree = { roots: [], uncategorized: 0 };
      let loadSeq = 0;

      const fillSubOptions = (rootId) => {
        const rootCat = (catTree.roots || []).find((r) => r.id === rootId);
        const subs = rootCat ? flattenCatChildren(rootCat.children || []) : [];
        if (!subs.length) {
          if (subWrap) subWrap.hidden = true;
          if (subSel) {
            subSel.disabled = true;
            subSel.innerHTML = '<option value="">—</option>';
          }
          return;
        }
        if (subWrap) subWrap.hidden = false;
        if (subSel) {
          subSel.disabled = false;
          subSel.innerHTML =
            '<option value="">Все подкатегории</option>' +
            subs
              .map(
                (c) =>
                  `<option value="${escFn(c.id)}">${escFn(c.name)} (${escFn(c.products_total || 0)})</option>`
              )
              .join('');
        }
      };

      const selectedCategoryId = () => {
        const sub = (subSel?.value || '').trim();
        if (sub) return sub;
        return (rootSel?.value || '').trim();
      };

      const reloadList = async () => {
        const seq = ++loadSeq;
        if (tbody) {
          tbody.innerHTML = '<tr><td colspan="6" class="muted">Загрузка…</td></tr>';
        }
        if (checkAll) checkAll.checked = false;
        try {
          const q = (qInput?.value || '').trim();
          const catId = selectedCategoryId();
          let url = '/products?limit=100&page=1&item_kind=product';
          if (q) url += '&q=' + encodeURIComponent(q);
          if (catId) url += '&category_id=' + encodeURIComponent(catId);
          const data = await leg.api(url);
          if (seq !== loadSeq) return;
          const items = data.items || [];
          if (!items.length) {
            if (tbody) {
              tbody.innerHTML =
                '<tr><td colspan="6" class="muted">Ничего не найдено — смените категорию или поиск</td></tr>';
            }
            if (meta) meta.textContent = '0 товаров';
            return;
          }
          if (tbody) {
            tbody.innerHTML = items
              .map((p) => {
                const title = String(p.name || p.sku || '—');
                return `<tr data-product-id="${escFn(p.id)}">
                  <td class="thin-prod-check"><input type="checkbox" class="thin-prod-cb" /></td>
                  <td class="mono">${escFn(p.sku || p.code || '')}</td>
                  <td title="${escFn(title)}">${escFn(title)}</td>
                  <td>${escFn(p.category || '—')}</td>
                  <td class="thin-prod-num"><input class="thin-prod-qty mono" type="number" inputmode="numeric" step="0.001" min="0.001" value="1" aria-label="Количество" /></td>
                  <td class="thin-prod-money"><input class="thin-prod-price mono" type="number" inputmode="numeric" step="1" min="0" value="0" placeholder="0" aria-label="Цена" /></td>
                </tr>`;
              })
              .join('');
          }
          if (meta) {
            const total = Number(data.total) || items.length;
            meta.textContent =
              total > items.length
                ? `Показано ${items.length} из ${total} — уточните поиск или категорию`
                : `${items.length} товар${items.length === 1 ? '' : items.length < 5 ? 'а' : 'ов'}`;
          }
        } catch (e) {
          if (seq !== loadSeq) return;
          if (tbody) {
            tbody.innerHTML = `<tr><td colspan="6" class="error">${escFn(e.message || String(e))}</td></tr>`;
          }
          if (meta) meta.textContent = '';
        }
      };

      (async () => {
        try {
          catTree = await leg.api('/categories/tree').catch(() => ({
            roots: [],
            uncategorized: 0,
          }));
        } catch (_) {
          catTree = { roots: [], uncategorized: 0 };
        }
        if (rootSel) {
          rootSel.innerHTML =
            '<option value="">Все категории</option>' +
            `<option value="__none__">Без категории (${escFn(catTree.uncategorized || 0)})</option>` +
            (catTree.roots || [])
              .map(
                (r) =>
                  `<option value="${escFn(r.id)}">${escFn(r.name)} (${escFn(r.products_total || 0)})</option>`
              )
              .join('');
        }
        fillSubOptions('');
        await reloadList();
      })();

      rootSel?.addEventListener('change', () => {
        fillSubOptions(rootSel.value || '');
        reloadList();
      });
      subSel?.addEventListener('change', () => reloadList());
      let qTimer = 0;
      qInput?.addEventListener('input', () => {
        clearTimeout(qTimer);
        qTimer = setTimeout(() => reloadList(), 280);
      });
      qInput?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          e.stopPropagation();
          clearTimeout(qTimer);
          reloadList();
        }
      });
      checkAll?.addEventListener('change', () => {
        root.querySelectorAll('.thin-prod-cb').forEach((cb) => {
          cb.checked = !!checkAll.checked;
        });
      });
      tbody?.addEventListener('click', (e) => {
        const tr = e.target?.closest?.('tr[data-product-id]');
        if (!tr || e.target.closest('input')) return;
        const cb = tr.querySelector('.thin-prod-cb');
        if (cb) cb.checked = !cb.checked;
      });
    };
    const openAddPanel = () => {
      if (key === 'supplier_orders' && !linesEditable) {
        const msg = document.getElementById('thin-line-msg');
        if (msg) msg.textContent = linesLockReason || 'Строки заказа нельзя менять';
        return;
      }
      // Сначала вкладка «Номенклатура»
      const linesTab = leg.view.querySelector('[data-pagetab="lines"]');
      if (linesTab) linesTab.click();
      const panel = document.getElementById('thin-add-panel');
      if (!panel) return;
      const opening = panel.hidden;
      if (!opening) {
        closeAddPanel();
        return;
      }
      panel.hidden = false;
      const btn = document.getElementById('thin-add-line');
      if (btn) btn.textContent = 'Свернуть добавление';
      mountAddPanel();
      panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      setTimeout(() => document.getElementById('thin-prod-q')?.focus(), 50);
    };
    document.getElementById('thin-add-line').onclick = openAddPanel;
    document.getElementById('thin-add-close')?.addEventListener('click', closeAddPanel);
    document.getElementById('thin-add-cancel')?.addEventListener('click', closeAddPanel);
    if (key === 'supplier_orders' && linesEditable) {
      const syncSelBtn = () => {
        const n = leg.view.querySelectorAll('.so-line-cb:checked').length;
        const btn = document.getElementById('so-lines-del-selected');
        const msg = document.getElementById('so-lines-sel-msg');
        if (btn) btn.disabled = n === 0;
        if (msg) msg.textContent = n ? `Выбрано: ${n}` : '';
      };
      document.getElementById('so-lines-check-all')?.addEventListener('change', (ev) => {
        const on = !!ev.target?.checked;
        leg.view.querySelectorAll('.so-line-cb').forEach((cb) => {
          cb.checked = on;
        });
        syncSelBtn();
      });
      leg.view.querySelectorAll('.so-line-cb').forEach((cb) => {
        cb.addEventListener('change', syncSelBtn);
      });
      document.getElementById('so-lines-del-selected')?.addEventListener('click', async () => {
        const indices = [...leg.view.querySelectorAll('.so-line-cb:checked')]
          .map((cb) => Number(cb.getAttribute('data-line-idx')))
          .filter((n) => Number.isFinite(n) && n >= 0);
        if (!indices.length) return;
        if (
          !confirm(
            `Удалить из заказа выбранные позиции (${indices.length})?\nСам заказ не удаляется.`
          )
        ) {
          return;
        }
        const msg = document.getElementById('thin-line-msg');
        if (msg) msg.textContent = 'Удаляю позиции…';
        try {
          await leg.api(
            '/parity/journals/' +
              encodeURIComponent(key) +
              '/' +
              encodeURIComponent(id) +
              '/lines/delete',
            { method: 'POST', body: JSON.stringify({ indices }) }
          );
          await renderThinDetail(viewId, id);
        } catch (e) {
          if (msg) msg.textContent = e.message || String(e);
          else alert(e.message || String(e));
        }
      });

      const saveLineCell = async (idx, patch) => {
        const msg = document.getElementById('thin-line-msg');
        try {
          const r = await leg.api(
            '/parity/journals/' +
              encodeURIComponent(key) +
              '/' +
              encodeURIComponent(id) +
              '/lines/' +
              encodeURIComponent(String(idx)),
            { method: 'PATCH', body: JSON.stringify(patch) }
          );
          const line = (r.lines || [])[idx];
          const amountEl = leg.view.querySelector(`.so-line-amount[data-line-idx="${idx}"]`);
          if (amountEl && line) {
            amountEl.textContent = money(
              line.amount != null ? line.amount : Number(line.qty) * Number(line.price)
            );
          }
          const sumEl = document.getElementById('thin-lines-sum');
          if (sumEl && r.amount != null) sumEl.textContent = money(r.amount);
          if (msg) msg.textContent = '';
        } catch (e) {
          if (msg) msg.textContent = e.message || String(e);
          await renderThinDetail(viewId, id);
        }
      };
      leg.view.querySelectorAll('.so-line-qty').forEach((inp) => {
        inp.addEventListener('change', () => {
          const idx = Number(inp.getAttribute('data-line-idx'));
          const qty = Number(inp.value);
          if (!Number.isFinite(idx) || !(qty > 0)) {
            alert('Количество должно быть > 0');
            return;
          }
          saveLineCell(idx, { qty });
        });
      });
      leg.view.querySelectorAll('.so-line-price').forEach((inp) => {
        inp.addEventListener('change', () => {
          const idx = Number(inp.getAttribute('data-line-idx'));
          const price = Number(inp.value);
          if (!Number.isFinite(idx) || !(price >= 0)) {
            alert('Цена некорректна');
            return;
          }
          saveLineCell(idx, { price });
        });
      });
    }
    document.getElementById('thin-add-submit')?.addEventListener('click', async () => {
      const root = document.getElementById('thin-add-body');
      const msg = document.getElementById('thin-add-msg');
      const submitBtn = document.getElementById('thin-add-submit');
      if (!root) return;
      const rows = [...root.querySelectorAll('tr[data-product-id]')].filter((tr) =>
        tr.querySelector('.thin-prod-cb')?.checked
      );
      if (!rows.length) {
        if (msg) msg.textContent = 'Отметьте товары в списке';
        return;
      }
      if (submitBtn) submitBtn.disabled = true;
      if (msg) msg.textContent = '';
      try {
        const linesUrl =
          '/parity/journals/' +
          encodeURIComponent(key) +
          '/' +
          encodeURIComponent(id) +
          '/lines';
        let added = 0;
        for (const tr of rows) {
          const productId = tr.getAttribute('data-product-id') || '';
          if (!productId) continue;
          const qty = Number(tr.querySelector('.thin-prod-qty')?.value) || 1;
          const price = Number(tr.querySelector('.thin-prod-price')?.value) || 0;
          await leg.api(linesUrl, {
            method: 'POST',
            body: JSON.stringify({ product_id: productId, qty, price }),
          });
          added += 1;
          if (msg) msg.textContent = `Добавлено ${added} из ${rows.length}…`;
        }
        await renderThinDetail(viewId, id);
      } catch (e) {
        if (msg) msg.textContent = e.message || String(e);
        if (submitBtn) submitBtn.disabled = false;
      }
    });
    const catSel = document.getElementById('thin-cat-filter');
    if (catSel) {
      catSel.onchange = () => {
        const v = catSel.value || '';
        let shown = 0;
        let sum = 0;
        leg.view.querySelectorAll('tbody tr[data-cat]').forEach((tr) => {
          const cat = tr.getAttribute('data-cat') || '__none__';
          const ok = !v || cat === v;
          tr.hidden = !ok;
          if (ok) {
            shown += 1;
            const cells = tr.querySelectorAll('td');
            const raw = (cells[cells.length - 2]?.textContent || '').replace(/\s/g, '').replace(',', '.');
            const n = Number(String(raw).replace(/[^\d.-]/g, ''));
            if (Number.isFinite(n)) sum += n;
          }
        });
        const shownEl = document.getElementById('thin-lines-shown');
        if (shownEl) shownEl.textContent = String(shown);
        const sumEl = document.getElementById('thin-lines-sum');
        if (sumEl) sumEl.textContent = money(sum);
      };
    }
    const dmBase =
      '/api/parity/journals/' + encodeURIComponent(key) + '/' + encodeURIComponent(id) + '/datamatrix';
    const dmMsg = () => document.getElementById('thin-line-msg');
    document.getElementById('thin-dm-gen')?.addEventListener('click', async () => {
      const msg = dmMsg();
      const btn = document.getElementById('thin-dm-gen');
      if (btn) btn.disabled = true;
      try {
        if (msg) msg.textContent = 'Генерация марок…';
        const res = await leg.api(
          '/parity/journals/' +
            encodeURIComponent(key) +
            '/' +
            encodeURIComponent(id) +
            '/datamatrix/allocate',
          { method: 'POST', body: JSON.stringify({ force: false }) }
        );
        if (msg) {
          msg.textContent =
            Number(res.dm_created) > 0
              ? `Создано марок: ${res.dm_created} (префикс ${res.dm_prefix || 'DM'})`
              : 'Все марки уже выданы';
        }
        await renderThinDetail(viewId, id);
      } catch (err) {
        if (msg) msg.textContent = err.message || String(err);
        if (btn) btn.disabled = false;
      }
    });
    document.getElementById('thin-dm-excel')?.addEventListener('click', () => {
      window.location.href = dmBase + '/excel.csv';
    });
    document.getElementById('thin-dm-print')?.addEventListener('click', () => {
      window.open(dmBase + '/labels.html', '_blank', 'noopener');
    });
    document.getElementById('thin-dm-pdf')?.addEventListener('click', () => {
      window.open(dmBase + '/labels.pdf', '_blank', 'noopener');
    });
    leg.view.querySelectorAll('tr[data-product]').forEach((tr) => {
      tr.onclick = (e) => {
        if (e.target && e.target.closest && e.target.closest('[data-serial]')) return;
        if (tr.hidden) return;
        if (typeof leg.openTab === 'function') leg.openTab('product:' + tr.dataset.product);
        else if (typeof window.openTab === 'function') window.openTab('product:' + tr.dataset.product);
      };
    });
    leg.view.querySelectorAll('[data-serial]').forEach((btn) => {
      btn.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        const code = String(btn.getAttribute('data-serial') || '').trim();
        if (!code) return;
        if (typeof leg.openTab === 'function') {
          leg.openTab('serial:' + code, String(code).slice(0, 40));
        } else if (typeof window.openTab === 'function') {
          window.openTab('serial:' + code, String(code).slice(0, 40));
        }
      };
    });
  }

  async function renderGtd() {
    const leg = L();
    if (!leg) return;
    const q = (leg.state.parityQ && leg.state.parityQ.gtd) || '';
    const data = await leg.api('/gtd?limit=200' + (q ? '&q=' + encodeURIComponent(q) : ''));
    const items = data.items || [];
    leg.view.innerHTML = leg.formChrome(
      'Номера ГТД',
      `
      <p class="muted" style="margin:0 0 10px">${esc(data.note || '')}</p>
      <table>
        <thead><tr><th>Код</th><th>Описание</th><th>Источник</th><th>Строк</th><th></th></tr></thead>
        <tbody>
          ${
            items
              .map(
                (r) => `
            <tr>
              <td class="mono">${esc(r.code)}</td>
              <td>${esc(r.description || '')}</td>
              <td>${esc(r.source || '')}</td>
              <td class="mono">${esc(r.lines_count)}</td>
              <td><button type="button" data-gtd-edit="${esc(r.id)}">Изменить</button></td>
            </tr>`
              )
              .join('') || `<tr><td colspan="5" class="muted">Нет номеров ГТД — появятся из приходных 1С или добавьте вручную.</td></tr>`
          }
        </tbody>
      </table>`,
      {
        toolbar: `
          <button type="button" class="primary" id="gtd-add">Добавить ГТД</button>
          <div class="grow"></div>
          <div class="find">
            <input id="parity-q" placeholder="Код / описание" value="${esc(q)}" />
            <button type="button" class="find-go" id="parity-search">Найти</button>
          </div>`,
      }
    );
    leg.bindFormChrome(() => leg.showSection('purchases'));
    document.getElementById('parity-search').onclick = () => {
      leg.state.parityQ = leg.state.parityQ || {};
      leg.state.parityQ.gtd = (document.getElementById('parity-q').value || '').trim();
      renderGtd();
    };
    document.getElementById('gtd-add').onclick = async () => {
      const code = window.prompt('Номер ГТД', '');
      if (!code) return;
      const description = window.prompt('Описание', '') || '';
      try {
        await leg.api('/gtd', { method: 'POST', body: JSON.stringify({ code, description }) });
        renderGtd();
      } catch (e) {
        alert(e.message || String(e));
      }
    };
    leg.view.querySelectorAll('[data-gtd-edit]').forEach((btn) => {
      btn.onclick = async (ev) => {
        ev.stopPropagation();
        const id = btn.getAttribute('data-gtd-edit');
        const code = window.prompt('Код ГТД', '');
        if (code == null) return;
        const description = window.prompt('Описание', '') || '';
        try {
          await leg.api('/gtd/' + encodeURIComponent(id), {
            method: 'PATCH',
            body: JSON.stringify({ code, description }),
          });
          renderGtd();
        } catch (e) {
          alert(e.message || String(e));
        }
      };
    });
  }

  async function renderStockLow() {
    const leg = L();
    if (!leg) return;
    const data = await leg.api('/stock/low?limit=300');
    const items = data.items || [];
    leg.view.innerHTML = leg.formChrome(
      'Остатки ниже минимума',
      `
      <p class="muted" style="margin:0 0 10px">${esc(data.note || '')}
        Без min_stock: <b>${esc(data.products_without_min)}</b> товаров.
      </p>
      <table>
        <thead><tr><th>Артикул</th><th>Наименование</th><th>Бренд</th><th>Остаток</th><th>Минимум</th><th>Дефицит</th></tr></thead>
        <tbody>
          ${
            items
              .map(
                (r) => `
            <tr class="clickable" data-product="${esc(r.id)}">
              <td class="mono">${esc(r.sku)}</td>
              <td>${esc(r.name)}</td>
              <td>${esc(r.brand || '')}</td>
              <td class="mono">${esc(r.qty)}</td>
              <td class="mono">${esc(r.min_stock)}</td>
              <td class="mono"><b>${esc(r.deficit)}</b></td>
            </tr>`
              )
              .join('') ||
            `<tr><td colspan="6" class="muted">Нет позиций ниже минимума (или min_stock не задан).</td></tr>`
          }
        </tbody>
      </table>`
    );
    leg.bindFormChrome(() => leg.showSection('warehouse'));
    leg.view.querySelectorAll('[data-product]').forEach((tr) => {
      tr.onclick = () => leg.openTab('product:' + tr.getAttribute('data-product'));
    });
  }

  async function renderTransfers() {
    const leg = L();
    if (!leg) return;
    const data = await leg.api('/stock/transfers?limit=200');
    const items = data.items || [];
    leg.view.innerHTML = leg.formChrome(
      'Перемещения',
      `
      <p class="muted" style="margin:0 0 10px">${esc(data.note || '')}</p>
      <table>
        <thead><tr><th>Дата</th><th>Номер</th><th>Откуда</th><th>Куда</th><th>Статус</th><th>Комментарий</th></tr></thead>
        <tbody>
          ${
            items
              .map(
                (r) => `
            <tr class="clickable" data-doc="${esc(r.id)}">
              <td>${esc(String(r.doc_date || '').slice(0, 10))}</td>
              <td class="mono">${esc(r.number)}</td>
              <td>${esc(r.warehouse_from || '—')}</td>
              <td>${esc(r.warehouse_to || '—')}</td>
              <td><span class="badge ${r.posted ? '' : 'draft'}">${r.posted ? 'Проведён' : 'Черновик'}${r.source === '1c' ? ' · 1С' : ''}</span></td>
              <td>${esc(r.comment || '')}</td>
            </tr>`
              )
              .join('') ||
            `<tr><td colspan="6" class="muted">Перемещений пока нет. Создайте через API/документы (doc_type=transfer).</td></tr>`
          }
        </tbody>
      </table>`
    );
    leg.bindFormChrome(() => leg.showSection('warehouse'));
    leg.view.querySelectorAll('[data-doc]').forEach((tr) => {
      tr.onclick = () => leg.openTab('doc:' + tr.getAttribute('data-doc'));
    });
  }

  async function renderWriteoffs() {
    const leg = L();
    if (!leg) return;
    const data = await leg.api('/stock/writeoffs?limit=200');
    const items = data.items || [];
    leg.view.innerHTML = leg.formChrome(
      'Списания',
      `
      <p class="muted" style="margin:0 0 10px">${esc(data.note || '')}</p>
      <table>
        <thead><tr><th>Дата</th><th>Номер</th><th>Контрагент</th><th>Склад</th><th>Сумма</th><th>Статус</th></tr></thead>
        <tbody>
          ${
            items
              .map(
                (r) => `
            <tr class="clickable" data-doc="${esc(r.id)}">
              <td>${esc(String(r.doc_date || '').slice(0, 10))}</td>
              <td class="mono">${esc(r.number)}</td>
              <td>${esc(r.counterparty || '—')}</td>
              <td>${esc(r.warehouse || '—')}</td>
              <td class="mono">${r.amount != null ? money(r.amount) : '—'}</td>
              <td><span class="badge ${r.posted ? '' : 'draft'}">${r.posted ? 'Проведён' : 'Черновик'}${r.source === '1c' ? ' · 1С' : ''}</span></td>
            </tr>`
              )
              .join('') || `<tr><td colspan="6" class="muted">Списаний нет.</td></tr>`
          }
        </tbody>
      </table>`
    );
    leg.bindFormChrome(() => leg.showSection('warehouse'));
    leg.view.querySelectorAll('[data-doc]').forEach((tr) => {
      tr.onclick = () => leg.openTab('doc:' + tr.getAttribute('data-doc'));
    });
  }

  async function renderInventory() {
    const leg = L();
    if (!leg) return;
    const data = await leg.api('/inventory?limit=100');
    const items = data.items || [];
    leg.view.innerHTML = leg.formChrome(
      'Инвентаризации',
      `
      <p class="muted" style="margin:0 0 10px">${esc(data.note || '')}</p>
      <table>
        <thead><tr><th>Дата</th><th>Номер</th><th>Склад</th><th>Статус</th><th>Комментарий</th></tr></thead>
        <tbody>
          ${
            items
              .map(
                (r) => `
            <tr>
              <td>${esc(String(r.doc_date || '').slice(0, 10))}</td>
              <td class="mono">${esc(r.number)}</td>
              <td>${esc(r.warehouse || r.warehouse_id || '—')}</td>
              <td><span class="badge ${r.posted ? '' : 'draft'}">${r.posted ? 'Проведена' : 'Черновик'}</span></td>
              <td>${esc(r.comment || '')}</td>
            </tr>`
              )
              .join('') ||
            `<tr><td colspan="5" class="muted">Инвентаризаций пока нет. Создайте через POST /api/inventory.</td></tr>`
          }
        </tbody>
      </table>`
    );
    leg.bindFormChrome(() => leg.showSection('warehouse'));
  }

  async function renderPriceMatrix() {
    const leg = L();
    if (!leg) return;
    const data = await leg.api('/prices/matrix?limit=150');
    const types = data.price_types || [];
    const items = data.items || [];
    leg.view.innerHTML = leg.formChrome(
      'Прайс-листы',
      `
      <p class="muted" style="margin:0 0 10px">${esc(data.note || '')}</p>
      <table>
        <thead><tr><th>Артикул</th><th>Наименование</th>${types.map((t) => `<th>${esc(t)}</th>`).join('')}</tr></thead>
        <tbody>
          ${
            items
              .map(
                (r) => `
            <tr class="clickable" data-product="${esc(r.id)}">
              <td class="mono">${esc(r.sku)}</td>
              <td>${esc(r.name)}</td>
              ${types.map((t) => `<td class="mono">${r.prices && r.prices[t] != null ? money(r.prices[t]) : '—'}</td>`).join('')}
            </tr>`
              )
              .join('') || `<tr><td colspan="${2 + types.length}" class="muted">Нет цен — синхронизируйте типы цен.</td></tr>`
          }
        </tbody>
      </table>`
    );
    leg.bindFormChrome(() => leg.showSection('sales'));
    leg.view.querySelectorAll('[data-product]').forEach((tr) => {
      tr.onclick = () => leg.openTab('product:' + tr.getAttribute('data-product'));
    });
  }

  async function renderSalesAnalysis() {
    const leg = L();
    if (!leg) return;
    const data = await leg.api('/sales/analysis');
    const byMonth = data.sales_by_month || [];
    const byType = data.sales_by_type || [];
    const buyers = data.top_buyers || [];
    const sku = data.top_sku || [];
    leg.view.innerHTML = leg.formChrome(
      'Анализ продаж',
      `
      <p class="muted" style="margin:0 0 10px">${esc(data.note || '')}</p>
      <p class="muted">Списания: <b class="mono">${esc(data.outbound_1c && data.outbound_1c.docs)}</b> док. · <b class="mono">${money((data.outbound_1c && data.outbound_1c.amount) || 0)}</b></p>
      <h3 style="margin:12px 0 6px;font-size:14px">Списания по месяцам</h3>
      <table>
        <thead><tr><th>Месяц</th><th>Документов</th><th>Сумма</th></tr></thead>
        <tbody>
          ${
            byMonth
              .map(
                (r) =>
                  `<tr><td>${esc(r.ym)}</td><td class="mono">${esc(r.docs)}</td><td class="mono">${money(r.amount)}</td></tr>`
              )
              .join('') || `<tr><td colspan="3" class="muted">Нет данных</td></tr>`
          }
        </tbody>
      </table>
      <h3 style="margin:16px 0 6px;font-size:14px">Топ покупателей</h3>
      <table>
        <thead><tr><th>Контрагент</th><th>Док.</th><th>Сумма</th></tr></thead>
        <tbody>
          ${
            buyers
              .map(
                (r) =>
                  `<tr><td>${esc(r.name)}</td><td class="mono">${esc(r.docs)}</td><td class="mono">${money(r.amount)}</td></tr>`
              )
              .join('') || `<tr><td colspan="3" class="muted">Нет данных</td></tr>`
          }
        </tbody>
      </table>
      <h3 style="margin:16px 0 6px;font-size:14px">Топ SKU</h3>
      <table>
        <thead><tr><th>Артикул</th><th>Наименование</th><th>Кол-во</th><th>Сумма</th></tr></thead>
        <tbody>
          ${
            sku
              .map(
                (r) =>
                  `<tr><td class="mono">${esc(r.sku)}</td><td>${esc(r.name)}</td><td class="mono">${esc(r.qty)}</td><td class="mono">${money(r.amount)}</td></tr>`
              )
              .join('') || `<tr><td colspan="4" class="muted">Нет данных</td></tr>`
          }
        </tbody>
      </table>
      <h3 style="margin:16px 0 6px;font-size:14px">Локальные документы (счета/УПД)</h3>
      <table>
        <thead><tr><th>Тип</th><th>Документов</th><th>Сумма</th></tr></thead>
        <tbody>
          ${
            byType
              .map(
                (r) =>
                  `<tr><td>${esc(r.doc_type)}</td><td class="mono">${esc(r.docs)}</td><td class="mono">${money(r.amount)}</td></tr>`
              )
              .join('') || `<tr><td colspan="3" class="muted">Нет локальных sales_docs</td></tr>`
          }
        </tbody>
      </table>`
    );
    leg.bindFormChrome(() => leg.showSection('sales'));
  }

  function renderHubLinks(links) {
    return `<ul style="margin:0;padding-left:18px">${(links || [])
      .map((l) =>
        l.view
          ? `<li><a href="#" data-parity-link="${esc(l.view)}">${esc(l.label)}</a></li>`
          : l.href
            ? `<li><a href="${esc(l.href)}">${esc(l.label)}</a></li>`
            : `<li>${esc(l.label)}</li>`
      )
      .join('')}</ul>`;
  }

  function bindHubLinks(leg, section) {
    leg.bindFormChrome(() => leg.showSection(section));
    leg.view.querySelectorAll('[data-parity-link]').forEach((a) => {
      a.onclick = (e) => {
        e.preventDefault();
        leg.openTab(a.getAttribute('data-parity-link'));
      };
    });
  }

  async function renderSalesReports() {
    const leg = L();
    if (!leg) return;
    const data = await leg.api('/sales/reports');
    const byMonth = data.by_month || [];
    const buyers = data.top_buyers || [];
    leg.view.innerHTML = leg.formChrome(
      'Отчёты продаж',
      `
      <p class="muted" style="margin:0 0 10px">${esc(data.note || '')}</p>
      <div class="form-metrics" style="display:flex;gap:16px;flex-wrap:wrap;margin-bottom:12px">
        <div><div class="muted">Списаний</div><b>${esc(data.outbound_docs)}</b></div>
        <div><div class="muted">Сумма списаний</div><b>${money(data.outbound_amount)}</b></div>
        <div><div class="muted">Локальных док.</div><b>${esc(data.local_sales_docs)}</b></div>
      </div>
      <h3 style="margin:12px 0 6px;font-size:14px">По месяцам</h3>
      <table><thead><tr><th>Месяц</th><th>Док.</th><th>Сумма</th></tr></thead><tbody>
        ${
          byMonth
            .map((r) => `<tr><td>${esc(r.ym)}</td><td class="mono">${esc(r.docs)}</td><td class="mono">${money(r.amount)}</td></tr>`)
            .join('') || '<tr><td colspan="3" class="muted">Нет данных</td></tr>'
        }
      </tbody></table>
      <h3 style="margin:16px 0 6px;font-size:14px">Топ покупателей</h3>
      <table><thead><tr><th>Контрагент</th><th>Док.</th><th>Сумма</th></tr></thead><tbody>
        ${
          buyers
            .map((r) => `<tr><td>${esc(r.name)}</td><td class="mono">${esc(r.docs)}</td><td class="mono">${money(r.amount)}</td></tr>`)
            .join('') || '<tr><td colspan="3" class="muted">Нет данных</td></tr>'
        }
      </tbody></table>
      <h3 style="margin:16px 0 6px;font-size:14px">Связанные</h3>
      ${renderHubLinks(data.links)}`
    );
    bindHubLinks(leg, 'sales');
  }

  async function renderRetailReports() {
    const leg = L();
    if (!leg) return;
    const data = await leg.api('/sales/retail-reports?days=60');
    const days = data.days || [];
    leg.view.innerHTML = leg.formChrome(
      'Отчёты о розничных продажах',
      `
      <p class="muted" style="margin:0 0 10px">${esc(data.note || '')}</p>
      <div class="form-metrics" style="display:flex;gap:16px;flex-wrap:wrap;margin-bottom:12px">
        <div><div class="muted">Сегодня док.</div><b>${esc(data.today && data.today.docs)}</b></div>
        <div><div class="muted">Сегодня сумма</div><b>${money((data.today && data.today.amount) || 0)}</b></div>
      </div>
      <h3 style="margin:12px 0 6px;font-size:14px">По дням (списания)</h3>
      <table><thead><tr><th>День</th><th>Док.</th><th>Сумма</th></tr></thead><tbody>
        ${
          days
            .map((r) => `<tr><td>${esc(r.day)}</td><td class="mono">${esc(r.docs)}</td><td class="mono">${money(r.amount)}</td></tr>`)
            .join('') || '<tr><td colspan="3" class="muted">Нет данных</td></tr>'
        }
      </tbody></table>
      ${renderHubLinks(data.links)}`
    );
    bindHubLinks(leg, 'sales');
  }

  async function renderCrmReports() {
    const leg = L();
    if (!leg) return;
    const data = await leg.api('/crm/reports');
    const pipes = data.by_pipeline || [];
    const statuses = data.by_status || [];
    leg.view.innerHTML = leg.formChrome(
      'Отчёты CRM',
      `
      <p class="muted" style="margin:0 0 10px">${esc(data.note || '')}</p>
      <div class="form-metrics" style="display:flex;gap:16px;flex-wrap:wrap;margin-bottom:12px">
        <div><div class="muted">Сделок</div><b>${esc(data.deals)}</b></div>
        <div><div class="muted">Сумма</div><b>${money(data.amount)}</b></div>
      </div>
      <h3 style="margin:12px 0 6px;font-size:14px">По воронкам</h3>
      <table><thead><tr><th>Воронка</th><th>Сделок</th><th>Сумма</th></tr></thead><tbody>
        ${
          pipes
            .map((r) => `<tr><td>${esc(r.pipeline)}</td><td class="mono">${esc(r.deals)}</td><td class="mono">${money(r.amount)}</td></tr>`)
            .join('') || '<tr><td colspan="3" class="muted">Нет сделок</td></tr>'
        }
      </tbody></table>
      <h3 style="margin:16px 0 6px;font-size:14px">По статусам</h3>
      <table><thead><tr><th>Статус</th><th>Сделок</th></tr></thead><tbody>
        ${
          statuses
            .map((r) => `<tr><td>${esc(r.status)}</td><td class="mono">${esc(r.deals)}</td></tr>`)
            .join('') || '<tr><td colspan="2" class="muted">Нет данных</td></tr>'
        }
      </tbody></table>
      ${renderHubLinks(data.links)}`
    );
    bindHubLinks(leg, 'crm');
  }

  async function renderPurchasesReports() {
    const leg = L();
    if (!leg) return;
    const data = await leg.api('/purchases/reports');
    const byMonth = data.by_month || [];
    const suppliers = data.top_suppliers || [];
    leg.view.innerHTML = leg.formChrome(
      'Отчёты закупок',
      `
      <p class="muted" style="margin:0 0 10px">${esc(data.note || '')}</p>
      <div class="form-metrics" style="display:flex;gap:16px;flex-wrap:wrap;margin-bottom:12px">
        <div><div class="muted">Приходных</div><b>${esc(data.inbound_docs)}</b></div>
        <div><div class="muted">Сумма</div><b>${money(data.inbound_amount)}</b></div>
        <div><div class="muted">С ГТД</div><b>${esc(data.inbound_with_gtd)}</b></div>
        <div><div class="muted">Поставщики</div><b>${esc(data.suppliers_touch)}</b></div>
      </div>
      <h3 style="margin:12px 0 6px;font-size:14px">Приходы по месяцам</h3>
      <table><thead><tr><th>Месяц</th><th>Док.</th><th>Сумма</th></tr></thead><tbody>
        ${
          byMonth
            .map((r) => `<tr><td>${esc(r.ym)}</td><td class="mono">${esc(r.docs)}</td><td class="mono">${money(r.amount)}</td></tr>`)
            .join('') || '<tr><td colspan="3" class="muted">Нет данных</td></tr>'
        }
      </tbody></table>
      <h3 style="margin:16px 0 6px;font-size:14px">Топ поставщиков</h3>
      <table><thead><tr><th>Поставщик</th><th>Док.</th><th>Сумма</th></tr></thead><tbody>
        ${
          suppliers
            .map((r) => `<tr><td>${esc(r.name)}</td><td class="mono">${esc(r.docs)}</td><td class="mono">${money(r.amount)}</td></tr>`)
            .join('') || '<tr><td colspan="3" class="muted">Нет данных</td></tr>'
        }
      </tbody></table>
      ${renderHubLinks(data.links)}`
    );
    bindHubLinks(leg, 'purchases');
  }

  async function renderWarehouseReports() {
    const leg = L();
    if (!leg) return;
    const data = await leg.api('/warehouse/reports');
    const wh = data.by_warehouse || [];
    leg.view.innerHTML = leg.formChrome(
      'Отчёты склада',
      `
      <p class="muted" style="margin:0 0 10px">${esc(data.note || '')}</p>
      <div class="form-metrics" style="display:flex;gap:16px;flex-wrap:wrap;margin-bottom:12px">
        <div><div class="muted">Позиций &gt;0</div><b>${esc(data.positive_rest_rows)}</b></div>
        <div><div class="muted">Документов</div><b>${esc(data.stock_docs)}</b></div>
        <div><div class="muted">Приходов</div><b>${esc(data.inbound)}</b></div>
        <div><div class="muted">Расходов</div><b>${esc(data.write_offs)}</b></div>
        <div><div class="muted">Перемещений</div><b>${esc(data.transfers)}</b></div>
      </div>
      <h3 style="margin:12px 0 6px;font-size:14px">Остатки по складам</h3>
      <table><thead><tr><th>Склад</th><th>Позиций</th><th>Кол-во</th></tr></thead><tbody>
        ${
          wh
            .map((r) => `<tr><td>${esc(r.warehouse)}</td><td class="mono">${esc(r.rows)}</td><td class="mono">${esc(r.qty)}</td></tr>`)
            .join('') || '<tr><td colspan="3" class="muted">Нет остатков</td></tr>'
        }
      </tbody></table>
      ${renderHubLinks(data.links)}`
    );
    bindHubLinks(leg, 'warehouse');
  }

  async function renderPurchasesInbound() {
    const leg = L();
    if (!leg) return;
    const gtdOnly = !!(leg.state.parityGtdOnly);
    const data = await leg.api(
      '/purchases/inbound-report?limit=100' + (gtdOnly ? '&gtd=1' : '')
    );
    const items = data.items || [];
    leg.view.innerHTML = leg.formChrome(
      'Приходы с ГТД',
      `
      <p class="muted" style="margin:0 0 10px">${esc(data.note || '')}</p>
      <table>
        <thead><tr><th>Дата</th><th>Номер</th><th>Поставщик</th><th>Склад</th><th>Сумма</th><th>Строк ГТД</th><th>Коды ГТД</th></tr></thead>
        <tbody>
          ${
            items
              .map(
                (r) => `
            <tr class="clickable" data-doc="${esc(r.id)}">
              <td>${esc(String(r.doc_date || '').slice(0, 10))}</td>
              <td class="mono">${esc(r.number)}</td>
              <td>${esc(r.counterparty || '—')}</td>
              <td>${esc(r.warehouse || '—')}</td>
              <td class="mono">${money(r.amount)}</td>
              <td class="mono">${esc(r.lines_with_gtd)}</td>
              <td class="mono">${esc(r.gtd_codes || '—')}</td>
            </tr>`
              )
              .join('') || `<tr><td colspan="7" class="muted">Нет приходов${gtdOnly ? ' с ГТД' : ''}.</td></tr>`
          }
        </tbody>
      </table>`,
      {
        toolbar: `
          <button type="button" id="gtd-filter" class="${gtdOnly ? 'primary' : ''}">Только с ГТД</button>
          <button type="button" id="gtd-all" class="${!gtdOnly ? 'primary' : ''}">Все приходы</button>`,
      }
    );
    leg.bindFormChrome(() => leg.showSection('purchases'));
    document.getElementById('gtd-filter').onclick = () => {
      leg.state.parityGtdOnly = true;
      renderPurchasesInbound();
    };
    document.getElementById('gtd-all').onclick = () => {
      leg.state.parityGtdOnly = false;
      renderPurchasesInbound();
    };
    leg.view.querySelectorAll('[data-doc]').forEach((tr) => {
      tr.onclick = () => leg.openTab('doc:' + tr.getAttribute('data-doc'));
    });
  }

  async function renderDemand() {
    const leg = L();
    if (!leg) return;
    const data = await leg.api('/purchases/demand?limit=200');
    const items = data.items || [];
    leg.view.innerHTML = leg.formChrome(
      'Расчёт потребностей',
      `
      <p class="muted" style="margin:0 0 10px">${esc(data.note || '')} ${esc(data.soon_data || '')}</p>
      <table>
        <thead><tr><th>Артикул</th><th>Наименование</th><th>Остаток</th><th>Минимум</th><th>Нужно</th></tr></thead>
        <tbody>
          ${
            items
              .map(
                (r) => `
            <tr class="clickable" data-product="${esc(r.id)}">
              <td class="mono">${esc(r.sku)}</td>
              <td>${esc(r.name)}</td>
              <td class="mono">${esc(r.qty)}</td>
              <td class="mono">${esc(r.min_stock)}</td>
              <td class="mono"><b>${esc(r.need)}</b></td>
            </tr>`
              )
              .join('') || `<tr><td colspan="5" class="muted">Потребностей нет (задайте min_stock).</td></tr>`
          }
        </tbody>
      </table>`
    );
    leg.bindFormChrome(() => leg.showSection('warehouse'));
    leg.view.querySelectorAll('[data-product]').forEach((tr) => {
      tr.onclick = () => leg.openTab('product:' + tr.getAttribute('data-product'));
    });
  }

  const RENDERERS = {
    'parity-gtd': renderGtd,
    'parity-stock-low': renderStockLow,
    'parity-transfers': renderTransfers,
    'parity-writeoffs': renderWriteoffs,
    'parity-inventory': renderInventory,
    'parity-price-lists': renderPriceMatrix,
    'parity-sales-analysis': renderSalesAnalysis,
    'parity-sales-reports': renderSalesReports,
    'parity-retail-reports': renderRetailReports,
    'parity-crm-reports': renderCrmReports,
    'parity-purchases-reports': renderPurchasesReports,
    'parity-purchases-inbound': renderPurchasesInbound,
    'parity-demand': renderDemand,
    'parity-warehouse-reports': renderWarehouseReports,
  };

  function linkKey(l) {
    if (l.view) return 'view:' + l.view;
    if (l.href) return 'href:' + l.href;
    if (l.external) return 'ext:' + l.external;
    return 'label:' + (l.label || '');
  }

  function ensureGroup(cols, colIdx, title) {
    while (cols.length <= colIdx) cols.push([]);
    const col = cols[colIdx];
    let g = col.find((x) => x && x.title === title);
    if (!g) {
      g = { title: title, links: [] };
      col.push(g);
    }
    if (!Array.isArray(g.links)) g.links = [];
    return g;
  }

  function upsertLink(group, link) {
    const k = linkKey(link);
    const i = group.links.findIndex((l) => linkKey(l) === k || (l.label && l.label === link.label && (l.disabled || link.view)));
    if (i >= 0) {
      const prev = group.links[i];
      // не затираем чужие рабочие view; апгрейдим disabled stubs
      if (prev.disabled || (!prev.view && link.view) || (prev.view === link.view)) {
        group.links[i] = Object.assign({}, prev, link);
        delete group.links[i].disabled;
      }
      return;
    }
    group.links.push(link);
  }

  /** Merge-only: не заменяет целиком SECTIONS (CRM/money трогают другие разделы). */
  function patchMenus(SECTIONS) {
    if (!SECTIONS) return;
    if (!SECTIONS.purchases) SECTIONS.purchases = { cols: [] };
    if (!SECTIONS.sales) SECTIONS.sales = { cols: [] };
    if (!SECTIONS.warehouse) SECTIONS.warehouse = { cols: [] };
    if (!SECTIONS.crm) SECTIONS.crm = { cols: [] };
    if (!Array.isArray(SECTIONS.purchases.cols)) SECTIONS.purchases.cols = [];
    if (!Array.isArray(SECTIONS.sales.cols)) SECTIONS.sales.cols = [];
    if (!Array.isArray(SECTIONS.warehouse.cols)) SECTIONS.warehouse.cols = [];
    if (!Array.isArray(SECTIONS.crm.cols)) SECTIONS.crm.cols = [];

    // Закупки: меню Э0–Э1 (не раздувать паритетом УНФ). Экраны SCREENS остаются по URL.
    SECTIONS.purchases.cols = [
      [
        {
          title: 'Закупки',
          links: [
            { view: 'suppliers', label: 'Поставщики' },
            { view: 'in', label: 'Приходные накладные' },
          ],
        },
      ],
      [
        {
          title: 'Товары',
          links: [{ view: 'products', label: 'Номенклатура' }],
        },
        {
          title: 'Отчёты',
          links: [{ view: 'parity-purchases-reports', label: 'Отчёты по закупкам' }],
        },
      ],
    ];

    // Продажи: меню Э0–Э1 (не раздувать паритетом УНФ). Экраны SCREENS остаются по URL.
    SECTIONS.sales.cols = [
      [
        {
          title: 'Продажи',
          links: [
            { view: 'buyers', label: 'Покупатели' },
            { view: 'deals', label: 'Заказы покупателей' },
            { view: 'docs', label: 'Списания' },
            { view: 'invoices', label: 'Счета на оплату' },
            { view: 'workorders', label: 'Заказ-наряды' },
            { view: 'upd', label: 'УПД' },
            { view: 'sf', label: 'Счета-фактуры' },
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
      [
        {
          title: 'Отчёты',
          links: [{ view: 'parity-sales-reports', label: 'Отчёты по продажам' }],
        },
      ],
    ];

    // Склад: промежуточное меню как у Закупок (не сразу в журнал).
    SECTIONS.warehouse.cols = [
      [
        {
          title: 'Склад',
          links: [
            { view: 'warehouses', label: 'Склады', whHubTab: 'warehouses' },
            { view: 'warehouses', label: 'Заказы на перемещение', whHubTab: 'requests' },
            { view: 'balances', label: 'Остатки' },
            { view: 'wh-cells', label: 'Адресные ячейки' },
            { view: 'in', label: 'Приходные накладные' },
            { view: 'wh-tasks', label: 'Задания склада' },
            { label: 'Задачи на сегодня', href: '/pick' },
            { view: 'stock-valuation', label: 'Стоимость склада' },
          ],
        },
      ],
      [
        {
          title: 'Работа склада',
          links: [
            { view: 'parity-stock-low', label: 'Остатки ниже минимума' },
            { view: 'product-units', label: 'Экземпляры / серийники' },
          ],
        },
      ],
      [
        {
          title: 'Номенклатура',
          links: [
            { view: 'products', label: 'Номенклатура' },
            { view: 'media-photos', label: 'Фото номенклатуры' },
            { view: 'brands', label: 'Бренды' },
          ],
        },
      ],
    ];

    const c = SECTIONS.crm.cols;
    const cAnal = ensureGroup(c, 1, 'Аналитика');
    [
      { view: 'pipelines', label: 'Воронка продаж' },
      { view: 'parity-crm-reports', label: 'Отчёты' },
    ].forEach((l) => upsertLink(cAnal, l));
  }

  function install() {
    const leg = L();
    if (!leg || !leg.routes) {
      console.warn('[parity-a] WmsLegacy not ready');
      return;
    }
    leg.state.parityQ = leg.state.parityQ || {};
    patchMenus(leg.SECTIONS);

    Object.keys(SCREENS).forEach((id) => {
      const cfg = SCREENS[id];
      leg.VIEW_TITLES[id] = cfg.title;
      leg.TAB_PATHS[id] = cfg.path;
      if (leg.TAB_SECTION_MAP) leg.TAB_SECTION_MAP[id] = cfg.section;
      if (cfg.kind === 'thin') {
        leg.routes[id] = () => renderThin(id);
      } else if (RENDERERS[id]) {
        leg.routes[id] = RENDERERS[id];
      }
    });

    console.info('[parity-a] installed screens:', Object.keys(SCREENS).length);
  }

  window.WmsParityA = { SCREENS, install, patchMenus };
})();
