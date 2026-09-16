/**
 * Сквозные номера по сделке:
 * — С{deal} / С{deal}-2… — перемещение (и связанное складское задание)
 * Первое без суффикса, следующие -2, -3…
 */
import { all, get, run } from './db.js';
import { newGuid } from './ids.js';

function cleanDealId(dealId: string): string {
  return String(dealId || '')
    .trim()
    .replace(/[^\w.-]/g, '');
}

/** Порядковый номер перемещения по сделке (1 = первое). */
export async function nextTransferSeq(dealId: string): Promise<number> {
  const deal = cleanDealId(dealId);
  if (!deal) return 1;
  const n =
    (await get<{ c: number }>(
      `SELECT COUNT(*) AS c FROM sto_transfer_requests WHERE deal_id = ?`,
      [deal]
    ))?.c ?? 0;
  return n + 1;
}

/** С25496085 или С25496085-2; без сделки — пусто. */
export function formatTransferNumber(dealId: string, seq: number): string {
  const deal = cleanDealId(dealId);
  if (!deal) return '';
  const s = Math.max(1, Math.floor(Number(seq) || 1));
  return s <= 1 ? `С${deal}` : `С${deal}-${s}`;
}

export async function nextTransferNumber(dealId: string): Promise<string> {
  const deal = cleanDealId(dealId);
  if (!deal) return '';
  return formatTransferNumber(deal, await nextTransferSeq(deal));
}

/** @deprecated совместимость — перемещение всегда С */
export type DealDocKind = 'P' | 'S';

export function formatDealDocNumber(kind: DealDocKind, dealId: string, seq: number): string {
  void kind;
  return formatTransferNumber(dealId, seq);
}

export async function nextDealDocNumber(kind: DealDocKind, dealId: string): Promise<string> {
  void kind;
  return await nextTransferNumber(dealId);
}

export async function nextDealDocSeq(kind: DealDocKind, dealId: string): Promise<number> {
  void kind;
  return await nextTransferSeq(dealId);
}

export async function ensureStoTransferEventsSchema() {
  await run(`
    CREATE TABLE IF NOT EXISTS sto_transfer_request_events (
      id TEXT PRIMARY KEY,
      request_id TEXT NOT NULL,
      event TEXT NOT NULL DEFAULT '',
      actor_id TEXT NOT NULL DEFAULT '',
      actor_name TEXT NOT NULL DEFAULT '',
      summary TEXT NOT NULL DEFAULT '',
      payload_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_sto_xfer_events_req
      ON sto_transfer_request_events(request_id, created_at);
  `);
}

export async function logStoTransferEvent(input: {
  request_id: string;
  event: string;
  summary?: string;
  actor_id?: string;
  actor_name?: string;
  payload?: Record<string, unknown>;
}) {
  const requestId = String(input.request_id || '').trim();
  if (!requestId) return;
  await ensureStoTransferEventsSchema();
  await run(
    `INSERT INTO sto_transfer_request_events
      (id, request_id, event, actor_id, actor_name, summary, payload_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
    [
      newGuid(),
      requestId,
      String(input.event || '').trim() || 'note',
      String(input.actor_id || ''),
      String(input.actor_name || ''),
      String(input.summary || '').trim(),
      JSON.stringify(input.payload || {}),
    ]
  );
}

export async function listStoTransferEvents(requestId: string, limit = 40) {
  await ensureStoTransferEventsSchema();
  const id = String(requestId || '').trim();
  if (!id) return [];
  return await all(
    `SELECT * FROM sto_transfer_request_events
     WHERE request_id = ?
     ORDER BY datetime(created_at) DESC
     LIMIT ?`,
    [id, Math.min(100, Math.max(1, limit))]
  );
}

/** Переименовать П… → С… и выровнять складские задания под номер перемещения. */
export async function backfillDealDocNumbers(opts?: { deal_id?: string }) {
  const dealFilter = String(opts?.deal_id || '').trim();
  const reqs = await all<{ id: string; deal_id: string; number: string; warehouse_task_id: string }>(
    dealFilter
      ? `SELECT id, deal_id, number, IFNULL(warehouse_task_id,'') AS warehouse_task_id
         FROM sto_transfer_requests WHERE deal_id = ?
         ORDER BY datetime(created_at) ASC`
      : `SELECT id, deal_id, number, IFNULL(warehouse_task_id,'') AS warehouse_task_id
         FROM sto_transfer_requests
         WHERE IFNULL(deal_id,'') != ''
         ORDER BY deal_id, datetime(created_at) ASC`,
    dealFilter ? [dealFilter] : []
  );
  const seqP = new Map<string, number>();
  let renamedTransfers = 0;
  let renamedTasks = 0;
  for (const r of reqs) {
    const deal = cleanDealId(r.deal_id);
    if (!deal) continue;
    const seq = (seqP.get(deal) || 0) + 1;
    seqP.set(deal, seq);
    const want = formatTransferNumber(deal, seq);
    if (String(r.number) !== want) {
      await run(`UPDATE sto_transfer_requests SET number = ?, updated_at = datetime('now') WHERE id = ?`, [
        want,
        r.id,
      ]);
      renamedTransfers += 1;
    }
    // складское задание по перемещению = тот же СXXXX
    const taskId = String(r.warehouse_task_id || '').trim();
    if (taskId) {
      const t = await get<{ number: string; comment: string }>(
        `SELECT IFNULL(number,'') AS number, IFNULL(comment,'') AS comment FROM warehouse_tasks WHERE id = ?`,
        [taskId]
      );
      if (t && String(t.number) !== want) {
        await run(
          `UPDATE warehouse_tasks SET number = ?, barcode = ?, updated_at = datetime('now') WHERE id = ?`,
          [want, want.replace(/-/g, ''), taskId]
        );
        renamedTasks += 1;
      }
      // в комментарии тоже не оставляем СТО-00010 / П…
      if (t) {
        let cmt = String(t.comment || '');
        // без \b: в JS граница слова не работает с кириллицей
        const next = cmt.replace(/СТО-\d+/gi, want).replace(/(^|[^\p{L}\p{N}])П(\d[\w-]*)/gu, '$1С$2');
        if (next !== cmt) {
          await run(`UPDATE warehouse_tasks SET comment = ?, updated_at = datetime('now') WHERE id = ?`, [
            next,
            taskId,
          ]);
        }
      }
    }
    // на всякий — задания, связанные через stock_doc_id / track
    const linked = await all<{ id: string; number: string }>(
      `SELECT id, IFNULL(number,'') AS number FROM warehouse_tasks
       WHERE channel = 'sto_parts'
         AND (stock_doc_id = ? OR track_number = ?)
         AND id != ?`,
      [r.id, r.id, taskId || '']
    );
    for (const t of linked) {
      if (String(t.number) !== want) {
        await run(
          `UPDATE warehouse_tasks SET number = ?, barcode = ?, updated_at = datetime('now') WHERE id = ?`,
          [want, want.replace(/-/g, ''), t.id]
        );
        renamedTasks += 1;
      }
    }
  }
  return { renamed_transfers: renamedTransfers, renamed_tasks: renamedTasks };
}
