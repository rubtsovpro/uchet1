/**
 * Audit + close/writeoff + deduped Amo notes for 9 reserve/STO deals.
 * Run on bank-vps: cd warehouse/api && node --experimental-sqlite scripts/audit-close-9-deals.mjs
 */
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

const { get, all, run } = require('../dist/db.js');
const { dealIsSuccessful, writeOffStoOnDealSuccess } = require('../dist/deal-stock-flow.js');
const { syncDealsFromAmo1c } = require('../dist/deals.js');
const { notifyAmoWarehousePacked } = require('../dist/amo-pick-handoff.js');

const IDS = [
  '25721742', '25716112', '25721372', '25720798', '25654217',
  '25435269', '25704711', '25707659', '25703837',
];

function stoWarehouseId() {
  return String(
    get(`SELECT id FROM warehouses WHERE UPPER(IFNULL(code,'')) = 'STO' LIMIT 1`)?.id || ''
  );
}

function reserveWarehouseIds() {
  return all(
    `SELECT id FROM warehouses
     WHERE UPPER(IFNULL(code,'')) LIKE 'STO-RES%'
        OR IFNULL(name,'') LIKE '%Резерв СТО%'`
  ).map((r) => String(r.id));
}

function stepHint(doc) {
  const c = String(doc?.comment || '');
  const toWh = String(doc?.warehouse_to_id || '');
  const fromWh = String(doc?.warehouse_id || '');
  const stoWh = stoWarehouseId();
  const reserveIds = reserveWarehouseIds();
  if (/Списание по продаже/i.test(c)) return 'writeoff';
  if (
    doc?.doc_type === 'transfer' &&
    Number(doc?.posted) === 1 &&
    toWh === stoWh &&
    reserveIds.includes(fromWh)
  ) {
    return 'res_to_sto';
  }
  if (/Спуск на СТО/i.test(c) && /Склад ГОТОВО|→/i.test(c)) return 'res_to_sto';
  if (/Спуск на СТО/i.test(c)) return 'res_to_sto_task';
  if (/^На СТО ·/i.test(c) || (/На СТО/i.test(c) && /→.*СТО/i.test(c))) return 'res_to_sto';
  if (/Передача на склад|Склад ГОТОВО|→.*[Рр]езерв/i.test(c)) return 'main_to_res';
  if (
    doc?.doc_type === 'transfer' &&
    Number(doc?.posted) === 1 &&
    reserveIds.includes(toWh) &&
    !reserveIds.includes(fromWh)
  ) {
    return 'main_to_res';
  }
  return 'other';
}

function findDoc(dealId, hint) {
  const docs = all(
    `SELECT number, doc_type, posted, comment, warehouse_id, warehouse_to_id FROM stock_docs
     WHERE deal_id = ? ORDER BY datetime(created_at) ASC`,
    [dealId]
  );
  return docs.find((d) => stepHint(d) === hint) || null;
}

