/**
 * Очередь синка сделок Amo → Учёт в **том же** Node-процессе.
 * Отдельный sync-deal-cli держал второе подключение к SQLite и валил WMS.
 */
/** 0 = аварийно выключить фоновый export (UI не трогаем). */
const MAX_CONCURRENT = Math.max(
  0,
  Math.min(2, Number(process.env.WMS_SYNC_MAX_CONCURRENT ?? 1) || 0)
);

/** Макс. время PHP export одной сделки (мс). */
const SYNC_TIMEOUT_MS = Math.max(
  10_000,
  Math.min(90_000, Number(process.env.WMS_SYNC_CHILD_TIMEOUT_MS || 45_000) || 45_000)
);

const pending: string[] = [];
const seen = new Set<string>();
let running = 0;
let pumping = false;

async function runOne(dealId: string): Promise<void> {
  try {
    const { syncDealsFromAmo1cAsync } = await import('./deals.js');
    await syncDealsFromAmo1cAsync({ dealId, limit: 1 }, SYNC_TIMEOUT_MS);
  } catch (e) {
    console.error('[sync-deal-queue]', dealId, e instanceof Error ? e.message : e);
  }
}

async function pump(): Promise<void> {
  if (pumping) return;
  pumping = true;
  try {
    while (running < MAX_CONCURRENT && pending.length > 0) {
      const id = pending.shift();
      if (!id) break;
      running++;
      void runOne(id).finally(() => {
        running = Math.max(0, running - 1);
        seen.delete(id);
        void pump();
      });
    }
  } finally {
    pumping = false;
  }
}

/** Полный export через amo1c (новая сделка / нет в WMS / нужны позиции). */
export function enqueueSyncDealFromAmo1c(dealId: string): void {
  if (MAX_CONCURRENT <= 0) return;
  const id = String(dealId || '')
    .replace(/\D/g, '')
    .trim();
  if (!id || seen.has(id)) return;
  seen.add(id);
  pending.push(id);
  void pump();
}

export function syncDealQueueStats(): { pending: number; running: number; max: number } {
  return { pending: pending.length, running, max: MAX_CONCURRENT };
}
