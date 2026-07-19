/**
 * Сделки / воронки AmoCRM → Анти1С (через amo1c export).
 */
import { execFileSync } from 'node:child_process';
import { all, get, run } from './db.js';

const DEFAULT_EXPORT =
  process.env.AMO1C_DEALS_EXPORT
  || '/root/amo1c_pnevmopodveska1_ru/public_html/bin/export_deals_for_wms.php';

export type DealExport = {
  ok?: boolean;
  pipelines?: Array<{
    id: string;
    name: string;
    sort?: number;
    is_archive?: boolean;
    statuses?: Array<{
      id: string;
      name: string;
      sort?: number;
      color?: string;
    }>;
  }>;
  deals?: Array<Record<string, unknown>>;
};

function loadExport(scriptPath = DEFAULT_EXPORT, extraArgs: string[] = []): DealExport {
  const out = execFileSync('php', [scriptPath, ...extraArgs], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    timeout: 180_000,
  });
  return JSON.parse(out) as DealExport;
}

export function dealsMeta() {
  return {
    pipelines: get<{ c: number }>('SELECT COUNT(*) AS c FROM crm_pipelines')?.c ?? 0,
    statuses: get<{ c: number }>('SELECT COUNT(*) AS c FROM crm_pipeline_statuses')?.c ?? 0,
    deals: get<{ c: number }>('SELECT COUNT(*) AS c FROM crm_deals')?.c ?? 0,
    withItems:
      get<{ c: number }>(
        `SELECT COUNT(DISTINCT deal_id) AS c FROM crm_deal_items`
      )?.c ?? 0,
    queued:
      get<{ c: number }>('SELECT COUNT(*) AS c FROM crm_deals WHERE queued_to_1c = 1')?.c ?? 0,
    lastSync:
      get<{ value: string }>('SELECT value FROM meta WHERE key = ?', ['deals_synced_at'])?.value
      ?? null,
  };
}

function upsertPipeline(pl: {
  id: string;
  name: string;
  sort?: number;
  is_archive?: boolean;
  statuses?: Array<{ id: string; name: string; sort?: number; color?: string }>;
}): void {
  run(
    `INSERT INTO crm_pipelines (id, name, sort, is_archive)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       name=excluded.name, sort=excluded.sort, is_archive=excluded.is_archive`,
    [pl.id, pl.name || pl.id, pl.sort ?? 0, pl.is_archive ? 1 : 0]
  );
  for (const st of pl.statuses || []) {
    run(
      `INSERT INTO crm_pipeline_statuses (id, pipeline_id, name, sort, color)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         pipeline_id=excluded.pipeline_id, name=excluded.name,
         sort=excluded.sort, color=excluded.color`,
      [
        `${pl.id}:${st.id}`,
        pl.id,
        st.name || st.id,
        st.sort ?? 0,
        st.color || '',
      ]
    );
  }
}

