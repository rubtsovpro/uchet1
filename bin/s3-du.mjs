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

async function listPage(prefix, token) {
  const endpointHost = new URL(cfg.endpoint).host;
  const host = cfg.pathStyle ? endpointHost : `${cfg.bucket}.${endpointHost}`;
  const base = cfg.pathStyle ? `${cfg.endpoint.replace(/\/$/, '')}/${cfg.bucket}` : `https://${host}`;
  const qs = new URLSearchParams({ 'list-type': '2', 'max-keys': '1000' });
  if (prefix) qs.set('prefix', prefix);
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

  const sizes = [...xml.matchAll(/<Size>(\d+)<\/Size>/g)].map((m) => Number(m[1]));
  const next = xml.match(/<NextContinuationToken>([^<]+)<\/NextContinuationToken>/);
  const truncated = /<IsTruncated>true<\/IsTruncated>/.test(xml);
  return {
    bytes: sizes.reduce((a, b) => a + b, 0),
    count: sizes.length,
    next: next ? decodeURIComponent(next[1]) : null,
    truncated,
  };
}

async function measure(prefix) {
  let token = null;
  let total = 0;
  let count = 0;
  let pages = 0;
  do {
    const page = await listPage(prefix, token);
    total += page.bytes;
    count += page.count;
    pages += 1;
    token = page.truncated ? page.next : null;
    if (pages % 25 === 0) {
      console.error(`… ${prefix || '(all)'} pages=${pages} objects=${count} gb=${(total / 1e9).toFixed(2)}`);
    }
    if (pages > 2000) break;
  } while (token);
  return { prefix: prefix || '(all)', objects: count, bytes: total, gb: +(total / 1024 / 1024 / 1024).toFixed(3), pages };
}

console.log('bucket', cfg.bucket, cfg.endpoint);
for (const prefix of ['warehouse/', 'media/', '']) {
  try {
    const r = await measure(prefix);
    console.log(JSON.stringify(r));
    if (prefix === '' || r.objects > 0) {
      // if root listing works and warehouse empty, still print
    }
  } catch (e) {
    console.log(JSON.stringify({ prefix: prefix || '(all)', error: String(e.message || e) }));
  }
}
