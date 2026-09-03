/**
 * 1) Откатить проведённые IN-00001 / IN-00002 (пост. 405 ещё не приняли)
 * 2) Создать одну непроведённую приходную со всеми строками + ячейками
 *
 *   WMS_DATA_DIR=... node scripts/post405-draft-inbound.mjs
 */
import { all, get, run } from '../dist/db.js';
import { applyStockDelta, createDocument } from '../dist/stock.js';
import {
  applyCellIssueDelta,
  insertLinePlacements,
} from '../dist/warehouse-cells.js';

const MAIN = 'b7142cc4-2b3a-11ec-80bf-00155d3d52d2';
const CP = '6a671d10-edb8-11ee-80c8-00155d07def5';
const SOURCE_NUMBERS = ['IN-00001', 'IN-00002'];

function unpostInbound(docId) {
  const doc = get(
    `SELECT id, number, posted, warehouse_id, comment FROM stock_docs WHERE id = ?`,
    [docId]
  );
  if (!doc) throw new Error('doc not found ' + docId);
  if (!Number(doc.posted)) {
    console.log('skip already unposted', doc.number);
    return;
  }
  const wh = String(doc.warehouse_id || MAIN);
  const lines = all(
    `SELECT l.id, l.product_id, l.qty, IFNULL(p.sku,'') AS sku
     FROM stock_doc_lines l
     LEFT JOIN products p ON p.id = l.product_id
     WHERE l.doc_id = ?`,
    [docId]
  );
  const placements = all(
    `SELECT p.cell_code, p.qty, IFNULL(l.product_id,'') AS product_id, IFNULL(pr.sku,'') AS sku
     FROM stock_doc_line_placements p
     JOIN stock_doc_lines l ON l.id = p.line_id
     LEFT JOIN products pr ON pr.id = l.product_id
     WHERE p.doc_id = ?`,
    [docId]
  );

  run('BEGIN');
  try {
    for (const line of lines) {
      applyStockDelta(wh, String(line.product_id), -Number(line.qty), {
        ignoreInsufficient: true,
      });
    }
    for (const pl of placements) {
      applyCellIssueDelta({
        warehouse_id: wh,
        cell_code: String(pl.cell_code),
        product_id: String(pl.product_id),
        sku: String(pl.sku || ''),
        qty: Number(pl.qty),
      });
    }
    run(
      `UPDATE stock_docs
       SET posted = 0,
           comment = ?
       WHERE id = ?`,
      [
        String(doc.comment || '') + ' · ОТМЕНЁН: товар ещё не принят, остатки сняты',
        docId,
      ]
    );
    run('COMMIT');
  } catch (e) {
    run('ROLLBACK');
    throw e;
  }
  console.log('unposted', doc.number, 'lines', lines.length, 'placements', placements.length);
}

// --- unpost old ---
const sources = [];
for (const num of SOURCE_NUMBERS) {
  const d = get(`SELECT id, number, posted FROM stock_docs WHERE number = ?`, [num]);
  if (!d) {
    console.warn('missing', num);
    continue;
  }
  unpostInbound(String(d.id));
  sources.push(String(d.id));
}

// Collect lines+placements from cancelled docs (merge by product+cell)
const merged = new Map(); // product_id -> { qty, cells: Map<code, qty>, sku }
for (const docId of sources) {
  const lines = all(
    `SELECT l.product_id, l.qty, IFNULL(p.sku,'') AS sku
     FROM stock_doc_lines l
     LEFT JOIN products p ON p.id = l.product_id
     WHERE l.doc_id = ?`,
    [docId]
  );
  const placements = all(
    `SELECT p.cell_code, p.qty, l.product_id
     FROM stock_doc_line_placements p
     JOIN stock_doc_lines l ON l.id = p.line_id
     WHERE p.doc_id = ?`,
    [docId]
  );
  for (const line of lines) {
    const pid = String(line.product_id);
    if (!merged.has(pid)) {
      merged.set(pid, { qty: 0, sku: String(line.sku || ''), cells: new Map() });
    }
    const m = merged.get(pid);
    m.qty += Number(line.qty) || 0;
  }
  for (const pl of placements) {
    const pid = String(pl.product_id);
    if (!merged.has(pid)) {
      merged.set(pid, { qty: 0, sku: '', cells: new Map() });
    }
    const m = merged.get(pid);
    const code = String(pl.cell_code || '').trim() || 'П.1';
    m.cells.set(code, (m.cells.get(code) || 0) + (Number(pl.qty) || 0));
  }
}

