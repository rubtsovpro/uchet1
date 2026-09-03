/**
 * Минимальный S3-клиент (AWS SigV4) для FirstVDS / Ceph.
 * Совместим с PHP S3Client из avito/shop.
 */
import { createHmac, createHash } from 'node:crypto';
import { request as httpsRequest } from 'node:https';
import { URL } from 'node:url';

export type S3Config = {
  endpoint: string;
  region: string;
  bucket: string;
  accessKey: string;
  secretKey: string;
  publicBaseUrl: string;
  /** false = https://bucket.s3.firstvds.ru/key (как у shop) */
  pathStyle: boolean;
};

export function s3ConfigFromEnv(): S3Config | null {
  const endpoint = (process.env.S3_ENDPOINT || '').trim();
  const bucket = (process.env.S3_BUCKET || '').trim();
  const accessKey = (process.env.S3_ACCESS_KEY || '').trim();
  const secretKey = (process.env.S3_SECRET_KEY || '').trim();
  if (!endpoint || !bucket || !accessKey || !secretKey) return null;
  return {
    endpoint: endpoint.replace(/\/$/, ''),
    region: (process.env.S3_REGION || 'default').trim(),
    bucket,
    accessKey,
    secretKey,
    publicBaseUrl: (process.env.S3_PUBLIC_BASE_URL || `https://${bucket}.s3.firstvds.ru`).replace(
      /\/$/,
      ''
    ),
    pathStyle: (process.env.S3_PATH_STYLE || 'false').toLowerCase() === 'true',
  };
}

function sha256Hex(data: string | Buffer): string {
  return createHash('sha256').update(data).digest('hex');
}

function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac('sha256', key).update(data, 'utf8').digest();
}

function signingKey(secret: string, dateStamp: string, region: string): Buffer {
  const kDate = hmac(`AWS4${secret}`, dateStamp);
  const kRegion = hmac(kDate, region);
  const kService = hmac(kRegion, 's3');
  return hmac(kService, 'aws4_request');
}

function encodeKey(key: string): string {
  return key
    .split('/')
    .map((p) => encodeURIComponent(p))
    .join('/');
}

export function s3PublicUrl(cfg: S3Config, key: string): string {
  const k = key.replace(/^\//, '');
  if (cfg.publicBaseUrl) return `${cfg.publicBaseUrl}/${k}`;
  if (!cfg.pathStyle) return `https://${cfg.bucket}.${cfg.endpoint.replace(/^https?:\/\//, '')}/${encodeKey(k)}`;
  return `${cfg.endpoint}/${encodeURIComponent(cfg.bucket)}/${encodeKey(k)}`;
}

function objectUrl(cfg: S3Config, key: string): URL {
  const k = key.replace(/^\//, '');
  if (cfg.pathStyle) {
    return new URL(`${cfg.endpoint}/${encodeURIComponent(cfg.bucket)}/${encodeKey(k)}`);
  }
  const host = `${cfg.bucket}.${cfg.endpoint.replace(/^https?:\/\//, '')}`;
  return new URL(`https://${host}/${encodeKey(k)}`);
}

export async function s3PutObject(
  cfg: S3Config,
  key: string,
  body: Buffer,
  contentType: string,
  publicRead = true
): Promise<string> {
  const k = key.replace(/^\//, '');
  const url = objectUrl(cfg, k);
  const amzDate = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  const dateStamp = amzDate.slice(0, 8);
  const payloadHash = sha256Hex(body);
  const host = url.host;

  const headers: Record<string, string> = {
    host,
    'content-type': contentType || 'application/octet-stream',
    'content-length': String(body.length),
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': amzDate,
  };
  if (publicRead) headers['x-amz-acl'] = 'public-read';

  const signedNames = Object.keys(headers).sort();
  const canonicalHeaders = signedNames.map((n) => `${n}:${headers[n].trim().replace(/\s+/g, ' ')}\n`).join('');
  const signedHeaders = signedNames.join(';');
  const canonicalRequest = [
    'PUT',
    url.pathname,
    '',
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n');

  const scope = `${dateStamp}/${cfg.region}/s3/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256Hex(canonicalRequest)].join('\n');
  const signature = createHmac('sha256', signingKey(cfg.secretKey, dateStamp, cfg.region))
    .update(stringToSign, 'utf8')
    .digest('hex');
  const authorization = `AWS4-HMAC-SHA256 Credential=${cfg.accessKey}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  await new Promise<void>((resolve, reject) => {
    const reqHeaders: Record<string, string> = {
      Authorization: authorization,
      'Content-Type': headers['content-type'],
      'Content-Length': headers['content-length'],
      'x-amz-content-sha256': payloadHash,
      'x-amz-date': amzDate,
    };
    if (publicRead) reqHeaders['x-amz-acl'] = 'public-read';

    const req = httpsRequest(
      {
        protocol: url.protocol,
        hostname: url.hostname,
        port: url.port || 443,
        path: url.pathname + url.search,
        method: 'PUT',
        headers: reqHeaders,
        timeout: 120_000,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const code = res.statusCode || 0;
          if (code < 200 || code >= 300) {
            reject(
              new Error(`S3 put HTTP ${code}: ${Buffer.concat(chunks).toString('utf8').slice(0, 200)}`)
            );
            return;
          }
          resolve();
        });
      }
    );
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('S3 put timeout'));
    });
    req.write(body);
    req.end();
  });

  return s3PublicUrl(cfg, k);
}

