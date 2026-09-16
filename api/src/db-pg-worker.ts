/**
 * Worker thread: async `pg` pool. Main thread talks via Atomics.wait (sync API).
 */
import { parentPort, workerData } from 'node:worker_threads';
import { toPgSql, isSqliteOnlySql } from './sql-pg-rewrite.js';
import type { Pool } from 'pg';

type Ctrl = Int32Array;

type Req = {
  id: number;
  op: 'all' | 'get' | 'run' | 'exec' | 'ping';
  sql: string;
  params: unknown[];
  control: SharedArrayBuffer;
  payload: SharedArrayBuffer;
};

let pool: Pool | null = null;

async function getPool(): Promise<Pool> {
  if (pool) return pool;
  const { Pool: PgPool } = await import('pg');
  const url = String(workerData?.url || process.env.WMS_PG_URL || '');
  if (!url) throw new Error('WMS_PG_URL missing in pg worker');
  pool = new PgPool({
    connectionString: url,
    max: Math.max(2, Number(process.env.WMS_PG_POOL_PER_WORKER || 4) || 4),
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 15_000,
  });
  await pool.query('SELECT 1');
  return pool;
}

function writePayload(buf: SharedArrayBuffer, obj: unknown): number {
  const json = Buffer.from(JSON.stringify(obj), 'utf8');
  const view = new Uint8Array(buf);
  if (json.length + 4 > view.length) {
    throw new Error(`pg payload too large (${json.length} bytes)`);
  }
  // length prefix u32 LE
  view[0] = json.length & 0xff;
  view[1] = (json.length >> 8) & 0xff;
  view[2] = (json.length >> 16) & 0xff;
  view[3] = (json.length >> 24) & 0xff;
  view.set(json, 4);
  return json.length;
}

function notify(control: Ctrl, status: number, len: number): void {
  control[1] = len;
  Atomics.store(control, 0, status); // 1=ok, 2=err
  Atomics.notify(control, 0);
}

parentPort!.on('message', (msg: Req) => {
  void (async () => {
    const control = new Int32Array(msg.control);
    try {
      if (msg.op === 'ping') {
        await getPool();
        const len = writePayload(msg.payload, { ok: true });
        notify(control, 1, len);
        return;
      }
      if (isSqliteOnlySql(msg.sql)) {
        if (msg.op === 'all') {
          const len = writePayload(msg.payload, { rows: [] });
          notify(control, 1, len);
          return;
        }
        if (msg.op === 'get') {
          const len = writePayload(msg.payload, { row: null });
          notify(control, 1, len);
          return;
        }
        const len = writePayload(msg.payload, { ok: true, rowCount: 0 });
        notify(control, 1, len);
        return;
      }
      const p = await getPool();
      const sql = toPgSql(msg.sql);
      const params = (msg.params || []).map((x) =>
        typeof x === 'bigint' ? Number(x) : x
      );
      if (msg.op === 'run' || msg.op === 'exec') {
        const r = await p.query(sql, params);
        const len = writePayload(msg.payload, { ok: true, rowCount: r.rowCount ?? 0 });
        notify(control, 1, len);
        return;
      }
      const r = await p.query(sql, params);
      const body = msg.op === 'get' ? { row: r.rows[0] ?? null } : { rows: r.rows };
      const len = writePayload(msg.payload, body);
      notify(control, 1, len);
    } catch (e) {
      try {
        const len = writePayload(msg.payload, {
          error: e instanceof Error ? e.message : String(e),
        });
        notify(control, 2, len);
      } catch (e2) {
        control[1] = 0;
        Atomics.store(control, 0, 2);
        Atomics.notify(control, 0);
        parentPort!.postMessage({
          fatal: e2 instanceof Error ? e2.message : String(e2),
        });
      }
    }
  })();
});