// Ensure cell sums match qty
const inboundLines = [];
for (const [product_id, m] of merged) {
  let cellSum = 0;
  for (const q of m.cells.values()) cellSum += q;
  if (cellSum <= 0 && m.qty > 0) {
    m.cells.set('П.1', m.qty);
    cellSum = m.qty;
  }
  if (Math.abs(cellSum - m.qty) > 0.001) {
    // normalize to П.1 if mismatch
    m.cells.clear();
    m.cells.set('П.1', m.qty);
  }
  inboundLines.push({
    product_id,
    qty: m.qty,
    price: 0,
    placements: [...m.cells.entries()].map(([cell_code, qty]) => ({ cell_code, qty })),
    _sku: m.sku,
  });
}

inboundLines.sort((a, b) => String(a._sku).localeCompare(String(b._sku)));

const already = get(
  `SELECT id, number, posted FROM stock_docs
   WHERE doc_type = 'in' AND comment LIKE '%пост. 405%' AND posted = 0
     AND comment LIKE '%черновик%'
   ORDER BY created_at DESC LIMIT 1`
);
if (already?.id) {
  console.log(
    JSON.stringify(
      {
        ok: true,
        reused: true,
        id: already.id,
        number: already.number,
        url: `https://1c.pnevmopodveska1.ru/docs/${already.id}`,
        url_alt: `https://uchetn1.ru/docs/${already.id}`,
      },
      null,
      2
    )
  );
  process.exit(0);
}

const docId = createDocument({
  doc_type: 'in',
  warehouse_id: MAIN,
  counterparty_id: CP,
  comment: 'пост. 405 · Поставщик Т · черновик (товар ещё не принят) · размещение по ячейкам',
  serials_optional: true,
  post: false,
  lines: inboundLines.map((l) => ({
    product_id: l.product_id,
    qty: l.qty,
    price: 0,
    warehouse_id: MAIN,
  })),
});

const dbLines = all(
  `SELECT id, product_id, qty FROM stock_doc_lines WHERE doc_id = ? ORDER BY rowid`,
  [docId]
);
if (dbLines.length !== inboundLines.length) {
  throw new Error(`lines mismatch ${dbLines.length} vs ${inboundLines.length}`);
}
dbLines.forEach((dbLine, idx) => {
  const src = inboundLines[idx];
  insertLinePlacements({
    doc_id: docId,
    line_id: String(dbLine.id),
    warehouse_id: MAIN,
    product_id: String(dbLine.product_id),
    placements: src.placements,
  });
});

const doc = get(`SELECT id, number, posted, comment FROM stock_docs WHERE id = ?`, [docId]);
const qtySum = inboundLines.reduce((s, l) => s + l.qty, 0);

// sanity: balances for sample should not include the 405 qty anymore
const sampleSku = 'MRAA01002';
const sample = get(
  `SELECT b.qty FROM stock_balances b
   JOIN products p ON p.id = b.product_id
   WHERE b.warehouse_id = ? AND upper(p.sku) = ?`,
  [MAIN, sampleSku]
);

console.log(
  JSON.stringify(
    {
      ok: true,
      cancelled: SOURCE_NUMBERS,
      draft: {
        id: doc?.id,
        number: doc?.number,
        posted: doc?.posted,
        comment: doc?.comment,
        lines: inboundLines.length,
        qty_sum: qtySum,
      },
      url: `https://1c.pnevmopodveska1.ru/docs/${doc?.id}`,
      url_alt: `https://uchetn1.ru/docs/${doc?.id}`,
      sample_MRAA01002_balance: sample?.qty ?? 0,
    },
    null,
    2
  )
);