function noteKey(text) {
  return String(text || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
}

function buildNotes(dealId, channel) {
  const ch = String(channel || 'Самовывоз').trim() || 'Самовывоз';
  const main = findDoc(dealId, 'main_to_res');
  const sto = findDoc(dealId, 'res_to_sto');
  const wo = findDoc(dealId, 'writeoff');
  const notes = [];
  if (main?.number) {
    notes.push(`Склад: зарезервировано · ${ch} · ${main.number} · Основной → Резерв`);
  }
  if (sto?.number) {
    notes.push(`Склад: спущено на СТО · ${ch} · ${sto.number} · Резерв → СТО`);
  }
  if (wo?.number) {
    notes.push(`Товары списаны со склада СТО = продажа · заказ ${dealId} · ${wo.number}`);
  }
  return notes;
}

function loadSentNotes(dealId) {
  const row = get(`SELECT value FROM meta WHERE key = ?`, [`amo_chain_notes:${dealId}`]);
  if (!row?.value) return new Set();
  try {
    const arr = JSON.parse(String(row.value));
    return new Set(Array.isArray(arr) ? arr.map(noteKey) : []);
  } catch {
    return new Set();
  }
}

function saveSentNotes(dealId, sentSet) {
  run(`INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)`, [
    `amo_chain_notes:${dealId}`,
    JSON.stringify([...sentSet]),
  ]);
}

async function sendMissingNotes(dealId, channel) {
  const sent = loadSentNotes(dealId);
  const planned = buildNotes(dealId, channel);
  const sentNow = [];
  for (const text of planned) {
    const k = noteKey(text);
    if (sent.has(k)) continue;
    const r = await notifyAmoWarehousePacked({ dealId, text });
    if (r.ok) {
      sent.add(k);
      sentNow.push(text);
    } else {
      sentNow.push(`ERR: ${text.slice(0, 50)}… ${r.error || 'fail'}`);
    }
  }
  saveSentNotes(dealId, sent);
  return { planned: planned.length, sent: sentNow.length, texts: sentNow };
}

function auditDeal(dealId) {
  const d = get(
    `SELECT status_id, status_name, amo_channel FROM crm_deals WHERE id = ?`,
    [dealId]
  );
  const docs = all(
    `SELECT number, doc_type, posted, comment, warehouse_id, warehouse_to_id FROM stock_docs
     WHERE deal_id = ? ORDER BY datetime(created_at)`,
    [dealId]
  );
  const wo = get(
    `SELECT number FROM stock_docs WHERE deal_id = ? AND doc_type = 'out'
     AND posted = 1 AND comment LIKE '%Списание по продаже%' LIMIT 1`,
    [dealId]
  );
  const onSto =
    get(
      `SELECT IFNULL(SUM(b.qty),0) AS q FROM stock_balances b
       INNER JOIN warehouses w ON w.id = b.warehouse_id AND UPPER(IFNULL(w.code,'')) = 'STO'
       WHERE b.qty > 0 AND b.product_id IN (SELECT product_guid FROM crm_deal_items WHERE deal_id = ?)`,
      [dealId]
    )?.q ?? 0;
  const onRes =
    get(
      `SELECT IFNULL(SUM(b.qty),0) AS q FROM stock_balances b
       INNER JOIN warehouses w ON w.id = b.warehouse_id
         AND (UPPER(IFNULL(w.code,'')) LIKE 'STO-RES%' OR IFNULL(w.name,'') LIKE '%Резерв СТО%')
       WHERE b.qty > 0 AND b.product_id IN (SELECT product_guid FROM crm_deal_items WHERE deal_id = ?)`,
      [dealId]
    )?.q ?? 0;
  const openPick = get(
    `SELECT number FROM stock_docs WHERE deal_id = ? AND doc_type = 'out'
     AND posted = 0 AND comment LIKE '%Передача на склад%' LIMIT 1`,
    [dealId]
  );
  return {
    id: dealId,
    channel: d?.amo_channel || '',
    status: d?.status_name || d?.status_id || '',
    success: dealIsSuccessful(dealId),
    writeoff: wo?.number || null,
    on_sto: Number(onSto) || 0,
    on_reserve: Number(onRes) || 0,
    open_pick: openPick?.number || null,
    chain: {
      main_to_res: findDoc(dealId, 'main_to_res')?.number || null,
      res_to_sto: findDoc(dealId, 'res_to_sto')?.number || null,
      writeoff: wo?.number || null,
    },
    docs: docs.map((x) => ({
      n: x.number,
      t: x.doc_type,
      p: x.posted,
      h: stepHint(x),
    })),
  };
}

const report = [];
for (const id of IDS) {
  try {
    syncDealsFromAmo1c({ dealId: id, limit: 1 });
  } catch {
    /* already in WMS */
  }
  const before = auditDeal(id);
  let writeoff = null;
  if (before.success && !before.writeoff && before.on_sto > 0) {
    try {
      writeoff = writeOffStoOnDealSuccess(id, {
        createdBy: 'аудит · закрытие 9 сделок',
        requireSuccess: true,
      });
    } catch (e) {
      writeoff = { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  } else if (before.success && before.writeoff) {
    writeoff = { ok: true, already: true, stock_doc_number: before.writeoff };
  } else if (!before.success) {
    writeoff = { ok: true, skipped: true, reason: 'not_success_in_amo' };
  } else {
    writeoff = { ok: true, skipped: true, reason: 'nothing_on_sto' };
  }
  const after = auditDeal(id);
  const notes = await sendMissingNotes(id, after.channel);
  report.push({ before, writeoff, after, notes });
}

console.log(JSON.stringify(report, null, 2));