export function upsertDealRecord(d: Record<string, unknown>): void {
  const id = String(d.id || '').trim();
  if (!id) return;
  const items = Array.isArray(d.items) ? d.items : [];
  run(
    `INSERT INTO crm_deals (
       id, name, price, pipeline_id, pipeline_name, status_id, status_name,
       responsible_user_id, department, queued_to_1c, queue_status, queued_by, queued_at,
       amo_url, print_url, items_count,
       company_id, company_name, buyer_name, buyer_inn, buyer_phone, buyer_kind, is_legal_entity,
       created_at, updated_at, synced_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(id) DO UPDATE SET
       name=excluded.name, price=excluded.price,
       pipeline_id=excluded.pipeline_id, pipeline_name=excluded.pipeline_name,
       status_id=excluded.status_id, status_name=excluded.status_name,
       responsible_user_id=excluded.responsible_user_id, department=excluded.department,
       queued_to_1c=excluded.queued_to_1c, queue_status=excluded.queue_status,
       queued_by=excluded.queued_by, queued_at=excluded.queued_at,
       amo_url=excluded.amo_url, print_url=excluded.print_url,
       items_count=excluded.items_count,
       company_id=excluded.company_id, company_name=excluded.company_name,
       buyer_name=excluded.buyer_name, buyer_inn=excluded.buyer_inn,
       buyer_phone=excluded.buyer_phone, buyer_kind=excluded.buyer_kind,
       is_legal_entity=excluded.is_legal_entity,
       created_at=COALESCE(excluded.created_at, crm_deals.created_at),
       updated_at=excluded.updated_at, synced_at=datetime('now')`,
    [
      id,
      String(d.name || ''),
      Number(d.price) || 0,
      String(d.pipeline_id || ''),
      String(d.pipeline_name || ''),
      String(d.status_id || ''),
      String(d.status_name || ''),
      String(d.responsible_user_id || ''),
      String(d.department || ''),
      d.queued_to_1c ? 1 : 0,
      String(d.queue_status || ''),
      String(d.queued_by || ''),
      d.queued_at ? String(d.queued_at) : null,
      String(d.amo_url || ''),
      String(d.print_url || ''),
      items.length || Number(d.items_count) || 0,
      String(d.company_id || ''),
      String(d.company_name || ''),
      String(d.buyer_name || ''),
      String(d.buyer_inn || ''),
      String(d.buyer_phone || ''),
      String(d.buyer_kind || 'person'),
      Number(d.is_legal_entity) === 1 || String(d.buyer_kind || '') === 'legal' ? 1 : 0,
      d.created_at ? String(d.created_at) : null,
      d.updated_at ? String(d.updated_at) : new Date().toISOString(),
    ]
  );

  run('DELETE FROM crm_deal_items WHERE deal_id = ?', [id]);
  let lineNo = 0;
  for (const raw of items) {
    const it = raw as Record<string, unknown>;
    lineNo += 1;
    const itemId = String(it.id || `${id}:${lineNo}`);
    run(
      `INSERT INTO crm_deal_items (
         id, deal_id, product_guid, sku, code, name, brand, price, qty, amount, unit, department, note, line_no
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        itemId,
        id,
        String(it.product_guid || ''),
        String(it.sku || ''),
        String(it.code || ''),
        String(it.name || ''),
        String(it.brand || ''),
        Number(it.price) || 0,
        Number(it.qty) || 0,
        Number(it.amount) || 0,
        String(it.unit || ''),
        String(it.department || ''),
        String(it.note || ''),
        lineNo,
      ]
    );
  }
}

export function syncDealsFromAmo1c(opts: {
  days?: number;
  limit?: number;
  dealId?: string;
  scriptPath?: string;
} = {}): {
  pipelines: number;
  deals: number;
  withAmo: number;
  seconds: number;
} {
  const t0 = Date.now();
  const args: string[] = [];
  if (opts.days) args.push(`--days=${opts.days}`);
  if (opts.limit) args.push(`--limit=${opts.limit}`);
  if (opts.dealId) args.push(`--deal=${opts.dealId}`);
  const exp = loadExport(opts.scriptPath || DEFAULT_EXPORT, args);

  for (const pl of exp.pipelines || []) {
    upsertPipeline(pl);
  }
  for (const d of exp.deals || []) {
    upsertDealRecord(d);
  }

  run('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)', [
    'deals_synced_at',
    new Date().toISOString(),
  ]);

  return {
    pipelines: (exp.pipelines || []).length,
    deals: (exp.deals || []).length,
    withAmo: Number((exp as { counts?: { with_amo?: number } }).counts?.with_amo || 0),
    seconds: Math.round((Date.now() - t0) / 1000),
  };
}

export function listPipelines() {
  const pipes = all(
    `SELECT id, name, sort, is_archive FROM crm_pipelines ORDER BY sort, name`
  );
  const statuses = all(
    `SELECT id, pipeline_id, name, sort, color FROM crm_pipeline_statuses ORDER BY sort, name`
  );
  const byPipe = new Map<string, typeof statuses>();
  for (const st of statuses) {
    const pid = String(st.pipeline_id);
    const list = byPipe.get(pid) || [];
    list.push(st);
    byPipe.set(pid, list);
  }
  return pipes.map((p) => ({
    ...p,
    statuses: byPipe.get(String(p.id)) || [],
    deals_count:
      get<{ c: number }>('SELECT COUNT(*) AS c FROM crm_deals WHERE pipeline_id = ?', [
        String(p.id),
      ])?.c ?? 0,
  }));
}

export function listDeals(opts: {
  q?: string;
  pipelineId?: string;
  statusId?: string;
  page?: number;
  limit?: number;
}) {
  const page = Math.max(1, opts.page || 1);
  const limit = Math.min(100, Math.max(1, opts.limit || 50));
  const offset = (page - 1) * limit;
  const where: string[] = [];
  const params: Array<string | number> = [];
  if (opts.pipelineId) {
    where.push('pipeline_id = ?');
    params.push(opts.pipelineId);
  }
  if (opts.statusId) {
    where.push('status_id = ?');
    params.push(opts.statusId);
  }
  if (opts.q) {
    where.push(`(name LIKE ? OR id LIKE ? OR IFNULL(department,'') LIKE ?)`);
    const like = `%${opts.q}%`;
    params.push(like, like, like);
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const total =
    get<{ c: number }>(`SELECT COUNT(*) AS c FROM crm_deals ${whereSql}`, params)?.c ?? 0;
  const items = all(
    `SELECT * FROM crm_deals ${whereSql}
     ORDER BY datetime(COALESCE(queued_at, updated_at, created_at)) DESC
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

export function getDeal(id: string) {
  const deal = get('SELECT * FROM crm_deals WHERE id = ?', [id]);
  if (!deal) return null;
  const items = all(
    `SELECT * FROM crm_deal_items WHERE deal_id = ? ORDER BY line_no, name`,
    [id]
  );
  // PDF / docs from product_media for line products
  const docs: Array<Record<string, unknown>> = [];
  for (const it of items) {
    const guid = String(it.product_guid || '');
    if (!guid) continue;
    const media = all(
      `SELECT id, kind, mime, ext, url, size, orientation, width, height
       FROM product_media WHERE product_id = ? AND kind = 'document'
       ORDER BY sort_order`,
      [guid]
    );
    for (const m of media) {
      docs.push({ ...m, product_guid: guid, sku: it.sku, product_name: it.name });
    }
  }
  return {
    ...deal,
    items,
    documents: docs,
    sales_docs: all(
      `SELECT id, doc_type, number, doc_date, total, status, created_at
       FROM sales_docs WHERE deal_id = ? ORDER BY datetime(created_at) DESC`,
      [id]
    ),
    payments: all(
      `SELECT id, kind, amount, status, qrc_id, payload, account, purpose, created_at,
              CASE WHEN length(image_png_base64)>0 THEN 1 ELSE 0 END AS has_image
       FROM deal_payments WHERE deal_id = ? ORDER BY datetime(created_at) DESC LIMIT 20`,
      [id]
    ),
    fiscal_receipts: all(
      `SELECT id, kind, status, amount, atol_uuid, external_id, error, created_at, updated_at
       FROM fiscal_receipts WHERE deal_id = ? ORDER BY datetime(created_at) DESC LIMIT 20`,
      [id]
    ),
    is_legal_entity: Number(deal.is_legal_entity) === 1 || String(deal.buyer_kind) === 'legal',
  };
}
