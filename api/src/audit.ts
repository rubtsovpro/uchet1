import type { Context } from 'hono';
import { all, get, run } from './db.js';
import { newGuid } from './ids.js';
import { actorFromContext, type Actor } from './auth.js';

export type AuditInput = {
  action: string;
  entity?: string;
  entityId?: string;
  summary?: string;
  before?: unknown;
  after?: unknown;
  actor?: Actor | null;
  ip?: string;
};

function truncJson(v: unknown, max = 8000): string {
  if (v === undefined) return '';
  try {
    const s = JSON.stringify(v);
    return s.length > max ? s.slice(0, max) + '…' : s;
  } catch {
    return '';
  }
}

export function writeAudit(input: AuditInput): void {
  const actor = input.actor;
  run(
    `INSERT INTO audit_log
      (id, created_at, actor_id, actor_name, action, entity, entity_id, summary, before_json, after_json, ip)
     VALUES (?, datetime('now'), ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      newGuid(),
      actor?.id || '',
      actor?.name || 'система',
      input.action,
      input.entity || '',
      input.entityId || '',
      (input.summary || '').slice(0, 500),
      truncJson(input.before),
      truncJson(input.after),
      input.ip || '',
    ]
  );
}

export function auditFromContext(
  c: Context,
  input: Omit<AuditInput, 'actor' | 'ip'> & { actor?: Actor | null }
): void {
  const actor = input.actor !== undefined ? input.actor : actorFromContext(c);
  const ip =
    c.req.header('x-forwarded-for')?.split(',')[0]?.trim()
    || c.req.header('x-real-ip')
    || '';
  writeAudit({ ...input, actor, ip });
}

export function listAudit(opts: {
  q?: string;
  action?: string;
  entity?: string;
  entityId?: string;
  actorId?: string;
  page?: number;
  limit?: number;
}) {
  const page = Math.max(1, opts.page || 1);
  const limit = Math.min(200, Math.max(1, opts.limit || 50));
  const offset = (page - 1) * limit;
  const where: string[] = [];
  const params: Array<string | number> = [];
  if (opts.action) {
    where.push('action = ?');
    params.push(opts.action);
  }
  if (opts.entity) {
    where.push('entity = ?');
    params.push(opts.entity);
  }
  if (opts.entityId) {
    where.push('entity_id = ?');
    params.push(opts.entityId);
  }
  if (opts.actorId) {
    where.push('actor_id = ?');
    params.push(opts.actorId);
  }
  if (opts.q) {
    const like = `%${opts.q}%`;
    where.push(
      '(summary LIKE ? OR actor_name LIKE ? OR entity_id LIKE ? OR action LIKE ?)'
    );
    params.push(like, like, like, like);
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const total =
    get<{ c: number }>(`SELECT COUNT(*) AS c FROM audit_log ${whereSql}`, params)?.c ?? 0;
  const items = all(
    `SELECT * FROM audit_log ${whereSql}
     ORDER BY datetime(created_at) DESC
     LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );
  return {
    items,
    total,
    page,
    limit,
    pages: Math.max(1, Math.ceil(total / limit)),
  };
}
