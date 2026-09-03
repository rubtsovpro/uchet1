/**
 * УПД в пропуски 257–258 по фискальным чекам БРП от 26.08.2026.
 * Правильный путь: createUpdAndWriteOffFromDeal + фиксация номера/даты.
 * Usage: node --experimental-sqlite scripts/fill-upd-gap-deals-260826.mjs
 */
import { createSalesDocFromDeal, createUpdAndWriteOffFromDeal } from '../dist/sales-docs.js';
import { run, get } from '../dist/db.js';
import { ensureCounterpartyForDeal } from '../dist/counterparty-vehicles.js';

const BRP = '8e2d4c6e-5e47-4ee5-9cf8-e25822776c5f';
const tasks = [
  {
    dealId: '25664793',
    number: '257',
    buyerName: 'ИП Хлусов Тимофей Игоревич',
    buyerInn: '591793242456',
    buyerKind: 'ip',
    docDate: '2026-08-26',
  },
  {
    dealId: '24907079',
    number: '258',
    buyerName: 'ООО «ШаркСервис»',
    buyerInn: '2223640858',
    buyerKind: 'legal',
    docDate: '2026-08-26',
  },
];

function removeDealUpd(dealId) {
  const cur = get(
    `SELECT id FROM sales_docs WHERE deal_id = ? AND doc_type IN ('upd','sf') LIMIT 1`,
    [dealId]
  );
  if (!cur) return null;
  const id = String(cur.id);
  run(`DELETE FROM sales_doc_lines WHERE doc_id = ?`, [id]);
  run(`DELETE FROM sales_docs WHERE id = ?`, [id]);
  return id;
}

const out = [];
for (const t of tasks) {
  const removed = removeDealUpd(t.dealId);

  run(
    `UPDATE crm_deals SET buyer_name = ?, buyer_inn = ?, is_legal_entity = 1, buyer_kind = ?,
       company_name = CASE WHEN ? = 'legal' THEN ? ELSE company_name END,
       updated_at = datetime('now') WHERE id = ?`,
    [t.buyerName, t.buyerInn, t.buyerKind, t.buyerKind, t.buyerName, t.dealId]
  );

  const deal = get('SELECT * FROM crm_deals WHERE id = ?', [t.dealId]);
  if (!deal) throw new Error(`deal ${t.dealId} not found`);

  const cpId = ensureCounterpartyForDeal(deal);
  if (cpId) {
    run(
      `UPDATE counterparties SET name = ?, inn = ?, kind = 'buyer', party_kind = ? WHERE id = ?`,
      [t.buyerName, t.buyerInn, t.buyerKind === 'legal' ? 'legal' : 'ip', cpId]
    );
    if (t.buyerKind === 'legal') {
      run(
        `UPDATE crm_deals SET company_id = ?, company_name = ?, updated_at = datetime('now') WHERE id = ?`,
        [cpId, t.buyerName, t.dealId]
      );
    }
  }

  let result;
  try {
    result = createUpdAndWriteOffFromDeal({
      dealId: t.dealId,
      buyerName: t.buyerName,
      buyerInn: t.buyerInn,
      organizationId: BRP,
      createdBy: 'gap-backfill-260826',
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (!/нет на складе/i.test(msg)) throw e;
    const upd = createSalesDocFromDeal({
      dealId: t.dealId,
      docType: 'upd',
      buyerName: t.buyerName,
      buyerInn: t.buyerInn,
      organizationId: BRP,
      createdBy: 'gap-backfill-260826',
    });
    result = {
      upd,
      stock_doc_id: null,
      stock_doc_number: null,
      stock_note: `УПД без списания: ${msg}`,
      skipped_services: 0,
    };
  }

  run('UPDATE sales_docs SET number = ?, doc_date = ? WHERE id = ?', [
    t.number,
    t.docDate,
    result.upd.id,
  ]);

  const saved = get(
    `SELECT id, number, doc_date, total, counterparty_name, counterparty_inn, deal_id, organization_id
     FROM sales_docs WHERE id = ?`,
    [result.upd.id]
  );
  out.push({
    dealId: t.dealId,
    removed,
    cpId,
    doc: saved,
    stock_doc_id: result.stock_doc_id,
    stock_doc_number: result.stock_doc_number,
    stock_note: result.stock_note,
  });
}

console.log(JSON.stringify({ ok: true, results: out }, null, 2));
