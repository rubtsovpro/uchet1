import { get, all } from '../dist/db.js';
import { openDealLinksForStockRows } from '../dist/deal-stock-flow.js';

for (const code of ['STO', 'STO-RES-MSK']) {
  const whId = String(get(`SELECT id FROM warehouses WHERE code = ? LIMIT 1`, [code])?.id || '');
  const rows = all(
    `SELECT b.product_id, b.qty, IFNULL(p.sku,'') sku, IFNULL(p.name,'') name
     FROM stock_balances b LEFT JOIN products p ON p.id = b.product_id
     WHERE b.warehouse_id = ? AND b.qty > 0
     ORDER BY b.qty DESC`,
    [whId]
  );
  const map = openDealLinksForStockRows(
    rows.map((r) => ({ product_id: r.product_id, warehouse_id: whId }))
  );
  console.log('\n===', code, 'lines', rows.length, 'qty', rows.reduce((s, r) => s + Number(r.qty), 0));
  for (const r of rows.filter((x) => Number(x.qty) >= 20)) {
    const deal = map.get(`${r.product_id}\0${whId}`)?.[0]?.deal_id || '—';
    console.log({ qty: r.qty, sku: r.sku, deal, name: r.name.slice(0, 55) });
  }
}

// MRAC01227 history
const p = get(`SELECT id, sku FROM products WHERE sku = 'MRAC01227'`);
if (p) {
  console.log('\nMRAC01227 balances');
  console.log(
    all(
      `SELECT w.code, b.qty FROM stock_balances b JOIN warehouses w ON w.id=b.warehouse_id
       WHERE b.product_id=? AND b.qty>0`,
      [p.id]
    )
  );
  console.log(
    'recent transfers',
    all(
      `SELECT IFNULL(d.deal_id,'') deal_id, l.qty, IFNULL(wf.code,'') fr, IFNULL(wt.code,'') tto,
              substr(IFNULL(d.comment,''),1,90) c, IFNULL(d.created_at,d.doc_date) at
       FROM stock_docs d JOIN stock_doc_lines l ON l.doc_id=d.id
       LEFT JOIN warehouses wf ON wf.id=d.warehouse_id
       LEFT JOIN warehouses wt ON wt.id=d.warehouse_to_id
       WHERE l.product_id=? AND d.posted=1 AND d.doc_type='transfer'
       ORDER BY datetime(IFNULL(d.created_at,d.doc_date)) DESC LIMIT 8`,
      [p.id]
    )
  );
}