/** Скачать объект (для private вложений чатов). */
export async function s3GetObject(
  cfg: S3Config,
  key: string
): Promise<{ body: Buffer; contentType: string }> {
  const k = key.replace(/^\//, '');
  const url = objectUrl(cfg, k);
  const amzDate = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  const dateStamp = amzDate.slice(0, 8);
  const payloadHash = sha256Hex('');
  const host = url.host;

  const headers: Record<string, string> = {
    host,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': amzDate,
  };

  const signedNames = Object.keys(headers).sort();
  const canonicalHeaders = signedNames.map((n) => `${n}:${headers[n].trim().replace(/\s+/g, ' ')}\n`).join('');
  const signedHeaders = signedNames.join(';');
  const canonicalRequest = [
    'GET',
    url.pathname,
    '',
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n');

  const scope = `${dateStamp}/${cfg.region}/s3/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256Hex(canonicalRequest)].join('\n');
  const signature = createHmac('sha256', signingKey(cfg.secretKey, dateStamp, cfg.region))
    .update(stringToSign, 'utf8')
    .digest('hex');
  const authorization = `AWS4-HMAC-SHA256 Credential=${cfg.accessKey}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  return new Promise((resolve, reject) => {
    const req = httpsRequest(
      {
        protocol: url.protocol,
        hostname: url.hostname,
        port: url.port || 443,
        path: url.pathname + url.search,
        method: 'GET',
        headers: {
          Authorization: authorization,
          'x-amz-content-sha256': payloadHash,
          'x-amz-date': amzDate,
        },
        timeout: 120_000,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const code = res.statusCode || 0;
          if (code < 200 || code >= 300) {
            reject(
              new Error(`S3 get HTTP ${code}: ${Buffer.concat(chunks).toString('utf8').slice(0, 200)}`)
            );
            return;
          }
          const contentType =
            (res.headers['content-type'] as string) || 'application/octet-stream';
          resolve({ body: Buffer.concat(chunks), contentType });
        });
      }
    );
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('S3 get timeout'));
    });
    req.end();
  });
}

/** Удалить объект (тихий no-op при 404). */
export async function s3DeleteObject(cfg: S3Config, key: string): Promise<void> {
  const k = key.replace(/^\//, '');
  const url = objectUrl(cfg, k);
  const amzDate = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  const dateStamp = amzDate.slice(0, 8);
  const payloadHash = sha256Hex('');
  const host = url.host;

  const headers: Record<string, string> = {
    host,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': amzDate,
  };

  const signedNames = Object.keys(headers).sort();
  const canonicalHeaders = signedNames.map((n) => `${n}:${headers[n].trim().replace(/\s+/g, ' ')}\n`).join('');
  const signedHeaders = signedNames.join(';');
  const canonicalRequest = [
    'DELETE',
    url.pathname,
    '',
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n');

  const scope = `${dateStamp}/${cfg.region}/s3/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256Hex(canonicalRequest)].join('\n');
  const signature = createHmac('sha256', signingKey(cfg.secretKey, dateStamp, cfg.region))
    .update(stringToSign, 'utf8')
    .digest('hex');
  const authorization = `AWS4-HMAC-SHA256 Credential=${cfg.accessKey}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  await new Promise<void>((resolve, reject) => {
    const req = httpsRequest(
      {
        protocol: url.protocol,
        hostname: url.hostname,
        port: url.port || 443,
        path: url.pathname + url.search,
        method: 'DELETE',
        headers: {
          Authorization: authorization,
          'x-amz-content-sha256': payloadHash,
          'x-amz-date': amzDate,
        },
        timeout: 60_000,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const code = res.statusCode || 0;
          if (code === 404 || code === 204 || (code >= 200 && code < 300)) {
            resolve();
            return;
          }
          reject(
            new Error(`S3 delete HTTP ${code}: ${Buffer.concat(chunks).toString('utf8').slice(0, 200)}`)
          );
        });
      }
    );
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('S3 delete timeout'));
    });
    req.end();
  });
}

export function detectMediaType(buf: Buffer): { ext: string; mime: string; kind: 'image' | 'document' | 'file' } {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return { ext: 'jpg', mime: 'image/jpeg', kind: 'image' };
  }
  if (buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) {
    return { ext: 'png', mime: 'image/png', kind: 'image' };
  }
  if (buf.length >= 4 && buf.slice(0, 4).toString('ascii') === '%PDF') {
    return { ext: 'pdf', mime: 'application/pdf', kind: 'document' };
  }
  if (buf.length >= 12 && buf.slice(0, 4).toString('ascii') === 'RIFF' && buf.slice(8, 12).toString('ascii') === 'WEBP') {
    return { ext: 'webp', mime: 'image/webp', kind: 'image' };
  }
  if (buf.length >= 6 && (buf.slice(0, 6).toString('ascii') === 'GIF87a' || buf.slice(0, 6).toString('ascii') === 'GIF89a')) {
    return { ext: 'gif', mime: 'image/gif', kind: 'image' };
  }
  return { ext: 'bin', mime: 'application/octet-stream', kind: 'file' };
}
