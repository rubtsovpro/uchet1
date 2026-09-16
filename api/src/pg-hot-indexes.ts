/**
 * Hot-path indexes for Postgres SoT.
 * SQLite migrate() never ran against PG — only PKs exist on prod.
 */
import { isPostgresSot, run } from './db.js';

const INDEXES: Array<{ name: string; sql: string }> = [
  {
    name: 'idx_stock_docs_deal',
    sql: `CREATE INDEX IF NOT EXISTS idx_stock_docs_deal ON stock_docs (deal_id)`,
  },
  {
    name: 'idx_stock_docs_posted_created',
    sql: `CREATE INDEX IF NOT EXISTS idx_stock_docs_posted_created ON stock_docs (posted, created_at DESC)`,
  },
  {
    name: 'idx_stock_docs_type_date',
    sql: `CREATE INDEX IF NOT EXISTS idx_stock_docs_type_date ON stock_docs (doc_type, doc_date)`,
  },
  {
    name: 'idx_stock_doc_lines_product',
    sql: `CREATE INDEX IF NOT EXISTS idx_stock_doc_lines_product ON stock_doc_lines (product_id)`,
  },
  {
    name: 'idx_stock_doc_lines_doc',
    sql: `CREATE INDEX IF NOT EXISTS idx_stock_doc_lines_doc ON stock_doc_lines (doc_id)`,
  },
  {
    name: 'idx_crm_deals_amo_branch',
    sql: `CREATE INDEX IF NOT EXISTS idx_crm_deals_amo_branch ON crm_deals (amo_branch)`,
  },
  {
    name: 'idx_crm_deals_pipe',
    sql: `CREATE INDEX IF NOT EXISTS idx_crm_deals_pipe ON crm_deals (pipeline_id, status_id)`,
  },
  {
    name: 'idx_crm_deals_org_co',
    sql: `CREATE INDEX IF NOT EXISTS idx_crm_deals_org_co ON crm_deals (org_company_id)`,
  },
  {
    name: 'idx_warehouses_pick_site',
    sql: `CREATE INDEX IF NOT EXISTS idx_warehouses_pick_site ON warehouses (pick_site)`,
  },
  {
    name: 'idx_wt_status_channel',
    sql: `CREATE INDEX IF NOT EXISTS idx_wt_status_channel ON warehouse_tasks (status, channel)`,
  },
  {
    name: 'idx_wt_stock_doc',
    sql: `CREATE INDEX IF NOT EXISTS idx_wt_stock_doc ON warehouse_tasks (stock_doc_id)`,
  },
];

let ensured = false;

/** Idempotent; safe on every boot (IF NOT EXISTS). */
export async function ensurePgHotIndexes(): Promise<{ created: string[]; skipped: boolean }> {
  if (!isPostgresSot()) return { created: [], skipped: true };
  if (ensured) return { created: [], skipped: true };
  const created: string[] = [];
  for (const idx of INDEXES) {
    try {
      await run(idx.sql);
      created.push(idx.name);
    } catch (e) {
      console.warn(
        '[pg-indexes]',
        idx.name,
        e instanceof Error ? e.message : e
      );
    }
  }
  ensured = true;
  if (created.length) {
    console.log('[pg-indexes] ensured', created.length, 'indexes');
  }
  return { created, skipped: false };
}
