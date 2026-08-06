/**
 * Полный журнал действий (KPI: кто / что / когда / с какого IP).
 * Пароли и секреты в before/after/meta не пишем.
 */
import type { Context } from 'hono';
import { all, get, run } from './db.js';
import { newGuid } from './ids.js';
import { actorFromContext, type Actor } from './auth.js';
import { clientMetaFromContext } from './client-meta.js';

const SECRET_KEY_RE =
  /pass(word)?|passwd|pwd|secret|token|api[_-]?key|authorization|cookie|pin_hash|password_hash/i;

export type AuditInput = {
  action: string;
  entity?: string;
  entityId?: string;
  summary?: string;
  before?: unknown;
  after?: unknown;
  meta?: unknown;
  path?: string;
  actor?: Actor | null;
  ip?: string;
  userAgent?: string;
};

function scrubValue(v: unknown, depth = 0): unknown {
  if (depth > 6) return '[…]';
  if (v == null) return v;
  if (Array.isArray(v)) return v.slice(0, 50).map((x) => scrubValue(x, depth + 1));
  if (typeof v === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      if (SECRET_KEY_RE.test(k)) {
        out[k] = '[скрыто]';
        continue;
      }
      out[k] = scrubValue(val, depth + 1);
    }
    return out;
  }
  if (typeof v === 'string' && v.length > 2000) return v.slice(0, 2000) + '…';
  return v;
}

function truncJson(v: unknown, max = 8000): string {
  if (v === undefined) return '';
  try {
    const s = JSON.stringify(scrubValue(v));
    return s.length > max ? s.slice(0, max) + '…' : s;
  } catch {
    return '';
  }
}

