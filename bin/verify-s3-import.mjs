#!/usr/bin/env node
/** Post-import verify + finish onlyMissing media sync. */
import { migrate } from '../dist/db.js';
import { syncMediaFrom1c, mediaSyncMeta } from '../dist/media.js';
import { DatabaseSync } from 'node:sqlite';

migrate();
const before = mediaSyncMeta();
console.log('before', JSON.stringify(before));
const r = await syncMediaFrom1c({ limit: 50, onlyMissing: true });
console.log('onlyMissing', JSON.stringify(r));
console.log('after_meta', JSON.stringify(mediaSyncMeta()));

const db = new DatabaseSync((process.env.WMS_DATA_DIR || './data') + '/warehouse.sqlite', {
  readOnly: true,
});
const sample = db
  .prepare(`SELECT product_id, s3_key, url FROM product_media WHERE s3_key LIKE 'image/catalog/%' LIMIT 1`)
  .get();
console.log('sample', JSON.stringify(sample));

const pid = '586bcf20-11ee-11eb-9098-fa163e6e5787';
const imgs = db
  .prepare(
    `SELECT sort_order, s3_key, size FROM product_media WHERE product_id=? AND kind='image' ORDER BY sort_order`
  )
  .all(pid);
console.log('rescued', imgs.length, JSON.stringify(imgs.slice(0, 3)));

const q = (sql) => db.prepare(sql).get().c;
console.log(
  JSON.stringify(
    {
      images: q(`SELECT COUNT(*) AS c FROM product_media WHERE kind='image'`),
      with_image: q(`SELECT COUNT(DISTINCT product_id) AS c FROM product_media WHERE kind='image'`),
      from_catalog: q(`SELECT COUNT(*) AS c FROM product_media WHERE s3_key LIKE 'image/catalog/%'`),
      from_wms: q(`SELECT COUNT(*) AS c FROM product_media WHERE s3_key LIKE 'wms/products/%'`),
      empty: q(`SELECT COUNT(*) AS c FROM product_media WHERE kind='empty'`),
      missing: q(
        `SELECT COUNT(*) AS c FROM products p WHERE p.is_active=1 AND NOT EXISTS (SELECT 1 FROM product_media m WHERE m.product_id=p.id)`
      ),
    },
    null,
    2
  )
);

if (sample?.url) {
  const res = await fetch(sample.url, { method: 'HEAD', signal: AbortSignal.timeout(15000) });
  console.log('sample_http', res.status, res.headers.get('content-type'), res.headers.get('content-length'));
}
