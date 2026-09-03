/**
 * Очередь примечаний/задач в Amo: при лимите API не теряем — повторяем позже.
 * Хранение: meta.amo_lead_note_queue (JSON).
 */
import { get, run } from './db.js';
import { newGuid } from './ids.js';

const QUEUE_KEY = 'amo_lead_note_queue';
const MAX_ATTEMPTS = 80;
/** Мин. пауза между успешными/попытками слива (лимиты Amo). */
const MIN_GAP_MS = 2_500;

export type AmoLeadNoteQueueItem = {
  id: string;
  deal_id: string;
  text: string;
  kind: 'note' | 'task';
  attempts: number;
  next_at: string;
  last_error?: string;
  created_at: string;
  updated_at?: string;
};

type QueueSendFn = (item: AmoLeadNoteQueueItem) => Promise<{ ok: boolean; error?: string }>;

let drainBusy = false;
let lastAttemptAt = 0;

function nowIso(): string {
  return new Date().toISOString();
}

function loadQueue(): AmoLeadNoteQueueItem[] {
  const raw = String(
    get<{ value: string }>(`SELECT value FROM meta WHERE key = ?`, [QUEUE_KEY])?.value || ''
  ).trim();
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((x): x is AmoLeadNoteQueueItem => !!x && typeof x === 'object')
      .map((x) => {
        const kind: 'note' | 'task' = x.kind === 'task' ? 'task' : 'note';
        return {
          id: String(x.id || '').trim() || newGuid(),
          deal_id: String(x.deal_id || '').replace(/\D/g, ''),
          text: String(x.text || '').trim(),
          kind,
          attempts: Math.max(0, Number(x.attempts) || 0),
          next_at: String(x.next_at || nowIso()),
          last_error: x.last_error ? String(x.last_error) : undefined,
          created_at: String(x.created_at || nowIso()),
          updated_at: x.updated_at ? String(x.updated_at) : undefined,
        };
      })
      .filter((x) => x.deal_id && x.text);
  } catch {
    return [];
  }
}

function saveQueue(items: AmoLeadNoteQueueItem[]): void {
  run(
    `INSERT INTO meta (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    [QUEUE_KEY, JSON.stringify(items)]
  );
}

function parseRetrySec(error: string): number {
  const m = String(error || '').match(/повтор через\s+(\d+)/i);
  if (m) return Math.max(5, Math.min(600, Number(m[1]) || 30));
  const left = String(error || '').match(/left_sec["\s:]+(\d+)/i);
  if (left) return Math.max(5, Math.min(600, Number(left[1]) || 30));
  if (/лимит|429|блокировк|rate.?limit|backoff/i.test(error)) return 45;
  return 20;
}

function nextDelaySec(attempts: number, error: string): number {
  const fromErr = parseRetrySec(error);
  const exp = Math.min(600, 20 * Math.pow(1.45, Math.max(0, attempts - 1)));
  return Math.max(fromErr, Math.round(exp));
}

/** Поставить в очередь (дедуп: та же сделка + тот же текст). */
export function enqueueAmoLeadNote(opts: {
  dealId: string;
  text: string;
  kind?: 'note' | 'task';
  delaySec?: number;
  error?: string;
}): AmoLeadNoteQueueItem | null {
  const dealId = String(opts.dealId || '').replace(/\D/g, '');
  const text = String(opts.text || '').trim();
  if (!dealId || !text) return null;
  const kind = opts.kind === 'task' ? 'task' : 'note';
  const q = loadQueue();
  const existing = q.find((x) => x.deal_id === dealId && x.text === text && x.kind === kind);
  if (existing) {
    if (opts.error) existing.last_error = String(opts.error).slice(0, 400);
    existing.updated_at = nowIso();
    saveQueue(q);
    return existing;
  }
  const delay = Math.max(5, Number(opts.delaySec) || 30);
  const item: AmoLeadNoteQueueItem = {
    id: newGuid(),
    deal_id: dealId,
    text,
    kind,
    attempts: 0,
    next_at: new Date(Date.now() + delay * 1000).toISOString(),
    last_error: opts.error ? String(opts.error).slice(0, 400) : undefined,
    created_at: nowIso(),
    updated_at: nowIso(),
  };
  q.push(item);
  saveQueue(q);
  console.warn(
    `[amo-note-queue] enqueued deal=${dealId} kind=${kind} delay=${delay}s · ${text.slice(0, 80)}`
  );
  return item;
}

export function amoLeadNoteQueueSize(): number {
  return loadQueue().length;
}

export function listAmoLeadNoteQueue(): AmoLeadNoteQueueItem[] {
  return loadQueue();
}

/**
 * Слить очередь: по умолчанию 1 сообщение за тик (щадим лимиты Amo).
 */
export async function drainAmoLeadNoteQueue(opts?: {
  max?: number;
  sendNote?: QueueSendFn;
  sendTask?: QueueSendFn;
}): Promise<{ sent: number; deferred: number; dropped: number; left: number }> {
  if (drainBusy) {
    return { sent: 0, deferred: 0, dropped: 0, left: loadQueue().length };
  }
  drainBusy = true;
  let sent = 0;
  let deferred = 0;
  let dropped = 0;
  try {
    const max = Math.max(1, Math.min(5, Number(opts?.max) || 1));
    const gapLeft = MIN_GAP_MS - (Date.now() - lastAttemptAt);
    if (gapLeft > 0) {
      await new Promise((r) => setTimeout(r, gapLeft));
    }

    let q = loadQueue();
    const now = Date.now();
    const due = q
      .filter((x) => Date.parse(x.next_at) <= now)
      .sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at));

    for (const item of due.slice(0, max)) {
      lastAttemptAt = Date.now();
      const send = item.kind === 'task' ? opts?.sendTask : opts?.sendNote;
      if (!send) {
        deferred += 1;
        continue;
      }
      const result = await send(item);
      q = loadQueue();
      const idx = q.findIndex((x) => x.id === item.id);
      if (idx < 0) continue;

      if (result.ok) {
        q.splice(idx, 1);
        sent += 1;
        saveQueue(q);
        console.log(`[amo-note-queue] sent deal=${item.deal_id} · ${item.text.slice(0, 80)}`);
        continue;
      }

      const err = String(result.error || 'send failed');
      const attempts = (q[idx].attempts || 0) + 1;
      if (attempts >= MAX_ATTEMPTS) {
        q.splice(idx, 1);
        dropped += 1;
        saveQueue(q);
        console.error(
          `[amo-note-queue] dropped deal=${item.deal_id} after ${attempts} · ${err.slice(0, 160)}`
        );
        continue;
      }
      const delay = nextDelaySec(attempts, err);
      q[idx] = {
        ...q[idx],
        attempts,
        last_error: err.slice(0, 400),
        next_at: new Date(Date.now() + delay * 1000).toISOString(),
        updated_at: nowIso(),
      };
      deferred += 1;
      saveQueue(q);
      console.warn(
        `[amo-note-queue] retry deal=${item.deal_id} in ${delay}s (try ${attempts}) · ${err.slice(0, 120)}`
      );
      // При лимите — не долбим дальше в этом тике
      if (/лимит|429|блокировк|rate.?limit|повтор через/i.test(err)) break;
    }

    return { sent, deferred, dropped, left: loadQueue().length };
  } finally {
    drainBusy = false;
  }
}
