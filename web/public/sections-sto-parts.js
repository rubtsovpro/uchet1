/**
 * Курьер в UI склада. Экран /warehouse/sto-parts убран — создание из заказа покупателя.
 */
(function () {
  function L() {
    return window.WmsLegacy || null;
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  async function api(path, opts) {
    const leg = L();
    if (leg && typeof leg.api === 'function') return leg.api(path, opts);
    const r = await fetch('/api' + path, {
      credentials: 'same-origin',
      ...(opts || {}),
      headers: {
        ...((opts && opts.headers) || {}),
        ...(!(opts && opts.body instanceof FormData)
          ? { 'Content-Type': 'application/json' }
          : {}),
      },
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error || r.statusText);
    return data;
  }

  /** Старый URL /warehouse/sto-parts → заказы покупателя. */
  function redirectStoPartsGone() {
    const leg = L();
    if (leg && typeof leg.openTab === 'function') {
      leg.openTab('deals');
      return;
    }
    location.replace('/crm/deals');
  }

  async function renderCourierBoard() {
    const leg = L();
    const view = leg.view || document.getElementById('view');
    let tab = 'active';
    let q = '';

    const chrome =
      leg.formChrome ||
      function (t, b) {
        return `<div class="form-chrome"><div class="form-titlebar"><h2>${t}</h2></div><div class="form-body">${b}</div></div>`;
      };

    const paint = async () => {
      const msg = document.getElementById('cr-msg');
      const box = document.getElementById('cr-list');
      const cActive = document.getElementById('cr-c-active');
      const cClosed = document.getElementById('cr-c-closed');
      try {
        const qs = new URLSearchParams({ scope: tab === 'closed' ? 'closed' : 'active' });
        if (q) qs.set('q', q);
        if (tab === 'closed') qs.set('limit', '80');
        const data = await api('/courier/runs?' + qs.toString());
        if (cActive) cActive.textContent = String((data.counts && data.counts.active) || 0);
        if (cClosed) cClosed.textContent = String((data.counts && data.counts.closed) || 0);
        document.querySelectorAll('[data-cr-tab]').forEach((el) => {
          el.classList.toggle('is-on', el.getAttribute('data-cr-tab') === tab);
        });
        const items = data.items || [];
        if (!items.length) {
          box.innerHTML = `<p class="muted">${
            q
              ? 'Нет заданий по запросу'
              : tab === 'closed'
                ? 'Нет закрытых'
                : 'Нет активных заданий'
          }</p>`;
          return;
        }
        box.innerHTML = `<div class="table-scroll"><table class="data-table is-dense" data-no-col-filter="1">
          <thead><tr>
            <th>Заказ</th><th>Маршрут</th><th>Клиент</th><th>Оплата</th><th></th>
          </tr></thead>
          <tbody>
            ${items
              .map((r) => {
                const dealId = String(r.deal_id || '').trim();
                const route =
                  String(r.route_label || '').trim() ||
                  (String(r.amo_shipment || '').trim()
                    ? 'Курьер → ' + String(r.amo_shipment).trim()
                    : String(r.title || '—'));
                const print = String(r.print_href || '').trim();
                const handoff = r.kind === 'handoff' || r.is_handoff;
                const st = String(r.status || '');
                let act = '';
                if (print) {
                  act += `<a class="btn" href="${esc(print)}" target="_blank" rel="noopener">Расходная</a> `;
                }
                if (tab !== 'closed' && handoff && st !== 'delivered' && st !== 'cancelled') {
                  act += `<button type="button" class="primary" data-cr-deliv="${esc(r.id)}">Доставил</button>`;
                } else if (tab !== 'closed' && !handoff && st === 'new') {
                  act += `<button type="button" data-cr-st="${esc(r.id)}" data-st="accepted">Принял</button>`;
                } else if (tab !== 'closed' && !handoff && st === 'accepted') {
                  act += `<button type="button" data-cr-st="${esc(r.id)}" data-st="picked_up">Забрал</button>`;
                } else if (tab !== 'closed' && !handoff && st === 'picked_up') {
                  act += `<button type="button" class="primary" data-cr-st="${esc(r.id)}" data-st="delivered">Выполнил</button>`;
                }
                return `<tr>
                  <td class="mono"><b>${esc(dealId ? 'С' + dealId : r.title || '—')}</b></td>
                  <td>${esc(route)}</td>
                  <td>${esc(r.buyer_name || '—')}<div class="muted" style="font-size:12px">${esc(r.buyer_phone || '')}</div></td>
                  <td>${esc(r.payment_label || '—')}</td>
                  <td style="white-space:nowrap">${act}</td>
                </tr>`;
              })
              .join('')}
          </tbody>
        </table></div>`;

        box.querySelectorAll('[data-cr-deliv], [data-cr-st]').forEach((btn) => {
          btn.onclick = async () => {
            const id = btn.getAttribute('data-cr-deliv') || btn.getAttribute('data-cr-st');
            const st = btn.getAttribute('data-st') || 'delivered';
            try {
              btn.disabled = true;
              await api('/courier/runs/' + encodeURIComponent(id) + '/status', {
                method: 'POST',
                body: JSON.stringify({ status: st }),
              });
              await paint();
            } catch (e) {
              btn.disabled = false;
              if (msg) msg.textContent = e.message || String(e);
            }
          };
        });
        if (msg) msg.textContent = '';
      } catch (e) {
        if (msg) msg.textContent = e.message || String(e);
        box.innerHTML = '';
      }
    };

    view.innerHTML = chrome(
      'Курьер',
      `<div class="panel">
        <p class="muted" style="margin:0 0 8px;font-size:12px">
          Как у кладовщика: активные / закрытые / поиск. «Доставил» = списание по продаже со склада «Курьер» + примечание в сделку.
          Телефон: <a href="/courier.html" target="_blank" rel="noopener">/courier</a>.
        </p>
        <div class="form-toolbar" style="gap:8px;flex-wrap:wrap;align-items:center">
          <div class="form-pagetabs">
            <button type="button" class="form-pagetab is-on" data-cr-tab="active">Активные <b id="cr-c-active">0</b></button>
            <button type="button" class="form-pagetab" data-cr-tab="closed">Закрытые <b id="cr-c-closed">0</b></button>
          </div>
          <div class="find" style="margin-left:auto;display:flex;gap:6px">
            <input type="search" id="cr-q" placeholder="Сделка, СДЭК, клиент…" />
            <button type="button" id="cr-find">Найти</button>
            <button type="button" id="cr-reload">Обновить</button>
            <a class="btn" href="/api/courier/runs/print?autoprint=1" target="_blank" rel="noopener">Реестр</a>
          </div>
        </div>
        <span class="muted" id="cr-msg"></span>
        <div id="cr-list" style="margin-top:10px">Загрузка…</div>
      </div>`
    );
    if (leg.bindFormChrome) leg.bindFormChrome(() => leg.openTab && leg.openTab('warehouse'));

    view.querySelectorAll('[data-cr-tab]').forEach((btn) => {
      btn.onclick = () => {
        tab = btn.getAttribute('data-cr-tab') === 'closed' ? 'closed' : 'active';
        paint();
      };
    });
    const find = () => {
      q = String((document.getElementById('cr-q') || {}).value || '').trim();
      paint();
    };
    document.getElementById('cr-find').onclick = find;
    document.getElementById('cr-reload').onclick = () => paint();
    document.getElementById('cr-q').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') find();
    });
    await paint();
  }

  function install() {
    const legacy = L();
    if (!legacy || !legacy.routes) {
      console.warn('[sto-parts] WmsLegacy not ready');
      return;
    }
    const { VIEW_TITLES, TAB_PATHS, routes, TAB_SECTION_MAP, SECTIONS } = legacy;

    VIEW_TITLES['sto-parts'] = 'Заказы покупателей';
    TAB_PATHS['sto-parts'] = '/crm/deals';
    routes['sto-parts'] = redirectStoPartsGone;
    if (TAB_SECTION_MAP) TAB_SECTION_MAP['sto-parts'] = 'crm';

    VIEW_TITLES['courier-runs'] = 'Курьер';
    TAB_PATHS['courier-runs'] = '/courier';
    routes['courier-runs'] = renderCourierBoard;
    if (TAB_SECTION_MAP) TAB_SECTION_MAP['courier-runs'] = 'warehouse';

    const stripSto = (links) => {
      if (!Array.isArray(links)) return;
      for (let i = links.length - 1; i >= 0; i--) {
        if (links[i] && links[i].view === 'sto-parts') links.splice(i, 1);
      }
    };

    if (SECTIONS && SECTIONS.works && SECTIONS.works.cols && SECTIONS.works.cols[0]) {
      const stoCol = SECTIONS.works.cols[0].find((c) => c.title === 'СТО');
      if (stoCol) stripSto(stoCol.links);
    }
    if (SECTIONS && SECTIONS.warehouse && SECTIONS.warehouse.cols && SECTIONS.warehouse.cols[0]) {
      const wh = SECTIONS.warehouse.cols[0][0];
      if (wh) {
        stripSto(wh.links);
        if (Array.isArray(wh.links) && !wh.links.some((l) => l.view === 'courier-runs')) {
          wh.links.push({ view: 'courier-runs', label: 'Курьер' });
        }
      }
    }
  }

  window.WmsStoParts = { install, renderStoParts: redirectStoPartsGone, renderCourierBoard };
})();
