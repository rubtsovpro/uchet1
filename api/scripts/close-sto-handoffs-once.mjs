/**
 * One-shot: close Спуск на СТО pick drafts + Amo notes for deals already on STO.
 */
import { get, all } from '../dist/db.js';
import { completeHandoffPick } from '../dist/warehouse-tasks.js';
import { notifyAmoWarehousePacked } from '../dist/amo-pick-handoff.js';

const allIds = [
  '25721742',
  '25716112',
  '25721372',
  '25720798',
  '25654217',
  '25435269',
  '25704711',
  '25707659',
  '25703837',
];

function moscowLabel() {
  return new Date().toLocaleString('ru-RU', {
    timeZone: 'Europe/Moscow',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

const placeholders = allIds.map(() => '?').join(',');

const open = all(
  `SELECT id, number, deal_id, comment FROM stock_docs
   WHERE doc_type = 'out' AND IFNULL(posted,0) = 0
     AND deal_id IN (${placeholders})
     AND comment LIKE '%Спуск на СТО%'`,
  allIds
);

console.log(
  'OPEN_TO_STO',
  open.map((o) => ({ n: o.number, d: o.deal_id }))
);

const results = [];
const completedDeals = new Set();

for (const doc of open) {
  try {
    const r = await completeHandoffPick(String(doc.id));
    completedDeals.add(String(doc.deal_id));
    results.push({
      deal: doc.deal_id,
      action: 'complete',
      ok: true,
      number: r.number || doc.number,
    });
    console.log('COMPLETE', doc.deal_id, doc.number, '→', r.number || r.doc_id);
  } catch (e) {
    results.push({
      deal: doc.deal_id,
      action: 'complete',
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    });
    console.error('COMPLETE_FAIL', doc.deal_id, e);
  }
}

const packLabel = moscowLabel();
for (const dealId of allIds) {
  if (completedDeals.has(dealId)) continue;
  const ch =
    get(`SELECT IFNULL(amo_channel,'') AS amo_channel FROM crm_deals WHERE id = ?`, [dealId])
      ?.amo_channel || '';
  const noteText = `Склад: спущено на СТО · ${String(ch || 'Самовывоз').trim() || 'Самовывоз'} · ${packLabel}`;
  try {
    const n = await notifyAmoWarehousePacked({ dealId, text: noteText });
    results.push({ deal: dealId, action: 'note', ok: n?.ok !== false, note: noteText, detail: n });
    console.log('NOTE', dealId, JSON.stringify(n));
  } catch (e) {
    results.push({
      deal: dealId,
      action: 'note',
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    });
    console.error('NOTE_FAIL', dealId, e);
  }
}

console.log('SUMMARY', JSON.stringify(results, null, 2));
