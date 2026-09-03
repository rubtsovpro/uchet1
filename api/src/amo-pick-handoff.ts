/**
 * Примечание / задача в Amo после «Готово» / «Отмена» на /pick.
 * При лимите API — в очередь (amo-note-queue), воркер повторит позже.
 * Одно перемещение (TR-… / номер дока) — одно примечание (дедуп в meta).
 */
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { get, run } from './db.js';
import { enqueueAmoLeadNote } from './amo-note-queue.js';

const execFileAsync = promisify(execFile);

const PHP_BIN = process.env.AMO1C_PHP || '/usr/bin/php';

const DEFAULT_NOTE_SCRIPT =
  process.env.AMO1C_ADD_LEAD_NOTE ||
  '/root/amo1c_pnevmopodveska1_ru/public_html/bin/add_lead_note_for_wms.php';

const DEFAULT_TASK_SCRIPT =
  process.env.AMO1C_ADD_LEAD_TASK ||
  '/root/amo1c_pnevmopodveska1_ru/public_html/bin/add_lead_task_for_wms.php';

const LIST_NOTES_SCRIPT =
  process.env.AMO1C_LIST_LEAD_NOTES ||
  '/root/amo1c_pnevmopodveska1_ru/public_html/bin/list_lead_notes_for_wms.php';

const COURIER_DELIVERED_NOTE_RE =
  /курьер\s+отвез(\s+продажа)?|курьер\s+отв[ёе]з|отправка\s+курьером.*склад\s+курьера|списание\s+со\s+склада\s+курьера/i;

const DOC_NUM_RE = /\b((?:TR|IN|OUT)-\d+|Р\d+|P\d+|С\d+|НФ-\d+)\b/i;

async function runAmoCliScript(
  script: string,
  args: string[],
  timeoutMs = 45_000
): Promise<{ ok: boolean; error?: string; task_id?: number }> {
  try {
    const { stdout } = await execFileAsync(PHP_BIN, [script, ...args], {
      encoding: 'utf8',
      maxBuffer: 512 * 1024,
      timeout: timeoutMs,
    });
    const data = JSON.parse(String(stdout || '{}')) as {
      ok?: boolean;
      error?: string;
      task_id?: number;
    };
    if (data.ok === false) {
      return { ok: false, error: String(data.error || 'amo script failed') };
    }
    return { ok: true, task_id: data.task_id };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'amo script exec failed' };
  }
}

function extractDocNum(text: string): string {
  const m = String(text || '').match(DOC_NUM_RE);
  return m ? String(m[1]).toUpperCase() : '';
}

/** Ключ дедупа: deal + номер дока (TR-…) или хэш текста. */
export function amoNoteDedupeKey(dealId: string, text: string): string {
  const id = String(dealId || '').replace(/\D/g, '');
  const doc = extractDocNum(text);
  if (doc) return `amo_note_sent:${id}:${doc}`;
  const hash = createHash('sha1')
    .update(String(text || '').replace(/\s+/g, ' ').trim().toLowerCase())
    .digest('hex')
    .slice(0, 16);
  return `amo_note_sent:${id}:h:${hash}`;
}

