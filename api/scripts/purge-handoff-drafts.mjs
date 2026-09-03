/**
 * Удалить непроведённые черновики «Передача на склад» / виджет Товары.
 * Это заявки на /pick, не движения склада — после «Готово» остаётся проведённый TR/OUT.
 *
 * Usage: node scripts/purge-handoff-drafts.mjs [--dry-run] [--warehouse-id=UUID]
 */
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dryRun = process.argv.includes('--dry-run');
const whArg = process.argv.find((a) => a.startsWith('--warehouse-id='));
const warehouseId = whArg ? whArg.split('=')[1]?.trim() : '';

process.chdir(path.resolve(__dirname, '..'));
const { all, get, run } = await import(pathToFileURL(path.resolve('dist/db.js')).href);

const where = [
  `IFNULL(d.posted, 0) = 0`,
  `(IFNULL(d.comment, '') LIKE '%Передача на склад%' OR IFNULL(d.comment, '') LIKE '%виджет Товары%')`,
  `d.doc_type IN ('out', 'transfer')`,
];
const params = [];
if (warehouseId) {
  where.push(`(d.warehouse_id = ? OR IFNULL(d.warehouse_to_id, '') = ?)`);
  params.push(warehouseId, warehouseId);
}

const ids = all(
  `SELECT d.id, d.number, d.doc_type, d.deal_id, d.comment,
          (SELECT IFNULL(SUM(l.qty),0) FROM stock_doc_lines l WHERE l.doc_id = d.id) AS qty_sum
   FROM stock_docs d
   WHERE ${where.join(' AND ')}
   ORDER BY datetime(d.created_at) DESC`,
  params
).map((r) => ({
  id: String(r.id),
  number: String(r.number || ''),
  doc_type: String(r.doc_type || ''),
  deal_id: String(r.deal_id || ''),
  qty_sum: Number(r.qty_sum) || 0,
  comment: String(r.comment || '').slice(0, 100),
}));

if (dryRun) {
  console.log(JSON.stringify({ dryRun: true, count: ids.length, items: ids.slice(0, 30) }, null, 2));
  process.exit(0);
}

let deleted = 0;
for (const row of ids) {
  run('DELETE FROM stock_doc_lines WHERE doc_id = ?', [row.id]);
  run('DELETE FROM stock_docs WHERE id = ?', [row.id]);
  deleted += 1;
}

const left = get(
  `SELECT COUNT(*) AS c FROM stock_docs d WHERE ${where.join(' AND ')}`,
  params
)?.c;

console.log(JSON.stringify({ deleted, remaining: Number(left) || 0 }, null, 2));
