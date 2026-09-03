import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { get, all } = require('../dist/db.js');

const id = '25761404';
const d = get(
  `SELECT id, name, IFNULL(buyer_name,'') AS buyer, IFNULL(buyer_phone,'') AS phone,
          IFNULL(buyer_email,'') AS email, IFNULL(amo_channel,'') AS ch,
          IFNULL(status_name,'') AS st, IFNULL(price,0) AS price,
          IFNULL(responsible_user_id,'') AS rid, IFNULL(amo_branch,'') AS branch
   FROM crm_deals WHERE id = ?`,
  [id]
);
console.log('deal', d);

const pays = all(
  `SELECT id, amount, status, IFNULL(method,'') AS method, created_at,
          IFNULL(comment,'') AS comment, IFNULL(external_id,'') AS external_id
   FROM deal_payments WHERE deal_id = ? ORDER BY created_at DESC LIMIT 10`,
  [id]
);
console.log('payments', pays);

const fisc = all(
  `SELECT id, kind, status, amount, external_id, IFNULL(error,'') AS error, created_at
   FROM fiscal_receipts WHERE deal_id = ? ORDER BY created_at DESC LIMIT 10`,
  [id]
);
console.log('fiscal', fisc);

const items = all(
  `SELECT sku, name, qty, price FROM crm_deal_items WHERE deal_id = ? ORDER BY line_no LIMIT 20`,
  [id]
);
console.log('items', items.length, items.slice(0, 5));
