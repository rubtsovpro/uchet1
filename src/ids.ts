import { randomUUID } from 'node:crypto';
import { get, run } from './db.js';

/** UUID v4 — тот же формат, что Ref_Key в 1С. */
export function newGuid(): string {
  return randomUUID();
}

export function isGuid(id: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    id
  );
}

/** Человекочитаемый код: PREFIX-000001 (автоинкремент в meta). */
export function nextCode(prefix: string, pad = 6): string {
  const key = `seq_${prefix.toLowerCase()}`;
  run('BEGIN');
  try {
    const row = get<{ value: string }>('SELECT value FROM meta WHERE key = ?', [key]);
    const n = (row ? Number(row.value) : 0) + 1;
    run('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)', [key, String(n)]);
    run('COMMIT');
    return `${prefix}-${String(n).padStart(pad, '0')}`;
  } catch (e) {
    try {
      run('ROLLBACK');
    } catch {
      /* ignore */
    }
    throw e;
  }
}
