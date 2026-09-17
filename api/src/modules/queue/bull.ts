/**
 * BullMQ job queues (Redis via ioredis). Soft-fail if Redis down.
 * Queue: wms-cache — invalidate pick/catalog / warm today.
 */
import { Queue, Worker, type ConnectionOptions, type JobsOptions } from 'bullmq';
import { redisUrl } from './redis-url.js';

export type CacheJob = {
  kind: 'pick_lists' | 'catalog' | 'pick_today';
};

let cacheQueue: Queue<CacheJob> | null = null;
let workersStarted = false;
let connOpts: ConnectionOptions | null | undefined;

function connection(): ConnectionOptions | null {
  if (connOpts !== undefined) return connOpts;
  const url = redisUrl();
  if (!url) {
    connOpts = null;
    return null;
  }
  try {
    const u = new URL(url);
    connOpts = {
      host: u.hostname || '127.0.0.1',
      port: Number(u.port || 6379) || 6379,
      password: u.password ? decodeURIComponent(u.password) : undefined,
      username: u.username ? decodeURIComponent(u.username) : undefined,
      maxRetriesPerRequest: null,
    };
  } catch {
    connOpts = { host: '127.0.0.1', port: 6379, maxRetriesPerRequest: null };
  }
  return connOpts;
}

export function getCacheQueue(): Queue<CacheJob> | null {
  const conn = connection();
  if (!conn) return null;
  if (!cacheQueue) {
    cacheQueue = new Queue<CacheJob>('wms-cache', {
      connection: conn,
      defaultJobOptions: {
        removeOnComplete: 100,
        removeOnFail: 50,
        attempts: 2,
        backoff: { type: 'fixed', delay: 1000 },
      },
    });
  }
  return cacheQueue;
}

export async function enqueueCacheJob(
  data: CacheJob,
  opts?: JobsOptions
): Promise<boolean> {
  try {
    const q = getCacheQueue();
    if (!q) return false;
    await q.add(data.kind, data, opts);
    return true;
  } catch (e) {
    console.warn('[bullmq] enqueue', e instanceof Error ? e.message : e);
    return false;
  }
}

/** Start workers in background process (worker.ts). Safe to call once. */
export function startBullWorkers(): void {
  if (workersStarted) return;
  const conn = connection();
  if (!conn) {
    console.log('[bullmq] skip workers — no Redis URL');
    return;
  }
  workersStarted = true;
  void (async () => {
    const { pickCacheInvalidate } = await import('../pick/index.js');
    const { invalidateCatalogCaches } = await import('../catalog/index.js');
    const { warmPickTodayCaches } = await import('../pick/routes.js');

    // eslint-disable-next-line no-new
    new Worker<CacheJob>(
      'wms-cache',
      async (job) => {
        if (job.data.kind === 'pick_lists') {
          await pickCacheInvalidate();
        } else if (job.data.kind === 'catalog') {
          await invalidateCatalogCaches();
        } else if (job.data.kind === 'pick_today') {
          warmPickTodayCaches();
        }
      },
      { connection: conn, concurrency: 2 }
    );
    console.log('[bullmq] wms-cache worker up');
  })();
}

export async function bullmqHealth(): Promise<{
  ok: boolean;
  mode: 'bullmq' | 'off';
  waiting?: number;
}> {
  try {
    const q = getCacheQueue();
    if (!q) return { ok: true, mode: 'off' };
    const counts = await q.getJobCounts('waiting', 'active', 'delayed');
    return {
      ok: true,
      mode: 'bullmq',
      waiting: (counts.waiting || 0) + (counts.delayed || 0) + (counts.active || 0),
    };
  } catch {
    return { ok: false, mode: 'off' };
  }
}
