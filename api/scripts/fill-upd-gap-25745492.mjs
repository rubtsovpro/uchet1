/**
 * УПД №259 (пропуск серии БРП) — сделка 25745492, ИП Пономарев.
 * Usage: node --experimental-sqlite scripts/fill-upd-gap-25745492.mjs
 */
import { createSalesDocFromDeal, createUpdAndWriteOffFromDeal } from '../dist/sales-docs.js';
import { run, get } from '../dist/db.js';
import { ensureCounterpartyForDeal } from '../dist/counterparty-vehicles.js';

const BRP = '8e2d4c6e-5e47-4ee5-9cf8-e25822776c5f';
const dealId = '25745492';
const number = '259';
const buyerName = 'ИП Пономарев Антон Владимирович';
const buyerInn = '180803049582';
const docDate = '2026-08-25';

const existing = get(
  `SELECT id, number FROM sales_docs WHERE deal_id = ? AND doc_type IN ('upd','sf') LIMIT 1`,
  [dealId]
);
if (existing) {
  console.log(JSON.stringify({ ok: false, error: 'upd_exists', existing }, null, 2));
  process.exit(0);
}

const gapTaken = get(
  `SELECT id, deal_id FROM sales_docs WHERE doc_type = 'upd' AND organization_id = ? AND number = ?`,
  [BRP, number]
);
if (gapTaken) {
  console.log(JSON.stringify({ ok: false, error: 'number_taken', gapTaken }, null, 2));
  process.exit(1);
}

run(
  `UPDATE crm_deals SET buyer_name = ?, buyer_inn = ?, is_legal_entity = 1, buyer_kind = 'ip',
     company_name = ?, updated_at = datetime('now') WHERE id = ?`,
  [buyerName, buyerInn, buyerName, dealId]
);

const deal = get('SELECT * FROM crm_deals WHERE id = ?', [dealId]);
const cpId = ensureCounterpartyForDeal(deal);
if (cpId) {
  run(
    `UPDATE counterparties SET name = ?, inn = ?, kind = 'buyer', party_kind = 'ip',
       bank = COALESCE(NULLIF(bank,''), ?), bik = COALESCE(NULLIF(bik,''), ?),
       rs = COALESCE(NULLIF(rs,''), ?), ks = COALESCE(NULLIF(ks,''), ?)
     WHERE id = ?`,
    [
      buyerName,
      buyerInn,
      String(deal?.buyer_bank || ''),
      String(deal?.buyer_bik || ''),
      String(deal?.buyer_rs || ''),
      String(deal?.buyer_ks || ''),
      cpId,
    ]
  );
  run(
    `UPDATE crm_deals SET company_id = ?, company_name = ?, updated_at = datetime('now') WHERE id = ?`,
    [cpId, buyerName, dealId]
  );
}

let result;
try {
  result = createUpdAndWriteOffFromDeal({
    dealId,
    buyerName,
    buyerInn,
    organizationId: BRP,
    createdBy: 'gap-fill-25745492',
  });
} catch (e) {
  const msg = e instanceof Error ? e.message : String(e);
  if (!/нет на складе/i.test(msg)) throw e;
  const upd = createSalesDocFromDeal({
    dealId,
    docType: 'upd',
    buyerName,
    buyerInn,
    organizationId: BRP,
    createdBy: 'gap-fill-25745492',
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
  number,
  docDate,
  result.upd.id,
]);

const saved = get(
  `SELECT id, number, doc_date, total, counterparty_name, counterparty_inn, deal_id, organization_id,
          buyer_bank, buyer_bik, buyer_rs, buyer_ks
   FROM sales_docs WHERE id = ?`,
  [result.upd.id]
);

console.log(
  JSON.stringify(
    {
      ok: true,
      dealId,
      cpId,
      doc: saved,
      stock_doc_id: result.stock_doc_id,
      stock_doc_number: result.stock_doc_number,
      stock_note: result.stock_note,
    },
    null,
    2
  )
);
