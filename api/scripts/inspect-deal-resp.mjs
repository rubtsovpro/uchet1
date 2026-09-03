import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { get, all } = require('../dist/db.js');

const ids = ['25745318', '25742894', '25713770', '25643945', '25737036', '25734452'];
const cols = all(`PRAGMA table_info(crm_deals)`).map((c) => c.name);
console.log(
  'resp cols',
  cols.filter((n) => /resp/i.test(n))
);

for (const id of ids) {
  const d = get(
    `SELECT id,
            IFNULL(responsible_user_id,'') AS rid,
            IFNULL(buyer_name,'') AS buyer,
            IFNULL(amo_channel,'') AS ch,
            IFNULL(name,'') AS name
     FROM crm_deals WHERE id = ?`,
    [id]
  );
  const st = d?.rid
    ? get(`SELECT amo_id, name, IFNULL(is_active,1) AS a FROM staff WHERE amo_id = ?`, [d.rid])
    : null;
  console.log(JSON.stringify({ id, rid: d?.rid || '', buyer: d?.buyer, ch: d?.ch, name: d?.name, staff: st }));
}

// staff without match but deals have rid?
const empty = all(
  `SELECT d.id, IFNULL(d.responsible_user_id,'') AS rid
   FROM crm_deals d
   WHERE d.id IN (${ids.map(() => '?').join(',')})
     AND (
       IFNULL(d.responsible_user_id,'') = ''
       OR NOT EXISTS (SELECT 1 FROM staff s WHERE s.amo_id = d.responsible_user_id AND IFNULL(s.name,'') != '')
     )`,
  ids
);
console.log('empty/unmatched', empty);
