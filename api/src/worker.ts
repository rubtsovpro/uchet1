/**
 * Worker Учёта №1: фон вне HTTP (Amo note queue).
 * Sync-deal pump живёт в API через enqueueSyncDealFromAmo1c (in-process).
 *
 *   node dist/worker.js
 *
 * На API при WMS_BACKGROUND_WORKER=1 не дублируется amo-note-queue.
 */
import { isPostgresSot, migrate, pgWarm } from './db.js';
import { ensurePgHotIndexes } from './pg-hot-indexes.js';
import { syncDealQueueStats } from './sync-deal-queue.js';

async function main(): Promise<void> {
  if (isPostgresSot()) {
    await pgWarm();
    await ensurePgHotIndexes();
  } else {
    migrate();
  }

  const runAmoNoteQueue = async () => {
    try {
      const { drainAmoLeadNoteQueue, amoLeadNoteQueueSize } = await import('./amo-note-queue.js');
      if ((await amoLeadNoteQueueSize()) <= 0) return;
      const { sendAmoLeadNoteOnce, sendAmoLeadTaskOnce } = await import('./amo-pick-handoff.js');
      const r = await drainAmoLeadNoteQueue({
        max: 1,
        sendNote: async (item) =>
          await sendAmoLeadNoteOnce({ dealId: item.deal_id, text: item.text }),
        sendTask: async (item) =>
          await sendAmoLeadTaskOnce({ dealId: item.deal_id, text: item.text }),
      });
      if (r.sent || r.dropped || r.deferred) {
        console.log(
          `[worker] amo-note-queue: sent=${r.sent} deferred=${r.deferred} dropped=${r.dropped} left=${r.left}`
        );
      }
    } catch (e) {
      console.warn('[worker] amo-note-queue', e instanceof Error ? e.message : e);
    }
  };

  setInterval(() => {
    void runAmoNoteQueue();
  }, 45_000);
  setTimeout(() => {
    void runAmoNoteQueue();
  }, 8_000);

  setInterval(() => {
    try {
      const s = syncDealQueueStats();
      if (s.pending > 0 || s.running > 0) {
        console.log('[worker] sync-queue (API process owns pump)', s);
      }
    } catch {
      /* ignore */
    }
  }, 60_000);

  console.log('[worker] WMS background worker up', {
    sot: isPostgresSot() ? 'postgres' : 'sqlite',
    sync_note: 'amo-note-queue drain only; deal sync stays in API enqueue',
  });
}

main().catch((e) => {
  console.error('[worker] fatal', e instanceof Error ? e.message : e);
  process.exit(1);
});