export function writeAudit(input: AuditInput): void {
  const actor = input.actor;
  run(
    `INSERT INTO audit_log
      (id, created_at, actor_id, actor_login, actor_name, action, entity, entity_id,
       summary, before_json, after_json, ip, user_agent, path, meta_json)
     VALUES (?, datetime('now'), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      newGuid(),
      actor?.id || '',
      (actor?.login || '').slice(0, 120),
      actor?.name || 'система',
      input.action,
      input.entity || '',
      input.entityId || '',
      (input.summary || '').slice(0, 500),
      truncJson(input.before),
      truncJson(input.after),
      (input.ip || '').slice(0, 64),
      (input.userAgent || '').slice(0, 400),
      (input.path || '').slice(0, 300),
      truncJson(input.meta, 4000),
    ]
  );
}

export function auditFromContext(
  c: Context,
  input: Omit<AuditInput, 'actor' | 'ip' | 'userAgent' | 'path'> & {
    actor?: Actor | null;
    path?: string;
    meta?: unknown;
  }
): void {
  const actor = input.actor !== undefined ? input.actor : actorFromContext(c);
  const { ip, ua } = clientMetaFromContext(c);
  const path =
    input.path
    || c.req.header('x-wms-path')
    || (() => {
      try {
        return new URL(c.req.url).pathname;
      } catch {
        return '';
      }
    })();
  writeAudit({
    ...input,
    actor,
    ip,
    userAgent: ua,
    path,
  });
}

/**
 * История по заказу покупателя: сделка + все УПД/счета/ЗН/договоры + расходные.
 */
export function listAuditForDeal(
  dealIdRaw: string,
  opts?: { page?: number; limit?: number }
) {
  const dealId = String(dealIdRaw || '').trim();
  const page = Math.max(1, opts?.page || 1);
  const limit = Math.min(200, Math.max(1, opts?.limit || 80));
  const offset = (page - 1) * limit;
  if (!dealId) {
    return { items: [] as Row[], total: 0, page, limit, pages: 1 };
  }
  const salesIds = all<{ id: string }>(
    `SELECT id FROM sales_docs WHERE deal_id = ?`,
    [dealId]
  ).map((r) => r.id);
  const stockIds = all<{ id: string }>(
    `SELECT id FROM stock_docs
     WHERE IFNULL(deal_id,'') = ? OR IFNULL(basis_order_id,'') = ?`,
    [dealId, dealId]
  ).map((r) => r.id);

  const orParts: string[] = ['(entity = ? AND entity_id = ?)'];
  const params: Array<string | number> = ['crm_deal', dealId];
  for (const sid of salesIds) {
    orParts.push('(entity = ? AND entity_id = ?)');
    params.push('sales_doc', sid);
  }
  for (const sid of stockIds) {
    orParts.push('(entity = ? AND entity_id = ?)');
    params.push('stock_doc', sid);
  }
  orParts.push(`(entity = 'deal_payment' AND (entity_id = ? OR summary LIKE ?))`);
  params.push(dealId, `%${dealId}%`);
  orParts.push(`(summary LIKE ?)`);
  params.push(`%сделка ${dealId}%`);

  const whereSql = `WHERE ${orParts.join(' OR ')}`;
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

type Row = Record<string, unknown>;

export function listAudit(opts: {
  q?: string;
  action?: string;
  entity?: string;
  entityId?: string;
  actorId?: string;
  day?: string;
  from?: string;
  to?: string;
  page?: number;
  limit?: number;
}) {
  const page = Math.max(1, opts.page || 1);
  const limit = Math.min(500, Math.max(1, opts.limit || 50));
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
  const day = (opts.day || '').trim().slice(0, 10);
  if (day && /^\d{4}-\d{2}-\d{2}$/.test(day)) {
    where.push(`date(created_at) = date(?)`);
    params.push(day);
  } else {
    const from = (opts.from || '').trim().slice(0, 10);
    const to = (opts.to || '').trim().slice(0, 10);
    if (from && /^\d{4}-\d{2}-\d{2}$/.test(from)) {
      where.push(`date(created_at) >= date(?)`);
      params.push(from);
    }
    if (to && /^\d{4}-\d{2}-\d{2}$/.test(to)) {
      where.push(`date(created_at) <= date(?)`);
      params.push(to);
    }
  }
  if (opts.q) {
    const like = `%${opts.q}%`;
    where.push(
      `(summary LIKE ? OR actor_name LIKE ? OR actor_login LIKE ? OR entity_id LIKE ? OR action LIKE ? OR ip LIKE ?)`
    );
    params.push(like, like, like, like, like, like);
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

/** KPI: число действий по сотруднику и дню (и опционально по типу action). */
export function auditKpi(opts?: {
  from?: string;
  to?: string;
  actorId?: string;
  days?: number;
}) {
  const days = Math.min(90, Math.max(1, opts?.days || 14));
  const where: string[] = [`datetime(created_at) >= datetime('now', ?)`];
  const params: Array<string | number> = [`-${days} days`];
  const from = (opts?.from || '').trim().slice(0, 10);
  const to = (opts?.to || '').trim().slice(0, 10);
  if (from && /^\d{4}-\d{2}-\d{2}$/.test(from)) {
    where.length = 0;
    params.length = 0;
    where.push(`date(created_at) >= date(?)`);
    params.push(from);
    if (to && /^\d{4}-\d{2}-\d{2}$/.test(to)) {
      where.push(`date(created_at) <= date(?)`);
      params.push(to);
    }
  } else if (to && /^\d{4}-\d{2}-\d{2}$/.test(to)) {
    where.push(`date(created_at) <= date(?)`);
    params.push(to);
  }
  if (opts?.actorId) {
    where.push('actor_id = ?');
    params.push(opts.actorId);
  }
  const whereSql = `WHERE ${where.join(' AND ')}`;
  const byStaffDay = all<{
    day: string;
    actor_id: string;
    actor_login: string;
    actor_name: string;
    actions: number;
  }>(
    `SELECT date(created_at) AS day,
            actor_id,
            MAX(actor_login) AS actor_login,
            MAX(actor_name) AS actor_name,
            COUNT(*) AS actions
     FROM audit_log
     ${whereSql}
     GROUP BY date(created_at), actor_id
     ORDER BY day DESC, actions DESC
     LIMIT 500`,
    params
  );
  const byAction = all<{ action: string; actions: number }>(
    `SELECT action, COUNT(*) AS actions
     FROM audit_log
     ${whereSql}
     GROUP BY action
     ORDER BY actions DESC
     LIMIT 40`,
    params
  );
  const totals = get<{ actions: number; people: number; days: number }>(
    `SELECT COUNT(*) AS actions,
            COUNT(DISTINCT CASE WHEN actor_id != '' THEN actor_id END) AS people,
            COUNT(DISTINCT date(created_at)) AS days
     FROM audit_log
     ${whereSql}`,
    params
  );
  return {
    note: 'KPI активности: сколько действий сделал каждый сотрудник за день (из журнала истории).',
    window_days: days,
    from: from || null,
    to: to || null,
    totals: {
      actions: totals?.actions || 0,
      people: totals?.people || 0,
      days: totals?.days || 0,
    },
    by_staff_day: byStaffDay,
    by_action: byAction,
  };
}
