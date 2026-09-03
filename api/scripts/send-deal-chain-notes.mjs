/** Send missing deduped Amo chain notes for one deal. */
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { get, all, run } = require('../dist/db.js');
const { notifyAmoWarehousePacked } = require('../dist/amo-pick-handoff.js');

const dealId = process.argv[2] || '25721372';

function stoWarehouseId() {
  return String(get(`SELECT id FROM warehouses WHERE UPPER(IFNULL(code,'')) = 'STO' LIMIT 1`)?.id || '');
}
function reserveWarehouseIds() {
  return all(
    `SELECT id FROM warehouses WHERE UPPER(IFNULL(code,'')) LIKE 'STO-RES%' OR IFNULL(name,'') LIKE '%Резерв СТО%'`
  ).map((r) => String(r.id));
}
function stepHint(doc) {
  const c = String(doc?.comment || '');
  const toWh = String(doc?.warehouse_to_id || '');
  const fromWh = String(doc?.warehouse_id || '');
  const stoWh = stoWarehouseId();
  const reserveIds = reserveWarehouseIds();
  if (/Списание по продаже/i.test(c)) return 'writeoff';
  if (doc?.doc_type === 'transfer' && Number(doc?.posted) === 1 && toWh === stoWh && reserveIds.includes(fromWh)) return 'res_to_sto';
  if (/Спуск на СТО/i.test(c) && /Склад ГОТОВО|→/i.test(c)) return 'res_to_sto';
  if (/^На СТО ·/i.test(c)) return 'res_to_sto';
  if (/Передача на склад|Склад ГОТОВО|→.*[Рр]езерв/i.test(c)) return 'main_to_res';
  if (doc?.doc_type === 'transfer' && Number(doc?.posted) === 1 && reserveIds.includes(toWh) && !reserveIds.includes(fromWh)) return 'main_to_res';
  return 'other';
}
function findDoc(hint) {
  const docs = all(
    `SELECT number, doc_type, posted, comment, warehouse_id, warehouse_to_id FROM stock_docs WHERE deal_id = ? ORDER BY datetime(created_at)`,
    [dealId]
  );
  return docs.find((d) => stepHint(d) === hint) || null;
}
function noteStep(text) {
  if (/зарезервировано/i.test(text)) return 'reserve';
  if (/спущено на СТО/i.test(text)) return 'sto';
  if (/списаны со склада СТО/i.test(text)) return 'writeoff';
  return null;
}

function noteKey(text) {
  return String(text || '').replace(/\s+/g, ' ').trim().slice(0, 120);
}

async function amoHasStepNote(dealId, step) {
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const execFileAsync = promisify(execFile);
  const script =
    process.env.AMO1C_LIST_LEAD_NOTES ||
    '/root/amo1c_pnevmopodveska1_ru/public_html/bin/list_lead_notes_for_wms.php';
  try {
    const { stdout } = await execFileAsync('php', [script, `--deal=${dealId}`], {
      encoding: 'utf8',
      maxBuffer: 512 * 1024,
      timeout: 25_000,
    });
    const data = JSON.parse(String(stdout || '{}'));
    const notes = Array.isArray(data.notes) ? data.notes : [];
    return notes.some((t) => noteStep(String(t || '')) === step);
  } catch {
    return false;
  }
}
function loadSent() {
  const row = get(`SELECT value FROM meta WHERE key = ?`, [`amo_chain_notes:${dealId}`]);
  if (!row?.value) return new Set();
  try {
    return new Set(JSON.parse(String(row.value)).map(noteKey));
  } catch {
    return new Set();
  }
}
function saveSent(set) {
  run(`INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)`, [`amo_chain_notes:${dealId}`, JSON.stringify([...set])]);
}

const channel = get(`SELECT amo_channel FROM crm_deals WHERE id = ?`, [dealId])?.amo_channel || '';
const ch = String(channel || 'Самовывоз').trim() || 'Самовывоз';
const main = findDoc('main_to_res');
const sto = findDoc('res_to_sto');
const wo = findDoc('writeoff');
const planned = [];
if (main?.number) planned.push(`Склад: зарезервировано · ${ch} · ${main.number} · Основной → Резерв`);
if (sto?.number) planned.push(`Склад: спущено на СТО · ${ch} · ${sto.number} · Резерв → СТО`);
if (wo?.number) planned.push(`Товары списаны со склада СТО = продажа · заказ ${dealId} · ${wo.number}`);

const sent = loadSent();
const result = { dealId, chain: { main: main?.number, sto: sto?.number, wo: wo?.number }, planned, added: [], skipped: [] };
for (const text of planned) {
  const k = noteKey(text);
  const step = noteStep(text);
  if (sent.has(k)) {
    result.skipped.push({ text, reason: 'meta_dedup' });
    continue;
  }
  if (step && (await amoHasStepNote(dealId, step))) {
    sent.add(k);
    result.skipped.push({ text, reason: 'amo_has_step' });
    continue;
  }
  const r = await notifyAmoWarehousePacked({ dealId, text });
  if (r.ok) {
    sent.add(k);
    result.added.push(text);
  } else {
    result.added.push(`ERR ${r.error}`);
  }
}
saveSent(sent);
console.log(JSON.stringify(result, null, 2));
