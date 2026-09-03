import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { get, all } = require('../dist/db.js');

const id = '24186015';
const d = get(
  `SELECT id, name, IFNULL(buyer_phone,'') AS phone, IFNULL(amo_channel,'') AS ch,
          IFNULL(amo_branch,'') AS br, IFNULL(status_name,'') AS st, IFNULL(price,0) AS price
   FROM crm_deals WHERE id = ?`,
  [id]
);
console.log('deal', d);
const fisc = all(
  `SELECT id, kind, status, amount, IFNULL(error,'') AS error, atol_uuid, external_id, created_at,
          IFNULL(result_json,'') AS result_json, substr(IFNULL(payload_json,''),1,400) AS payload
   FROM fiscal_receipts WHERE deal_id = ? ORDER BY created_at DESC LIMIT 5`,
  [id]
);
for (const r of fisc) {
  console.log('---', r.id, r.kind, r.status, r.amount, r.created_at);
  console.log('error', r.error);
  console.log('uuid', r.atol_uuid);
  try {
    const j = JSON.parse(r.result_json || '{}');
    console.log('result', JSON.stringify(j, null, 2).slice(0, 1200));
  } catch (e) {
    console.log('result raw', String(r.result_json).slice(0, 500));
  }
  console.log('payload', r.payload);
}
