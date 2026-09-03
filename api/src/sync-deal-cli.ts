/**
 * CLI: синк одной сделки Amo → Учёт (отдельный процесс, не блокирует webhook).
 * Usage: node --experimental-sqlite dist/sync-deal-cli.js <dealId>
 */
import { syncDealsFromAmo1c } from './deals.js';

const dealId = String(process.argv[2] || '')
  .replace(/\D/g, '')
  .trim();
if (!dealId) {
  console.error('usage: sync-deal-cli.js <dealId>');
  process.exit(1);
}

try {
  const r = syncDealsFromAmo1c({ dealId, limit: 1 });
  console.log(JSON.stringify({ ok: true, dealId, ...r }));
} catch (e) {
  console.error('[sync-deal-cli]', dealId, e);
  process.exit(1);
}