function markAmoNoteSent(key: string, text: string): void {
  run(
    `INSERT INTO meta (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    [
      key,
      JSON.stringify({ at: new Date().toISOString(), text: String(text || '').slice(0, 400) }),
    ]
  );
}

function wasAmoNoteSent(key: string): boolean {
  const row = get<{ value: string }>(`SELECT value FROM meta WHERE key = ?`, [key]);
  return Boolean(String(row?.value || '').trim());
}

async function listDealNoteTexts(dealId: string): Promise<string[]> {
  const id = String(dealId || '').replace(/\D/g, '');
  if (!id) return [];
  try {
    const { stdout } = await execFileAsync(PHP_BIN, [LIST_NOTES_SCRIPT, `--deal=${id}`], {
      encoding: 'utf8',
      maxBuffer: 512 * 1024,
      timeout: 25_000,
    });
    const data = JSON.parse(String(stdout || '{}')) as { notes?: unknown[] };
    const notes = Array.isArray(data.notes) ? data.notes : [];
    return notes
      .map((n) => (typeof n === 'string' ? n : String((n as { text?: string })?.text || '')))
      .map((t) => t.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

async function amoAlreadyHasSameStockNote(dealId: string, text: string): Promise<boolean> {
  const doc = extractDocNum(text);
  const needle = String(text || '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
    .slice(0, 120);
  const notes = await listDealNoteTexts(dealId);
  for (const n of notes) {
    const low = n.replace(/\s+/g, ' ').trim().toLowerCase();
    if (doc && low.includes(doc.toLowerCase()) && /склад:\s*перемещен/i.test(n)) return true;
    if (needle && low.includes(needle)) return true;
    if (doc && low.includes(doc.toLowerCase()) && /списаны со склада сто/i.test(n)) return true;
  }
  return false;
}

/** Одна попытка без очереди (для воркера). */
export async function sendAmoLeadNoteOnce(opts: {
  dealId: string;
  text: string;
}): Promise<{ ok: boolean; error?: string; skipped?: boolean }> {
  const dealId = String(opts.dealId || '').replace(/\D/g, '');
  const text = String(opts.text || '').trim();
  if (!dealId || !text) return { ok: false, error: 'deal_id and text required' };

  const key = amoNoteDedupeKey(dealId, text);
  if (wasAmoNoteSent(key)) return { ok: true, skipped: true };

  const result = await runAmoCliScript(DEFAULT_NOTE_SCRIPT, [
    `--deal=${dealId}`,
    `--text=${text}`,
  ]);
  if (result.ok) markAmoNoteSent(key, text);
  return result;
}

export async function sendAmoLeadTaskOnce(opts: {
  dealId: string;
  text: string;
}): Promise<{ ok: boolean; error?: string; task_id?: number }> {
  const dealId = String(opts.dealId || '').replace(/\D/g, '');
  const text = String(opts.text || '').trim();
  if (!dealId || !text) return { ok: false, error: 'deal_id and text required' };
  return runAmoCliScript(DEFAULT_TASK_SCRIPT, [`--deal=${dealId}`, `--text=${text}`]);
}

/**
 * Примечание в сделку. Дубли по TR-/номеру не шлём.
 * Если Amo лимит / ошибка — в очередь, воркер дошлёт.
 */
export async function notifyAmoWarehousePacked(opts: {
  dealId: string;
  text: string;
}): Promise<{ ok: boolean; error?: string; queued?: boolean; skipped?: boolean }> {
  const dealId = String(opts.dealId || '').replace(/\D/g, '');
  const text = String(opts.text || '').trim();
  if (!dealId || !text) return { ok: false, error: 'deal_id and text required' };

  const key = amoNoteDedupeKey(dealId, text);
  if (wasAmoNoteSent(key)) return { ok: true, skipped: true };

  try {
    if (await amoAlreadyHasSameStockNote(dealId, text)) {
      markAmoNoteSent(key, text);
      return { ok: true, skipped: true };
    }
  } catch {
    /* list notes optional */
  }

  const once = await sendAmoLeadNoteOnce({ dealId, text });
  if (once.ok) return { ok: true, skipped: once.skipped };

  const delaySec = /лимит|429|блокировк|повтор через|rate.?limit/i.test(String(once.error || ''))
    ? 45
    : 25;
  enqueueAmoLeadNote({
    dealId,
    text,
    kind: 'note',
    delaySec,
    error: once.error,
  });
  return { ok: true, queued: true, error: once.error };
}

/** Уже есть примечание «курьер отвёз» / списание с курьера. */
export async function amoHasCourierDeliveredNote(dealId: string): Promise<boolean> {
  const id = String(dealId || '').replace(/\D/g, '');
  if (!id) return false;
  const notes = await listDealNoteTexts(id);
  return notes.some((t) => COURIER_DELIVERED_NOTE_RE.test(t));
}

/** Примечание в Amo после «Отвёз» — один раз, без дублей. */
export async function notifyAmoCourierDeliveredOnce(opts: {
  dealId: string;
  text: string;
}): Promise<{ ok: boolean; error?: string; skipped?: boolean; queued?: boolean }> {
  const dealId = String(opts.dealId || '').replace(/\D/g, '');
  const text = String(opts.text || '').trim();
  if (!dealId || !text) return { ok: false, error: 'deal_id and text required' };
  if (await amoHasCourierDeliveredNote(dealId)) {
    return { ok: true, skipped: true };
  }
  return notifyAmoWarehousePacked({ dealId, text });
}

/** Задача менеджеру: склад не смог собрать передачу. */
export async function notifyAmoHandoffReturn(opts: {
  dealId: string;
  text: string;
}): Promise<{ ok: boolean; error?: string; task_id?: number; queued?: boolean }> {
  const dealId = String(opts.dealId || '').replace(/\D/g, '');
  const text = String(opts.text || '').trim();
  if (!dealId || !text) return { ok: false, error: 'deal_id and text required' };

  const once = await sendAmoLeadTaskOnce({ dealId, text });
  if (once.ok) return { ok: true, task_id: once.task_id };

  enqueueAmoLeadNote({
    dealId,
    text,
    kind: 'task',
    delaySec: 45,
    error: once.error,
  });
  return { ok: true, queued: true, error: once.error };
}
