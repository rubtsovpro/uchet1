import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { all } = require('../dist/db.js');
const { normalizeDealPhone } = require('../dist/deals.js');

const dealId = String(process.argv[2] || '25742478');
const rows = all(
  `SELECT id, kind, status, created_at, payload_json, result_json, error
   FROM fiscal_receipts WHERE deal_id = ? ORDER BY created_at DESC LIMIT 8`,
  [dealId]
);

function dig(obj, path) {
  let cur = obj;
  for (const p of path.split('.')) {
    if (!cur || typeof cur !== 'object') return undefined;
    cur = cur[p];
  }
  return cur;
}

for (const r of rows) {
  console.log('---', r.id, r.kind, r.status, r.created_at);
  for (const key of ['payload_json', 'result_json']) {
    const raw = r[key];
    if (!raw) continue;
    try {
      const j = typeof raw === 'string' ? JSON.parse(raw) : raw;
      const phone =
        dig(j, 'receipt.client.phone') ||
        dig(j, 'client.phone') ||
        dig(j, 'payload.receipt.client.phone') ||
        dig(j, 'payload.client.phone');
      console.log(key, 'phone=', JSON.stringify(phone));
      const client = dig(j, 'receipt.client') || dig(j, 'client') || dig(j, 'payload.receipt.client');
      if (client) console.log('  client=', JSON.stringify(client));
      if (key === 'payload_json' && !phone) {
        console.log('  payload_keys=', Object.keys(j || {}));
        console.log('  snippet=', JSON.stringify(j).slice(0, 500));
      }
    } catch (e) {
      console.log(key, 'err', e.message);
    }
  }
}

console.log('normalize samples:');
for (const s of [
  '+7 (938) 401-71-70',
  '79384017170',
  '+79384017170',
  '9384017170',
  '89384017170',
  '+779384017170',
]) {
  console.log(JSON.stringify(s), '->', JSON.stringify(normalizeDealPhone(s)));
}
