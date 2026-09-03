import { get } from '../dist/db.js';
import { createDocument } from '../dist/stock.js';

const fixes = [
  {
    deal: '25435269',
    wh: 'STO-RES-MSK',
    comment: 'Коррекция: лишний остаток на резерве после backfill res→STO',
  },
  {
    deal: '25720798',
    wh: 'STO-RES-MSK',
    comment: 'Коррекция: лишний остаток на резерве после дубля (сделка списана)',
  },
  {
    deal: '25720798',
    wh: 'STO',
    comment: 'Коррекция: лишний остаток на СТО после дубля (списание Р25720798)',
  },
];

for (const f of fixes) {
  const wh = get('SELECT id FROM warehouses WHERE code = ?', [f.wh]);
  const pid = get(
    `SELECT product_guid AS id FROM crm_deal_items
     WHERE deal_id = ? AND IFNULL(product_guid,'') != '' LIMIT 1`,
    [f.deal]
  )?.id;
  if (!wh?.id || !pid) {
    console.log(f.deal, f.wh, 'skip no wh/product');
    continue;
  }
  const qty =
    Number(
      get('SELECT qty FROM stock_balances WHERE warehouse_id = ? AND product_id = ?', [
        wh.id,
        pid,
      ])?.qty
    ) || 0;
  if (!(qty > 0)) {
    console.log(f.deal, f.wh, 'skip qty=0');
    continue;
  }
  const docId = createDocument({
    doc_type: 'out',
    warehouse_id: wh.id,
    deal_id: f.deal,
    comment: f.comment,
    lines: [{ product_id: pid, qty, warehouse_id: wh.id }],
    post: true,
    serials_optional: true,
  });
  const num = get('SELECT number FROM stock_docs WHERE id = ?', [docId])?.number;
  console.log(f.deal, f.wh, 'out', num, 'qty', qty);
}
