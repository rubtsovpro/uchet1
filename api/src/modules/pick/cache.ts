/**
 * MVC · pick list cache (Redis + memory).
 * Same JSON payloads as stockReturnsForPick / warehouseHandoffsForPick.
 */
import { cacheDel, cacheGetJson, cacheSetJson } from '../redis.js';

export const PICK_LIST_TTL_MS = 5_000;

export async function pickCacheGet<T>(key: string): Promise<T | null> {
  return cacheGetJson<T>(`pick:${key}`);
}

export async function pickCacheSet(key: string, value: unknown, ttlMs = PICK_LIST_TTL_MS): Promise<void> {
  await cacheSetJson(`pick:${key}`, value, ttlMs);
}

export async function pickCacheInvalidate(): Promise<void> {
  await cacheDel('pick:*');
}
