#!/usr/bin/env node
/** Count S3 objects under prefixes (photos vs other). */
import { s3ConfigFromEnv } from '../dist/s3.js';
import { createHmac, createHash } from 'node:crypto';
import { request as httpsRequest } from 'node:https';
import { URL } from 'node:url';

const cfg = s3ConfigFromEnv();
if (!cfg) {
  console.error('no s3 config');
  process.exit(1);
}

function sha256Hex(data) {
  return createHash('sha256').update(data).digest('hex');
}

async function signedGet(qsObj) {
  const endpointHost = new URL(cfg.endpoint).host;
  const host = cfg.pathStyle ? endpointHost : `${cfg.bucket}.${endpointHost}`;
  const base = cfg.pathStyle
    ? `${cfg.endpoint.replace(/\/$/, '')}/${cfg.bucket}`
    : `https://${host}`;
  const qs = new URLSearchParams(qsObj);
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

  return new Promise((resolve, reject) => {
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
}

async function topPrefixes() {
  const xml = await signedGet({ 'list-type': '2', 'max-keys': '1000', delimiter: '/' });
  const prefs = [...xml.matchAll(/<Prefix>([^<]+)<\/Prefix>/g)].map((m) => m[1]).filter(Boolean);
  return [...new Set(prefs)];
}

async function countPrefix(prefix) {
  let token = null;
  let total = 0;
  let photos = 0;
  let bytes = 0;
  let pages = 0;
  const otherExt = new Map();
  do {
    const qs = { 'list-type': '2', 'max-keys': '1000', prefix };
    if (token) qs['continuation-token'] = token;
    const xml = await signedGet(qs);
    pages += 1;
    const keys = [...xml.matchAll(/<Key>([^<]+)<\/Key>/g)].map((m) => m[1]);
    const sizes = [...xml.matchAll(/<Size>(\d+)<\/Size>/g)].map((m) => Number(m[1]));
    for (let i = 0; i < keys.length; i++) {
      const key = keys[i];
      total += 1;
      bytes += sizes[i] || 0;
      if (/\.(jpe?g|png|gif|webp)$/i.test(key)) photos += 1;
      else {
        const ext = (key.split('.').pop() || 'none').toLowerCase();
        otherExt.set(ext, (otherExt.get(ext) || 0) + 1);
      }
    }
    const next = xml.match(/<NextContinuationToken>([^<]+)<\/NextContinuationToken>/);
    const truncated = /<IsTruncated>true<\/IsTruncated>/.test(xml);
    token = truncated && next ? decodeURIComponent(next[1]) : null;
    if (pages % 25 === 0) {
      console.error(`… ${prefix} pages=${pages} total=${total} photos=${photos}`);
    }
    if (pages > 5000) break;
  } while (token);
  return {
    prefix,
    pages,
    total,
    photos,
    other: total - photos,
    gb: +(bytes / 1e9).toFixed(3),
    otherExt: Object.fromEntries(otherExt),
  };
}

console.log('bucket', cfg.bucket);
const tops = await topPrefixes();
console.log('top_prefixes', JSON.stringify(tops));
for (const p of ['wms/products/', ...tops.filter((t) => t !== 'wms/')]) {
  try {
    console.log(JSON.stringify(await countPrefix(p)));
  } catch (e) {
    console.log(JSON.stringify({ prefix: p, error: String(e.message || e) }));
  }
}
