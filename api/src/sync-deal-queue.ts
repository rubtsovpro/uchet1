/**
 * Очередь фоновых sync-deal-cli: без лимита Amo-webhook валит VPS (десятки Node × ~80MB).
 */
import { spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const MAX_CONCURRENT = Math.max(
  1,
  Math.min(8, Number(process.env.WMS_SYNC_MAX_CONCURRENT || 3) || 3)
);

const pending: string[] = [];
const seen = new Set<string>();
let running = 0;

function pump(): void {
  while (running < MAX_CONCURRENT && pending.length > 0) {
    const id = pending.shift();
    if (!id) break;
    running++;
    spawnOne(id);
  }
}

function spawnOne(dealId: string): void {
  let child: ChildProcess | null = null;
  try {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const cli = path.join(here, 'sync-deal-cli.js');
    child = spawn(process.execPath, ['--experimental-sqlite', cli, dealId], {
      cwd: path.dirname(here),
      stdio: 'ignore',
      env: process.env,
    });
    child.unref();
  } catch (e) {
    console.error('[sync-deal-queue] spawn', dealId, e);
    running = Math.max(0, running - 1);
    pump();
    return;
  }
  const done = () => {
    running = Math.max(0, running - 1);
    pump();
  };
  child.on('exit', done);
  child.on('error', done);
}

/** Поставить сделку в очередь синка (дедуп в рамках процесса WMS). */
export function enqueueSyncDealFromAmo1c(dealId: string): void {
  const id = String(dealId || '')
    .replace(/\D/g, '')
    .trim();
  if (!id || seen.has(id)) return;
  seen.add(id);
  pending.push(id);
  pump();
}

export function syncDealQueueStats(): { pending: number; running: number; max: number } {
  return { pending: pending.length, running, max: MAX_CONCURRENT };
}
