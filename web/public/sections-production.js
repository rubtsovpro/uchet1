/**
 * Производство: сборка/разбор, склад PROD-WIP, задания кладовщику.
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

  async function renderProductionJobs() {
    const leg = L();
    const view = document.getElementById('view');
    if (!view || !leg) return;
    const status = leg.state?.productionStatus || '';
    let meta = { status_labels: {}, kind_labels: {} };
    let data = { items: [] };
    try {
      const qs = new URLSearchParams({ limit: '80' });
      if (status) qs.set('status', status);
      [meta, data] = await Promise.all([
        api('/production/jobs/meta'),
        api('/production/jobs?' + qs.toString()),
      ]);
    } catch (e) {
      view.innerHTML = leg.formChrome('Производство', `<p class="error">${esc(e.message)}</p>`);
      leg.bindFormChrome(() => leg.showSection('production'));
      return;
    }

    const statusOpts =
      '<option value="">Все</option>' +
      Object.entries(meta.status_labels || {})
        .map(
          ([k, v]) =>
            `<option value="${esc(k)}" ${k === status ? 'selected' : ''}>${esc(v)}</option>`
        )
        .join('');

    const rows = (data.items || [])
      .map((j) => {
        const deal = j.deal_id ? `<span class="mono">${esc(j.deal_id)}</span>` : '—';
        const actions = [];
        if (j.status === 'draft') {
          actions.push(
            `<button type="button" class="primary" data-act="send" data-id="${esc(j.id)}">На склад → производство</button>`
          );
        }
        if (j.status === 'at_production') {
          actions.push(
            `<button type="button" class="primary" data-act="done" data-id="${esc(j.id)}">Готово</button>`
          );
        }
        if (j.status === 'await_send' || j.status === 'await_receive') {
          actions.push(`<button type="button" data-act="wh">Задания склада</button>`);
        }
        return `<tr>
          <td class="mono">${esc(j.number)}</td>
          <td>${esc(j.kind_label || j.kind)}</td>
          <td>${esc(j.status_label || j.status)}</td>
          <td>${deal}</td>
          <td>${esc(j.summary || '')}</td>
          <td>${actions.join(' ') || '<span class="muted">—</span>'}</td>
        </tr>`;
      })
      .join('');

    view.innerHTML = leg.formChrome(
      'Производство',
      `
      <div class="panel">
        <p class="muted" style="margin:0 0 10px">
          Склад <b>PROD-WIP</b> — буфер. Кладовщик: «На производство» / «Приём с производства» в
          <a href="#" id="pj-wh-link">заданиях склада</a>. Производство жмёт «Готово» — склад оприходует.
        </p>
        <div class="toolbar">
          <select id="pj-status">${statusOpts}</select>
          <button type="button" id="pj-reload">Обновить</button>
          <span class="muted" id="pj-msg"></span>
        </div>
      </div>
      <table>
        <thead><tr><th>№</th><th>Тип</th><th>Статус</th><th>Сделка</th><th>Из чего → что</th><th></th></tr></thead>
        <tbody>${rows || '<tr><td colspan="6" class="muted">Нет заказов</td></tr>'}</tbody>
      </table>
    `
    );
    leg.bindFormChrome(() => leg.showSection('production'));

    const msg = (t) => {
      const el = document.getElementById('pj-msg');
      if (el) el.textContent = t || '';
    };

    document.getElementById('pj-status')?.addEventListener('change', (e) => {
      if (leg.state) leg.state.productionStatus = e.target.value;
      renderProductionJobs();
    });
    document.getElementById('pj-reload')?.addEventListener('click', () => renderProductionJobs());
    document.getElementById('pj-wh-link')?.addEventListener('click', (e) => {
      e.preventDefault();
      leg.openTab('wh-tasks');
    });
    view.querySelectorAll('[data-act]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const id = btn.getAttribute('data-id');
        const act = btn.getAttribute('data-act');
        try {
          if (act === 'send' && id) {
            await api('/production/jobs/' + encodeURIComponent(id) + '/send', { method: 'POST' });
            msg('Задание кладовщику создано');
          } else if (act === 'done' && id) {
            await api('/production/jobs/' + encodeURIComponent(id) + '/done', { method: 'POST' });
            msg('Склад получит задание на оприходование');
          } else if (act === 'wh') {
            leg.openTab('wh-tasks');
            return;
          }
          renderProductionJobs();
        } catch (e) {
          msg(e.message || 'ошибка');
        }
      });
    });
  }

  function install() {
    const leg = L();
    if (!leg || !leg.routes) return;
    leg.routes['production-jobs'] = renderProductionJobs;
    if (leg.TAB_PATHS) leg.TAB_PATHS['production-jobs'] = '/production';
  }

  window.WmsProduction = { install, renderProductionJobs };
})();
