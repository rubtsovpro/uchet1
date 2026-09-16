/**
 * Weak ETag + 304 for poll-heavy JSON endpoints (/pick, /courier).
 */
import { createHash } from 'node:crypto';
import type { Context } from 'hono';

export function weakEtagFromParts(parts: Array<string | number | null | undefined>): string {
  const h = createHash('sha1')
    .update(parts.map((p) => String(p ?? '')).join('\n'))
    .digest('hex')
    .slice(0, 20);
  return `W/"${h}"`;
}

/** Fingerprint list rows by id/status/(updated_at|version). */
export function listRowsEtag(
  rows: Array<Record<string, unknown>> | undefined,
  extra: Array<string | number | null | undefined> = []
): string {
  const parts: Array<string | number | null | undefined> = [...extra];
  for (const row of rows || []) {
    parts.push(
      `${row.id ?? row.deal_id ?? ''}:${row.status ?? ''}:${row.updated_at ?? row.version ?? row.qty ?? ''}`
    );
  }
  return weakEtagFromParts(parts);
}

export function jsonWithEtag(
  c: Context,
  body: unknown,
  etag: string,
  status: 200 = 200
): Response {
  c.header('ETag', etag);
  c.header('Cache-Control', 'private, no-cache');
  c.header('Vary', 'Cookie, Authorization');
  const inm = String(c.req.header('If-None-Match') || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (inm.length && inm.includes(etag)) {
    return c.body(null, 304);
  }
  return c.json(body, status);
}
