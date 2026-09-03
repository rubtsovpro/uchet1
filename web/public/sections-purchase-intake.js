/**
 * Закупки · прайсы: загрузка → маппинг колонок → дифф → корзины → письмо / ШК / номенклатура.
 */
(function () {
  const FIELD_LABELS = {
    skip: '— пропуск —',
    article: 'Артикул',
    name: 'Наименование',
    brand: 'Бренд',
    price: 'Цена',
    currency: 'Валюта',
    barcode: 'Штрихкод',
    oem: 'OEM',
    crosses: 'Кроссы',
    applicability: 'Применимость',
    qty: 'Кол-во',
    picture: 'Фото',
  };

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

  function canIntake() {
    const leg = L();
    const me = leg && leg.state && leg.state.me;
    if (!me) return false;
    if (me.purchase_intake === true) return true;
    if (me.isSystemAdmin || me.role === 'admin' || me.role === 'purchaser') return true;
    const dept = String(me.department || '').toLowerCase();
    return dept.includes('закуп');
  }

  function money(n) {
    const x = Math.round(Number(n) || 0);
    return x.toLocaleString('ru-RU', { maximumFractionDigits: 0 });
  }

  function statusLabel(s) {
    return (
      {
        new: 'Новый',
        price_changed: 'Цена изменилась',
        matched: 'Есть в учёте',
        pending: 'Ожидает',
      }[s] || s
    );
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

  async function renderPriceIntake() {
    const leg = L();
    const view = leg.view || document.getElementById('view');
    if (!canIntake()) {
      view.innerHTML =
        '<div class="card" style="padding:20px"><p class="error">Доступ только у админа и отдела закупки (роль «Закупщик» или отдел с «закуп» в названии).</p></div>';
      return;
    }

    const st = (leg.state.priceIntake = leg.state.priceIntake || {
      tab: 'baskets',
      importId: '',
      basketId: '',
      statusFilter: '',
      selected: {},
      rowQty: {},
    });
    if (!st.rowQty) st.rowQty = {};

    view.innerHTML = `
      <div class="card price-intake" style="padding:16px">
        <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:12px">
          <h2 style="margin:0;flex:1">Корзина закупки</h2>
          <button type="button" class="btn primary" data-pi-tab="baskets" ${st.tab === 'baskets' ? 'disabled' : ''}>Корзина и заметки</button>
          <button type="button" class="btn" data-pi-tab="imports" ${st.tab === 'imports' ? 'disabled' : ''}>Прайсы</button>
          <button type="button" class="btn" data-pi-tab="drive" ${st.tab === 'drive' ? 'disabled' : ''}>Google Drive</button>
        </div>
        <p class="muted" style="margin:0 0 12px">Рабочий стол: набивайте корзину из прайса или вручную, пишите заметки по заказу и по строкам.</p>
        <div id="pi-body"><p class="muted">Загрузка…</p></div>
      </div>`;

    view.querySelectorAll('[data-pi-tab]').forEach((btn) => {
      btn.addEventListener('click', () => {
        st.tab = btn.getAttribute('data-pi-tab');
        st.importId = '';
        if (st.tab !== 'baskets') st.basketId = '';
        renderPriceIntake();
      });
    });

    const body = document.getElementById('pi-body');
    try {
      if (st.tab === 'drive') {
        await renderDriveTab(body, st);
      } else if (st.tab === 'baskets') {
        if (st.basketId) await renderBasket(body, st);
        else await renderBasketsList(body, st);
      } else if (st.importId) {
        await renderImportWorkspace(body, st);
      } else {
        await renderImportsList(body, st);
      }
    } catch (e) {
      body.innerHTML = `<p class="error">${esc(e.message || e)}</p>`;
    }
  }

  async function renderDriveTab(body, st) {
    const status = await api('/purchase-drive/status');
    let folders = { items: [] };
    try {
      folders = await api('/purchase-drive/folders');
    } catch (_) {
      folders = { items: [] };
    }
    const err = status.last_poll_error || '';
    body.innerHTML = `
      <div class="toolbar" style="flex-wrap:wrap;gap:8px;margin-bottom:12px">
        <button type="button" class="primary" id="pd-sync">Считать папки с Drive</button>
        <button type="button" id="pd-poll">Опросить файлы сейчас</button>
      </div>
      <p class="muted" style="margin:0 0 10px;font-size:12px">
        Опрос каждые ${Math.round((status.poll_ms || 180000) / 60000)} мин · последний: ${esc(
          status.last_poll_at || '—'
        )}${err ? ` · <span class="error">${esc(err)}</span>` : ''}
      </p>
      <div class="table-scroll pd-folders-wrap">
        <table class="data-table" id="pd-folders">
          <thead><tr>
            <th>Поставщик</th>
            <th>Файлы</th>
            <th></th>
          </tr></thead>
          <tbody>
            ${(folders.items || [])
              .map(
                (f) => `<tr data-id="${esc(f.id)}">
              <td>
                <div class="pd-sup-code">${esc(f.supplier_name || '—')}</div>
                <div class="suggest-anchor pd-sup-pick" style="position:relative;min-width:200px;margin-top:6px">
                  <input class="pd-sup-name" value="${esc(f.supplier_name || '')}" placeholder="Сменить поставщика…" autocomplete="off" style="min-width:200px;width:100%" />
                  <input type="hidden" class="pd-sup-id" value="${esc(f.supplier_id || '')}" />
                  <div class="pd-sup-suggest suggest hidden" style="left:0;right:0;top:100%;z-index:50"></div>
                </div>
              </td>
              <td class="num">${esc(String(f.imported_count || 0))}/${esc(String(f.files_count || 0))}</td>
              <td><button type="button" class="pd-save">Сохранить</button></td>
            </tr>`
              )
              .join('') ||
              `<tr><td colspan="3" class="muted">Папок нет — нажмите «Считать папки»</td></tr>`}
          </tbody>
        </table>
      </div>`;

    const sync = document.getElementById('pd-sync');
    if (sync) {
      sync.onclick = async () => {
        sync.disabled = true;
        try {
          const r = await api('/purchase-drive/sync-folders', { method: 'POST', body: '{}' });
          alert(r.error || `Папок: ${r.folders}, с поставщиком: ${r.linked}`);
          st.tab = 'drive';
          await renderPriceIntake();
        } catch (e) {
          alert(e.message || e);
          sync.disabled = false;
        }
      };
    }
    const poll = document.getElementById('pd-poll');
    if (poll) {
      poll.onclick = async () => {
        poll.disabled = true;
        try {
          const r = await api('/purchase-drive/poll', { method: 'POST', body: '{}' });
          alert(
            r.error ||
              `Импортировано: ${r.imported || 0}, просмотрено файлов: ${r.seen || 0}` +
                (r.errors && r.errors.length ? `\nОшибки: ${r.errors.slice(0, 3).join('; ')}` : '')
          );
          st.tab = 'drive';
          await renderPriceIntake();
        } catch (e) {
          alert(e.message || e);
          poll.disabled = false;
        }
      };
    }
    body.querySelectorAll('#pd-folders tbody tr[data-id]').forEach((tr) => {
      const pick = tr.querySelector('.pd-sup-pick');
      if (pick) {
        bindSupplierField(
          pick.querySelector('.pd-sup-name'),
          pick.querySelector('.pd-sup-id'),
          pick.querySelector('.pd-sup-suggest')
        );
      }
      const save = tr.querySelector('.pd-save');
      if (!save) return;
      save.onclick = async () => {
        const supplier_name = (tr.querySelector('.pd-sup-name')?.value || '').trim();
        let supplier_id = tr.querySelector('.pd-sup-id')?.value || '';
        if (supplier_name && !supplier_id) {
          const found = await searchSuppliers(supplier_name);
          const hit =
            found.find((x) => String(x.value).toLowerCase() === supplier_name.toLowerCase()) ||
            found[0];
          if (hit) {
            supplier_id = hit.id;
            tr.querySelector('.pd-sup-id').value = hit.id;
            tr.querySelector('.pd-sup-name').value = hit.value;
          }
        }
        save.disabled = true;
        try {
          await api('/purchase-drive/folders/' + encodeURIComponent(tr.dataset.id), {
            method: 'PATCH',
            body: JSON.stringify({ supplier_id, supplier_name }),
          });
          save.textContent = 'OK';
          setTimeout(() => {
            save.textContent = 'Сохранить';
            save.disabled = false;
          }, 800);
        } catch (e) {
          alert(e.message || e);
          save.disabled = false;
        }
      };
    });
  }

  async function searchSuppliers(q) {
    const qs = new URLSearchParams({
      kind: 'supplier',
      sort: 'main',
      dir: 'desc',
      limit: '30',
      page: '1',
    });
    if (q) qs.set('q', q);
    const data = await api('/counterparties?' + qs);
    return (data.items || []).map((c) => ({
      id: c.id,
      value: c.name,
      hint: (Number(c.is_main) ? '★ ' : '') + (c.inn ? 'ИНН ' + c.inn : ''),
      is_main: Number(c.is_main) || 0,
      inn: c.inn || '',
    }));
  }

  /** Поиск/выбор поставщика; список в fixed-слое (иначе table overflow его режет). */
  function bindSupplierField(input, hidden, suggestEl) {
    if (!input || !suggestEl) return;
    let listCache = [];
    let timer = 0;
    let seq = 0;

    const hide = () => {
      suggestEl.classList.add('hidden');
      suggestEl.innerHTML = '';
    };

    const place = () => {
      const r = input.getBoundingClientRect();
      if (suggestEl.parentElement !== document.body) {
        document.body.appendChild(suggestEl);
      }
      suggestEl.style.position = 'fixed';
      suggestEl.style.left = `${Math.round(r.left)}px`;
      suggestEl.style.top = `${Math.round(r.bottom + 2)}px`;
      suggestEl.style.width = `${Math.max(Math.round(r.width), 280)}px`;
      suggestEl.style.right = 'auto';
      suggestEl.style.zIndex = '5000';
      suggestEl.style.maxHeight = '260px';
    };

    const renderList = (list) => {
      listCache = list || [];
      place();
      if (!listCache.length) {
        suggestEl.innerHTML = '<div class="suggest-empty muted">Нет поставщиков — начните ввод</div>';
        suggestEl.classList.remove('hidden');
        return;
      }
      suggestEl.classList.remove('hidden');
      suggestEl.innerHTML = listCache
        .map(
          (it, i) =>
            `<button type="button" class="suggest-item" data-i="${i}">${
              it.is_main ? '<span title="Основной">★</span> ' : ''
            }${esc(it.value)}${
              it.inn ? ` <span class="muted">${esc(it.inn)}</span>` : ''
            }</button>`
        )
        .join('');
      suggestEl.querySelectorAll('[data-i]').forEach((btn) => {
        btn.onmousedown = (e) => e.preventDefault();
        btn.onclick = () => {
          const it = listCache[Number(btn.dataset.i)];
          if (!it) return;
          input.value = it.value;
          if (hidden) hidden.value = it.id || '';
          hide();
          input.dispatchEvent(new Event('change', { bubbles: true }));
        };
      });
    };

    const run = async (q) => {
      const my = ++seq;
      try {
        const list = await searchSuppliers(q);
        if (my !== seq) return;
        const starred = list.filter((x) => x.is_main);
        const rest = list.filter((x) => !x.is_main);
        renderList([...starred, ...rest].slice(0, 30));
      } catch (_) {
        if (my === seq) hide();
      }
    };

    input.addEventListener('focus', () => {
      run(String(input.value || '').trim());
    });
    input.addEventListener('input', () => {
      if (hidden) hidden.value = '';
      window.clearTimeout(timer);
      timer = window.setTimeout(() => run(String(input.value || '').trim()), 220);
    });
    input.addEventListener('blur', () => {
      window.setTimeout(hide, 160);
    });
    window.addEventListener(
      'scroll',
      () => {
        if (!suggestEl.classList.contains('hidden')) place();
      },
      true
    );
    window.addEventListener('resize', () => {
      if (!suggestEl.classList.contains('hidden')) place();
    });
  }

  function bindSupplierPicker(wrap) {
    bindSupplierField(
      wrap.querySelector('#pi-supplier'),
      wrap.querySelector('#pi-supplier-id'),
      wrap.querySelector('#pi-supplier-suggest')
    );
  }

  async function renderImportsList(body, st) {
    const data = await api('/purchase-intake/imports');
    const items = data.items || [];
    body.innerHTML = `
      <div style="display:flex;gap:12px;flex-wrap:wrap;align-items:flex-end;margin-bottom:16px">
        <label>Файл прайса (Excel / CSV)
          <input type="file" id="pi-file" accept=".xlsx,.xls,.csv,.txt,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"/>
        </label>
        <label style="position:relative;min-width:260px">Поставщик
          <span class="suggest-anchor" style="display:block;position:relative">
            <input type="text" id="pi-supplier" placeholder="Поиск… ★ основные сверху" autocomplete="off" style="min-width:260px;width:100%"/>
            <input type="hidden" id="pi-supplier-id" value=""/>
            <div id="pi-supplier-suggest" class="suggest hidden" style="left:0;right:0;top:100%;z-index:40"></div>
          </span>
        </label>
        <button type="button" class="btn primary" id="pi-upload">Загрузить</button>
        <button type="button" class="btn" id="pi-goto-baskets">К корзинам →</button>
      </div>
      <table class="table"><thead><tr>
        <th>Дата</th><th>Файл</th><th>Поставщик</th><th>Статус</th><th>Строк</th><th>Новые</th><th>Цены</th><th></th>
      </tr></thead><tbody>
      ${
        items.length
          ? items
              .map(
                (r) => `<tr>
          <td>${esc(String(r.created_at || '').replace('T', ' ').slice(0, 16))}</td>
          <td>${esc(r.filename)}</td>
          <td>${esc(r.supplier_name || '—')}</td>
          <td>${esc(r.status)}</td>
          <td>${r.row_count || 0}</td>
          <td>${r.new_count || 0}</td>
          <td>${r.changed_count || 0}</td>
          <td><button type="button" class="btn sm" data-open="${esc(r.id)}">Открыть</button></td>
        </tr>`
              )
              .join('')
          : '<tr><td colspan="8" class="muted">Пока нет импортов — загрузите прайс с диска (Google Диск: скачайте файл и загрузите сюда).</td></tr>'
      }
      </tbody></table>`;

    body.querySelector('#pi-goto-baskets')?.addEventListener('click', () => {
      st.tab = 'baskets';
      st.basketId = '';
      renderPriceIntake();
    });
    body.querySelectorAll('[data-open]').forEach((btn) => {
      btn.addEventListener('click', () => {
        st.importId = btn.getAttribute('data-open');
        st.selected = {};
        renderPriceIntake();
      });
    });
    bindSupplierPicker(body);

    body.querySelector('#pi-upload')?.addEventListener('click', async () => {
      const input = body.querySelector('#pi-file');
      const file = input && input.files && input.files[0];
      if (!file) {
        alert('Выберите файл');
        return;
      }
      const fd = new FormData();
      fd.append('file', file);
      const supplier = (body.querySelector('#pi-supplier')?.value || '').trim();
      const supplierId = (body.querySelector('#pi-supplier-id')?.value || '').trim();
      const qs = new URLSearchParams();
      if (supplier) qs.set('supplier_name', supplier);
      if (supplierId) qs.set('supplier_id', supplierId);
      const q = qs.toString() ? '?' + qs.toString() : '';
      try {
        const res = await api('/purchase-intake/imports' + q, { method: 'POST', body: fd });
        st.importId = res.import.id;
        st._preview = res;
        renderPriceIntake();
      } catch (e) {
        alert(e.message || e);
      }
    });
  }

  async function renderImportWorkspace(body, st) {
    const imp = await api('/purchase-intake/imports/' + st.importId);
    let preview = st._preview;
    if (!(st._useSuggested && preview?.suggested_map && preview?.headers)) {
      preview = await api('/purchase-intake/imports/' + st.importId + '/preview');
      st._preview = preview;
    }

    const headers = preview.headers || [];
    const saved = imp.column_map || {};
    const suggested = preview.suggested_map || {};
    const savedUseful = Object.values(saved).some((v) => v && v !== 'skip');
    const map = st._useSuggested
      ? { ...suggested }
      : savedUseful
        ? saved
        : { ...suggested };
    st._useSuggested = false;
    const fieldOpts = Object.keys(FIELD_LABELS)
      .map(
        (k) =>
          `<option value="${k}">${esc(FIELD_LABELS[k])}</option>`
      )
      .join('');

    const mapRows = headers
      .map((h, i) => {
        const cur = map[String(i)] || map[i] || 'skip';
        return `<tr>
          <td>Кол. ${i + 1}</td>
          <td><code>${esc(h || '—')}</code></td>
          <td><select data-col="${i}">${fieldOpts.replace(
          `value="${cur}"`,
          `value="${cur}" selected`
        )}</select></td>
        </tr>`;
      })
      .join('');

    // fix selected options properly
    const mapRowsFixed = headers
      .map((h, i) => {
        const cur = map[String(i)] || map[i] || 'skip';
        const opts = Object.keys(FIELD_LABELS)
          .map(
            (k) =>
              `<option value="${k}"${k === cur ? ' selected' : ''}>${esc(FIELD_LABELS[k])}</option>`
          )
          .join('');
        return `<tr><td>${i + 1}</td><td>${esc(h || '—')}</td><td><select data-col="${i}">${opts}</select></td></tr>`;
      })
      .join('');

    body.innerHTML = `
      <p><button type="button" class="btn" id="pi-back">← К списку</button>
         <button type="button" class="btn" id="pi-del">Удалить импорт</button></p>
      <h3 style="margin:8px 0">${esc(imp.filename)} <span class="muted">${esc(imp.supplier_name || '')}</span></h3>
      <p class="muted">Строк: ${imp.row_count || 0} · новых ${imp.new_count || 0} · цена изменилась ${imp.changed_count || 0} · совпало ${imp.matched_count || 0}</p>

      <details open style="margin:12px 0">
        <summary><b>1. Назначить колонки</b>${
          savedUseful ? '' : ' <span class="muted">(подобрано автоматически — проверьте)</span>'
        }</summary>
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin:8px 0;align-items:end">
          <label>Строка заголовка
            <input type="number" id="pi-header" min="1" value="${esc(preview.header_row_1based || imp.header_row || 1)}" style="width:80px"/>
          </label>
          <label>Лист
            <select id="pi-sheet">${(preview.sheets || [imp.sheet_name || 'Sheet1'])
              .map(
                (s) =>
                  `<option value="${esc(s)}"${s === (preview.sheet || imp.sheet_name) ? ' selected' : ''}>${esc(s)}</option>`
              )
              .join('')}</select>
          </label>
          <button type="button" class="btn" id="pi-guess">Угадать колонки</button>
          <button type="button" class="btn primary" id="pi-parse">Разобрать и сверить</button>
        </div>
        <table class="table"><thead><tr><th>#</th><th>Заголовок в файле</th><th>Это поле</th></tr></thead>
        <tbody>${mapRowsFixed || '<tr><td colspan="3">Нет колонок</td></tr>'}</tbody></table>
        <p class="muted" style="margin-top:8px">Колонка «Фото» / Picture: в ячейках обычно пусто — картинки встроены в Excel и подтягиваются при разборе.</p>
      </details>

      <details open style="margin:12px 0">
        <summary><b>2. Результат сверки — все поля прайса</b></summary>
        <p class="muted" style="margin:8px 0">Отметьте строки, задайте <b>кол-во</b> (из файла или своё) → «В корзину». Горизонтальный скролл — все столбцы.</p>
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin:8px 0;align-items:end">
          <label>Фильтр
            <select id="pi-status">
              <option value="">Все</option>
              <option value="new">Новые</option>
              <option value="price_changed">Цена изменилась</option>
              <option value="matched">Уже есть</option>
            </select>
          </label>
          <label>Поиск <input type="search" id="pi-q" placeholder="артикул / OEM / имя"/></label>
          <button type="button" class="btn" id="pi-reload-rows">Обновить</button>
          <button type="button" class="btn primary" id="pi-to-basket">В корзину выбранные${
            st.basketId ? ' (текущая)' : ''
          }</button>
          <button type="button" class="btn" id="pi-open-basket"${st.basketId ? '' : ' disabled'}>Открыть корзину</button>
          <button type="button" class="btn" id="pi-new-basket">+ Новая корзина</button>
        </div>
        <div id="pi-rows"><p class="muted">…</p></div>
      </details>`;

    // remove unused mapRows lint noise
    void mapRows;

    body.querySelector('#pi-back')?.addEventListener('click', () => {
      st.importId = '';
      st._preview = null;
      renderPriceIntake();
    });
    body.querySelector('#pi-del')?.addEventListener('click', async () => {
      if (!confirm('Удалить импорт?')) return;
      await api('/purchase-intake/imports/' + st.importId, { method: 'DELETE' });
      st.importId = '';
      renderPriceIntake();
    });
    body.querySelector('#pi-guess')?.addEventListener('click', async () => {
      const header = Number(body.querySelector('#pi-header')?.value || 1);
      const sheet = body.querySelector('#pi-sheet')?.value || '';
      const qs = new URLSearchParams({ header_row: String(header) });
      if (sheet) qs.set('sheet', sheet);
      try {
        st._preview = await api(
          '/purchase-intake/imports/' + st.importId + '/preview?' + qs.toString()
        );
        st._useSuggested = true;
        renderPriceIntake();
      } catch (e) {
        alert(e.message || e);
      }
    });
    body.querySelector('#pi-sheet')?.addEventListener('change', async () => {
      const sheet = body.querySelector('#pi-sheet')?.value || '';
      try {
        st._preview = await api(
          '/purchase-intake/imports/' +
            st.importId +
            '/preview?sheet=' +
            encodeURIComponent(sheet)
        );
        st._useSuggested = true;
        renderPriceIntake();
      } catch (e) {
        alert(e.message || e);
      }
    });
    body.querySelector('#pi-parse')?.addEventListener('click', async () => {
      const column_map = {};
      body.querySelectorAll('select[data-col]').forEach((sel) => {
        column_map[sel.getAttribute('data-col')] = sel.value;
      });
      try {
        await api('/purchase-intake/imports/' + st.importId + '/map', {
          method: 'PUT',
          body: JSON.stringify({
            column_map,
            header_row: Number(body.querySelector('#pi-header')?.value || 1),
            sheet: body.querySelector('#pi-sheet')?.value || '',
            supplier_name: imp.supplier_name || '',
          }),
        });
        st._preview = null;
        renderPriceIntake();
      } catch (e) {
        alert(e.message || e);
      }
    });

    async function loadRows() {
      const status = body.querySelector('#pi-status')?.value || '';
      const q = body.querySelector('#pi-q')?.value || '';
      const qs = new URLSearchParams({ limit: '200' });
      if (status) qs.set('status', status);
      if (q) qs.set('q', q);
      const data = await api('/purchase-intake/imports/' + st.importId + '/rows?' + qs);
      const box = body.querySelector('#pi-rows');
      const items = data.items || [];
      box.innerHTML = `
        <p class="muted">Показано ${items.length} из ${data.total}</p>
        <div class="table-scroll" style="overflow:auto;max-width:100%">
        <table class="table pi-price-rows" style="min-width:1100px"><thead><tr>
          <th><input type="checkbox" id="pi-check-all" title="Выбрать все"/></th>
          <th>Фото</th>
          <th>Статус</th>
          <th>Артикул</th>
          <th>Наименование</th>
          <th>Бренд</th>
          <th>OEM</th>
          <th>Кроссы</th>
          <th>Применимость</th>
          <th>ШК</th>
          <th title="Сколько класть в корзину">Кол-во</th>
          <th>Цена</th>
          <th>Было</th>
          <th>Δ</th>
          <th>SKU учёта</th>
        </tr></thead><tbody>
        ${items
          .map((r) => {
            const rid = String(r.id);
            const checked = st.selected[rid] ? ' checked' : '';
            const fileQty = Number(r.qty) > 0 ? Number(r.qty) : 1;
            if (st.rowQty[rid] == null || st.rowQty[rid] === '') st.rowQty[rid] = fileQty;
            const qtyVal = Number(st.rowQty[rid]) > 0 ? Number(st.rowQty[rid]) : fileQty;
            const delta =
              r.price_delta == null
                ? '—'
                : (Number(r.price_delta) >= 0 ? '+' : '') + money(r.price_delta);
            const pic = r.picture_url
              ? `<img src="${esc(r.picture_url)}" alt="" class="pi-thumb" loading="lazy"/>`
              : '<span class="muted">—</span>';
            const apps = String(r.applicability || '').trim();
            const crosses = String(r.crosses || '').trim();
            return `<tr>
              <td><input type="checkbox" data-row="${esc(rid)}"${checked}/></td>
              <td class="pi-pic">${pic}</td>
              <td>${esc(statusLabel(r.match_status))}</td>
              <td class="mono">${esc(r.article || '')}</td>
              <td>${esc(r.name || '')}</td>
              <td>${esc(r.brand || '')}</td>
              <td class="mono">${esc(r.oem || '')}</td>
              <td class="muted" style="max-width:140px;font-size:12px" title="${esc(crosses)}">${esc(
                crosses ? crosses.slice(0, 60) + (crosses.length > 60 ? '…' : '') : '—'
              )}</td>
              <td class="muted" style="max-width:160px;font-size:12px" title="${esc(apps)}">${esc(
                apps ? apps.slice(0, 80) + (apps.length > 80 ? '…' : '') : '—'
              )}</td>
              <td class="mono">${esc(r.barcode || '—')}</td>
              <td><input type="number" min="1" step="1" value="${esc(qtyVal)}" data-row-qty="${esc(
                rid
              )}" style="width:72px" title="Кол-во в корзину"/></td>
              <td>${money(r.price)}</td>
              <td>${r.old_price == null ? '—' : money(r.old_price)}</td>
              <td>${delta}</td>
              <td class="mono">${esc(r.match_sku || '—')}</td>
            </tr>`;
          })
          .join('')}
        </tbody></table>
        </div>`;
      box.querySelector('#pi-check-all')?.addEventListener('change', (e) => {
        const on = e.target.checked;
        box.querySelectorAll('[data-row]').forEach((cb) => {
          cb.checked = on;
          st.selected[cb.getAttribute('data-row')] = on;
        });
      });
      box.querySelectorAll('[data-row]').forEach((cb) => {
        cb.addEventListener('change', () => {
          st.selected[cb.getAttribute('data-row')] = cb.checked;
        });
      });
      box.querySelectorAll('[data-row-qty]').forEach((inp) => {
        const sync = () => {
          const id = inp.getAttribute('data-row-qty');
          const n = Number(inp.value);
          st.rowQty[id] = n > 0 ? n : 1;
          // удобно: если крутят qty — сразу отметить строку
          const cb = box.querySelector(`[data-row="${CSS.escape(id)}"]`);
          if (cb && n > 0) {
            cb.checked = true;
            st.selected[id] = true;
          }
        };
        inp.addEventListener('change', sync);
        inp.addEventListener('input', sync);
      });
    }

    body.querySelector('#pi-reload-rows')?.addEventListener('click', () => loadRows().catch(alert));
    body.querySelector('#pi-status')?.addEventListener('change', () => loadRows().catch(alert));
    if (imp.status === 'parsed') await loadRows();
    else body.querySelector('#pi-rows').innerHTML = '<p class="muted">Сначала назначьте колонки и нажмите «Разобрать».</p>';

    body.querySelector('#pi-new-basket')?.addEventListener('click', async () => {
      const name = prompt('Название корзины', `Корзина ${new Date().toLocaleDateString('ru-RU')}`);
      if (name == null) return;
      const b = await api('/purchase-intake/baskets', {
        method: 'POST',
        body: JSON.stringify({ name, supplier_name: imp.supplier_name || '' }),
      });
      st.basketId = b.id;
      st.tab = 'baskets';
      renderPriceIntake();
    });
    body.querySelector('#pi-open-basket')?.addEventListener('click', () => {
      if (!st.basketId) return;
      st.tab = 'baskets';
      renderPriceIntake();
    });

    body.querySelector('#pi-to-basket')?.addEventListener('click', async () => {
      const ids = Object.keys(st.selected).filter((k) => st.selected[k]);
      if (!ids.length) {
        alert('Отметьте строки');
        return;
      }
      let basketId = st.basketId;
      if (!basketId) {
        const list = await api('/purchase-intake/baskets');
        const open = (list.items || []).find((b) => b.status === 'open');
        if (open) basketId = open.id;
        else {
          const b = await api('/purchase-intake/baskets', {
            method: 'POST',
            body: JSON.stringify({
              name: `Корзина ${new Date().toLocaleDateString('ru-RU')}`,
              supplier_name: imp.supplier_name || '',
            }),
          });
          basketId = b.id;
        }
      }
      await api('/purchase-intake/baskets/' + basketId + '/lines', {
        method: 'POST',
        body: JSON.stringify({
          row_ids: ids,
          qtys: Object.fromEntries(
            ids.map((rid) => {
              const n = Number(st.rowQty[rid]);
              return [rid, n > 0 ? n : 1];
            })
          ),
        }),
      });
      st.basketId = basketId;
      st.tab = 'baskets';
      st.selected = {};
      st.rowQty = {};
      renderPriceIntake();
    });
  }

  async function renderBasketsList(body, st) {
    const data = await api('/purchase-intake/baskets');
    const items = data.items || [];
    body.innerHTML = `
      <div class="pi-desk-head">
        <div>
          <h3 style="margin:0 0 4px">Мои корзины</h3>
          <p class="muted" style="margin:0">Откройте корзину или создайте новую — дальше набиваете позиции и пишете заметки.</p>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button type="button" class="btn primary" id="pi-create-b">+ Новая корзина</button>
          <button type="button" class="btn" id="pi-to-imp">Взять из прайса →</button>
        </div>
      </div>
      <table class="table"><thead><tr>
        <th>Название</th><th>Поставщик</th><th>Статус</th><th>Позиций</th><th>Сумма</th><th>Заметка</th><th></th>
      </tr></thead><tbody>
      ${
        items.length
          ? items
              .map(
                (b) => `<tr>
          <td><b>${esc(b.name)}</b></td>
          <td>${esc(b.supplier_name || '—')}</td>
          <td>${esc(b.status)}</td>
          <td>${b.lines_count || 0}</td>
          <td>${money(b.sum)}</td>
          <td class="muted" style="max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(
            (b.notes || '').split('\n')[0] || '—'
          )}</td>
          <td><button type="button" class="btn sm primary" data-b="${esc(b.id)}">Открыть</button></td>
        </tr>`
              )
              .join('')
          : '<tr><td colspan="7" class="muted">Корзин пока нет — создайте первую</td></tr>'
      }
      </tbody></table>`;
    body.querySelector('#pi-to-imp')?.addEventListener('click', () => {
      st.tab = 'imports';
      st.basketId = '';
      renderPriceIntake();
    });
    body.querySelector('#pi-create-b')?.addEventListener('click', async () => {
      const name = prompt('Название', `Корзина ${new Date().toLocaleDateString('ru-RU')}`);
      if (name == null) return;
      const b = await api('/purchase-intake/baskets', {
        method: 'POST',
        body: JSON.stringify({ name }),
      });
      st.basketId = b.id;
      st.tab = 'baskets';
      renderPriceIntake();
    });
    body.querySelectorAll('[data-b]').forEach((btn) => {
      btn.addEventListener('click', () => {
        st.basketId = btn.getAttribute('data-b');
        st.tab = 'baskets';
        renderPriceIntake();
      });
    });
  }

  async function renderBasket(body, st) {
    const b = await api('/purchase-intake/baskets/' + st.basketId);
    const lines = b.lines || [];
    body.innerHTML = `
      <div class="pi-desk">
        <div class="pi-desk-main">
          <p style="margin:0 0 8px;display:flex;gap:8px;flex-wrap:wrap;align-items:center">
            <button type="button" class="btn" id="pi-b-back">← Все корзины</button>
            <button type="button" class="btn" id="pi-b-from-price">+ Из прайса</button>
            <button type="button" class="btn" id="pi-b-del">Удалить</button>
          </p>
          <h3 style="margin:0 0 4px">${esc(b.name)} <span class="muted">${esc(b.supplier_name || '')}</span></h3>
          <p class="muted" style="margin:0 0 12px">${lines.length} поз. · сумма <b>${money(b.sum)}</b></p>

          <div class="pi-add-line">
            <b>Добавить позицию вручную</b>
            <div class="pi-add-grid">
              <label>Артикул <input id="pi-add-art" placeholder="артикул"/></label>
              <label>Наименование <input id="pi-add-name" placeholder="обязательно"/></label>
              <label>OEM <input id="pi-add-oem" placeholder="OEM"/></label>
              <label>Кол-во <input id="pi-add-qty" type="number" min="1" step="1" value="1"/></label>
              <label>Цена <input id="pi-add-price" type="number" min="0" step="1" value="0"/></label>
              <label>Заметка к строке <input id="pi-add-note" placeholder="опционально"/></label>
            </div>
            <button type="button" class="btn primary" id="pi-add-line">Добавить в корзину</button>
          </div>

          <table class="table pi-lines"><thead><tr>
            <th>#</th><th>Артикул</th><th>Наименование</th><th>OEM</th><th>ШК</th>
            <th>Кол-во</th><th>Цена</th><th>Заметка</th><th>Товар</th><th></th>
          </tr></thead><tbody>
          ${
            lines.length
              ? lines
                  .map(
                    (L, i) => `<tr data-lid="${esc(L.id)}">
              <td>${i + 1}</td>
              <td>${esc(L.article)}</td>
              <td>${esc(L.name)}<div class="muted" style="font-size:12px">${esc(L.applicability || '')}</div></td>
              <td>${esc(L.oem || L.crosses || '')}</td>
              <td><code>${esc(L.barcode || '—')}</code></td>
              <td><input type="number" min="0" step="1" value="${esc(L.qty)}" data-qty="${esc(L.id)}" style="width:70px"/></td>
              <td><input type="number" min="0" step="1" value="${esc(L.price)}" data-price="${esc(L.id)}" style="width:90px"/></td>
              <td><input type="text" value="${esc(L.notes || '')}" data-note="${esc(L.id)}" placeholder="заметка…" style="min-width:140px;width:100%"/></td>
              <td>${L.product_id ? '✓' : '—'}</td>
              <td><button type="button" class="btn sm" data-rm="${esc(L.id)}">×</button></td>
            </tr>`
                  )
                  .join('')
              : '<tr><td colspan="10" class="muted">Пусто — добавьте из прайса или вручную выше</td></tr>'
          }
          </tbody></table>
        </div>

        <aside class="pi-desk-side">
          <h4 style="margin:0 0 8px">Заметки по корзине</h4>
          <textarea id="pi-b-notes" class="pi-notes" placeholder="Условия поставки, что спросить у поставщика, сроки, нюансы…">${esc(
            b.notes || ''
          )}</textarea>
          <p class="muted" id="pi-notes-status" style="margin:6px 0 12px;font-size:12px">Сохраняется при уходе с поля</p>
          <div class="pi-side-actions">
            <button type="button" class="btn primary" id="pi-email">Письмо поставщику</button>
            <a class="btn" id="pi-print" href="/api/purchase-intake/baskets/${esc(b.id)}/order.html" target="_blank" rel="noreferrer">Документ / печать</a>
            <button type="button" class="btn" id="pi-bc">Свободные ШК DiSAI</button>
            <button type="button" class="btn primary" id="pi-create">В номенклатуру (+ШК)</button>
          </div>
          <div id="pi-mail" style="display:none;margin-top:12px"></div>
        </aside>
      </div>`;

    body.querySelector('#pi-b-back')?.addEventListener('click', () => {
      st.basketId = '';
      st.tab = 'baskets';
      renderPriceIntake();
    });
    body.querySelector('#pi-b-from-price')?.addEventListener('click', () => {
      st.tab = 'imports';
      // keep basketId so «В корзину» кладёт сюда
      renderPriceIntake();
    });
    body.querySelector('#pi-b-del')?.addEventListener('click', async () => {
      if (!confirm('Удалить корзину?')) return;
      await api('/purchase-intake/baskets/' + st.basketId, { method: 'DELETE' });
      st.basketId = '';
      renderPriceIntake();
    });

    const notesEl = body.querySelector('#pi-b-notes');
    const notesStatus = body.querySelector('#pi-notes-status');
    async function saveBasketNotes() {
      try {
        await api('/purchase-intake/baskets/' + st.basketId, {
          method: 'PATCH',
          body: JSON.stringify({ notes: notesEl.value }),
        });
        if (notesStatus) notesStatus.textContent = 'Сохранено · ' + new Date().toLocaleTimeString('ru-RU');
      } catch (e) {
        if (notesStatus) notesStatus.textContent = e.message || 'Ошибка сохранения';
      }
    }
    notesEl?.addEventListener('blur', () => saveBasketNotes());
    let notesTimer = null;
    notesEl?.addEventListener('input', () => {
      if (notesStatus) notesStatus.textContent = 'Печатаете…';
      clearTimeout(notesTimer);
      notesTimer = setTimeout(() => saveBasketNotes(), 800);
    });

    body.querySelector('#pi-add-line')?.addEventListener('click', async () => {
      const name = (body.querySelector('#pi-add-name')?.value || '').trim();
      if (!name) {
        alert('Укажите наименование');
        return;
      }
      try {
        await api('/purchase-intake/baskets/' + st.basketId + '/lines', {
          method: 'POST',
          body: JSON.stringify({
            lines: [
              {
                article: (body.querySelector('#pi-add-art')?.value || '').trim(),
                name,
                oem: (body.querySelector('#pi-add-oem')?.value || '').trim(),
                qty: Number(body.querySelector('#pi-add-qty')?.value) || 1,
                price: Number(body.querySelector('#pi-add-price')?.value) || 0,
                notes: (body.querySelector('#pi-add-note')?.value || '').trim(),
              },
            ],
          }),
        });
        renderPriceIntake();
      } catch (e) {
        alert(e.message || e);
      }
    });

    body.querySelectorAll('[data-qty]').forEach((inp) => {
      inp.addEventListener('change', async () => {
        await api('/purchase-intake/baskets/' + st.basketId + '/lines/' + inp.getAttribute('data-qty'), {
          method: 'PATCH',
          body: JSON.stringify({ qty: Number(inp.value) || 0 }),
        });
      });
    });
    body.querySelectorAll('[data-price]').forEach((inp) => {
      inp.addEventListener('change', async () => {
        await api('/purchase-intake/baskets/' + st.basketId + '/lines/' + inp.getAttribute('data-price'), {
          method: 'PATCH',
          body: JSON.stringify({ price: Number(inp.value) || 0 }),
        });
      });
    });
    body.querySelectorAll('[data-note]').forEach((inp) => {
      let t = null;
      const save = async () => {
        await api('/purchase-intake/baskets/' + st.basketId + '/lines/' + inp.getAttribute('data-note'), {
          method: 'PATCH',
          body: JSON.stringify({ notes: inp.value }),
        });
      };
      inp.addEventListener('change', () => save().catch(alert));
      inp.addEventListener('input', () => {
        clearTimeout(t);
        t = setTimeout(() => save().catch(() => {}), 700);
      });
    });
    body.querySelectorAll('[data-rm]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        await api(
          '/purchase-intake/baskets/' + st.basketId + '/lines/' + btn.getAttribute('data-rm'),
          { method: 'DELETE' }
        );
        renderPriceIntake();
      });
    });
    body.querySelector('#pi-email')?.addEventListener('click', async () => {
      const draft = await api('/purchase-intake/baskets/' + st.basketId + '/email-draft', {
        method: 'POST',
        body: '{}',
      });
      const box = body.querySelector('#pi-mail');
      box.style.display = 'block';
      box.innerHTML = `
        <p><b>${esc(draft.subject)}</b>
          <a class="btn sm" href="${esc(draft.mailto)}">Открыть в почте</a>
          <button type="button" class="btn sm" id="pi-copy">Копировать</button>
        </p>
        <textarea style="width:100%;min-height:160px">${esc(draft.body_text)}</textarea>`;
      box.querySelector('#pi-copy')?.addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText(draft.body_text);
          alert('Скопировано');
        } catch {
          alert('Скопируйте вручную');
        }
      });
    });
    body.querySelector('#pi-bc')?.addEventListener('click', async () => {
      try {
        const res = await api('/purchase-intake/baskets/' + st.basketId + '/allocate-barcodes', {
          method: 'POST',
          body: '{}',
        });
        alert('Назначено ШК: ' + (res.allocated || 0));
        renderPriceIntake();
      } catch (e) {
        alert(e.message || e);
      }
    });
    body.querySelector('#pi-create')?.addEventListener('click', async () => {
      if (!confirm('Создать карточки номенклатуры для строк без товара? Назначить свободные DiSAI ШК при необходимости.'))
        return;
      try {
        const res = await api('/purchase-intake/baskets/' + st.basketId + '/create-products', {
          method: 'POST',
          body: JSON.stringify({ only_without_product: true, assign_barcodes: true }),
        });
        alert('Создано: ' + (res.created || []).length);
        renderPriceIntake();
      } catch (e) {
        alert(e.message || e);
      }
    });
  }

  function install() {
    const leg = L();
    if (!leg || !leg.routes) {
      console.warn('[purchase-intake] WmsLegacy not ready');
      return;
    }
    const id = 'purchase-price-intake';
    leg.VIEW_TITLES[id] = 'Корзина закупки';
    leg.TAB_PATHS[id] = '/purchases/price-intake';
    if (leg.TAB_SECTION_MAP) leg.TAB_SECTION_MAP[id] = 'purchases';
    leg.routes[id] = () => renderPriceIntake();

    const SECTIONS = leg.SECTIONS;
    if (SECTIONS && SECTIONS.purchases) {
      if (!SECTIONS.purchases.cols) SECTIONS.purchases.cols = [];
      let group = null;
      for (const col of SECTIONS.purchases.cols) {
        for (const g of col || []) {
          if (g && g.title === 'Закупки') group = g;
        }
      }
      if (!group) {
        group = { title: 'Закупки', links: [] };
        if (!SECTIONS.purchases.cols[0]) SECTIONS.purchases.cols[0] = [];
        SECTIONS.purchases.cols[0].push(group);
      }
      if (!group.links) group.links = [];
      const link = { view: id, label: 'Корзина и заметки' };
      const idx = group.links.findIndex((l) => l.view === id);
      if (idx >= 0) group.links[idx] = link;
      else group.links.splice(0, 0, link);
    }
    console.info('[purchase-intake] installed');
  }

  window.WmsPurchaseIntake = { install, renderPriceIntake };
})();
