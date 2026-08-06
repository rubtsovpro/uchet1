#!/usr/bin/env node
/**
 * Импорт фото из S3 image/catalog/{guid}_image_{n}.* → product_media.
 * Не качает и не перезаливает файлы — только линкует публичные URL в БД.
 * Пропускает не-фото (html/php/ico/video).
 *
 * Usage (on VPS):
 *   set -a; source /etc/warehouse-wms.env; set +a
 *   cd /root/1c_pnevmopodveska1_ru/warehouse
 *   node --experimental-sqlite bin/import-s3-catalog-photos.mjs
 *   node --experimental-sqlite bin/import-s3-catalog-photos.mjs --dry-run
 */
import { createHmac, createHash } from 'node:crypto';
import { request as httpsRequest } from 'node:https';
import { URL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { s3ConfigFromEnv, s3PublicUrl } from '../dist/s3.js';

const dryRun = process.argv.includes('--dry-run');
const PREFIX = 'image/catalog/';
const PHOTO_RE =
  /^image\/catalog\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})_image_(\d+)\.(jpe?g|png|gif|webp)$/i;

const MIME = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
};

const cfg = s3ConfigFromEnv();
if (!cfg) {
  console.error('S3 not configured');
  process.exit(1);
}

const dataDir = process.env.WMS_DATA_DIR || './data';
const db = new DatabaseSync(`${dataDir}/warehouse.sqlite`);
db.exec('PRAGMA busy_timeout = 30000');

function sha256Hex(data) {
  return createHash('sha256').update(data).digest('hex');
}

