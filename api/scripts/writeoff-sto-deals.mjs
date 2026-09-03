/**
 * Списать товар со склада СТО по проданным сделкам (Автосервис / Самовывоз).
 * Usage: node writeoff-sto-deals.mjs [dbPath] deal1,deal2,...
 */
import { DatabaseSync } from 'node:sqlite';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbPath = process.argv[2] || '/root/1c_pnevmopodveska1_ru/warehouse/data/warehouse.sqlite';
const deals = (process.argv[3] || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

if (!deals.length) {
  console.error('Usage: node writeoff-sto-deals.mjs [db] deal1,deal2,...');
  process.exit(1);
}

process.chdir(path.resolve(__dirname, '..'));
const mod = await import(pathToFileURL(path.resolve('dist/deal-stock-flow.js')).href);

for (const dealId of deals) {
  try {
    const r = mod.writeOffStoOnDealSuccess(dealId, { createdBy: 'batch · продажа' });
    console.log(dealId, JSON.stringify(r));
  } catch (e) {
    console.error(dealId, e instanceof Error ? e.message : e);
  }
}

const db = new DatabaseSync(dbPath);
const stoId = db
  .prepare(`SELECT id FROM warehouses WHERE UPPER(IFNULL(code,'')) = 'STO' LIMIT 1`)
  .get()?.id;
console.log('\nSTO balances after:');
if (stoId) {
  const rows = db
    .prepare(
      `SELECT COUNT(*) AS lines, IFNULL(SUM(qty),0) AS qty
       FROM stock_balances WHERE warehouse_id = ? AND qty <> 0`
    )
    .get(stoId);
  console.log('lines', rows?.lines, 'qty', rows?.qty);
}
