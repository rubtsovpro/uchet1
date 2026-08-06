/**
 * Доставка · СДЭК — сделки и настройки внутри Учёт №1 (данные с виджета).
 * Подключается до legacy.js; регистрируется через WmsCdek.install().
 */
(function () {
  function L() {
    return window.WmsLegacy || {};
  }

  function fmtDt(v) {
    return String(v || '')
      .replace('T', ' ')
      .replace(/\+00:00$/, ' UTC')
      .slice(0, 19);
  }

  async function renderCdekDeals() {
    const { api, esc, formChrome, bindFormChrome, showSection, openTab } = L();
    const q = (L().state && L().state.cdekDealsQ) || '';
    let data;
    try {
      const qs = new URLSearchParams({ limit: '300' });
      if (q) qs.set('q', q);
      data = await api('/ops/cdek/deals?' + qs.toString());
    } catch (e) {
      L().view.innerHTML = formChrome('СДЭК · сделки', `<p class="error">${esc(e.message)}</p>`);
      bindFormChrome(() => showSection('warehouse'));
      return;
    }
    const items = data.items || [];
    L().view.innerHTML = formChrome(
      'СДЭК · сделки',
      `
      <p class="muted" style="margin:0 0 10px">
        Отправления из виджета СДЭК (${esc(String(data.count || items.length))} из ${esc(
          String(data.total || items.length)
        )}).
        Оформление новой накладной по сделке — из задания склада или карточки сделки Amo.
      </p>
      <div class="toolbar" style="margin-bottom:10px;gap:8px;flex-wrap:wrap">
        <input id="cdek-q" type="search" placeholder="Поиск: трек, сделка, город, ФИО…"
          value="${esc(q)}" style="min-width:220px;flex:1" />
        <button type="button" id="cdek-q-go">Найти</button>
        <button type="button" id="cdek-reload">Обновить</button>
        <button type="button" id="cdek-go-settings">Настройки СДЭК</button>
        <div class="grow"></div>
        <span class="muted" id="cdek-msg"></span>
      </div>
      <table>
        <thead>
          <tr>
            <th>Сделка</th>
            <th>Трек</th>
            <th>Статус</th>
            <th>Получатель</th>
            <th>Город</th>
            <th>Кабинет</th>
            <th>Тариф</th>
            <th>Обновлено</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          ${
            items.length
              ? items
                  .map((r) => {
                    const lid = r.lead_id;
                    const track = r.cdek_number || '—';
                    const barcode = r.cdek_barcode_url
                      ? `<a href="${esc(r.cdek_barcode_url)}" target="_blank" rel="noopener">ярлык</a>`
                      : '';
                    const dealLink = r.widget_url
                      ? `<a href="${esc(r.widget_url)}" target="_blank" rel="noopener">оформить</a>`
                      : '';
                    return `<tr>
                      <td class="mono">
                        <a href="#" data-deal="${esc(String(lid))}">${esc(String(lid))}</a>
                      </td>
                      <td class="mono">${esc(track)}${barcode ? ' · ' + barcode : ''}</td>
                      <td>${esc(r.cdek_status_name || (r.has_order ? '—' : 'черновик'))}</td>
                      <td>${esc(r.recipient_name || '—')}</td>
                      <td>${esc(r.delivery_city || '—')}</td>
                      <td>${esc(r.account_title || r.account_id || '—')}</td>
                      <td>${esc(r.shipment_method_title || r.tariff_code || '—')}</td>
                      <td class="mono muted">${esc(fmtDt(r.updated_at))}</td>
                      <td>${dealLink}</td>
                    </tr>`;
                  })
                  .join('')
              : '<tr><td colspan="9" class="muted">Сделок СДЭК пока нет в виджете.</td></tr>'
          }
        </tbody>
      </table>`
    );
    bindFormChrome(() => showSection('warehouse'));
    const applyQ = () => {
      if (!L().state) return;
      L().state.cdekDealsQ = (document.getElementById('cdek-q')?.value || '').trim();
      renderCdekDeals();
    };
    document.getElementById('cdek-q-go').onclick = applyQ;
    document.getElementById('cdek-reload').onclick = () => renderCdekDeals();
    document.getElementById('cdek-go-settings').onclick = () => openTab('cdek-settings');
    document.getElementById('cdek-q')?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        applyQ();
      }
    });
    L().view.querySelectorAll('[data-deal]').forEach((a) => {
      a.onclick = (e) => {
        e.preventDefault();
        openTab('deal:' + a.dataset.deal);
      };
    });
  }

  async function renderCdekSettings() {
    const { api, esc, formChrome, bindFormChrome, showSection, openTab } = L();
    let data;
    let bridge = {};
    let widgetError = '';
    try {
      const integ = await api('/settings/integrations/cdek');
      bridge = integ.bridge || {};
      if (integ.widget && integ.widget.ok !== false) {
        data = integ.widget;
      }
    } catch (_) {
      /* мост опционален */
    }
    if (!data) {
      try {
        data = await api('/ops/cdek/settings');
      } catch (e) {
        widgetError = e.message || 'Виджет недоступен';
        data = { accounts: [], shipment_methods: [], branch_enums: [], ok: false };
      }
    }
    const accounts = data.accounts || [];
    const methods = data.shipment_methods || [];
    const enums = data.branch_enums || [];

    const methodsHtml = methods
      .map(
        (m, i) => `
      <div class="form-grid" data-method-idx="${i}" style="margin-bottom:8px;padding:8px;border:1px solid var(--border,#e6e9ef);border-radius:6px">
        <label>Название<input data-m="title" value="${esc(m.title || '')}" /></label>
        <label>Код тарифа<input data-m="tariff_code" type="number" value="${esc(
          String(m.tariff_code || '')
        )}" /></label>
        <label>Режим
          <select data-m="delivery_mode">
            <option value="office" ${m.delivery_mode === 'office' ? 'selected' : ''}>ПВЗ / склад</option>
            <option value="door" ${m.delivery_mode === 'door' ? 'selected' : ''}>До двери</option>
          </select>
        </label>
        <input type="hidden" data-m="id" value="${esc(m.id || String(m.tariff_code || ''))}" />
      </div>`
      )
      .join('');

    const accountsHtml = accounts
      .map((a) => {
        const branchOpts =
          `<option value="">— не выбран —</option>` +
          enums
            .map(
              (b) =>
                `<option value="${esc(b)}" ${a.branch_value === b ? 'selected' : ''}>${esc(b)}</option>`
            )
            .join('');
        const status =
          a.api_status === 'ok'
            ? 'API ок'
            : a.api_status
              ? `API: ${a.api_status}`
              : 'API не проверен';
        return `
        <details class="deal-fold" data-account="${esc(a.id)}" style="margin:10px 0">
          <summary class="deal-fold-sum">
            ${esc(a.title || a.id)}
            <span class="muted" style="font-weight:500;font-size:12px"> · ${esc(status)}${
              a.api_status_message ? ' — ' + esc(a.api_status_message) : ''
            }</span>
          </summary>
          <div class="deal-fold-body">
          ${a.hint ? `<p class="muted" style="margin:0 0 8px">${esc(a.hint)}</p>` : ''}
          <div class="form-grid">
            <label>Client ID
              <input data-f="cdek_client_id" value="${esc(a.cdek_client_id || '')}" autocomplete="off" />
            </label>
            <label>Client Secret ${a.cdek_client_secret_set ? '<span class="muted">(задан)</span>' : ''}
              <input data-f="cdek_client_secret" type="password" value="" placeholder="${
                a.cdek_client_secret_set ? 'оставьте пустым, чтобы не менять' : 'секрет API'
              }" autocomplete="new-password" />
            </label>
            <label>Логин кабинета<input data-f="cdek_account" value="${esc(a.cdek_account || '')}" /></label>
            <label>Пароль кабинета ${a.cdek_password_set ? '<span class="muted">(задан)</span>' : ''}
              <input data-f="cdek_password" type="password" value="" placeholder="${
                a.cdek_password_set ? 'оставьте пустым, чтобы не менять' : ''
              }" autocomplete="new-password" />
            </label>
            <label>Филиал Amo
              <select data-f="branch_value">${branchOpts}</select>
            </label>
            <label>Код ПВЗ сдачи<input data-f="shipment_point" value="${esc(
              a.shipment_point || ''
            )}" placeholder="MSK340" /></label>
            <label>Город отправления<input data-f="from_city" value="${esc(a.from_city || '')}" /></label>
            <label>Код города СДЭК<input data-f="from_city_code" value="${esc(
              a.from_city_code || ''
            )}" /></label>
            <label style="grid-column:1/-1">Адрес отправителя
              <input data-f="from_address" value="${esc(a.from_address || '')}" />
            </label>
            <label>Индекс<input data-f="from_postal_code" value="${esc(a.from_postal_code || '')}" /></label>
            <label>Широта<input data-f="from_lat" value="${esc(a.from_lat || '')}" /></label>
            <label>Долгота<input data-f="from_lon" value="${esc(a.from_lon || '')}" /></label>
            <label>Телефон отправителя<input data-f="sender_phone" value="${esc(
              a.sender_phone || ''
            )}" /></label>
            <label>ФИО отправителя<input data-f="sender_name" value="${esc(a.sender_name || '')}" /></label>
            <label>Компания<input data-f="sender_company" value="${esc(a.sender_company || '')}" /></label>
          </div>
          <div class="toolbar" style="margin-top:10px;gap:8px;flex-wrap:wrap">
            <button type="button" class="cdek-check-api" data-account="${esc(a.id)}">Проверить API</button>
            <button type="button" class="cdek-refresh-pvz" data-account="${esc(a.id)}">Обновить кеш ПВЗ</button>
            <span class="muted" data-account-msg="${esc(a.id)}" style="font-size:12px">
              ${
                a.pvz_cache
                  ? `Кеш ПВЗ: ${esc(String(a.pvz_cache.points_count || 0))} точек` +
                    (a.pvz_cache.refreshed_at ? `, ${esc(fmtDt(a.pvz_cache.refreshed_at))}` : '')
                  : 'Кеш ПВЗ не загружен'
              }
            </span>
          </div>
          </div>
        </details>`;
      })
      .join('');

    const statusNotes = data.status_notes || [];
    const statusNotesHtml = statusNotes.length
      ? `<div class="cdek-status-notes" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:6px 12px">
          ${statusNotes
            .map((row) => {
              const actionType = row.action_type || 'ignore';
              const label =
                actionType === 'note'
                  ? 'примечание'
                  : actionType === 'task'
                    ? 'задача'
                    : 'не обрабатывается';
              if (actionType !== 'note') {
                return `<div class="muted" style="font-size:12px;padding:4px 0">
                  ${esc(row.name || row.code)} · ${esc(label)}
                  <code style="font-size:10px;margin-left:4px">${esc(row.code)}</code>
                </div>`;
              }
              return `<label class="staff-check" style="font-size:12px">
                <input type="checkbox" data-status-note="${esc(row.code)}" ${row.enabled ? 'checked' : ''} />
                ${esc(row.name || row.code)}
                <span class="muted">· ${esc(label)}</span>
              </label>`;
            })
            .join('')}
        </div>`
      : '<p class="muted">Реестр статусов пока пуст — появится после опросов СДЭК.</p>';

    let categoryDefaults = { default: { weight_kg: 1, length_cm: 20, width_cm: 15, height_cm: 10 }, rows: [] };
    try {
      const cat = await api('/ops/cdek/action', {
        method: 'POST',
        body: JSON.stringify({ action: 'load_category_defaults' }),
      });
      if (cat && cat.ok !== false) {
        categoryDefaults = {
          default: cat.default || categoryDefaults.default,
          rows: cat.rows || [],
        };
      }
    } catch (_) {
      /* опционально */
    }
    const catDefault = categoryDefaults.default || {};
    const categoryHtml = `
      <table class="staff-table" style="font-size:13px">
        <thead><tr><th>Категория</th><th>Вес, кг</th><th>Длина</th><th>Ширина</th><th>Высота</th></tr></thead>
        <tbody>
          <tr data-cat-row="_default">
            <td><b>По умолчанию</b></td>
            <td><input data-cat="weight_kg" type="number" min="0.1" step="0.1" value="${esc(String(catDefault.weight_kg ?? 1))}" style="width:80px" /></td>
            <td><input data-cat="length_cm" type="number" min="1" step="1" value="${esc(String(catDefault.length_cm ?? 20))}" style="width:70px" /></td>
            <td><input data-cat="width_cm" type="number" min="1" step="1" value="${esc(String(catDefault.width_cm ?? 15))}" style="width:70px" /></td>
            <td><input data-cat="height_cm" type="number" min="1" step="1" value="${esc(String(catDefault.height_cm ?? 10))}" style="width:70px" /></td>
          </tr>
          ${(categoryDefaults.rows || [])
            .map(
              (r) => `<tr data-cat-row="cat" data-cat-name="${esc(r.name || '')}">
                <td>${esc(r.name || '')}</td>
                <td><input data-cat="weight_kg" type="number" min="0.1" step="0.1" value="${esc(String(r.weight_kg ?? ''))}" style="width:80px" /></td>
                <td><input data-cat="length_cm" type="number" min="1" step="1" value="${esc(String(r.length_cm ?? ''))}" style="width:70px" /></td>
                <td><input data-cat="width_cm" type="number" min="1" step="1" value="${esc(String(r.width_cm ?? ''))}" style="width:70px" /></td>
                <td><input data-cat="height_cm" type="number" min="1" step="1" value="${esc(String(r.height_cm ?? ''))}" style="width:70px" /></td>
              </tr>`
            )
            .join('') || '<tr><td colspan="5" class="muted">Категории не найдены</td></tr>'}
        </tbody>
      </table>
      <div class="toolbar" style="margin-top:10px">
        <button type="button" id="cdek-save-cats">Сохранить габариты категорий</button>
        <span class="muted" id="cdek-cats-msg"></span>
      </div>`;

    const bridgeOk = bridge.configured
      ? '<span style="color:var(--taxi-green)">ключ задан</span>'
      : '<span class="muted">ключ не задан</span>';
    const enumsHint = enums.length
      ? `Значения филиалов (${enums.length}): ${enums.slice(0, 6).map((e) => esc(e)).join(' · ')}${
          enums.length > 6 ? '…' : ''
        }`
      : 'Значения филиалов ещё не загружались';
    L().view.innerHTML = formChrome(
      'СДЭК · настройки',
      `
      <p class="muted" style="margin:0 0 10px">
        Полные настройки СДЭК — здесь (раньше в
        <a href="https://widget.pnevmopodveska1.ru/cdek/" target="_blank" rel="noopener">виджете</a>).
        Данные пишутся в <code>settings.json</code> виджета. Пустой secret/пароль не затирает текущее значение.
        ${data.updated_at ? 'Обновлено: ' + esc(fmtDt(data.updated_at)) + '.' : ''}
      </p>
      ${widgetError ? `<p class="error">${esc(widgetError)}</p>` : ''}
      <div class="toolbar" style="margin-bottom:12px;gap:8px;flex-wrap:wrap">
        <button class="primary" type="button" id="cdek-save">Сохранить</button>
        <button type="button" id="cdek-go-deals">Сделки СДЭК</button>
        <span class="muted" id="cdek-save-msg"></span>
      </div>

      <details class="deal-fold" open>
        <summary class="deal-fold-sum">Мост Учёт №1 → виджет · ${bridgeOk}</summary>
        <div class="deal-fold-body">
          <div class="form-grid">
            <label class="span-2">X-Wms-Key ${bridge.wms_key_set ? `<span class="muted">(${esc(bridge.wms_key_hint || 'задан')})</span>` : ''}
              <input id="cdek-bridge-key" type="password" value="" placeholder="${
                bridge.wms_key_set ? 'оставьте пустым, чтобы не менять' : 'ключ из wms_api_key'
              }" autocomplete="new-password" />
            </label>
            <label class="span-2">WMS API URL
              <input id="cdek-bridge-url" value="${esc(bridge.wms_url || '')}" />
            </label>
            <label class="span-2">Шаблон URL сделки ({lead_id})
              <input id="cdek-bridge-widget" value="${esc(bridge.widget_url || '')}" />
            </label>
          </div>
        </div>
      </details>

      <details class="deal-fold" open>
        <summary class="deal-fold-sum">Поле Amo «Филиал» и карта</summary>
        <div class="deal-fold-body">
          <div class="form-grid">
            <label>ID поля «Филиал» в Amo
              <input id="cdek-branch-field" type="number" value="${esc(String(data.branch_field_id || ''))}" />
            </label>
            <label style="align-self:end">
              <button type="button" id="cdek-load-branches">Загрузить значения из Amo</button>
            </label>
            <label class="span-2 muted" id="cdek-branches-hint" style="font-size:12px">${enumsHint}${
              data.branch_enums_loaded_at
                ? ' · ' + esc(fmtDt(data.branch_enums_loaded_at))
                : ''
            }</label>
            <label>Плательщик доставки по умолчанию
              <select id="cdek-payer">
                <option value="client" ${
                  data.default_delivery_payer === 'client' ? 'selected' : ''
                }>Клиент</option>
                <option value="sender" ${
                  data.default_delivery_payer === 'sender' ? 'selected' : ''
                }>Отправитель</option>
              </select>
            </label>
            <label>Ключ Яндекс.Карт
              <input id="cdek-yandex" value="${esc(data.yandex_api_key || '')}" autocomplete="off" />
            </label>
            <label style="display:flex;align-items:center;gap:8px;margin-top:22px">
              <input type="checkbox" id="cdek-map-pvz" ${data.map_show_pvz !== false ? 'checked' : ''} />
              Показывать ПВЗ на карте
            </label>
            <label style="display:flex;align-items:center;gap:8px;margin-top:22px">
              <input type="checkbox" id="cdek-map-postamat" ${data.map_show_postamat ? 'checked' : ''} />
              Показывать постаматы
            </label>
            <label style="display:flex;align-items:center;gap:8px;margin-top:22px">
              <input type="checkbox" id="cdek-cod" ${data.default_cod_enabled ? 'checked' : ''} />
              Наложенный платёж по умолчанию
            </label>
          </div>
        </div>
      </details>

      <details class="deal-fold">
        <summary class="deal-fold-sum">Тарифы по умолчанию</summary>
        <div class="deal-fold-body">
          <div id="cdek-methods">${methodsHtml || '<p class="muted">Тарифы не заданы</p>'}</div>
        </div>
      </details>

      <details class="deal-fold" open>
        <summary class="deal-fold-sum">Кабинеты СДЭК</summary>
        <div class="deal-fold-body">
          ${accountsHtml || '<p class="muted">Кабинеты не найдены</p>'}
        </div>
      </details>

      <details class="deal-fold">
        <summary class="deal-fold-sum">Реакция на статусы СДЭК</summary>
        <div class="deal-fold-body">
          <p class="muted" style="margin:0 0 10px;font-size:12px">
            Промежуточные статусы → примечание в сделку. Итоговые → задача ответственному.
          </p>
          <div class="toolbar" style="margin-bottom:8px;gap:8px">
            <button type="button" id="cdek-notes-all">Включить все примечания</button>
            <button type="button" id="cdek-notes-none">Выключить все</button>
          </div>
          ${statusNotesHtml}
        </div>
      </details>

      <details class="deal-fold">
        <summary class="deal-fold-sum">Габариты по категориям</summary>
        <div class="deal-fold-body">
          <p class="muted" style="margin:0 0 10px;font-size:12px">
            Если у товара в 1С нет веса/габаритов — подставляются значения категории.
          </p>
          ${categoryHtml}
        </div>
      </details>
      `,
      {
        toolbar: `
          <button class="primary" type="button" id="cdek-save-top">Сохранить</button>
          <button type="button" id="cdek-go-deals-top">Сделки</button>
          <div class="grow"></div>`,
      }
    );
    bindFormChrome(() => showSection('warehouse'));

    const collectPayload = () => {
      const shipment_methods = [];
      L().view.querySelectorAll('[data-method-idx]').forEach((box) => {
        const get = (name) => box.querySelector(`[data-m="${name}"]`)?.value?.trim() || '';
        const tariff = Number(get('tariff_code')) || 0;
        if (!tariff) return;
        shipment_methods.push({
          id: get('id') || String(tariff),
          title: get('title') || 'Тариф ' + tariff,
          tariff_code: tariff,
          delivery_mode: get('delivery_mode') || 'office',
        });
      });
      const accountsPayload = [];
      L().view.querySelectorAll('[data-account]').forEach((box) => {
        const id = box.getAttribute('data-account');
        const get = (name) => box.querySelector(`[data-f="${name}"]`)?.value ?? '';
        const row = {
          id,
          cdek_client_id: String(get('cdek_client_id')).trim(),
          cdek_client_secret: String(get('cdek_client_secret')).trim(),
          cdek_account: String(get('cdek_account')).trim(),
          cdek_password: String(get('cdek_password')).trim(),
          branch_value: String(get('branch_value')).trim(),
          shipment_point: String(get('shipment_point')).trim(),
          from_city: String(get('from_city')).trim(),
          from_city_code: String(get('from_city_code')).trim(),
          from_address: String(get('from_address')).trim(),
          from_postal_code: String(get('from_postal_code')).trim(),
          from_lat: String(get('from_lat')).trim(),
          from_lon: String(get('from_lon')).trim(),
          sender_phone: String(get('sender_phone')).trim(),
          sender_name: String(get('sender_name')).trim(),
          sender_company: String(get('sender_company')).trim(),
        };
        accountsPayload.push(row);
      });
      const status_notes_enabled = {};
      L().view.querySelectorAll('[data-status-note]').forEach((cb) => {
        if (cb.checked) status_notes_enabled[cb.getAttribute('data-status-note')] = true;
      });
      return {
        branch_field_id: Number(document.getElementById('cdek-branch-field')?.value || 0) || 0,
        yandex_api_key: document.getElementById('cdek-yandex')?.value || '',
        map_show_pvz: !!document.getElementById('cdek-map-pvz')?.checked,
        map_show_postamat: !!document.getElementById('cdek-map-postamat')?.checked,
        default_delivery_payer: document.getElementById('cdek-payer')?.value || 'client',
        default_cod_enabled: !!document.getElementById('cdek-cod')?.checked,
        shipment_methods,
        accounts: accountsPayload,
        status_notes_enabled,
      };
    };

    const doSave = async () => {
      const msg =
        document.getElementById('cdek-save-msg') || document.getElementById('cdek-save-top');
      const btns = [document.getElementById('cdek-save'), document.getElementById('cdek-save-top')];
      btns.forEach((b) => {
        if (b) b.disabled = true;
      });
      if (msg && msg.id === 'cdek-save-msg') msg.textContent = 'Сохранение…';
      try {
        const bridgeBody = {
          wms_url: (document.getElementById('cdek-bridge-url')?.value || '').trim(),
          widget_url: (document.getElementById('cdek-bridge-widget')?.value || '').trim(),
        };
        const bridgeKey = document.getElementById('cdek-bridge-key')?.value || '';
        if (bridgeKey) bridgeBody.wms_key = bridgeKey;
        await api('/settings/integrations/cdek', {
          method: 'PUT',
          body: JSON.stringify({ bridge: bridgeBody }),
        });
        await api('/ops/cdek/settings', {
          method: 'PUT',
          body: JSON.stringify(collectPayload()),
        });
        if (msg && msg.id === 'cdek-save-msg') msg.textContent = 'Сохранено (мост + виджет)';
        setTimeout(() => renderCdekSettings(), 350);
      } catch (e) {
        if (msg && msg.id === 'cdek-save-msg') msg.textContent = e.message;
        else alert(e.message);
        btns.forEach((b) => {
          if (b) b.disabled = false;
        });
      }
    };

    document.getElementById('cdek-save').onclick = doSave;
    document.getElementById('cdek-save-top').onclick = doSave;
    document.getElementById('cdek-go-deals').onclick = () => openTab('cdek-deals');
    document.getElementById('cdek-go-deals-top').onclick = () => openTab('cdek-deals');

    document.getElementById('cdek-load-branches')?.addEventListener('click', async () => {
      const hint = document.getElementById('cdek-branches-hint');
      const fieldId = Number(document.getElementById('cdek-branch-field')?.value || 0) || 0;
      if (hint) hint.textContent = 'Загрузка из Amo…';
      try {
        const r = await api('/ops/cdek/action', {
          method: 'POST',
          body: JSON.stringify({ action: 'load_branches', field_id: fieldId }),
        });
        if (hint) {
          const enums = r.enums || [];
          hint.textContent =
            `Загружено ${enums.length}: ` +
            enums.slice(0, 6).join(' · ') +
            (enums.length > 6 ? '…' : '');
        }
        setTimeout(() => renderCdekSettings(), 400);
      } catch (e) {
        if (hint) hint.textContent = e.message;
      }
    });

    document.getElementById('cdek-notes-all')?.addEventListener('click', () => {
      L().view.querySelectorAll('[data-status-note]').forEach((cb) => {
        cb.checked = true;
      });
    });
    document.getElementById('cdek-notes-none')?.addEventListener('click', () => {
      L().view.querySelectorAll('[data-status-note]').forEach((cb) => {
        cb.checked = false;
      });
    });

    L().view.querySelectorAll('.cdek-check-api').forEach((btn) => {
      btn.onclick = async () => {
        const id = btn.getAttribute('data-account');
        const msg = L().view.querySelector(`[data-account-msg="${id}"]`);
        btn.disabled = true;
        if (msg) msg.textContent = 'Проверка API…';
        try {
          const r = await api('/ops/cdek/action', {
            method: 'POST',
            body: JSON.stringify({ action: 'check_api', account_id: id }),
          });
          if (msg) msg.textContent = r.message || r.state || 'готово';
        } catch (e) {
          if (msg) msg.textContent = e.message;
        } finally {
          btn.disabled = false;
        }
      };
    });

    L().view.querySelectorAll('.cdek-refresh-pvz').forEach((btn) => {
      btn.onclick = async () => {
        const id = btn.getAttribute('data-account');
        const msg = L().view.querySelector(`[data-account-msg="${id}"]`);
        btn.disabled = true;
        if (msg) msg.textContent = 'Обновление кеша ПВЗ…';
        try {
          const r = await api('/ops/cdek/action', {
            method: 'POST',
            body: JSON.stringify({ action: 'refresh_pvz_cache', account_id: id }),
          });
          if (msg) {
            msg.textContent =
              `Кеш: ${r.count || (r.pvz_cache && r.pvz_cache.points_count) || 0} точек` +
              (r.refreshed_at ? `, ${fmtDt(r.refreshed_at)}` : '');
          }
        } catch (e) {
          if (msg) msg.textContent = e.message;
        } finally {
          btn.disabled = false;
        }
      };
    });

    document.getElementById('cdek-save-cats')?.addEventListener('click', async () => {
      const msg = document.getElementById('cdek-cats-msg');
      const payload = { _default: {}, rows: [] };
      L().view.querySelectorAll('[data-cat-row]').forEach((tr) => {
        const kind = tr.getAttribute('data-cat-row');
        const row = {
          weight_kg: Number(tr.querySelector('[data-cat="weight_kg"]')?.value || 0),
          length_cm: Number(tr.querySelector('[data-cat="length_cm"]')?.value || 0),
          width_cm: Number(tr.querySelector('[data-cat="width_cm"]')?.value || 0),
          height_cm: Number(tr.querySelector('[data-cat="height_cm"]')?.value || 0),
        };
        if (kind === '_default') payload._default = row;
        else {
          const name = tr.getAttribute('data-cat-name') || '';
          if (name) payload.rows.push({ name, ...row });
        }
      });
      if (msg) msg.textContent = 'Сохранение…';
      try {
        await api('/ops/cdek/action', {
          method: 'POST',
          body: JSON.stringify({ action: 'save_category_defaults', category_defaults: payload }),
        });
        if (msg) msg.textContent = 'сохранено';
      } catch (e) {
        if (msg) msg.textContent = e.message;
      }
    });
  }

  const VIEWS = {
    'cdek-deals': {
      title: 'СДЭК · сделки',
      path: '/delivery/cdek',
      section: 'warehouse',
      render: renderCdekDeals,
    },
    'cdek-settings': {
      title: 'СДЭК · настройки',
      path: '/delivery/cdek/settings',
      section: 'warehouse',
      render: renderCdekSettings,
    },
  };

  function patchDeliveryMenu() {
    const { SECTIONS } = L();
    if (!SECTIONS?.warehouse?.cols) return;
    const links = [
      { view: 'cdek-deals', label: 'СДЭК · сделки' },
      { view: 'cdek-settings', label: 'СДЭК · настройки' },
    ];
    for (const col of SECTIONS.warehouse.cols) {
      for (const group of col) {
        if (!group || group.title !== 'Доставка' || !Array.isArray(group.links)) continue;
        group.links = links;
        return;
      }
    }
    // если группы нет — добавить в первую колонку
    try {
      const col0 = SECTIONS.warehouse.cols[0];
      if (Array.isArray(col0)) {
        col0.push({ title: 'Доставка', links });
      }
    } catch (_) {
      /* ignore */
    }
  }

  function install() {
    const legacy = L();
    if (!legacy || !legacy.routes) {
      console.warn('[cdek] WmsLegacy not ready');
      return;
    }
    const { VIEW_TITLES, TAB_PATHS, routes, TAB_SECTION_MAP } = legacy;
    for (const [id, cfg] of Object.entries(VIEWS)) {
      VIEW_TITLES[id] = cfg.title;
      TAB_PATHS[id] = cfg.path;
      routes[id] = cfg.render;
      if (TAB_SECTION_MAP) TAB_SECTION_MAP[id] = cfg.section;
    }
    patchDeliveryMenu();
    console.info('[cdek] installed screens:', Object.keys(VIEWS).join(', '));
  }

  window.WmsCdek = { install, VIEWS };
})();
