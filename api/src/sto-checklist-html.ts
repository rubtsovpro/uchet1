/**
 * HTML интерактивного чек-листа приёма/выдачи СТО (печать + галочки).
 */
import {
  listStoChecklistItems,
  parseStoChecklistJson,
  stoChecklistProgress,
  STO_CHECKLIST_PHASES,
  type StoChecklistState,
} from './sto-intake-checklist.js';
import type { StoChecklistStaffPick } from './staff.js';
import { STO_CHECKLIST_STAFF_DEPTS, STO_CHECKLIST_STAFF_LABELS } from './staff.js';

function esc(s: unknown): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function staffSelectHtml(
  id: string,
  current: string,
  items: StoChecklistStaffPick[],
  deptLabel: string,
  interactive: boolean
): string {
  const cur = String(current || '').trim();
  if (!interactive) {
    return `<input id="${esc(id)}" value="${esc(cur)}" readonly />`;
  }
  const names = new Set(items.map((it) => String(it.name || '').trim()).filter(Boolean));
  const opts = [`<option value="">— из отдела «${esc(deptLabel)}» —</option>`];
  for (const it of items) {
    const name = String(it.name || '').trim();
    if (!name) continue;
    opts.push(
      `<option value="${esc(name)}"${name === cur ? ' selected' : ''}>${esc(name)}</option>`
    );
  }
  if (cur && !names.has(cur)) {
    opts.push(`<option value="${esc(cur)}" selected>${esc(cur)} (вне списка)</option>`);
  }
  return `<select id="${esc(id)}">${opts.join('')}</select>`;
}

