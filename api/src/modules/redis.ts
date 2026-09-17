/**
 * Redis cache for WMS hot paths.
 * If Redis is down / unset — in-memory Map fallback (same process only).
 * Env: WMS_REDIS_URL=redis://127.0.0.1:6379 (default when Redis installed)
 */
import { createClient, type RedisClientType } from 'redis';

type MemEntry = { exp: number; raw: string };

const mem = new Map<string, MemEntry>();
const MEM_MAX = 2000;

let client: RedisClientType | null = null;
let connecting: Promise<void> | null = null;
let disabled = false;

function redisUrl(): string {
  const u = String(process.env.WMS_REDIS_URL || '').trim();
  if (u) return u;
  // Default local Redis when not explicitly disabled
  if (String(process.env.WMS_REDIS || '1').trim() === '0') return '';
  return 'redis://127.0.0.1:6379';
}

async function ensureClient(): Promise<RedisClientType | null> {
  if (disabled) return null;
  const url = redisUrl();
  if (!url) {
    disabled = true;
    return null;
  }
  if (client?.isOpen) return client;
  if (connecting) {
    await connecting;
    return client?.isOpen ? client : null;
  }
  connecting = (async () => {
    try {
      const c = createClient({
        url,
        socket: {
          connectTimeout: 1500,
          reconnectStrategy: (retries) => (retries > 8 ? false : Math.min(500 * retries, 3000)),
        },
      });
      c.on('error', (err) => {
        console.warn('[redis]', err instanceof Error ? err.message : err);
      });
      await c.connect();
      client = c as RedisClientType;
      console.log('[redis] connected', url.replace(/\/\/.*@/, '//***@'));
    } catch (e) {
      console.warn('[redis] unavailable — memory fallback', e instanceof Error ? e.message : e);
      client = null;
      disabled = true;
    } finally {
      connecting = null;
    }
  })();
  await connecting;
  return client?.isOpen ? client : null;
}

function memGet(key: string): string | null {
  const hit = mem.get(key);
  if (!hit) return null;
  if (Date.now() > hit.exp) {
    mem.delete(key);
    return null;
  }
  return hit.raw;
}

function memSet(key: string, raw: string, ttlMs: number): void {
  if (mem.size >= MEM_MAX) {
    const first = mem.keys().next().value;
    if (first) mem.delete(first);
  }
  mem.set(key, { exp: Date.now() + Math.max(100, ttlMs), raw });
}

export async function cacheGetJson<T>(key: string): Promise<T | null> {
  const k = `wms:${key}`;
  try {
    const c = await ensureClient();
    if (c) {
      const raw = await c.get(k);
      if (raw == null) return null;
      return JSON.parse(raw) as T;
    }
  } catch {
    /* fall through */
  }
  const raw = memGet(k);
  if (raw == null) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export async function cacheSetJson(key: string, value: unknown, ttlMs: number): Promise<void> {
  const k = `wms:${key}`;
  const raw = JSON.stringify(value);
  const sec = Math.max(1, Math.ceil(ttlMs / 1000));
  try {
    const c = await ensureClient();
    if (c) {
      await c.setEx(k, sec, raw);
      return;
    }
  } catch {
    /* fall through */
  }
  memSet(k, raw, ttlMs);
}

export async function cacheDel(keyOrPrefix: string): Promise<void> {
  const k = keyOrPrefix.startsWith('wms:') ? keyOrPrefix : `wms:${keyOrPrefix}`;
  try {
    const c = await ensureClient();
    if (c) {
      if (k.endsWith('*')) {
        const keys = await c.keys(k);
        if (keys.length) await c.del(keys);
      } else {
        await c.del(k);
      }
    }
  } catch {
    /* ignore */
  }
  if (k.endsWith('*')) {
    const pref = k.slice(0, -1);
    for (const mk of [...mem.keys()]) {
      if (mk.startsWith(pref)) mem.delete(mk);
    }
  } else {
    mem.delete(k);
  }
}

/** Invalidate pick list caches (returns + handoffs). */
export async function invalidatePickCaches(): Promise<void> {
  await cacheDel('pick:*');
  for (const mk of [...mem.keys()]) {
    if (mk.includes('pick:')) mem.delete(mk);
  }
}

export async function redisHealth(): Promise<{ ok: boolean; mode: 'redis' | 'memory'; lag_ms?: number }> {
  const t0 = Date.now();
  try {
    const c = await ensureClient();
    if (c) {
      const pong = await c.ping();
      return { ok: pong === 'PONG', mode: 'redis', lag_ms: Date.now() - t0 };
    }
  } catch {
    /* */
  }
  return { ok: true, mode: 'memory', lag_ms: Date.now() - t0 };
}
