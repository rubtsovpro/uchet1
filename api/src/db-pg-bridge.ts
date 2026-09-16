/**
 * Sync bridge to db-pg-worker via SharedArrayBuffer + Atomics.wait.
 * Keeps all/get/run synchronous for the existing codebase.
 */
import { Worker } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PAYLOAD_BYTES = Math.max(
  1_048_576,
  Number(process.env.WMS_PG_PAYLOAD_BYTES || 8_388_608) || 8_388_608
);

type Row = Record<string, unknown>;

let worker: Worker | null = null;
let seq = 1;
let ready = false;

function workerPath(): string {
  // dist/db-pg-worker.js after build; tsx can load .ts in dev
  const js = path.join(__dirname, 'db-pg-worker.js');
  return js;
}

function ensureWorker(): Worker {
  if (worker) return worker;
  const url = String(process.env.WMS_PG_URL || process.env.DATABASE_URL || '').trim();
  if (!url) throw new Error('WMS_PG_URL required for postgres SoT');
  const w = new Worker(workerPath(), {
    workerData: { url },
    env: { ...process.env, WMS_PG_URL: url },
  });
  w.on('error', (err) => {
    console.error('[db-pg-worker]', err);
    worker = null;
    ready = false;
  });
  w.on('exit', (code) => {
    console.warn('[db-pg-worker] exit', code);
    worker = null;
    ready = false;
  });
  worker = w;
  rawCall(w, 'ping', 'SELECT 1', []);
  ready = true;
  console.log('[db] postgres sync-bridge worker ready');
  return w;
}

function readPayload(buf: SharedArrayBuffer): unknown {
  const view = new Uint8Array(buf);
  const len = view[0]! | (view[1]! << 8) | (view[2]! << 16) | (view[3]! << 24);
  if (len <= 0 || len + 4 > view.length) throw new Error('pg bridge bad payload length');
  const json = Buffer.from(view.subarray(4, 4 + len)).toString('utf8');
  return JSON.parse(json);
}

function rawCall(
  w: Worker,
  op: 'all' | 'get' | 'run' | 'exec' | 'ping',
  sql: string,
  params: unknown[]
): unknown {
  const controlBuf = new SharedArrayBuffer(8);
  const control = new Int32Array(controlBuf);
  Atomics.store(control, 0, 0);
  const payload = new SharedArrayBuffer(PAYLOAD_BYTES);
  const id = seq++;
  w.postMessage({ id, op, sql, params, control: controlBuf, payload });
  const waitMs = Math.max(5_000, Number(process.env.WMS_PG_SYNC_WAIT_MS || 120_000) || 120_000);
  const wr = Atomics.wait(control, 0, 0, waitMs);
  if (wr === 'timed-out') {
    throw new Error(`pg bridge timeout after ${waitMs}ms · op=${op}`);
  }
  const status = Atomics.load(control, 0);
  const body = readPayload(payload) as {
    rows?: Row[];
    row?: Row | null;
    ok?: boolean;
    error?: string;
  };
  if (status === 2 || body.error) {
    throw new Error(body.error || 'pg bridge error');
  }
  return body;
}

function call(op: 'all' | 'get' | 'run' | 'exec' | 'ping', sql: string, params: unknown[]): unknown {
  return rawCall(ensureWorker(), op, sql, params);
}

export function pgAll<T extends Row = Row>(sql: string, params: unknown[] = []): T[] {
  const body = call('all', sql, params) as { rows: T[] };
  return body.rows || [];
}

export function pgGet<T extends Row = Row>(sql: string, params: unknown[] = []): T | undefined {
  const body = call('get', sql, params) as { row: T | null };
  return body.row == null ? undefined : body.row;
}

export function pgRun(sql: string, params: unknown[] = []): number {
  const body = call('run', sql, params) as { ok?: boolean; rowCount?: number };
  return Number(body.rowCount || 0);
}

export function pgExec(sql: string): void {
  call('exec', sql, []);
}

export function pgWarm(): void {
  ensureWorker();
}
