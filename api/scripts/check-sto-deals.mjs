import { DatabaseSync } from 'node:sqlite';

const dbPath = process.argv[2] || '/root/1c_pnevmopodveska1_ru/warehouse/data/warehouse.sqlite';
const deals = (process.argv[3] || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
if (!deals.length) {
  console.error('Usage: node check-sto-deals.mjs [db] deal1,deal2,...');
  process.exit(1);
}

const db = new DatabaseSync(dbPath);
const stoRows = db
  .prepare(`SELECT id, code, name FROM warehouses WHERE UPPER(IFNULL(code,'')) = 'STO' LIMIT 5`)
  .all();
console.log('STO warehouses:', stoRows);
const stoId = stoRows[0]?.id;
if (!stoId) {
  console.log('No STO warehouse');
  process.exit(0);
}

const placeholders = deals.map(() => '?').join(',');
const bal = db
  .prepare(
    `SELECT b.product_id, p.sku, p.name, b.qty
     FROM stock_balances b
     JOIN products p ON p.id = b.product_id
     WHERE b.warehouse_id = ? AND IFNULL(b.qty, 0) <> 0
     ORDER BY p.name`
  )
  .all(stoId);
console.log('\nSTO balances lines:', bal.length);
for (const r of bal) {
  console.log(`  ${r.qty}\t${r.sku}\t${String(r.name || '').slice(0, 70)}`);
}

const xferToSto = db
  .prepare(
    `SELECT d.id, d.number, d.doc_date, d.deal_id, d.doc_type, d.status,
            IFNULL(wf.code, '') AS from_code, IFNULL(wt.code, '') AS to_code
     FROM stock_docs d
     LEFT JOIN warehouses wf ON wf.id = d.warehouse_id
     LEFT JOIN warehouses wt ON wt.id = d.warehouse_to_id
     WHERE d.deal_id IN (${placeholders})
       AND (d.warehouse_to_id = ? OR UPPER(IFNULL(wt.code,'')) = 'STO')
     ORDER BY datetime(d.doc_date) DESC`
  )
  .all(...deals, stoId);
console.log('\nTransfers/docs TO STO for listed deals:', xferToSto.length);
for (const r of xferToSto) {
  console.log(`  deal ${r.deal_id}\t${r.doc_type}\t${r.number}\t${r.doc_date}\t${r.status}\t${r.from_code}->${r.to_code}`);
}

const allDocs = db
  .prepare(
    `SELECT d.deal_id, d.doc_type, d.number, d.doc_date, d.status,
            IFNULL(wf.code,'') AS from_code, IFNULL(wt.code,'') AS to_code
     FROM stock_docs d
     LEFT JOIN warehouses wf ON wf.id = d.warehouse_id
     LEFT JOIN warehouses wt ON wt.id = d.warehouse_to_id
     WHERE d.deal_id IN (${placeholders})
     ORDER BY d.deal_id, datetime(d.doc_date)`
  )
  .all(...deals);
console.log('\nAll stock docs for listed deals:', allDocs.length);
const byDeal = new Map();
for (const r of allDocs) {
  if (!byDeal.has(r.deal_id)) byDeal.set(r.deal_id, []);
  byDeal.get(r.deal_id).push(r);
}
for (const id of deals) {
  const rows = byDeal.get(id) || [];
  console.log(`\n=== deal ${id} (${rows.length} docs) ===`);
  if (!rows.length) {
    console.log('  (no stock docs)');
    continue;
  }
  for (const r of rows) {
    console.log(`  ${r.doc_type}\t${r.number}\t${r.doc_date}\t${r.status}\t${r.from_code}->${r.to_code}`);
  }
}

const dealRows = db
  .prepare(
    `SELECT id, amo_channel, amo_shipment, name, status
     FROM crm_deals WHERE id IN (${placeholders})`
  )
  .all(...deals);
console.log('\nDeal channels:');
for (const r of dealRows) {
  console.log(`  ${r.id}\t${r.amo_channel || '—'}\t${r.amo_shipment || '—'}\t${r.status}\t${String(r.name || '').slice(0, 50)}`);
}

const onStoViaXfer = new Set(xferToSto.map((r) => String(r.deal_id)));
console.log('\nSummary — deals with doc TO STO:');
for (const id of deals) {
  console.log(`  ${id}: ${onStoViaXfer.has(id) ? 'YES (transfer to STO)' : 'NO transfer to STO in stock_docs'}`);
}
