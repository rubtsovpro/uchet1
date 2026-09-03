#!/usr/bin/env node
/**
 * Догрузить amo_channel / shipment / pay из Amo для сделок с пустым каналом.
 *
 *   cd /root/1c_pnevmopodveska1_ru/warehouse/api
 *   node --experimental-sqlite ../bin/backfill-amo-channels.mjs
 *   node --experimental-sqlite ../bin/backfill-amo-channels.mjs --limit=200 --queued
 *   node --experimental-sqlite ../bin/backfill-amo-channels.mjs --dry
 */
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const dbPath = process.env.WMS_DB_PATH || path.join(root, 'data/warehouse.sqlite');
const limitArg = process.argv.find((a) => a.startsWith('--limit='));
const limit = limitArg ? Math.max(1, Number(limitArg.split('=')[1]) || 300) : 300;
const dry = process.argv.includes('--dry');
const onlyQueued = process.argv.includes('--queued');

const dbRead = new DatabaseSync(dbPath, { readOnly: true });
const where = [
  `trim(IFNULL(amo_channel,'')) = ''`,
  `id NOT LIKE '999%'`,
  `length(id) >= 6`,
];
if (onlyQueued) where.push(`IFNULL(queued_to_1c,0) = 1`);
const ids = dbRead
  .prepare(
    `SELECT id FROM crm_deals
     WHERE ${where.join(' AND ')}
     ORDER BY datetime(IFNULL(queued_at, updated_at)) DESC
     LIMIT ?`
  )
  .all(limit)
  .map((r) => String(r.id));
dbRead.close();

console.log(JSON.stringify({ to_sync: ids.length, dry, onlyQueued, limit }, null, 2));
if (dry || !ids.length) process.exit(0);

const deals = await import(pathToFileURL(path.resolve(root, 'api/dist/deals.js')).href);
const { get } = await import(pathToFileURL(path.resolve(root, 'api/dist/db.js')).href);

let filled = 0;
let stillEmpty = 0;
let failed = 0;
for (const id of ids) {
  try {
    deals.syncDealsFromAmo1c({ dealId: id, limit: 1 });
    const after = get(
      `SELECT amo_channel, amo_shipment, amo_payment_type FROM crm_deals WHERE id = ?`,
      [id]
    );
    const ch = String(after?.amo_channel || '').trim();
    if (ch) filled += 1;
    else stillEmpty += 1;
    const n = filled + stillEmpty + failed;
    if (n % 20 === 0) {
      console.log(JSON.stringify({ progress: n, filled, stillEmpty, failed, last: id, ch: ch || null }));
    }
  } catch (e) {
    failed += 1;
    console.warn('[fail]', id, e instanceof Error ? e.message : e);
  }
}
console.log(JSON.stringify({ done: true, filled, stillEmpty, failed, total: ids.length }, null, 2));