async function listAll(prefix) {
  const endpointHost = new URL(cfg.endpoint).host;
  const host = cfg.pathStyle ? endpointHost : `${cfg.bucket}.${endpointHost}`;
  const base = cfg.pathStyle
    ? `${cfg.endpoint.replace(/\/$/, '')}/${cfg.bucket}`
    : `https://${host}`;
  let token = null;
  const out = [];
  let pages = 0;
  do {
    const qs = new URLSearchParams({ 'list-type': '2', 'max-keys': '1000', prefix });
    if (token) qs.set('continuation-token', token);
    const url = `${base}?${qs}`;
    const u = new URL(url);
    const amzDate = new Date().toISOString().replace(/[:-]|\.\d{3}/g, '');
    const bodyHash = sha256Hex('');
    const canonicalQs = [...u.searchParams.entries()]
      .sort((a, b) => (a[0] < b[0] ? -1 : 1))
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
      .join('&');
    const canonicalHeaders = `host:${host}\nx-amz-content-sha256:${bodyHash}\nx-amz-date:${amzDate}\n`;
    const signedHeaders = 'host;x-amz-content-sha256;x-amz-date';
    const canonicalRequest = [
      'GET',
      u.pathname,
      canonicalQs,
      canonicalHeaders,
      signedHeaders,
      bodyHash,
    ].join('\n');
    const dateStamp = amzDate.slice(0, 8);
    const credentialScope = `${dateStamp}/${cfg.region}/s3/aws4_request`;
    const stringToSign = [
      'AWS4-HMAC-SHA256',
      amzDate,
      credentialScope,
      sha256Hex(canonicalRequest),
    ].join('\n');
    let k = createHmac('sha256', 'AWS4' + cfg.secretKey).update(dateStamp).digest();
    k = createHmac('sha256', k).update(cfg.region).digest();
    k = createHmac('sha256', k).update('s3').digest();
    k = createHmac('sha256', k).update('aws4_request').digest();
    const signature = createHmac('sha256', k).update(stringToSign).digest('hex');
    const auth = `AWS4-HMAC-SHA256 Credential=${cfg.accessKey}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

    const xml = await new Promise((resolve, reject) => {
      const req = httpsRequest(
        url,
        {
          method: 'GET',
          headers: {
            host,
            'x-amz-content-sha256': bodyHash,
            'x-amz-date': amzDate,
            Authorization: auth,
          },
        },
        (res) => {
          let d = '';
          res.on('data', (c) => (d += c));
          res.on('end', () => {
            if (res.statusCode >= 300) reject(new Error(res.statusCode + ' ' + d.slice(0, 400)));
            else resolve(d);
          });
        }
      );
      req.on('error', reject);
      req.end();
    });

    pages += 1;
    const keys = [...xml.matchAll(/<Key>([^<]+)<\/Key>/g)].map((m) => m[1]);
    const sizes = [...xml.matchAll(/<Size>(\d+)<\/Size>/g)].map((m) => Number(m[1]));
    for (let i = 0; i < keys.length; i++) out.push({ key: keys[i], size: sizes[i] || 0 });
    const next = xml.match(/<NextContinuationToken>([^<]+)<\/NextContinuationToken>/);
    const truncated = /<IsTruncated>true<\/IsTruncated>/.test(xml);
    token = truncated && next ? decodeURIComponent(next[1]) : null;
    if (pages % 10 === 0) console.error(`list ${prefix} pages=${pages} objects=${out.length}`);
  } while (token);
  return out;
}

const t0 = Date.now();
console.log(`===== S3 catalog photo import ${dryRun ? 'DRY-RUN ' : ''}start ${new Date().toISOString()} =====`);

const objects = await listAll(PREFIX);
const photos = [];
let skippedNonPhoto = 0;
for (const o of objects) {
  const m = o.key.match(PHOTO_RE);
  if (!m) {
    skippedNonPhoto += 1;
    continue;
  }
  photos.push({
    key: o.key,
    size: o.size,
    productId: m[1].toLowerCase(),
    sortOrder: Number(m[2]),
    ext: m[3].toLowerCase() === 'jpeg' ? 'jpg' : m[3].toLowerCase(),
  });
}

const productExists = db.prepare('SELECT 1 AS ok FROM products WHERE lower(id) = ? LIMIT 1');
const hasKey = db.prepare('SELECT 1 AS ok FROM product_media WHERE s3_key = ? LIMIT 1');
const insert = db.prepare(`
  INSERT INTO product_media (
    id, product_id, kind, mime, ext, s3_key, url, size, sha256, sort_order,
    width, height, orientation
  ) VALUES (?, ?, 'image', ?, ?, ?, ?, ?, ?, ?, 0, 0, '')
  ON CONFLICT(id) DO UPDATE SET
    url=excluded.url, s3_key=excluded.s3_key, size=excluded.size,
    sort_order=excluded.sort_order, synced_at=datetime('now')
`);
const delEmpty = db.prepare(
  `DELETE FROM product_media WHERE product_id = ? AND kind = 'empty'`
);

let linked = 0;
let skippedExists = 0;
let skippedNoProduct = 0;
let failed = 0;
const touchedProducts = new Set();

const tx = db.prepare('BEGIN');
const commit = db.prepare('COMMIT');
const rollback = db.prepare('ROLLBACK');

if (!dryRun) tx.run();
try {
  for (const p of photos) {
    try {
      if (!productExists.get(p.productId)) {
        skippedNoProduct += 1;
        continue;
      }
      if (hasKey.get(p.key)) {
        skippedExists += 1;
        continue;
      }
      const id = `${p.productId}|s3cat:${p.key}`;
      const url = s3PublicUrl(cfg, p.key);
      const mime = MIME[p.ext] || 'image/jpeg';
      const sha = createHash('sha256').update(`s3:${p.key}`).digest('hex');
      if (!dryRun) {
        insert.run(
          id,
          p.productId,
          mime,
          p.ext,
          p.key,
          url,
          p.size,
          sha,
          p.sortOrder
        );
        delEmpty.run(p.productId);
      }
      linked += 1;
      touchedProducts.add(p.productId);
      if (linked % 500 === 0) {
        console.log(`progress linked=${linked}/${photos.length}`);
      }
    } catch (e) {
      failed += 1;
      console.warn('fail', p.key, e instanceof Error ? e.message : e);
    }
  }
  if (!dryRun) {
    db.prepare(
      `INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)`
    ).run('media_s3_catalog_imported_at', new Date().toISOString());
    commit.run();
  }
} catch (e) {
  if (!dryRun) rollback.run();
  throw e;
}

const stats = {
  dryRun,
  listed: objects.length,
  photos: photos.length,
  skippedNonPhoto,
  linked,
  skippedExists,
  skippedNoProduct,
  failed,
  productsTouched: touchedProducts.size,
  seconds: Math.round((Date.now() - t0) / 1000),
};

if (!dryRun) {
  const after = {
    images: db.prepare(`SELECT COUNT(*) AS c FROM product_media WHERE kind = 'image'`).get().c,
    with_image: db
      .prepare(`SELECT COUNT(DISTINCT product_id) AS c FROM product_media WHERE kind = 'image'`)
      .get().c,
    empty: db.prepare(`SELECT COUNT(*) AS c FROM product_media WHERE kind = 'empty'`).get().c,
  };
  stats.after = after;
}

console.log('DONE', JSON.stringify(stats, null, 2));
console.log(`===== S3 catalog photo import done ${new Date().toISOString()} =====`);
