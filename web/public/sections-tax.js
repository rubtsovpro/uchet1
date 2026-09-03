/**
 * Налоги и зарплата: календарь, НДС, УСН/КУДиР, ЗП, отчёты, Контур, архив.
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
  function money(n) {
    const leg = L();
    if (leg && typeof leg.formatMoney === 'function') return leg.formatMoney(n);
    const v = Math.round(Number(n));
    if (!Number.isFinite(v)) return '—';
    return v.toLocaleString('ru-RU', { maximumFractionDigits: 0 }) + ' ₽';
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

  const MONTHS = [
    '',
    'Январь',
    'Февраль',
    'Март',
    'Апрель',
    'Май',
    'Июнь',
    'Июль',
    'Август',
    'Сентябрь',
    'Октябрь',
    'Ноябрь',
    'Декабрь',
  ];

  const PAGE_TABS = [
    { id: 'calendar', label: 'Календарь' },
    { id: 'vat', label: 'НДС' },
    { id: 'usn', label: 'УСН / КУДиР' },
    { id: 'payroll', label: 'Зарплата' },
    { id: 'reports', label: 'Отчёты' },
    { id: 'filings', label: 'Отправки' },
    { id: 'archive', label: 'Архив' },
    { id: 'settings', label: 'Настройки' },
  ];

  const TAB_TITLE = Object.fromEntries(PAGE_TABS.map((t) => [t.id, t.label]));

  const state = {
    tab: 'calendar',
    orgId: '',
    year: new Date().getFullYear(),
    quarter: Math.ceil((new Date().getMonth() + 1) / 3),
    month: new Date().getMonth() + 1,
    busy: false,
  };

  function orgQuery() {
    return state.orgId ? `organization_id=${encodeURIComponent(state.orgId)}` : '';
  }

  function orgOptions() {
    const leg = L();
    const orgs = (leg && leg.state && leg.state.organizations) || [];
    return (
      `<option value="">По умолчанию</option>` +
      orgs
        .map(
          (o) =>
            `<option value="${esc(o.id)}" ${o.id === state.orgId ? 'selected' : ''}>${esc(
              o.short_name || o.name || o.id
            )}</option>`
        )
        .join('')
    );
  }

  function monthOptions(selected) {
    return MONTHS.slice(1)
      .map(
        (name, i) =>
          `<option value="${i + 1}" ${selected === i + 1 ? 'selected' : ''}>${esc(name)}</option>`
      )
      .join('');
  }

  function kindLabel(kind) {
    const k = String(kind || '');
    if (k === 'payment') return 'Уплата';
    if (k === 'report') return 'Отчёт';
    return k || '—';
  }

  function reportTypeLabel(t) {
    const map = {
      NDS: 'НДС',
      NDS_PAY: 'Уплата НДС',
      USN: 'УСН',
      USN_ADV: 'Аванс УСН',
      '6NDFL': '6‑НДФЛ',
      RSV: 'РСВ',
      EFS1: 'ЕФС‑1',
      PERS: 'Перс. сведения',
      NOTICE: 'Уведомление ЕНС',
    };
    const key = String(t || '');
    return map[key] || key || '—';
  }

  function statusBadge(status) {
    const s = String(status || '');
    if (s === 'posted' || s === 'sent' || s === 'ready') {
      return `<span class="badge status-done">${esc(
        s === 'posted' ? 'Проведён' : s === 'sent' ? 'Отправлен' : 'Готов'
      )}</span>`;
    }
    if (s === 'draft' || s === 'dry_run') {
      return `<span class="badge draft">${esc(
        s === 'dry_run' ? 'Пробный (без отправки)' : 'Черновик'
      )}</span>`;
    }
    if (s === 'error') return `<span class="badge kind-bug">Ошибка</span>`;
    if (s === 'uploading' || s === 'checking' || s === 'pending') {
      return `<span class="badge muted">${esc(
        s === 'uploading' ? 'Загрузка' : s === 'checking' ? 'Проверка' : 'В очереди'
      )}</span>`;
    }
    return `<span class="badge muted">${esc(s || '—')}</span>`;
  }

  function kpiCards(items) {
    return `<div class="tax-kpi">${items
      .map(
        ([k, v, tip]) =>
          `<div class="tax-kpi-card" ${tip ? `title="${esc(tip)}"` : ''}>
            <div class="tax-kpi-label">${esc(k)}</div>
            <div class="tax-kpi-value">${v}</div>
          </div>`
      )
      .join('')}</div>`;
  }

  function periodBar(extraHtml) {
    return `<div class="tax-toolbar">
      <div class="tax-toolbar-left">
        <label class="tax-field">Организация
          <select id="tax-org" class="tax-select">${orgOptions()}</select>
        </label>
        <label class="tax-field">Год
          <input id="tax-year" class="tax-input tax-input-year" type="number" value="${state.year}" />
        </label>
        <label class="tax-field">Квартал
          <select id="tax-quarter" class="tax-select tax-select-q">
            ${[1, 2, 3, 4]
              .map((q) => `<option value="${q}" ${state.quarter === q ? 'selected' : ''}>${q}</option>`)
              .join('')}
          </select>
        </label>
        ${extraHtml || ''}
      </div>
    </div>`;
  }

  function emptyState(title, hint) {
    return `<div class="tax-empty">
      <div class="tax-empty-title">${esc(title)}</div>
      <p class="muted">${esc(hint)}</p>
    </div>`;
  }

  async function renderCalendar() {
    const q = orgQuery();
    const data = await api('/tax/calendar' + (q ? '?' + q : ''));
    const items = data.items || [];
    return `
      ${periodBar('')}
      <p class="tax-lead muted">Ближайшие сдачи и уплаты по выбранной организации.</p>
      ${
        items.length
          ? `<div class="table-scroll"><table class="data-table is-dense"><thead><tr>
              <th>Срок</th><th>Событие</th><th>Вид</th><th>Период</th><th>Подсказка</th>
            </tr></thead><tbody>
            ${items
              .map(
                (it) => `<tr>
                <td class="mono">${esc(it.due_date)}</td>
                <td>${esc(it.title)}</td>
                <td>${esc(kindLabel(it.kind))}</td>
                <td>${esc(it.period_label)}</td>
                <td class="muted">${esc(it.amount_hint || '')}</td>
              </tr>`
              )
              .join('')}
            </tbody></table></div>`
          : emptyState('Нет событий', 'В горизонте 12 месяцев сроков нет.')
      }`;
  }

  async function renderVat() {
    const q = [orgQuery(), `year=${state.year}`, `quarter=${state.quarter}`].filter(Boolean).join('&');
    const data = await api('/tax/vat/books?' + q);
    const s = data.summary || {};
    const sales = data.sales || [];
    const purch = data.purchases || [];
    return `
      ${periodBar(`
        <div class="tax-actions">
          <button type="button" class="btn primary" id="tax-vat-rebuild">Пересобрать книги</button>
          <button type="button" class="btn" id="tax-vat-declare">XML декларации</button>
        </div>`)}
      ${kpiCards([
        ['Продажи', esc(s.sales_lines || 0) + ' стр.', 'Строк в книге продаж'],
        ['НДС исходящий', esc(money(s.sales_vat)), ''],
        ['Покупки', esc(s.purchase_lines || 0) + ' стр.', ''],
        ['НДС входящий', esc(money(s.purchase_vat)), ''],
        ['К уплате', esc(money(s.vat_payable)), 'Исходящий − входящий'],
      ])}
      <h3 class="tax-h3">Книга продаж</h3>
      ${
        sales.length
          ? `<div class="table-scroll"><table class="data-table is-dense"><thead><tr>
              <th>№</th><th>Дата</th><th>СФ</th><th>Покупатель</th><th>ИНН</th><th class="num">Сумма</th><th class="num">НДС</th>
            </tr></thead><tbody>
            ${sales
              .slice(0, 100)
              .map(
                (r) => `<tr>
                <td class="mono">${esc(r.line_no)}</td>
                <td class="mono">${esc(r.op_date)}</td>
                <td class="mono">${esc(r.invoice_no)}</td>
                <td>${esc(r.buyer_name)}</td>
                <td class="mono">${esc(r.buyer_inn)}</td>
                <td class="mono num">${esc(money(r.total))}</td>
                <td class="mono num">${esc(money(r.vat_amount))}</td>
              </tr>`
              )
              .join('')}
            </tbody></table></div>`
          : emptyState('Книга продаж пуста', 'Нажмите «Пересобрать книги» — строки из УПД/СФ за квартал.')
      }
      <h3 class="tax-h3">Книга покупок</h3>
      ${
        purch.length
          ? `<div class="table-scroll"><table class="data-table is-dense"><thead><tr>
              <th>№</th><th>Дата</th><th>СФ</th><th>Поставщик</th><th>ИНН</th><th class="num">Сумма</th><th class="num">НДС</th>
            </tr></thead><tbody>
            ${purch
              .slice(0, 100)
              .map(
                (r) => `<tr>
                <td class="mono">${esc(r.line_no)}</td>
                <td class="mono">${esc(r.op_date)}</td>
                <td class="mono">${esc(r.invoice_no)}</td>
                <td>${esc(r.seller_name)}</td>
                <td class="mono">${esc(r.seller_inn)}</td>
                <td class="mono num">${esc(money(r.total))}</td>
                <td class="mono num">${esc(money(r.vat_amount))}</td>
              </tr>`
              )
              .join('')}
            </tbody></table></div>`
          : emptyState('Книга покупок пуста', 'После пересборки появятся приходные / СФ поставщиков.')
      }`;
  }

  async function renderUsn() {
    const q = [orgQuery(), `year=${state.year}`, `quarter=${state.quarter}`].filter(Boolean).join('&');
    const data = await api('/tax/kudir?' + q);
    const s = data.summary || {};
    const lines = data.lines || [];
    return `
      ${periodBar(`
        <label class="tax-field">Месяц уведомления
          <select id="tax-usn-month" class="tax-select">${monthOptions(state.month)}</select>
        </label>
        <div class="tax-actions">
          <button type="button" class="btn primary" id="tax-usn-rebuild">Пересобрать КУДиР</button>
          <button type="button" class="btn" id="tax-usn-declare">XML УСН</button>
          <button type="button" class="btn" id="tax-notice">Уведомление ЕНС</button>
        </div>`)}
      ${kpiCards([
        ['Строк', esc(s.lines || 0), ''],
        ['Доходы', esc(money(s.income)), ''],
        ['Расходы', esc(money(s.expense)), ''],
        ['База', esc(money(s.tax_base)), ''],
        ['Ставка', esc(s.usn_rate || 0) + ' %', ''],
        ['Налог', esc(money(s.usn_tax)), ''],
      ])}
      ${
        lines.length
          ? `<div class="table-scroll"><table class="data-table is-dense"><thead><tr>
              <th>№</th><th>Дата</th><th>Док</th><th>Содержание</th><th class="num">Доход</th><th class="num">Расход</th>
            </tr></thead><tbody>
            ${lines
              .slice(0, 120)
              .map(
                (r) => `<tr>
                <td class="mono">${esc(r.line_no)}</td>
                <td class="mono">${esc(r.op_date)}</td>
                <td class="mono">${esc(r.doc_no)}</td>
                <td>${esc(r.content)}</td>
                <td class="mono num">${Number(r.income) ? esc(money(r.income)) : '—'}</td>
                <td class="mono num">${Number(r.expense) ? esc(money(r.expense)) : '—'}</td>
              </tr>`
              )
              .join('')}
            </tbody></table></div>`
          : emptyState('КУДиР пуста', 'Пересоберите книгу — доходы из документов продаж, расходы из приходов.')
      }`;
  }

  async function renderPayroll() {
    const q = orgQuery();
    const data = await api('/payroll/runs' + (q ? '?' + q : ''));
    const items = data.items || [];
    const periodLabel = `${MONTHS[state.month] || state.month} ${state.year}`;
    return `
      ${periodBar(`
        <label class="tax-field">Месяц начисления
          <select id="tax-pay-month" class="tax-select">${monthOptions(state.month)}</select>
        </label>
        <div class="tax-actions">
          <button type="button" class="btn primary" id="tax-pay-run">Рассчитать · ${esc(periodLabel)}</button>
        </div>`)}
      <div class="tax-callout">
        <strong>Как считается.</strong>
        Оклад из карточки сотрудника в разделе «Персонал»,
        НДФЛ 13%, взносы: пенсионные 22%, медстраховка 5,1%, соцстрах 2,9%.
        Если суммы нулевые — сначала укажите оклады сотрудникам.
      </div>
      ${
        items.length
          ? `<div class="table-scroll"><table class="data-table is-dense"><thead><tr>
              <th>Период</th><th>Статус</th>
              <th class="num">Начислено</th><th class="num">НДФЛ</th>
              <th class="num">Взносы</th><th class="num">К выплате</th><th></th>
            </tr></thead><tbody>
            ${items
              .map((r) => {
                const label = `${MONTHS[r.month] || r.month} ${r.year}`;
                const zero = !(Number(r.accrued_total) > 0);
                return `<tr class="${zero ? 'tax-row-muted' : ''}">
                <td>${esc(label)}</td>
                <td>${statusBadge(r.status)}</td>
                <td class="mono num">${esc(money(r.accrued_total))}</td>
                <td class="mono num">${esc(money(r.ndfl_total))}</td>
                <td class="mono num">${esc(money(r.contrib_total))}</td>
                <td class="mono num"><strong>${esc(money(r.net_total))}</strong></td>
                <td class="tax-row-actions">
                  <button type="button" class="btn" data-pay-open="${esc(r.id)}">Ведомость</button>
                  ${
                    r.status !== 'posted'
                      ? `<button type="button" class="btn" data-pay-post="${esc(r.id)}">Провести</button>`
                      : ''
                  }
                </td>
              </tr>`;
              })
              .join('')}
            </tbody></table></div>
            <div id="tax-pay-detail" class="tax-pay-detail"></div>`
          : emptyState(
              'Расчётов пока нет',
              `Выберите месяц и нажмите «Рассчитать · ${periodLabel}».`
            )
      }`;
  }

  async function renderReports() {
    const q = orgQuery();
    const data = await api('/tax/reports' + (q ? '?' + q : ''));
    const items = data.items || [];
    return `
      ${periodBar(`
        <label class="tax-field">Месяц (перс.)
          <select id="tax-rep-month" class="tax-select">${monthOptions(state.month)}</select>
        </label>
        <div class="tax-actions">
          <button type="button" class="btn" data-build="6NDFL">6‑НДФЛ</button>
          <button type="button" class="btn" data-build="RSV">РСВ</button>
          <button type="button" class="btn" data-build="EFS1">ЕФС‑1</button>
          <button type="button" class="btn" data-build="PERS">Перс. сведения</button>
        </div>`)}
      <p class="tax-lead muted">Черновики XML по зарплатным формам. Перед боевой отправкой в Контур — актуальный XSD ФНС/СФР.</p>
      ${
        items.length
          ? `<div class="table-scroll"><table class="data-table is-dense"><thead><tr>
              <th>Тип</th><th>Период</th><th class="num">Сумма</th><th>Статус</th><th></th>
            </tr></thead><tbody>
            ${items
              .map(
                (r) => `<tr>
                <td><strong>${esc(reportTypeLabel(r.report_type))}</strong></td>
                <td class="mono">${esc(r.period_year)}${
                  r.period_month
                    ? ' · ' + (MONTHS[r.period_month] || r.period_month)
                    : r.period_quarter
                      ? ' · Q' + r.period_quarter
                      : ''
                }</td>
                <td class="mono num">${esc(money(r.amount))}</td>
                <td>${statusBadge(r.status)}</td>
                <td class="tax-row-actions">
                  <a class="btn" href="/api/tax/reports/${esc(r.id)}/xml" target="_blank" rel="noopener">XML</a>
                  <button type="button" class="btn primary" data-send="${esc(r.id)}">В Контур</button>
                </td>
              </tr>`
              )
              .join('')}
            </tbody></table></div>`
          : emptyState('Нет собранных отчётов', 'Соберите XML кнопками выше или из вкладок НДС / УСН.')
      }`;
  }

  async function renderFilings() {
    const q = orgQuery();
    const [fils, kontur] = await Promise.all([
      api('/tax/filings' + (q ? '?' + q : '')),
      api('/tax/kontur/status'),
    ]);
    const items = fils.items || [];
    return `
      ${periodBar(`
        <div class="tax-actions">
          <button type="button" class="btn" id="tax-filings-sync">Обновить статусы</button>
        </div>`)}
      <div class="tax-callout ${kontur.configured ? 'is-ok' : 'is-warn'}">
        <strong>Контур.Экстерн</strong> —
        ${kontur.configured ? 'ключи заданы' : 'ключи не заданы, пробный режим без реальной отправки'}.
        <span class="mono">${esc(kontur.base_url || '')}</span>
        · ${kontur.is_test ? 'тестовый контур' : 'боевой контур'}
        <div class="muted" style="margin-top:6px">${esc(kontur.note || '')}</div>
      </div>
      ${
        items.length
          ? `<div class="table-scroll"><table class="data-table is-dense"><thead><tr>
              <th>Создано</th><th>Тип</th><th>Статус</th><th>Draft</th><th>ДО</th>
            </tr></thead><tbody>
            ${items
              .map(
                (r) => `<tr>
                <td class="mono">${esc(String(r.created_at || '').replace('T', ' ').slice(0, 16))}</td>
                <td>${esc(reportTypeLabel(r.report_type))}</td>
                <td>${statusBadge(r.status)}</td>
                <td class="mono muted">${esc((r.kontur_draft_id || '—').slice(0, 14))}</td>
                <td class="mono muted">${esc((r.kontur_docflow_id || '—').slice(0, 14))}</td>
              </tr>`
              )
              .join('')}
            </tbody></table></div>`
          : emptyState('Очередь пуста', 'Отправьте отчёт кнопкой «В Контур» на вкладке Отчёты.')
      }`;
  }

  async function renderArchive() {
    const q = orgQuery();
    const data = await api('/tax/archive' + (q ? '?' + q : ''));
    const items = data.items || [];
    return `
      ${periodBar(`
        <label class="tax-field">Вид
          <select id="tax-arch-kind" class="tax-select">
            <option value="etalon">Эталон</option>
            <option value="kudir">КУДиР</option>
            <option value="vat_sales">Книга продаж</option>
            <option value="vat_purchases">Книга покупок</option>
            <option value="nds">НДС</option>
            <option value="usn">УСН</option>
            <option value="payroll">Зарплата</option>
            <option value="other">Прочее</option>
          </select>
        </label>
        <label class="tax-field tax-file">
          Файл
          <input type="file" id="tax-arch-file" />
        </label>
        <div class="tax-actions">
          <button type="button" class="btn primary" id="tax-arch-upload">Загрузить</button>
        </div>`)}
      <p class="tax-lead muted">PDF/XLS эталоны для сверки. Хранятся в data/tax/… — с ПДн в git не коммитить.</p>
      ${
        items.length
          ? `<div class="table-scroll"><table class="data-table is-dense"><thead><tr>
              <th>Дата</th><th>Вид</th><th>Название</th><th>Период</th><th class="num">Размер</th><th></th>
            </tr></thead><tbody>
            ${items
              .map(
                (r) => `<tr>
                <td class="mono">${esc(String(r.created_at || '').replace('T', ' ').slice(0, 16))}</td>
                <td>${esc(r.kind)}</td>
                <td>${esc(r.title)}</td>
                <td>${esc(r.period_label || '—')}</td>
                <td class="mono num">${esc(
                  r.size_bytes ? Math.round(r.size_bytes / 1024) + ' КБ' : '—'
                )}</td>
                <td><a class="btn" href="/api/tax/archive/${esc(r.id)}/file">Скачать</a></td>
              </tr>`
              )
              .join('')}
            </tbody></table></div>`
          : emptyState('Архив пуст', 'Загрузите эталонные PDF/XLS для сверки сумм.')
      }`;
  }

  async function renderSettings() {
    const q = orgQuery();
    const data = await api('/tax/settings' + (q ? '?' + q : ''));
    const s = data.settings || {};
    return `
      ${periodBar('')}
      <form id="tax-settings-form" class="tax-settings">
        <label>Система налогообложения
          <select name="tax_system" class="tax-select">
            <option value="usn_income" ${s.tax_system === 'usn_income' ? 'selected' : ''}>УСН доходы</option>
            <option value="usn_income_expense" ${s.tax_system === 'usn_income_expense' ? 'selected' : ''}>УСН доходы−расходы</option>
            <option value="osno" ${s.tax_system === 'osno' ? 'selected' : ''}>ОСН</option>
          </select>
        </label>
        <label>Ставка УСН, %
          <input name="usn_rate" class="tax-input" type="number" step="0.1" value="${esc(s.usn_rate)}" />
        </label>
        <label>Ставка НДС, %
          <input name="vat_rate" class="tax-input" type="number" step="0.1" value="${esc(s.vat_rate)}" />
        </label>
        <label class="tax-check"><input name="vat_payer" type="checkbox" ${s.vat_payer ? 'checked' : ''} /> Плательщик НДС</label>
        <label>Код ИФНС
          <input name="ifns_code" class="tax-input" value="${esc(s.ifns_code)}" />
        </label>
        <label>Рег. № СФР
          <input name="sfr_reg_number" class="tax-input" value="${esc(s.sfr_reg_number)}" />
        </label>
        <label class="tax-check"><input name="trade_fee" type="checkbox" ${s.trade_fee ? 'checked' : ''} /> Торговый сбор</label>
        <label>Kontur account id
          <input name="kontur_account_id" class="tax-input" value="${esc(s.kontur_account_id)}" />
        </label>
        <label>Thumbprint ЭЦП
          <input name="cert_thumbprint" class="tax-input" value="${esc(s.cert_thumbprint)}" />
        </label>
        <label class="tax-span">Заметки
          <textarea name="notes" rows="3">${esc(s.notes)}</textarea>
        </label>
        <div class="tax-span">
          <button type="submit" class="btn primary">Сохранить настройки</button>
        </div>
      </form>`;
  }

  async function bodyForTab() {
    switch (state.tab) {
      case 'vat':
        return renderVat();
      case 'usn':
        return renderUsn();
      case 'payroll':
        return renderPayroll();
      case 'reports':
        return renderReports();
      case 'filings':
        return renderFilings();
      case 'archive':
        return renderArchive();
      case 'settings':
        return renderSettings();
      default:
        return renderCalendar();
    }
  }

  function readControls(root) {
    const org = root.querySelector('#tax-org');
    const year = root.querySelector('#tax-year');
    const quarter = root.querySelector('#tax-quarter');
    const payMonth = root.querySelector('#tax-pay-month');
    const usnMonth = root.querySelector('#tax-usn-month');
    const repMonth = root.querySelector('#tax-rep-month');
    if (org) state.orgId = String(org.value || '');
    if (year) state.year = Number(year.value) || state.year;
    if (quarter) state.quarter = Math.min(4, Math.max(1, Number(quarter.value) || 1));
    const m = payMonth || usnMonth || repMonth;
    if (m) state.month = Math.min(12, Math.max(1, Number(m.value) || state.month));
  }

  function chromeOpts(title) {
    return {
      pageTabs: PAGE_TABS,
      activePageTab: state.tab,
      closable: true,
      crumbs: [
        { label: 'Налоги', type: 'section', id: 'tax' },
        { label: title, current: true },
      ],
    };
  }

  async function render() {
    const leg = L();
    const view = (leg && leg.view) || document.getElementById('view');
    const formChrome = leg && leg.formChrome;
    const title = TAB_TITLE[state.tab] || 'Налоги и зарплата';
    const wrap = (body) =>
      formChrome
        ? formChrome(title, `<div class="tax-hub">${body}</div>`, chromeOpts(title))
        : `<div class="card tax-hub" style="padding:16px"><h2>${esc(title)}</h2>${body}</div>`;

    view.innerHTML = wrap('<p class="muted">Загрузка…</p>');
    if (leg && typeof leg.bindFormChrome === 'function') {
      leg.bindFormChrome(() => {
        if (typeof leg.showSection === 'function') leg.showSection('tax');
      });
    }
    try {
      if (
        leg &&
        (!leg.state.organizations || !leg.state.organizations.length) &&
        typeof leg.refreshRefs === 'function'
      ) {
        await leg.refreshRefs().catch(() => null);
      }
      const inner = await bodyForTab();
      view.innerHTML = wrap(inner);
      if (leg && typeof leg.bindFormChrome === 'function') {
        leg.bindFormChrome(() => {
          if (typeof leg.showSection === 'function') leg.showSection('tax');
        });
      }
      bind(view);
    } catch (e) {
      view.innerHTML = wrap(`<p class="error">${esc(e.message || e)}</p>`);
      if (leg && typeof leg.bindFormChrome === 'function') {
        leg.bindFormChrome(() => {
          if (typeof leg.showSection === 'function') leg.showSection('tax');
        });
      }
      bind(view);
    }
  }

  function bind(root) {
    root.querySelectorAll('[data-pagetab]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-pagetab');
        if (!id || id === state.tab) return;
        readControls(root);
        state.tab = id;
        const leg = L();
        if (leg && leg.TAB_PATHS && leg.TAB_PATHS['tax-' + (id === 'calendar' ? 'calendar' : id)]) {
          /* keep */
        }
        if (leg && typeof leg.setUrl === 'function' && leg.TAB_PATHS) {
          const path =
            leg.TAB_PATHS[
              id === 'calendar'
                ? 'tax-calendar'
                : id === 'vat'
                  ? 'tax-vat'
                  : id === 'usn'
                    ? 'tax-usn'
                    : id === 'payroll'
                      ? 'tax-payroll'
                      : id === 'reports'
                        ? 'tax-reports'
                        : id === 'filings'
                          ? 'tax-filings'
                          : id === 'archive'
                            ? 'tax-archive'
                            : id === 'settings'
                              ? 'tax-settings'
                              : 'tax'
            ] || '/tax';
          leg.setUrl(path);
        }
        render();
      });
    });

    const reloadOn = ['#tax-org', '#tax-year', '#tax-quarter'];
    reloadOn.forEach((sel) => {
      const el = root.querySelector(sel);
      if (el) {
        el.addEventListener('change', () => {
          readControls(root);
          render();
        });
      }
    });
    ['#tax-pay-month', '#tax-usn-month', '#tax-rep-month'].forEach((sel) => {
      const el = root.querySelector(sel);
      if (el) {
        el.addEventListener('change', () => {
          readControls(root);
        });
      }
    });

    const vatReb = root.querySelector('#tax-vat-rebuild');
    if (vatReb) {
      vatReb.addEventListener('click', async () => {
        readControls(root);
        vatReb.disabled = true;
        try {
          await api('/tax/vat/rebuild', {
            method: 'POST',
            body: JSON.stringify({
              organization_id: state.orgId || undefined,
              year: state.year,
              quarter: state.quarter,
            }),
          });
          render();
        } catch (e) {
          alert(e.message || e);
          vatReb.disabled = false;
        }
      });
    }
    const vatDec = root.querySelector('#tax-vat-declare');
    if (vatDec) {
      vatDec.addEventListener('click', async () => {
        readControls(root);
        const r = await api('/tax/vat/declare', {
          method: 'POST',
          body: JSON.stringify({
            organization_id: state.orgId || undefined,
            year: state.year,
            quarter: state.quarter,
          }),
        });
        alert('XML готов · к уплате ' + money(r.amount));
        state.tab = 'reports';
        render();
      });
    }

    const usnReb = root.querySelector('#tax-usn-rebuild');
    if (usnReb) {
      usnReb.addEventListener('click', async () => {
        readControls(root);
        await api('/tax/usn/rebuild', {
          method: 'POST',
          body: JSON.stringify({
            organization_id: state.orgId || undefined,
            year: state.year,
            quarter: state.quarter,
          }),
        });
        render();
      });
    }
    const usnDec = root.querySelector('#tax-usn-declare');
    if (usnDec) {
      usnDec.addEventListener('click', async () => {
        readControls(root);
        await api('/tax/usn/declare', {
          method: 'POST',
          body: JSON.stringify({
            organization_id: state.orgId || undefined,
            year: state.year,
            quarter: state.quarter,
          }),
        });
        state.tab = 'reports';
        render();
      });
    }
    const notice = root.querySelector('#tax-notice');
    if (notice) {
      notice.addEventListener('click', async () => {
        readControls(root);
        await api('/tax/notice/build', {
          method: 'POST',
          body: JSON.stringify({
            organization_id: state.orgId || undefined,
            year: state.year,
            month: state.month,
          }),
        });
        state.tab = 'reports';
        render();
      });
    }

    const payRun = root.querySelector('#tax-pay-run');
    if (payRun) {
      payRun.addEventListener('click', async () => {
        readControls(root);
        payRun.disabled = true;
        payRun.textContent = 'Считаем…';
        try {
          await api('/payroll/runs', {
            method: 'POST',
            body: JSON.stringify({
              organization_id: state.orgId || undefined,
              year: state.year,
              month: state.month,
            }),
          });
          render();
        } catch (e) {
          alert(e.message || e);
          payRun.disabled = false;
          payRun.textContent = 'Рассчитать';
        }
      });
    }
    root.querySelectorAll('[data-pay-open]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const id = btn.getAttribute('data-pay-open');
        const data = await api('/payroll/runs/' + id);
        const box = root.querySelector('#tax-pay-detail');
        const run = data.run || {};
        const lines = run.lines || [];
        if (!box) return;
        if (!lines.length) {
          box.innerHTML = emptyState(
            'В ведомости нет строк',
            'У сотрудников с окладом > 0 и привязкой к организации появятся строки после расчёта.'
          );
          return;
        }
        box.innerHTML = `<h3 class="tax-h3">Ведомость · ${esc(MONTHS[run.month] || run.month)} ${esc(
          run.year
        )}</h3>
          <div class="table-scroll"><table class="data-table is-dense"><thead><tr>
            <th>ФИО</th><th>Отдел</th><th class="num">Оклад</th><th class="num">Дни</th>
            <th class="num">Начислено</th><th class="num">НДФЛ</th>
            <th class="num">Взносы</th><th class="num">К выплате</th>
          </tr></thead><tbody>
          ${lines
            .map(
              (l) => `<tr>
              <td>${esc(l.person_name)}</td>
              <td class="muted">${esc(l.position || '—')}</td>
              <td class="mono num">${esc(money(l.salary_base))}</td>
              <td class="mono num">${esc(l.days_worked)}/${esc(l.days_norm)}</td>
              <td class="mono num">${esc(money(l.accrued))}</td>
              <td class="mono num">${esc(money(l.ndfl))}</td>
              <td class="mono num">${esc(money(l.contrib_total))}</td>
              <td class="mono num"><strong>${esc(money(l.net_pay))}</strong></td>
            </tr>`
            )
            .join('')}
          </tbody></table></div>`;
      });
    });
    root.querySelectorAll('[data-pay-post]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        await api('/payroll/runs/' + btn.getAttribute('data-pay-post') + '/post', {
          method: 'POST',
          body: '{}',
        });
        render();
      });
    });

    root.querySelectorAll('[data-build]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        readControls(root);
        const type = btn.getAttribute('data-build');
        await api('/tax/reports/build', {
          method: 'POST',
          body: JSON.stringify({
            organization_id: state.orgId || undefined,
            type,
            year: state.year,
            quarter: state.quarter,
            month: state.month,
            period: type === 'PERS' ? state.month : state.quarter,
          }),
        });
        render();
      });
    });
    root.querySelectorAll('[data-send]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const report_id = btn.getAttribute('data-send');
        const r = await api('/tax/filings/send', {
          method: 'POST',
          body: JSON.stringify({ report_id, dry_run: false }),
        });
        alert('Отправка: ' + (r.status || '') + (r.filing_id ? ' · ' + r.filing_id.slice(0, 8) : ''));
        state.tab = 'filings';
        render();
      });
    });

    const sync = root.querySelector('#tax-filings-sync');
    if (sync) {
      sync.addEventListener('click', async () => {
        readControls(root);
        await api('/tax/filings/sync-status', {
          method: 'POST',
          body: JSON.stringify({ organization_id: state.orgId || undefined }),
        });
        render();
      });
    }

    const up = root.querySelector('#tax-arch-upload');
    if (up) {
      up.addEventListener('click', async () => {
        readControls(root);
        const fileEl = root.querySelector('#tax-arch-file');
        const kind = root.querySelector('#tax-arch-kind')?.value || 'etalon';
        const file = fileEl && fileEl.files && fileEl.files[0];
        if (!file) {
          alert('Выберите файл');
          return;
        }
        const fd = new FormData();
        fd.append('file', file);
        const q = [orgQuery(), `kind=${encodeURIComponent(kind)}`, `title=${encodeURIComponent(file.name)}`]
          .filter(Boolean)
          .join('&');
        await api('/tax/archive/upload?' + q, { method: 'POST', body: fd });
        render();
      });
    }

    const form = root.querySelector('#tax-settings-form');
    if (form) {
      form.addEventListener('submit', async (ev) => {
        ev.preventDefault();
        readControls(root);
        const fd = new FormData(form);
        await api('/tax/settings', {
          method: 'PATCH',
          body: JSON.stringify({
            organization_id: state.orgId || undefined,
            tax_system: fd.get('tax_system'),
            usn_rate: Number(fd.get('usn_rate')),
            vat_rate: Number(fd.get('vat_rate')),
            vat_payer: form.querySelector('[name=vat_payer]')?.checked ? 1 : 0,
            ifns_code: fd.get('ifns_code'),
            sfr_reg_number: fd.get('sfr_reg_number'),
            trade_fee: form.querySelector('[name=trade_fee]')?.checked ? 1 : 0,
            kontur_account_id: fd.get('kontur_account_id'),
            cert_thumbprint: fd.get('cert_thumbprint'),
            notes: fd.get('notes'),
          }),
        });
        alert('Сохранено');
      });
    }
  }

  function install() {
    const leg = L();
    if (!leg || !leg.routes) return;
    const views = [
      ['tax', 'Налоги и зарплата', '/tax', 'calendar'],
      ['tax-calendar', 'Налоги · календарь', '/tax/calendar', 'calendar'],
      ['tax-vat', 'Налоги · НДС', '/tax/vat', 'vat'],
      ['tax-usn', 'Налоги · УСН', '/tax/usn', 'usn'],
      ['tax-payroll', 'Налоги · зарплата', '/tax/payroll', 'payroll'],
      ['tax-reports', 'Налоги · отчёты', '/tax/reports', 'reports'],
      ['tax-filings', 'Налоги · отправки', '/tax/filings', 'filings'],
      ['tax-archive', 'Налоги · архив', '/tax/archive', 'archive'],
      ['tax-settings', 'Налоги · настройки', '/tax/settings', 'settings'],
    ];
    for (const [id, title, path, tab] of views) {
      leg.VIEW_TITLES[id] = title;
      leg.TAB_PATHS[id] = path;
      if (leg.TAB_SECTION_MAP) leg.TAB_SECTION_MAP[id] = 'tax';
      leg.routes[id] = () => {
        state.tab = tab;
        render();
      };
    }

    if (!leg.SECTIONS.tax) {
      leg.SECTIONS.tax = {
        cols: [
          [
            {
              title: 'Налоги',
              links: [
                { view: 'tax-calendar', label: 'Календарь' },
                { view: 'tax-vat', label: 'НДС' },
                { view: 'tax-usn', label: 'УСН / КУДиР' },
              ],
            },
            {
              title: 'Зарплата',
              links: [
                { view: 'tax-payroll', label: 'Начисление' },
                { view: 'tax-reports', label: '6‑НДФЛ / РСВ / ЕФС' },
              ],
            },
          ],
          [
            {
              title: 'Подача',
              links: [
                { view: 'tax-filings', label: 'Отправки (Контур)' },
                { view: 'tax-archive', label: 'Архив эталонов' },
                { view: 'tax-settings', label: 'Настройки org' },
              ],
            },
          ],
        ],
      };
    }

    const nav = document.getElementById('sections');
    if (nav && !nav.querySelector('[data-section="tax"]')) {
      const a = document.createElement('a');
      a.className = 'sec';
      a.href = '/tax';
      a.dataset.section = 'tax';
      a.title = 'Налоги и зарплата';
      a.innerHTML =
        '<svg class="sec-svg" width="18" height="18" viewBox="0 0 18 18" aria-hidden="true"><path d="M4 14V4h3v10H4zm7 0V8h3v6h-3z" fill="none" stroke="currentColor" stroke-width="1.3"/><path d="M3 15h12" fill="none" stroke="currentColor" stroke-width="1.3"/></svg>' +
        '<span class="sec-label">Налоги</span>';
      const moneyNav = nav.querySelector('[data-section="money"]');
      if (moneyNav && moneyNav.nextSibling) nav.insertBefore(a, moneyNav.nextSibling);
      else nav.appendChild(a);
      a.addEventListener('click', (e) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button === 1) return;
        e.preventDefault();
        if (typeof leg.showSection === 'function') leg.showSection('tax');
      });
    }

    console.info('[tax] installed');
  }

  function installAndShow() {
    install();
    try {
      const btn = document.querySelector('a.sec[data-section="tax"]');
      if (btn) {
        btn.hidden = false;
        btn.setAttribute('aria-hidden', 'false');
      }
    } catch (_) {
      /* ignore */
    }
  }

  window.WmsTax = { install: installAndShow };

  if (window.WmsLegacy && window.WmsLegacy.routes) {
    setTimeout(installAndShow, 0);
  }
})();
