/**
 * Разовая правка 9 сделок автосервис/самовывоз · 25.08.2026
 * — удалить непроведённые дубли main→res
 * — backfill res→STO где товар уже на СТО
 * — коррекция двойного res→STO (25720798)
 */
import { all, get, run } from '../dist/db.js';
import { createDocument } from '../dist/stock.js';
import {
  buildDealWarehouseChain,
  dealIsSuccessful,
  writeOffStoOnDealSuccess,
} from '../dist/deal-stock-flow.js';
import { notifyAmoWarehousePacked } from '../dist/amo-pick-handoff.js';
import {
  resolvePickSiteForDeal,
  reserveWarehouseForPickSite,
} from '../dist/handoff-reserve.js';
import { stoWarehouseId } from '../dist/supply-chain.js';

const DEALS = [
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

function chainSummary(dealId) {
  return buildDealWarehouseChain(dealId).map((s) => `${s.step}:${s.status}`);
}

function deleteUnpostedReserveDrafts(dealId) {
  const drafts = all(
    `SELECT id, IFNULL(number,'') AS number FROM stock_docs
     WHERE deal_id = ?
       AND doc_type = 'transfer'
       AND IFNULL(posted,0) = 0
       AND comment LIKE '%Резерв%'
       AND comment NOT LIKE '%Спуск на СТО%'`,
    [dealId]
  );
  for (const d of drafts) {
    run('DELETE FROM stock_doc_lines WHERE doc_id = ?', [d.id]);
    run('DELETE FROM stock_docs WHERE id = ?', [d.id]);
    console.log(`  deleted unposted ${d.number} (${d.id})`);
  }
  return drafts.length;
}

function hasPostedResToSto(dealId) {
  return !!get(
    `SELECT 1 AS ok FROM stock_docs sd
     JOIN warehouses wf ON wf.id = sd.warehouse_id
     JOIN warehouses wt ON wt.id = sd.warehouse_to_id
     WHERE sd.deal_id = ? AND sd.doc_type = 'transfer' AND IFNULL(sd.posted,0) = 1
       AND wf.code = 'STO-RES-MSK' AND wt.code = 'STO'
     LIMIT 1`,
    [dealId]
  );
}

function backfillResToSto(dealId, actor = 'fix-deals-reserve-sto') {
  if (hasPostedResToSto(dealId)) return { skipped: true, reason: 'already' };
  const site = resolvePickSiteForDeal(dealId);
  const reserveWh = reserveWarehouseForPickSite(site).id;
  const stoWh = stoWarehouseId();
  const lines = all(
    `SELECT b.product_id, b.qty FROM stock_balances b
     WHERE b.warehouse_id = ? AND b.qty > 0
       AND b.product_id IN (
         SELECT product_guid FROM crm_deal_items i
         LEFT JOIN products p ON p.id = i.product_guid
         WHERE i.deal_id = ? AND IFNULL(p.item_kind,'product') != 'service'
       )`,
    [stoWh, dealId]
  );
  if (!lines.length) {
    const fromReserve = all(
      `SELECT product_id, qty FROM stock_balances
       WHERE warehouse_id = ? AND qty > 0
         AND product_id IN (SELECT product_guid FROM crm_deal_items WHERE deal_id = ?)`,
      [reserveWh, dealId]
    );
    if (!fromReserve.length) return { skipped: true, reason: 'no_stock' };
    lines.push(...fromReserve);
  }
  const docId = createDocument({
    doc_type: 'transfer',
    warehouse_id: reserveWh,
    warehouse_to_id: stoWh,
    deal_id: dealId,
    comment: `Передача на склад · Спуск на СТО · backfill · ${actor} · сделка ${dealId} · Резерв СТО · Москва → СТО · Склад ГОТОВО`,
    lines: lines.map((l) => ({
      product_id: l.product_id,
      qty: Number(l.qty) || 0,
      warehouse_id: reserveWh,
    })),
    post: true,
    ignore_stock: true,
    serials_optional: true,
  });
  const num = get('SELECT number FROM stock_docs WHERE id = ?', [docId])?.number;
  void notifyAmoWarehousePacked({
    dealId,
    text: `Склад: Резерв → СТО · ${num || docId} · backfill`,
  }).catch(() => {});
  return { ok: true, doc_id: docId, number: num };
}

function fixDuplicateResToSto25720798() {
  const dealId = '25720798';
  const stoWh = stoWarehouseId();
  const posted = all(
    `SELECT sd.id, sd.number, sd.created_at FROM stock_docs sd
     JOIN warehouses wf ON wf.id = sd.warehouse_id
     JOIN warehouses wt ON wt.id = sd.warehouse_to_id
     WHERE sd.deal_id = ? AND sd.doc_type = 'transfer' AND IFNULL(sd.posted,0) = 1
       AND wf.code = 'STO-RES-MSK' AND wt.code = 'STO'
     ORDER BY datetime(sd.created_at)`,
    [dealId]
  );
  if (posted.length < 2) return { skipped: true };
  const dup = posted[0];
  const line = get(
    `SELECT product_id, qty FROM stock_doc_lines WHERE doc_id = ? LIMIT 1`,
    [dup.id]
  );
  if (!line?.product_id) return { skipped: true, reason: 'no_line' };
  const onSto =
    Number(
      get(
        `SELECT IFNULL(qty,0) AS qty FROM stock_balances WHERE warehouse_id = ? AND product_id = ?`,
        [stoWh, line.product_id]
      )?.qty
    ) || 0;
  if (!(onSto > 0)) return { skipped: true, reason: 'no_extra_sto' };
  const site = resolvePickSiteForDeal(dealId);
  const reserveWh = reserveWarehouseForPickSite(site).id;
  const qty = Math.min(Number(line.qty) || 1, onSto);
  const docId = createDocument({
    doc_type: 'transfer',
    warehouse_id: stoWh,
    warehouse_to_id: reserveWh,
    deal_id: dealId,
    comment: `Коррекция дубля res→STO · отмена ${dup.number} · сделка ${dealId}`,
    lines: [{ product_id: line.product_id, qty, warehouse_id: stoWh }],
    post: true,
    serials_optional: true,
  });
  return { ok: true, reversed: dup.number, doc_id: docId };
}

console.log('=== fix-deals-reserve-sto ===');
for (const dealId of DEALS) {
  console.log(`\n--- ${dealId} ---`);
  console.log('  before:', chainSummary(dealId).join(' | '));
  const n = deleteUnpostedReserveDrafts(dealId);
  if (n) console.log(`  removed ${n} unposted draft(s)`);
}

console.log('\n--- backfill 25435269 res→STO ---');
console.log(backfillResToSto('25435269'));

console.log('\n--- fix 25720798 duplicate ---');
console.log(fixDuplicateResToSto25720798());

console.log('\n--- writeoff on success ---');
for (const dealId of DEALS) {
  const ok = dealIsSuccessful(dealId);
  if (!ok) {
    console.log(`${dealId}: not success stage`);
    continue;
  }
  try {
    const r = writeOffStoOnDealSuccess(dealId, {
      createdBy: 'fix-deals-reserve-sto',
      requireSuccess: true,
    });
    console.log(`${dealId}:`, r);
  } catch (e) {
    console.log(`${dealId}: ERROR`, e instanceof Error ? e.message : e);
  }
}

console.log('\n=== after ===');
for (const dealId of DEALS) {
  console.log(`${dealId}:`, chainSummary(dealId).join(' | '), dealIsSuccessful(dealId) ? 'SUCCESS' : '');
}
