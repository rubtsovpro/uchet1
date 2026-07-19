import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const defaultDataDir = path.resolve(__dirname, '..', '..', 'data');
const logsDir = process.env.WMS_LOG_DIR
  || path.resolve(process.env.WMS_DATA_DIR || defaultDataDir, '..', 'logs');

export function catalogSyncLockPath(): string {
  return path.join(logsDir, 'catalog-sync.lock');
}

/** Сообщает media-full-sync, что идёт тяжёлый синк каталога — подождать. */
export function acquireCatalogSyncLock(reason = 'sync'): void {
  fs.mkdirSync(logsDir, { recursive: true });
  fs.writeFileSync(
    catalogSyncLockPath(),
    JSON.stringify({ at: new Date().toISOString(), reason, pid: process.pid }),
    'utf8'
  );
}

export function releaseCatalogSyncLock(): void {
  try {
    fs.unlinkSync(catalogSyncLockPath());
  } catch {
    /* ignore */
  }
}

export async function withCatalogSyncLock<T>(reason: string, fn: () => Promise<T>): Promise<T> {
  acquireCatalogSyncLock(reason);
  try {
    return await fn();
  } finally {
    releaseCatalogSyncLock();
  }
}
