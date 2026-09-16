/**
 * In-process Postgres pool (no worker / Atomics bridge).
 * Hot path for WMS_SOURCE_OF_TRUTH=postgres.
 */
import type { Pool, PoolClient, QueryResultRow } from 'pg';
import { toPgSql, isSqliteOnlySql, parsePragmaTableInfo } from './sql-pg-rewrite.js';

export type PgRow = Record<string, unknown>;
type SqlParam = string | number | bigint | null | Uint8Array | boolean;

let pool: Pool | null = null;
/** Sticky client while BEGIN…COMMIT/ROLLBACK (pool.query would drop the tx). */
let txClient: PoolClient | null = null;
let txDepth = 0;

function pgUrl(): string {
  const url = String(process.env.WMS_PG_URL || process.env.DATABASE_URL || '').trim();
  if (!url) throw new Error('WMS_PG_URL required for postgres SoT');
  return url;
}

export async function pgPool(): Promise<Pool> {
  if (pool) return pool;
  const { Pool: PgPool } = await import('pg');
  pool = new PgPool({
    connectionString: pgUrl(),
    max: Math.max(2, Number(process.env.WMS_PG_POOL_MAX || 8) || 8),
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 15_000,
  });
  await pool.query('SELECT 1');
  console.log('[db] postgres in-process pool ready · max=%s', pool.options.max);
  return pool;
}

export async function pgWarm(): Promise<void> {
  await pgPool();
}

function mapParams(params: SqlParam[]): unknown[] {
  return (params || []).map((x) => (typeof x === 'bigint' ? Number(x) : x));
}

async function execQuery<T extends QueryResultRow = PgRow>(
  sql: string,
  params: SqlParam[]
): Promise<{ rows: T[]; rowCount: number }> {
  const pragmaTable = parsePragmaTableInfo(sql);
  if (pragmaTable) {
    const p = await pgPool();
    const r = await (txClient || p).query<T>(
      `SELECT
         (ordinal_position - 1)::int AS cid,
         column_name AS name,
         data_type AS type,
         CASE WHEN is_nullable = 'NO' THEN 1 ELSE 0 END AS notnull,
         column_default AS dflt_value,
         0 AS pk
       FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = $1
       ORDER BY ordinal_position`,
      [pragmaTable]
    );
    return { rows: r.rows, rowCount: r.rowCount ?? r.rows.length };
  }
  if (isSqliteOnlySql(sql)) {
    return { rows: [], rowCount: 0 };
  }
  const p = await pgPool();
  const q = toPgSql(sql);
  const args = mapParams(params);
  const r = await (txClient || p).query<T>(q, args);
  return { rows: r.rows, rowCount: r.rowCount ?? r.rows.length };
}

export async function pgAll<T extends PgRow = PgRow>(
  sql: string,
  params: SqlParam[] = []
): Promise<T[]> {
  const { rows } = await execQuery<T>(sql, params);
  return rows;
}

export async function pgGet<T extends PgRow = PgRow>(
  sql: string,
  params: SqlParam[] = []
): Promise<T | undefined> {
  const { rows } = await execQuery<T>(sql, params);
  return rows[0];
}

export async function pgRun(sql: string, params: SqlParam[] = []): Promise<number> {
  const trimmed = String(sql || '').trim();
  if (/^BEGIN\b/i.test(trimmed)) {
    if (txClient) {
      txDepth += 1;
      return 0;
    }
    const p = await pgPool();
    txClient = await p.connect();
    txDepth = 1;
    try {
      await txClient.query('BEGIN');
    } catch (e) {
      txClient.release();
      txClient = null;
      txDepth = 0;
      throw e;
    }
    return 0;
  }
  if (/^COMMIT\b/i.test(trimmed)) {
    if (!txClient) return 0;
    txDepth = Math.max(0, txDepth - 1);
    if (txDepth > 0) return 0;
    try {
      await txClient.query('COMMIT');
    } finally {
      txClient.release();
      txClient = null;
    }
    return 0;
  }
  if (/^ROLLBACK\b/i.test(trimmed)) {
    if (!txClient) return 0;
    try {
      await txClient.query('ROLLBACK');
    } finally {
      txClient.release();
      txClient = null;
      txDepth = 0;
    }
    return 0;
  }
  const { rowCount } = await execQuery(sql, params);
  return rowCount;
}

export async function pgExec(sql: string): Promise<void> {
  await pgRun(sql, []);
}
