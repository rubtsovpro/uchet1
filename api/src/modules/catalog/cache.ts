/**
 * Redis TTL for hot catalog reads (suggest + stock-totals).
 * Miss → DB; Redis down → memory fallback via modules/redis.
 */
import { cacheDel, cacheGetJson, cacheSetJson } from '../redis.js';

export const PRODUCTS_SUGGEST_TTL_MS = 8_000;
export const STOCK_TOTALS_TTL_MS = 12_000;

export async function productsSuggestCacheGet<T>(key: string): Promise<T | null> {
  return cacheGetJson<T>(`products:sug:${key}`);
}

export async function productsSuggestCacheSet(
  key: string,
  value: unknown,
  ttlMs = PRODUCTS_SUGGEST_TTL_MS
): Promise<void> {
  await cacheSetJson(`products:sug:${key}`, value, ttlMs);
}

export async function stockTotalsCacheGet<T>(): Promise<T | null> {
  return cacheGetJson<T>('warehouses:stock-totals');
}

export async function stockTotalsCacheSet(
  value: unknown,
  ttlMs = STOCK_TOTALS_TTL_MS
): Promise<void> {
  await cacheSetJson('warehouses:stock-totals', value, ttlMs);
}

export async function invalidateCatalogCaches(): Promise<void> {
  await cacheDel('products:sug:*');
  await cacheDel('warehouses:stock-totals');
}