export function renderStoChecklistInteractiveHtml(input: {
  docId: string;
  number: string;
  docDate: string;
  carPlate?: string;
  carBrand?: string;
  carModel?: string;
  carVin?: string;
  dealId?: string;
  legal?: boolean;
  state: StoChecklistState;
  interactive?: boolean;
    staffPicks?: {
      masters: StoChecklistStaffPick[];
      admins: StoChecklistStaffPick[];
      departments?: { master: string; admin: string };
      labels?: { master: string; admin: string };
    };
}): string {
  const legal = input.legal !== false;
  const items = listStoChecklistItems({ legal });
  const progress = stoChecklistProgress(input.state, { legal });
  const car =
    [input.carBrand, input.carModel].filter(Boolean).join(' ') ||
    '____________________';
  const interactive = input.interactive !== false;

  const phasesHtml = STO_CHECKLIST_PHASES.map((ph) => {
    const phaseItems = items.filter((i) => i.phase === ph.id);
    if (!phaseItems.length) return '';
    const rows = phaseItems
      .map((it) => {
        const checked = !!input.state.checks[it.id];
        return `<label class="cl-item${checked ? ' is-done' : ''}${
          it.optional ? ' is-opt' : ''
        }">
          <input type="checkbox" data-cl-id="${esc(it.id)}" ${checked ? 'checked' : ''} ${
            interactive ? '' : 'disabled'
          } />
          <span class="cl-body">
            <span class="cl-label">${esc(it.label)}${
              it.optional ? ' <em class="cl-opt">по ситуации</em>' : ''
            }</span>
            <span class="cl-hint">${esc(it.hint)}</span>
          </span>
        </label>`;
      })
      .join('\n');
    return `<section class="cl-phase">
      <h2>${esc(ph.title)}</h2>
      <p class="cl-phase-tip">${esc(ph.tip)}</p>
      ${rows}
    </section>`;
  }).join('\n');

  const saveScript = interactive
    ? `<script>
(function () {
  var docId = ${JSON.stringify(input.docId)};
  var statusEl = document.getElementById('cl-status');
  var timer = 0;
  function setStatus(t, ok) {
    if (!statusEl) return;
    statusEl.textContent = t || '';
    statusEl.className = ok === false ? 'cl-status bad' : 'cl-status';
  }
  function collect() {
    var checks = {};
    document.querySelectorAll('[data-cl-id]').forEach(function (el) {
      if (el.checked) checks[el.getAttribute('data-cl-id')] = true;
    });
    return {
      checks: checks,
      master_name: (document.getElementById('cl-master') || {}).value || '',
      admin_name: (document.getElementById('cl-admin') || {}).value || ''
    };
  }
  function refreshDone() {
    document.querySelectorAll('.cl-item').forEach(function (lab) {
      var cb = lab.querySelector('input[type=checkbox]');
      lab.classList.toggle('is-done', !!(cb && cb.checked));
    });
    var all = document.querySelectorAll('[data-cl-id]');
    var n = 0;
    all.forEach(function (el) { if (el.checked) n++; });
    var prog = document.getElementById('cl-prog');
    if (prog) prog.textContent = n + ' / ' + all.length;
  }
  async function save() {
    setStatus('Сохранение…');
    try {
      var res = await fetch('/api/sales-docs/' + encodeURIComponent(docId) + '/sto-checklist', {
        method: 'PATCH',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(collect())
      });
      var data = await res.json().catch(function () { return {}; });
      if (!res.ok) throw new Error(data.error || res.statusText);
      setStatus('Сохранено');
      refreshDone();
    } catch (e) {
      setStatus(e.message || String(e), false);
    }
  }
  document.querySelectorAll('[data-cl-id]').forEach(function (el) {
    el.addEventListener('change', function () {
      refreshDone();
      clearTimeout(timer);
      timer = setTimeout(save, 280);
    });
  });
  ['cl-master', 'cl-admin'].forEach(function (id) {
    var el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('change', function () {
      clearTimeout(timer);
      timer = setTimeout(save, 400);
    });
  });
  var btn = document.getElementById('cl-save');
  if (btn) btn.onclick = save;
  refreshDone();
})();
</script>`
    : '';

  return `<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>Чек-лист СТО · ЗН ${esc(input.number)}</title>
  <style>
    :root { --ok:#1b8a5a; --line:#d0d8d8; --muted:#5a6f6f; --bg:#f4f7f7; --card:#fff; --accent:#0d7377; }
    * { box-sizing: border-box; }
    body { margin: 0; font-family: "SF Pro Text", "Segoe UI", system-ui, sans-serif; background: var(--bg); color: #122; }
    .wrap { max-width: 820px; margin: 0 auto; padding: 16px 14px 40px; }
    .toolbar { position: sticky; top: 0; z-index: 2; display: flex; flex-wrap: wrap; gap: 8px; align-items: center;
      background: color-mix(in srgb, var(--bg) 92%, #fff); padding: 10px 0 12px; border-bottom: 1px solid var(--line); margin-bottom: 14px; }
    .toolbar button, .toolbar a { font: 600 13px system-ui, sans-serif; padding: 8px 12px; border-radius: 8px;
      border: 1px solid var(--line); background: #fff; color: #122; text-decoration: none; cursor: pointer; }
    .toolbar .primary { background: var(--accent); color: #fff; border-color: transparent; }
    h1 { font-size: 18px; margin: 0 0 6px; }
    .meta { color: var(--muted); font-size: 13px; margin: 0 0 14px; line-height: 1.45; }
    .rule { background: #fff8e6; border: 1px solid #f0d78c; border-radius: 10px; padding: 10px 12px; font-size: 13px; margin: 0 0 16px; }
    .cl-phase { background: var(--card); border: 1px solid var(--line); border-radius: 12px; padding: 12px 14px; margin: 0 0 12px; }
    .cl-phase h2 { margin: 0 0 4px; font-size: 14px; }
    .cl-phase-tip { margin: 0 0 10px; font-size: 12px; color: var(--muted); }
    .cl-item { display: flex; gap: 10px; align-items: flex-start; padding: 10px 8px; border-top: 1px solid var(--line);
      cursor: pointer; border-radius: 8px; }
    .cl-item:first-of-type { border-top: 0; }
    .cl-item.is-done { background: color-mix(in srgb, var(--ok) 8%, transparent); }
    .cl-item input { width: 20px; height: 20px; margin-top: 2px; flex: 0 0 auto; accent-color: var(--ok); }
    .cl-body { display: grid; gap: 4px; min-width: 0; }
    .cl-label { font-size: 14px; font-weight: 650; line-height: 1.35; }
    .cl-hint { font-size: 12px; color: var(--muted); line-height: 1.4; }
    .cl-opt { font-style: normal; font-weight: 600; color: var(--muted); font-size: 11px; }
    .cl-print { font-weight: 700; color: var(--accent); }
    .sign { display: grid; gap: 10px; margin-top: 14px; }
    .sign label { display: grid; gap: 4px; font-size: 12px; font-weight: 700; color: var(--muted); }
    .sign input { min-height: 40px; border-radius: 8px; border: 1px solid var(--line); padding: 0 10px; font-size: 15px; }
    .cl-status { font-size: 12px; color: var(--muted); }
    .cl-status.bad { color: #b91c1c; }
    .prog { font-weight: 800; color: var(--accent); }
    @media print {
      .toolbar { display: none; }
      body { background: #fff; }
      .cl-item { break-inside: avoid; }
      .cl-hint { color: #333; }
    }
  </style>
</head>
<body>
  <div class="wrap">
    <div class="toolbar">
      ${interactive ? '<button type="button" class="primary" id="cl-save">Сохранить</button>' : ''}
      <button type="button" onclick="window.print()">Печать</button>
      <span class="cl-status" id="cl-status"></span>
      <span style="margin-left:auto" class="muted">Отмечено: <span class="prog" id="cl-prog">${progress.done} / ${progress.total}</span></span>
    </div>
    <h1>Чек-лист приёма и выдачи автомобиля</h1>
    <p class="meta">
      Заказ-наряд <b>№ ${esc(input.number)}</b> от ${esc(String(input.docDate).slice(0, 10))}<br/>
      Авто: ${esc(car)}${input.carPlate ? ', гос. знак ' + esc(input.carPlate) : ''}${
        input.carVin ? ', VIN ' + esc(input.carVin) : ''
      }<br/>
      Обязательные: ${progress.requiredDone} / ${progress.requiredTotal}
    </p>
    <p class="rule"><b>Ключевое правило:</b> нет подписанного документа — нет работ. Авто не в работу до подписания ЗН и приёмо-сдаточного акта.</p>
    ${phasesHtml}
    <div class="sign">
      <label>${esc(
        input.staffPicks?.labels?.master || STO_CHECKLIST_STAFF_LABELS.master
      )}
        ${staffSelectHtml(
          'cl-master',
          input.state.master_name || '',
          input.staffPicks?.masters || [],
          input.staffPicks?.departments?.master || STO_CHECKLIST_STAFF_DEPTS.master,
          interactive
        )}
      </label>
      <label>${esc(
        input.staffPicks?.labels?.admin || STO_CHECKLIST_STAFF_LABELS.admin
      )}
        ${staffSelectHtml(
          'cl-admin',
          input.state.admin_name || '',
          input.staffPicks?.admins || [],
          input.staffPicks?.departments?.admin || STO_CHECKLIST_STAFF_DEPTS.admin,
          interactive
        )}
      </label>
    </div>
  </div>
  ${saveScript}
</body>
</html>`;
}

export { parseStoChecklistJson };
